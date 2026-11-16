import { getProvider } from "./providers/index.js";
import { providerAccessToken } from "./auth.js";
import { getSyncJob, isMissingTable, listPendingSyncJobs, startSyncJob, storedActivityStats, updateSyncJob } from "./db.js";

// After this many failed rounds the job stops retrying and reports "failed".
export const MAX_SYNC_ATTEMPTS = 6;
// Garmin delivers requested history over the following minutes; keep telling
// the client to watch for arrivals for this long after the last request.
const ARRIVAL_GRACE_SECONDS = 30 * 60;
const RECENT_ARRIVAL_SECONDS = 5 * 60;

const now = () => Math.floor(Date.now() / 1000);

// Provider config needs a request for its redirect URI; background work has none.
function backgroundRequest(env) {
  return new Request(env.APP_BASE_URL || "https://localhost/");
}

// Requests the remaining history windows for one job, recording progress after
// each so a failure resumes where it stopped.
export async function runSyncJob(env, userId, providerId, request = backgroundRequest(env)) {
  const provider = getProvider(providerId);
  const job = await getSyncJob(env, userId, providerId);
  if (!provider?.requestBackfillWindow || !job || job.status !== "requesting") return job;
  let windowsDone = Number(job.windows_done);
  const attempts = Number(job.attempts) + 1;
  try {
    const accessToken = await providerAccessToken(env, request, userId, providerId);
    while (windowsDone < Number(job.windows_total)) {
      await provider.requestBackfillWindow(accessToken, Number(job.anchor_end), windowsDone);
      windowsDone += 1;
      await updateSyncJob(env, userId, providerId, { windowsDone, attempts, status: "requesting" });
    }
    await updateSyncJob(env, userId, providerId, { windowsDone, attempts, status: "requested" });
  } catch (error) {
    // Access refused will not fix itself on retry: stop now and say why.
    const refused = error.status === 401 || error.status === 403;
    const status = refused || attempts >= MAX_SYNC_ATTEMPTS ? "failed" : "requesting";
    const lastError = refused ? await explainRefusal(env, request, provider, userId, error) : String(error.message || error);
    await updateSyncJob(env, userId, providerId, { windowsDone, attempts, status, lastError: lastError.slice(0, 500) });
    console.warn(JSON.stringify({ event: "sync_job_failed", provider: providerId, windowsDone, attempts, status, message: error.message }));
  }
  return getSyncJob(env, userId, providerId);
}

// Turns "access denied" into the likely cause by asking which permissions the
// user granted: a missing permission is fixed in Garmin Connect; a granted one
// means the API itself is not enabled for this app in the developer portal.
async function explainRefusal(env, request, provider, userId, error) {
  const refusal = `${provider.name} refused the history request (${error.message}).`;
  if (!provider.permissions || !provider.requiredPermission) return refusal;
  try {
    const accessToken = await providerAccessToken(env, request, userId, provider.id);
    const granted = await provider.permissions(accessToken);
    const list = granted.length ? granted.join(", ") : "none";
    return granted.includes(provider.requiredPermission)
      ? `${refusal} Granted permissions: ${list}. ${provider.requiredPermission} is granted, so the Activity API is probably not enabled for this app: check the API Configuration Tool in the ${provider.name} developer portal, then reconnect.`
      : `${refusal} Granted permissions: ${list}. ${provider.requiredPermission} is missing: allow Activities for Runlore in ${provider.name} Connect (or disconnect and reconnect, allowing it). The import restarts automatically when it is granted.`;
  } catch (lookupError) {
    return `${refusal} Could not read granted permissions (${lookupError.message}).`;
  }
}

// Called when a provider reports that the user granted the needed permission:
// restart a refused or missing import. A running or finished one is left alone.
export async function resumeHistoryImport(env, request, provider, userId, ctx) {
  if (!provider.requestBackfillWindow) return;
  let job;
  try { job = await getSyncJob(env, userId, provider.id); } catch (error) { if (isMissingTable(error)) return; throw error; }
  if (!job || job.status === "failed") await startHistoryImport(env, request, provider, userId, ctx);
}

// Called after a provider connects. With an execution context the requests
// run after the response is sent, so sign-in never waits on the provider.
export async function startHistoryImport(env, request, provider, userId, ctx) {
  if (!provider.requestBackfillWindow) return;
  try {
    await startSyncJob(env, userId, provider.id, { anchorEnd: now(), windowsTotal: provider.backfill.windows });
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    // Before migration 0004: request every window now, as before jobs existed.
    const accessToken = await providerAccessToken(env, request, userId, provider.id);
    const anchorEnd = now();
    for (let index = 0; index < provider.backfill.windows; index += 1) await provider.requestBackfillWindow(accessToken, anchorEnd, index);
    return;
  }
  const work = runSyncJob(env, userId, provider.id, request);
  if (ctx?.waitUntil) ctx.waitUntil(work);
  else await work;
}

// Cron: retry jobs that still have windows to request.
export async function retryPendingSyncJobs(env) {
  let jobs;
  try { jobs = await listPendingSyncJobs(env); } catch (error) { if (isMissingTable(error)) return 0; throw error; }
  for (const job of jobs) await runSyncJob(env, job.user_id, job.provider);
  return jobs.length;
}

// A connection made before migration 0004 (or whose job row was lost) has no
// job, so nothing would ever retry its history. Start one the next time it is
// read; afterwards the row exists and this does nothing.
export async function ensureHistoryImport(env, request, provider, userId, ctx) {
  if (!provider.requestBackfillWindow) return;
  let job;
  try { job = await getSyncJob(env, userId, provider.id); } catch (error) { if (isMissingTable(error)) return; throw error; }
  if (!job) await startHistoryImport(env, request, provider, userId, ctx);
}

// Garmin can take a while to start sending after a connection; until then an
// empty history means "waiting", not "nothing there".
const NEW_CONNECTION_SECONDS = 24 * 60 * 60;

// What the client needs to decide whether to keep watching for arrivals.
export async function syncStatus(env, userId, providerId, { connectedAt } = {}) {
  const [job, stats] = await Promise.all([
    getSyncJob(env, userId, providerId).catch((error) => { if (isMissingTable(error)) return null; throw error; }),
    storedActivityStats(env, userId, providerId)
  ]);
  const current = now();
  const arriving = stats.lastReceivedAt && current - stats.lastReceivedAt < RECENT_ARRIVAL_SECONDS;
  let state = "idle";
  if (job?.status === "requesting") state = "importing";
  else if (job?.status === "failed") state = "failed";
  else if ((job && current - Number(job.updated_at) < ARRIVAL_GRACE_SECONDS) || arriving) state = "importing";
  else if (!stats.count && connectedAt && current - Number(connectedAt) < NEW_CONNECTION_SECONDS) state = "importing";
  return {
    state,
    windowsDone: Number(job?.windows_done) || 0,
    windowsTotal: Number(job?.windows_total) || 0,
    stored: stats.count,
    lastReceivedAt: stats.lastReceivedAt,
    error: job?.status === "failed" ? job.last_error : null,
    // Pass back as ?changed_since= to receive only what arrived since.
    cursor: stats.lastReceivedAt
  };
}
