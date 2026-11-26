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

test("a plain workout description becomes warm-up, sets and cool-down", () => {
  const workout = core.parseWorkout("2 mi warm up, 4 x 1 mile threshold with 75 sec jog recovery, 2 mi cool down");
  assert.deepEqual(workout, {
    warmup: { amount: 2, unit: "mi" },
    sets: [{ reps: 4, work: { amount: 1, unit: "mi", intensity: "threshold" }, recovery: { amount: 75, unit: "s", mode: "jog" } }],
    cooldown: { amount: 2, unit: "mi" }
  });
  assert.equal(core.workoutSummary(workout), "2 mi warm-up · 4 × 1 mi @ threshold, 75 s jog · 2 mi cool-down");
});

test("the parser reads shorthand, times, recovery modes and intensity words", () => {
  const summary = (text) => core.workoutSummary(core.parseWorkout(text));
  assert.equal(summary("6x800m @ interval, 400m jog"), "6 × 800 m @ interval, 400 m jog");
  assert.equal(summary("20 min tempo"), "20 min @ threshold");
  assert.equal(summary("10 x 1:30 hard w/ 1:00 walk"), "10 × 90 s @ interval, 60 s walk");
  assert.equal(summary("WU 15 min; 3 x 2 km marathon pace with 2 min rest; CD 10 min"), "15 min warm-up · 3 × 2 km @ marathon pace, 2 min rest · 10 min cool-down");
  assert.equal(core.parseWorkout("hello there"), null);
  assert.equal(core.parseWorkout(""), null);
  for (const template of core.WORKOUT_TEMPLATES) assert.ok(core.parseWorkout(template.text), template.key);
});

test("saved workouts are rebuilt from known fields only", () => {
  assert.equal(core.sanitizeWorkout(null), null);
  assert.equal(core.sanitizeWorkout({ sets: [{ reps: 3, work: { amount: -1, unit: "mi" } }] }), null);
  const cleaned = core.sanitizeWorkout({
    warmup: { amount: 1, unit: "furlong" },
    sets: [{ reps: 500, work: { amount: 400, unit: "m", intensity: "<script>" }, recovery: { amount: 1, unit: "min", mode: "nap" }, extra: "x" }],
    cooldown: null,
    html: "<img>"
  });
  assert.deepEqual(cleaned, { warmup: null, sets: [{ reps: 50, work: { amount: 400, unit: "m", intensity: "threshold" }, recovery: { amount: 1, unit: "min", mode: "jog" } }], cooldown: null });
});

test("workout distance converts timed parts at pace and skips standing rest and the last recovery", () => {
  // 4 x 1 mi plus three 400 m jogs.
  assert.equal(core.workoutMiles({ sets: [{ reps: 4, work: { amount: 1, unit: "mi", intensity: "threshold" }, recovery: { amount: 400, unit: "m", mode: "jog" } }] }), 4.7);
  assert.equal(core.workoutMiles({ sets: [{ reps: 4, work: { amount: 1, unit: "mi", intensity: "threshold" }, recovery: { amount: 2, unit: "min", mode: "rest" } }] }), 4);
  // 20 min at a 6:40/mi threshold pace is 3 miles.
  const paces = { threshold: [400 / 1609.344, 400 / 1609.344] };
  assert.equal(core.workoutMiles({ sets: [{ reps: 1, work: { amount: 20, unit: "min", intensity: "threshold" } }] }, paces), 3);
  assert.deepEqual(core.workoutTargetPace("threshold", paces), [400, 400]);
  assert.equal(core.workoutTargetPace("threshold", null), null);
  assert.equal(core.workoutMiles(null), 0);
});

test("a rest day drops its workout and keeps its notes", () => {
  const session = { date: "2026-11-23", type: "quality", title: "Quality option", kind: "run", miles: 5, status: "planned", matchedId: "", notes: "Legs heavy", workout: core.parseWorkout("20 min tempo") };
  const rest = core.retypeSession(session, "rest");
  assert.equal(rest.workout, undefined);
  assert.equal(rest.notes, "Legs heavy");
  assert.deepEqual(core.retypeSession(session, "long").workout, session.workout);
});
