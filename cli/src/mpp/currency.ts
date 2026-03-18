/**
 * Maps MPP payment requirement currencies and networks to claw-cash swap
 * parameters.  Agents hold BTC as treasury and swap on-the-fly to stablecoins
 * to pay MPP-enabled services.
 */

import type { StablecoinToken, EvmChain } from "@clw-cash/skills";

// Networks that claw-cash can settle on via LendaSwap
const SUPPORTED_NETWORKS = new Set(["polygon", "ethereum", "arbitrum", "tempo"]);

// Tempo settles via Polygon bridge by default (EVM-compatible, lowest fees)
const TEMPO_BRIDGE_CHAIN: EvmChain = "polygon";

const CHAIN_MAP: Record<string, EvmChain> = {
  polygon: "polygon",
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  tempo: TEMPO_BRIDGE_CHAIN,
};

const USDC_TOKEN_MAP: Record<EvmChain, StablecoinToken> = {
  polygon: "usdc_pol",
  ethereum: "usdc_eth",
  arbitrum: "usdc_arb",
};

const USDT_TOKEN_MAP: Record<EvmChain, StablecoinToken> = {
  polygon: "usdt0_pol",
  ethereum: "usdt_eth",
  arbitrum: "usdt_arb",
};

// Currencies where the amount is in cents (smallest unit)
const CENTS_CURRENCIES = new Set(["USD"]);

export interface SwapParams {
  targetAddress: string;
  targetToken: StablecoinToken;
  targetChain: EvmChain;
  targetAmount: number;
}

/**
 * Returns true if claw-cash can fulfill a payment requirement on the given
 * network and currency.
 */
export function isSupportedRequirement(currency: string, network: string): boolean {
  if (!SUPPORTED_NETWORKS.has(network)) return false;
  const upper = currency.toUpperCase();
  return upper === "USD" || upper === "USDC" || upper === "USDT";
}

/**
 * Map an MPP payment requirement to claw-cash BTC→stablecoin swap parameters.
 *
 * - USD amounts are in cents → converted to dollar units for stablecoin swap
 * - USDC/USDT amounts are in token units (no conversion)
 * - Tempo network is bridged via Polygon (lowest fees)
 */
export function mapMppCurrencyToSwapParams(
  currency: string,
  network: string,
  recipient: string,
  amount: number,
): SwapParams {
  const upper = currency.toUpperCase();
  const chain = CHAIN_MAP[network];

  if (!chain) {
    throw new Error(`Unsupported MPP network: ${network}. Supported: ${[...SUPPORTED_NETWORKS].join(", ")}`);
  }

  let token: StablecoinToken;
  let targetAmount: number;

  switch (upper) {
    case "USD":
    case "USDC": {
      token = USDC_TOKEN_MAP[chain];
      // USD is in cents, USDC is direct
      targetAmount = CENTS_CURRENCIES.has(upper) ? amount / 100 : amount;
      break;
    }
    case "USDT": {
      token = USDT_TOKEN_MAP[chain];
      targetAmount = CENTS_CURRENCIES.has(upper) ? amount / 100 : amount;
      break;
    }
    default:
      throw new Error(`Unsupported MPP currency: ${upper}. Supported: USD, USDC, USDT`);
  }

  return {
    targetAddress: recipient,
    targetToken: token,
    targetChain: chain,
    targetAmount,
  };
}
