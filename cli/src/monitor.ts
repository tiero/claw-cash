import type { CashContext } from "./context.js";

export interface SwapMonitorOpts {
  pollIntervalMs?: number;
}

export class SwapMonitor {
  private readonly ctx: CashContext;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPollTime: Date | null = null;
  private polling = false;

  constructor(ctx: CashContext, opts?: SwapMonitorOpts) {
    this.ctx = ctx;
    this.pollIntervalMs = opts?.pollIntervalMs ?? 30_000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    // Run immediately on start
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLastPollTime(): Date | null {
    return this.lastPollTime;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  private async poll(): Promise<void> {
    if (this.polling) return; // Skip if previous poll still running
    this.polling = true;

    try {
      const pending = await this.ctx.swap.getPendingSwaps();
      this.lastPollTime = new Date();

      for (const swap of pending) {
        // Attempt claim for swaps in "processing" status (server has funded)
        if (swap.status === "processing") {
          try {
            const result = await this.ctx.swap.claimSwap(swap.id);
            console.error(`[monitor] claimed swap ${swap.id}: ${result.success ? "ok" : result.message}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[monitor] claim failed for ${swap.id}: ${msg}`);
          }
        }

        // Attempt refund for expired swaps
        if (swap.status === "expired") {
          try {
            const result = await this.ctx.swap.refundSwap(swap.id);
            console.error(`[monitor] refunded swap ${swap.id}: ${result.success ? "ok" : result.message}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[monitor] refund failed for ${swap.id}: ${msg}`);
          }
        }
      }

      if (pending.length > 0) {
        console.error(`[monitor] polled ${pending.length} pending swap(s)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[monitor] poll error: ${msg}`);
    } finally {
      this.polling = false;
    }
  }
}
