-- Activities for providers that push data to the app (Garmin) rather than
-- being fetched on demand. `data` holds the activity already mapped to the
-- Strava-shaped fields the dashboard reads.

CREATE TABLE IF NOT EXISTS activities (
  provider TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, activity_id)
);
CREATE INDEX IF NOT EXISTS activities_user_time ON activities(user_id, provider, start_time);
