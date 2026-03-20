/**
 * MPP (Machine Payments Protocol) types.
 *
 * MPP uses the IETF "Payment" HTTP Authentication Scheme (draft-httpauth-payment-00).
 * See: https://paymentauth.org
 *
 * Protocol flow:
 *   1. Client requests a resource.
 *   2. Server responds 402 with `WWW-Authenticate: Payment id="...", method="...", ...`
 *      The `request` param is base64url-encoded JCS JSON with method-specific payment data.
 *   3. Client pays (e.g., Lightning invoice) and retries with:
 *      `Authorization: Payment <base64url(JCS JSON of {challenge, source?, payload})>`
 *   4. Server verifies and returns the resource.
 *
 * Supported payment methods:
 *   - "lightning": client pays BOLT11 invoice and submits the preimage as proof
 *   - "tempo": Tempo chain (ID 42431) — not yet supported by claw-cash swap infrastructure
 *   - "stripe", "card": not supported (card-based, not BTC)
 */

// ── Challenge (from WWW-Authenticate: Payment header) ──────────────

export interface MppChallenge {
  /** Unique challenge identifier (HMAC-SHA256 of slots, base64url-encoded) */
  id: string;
  /** Protection space identifier (typically the API hostname) */
  realm: string;
  /** Payment method: "lightning", "tempo", "stripe", "card" */
  method: string;
  /** Payment intent: "charge" (one-shot) or "session" (channel) */
  intent: string;
  /** base64url-encoded (no padding) JCS JSON with method-specific payment data */
  request: string;
  /** Optional: RFC3339 expiry timestamp */
  expires?: string;
  /** Optional: human-readable description (display only) */
  description?: string;
  /** Optional: opaque base64url value — must be echoed back in credential */
  opaque?: string;
}

// ── Method-specific request data (decoded from challenge.request) ───

/** Lightning charge request (method="lightning", intent="charge") */
export interface LightningChargeRequest {
  /** Stringified integer satoshis */
  amount: string;
  currency: "sat";
  description?: string;
  methodDetails: {
    /** BOLT11 invoice to pay */
    invoice: string;
  };
}

/** Tempo charge request (method="tempo", intent="charge") */
export interface TempoChargeRequest {
  /** Stringified integer in base units (6 decimals) */
  amount: string;
  /** TIP-20 token contract address */
  currency: string;
  /** Recipient address on Tempo chain */
  recipient: string;
  description?: string;
  externalId?: string;
  methodDetails?: {
    chainId?: number;
    feePayer?: boolean;
    memo?: string;
  };
}

// ── Credential payload (method-specific, included in Authorization header) ─

/** Lightning proof: 32-byte lowercase hex preimage */
export interface LightningChargePayload {
  preimage: string;
}

// ── Credential (client → server in Authorization: Payment header) ───

export interface MppCredential {
  /** Echo of all challenge params from the WWW-Authenticate header */
  challenge: MppChallenge;
  /** Optional payer DID identifier (did:pkh format) */
  source?: string;
  /** Method-specific payment proof */
  payload: LightningChargePayload | Record<string, unknown>;
}

// ── Client configuration ────────────────────────────────────────────

export interface MppClientConfig {
  /** Lightning skill for paying BOLT11 invoices */
  lightning: {
    payInvoice(params: { bolt11: string }): Promise<{ preimage: string }>;
  };
  /** Optional: custom fetch implementation (for testing) */
  fetch?: typeof globalThis.fetch;
}

// ── Result types ────────────────────────────────────────────────────

export interface MppPayResult {
  /** Whether the resource was successfully retrieved */
  ok: boolean;
  /** HTTP status code of the final response */
  status: number;
  /** The response body */
  body: string;
  /** Response headers */
  headers: Record<string, string>;
  /** The credential submitted (if payment was made) */
  proof?: MppCredential;
  /** Lightning payment preimage (if lightning method was used) */
  paymentPreimage?: string;
}
