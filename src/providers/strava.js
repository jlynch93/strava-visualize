import { appError, fetchJson } from "../http.js";

const API = "https://www.strava.com/api/v3";
const AUTHORIZE = "https://www.strava.com/oauth/authorize";
const TOKEN = "https://www.strava.com/oauth/token";

function toTokens(data, scope = "") {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Number(data.expires_at) || 0,
    scope
  };
}

async function tokenRequest(params) {
  const { response, data } = await fetchJson(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000)
  }, "Strava");
  if (!response.ok) throw appError(data.message || "Strava rejected the token request.", response.status === 400 || response.status === 401 ? 401 : 502);
  return data;
}

async function apiGet(accessToken, path) {
  const { response, data } = await fetchJson(`${API}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` }
  }, "Strava");
  if (!response.ok) throw appError(data.message || `Strava returned HTTP ${response.status}.`, response.status);
  return data;
}

export default {
  id: "strava",
  name: "Strava",

  config(env, request) {
    const origin = new URL(request.url).origin;
    const redirectUri = env.STRAVA_REDIRECT_URI || `${origin}/auth/strava/callback`;
    if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
      return { error: "Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to this Cloudflare Worker.", redirectUri };
    }
    return { clientId: env.STRAVA_CLIENT_ID, clientSecret: env.STRAVA_CLIENT_SECRET, redirectUri };
  },

  authorizeUrl(config, state) {
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: "read,activity:read_all",
      state
    }).toString();
    return url.toString();
  },

  async exchangeCode(config, { code, searchParams }) {
    const data = await tokenRequest({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code"
    });
    const athlete = data.athlete || {};
    if (!athlete.id) throw appError("Strava did not identify the athlete. Try connecting again.", 502);
    return {
      tokens: toTokens(data, searchParams.get("scope") || ""),
      account: {
        id: String(athlete.id),
        displayName: [athlete.firstname, athlete.lastname].filter(Boolean).join(" ") || athlete.username || "Strava athlete",
        avatarUrl: athlete.profile_medium || athlete.profile || ""
      }
    };
  },

  async refresh(config, tokens) {
    const data = await tokenRequest({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken
    });
    return toTokens(data);
  },

  async listActivities(accessToken, { after, before, perPage, maxPages }) {
    const activities = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (after) params.set("after", after);
      if (before) params.set("before", before);
      const batch = await apiGet(accessToken, `/athlete/activities?${params}`);
      if (!Array.isArray(batch)) throw appError("Strava returned an invalid activity list.", 502);
      activities.push(...batch);
      if (batch.length < perPage) return { activities, truncated: false };
    }
    return { activities, truncated: true };
  },

  async getActivity(accessToken, activityId) {
    const activity = await apiGet(accessToken, `/activities/${encodeURIComponent(activityId)}`);
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
      throw appError("Strava returned an invalid activity detail.", 502);
    }
    return activity;
  }
};
