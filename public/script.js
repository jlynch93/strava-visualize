const state = {
  rawActivities: [],
  filteredRuns: [],
  buckets: [],
  status: null
};

const els = {
  connectButton: document.querySelector("#connectButton"),
  demoButton: document.querySelector("#demoButton"),
  fileInput: document.querySelector("#fileInput"),
  rangeSelect: document.querySelector("#rangeSelect"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  bucketSelect: document.querySelector("#bucketSelect"),
  metricSelect: document.querySelector("#metricSelect"),
  status: document.querySelector("#status"),
  tooltip: document.querySelector("#chartTooltip"),
  totalDistance: document.querySelector("#totalDistance"),
  totalDistanceDelta: document.querySelector("#totalDistanceDelta"),
  averagePace: document.querySelector("#averagePace"),
  averagePaceDelta: document.querySelector("#averagePaceDelta"),
  longRun: document.querySelector("#longRun"),
  longRunDelta: document.querySelector("#longRunDelta"),
  consistency: document.querySelector("#consistency"),
  consistencyDelta: document.querySelector("#consistencyDelta"),
  averageHr: document.querySelector("#averageHr"),
  averageHrDelta: document.querySelector("#averageHrDelta"),
  mainChartTitle: document.querySelector("#mainChartTitle"),
  mainChartSubtitle: document.querySelector("#mainChartSubtitle"),
  mainChart: document.querySelector("#mainChart"),
  scatterChart: document.querySelector("#scatterChart"),
  structureChart: document.querySelector("#structureChart"),
  heatmapSubtitle: document.querySelector("#heatmapSubtitle"),
  heatmapChart: document.querySelector("#heatmapChart"),
  rollingChart: document.querySelector("#rollingChart"),
  distanceMixChart: document.querySelector("#distanceMixChart"),
  paceZoneChart: document.querySelector("#paceZoneChart"),
  intelSubtitle: document.querySelector("#intelSubtitle"),
  intelGrid: document.querySelector("#intelGrid"),
  activityRows: document.querySelector("#activityRows"),
  activityCount: document.querySelector("#activityCount")
};

const METRICS = {
  distance: { label: "Mileage", unit: "mi", value: (b) => b.distanceMiles, format: (v) => `${v.toFixed(1)} mi` },
  runs: { label: "Run count", unit: "runs", value: (b) => b.runs, format: (v) => `${Math.round(v)} runs` },
  avgRun: { label: "Average run", unit: "mi", value: (b) => b.runs ? b.distanceMiles / b.runs : 0, format: (v) => `${v.toFixed(1)} mi` },
  longRun: { label: "Long run", unit: "mi", value: (b) => b.longRunMiles, format: (v) => `${v.toFixed(1)} mi` },
  pace: { label: "Pace", unit: "/mi", value: (b) => b.averagePace, format: formatPace },
  elevation: { label: "Elevation", unit: "ft", value: (b) => b.elevationFeet, format: (v) => `${Math.round(v).toLocaleString()} ft` },
  elevationDensity: { label: "Elevation density", unit: "ft/mi", value: (b) => b.distanceMiles ? b.elevationFeet / b.distanceMiles : 0, format: (v) => `${Math.round(v)} ft/mi` },
  heartrate: { label: "Heart rate", unit: "bpm", value: (b) => b.averageHr, format: (v) => v ? `${Math.round(v)} bpm` : "-" },
  load: { label: "Training load", unit: "score", value: (b) => b.trainingLoad, format: (v) => `${Math.round(v).toLocaleString()}` },
  loadPerMile: { label: "Load per mile", unit: "score/mi", value: (b) => b.distanceMiles ? b.trainingLoad / b.distanceMiles : 0, format: (v) => `${v.toFixed(1)} /mi` },
  efficiency: { label: "Aerobic efficiency", unit: "mi/bpm", value: (b) => b.averageHr ? b.distanceMiles / b.averageHr : 0, format: (v) => v ? `${v.toFixed(3)} mi/bpm` : "-" }
};

function setStatus(message, isError = false) {
  els.status.textContent = message || "";
  els.status.classList.toggle("error", isError);
}

function miles(meters) {
  return (Number(meters) || 0) / 1609.344;
}

function feet(meters) {
  return (Number(meters) || 0) * 3.28084;
}

function paceSeconds(activity) {
  const distance = miles(activity.distance);
  if (!distance) return 0;
  return (Number(activity.moving_time) || 0) / distance;
}

function formatPace(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}/mi`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function localDateValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function parseActivityDate(activity) {
  return new Date(activity.start_date_local || activity.start_date);
}

function isRun(activity) {
  const sport = String(activity.sport_type || activity.type || "").toLowerCase();
  return sport.includes("run");
}

function normalizeActivity(activity) {
  return {
    id: activity.id || crypto.randomUUID(),
    name: activity.name || "Untitled run",
    sport_type: activity.sport_type || activity.type || "Run",
    start_date: activity.start_date || activity.start_date_local,
    start_date_local: activity.start_date_local || activity.start_date,
    distance: Number(activity.distance || activity.Distance || 0),
    moving_time: Number(activity.moving_time || activity["Moving Time"] || activity.elapsed_time || 0),
    total_elevation_gain: Number(activity.total_elevation_gain || activity["Elevation Gain"] || 0),
    average_heartrate: Number(activity.average_heartrate || activity["Average Heart Rate"] || 0),
    suffer_score: Number(activity.suffer_score || activity["Relative Effort"] || 0)
  };
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function bucketKey(date, mode) {
  if (mode === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  return dateOnly(startOfWeek(date));
}

function bucketLabel(key, mode) {
  if (mode === "month") {
    const [year, month] = key.split("-");
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getRangeDates() {
  const mode = els.rangeSelect.value;
  let start = els.startDate.value ? new Date(`${els.startDate.value}T00:00:00`) : null;
  let end = els.endDate.value ? new Date(`${els.endDate.value}T23:59:59`) : null;
  if (mode === "all" && !start && !end) {
    const bounds = getActivityBounds();
    start = bounds.start;
    end = bounds.end;
  }
  return { start, end };
}

function getActivityBounds() {
  const dates = state.rawActivities
    .map(normalizeActivity)
    .filter(isRun)
    .map(parseActivityDate)
    .filter((date) => !Number.isNaN(date.valueOf()));
  if (!dates.length) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const start = new Date(today);
    start.setDate(start.getDate() - 365);
    start.setHours(0, 0, 0, 0);
    return { start, end: today };
  }
  const start = new Date(Math.min(...dates.map((date) => date.valueOf())));
  start.setHours(0, 0, 0, 0);
  const end = new Date(Math.max(...dates.map((date) => date.valueOf())));
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function syncRangeInputs() {
  const bounds = getActivityBounds();
  const mode = els.rangeSelect.value;
  let start = new Date(bounds.start);
  const end = new Date(bounds.end);
  if (mode !== "all" && mode !== "custom") {
    start = new Date(end);
    start.setDate(start.getDate() - Number(mode));
    start.setHours(0, 0, 0, 0);
    if (start < bounds.start) start = bounds.start;
  }
  if (mode === "all") {
    start = bounds.start;
  }
  if (mode !== "custom" || !els.startDate.value || !els.endDate.value) {
    els.startDate.value = localDateValue(start);
    els.endDate.value = localDateValue(end);
  }
}

function applyRangeInputs() {
  const bounds = getActivityBounds();
  els.startDate.min = localDateValue(bounds.start);
  els.endDate.max = localDateValue(bounds.end);
}

function buildBuckets(runs) {
  const mode = els.bucketSelect.value;
  const buckets = new Map();
  runs.forEach((run) => {
    const date = parseActivityDate(run);
    const key = bucketKey(date, mode);
    const bucket = buckets.get(key) || {
      key,
      label: bucketLabel(key, mode),
      runs: 0,
      distanceMiles: 0,
      movingSeconds: 0,
      elevationFeet: 0,
      hrWeighted: 0,
      hrSeconds: 0,
      longRunMiles: 0,
      trainingLoad: 0
    };
    const runMiles = miles(run.distance);
    const runSeconds = Number(run.moving_time) || 0;
    bucket.runs += 1;
    bucket.distanceMiles += runMiles;
    bucket.movingSeconds += runSeconds;
    bucket.elevationFeet += feet(run.total_elevation_gain);
    bucket.longRunMiles = Math.max(bucket.longRunMiles, runMiles);
    if (run.average_heartrate) {
      bucket.hrWeighted += run.average_heartrate * runSeconds;
      bucket.hrSeconds += runSeconds;
    }
    bucket.trainingLoad += run.suffer_score || (runMinutes(run) * effortMultiplier(run));
    buckets.set(key, bucket);
  });
  return [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => ({
      ...bucket,
      averagePace: bucket.distanceMiles ? bucket.movingSeconds / bucket.distanceMiles : 0,
      averageHr: bucket.hrSeconds ? bucket.hrWeighted / bucket.hrSeconds : 0,
      longRunShare: bucket.distanceMiles ? bucket.longRunMiles / bucket.distanceMiles : 0
    }));
}

function runMinutes(run) {
  return (Number(run.moving_time) || 0) / 60;
}

function effortMultiplier(run) {
  const hr = Number(run.average_heartrate) || 0;
  if (!hr) return 1;
  if (hr >= 170) return 2;
  if (hr >= 155) return 1.6;
  if (hr >= 140) return 1.25;
  return 1;
}

function summarize(runs, buckets) {
  const totalMiles = runs.reduce((sum, run) => sum + miles(run.distance), 0);
  const totalSeconds = runs.reduce((sum, run) => sum + (Number(run.moving_time) || 0), 0);
  const longRun = runs.reduce((max, run) => Math.max(max, miles(run.distance)), 0);
  const totalElevation = runs.reduce((sum, run) => sum + feet(run.total_elevation_gain), 0);
  const totalLoad = runs.reduce((sum, run) => sum + (run.suffer_score || runMinutes(run) * effortMultiplier(run)), 0);
  const hrRuns = runs.filter((run) => run.average_heartrate);
  const weightedHr = hrRuns.reduce((sum, run) => sum + run.average_heartrate * (Number(run.moving_time) || 0), 0);
  const hrSeconds = hrRuns.reduce((sum, run) => sum + (Number(run.moving_time) || 0), 0);
  const activeBuckets = buckets.filter((bucket) => bucket.runs > 0).length;
  const activeDays = new Set(runs.map((run) => localDateValue(parseActivityDate(run)))).size;
  const spanDays = getSpanDays(runs);
  const peakWeek = buckets.reduce((max, bucket) => Math.max(max, bucket.distanceMiles), 0);
  const averageWeeklyMiles = spanDays ? totalMiles / Math.max(spanDays / 7, 1 / 7) : 0;
  const averageRunMiles = runs.length ? totalMiles / runs.length : 0;
  const averageRunsPerWeek = spanDays ? runs.length / Math.max(spanDays / 7, 1 / 7) : 0;
  const longRunShare = totalMiles ? longRun / totalMiles : 0;
  const averageLoadPerMile = totalMiles ? totalLoad / totalMiles : 0;
  const elevationPerMile = totalMiles ? totalElevation / totalMiles : 0;
  const aerobicEfficiency = hrSeconds && totalMiles ? totalMiles / (weightedHr / hrSeconds) : 0;
  const streaks = getRunStreaks(runs);
  const rampRate = getRampRate(buckets);
  return {
    totalMiles,
    averagePace: totalMiles ? totalSeconds / totalMiles : 0,
    longRun,
    consistency: buckets.length ? activeBuckets / buckets.length : 0,
    averageHr: hrSeconds ? weightedHr / hrSeconds : 0,
    runCount: runs.length,
    activeDays,
    spanDays,
    peakWeek,
    averageWeeklyMiles,
    averageRunMiles,
    averageRunsPerWeek,
    longRunShare,
    totalElevation,
    totalLoad,
    averageLoadPerMile,
    elevationPerMile,
    aerobicEfficiency,
    longestStreak: streaks.longestStreak,
    longestRestGap: streaks.longestRestGap,
    rampRate
  };
}

function getSpanDays(runs) {
  if (!runs.length) return 0;
  const dates = runs.map(parseActivityDate).sort((a, b) => a - b);
  return Math.max(1, Math.round((dates[dates.length - 1] - dates[0]) / 86400000) + 1);
}

function getRunStreaks(runs) {
  if (!runs.length) return { longestStreak: 0, longestRestGap: 0 };
  const days = [...new Set(runs.map((run) => localDateValue(parseActivityDate(run))))].sort();
  let longestStreak = 1;
  let currentStreak = 1;
  let longestRestGap = 0;
  for (let index = 1; index < days.length; index += 1) {
    const previous = new Date(`${days[index - 1]}T00:00:00`);
    const current = new Date(`${days[index]}T00:00:00`);
    const gap = Math.round((current - previous) / 86400000);
    if (gap === 1) {
      currentStreak += 1;
    } else {
      longestStreak = Math.max(longestStreak, currentStreak);
      currentStreak = 1;
      longestRestGap = Math.max(longestRestGap, gap - 1);
    }
  }
  return { longestStreak: Math.max(longestStreak, currentStreak), longestRestGap };
}

function getRampRate(buckets) {
  if (buckets.length < 4) return 0;
  const midpoint = Math.floor(buckets.length / 2);
  const early = buckets.slice(0, midpoint);
  const late = buckets.slice(midpoint);
  const earlyAvg = early.reduce((sum, bucket) => sum + bucket.distanceMiles, 0) / early.length;
  const lateAvg = late.reduce((sum, bucket) => sum + bucket.distanceMiles, 0) / late.length;
  return earlyAvg ? ((lateAvg - earlyAvg) / earlyAvg) * 100 : 0;
}

function render() {
  applyRangeInputs();
  const normalized = state.rawActivities.map(normalizeActivity);
  const { start, end } = getRangeDates();
  state.filteredRuns = normalized
    .filter(isRun)
    .filter((activity) => {
      const date = parseActivityDate(activity);
      return !Number.isNaN(date.valueOf()) && (!start || date >= start) && (!end || date <= end);
    })
    .sort((a, b) => parseActivityDate(a) - parseActivityDate(b));
  state.buckets = buildBuckets(state.filteredRuns);

  const summary = summarize(state.filteredRuns, state.buckets);
  const previous = summarizePreviousPeriod(normalized, start, end);
  els.totalDistance.textContent = `${summary.totalMiles.toFixed(1)} mi`;
  els.averagePace.textContent = formatPace(summary.averagePace);
  els.longRun.textContent = `${summary.longRun.toFixed(1)} mi`;
  els.consistency.textContent = `${Math.round(summary.consistency * 100)}%`;
  els.averageHr.textContent = summary.averageHr ? `${Math.round(summary.averageHr)} bpm` : "-";
  renderDelta(els.totalDistanceDelta, summary.totalMiles, previous.totalMiles, "mi", true);
  renderDelta(els.averagePaceDelta, summary.averagePace, previous.averagePace, "pace", false);
  renderDelta(els.longRunDelta, summary.longRun, previous.longRun, "mi", true);
  renderDelta(els.consistencyDelta, summary.consistency * 100, previous.consistency * 100, "%", true);
  renderDelta(els.averageHrDelta, summary.averageHr, previous.averageHr, "bpm", false, true);

  renderIntel(summary, previous, start, end);
  renderMainChart();
  renderScatter();
  renderStructure();
  renderHeatmap();
  renderRollingWorkload();
  renderDistanceMix();
  renderPaceZones();
  renderTable();
}

function renderIntel(summary, previous, start, end) {
  const dateLabel = start && end
    ? `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`
    : "Selected range";
  els.intelSubtitle.textContent = `${dateLabel} · ${summary.runCount} runs · ${summary.activeDays} active days`;
  const rampClass = Math.abs(summary.rampRate) <= 12 ? "good" : summary.rampRate > 25 ? "warn" : "";
  const longShareClass = summary.longRunShare <= 0.35 ? "good" : "warn";
  const restClass = summary.longestRestGap <= 3 ? "good" : summary.longestRestGap >= 7 ? "warn" : "";
  const cards = [
    {
      label: "Weekly volume",
      value: `${summary.averageWeeklyMiles.toFixed(1)} mi/wk`,
      detail: deltaText(summary.averageWeeklyMiles, previous.averageWeeklyMiles, "mi/wk", true)
    },
    {
      label: "Peak week",
      value: `${summary.peakWeek.toFixed(1)} mi`,
      detail: "Highest grouped volume in range"
    },
    {
      label: "Run frequency",
      value: `${summary.averageRunsPerWeek.toFixed(1)} /wk`,
      detail: `${summary.runCount} total runs`
    },
    {
      label: "Average run",
      value: `${summary.averageRunMiles.toFixed(1)} mi`,
      detail: deltaText(summary.averageRunMiles, previous.averageRunMiles, "mi", true)
    },
    {
      label: "Ramp rate",
      value: `${summary.rampRate >= 0 ? "+" : ""}${summary.rampRate.toFixed(0)}%`,
      detail: "Late range vs early range volume",
      tone: rampClass
    },
    {
      label: "Long-run share",
      value: `${Math.round(summary.longRunShare * 100)}%`,
      detail: "Best when long run is not doing all the work",
      tone: longShareClass
    },
    {
      label: "Training load",
      value: `${Math.round(summary.totalLoad).toLocaleString()}`,
      detail: `${summary.averageLoadPerMile.toFixed(1)} load / mi`
    },
    {
      label: "Elevation density",
      value: `${Math.round(summary.elevationPerMile)} ft/mi`,
      detail: `${Math.round(summary.totalElevation).toLocaleString()} ft total`
    },
    {
      label: "Aerobic efficiency",
      value: summary.aerobicEfficiency ? `${summary.aerobicEfficiency.toFixed(3)} mi/bpm` : "-",
      detail: summary.averageHr ? "Mileage normalized by average HR" : "Needs heart-rate data"
    },
    {
      label: "Recovery gaps",
      value: `${summary.longestRestGap} days`,
      detail: `${summary.longestStreak} day longest run streak`,
      tone: restClass
    }
  ];
  els.intelGrid.replaceChildren(...cards.map(renderIntelCard));
}

function renderIntelCard(card) {
  const article = document.createElement("article");
  article.className = `intel-card ${card.tone || ""}`.trim();
  const label = document.createElement("span");
  label.textContent = card.label;
  const value = document.createElement("strong");
  value.textContent = card.value;
  const detail = document.createElement("small");
  detail.textContent = card.detail;
  article.append(label, value, detail);
  return article;
}

function deltaText(current, previous, unit, higherIsBetter) {
  if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) return "No prior period";
  const diff = current - previous;
  const improved = higherIsBetter ? diff >= 0 : diff <= 0;
  const direction = improved ? "Up" : "Down";
  return `${direction} ${Math.abs(diff).toFixed(1)} ${unit} vs prior`;
}

function summarizePreviousPeriod(normalized, start, end) {
  if (!start || !end || end <= start) return summarize([], []);
  const periodMs = end.valueOf() - start.valueOf();
  const previousEnd = new Date(start.valueOf() - 1);
  const previousStart = new Date(previousEnd.valueOf() - periodMs);
  const previousRuns = normalized
    .filter(isRun)
    .filter((activity) => {
      const date = parseActivityDate(activity);
      return !Number.isNaN(date.valueOf()) && date >= previousStart && date <= previousEnd;
    });
  return summarize(previousRuns, buildBuckets(previousRuns));
}

function renderDelta(element, current, previous, unit, higherIsBetter, neutral = false) {
  element.className = "";
  if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) {
    element.textContent = "No prior period";
    return;
  }
  const diff = current - previous;
  const improved = neutral ? Math.abs(diff) < 1 : higherIsBetter ? diff >= 0 : diff <= 0;
  element.classList.add(improved ? "good" : "warn");
  if (unit === "pace") {
    const seconds = Math.abs(diff);
    element.textContent = `${diff <= 0 ? "Faster" : "Slower"} by ${formatPace(seconds).replace("/mi", "")}`;
    return;
  }
  const sign = diff >= 0 ? "+" : "-";
  const value = Math.abs(diff);
  const formatted = unit === "%" ? `${Math.round(value)}%` : unit === "bpm" ? `${Math.round(value)} bpm` : `${value.toFixed(1)} ${unit}`;
  element.textContent = `${sign}${formatted} vs prior`;
}

function renderMainChart() {
  const metric = METRICS[els.metricSelect.value];
  els.mainChartTitle.textContent = `${metric.label} trend`;
  els.mainChartSubtitle.textContent = `${state.buckets.length} ${els.bucketSelect.value === "week" ? "weeks" : "months"}`;
  renderBarLineChart(els.mainChart, state.buckets, metric);
}

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  children.forEach((child) => node.appendChild(child));
  return node;
}

function renderEmpty(container, message = "Load activities to see trends.") {
  container.innerHTML = `<div class="empty-state">${message}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function attachTooltip(element, title, rows) {
  const cleanRows = rows
    .filter((row) => row && row.value !== undefined && row.value !== null && row.value !== "")
    .map((row) => ({ label: String(row.label), value: String(row.value) }));
  element.classList.add("has-tooltip");
  element.setAttribute("data-tooltip-title", title);
  element.setAttribute("data-tooltip-rows", JSON.stringify(cleanRows));
  element.setAttribute("tabindex", "0");
  element.setAttribute("aria-label", `${title}. ${cleanRows.map((row) => `${row.label}: ${row.value}`).join(". ")}`);
}

function tooltipContent(title, rows) {
  const safeRows = rows
    .map((row) => `<dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd>`)
    .join("");
  return `<strong>${escapeHtml(title)}</strong><dl>${safeRows}</dl>`;
}

function getTooltipTarget(target) {
  return target?.closest?.("[data-tooltip-title]");
}

function showTooltip(content, event, target = event.currentTarget) {
  els.tooltip.innerHTML = content;
  els.tooltip.classList.add("visible");
  moveTooltip(event, target);
}

function moveTooltip(event, target = event.currentTarget) {
  const margin = 14;
  const rect = els.tooltip.getBoundingClientRect();
  const sourceRect = target?.getBoundingClientRect?.();
  const clientX = event.clientX || (sourceRect ? sourceRect.left + sourceRect.width / 2 : window.innerWidth / 2);
  const clientY = event.clientY || (sourceRect ? sourceRect.top : window.innerHeight / 2);
  let x = clientX + margin;
  let y = clientY + margin;
  if (x + rect.width > window.innerWidth - margin) x = clientX - rect.width - margin;
  if (y + rect.height > window.innerHeight - margin) y = clientY - rect.height - margin;
  els.tooltip.style.transform = `translate(${Math.max(margin, x)}px, ${Math.max(margin, y)}px)`;
}

function hideTooltip() {
  els.tooltip.classList.remove("visible");
}

function bindTooltips() {
  document.addEventListener("mouseover", (event) => {
    const target = getTooltipTarget(event.target);
    if (!target) return;
    const rows = JSON.parse(target.getAttribute("data-tooltip-rows") || "[]");
    showTooltip(tooltipContent(target.getAttribute("data-tooltip-title") || "", rows), event, target);
  });
  document.addEventListener("mousemove", (event) => {
    const target = getTooltipTarget(event.target);
    if (target) moveTooltip(event, target);
  });
  document.addEventListener("mouseout", (event) => {
    const target = getTooltipTarget(event.target);
    if (target && !target.contains(event.relatedTarget)) hideTooltip();
  });
  document.addEventListener("focusin", (event) => {
    const target = getTooltipTarget(event.target);
    if (!target) return;
    const rows = JSON.parse(target.getAttribute("data-tooltip-rows") || "[]");
    showTooltip(tooltipContent(target.getAttribute("data-tooltip-title") || "", rows), event, target);
  });
  document.addEventListener("focusout", (event) => {
    if (getTooltipTarget(event.target)) hideTooltip();
  });
}

function renderBarLineChart(container, buckets, metric) {
  if (!buckets.length) {
    renderEmpty(container);
    return;
  }
  const width = 900;
  const height = 520;
  const pad = { top: 22, right: 28, bottom: 48, left: 58 };
  const values = buckets.map(metric.value);
  const metricKey = els.metricSelect.value;
  const paceValues = values.filter((value) => Number.isFinite(value) && value > 0);
  const min = metricKey === "pace" && paceValues.length ? Math.min(...paceValues) : 0;
  const max = Math.max(...values, 1);
  const span = Math.max(max - min, 1);
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const barWidth = Math.max(4, chartWidth / buckets.length - 4);
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": metric.label });
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (chartHeight / 4) * i;
    root.appendChild(svg("line", { class: "axis", x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
    const tick = max - (span / 4) * i;
    root.appendChild(svg("text", { class: "label", x: 8, y: y + 4 }, [document.createTextNode(metric.format(tick).replace("/mi", ""))]));
  }
  const points = buckets.map((bucket, index) => {
    const value = metric.value(bucket);
    const x = pad.left + index * (chartWidth / buckets.length) + (chartWidth / buckets.length) / 2;
    const y = pad.top + chartHeight - ((value - min) / span) * chartHeight;
    const barHeight = chartHeight - (y - pad.top);
    const bar = svg("rect", {
      class: "bar",
      x: x - barWidth / 2,
      y,
      width: barWidth,
      height: Math.max(1, barHeight),
      rx: 3
    });
    attachTooltip(bar, `${bucket.label} ${metric.label}`, [
      { label: metric.label, value: metric.format(value) },
      { label: "Miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Runs", value: bucket.runs },
      { label: "Avg pace", value: formatPace(bucket.averagePace) },
      { label: "Long run", value: `${bucket.longRunMiles.toFixed(1)} mi` },
      { label: "Elevation", value: `${Math.round(bucket.elevationFeet).toLocaleString()} ft` },
      { label: "Avg HR", value: bucket.averageHr ? `${Math.round(bucket.averageHr)} bpm` : "-" },
      { label: "Load", value: Math.round(bucket.trainingLoad).toLocaleString() }
    ]);
    root.appendChild(bar);
    if (index % Math.ceil(buckets.length / 8) === 0) {
      root.appendChild(svg("text", { class: "label", x: x - 18, y: height - 14 }, [document.createTextNode(bucket.label)]));
    }
    return `${x},${y}`;
  });
  root.appendChild(svg("polyline", { class: "line", points: points.join(" ") }));
  const smoothPoints = movingAverage(values, Math.min(4, Math.max(2, Math.ceil(values.length / 10)))).map((value, index) => {
    const x = pad.left + index * (chartWidth / buckets.length) + (chartWidth / buckets.length) / 2;
    const y = pad.top + chartHeight - ((value - min) / span) * chartHeight;
    return `${x},${y}`;
  });
  root.appendChild(svg("polyline", { class: "line secondary", points: smoothPoints.join(" ") }));
  root.appendChild(svg("text", { class: "label", x: width - 180, y: 16 }, [document.createTextNode("orange: actual  blue: moving avg")]));
  container.replaceChildren(root);
}

function movingAverage(values, windowSize) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1).filter((value) => Number.isFinite(value));
    return slice.reduce((sum, value) => sum + value, 0) / Math.max(slice.length, 1);
  });
}

function renderScatter() {
  const buckets = state.buckets.filter((bucket) => bucket.distanceMiles && bucket.averagePace);
  if (!buckets.length) {
    renderEmpty(els.scatterChart);
    return;
  }
  const width = 560;
  const height = 270;
  const pad = { top: 16, right: 18, bottom: 40, left: 48 };
  const maxMiles = Math.max(...buckets.map((b) => b.distanceMiles), 1);
  const paces = buckets.map((b) => b.averagePace);
  const minPace = Math.min(...paces);
  const maxPace = Math.max(...paces);
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Volume versus pace" });
  root.appendChild(svg("line", { class: "axis", x1: pad.left, y1: height - pad.bottom, x2: width - pad.right, y2: height - pad.bottom }));
  root.appendChild(svg("line", { class: "axis", x1: pad.left, y1: pad.top, x2: pad.left, y2: height - pad.bottom }));
  buckets.forEach((bucket) => {
    const x = pad.left + (bucket.distanceMiles / maxMiles) * (width - pad.left - pad.right);
    const paceRange = Math.max(maxPace - minPace, 1);
    const y = pad.top + ((bucket.averagePace - minPace) / paceRange) * (height - pad.top - pad.bottom);
    const r = 4 + Math.min(bucket.runs, 8);
    const color = bucket.averageHr >= 155 ? "#fc4c02" : bucket.averageHr >= 140 ? "#b77b15" : "#2867b2";
    const dot = svg("circle", { class: "dot", cx: x, cy: y, r, style: `fill: ${color}` });
    attachTooltip(dot, `${bucket.label} volume vs pace`, [
      { label: "Miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Avg pace", value: formatPace(bucket.averagePace) },
      { label: "Runs", value: bucket.runs },
      { label: "Avg run", value: `${(bucket.distanceMiles / bucket.runs).toFixed(1)} mi` },
      { label: "Avg HR", value: bucket.averageHr ? `${Math.round(bucket.averageHr)} bpm` : "-" },
      { label: "Bubble size", value: `${bucket.runs} runs` }
    ]);
    root.appendChild(dot);
  });
  root.appendChild(svg("text", { class: "label", x: width - 112, y: height - 10 }, [document.createTextNode("more miles")]));
  root.appendChild(svg("text", { class: "label", x: 4, y: 24 }, [document.createTextNode("faster")]));
  els.scatterChart.replaceChildren(root);
}

function renderStructure() {
  if (!state.buckets.length) {
    renderEmpty(els.structureChart);
    return;
  }
  const width = 560;
  const height = 270;
  const pad = { top: 18, right: 20, bottom: 34, left: 42 };
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Week structure" });
  const maxRuns = Math.max(...state.buckets.map((b) => b.runs), 1);
  const step = (width - pad.left - pad.right) / state.buckets.length;
  state.buckets.forEach((bucket, index) => {
    const x = pad.left + index * step + step * 0.25;
    const runHeight = (bucket.runs / maxRuns) * (height - pad.top - pad.bottom);
    const longHeight = bucket.longRunShare * (height - pad.top - pad.bottom);
    const runBar = svg("rect", {
      class: "bar",
      x,
      y: height - pad.bottom - runHeight,
      width: Math.max(3, step * 0.25),
      height: Math.max(1, runHeight),
      rx: 2
    });
    attachTooltip(runBar, `${bucket.label} run count`, [
      { label: "Runs", value: bucket.runs },
      { label: "Miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Avg run", value: `${(bucket.distanceMiles / bucket.runs).toFixed(1)} mi` },
      { label: "Avg pace", value: formatPace(bucket.averagePace) }
    ]);
    root.appendChild(runBar);
    const longRunBar = svg("rect", {
      class: "bar secondary",
      x: x + Math.max(4, step * 0.3),
      y: height - pad.bottom - longHeight,
      width: Math.max(3, step * 0.25),
      height: Math.max(1, longHeight),
      rx: 2
    });
    attachTooltip(longRunBar, `${bucket.label} long-run share`, [
      { label: "Long run", value: `${bucket.longRunMiles.toFixed(1)} mi` },
      { label: "Share", value: `${Math.round(bucket.longRunShare * 100)}%` },
      { label: "Week miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Elevation", value: `${Math.round(bucket.elevationFeet).toLocaleString()} ft` }
    ]);
    root.appendChild(longRunBar);
  });
  root.appendChild(svg("line", { class: "axis", x1: pad.left, y1: height - pad.bottom, x2: width - pad.right, y2: height - pad.bottom }));
  root.appendChild(svg("text", { class: "label", x: pad.left, y: height - 8 }, [document.createTextNode("teal: run count  gold: long run share")]));
  els.structureChart.replaceChildren(root);
}

function renderHeatmap() {
  if (!state.filteredRuns.length) {
    renderEmpty(els.heatmapChart);
    els.heatmapSubtitle.textContent = "Daily miles by week";
    return;
  }
  const { start, end } = getRangeDates();
  const first = start ? startOfWeek(start) : startOfWeek(parseActivityDate(state.filteredRuns[0]));
  const last = end || parseActivityDate(state.filteredRuns[state.filteredRuns.length - 1]);
  const dayMap = new Map();
  state.filteredRuns.forEach((run) => {
    const key = localDateValue(parseActivityDate(run));
    const day = dayMap.get(key) || { miles: 0, seconds: 0, runs: 0, load: 0 };
    day.miles += miles(run.distance);
    day.seconds += Number(run.moving_time) || 0;
    day.runs += 1;
    day.load += run.suffer_score || runMinutes(run) * effortMultiplier(run);
    dayMap.set(key, day);
  });
  const weeks = Math.max(1, Math.ceil((last - first) / (7 * 86400000)) + 1);
  const width = Math.max(720, weeks * 16 + 70);
  const height = 170;
  const cell = 12;
  const gap = 4;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Training calendar heatmap" });
  const maxMiles = Math.max(...[...dayMap.values()].map((day) => day.miles), 1);
  for (let week = 0; week < weeks; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(first);
      date.setDate(first.getDate() + week * 7 + day);
      const key = localDateValue(date);
      const stats = dayMap.get(key) || { miles: 0, seconds: 0, runs: 0, load: 0 };
      const value = stats.miles;
      const level = value === 0 ? 0 : Math.min(5, Math.ceil((value / maxMiles) * 5));
      const rect = svg("rect", {
        class: level ? `heat-${level}` : "heat-empty",
        x: 52 + week * (cell + gap),
        y: 24 + day * (cell + gap),
        width: cell,
        height: cell,
        rx: 3
      });
      attachTooltip(rect, new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), [
        { label: "Miles", value: `${stats.miles.toFixed(1)} mi` },
        { label: "Runs", value: stats.runs },
        { label: "Moving time", value: formatDuration(stats.seconds) },
        { label: "Avg pace", value: stats.miles ? formatPace(stats.seconds / stats.miles) : "-" },
        { label: "Load", value: Math.round(stats.load).toLocaleString() }
      ]);
      root.appendChild(rect);
    }
    if (week % Math.max(1, Math.ceil(weeks / 8)) === 0) {
      const labelDate = new Date(first);
      labelDate.setDate(first.getDate() + week * 7);
      root.appendChild(svg("text", { class: "label", x: 52 + week * (cell + gap), y: 15 }, [document.createTextNode(labelDate.toLocaleDateString(undefined, { month: "short" }))]));
    }
  }
  ["Mon", "Wed", "Fri", "Sun"].forEach((label, index) => {
    root.appendChild(svg("text", { class: "label", x: 14, y: 34 + index * 2 * (cell + gap) }, [document.createTextNode(label)]));
  });
  els.heatmapSubtitle.textContent = `${state.filteredRuns.length} runs across ${weeks} weeks`;
  els.heatmapChart.replaceChildren(root);
}

function renderDistanceMix() {
  const bins = [
    { label: "<4 mi", min: 0, max: 4 },
    { label: "4-6 mi", min: 4, max: 6 },
    { label: "6-8 mi", min: 6, max: 8 },
    { label: "8-10 mi", min: 8, max: 10 },
    { label: "10-13 mi", min: 10, max: 13 },
    { label: "13+ mi", min: 13, max: Infinity }
  ].map((bin) => ({ ...bin, count: 0, miles: 0 }));
  state.filteredRuns.forEach((run) => {
    const distance = miles(run.distance);
    const bin = bins.find((candidate) => distance >= candidate.min && distance < candidate.max);
    if (!bin) return;
    bin.count += 1;
    bin.miles += distance;
  });
  renderHorizontalBars(els.distanceMixChart, bins, "miles", (bin) => `${bin.miles.toFixed(1)} mi`, "#157f74");
}

function renderRollingWorkload() {
  if (!state.filteredRuns.length) {
    renderEmpty(els.rollingChart);
    return;
  }
  const { start, end } = getRangeDates();
  const first = start || parseActivityDate(state.filteredRuns[0]);
  const last = end || parseActivityDate(state.filteredRuns[state.filteredRuns.length - 1]);
  const daily = new Map();
  state.filteredRuns.forEach((run) => {
    const key = localDateValue(parseActivityDate(run));
    daily.set(key, (daily.get(key) || 0) + miles(run.distance));
  });
  const series = [];
  const cursor = new Date(first);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= last) {
    const seven = rollingMiles(cursor, daily, 7);
    const twentyEight = rollingMiles(cursor, daily, 28) / 4;
    series.push({ date: new Date(cursor), seven, twentyEight });
    cursor.setDate(cursor.getDate() + 1);
  }
  const width = 900;
  const height = 300;
  const pad = { top: 20, right: 28, bottom: 42, left: 58 };
  const max = Math.max(...series.map((point) => Math.max(point.seven, point.twentyEight)), 1);
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Rolling workload chart" });
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + ((height - pad.top - pad.bottom) / 4) * i;
    root.appendChild(svg("line", { class: "axis", x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
    root.appendChild(svg("text", { class: "label", x: 8, y: y + 4 }, [document.createTextNode(`${Math.round(max - (max / 4) * i)} mi`)]));
  }
  const xFor = (index) => pad.left + (index / Math.max(series.length - 1, 1)) * (width - pad.left - pad.right);
  const yFor = (value) => pad.top + (height - pad.top - pad.bottom) - (value / max) * (height - pad.top - pad.bottom);
  const sevenPoints = series.map((point, index) => `${xFor(index)},${yFor(point.seven)}`).join(" ");
  const baselinePoints = series.map((point, index) => `${xFor(index)},${yFor(point.twentyEight)}`).join(" ");
  root.appendChild(svg("polyline", { class: "line", points: sevenPoints }));
  root.appendChild(svg("polyline", { class: "line secondary", points: baselinePoints }));
  root.appendChild(svg("text", { class: "label", x: width - 230, y: 16 }, [document.createTextNode("orange: 7-day  blue: 28-day weekly baseline")]));
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));
  series.forEach((point, index) => {
    const hoverPoint = svg("circle", {
      cx: xFor(index),
      cy: yFor(point.seven),
      r: 6,
      fill: "transparent"
    });
    const ramp = point.twentyEight ? ((point.seven - point.twentyEight) / point.twentyEight) * 100 : 0;
    attachTooltip(hoverPoint, point.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), [
      { label: "7-day miles", value: `${point.seven.toFixed(1)} mi` },
      { label: "28-day baseline", value: `${point.twentyEight.toFixed(1)} mi/wk` },
      { label: "Load balance", value: `${ramp >= 0 ? "+" : ""}${ramp.toFixed(0)}%` },
      { label: "Signal", value: ramp > 25 ? "Sharp build" : ramp < -20 ? "Taper / recovery" : "Steady" }
    ]);
    root.appendChild(hoverPoint);
    if (index % labelEvery !== 0) return;
    root.appendChild(svg("text", { class: "label", x: xFor(index) - 18, y: height - 12 }, [document.createTextNode(point.date.toLocaleDateString(undefined, { month: "short", day: "numeric" }))]));
  });
  els.rollingChart.replaceChildren(root);
}

function rollingMiles(date, daily, days) {
  let total = 0;
  for (let offset = 0; offset < days; offset += 1) {
    const cursor = new Date(date);
    cursor.setDate(date.getDate() - offset);
    total += daily.get(localDateValue(cursor)) || 0;
  }
  return total;
}

function renderPaceZones() {
  const bins = [
    { label: "<7:00", min: 0, max: 420 },
    { label: "7:00-8:00", min: 420, max: 480 },
    { label: "8:00-9:00", min: 480, max: 540 },
    { label: "9:00-10:00", min: 540, max: 600 },
    { label: "10:00+", min: 600, max: Infinity }
  ].map((bin) => ({ ...bin, count: 0, miles: 0 }));
  state.filteredRuns.forEach((run) => {
    const pace = paceSeconds(run);
    const bin = bins.find((candidate) => pace >= candidate.min && pace < candidate.max);
    if (!bin) return;
    bin.count += 1;
    bin.miles += miles(run.distance);
  });
  renderHorizontalBars(els.paceZoneChart, bins, "count", (bin) => `${bin.count} runs`, "#2867b2");
}

function renderHorizontalBars(container, bins, valueKey, formatter, color) {
  if (!state.filteredRuns.length) {
    renderEmpty(container);
    return;
  }
  const width = 560;
  const height = 270;
  const pad = { top: 18, right: 24, bottom: 18, left: 86 };
  const max = Math.max(...bins.map((bin) => bin[valueKey]), 1);
  const rowHeight = (height - pad.top - pad.bottom) / bins.length;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Distribution bars" });
  bins.forEach((bin, index) => {
    const y = pad.top + index * rowHeight + 7;
    const barWidth = (bin[valueKey] / max) * (width - pad.left - pad.right);
    root.appendChild(svg("text", { class: "label", x: 8, y: y + 16 }, [document.createTextNode(bin.label)]));
    const rect = svg("rect", {
      x: pad.left,
      y,
      width: Math.max(1, barWidth),
      height: Math.max(12, rowHeight - 12),
      rx: 4,
      fill: color
    });
    attachTooltip(rect, bin.label, [
      { label: "Primary", value: formatter(bin) },
      { label: "Runs", value: bin.count },
      { label: "Miles", value: `${bin.miles.toFixed(1)} mi` },
      { label: "Avg per run", value: bin.count ? `${(bin.miles / bin.count).toFixed(1)} mi` : "-" }
    ]);
    root.appendChild(rect);
    root.appendChild(svg("text", { class: "label", x: pad.left + barWidth + 8, y: y + 16 }, [document.createTextNode(formatter(bin))]));
  });
  container.replaceChildren(root);
}

function renderTable() {
  const recent = [...state.filteredRuns].sort((a, b) => parseActivityDate(b) - parseActivityDate(a)).slice(0, 15);
  els.activityCount.textContent = `${state.filteredRuns.length} runs in range`;
  els.activityRows.replaceChildren(...recent.map((run) => {
    const row = document.createElement("tr");
    const values = [
      parseActivityDate(run).toLocaleDateString(),
      run.name,
      `${miles(run.distance).toFixed(2)} mi`,
      formatPace(paceSeconds(run)),
      `${Math.round(feet(run.total_elevation_gain)).toLocaleString()} ft`,
      run.average_heartrate ? `${Math.round(run.average_heartrate)} bpm` : "-",
      `${Math.round(run.suffer_score || runMinutes(run) * effortMultiplier(run))}`
    ];
    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    return row;
  }));
}

async function fetchActivities() {
  setStatus("Pulling activities from Strava...");
  const { start, end } = getRangeDates();
  const params = new URLSearchParams({ pages: "8", per_page: "100" });
  if (start) params.set("after", Math.floor(start.getTime() / 1000));
  if (end) params.set("before", Math.floor(end.getTime() / 1000));
  const response = await fetch(`/api/activities?${params}`);
  const data = await readApiJson(response);
  if (!response.ok) throw new Error(data.error || "Unable to fetch Strava activities.");
  state.rawActivities = data.activities;
  syncRangeInputs();
  setStatus(`Loaded ${data.activities.length} activities from Strava.`);
  render();
}

async function readApiJson(response) {
  const text = await response.text();
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }
  if (response.status === 404) {
    return { error: "Cloudflare API routes are not deployed. Redeploy as a Worker with assets, then add Strava secrets." };
  }
  return { error: `Request failed with HTTP ${response.status}.` };
}

async function checkStatus() {
  const response = await fetch("/api/status");
  const data = await readApiJson(response);
  if (!response.ok) {
    els.connectButton.disabled = true;
    setStatus(data.error || "Unable to reach the Strava API route.", true);
    return;
  }
  if (!data.configured) {
    els.connectButton.disabled = true;
    els.connectButton.title = "Add Strava API credentials to .env and restart the server.";
    setStatus(`${data.error} You can still import an export file or use demo data.`, true);
    return;
  }
  els.connectButton.disabled = false;
  els.connectButton.title = "";
  if (data.connected) {
    els.connectButton.textContent = "Refresh Strava";
    await fetchActivities();
  } else {
    setStatus(`Ready to connect. Callback URL: ${data.redirectUri}`);
  }
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map((h) => h.trim());
  return lines.map((line) => {
    const values = line.match(/("([^"]|"")*"|[^,]+)/g) || [];
    return headers.reduce((row, header, index) => {
      row[header] = (values[index] || "").replace(/^"|"$/g, "").replace(/""/g, "\"");
      return row;
    }, {});
  });
}

async function importFile(file) {
  const text = await file.text();
  const data = file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : JSON.parse(text);
  state.rawActivities = Array.isArray(data) ? data : data.activities || [];
  syncRangeInputs();
  setStatus(`Imported ${state.rawActivities.length} activities.`);
  render();
}

function makeDemoData() {
  const activities = [];
  const today = new Date();
  for (let i = 0; i < 390; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    if (![1, 3, 5, 6].includes(date.getDay()) || Math.random() < 0.16) continue;
    const longRun = date.getDay() === 6;
    const baseMiles = longRun ? 8 + Math.random() * 7 : 3 + Math.random() * 5;
    const trend = 1 + (390 - i) / 900;
    const distanceMiles = baseMiles * trend;
    const pace = 520 - (390 - i) * 0.16 + Math.random() * 45;
    const hr = 136 + Math.random() * 24 + (longRun ? 4 : 0);
    activities.push({
      id: `demo-${i}`,
      name: longRun ? "Long run" : ["Easy run", "Workout", "Steady run"][Math.floor(Math.random() * 3)],
      sport_type: "Run",
      start_date_local: date.toISOString(),
      distance: distanceMiles * 1609.344,
      moving_time: Math.round(distanceMiles * pace),
      total_elevation_gain: (40 + Math.random() * 95) * distanceMiles / 3.28084,
      average_heartrate: Math.round(hr),
      suffer_score: Math.round(distanceMiles * (hr / 18))
    });
  }
  return activities;
}

els.connectButton.addEventListener("click", () => {
  if (els.connectButton.textContent.includes("Refresh")) {
    fetchActivities().catch((error) => setStatus(error.message, true));
  } else {
    window.location.href = "/auth/login";
  }
});

els.demoButton.addEventListener("click", () => {
  state.rawActivities = makeDemoData();
  syncRangeInputs();
  setStatus("Loaded demo running history.");
  render();
});

els.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importFile(file).catch((error) => setStatus(error.message, true));
});

els.rangeSelect.addEventListener("change", () => {
  syncRangeInputs();
  render();
});

[els.startDate, els.endDate].forEach((element) => {
  element.addEventListener("change", () => {
    els.rangeSelect.value = "custom";
    render();
  });
});

[els.bucketSelect, els.metricSelect].forEach((element) => {
  element.addEventListener("change", render);
});

checkStatus().catch((error) => setStatus(error.message, true));
syncRangeInputs();
bindTooltips();
render();
