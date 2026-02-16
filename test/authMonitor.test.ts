import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthMonitor, type PendingAuth } from "../cli/src/authMonitor.js";

// Mock config module so AuthMonitor doesn't touch the real filesystem
vi.mock("../cli/src/config.js", () => ({
  loadConfig: () => ({
    apiBaseUrl: "https://api.test",
    sessionToken: "old-token",
    identityId: "id-123",
    publicKey: "pub-abc",
    arkServerUrl: "https://ark.test",
    network: "testnet",
  }),
  saveConfig: vi.fn(),
}));

function makePendingAuth(overrides?: Partial<PendingAuth>): PendingAuth {
  return {
    challengeId: "challenge-1",
    deepLink: "https://t.me/bot?start=challenge-1",
    apiBaseUrl: "https://api.test",
    botToken: "123:ABC",
    chatId: 456,
    messageId: 789,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("AuthMonitor", () => {
  let monitor: AuthMonitor;

  beforeEach(() => {
    monitor = new AuthMonitor();
    vi.useFakeTimers();
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts idle", () => {
    expect(monitor.getStatus()).toEqual({ status: "idle" });
  });

  it("reports polling status after watch()", () => {
    // Prevent actual fetch calls
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 202 }));

    monitor.watch(makePendingAuth());
    expect(monitor.getStatus()).toEqual({
      status: "polling",
      challengeId: "challenge-1",
    });
  });

  it("returns to idle after stop()", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 202 }));

    monitor.watch(makePendingAuth());
    monitor.stop();
    expect(monitor.getStatus()).toEqual({ status: "idle" });
  });

  it("polls /v1/auth/verify and handles 202 (not yet resolved)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202 });
    vi.stubGlobal("fetch", fetchMock);

    monitor.watch(makePendingAuth());

    // Let the initial poll run
    await vi.advanceTimersByTimeAsync(0);

    // Should have called verify endpoint
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/v1/auth/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ challenge_id: "challenge-1" }),
      })
    );

    // Still polling
    expect(monitor.getStatus()).toEqual({
      status: "polling",
      challengeId: "challenge-1",
    });
  });

  it("on successful verify: saves config, restores identity, sends Telegram reply", async () => {
    const { saveConfig } = await import("../cli/src/config.js");

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/v1/auth/verify")) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              token: "new-jwt",
              expires_in: 3600,
              user: { id: "u1", telegram_user_id: "tg1", status: "active" },
            }),
        });
      }
      // identity restore
      if (typeof url === "string" && url.includes("/v1/identities/")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve("ok") });
      }
      // Telegram sendMessage
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve("ok") });
      }
      return Promise.resolve({ status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    monitor.watch(makePendingAuth());
    await vi.advanceTimersByTimeAsync(0);

    // Config was saved with new token
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: "new-jwt" })
    );

    // Identity restore was called
    const restoreCall = fetchMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("/v1/identities/id-123/restore")
    );
    expect(restoreCall).toBeDefined();

    // Telegram reply was sent
    const telegramCall = fetchMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("api.telegram.org")
    );
    expect(telegramCall).toBeDefined();
    const telegramBody = JSON.parse((telegramCall![1] as { body: string }).body);
    expect(telegramBody).toEqual({
      chat_id: 456,
      text: "Connected, welcome back!",
      reply_to_message_id: 789,
    });

    // Monitor stopped itself
    expect(monitor.getStatus()).toEqual({ status: "idle" });
  });

  it("sends timeout message after 120s", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/v1/auth/verify")) {
        return Promise.resolve({ status: 202 });
      }
      // Telegram sendMessage
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve("ok") });
      }
      return Promise.resolve({ status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    monitor.watch(makePendingAuth({ createdAt: Date.now() }));

    // Advance past the 120s timeout
    await vi.advanceTimersByTimeAsync(122_000);

    // Telegram timeout message was sent
    const telegramCall = fetchMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("api.telegram.org")
    );
    expect(telegramCall).toBeDefined();
    const telegramBody = JSON.parse((telegramCall![1] as { body: string }).body);
    expect(telegramBody.text).toBe("Login timed out. Please try again.");

    // Monitor stopped
    expect(monitor.getStatus()).toEqual({ status: "idle" });
  });

  it("replaces previous auth when watch() is called again", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 202 }));

    monitor.watch(makePendingAuth({ challengeId: "first" }));
    expect(monitor.getStatus()).toEqual({ status: "polling", challengeId: "first" });

    monitor.watch(makePendingAuth({ challengeId: "second" }));
    expect(monitor.getStatus()).toEqual({ status: "polling", challengeId: "second" });
  });
});
