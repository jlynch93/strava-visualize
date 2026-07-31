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
  focusedBucketKey: "",
  insightFingerprint: "",
  renderedInsightFingerprint: "",
  runInsightCache: new Map(),
  runInsightAbort: null,
  runWeatherCache: new Map(),
  runWeatherAbort: null,
  runRouteCache: new Map(),
  runRouteAbort: null,
  funWeatherAbort: null,
  funWeatherFingerprint: "",
  funWeatherActiveFingerprint: "",
  funWeatherCompletedFingerprint: "",
  funWeatherSampleKeys: [],
  funWeatherEligibleCount: 0,
  workoutMap: null,
  activeRunInsightKey: "",
  activeRunId: "",
  activeRunFocus: "balanced",
  dataSource: "No data",
  activityAbort: null,
  activityRequestId: 0,
  activityTruncated: false,
  activityVisible: 15
};

const els = {
  connectButton: document.querySelector("#connectButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
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
  exportViewButton: document.querySelector("#exportViewButton"),
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
  funStatsSubtitle: document.querySelector("#funStatsSubtitle"),
  funStatsGrid: document.querySelector("#funStatsGrid"),
  mainChartTitle: document.querySelector("#mainChartTitle"),
  mainChartSubtitle: document.querySelector("#mainChartSubtitle"),
  mainChart: document.querySelector("#mainChart"),
  trainingArcChart: document.querySelector("#trainingArcChart"),
  trainingArcInsight: document.querySelector("#trainingArcInsight"),
  trainingArcInsightTitle: document.querySelector("#trainingArcInsightTitle"),
  trainingArcInsightText: document.querySelector("#trainingArcInsightText"),
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

function normalizedFieldKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readActivityField(activity, aliases) {
  const entries = Object.entries(activity || {});
  for (const alias of aliases) {
    const exact = entries.find(([key]) => key === alias);
    if (exact && exact[1] !== null && exact[1] !== undefined && exact[1] !== "") return exact[1];
  }
  const wanted = aliases.map(normalizedFieldKey);
  const loose = entries.find(([key, value]) => wanted.includes(normalizedFieldKey(key)) && value !== null && value !== undefined && value !== "");
  return loose ? loose[1] : null;
}

function hasActivityField(activity, aliases) {
  const wanted = aliases.map(normalizedFieldKey);
  return Object.keys(activity || {}).some((key) => wanted.includes(normalizedFieldKey(key)));
}

function numericActivityValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationActivityValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (!text.includes(":")) return numericActivityValue(text);
  const parts = text.split(":").map((part) => numericActivityValue(part));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function stableActivityId(activity, index) {
  const explicit = readActivityField(activity, ["id", "Activity ID", "activity_id"]);
  if (explicit !== null) return String(explicit);
  const fingerprint = [
    readActivityField(activity, ["start_date_local", "start_date", "Activity Date"]),
    readActivityField(activity, ["name", "Activity Name"]),
    readActivityField(activity, ["distance", "Distance"]),
    readActivityField(activity, ["moving_time", "Moving Time"]),
    index
  ].join("|");
  let hash = 2166136261;
  for (const character of fingerprint) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `activity-${index}-${(hash >>> 0).toString(36)}`;
}

function normalizeActivity(activity, index = 0) {
  const point = (value) => {
    if (!Array.isArray(value) || value.length < 2) return [];
    const latitude = Number(value[0]);
    const longitude = Number(value[1]);
    return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
      && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
      ? [latitude, longitude]
      : [];
  };
  const isStravaExport = hasActivityField(activity, ["Activity Date", "Activity Name", "Activity Type"]);
  const distanceValue = numericActivityValue(readActivityField(activity, ["distance", "Distance"]));
  const elevationValue = numericActivityValue(readActivityField(activity, ["total_elevation_gain", "Elevation Gain"]));
  const maxSpeedValue = numericActivityValue(readActivityField(activity, ["max_speed", "Max Speed"]));
  const startLat = numericActivityValue(readActivityField(activity, ["start_latitude", "Start Latitude"]));
  const startLng = numericActivityValue(readActivityField(activity, ["start_longitude", "Start Longitude"]));
  const apiPoint = readActivityField(activity, ["start_latlng"]);
  const exportPoint = startLat || startLng ? [startLat, startLng] : [];
  const parsedApiPoint = point(apiPoint);
  return {
    id: stableActivityId(activity, index),
    name: readActivityField(activity, ["name", "Activity Name"]) || "Untitled run",
    sport_type: readActivityField(activity, ["sport_type", "type", "Activity Type"]) || "Run",
    start_date: readActivityField(activity, ["start_date", "start_date_local", "Activity Date"]),
    start_date_local: readActivityField(activity, ["start_date_local", "start_date", "Activity Date"]),
    distance: isStravaExport ? distanceValue * 1609.344 : distanceValue,
    moving_time: durationActivityValue(readActivityField(activity, ["moving_time", "Moving Time", "elapsed_time"])),
    elapsed_time: durationActivityValue(readActivityField(activity, ["elapsed_time", "Elapsed Time", "moving_time"])),
    total_elevation_gain: isStravaExport ? elevationValue / 3.28084 : elevationValue,
    average_heartrate: numericActivityValue(readActivityField(activity, ["average_heartrate", "Average Heart Rate"])),
    max_heartrate: numericActivityValue(readActivityField(activity, ["max_heartrate", "Max Heart Rate"])),
    average_cadence: numericActivityValue(readActivityField(activity, ["average_cadence", "Average Cadence"])),
    average_watts: numericActivityValue(readActivityField(activity, ["average_watts", "Average Watts"])),
    max_speed: isStravaExport ? maxSpeedValue * 0.44704 : maxSpeedValue,
    suffer_score: numericActivityValue(readActivityField(activity, ["suffer_score", "Relative Effort"])),
    kudos_count: numericActivityValue(readActivityField(activity, ["kudos_count", "Kudos"])),
    achievement_count: numericActivityValue(readActivityField(activity, ["achievement_count", "Achievements"])),
    pr_count: numericActivityValue(readActivityField(activity, ["pr_count", "PRs"])),
    workout_type: numericActivityValue(readActivityField(activity, ["workout_type", "Workout Type"])),
    device_name: readActivityField(activity, ["device_name", "Device Name"]) || "",
    description: readActivityField(activity, ["description", "Description"]) || "",
    start_latlng: parsedApiPoint.length ? parsedApiPoint : point(exportPoint),
    end_latlng: point(readActivityField(activity, ["end_latlng"])),
    route_points: Array.isArray(activity.route_points) ? activity.route_points.map(point).filter((candidate) => candidate.length === 2) : [],
    map: {
      polyline: String(activity.map?.polyline || activity.polyline || ""),
      summary_polyline: String(activity.map?.summary_polyline || activity.summary_polyline || "")
    }
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

function getStravaFetchRange() {
  const mode = els.rangeSelect.value;
  if (mode === "all") return { start: null, end: null };
  if (mode === "custom") {
    const { start, end } = getRangeDates();
    const comparison = comparisonWindow(start, end);
    return {
      start: comparison.start && comparison.start < start ? comparison.start : start,
      end
    };
  }
  const days = Number(mode) || 56;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  const comparison = comparisonWindow(start, end);
  return {
    start: comparison.start && comparison.start < start ? comparison.start : start,
    end
  };
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
  const search = params.get("q");
  const type = params.get("type");
  const sort = params.get("sort");
  if (["28", "56", "84", "180", "365", "all", "custom"].includes(range)) els.rangeSelect.value = range;
  if (["previous", "year", "off"].includes(comparison)) els.comparisonSelect.value = comparison;
  if (["auto", "week", "month"].includes(grouping)) els.bucketSelect.value = grouping;
  if (METRICS[metric]) els.metricSelect.value = metric;
  if (search) els.activitySearch.value = search.slice(0, 120);
  if (["all", "Quality", "Long", "Easy", "Steady", "Race"].includes(type)) els.activityType.value = type;
  if (["newest", "distance", "pace", "load"].includes(sort)) els.activitySort.value = sort;
  if (range === "custom") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("start") || "")) els.startDate.value = params.get("start");
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("end") || "")) els.endDate.value = params.get("end");
    els.customRangePanel.hidden = false;
  }
  if (params.get("source") === "demo") {
    state.rawActivities = makeDemoData();
    state.dataSource = "Demo";
  }
  if (params.has("connected") || params.has("disconnected")) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("connected");
    cleanUrl.searchParams.delete("disconnected");
    window.history.replaceState(null, "", cleanUrl);
  }
}

function syncViewUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("range", els.rangeSelect.value);
  url.searchParams.set("compare", els.comparisonSelect.value);
  url.searchParams.set("group", els.bucketSelect.value);
  url.searchParams.set("metric", els.metricSelect.value);
  if (els.activitySearch.value.trim()) url.searchParams.set("q", els.activitySearch.value.trim().slice(0, 120));
  else url.searchParams.delete("q");
  if (els.activityType.value !== "all") url.searchParams.set("type", els.activityType.value);
  else url.searchParams.delete("type");
  if (els.activitySort.value !== "newest") url.searchParams.set("sort", els.activitySort.value);
  else url.searchParams.delete("sort");
  if (state.dataSource === "Demo") url.searchParams.set("source", "demo");
  else url.searchParams.delete("source");
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
    .map((activity, index) => normalizeActivity(activity, index))
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
    totalSeconds,
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
  const weather = funWeatherSummary(state.filteredRuns);
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
    ]),
    weather: [
      weather.loaded,
      weather.sampleSize,
      weather.averageTemperature === null ? null : Math.round(weather.averageTemperature),
      weather.coldest ? Math.round(weather.coldest.weather.temperatureF) : null,
      weather.warmest ? Math.round(weather.warmest.weather.temperatureF) : null,
      weather.commonCondition?.[0] || null
    ]
  });
}

function render() {
  applyRangeInputs();
  const normalized = state.rawActivities.map((activity, index) => normalizeActivity(activity, index));
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
  prepareFunWeatherSample(state.filteredRuns);
  renderFunStats(summary, start, end);
  hydrateFunStatsWeather(state.filteredRuns);
  renderSuggestedQuestions(summary, previous);
  renderIntel(summary, previous, start, end);
  renderAiState();
  renderMainChart();
  renderTrainingArc();
  renderScatter();
  renderStructure();
  renderHeatmap();
  renderRollingWorkload();
  renderDistanceMix();
  renderPaceZones();
  syncBucketFocus();
  renderTable();
}

function prepareFunWeatherSample(runs) {
  const eligible = runs.filter((run) => weatherRequestDetails(run));
  const fingerprint = eligible.map((run) => runWeatherKey(run)).join("|");
  if (fingerprint === state.funWeatherFingerprint) return;
  state.funWeatherAbort?.abort();
  state.funWeatherAbort = null;
  state.funWeatherFingerprint = fingerprint;
  state.funWeatherActiveFingerprint = "";
  state.funWeatherCompletedFingerprint = "";
  state.funWeatherEligibleCount = eligible.length;
  const limit = 80;
  const sample = eligible.length <= limit
    ? eligible
    : Array.from({ length: limit }, (_, index) => eligible[Math.round((index * (eligible.length - 1)) / (limit - 1))]);
  state.funWeatherSampleKeys = [...new Set(sample.map(runWeatherKey))];
}

function funWeatherSummary(runs) {
  const sampleKeys = new Set(state.funWeatherSampleKeys);
  const sampleRuns = runs.filter((run) => sampleKeys.has(runWeatherKey(run)));
  const entries = sampleRuns.map((run) => ({
    run,
    weather: state.runWeatherCache.get(runWeatherKey(run))
  })).filter((entry) => Number.isFinite(Number(entry.weather?.temperatureF)));
  const averageField = (field) => {
    const values = entries.map((entry) => Number(entry.weather[field])).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const temperatures = entries.map((entry) => Number(entry.weather.temperatureF));
  const averageTemperature = averageField("temperatureF");
  const coldest = [...entries].sort((left, right) => Number(left.weather.temperatureF) - Number(right.weather.temperatureF))[0] || null;
  const warmest = [...entries].sort((left, right) => Number(right.weather.temperatureF) - Number(left.weather.temperatureF))[0] || null;
  const conditionCounts = entries.reduce((counts, entry) => {
    const condition = entry.weather.condition || weatherCodeLabel(entry.weather.weatherCode);
    counts.set(condition, (counts.get(condition) || 0) + 1);
    return counts;
  }, new Map());
  const commonCondition = [...conditionCounts.entries()].sort((left, right) => right[1] - left[1])[0] || null;
  return {
    averageTemperature,
    averageFeelsLike: averageField("feelsLikeF"),
    averageHumidity: averageField("humidityPercent"),
    averageWind: averageField("windSpeedMph"),
    averageGust: averageField("windGustMph"),
    rainyStarts: entries.filter((entry) => Number(entry.weather.precipitationInches) > 0.005).length,
    coldest,
    warmest,
    commonCondition,
    loaded: entries.length,
    sampleSize: sampleRuns.length,
    eligible: state.funWeatherEligibleCount,
    sampled: state.funWeatherEligibleCount > sampleRuns.length
  };
}

function refreshFunStats() {
  const { start, end } = getRangeDates();
  renderFunStats(summarize(state.filteredRuns, state.buckets), start, end);
}

function refreshWeatherAiContext() {
  const summary = summarize(state.filteredRuns, state.buckets);
  invalidateAiInsight();
  renderSuggestedQuestions(summary, state.comparisonSummary);
}

async function requestWeatherForRun(run, signal) {
  const details = weatherRequestDetails(run);
  const key = runWeatherKey(run);
  if (!details || !key) return null;
  const cached = state.runWeatherCache.get(key);
  if (cached) return cached;
  const query = new URLSearchParams({
    lat: String(details.lat),
    lng: String(details.lng),
    date: details.date,
    hour: String(details.hour)
  });
  const response = await fetch(`/api/weather?${query}`, { signal });
  const data = await readApiJson(response);
  if (!response.ok) throw new Error(data.error || "Weather service did not return this hour.");
  const weather = data.weather;
  if (!weather) throw new Error("Weather service returned no conditions for this hour.");
  weather.condition = weatherCodeLabel(weather.weatherCode);
  state.runWeatherCache.set(key, weather);
  return weather;
}

async function hydrateFunStatsWeather(runs) {
  const fingerprint = state.funWeatherFingerprint;
  if (!fingerprint || state.funWeatherCompletedFingerprint === fingerprint || state.funWeatherActiveFingerprint === fingerprint) return;
  const sampleKeys = new Set(state.funWeatherSampleKeys);
  const missing = runs.filter((run) => sampleKeys.has(runWeatherKey(run)) && !state.runWeatherCache.has(runWeatherKey(run)));
  if (!missing.length) {
    state.funWeatherCompletedFingerprint = fingerprint;
    refreshFunStats();
    refreshWeatherAiContext();
    return;
  }
  state.funWeatherAbort?.abort();
  const controller = new AbortController();
  state.funWeatherAbort = controller;
  state.funWeatherActiveFingerprint = fingerprint;
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < missing.length) {
      const run = missing[cursor];
      cursor += 1;
      try {
        await requestWeatherForRun(run, controller.signal);
      } catch (error) {
        if (error.name === "AbortError") return;
      }
      completed += 1;
      if (state.funWeatherFingerprint === fingerprint && (completed % 6 === 0 || completed === missing.length)) {
        refreshFunStats();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
  if (!controller.signal.aborted && state.funWeatherFingerprint === fingerprint) {
    state.funWeatherCompletedFingerprint = fingerprint;
    refreshFunStats();
    refreshWeatherAiContext();
  }
  if (state.funWeatherAbort === controller) state.funWeatherAbort = null;
  if (state.funWeatherActiveFingerprint === fingerprint) state.funWeatherActiveFingerprint = "";
}

function renderFunStats(summary, start, end) {
  const marathonMiles = 26.2188;
  const everestFeet = 29032;
  const totalMeters = state.filteredRuns.reduce((sum, run) => sum + (Number(run.distance) || 0), 0);
  const marathonEquivalent = summary.totalMiles / marathonMiles;
  const everestProgress = summary.totalElevation / everestFeet;
  const trackLaps = totalMeters / 400;
  const movingHours = summary.totalSeconds / 3600;
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekdays = state.filteredRuns.reduce((stats, run) => {
    const day = weekdayNames[parseActivityDate(run).getDay()];
    const entry = stats.get(day) || { day, count: 0, miles: 0 };
    entry.count += 1;
    entry.miles += miles(run.distance);
    stats.set(day, entry);
    return stats;
  }, new Map());
  const favoriteDay = [...weekdays.values()].sort((left, right) => right.count - left.count || right.miles - left.miles)[0] || null;
  const weatherStats = funWeatherSummary(state.filteredRuns);
  const weatherCoverage = weatherStats.sampleSize
    ? `${weatherStats.loaded} of ${weatherStats.sampleSize} ${weatherStats.sampled ? "sampled " : ""}run starts matched`
    : "No route starts available";
  const warmestRunLabel = weatherStats.warmest
    ? `${weatherStats.warmest.run.name} · ${parseActivityDate(weatherStats.warmest.run).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  const dateLabel = start && end
    ? `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "selected window";
  els.funStatsSubtitle.textContent = summary.runCount
    ? `${summary.runCount} runs translated from the ${dateLabel} view.${weatherStats.loaded ? ` Weather matched for ${weatherStats.loaded}${weatherStats.sampled ? ` of an ${weatherStats.sampleSize}-run sample` : ` of ${weatherStats.sampleSize} route starts`}.` : ""}`
    : "Load running data and the selected window will get delightfully specific.";

  const cards = summary.runCount ? [
    {
      id: "marathons",
      index: "26.2",
      label: "Marathon equivalents",
      value: marathonEquivalent.toFixed(1),
      unit: "marathons",
      detail: `${summary.totalMiles.toFixed(1)} miles across the selected window.`
    },
    {
      id: "everest",
      index: "29K",
      label: "Everest progress",
      value: `${Math.round(everestProgress * 100)}%`,
      unit: "of Everest",
      detail: `${Math.round(summary.totalElevation).toLocaleString()} vertical feet climbed.`,
      progress: Math.min(100, everestProgress * 100)
    },
    {
      id: "moving",
      index: "24H",
      label: "Time in motion",
      value: formatDuration(summary.totalSeconds),
      unit: "on the move",
      detail: `${movingHours < 8 ? movingHours.toFixed(1) : (movingHours / 8).toFixed(1)} ${movingHours < 8 ? "total hours" : "eight-hour days"} of running.`
    },
    {
      id: "laps",
      index: "400M",
      label: "Track translation",
      value: Math.round(trackLaps).toLocaleString(),
      unit: "track laps",
      detail: "The same distance measured one regulation lap at a time."
    },
    {
      id: "weekday",
      index: "7D",
      label: "Favorite run day",
      value: favoriteDay.day,
      unit: "shows up most",
      detail: `${favoriteDay.count} runs · ${Math.round((favoriteDay.count / summary.runCount) * 100)}% of the selected window.`
    },
    {
      id: "temperature",
      index: "°F",
      label: "Average run temp",
      value: weatherStats.averageTemperature === null ? (weatherStats.sampleSize ? "…" : "—") : `${Math.round(weatherStats.averageTemperature)}°`,
      unit: weatherStats.loaded ? "at the starting hour" : weatherStats.sampleSize ? "matching conditions" : "route data needed",
      detail: weatherStats.loaded
        ? `${weatherCoverage}. Sourced modeled temperature—not an Ollama estimate.`
        : weatherStats.sampleSize
          ? "Matching Open-Meteo conditions to each run’s starting hour."
          : "Run coordinates and a local start time are required."
    },
    {
      id: "weather-range",
      index: "HI/LO",
      label: "Temperature swing",
      value: weatherStats.coldest && weatherStats.warmest
        ? `${Math.round(weatherStats.coldest.weather.temperatureF)}–${Math.round(weatherStats.warmest.weather.temperatureF)}°`
        : weatherStats.sampleSize ? "…" : "—",
      unit: weatherStats.loaded ? "coldest to warmest" : "waiting on weather",
      detail: weatherStats.warmest ? `Warmest start: ${warmestRunLabel}.` : "Your run-start temperature range will appear here."
    },
    {
      id: "conditions",
      index: "WMO",
      label: "Most common weather",
      value: weatherStats.commonCondition?.[0] || (weatherStats.sampleSize ? "…" : "—"),
      unit: weatherStats.commonCondition ? `${weatherStats.commonCondition[1]} of ${weatherStats.loaded} matched starts` : "waiting on conditions",
      detail: weatherStats.commonCondition
        ? "Grouped from Open-Meteo weather codes at each route start."
        : "The most frequent condition in this window will appear here."
    }
  ] : [
    { id: "marathons", index: "26.2", label: "Marathon equivalents", value: "—", unit: "waiting on miles", detail: "Your distance translation will appear here." },
    { id: "everest", index: "29K", label: "Everest progress", value: "—", unit: "waiting on climbs", detail: "Elevation becomes a mountain-sized comparison." },
    { id: "moving", index: "24H", label: "Time in motion", value: "—", unit: "waiting on time", detail: "Moving time becomes something easier to picture." },
    { id: "laps", index: "400M", label: "Track translation", value: "—", unit: "waiting on laps", detail: "Every mile becomes four-and-a-bit track laps." },
    { id: "weekday", index: "7D", label: "Favorite run day", value: "—", unit: "waiting on a pattern", detail: "Your most frequent day will surface here." },
    { id: "temperature", index: "°F", label: "Average run temp", value: "—", unit: "waiting on conditions", detail: "Average temperature at your run starts will appear here." },
    { id: "weather-range", index: "HI/LO", label: "Temperature swing", value: "—", unit: "waiting on conditions", detail: "Your coldest and warmest run starts will appear here." },
    { id: "conditions", index: "WMO", label: "Most common weather", value: "—", unit: "waiting on conditions", detail: "Your most frequent run-start condition will appear here." }
  ];

  els.funStatsGrid.replaceChildren(...cards.map((card) => {
    const article = document.createElement("article");
    article.className = `fun-stat-card ${card.id}`;
    const top = document.createElement("div");
    top.className = "fun-stat-top";
    const label = document.createElement("span");
    label.textContent = card.label;
    const index = document.createElement("small");
    index.setAttribute("aria-hidden", "true");
    index.textContent = card.index;
    top.append(label, index);
    const value = document.createElement("strong");
    value.textContent = card.value;
    const unit = document.createElement("em");
    unit.textContent = card.unit;
    const detail = document.createElement("p");
    detail.textContent = card.detail;
    article.append(top, value, unit, detail);
    if (Number.isFinite(card.progress)) {
      const meter = document.createElement("div");
      meter.className = "fun-stat-meter";
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-label", "Progress toward Everest elevation");
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "100");
      meter.setAttribute("aria-valuenow", String(Math.round(card.progress)));
      const fill = document.createElement("i");
      fill.style.width = `${card.progress}%`;
      meter.append(fill);
      article.append(meter);
    }
    return article;
  }));
}

function renderTrainingBrief(summary, previous, start, end) {
  if (!summary.runCount) {
    els.trainingBriefSummary.textContent = "Load running data to build a concise read of volume, pace, and training structure.";
    els.trainingBriefSignals.replaceChildren(...[
      ["Direction", "Waiting for a training window"],
      ["Effort", "Pace and load will appear here"],
      ["Structure", "Run spacing will appear here"],
      ["Hardest effort", "Load, intensity, hills, and time will appear here"]
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
  const historyNote = state.activityTruncated ? " · history capped" : "";
  els.navWindowLabel.textContent = `${state.dataSource} · ${summary.runCount} runs · ${rangeText}${historyNote}`;

  const volumeDetail = weeklyDelta === null
    ? `${summary.averageWeeklyMiles.toFixed(1)} mi/wk in view`
    : `${weeklyDelta >= 0 ? "+" : ""}${Math.round(weeklyDelta)}% weekly volume vs ${state.comparisonLabel}`;
  const paceDetail = paceDelta === null
    ? `${formatPace(summary.averagePace)} average pace`
    : `${paceDelta < 0 ? "Faster" : paceDelta > 0 ? "Slower" : "Level"} by ${formatPace(Math.abs(paceDelta)).replace("/mi", "")} vs ${state.comparisonLabel}`;
  const structureDetail = `${Math.round(summary.longRunShare * 100)}% of mileage from long runs · ${summary.longestRestGap}d longest gap`;
  const hardest = hardestRun(state.filteredRuns);
  const hardestAction = hardest
    ? { runId: String(hardest.run.id), label: "Open run details" }
    : null;
  const signals = [
    { label: "Direction", detail: volumeDetail, tone: weeklyDelta !== null && Math.abs(weeklyDelta) > 20 ? "caution" : "positive" },
    { label: "Effort", detail: paceDetail, tone: paceDelta !== null && paceDelta < 0 ? "positive" : "neutral" },
    { label: "Structure", detail: structureDetail, tone: summary.longRunShare > 0.5 || summary.longestRestGap >= 7 ? "caution" : "neutral" },
    {
      label: "Hardest effort",
      detail: hardest ? `${hardest.score}/100 - ${hardest.run.name}` : "No effort score available",
      tone: hardest?.score >= 75 ? "caution" : "neutral",
      action: hardestAction
    }
  ];
  els.trainingBriefSignals.replaceChildren(...signals.map((signal) => {
    const article = document.createElement("article");
    article.className = [signal.tone, signal.action ? "has-action" : "", signal.label === "Hardest effort" ? "hardest-signal" : ""].filter(Boolean).join(" ");
    const label = document.createElement("span");
    const detail = document.createElement("strong");
    label.textContent = signal.label;
    detail.textContent = signal.detail;
    article.append(label, detail);
    if (signal.action?.runId) {
      const button = document.createElement("button");
      button.className = "brief-signal-action";
      button.type = "button";
      button.dataset.action = "open-hardest-run";
      button.dataset.runId = signal.action.runId;
      button.textContent = signal.action.label;
      article.append(button);
    }
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
  const weather = funWeatherSummary(state.filteredRuns);
  const weatherCoveragePercent = weather.sampleSize ? Math.round((weather.loaded / weather.sampleSize) * 100) : 0;

  if (weather.loaded >= 5 && weatherCoveragePercent >= 50) {
    questions.push({
      focus: "weather",
      label: `${Math.round(weather.averageTemperature)}° avg conditions`,
      question: "How should the sourced weather context shape the interpretation of pace and load in this window without assuming causation?"
    });
  }
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
  els.exportViewButton.disabled = !state.filteredRuns.length;
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
    ? `${state.filteredRuns.length} runs are ready. Ask a question or choose a focus; Ollama will prioritize app-calculated signals and sourced weather context when coverage is sufficient.`
    : "Connect Strava, import a file, or try the demo. The app will calculate your dashboard first, then you can ask Ollama for a separate training read.";
  copy.append(title, detail);
  wrapper.append(index, copy);
  els.aiInsightContent.replaceChildren(wrapper);
}

function buildInsightPayload() {
  const summary = summarize(state.filteredRuns, state.buckets);
  const comparison = state.comparisonSummary || summarize([], []);
  const weather = funWeatherSummary(state.filteredRuns);
  const weatherCoveragePercent = weather.sampleSize ? Math.round((weather.loaded / weather.sampleSize) * 100) : 0;
  const hasComparison = comparison.runCount > 0 && els.comparisonSelect.value !== "off";
  const percentChange = (current, earlier) => earlier ? Math.round(((current - earlier) / earlier) * 100) : null;
  const relationshipStrength = (first, firstThreshold, second, secondThreshold) => {
    if (first === null || second === null) return 0;
    const firstWeight = Math.min(2, Math.abs(first) / firstThreshold);
    const secondWeight = Math.min(2, Math.abs(second) / secondThreshold);
    return Math.round(((firstWeight + secondWeight) / 4) * 100);
  };
  const pairedPattern = (first, firstStable, second, secondStable, alignedWhenSameDirection = true) => {
    if (first === null || second === null) return "insufficient";
    const firstIsStable = Math.abs(first) <= firstStable;
    const secondIsStable = Math.abs(second) <= secondStable;
    if (firstIsStable && secondIsStable) return "stability";
    if (firstIsStable || secondIsStable) return "divergence";
    const sameDirection = Math.sign(first) === Math.sign(second);
    return sameDirection === alignedWhenSameDirection ? "alignment" : "tradeoff";
  };
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
  const terrainChange = hasComparison ? Math.round(summary.elevationPerMile - comparison.elevationPerMile) : null;
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
    { id: "spacing", direction: direction(spacingChange), change: spacingChange, coverage: 100 },
    weather.loaded ? {
      id: "weather",
      direction: "context",
      change: weather.averageTemperature === null ? null : Math.round(weather.averageTemperature),
      coverage: weatherCoveragePercent
    } : null
  ].filter(Boolean);
  const relationships = [
    hasComparison ? {
      id: "volume_pace",
      pattern: pairedPattern(volumeChange, 5, paceChange, 3, false),
      strength: relationshipStrength(volumeChange, 5, paceChange, 5),
      coverage: 100
    } : null,
    hasComparison ? {
      id: "volume_load",
      pattern: pairedPattern(volumeChange, 5, loadChange, 8, true),
      strength: relationshipStrength(volumeChange, 5, loadChange, 8),
      coverage: directLoadCoverage
    } : null,
    hasComparison && heartRateChange !== null && hrCoverage >= 50 ? {
      id: "pace_heart_rate",
      pattern: pairedPattern(paceChange, 3, heartRateChange, 3, true),
      strength: relationshipStrength(paceChange, 5, heartRateChange, 3),
      coverage: hrCoverage
    } : null,
    hasComparison ? {
      id: "load_spacing",
      pattern: pairedPattern(loadChange, 8, spacingChange, 1, false),
      strength: relationshipStrength(loadChange, 8, spacingChange, 1),
      coverage: directLoadCoverage
    } : null,
    hasComparison ? {
      id: "consistency_load",
      pattern: pairedPattern(consistencyChange, 5, loadChange, 8, true),
      strength: relationshipStrength(consistencyChange, 5, loadChange, 8),
      coverage: directLoadCoverage
    } : null,
    {
      id: "long_run_balance",
      pattern: summary.longRunShare >= 0.25 && summary.longRunShare <= 0.4 ? "stability" : "tradeoff",
      strength: Math.min(100, Math.round(45 + Math.abs((summary.longRunShare * 100) - 32.5) * 3)),
      coverage: 100
    },
    hasComparison ? {
      id: "terrain_pace",
      pattern: pairedPattern(terrainChange, 15, paceChange, 3, true),
      strength: relationshipStrength(terrainChange, 15, paceChange, 5),
      coverage: 100
    } : null
  ].filter(Boolean).sort((a, b) => b.strength - a.strength);
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
    recentAverageLoad: Math.round(summary.totalLoad),
    loadChangePercent: loadChange,
    consistencyChangePoints: consistencyChange,
    longRunShareChangePoints: longRunShareChange,
    heartRateChangeBpm: heartRateChange,
    longestGapChangeDays: spacingChange,
    terrainChangeFeetPerMile: terrainChange
  } : null;
  const verifiedFacts = [
    `Selected window: ${summary.runCount} runs, ${summary.totalMiles.toFixed(1)} miles, ${summary.averageWeeklyMiles.toFixed(1)} miles per week, and ${summary.averageRunsPerWeek.toFixed(1)} runs per week at ${formatPace(summary.averagePace)}.`,
    `Window structure: ${Math.round(summary.consistency * 100)}% grouped-period consistency, ${Math.round(summary.longRunShare * 100)}% of mileage from long runs, and a ${summary.longestRestGap}-day longest gap.`,
    `The app-calculated load-per-mile score is ${summary.averageLoadPerMile.toFixed(1)}; training load is not weight, calories, or a measured intensity unit.`,
    hasComparison && volumeChange !== null && paceChange !== null && loadChange !== null
      ? `Compared with ${state.comparisonLabel}, weekly volume was ${Math.abs(volumeChange)}% ${volumeChange >= 0 ? "higher" : "lower"}, average pace was ${Math.abs(paceChange)} sec/mi ${paceChange <= 0 ? "faster" : "slower"}, and training load was ${Math.abs(loadChange)}% ${loadChange >= 0 ? "higher" : "lower"}.`
      : null,
    weather.loaded
      ? `Open-Meteo modeled context matched ${weather.loaded} of ${weather.sampleSize} sampled run starts: ${Math.round(weather.averageTemperature)}°F average temperature, ${Math.round(weather.coldest.weather.temperatureF)}–${Math.round(weather.warmest.weather.temperatureF)}°F range, and ${weather.commonCondition?.[0] || "recorded conditions"} most often.`
      : null
  ].filter(Boolean);
  return {
    focus: els.aiFocus.value,
    question: els.aiQuestion.value.trim().slice(0, 280),
    verifiedFacts,
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
    weather: weather.loaded ? {
      source: "Open-Meteo",
      modeledContext: true,
      matchedRunStarts: weather.loaded,
      sampleSize: weather.sampleSize,
      eligibleRuns: weather.eligible,
      coveragePercent: weatherCoveragePercent,
      sampled: weather.sampled,
      averageTemperatureF: Math.round(weather.averageTemperature),
      averageFeelsLikeF: weather.averageFeelsLike === null ? null : Math.round(weather.averageFeelsLike),
      minimumTemperatureF: Math.round(weather.coldest.weather.temperatureF),
      maximumTemperatureF: Math.round(weather.warmest.weather.temperatureF),
      averageHumidityPercent: weather.averageHumidity === null ? null : Math.round(weather.averageHumidity),
      averageWindMph: weather.averageWind === null ? null : Math.round(weather.averageWind),
      averageGustMph: weather.averageGust === null ? null : Math.round(weather.averageGust),
      rainyRunStarts: weather.rainyStarts,
      commonCondition: weather.commonCondition?.[0] || null,
      commonConditionCount: weather.commonCondition?.[1] || 0
    } : null,
    coverage: {
      heartRatePercent: hrCoverage,
      directLoadPercent: directLoadCoverage,
      currentRuns: summary.runCount,
      comparisonRuns: comparison.runCount,
      completePeriods: Math.max(0, state.buckets.length - 2),
      weatherPercent: weatherCoveragePercent,
      weatherRuns: weather.loaded
    },
    candidates,
    relationships,
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

  const analyticalFrame = document.createElement("div");
  analyticalFrame.className = "ai-analysis-frame";
  const analyticalLabel = document.createElement("span");
  analyticalLabel.textContent = insight.analysisLabel || "Analytical frame";
  const analyticalCopy = document.createElement("p");
  analyticalCopy.textContent = insight.analysis || "The strongest supported relationship needs a broader comparison window.";
  analyticalFrame.append(analyticalLabel, analyticalCopy);

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
  els.aiInsightContent.replaceChildren(header, evidence, analyticalFrame, observations, nextStep, caution);
  requestAnimationFrame(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    els.aiInsightContent.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });
}

async function analyzeWithOllama() {
  if (!state.filteredRuns.length) return;
  state.insightFingerprint = currentInsightFingerprint();
  const requestedFingerprint = state.insightFingerprint;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 130_000);
  els.aiAnalyzeButton.disabled = true;
  els.aiAnalyzeButton.textContent = "Asking Ollama…";
  renderAiLoading();
  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildInsightPayload()),
      signal: controller.signal
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
    renderAiError(timedOut ? "The model took too long to answer. Try again once the Ollama service is warm." : error.message || "Check that the Ollama URL is reachable and try again.");
  } finally {
    window.clearTimeout(timeoutId);
    els.aiAnalyzeButton.disabled = !state.filteredRuns.length;
    els.aiAnalyzeButton.textContent = "Ask Ollama";
  }
}

function renderIntel(summary, previous, start, end) {
  const dateLabel = start && end
    ? `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`
    : "Selected range";
  const directLoadCoverage = state.filteredRuns.length
    ? Math.round((state.filteredRuns.filter((run) => Number(run.suffer_score) > 0).length / state.filteredRuns.length) * 100)
    : 0;
  const heartRateCoverage = state.filteredRuns.length
    ? Math.round((state.filteredRuns.filter((run) => Number(run.average_heartrate) > 0).length / state.filteredRuns.length) * 100)
    : 0;
  const historyNote = state.activityTruncated ? " · history capped at fetch limit" : "";
  els.intelSubtitle.textContent = `${dateLabel} · ${summary.runCount} runs · ${summary.activeDays} active days · HR ${heartRateCoverage}% · direct load ${directLoadCoverage}%${historyNote}`;
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

function renderTrainingArc() {
  const buckets = state.buckets.filter((bucket) => bucket.distanceMiles > 0);
  if (!buckets.length) {
    renderEmpty(els.trainingArcChart, "Load activities to see your training shape.");
    els.trainingArcInsightTitle.textContent = "No block selected";
    els.trainingArcInsightText.textContent = "Your selected window will appear here once activities are loaded.";
    return;
  }

  const width = Math.max(900, Math.min(1320, buckets.length * 54));
  const height = 430;
  const pad = { top: 28, right: 28, bottom: 42, left: 76 };
  const plotWidth = width - pad.left - pad.right;
  const slot = plotWidth / buckets.length;
  const xFor = (index) => pad.left + index * slot + slot / 2;
  const volumeTop = 42;
  const volumeBottom = 154;
  const paceTop = 190;
  const paceBottom = 302;
  const shareTop = 342;
  const shareBottom = 382;
  const volumes = buckets.map((bucket) => bucket.distanceMiles);
  const baselines = movingAverage(volumes, Math.min(4, Math.max(2, Math.ceil(volumes.length / 10))));
  const maxVolume = Math.max(...volumes, ...baselines, 1);
  const paceValues = buckets.map((bucket) => bucket.averagePace).filter((value) => value > 0);
  const hasPace = paceValues.length > 0;
  const minPace = hasPace ? Math.min(...paceValues) : 0;
  const maxPace = hasPace ? Math.max(...paceValues) : 60;
  const paceRange = Math.max(maxPace - minPace, 30);
  const root = svg("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "Training arc showing weekly mileage, average pace, and long-run share"
  });

  const volumeY = (value) => volumeBottom - (value / maxVolume) * (volumeBottom - volumeTop);
  const paceY = (value) => hasPace && value > 0
    ? paceTop + ((value - minPace) / paceRange) * (paceBottom - paceTop)
    : paceTop + (paceBottom - paceTop) / 2;
  const shareY = (value) => shareBottom - value * (shareBottom - shareTop);
  const drawGrid = (top, bottom, labels) => {
    labels.forEach((label, index) => {
      const y = top + ((bottom - top) / Math.max(labels.length - 1, 1)) * index;
      root.appendChild(svg("line", { class: "axis arc-grid", x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
      root.appendChild(svg("text", { class: "label arc-axis-label", x: 10, y: y + 4 }, [document.createTextNode(label)]));
    });
  };

  drawGrid(volumeTop, volumeBottom, [`${Math.round(maxVolume)} mi`, `${Math.round(maxVolume / 2)} mi`, "0"]);
  drawGrid(paceTop, paceBottom, [formatPace(minPace), formatPace(minPace + paceRange / 2), formatPace(minPace + paceRange)]);
  root.appendChild(svg("line", { class: "axis arc-grid", x1: pad.left, y1: shareBottom, x2: width - pad.right, y2: shareBottom }));
  root.appendChild(svg("text", { class: "label arc-axis-label", x: 10, y: shareTop + 4 }, [document.createTextNode("100%")]));
  root.appendChild(svg("text", { class: "label arc-axis-label", x: 10, y: shareBottom + 4 }, [document.createTextNode("0%")]));
  root.appendChild(svg("text", { class: "label arc-lane-label", x: pad.left, y: 18 }, [document.createTextNode("MILEAGE")]));
  root.appendChild(svg("text", { class: "label arc-lane-label", x: pad.left, y: paceTop - 16 }, [document.createTextNode("PACE · FASTER IS HIGHER")]));
  root.appendChild(svg("text", { class: "label arc-lane-label", x: pad.left, y: shareTop - 14 }, [document.createTextNode("LONG-RUN SHARE")]));

  const latestX = xFor(buckets.length - 1);
  root.appendChild(svg("line", { class: "arc-latest-marker", x1: latestX, y1: volumeTop - 16, x2: latestX, y2: shareBottom + 8 }));
  root.appendChild(svg("text", { class: "label arc-latest-label", x: Math.min(latestX + 7, width - 88), y: volumeTop - 17 }, [document.createTextNode("latest")]));

  buckets.forEach((bucket, index) => {
    const x = xFor(index);
    const barWidth = Math.max(6, Math.min(30, slot * 0.62));
    const bar = svg("rect", {
      class: "arc-volume-bar",
      x: x - barWidth / 2,
      y: volumeY(bucket.distanceMiles),
      width: barWidth,
      height: Math.max(2, volumeBottom - volumeY(bucket.distanceMiles)),
      rx: 4
    });
    attachTooltip(bar, `${bucket.label} training arc`, [
      { label: "Weekly miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Average pace", value: formatPace(bucket.averagePace) },
      { label: "Long-run share", value: `${Math.round(bucket.longRunShare * 100)}%` },
      { label: "Longest run", value: `${bucket.longRunMiles.toFixed(1)} mi` },
      { label: "Runs", value: bucket.runs }
    ]);
    bindBucketFocus(bar, bucket);
    root.appendChild(bar);
  });

  const baselinePoints = baselines.map((value, index) => `${xFor(index)},${volumeY(value)}`).join(" ");
  root.appendChild(svg("polyline", { class: "arc-baseline-line", points: baselinePoints }));

  const pacePoints = buckets.map((bucket, index) => `${xFor(index)},${paceY(bucket.averagePace)}`).join(" ");
  root.appendChild(svg("polyline", { class: "arc-pace-line", points: pacePoints }));
  buckets.forEach((bucket, index) => {
    const x = xFor(index);
    const paceDot = svg("circle", { class: "arc-pace-dot", cx: x, cy: paceY(bucket.averagePace), r: 4.5 });
    attachTooltip(paceDot, `${bucket.label} pace`, [
      { label: "Average pace", value: formatPace(bucket.averagePace) },
      { label: "Miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Average HR", value: bucket.averageHr ? `${Math.round(bucket.averageHr)} bpm` : "-" }
    ]);
    bindBucketFocus(paceDot, bucket);
    root.appendChild(paceDot);

    const shareDot = svg("circle", { class: "arc-share-dot", cx: x, cy: shareY(bucket.longRunShare), r: 5 });
    attachTooltip(shareDot, `${bucket.label} long-run share`, [
      { label: "Long-run share", value: `${Math.round(bucket.longRunShare * 100)}%` },
      { label: "Longest run", value: `${bucket.longRunMiles.toFixed(1)} mi` }
    ]);
    bindBucketFocus(shareDot, bucket);
    root.appendChild(shareDot);

    if (index % Math.max(1, Math.ceil(buckets.length / 8)) === 0 || index === buckets.length - 1) {
      root.appendChild(svg("text", { class: "label arc-x-label", x: x - 18, y: height - 12 }, [document.createTextNode(bucket.label)]));
    }
  });

  if (state.comparisonBuckets.length) {
    const comparisonBuckets = state.comparisonBuckets.slice(-buckets.length);
    const comparisonMax = Math.max(...comparisonBuckets.map((bucket) => bucket.distanceMiles), maxVolume, 1);
    const comparisonPoints = comparisonBuckets.map((bucket, index) => {
      const x = xFor(index + Math.max(0, buckets.length - comparisonBuckets.length));
      return `${x},${volumeBottom - (bucket.distanceMiles / comparisonMax) * (volumeBottom - volumeTop)}`;
    }).join(" ");
    root.appendChild(svg("polyline", { class: "arc-comparison-line", points: comparisonPoints }));
  }

  els.trainingArcChart.replaceChildren(root);
  updateTrainingArcInsight(buckets[buckets.length - 1]);
  syncBucketFocus();
}

function bindBucketFocus(element, bucket) {
  element.dataset.bucketKey = bucket.key;
  element.setAttribute("role", "button");
  element.addEventListener("click", () => focusTrainingBucket(bucket));
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    focusTrainingBucket(bucket);
  });
}

function focusTrainingBucket(bucket) {
  state.focusedBucketKey = state.focusedBucketKey === bucket.key ? "" : bucket.key;
  syncBucketFocus();
  updateTrainingArcInsight(state.focusedBucketKey ? bucket : state.buckets[state.buckets.length - 1]);
}

function syncBucketFocus() {
  const focused = state.buckets.find((bucket) => bucket.key === state.focusedBucketKey);
  if (!focused) state.focusedBucketKey = "";
  document.querySelectorAll("[data-bucket-key]").forEach((node) => {
    const isFocused = Boolean(state.focusedBucketKey) && node.dataset.bucketKey === state.focusedBucketKey;
    node.classList.toggle("chart-focus", isFocused);
    node.classList.toggle("arc-selected", isFocused);
  });
  if (focused) updateTrainingArcInsight(focused);
}

function updateTrainingArcInsightLegacy(bucket) {
  if (!bucket) {
    els.trainingArcInsightTitle.textContent = "No block selected";
    els.trainingArcInsightText.textContent = "Load activities to see what this block is doing.";
    return;
  }
  const prior = state.buckets[state.buckets.indexOf(bucket) - 1];
  const milesDelta = prior ? bucket.distanceMiles - prior.distanceMiles : 0;
  const paceDelta = prior ? bucket.averagePace - prior.averagePace : 0;
  const volumePhrase = prior ? `${milesDelta >= 0 ? "+" : ""}${milesDelta.toFixed(1)} mi vs ${prior.label}` : "first visible block";
  const pacePhrase = prior && bucket.averagePace && paceDelta
    ? `${formatPace(Math.abs(paceDelta)).replace("/mi", "")} ${paceDelta < 0 ? "quicker" : "slower"}`
    : "pace baseline forming";
  const volumeChange = prior?.distanceMiles ? (milesDelta / prior.distanceMiles) * 100 : 0;
  let signal = "Steady: the week is close to the recent shape. Repeat it before adding more.";
  if (!prior) signal = "Baseline: this is the first visible block in the selected window.";
  else if (volumeChange > 8 && paceDelta <= 0) signal = "Build: volume rose while pace held or improved. Keep the next step modest.";
  else if (volumeChange > 8) signal = "Build: load rose quickly. Give the next hard effort plenty of room.";
  else if (volumeChange < -10 && paceDelta < 0) signal = "Absorb: volume eased while pace improved. This looks like a useful consolidation week.";
  else if (bucket.longRunShare > 0.55) signal = "Durability: the long run carries a large share of the week. Keep the support runs easy.";
  els.trainingArcInsight.textContent = `${bucket.label}: ${bucket.distanceMiles.toFixed(1)} mi · ${formatPace(bucket.averagePace)} average pace · ${Math.round(bucket.longRunShare * 100)}% long-run share · ${volumePhrase} · ${pacePhrase}. Click any mark to focus that block.`;
}

function updateTrainingArcInsight(bucket) {
  if (!bucket) {
    els.trainingArcInsightTitle.textContent = "No block selected";
    els.trainingArcInsightText.textContent = "Load activities to see what this block is doing.";
    return;
  }
  const prior = state.buckets[state.buckets.indexOf(bucket) - 1];
  const milesDelta = prior ? bucket.distanceMiles - prior.distanceMiles : 0;
  const paceDelta = prior ? bucket.averagePace - prior.averagePace : 0;
  const volumePhrase = prior ? `${milesDelta >= 0 ? "+" : ""}${milesDelta.toFixed(1)} mi vs ${prior.label}` : "first visible block";
  const pacePhrase = prior && bucket.averagePace && paceDelta
    ? `${formatPace(Math.abs(paceDelta)).replace("/mi", "")} ${paceDelta < 0 ? "quicker" : "slower"}`
    : "pace baseline forming";
  const volumeChange = prior?.distanceMiles ? (milesDelta / prior.distanceMiles) * 100 : 0;
  let signal = "Steady: the week is close to the recent shape. Repeat it before adding more.";
  if (!prior) signal = "Baseline: this is the first visible block in the selected window.";
  else if (volumeChange > 8 && paceDelta <= 0) signal = "Build: volume rose while pace held or improved. Keep the next step modest.";
  else if (volumeChange > 8) signal = "Build: load rose quickly. Give the next hard effort plenty of room.";
  else if (volumeChange < -10 && paceDelta < 0) signal = "Absorb: volume eased while pace improved. This looks like a useful consolidation week.";
  else if (bucket.longRunShare > 0.55) signal = "Durability: the long run carries a large share of the week. Keep the support runs easy.";
  els.trainingArcInsightTitle.textContent = `${bucket.label} / ${bucket.distanceMiles.toFixed(1)} mi / ${formatPace(bucket.averagePace)}`;
  els.trainingArcInsightText.textContent = `${volumePhrase} / ${pacePhrase}. ${signal}`;
}

function renderScatter() {
  const buckets = state.buckets.filter((bucket) => bucket.distanceMiles && bucket.averagePace);
  if (!buckets.length) {
    renderEmpty(els.scatterChart);
    return;
  }
  const width = 800;
  const height = 310;
  const pad = { top: 28, right: 28, bottom: 56, left: 70 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxMiles = Math.max(...buckets.map((b) => b.distanceMiles), 1);
  const paces = buckets.map((b) => b.averagePace);
  const pacePadding = Math.max((Math.max(...paces) - Math.min(...paces)) * 0.14, 12);
  const minPace = Math.max(1, Math.min(...paces) - pacePadding);
  const maxPace = Math.max(...paces) + pacePadding;
  const paceRange = Math.max(maxPace - minPace, 30);
  const xFor = (miles) => pad.left + (miles / maxMiles) * plotWidth;
  const yFor = (pace) => pad.top + ((pace - minPace) / paceRange) * plotHeight;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Volume versus pace effort map" });
  for (let index = 0; index <= 4; index += 1) {
    const x = pad.left + (plotWidth / 4) * index;
    const y = pad.top + (plotHeight / 4) * index;
    root.appendChild(svg("line", { class: "axis scatter-grid", x1: x, y1: pad.top, x2: x, y2: height - pad.bottom }));
    root.appendChild(svg("line", { class: "axis scatter-grid", x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
    root.appendChild(svg("text", { class: "label scatter-tick", x: x - 12, y: height - pad.bottom + 18 }, [document.createTextNode(`${Math.round((maxMiles / 4) * index)} mi`)]));
    root.appendChild(svg("text", { class: "label scatter-tick", x: 8, y: y + 4 }, [document.createTextNode(formatPace(minPace + (paceRange / 4) * index))]));
  }
  const medianMiles = [...buckets.map((bucket) => bucket.distanceMiles)].sort((a, b) => a - b)[Math.floor(buckets.length / 2)];
  const medianPace = [...paces].sort((a, b) => a - b)[Math.floor(paces.length / 2)];
  root.appendChild(svg("line", { class: "scatter-guide", x1: xFor(medianMiles), y1: pad.top, x2: xFor(medianMiles), y2: height - pad.bottom }));
  root.appendChild(svg("line", { class: "scatter-guide", x1: pad.left, y1: yFor(medianPace), x2: width - pad.right, y2: yFor(medianPace) }));
  root.appendChild(svg("text", { class: "label scatter-guide-label", x: xFor(medianMiles) + 5, y: pad.top + 12 }, [document.createTextNode("median volume")]));
  root.appendChild(svg("text", { class: "label scatter-guide-label", x: pad.left + 6, y: yFor(medianPace) - 6 }, [document.createTextNode("median pace")]));
  root.appendChild(svg("text", { class: "label scatter-axis-title", x: pad.left + plotWidth / 2 - 44, y: height - 10 }, [document.createTextNode("WEEKLY MILES")]));
  root.appendChild(svg("text", { class: "label scatter-axis-title", x: 16, y: pad.top + plotHeight / 2 + 28, transform: `rotate(-90 16 ${pad.top + plotHeight / 2 + 28})` }, [document.createTextNode("AVERAGE PACE")]));
  buckets.forEach((bucket, index) => {
    const x = xFor(bucket.distanceMiles);
    const y = yFor(bucket.averagePace);
    const r = 4 + Math.min(bucket.runs, 8);
    const color = bucket.averageHr >= 155 ? "#fc4c02" : bucket.averageHr >= 140 ? "#b77b15" : "#2867b2";
    const dot = svg("circle", { class: `dot scatter-dot${index === buckets.length - 1 ? " scatter-latest" : ""}`, cx: x, cy: y, r, style: `fill: ${color}` });
    attachTooltip(dot, `${bucket.label} volume vs pace`, [
      { label: "Miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Avg pace", value: formatPace(bucket.averagePace) },
      { label: "Runs", value: bucket.runs },
      { label: "Avg run", value: `${(bucket.distanceMiles / bucket.runs).toFixed(1)} mi` },
      { label: "Avg HR", value: bucket.averageHr ? `${Math.round(bucket.averageHr)} bpm` : "-" },
      { label: "Bubble size", value: `${bucket.runs} runs` },
      { label: "Position", value: index === buckets.length - 1 ? "Latest block" : "Training block" }
    ]);
    bindBucketFocus(dot, bucket);
    root.appendChild(dot);
    if (index === buckets.length - 1) {
      root.appendChild(svg("text", { class: "label scatter-latest-label", x: x + r + 6, y: y - r - 4 }, [document.createTextNode("latest")]));
    }
  });
  root.appendChild(svg("text", { class: "label chart-legend", x: width - 330, y: 18 }, [document.createTextNode("blue: lower HR  gold: mid HR  orange: higher HR  size: runs")]));
  els.scatterChart.replaceChildren(root);
}

function renderStructure() {
  if (!state.buckets.length) {
    renderEmpty(els.structureChart);
    return;
  }
  const width = 800;
  const height = 310;
  const pad = { top: 18, right: 28, bottom: 34, left: 72 };
  const plotWidth = width - pad.left - pad.right;
  const step = plotWidth / state.buckets.length;
  const xFor = (index) => pad.left + index * step + step / 2;
  const runTop = 34;
  const runBottom = 102;
  const shareTop = 134;
  const shareBottom = 196;
  const elevationTop = 226;
  const elevationBottom = 274;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Week structure showing run count, long-run share, and elevation" });
  const maxRuns = Math.max(...state.buckets.map((b) => b.runs), 1);
  const maxElevation = Math.max(...state.buckets.map((b) => b.elevationFeet), 1);
  const runY = (value) => runBottom - (value / maxRuns) * (runBottom - runTop);
  const shareY = (value) => shareBottom - value * (shareBottom - shareTop);
  const elevationY = (value) => elevationBottom - (value / maxElevation) * (elevationBottom - elevationTop);
  const drawLane = (top, bottom, labels) => {
    root.appendChild(svg("line", { class: "axis structure-grid", x1: pad.left, y1: top, x2: width - pad.right, y2: top }));
    root.appendChild(svg("line", { class: "axis structure-grid", x1: pad.left, y1: bottom, x2: width - pad.right, y2: bottom }));
    root.appendChild(svg("text", { class: "label structure-axis-label", x: 10, y: top + 4 }, [document.createTextNode(labels[0])]));
    root.appendChild(svg("text", { class: "label structure-axis-label", x: 10, y: bottom + 4 }, [document.createTextNode(labels[1])]));
  };
  drawLane(runTop, runBottom, [`${maxRuns} runs`, "0"]);
  drawLane(shareTop, shareBottom, ["100%", "0%"]);
  drawLane(elevationTop, elevationBottom, [`${Math.round(maxElevation).toLocaleString()} ft`, "0"]);
  root.appendChild(svg("text", { class: "label structure-lane-label", x: pad.left, y: 22 }, [document.createTextNode("RUN COUNT")]));
  root.appendChild(svg("text", { class: "label structure-lane-label", x: pad.left, y: 122 }, [document.createTextNode("LONG-RUN SHARE")]));
  root.appendChild(svg("text", { class: "label structure-lane-label", x: pad.left, y: 214 }, [document.createTextNode("ELEVATION")]));
  const sharePoints = [];
  const elevationPoints = [];
  state.buckets.forEach((bucket, index) => {
    const x = xFor(index);
    const barWidth = Math.max(6, Math.min(28, step * 0.55));
    const runHeight = runBottom - runY(bucket.runs);
    const runBar = svg("rect", {
      class: "structure-run-bar",
      x: x - barWidth / 2,
      y: runY(bucket.runs),
      width: barWidth,
      height: Math.max(1, runHeight),
      rx: 4
    });
    attachTooltip(runBar, `${bucket.label} run count`, [
      { label: "Runs", value: bucket.runs },
      { label: "Miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Avg run", value: `${(bucket.distanceMiles / bucket.runs).toFixed(1)} mi` },
      { label: "Avg pace", value: formatPace(bucket.averagePace) }
    ]);
    bindBucketFocus(runBar, bucket);
    root.appendChild(runBar);
    const shareDot = svg("circle", {
      class: "structure-share-dot",
      cx: x,
      cy: shareY(bucket.longRunShare),
      r: 5
    });
    attachTooltip(shareDot, `${bucket.label} long-run share`, [
      { label: "Long run", value: `${bucket.longRunMiles.toFixed(1)} mi` },
      { label: "Share", value: `${Math.round(bucket.longRunShare * 100)}%` },
      { label: "Week miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Elevation", value: `${Math.round(bucket.elevationFeet).toLocaleString()} ft` }
    ]);
    bindBucketFocus(shareDot, bucket);
    root.appendChild(shareDot);
    sharePoints.push(`${x},${shareY(bucket.longRunShare)}`);
    const elevationDot = svg("circle", {
      class: "structure-elevation-dot",
      cx: x,
      cy: elevationY(bucket.elevationFeet),
      r: 4
    });
    attachTooltip(elevationDot, `${bucket.label} elevation`, [
      { label: "Elevation", value: `${Math.round(bucket.elevationFeet).toLocaleString()} ft` },
      { label: "Miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Elevation density", value: `${Math.round(bucket.distanceMiles ? bucket.elevationFeet / bucket.distanceMiles : 0)} ft/mi` }
    ]);
    bindBucketFocus(elevationDot, bucket);
    root.appendChild(elevationDot);
    elevationPoints.push(`${x},${elevationY(bucket.elevationFeet)}`);
    if (index % Math.max(1, Math.ceil(state.buckets.length / 8)) === 0 || index === state.buckets.length - 1) {
      root.appendChild(svg("text", { class: "label structure-x-label", x: x - 18, y: height - 8 }, [document.createTextNode(bucket.label)]));
    }
  });
  root.appendChild(svg("polyline", { class: "structure-share-line", points: sharePoints.join(" ") }));
  root.appendChild(svg("polyline", { class: "structure-elevation-line", points: elevationPoints.join(" ") }));
  root.appendChild(svg("text", { class: "label chart-legend", x: width - 288, y: 18 }, [document.createTextNode("teal: runs  gold: long-run share  orange: elevation")]));
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
  const cell = weeks <= 12 ? 25 : weeks <= 26 ? 18 : 12;
  const gap = cell >= 24 ? 6 : 4;
  const left = 64;
  const width = Math.max(360, left + weeks * (cell + gap) + 24);
  const height = 7 * (cell + gap) + 46;
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
        x: left + week * (cell + gap),
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
      root.appendChild(svg("text", { class: "label", x: left + week * (cell + gap), y: 15 }, [document.createTextNode(labelDate.toLocaleDateString(undefined, { month: "short" }))]));
    }
  }
  ["Mon", "Wed", "Fri", "Sun"].forEach((label, index) => {
    root.appendChild(svg("text", { class: "label", x: 10, y: 34 + index * 2 * (cell + gap) }, [document.createTextNode(label)]));
  });
  const totalMiles = state.filteredRuns.reduce((sum, run) => sum + miles(run.distance), 0);
  els.heatmapSubtitle.textContent = `${state.filteredRuns.length} runs / ${totalMiles.toFixed(0)} mi / ${weeks} weeks`;
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
  const totalMiles = bins.reduce((sum, bin) => sum + bin.miles, 0);
  renderHorizontalBars(els.distanceMixChart, bins, "miles", (bin) => `${bin.miles.toFixed(1)} mi / ${totalMiles ? Math.round((bin.miles / totalMiles) * 100) : 0}%`, "#157f74");
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
  const totalRuns = state.filteredRuns.length;
  renderHorizontalBars(els.paceZoneChart, bins, "count", (bin) => `${bin.count} runs / ${totalRuns ? Math.round((bin.count / totalRuns) * 100) : 0}%`, "#2867b2");
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

function hardestRun(runs) {
  if (!runs.length) return null;
  const loadValues = runs.map(activityLoad);
  const loadPerMileValues = runs.map((run) => {
    const distance = miles(run.distance);
    return distance ? activityLoad(run) / distance : 0;
  });
  const elevationDensityValues = runs.map((run) => {
    const distance = miles(run.distance);
    return distance ? feet(run.total_elevation_gain) / distance : 0;
  });
  const durationValues = runs.map(runMinutes);
  const ranked = runs.map((run) => {
    const distance = miles(run.distance);
    const load = activityLoad(run);
    const loadPerMile = distance ? load / distance : 0;
    const elevationDensity = distance ? feet(run.total_elevation_gain) / distance : 0;
    const score = Math.round(
      percentileRank(loadValues, load, true) * 0.4
      + percentileRank(loadPerMileValues, loadPerMile, true) * 0.3
      + percentileRank(elevationDensityValues, elevationDensity, true) * 0.2
      + percentileRank(durationValues, runMinutes(run), true) * 0.1
    );
    return { run, score, load, distance };
  });
  return ranked.sort((left, right) => right.score - left.score || right.load - left.load || right.distance - left.distance)[0];
}

function daysBetween(left, right) {
  if (!left || !right) return null;
  return Math.round((parseActivityDate(right) - parseActivityDate(left)) / 86400000);
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function decodePolyline(encoded, precision = 5) {
  if (!encoded) return [];
  const coordinates = [];
  const factor = 10 ** precision;
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const decodeValue = () => {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index <= encoded.length);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    latitude += decodeValue();
    longitude += decodeValue();
    coordinates.push([latitude / factor, longitude / factor]);
  }
  return coordinates.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

function activityRoutePoints(run) {
  if (Array.isArray(run.route_points) && run.route_points.length) return run.route_points;
  const decoded = decodePolyline(run.map?.polyline || run.map?.summary_polyline || "");
  if (decoded.length) return decoded;
  return [run.start_latlng, run.end_latlng].filter((point) => Array.isArray(point) && point.length === 2);
}

function hasDetailedRoute(run) {
  return (Array.isArray(run.route_points) && run.route_points.length > 2)
    || Boolean(run.map?.polyline || run.map?.summary_polyline);
}

function weatherCodeLabel(code) {
  const value = Number(code);
  if (value === 0) return "Clear";
  if ([1, 2].includes(value)) return "Partly cloudy";
  if (value === 3) return "Overcast";
  if ([45, 48].includes(value)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(value)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "Snow";
  if ([95, 96, 99].includes(value)) return "Thunderstorms";
  return "Conditions recorded";
}

function runWeatherKey(run) {
  const start = String(run.start_date_local || run.start_date || "");
  const point = activityRoutePoints(run)[0];
  return point ? `${run.id}:${start.slice(0, 13)}:${point[0].toFixed(3)}:${point[1].toFixed(3)}` : "";
}

function weatherRequestDetails(run) {
  const point = activityRoutePoints(run)[0];
  const start = String(run.start_date_local || run.start_date || "");
  const date = start.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const hour = start.match(/T(\d{2})/)?.[1];
  if (!point || !date || hour === undefined) return null;
  return { lat: point[0], lng: point[1], date, hour: Number(hour) };
}

function weatherLoadingMarkup() {
  return `
    <div class="workout-weather-state" aria-busy="true">
      <span class="workout-weather-pulse" aria-hidden="true"></span>
      <div><strong>Retrieving run-time conditions…</strong><small>Matched to the route start and local hour.</small></div>
    </div>
  `;
}

function weatherFailureMarkup(message) {
  return `
    <div class="workout-weather-state">
      <span class="workout-weather-unavailable" aria-hidden="true">—</span>
      <div><strong>Conditions unavailable</strong><small>${escapeHtml(message)}</small></div>
    </div>
  `;
}

function routeLoadingMarkup() {
  return `
    <div class="workout-map-empty" aria-busy="true">
      <strong>Loading route...</strong>
      <span>Fetching the detailed activity path from Strava.</span>
    </div>
  `;
}

function renderWorkoutWeather(weather) {
  const container = document.querySelector("#workoutWeatherContent");
  if (!container) return;
  if (!weather) {
    container.innerHTML = weatherFailureMarkup("This activity needs a route start and local timestamp.");
    return;
  }
  const feelsDifference = Math.round(weather.feelsLikeF - weather.temperatureF);
  const condition = weatherCodeLabel(weather.weatherCode);
  const sourceType = String(weather.sourceType || "");
  const sourceLabel = sourceType === "forecast"
    ? "Open-Meteo forecast"
    : sourceType === "historical forecast"
      ? "Open-Meteo historical forecast"
      : "Open-Meteo historical weather";
  container.innerHTML = `
    <div class="workout-weather-hero">
      <div>
        <span>${escapeHtml(condition)}</span>
        <strong>${Math.round(weather.temperatureF)}°</strong>
      </div>
      <p>Felt like ${Math.round(weather.feelsLikeF)}°${feelsDifference ? ` · ${Math.abs(feelsDifference)}° ${feelsDifference < 0 ? "cooler" : "warmer"}` : ""}</p>
    </div>
    <div class="workout-weather-grid">
      <article><span>Humidity</span><strong>${Math.round(weather.humidityPercent)}%</strong></article>
      <article><span>Wind</span><strong>${Math.round(weather.windSpeedMph)} mph</strong></article>
      <article><span>Gusts</span><strong>${Math.round(weather.windGustMph)} mph</strong></article>
      <article><span>Precip.</span><strong>${Number(weather.precipitationInches).toFixed(2)} in</strong></article>
    </div>
    <small class="workout-weather-source">${escapeHtml(sourceLabel)} · modeled conditions at the route start, not a watch measurement or Ollama estimate.</small>
  `;
}

async function hydrateRunWeather(digest) {
  const details = weatherRequestDetails(digest.run);
  const key = runWeatherKey(digest.run);
  const container = document.querySelector("#workoutWeatherContent");
  if (!details || !key) {
    digest.weather = null;
    renderWorkoutWeather(null);
    return null;
  }
  const cached = state.runWeatherCache.get(key);
  if (cached) {
    digest.weather = cached;
    renderWorkoutWeather(cached);
    return cached;
  }
  state.runWeatherAbort?.abort();
  const controller = new AbortController();
  state.runWeatherAbort = controller;
  if (container) container.innerHTML = weatherLoadingMarkup();
  try {
    const weather = await requestWeatherForRun(digest.run, controller.signal);
    if (state.activeRunId !== String(digest.run.id) || els.workoutModal.hidden) return null;
    digest.weather = weather;
    renderWorkoutWeather(weather);
    refreshFunStats();
    return weather;
  } catch (error) {
    if (error.name === "AbortError" || state.activeRunId !== String(digest.run.id) || els.workoutModal.hidden) return null;
    digest.weather = null;
    if (container) container.innerHTML = weatherFailureMarkup(error.message);
    return null;
  } finally {
    if (state.runWeatherAbort === controller) state.runWeatherAbort = null;
  }
}

function renderWorkoutMap(run) {
  const container = document.querySelector("#workoutMap");
  const openLink = document.querySelector("#workoutMapLink");
  state.workoutMap?.remove();
  state.workoutMap = null;
  if (!container) return;
  const points = activityRoutePoints(run);
  if (!window.L || !points.length) {
    container.innerHTML = `<div class="workout-map-empty"><strong>Route unavailable</strong><span>Strava did not include map coordinates for this activity.</span></div>`;
    if (openLink) openLink.hidden = true;
    return;
  }
  const [startLat, startLng] = points[0];
  if (openLink) {
    openLink.hidden = false;
    openLink.href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(startLat)}&mlon=${encodeURIComponent(startLng)}#map=14/${encodeURIComponent(startLat)}/${encodeURIComponent(startLng)}`;
  }
  container.replaceChildren();
  const map = window.L.map(container, {
    scrollWheelZoom: false,
    zoomControl: true,
    attributionControl: true
  });
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  let route = null;
  if (points.length > 1) {
    route = window.L.polyline(points, {
      color: "#fc4c02",
      weight: 5,
      opacity: 0.96,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);
    window.L.circleMarker(points[0], { radius: 6, color: "#ffffff", weight: 3, fillColor: "#35bba8", fillOpacity: 1 }).addTo(map);
    window.L.circleMarker(points[points.length - 1], { radius: 6, color: "#ffffff", weight: 3, fillColor: "#fc4c02", fillOpacity: 1 }).addTo(map);
    map.fitBounds(route.getBounds(), { padding: [28, 28], maxZoom: 15 });
  } else {
    window.L.marker(points[0]).addTo(map);
    map.setView(points[0], 14);
  }
  state.workoutMap = map;
  const settleMap = () => {
    if (state.workoutMap !== map || !document.body.contains(container)) return;
    map.invalidateSize({ pan: false });
    if (points.length > 1) map.fitBounds(route.getBounds(), { padding: [28, 28], maxZoom: 15 });
  };
  requestAnimationFrame(settleMap);
  window.setTimeout(settleMap, 160);
}

async function requestActivityRoute(run, signal) {
  const response = await fetch(`/api/activities/${encodeURIComponent(String(run.id))}`, { signal });
  const data = await readApiJson(response);
  if (!response.ok) throw new Error(data.error || "Unable to fetch the Strava route.");
  return data.activity || null;
}

function applyActivityDetailRoute(run, detail) {
  const detailMap = detail?.map || {};
  if (Array.isArray(detail?.start_latlng)) run.start_latlng = detail.start_latlng;
  if (Array.isArray(detail?.end_latlng)) run.end_latlng = detail.end_latlng;
  run.map = { ...(run.map || {}) };
  if (detailMap.polyline) run.map.polyline = detailMap.polyline;
  if (detailMap.summary_polyline) run.map.summary_polyline = detailMap.summary_polyline;
  if (Array.isArray(detail?.route_points) && detail.route_points.length) run.route_points = detail.route_points;
}

async function hydrateRunRoute(run) {
  const container = document.querySelector("#workoutMap");
  const activityId = String(run.id || "");
  if (hasDetailedRoute(run) || state.dataSource !== "Strava" || !state.stravaConnected || !/^\d+$/.test(activityId)) {
    renderWorkoutMap(run);
    return;
  }
  if (state.runRouteCache.has(activityId)) {
    const cached = state.runRouteCache.get(activityId);
    if (cached) applyActivityDetailRoute(run, cached);
    renderWorkoutMap(run);
    return;
  }
  state.runRouteAbort?.abort();
  const controller = new AbortController();
  state.runRouteAbort = controller;
  if (container) container.innerHTML = routeLoadingMarkup();
  try {
    const detail = await requestActivityRoute(run, controller.signal);
    if (state.activeRunId !== String(run.id) || els.workoutModal.hidden) return;
    state.runRouteCache.set(activityId, detail);
    applyActivityDetailRoute(run, detail);
    renderWorkoutMap(run);
  } catch (error) {
    if (error.name === "AbortError" || state.activeRunId !== String(run.id) || els.workoutModal.hidden) return;
    renderWorkoutMap(run);
  } finally {
    if (state.runRouteAbort === controller) state.runRouteAbort = null;
  }
}

function percentileRank(values, value, higherIsBetter = true) {
  const clean = values.filter((candidate) => Number.isFinite(candidate) && candidate > 0);
  if (!clean.length || !Number.isFinite(value) || value <= 0) return 0;
  const count = clean.filter((candidate) => higherIsBetter ? candidate <= value : candidate >= value).length;
  return Math.round((count / clean.length) * 100);
}

function classifyRun(run, distanceMiles, pace, distanceRank, paceRank) {
  const name = String(run.name || "").toLowerCase();
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
    weather: state.runWeatherCache.get(runWeatherKey(run)) || null,
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
  const weather = digest.weather || state.runWeatherCache.get(runWeatherKey(run)) || null;
  const summary = summarize(state.filteredRuns, state.buckets);
  const averageHr = Number(run.average_heartrate) || 0;
  const rawCadence = Number(run.average_cadence) || 0;
  const cadence = rawCadence && rawCadence < 120 ? rawCadence * 2 : rawCadence;
  const paceDifference = digest.similarPace ? Math.round(digest.pace - digest.similarPace) : 0;
  const loadDifferencePercent = digest.similarLoadPerMile
    ? Math.round(((digest.loadPerMile - digest.similarLoadPerMile) / digest.similarLoadPerMile) * 100)
    : 0;
  const heartRateDifference = averageHr && digest.similarHr ? Math.round(averageHr - digest.similarHr) : null;
  const terrainDifference = digest.similarElevationDensity
    ? Math.round(digest.elevationDensity - digest.similarElevationDensity)
    : null;
  const relationshipStrength = (first, firstThreshold, second, secondThreshold) => {
    if (first === null || second === null) return 0;
    const firstWeight = Math.min(2, Math.abs(first) / firstThreshold);
    const secondWeight = Math.min(2, Math.abs(second) / secondThreshold);
    return Math.round(((firstWeight + secondWeight) / 4) * 100);
  };
  const paceLoadPattern = Math.abs(paceDifference) <= 5 && Math.abs(loadDifferencePercent) <= 8
    ? "stability"
    : paceDifference < -5 && loadDifferencePercent <= 8
      ? "alignment"
      : paceDifference < -5 && loadDifferencePercent > 8
        ? "tradeoff"
        : "divergence";
  const weatherStress = weather
    ? Math.min(100, Math.round(
      Math.max(0, Number(weather.feelsLikeF) - 72) * 2.2
      + Math.max(0, 45 - Number(weather.feelsLikeF)) * 1.6
      + Math.max(0, Number(weather.humidityPercent) - 65) * 0.55
      + Number(weather.windSpeedMph) * 1.2
      + Number(weather.precipitationInches) * 240
    ))
    : 0;
  const weatherPattern = !weather || weatherStress < 28
    ? "stability"
    : paceDifference < -5 && loadDifferencePercent <= 8
      ? "divergence"
      : loadDifferencePercent > 8
        ? "tradeoff"
        : "context";
  const relationships = [
    digest.similarCount && digest.similarLoadPerMile ? {
      id: "pace_load",
      pattern: paceLoadPattern,
      strength: relationshipStrength(paceDifference, 5, loadDifferencePercent, 8),
      coverage: Number(run.suffer_score) > 0 ? 100 : 60
    } : null,
    digest.similarCount && heartRateDifference !== null && digest.hrCoverage >= 50 ? {
      id: "pace_heart_rate",
      pattern: Math.abs(paceDifference) <= 5 && Math.abs(heartRateDifference) <= 3
        ? "stability"
        : Math.sign(paceDifference) === Math.sign(heartRateDifference) ? "alignment" : "tradeoff",
      strength: relationshipStrength(paceDifference, 5, heartRateDifference, 3),
      coverage: digest.hrCoverage
    } : null,
    digest.similarCount && terrainDifference !== null ? {
      id: "terrain_pace",
      pattern: Math.abs(terrainDifference) <= 15 && Math.abs(paceDifference) <= 5
        ? "stability"
        : Math.sign(terrainDifference) === Math.sign(paceDifference) ? "alignment" : "divergence",
      strength: relationshipStrength(terrainDifference, 15, paceDifference, 5),
      coverage: 100
    } : null,
    digest.previousGap !== null ? {
      id: "spacing_load",
      pattern: digest.previousGap <= 1 && digest.loadRank >= 75 ? "tradeoff"
        : digest.previousGap >= 5 && digest.loadRank >= 75 ? "alignment" : "stability",
      strength: Math.min(100, Math.round(Math.abs(digest.loadRank - 50) + (digest.previousGap <= 1 || digest.previousGap >= 5 ? 35 : 10))),
      coverage: 100
    } : null,
    {
      id: "distance_load",
      pattern: Math.abs(digest.distanceRank - digest.loadRank) <= 15 ? "alignment" : "divergence",
      strength: Math.min(100, Math.round((Math.abs(digest.distanceRank - 50) + Math.abs(digest.loadRank - 50)))),
      coverage: Number(run.suffer_score) > 0 ? 100 : 60
    },
    weather ? {
      id: "weather_pace",
      pattern: weatherPattern,
      strength: Math.min(100, Math.round(weatherStress * 0.62 + Math.abs(paceDifference) * 1.8)),
      coverage: 100
    } : null,
    weather ? {
      id: "weather_load",
      pattern: weatherPattern,
      strength: Math.min(100, Math.round(weatherStress * 0.62 + Math.abs(loadDifferencePercent) * 1.2)),
      coverage: 100
    } : null
  ].filter(Boolean).sort((a, b) => b.strength - a.strength);
  const verifiedFacts = [
    `This run: ${digest.distance.toFixed(2)} miles at ${formatPace(digest.pace)}, with ${Math.round(digest.elevation)} feet of elevation and an app-calculated ${digest.loadPerMile.toFixed(1)} load-per-mile score.`,
    averageHr ? `Heart-rate context: ${Math.round(averageHr)} bpm average for this run.` : null,
    digest.similarCount
      ? `Across ${digest.similarCount} similar-distance runs, the benchmark pace was ${formatPace(digest.similarPace)}; this run was ${Math.abs(paceDifference)} sec/mi ${paceDifference <= 0 ? "faster" : "slower"}.`
      : "There are no usable similar-distance runs for a pace benchmark.",
    digest.similarCount && digest.similarLoadPerMile
      ? `The similar-run load-per-mile benchmark was ${digest.similarLoadPerMile.toFixed(1)}; this run was ${Math.abs(loadDifferencePercent)}% ${loadDifferencePercent >= 0 ? "higher" : "lower"}.`
      : null,
    `Window position: distance percentile ${digest.distanceRank}, pace percentile ${digest.paceRank}, and load percentile ${digest.loadRank}.`,
    digest.previousGap === null
      ? "No previous run is available inside the selected window."
      : `This run started ${digest.previousGap} days after the previous run in the selected window.`,
    weather
      ? `Open-Meteo modeled start conditions: ${weather.condition || weatherCodeLabel(weather.weatherCode)}, ${Math.round(weather.temperatureF)}°F, felt like ${Math.round(weather.feelsLikeF)}°F, ${Math.round(weather.humidityPercent)}% humidity, and ${Math.round(weather.windSpeedMph)} mph wind.`
      : null
  ].filter(Boolean);
  return {
    kind: "run",
    focus: state.activeRunFocus,
    verifiedFacts,
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
      heartRateDifference,
      similarLoadPerMile: digest.similarLoadPerMile ? Number(digest.similarLoadPerMile.toFixed(1)) : null,
      loadPerMileDifferencePercent: digest.similarLoadPerMile ? loadDifferencePercent : null,
      daysSincePreviousRun: digest.previousGap,
      daysUntilNextRun: digest.nextGap,
      similarElevationFeetPerMile: digest.similarElevationDensity ? Math.round(digest.similarElevationDensity) : null,
      elevationDifferenceFeetPerMile: terrainDifference
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
    weather: weather ? {
      condition: weather.condition || weatherCodeLabel(weather.weatherCode),
      temperatureF: Math.round(weather.temperatureF),
      feelsLikeF: Math.round(weather.feelsLikeF),
      humidityPercent: Math.round(weather.humidityPercent),
      windSpeedMph: Math.round(weather.windSpeedMph),
      windGustMph: Math.round(weather.windGustMph),
      precipitationInches: Number(Number(weather.precipitationInches).toFixed(2)),
      source: weather.source,
      sourceType: weather.sourceType,
      observedAt: weather.observedAt,
      weatherStress
    } : null,
    relationships,
    coverage: {
      similarRunCount: digest.similarCount,
      similarHeartRatePercent: digest.hrCoverage,
      directLoad: Number(run.suffer_score) > 0,
      hasPreviousRun: Boolean(digest.previousRun),
      hasNextRun: Boolean(digest.nextRun),
      hasWeather: Boolean(weather)
    }
  };
}

function runInsightLoadingMarkup() {
  return `
    <div class="workout-ai-loading" aria-busy="true">
      <span class="workout-ai-pulse" aria-hidden="true"></span>
      <div>
        <strong>Reading this effort in context…</strong>
        <p>Comparing similar-distance runs, training context, and sourced conditions when available.</p>
      </div>
    </div>
  `;
}

function renderRunInsightResult(result) {
  const content = document.querySelector("#workoutAiContent");
  if (!content) return;
  const insight = result.insight;
  const model = document.querySelector("#workoutAiModel");
  const trainingReadLabels = {
    easy_aerobic: "Easy / aerobic",
    recovery: "Recovery",
    steady: "Steady",
    long_run: "Long run",
    tempo_threshold: "Tempo / threshold",
    intervals: "Intervals",
    hills: "Hills",
    progression: "Progression",
    race_test: "Race / time trial",
    mixed: "Mixed workout",
    unknown: "Type not established"
  };
  if (model) model.textContent = result.model || "qwen3:1.7b";
  content.innerHTML = `
    <div class="workout-ai-result">
      <h4>${escapeHtml(insight.headline)}</h4>
      <p class="workout-ai-read">${escapeHtml(insight.read)}</p>
      <div class="workout-ai-evidence">
        <span>Evidence: ${escapeHtml(insight.answerability || "Partial")}</span>
        <span>Confidence: ${escapeHtml(insight.confidence || "Medium")}</span>
        ${insight.limitation ? `<span>${escapeHtml(insight.limitation)}</span>` : ""}
      </div>
      <div class="workout-ai-training-lens">
        <span>Workout lens</span>
        <strong>${escapeHtml(trainingReadLabels[insight.trainingRead] || trainingReadLabels.unknown)}</strong>
        <p>${escapeHtml(insight.trainingReadBasis || "The supplied activity does not establish a specific workout type.")}</p>
      </div>
      <div class="workout-ai-analysis">
        <span>${escapeHtml(insight.analysisLabel || "Analytical frame")}</span>
        <p>${escapeHtml(insight.analysis || "A stronger relationship read needs more comparable runs.")}</p>
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
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 130_000);
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
    if ((error.name === "AbortError" && !timedOut) || state.activeRunInsightKey !== key || els.workoutModal.hidden) return;
    renderRunInsightError(timedOut ? "The model took too long to answer. Try again once the Ollama service is warm." : error.message, digest.run.id);
  } finally {
    window.clearTimeout(timeoutId);
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
      <section class="workout-environment" aria-label="Conditions and route">
        <article class="workout-map-panel">
          <div class="workout-environment-heading">
            <div><span>Route</span><h3>Where the work happened.</h3></div>
            <a id="workoutMapLink" href="#" target="_blank" rel="noreferrer" hidden>Open map ↗</a>
          </div>
          <div id="workoutMap" class="workout-map" aria-label="Interactive workout route map"></div>
        </article>
        <article class="workout-weather-panel">
          <div class="workout-environment-heading">
            <div><span>Conditions</span><h3>What the day added.</h3></div>
          </div>
          <div id="workoutWeatherContent" class="workout-weather-content" aria-live="polite">${weatherLoadingMarkup()}</div>
        </article>
      </section>
      <section class="workout-ai" aria-labelledby="workoutAiTitle">
        <div class="workout-ai-heading">
          <div>
            <p class="workout-ai-kicker"><span class="ai-status-dot" aria-hidden="true"></span> Ollama run read</p>
            <h3 id="workoutAiTitle">A second look at this effort.</h3>
          </div>
          <span id="workoutAiModel">qwen3:1.7b</span>
        </div>
        <div class="workout-ai-focus" role="group" aria-label="Run analysis focus">
          <button type="button" data-action="run-focus" data-focus="balanced" aria-pressed="true">Overall</button>
          <button type="button" data-action="run-focus" data-focus="standout" aria-pressed="false">Why it stands out</button>
          <button type="button" data-action="run-focus" data-focus="load" aria-pressed="false">Load</button>
          <button type="button" data-action="run-focus" data-focus="spacing" aria-pressed="false">Spacing</button>
          <button type="button" data-action="run-focus" data-focus="weather" aria-pressed="false">Weather</button>
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
  requestAnimationFrame(() => hydrateRunRoute(run));
  hydrateRunWeather(digest).finally(() => {
    if (state.activeRunId === String(run.id) && !els.workoutModal.hidden) {
      requestRunInsight(buildWorkoutDigest(run));
    }
  });
}

function closeWorkoutModal() {
  state.runInsightAbort?.abort();
  state.runInsightAbort = null;
  state.runWeatherAbort?.abort();
  state.runWeatherAbort = null;
  state.runRouteAbort?.abort();
  state.runRouteAbort = null;
  state.workoutMap?.remove();
  state.workoutMap = null;
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

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCurrentView() {
  if (!state.filteredRuns.length) return;
  const types = activityRunTypes(state.filteredRuns);
  const headers = ["Date", "Name", "Profile", "Distance (mi)", "Pace (sec/mi)", "Moving time (sec)", "Elevation (ft)", "Average HR (bpm)", "Training load", "Load per mile"];
  const rows = state.filteredRuns.map((run) => {
    const distance = miles(run.distance);
    const load = activityLoad(run);
    return [
      localDateValue(parseActivityDate(run)),
      run.name,
      types.get(String(run.id)) || "Run",
      distance.toFixed(2),
      Math.round(paceSeconds(run)),
      Math.round(Number(run.moving_time) || 0),
      Math.round(feet(run.total_elevation_gain)),
      run.average_heartrate ? Math.round(run.average_heartrate) : "",
      Math.round(load),
      distance ? (load / distance).toFixed(1) : ""
    ].map(csvCell).join(",");
  });
  const csv = `${headers.map(csvCell).join(",")}\r\n${rows.join("\r\n")}\r\n`;
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const { start, end } = getRangeDates();
  const startName = start ? localDateValue(start) : "window";
  const endName = end ? localDateValue(end) : "current";
  link.href = URL.createObjectURL(blob);
  link.download = `stride-${startName}-to-${endName}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setStatus(`Exported ${state.filteredRuns.length} runs from the selected window.`);
}

async function fetchActivities() {
  state.activityAbort?.abort();
  const controller = new AbortController();
  const requestId = ++state.activityRequestId;
  state.activityAbort = controller;
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 45_000);
  try {
    setStatus("Pulling activities from Strava...");
    const { start, end } = getStravaFetchRange();
    const pages = els.rangeSelect.value === "all" ? "12" : "8";
    const params = new URLSearchParams({ pages, per_page: "100" });
    if (start) params.set("after", Math.floor(start.getTime() / 1000));
    if (end) params.set("before", Math.floor(end.getTime() / 1000));
    const response = await fetch(`/api/activities?${params}`, { signal: controller.signal });
    const data = await readApiJson(response);
    if (!response.ok) throw new Error(data.error || "Unable to fetch Strava activities.");
    if (!Array.isArray(data.activities)) throw new Error("Strava returned no activity list.");
    if (requestId !== state.activityRequestId) return;
    state.rawActivities = data.activities;
    state.dataSource = "Strava";
    state.activityTruncated = Boolean(data.truncated);
    state.runRouteCache.clear();
    syncRangeInputs();
    const historyNote = state.activityTruncated ? " History request reached its page limit; older runs may be missing." : "";
    setStatus(`Loaded ${data.activities.length} activities from Strava.${historyNote}`);
    render();
  } catch (error) {
    if (error.name === "AbortError" && !timedOut) return;
    if (requestId !== state.activityRequestId) return;
    throw new Error(timedOut ? "Strava activity request timed out. Try again." : error.message);
  } finally {
    window.clearTimeout(timeoutId);
    if (state.activityAbort === controller) state.activityAbort = null;
  }
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
  const response = await fetch("/api/status", { signal: AbortSignal.timeout(15_000) });
  const data = await readApiJson(response);
  if (!response.ok) {
    state.stravaReady = false;
    state.stravaConnected = false;
    state.stravaError = data.error || "Unable to reach the Strava API route.";
    els.connectButton.disabled = false;
    els.connectButton.textContent = "Connect Strava";
    els.connectButton.title = state.stravaError;
    els.disconnectButton.hidden = true;
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
    els.disconnectButton.hidden = true;
    if (state.dataSource === "Demo") {
      setStatus("Loaded demo running history. Strava is not configured for this server.");
      return;
    }
    setStatus(`${state.stravaError} You can still import an export file or use demo data.`, true);
    return;
  }
  state.stravaReady = true;
  state.stravaConnected = Boolean(data.connected);
  state.stravaError = "";
  els.connectButton.disabled = false;
  els.connectButton.title = "";
  els.disconnectButton.hidden = !data.connected;
  if (data.connected) {
    els.connectButton.textContent = "Refresh Strava";
    if (state.dataSource !== "Demo") await fetchActivities();
    else setStatus("Loaded demo running history.");
  } else if (state.dataSource === "Demo") {
    setStatus("Loaded demo running history. Connect Strava to replace it.");
  } else {
    setStatus(`Ready to connect. Callback URL: ${data.redirectUri}`);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  const headers = (rows.shift() || []).map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim());
  return rows.map((values) => headers.reduce((result, header, index) => {
    if (header) result[header] = values[index] || "";
    return result;
  }, {}));
}

async function importFile(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose an export smaller than 20 MB.");
  const text = await file.text();
  const data = file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : JSON.parse(text);
  const activities = Array.isArray(data) ? data : Array.isArray(data?.activities) ? data.activities : [];
  if (!activities.length) throw new Error("The file did not contain any activities.");
  state.rawActivities = activities;
  state.dataSource = "Import";
  state.activityTruncated = false;
  state.runRouteCache.clear();
  resetRunBrowser();
  syncRangeInputs();
  const runCount = state.rawActivities.filter((activity) => isRun(normalizeActivity(activity))).length;
  if (!runCount) throw new Error("The file did not contain any running activities.");
  setStatus(`Imported ${state.rawActivities.length} activities, including ${runCount} runs.`);
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
    const routeCenter = [42.355 + (i % 7) * 0.006, -71.075 + (i % 5) * 0.007];
    const routeRadius = 0.012 + Math.min(0.02, distanceMiles * 0.0012);
    const routePoints = Array.from({ length: 32 }, (_, pointIndex) => {
      const progress = pointIndex / 31;
      const angle = progress * Math.PI * 2;
      const wobble = 1 + 0.16 * Math.sin(angle * (2 + i % 3));
      return [
        Number((routeCenter[0] + Math.sin(angle) * routeRadius * 0.62 * wobble).toFixed(6)),
        Number((routeCenter[1] + Math.cos(angle) * routeRadius * wobble).toFixed(6))
      ];
    });
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
      pr_count: random() > 0.9 ? 1 : 0,
      start_latlng: routePoints[0],
      end_latlng: routePoints[routePoints.length - 1],
      route_points: routePoints
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

els.disconnectButton.addEventListener("click", () => {
  window.location.href = "/auth/logout";
});

els.demoButton.addEventListener("click", () => {
  state.rawActivities = makeDemoData();
  state.dataSource = "Demo";
  state.activityTruncated = false;
  state.runRouteCache.clear();
  resetRunBrowser();
  syncRangeInputs();
  setStatus("Loaded demo running history.");
  render();
});

els.exportViewButton.addEventListener("click", exportCurrentView);

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

els.trainingBriefSignals.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='open-hardest-run']");
  if (button?.dataset.runId) showWorkoutModal(button.dataset.runId, button);
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
  syncViewUrl();
  renderTable();
});

[els.activityType, els.activitySort].forEach((element) => {
  element.addEventListener("change", () => {
    state.activityVisible = 15;
    syncViewUrl();
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

restoreViewFromUrl();
syncRangeInputs();
bindTooltips();
setupSectionNavigation();
render();
checkStatus().catch((error) => setStatus(error.message, true));
