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
