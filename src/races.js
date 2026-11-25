import { appError, json } from "./http.js";

// Public race search on RunSignup (no key needed). The Worker calls it so the
// browser makes no third-party requests, results can be cached, and only the
// fields the race form uses are passed on (no descriptions or HTML).
const RUNSIGNUP = "https://runsignup.com/Rest/races";

// From January 1, 2027 RunSignup rejects API calls that do not carry an API
// caller registration: the token as the rsu_api_reg parameter and the secret
// in the X-RSU-API-REG-SECRET header. Register (free) at
// https://runsignup.com/API/ApiKeys and set both as Worker secrets.
let warnedUnregistered = false;
export function runsignupRequest(url, env = {}) {
  const target = new URL(url);
  const headers = { accept: "application/json" };
  const token = String(env.RUNSIGNUP_API_REG_TOKEN || "").trim();
  const secret = String(env.RUNSIGNUP_API_REG_SECRET || "").trim();
  if (token && secret) {
    target.searchParams.set("rsu_api_reg", token);
    headers["X-RSU-API-REG-SECRET"] = secret;
  } else if (!warnedUnregistered) {
    warnedUnregistered = true;
    console.warn(JSON.stringify({ event: "runsignup_unregistered", message: "Set RUNSIGNUP_API_REG_TOKEN and RUNSIGNUP_API_REG_SECRET: RunSignup rejects unregistered API calls from January 1, 2027." }));
  }
  return { url: target, headers };
}
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

export async function handleRaceSearch(request, ctx, env = {}) {
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
    const call = runsignupRequest(upstream, env);
    response = await fetch(call.url, { headers: call.headers, signal: AbortSignal.timeout(8_000) });
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

/* ---------- Past results: the field a runner would finish in ---------- */

const RESULTS_CACHE_SECONDS = 7 * 24 * 60 * 60;
const RESULTS_PAGE = 2500;
const RESULTS_MAX_PAGES = 8;

// "18:00.5", "1:44:58.9", "2:03:11" -> seconds. Null if not a time.
export function parseResultSeconds(value) {
  const match = String(value || "").trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/);
  if (!match) return null;
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return seconds > 0 ? seconds : null;
}

// Past in-person editions of a race at this distance, newest first.
export function pastEditions(race, km, today) {
  const editions = [];
  for (const event of Array.isArray(race?.events) ? race.events : []) {
    if (!EVENT_TYPES.has(String(event?.event_type)) || /virtual/i.test(String(event?.name))) continue;
    const date = isoDate(event.start_time);
    if (!date || date >= today) continue;
    const eventKm = parseDistanceKm(event.distance, event.name);
    if (eventKm === null || Math.abs(eventKm - km) / km > 0.03) continue;
    editions.push({ id: String(event.event_id), name: String(event.name || "").slice(0, 80), date });
  }
  return editions.sort((a, b) => b.date.localeCompare(a.date));
}

// Result rows -> [seconds, "M" | "F" | "X", age | null], fastest first.
// Names, bibs and home towns never leave this function.
export function anonymousField(results) {
  const field = [];
  for (const row of Array.isArray(results) ? results : []) {
    const seconds = parseResultSeconds(row?.chip_time) ?? parseResultSeconds(row?.clock_time);
    if (!seconds) continue;
    const gender = row.gender === "M" || row.gender === "F" ? row.gender : "X";
    const age = Number.isInteger(row.age) && row.age > 0 && row.age < 110 ? row.age : null;
    field.push([seconds, gender, age]);
  }
  return field.sort((a, b) => a[0] - b[0]);
}

async function runsignupJson(url, env) {
  let response;
  try {
    const call = runsignupRequest(url, env);
    response = await fetch(call.url, { headers: call.headers, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw appError("Past results are not responding right now.", 504);
  }
  if (!response.ok) throw appError("Past results are unavailable right now.", 502);
  try { return await response.json(); } catch { throw appError("Past results returned an unreadable answer.", 502); }
}

async function editionField(raceId, eventId, env) {
  const rows = [];
  let best = null;
  for (let page = 1; page <= RESULTS_MAX_PAGES; page += 1) {
    const data = await runsignupJson(`https://runsignup.com/Rest/race/${raceId}/results/get-results?format=json&event_id=${eventId}&results_per_page=${RESULTS_PAGE}&page=${page}${best ? `&individual_result_set_id=${best}` : ""}`, env);
    const sets = (Array.isArray(data?.individual_results_sets) ? data.individual_results_sets : []).filter((set) => set?.public_results !== "F");
    // An event can hold several result sets (walkers, wheelchair); take the largest.
    const set = best ? sets.find((item) => item.individual_result_set_id === best) : sets.sort((a, b) => (b.results?.length || 0) - (a.results?.length || 0))[0];
    if (!set?.results?.length) break;
    best = set.individual_result_set_id;
    rows.push(...set.results);
    if (set.results.length < RESULTS_PAGE) break;
  }
  return anonymousField(rows);
}

// GET /api/races/field?race=<RunSignup race id>&km=<distance>
// The most recent past edition's finish times, with gender and age only.
export async function handleRaceField(request, ctx, env = {}) {
  const url = new URL(request.url);
  const raceId = String(url.searchParams.get("race") || "");
  const km = Number(url.searchParams.get("km"));
  if (!/^\d{1,9}$/.test(raceId)) throw appError("Unknown race.", 400);
  if (!Number.isFinite(km) || km < 1 || km > 200) throw appError("Unknown race distance.", 400);

  const cache = globalThis.caches?.default;
  const today = todayIso();
  const cacheKey = new Request(`https://race-field.runlore.internal/?${new URLSearchParams({ race: raceId, km: km.toFixed(2), week: today.slice(0, 8) + (Number(today.slice(8)) > 15 ? "b" : "a") })}`);
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return cached;

  const data = await runsignupJson(`https://runsignup.com/Rest/race/${raceId}?format=json&most_recent_events_only=F&race_event_days=F`, env);
  let found = null;
  // Last year's edition may have no posted results; look back a few years.
  for (const edition of pastEditions(data?.race, km, today).slice(0, 3)) {
    const field = await editionField(raceId, edition.id, env);
    if (field.length >= 10) { found = { ...edition, field }; break; }
  }
  const result = json(found
    ? { source: "RunSignup", event: found.name, date: found.date, finishers: found.field.length, field: found.field }
    : { source: "RunSignup", field: null });
  result.headers.set("cache-control", `public, max-age=${RESULTS_CACHE_SECONDS}`);
  if (cache) {
    const store = cache.put(cacheKey, result.clone());
    if (ctx?.waitUntil) ctx.waitUntil(store); else await store;
  }
  return result;
}
