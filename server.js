const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { URL, URLSearchParams } = require("url");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const TOKEN_FILE = path.join(__dirname, ".strava-token.json");
const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_OAUTH_TOKEN = "https://www.strava.com/oauth/token";
const { DEFAULT_OLLAMA_URL, DEFAULT_OLLAMA_MODEL, weatherRequest, normalizeWeather, requestInsight: sharedRequestInsight } = require("./shared/services.cjs");
const { validateInsightInput, guardedAnalysis } = require("./shared/analysis-limits.cjs");

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
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", ...headers });
  res.end(JSON.stringify(payload));
}

function sendRedirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store", ...headers });
  res.end();
}

function oauthStateCookie(value, redirectUri, maxAge = 600) {
  const secure = new URL(redirectUri).protocol === "https:" ? "; Secure" : "";
  return `sv_oauth_state=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function readOauthState(req) {
  const entry = String(req.headers.cookie || "").split(";").find((part) => part.trim().startsWith("sv_oauth_state="));
  try {
    return entry ? decodeURIComponent(entry.trim().slice("sv_oauth_state=".length)) : null;
  } catch {
    return null;
  }
}

function appError(message, status) {
  return Object.assign(new Error(message), { status });
}

function pageLimit(value, fallback, maximum) {
  const numeric = Number(value || fallback);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(Math.floor(numeric), maximum)) : fallback;
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
  const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
  const redirectUri = process.env.STRAVA_REDIRECT_URI || `${baseUrl}/auth/callback`;
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
      response.on("error", reject);
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        const contentType = response.headers["content-type"] || "";
        let parsed;
        try {
          parsed = contentType.includes("application/json") && raw ? JSON.parse(raw) : raw;
        } catch {
          reject(appError("The upstream service returned invalid JSON. Try again.", 502));
          return;
        }
        if (response.statusCode >= 400) {
          reject(appError(typeof parsed === "string" ? parsed : JSON.stringify(parsed), response.statusCode));
          return;
        }
        resolve(parsed);
      });
    });
    request.on("error", reject);
    request.setTimeout(30_000, () => request.destroy(appError("The upstream service timed out. Try again.", 504)));
    if (body) request.write(body);
    request.end();
  });
}

function readRequestJson(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    let rejected = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (rejected) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > limit) { rejected = true; raw = ""; reject(appError("The training summary is too large.", 413)); return; }
      raw += chunk;
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(appError("The training summary is not valid JSON.", 400));
      }
    });
    req.on("error", reject);
  });
}

async function getRunWeather(config) {
  const response = await fetch(config.endpoint, { signal: AbortSignal.timeout(20_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.reason || "Weather provider unavailable.");
  return normalizeWeather(data, config);
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
  ).catch((error) => {
    if (params.grant_type === "refresh_token" && [400, 401].includes(error.status)) throw appError("Your Strava session expired. Connect Strava again.", 401);
    throw error;
  });
}

async function getAccessToken() {
  const config = requireConfig();
  if (config.error) throw appError(config.error, 503);
  const token = readToken();
  if (!token) throw appError("Connect Strava first.", 401);
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
  let requestedPath;
  try {
    requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    if (requestedPath.includes("\0")) throw new Error("Invalid path");
  } catch {
    sendJson(res, 400, { error: "The requested path is not valid." });
    return;
  }
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
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
      analysisService: new URL(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).origin,
      analysisModel: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
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
    const oauthState = randomUUID();
    const authUrl = new URL("https://www.strava.com/oauth/authorize");
    authUrl.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: "read,activity:read_all",
      state: oauthState
    }).toString();
    sendRedirect(res, authUrl.toString(), { "Set-Cookie": oauthStateCookie(oauthState, config.redirectUri) });
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
    const returnedState = url.searchParams.get("state");
    if (!returnedState || returnedState !== readOauthState(req)) {
      sendJson(res, 400, { error: "The Strava authorization session expired. Start the connection again." });
      return;
    }
    const token = await exchangeToken({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code"
    });
    writeToken(token);
    sendRedirect(res, "/?connected=1", { "Set-Cookie": oauthStateCookie("", config.redirectUri, 0) });
    return;
  }

  if (url.pathname === "/auth/logout") {
    fs.rmSync(TOKEN_FILE, { force: true });
    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
    const redirectUri = process.env.STRAVA_REDIRECT_URI || `${baseUrl}/auth/callback`;
    sendRedirect(res, "/?disconnected=1", { "Set-Cookie": oauthStateCookie("", redirectUri, 0) });
    return;
  }

  if (url.pathname === "/api/activities") {
    const config = requireConfig();
    if (config.error) {
      sendJson(res, 503, { error: config.error });
      return;
    }
    const accessToken = await getAccessToken();
    const after = url.searchParams.get("after");
    const before = url.searchParams.get("before");
    const perPage = pageLimit(url.searchParams.get("per_page"), 100, 200);
    const maxPages = pageLimit(url.searchParams.get("pages"), 6, 12);
    const activities = [];
    let truncated = true;
    for (let page = 1; page <= maxPages; page += 1) {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (after) params.set("after", after);
      if (before) params.set("before", before);
      const batch = await requestJson(`${STRAVA_API}/athlete/activities?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!Array.isArray(batch)) throw appError("Strava returned an invalid activity list.", 502);
      activities.push(...batch);
      if (batch.length < perPage) {
        truncated = false;
        break;
      }
    }
    sendJson(res, 200, { activities, truncated });
    return;
  }

  const activityRoute = url.pathname.match(/^\/api\/activities\/(\d+)$/);
  if (activityRoute && req.method === "GET") {
    const accessToken = await getAccessToken();
    const activity = await requestJson(`${STRAVA_API}/activities/${activityRoute[1]}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
      throw appError("Strava returned an invalid activity detail.", 502);
    }
    sendJson(res, 200, { activity });
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
    const input = validateInsightInput(await readRequestJson(req));
    const isRunDigest = input?.kind === "run" && input?.run;
    if (!isRunDigest && (!input || !Array.isArray(input.recentRuns) || !input.recentRuns.length)) {
      sendJson(res, 400, { error: "No running data was supplied." });
      return;
    }
    const headers = new Headers();
    if (req.headers.origin) headers.set("origin", req.headers.origin);
    headers.set("x-analysis-client", req.socket.remoteAddress || "local");
    const controller = new AbortController();
    res.once("close", () => { if (!res.writableEnded) controller.abort(); });
    const result = await guardedAnalysis(new Request(url, { method: "POST", headers }), process.env, () => sharedRequestInsight(input, process.env, controller.signal));
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/auth/")) {
    handleApi(req, res).catch((error) => {
      sendJson(res, Number(error.status) || 500, { error: error.message });
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Strava Visualize is running at http://localhost:${PORT}`);
});
