import type { InMemoryStore } from "./store.js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    from?: { id: number };
    text?: string;
    chat: { id: number };
  };
}

interface TelegramBotOptions {
  token: string;
  store: InMemoryStore;
}

export class TelegramBot {
  private readonly token: string;
  private readonly store: InMemoryStore;
  private offset = 0;
  private running = false;

  constructor(options: TelegramBotOptions) {
    this.token = options.token;
    this.store = options.store;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          this.handleUpdate(update);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[telegram-bot] polling error:", error instanceof Error ? error.message : error);
        await sleep(5000);
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=30`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Telegram API error: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
    if (!body.ok) {
      throw new Error("Telegram API returned ok=false");
    }
    return body.result;
  }

  private handleUpdate(update: TelegramUpdate): void {
    const message = update.message;
    if (!message?.text || !message.from) return;

    const text = message.text.trim();
    if (!text.startsWith("/start ")) return;

    const challengeId = text.slice("/start ".length).trim();
    if (!challengeId) return;

    const telegramUserId = String(message.from.id);
    const resolved = this.store.resolveChallenge(challengeId, telegramUserId);

    if (resolved) {
      this.sendMessage(message.chat.id, "You're logged in! You can close this chat and go back to the app.");
    } else {
      this.sendMessage(message.chat.id, "This login link has expired or was already used. Please request a new one.");
    }
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[telegram-bot] sendMessage error:", error instanceof Error ? error.message : error);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
