import { randomUUID } from "node:crypto";

export type SwapEventType = "swap.claimed" | "swap.refunded" | "swap.failed";

export interface SwapEvent {
  event: SwapEventType;
  swapId: string;
  status: string;
  direction: string;
  sourceAmount: number;
  sourceToken: string;
  targetAmount: number;
  targetToken: string;
  message: string;
  error?: string;
  timestamp: string;
}

interface WebhookRegistration {
  id: string;
  url: string;
  events: SwapEventType[];
}

const VALID_EVENTS = new Set<SwapEventType>(["swap.claimed", "swap.refunded", "swap.failed"]);

export class WebhookRegistry {
  private readonly webhooks = new Map<string, WebhookRegistration>();

  register(url: string, events: SwapEventType[]): WebhookRegistration {
    const filtered = events.filter((e) => VALID_EVENTS.has(e));
    if (filtered.length === 0) {
      throw new Error(`No valid events. Valid: ${[...VALID_EVENTS].join(", ")}`);
    }

    const reg: WebhookRegistration = { id: randomUUID(), url, events: filtered };
    this.webhooks.set(reg.id, reg);
    return reg;
  }

  unregister(id: string): boolean {
    return this.webhooks.delete(id);
  }

  list(): WebhookRegistration[] {
    return [...this.webhooks.values()];
  }

  dispatch(event: SwapEvent): void {
    for (const reg of this.webhooks.values()) {
      if (!reg.events.includes(event.event)) continue;

      fetch(reg.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      }).catch((err) => {
        console.error(`[notifier] webhook ${reg.id} (${reg.url}) failed: ${err}`);
      });
    }
  }
}
