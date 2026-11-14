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
import { handleWeather } from "./weather.js";
import { handleInsights } from "./insights.js";

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/status") return handleStatus(env, request);
  if (pathname === "/api/me" && method === "GET") return handleMe(env, request);
  if (pathname === "/api/me" && method === "DELETE") return handleDeleteAccount(env, request);
  const connectionRoute = pathname.match(/^\/api\/connections\/([a-z]+)$/);
  if (connectionRoute && method === "DELETE") return handleDisconnect(env, request, connectionRoute[1]);
  if (pathname === "/api/activities") return handleActivities(env, request);
  const activityRoute = pathname.match(/^\/api\/activities\/(\d+)$/);
  if (activityRoute && method === "GET") return handleActivity(env, request, activityRoute[1]);
  if (pathname === "/api/weather" && method === "GET") return handleWeather(request);
  if (pathname === "/api/insights" && method === "POST") return handleInsights(env, request);

  const authRoute = pathname.match(/^\/auth\/([a-z]+)\/(login|callback)$/);
  if (authRoute) {
    return authRoute[2] === "login" ? handleLogin(env, request, authRoute[1]) : handleCallback(env, request, authRoute[1]);
  }
  // Original single-provider paths, kept so existing Strava app settings and
  // STRAVA_REDIRECT_URI values continue to work.
  if (pathname === "/auth/login") return handleLogin(env, request, "strava");
  if (pathname === "/auth/callback") return handleCallback(env, request, "strava");
  if (pathname === "/auth/logout") return handleLogout(env, request);

  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
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
