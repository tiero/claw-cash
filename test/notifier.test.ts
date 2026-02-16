import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebhookRegistry, type SwapEvent, type SwapEventType } from "../cli/src/notifier.js";

function makeEvent(overrides?: Partial<SwapEvent>): SwapEvent {
  return {
    event: "swap.claimed",
    swapId: "abc12345-dead-beef",
    status: "completed",
    direction: "btc_to_stablecoin",
    sourceAmount: 100000,
    sourceToken: "btc_arkade",
    targetAmount: 10.5,
    targetToken: "usdc_pol",
    message: "Swap abc12345… claimed",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("WebhookRegistry", () => {
  let registry: WebhookRegistry;

  beforeEach(() => {
    registry = new WebhookRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a webhook and returns id, url, events", () => {
    const reg = registry.register("https://example.com/hook", ["swap.claimed"]);
    expect(reg.id).toBeDefined();
    expect(reg.url).toBe("https://example.com/hook");
    expect(reg.events).toEqual(["swap.claimed"]);
  });

  it("filters out invalid events", () => {
    const reg = registry.register("https://example.com/hook", [
      "swap.claimed",
      "swap.invalid" as SwapEventType,
    ]);
    expect(reg.events).toEqual(["swap.claimed"]);
  });

  it("throws when no valid events provided", () => {
    expect(() =>
      registry.register("https://example.com/hook", ["bad" as SwapEventType])
    ).toThrow("No valid events");
  });

  it("lists registered webhooks", () => {
    registry.register("https://a.com", ["swap.claimed"]);
    registry.register("https://b.com", ["swap.refunded"]);
    expect(registry.list()).toHaveLength(2);
  });

  it("unregisters a webhook by id", () => {
    const reg = registry.register("https://a.com", ["swap.claimed"]);
    expect(registry.unregister(reg.id)).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it("returns false when unregistering unknown id", () => {
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  it("dispatches event to matching webhooks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    registry.register("https://a.com/hook", ["swap.claimed"]);
    registry.register("https://b.com/hook", ["swap.refunded"]);

    const event = makeEvent({ event: "swap.claimed" });
    registry.dispatch(event);

    // Let promises settle
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://a.com/hook",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      })
    );
  });

  it("dispatches to multiple matching webhooks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    registry.register("https://a.com/hook", ["swap.claimed"]);
    registry.register("https://b.com/hook", ["swap.claimed", "swap.failed"]);

    registry.dispatch(makeEvent({ event: "swap.claimed" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("does not dispatch to non-matching webhooks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    registry.register("https://a.com/hook", ["swap.refunded"]);

    registry.dispatch(makeEvent({ event: "swap.claimed" }));

    // Give time for any potential calls
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs error but does not throw when webhook fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    registry.register("https://a.com/hook", ["swap.failed"]);
    registry.dispatch(makeEvent({ event: "swap.failed" }));

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("network down")
      );
    });
  });
});
