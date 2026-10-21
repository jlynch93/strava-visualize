/* Workflow and persistence layer. Training calculations remain in training-core.js. */
function readSaved(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const savedPreferences = readSaved("run-trends-preferences", {});
const preferences = {
  units: savedPreferences?.units === "metric" ? "metric" : "imperial",
  weather: savedPreferences?.weather === true,
  rememberImports: savedPreferences?.rememberImports === true,
  analysisService: typeof savedPreferences?.analysisService === "string" ? savedPreferences.analysisService : ""
};
let acceptedPlans = readSaved("run-trends-plans-v1", {});
if (!acceptedPlans || typeof acceptedPlans !== "object" || Array.isArray(acceptedPlans)) acceptedPlans = {};
let historyCoverage = null;
const unitText = new WeakMap();
let activeView = "overview";
let selectedPlanOffset = 1;
let comparisonScope = "distance";
let pendingImport = null;

function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { setStatus("Browser storage is full or unavailable. Your changes remain in this tab; export a backup.", true); return false; }
}
function activeCheckin() { return TrainingCore.freshCheckin(coachingContext.checkin); }
function hasHistoryCoverage(start, end) {
  return Boolean(historyCoverage && start && end && start >= new Date(historyCoverage.start) && end <= new Date(historyCoverage.end));
}
function currentTrainingSummary() {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const start = new Date(end); start.setDate(start.getDate() - 27); start.setHours(0, 0, 0, 0);
  const runs = state.rawActivities.map(normalizeActivity).filter(isRun).filter((run) => parseActivityDate(run) >= start && parseActivityDate(run) <= end);
  const summary = summarize(runs, [], { start, end });
  const rampStart = TrainingCore.weekStart(end); rampStart.setDate(rampStart.getDate() - 28);
  summary.rampRate = hasHistoryCoverage(rampStart, new Date()) ? TrainingCore.rampRate(state.rawActivities.filter(isRun), rampStart, new Date(), parseActivityDate) : null;
  return summary;
}
function selectedPlanStart() {
  const start = TrainingCore.weekStart(new Date()); start.setDate(start.getDate() + selectedPlanOffset * 7); return start;
}
function adjustedPlanMiles(intent, target) { return target * (intent === "recover" ? .775 : intent === "build" ? 1.04 : .95); }
function planKey() { return localDateValue(selectedPlanStart()); }
function savePlans() { return persist("run-trends-plans-v1", acceptedPlans); }
function displayDistance(value, digits = 1) { return `${(value * (preferences.units === "metric" ? 1.609344 : 1)).toFixed(digits)} ${preferences.units === "metric" ? "km" : "mi"}`; }
function setView(view, focus = false) {
  activeView = ["overview", "runs", "planning"].includes(view) ? view : "overview";
  document.body.dataset.view = activeView;
  document.querySelectorAll("[data-view-section]").forEach((section) => {
    const hidden = section.dataset.viewSection !== activeView;
    section.hidden = hidden; section.inert = hidden;
  });
  document.querySelectorAll(".app-nav a").forEach((link) => {
    if (link.hash === `#${activeView}`) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
  if (focus) {
    const heading = document.querySelector(`#${activeView} h1, #${activeView} h2`);
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  if (activeView === "overview" && state.filteredRuns.length) renderMainChart();
}
function matchesRunFilter(run) {
  const filter = document.querySelector("#runTypeFilter")?.value || "all";
  const sport = String(run.sport_type).toLowerCase();
  return filter === "all" || (filter === "trail" && sport.includes("trail"))
    || (filter === "treadmill" && (run.trainer || sport.includes("virtual")))
    || (filter === "road" && !run.trainer && !sport.includes("trail") && !sport.includes("virtual"))
    || (filter === "race" && Number(run.workout_type) === 1)
    || (filter === "workout" && Number(run.workout_type) === 3);
}
function applyDisplayUnits(root = document.querySelector("#app")) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("script, style, input, textarea, [data-unit-skip], [data-native-units]")) continue;
    const old = unitText.get(node);
    const original = old && node.nodeValue === old.output ? old.original : node.nodeValue;
    let output = original;
    if (preferences.units === "metric") {
      output = output.replace(/([\d.]+)–([\d.]+)\s*mi\b/g, (_, low, high) => `${(Number(low) * 1.609344).toFixed(1)}–${(Number(high) * 1.609344).toFixed(1)} km`);
      output = output.replace(/(\d+):(\d{2})\/mi\b/g, (_, m, s) => {
        const seconds = Math.round((Number(m) * 60 + Number(s)) / 1.609344);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}/km`;
      });
      output = output.replace(/(-?[\d,]+(?:\.\d+)?)\s*°F\b/g, (_, n) => `${Math.round((Number(n.replaceAll(",", "")) - 32) * 5 / 9)}°C`);
      output = output.replace(/([\d,]+(?:\.\d+)?)\s*(ft\/mi|ft|sec\/mi|min\/mi|mph|mi|miles|in)\b/g, (_, n, unit) => {
        const value = Number(n.replaceAll(",", ""));
        const factor = { "ft/mi": .3048 / 1.609344, ft: .3048, "sec/mi": 1 / 1.609344, "min/mi": 1 / 1.609344, mph: 1.609344, mi: 1.609344, miles: 1.609344, in: 25.4 }[unit];
        const label = { "ft/mi": "m/km", ft: "m", "sec/mi": "sec/km", "min/mi": "min/km", mph: "km/h", mi: "km", miles: "km", in: "mm" }[unit];
        return `${(value * factor).toLocaleString(undefined, { maximumFractionDigits: unit === "in" ? 1 : 2 })} ${label}`;
      });
      output = output.replace(/\bMileage\b/g, "Distance").replace(/\bmileage\b/g, "distance").replace(/\bMiles\b/g, "Kilometers").replace(/\bmi\b/g, "km").replace(/\bft\b/g, "m");
    }
    unitText.set(node, { original, output });
    if (node.nodeValue !== output) node.nodeValue = output;
  }
}
function renderSyncInfo() {
  const count = state.rawActivities.length;
  const dates = count ? getActivityBounds() : null;
  document.querySelector("#syncInfo").textContent = count
    ? `${state.dataSource === "strava" ? "Strava" : state.dataSource === "demo" ? "Demo" : "Imported"} · ${count} activities · ${localDateValue(dates.start)} to ${localDateValue(dates.end)}${state.lastSync ? ` · Synced ${new Date(state.lastSync).toLocaleString()}` : ""}${state.historyTruncated ? " · Older history available" : ""}`
    : "Connect Strava or import your history to get started.";
  document.querySelector("#loadOlderButton").hidden = state.dataSource !== "strava" || !state.historyTruncated;
  document.querySelector("#fullSyncButton").hidden = !state.stravaConnected;
  document.querySelector("#removeSavedButton").hidden = !preferences.rememberImports;
}
function renderAcceptedPlan() {
  const plan = acceptedPlans[planKey()];
  const root = document.querySelector("#acceptedPlan"); root.replaceChildren();
  document.querySelector("#acceptPlanButton").disabled = !state.draftSessions?.length || Boolean(plan);
  document.querySelector("#acceptPlanButton").textContent = plan ? "Draft saved" : "Save this draft";
  document.querySelector("#replacePlanButton").hidden = !plan;
  els.copyPlanButton.disabled = !plan && !state.draftSessions?.length;
  els.copyPlanButton.textContent = plan ? "Copy saved plan" : "Copy draft";
  document.querySelector("#planWeekLabel").textContent = `Week of ${selectedPlanStart().toLocaleDateString()} · ${plan ? "Saved plan" : "Draft"}`;
  const draftReview = document.querySelector("#planDraftReview");
  if (draftReview) {
    draftReview.querySelector("summary").hidden = !plan;
    if (draftReview.dataset.week !== `${planKey()}:${Boolean(plan)}`) draftReview.open = !plan;
    draftReview.dataset.week = `${planKey()}:${Boolean(plan)}`;
    document.querySelector("#planDraftTitle").textContent = selectedPlanOffset === 1 ? "Next-week draft" : selectedPlanOffset === 0 ? "This week's draft" : `Draft for ${selectedPlanStart().toLocaleDateString()}`;
  }
  if (!plan?.sessions) return;
  const total = plan.sessions.reduce((sum, session) => sum + (session.kind === "run" ? Number(session.miles) || 0 : 0), 0);
  const summary = document.createElement("p"); summary.textContent = `Saved ${new Date(plan.savedAt).toLocaleDateString()} · ${displayDistance(total)} across ${plan.sessions.filter((session) => session.kind === "run").length} sessions. Edits stay with this week.`;
  root.append(summary);
  for (const [index, session] of plan.sessions.entries()) {
    const row = document.createElement("div"); row.className = "saved-session";
    const label = document.createElement("strong"); label.textContent = session.title;
    const date = document.createElement("input"); date.type = "date"; date.value = session.date; date.setAttribute("aria-label", `Reschedule ${session.title}`);
    date.addEventListener("change", () => { if (!date.value) return; session.date = date.value; session.matchedId = ""; savePlans(); renderAcceptedPlan(); });
    const distance = document.createElement("input"); distance.type = "number"; distance.min = "0"; distance.max = "500"; distance.step = ".1"; distance.value = (session.miles * (preferences.units === "metric" ? 1.609344 : 1)).toFixed(1); distance.disabled = session.kind !== "run";
    distance.setAttribute("aria-label", `${session.title} distance in ${preferences.units === "metric" ? "kilometers" : "miles"}`);
    distance.addEventListener("change", () => { if (!distance.checkValidity()) return; session.miles = Number(distance.value) / (preferences.units === "metric" ? 1.609344 : 1); savePlans(); renderAcceptedPlan(); });
    const unit = document.createElement("span"); unit.textContent = preferences.units === "metric" ? "km" : "mi";
    const status = document.createElement("select"); status.setAttribute("aria-label", `${session.title} status`);
    for (const value of ["planned", "completed", "skipped"]) status.add(new Option(value[0].toUpperCase() + value.slice(1), value));
    status.value = session.status;
    status.addEventListener("change", () => { session.status = status.value; if (status.value !== "completed") session.matchedId = ""; savePlans(); });
    const match = document.createElement("select"); match.setAttribute("aria-label", `Match activity to ${session.title}`); match.disabled = session.kind !== "run";
    match.add(new Option("Match a run (optional)", ""));
    const used = new Set(plan.sessions.filter((other) => other !== session).map((other) => other.matchedId).filter(Boolean));
    state.rawActivities.filter(isRun).filter((run) => !used.has(String(run.id)) && Math.abs(parseActivityDate(run) - new Date(`${session.date}T12:00:00`)) < 2 * 86400000).forEach((run) => match.add(new Option(`${localDateValue(parseActivityDate(run))} · ${run.name} · ${displayDistance(miles(run.distance))}`, String(run.id))));
    match.value = session.matchedId || "";
    match.addEventListener("change", () => { session.matchedId = match.value; if (match.value) session.status = "completed"; savePlans(); renderAcceptedPlan(); });
    row.append(label, date, distance, unit, status, match); root.append(row);
  }
}
function finishExperienceRender() {
  renderSyncInfo(); renderAcceptedPlan();
  const checkin = activeCheckin();
  document.querySelector("#checkinAge").textContent = checkin.savedAt ? `Checked in ${new Date(checkin.savedAt).toLocaleDateString()} · valid for 7 days` : "A fresh weekly check-in is needed. Older responses do not influence this plan.";
  const newest = state.rawActivities.filter(isRun).map(parseActivityDate).sort((a, b) => b - a)[0];
  const currentStart = new Date(); currentStart.setDate(currentStart.getDate() - 27); currentStart.setHours(0, 0, 0, 0);
  document.querySelector("#planningHistoryNote").textContent = !newest || new Date() - newest > 7 * 86400000 || !hasHistoryCoverage(currentStart, new Date()) ? "Your recent history is incomplete or over a week old. Sync or import recent runs before accepting a draft. Planning uses the current 28 days, independently of the review window." : "Planning uses the current 28 days, independently of the review window. Review the draft against your schedule.";
  setView(activeView); applyDisplayUnits();
}
let analysisConsentResolve = null;
async function ensureAnalysisConsent() {
  if (preferences.analysisService === state.analysisService && state.analysisService) return true;
  document.querySelector("#analysisServiceNote").textContent = `Analysis service: ${state.analysisService || "the configured Ollama service"}. Model: ${state.analysisModel || "configured model"}.`;
  document.querySelector("#analysisConsent").showModal();
  return new Promise((resolve) => { analysisConsentResolve = resolve; });
}
function startAnalysisTimer(controller, root = document.querySelector(".ai-insights-intro")) {
  root.querySelector(".analysis-progress")?.remove();
  const progress = document.createElement("div"); progress.className = "analysis-progress";
  const label = document.createElement("span"); label.setAttribute("role", "status");
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel analysis";
  cancel.addEventListener("click", () => controller.abort()); progress.append(label, cancel); root.append(progress);
  const start = Date.now(); const update = () => label.textContent = `Analyzing · ${Math.floor((Date.now() - start) / 1000)}s elapsed (up to 2 minutes)`;
  update(); const timer = setInterval(update, 1000);
  return () => { clearInterval(timer); progress.remove(); };
}
function finishModalRender(run) {
  document.querySelector("#workoutModalTitle").dataset.unitSkip = "";
  const select = document.querySelector("#comparisonScope");
  if (select) { select.value = comparisonScope; select.addEventListener("change", () => { comparisonScope = select.value; showWorkoutModal(run.id, state.modalTrigger); }); }
  const index = state.filteredRuns.findIndex((candidate) => String(candidate.id) === String(run.id));
  els.workoutModalContent.querySelector('[data-action="previous-run"]').disabled = index <= 0;
  els.workoutModalContent.querySelector('[data-action="next-run"]').disabled = index >= state.filteredRuns.length - 1;
  applyDisplayUnits(els.workoutModalContent);
}
async function hydrateRunDetail(run, session) {
  const root = document.querySelector("#enrichedRun");
  if (!root || state.dataSource !== "strava" || !/^\d+$/.test(String(run.id))) return;
  root.textContent = "Loading splits and activity details…";
  try {
    state.activityDetails ||= new Map();
    let activity = state.activityDetails.get(String(run.id));
    if (!activity) {
      const response = await fetch(`/api/activities/${encodeURIComponent(run.id)}`);
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Run details are unavailable.");
      activity = data.activity; state.activityDetails.set(String(run.id), activity);
    }
    if (session !== state.modalSession) return;
    root.replaceChildren();
    const splits = activity.splits_metric || activity.laps || [];
    const title = document.createElement("h3"); title.textContent = activity.splits_metric ? "Recorded kilometer splits" : "Recorded laps"; root.append(title);
    if (!splits.length) { root.append("No splits or laps were supplied by Strava."); return; }
    const table = document.createElement("table"); table.innerHTML = "<caption>Recorded splits from Strava</caption><thead><tr><th scope='col'>Split</th><th scope='col'>Distance</th><th scope='col'>Pace</th><th scope='col'>HR</th></tr></thead>";
    const body = document.createElement("tbody");
    splits.forEach((split, index) => {
      const row = document.createElement("tr");
      [String(index + 1), `${miles(split.distance).toFixed(2)} mi`, formatPace(split.distance ? (split.moving_time || split.elapsed_time) / miles(split.distance) : 0), split.average_heartrate ? `${Math.round(split.average_heartrate)} bpm` : "Unavailable"].forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); });
      body.append(row);
    });
    table.append(body); root.append(table); applyDisplayUnits(root);
  } catch (error) { if (session === state.modalSession) root.textContent = `${error.message} Your run summary is still available below.`; }
}
function requestImportReview(activities, skipped) {
  const dialog = document.querySelector("#importReview");
  document.querySelector("#importSummary").textContent = `${activities.length} valid activities; ${skipped} invalid rows skipped. ${activities.filter(isRun).length} running activities. ${activities.filter((run) => state.rawActivities.some((old) => String(old.id) === String(run.id))).length} existing activity IDs will be updated when merging.`;
  document.querySelector("#importMode").value = state.rawActivities.length && state.dataSource !== "demo" ? "merge" : "replace";
  dialog.showModal();
  return new Promise((resolve) => { pendingImport = resolve; });
}
function rememberHistory() {
  if (preferences.rememberImports && state.dataSource === "import") return persist("run-trends-import-v1", { activities: state.rawActivities, coverage: historyCoverage });
  return true;
}
function initializeExperience() {
  const app = document.querySelector("#app");
  app.insertAdjacentHTML("afterbegin", `<section class="settings-bar" aria-label="Preferences"><label>Units <select id="unitPreference"><option value="imperial">Miles / °F</option><option value="metric">Kilometers / °C</option></select></label><label><input id="weatherPreference" type="checkbox"> Modeled weather (shares rounded start location with Open-Meteo)</label><label><input id="rememberPreference" type="checkbox"> Remember imported history on this device</label><button id="removeSavedButton" type="button">Remove saved history</button><button id="backupContextButton" type="button">Back up goals and plans</button><label class="file-button">Restore goals and plans<input id="restoreContextInput" type="file" accept="application/json,.json"></label></section>`);
  const settings = document.querySelector(".settings-bar");
  const disclosure = document.createElement("details"); disclosure.className = "preferences-disclosure";
  disclosure.innerHTML = "<summary>Preferences and backups</summary>";
  document.querySelector(".app-header").after(disclosure); disclosure.append(settings);
  disclosure.insertAdjacentHTML("afterend", `<div class="sync-bar"><span id="syncInfo" role="status"></span><button id="loadOlderButton" type="button" hidden>Load older activities</button><button id="fullSyncButton" type="button" hidden>Refresh loaded history</button></div>`);
  const exploration = document.createElement("details"); exploration.className = "exploration data-panel"; exploration.dataset.viewSection = "overview"; exploration.innerHTML = "<summary>Explore patterns and supporting data</summary>";
  document.querySelector("#runs").before(exploration);
  document.querySelectorAll(".training-texture, .advanced-exploration, main > .dashboard").forEach((section) => exploration.append(section));
  exploration.addEventListener("toggle", () => { if (exploration.open && state.filteredRuns.length) { renderStructure(); renderHeatmap(); renderScatter(); renderRollingWorkload(); applyDisplayUnits(exploration); } });
  exploration.insertAdjacentHTML("afterbegin", '<section class="data-panel" aria-label="Additional training signals"><h2>Supporting metrics</h2><div id="supportingSignals" class="intel-grid"></div></section>');
  document.querySelectorAll("#overview, .key-runs, .analysis-row").forEach((section) => section.dataset.viewSection = "overview");
  document.querySelector("#planning").dataset.viewSection = "planning"; document.querySelector("#runs").dataset.viewSection = "runs";
  document.querySelector(".brand-lockup").addEventListener("click", () => setView("overview", true));
  document.querySelectorAll(".app-nav a").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); history.replaceState(null, "", `${location.pathname}${location.search}${link.hash}`); setView(link.hash.slice(1), true); }));
  activeView = ["planning", "runs"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  window.addEventListener("hashchange", () => setView(location.hash.slice(1), true));
  document.querySelector("#planning .panel-heading").insertAdjacentHTML("afterend", `<p id="planningHistoryNote" role="status"></p><div class="plan-controls"><button id="previousPlanWeek" type="button">Previous week</button><strong id="planWeekLabel"></strong><button id="nextPlanWeek" type="button">Next week</button><button id="acceptPlanButton" type="button">Save this draft</button><button id="replacePlanButton" type="button">Replace saved plan with draft</button></div><section id="acceptedPlan" data-native-units aria-label="Saved weekly plan"></section>`);
  document.querySelector("#coachingWorkspaceTitle").textContent = "Your training plan";
  document.querySelector(".plan-controls").append(els.copyPlanButton);
  const draftReview = document.createElement("details"); draftReview.id = "planDraftReview"; draftReview.open = true;
  draftReview.innerHTML = "<summary>Review a replacement draft</summary>";
  const draft = document.querySelector(".plan-draft"); draft.before(draftReview); draftReview.append(draft);
  document.querySelector("#checkinForm").insertAdjacentHTML("afterbegin", '<p id="checkinAge" role="status"></p>');
  document.querySelector("#checkinOutcome").insertAdjacentHTML("afterend", '<label for="missedReason">If missed, why?</label><select id="missedReason"><option value="fatigue">Fatigue / recovery</option><option value="schedule">Schedule / life</option><option value="other">Other / unsure</option></select>');
  document.querySelector("#readinessTitle").textContent = "Current training context";
  els.goalAvailability.hidden = true;
  const availability = document.createElement("fieldset"); availability.className = "day-toggles"; availability.innerHTML = "<legend>Available running days (none selected means any day)</legend>";
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) availability.insertAdjacentHTML("beforeend", `<label><input type="checkbox" value="${day}" ${String(coachingContext.goal.availability || "").toLowerCase().includes(day.toLowerCase()) ? "checked" : ""}>${day}</label>`);
  els.goalAvailability.after(availability); document.querySelector('label[for="goalAvailability"]').hidden = true;
  availability.addEventListener("change", () => els.goalAvailability.value = [...availability.querySelectorAll("input:checked")].map((input) => input.value).join(" "));
  document.querySelector(".ledger-controls").insertAdjacentHTML("beforeend", '<label class="control">Run type<select id="runTypeFilter"><option value="all">All runs</option><option value="road">Road / unspecified</option><option value="trail">Trail</option><option value="treadmill">Treadmill / virtual</option><option value="race">Race</option><option value="workout">Workout</option></select></label>');
  document.querySelector("#runTypeFilter").addEventListener("change", () => { state.ledgerPage = 0; renderTable(); saveViewState(); applyDisplayUnits(); });
  const help = document.createElement("details"); help.className = "metric-explanations";
  help.innerHTML = "<summary>How these metrics are calculated</summary><dl><dt>Weekly volume</dt><dd>Total distance divided by the selected number of calendar days, multiplied by seven. Quiet days count.</dd><dt>Ramp rate</dt><dd>Distance in the latest two complete Monday–Sunday weeks compared with the preceding two. Requires four complete weeks and does not change with chart grouping.</dd><dt>Running time</dt><dd>Total moving minutes, used consistently across all sources. Strava Relative Effort is a separate source field, not combined with this measure.</dd><dt>Longest-run share</dt><dd>The longest single run divided by the selected window's distance. Longest-fifth share uses the longest 20% of runs instead.</dd><dt>Heart-rate coverage</dt><dd>Percentage of runs with a recorded heart rate. Missing measurements are not zero.</dd><dt>Pace distribution</dt><dd>Distribution of each run's average pace, not time in physiological training zones.</dd><dt>Comparison history</dt><dd>Changes are shown only when the loaded history covers the complete preceding window. Mark an import complete only if its date range includes all activities.</dd></dl>";
  document.querySelector("#signals").append(help);
  document.body.insertAdjacentHTML("beforeend", `<dialog id="importReview" aria-labelledby="importReviewTitle"><h2 id="importReviewTitle">Review import</h2><p id="importSummary"></p><label>Existing history <select id="importMode"><option value="merge">Merge and update matching IDs</option><option value="replace">Replace current history</option></select></label><p><label><input id="importCoverage" type="checkbox"> This file contains all activities for its date range, including quiet days.</label></p><button id="confirmImportButton" type="button">Import activities</button><button id="cancelImportButton" type="button">Cancel</button></dialog><dialog id="analysisConsent" aria-labelledby="analysisConsentTitle"><h2 id="analysisConsentTitle">Send a training summary for analysis?</h2><p id="analysisServiceNote"></p><p>Only the summary and your question are sent. Run analysis excludes names and route coordinates. Window analysis includes optional goal/check-in context. Weather is a separate preference.</p><button id="allowAnalysisButton" type="button">Allow analysis</button><button id="cancelAnalysisConsent" type="button">Cancel</button></dialog>`);
  document.querySelector("#confirmImportButton").addEventListener("click", () => { const resolve = pendingImport; pendingImport = null; document.querySelector("#importReview").close(); resolve?.({ mode: document.querySelector("#importMode").value, complete: document.querySelector("#importCoverage").checked }); });
  const cancelImport = () => { const resolve = pendingImport; pendingImport = null; document.querySelector("#importReview").close(); resolve?.(null); };
  document.querySelector("#cancelImportButton").addEventListener("click", cancelImport);
  document.querySelector("#importReview").addEventListener("cancel", cancelImport);
  document.querySelector("#allowAnalysisButton").addEventListener("click", () => { preferences.analysisService = state.analysisService; persist("run-trends-preferences", preferences); document.querySelector("#analysisConsent").close(); analysisConsentResolve?.(true); analysisConsentResolve = null; });
  const cancelAnalysis = () => { document.querySelector("#analysisConsent").close(); analysisConsentResolve?.(false); analysisConsentResolve = null; };
  document.querySelector("#cancelAnalysisConsent").addEventListener("click", cancelAnalysis);
  document.querySelector("#analysisConsent").addEventListener("cancel", cancelAnalysis);
  document.querySelector("#unitPreference").value = preferences.units;
  document.querySelector("#weatherPreference").checked = preferences.weather;
  document.querySelector("#rememberPreference").checked = preferences.rememberImports;
  document.querySelector("#unitPreference").addEventListener("change", (event) => { preferences.units = event.target.value; persist("run-trends-preferences", preferences); syncCoachingInputs(); render(); if (state.activeRunId) showWorkoutModal(state.activeRunId, state.modalTrigger); });
  document.querySelector("#weatherPreference").addEventListener("change", (event) => { preferences.weather = event.target.checked; state.textureWeatherFingerprint = ""; persist("run-trends-preferences", preferences); render(); });
  document.querySelector("#rememberPreference").addEventListener("change", (event) => { preferences.rememberImports = event.target.checked; persist("run-trends-preferences", preferences); if (!preferences.rememberImports) localStorage.removeItem("run-trends-import-v1"); else rememberHistory(); renderSyncInfo(); });
  document.querySelector("#removeSavedButton").addEventListener("click", () => { localStorage.removeItem("run-trends-import-v1"); preferences.rememberImports = false; document.querySelector("#rememberPreference").checked = false; persist("run-trends-preferences", preferences); if (state.dataSource === "import") { state.rawActivities = []; historyCoverage = null; render(); } setStatus("Saved imported history removed from this device."); });
  document.querySelector("#loadOlderButton").addEventListener("click", () => fetchActivities("older").catch((error) => setStatus(error.message, true)));
  document.querySelector("#fullSyncButton").addEventListener("click", () => fetchActivities("full").catch((error) => setStatus(error.message, true)));
  document.querySelector("#previousPlanWeek").addEventListener("click", () => { selectedPlanOffset -= 1; render(); });
  document.querySelector("#nextPlanWeek").addEventListener("click", () => { selectedPlanOffset += 1; render(); });
  const accept = (replace) => {
    if (acceptedPlans[planKey()] && !replace) { setStatus("This week already has a saved plan. Use Replace saved plan with draft to replace it."); return; }
    if (!state.draftSessions?.length) return;
    acceptedPlans[planKey()] = { savedAt: new Date().toISOString(), sessions: structuredClone(state.draftSessions) };
    const saved = savePlans(); renderAcceptedPlan();
    setStatus(saved ? "Weekly plan saved. Changes to filters and goals will not rewrite it." : "This plan is available in this tab, but browser storage failed. Back up your goals and plans before closing the tab.", !saved);
  };
  document.querySelector("#acceptPlanButton").addEventListener("click", () => accept(false));
  document.querySelector("#replacePlanButton").addEventListener("click", () => { if (acceptedPlans[planKey()] && confirm("Replace this week's saved sessions and statuses with the current draft?")) accept(true); });
  els.workoutModal.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!["previous-run", "next-run"].includes(action)) return;
    const index = state.filteredRuns.findIndex((run) => String(run.id) === state.activeRunId);
    const run = state.filteredRuns[index + (action === "previous-run" ? -1 : 1)];
    if (run) showWorkoutModal(run.id, state.modalTrigger);
  });
  document.querySelector("#copyPlanButton").addEventListener("click", (event) => {
    const plan = acceptedPlans[planKey()]; if (!plan) return;
    event.stopImmediatePropagation();
    navigator.clipboard.writeText(plan.sessions.map((session) => `${session.date}: ${session.title} · ${displayDistance(session.miles)} · ${session.status}`).join("\n")).then(() => setStatus("Saved plan copied."), () => setStatus("Clipboard unavailable. Your saved plan remains visible.", true));
  }, true);
  document.querySelector("#backupContextButton").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, coachingContext, acceptedPlans }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "run-trends-goals-plans.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.querySelector("#restoreContextInput").addEventListener("change", async (event) => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 2_000_000) throw new Error("Choose a goals/plans backup smaller than 2 MB.");
      const input = JSON.parse(await file.text());
      if (input.version !== 1 || !input.coachingContext || !validPlans(input.acceptedPlans)) throw new Error("This is not a valid goals/plans backup.");
      if (!confirm("Restore these goals, check-ins, and saved plans, replacing the ones on this device?")) return;
      coachingContext = sanitizeCoachingContext(input.coachingContext); acceptedPlans = input.acceptedPlans;
      const contextSaved = saveCoachingContext(); const plansSaved = savePlans();
      syncCoachingInputs(); render(); setStatus(contextSaved && plansSaved ? "Goals and plans restored." : "Restored in this tab, but browser storage failed. Keep your backup before closing the tab.", !contextSaved || !plansSaved);
    } catch (error) { setStatus(error.message || "Unable to restore this backup.", true); }
    event.target.value = "";
  });
  if (!validPlans(acceptedPlans)) acceptedPlans = {};
  if (preferences.rememberImports) {
    const saved = readSaved("run-trends-import-v1", null);
    if (Array.isArray(saved?.activities)) {
      state.rawActivities = saved.activities.filter((value) => value && typeof value === "object" && !Array.isArray(value)).map(normalizeActivity).filter((run) => Number.isFinite(parseActivityDate(run).valueOf()));
      if (state.rawActivities.length) { state.dataSource = "import"; historyCoverage = saved.coverage && Number.isFinite(Date.parse(saved.coverage.start)) && Number.isFinite(Date.parse(saved.coverage.end)) ? saved.coverage : null; }
    }
  }
  // Localized text updates also cover asynchronously rendered weather and coach content.
  let unitQueued = false;
  new MutationObserver(() => { if (unitQueued) return; unitQueued = true; queueMicrotask(() => { unitQueued = false; applyDisplayUnits(); applyDisplayUnits(els.workoutModalContent); }); }).observe(document.body, { childList: true, characterData: true, subtree: true });
}
function validPlans(plans) {
  return plans && typeof plans === "object" && !Array.isArray(plans) && Object.entries(plans).every(([key, plan]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof plan?.savedAt === "string" && Number.isFinite(Date.parse(plan.savedAt)) && Array.isArray(plan.sessions) && plan.sessions.length <= 14 && plan.sessions.every((session) => session && typeof session.title === "string" && session.title.length <= 100 && /^\d{4}-\d{2}-\d{2}$/.test(session.date) && Number.isFinite(Date.parse(session.date)) && ["run", "rest"].includes(session.kind) && Number.isFinite(session.miles) && session.miles >= 0 && session.miles <= 500 && ["planned", "completed", "skipped"].includes(session.status)));
}
