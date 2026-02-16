import type { CashContext } from "./context.js";
import type { SwapEvent } from "./notifier.js";

export interface SwapMonitorOpts {
  pollIntervalMs?: number;
  onEvent?: (event: SwapEvent) => void;
}

export class SwapMonitor {
  private readonly ctx: CashContext;
  private readonly pollIntervalMs: number;
  private readonly onEvent?: (event: SwapEvent) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPollTime: Date | null = null;
  private polling = false;

  constructor(ctx: CashContext, opts?: SwapMonitorOpts) {
    this.ctx = ctx;
    this.pollIntervalMs = opts?.pollIntervalMs ?? 30_000;
    this.onEvent = opts?.onEvent;
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

  private emit(event: SwapEvent): void {
    try {
      this.onEvent?.(event);
    } catch (err) {
      console.error(`[monitor] onEvent error: ${err}`);
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return; // Skip if previous poll still running
    this.polling = true;

    try {
      const pending = await this.ctx.swap.getPendingSwaps();
      this.lastPollTime = new Date();

      for (const swap of pending) {
        const base = {
          swapId: swap.id,
          status: swap.status,
          direction: swap.direction,
          sourceAmount: swap.sourceAmount,
          sourceToken: swap.sourceToken,
          targetAmount: swap.targetAmount,
          targetToken: swap.targetToken,
          timestamp: new Date().toISOString(),
        };

        // Attempt claim for swaps in "processing" status (server has funded)
        if (swap.status === "processing") {
          try {
            const result = await this.ctx.swap.claimSwap(swap.id);
            const message = result.success
              ? `Swap ${swap.id.slice(0, 8)}… claimed: ${swap.sourceAmount} ${swap.sourceToken} → ${swap.targetAmount} ${swap.targetToken}`
              : `Swap ${swap.id.slice(0, 8)}… claim returned: ${result.message}`;
            console.error(`[monitor] ${message}`);
            if (result.success) {
              this.emit({ ...base, event: "swap.claimed", status: "completed", message });
            } else {
              this.emit({ ...base, event: "swap.failed", message, error: result.message });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const message = `Swap ${swap.id.slice(0, 8)}… claim failed: ${errMsg}`;
            console.error(`[monitor] ${message}`);
            this.emit({ ...base, event: "swap.failed", message, error: errMsg });
          }
        }

        // Attempt refund for expired swaps
        if (swap.status === "expired") {
          try {
            const result = await this.ctx.swap.refundSwap(swap.id);
            const message = result.success
              ? `Swap ${swap.id.slice(0, 8)}… refunded: ${swap.sourceAmount} ${swap.sourceToken} returned`
              : `Swap ${swap.id.slice(0, 8)}… refund returned: ${result.message}`;
            console.error(`[monitor] ${message}`);
            if (result.success) {
              this.emit({ ...base, event: "swap.refunded", status: "refunded", message });
            } else {
              this.emit({ ...base, event: "swap.failed", message, error: result.message });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const message = `Swap ${swap.id.slice(0, 8)}… refund failed: ${errMsg}`;
            console.error(`[monitor] ${message}`);
            this.emit({ ...base, event: "swap.failed", message, error: errMsg });
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
