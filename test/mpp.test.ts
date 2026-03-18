import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseMppResponse,
  isMppResponse,
  createMppProof,
  buildMppAuthorizationHeader,
  MppClient,
} from "../cli/src/mpp/client.js";
import type {
  MppPaymentRequired,
  MppPaymentProof,
  MppClientConfig,
} from "../cli/src/mpp/types.js";
import {
  MPP_VERSION,
  MPP_HEADER_VERSION,
  MPP_HEADER_AUTHORIZATION,
} from "../cli/src/mpp/types.js";
import {
  mapMppCurrencyToSwapParams,
} from "../cli/src/mpp/currency.js";

// ─── Helper: create a mock 402 Response ────────────────────────────

function mock402Response(body: MppPaymentRequired): Response {
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "content-type": "application/json",
      [MPP_HEADER_VERSION]: MPP_VERSION,
    },
  });
}

function mock200Response(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

// ─── Mock swap skill ───────────────────────────────────────────────

function createMockSwap() {
  return {
    swapBtcToStablecoin: vi.fn().mockResolvedValue({
      swapId: "swap_abc123",
      status: "completed",
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: protocol parsing
// ─────────────────────────────────────────────────────────────────────

describe("MPP protocol parsing", () => {
  it("isMppResponse detects 402 with MPP-Version header", () => {
    const res = mock402Response({
      version: MPP_VERSION,
      requirements: [{
        id: "req_1",
        amount: 100,
        currency: "USD",
        recipient: "0xabc",
        network: "tempo",
      }],
    });
    expect(isMppResponse(res)).toBe(true);
  });

  it("isMppResponse returns false for regular 402 without MPP-Version", () => {
    const res = new Response("Payment Required", { status: 402 });
    expect(isMppResponse(res)).toBe(false);
  });

  it("isMppResponse returns false for 200 with MPP-Version", () => {
    const res = new Response("ok", {
      status: 200,
      headers: { [MPP_HEADER_VERSION]: MPP_VERSION },
    });
    expect(isMppResponse(res)).toBe(false);
  });

  it("parseMppResponse extracts payment requirements from 402 body", async () => {
    const body: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [
        {
          id: "req_1",
          amount: 500,
          currency: "USD",
          recipient: "0xdeadbeef",
          network: "polygon",
          description: "API call to /v1/data",
        },
        {
          id: "req_2",
          amount: 500,
          currency: "USD",
          recipient: "0xdeadbeef",
          network: "tempo",
        },
      ],
    };
    const res = mock402Response(body);
    const parsed = await parseMppResponse(res);
    expect(parsed.version).toBe(MPP_VERSION);
    expect(parsed.requirements).toHaveLength(2);
    expect(parsed.requirements[0].amount).toBe(500);
    expect(parsed.requirements[0].network).toBe("polygon");
    expect(parsed.requirements[1].network).toBe("tempo");
  });

  it("parseMppResponse throws on invalid JSON", async () => {
    const res = new Response("not json", {
      status: 402,
      headers: {
        "content-type": "application/json",
        [MPP_HEADER_VERSION]: MPP_VERSION,
      },
    });
    await expect(parseMppResponse(res)).rejects.toThrow();
  });

  it("parseMppResponse throws when requirements array is missing", async () => {
    const res = new Response(JSON.stringify({ version: "1" }), {
      status: 402,
      headers: {
        "content-type": "application/json",
        [MPP_HEADER_VERSION]: MPP_VERSION,
      },
    });
    await expect(parseMppResponse(res)).rejects.toThrow("requirements");
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: payment proof creation
// ─────────────────────────────────────────────────────────────────────

describe("MPP payment proof", () => {
  it("createMppProof builds a valid proof object", () => {
    const proof = createMppProof({
      requirement_id: "req_1",
      tx_id: "0xtx123",
      network: "polygon",
      amount: 500,
      currency: "USD",
    });
    expect(proof.version).toBe(MPP_VERSION);
    expect(proof.requirement_id).toBe("req_1");
    expect(proof.tx_id).toBe("0xtx123");
    expect(proof.network).toBe("polygon");
    expect(proof.amount).toBe(500);
    expect(proof.currency).toBe("USD");
  });

  it("createMppProof includes session_id when provided", () => {
    const proof = createMppProof({
      requirement_id: "req_1",
      tx_id: "0xtx123",
      network: "polygon",
      amount: 500,
      currency: "USD",
      session_id: "sess_abc",
    });
    expect(proof.session_id).toBe("sess_abc");
  });

  it("buildMppAuthorizationHeader encodes proof as base64 JSON", () => {
    const proof: MppPaymentProof = {
      version: MPP_VERSION,
      requirement_id: "req_1",
      tx_id: "0xtx123",
      network: "polygon",
      amount: 500,
      currency: "USD",
    };
    const header = buildMppAuthorizationHeader(proof);
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    expect(decoded.requirement_id).toBe("req_1");
    expect(decoded.tx_id).toBe("0xtx123");
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: currency mapping (MPP → claw-cash swap params)
// ─────────────────────────────────────────────────────────────────────

describe("MPP currency mapping", () => {
  it("maps USD on polygon to usdc_pol", () => {
    const params = mapMppCurrencyToSwapParams("USD", "polygon", "0xrecipient", 1000);
    expect(params.targetToken).toBe("usdc_pol");
    expect(params.targetChain).toBe("polygon");
    expect(params.targetAddress).toBe("0xrecipient");
    // 1000 cents = $10.00
    expect(params.targetAmount).toBe(10);
  });

  it("maps USD on ethereum to usdc_eth", () => {
    const params = mapMppCurrencyToSwapParams("USD", "ethereum", "0xrecipient", 500);
    expect(params.targetToken).toBe("usdc_eth");
    expect(params.targetChain).toBe("ethereum");
    expect(params.targetAmount).toBe(5);
  });

  it("maps USD on arbitrum to usdc_arb", () => {
    const params = mapMppCurrencyToSwapParams("USD", "arbitrum", "0xrecipient", 250);
    expect(params.targetToken).toBe("usdc_arb");
    expect(params.targetChain).toBe("arbitrum");
    expect(params.targetAmount).toBe(2.5);
  });

  it("maps USD on tempo to usdc_pol (default bridge)", () => {
    const params = mapMppCurrencyToSwapParams("USD", "tempo", "0xrecipient", 100);
    expect(params.targetToken).toBe("usdc_pol");
    expect(params.targetChain).toBe("polygon");
    expect(params.targetAmount).toBe(1);
  });

  it("maps USDC on polygon to usdc_pol (no cents conversion)", () => {
    const params = mapMppCurrencyToSwapParams("USDC", "polygon", "0xrecipient", 10);
    expect(params.targetToken).toBe("usdc_pol");
    expect(params.targetChain).toBe("polygon");
    expect(params.targetAmount).toBe(10);
  });

  it("maps USDT on polygon to usdt0_pol", () => {
    const params = mapMppCurrencyToSwapParams("USDT", "polygon", "0xrecipient", 10);
    expect(params.targetToken).toBe("usdt0_pol");
    expect(params.targetChain).toBe("polygon");
    expect(params.targetAmount).toBe(10);
  });

  it("throws for unsupported network", () => {
    expect(() =>
      mapMppCurrencyToSwapParams("USD", "solana", "0xrecipient", 100)
    ).toThrow("Unsupported MPP network");
  });

  it("throws for unsupported currency", () => {
    expect(() =>
      mapMppCurrencyToSwapParams("EUR", "polygon", "0xrecipient", 100)
    ).toThrow("Unsupported MPP currency");
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Integration tests: MppClient end-to-end flow
// ─────────────────────────────────────────────────────────────────────

describe("MppClient", () => {
  let mockSwap: ReturnType<typeof createMockSwap>;
  let client: MppClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSwap = createMockSwap();
    mockFetch = vi.fn();
    client = new MppClient({
      swap: mockSwap,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });
  });

  it("passes through non-402 responses without payment", async () => {
    mockFetch.mockResolvedValue(mock200Response("hello world"));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe("hello world");
    expect(result.proof).toBeUndefined();
    expect(mockSwap.swapBtcToStablecoin).not.toHaveBeenCalled();
  });

  it("handles MPP 402 → swap → retry → 200 flow", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [{
        id: "req_001",
        amount: 100,
        currency: "USD",
        recipient: "0xmerchant",
        network: "polygon",
        description: "API call",
      }],
    };

    // First call returns 402, second call returns 200
    mockFetch
      .mockResolvedValueOnce(mock402Response(paymentReq))
      .mockResolvedValueOnce(mock200Response('{"data":"secret"}'));

    const result = await client.pay("https://api.example.com/paid-resource");

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"data":"secret"}');
    expect(result.swap_id).toBe("swap_abc123");
    expect(result.proof).toBeDefined();
    expect(result.proof!.requirement_id).toBe("req_001");
    expect(result.proof!.network).toBe("polygon");

    // Verify swap was called with correct params
    expect(mockSwap.swapBtcToStablecoin).toHaveBeenCalledWith({
      targetAddress: "0xmerchant",
      targetToken: "usdc_pol",
      targetChain: "polygon",
      targetAmount: 1, // 100 cents = $1
    });

    // Verify second request has MPP-Authorization header
    const secondCall = mockFetch.mock.calls[1];
    const headers = secondCall[1]?.headers as Record<string, string>;
    expect(headers[MPP_HEADER_AUTHORIZATION]).toBeDefined();

    // Decode the authorization header
    const proof = JSON.parse(
      Buffer.from(headers[MPP_HEADER_AUTHORIZATION], "base64").toString("utf-8")
    );
    expect(proof.version).toBe(MPP_VERSION);
    expect(proof.requirement_id).toBe("req_001");
    expect(proof.tx_id).toBe("swap_abc123");
  });

  it("forwards original request headers on retry", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [{
        id: "req_002",
        amount: 50,
        currency: "USD",
        recipient: "0xmerchant",
        network: "polygon",
      }],
    };

    mockFetch
      .mockResolvedValueOnce(mock402Response(paymentReq))
      .mockResolvedValueOnce(mock200Response("ok"));

    await client.pay("https://api.example.com/resource", {
      method: "POST",
      headers: { "X-Custom": "value123", "Content-Type": "application/json" },
      body: '{"query":"test"}',
    });

    // Second call should preserve original headers + add MPP-Authorization
    const secondCall = mockFetch.mock.calls[1];
    const headers = secondCall[1]?.headers as Record<string, string>;
    expect(headers["X-Custom"]).toBe("value123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers[MPP_HEADER_AUTHORIZATION]).toBeDefined();
    expect(secondCall[1]?.body).toBe('{"query":"test"}');
  });

  it("prefers the first supported network in requirements", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [
        {
          id: "req_base",
          amount: 100,
          currency: "USD",
          recipient: "0xmerchant",
          network: "base", // unsupported by claw-cash
        },
        {
          id: "req_poly",
          amount: 100,
          currency: "USD",
          recipient: "0xmerchant",
          network: "polygon", // supported
        },
      ],
    };

    mockFetch
      .mockResolvedValueOnce(mock402Response(paymentReq))
      .mockResolvedValueOnce(mock200Response("ok"));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.proof!.requirement_id).toBe("req_poly");
  });

  it("throws when no supported payment requirement is found", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [{
        id: "req_sol",
        amount: 100,
        currency: "USD",
        recipient: "sol123",
        network: "solana",
      }],
    };

    mockFetch.mockResolvedValueOnce(mock402Response(paymentReq));

    await expect(client.pay("https://api.example.com/resource"))
      .rejects.toThrow("No supported payment requirement");
  });

  it("throws when swap fails", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [{
        id: "req_001",
        amount: 100,
        currency: "USD",
        recipient: "0xmerchant",
        network: "polygon",
      }],
    };

    mockFetch.mockResolvedValueOnce(mock402Response(paymentReq));
    mockSwap.swapBtcToStablecoin.mockRejectedValueOnce(new Error("Insufficient BTC balance"));

    await expect(client.pay("https://api.example.com/resource"))
      .rejects.toThrow("Insufficient BTC balance");
  });

  it("throws when retry after payment still fails", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [{
        id: "req_001",
        amount: 100,
        currency: "USD",
        recipient: "0xmerchant",
        network: "polygon",
      }],
    };

    mockFetch
      .mockResolvedValueOnce(mock402Response(paymentReq))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("handles session-based payment requirements", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [{
        id: "req_sess",
        amount: 50,
        currency: "USD",
        recipient: "0xmerchant",
        network: "polygon",
        session_id: "sess_xyz",
      }],
    };

    mockFetch
      .mockResolvedValueOnce(mock402Response(paymentReq))
      .mockResolvedValueOnce(mock200Response("session data"));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.ok).toBe(true);
    expect(result.proof!.session_id).toBe("sess_xyz");
  });

  it("skips expired requirements and picks a valid one", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [
        {
          id: "req_expired",
          amount: 100,
          currency: "USD",
          recipient: "0xmerchant",
          network: "polygon",
          expires_at: "2020-01-01T00:00:00Z", // long expired
        },
        {
          id: "req_valid",
          amount: 100,
          currency: "USD",
          recipient: "0xmerchant",
          network: "polygon",
          expires_at: new Date(Date.now() + 3600_000).toISOString(), // 1h from now
        },
      ],
    };

    mockFetch
      .mockResolvedValueOnce(mock402Response(paymentReq))
      .mockResolvedValueOnce(mock200Response("ok"));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.proof!.requirement_id).toBe("req_valid");
  });

  it("throws when all requirements are expired", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [{
        id: "req_expired",
        amount: 100,
        currency: "USD",
        recipient: "0xmerchant",
        network: "polygon",
        expires_at: "2020-01-01T00:00:00Z",
      }],
    };

    mockFetch.mockResolvedValueOnce(mock402Response(paymentReq));

    await expect(client.pay("https://api.example.com/resource"))
      .rejects.toThrow("No supported payment requirement");
  });

  it("handles non-MPP 402 responses (passes through)", async () => {
    // A regular 402 without MPP-Version header
    const res = new Response("Please subscribe", { status: 402 });
    mockFetch.mockResolvedValueOnce(res);

    const result = await client.pay("https://api.example.com/resource");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(402);
    expect(result.proof).toBeUndefined();
    expect(mockSwap.swapBtcToStablecoin).not.toHaveBeenCalled();
  });

  it("handles USDC-denominated requirements without cents conversion", async () => {
    const paymentReq: MppPaymentRequired = {
      version: MPP_VERSION,
      requirements: [{
        id: "req_usdc",
        amount: 5,
        currency: "USDC",
        recipient: "0xmerchant",
        network: "polygon",
      }],
    };

    mockFetch
      .mockResolvedValueOnce(mock402Response(paymentReq))
      .mockResolvedValueOnce(mock200Response("ok"));

    await client.pay("https://api.example.com/resource");

    expect(mockSwap.swapBtcToStablecoin).toHaveBeenCalledWith({
      targetAddress: "0xmerchant",
      targetToken: "usdc_pol",
      targetChain: "polygon",
      targetAmount: 5, // USDC amount is direct, no cents conversion
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: handlePay command
// ─────────────────────────────────────────────────────────────────────

describe("handlePay argument parsing", () => {
  // These test the URL validation logic used by the pay command
  it("validates URL format", () => {
    expect(() => new URL("https://api.example.com/resource")).not.toThrow();
    expect(() => new URL("not-a-url")).toThrow();
  });

  it("accepts http and https URLs", () => {
    const https = new URL("https://api.example.com");
    const http = new URL("http://localhost:3000");
    expect(https.protocol).toBe("https:");
    expect(http.protocol).toBe("http:");
  });
});
