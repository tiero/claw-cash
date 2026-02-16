import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";
import type { ParsedArgs } from "minimist";
import type { RemoteSignerIdentity } from "@clw-cash/sdk";
import type { StablecoinToken, EvmChain } from "@clw-cash/skills";

// CAIP-2 network ID → LendaSwap chain/token mapping
const CAIP2_TO_CHAIN: Record<string, { chain: EvmChain; token: StablecoinToken }> = {
  "eip155:137":   { chain: "polygon",  token: "usdc_pol" },
  "eip155:42161": { chain: "arbitrum", token: "usdc_arb" },
  "eip155:1":     { chain: "ethereum", token: "usdc_eth" },
};

// Bitcoin CAIP-2 networks (future: Lightning, Arkade, on-chain)
const BITCOIN_NETWORKS = new Set([
  "bip122:000000000019d6689c085ae165831e93", // Bitcoin mainnet
  "lightning:mainnet",
  "arkade:mainnet",
]);

/**
 * cash fetch <url> [--method GET] [--body <json>] [--header key:value]
 *
 * Makes an HTTP request. If the server responds with 402 Payment Required,
 * automatically handles payment via x402 protocol:
 *
 * EVM payments (Polygon, Arbitrum, Ethereum):
 *   1. Parse 402 requirements (chain, amount, asset)
 *   2. Swap BTC → USDC on the required chain via LendaSwap (gasless arkadeToEvm)
 *   3. Sign transferWithAuthorization via ECDSA through the enclave
 *   4. Retry the request with payment proof
 *
 * Bitcoin payments (future: Lightning, Arkade, on-chain):
 *   1. Parse 402 requirements (bolt11 invoice, address, etc.)
 *   2. Pay directly with sats — no swap needed
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

  // 402 Payment Required — parse requirements to determine chain and amount
  console.error("[x402] Payment required, parsing requirements...");
  const paymentRequired = await parsePaymentRequired(response);
  if (!paymentRequired) {
    return outputError("402 Payment Required but could not parse payment requirements");
  }

  // Find the best payment option we can fulfill
  const evmOption = selectEvmOption(paymentRequired.accepts);
  const btcOption = selectBitcoinOption(paymentRequired.accepts);

  if (btcOption) {
    // Future: pay directly with sats via Lightning/Arkade/on-chain
    console.error(`[x402] Bitcoin payment option found: ${btcOption.network} (${btcOption.amount} sats)`);
    return outputError(
      "Bitcoin x402 payments not yet implemented. " +
      "This will support Lightning invoices, Arkade vtxo transfers, and on-chain payments. " +
      `Requested: ${btcOption.network}, amount: ${btcOption.amount}`
    );
  }

  if (!evmOption) {
    const networks = paymentRequired.accepts.map((a: any) => a.network).join(", ");
    return outputError(
      `No supported payment method found. Server accepts: [${networks}]. ` +
      `Supported EVM chains: ${Object.keys(CAIP2_TO_CHAIN).join(", ")}. ` +
      "Bitcoin payments coming soon."
    );
  }

  const chainInfo = CAIP2_TO_CHAIN[evmOption.network];
  if (!chainInfo) {
    return outputError(
      `Chain ${evmOption.network} is not yet supported for BTC→USDC swaps. ` +
      `Supported: ${Object.keys(CAIP2_TO_CHAIN).join(", ")}`
    );
  }

  // Amount in USDC atomic units (6 decimals)
  const usdcAmount = parseInt(evmOption.amount, 10);
  const usdcHuman = (usdcAmount / 1e6).toFixed(6);
  console.error(`[x402] Payment: ${usdcHuman} USDC on ${chainInfo.chain} (${evmOption.network})`);

  // Lazy-load viem and x402 dependencies
  const [viemAccounts, viemMod, x402FetchMod, x402EvmMod] = await Promise.all([
    import("viem/accounts"),
    import("viem"),
    import("@x402/fetch"),
    import("@x402/evm/exact/client"),
  ]);

  // Create a custom viem account backed by remote ECDSA signing via enclave
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
      throw new Error("Transaction signing not supported — agent operates gaslessly");
    },
    async signTypedData(params) {
      const hash = viemMod.hashTypedData(params as any);
      return signWithIdentity(ctx.identity, hash);
    },
  });

  // Swap BTC → USDC on the required chain (gasless via LendaSwap arkadeToEvm)
  console.error(`[x402] Swapping BTC → ${usdcHuman} USDC on ${chainInfo.chain}...`);
  try {
    const swapResult = await ctx.swap.swapBtcToStablecoin({
      targetAddress: evmAddress,
      targetToken: chainInfo.token,
      targetChain: chainInfo.chain,
      targetAmount: usdcAmount,
    });
    console.error(`[x402] Swap initiated: ${swapResult.swapId}, waiting for completion...`);

    // Poll for swap completion
    await waitForSwapCompletion(ctx, swapResult.swapId);
    console.error("[x402] USDC delivered, proceeding with payment...");
  } catch (err: any) {
    return outputError(`BTC→USDC swap failed: ${err.message}`);
  }

  // Register EVM scheme with wildcard (all EVM chains)
  const client = new x402FetchMod.x402Client();
  x402EvmMod.registerExactEvmScheme(client, { signer: customAccount as any });

  // Retry the request — x402 handles the 402 negotiation and payment signing
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

// ── Payment requirement parsing ────────────────────────────

interface PaymentAccept {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

interface PaymentRequired {
  x402Version: number;
  accepts: PaymentAccept[];
}

async function parsePaymentRequired(response: Response): Promise<PaymentRequired | null> {
  // V2: base64-encoded JSON in PAYMENT-REQUIRED header
  const header = response.headers.get("payment-required");
  if (header) {
    try {
      const decoded = JSON.parse(atob(header));
      if (decoded.accepts) return decoded;
    } catch { /* fall through to body */ }
  }

  // V1: JSON body with accepts array
  try {
    const body = await response.json();
    if (body.accepts) return body;
  } catch { /* not parseable */ }

  return null;
}

function selectEvmOption(accepts: PaymentAccept[]): PaymentAccept | null {
  // Prefer chains we can swap to (Polygon, Arbitrum, Ethereum)
  // Then fall back to any EVM chain (e.g. Base) with a warning
  const supported = accepts.filter(a => a.network.startsWith("eip155:") && CAIP2_TO_CHAIN[a.network]);
  if (supported.length > 0) return supported[0];

  const anyEvm = accepts.filter(a => a.network.startsWith("eip155:"));
  if (anyEvm.length > 0) return anyEvm[0];

  return null;
}

function selectBitcoinOption(accepts: PaymentAccept[]): PaymentAccept | null {
  return accepts.find(a => BITCOIN_NETWORKS.has(a.network) || a.network.startsWith("bip122:")) || null;
}

// ── Swap completion polling ────────────────────────────────

async function waitForSwapCompletion(ctx: CashContext, swapId: string): Promise<void> {
  const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes
  const POLL_INTERVAL_MS = 3000;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    const info = await ctx.swap.getSwapStatus(swapId);
    if (info.status === "completed") return;
    if (info.status === "failed" || info.status === "expired" || info.status === "refunded") {
      throw new Error(`Swap ${swapId} ended with status: ${info.status}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Swap ${swapId} timed out after ${MAX_WAIT_MS / 1000}s`);
}

// ── ECDSA signing helper ───────────────────────────────────

async function signWithIdentity(
  identity: RemoteSignerIdentity,
  hash: `0x${string}`
): Promise<`0x${string}`> {
  const digestHex = hash.slice(2);
  const result = await identity.signEcdsaDigest(digestHex);
  return `0x${result.r}${result.s}${result.v.toString(16).padStart(2, "0")}` as `0x${string}`;
}
