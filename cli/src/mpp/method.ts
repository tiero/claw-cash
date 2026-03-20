/**
 * MPP payment method support matrix for claw-cash.
 *
 * MPP payment methods (from the spec):
 *   - "lightning" — Bitcoin Lightning Network (BOLT11 invoices + preimage proof) ✅
 *   - "tempo"     — Tempo blockchain (chain ID 42431, TIP-20 tokens) ❌ not in LendaSwap
 *   - "stripe"    — Stripe Payment Tokens (card-based) ❌
 *   - "card"      — Generic card payments ❌
 *
 * claw-cash holds BTC as treasury. The only MPP method currently supported is
 * "lightning": pay the BOLT11 invoice from the challenge, submit the preimage.
 */

import type { MppChallenge } from "./types.js";

/** MPP methods claw-cash can fulfill, in preference order. */
export const SUPPORTED_MPP_METHODS = ["lightning"] as const;

/**
 * Returns true if claw-cash can fulfill this challenge.
 * Currently: method must be "lightning" and intent must be "charge".
 */
export function isSupportedChallenge(challenge: MppChallenge): boolean {
  return (
    (SUPPORTED_MPP_METHODS as readonly string[]).includes(challenge.method) &&
    challenge.intent === "charge"
  );
}
