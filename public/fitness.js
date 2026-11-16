/* Fitness view: readiness, VO2 max, fitness/fatigue/form, predictions and running metrics.
   Calculations live in fitness-core.js; this file only prepares and draws them. */
const ATHLETE_STORAGE_KEY = "run-trends-athlete-v1";
const DEFAULT_REST_HR = 55;
function sanitizeAthleteProfile(saved) {
  const clean = (value, low, high) => { const number = Number(value); return number >= low && number <= high ? Math.round(number) : null; };
  return { maxHr: clean(saved?.maxHr, 120, 225), restHr: clean(saved?.restHr, 30, 100) };
}
let athleteProfile = sanitizeAthleteProfile(readSaved(ATHLETE_STORAGE_KEY, {}));
let fitnessModelCache = { key: "", model: null };

const RACES = [
  { label: "5K", meters: 5000 },
  { label: "10K", meters: 10000 },
  { label: "Half marathon", meters: 21097.5 },
  { label: "Marathon", meters: 42195 }
];
const PACE_ZONES = [
  { key: "easy", label: "Easy", use: "Most of your running, recovery, long runs" },
  { key: "marathon", label: "Marathon", use: "Steady long-run segments" },
  { key: "threshold", label: "Threshold", use: "Tempo runs, cruise intervals" },
  { key: "interval", label: "Interval", use: "3–5 min reps at VO2 max" },
  { key: "repetition", label: "Repetition", use: "Short, fast reps with full recovery" }
];

function resolvedAthleteProfile(runs) {
  const estimatedMax = FitnessCore.estimateMaxHr(runs);
  const maxHr = athleteProfile.maxHr || estimatedMax;
  const restHr = athleteProfile.restHr || DEFAULT_REST_HR;
  return {
    maxHr, restHr,
    maxSource: athleteProfile.maxHr ? "saved" : estimatedMax ? "estimated from your runs" : "unknown",
    restSource: athleteProfile.restHr ? "saved" : "assumed",
    usable: Boolean(maxHr && maxHr > restHr + 40)
  };
}

function fitnessModel() {
  const dated = state.rawActivities.map(normalizeActivity)
    .filter((activity) => !Number.isNaN(parseActivityDate(activity).valueOf()))
    .sort((a, b) => parseActivityDate(a) - parseActivityDate(b));
  const runs = dated.filter(isRun);
  const walks = dated.filter(isWalk);
  const key = JSON.stringify([runs.length, walks.length, runs[0]?.id, runs.at(-1)?.id, runs.at(-1)?.moving_time, walks.at(-1)?.id, athleteProfile, activeCheckin(), coachingContext.races, new Date().toDateString()]);
  if (fitnessModelCache.key === key) return fitnessModelCache.model;
  const model = buildFitnessModel(runs, walks);
  fitnessModelCache = { key, model };
  return model;
}

/*
 * Runs and walks are separate in the views but share one body: walks add to
 * training load (fitness, fatigue, readiness) on the same scale as runs.
 * VO2 max, race predictions, paces and running metrics use runs only.
 */
function buildFitnessModel(runs, walks = []) {
  if (!runs.length && !walks.length) return null;
  const everything = [...runs, ...walks].sort((a, b) => parseActivityDate(a) - parseActivityDate(b));
  const profile = resolvedAthleteProfile(everything);
  const hrProfile = profile.usable ? profile : null;
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const vo2Points = FitnessCore.vo2Series(runs, hrProfile, parseActivityDate);
  const recentCutoff = new Date(today); recentCutoff.setDate(recentCutoff.getDate() - 42);
  const lastWith = (key, before = today) => [...vo2Points].reverse().find((point) => point[key] !== null && point.date <= before && point.date >= new Date(before - 42 * 86400000));
  const currentVo2 = lastWith("vo2max");
  const currentVdot = lastWith("vdot");
  const sixWeeksAgo = new Date(today); sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
  const priorVo2 = lastWith("vo2max", sixWeeksAgo);
  const priorVdot = lastWith("vdot", sixWeeksAgo);
  const vo2 = currentVo2 ? { value: currentVo2.vo2max, prior: priorVo2?.vo2max ?? null, source: "heart rate", samples: currentVo2.samples }
    : currentVdot ? { value: currentVdot.vdot, prior: priorVdot?.vdot ?? null, source: "performance", samples: 0 } : null;
  // Race predictions and paces follow your best recent performance when you have
  // raced hard; otherwise the heart-rate estimate (which assumes even effort).
  const fitnessVdot = currentVdot && currentVo2 ? Math.min(currentVo2.vo2max, Math.max(currentVdot.vdot, currentVo2.vo2max * 0.9)) : vo2?.value ?? null;
  const thresholdSpeed = fitnessVdot ? FitnessCore.speedForOxygen(fitnessVdot * 0.88) : 0;
  const loads = FitnessCore.dailyLoads(everything, hrProfile, thresholdSpeed, parseActivityDate);
  // Kept apart so every load figure can say how much came from runs and walks.
  const runDayLoads = FitnessCore.dailyLoads(runs, hrProfile, thresholdSpeed, parseActivityDate);
  const walkDayLoads = FitnessCore.dailyLoads(walks, hrProfile, thresholdSpeed, parseActivityDate);
  const typicalMeters = FitnessCore.percentile(runs.slice(-60).map((run) => Number(run.distance) || 0), 0.5) || 0;
  const typeContext = { profile: hrProfile, thresholdSpeed, typicalMeters };
  const walkContext = { typicalMeters: FitnessCore.percentile(walks.slice(-60).map((walk) => Number(walk.distance) || 0), 0.5) || 0 };
  const types = new Map([
    ...runs.map((run) => [String(run.id), FitnessCore.classifyRunType(run, typeContext)]),
    ...walks.map((walk) => [String(walk.id), FitnessCore.classifyWalkType(walk, walkContext)])
  ]);
  const firstDay = parseActivityDate(everything[0]);
  const loadSeries = FitnessCore.loadSeries(loads, firstDay, today);
  const latest = loadSeries.at(-1);
  const ratios = FitnessCore.workloadRatios(loads, today);
  const runLoads = runs.map((run) => ({ run, date: parseActivityDate(run), ...FitnessCore.runLoad(run, hrProfile, thresholdSpeed) }));
  const allLoads = everything.map((activity) => ({ run: activity, date: parseActivityDate(activity), ...FitnessCore.runLoad(activity, hrProfile, thresholdSpeed) }));
  // "Hard" is judged against a typical run; with no runs, against a typical walk.
  const recentLoads = (runs.length ? runLoads : allLoads).filter((item) => item.date >= recentCutoff).map((item) => item.load);
  const typicalLoad = FitnessCore.percentile(recentLoads, 0.5) || 0;
  const lastHard = [...allLoads].reverse().find((item) => item.date <= today && (item.load >= typicalLoad * 1.35 || [1, 3].includes(Number(item.run.workout_type))));
  const historyDays = Math.round((today - firstDay) / 86400000);
  const newestRun = parseActivityDate(everything.at(-1));
  const stale = (today - newestRun) / 86400000 > 10;
  // Where today sits in the race season changes what "ready" means.
  const phase = FitnessCore.trainingPhase(raceList());
  const readiness = stale ? null : FitnessCore.readiness({
    form: latest?.form, fitness: latest?.fitness, acwr: historyDays >= 28 ? ratios.acwr : null,
    hoursSinceHard: lastHard ? (Date.now() - lastHard.date) / 3600000 : historyDays >= 14 ? 24 * 14 : null,
    checkin: activeCheckin(), monotony: ratios.monotony, phase
  });
  const recentWalks = walks.filter((walk) => parseActivityDate(walk) >= recentCutoff).length;
  const loadSources = runLoads.filter((item) => item.date >= recentCutoff).reduce((counts, item) => ({ ...counts, [item.source]: (counts[item.source] || 0) + 1 }), {});
  return {
    runs, walks, runLoads, runDayLoads, walkDayLoads, recentWalks, profile, vo2Points, types, typeContext, walkContext, vo2, fitnessVdot, thresholdSpeed, loads, loadSeries, latest, ratios, readiness,
    lastHard, historyDays, stale, newestRun, loadSources, phase,
    hrCoverage: everything.filter((activity) => activity.average_heartrate).length / everything.length
  };
}

/* ---------- Rendering ---------- */

const READINESS_ICON = { primed: "▲", ready: "●", steady: "◆", recover: "▼" };

function readinessGauge(readiness) {
  const size = 200, radius = 80, cx = 100, cy = 100;
  const point = (fraction) => {
    const angle = Math.PI * (1 - fraction);
    return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)];
  };
  const [sx, sy] = point(0), [ex, ey] = point(1);
  const fraction = Math.max(0.001, Math.min(1, readiness.score / 100));
  const [fx, fy] = point(fraction);
  return `<svg class="readiness-gauge" viewBox="0 0 ${size} 118" role="img" aria-label="Readiness ${readiness.score} out of 100, ${escapeHtml(readiness.label)}">
    <path class="gauge-track" d="M${sx},${sy} A${radius},${radius} 0 0 1 ${ex},${ey}"/>
    <path class="gauge-fill status-${readiness.key}" d="M${sx},${sy} A${radius},${radius} 0 0 1 ${fx.toFixed(2)},${fy.toFixed(2)}"/>
    <text class="gauge-score" x="${cx}" y="${cy - 12}" text-anchor="middle">${readiness.score}</text>
    <text class="gauge-scale" x="${sx}" y="${cy + 16}" text-anchor="middle">0</text>
    <text class="gauge-scale" x="${ex}" y="${cy + 16}" text-anchor="middle">100</text>
  </svg>`;
}

function factorTone(score) { return score >= 70 ? "good" : score >= 45 ? "warning" : "critical"; }

function signed(value, digits = 1) {
  if (!Number.isFinite(value)) return "–";
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded).toFixed(digits)}`;
}

function renderReadinessHero(model) {
  const host = document.querySelector("#readinessHero");
  if (!model.readiness) {
    host.innerHTML = `<div class="readiness-empty"><h2>Readiness needs recent runs</h2><p>${model.stale ? `Your latest run was ${shortDate(model.newestRun)}. Sync or import recent activity to see today's readiness.` : "Add at least two weeks of running to estimate readiness."}</p></div>`;
    return;
  }
  const readiness = model.readiness;
  host.innerHTML = `
    <div class="readiness-score">
      <p class="eyebrow">Readiness to train · today</p>
      ${readinessGauge(readiness)}
      <p class="readiness-verdict status-text-${readiness.key}"><span aria-hidden="true">${READINESS_ICON[readiness.key]}</span> ${escapeHtml(readiness.label)}</p>
      ${model.phase ? `<p class="cycle-chip phase-${model.phase.key}">${escapeHtml(model.phase.label)} · ${escapeHtml(model.phase.detail)}</p>` : ""}
      <p class="readiness-advice">${escapeHtml(readiness.advice)}</p>
    </div>
    <div class="readiness-factors">
      <h3>What's driving it</h3>
      <ul>${readiness.factors.map((factor) => `<li>
        <div class="factor-head"><strong>${escapeHtml(factor.label)}</strong><span>${escapeHtml(factor.detail)}</span></div>
        <div class="factor-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(factor.score)}" aria-label="${escapeHtml(factor.label)} ${Math.round(factor.score)} of 100"><span class="tone-${factorTone(factor.score)}" style="width:${Math.max(2, factor.score)}%"></span></div>
        <em>${Math.round(factor.score)}</em>
      </li>`).join("")}</ul>
      ${activeCheckin().feel ? "" : '<p class="factor-note">Add a weekly check-in on the Plan tab so how you feel counts too.</p>'}
    </div>`;
}

function kpiTile(label, value, unit, detail, tone = "") {
  return `<div class="kpi-tile ${tone}"><span class="kpi-label">${label}</span><strong>${value}${unit ? `<small>${unit}</small>` : ""}</strong><span class="kpi-detail">${detail}</span></div>`;
}

function renderFitnessKpis(model) {
  const { vo2, latest, ratios } = model;
  const zone = latest ? FitnessCore.formZone(latest.form, latest.fitness) : null;
  const vo2Change = vo2 && vo2.prior ? vo2.value - vo2.prior : null;
  const acwr = model.historyDays >= 28 ? ratios.acwr : null;
  document.querySelector("#fitnessKpis").innerHTML = [
    kpiTile("VO2 max (est.)", vo2 ? vo2.value.toFixed(1) : "–", vo2 ? "ml/kg/min" : "",
      vo2 ? `${vo2Change !== null ? `${signed(vo2Change)} in 6 weeks · ` : ""}from ${vo2.source}` : "Needs runs with heart rate or a hard effort"),
    kpiTile("Fitness", latest ? Math.round(latest.fitness) : "–", "", "42-day training load"),
    kpiTile("Fatigue", latest ? Math.round(latest.fatigue) : "–", "", "7-day training load"),
    kpiTile("Form", latest ? signed(latest.form, 0) : "–", "", zone ? `${zone.label} · ${zone.detail}` : "", zone ? `form-${zone.key}` : ""),
    kpiTile("Load ramp", acwr ? acwr.toFixed(2) : "–", "", acwr ? `This week vs 4-week average · steady range 0.8–1.3` : "Needs 4 weeks of history", acwr && acwr > 1.5 ? "form-overreaching" : "")
  ].join("");
}

function windowDays(model) {
  const { start, end } = getRangeDates();
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const finish = end && end < today ? end : today;
  const begin = start || model.loadSeries[0]?.date || finish;
  const days = [];
  for (let date = new Date(begin.getFullYear(), begin.getMonth(), begin.getDate()); date <= finish; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) days.push(date);
  return days;
}

function renderVo2Chart(model, days) {
  const samples = new Map();
  let pointer = 0, current = null;
  const points = model.vo2Points;
  const values = [], vdot = [], dots = [];
  // Carry the latest estimate forward until it is 42 days old.
  let currentVdot = null;
  days.forEach((day) => {
    const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    while (pointer < points.length && points[pointer].date < endOfDay) {
      const point = points[pointer];
      if (point.vo2max !== null) current = point;
      if (point.vdot !== null) currentVdot = point;
      if (point.date >= day && point.sample !== null) samples.set(FitnessCore.dayKey(day), point.sample);
      pointer += 1;
    }
    const fresh = (point) => point && day - point.date < 42 * 86400000;
    values.push(fresh(current) ? current.vo2max : null);
    vdot.push(fresh(currentVdot) ? currentVdot.vdot : null);
    dots.push(samples.get(FitnessCore.dayKey(day)) ?? null);
  });
  const hasHr = values.some(Number.isFinite);
  const series = hasHr ? [
    { label: "Single-run estimates", className: "vo2-sample", values: dots, kind: "dots" },
    { label: "VO2 max estimate", short: "VO2 max", className: "vo2-line", values },
    { label: "Best-effort VDOT", short: "VDOT", className: "vdot-line", values: vdot }
  ] : [{ label: "Best-effort VDOT", short: "VDOT", className: "vdot-line", values: vdot }];
  document.querySelector("#vo2Legend").innerHTML = series.map((item) => `<span class="legend-item"><i class="key ${item.className}${item.kind === "dots" ? " key-dot" : ""}"></i>${item.label}</span>`).join("");
  timeChart(document.querySelector("#vo2Chart"), {
    dates: days, series, yFormat: (value) => value.toFixed(0), ariaLabel: "Estimated VO2 max over the selected window. Use arrow keys to move between days.",
    tooltip: (index) => ({ title: days[index].toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), rows: [
      hasHr ? { label: "VO2 max est.", value: Number.isFinite(values[index]) ? `${values[index].toFixed(1)} ml/kg/min` : "–" } : null,
      { label: "Best-effort VDOT", value: Number.isFinite(vdot[index]) ? vdot[index].toFixed(1) : "–" },
      Number.isFinite(dots[index]) ? { label: "This day's run", value: dots[index].toFixed(1) } : null
    ].filter(Boolean) })
  });
}

// The A race the run-in is projected to: the next one within six months.
function projectionRace() {
  const today = localDateValue(new Date());
  const horizon = new Date(); horizon.setDate(horizon.getDate() + 183);
  return raceList().find((race) => race.priority === "A" && race.date > today && race.date <= localDateValue(horizon)) || null;
}

// Average daily load over the last 28 days: the "usual" load the projection assumes.
function usualDailyLoad(model) {
  let total = 0;
  for (let offset = 0; offset < 28; offset += 1) {
    const date = new Date(); date.setDate(date.getDate() - offset);
    total += model.loads.get(FitnessCore.dayKey(date)) || 0;
  }
  return total / 28;
}

function renderLoadCharts(model, days) {
  const byDay = new Map(model.loadSeries.map((point) => [FitnessCore.dayKey(point.date), point]));
  const todayKey = FitnessCore.dayKey(new Date());
  const reachesToday = days.length && FitnessCore.dayKey(days.at(-1)) === todayKey;
  const race = reachesToday && model.latest ? projectionRace() : null;
  const usual = race ? usualDailyLoad(model) : 0;
  const projection = race ? FitnessCore.projectRaceDay({ start: { fitness: model.latest.fitness, fatigue: model.latest.fatigue }, usualLoad: usual, race }) : null;
  // Past days, then (when projecting) every day up to the race.
  const dates = projection ? [...days, ...projection.days.map((point) => point.date)] : days;
  const past = days.length;
  const points = days.map((day) => byDay.get(FitnessCore.dayKey(day)) || null);
  const ahead = projection ? projection.days : [];
  const fitness = [...points.map((point) => point ? point.fitness : null), ...ahead.map(() => null)];
  const fatigue = [...points.map((point) => point ? point.fatigue : null), ...ahead.map(() => null)];
  const form = [...points.map((point) => point ? point.form : null), ...ahead.map(() => null)];
  // Projected lines start at today's value so they continue the actual ones.
  const projected = (key) => projection ? [...points.map((point, index) => index === past - 1 && point ? point[key] : null), ...ahead.map((point) => point[key])] : [];
  const projectedForm = projection ? [...points.map(() => null), ...ahead.map((point) => point.form)] : [];
  const stageLabel = { usual: "Usual load", taper: `Taper (${Math.round(FitnessCore.TAPER_LOAD * 100)}% of usual)`, "race-week": `Race week (${Math.round(FitnessCore.RACE_WEEK_LOAD * 100)}% of usual)`, race: "Race day" };
  const fmtDay = (date) => date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const tooltip = (index) => {
    if (index >= past) {
      const point = ahead[index - past];
      const zone = FitnessCore.formZone(point.form, point.fitness);
      return { title: `${fmtDay(dates[index])} · projected`, rows: [
        { label: "Form", value: `${signed(point.form, 0)} · ${zone.label}` },
        { label: "Fitness", value: Math.round(point.fitness) },
        { label: "Fatigue", value: Math.round(point.fatigue) },
        { label: "Assumed load", value: `${point.load ? Math.round(point.load) : 0} · ${stageLabel[point.stage]}` }
      ] };
    }
    const point = points[index];
    const zone = point ? FitnessCore.formZone(point.form, point.fitness) : null;
    return { title: fmtDay(dates[index]), rows: point ? [
      { label: "Fitness", value: Math.round(point.fitness) },
      { label: "Fatigue", value: Math.round(point.fatigue) },
      { label: "Form", value: `${signed(point.form, 0)} · ${zone.label}` },
      { label: "Day's load", value: point.load ? Math.round(point.load) : "Rest" },
      ...(model.walks.length && point.load ? [
        { label: "  from runs", value: Math.round(model.runDayLoads.get(FitnessCore.dayKey(point.date)) || 0) },
        { label: "  from walks", value: Math.round(model.walkDayLoads.get(FitnessCore.dayKey(point.date)) || 0) }
      ] : [])
    ] : [{ label: "Status", value: "Before your history" }] };
  };
  // Races in view (any priority), plus today when the chart runs into the future.
  const indexOf = new Map(dates.map((date, index) => [FitnessCore.dayKey(date), index]));
  const markers = raceList()
    .map((item) => ({ index: indexOf.get(item.date) ?? -1, label: `${item.priority} · ${(item.name || item.distance).slice(0, 18)}`, className: `marker-race priority-${item.priority}` }))
    .filter((marker) => marker.index >= 0);
  if (projection) markers.push({ index: past - 1, label: "Today", className: "marker-today" });
  timeChart(document.querySelector("#loadChart"), {
    dates, yMin: 0, yFormat: (value) => Math.round(value), tooltip, markers,
    ariaLabel: projection
      ? `Fitness and fatigue over the selected window, projected to ${raceLabel(race)}. Use arrow keys to move between days.`
      : "Fitness and fatigue over the selected window. Use arrow keys to move between days.",
    series: [
      { label: "Fitness (42-day)", short: "Fitness", className: "fitness-line", values: fitness, noEndLabel: Boolean(projection) },
      { label: "Fatigue (7-day)", short: "Fatigue", className: "fatigue-line", values: fatigue, noEndLabel: Boolean(projection) },
      ...(projection ? [
        { label: "Projected fitness", short: "Fitness, race day", className: "fitness-line projection", values: projected("fitness") },
        { label: "Projected fatigue", short: "Fatigue, race day", className: "fatigue-line projection", values: projected("fatigue") }
      ] : [])
    ]
  });
  const allForm = [...form, ...projectedForm].filter(Number.isFinite);
  const limit = Math.max(20, ...allForm.map(Math.abs)) * 1.1;
  const scale = Math.max(10, ...fitness.filter(Number.isFinite));
  timeChart(document.querySelector("#formChart"), {
    dates, yMin: -limit, yMax: limit, yFormat: (value) => signed(value, 0), tooltip, zeroLine: true, height: 150, endLabels: false, rightPad: 72,
    markers: markers.map((marker) => ({ ...marker, label: "" })),
    ariaLabel: "Form, fitness minus fatigue, over the selected window. Use arrow keys to move between days.",
    bands: [
      { from: scale * 0.05, to: limit, className: "band-fresh", label: "Fresh" },
      { from: -scale * 0.3, to: -scale * 0.1, className: "band-productive", label: "Building" },
      { from: -limit, to: -scale * 0.3, className: "band-overreaching", label: "Overreaching" }
    ],
    series: [
      { label: "Form", className: (value) => value >= 0 ? "form-positive" : "form-negative", values: form, kind: "bars" },
      ...(projection ? [{ label: "Projected form", className: (value) => value >= 0 ? "form-projected form-positive" : "form-projected form-negative", values: projectedForm, kind: "bars" }] : [])
    ]
  });
  document.querySelector("#projectionLegend").hidden = !projection;
  const summary = document.querySelector("#raceDayProjection");
  summary.hidden = !projection;
  if (projection) {
    const arrive = projection.raceDay;
    const taperStart = projection.days.find((point) => point.stage === "taper" || point.stage === "race-week");
    const verdict = arrive.zone.key === "fresh" ? "Very fresh: you could hold a little more volume into the taper."
      : arrive.zone.key === "ready" ? "That is where you want to be on race day."
        : arrive.zone.key === "neutral" ? "Close, but a slightly deeper or longer taper would leave you fresher."
          : "You would still be carrying fatigue: cut more in the taper, or start it earlier.";
    summary.innerHTML = `<strong>Race-day form: ${escapeHtml(signed(arrive.form, 0))} (${escapeHtml(arrive.zone.label)})</strong> for ${escapeHtml(raceLabel(race))} on ${escapeHtml(fmtDay(new Date(`${race.date}T00:00:00`)))}. ${escapeHtml(verdict)} <span>Assumes your usual load (about ${Math.round(usual)} a day) until ${escapeHtml(taperStart ? fmtDay(taperStart.date) : "the taper")}, then ${Math.round(FitnessCore.TAPER_LOAD * 100)}% of it in the taper and ${Math.round(FitnessCore.RACE_WEEK_LOAD * 100)}% in race week.</span>`;
  }
}

function formatRaceTime(seconds) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

const RACE_METERS = { "5K": 5000, "10K": 10000, "Half marathon": 21097.5, "Marathon": 42195 };

// Upcoming A and B races at a standard distance, with what fitness predicts.
function goalRacePredictions(model) {
  const today = localDateValue(new Date());
  const ratio = model.vo2?.prior && model.vo2?.value ? model.vo2.prior / model.vo2.value : null;
  return raceList()
    .filter((race) => race.date >= today && race.priority !== "C" && RACE_METERS[race.distance])
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.date.localeCompare(b.date))
    .slice(0, 3)
    .map((race) => {
      const meters = RACE_METERS[race.distance];
      const predicted = FitnessCore.predictRaceSeconds(model.fitnessVdot, meters);
      // Six weeks ago, scaled by how the VO2 max estimate has moved since.
      const before = ratio ? FitnessCore.predictRaceSeconds(model.fitnessVdot * ratio, meters) : null;
      const goalVdot = race.goalSeconds ? FitnessCore.vdotFromPerformance(meters, race.goalSeconds) : null;
      const days = Math.round((new Date(`${race.date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
      return { race, meters, predicted, before, goalVdot, days };
    });
}

// Past fields by race, fetched once: { status: "loading" | "ready" | "none" | "error", data }.
const raceFields = new Map();

function loadRaceField(race, meters) {
  const key = `${race.sourceId}:${meters}`;
  if (raceFields.has(key)) return raceFields.get(key);
  const entry = { status: "loading", data: null };
  raceFields.set(key, entry);
  fetch(`/api/races/field?race=${encodeURIComponent(race.sourceId)}&km=${meters / 1000}`)
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("unavailable")))
    .then((data) => { entry.status = data.field?.length ? "ready" : "none"; entry.data = data; })
    .catch(() => { entry.status = "error"; })
    .finally(() => { if (fitnessModelCache.model) renderPredictions(fitnessModelCache.model); });
  return entry;
}

const ordinal = (n) => `${n}${n % 100 > 10 && n % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

// Where the predicted time would have finished in the race's last edition.
function goalRacePlace(race, meters, predicted) {
  if (!race.sourceId) return '<p class="goal-race-place-hint">Add this race with Find a race (Plan → Races) to see where you would place.</p>';
  const entry = loadRaceField(race, meters);
  if (entry.status === "loading") return '<p class="goal-race-place-hint">Looking up past results…</p>';
  if (entry.status === "error") return '<p class="goal-race-place-hint">Past results could not be loaded right now.</p>';
  if (entry.status === "none") return '<p class="goal-race-place-hint">No past results are posted for this race on RunSignup, so there is no place projection.</p>';
  const profile = coachingContext.profile || {};
  const age = profile.birthYear ? Number(race.date.slice(0, 4)) - Number(profile.birthYear) : null;
  const who = { gender: profile.gender || null, age };
  const place = FitnessCore.projectPlace(entry.data.field, predicted, who);
  if (!place) return "";
  const genderWord = { M: "men", F: "women", X: "nonbinary runners" }[profile.gender];
  const row = (label, item) => `<li><span>${label}</span><strong>${ordinal(item.place)}</strong><small>of ${item.of.toLocaleString()} · top ${item.percent}%</small></li>`;
  const rows = [row("Overall", place.overall)];
  if (place.gender) rows.push(row(genderWord[0].toUpperCase() + genderWord.slice(1), place.gender));
  if (place.ageGroup) rows.push(place.ageGroup.empty
    ? `<li><span>${profile.gender} ${place.ageGroup.label}</span><strong>1st</strong><small>nobody in this group last time</small></li>`
    : row(`${profile.gender} ${place.ageGroup.label}`, place.ageGroup));
  const goalPlace = race.goalSeconds ? FitnessCore.projectPlace(entry.data.field, race.goalSeconds, who) : null;
  const goalLine = goalPlace ? `<p class="goal-race-place-goal">At your ${formatRaceTime(race.goalSeconds)} goal: ${ordinal(goalPlace.overall.place)} overall${goalPlace.ageGroup && !goalPlace.ageGroup.empty ? `, ${ordinal(goalPlace.ageGroup.place)} in ${profile.gender} ${goalPlace.ageGroup.label}` : goalPlace.gender ? `, ${ordinal(goalPlace.gender.place)} among ${genderWord}` : ""}.</p>` : "";
  return `<div class="goal-race-place">
    <h4>Projected place <small>in the ${entry.data.date.slice(0, 4)} field of ${entry.data.finishers.toLocaleString()}</small></h4>
    <ol>${rows.join("")}</ol>
    ${goalLine}
    ${profile.gender && age ? "" : '<p class="goal-race-place-hint">Add your birth year and gender below for your place by gender and age group.</p>'}
  </div>`;
}

function placeProfileForm(goals) {
  if (!goals.some((goal) => goal.race.sourceId)) return "";
  const profile = coachingContext.profile || {};
  const option = (value, label) => `<option value="${value}"${(profile.gender || "") === value ? " selected" : ""}>${label}</option>`;
  return `<form id="placeProfile" class="place-profile" autocomplete="off">
    <span class="place-profile-title">For places by gender and age group</span>
    <label>Birth year <input name="birthYear" type="text" inputmode="numeric" maxlength="4" placeholder="e.g. 1990" value="${escapeHtml(profile.birthYear || "")}"></label>
    <label>Gender <select name="gender">${option("", "Not set")}${option("F", "Woman")}${option("M", "Man")}${option("X", "Nonbinary")}</select></label>
  </form>`;
}

document.addEventListener("submit", (event) => { if (event.target.id === "placeProfile") event.preventDefault(); });
document.addEventListener("change", (event) => {
  const form = event.target.closest?.("#placeProfile");
  if (!form) return;
  const profile = {};
  if (/^(19|20)\d{2}$/.test(form.birthYear.value.trim())) profile.birthYear = form.birthYear.value.trim();
  if (["M", "F", "X"].includes(form.gender.value)) profile.gender = form.gender.value;
  if (Object.keys(profile).length) coachingContext.profile = profile; else delete coachingContext.profile;
  saveCoachingContext();
  if (fitnessModelCache.model) renderPredictions(fitnessModelCache.model);
});

function goalRaceCard({ race, meters, predicted, before, goalVdot, days }) {
  const clock = (seconds) => formatRaceTime(Math.abs(seconds));
  const when = new Date(`${race.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const away = days === 0 ? "today" : days < 14 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.round(days / 7)} weeks`;
  let verdict = "";
  if (race.goalSeconds) {
    const margin = race.goalSeconds - predicted;
    verdict = margin >= 0
      ? `<p class="goal-race-verdict on-track"><span aria-hidden="true">▲</span> On track: ${clock(margin)} inside your ${formatRaceTime(race.goalSeconds)} goal.</p>`
      : `<p class="goal-race-verdict off-track"><span aria-hidden="true">▼</span> ${clock(margin)} slower than your ${formatRaceTime(race.goalSeconds)} goal. It needs a VO2 max of about ${goalVdot.toFixed(1)}.</p>`;
  }
  const trend = before && Math.abs(before - predicted) >= 5
    ? `<p class="goal-race-trend">${clock(before - predicted)} ${predicted < before ? "faster" : "slower"} than six weeks ago.</p>` : "";
  return `<article class="goal-race">
    <header><span class="race-priority priority-${race.priority}" aria-label="${race.priority} race">${race.priority}</span><div><strong>${escapeHtml(race.name || race.distance)}</strong><small>${escapeHtml(race.distance)} · ${escapeHtml(when)} · ${escapeHtml(away)}</small></div></header>
    <p class="goal-race-time">${formatRaceTime(predicted)} <span>${formatPace(predicted / miles(meters))} predicted</span></p>
    ${verdict}${trend}
    ${goalRacePlace(race, meters, predicted)}
  </article>`;
}

function renderPredictions(model) {
  const host = document.querySelector("#racePredictions");
  const pacesHost = document.querySelector("#trainingPaces");
  if (!model.fitnessVdot) {
    host.innerHTML = pacesHost.innerHTML = '<p class="context-muted">Predictions appear once there is a VO2 max estimate.</p>';
    return;
  }
  const goals = goalRacePredictions(model);
  const goalDistances = new Set(goals.map((goal) => goal.meters));
  host.innerHTML = `${goals.length ? `<div class="goal-races">${goals.map(goalRaceCard).join("")}</div>${placeProfileForm(goals)}` : ""}<table class="fitness-table"><thead><tr><th scope="col">Distance</th><th scope="col">Predicted time</th><th scope="col">Pace</th></tr></thead><tbody>${RACES.map((race) => {
    const seconds = FitnessCore.predictRaceSeconds(model.fitnessVdot, race.meters);
    return `<tr${goalDistances.has(race.meters) ? ' class="is-goal"' : ""}><th scope="row">${race.label}</th><td>${formatRaceTime(seconds)}</td><td>${formatPace(seconds / miles(race.meters))}</td></tr>`;
  }).join("")}</tbody></table>`;
  const paces = FitnessCore.trainingPaces(model.fitnessVdot);
  const perMile = (secondsPerMeter) => formatPace(secondsPerMeter * 1609.344);
  pacesHost.innerHTML = `<table class="fitness-table"><thead><tr><th scope="col">Zone</th><th scope="col">Pace</th><th scope="col">Use for</th></tr></thead><tbody>${PACE_ZONES.map((zone) => {
    const [fast, slow] = paces[zone.key];
    const range = Math.abs(slow - fast) * 1609.344 < 3 ? perMile(fast) : `${perMile(fast).replace(/\/(mi|km)$/, "")}–${perMile(slow)}`;
    return `<tr><th scope="row"><span class="zone-dot zone-${zone.key}" aria-hidden="true"></span>${zone.label}</th><td>${range}</td><td>${zone.use}</td></tr>`;
  }).join("")}</tbody></table>`;
}

function weeklyMetricSeries(model, days) {
  const profile = model.profile.usable ? model.profile : null;
  const weeks = new Map();
  const first = days[0], last = days.at(-1);
  model.runLoads.forEach(({ run, date, load }) => {
    if (date < first || date > new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)) return;
    const key = localDateValue(TrainingCore.weekStart(date));
    if (!weeks.has(key)) weeks.set(key, { start: TrainingCore.weekStart(date), load: 0, effSum: 0, effTime: 0, cadSum: 0, cadTime: 0, easyMeters: 0, easySeconds: 0 });
    const week = weeks.get(key);
    const seconds = Number(run.moving_time) || 0;
    const meters = Number(run.distance) || 0;
    week.load += load;
    const hrr = FitnessCore.heartRateReserve(Number(run.average_heartrate), profile);
    const easy = hrr !== null ? hrr < 0.75 : /easy|recovery/i.test(run.name);
    if (run.average_heartrate && seconds && meters && hrr !== null && hrr < 0.8) {
      week.effSum += meters / (seconds / 60) / run.average_heartrate * seconds; week.effTime += seconds;
    }
    let cadence = Number(run.average_cadence) || 0;
    if (cadence && cadence < 130) cadence *= 2; // Strava reports running cadence per foot.
    if (cadence >= 120 && cadence <= 230) { week.cadSum += cadence * seconds; week.cadTime += seconds; }
    if (easy && meters) { week.easyMeters += meters; week.easySeconds += seconds; }
  });
  // Every calendar week in the window, so gaps stay visible.
  const ordered = [];
  for (let start = TrainingCore.weekStart(first); start <= last; start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)) {
    ordered.push(weeks.get(localDateValue(start)) || { start, load: 0, effTime: 0, cadTime: 0, easyMeters: 0 });
  }
  return ordered;
}

function sparkline(values, { invert = false } = {}) {
  const width = 160, height = 44, pad = 5;
  const clean = values.map((value) => Number.isFinite(value) ? value : null);
  const present = clean.filter((value) => value !== null);
  if (present.length < 2) return '<p class="spark-empty">Not enough data</p>';
  const low = Math.min(...present), high = Math.max(...present);
  const y = (value) => {
    const fraction = (value - low) / (high - low || 1);
    return pad + (invert ? fraction : 1 - fraction) * (height - pad * 2);
  };
  const x = (index) => pad + index / Math.max(1, clean.length - 1) * (width - pad * 2);
  let path = "", pen = false;
  clean.forEach((value, index) => {
    if (value === null) { pen = false; return; }
    path += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`; pen = true;
  });
  const lastIndex = clean.findLastIndex((value) => value !== null);
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/><circle cx="${x(lastIndex)}" cy="${y(clean[lastIndex])}" r="3.5"/></svg>`;
}

function renderRunningMetrics(model, days) {
  const weeks = weeklyMetricSeries(model, days);
  const recentMean = (values, from, to) => {
    const slice = values.slice(from, to).filter(Number.isFinite);
    return slice.length ? slice.reduce((sum, value) => sum + value, 0) / slice.length : null;
  };
  const compare = (values) => {
    if (values.length < 4) return null;
    const span = Math.min(4, Math.floor(values.length / 2));
    const early = recentMean(values, 0, span), late = recentMean(values, values.length - span);
    return early && late ? { early, late, change: late - early } : null;
  };
  const efficiency = weeks.map((week) => week.effTime ? week.effSum / week.effTime : null);
  const cadence = weeks.map((week) => week.cadTime ? week.cadSum / week.cadTime : null);
  // The current week is still filling up; leave it out of the load trend.
  const currentWeek = localDateValue(TrainingCore.weekStart(new Date()));
  const load = weeks.map((week) => localDateValue(week.start) === currentWeek ? null : week.load || 0);
  const easyPace = weeks.map((week) => week.easyMeters ? week.easySeconds / miles(week.easyMeters) : null);
  const cards = [
    { label: "Aerobic efficiency", values: efficiency, format: (value) => `${value.toFixed(2)} m/beat`, betterUp: true,
      about: "Distance covered per heartbeat on easy runs. Rising means more speed for the same effort." },
    { label: "Cadence", values: cadence, format: (value) => `${Math.round(value)} spm`, betterUp: null,
      about: "Steps per minute, time-weighted. Most runners settle between 165 and 185." },
    { label: "Weekly load", values: load, format: (value) => `${Math.round(value)} pts`, betterUp: null,
      about: "Sum of training load. One hour at threshold is about 100 points." },
    { label: "Easy pace", values: easyPace, format: formatPace, betterUp: false, invert: true,
      about: "Average pace of your easy runs. Faster at the same effort is a sign of fitness." }
  ];
  document.querySelector("#runningMetrics").innerHTML = cards.map((card) => {
    const latest = card.values.findLast(Number.isFinite);
    const delta = compare(card.values);
    let deltaText = "Not enough weeks to compare";
    let tone = "";
    if (delta) {
      const improving = card.betterUp === null ? null : card.betterUp ? delta.change > 0 : delta.change < 0;
      tone = improving === null || Math.abs(delta.change) / Math.abs(delta.early) < 0.01 ? "neutral" : improving ? "up-good" : "down-bad";
      const amount = card.format === formatPace ? `${Math.abs(Math.round(delta.change / (preferences.units === "metric" ? 1.609344 : 1)))} sec/${preferences.units === "metric" ? "km" : "mi"} ${delta.change < 0 ? "faster" : "slower"}`
        : `${delta.change >= 0 ? "+" : "−"}${card.format(Math.abs(delta.change))}`;
      deltaText = `${amount} vs start of window`;
    }
    return `<article class="metric-card">
      <h3>${card.label}</h3>
      <strong>${Number.isFinite(latest) ? card.format(latest) : "–"}</strong>
      <span class="metric-delta ${tone}">${deltaText}</span>
      ${sparkline(card.values, { invert: card.invert })}
      <p>${card.about}</p>
    </article>`;
  }).join("");
}

function renderProfileForm(model) {
  const form = document.querySelector("#athleteForm");
  if (!form || form.contains(document.activeElement)) return;
  form.maxHr.value = athleteProfile.maxHr || "";
  form.restHr.value = athleteProfile.restHr || "";
  form.maxHr.placeholder = model?.profile.maxHr ? `${model.profile.maxHr} (estimated)` : "e.g. 188";
  form.restHr.placeholder = `${DEFAULT_REST_HR} (assumed)`;
  document.querySelector("#profileSummary").textContent = model
    ? `Max HR ${model.profile.maxHr || "unknown"} (${model.profile.maxSource}) · resting HR ${model.profile.restHr} (${model.profile.restSource})`
    : "Set your heart-rate profile for more accurate estimates.";
}

function renderDataNotes(model) {
  const notes = [];
  if (!model.profile.usable) notes.push("No heart-rate data found, so VO2 max uses your best efforts and load uses pace.");
  else if (model.profile.restSource === "assumed") notes.push(`Resting heart rate is assumed to be ${DEFAULT_REST_HR} bpm. Set yours below for a sharper VO2 max estimate.`);
  if (model.historyDays < 42) notes.push(`Fitness builds over about six weeks of history; you have ${model.historyDays} days loaded, so it reads low for now.`);
  if (model.hrCoverage > 0 && model.hrCoverage < 0.6) notes.push(`Only ${Math.round(model.hrCoverage * 100)}% of activities have heart rate; the rest use pace to estimate load.`);
  if (model.walks.length) notes.push(`Walks count toward fitness, fatigue and readiness (${model.recentWalks} in the last six weeks). VO2 max, race predictions and paces use runs only.`);
  if (!model.runs.length) notes.push("No runs yet, so VO2 max, race predictions and training paces are not available.");
  const host = document.querySelector("#fitnessNotes");
  host.hidden = !notes.length;
  host.innerHTML = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

function renderTodayStrip(model) {
  const host = document.querySelector("#todayStrip");
  if (!host) return;
  if (!model) { host.hidden = true; return; }
  host.hidden = false;
  const readiness = model.readiness;
  const zone = model.latest ? FitnessCore.formZone(model.latest.form, model.latest.fitness) : null;
  host.innerHTML = `
    <div class="today-readiness ${readiness ? `status-${readiness.key}` : ""}">
      <span class="today-score">${readiness ? readiness.score : "–"}</span>
      <div><span class="today-label">Readiness today${model.phase ? ` · ${escapeHtml(model.phase.label)}` : ""}</span><strong>${readiness ? `<span aria-hidden="true">${READINESS_ICON[readiness.key]}</span> ${escapeHtml(readiness.label)}` : "Needs recent runs"}</strong><p>${readiness ? escapeHtml(readiness.advice) : "Sync recent activity to see how ready you are."}</p></div>
    </div>
    <dl class="today-facts">
      <div><dt>VO2 max (est.)</dt><dd>${model.vo2 ? model.vo2.value.toFixed(1) : "–"}</dd></div>
      <div><dt>Fitness</dt><dd>${model.latest ? Math.round(model.latest.fitness) : "–"}</dd></div>
      <div><dt>Form</dt><dd>${model.latest ? `${signed(model.latest.form, 0)} <small>${zone.label}</small>` : "–"}</dd></div>
    </dl>
    <a class="today-link" href="#fitness">Open fitness <span aria-hidden="true">→</span></a>`;
}

// Overview: the current calendar week against the saved plan (or recent average).
function renderThisWeek(model) {
  const host = document.querySelector("#thisWeek");
  if (!host) return;
  if (!model) { host.hidden = true; return; }
  host.hidden = false;
  const start = TrainingCore.weekStart(new Date());
  const today = localDateValue(new Date());
  const walking = state.activityMode === "walk";
  const list = walking ? model.walks : model.runs;
  const noun = (count) => walking ? (count === 1 ? "walk" : "walks") : (count === 1 ? "run" : "runs");
  // Saved plans are running plans, so walk mode compares with the recent average.
  const plan = walking ? null : acceptedPlans[localDateValue(start)];
  const days = Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  const byDay = new Map();
  list.forEach((run) => {
    const key = localDateValue(parseActivityDate(run));
    if (key >= localDateValue(days[0]) && key <= localDateValue(days[6])) byDay.set(key, [...(byDay.get(key) || []), run]);
  });
  const doneMiles = [...byDay.values()].flat().reduce((sum, run) => sum + miles(run.distance), 0);
  const doneRuns = [...byDay.values()].flat().length;
  const planned = plan?.sessions?.filter((session) => session.kind === "run") || [];
  const fourWeekStart = new Date(start); fourWeekStart.setDate(fourWeekStart.getDate() - 28);
  const recent = list.filter((run) => { const date = parseActivityDate(run); return date >= fourWeekStart && date < start; });
  const average = recent.reduce((sum, run) => sum + miles(run.distance), 0) / 4;
  const target = planned.length ? planned.reduce((sum, session) => sum + (Number(session.miles) || 0), 0) : average;
  const targetRuns = planned.length || Math.round(recent.length / 4);
  const progress = target ? Math.min(1, doneMiles / target) : 0;
  const end = days[6];
  const range = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${end.toLocaleDateString(undefined, start.getMonth() === end.getMonth() ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
  host.innerHTML = `
    <div class="week-head">
      <div><h2>This week${walking ? " · walks" : ""} <span>${range}</span></h2>
      <p>${target ? `${displayDistance(doneMiles, 1)} of ${displayDistance(target, 0)} ${planned.length ? "planned" : "(your 4-week average)"} · ${doneRuns} of ${targetRuns} ${noun(targetRuns)}` : `${displayDistance(doneMiles, 1)} · ${doneRuns} ${noun(doneRuns)}`}</p></div>
      ${walking ? '<a class="today-link" href="#runs">See walks <span aria-hidden="true">→</span></a>' : `<a class="today-link" href="#planning">${plan ? "Open plan" : "Plan this week"} <span aria-hidden="true">→</span></a>`}
    </div>
    <div class="week-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress * 100)}" aria-label="Weekly distance ${Math.round(progress * 100)}% of target"><span style="width:${progress * 100}%"></span></div>
    <ol class="week-days">${days.map((day) => {
      const key = localDateValue(day);
      const runs = byDay.get(key) || [];
      const session = plan?.sessions?.find((item) => item.date === key);
      const future = key > today;
      // The unit is its own span so narrow day cells can drop it (the summary line names it).
      const runText = runs.map((run) => { const [value, unit] = displayDistance(miles(run.distance), 1).split(" "); return `${runTypeChip(run)}<strong>${value}<span class="unit"> ${unit}</span></strong>`; }).join("");
      const planText = session ? (session.kind === "run" ? `<small>${escapeHtml(session.title)}${session.miles ? ` · ${displayDistance(session.miles, 1)}` : ""}</small>` : "<small>Rest</small>") : "";
      const state = runs.length ? "done" : future ? (session?.kind === "run" ? "planned" : "upcoming") : session?.kind === "run" ? "missed" : "rest";
      const label = { done: "", planned: "", upcoming: "", missed: "<small>Not run</small>", rest: "<small>Rest</small>" }[state];
      return `<li class="week-day day-${state}${key === today ? " is-today" : ""}"><span class="week-day-name">${day.toLocaleDateString(undefined, { weekday: "short" })}${key === today ? " · today" : ""}</span>${runText}${!runs.length ? planText || label : planText}</li>`;
    }).join("")}</ol>`;
}

/*
 * Training-cycle timeline toward the next A race: base, build, peak, taper,
 * race week and recovery as one segmented bar, with today and any B/C races
 * marked, and when the next phases start written out underneath.
 */
function renderCycle(model) {
  const panel = document.querySelector("#cyclePanel");
  if (!panel) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const iso = localDateValue(today);
  const races = raceList();
  const goal = races.find((race) => race.priority === "A" && race.date >= iso)
    || (model?.phase?.key === "recovery" && model.phase.race.priority === "A" ? model.phase.race : null);
  panel.hidden = !goal;
  if (!goal) return;
  const dayMs = 86400000;
  const raceDay = new Date(`${goal.date}T00:00:00`);
  const offset = (days) => new Date(raceDay.valueOf() + days * dayMs);
  const taper = FitnessCore.taperDays(goal), recovery = FitnessCore.recoveryDays(goal);
  const start = new Date(Math.min(today.valueOf() - 7 * dayMs, offset(-16 * 7).valueOf()));
  const end = offset(recovery);
  const span = end - start;
  const pct = (date) => Math.max(0, Math.min(100, (date - start) / span * 100));
  const phases = [
    { key: "base", label: "Base", from: start, to: offset(-12 * 7) },
    { key: "build", label: "Build", from: offset(-12 * 7), to: offset(-5 * 7) },
    { key: "peak", label: "Peak", from: offset(-5 * 7), to: offset(-taper) },
    { key: "taper", label: "Taper", from: offset(-taper), to: offset(-7) },
    { key: "race-week", label: "Race week", from: offset(-Math.min(7, taper)), to: raceDay },
    { key: "recovery", label: "Recovery", from: raceDay, to: end }
  ].filter((phase) => phase.to > phase.from && phase.to > start)
    .map((phase) => ({ ...phase, from: new Date(Math.max(phase.from, start)) }));
  const current = model?.phase?.key;
  const fmt = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const isActive = (phase) => phase.key === current || (current === "race-day" && phase.key === "race-week");
  const segments = phases.map((phase) => {
    const width = pct(phase.to) - pct(phase.from);
    return `<li class="cycle-segment cycle-${phase.key}${isActive(phase) ? " is-current" : ""}" style="width:${width}%" title="${phase.label}: ${fmt(phase.from)} – ${fmt(phase.to)}"><span${width > 12 ? "" : ' class="visually-hidden"'}>${phase.label}</span></li>`;
  }).join("");
  // The bar gives the shape of the cycle; this list carries the names and dates,
  // so a phase too narrow to label on a phone is still readable.
  const phaseList = phases.map((phase) => {
    const state = isActive(phase) ? "is-current" : phase.to <= today ? "is-past" : "";
    return `<li class="cycle-phase ${state}"><i class="cycle-swatch cycle-${phase.key}"></i><span class="cycle-phase-name">${phase.label}${state === "is-current" ? ' <em>Now</em>' : ""}</span><span class="cycle-phase-dates">${phase.key === "recovery" ? `from ${fmt(phase.from)}` : `${fmt(phase.from)} – ${fmt(phase.to)}`}</span></li>`;
  }).join("");
  const activePhase = phases.find(isActive);
  const phaseDaysLeft = activePhase ? Math.max(0, Math.round((activePhase.to - today) / dayMs)) : null;
  const others = races.filter((race) => race.priority !== "A" && new Date(`${race.date}T00:00:00`) >= start && new Date(`${race.date}T00:00:00`) <= end);
  const ticks = others.map((race) => `<span class="cycle-race priority-${race.priority}" style="left:${pct(new Date(`${race.date}T00:00:00`))}%" title="${escapeHtml(race.name || race.distance)} (${race.priority}) · ${fmt(new Date(`${race.date}T00:00:00`))}"><b>${race.priority}</b></span>`).join("");
  const daysTo = Math.round((raceDay - today) / dayMs);
  const edge = (value) => value > 82 ? " at-end" : value < 18 ? " at-start" : "";
  const nowDetail = !model?.phase ? "" : current === "race-day" ? "Race day is here."
    : current === "recovery" ? `${model.phase.daysLeft} day${model.phase.daysLeft === 1 ? "" : "s"} of recovery left.`
    : current === "tune-up" ? `${escapeHtml(model.phase.detail)}.`
    : activePhase ? `${fmt(activePhase.from)} – ${fmt(activePhase.to)}${phaseDaysLeft ? ` · ${phaseDaysLeft} day${phaseDaysLeft === 1 ? "" : "s"} left in this phase` : ""}.` : "";
  document.querySelector("#cycleSummary").textContent = daysTo >= 0
    ? `${raceLabel(goal)} on ${raceDay.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${daysTo === 0 ? "today" : `${daysTo} days to go`}. Readiness weighs fatigue against what this phase calls for.`
    : `Recovering from ${raceLabel(goal)}. Readiness keeps you easy until recovery ends.`;
  document.querySelector("#cycleTimeline").innerHTML = `
    ${model?.phase ? `<p class="cycle-now"><span class="cycle-now-label">Now</span><strong>${escapeHtml(model.phase.label)}</strong><span class="cycle-now-detail">${nowDetail}</span></p>` : ""}
    <div class="cycle-track">
      <ol class="cycle-bar" aria-label="Training phases toward ${escapeHtml(raceLabel(goal))}">${segments}</ol>
      <span class="cycle-today${edge(pct(today))}" style="left:${pct(today)}%"><b>Today</b></span>
      <span class="cycle-goal" style="left:${pct(raceDay)}%" title="${escapeHtml(raceLabel(goal))}"></span>
      ${ticks}
    </div>
    <div class="cycle-axis"><span>${fmt(start)}</span><span class="cycle-axis-race${edge(pct(raceDay))}" style="left:${pct(raceDay)}%"><b>A</b> ${fmt(raceDay)} · race</span></div>
    <ol class="cycle-phases" aria-label="Phase dates">${phaseList}</ol>
    ${others.length ? `<p class="cycle-next">Tune-ups: ${others.map((race) => `${escapeHtml(race.name || race.distance)} (${race.priority}, ${fmt(new Date(`${race.date}T00:00:00`))})`).join(", ")}.</p>` : ""}`;
}

function renderFitness() {
  const section = document.querySelector("#fitness");
  if (!section) return;
  const model = fitnessModel();
  renderTodayStrip(model);
  renderThisWeek(model);
  renderProfileForm(model);
  const body = document.querySelector("#fitnessBody");
  const empty = document.querySelector("#fitnessEmpty");
  body.hidden = !model; empty.hidden = Boolean(model);
  if (!model) return;
  renderReadinessHero(model);
  renderCycle(model);
  renderFitnessKpis(model);
  renderDataNotes(model);
  renderPredictions(model);
  if (activeView !== "fitness") return; // Charts measure their container; draw when visible.
  const days = windowDays(model);
  renderVo2Chart(model, days);
  renderLoadCharts(model, days);
  renderRunningMetrics(model, days);
}

// Effort-based type for any run; falls back to the source label before a model exists.
// Effort-based type for any run or walk; computed on the fly before a model exists.
function runType(run) {
  const model = fitnessModel();
  return model?.types.get(String(run.id))
    || (isWalk(run) ? FitnessCore.classifyWalkType(run, model?.walkContext || {}) : FitnessCore.classifyRunType(run, model?.typeContext || {}));
}

function runTypeChip(run) {
  const type = runType(run);
  return `<span class="type-chip type-${type.group}" title="${isWalk(run) ? "Classified from distance and climb" : "Classified from effort and distance"}">${type.label}</span>`;
}

// Readiness only steers the current and next week; further out it says nothing.
function planReadiness() {
  if (typeof selectedPlanOffset !== "undefined" && (selectedPlanOffset < 0 || selectedPlanOffset > 1)) return null;
  return fitnessModel()?.readiness || null;
}

function readinessSummaryText() {
  const model = fitnessModel();
  if (!model?.readiness) return "";
  return `Readiness today: ${model.readiness.score}/100 (${model.readiness.label}). ${model.readiness.advice}`;
}

document.querySelector("#athleteForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const read = (input, low, high) => {
    if (!input.value) return null;
    const value = Number(input.value);
    return value >= low && value <= high ? Math.round(value) : NaN;
  };
  const maxHr = read(form.maxHr, 120, 225), restHr = read(form.restHr, 30, 100);
  if (Number.isNaN(maxHr) || Number.isNaN(restHr) || (maxHr && restHr && maxHr - restHr < 40)) {
    setStatus("Enter a max heart rate between 120 and 225 and a resting heart rate between 30 and 100.", true, "athleteForm");
    return;
  }
  athleteProfile = { maxHr, restHr };
  persist(ATHLETE_STORAGE_KEY, athleteProfile);
  fitnessModelCache.key = "";
  document.activeElement?.blur?.();
  render();
  setStatus("Heart-rate profile saved. Estimates updated.", false, "athleteForm");
});
