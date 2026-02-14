import {
  ArkadeLightning,
  BoltzSwapProvider,
  decodeInvoice,
  type PendingReverseSwap,
  type PendingSubmarineSwap,
} from "@arkade-os/boltz-swap";
import { Wallet, type ArkProvider, type NetworkName } from "@arkade-os/sdk";
import type { IndexerProvider } from "@arkade-os/sdk";
import type {
  LightningSkill,
  LightningInvoice,
  CreateInvoiceParams,
  PayInvoiceParams,
  PaymentResult,
  LightningFees,
  LightningLimits,
  SwapInfo,
  SwapStatus,
} from "./types.js";

const BOLTZ_API_URLS: Record<string, string> = {
  bitcoin: "https://api.ark.boltz.exchange",
  mainnet: "https://api.ark.boltz.exchange",
  testnet: "https://testnet.boltz.exchange/api",
  signet: "https://testnet.boltz.exchange/api",
  regtest: "http://localhost:9069",
  mutinynet: "https://api.boltz.mutinynet.arkade.sh",
};

export interface ArkadeLightningSkillConfig {
  wallet: Wallet;
  network: NetworkName;
  arkProvider?: ArkProvider;
  indexerProvider?: IndexerProvider;
  boltzApiUrl?: string;
  referralId?: string;
  enableSwapManager?: boolean;
}

export class ArkadeLightningSkill implements LightningSkill {
  readonly name = "arkade-lightning";
  readonly description =
    "Lightning Network payments via Boltz submarine swaps for Arkade wallets";
  readonly version = "1.0.0";

  private readonly arkadeLightning: ArkadeLightning;
  private readonly swapProvider: BoltzSwapProvider;
  private readonly network: NetworkName;
  private readonly swapErrors = new Map<string, string>();

  constructor(config: ArkadeLightningSkillConfig) {
    this.network = config.network;

    const boltzApiUrl =
      config.boltzApiUrl ||
      BOLTZ_API_URLS[config.network] ||
      BOLTZ_API_URLS.bitcoin;

    this.swapProvider = new BoltzSwapProvider({
      apiUrl: boltzApiUrl,
      network: config.network,
      referralId: config.referralId,
    });

    this.arkadeLightning = new ArkadeLightning({
      wallet: config.wallet as ConstructorParameters<
        typeof ArkadeLightning
      >[0]["wallet"],
      swapProvider: this.swapProvider,
      arkProvider: config.arkProvider,
      indexerProvider: config.indexerProvider,
      swapManager: config.enableSwapManager
        ? { enableAutoActions: true, autoStart: true }
        : undefined,
    });

    // Track swap errors from SwapManager for debugging
    const manager = this.arkadeLightning.getSwapManager?.();
    if (manager) {
      manager.onSwapFailed?.((swap: { id: string }, error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        this.swapErrors.set(swap.id, msg);
        console.error(`[lightning] swap ${swap.id} failed: ${msg}`);
      });
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.swapProvider.getFees();
      return true;
    } catch {
      return false;
    }
  }

  async createInvoice(params: CreateInvoiceParams): Promise<LightningInvoice> {
    const response = await this.arkadeLightning.createLightningInvoice({
      amount: params.amount,
      description: params.description,
    });

    const decoded = decodeInvoice(response.invoice);

    return {
      bolt11: response.invoice,
      paymentHash: response.paymentHash,
      amount: response.amount,
      description: params.description,
      expirySeconds: decoded.expiry,
      createdAt: new Date(),
      preimage: response.preimage,
    };
  }

  async payInvoice(params: PayInvoiceParams): Promise<PaymentResult> {
    const response = await this.arkadeLightning.sendLightningPayment({
      invoice: params.bolt11,
    });

    return {
      preimage: response.preimage,
      amount: response.amount,
      txid: response.txid,
    };
  }

  async getFees(): Promise<LightningFees> {
    return this.arkadeLightning.getFees();
  }

  async getLimits(): Promise<LightningLimits> {
    return this.arkadeLightning.getLimits();
  }

  async getPendingSwaps(): Promise<SwapInfo[]> {
    // Refresh statuses from Boltz API before returning
    try {
      await this.arkadeLightning.refreshSwapsStatus();
    } catch {
      // Non-fatal: return stale data if refresh fails
    }

    // Return ALL swaps from storage (not just initial-status filtered)
    return this.getSwapHistory();
  }

  async getSwapHistory(): Promise<SwapInfo[]> {
    const history = await this.arkadeLightning.getSwapHistory();
    return history.map((swap) =>
      swap.type === "reverse"
        ? this.mapReverseSwap(swap as PendingReverseSwap)
        : this.mapSubmarineSwap(swap as PendingSubmarineSwap)
    );
  }

  async waitAndClaim(
    pendingSwap: PendingReverseSwap
  ): Promise<{ txid: string }> {
    return this.arkadeLightning.waitAndClaim(pendingSwap);
  }

  getArkadeLightning(): ArkadeLightning {
    return this.arkadeLightning;
  }

  getSwapProvider(): BoltzSwapProvider {
    return this.swapProvider;
  }

  async startSwapManager(): Promise<void> {
    await this.arkadeLightning.startSwapManager();
  }

  async stopSwapManager(): Promise<void> {
    await this.arkadeLightning.stopSwapManager();
  }

  async dispose(): Promise<void> {
    await this.arkadeLightning.dispose();
  }

  private mapReverseSwap(swap: PendingReverseSwap): SwapInfo {
    return {
      id: swap.id,
      type: "reverse",
      status: swap.status as SwapStatus,
      amount: swap.response.onchainAmount,
      createdAt: new Date(swap.createdAt),
      invoice: swap.response.invoice,
      error: this.swapErrors.get(swap.id),
    };
  }

  private mapSubmarineSwap(swap: PendingSubmarineSwap): SwapInfo {
    let amount = 0;
    try {
      const decoded = decodeInvoice(swap.request.invoice);
      amount = decoded.amountSats;
    } catch {
      amount = swap.response.expectedAmount;
    }

    return {
      id: swap.id,
      type: "submarine",
      status: swap.status as SwapStatus,
      amount,
      createdAt: new Date(swap.createdAt),
      invoice: swap.request.invoice,
      error: this.swapErrors.get(swap.id),
    };
  }
}

export function createLightningSkill(
  wallet: Wallet,
  network: NetworkName,
  options?: Partial<Omit<ArkadeLightningSkillConfig, "wallet" | "network">>
): ArkadeLightningSkill {
  return new ArkadeLightningSkill({
    wallet,
    network,
    ...options,
  });
}
