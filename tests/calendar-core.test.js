const assert = require("node:assert/strict");
const { test } = require("node:test");
const core = require("../public/calendar-core.js");

const plans = {
  "2026-11-23": {
    savedAt: "2026-11-20T00:00:00Z",
    sessions: [
      { date: "2026-11-23", type: "easy", title: "Easy run", detail: "Conversational, effort", kind: "run", miles: 7.6, status: "skipped", matchedId: "" },
      { date: "2026-11-24", type: "easy", title: "Easy run", detail: "", kind: "run", miles: 8.2, status: "completed", matchedId: "9" },
      { date: "2026-11-25", type: "rest", title: "Rest / mobility", detail: "", kind: "rest", miles: 0, status: "planned", matchedId: "" },
      { date: "2026-11-26", type: "race", title: "Race day", detail: "", kind: "run", miles: 3.1, status: "planned", matchedId: "" },
      { date: "2026-11-26", type: "easy", title: "Shakeout", detail: "", kind: "run", miles: 1, status: "planned", matchedId: "" }
    ]
  },
  "2026-10-05": { savedAt: "2026-10-01T00:00:00Z", sessions: [{ date: "2026-10-05", title: "Long run", kind: "run", miles: 10, status: "planned" }] }
};
const races = [{ id: "r1", name: "Turkey Trot", date: "2026-11-26", distance: "5K", priority: "A", url: "https://runsignup.com/Race/1" }];

test("the feed has saved runs and races, without rest days or a duplicate race day", () => {
  const events = core.calendarEvents({ plans, races, since: "2026-11-01" });
  assert.deepEqual(events.map((event) => [event.date, event.summary]), [
    ["2026-11-23", "Easy run · 7.6 mi (skipped)"],
    ["2026-11-24", "✓ Easy run · 8.2 mi"],
    ["2026-11-26", "Shakeout · 1.0 mi"],
    ["2026-11-26", "🏁 Turkey Trot · 5K"]
  ]);
  assert.equal(events.find((event) => event.uid === "race-r1").description, "Goal race\nhttps://runsignup.com/Race/1");
});

test("ids stay stable per day, so a moved or edited session updates in place", () => {
  const ids = core.calendarEvents({ plans, races: [], since: "2026-11-01" }).map((event) => event.uid);
  // Without the race on the calendar, the plan's race day stays, and the second session that day gets -2.
  assert.deepEqual(ids, ["plan-2026-11-23", "plan-2026-11-24", "plan-2026-11-26", "plan-2026-11-26-2"]);
});

test("distances follow the runner's units", () => {
  const [first] = core.calendarEvents({ plans, races: [], units: "metric", since: "2026-11-01" });
  assert.equal(first.summary, "Easy run · 12.2 km (skipped)");
});

test("the file is valid iCalendar: CRLF lines, all-day dates, escaped and folded text", () => {
  const ics = core.buildPlanCalendar({ plans, races, since: "2026-11-01", now: new Date("2026-11-25T21:30:00.123Z"), domain: "runlore.test" });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "every line ends with CRLF");
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 4);
  assert.match(ics, /UID:plan-2026-11-23@runlore\.test\r\nDTSTAMP:20261125T213000Z\r\nDTSTART;VALUE=DATE:20261123\r\nDTEND;VALUE=DATE:20261124\r\n/);
  assert.match(ics, /DESCRIPTION:Conversational\\, effort\\nWeek of 2026-11-23/);
  assert.match(ics, /TRANSP:TRANSPARENT/);
  assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `line over 75 octets: ${line}`);
});

test("text escaping and line folding follow RFC 5545", () => {
  assert.equal(core.escapeText("a\\b;c,d\ne"), "a\\\\b\\;c\\,d\\ne");
  const long = `SUMMARY:${"é".repeat(60)}`;
  const folded = core.foldLine(long);
  assert.ok(folded.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  assert.equal(folded.split("\r\n").map((line, index) => (index ? line.slice(1) : line)).join(""), long, "unfolding restores the line, characters intact");
});

test("malformed saved data is skipped, never thrown", () => {
  const messy = { x: null, y: { sessions: [null, { kind: "run", date: "not-a-date", miles: 1 }, { kind: "run", date: "2026-12-01", miles: "abc", title: "Easy run" }] } };
  const events = core.calendarEvents({ plans: messy, races: [null, { date: "bad" }], since: "2026-11-01" });
  assert.deepEqual(events.map((event) => event.summary), ["Easy run · 0.0 mi"]);
  assert.match(core.buildPlanCalendar({ plans: undefined, races: undefined }), /BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/);
});

test("a day's workout and notes go in its description", () => {
  const training = require("../public/training-core.js");
  const workout = training.parseWorkout("4 x 1 mi threshold w/ 75 s jog");
  const week = { "2026-11-23": { savedAt: "2026-11-20T00:00:00Z", sessions: [{ date: "2026-11-23", type: "quality", title: "Quality option", detail: "Intervals or tempo", kind: "run", miles: 4.4, status: "planned", workout, notes: "Hills, if windy" }] } };
  const [event] = core.calendarEvents({ plans: week, since: "2026-11-01", describeWorkout: training.workoutSummary });
  assert.equal(event.description, "4 × 1 mi @ threshold, 75 s jog\nNotes: Hills, if windy\nWeek of 2026-11-23");
  // Without a describer the detail stays, and notes are still added.
  assert.equal(core.calendarEvents({ plans: week, since: "2026-11-01", describeWorkout: null })[0].description, "Intervals or tempo\nNotes: Hills, if windy\nWeek of 2026-11-23");
});
