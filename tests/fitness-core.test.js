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
