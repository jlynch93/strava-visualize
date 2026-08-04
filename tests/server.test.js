const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { after, before, test } = require("node:test");
const path = require("node:path");

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
  assert.match(await page.text(), /Run deeper/);

  const status = await request("/api/status");
  assert.equal(status.status, 200);
  const data = await status.json();
  assert.equal(data.configured, false);
  assert.equal(data.connected, false);
});

test("returns an actionable status for protected activity routes", async () => {
  const response = await request("/api/activities/123");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to .env, then restart the server."
  });
});

test("returns not found for malformed activity route paths", async () => {
  const response = await request("/api/activities/not-an-id");
  assert.equal(response.status, 404);
});
