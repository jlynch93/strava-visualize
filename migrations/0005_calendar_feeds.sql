-- Calendar subscription links: one per user. The link's secret token is
-- stored twice: as a SHA-256 hash, to look a feed request up without keeping
-- the token readable, and encrypted with TOKEN_ENCRYPTION_KEY so the signed-in
-- runner can see and copy their link again. Making a new link replaces both;
-- deleting the row stops the feed.

CREATE TABLE IF NOT EXISTS calendar_feeds (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
