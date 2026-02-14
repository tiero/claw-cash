import { SingleKey, Wallet, Ramps } from "@arkade-os/sdk";
import type { WalletBalance, ArkTransaction, SendBitcoinParams } from "@arkade-os/sdk";

interface WalletRecord {
  wallet: Wallet;
  identity: SingleKey;
}

export class ArkadeWalletManager {
  private wallets = new Map<string, WalletRecord>();

  constructor(private readonly arkServerUrl: string) {}

  async init(userId: string): Promise<{ address: string }> {
    if (this.wallets.has(userId)) {
      const existing = this.wallets.get(userId)!;
      const address = await existing.wallet.getAddress();
      return { address };
    }

    const identity = SingleKey.fromRandomBytes();
    const wallet = await Wallet.create({
      identity,
      arkServerUrl: this.arkServerUrl,
    });

    this.wallets.set(userId, { wallet, identity });
    const address = await wallet.getAddress();
    return { address };
  }

  private getWallet(userId: string): WalletRecord {
    const record = this.wallets.get(userId);
    if (!record) {
      throw new WalletNotFoundError(userId);
    }
    return record;
  }

  async getAddresses(userId: string): Promise<{ ark_address: string; boarding_address: string }> {
    const { wallet } = this.getWallet(userId);
    const [ark_address, boarding_address] = await Promise.all([
      wallet.getAddress(),
      wallet.getBoardingAddress(),
    ]);
    return { ark_address, boarding_address };
  }

  async getBalance(userId: string): Promise<WalletBalance> {
    const { wallet } = this.getWallet(userId);
    return wallet.getBalance();
  }

  async sendBitcoin(userId: string, params: SendBitcoinParams): Promise<string> {
    const { wallet } = this.getWallet(userId);
    return wallet.sendBitcoin(params);
  }

  async onboard(userId: string): Promise<string> {
    const { wallet } = this.getWallet(userId);
    const info = await wallet.arkProvider.getInfo();
    const ramps = new Ramps(wallet);
    return ramps.onboard(info.fees);
  }

  async offboard(userId: string, address: string, amount?: number): Promise<string> {
    const { wallet } = this.getWallet(userId);
    const info = await wallet.arkProvider.getInfo();
    const ramps = new Ramps(wallet);
    return ramps.offboard(address, info.fees, amount ? BigInt(amount) : undefined);
  }

  async getHistory(userId: string): Promise<ArkTransaction[]> {
    const { wallet } = this.getWallet(userId);
    return wallet.getTransactionHistory();
  }

  destroy(userId: string): boolean {
    return this.wallets.delete(userId);
  }
}

export class WalletNotFoundError extends Error {
  constructor(userId: string) {
    super(`Arkade wallet not found for user: ${userId}`);
  }
}
