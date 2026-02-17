import type { StablecoinToken, EvmChain } from "@clw-cash/skills";

const TOKEN_MAP: Record<string, Record<string, StablecoinToken>> = {
  usdt: { polygon: "usdt0_pol", ethereum: "usdt_eth", arbitrum: "usdt_arb" },
  usdc: { polygon: "usdc_pol", ethereum: "usdc_eth", arbitrum: "usdc_arb" },
};

const BTC_NETWORKS = new Set(["onchain", "lightning", "arkade"]);
const EVM_CHAINS = new Set(["polygon", "ethereum", "arbitrum"]);

export type Currency = "btc" | "sats" | "usdt" | "usdc";
export type ResolvedCurrency = "btc" | "usdt" | "usdc";
export type Where = "onchain" | "lightning" | "arkade" | "polygon" | "arbitrum" | "ethereum";

export function isValidCurrency(s: string): s is Currency {
  return s === "btc" || s === "sats" || s === "usdt" || s === "usdc";
}

/** Normalize "sats" → "btc" for internal use */
export function resolveCurrency(c: Currency): ResolvedCurrency {
  return c === "sats" ? "btc" : c;
}

export function satsToBtc(sats: number): number {
  return sats / 1e8;
}

export function btcToSats(btc: number): number {
  return Math.round(btc * 1e8);
}

const MAX_SATS = 21_000_000 * 1e8; // 21M BTC in sats

/** Parse a BTC/sats amount string to satoshis. Both "btc" and "sats" amounts are in satoshis. */
export function parseBtcAmount(amountStr: string, currency: Currency): number | null {
  // Both btc and sats currency treat amount as satoshis
  // Reject non-integer inputs (e.g., "1.5", "abc", leading zeros)
  if (!/^\d+$/.test(amountStr)) return null;
  
  const sats = parseInt(amountStr, 10);
  if (sats <= 0 || sats > MAX_SATS) return null;
  return sats;
}

export function isValidWhere(s: string): s is Where {
  return BTC_NETWORKS.has(s) || EVM_CHAINS.has(s);
}

export function validateCurrencyWhere(currency: Currency | ResolvedCurrency, where: Where): string | null {
  if ((currency === "btc" || currency === "sats") && !BTC_NETWORKS.has(where)) {
    return `btc can only be sent to: onchain, lightning, arkade (got: ${where})`;
  }
  if ((currency === "usdt" || currency === "usdc") && !EVM_CHAINS.has(where)) {
    return `${currency} can only be sent to: polygon, arbitrum, ethereum (got: ${where})`;
  }
  return null;
}

export function toStablecoinToken(currency: string, chain: string): StablecoinToken {
  return TOKEN_MAP[currency]![chain] as StablecoinToken;
}

export function toEvmChain(where: string): EvmChain {
  return where as EvmChain;
}
