/**
 * MPP (Machine Payments Protocol) client for claw-cash.
 *
 * Implements the IETF "Payment" HTTP Authentication Scheme (draft-httpauth-payment-00).
 *
 * Flow:
 *   1. Fetch the URL
 *   2. If 402 + `WWW-Authenticate: Payment ...` → parse challenge(s)
 *   3. Pick the first supported challenge (currently: method="lightning", intent="charge")
 *   4. Pay the Lightning invoice from the challenge's decoded `request`
 *   5. Build `Authorization: Payment <base64url(JCS credential)>`
 *   6. Retry the original request with Authorization header
 *   7. Return the final response
 */

import type {
  MppChallenge,
  MppCredential,
  MppPayResult,
  MppClientConfig,
  LightningChargeRequest,
} from "./types.js";
import { isSupportedChallenge } from "./method.js";

// ── WWW-Authenticate header parsing ────────────────────────────────

/**
 * Parse all `Payment` challenges from a `WWW-Authenticate` header value.
 *
 * A single header value may contain multiple challenges separated by commas,
 * or the server may return multiple WWW-Authenticate headers (RFC 9110 §11.6.1).
 * We receive whatever `res.headers.get()` returns (which concatenates multiple
 * headers with ", " in the Fetch API).
 *
 * Each challenge looks like:
 *   Payment id="abc", realm="api.example.com", method="lightning", intent="charge",
 *           request="base64url...", expires="2025-01-15T12:05:00Z"
 */
export function parseMppChallenges(headerValue: string): MppChallenge[] {
  const challenges: MppChallenge[] = [];

  // Split on "Payment" keyword boundaries to separate multiple challenges.
  // We match each `Payment ...` segment up to the next `Payment` or end of string.
  const segments = headerValue.split(/(?=\bPayment\s)/i).filter(Boolean);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!/^Payment\s/i.test(trimmed)) continue;

    const params = parseAuthParams(trimmed.slice("Payment".length).trim());

    const id = params["id"];
    const realm = params["realm"];
    const method = params["method"];
    const intent = params["intent"];
    const request = params["request"];

    // id, realm, method, intent, request are required per the spec
    if (!id || !realm || !method || !intent || !request) continue;

    const challenge: MppChallenge = { id, realm, method, intent, request };
    if (params["expires"]) challenge.expires = params["expires"];
    if (params["description"]) challenge.description = params["description"];
    if (params["opaque"]) challenge.opaque = params["opaque"];

    challenges.push(challenge);
  }

  return challenges;
}

/**
 * Parse RFC 9110 auth-params: `key="value"` or `key=token` pairs, comma-separated.
 * Returns a flat string→string map.
 */
function parseAuthParams(input: string): Record<string, string> {
  const params: Record<string, string> = {};
  // Match key="quoted-value" or key=token
  const re = /(\w[\w-]*)=(?:"([^"\\]*)"|([^\s,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    params[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  }
  return params;
}

/**
 * Returns true if the response is a valid MPP 402 challenge
 * (status 402 + at least one parseable `WWW-Authenticate: Payment` challenge).
 */
export function isMppResponse(res: Response): boolean {
  if (res.status !== 402) return false;
  const header = res.headers.get("WWW-Authenticate") ?? "";
  return parseMppChallenges(header).length > 0;
}

// ── Base64url helpers ───────────────────────────────────────────────

/** Decode a base64url (no-padding) string to a UTF-8 string. */
export function decodeBase64url(b64url: string): string {
  // Restore standard base64 padding and characters
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice((b64.length % 4 === 0) ? 4 : b64.length % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}

/** Encode a UTF-8 string as base64url (no padding). */
export function encodeBase64url(s: string): string {
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Decode a base64url-encoded JSON value. */
export function decodeBase64urlJson<T>(b64url: string): T {
  return JSON.parse(decodeBase64url(b64url)) as T;
}

// ── JCS (RFC 8785) canonical JSON ──────────────────────────────────

/**
 * Produce JCS (JSON Canonicalization Scheme) output: keys sorted recursively,
 * no extra whitespace.  Handles the object shapes we control (string, number,
 * boolean, null, nested objects, arrays).  Sufficient for MPP credential
 * serialization; not a general-purpose JCS implementation.
 */
export function jcsStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(jcsStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + jcsStringify(obj[k]));
  return "{" + pairs.join(",") + "}";
}

// ── Credential building ─────────────────────────────────────────────

/**
 * Build the `Authorization: Payment <base64url>` header value for a credential.
 * The credential is JCS-serialized and then base64url-encoded (no padding).
 */
export function buildAuthorizationHeader(credential: MppCredential): string {
  return "Payment " + encodeBase64url(jcsStringify(credential));
}

// ── Client ─────────────────────────────────────────────────────────

export class MppClient {
  private lightning: MppClientConfig["lightning"];
  private fetch: typeof globalThis.fetch;

  constructor(config: MppClientConfig) {
    this.lightning = config.lightning;
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  /**
   * Fetch a URL, automatically handling MPP 402 payment challenges.
   *
   * If the server returns 402 with `WWW-Authenticate: Payment ...` headers:
   *   1. Parse all challenges
   *   2. Pick the first supported one (method="lightning", intent="charge")
   *   3. Decode the BOLT11 invoice from the challenge request
   *   4. Pay the invoice via claw-cash Lightning skill → get preimage
   *   5. Build and submit `Authorization: Payment <credential>`
   *   6. Return the retried response
   *
   * Non-MPP 402 responses (no Payment challenge) are passed through unchanged.
   */
  async pay(url: string, init?: RequestInit): Promise<MppPayResult> {
    const res = await this.fetch(url, init);

    // Not an MPP 402 — pass through as-is
    if (!isMppResponse(res)) {
      const body = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        body,
        headers: Object.fromEntries(res.headers.entries()),
      };
    }

    // Parse the MPP challenges from WWW-Authenticate
    const headerValue = res.headers.get("WWW-Authenticate") ?? "";
    const challenges = parseMppChallenges(headerValue);

    // Find the first challenge we can fulfill (not expired, supported method)
    const now = Date.now();
    const challenge = challenges.find((c) => {
      if (!isSupportedChallenge(c)) return false;
      if (c.expires && new Date(c.expires).getTime() <= now) return false;
      return true;
    });

    if (!challenge) {
      const methods = challenges.map((c) => `${c.method}/${c.intent}`);
      throw new Error(
        `No supported MPP payment challenge found. Server offered: ${methods.join(", ")}. ` +
        `claw-cash supports: lightning/charge.`
      );
    }

    // ── Lightning charge ────────────────────────────────────────────
    if (challenge.method === "lightning") {
      const req = decodeBase64urlJson<LightningChargeRequest>(challenge.request);
      const bolt11 = req.methodDetails?.invoice;
      if (!bolt11) {
        throw new Error("MPP lightning challenge missing methodDetails.invoice");
      }

      const { preimage } = await this.lightning.payInvoice({ bolt11 });

      const credential: MppCredential = {
        challenge,
        payload: { preimage },
      };

      const retryHeaders = mergeHeaders(init?.headers, {
        Authorization: buildAuthorizationHeader(credential),
      });

      const retryRes = await this.fetch(url, { ...init, headers: retryHeaders });
      const retryBody = await retryRes.text();

      return {
        ok: retryRes.ok,
        status: retryRes.status,
        body: retryBody,
        headers: Object.fromEntries(retryRes.headers.entries()),
        proof: credential,
        paymentPreimage: preimage,
      };
    }

    // Should never reach here (isSupportedChallenge guards above)
    throw new Error(`Unsupported MPP method: ${challenge.method}`);
  }
}

// ── Internal helpers ────────────────────────────────────────────────

function mergeHeaders(
  base: RequestInit["headers"] | undefined,
  extra: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (base) {
    const entries =
      base instanceof Headers
        ? [...base.entries()]
        : Array.isArray(base)
          ? (base as [string, string][])
          : Object.entries(base as Record<string, string>);
    for (const [k, v] of entries) {
      result[k] = v;
    }
  }
  return { ...result, ...extra };
}
