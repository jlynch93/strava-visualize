import { json } from "./http.js";
import { sha256 } from "./crypto.js";
import {
  deleteActivities,
  deleteConnection,
  deleteUser,
  findUserIdByProviderUser,
  listConnections,
  saveActivities
} from "./db.js";
import { providerAccessToken } from "./auth.js";
import { resumeHistoryImport } from "./sync.js";
import garmin, { toStravaShape } from "./providers/garmin.js";

const ACTIVITY_KEYS = ["activities", "manuallyUpdatedActivities", "activityDetails"];

// Compares hashes so the check takes the same time whatever the input.
async function secretMatches(expected, received) {
  if (!expected || !received) return false;
  return (await sha256(expected)) === (await sha256(received));
}

function groupByUser(items) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.userId === undefined || item.userId === null) continue;
    const key = String(item.userId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

// activityDetails nest the summary; push summaries are flat.
function summaryOf(item) {
  return item.summary ? { ...item.summary, activityId: item.activityId ?? item.summary.activityId, summaryId: item.summaryId } : item;
}

async function receiveActivities(env, request, garminUserId, items) {
  const userId = await findUserIdByProviderUser(env, garmin.id, garminUserId);
  if (!userId) return 0; // Not (or no longer) connected: drop the data.
  const summaries = [];
  for (const item of items) {
    if (item.callbackURL) {
      const accessToken = await providerAccessToken(env, request, userId, garmin.id);
      summaries.push(...await garmin.fetchCallback(accessToken, item.callbackURL));
    } else {
      summaries.push(summaryOf(item));
    }
  }
  const activities = summaries.map(toStravaShape).filter(Boolean);
  await saveActivities(env, userId, garmin.id, activities);
  return activities.length;
}

async function deregister(env, garminUserId) {
  const userId = await findUserIdByProviderUser(env, garmin.id, garminUserId);
  if (!userId) return;
  await deleteConnection(env, userId, garmin.id);
  // Garmin was this profile's only sign-in method; nothing can reach it now.
  if (!(await listConnections(env, userId)).length) await deleteUser(env, userId);
}

async function permissionsChanged(env, request, garminUserId, permissions) {
  const userId = await findUserIdByProviderUser(env, garmin.id, garminUserId);
  if (!userId) return;
  if (Array.isArray(permissions) && permissions.includes("ACTIVITY_EXPORT")) {
    // Granted (perhaps after a refused import): request the history again.
    await resumeHistoryImport(env, request, garmin, userId);
    return;
  }
  await deleteActivities(env, userId, garmin.id);
}

// Garmin posts notifications to the endpoint registered in its developer
// portal: https://<host>/webhooks/garmin/<GARMIN_WEBHOOK_SECRET>. The secret
// in the path is what stops anyone else from writing activities.
export async function handleGarminWebhook(env, request, pathSecret) {
  if (!(await secretMatches(env.GARMIN_WEBHOOK_SECRET, pathSecret))) return json({ error: "Not found" }, 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON notification." }, 400);
  }
  let stored = 0;
  for (const key of ACTIVITY_KEYS) {
    for (const [garminUserId, items] of groupByUser(body?.[key])) {
      stored += await receiveActivities(env, request, garminUserId, items);
    }
  }
  for (const [garminUserId] of groupByUser(body?.deregistrations)) {
    await deregister(env, garminUserId);
  }
  for (const [garminUserId, items] of groupByUser(body?.userPermissionsChange)) {
    await permissionsChanged(env, request, garminUserId, items.at(-1)?.permissions);
  }
  return json({ received: true, stored });
}
