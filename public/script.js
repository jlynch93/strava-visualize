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
  textureWeatherFingerprint: ""
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
  readinessContent: document.querySelector("#readinessContent"),
  planDraftCopy: document.querySelector("#planDraftCopy"),
  recommendedCalendar: document.querySelector("#recommendedCalendar"),
  copyPlanButton: document.querySelector("#copyPlanButton"),
  workoutModal: document.querySelector("#workoutModal"),
  workoutModalClose: document.querySelector("#workoutModalClose"),
  workoutModalContent: document.querySelector("#workoutModalContent")
};

const CONTEXT_STORAGE_KEY = "run-trends-coaching-context-v1";
let coachingContext = loadCoachingContext();

function loadCoachingContext() {
  try { return JSON.parse(localStorage.getItem(CONTEXT_STORAGE_KEY)) || { goal: {}, checkin: {} }; } catch { return { goal: {}, checkin: {} }; }
}

function saveCoachingContext() {
  try { localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(coachingContext)); } catch { /* Local context is optional. */ }
}

function syncCoachingInputs() {
  els.goalMode.value = coachingContext.goal.mode || "auto";
  els.goalMiles.value = coachingContext.goal.miles || "";
  els.goalRaceName.value = coachingContext.goal.raceName || coachingContext.goal.event || "";
  els.goalRaceDistance.value = coachingContext.goal.raceDistance || "";
  els.goalRaceDate.value = coachingContext.goal.raceDate || "";
  els.goalRunDays.value = coachingContext.goal.runDays || "";
  els.goalLongRunDay.value = coachingContext.goal.longRunDay || "Sat";
  els.goalAvailability.value = coachingContext.goal.availability || "";
  els.checkinFeel.value = coachingContext.checkin.feel || "";
  els.checkinLimiter.value = coachingContext.checkin.limiter || "none";
  els.checkinIntent.value = coachingContext.checkin.intent || "mixed";
}

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

function normalizeLatLng(value) {
  const pair = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/[\[\]()]/g, "").split(",")
      : [];
  const latitude = Number(pair[0]);
  const longitude = Number(pair[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return [latitude, longitude];
}

function normalizeActivity(activity) {
  const startLatLng = normalizeLatLng(activity.start_latlng || activity["Start LatLng"])
    || normalizeLatLng([activity.start_latitude ?? activity["Start Latitude"], activity.start_longitude ?? activity["Start Longitude"]]);
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
    description: activity.description || activity.Description || "",
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
  document.body.classList.toggle("is-custom-range", mode === "custom");
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
  state.insightFingerprint = JSON.stringify({
    range: [els.startDate.value, els.endDate.value],
    grouping: els.bucketSelect.value,
    runs: state.filteredRuns.map((run) => [run.id, run.start_date_local || run.start_date])
  });

  const summary = summarize(state.filteredRuns, state.buckets);
  const previous = summarizePreviousPeriod(normalized, start, end);
  renderHeroStatus(summary);
  renderBlockReview(summary, previous);
  renderCoachingWorkspace(summary);
  renderTrainingTexture();
  renderKeyRuns();
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

function renderHeroStatus(summary) {
  const hasData = summary.runCount > 0;
  document.body.classList.toggle("has-data", hasData);
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
    els.trainingTextureStats.innerHTML = textureStat("Start temperature", "—", "Load a running block") + textureStat("Typical start", "—", "Local activity time") + textureStat("Favorite day", "—", "Most common run day") + textureStat("Long-run share", "—", "Miles from your longest runs") + textureStat("Climb per mile", "—", "Elevation across this window");
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
  const elevation = runs.reduce((sum, run) => sum + feet(run.total_elevation_gain), 0);
  els.trainingTextureStats.innerHTML = [
    textureStat("Start temperature", temperature.value, temperature.detail, temperatures.length ? "weather-ready" : ""),
    textureStat("Typical start", start.value, start.detail),
    textureStat("Favorite day", day.value, day.detail),
    textureStat("Long-run share", `${longRunShare}%`, "Miles from your longest fifth"),
    textureStat("Climb per mile", totalMiles ? `${Math.round(elevation / totalMiles)} ft` : "—", "Across this selected window")
  ].join("");
  if (!weatherRuns.length || state.textureWeatherFingerprint === state.insightFingerprint) return;
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
    name: String(run.name || "Run").slice(0, 80),
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
    coachingContext,
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
      rampRatePercent: Math.round(summary.rampRate),
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
  sources.innerHTML = `<span>Evidence considered</span>${state.filteredRuns.slice(-3).reverse().map((run) => `<button type="button" data-action="open-run" data-run-id="${escapeHtml(String(run.id))}">${escapeHtml(run.name)} · ${miles(run.distance).toFixed(1)} mi</button>`).join("")}`;
  els.aiInsightContent.replaceChildren(header, observations, nextStep, sources, caution);
}

async function analyzeWithOllama() {
  if (!state.filteredRuns.length) return;
  const requestedFingerprint = state.insightFingerprint;
  els.aiAnalyzeButton.disabled = true;
  els.aiAnalyzeButton.textContent = "Analyzing…";
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
    renderAiInsight(data.insight);
  } catch (error) {
    state.renderedInsightFingerprint = "";
    renderAiError(error.message || "Check that the Ollama URL is reachable and try again.");
  } finally {
    els.aiAnalyzeButton.disabled = !state.filteredRuns.length;
    els.aiAnalyzeButton.textContent = "Analyze selected window";
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
  const periodLabel = `${state.buckets.length} ${els.bucketSelect.value === "week" ? "weeks" : "months"}`;
  els.mainChartSubtitle.textContent = els.metricSelect.value === "pace" ? `${periodLabel} · faster is higher` : periodLabel;
  renderBarLineChart(els.mainChart, state.buckets, metric);
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
  const evidence = [
    { label: "Volume", value: `${summary.totalMiles.toFixed(1)} mi`, detail: volumeChange === null ? "First comparable window" : `${volumeChange >= 0 ? "+" : ""}${Math.round(volumeChange)}% vs prior window` },
    { label: "Pace", value: formatPace(summary.averagePace), detail: paceChangeText(summary.averagePace, previous.averagePace) },
    { label: "Rhythm", value: `${summary.averageRunsPerWeek.toFixed(1)} runs/wk`, detail: `${summary.activeDays} active days · longest run ${summary.longRun.toFixed(1)} mi` }
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
    { label: "Highest effort", run: [...runs].sort((a, b) => activityLoad(b) - activityLoad(a))[0], reason: "Highest estimated effort" },
    { label: "Fastest comparable", run: [...runs].filter((run) => miles(run.distance) >= 4).sort((a, b) => paceSeconds(a) - paceSeconds(b))[0], reason: "Fastest run over four miles" }
  ].filter((item) => item.run);
  const unique = candidates.filter((item, index, list) => list.findIndex((candidate) => String(candidate.run.id) === String(item.run.id)) === index);
  els.keyRuns.replaceChildren(...unique.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key-run-card";
    button.dataset.activityId = item.run.id;
    button.innerHTML = `<span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.run.name)}</strong><em>${escapeHtml(parseActivityDate(item.run).toLocaleDateString(undefined, { month: "short", day: "numeric" }))} · ${miles(item.run.distance).toFixed(2)} mi · ${escapeHtml(formatPace(paceSeconds(item.run)))}</em><small>${escapeHtml(item.reason)}</small>`;
    return button;
  }));
}

function renderCoachingWorkspace(summary) {
  if (!summary.runCount) {
    els.readinessContent.innerHTML = '<p class="context-muted">Add a training block to see the inputs behind this view.</p>';
    els.planDraftCopy.textContent = "Load a block to create a transparent draft.";
    els.recommendedCalendar.replaceChildren();
    els.copyPlanButton.disabled = true;
    return;
  }
  const newest = state.filteredRuns[state.filteredRuns.length - 1];
  const sevenStart = new Date(parseActivityDate(newest)); sevenStart.setDate(sevenStart.getDate() - 6);
  const lastSeven = state.filteredRuns.filter((run) => parseActivityDate(run) >= sevenStart);
  const sevenMiles = lastSeven.reduce((sum, run) => sum + miles(run.distance), 0);
  const baseline = summary.averageWeeklyMiles;
  const hardRuns = lastSeven.filter((run) => Number(run.average_heartrate) >= 155 || activityLoad(run) / Math.max(miles(run.distance), 1) >= summary.averageLoadPerMile * 1.15).length;
  const confidence = state.filteredRuns.length >= 12 ? "High" : state.filteredRuns.length >= 6 ? "Moderate" : "Early";
  const race = raceContext();
  els.readinessContent.innerHTML = `<div class="readiness-metric"><strong>${sevenMiles.toFixed(1)} mi</strong><span>last 7 days · ${baseline.toFixed(1)} mi baseline</span></div><ul><li>${lastSeven.length} runs in the last 7 days</li><li>${hardRuns} higher-effort run${hardRuns === 1 ? "" : "s"} by available data</li><li>${summary.longestRestGap} days longest rest gap</li><li>${confidence} confidence · ${summary.runCount} runs in this block${race ? `</li><li>${race.label} · ${race.weeks} weeks away · ${race.phase} phase` : ""}</li></ul><p class="context-muted">This is a transparent workload view, not a medical or readiness score.</p>`;
  const goalMiles = Number(coachingContext.goal.miles) || baseline;
  const recommendation = recommendIntent(summary, race);
  const chosenIntent = coachingContext.goal.mode || "auto";
  const intent = chosenIntent === "auto" ? recommendation.intent : chosenIntent;
  els.intentRecommendation.textContent = chosenIntent === "auto"
    ? `Recommended: ${recommendation.intent} — ${recommendation.reason}`
    : `Manual override: ${intent}. Auto recommends ${recommendation.intent} because ${recommendation.reason}`;
  const range = intent === "build" ? `${goalMiles.toFixed(0)}–${(goalMiles * 1.08).toFixed(0)}` : intent === "recover" ? `${(goalMiles * 0.7).toFixed(0)}–${(goalMiles * 0.85).toFixed(0)}` : `${(goalMiles * 0.9).toFixed(0)}–${goalMiles.toFixed(0)}`;
  const raceLead = race ? `${race.label} is ${race.weeks} week${race.weeks === 1 ? "" : "s"} away (${race.phase} phase). ` : "";
  els.planDraftCopy.textContent = `${raceLead}${intent[0].toUpperCase() + intent.slice(1)} week draft: ${range} mi across about ${Math.max(2, Math.round(summary.averageRunsPerWeek))} runs. Keep the longest run at or below ${summary.longRun.toFixed(1)} mi. Review and adjust it to your schedule, race goal, and how you feel.`;
  renderRecommendedCalendar(intent, summary, goalMiles, race);
  els.copyPlanButton.disabled = false;
}

function renderRecommendedCalendar(intent, summary, targetMiles, race) {
  const start = new Date();
  const day = start.getDay();
  start.setDate(start.getDate() + ((8 - day) % 7 || 7));
  start.setHours(0, 0, 0, 0);
  const runCount = Number(coachingContext.goal.runDays) || Math.max(3, Math.round(summary.averageRunsPerWeek));
  const longRun = Math.min(summary.longRun, targetMiles * 0.35);
  let schedule = intent === "recover"
    ? [["Rest / mobility", "Leave room to recover"], ["Easy run", "Conversational effort"], ["Rest", "Optional walk"], ["Easy run", "Keep it short and easy"], ["Rest", "Review how you feel"], ["Easy long run", `At or below ${longRun.toFixed(1)} mi`], ["Rest / optional easy", "Only if you feel ready"]]
    : [["Easy run", "Conversational effort"], ["Quality option", "Choose only if your check-in supports it"], ["Easy or rest", "Create space between demanding days"], ["Steady run", "Keep the weekly range in view"], ["Easy or rest", "Adjust to life and recovery"], ["Long run", `At or below ${longRun.toFixed(1)} mi`], ["Easy / optional", `${runCount} runs is a reference, not a requirement`]];
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const longIndex = dayNames.indexOf(coachingContext.goal.longRunDay || "Sat");
  if (longIndex >= 0 && longIndex !== 5) [schedule[5], schedule[longIndex]] = [schedule[longIndex], schedule[5]];
  const available = String(coachingContext.goal.availability || "").toLowerCase().match(/mon|tue|wed|thu|fri|sat|sun/g);
  if (available?.length) schedule = schedule.map((session, index) => available.includes(dayNames[index].toLowerCase()) ? session : ["Rest / unavailable", "Outside your saved availability"]);
  let remainingRuns = runCount;
  schedule = schedule.map((session) => {
    const isRun = /run|quality|long|steady|optional/i.test(session[0]);
    if (!isRun || remainingRuns-- > 0) return session;
    return ["Rest / optional", "Above your selected weekly run limit"];
  });
  const planState = coachingContext.plan || {};
  els.recommendedCalendar.innerHTML = schedule.map(([title, detail], index) => {
    const date = new Date(start); date.setDate(start.getDate() + index);
    const isRace = race && localDateValue(date) === coachingContext.goal.raceDate;
    const dateKey = localDateValue(date);
    const completed = state.filteredRuns.some((run) => localDateValue(parseActivityDate(run)) === dateKey);
    const status = completed ? "completed" : planState[dateKey] || "planned";
    return `<button type="button" class="recommended-day ${status}${isRace ? " race-day" : ""}" data-action="cycle-plan-status" data-plan-date="${dateKey}"><span>${date.toLocaleDateString(undefined, { weekday: "short" })}</span><time>${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time><strong>${isRace ? "Race day" : title}</strong><small>${isRace ? race.label : detail}</small><em>${status === "completed" ? "Completed from Strava" : status === "skipped" ? "Skipped" : "Planned · click to update"}</em></button>`;
  }).join("");
}

function cyclePlanStatus(date) {
  const current = coachingContext.plan?.[date] || "planned";
  const next = current === "planned" ? "completed" : current === "completed" ? "skipped" : "planned";
  coachingContext.plan = { ...(coachingContext.plan || {}), [date]: next };
  saveCoachingContext();
  render();
  setStatus(`Plan session marked ${next}.`);
}

function recommendIntent(summary, race) {
  const checkin = coachingContext.checkin || {};
  if (checkin.feel && Number(checkin.feel) <= 2) return { intent: "recover", reason: "your check-in reported a hard block" };
  if (checkin.limiter && checkin.limiter !== "none") return { intent: "maintain", reason: `${checkin.limiter} was marked as a limiting factor` };
  if (race && race.weeks <= 2) return { intent: "recover", reason: "the race is close enough to prioritize freshness" };
  if (race && race.weeks <= 12 && summary.rampRate <= 15) return { intent: "build", reason: "you are in the race build window with a controlled recent ramp" };
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

function showRunCollectionModal(title, runs, trigger = document.activeElement) {
  if (!runs.length) return;
  const totalMiles = runs.reduce((sum, run) => sum + miles(run.distance), 0);
  const totalSeconds = runs.reduce((sum, run) => sum + (Number(run.moving_time) || 0), 0);
  state.modalSession += 1;
  state.runDigestAbort?.abort();
  state.runDigestAbort = null;
  state.activeRunId = "";
  state.modalTrigger = trigger instanceof HTMLElement ? trigger : null;
  els.workoutModalContent.innerHTML = `
    <header class="workout-header collection-header">
      <p class="workout-kicker">Chart selection</p>
      <h2 id="workoutModalTitle">${escapeHtml(title)}</h2>
      <div class="workout-header-meta"><span>${runs.length} run${runs.length === 1 ? "" : "s"}</span><span>${totalMiles.toFixed(1)} mi</span><span>${formatPace(totalSeconds / totalMiles)} average pace</span></div>
    </header>
    <div class="workout-body collection-body">
      <p>Select a run to open its full detail, conditions, and coach’s read.</p>
      <div class="chart-run-list">${runs.map((run) => `
        <button type="button" class="chart-run-option" data-action="open-run" data-run-id="${escapeHtml(String(run.id))}">
          <span>${escapeHtml(parseActivityDate(run).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</span>
          <strong>${escapeHtml(run.name)}</strong>
          <em>${miles(run.distance).toFixed(2)} mi · ${escapeHtml(formatPace(paceSeconds(run)))}</em>
        </button>`).join("")}</div>
    </div>
  `;
  els.workoutModal.hidden = false;
  document.body.classList.add("modal-open");
  els.workoutModalClose.focus();
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
    const tick = metricKey === "pace" ? min + (span / 4) * i : max - (span / 4) * i;
    root.appendChild(svg("text", { class: "label", x: 8, y: y + 4 }, [document.createTextNode(metric.format(tick).replace("/mi", ""))]));
  }
  const points = buckets.map((bucket, index) => {
    const value = metric.value(bucket);
    const x = pad.left + index * (chartWidth / buckets.length) + (chartWidth / buckets.length) / 2;
    const normalizedValue = (value - min) / span;
    const y = metricKey === "pace"
      ? pad.top + normalizedValue * chartHeight
      : pad.top + chartHeight - normalizedValue * chartHeight;
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
    const normalizedValue = (value - min) / span;
    const y = metricKey === "pace"
      ? pad.top + normalizedValue * chartHeight
      : pad.top + chartHeight - normalizedValue * chartHeight;
    return `${x},${y}`;
  });
  root.appendChild(svg("polyline", { class: "line secondary", points: smoothPoints.join(" ") }));
  root.appendChild(svg("text", { class: "label", x: width - 180, y: 16 }, [document.createTextNode("actual · moving average")]));
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
  const paceRange = Math.max(maxPace - minPace, 1);
  for (let tick = 0; tick <= 3; tick += 1) {
    const y = pad.top + (tick / 3) * (height - pad.top - pad.bottom);
    const pace = minPace + (tick / 3) * paceRange;
    root.appendChild(svg("line", { class: "axis chart-grid", x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
    root.appendChild(svg("text", { class: "label", x: 4, y: y + 4 }, [document.createTextNode(formatPace(pace).replace("/mi", ""))]));
  }
  buckets.forEach((bucket) => {
    const x = pad.left + (bucket.distanceMiles / maxMiles) * (width - pad.left - pad.right);
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
      { label: "Bubble size", value: `${bucket.runs} runs` },
      { label: "Open", value: "View runs in this period" }
    ]);
    attachChartAction(dot, `${bucket.label} runs`, runsForBucket(bucket));
    root.appendChild(dot);
  });
  root.appendChild(svg("text", { class: "label", x: width - 136, y: height - 10 }, [document.createTextNode("more miles →")]));
  root.appendChild(svg("text", { class: "label", x: pad.left + 8, y: pad.top + 13 }, [document.createTextNode("faster ↑")]));
  root.appendChild(svg("text", { class: "label chart-legend", x: width - 258, y: 14 }, [document.createTextNode("Color: HR · blue <140 · gold 140–154 · orange 155+")]));
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
  const chartHeight = height - pad.top - pad.bottom;
  for (let tick = 0; tick <= maxRuns; tick += 1) {
    const y = height - pad.bottom - (tick / maxRuns) * chartHeight;
    root.appendChild(svg("line", { class: "axis chart-grid", x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
    root.appendChild(svg("text", { class: "label", x: 18, y: y + 4 }, [document.createTextNode(String(tick))]));
  }
  const longRunPoints = [];
  state.buckets.forEach((bucket, index) => {
    const x = pad.left + index * step + step * 0.25;
    const runHeight = (bucket.runs / maxRuns) * chartHeight;
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
      { label: "Avg pace", value: formatPace(bucket.averagePace) },
      { label: "Open", value: "View runs this week" }
    ]);
    attachChartAction(runBar, `${bucket.label} runs`, runsForBucket(bucket));
    root.appendChild(runBar);
    const pointX = x + Math.max(3, step * 0.13);
    const pointY = height - pad.bottom - bucket.longRunShare * chartHeight;
    const longRunPoint = svg("circle", { class: "structure-point", cx: pointX, cy: pointY, r: 4 });
    attachTooltip(longRunPoint, `${bucket.label} long-run share`, [
      { label: "Long run", value: `${bucket.longRunMiles.toFixed(1)} mi` },
      { label: "Share", value: `${Math.round(bucket.longRunShare * 100)}%` },
      { label: "Week miles", value: `${bucket.distanceMiles.toFixed(1)} mi` },
      { label: "Elevation", value: `${Math.round(bucket.elevationFeet).toLocaleString()} ft` },
      { label: "Open", value: "View runs this week" }
    ]);
    attachChartAction(longRunPoint, `${bucket.label} runs`, runsForBucket(bucket));
    root.appendChild(longRunPoint);
    longRunPoints.push(`${pointX},${pointY}`);
  });
  root.insertBefore(svg("polyline", { class: "structure-line", points: longRunPoints.join(" ") }), root.querySelector(".structure-point"));
  root.appendChild(svg("line", { class: "axis", x1: pad.left, y1: height - pad.bottom, x2: width - pad.right, y2: height - pad.bottom }));
  root.appendChild(svg("text", { class: "label", x: pad.left, y: height - 8 }, [document.createTextNode("teal bars: runs · gold line: long-run share")]));
  root.appendChild(svg("text", { class: "label", x: width - 86, y: pad.top + 2 }, [document.createTextNode("100% share")]));
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
        { label: "Load", value: Math.round(stats.load).toLocaleString() },
        ...(stats.runs ? [{ label: "Open", value: "View runs on this day" }] : [])
      ], { keyboard: stats.runs > 0 });
      const dayRuns = state.filteredRuns.filter((run) => localDateValue(parseActivityDate(run)) === key).sort((a, b) => parseActivityDate(b) - parseActivityDate(a));
      attachChartAction(rect, new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }), dayRuns);
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
  els.heatmapSubtitle.textContent = `${state.filteredRuns.length} runs across ${weeks} weeks · click a day to drill in`;
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
  if (name.includes("tempo") || name.includes("interval") || name.includes("workout") || paceRank >= 75) return "Quality";
  if (distanceRank >= 85 || distanceMiles >= 10) return "Long";
  if (pace && pace >= 600) return "Easy";
  return "Steady";
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
  const bucket = state.buckets.find((candidate) => candidate.key === bucketKey(parseActivityDate(run), els.bucketSelect.value));
  const previousGap = daysBetween(previousRun, run);
  const nextGap = daysBetween(run, nextRun);
  const contextStart = Math.max(0, Math.min(index - 3, runs.length - 7));
  const neighboringRuns = runs.slice(contextStart, contextStart + 7);
  const runType = classifyRun(run, distance, pace, distanceRank, paceRank);
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
    runType,
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
  return numeric === null ? "—" : `${Math.round(numeric)}°`;
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
      directLoad: Boolean(Number(run.suffer_score)),
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
  const session = state.modalSession;
  const digest = buildWorkoutDigest(run);
  setRunDigestContent(runDigestLoadingMarkup());
  let weather = state.runWeatherCache.get(runWeatherKey(run)) || null;
  if (!weather && weatherRequestDetails(run)) {
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
    if (error.name === "AbortError" || session !== state.modalSession || state.activeRunId !== String(run.id)) return;
    setRunDigestContent(runDigestErrorMarkup(run.id, error.message || "Check that the Ollama endpoint is reachable and try again."));
  } finally {
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

function showWorkoutModal(runId, trigger = document.activeElement) {
  const run = state.filteredRuns.find((candidate) => String(candidate.id) === String(runId));
  if (!run) return;
  state.modalSession += 1;
  const session = state.modalSession;
  state.runDigestAbort?.abort();
  state.runDigestAbort = null;
  state.activeRunId = String(run.id);
  state.activeRunWeather = state.runWeatherCache.get(runWeatherKey(run)) || null;
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
    </header>
    <div class="workout-body">
      <section class="workout-lead" aria-label="Workout summary">
        <div class="workout-lead-metrics">
          <article class="workout-lead-metric"><span>Distance</span><strong>${digest.distance.toFixed(2)} mi</strong><small>${formatOrdinal(digest.distanceRank)} percentile</small></article>
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
              <dt>Device</dt><dd>${escapeHtml(run.device_name || "Not included in activity data")}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  `;
  state.modalTrigger = trigger instanceof HTMLElement ? trigger : null;
  els.workoutModal.hidden = false;
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
  if (state.modalTrigger?.isConnected) state.modalTrigger.focus();
  state.modalTrigger = null;
}

function renderTable() {
  const recent = [...state.filteredRuns].sort((a, b) => parseActivityDate(b) - parseActivityDate(a)).slice(0, 15);
  els.activityCount.textContent = `${state.filteredRuns.length} runs in range`;
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
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      showWorkoutModal(run.id, action);
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
    const movingTime = Math.round(distanceMiles * pace);
    activities.push({
      id: `demo-${i}`,
      name: longRun ? "Long run" : ["Easy run", "Workout", "Steady run"][Math.floor(Math.random() * 3)],
      sport_type: "Run",
      start_date_local: date.toISOString(),
      start_latlng: [40.71 + (Math.random() - 0.5) * 0.06, -74 + (Math.random() - 0.5) * 0.06],
      distance: distanceMiles * 1609.344,
      moving_time: movingTime,
      elapsed_time: movingTime + Math.round(Math.random() * 180),
      total_elevation_gain: (40 + Math.random() * 95) * distanceMiles / 3.28084,
      average_heartrate: Math.round(hr),
      max_heartrate: Math.round(hr + 18 + Math.random() * 18),
      average_cadence: Math.round(160 + Math.random() * 18),
      max_speed: 1609.344 / Math.max(300, pace - 75 - Math.random() * 30),
      suffer_score: Math.round(distanceMiles * (hr / 18)),
      kudos_count: Math.floor(Math.random() * 18),
      achievement_count: Math.random() > 0.78 ? Math.ceil(Math.random() * 4) : 0,
      pr_count: Math.random() > 0.9 ? 1 : 0
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
  state.rawActivities = makeDemoData();
  syncRangeInputs();
  setStatus("Loaded demo running history.");
  render();
}

function handleFileInput(event) {
  const [file] = event.target.files;
  if (file) importFile(file).catch((error) => setStatus(error.message, true));
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
  coachingContext.goal = { mode: els.goalMode.value, miles: els.goalMiles.value, raceName: els.goalRaceName.value.trim(), raceDistance: els.goalRaceDistance.value, raceDate: els.goalRaceDate.value, runDays: els.goalRunDays.value, longRunDay: els.goalLongRunDay.value, availability: els.goalAvailability.value.trim() };
  saveCoachingContext();
  state.renderedInsightFingerprint = "";
  render();
  setStatus("Training goal saved in this browser.");
});

els.checkinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  coachingContext.checkin = { feel: els.checkinFeel.value, limiter: els.checkinLimiter.value, intent: els.checkinIntent.value };
  saveCoachingContext();
  state.renderedInsightFingerprint = "";
  render();
  setStatus("Weekly check-in saved in this browser.");
});

els.copyPlanButton.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(els.planDraftCopy.textContent); setStatus("Next-week draft copied. Review it before using it."); } catch { setStatus("Copy is unavailable in this browser.", true); }
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
syncCoachingInputs();
bindTooltips();
render();
