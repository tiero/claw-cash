/**
 * MPP (Machine Payments Protocol) types.
 *
 * MPP is an open protocol for machine-to-machine payments co-authored by
 * Stripe and Tempo.  It uses the HTTP 402 challenge-then-retry pattern:
 *
 *   1. Client requests a resource.
 *   2. Server responds 402 with `MPP-Version` + JSON body containing payment
 *      requirements (amount, currency, recipient, network, optional session).
 *   3. Client pays (BTC→stablecoin swap via claw-cash infrastructure) and
 *      retries with an `MPP-Authorization` header carrying the payment proof.
 *   4. Server verifies and returns the resource.
 *
 * Sessions ("OAuth for money") let the client authorize once and stream
 * payments within defined limits.
 */

// ── Protocol constants ─────────────────────────────────

export const MPP_VERSION = "1";

export const MPP_HEADER_VERSION = "MPP-Version";
export const MPP_HEADER_AUTHORIZATION = "MPP-Authorization";

// ── Payment requirements (server → client on 402) ─────

export interface MppPaymentRequirement {
  /** Unique id for this requirement set */
  id: string;
  /** Payment amount in the smallest unit of the currency (e.g. cents for USD) */
  amount: number;
  /** ISO 4217 currency code — typically "USD" */
  currency: string;
  /** Recipient address on the target network */
  recipient: string;
  /** Network/rail to settle on — e.g. "tempo", "polygon", "ethereum", "base" */
  network: string;
  /** Human-readable description of the resource being purchased */
  description?: string;
  /** Optional: expiry timestamp (ISO 8601) for the payment requirement */
  expires_at?: string;
  /** Optional: session id if the server supports MPP sessions */
  session_id?: string;
}

export interface MppPaymentRequired {
  /** Protocol version */
  version: string;
  /** One or more acceptable payment options */
  requirements: MppPaymentRequirement[];
}

// ── Payment proof (client → server on retry) ───────────

export interface MppPaymentProof {
  /** Protocol version */
  version: string;
  /** The requirement id the client chose to fulfill */
  requirement_id: string;
  /** On-chain transaction id / swap id proving payment */
  tx_id: string;
  /** Network the payment was settled on */
  network: string;
  /** Amount paid (smallest unit) */
  amount: number;
  /** Currency paid */
  currency: string;
  /** Optional session id for session-based payments */
  session_id?: string;
}

// ── Session types ──────────────────────────────────────

export interface MppSession {
  /** Unique session identifier */
  session_id: string;
  /** Maximum total spend in smallest currency unit */
  budget: number;
  /** ISO 4217 currency code */
  currency: string;
  /** Amount already spent in this session */
  spent: number;
  /** Session expiry (ISO 8601) */
  expires_at: string;
}

// ── Client configuration ───────────────────────────────

export interface MppSwapParams {
  targetAddress: string;
  targetToken: string;
  targetChain: string;
  targetAmount: number;
}

export interface MppSwapResult {
  swapId: string;
  status: string;
}

export interface MppClientConfig {
  /** The swap skill for BTC→stablecoin conversions */
  swap: {
    swapBtcToStablecoin(params: MppSwapParams): Promise<MppSwapResult>;
  };
  /** Optional: custom fetch implementation (for testing) */
  fetch?: typeof globalThis.fetch;
}

// ── Result types ───────────────────────────────────────

export interface MppPayResult {
  /** Whether the resource was successfully retrieved */
  ok: boolean;
  /** HTTP status code of the final response */
  status: number;
  /** The response body (resource content) */
  body: string;
  /** Response headers */
  headers: Record<string, string>;
  /** The payment proof that was submitted (if payment was made) */
  proof?: MppPaymentProof;
  /** The swap id from claw-cash (if a BTC→stablecoin swap occurred) */
  swap_id?: string;
}

export interface MppError {
  code: string;
  message: string;
}
