const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() === "true";
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export const config = {
  port: parseNumber(process.env.API_PORT, 4000),
  enclaveBaseUrl: process.env.ENCLAVE_BASE_URL ?? "http://127.0.0.1:7000",
  internalApiKey: process.env.INTERNAL_API_KEY ?? "change-me-in-production",
  evApiKey: process.env.EV_API_KEY ?? "",
  ticketSigningSecret: process.env.TICKET_SIGNING_SECRET ?? "ticket-secret-dev-only",
  sessionSigningSecret: process.env.SESSION_SIGNING_SECRET ?? "session-secret-dev-only",
  ticketTtlSeconds: parseNumber(process.env.TICKET_TTL_SECONDS, 90),
  sessionTtlSeconds: parseNumber(process.env.SESSION_TTL_SECONDS, 3600),
  requireOtp: parseBoolean(process.env.REQUIRE_OTP, false),
  validOtpCodes: (process.env.VALID_OTP_CODES ?? "").split(",").map((v) => v.trim()).filter(Boolean),
  backupFilePath: process.env.BACKUP_FILE_PATH ?? "./api-data/key-backups.json",
  rateLimitWindowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitPerUser: parseNumber(process.env.RATE_LIMIT_PER_USER, 60),
  rateLimitPerWalletSign: parseNumber(process.env.RATE_LIMIT_PER_WALLET_SIGN, 20),
  confirmTokenSecret: process.env.CONFIRM_TOKEN_SECRET ?? "confirm-secret-dev-only",
  confirmTokenTtlSeconds: parseNumber(process.env.CONFIRM_TOKEN_TTL_SECONDS, 300)
};
