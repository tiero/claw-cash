import type { Wallet } from "@arkade-os/sdk";
import {
  Client,
  InMemoryWalletStorage,
  InMemorySwapStorage,
  type WalletStorage,
  type SwapStorage as LendaSwapStorage,
  type SwapStatus as LendaSwapStatus,
  type Chain,
  type TokenInfo,
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

const TOKEN_SYMBOLS: Record<StablecoinToken, string[]> = {
  usdc_pol: ["USDC"],
  usdc_eth: ["USDC"],
  usdc_arb: ["USDC"],
  usdt0_pol: ["USDT0", "USDT"],
  usdt_eth: ["USDT"],
  usdt_arb: ["USDT"],
};

const TOKEN_CHAINS: Record<StablecoinToken, Chain> = {
  usdc_pol: "137",
  usdc_eth: "1",
  usdc_arb: "42161",
  usdt0_pol: "137",
  usdt_eth: "1",
  usdt_arb: "42161",
};

const EVM_CHAIN_IDS = {
  polygon: 137,
  ethereum: 1,
  arbitrum: 42161,
} as const;

function toNumber(value: string | number | bigint | undefined | null): number {
  if (value == null) return 0;
  return Number(value);
}

function tokenId(token: string | TokenInfo): string {
  return typeof token === "string" ? token : token.token_id;
}

function tokenChain(token: StablecoinToken): Chain {
  return TOKEN_CHAINS[token];
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
    case "serverwontfund":
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
  private tokens: TokenInfo[] | null = null;

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
    if (this.config.apiKey) builder.withOrgCode(this.config.apiKey);
    if (this.config.esploraUrl) builder.withEsploraUrl(this.config.esploraUrl);
    if (this.config.arkadeServerUrl)
      builder.withArkadeServerUrl(this.config.arkadeServerUrl);
    if (this.config.mnemonic) builder.withMnemonic(this.config.mnemonic);

    this.client = await builder.build();
    return this.client;
  }

  private async resolveToken(token: StablecoinToken): Promise<TokenInfo> {
    const client = await this.getClient();
    if (!this.tokens) {
      const tokens = await client.getTokens();
      this.tokens = tokens.evm_tokens;
    }

    const symbols = TOKEN_SYMBOLS[token];
    const chain = tokenChain(token);
    const info = this.tokens.find(
      (candidate) =>
        candidate.chain === chain && symbols.includes(candidate.symbol.toUpperCase())
    );

    if (!info) {
      throw new Error(`LendaSwap token ${token} is not available`);
    }
    return info;
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
    const token = await this.resolveToken(targetToken);
    const quote = await client.getQuote({
      sourceChain: "Arkade",
      sourceToken: "btc",
      targetChain: token.chain,
      targetToken: token.token_id,
      sourceAmount,
    });

    return {
      sourceToken: "btc_arkade",
      targetToken,
      sourceAmount: toNumber(quote.source_amount),
      targetAmount: toNumber(quote.net_target_amount),
      exchangeRate: parseFloat(quote.exchange_rate),
      fee: {
        amount: quote.protocol_fee + quote.network_fee + quote.gasless_network_fee,
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
    const token = await this.resolveToken(sourceToken);
    const quote = await client.getQuote({
      sourceChain: token.chain,
      sourceToken: token.token_id,
      targetChain: "Arkade",
      targetToken: "btc",
      sourceAmount,
    });

    return {
      sourceToken,
      targetToken: "btc_arkade",
      sourceAmount: toNumber(quote.net_source_amount),
      targetAmount: toNumber(quote.net_target_amount),
      exchangeRate: parseFloat(quote.exchange_rate),
      fee: {
        amount: quote.protocol_fee + quote.network_fee + quote.gasless_network_fee,
        percentage: quote.protocol_fee_rate * 100,
      },
      expiresAt: new Date(Date.now() + 60_000),
    };
  }

  async swapBtcToStablecoin(
    params: BtcToStablecoinParams
  ): Promise<StablecoinSwapResult> {
    const client = await this.getClient();
    const token = await this.resolveToken(params.targetToken);

    const result = await client.createArkadeToEvmSwapGeneric({
      targetAddress: params.targetAddress,
      tokenAddress: token.token_id,
      evmChainId: EVM_CHAIN_IDS[params.targetChain],
      sourceAmount: params.sourceAmount != null ? BigInt(params.sourceAmount) : undefined,
      targetAmount: params.targetAmount != null ? BigInt(params.targetAmount) : undefined,
      referralCode: params.referralCode || this.referralCode,
    });

    const resp = result.response;
    const sourceAmount = toNumber(resp.source_amount);
    const targetAmount = toNumber(resp.target_amount);

    const fundingTxid = await this.wallet.sendBitcoin({
      address: resp.btc_vhtlc_address,
      amount: sourceAmount,
    });

    return {
      swapId: resp.id,
      status: "funded",
      sourceAmount,
      targetAmount,
      exchangeRate: sourceAmount > 0 ? targetAmount / (sourceAmount / 1e8) : 0,
      fee: {
        amount: resp.fee_sats,
        percentage: sourceAmount > 0 ? (resp.fee_sats / sourceAmount) * 100 : 0,
      },
      expiresAt: new Date(resp.vhtlc_refund_locktime * 1000),
      paymentDetails: { address: resp.btc_vhtlc_address },
      htlcAddressEvm: resp.evm_htlc_address,
      fundingTxid,
    };
  }

  async swapStablecoinToBtc(
    params: StablecoinToBtcParams
  ): Promise<StablecoinSwapResult> {
    const client = await this.getClient();
    const token = await this.resolveToken(params.sourceToken);
    const arkAddress = params.targetAddress || (await this.wallet.getAddress());

    const result = await client.createEvmToArkadeSwapGeneric({
      targetAddress: arkAddress,
      tokenAddress: token.token_id,
      evmChainId: EVM_CHAIN_IDS[params.sourceChain],
      sourceAmount: BigInt(params.sourceAmount),
      userAddress: params.userAddress || "0x0000000000000000000000000000000000000000",
      referralCode: params.referralCode || this.referralCode,
    });

    const resp = result.response;
    const sourceAmount = toNumber(resp.source_amount);
    const targetAmount = toNumber(resp.target_amount);

    return {
      swapId: resp.id,
      status: mapSwapStatus(resp.status),
      sourceAmount,
      targetAmount,
      exchangeRate: targetAmount > 0 ? (sourceAmount / targetAmount) * 1e8 : 0,
      fee: {
        amount: resp.fee_sats,
        percentage: targetAmount > 0 ? (resp.fee_sats / targetAmount) * 100 : 0,
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
    const sourceAmount = toNumber(data.source_amount);
    const targetAmount = toNumber(data.target_amount);

    const direction =
      data.direction === "evm_to_arkade" || data.direction === "evm_to_bitcoin"
        ? ("stablecoin_to_btc" as const)
        : ("btc_to_stablecoin" as const);

    const status = mapSwapStatus(data.status);
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
      sourceToken: tokenId(data.source_token),
      targetToken: tokenId(data.target_token),
      sourceAmount,
      targetAmount,
      exchangeRate,
      createdAt: new Date(data.created_at),
      completedAt: status === "completed" ? new Date() : undefined,
      txid:
        ("evm_claim_txid" in data ? data.evm_claim_txid : undefined) ??
        ("btc_claim_txid" in data ? data.btc_claim_txid : undefined) ??
        undefined,
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
    const pairs = await client.getSwapPairs();

    return pairs.pairs.map((pair) => ({
      from: pair.source,
      to: pair.target,
      minAmount: pair.min_sats ?? 0,
      maxAmount: pair.max_sats ?? 0,
      feePercentage: pair.fee_percentage ?? 0,
    }));
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

    if (data.direction === "evm_to_arkade" || data.direction === "evm_to_bitcoin") {
      return {
        success: false,
        message:
          "This is an EVM-sourced swap. Use getEvmRefundCallData() to get the EVM refund transaction data.",
      };
    }

    const destinationAddress = options?.destinationAddress || (await this.wallet.getAddress());
    const result = await client.refundSwap(swapId, { destinationAddress });

    return {
      success: result.success,
      message: result.message,
      txId: result.txId,
      refundAmount: result.refundAmount ? Number(result.refundAmount) : undefined,
    };
  }

  async getEvmFundingCallData(
    swapId: string,
    tokenDecimals: number
  ): Promise<EvmFundingCallData> {
    void tokenDecimals;
    const client = await this.getClient();
    const swap = await client.getSwap(swapId, { updateStorage: true });
    const chainId = Number(swap.source_token.chain);
    const data = await client.getCoordinatorFundingCallDataPermit2(swapId, chainId);
    return {
      approve: { to: data.approve.to, data: data.approve.data },
      createSwap: { to: data.executeAndCreate.to, data: data.executeAndCreate.data },
    };
  }

  async getEvmRefundCallData(swapId: string): Promise<EvmRefundCallData> {
    void swapId;
    throw new Error(
      "EVM refund call data is not exposed by the current LendaSwap SDK. Use the collaborative refund helpers instead."
    );
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
      source_token: string | TokenInfo;
      target_token: string | TokenInfo;
      source_amount: number | string;
      target_amount: number | string;
      created_at: string;
      direction: string;
    };
  }): StablecoinSwapInfo {
    const resp = stored.response;
    const sourceAmount = toNumber(resp.source_amount);
    const targetAmount = toNumber(resp.target_amount);
    const direction =
      resp.direction === "evm_to_arkade" || resp.direction === "evm_to_bitcoin"
        ? ("stablecoin_to_btc" as const)
        : ("btc_to_stablecoin" as const);

    const status = mapSwapStatus(resp.status);
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
      sourceToken: tokenId(resp.source_token),
      targetToken: tokenId(resp.target_token),
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
