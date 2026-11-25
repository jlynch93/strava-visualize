/* Workflow and persistence layer. Training calculations remain in training-core.js. */
function readSaved(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
// Each theme is a base (light or dark) and, optionally, a palette that recolours it (theme.css).
const THEMES = {
  light: { label: "Daylight", base: "light", paper: "#f2f6ef", accent: "#d6ef3d" },
  trail: { label: "Trail", base: "light", palette: "trail", paper: "#f7f1e4", accent: "#e9c04c" },
  dark: { label: "Midnight", base: "dark", paper: "#0d181c", accent: "#d6ef3d" },
  ember: { label: "Ember", base: "dark", palette: "ember", paper: "#1a1310", accent: "#f0a04b" },
  ocean: { label: "Ocean", base: "dark", palette: "ocean", paper: "#0a1326", accent: "#5fdce0" },
  synthwave: { label: "Synthwave", base: "dark", palette: "synthwave", paper: "#1a0b2e", accent: "#ff6ec7" },
  terminal: { label: "Terminal", base: "dark", palette: "terminal", paper: "#050d08", accent: "#4dfa6b" },
  broadsheet: { label: "Broadsheet", base: "light", palette: "broadsheet", paper: "#f6e4d2", accent: "#7a1b2b" },
  blossom: { label: "Blossom", base: "light", palette: "blossom", paper: "#fbeef3", accent: "#f08fb4" },
  blueprint: { label: "Blueprint", base: "dark", palette: "blueprint", paper: "#14357f", accent: "#f4e04d" },
  aurora: { label: "Aurora ✦", base: "dark", palette: "aurora", paper: "#0b0a1a", accent: "#a78bfa" },
  studio: { label: "Studio ◧", base: "light", palette: "studio", paper: "#f2f1ed", accent: "#ff6a3d" }
};
function sanitizePreferences(saved) {
  return {
    units: saved?.units === "metric" ? "metric" : "imperial",
    weather: saved?.weather === true,
    rememberImports: saved?.rememberImports === true,
    analysisService: typeof saved?.analysisService === "string" ? saved.analysisService : "",
    theme: Object.hasOwn(THEMES, saved?.theme) ? saved.theme : "system"
  };
}
const preferences = sanitizePreferences(readSaved("run-trends-preferences", {}));
function applyTheme() {
  const root = document.documentElement, theme = THEMES[preferences.theme];
  if (theme) root.dataset.theme = theme.base; else delete root.dataset.theme;
  if (theme?.palette) root.dataset.palette = theme.palette; else delete root.dataset.palette;
  // The browser and status-bar tint follows the chosen theme, not the system.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.dataset.system ??= meta.content;
    meta.content = theme ? theme.paper : meta.dataset.system;
  });
}
applyTheme();
let acceptedPlans = readSaved("run-trends-plans-v1", {});
if (!acceptedPlans || typeof acceptedPlans !== "object" || Array.isArray(acceptedPlans)) acceptedPlans = {};
let historyCoverage = null;
const unitText = new WeakMap();
let activeView = "overview";
let selectedPlanOffset = 1;
let comparisonScope = "distance";
let pendingImport = null;
let feedbackScopeId = null;

function actionFeedback(message, isError, scopeId = feedbackScopeId) {
  const host = scopeId ? document.getElementById(scopeId) : null;
  if (!host || (host.matches(".action-feedback") ? host.parentElement.offsetParent === null : host.offsetParent === null)) return false;
  let note = host.matches(".action-feedback") ? host : host.querySelector(":scope > .action-feedback");
  if (!note) { note = document.createElement("p"); note.className = "action-feedback"; host.append(note); }
  note.setAttribute("role", isError ? "alert" : "status");
  note.classList.toggle("error", isError);
  note.textContent = message;
  note.hidden = !message;
  return Boolean(message);
}

function persist(key, value) {
  queueAccountSave(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch {
    if (accountSync.enabled && SYNCED_STORAGE_KEYS.includes(key)) return true;
    setStatus("Browser storage is full or unavailable. Your changes remain in this tab; export a backup.", true); return false;
  }
}

/* Account sync: when signed in, goals, check-ins, saved plans, the fitness
   profile and preferences are saved to the account and follow the runner to
   other devices. The account copy wins when both exist; a device's existing
   settings are uploaded the first time it signs in. Imports stay local. */
const SYNCED_STORAGE_KEYS = ["run-trends-preferences", "run-trends-plans-v1", "run-trends-coaching-context-v1", "run-trends-athlete-v1"];
const accountSync = { enabled: false, timers: new Map(), failed: false };

function queueAccountSave(key, value) {
  if (!accountSync.enabled || !SYNCED_STORAGE_KEYS.includes(key)) return;
  clearTimeout(accountSync.timers.get(key));
  accountSync.timers.set(key, setTimeout(() => saveToAccount(key, value), 500));
}

async function saveToAccount(key, value) {
  accountSync.timers.delete(key);
  try {
    const response = await fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value)
    });
    if (response.status === 401) { accountSync.enabled = false; return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (accountSync.failed) { accountSync.failed = false; setStatus("Your settings are saved to your account again."); }
  } catch {
    accountSync.failed = true;
    setStatus("Couldn't save that change to your account. It's kept on this device and will sync with your next change.", true);
  }
}

function applySyncedValue(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The in-memory copy still applies. */ }
  if (key === "run-trends-preferences") {
    Object.assign(preferences, sanitizePreferences(value));
    applyTheme();
    const controls = { unitPreference: preferences.units };
    const themeInput = document.querySelector(`#themePreference input[value="${preferences.theme}"]`); if (themeInput) themeInput.checked = true;
    for (const [id, setting] of Object.entries(controls)) { const control = document.getElementById(id); if (control) control.value = setting; }
    const weather = document.getElementById("weatherPreference"); if (weather) weather.checked = preferences.weather;
  } else if (key === "run-trends-plans-v1") {
    acceptedPlans = validPlans(value) ? value : {};
  } else if (key === "run-trends-coaching-context-v1") {
    coachingContext = sanitizeCoachingContext(value);
    adoptLegacyProfile();
    syncCoachingInputs();
  } else if (key === "run-trends-athlete-v1") {
    athleteProfile = sanitizeAthleteProfile(value);
    fitnessModelCache.key = "";
  }
}

async function syncAccountState() {
  const response = await fetch("/api/state");
  if (!response.ok) { accountSync.enabled = false; return; }
  const { state: remote = {} } = await response.json();
  accountSync.enabled = true;
  for (const key of SYNCED_STORAGE_KEYS) {
    if (remote[key]) applySyncedValue(key, remote[key].value);
    else {
      const local = readSaved(key, null);
      if (local && typeof local === "object") queueAccountSave(key, local);
    }
  }
  if (Object.keys(remote).length) render();
}

// Signing out or deleting the account removes the account's goals, plans and
// fitness profile from this browser, so a shared computer doesn't keep the
// previous runner's data. Display preferences (theme, units) stay on the device.
function clearSyncedSettings() {
  accountSync.enabled = false;
  for (const timer of accountSync.timers.values()) clearTimeout(timer);
  accountSync.timers.clear();
  for (const key of SYNCED_STORAGE_KEYS.filter((item) => item !== "run-trends-preferences")) {
    try { localStorage.removeItem(key); } catch { /* Storage unavailable. */ }
  }
  acceptedPlans = {};
  coachingContext = sanitizeCoachingContext(null);
  athleteProfile = sanitizeAthleteProfile(null);
  fitnessModelCache.key = "";
  syncCoachingInputs();
  render();
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
  activeView = ["overview", "fitness", "runs", "planning"].includes(view) ? view : "overview";
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
  if (activeView === "overview" && state.rawActivities.length) renderThisWeek(fitnessModel());
  if (activeView === "fitness") renderFitness();
}
function matchesRunFilter(run) {
  const filter = document.querySelector("#runTypeFilter")?.value || "all";
  const sport = String(run.sport_type).toLowerCase();
  return filter === "all" || (filter === "trail" && sport.includes("trail"))
    || (filter === "treadmill" && (run.trainer || sport.includes("virtual")))
    || (filter === "road" && !run.trainer && !sport.includes("trail") && !sport.includes("virtual"))
    || (filter === "race" && Number(run.workout_type) === 1)
    || (filter === "workout" && Number(run.workout_type) === 3)
    || (["easy", "long", "quality"].includes(filter) && runType(run).group === filter);
}
function applyDisplayUnits(root = document.querySelector("#app")) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("script, style, input, textarea, [data-unit-skip], [data-native-units]")) continue;
    const walkWords = state.activityMode === "walk" && !node.parentElement?.closest("[data-mode-skip], #fitness, #planning, .app-footer, .brand-lockup, select");
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
      output = output.replace(/(\d[\d,]*(?:\.\d+)?)\s*(ft\/mi|ft|sec\/mi|min\/mi|mph|mi|miles|in)\b/g, (_, n, unit) => {
        const value = Number(n.replaceAll(",", ""));
        const factor = { "ft/mi": .3048 / 1.609344, ft: .3048, "sec/mi": 1 / 1.609344, "min/mi": 1 / 1.609344, mph: 1.609344, mi: 1.609344, miles: 1.609344, in: 25.4 }[unit];
        const label = { "ft/mi": "m/km", ft: "m", "sec/mi": "sec/km", "min/mi": "min/km", mph: "km/h", mi: "km", miles: "km", in: "mm" }[unit];
        return `${(value * factor).toLocaleString(undefined, { maximumFractionDigits: unit === "in" || unit === "min/mi" ? 1 : unit === "sec/mi" ? 0 : 2 })} ${label}`;
      });
      output = output.replace(/\bMileage\b/g, "Distance").replace(/\bmileage\b/g, "distance").replace(/\bMiles\b/g, "Kilometers").replace(/\bmi\b/g, "km").replace(/\bft\b/g, "m");
    }
    // Walk mode reviews walks through the same views; the words follow the data.
    if (walkWords) {
      output = output.replace(/\bRunning\b/g, "Walking").replace(/\brunning\b/g, "walking")
        .replace(/\bRuns\b/g, "Walks").replace(/\bruns\b/g, "walks").replace(/\bRun\b/g, "Walk").replace(/\brun\b/g, "walk");
    }
    unitText.set(node, { original, output });
    if (node.nodeValue !== output) node.nodeValue = output;
  }
}
function renderSyncInfo() {
  const count = state.rawActivities.length;
  const dates = count ? getActivityBounds() : null;
  document.querySelector("#syncInfo").textContent = count
    ? `${isProviderSource() ? providerName(state.dataSource) : state.dataSource === "demo" ? "Demo" : "Imported"} · ${count} activities · ${localDateValue(dates.start)} to ${localDateValue(dates.end)}${state.lastSync ? ` · Synced ${new Date(state.lastSync).toLocaleString()}` : ""}${state.historyTruncated ? " · Older history available" : ""}`
    : "Sign in with Strava or Garmin, or import your history, to get started.";
  document.querySelector("#loadOlderButton").hidden = !isProviderSource() || !state.historyTruncated;
  document.querySelector("#fullSyncButton").hidden = !hasProviderConnection();
  document.querySelector("#removeSavedButton").hidden = !preferences.rememberImports;
  const source = isProviderSource() ? providerName(state.dataSource) : state.dataSource === "import" ? "Imported history" : state.dataSource === "demo" ? "Demo history" : "No history loaded";
  // While a provider is still sending history, say so instead of "Synced".
  const importing = state.importStatus?.state === "importing" && state.importStatus.provider === state.dataSource;
  const sourceStatus = document.querySelector("#sourceStatus");
  sourceStatus.classList.toggle("is-importing", importing);
  sourceStatus.textContent = importing
    ? `${source} · Importing history… ${count.toLocaleString()} so far`
    : `${source}${state.lastSync ? ` · Synced ${new Date(state.lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`;
  const demoParent = isProviderSource() || state.dataSource === "import" ? document.querySelector("#dataMenuActions") : document.querySelector(".header-actions .actions");
  if (els.demoButton.parentElement !== demoParent) demoParent.append(els.demoButton);
  els.demoButton.hidden = state.dataSource === "demo";
  const connectParent = state.dataSource === "import" ? document.querySelector("#dataMenuActions") : document.querySelector(".header-actions .actions");
  if (els.connectButton.parentElement !== connectParent) connectParent.prepend(els.connectButton);
}
/* ---------- The week board: one editable week, saved as you edit ---------- */

const PLAN_STATUS_LABELS = { planned: "Planned", completed: "Done", skipped: "Skipped" };
let dayEditorDate = "";

// The week on screen: the saved plan, or the suggested draft until the first edit.
function weekSessions() { return acceptedPlans[planKey()]?.sessions || state.draftSessions || []; }
function weekDates() {
  const start = selectedPlanStart();
  return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return localDateValue(date); });
}
function sessionOn(sessions, date) {
  return sessions.find((session) => session.date === date) || { date, ...TrainingCore.retypeSession({ date, kind: "rest", miles: 0, status: "planned", matchedId: "" }, "rest") };
}
// One session per day of the week, as the board shows it: the first saved on
// each date, or a rest day.
function boardSessions(sessions) { return weekDates().map((date) => sessionOn(sessions, date)); }
function dayLabel(date, options = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options);
}
// Every edit goes through here: the draft becomes the saved plan on the first
// change, and each change is stored straight away.
function editWeek(change) {
  const key = planKey();
  const current = weekSessions();
  if (!current.length) return false;
  const filled = boardSessions(current);
  // Sessions the board cannot show (another week's date, or a second session on
  // one day from plans saved before the board) are kept, never dropped.
  const sessions = change(structuredClone(filled.concat(current.filter((session) => !filled.includes(session)))));
  acceptedPlans[key] = { savedAt: acceptedPlans[key]?.savedAt || new Date().toISOString(), editedAt: new Date().toISOString(), sessions };
  const saved = savePlans();
  if (!saved) setStatus("Updated in this tab. Browser storage failed; back up the plan before closing.", true);
  renderAcceptedPlan();
  return saved;
}
function replaceSession(date, update) {
  return editWeek((sessions) => sessions.map((session) => (session.date === date ? update(session, sessions) : session)));
}

function renderAcceptedPlan() {
  const plan = acceptedPlans[planKey()];
  const sessions = weekSessions();
  document.querySelector("#planStart").hidden = Boolean(Object.keys(coachingContext.goal).length || plan);
  document.querySelector("#planProgress").textContent = plan
    ? "Your plan for this week. Select a day to change it; changes save as you make them."
    : Object.keys(coachingContext.goal).length ? "A suggested week from your goal and recent training. Select any day to change it." : "Start with availability and a weekly goal, or select any day to change the suggested week.";
  const keep = document.querySelector("#acceptPlanButton");
  keep.hidden = Boolean(plan); keep.disabled = !sessions.length;
  document.querySelector("#resetPlanButton").hidden = !plan;
  els.copyPlanButton.disabled = !sessions.length;
  els.copyPlanButton.textContent = plan ? "Copy plan" : "Copy draft";
  document.querySelector("#planWeekLabel").textContent = `Week of ${selectedPlanStart().toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${plan ? "Your plan" : "Suggested"}`;
  document.querySelector("#planDraftTitle").textContent = selectedPlanOffset === 1 ? "Next week" : selectedPlanOffset === 0 ? "This week" : `Week of ${selectedPlanStart().toLocaleDateString()}`;
  const board = els.recommendedCalendar;
  const totals = document.querySelector("#planWeekTotals");
  if (!sessions.length) { board.replaceChildren(); totals.textContent = ""; return; }
  const today = localDateValue(new Date());
  const dates = weekDates();
  board.innerHTML = `<ol class="week-board" aria-label="${plan ? "Your plan" : "Suggested plan"}, week of ${escapeHtml(dayLabel(dates[0], { month: "long", day: "numeric" }))}">${dates.map((date) => {
    const session = sessionOn(sessions, date);
    const type = TrainingCore.sessionType(session);
    const run = session.kind === "run";
    const status = PLAN_STATUS_LABELS[session.status] || "Planned";
    const distance = run ? displayDistance(session.miles) : "Rest";
    const label = `${dayLabel(date, { weekday: "long", month: "short", day: "numeric" })}: ${session.title}, ${distance}${run ? `, ${status.toLowerCase()}` : ""}. Edit`;
    return `<li class="plan-day type-${type} status-${escapeHtml(session.status)}${date === today ? " is-today" : ""}" data-date="${date}" data-kind="${run ? "run" : "rest"}" draggable="true">
      <button type="button" class="plan-day-open" data-action="edit-day" aria-label="${escapeHtml(label)}"><span class="plan-day-name">${escapeHtml(dayLabel(date, { weekday: "short" }))}</span><time datetime="${date}">${escapeHtml(dayLabel(date, { month: "short", day: "numeric" }))}</time><strong>${escapeHtml(session.title)}</strong><span class="plan-day-distance">${escapeHtml(distance)}</span><small>${escapeHtml(session.detail || "")}</small></button>
      ${run ? `<button type="button" class="plan-day-done" data-action="toggle-done" aria-pressed="${session.status === "completed"}" aria-label="${escapeHtml(`${session.title} on ${dayLabel(date, { weekday: "long" })} done`)}">${session.status === "completed" ? "✓ Done" : session.status === "skipped" ? "Skipped" : "Mark done"}</button>` : ""}
    </li>`;
  }).join("")}</ol>`;
  const shown = boardSessions(sessions);
  const outside = sessions.filter((session) => !shown.includes(session));
  const sum = TrainingCore.weekTotals(shown);
  totals.textContent = `${displayDistance(sum.miles)} across ${sum.runs} run${sum.runs === 1 ? "" : "s"}${sum.completedRuns ? ` · ${sum.completedRuns} done (${displayDistance(sum.completedMiles)})` : ""}${sum.skippedRuns ? ` · ${sum.skippedRuns} skipped` : ""}${outside.length ? ` · also saved, not on the board: ${outside.map((session) => `${session.title} ${dayLabel(session.date)}`).join(", ")}` : ""}`;
  if (document.querySelector("#dayEditor")?.open) renderDayEditor(dayEditorDate);
}

function openDayEditor(date) {
  dayEditorDate = date;
  renderDayEditor(date);
  const dialog = document.querySelector("#dayEditor");
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("input[name=dayType]:checked")?.focus();
}

function renderDayEditor(date, focus) {
  const sessions = weekSessions();
  const session = sessionOn(sessions, date);
  const type = TrainingCore.sessionType(session);
  const run = session.kind === "run";
  const metric = preferences.units === "metric";
  const unit = metric ? "km" : "mi";
  const shown = (Number(session.miles) * (metric ? 1.609344 : 1)).toFixed(1);
  document.querySelector("#dayEditorTitle").textContent = dayLabel(date, { weekday: "long", month: "long", day: "numeric" });
  const used = new Set(sessions.filter((other) => other.date !== date).map((other) => other.matchedId).filter(Boolean));
  const nearby = state.rawActivities.filter(isRun).filter((activity) => !used.has(String(activity.id)) && Math.abs(parseActivityDate(activity) - new Date(`${date}T12:00:00`)) < 1.5 * 86400000);
  const types = Object.entries(TrainingCore.SESSION_TYPES).map(([value, spec]) => `<label class="type-chip-option type-${value}"><input type="radio" name="dayType" value="${value}"${value === type ? " checked" : ""}><span>${spec.label}</span></label>`).join("");
  const statuses = Object.entries(PLAN_STATUS_LABELS).map(([value, label]) => `<label><input type="radio" name="dayStatus" value="${value}"${value === session.status ? " checked" : ""}><span>${label}</span></label>`).join("");
  const moves = weekDates().filter((other) => other !== date).map((other) => `<option value="${other}">${escapeHtml(dayLabel(other))} · swap with ${escapeHtml(sessionOn(sessions, other).title)}</option>`).join("");
  document.querySelector("#dayEditorBody").innerHTML = `
    <fieldset class="day-editor-types"><legend>Session</legend>${types}</fieldset>
    ${run ? `<div class="day-editor-distance"><label for="dayMiles">Distance (${unit})</label><div class="stepper"><button type="button" data-step="-0.5" aria-label="0.5 ${unit} less">−</button><input id="dayMiles" type="number" inputmode="decimal" min="0" max="160" step="0.1" value="${shown}"><button type="button" data-step="0.5" aria-label="0.5 ${unit} more">+</button></div></div>
    <fieldset class="day-editor-status"><legend>Status</legend>${statuses}</fieldset>
    <label class="day-editor-match">Recorded run<select id="dayMatch"><option value="">${nearby.length ? "Match a run (optional)" : "No runs recorded near this day"}</option>${nearby.map((activity) => `<option value="${escapeHtml(String(activity.id))}"${String(activity.id) === session.matchedId ? " selected" : ""}>${escapeHtml(`${dayLabel(localDateValue(parseActivityDate(activity)))} · ${activity.name || "Run"} · ${displayDistance(miles(activity.distance))}`)}</option>`).join("")}</select></label>` : ""}
    <label class="day-editor-move">Move to another day<select id="dayMove"><option value="">Keep on ${escapeHtml(dayLabel(date, { weekday: "long" }))}</option>${moves}</select></label>`;
  if (focus) document.querySelector(`#dayEditorBody ${focus}`)?.focus();
}

/* ---------- Plan in your calendar ---------- */

// A signed-in runner gets a secret link (src/calendar.js) that Apple Calendar,
// Google Calendar and others subscribe to; it serves the saved weeks and races
// and follows every change on their next refresh. Anyone can download a file.
const planCalendar = { url: null, loaded: false, busy: false, error: "" };
const CALENDAR_HISTORY_DAYS = 56;

function calendarLinks(url) {
  const webcal = url.replace(/^https?:/, "webcal:");
  return { webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

async function calendarRequest(method) {
  planCalendar.busy = true; planCalendar.error = ""; renderPlanCalendar();
  try {
    const response = await fetch("/api/calendar", { method });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The calendar link could not be ${method === "DELETE" ? "removed" : "loaded"} (HTTP ${response.status}).`);
    planCalendar.url = data.url || null; planCalendar.loaded = true;
    if (data.unreadable) planCalendar.error = "Your existing link can't be shown any more. Make a new link and add it to your calendar again.";
  } catch (error) {
    planCalendar.error = error.message;
  } finally {
    planCalendar.busy = false; renderPlanCalendar();
  }
}

function downloadPlanCalendar() {
  const since = new Date(Date.now() - CALENDAR_HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  const ics = CalendarCore.buildPlanCalendar({ plans: acceptedPlans, races: raceList(), units: preferences.units, since, domain: location.hostname || "runlore.app" });
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const link = document.createElement("a"); link.href = url; link.download = "runlore-plan.ics"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const saved = Object.keys(acceptedPlans).length;
  setStatus(saved ? "Calendar file downloaded. It is a snapshot: download again after changing the plan, or sign in for a link that updates." : "Calendar file downloaded with your races. Save a week (edit a day or Keep this plan) to add its runs.");
}

function renderPlanCalendar() {
  const card = document.querySelector("#planCalendarCard");
  if (!card) return;
  const signedIn = Boolean(state.account?.signedIn);
  const download = '<button type="button" class="link-action" data-calendar="download">Download a calendar file (.ics)</button>';
  if (!signedIn) {
    // Forget the last account's link, so another sign-in never shows it.
    Object.assign(planCalendar, { url: null, loaded: false, error: "" });
    card.innerHTML = `<p>Sign in to get a calendar link that Apple Calendar or Google Calendar keeps up to date as you change your plan.</p><p>${download}</p><p class="context-muted">The file is a snapshot of your saved weeks and races on this device; it won't follow later changes.</p>`;
    return;
  }
  if (!planCalendar.loaded && !planCalendar.busy && !planCalendar.error) { calendarRequest("GET"); return; }
  const error = planCalendar.error ? `<p class="plan-calendar-error" role="alert">${escapeHtml(planCalendar.error)}</p>` : "";
  if (planCalendar.busy) { card.innerHTML = '<p class="context-muted" role="status">Working on your calendar link…</p>'; return; }
  if (!planCalendar.url) {
    card.innerHTML = `<p>Show your saved weeks and races in your own calendar. Changes you make here appear there the next time it refreshes.</p>${error}<button type="button" class="context-save" data-calendar="create">Create calendar link</button><p>${download}</p><p class="context-muted">The file is a one-off snapshot; the link keeps up with your changes.</p>`;
    return;
  }
  const { webcal, google } = calendarLinks(planCalendar.url);
  card.innerHTML = `${error}<div class="plan-calendar-actions">
      <a class="calendar-add" href="${escapeHtml(webcal)}">Add to Apple Calendar</a>
      <a class="calendar-add" href="${escapeHtml(google)}" target="_blank" rel="noopener noreferrer">Add to Google Calendar<span class="visually-hidden"> (opens in a new tab)</span></a>
    </div>
    <label class="plan-calendar-url">Calendar link (Outlook and other apps: subscribe from a URL)<span><input id="planCalendarUrl" type="text" readonly value="${escapeHtml(planCalendar.url)}"><button type="button" data-calendar="copy">Copy</button></span></label>
    <ul class="plan-calendar-notes">
      <li>Saved weeks and races appear as all-day events; rest days are left out. A suggested week appears once you edit a day or choose <strong>Keep this plan</strong>.</li>
      <li>Calendars refresh on their own schedule: Apple Calendar about hourly (you can change it in its settings), Google Calendar can take up to a day.</li>
      <li>Anyone with this link can see your plan. If it gets shared by mistake, make a new link: the old one stops working.</li>
    </ul>
    <p class="plan-calendar-manage"><button type="button" class="link-action" data-calendar="rotate">Make a new link</button> · <button type="button" class="link-action danger" data-calendar="delete">Stop sharing</button> · ${download}</p>`;
}

function setupPlanCalendar() {
  const grid = document.querySelector("#planning .coaching-grid");
  if (!grid) return;
  grid.insertAdjacentHTML("beforeend", '<details id="planCalendarDisclosure" class="context-disclosure"><summary>Calendar<span>Show your plan in Apple or Google Calendar</span></summary><div id="planCalendarCard" class="context-card plan-calendar"></div></details>');
  const disclosure = document.querySelector("#planCalendarDisclosure");
  disclosure.addEventListener("toggle", () => { if (disclosure.open) renderPlanCalendar(); });
  disclosure.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-calendar]")?.dataset.calendar;
    if (!action) return;
    if (action === "download") downloadPlanCalendar();
    if (action === "create") await calendarRequest("POST");
    if (action === "rotate" && confirm("Make a new calendar link? The current link stops working, so calendars subscribed to it need the new one.")) await calendarRequest("POST");
    if (action === "delete" && confirm("Stop sharing your plan as a calendar? Calendars subscribed to the link stop updating, and their copy of the plan may disappear.")) await calendarRequest("DELETE");
    if (action === "copy") {
      try { await navigator.clipboard.writeText(planCalendar.url); setStatus("Calendar link copied."); }
      catch { document.querySelector("#planCalendarUrl")?.select(); setStatus("Copy isn't available here; the link is selected so you can copy it.", true); }
    }
    if (["create", "rotate", "delete"].includes(action)) document.querySelector("#planCalendarCard button, #planCalendarCard a")?.focus();
  });
}

function setupWeekBoard() {
  const controls = document.querySelector(".plan-controls");
  // The week sits right under its controls, ahead of the goal, race and check-in setup.
  controls.after(document.querySelector(".plan-draft"));
  document.querySelector("#acceptPlanButton").textContent = "Keep this plan";
  controls.insertAdjacentHTML("beforeend", '<button id="resetPlanButton" type="button" hidden>Reset to suggestion</button>');
  els.recommendedCalendar.insertAdjacentHTML("afterend", '<p id="planWeekTotals" class="plan-week-totals" role="status"></p>');
  document.body.insertAdjacentHTML("beforeend", `<dialog id="dayEditor" class="day-editor" aria-labelledby="dayEditorTitle"><form method="dialog"><header><h2 id="dayEditorTitle"></h2><button type="submit" class="day-editor-close" aria-label="Close">×</button></header><div id="dayEditorBody"></div><p id="dayEditorSaved" class="day-editor-saved" role="status"></p><button type="submit" class="day-editor-done">Done</button></form></dialog>`);
  const dialog = document.querySelector("#dayEditor");
  const saved = (ok) => { document.querySelector("#dayEditorSaved").textContent = ok ? "Saved" : "Saved in this tab only: browser storage failed"; };
  dialog.addEventListener("change", (event) => {
    const target = event.target;
    if (target.name === "dayType") { saved(replaceSession(dayEditorDate, (session, sessions) => TrainingCore.retypeSession(session, target.value, sessions, { race: raceList().find((race) => race.date === dayEditorDate) }))); renderDayEditor(dayEditorDate, `input[name=dayType][value="${target.value}"]`); }
    else if (target.name === "dayStatus") { saved(replaceSession(dayEditorDate, (session) => ({ ...session, status: target.value, matchedId: target.value === "completed" ? session.matchedId : "" }))); renderDayEditor(dayEditorDate, `input[name=dayStatus][value="${target.value}"]`); }
    else if (target.id === "dayMiles") { saved(replaceSession(dayEditorDate, (session) => TrainingCore.setSessionMiles(session, Number(target.value) / (preferences.units === "metric" ? 1.609344 : 1)))); }
    else if (target.id === "dayMatch") { saved(replaceSession(dayEditorDate, (session) => ({ ...session, matchedId: target.value, status: target.value ? "completed" : session.status }))); renderDayEditor(dayEditorDate, "#dayMatch"); }
    else if (target.id === "dayMove" && target.value) {
      const to = target.value;
      saved(editWeek((sessions) => TrainingCore.moveSession(sessions, dayEditorDate, to)));
      dayEditorDate = to; renderDayEditor(to, "#dayMove");
    }
  });
  dialog.addEventListener("click", (event) => {
    const step = event.target.closest("[data-step]");
    if (!step) return;
    const input = dialog.querySelector("#dayMiles");
    input.value = Math.max(0, Number(input.value || 0) + Number(step.dataset.step)).toFixed(1);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    dialog.querySelector(`[data-step="${step.dataset.step}"]`)?.focus();
  });
  dialog.addEventListener("close", () => {
    document.querySelector("#dayEditorSaved").textContent = "";
    els.recommendedCalendar.querySelector(`[data-date="${dayEditorDate}"] .plan-day-open`)?.focus();
  });
  els.recommendedCalendar.addEventListener("click", (event) => {
    const day = event.target.closest(".plan-day");
    if (!day) return;
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "edit-day") openDayEditor(day.dataset.date);
    if (action === "toggle-done") {
      replaceSession(day.dataset.date, (session) => ({ ...session, status: session.status === "completed" ? "planned" : "completed" }));
      els.recommendedCalendar.querySelector(`[data-date="${day.dataset.date}"] .plan-day-done`)?.focus();
    }
  });
  // Drag a day onto another to swap them (the editor's "Move to" does the same without a mouse).
  let dragging = "";
  els.recommendedCalendar.addEventListener("dragstart", (event) => { const day = event.target.closest(".plan-day"); if (!day) return; dragging = day.dataset.date; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", dragging); day.classList.add("is-dragging"); });
  els.recommendedCalendar.addEventListener("dragover", (event) => { const day = event.target.closest(".plan-day"); if (!day || !dragging) return; event.preventDefault(); els.recommendedCalendar.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target")); if (day.dataset.date !== dragging) day.classList.add("drop-target"); });
  els.recommendedCalendar.addEventListener("drop", (event) => { const day = event.target.closest(".plan-day"); if (!day || !dragging) return; event.preventDefault(); const from = dragging; dragging = ""; if (day.dataset.date !== from) editWeek((sessions) => TrainingCore.moveSession(sessions, from, day.dataset.date)); });
  els.recommendedCalendar.addEventListener("dragend", () => { dragging = ""; els.recommendedCalendar.querySelectorAll(".drop-target, .is-dragging").forEach((node) => node.classList.remove("drop-target", "is-dragging")); });
  document.querySelector("#resetPlanButton").addEventListener("click", () => {
    if (!acceptedPlans[planKey()] || !confirm("Reset this week to the suggested plan? Your changes and statuses for this week are removed.")) return;
    delete acceptedPlans[planKey()];
    const ok = savePlans(); render();
    setStatus(ok ? "This week is back to the suggested plan." : "Reset in this tab. Browser storage failed; back up the plan before closing.", !ok);
  });
}

function finishExperienceRender() {
  renderSyncInfo(); renderAcceptedPlan();
  if (document.querySelector("#planCalendarDisclosure")?.open) renderPlanCalendar();
  const checkin = activeCheckin();
  document.querySelector("#checkinAge").textContent = checkin.savedAt ? `Checked in ${new Date(checkin.savedAt).toLocaleDateString()} · valid for 7 days` : "A fresh weekly check-in is needed. Older responses do not influence this plan.";
  const newest = state.rawActivities.filter(isRun).map(parseActivityDate).sort((a, b) => b - a)[0];
  const currentStart = new Date(); currentStart.setDate(currentStart.getDate() - 27); currentStart.setHours(0, 0, 0, 0);
  document.querySelector("#planningHistoryNote").textContent = !newest || new Date() - newest > 7 * 86400000 || !hasHistoryCoverage(currentStart, new Date()) ? "Your recent history is incomplete or over a week old. Sync or import recent runs before accepting a draft. Planning uses the current 28 days, independently of the review window." : "Planning uses the current 28 days, independently of the review window. Review the draft against your schedule.";
  const warning = document.querySelector("#planHistoryWarning");
  warning.hidden = Boolean(newest && new Date() - newest <= 7 * 86400000 && hasHistoryCoverage(currentStart, new Date()));
  warning.textContent = "Recent history is incomplete. Refresh your data before relying on this draft.";
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
function streamlineRunDetails(openPanels) {
  const body = els.workoutModalContent.querySelector(".workout-body");
  const grid = body.querySelector(".workout-grid");
  const more = document.createElement("div"); more.className = "workout-more";
  const panel = (id, title, content) => {
    const details = document.createElement("details"); details.id = id; details.className = "workout-disclosure";
    const summary = document.createElement("summary"); summary.textContent = title; details.append(summary, ...content.filter(Boolean));
    details.open = openPanels.includes(id); more.append(details); return details;
  };
  const section = (heading) => [...grid.querySelectorAll(".workout-section")].find((element) => element.querySelector("h3")?.textContent === heading);
  const comparisons = panel("runComparisons", "Comparisons and training context", [section("Context"), section("Effort profile"), section("Neighboring runs"), section("Signals"), body.querySelector(".workout-read")]);
  const comparisonControl = document.querySelector("#comparisonScope").closest("label"); comparisons.querySelector("summary").after(comparisonControl);
  panel("runMeasurements", "More run measurements", [section("Run details")]);
  panel("runWeather", "Weather at the start", [grid.querySelector(".workout-weather")]);
  panel("runCoach", "Ask for a coach’s read", [grid.querySelector(".workout-ai-digest")]);
  body.querySelector(".workout-lead").after(document.querySelector("#enrichedRun"));
  body.querySelectorAll(".workout-lead-metric small")[0].textContent = "Recorded distance";
  body.querySelectorAll(".workout-lead-metric small")[1].textContent = "Moving pace";
  grid.remove(); body.append(more);
}
function finishModalRender(run, openPanels = []) {
  streamlineRunDetails(openPanels);
  document.querySelector("#workoutModalTitle").dataset.unitSkip = "";
  const select = document.querySelector("#comparisonScope");
  if (select) { select.value = comparisonScope; select.addEventListener("change", () => { comparisonScope = select.value; showWorkoutModal(run.id, state.modalTrigger); document.querySelector("#comparisonScope").focus(); }); }
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
      const response = await fetch(`/api/activities/${encodeURIComponent(run.id)}?provider=strava`);
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
  document.querySelector("#importSummary").textContent = `${activities.length} valid activities; ${skipped} invalid rows skipped. ${activities.filter(isRun).length} runs and ${activities.filter(isWalk).length} walks. ${activities.filter((run) => state.rawActivities.some((old) => String(old.id) === String(run.id))).length} existing activity IDs will be updated when merging.`;
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
  app.insertAdjacentHTML("afterbegin", `<section class="settings-bar" aria-label="Preferences"><fieldset id="themePreference" class="theme-picker"><legend>Theme</legend><label class="theme-option"><input type="radio" name="theme" value="system"><span><i style="--swatch-paper:#f2f6ef;--swatch-accent:#0d181c"></i>Match system</span></label>${Object.entries(THEMES).map(([value, theme]) => `<label class="theme-option"><input type="radio" name="theme" value="${value}"><span><i style="--swatch-paper:${theme.paper};--swatch-accent:${theme.accent}"></i>${theme.label}</span></label>`).join("")}</fieldset><label>Units <select id="unitPreference"><option value="imperial">Miles / °F</option><option value="metric">Kilometers / °C</option></select></label><label><input id="weatherPreference" type="checkbox"> Modeled weather (shares rounded start location with Open-Meteo)</label><label><input id="rememberPreference" type="checkbox"> Remember imported history on this device</label><button id="removeSavedButton" type="button">Remove saved history</button><button id="backupContextButton" type="button">Back up goals and plans</button><label class="file-button">Restore goals and plans<input id="restoreContextInput" type="file" accept="application/json,.json"></label></section>`);
  const settings = document.querySelector(".settings-bar");
  const disclosure = document.createElement("details"); disclosure.className = "preferences-disclosure data-menu"; disclosure.id = "dataMenu";
  disclosure.innerHTML = '<summary aria-label="Data &amp; settings"><svg class="summary-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg><span class="summary-label">Data &amp; settings</span></summary><div class="data-menu-panel"><div id="dataMenuActions" class="data-menu-actions"><h2>Your history</h2><p id="syncInfo"></p><button id="loadOlderButton" type="button" hidden>Load older activities</button><button id="fullSyncButton" type="button" hidden>Refresh loaded history</button></div></div>';
  document.querySelector(".header-actions .actions").append(disclosure);
  document.querySelector(".header-actions").id = "connectionActions";
  document.querySelector(".header-actions").dataset.feedbackScope = "";
  document.querySelector("#heroStatus").hidden = true;
  const sourceStatus = document.createElement("span"); sourceStatus.id = "sourceStatus"; sourceStatus.className = "source-status";
  document.querySelector(".header-actions").prepend(sourceStatus);
  document.querySelector("#dataMenuActions").append(els.fileInput.closest("label"));
  disclosure.querySelector(".data-menu-panel").append(settings);
  for (const type of ["click", "submit", "change"]) document.addEventListener(type, (event) => {
    const target = event.target instanceof Element ? event.target : null;
    feedbackScopeId = target?.closest("[data-feedback-scope]")?.id || null;
  }, true);
  document.addEventListener("pointerdown", (event) => { if (disclosure.open && !disclosure.contains(event.target)) disclosure.open = false; });
  disclosure.addEventListener("keydown", (event) => { if (event.key === "Escape") { disclosure.open = false; disclosure.querySelector("summary").focus(); event.stopPropagation(); } });
  const exploration = document.createElement("details"); exploration.className = "exploration data-panel"; exploration.dataset.viewSection = "overview"; exploration.innerHTML = "<summary>Charts &amp; metrics<span>Volume mix, calendar, distributions and every block metric</span></summary>";
  document.querySelector("#runs").before(exploration);
  document.querySelectorAll("main > .dashboard, .training-texture").forEach((section) => exploration.append(section));
  exploration.addEventListener("toggle", () => { if (exploration.open && state.filteredRuns.length) { renderSecondaryCharts(); applyDisplayUnits(exploration); } });

  document.querySelectorAll("#overview, .key-runs, .analysis-row").forEach((section) => section.dataset.viewSection = "overview");
  const signals = document.querySelector("#signals"); const coach = document.querySelector(".ai-insights");
  // One metrics panel inside "Charts & metrics" instead of a separate disclosure.
  signals.classList.add("supporting-panel"); document.querySelector(".training-texture").before(signals);
  document.querySelector("#signalsTitle").textContent = "Block metrics";
  const coachDisclosure = document.createElement("details"); coachDisclosure.id = "coachDisclosure"; coachDisclosure.className = "secondary-disclosure";
  coachDisclosure.innerHTML = '<summary>Ask for a coach’s read<span>Optional analysis of this training window</span></summary>'; coachDisclosure.append(coach);
  document.querySelector(".analysis-row").replaceChildren(coachDisclosure);
  exploration.after(document.querySelector(".analysis-row")); // Charts first, then the optional coach.
  document.querySelector("#planning").dataset.viewSection = "planning"; document.querySelector("#runs").dataset.viewSection = "runs";
  document.querySelector(".brand-lockup").addEventListener("click", () => setView("overview", true));
  document.querySelectorAll(".app-nav a").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); history.replaceState(null, "", `${location.pathname}${location.search}${link.hash}`); setView(link.hash.slice(1), true); }));
  activeView = ["fitness", "planning", "runs"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  window.addEventListener("hashchange", () => setView(location.hash.slice(1), true));
  document.querySelector("#planning .panel-heading").insertAdjacentHTML("afterend", `<p id="planningHistoryNote" role="status"></p><div class="plan-controls"><button id="previousPlanWeek" type="button">Previous week</button><strong id="planWeekLabel"></strong><button id="nextPlanWeek" type="button">Next week</button><button id="acceptPlanButton" type="button">Keep this plan</button></div>`);
  document.querySelector("#coachingWorkspaceTitle").textContent = "Your training plan";
  document.querySelector("#planning .panel-heading").insertAdjacentHTML("afterend", '<p id="planProgress" class="plan-progress"></p><div id="planStart" class="plan-start"><strong>Make this week yours</strong><p>Choose your running days and a weekly goal to shape the draft.</p><button id="setupPlanButton" type="button">Set availability and goal</button></div>');
  document.querySelector("#setupPlanButton").addEventListener("click", () => { els.goalForm.closest("details").open = true; els.goalMiles.focus(); });
  els.goalForm.dataset.feedbackScope = ""; els.checkinForm.dataset.feedbackScope = "";
  document.querySelector(".plan-controls").id = "planActions"; document.querySelector(".plan-controls").dataset.feedbackScope = "";
  document.querySelector(".plan-controls").append(els.copyPlanButton);
  setupWeekBoard();
  setupPlanCalendar();
  const planningContext = document.createElement("details"); planningContext.id = "planningContext"; planningContext.className = "secondary-disclosure";
  planningContext.innerHTML = '<summary>Current training context<span>Recent history and the inputs behind your draft</span></summary>';
  planningContext.append(document.querySelector("#planningHistoryNote"), document.querySelector(".readiness-card"));
  document.querySelector("#planning").append(planningContext);
  document.querySelector(".plan-controls").insertAdjacentHTML("beforebegin", '<p id="planHistoryWarning" class="plan-history-warning" role="status" hidden></p>');
  document.querySelector("#checkinForm").insertAdjacentHTML("afterbegin", '<p id="checkinAge" role="status"></p>');
  document.querySelector("#checkinOutcome").insertAdjacentHTML("afterend", '<label for="missedReason">If missed, why?</label><select id="missedReason"><option value="fatigue">Fatigue / recovery</option><option value="schedule">Schedule / life</option><option value="other">Other / unsure</option></select>');
  document.querySelector("#readinessTitle").textContent = "Last 7 days at a glance";
  els.goalAvailability.hidden = true;
  const availability = document.createElement("fieldset"); availability.className = "day-toggles"; availability.innerHTML = "<legend>Available running days (none selected means any day)</legend>";
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) availability.insertAdjacentHTML("beforeend", `<label><input type="checkbox" value="${day}" ${String(coachingContext.goal.availability || "").toLowerCase().includes(day.toLowerCase()) ? "checked" : ""}>${day}</label>`);
  els.goalAvailability.after(availability); document.querySelector('label[for="goalAvailability"]').hidden = true;
  availability.addEventListener("change", () => els.goalAvailability.value = [...availability.querySelectorAll("input:checked")].map((input) => input.value).join(" "));
  document.querySelector(".ledger-controls").insertAdjacentHTML("beforeend", '<label class="control">Run type<select id="runTypeFilter"><option value="all">All runs</option><optgroup label="By effort"><option value="easy">Easy &amp; recovery</option><option value="long">Long</option><option value="quality">Quality &amp; race</option></optgroup><optgroup label="Surface"><option value="road">Road / unspecified</option><option value="trail">Trail</option><option value="treadmill">Treadmill / virtual</option></optgroup><optgroup label="Source label"><option value="race">Race</option><option value="workout">Workout</option></optgroup></select></label>');
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
  const checkTheme = () => { const input = document.querySelector(`#themePreference input[value="${preferences.theme}"]`); if (input) input.checked = true; };
  checkTheme();
  document.querySelector("#themePreference").addEventListener("change", (event) => { preferences.theme = event.target.value; persist("run-trends-preferences", preferences); applyTheme(); if (typeof render === "function") render(); });
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
  // Keeps the suggested week as it is. Any edit to a day does the same.
  document.querySelector("#acceptPlanButton").addEventListener("click", () => {
    if (acceptedPlans[planKey()] || !state.draftSessions?.length) return;
    const saved = editWeek((sessions) => sessions);
    setStatus(saved ? "This week's plan is saved. Changes to your goal will not rewrite it; Reset to suggestion does." : "This plan is available in this tab, but browser storage failed. Back up your goals and plans before closing the tab.", !saved);
  });
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
    navigator.clipboard.writeText(boardSessions(plan.sessions).map((session) => `${dayLabel(session.date)}: ${session.title}${session.kind === "run" ? ` · ${displayDistance(session.miles)} · ${PLAN_STATUS_LABELS[session.status].toLowerCase()}` : ""}${session.detail ? ` · ${session.detail}` : ""}`).join("\n")).then(() => setStatus("Plan copied."), () => setStatus("Clipboard unavailable. Your plan remains visible.", true));
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
  if (acceptedPlans[localDateValue(TrainingCore.weekStart(new Date()))]) selectedPlanOffset = 0;
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
  return plans && typeof plans === "object" && !Array.isArray(plans) && Object.entries(plans).every(([key, plan]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof plan?.savedAt === "string" && Number.isFinite(Date.parse(plan.savedAt)) && Array.isArray(plan.sessions) && plan.sessions.length <= 21 && plan.sessions.every((session) => session && typeof session.title === "string" && session.title.length <= 100 && /^\d{4}-\d{2}-\d{2}$/.test(session.date) && Number.isFinite(Date.parse(session.date)) && ["run", "rest"].includes(session.kind) && Number.isFinite(session.miles) && session.miles >= 0 && session.miles <= 500 && ["planned", "completed", "skipped"].includes(session.status) && (session.type === undefined || Object.hasOwn(TrainingCore.SESSION_TYPES, session.type))));
}

/* ---------- Installed app ---------- */

const installedApp = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
let installPrompt = null;

// The service worker keeps the app shell on the device (see sw.js).
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* The site works without it. */ }); });
}

// Chrome and Edge offer their own install prompt; hold it for the Account dialog.
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; });
window.addEventListener("appinstalled", () => { installPrompt = null; });

// How to install on this device, or "" when installed or not possible.
function installHelpMarkup() {
  if (installedApp) return "";
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (installPrompt) return '<h3 class="account-section-title">Get the app</h3><p class="install-help">Install Runlore on this device for a full-screen app with its own icon. <button type="button" class="link-action" data-action="install-app">Install Runlore</button></p>';
  if (iOS) return '<h3 class="account-section-title">Get the app</h3><p class="install-help">In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Runlore opens full screen with its own icon.</p>';
  return "";
}

document.addEventListener("click", async (event) => {
  if (!event.target.closest?.('[data-action="install-app"]') || !installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  event.target.closest(".install-help")?.remove();
});

/* ---------- Aurora: shared gradients ---------- */
// SVG fills cannot use CSS gradients, so the page carries two named ones that
// theme-aurora.css points chart bars at. Unused by the other themes.
document.body.insertAdjacentHTML("beforeend", `<svg class="aurora-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;top:0;left:0;width:0;height:0;overflow:hidden"><defs>
  <linearGradient id="aurora-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#67e8f9"/><stop offset=".55" stop-color="#a78bfa"/><stop offset="1" stop-color="#a78bfa" stop-opacity=".35"/></linearGradient>
  <linearGradient id="aurora-bar-hot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".4" stop-color="#f472b6"/><stop offset="1" stop-color="#a78bfa" stop-opacity=".5"/></linearGradient>
</defs></svg>`);

/* ---------- Aurora: cursor spotlight ---------- */
// The panel under a mouse pointer gets --mx/--my, which theme-aurora.css turns
// into a soft light that follows the cursor. Other themes ignore the values.
const SPOTLIGHT_PANELS = ".chart-panel, .data-panel, .readiness-hero, .fitness-panel, .fitness-kpis, .this-week, .today-strip, .secondary-disclosure, .key-run-card, .goal-race, .context-card, .block-review, .race-item";
let spotlightPanel = null, spotlightFrame = 0, spotlightEvent = null;
document.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse" || document.documentElement.dataset.palette !== "aurora") return;
  spotlightEvent = event;
  if (spotlightFrame) return;
  spotlightFrame = requestAnimationFrame(() => {
    spotlightFrame = 0;
    const panel = spotlightEvent.target.closest?.(SPOTLIGHT_PANELS) || null;
    if (spotlightPanel && spotlightPanel !== panel) { spotlightPanel.style.removeProperty("--mx"); spotlightPanel.style.removeProperty("--my"); }
    spotlightPanel = panel;
    if (!panel) return;
    const box = panel.getBoundingClientRect();
    panel.style.setProperty("--mx", `${Math.round(spotlightEvent.clientX - box.left)}px`);
    panel.style.setProperty("--my", `${Math.round(spotlightEvent.clientY - box.top)}px`);
  });
}, { passive: true });
