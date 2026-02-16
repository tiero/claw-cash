import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";
import type { ParsedArgs } from "minimist";
import type { RemoteSignerIdentity } from "@clw-cash/sdk";

/**
 * cash fetch <url> [--method GET] [--body <json>] [--header key:value]
 *
 * Makes an HTTP request. If the server responds with 402 Payment Required,
 * automatically handles payment via x402 protocol:
 * 1. Swap BTC -> USDC via LendaSwap (gasless arkadeToEvm)
 * 2. Sign transferWithAuthorization via ECDSA through the enclave
 * 3. Retry the request with payment proof
 */
export async function handleFetch(
  ctx: CashContext,
  args: ParsedArgs
): Promise<never> {
  const url = args._[1] as string | undefined;
  if (!url) {
    return outputError("Usage: cash fetch <url> [--method GET] [--body <json>] [--header key:value]");
  }

  const method = (args.method as string) || "GET";
  const bodyStr = args.body as string | undefined;
  const rawHeaders = args.header as string | string[] | undefined;

  // Parse headers
  const headers: Record<string, string> = {};
  if (rawHeaders) {
    const headerList = Array.isArray(rawHeaders) ? rawHeaders : [rawHeaders];
    for (const h of headerList) {
      const colonIdx = h.indexOf(":");
      if (colonIdx === -1) return outputError(`Invalid header format: ${h}. Expected key:value`);
      headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
    }
  }

  // First, try the request without payment
  const fetchOpts: RequestInit = { method, headers };
  if (bodyStr && method !== "GET") {
    fetchOpts.body = bodyStr;
    if (!headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
  }

  const response = await fetch(url, fetchOpts);

  // If not 402, return the response directly
  if (response.status !== 402) {
    const contentType = response.headers.get("content-type") || "";
    let data: unknown;
    if (contentType.includes("json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    if (!response.ok) {
      return outputError(`HTTP ${response.status}: ${response.statusText}`, data);
    }
    return outputSuccess(data);
  }

  // 402 Payment Required - handle via x402
  console.error("[x402] Payment required, setting up payment...");

  // Lazy-load viem and x402 dependencies
  const [viemAccounts, viemMod, x402FetchMod, x402EvmMod] = await Promise.all([
    import("viem/accounts"),
    import("viem"),
    import("@x402/fetch"),
    import("@x402/evm/exact/client"),
  ]);

  // Create a custom viem account backed by remote ECDSA signing
  const evmAddress = ctx.identity.getEvmAddress() as `0x${string}`;
  console.error(`[x402] Agent EVM address: ${evmAddress}`);

  const customAccount = viemAccounts.toAccount({
    address: evmAddress,
    async signMessage({ message }) {
      const msgBytes = typeof message === "string"
        ? new TextEncoder().encode(message)
        : message.raw instanceof Uint8Array
          ? message.raw
          : viemMod.hexToBytes(message.raw);
      const hash = viemMod.keccak256(msgBytes);
      return signWithIdentity(ctx.identity, hash);
    },
    async signTransaction() {
      throw new Error("Transaction signing not supported - agent operates gaslessly");
    },
    async signTypedData(params) {
      const hash = viemMod.hashTypedData(params as any);
      return signWithIdentity(ctx.identity, hash);
    },
  });

  // Check if agent has USDC at its EVM address already, or needs to swap
  // For now, always attempt to proceed with x402 payment
  // The x402 facilitator handles the on-chain submission

  const client = new x402FetchMod.x402Client();
  x402EvmMod.registerExactEvmScheme(client, { signer: customAccount as any });

  const fetchWithPayment = x402FetchMod.wrapFetchWithPayment(fetch, client);

  console.error("[x402] Retrying request with payment...");
  const paidResponse = await fetchWithPayment(url, fetchOpts);

  const paidContentType = paidResponse.headers.get("content-type") || "";
  let paidData: unknown;
  if (paidContentType.includes("json")) {
    paidData = await paidResponse.json();
  } else {
    paidData = await paidResponse.text();
  }

  if (!paidResponse.ok) {
    return outputError(`HTTP ${paidResponse.status} after payment: ${paidResponse.statusText}`, paidData);
  }

  return outputSuccess(paidData);
}

async function signWithIdentity(
  identity: RemoteSignerIdentity,
  hash: `0x${string}`
): Promise<`0x${string}`> {
  const digestHex = hash.slice(2); // remove 0x prefix
  const result = await identity.signEcdsaDigest(digestHex);
  // Serialize as 65-byte hex: r (32 bytes) + s (32 bytes) + v (1 byte)
  return `0x${result.r}${result.s}${result.v.toString(16).padStart(2, "0")}` as `0x${string}`;
}
