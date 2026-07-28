const state = {
  rawActivities: [],
  filteredRuns: [],
  buckets: [],
  comparisonRuns: [],
  comparisonBuckets: [],
  comparisonSummary: null,
  comparisonLabel: "previous period",
  bucketMode: "week",
  status: null,
  stravaReady: false,
  stravaConnected: false,
  stravaError: "",
  modalTrigger: null,
  insightFingerprint: "",
  renderedInsightFingerprint: "",
  runInsightCache: new Map(),
  runInsightAbort: null,
  activeRunInsightKey: "",
  activeRunId: "",
  activeRunFocus: "balanced",
  dataSource: "No data",
  activityVisible: 15
};

const els = {
  connectButton: document.querySelector("#connectButton"),
  demoButton: document.querySelector("#demoButton"),
  fileInput: document.querySelector("#fileInput"),
  rangeSelect: document.querySelector("#rangeSelect"),
  rangeSummary: document.querySelector("#rangeSummary"),
  rangePresetButtons: [...document.querySelectorAll("[data-range]")],
  customRangeToggle: document.querySelector("#customRangeToggle"),
  customRangePanel: document.querySelector("#customRangePanel"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  comparisonSelect: document.querySelector("#comparisonSelect"),
  bucketSelect: document.querySelector("#bucketSelect"),
  metricSelect: document.querySelector("#metricSelect"),
  copyViewButton: document.querySelector("#copyViewButton"),
  navWindowLabel: document.querySelector("#navWindowLabel"),
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
  trainingBriefSummary: document.querySelector("#trainingBriefSummary"),
  trainingBriefSignals: document.querySelector("#trainingBriefSignals"),
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
  aiFocus: document.querySelector("#aiFocus"),
  aiQuestion: document.querySelector("#aiQuestion"),
  aiAnalyzeButton: document.querySelector("#aiAnalyzeButton"),
  aiModelName: document.querySelector("#aiModelName"),
  aiInsightContent: document.querySelector("#aiInsightContent"),
  aiPromptChips: document.querySelector("#aiPromptChips"),
  activityRows: document.querySelector("#activityRows"),
  activityCount: document.querySelector("#activityCount"),
  activitySearch: document.querySelector("#activitySearch"),
  activityType: document.querySelector("#activityType"),
  activitySort: document.querySelector("#activitySort"),
  loadMoreRuns: document.querySelector("#loadMoreRuns"),
  workoutModal: document.querySelector("#workoutModal"),
  workoutModalClose: document.querySelector("#workoutModalClose"),
  workoutModalContent: document.querySelector("#workoutModalContent")
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
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = (rounded % 60).toString().padStart(2, "0");
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
    elapsed_time: Number(activity.elapsed_time || activity["Elapsed Time"] || activity.moving_time || 0),
    total_elevation_gain: Number(activity.total_elevation_gain || activity["Elevation Gain"] || 0),
    average_heartrate: Number(activity.average_heartrate || activity["Average Heart Rate"] || 0),
    max_heartrate: Number(activity.max_heartrate || activity["Max Heart Rate"] || 0),
    average_cadence: Number(activity.average_cadence || activity["Average Cadence"] || 0),
    average_watts: Number(activity.average_watts || activity["Average Watts"] || 0),
    max_speed: Number(activity.max_speed || activity["Max Speed"] || 0),
    suffer_score: Number(activity.suffer_score || activity["Relative Effort"] || 0),
    kudos_count: Number(activity.kudos_count || activity.Kudos || 0),
    achievement_count: Number(activity.achievement_count || activity.Achievements || 0),
    pr_count: Number(activity.pr_count || activity.PRs || 0),
    workout_type: Number(activity.workout_type || activity["Workout Type"] || 0),
    device_name: activity.device_name || activity["Device Name"] || "",
    description: activity.description || activity.Description || ""
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

function resolvedBucketMode(start, end) {
  if (els.bucketSelect.value !== "auto") return els.bucketSelect.value;
  const spanDays = start && end ? Math.max(1, (end - start) / 86400000) : 0;
  return spanDays > 370 ? "month" : "week";
}

function rangeLabel(start, end) {
  if (!start || !end) return "Selected window";
  const sameYear = start.getFullYear() === end.getFullYear();
  const startText = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric"
  });
  const endText = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${startText}–${endText}`;
}

function comparisonWindow(start, end, mode = els.comparisonSelect.value) {
  if (!start || !end || end <= start || mode === "off") {
    return { start: null, end: null, label: "no comparison", shortLabel: "comparison off" };
  }
  if (mode === "year") {
    const comparisonStart = new Date(start);
    const comparisonEnd = new Date(end);
    comparisonStart.setFullYear(comparisonStart.getFullYear() - 1);
    comparisonEnd.setFullYear(comparisonEnd.getFullYear() - 1);
    return { start: comparisonStart, end: comparisonEnd, label: "same period last year", shortLabel: "same period last year" };
  }
  const periodMs = end.valueOf() - start.valueOf();
  const comparisonEnd = new Date(start.valueOf() - 1);
  const comparisonStart = new Date(comparisonEnd.valueOf() - periodMs);
  return { start: comparisonStart, end: comparisonEnd, label: "previous period", shortLabel: "previous period" };
}

function runsInWindow(activities, start, end) {
  if (!start || !end) return [];
  return activities
    .filter(isRun)
    .filter((activity) => {
      const date = parseActivityDate(activity);
      return !Number.isNaN(date.valueOf()) && date >= start && date <= end;
    })
    .sort((left, right) => parseActivityDate(left) - parseActivityDate(right));
}

function syncRangeControlState(start, end) {
  const mode = els.rangeSelect.value;
  els.rangePresetButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.range === mode));
  });
  const custom = mode === "custom";
  els.customRangeToggle.setAttribute("aria-expanded", String(custom && !els.customRangePanel.hidden));
  els.customRangeToggle.setAttribute("aria-pressed", String(custom));
  const comparisonText = els.comparisonSelect.value === "off"
    ? "comparison off"
    : `compared with ${comparisonWindow(start, end).label}`;
  els.rangeSummary.textContent = `${rangeLabel(start, end)} · ${comparisonText}`;
}

function restoreViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const range = params.get("range");
  const comparison = params.get("compare");
  const grouping = params.get("group");
  const metric = params.get("metric");
  if (["28", "56", "84", "180", "365", "all", "custom"].includes(range)) els.rangeSelect.value = range;
  if (["previous", "year", "off"].includes(comparison)) els.comparisonSelect.value = comparison;
  if (["auto", "week", "month"].includes(grouping)) els.bucketSelect.value = grouping;
  if (METRICS[metric]) els.metricSelect.value = metric;
  if (range === "custom") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("start") || "")) els.startDate.value = params.get("start");
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("end") || "")) els.endDate.value = params.get("end");
    els.customRangePanel.hidden = false;
  }
}

function syncViewUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("range", els.rangeSelect.value);
  url.searchParams.set("compare", els.comparisonSelect.value);
  url.searchParams.set("group", els.bucketSelect.value);
  url.searchParams.set("metric", els.metricSelect.value);
  if (els.rangeSelect.value === "custom") {
    url.searchParams.set("start", els.startDate.value);
    url.searchParams.set("end", els.endDate.value);
  } else {
    url.searchParams.delete("start");
    url.searchParams.delete("end");
  }
  window.history.replaceState(null, "", url);
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
  els.startDate.max = localDateValue(bounds.end);
  els.endDate.min = localDateValue(bounds.start);
  els.endDate.max = localDateValue(bounds.end);
}

function buildBuckets(runs, mode = state.bucketMode) {
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
  const longRunThreshold = Math.max(8, averageRunMiles * 1.35);
  const longRunMiles = runs.reduce((sum, run) => {
    const distance = miles(run.distance);
    return sum + (distance >= longRunThreshold ? distance : 0);
  }, 0);
  const longRunShare = totalMiles ? longRunMiles / totalMiles : 0;
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

function currentInsightFingerprint() {
  return JSON.stringify({
    range: [els.startDate.value, els.endDate.value],
    grouping: els.bucketSelect.value,
    comparison: els.comparisonSelect.value,
    focus: els.aiFocus.value,
    question: els.aiQuestion.value.trim(),
    runs: state.filteredRuns.map((run) => [
      run.id,
      run.start_date_local || run.start_date,
      run.distance,
      run.moving_time,
      run.total_elevation_gain,
      run.average_heartrate,
      run.suffer_score
    ])
  });
}

function render() {
  applyRangeInputs();
  const normalized = state.rawActivities.map(normalizeActivity);
  const { start, end } = getRangeDates();
  state.bucketMode = resolvedBucketMode(start, end);
  state.filteredRuns = runsInWindow(normalized, start, end);
  state.buckets = buildBuckets(state.filteredRuns, state.bucketMode);
  const comparison = comparisonWindow(start, end);
  state.comparisonRuns = runsInWindow(normalized, comparison.start, comparison.end);
  state.comparisonBuckets = buildBuckets(state.comparisonRuns, state.bucketMode);
  state.comparisonSummary = summarize(state.comparisonRuns, state.comparisonBuckets);
  state.comparisonLabel = comparison.shortLabel;
  syncRangeControlState(start, end);
  syncViewUrl();
  state.insightFingerprint = currentInsightFingerprint();

  const summary = summarize(state.filteredRuns, state.buckets);
  const previous = state.comparisonSummary;
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

  renderTrainingBrief(summary, previous, start, end);
  renderSuggestedQuestions(summary, previous);
  renderIntel(summary, previous, start, end);
  renderAiState();
  renderMainChart();
  renderScatter();
  renderStructure();
  renderHeatmap();
  renderRollingWorkload();
  renderDistanceMix();
  renderPaceZones();
  renderTable();
}

function renderTrainingBrief(summary, previous, start, end) {
  if (!summary.runCount) {
    els.trainingBriefSummary.textContent = "Load running data to build a concise read of volume, pace, and training structure.";
    els.trainingBriefSignals.replaceChildren(...[
      ["Direction", "Waiting for a training window"],
      ["Effort", "Pace and load will appear here"],
      ["Structure", "Run spacing will appear here"]
    ].map(([label, detail]) => {
      const article = document.createElement("article");
      const heading = document.createElement("span");
      const copy = document.createElement("strong");
      heading.textContent = label;
      copy.textContent = detail;
      article.append(heading, copy);
      return article;
    }));
    els.navWindowLabel.textContent = "No running data loaded";
    return;
  }

  const weeklyDelta = previous.averageWeeklyMiles
    ? ((summary.averageWeeklyMiles - previous.averageWeeklyMiles) / previous.averageWeeklyMiles) * 100
    : null;
  const paceDelta = previous.averagePace ? summary.averagePace - previous.averagePace : null;
  let headline = "A balanced training window is taking shape.";
  if (summary.rampRate > 20) headline = "Volume is building quickly inside this window.";
  else if (summary.rampRate < -15) headline = "The recent end of this window is lighter.";
  else if (paceDelta !== null && paceDelta < -12) headline = "Average pace has moved faster than the prior window.";
  else if (summary.consistency >= 0.8) headline = "Consistency is the anchor of this block.";

  const rangeText = start && end
    ? `${start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}–${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
    : "selected window";
  els.trainingBriefSummary.textContent = `${headline} You averaged ${summary.averageWeeklyMiles.toFixed(1)} miles and ${summary.averageRunsPerWeek.toFixed(1)} runs per week across the ${rangeText} view.`;
  els.navWindowLabel.textContent = `${state.dataSource} · ${summary.runCount} runs · ${rangeText}`;

  const volumeDetail = weeklyDelta === null
    ? `${summary.averageWeeklyMiles.toFixed(1)} mi/wk in view`
    : `${weeklyDelta >= 0 ? "+" : ""}${Math.round(weeklyDelta)}% weekly volume vs ${state.comparisonLabel}`;
  const paceDetail = paceDelta === null
    ? `${formatPace(summary.averagePace)} average pace`
    : `${paceDelta < 0 ? "Faster" : paceDelta > 0 ? "Slower" : "Level"} by ${formatPace(Math.abs(paceDelta)).replace("/mi", "")} vs ${state.comparisonLabel}`;
  const structureDetail = `${Math.round(summary.longRunShare * 100)}% of mileage from long runs · ${summary.longestRestGap}d longest gap`;
  const signals = [
    { label: "Direction", detail: volumeDetail, tone: weeklyDelta !== null && Math.abs(weeklyDelta) > 20 ? "caution" : "positive" },
    { label: "Effort", detail: paceDetail, tone: paceDelta !== null && paceDelta < 0 ? "positive" : "neutral" },
    { label: "Structure", detail: structureDetail, tone: summary.longRunShare > 0.5 || summary.longestRestGap >= 7 ? "caution" : "neutral" }
  ];
  els.trainingBriefSignals.replaceChildren(...signals.map((signal) => {
    const article = document.createElement("article");
    article.className = signal.tone;
    const label = document.createElement("span");
    const detail = document.createElement("strong");
    label.textContent = signal.label;
    detail.textContent = signal.detail;
    article.append(label, detail);
    return article;
  }));
}

function renderSuggestedQuestions(summary, comparison) {
  if (!summary.runCount) {
    els.aiPromptChips.replaceChildren();
    return;
  }
  const questions = [];
  const hasComparison = comparison?.runCount > 0;
  const volumeChange = hasComparison && comparison.averageWeeklyMiles
    ? Math.round(((summary.averageWeeklyMiles - comparison.averageWeeklyMiles) / comparison.averageWeeklyMiles) * 100)
    : null;
  const loadChange = hasComparison && comparison.totalLoad
    ? Math.round(((summary.totalLoad - comparison.totalLoad) / comparison.totalLoad) * 100)
    : null;
  const paceChange = hasComparison && comparison.averagePace
    ? Math.round(summary.averagePace - comparison.averagePace)
    : null;

  if (volumeChange !== null && Math.abs(volumeChange) >= 8) {
    questions.push({
      focus: "progression",
      label: `${volumeChange >= 0 ? "Volume +" : "Volume "}${volumeChange}%`,
      question: `What best explains the ${Math.abs(volumeChange)}% ${volumeChange >= 0 ? "increase" : "decrease"} in weekly volume versus the ${state.comparisonLabel}?`
    });
  }
  if (loadChange !== null && Math.abs(loadChange) >= 8) {
    questions.push({
      focus: "recovery",
      label: `Load ${loadChange >= 0 ? "+" : ""}${loadChange}%`,
      question: `How did training load shift versus the ${state.comparisonLabel}, and which supporting signal matters most?`
    });
  }
  if (paceChange !== null && Math.abs(paceChange) >= 6) {
    questions.push({
      focus: "efficiency",
      label: paceChange < 0 ? "Pace moved faster" : "Pace moved slower",
      question: `How did pace change versus the ${state.comparisonLabel}, and does the load or heart-rate context support that change?`
    });
  }
  if (summary.longRunShare >= 0.32) {
    questions.push({
      focus: "durability",
      label: `${Math.round(summary.longRunShare * 100)}% long-run share`,
      question: "How balanced is the long-run contribution within this selected window?"
    });
  }
  if (summary.longestRestGap >= 5) {
    questions.push({
      focus: "consistency",
      label: `${summary.longestRestGap}d longest gap`,
      question: "What does the run-spacing pattern show, and where is the evidence limited?"
    });
  }
  [
    { focus: "balanced", label: "Strongest signal", question: "Which app-calculated signal is strongest in this window, and how confident is that read?" },
    { focus: "recovery", label: "Load check", question: "How has training load shifted, and what should I compare next?" },
    { focus: "durability", label: "Long runs", question: "What stands out about my long-run pattern?" }
  ].forEach((fallback) => {
    if (questions.length < 3 && !questions.some((item) => item.focus === fallback.focus)) questions.push(fallback);
  });

  els.aiPromptChips.replaceChildren(...questions.slice(0, 4).map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.focus = item.focus;
    button.dataset.question = item.question;
    button.textContent = item.label;
    return button;
  }));
}

function renderAiState() {
  els.aiAnalyzeButton.disabled = !state.filteredRuns.length;
  if (state.renderedInsightFingerprint === state.insightFingerprint) return;
  state.renderedInsightFingerprint = "";
  els.aiInsightContent.removeAttribute("aria-busy");
  const wrapper = document.createElement("div");
  wrapper.className = "ai-empty";
  const index = document.createElement("span");
  index.setAttribute("aria-hidden", "true");
  index.textContent = state.filteredRuns.length ? "02" : "01";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = state.filteredRuns.length ? "Your selected window is ready" : "Load running data to begin";
  const detail = document.createElement("p");
  detail.textContent = state.filteredRuns.length
    ? `${state.filteredRuns.length} runs are ready. Ask a question or choose a focus; Ollama will prioritize the most relevant app-calculated signals.`
    : "Connect Strava, import a file, or try the demo. The app will calculate your dashboard first, then you can ask Ollama for a separate training read.";
  copy.append(title, detail);
  wrapper.append(index, copy);
  els.aiInsightContent.replaceChildren(wrapper);
}

function buildInsightPayload() {
  const summary = summarize(state.filteredRuns, state.buckets);
  const comparison = state.comparisonSummary || summarize([], []);
  const hasComparison = comparison.runCount > 0 && els.comparisonSelect.value !== "off";
  const percentChange = (current, earlier) => earlier ? Math.round(((current - earlier) / earlier) * 100) : null;
  const direction = (change, inverse = false) => {
    if (change === null || Math.abs(change) < 1) return "stable";
    const higher = change > 0;
    return inverse ? (higher ? "slower" : "faster") : (higher ? "higher" : "lower");
  };
  const volumeChange = hasComparison ? percentChange(summary.averageWeeklyMiles, comparison.averageWeeklyMiles) : null;
  const loadChange = hasComparison ? percentChange(summary.totalLoad, comparison.totalLoad) : null;
  const paceChange = hasComparison && comparison.averagePace ? Math.round(summary.averagePace - comparison.averagePace) : null;
  const consistencyChange = hasComparison ? Math.round((summary.consistency - comparison.consistency) * 100) : null;
  const longRunShareChange = hasComparison ? Math.round((summary.longRunShare - comparison.longRunShare) * 100) : null;
  const heartRateChange = hasComparison && summary.averageHr && comparison.averageHr ? Math.round(summary.averageHr - comparison.averageHr) : null;
  const spacingChange = hasComparison ? summary.longestRestGap - comparison.longestRestGap : null;
  const hrCoverage = summary.runCount
    ? Math.round((state.filteredRuns.filter((run) => Number(run.average_heartrate) > 0).length / summary.runCount) * 100)
    : 0;
  const directLoadCoverage = summary.runCount
    ? Math.round((state.filteredRuns.filter((run) => Number(run.suffer_score) > 0).length / summary.runCount) * 100)
    : 0;
  const candidates = [
    { id: "volume", direction: direction(volumeChange), change: volumeChange, coverage: 100 },
    { id: "pace", direction: direction(paceChange, true), change: paceChange, coverage: 100 },
    { id: "load", direction: direction(loadChange), change: loadChange, coverage: directLoadCoverage },
    { id: "consistency", direction: direction(consistencyChange), change: consistencyChange, coverage: 100 },
    { id: "long_run", direction: direction(longRunShareChange), change: longRunShareChange, coverage: 100 },
    { id: "heart_rate", direction: direction(heartRateChange), change: heartRateChange, coverage: hrCoverage },
    { id: "spacing", direction: direction(spacingChange), change: spacingChange, coverage: 100 }
  ];
  const trend = hasComparison ? {
    comparisonMode: els.comparisonSelect.value,
    comparisonLabel: state.comparisonLabel,
    earlierPeriodCount: state.comparisonBuckets.length,
    recentPeriodCount: state.buckets.length,
    earlierAverageMiles: Number(comparison.averageWeeklyMiles.toFixed(1)),
    recentAverageMiles: Number(summary.averageWeeklyMiles.toFixed(1)),
    volumeChangePercent: volumeChange,
    earlierAveragePaceSeconds: comparison.averagePace ? Math.round(comparison.averagePace) : null,
    recentAveragePaceSeconds: summary.averagePace ? Math.round(summary.averagePace) : null,
    paceChangeSeconds: paceChange,
    earlierAverageHr: comparison.averageHr ? Math.round(comparison.averageHr) : null,
    recentAverageHr: summary.averageHr ? Math.round(summary.averageHr) : null,
    earlierAverageLoad: Math.round(comparison.totalLoad),
    recentAverageLoad: Math.round(summary.totalLoad)
  } : null;
  return {
    focus: els.aiFocus.value,
    question: els.aiQuestion.value.trim().slice(0, 280),
    range: {
      start: els.startDate.value || null,
      end: els.endDate.value || null,
      grouping: state.bucketMode,
      comparisonMode: els.comparisonSelect.value,
      comparisonLabel: state.comparisonLabel
    },
    summary: {
      runCount: summary.runCount,
      activeDays: summary.activeDays,
      totalMiles: Number(summary.totalMiles.toFixed(1)),
      averagePaceSeconds: Math.round(summary.averagePace || 0),
      averageWeeklyMiles: Number(summary.averageWeeklyMiles.toFixed(1)),
      averageRunsPerWeek: Number(summary.averageRunsPerWeek.toFixed(1)),
      averageRunMiles: Number(summary.averageRunMiles.toFixed(1)),
      longRunMiles: Number(summary.longRun.toFixed(1)),
      longRunSharePercent: Math.round(summary.longRunShare * 100),
      peakWeekMiles: Number(summary.peakWeek.toFixed(1)),
      consistencyPercent: Math.round(summary.consistency * 100),
      rampRatePercent: Math.round(summary.rampRate),
      averageHr: summary.averageHr ? Math.round(summary.averageHr) : null,
      elevationFeetPerMile: Math.round(summary.elevationPerMile),
      trainingLoad: Math.round(summary.totalLoad),
      loadPerMile: Number(summary.averageLoadPerMile.toFixed(1)),
      longestRestGapDays: summary.longestRestGap
    },
    comparison: hasComparison ? {
      runCount: comparison.runCount,
      averageWeeklyMiles: Number(comparison.averageWeeklyMiles.toFixed(1)),
      averagePaceSeconds: Math.round(comparison.averagePace || 0),
      consistencyPercent: Math.round(comparison.consistency * 100),
      longRunSharePercent: Math.round(comparison.longRunShare * 100),
      averageHr: comparison.averageHr ? Math.round(comparison.averageHr) : null,
      trainingLoad: Math.round(comparison.totalLoad),
      longestRestGapDays: comparison.longestRestGap
    } : null,
    coverage: {
      heartRatePercent: hrCoverage,
      directLoadPercent: directLoadCoverage,
      currentRuns: summary.runCount,
      comparisonRuns: comparison.runCount,
      completePeriods: Math.max(0, state.buckets.length - 2)
    },
    candidates,
    trend,
  };
}

function renderAiLoading() {
  els.aiInsightContent.setAttribute("aria-busy", "true");
  const wrapper = document.createElement("div");
  wrapper.className = "ai-loading";
  const index = document.createElement("span");
  index.setAttribute("aria-hidden", "true");
  index.textContent = "···";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "Reading the shape of your training";
  const detail = document.createElement("p");
  detail.textContent = "Ollama is selecting the most relevant angles from the compact metrics supplied for this request. The app keeps every statement tied to its calculations.";
  copy.append(title, detail);
  wrapper.append(index, copy);
  els.aiInsightContent.replaceChildren(wrapper);
}

function renderAiError(message) {
  els.aiInsightContent.removeAttribute("aria-busy");
  const wrapper = document.createElement("div");
  wrapper.className = "ai-error";
  const index = document.createElement("span");
  index.setAttribute("aria-hidden", "true");
  index.textContent = "!";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "The model did not return an analysis";
  const detail = document.createElement("p");
  detail.textContent = message;
  copy.append(title, detail);
  wrapper.append(index, copy);
  els.aiInsightContent.replaceChildren(wrapper);
}

function renderAiInsight(insight, model) {
  els.aiInsightContent.removeAttribute("aria-busy");
  const header = document.createElement("div");
  header.className = "ai-result-header";
  const label = document.createElement("span");
  label.textContent = `Ollama-guided read · ${model || els.aiModelName.textContent}`;
  const headline = document.createElement("h3");
  headline.textContent = insight.headline;
  const summary = document.createElement("p");
  summary.textContent = insight.summary;
  header.append(label, headline, summary);

  const evidence = document.createElement("div");
  evidence.className = "ai-evidence";
  [
    insight.answerability ? `Evidence: ${insight.answerability}` : "",
    insight.confidence ? `Confidence: ${insight.confidence}` : "",
    insight.limitation ? insight.limitation : ""
  ].filter(Boolean).forEach((text) => {
    const badge = document.createElement("span");
    badge.textContent = text;
    evidence.append(badge);
  });

  const observations = document.createElement("div");
  observations.className = "ai-observations";
  (insight.observations || []).slice(0, 4).forEach((observation, index) => {
    const card = document.createElement("article");
    const tone = ["positive", "neutral", "caution"].includes(observation.tone) ? observation.tone : "neutral";
    card.className = `ai-observation ${tone}`;
    const cardLabel = document.createElement("span");
    cardLabel.textContent = `Signal ${String(index + 1).padStart(2, "0")}`;
    const title = document.createElement("strong");
    title.textContent = observation.title;
    const detail = document.createElement("p");
    detail.textContent = observation.detail;
    card.append(cardLabel, title, detail);
    observations.append(card);
  });

  const nextStep = document.createElement("div");
  nextStep.className = "ai-next-step";
  const nextLabel = document.createElement("span");
  nextLabel.textContent = "Try next";
  const nextCopy = document.createElement("strong");
  nextCopy.textContent = insight.nextStep;
  nextStep.append(nextLabel, nextCopy);

  const caution = document.createElement("p");
  caution.className = "ai-caution";
  caution.textContent = insight.caution || "Treat this as a training pattern review, not medical advice.";
  els.aiInsightContent.replaceChildren(header, evidence, observations, nextStep, caution);
  requestAnimationFrame(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    els.aiInsightContent.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });
}

async function analyzeWithOllama() {
  if (!state.filteredRuns.length) return;
  state.insightFingerprint = currentInsightFingerprint();
  const requestedFingerprint = state.insightFingerprint;
  els.aiAnalyzeButton.disabled = true;
  els.aiAnalyzeButton.textContent = "Asking Ollama…";
  renderAiLoading();
  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildInsightPayload())
    });
    const data = await readApiJson(response);
    if (!response.ok) throw new Error(data.error || "Ollama could not analyze this training window.");
    if (requestedFingerprint !== state.insightFingerprint) {
      renderAiState();
      return;
    }
    state.renderedInsightFingerprint = requestedFingerprint;
    if (data.model) els.aiModelName.textContent = data.model;
    renderAiInsight(data.insight, data.model);
  } catch (error) {
    state.renderedInsightFingerprint = "";
    renderAiError(error.message || "Check that the Ollama URL is reachable and try again.");
  } finally {
    els.aiAnalyzeButton.disabled = !state.filteredRuns.length;
    els.aiAnalyzeButton.textContent = "Ask Ollama";
  }
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
  if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) return "No comparison";
  const diff = current - previous;
  const improved = higherIsBetter ? diff >= 0 : diff <= 0;
  const direction = improved ? "Up" : "Down";
  return `${direction} ${Math.abs(diff).toFixed(1)} ${unit} vs ${state.comparisonLabel}`;
}

function renderDelta(element, current, previous, unit, higherIsBetter, neutral = false) {
  element.className = "";
  if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) {
    element.textContent = "No comparison";
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
  element.textContent = `${sign}${formatted} vs ${state.comparisonLabel}`;
}

function renderMainChart() {
  const metric = METRICS[els.metricSelect.value];
  document.querySelectorAll("[data-metric]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.metric === els.metricSelect.value));
  });
  els.mainChartTitle.textContent = `${metric.label} trend`;
  const comparisonText = state.comparisonRuns.length ? ` · ${state.comparisonLabel} overlay` : "";
  els.mainChartSubtitle.textContent = `${state.buckets.length} ${state.bucketMode === "week" ? "weeks" : "months"}${comparisonText}`;
  renderBarLineChart(els.mainChart, state.buckets, metric, state.comparisonBuckets);
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

function renderBarLineChart(container, buckets, metric, comparisonBuckets = []) {
  if (!buckets.length) {
    renderEmpty(container);
    return;
  }
  const width = 900;
  const height = 520;
  const pad = { top: 22, right: 28, bottom: 48, left: 58 };
  const values = buckets.map(metric.value);
  const comparisonValues = comparisonBuckets.map(metric.value);
  const metricKey = els.metricSelect.value;
  const allValues = [...values, ...comparisonValues];
  const paceValues = allValues.filter((value) => Number.isFinite(value) && value > 0);
  const min = metricKey === "pace" && paceValues.length ? Math.min(...paceValues) : 0;
  const max = Math.max(...allValues, 1);
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
  if (comparisonValues.length) {
    const comparisonPoints = comparisonValues.map((value, index) => {
      const x = pad.left + index * (chartWidth / comparisonValues.length) + (chartWidth / comparisonValues.length) / 2;
      const y = pad.top + chartHeight - ((value - min) / span) * chartHeight;
      return `${x},${y}`;
    });
    root.appendChild(svg("polyline", { class: "line comparison", points: comparisonPoints.join(" ") }));
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
  const legend = comparisonValues.length
    ? `orange: current  teal: moving avg  dashed: ${state.comparisonLabel}`
    : "orange: current  teal: moving avg";
  root.appendChild(svg("text", { class: "label chart-legend", x: width - 310, y: 16 }, [document.createTextNode(legend)]));
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

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function formatOrdinal(value) {
  const rounded = Math.round(value);
  const lastTwo = rounded % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${rounded}th`;
  const suffix = rounded % 10 === 1 ? "st" : rounded % 10 === 2 ? "nd" : rounded % 10 === 3 ? "rd" : "th";
  return `${rounded}${suffix}`;
}

function activityLoad(run) {
  return Number(run.suffer_score) || runMinutes(run) * effortMultiplier(run);
}

function daysBetween(left, right) {
  if (!left || !right) return null;
  return Math.round((parseActivityDate(right) - parseActivityDate(left)) / 86400000);
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function percentileRank(values, value, higherIsBetter = true) {
  const clean = values.filter((candidate) => Number.isFinite(candidate) && candidate > 0);
  if (!clean.length || !Number.isFinite(value) || value <= 0) return 0;
  const count = clean.filter((candidate) => higherIsBetter ? candidate <= value : candidate >= value).length;
  return Math.round((count / clean.length) * 100);
}

function classifyRun(run, distanceMiles, pace, distanceRank, paceRank) {
  const name = run.name.toLowerCase();
  if (name.includes("race")) return "Race";
  if (name.includes("tempo") || name.includes("interval") || name.includes("workout")) return "Quality";
  if (name.includes("easy") || name.includes("recovery")) return "Easy";
  if (name.includes("long")) return "Long";
  if (distanceRank >= 85 || distanceMiles >= 10) return "Long";
  if (paceRank >= 85) return "Quality";
  if (pace && pace >= 600) return "Easy";
  return "Steady";
}

function buildWorkoutDigest(run) {
  const runs = [...state.filteredRuns].sort((a, b) => parseActivityDate(a) - parseActivityDate(b));
  const index = runs.findIndex((candidate) => String(candidate.id) === String(run.id));
  const runDate = parseActivityDate(run);
  const previousRun = index > 0 ? runs[index - 1] : null;
  const nextRun = index >= 0 && index < runs.length - 1 ? runs[index + 1] : null;
  const distance = miles(run.distance);
  const pace = paceSeconds(run);
  const elevation = feet(run.total_elevation_gain);
  const elevationDensity = distance ? elevation / distance : 0;
  const load = activityLoad(run);
  const loadPerMile = distance ? load / distance : 0;
  const moving = Number(run.moving_time) || 0;
  const elapsed = Number(run.elapsed_time) || moving;
  const stopped = Math.max(0, elapsed - moving);
  const similar = runs.filter((candidate) => {
    const candidateDistance = miles(candidate.distance);
    return candidate.id !== run.id && candidateDistance >= distance * 0.8 && candidateDistance <= distance * 1.2;
  });
  const similarPace = average(similar.map(paceSeconds));
  const similarHr = average(similar.map((candidate) => Number(candidate.average_heartrate) || 0));
  const similarLoadPerMile = average(similar.map((candidate) => {
    const candidateMiles = miles(candidate.distance);
    return candidateMiles ? activityLoad(candidate) / candidateMiles : 0;
  }));
  const distanceRank = percentileRank(runs.map((candidate) => miles(candidate.distance)), distance, true);
  const paceRank = percentileRank(runs.map(paceSeconds), pace, false);
  const loadRank = percentileRank(runs.map(activityLoad), load, true);
  const bucket = state.buckets.find((candidate) => candidate.key === bucketKey(runDate, state.bucketMode));
  const previousGap = daysBetween(previousRun, run);
  const nextGap = daysBetween(run, nextRun);
  const contextStart = Math.max(0, Math.min(index - 3, runs.length - 7));
  const neighboringRuns = runs.slice(contextStart, contextStart + 7);
  const runType = classifyRun(run, distance, pace, distanceRank, paceRank);
  const sevenDays = 7 * 86400000;
  const priorSevenRuns = runs.filter((candidate) => {
    const date = parseActivityDate(candidate);
    return date < runDate && runDate - date <= sevenDays;
  });
  const nextSevenRuns = runs.filter((candidate) => {
    const date = parseActivityDate(candidate);
    return date > runDate && date - runDate <= sevenDays;
  });
  const sumMiles = (items) => items.reduce((sum, candidate) => sum + miles(candidate.distance), 0);
  const sumLoad = (items) => items.reduce((sum, candidate) => sum + activityLoad(candidate), 0);
  const priorSevenMiles = sumMiles(priorSevenRuns);
  const nextSevenMiles = sumMiles(nextSevenRuns);
  const priorSevenLoad = sumLoad(priorSevenRuns);
  const nextSevenLoad = sumLoad(nextSevenRuns);
  const periodDistanceShare = bucket?.distanceMiles ? distance / bucket.distanceMiles : 0;
  const periodLoadShare = bucket?.trainingLoad ? load / bucket.trainingLoad : 0;
  const similarElevationDensity = average(similar.map((candidate) => {
    const candidateMiles = miles(candidate.distance);
    return candidateMiles ? feet(candidate.total_elevation_gain) / candidateMiles : 0;
  }));
  const standoutScore = Math.round((Math.abs(distanceRank - 50) + Math.abs(paceRank - 50) + Math.abs(loadRank - 50)) / 3);
  const hrCoverage = similar.length
    ? Math.round((similar.filter((candidate) => Number(candidate.average_heartrate) > 0).length / similar.length) * 100)
    : 0;
  const signals = [
    {
      label: runType,
      value: `${formatOrdinal(distanceRank)} distance pct.`,
      detail: `${paceRank ? `Faster than ${paceRank}% of runs in range` : "Pace rank needs duration data"}`
    },
    {
      label: loadPerMile > similarLoadPerMile * 1.2 && similarLoadPerMile ? "High strain" : "Load check",
      value: `${Math.round(load).toLocaleString()} load`,
      detail: similarLoadPerMile ? `${formatNumber(loadPerMile, 1)} /mi vs ${formatNumber(similarLoadPerMile, 1)} /mi for similar runs` : `${formatOrdinal(loadRank)} load pct. in range`
    },
    {
      label: previousGap !== null && previousGap <= 1 ? "Tight recovery" : "Recovery space",
      value: previousGap === null ? "First in range" : `${previousGap} days since prior`,
      detail: nextGap === null ? "No later run in range" : `${nextGap} days until next run`
    },
    {
      label: elevationDensity >= 100 ? "Hilly profile" : "Terrain",
      value: `${Math.round(elevationDensity)} ft/mi`,
      detail: `${Math.round(elevation).toLocaleString()} ft total gain`
    }
  ];

  return {
    run,
    date: runDate,
    distance,
    pace,
    elevation,
    elevationDensity,
    load,
    loadPerMile,
    moving,
    elapsed,
    stopped,
    similarCount: similar.length,
    similarPace,
    similarHr,
    similarLoadPerMile,
    distanceRank,
    paceRank,
    loadRank,
    bucket,
    previousRun,
    nextRun,
    previousGap,
    nextGap,
    runType,
    neighboringRuns,
    priorSevenRuns,
    nextSevenRuns,
    priorSevenMiles,
    nextSevenMiles,
    priorSevenLoad,
    nextSevenLoad,
    periodDistanceShare,
    periodLoadShare,
    similarElevationDensity,
    standoutScore,
    hrCoverage,
    signals
  };
}

function statMarkup(label, value, detail = "") {
  return `<article class="workout-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function signalMarkup(signal) {
  return `<article class="workout-signal"><span>${escapeHtml(signal.label)}</span><strong>${escapeHtml(signal.value)}</strong><small>${escapeHtml(signal.detail)}</small></article>`;
}

function profileMarkup(label, percentile) {
  const value = Math.max(2, Math.min(100, Number(percentile) || 0));
  return `
    <div class="profile-row">
      <span>${escapeHtml(label)}</span>
      <div class="profile-track" aria-hidden="true"><i class="profile-fill" style="width: ${value}%"></i></div>
      <strong>${escapeHtml(formatOrdinal(percentile || 0))}</strong>
    </div>
  `;
}

function workoutNarrative(digest) {
  const headlines = {
    Race: "A performance-first effort with the needle pushed forward.",
    Quality: "Speed was the defining signal in this session.",
    Long: "Durability was the point, and the run delivered.",
    Easy: "Aerobic work without forcing the pace.",
    Steady: "Balanced volume in a controlled middle gear."
  };
  const strain = digest.similarLoadPerMile
    ? `${digest.loadPerMile > digest.similarLoadPerMile * 1.15 ? "More" : "Less"} load per mile than comparable runs.`
    : `${formatOrdinal(digest.loadRank)} percentile for total load.`;
  return {
    headline: headlines[digest.runType] || headlines.Steady,
    detail: `${formatOrdinal(digest.distanceRank)} distance percentile, ${formatOrdinal(digest.paceRank)} pace percentile. ${strain}`
  };
}

function neighboringRunsChart(digest) {
  const runs = digest.neighboringRuns;
  if (!runs.length) return "";
  const width = 640;
  const height = 170;
  const pad = { top: 28, right: 10, bottom: 34, left: 10 };
  const plotHeight = height - pad.top - pad.bottom;
  const step = (width - pad.left - pad.right) / runs.length;
  const barWidth = Math.min(52, step * 0.56);
  const maxDistance = Math.max(...runs.map((item) => miles(item.distance)), 1);
  const marks = runs.map((item, index) => {
    const distance = miles(item.distance);
    const selected = String(item.id) === String(digest.run.id);
    const barHeight = Math.max(4, (distance / maxDistance) * plotHeight);
    const x = pad.left + index * step + (step - barWidth) / 2;
    const y = pad.top + plotHeight - barHeight;
    const date = parseActivityDate(item).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    return `
      <g aria-label="${escapeHtml(`${date}: ${distance.toFixed(1)} miles at ${formatPace(paceSeconds(item))}`)}">
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3" fill="${selected ? "var(--orange)" : "var(--teal)"}" opacity="${selected ? "1" : "0.5"}"></rect>
        <text x="${(x + barWidth / 2).toFixed(1)}" y="${Math.max(14, y - 7).toFixed(1)}" text-anchor="middle" fill="var(--ink)" font-size="11" font-weight="${selected ? "800" : "600"}">${distance.toFixed(1)}</text>
        <text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 10}" text-anchor="middle" fill="var(--muted)" font-size="11">${escapeHtml(date)}</text>
      </g>
    `;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Distance across this run and its neighboring runs">${marks}</svg>`;
}

function nearbyRunText(run, gap) {
  if (!run) return "None in range";
  const prefix = gap === null ? "" : `${gap}d `;
  return `${prefix}${formatNumber(miles(run.distance), 1)} mi at ${formatPace(paceSeconds(run))}`;
}

function comparisonCellMarkup(label, current, benchmark, difference, available = true) {
  return `
    <div class="workout-compare-row" role="row">
      <strong role="rowheader">${escapeHtml(label)}</strong>
      <span role="cell">${escapeHtml(current)}</span>
      <span role="cell">${escapeHtml(available ? benchmark : "—")}</span>
      <span role="cell" class="${available ? "" : "muted"}">${escapeHtml(available ? difference : "Needs more data")}</span>
    </div>
  `;
}

function workoutComparisonMarkup(digest, averageHr) {
  const paceAvailable = Boolean(digest.similarPace);
  const hrAvailable = Boolean(averageHr && digest.similarHr);
  const loadAvailable = Boolean(digest.similarLoadPerMile);
  const elevationAvailable = Boolean(digest.similarElevationDensity);
  const paceDifference = paceAvailable ? Math.round(digest.pace - digest.similarPace) : 0;
  const hrDifference = hrAvailable ? Math.round(averageHr - digest.similarHr) : 0;
  const loadDifference = loadAvailable ? digest.loadPerMile - digest.similarLoadPerMile : 0;
  const elevationDifference = elevationAvailable ? digest.elevationDensity - digest.similarElevationDensity : 0;
  return `
    <div class="workout-compare" role="table" aria-label="Run compared with similar-distance efforts">
      <div class="workout-compare-head" role="row">
        <span role="columnheader">Metric</span><span role="columnheader">This run</span><span role="columnheader">Similar</span><span role="columnheader">Difference</span>
      </div>
      ${comparisonCellMarkup(
        "Pace",
        formatPace(digest.pace),
        formatPace(digest.similarPace),
        `${Math.abs(paceDifference)} sec ${paceDifference <= 0 ? "faster" : "slower"}`,
        paceAvailable
      )}
      ${comparisonCellMarkup(
        "Heart rate",
        averageHr ? `${Math.round(averageHr)} bpm` : "—",
        `${Math.round(digest.similarHr)} bpm`,
        `${hrDifference >= 0 ? "+" : ""}${hrDifference} bpm`,
        hrAvailable
      )}
      ${comparisonCellMarkup(
        "Load / mile",
        formatNumber(digest.loadPerMile, 1),
        formatNumber(digest.similarLoadPerMile, 1),
        `${loadDifference >= 0 ? "+" : ""}${formatNumber(loadDifference, 1)}`,
        loadAvailable
      )}
      ${comparisonCellMarkup(
        "Elevation / mile",
        `${Math.round(digest.elevationDensity)} ft`,
        `${Math.round(digest.similarElevationDensity)} ft`,
        `${elevationDifference >= 0 ? "+" : ""}${Math.round(elevationDifference)} ft`,
        elevationAvailable
      )}
    </div>
  `;
}

function buildRunInsightPayload(digest) {
  const run = digest.run;
  const summary = summarize(state.filteredRuns, state.buckets);
  const averageHr = Number(run.average_heartrate) || 0;
  const rawCadence = Number(run.average_cadence) || 0;
  const cadence = rawCadence && rawCadence < 120 ? rawCadence * 2 : rawCadence;
  const paceDifference = digest.similarPace ? Math.round(digest.pace - digest.similarPace) : 0;
  const loadDifferencePercent = digest.similarLoadPerMile
    ? Math.round(((digest.loadPerMile - digest.similarLoadPerMile) / digest.similarLoadPerMile) * 100)
    : 0;
  return {
    kind: "run",
    focus: state.activeRunFocus,
    run: {
      name: String(run.name || "Run").slice(0, 100),
      date: localDateValue(digest.date),
      runType: digest.runType,
      distanceMiles: Number(digest.distance.toFixed(2)),
      paceSecondsPerMile: Math.round(digest.pace),
      movingMinutes: Math.round(digest.moving / 60),
      stoppedMinutes: Math.round(digest.stopped / 60),
      elevationFeet: Math.round(digest.elevation),
      elevationFeetPerMile: Math.round(digest.elevationDensity),
      averageHr: averageHr ? Math.round(averageHr) : null,
      maxHr: run.max_heartrate ? Math.round(run.max_heartrate) : null,
      trainingLoad: Math.round(digest.load),
      loadPerMile: Number(digest.loadPerMile.toFixed(1)),
      cadenceSpm: cadence ? Math.round(cadence) : null
    },
    comparison: {
      distancePercentile: digest.distanceRank,
      pacePercentile: digest.paceRank,
      loadPercentile: digest.loadRank,
      similarRunCount: digest.similarCount,
      similarPaceSecondsPerMile: digest.similarPace ? Math.round(digest.similarPace) : null,
      paceDifferenceSeconds: digest.similarPace ? paceDifference : null,
      similarAverageHr: digest.similarHr ? Math.round(digest.similarHr) : null,
      heartRateDifference: averageHr && digest.similarHr ? Math.round(averageHr - digest.similarHr) : null,
      similarLoadPerMile: digest.similarLoadPerMile ? Number(digest.similarLoadPerMile.toFixed(1)) : null,
      loadPerMileDifferencePercent: digest.similarLoadPerMile ? loadDifferencePercent : null,
      daysSincePreviousRun: digest.previousGap,
      daysUntilNextRun: digest.nextGap,
      similarElevationFeetPerMile: digest.similarElevationDensity ? Math.round(digest.similarElevationDensity) : null
    },
    baseline: {
      runCount: summary.runCount,
      averageRunMiles: Number(summary.averageRunMiles.toFixed(1)),
      averagePaceSecondsPerMile: Math.round(summary.averagePace),
      averageHr: summary.averageHr ? Math.round(summary.averageHr) : null,
      averageLoadPerMile: Number(summary.averageLoadPerMile.toFixed(1))
    },
    context: {
      priorSevenRunCount: digest.priorSevenRuns.length,
      priorSevenMiles: Number(digest.priorSevenMiles.toFixed(1)),
      priorSevenLoad: Math.round(digest.priorSevenLoad),
      nextSevenRunCount: digest.nextSevenRuns.length,
      nextSevenMiles: Number(digest.nextSevenMiles.toFixed(1)),
      nextSevenLoad: Math.round(digest.nextSevenLoad),
      periodDistanceSharePercent: Math.round(digest.periodDistanceShare * 100),
      periodLoadSharePercent: Math.round(digest.periodLoadShare * 100),
      standoutScore: digest.standoutScore
    },
    coverage: {
      similarRunCount: digest.similarCount,
      similarHeartRatePercent: digest.hrCoverage,
      directLoad: Number(run.suffer_score) > 0,
      hasPreviousRun: Boolean(digest.previousRun),
      hasNextRun: Boolean(digest.nextRun)
    }
  };
}

function runInsightLoadingMarkup() {
  return `
    <div class="workout-ai-loading" aria-busy="true">
      <span class="workout-ai-pulse" aria-hidden="true"></span>
      <div>
        <strong>Reading this effort in context…</strong>
        <p>Comparing it with similar-distance runs and your selected-window baseline.</p>
      </div>
    </div>
  `;
}

function renderRunInsightResult(result) {
  const content = document.querySelector("#workoutAiContent");
  if (!content) return;
  const insight = result.insight;
  const model = document.querySelector("#workoutAiModel");
  if (model) model.textContent = result.model || "qwen3.5:0.8b";
  content.innerHTML = `
    <div class="workout-ai-result">
      <h4>${escapeHtml(insight.headline)}</h4>
      <p class="workout-ai-read">${escapeHtml(insight.read)}</p>
      <div class="workout-ai-evidence">
        <span>Evidence: ${escapeHtml(insight.answerability || "Partial")}</span>
        <span>Confidence: ${escapeHtml(insight.confidence || "Medium")}</span>
        ${insight.limitation ? `<span>${escapeHtml(insight.limitation)}</span>` : ""}
      </div>
      <div class="workout-ai-signals">
        ${insight.signals.map((signal) => `
          <article class="workout-ai-signal ${escapeHtml(signal.tone)}">
            <span>${escapeHtml(signal.title)}</span>
            <p>${escapeHtml(signal.detail)}</p>
          </article>
        `).join("")}
      </div>
      <div class="workout-ai-next">
        <span>Watch on the next similar run</span>
        <p>${escapeHtml(insight.watchNext)}</p>
      </div>
      <small>${escapeHtml(insight.caution)}</small>
    </div>
  `;
}

function renderRunInsightError(message, runId) {
  const content = document.querySelector("#workoutAiContent");
  if (!content) return;
  content.innerHTML = `
    <div class="workout-ai-error">
      <div>
        <strong>The run read did not finish.</strong>
        <p>${escapeHtml(message)}</p>
      </div>
      <button class="workout-ai-retry" type="button" data-action="retry-run-insight" data-run-id="${escapeHtml(runId)}">Try again</button>
    </div>
  `;
}

async function requestRunInsight(digest, { force = false } = {}) {
  const key = `${digest.run.id}:${state.insightFingerprint}:${state.activeRunFocus}`;
  state.activeRunInsightKey = key;
  const cached = state.runInsightCache.get(key);
  if (cached && !force) {
    renderRunInsightResult(cached);
    return;
  }
  state.runInsightAbort?.abort();
  const controller = new AbortController();
  state.runInsightAbort = controller;
  const content = document.querySelector("#workoutAiContent");
  if (content) content.innerHTML = runInsightLoadingMarkup();
  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRunInsightPayload(digest)),
      signal: controller.signal
    });
    const data = await readApiJson(response);
    if (!response.ok) throw new Error(data.error || "Unable to generate this run read.");
    if (state.activeRunInsightKey !== key || els.workoutModal.hidden) return;
    state.runInsightCache.set(key, data);
    renderRunInsightResult(data);
  } catch (error) {
    if (error.name === "AbortError" || state.activeRunInsightKey !== key || els.workoutModal.hidden) return;
    renderRunInsightError(error.message, digest.run.id);
  } finally {
    if (state.runInsightAbort === controller) state.runInsightAbort = null;
  }
}

function showWorkoutModal(runId, trigger = document.activeElement) {
  const run = state.filteredRuns.find((candidate) => String(candidate.id) === String(runId));
  if (!run) return;
  const modalWasHidden = els.workoutModal.hidden;
  const runChanged = state.activeRunId !== String(run.id);
  if (modalWasHidden && trigger instanceof HTMLElement && !els.workoutModal.contains(trigger)) {
    state.modalTrigger = trigger;
  }
  if (modalWasHidden || runChanged) state.activeRunFocus = "balanced";
  state.activeRunId = String(run.id);
  const digest = buildWorkoutDigest(run);
  const narrative = workoutNarrative(digest);
  const averageHr = Number(run.average_heartrate) || 0;
  const maxHr = Number(run.max_heartrate) || 0;
  const rawCadence = Number(run.average_cadence) || 0;
  const cadence = rawCadence && rawCadence < 120 ? rawCadence * 2 : rawCadence;
  const watts = Number(run.average_watts) || 0;
  const maxSpeedPace = run.max_speed ? formatPace(1609.344 / run.max_speed) : "-";
  const bucketLabelText = digest.bucket ? `${digest.bucket.label}: ${digest.bucket.distanceMiles.toFixed(1)} mi, ${digest.bucket.runs} runs` : "No group context";
  const similarPaceText = digest.similarPace ? `${formatPace(digest.similarPace)} across ${digest.similarCount} similar` : "Needs more similar runs";
  const hrCompare = averageHr && digest.similarHr ? `${Math.round(averageHr - digest.similarHr) >= 0 ? "+" : ""}${Math.round(averageHr - digest.similarHr)} bpm vs similar` : "HR comparison unavailable";
  const socialText = `${run.kudos_count || 0} kudos · ${run.achievement_count || 0} achievements · ${run.pr_count || 0} PRs`;

  els.workoutModalContent.innerHTML = `
    <header class="workout-header">
      <p class="workout-kicker">${escapeHtml(digest.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" }))}</p>
      <h2 id="workoutModalTitle">${escapeHtml(run.name)}</h2>
      <div class="workout-header-meta">
        <span class="workout-type">${escapeHtml(digest.runType)} run</span>
        <span id="workoutModalMeta">${escapeHtml(bucketLabelText)}</span>
        <span>${escapeHtml(socialText)}</span>
      </div>
      <nav class="workout-run-nav" aria-label="Browse workouts">
        <button type="button" data-action="navigate-run" data-run-id="${escapeHtml(digest.previousRun?.id || "")}" ${digest.previousRun ? "" : "disabled"}>
          <span aria-hidden="true">←</span>
          <small>Older</small>
          <strong>${escapeHtml(digest.previousRun?.name || "Start of range")}</strong>
        </button>
        <button type="button" data-action="navigate-run" data-run-id="${escapeHtml(digest.nextRun?.id || "")}" ${digest.nextRun ? "" : "disabled"}>
          <small>Newer</small>
          <strong>${escapeHtml(digest.nextRun?.name || "End of range")}</strong>
          <span aria-hidden="true">→</span>
        </button>
      </nav>
    </header>
    <div class="workout-body">
      <section class="workout-lead" aria-label="Workout summary">
        <div class="workout-lead-metrics">
          <article class="workout-lead-metric"><span>Distance</span><strong>${digest.distance.toFixed(2)} mi</strong><small>${formatOrdinal(digest.distanceRank)} percentile</small></article>
          <article class="workout-lead-metric"><span>Average pace</span><strong>${escapeHtml(formatPace(digest.pace))}</strong><small>${escapeHtml(similarPaceText)}</small></article>
          <article class="workout-lead-metric"><span>Moving time</span><strong>${escapeHtml(formatDuration(digest.moving))}</strong><small>${digest.stopped ? `${escapeHtml(formatDuration(digest.stopped))} stopped` : "Continuous effort"}</small></article>
        </div>
        <aside class="workout-read">
          <span>Quick read</span>
          <strong>${escapeHtml(narrative.headline)}</strong>
          <p>${escapeHtml(narrative.detail)}</p>
          <div class="workout-standout" style="--score: ${digest.standoutScore}%"><span>${digest.standoutScore}% standout from the middle of this window</span></div>
        </aside>
      </section>
      <section class="workout-context-strip" aria-label="Training context around this run">
        <article>
          <span>7 days before</span>
          <strong>${digest.priorSevenMiles.toFixed(1)} mi</strong>
          <small>${digest.priorSevenRuns.length} runs · ${Math.round(digest.priorSevenLoad)} load</small>
        </article>
        <article>
          <span>Period contribution</span>
          <strong>${Math.round(digest.periodDistanceShare * 100)}% mileage</strong>
          <small>${Math.round(digest.periodLoadShare * 100)}% of grouped load</small>
        </article>
        <article>
          <span>7 days after</span>
          <strong>${digest.nextSevenMiles.toFixed(1)} mi</strong>
          <small>${digest.nextSevenRuns.length} runs · ${Math.round(digest.nextSevenLoad)} load</small>
        </article>
        <article>
          <span>Benchmark depth</span>
          <strong>${digest.similarCount} similar</strong>
          <small>${digest.hrCoverage}% include heart rate</small>
        </article>
      </section>
      <section class="workout-ai" aria-labelledby="workoutAiTitle">
        <div class="workout-ai-heading">
          <div>
            <p class="workout-ai-kicker"><span class="ai-status-dot" aria-hidden="true"></span> Ollama run read</p>
            <h3 id="workoutAiTitle">A second look at this effort.</h3>
          </div>
          <span id="workoutAiModel">qwen3.5:0.8b</span>
        </div>
        <div class="workout-ai-focus" role="group" aria-label="Run analysis focus">
          <button type="button" data-action="run-focus" data-focus="balanced" aria-pressed="true">Overall</button>
          <button type="button" data-action="run-focus" data-focus="standout" aria-pressed="false">Why it stands out</button>
          <button type="button" data-action="run-focus" data-focus="load" aria-pressed="false">Load</button>
          <button type="button" data-action="run-focus" data-focus="spacing" aria-pressed="false">Spacing</button>
        </div>
        <div id="workoutAiContent" class="workout-ai-content" aria-live="polite">${runInsightLoadingMarkup()}</div>
      </section>
      <div class="workout-grid">
        <div>
          <section class="workout-section">
            <div class="workout-section-heading"><h3>Effort profile</h3><span>Percentile within selected range</span></div>
            <div class="effort-profile">
              ${profileMarkup("Distance", digest.distanceRank)}
              ${profileMarkup("Pace", digest.paceRank)}
              ${profileMarkup("Load", digest.loadRank)}
            </div>
          </section>
          <section class="workout-section">
            <div class="workout-section-heading"><h3>Like-for-like comparison</h3><span>${digest.similarCount} runs within ±20% distance</span></div>
            ${workoutComparisonMarkup(digest, averageHr)}
          </section>
          <section class="workout-section">
            <div class="workout-section-heading"><h3>Neighboring runs</h3><span>Miles · selected run in orange</span></div>
            <div class="neighbor-chart">${neighboringRunsChart(digest)}</div>
          </section>
          <section class="workout-section">
            <h3>Signals</h3>
            <div class="workout-signals">${digest.signals.map(signalMarkup).join("")}</div>
          </section>
        </div>
        <aside>
          <section class="workout-section">
            <h3>Run details</h3>
            <div class="workout-stats">
              ${statMarkup("Elevation", `${Math.round(digest.elevation).toLocaleString()} ft`, `${Math.round(digest.elevationDensity)} ft/mi`)}
              ${statMarkup("Heart rate", averageHr ? `${Math.round(averageHr)} bpm` : "-", maxHr ? `Max ${Math.round(maxHr)} bpm` : hrCompare)}
              ${statMarkup("Training load", `${Math.round(digest.load).toLocaleString()}`, `${formatNumber(digest.loadPerMile, 1)} per mile`)}
              ${statMarkup("Cadence", cadence ? `${Math.round(cadence)} spm` : "-", watts ? `${Math.round(watts)} avg watts` : "From activity data")}
              ${statMarkup("Top speed", maxSpeedPace, run.pr_count ? `${run.pr_count} personal record${run.pr_count === 1 ? "" : "s"}` : "No PR recorded")}
              ${statMarkup("Elapsed time", formatDuration(digest.elapsed), digest.stopped ? `${formatDuration(digest.stopped)} not moving` : "Matches moving time")}
            </div>
          </section>
          <section class="workout-section">
            <h3>Context</h3>
            <dl class="context-list">
              <dt>Benchmark</dt><dd>${escapeHtml(similarPaceText)}</dd>
              <dt>Heart rate</dt><dd>${escapeHtml(hrCompare)}</dd>
              <dt>Previous</dt><dd>${escapeHtml(nearbyRunText(digest.previousRun, digest.previousGap))}</dd>
              <dt>Next</dt><dd>${escapeHtml(nearbyRunText(digest.nextRun, digest.nextGap))}</dd>
              <dt>Period share</dt><dd>${Math.round(digest.periodDistanceShare * 100)}% mileage · ${Math.round(digest.periodLoadShare * 100)}% load</dd>
              <dt>Evidence depth</dt><dd>${digest.similarCount} similar runs · ${digest.hrCoverage}% HR coverage</dd>
              <dt>Device</dt><dd>${escapeHtml(run.device_name || "Not included in activity data")}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  `;
  els.workoutModal.hidden = false;
  document.body.classList.add("modal-open");
  els.workoutModal.querySelector(".workout-modal").scrollTop = 0;
  els.workoutModalClose.focus();
  requestRunInsight(digest);
}

function closeWorkoutModal() {
  state.runInsightAbort?.abort();
  state.runInsightAbort = null;
  state.activeRunInsightKey = "";
  state.activeRunId = "";
  state.activeRunFocus = "balanced";
  els.workoutModal.hidden = true;
  document.body.classList.remove("modal-open");
  els.workoutModalContent.replaceChildren();
  if (state.modalTrigger?.isConnected) state.modalTrigger.focus();
  state.modalTrigger = null;
}

function activityRunTypes(runs) {
  const distances = runs.map((run) => miles(run.distance));
  const paces = runs.map(paceSeconds);
  return new Map(runs.map((run) => {
    const distance = miles(run.distance);
    const pace = paceSeconds(run);
    return [
      String(run.id),
      classifyRun(
        run,
        distance,
        pace,
        percentileRank(distances, distance, true),
        percentileRank(paces, pace, false)
      )
    ];
  }));
}

function renderTable() {
  const types = activityRunTypes(state.filteredRuns);
  const query = els.activitySearch.value.trim().toLowerCase();
  const selectedType = els.activityType.value;
  const sort = els.activitySort.value;
  const matching = state.filteredRuns.filter((run) => {
    const type = types.get(String(run.id));
    if (selectedType !== "all" && type !== selectedType) return false;
    if (!query) return true;
    const date = parseActivityDate(run);
    const searchable = [
      run.name,
      type,
      date.toLocaleDateString(),
      date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    ].join(" ").toLowerCase();
    return searchable.includes(query);
  }).sort((left, right) => {
    if (sort === "distance") return miles(right.distance) - miles(left.distance);
    if (sort === "pace") return paceSeconds(left) - paceSeconds(right);
    if (sort === "load") return activityLoad(right) - activityLoad(left);
    return parseActivityDate(right) - parseActivityDate(left);
  });
  const visible = matching.slice(0, state.activityVisible);
  els.activityCount.textContent = matching.length === state.filteredRuns.length
    ? `${matching.length} runs in range`
    : `${matching.length} of ${state.filteredRuns.length} runs`;
  els.loadMoreRuns.hidden = visible.length >= matching.length;
  els.loadMoreRuns.textContent = `Show ${Math.min(15, matching.length - visible.length)} more runs`;

  if (!visible.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.className = "run-browser-empty";
    cell.textContent = state.filteredRuns.length ? "No runs match these filters." : "Load running data to browse workouts.";
    row.append(cell);
    els.activityRows.replaceChildren(row);
    return;
  }

  els.activityRows.replaceChildren(...visible.map((run) => {
    const row = document.createElement("tr");
    row.className = "activity-row";
    row.dataset.activityId = run.id;
    row.title = "Open workout details";
    const actionCell = document.createElement("td");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "row-detail-button";
    action.dataset.activityId = run.id;
    action.setAttribute("aria-label", `Open details for ${run.name}`);
    action.textContent = "→";
    actionCell.appendChild(action);
    row.appendChild(actionCell);

    const dateCell = document.createElement("td");
    dateCell.textContent = parseActivityDate(run).toLocaleDateString();
    const nameCell = document.createElement("td");
    nameCell.className = "run-name-cell";
    const name = document.createElement("strong");
    const type = document.createElement("small");
    name.textContent = run.name;
    type.textContent = `${types.get(String(run.id))} run`;
    nameCell.append(name, type);
    row.append(dateCell, nameCell);

    [
      `${miles(run.distance).toFixed(2)} mi`,
      formatPace(paceSeconds(run)),
      `${Math.round(feet(run.total_elevation_gain)).toLocaleString()} ft`,
      run.average_heartrate ? `${Math.round(run.average_heartrate)} bpm` : "-",
      `${Math.round(run.suffer_score || runMinutes(run) * effortMultiplier(run))}`
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      showWorkoutModal(run.id, action);
    });
    return row;
  }));
}

function resetRunBrowser() {
  els.activitySearch.value = "";
  els.activityType.value = "all";
  els.activitySort.value = "newest";
  state.activityVisible = 15;
}

async function fetchActivities() {
  setStatus("Pulling activities from Strava...");
  const { start, end } = getRangeDates();
  const params = new URLSearchParams({ pages: "8", per_page: "100" });
  if (start) {
    const comparison = comparisonWindow(start, end);
    const fetchStart = comparison.start && comparison.start < start ? comparison.start : start;
    params.set("after", Math.floor(fetchStart.getTime() / 1000));
  }
  if (end) params.set("before", Math.floor(end.getTime() / 1000));
  const response = await fetch(`/api/activities?${params}`);
  const data = await readApiJson(response);
  if (!response.ok) throw new Error(data.error || "Unable to fetch Strava activities.");
  state.rawActivities = data.activities;
  state.dataSource = "Strava";
  resetRunBrowser();
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
    state.stravaReady = false;
    state.stravaConnected = false;
    state.stravaError = data.error || "Unable to reach the Strava API route.";
    els.connectButton.disabled = false;
    els.connectButton.textContent = "Connect Strava";
    els.connectButton.title = state.stravaError;
    setStatus(state.stravaError, true);
    return;
  }
  if (!data.configured) {
    state.stravaReady = false;
    state.stravaConnected = false;
    state.stravaError = data.error || "Add Strava credentials before connecting.";
    els.connectButton.disabled = false;
    els.connectButton.textContent = "Connect Strava";
    els.connectButton.title = state.stravaError;
    setStatus(`${state.stravaError} You can still import an export file or use demo data.`, true);
    return;
  }
  state.stravaReady = true;
  state.stravaConnected = Boolean(data.connected);
  state.stravaError = "";
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
  state.dataSource = "Import";
  resetRunBrowser();
  syncRangeInputs();
  setStatus(`Imported ${state.rawActivities.length} activities.`);
  render();
}

function makeDemoData() {
  const activities = [];
  const today = new Date();
  const historyDays = 760;
  let seed = 20260727;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < historyDays; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    if (![1, 3, 5, 6].includes(date.getDay()) || random() < 0.16) continue;
    const longRun = date.getDay() === 6;
    const baseMiles = longRun ? 8 + random() * 7 : 3 + random() * 5;
    const trend = 1 + (historyDays - i) / 1800;
    const distanceMiles = baseMiles * trend;
    const pace = 530 - (historyDays - i) * 0.08 + random() * 45;
    const hr = 136 + random() * 24 + (longRun ? 4 : 0);
    const movingTime = Math.round(distanceMiles * pace);
    activities.push({
      id: `demo-${i}`,
      name: longRun ? "Long run" : ["Easy run", "Workout", "Steady run"][Math.floor(random() * 3)],
      sport_type: "Run",
      start_date_local: date.toISOString(),
      distance: distanceMiles * 1609.344,
      moving_time: movingTime,
      elapsed_time: movingTime + Math.round(random() * 180),
      total_elevation_gain: (40 + random() * 95) * distanceMiles / 3.28084,
      average_heartrate: Math.round(hr),
      max_heartrate: Math.round(hr + 18 + random() * 18),
      average_cadence: Math.round(160 + random() * 18),
      max_speed: 1609.344 / Math.max(300, pace - 75 - random() * 30),
      suffer_score: Math.round(distanceMiles * (hr / 18)),
      kudos_count: Math.floor(random() * 18),
      achievement_count: random() > 0.78 ? Math.ceil(random() * 4) : 0,
      pr_count: random() > 0.9 ? 1 : 0
    });
  }
  return activities;
}

els.connectButton.addEventListener("click", () => {
  if (!state.stravaReady) {
    setStatus(state.stravaError || "Strava is not configured yet.", true);
    if (!state.stravaError) window.location.href = "/auth/login";
  } else if (state.stravaConnected || els.connectButton.textContent.includes("Refresh")) {
    fetchActivities().catch((error) => setStatus(error.message, true));
  } else {
    window.location.href = "/auth/login";
  }
});

els.demoButton.addEventListener("click", () => {
  state.rawActivities = makeDemoData();
  state.dataSource = "Demo";
  resetRunBrowser();
  syncRangeInputs();
  setStatus("Loaded demo running history.");
  render();
});

els.aiAnalyzeButton.addEventListener("click", analyzeWithOllama);

document.querySelector(".metric-switcher").addEventListener("click", (event) => {
  const button = event.target.closest("[data-metric]");
  if (!button) return;
  els.metricSelect.value = button.dataset.metric;
  renderMainChart();
  syncViewUrl();
});

document.querySelector(".ai-prompt-chips").addEventListener("click", (event) => {
  const button = event.target.closest("[data-question]");
  if (!button) return;
  els.aiFocus.value = button.dataset.focus || "balanced";
  els.aiQuestion.value = button.dataset.question;
  invalidateAiInsight();
  els.aiAnalyzeButton.focus();
});

function invalidateAiInsight() {
  state.insightFingerprint = currentInsightFingerprint();
  state.renderedInsightFingerprint = "";
  renderAiState();
}

function refreshRangeView() {
  if (state.dataSource === "Strava") {
    fetchActivities().catch((error) => setStatus(error.message, true));
    return;
  }
  render();
}

els.aiFocus.addEventListener("change", invalidateAiInsight);
els.aiQuestion.addEventListener("input", invalidateAiInsight);

els.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importFile(file).catch((error) => setStatus(error.message, true));
});

els.activityRows.addEventListener("click", (event) => {
  const button = event.target.closest(".row-detail-button");
  if (button) showWorkoutModal(button.dataset.activityId, button);
});

els.workoutModalContent.addEventListener("click", (event) => {
  const focusButton = event.target.closest("[data-action='run-focus']");
  if (focusButton?.dataset.focus) {
    state.activeRunFocus = focusButton.dataset.focus;
    els.workoutModalContent.querySelectorAll("[data-action='run-focus']").forEach((button) => {
      button.setAttribute("aria-pressed", String(button === focusButton));
    });
    const run = state.filteredRuns.find((candidate) => String(candidate.id) === state.activeRunId);
    if (run) requestRunInsight(buildWorkoutDigest(run));
    return;
  }
  const navigate = event.target.closest("[data-action='navigate-run']");
  if (navigate?.dataset.runId) {
    showWorkoutModal(navigate.dataset.runId, state.modalTrigger);
    return;
  }
  const retry = event.target.closest("[data-action='retry-run-insight']");
  if (!retry) return;
  const run = state.filteredRuns.find((candidate) => String(candidate.id) === String(retry.dataset.runId));
  if (run) requestRunInsight(buildWorkoutDigest(run), { force: true });
});

els.workoutModalClose.addEventListener("click", closeWorkoutModal);

els.workoutModal.addEventListener("click", (event) => {
  if (event.target === els.workoutModal) closeWorkoutModal();
});

document.addEventListener("keydown", (event) => {
  if (els.workoutModal.hidden) return;
  if (event.key === "Escape") closeWorkoutModal();
  if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.target.closest("input, textarea, select")) {
    const runs = [...state.filteredRuns].sort((left, right) => parseActivityDate(left) - parseActivityDate(right));
    const index = runs.findIndex((run) => String(run.id) === state.activeRunId);
    const target = event.key === "ArrowLeft" ? runs[index - 1] : runs[index + 1];
    if (target) {
      event.preventDefault();
      showWorkoutModal(target.id, state.modalTrigger);
    }
  }
  if (event.key === "Tab") {
    const focusable = [els.workoutModalClose, ...els.workoutModalContent.querySelectorAll("button, a, input, select, textarea")]
      .filter((element) => !element.disabled && element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

els.rangeSelect.addEventListener("change", () => {
  state.activityVisible = 15;
  syncRangeInputs();
  refreshRangeView();
});

els.rangePresetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activityVisible = 15;
    els.rangeSelect.value = button.dataset.range;
    els.customRangePanel.hidden = true;
    els.customRangeToggle.setAttribute("aria-expanded", "false");
    syncRangeInputs();
    refreshRangeView();
  });
});

els.customRangeToggle.addEventListener("click", () => {
  const opening = els.customRangePanel.hidden;
  els.customRangePanel.hidden = !opening;
  els.customRangeToggle.setAttribute("aria-expanded", String(opening));
  if (opening) {
    els.rangeSelect.value = "custom";
    syncRangeInputs();
    const { start, end } = getRangeDates();
    syncRangeControlState(start, end);
    els.startDate.focus();
  }
});

[els.startDate, els.endDate].forEach((element) => {
  element.addEventListener("change", () => {
    state.activityVisible = 15;
    els.rangeSelect.value = "custom";
    if (els.startDate.value && els.endDate.value && els.startDate.value > els.endDate.value) {
      if (element === els.startDate) els.endDate.value = els.startDate.value;
      else els.startDate.value = els.endDate.value;
    }
    refreshRangeView();
  });
});

els.comparisonSelect.addEventListener("change", () => {
  state.activityVisible = 15;
  refreshRangeView();
});

els.bucketSelect.addEventListener("change", render);
els.metricSelect.addEventListener("change", () => {
  renderMainChart();
  syncViewUrl();
});

els.copyViewButton.addEventListener("click", async () => {
  syncViewUrl();
  try {
    await navigator.clipboard.writeText(window.location.href);
    const original = els.copyViewButton.textContent;
    els.copyViewButton.textContent = "Copied";
    setStatus("Copied a link to this training view.");
    window.setTimeout(() => {
      els.copyViewButton.textContent = original;
    }, 1800);
  } catch {
    setStatus(`Copy this view: ${window.location.href}`);
  }
});

els.activitySearch.addEventListener("input", () => {
  state.activityVisible = 15;
  renderTable();
});

[els.activityType, els.activitySort].forEach((element) => {
  element.addEventListener("change", () => {
    state.activityVisible = 15;
    renderTable();
  });
});

els.loadMoreRuns.addEventListener("click", () => {
  state.activityVisible += 15;
  renderTable();
});

function setupSectionNavigation() {
  const links = [...document.querySelectorAll("[data-section-link]")];
  const sections = links
    .map((link) => document.querySelector(`#${link.dataset.sectionLink}`))
    .filter(Boolean);
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
    if (!visible) return;
    links.forEach((link) => {
      if (link.dataset.sectionLink === visible.target.id) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }, { rootMargin: "-18% 0px -66% 0px", threshold: [0, 0.15, 0.4] });
  sections.forEach((section) => observer.observe(section));
}

checkStatus().catch((error) => setStatus(error.message, true));
restoreViewFromUrl();
syncRangeInputs();
bindTooltips();
setupSectionNavigation();
render();
