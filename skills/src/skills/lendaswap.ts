import type { Wallet } from "@arkade-os/sdk";
import {
  Client,
  InMemoryWalletStorage,
  InMemorySwapStorage,
  Asset,
  type WalletStorage,
  type SwapStorage as LendaSwapStorage,
  type SwapStatus as LendaSwapStatus,
  type GetSwapResponse,
} from "@lendasat/lendaswap-sdk-pure";
import type {
  StablecoinSwapSkill,
  StablecoinToken,
  BtcToStablecoinParams,
  StablecoinToBtcParams,
  StablecoinSwapResult,
  StablecoinSwapInfo,
  StablecoinSwapStatus,
  StablecoinQuote,
  StablecoinPair,
  EvmFundingCallData,
  EvmRefundCallData,
  ClaimSwapResult,
  RefundSwapResult,
} from "./types.js";

export const TOKEN_DECIMALS: Record<string, number> = {
  usdc_pol: 6,
  usdc_eth: 6,
  usdc_arb: 6,
  usdt0_pol: 6,
  usdt_eth: 6,
  usdt_arb: 6,
};

/** Maps StablecoinToken IDs to their Asset (chain + contract address). */
const TOKEN_ASSET_MAP: Record<string, { chain: string; tokenId: string }> = {
  usdc_pol: Asset.USDC_POLYGON,
  usdc_eth: Asset.USDC_ETHEREUM,
  usdc_arb: Asset.USDC_ARBITRUM,
  usdt0_pol: Asset.USDT_POLYGON,
  usdt_eth: Asset.USDT_ETHEREUM,
  usdt_arb: Asset.USDT_ARBITRUM,
};

/** Maps EvmChain names to numeric chain IDs. */
const CHAIN_ID_MAP: Record<string, number> = {
  polygon: 137,
  ethereum: 1,
  arbitrum: 42161,
  "137": 137,
  "1": 1,
  "42161": 42161,
};

function resolveTokenAsset(token: string): { chain: string; tokenId: string } {
  const asset = TOKEN_ASSET_MAP[token];
  if (!asset) throw new Error(`Unknown token: ${token}`);
  return asset;
}

function resolveChainId(chain: string): number {
  const id = CHAIN_ID_MAP[chain.toLowerCase()];
  if (!id) throw new Error(`Unknown chain: ${chain}`);
  return id;
}

export function mapSwapStatus(
  sdkStatus: LendaSwapStatus
): StablecoinSwapStatus {
  switch (sdkStatus) {
    case "pending":
      return "pending";
    case "clientfundingseen":
    case "clientfunded":
      return "funded";
    case "serverfunded":
    case "clientredeeming":
      return "processing";
    case "clientredeemed":
    case "serverredeemed":
    case "clientredeemedandclientrefunded":
      return "completed";
    case "expired":
    case "clientfundedtoolate":
      return "expired";
    case "clientrefunded":
    case "clientfundedserverrefunded":
    case "clientrefundedserverfunded":
    case "clientrefundedserverrefunded":
      return "refunded";
    case "clientinvalidfunded":
      return "failed";
    default:
      return "pending";
  }
}

export function isTerminalStatus(status: StablecoinSwapStatus): boolean {
  return (
    status === "completed" ||
    status === "expired" ||
    status === "refunded" ||
    status === "failed"
  );
}

export interface LendaSwapSkillConfig {
  wallet: Wallet;
  apiKey?: string;
  apiUrl?: string;
  esploraUrl?: string;
  arkadeServerUrl?: string;
  mnemonic?: string;
  referralCode?: string;
  walletStorage?: WalletStorage;
  swapStorage?: LendaSwapStorage;
}

export class LendaSwapSkill implements StablecoinSwapSkill {
  readonly name = "lendaswap";
  readonly description =
    "Swap USDC/USDT from/to Arkade via LendaSwap non-custodial exchange";
  readonly version = "2.0.0";

  private readonly wallet: Wallet;
  private readonly referralCode?: string;
  private readonly config: LendaSwapSkillConfig;
  private client: Client | null = null;

  constructor(config: LendaSwapSkillConfig) {
    this.wallet = config.wallet;
    this.referralCode = config.referralCode;
    this.config = config;
  }

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;

    const builder = Client.builder()
      .withSignerStorage(
        this.config.walletStorage || new InMemoryWalletStorage()
      )
      .withSwapStorage(this.config.swapStorage || new InMemorySwapStorage());

    if (this.config.apiUrl) builder.withBaseUrl(this.config.apiUrl);
    if (this.config.apiKey) builder.withApiKey(this.config.apiKey);
    if (this.config.esploraUrl) builder.withEsploraUrl(this.config.esploraUrl);
    if (this.config.arkadeServerUrl)
      builder.withArkadeServerUrl(this.config.arkadeServerUrl);
    if (this.config.mnemonic) builder.withMnemonic(this.config.mnemonic);

    this.client = await builder.build();
    return this.client;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = await this.getClient();
      const result = await client.healthCheck();
      return result === "ok";
    } catch {
      return false;
    }
  }

  async getMnemonic(): Promise<string> {
    const client = await this.getClient();
    return client.getMnemonic();
  }

  async getVersion(): Promise<{ tag: string; commit_hash: string }> {
    const client = await this.getClient();
    return client.getVersion();
  }

  async getQuoteBtcToStablecoin(
    sourceAmount: number,
    targetToken: StablecoinToken
  ): Promise<StablecoinQuote> {
    const client = await this.getClient();
    const targetAsset = resolveTokenAsset(targetToken);
    const quote = await client.getQuote({
      sourceChain: "Arkade",
      sourceToken: "btc",
      targetChain: targetAsset.chain as "137" | "1" | "42161",
      targetToken: targetAsset.tokenId,
      sourceAmount,
    });

    const rate = parseFloat(quote.exchange_rate);
    const netSats = sourceAmount - quote.protocol_fee - quote.network_fee;
    const targetAmount = (netSats / 1e8) * rate;

    return {
      sourceToken: "btc_arkade",
      targetToken,
      sourceAmount,
      targetAmount,
      exchangeRate: rate,
      fee: {
        amount: quote.protocol_fee + quote.network_fee,
        percentage: quote.protocol_fee_rate * 100,
      },
      expiresAt: new Date(Date.now() + 60_000),
    };
  }

  async getQuoteStablecoinToBtc(
    sourceAmount: number,
    sourceToken: StablecoinToken
  ): Promise<StablecoinQuote> {
    const client = await this.getClient();
    const sourceAsset = resolveTokenAsset(sourceToken);
    const quote = await client.getQuote({
      sourceChain: sourceAsset.chain as "137" | "1" | "42161",
      sourceToken: sourceAsset.tokenId,
      targetChain: "Arkade",
      targetToken: "btc",
      sourceAmount,
    });

    const rate = parseFloat(quote.exchange_rate);
    const grossSats = (sourceAmount / rate) * 1e8;
    const targetAmount = grossSats - quote.protocol_fee - quote.network_fee;

    return {
      sourceToken,
      targetToken: "btc_arkade",
      sourceAmount,
      targetAmount: Math.max(0, Math.floor(targetAmount)),
      exchangeRate: rate,
      fee: {
        amount: quote.protocol_fee + quote.network_fee,
        percentage: quote.protocol_fee_rate * 100,
      },
      expiresAt: new Date(Date.now() + 60_000),
    };
  }

  async swapBtcToStablecoin(
    params: BtcToStablecoinParams
  ): Promise<StablecoinSwapResult> {
    const client = await this.getClient();
    const targetAsset = resolveTokenAsset(params.targetToken);

    const result = await client.createArkadeToEvmSwapGeneric({
      targetAddress: params.targetAddress,
      tokenAddress: targetAsset.tokenId,
      evmChainId: resolveChainId(params.targetChain),
      sourceAmount: params.sourceAmount,
      targetAmount: params.targetAmount != null ? BigInt(params.targetAmount) : undefined,
      referralCode: params.referralCode || this.referralCode,
    });

    const resp = result.response;
    const sourceAmount = Number(resp.source_amount);
    const targetAmount = Number(resp.target_amount);

    const fundingTxid = await this.wallet.sendBitcoin({
      address: resp.btc_vhtlc_address,
      amount: sourceAmount,
    });

    const exchangeRate =
      sourceAmount > 0 && targetAmount > 0
        ? targetAmount / (sourceAmount / 1e8)
        : 0;

    return {
      swapId: resp.id,
      status: "funded",
      sourceAmount,
      targetAmount,
      exchangeRate,
      fee: {
        amount: resp.fee_sats,
        percentage:
          sourceAmount > 0 ? (resp.fee_sats / sourceAmount) * 100 : 0,
      },
      expiresAt: new Date(resp.evm_refund_locktime * 1000),
      paymentDetails: { address: resp.btc_vhtlc_address },
      htlcAddressEvm: resp.evm_htlc_address,
      fundingTxid,
    };
  }

  async swapStablecoinToBtc(
    params: StablecoinToBtcParams
  ): Promise<StablecoinSwapResult> {
    const client = await this.getClient();
    const arkAddress = params.targetAddress || (await this.wallet.getAddress());
    const sourceAsset = resolveTokenAsset(params.sourceToken);

    const result = await client.createEvmToArkadeSwapGeneric({
      tokenAddress: sourceAsset.tokenId,
      evmChainId: resolveChainId(params.sourceChain),
      sourceAmount: BigInt(params.sourceAmount),
      targetAddress: arkAddress,
      userAddress: params.userAddress || "0x0000000000000000000000000000000000000000",
      referralCode: params.referralCode || this.referralCode,
    });

    const resp = result.response;
    const sourceAmount = Number(resp.source_amount);
    const targetAmount = Number(resp.target_amount);

    const exchangeRate =
      sourceAmount > 0 && targetAmount > 0
        ? (sourceAmount / targetAmount) * 1e8
        : 0;

    return {
      swapId: resp.id,
      status: mapSwapStatus(resp.status),
      sourceAmount,
      targetAmount,
      exchangeRate,
      fee: {
        amount: resp.fee_sats,
        percentage:
          sourceAmount > 0 ? (resp.fee_sats / targetAmount) * 100 : 0,
      },
      expiresAt: new Date(resp.evm_refund_locktime * 1000),
      paymentDetails: {
        address: resp.evm_htlc_address,
        callData: resp.source_token.token_id,
      },
      htlcAddressEvm: resp.evm_htlc_address,
    };
  }

  async getSwapStatus(swapId: string): Promise<StablecoinSwapInfo> {
    const client = await this.getClient();
    const data = await client.getSwap(swapId, { updateStorage: true });

    const direction =
      data.direction === "evm_to_arkade"
        ? ("stablecoin_to_btc" as const)
        : ("btc_to_stablecoin" as const);

    const status = mapSwapStatus(data.status);
    const sourceAmount = Number(data.source_amount);
    const targetAmount = Number(data.target_amount);

    const exchangeRate =
      sourceAmount > 0 && targetAmount > 0
        ? direction === "btc_to_stablecoin"
          ? targetAmount / (sourceAmount / 1e8)
          : (sourceAmount / targetAmount) * 1e8
        : 0;

    return {
      id: swapId,
      direction,
      status,
      sourceToken: data.source_token.token_id,
      targetToken: data.target_token.token_id,
      sourceAmount,
      targetAmount,
      exchangeRate,
      createdAt: new Date(data.created_at),
      completedAt: status === "completed" ? new Date() : undefined,
      txid:
        ("evm_claim_txid" in data
          ? (data.evm_claim_txid as string | null)
          : undefined) ?? undefined,
    };
  }

  async getPendingSwaps(): Promise<StablecoinSwapInfo[]> {
    const client = await this.getClient();
    const allSwaps = await client.listAllSwaps();

    const pending: StablecoinSwapInfo[] = [];
    for (const stored of allSwaps) {
      const status = mapSwapStatus(stored.response.status);
      if (!isTerminalStatus(status)) {
        try {
          const info = await this.getSwapStatus(stored.swapId);
          pending.push(info);
        } catch {
          pending.push(this.storedSwapToInfo(stored));
        }
      }
    }
    return pending;
  }

  async getSwapHistory(): Promise<StablecoinSwapInfo[]> {
    const client = await this.getClient();
    const allSwaps = await client.listAllSwaps();

    return allSwaps
      .map((stored) => this.storedSwapToInfo(stored))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getAvailablePairs(): Promise<StablecoinPair[]> {
    const client = await this.getClient();
    const tokens = await client.getTokens();

    const pairs: StablecoinPair[] = [];
    // Generate pairs from BTC tokens to EVM tokens and vice versa
    for (const btcToken of tokens.btc_tokens) {
      for (const evmToken of tokens.evm_tokens) {
        pairs.push({
          from: btcToken.token_id,
          to: evmToken.token_id,
          minAmount: 0,
          maxAmount: 0,
          feePercentage: 0,
        });
        pairs.push({
          from: evmToken.token_id,
          to: btcToken.token_id,
          minAmount: 0,
          maxAmount: 0,
          feePercentage: 0,
        });
      }
    }
    return pairs;
  }

  async claimSwap(swapId: string): Promise<ClaimSwapResult> {
    const client = await this.getClient();
    const result = await client.claim(swapId);

    return {
      success: result.success,
      message: result.message,
      txHash: result.txHash,
      chain: result.chain,
    };
  }

  async refundSwap(
    swapId: string,
    options?: { destinationAddress?: string }
  ): Promise<RefundSwapResult> {
    const client = await this.getClient();
    const data = await client.getSwap(swapId, { updateStorage: true });

    if (data.direction === "evm_to_arkade") {
      return {
        success: false,
        message:
          "This is an EVM→BTC swap. Use getEvmRefundCallData() to get the EVM refund transaction data.",
      };
    }

    let destinationAddress = options?.destinationAddress;
    if (!destinationAddress) {
      if (data.source_token.token_id === "btc") {
        destinationAddress = await this.wallet.getAddress();
      } else {
        destinationAddress = await this.wallet.getBoardingAddress();
      }
    }

    const result = await client.refundSwap(swapId, { destinationAddress: destinationAddress! });

    return {
      success: result.success,
      message: result.message,
      txId: result.txId,
      refundAmount: result.refundAmount
        ? Number(result.refundAmount)
        : undefined,
    };
  }

  async getEvmFundingCallData(
    swapId: string,
    _tokenDecimals: number
  ): Promise<EvmFundingCallData> {
    const client = await this.getClient();
    const swap = await client.getSwap(swapId);
    const chainId = "evm_chain_id" in swap ? (swap.evm_chain_id as number) : 137;
    const data = await client.getCoordinatorFundingCallDataPermit2(swapId, chainId);
    return {
      approve: { to: data.approve.to, data: data.approve.data },
      createSwap: { to: data.executeAndCreate.to, data: data.executeAndCreate.data },
    };
  }

  async getEvmRefundCallData(swapId: string): Promise<EvmRefundCallData> {
    const client = await this.getClient();
    const result = await client.refundSwap(swapId, { collaborative: true });
    if (result.evmRefundData) {
      return {
        to: result.evmRefundData.to,
        data: result.evmRefundData.data,
        timelockExpired: result.evmRefundData.timelockExpired,
        timelockExpiry: result.evmRefundData.timelockExpiry,
      };
    }
    throw new Error(result.message || "No EVM refund data available for this swap");
  }

  getWallet(): Wallet {
    return this.wallet;
  }

  getTokenDecimals(token: StablecoinToken): number {
    return TOKEN_DECIMALS[token] || 6;
  }

  private storedSwapToInfo(stored: {
    swapId: string;
    response: GetSwapResponse;
  }): StablecoinSwapInfo {
    const resp = stored.response;
    const direction =
      resp.direction === "evm_to_arkade"
        ? ("stablecoin_to_btc" as const)
        : ("btc_to_stablecoin" as const);

    const status = mapSwapStatus(resp.status);
    const sourceAmount = Number(resp.source_amount);
    const targetAmount = Number(resp.target_amount);
    const exchangeRate =
      sourceAmount > 0 && targetAmount > 0
        ? direction === "btc_to_stablecoin"
          ? targetAmount / (sourceAmount / 1e8)
          : (sourceAmount / targetAmount) * 1e8
        : 0;

    return {
      id: stored.swapId,
      direction,
      status,
      sourceToken: resp.source_token.token_id,
      targetToken: resp.target_token.token_id,
      sourceAmount,
      targetAmount,
      exchangeRate,
      createdAt: new Date(resp.created_at),
      completedAt: status === "completed" ? new Date() : undefined,
    };
  }
}

export function createLendaSwapSkill(
  wallet: Wallet,
  options?: Partial<Omit<LendaSwapSkillConfig, "wallet">>
): LendaSwapSkill {
  return new LendaSwapSkill({
    wallet,
    ...options,
  });
}
