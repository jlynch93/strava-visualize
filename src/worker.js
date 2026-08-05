const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_AUTHORIZE = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN = "https://www.strava.com/oauth/token";
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

function json(payload, status = 200, headers = {}) {
  const responseHeaders = headers instanceof Headers ? headers : new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

function getConfig(env, request) {
  const url = new URL(request.url);
  const redirectUri = env.STRAVA_REDIRECT_URI || `${url.origin}/auth/callback`;
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    return {
      error: "Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to this Cloudflare Worker.",
      redirectUri
    };
  }
  return {
    clientId: env.STRAVA_CLIENT_ID,
    clientSecret: env.STRAVA_CLIENT_SECRET,
    redirectUri
  };
}

function parseCookies(request) {
  const raw = request.headers.get("cookie") || "";
  return raw.split(";").reduce((cookies, part) => {
    const [key, ...value] = part.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(value.join("="));
    return cookies;
  }, {});
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function tokenCookies(token) {
  const accessTtl = Math.max(60, Number(token.expires_at || 0) - Math.floor(Date.now() / 1000));
  return [
    cookie("sv_access", token.access_token, accessTtl),
    cookie("sv_refresh", token.refresh_token, 60 * 60 * 24 * 365),
    cookie("sv_expires", String(token.expires_at || 0), accessTtl)
  ];
}

async function exchangeToken(params) {
  const response = await fetch(STRAVA_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || JSON.stringify(data));
  return data;
}

async function getAccessToken(env, request) {
  const config = getConfig(env, request);
  if (config.error) throw new Error(config.error);
  const cookies = parseCookies(request);
  const now = Math.floor(Date.now() / 1000);
  if (cookies.sv_access && Number(cookies.sv_expires || 0) - 60 > now) {
    return { accessToken: cookies.sv_access, setCookies: [] };
  }
  if (!cookies.sv_refresh) throw new Error("Connect Strava first.");
  const refreshed = await exchangeToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: cookies.sv_refresh
  });
  return { accessToken: refreshed.access_token, setCookies: tokenCookies(refreshed) };
}

async function handleStatus(env, request) {
  const config = getConfig(env, request);
  const cookies = parseCookies(request);
  return json({
    configured: !config.error,
    connected: Boolean(cookies.sv_refresh),
    redirectUri: config.redirectUri,
    error: config.error || null
  });
}

function handleLogin(env, request) {
  const config = getConfig(env, request);
  if (config.error) return json({ error: config.error }, 400);
  const authUrl = new URL(STRAVA_AUTHORIZE);
  authUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all"
  }).toString();
  return Response.redirect(authUrl.toString(), 302);
}

async function handleCallback(env, request) {
  const config = getConfig(env, request);
  if (config.error) return json({ error: config.error }, 400);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return json({ error: "Missing Strava authorization code." }, 400);
  const token = await exchangeToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code"
  });
  const headers = new Headers({ location: "/?connected=1" });
  tokenCookies(token).forEach((value) => headers.append("set-cookie", value));
  return new Response(null, { status: 302, headers });
}

async function handleActivities(env, request) {
  const url = new URL(request.url);
  const { accessToken, setCookies } = await getAccessToken(env, request);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const perPage = Math.min(Number(url.searchParams.get("per_page") || 100), 200);
  const maxPages = Math.min(Number(url.searchParams.get("pages") || 6), 12);
  const activities = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (after) params.set("after", after);
    if (before) params.set("before", before);
    const response = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const batch = await response.json();
    if (!response.ok) return json(batch, response.status);
    activities.push(...batch);
    if (!Array.isArray(batch) || batch.length < perPage) break;
  }
  const headers = new Headers();
  setCookies.forEach((value) => headers.append("set-cookie", value));
  return json({ activities }, 200, headers);
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
    const value = Number(hourly[key]?.[index]);
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

async function handleWeather(request) {
  let config;
  try {
    config = weatherRequest(new URL(request.url));
  } catch (error) {
    return json({ error: error.message || "Weather request is not valid." }, 400);
  }
  try {
    const response = await fetch(config.endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000)
    });
    const data = await response.json();
    if (!response.ok) return json({ error: data.reason || data.error || `Weather provider returned HTTP ${response.status}.` }, 502);
    return json({ weather: normalizeWeather(data, config) }, 200, { "cache-control": "private, max-age=86400" });
  } catch (error) {
    return json({ error: error.message || "Weather data is unavailable." }, 502);
  }
}

function buildInsightPrompt(input) {
  const summary = input.summary || {};
  const context = input.coachingContext || {};
  const pace = (seconds) => {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return value ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}/mi` : "n/a";
  };
  const periods = (input.buckets || []).map((period) =>
    `${period.period}: ${period.runs} runs, ${period.miles} mi, ${pace(period.averagePaceSeconds)}, long ${period.longRunMiles} mi, HR ${period.averageHr ?? "n/a"}, load ${period.trainingLoad}`
  );
  const runs = (input.recentRuns || []).map((run) =>
    `${run.date} ${run.name || "Run"}: ${run.distanceMiles} mi, ${pace(run.paceSecondsPerMile)}, ${run.elevationFeet} ft, HR ${run.averageHr ?? "n/a"}, load ${run.trainingLoad}`
  );
  return [
    `Focus: ${input.focus || "balanced"}. Window: ${input.range?.start || "unknown"} to ${input.range?.end || "unknown"}.`,
    `Runner context (self-reported, optional): goal ${context.goal?.mode || "not set"}, weekly target ${context.goal?.miles || "not set"}, race ${context.goal?.raceName || "not set"} ${context.goal?.raceDistance || ""} on ${context.goal?.raceDate || "not set"}; feel ${context.checkin?.feel || "not logged"}/5, limiter ${context.checkin?.limiter || "not logged"}, run intent ${context.checkin?.intent || "not logged"}.`,
    input.focus === "race-plan" ? "For this focus, make the observations a reviewable next-week outline: frequency, a long-run boundary, and easy/rest space. Do not prescribe paces or claim medical safety." : "",
    `Totals: ${summary.runCount} runs, ${summary.totalMiles} mi, average pace ${pace(summary.averagePaceSeconds)}, average ${summary.averageWeeklyMiles} mi/week and ${summary.averageRunsPerWeek} runs/week.`,
    `Signals: long run ${summary.longRunMiles} mi (${summary.longRunSharePercent}% of mileage), peak week ${summary.peakWeekMiles} mi, consistency ${summary.consistencyPercent}%, ramp ${summary.rampRatePercent}%, average HR ${summary.averageHr ?? "n/a"}, load ${summary.trainingLoad}, longest rest gap ${summary.longestRestGapDays} days.`,
    `Recent periods:\n${periods.join("\n")}`,
    `Recent runs:\n${runs.join("\n")}`,
    "Load is a rough estimate.",
    "Write athlete-facing prose, not labels, placeholders, plans, or a data dump.",
    "Summary: 1-2 sentences connecting at least two metrics.",
    "Observations: 3 distinct trends or comparisons; do not merely list individual runs. When citing a run, use its supplied date and name.",
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

async function handleInsights(env, request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64_000) return json({ error: "The training summary is too large." }, 413);
  const input = await request.json();
  const isRunDigest = input?.kind === "run" && input?.run;
  if (!isRunDigest && (!input || !Array.isArray(input.recentRuns) || !input.recentRuns.length)) {
    return json({ error: "No running data was supplied." }, 400);
  }
  const baseUrl = String(env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const model = env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
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
  if (!response.ok) return json({ error: data.error || `Ollama returned HTTP ${response.status}.` }, 502);
  let parsed;
  try {
    parsed = JSON.parse(data.message?.content || "");
  } catch {
    return json({ error: "Ollama returned an unreadable analysis. Try again." }, 502);
  }
  return json({ insight: isRunDigest ? normalizeRunDigest(parsed, input) : normalizeInsight(parsed, input), model });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/status") return handleStatus(env, request);
  if (url.pathname === "/api/activities") return handleActivities(env, request);
  if (url.pathname === "/api/weather" && request.method === "GET") return handleWeather(request);
  if (url.pathname === "/api/insights" && request.method === "POST") return handleInsights(env, request);
  if (url.pathname === "/auth/login") return handleLogin(env, request);
  if (url.pathname === "/auth/callback") return handleCallback(env, request);
  const asset = await env.ASSETS.fetch(request);
  // The document is the deployment boundary: serving a cached old shell with
  // newer JS/CSS (or the reverse) makes a deployment appear to have reverted.
  // Keep fingerprinted assets cacheable, but force navigations to read the
  // current deployment's HTML.
  if ((request.headers.get("accept") || "").includes("text/html")) {
    const headers = new Headers(asset.headers);
    headers.set("cache-control", "no-store, max-age=0");
    headers.set("cdn-cache-control", "no-store");
    return new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers
    });
  }
  return asset;
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return json({ error: error.message || "Unexpected server error." }, 500);
    }
  }
};
