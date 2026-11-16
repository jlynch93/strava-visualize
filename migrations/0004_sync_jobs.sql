-- Background history imports for providers that push data (Garmin). One row
-- per user and provider records which history windows have been requested,
-- so a failed request is retried by the cron trigger instead of being lost.

CREATE TABLE IF NOT EXISTS sync_jobs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  -- End of the newest window, fixed at connect time so retries cover the same range.
  anchor_end INTEGER NOT NULL,
  windows_total INTEGER NOT NULL,
  windows_done INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- requesting: windows still to ask for; requested: all asked for; failed: gave up.
  status TEXT NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
CREATE INDEX IF NOT EXISTS sync_jobs_status ON sync_jobs(status, updated_at);
-- The arrival cursor reads activities by when they were stored, not when they started.
CREATE INDEX IF NOT EXISTS activities_user_updated ON activities(user_id, provider, updated_at);
