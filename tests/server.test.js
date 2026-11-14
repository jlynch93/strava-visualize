const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { after, before, test } = require("node:test");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const port = 43173;
let serverProcess;

function request(pathname, options) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, options);
}

before(async () => {
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: repo,
    env: {
      ...process.env,
      PORT: String(port),
      LOCAL_DB_PATH: ":memory:",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      STRAVA_CLIENT_ID: "",
      STRAVA_CLIENT_SECRET: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Server did not start. Output: ${output}`)), 5000);
    const collect = (chunk) => {
      output += chunk;
      if (!output.includes("Strava Visualize is running")) return;
      clearTimeout(timer);
      resolve();
    };
    serverProcess.stdout.on("data", collect);
    serverProcess.stderr.on("data", (chunk) => { output += chunk; });
    serverProcess.once("error", reject);
    serverProcess.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited before startup with code ${code}. Output: ${output}`));
    });
  });
});

after(() => serverProcess?.kill());

test("serves the dashboard through the Worker and reports configuration status", async () => {
  const page = await request("/", { headers: { accept: "text/html" } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store, max-age=0");
  assert.match(await page.text(), /id="overview"/);

  const script = await request("/script.js");
  assert.match(script.headers.get("content-type"), /javascript/);

  const status = await request("/api/status");
  assert.equal(status.status, 200);
  const data = await status.json();
  assert.equal(data.configured, false);
  assert.equal(data.signedIn, false);
  assert.match(data.error, /STRAVA_CLIENT_ID/);
});

test("protected routes ask the browser to sign in", async () => {
  const activities = await request("/api/activities");
  assert.equal(activities.status, 401);
  assert.deepEqual(await activities.json(), { error: "Sign in first." });
  const me = await request("/api/me");
  assert.equal(me.status, 401);
  const login = await request("/auth/strava/login", { redirect: "manual" });
  assert.equal(login.status, 503);
});

test("returns not found for malformed activity route paths", async () => {
  const response = await request("/api/activities/not-an-id");
  assert.equal(response.status, 404);
});

test("forwards request bodies to the Worker", async () => {
  const response = await request("/api/insights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recentRuns: [] })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "No running data was supplied.");
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
