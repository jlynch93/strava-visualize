import { appError, json } from "./http.js";
import { requireDb } from "./db.js";
import { requireUser } from "./auth.js";

// Client storage keys that follow the account. Imported activity files stay
// in the browser only.
export const SYNCED_KEYS = new Set([
  "run-trends-preferences",
  "run-trends-plans-v1",
  "run-trends-coaching-context-v1",
  "run-trends-athlete-v1"
]);
const MAX_VALUE_BYTES = 256_000;

export async function handleGetState(env, request) {
  const userId = await requireUser(env, request);
  const { results } = await requireDb(env)
    .prepare("SELECT key, value, updated_at FROM user_state WHERE user_id = ?")
    .bind(userId)
    .all();
  const state = {};
  for (const row of results || []) {
    if (!SYNCED_KEYS.has(row.key)) continue;
    try {
      state[row.key] = { value: JSON.parse(row.value), updatedAt: row.updated_at };
    } catch {
      // A corrupt row is skipped; the client's next save replaces it.
    }
  }
  return json({ state });
}

export async function handlePutState(env, request, key) {
  const userId = await requireUser(env, request);
  if (!SYNCED_KEYS.has(key)) throw appError("That setting cannot be saved to your account.", 404);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_VALUE_BYTES) throw appError("That setting is too large to save.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_VALUE_BYTES) throw appError("That setting is too large to save.", 413);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw appError("Settings must be JSON.", 400);
  }
  if (value === null || typeof value !== "object") throw appError("Settings must be a JSON object.", 400);
  const updatedAt = Math.floor(Date.now() / 1000);
  await requireDb(env)
    .prepare(`INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(userId, key, JSON.stringify(value), updatedAt)
    .run();
  return json({ saved: key, updatedAt });
}
