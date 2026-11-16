import { appError, json } from "./http.js";
import { getStoredActivity, listConnections, listStoredActivities } from "./db.js";
import { getProvider } from "./providers/index.js";
import { providerAccessToken, requireUser } from "./auth.js";
import { ensureHistoryImport, syncStatus } from "./sync.js";

function pageLimit(value, fallback, maximum) {
  const numeric = Number(value || fallback);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(Math.floor(numeric), maximum)) : fallback;
}

function epochParam(value) {
  if (value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

// Picks the provider named in ?provider=, or the user's first connection.
async function resolveProvider(env, userId, url) {
  const connections = await listConnections(env, userId);
  if (!connections.length) throw appError("Connect Strava or Garmin first.", 401);
  const requested = url.searchParams.get("provider");
  const providerId = requested || connections[0].provider;
  const provider = getProvider(providerId);
  if (!provider) throw appError("Unknown provider.", 400);
  const connection = connections.find((item) => item.provider === provider.id);
  if (!connection) throw appError(`Connect ${provider.name} first.`, 401);
  return { provider, connection };
}

export async function handleActivities(env, request, ctx) {
  const userId = await requireUser(env, request);
  const url = new URL(request.url);
  const { provider, connection } = await resolveProvider(env, userId, url);
  const perPage = pageLimit(url.searchParams.get("per_page"), 100, 200);
  const maxPages = pageLimit(url.searchParams.get("pages"), 6, 12);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  if (provider.storesActivities) {
    try {
      await ensureHistoryImport(env, request, provider, userId, ctx);
    } catch (error) {
      // Listing what has arrived must not fail because a history request did.
      console.warn(JSON.stringify({ event: "history_import_start_failed", provider: provider.id, message: error.message }));
    }
    const result = await listStoredActivities(env, userId, provider.id, {
      after: epochParam(after),
      before: epochParam(before),
      // Arrival-time cursor: history pushed later (backfill) is still found,
      // even though it started long before the last sync.
      changedSince: epochParam(url.searchParams.get("changed_since")),
      limit: perPage * maxPages
    });
    return json({
      provider: provider.id,
      activities: result.activities,
      truncated: result.truncated,
      // Lets the client explain that history is still being delivered.
      connectedAt: connection.created_at,
      // importing / idle / failed, progress, and the next changed_since cursor.
      sync: await syncStatus(env, userId, provider.id, { connectedAt: connection.created_at })
    });
  }

  const accessToken = await providerAccessToken(env, request, userId, provider.id);
  const result = await provider.listActivities(accessToken, { after, before, perPage, maxPages });
  return json({ provider: provider.id, activities: result.activities, truncated: result.truncated });
}

export async function handleActivity(env, request, activityId) {
  const userId = await requireUser(env, request);
  const url = new URL(request.url);
  const { provider } = await resolveProvider(env, userId, url);
  if (provider.storesActivities) {
    const activity = await getStoredActivity(env, userId, provider.id, activityId);
    if (!activity) throw appError("That activity was not found.", 404);
    return json({ provider: provider.id, activity });
  }
  const accessToken = await providerAccessToken(env, request, userId, provider.id);
  return json({ provider: provider.id, activity: await provider.getActivity(accessToken, activityId) });
}
