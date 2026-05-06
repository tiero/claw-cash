import {
  Client,
  IdbWalletStorage,
  IdbSwapStorage,
  PERMIT2_ADDRESS,
  type Chain,
  type TokenInfo,
} from "@lendasat/lendaswap-sdk-pure";
import type { PaymentParams } from "./params.js";
import { CHAIN_IDS, TOKEN_DECIMALS } from "./params.js";

let client: Client | null = null;
let tokens: TokenInfo[] | null = null;

const TOKEN_SYMBOLS: Record<string, string[]> = {
  usdc_pol: ["USDC"],
  usdc_eth: ["USDC"],
  usdc_arb: ["USDC"],
  usdt0_pol: ["USDT0", "USDT"],
  usdt_eth: ["USDT"],
  usdt_arb: ["USDT"],
};

const TOKEN_CHAINS: Record<string, Chain> = {
  usdc_pol: "137",
  usdc_eth: "1",
  usdc_arb: "42161",
  usdt0_pol: "137",
  usdt_eth: "1",
  usdt_arb: "42161",
};

async function getClient(): Promise<Client> {
  if (client) return client;
  client = await Client.builder()
    .withSignerStorage(new IdbWalletStorage())
    .withSwapStorage(new IdbSwapStorage())
    .build();
  return client;
}

async function resolveToken(token: string): Promise<TokenInfo> {
  const c = await getClient();
  if (!tokens) {
    const list = await c.getTokens();
    tokens = list.evm_tokens;
  }

  const symbols = TOKEN_SYMBOLS[token];
  const chain = TOKEN_CHAINS[token];
  const info = tokens.find(
    (candidate) =>
      candidate.chain === chain && symbols?.includes(candidate.symbol.toUpperCase())
  );

  if (!info) throw new Error(`Unsupported token: ${token}`);
  return info;
}

/**
 * Create a new swap (legacy flow — only used when swapId is not provided).
 */
export async function createSwap(params: PaymentParams, userAddress: string) {
  const c = await getClient();
  const token = await resolveToken(params.token);
  return c.createEvmToArkadeSwapGeneric({
    targetAddress: params.to,
    tokenAddress: token.token_id,
    evmChainId: CHAIN_IDS[params.chain],
    sourceAmount: BigInt(Math.round(params.amount * 10 ** (TOKEN_DECIMALS[params.token] ?? 6))),
    userAddress,
  });
}

export async function getFundingCallData(swapId: string, token: string) {
  const c = await getClient();
  const chainId = Number(TOKEN_CHAINS[token]);
  const funding = await c.getCoordinatorFundingCallDataPermit2(swapId, chainId);
  return {
    approve: {
      ...funding.approve,
      spender: PERMIT2_ADDRESS,
    },
    createSwap: funding.executeAndCreate,
  };
}

const TERMINAL_STATUSES = new Set([
  "clientredeemed",
  "serverredeemed",
  "clientredeemedandclientrefunded",
  "expired",
  "clientfundedtoolate",
  "clientrefunded",
  "clientfundedserverrefunded",
  "clientrefundedserverfunded",
  "clientrefundedserverrefunded",
  "clientinvalidfunded",
  "serverwontfund",
]);

const SUCCESS_STATUSES = new Set([
  "clientredeemed",
  "serverredeemed",
  "clientredeemedandclientrefunded",
]);

export async function pollSwapStatus(
  swapId: string,
  onUpdate: (status: string, isSuccess: boolean) => void,
  intervalMs = 3000,
  maxAttempts = 200
): Promise<boolean> {
  const c = await getClient();

  for (let i = 0; i < maxAttempts; i++) {
    const data = await c.getSwap(swapId, { updateStorage: true });
    const isSuccess = SUCCESS_STATUSES.has(data.status);
    onUpdate(data.status, isSuccess);
    if (TERMINAL_STATUSES.has(data.status)) return isSuccess;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Swap polling timed out");
}
