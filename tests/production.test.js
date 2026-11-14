const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    ASSETS: { fetch: async () => new Response("<main>app</main>", { headers: { "content-type": "text/html" } }) },
    ...overrides
  };
}

function request(pathname, { cookie, method = "GET", body, origin = "https://runlore.test" } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${origin}${pathname}`, { method, headers, body });
}

function cookieValue(response, name) {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0] || null;
}

function mockStrava(t, { athleteId = 42, activitiesStatus = 200 } = {}) {
  t.mock.method(globalThis, "fetch", async (url) => {
    const target = new URL(url);
    if (target.pathname === "/oauth/token") {
      return Response.json({ access_token: "a", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { id: athleteId, firstname: "Jo" } });
    }
    if (activitiesStatus !== 200) return Response.json({ message: "Rate Limit Exceeded" }, { status: activitiesStatus });
    return Response.json([]);
  });
}

async function signIn(worker, testEnv) {
  const login = await worker.fetch(request("/auth/strava/login"), testEnv);
  const state = new URL(login.headers.get("location")).searchParams.get("state");
  const callback = await worker.fetch(request(`/auth/strava/callback?code=c&state=${state}`, { cookie: cookieValue(login, "sv_oauth_state") }), testEnv);
  return cookieValue(callback, "sv_session");
}

test("account settings round-trip, stay private to the account, and are deleted with it", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockStrava(t);
  const session = await signIn(worker, testEnv);

  assert.equal((await worker.fetch(request("/api/state"), testEnv)).status, 401);
  const empty = await (await worker.fetch(request("/api/state", { cookie: session }), testEnv)).json();
  assert.deepEqual(empty.state, {});

  const plans = { "2026-11-16": { savedAt: "2026-11-14T10:00:00Z", sessions: [] } };
  const saved = await worker.fetch(request("/api/state/run-trends-plans-v1", { cookie: session, method: "PUT", body: JSON.stringify(plans) }), testEnv);
  assert.equal(saved.status, 200);
  await worker.fetch(request("/api/state/run-trends-preferences", { cookie: session, method: "PUT", body: JSON.stringify({ units: "metric" }) }), testEnv);
  // Saving again replaces the earlier value.
  await worker.fetch(request("/api/state/run-trends-preferences", { cookie: session, method: "PUT", body: JSON.stringify({ units: "imperial", theme: "dark" }) }), testEnv);

  const loaded = await (await worker.fetch(request("/api/state", { cookie: session }), testEnv)).json();
  assert.deepEqual(loaded.state["run-trends-plans-v1"].value, plans);
  assert.deepEqual(loaded.state["run-trends-preferences"].value, { units: "imperial", theme: "dark" });

  // Another runner sees none of it.
  t.mock.restoreAll();
  mockStrava(t, { athleteId: 99 });
  const other = await signIn(worker, testEnv);
  assert.deepEqual((await (await worker.fetch(request("/api/state", { cookie: other }), testEnv)).json()).state, {});

  await worker.fetch(request("/api/me", { cookie: session, method: "DELETE" }), testEnv);
  const remaining = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM user_state").first("count");
  assert.equal(remaining, 0, "Deleting the account removes its synced settings.");
});

test("account settings reject unknown keys, non-objects and oversized values", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockStrava(t);
  const session = await signIn(worker, testEnv);
  const put = (key, body) => worker.fetch(request(`/api/state/${key}`, { cookie: session, method: "PUT", body }), testEnv);
  assert.equal((await put("run-trends-import-v1", "{}")).status, 404, "Imported activity files stay on the device.");
  assert.equal((await put("run-trends-plans-v1", "not json")).status, 400);
  assert.equal((await put("run-trends-plans-v1", "42")).status, 400);
  assert.equal((await put("run-trends-plans-v1", JSON.stringify({ blob: "x".repeat(300_000) }))).status, 413);
});

test("every response carries security headers; HSTS and upgrades only over HTTPS", async () => {
  const worker = await workerPromise;
  const testEnv = env();
  for (const pathname of ["/", "/api/status", "/auth/strava/login", "/api/nope"]) {
    const response = await worker.fetch(request(pathname), testEnv);
    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /default-src 'self'/, pathname);
    assert.match(csp, /frame-ancestors 'none'/, pathname);
    assert.match(csp, /upgrade-insecure-requests/, pathname);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", pathname);
    assert.equal(response.headers.get("x-frame-options"), "DENY", pathname);
    assert.match(response.headers.get("strict-transport-security"), /max-age=31536000/, pathname);
  }
  const redirect = await worker.fetch(request("/auth/strava/login"), testEnv);
  assert.equal(redirect.status, 302, "Redirects keep their status and location.");
  assert.ok(redirect.headers.get("location"));

  const local = await worker.fetch(request("/", { origin: "http://localhost:4173" }), testEnv);
  assert.equal(local.headers.get("strict-transport-security"), null);
  assert.doesNotMatch(local.headers.get("content-security-policy"), /upgrade-insecure-requests/);
});

test("static assets that bypass the Worker get the same policy from _headers", async () => {
  const { spawnSync } = require("node:child_process");
  const repo = path.resolve(__dirname, "..");
  const result = spawnSync(process.execPath, ["scripts/build-assets.js"], { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const headers = fs.readFileSync(path.join(repo, ".build/public/_headers"), "utf8");
  assert.match(headers, /^\/\*\n {2}Content-Security-Policy: default-src 'self'/m);
  assert.match(headers, /X-Frame-Options: DENY/);
  const { STATIC_SECURITY_HEADERS } = await import(pathToFileURL(path.resolve(repo, "src/security.js")).href);
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    assert.ok(headers.includes(`  ${name}: ${value}`), `_headers must match src/security.js for ${name}`);
  }
});

test("unexpected errors return a generic message and are logged", async (t) => {
  const worker = await workerPromise;
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(line));
  const broken = env({ DB: { prepare() { throw new Error("SQLITE internal detail"); } } });
  const response = await worker.fetch(request("/api/me", { cookie: "sv_session=abc" }), broken);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.doesNotMatch(body.error, /SQLITE/);
  assert.equal(logged.length, 1);
  assert.equal(JSON.parse(logged[0]).event, "request_failed");
});

test("the scheduled cleanup deletes expired sessions only", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockStrava(t);
  const session = await signIn(worker, testEnv);
  await testEnv.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) SELECT 'old', user_id, 0, 1 FROM sessions LIMIT 1").run();
  assert.equal(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first("count"), 2);
  t.mock.method(console, "log", () => {});
  await worker.scheduled({ cron: "17 3 * * *" }, testEnv);
  assert.equal(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first("count"), 1);
  assert.equal((await worker.fetch(request("/api/me", { cookie: session }), testEnv)).status, 200, "Live sessions survive.");
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../wrangler.jsonc"), "utf8"));
  assert.ok(config.triggers.crons.length, "wrangler.jsonc schedules the cleanup.");
  assert.equal(config.observability.enabled, true);
});

test("the configured Ollama model and server are used for analysis and reported in status", async (t) => {
  const worker = await workerPromise;
  const testEnv = env({ OLLAMA_MODEL: "llama3.2:3b", OLLAMA_BASE_URL: "https://ollama.example.test/" });
  let sent;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent = { url: String(url), body: JSON.parse(options.body) };
    return Response.json({ message: { content: JSON.stringify({ summary: "Steady.", observations: Array(3).fill({ title: "t", detail: "d", tone: "neutral" }) }) } });
  });
  const response = await worker.fetch(new Request("https://runlore.test/api/insights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recentRuns: [{ distanceMiles: 5 }], summary: { runCount: 1 } })
  }), testEnv);
  assert.equal(response.status, 200);
  assert.equal(sent.url, "https://ollama.example.test/api/chat");
  assert.equal(sent.body.model, "llama3.2:3b");
  assert.equal((await response.json()).model, "llama3.2:3b");
  const status = await (await worker.fetch(request("/api/status"), testEnv)).json();
  assert.equal(status.analysisModel, "llama3.2:3b");
  assert.equal(status.analysisService, "https://ollama.example.test");

  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../wrangler.jsonc"), "utf8"));
  assert.equal(config.keep_vars, true, "Dashboard variables such as OLLAMA_MODEL must survive deploys.");
});

function insightRequest() {
  return new Request("https://runlore.test/api/insights", {
    method: "POST",
    // A distinct client key per request keeps the per-client analysis rate
    // limit (5/minute) from affecting these tests.
    headers: { "content-type": "application/json", "x-analysis-client": `test-${Math.random()}` },
    body: JSON.stringify({ recentRuns: [{ distanceMiles: 5 }], summary: { runCount: 1 } })
  });
}

test("the default analysis model is one the Runlore server has, and stray whitespace is ignored", async (t) => {
  const worker = await workerPromise;
  let sentModel;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sentModel = JSON.parse(options.body).model;
    return Response.json({ message: { content: JSON.stringify({ summary: "Steady.", observations: Array(3).fill({ title: "t", detail: "d", tone: "neutral" }) }) } });
  });
  await worker.fetch(insightRequest(), env());
  assert.equal(sentModel, "qwen3:1.7b");
  await worker.fetch(insightRequest(), env({ OLLAMA_MODEL: "  gemma4:e2b \n" }));
  assert.equal(sentModel, "gemma4:e2b");
  await worker.fetch(insightRequest(), env({ OLLAMA_MODEL: "   " }));
  assert.equal(sentModel, "qwen3:1.7b", "A blank setting falls back to the default.");
});

test("a missing analysis model is reported plainly and logged with the model name", async (t) => {
  const worker = await workerPromise;
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(JSON.parse(line)));
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "model 'qwen3.5:0.8b' not found" }, { status: 404 }));
  const response = await worker.fetch(insightRequest(), env({ OLLAMA_MODEL: "qwen3.5:0.8b" }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /doesn't have the configured model installed/);
  assert.equal(logged[0].event, "analysis_model_missing");
  assert.equal(logged[0].model, "qwen3.5:0.8b");

  // A proxy error page (not JSON) doesn't leak a parser error to the runner.
  t.mock.restoreAll();
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
  const gateway = await worker.fetch(insightRequest(), env());
  assert.equal(gateway.status, 502);
  assert.match((await gateway.json()).error, /unreadable response/);
});

test("provider callbacks are forced to https except on local development hosts", async () => {
  const worker = await workerPromise;
  const redirect = async (testEnv, origin = "https://runlore.test") => {
    const login = await worker.fetch(request("/auth/strava/login", { origin }), testEnv);
    return new URL(login.headers.get("location")).searchParams.get("redirect_uri");
  };
  assert.equal(await redirect(env({ STRAVA_REDIRECT_URI: "http://runlore.app/auth/callback" })), "https://runlore.app/auth/callback");
  assert.equal(await redirect(env({ APP_BASE_URL: "http://runlore.app/" })), "https://runlore.app/auth/strava/callback");
  assert.equal(await redirect(env({ STRAVA_REDIRECT_URI: " https://runlore.app/auth/strava/callback " })), "https://runlore.app/auth/strava/callback");
  assert.equal(await redirect(env(), "http://localhost:4173"), "http://localhost:4173/auth/strava/callback");
  assert.equal(await redirect(env({ APP_BASE_URL: "http://runlore.localhost:8787" })), "http://runlore.localhost:8787/auth/strava/callback");
});

test("a Strava rate limit reads as a temporary, retryable problem", async (t) => {
  const worker = await workerPromise;
  const testEnv = env();
  mockStrava(t, { activitiesStatus: 429 });
  const session = await signIn(worker, testEnv);
  const response = await worker.fetch(request("/api/activities", { cookie: session }), testEnv);
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /try syncing again in a few minutes/);
});
