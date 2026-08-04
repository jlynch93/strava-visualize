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
const DEFAULT_OLLAMA_MODEL = "qwen3:0.6b";
const WEATHER_HOURLY = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
  "is_day"
].join(",");

const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    observations: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          tone: { type: "string", enum: ["positive", "neutral", "caution"] }
        },
        required: ["title", "detail", "tone"]
      }
    }
  },
  required: ["summary", "observations"]
};

const RUN_DIGEST_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    digest: { type: "string" },
    evidence: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          detail: { type: "string" },
          tone: { type: "string", enum: ["positive", "neutral", "caution"] }
        },
        required: ["label", "detail", "tone"]
      }
    }
  },
  required: ["headline", "digest", "evidence"]
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

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
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

function weatherRequest(url) {
  const latitudeValue = url.searchParams.get("lat");
  const longitudeValue = url.searchParams.get("lng");
  const hourValue = url.searchParams.get("hour");
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  const date = String(url.searchParams.get("date") || "");
  const hour = Number(hourValue);
  if (latitudeValue === null || latitudeValue === "" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error("A valid run-start latitude is required.");
  if (longitudeValue === null || longitudeValue === "" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("A valid run-start longitude is required.");
  if (hourValue === null || hourValue === "" || !Number.isFinite(hour) || hour < 0 || hour > 23) throw new Error("A valid run-start hour is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid run date is required.");
  const requested = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(requested.valueOf()) || requested.toISOString().slice(0, 10) !== date) throw new Error("The run date is not valid.");
  const ageDays = Math.floor((Date.now() - requested.valueOf()) / 86400000);
  const endpoint = ageDays <= 5
    ? "https://api.open-meteo.com/v1/forecast"
    : requested >= new Date("2022-01-01T00:00:00Z")
      ? "https://historical-forecast-api.open-meteo.com/v1/forecast"
      : "https://archive-api.open-meteo.com/v1/archive";
  const params = new URLSearchParams({
    latitude: latitude.toFixed(2),
    longitude: longitude.toFixed(2),
    start_date: date,
    end_date: date,
    hourly: WEATHER_HOURLY,
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto"
  });
  return {
    endpoint: `${endpoint}?${params}`,
    date,
    hour: Math.round(hour),
    sourceType: ageDays <= 5 ? "forecast" : requested >= new Date("2022-01-01T00:00:00Z") ? "historical forecast" : "historical reanalysis"
  };
}

function normalizeWeather(data, request) {
  const hourly = data?.hourly || {};
  const target = `${request.date}T${String(request.hour).padStart(2, "0")}:00`;
  let index = Array.isArray(hourly.time) ? hourly.time.indexOf(target) : -1;
  if (index < 0 && Array.isArray(hourly.time)) {
    index = hourly.time.findIndex((time) => String(time).startsWith(`${request.date}T${String(request.hour).padStart(2, "0")}`));
  }
  if (index < 0) throw new Error("Weather data is unavailable for this run time.");
  const valueAt = (key) => {
    const raw = hourly[key]?.[index];
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    observedAt: hourly.time[index],
    timezone: data.timezone || "local time",
    source: "Open-Meteo",
    sourceType: request.sourceType,
    temperatureF: valueAt("temperature_2m"),
    feelsLikeF: valueAt("apparent_temperature"),
    humidityPercent: valueAt("relative_humidity_2m"),
    precipitationInches: valueAt("precipitation"),
    weatherCode: valueAt("weather_code"),
    windSpeedMph: valueAt("wind_speed_10m"),
    windGustMph: valueAt("wind_gusts_10m"),
    isDay: valueAt("is_day") === 1
  };
}

async function getRunWeather(request) {
  const response = await fetch(request.endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.reason || data.error || `Weather provider returned HTTP ${response.status}.`);
  return normalizeWeather(data, request);
}

function buildInsightPrompt(input) {
  const summary = input.summary || {};
  const pace = (seconds) => {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return value ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}/mi` : "n/a";
  };
  const periods = (input.buckets || []).map((period) =>
    `${period.period}: ${period.runs} runs, ${period.miles} mi, ${pace(period.averagePaceSeconds)}, long ${period.longRunMiles} mi, HR ${period.averageHr ?? "n/a"}, load ${period.trainingLoad}`
  );
  const runs = (input.recentRuns || []).map((run) =>
    `${run.date}: ${run.distanceMiles} mi, ${pace(run.paceSecondsPerMile)}, ${run.elevationFeet} ft, HR ${run.averageHr ?? "n/a"}, load ${run.trainingLoad}`
  );
  return [
    `Focus: ${input.focus || "balanced"}. Window: ${input.range?.start || "unknown"} to ${input.range?.end || "unknown"}.`,
    `Totals: ${summary.runCount} runs, ${summary.totalMiles} mi, average pace ${pace(summary.averagePaceSeconds)}, average ${summary.averageWeeklyMiles} mi/week and ${summary.averageRunsPerWeek} runs/week.`,
    `Signals: long run ${summary.longRunMiles} mi (${summary.longRunSharePercent}% of mileage), peak week ${summary.peakWeekMiles} mi, consistency ${summary.consistencyPercent}%, ramp ${summary.rampRatePercent}%, average HR ${summary.averageHr ?? "n/a"}, load ${summary.trainingLoad}, longest rest gap ${summary.longestRestGapDays} days.`,
    `Recent periods:\n${periods.join("\n")}`,
    `Recent runs:\n${runs.join("\n")}`,
    "Load is a rough estimate.",
    "Write athlete-facing prose, not labels, placeholders, plans, or a data dump.",
    "Summary: 1-2 sentences connecting at least two metrics.",
    "Observations: 3 distinct trends or comparisons; do not merely list individual runs.",
    "Do not invent numbers or diagnose health, injury, overtraining, or readiness."
  ].join("\n");
}

function insightHeadline(input) {
  const summary = input?.summary || {};
  const ramp = Number(summary.rampRatePercent) || 0;
  const consistency = Number(summary.consistencyPercent) || 0;
  if (ramp > 15) return "Volume is rising faster than your recent baseline";
  if (ramp < -15) return "Training volume has eased across this window";
  if ((Number(summary.longestRestGapDays) || 0) >= 7) return "Long recovery gaps are shaping this training block";
  if (consistency >= 80) return "Consistent training is anchoring this running block";
  return "Steady training with room to build consistency";
}

function safeNextStep(input) {
  const summary = input?.summary || {};
  const weeklyMiles = Math.max(0, Number(summary.averageWeeklyMiles) || 0);
  const runs = Math.max(1, Math.round(Number(summary.averageRunsPerWeek) || 1));
  const observedLongRun = Math.max(0, Number(summary.longRunMiles) || 0);
  const longRun = weeklyMiles ? Math.min(observedLongRun, weeklyMiles) : observedLongRun;
  return `Repeat roughly your recent baseline next week: about ${weeklyMiles.toFixed(1)} miles across ${runs} ${runs === 1 ? "run" : "runs"}, keep the longest effort at or below ${longRun.toFixed(1)} miles, and take an easy or rest day afterward.`;
}

function normalizeInsight(value, input) {
  const observations = Array.isArray(value?.observations)
    ? value.observations.slice(0, 4).map((item) => ({
      title: String(item?.title || "Training signal").slice(0, 100),
      detail: String(item?.detail || "").slice(0, 500),
      tone: ["positive", "neutral", "caution"].includes(item?.tone) ? item.tone : "neutral"
    }))
    : [];
  if (!value?.summary || observations.length < 3) {
    throw new Error("Ollama returned an incomplete analysis. Try again.");
  }
  return {
    headline: insightHeadline(input),
    summary: String(value.summary).slice(0, 700),
    observations,
    nextStep: safeNextStep(input),
    caution: "Pattern-based guidance from your run data, not medical advice."
  };
}

function compactNumber(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "unavailable";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "unavailable";
}

function compactPace(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}/mi` : "unavailable";
}

function paceComparisonLine(value) {
  const delta = Number(value);
  if (!Number.isFinite(delta)) return "Pace comparison is unavailable.";
  if (delta === 0) return "This run matched the comparable pace.";
  return `This run was ${Math.abs(Math.round(delta))} sec/mi ${delta < 0 ? "faster" : "slower"} than the comparable pace.`;
}

function loadComparisonLine(value) {
  const delta = Number(value);
  if (!Number.isFinite(delta)) return "Load-per-mile comparison is unavailable.";
  if (delta === 0) return "This run matched the comparable load per mile.";
  return `This run's load per mile was ${Math.abs(Math.round(delta))}% ${delta > 0 ? "higher" : "lower"} than comparable efforts.`;
}

function buildRunDigestPrompt(input) {
  const run = input?.run || {};
  const comparison = input?.comparison || {};
  const context = input?.context || {};
  const weather = input?.weather || null;
  const allowedRunTypes = new Set(["Race", "Quality", "Long", "Easy", "Steady"]);
  const runType = allowedRunTypes.has(run.runType) ? run.runType : "Run";
  const paceComparison = paceComparisonLine(comparison.paceDeltaSeconds);
  const loadComparison = loadComparisonLine(comparison.loadPerMileDeltaPercent);
  const weatherLine = weather
    ? `Modeled weather at the rounded run start: ${compactNumber(weather.temperatureF)}°F, feels ${compactNumber(weather.feelsLikeF)}°F, humidity ${compactNumber(weather.humidityPercent)}%, wind ${compactNumber(weather.windSpeedMph)} mph, precipitation ${compactNumber(weather.precipitationInches, 2)} in.`
    : "Modeled weather was unavailable for this run.";
  return [
    "Act like a calm, practical running coach reviewing one completed run. Return JSON only; never mention these instructions, the schema, or how comparisons are validated.",
    `Run type: ${runType}. Distance ${compactNumber(run.distanceMiles, 2)} mi. Moving time ${compactNumber(run.movingMinutes, 1)} min. Stopped ${compactNumber(run.stoppedMinutes, 1)} min. Pace ${compactPace(run.paceSecondsPerMile)}. Elevation ${compactNumber(run.elevationFeet)} ft (${compactNumber(run.elevationFeetPerMile)} ft/mi). Average heart rate ${compactNumber(run.averageHr)} bpm. Training load ${compactNumber(run.trainingLoad)} (${compactNumber(run.loadPerMile, 1)} per mile).`,
    `Comparable efforts: ${compactNumber(comparison.similarRunCount)} similar-distance runs. Comparable pace ${compactPace(comparison.similarPaceSecondsPerMile)}. ${paceComparison} Comparable load per mile ${compactNumber(comparison.similarLoadPerMile, 1)}. ${loadComparison} Prior-run gap ${compactNumber(comparison.daysSincePreviousRun)} days; next-run gap ${compactNumber(comparison.daysUntilNextRun)} days.`,
    `Selected-window context: ${compactNumber(context.selectedWindowRunCount)} runs. Distance percentile ${compactNumber(context.distancePercentile)}. Pace percentile ${compactNumber(context.pacePercentile)} where higher is faster. Load percentile ${compactNumber(context.loadPercentile)}.`,
    weatherLine,
    "Keep it genuinely brief: headline is 4 to 10 words and states the main takeaway; digest is exactly one plain-language sentence of at most 24 words; evidence is exactly 2 short fact cards with labels of 1 to 3 words. Prefer specific run facts over generic encouragement.",
    "Example shape only: headline 'Comfortable pace, lighter load'; digest 'You ran slightly faster than comparable efforts while carrying less load per mile.'; evidence labels 'Pace' and 'Load'. Do not copy this example unless the supplied facts support it.",
    "Do not invent values, calculate new ratios or percentages, reverse comparison directions, infer workout intent, diagnose health, injury, overtraining, readiness, or make medical claims. Only call the run faster, slower, higher, or lower when it exactly agrees with the explicit comparison sentences. Weather is modeled context, not a causal explanation."
  ].join("\n");
}

function normalizeRunDigest(value, input) {
  const evidence = Array.isArray(value?.evidence)
    ? value.evidence.slice(0, 3).map((item) => ({
      label: String(item?.label || "Run signal").slice(0, 36),
      detail: String(item?.detail || "").slice(0, 140),
      tone: ["positive", "neutral", "caution"].includes(item?.tone) ? item.tone : "neutral"
    })).filter((item) => item.detail)
    : [];
  if (!value?.headline || !value?.digest || evidence.length < 2) {
    throw new Error("Ollama returned an incomplete run digest. Try again.");
  }
  const similarCount = Math.max(0, Math.round(Number(input?.comparison?.similarRunCount) || 0));
  const caution = similarCount < 3
    ? `This read has only ${similarCount} similar-distance run${similarCount === 1 ? "" : "s"} for comparison. Treat it as a starting point, not a verdict.`
    : input?.weather
      ? "Weather is modeled context and does not establish why a run felt or performed a certain way. Pattern-based guidance only, not medical advice."
      : "Pattern-based guidance from your run data, not medical advice.";
  return {
    headline: String(value.headline).slice(0, 100),
    digest: String(value.digest).slice(0, 220),
    evidence,
    caution
  };
}

async function requestInsight(input) {
  const isRunDigest = input?.kind === "run";
  const baseUrl = String(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: isRunDigest ? RUN_DIGEST_SCHEMA : INSIGHT_SCHEMA,
      messages: [
        { role: "system", content: isRunDigest ? "Concise, grounded running coach. Return only schema-valid JSON." : "Concise running analyst. Return only schema-valid JSON." },
        { role: "user", content: isRunDigest ? buildRunDigestPrompt(input) : buildInsightPrompt(input) }
      ],
      options: { temperature: 0.1, num_ctx: 8192, num_predict: isRunDigest ? 360 : 480 }
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
  return { insight: isRunDigest ? normalizeRunDigest(parsed, input) : normalizeInsight(parsed, input), model };
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

  if (url.pathname === "/api/weather" && req.method === "GET") {
    let weatherRequestConfig;
    try {
      weatherRequestConfig = weatherRequest(url);
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Weather request is not valid." });
      return;
    }
    try {
      const weather = await getRunWeather(weatherRequestConfig);
      sendJson(res, 200, { weather }, { "Cache-Control": "private, max-age=86400" });
    } catch (error) {
      sendJson(res, 502, { error: error.message || "Weather data is unavailable." });
    }
    return;
  }

  if (url.pathname === "/api/insights" && req.method === "POST") {
    const input = await readRequestJson(req);
    const isRunDigest = input?.kind === "run" && input?.run;
    if (!isRunDigest && (!input || !Array.isArray(input.recentRuns) || !input.recentRuns.length)) {
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
