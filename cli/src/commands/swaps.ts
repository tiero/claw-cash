import { getDaemonStatus } from "../daemon.js";
import { outputSuccess, outputError } from "../output.js";
import type { CashContext } from "../context.js";

export async function handleSwaps(ctx?: CashContext): Promise<never> {
  // If daemon is running, fetch from it
  const status = getDaemonStatus();
  if (status.running && status.port) {
    try {
      const res = await fetch(`http://127.0.0.1:${status.port}/swaps`);
      const data = await res.json();
      return outputSuccess(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return outputError(`Failed to fetch swaps from daemon: ${message}`);
    }
  }

  // No daemon — query directly if context provided
  if (!ctx) {
    return outputError("Daemon is not running. Start it with 'cash start' or provide wallet config.");
  }

  const [lightningSwaps, lendaSwaps] = await Promise.all([
    ctx.lightning.getPendingSwaps(),
    ctx.swap.getPendingSwaps(),
  ]);

  return outputSuccess({ lightning: lightningSwaps, lendaswap: lendaSwaps });
}
