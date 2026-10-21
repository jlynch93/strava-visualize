import services from "../shared/services.cjs";
import limits from "../shared/analysis-limits.cjs";
const { DEFAULT_OLLAMA_URL, DEFAULT_OLLAMA_MODEL, weatherRequest, normalizeWeather, requestInsight } = services;
const { readBoundedJson, validateInsightInput, guardedAnalysis } = limits;
const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_AUTHORIZE = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN = "https://www.strava.com/oauth/token";
function json(payload, status = 200, headers = {}) {
  const responseHeaders = headers instanceof Headers ? headers : new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  if (!responseHeaders.has("cache-control")) responseHeaders.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

function appError(message, status) {
  return Object.assign(new Error(message), { status });
}

function getConfig(env, request) {
  const url = new URL(request.url);
  const baseUrl = (env.APP_BASE_URL || url.origin).replace(/\/+$/, "");
  const redirectUri = env.STRAVA_REDIRECT_URI || `${baseUrl}/auth/callback`;
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
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value.join("="));
      } catch {
        cookies[key] = value.join("=");
      }
    }
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
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000)
  });
  const data = await response.json();
  if (!response.ok) throw appError(params.grant_type === "refresh_token" && [400, 401].includes(response.status) ? "Your Strava session expired. Connect Strava again." : data.message || "Strava authorization failed.", params.grant_type === "refresh_token" && [400, 401].includes(response.status) ? 401 : response.status);
  return data;
}

async function getAccessToken(env, request) {
  const config = getConfig(env, request);
  if (config.error) throw appError(config.error, 503);
  const cookies = parseCookies(request);
  const now = Math.floor(Date.now() / 1000);
  if (cookies.sv_access && Number(cookies.sv_expires || 0) - 60 > now) {
    return { accessToken: cookies.sv_access, setCookies: [] };
  }
  if (!cookies.sv_refresh) throw appError("Connect Strava first.", 401);
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
    analysisService: new URL(env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).origin,
    analysisModel: env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
    error: config.error || null
  });
}

function handleLogin(env, request) {
  const config = getConfig(env, request);
  if (config.error) return json({ error: config.error }, 400);
  const oauthState = crypto.randomUUID();
  const authUrl = new URL(STRAVA_AUTHORIZE);
  authUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state: oauthState
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      location: authUrl.toString(),
      "cache-control": "no-store",
      "set-cookie": cookie("sv_oauth_state", oauthState, 600)
    }
  });
}

async function handleCallback(env, request) {
  const config = getConfig(env, request);
  if (config.error) return json({ error: config.error }, 400);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return json({ error: "Missing Strava authorization code." }, 400);
  const returnedState = url.searchParams.get("state");
  if (!returnedState || returnedState !== parseCookies(request).sv_oauth_state) {
    return json({ error: "The Strava authorization session expired. Start the connection again." }, 400);
  }
  const token = await exchangeToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code"
  });
  const headers = new Headers({ location: "/?connected=1", "cache-control": "no-store" });
  tokenCookies(token).forEach((value) => headers.append("set-cookie", value));
  headers.append("set-cookie", cookie("sv_oauth_state", "", 0));
  return new Response(null, { status: 302, headers });
}

function handleLogout() {
  const headers = new Headers({ location: "/?disconnected=1", "cache-control": "no-store" });
  ["sv_access", "sv_refresh", "sv_expires", "sv_oauth_state"].forEach((name) => {
    headers.append("set-cookie", cookie(name, "", 0));
  });
  return new Response(null, { status: 302, headers });
}

function pageLimit(value, fallback, maximum) {
  const numeric = Number(value || fallback);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(Math.floor(numeric), maximum)) : fallback;
}

async function handleActivities(env, request) {
  const url = new URL(request.url);
  const { accessToken, setCookies } = await getAccessToken(env, request);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const perPage = pageLimit(url.searchParams.get("per_page"), 100, 200);
  const maxPages = pageLimit(url.searchParams.get("pages"), 6, 12);
  const activities = [];
  let truncated = true;
  const headers = new Headers();
  setCookies.forEach((value) => headers.append("set-cookie", value));
  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (after) params.set("after", after);
    if (before) params.set("before", before);
    const response = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000)
    });
    const batch = await response.json();
    if (!response.ok) return json(batch, response.status, headers);
    if (!Array.isArray(batch)) return json({ error: "Strava returned an invalid activity list." }, 502, headers);
    activities.push(...batch);
    if (batch.length < perPage) {
      truncated = false;
      break;
    }
  }
  return json({ activities, truncated }, 200, headers);
}

async function handleActivity(env, request, activityId) {
  const { accessToken, setCookies } = await getAccessToken(env, request);
  const headers = new Headers();
  setCookies.forEach((value) => headers.append("set-cookie", value));
  const response = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const activity = await response.json();
  if (!response.ok) return json(activity, response.status, headers);
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    return json({ error: "Strava returned an invalid activity detail." }, 502, headers);
  }
  return json({ activity }, 200, headers);
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

async function handleInsights(env, request) {
  try {
    const input = validateInsightInput(await readBoundedJson(request));
    const result = await guardedAnalysis(request, env, () => requestInsight(input, env, request.signal));
    return json(result);
  } catch (error) { return json({ error: error.message }, error.status || 502); }
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/status") return handleStatus(env, request);
  if (url.pathname === "/api/activities") return handleActivities(env, request);
  const activityRoute = url.pathname.match(/^\/api\/activities\/(\d+)$/);
  if (activityRoute && request.method === "GET") return handleActivity(env, request, activityRoute[1]);
  if (url.pathname === "/api/weather" && request.method === "GET") return handleWeather(request);
  if (url.pathname === "/api/insights" && request.method === "POST") return handleInsights(env, request);
  if (url.pathname === "/auth/login") return handleLogin(env, request);
  if (url.pathname === "/auth/callback") return handleCallback(env, request);
  if (url.pathname === "/auth/logout") return handleLogout();
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return json({ error: "Not found" }, 404);
  }
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
      return json({ error: error.message || "Unexpected server error." }, Number(error.status) || 500);
    }
  }
};
