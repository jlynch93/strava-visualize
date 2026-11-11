const state = {
  rawActivities: [],
  filteredRuns: [],
  buckets: [],
  status: null,
  stravaReady: false,
  stravaConnected: false,
  stravaError: "",
  modalTrigger: null,
  modalSession: 0,
  activeRunId: "",
  activeRunWeather: null,
  runWeatherCache: new Map(),
  runWeatherPending: new Map(),
  runDigestCache: new Map(),
  runDigestAbort: null,
  insightFingerprint: "",
  renderedInsightFingerprint: "",
  textureWeatherFingerprint: "",
  dataSource: "",
  ledgerPage: 0,
  syncing: false
};

const els = {
  connectButton: document.querySelector("#connectButton"),
  demoButton: document.querySelector("#demoButton"),
  fileInput: document.querySelector("#fileInput"),
  emptyConnectButton: document.querySelector("#emptyConnectButton"),
  emptyDemoButton: document.querySelector("#emptyDemoButton"),
  emptyFileInput: document.querySelector("#emptyFileInput"),
  heroStatus: document.querySelector("#heroStatus"),
  rangeSelect: document.querySelector("#rangeSelect"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  bucketSelect: document.querySelector("#bucketSelect"),
  metricSelect: document.querySelector("#metricSelect"),
  status: document.querySelector("#status"),
  tooltip: document.querySelector("#chartTooltip"),
  blockReviewTitle: document.querySelector("#blockReviewTitle"),
  blockReviewSummary: document.querySelector("#blockReviewSummary"),
  blockEvidence: document.querySelector("#blockEvidence"),
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
  trainingTextureStats: document.querySelector("#trainingTextureStats"),
  aiFocus: document.querySelector("#aiFocus"),
  coachQuestion: document.querySelector("#coachQuestion"),
  aiAnalyzeButton: document.querySelector("#aiAnalyzeButton"),
  aiInsightContent: document.querySelector("#aiInsightContent"),
  activityRows: document.querySelector("#activityRows"),
  activityCount: document.querySelector("#activityCount"),
  keyRuns: document.querySelector("#keyRuns"),
  goalForm: document.querySelector("#goalForm"),
  goalMode: document.querySelector("#goalMode"),
  goalMiles: document.querySelector("#goalMiles"),
  goalRaceName: document.querySelector("#goalRaceName"),
  goalRaceDistance: document.querySelector("#goalRaceDistance"),
  goalRaceDate: document.querySelector("#goalRaceDate"),
  goalRunDays: document.querySelector("#goalRunDays"),
  goalLongRunDay: document.querySelector("#goalLongRunDay"),
  goalAvailability: document.querySelector("#goalAvailability"),
  intentRecommendation: document.querySelector("#intentRecommendation"),
  checkinForm: document.querySelector("#checkinForm"),
  checkinFeel: document.querySelector("#checkinFeel"),
  checkinLimiter: document.querySelector("#checkinLimiter"),
  checkinIntent: document.querySelector("#checkinIntent"),
  checkinOutcome: document.querySelector("#checkinOutcome"),
  readinessContent: document.querySelector("#readinessContent"),
  planDraftCopy: document.querySelector("#planDraftCopy"),
  planAdaptation: document.querySelector("#planAdaptation"),
  recommendedCalendar: document.querySelector("#recommendedCalendar"),
  copyPlanButton: document.querySelector("#copyPlanButton"),
  runSearch: document.querySelector("#runSearch"),
  runSort: document.querySelector("#runSort"),
  pageSummary: document.querySelector("#pageSummary"),
  previousPage: document.querySelector("#previousPage"),
  nextPage: document.querySelector("#nextPage"),
  ledgerEmpty: document.querySelector("#ledgerEmpty"),
  workoutModal: document.querySelector("#workoutModal"),
  workoutModalClose: document.querySelector("#workoutModalClose"),
  workoutModalContent: document.querySelector("#workoutModalContent")
};

const CONTEXT_STORAGE_KEY = "run-trends-coaching-context-v1";
let coachingContext = loadCoachingContext();

function loadCoachingContext() {
  try {
    return sanitizeCoachingContext(JSON.parse(localStorage.getItem(CONTEXT_STORAGE_KEY)));
  } catch { return { goal: {}, checkin: {}, plan: {} }; }
}

function sanitizeCoachingContext(saved) {
  const defaults = { goal: {}, checkin: {}, plan: {} };
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
  const record = (value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value)
      .filter(([, field]) => typeof field === "string" || typeof field === "number")
      .map(([key, field]) => [key, String(field)]))
    : {};
  return { goal: record(saved.goal), checkin: record(saved.checkin), plan: record(saved.plan) };
}

function saveCoachingContext() {
  return persist(CONTEXT_STORAGE_KEY, coachingContext);
}

function syncCoachingInputs() {
  els.goalMode.value = coachingContext.goal.mode || "auto";
  els.goalMiles.value = coachingContext.goal.miles ? (preferences.units === "metric" ? (Number(coachingContext.goal.miles) * 1.609344).toFixed(1) : coachingContext.goal.miles) : "";
  els.goalRaceName.value = coachingContext.goal.raceName || coachingContext.goal.event || "";
  els.goalRaceDistance.value = coachingContext.goal.raceDistance || "";
  els.goalRaceDate.value = coachingContext.goal.raceDate || "";
  els.goalRunDays.value = coachingContext.goal.runDays || "";
  els.goalLongRunDay.value = coachingContext.goal.longRunDay || "Sat";
  els.goalAvailability.value = coachingContext.goal.availability || "";
  document.querySelectorAll(".day-toggles input").forEach((input) => input.checked = els.goalAvailability.value.toLowerCase().includes(input.value.toLowerCase()));
  els.checkinFeel.value = coachingContext.checkin.feel || "";
  els.checkinLimiter.value = coachingContext.checkin.limiter || "none";
  els.checkinIntent.value = coachingContext.checkin.intent || "mixed";
  els.checkinOutcome.value = coachingContext.checkin.outcome || "";
}

const METRICS = {
  distance: { tick: (v) => displayDistance(v, 0), label: "Distance", unit: "mi", value: (b) => b.distanceMiles, format: (v) => `${displayDistance(v, 1)}` },
  runs: { label: "Run count", unit: "runs", value: (b) => b.runs, format: (v) => `${Math.round(v)} runs` },
  avgRun: { tick: (v) => displayDistance(v, 0), label: "Average run", unit: "mi", value: (b) => b.runs ? b.distanceMiles / b.runs : 0, format: (v) => `${displayDistance(v, 1)}` },
  longRun: { tick: (v) => displayDistance(v, 0), label: "Long run", unit: "mi", value: (b) => b.longRunMiles, format: (v) => `${displayDistance(v, 1)}` },
  pace: { label: "Pace", unit: "/mi", value: (b) => b.averagePace, format: formatPace },
  elevation: { label: "Elevation", unit: "ft", value: (b) => b.elevationFeet, format: (v) => `${Math.round(v).toLocaleString()} ft` },
  elevationDensity: { label: "Climb per mile", unit: "ft/mi", value: (b) => b.distanceMiles ? b.elevationFeet / b.distanceMiles : 0, format: (v) => `${Math.round(v)} ft/mi` },
  heartrate: { label: "Heart rate", unit: "bpm", value: (b) => b.averageHr, format: (v) => v ? `${Math.round(v)} bpm` : "-" },
  load: { label: "Running time", unit: "min", value: (b) => b.trainingLoad, format: (v) => `${Math.round(v).toLocaleString()} min` },
  loadPerMile: { label: "Time per distance", unit: "min/mi", value: (b) => b.distanceMiles ? b.trainingLoad / b.distanceMiles : 0, format: (v) => `${v.toFixed(1)} min/mi` },
};

function setStatus(message, isError = false, scopeId) {
  els.status.textContent = message || "";
  els.status.classList.toggle("error", isError);
  els.status.hidden = actionFeedback(message || "", isError, scopeId);
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
  const rounded = Math.round(seconds / (preferences.units === "metric" ? 1.609344 : 1));
  const minutes = Math.floor(rounded / 60);
  const remainder = (rounded % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}/${preferences.units === "metric" ? "km" : "mi"}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function dateOnly(date) {
  return localDateValue(date);
}

function localDateValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function parseActivityDate(activity) {
  // Strava's local timestamp represents the activity's wall-clock time, even
  // when its API value ends in Z. Keep that local calendar day when grouping.
  const local = activity.start_date_local;
  const value = local
    ? String(local).replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, "")
    : activity.start_date;
  if (!value) return new Date(NaN);
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value);
}

function isRun(activity) {
  const sport = String(activity.sport_type || activity.type || "").toLowerCase();
  return sport.includes("run");
}

function normalizeLatLng(value) {
  const pair = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/[\[\]()]/g, "").split(",")
      : [];
  if (pair.length !== 2 || pair.some((coordinate) => coordinate == null || String(coordinate).trim() === "")) return null;
  const latitude = Number(pair[0]);
  const longitude = Number(pair[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return [latitude, longitude];
}

function normalizeActivity(activity) {
  const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
  const number = (...values) => {
    const value = Number(first(...values));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const duration = (...values) => {
    const value = first(...values);
    if (typeof value === "string" && /^\d+(?::\d{1,2}){1,2}$/.test(value.trim())) {
      return value.trim().split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0);
    }
    return number(value);
  };
  // In a Strava bulk export, the repeated Distance column is the precise
  // distance in meters; its earlier display column is in kilometers.
  const exportDistance = activity.Distance__2 !== undefined
    ? number(activity.Distance__2)
    : number(activity.Distance) * (activity["Activity ID"] !== undefined ? 1000 : 1);
  const startDate = first(activity.start_date, activity["Activity Date"], activity.start_date_local);
  const startLatLng = normalizeLatLng(activity.start_latlng || activity["Start LatLng"])
    || normalizeLatLng([activity.start_latitude ?? activity["Start Latitude"], activity.start_longitude ?? activity["Start Longitude"]]);
  return {
    id: first(activity.id, activity["Activity ID"]) ?? crypto.randomUUID(),
    name: String(first(activity.name, activity["Activity Name"]) || "Untitled run"),
    sport_type: String(first(activity.sport_type, activity.type, activity["Activity Type"]) || "Run"),
    start_date: startDate,
    start_date_local: activity.start_date_local || "",
    distance: activity.distance !== undefined ? number(activity.distance) : exportDistance,
    moving_time: duration(activity.moving_time, activity["Moving Time"], activity.elapsed_time, activity["Elapsed Time__2"], activity["Elapsed Time"]),
    elapsed_time: duration(activity.elapsed_time, activity["Elapsed Time__2"], activity["Elapsed Time"], activity.moving_time, activity["Moving Time"]),
    total_elevation_gain: number(activity.total_elevation_gain, activity["Elevation Gain"]),
    has_elevation: activity.has_elevation !== undefined ? activity.has_elevation === true || activity.has_elevation === "true" : first(activity.total_elevation_gain, activity["Elevation Gain"]) !== undefined,
    average_heartrate: number(activity.average_heartrate, activity["Average Heart Rate"]),
    max_heartrate: number(activity.max_heartrate, activity["Max Heart Rate__2"], activity["Max Heart Rate"]),
    average_cadence: number(activity.average_cadence, activity["Average Cadence"]),
    average_watts: number(activity.average_watts, activity["Average Watts"]),
    max_speed: number(activity.max_speed, activity["Max Speed"]),
    suffer_score: number(activity.suffer_score, activity["Relative Effort__2"], activity["Relative Effort"]),
    kudos_count: number(activity.kudos_count, activity.Kudos),
    achievement_count: number(activity.achievement_count, activity.Achievements),
    pr_count: number(activity.pr_count, activity.PRs),
    workout_type: number(activity.workout_type, activity["Workout Type"]),
    device_name: String(first(activity.device_name, activity["Device Name"]) || ""),
    description: String(first(activity.description, activity.Description, activity["Activity Description"]) || ""),
    trainer: activity.trainer === true || activity.trainer === "true",
    start_latlng: startLatLng
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
    const date = new Date(Number(year), Number(month) - 1, 1);
    return `${date.toLocaleDateString(undefined, { month: "short" })} ’${String(date.getFullYear()).slice(2)}`;
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
  document.body.classList.toggle("is-custom-range", mode === "custom");
  let start = new Date(bounds.start);
  const end = new Date(bounds.end);
  if (mode !== "all" && mode !== "custom") {
    start = new Date(end);
    start.setDate(start.getDate() - Number(mode) + 1);
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
    bucket.trainingLoad += runMinutes(run);
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
  // Duration is the consistent workload proxy; HR is context, not a universal zone.
  return 1;
}

function summarize(runs, buckets, range = getRangeDates()) {
  const totalMiles = runs.reduce((sum, run) => sum + miles(run.distance), 0);
  const totalSeconds = runs.reduce((sum, run) => sum + (Number(run.moving_time) || 0), 0);
  const longRun = runs.reduce((max, run) => Math.max(max, miles(run.distance)), 0);
  const totalElevation = runs.reduce((sum, run) => sum + feet(run.total_elevation_gain), 0);
  const totalLoad = runs.reduce((sum, run) => sum + (runMinutes(run)), 0);
  const hrRuns = runs.filter((run) => run.average_heartrate);
  const weightedHr = hrRuns.reduce((sum, run) => sum + run.average_heartrate * (Number(run.moving_time) || 0), 0);
  const hrSeconds = hrRuns.reduce((sum, run) => sum + (Number(run.moving_time) || 0), 0);
  const activeDays = new Set(runs.map((run) => localDateValue(parseActivityDate(run)))).size;
  const calendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const hasRange = range.start instanceof Date && range.end instanceof Date && range.end >= range.start;
  const spanDays = hasRange ? Math.round((calendarDay(range.end) - calendarDay(range.start)) / 86400000) + 1 : getSpanDays(runs);
  const weeks = new Map();
  runs.forEach((run) => {
    const key = dateOnly(startOfWeek(parseActivityDate(run)));
    weeks.set(key, (weeks.get(key) || 0) + miles(run.distance));
  });
  const orderedDates = runs.map(parseActivityDate).sort((a, b) => a - b);
  const firstDate = hasRange ? range.start : orderedDates[0];
  const lastDate = hasRange ? range.end : orderedDates[orderedDates.length - 1];
  const calendarWeeks = firstDate && lastDate
    ? Math.round((calendarDay(startOfWeek(lastDate)) - calendarDay(startOfWeek(firstDate))) / 604800000) + 1
    : 0;
  const peakWeek = Math.max(0, ...weeks.values());
  const averageWeeklyMiles = spanDays ? totalMiles / Math.max(spanDays / 7, 1 / 7) : 0;
  const averageRunMiles = runs.length ? totalMiles / runs.length : 0;
  const averageRunsPerWeek = spanDays ? runs.length / Math.max(spanDays / 7, 1 / 7) : 0;
  const longRunShare = totalMiles ? longRun / totalMiles : 0;
  const averageLoadPerMile = totalMiles ? totalLoad / totalMiles : 0;
  const elevationPerMile = totalMiles ? totalElevation / totalMiles : 0;
  const streaks = getRunStreaks(runs);
  const rampRate = TrainingCore.rampRate(runs, range.start, range.end, parseActivityDate);
  return {
    totalMiles,
    averagePace: totalMiles ? totalSeconds / totalMiles : 0,
    longRun,
    consistency: calendarWeeks ? weeks.size / calendarWeeks : 0,
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
    longestStreak: streaks.longestStreak,
    longestRestGap: streaks.longestRestGap,
    rampRate
  };
}

function getSpanDays(runs) {
  if (!runs.length) return 0;
  const days = runs.map(parseActivityDate)
    .filter((date) => !Number.isNaN(date.valueOf()))
    .map((date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return days.length ? Math.round((Math.max(...days) - Math.min(...days)) / 86400000) + 1 : 0;
}

function getRunStreaks(runs) {
  if (!runs.length) return { longestStreak: 0, longestRestGap: 0 };
  const days = [...new Set(runs.map((run) => localDateValue(parseActivityDate(run))))].sort();
  let longestStreak = 1;
  let currentStreak = 1;
  let longestRestGap = 0;
  for (let index = 1; index < days.length; index += 1) {
    const previous = new Date(`${days[index - 1]}T00:00:00Z`);
    const current = new Date(`${days[index]}T00:00:00Z`);
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
  state.buckets = fillEmptyPeriods(buildBuckets(state.filteredRuns), start, end);
  state.insightFingerprint = JSON.stringify({
    range: [els.startDate.value, els.endDate.value],
    grouping: els.bucketSelect.value,
    runs: state.filteredRuns.map((run) => [run.id, run.start_date_local || run.start_date, run.distance, run.moving_time, run.total_elevation_gain, run.average_heartrate, run.workout_type])
  });

  const summary = summarize(state.filteredRuns, state.buckets);
  const previous = summarizePreviousPeriod(normalized, start, end);
  previous.coverageKnown = hasHistoryCoverage(previous.rangeStart, previous.rangeEnd);
  if (!previous.coverageKnown) { previous.totalMiles = 0; previous.averagePace = 0; previous.averageWeeklyMiles = 0; previous.averageRunMiles = 0; }
  renderHeroStatus(summary);
  renderBlockReview(summary, previous);
  renderCoachingWorkspace(currentTrainingSummary());
  renderTrainingTexture();
  renderKeyRuns();
  renderIntel(summary, previous, start, end);
  renderAiState();
  renderMainChart();
  renderSecondaryCharts();
  renderTable();
  if (activeView !== "fitness") renderFitness(); // setView draws the visible Fitness view.
  updateWindowContext();
  saveViewState();
  finishExperienceRender();
}

function fillEmptyPeriods(buckets, start, end) {
  if (!start || !end || start > end || !state.filteredRuns.length) return buckets;
  const mode = els.bucketSelect.value;
  const cursor = mode === "month" ? new Date(start.getFullYear(), start.getMonth(), 1) : startOfWeek(start);
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const result = [];
  while (cursor <= end && result.length < 5200) {
    const key = bucketKey(cursor, mode);
    result.push(byKey.get(key) || { key, label: bucketLabel(key, mode), runs: 0, distanceMiles: 0, movingSeconds: 0, elevationFeet: 0, longRunMiles: 0, trainingLoad: 0, averagePace: 0, averageHr: 0, longRunShare: 0 });
    if (mode === "month") cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + 7);
  }
  return result;
}

function updateWindowContext() {
  const { start, end } = getRangeDates();
  const dateFormat = { month: "short", day: "numeric", year: "numeric" };
  document.querySelector("#windowDates").textContent = `${start ? start.toLocaleDateString(undefined, dateFormat) : "Earliest run"} – ${end ? end.toLocaleDateString(undefined, dateFormat) : "Latest run"}`;
  document.querySelector("#windowContext").textContent = "Overview, Runs and Fitness charts follow this review window.";
  document.querySelector("#dataSource").textContent = state.dataSource === "demo" ? "Demo · sample running history" : state.dataSource === "import" ? "Imported activity history" : "Strava activity history";
  const noMatches = state.rawActivities.length > 0 && !state.filteredRuns.length;
  document.querySelector("#emptyWindow").hidden = !noMatches;
  const reversedDates = start && end && start > end;
  document.querySelector("#emptyWindowTitle").textContent = reversedDates ? "These dates are out of order" : "No runs in this window";
  document.querySelector("#emptyWindowCopy").textContent = reversedDates ? "Choose an end date on or after the start date. Your history is still loaded." : "Your history is still loaded. Choose a wider range to find your runs.";
  document.querySelector("#exportButton").disabled = !state.filteredRuns.length;
  document.querySelector("#disconnectButton").hidden = !state.stravaConnected;
}

function saveViewState() {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries({ range: els.rangeSelect.value, start: els.rangeSelect.value === "custom" ? els.startDate.value : "", end: els.rangeSelect.value === "custom" ? els.endDate.value : "", group: els.bucketSelect.value, metric: els.metricSelect.value, search: els.runSearch.value, sort: els.runSort.value, type: document.querySelector("#runTypeFilter")?.value || "all" })) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url);
}

function restoreViewState() {
  const params = new URLSearchParams(window.location.search);
  for (const [key, element] of [["range", els.rangeSelect], ["group", els.bucketSelect], ["metric", els.metricSelect], ["sort", els.runSort], ["type", document.querySelector("#runTypeFilter")]]) {
    const value = params.get(key);
    if ([...element.options].some((option) => option.value === value)) element.value = value;
  }
  for (const [key, element] of [["start", els.startDate], ["end", els.endDate]]) {
    const value = params.get(key);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) element.value = value;
  }
  els.runSearch.value = (params.get("search") || "").slice(0, 200);
}

function renderHeroStatus(summary) {
  const hasData = summary.runCount > 0;
  document.body.classList.toggle("has-data", hasData);
  document.body.classList.toggle("has-history", state.rawActivities.length > 0);
  if (!els.heroStatus) return;
  els.heroStatus.textContent = hasData
    ? `${summary.runCount} runs · ${summary.activeDays} active days`
    : "Ready for training data";
}

function textureStat(label, value, detail, tone = "") {
  return `<article class="texture-stat ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function startTimeLabel(runs) {
  const hours = runs.map((run) => runStartTimeDetails(run)?.hour).filter(Number.isFinite);
  if (!hours.length) return { value: "—", detail: "No local start times" };
  const average = hours.reduce((sum, hour) => sum + hour, 0) / hours.length;
  const period = average < 11 ? "Morning" : average < 16 ? "Midday" : average < 20 ? "Evening" : "Night";
  const count = hours.filter((hour) => period === "Morning" ? hour < 11 : period === "Midday" ? hour >= 11 && hour < 16 : period === "Evening" ? hour >= 16 && hour < 20 : hour >= 20).length;
  return { value: period, detail: `${Math.round((count / hours.length) * 100)}% of logged starts` };
}

function favoriteRunDay(runs) {
  const counts = new Map();
  runs.forEach((run) => {
    const day = parseActivityDate(run).toLocaleDateString(undefined, { weekday: "long" });
    counts.set(day, (counts.get(day) || 0) + 1);
  });
  const favorite = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return favorite ? { value: favorite[0], detail: `${favorite[1]} runs in this window` } : { value: "—", detail: "No running days" };
}

function textureWeatherRuns(runs, limit = 10) {
  const eligible = runs.filter((run) => weatherRequestDetails(run));
  if (eligible.length <= limit) return eligible;
  const sample = [];
  for (let index = 0; index < limit; index += 1) sample.push(eligible[Math.floor(index * (eligible.length - 1) / (limit - 1))]);
  return sample;
}

function renderTrainingTexture() {
  if (!els.trainingTextureStats) return;
  const runs = state.filteredRuns;
  if (!runs.length) {
    els.trainingTextureStats.innerHTML = textureStat("Start temperature", "—", "Load a running block") + textureStat("Typical start", "—", "Local activity time") + textureStat("Favorite day", "—", "Most common run day") + textureStat("Long-run share", "—", "Miles from your longest runs") + textureStat("Longest streak", "—", "Consecutive days with a run");
    return;
  }
  const weatherRuns = textureWeatherRuns(runs);
  const temperatures = weatherRuns.map((run) => state.runWeatherCache.get(runWeatherKey(run))?.temperatureF).map(weatherNumber).filter((value) => value !== null);
  const temperature = temperatures.length
    ? { value: `${Math.round(temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length)}°F`, detail: `Modeled start weather · ${temperatures.length}/${weatherRuns.length} sampled` }
    : weatherRuns.length
      ? { value: "Checking", detail: `Modeled start weather · up to ${weatherRuns.length} runs` }
      : { value: "—", detail: "No route coordinates available" };
  const start = startTimeLabel(runs);
  const day = favoriteRunDay(runs);
  const distances = runs.map((run) => miles(run.distance)).sort((a, b) => b - a);
  const longestCount = Math.max(1, Math.ceil(distances.length * 0.2));
  const totalMiles = distances.reduce((sum, value) => sum + value, 0);
  const longestMiles = distances.slice(0, longestCount).reduce((sum, value) => sum + value, 0);
  const longRunShare = totalMiles ? Math.round((longestMiles / totalMiles) * 100) : 0;
  els.trainingTextureStats.innerHTML = [
    textureStat("Start temperature", temperature.value, temperature.detail, temperatures.length ? "weather-ready" : ""),
    textureStat("Typical start", start.value, start.detail),
    textureStat("Favorite day", day.value, day.detail),
    textureStat("Longest-fifth share", `${longRunShare}%`, "Mileage from the longest 20% of runs"),
    textureStat("Longest streak", `${getRunStreaks(runs).longestStreak} day${getRunStreaks(runs).longestStreak === 1 ? "" : "s"}`, "Consecutive days with a run")
  ].join("");
  if (!preferences.weather || !weatherRuns.length || state.textureWeatherFingerprint === state.insightFingerprint) return;
  state.textureWeatherFingerprint = state.insightFingerprint;
  Promise.all(weatherRuns.map((run) => requestRunWeather(run).catch(() => null))).then(() => {
    if (state.textureWeatherFingerprint === state.insightFingerprint) renderTrainingTexture();
  });
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
    ? `${state.filteredRuns.length} runs will be summarized for Ollama. No route coordinates or raw activity payloads are included.`
    : "Connect Strava, import a file, or try the demo. Then choose a window and ask for an analysis.";
  copy.append(title, detail);
  wrapper.append(index, copy);
  els.aiInsightContent.replaceChildren(wrapper);
}

function buildInsightPayload() {
  const summary = summarize(state.filteredRuns, state.buckets);
  const recentRuns = state.filteredRuns.slice(-12).reverse().map((run) => ({
    date: localDateValue(parseActivityDate(run)),
    name: "Run",
    distanceMiles: Number(miles(run.distance).toFixed(2)),
    paceSecondsPerMile: Math.round(paceSeconds(run)),
    elevationFeet: Math.round(feet(run.total_elevation_gain)),
    averageHr: run.average_heartrate ? Math.round(run.average_heartrate) : null,
    trainingLoad: Math.round(activityLoad(run))
  }));
  const buckets = state.buckets.slice(-8).map((bucket) => ({
    period: bucket.label,
    runs: bucket.runs,
    miles: Number(bucket.distanceMiles.toFixed(1)),
    averagePaceSeconds: Math.round(bucket.averagePace || 0),
    longRunMiles: Number(bucket.longRunMiles.toFixed(1)),
    averageHr: bucket.averageHr ? Math.round(bucket.averageHr) : null,
    trainingLoad: Math.round(bucket.trainingLoad)
  }));
  return {
    focus: els.aiFocus.value,
    question: els.coachQuestion.value.trim(),
    coachingContext: { goal: coachingContext.goal, checkin: activeCheckin() },
    range: {
      start: els.startDate.value || null,
      end: els.endDate.value || null,
      grouping: els.bucketSelect.value
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
      rampRatePercent: summary.rampRate === null ? null : Math.round(summary.rampRate),
      averageHr: summary.averageHr ? Math.round(summary.averageHr) : null,
      elevationFeetPerMile: Math.round(summary.elevationPerMile),
      trainingLoad: Math.round(summary.totalLoad),
      loadPerMile: Number(summary.averageLoadPerMile.toFixed(1)),
      longestRestGapDays: summary.longestRestGap
    },
    buckets,
    recentRuns
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
  detail.textContent = "The local model is comparing volume, pace, load, recovery gaps, and recent run patterns. This can take a minute if the model is waking up.";
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

function renderAiInsight(insight) {
  els.aiInsightContent.removeAttribute("aria-busy");
  const header = document.createElement("div");
  header.className = "ai-result-header";
  const label = document.createElement("span");
  label.textContent = "Selected-window read";
  const headline = document.createElement("h3");
  headline.textContent = insight.headline;
  const summary = document.createElement("p");
  summary.textContent = insight.summary;
  header.append(label, headline, summary);
  const coverage = document.createElement("p"); coverage.className = "ai-coverage";
  const range = getRangeDates();
  const prior = summarizePreviousPeriod(state.rawActivities, range.start, range.end);
  coverage.textContent = `${els.startDate.value} to ${els.endDate.value} · ${state.filteredRuns.length} runs · latest ${Math.min(12, state.filteredRuns.length)} run summaries and ${Math.min(8, state.buckets.length)} periods supplied · ${state.filteredRuns.filter((run) => run.average_heartrate > 0).length} runs with HR · ${hasHistoryCoverage(prior.rangeStart, prior.rangeEnd) ? "preceding window covered" : "preceding history incomplete"}. Service: ${state.analysisService}; model: ${state.analysisModel}.`;
  header.append(coverage);

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
  const sources = document.createElement("div");
  sources.className = "ai-sources";
  sources.innerHTML = `<span>Evidence considered</span>${state.filteredRuns.slice(-3).reverse().map((run) => `<button type="button" data-action="open-run" data-run-id="${escapeHtml(String(run.id))}">${escapeHtml(run.name)} · ${displayDistance(miles(run.distance), 1)}</button>`).join("")}`;
  els.aiInsightContent.replaceChildren(header, observations, nextStep, sources, caution);
}

async function analyzeWithOllama() {
  if (!state.filteredRuns.length) return;
  if (!await ensureAnalysisConsent()) return;
  state.analysisAbort?.abort();
  state.analysisAbort = new AbortController();
  const stopLoading = startAnalysisTimer(state.analysisAbort);
  const requestedFingerprint = state.insightFingerprint;
  els.aiAnalyzeButton.disabled = true;
  els.aiAnalyzeButton.textContent = "Analyzing…";
  renderAiLoading();
  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildInsightPayload()),
      signal: state.analysisAbort.signal
    });
    const data = await readApiJson(response);
    if (!response.ok) throw new Error(data.error || "Ollama could not analyze this training window.");
    if (requestedFingerprint !== state.insightFingerprint) {
      renderAiState();
      return;
    }
    state.renderedInsightFingerprint = requestedFingerprint;
    renderAiInsight(data.insight);
  } catch (error) {
    state.renderedInsightFingerprint = "";
    renderAiError(error.name === "AbortError" ? "Analysis canceled. Your training summary remains available." : error.message || "The analysis service is unavailable. Try again.");
  } finally {
    stopLoading();
    els.aiAnalyzeButton.disabled = !state.filteredRuns.length;
    els.aiAnalyzeButton.textContent = "Analyze this block";
  }
}

function renderIntel(summary, previous, start, end) {
  const dateLabel = start && end
    ? `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`
    : "Selected range";
  els.intelSubtitle.textContent = `${dateLabel} · ${summary.runCount} runs · ${summary.activeDays} active days`;
  const rampClass = Math.abs(summary.rampRate) <= 12 ? "good" : summary.rampRate > 25 ? "warn" : "";
  // Share per week (a long run vs its own week), not vs the whole window.
  const fullWeeks = state.buckets.filter((bucket) => bucket.runs >= 2 && bucket.distanceMiles);
  const weeklyLongShare = fullWeeks.length ? fullWeeks.reduce((sum, bucket) => sum + bucket.longRunMiles / bucket.distanceMiles, 0) / fullWeeks.length : null;
  const longShareClass = weeklyLongShare === null ? "" : weeklyLongShare <= 0.4 ? "good" : "warn";
  const restClass = summary.longestRestGap <= 3 ? "good" : summary.longestRestGap >= 7 ? "warn" : "";
  const cards = [
    {
      label: "Weekly volume",
      value: `${displayDistance(summary.averageWeeklyMiles, 1)}/wk`,
      detail: previous.coverageKnown ? previous.runCount ? deltaText(summary.averageWeeklyMiles, previous.averageWeeklyMiles, "mi/wk", true) : "No runs recorded in preceding window" : "Preceding history not covered"
    },
    {
      label: "Peak week",
      value: `${displayDistance(summary.peakWeek, 1)}`,
      detail: "Highest calendar-week distance in range"
    },
    {
      label: "Run frequency",
      value: `${summary.averageRunsPerWeek.toFixed(1)} /wk`,
      detail: `${summary.runCount} total runs`
    },
    {
      label: "Average run",
      value: `${displayDistance(summary.averageRunMiles, 1)}`,
      detail: deltaText(summary.averageRunMiles, previous.averageRunMiles, "mi", true)
    },
    {
      label: "Ramp rate",
      value: summary.rampRate === null ? "—" : `${summary.rampRate >= 0 ? "+" : ""}${summary.rampRate.toFixed(0)}%`,
      detail: "Distance in the last 2 full weeks vs the 2 before",
      tone: rampClass
    },
    {
      label: "Long-run share",
      value: weeklyLongShare === null ? "—" : `${Math.round(weeklyLongShare * 100)}%`,
      detail: `Average share of each ${els.bucketSelect.value}'s distance from its longest run`,
      tone: longShareClass
    },
    {
      label: "Running time",
      value: formatDuration(summary.totalLoad * 60),
      detail: `${formatDuration(summary.totalLoad * 60 / Math.max(1, summary.spanDays / 7))} per week on average`
    },
    {
      label: "Climb per mile",
      value: `${Math.round(summary.elevationPerMile)} ft/mi`,
      detail: `${Math.round(summary.totalElevation).toLocaleString()} ft total`
    },
    {
      label: "Heart-rate coverage",
      value: `${Math.round(state.filteredRuns.filter((run) => run.average_heartrate > 0).length / Math.max(summary.runCount, 1) * 100)}%`,
      detail: "Share of runs with heart-rate data"
    },
    {
      label: "Consistency",
      value: `${Math.round(summary.consistency * 100)}%`,
      detail: `Weeks with a run · ${summary.activeDays} active days`
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
  if (!start || !end || end < start) return summarize([], [], { start: null, end: null });
  const calendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const periodDays = Math.round((calendarDay(end) - calendarDay(start)) / 86400000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  previousEnd.setHours(23, 59, 59, 999);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - periodDays + 1);
  previousStart.setHours(0, 0, 0, 0);
  const previousRuns = normalized
    .filter(isRun)
    .filter((activity) => {
      const date = parseActivityDate(activity);
      return !Number.isNaN(date.valueOf()) && date >= previousStart && date <= previousEnd;
    });
  return { ...summarize(previousRuns, buildBuckets(previousRuns), { start: previousStart, end: previousEnd }), rangeStart: previousStart, rangeEnd: previousEnd };
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
  const focusedKey = els.mainChart.contains(document.activeElement) ? document.activeElement.dataset.chartKey : null;
  const metric = METRICS[els.metricSelect.value];
  els.mainChartTitle.textContent = `${metric.label} trend`;
  const periodLabel = `${state.buckets.length} ${els.bucketSelect.value === "week" ? "weeks" : "months"}`;
  els.mainChartSubtitle.textContent = els.metricSelect.value === "pace" ? `${periodLabel} · faster is higher` : RATE_METRICS.has(els.metricSelect.value) ? `${periodLabel} · axis fitted to your range` : periodLabel;
  renderBarLineChart(els.mainChart, state.buckets, metric);
  if (focusedKey) findChartAction(els.mainChart.id, focusedKey)?.focus({ preventScroll: true });
}

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  children.forEach((child) => node.appendChild(child));
  return node;
}

function renderEmpty(container, message = "No activity in this window. Widen the range or load another block.") {
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

function attachTooltip(element, title, rows, { keyboard = true } = {}) {
  const cleanRows = rows
    .filter((row) => row && row.value !== undefined && row.value !== null && row.value !== "")
    .map((row) => ({ label: String(row.label), value: String(row.value) }));
  element.classList.add("has-tooltip");
  element.setAttribute("data-tooltip-title", title);
  element.setAttribute("data-tooltip-rows", JSON.stringify(cleanRows));
  if (keyboard) {
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-describedby", "chartTooltip");
    element.setAttribute("aria-label", `${title}. ${cleanRows.map((row) => `${row.label}: ${row.value}`).join(". ")}`);
  } else {
    element.setAttribute("aria-hidden", "true");
  }
}

function periodPercent(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function paceChangeText(current, previous) {
  if (!current || !previous) return "No prior pace baseline";
  const seconds = Math.round(current - previous);
  if (!seconds) return "Matched prior pace";
  return `${Math.abs(seconds)} sec/mi ${seconds < 0 ? "faster" : "slower"} than prior`;
}

function renderBlockReview(summary, previous) {
  if (!summary.runCount) {
    els.blockReviewTitle.textContent = "Load training data to review your block";
    els.blockReviewSummary.textContent = "Your volume, pace, and training rhythm will be compared with the preceding window.";
    els.blockEvidence.replaceChildren();
    return;
  }
  const volumeChange = periodPercent(summary.totalMiles, previous.totalMiles);
  const paceDelta = summary.averagePace && previous.averagePace ? Math.round(summary.averagePace - previous.averagePace) : null;
  const volumePhrase = volumeChange === null ? "a new baseline" : `${Math.abs(Math.round(volumeChange))}% ${volumeChange >= 0 ? "more" : "less"} mileage`;
  let title = "A steady training block";
  if (volumeChange !== null && volumeChange >= 10 && (paceDelta === null || paceDelta <= 8)) title = "More volume without losing pace";
  else if (volumeChange !== null && volumeChange <= -10) title = "A lighter block, with room to rebuild";
  else if (paceDelta !== null && paceDelta <= -8) title = "Pace improved across a steady block";
  els.blockReviewTitle.textContent = title;
  els.blockReviewSummary.textContent = `This window contains ${summary.runCount} runs over ${summary.activeDays} active days: ${volumePhrase}${paceDelta === null ? "." : ` and ${paceChangeText(summary.averagePace, previous.averagePace)}.`}`;
  if (!previous.coverageKnown) {
    els.blockReviewTitle.textContent = "Your selected training block";
    els.blockReviewSummary.textContent = `${summary.runCount} runs over ${summary.activeDays} active days. Insufficient comparison history: load the preceding window to compare changes.`;
  }
  const evidence = [
    { label: "Volume", value: `${displayDistance(summary.totalMiles, 1)}`, detail: volumeChange === null ? previous.coverageKnown ? "No distance recorded in prior window" : "Insufficient comparison history" : `${volumeChange >= 0 ? "+" : ""}${Math.round(volumeChange)}% vs prior window` },
    { label: "Pace", value: formatPace(summary.averagePace), detail: paceChangeText(summary.averagePace, previous.averagePace) },
    { label: "Runs / week", value: summary.averageRunsPerWeek.toFixed(1), detail: `${summary.activeDays} active days in this window` }
  ];
  els.blockEvidence.replaceChildren(...evidence.map((item) => {
    const card = document.createElement("article");
    card.className = "block-evidence-card";
    card.innerHTML = `<span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.detail)}</small>`;
    return card;
  }));
}

function renderKeyRuns() {
  if (!state.filteredRuns.length) {
    els.keyRuns.innerHTML = '<div class="empty-state">Key runs will appear once a training block is loaded.</div>';
    return;
  }
  const runs = state.filteredRuns;
  const candidates = [
    { label: "Most recent", run: runs[runs.length - 1], reason: "Current context for the block" },
    { label: "Longest", run: [...runs].sort((a, b) => miles(b.distance) - miles(a.distance))[0], reason: "Longest distance in this window" },
    { label: "Most time running", run: [...runs].sort((a, b) => activityLoad(b) - activityLoad(a))[0], reason: "Longest moving duration in this window" },
    { label: "Fastest comparable", run: [...runs].filter((run) => miles(run.distance) >= 4).sort((a, b) => paceSeconds(a) - paceSeconds(b))[0], reason: "Fastest run over four miles" }
  ].filter((item) => item.run);
  const unique = candidates.filter((item, index, list) => list.findIndex((candidate) => String(candidate.run.id) === String(item.run.id)) === index);
  els.keyRuns.replaceChildren(...unique.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key-run-card";
    button.dataset.activityId = item.run.id;
    button.innerHTML = `<span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.run.name)}</strong><em>${escapeHtml(parseActivityDate(item.run).toLocaleDateString(undefined, { month: "short", day: "numeric" }))} · ${displayDistance(miles(item.run.distance), 2)} · ${escapeHtml(formatPace(paceSeconds(item.run)))}</em><small>${escapeHtml(item.reason)}</small>`;
    return button;
  }));
}

function renderCoachingWorkspace(summary) {
  if (!summary.runCount) {
    state.draftSessions = [];
    els.readinessContent.innerHTML = '<p class="context-muted">Add a training block to see the inputs behind this view.</p>';
    els.planDraftCopy.textContent = "Load a block to create a transparent draft.";
    els.recommendedCalendar.replaceChildren();
    els.copyPlanButton.disabled = true;
    els.planAdaptation.textContent = "";
    return;
  }
  const sevenStart = new Date(); sevenStart.setDate(sevenStart.getDate() - 6); sevenStart.setHours(0, 0, 0, 0);
  const lastSeven = state.rawActivities.map(normalizeActivity).filter(isRun).filter((run) => parseActivityDate(run) >= sevenStart && parseActivityDate(run) <= new Date());
  const sevenMiles = lastSeven.reduce((sum, run) => sum + miles(run.distance), 0);
  const baseline = summary.averageWeeklyMiles;
  const hardRuns = lastSeven.filter((run) => [1, 3].includes(Number(run.workout_type))).length;
  const confidence = summary.runCount >= 12 ? "Established" : "Limited";
  const race = raceContext();
  els.readinessContent.innerHTML = `<div class="readiness-metric"><strong>${displayDistance(sevenMiles, 1)}</strong><span>last 7 days · ${displayDistance(baseline, 1)} baseline</span></div><ul><li>${lastSeven.length} runs in the last 7 days</li><li>${hardRuns} runs labeled race/workout by the source</li><li>${summary.longestRestGap} days longest rest gap</li><li>${confidence} recent history · ${summary.runCount} runs in this block${race ? `</li><li>${escapeHtml(race.label)} · ${race.weeks} weeks away · ${race.phase} phase` : ""}</li></ul><p class="context-muted">${escapeHtml(readinessSummaryText() || "Readiness appears on the Fitness tab once recent runs are loaded.")} <a href="#fitness">See what's driving it</a>.</p>`;
  const goalMiles = Number(coachingContext.goal.miles) || baseline;
  const recommendation = recommendIntent(summary, race);
  const chosenIntent = coachingContext.goal.mode || "auto";
  const outcome = activeCheckin().outcome === "missed" && activeCheckin().missedReason === "schedule" ? "schedule" : activeCheckin().outcome;
  const intent = outcome === "missed" && activeCheckin().missedReason !== "schedule" ? "recover" : chosenIntent === "auto" ? recommendation.intent : chosenIntent;
  els.planAdaptation.textContent = outcome === "missed"
    ? "Adapted from your missed session: protect recovery first; the quality option is replaced with easy/rest space."
    : outcome === "shortened"
      ? "Adapted from your shortened session: keep the quality option optional and do not chase missed work."
      : outcome === "completed"
        ? "Plan stays on course: your last planned session was completed."
        : outcome === "schedule" ? "The session was missed because of scheduling. Keep the baseline; do not add make-up work." : "Log your last planned session to let this draft adapt.";
  const readinessNow = planReadiness();
  if (readinessNow && readinessNow.score < 55 && chosenIntent === "auto") {
    els.planAdaptation.textContent += readinessNow.score < 35
      ? ` Readiness is ${readinessNow.score}/100, so this is a recovery week.`
      : ` Readiness is ${readinessNow.score}/100, so the quality session is swapped for an easy run.`;
  }
  els.intentRecommendation.textContent = outcome === "missed"
    ? "Recovery draft after a missed session; your saved block intent is unchanged."
    : chosenIntent === "auto"
    ? `Recommended: ${recommendation.intent} — ${recommendation.reason}`
    : `Manual override: ${intent}. Auto recommends ${recommendation.intent} because ${recommendation.reason}`;
  const range = intent === "build" ? `${goalMiles.toFixed(0)}–${(goalMiles * 1.08).toFixed(0)}` : intent === "recover" ? `${(goalMiles * 0.7).toFixed(0)}–${(goalMiles * 0.85).toFixed(0)}` : `${(goalMiles * 0.9).toFixed(0)}–${goalMiles.toFixed(0)}`;
  const raceLead = race ? `${race.label} is ${race.weeks} week${race.weeks === 1 ? "" : "s"} away (${race.phase} phase). ` : "";
  const calendar = renderRecommendedCalendar(intent, summary, goalMiles, race);
  const longRunCopy = calendar.longRunDay ? ` ${calendar.longRunDay} long run: up to ${displayDistance(calendar.longRunMiles, 1)}.` : "";
  const availabilityCopy = calendar.availabilityLimited ? " Your availability limits the number of runs; adjust mileage to match." : "";
  els.planDraftCopy.textContent = `${raceLead}${intent[0].toUpperCase() + intent.slice(1)} week draft: ${range} mi across ${calendar.plannedRuns} planned run${calendar.plannedRuns === 1 ? "" : "s"}.${longRunCopy} Session distances total ${displayDistance(calendar.totalMiles)}.${availabilityCopy} Review the draft against your schedule and how you feel.`;
  els.copyPlanButton.disabled = false;
}

function renderRecommendedCalendar(intent, summary, targetMiles, race) {
  const start = selectedPlanStart();
  const requestedRuns = Number(coachingContext.goal.runDays) || Math.max(3, Math.round(summary.averageRunsPerWeek));
  const maxRuns = Math.min(7, Math.max(1, Math.round(requestedRuns)));
  const longRun = Math.min(summary.longRun, targetMiles * 0.35);
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dates = dayNames.map((_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
  const chosenLongIndex = dayNames.indexOf(coachingContext.goal.longRunDay || "Sat");
  const longIndex = chosenLongIndex >= 0 ? chosenLongIndex : 5;
  const available = String(coachingContext.goal.availability || "").toLowerCase().match(/mon|tue|wed|thu|fri|sat|sun/g);
  const isAvailable = (index) => !available?.length || available.includes(dayNames[index].toLowerCase());
  const raceIndex = race ? dates.findIndex((date) => localDateValue(date) === coachingContext.goal.raceDate) : -1;
  const recovery = intent === "recover" || (activeCheckin().outcome === "missed" && activeCheckin().missedReason !== "schedule");
  // Readiness in the "hold steady" band keeps the week but drops its hard session.
  const readinessToday = planReadiness();
  const holdQuality = Boolean(readinessToday && readinessToday.score < 55 && (coachingContext.goal.mode || "auto") === "auto");
  // A race replaces this week's long run. Reserve that date, or the runner's
  // available long-run day, before selecting the remaining sessions.
  const priority = [raceIndex, raceIndex < 0 ? longIndex : -1, 1, 3, 0, 6, 2, 4, 5];
  const planned = new Set();
  const sessionLimit = Math.min(maxRuns, recovery ? 3 : 5);
  priority.forEach((index) => {
    if (index >= 0 && planned.size < sessionLimit && (index === raceIndex || isAvailable(index))) planned.add(index);
  });
  const schedule = dayNames.map((_, index) => {
    if (index === raceIndex) return ["Race day", `${race.label}${isAvailable(index) ? "" : " · Race date takes priority over saved availability"}`];
    if (!isAvailable(index)) return ["Rest / unavailable", "Outside your saved availability"];
    if (!planned.has(index)) return ["Rest / mobility", "Leave room to recover"];
    if (index === longIndex && raceIndex < 0) return [recovery ? "Easy long run" : "Long run", `At or below ${displayDistance(longRun, 1)}`];
    if (recovery || raceIndex >= 0) return ["Easy run", "Keep it short and conversational"];
    if (index === 1) return holdQuality ? ["Easy run", `Readiness ${readinessToday.score}/100: quality moved out this week`] : ["Quality option", "Choose only if your check-in supports it"];
    if (index === 3) return ["Steady run", "Keep the weekly range in view"];
    return ["Easy run", "Conversational effort"];
  });
  const hasLong = raceIndex < 0 && planned.has(longIndex);
  const totalTarget = adjustedPlanMiles(intent, targetMiles);
  const longMiles = hasLong ? Math.min(longRun, totalTarget) : 0;
  state.draftSessions = schedule.map(([title, detail], index) => ({ date: localDateValue(dates[index]), title, detail, kind: planned.has(index) ? "run" : "rest", miles: planned.has(index) ? (hasLong && index === longIndex ? longMiles : Math.max(0, totalTarget - longMiles) / Math.max(1, planned.size - (hasLong ? 1 : 0))) : 0, status: "planned", matchedId: "" }));
  state.draftSessions.forEach((session) => session.miles = Number(session.miles.toFixed(1)));
  els.recommendedCalendar.innerHTML = schedule.map(([title, detail], index) => {
    const date = dates[index];
    const isRace = index === raceIndex;
    const dateKey = localDateValue(date);
    const distance = state.draftSessions[index].miles;
    return `<button type="button" class="recommended-day${isRace ? " race-day" : ""}" data-action="cycle-plan-status" data-plan-date="${dateKey}" data-plan-kind="${planned.has(index) ? "run" : "rest"}"><span>${date.toLocaleDateString(undefined, { weekday: "short" })}</span><time>${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small><em>${distance ? `${displayDistance(distance)} · draft` : "Rest day"}</em></button>`;
  }).join("");
  const hasLongRun = raceIndex < 0 && planned.has(longIndex);
  return { plannedRuns: planned.size, maxRuns, totalMiles: state.draftSessions.reduce((sum, session) => sum + session.miles, 0), longRunMiles: hasLongRun ? longRun : 0, longRunDay: hasLongRun ? dayNames[longIndex] : null, hasRace: raceIndex >= 0, availabilityLimited: planned.size < sessionLimit };
}

function cyclePlanStatus(date) {
  if (!acceptedPlans[planKey()]) document.querySelector("#acceptPlanButton").click();
  const row = [...document.querySelectorAll("#acceptedPlan .saved-session")].find((element) => element.querySelector('input[type="date"]').value === date);
  if (row) { row.open = true; row.scrollIntoView({ block: "center", behavior: "instant" }); row.querySelector("select").focus({ preventScroll: true }); }
  setStatus("Use the saved session's status, date, and activity matching controls to update this plan.");
}

function recommendIntent(summary, race) {
  const checkin = activeCheckin();
  if (checkin.outcome === "missed" && checkin.missedReason !== "schedule") return { intent: "recover", reason: "a missed session is a cue to protect recovery, not make it up" };
  if (checkin.feel && Number(checkin.feel) <= 2) return { intent: "recover", reason: "your check-in reported a hard block" };
  if (checkin.limiter && checkin.limiter !== "none") return { intent: "maintain", reason: `${checkin.limiter} was marked as a limiting factor` };
  const readiness = planReadiness();
  if (readiness && readiness.score < 35) return { intent: "recover", reason: `readiness today is ${readiness.score}/100 (${readiness.label.toLowerCase()})` };
  if (race && race.weeks <= 2) return { intent: "recover", reason: "the race is close enough to prioritize freshness" };
  if (race && race.weeks <= 12 && summary.rampRate !== null && summary.rampRate <= 15) return { intent: "build", reason: "you are in the race build window with a controlled recent ramp" };
  return { intent: "maintain", reason: "the available workload data does not support a stronger change" };
}

function raceContext() {
  const goal = coachingContext.goal || {};
  if (!goal.raceDate) return null;
  const date = new Date(`${goal.raceDate}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return null;
  const days = Math.ceil((date - new Date()) / 86400000);
  if (days < 0) return null;
  const weeks = Math.max(0, Math.ceil(days / 7));
  const phase = weeks <= 2 ? "taper / race" : weeks <= 5 ? "peak" : weeks <= 12 ? "build" : "base";
  const name = goal.raceName || goal.raceDistance || "Race";
  return { weeks, phase, label: `${name}${goal.raceDistance && goal.raceName ? ` · ${goal.raceDistance}` : ""}` };
}

function runsForBucket(bucket) {
  const mode = els.bucketSelect.value;
  return state.filteredRuns
    .filter((run) => bucketKey(parseActivityDate(run), mode) === bucket.key)
    .sort((a, b) => parseActivityDate(b) - parseActivityDate(a));
}

function attachChartAction(element, title, runs) {
  if (!runs.length) return;
  element.classList.add("chart-action");
  element.dataset.chartKey = JSON.stringify([element.tagName, title, String(runs[0].id)]);
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", `${title}. Open ${runs.length} run${runs.length === 1 ? "" : "s"}.`);
  const open = () => showRunCollectionModal(title, runs, element);
  element.addEventListener("click", open);
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  });
}

function findChartAction(containerId, key) {
  return [...(document.getElementById(containerId)?.querySelectorAll("[data-chart-key]") || [])].find((element) => element.dataset.chartKey === key);
}

function rememberModalTrigger(trigger) {
  // Run details can replace a collection inside the same dialog. Keep its outer opener.
  if (trigger instanceof Element && els.workoutModal.contains(trigger)) return;
  state.modalTrigger = trigger instanceof Element ? trigger : null;
  const chart = state.modalTrigger?.closest(".chart");
  state.modalReturn = chart && trigger.dataset.chartKey ? { containerId: chart.id, key: trigger.dataset.chartKey } : null;
}

function showRunCollectionModal(title, runs, trigger = document.activeElement) {
  if (!runs.length) return;
  const totalMiles = runs.reduce((sum, run) => sum + miles(run.distance), 0);
  const totalSeconds = runs.reduce((sum, run) => sum + (Number(run.moving_time) || 0), 0);
  state.modalSession += 1;
  state.runDigestAbort?.abort();
  state.runDigestAbort = null;
  state.activeRunId = "";
  rememberModalTrigger(trigger);
  els.workoutModalContent.innerHTML = `
    <header class="workout-header collection-header">
      <p class="workout-kicker">Chart selection</p>
      <h2 id="workoutModalTitle">${escapeHtml(title)}</h2>
      <div class="workout-header-meta"><span>${runs.length} run${runs.length === 1 ? "" : "s"}</span><span>${displayDistance(totalMiles, 1)}</span><span>${formatPace(totalSeconds / totalMiles)} average pace</span></div>
    </header>
    <div class="workout-body collection-body">
      <p>Select a run to open its full detail, conditions, and coach’s read.</p>
      <div class="chart-run-list">${runs.map((run) => `
        <button type="button" class="chart-run-option" data-action="open-run" data-run-id="${escapeHtml(String(run.id))}">
          <span>${escapeHtml(parseActivityDate(run).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</span>
          <strong>${escapeHtml(run.name)}</strong>
          <em>${displayDistance(miles(run.distance), 2)} · ${escapeHtml(formatPace(paceSeconds(run)))}</em>
        </button>`).join("")}</div>
    </div>
  `;
  els.workoutModal.hidden = false;
  document.body.classList.add("modal-open");
  els.workoutModalClose.focus();
}

// The first row is the value the reader is pointing at: shown large, then the context rows.
function tooltipContent(title, rows) {
  const [primary, ...rest] = rows;
  const lead = primary ? `<p class="tooltip-primary"><b>${escapeHtml(primary.value)}</b><span>${escapeHtml(primary.label)}</span></p>` : "";
  const safeRows = rest
    .map((row) => `<dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd>`)
    .join("");
  return `<strong>${escapeHtml(title)}</strong>${lead}${safeRows ? `<dl>${safeRows}</dl>` : ""}`;
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

const ADDITIVE_METRICS = new Set(["distance", "runs", "load", "elevation"]);
const RATE_METRICS = new Set(["pace", "heartrate", "elevationDensity", "loadPerMile"]);

function renderBarLineChart(container, buckets, metric) {
  if (!buckets.length) {
    renderEmpty(container);
    return;
  }
  const width = Math.max(container.clientWidth, 300);
  const height = Math.max(container.clientHeight, 230);
  const metricKey = els.metricSelect.value;
  const mode = els.bucketSelect.value;
  const isRate = RATE_METRICS.has(metricKey);
  const invert = metricKey === "pace"; // Faster pace plots higher.
  const values = buckets.map(metric.value);
  // The period containing today is still filling up; draw it lighter so a
  // half-finished week never reads as a drop in training.
  const currentKey = bucketKey(new Date(), mode);
  const inProgress = buckets.map((bucket) => bucket.key === currentKey);
  const missing = buckets.map((bucket, index) => !bucket.runs || !(values[index] > 0));
  const averageWindow = mode === "week" ? 4 : 3;
  const showAverage = ADDITIVE_METRICS.has(metricKey) && buckets.length > averageWindow;
  const averages = showAverage ? buckets.map((_, index) => {
    if (inProgress[index] || index < averageWindow - 1) return null;
    const slice = values.slice(index - averageWindow + 1, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  }) : [];
  const present = values.filter((value, index) => !missing[index]);
  let ticks;
  if (isRate && present.length) {
    const low = Math.min(...present), high = Math.max(...present), spread = Math.max(high - low, high * 0.02);
    // Pace ticks step in display-unit seconds so they land on :00, :15, :30.
    const factor = metricKey === "pace" ? unitFactor() : 1;
    ticks = niceTicks(Math.max(0, low - spread * 0.15) / factor, (high + spread * 0.15) / factor, 4, metricKey === "pace" ? "time" : "integer").map((tick) => tick * factor);
  } else {
    const scale = metric.tick ? unitFactor() : 1; // Distance ticks round in miles or km.
    ticks = niceTicks(0, Math.max(...values, 1) * scale, 4, metricKey === "runs" ? "integer" : "decimal").map((tick) => tick / scale);
  }
  const low = ticks[0], high = ticks[ticks.length - 1];
  const tickLabels = ticks.map((tick) => metric.tick ? metric.tick(tick) : metric.format(tick));
  const pad = { top: 24, right: 12, bottom: 30, left: Math.max(44, ...tickLabels.map((label) => label.length * 6.4 + 14)) };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const slot = chartWidth / buckets.length;
  const barWidth = Math.max(3, Math.min(slot - 2, Math.max(slot * 0.55, 6), 28));
  const fraction = (value) => (value - low) / (high - low || 1);
  const yFor = (value) => invert ? pad.top + fraction(value) * chartHeight : pad.top + chartHeight - fraction(value) * chartHeight;
  const xFor = (index) => pad.left + index * slot + slot / 2;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": `${metric.label} by ${mode}. Select a period to view runs.` });
  ticks.forEach((tick, index) => {
    const y = yFor(tick);
    root.appendChild(svg("line", { class: "axis", x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
    root.appendChild(svg("text", { class: "label", x: pad.left - 8, y: y + 4, "text-anchor": "end" }, [document.createTextNode(tickLabels[index])]));
  });
  const labelEvery = Math.ceil(buckets.length / Math.max(2, Math.floor(chartWidth / 80)));
  const linePoints = [];
  const changeText = (index) => {
    const previous = index - 1;
    if (previous < 0 || missing[index] || missing[previous]) return null;
    const now = values[index], before = values[previous];
    if (metricKey === "pace") {
      const seconds = Math.round((now - before) / unitFactor());
      return seconds ? `${Math.abs(seconds)} sec/${unitName()} ${seconds < 0 ? "faster" : "slower"}` : "Same pace";
    }
    if (isRate) return `${now >= before ? "+" : "−"}${metric.format(Math.abs(now - before))}`;
    const percent = before ? Math.round((now - before) / before * 100) : null;
    return percent === null ? null : `${percent > 0 ? "+" : percent < 0 ? "−" : "±"}${Math.abs(percent)}%`;
  };
  buckets.forEach((bucket, index) => {
    const value = values[index];
    const x = xFor(index);
    // One group per period: a hover band, the mark, and a full-height hit target
    // so short bars and empty periods are as easy to point at as tall ones.
    const group = svg("g", { class: `period${inProgress[index] ? " is-progress" : ""}` });
    group.appendChild(svg("rect", { class: "period-band", x: pad.left + index * slot, y: pad.top, width: slot, height: chartHeight }));
    if (isRate) {
      if (!missing[index]) linePoints.push({ x, y: yFor(value), index });
    } else {
      const y = missing[index] ? pad.top + chartHeight : yFor(value);
      const barHeight = Math.max(1, pad.top + chartHeight - y);
      group.appendChild(svg("path", {
        class: `bar${missing[index] ? " empty-period" : ""}${inProgress[index] ? " in-progress" : ""}`,
        d: columnPath(x - barWidth / 2, y, barWidth, y + barHeight)
      }));
      if (inProgress[index] && !missing[index]) group.appendChild(svg("text", { class: "progress-label", x, y: y - 6, "text-anchor": "middle" }, [document.createTextNode("so far")]));
    }
    const mark = svg("rect", { class: "period-hit", x: pad.left + index * slot, y: pad.top, width: slot, height: chartHeight, fill: "transparent" });
    const change = changeText(index);
    attachTooltip(mark, `${mode === "week" ? "Week of " : ""}${bucket.label}${inProgress[index] ? " · in progress" : ""}`, [
      { label: metric.label, value: missing[index] ? "No runs" : metric.format(value) },
      change ? { label: `vs previous ${mode}`, value: change } : null,
      showAverage && Number.isFinite(averages[index]) ? { label: `${averageWindow}-${mode} average`, value: metric.format(averages[index]) } : null,
      metricKey !== "distance" ? { label: "Distance", value: `${displayDistance(bucket.distanceMiles, 1)}` } : null,
      metricKey !== "runs" ? { label: "Runs", value: bucket.runs } : null,
      metricKey !== "pace" ? { label: "Avg pace", value: formatPace(bucket.averagePace) } : null,
      metricKey !== "longRun" ? { label: "Long run", value: `${displayDistance(bucket.longRunMiles, 1)}` } : null,
      metricKey !== "heartrate" && bucket.averageHr ? { label: "Avg HR", value: `${Math.round(bucket.averageHr)} bpm` } : null,
      bucket.runs ? { label: "Click to open", value: `${bucket.runs} run${bucket.runs === 1 ? "" : "s"}` } : null
    ].filter(Boolean));
    if (bucket.runs) attachChartAction(mark, bucket.label, runsForBucket(bucket));
    group.appendChild(mark);
    root.appendChild(group);
    if (index % labelEvery === 0) root.appendChild(svg("text", { class: "label", x, y: height - 7, "text-anchor": "middle" }, [document.createTextNode(bucket.label)]));
  });
  if (isRate && linePoints.length) {
    let path = "";
    linePoints.forEach((point, order) => {
      const joined = order && linePoints[order - 1].index === point.index - 1;
      path += `${joined ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    });
    root.appendChild(svg("path", { class: "rate-line", d: path }));
    // Each point lives in its period's group (before the hit target) so hovering the period grows it.
    const groups = root.querySelectorAll(".period");
    linePoints.forEach((point) => {
      const group = groups[point.index];
      group.insertBefore(svg("circle", { class: `rate-dot${inProgress[point.index] ? " in-progress" : ""}`, cx: point.x, cy: point.y, r: 4.5 }), group.querySelector(".period-hit"));
    });
    // Keep the line under the points.
    root.insertBefore(root.querySelector(".rate-line"), groups[0]);
  }
  if (showAverage) {
    let path = "", pen = false, lastPoint = null;
    averages.forEach((value, index) => {
      if (!Number.isFinite(value)) { pen = false; return; }
      path += `${pen ? "L" : "M"}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`; pen = true; lastPoint = [xFor(index), yFor(value)];
    });
    if (path) {
      root.appendChild(svg("path", { class: "avg-line", d: path }));
      root.appendChild(svg("circle", { class: "avg-dot", cx: lastPoint[0], cy: lastPoint[1], r: 4 }));
    }
  }
  // Label only the latest complete period, so the current level reads without hovering.
  const lastComplete = buckets.findLastIndex((_, index) => !inProgress[index] && !missing[index]);
  if (lastComplete >= 0) {
    root.appendChild(svg("text", { class: "bar-value", x: xFor(lastComplete), y: yFor(values[lastComplete]) - 9, "text-anchor": "middle" }, [document.createTextNode(metric.format(values[lastComplete]))]));
  }
  container.replaceChildren(root);
  let legend = container.parentElement.querySelector(".trend-legend");
  if (!legend) { legend = document.createElement("div"); legend.className = "trend-legend"; container.after(legend); }
  legend.innerHTML = [
    `<span class="legend-item"><i class="key ${isRate ? "rate-key" : "bar-key"}"></i>${escapeHtml(metric.label)} per ${mode}</span>`,
    showAverage ? `<span class="legend-item"><i class="key avg-key"></i>${averageWindow}-${mode} average</span>` : "",
    inProgress.includes(true) ? `<span class="legend-item"><i class="key ${isRate ? "rate-progress-key" : "progress-key"}"></i>Current ${mode}, in progress</span>` : ""
  ].join("");
}

function movingAverage(values, windowSize) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1).filter((value) => Number.isFinite(value));
    return slice.reduce((sum, value) => sum + value, 0) / Math.max(slice.length, 1);
  });
}

// Secondary charts measure their panels, so draw them only while visible.
function renderSecondaryCharts() {
  const host = document.querySelector(".exploration");
  if (host && !host.open) return;
  renderStructure();
  renderHeatmap();
  renderScatter();
  renderRollingWorkload();
  renderDistanceMix();
  renderPaceZones();
}

const unitFactor = () => preferences.units === "metric" ? 1.609344 : 1;
const unitName = () => preferences.units === "metric" ? "km" : "mi";

// Per run: distance across, pace up (faster is higher). Each dot opens its run.
function renderScatter() {
  const runs = state.filteredRuns.filter((run) => miles(run.distance) > 0 && paceSeconds(run) > 0);
  setLegend(els.scatterChart, [{ key: "type-easy", label: "Easy & recovery" }, { key: "type-long", label: "Long" }, { key: "type-quality", label: "Quality & race" }]);
  scatterChart(els.scatterChart, {
    ariaLabel: "Pace against distance for each run. Faster runs sit higher.",
    xTitle: `Distance (${unitName()}) →`, yTitle: "↑ Faster pace", invertY: true,
    xScale: unitFactor(), yScale: 1 / unitFactor(), yKind: "time",
    xFormat: (value) => `${Math.round(value * unitFactor())}`,
    yFormat: (value) => formatPace(value).replace(/\/(mi|km)$/, ""),
    points: runs.map((run) => ({
      x: miles(run.distance), y: paceSeconds(run), className: `type-${runType(run).group}`,
      title: `${runType(run).label} · ${run.name} · ${parseActivityDate(run).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      rows: [
        { label: "distance at average pace", value: `${displayDistance(miles(run.distance), 1)} · ${formatPace(paceSeconds(run))}` },
        { label: "Type", value: runType(run).label },
        { label: "Heart rate", value: run.average_heartrate ? `${Math.round(run.average_heartrate)} bpm` : "-" }
      ],
      open: (dot) => showWorkoutModal(run.id, dot)
    }))
  });
}

// Weekly (or monthly) distance split into the long run and everything else.
function renderStructure() {
  const buckets = state.buckets;
  const mode = els.bucketSelect.value;
  const currentKey = bucketKey(new Date(), mode);
  const longRun = buckets.map((bucket) => bucket.longRunMiles || 0);
  const other = buckets.map((bucket) => Math.max(0, bucket.distanceMiles - (bucket.longRunMiles || 0)));
  const legend = [{ key: "other-runs", label: "Other runs" }, { key: "long-run", label: `Longest run of the ${mode}` }];
  setLegend(els.structureChart, legend);
  columnChart(els.structureChart, {
    periods: buckets.map((bucket) => ({ label: bucket.label })),
    series: [
      { label: "Other runs", className: "other-runs", values: other },
      { label: "Long run", className: "long-run", values: longRun }
    ],
    inProgress: buckets.map((bucket) => bucket.key === currentKey),
    yFormat: (value) => `${Math.round(value * unitFactor())} ${unitName()}`, yScale: unitFactor(),
    ariaLabel: `Distance per ${mode}, split into the long run and other runs. Select a ${mode} to open its runs.`,
    tooltip: (index) => {
      const bucket = buckets[index];
      return { title: `${bucket.label}${bucket.key === currentKey ? " (in progress)" : ""}`, rows: [
        { label: "Total", value: displayDistance(bucket.distanceMiles, 1) },
        { label: "Long run", value: displayDistance(bucket.longRunMiles || 0, 1) },
        { label: "Long-run share", value: bucket.distanceMiles ? `${Math.round(bucket.longRunMiles / bucket.distanceMiles * 100)}%` : "-" },
        { label: "Runs", value: bucket.runs }
      ] };
    },
    action: (index) => buckets[index].runs ? { title: `${buckets[index].label} runs`, runs: runsForBucket(buckets[index]) } : null
  });
}

function renderHeatmap() {
  if (!state.filteredRuns.length) {
    renderEmpty(els.heatmapChart);
    els.heatmapSubtitle.textContent = "Daily distance";
    return;
  }
  const { start, end } = getRangeDates();
  const first = start || parseActivityDate(state.filteredRuns[0]);
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const last = end ? new Date(Math.min(end, today)) : parseActivityDate(state.filteredRuns.at(-1));
  const days = new Map();
  state.filteredRuns.forEach((run) => {
    const key = localDateValue(parseActivityDate(run));
    const day = days.get(key) || { miles: 0, seconds: 0, runs: [] };
    day.miles += miles(run.distance);
    day.seconds += Number(run.moving_time) || 0;
    day.runs.push(run);
    days.set(key, day);
  });
  calendarHeatmap(els.heatmapChart, {
    start: first, end: last, days, valueOf: (day) => day.miles,
    format: (value) => displayDistance(value, 0),
    ariaLabel: "Training calendar: daily distance, one column per week. Select a day to open its runs.",
    tooltip: (date, day) => ({
      title: date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      rows: day ? [
        { label: "Distance", value: displayDistance(day.miles, 1) },
        { label: "Runs", value: day.runs.length },
        { label: "Moving time", value: formatDuration(day.seconds) },
        { label: "Pace", value: formatPace(day.seconds / day.miles) }
      ] : [{ label: "Rest", value: "No run" }]
    }),
    action: (date, day) => ({ title: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }), runs: [...day.runs].sort((a, b) => parseActivityDate(b) - parseActivityDate(a)) })
  });
  els.heatmapSubtitle.textContent = `${state.filteredRuns.length} runs on ${days.size} days · select a day to open it`;
}

// Share of total volume by run length, in the display unit.
function renderDistanceMix() {
  const metric = preferences.units === "metric";
  const edges = metric ? [0, 5, 10, 15, 21.1, 30, Infinity] : [0, 3, 6, 9, 13.1, 18, Infinity];
  const bins = edges.slice(0, -1).map((low, index) => ({ low, high: edges[index + 1], count: 0, miles: 0 }));
  state.filteredRuns.forEach((run) => {
    const distance = miles(run.distance) * unitFactor();
    const bin = bins.find((candidate) => distance >= candidate.low && distance < candidate.high);
    if (bin) { bin.count += 1; bin.miles += miles(run.distance); }
  });
  const total = bins.reduce((sum, bin) => sum + bin.miles, 0);
  const label = (bin) => bin.high === Infinity ? `${bin.low}+ ${unitName()}` : `${bin.low}–${bin.high} ${unitName()}`;
  barList(els.distanceMixChart, {
    ariaLabel: "Share of total distance by run length",
    rows: bins.map((bin) => ({
      label: label(bin), value: bin.miles,
      display: total ? `${Math.round(bin.miles / total * 100)}%` : "0%",
      sub: `${bin.count} run${bin.count === 1 ? "" : "s"} · ${displayDistance(bin.miles, 0)}`
    }))
  });
}

// Daily rolling 7-day distance against the 28-day weekly average.
function renderRollingWorkload() {
  if (!state.filteredRuns.length) { renderEmpty(els.rollingChart); return; }
  const { start, end } = getRangeDates();
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const first = start || parseActivityDate(state.filteredRuns[0]);
  const last = end ? new Date(Math.min(end, today)) : today;
  const daily = new Map();
  // Use full history so the first weeks of the window have a real baseline.
  state.rawActivities.map(normalizeActivity).filter(isRun).forEach((run) => {
    const key = localDateValue(parseActivityDate(run));
    daily.set(key, (daily.get(key) || 0) + miles(run.distance));
  });
  const dates = [];
  for (let date = new Date(first.getFullYear(), first.getMonth(), first.getDate()); date <= last; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) dates.push(date);
  const seven = dates.map((date) => rollingMiles(date, daily, 7));
  const baseline = dates.map((date) => rollingMiles(date, daily, 28) / 4);
  setLegend(els.rollingChart, [{ key: "fatigue-line", label: "Last 7 days" }, { key: "fitness-line", label: "28-day weekly average" }]);
  timeChart(els.rollingChart, {
    dates, yMin: 0, yFormat: (value) => `${Math.round(value * unitFactor())} ${unitName()}`, yScale: unitFactor(),
    ariaLabel: "Rolling 7-day distance against the 28-day weekly average. Use arrow keys to move between days.",
    series: [
      { label: "28-day weekly average", short: "28-day avg", className: "fitness-line", values: baseline },
      { label: "Last 7 days", short: "7-day", className: "fatigue-line", values: seven }
    ],
    tooltip: (index) => {
      const ratio = baseline[index] ? seven[index] / baseline[index] : null;
      return { title: dates[index].toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), rows: [
        { label: "Last 7 days", value: displayDistance(seven[index], 1) },
        { label: "28-day weekly avg", value: displayDistance(baseline[index], 1) },
        { label: "Balance", value: ratio === null ? "-" : `${ratio >= 1 ? "+" : "−"}${Math.abs(Math.round((ratio - 1) * 100))}% · ${ratio > 1.3 ? "building fast" : ratio < 0.8 ? "lighter" : "steady"}` }
      ] };
    }
  });
}

function rollingMiles(date, daily, days) {
  let total = 0;
  for (let offset = 0; offset < days; offset += 1) {
    total += daily.get(localDateValue(new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset))) || 0;
  }
  return total;
}

// Pace histogram with bins sized to this runner's spread, in display units.
function renderPaceZones() {
  const paces = state.filteredRuns.map((run) => paceSeconds(run) / unitFactor()).filter((pace) => pace > 0);
  if (!paces.length) { renderEmpty(els.paceZoneChart); return; }
  const sorted = [...paces].sort((a, b) => a - b);
  // Ignore the outer 2% so one walk or sprint does not stretch every bin.
  const low = sorted[Math.floor(sorted.length * 0.02)], high = sorted[Math.ceil(sorted.length * 0.98) - 1];
  const width = [10, 15, 20, 30, 60, 120].find((candidate) => (high - low) / candidate <= 7) || 120;
  const start = Math.floor(low / width) * width;
  const count = Math.max(1, Math.ceil((high - start + 0.001) / width));
  const bins = Array.from({ length: count }, (_, index) => ({ low: start + index * width, high: start + (index + 1) * width, runs: 0 }));
  paces.forEach((pace) => {
    const index = Math.min(count - 1, Math.max(0, Math.floor((pace - start) / width)));
    bins[index].runs += 1;
  });
  const peak = Math.max(...bins.map((bin) => bin.runs));
  const plain = (seconds) => formatPace(seconds * unitFactor()).replace(/\/(mi|km)$/, "");
  barList(els.paceZoneChart, {
    ariaLabel: "Number of runs by average pace",
    className: "pace-bars",
    rows: bins.map((bin, index) => ({
      label: count > 1 && index === 0 ? `Under ${plain(bin.high)}/${unitName()}` : count > 1 && index === count - 1 ? `${plain(bin.low)}/${unitName()} or slower` : `${plain(bin.low)}–${plain(bin.high)}/${unitName()}`,
      value: bin.runs, highlight: bin.runs === peak,
      display: `${bin.runs} run${bin.runs === 1 ? "" : "s"}`,
      sub: `${Math.round(bin.runs / paces.length * 100)}%`
    }))
  });
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
  return runMinutes(run);
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

function classifyRun(run) {
  return runType(run).label;
}

function buildWorkoutDigest(run) {
  const runs = [...state.filteredRuns].sort((a, b) => parseActivityDate(a) - parseActivityDate(b));
  const index = runs.findIndex((candidate) => String(candidate.id) === String(run.id));
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
    const allowed = comparisonScope === "sport" ? candidate.sport_type === run.sport_type : comparisonScope === "recent" ? Math.abs(parseActivityDate(candidate) - parseActivityDate(run)) <= 90 * 86400000 : true;
    return allowed && candidate.id !== run.id && candidateDistance >= distance * 0.8 && candidateDistance <= distance * 1.2;
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
  const bucket = state.buckets.find((candidate) => candidate.key === bucketKey(parseActivityDate(run), els.bucketSelect.value));
  const previousGap = daysBetween(previousRun, run);
  const nextGap = daysBetween(run, nextRun);
  const contextStart = Math.max(0, Math.min(index - 3, runs.length - 7));
  const neighboringRuns = runs.slice(contextStart, contextStart + 7);
  const typeLabel = classifyRun(run);
  const signals = [
    {
      label: typeLabel,
      value: `${formatOrdinal(distanceRank)} distance pct.`,
      detail: `${paceRank ? `Faster than ${paceRank}% of runs in range` : "Pace rank needs duration data"}`
    },
    {
      label: "Moving duration",
      value: `${Math.round(load).toLocaleString()} min`,
      detail: similarLoadPerMile ? `${formatNumber(loadPerMile, 1)} min/mi vs ${formatNumber(similarLoadPerMile, 1)} min/mi for similar runs` : `${formatOrdinal(loadRank)} duration pct. in range`
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
    date: parseActivityDate(run),
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
    runType: typeLabel,
    neighboringRuns,
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
    Race: "The source labels this run as a race.",
    Quality: "A hard effort: heart rate or pace near your threshold.",
    Long: "A long run relative to your usual distance.",
    Easy: "An easy, aerobic effort.",
    Recovery: "A gentle recovery effort, shorter and slower than usual.",
    Steady: "A run in the context of your selected history."
  };
  const strain = digest.similarLoadPerMile
    ? `Compared with ${digest.similarCount} similar-distance runs. Running time is a duration measure, not a strain score.`
    : `No similar-distance comparison is available. ${formatOrdinal(digest.loadRank)} percentile for moving duration.`;
  return {
    headline: headlines[digest.runType] || headlines.Steady,
    detail: `${formatOrdinal(digest.distanceRank)} distance percentile, ${formatOrdinal(digest.paceRank)} pace percentile. ${strain}`
  };
}

function runStartTimeDetails(run) {
  const raw = String(run.start_date_local || run.start_date || "");
  const matched = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):/);
  if (matched) return { date: matched[1], hour: Number(matched[2]) };
  const date = parseActivityDate(run);
  if (Number.isNaN(date.valueOf())) return null;
  return { date: localDateValue(date), hour: date.getHours() };
}

function weatherRequestDetails(run) {
  const coordinates = normalizeLatLng(run.start_latlng);
  const time = runStartTimeDetails(run);
  if (!coordinates || !time) return null;
  const [latitude, longitude] = coordinates;
  return {
    lat: Math.round(latitude * 100) / 100,
    lng: Math.round(longitude * 100) / 100,
    date: time.date,
    hour: Math.max(0, Math.min(23, Math.round(time.hour)))
  };
}

function runWeatherKey(run) {
  const details = weatherRequestDetails(run);
  if (!details) return "";
  return `${details.lat.toFixed(2)},${details.lng.toFixed(2)}:${details.date}:${details.hour}`;
}

function weatherCodeLabel(code) {
  if (code === null || code === undefined || code === "") return "Conditions unavailable";
  const value = Number(code);
  if (value === 0) return "Clear";
  if ([1, 2].includes(value)) return "Partly cloudy";
  if (value === 3) return "Overcast";
  if ([45, 48].includes(value)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(value)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "Snow";
  if ([95, 96, 99].includes(value)) return "Thunderstorm";
  return "Mixed conditions";
}

function weatherGlyph(code, isDay) {
  if (code === null || code === undefined || code === "") return "—";
  const value = Number(code);
  if ([61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(value)) return "☂";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "❄";
  if ([45, 48].includes(value)) return "≈";
  if (value === 0) return isDay === false ? "☾" : "☀";
  return "☁";
}

function weatherNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatWeatherTemperature(value) {
  const numeric = weatherNumber(value);
  return numeric === null ? "—" : preferences.units === "metric" ? `${Math.round((numeric - 32) * 5 / 9)}°C` : `${Math.round(numeric)}°F`;
}

function formatWeatherValue(value, unit) {
  const numeric = weatherNumber(value);
  if (numeric === null) return "—";
  return unit === "%" ? `${Math.round(numeric)}%` : `${Math.round(numeric)} ${unit}`;
}

function weatherLoadingMarkup() {
  return `
    <div class="workout-weather-state">
      <span class="weather-pulse" aria-hidden="true"></span>
      <div><strong>Matching run-start conditions</strong><small>Using the activity’s rounded start location and local start hour.</small></div>
    </div>
  `;
}

function weatherUnavailableMarkup(message) {
  return `
    <div class="workout-weather-state unavailable">
      <span class="weather-unavailable-mark" aria-hidden="true">—</span>
      <div><strong>Conditions unavailable</strong><small>${escapeHtml(message)}</small></div>
    </div>
  `;
}

function weatherMarkup(weather) {
  const condition = weather.condition || weatherCodeLabel(weather.weatherCode);
  const source = [weather.source || "Open-Meteo", weather.sourceType].filter(Boolean).join(" · ");
  const precipitation = weatherNumber(weather.precipitationInches);
  return `
    <div class="workout-weather-hero">
      <span class="weather-glyph" aria-hidden="true">${weatherGlyph(weather.weatherCode, weather.isDay)}</span>
      <div>
        <span>Conditions at the start</span>
        <strong>${formatWeatherTemperature(weather.temperatureF)}</strong>
        <p>${escapeHtml(condition)} · feels like ${formatWeatherTemperature(weather.feelsLikeF)}</p>
      </div>
    </div>
    <div class="workout-weather-grid">
      <article><span>Humidity</span><strong>${formatWeatherValue(weather.humidityPercent, "%")}</strong></article>
      <article><span>Wind</span><strong>${formatWeatherValue(weather.windSpeedMph, "mph")}</strong></article>
      <article><span>Gusts</span><strong>${formatWeatherValue(weather.windGustMph, "mph")}</strong></article>
      <article><span>Precipitation</span><strong>${precipitation === null ? "—" : `${precipitation.toFixed(2)} in`}</strong></article>
    </div>
    <p class="workout-weather-source">${escapeHtml(source)} modeled context. It uses a rounded run-start location; it is not a watch measurement.</p>
  `;
}

function setWorkoutWeatherContent(markup) {
  const container = els.workoutModalContent.querySelector("#workoutWeatherContent");
  if (container) container.innerHTML = markup;
}

async function requestRunWeather(run) {
  if (!preferences.weather) return null;
  const details = weatherRequestDetails(run);
  const key = runWeatherKey(run);
  if (!details || !key) return null;
  if (state.runWeatherCache.has(key)) return state.runWeatherCache.get(key);
  if (state.runWeatherPending.has(key)) return state.runWeatherPending.get(key);
  const query = new URLSearchParams({
    lat: String(details.lat),
    lng: String(details.lng),
    date: details.date,
    hour: String(details.hour)
  });
  const pending = (async () => {
    const response = await fetch(`/api/weather?${query}`);
    const data = await readApiJson(response);
    if (!response.ok) throw new Error(data.error || "Weather service did not return conditions for this run.");
    if (!data.weather) throw new Error("Weather service returned no conditions for this run.");
    const weather = { ...data.weather, condition: weatherCodeLabel(data.weather.weatherCode) };
    state.runWeatherCache.set(key, weather);
    return weather;
  })();
  state.runWeatherPending.set(key, pending);
  try {
    return await pending;
  } finally {
    state.runWeatherPending.delete(key);
  }
}

async function hydrateWorkoutWeather(run, session) {
  if (!preferences.weather) {
    setWorkoutWeatherContent(weatherUnavailableMarkup("Modeled weather is off. Enable it in preferences to share a rounded start location with Open-Meteo."));
    return null;
  }
  const details = weatherRequestDetails(run);
  if (!details) {
    setWorkoutWeatherContent(weatherUnavailableMarkup("This activity does not include a usable start location and local start time."));
    return null;
  }
  setWorkoutWeatherContent(weatherLoadingMarkup());
  try {
    const weather = await requestRunWeather(run);
    if (session !== state.modalSession || state.activeRunId !== String(run.id)) return null;
    state.activeRunWeather = weather;
    setWorkoutWeatherContent(weatherMarkup(weather));
    return weather;
  } catch (error) {
    if (session !== state.modalSession || state.activeRunId !== String(run.id)) return null;
    setWorkoutWeatherContent(weatherUnavailableMarkup(error.message || "Weather could not be matched for this run."));
    return null;
  }
}

function buildRunDigestPayload(digest, weather) {
  const run = digest.run;
  const paceDeltaSeconds = digest.similarPace ? Math.round(digest.pace - digest.similarPace) : null;
  const loadDeltaPercent = digest.similarLoadPerMile
    ? Math.round(((digest.loadPerMile - digest.similarLoadPerMile) / digest.similarLoadPerMile) * 100)
    : null;
  return {
    kind: "run",
    run: {
      runType: digest.runType,
      distanceMiles: Number(digest.distance.toFixed(2)),
      movingMinutes: Number((digest.moving / 60).toFixed(1)),
      stoppedMinutes: Number((digest.stopped / 60).toFixed(1)),
      paceSecondsPerMile: Math.round(digest.pace),
      elevationFeet: Math.round(digest.elevation),
      elevationFeetPerMile: Math.round(digest.elevationDensity),
      averageHr: Number(run.average_heartrate) || null,
      trainingLoad: Math.round(digest.load),
      loadPerMile: Number(digest.loadPerMile.toFixed(1))
    },
    comparison: {
      similarRunCount: digest.similarCount,
      similarPaceSecondsPerMile: digest.similarPace ? Math.round(digest.similarPace) : null,
      paceDeltaSeconds,
      similarLoadPerMile: digest.similarLoadPerMile ? Number(digest.similarLoadPerMile.toFixed(1)) : null,
      loadPerMileDeltaPercent: loadDeltaPercent,
      similarAverageHr: digest.similarHr ? Math.round(digest.similarHr) : null,
      daysSincePreviousRun: digest.previousGap,
      daysUntilNextRun: digest.nextGap
    },
    context: {
      selectedWindowRunCount: state.filteredRuns.length,
      distancePercentile: digest.distanceRank,
      pacePercentile: digest.paceRank,
      loadPercentile: digest.loadRank
    },
    weather: weather ? {
      temperatureF: weatherNumber(weather.temperatureF),
      feelsLikeF: weatherNumber(weather.feelsLikeF),
      humidityPercent: weatherNumber(weather.humidityPercent),
      windSpeedMph: weatherNumber(weather.windSpeedMph),
      precipitationInches: weatherNumber(weather.precipitationInches),
      weatherCode: weatherNumber(weather.weatherCode)
    } : null,
    coverage: {
      hasWeather: Boolean(weather),
      hasHeartRate: Boolean(Number(run.average_heartrate)),
      directLoad: false,
      similarRunCount: digest.similarCount
    }
  };
}

function comparisonPlanMarkup(digest) {
  const lowerBound = (digest.distance * 0.8).toFixed(1);
  const upperBound = (digest.distance * 1.2).toFixed(1);
  const metrics = ["pace", "load per mile"];
  if (digest.similarHr) metrics.push("average heart rate");
  const baseline = digest.similarCount
    ? `${digest.similarCount} similar run${digest.similarCount === 1 ? "" : "s"} · ${formatPace(digest.similarPace)} pace · ${formatNumber(digest.similarLoadPerMile, 1)} load/mi${digest.similarHr ? ` · ${Math.round(digest.similarHr)} bpm` : ""}`
    : "No similar-distance baseline yet; the next comparable run will begin one.";
  return `
    <div class="run-digest-next">
      <span>What to compare next</span>
      <strong>On your next ${lowerBound}–${upperBound} mi run, compare ${metrics.join(" and ")} against this run and its similar-distance baseline.</strong>
      <small>Baseline: ${escapeHtml(baseline)}</small>
    </div>
  `;
}

function runDigestEmptyMarkup(runId) {
  return `
    <div class="run-digest-empty">
      <div><span>Ollama · on demand</span><strong>Turn the evidence into a concise coaching read.</strong><p>Only compact run metrics and modeled conditions are sent—never route points, coordinates, activity names, or descriptions.</p></div>
      <button type="button" class="run-digest-action" data-action="generate-run-digest" data-run-id="${escapeHtml(String(runId))}">Generate run digest</button>
    </div>
  `;
}

function runDigestLoadingMarkup() {
  return `
    <div class="run-digest-state">
      <span class="weather-pulse" aria-hidden="true"></span>
      <div><strong>Reading this run in context</strong><p>Ollama is comparing the effort with similar runs and the surrounding training block.</p></div>
    </div>
  `;
}

function runDigestErrorMarkup(runId, message) {
  return `
    <div class="run-digest-state error">
      <div><strong>The digest did not return</strong><p>${escapeHtml(message)}</p></div>
      <button type="button" class="run-digest-action secondary" data-action="generate-run-digest" data-run-id="${escapeHtml(String(runId))}">Try again</button>
    </div>
  `;
}

function runDigestResultMarkup(insight, model, digest) {
  const evidence = (insight.evidence || []).slice(0, 3).map((item) => `
    <article class="run-digest-evidence ${escapeHtml(item.tone || "neutral")}">
      <span>${escapeHtml(item.label || "Signal")}</span>
      <p>${escapeHtml(item.detail || "")}</p>
    </article>
  `).join("");
  return `
    <div class="run-digest-result">
      <span class="run-digest-kicker">Coach’s read</span>
      <h4>${escapeHtml(insight.headline || "A grounded view of this effort")}</h4>
      <p class="run-digest-copy">${escapeHtml(insight.digest || "")}</p>
      <div class="run-digest-evidence-grid">${evidence}</div>
      ${comparisonPlanMarkup(digest)}
      <p class="run-digest-caution">${escapeHtml(insight.caution || "Pattern-based context from your run data, not medical advice.")}</p>
      <small>Ollama · ${escapeHtml(model || "configured model")} · generated on demand</small>
    </div>
  `;
}

function setRunDigestContent(markup) {
  const container = els.workoutModalContent.querySelector("#workoutRunDigest");
  if (container) container.innerHTML = markup;
}

async function generateRunDigest(runId) {
  const run = state.filteredRuns.find((candidate) => String(candidate.id) === String(runId));
  if (!run || String(run.id) !== state.activeRunId) return;
  if (!await ensureAnalysisConsent()) return;
  if (String(run.id) !== state.activeRunId) return;
  const session = state.modalSession;
  const digest = buildWorkoutDigest(run);
  setRunDigestContent(runDigestLoadingMarkup());
  let weather = preferences.weather ? state.runWeatherCache.get(runWeatherKey(run)) || null : null;
  if (preferences.weather && !weather && weatherRequestDetails(run)) {
    try {
      weather = await requestRunWeather(run);
      if (session !== state.modalSession || state.activeRunId !== String(run.id)) return;
      state.activeRunWeather = weather;
      setWorkoutWeatherContent(weatherMarkup(weather));
    } catch {
      // A missing weather match should not block the run digest.
    }
  }
  if (session !== state.modalSession || state.activeRunId !== String(run.id)) return;
  const payload = buildRunDigestPayload(digest, weather);
  const cacheKey = JSON.stringify(payload);
  const cached = state.runDigestCache.get(cacheKey);
  if (cached) {
    setRunDigestContent(runDigestResultMarkup(cached.insight, cached.model, digest));
    return;
  }
  state.runDigestAbort?.abort();
  const controller = new AbortController();
  state.runDigestAbort = controller;
  const stopLoading = startAnalysisTimer(controller, document.querySelector("#workoutRunDigest"));
  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await readApiJson(response);
    if (!response.ok) throw new Error(data.error || "Ollama could not analyze this run.");
    if (session !== state.modalSession || state.activeRunId !== String(run.id)) return;
    state.runDigestCache.set(cacheKey, data);
    setRunDigestContent(runDigestResultMarkup(data.insight, data.model, digest));
  } catch (error) {
    if (session !== state.modalSession || state.activeRunId !== String(run.id)) return;
    setRunDigestContent(runDigestErrorMarkup(run.id, error.name === "AbortError" ? "Analysis canceled." : error.message || "The analysis service is unavailable."));
  } finally {
    stopLoading();
    if (state.runDigestAbort === controller) state.runDigestAbort = null;
  }
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
        <text x="${(x + barWidth / 2).toFixed(1)}" y="${Math.max(14, y - 7).toFixed(1)}" text-anchor="middle" fill="var(--ink)" font-size="11" font-weight="${selected ? "800" : "600"}">${displayDistance(distance)}</text>
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

function showWorkoutModal(runId, trigger = document.activeElement) {
  const run = state.filteredRuns.find((candidate) => String(candidate.id) === String(runId));
  if (!run) return;
  const openPanels = String(runId) === state.activeRunId ? [...els.workoutModalContent.querySelectorAll("details[open]")].map((element) => element.id) : [];
  rememberModalTrigger(trigger);
  state.modalSession += 1;
  const session = state.modalSession;
  state.runDigestAbort?.abort();
  state.runDigestAbort = null;
  state.activeRunId = String(run.id);
  state.activeRunWeather = preferences.weather ? state.runWeatherCache.get(runWeatherKey(run)) || null : null;
  const digest = buildWorkoutDigest(run);
  const narrative = workoutNarrative(digest);
  const averageHr = Number(run.average_heartrate) || 0;
  const maxHr = Number(run.max_heartrate) || 0;
  const rawCadence = Number(run.average_cadence) || 0;
  const cadence = rawCadence && rawCadence < 120 ? rawCadence * 2 : rawCadence;
  const watts = Number(run.average_watts) || 0;
  const maxSpeedPace = run.max_speed ? formatPace(1609.344 / run.max_speed) : "-";
  const bucketLabelText = digest.bucket ? `${digest.bucket.label}: ${displayDistance(digest.bucket.distanceMiles, 1)}, ${digest.bucket.runs} runs` : "No group context";
  const similarPaceText = digest.similarPace ? `${formatPace(digest.similarPace)} across ${digest.similarCount} similar` : "Needs more similar runs";
  const hrCompare = averageHr && digest.similarHr ? `${Math.round(averageHr - digest.similarHr) >= 0 ? "+" : ""}${Math.round(averageHr - digest.similarHr)} bpm vs similar` : "HR comparison unavailable";
  const socialText = `${run.kudos_count || 0} kudos · ${run.achievement_count || 0} achievements · ${run.pr_count || 0} PRs`;

  els.workoutModalContent.innerHTML = `
    <div class="workout-toolbar"><button type="button" data-action="previous-run">Previous run</button><button type="button" data-action="next-run">Next run</button>${state.dataSource === "strava" && /^\d+$/.test(String(run.id)) ? `<a target="_blank" rel="noopener noreferrer" href="https://www.strava.com/activities/${run.id}">Open in Strava</a>` : ""}<label>Compare with <select id="comparisonScope"><option value="distance">Similar distance</option><option value="sport">Same sport and distance</option><option value="recent">Recent 90 days and distance</option></select></label></div>
    <section id="enrichedRun" aria-live="polite"></section>
    <header class="workout-header">
      <p class="workout-kicker">${escapeHtml(digest.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" }))}</p>
      <h2 id="workoutModalTitle">${escapeHtml(run.name)}</h2>
      <div class="workout-header-meta">
        <span class="workout-type">${escapeHtml(digest.runType)} run</span>
        <span id="workoutModalMeta">${escapeHtml(bucketLabelText)}</span>
        <span>${escapeHtml(socialText)}</span>
      </div>
    </header>
    <div class="workout-body">
      <section class="workout-lead" aria-label="Workout summary">
        <div class="workout-lead-metrics">
          <article class="workout-lead-metric"><span>Distance</span><strong>${displayDistance(digest.distance, 2)}</strong><small>${formatOrdinal(digest.distanceRank)} percentile</small></article>
          <article class="workout-lead-metric"><span>Average pace</span><strong>${escapeHtml(formatPace(digest.pace))}</strong><small>${escapeHtml(similarPaceText)}</small></article>
          <article class="workout-lead-metric"><span>Moving time</span><strong>${escapeHtml(formatDuration(digest.moving))}</strong><small>${digest.stopped ? `${escapeHtml(formatDuration(digest.stopped))} stopped` : "Continuous effort"}</small></article>
        </div>
        <aside class="workout-read">
          <span>The read</span>
          <strong>${escapeHtml(narrative.headline)}</strong>
          <p>${escapeHtml(narrative.detail)}</p>
        </aside>
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
            <div class="workout-section-heading"><h3>Neighboring runs</h3><span>Miles · selected run in orange</span></div>
            <div class="neighbor-chart">${neighboringRunsChart(digest)}</div>
          </section>
          <section class="workout-section">
            <h3>Signals</h3>
            <div class="workout-signals">${digest.signals.map(signalMarkup).join("")}</div>
          </section>
          <section class="workout-section workout-ai-digest" aria-labelledby="workoutDigestTitle">
            <div class="workout-section-heading"><h3 id="workoutDigestTitle">Coach’s read</h3><span>Optional · on demand</span></div>
            <div id="workoutRunDigest" class="workout-run-digest" aria-live="polite">${runDigestEmptyMarkup(run.id)}</div>
          </section>
        </div>
        <aside>
          <section class="workout-section workout-weather" aria-labelledby="workoutWeatherTitle">
            <div class="workout-section-heading"><h3 id="workoutWeatherTitle">Conditions</h3><span>At the run start</span></div>
            <div id="workoutWeatherContent" class="workout-weather-content" aria-live="polite">${state.activeRunWeather ? weatherMarkup(state.activeRunWeather) : weatherLoadingMarkup()}</div>
          </section>
          <section class="workout-section">
            <h3>Run details</h3>
            <div class="workout-stats">
              ${statMarkup("Elevation", `${Math.round(digest.elevation).toLocaleString()} ft`, `${Math.round(digest.elevationDensity)} ft/mi`)}
              ${statMarkup("Heart rate", averageHr ? `${Math.round(averageHr)} bpm` : "-", maxHr ? `Max ${Math.round(maxHr)} bpm` : hrCompare)}
              ${statMarkup("Running time", `${Math.round(digest.load).toLocaleString()} min`, `${formatNumber(digest.loadPerMile, 1)} min/mi`)}
              ${statMarkup("Strava Relative Effort", run.suffer_score ? String(run.suffer_score) : "Unavailable", "Source value; separate from running time")}
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
              <dt>Device</dt><dd>${escapeHtml(run.device_name || "Not included in activity data")}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  `;
  els.workoutModal.hidden = false;
  hydrateRunDetail(run, session);
  finishModalRender(run, openPanels);
  document.body.classList.add("modal-open");
  els.workoutModalClose.focus();
  if (state.activeRunWeather) {
    setWorkoutWeatherContent(weatherMarkup(state.activeRunWeather));
  } else {
    hydrateWorkoutWeather(run, session);
  }
}

function closeWorkoutModal() {
  state.modalSession += 1;
  state.runDigestAbort?.abort();
  state.runDigestAbort = null;
  state.activeRunId = "";
  state.activeRunWeather = null;
  els.workoutModal.hidden = true;
  document.body.classList.remove("modal-open");
  els.workoutModalContent.replaceChildren();
  const returnTarget = state.modalTrigger?.isConnected ? state.modalTrigger : state.modalReturn ? findChartAction(state.modalReturn.containerId, state.modalReturn.key) : null;
  returnTarget?.focus({ preventScroll: true });
  state.modalTrigger = null;
  state.modalReturn = null;
}

function renderTable() {
  const query = els.runSearch.value.trim().toLocaleLowerCase();
  const sorters = {
    newest: (a, b) => parseActivityDate(b) - parseActivityDate(a),
    oldest: (a, b) => parseActivityDate(a) - parseActivityDate(b),
    distance: (a, b) => b.distance - a.distance,
    pace: (a, b) => (paceSeconds(a) || Infinity) - (paceSeconds(b) || Infinity)
  };
  const matching = state.filteredRuns.filter(matchesRunFilter).filter((run) => String(run.name).toLocaleLowerCase().includes(query)).sort(sorters[els.runSort.value] || sorters.newest);
  const pageSize = 15;
  state.ledgerPage = Math.min(state.ledgerPage, Math.max(0, Math.ceil(matching.length / pageSize) - 1));
  const offset = state.ledgerPage * pageSize;
  const recent = matching.slice(offset, offset + pageSize);
  els.activityCount.textContent = `${state.filteredRuns.length} runs in range`;
  els.pageSummary.textContent = matching.length ? `${offset + 1}–${offset + recent.length} of ${matching.length} runs${query ? " matching your search" : ""}` : "0 matching runs";
  els.previousPage.disabled = state.ledgerPage === 0;
  els.nextPage.disabled = offset + pageSize >= matching.length;
  els.ledgerEmpty.hidden = matching.length > 0;
  els.activityRows.replaceChildren(...recent.map((run) => {
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
    const values = [
      parseActivityDate(run).toLocaleDateString(),
      run.name,
      `${displayDistance(miles(run.distance), 2)}`,
      formatPace(paceSeconds(run)),
      run.has_elevation ? `${Math.round(feet(run.total_elevation_gain)).toLocaleString()} ft` : "Unavailable",
      run.average_heartrate ? `${Math.round(run.average_heartrate)} bpm` : "-",
      formatDuration(Number(run.moving_time) || 0)
    ];
    const labels = ["Date", "Name", "Distance", "Pace", "Elevation", "Heart rate", "Time"];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 0) cell.insertAdjacentHTML("beforeend", ` ${runTypeChip(run)}`);
      if (index === 1) cell.dataset.unitSkip = "";
      cell.dataset.label = labels[index];
      row.appendChild(cell);
    });
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      showWorkoutModal(run.id, action);
    });
    return row;
  }));
}

async function fetchActivities(mode = "recent") {
  if (state.syncing) return;
  state.syncing = true;
  els.connectButton.disabled = true;
  els.connectButton.textContent = "Syncing…";
  setStatus("Pulling activities from Strava...");
  try {
  const params = new URLSearchParams({ pages: "8", per_page: "100" });
  const previous = state.dataSource === "strava" ? state.rawActivities : [];
  if (previous.length) {
    if (mode === "older") params.set("before", String(Math.floor(Math.min(...previous.map((run) => new Date(run.start_date || run.start_date_local).valueOf())) / 1000)));
    else if (mode === "full") params.set("after", String(Math.floor(Math.min(...previous.map((run) => new Date(run.start_date || run.start_date_local).valueOf())) / 1000) - 1));
    else params.set("after", String(Math.floor((new Date(state.lastSync || Date.now()).valueOf() - 7 * 86400000) / 1000)));
  }
  const response = await fetch(`/api/activities?${params}`);
  const data = await readApiJson(response);
  if (!response.ok) {
    if (response.status === 401) {
      state.stravaConnected = false;
      sessionStorage.removeItem("run-trends-strava-session");
      throw new Error("Your Strava session expired. Connect Strava again to refresh your history.");
    }
    throw new Error(data.error || "Unable to fetch Strava activities.");
  }
  if (!Array.isArray(data.activities)) throw new Error("Strava returned an unreadable activity list. Try syncing again.");
  const incoming = data.activities.map(normalizeActivity);
  incoming.forEach((run) => state.activityDetails?.delete(String(run.id)));
  // A completed refresh replaces its queried interval, reflecting deletions and edits.
  const after = Number(params.get("after") || 0) * 1000;
  const kept = mode !== "older" && !data.truncated ? previous.filter((run) => new Date(run.start_date || run.start_date_local).valueOf() <= after) : previous;
  state.rawActivities = TrainingCore.mergeActivities(kept, incoming);
  state.dataSource = "strava";
  state.lastSync = new Date().toISOString();
  if (mode === "older" || !previous.length) state.historyTruncated = Boolean(data.truncated);
  else if (data.truncated) state.historyTruncated = true;
  const oldest = state.rawActivities.length ? Math.min(...state.rawActivities.map((run) => parseActivityDate(run).valueOf())) : Date.now();
  historyCoverage = { start: state.historyTruncated ? new Date(oldest).toISOString() : "1970-01-01T00:00:00.000Z", end: new Date().toISOString() };
  try { sessionStorage.setItem("run-trends-strava-session", JSON.stringify({ activities: state.rawActivities, lastSync: state.lastSync, truncated: state.historyTruncated, coverage: historyCoverage })); } catch { /* A full sync remains available without a cache. */ }
  state.ledgerPage = 0;
  syncRangeInputs();
  setStatus(`Loaded ${incoming.length} activities from Strava; ${state.rawActivities.length} in history.${state.historyTruncated ? " Load older activities to extend the history." : ""}`);
  render();
  } finally {
    state.syncing = false;
    document.querySelector("#disconnectButton").hidden = !state.stravaConnected;
    renderSyncInfo();
    els.connectButton.disabled = false;
    els.connectButton.textContent = state.stravaConnected ? "Refresh Strava" : "Connect Strava";
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
  const response = await fetch("/api/status");
  const data = await readApiJson(response);
  state.analysisService = data.analysisService || "Configured Ollama service";
  state.analysisModel = data.analysisModel || "Configured model";
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
    return;
  }
  state.stravaReady = true;
  state.stravaConnected = Boolean(data.connected);
  state.stravaError = "";
  els.connectButton.disabled = false;
  els.connectButton.title = "";
  if (data.connected) {
    els.connectButton.textContent = "Refresh Strava";
    let cached;
    try { cached = JSON.parse(sessionStorage.getItem("run-trends-strava-session")); } catch { /* Ignore an unreadable cache. */ }
    if (Array.isArray(cached?.activities) && cached.activities.every((run) => run && typeof run === "object" && Number.isFinite(parseActivityDate(run).valueOf())) && !new URLSearchParams(location.search).has("connected") && state.dataSource !== "import") {
      state.rawActivities = cached.activities.map(normalizeActivity); state.dataSource = "strava"; state.lastSync = cached.lastSync; state.historyTruncated = cached.truncated; historyCoverage = cached.coverage;
      syncRangeInputs(); render();
      const age = Date.now() - new Date(cached.lastSync).valueOf();
      if (!Number.isFinite(age) || age < 0 || age > 5 * 60 * 1000) await fetchActivities();
    } else if (state.dataSource !== "import") await fetchActivities();
  } else {
    sessionStorage.removeItem("run-trends-strava-session");
    setStatus("");
  }
  const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete("connected"); cleanUrl.searchParams.delete("disconnected"); history.replaceState(null, "", cleanUrl);
}

function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, "");
  const records = [];
  let record = [];
  let value = "";
  let quoted = false;
  let closedQuote = false;
  const finishField = () => {
    record.push(value);
    value = "";
    closedQuote = false;
  };
  const finishRecord = () => {
    finishField();
    if (record.some((field) => field.trim() !== "")) records.push(record);
    record = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        value += character;
      }
    } else if (character === ",") {
      finishField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      finishRecord();
    } else if (character === '"' && value.trim() === "" && !closedQuote) {
      value = "";
      quoted = true;
    } else if (closedQuote) {
      if (!/\s/.test(character)) throw new Error("This CSV has text after a closing quote. Check the export and try again.");
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("This CSV has an unfinished quoted field. Export it again and retry.");
  finishRecord();
  if (!records.length) return [];
  const occurrences = new Map();
  const headers = records.shift().map((header) => {
    const name = header.trim();
    const count = (occurrences.get(name) || 0) + 1;
    occurrences.set(name, count);
    return count === 1 ? name : `${name}__${count}`;
  });
  return records.map((values, index) => {
    if (values.length > headers.length) throw new Error(`CSV row ${index + 2} has more values than its header. Check for an unquoted comma.`);
    return headers.reduce((row, header, column) => {
      if (header) row[header] = values[column] ?? "";
      return row;
    }, Object.create(null));
  });
}

async function importFile(file) {
  if (file.size > 25_000_000) throw new Error("Choose an activity export smaller than 25 MB.");
  const text = await file.text();
  if (!text.trim()) throw new Error("This file is empty. Choose a Strava CSV or JSON export.");
  let data;
  if (file.name.toLowerCase().endsWith(".csv")) {
    data = parseCsv(text);
  } else {
    try { data = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { throw new Error("This file is not valid JSON. Choose a Strava CSV or JSON export."); }
  }
  const rows = Array.isArray(data) ? data : data?.activities;
  if (!Array.isArray(rows)) throw new Error("Expected an activities array or a Strava CSV export.");
  const activities = rows
    .filter((activity) => activity && typeof activity === "object" && !Array.isArray(activity))
    .map(normalizeActivity)
    .filter((activity) => !Number.isNaN(parseActivityDate(activity).valueOf()));
  if (!activities.some(isRun)) throw new Error("No running activities with valid dates were found. Choose a Strava running export.");
  const decision = await requestImportReview(activities, rows.length - activities.length);
  if (!decision) { setStatus("Import canceled. Your current history is unchanged."); return; }
  state.rawActivities = decision.mode === "merge" && state.dataSource !== "demo" ? TrainingCore.mergeActivities(state.rawActivities, activities) : TrainingCore.mergeActivities([], activities);
  state.dataSource = "import";
  state.lastSync = null; state.historyTruncated = false;
  const bounds = getActivityBounds();
  historyCoverage = decision.complete ? { start: bounds.start.toISOString(), end: bounds.end.toISOString() } : null;
  const remembered = rememberHistory();
  state.ledgerPage = 0;
  syncRangeInputs();
  render();
  const skipped = rows.length - activities.length;
  setStatus(`Imported ${activities.length} activities.${skipped ? ` Skipped ${skipped} invalid ${skipped === 1 ? "row" : "rows"}.` : ""}${remembered ? "" : " Browser storage is full or unavailable. This import will not survive closing the tab; export a backup."}`, !remembered);
}

function makeDemoData() {
  const activities = [];
  const today = new Date();
  let seed = 314159;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 390; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    date.setHours(7, 15, 0, 0);
    if (![1, 3, 5, 6].includes(date.getDay()) || random() < 0.16) continue;
    const longRun = date.getDay() === 6;
    const baseMiles = longRun ? 8 + random() * 7 : 3 + random() * 5;
    const trend = 1 + (390 - i) / 900;
    const distanceMiles = baseMiles * trend;
    const pace = 520 - (390 - i) * 0.16 + random() * 45;
    const movingTime = Math.round(distanceMiles * pace);
    // Heart rate follows the effort: the oxygen cost of the pace against a
    // VO2 max that improves through the year, plus drift on long runs.
    const vo2max = 46 + (390 - i) / 390 * 4.5;
    const speed = 1609.344 / (pace / 60);
    const reserve = (FitnessCore.oxygenCost(speed) - 3.5) / (vo2max - 3.5) + (random() - 0.5) * 0.06 + (longRun ? 0.03 : 0);
    const hr = 52 + Math.min(0.97, reserve) * 138;
    activities.push({
      id: `demo-${i}`,
      name: longRun ? "Long run" : ["Easy run", "Workout", "Steady run"][Math.floor(random() * 3)],
      sport_type: "Run",
      start_date_local: `${localDateValue(date)}T07:15:00`,

      distance: distanceMiles * 1609.344,
      moving_time: movingTime,
      elapsed_time: movingTime + Math.round(random() * 180),
      total_elevation_gain: (40 + random() * 95) * distanceMiles / 3.28084,
      average_heartrate: Math.round(hr),
      max_heartrate: Math.min(191, Math.round(hr + 10 + random() * 18)),
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

function connectToStrava() {
  if (!state.stravaReady) {
    setStatus(state.stravaError || "Strava is not configured yet.", true);
    if (!state.stravaError) window.location.href = "/auth/login";
  } else if (state.stravaConnected || els.connectButton.textContent.includes("Refresh")) {
    fetchActivities().catch((error) => setStatus(error.message, true));
  } else {
    window.location.href = "/auth/login";
  }
}

function loadDemoData() {
  if (state.syncing) return;
  state.rawActivities = makeDemoData();
  state.dataSource = "demo";
  state.lastSync = null; state.historyTruncated = false;
  const demoStart = new Date(); demoStart.setDate(demoStart.getDate() - 389); demoStart.setHours(0, 0, 0, 0);
  const demoEnd = new Date(); demoEnd.setHours(23, 59, 59, 999);
  historyCoverage = { start: demoStart.toISOString(), end: demoEnd.toISOString() };
  state.ledgerPage = 0;
  syncRangeInputs();
  setStatus("");
  render();
}

function handleFileInput(event) {
  const [file] = event.target.files;
  if (file) importFile(file).catch((error) => setStatus(error.message, true)).finally(() => { event.target.value = ""; });
}

[els.connectButton, els.emptyConnectButton].filter(Boolean).forEach((button) => {
  button.addEventListener("click", connectToStrava);
});

[els.demoButton, els.emptyDemoButton].filter(Boolean).forEach((button) => {
  button.addEventListener("click", loadDemoData);
});

els.aiAnalyzeButton.addEventListener("click", analyzeWithOllama);

els.aiFocus.addEventListener("change", () => {
  state.renderedInsightFingerprint = "";
  renderAiState();
});

[els.fileInput, els.emptyFileInput].filter(Boolean).forEach((input) => {
  input.addEventListener("change", handleFileInput);
});

els.activityRows.addEventListener("click", (event) => {
  const button = event.target.closest(".row-detail-button");
  if (button) showWorkoutModal(button.dataset.activityId, button);
});

els.workoutModalClose.addEventListener("click", closeWorkoutModal);

els.workoutModal.addEventListener("click", (event) => {
  if (event.target === els.workoutModal) {
    closeWorkoutModal();
    return;
  }
  const digestAction = event.target.closest("[data-action='generate-run-digest']");
  if (digestAction?.dataset.runId) generateRunDigest(digestAction.dataset.runId);
  const runAction = event.target.closest("[data-action='open-run']");
  if (runAction?.dataset.runId) showWorkoutModal(runAction.dataset.runId, runAction);
});

els.goalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  coachingContext.goal = { mode: els.goalMode.value, miles: els.goalMiles.value ? String(Number(els.goalMiles.value) / (preferences.units === "metric" ? 1.609344 : 1)) : "", raceName: els.goalRaceName.value.trim(), raceDistance: els.goalRaceDistance.value, raceDate: els.goalRaceDate.value, runDays: els.goalRunDays.value, longRunDay: els.goalLongRunDay.value, availability: els.goalAvailability.value.trim() };
  const saved = saveCoachingContext();
  state.renderedInsightFingerprint = "";
  render();
  setStatus(saved ? "Training goal saved in this browser." : "Goal updated in this tab. Browser storage failed; back up your goals before closing.", !saved);
  if (saved) buttonFeedback(els.goalForm.querySelector("button[type='submit']"), "Goal saved");
});

els.checkinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  coachingContext.checkin = { feel: els.checkinFeel.value, limiter: els.checkinLimiter.value, intent: els.checkinIntent.value, outcome: els.checkinOutcome.value, savedAt: new Date().toISOString(), missedReason: document.querySelector("#missedReason").value };
  const saved = saveCoachingContext();
  state.renderedInsightFingerprint = "";
  render();
  setStatus(saved ? "Weekly check-in saved in this browser." : "Check-in updated in this tab. Browser storage failed; back up your context before closing.", !saved);
  if (saved) buttonFeedback(els.checkinForm.querySelector("button[type='submit']"), "Check-in saved");
});

els.copyPlanButton.addEventListener("click", async () => {
  const days = [...els.recommendedCalendar.querySelectorAll("button")].map((day) => day.innerText.replace(/\n/g, " · "));
  try { await navigator.clipboard.writeText([els.planDraftCopy.textContent, els.planAdaptation.textContent, ...days].join("\n\n")); buttonFeedback(els.copyPlanButton, "Draft copied"); setStatus("Next-week draft and calendar copied. Review them before using them."); } catch { setStatus("Copy is unavailable in this browser.", true); }
});

function buttonFeedback(button, message) {
  const label = button.textContent;
  button.textContent = message;
  setTimeout(() => { button.textContent = label; }, 2200);
}

[els.runSearch, els.runSort].forEach((element) => element.addEventListener(element === els.runSearch ? "input" : "change", () => {
  state.ledgerPage = 0;
  renderTable();
  saveViewState();
}));
document.querySelector("#clearSearchButton").addEventListener("click", () => {
  els.runSearch.value = "";
  state.ledgerPage = 0;
  renderTable();
  saveViewState();
  els.runSearch.focus();
});
[[els.previousPage, -1], [els.nextPage, 1]].forEach(([button, direction]) => button.addEventListener("click", () => {
  state.ledgerPage += direction;
  renderTable();
}));
document.querySelector("#resetWindowButton").addEventListener("click", () => {
  els.rangeSelect.value = "all";
  state.ledgerPage = 0;
  syncRangeInputs();
  render();
  els.rangeSelect.focus();
});
document.querySelector("#copyViewButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  saveViewState();
  try {
    await navigator.clipboard.writeText(window.location.href);
    buttonFeedback(button, "Link copied");
    setStatus("View link copied. It includes filters; activity data stays in this tab and must be loaded separately.");
  } catch { setStatus("Copy is unavailable. You can copy the address from your browser.", true); }
});
document.querySelector("#exportButton").addEventListener("click", () => {
  const columns = ["id", "name", "sport_type", "start_date", "start_date_local", "distance", "moving_time", "elapsed_time", "total_elevation_gain", "has_elevation", "average_heartrate", "suffer_score", "workout_type", "trainer"];
  const csvCell = (value) => `"${String(value ?? "").replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
  const content = [columns.join(","), ...state.filteredRuns.map((run) => columns.map((column) => csvCell(run[column])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `run-trends-${els.startDate.value}-to-${els.endDate.value}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`Exported ${state.filteredRuns.length} runs from the selected window. Distances and elevation use meters in the CSV.`);
});
document.querySelector("#disconnectButton").addEventListener("click", () => {
  sessionStorage.removeItem("run-trends-strava-session");
  window.location.href = "/auth/logout";
});

els.keyRuns.addEventListener("click", (event) => {
  const card = event.target.closest(".key-run-card");
  if (card?.dataset.activityId) showWorkoutModal(card.dataset.activityId, card);
});

els.recommendedCalendar.addEventListener("click", (event) => {
  const day = event.target.closest("[data-action='cycle-plan-status']");
  if (day?.dataset.planDate) cyclePlanStatus(day.dataset.planDate);
});

els.aiInsightContent.addEventListener("click", (event) => {
  const source = event.target.closest("[data-action='open-run']");
  if (source?.dataset.runId) showWorkoutModal(source.dataset.runId, source);
});

document.addEventListener("keydown", (event) => {
  if (els.workoutModal.hidden) return;
  if (event.key === "Escape") closeWorkoutModal();
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
  state.ledgerPage = 0;
  syncRangeInputs();
  render();
});

[els.startDate, els.endDate].forEach((element) => {
  element.addEventListener("change", () => {
    els.rangeSelect.value = "custom";
    document.body.classList.add("is-custom-range");
    state.ledgerPage = 0;
    render();
  });
});

[els.bucketSelect, els.metricSelect].forEach((element) => {
  element.addEventListener("change", render);
});

initializeExperience();
restoreViewState();
syncRangeInputs();
syncCoachingInputs();
bindTooltips();
render();
checkStatus().catch((error) => setStatus(error.message, true));

let chartResizeTimer;
let lastChartWidth = document.querySelector("#app").clientWidth;
new ResizeObserver(() => {
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(() => {
    if (!state.rawActivities.length) return;
    const width = document.querySelector("#app").clientWidth;
    // Height changes (opening a section, new rows) must not redraw: that would drop a hover in progress.
    if (width === lastChartWidth) return;
    lastChartWidth = width;
    if (activeView === "overview" && state.filteredRuns.length) {
      renderMainChart();
      renderSecondaryCharts();
    }
    if (activeView === "fitness") renderFitness();
  }, 120);
}).observe(document.querySelector("#app"));
