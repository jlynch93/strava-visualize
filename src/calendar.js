// Calendar subscription: a secret link that serves the signed-in runner's saved
// plan weeks and races as an iCalendar feed, so Apple Calendar, Google Calendar
// and others show the plan and pick up changes when they next refresh it.
import { appError, json } from "./http.js";
import { isMissingTable, requireDb } from "./db.js";
import { requireUser } from "./auth.js";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "./crypto.js";
import CalendarCore from "../public/calendar-core.js";
import TrainingCore from "../public/training-core.js";

const FEED_PATH = "/api/calendar/feed/";
// Weeks before this many days ago are left off the feed: old weeks only clutter
// a calendar, and the app keeps them.
const HISTORY_DAYS = 56;

function feedUrl(env, request, token) {
  const origin = (env.APP_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");
  return `${origin}${FEED_PATH}${token}.ics`;
}

// Migrations are applied by hand, so the table may not exist yet.
async function withFeedsTable(work) {
  try {
    return await work();
  } catch (error) {
    if (isMissingTable(error)) throw appError("Calendar links need the latest database migration: npx wrangler d1 migrations apply strava-visualize --remote", 503);
    throw error;
  }
}

// GET shows the current link, POST makes a new one (the old one stops working),
// DELETE stops sharing.
export async function handleCalendarLink(env, request) {
  const userId = await requireUser(env, request);
  const db = requireDb(env);
  if (request.method === "GET") {
    const row = await withFeedsTable(() => db.prepare("SELECT token_enc, created_at FROM calendar_feeds WHERE user_id = ?").bind(userId).first());
    if (!row) return json({ url: null });
    try {
      return json({ url: feedUrl(env, request, await decryptSecret(env, row.token_enc)), createdAt: row.created_at });
    } catch {
      // The encryption key changed: the link still works for calendars that
      // have it, but it can no longer be shown. A new link fixes that.
      return json({ url: null, unreadable: true });
    }
  }
  if (request.method === "POST") {
    const token = randomToken(24);
    const createdAt = Math.floor(Date.now() / 1000);
    const tokenHash = await sha256(token);
    const tokenEnc = await encryptSecret(env, token);
    await withFeedsTable(() => db
      .prepare(`INSERT INTO calendar_feeds (user_id, token_hash, token_enc, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, token_enc = excluded.token_enc, created_at = excluded.created_at`)
      .bind(userId, tokenHash, tokenEnc, createdAt)
      .run());
    return json({ url: feedUrl(env, request, token), createdAt }, 201);
  }
  if (request.method === "DELETE") {
    await withFeedsTable(() => db.prepare("DELETE FROM calendar_feeds WHERE user_id = ?").bind(userId).run());
    return json({ url: null });
  }
  throw appError("Method not allowed.", 405);
}

function notFound() {
  return new Response("This calendar link is not active. Make a new one in Runlore's Plan.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function parsed(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

// Public: calendar apps fetch it without cookies, so the token is the
// credential. It is 24 random bytes, compared by hash.
export async function handleCalendarFeed(env, request, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return notFound();
  const db = requireDb(env);
  let row = null;
  try {
    row = await db.prepare("SELECT user_id FROM calendar_feeds WHERE token_hash = ?").bind(await sha256(token)).first();
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  if (!row) return notFound();
  const { results } = await db
    .prepare("SELECT key, value FROM user_state WHERE user_id = ? AND key IN (?, ?, ?)")
    .bind(row.user_id, "run-trends-plans-v1", "run-trends-coaching-context-v1", "run-trends-preferences")
    .all();
  const state = Object.fromEntries((results || []).map((item) => [item.key, parsed(item.value, null)]));
  const since = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  const body = CalendarCore.buildPlanCalendar({
    plans: state["run-trends-plans-v1"] || {},
    races: state["run-trends-coaching-context-v1"]?.races || [],
    units: state["run-trends-preferences"]?.units === "metric" ? "metric" : "imperial",
    since,
    domain: new URL(feedUrl(env, request, token)).hostname,
    describeWorkout: TrainingCore.workoutSummary
  });
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="runlore-plan.ics"',
      // Short, private caching: calendar apps poll, and edits should show up
      // on their next refresh rather than wait out a long cache.
      "cache-control": "private, max-age=300"
    }
  });
}
