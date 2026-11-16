const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const { LocalD1 } = require("../scripts/d1-sqlite.js");

const src = (file) => import(pathToFileURL(path.resolve(__dirname, "../src", file)).href);
const workerPromise = src("worker.js").then((module) => module.default);
const garminPromise = src("providers/garmin.js");
const WEBHOOK_SECRET = "webhook-secret-for-tests";

function env(overrides = {}) {
  return {
    STRAVA_CLIENT_ID: "strava-client",
    STRAVA_CLIENT_SECRET: "strava-secret",
    GARMIN_CLIENT_ID: "garmin-client",
    GARMIN_CLIENT_SECRET: "garmin-secret",
    GARMIN_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    DB: new LocalD1(":memory:"),
    ASSETS: { fetch: async () => new Response("asset") },
    ...overrides
  };
}

function request(pathname, { cookie, method = "GET", body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://example.test${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function cookieValue(response, name) {
  const match = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return match ? match.split(";")[0] : null;
}

function webhook(body, secret = WEBHOOK_SECRET) {
  return request(`/webhooks/garmin/${secret}`, { method: "POST", body });
}

function summary(overrides = {}) {
  return {
    userId: "garmin-user-1",
    summaryId: "s-100",
    activityId: 100,
    activityName: "Lunch run",
    activityType: "RUNNING",
    startTimeInSeconds: Date.UTC(2026, 9, 1, 12, 0, 0) / 1000,
    startTimeOffsetInSeconds: -4 * 3600,
    durationInSeconds: 1800,
    distanceInMeters: 5000,
    totalElevationGainInMeters: 40,
    averageSpeedInMetersPerSecond: 2.78,
    averageHeartRateInBeatsPerMinute: 150,
    startingLatitudeInDegree: 40.1,
    startingLongitudeInDegree: -75.2,
    ...overrides
  };
}

// Fakes Garmin's token, user-id, backfill and registration endpoints.
function mockGarmin(t, { userId = "garmin-user-1", backfillStatus = 202, callbackData = [] } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const target = new URL(url);
    calls.push({ url: target, options });
    // Strava, for the multi-provider tests.
    if (target.hostname === "www.strava.com") {
      return Response.json({ access_token: "s", refresh_token: "r", expires_at: Date.now() / 1000 + 3600, athlete: { id: 7, firstname: "Jo" } });
    }
    if (target.pathname.endsWith("/oauth/token")) {
      return Response.json({ access_token: "garmin-access", refresh_token: "garmin-refresh", expires_in: 86400, scope: "ACTIVITY_EXPORT" });
    }
    if (target.pathname.endsWith("/user/id")) return Response.json({ userId });
    if (target.pathname.includes("/backfill/activities")) {
      const status = typeof backfillStatus === "function" ? backfillStatus() : backfillStatus;
      return new Response(status === 202 ? "" : "{}", { status });
    }
    if (target.pathname.endsWith("/user/registration")) return new Response(null, { status: 204 });
    if (target.pathname.includes("/activities")) return Response.json(callbackData);
    return Response.json({});
  });
  return calls;
}

async function signIn(worker, testEnv, provider = "garmin", cookie) {
  const login = await worker.fetch(request(`/auth/${provider}/login`, { cookie }), testEnv);
  const state = new URL(login.headers.get("location")).searchParams.get("state");
  const cookies = [cookieValue(login, "sv_oauth_state"), cookieValue(login, "sv_oauth_verifier"), cookie].filter(Boolean).join("; ");
  const callback = await worker.fetch(request(`/auth/${provider}/callback?code=code&state=${state}`, { cookie: cookies }), testEnv);
  return { login, callback, session: cookieValue(callback, "sv_session") || cookie };
}

test("Garmin sign-in uses PKCE with an S256 challenge of a cookie-held verifier", async () => {
  const worker = await workerPromise;
  const login = await worker.fetch(request("/auth/garmin/login"), env());
  assert.equal(login.status, 302);
  const location = new URL(login.headers.get("location"));
  assert.equal(location.origin + location.pathname, "https://connect.garmin.com/oauth2Confirm");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.equal(location.searchParams.get("redirect_uri"), "https://example.test/auth/garmin/callback");
  const verifier = decodeURIComponent(cookieValue(login, "sv_oauth_verifier").split("=")[1]);
  assert.ok(verifier.length >= 43 && verifier.length <= 128, "PKCE verifiers must be 43-128 characters.");
  const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(location.searchParams.get("code_challenge"), expected);
  assert.doesNotMatch(location.toString(), new RegExp(verifier), "The verifier itself must never be sent to Garmin.");
  assert.match(login.headers.getSetCookie().find((value) => value.startsWith("sv_oauth_verifier=")), /HttpOnly/);
});

test("Garmin stays unavailable until the client and webhook secrets are configured", async () => {
  const worker = await workerPromise;
  const status = await (await worker.fetch(request("/api/status"), env({ GARMIN_WEBHOOK_SECRET: "" }))).json();
  const garmin = status.providers.find((provider) => provider.id === "garmin");
  assert.equal(garmin.configured, false);
  assert.match(garmin.error, /GARMIN_WEBHOOK_SECRET/);
  assert.equal(status.configured, true, "Strava alone still makes sign-in available.");
  const login = await worker.fetch(request("/auth/garmin/login"), env({ GARMIN_CLIENT_ID: "" }));
  assert.equal(login.status, 503);
});

test("A Garmin callback without its verifier cookie is rejected before any token exchange", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  const calls = mockGarmin(t);
  const login = await worker.fetch(request("/auth/garmin/login"), testEnv);
  const state = new URL(login.headers.get("location")).searchParams.get("state");
  const callback = await worker.fetch(request(`/auth/garmin/callback?code=code&state=${state}`, { cookie: cookieValue(login, "sv_oauth_state") }), testEnv);
  assert.equal(callback.headers.get("location"), "/?auth_error=expired");
  assert.equal(calls.length, 0);
});

test("Connecting Garmin exchanges the code with the verifier and requests a history backfill", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  const calls = mockGarmin(t);
  const { login, callback, session } = await signIn(worker, testEnv);
  assert.equal(callback.headers.get("location"), "/?signedin=garmin");
  assert.match(callback.headers.get("set-cookie"), /sv_oauth_verifier=; Path=\/; Max-Age=0/);

  const tokenCall = calls.find((call) => call.url.pathname.endsWith("/oauth/token"));
  const form = new URLSearchParams(tokenCall.options.body);
  assert.equal(form.get("code_verifier"), decodeURIComponent(cookieValue(login, "sv_oauth_verifier").split("=")[1]));
  assert.equal(form.get("redirect_uri"), "https://example.test/auth/garmin/callback");

  const backfills = calls.filter((call) => call.url.pathname.includes("/backfill/activities"));
  assert.equal(backfills.length, 4);
  for (const call of backfills) {
    const start = Number(call.url.searchParams.get("summaryStartTimeInSeconds"));
    const end = Number(call.url.searchParams.get("summaryEndTimeInSeconds"));
    assert.equal(end - start, 90 * 24 * 60 * 60, "Each backfill request stays within Garmin's 90-day limit.");
    assert.equal(call.options.headers.authorization, "Bearer garmin-access");
  }

  const me = await (await worker.fetch(request("/api/me", { cookie: session }), testEnv)).json();
  assert.deepEqual(me.connections.map((connection) => connection.provider), ["garmin"]);
  const empty = await (await worker.fetch(request("/api/activities?provider=garmin", { cookie: session }), testEnv)).json();
  assert.deepEqual(empty.activities, []);
  assert.ok(empty.connectedAt, "The client uses connectedAt to explain that history is still arriving.");
});

test("A failed backfill does not undo a successful Garmin sign-in", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t, { backfillStatus: 500 });
  t.mock.method(console, "warn", () => {});
  const { callback } = await signIn(worker, testEnv);
  assert.equal(callback.headers.get("location"), "/?signedin=garmin");
  assert.ok(cookieValue(callback, "sv_session"));
});

test("Garmin summaries map onto the fields the dashboard reads", async () => {
  const { toStravaShape } = await garminPromise;
  const activity = toStravaShape(summary());
  assert.equal(activity.id, "100");
  assert.equal(activity.sport_type, "Run");
  assert.equal(activity.start_date, "2026-10-01T12:00:00Z");
  assert.equal(activity.start_date_local, "2026-10-01T08:00:00Z", "Local wall-clock time uses Strava's Z-suffixed convention.");
  assert.equal(activity.distance, 5000);
  assert.equal(activity.moving_time, 1800);
  assert.equal(activity.average_heartrate, 150);
  assert.deepEqual(activity.start_latlng, [40.1, -75.2]);
  assert.equal(toStravaShape(summary({ activityType: "TRAIL_RUNNING" })).sport_type, "TrailRun");
  assert.equal(toStravaShape(summary({ activityType: "CYCLING" })).sport_type, "Ride");
  assert.equal(toStravaShape(summary({ activityType: "PADDLEBOARDING" })).sport_type, "Workout");
  assert.equal(toStravaShape(summary({ startTimeInSeconds: undefined })), null);
  assert.equal("start_latlng" in toStravaShape(summary({ startingLatitudeInDegree: undefined })), false);
});

test("The webhook requires its secret and stores pushed activities only for connected users", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t);
  const { session } = await signIn(worker, testEnv);

  const wrongSecret = await worker.fetch(webhook({ activities: [summary()] }, "guess"), testEnv);
  assert.equal(wrongSecret.status, 404);
  const malformed = await worker.fetch(new Request(`https://example.test/webhooks/garmin/${WEBHOOK_SECRET}`, { method: "POST", body: "not json" }), testEnv);
  assert.equal(malformed.status, 400);

  const pushed = await worker.fetch(webhook({
    activities: [
      summary(),
      summary({ activityId: 101, summaryId: "s-101", startTimeInSeconds: Date.UTC(2026, 9, 3, 12) / 1000, activityName: "Tempo" }),
      summary({ userId: "stranger", activityId: 999 })
    ],
    activityDetails: [{ userId: "garmin-user-1", summaryId: "d-102", activityId: 102, summary: summary({ activityId: undefined, activityName: "Long run", startTimeInSeconds: Date.UTC(2026, 9, 5, 12) / 1000 }), samples: [{}] }]
  }), testEnv);
  assert.equal(pushed.status, 200);
  assert.deepEqual(await pushed.json(), { received: true, stored: 3 });

  // Re-delivery of the same activity updates it instead of duplicating it.
  await worker.fetch(webhook({ manuallyUpdatedActivities: [summary({ activityName: "Lunch run (edited)" })] }), testEnv);

  const list = await (await worker.fetch(request("/api/activities?provider=garmin", { cookie: session }), testEnv)).json();
  assert.deepEqual(list.activities.map((activity) => activity.name), ["Long run", "Tempo", "Lunch run (edited)"]);
  assert.equal(list.truncated, false);
  assert.equal(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM activities").first("count"), 3, "Data for unknown Garmin users is dropped.");
  const stored = await testEnv.DB.prepare("SELECT data FROM activities WHERE activity_id = '102'").first("data");
  assert.doesNotMatch(stored, /samples/, "Only summaries are stored, never samples.");

  const after = Date.UTC(2026, 9, 2) / 1000;
  const filtered = await (await worker.fetch(request(`/api/activities?provider=garmin&after=${after}&per_page=1&pages=1`, { cookie: session }), testEnv)).json();
  assert.deepEqual(filtered.activities.map((activity) => activity.name), ["Long run"]);
  assert.equal(filtered.truncated, true);

  const detail = await worker.fetch(request("/api/activities/101?provider=garmin", { cookie: session }), testEnv);
  assert.equal((await detail.json()).activity.name, "Tempo");
  const missing = await worker.fetch(request("/api/activities/555?provider=garmin", { cookie: session }), testEnv);
  assert.equal(missing.status, 404);
});

test("Ping notifications are fetched from Garmin with the user's token, and only from Garmin", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  const calls = mockGarmin(t, { callbackData: [summary({ activityId: 200, activityName: "From callback" })] });
  const { session } = await signIn(worker, testEnv);
  const callbackURL = "https://apis.garmin.com/wellness-api/rest/activities?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2&token=abc";
  const ping = await worker.fetch(webhook({ activities: [{ userId: "garmin-user-1", callbackURL }] }), testEnv);
  assert.equal(ping.status, 200);
  const callbackCall = calls.find((call) => call.url.toString() === callbackURL);
  assert.equal(callbackCall.options.headers.authorization, "Bearer garmin-access");
  const list = await (await worker.fetch(request("/api/activities?provider=garmin", { cookie: session }), testEnv)).json();
  assert.equal(list.activities[0].name, "From callback");

  const before = calls.length;
  const hostile = await worker.fetch(webhook({ activities: [{ userId: "garmin-user-1", callbackURL: "https://attacker.example/steal" }] }), testEnv);
  assert.equal(hostile.status, 400);
  assert.equal(calls.length, before, "The user's Garmin token must never be sent to another host.");
});

test("Removing activity permission deletes stored Garmin activities", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t);
  await signIn(worker, testEnv);
  await worker.fetch(webhook({ activities: [summary()] }), testEnv);
  await worker.fetch(webhook({ userPermissionsChange: [{ userId: "garmin-user-1", permissions: ["ACTIVITY_EXPORT"] }] }), testEnv);
  assert.equal(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM activities").first("count"), 1);
  await worker.fetch(webhook({ userPermissionsChange: [{ userId: "garmin-user-1", permissions: ["HEALTH_EXPORT"] }] }), testEnv);
  assert.equal(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM activities").first("count"), 0);
  assert.equal(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM provider_connections").first("count"), 1, "The connection itself remains.");
});

test("A Garmin deregistration removes the connection, and the profile when Garmin was its only sign-in", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t);
  const garminOnly = await signIn(worker, testEnv);
  await worker.fetch(webhook({ activities: [summary()] }), testEnv);
  await worker.fetch(webhook({ deregistrations: [{ userId: "garmin-user-1" }] }), testEnv);
  for (const table of ["users", "sessions", "provider_connections", "activities"]) {
    assert.equal(await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first("count"), 0, `${table} must be empty`);
  }
  assert.equal((await worker.fetch(request("/api/me", { cookie: garminOnly.session }), testEnv)).status, 401);
});

test("A deregistration keeps a profile that can still sign in with Strava", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t);
  const strava = await signIn(worker, testEnv, "strava");
  await signIn(worker, testEnv, "garmin", strava.session);
  await worker.fetch(webhook({ deregistrations: [{ userId: "garmin-user-1" }] }), testEnv);
  const me = await (await worker.fetch(request("/api/me", { cookie: strava.session }), testEnv)).json();
  assert.deepEqual(me.connections.map((connection) => connection.provider), ["strava"]);
});

test("Disconnecting Garmin deregisters at Garmin and deletes its stored activities", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  const calls = mockGarmin(t);
  const strava = await signIn(worker, testEnv, "strava");
  const linked = await signIn(worker, testEnv, "garmin", strava.session);
  assert.equal(linked.callback.headers.get("location"), "/?connected=garmin");
  await worker.fetch(webhook({ activities: [summary()] }), testEnv);

  const response = await worker.fetch(request("/api/connections/garmin", { cookie: strava.session, method: "DELETE" }), testEnv);
  assert.equal(response.status, 200);
  const deregistration = calls.find((call) => call.url.pathname.endsWith("/user/registration"));
  assert.equal(deregistration.options.method, "DELETE");
  assert.equal(deregistration.options.headers.authorization, "Bearer garmin-access");
  assert.equal(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM activities").first("count"), 0);
});

test("The webhook route is handled by the Worker before static assets", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../wrangler.jsonc"), "utf8"));
  assert.ok(config.assets.run_worker_first.includes("/webhooks/*"));
});

/* ---------- Background history import ---------- */

const sql = (testEnv, query, ...params) => testEnv.DB.prepare(query).bind(...params).run();
const job = (testEnv) => testEnv.DB.prepare("SELECT * FROM sync_jobs").first();
const activities = async (worker, testEnv, session, query = "") =>
  (await worker.fetch(request(`/api/activities?provider=garmin${query}`, { cookie: session }), testEnv)).json();

test("Sign-in does not wait for Garmin: the history import runs after the response", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = mockGarmin(t);
  const realFetch = globalThis.fetch;
  // Hold every backfill request until the redirect has been returned.
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("/backfill/activities")) await gate;
    return realFetch(url, options);
  });
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const login = await worker.fetch(request("/auth/garmin/login"), testEnv);
  const state = new URL(login.headers.get("location")).searchParams.get("state");
  const cookies = [cookieValue(login, "sv_oauth_state"), cookieValue(login, "sv_oauth_verifier")].join("; ");
  const callback = await worker.fetch(request(`/auth/garmin/callback?code=code&state=${state}`, { cookie: cookies }), testEnv, ctx);
  assert.equal(callback.headers.get("location"), "/?signedin=garmin");
  assert.equal(pending.length, 1, "The import was handed to waitUntil.");
  assert.equal((await job(testEnv)).status, "requesting");

  release();
  await Promise.all(pending);
  const done = await job(testEnv);
  assert.equal(done.status, "requested");
  assert.equal(done.windows_done, 4);
  assert.equal(calls.filter((call) => call.url.pathname.includes("/backfill/activities")).length, 4);
});

test("A failed history window is retried by the cron trigger and resumes where it stopped", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  let status = 202, served = 0;
  // Garmin accepts two windows, then starts failing (rate limited).
  const calls = mockGarmin(t, { backfillStatus: () => (++served > 2 ? status : 202) });
  t.mock.method(console, "warn", () => {});
  status = 429;
  const { session } = await signIn(worker, testEnv);
  let current = await job(testEnv);
  assert.equal(current.status, "requesting");
  assert.equal(current.windows_done, 2);
  assert.equal(current.attempts, 1);
  assert.match(current.last_error, /429|Garmin/);
  assert.equal((await activities(worker, testEnv, session)).sync.state, "importing");

  status = 202;
  await worker.scheduled({ cron: "*/10 * * * *" }, testEnv);
  current = await job(testEnv);
  assert.equal(current.status, "requested");
  assert.equal(current.windows_done, 4);
  const windows = calls.filter((call) => call.url.pathname.includes("/backfill/activities"))
    .map((call) => call.url.searchParams.get("summaryEndTimeInSeconds"));
  assert.equal(new Set(windows).size, 4, "Each window is requested once it succeeds; none are skipped.");
});

test("After repeated failures the import reports failed instead of retrying forever", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t, { backfillStatus: 500 });
  t.mock.method(console, "warn", () => {});
  const { session } = await signIn(worker, testEnv);
  for (let round = 0; round < 8; round += 1) await worker.scheduled({ cron: "*/10 * * * *" }, testEnv);
  const current = await job(testEnv);
  assert.equal(current.status, "failed");
  assert.equal(current.attempts, 6);
  const list = await activities(worker, testEnv, session);
  assert.equal(list.sync.state, "failed");
  assert.ok(list.sync.error);
});

test("The arrival cursor finds backfilled history that started long before the last sync", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t);
  const { session } = await signIn(worker, testEnv);
  await worker.fetch(webhook({ activities: [summary()] }), testEnv);
  // Pretend the first delivery was a while ago.
  await sql(testEnv, "UPDATE activities SET updated_at = updated_at - 120");
  const first = await activities(worker, testEnv, session);
  assert.equal(first.activities.length, 1);
  const cursor = first.sync.cursor;
  assert.ok(cursor);

  // Garmin now pushes a 2020 activity from the history backfill.
  await worker.fetch(webhook({ activities: [summary({ activityId: 200, summaryId: "s-200", activityName: "Old marathon", startTimeInSeconds: Date.UTC(2020, 3, 5, 12) / 1000 })] }), testEnv);
  const recentByStart = await activities(worker, testEnv, session, `&after=${cursor}`);
  assert.equal(recentByStart.activities.length, 0, "A start-time window misses backfilled history.");
  const sinceCursor = await activities(worker, testEnv, session, `&changed_since=${first.sync.cursor + 1}`);
  assert.deepEqual(sinceCursor.activities.map((activity) => activity.name), ["Old marathon"]);
  assert.ok(sinceCursor.sync.cursor > cursor);
});

test("Sync status moves from importing to idle once requests are done and arrivals stop", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t);
  const { session } = await signIn(worker, testEnv);
  const start = await activities(worker, testEnv, session);
  assert.equal(start.sync.state, "importing");
  assert.equal(start.sync.windowsDone, 4);
  assert.equal(start.sync.windowsTotal, 4);
  await worker.fetch(webhook({ activities: [summary()] }), testEnv);
  // An hour later: the requests are long done and nothing new has arrived.
  await sql(testEnv, "UPDATE sync_jobs SET updated_at = updated_at - 3600");
  await sql(testEnv, "UPDATE activities SET updated_at = updated_at - 3600");
  const later = await activities(worker, testEnv, session);
  assert.equal(later.sync.state, "idle");
  assert.equal(later.sync.stored, 1);
});

test("Disconnecting Garmin removes its import job", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t);
  const { session: stravaSession } = await signIn(worker, testEnv, "strava");
  await signIn(worker, testEnv, "garmin", stravaSession);
  assert.ok(await job(testEnv));
  const removed = await worker.fetch(request("/api/connections/garmin", { cookie: stravaSession, method: "DELETE" }), testEnv);
  assert.equal(removed.status, 200);
  assert.equal(await job(testEnv), null);
});

test("Before migration 0004 is applied, sign-in, listing and disconnect keep working", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  testEnv.DB.prepare("DROP TABLE sync_jobs").run();
  const calls = mockGarmin(t);
  const { session: stravaSession } = await signIn(worker, testEnv, "strava");
  await signIn(worker, testEnv, "garmin", stravaSession);
  assert.equal(calls.filter((call) => call.url.pathname.includes("/backfill/activities")).length, 4, "History is still requested.");
  const list = await activities(worker, testEnv, stravaSession);
  assert.equal(list.sync.state, "importing", "A new connection with nothing stored is still waiting for Garmin.");
  assert.equal(await worker.scheduled({ cron: "*/10 * * * *" }, testEnv), undefined);
  const removed = await worker.fetch(request("/api/connections/garmin", { cookie: stravaSession, method: "DELETE" }), testEnv);
  assert.equal(removed.status, 200);
});

test("A Garmin connection without an import job gets one on its next sync", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  const calls = mockGarmin(t);
  const { session } = await signIn(worker, testEnv);
  // As if it connected before migration 0004: no job row.
  await sql(testEnv, "DELETE FROM sync_jobs");
  const before = calls.filter((call) => call.url.pathname.includes("/backfill/activities")).length;
  const list = await activities(worker, testEnv, session);
  assert.equal(list.sync.state, "importing");
  const current = await job(testEnv);
  assert.equal(current.status, "requested");
  assert.equal(calls.filter((call) => call.url.pathname.includes("/backfill/activities")).length - before, 4);
  // Only once: the job now exists.
  await activities(worker, testEnv, session);
  assert.equal(calls.filter((call) => call.url.pathname.includes("/backfill/activities")).length - before, 4);
});

test("An old connection that never received anything reports idle, not importing", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockGarmin(t);
  const { session } = await signIn(worker, testEnv);
  await sql(testEnv, "UPDATE provider_connections SET created_at = created_at - 3 * 86400");
  await sql(testEnv, "UPDATE sync_jobs SET updated_at = updated_at - 3 * 86400");
  assert.equal((await activities(worker, testEnv, session)).sync.state, "idle");
});
