export interface PaymentParams {
  amount: number;
  token: string;
  chain: string;
  to: string;
}

const VALID_TOKENS = new Set([
  "usdc_pol", "usdc_eth", "usdc_arb",
  "usdt_pol", "usdt_eth", "usdt_arb",
]);

const VALID_CHAINS = new Set(["polygon", "ethereum", "arbitrum"]);

export const CHAIN_IDS: Record<string, number> = {
  polygon: 137,
  ethereum: 1,
  arbitrum: 42161,
};

export const TOKEN_DECIMALS: Record<string, number> = {
  usdc_pol: 6, usdc_eth: 6, usdc_arb: 6,
  usdt_pol: 6, usdt_eth: 6, usdt_arb: 6,
};

export const TOKEN_LABELS: Record<string, string> = {
  usdc_pol: "USDC", usdc_eth: "USDC", usdc_arb: "USDC",
  usdt_pol: "USDT", usdt_eth: "USDT", usdt_arb: "USDT",
};

export const CHAIN_LABELS: Record<string, string> = {
  polygon: "Polygon",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
};

export function parseParams(): PaymentParams {
  const url = new URL(window.location.href);
  const amount = parseFloat(url.searchParams.get("amount") ?? "");
  const token = url.searchParams.get("token") ?? "";
  const chain = url.searchParams.get("chain") ?? "";
  const to = url.searchParams.get("to") ?? "";

  if (isNaN(amount) || amount <= 0) throw new Error("Invalid or missing amount");
  if (!VALID_TOKENS.has(token)) throw new Error(`Invalid token: ${token}`);
  if (!VALID_CHAINS.has(chain)) throw new Error(`Invalid chain: ${chain}`);
  if (!to || to.length < 10) throw new Error("Missing target address");

  return { amount, token, chain, to };
}
