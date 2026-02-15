import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";
import { getDaemonUrl, daemonPost } from "../daemonClient.js";
import type { ParsedArgs } from "minimist";

export async function handleClaim(ctx: CashContext, args: ParsedArgs): Promise<never> {
  const swapId = (args._[1] as string) || (args.id as string);

  if (!swapId) {
    return outputError("Missing swap ID. Usage: cash claim <swapId>");
  }

  // Proxy through daemon when running
  if (getDaemonUrl()) {
    const result = await daemonPost(`/swaps/${swapId}/claim`, {});
    return outputSuccess(result);
  }

  const result = await ctx.swap.claimSwap(swapId);
  return outputSuccess(result);
}
