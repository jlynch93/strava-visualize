const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { after, before, test } = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const repo = path.resolve(__dirname, "..");
const port = 43173;
let serverProcess;

function request(pathname) {
  return fetch(`http://127.0.0.1:${port}${pathname}`);
}

before(async () => {
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: repo,
    env: {
      ...process.env,
      PORT: String(port),
      STRAVA_CLIENT_ID: "",
      STRAVA_CLIENT_SECRET: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Server did not start. Output: ${output}`)), 5000);
    serverProcess.stdout.on("data", (chunk) => {
      output += chunk;
      if (!output.includes("Strava Visualize is running")) return;
      clearTimeout(timer);
      resolve();
    });
    serverProcess.once("error", reject);
    serverProcess.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited before startup with code ${code}. Output: ${output}`));
    });
  });
});

after(() => serverProcess?.kill());

test("serves the dashboard and reports configuration status", async () => {
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="overview"/);

  const status = await request("/api/status");
  assert.equal(status.status, 200);
  const data = await status.json();
  assert.equal(data.configured, false);
  assert.equal(data.connected, false);
});

test("returns an actionable status for the protected activity route", async () => {
  const response = await request("/api/activities");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to .env, then restart the server."
  });
});

test("returns not found for malformed activity route paths", async () => {
  const response = await request("/api/activities/not-an-id");
  assert.equal(response.status, 404);
});

test("malformed URL encoding returns 400 without stopping the local server", async () => {
  for (const pathname of ["/%E0%A4%A", "/%00"]) {
    const malformed = await request(pathname);
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, "The requested path is not valid.");
  }
  const next = await request("/api/status");
  assert.equal(next.status, 200);
});

function isolatedBackend() {
  const state = {
    token: { access_token: "test-access", refresh_token: "test-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    upstream: [],
    statusCode: 200,
    requests: [],
    raw: undefined
  };
  const mockFs = {
    readFileSync(filename) {
      if (filename.endsWith(".strava-token.json") && state.token) return JSON.stringify(state.token);
      throw new Error("File not found");
    },
    writeFileSync(filename, content) { state.token = JSON.parse(content); },
    rmSync() { state.token = null; }
  };
  const mockHttps = {
    request(url, options, onResponse) {
      state.requests.push({ url, options });
      const outgoing = new EventEmitter();
      outgoing.setTimeout = () => outgoing;
      outgoing.write = () => {};
      outgoing.end = () => queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = state.statusCode;
        response.headers = { "content-type": "application/json" };
        onResponse(response);
        response.emit("data", state.raw ?? JSON.stringify(state.upstream));
        response.emit("end");
      });
      return outgoing;
    }
  };
  const context = {
    __dirname: repo,
    process: { env: { STRAVA_CLIENT_ID: "test-client", STRAVA_CLIENT_SECRET: "test-secret" } },
    Buffer,
    require(name) {
      if (name === "http") return { createServer: () => ({ listen() {} }) };
      if (name === "fs") return mockFs;
      if (name === "https") return mockHttps;
      return require(name);
    }
  };
  vm.runInNewContext(`${fs.readFileSync(path.join(repo, "server.js"), "utf8")}\nglobalThis.testRoutes = { handleApi, requestJson };`, context);
  return {
    state,
    async request(url, headers = {}) {
      const result = {};
      await context.testRoutes.handleApi({ url, method: "GET", headers: { host: "localhost:4173", ...headers } }, {
        writeHead(status, responseHeaders = {}) { result.status = status; result.headers = responseHeaders; },
        end(body = "") { result.body = body; }
      });
      return result;
    },
    requestJson: context.testRoutes.requestJson
  };
}

test("local OAuth rejects unbound callbacks and clears state after a matching callback", async () => {
  const backend = isolatedBackend();
  const login = await backend.request("/auth/login");
  assert.equal(login.status, 302);
  const state = new URL(login.headers.Location).searchParams.get("state");
  assert.ok(state);
  assert.match(login.headers["Set-Cookie"], /HttpOnly; SameSite=Lax/);
  for (const [returned, stored] of [["", state], ["other", state], [state, ""]]) {
    const rejected = await backend.request(`/auth/callback?code=test-code&state=${returned}`, { cookie: `sv_oauth_state=${stored}` });
    assert.equal(rejected.status, 400);
  }
  assert.equal(backend.state.requests.length, 0);
  backend.state.upstream = { access_token: "new-access", refresh_token: "new-refresh", expires_at: 123 };
  const accepted = await backend.request(`/auth/callback?code=test-code&state=${state}`, { cookie: `sv_oauth_state=${state}` });
  assert.equal(accepted.status, 302);
  assert.equal(backend.state.token.refresh_token, "new-refresh");
  assert.match(accepted.headers["Set-Cookie"], /sv_oauth_state=; Path=\/; Max-Age=0/);
});

test("local disconnect removes the saved token and unauthenticated activity requests return 401", async () => {
  const backend = isolatedBackend();
  const response = await backend.request("/auth/logout");
  assert.equal(response.status, 302);
  assert.equal(response.headers.Location, "/?disconnected=1");
  assert.equal(backend.state.token, null);
  await assert.rejects(backend.request("/api/activities"), { status: 401, message: "Connect Strava first." });
});

test("local activity routes expose details and report when pagination reaches its cap", async () => {
  const backend = isolatedBackend();
  backend.state.upstream = [{ id: 123 }];
  const list = await backend.request("/api/activities?per_page=-1&pages=0");
  assert.deepEqual(JSON.parse(list.body), { activities: [{ id: 123 }], truncated: true });
  assert.equal(backend.state.requests.length, 1);
  assert.equal(new URL(backend.state.requests[0].url).searchParams.get("per_page"), "1");
  const complete = await backend.request("/api/activities?per_page=bad&pages=bad");
  assert.equal(JSON.parse(complete.body).truncated, false);

  backend.state.upstream = { id: 123, name: "Morning run" };
  const detail = await backend.request("/api/activities/123");
  assert.deepEqual(JSON.parse(detail.body), { activity: backend.state.upstream });
  assert.equal(backend.state.requests.at(-1).url, "https://www.strava.com/api/v3/activities/123");
  assert.equal(detail.headers["Cache-Control"], "private, no-store");
  await assert.rejects(backend.request("/api/activities"), { status: 502, message: "Strava returned an invalid activity list." });
});

test("malformed Strava JSON rejects safely and the next local request can still succeed", async () => {
  const backend = isolatedBackend();
  backend.state.raw = "{ broken upstream JSON";
  await assert.rejects(backend.requestJson("https://example.test/upstream"), { status: 502 });
  backend.state.raw = undefined;
  backend.state.upstream = { id: 123 };
  const response = await backend.request("/api/activities/123");
  assert.equal(response.status, 200);
  backend.state.statusCode = 429;
  backend.state.upstream = { message: "Rate Limit Exceeded" };
  await assert.rejects(backend.requestJson("https://example.test/upstream"), { status: 429 });
});
