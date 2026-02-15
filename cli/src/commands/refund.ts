import type { CashContext } from "../context.js";
import { outputSuccess, outputError } from "../output.js";
import { getDaemonUrl, daemonPost } from "../daemonClient.js";
import type { ParsedArgs } from "minimist";

export async function handleRefund(ctx: CashContext, args: ParsedArgs): Promise<never> {
  const swapId = (args._[1] as string) || (args.id as string);

  if (!swapId) {
    return outputError("Missing swap ID. Usage: cash refund <swapId> [--address <destination>]");
  }

  const destinationAddress = args.address as string | undefined;

  // Proxy through daemon when running
  if (getDaemonUrl()) {
    const result = await daemonPost(`/swaps/${swapId}/refund`, { destinationAddress });
    return outputSuccess(result);
  }

  // Check swap direction to determine refund method
  const info = await ctx.swap.getSwapStatus(swapId);

  if (info.direction === "stablecoin_to_btc") {
    // EVM→BTC swap: return EVM refund call data for the user to broadcast
    const callData = await ctx.swap.getEvmRefundCallData(swapId);
    return outputSuccess({
      type: "evm_refund",
      swapId,
      timelockExpired: callData.timelockExpired,
      timelockExpiry: callData.timelockExpiry,
      transaction: { to: callData.to, data: callData.data },
    });
  }

  // BTC→Stablecoin swap: refund directly via SDK
  const result = await ctx.swap.refundSwap(swapId, { destinationAddress });
  return outputSuccess(result);
}
