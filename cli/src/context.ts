import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { RemoteSignerIdentity } from "@clw-cash/sdk";
import { Wallet, RestDelegatorProvider } from "@arkade-os/sdk";
import {
  SQLiteWalletRepository,
  SQLiteContractRepository,
  type SQLExecutor,
} from "@arkade-os/sdk/repositories/sqlite";
import {
  SqliteWalletStorage,
  SqliteSwapStorage,
} from "@lendasat/lendaswap-sdk-pure/node";
import { SQLiteSwapRepository } from "@arkade-os/boltz-swap/repositories/sqlite";
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

  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

  const ARK_DB = join(homedir(), ".clw-cash", "ark-wallet.db");
  const db = new Database(ARK_DB);
  db.pragma("journal_mode = WAL");
  const executor: SQLExecutor = {
    run: async (sql, params) => { db.prepare(sql).run(...(params ?? [])); },
    get: async (sql, params) => db.prepare(sql).get(...(params ?? [])) as any,
    all: async (sql, params) => db.prepare(sql).all(...(params ?? [])) as any,
  };

  const wallet = await Wallet.create({
    identity,
    arkServerUrl: config.arkServerUrl,
    storage: {
      walletRepository: new SQLiteWalletRepository(executor),
      contractRepository: new SQLiteContractRepository(executor),
    },
    ...(config.delegatorUrl
      ? { delegatorProvider: new RestDelegatorProvider(config.delegatorUrl) }
      : {}),
  });

  const bitcoin = new ArkadeBitcoinSkill(wallet);

  const lightning = new ArkadeLightningSkill({
    wallet,
    network: config.network as NetworkName,
    enableSwapManager: opts?.enableSwapManager,
    swapRepository: new SQLiteSwapRepository(executor),
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
    bitcoin,
    lightning,
    swap,
    async dispose() {
      await lightning.dispose();
    },
  };
}
