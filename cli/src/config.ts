import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CashConfig {
  apiBaseUrl: string;
  sessionToken: string;
  identityId: string;
  publicKey: string;
  arkServerUrl: string;
  network: string;
}

const CONFIG_DIR = join(homedir(), ".clw-cash");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function loadConfig(overrides?: Partial<CashConfig>): CashConfig {
  let fileConfig: Partial<CashConfig> = {};

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    fileConfig = JSON.parse(raw) as Partial<CashConfig>;
  } catch {
    // No config file, that's fine
  }

  const config: CashConfig = {
    apiBaseUrl:
      overrides?.apiBaseUrl ??
      process.env.CLW_API_URL ??
      fileConfig.apiBaseUrl ??
      "",
    sessionToken:
      overrides?.sessionToken ??
      process.env.CLW_SESSION_TOKEN ??
      fileConfig.sessionToken ??
      "",
    identityId:
      overrides?.identityId ??
      process.env.CLW_IDENTITY_ID ??
      fileConfig.identityId ??
      "",
    publicKey:
      overrides?.publicKey ??
      process.env.CLW_PUBLIC_KEY ??
      fileConfig.publicKey ??
      "",
    arkServerUrl:
      overrides?.arkServerUrl ??
      process.env.CLW_ARK_SERVER_URL ??
      fileConfig.arkServerUrl ??
      "",
    network:
      overrides?.network ??
      process.env.CLW_NETWORK ??
      fileConfig.network ??
      "bitcoin",
  };

  return config;
}

export function saveConfig(config: CashConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function validateConfig(config: CashConfig): string | null {
  if (!config.apiBaseUrl) return "Missing apiBaseUrl (set CLW_API_URL)";
  if (!config.sessionToken) return "Missing sessionToken (set CLW_SESSION_TOKEN)";
  if (!config.identityId) return "Missing identityId (set CLW_IDENTITY_ID)";
  if (!config.publicKey) return "Missing publicKey (set CLW_PUBLIC_KEY)";
  if (!config.arkServerUrl) return "Missing arkServerUrl (set CLW_ARK_SERVER_URL)";
  return null;
}
