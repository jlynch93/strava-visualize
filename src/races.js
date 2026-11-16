import { appError, json } from "./http.js";

// Public race search on RunSignup (no key needed). The Worker calls it so the
// browser makes no third-party requests, results can be cached, and only the
// fields the race form uses are passed on (no descriptions or HTML).
const RUNSIGNUP = "https://runsignup.com/Rest/races";
const CACHE_SECONDS = 6 * 60 * 60;
const MAX_RESULTS = 12;

// Kept: in-person running and walking events. Dropped: virtual races,
// memberships, volunteer and donation entries.
const EVENT_TYPES = new Set(["running_race", "running_only", "walking_only", "trail_race", "race"]);

const KM = { k: 1, km: 1, kilometer: 1, kilometers: 1, kilometre: 1, kilometres: 1, m: 0.001, meter: 0.001, meters: 0.001, metre: 0.001, metres: 0.001, mi: 1.609344, mile: 1.609344, miles: 1.609344, yd: 0.0009144, yard: 0.0009144, yards: 0.0009144 };

// "5K", "21.097K", "13.1 Miles", "100m", "100 Yards", "26.2 mi" -> kilometres.
// Falls back to words in the event name ("Half Marathon"). Null if unknown.
export function parseDistanceKm(distance, name = "") {
  const text = String(distance || "").trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?\.?$/);
  if (match) {
    const unit = match[2] || "";
    if (unit in KM) return Number(match[1]) * KM[unit];
  }
  const words = `${text} ${String(name).toLowerCase()}`;
  if (/half[\s-]*marathon|1\/2 marathon/.test(words)) return 21.0975;
  if (/marathon/.test(words) && !/ultra/.test(words)) return 42.195;
  const inName = String(name).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(k|km|mi|mile|miles)\b/);
  if (inName) return Number(inName[1]) * KM[inName[2]];
  return null;
}

// The race form's categories.
export function distanceCategory(km) {
  if (!Number.isFinite(km)) return "Other";
  if (Math.abs(km - 5) <= 0.3) return "5K";
  if (Math.abs(km - 10) <= 0.4) return "10K";
  if (Math.abs(km - 21.0975) <= 0.5) return "Half marathon";
  if (Math.abs(km - 42.195) <= 0.8) return "Marathon";
  return "Other";
}

// "11/21/2026 09:15" or "11/21/2026" -> "2026-11-21".
export function isoDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

const dayDiff = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;

// Trims RunSignup's response to races with at least one usable event between
// `from` and `to` (YYYY-MM-DD).
export function normalizeRaces(data, { from, to }) {
  const races = [];
  for (const item of Array.isArray(data?.races) ? data.races : []) {
    const race = item?.race;
    if (!race || race.is_draft_race === "T" || race.is_private_race === "T") continue;
    const events = [];
    for (const event of Array.isArray(race.events) ? race.events : []) {
      if (!EVENT_TYPES.has(String(event?.event_type))) continue;
      const date = isoDate(event.start_time);
      const endDate = isoDate(event.end_time) || date;
      // Multi-day "events" are memberships or challenges, not race days.
      if (!date || date < from || date > to || dayDiff(date, endDate) > 2) continue;
      const km = parseDistanceKm(event.distance, event.name);
      if (km !== null && km < 1) continue; // Kids' dashes and sprints.
      events.push({
        id: String(event.event_id),
        name: String(event.name || "").slice(0, 80),
        date,
        km: km === null ? null : Math.round(km * 100) / 100,
        distance: distanceCategory(km),
        walk: event.event_type === "walking_only"
      });
    }
    if (!events.length) continue;
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.km ?? 0) - (b.km ?? 0));
    const url = String(race.url || "");
    races.push({
      id: String(race.race_id),
      name: String(race.name || "").slice(0, 100),
      date: events[0].date,
      city: String(race.address?.city || "").slice(0, 60),
      state: String(race.address?.state || "").slice(0, 20),
      // Only RunSignup's own race pages are linked.
      url: /^https:\/\/runsignup\.com\//.test(url) ? url : "",
      events: events.slice(0, 8)
    });
  }
  return races.sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_RESULTS);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function handleRaceSearch(request, ctx) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (query.length < 3) throw appError("Type at least three letters of the race name.", 400);
  const state = String(url.searchParams.get("state") || "").trim().toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) throw appError("Use a two-letter state code, like OH.", 400);
  const from = todayIso();
  const toDate = new Date(); toDate.setUTCFullYear(toDate.getUTCFullYear() + 1);
  const to = toDate.toISOString().slice(0, 10);

  const upstream = new URL(RUNSIGNUP);
  upstream.search = new URLSearchParams({
    format: "json", events: "T", name: query, start_date: from, end_date: to,
    results_per_page: "40", page: "1", sort: "date ASC", ...(state ? { state } : {})
  }).toString();

  // Same query, same day -> one upstream call (Cloudflare edge cache).
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://race-search.runlore.internal/?${new URLSearchParams({ q: query.toLowerCase(), state, from })}`);
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return cached;

  let response;
  try {
    response = await fetch(upstream, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  } catch {
    throw appError("Race search is not responding right now. Enter the race by hand.", 504);
  }
  if (!response.ok) throw appError("Race search is unavailable right now. Enter the race by hand.", 502);
  let data;
  try { data = await response.json(); } catch { throw appError("Race search returned an unreadable answer.", 502); }
  const result = json({ races: normalizeRaces(data, { from, to }), source: "RunSignup" });
  result.headers.set("cache-control", `public, max-age=${CACHE_SECONDS}`);
  if (cache) {
    const store = cache.put(cacheKey, result.clone());
    if (ctx?.waitUntil) ctx.waitUntil(store); else await store;
  }
  return result;
}
