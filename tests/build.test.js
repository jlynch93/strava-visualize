const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const os = require("node:os");
test("production HTML points to existing content-fingerprinted assets with cache rules", () => {
  const repo = path.resolve(__dirname, "..");
  const result = spawnSync(process.execPath, ["scripts/build-assets.js"], { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(repo, ".build/public");
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "asset-manifest.json"), "utf8"));
  const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
  assert.equal(Object.keys(manifest).length, 5);
  for (const [source, filename] of Object.entries(manifest)) {
    const content = fs.readFileSync(path.join(repo, "public", source));
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
    assert.ok(filename.includes(hash));
    assert.ok(html.includes(`/${filename}"`));
    assert.deepEqual(fs.readFileSync(path.join(output, filename)), content);
  }
  assert.match(fs.readFileSync(path.join(output, "_headers"), "utf8"), /immutable/);
});

test("direct Wrangler deploy builds assets from a checkout with no build output", { timeout: 60_000 }, () => {
  const repo = path.resolve(__dirname, "..");
  const prefix = path.join(os.tmpdir(), "strava-clean-deploy-");
  const checkout = fs.mkdtempSync(prefix);
  try {
    for (const entry of ["public", "src", "shared", "scripts", "package.json", "wrangler.jsonc"]) {
      fs.cpSync(path.join(repo, entry), path.join(checkout, entry), { recursive: true });
    }
    assert.equal(fs.existsSync(path.join(checkout, ".build/public")), false);
    const result = spawnSync(process.execPath, [path.join(repo, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--dry-run", "--outdir", ".build/worker"], {
      cwd: checkout, encoding: "utf8", timeout: 55_000,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" }
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(path.join(checkout, ".build/public/index.html")));
    assert.ok(fs.existsSync(path.join(checkout, ".build/public/asset-manifest.json")));
    assert.match(result.stdout, /Built 5 fingerprinted assets/);
  } finally {
    if (!path.resolve(checkout).startsWith(path.resolve(prefix))) throw new Error("Unexpected temporary checkout path.");
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});
