import { loadConfig, saveConfig } from "./config.js";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

export interface PendingAuth {
  challengeId: string;
  deepLink: string | null;
  apiBaseUrl: string;
  /** Telegram bot token to send the reply as */
  botToken: string;
  /** Chat ID to send the reply to */
  chatId: number;
  /** Message ID to reply to */
  messageId: number;
  createdAt: number;
}

export class AuthMonitor {
  private pending: PendingAuth | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  /** Start watching a new auth challenge. Only one at a time. */
  watch(auth: PendingAuth): void {
    this.stop();
    this.pending = auth;
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  getStatus(): { status: "idle" } | { status: "polling"; challengeId: string } {
    if (!this.pending) return { status: "idle" };
    return { status: "polling", challengeId: this.pending.challengeId };
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.pending) return;
    this.polling = true;

    const auth = this.pending;

    try {
      // Check timeout
      if (Date.now() - auth.createdAt > POLL_TIMEOUT_MS) {
        console.error(`[auth-monitor] challenge ${auth.challengeId} timed out`);
        await this.sendTelegramReply(auth, "Login timed out. Please try again.");
        this.stop();
        return;
      }

      const res = await fetch(`${auth.apiBaseUrl}/v1/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge_id: auth.challengeId }),
      });

      // 202 = not yet resolved
      if (res.status === 202) return;

      if (res.ok) {
        const session = (await res.json()) as {
          token: string;
          expires_in: number;
          user: { id: string; telegram_user_id: string; status: string };
        };

        // Save the new token to config
        const config = loadConfig();
        config.sessionToken = session.token;
        saveConfig(config);

        // Restore identity if exists
        if (config.identityId && config.publicKey) {
          try {
            const restoreRes = await fetch(
              `${auth.apiBaseUrl}/v1/identities/${config.identityId}/restore`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({ public_key: config.publicKey }),
              }
            );
            if (!restoreRes.ok) {
              console.error(`[auth-monitor] identity restore failed: ${await restoreRes.text()}`);
            }
          } catch (err) {
            console.error(`[auth-monitor] identity restore error: ${err}`);
          }
        }

        console.error(`[auth-monitor] login successful for user ${session.user.id}`);
        await this.sendTelegramReply(auth, "Connected, welcome back!");
        this.stop();
        return;
      }

      // Unexpected error
      const text = await res.text();
      console.error(`[auth-monitor] verify error: ${text}`);
      await this.sendTelegramReply(auth, "Login failed. Please try again.");
      this.stop();
    } catch (err) {
      console.error(`[auth-monitor] poll error: ${err}`);
    } finally {
      this.polling = false;
    }
  }

  private async sendTelegramReply(auth: PendingAuth, text: string): Promise<void> {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${auth.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: auth.chatId,
            text,
            reply_to_message_id: auth.messageId,
          }),
        }
      );
      if (!res.ok) {
        console.error(`[auth-monitor] telegram reply failed: ${await res.text()}`);
      }
    } catch (err) {
      console.error(`[auth-monitor] telegram reply error: ${err}`);
    }
  }
}
