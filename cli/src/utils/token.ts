import type { StablecoinToken, EvmChain } from "@clw-cash/skills";

const TOKEN_MAP: Record<string, Record<string, StablecoinToken>> = {
  usdt: { polygon: "usdt0_pol", ethereum: "usdt_eth", arbitrum: "usdt_arb" },
  usdc: { polygon: "usdc_pol", ethereum: "usdc_eth", arbitrum: "usdc_arb" },
};

const BTC_NETWORKS = new Set(["onchain", "lightning", "arkade"]);
const EVM_CHAINS = new Set(["polygon", "ethereum", "arbitrum"]);

export type Currency = "btc" | "usdt" | "usdc";
export type Where = "onchain" | "lightning" | "arkade" | "polygon" | "arbitrum" | "ethereum";

export function isValidCurrency(s: string): s is Currency {
  return s === "btc" || s === "usdt" || s === "usdc";
}

export function isValidWhere(s: string): s is Where {
  return BTC_NETWORKS.has(s) || EVM_CHAINS.has(s);
}

export function validateCurrencyWhere(currency: Currency, where: Where): string | null {
  if (currency === "btc" && !BTC_NETWORKS.has(where)) {
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
