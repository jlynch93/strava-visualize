const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const { LocalD1 } = require("../scripts/d1-sqlite.js");

const workerPromise = import(pathToFileURL(path.resolve(__dirname, "../src/worker.js")).href).then((module) => module.default);

function env(overrides = {}) {
  return {
    STRAVA_CLIENT_ID: "client",
    STRAVA_CLIENT_SECRET: "secret",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
    DB: new LocalD1(":memory:"),
    ASSETS: { fetch: async () => new Response("asset") },
    ...overrides
  };
}
function request(pathname, { cookie, method = "GET", body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://runlore.test${pathname}`, { method, headers, body });
}
const cookieValue = (response, name) => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0] || null;
function mockStrava(t, athleteId = 42) {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (new URL(url).pathname === "/oauth/token") return Response.json({ access_token: "a", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { id: athleteId, firstname: "Jo" } });
    return Response.json([]);
  });
}
async function signIn(worker, testEnv) {
  const login = await worker.fetch(request("/auth/strava/login"), testEnv);
  const state = new URL(login.headers.get("location")).searchParams.get("state");
  const callback = await worker.fetch(request(`/auth/strava/callback?code=c&state=${state}`, { cookie: cookieValue(login, "sv_oauth_state") }), testEnv);
  return cookieValue(callback, "sv_session");
}
const soon = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const feedPath = (url) => new URL(url).pathname;

test("a signed-in runner gets one calendar link that serves their saved plan and races", async (t) => {
  const worker = await workerPromise; const testEnv = env(); mockStrava(t);
  const session = await signIn(worker, testEnv);
  assert.equal((await worker.fetch(request("/api/calendar"), testEnv)).status, 401, "signed out: no link");
  assert.deepEqual(await (await worker.fetch(request("/api/calendar", { cookie: session }), testEnv)).json(), { url: null });
  const week = soon(3);
  await worker.fetch(request("/api/state/run-trends-plans-v1", { cookie: session, method: "PUT", body: JSON.stringify({ [week]: { savedAt: new Date().toISOString(), sessions: [
    { date: week, type: "long", title: "Long run", detail: "Easy pace", kind: "run", miles: 10, status: "planned", matchedId: "" },
    { date: soon(4), type: "rest", title: "Rest / mobility", detail: "", kind: "rest", miles: 0, status: "planned", matchedId: "" }
  ] } }) }), testEnv);
  await worker.fetch(request("/api/state/run-trends-coaching-context-v1", { cookie: session, method: "PUT", body: JSON.stringify({ goal: {}, races: [{ id: "x", name: "Turkey Trot", date: soon(10), distance: "5K", priority: "A" }] }) }), testEnv);
  await worker.fetch(request("/api/state/run-trends-preferences", { cookie: session, method: "PUT", body: JSON.stringify({ units: "metric" }) }), testEnv);

  const created = await worker.fetch(request("/api/calendar", { cookie: session, method: "POST" }), testEnv);
  assert.equal(created.status, 201);
  const { url } = await created.json();
  assert.match(url, /^https:\/\/runlore\.test\/api\/calendar\/feed\/[A-Za-z0-9_-]{32}\.ics$/);
  assert.equal((await (await worker.fetch(request("/api/calendar", { cookie: session }), testEnv)).json()).url, url, "the same link can be shown again");

  // Calendar apps fetch with no cookie.
  const feed = await worker.fetch(request(feedPath(url)), testEnv);
  assert.equal(feed.status, 200);
  assert.equal(feed.headers.get("content-type"), "text/calendar; charset=utf-8");
  const ics = await feed.text();
  assert.match(ics, /SUMMARY:Long run · 16\.1 km/);
  assert.match(ics, /SUMMARY:🏁 Turkey Trot · 5K/);
  assert.doesNotMatch(ics, /Rest \/ mobility/);
  assert.equal((await worker.fetch(request(feedPath(url), { method: "HEAD" }), testEnv)).status, 200);

  // Edits on the site show up in the same feed.
  await worker.fetch(request("/api/state/run-trends-plans-v1", { cookie: session, method: "PUT", body: JSON.stringify({ [week]: { savedAt: new Date().toISOString(), sessions: [
    { date: week, type: "quality", title: "Quality option", detail: "", kind: "run", miles: 8.4, status: "planned", matchedId: "", notes: "Track, lane 3",
      workout: { warmup: { amount: 2, unit: "mi" }, sets: [{ reps: 4, work: { amount: 1, unit: "mi", intensity: "threshold" }, recovery: { amount: 75, unit: "s", mode: "jog" } }], cooldown: { amount: 2, unit: "mi" } } }
  ] } }) }), testEnv);
  const edited = (await (await worker.fetch(request(feedPath(url)), testEnv)).text()).replace(/\r\n /g, "");
  assert.match(edited, /SUMMARY:Quality option · 13\.5 km/);
  assert.match(edited, /DESCRIPTION:2 mi warm-up · 4 × 1 mi @ threshold\\, 75 s jog · 2 mi cool-down\\nNotes: Track\\, lane 3\\n/, "the workout and notes are in the event");
});

test("a new link retires the old one, stopping removes it, and unknown links are not found", async (t) => {
  const worker = await workerPromise; const testEnv = env(); mockStrava(t);
  const session = await signIn(worker, testEnv);
  const first = (await (await worker.fetch(request("/api/calendar", { cookie: session, method: "POST" }), testEnv)).json()).url;
  const second = (await (await worker.fetch(request("/api/calendar", { cookie: session, method: "POST" }), testEnv)).json()).url;
  assert.notEqual(first, second);
  assert.equal((await worker.fetch(request(feedPath(first)), testEnv)).status, 404);
  assert.equal((await worker.fetch(request(feedPath(second)), testEnv)).status, 200);
  await worker.fetch(request("/api/calendar", { cookie: session, method: "DELETE" }), testEnv);
  assert.equal((await worker.fetch(request(feedPath(second)), testEnv)).status, 404);
  assert.equal((await worker.fetch(request("/api/calendar/feed/short.ics"), testEnv)).status, 404);
  assert.equal((await worker.fetch(request("/api/calendar/feed/../../etc.ics"), testEnv)).status, 404);
});

test("each runner's link serves only their own plan", async (t) => {
  const worker = await workerPromise; const testEnv = env();
  mockStrava(t, 1); const a = await signIn(worker, testEnv);
  t.mock.restoreAll(); mockStrava(t, 2); const b = await signIn(worker, testEnv);
  const day = soon(2);
  for (const [session, title] of [[a, "Runner A run"], [b, "Runner B run"]]) {
    await worker.fetch(request("/api/state/run-trends-plans-v1", { cookie: session, method: "PUT", body: JSON.stringify({ [day]: { savedAt: new Date().toISOString(), sessions: [{ date: day, title, kind: "run", miles: 3, status: "planned", matchedId: "" }] } }) }), testEnv);
  }
  const url = (await (await worker.fetch(request("/api/calendar", { cookie: a, method: "POST" }), testEnv)).json()).url;
  const ics = await (await worker.fetch(request(feedPath(url)), testEnv)).text();
  assert.match(ics, /Runner A run/);
  assert.doesNotMatch(ics, /Runner B run/);
});

test("deleting the account stops its calendar link", async (t) => {
  const worker = await workerPromise; const testEnv = env(); mockStrava(t);
  const session = await signIn(worker, testEnv);
  const url = (await (await worker.fetch(request("/api/calendar", { cookie: session, method: "POST" }), testEnv)).json()).url;
  assert.equal((await worker.fetch(request("/api/me", { cookie: session, method: "DELETE" }), testEnv)).status, 200);
  assert.equal((await worker.fetch(request(feedPath(url)), testEnv)).status, 404);
  assert.equal(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM calendar_feeds").first("count"), 0);
});
