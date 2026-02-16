CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
