const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readBoundedJson, validateInsightInput, guardedAnalysis } = require("../shared/analysis-limits.cjs");
const { weatherRequest, normalizeWeather, buildInsightPrompt, buildRunDigestPrompt, normalizeInsight } = require("../shared/services.cjs");

test("streamed bodies enforce the byte limit without trusting Content-Length", async () => {
  for (const value of ["x".repeat(64001), "é".repeat(33000)]) {
    const request = new Request("https://app.test/api/insights", { method: "POST", body: value });
    await assert.rejects(readBoundedJson(request), { status: 413 });
  }
  await assert.rejects(readBoundedJson(new Request("https://app.test", { method: "POST", body: "{" })), { status: 400 });
  assert.deepEqual(await readBoundedJson(new Request("https://app.test", { method: "POST", body: '{"ok":true}' })), { ok: true });
});
test("analysis validation bounds arrays and removes names and route information", () => {
  assert.throws(() => validateInsightInput({ recentRuns: Array(13).fill({}) }), { status: 400 });
  assert.throws(() => validateInsightInput({ kind: "run", run: [] }), { status: 400 });
  const result = validateInsightInput({ recentRuns: [{ name: "Home address", coordinates: [1, 2], distanceMiles: 5 }], route: "secret", question: "x".repeat(500) });
  assert.deepEqual(result.recentRuns, [{ distanceMiles: 5 }]); assert.equal(result.question.length, 200); assert.equal(result.route, undefined);
});
test("analysis rejects foreign origins and honors the Cloudflare binding", async () => {
  await assert.rejects(guardedAnalysis(new Request("https://app.test", { headers: { origin: "https://other.test" } }), {}, async () => 1), { status: 403 });
  await assert.rejects(guardedAnalysis(new Request("https://app.test"), { ANALYSIS_RATE_LIMITER: { limit: async () => ({ success: false }) } }, async () => 1), { status: 429 });
});
test("analysis limits concurrency and releases a slot after errors", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const request = () => new Request("https://app.test", { headers: { "x-analysis-client": "concurrency-test" } });
  const one = guardedAnalysis(request(), {}, () => pending);
  const two = guardedAnalysis(request(), {}, () => pending);
  await assert.rejects(guardedAnalysis(request(), {}, async () => 1), { status: 429 });
  release("done"); await Promise.all([one, two]);
  await assert.rejects(guardedAnalysis(request(), {}, async () => { throw new Error("upstream"); }), /upstream/);
  assert.equal(await guardedAnalysis(request(), {}, async () => "available"), "available");
});
test("weather keeps null measurements missing, preserves real zero, and validates hours", () => {
  const data = normalizeWeather({ hourly: { time: ["2026-10-01T07:00"], temperature_2m: [null], precipitation: [0] } }, { date: "2026-10-01", hour: 7, sourceType: "forecast" });
  assert.equal(data.temperatureF, null); assert.equal(data.precipitationInches, 0);
  assert.throws(() => weatherRequest(new URL("https://app.test/api/weather?lat=40&lng=-74&date=2026-10-01&hour=7.5")), /hour/);
});
test("coach prompts include the question and responses avoid planning from an old window", () => {
  assert.match(buildInsightPrompt({ recentRuns: [], question: "Why was pace slower?" }), /Why was pace slower/);
  const response = normalizeInsight({ summary: "A quieter block.", observations: Array(3).fill({ detail: "Recorded distance fell." }) }, {});
  assert.match(response.nextStep, /Plan view/);
  const noComparison = buildRunDigestPrompt({ run: {}, comparison: { paceDeltaSeconds: null, loadPerMileDeltaPercent: null } });
  assert.match(noComparison, /Pace comparison is unavailable/);
  assert.doesNotMatch(noComparison, /This run matched/);
});
