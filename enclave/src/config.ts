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

const isDev = process.env.ENCLAVE_DEV_MODE === "true";

const requireEnv = (name: string, devFallback: string): string => {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (isDev) return devFallback;
  throw new Error(`Missing required env var: ${name}. Set it or enable ENCLAVE_DEV_MODE=true for local development.`);
};

export const config = {
  port: parseNumber(process.env.ENCLAVE_PORT, 7000),
  internalApiKey: requireEnv("INTERNAL_API_KEY", "change-me-in-production"),
  ticketSigningSecret: requireEnv("TICKET_SIGNING_SECRET", "ticket-secret-dev-only"),
  evEncryptUrl: process.env.EV_ENCRYPT_URL ?? "http://127.0.0.1:9999",
  sealingKey: requireEnv("SEALING_KEY", "0000000000000000000000000000000000000000000000000000000000000001"),
};
