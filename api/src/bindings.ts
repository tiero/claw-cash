export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespaces
  KV_TICKETS: KVNamespace;
  KV_RATE_LIMIT: KVNamespace;

  // Secrets
  INTERNAL_API_KEY: string;
  TICKET_SIGNING_SECRET: string;
  SESSION_SIGNING_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
  TELEGRAM_ADMIN_CHAT_ID: string;
  EV_API_KEY: string;

  // Variables
  ALLOW_TEST_AUTH: string;
  ENCLAVE_BASE_URL: string;
  SIGNER_MODE: string; // "enclave" (default) | "worker"

  // Secrets (worker mode only)
  WORKER_SEALING_KEY: string; // 32-byte hex AES-256 master key for encrypting private keys
  TICKET_TTL_SECONDS: string;
  SESSION_TTL_SECONDS: string;
  CHALLENGE_TTL_SECONDS: string;
  RATE_LIMIT_WINDOW_MS: string;
  RATE_LIMIT_PER_USER: string;
  RATE_LIMIT_PER_IDENTITY_SIGN: string;
  ALLOWED_ORIGINS: string;
}
