import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";
import { MppClient } from "../mpp/client.js";
import type { ParsedArgs } from "minimist";

export async function handlePay(
  ctx: CashContext,
  args: ParsedArgs
): Promise<never> {
  const positionals = args._.slice(1); // after "pay"
  const url = positionals[0] as string | undefined;
  const method = (args.method as string | undefined)?.toUpperCase() ?? "GET";
  const body = args.body as string | undefined;
  const headerArgs = args.header as string | string[] | undefined;

  if (!url) {
    return outputError(
      "Missing URL.\n\nUsage:\n" +
      "  cash pay <url>\n" +
      "  cash pay <url> --method POST --body '{\"query\":\"test\"}'\n" +
      "  cash pay <url> --header 'Authorization: Bearer token'\n\n" +
      "The command fetches the URL. If the server returns an MPP 402 payment\n" +
      "challenge, claw-cash automatically swaps BTC→stablecoin and retries\n" +
      "with payment proof."
    );
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return outputError(`Invalid URL: ${url}`);
  }

  // Parse --header flags into a Record
  const headers: Record<string, string> = {};
  if (headerArgs) {
    const list = Array.isArray(headerArgs) ? headerArgs : [headerArgs];
    for (const h of list) {
      const colonIdx = h.indexOf(":");
      if (colonIdx === -1) {
        return outputError(`Invalid header format: ${h}. Expected "Name: value"`);
      }
      headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
    }
  }

  const client = new MppClient({
    swap: {
      swapBtcToStablecoin: (params) =>
        ctx.swap.swapBtcToStablecoin(params as Parameters<typeof ctx.swap.swapBtcToStablecoin>[0]),
    },
  });

  const init: RequestInit = { method, headers };
  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    init.body = body;
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const result = await client.pay(url, init);

  return outputSuccess({
    url,
    status: result.status,
    body: tryParseJson(result.body),
    paid: !!result.proof,
    swap_id: result.swap_id,
    proof: result.proof,
  });
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
