import type { ArkTransaction, SettlementEvent, FeeInfo } from "@arkade-os/sdk";

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly version: string;
}

export interface BitcoinAddress {
  address: string;
  type: "ark" | "boarding" | "onchain";
  description: string;
}

export interface SendParams {
  address: string;
  amount: number;
  feeRate?: number;
  memo?: string;
}

export interface OnboardParams {
  feeInfo: FeeInfo;
  amount?: bigint;
  eventCallback?: (event: SettlementEvent) => void;
}

export interface OffboardParams {
  destinationAddress: string;
  feeInfo: FeeInfo;
  amount?: bigint;
  eventCallback?: (event: SettlementEvent) => void;
}

export interface SendResult {
  txid: string;
  type: "ark" | "onchain" | "lightning";
  amount: number;
  fee?: number;
}

export interface RampResult {
  commitmentTxid: string;
  amount: bigint;
}

export interface BalanceInfo {
  total: number;
  offchain: {
    settled: number;
    preconfirmed: number;
    available: number;
    recoverable: number;
  };
  onchain: {
    confirmed: number;
    unconfirmed: number;
    total: number;
  };
}

export interface IncomingFundsEvent {
  type: "utxo" | "vtxo";
  amount: number;
  ids: string[];
}

export interface BitcoinSkill extends Skill {
  getReceiveAddresses(): Promise<BitcoinAddress[]>;
  getArkAddress(): Promise<string>;
  getBoardingAddress(): Promise<string>;
  getBalance(): Promise<BalanceInfo>;
  send(params: SendParams): Promise<SendResult>;
  getTransactionHistory(): Promise<ArkTransaction[]>;
  waitForIncomingFunds(timeoutMs?: number): Promise<IncomingFundsEvent>;
}

export interface RampSkill extends Skill {
  onboard(params: OnboardParams): Promise<RampResult>;
  offboard(params: OffboardParams): Promise<RampResult>;
}

export interface LightningInvoice {
  bolt11: string;
  paymentHash: string;
  amount: number;
  description?: string;
  expirySeconds: number;
  createdAt: Date;
  preimage?: string;
}

export interface CreateInvoiceParams {
  amount: number;
  description?: string;
}

export interface PayInvoiceParams {
  bolt11: string;
}

export interface PaymentResult {
  preimage: string;
  amount: number;
  txid: string;
}

export interface LightningFees {
  submarine: {
    percentage: number;
    minerFees: number;
  };
  reverse: {
    percentage: number;
    minerFees: {
      lockup: number;
      claim: number;
    };
  };
}

export interface LightningLimits {
  min: number;
  max: number;
}

export type SwapStatus =
  | "pending"
  | "invoice.set"
  | "invoice.pending"
  | "invoice.paid"
  | "invoice.settled"
  | "invoice.expired"
  | "invoice.failedToPay"
  | "swap.created"
  | "swap.expired"
  | "transaction.mempool"
  | "transaction.confirmed"
  | "transaction.claimed"
  | "transaction.refunded"
  | "transaction.failed"
  | "transaction.lockupFailed"
  | "transaction.claim.pending";

export interface SwapInfo {
  id: string;
  type: "submarine" | "reverse";
  status: SwapStatus;
  amount: number;
  createdAt: Date;
  invoice?: string;
  error?: string;
}

export interface LightningSkill extends Skill {
  createInvoice(params: CreateInvoiceParams): Promise<LightningInvoice>;
  payInvoice(params: PayInvoiceParams): Promise<PaymentResult>;
  isAvailable(): Promise<boolean>;
  getFees(): Promise<LightningFees>;
  getLimits(): Promise<LightningLimits>;
  getPendingSwaps(): Promise<SwapInfo[]>;
  getSwapHistory(): Promise<SwapInfo[]>;
}

// ── LendaSwap Types ─────────────────────────────────────

export type EvmChain = "polygon" | "ethereum" | "arbitrum";

export type StablecoinToken =
  | "usdc_pol"
  | "usdc_eth"
  | "usdc_arb"
  | "usdt0_pol"
  | "usdt_eth"
  | "usdt_arb";

export type BtcSource = "btc_arkade" | "btc_lightning" | "btc_onchain";

export interface BtcToStablecoinParams {
  targetAddress: string;
  targetToken: StablecoinToken;
  targetChain: EvmChain;
  sourceAmount?: number;
  targetAmount?: number;
  referralCode?: string;
}

export interface StablecoinToBtcParams {
  sourceChain: EvmChain;
  sourceToken: StablecoinToken;
  sourceAmount: number;
  targetAddress: string;
  userAddress?: string;
  referralCode?: string;
}

export interface StablecoinSwapResult {
  swapId: string;
  status: StablecoinSwapStatus;
  sourceAmount: number;
  targetAmount: number;
  exchangeRate: number;
  fee: {
    amount: number;
    percentage: number;
  };
  expiresAt: Date;
  paymentDetails?: {
    address: string;
    callData?: string;
  };
  htlcAddressEvm?: string;
  fundingTxid?: string;
}

export type StablecoinSwapStatus =
  | "pending"
  | "awaiting_funding"
  | "funded"
  | "processing"
  | "completed"
  | "expired"
  | "refunded"
  | "failed";

export interface StablecoinSwapInfo {
  id: string;
  direction: "btc_to_stablecoin" | "stablecoin_to_btc";
  status: StablecoinSwapStatus;
  sourceToken: string;
  targetToken: string;
  sourceAmount: number;
  targetAmount: number;
  exchangeRate: number;
  createdAt: Date;
  completedAt?: Date;
  txid?: string;
}

export interface StablecoinQuote {
  sourceToken: string;
  targetToken: string;
  sourceAmount: number;
  targetAmount: number;
  exchangeRate: number;
  fee: {
    amount: number;
    percentage: number;
  };
  expiresAt: Date;
}

export interface StablecoinPair {
  from: string;
  to: string;
  minAmount: number;
  maxAmount: number;
  feePercentage: number;
}

export interface EvmFundingCallData {
  approve: { to: string; data: string };
  createSwap: { to: string; data: string };
}

export interface EvmRefundCallData {
  to: string;
  data: string;
  timelockExpired: boolean;
  timelockExpiry: number;
}

export interface ClaimSwapResult {
  success: boolean;
  message: string;
  txHash?: string;
  chain?: string;
}

export interface RefundSwapResult {
  success: boolean;
  message: string;
  txId?: string;
  refundAmount?: number;
}

export interface StablecoinSwapSkill extends Skill {
  isAvailable(): Promise<boolean>;
  getQuoteBtcToStablecoin(sourceAmount: number, targetToken: StablecoinToken): Promise<StablecoinQuote>;
  getQuoteStablecoinToBtc(sourceAmount: number, sourceToken: StablecoinToken): Promise<StablecoinQuote>;
  swapBtcToStablecoin(params: BtcToStablecoinParams): Promise<StablecoinSwapResult>;
  swapStablecoinToBtc(params: StablecoinToBtcParams): Promise<StablecoinSwapResult>;
  getSwapStatus(swapId: string): Promise<StablecoinSwapInfo>;
  getPendingSwaps(): Promise<StablecoinSwapInfo[]>;
  getSwapHistory(): Promise<StablecoinSwapInfo[]>;
  getAvailablePairs(): Promise<StablecoinPair[]>;
  claimSwap(swapId: string): Promise<ClaimSwapResult>;
  refundSwap(swapId: string, options?: { destinationAddress?: string }): Promise<RefundSwapResult>;
  getEvmFundingCallData(swapId: string, tokenDecimals: number): Promise<EvmFundingCallData>;
  getEvmRefundCallData(swapId: string): Promise<EvmRefundCallData>;
}
