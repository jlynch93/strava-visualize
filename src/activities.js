import { appError, json } from "./http.js";
import { listConnections } from "./db.js";
import { getProvider } from "./providers/index.js";
import { providerAccessToken, requireUser } from "./auth.js";

function pageLimit(value, fallback, maximum) {
  const numeric = Number(value || fallback);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(Math.floor(numeric), maximum)) : fallback;
}

// Picks the provider named in ?provider=, or the user's first connection.
async function resolveProvider(env, userId, url) {
  const connections = await listConnections(env, userId);
  if (!connections.length) throw appError("Connect Strava or Garmin first.", 401);
  const requested = url.searchParams.get("provider");
  const providerId = requested || connections[0].provider;
  const provider = getProvider(providerId);
  if (!provider) throw appError("Unknown provider.", 400);
  if (!connections.some((connection) => connection.provider === provider.id)) {
    throw appError(`Connect ${provider.name} first.`, 401);
  }
  return provider;
}

export async function handleActivities(env, request) {
  const userId = await requireUser(env, request);
  const url = new URL(request.url);
  const provider = await resolveProvider(env, userId, url);
  const accessToken = await providerAccessToken(env, request, userId, provider.id);
  const result = await provider.listActivities(accessToken, {
    after: url.searchParams.get("after"),
    before: url.searchParams.get("before"),
    perPage: pageLimit(url.searchParams.get("per_page"), 100, 200),
    maxPages: pageLimit(url.searchParams.get("pages"), 6, 12)
  });
  return json({ provider: provider.id, activities: result.activities, truncated: result.truncated });
}

export async function handleActivity(env, request, activityId) {
  const userId = await requireUser(env, request);
  const url = new URL(request.url);
  const provider = await resolveProvider(env, userId, url);
  const accessToken = await providerAccessToken(env, request, userId, provider.id);
  return json({ provider: provider.id, activity: await provider.getActivity(accessToken, activityId) });
}
