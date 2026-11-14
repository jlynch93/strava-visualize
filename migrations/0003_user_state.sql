-- Account-synced settings: goals, check-ins, saved plans, the fitness
-- profile and display preferences, so they follow the runner across devices.
-- One row per user and allow-listed key; `value` is the JSON the client saves.

CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Lets the scheduled cleanup find expired sessions without a table scan.
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
