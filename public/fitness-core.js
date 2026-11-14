/*
 * Pure fitness calculations: VO2 max estimates, training load, fitness/fatigue/form
 * and readiness. Shared by the dashboard and regression tests.
 *
 * Inputs are normalized activities (distance in meters, times in seconds).
 * Every estimate here is a model, not a lab measurement; callers present it that way.
 */
(function (root) {
  const DAY = 86400000;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const finite = (value) => Number.isFinite(value) ? value : null;

  /* ---------- Oxygen cost & VDOT (Daniels & Gilbert) ---------- */

  // Oxygen cost (ml/kg/min) of running at v meters per minute on the flat.
  function oxygenCost(metersPerMinute) {
    const v = metersPerMinute;
    return -4.6 + 0.182258 * v + 0.000104 * v * v;
  }
  // Fraction of VO2 max that can be sustained for a race lasting t minutes.
  function sustainableFraction(minutes) {
    return 0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);
  }
  // VDOT for a maximal effort of distance (m) in seconds.
  function vdotFromPerformance(meters, seconds) {
    if (!(meters > 0 && seconds > 0)) return null;
    const minutes = seconds / 60;
    return oxygenCost(meters / minutes) / sustainableFraction(minutes);
  }
  // Running speed (m/min) whose oxygen cost equals vo2.
  function speedForOxygen(vo2) {
    const a = 0.000104, b = 0.182258, c = -4.6 - vo2;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  }
  // Predicted race time (seconds) for a runner with this VDOT.
  function predictRaceSeconds(vdot, meters) {
    if (!(vdot > 0 && meters > 0)) return null;
    let low = meters / 1000 * 120, high = meters / 1000 * 900; // 2:00/km .. 15:00/km
    for (let i = 0; i < 60; i += 1) {
      const middle = (low + high) / 2;
      if (vdotFromPerformance(meters, middle) > vdot) low = middle; else high = middle;
    }
    return (low + high) / 2;
  }
  // Daniels-style training paces (seconds per meter ranges) from VDOT.
  function trainingPaces(vdot) {
    if (!(vdot > 0)) return null;
    const pace = (fraction) => 1 / (speedForOxygen(vdot * fraction) / 60); // s per meter
    const marathon = predictRaceSeconds(vdot, 42195) / 42195;
    return {
      easy: [pace(0.74), pace(0.62)],
      marathon: [marathon, marathon],
      threshold: [pace(0.88), pace(0.86)],
      interval: [pace(0.98), pace(0.975)],
      repetition: [pace(1.06), pace(1.04)]
    };
  }

  /* ---------- Heart rate profile ---------- */

  // Estimated max HR: the second-highest plausible recorded max HR, so a single
  // sensor spike does not set the ceiling.
  function estimateMaxHr(runs) {
    const peaks = runs.map((run) => Number(run.max_heartrate) || 0).filter((hr) => hr >= 120 && hr <= 225).sort((a, b) => b - a);
    if (!peaks.length) return null;
    return peaks[Math.min(1, peaks.length - 1)];
  }

  function heartRateReserve(avgHr, profile) {
    if (!profile || !(profile.maxHr > profile.restHr) || !(avgHr > 0)) return null;
    return (avgHr - profile.restHr) / (profile.maxHr - profile.restHr);
  }

  /* ---------- Per-run VO2 max estimate ---------- */

  // A submaximal estimate: the oxygen cost of the run's pace (with a partial
  // climbing correction) divided by the share of heart-rate reserve used.
  // %HRR approximates %VO2 reserve (Swain & Leutholtz).
  function runVo2Estimate(run, profile) {
    const meters = Number(run.distance) || 0;
    const seconds = Number(run.moving_time) || 0;
    if (meters < 3000 || seconds < 20 * 60) return null;
    const sport = String(run.sport_type || "").toLowerCase();
    if (sport.includes("trail")) return null;
    const hrr = heartRateReserve(Number(run.average_heartrate), profile);
    if (hrr === null || hrr < 0.5 || hrr > 0.97) return null;
    const speed = meters / (seconds / 60);
    if (speed < 120 || speed > 450) return null;
    // Loops climb and descend; count half the gain as net uphill work.
    const grade = clamp((Number(run.total_elevation_gain) || 0) / meters * 0.5, 0, 0.08);
    const vo2 = oxygenCost(speed) + 0.9 * speed * grade;
    const estimate = (vo2 - 3.5) / hrr + 3.5;
    return estimate >= 25 && estimate <= 85 ? estimate : null;
  }

  // Best recent performance-based VDOT from a run (best when it was a hard effort).
  function runVdot(run) {
    const meters = Number(run.distance) || 0;
    const seconds = Number(run.moving_time) || 0;
    if (meters < 1500 || seconds < 6 * 60) return null;
    const value = vdotFromPerformance(meters, seconds);
    return value >= 20 && value <= 85 ? value : null;
  }

  function percentile(values, p) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index), upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  /*
   * Rolling VO2 max series. For each day, the estimate is the 75th percentile of
   * per-run estimates over the trailing 42 days; heat, drift and hills only push
   * single runs down, so the upper part of the distribution is the better signal.
   */
  function vo2Series(runs, profile, parseDate, { windowDays = 42, minSamples = 3 } = {}) {
    const samples = runs.map((run) => ({ run, date: parseDate(run), hr: runVo2Estimate(run, profile), vdot: runVdot(run) }))
      .filter((sample) => !Number.isNaN(sample.date.valueOf()))
      .sort((a, b) => a.date - b.date);
    const points = [];
    samples.forEach((sample, index) => {
      const from = sample.date - windowDays * DAY;
      const window = samples.slice(0, index + 1).filter((other) => other.date >= from);
      const hrValues = window.map((other) => other.hr).filter((value) => value !== null);
      const vdotValues = window.map((other) => other.vdot).filter((value) => value !== null);
      points.push({
        date: sample.date,
        runId: sample.run.id,
        sample: sample.hr,
        vo2max: hrValues.length >= minSamples ? percentile(hrValues, 0.75) : null,
        // Best effort in the window: the closest thing to a maximal performance.
        vdot: vdotValues.length ? Math.max(...vdotValues) : null,
        samples: hrValues.length
      });
    });
    return points;
  }

  /* ---------- Training load ---------- */

  const THRESHOLD_HRR = 0.88;
  const trimpPerMinute = (hrr) => hrr * 0.64 * Math.exp(1.92 * hrr);
  const TRIMP_HOUR_AT_THRESHOLD = 60 * trimpPerMinute(THRESHOLD_HRR);

  /*
   * Load points: one hour at lactate threshold = 100, whichever model is used.
   * Heart-rate runs use Banister TRIMP; runs without HR use pace relative to
   * threshold pace (rTSS); with neither, duration at an easy intensity.
   */
  function runLoad(run, profile, thresholdSpeed) {
    const seconds = Number(run.moving_time) || 0;
    if (!seconds) return { load: 0, source: "none" };
    const minutes = seconds / 60;
    const hrr = heartRateReserve(Number(run.average_heartrate), profile);
    if (hrr !== null && hrr > 0 && hrr < 1.05) {
      return { load: minutes * trimpPerMinute(clamp(hrr, 0, 1)) / TRIMP_HOUR_AT_THRESHOLD * 100, source: "heart rate" };
    }
    const meters = Number(run.distance) || 0;
    if (thresholdSpeed > 0 && meters > 0) {
      const intensity = clamp(meters / minutes / thresholdSpeed, 0.4, 1.2);
      return { load: minutes / 60 * intensity * intensity * 100, source: "pace" };
    }
    return { load: minutes / 60 * 0.75 * 0.75 * 100, source: "duration" };
  }

  const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const startOfDay = (value) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; };

  function dailyLoads(runs, profile, thresholdSpeed, parseDate) {
    const map = new Map();
    runs.forEach((run) => {
      const date = parseDate(run);
      if (Number.isNaN(date.valueOf())) return;
      const key = dayKey(date);
      map.set(key, (map.get(key) || 0) + runLoad(run, profile, thresholdSpeed).load);
    });
    return map;
  }

  /*
   * Fitness (chronic training load, 42-day), fatigue (acute, 7-day) and form.
   * Form for a day is yesterday's fitness minus yesterday's fatigue: how fresh
   * you are walking into that day.
   */
  function loadSeries(loads, start, end) {
    const series = [];
    if (!start || !end || end < start) return series;
    const fitnessDecay = 1 - Math.exp(-1 / 42);
    const fatigueDecay = 1 - Math.exp(-1 / 7);
    let fitness = 0, fatigue = 0;
    for (let date = startOfDay(start); date <= end; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
      const load = loads.get(dayKey(date)) || 0;
      const form = fitness - fatigue;
      fitness += (load - fitness) * fitnessDecay;
      fatigue += (load - fatigue) * fatigueDecay;
      series.push({ date: new Date(date), load, fitness, fatigue, form });
    }
    return series;
  }

  // Acute:chronic workload ratio (7-day vs 28-day average) and Foster monotony.
  function workloadRatios(loads, today) {
    const day = startOfDay(today);
    const values = (count) => Array.from({ length: count }, (_, index) => {
      const date = new Date(day.getFullYear(), day.getMonth(), day.getDate() - index);
      return loads.get(dayKey(date)) || 0;
    });
    const week = values(7), month = values(28);
    const acute = week.reduce((sum, value) => sum + value, 0);
    const chronicWeekly = month.reduce((sum, value) => sum + value, 0) / 4;
    const mean = acute / 7;
    const deviation = Math.sqrt(week.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 7);
    return {
      acute,
      chronicWeekly,
      acwr: chronicWeekly > 0 ? acute / chronicWeekly : null,
      monotony: deviation > 0 ? mean / deviation : null,
      strain: deviation > 0 ? acute * mean / deviation : null
    };
  }

  /* ---------- Readiness ---------- */

  function formZone(form, fitness) {
    const ratio = form / Math.max(fitness, 10);
    if (ratio > 0.25) return { key: "fresh", label: "Very fresh", detail: "Fitness may be fading if this lasts" };
    if (ratio > 0.05) return { key: "ready", label: "Fresh", detail: "Absorbed recent training" };
    if (ratio > -0.1) return { key: "neutral", label: "Balanced", detail: "Fatigue and fitness in step" };
    if (ratio > -0.3) return { key: "productive", label: "Productive fatigue", detail: "Building, recovery needed soon" };
    return { key: "overreaching", label: "Overreaching", detail: "Fatigue well above fitness" };
  }

  /*
   * Readiness to train, 0-100. Four transparent factors, each scored 0-100 and
   * weighted. Missing factors are dropped and the weights renormalized.
   */
  function readiness({ form, fitness, acwr, hoursSinceHard, checkin, monotony }) {
    const factors = [];
    if (Number.isFinite(form) && Number.isFinite(fitness)) {
      const ratio = form / Math.max(fitness, 10);
      factors.push({ key: "form", label: "Form", weight: 0.4, score: clamp(70 + ratio * 150, 0, 100),
        detail: formZone(form, fitness).label });
    }
    if (Number.isFinite(acwr)) {
      const score = acwr < 0.8 ? 85 : acwr <= 1.3 ? 100 : acwr <= 1.5 ? 100 - (acwr - 1.3) / 0.2 * 50 : clamp(50 - (acwr - 1.5) / 0.5 * 50, 0, 50);
      factors.push({ key: "acwr", label: "Load ramp", weight: 0.25, score,
        detail: acwr < 0.8 ? "Lighter than usual" : acwr <= 1.3 ? "In the steady range" : acwr <= 1.5 ? "Climbing quickly" : "Spiking above your base" });
    }
    if (Number.isFinite(hoursSinceHard)) {
      const score = hoursSinceHard < 24 ? 35 : hoursSinceHard < 48 ? 70 : 100;
      factors.push({ key: "recovery", label: "Since last hard run", weight: 0.2, score,
        detail: hoursSinceHard < 24 ? "Less than a day" : hoursSinceHard < 48 ? "1–2 days" : `${Math.floor(hoursSinceHard / 24)} days` });
    }
    if (checkin && Number(checkin.feel)) {
      let score = { 1: 20, 2: 40, 3: 65, 4: 85, 5: 100 }[Number(checkin.feel)] || 65;
      if (["sleep", "soreness", "stress"].includes(checkin.limiter)) score -= 10;
      factors.push({ key: "checkin", label: "Your check-in", weight: 0.15, score: clamp(score, 0, 100),
        detail: `Felt ${["", "very hard", "hard", "manageable", "good", "strong"][Number(checkin.feel)]}${checkin.limiter && checkin.limiter !== "none" ? ` · ${checkin.limiter}` : ""}` });
    }
    if (Number.isFinite(monotony) && monotony > 2) {
      factors.push({ key: "monotony", label: "Variety", weight: 0.1, score: clamp(100 - (monotony - 2) * 60, 0, 100),
        detail: "Every day has looked the same lately" });
    }
    if (!factors.length) return null;
    const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
    const score = Math.round(factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / totalWeight);
    const band = score >= 75 ? { key: "primed", label: "Primed", advice: "A good day for quality: intervals, tempo, or a race-pace long run." }
      : score >= 55 ? { key: "ready", label: "Ready", advice: "Train as planned. Keep easy days genuinely easy." }
        : score >= 35 ? { key: "steady", label: "Hold steady", advice: "Keep today easy or short. Save the hard session for later this week." }
          : { key: "recover", label: "Recover", advice: "Rest, or a very easy 20–30 minutes. Fatigue is well above your base." };
    return { score, ...band, factors };
  }

  /* ---------- Run type ---------- */

  const RUN_TYPES = {
    race: { key: "race", label: "Race", group: "quality" },
    quality: { key: "quality", label: "Quality", group: "quality" },
    long: { key: "long", label: "Long", group: "long" },
    easy: { key: "easy", label: "Easy", group: "easy" },
    recovery: { key: "recovery", label: "Recovery", group: "easy" }
  };

  /*
   * Classify a run from what was recorded, not from its name.
   * context: { profile, thresholdSpeed (m/min), typicalMeters (median run distance) }.
   * Order matters: a source-tagged race wins, then long, then intensity.
   */
  function classifyRunType(run, context = {}) {
    const meters = Number(run.distance) || 0;
    const seconds = Number(run.moving_time) || 0;
    const workout = Number(run.workout_type);
    if (workout === 1) return RUN_TYPES.race;
    const typical = context.typicalMeters || 0;
    if (workout === 2 || (typical && meters >= Math.max(typical * 1.5, 14000)) || meters >= 25000) return RUN_TYPES.long;
    const hrr = heartRateReserve(Number(run.average_heartrate), context.profile);
    const speedRatio = context.thresholdSpeed > 0 && meters && seconds ? meters / (seconds / 60) / context.thresholdSpeed : null;
    // Prefer heart rate; fall back to pace relative to threshold.
    const hard = hrr !== null ? hrr >= 0.8 : speedRatio !== null && speedRatio >= 0.92;
    if (workout === 3 || hard) return RUN_TYPES.quality;
    const gentle = hrr !== null ? hrr < 0.62 : speedRatio !== null && speedRatio < 0.72;
    if (gentle && (!typical || meters <= typical)) return RUN_TYPES.recovery;
    return RUN_TYPES.easy;
  }

  const api = {
    oxygenCost, sustainableFraction, vdotFromPerformance, speedForOxygen, predictRaceSeconds, trainingPaces,
    estimateMaxHr, heartRateReserve, runVo2Estimate, runVdot, percentile, vo2Series,
    runLoad, dailyLoads, loadSeries, workloadRatios, formZone, readiness, dayKey, finite,
    RUN_TYPES, classifyRunType
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FitnessCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
