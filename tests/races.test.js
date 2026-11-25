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

test("result times parse and past editions match the distance, newest first", async () => {
  const { parseResultSeconds, pastEditions } = await racesPromise;
  assert.equal(parseResultSeconds("18:00.5"), 1080);
  assert.equal(parseResultSeconds("1:44:58.9"), 6298);
  assert.equal(parseResultSeconds("DNF"), null);
  assert.equal(parseResultSeconds(""), null);
  const race = { events: [
    { event_id: 1, name: "5K", event_type: "running_race", start_time: "11/30/2024 08:45", distance: "5K" },
    { event_id: 2, name: "5K", event_type: "running_race", start_time: "11/29/2025 08:45", distance: "3.1 Miles" },
    { event_id: 3, name: "10K", event_type: "running_race", start_time: "11/29/2025 08:45", distance: "10K" },
    { event_id: 4, name: "Virtual Run - 5K", event_type: "running_race", start_time: "11/29/2025 08:45", distance: "5K" },
    { event_id: 5, name: "5K", event_type: "running_race", start_time: "11/28/2026 08:45", distance: "5K" }
  ] };
  assert.deepEqual(pastEditions(race, 5, "2026-11-16").map((edition) => edition.id), ["2", "1"]);
});

test("a past field keeps only time, gender and age", async () => {
  const { anonymousField } = await racesPromise;
  const field = anonymousField([
    { first_name: "Sam", last_name: "Runner", bib: "12", city: "Columbus", gender: "F", age: 34, chip_time: "25:10.2", clock_time: "25:30.0" },
    { first_name: "Alex", last_name: "Racer", gender: "M", age: 41, chip_time: "", clock_time: "19:05" },
    { first_name: "No", last_name: "Time", gender: "M", age: 20, chip_time: "DNF" },
    { first_name: "Pat", last_name: "Other", gender: "NB", age: 0, chip_time: "30:00" }
  ]);
  assert.deepEqual(field, [[1145, "M", 41], [1510, "F", 34], [1800, "X", null]]);
  assert.doesNotMatch(JSON.stringify(field), /Sam|Runner|Columbus|Alex/);
});

test("the field route validates its input and returns the latest edition with results", async () => {
  const worker = await workerPromise;
  const bad = await worker.fetch(new Request("https://runlore.app/api/races/field?race=abc&km=5"), {}, {});
  assert.equal(bad.status, 400);
  const calls = [];
  const realFetch = globalThis.fetch;
  const results = (count) => ({ individual_results_sets: [{ individual_result_set_id: 9, public_results: "T", results: Array.from({ length: count }, (_, i) => ({ first_name: "N", last_name: "N", gender: i % 2 ? "F" : "M", age: 30, chip_time: `20:${String(i).padStart(2, "0")}` })) }] });
  globalThis.fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes("/results/get-results")) return Response.json(url.includes("event_id=2") ? { individual_results_sets: [] } : results(12));
    return Response.json({ race: { events: [
      { event_id: 1, name: "5K", event_type: "running_race", start_time: "11/30/2024 08:45", distance: "5K" },
      { event_id: 2, name: "5K", event_type: "running_race", start_time: "11/29/2025 08:45", distance: "5K" }
    ] } });
  };
  try {
    const response = await worker.fetch(new Request("https://runlore.app/api/races/field?race=38072&km=5"), {}, {});
    assert.equal(response.status, 200);
    const body = await response.json();
    // 2025 has no results posted, so 2024 is used.
    assert.equal(body.date, "2024-11-30");
    assert.equal(body.finishers, 12);
    assert.deepEqual(body.field[0], [1200, "M", 30]);
    assert.ok(calls.every((url) => url.startsWith("https://runsignup.com/Rest/race/38072")));
  } finally { globalThis.fetch = realFetch; }
});

test("RunSignup calls carry the API caller registration when it is configured", async () => {
  const { runsignupRequest } = await racesPromise;
  const plain = runsignupRequest("https://runsignup.com/Rest/races?format=json", {});
  assert.equal(plain.url.searchParams.get("rsu_api_reg"), null);
  assert.equal(plain.headers["X-RSU-API-REG-SECRET"], undefined);
  const registered = runsignupRequest("https://runsignup.com/Rest/races?format=json&name=trot", { RUNSIGNUP_API_REG_TOKEN: "tok123", RUNSIGNUP_API_REG_SECRET: "sec456" });
  assert.equal(registered.url.searchParams.get("rsu_api_reg"), "tok123");
  assert.equal(registered.url.searchParams.get("name"), "trot");
  assert.equal(registered.headers["X-RSU-API-REG-SECRET"], "sec456");
  // The secret goes in a header, never in the URL.
  assert.doesNotMatch(String(registered.url), /sec456/);

  // Through the Worker: the search sends both.
  const worker = await workerPromise;
  let seen;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => { seen = { url: new URL(String(input)), headers: init.headers }; return Response.json({ races: [] }); };
  try {
    const response = await worker.fetch(new Request("https://runlore.app/api/races/search?q=turkey+trot"), { RUNSIGNUP_API_REG_TOKEN: "tok123", RUNSIGNUP_API_REG_SECRET: "sec456" }, {});
    assert.equal(response.status, 200);
    assert.equal(seen.url.searchParams.get("rsu_api_reg"), "tok123");
    assert.equal(seen.headers["X-RSU-API-REG-SECRET"], "sec456");
  } finally { globalThis.fetch = realFetch; }
});

// A response in the shape ACTIVE's Activity Search API v2 documents.
const activeSample = (from) => ({
  total_results: 4, items_per_page: 25, start_index: 0,
  results: [
    { assetGuid: "a1", assetName: "Columbus Turkey Trot 2026", activityStartDate: `${from.slice(0, 4)}-11-26T08:00:00`, activityEndDate: `${from.slice(0, 4)}-11-26T11:00:00`,
      place: { cityName: "Columbus", stateProvinceCode: "OH" }, registrationUrlAdr: "http://www.active.com/columbus-oh/running/turkey-trot-2026",
      assetAttributes: [{ attribute: { attributeType: "Distance (running)", attributeValue: "5K" } }, { attribute: { attributeType: "Distance (running)", attributeValue: "10K" } }] },
    { assetGuid: "a2", assetName: "Lakefront Half Marathon", activityStartDate: `${from.slice(0, 4)}-12-06T07:30:00`, place: { cityName: "Cleveland", stateProvinceCode: "OH" },
      urlAdr: "https://www.active.com/cleveland-oh/running/lakefront-half", assetComponents: [{ assetName: "Half Marathon" }, { assetName: "Kids Dash 100m" }] },
    { assetGuid: "a3", assetName: "Virtual Turkey Trot", activityStartDate: `${from.slice(0, 4)}-11-26T08:00:00` },
    { assetGuid: "a4", assetName: "Winter Running Club Membership", activityStartDate: `${from.slice(0, 4)}-12-01T00:00:00`, activityEndDate: `${Number(from.slice(0, 4)) + 1}-03-01T00:00:00` },
    { assetGuid: "a5", assetName: "Spam link race", activityStartDate: `${from.slice(0, 4)}-12-10T08:00:00`, registrationUrlAdr: "https://evil.example/register" }
  ]
});

test("ACTIVE listings become races with distances, place and an active.com link", async () => {
  const { normalizeActiveRaces } = await racesPromise;
  const year = new Date().getFullYear();
  const window = { from: `${year}-01-01`, to: `${year}-12-31` };
  const races = normalizeActiveRaces(activeSample(window.from), window);
  assert.deepEqual(races.map((race) => race.name), ["Columbus Turkey Trot 2026", "Lakefront Half Marathon", "Spam link race"]);
  const trot = races[0];
  assert.equal(trot.source, "ACTIVE");
  assert.equal(trot.date, `${year}-11-26`);
  assert.equal(trot.city, "Columbus");
  assert.deepEqual(trot.events.map((event) => event.distance), ["5K", "10K"]);
  // http is upgraded; other domains are not linked.
  assert.equal(trot.url, "https://www.active.com/columbus-oh/running/turkey-trot-2026");
  assert.equal(races[2].url, "");
  // The kids' dash is dropped; the half is kept.
  assert.deepEqual(races[1].events.map((event) => event.distance), ["Half marathon"]);
  assert.deepEqual(normalizeActiveRaces({}, window), []);
});

test("a race on both sites appears once, from RunSignup", async () => {
  const { mergeRaces } = await racesPromise;
  const runsignup = [{ name: "Columbus Turkey Trot", date: "2026-11-26", source: "RunSignup" }];
  const active = [{ name: "The 12th Annual Columbus Turkey Trot 2026", date: "2026-11-26", source: "ACTIVE" }, { name: "Columbus Turkey Trot", date: "2026-11-27", source: "ACTIVE" }, { name: "Lakefront Half", date: "2026-11-20", source: "ACTIVE" }];
  const merged = mergeRaces([runsignup, active]);
  assert.deepEqual(merged.map((race) => `${race.date} ${race.source}`), ["2026-11-20 ACTIVE", "2026-11-26 RunSignup", "2026-11-27 ACTIVE"]);
});

test("race search adds ACTIVE when its key is set, and survives one source failing", async () => {
  const worker = await workerPromise;
  const realFetch = globalThis.fetch;
  const calls = [];
  let activeStatus = 200;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === "api.amp.active.com") return activeStatus === 200 ? Response.json(activeSample(new Date().toISOString().slice(0, 10))) : new Response("nope", { status: activeStatus });
    return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
  };
  try {
    // No key: RunSignup only, and ACTIVE is never called.
    let response = await worker.fetch(new Request("https://runlore.app/api/races/search?q=turkey+trot"), {}, {});
    let body = await response.json();
    assert.deepEqual(body.sources, ["RunSignup"]);
    assert.ok(calls.every((url) => url.hostname !== "api.amp.active.com"));
    // With the key: both, the key only in the call to ACTIVE, never in the answer.
    const env = { ACTIVE_SEARCH_API_KEY: "active-key-123" };
    response = await worker.fetch(new Request("https://runlore.app/api/races/search?q=turkey+trot&state=oh"), env, {});
    body = await response.json();
    assert.deepEqual(body.sources, ["RunSignup", "ACTIVE"]);
    const activeCall = calls.find((url) => url.hostname === "api.amp.active.com");
    assert.equal(activeCall.searchParams.get("api_key"), "active-key-123");
    assert.equal(activeCall.searchParams.get("query"), "turkey trot");
    assert.equal(activeCall.searchParams.get("state"), "OH");
    assert.equal(activeCall.searchParams.get("category"), "event");
    assert.ok(body.races.some((race) => race.source === "ACTIVE"));
    assert.ok(body.races.some((race) => race.source === "RunSignup"));
    assert.doesNotMatch(JSON.stringify(body), /active-key-123/);
    // ACTIVE down: RunSignup's races still come back, flagged, and not cached.
    activeStatus = 503;
    response = await worker.fetch(new Request("https://runlore.app/api/races/search?q=lakefront+half"), env, {});
    body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.unavailable, ["ACTIVE"]);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally { globalThis.fetch = realFetch; }
});

test("a real ACTIVE reply: local race day, sub-event distances, kids' runs dropped, no tracking tag", async () => {
  const { normalizeActiveRaces } = await racesPromise;
  const reply = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/active-search.json"), "utf8"));
  const races = normalizeActiveRaces(reply, { from: "2026-11-01", to: "2027-11-01" });
  // The McAllen listing is a year-long registration window that started in 2025: not a race day.
  assert.equal(races.length, 1);
  const [trot] = races;
  assert.equal(trot.name, "Turkey Trot");
  assert.equal(trot.date, "2026-11-26");
  assert.equal(trot.city, "Sammamish");
  assert.equal(trot.state, "WA");
  // The race name is trimmed from sub-event names; the "5k dash" is the 5K; the kids' 2K is gone.
  assert.deepEqual(trot.events.map((event) => event.distance === "Other" ? event.name : event.distance), ["5K", "5 mile technical Trail Race", "10K", "10 mile Technical Trail Race"]);
  assert.equal(trot.url, "https://www.active.com/sammamish-wa/running/distance-running-races/turkey-trot-2026");
  // Fallback links lose the cmp tag that carries the account name.
  const fallback = normalizeActiveRaces({ results: [{ ...reply.results[0], registrationUrlAdr: "" }] }, { from: "2026-11-01", to: "2027-11-01" });
  assert.doesNotMatch(fallback[0].url, /cmp=/);
});

test("ACTIVE start times in UTC become the race's local day", async () => {
  const { activeDate } = await racesPromise;
  assert.equal(activeDate("2026-11-27T03:00:00", { timezone: "UTC", localTimeZoneId: "US/Pacific" }), "2026-11-26");
  assert.equal(activeDate("2026-11-26T17:00:00", { timezone: "UTC", localTimeZoneId: "US/Pacific" }), "2026-11-26");
  assert.equal(activeDate("2026-11-27T03:00:00", { timezone: "UTC", localTimeZoneId: "Not/AZone" }), "2026-11-27");
  assert.equal(activeDate("2026-11-27", {}), "2026-11-27");
  assert.equal(activeDate("", {}), null);
});
