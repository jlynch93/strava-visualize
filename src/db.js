import { appError } from "./http.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

export function requireDb(env) {
  if (!env.DB) throw appError("Bind a D1 database as DB to this Worker (see README).", 503);
  return env.DB;
}

const now = () => Math.floor(Date.now() / 1000);

export async function getUser(env, userId) {
  return requireDb(env).prepare("SELECT id, display_name, avatar_url, created_at FROM users WHERE id = ?").bind(userId).first();
}

export async function listConnections(env, userId) {
  const { results } = await requireDb(env)
    .prepare("SELECT provider, provider_user_id, display_name, created_at FROM provider_connections WHERE user_id = ? ORDER BY created_at")
    .bind(userId)
    .all();
  return results || [];
}

export async function findConnectionByProviderUser(env, provider, providerUserId) {
  return requireDb(env)
    .prepare("SELECT user_id FROM provider_connections WHERE provider = ? AND provider_user_id = ?")
    .bind(provider, String(providerUserId))
    .first();
}

export async function getConnectionTokens(env, userId, provider) {
  const row = await requireDb(env)
    .prepare("SELECT access_token, refresh_token, expires_at FROM provider_connections WHERE user_id = ? AND provider = ?")
    .bind(userId, provider)
    .first();
  if (!row) return null;
  return {
    accessToken: await decryptSecret(env, row.access_token),
    refreshToken: await decryptSecret(env, row.refresh_token),
    expiresAt: Number(row.expires_at) || 0
  };
}

export async function saveConnectionTokens(env, userId, provider, tokens) {
  await requireDb(env)
    .prepare("UPDATE provider_connections SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE user_id = ? AND provider = ?")
    .bind(
      await encryptSecret(env, tokens.accessToken),
      await encryptSecret(env, tokens.refreshToken),
      tokens.expiresAt || 0,
      now(),
      userId,
      provider
    )
    .run();
}

export async function createUser(env, profile) {
  const id = crypto.randomUUID();
  const timestamp = now();
  await requireDb(env)
    .prepare("INSERT INTO users (id, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, profile.displayName || "", profile.avatarUrl || "", timestamp, timestamp)
    .run();
  return id;
}

// Inserts or replaces the user's connection for this provider. Callers must
// first confirm the provider account is not linked to a different user.
export async function upsertConnection(env, userId, provider, account, tokens) {
  const timestamp = now();
  await requireDb(env)
    .prepare(`INSERT INTO provider_connections
        (user_id, provider, provider_user_id, display_name, access_token, refresh_token, expires_at, scope, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, provider) DO UPDATE SET
        provider_user_id = excluded.provider_user_id,
        display_name = excluded.display_name,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        scope = excluded.scope,
        updated_at = excluded.updated_at`)
    .bind(
      userId,
      provider,
      String(account.id),
      account.displayName || "",
      await encryptSecret(env, tokens.accessToken),
      await encryptSecret(env, tokens.refreshToken),
      tokens.expiresAt || 0,
      tokens.scope || "",
      timestamp,
      timestamp
    )
    .run();
}

// Removes the connection and every activity stored from it.
export async function deleteConnection(env, userId, provider) {
  const db = requireDb(env);
  await db.batch([
    db.prepare("DELETE FROM activities WHERE user_id = ? AND provider = ?").bind(userId, provider),
    db.prepare("DELETE FROM provider_connections WHERE user_id = ? AND provider = ?").bind(userId, provider)
  ]);
}

export async function findUserIdByProviderUser(env, provider, providerUserId) {
  const row = await findConnectionByProviderUser(env, provider, providerUserId);
  return row?.user_id || null;
}

export async function saveActivities(env, userId, provider, activities) {
  if (!activities.length) return;
  const db = requireDb(env);
  const timestamp = now();
  await db.batch(activities.map((activity) => db
    .prepare(`INSERT INTO activities (provider, activity_id, user_id, start_time, data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider, activity_id) DO UPDATE SET
        start_time = excluded.start_time, data = excluded.data, updated_at = excluded.updated_at
      WHERE activities.user_id = excluded.user_id`)
    .bind(provider, String(activity.id), userId, Math.floor(Date.parse(activity.start_date) / 1000) || 0, JSON.stringify(activity), timestamp)));
}

export async function deleteActivities(env, userId, provider) {
  await requireDb(env).prepare("DELETE FROM activities WHERE user_id = ? AND provider = ?").bind(userId, provider).run();
}

// Newest first, like Strava's activity list. `truncated` is true when more
// than `limit` activities match.
export async function listStoredActivities(env, userId, provider, { after, before, limit }) {
  const conditions = ["user_id = ?", "provider = ?"];
  const params = [userId, provider];
  if (Number.isFinite(after)) {
    conditions.push("start_time > ?");
    params.push(after);
  }
  if (Number.isFinite(before)) {
    conditions.push("start_time < ?");
    params.push(before);
  }
  const { results } = await requireDb(env)
    .prepare(`SELECT data FROM activities WHERE ${conditions.join(" AND ")} ORDER BY start_time DESC LIMIT ?`)
    .bind(...params, limit + 1)
    .all();
  const rows = (results || []).map((row) => JSON.parse(row.data));
  return { activities: rows.slice(0, limit), truncated: rows.length > limit };
}

export async function getStoredActivity(env, userId, provider, activityId) {
  const row = await requireDb(env)
    .prepare("SELECT data FROM activities WHERE user_id = ? AND provider = ? AND activity_id = ?")
    .bind(userId, provider, String(activityId))
    .first();
  return row ? JSON.parse(row.data) : null;
}

export async function deleteUser(env, userId) {
  const db = requireDb(env);
  // Explicit deletes rather than relying on ON DELETE CASCADE, which needs
  // foreign keys enabled on the connection.
  await db.batch([
    db.prepare("DELETE FROM activities WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM provider_connections WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId)
  ]);
}
