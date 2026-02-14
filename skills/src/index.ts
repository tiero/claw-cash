export * from "./skills/index.js";

export type {
  Wallet,
  ArkTransaction,
  WalletBalance,
  ExtendedCoin,
  ExtendedVirtualCoin,
  FeeInfo,
  SettlementEvent,
  NetworkName,
} from "@arkade-os/sdk";

// ── clw.cash factory ────────────────────────────────────

import { Wallet } from "@arkade-os/sdk";
import { RemoteSignerIdentity, type RemoteSignerConfig } from "@clw-cash/sdk";
import { ArkadeBitcoinSkill } from "./skills/arkadeBitcoin.js";
import { ArkadeLightningSkill, type ArkadeLightningSkillConfig } from "./skills/lightning.js";
import { LendaSwapSkill, type LendaSwapSkillConfig } from "./skills/lendaswap.js";

export interface ClwSkillConfig {
  /** clw.cash API base URL */
  apiBaseUrl: string;
  /** JWT session token from /v1/auth/verify */
  sessionToken: string;
  /** UUID of the identity on clw.cash */
  identityId: string;
  /** Hex-encoded 33-byte compressed public key */
  publicKey: string;
  /** Arkade server URL (e.g., "https://arkade.computer") */
  arkServerUrl: string;
}

/**
 * Create an ArkadeBitcoinSkill powered by a clw.cash remote signer.
 * The private key stays in the enclave — only signing requests are sent.
 */
export async function createClwBitcoinSkill(
  config: ClwSkillConfig
): Promise<ArkadeBitcoinSkill> {
  const identity = new RemoteSignerIdentity({
    apiBaseUrl: config.apiBaseUrl,
    identityId: config.identityId,
    sessionToken: config.sessionToken,
    compressedPublicKey: config.publicKey,
  });

  const wallet = await Wallet.create({
    identity,
    arkServerUrl: config.arkServerUrl,
  });

  return new ArkadeBitcoinSkill(wallet);
}

/**
 * Create an ArkadeLightningSkill powered by a clw.cash remote signer.
 */
export async function createClwLightningSkill(
  config: ClwSkillConfig & Omit<ArkadeLightningSkillConfig, "wallet">
): Promise<ArkadeLightningSkill> {
  const identity = new RemoteSignerIdentity({
    apiBaseUrl: config.apiBaseUrl,
    identityId: config.identityId,
    sessionToken: config.sessionToken,
    compressedPublicKey: config.publicKey,
  });

  const wallet = await Wallet.create({
    identity,
    arkServerUrl: config.arkServerUrl,
  });

  return new ArkadeLightningSkill({
    wallet,
    network: config.network,
    arkProvider: config.arkProvider,
    indexerProvider: config.indexerProvider,
    boltzApiUrl: config.boltzApiUrl,
    referralId: config.referralId,
    enableSwapManager: config.enableSwapManager,
  });
}

/**
 * Create a LendaSwapSkill powered by a clw.cash remote signer.
 */
export async function createClwLendaSwapSkill(
  config: ClwSkillConfig & Omit<LendaSwapSkillConfig, "wallet">
): Promise<LendaSwapSkill> {
  const identity = new RemoteSignerIdentity({
    apiBaseUrl: config.apiBaseUrl,
    identityId: config.identityId,
    sessionToken: config.sessionToken,
    compressedPublicKey: config.publicKey,
  });

  const wallet = await Wallet.create({
    identity,
    arkServerUrl: config.arkServerUrl,
  });

  return new LendaSwapSkill({
    wallet,
    ...config,
  });
}
