import { encodeFunctionData, maxUint256 } from "viem";

export interface FundingCallData {
  approveTo: string;
  approveData: string;
  fundTo: string;
  fundData: string;
}

export interface PaymentParams {
  amount: number;
  token: string;
  chain: string;
  to: string;
  /** Swap status from LendaSwap API */
  status: string;
  /** When present, swap was pre-created by CLI — web only funds it */
  swapId?: string;
  /** Pre-computed EVM funding call data */
  funding?: FundingCallData;
  /** When true, sender must pick the chain — token/chain are empty until selected */
  needsChainSelection?: boolean;
  /** Stablecoin currency (usdc or usdt) for chain selection flow */
  currency?: string;
}

const VALID_TOKENS = new Set([
  "usdc_pol", "usdc_eth", "usdc_arb",
  "usdt0_pol", "usdt_eth", "usdt_arb",
]);

const VALID_CHAINS = new Set(["polygon", "ethereum", "arbitrum"]);

export const CHAIN_IDS: Record<string, number> = {
  polygon: 137,
  ethereum: 1,
  arbitrum: 42161,
};

export const TOKEN_DECIMALS: Record<string, number> = {
  usdc_pol: 6, usdc_eth: 6, usdc_arb: 6,
  usdt0_pol: 6, usdt_eth: 6, usdt_arb: 6,
};

export const TOKEN_LABELS: Record<string, string> = {
  usdc_pol: "USDC", usdc_eth: "USDC", usdc_arb: "USDC",
  usdt0_pol: "USDT0", usdt_eth: "USDT", usdt_arb: "USDT",
};

export const CHAIN_LABELS: Record<string, string> = {
  polygon: "Polygon",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
};

export const CHAIN_COLORS: Record<string, string> = {
  polygon: "#8247e5",
  ethereum: "#627eea",
  arbitrum: "#28a0f0",
};

export const TOKEN_COLORS: Record<string, string> = {
  usdc_pol: "#2775ca", usdc_eth: "#2775ca", usdc_arb: "#2775ca",
  usdt0_pol: "#26a17b", usdt_eth: "#26a17b", usdt_arb: "#26a17b",
};

// Official token logos as inline SVGs (20x20)
const USDC_LOGO = `<svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#2775CA"/><path d="M20.4 18.4c0-2.1-1.3-2.8-3.8-3.1-1.8-.3-2.2-.7-2.2-1.5s.7-1.3 1.8-1.3c1 0 1.6.4 1.9 1.2.1.1.2.2.3.2h1.1c.2 0 .3-.1.3-.3-.3-1.2-1.2-2.1-2.5-2.3v-1.5c0-.2-.1-.3-.3-.3h-1c-.2 0-.3.1-.3.3v1.4c-1.7.3-2.8 1.3-2.8 2.7 0 2 1.2 2.7 3.8 3.1 1.6.3 2.2.7 2.2 1.6 0 .9-.8 1.5-1.9 1.5-1.5 0-2-.6-2.2-1.5 0-.1-.2-.2-.3-.2h-1.2c-.2 0-.3.1-.3.3.3 1.5 1.2 2.3 2.9 2.6v1.5c0 .2.1.3.3.3h1c.2 0 .3-.1.3-.3v-1.5c1.8-.2 2.8-1.3 2.8-2.8z" fill="#fff"/><path d="M12.8 25.2c-4.6-1.6-7-6.6-5.3-11.1 .8-2.3 2.7-4 5-4.8.2-.1.3-.2.3-.4v-1c0-.2-.1-.3-.3-.3-.1 0-.1 0-.2 0C7 9.3 3.6 14.8 5.3 20.1c1 3.1 3.5 5.5 6.6 6.5.2.1.4 0 .4-.2v-1c.1-.1 0-.2-.1-.3l-.1.1h-.3zm6.6-17.5c-.2-.1-.4 0-.4.2v1c0 .2.1.3.3.4 4.6 1.6 7 6.6 5.3 11.1-.8 2.3-2.7 4-5 4.8-.2.1-.3.2-.3.4v1c0 .2.1.3.3.3.1 0 .1 0 .2 0 5.3-1.7 8.2-7.3 6.5-12.6-1-3.1-3.5-5.5-6.6-6.5h-.3z" fill="#fff"/></svg>`;

const USDT_LOGO = `<svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#26A17B"/><path d="M17.9 17.9v-.1c-.1 0-.8-.1-2-.1-1 0-1.7 0-2 .1v.1c-3.6.2-6.3.8-6.3 1.5 0 .8 2.7 1.4 6.3 1.5v4.8h3.9V21c3.6-.2 6.3-.8 6.3-1.5 0-.8-2.6-1.4-6.2-1.6zm0 2.7v-.1c-.3 0-1 .1-1.9.1-1.1 0-1.6-.1-2-.1v.1c-3.2-.1-5.6-.7-5.6-1.2 0-.6 2.4-1.1 5.6-1.2v2c.4 0 1 .1 2 .1.9 0 1.5-.1 1.9-.1v-2c3.2.1 5.6.6 5.6 1.2 0 .5-2.4 1.1-5.6 1.2z" fill="#fff"/><path d="M17.9 16.7v-1.8h5.3V11h-14.4v3.9h5.3v1.8c-3.9.2-6.8.9-6.8 1.8 0 1 2.9 1.7 6.8 1.8v6.5h3.9v-6.5c3.8-.2 6.7-.9 6.7-1.8-.1-1-3-1.6-6.8-1.8z" fill="#fff"/></svg>`;

// USDT0 uses same Tether branding with a "0" badge concept — same green logo
const USDT0_LOGO = USDT_LOGO;

/** Map token ID → logo SVG */
export const TOKEN_LOGOS: Record<string, string> = {
  usdc_pol: USDC_LOGO, usdc_eth: USDC_LOGO, usdc_arb: USDC_LOGO,
  usdt0_pol: USDT0_LOGO, usdt_eth: USDT_LOGO, usdt_arb: USDT_LOGO,
};

/** Map currency name → logo SVG (for chain picker flow before token is resolved) */
export const CURRENCY_LOGOS: Record<string, string> = {
  usdc: USDC_LOGO,
  usdt: USDT_LOGO,
};

/** Derive chain name from LendaSwap token ID (e.g. usdc_pol → polygon) */
const TOKEN_TO_CHAIN: Record<string, string> = {
  usdc_pol: "polygon", usdc_eth: "ethereum", usdc_arb: "arbitrum",
  usdt0_pol: "polygon", usdt_eth: "ethereum", usdt_arb: "arbitrum",
};

/** All supported chains for sender-side chain selection */
export const SUPPORTED_CHAINS = ["polygon", "arbitrum", "ethereum"] as const;

/** Map currency + chain → LendaSwap token ID */
export const CURRENCY_CHAIN_TO_TOKEN: Record<string, Record<string, string>> = {
  usdc: { polygon: "usdc_pol", ethereum: "usdc_eth", arbitrum: "usdc_arb" },
  usdt: { polygon: "usdt0_pol", ethereum: "usdt_eth", arbitrum: "usdt_arb" },
};

/** Statuses where funding has NOT yet happened — safe to show pay button */
const FUNDABLE_STATUSES = new Set([
  "pending",
  "awaiting_funding",
]);

/** Statuses that indicate the swap is already funded or completed */
const FUNDED_STATUSES = new Set([
  "clientfundingseen",
  "clientfunded",
  "serverfunded",
  "processing",
  "clientredeemed",
  "serverredeemed",
  "clientredeemedandclientrefunded",
  "completed",
]);

const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

function buildApproveCallData(tokenAddress: string, spender: string): { to: string; data: string } {
  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [spender as `0x${string}`, maxUint256],
  });
  return { to: tokenAddress, data };
}

export async function parseParams(): Promise<PaymentParams> {
  const url = new URL(window.location.href);

  // New short URL: /pay?id=<swapId> — fetch everything from API proxy
  const id = url.searchParams.get("id");
  if (id) {
    const apiUrl = import.meta.env.VITE_API_URL || "";
    const resp = await fetch(`${apiUrl}/v1/swaps/${encodeURIComponent(id)}`);
    if (!resp.ok) {
      throw new Error(
        resp.status === 404
          ? "Payment link not found or expired"
          : `Failed to load payment data (${resp.status})`
      );
    }
    const swap = await resp.json();

    const token = swap.source_token as string;
    const chain = TOKEN_TO_CHAIN[token] ?? "";
    const status = swap.status as string;

    // Build funding call data from swap response
    let funding: FundingCallData | undefined;
    if (FUNDABLE_STATUSES.has(status) && swap.create_swap_tx && swap.htlc_address_evm && swap.source_token_address) {
      const approve = buildApproveCallData(swap.source_token_address, swap.htlc_address_evm);
      funding = {
        approveTo: approve.to,
        approveData: approve.data,
        fundTo: swap.htlc_address_evm,
        fundData: swap.create_swap_tx,
      };
    }

    return {
      amount: swap.source_amount,
      token,
      chain,
      to: swap.htlc_address_arkade ?? swap.target_address ?? "",
      status,
      swapId: swap.id,
      funding,
    };
  }

  // Legacy: swapId with inline call data in URL (backward compat)
  const swapId = url.searchParams.get("swapId") ?? undefined;
  if (swapId) {
    const amount = parseFloat(url.searchParams.get("amount") ?? "0");
    const token = url.searchParams.get("token") ?? "";
    const chain = url.searchParams.get("chain") ?? "";
    const to = url.searchParams.get("to") ?? "";

    const approveTo = url.searchParams.get("approveTo") ?? "";
    const approveData = url.searchParams.get("approveData") ?? "";
    const fundTo = url.searchParams.get("fundTo") ?? "";
    const fundData = url.searchParams.get("fundData") ?? "";

    if (!approveTo || !approveData || !fundTo || !fundData) {
      throw new Error("Missing funding call data in payment link");
    }

    return {
      amount, token, chain, to, swapId, status: "pending",
      funding: { approveTo, approveData, fundTo, fundData },
    };
  }

  // Chain-selection flow: /pay?amount=10&to=<addr>&currency=usdc
  // Sender picks the chain on the web page
  const currency = url.searchParams.get("currency") ?? "";
  const amount = parseFloat(url.searchParams.get("amount") ?? "");
  const to = url.searchParams.get("to") ?? "";

  if (currency && (currency === "usdc" || currency === "usdt")) {
    if (isNaN(amount) || amount <= 0) throw new Error("Invalid or missing amount");
    if (!to || to.length < 10) throw new Error("Missing target address");
    return {
      amount,
      token: "",
      chain: "",
      to,
      status: "pending",
      needsChainSelection: true,
      currency,
    };
  }

  // Legacy: full params in URL (web creates swap)
  const token = url.searchParams.get("token") ?? "";
  const chain = url.searchParams.get("chain") ?? "";

  if (isNaN(amount) || amount <= 0) throw new Error("Invalid or missing amount");
  if (!VALID_TOKENS.has(token)) throw new Error(`Invalid token: ${token}`);
  if (!VALID_CHAINS.has(chain)) throw new Error(`Invalid chain: ${chain}`);
  if (!to || to.length < 10) throw new Error("Missing target address");

  return { amount, token, chain, to, status: "pending" };
}
