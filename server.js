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
    headline: { type: "string" },
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
    },
    nextStep: { type: "string" }
  },
  required: ["headline", "summary", "observations", "nextStep"]
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
  const periods = (input.buckets || []).map((period) =>
    `${period.period}: ${period.runs} runs, ${period.miles} mi, ${pace(period.averagePaceSeconds)}, long ${period.longRunMiles} mi, HR ${period.averageHr ?? "n/a"}, load ${period.trainingLoad}`
  );
  const runs = (input.recentRuns || []).map((run) =>
    `${run.date}: ${run.distanceMiles} mi, ${pace(run.paceSecondsPerMile)}, ${run.elevationFeet} ft, HR ${run.averageHr ?? "n/a"}, load ${run.trainingLoad}`
  );
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
    "Write only the athlete-facing training read. The app already calculated every metric and chart; never imply that you generated, measured, or verified them.",
    "Address the athlete question directly when one is provided. Do not use labels, placeholders, or a data dump.",
    "Use the app-calculated comparison for trend claims. Do not infer motivation, training phase, tapering, recovery status, readiness, or causation.",
    "Do not include digits, numeric quantities, or units in any response field. Describe the supplied changes qualitatively without recomputing or restating values.",
    "Treat the approved totals, signals, and app-calculated comparison above as exhaustive. If they cannot answer the question, say the supplied snapshot is insufficient.",
    "Headline: one concise sentence naming the most important pattern.",
    "Summary: 1-2 sentences connecting at least two metrics.",
    "Observations: 3 distinct trends or comparisons; do not merely list individual runs.",
    "Next step: one conservative, specific action grounded in the supplied baseline.",
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
    headline: String(value.headline || insightHeadline(input)).slice(0, 160),
    summary: String(value.summary).slice(0, 700),
    observations,
    nextStep: String(value.nextStep || safeNextStep(input)).slice(0, 500),
    caution: "Written by Ollama from app-calculated training metrics. Pattern guidance only—not medical advice."
  };
}

async function requestInsight(input) {
  const baseUrl = String(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: INSIGHT_SCHEMA,
      messages: [
        { role: "system", content: "Interpret only the supplied app-calculated running data. Preserve units, avoid causal or intent claims, and return only schema-valid JSON." },
        { role: "user", content: buildInsightPrompt(input) }
      ],
      options: { temperature: 0, num_ctx: 8192, num_predict: 640 }
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
  return { insight: normalizeInsight(parsed, input), model };
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
    if (!input || !Array.isArray(input.recentRuns) || !input.recentRuns.length) {
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
