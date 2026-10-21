const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
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
