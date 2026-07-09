const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_AUTHORIZE = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN = "https://www.strava.com/oauth/token";

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

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/status") return handleStatus(env, request);
  if (url.pathname === "/api/activities") return handleActivities(env, request);
  if (url.pathname === "/auth/login") return handleLogin(env, request);
  if (url.pathname === "/auth/callback") return handleCallback(env, request);
  return env.ASSETS.fetch(request);
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
