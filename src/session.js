import { cookie, parseCookies } from "./http.js";
import { randomToken, sha256 } from "./crypto.js";
import { requireDb } from "./db.js";

export const SESSION_COOKIE = "sv_session";
const SESSION_TTL = 60 * 60 * 24 * 30;

export async function createSession(env, userId, request) {
  const token = randomToken();
  const timestamp = Math.floor(Date.now() / 1000);
  await requireDb(env)
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, timestamp, timestamp + SESSION_TTL)
    .run();
  return cookie(SESSION_COOKIE, token, SESSION_TTL, request);
}

// Returns the signed-in user id, or null. Never throws for a missing or
// unknown cookie, so public routes can call it freely.
export async function currentUserId(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token || !env.DB) return null;
  const row = await env.DB
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .bind(await sha256(token))
    .first();
  if (!row || Number(row.expires_at) <= Math.floor(Date.now() / 1000)) return null;
  return row.user_id;
}

export async function deleteExpiredSessions(env) {
  if (!env.DB) return 0;
  const result = await env.DB
    .prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .bind(Math.floor(Date.now() / 1000))
    .run();
  return Number(result?.meta?.changes) || 0;
}

export async function destroySession(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token && env.DB) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  return cookie(SESSION_COOKIE, "", 0, request);
}
