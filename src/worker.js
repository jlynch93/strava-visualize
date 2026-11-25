import { json } from "./http.js";
import {
  handleCallback,
  handleDeleteAccount,
  handleDisconnect,
  handleLogin,
  handleLogout,
  handleMe,
  handleStatus
} from "./auth.js";
import { handleActivities, handleActivity } from "./activities.js";
import { handleRaceField, handleRaceSearch } from "./races.js";
import { handleCalendarFeed, handleCalendarLink } from "./calendar.js";
import { handleWeather } from "./weather.js";
import { handleInsights } from "./insights.js";
import { handleGarminWebhook } from "./webhooks.js";
import { handleGetState, handlePutState } from "./state.js";
import { withSecurityHeaders } from "./security.js";
import { deleteExpiredSessions } from "./session.js";
import { retryPendingSyncJobs } from "./sync.js";

export const SYNC_RETRY_CRON = "*/10 * * * *";

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/status") return handleStatus(env, request);
  if (pathname === "/api/me" && method === "GET") return handleMe(env, request);
  if (pathname === "/api/me" && method === "DELETE") return handleDeleteAccount(env, request);
  const connectionRoute = pathname.match(/^\/api\/connections\/([a-z]+)$/);
  if (connectionRoute && method === "DELETE") return handleDisconnect(env, request, connectionRoute[1]);
  if (pathname === "/api/activities") return handleActivities(env, request, ctx);
  const activityRoute = pathname.match(/^\/api\/activities\/(\d+)$/);
  if (activityRoute && method === "GET") return handleActivity(env, request, activityRoute[1]);
  if (pathname === "/api/weather" && method === "GET") return handleWeather(request);
  if (pathname === "/api/races/search" && method === "GET") return handleRaceSearch(request, ctx, env);
  if (pathname === "/api/races/field" && method === "GET") return handleRaceField(request, ctx, env);
  if (pathname === "/api/insights" && method === "POST") return handleInsights(env, request);
  if (pathname === "/api/calendar" && ["GET", "POST", "DELETE"].includes(method)) return handleCalendarLink(env, request);
  const calendarFeed = pathname.match(/^\/api\/calendar\/feed\/([^/]+)\.ics$/);
  if (calendarFeed && ["GET", "HEAD"].includes(method)) return handleCalendarFeed(env, request, calendarFeed[1]);
  if (pathname === "/api/state" && method === "GET") return handleGetState(env, request);
  const stateRoute = pathname.match(/^\/api\/state\/([a-z0-9-]+)$/);
  if (stateRoute && method === "PUT") return handlePutState(env, request, stateRoute[1]);

  const authRoute = pathname.match(/^\/auth\/([a-z]+)\/(login|callback)$/);
  if (authRoute) {
    return authRoute[2] === "login" ? handleLogin(env, request, authRoute[1]) : handleCallback(env, request, authRoute[1], ctx);
  }
  // Original single-provider paths, kept so existing Strava app settings and
  // STRAVA_REDIRECT_URI values continue to work.
  if (pathname === "/auth/login") return handleLogin(env, request, "strava");
  if (pathname === "/auth/callback") return handleCallback(env, request, "strava", ctx);
  if (pathname === "/auth/logout") return handleLogout(env, request);

  const garminWebhook = pathname.match(/^\/webhooks\/garmin\/([^/]+)$/);
  if (garminWebhook && method === "POST") return handleGarminWebhook(env, request, garminWebhook[1]);

  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/") || pathname.startsWith("/webhooks/")) {
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

async function respond(request, env, ctx) {
  try {
    return await handleRequest(request, env, ctx);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) {
      // Structured so Workers Logs can filter on it; never includes tokens.
      console.error(JSON.stringify({ event: "request_failed", path: new URL(request.url).pathname, status, message: error.message }));
    }
    // Errors without a status are unexpected; don't leak their internals.
    const message = error.status ? error.message : "Something went wrong on our side. Try again in a moment.";
    return json({ error: message || "Unexpected server error." }, status);
  }
}

export default {
  async fetch(request, env, ctx) {
    return withSecurityHeaders(await respond(request, env, ctx), request);
  },

  // Cron triggers (see wrangler.jsonc): every 10 minutes, retry history
  // imports that still have windows to request; daily, remove expired sessions.
  async scheduled(controller, env) {
    const retried = await retryPendingSyncJobs(env);
    if (retried) console.log(JSON.stringify({ event: "sync_jobs_retried", count: retried }));
    if (controller?.cron !== SYNC_RETRY_CRON) {
      const removed = await deleteExpiredSessions(env);
      console.log(JSON.stringify({ event: "sessions_cleaned", removed }));
    }
  }
};
