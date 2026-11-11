/* Fitness view: readiness, VO2 max, fitness/fatigue/form, predictions and running metrics.
   Calculations live in fitness-core.js; this file only prepares and draws them. */
const ATHLETE_STORAGE_KEY = "run-trends-athlete-v1";
const DEFAULT_REST_HR = 55;
let athleteProfile = (() => {
  const saved = readSaved(ATHLETE_STORAGE_KEY, {});
  const clean = (value, low, high) => { const number = Number(value); return number >= low && number <= high ? Math.round(number) : null; };
  return { maxHr: clean(saved?.maxHr, 120, 225), restHr: clean(saved?.restHr, 30, 100) };
})();
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
  const runs = state.rawActivities.map(normalizeActivity).filter(isRun)
    .filter((run) => !Number.isNaN(parseActivityDate(run).valueOf()))
    .sort((a, b) => parseActivityDate(a) - parseActivityDate(b));
  const key = JSON.stringify([runs.length, runs[0]?.id, runs.at(-1)?.id, runs.at(-1)?.moving_time, athleteProfile, activeCheckin(), new Date().toDateString()]);
  if (fitnessModelCache.key === key) return fitnessModelCache.model;
  const model = buildFitnessModel(runs);
  fitnessModelCache = { key, model };
  return model;
}

function buildFitnessModel(runs) {
  if (!runs.length) return null;
  const profile = resolvedAthleteProfile(runs);
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
  const loads = FitnessCore.dailyLoads(runs, hrProfile, thresholdSpeed, parseActivityDate);
  const firstDay = parseActivityDate(runs[0]);
  const loadSeries = FitnessCore.loadSeries(loads, firstDay, today);
  const latest = loadSeries.at(-1);
  const ratios = FitnessCore.workloadRatios(loads, today);
  const runLoads = runs.map((run) => ({ run, date: parseActivityDate(run), ...FitnessCore.runLoad(run, hrProfile, thresholdSpeed) }));
  const recentLoads = runLoads.filter((item) => item.date >= recentCutoff).map((item) => item.load);
  const typicalLoad = FitnessCore.percentile(recentLoads, 0.5) || 0;
  const lastHard = [...runLoads].reverse().find((item) => item.date <= today && (item.load >= typicalLoad * 1.35 || [1, 3].includes(Number(item.run.workout_type))));
  const historyDays = Math.round((today - firstDay) / 86400000);
  const newestRun = parseActivityDate(runs.at(-1));
  const stale = (today - newestRun) / 86400000 > 10;
  const readiness = stale ? null : FitnessCore.readiness({
    form: latest?.form, fitness: latest?.fitness, acwr: historyDays >= 28 ? ratios.acwr : null,
    hoursSinceHard: lastHard ? (Date.now() - lastHard.date) / 3600000 : historyDays >= 14 ? 24 * 14 : null,
    checkin: activeCheckin(), monotony: ratios.monotony
  });
  const loadSources = runLoads.filter((item) => item.date >= recentCutoff).reduce((counts, item) => ({ ...counts, [item.source]: (counts[item.source] || 0) + 1 }), {});
  return {
    runs, runLoads, profile, vo2Points, vo2, fitnessVdot, thresholdSpeed, loads, loadSeries, latest, ratios, readiness,
    lastHard, historyDays, stale, newestRun, loadSources,
    hrCoverage: runs.filter((run) => run.average_heartrate).length / runs.length
  };
}

/* ---------- Small SVG helpers ---------- */

function niceTicks(min, max, count = 4) {
  if (!(max > min)) { max = min + 1; }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) || raw;
  const ticks = [];
  for (let value = Math.floor(min / step) * step; value <= max + step * 0.001; value += step) ticks.push(Number(value.toFixed(6)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function shortDate(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/*
 * Time chart with one y-axis. Lines share a crosshair tooltip; bars are drawn
 * from zero. Hover or focus the chart and use arrow keys to move between days.
 */
function timeChart(container, { dates, series, yFormat, yMin, yMax, bands = [], tooltip, ariaLabel, height, zeroLine = false, endLabels = true, rightPad }) {
  if (!dates.length || !series.some((item) => item.values.some((value) => Number.isFinite(value)))) {
    renderEmpty(container, "Not enough data in this window yet.");
    return;
  }
  const width = Math.max(container.clientWidth || 0, 300);
  const chartHeight = height || Math.max(container.clientHeight || 0, 220);
  const hasEndLabels = endLabels && series.some((item) => item.kind !== "bars" && item.kind !== "dots");
  const pad = { top: 14, right: rightPad ?? (hasEndLabels ? 72 : 14), bottom: 26, left: 46 };
  const all = series.flatMap((item) => item.values.filter(Number.isFinite));
  let low = yMin ?? Math.min(...all, ...bands.map((band) => band.from).filter(Number.isFinite));
  let high = yMax ?? Math.max(...all);
  if (yMin === undefined) low = Math.min(low, high) - (high - low) * 0.08;
  if (yMax === undefined) high = high + (high - low) * 0.08;
  const ticks = niceTicks(low, high, 4);
  low = ticks[0]; high = ticks[ticks.length - 1];
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = chartHeight - pad.top - pad.bottom;
  const step = dates.length > 1 ? innerWidth / (dates.length - 1) : 0;
  const x = (index) => pad.left + (dates.length > 1 ? index * step : innerWidth / 2);
  const y = (value) => pad.top + innerHeight - (value - low) / (high - low || 1) * innerHeight;
  const root = svg("svg", { viewBox: `0 0 ${width} ${chartHeight}`, role: "img", tabindex: "0", "aria-label": ariaLabel, class: "time-chart" });
  bands.forEach((band) => {
    const top = y(Math.min(high, band.to)), bottom = y(Math.max(low, band.from));
    if (bottom - top <= 0) return;
    root.append(svg("rect", { class: `band ${band.className}`, x: pad.left, y: top, width: innerWidth, height: bottom - top }));
    if (band.label && bottom - top > 14) root.append(svg("text", { class: "band-label", x: pad.left + 6, y: top + 12 }, [document.createTextNode(band.label)]));
  });
  ticks.forEach((tick) => {
    root.append(svg("line", { class: "axis", x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick) }));
    root.append(svg("text", { class: "label", x: pad.left - 8, y: y(tick) + 4, "text-anchor": "end" }, [document.createTextNode(yFormat(tick))]));
  });
  if (zeroLine && low < 0 && high > 0) root.append(svg("line", { class: "zero-line", x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0) }));
  const labelEvery = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor(innerWidth / 90))));
  dates.forEach((date, index) => {
    if (index % labelEvery === 0) root.append(svg("text", { class: "label", x: x(index), y: chartHeight - 6, "text-anchor": index === 0 ? "start" : "middle" }, [document.createTextNode(shortDate(date))]));
  });
  series.forEach((item) => {
    if (item.kind === "bars") {
      const barWidth = Math.max(1, Math.min(10, step * 0.7));
      item.values.forEach((value, index) => {
        if (!Number.isFinite(value) || !value) return;
        const top = y(Math.max(0, value)), bottom = y(Math.min(0, value));
        root.append(svg("rect", { class: `series-bar ${typeof item.className === "function" ? item.className(value) : item.className}`, x: x(index) - barWidth / 2, y: top, width: barWidth, height: Math.max(1, bottom - top), "pointer-events": "none" }));
      });
      return;
    }
    if (item.kind === "dots") {
      item.values.forEach((value, index) => {
        if (Number.isFinite(value)) root.append(svg("circle", { class: `series-dot ${item.className}`, cx: x(index), cy: y(value), r: 2.5, "pointer-events": "none" }));
      });
      return;
    }
    let path = "", pen = false;
    item.values.forEach((value, index) => {
      if (!Number.isFinite(value)) { pen = false; return; }
      path += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`; pen = true;
    });
    root.append(svg("path", { class: `series-line ${item.className}`, d: path, "pointer-events": "none" }));
    const lastIndex = item.values.findLastIndex(Number.isFinite);
    if (lastIndex >= 0) {
      root.append(svg("circle", { class: `series-end ${item.className}`, cx: x(lastIndex), cy: y(item.values[lastIndex]), r: 4, "pointer-events": "none" }));
      if (hasEndLabels) item.labelY = y(item.values[lastIndex]);
      item.lastIndex = lastIndex;
    }
  });
  // End labels: value at the line end, nudged apart only when they would overlap.
  if (hasEndLabels) {
    const labelled = series.filter((item) => item.labelY !== undefined && item.kind !== "bars" && item.kind !== "dots").sort((a, b) => a.labelY - b.labelY);
    labelled.forEach((item, index) => {
      if (index && item.labelY - labelled[index - 1].labelY < 26) item.labelY = labelled[index - 1].labelY + 26;
      const text = svg("text", { class: "end-label", x: width - pad.right + 10, y: item.labelY }, [document.createTextNode(yFormat(item.values[item.lastIndex]))]);
      const name = svg("text", { class: "end-name", x: width - pad.right + 10, y: item.labelY + 12 }, [document.createTextNode(item.short || item.label)]);
      root.append(text, name);
    });
  }
  const guide = svg("line", { class: "crosshair", y1: pad.top, y2: pad.top + innerHeight, x1: 0, x2: 0, visibility: "hidden" });
  const focusDots = series.filter((item) => item.kind !== "bars" && item.kind !== "dots").map((item) => {
    const dot = svg("circle", { class: `series-end ${item.className}`, r: 4.5, visibility: "hidden", "pointer-events": "none" });
    return { item, dot };
  });
  root.append(guide, ...focusDots.map((entry) => entry.dot));
  const overlay = svg("rect", { class: "hit-area", x: pad.left, y: pad.top, width: innerWidth, height: innerHeight, fill: "transparent" });
  root.append(overlay);
  let active = dates.length - 1;
  const show = (index, event) => {
    active = Math.max(0, Math.min(dates.length - 1, index));
    const px = x(active);
    guide.setAttribute("x1", px); guide.setAttribute("x2", px); guide.setAttribute("visibility", "visible");
    focusDots.forEach(({ item, dot }) => {
      const value = item.values[active];
      dot.setAttribute("visibility", Number.isFinite(value) ? "visible" : "hidden");
      if (Number.isFinite(value)) { dot.setAttribute("cx", px); dot.setAttribute("cy", y(value)); }
    });
    const content = tooltip(active);
    const box = root.getBoundingClientRect();
    const scale = box.width / width || 1;
    showTooltip(tooltipContent(content.title, content.rows), event || { clientX: box.left + px * scale, clientY: box.top + pad.top * scale }, root);
  };
  const hide = () => { guide.setAttribute("visibility", "hidden"); focusDots.forEach(({ dot }) => dot.setAttribute("visibility", "hidden")); hideTooltip(); };
  overlay.addEventListener("pointermove", (event) => {
    const box = root.getBoundingClientRect();
    const px = (event.clientX - box.left) * (width / box.width);
    show(Math.round((px - pad.left) / (step || 1)), event);
  });
  overlay.addEventListener("pointerleave", hide);
  root.addEventListener("focus", () => show(active));
  root.addEventListener("blur", hide);
  root.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity, PageUp: -7, PageDown: 7 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = Number.isFinite(moves[event.key]) ? active + moves[event.key] : moves[event.key] < 0 ? 0 : dates.length - 1;
    show(next);
  });
  container.replaceChildren(root);
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

function renderLoadCharts(model, days) {
  const byDay = new Map(model.loadSeries.map((point) => [FitnessCore.dayKey(point.date), point]));
  const points = days.map((day) => byDay.get(FitnessCore.dayKey(day)) || null);
  const fitness = points.map((point) => point ? point.fitness : null);
  const fatigue = points.map((point) => point ? point.fatigue : null);
  const form = points.map((point) => point ? point.form : null);
  const tooltip = (index) => {
    const point = points[index];
    const zone = point ? FitnessCore.formZone(point.form, point.fitness) : null;
    return { title: days[index].toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), rows: point ? [
      { label: "Fitness", value: Math.round(point.fitness) },
      { label: "Fatigue", value: Math.round(point.fatigue) },
      { label: "Form", value: `${signed(point.form, 0)} · ${zone.label}` },
      { label: "Day's load", value: point.load ? Math.round(point.load) : "Rest" }
    ] : [{ label: "Status", value: "Before your history" }] };
  };
  timeChart(document.querySelector("#loadChart"), {
    dates: days, yMin: 0, yFormat: (value) => Math.round(value), tooltip,
    ariaLabel: "Fitness and fatigue over the selected window. Use arrow keys to move between days.",
    series: [
      { label: "Fitness (42-day)", short: "Fitness", className: "fitness-line", values: fitness },
      { label: "Fatigue (7-day)", short: "Fatigue", className: "fatigue-line", values: fatigue }
    ]
  });
  const limit = Math.max(20, ...form.filter(Number.isFinite).map(Math.abs)) * 1.1;
  const scale = Math.max(10, ...fitness.filter(Number.isFinite));
  timeChart(document.querySelector("#formChart"), {
    dates: days, yMin: -limit, yMax: limit, yFormat: (value) => signed(value, 0), tooltip, zeroLine: true, height: 150, endLabels: false, rightPad: 72,
    ariaLabel: "Form, fitness minus fatigue, over the selected window. Use arrow keys to move between days.",
    bands: [
      { from: scale * 0.05, to: limit, className: "band-fresh", label: "Fresh" },
      { from: -scale * 0.3, to: -scale * 0.1, className: "band-productive", label: "Building" },
      { from: -limit, to: -scale * 0.3, className: "band-overreaching", label: "Overreaching" }
    ],
    series: [{ label: "Form", className: (value) => value >= 0 ? "form-positive" : "form-negative", values: form, kind: "bars" }]
  });
}

function formatRaceTime(seconds) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function renderPredictions(model) {
  const host = document.querySelector("#racePredictions");
  const pacesHost = document.querySelector("#trainingPaces");
  if (!model.fitnessVdot) {
    host.innerHTML = pacesHost.innerHTML = '<p class="context-muted">Predictions appear once there is a VO2 max estimate.</p>';
    return;
  }
  host.innerHTML = `<table class="fitness-table"><thead><tr><th scope="col">Distance</th><th scope="col">Predicted time</th><th scope="col">Pace</th></tr></thead><tbody>${RACES.map((race) => {
    const seconds = FitnessCore.predictRaceSeconds(model.fitnessVdot, race.meters);
    return `<tr><th scope="row">${race.label}</th><td>${formatRaceTime(seconds)}</td><td>${formatPace(seconds / miles(race.meters))}</td></tr>`;
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
  if (model.hrCoverage > 0 && model.hrCoverage < 0.6) notes.push(`Only ${Math.round(model.hrCoverage * 100)}% of runs have heart rate; the rest use pace to estimate load.`);
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
      <div><span class="today-label">Readiness today</span><strong>${readiness ? `<span aria-hidden="true">${READINESS_ICON[readiness.key]}</span> ${escapeHtml(readiness.label)}` : "Needs recent runs"}</strong><p>${readiness ? escapeHtml(readiness.advice) : "Sync recent activity to see how ready you are."}</p></div>
    </div>
    <dl class="today-facts">
      <div><dt>VO2 max (est.)</dt><dd>${model.vo2 ? model.vo2.value.toFixed(1) : "–"}</dd></div>
      <div><dt>Fitness</dt><dd>${model.latest ? Math.round(model.latest.fitness) : "–"}</dd></div>
      <div><dt>Form</dt><dd>${model.latest ? `${signed(model.latest.form, 0)} <small>${zone.label}</small>` : "–"}</dd></div>
    </dl>
    <a class="today-link" href="#fitness">Open fitness <span aria-hidden="true">→</span></a>`;
}

function renderFitness() {
  const section = document.querySelector("#fitness");
  if (!section) return;
  const model = fitnessModel();
  renderTodayStrip(model);
  renderProfileForm(model);
  const body = document.querySelector("#fitnessBody");
  const empty = document.querySelector("#fitnessEmpty");
  body.hidden = !model; empty.hidden = Boolean(model);
  if (!model) return;
  renderReadinessHero(model);
  renderFitnessKpis(model);
  renderDataNotes(model);
  renderPredictions(model);
  if (activeView !== "fitness") return; // Charts measure their container; draw when visible.
  const days = windowDays(model);
  renderVo2Chart(model, days);
  renderLoadCharts(model, days);
  renderRunningMetrics(model, days);
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
