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
