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
      "https://api.clw.cash",
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
      "https://arkade.computer",
    network:
      overrides?.network ??
      process.env.CLW_NETWORK ??
      fileConfig.network ??
      "bitcoin",
  };

  return config;
}

export type ConfigSource = "env" | "file" | "default";

export interface ConfigEntry {
  value: string;
  source: ConfigSource;
}

export type CashConfigWithSources = Record<keyof CashConfig, ConfigEntry>;

const ENV_KEYS: Record<keyof CashConfig, string> = {
  apiBaseUrl: "CLW_API_URL",
  sessionToken: "CLW_SESSION_TOKEN",
  identityId: "CLW_IDENTITY_ID",
  publicKey: "CLW_PUBLIC_KEY",
  arkServerUrl: "CLW_ARK_SERVER_URL",
  network: "CLW_NETWORK",
};

const DEFAULTS: Record<keyof CashConfig, string> = {
  apiBaseUrl: "https://api.clw.cash",
  sessionToken: "",
  identityId: "",
  publicKey: "",
  arkServerUrl: "https://arkade.computer",
  network: "bitcoin",
};

export function loadConfigWithSources(): CashConfigWithSources {
  let fileConfig: Partial<CashConfig> = {};

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    fileConfig = JSON.parse(raw) as Partial<CashConfig>;
  } catch {
    // No config file
  }

  const result = {} as CashConfigWithSources;
  for (const key of Object.keys(ENV_KEYS) as (keyof CashConfig)[]) {
    const envVal = process.env[ENV_KEYS[key]];
    if (envVal !== undefined) {
      result[key] = { value: envVal, source: "env" };
    } else if (fileConfig[key]) {
      result[key] = { value: fileConfig[key], source: "file" };
    } else {
      result[key] = { value: DEFAULTS[key], source: "default" };
    }
  }

  return result;
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

export interface SessionStatus {
  active: boolean;
  expiresAt: string | null;
  remainingSeconds: number | null;
}

/** Decode JWT payload without verification to check expiry locally */
export function getSessionStatus(token: string): SessionStatus {
  if (!token) return { active: false, expiresAt: null, remainingSeconds: null };

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { active: false, expiresAt: null, remainingSeconds: null };

    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    ) as { exp?: number };

    if (!payload.exp) return { active: true, expiresAt: null, remainingSeconds: null };

    const expiresAt = new Date(payload.exp * 1000);
    const remainingSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    return {
      active: remainingSeconds > 0,
      expiresAt: expiresAt.toISOString(),
      remainingSeconds: Math.max(0, remainingSeconds),
    };
  } catch {
    return { active: false, expiresAt: null, remainingSeconds: null };
  }
}
