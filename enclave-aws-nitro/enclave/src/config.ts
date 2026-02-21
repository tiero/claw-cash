const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const isDev = process.env.ENCLAVE_DEV_MODE === "true";

const requireEnv = (name: string, devFallback: string): string => {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (isDev) return devFallback;
  throw new Error(
    `Missing required env var: ${name}. Set it or enable ENCLAVE_DEV_MODE=true for local development.`
  );
};

export const config = {
  port: parseNumber(process.env.ENCLAVE_PORT, 7000),
  devMode: isDev,

  // Shared secret for API → Enclave HTTP calls (same protocol as Evervault enclave)
  internalApiKey: requireEnv("INTERNAL_API_KEY", "change-me-in-production"),

  // JWT signing secret for one-time sign tickets (same protocol as Evervault enclave)
  ticketSigningSecret: requireEnv("TICKET_SIGNING_SECRET", "ticket-secret-dev-only"),

  // AWS Nitro-specific — KMS CMK ARN used for key sealing
  kmsKeyArn: requireEnv("KMS_KEY_ARN", "arn:aws:kms:us-east-1:000000000000:key/dev-placeholder"),
  awsRegion: requireEnv("AWS_REGION", "us-east-1"),

  // vsock port where the parent KMS proxy listens (CID 3 = host/parent)
  kmsProxyPort: parseNumber(process.env.KMS_PROXY_PORT, 8000),

  // AES-256-GCM fallback for dev mode (hex-encoded 32-byte key)
  sealingKey: requireEnv(
    "SEALING_KEY",
    "0000000000000000000000000000000000000000000000000000000000000001"
  ),
};
