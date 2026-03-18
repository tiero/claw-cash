/**
 * MPP (Machine Payments Protocol) client for claw-cash.
 *
 * Implements the HTTP 402 challenge-then-retry flow:
 *   1. Fetch the URL
 *   2. If 402 + MPP-Version header → parse payment requirements
 *   3. Pick the first supported requirement
 *   4. Swap BTC→stablecoin via claw-cash infrastructure
 *   5. Retry the request with MPP-Authorization header
 *   6. Return the final response
 */

import type {
  MppPaymentRequired,
  MppPaymentProof,
  MppPayResult,
  MppClientConfig,
} from "./types.js";
import {
  MPP_VERSION,
  MPP_HEADER_VERSION,
  MPP_HEADER_AUTHORIZATION,
} from "./types.js";
import { isSupportedRequirement, mapMppCurrencyToSwapParams } from "./currency.js";

// ── Protocol helpers ───────────────────────────────────────────────

/**
 * Check if a Response is an MPP 402 payment-required response.
 */
export function isMppResponse(res: Response): boolean {
  return res.status === 402 && res.headers.has(MPP_HEADER_VERSION);
}

/**
 * Parse the MPP payment requirements from a 402 response body.
 */
export async function parseMppResponse(res: Response): Promise<MppPaymentRequired> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("MPP: failed to parse 402 response body as JSON");
  }

  const data = body as Record<string, unknown>;
  if (!Array.isArray(data.requirements)) {
    throw new Error("MPP: 402 response missing requirements array");
  }

  return data as unknown as MppPaymentRequired;
}

/**
 * Create an MPP payment proof from swap result data.
 */
export function createMppProof(params: Omit<MppPaymentProof, "version">): MppPaymentProof {
  return {
    version: MPP_VERSION,
    ...params,
  };
}

/**
 * Encode a payment proof as a base64 string for the MPP-Authorization header.
 */
export function buildMppAuthorizationHeader(proof: MppPaymentProof): string {
  return Buffer.from(JSON.stringify(proof), "utf-8").toString("base64");
}

// ── Client ─────────────────────────────────────────────────────────

export class MppClient {
  private swap: MppClientConfig["swap"];
  private fetch: typeof globalThis.fetch;

  constructor(config: MppClientConfig) {
    this.swap = config.swap;
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  /**
   * Fetch a URL, automatically handling MPP 402 payment challenges.
   *
   * If the server returns 402 with MPP headers, the client will:
   * 1. Parse the payment requirements
   * 2. Pick the first requirement that claw-cash can fulfill
   * 3. Swap BTC→stablecoin to pay
   * 4. Retry the request with payment proof
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

    // Parse the MPP payment requirements
    const paymentRequired = await parseMppResponse(res);

    // Find the first requirement we can fulfill (skip expired ones)
    const now = Date.now();
    const requirement = paymentRequired.requirements.find((r) => {
      if (!isSupportedRequirement(r.currency, r.network)) return false;
      if (r.expires_at && new Date(r.expires_at).getTime() <= now) return false;
      return true;
    });

    if (!requirement) {
      const networks = paymentRequired.requirements.map((r) => `${r.currency}/${r.network}`);
      throw new Error(
        `No supported payment requirement found. Server requires: ${networks.join(", ")}. ` +
        `Claw-cash supports: USD/USDC/USDT on polygon, ethereum, arbitrum, tempo.`
      );
    }

    // Swap BTC → stablecoin
    const swapParams = mapMppCurrencyToSwapParams(
      requirement.currency,
      requirement.network,
      requirement.recipient,
      requirement.amount,
    );

    const swapResult = await this.swap.swapBtcToStablecoin(swapParams);

    // Build payment proof
    const proof = createMppProof({
      requirement_id: requirement.id,
      tx_id: swapResult.swapId,
      network: requirement.network,
      amount: requirement.amount,
      currency: requirement.currency,
      session_id: requirement.session_id,
    });

    const authHeader = buildMppAuthorizationHeader(proof);

    // Merge original headers with MPP-Authorization
    const retryHeaders: Record<string, string> = {};
    if (init?.headers) {
      const entries =
        init.headers instanceof Headers
          ? [...init.headers.entries()]
          : Array.isArray(init.headers)
            ? init.headers
            : Object.entries(init.headers);
      for (const [k, v] of entries) {
        retryHeaders[k] = v;
      }
    }
    retryHeaders[MPP_HEADER_AUTHORIZATION] = authHeader;

    // Retry the original request with payment proof
    const retryRes = await this.fetch(url, {
      ...init,
      headers: retryHeaders,
    });

    const retryBody = await retryRes.text();

    return {
      ok: retryRes.ok,
      status: retryRes.status,
      body: retryBody,
      headers: Object.fromEntries(retryRes.headers.entries()),
      proof,
      swap_id: swapResult.swapId,
    };
  }
}
