const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../public/training-core.js");
const parse = (run) => new Date(`${run.day}T12:00:00`);

test("ramp uses complete weeks, includes quiet weeks, and excludes the current partial week", () => {
  const runs = [
    { day: "2026-08-03", distance: 10 }, { day: "2026-08-10", distance: 10 },
    { day: "2026-08-17", distance: 30 }, { day: "2026-08-24", distance: 10 },
    { day: "2026-08-31", distance: 1000 }
  ];
  assert.equal(core.rampRate(runs, new Date("2026-08-01"), new Date("2026-09-02T12:00:00"), parse), 100);
  assert.equal(core.rampRate(runs, new Date("2026-08-01"), new Date("2026-08-30T23:59:59"), parse), 100);
  assert.equal(core.rampRate(runs, new Date("2026-08-20"), new Date("2026-09-02T12:00:00"), parse), null);
  assert.equal(core.rampRate([], new Date("2026-08-01"), new Date("2026-09-02T12:00:00"), parse), null);
});
test("undated, expired and future check-ins do not influence current training", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  for (const savedAt of [undefined, "2026-10-01", "2026-11-01", "invalid"]) assert.deepEqual(core.freshCheckin({ outcome: "missed", savedAt }, now), {});
  assert.equal(core.freshCheckin({ outcome: "missed", savedAt: "2026-10-20T12:00:00Z" }, now).outcome, "missed");
});
test("merging replaces duplicate IDs, preserves distinct records, and handles numeric IDs", () => {
  assert.deepEqual(core.mergeActivities([{ id: 1, distance: 2 }, { id: 2, distance: 3 }], [{ id: "1", distance: 5 }]), [{ id: "1", distance: 5 }, { id: 2, distance: 3 }]);
});

/* ---------- Editing a planned week ---------- */

const week = () => [
  { date: "2026-11-30", title: "Rest / mobility", detail: "", kind: "rest", miles: 0, status: "planned", matchedId: "" },
  { date: "2026-12-01", title: "Quality option", detail: "", kind: "run", miles: 6, status: "completed", matchedId: "55" },
  { date: "2026-12-02", title: "Rest / mobility", detail: "", kind: "rest", miles: 0, status: "planned", matchedId: "" },
  { date: "2026-12-03", title: "Steady run", detail: "", kind: "run", miles: 4, status: "planned", matchedId: "" },
  { date: "2026-12-05", title: "Long run", detail: "", kind: "run", miles: 10, status: "planned", matchedId: "" },
  { date: "2026-12-06", title: "Race day", detail: "", kind: "run", miles: 3.1, status: "planned", matchedId: "" }
];

test("a session's type is read from its saved type, else from the title of older plans", () => {
  assert.deepEqual(week().map(core.sessionType), ["rest", "quality", "rest", "steady", "long", "race"]);
  assert.equal(core.sessionType({ kind: "run", title: "Easy long run" }), "long");
  assert.equal(core.sessionType({ kind: "run", title: "Easy run" }), "easy");
  assert.equal(core.sessionType({ kind: "run", title: "Whatever", type: "steady" }), "steady");
  assert.equal(core.sessionType({ kind: "run", title: "Easy run", type: "bogus" }), "easy");
});

test("turning a rest day into a run gives it the week's typical distance, races left out", () => {
  const sessions = week();
  const run = core.retypeSession(sessions[0], "easy", sessions);
  assert.equal(run.kind, "run");
  assert.equal(run.title, "Easy run");
  assert.equal(run.type, "easy");
  assert.equal(run.miles, 6.7); // (6 + 4 + 10) / 3
  assert.equal(core.retypeSession({ date: "2026-12-01", kind: "rest", miles: 0, title: "Rest / mobility" }, "long", []).miles, 3);
});

test("retyping a run keeps its distance and status, and a rest day drops both", () => {
  const sessions = week();
  const easier = core.retypeSession(sessions[1], "easy", sessions);
  assert.deepEqual([easier.miles, easier.status, easier.matchedId, easier.title], [6, "completed", "55", "Easy run"]);
  const rest = core.retypeSession(sessions[1], "rest", sessions);
  assert.deepEqual([rest.kind, rest.miles, rest.status, rest.matchedId], ["rest", 0, "planned", ""]);
  assert.equal(sessions[1].kind, "run", "the original session is not changed");
  assert.throws(() => core.retypeSession(sessions[1], "nap", sessions));
});

test("moving a day onto another swaps them and clears what belongs to the old date", () => {
  const moved = core.moveSession(week(), "2026-12-01", "2026-12-02");
  assert.deepEqual(moved.map((session) => [session.date, session.title]).slice(0, 3), [["2026-11-30", "Rest / mobility"], ["2026-12-01", "Rest / mobility"], ["2026-12-02", "Quality option"]]);
  const quality = moved.find((session) => session.title === "Quality option");
  assert.deepEqual([quality.status, quality.matchedId], ["planned", ""]);
  assert.equal(moved.length, 6);
  assert.equal(new Set(moved.map((session) => session.date)).size, 6, "still one session per day");
  // A day with no session yet (Friday) just receives the moved one.
  const onto = core.moveSession(week(), "2026-12-03", "2026-12-04");
  assert.deepEqual(onto.filter((session) => session.title === "Steady run").map((session) => session.date), ["2026-12-04"]);
  assert.deepEqual(core.moveSession(week(), "2026-12-01", "2026-12-01"), week());
});

test("distances are clamped, and a rest day's stays zero", () => {
  const sessions = week();
  assert.equal(core.setSessionMiles(sessions[3], 4.567).miles, 4.57);
  assert.equal(core.setSessionMiles(sessions[3], -2).miles, 0);
  assert.equal(core.setSessionMiles(sessions[3], 900).miles, 100);
  assert.equal(core.setSessionMiles(sessions[3], "abc").miles, 0);
  assert.equal(core.setSessionMiles(sessions[0], 5).miles, 0);
});

test("week totals count runs, what is done, and what was skipped", () => {
  const sessions = week(); sessions[3].status = "skipped";
  assert.deepEqual(core.weekTotals(sessions), { miles: 23.1, runs: 4, completedMiles: 6, completedRuns: 1, skippedRuns: 1 });
  assert.deepEqual(core.weekTotals([]), { miles: 0, runs: 0, completedMiles: 0, completedRuns: 0, skippedRuns: 0 });
});

test("a race day takes the race's own distance when it is known", () => {
  assert.equal(core.raceMiles({ distance: "5K" }), 3.1);
  assert.equal(core.raceMiles({ distance: "10K" }), 6.2);
  assert.equal(core.raceMiles({ distance: "Half marathon" }), 13.1);
  assert.equal(core.raceMiles({ distance: "Marathon" }), 26.2);
  assert.equal(core.raceMiles({ distance: "Other" }), null);
  assert.equal(core.raceMiles(undefined), null);
  const sessions = week();
  const easy = sessions[3]; // a 4 mi steady run
  assert.equal(core.retypeSession(easy, "race", sessions, { race: { distance: "10K" } }).miles, 6.2);
  assert.equal(core.retypeSession(easy, "race", sessions, { race: { distance: "Other" } }).miles, 4, "an unknown distance keeps the run's own");
  assert.equal(core.retypeSession(sessions[0], "race", sessions).miles, 6.7, "no race that day: the week's typical run");
});
