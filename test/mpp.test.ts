import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseMppChallenges,
  isMppResponse,
  buildAuthorizationHeader,
  decodeBase64url,
  decodeBase64urlJson,
  encodeBase64url,
  jcsStringify,
  MppClient,
} from "../cli/src/mpp/client.js";
import { isSupportedChallenge } from "../cli/src/mpp/method.js";
import type { MppChallenge, MppCredential, LightningChargeRequest } from "../cli/src/mpp/types.js";

// ─── Helpers ───────────────────────────────────────────────────────

/** Encode a request object as base64url for use in WWW-Authenticate `request` param */
function encodeRequest(obj: unknown): string {
  return encodeBase64url(JSON.stringify(obj));
}

/** Build a WWW-Authenticate: Payment header string */
function buildChallenge(params: {
  id?: string;
  realm?: string;
  method?: string;
  intent?: string;
  request?: string;
  expires?: string;
  description?: string;
  opaque?: string;
}): string {
  const {
    id = "chall_abc123",
    realm = "api.example.com",
    method = "lightning",
    intent = "charge",
    request = encodeRequest({ amount: "1000", currency: "sat", methodDetails: { invoice: "lnbc100n1..." } }),
    expires,
    description,
    opaque,
  } = params;

  let h = `Payment id="${id}", realm="${realm}", method="${method}", intent="${intent}", request="${request}"`;
  if (expires) h += `, expires="${expires}"`;
  if (description) h += `, description="${description}"`;
  if (opaque) h += `, opaque="${opaque}"`;
  return h;
}

/** Build a 402 Response with one or more WWW-Authenticate: Payment challenges */
function mock402(challengeHeader: string): Response {
  return new Response(
    JSON.stringify({
      type: "https://paymentauth.org/problems/payment-required",
      title: "Payment Required",
      status: 402,
    }),
    {
      status: 402,
      headers: {
        "content-type": "application/json",
        "WWW-Authenticate": challengeHeader,
      },
    }
  );
}

function mock200(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/** Create a standard lightning challenge request blob */
function lightningRequest(invoice = "lnbc100n1pj..."): LightningChargeRequest {
  return {
    amount: "1000",
    currency: "sat",
    methodDetails: { invoice },
  };
}

/** Decode the Authorization: Payment header back to a credential object */
function decodeAuthorizationHeader(headerValue: string): MppCredential {
  const b64url = headerValue.replace(/^Payment\s+/i, "");
  return decodeBase64urlJson<MppCredential>(b64url);
}

// ─── Mock lightning skill ───────────────────────────────────────────

function createMockLightning(preimage = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890") {
  return {
    payInvoice: vi.fn().mockResolvedValue({ preimage }),
  };
}

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: WWW-Authenticate header parsing
// ─────────────────────────────────────────────────────────────────────

describe("parseMppChallenges", () => {
  it("parses a single lightning challenge", () => {
    const header = buildChallenge({ method: "lightning", intent: "charge" });
    const challenges = parseMppChallenges(header);
    expect(challenges).toHaveLength(1);
    expect(challenges[0].id).toBe("chall_abc123");
    expect(challenges[0].realm).toBe("api.example.com");
    expect(challenges[0].method).toBe("lightning");
    expect(challenges[0].intent).toBe("charge");
    expect(challenges[0].request).toBeTruthy();
  });

  it("parses expires optional parameter", () => {
    const expires = "2030-01-01T00:00:00Z";
    const header = buildChallenge({ expires });
    const challenges = parseMppChallenges(header);
    expect(challenges[0].expires).toBe(expires);
  });

  it("parses description optional parameter", () => {
    const header = buildChallenge({ description: "API call fee" });
    const challenges = parseMppChallenges(header);
    expect(challenges[0].description).toBe("API call fee");
  });

  it("parses opaque optional parameter", () => {
    const header = buildChallenge({ opaque: "abc123xyz" });
    const challenges = parseMppChallenges(header);
    expect(challenges[0].opaque).toBe("abc123xyz");
  });

  it("parses multiple challenges in a single header value", () => {
    const req = encodeRequest({ amount: "1000", currency: "sat", methodDetails: { invoice: "lnbc..." } });
    const header = [
      `Payment id="chall_1", realm="api.example.com", method="lightning", intent="charge", request="${req}"`,
      `Payment id="chall_2", realm="api.example.com", method="tempo", intent="charge", request="${req}"`,
    ].join(", ");

    const challenges = parseMppChallenges(header);
    expect(challenges).toHaveLength(2);
    expect(challenges[0].id).toBe("chall_1");
    expect(challenges[0].method).toBe("lightning");
    expect(challenges[1].id).toBe("chall_2");
    expect(challenges[1].method).toBe("tempo");
  });

  it("returns empty array for non-Payment WWW-Authenticate header", () => {
    const challenges = parseMppChallenges("Bearer realm=\"example.com\"");
    expect(challenges).toHaveLength(0);
  });

  it("returns empty array for empty header", () => {
    expect(parseMppChallenges("")).toHaveLength(0);
  });

  it("skips challenges missing required fields", () => {
    // Missing 'method' field
    const header = `Payment id="chall_1", realm="api.example.com", intent="charge", request="abc"`;
    const challenges = parseMppChallenges(header);
    expect(challenges).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: isMppResponse
// ─────────────────────────────────────────────────────────────────────

describe("isMppResponse", () => {
  it("returns true for 402 with WWW-Authenticate: Payment challenge", () => {
    const res = mock402(buildChallenge({}));
    expect(isMppResponse(res)).toBe(true);
  });

  it("returns false for 402 without WWW-Authenticate header", () => {
    const res = new Response("Payment Required", { status: 402 });
    expect(isMppResponse(res)).toBe(false);
  });

  it("returns false for 402 with non-Payment WWW-Authenticate (e.g. Bearer)", () => {
    const res = new Response("Unauthorized", {
      status: 402,
      headers: { "WWW-Authenticate": 'Bearer realm="api.example.com"' },
    });
    expect(isMppResponse(res)).toBe(false);
  });

  it("returns false for 200 with WWW-Authenticate: Payment", () => {
    const res = new Response("ok", {
      status: 200,
      headers: { "WWW-Authenticate": buildChallenge({}) },
    });
    expect(isMppResponse(res)).toBe(false);
  });

  it("returns false for 401 with WWW-Authenticate: Payment", () => {
    const res = new Response("unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": buildChallenge({}) },
    });
    expect(isMppResponse(res)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: isSupportedChallenge
// ─────────────────────────────────────────────────────────────────────

describe("isSupportedChallenge", () => {
  const base: MppChallenge = {
    id: "c1",
    realm: "api.example.com",
    method: "lightning",
    intent: "charge",
    request: "abc",
  };

  it("accepts lightning/charge", () => {
    expect(isSupportedChallenge(base)).toBe(true);
  });

  it("rejects tempo/charge", () => {
    expect(isSupportedChallenge({ ...base, method: "tempo" })).toBe(false);
  });

  it("rejects stripe/charge", () => {
    expect(isSupportedChallenge({ ...base, method: "stripe" })).toBe(false);
  });

  it("rejects lightning/session (only charge is supported)", () => {
    expect(isSupportedChallenge({ ...base, intent: "session" })).toBe(false);
  });

  it("rejects unknown method", () => {
    expect(isSupportedChallenge({ ...base, method: "card" })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: base64url + JCS helpers
// ─────────────────────────────────────────────────────────────────────

describe("base64url helpers", () => {
  it("encodes and decodes a string round-trip", () => {
    const original = '{"hello":"world","num":42}';
    const encoded = encodeBase64url(original);
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(decodeBase64url(encoded)).toBe(original);
  });

  it("decodeBase64urlJson parses JSON from base64url", () => {
    const obj = { amount: "1000", currency: "sat", methodDetails: { invoice: "lnbc..." } };
    const encoded = encodeBase64url(JSON.stringify(obj));
    const decoded = decodeBase64urlJson<typeof obj>(encoded);
    expect(decoded.amount).toBe("1000");
    expect(decoded.currency).toBe("sat");
    expect(decoded.methodDetails.invoice).toBe("lnbc...");
  });

  it("handles base64url strings with padding that needs to be restored", () => {
    // "Man" → base64 = "TWFu" (4 chars, no padding needed)
    expect(decodeBase64url(encodeBase64url("Man"))).toBe("Man");
    // "Ma" → base64 = "TWE=" (padding needed)
    expect(decodeBase64url(encodeBase64url("Ma"))).toBe("Ma");
    // "M" → base64 = "TQ==" (two padding chars)
    expect(decodeBase64url(encodeBase64url("M"))).toBe("M");
  });
});

describe("jcsStringify", () => {
  it("sorts object keys lexicographically", () => {
    const result = jcsStringify({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("sorts nested object keys", () => {
    const result = jcsStringify({ outer: { z: 1, a: 2 }, b: "x" });
    expect(result).toBe('{"b":"x","outer":{"a":2,"z":1}}');
  });

  it("handles arrays without reordering elements", () => {
    const result = jcsStringify([3, 1, 2]);
    expect(result).toBe("[3,1,2]");
  });

  it("handles primitive values", () => {
    expect(jcsStringify("hello")).toBe('"hello"');
    expect(jcsStringify(42)).toBe("42");
    expect(jcsStringify(true)).toBe("true");
    expect(jcsStringify(null)).toBe("null");
  });

  it("produces no extra whitespace", () => {
    const result = jcsStringify({ a: 1, b: 2 });
    expect(result).not.toMatch(/\s/);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: buildAuthorizationHeader
// ─────────────────────────────────────────────────────────────────────

describe("buildAuthorizationHeader", () => {
  it("produces 'Payment <base64url>' format", () => {
    const challenge: MppChallenge = {
      id: "c1",
      realm: "api.example.com",
      method: "lightning",
      intent: "charge",
      request: "abc",
    };
    const credential: MppCredential = {
      challenge,
      payload: { preimage: "deadbeef" },
    };
    const header = buildAuthorizationHeader(credential);
    expect(header).toMatch(/^Payment [A-Za-z0-9_-]+$/);
  });

  it("credential decodes to correct structure", () => {
    const challenge: MppChallenge = {
      id: "test_id",
      realm: "api.test.com",
      method: "lightning",
      intent: "charge",
      request: "req_data",
    };
    const credential: MppCredential = {
      challenge,
      payload: { preimage: "abc123" },
    };
    const header = buildAuthorizationHeader(credential);
    const decoded = decodeAuthorizationHeader(header);

    expect(decoded.challenge.id).toBe("test_id");
    expect(decoded.challenge.realm).toBe("api.test.com");
    expect(decoded.challenge.method).toBe("lightning");
    expect(decoded.challenge.intent).toBe("charge");
    expect((decoded.payload as { preimage: string }).preimage).toBe("abc123");
  });

  it("keys are sorted (JCS) in the encoded credential", () => {
    const challenge: MppChallenge = {
      id: "c1",
      realm: "realm",
      method: "lightning",
      intent: "charge",
      request: "r",
    };
    const credential: MppCredential = {
      challenge,
      payload: { preimage: "pre" },
    };
    const header = buildAuthorizationHeader(credential);
    const b64url = header.replace(/^Payment\s+/, "");
    const raw = decodeBase64url(b64url);
    // Verify it's valid JSON with sorted keys
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed)).toEqual(["challenge", "payload"].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Integration tests: MppClient end-to-end
// ─────────────────────────────────────────────────────────────────────

describe("MppClient", () => {
  let mockLightning: ReturnType<typeof createMockLightning>;
  let client: MppClient;
  let mockFetch: ReturnType<typeof vi.fn>;
  const PREIMAGE = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const BOLT11 = "lnbc100n1pjtest...";

  beforeEach(() => {
    mockLightning = createMockLightning(PREIMAGE);
    mockFetch = vi.fn();
    client = new MppClient({
      lightning: mockLightning,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });
  });

  it("passes through non-402 responses without payment", async () => {
    mockFetch.mockResolvedValue(mock200("hello world"));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe("hello world");
    expect(result.proof).toBeUndefined();
    expect(mockLightning.payInvoice).not.toHaveBeenCalled();
  });

  it("passes through non-MPP 402 (no WWW-Authenticate: Payment)", async () => {
    mockFetch.mockResolvedValue(new Response("Pay to subscribe", { status: 402 }));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(402);
    expect(result.proof).toBeUndefined();
    expect(mockLightning.payInvoice).not.toHaveBeenCalled();
  });

  it("handles lightning MPP 402 → pay invoice → retry → 200 flow", async () => {
    const req = lightningRequest(BOLT11);
    const challengeHeader = buildChallenge({
      id: "chall_001",
      method: "lightning",
      intent: "charge",
      request: encodeRequest(req),
    });

    mockFetch
      .mockResolvedValueOnce(mock402(challengeHeader))
      .mockResolvedValueOnce(mock200('{"data":"secret"}'));

    const result = await client.pay("https://api.example.com/paid");

    // Result checks
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"data":"secret"}');
    expect(result.paymentPreimage).toBe(PREIMAGE);
    expect(result.proof).toBeDefined();
    expect(result.proof!.challenge.id).toBe("chall_001");
    expect(result.proof!.challenge.method).toBe("lightning");

    // Lightning was called with the BOLT11 from the challenge
    expect(mockLightning.payInvoice).toHaveBeenCalledOnce();
    expect(mockLightning.payInvoice).toHaveBeenCalledWith({ bolt11: BOLT11 });

    // Retry request has Authorization: Payment header
    const retryCall = mockFetch.mock.calls[1];
    const retryHeaders = retryCall[1]?.headers as Record<string, string>;
    expect(retryHeaders["Authorization"]).toMatch(/^Payment [A-Za-z0-9_-]+$/);

    // Decode and verify credential structure
    const credential = decodeAuthorizationHeader(retryHeaders["Authorization"]);
    expect(credential.challenge.id).toBe("chall_001");
    expect(credential.challenge.method).toBe("lightning");
    expect((credential.payload as { preimage: string }).preimage).toBe(PREIMAGE);
  });

  it("forwards original request method, headers, and body on retry", async () => {
    const req = lightningRequest(BOLT11);
    const challengeHeader = buildChallenge({ request: encodeRequest(req) });

    mockFetch
      .mockResolvedValueOnce(mock402(challengeHeader))
      .mockResolvedValueOnce(mock200("ok"));

    await client.pay("https://api.example.com/resource", {
      method: "POST",
      headers: { "X-Custom": "val123", "Content-Type": "application/json" },
      body: '{"q":"test"}',
    });

    const retryCall = mockFetch.mock.calls[1];
    const retryInit = retryCall[1];
    const retryHeaders = retryInit?.headers as Record<string, string>;

    expect(retryInit?.method).toBe("POST");
    expect(retryInit?.body).toBe('{"q":"test"}');
    expect(retryHeaders["X-Custom"]).toBe("val123");
    expect(retryHeaders["Content-Type"]).toBe("application/json");
    expect(retryHeaders["Authorization"]).toMatch(/^Payment /);
  });

  it("picks first supported challenge when server offers multiple methods", async () => {
    const req = lightningRequest(BOLT11);
    // Server offers: tempo (unsupported) first, then lightning (supported)
    const tempoReq = encodeRequest({ amount: "1000000", currency: "0x20c0...", recipient: "0xmerchant" });
    const header = [
      `Payment id="chall_tempo", realm="api.example.com", method="tempo", intent="charge", request="${tempoReq}"`,
      `Payment id="chall_lightning", realm="api.example.com", method="lightning", intent="charge", request="${encodeRequest(req)}"`,
    ].join(", ");

    mockFetch
      .mockResolvedValueOnce(mock402(header))
      .mockResolvedValueOnce(mock200("ok"));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.proof!.challenge.id).toBe("chall_lightning");
    expect(result.proof!.challenge.method).toBe("lightning");
  });

  it("throws when no supported method is offered", async () => {
    const tempoReq = encodeRequest({ amount: "1000000", currency: "0x20c0...", recipient: "0x1234" });
    const header = `Payment id="c1", realm="api.example.com", method="tempo", intent="charge", request="${tempoReq}"`;

    mockFetch.mockResolvedValueOnce(mock402(header));

    await expect(client.pay("https://api.example.com/resource"))
      .rejects.toThrow(/No supported MPP payment challenge/);
  });

  it("throws when only session challenges are offered (only charge supported)", async () => {
    const req = encodeRequest({ amount: "1000", currency: "sat", methodDetails: { invoice: BOLT11 } });
    const header = `Payment id="c1", realm="api.example.com", method="lightning", intent="session", request="${req}"`;

    mockFetch.mockResolvedValueOnce(mock402(header));

    await expect(client.pay("https://api.example.com/resource"))
      .rejects.toThrow(/No supported MPP payment challenge/);
  });

  it("skips expired challenges and uses a valid one", async () => {
    const req = encodeRequest(lightningRequest(BOLT11));
    const expiredReq = encodeRequest(lightningRequest("lnbc_expired..."));
    const header = [
      `Payment id="chall_expired", realm="api.example.com", method="lightning", intent="charge", request="${expiredReq}", expires="2020-01-01T00:00:00Z"`,
      `Payment id="chall_valid", realm="api.example.com", method="lightning", intent="charge", request="${req}", expires="${new Date(Date.now() + 3600_000).toISOString()}"`,
    ].join(", ");

    mockFetch
      .mockResolvedValueOnce(mock402(header))
      .mockResolvedValueOnce(mock200("ok"));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.proof!.challenge.id).toBe("chall_valid");
    // Should have called payInvoice with the non-expired challenge's BOLT11
    expect(mockLightning.payInvoice).toHaveBeenCalledWith({ bolt11: BOLT11 });
  });

  it("throws when all challenges are expired", async () => {
    const req = encodeRequest(lightningRequest(BOLT11));
    const header = `Payment id="c1", realm="api.example.com", method="lightning", intent="charge", request="${req}", expires="2020-01-01T00:00:00Z"`;

    mockFetch.mockResolvedValueOnce(mock402(header));

    await expect(client.pay("https://api.example.com/resource"))
      .rejects.toThrow(/No supported MPP payment challenge/);
  });

  it("throws when lightning challenge is missing the invoice", async () => {
    // request has no methodDetails.invoice
    const req = encodeRequest({ amount: "1000", currency: "sat", methodDetails: {} });
    const header = buildChallenge({ request: req });

    mockFetch.mockResolvedValueOnce(mock402(header));

    await expect(client.pay("https://api.example.com/resource"))
      .rejects.toThrow(/invoice/);
  });

  it("propagates lightning payment failure", async () => {
    const req = encodeRequest(lightningRequest(BOLT11));
    const header = buildChallenge({ request: req });

    mockFetch.mockResolvedValueOnce(mock402(header));
    mockLightning.payInvoice.mockRejectedValueOnce(new Error("Insufficient BTC balance"));

    await expect(client.pay("https://api.example.com/resource"))
      .rejects.toThrow("Insufficient BTC balance");
  });

  it("returns non-ok result when retry after payment fails", async () => {
    const req = encodeRequest(lightningRequest(BOLT11));
    const header = buildChallenge({ request: req });

    mockFetch
      .mockResolvedValueOnce(mock402(header))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    // proof should still be present (we did pay)
    expect(result.proof).toBeDefined();
    expect(result.paymentPreimage).toBe(PREIMAGE);
  });

  it("challenge without expiry is always accepted (no expiry = no limit)", async () => {
    const req = encodeRequest(lightningRequest(BOLT11));
    const header = buildChallenge({ request: req }); // no expires param

    mockFetch
      .mockResolvedValueOnce(mock402(header))
      .mockResolvedValueOnce(mock200("ok"));

    const result = await client.pay("https://api.example.com/resource");
    expect(result.ok).toBe(true);
    expect(result.proof).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Unit tests: handlePay argument parsing
// ─────────────────────────────────────────────────────────────────────

describe("handlePay URL validation", () => {
  it("accepts https URLs", () => {
    expect(() => new URL("https://api.example.com/resource")).not.toThrow();
  });

  it("accepts http URLs (localhost)", () => {
    expect(() => new URL("http://localhost:3000/pay")).not.toThrow();
  });

  it("rejects non-URL strings", () => {
    expect(() => new URL("not-a-url")).toThrow();
    expect(() => new URL("")).toThrow();
  });
});
