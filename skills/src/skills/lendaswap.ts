import type { Wallet } from "@arkade-os/sdk";
import {
  Client,
  InMemoryWalletStorage,
  InMemorySwapStorage,
  type WalletStorage,
  type SwapStorage as LendaSwapStorage,
  type SwapStatus as LendaSwapStatus,
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
  usdt_pol: 6,
  usdt_eth: 6,
  usdt_arb: 6,
};

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
    const quote = await client.getQuote(
      "btc_arkade",
      targetToken,
      sourceAmount
    );

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
    const quote = await client.getQuote(
      sourceToken,
      "btc_arkade",
      sourceAmount
    );

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

    const result = await client.createArkadeToEvmSwap({
      targetAddress: params.targetAddress,
      targetToken: params.targetToken,
      targetChain: params.targetChain,
      sourceAmount: params.sourceAmount,
      targetAmount: params.targetAmount,
      referralCode: params.referralCode || this.referralCode,
    });

    const resp = result.response;

    const fundingTxid = await this.wallet.sendBitcoin({
      address: resp.htlc_address_arkade,
      amount: resp.source_amount,
    });

    const exchangeRate =
      resp.source_amount > 0 && resp.target_amount > 0
        ? resp.target_amount / (resp.source_amount / 1e8)
        : 0;

    return {
      swapId: resp.id,
      status: "funded",
      sourceAmount: resp.source_amount,
      targetAmount: resp.target_amount,
      exchangeRate,
      fee: {
        amount: resp.fee_sats,
        percentage:
          resp.source_amount > 0
            ? (resp.fee_sats / resp.source_amount) * 100
            : 0,
      },
      expiresAt: new Date(resp.vhtlc_refund_locktime * 1000),
      paymentDetails: { address: resp.htlc_address_arkade },
      fundingTxid,
    };
  }

  async swapStablecoinToBtc(
    params: StablecoinToBtcParams
  ): Promise<StablecoinSwapResult> {
    const client = await this.getClient();
    const arkAddress = params.targetAddress || (await this.wallet.getAddress());

    const result = await client.createEvmToArkadeSwap({
      sourceChain: params.sourceChain,
      sourceToken: params.sourceToken,
      sourceAmount: params.sourceAmount,
      targetAddress: arkAddress,
      userAddress: params.userAddress,
      referralCode: params.referralCode || this.referralCode,
    });

    const resp = result.response;

    const exchangeRate =
      resp.source_amount > 0 && resp.target_amount > 0
        ? (resp.source_amount / resp.target_amount) * 1e8
        : 0;

    return {
      swapId: resp.id,
      status: mapSwapStatus(resp.status),
      sourceAmount: resp.source_amount,
      targetAmount: resp.target_amount,
      exchangeRate,
      fee: {
        amount: resp.fee_sats,
        percentage:
          resp.source_amount > 0
            ? (resp.fee_sats / resp.target_amount) * 100
            : 0,
      },
      expiresAt: new Date(resp.evm_refund_locktime * 1000),
      paymentDetails: {
        address: resp.htlc_address_evm,
        callData: resp.source_token_address,
      },
    };
  }

  async getSwapStatus(swapId: string): Promise<StablecoinSwapInfo> {
    const client = await this.getClient();
    const data = await client.getSwap(swapId, { updateStorage: true });

    const direction =
      data.direction === "evm_to_btc"
        ? ("stablecoin_to_btc" as const)
        : ("btc_to_stablecoin" as const);

    const status = mapSwapStatus(data.status);

    const exchangeRate =
      data.source_amount > 0 && data.target_amount > 0
        ? direction === "btc_to_stablecoin"
          ? data.target_amount / (data.source_amount / 1e8)
          : (data.source_amount / data.target_amount) * 1e8
        : 0;

    return {
      id: swapId,
      direction,
      status,
      sourceToken: data.source_token,
      targetToken: data.target_token,
      sourceAmount: data.source_amount,
      targetAmount: data.target_amount,
      exchangeRate,
      createdAt: new Date(data.created_at),
      completedAt: status === "completed" ? new Date() : undefined,
      txid:
        ("evm_htlc_claim_txid" in data
          ? data.evm_htlc_claim_txid
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
    const pairs = await client.getAssetPairs();

    return pairs.map((pair) => {
      const p = pair as typeof pair & {
        min_amount?: number;
        max_amount?: number;
        fee_rate?: number;
      };
      return {
        from: p.source.token_id,
        to: p.target.token_id,
        minAmount: p.min_amount ?? 0,
        maxAmount: p.max_amount ?? 0,
        feePercentage: p.fee_rate != null ? p.fee_rate * 100 : 0,
      };
    });
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

    if (data.direction === "evm_to_btc") {
      return {
        success: false,
        message:
          "This is an EVM→BTC swap. Use getEvmRefundCallData() to get the EVM refund transaction data.",
      };
    }

    let destinationAddress = options?.destinationAddress;
    if (!destinationAddress) {
      if (data.source_token === "btc_arkade") {
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
    tokenDecimals: number
  ): Promise<EvmFundingCallData> {
    const client = await this.getClient();
    const data = await client.getEvmFundingCallData(swapId, tokenDecimals);
    return {
      approve: { to: data.approve.to, data: data.approve.data },
      createSwap: { to: data.createSwap.to, data: data.createSwap.data },
    };
  }

  async getEvmRefundCallData(swapId: string): Promise<EvmRefundCallData> {
    const client = await this.getClient();
    const data = await client.getEvmRefundCallData(swapId);
    return {
      to: data.to,
      data: data.data,
      timelockExpired: data.timelockExpired,
      timelockExpiry: data.timelockExpiry,
    };
  }

  getWallet(): Wallet {
    return this.wallet;
  }

  getTokenDecimals(token: StablecoinToken): number {
    return TOKEN_DECIMALS[token] || 6;
  }

  private storedSwapToInfo(stored: {
    swapId: string;
    response: {
      status: LendaSwapStatus;
      source_token: string;
      target_token: string;
      source_amount: number;
      target_amount: number;
      created_at: string;
      direction: string;
    };
  }): StablecoinSwapInfo {
    const resp = stored.response;
    const direction =
      resp.direction === "evm_to_btc"
        ? ("stablecoin_to_btc" as const)
        : ("btc_to_stablecoin" as const);

    const status = mapSwapStatus(resp.status);
    const exchangeRate =
      resp.source_amount > 0 && resp.target_amount > 0
        ? direction === "btc_to_stablecoin"
          ? resp.target_amount / (resp.source_amount / 1e8)
          : (resp.source_amount / resp.target_amount) * 1e8
        : 0;

    return {
      id: stored.swapId,
      direction,
      status,
      sourceToken: resp.source_token,
      targetToken: resp.target_token,
      sourceAmount: resp.source_amount,
      targetAmount: resp.target_amount,
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
