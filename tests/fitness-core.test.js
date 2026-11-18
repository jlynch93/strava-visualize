const { test } = require("node:test");
const assert = require("node:assert/strict");
const fit = require("../public/fitness-core.js");

const parseDate = (run) => new Date(run.start_date_local);
const profile = { maxHr: 190, restHr: 50 };

test("VDOT matches published Daniels values", () => {
  assert.ok(Math.abs(fit.vdotFromPerformance(5000, 20 * 60) - 49.8) < 0.3);
  assert.ok(Math.abs(fit.vdotFromPerformance(42195, 3 * 3600) - 53.5) < 0.6);
});

test("race predictions round-trip through VDOT", () => {
  const vdot = fit.vdotFromPerformance(10000, 45 * 60);
  assert.ok(Math.abs(fit.predictRaceSeconds(vdot, 10000) - 45 * 60) < 1);
  const marathon = fit.predictRaceSeconds(50, 42195);
  assert.ok(Math.abs(marathon - (3 * 3600 + 10 * 60 + 49)) < 90, `marathon ${marathon}`);
});

test("training paces are ordered from easy to repetition", () => {
  const paces = fit.trainingPaces(50);
  assert.ok(paces.easy[1] > paces.easy[0]);
  assert.ok(paces.easy[0] > paces.marathon[0]);
  assert.ok(paces.marathon[0] > paces.threshold[0]);
  assert.ok(paces.threshold[0] > paces.interval[0]);
  assert.ok(paces.interval[0] > paces.repetition[0]);
});

test("max HR ignores a single sensor spike", () => {
  const runs = [{ max_heartrate: 240 }, { max_heartrate: 199 }, { max_heartrate: 186 }, { max_heartrate: 181 }];
  assert.equal(fit.estimateMaxHr(runs), 186);
  assert.equal(fit.estimateMaxHr([]), null);
});

test("per-run VO2 estimate is plausible and rejects unusable runs", () => {
  // 10 km in 50 min at 150 bpm: %HRR 0.71.
  const run = { distance: 10000, moving_time: 3000, average_heartrate: 150, total_elevation_gain: 0, sport_type: "Run" };
  const estimate = fit.runVo2Estimate(run, profile);
  assert.ok(estimate > 45 && estimate < 55, `estimate ${estimate}`);
  assert.equal(fit.runVo2Estimate({ ...run, average_heartrate: 0 }, profile), null);
  assert.equal(fit.runVo2Estimate({ ...run, moving_time: 600, distance: 2000 }, profile), null);
  assert.equal(fit.runVo2Estimate({ ...run, sport_type: "TrailRun" }, profile), null);
  assert.equal(fit.runVo2Estimate(run, null), null);
});

test("load model scores one hour at threshold as 100 points", () => {
  const threshold = { moving_time: 3600, distance: 15000, average_heartrate: 50 + 0.88 * 140 };
  assert.ok(Math.abs(fit.runLoad(threshold, profile).load - 100) < 0.5);
  const paceOnly = fit.runLoad({ moving_time: 3600, distance: 15000 }, profile, 250);
  assert.equal(paceOnly.source, "pace");
  assert.ok(Math.abs(paceOnly.load - 100) < 0.5);
  assert.equal(fit.runLoad({ moving_time: 3600 }, null, 0).source, "duration");
});

test("fitness rises with steady training and form drops after a load spike", () => {
  const loads = new Map();
  const start = new Date(2026, 0, 1);
  for (let day = 0; day < 60; day += 1) loads.set(fit.dayKey(new Date(2026, 0, 1 + day)), 60);
  for (let day = 60; day < 67; day += 1) loads.set(fit.dayKey(new Date(2026, 0, 1 + day)), 150);
  const series = fit.loadSeries(loads, start, new Date(2026, 0, 68));
  assert.ok(series[59].fitness > 40 && series[59].fitness < 60);
  assert.ok(series[series.length - 1].form < -20);
  const ratios = fit.workloadRatios(loads, new Date(2026, 0, 67));
  assert.ok(ratios.acwr > 1.5);
});

test("readiness separates rested and overloaded states", () => {
  const rested = fit.readiness({ form: 8, fitness: 50, acwr: 1, hoursSinceHard: 72 });
  const tired = fit.readiness({ form: -25, fitness: 50, acwr: 1.7, hoursSinceHard: 12, checkin: { feel: 2, limiter: "sleep" } });
  assert.ok(rested.score >= 75, `rested ${rested.score}`);
  assert.equal(rested.key, "primed");
  assert.ok(tired.score < 35, `tired ${tired.score}`);
  assert.equal(tired.key, "recover");
  assert.equal(fit.readiness({}), null);
});

test("VO2 series needs several samples before reporting", () => {
  const runs = Array.from({ length: 5 }, (_, index) => ({
    id: index, start_date_local: `2026-03-0${index + 1}T07:00:00`, distance: 10000, moving_time: 3000, average_heartrate: 150, sport_type: "Run"
  }));
  const series = fit.vo2Series(runs, profile, parseDate);
  assert.equal(series[1].vo2max, null);
  assert.ok(series[4].vo2max > 45);
  assert.ok(series[4].vdot > 35);
});

test("run types come from effort and distance, not names", () => {
  const context = { profile, thresholdSpeed: 250, typicalMeters: 10000 };
  const base = { distance: 10000, moving_time: 3000, sport_type: "Run" };
  assert.equal(fit.classifyRunType({ ...base, workout_type: 1 }, context).key, "race");
  assert.equal(fit.classifyRunType({ ...base, distance: 21000, moving_time: 6600, average_heartrate: 150 }, context).key, "long");
  assert.equal(fit.classifyRunType({ ...base, average_heartrate: 170 }, context).key, "quality");
  assert.equal(fit.classifyRunType({ ...base, average_heartrate: 140 }, context).key, "easy");
  assert.equal(fit.classifyRunType({ ...base, distance: 6000, average_heartrate: 125 }, context).key, "recovery");
  // Without heart rate, pace relative to threshold decides.
  assert.equal(fit.classifyRunType({ distance: 8000, moving_time: 1800 }, context).key, "quality");
  assert.equal(fit.classifyRunType({ distance: 8000, moving_time: 2400 }, context).key, "easy");
  assert.equal(fit.classifyRunType({ distance: 8000, moving_time: 2700 }, context).key, "recovery");
});

test("walks and hikes are recognized and typed on the same groups as runs", () => {
  assert.equal(fit.isWalk({ sport_type: "Walk" }), true);
  assert.equal(fit.isWalk({ type: "Hike" }), true);
  assert.equal(fit.isWalk({ sport_type: "Run" }), false);
  assert.equal(fit.isWalk({ sport_type: "TrailRun" }), false);
  const context = { typicalMeters: 4000 };
  assert.equal(fit.classifyWalkType({ sport_type: "Walk", distance: 4000 }, context).key, "walk");
  assert.equal(fit.classifyWalkType({ sport_type: "Walk", distance: 9000 }, context).key, "long-walk");
  assert.equal(fit.classifyWalkType({ sport_type: "Hike", distance: 5000 }, context).key, "hike");
  // A steep walk reads as a hike even when the source called it a walk.
  assert.equal(fit.classifyWalkType({ sport_type: "Walk", distance: 5000, total_elevation_gain: 300 }, context).key, "hike");
  for (const type of Object.values(fit.WALK_TYPES)) assert.ok(["easy", "long", "quality"].includes(type.group));
});

test("walk load uses the same scale as runs", () => {
  // An hour of walking at a low heart rate is light next to an hour at threshold.
  const walk = fit.runLoad({ moving_time: 3600, distance: 5500, average_heartrate: 50 + 0.4 * 140 }, profile);
  const threshold = fit.runLoad({ moving_time: 3600, distance: 15000, average_heartrate: 50 + 0.88 * 140 }, profile);
  assert.ok(walk.load > 5 && walk.load < 35, `walk load ${walk.load}`);
  assert.ok(threshold.load > walk.load * 3);
});

/* ---------- Training cycle ---------- */

const day = (offset) => { const date = new Date(2026, 10, 16); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const TODAY = new Date(2026, 10, 16, 9);
const marathon = (offset, priority = "A") => ({ name: "City Marathon", date: day(offset), distance: "Marathon", priority });

test("the next A race sets the phase from base to race day", () => {
  assert.equal(fit.trainingPhase([], TODAY), null);
  assert.equal(fit.trainingPhase([marathon(120)], TODAY).key, "base");
  assert.equal(fit.trainingPhase([marathon(56)], TODAY).key, "build");
  assert.equal(fit.trainingPhase([marathon(30)], TODAY).key, "peak");
  assert.equal(fit.trainingPhase([marathon(12)], TODAY).key, "taper", "A marathon tapers for two weeks.");
  assert.equal(fit.trainingPhase([{ ...marathon(12), distance: "10K" }], TODAY).key, "peak", "A 10K tapers for one week.");
  assert.equal(fit.trainingPhase([marathon(5)], TODAY).key, "race-week");
  const raceDay = fit.trainingPhase([marathon(0)], TODAY);
  assert.equal(raceDay.key, "race-day");
  assert.equal(raceDay.detail, "City Marathon today");
});

test("tune-up races get a short taper, and every race is followed by recovery", () => {
  const tuneUp = fit.trainingPhase([marathon(60), { name: "Turkey Trot", date: day(3), distance: "5K", priority: "B" }], TODAY);
  assert.equal(tuneUp.key, "tune-up");
  assert.equal(tuneUp.label, "B race");
  // Outside the tune-up's own taper, the A race decides.
  assert.equal(fit.trainingPhase([marathon(60), { name: "Turkey Trot", date: day(10), distance: "5K", priority: "B" }], TODAY).key, "build");
  const recovery = fit.trainingPhase([marathon(-3), marathon(150)], TODAY);
  assert.equal(recovery.key, "recovery");
  assert.equal(recovery.daysSince, 3);
  assert.equal(recovery.total, fit.recoveryDays(marathon(0)));
  assert.ok(fit.recoveryDays(marathon(0)) > fit.recoveryDays({ distance: "5K", priority: "A" }));
  assert.ok(fit.recoveryDays({ distance: "Marathon", priority: "C" }) < fit.recoveryDays(marathon(0)));
  // Recovery ends; the next A race takes over.
  assert.equal(fit.trainingPhase([marathon(-20), marathon(150)], TODAY).key, "base");
});

test("the same fatigue reads differently in a build than in a taper", () => {
  const tired = { form: -10, fitness: 50, acwr: 1.1, hoursSinceHard: 60 };
  const build = fit.readiness({ ...tired, phase: fit.trainingPhase([marathon(56)], TODAY) });
  const taper = fit.readiness({ ...tired, phase: fit.trainingPhase([marathon(10)], TODAY) });
  assert.ok(build.score > taper.score + 10, `build ${build.score} vs taper ${taper.score}`);
  assert.match(build.factors.find((factor) => factor.key === "form").detail, /on target for build/);
  assert.match(build.advice, /^Build phase/);
  assert.match(taper.advice, /^Taper/);
  const freshTaper = fit.readiness({ form: 8, fitness: 50, acwr: 0.8, hoursSinceHard: 72, phase: fit.trainingPhase([marathon(10)], TODAY) });
  assert.ok(freshTaper.score >= 75, `fresh taper ${freshTaper.score}`);
  assert.equal(freshTaper.factors.find((factor) => factor.key === "cycle").label, "Training cycle");
});

test("early race recovery is never a day for quality", () => {
  const fresh = { form: 12, fitness: 50, acwr: 0.7, hoursSinceHard: 96 };
  const recovering = fit.readiness({ ...fresh, phase: fit.trainingPhase([marathon(-2)], TODAY) });
  assert.ok(recovering.score <= 54);
  assert.notEqual(recovering.key, "primed");
  assert.match(recovering.advice, /Recovering from your race/);
  // Without races, the same numbers are primed, as before.
  assert.equal(fit.readiness(fresh).key, "primed");
  assert.equal(fit.readiness(fresh).phase, null);
});

test("projecting to race day: a taper turns build fatigue into race-day freshness", () => {
  const race = { name: "City Marathon", date: day(56), distance: "Marathon", priority: "A" };
  // Mid-build: fatigue above fitness (negative form) on a steady 60/day.
  const projection = fit.projectRaceDay({ start: { fitness: 50, fatigue: 62 }, usualLoad: 60, today: TODAY, race });
  assert.equal(projection.days.length, 56);
  assert.equal(projection.days.at(-1).stage, "race");
  assert.equal(projection.taperDays, 14);
  const stages = projection.days.map((point) => point.stage);
  assert.equal(stages.filter((stage) => stage === "race-week").length, 7);
  assert.equal(stages.filter((stage) => stage === "taper").length, 7);
  assert.ok(projection.raceDay.form > 5, `race-day form ${projection.raceDay.form}`);
  assert.ok(["ready", "fresh"].includes(projection.raceDay.zone.key));
  // Without the taper the same runner would arrive balanced, not fresh.
  const noTaperFatigue = projection.days.find((point) => point.stage === "taper").form;
  assert.ok(projection.raceDay.form > noTaperFatigue + 5);
  // Race day reports how you arrive: it is not trained itself.
  assert.equal(projection.days.at(-1).load, 0);
  assert.equal(fit.projectRaceDay({ start: { fitness: 50, fatigue: 50 }, usualLoad: 60, today: TODAY, race: { ...race, date: day(-1) } }), null);
});

test("projected days are consecutive local dates ending on race day", () => {
  const race = { date: day(10), distance: "10K", priority: "A" };
  const projection = fit.projectRaceDay({ start: { fitness: 40, fatigue: 40 }, usualLoad: 50, today: TODAY, race });
  const local = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  assert.equal(local(projection.days[0].date), day(1));
  assert.equal(local(projection.days.at(-1).date), race.date);
});

test("a finish time is placed overall, by gender and by five-year age group", () => {
  const field = [[1000, "M", 31], [1100, "F", 28], [1200, "M", 33], [1300, "M", 45], [1400, "F", 32], [1500, "X", null], [1600, "M", 30]];
  const place = fit.projectPlace(field, 1250, { gender: "M", age: 32 });
  assert.deepEqual(place.overall, { place: 4, of: 7, percent: 57 });
  assert.deepEqual(place.gender, { place: 3, of: 4, percent: 75 });
  assert.equal(place.ageGroup.label, "30–34");
  assert.equal(place.ageGroup.place, 3);
  assert.equal(place.ageGroup.of, 3);
  // Without a profile only the overall place is known.
  assert.equal(fit.projectPlace(field, 1250).gender, null);
  // Slower than everyone: last place plus one, never "8th of 7".
  assert.deepEqual(fit.projectPlace(field, 9999).overall, { place: 8, of: 8, percent: 100 });
  // Nobody in the age group last time.
  assert.equal(fit.projectPlace(field, 1250, { gender: "F", age: 61 }).ageGroup.empty, true);
  assert.equal(fit.projectPlace([], 1250), null);
  assert.equal(fit.ageGroup(12).label, "14 & under");
  assert.equal(fit.ageGroup(84).label, "80+");
});

const recordRun = (offset, km, minutes, extra = {}) => ({ id: `r${offset}-${km}`, date: new Date(2026, 10, 16 + offset, 7), distance: km * 1000, moving_time: minutes * 60, total_elevation_gain: 0, ...extra });
const byKey = (records) => Object.fromEntries(records.map((record) => [record.key, record]));

test("personal records: longest, fastest at distance, climbing, biggest week and streak", () => {
  const runs = [
    recordRun(-60, 10, 55), recordRun(-59, 5, 25), recordRun(-58, 6, 33, { total_elevation_gain: 300 }),
    recordRun(-30, 21.1, 120), recordRun(-3, 24, 140), recordRun(-2, 5, 23), recordRun(-1, 8, 44)
  ];
  const records = byKey(fit.personalRecords(runs, (run) => run.date, { today: TODAY }));
  assert.equal(records.longest.value, 24000);
  assert.equal(records.longest.isNew, true);
  assert.equal(records.longest.previous.value, 21100);
  // 5K+ pace: 23 min over 5 km beats 25 min, and it is new.
  assert.equal(Math.round(records["fastest-5k"].value * 1000), 276);
  assert.equal(records["fastest-5k"].isNew, true);
  // 10K to half: the 10 km in 55 min (330 s per km) is the only one, so not new.
  assert.equal(Math.round(records["fastest-10k"].value * 1000), 330);
  assert.equal(records["fastest-10k"].isNew, false);
  // Half and longer: 24 km in 140 min beats 21.1 km in 120 min? No: 350 vs 341 s/km, the half holds.
  assert.equal(Math.round(records["fastest-half"].value * 1000), 341);
  // The 8 km in 44 min falls in the 5-10K bucket but is slower than the 5 km in 23.
  assert.equal(records["fastest-5k"].run.distance, 5000);
  assert.equal(records.climb.value, 300);
  assert.equal(records.streak.value, 3);
  // The last three runs fall in the week of Nov 9-15 (Mon-Sun) with 37 km.
  assert.equal(records["biggest-week"].value, 37000);
  assert.equal(records["biggest-week"].start.getDate(), 9);
  // A first-ever record is not "new": there was nothing to beat.
  assert.equal(byKey(fit.personalRecords([recordRun(-1, 5, 25)], (run) => run.date, { today: TODAY })).longest.isNew, false);
  assert.deepEqual(fit.personalRecords([], (run) => run.date), []);
});

test("aerobic efficiency is metres per heartbeat, trended weekly without hard sessions", () => {
  // 10 km in 50 min at 150 bpm: 10000 / (50 * 150) = 1.333 m per beat.
  assert.equal(fit.metersPerBeat({ distance: 10000, moving_time: 3000, average_heartrate: 150 }).toFixed(3), "1.333");
  // Climbing counts as extra distance; short or HR-less runs are skipped.
  assert.ok(fit.metersPerBeat({ distance: 10000, moving_time: 3000, average_heartrate: 150, total_elevation_gain: 100 }) > 1.333);
  assert.equal(fit.metersPerBeat({ distance: 3000, moving_time: 900, average_heartrate: 150 }), null);
  assert.equal(fit.metersPerBeat({ distance: 10000, moving_time: 3000, average_heartrate: 0 }), null);
  const runs = [];
  for (let week = 0; week < 16; week += 1) {
    // Same pace each week, heart rate falling from 160 to 145: efficiency rises.
    runs.push({ id: `e${week}`, date: new Date(2026, 10, 16 - (15 - week) * 7 - 1, 7), distance: 10000, moving_time: 3000, average_heartrate: 160 - week, total_elevation_gain: 0 });
  }
  runs.push({ id: "hard", date: new Date(2026, 10, 14, 7), distance: 10000, moving_time: 2400, average_heartrate: 175 });
  const types = new Map([["hard", { key: "quality" }]]);
  const trend = fit.efficiencyTrend(runs, (run) => run.date, { types, today: TODAY });
  assert.equal(trend.series.length, 16);
  assert.ok(trend.change > 0.04 && trend.change < 0.08, `change ${trend.change}`);
  assert.ok(trend.series.every((point) => point.runs === 1), "the quality session is left out");
});

test("a pacing plan reaches the goal time exactly, even or negative split", () => {
  const even = fit.pacingPlan(42195, 3.5 * 3600);
  assert.equal(even.length, 27);
  assert.equal(even.at(-1).partial, true);
  assert.ok(Math.abs(even.at(-1).elapsed - 3.5 * 3600) < 0.01);
  assert.ok(Math.abs(even[0].splitSeconds - even[10].splitSeconds) < 0.01);
  const negative = fit.pacingPlan(42195, 3.5 * 3600, { negative: 0.02 });
  assert.ok(Math.abs(negative.at(-1).elapsed - 3.5 * 3600) < 0.01);
  assert.ok(negative[0].splitSeconds > negative[20].splitSeconds, "second half is faster");
  const km = fit.pacingPlan(5000, 1500, { splitMeters: 1000 });
  assert.deepEqual(km.map((split) => Math.round(split.splitSeconds)), [300, 300, 300, 300, 300]);
  assert.equal(km.at(-1).partial, false);
  assert.deepEqual(fit.pacingPlan(0, 100), []);
});

test("a yearly goal projects from the pace so far and says what the rest of the year needs", () => {
  // Day 320 of 365 (Nov 16), 1,600 km so far against a 2,000 km goal.
  const plan = fit.yearProjection({ soFar: 1600e3, today: TODAY, goal: 2000e3 });
  assert.equal(plan.elapsedDays, 320);
  assert.equal(plan.remainingDays, 45);
  assert.equal(Math.round(plan.projected / 1000), 1825);
  assert.equal(plan.onTrack, false);
  assert.equal(Math.round(plan.left / 1000), 400);
  assert.equal(Math.round(plan.neededPerWeek / 1000), 62);
  assert.equal(Math.round(plan.expectedByNow / 1000), 1753);
  assert.ok(plan.ahead < 0);
  // No goal: only the projection.
  assert.equal(fit.yearProjection({ soFar: 100e3, today: new Date(2026, 0, 10) }).neededPerWeek, undefined);
  assert.equal(fit.yearProjection({ soFar: 2100e3, today: TODAY, goal: 2000e3 }).done, true);
});

test("intensity balance is the share of running time that was hard over four weeks", () => {
  const runs = [], types = new Map();
  for (let i = 0; i < 12; i += 1) {
    const id = `i${i}`;
    runs.push({ id, date: new Date(2026, 10, 15 - i * 2, 7), moving_time: 3600 });
    types.set(id, { group: i % 4 === 0 ? "quality" : i % 4 === 1 ? "long" : "easy" });
  }
  const balance = fit.intensityBalance(runs, types, (run) => run.date, { today: TODAY });
  // 12 runs inside 28 days? i=0..11 spans 22 days: yes. 3 of 12 hard = 25%.
  assert.equal(balance.runs, 12);
  assert.equal(balance.hardShare, 0.25);
  assert.equal(balance.key, "hard-side");
  types.forEach((type, id) => types.set(id, { group: "easy" }));
  assert.equal(fit.intensityBalance(runs, types, (run) => run.date, { today: TODAY }).key, "all-easy");
  assert.equal(fit.intensityBalance(runs.slice(0, 3), types, (run) => run.date, { today: TODAY }), null);
});

test("shoe mileage goes to the newest shoe in use on each run's day", () => {
  const runs = [
    { id: 1, date: new Date(2026, 0, 5, 7), distance: 10000 },
    { id: 2, date: new Date(2026, 5, 5, 7), distance: 12000 },
    { id: 3, date: new Date(2026, 9, 5, 7), distance: 8000 },
    { id: 4, date: new Date(2025, 11, 1, 7), distance: 5000 }
  ];
  const shoes = [
    { id: "a", name: "Old pair", start: "2026-01-01", retired: "2026-09-01", limit: 20000 },
    { id: "b", name: "Racer", start: "2026-06-01", limit: 600000 },
    { id: "c", name: "Daily", start: "2026-09-01", limit: 9000 }
  ];
  const [old, racer, daily] = fit.shoeMileage(runs, shoes, (run) => run.date);
  // Jan run: only the old pair. June run: the racer started later, so it takes it.
  assert.deepEqual([old.meters, racer.meters, daily.meters], [10000, 12000, 8000]);
  assert.equal(old.status, "retired");
  assert.equal(daily.status, "nearly");
  assert.equal(racer.status, "fine");
  // A run before any shoe goes nowhere.
  assert.equal(old.runs + racer.runs + daily.runs, 3);
});

test("year highlights count long runs, streaks, consistency and early starts", () => {
  const run = (month, day, km, hour = 9, climb = 0) => ({ date: new Date(2026, month, day, hour), distance: km * 1000, total_elevation_gain: climb });
  const runs = [
    run(0, 3, 21.1, 6), run(0, 4, 10, 6), run(0, 5, 8, 6), run(0, 6, 5, 21),   // a 4-day streak, 3 early, 1 late
    run(3, 12, 42.2, 7, 500), run(5, 20, 55, 6, 1200),                        // marathon and ultra (both also halves)
    run(10, 10, 12), run(10, 11, 12), run(10, 12, 12),                        // 36 km in the week of Nov 9
    { date: new Date(2025, 11, 31, 9), distance: 50000 }                      // last year: left out
  ];
  const facts = fit.yearHighlights(runs, (item) => item.date, 2026, { today: TODAY, hourOf: (item) => item.date.getHours() });
  assert.equal(facts.runs, 9);
  assert.equal(facts.halves, 3);
  assert.equal(facts.marathons, 2);
  assert.equal(facts.ultras, 1);
  assert.equal(facts.longestStreak, 4);
  // Biggest week: the 55 km ultra on its own (week of Jun 15) beats 36 km in November.
  assert.equal(facts.biggestWeek.meters, 55000);
  assert.equal(facts.biggestWeek.start.getMonth(), 5);
  assert.equal(facts.biggestWeek.start.getDate(), 15);
  assert.equal(facts.climb, 1700);
  assert.equal(facts.monthsActive, 4);
  assert.equal(facts.monthsSoFar, 11);
  assert.equal(facts.earlyRuns, 4);
  assert.equal(facts.lateRuns, 1);
  assert.ok(facts.weeksSoFar >= 46 && facts.weeksSoFar <= 47);
  // Jan 3 2026 is a Saturday: Sat, Sun, Mon, Tue; Apr 12 Sun; Jun 20 Sat; Nov 10-12 Tue-Thu.
  assert.deepEqual(facts.weekdays, [1, 2, 1, 1, 0, 2, 2]);
  // Start hours 6,6,6,21,7,6,9,9,9: four before 7, four 7-11, one after 8.
  assert.deepEqual(facts.timesOfDay, [4, 4, 0, 0, 0, 1]);
  assert.equal(facts.knownTimes, 9);
  assert.equal(facts.mostRunsInWeek, 3);
});
