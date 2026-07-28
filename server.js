const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL, URLSearchParams } = require("url");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const TOKEN_FILE = path.join(__dirname, ".strava-token.json");
const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_OAUTH_TOKEN = "https://www.strava.com/oauth/token";
const DEFAULT_OLLAMA_URL = "https://ollama.jeer.rest";
const DEFAULT_OLLAMA_MODEL = "qwen3.5:0.8b";
const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    headlineFocus: { type: "string", enum: ["volume", "pace", "consistency", "load", "long_run", "spacing"] },
    summaryAngle: { type: "string", enum: ["trend", "baseline", "structure", "efficiency", "limits"] },
    observations: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      uniqueItems: true,
      items: { type: "string", enum: ["volume", "pace", "consistency", "load", "long_run", "heart_rate", "spacing", "terrain"] }
    },
    nextFocus: { type: "string", enum: ["hold_baseline", "watch_load", "compare_pace", "protect_spacing", "long_run_balance"] }
  },
  required: ["headlineFocus", "summaryAngle", "observations", "nextFocus"]
};

const RUN_INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    headlineFocus: { type: "string", enum: ["distance", "pace", "load", "effort", "context"] },
    summaryAngle: { type: "string", enum: ["comparison", "baseline", "terrain", "spacing", "limited"] },
    signals: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      uniqueItems: true,
      items: { type: "string", enum: ["distance", "pace", "load", "heart_rate", "terrain", "spacing"] }
    },
    watchFocus: { type: "string", enum: ["pace_effort", "terrain", "spacing", "heart_rate", "load_per_mile"] }
  },
  required: ["headlineFocus", "summaryAngle", "signals", "watchFocus"]
};

loadLocalEnv();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  } catch {
    // A .env file is optional; environment variables work too.
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function readToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeToken(token) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
}

function requireConfig() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const redirectUri = process.env.STRAVA_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
  if (!clientId || !clientSecret) {
    const error = "Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to .env, then restart the server.";
    return { error };
  }
  return { clientId, clientSecret, redirectUri };
}

function requestJson(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, options, (response) => {
      let raw = "";
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        const contentType = response.headers["content-type"] || "";
        const parsed = contentType.includes("application/json") && raw ? JSON.parse(raw) : raw;
        if (response.statusCode >= 400) {
          reject(new Error(typeof parsed === "string" ? parsed : JSON.stringify(parsed)));
          return;
        }
        resolve(parsed);
      });
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function readRequestJson(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limit) reject(new Error("The training summary is too large."));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("The training summary is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function buildInsightPrompt(input) {
  const summary = input.summary || {};
  const question = String(input.question || "").trim().slice(0, 280);
  const pace = (seconds) => {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return value ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}/mi` : "n/a";
  };
  const trend = input.trend || null;
  const trendComparison = trend
    ? `App-calculated comparison (${trend.earlierPeriodCount} earlier periods vs ${trend.recentPeriodCount} recent periods): volume ${trend.earlierAverageMiles} to ${trend.recentAverageMiles} mi/period (${trend.volumeChangePercent >= 0 ? "+" : ""}${trend.volumeChangePercent}%); pace ${pace(trend.earlierAveragePaceSeconds)} to ${pace(trend.recentAveragePaceSeconds)} (${trend.paceChangeSeconds < 0 ? `${Math.abs(trend.paceChangeSeconds)} sec/mi faster` : trend.paceChangeSeconds > 0 ? `${trend.paceChangeSeconds} sec/mi slower` : "unchanged"}); HR ${trend.earlierAverageHr ?? "n/a"} to ${trend.recentAverageHr ?? "n/a"} bpm; load ${trend.earlierAverageLoad ?? "n/a"} to ${trend.recentAverageLoad ?? "n/a"}.`
    : "App-calculated earlier-vs-recent comparison is unavailable for this window.";
  return [
    `Focus: ${input.focus || "balanced"}. Window: ${input.range?.start || "unknown"} to ${input.range?.end || "unknown"}.`,
    `Athlete question: ${question || "No custom question; provide a focused review of the selected window."}`,
    `Totals: ${summary.runCount} runs, ${summary.totalMiles} mi, average pace ${pace(summary.averagePaceSeconds)}, average ${summary.averageWeeklyMiles} mi/week and ${summary.averageRunsPerWeek} runs/week.`,
    `Signals: long run ${summary.longRunMiles} mi (${summary.longRunSharePercent}% of mileage), peak week ${summary.peakWeekMiles} mi, consistency ${summary.consistencyPercent}%, ramp ${summary.rampRatePercent}%, average HR ${summary.averageHr ?? "n/a"}, load ${summary.trainingLoad}, longest rest gap ${summary.longestRestGapDays} days.`,
    trendComparison,
    "Load is a rough estimate.",
    "Consistency is the percentage of grouped periods containing at least one run; it does not measure discipline, plan adherence, recovery quality, or effort.",
    "Pace values are minutes per mile. Heart rate values are bpm. Never combine or relabel those units.",
    "The app calculated every value above. Select only the most relevant analysis angles for this training window.",
    "Use the athlete question to prioritize categories, not to make unsupported claims. Choose the limits angle when the snapshot cannot answer it.",
    "Return only allowed enum keys from the schema. Do not write prose, numbers, dates, or units.",
    "Do not infer motivation, training phase, recovery, readiness, injury, causation, discipline, or plan adherence."
  ].join("\n");
}

function buildRunInsightPrompt(input) {
  const run = input.run || {};
  const comparison = input.comparison || {};
  const baseline = input.baseline || {};
  const pace = (seconds) => {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return value ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}/mi` : "n/a";
  };
  const paceDirection = comparison.paceDifferenceSeconds < 0
    ? `${Math.abs(comparison.paceDifferenceSeconds)} sec/mi faster`
    : comparison.paceDifferenceSeconds > 0
      ? `${comparison.paceDifferenceSeconds} sec/mi slower`
      : "about the same";
  const loadDirection = comparison.loadPerMileDifferencePercent > 0
    ? `${comparison.loadPerMileDifferencePercent}% higher`
    : comparison.loadPerMileDifferencePercent < 0
      ? `${Math.abs(comparison.loadPerMileDifferencePercent)}% lower`
      : "about the same";
  return [
    `Selected run: ${run.name || "Run"} on ${run.date || "unknown date"}; app classification ${run.runType || "run"}.`,
    `Run facts: ${run.distanceMiles} mi at ${pace(run.paceSecondsPerMile)}, moving ${run.movingMinutes} min, stopped ${run.stoppedMinutes} min, elevation ${run.elevationFeet} ft (${run.elevationFeetPerMile} ft/mi), average HR ${run.averageHr ?? "n/a"} bpm, max HR ${run.maxHr ?? "n/a"} bpm, load ${run.trainingLoad} (${run.loadPerMile} per mile), cadence ${run.cadenceSpm ?? "n/a"} spm.`,
    `Selected-window ranks: distance ${comparison.distancePercentile} percentile, pace ${comparison.pacePercentile} percentile, load ${comparison.loadPercentile} percentile.`,
    comparison.similarRunCount
      ? `Similar-distance comparison (${comparison.similarRunCount} other runs): average pace ${pace(comparison.similarPaceSecondsPerMile)}, selected run was ${paceDirection}; average HR ${comparison.similarAverageHr ?? "n/a"} bpm; average load per mile ${comparison.similarLoadPerMile}, selected run was ${loadDirection}.`
      : "There are not enough similar-distance runs for a direct benchmark.",
    `Spacing: ${comparison.daysSincePreviousRun ?? "n/a"} days since the prior run and ${comparison.daysUntilNextRun ?? "n/a"} days until the next run in this selected window.`,
    `Window baseline: ${baseline.runCount} runs, ${baseline.averageRunMiles} mi per run, average pace ${pace(baseline.averagePaceSecondsPerMile)}, average HR ${baseline.averageHr ?? "n/a"} bpm, and average load per mile ${baseline.averageLoadPerMile}.`,
    "The app calculated every value above. Select the most relevant analysis angles for this run.",
    "Do not claim that Ollama generated, measured, verified, or detected any metric. Do not infer workout intent, fitness, recovery, readiness, injury, or causation.",
    "Return only the allowed enum keys in the schema. Do not write prose, numbers, dates, or units.",
    "Choose two or three distinct signals and one conservative comparison focus for a future similar run."
  ].join("\n");
}

function normalizeInsight(value, input) {
  const summary = input.summary || {};
  const trend = input.trend || null;
  const pace = (seconds) => {
    const rounded = Math.max(0, Math.round(Number(seconds) || 0));
    return rounded ? `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}/mi` : "n/a";
  };
  const volumeChange = trend ? Number(trend.volumeChangePercent) : null;
  const paceChange = trend?.paceChangeSeconds !== null && trend?.paceChangeSeconds !== undefined ? Number(trend.paceChangeSeconds) : null;
  const loadChange = trend && Number(trend.earlierAverageLoad) > 0
    ? ((Number(trend.recentAverageLoad) - Number(trend.earlierAverageLoad)) / Number(trend.earlierAverageLoad)) * 100
    : null;
  const volumePhrase = volumeChange === null
    ? "The selected window does not contain enough grouped periods for a recent trend comparison."
    : Math.abs(volumeChange) <= 5 ? "Recent volume stayed close to the earlier-period baseline." : volumeChange > 0 ? "Recent volume was higher than the earlier-period baseline." : "Recent volume was lower than the earlier-period baseline.";
  const pacePhrase = paceChange === null
    ? "Pace does not have enough comparable grouped data for a recent trend."
    : Math.abs(paceChange) <= 3 ? "Average pace stayed close to the earlier-period baseline." : paceChange < 0 ? "Average pace was faster in the recent comparison." : "Average pace was slower in the recent comparison.";
  const loadPhrase = loadChange === null
    ? "Training load can be read against the full-window baseline, but not a recent comparison."
    : Math.abs(loadChange) <= 8 ? "Recent training load stayed close to the earlier-period baseline." : loadChange > 0 ? "Recent training load was higher than the earlier-period baseline." : "Recent training load was lower than the earlier-period baseline.";
  const consistency = Number(summary.consistencyPercent) || 0;
  const consistencyPhrase = consistency >= 80 ? "Running appeared in most grouped periods across the selected window." : consistency >= 55 ? "Running was present in more than half of the grouped periods." : "The selected window contains wider gaps between active grouped periods.";
  const longShare = Number(summary.longRunSharePercent) || 0;
  const longRunPhrase = longShare > 50 ? "Long efforts account for a large share of the selected mileage." : longShare >= 25 ? "Long efforts contribute a balanced share of the selected mileage." : "Long efforts contribute a smaller share of the selected mileage.";
  const longestGap = Number(summary.longestRestGapDays) || 0;
  const spacingPhrase = longestGap >= 7 ? "The selected window includes at least one wider gap between runs." : longestGap <= 3 ? "The longest gap between runs stayed relatively compact in this window." : "Run spacing varied across the selected window.";
  const earlierHr = Number(trend?.earlierAverageHr) || 0;
  const recentHr = Number(trend?.recentAverageHr) || 0;
  const hrPhrase = earlierHr && recentHr
    ? Math.abs(recentHr - earlierHr) <= 3 ? "Average heart rate stayed close across the recent comparison." : recentHr > earlierHr ? "Average heart rate was higher in the recent comparison." : "Average heart rate was lower in the recent comparison."
    : "Heart-rate comparison is limited by the available activity data.";
  const terrainPhrase = Number(summary.elevationFeetPerMile) >= 100 ? "The selected mileage has a notably hilly profile." : Number(summary.elevationFeetPerMile) >= 55 ? "Rolling terrain is part of the selected-window context." : "The selected mileage has a relatively flatter profile.";
  const signalCopy = {
    volume: { title: "Volume direction", detail: volumePhrase, tone: volumeChange !== null && Math.abs(volumeChange) > 25 ? "caution" : "neutral" },
    pace: { title: "Pace direction", detail: pacePhrase, tone: paceChange !== null && paceChange < -3 ? "positive" : "neutral" },
    consistency: { title: "Training consistency", detail: consistencyPhrase, tone: consistency >= 80 ? "positive" : "neutral" },
    load: { title: "Load direction", detail: loadPhrase, tone: loadChange !== null && loadChange > 25 ? "caution" : "neutral" },
    long_run: { title: "Long-run balance", detail: longRunPhrase, tone: longShare > 50 ? "caution" : "neutral" },
    heart_rate: { title: "Heart-rate context", detail: hrPhrase, tone: "neutral" },
    spacing: { title: "Run spacing", detail: spacingPhrase, tone: longestGap >= 7 ? "caution" : "neutral" },
    terrain: { title: "Terrain context", detail: terrainPhrase, tone: Number(summary.elevationFeetPerMile) >= 100 ? "caution" : "neutral" }
  };
  const requested = Array.isArray(value?.observations) ? value.observations : [];
  const signalKeys = [...new Set(requested.filter((key) => signalCopy[key]))].slice(0, 4);
  ["volume", "pace", "consistency"].forEach((key) => {
    if (signalKeys.length < 3 && !signalKeys.includes(key)) signalKeys.push(key);
  });
  const prioritizedSignal = { progression: "volume", recovery: "load", consistency: "consistency", durability: "long_run", efficiency: "pace" }[input.focus];
  if (prioritizedSignal && !signalKeys.includes(prioritizedSignal)) {
    if (signalKeys.length >= 4) signalKeys.pop();
    signalKeys.unshift(prioritizedSignal);
  }
  const observations = signalKeys.map((key) => signalCopy[key]);
  const focusFallback = { progression: "volume", recovery: "load", consistency: "consistency", durability: "long_run", efficiency: "pace", balanced: "volume" };
  const headlineCopy = { volume: volumePhrase, pace: pacePhrase, consistency: consistencyPhrase, load: loadPhrase, long_run: longRunPhrase, spacing: spacingPhrase };
  const summaryCopy = {
    trend: `${volumePhrase} ${pacePhrase}`,
    baseline: `The full-window baseline is ${Number(summary.averageWeeklyMiles || 0).toFixed(1)} miles and ${Number(summary.averageRunsPerWeek || 0).toFixed(1)} runs per week at ${pace(summary.averagePaceSeconds)}.`,
    structure: `${consistencyPhrase} ${longRunPhrase}`,
    efficiency: `${pacePhrase} ${hrPhrase}`,
    limits: "This snapshot can describe running patterns, but it cannot establish intent, readiness, recovery quality, or causation."
  };
  const nextCopy = {
    hold_baseline: `Use the current baseline of ${Number(summary.averageWeeklyMiles || 0).toFixed(1)} miles across ${Number(summary.averageRunsPerWeek || 0).toFixed(1)} runs per week as the next comparison point.`,
    watch_load: `Compare the next grouped period with the current ${Number(summary.loadPerMile || 0).toFixed(1)} load-per-mile baseline before drawing a trend conclusion.`,
    compare_pace: `Compare another similar window with the current ${pace(summary.averagePaceSeconds)} average rather than judging a single run.`,
    protect_spacing: `Keep the current ${longestGap}-day longest gap visible when comparing run frequency in the next window.`,
    long_run_balance: `Compare the next window with the current ${longShare}% share of mileage from long efforts.`
  };
  const preferredSummary = { progression: "trend", recovery: "trend", consistency: "structure", durability: "structure", efficiency: "efficiency" };
  const preferredNext = { progression: "hold_baseline", recovery: "watch_load", consistency: "protect_spacing", durability: "long_run_balance", efficiency: "compare_pace" };
  const headlineFocus = input.focus !== "balanced"
    ? focusFallback[input.focus] || "volume"
    : headlineCopy[value?.headlineFocus] ? value.headlineFocus : "volume";
  const summaryAngle = preferredSummary[input.focus] || value?.summaryAngle;
  const nextFocus = preferredNext[input.focus] || value?.nextFocus;
  return {
    headline: headlineCopy[headlineFocus],
    summary: summaryCopy[summaryAngle] || summaryCopy.trend,
    observations,
    nextStep: nextCopy[nextFocus] || nextCopy.hold_baseline,
    caution: "Ollama-guided read from app-calculated training metrics. Pattern guidance only—not medical advice."
  };
}

function normalizeRunInsight(value, input) {
  const run = input.run || {};
  const comparison = input.comparison || {};
  const rankPhrase = (rank, high, middle, low) => rank >= 75 ? high : rank <= 25 ? low : middle;
  const paceVsSimilar = comparison.similarRunCount
    ? Math.abs(comparison.paceDifferenceSeconds || 0) <= 5
      ? "Pace closely matched your similar-distance benchmark."
      : comparison.paceDifferenceSeconds < 0
        ? "Pace was faster than your similar-distance benchmark."
        : "Pace was slower than your similar-distance benchmark."
    : "Pace needs more similar-distance runs before it has a useful benchmark.";
  const loadVsSimilar = comparison.similarRunCount && comparison.similarLoadPerMile
    ? Math.abs(comparison.loadPerMileDifferencePercent || 0) <= 8
      ? "Load per mile was close to your comparable-run pattern."
      : comparison.loadPerMileDifferencePercent < 0
        ? "Load per mile was lower than on comparable runs."
        : "Load per mile was higher than on comparable runs."
    : "Load is shown against the selected window because a direct benchmark is limited.";
  const distancePhrase = rankPhrase(comparison.distancePercentile, "This was one of the longer efforts in the selected window.", "Distance sat near your usual range.", "This was one of the shorter efforts in the selected window.");
  const pacePhrase = rankPhrase(comparison.pacePercentile, "Its pace also sat toward the faster end of the window.", "Its pace sat near the middle of the window.", "Its pace sat toward the slower end of the window.");
  const terrainPhrase = run.elevationFeetPerMile >= 100 ? "The route was hillier than a flat-effort comparison would assume." : run.elevationFeetPerMile >= 60 ? "Rolling terrain adds useful context to the pace comparison." : "The flatter terrain makes pace easier to compare with similar efforts.";
  const spacingPhrase = comparison.daysSincePreviousRun === null
    ? "There is no earlier run inside this window for spacing context."
    : comparison.daysSincePreviousRun <= 1
      ? "This effort followed closely after the previous run in the window."
      : comparison.daysSincePreviousRun >= 5
        ? "This effort had a wider gap after the previous run in the window."
        : "This effort had moderate spacing after the previous run in the window.";
  const hrDifference = comparison.heartRateDifference;
  const heartRatePhrase = hrDifference === null || !comparison.similarAverageHr
    ? "Heart-rate comparison is limited by the available activity data."
    : Math.abs(hrDifference) <= 3
      ? "Average heart rate closely matched similar-distance efforts."
      : hrDifference < 0
        ? "Average heart rate was lower than on similar-distance efforts."
        : "Average heart rate was higher than on similar-distance efforts.";
  const signalCopy = {
    distance: { title: "Distance profile", detail: distancePhrase, tone: comparison.distancePercentile >= 75 ? "positive" : "neutral" },
    pace: { title: "Pace comparison", detail: paceVsSimilar, tone: comparison.paceDifferenceSeconds < -5 ? "positive" : "neutral" },
    load: { title: "Relative load", detail: loadVsSimilar, tone: comparison.loadPerMileDifferencePercent > 15 ? "caution" : "neutral" },
    heart_rate: { title: "Heart-rate context", detail: heartRatePhrase, tone: "neutral" },
    terrain: { title: "Terrain context", detail: terrainPhrase, tone: run.elevationFeetPerMile >= 100 ? "caution" : "neutral" },
    spacing: { title: "Run spacing", detail: spacingPhrase, tone: comparison.daysSincePreviousRun !== null && comparison.daysSincePreviousRun <= 1 ? "caution" : "neutral" }
  };
  const requestedSignals = Array.isArray(value?.signals) ? value.signals : [];
  const signalKeys = [...new Set(requestedSignals.filter((key) => signalCopy[key]))].slice(0, 3);
  ["pace", "load", "distance"].forEach((key) => {
    if (signalKeys.length < 2 && !signalKeys.includes(key)) signalKeys.push(key);
  });
  const signals = signalKeys.map((key) => signalCopy[key]);
  if (signals.length < 2) {
    throw new Error("Ollama returned an incomplete run analysis. Try again.");
  }
  const headlineCopy = {
    distance: distancePhrase,
    pace: paceVsSimilar,
    load: loadVsSimilar,
    effort: `${distancePhrase} ${pacePhrase}`,
    context: comparison.similarRunCount ? "This run has a useful like-for-like benchmark." : "This run is best read against the broader selected window."
  };
  const comparisonSummary = value?.headlineFocus === "pace"
    ? `${loadVsSimilar} Together with the pace comparison, that makes this a clean reference point for another similar effort.`
    : value?.headlineFocus === "load"
      ? `${paceVsSimilar} Together with the load comparison, that makes this a clean reference point for another similar effort.`
      : `${paceVsSimilar} ${loadVsSimilar}`;
  const summaryCopy = {
    comparison: comparisonSummary,
    baseline: `${distancePhrase} ${pacePhrase}`,
    terrain: `${terrainPhrase} ${paceVsSimilar}`,
    spacing: `${spacingPhrase} ${loadVsSimilar}`,
    limited: `${distancePhrase} More similar-distance efforts would make the comparison stronger.`
  };
  const watchCopy = {
    pace_effort: "Compare pace and load per mile on another run of similar distance.",
    terrain: "Compare this with another run over similarly rolling terrain.",
    spacing: "Compare a similar effort after a different gap between runs.",
    heart_rate: "Compare average heart rate on another similar-distance effort.",
    load_per_mile: "Watch whether load per mile stays near this pattern on a comparable run."
  };
  return {
    headline: headlineCopy[value?.headlineFocus] || headlineCopy.effort,
    read: summaryCopy[value?.summaryAngle] || summaryCopy.comparison,
    signals,
    watchNext: watchCopy[value?.watchFocus] || watchCopy.pace_effort,
    caution: "Ollama-guided read from app-calculated workout context. Pattern guidance only—not medical advice."
  };
}

async function requestInsight(input) {
  const baseUrl = String(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const isRunInsight = input.kind === "run";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: isRunInsight ? RUN_INSIGHT_SCHEMA : INSIGHT_SCHEMA,
      messages: [
        { role: "system", content: "Interpret only the supplied app-calculated running data. Preserve units, avoid causal or intent claims, and return only schema-valid JSON." },
        { role: "user", content: isRunInsight ? buildRunInsightPrompt(input) : buildInsightPrompt(input) }
      ],
      options: { temperature: 0, num_ctx: 4096, num_predict: isRunInsight ? 120 : 160 }
    }),
    signal: AbortSignal.timeout(120_000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Ollama returned HTTP ${response.status}.`);
  let parsed;
  try {
    parsed = JSON.parse(data.message?.content || "");
  } catch {
    throw new Error("Ollama returned an unreadable analysis. Try again.");
  }
  return { insight: isRunInsight ? normalizeRunInsight(parsed, input) : normalizeInsight(parsed, input), model };
}

async function exchangeToken(params) {
  const body = new URLSearchParams(params).toString();
  return requestJson(
    STRAVA_OAUTH_TOKEN,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    },
    body
  );
}

async function getAccessToken() {
  const config = requireConfig();
  if (config.error) throw new Error(config.error);
  const token = readToken();
  if (!token) throw new Error("Connect Strava first.");
  const now = Math.floor(Date.now() / 1000);
  if (token.access_token && token.expires_at && token.expires_at - 60 > now) {
    return token.access_token;
  }
  const refreshed = await exchangeToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token
  });
  writeToken(refreshed);
  return refreshed.access_token;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/status") {
    const config = requireConfig();
    sendJson(res, 200, {
      configured: !config.error,
      connected: Boolean(readToken()),
      redirectUri: config.redirectUri || null,
      error: config.error || null
    });
    return;
  }

  if (url.pathname === "/auth/login") {
    const config = requireConfig();
    if (config.error) {
      sendJson(res, 400, { error: config.error });
      return;
    }
    const authUrl = new URL("https://www.strava.com/oauth/authorize");
    authUrl.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: "read,activity:read_all"
    }).toString();
    sendRedirect(res, authUrl.toString());
    return;
  }

  if (url.pathname === "/auth/callback") {
    const config = requireConfig();
    if (config.error) {
      sendJson(res, 400, { error: config.error });
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      sendJson(res, 400, { error: "Missing Strava authorization code." });
      return;
    }
    const token = await exchangeToken({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code"
    });
    writeToken(token);
    sendRedirect(res, "/?connected=1");
    return;
  }

  if (url.pathname === "/api/activities") {
    const accessToken = await getAccessToken();
    const after = url.searchParams.get("after");
    const before = url.searchParams.get("before");
    const perPage = Math.min(Number(url.searchParams.get("per_page") || 100), 200);
    const maxPages = Math.min(Number(url.searchParams.get("pages") || 6), 12);
    const activities = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (after) params.set("after", after);
      if (before) params.set("before", before);
      const batch = await requestJson(`${STRAVA_API}/athlete/activities?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      activities.push(...batch);
      if (!Array.isArray(batch) || batch.length < perPage) break;
    }
    sendJson(res, 200, { activities });
    return;
  }

  if (url.pathname === "/api/insights" && req.method === "POST") {
    const input = await readRequestJson(req);
    const hasRunInput = input?.kind === "run" && input.run;
    const hasWindowInput = input?.kind !== "run" && Array.isArray(input?.recentRuns) && input.recentRuns.length;
    if (!hasRunInput && !hasWindowInput) {
      sendJson(res, 400, { error: "No running data was supplied." });
      return;
    }
    const result = await requestInsight(input);
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/auth/")) {
    handleApi(req, res).catch((error) => {
      sendJson(res, 500, { error: error.message });
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Strava Visualize is running at http://localhost:${PORT}`);
});
