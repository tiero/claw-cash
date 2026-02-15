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

export const CHAIN_COLORS: Record<string, string> = {
  polygon: "#8247e5",
  ethereum: "#627eea",
  arbitrum: "#28a0f0",
};

export const TOKEN_COLORS: Record<string, string> = {
  usdc_pol: "#2775ca", usdc_eth: "#2775ca", usdc_arb: "#2775ca",
  usdt_pol: "#26a17b", usdt_eth: "#26a17b", usdt_arb: "#26a17b",
};

/** Derive chain name from LendaSwap token ID (e.g. usdc_pol → polygon) */
const TOKEN_TO_CHAIN: Record<string, string> = {
  usdc_pol: "polygon", usdc_eth: "ethereum", usdc_arb: "arbitrum",
  usdt_pol: "polygon", usdt_eth: "ethereum", usdt_arb: "arbitrum",
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
    const resp = await fetch(`/v1/swaps/${encodeURIComponent(id)}`);
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

  // Legacy: full params in URL (web creates swap)
  const amount = parseFloat(url.searchParams.get("amount") ?? "");
  const token = url.searchParams.get("token") ?? "";
  const chain = url.searchParams.get("chain") ?? "";
  const to = url.searchParams.get("to") ?? "";

  if (isNaN(amount) || amount <= 0) throw new Error("Invalid or missing amount");
  if (!VALID_TOKENS.has(token)) throw new Error(`Invalid token: ${token}`);
  if (!VALID_CHAINS.has(chain)) throw new Error(`Invalid chain: ${chain}`);
  if (!to || to.length < 10) throw new Error("Missing target address");

  return { amount, token, chain, to, status: "pending" };
}
