import { TOKEN_DECIMALS } from "./lendaswap.js";
import type { StablecoinToken } from "./types.js";

const SATS_PER_BTC = 1e8;

/** Convert BTC to satoshis */
export function toSatoshi(btc: number): number {
  return Math.round(btc * SATS_PER_BTC);
}

/** Convert satoshis to BTC */
export function fromSatoshi(sats: number): number {
  return sats / SATS_PER_BTC;
}

/** Convert a human-readable stablecoin amount to its smallest unit (e.g. 2.5 USDC → 2500000) */
export function toSmallestUnit(amount: number, token: StablecoinToken): number {
  const decimals = TOKEN_DECIMALS[token] ?? 6;
  return Math.round(amount * 10 ** decimals);
}

/** Convert from smallest unit back to human-readable (e.g. 2500000 → 2.5 USDC) */
export function fromSmallestUnit(smallest: number, token: StablecoinToken): number {
  const decimals = TOKEN_DECIMALS[token] ?? 6;
  return smallest / 10 ** decimals;
}
