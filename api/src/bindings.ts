export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespaces
  KV_CHALLENGES: KVNamespace;
  KV_TICKETS: KVNamespace;
  KV_RATE_LIMIT: KVNamespace;

  // Secrets
  INTERNAL_API_KEY: string;
  TICKET_SIGNING_SECRET: string;
  SESSION_SIGNING_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
  EV_API_KEY: string;

  // Variables
  ENCLAVE_BASE_URL: string;
  TICKET_TTL_SECONDS: string;
  SESSION_TTL_SECONDS: string;
  CHALLENGE_TTL_SECONDS: string;
  RATE_LIMIT_WINDOW_MS: string;
  RATE_LIMIT_PER_USER: string;
  RATE_LIMIT_PER_IDENTITY_SIGN: string;
  ALLOWED_ORIGINS: string;
}
