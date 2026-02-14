import type { CashContext } from "../context.js";
import { outputSuccess } from "../output.js";
import { getDaemonUrl, daemonGet } from "../daemonClient.js";

export async function handleBalance(ctx: CashContext): Promise<never> {
  // Proxy through daemon when running
  if (getDaemonUrl()) {
    const balance = await daemonGet("/balance");
    return outputSuccess(balance);
  }

  const balance = await ctx.bitcoin.getBalance();
  return outputSuccess(balance);
}
