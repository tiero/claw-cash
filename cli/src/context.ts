import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { RemoteSignerIdentity } from "@clw-cash/sdk";
import { Wallet } from "@arkade-os/sdk";
import { FileSystemStorageAdapter } from "@arkade-os/sdk/adapters/fileSystem";
import {
  SqliteWalletStorage,
  SqliteSwapStorage,
} from "@lendasat/lendaswap-sdk-pure/node";
import {
  ArkadeBitcoinSkill,
  ArkadeLightningSkill,
  LendaSwapSkill,
} from "@clw-cash/skills";
import type { CashConfig } from "./config.js";
import type { NetworkName } from "@arkade-os/sdk";

const DATA_DIR = join(homedir(), ".clw-cash", "data");
const LENDASWAP_DB = join(homedir(), ".clw-cash", "lendaswap.db");

export interface CashContext {
  identity: RemoteSignerIdentity;
  bitcoin: ArkadeBitcoinSkill;
  lightning: ArkadeLightningSkill;
  swap: LendaSwapSkill;
  dispose(): Promise<void>;
}

export interface CreateContextOpts {
  enableSwapManager?: boolean;
}

export async function createContext(config: CashConfig, opts?: CreateContextOpts): Promise<CashContext> {
  const identity = new RemoteSignerIdentity({
    apiBaseUrl: config.apiBaseUrl,
    identityId: config.identityId,
    sessionToken: config.sessionToken,
    compressedPublicKey: config.publicKey,
  });

  // Persistent filesystem storage for Wallet + Boltz swap (contractRepository)
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const walletStorage = new FileSystemStorageAdapter(DATA_DIR);

  const wallet = await Wallet.create({
    identity,
    arkServerUrl: config.arkServerUrl,
    storage: walletStorage,
  });

  const bitcoin = new ArkadeBitcoinSkill(wallet);

  const lightning = new ArkadeLightningSkill({
    wallet,
    network: config.network as NetworkName,
    enableSwapManager: opts?.enableSwapManager,
  });

  // Persistent SQLite storage for LendaSwap
  const lendaWalletStorage = new SqliteWalletStorage(LENDASWAP_DB);
  const lendaSwapStorage = new SqliteSwapStorage(LENDASWAP_DB);

  const swap = new LendaSwapSkill({
    wallet,
    walletStorage: lendaWalletStorage,
    swapStorage: lendaSwapStorage,
  });

  return {
    identity,
    bitcoin,
    lightning,
    swap,
    async dispose() {
      await lightning.dispose();
    },
  };
}
