const MAX_BYTES = 64_000;
const clients = new Map();
let active = 0;
const fail = (message, status) => Object.assign(new Error(message), { status });
async function readBoundedJson(request) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) throw fail("The training summary is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw fail("No training summary was supplied.", 400);
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw fail("The training summary is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw fail("The training summary is not valid JSON.", 400); }
}
function validateInsightInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("No running data was supplied.", 400);
  const isRun = input.kind === "run";
  if (isRun ? !input.run || typeof input.run !== "object" || Array.isArray(input.run) : !Array.isArray(input.recentRuns) || !input.recentRuns.length || input.recentRuns.length > 12) throw fail("No running data was supplied.", 400);
  if (input.buckets && (!Array.isArray(input.buckets) || input.buckets.length > 12)) throw fail("Too many training periods.", 400);
  const allowed = new Set(["kind", "run", "comparison", "context", "weather", "focus", "question", "range", "summary", "buckets", "recentRuns", "coachingContext"]);
  function clean(value, depth = 0) {
    if (depth > 5) throw fail("The summary is too deeply nested.", 400);
    if (value === null) return null;
    if (typeof value === "number") { if (!Number.isFinite(value)) throw fail("Summary numbers must be finite.", 400); return value; }
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.slice(0, 200);
    if (Array.isArray(value)) { if (value.length > 20) throw fail("Too many summary records.", 400); return value.map((item) => clean(item, depth + 1)); }
    if (typeof value !== "object") throw fail("Invalid summary field.", 400);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !["__proto__", "constructor", "prototype", "name", "description", "start_latlng", "coordinates", "route"].includes(key)).map(([key, item]) => [key, clean(item, depth + 1)]));
  }
  return Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)).map(([key, value]) => [key, clean(value)]));
}
async function guardedAnalysis(request, env, work) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && origin !== env.APP_BASE_URL?.replace(/\/+$/, "")) throw fail("Analysis requests must come from this app.", 403);
  const key = request.headers.get("cf-connecting-ip") || request.headers.get("x-analysis-client") || "local";
  if (env.ANALYSIS_RATE_LIMITER) {
    const result = await env.ANALYSIS_RATE_LIMITER.limit({ key });
    if (!result.success) throw fail("Analysis limit reached. Wait a minute and try again.", 429);
  }
  const now = Date.now();
  for (const [client, entry] of clients) if (now - entry.start >= 60_000) clients.delete(client);
  const entry = clients.get(key) || { start: now, count: 0 };
  if (entry.count >= 5 || clients.size >= 2000 || active >= 2) throw fail("Analysis is busy. Wait a minute and try again.", 429);
  entry.count += 1; clients.set(key, entry); active += 1;
  try { return await work(); } finally { active -= 1; }
}
module.exports = { readBoundedJson, validateInsightInput, guardedAnalysis, MAX_BYTES };
