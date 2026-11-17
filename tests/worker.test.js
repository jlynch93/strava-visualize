const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const { LocalD1 } = require("../scripts/d1-sqlite.js");

const workerPromise = import(pathToFileURL(path.resolve(__dirname, "../src/worker.js")).href).then((module) => module.default);
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function assetBinding(body = "asset", headers = {}) {
  return { fetch: async () => new Response(body, { headers }) };
}

function configuredEnv(overrides = {}) {
  return {
    STRAVA_CLIENT_ID: "test-client",
    STRAVA_CLIENT_SECRET: "test-secret",
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    DB: new LocalD1(":memory:"),
    ASSETS: assetBinding(),
    ...overrides
  };
}

function request(pathname, { cookie, method = "GET" } = {}) {
  return new Request(`https://example.test${pathname}`, { method, headers: cookie ? { cookie } : {} });
}

function cookieValue(response, name) {
  const match = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return match ? match.split(";")[0] : null;
}

// Fakes Strava's token and activity endpoints for one test.
function mockStrava(t, { athleteId = 42, activities = [{ id: 1 }], expiresIn = 3600 } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const target = new URL(url);
    calls.push({ url: target, options });
    if (target.pathname === "/oauth/token") {
      const grant = new URLSearchParams(options.body).get("grant_type");
      return Response.json({
        access_token: `${grant}-access`,
        refresh_token: `${grant}-refresh`,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        athlete: grant === "authorization_code" ? { id: athleteId, firstname: "Jo", lastname: "Runner" } : undefined
      });
    }
    if (target.pathname === "/api/v3/athlete/activities") return Response.json(activities);
    return Response.json({ id: 123, name: "Morning run" });
  });
  return calls;
}

async function signIn(worker, env, { cookie } = {}) {
  const login = await worker.fetch(request("/auth/strava/login", { cookie }), env);
  const state = new URL(login.headers.get("location")).searchParams.get("state");
  const stateCookie = cookieValue(login, "sv_oauth_state");
  const callback = await worker.fetch(request(`/auth/strava/callback?code=code&state=${state}&scope=read,activity:read_all`, {
    cookie: [stateCookie, cookie].filter(Boolean).join("; ")
  }), env);
  return { callback, session: cookieValue(callback, "sv_session") || cookie };
}

test("Worker receives document requests before the asset binding", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../wrangler.jsonc"), "utf8"));
  assert.ok(config.assets.run_worker_first.includes("/"));
  assert.ok(config.assets.run_worker_first.includes("/index.html"));
});

test("Worker reports an actionable configuration state", async () => {
  const worker = await workerPromise;
  const unconfigured = await worker.fetch(request("/api/status"), { ASSETS: assetBinding() });
  assert.equal(unconfigured.status, 200);
  const data = await unconfigured.json();
  assert.equal(data.configured, false);
  assert.equal(data.signedIn, false);
  assert.equal(data.connected, false);
  assert.match(data.error, /D1 database/);
  assert.deepEqual(data.providers.map((provider) => provider.id), ["strava", "garmin"]);
  assert.equal(data.providers[0].redirectUri, "https://example.test/auth/strava/callback");

  const missingStrava = await worker.fetch(request("/api/status"), configuredEnv({ STRAVA_CLIENT_ID: "" }));
  assert.match((await missingStrava.json()).error, /STRAVA_CLIENT_ID/);

  const ready = await (await worker.fetch(request("/api/status"), configuredEnv())).json();
  assert.equal(ready.configured, true);
  assert.equal(ready.analysisService, "https://ollama.runlore.app");
  assert.equal(ready.analysisModel, "qwen3.5:0.8b");
});

test("Worker uses the configured app base URL for provider callbacks and respects overrides", async () => {
  const worker = await workerPromise;
  for (const trailingSlash of ["", "/"]) {
    const env = configuredEnv({ APP_BASE_URL: `https://new.example${trailingSlash}`, GARMIN_CLIENT_ID: "g", GARMIN_CLIENT_SECRET: "g", GARMIN_WEBHOOK_SECRET: "w" });
    for (const provider of ["strava", "garmin"]) {
      const login = await worker.fetch(new Request(`https://old.example/auth/${provider}/login`), env);
      assert.equal(new URL(login.headers.get("location")).searchParams.get("redirect_uri"), `https://new.example/auth/${provider}/callback`);
    }
    const overridden = await worker.fetch(new Request("https://old.example/auth/login"), { ...env, STRAVA_REDIRECT_URI: "https://override.example/auth/callback" });
    assert.equal(new URL(overridden.headers.get("location")).searchParams.get("redirect_uri"), "https://override.example/auth/callback");
  }
});

test("Worker prevents stale HTML while preserving static asset caching", async () => {
  const worker = await workerPromise;
  const env = { ASSETS: assetBinding("<main>Current release</main>", { "cache-control": "public, max-age=31536000" }) };
  const document = await worker.fetch(new Request("https://example.test/", { headers: { accept: "text/html" } }), env);
  assert.equal(document.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(document.headers.get("cdn-cache-control"), "no-store");
  assert.match(await document.text(), /Current release/);
  const asset = await worker.fetch(new Request("https://example.test/script.js", { headers: { accept: "*/*" } }), env);
  assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000");
  assert.equal(asset.headers.get("cdn-cache-control"), null);
});

test("OAuth callbacks are bound to the browser and provider that started sign-in", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv();
  const calls = mockStrava(t);
  const login = await worker.fetch(request("/auth/strava/login"), env);
  assert.equal(login.status, 302);
  const location = new URL(login.headers.get("location"));
  const state = location.searchParams.get("state");
  assert.equal(location.searchParams.get("redirect_uri"), "https://example.test/auth/strava/callback");
  assert.match(login.headers.get("set-cookie"), new RegExp(`sv_oauth_state=strava.${state}`));
  assert.match(login.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);

  for (const [returned, cookie] of [["", `strava.${state}`], ["other", `strava.${state}`], [state, ""], [state, `garmin.${state}`]]) {
    const rejected = await worker.fetch(request(`/auth/strava/callback?code=code&state=${returned}`, { cookie: `sv_oauth_state=${cookie}` }), env);
    assert.equal(rejected.status, 302);
    assert.equal(rejected.headers.get("location"), "/?auth_error=expired");
    assert.equal(cookieValue(rejected, "sv_session"), null);
  }
  assert.equal(calls.length, 0, "Unbound callbacks must never exchange an authorization code.");

  const denied = await worker.fetch(request(`/auth/strava/callback?error=access_denied&state=${state}`, { cookie: `sv_oauth_state=strava.${state}` }), env);
  assert.equal(denied.headers.get("location"), "/?auth_error=denied");

  const accepted = await worker.fetch(request(`/auth/strava/callback?code=code&state=${state}`, { cookie: `sv_oauth_state=strava.${state}` }), env);
  assert.equal(accepted.status, 302);
  assert.equal(accepted.headers.get("location"), "/?signedin=strava");
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.match(accepted.headers.get("set-cookie"), /sv_oauth_state=; Path=\/; Max-Age=0/);
  assert.ok(cookieValue(accepted, "sv_session"));
  assert.equal(calls.length, 1);
});

test("Legacy /auth/login and /auth/callback paths still sign in with Strava", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv({ STRAVA_REDIRECT_URI: "https://example.test/auth/callback" });
  mockStrava(t);
  const login = await worker.fetch(request("/auth/login"), env);
  const location = new URL(login.headers.get("location"));
  assert.equal(location.searchParams.get("redirect_uri"), "https://example.test/auth/callback");
  const state = location.searchParams.get("state");
  const callback = await worker.fetch(request(`/auth/callback?code=code&state=${state}`, { cookie: cookieValue(login, "sv_oauth_state") }), env);
  assert.equal(callback.headers.get("location"), "/?signedin=strava");
});

test("Signing in creates one profile per provider account and stores tokens encrypted", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv();
  mockStrava(t);
  const first = await signIn(worker, env);
  const me = await (await worker.fetch(request("/api/me", { cookie: first.session }), env)).json();
  assert.equal(me.user.displayName, "Jo Runner");
  assert.deepEqual(me.connections.map((connection) => connection.provider), ["strava"]);

  const second = await signIn(worker, env);
  assert.notEqual(second.session, first.session);
  const meAgain = await (await worker.fetch(request("/api/me", { cookie: second.session }), env)).json();
  assert.equal(meAgain.user.id, me.user.id, "The same Strava athlete must return to the same profile.");

  const users = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first("count");
  assert.equal(users, 1);
  const stored = await env.DB.prepare("SELECT access_token, refresh_token FROM provider_connections").first();
  assert.match(stored.access_token, /^v1\./);
  assert.doesNotMatch(stored.access_token, /authorization_code-access/);
  assert.match(stored.refresh_token, /^v1\./);
  const session = await env.DB.prepare("SELECT token_hash FROM sessions LIMIT 1").first("token_hash");
  assert.notEqual(session, first.session.split("=")[1], "Only a hash of the session token is stored.");
});

test("A provider account linked to one profile cannot be attached to another", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv();
  mockStrava(t, { athleteId: 1 });
  const owner = await signIn(worker, env);
  t.mock.restoreAll();
  mockStrava(t, { athleteId: 2 });
  const other = await signIn(worker, env);
  t.mock.restoreAll();
  mockStrava(t, { athleteId: 1 });
  const conflict = await signIn(worker, env, { cookie: other.session });
  assert.equal(conflict.callback.headers.get("location"), "/?auth_error=already_linked");
  const owned = await (await worker.fetch(request("/api/me", { cookie: owner.session }), env)).json();
  assert.equal(owned.connections.length, 1);
});

test("Activity routes require a session and report when pagination reaches its cap", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv();
  const anonymous = await worker.fetch(request("/api/activities"), env);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, "Sign in first.");

  const calls = mockStrava(t, { activities: [{ id: 123 }] });
  const { session } = await signIn(worker, env);
  const capped = await worker.fetch(request("/api/activities?pages=0&per_page=-1", { cookie: session }), env);
  assert.equal(capped.status, 200);
  assert.deepEqual(await capped.json(), { provider: "strava", activities: [{ id: "123" }], truncated: true });
  const listCall = calls.find((call) => call.url.pathname === "/api/v3/athlete/activities");
  assert.equal(listCall.url.searchParams.get("per_page"), "1");
  assert.equal(listCall.options.headers.authorization, "Bearer authorization_code-access");

  const complete = await worker.fetch(request("/api/activities?pages=bad&per_page=bad", { cookie: session }), env);
  assert.equal((await complete.json()).truncated, false);
  assert.equal(calls.at(-1).url.searchParams.get("per_page"), "100");

  const unknown = await worker.fetch(request("/api/activities?provider=fitbit", { cookie: session }), env);
  assert.equal(unknown.status, 400);
  const notConnected = await worker.fetch(request("/api/activities?provider=garmin", { cookie: session }), env);
  assert.equal(notConnected.status, 401);
  assert.equal((await notConnected.json()).error, "Connect Garmin first.");
});

test("Activity detail rejects malformed upstream payloads", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv();
  mockStrava(t);
  const { session } = await signIn(worker, env);
  t.mock.restoreAll();
  let payload = { id: 123, name: "Morning run", splits_standard: [] };
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = String(url);
    return Response.json(payload);
  });
  const detail = await worker.fetch(request("/api/activities/123", { cookie: session }), env);
  assert.equal(detail.status, 200);
  assert.equal(requested, "https://www.strava.com/api/v3/activities/123");
  assert.deepEqual(await detail.json(), { provider: "strava", activity: { ...payload, id: "123" } });
  assert.match(detail.headers.get("cache-control"), /private, no-store/);

  const invalidList = await worker.fetch(request("/api/activities", { cookie: session }), env);
  assert.equal(invalidList.status, 502);
  assert.equal((await invalidList.json()).error, "Strava returned an invalid activity list.");
  payload = [];
  const invalidDetail = await worker.fetch(request("/api/activities/123", { cookie: session }), env);
  assert.equal(invalidDetail.status, 502);
});

test("Expired provider tokens are refreshed and the rotated tokens are saved", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv();
  const calls = mockStrava(t, { expiresIn: 30 });
  const { session } = await signIn(worker, env);
  const before = await env.DB.prepare("SELECT access_token FROM provider_connections").first("access_token");

  const response = await worker.fetch(request("/api/activities", { cookie: session }), env);
  assert.equal(response.status, 200);
  const refresh = calls.find((call) => call.url.pathname === "/oauth/token" && new URLSearchParams(call.options.body).get("grant_type") === "refresh_token");
  assert.ok(refresh, "An access token inside its last minute must be refreshed.");
  assert.equal(new URLSearchParams(refresh.options.body).get("refresh_token"), "authorization_code-refresh");
  const listCall = calls.find((call) => call.url.pathname === "/api/v3/athlete/activities");
  assert.equal(listCall.options.headers.authorization, "Bearer refresh_token-access");
  const after = await env.DB.prepare("SELECT access_token FROM provider_connections").first("access_token");
  assert.notEqual(after, before);
});

test("A revoked refresh token asks the user to reconnect", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv();
  mockStrava(t, { expiresIn: 30 });
  const { session } = await signIn(worker, env);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Bad Request" }, { status: 400 }));
  const response = await worker.fetch(request("/api/activities", { cookie: session }), env);
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Reconnect Strava/);
});

test("Users cannot remove their only sign-in method but can delete the account", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv();
  mockStrava(t);
  const { session } = await signIn(worker, env);
  const lastConnection = await worker.fetch(request("/api/connections/strava", { cookie: session, method: "DELETE" }), env);
  assert.equal(lastConnection.status, 409);
  const missing = await worker.fetch(request("/api/connections/garmin", { cookie: session, method: "DELETE" }), env);
  assert.equal(missing.status, 404);

  const deleted = await worker.fetch(request("/api/me", { cookie: session, method: "DELETE" }), env);
  assert.equal(deleted.status, 200);
  assert.match(deleted.headers.get("set-cookie"), /sv_session=; Path=\/; Max-Age=0/);
  for (const table of ["users", "sessions", "provider_connections"]) {
    assert.equal(await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first("count"), 0, `${table} must be empty`);
  }
  assert.equal((await worker.fetch(request("/api/me", { cookie: session }), env)).status, 401);
});

test("Signing out ends the session on the server", async (t) => {
  const worker = await workerPromise;
  const env = configuredEnv();
  mockStrava(t);
  const { session } = await signIn(worker, env);
  const logout = await worker.fetch(request("/auth/logout", { cookie: session }), env);
  assert.equal(logout.status, 302);
  assert.equal(logout.headers.get("location"), "/?signedout=1");
  assert.match(logout.headers.get("set-cookie"), /sv_session=; Path=\/; Max-Age=0/);
  const after = await worker.fetch(request("/api/me", { cookie: session }), env);
  assert.equal(after.status, 401, "A copied session cookie must stop working after sign-out.");
});

test("Worker returns JSON for unknown routes and tolerates malformed cookies", async () => {
  const worker = await workerPromise;
  const env = configuredEnv();
  const missing = await worker.fetch(request("/api/activities/not-an-id"), env);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Not found" });
  const unknownProvider = await worker.fetch(request("/auth/fitbit/login"), env);
  assert.equal(unknownProvider.status, 404);
  const malformedCookie = await worker.fetch(request("/api/status", { cookie: "unrelated=%E0%A4%A; sv_session=%E0%A4%A" }), env);
  assert.equal(malformedCookie.status, 200);
  assert.match(malformedCookie.headers.get("cache-control"), /no-store/);
  const withoutDb = await worker.fetch(request("/auth/strava/login"), { STRAVA_CLIENT_ID: "a", STRAVA_CLIENT_SECRET: "b", ASSETS: assetBinding() });
  assert.equal(withoutDb.status, 503);
});

test("Worker applies streamed input limits and shared analysis normalization", async (t) => {
  const worker = await workerPromise;
  let called = 0;
  t.mock.method(globalThis, "fetch", async () => { called++; return Response.json({ message: { content: JSON.stringify({ summary: "A measured block.", observations: Array(3).fill({ detail: "Distance recorded.", tone: "neutral" }) }) } }); });
  const analysisEnv = configuredEnv();
  const request = (body, headers = {}) => new Request("https://example.test/api/insights", { method: "POST", body, headers });
  assert.equal((await worker.fetch(request("x".repeat(64001)), analysisEnv)).status, 413);
  assert.equal((await worker.fetch(request("{"), analysisEnv)).status, 400);
  const input = JSON.stringify({ recentRuns: [{ distanceMiles: 5 }], summary: { runCount: 1 } });
  assert.equal((await worker.fetch(request(input, { origin: "https://foreign.test" }), analysisEnv)).status, 403);
  assert.equal(called, 0);
  const valid = await worker.fetch(request(input), analysisEnv);
  assert.equal(valid.status, 200); const result = await valid.json();
  assert.equal(result.model, "qwen3.5:0.8b"); assert.match(result.insight.nextStep, /Plan view/);
});
