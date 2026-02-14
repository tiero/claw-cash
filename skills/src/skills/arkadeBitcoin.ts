import {
  Wallet,
  Ramps,
  ArkTransaction,
  ExtendedCoin,
  ExtendedVirtualCoin,
  type IncomingFunds,
} from "@arkade-os/sdk";
import type {
  BitcoinSkill,
  RampSkill,
  BitcoinAddress,
  SendParams,
  SendResult,
  BalanceInfo,
  IncomingFundsEvent,
  OnboardParams,
  OffboardParams,
  RampResult,
} from "./types.js";

export class ArkadeBitcoinSkill implements BitcoinSkill, RampSkill {
  readonly name = "arkade-bitcoin";
  readonly description =
    "Send and receive Bitcoin over Arkade offchain, get paid onchain (onboard), pay onchain (offboard)";
  readonly version = "1.0.0";

  private readonly ramps: Ramps;

  constructor(private readonly wallet: Wallet) {
    this.ramps = new Ramps(wallet);
  }

  async getReceiveAddresses(): Promise<BitcoinAddress[]> {
    const [arkAddress, boardingAddress] = await Promise.all([
      this.wallet.getAddress(),
      this.wallet.getBoardingAddress(),
    ]);

    return [
      {
        address: arkAddress,
        type: "ark",
        description: "Ark address for receiving offchain Bitcoin instantly",
      },
      {
        address: boardingAddress,
        type: "boarding",
        description:
          "Boarding address for receiving onchain Bitcoin (requires onboarding)",
      },
    ];
  }

  async getArkAddress(): Promise<string> {
    return this.wallet.getAddress();
  }

  async getBoardingAddress(): Promise<string> {
    return this.wallet.getBoardingAddress();
  }

  async getBalance(): Promise<BalanceInfo> {
    const walletBalance = await this.wallet.getBalance();

    return {
      total: walletBalance.total,
      offchain: {
        settled: walletBalance.settled,
        preconfirmed: walletBalance.preconfirmed,
        available: walletBalance.available,
        recoverable: walletBalance.recoverable,
      },
      onchain: {
        confirmed: walletBalance.boarding.confirmed,
        unconfirmed: walletBalance.boarding.unconfirmed,
        total: walletBalance.boarding.total,
      },
    };
  }

  async send(params: SendParams): Promise<SendResult> {
    const txid = await this.wallet.sendBitcoin({
      address: params.address,
      amount: params.amount,
      feeRate: params.feeRate,
      memo: params.memo,
    });

    return {
      txid,
      type: "ark",
      amount: params.amount,
    };
  }

  async getTransactionHistory(): Promise<ArkTransaction[]> {
    return this.wallet.getTransactionHistory();
  }

  async waitForIncomingFunds(timeoutMs?: number): Promise<IncomingFundsEvent> {
    let stopSubscription: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const fundsPromise = new Promise<IncomingFunds>((resolve, reject) => {
      this.wallet
        .notifyIncomingFunds((funds: IncomingFunds) => {
          if (settled) return;
          settled = true;
          resolve(funds);
        })
        .then((stop: () => void) => {
          stopSubscription = stop;
          if (settled) stop();
        })
        .catch((error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error);
        });

      if (timeoutMs !== undefined) {
        timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("Timeout waiting for incoming funds"));
        }, timeoutMs);
      }
    });

    let result: IncomingFunds;
    try {
      result = await fundsPromise;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (stopSubscription) stopSubscription();
    }

    if (result.type === "utxo") {
      return {
        type: "utxo",
        amount: result.coins.reduce((sum: number, coin: { value: number }) => sum + coin.value, 0),
        ids: result.coins.map((coin: { txid: string; vout: number }) => `${coin.txid}:${coin.vout}`),
      };
    } else {
      return {
        type: "vtxo",
        amount: result.newVtxos.reduce((sum: number, vtxo: { value: number }) => sum + vtxo.value, 0),
        ids: result.newVtxos.map((vtxo: { txid: string; vout: number }) => `${vtxo.txid}:${vtxo.vout}`),
      };
    }
  }

  async onboard(params: OnboardParams): Promise<RampResult> {
    const boardingUtxos = await this.wallet.getBoardingUtxos();
    const totalBefore = boardingUtxos.reduce(
      (sum: bigint, utxo: { value: number }) => sum + BigInt(utxo.value),
      0n
    );

    const commitmentTxid = await this.ramps.onboard(
      params.feeInfo,
      undefined,
      params.amount,
      params.eventCallback
    );

    const amount = params.amount ?? totalBefore;
    return { commitmentTxid, amount };
  }

  async offboard(params: OffboardParams): Promise<RampResult> {
    const vtxos = await this.wallet.getVtxos({ withRecoverable: true });
    const totalBefore = vtxos.reduce(
      (sum: bigint, vtxo: { value: number }) => sum + BigInt(vtxo.value),
      0n
    );

    const commitmentTxid = await this.ramps.offboard(
      params.destinationAddress,
      params.feeInfo,
      params.amount,
      params.eventCallback
    );

    const amount = params.amount ?? totalBefore;
    return { commitmentTxid, amount };
  }

  getWallet(): Wallet {
    return this.wallet;
  }

  async getVtxos(filter?: {
    withRecoverable?: boolean;
    withUnrolled?: boolean;
  }): Promise<ExtendedVirtualCoin[]> {
    return this.wallet.getVtxos(filter);
  }

  async getBoardingUtxos(): Promise<ExtendedCoin[]> {
    return this.wallet.getBoardingUtxos();
  }
}

export function createArkadeBitcoinSkill(wallet: Wallet): ArkadeBitcoinSkill {
  return new ArkadeBitcoinSkill(wallet);
}
