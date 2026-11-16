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
