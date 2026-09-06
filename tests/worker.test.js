const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const workerSource = fs.readFileSync(path.resolve(__dirname, "../src/worker.js"), "utf8");
const workerModuleUrl = `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`;
const workerPromise = import(workerModuleUrl).then((module) => module.default);

function assetBinding(body = "asset", headers = {}) {
  return {
    fetch: async () => new Response(body, { headers })
  };
}

const configuredEnv = { STRAVA_CLIENT_ID: "test-client", STRAVA_CLIENT_SECRET: "test-secret", ASSETS: assetBinding() };

function connectedRequest(pathname) {
  return new Request(`https://example.test${pathname}`, {
    headers: { cookie: `sv_access=test-access; sv_expires=${Math.floor(Date.now() / 1000) + 3600}; sv_refresh=test-refresh` }
  });
}

test("Worker receives document requests before the asset binding", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../wrangler.jsonc"), "utf8"));
  assert.ok(config.assets.run_worker_first.includes("/"));
  assert.ok(config.assets.run_worker_first.includes("/index.html"));
});

test("Worker reports an actionable configuration state", async () => {
  const worker = await workerPromise;
  const response = await worker.fetch(new Request("https://example.test/api/status"), {
    STRAVA_CLIENT_ID: "",
    STRAVA_CLIENT_SECRET: "",
    ASSETS: assetBinding()
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    configured: false,
    connected: false,
    redirectUri: "https://example.test/auth/callback",
    error: "Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to this Cloudflare Worker."
  });
});

test("Worker prevents stale HTML while preserving static asset caching", async () => {
  const worker = await workerPromise;
  const env = {
    ASSETS: assetBinding("<main>Current release</main>", { "cache-control": "public, max-age=31536000" })
  };

  const document = await worker.fetch(new Request("https://example.test/", {
    headers: { accept: "text/html" }
  }), env);
  assert.equal(document.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(document.headers.get("cdn-cache-control"), "no-store");
  assert.match(await document.text(), /Current release/);

  const asset = await worker.fetch(new Request("https://example.test/script.js", {
    headers: { accept: "*/*" }
  }), env);
  assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000");
  assert.equal(asset.headers.get("cdn-cache-control"), null);
});

test("Worker binds OAuth callbacks to the browser that started sign-in", async (t) => {
  const worker = await workerPromise;
  let exchanges = 0;
  t.mock.method(globalThis, "fetch", async () => {
    exchanges += 1;
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600 });
  });
  const login = await worker.fetch(new Request("https://example.test/auth/login"), configuredEnv);
  assert.equal(login.status, 302);
  const state = new URL(login.headers.get("location")).searchParams.get("state");
  assert.ok(state);
  assert.match(login.headers.get("set-cookie"), new RegExp(`sv_oauth_state=${state}`));
  assert.match(login.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);

  for (const [returned, cookieValue] of [["", state], ["other", state], [state, ""]]) {
    const rejected = await worker.fetch(new Request(`https://example.test/auth/callback?code=code&state=${returned}`, {
      headers: { cookie: `sv_oauth_state=${cookieValue}` }
    }), configuredEnv);
    assert.equal(rejected.status, 400);
  }
  assert.equal(exchanges, 0, "Unbound callbacks must never exchange an authorization code.");
  const accepted = await worker.fetch(new Request(`https://example.test/auth/callback?code=code&state=${state}`, {
    headers: { cookie: `sv_oauth_state=${state}` }
  }), configuredEnv);
  assert.equal(accepted.status, 302);
  assert.equal(exchanges, 1);
  assert.match(accepted.headers.get("set-cookie"), /sv_oauth_state=; Path=\/; Max-Age=0/);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
});

test("Worker disconnect clears every session cookie", async () => {
  const worker = await workerPromise;
  const response = await worker.fetch(connectedRequest("/auth/logout"), configuredEnv);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/?disconnected=1");
  for (const name of ["sv_access", "sv_refresh", "sv_expires", "sv_oauth_state"]) {
    assert.match(response.headers.get("set-cookie"), new RegExp(`${name}=; Path=/; Max-Age=0`));
  }
});

test("Worker returns actionable auth errors and JSON for unknown API routes", async () => {
  const worker = await workerPromise;
  const disconnected = await worker.fetch(new Request("https://example.test/api/activities"), configuredEnv);
  assert.equal(disconnected.status, 401);
  assert.equal((await disconnected.json()).error, "Connect Strava first.");
  const unconfigured = await worker.fetch(new Request("https://example.test/api/activities/123"), {});
  assert.equal(unconfigured.status, 503);
  const missing = await worker.fetch(new Request("https://example.test/api/activities/not-an-id"), configuredEnv);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Not found" });
  const malformedCookie = await worker.fetch(new Request("https://example.test/api/status", {
    headers: { cookie: "unrelated=%E0%A4%A" }
  }), configuredEnv);
  assert.equal(malformedCookie.status, 200);
  assert.match(malformedCookie.headers.get("cache-control"), /no-store/);
});

test("Worker bounds pagination and tells the client when a sync hits its cap", async (t) => {
  const worker = await workerPromise;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(new URL(url));
    return Response.json([{ id: 123 }]);
  });
  const response = await worker.fetch(connectedRequest("/api/activities?pages=0&per_page=-1"), configuredEnv);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { activities: [{ id: 123 }], truncated: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("per_page"), "1");

  const complete = await worker.fetch(connectedRequest("/api/activities?pages=bad&per_page=bad"), configuredEnv);
  assert.equal((await complete.json()).truncated, false);
  assert.equal(calls.at(-1).searchParams.get("per_page"), "100");
});

test("Worker handles activity detail and rejects malformed upstream activity payloads", async (t) => {
  const worker = await workerPromise;
  let payload = { id: 123, name: "Morning run", splits_standard: [] };
  let requestedUrl;
  t.mock.method(globalThis, "fetch", async (url) => {
    requestedUrl = url;
    return Response.json(payload);
  });
  const detail = await worker.fetch(connectedRequest("/api/activities/123"), configuredEnv);
  assert.equal(detail.status, 200);
  assert.equal(requestedUrl, "https://www.strava.com/api/v3/activities/123");
  assert.deepEqual(await detail.json(), { activity: payload });
  assert.match(detail.headers.get("cache-control"), /private, no-store/);

  const invalidList = await worker.fetch(connectedRequest("/api/activities"), configuredEnv);
  assert.equal(invalidList.status, 502);
  assert.equal((await invalidList.json()).error, "Strava returned an invalid activity list.");
  payload = [];
  const invalidDetail = await worker.fetch(connectedRequest("/api/activities/123"), configuredEnv);
  assert.equal(invalidDetail.status, 502);
});

test("Worker retains refreshed session cookies if Strava rejects the subsequent activity request", async (t) => {
  const worker = await workerPromise;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/oauth/token")) {
      return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    return Response.json({ message: "Rate Limit Exceeded" }, { status: 429 });
  });
  const response = await worker.fetch(new Request("https://example.test/api/activities", {
    headers: { cookie: "sv_refresh=expired-refresh" }
  }), configuredEnv);
  assert.equal(response.status, 429);
  assert.match(response.headers.get("set-cookie"), /sv_refresh=rotated-refresh/);
});
