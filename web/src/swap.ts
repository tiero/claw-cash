import {Asset, Client, IdbSwapStorage, IdbWalletStorage, type EvmSigner} from "@lendasat/lendaswap-sdk-pure";
import type {PaymentParams} from "./params.js";
import {CHAIN_IDS, toSmallestUnit} from "./params.js";
import type { WalletClient, PublicClient } from "viem";

/** Maps token IDs to their Asset (chain + contract address). */
const TOKEN_ASSET_MAP: Record<string, { chain: string; tokenId: string }> = {
  usdc_pol: Asset.USDC_POLYGON,
  usdc_eth: Asset.USDC_ETHEREUM,
  usdc_arb: Asset.USDC_ARBITRUM,
  usdt0_pol: Asset.USDT_POLYGON,
  usdt_eth: Asset.USDT_ETHEREUM,
  usdt_arb: Asset.USDT_ARBITRUM,
};

let client: Client | null = null;

async function getClient(): Promise<Client> {
  if (client) return client;
  client = await Client.builder()
    .withSignerStorage(new IdbWalletStorage())
    .withSwapStorage(new IdbSwapStorage())
    .build();
  return client;
}

/**
 * Create a new swap (legacy flow — only used when swapId is not provided).
 */
export async function createSwap(params: PaymentParams, userAddress: string) {
  const c = await getClient();
  const asset = TOKEN_ASSET_MAP[params.token];
  if (!asset) throw new Error(`Unknown token: ${params.token}`);
  return await c.createEvmToArkadeSwapGeneric({
    tokenAddress: asset.tokenId,
    evmChainId: CHAIN_IDS[params.chain] ?? 137,
    sourceAmount: BigInt(toSmallestUnit(params.amount, params.token)),
    targetAddress: params.to,
    userAddress,
  });
}

/** Build an EvmSigner from viem walletClient/publicClient. */
function buildEvmSigner(
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: `0x${string}`,
): EvmSigner {
  return {
    address,
    chainId: walletClient.chain!.id,
    signTypedData: (td) => walletClient.signTypedData({
      account: address,
      ...td as any,
    }),
    sendTransaction: (tx) => walletClient.sendTransaction({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      gas: tx.gas,
      account: address,
      chain: walletClient.chain!,
    }),
    waitForReceipt: async (hash) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
      return {
        status: receipt.status === "success" ? "success" as const : "reverted" as const,
        blockNumber: receipt.blockNumber,
        transactionHash: receipt.transactionHash,
      };
    },
    getTransaction: async (hash) => {
      const tx = await publicClient.getTransaction({ hash: hash as `0x${string}` });
      return { to: tx.to ?? null, input: tx.input, from: tx.from };
    },
    call: async (tx) => {
      const result = await publicClient.call({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        account: tx.from as `0x${string}` | undefined,
        blockNumber: tx.blockNumber,
      });
      return result.data ?? "0x";
    },
  };
}

/**
 * Fund a swap using the SDK's high-level fundSwap method.
 * Handles Permit2 approval, signing, and submission.
 */
export async function fundSwapWithWallet(
  swapId: string,
  walletClient: WalletClient,
  publicClient: PublicClient,
  address: `0x${string}`,
): Promise<string> {
  const c = await getClient();
  const signer = buildEvmSigner(walletClient, publicClient, address);
  const { txHash } = await c.fundSwap(swapId, signer);
  return txHash;
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
