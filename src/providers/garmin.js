import { appError, fetchJson } from "../http.js";

// Garmin Connect Developer Program (OAuth 2.0 with PKCE + Activity API).
// Garmin pushes activities to /webhooks/garmin/<GARMIN_WEBHOOK_SECRET>
// rather than allowing on-demand listing, so activities are stored in D1.
// Confirm these URLs against Garmin's documentation once the app is approved.
const AUTHORIZE = "https://connect.garmin.com/oauth2Confirm";
const TOKEN = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const API = "https://apis.garmin.com/wellness-api/rest";
const BACKFILL_WINDOW = 90 * 24 * 60 * 60; // Garmin's maximum range per backfill request.
const BACKFILL_WINDOWS = 4; // About a year of history on first connect.

const RUN_TYPES = {
  RUNNING: "Run",
  STREET_RUNNING: "Run",
  TRACK_RUNNING: "Run",
  TREADMILL_RUNNING: "Run",
  INDOOR_RUNNING: "Run",
  TRAIL_RUNNING: "TrailRun",
  ULTRA_RUN: "TrailRun",
  VIRTUAL_RUN: "VirtualRun"
};
const OTHER_TYPES = {
  CYCLING: "Ride",
  ROAD_BIKING: "Ride",
  MOUNTAIN_BIKING: "MountainBikeRide",
  INDOOR_CYCLING: "VirtualRide",
  WALKING: "Walk",
  HIKING: "Hike",
  LAP_SWIMMING: "Swim",
  OPEN_WATER_SWIMMING: "Swim",
  STRENGTH_TRAINING: "WeightTraining",
  YOGA: "Yoga"
};

function toTokens(data, fallbackRefresh = "") {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || fallbackRefresh,
    expiresAt: Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 0),
    scope: data.scope || ""
  };
}

async function tokenRequest(params) {
  const { response, data } = await fetchJson(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000)
  }, "Garmin");
  if (!response.ok) {
    throw appError(data.error_description || data.message || "Garmin rejected the token request.", response.status === 400 || response.status === 401 ? 401 : 502);
  }
  return data;
}

async function apiRequest(accessToken, path, options = {}) {
  const url = path.startsWith("https://") ? path : `${API}${path}`;
  const { response, data } = await fetchJson(url, {
    ...options,
    headers: { authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
  }, "Garmin");
  if (!response.ok) throw appError(data.errorMessage || data.message || `Garmin returned HTTP ${response.status}.`, response.status);
  return { status: response.status, data };
}

function isoSeconds(seconds) {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

// Maps a Garmin activity summary onto the Strava field names the dashboard
// already understands. Returns null for summaries without a start time.
export function toStravaShape(summary) {
  const start = finite(summary?.startTimeInSeconds);
  const id = summary?.activityId ?? summary?.summaryId;
  if (start === undefined || id === undefined || id === null) return null;
  const offset = finite(summary.startTimeOffsetInSeconds) || 0;
  const garminType = String(summary.activityType || "").toUpperCase();
  const sportType = RUN_TYPES[garminType] || OTHER_TYPES[garminType] || "Workout";
  const latitude = finite(summary.startingLatitudeInDegree);
  const longitude = finite(summary.startingLongitudeInDegree);
  const duration = finite(summary.durationInSeconds) || 0;
  const activity = {
    id: String(id),
    name: summary.activityName || (RUN_TYPES[garminType] ? "Run" : sportType),
    sport_type: sportType,
    type: sportType,
    start_date: isoSeconds(start),
    // Strava's convention: local wall-clock time written with a Z suffix.
    start_date_local: isoSeconds(start + offset),
    utc_offset: offset,
    distance: finite(summary.distanceInMeters) || 0,
    moving_time: finite(summary.movingDurationInSeconds) || duration,
    elapsed_time: duration,
    total_elevation_gain: finite(summary.totalElevationGainInMeters) || 0,
    average_speed: finite(summary.averageSpeedInMetersPerSecond),
    max_speed: finite(summary.maxSpeedInMetersPerSecond),
    average_heartrate: finite(summary.averageHeartRateInBeatsPerMinute),
    max_heartrate: finite(summary.maxHeartRateInBeatsPerMinute),
    average_cadence: finite(summary.averageRunCadenceInStepsPerMinute),
    calories: finite(summary.activeKilocalories),
    device_name: summary.deviceName || undefined,
    manual: Boolean(summary.manual),
    source: "garmin"
  };
  if (latitude !== undefined && longitude !== undefined) activity.start_latlng = [latitude, longitude];
  return Object.fromEntries(Object.entries(activity).filter(([, value]) => value !== undefined));
}

export default {
  id: "garmin",
  name: "Garmin",
  pkce: true,
  storesActivities: true,

  config(env, request) {
    const origin = (env.APP_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");
    const redirectUri = env.GARMIN_REDIRECT_URI || `${origin}/auth/garmin/callback`;
    if (!env.GARMIN_CLIENT_ID || !env.GARMIN_CLIENT_SECRET) {
      return { error: "Add GARMIN_CLIENT_ID and GARMIN_CLIENT_SECRET to this Worker once Garmin approves the app.", redirectUri };
    }
    if (!env.GARMIN_WEBHOOK_SECRET) {
      return { error: "Add GARMIN_WEBHOOK_SECRET so Garmin can deliver activities to this Worker.", redirectUri };
    }
    return { clientId: env.GARMIN_CLIENT_ID, clientSecret: env.GARMIN_CLIENT_SECRET, redirectUri };
  },

  authorizeUrl(config, state, pkce) {
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: "S256",
      state
    }).toString();
    return url.toString();
  },

  async exchangeCode(config, { code, codeVerifier }) {
    const data = await tokenRequest({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: config.redirectUri
    });
    const tokens = toTokens(data);
    const { data: user } = await apiRequest(tokens.accessToken, "/user/id");
    if (!user?.userId) throw appError("Garmin did not identify the user. Try connecting again.", 502);
    // Garmin's Activity API does not expose a profile name.
    return { tokens, account: { id: String(user.userId), displayName: "Garmin Connect", avatarUrl: "" } };
  },

  async refresh(config, tokens) {
    const data = await tokenRequest({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refreshToken
    });
    return toTokens(data, tokens.refreshToken);
  },

  // Asks Garmin to push recent history. Each request covers at most 90 days;
  // the activities arrive later through the webhook.
  async onConnected(env, config, tokens) {
    const end = Math.floor(Date.now() / 1000);
    for (let window = 0; window < BACKFILL_WINDOWS; window += 1) {
      const windowEnd = end - window * BACKFILL_WINDOW;
      const params = new URLSearchParams({
        summaryStartTimeInSeconds: String(windowEnd - BACKFILL_WINDOW),
        summaryEndTimeInSeconds: String(windowEnd)
      });
      try {
        await apiRequest(tokens.accessToken, `/backfill/activities?${params}`);
      } catch (error) {
        // 409 means this window was already requested; keep going.
        if (error.status !== 409) throw error;
      }
    }
  },

  // Stops Garmin from sending further data for this user.
  async onDisconnect(config, accessToken) {
    await apiRequest(accessToken, "/user/registration", { method: "DELETE" });
  },

  // In "ping" mode Garmin sends a callback URL instead of the data itself.
  async fetchCallback(accessToken, callbackUrl) {
    const url = new URL(callbackUrl);
    if (url.protocol !== "https:" || url.hostname !== "apis.garmin.com") {
      throw appError("Ignored a Garmin callback URL on an unexpected host.", 400);
    }
    const { data } = await apiRequest(accessToken, url.toString());
    return Array.isArray(data) ? data : [];
  }
};
