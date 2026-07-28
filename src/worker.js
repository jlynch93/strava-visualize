const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_AUTHORIZE = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN = "https://www.strava.com/oauth/token";
const DEFAULT_OLLAMA_URL = "https://ollama.jeer.rest";
const DEFAULT_OLLAMA_MODEL = "qwen3:0.6b";

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

async function handleInsights(env, request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64_000) return json({ error: "The training summary is too large." }, 413);
  const input = await request.json();
  if (!input || !Array.isArray(input.recentRuns) || !input.recentRuns.length) {
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
      format: INSIGHT_SCHEMA,
      messages: [
        { role: "system", content: "Concise running analyst. Return only schema-valid JSON." },
        { role: "user", content: buildInsightPrompt(input) }
      ],
      options: { temperature: 0.1, num_ctx: 8192, num_predict: 480 }
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
  return json({ insight: normalizeInsight(parsed, input), model });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/status") return handleStatus(env, request);
  if (url.pathname === "/api/activities") return handleActivities(env, request);
  if (url.pathname === "/api/insights" && request.method === "POST") return handleInsights(env, request);
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
