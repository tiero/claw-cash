import {
  Client,
  InMemoryWalletStorage,
  InMemorySwapStorage,
} from "@lendasat/lendaswap-sdk-pure";
import type { PaymentParams } from "./params.js";
import { TOKEN_DECIMALS } from "./params.js";

let client: Client | null = null;

async function getClient(): Promise<Client> {
  if (client) return client;
  client = await Client.builder()
    .withSignerStorage(new InMemoryWalletStorage())
    .withSwapStorage(new InMemorySwapStorage())
    .build();
  return client;
}

export async function createSwap(params: PaymentParams, userAddress: string) {
  const c = await getClient();
  const result = await c.createEvmToArkadeSwap({
    sourceChain: params.chain,
    sourceToken: params.token,
    sourceAmount: params.amount,
    targetAddress: params.to,
    userAddress,
  });
  return result;
}

export async function getFundingCallData(swapId: string, token: string) {
  const c = await getClient();
  const decimals = TOKEN_DECIMALS[token] ?? 6;
  return c.getEvmFundingCallData(swapId, decimals);
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
