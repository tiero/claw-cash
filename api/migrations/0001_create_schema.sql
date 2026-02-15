-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_user_id);

-- Identities
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  alg TEXT NOT NULL CHECK (alg IN ('secp256k1')),
  public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'destroyed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);

-- Audit events
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  identity_id TEXT,
  action TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);

-- Key backups
CREATE TABLE IF NOT EXISTS key_backups (
  identity_id TEXT PRIMARY KEY,
  alg TEXT NOT NULL,
  sealed_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
