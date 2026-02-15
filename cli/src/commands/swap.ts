import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";
import { getDaemonUrl, daemonGet } from "../daemonClient.js";
import type { ParsedArgs } from "minimist";

const LENDASWAP_API = "https://apilendaswap.lendasat.com";

export async function handleSwap(ctx: CashContext, args: ParsedArgs): Promise<never> {
  const swapId = (args._[1] as string) || (args.id as string);

  if (!swapId) {
    return outputError("Missing swap ID. Usage: cash swap <swapId>");
  }

  // Proxy through daemon when running
  if (getDaemonUrl()) {
    const result = await daemonGet(`/swaps/${encodeURIComponent(swapId)}`);
    return outputSuccess(result);
  }

  // Fetch local status and remote API status in parallel
  const [local, remote] = await Promise.all([
    ctx.swap.getSwapStatus(swapId).catch(() => null),
    fetchRemoteSwap(swapId),
  ]);

  if (!local && !remote) {
    return outputError(`Swap ${swapId} not found locally or on LendaSat API.`);
  }

  return outputSuccess(mergeSwapData(swapId, local, remote));
}

async function fetchRemoteSwap(swapId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${LENDASWAP_API}/swap/${encodeURIComponent(swapId)}`);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeSwapData(
  swapId: string,
  local: Awaited<ReturnType<CashContext["swap"]["getSwapStatus"]>> | null,
  remote: Record<string, unknown> | null,
): Record<string, unknown> {
  const result: Record<string, unknown> = { id: swapId };

  if (local) {
    result.local = {
      direction: local.direction,
      status: local.status,
      sourceToken: local.sourceToken,
      targetToken: local.targetToken,
      sourceAmount: local.sourceAmount,
      targetAmount: local.targetAmount,
      exchangeRate: local.exchangeRate,
      createdAt: local.createdAt,
      completedAt: local.completedAt,
      txid: local.txid,
    };
  }

  if (remote) {
    result.remote = remote;
  }

  // Use local status as primary, fall back to remote
  if (local) {
    result.status = local.status;
    result.direction = local.direction;
  } else if (remote) {
    result.status = remote.status;
    result.direction = remote.direction;
  }

  return result;
}
