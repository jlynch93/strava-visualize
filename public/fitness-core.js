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
  /* ---------- Training cycle ---------- */

  const RACE_KM = { "5K": 5, "10K": 10, "Half marathon": 21.1, "Marathon": 42.2 };
  const raceKm = (race) => RACE_KM[race.distance] || Number(race.km) || 10;
  // Easy days after a race: roughly a day per 3 km, less for tune-up races.
  const recoveryDays = (race) => Math.max(2, Math.round(raceKm(race) / 3 * (race.priority === "A" ? 1 : race.priority === "B" ? 0.7 : 0.5)));
  // Days of reduced load before a race: two weeks for a marathon A race,
  // a few days for a tune-up.
  const taperDays = (race) => race.priority === "A" ? (raceKm(race) >= 40 ? 14 : raceKm(race) >= 20 ? 10 : 7) : race.priority === "B" ? 4 : 2;
  const dayIndex = (value) => {
    const date = new Date(value instanceof Date ? value : `${value}T00:00:00`);
    return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf() / DAY);
  };

  /*
   * Where today sits in the training cycle. Races: [{ name, date (YYYY-MM-DD),
   * distance, priority A|B|C }]. The next A race sets the phase (base, build,
   * peak, taper, race week); a B race gets a short taper of its own; any race
   * is followed by recovery that takes precedence. Null without races.
   */
  function trainingPhase(races, today = new Date()) {
    const now = dayIndex(today);
    const list = (Array.isArray(races) ? races : [])
      .filter((race) => race && /^\d{4}-\d{2}-\d{2}$/.test(race.date))
      .map((race) => ({ ...race, priority: ["A", "B", "C"].includes(race.priority) ? race.priority : "A", day: dayIndex(race.date) }))
      .sort((a, b) => a.day - b.day);
    if (!list.length) return null;
    const label = (race) => race.name || race.distance || "Race";
    const recent = list.filter((race) => race.day < now && now - race.day <= recoveryDays(race)).at(-1);
    if (recent) {
      const total = recoveryDays(recent), since = now - recent.day;
      return { key: "recovery", label: "Recovery", race: recent, daysSince: since, daysLeft: total - since, total,
        detail: `${since} day${since === 1 ? "" : "s"} after ${label(recent)} · easy for ${total - since} more` };
    }
    const nextA = list.find((race) => race.priority === "A" && race.day >= now);
    const nextAny = list.find((race) => race.day >= now);
    if (nextAny && nextAny.day === now) return { key: "race-day", label: "Race day", race: nextAny, daysTo: 0, detail: `${label(nextAny)} today` };
    if (nextA) {
      const daysTo = nextA.day - now, weeks = Math.ceil(daysTo / 7);
      const away = `${label(nextA)} in ${daysTo <= 14 ? `${daysTo} days` : `${weeks} weeks`}`;
      if (daysTo <= 7) return { key: "race-week", label: "Race week", race: nextA, daysTo, detail: away };
      if (daysTo <= taperDays(nextA)) return { key: "taper", label: "Taper", race: nextA, daysTo, detail: away };
    }
    // A tune-up race inside its own short taper.
    const tuneUp = list.find((race) => race.priority !== "A" && race.day > now && race.day - now <= taperDays(race));
    if (tuneUp) {
      const daysTo = tuneUp.day - now;
      return { key: "tune-up", label: `${tuneUp.priority} race`, race: tuneUp, daysTo, detail: `${label(tuneUp)} in ${daysTo} day${daysTo === 1 ? "" : "s"}` };
    }
    if (!nextA) return null;
    const daysTo = nextA.day - now, weeks = Math.ceil(daysTo / 7);
    const detail = `${label(nextA)} in ${weeks} weeks`;
    if (weeks <= 5) return { key: "peak", label: "Peak", race: nextA, daysTo, detail };
    if (weeks <= 12) return { key: "build", label: "Build", race: nextA, daysTo, detail };
    return { key: "base", label: "Base", race: nextA, daysTo, detail };
  }

  // The form (fitness minus fatigue, relative to fitness) each phase aims for.
  // Building means carrying some fatigue; tapering means shedding it.
  const PHASE_FORM_TARGET = {
    base: [-0.2, 0.1], build: [-0.25, 0.05], peak: [-0.15, 0.05],
    "tune-up": [-0.05, 0.2], taper: [0, 0.25], "race-week": [0.05, 0.3], "race-day": [0.05, 0.35], recovery: [-0.3, 0.3]
  };

  function formScore(ratio, phase) {
    const target = phase && PHASE_FORM_TARGET[phase.key];
    if (!target) return clamp(70 + ratio * 150, 0, 100); // No race: the general scale.
    const [low, high] = target;
    // Being tired close to a race costs more than being tired mid-build.
    const steep = ["taper", "race-week", "race-day", "tune-up"].includes(phase.key) ? 260 : 170;
    if (ratio < low) return clamp(95 - (low - ratio) * steep, 0, 95);
    if (ratio > high) return clamp(95 - (ratio - high) * 90, 40, 95);
    return 95;
  }

  // How the phase itself bears on a hard session today (shown as a factor).
  function phaseFactor(phase) {
    if (!phase) return null;
    let score = 85;
    if (phase.key === "recovery") score = clamp(25 + 70 * (phase.daysSince / phase.total), 25, 95);
    else if (phase.key === "race-day") score = 100;
    else if (phase.key === "race-week" || phase.key === "taper") score = 90;
    else if (phase.key === "tune-up") score = 75;
    return { key: "cycle", label: "Training cycle", weight: 0.2, score, detail: `${phase.label} · ${phase.detail}` };
  }

  const PHASE_ADVICE = {
    base: { primed: "Base phase: a good day for a longer aerobic run or a steady effort.", ready: "Base phase: keep building easy volume; one steady run this week is plenty." },
    build: { primed: "Build phase: a good day for a key session.", ready: "Build phase: some fatigue is expected. Train as planned and protect your easy days.", steady: "Build phase, but carrying a lot of fatigue: make today easy and move the key session." },
    peak: { primed: "Peak block: a good day for your race-specific session.", ready: "Peak block: train as planned; the long run and race-pace work matter most now.", steady: "Peak block and tired: keep the long run, drop extra intensity this week." },
    taper: { primed: "Taper: keep a little intensity (short race-pace reps) and cut the volume.", ready: "Taper: shorter runs with a few strides. Fitness is banked; let fatigue fall.", steady: "Taper is still clearing fatigue: easy and short until it lifts.", recover: "Taper with high fatigue: rest more. Nothing done now adds fitness for race day." },
    "race-week": { primed: "Race week: short runs, a few strides, sleep. You're ready.", ready: "Race week: keep runs short and easy; add a few strides two days out.", steady: "Race week and still tired: cut the remaining runs to easy 20–30 minutes.", recover: "Race week with high fatigue: rest. Arriving fresh matters more than any run now." },
    "race-day": { primed: "Race day. Warm up well and trust the training.", ready: "Race day. Start controlled; let the second half decide it.", steady: "Race day. Start conservatively and run by feel.", recover: "Race day. Start conservatively and run by feel." },
    "tune-up": { primed: "Tune-up race ahead: keep the next days light and skip hard sessions.", ready: "Tune-up race ahead: easy runs until then.", steady: "Tune-up race ahead and tired: rest or very easy until race day." },
    recovery: { primed: "Recovering from your race: easy running only, even though you feel good.", ready: "Recovering from your race: easy running only until recovery ends.", steady: "Recovering from your race: easy and short, or rest.", recover: "Recovering from your race: rest. Hard training now delays the rebound." }
  };

  function readiness({ form, fitness, acwr, hoursSinceHard, checkin, monotony, phase = null }) {
    const factors = [];
    if (Number.isFinite(form) && Number.isFinite(fitness)) {
      const ratio = form / Math.max(fitness, 10);
      const zone = formZone(form, fitness);
      const expected = phase && PHASE_FORM_TARGET[phase.key] && ratio >= PHASE_FORM_TARGET[phase.key][0] && ratio <= PHASE_FORM_TARGET[phase.key][1];
      factors.push({ key: "form", label: "Form", weight: 0.4, score: formScore(ratio, phase),
        detail: expected && phase.key !== "recovery" ? `${zone.label} · on target for ${phase.label.toLowerCase()}` : zone.label });
    }
    const cycle = phaseFactor(phase);
    if (cycle) factors.push(cycle);
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
    let finalScore = score;
    // Early post-race recovery is never a day for quality, however fresh it feels.
    if (phase?.key === "recovery" && phase.daysSince < phase.total * 0.6) finalScore = Math.min(score, 54);
    const band = finalScore >= 75 ? { key: "primed", label: "Primed", advice: "A good day for quality: intervals, tempo, or a race-pace long run." }
      : finalScore >= 55 ? { key: "ready", label: "Ready", advice: "Train as planned. Keep easy days genuinely easy." }
        : finalScore >= 35 ? { key: "steady", label: "Hold steady", advice: "Keep today easy or short. Save the hard session for later this week." }
          : { key: "recover", label: "Recover", advice: "Rest, or a very easy 20–30 minutes. Fatigue is well above your base." };
    const phaseAdvice = phase && PHASE_ADVICE[phase.key];
    const advice = phaseAdvice ? phaseAdvice[band.key] || phaseAdvice.steady || band.advice : band.advice;
    return { score: finalScore, ...band, advice, factors, phase };
  }

  /* ---------- Personal records ---------- */

  // Pace records by run length, so one long run cannot hold all three.
  const RECORD_DISTANCES = [
    { key: "fastest-5k", meters: 5000, below: 10000, label: "Fastest 5–10K run" },
    { key: "fastest-10k", meters: 10000, below: 21097.5, label: "Fastest 10K–half run" },
    { key: "fastest-half", meters: 21097.5, below: Infinity, label: "Fastest half+ run" }
  ];

  // Monday of the week a date falls in, as a local-day key.
  function weekKey(date) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
    return dayKey(monday);
  }

  // Records across a run history: each is { key, label, value, unit, run?,
  // date, previous, isNew }. "Fastest" records compare average pace over runs
  // at least that long (a whole-run figure, not a split). A record is new when
  // set in the last `freshDays` and it beat an earlier one. Runs within 2% of a
  // boundary count toward the longer bucket (a GPS 5K often reads 4.95 km).
  function personalRecords(runs, dateOf, { today = new Date(), freshDays = 14 } = {}) {
    const dated = runs.map((run) => ({ run, date: dateOf(run) })).filter(({ date }) => !Number.isNaN(date.valueOf())).sort((a, b) => a.date - b.date);
    if (!dated.length) return [];
    const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - freshDays);
    const track = (key, label, unit, entries, better) => {
      let best = null, previous = null;
      for (const entry of entries) {
        if (!Number.isFinite(entry.value) || entry.value <= 0) continue;
        if (!best || better(entry.value, best.value)) { previous = best; best = entry; }
      }
      if (!best) return null;
      return { key, label, unit, value: best.value, run: best.run || null, date: best.date, previous: previous ? { value: previous.value, date: previous.date } : null, isNew: Boolean(previous) && best.date >= cutoff, start: best.start || null };
    };
    const records = [];
    records.push(track("longest", "Longest run", "meters", dated.map(({ run, date }) => ({ run, date, value: run.distance })), (a, b) => a > b));
    for (const { key, meters, below, label } of RECORD_DISTANCES) {
      records.push(track(key, label, "pace", dated.filter(({ run }) => run.distance >= meters * 0.98 && run.distance < below * 0.98 && run.moving_time > 0)
        .map(({ run, date }) => ({ run, date, value: run.moving_time / run.distance })), (a, b) => a < b));
    }
    records.push(track("climb", "Most climbing", "meters", dated.map(({ run, date }) => ({ run, date, value: run.total_elevation_gain })), (a, b) => a > b));
    // Biggest week: Monday-to-Sunday distance, dated by its Monday.
    const weeks = new Map();
    for (const { run, date } of dated) {
      const key = weekKey(date);
      const week = weeks.get(key) || { value: 0, date: new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)), last: date };
      week.value += run.distance; week.last = date;
      weeks.set(key, week);
    }
    records.push(track("biggest-week", "Biggest week", "meters", [...weeks.values()].map((week) => ({ value: week.value, date: week.last, start: week.date })), (a, b) => a > b));
    // Longest streak of consecutive days with a run.
    const days = [...new Set(dated.map(({ date }) => dayKey(date)))].sort();
    let run = 1, start = new Date(`${days[0]}T12:00:00`);
    const streaks = [];
    for (let index = 1; index <= days.length; index += 1) {
      const gap = index < days.length ? (new Date(`${days[index]}T12:00:00`) - new Date(`${days[index - 1]}T12:00:00`)) / 86400000 : 0;
      if (index < days.length && Math.round(gap) === 1) { run += 1; continue; }
      streaks.push({ value: run, date: new Date(`${days[index - 1]}T12:00:00`), start });
      run = 1; start = new Date(`${days[index]}T12:00:00`);
    }
    records.push(track("streak", "Longest streak", "days", streaks.filter((item) => item.value > 1), (a, b) => a > b));
    return records.filter(Boolean);
  }

  /* ---------- Aerobic efficiency ---------- */

  // Metres covered per heartbeat, with climbing counted as extra distance
  // (1 m of climb ~ 6 m on the flat). Higher is fitter at the same effort.
  function metersPerBeat(run) {
    if (!(run.average_heartrate > 60) || !(run.moving_time >= 20 * 60) || !(run.distance > 0)) return null;
    const effective = run.distance + 6 * (run.total_elevation_gain || 0);
    return effective / (run.moving_time / 60 * run.average_heartrate);
  }

  // Weekly medians of metres per beat, plus the change over the last eight
  // weeks against the eight before. Quality sessions and races are left out,
  // so the trend compares like with like.
  function efficiencyTrend(runs, dateOf, { types = null, today = new Date() } = {}) {
    const weeks = new Map();
    for (const run of runs) {
      if (types && ["quality", "race"].includes(types.get(String(run.id))?.key)) continue;
      const value = metersPerBeat(run);
      const date = dateOf(run);
      if (value === null || Number.isNaN(date.valueOf())) continue;
      const key = weekKey(date);
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(value);
    }
    const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
    const series = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => ({ week: new Date(`${key}T12:00:00`), value: median(values), runs: values.length }));
    const ago = (days) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
    const recent = series.filter((point) => point.week >= ago(56)).flatMap((point) => Array(point.runs).fill(point.value));
    const before = series.filter((point) => point.week < ago(56) && point.week >= ago(112)).flatMap((point) => Array(point.runs).fill(point.value));
    const change = recent.length >= 3 && before.length >= 3 ? median(recent) / median(before) - 1 : null;
    return { series, current: recent.length ? median(recent) : null, change };
  }

  /* ---------- Race-day pacing ---------- */

  // Splits for a goal time over a distance, every `splitMeters` (a mile or a
  // kilometre), even or with a negative split: the second half `negative`
  // (fraction) faster than the first, the same finish time either way.
  function pacingPlan(meters, goalSeconds, { splitMeters = 1609.344, negative = 0 } = {}) {
    if (!(meters > 0) || !(goalSeconds > 0) || !(splitMeters > 0)) return [];
    const half = meters / 2;
    // First-half pace p1 and second-half pace p2 = p1 * (1 - negative), with half*p1 + half*p2 = goal.
    const firstPace = goalSeconds / (half * (2 - negative));
    const secondPace = firstPace * (1 - negative);
    const timeAt = (distance) => distance <= half ? distance * firstPace : half * firstPace + (distance - half) * secondPace;
    const splits = [];
    for (let at = splitMeters, index = 1; at - splitMeters < meters - 0.5; at += splitMeters, index += 1) {
      const distance = Math.min(at, meters);
      const from = distance === meters ? Math.min(at - splitMeters, meters) : at - splitMeters;
      splits.push({ index, distance, partial: distance - from < splitMeters - 0.5, splitSeconds: timeAt(distance) - timeAt(from), elapsed: timeAt(distance) });
    }
    return splits;
  }

  /* ---------- Yearly goal ---------- */

  // Where a calendar year's distance is heading at the pace so far, and what
  // the rest of the year needs to reach a goal (all distances in metres).
  function yearProjection({ soFar, today = new Date(), goal = 0 }) {
    const year = today.getFullYear();
    const start = new Date(year, 0, 1), end = new Date(year + 1, 0, 1);
    const totalDays = Math.round((end - start) / 86400000);
    const elapsedDays = Math.min(totalDays, Math.max(1, Math.round((new Date(year, today.getMonth(), today.getDate()) - start) / 86400000) + 1));
    const remainingDays = totalDays - elapsedDays;
    const projected = soFar / elapsedDays * totalDays;
    const result = { year, totalDays, elapsedDays, remainingDays, soFar, projected };
    if (!(goal > 0)) return result;
    const expectedByNow = goal * elapsedDays / totalDays;
    const left = Math.max(0, goal - soFar);
    return { ...result, goal, expectedByNow, ahead: soFar - expectedByNow, left, neededPerWeek: remainingDays ? left / remainingDays * 7 : 0, onTrack: projected >= goal, done: soFar >= goal };
  }

  /* ---------- Intensity balance ---------- */

  // Share of running time that was hard (quality sessions and races) over the
  // last `days`. Most plans keep it near 20%.
  function intensityBalance(runs, types, dateOf, { today = new Date(), days = 28 } = {}) {
    const since = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1);
    let easy = 0, hard = 0, count = 0;
    for (const run of runs) {
      const date = dateOf(run);
      if (Number.isNaN(date.valueOf()) || date < since || date > today) continue;
      const group = types.get(String(run.id))?.group || "easy";
      const seconds = Number(run.moving_time) || 0;
      if (group === "quality") hard += seconds; else easy += seconds;
      count += 1;
    }
    const total = easy + hard;
    if (count < 4 || !total) return null;
    const hardShare = hard / total;
    const key = hardShare > 0.3 ? "too-hard" : hardShare > 0.22 ? "hard-side" : hardShare >= 0.08 ? "balanced" : "all-easy";
    return { easySeconds: easy, hardSeconds: hard, hardShare, runs: count, key };
  }

  /* ---------- Shoes ---------- */

  // Distance on each shoe: a run goes to the shoe with the latest start date on
  // or before it that was not yet retired. Shoes are { id, name, start, retired?, limit }.
  function shoeMileage(runs, shoes, dateOf) {
    const ordered = [...shoes].filter((shoe) => /^\d{4}-\d{2}-\d{2}$/.test(shoe.start)).sort((a, b) => b.start.localeCompare(a.start));
    const totals = new Map(shoes.map((shoe) => [shoe.id, { meters: 0, runs: 0, last: null }]));
    for (const run of runs) {
      const date = dateOf(run);
      if (Number.isNaN(date.valueOf())) continue;
      const key = dayKey(date);
      const shoe = ordered.find((item) => item.start <= key && (!item.retired || item.retired > key));
      if (!shoe) continue;
      const total = totals.get(shoe.id);
      total.meters += Number(run.distance) || 0; total.runs += 1;
      if (!total.last || date > total.last) total.last = date;
    }
    return shoes.map((shoe) => {
      const total = totals.get(shoe.id);
      const share = shoe.limit ? total.meters / shoe.limit : 0;
      return { ...shoe, ...total, share, status: shoe.retired ? "retired" : share >= 1 ? "worn" : share >= 0.85 ? "nearly" : "fine" };
    });
  }

  /* ---------- Finishing place ---------- */

  // Five-year age groups, as most races award them.
  function ageGroup(age) {
    if (!Number.isFinite(age) || age < 1) return null;
    if (age < 15) return { from: 1, to: 14, label: "14 & under" };
    if (age >= 80) return { from: 80, to: 200, label: "80+" };
    const from = Math.floor(age / 5) * 5;
    return { from, to: from + 4, label: `${from}–${from + 4}` };
  }

  // Where a finish time would have placed in a past field of
  // [seconds, "M" | "F" | "X", age | null] rows: overall, among the same
  // gender, and in the same gender's age group.
  function projectPlace(field, seconds, { gender = null, age = null } = {}) {
    if (!Array.isArray(field) || !field.length || !(seconds > 0)) return null;
    const placeIn = (rows) => {
      const ahead = rows.filter((row) => row[0] < seconds).length;
      const of = Math.max(rows.length, ahead + 1);
      return { place: ahead + 1, of, percent: Math.max(1, Math.round((ahead + 1) / of * 100)) };
    };
    const result = { overall: placeIn(field), gender: null, ageGroup: null };
    if (!gender) return result;
    const same = field.filter((row) => row[1] === gender);
    if (same.length) result.gender = placeIn(same);
    const group = ageGroup(age);
    if (group && same.length) {
      const peers = same.filter((row) => row[2] !== null && row[2] >= group.from && row[2] <= group.to);
      result.ageGroup = { ...placeIn(peers), label: group.label, empty: !peers.length };
    }
    return result;
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

  /* ---------- Walks ---------- */

  // Walks and hikes, from Strava (Walk, Hike) or Garmin (mapped to the same names).
  function isWalk(activity) {
    const sport = String(activity?.sport_type || activity?.type || "").toLowerCase();
    return sport.includes("walk") || sport.includes("hike");
  }

  const WALK_TYPES = {
    hike: { key: "hike", label: "Hike", group: "quality" },
    long: { key: "long-walk", label: "Long walk", group: "long" },
    walk: { key: "walk", label: "Walk", group: "easy" }
  };

  /*
   * Walk types share the run-type groups (easy / long / quality) so charts and
   * filters treat both activities the same way.
   * context: { typicalMeters } (median walk distance).
   */
  function classifyWalkType(walk, context = {}) {
    const meters = Number(walk.distance) || 0;
    const sport = String(walk.sport_type || walk.type || "").toLowerCase();
    const climbPerKm = meters ? (Number(walk.total_elevation_gain) || 0) / (meters / 1000) : 0;
    if (sport.includes("hike") || (meters >= 3000 && climbPerKm >= 40)) return WALK_TYPES.hike;
    const typical = context.typicalMeters || 0;
    if ((typical && meters >= Math.max(typical * 1.5, 7000)) || meters >= 12000) return WALK_TYPES.long;
    return WALK_TYPES.walk;
  }

  /* ---------- Race-day projection ---------- */

  // Share of the usual daily load assumed in each part of the run-in.
  const TAPER_LOAD = 0.65;
  const RACE_WEEK_LOAD = 0.45;

  /*
   * Runs fitness and fatigue forward from today to race day, assuming the
   * usual daily load until the taper, then TAPER_LOAD of it, then
   * RACE_WEEK_LOAD in the final week. Form for a day is the previous day's
   * fitness minus fatigue (as in loadSeries), so race-day form is how fresh
   * you arrive. start: { fitness, fatigue } at the end of today.
   */
  function projectRaceDay({ start, usualLoad, today = new Date(), race }) {
    if (!start || !race || !/^\d{4}-\d{2}-\d{2}$/.test(race.date)) return null;
    const raceDay = dayIndex(race.date), now = dayIndex(today);
    if (raceDay <= now) return null;
    const taper = taperDays({ ...race, priority: race.priority || "A" });
    const fitnessDecay = 1 - Math.exp(-1 / 42), fatigueDecay = 1 - Math.exp(-1 / 7);
    let fitness = start.fitness, fatigue = start.fatigue;
    const days = [];
    for (let day = now + 1; day <= raceDay; day += 1) {
      const daysTo = raceDay - day;
      const stage = daysTo === 0 ? "race" : daysTo <= 7 ? "race-week" : daysTo <= taper ? "taper" : "usual";
      const form = fitness - fatigue;
      // Race day itself is not trained; its effort lands after the start line.
      const load = stage === "race" ? 0 : (stage === "race-week" ? RACE_WEEK_LOAD : stage === "taper" ? TAPER_LOAD : 1) * Math.max(0, usualLoad || 0);
      fitness += (load - fitness) * fitnessDecay;
      fatigue += (load - fatigue) * fatigueDecay;
      // Step from today's local date: day numbers are only used for differences.
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (day - now));
      days.push({ date, stage, load, form, fitness, fatigue });
    }
    const last = days.at(-1);
    return { days, raceDay: { form: last.form, fitness: last.fitness, zone: formZone(last.form, last.fitness) }, taperDays: taper };
  }

  const api = {
    oxygenCost, sustainableFraction, vdotFromPerformance, speedForOxygen, predictRaceSeconds, trainingPaces,
    estimateMaxHr, heartRateReserve, runVo2Estimate, runVdot, percentile, vo2Series,
    runLoad, dailyLoads, loadSeries, workloadRatios, formZone, readiness, dayKey, finite,
    RUN_TYPES, classifyRunType, isWalk, WALK_TYPES, classifyWalkType,
    trainingPhase, recoveryDays, taperDays, projectRaceDay, TAPER_LOAD, RACE_WEEK_LOAD, ageGroup, projectPlace, personalRecords, metersPerBeat, efficiencyTrend, pacingPlan, weekKey, yearProjection, intensityBalance, shoeMileage
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FitnessCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
