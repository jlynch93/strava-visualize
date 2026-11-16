const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const racesPromise = import(pathToFileURL(path.resolve(__dirname, "../src/races.js")).href);
const workerPromise = import(pathToFileURL(path.resolve(__dirname, "../src/worker.js")).href).then((module) => module.default);
// A trimmed copy of a real RunSignup response (Ohio "turkey trot" plus two
// membership/virtual listings), captured November 2026.
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/runsignup-races.json"), "utf8"));

test("RunSignup distances map onto the race form's categories", async () => {
  const { parseDistanceKm, distanceCategory } = await racesPromise;
  const cases = { "5K": "5K", "3.1 Miles": "5K", "3.10686 Miles": "5K", "10K": "10K", "6.2 Miles": "10K", "13.1 Miles": "Half marathon",
    "21.097K": "Half marathon", "26.2 Miles": "Marathon", "4 Miles": "Other", "100m": "Other" };
  for (const [text, category] of Object.entries(cases)) assert.equal(distanceCategory(parseDistanceKm(text)), category, text);
  assert.equal(distanceCategory(parseDistanceKm(null, "Spring Half Marathon")), "Half marathon");
  assert.equal(distanceCategory(parseDistanceKm(null, "City Marathon")), "Marathon");
  assert.equal(parseDistanceKm(null, "Fun walk"), null);
  assert.ok(Math.abs(parseDistanceKm("100 Yards") - 0.09144) < 1e-6);
});

test("Race search keeps real in-person races and drops virtual, membership and kids' events", async () => {
  const { normalizeRaces } = await racesPromise;
  const races = normalizeRaces(fixture, { from: "2026-11-16", to: "2027-11-16" });
  assert.equal(races.length, 12, "12 of the 25 Ohio results are in-person running or walking races.");
  const names = races.map((race) => race.name).join(" | ");
  assert.doesNotMatch(names, /Virtual|Membership/);
  for (const race of races) {
    assert.match(race.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(race.events.length);
    assert.ok(race.events.every((event) => event.km === null || event.km >= 1), "No kids' dashes.");
    assert.ok(!("description" in race), "Descriptions are never passed on.");
    if (race.url) assert.match(race.url, /^https:\/\/runsignup\.com\//);
  }
  const johnstown = races.find((race) => race.name.startsWith("Johnstown"));
  assert.deepEqual(johnstown.events.map((event) => event.distance), ["5K", "10K", "Half marathon"]);
  assert.equal(johnstown.date, "2026-11-21");
  assert.deepEqual([johnstown.city, johnstown.state], ["Johnstown", "OH"]);
  // Outside the window, nothing.
  assert.deepEqual(normalizeRaces(fixture, { from: "2030-01-01", to: "2031-01-01" }), []);
});

// Builds a RunSignup-shaped race dated `days` from today.
function upcoming(days, overrides = {}) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + days);
  const mdY = `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
  return { race: { race_id: 1, name: "Riverfront Half", url: "https://runsignup.com/Race/OH/Columbus/RiverfrontHalf", address: { city: "Columbus", state: "OH" },
    events: [{ event_id: 11, name: "Half Marathon", start_time: `${mdY} 07:30`, end_time: `${mdY} 12:00`, distance: "13.1 Miles", event_type: "running_race" }], ...overrides } };
}

test("The search route validates input, forwards the query, and trims the answer", async (t) => {
  const worker = await workerPromise;
  const env = { ASSETS: { fetch: async () => new Response("asset") } };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(new URL(url)); return Response.json({ races: [upcoming(30), upcoming(40, { race_id: 2, name: "Virtual Fun", events: [{ event_id: 12, name: "5K", start_time: "1/1/2027 00:00", distance: "5K", event_type: "virtual_race" }] })] }); });
  const short = await worker.fetch(new Request("https://example.test/api/races/search?q=ab"), env);
  assert.equal(short.status, 400);
  const badState = await worker.fetch(new Request("https://example.test/api/races/search?q=riverfront&state=Ohio"), env);
  assert.equal(badState.status, 400);
  assert.equal(calls.length, 0, "Invalid searches never reach RunSignup.");

  const response = await worker.fetch(new Request("https://example.test/api/races/search?q=riverfront&state=oh"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, "RunSignup");
  assert.deepEqual(body.races.map((race) => race.name), ["Riverfront Half"]);
  assert.equal(body.races[0].events[0].distance, "Half marathon");
  const sent = calls[0];
  assert.equal(sent.hostname, "runsignup.com");
  assert.equal(sent.searchParams.get("name"), "riverfront");
  assert.equal(sent.searchParams.get("state"), "OH");
  assert.equal(sent.searchParams.get("events"), "T");
  assert.equal(sent.searchParams.get("format"), "json");
});

test("A RunSignup outage is reported without breaking the app", async (t) => {
  const worker = await workerPromise;
  const env = { ASSETS: { fetch: async () => new Response("asset") } };
  t.mock.method(globalThis, "fetch", async () => new Response("down", { status: 503 }));
  const response = await worker.fetch(new Request("https://example.test/api/races/search?q=riverfront"), env);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Enter the race by hand/);
});
