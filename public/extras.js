/* Extras: personal records, aerobic efficiency, race-day pacing, the command
   palette and the weekly recap image. Loads after script.js and hooks into its
   render functions; calculations live in fitness-core.js. */

const unitMeters = () => preferences.units === "metric" ? 1000 : 1609.344;
const unitLabel = () => preferences.units === "metric" ? "km" : "mi";
const recordDate = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

/* ---------- 1. Personal records ---------- */

let recordsCache = { key: "", records: [] };
function currentRecords() {
  const runs = state.rawActivities.map(normalizeActivity).filter(isRun);
  const key = JSON.stringify([runs.length, runs[0]?.id, runs.at(-1)?.id, new Date().toDateString()]);
  if (recordsCache.key !== key) recordsCache = { key, records: FitnessCore.personalRecords(runs, parseActivityDate) };
  return recordsCache.records;
}

function recordValue(record) {
  if (record.unit === "pace") return formatPace(record.value * 1609.344);
  if (record.unit === "days") return `${record.value} days`;
  return record.key === "climb" ? `${Math.round(preferences.units === "metric" ? record.value : feet(record.value)).toLocaleString()} ${preferences.units === "metric" ? "m" : "ft"}` : displayDistance(miles(record.value), 1);
}

function recordDetail(record) {
  if (record.key === "biggest-week" && record.start) return `Week of ${recordDate(record.start)}`;
  if (record.key === "streak" && record.start) return `${recordDate(record.start)} – ${recordDate(record.date)}`;
  const over = record.unit === "pace" && record.run ? ` over ${displayDistance(miles(record.run.distance), 1)}` : "";
  return `${recordDate(record.date)}${over}`;
}

function renderRecords() {
  const host = document.querySelector("#records");
  if (!host) return;
  const records = state.activityMode === "walk" ? [] : currentRecords();
  host.hidden = !records.length;
  if (!records.length) return;
  const inWindow = new Set(state.filteredRuns.map((run) => String(run.id)));
  const fresh = records.filter((record) => record.isNew);
  document.querySelector("#recordsSummary").textContent = fresh.length
    ? `${fresh.length} new in the last two weeks: ${fresh.map((record) => record.label.charAt(0).toLowerCase() + record.label.slice(1)).join(", ")}.`
    : "Across your whole history. A new best gets a badge for two weeks.";
  const ordered = [...fresh, ...records.filter((record) => !record.isNew)];
  // One row: new bests first, the rest a tap away.
  const shown = Math.max(4, fresh.length);
  document.querySelector("#recordsList").innerHTML = ordered.map((record, index) => {
    const previous = record.isNew && record.previous ? `<small class="record-previous">Beat ${escapeHtml(recordValue({ ...record, value: record.previous.value }))} from ${escapeHtml(recordDate(record.previous.date))}</small>` : "";
    const body = `<span class="record-label">${escapeHtml(record.label)}${record.isNew ? ' <b class="record-new">New</b>' : ""}</span><strong class="record-value">${escapeHtml(recordValue(record))}</strong><small>${escapeHtml(recordDetail(record))}</small>${previous}`;
    const openable = record.run && inWindow.has(String(record.run.id));
    return `<li class="record${record.isNew ? " is-new" : ""}${index >= shown ? " record-more" : ""}">${openable ? `<button type="button" class="record-open" data-action="open-record" data-run-id="${escapeHtml(String(record.run.id))}" aria-label="${escapeHtml(`${record.label}: ${recordValue(record)}, ${recordDetail(record)}. Open run`)}">${body}</button>` : `<div class="record-body">${body}</div>`}</li>`;
  }).join("");
  const toggle = document.querySelector("#recordsToggle");
  const hiddenCount = Math.max(0, ordered.length - shown);
  toggle.hidden = !hiddenCount;
  toggle.textContent = host.classList.contains("is-expanded") ? "Show fewer" : `All ${ordered.length} records`;
  toggle.setAttribute("aria-expanded", String(host.classList.contains("is-expanded")));
}
document.querySelector("#recordsToggle")?.addEventListener("click", () => { document.querySelector("#records").classList.toggle("is-expanded"); renderRecords(); });

document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-action='open-record']");
  if (button) showWorkoutModal(button.dataset.runId, button);
});

/* ---------- 2. Aerobic efficiency ---------- */

function renderEfficiency() {
  const panel = document.querySelector("#efficiencyPanel");
  const model = fitnessModel();
  if (!panel || !model) return;
  const trend = FitnessCore.efficiencyTrend(model.runs, parseActivityDate, { types: model.types });
  panel.hidden = trend.series.length < 3;
  if (panel.hidden) return;
  const perBeat = (value) => preferences.units === "metric" ? `${value.toFixed(2)} m` : `${(value * 1.09361).toFixed(2)} yd`;
  const summary = document.querySelector("#efficiencySummary");
  if (trend.change === null) {
    summary.innerHTML = trend.current ? `<strong>${perBeat(trend.current)} per heartbeat</strong> over the last eight weeks. A trend appears once there are 16 weeks of easy runs with heart rate.` : "Easy and steady runs with heart rate in the last eight weeks build this measure.";
  } else {
    const percent = Math.abs(trend.change * 100).toFixed(1);
    const verdict = trend.change > 0.01 ? "your aerobic engine is improving: more speed for the same effort" : trend.change < -0.01 ? "the same speed is costing more heartbeats; fatigue, heat or illness are common causes" : "holding steady";
    summary.innerHTML = `<strong>${perBeat(trend.current)} per heartbeat</strong>, ${trend.change > 0 ? "up" : "down"} ${percent}% on the eight weeks before: ${verdict}.`;
  }
  if (activeView !== "fitness") return;
  const { start, end } = getRangeDates();
  const points = trend.series.filter((point) => (!start || point.week >= new Date(start.getFullYear(), start.getMonth(), start.getDate() - 6)) && (!end || point.week <= end));
  const chart = document.querySelector("#efficiencyChart");
  if (points.length < 2) { renderEmpty(chart, "Not enough easy runs with heart rate in this window."); return; }
  const factor = preferences.units === "metric" ? 1 : 1.09361;
  timeChart(chart, {
    dates: points.map((point) => point.week),
    series: [{ label: "Per heartbeat", short: preferences.units === "metric" ? "m/beat" : "yd/beat", className: "efficiency-line", values: points.map((point) => point.value * factor) }],
    yFormat: (value) => value.toFixed(2),
    ariaLabel: `Weekly aerobic efficiency in ${preferences.units === "metric" ? "metres" : "yards"} per heartbeat. Use arrow keys to move between weeks.`,
    tooltip: (index) => ({ title: `Week of ${recordDate(points[index].week)}`, rows: [
      { label: "Per heartbeat", value: perBeat(points[index].value) },
      { label: "Runs counted", value: points[index].runs }
    ] })
  });
}

/* ---------- Progress tabs (VO2 max, efficiency, intensity) ---------- */

let progressTab = (() => { try { return localStorage.getItem("runlore-progress-tab") || "vo2Section"; } catch { return "vo2Section"; } })();
const progressTabs = () => [...document.querySelectorAll("#progressPanel [role='tab']")];
// A measure without enough data hides its tab; the chosen tab falls back to the first one shown.
function syncProgressTabs() {
  const tabs = progressTabs();
  tabs.forEach((tab) => { tab.hidden = document.getElementById(tab.dataset.tab).hidden; });
  const available = tabs.filter((tab) => !tab.hidden);
  const active = available.find((tab) => tab.dataset.tab === progressTab) || available[0];
  tabs.forEach((tab) => {
    const on = tab === active;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    document.getElementById(tab.dataset.tab).classList.toggle("is-active", on);
  });
}
function chooseProgressTab(tab, focus = false) {
  progressTab = tab.dataset.tab;
  try { localStorage.setItem("runlore-progress-tab", progressTab); } catch { /* Per-device convenience only. */ }
  syncProgressTabs();
  if (focus) tab.focus();
  renderFitness(); // Charts measure their panel, so draw the one now shown.
}
document.querySelector("#progressPanel .progress-tabs")?.addEventListener("click", (event) => {
  const tab = event.target.closest("[role='tab']");
  if (tab) chooseProgressTab(tab);
});
document.querySelector("#progressPanel .progress-tabs")?.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = progressTabs().filter((tab) => !tab.hidden);
  const index = tabs.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  chooseProgressTab(tabs[next], true);
});

/* ---------- 3. Race-day pacing ---------- */

const openPacing = new Set();
function pacingDetails({ race, meters, predicted }) {
  const target = race.goalSeconds || predicted;
  const even = FitnessCore.pacingPlan(meters, target, { splitMeters: unitMeters() });
  const negative = FitnessCore.pacingPlan(meters, target, { splitMeters: unitMeters(), negative: 0.02 });
  if (!even.length) return "";
  const clock = (seconds) => formatRaceTime(Math.round(seconds));
  const split = (seconds) => { const rounded = Math.round(seconds); return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`; };
  // Negative split: first-half pace p and second-half pace 0.98p, same finish time.
  const firstPace = target / (meters / 2 * (2 - 0.02));
  const key = `${race.id}:${target}`;
  const rows = even.map((item, index) => `<tr><th scope="row">${item.partial ? `${(item.distance / unitMeters()).toFixed(1)}` : item.index}</th><td>${split(item.splitSeconds)}<small>${clock(item.elapsed)}</small></td><td>${split(negative[index].splitSeconds)}<small>${clock(negative[index].elapsed)}</small></td></tr>`).join("");
  return `<details class="pacing-plan" data-pacing="${escapeHtml(key)}"${openPacing.has(key) ? " open" : ""}>
    <summary>Race-day pacing <span>${race.goalSeconds ? "for your goal" : "at the predicted time"} of ${clock(target)}</span></summary>
    <p class="pacing-note">Even pace is ${formatPace(target / (meters / 1609.344))} throughout. A 2% negative split runs the first half at ${formatPace(firstPace * 1609.344)}, passes halfway in ${clock(firstPace * meters / 2)}, then runs the second half at ${formatPace(firstPace * 0.98 * 1609.344)}.</p>
    <p class="pacing-note">Each cell shows that split, then the total time at its end.</p>
    <div class="pacing-scroll"><table class="pacing-table"><thead><tr><th scope="col">${unitLabel() === "km" ? "Km" : "Mile"}</th><th scope="col">Even</th><th scope="col">2% negative</th></tr></thead><tbody>${rows}</tbody></table></div>
  </details>`;
}
document.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!details.matches?.(".pacing-plan")) return;
  if (details.open) openPacing.add(details.dataset.pacing); else openPacing.delete(details.dataset.pacing);
}, true);

/* ---------- 4. Command palette ---------- */

document.body.insertAdjacentHTML("beforeend", `<dialog id="commandPalette" class="command-palette" aria-label="Search and commands">
  <div class="palette-field"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
  <input id="paletteInput" type="text" role="combobox" aria-expanded="true" aria-controls="paletteList" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search runs, views, themes, ranges…"></div>
  <ul id="paletteList" class="palette-list" role="listbox" aria-label="Results"></ul>
  <p class="palette-hint"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to choose · <kbd>Esc</kbd> to close</p>
</dialog>`);
const palette = { dialog: document.querySelector("#commandPalette"), input: document.querySelector("#paletteInput"), list: document.querySelector("#paletteList"), items: [], active: 0, trigger: null };

function paletteCommands(query) {
  const go = (label, hash, keywords) => ({ group: "Go to", label, keywords, run: () => { location.hash = hash; } });
  const commands = [
    go("Overview", "#overview", "home dashboard trends"), go("Fitness", "#fitness", "readiness vo2 form fatigue"),
    go("Plan", "#planning", "week schedule races goal"), go("Runs", "#runs", "ledger list activities"),
    { group: "Do", label: "Share this week as an image", keywords: "recap export png weekly", run: () => openRecap() },
    { group: "Do", label: "Share your year as an image", keywords: "year review recap wrapped annual", run: () => openYearRecap() },
    { group: "Go to", label: "Shoes", keywords: "gear mileage trainers", run: () => { location.hash = "#runs"; requestAnimationFrame(() => document.querySelector("#shoes")?.scrollIntoView({ block: "start" })); } },
    { group: "Do", label: "Edit your profile", keywords: "account age gender heart rate birth", run: () => openAccountDialog() },
    { group: "Do", label: "Import a file", keywords: "upload csv json strava export", run: () => els.fileInput.click() },
    { group: "Do", label: preferences.units === "metric" ? "Switch to miles" : "Switch to kilometres", keywords: "units metric imperial km mi", run: () => { const select = document.querySelector("#unitPreference"); select.value = preferences.units === "metric" ? "imperial" : "metric"; select.dispatchEvent(new Event("change", { bubbles: true })); } },
    ...[["30", "Last 30 days"], ["90", "Last 90 days"], ["180", "Last 6 months"], ["365", "Last year"], ["all", "All time"]].map(([value, label]) => ({ group: "Range", label, keywords: "window period dates", current: els.rangeSelect.value === value, run: () => { els.rangeSelect.value = value; els.rangeSelect.dispatchEvent(new Event("change", { bubbles: true })); } })),
    ...(document.querySelector("#activityModeControl")?.hidden ? [] : ["run", "walk"].map((mode) => ({ group: "Show", label: mode === "run" ? "Runs" : "Walks", keywords: "mode activity", current: state.activityMode === mode, run: () => document.querySelector(`input[name="activityMode"][value="${mode}"]`)?.click() }))),
    { group: "Theme", label: "Match system", keywords: "theme appearance auto", current: preferences.theme === "system", run: () => setTheme("system") },
    ...Object.entries(THEMES).map(([value, theme]) => ({ group: "Theme", label: theme.label, keywords: `theme appearance ${theme.base}`, current: preferences.theme === value, run: () => setTheme(value) }))
  ];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text) => words.every((word) => text.includes(word));
  const found = commands.filter((command) => matches(`${command.group} ${command.label} ${command.keywords || ""}`.toLowerCase()));
  // Runs in the window, newest first, matched by name or date.
  const runs = words.length ? [...state.filteredRuns].reverse().filter((run) => matches(`${run.name} ${parseActivityDate(run).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} ${localDateValue(parseActivityDate(run))}`.toLowerCase())).slice(0, 6)
    .map((run) => ({ group: "Runs", label: run.name, detail: `${recordDate(parseActivityDate(run))} · ${displayDistance(miles(run.distance), 1)} · ${formatPace(paceSeconds(run))}`, run: () => showWorkoutModal(run.id, palette.trigger) })) : [];
  // Commands named by the query come first, then runs, then commands that only matched a keyword.
  const named = found.filter((command) => matches(`${command.group} ${command.label}`.toLowerCase()));
  return words.length ? [...named, ...runs, ...found.filter((command) => !named.includes(command))] : found;
}

function setTheme(value) {
  preferences.theme = value;
  persist("run-trends-preferences", preferences);
  applyTheme();
  const input = document.querySelector(`#themePreference input[value="${value}"]`); if (input) input.checked = true;
  render();
}

function renderPalette() {
  palette.items = paletteCommands(palette.input.value.trim());
  palette.active = Math.min(palette.active, Math.max(0, palette.items.length - 1));
  let group = "";
  palette.list.innerHTML = palette.items.length ? palette.items.map((item, index) => {
    const heading = item.group !== group ? `<li class="palette-group" role="presentation">${escapeHtml(item.group)}</li>` : "";
    group = item.group;
    return `${heading}<li id="palette-${index}" class="palette-item${index === palette.active ? " is-active" : ""}" role="option" aria-selected="${index === palette.active}" data-index="${index}"><span>${escapeHtml(item.label)}</span>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ""}${item.current ? '<em>Current</em>' : ""}</li>`;
  }).join("") : '<li class="palette-empty" role="presentation">Nothing matches. Try a run name, a view, a theme or a range.</li>';
  palette.input.setAttribute("aria-activedescendant", palette.items.length ? `palette-${palette.active}` : "");
  palette.list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
}

function openPalette() {
  if (palette.dialog.open) return;
  palette.trigger = document.activeElement;
  palette.input.value = ""; palette.active = 0;
  renderPalette();
  palette.dialog.showModal();
  palette.input.focus();
}
function choosePalette(index) {
  const item = palette.items[index];
  if (!item) return;
  palette.dialog.close();
  item.run();
}
palette.input.addEventListener("input", () => { palette.active = 0; renderPalette(); });
palette.input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const count = palette.items.length;
    if (count) { palette.active = (palette.active + (event.key === "ArrowDown" ? 1 : -1) + count) % count; renderPalette(); }
  } else if (event.key === "Enter") { event.preventDefault(); choosePalette(palette.active); }
});
palette.list.addEventListener("click", (event) => { const option = event.target.closest(".palette-item"); if (option) choosePalette(Number(option.dataset.index)); });
palette.dialog.addEventListener("click", (event) => { if (event.target === palette.dialog) palette.dialog.close(); });
palette.dialog.addEventListener("close", () => { if (palette.trigger?.isConnected && !document.querySelector("dialog[open]") && els.workoutModal.hidden) palette.trigger.focus(); });
document.addEventListener("keydown", (event) => {
  const typing = event.target.closest?.("input, textarea, select, [contenteditable='true']");
  if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) { event.preventDefault(); palette.dialog.open ? palette.dialog.close() : openPalette(); }
  else if (event.key === "/" && !typing && !document.querySelector("dialog[open]")) { event.preventDefault(); openPalette(); }
});
// A button for it, beside the other header actions.
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
document.querySelector(".header-actions .actions")?.insertAdjacentHTML("afterbegin", `<button id="paletteButton" class="ghost-action palette-button" type="button" aria-keyshortcuts="${mac ? "Meta+K" : "Control+K"}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Search</span><kbd>${mac ? "⌘K" : "Ctrl K"}</kbd></button>`);
document.querySelector("#paletteButton")?.addEventListener("click", openPalette);

/* ---------- 5. Weekly recap image ---------- */

document.body.insertAdjacentHTML("beforeend", `<dialog id="recapDialog" class="recap-dialog" aria-labelledby="recapTitle">
  <div class="recap-head"><h2 id="recapTitle">Your week</h2><button id="recapClose" class="modal-close" type="button" aria-label="Close">×</button></div>
  <img id="recapImage" alt="">
  <div class="recap-actions"><button id="recapShare" class="primary" type="button" hidden>Share</button><a id="recapDownload" class="ghost-action recap-download" download>Download image</a></div>
  <p class="recap-note">Made on this device. Nothing is uploaded.</p>
</dialog>`);

function weekRecapData() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 7);
  const activities = state.rawActivities.map(normalizeActivity).filter(inMode);
  const inWeek = activities.filter((run) => { const date = parseActivityDate(run); return date >= start && date < end; });
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start); day.setDate(start.getDate() + index);
    const key = localDateValue(day);
    return { day, meters: inWeek.filter((run) => localDateValue(parseActivityDate(run)) === key).reduce((sum, run) => sum + run.distance, 0) };
  });
  const meters = inWeek.reduce((sum, run) => sum + run.distance, 0);
  const seconds = inWeek.reduce((sum, run) => sum + run.moving_time, 0);
  const climb = inWeek.reduce((sum, run) => sum + (run.total_elevation_gain || 0), 0);
  const longest = inWeek.reduce((best, run) => run.distance > (best?.distance || 0) ? run : best, null);
  return { start, end: new Date(end - 86400000), days, meters, seconds, climb, count: inWeek.length, longest, walking: state.activityMode === "walk", readiness: fitnessModel()?.readiness || null };
}

function drawRecap(data) {
  const canvas = document.createElement("canvas");
  const W = 1080, H = 1350; canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const font = (weight, size) => `${weight} ${size}px "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif`;
  const background = ctx.createLinearGradient(0, 0, W, H);
  background.addColorStop(0, "#0d181c"); background.addColorStop(1, "#10292c");
  ctx.fillStyle = background; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.1, 0, W * 0.85, H * 0.1, 700);
  glow.addColorStop(0, "rgba(200, 240, 74, 0.22)"); glow.addColorStop(1, "rgba(200, 240, 74, 0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  // Brand.
  ctx.fillStyle = "#c8f04a"; ctx.beginPath(); ctx.arc(96, 104, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e8f1ec"; ctx.font = font(800, 40); ctx.fillText("runlore", 126, 118);
  const range = `${data.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${data.end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  ctx.fillStyle = "#9db4ad"; ctx.font = font(600, 34); ctx.textAlign = "right"; ctx.fillText(range, W - 80, 118); ctx.textAlign = "left";
  // Headline distance.
  ctx.fillStyle = "#9db4ad"; ctx.font = font(700, 36); ctx.fillText(`THIS WEEK'S ${data.walking ? "WALKING" : "RUNNING"}`, 80, 300);
  const [value, unit] = displayDistance(miles(data.meters), 1).split(" ");
  ctx.fillStyle = "#ffffff"; ctx.font = font(800, 230); ctx.fillText(value, 72, 520);
  const valueWidth = ctx.measureText(value).width;
  ctx.fillStyle = "#c8f04a"; ctx.font = font(800, 80); ctx.fillText(unit, 72 + valueWidth + 24, 520);
  // Stats.
  const stats = [
    [String(data.count), data.count === 1 ? (data.walking ? "walk" : "run") : (data.walking ? "walks" : "runs")],
    [formatDuration(data.seconds), "moving"],
    [data.meters ? formatPace(data.seconds / miles(data.meters)) : "–", "average pace"],
    [preferences.units === "metric" ? `${Math.round(data.climb).toLocaleString()} m` : `${Math.round(feet(data.climb)).toLocaleString()} ft`, "climbed"]
  ];
  stats.forEach(([big, small], index) => {
    const x = 80 + (index % 2) * 470, y = 650 + Math.floor(index / 2) * 150;
    ctx.fillStyle = "#ffffff"; ctx.font = font(800, 64); ctx.fillText(big, x, y);
    ctx.fillStyle = "#9db4ad"; ctx.font = font(600, 30); ctx.fillText(small, x, y + 46);
  });
  // Day bars.
  const top = 1000, base = 1180, barWidth = 92, gap = (W - 160 - barWidth * 7) / 6;
  const most = Math.max(...data.days.map((day) => day.meters), 1);
  data.days.forEach((day, index) => {
    const x = 80 + index * (barWidth + gap);
    const height = day.meters ? Math.max(10, (base - top) * day.meters / most) : 6;
    ctx.fillStyle = day.meters ? (day.meters === most ? "#c8f04a" : "#3d8f86") : "rgba(255,255,255,0.12)";
    ctx.beginPath(); ctx.roundRect(x, base - height, barWidth, height, 12); ctx.fill();
    ctx.fillStyle = "#9db4ad"; ctx.font = font(700, 28); ctx.textAlign = "center";
    ctx.fillText(day.day.toLocaleDateString(undefined, { weekday: "narrow" }), x + barWidth / 2, base + 44); ctx.textAlign = "left";
  });
  // Footer: longest and readiness.
  ctx.fillStyle = "#e8f1ec"; ctx.font = font(600, 30);
  const footer = [data.longest ? `Longest ${displayDistance(miles(data.longest.distance), 1)}` : "", data.readiness ? `Readiness ${data.readiness.score} · ${data.readiness.label}` : ""].filter(Boolean).join("   ·   ");
  ctx.fillText(footer, 80, 1300);
  return canvas;
}

let recapUrl = null;
function showRecapCanvas(canvas, name, alt, title) {
  const dialog = document.querySelector("#recapDialog");
  const image = document.querySelector("#recapImage");
  document.querySelector("#recapTitle").textContent = title;
  image.src = canvas.toDataURL("image/png");
  image.alt = alt;
  const download = document.querySelector("#recapDownload");
  download.download = name;
  download.href = image.src;
  const share = document.querySelector("#recapShare");
  share.hidden = true;
  canvas.toBlob((blob) => {
    if (!blob) return;
    if (recapUrl) URL.revokeObjectURL(recapUrl);
    recapUrl = URL.createObjectURL(blob);
    download.href = recapUrl;
    const file = new File([blob], name, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      share.hidden = false;
      share.onclick = () => navigator.share({ files: [file], title }).catch(() => { /* Cancelled. */ });
    }
  }, "image/png");
  if (!dialog.open) dialog.showModal();
}
function openRecap() {
  const data = weekRecapData();
  showRecapCanvas(drawRecap(data), `runlore-week-${localDateValue(data.start)}.png`, `Weekly recap: ${displayDistance(miles(data.meters), 1)} over ${data.count} ${data.walking ? "walks" : "runs"}, ${formatDuration(data.seconds)} moving.`, "Your week");
}
document.querySelector("#recapClose").addEventListener("click", () => document.querySelector("#recapDialog").close());
document.querySelector("#recapDialog").addEventListener("click", (event) => { if (event.target.id === "recapDialog") event.target.close(); });
document.addEventListener("click", (event) => { if (event.target.closest?.("[data-action='share-week']")) openRecap(); });

/* ---------- 6. Yearly distance goal ---------- */

const yearRuns = (year) => state.rawActivities.map(normalizeActivity).filter(isRun).filter((run) => parseActivityDate(run).getFullYear() === year);
function renderYearGoal() {
  const host = document.querySelector("#yearGoal");
  if (!host) return;
  const today = new Date();
  const year = today.getFullYear();
  const runs = state.rawActivities.length && state.activityMode !== "walk" ? yearRuns(year) : [];
  host.hidden = !runs.length;
  if (!runs.length) return;
  if (host.contains(document.activeElement) && document.activeElement.matches("input")) return; // Do not redraw under the cursor.
  const goalMiles = coachingContext.yearGoals?.[year] || 0;
  const plan = FitnessCore.yearProjection({ soFar: runs.reduce((sum, run) => sum + run.distance, 0), today, goal: goalMiles * 1609.344 });
  const distance = (meters, digits = 0) => displayDistance(miles(meters), digits);
  const fill = plan.goal ? Math.min(100, plan.soFar / plan.goal * 100) : Math.min(100, plan.elapsedDays / plan.totalDays * 100);
  const marker = plan.goal ? Math.min(100, plan.expectedByNow / plan.goal * 100) : null;
  const verdict = !plan.goal ? `At this pace, ${distance(plan.projected)} by December 31.`
    : plan.done ? `Goal reached, ${distance(plan.soFar - plan.goal)} past it with ${plan.remainingDays} days to spare.`
    : plan.onTrack ? `On pace for ${distance(plan.projected)}: ${distance(plan.ahead)} ahead of schedule.`
    : `On pace for ${distance(plan.projected)}, ${distance(plan.goal - plan.projected)} short. ${distance(plan.neededPerWeek, 1)} a week from here gets you there.`;
  const unit = preferences.units === "metric" ? "km" : "mi";
  const goalValue = goalMiles ? Math.round(goalMiles * (preferences.units === "metric" ? 1.609344 : 1)) : "";
  host.innerHTML = `
    <div class="year-head">
      <div><h2 id="yearGoalTitle">${year} so far <span>${distance(plan.soFar)} · ${runs.length} runs</span></h2><p>${escapeHtml(verdict)}</p></div>
      <button type="button" class="ghost-action share-year" data-action="share-year">Share your year</button>
    </div>
    <div class="year-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(fill)}" aria-label="${plan.goal ? `${Math.round(fill)}% of your ${distance(plan.goal)} goal` : `${Math.round(fill)}% of the year gone`}">
      <span style="width:${fill}%"></span>${marker !== null ? `<i style="left:${marker}%" title="Where the goal pace would have you today"></i>` : ""}
    </div>
    <div class="year-foot">
      <dl class="year-facts">
        <div><dt>Projected</dt><dd>${distance(plan.projected)}</dd></div>
        ${plan.goal && !plan.done ? `<div><dt>Needed a week</dt><dd>${distance(plan.neededPerWeek, 1)}</dd></div><div><dt>Left</dt><dd>${distance(plan.left)}</dd></div>` : ""}
        <div><dt>Days left</dt><dd>${plan.remainingDays}</dd></div>
      </dl>
      <form id="yearGoalForm" class="year-goal-form"><label for="yearGoalInput">Goal for ${year} (${unit})</label><input id="yearGoalInput" type="number" min="1" max="30000" step="1" inputmode="numeric" value="${goalValue}" placeholder="e.g. ${preferences.units === "metric" ? "2000" : "1200"}"><button type="submit">${goalMiles ? "Update" : "Set goal"}</button>${goalMiles ? '<button type="button" class="link-action" data-action="clear-year-goal">Clear</button>' : ""}</form>
    </div>`;
}
document.addEventListener("submit", (event) => {
  if (event.target.id !== "yearGoalForm") return;
  event.preventDefault();
  const value = Number(event.target.yearGoalInput.value);
  const year = String(new Date().getFullYear());
  coachingContext.yearGoals = { ...(coachingContext.yearGoals || {}) };
  if (value > 0) coachingContext.yearGoals[year] = Math.round(value / (preferences.units === "metric" ? 1.609344 : 1) * 10) / 10; else delete coachingContext.yearGoals[year];
  saveCoachingContext();
  document.activeElement?.blur?.();
  renderYearGoal();
});
document.addEventListener("click", (event) => {
  if (event.target.closest?.("[data-action='clear-year-goal']")) { delete coachingContext.yearGoals?.[new Date().getFullYear()]; saveCoachingContext(); renderYearGoal(); }
  if (event.target.closest?.("[data-action='share-year']")) openYearRecap();
});

/* ---------- 7. Intensity balance ---------- */

const INTENSITY_VERDICT = {
  "too-hard": "More than 30% hard. That is more intensity than most plans hold for long: swap a hard day for an easy one.",
  "hard-side": "A little on the hard side of 80/20. Fine in a build; keep the easy days truly easy.",
  balanced: "Close to 80/20: mostly easy, with room for quality.",
  "all-easy": "Almost all easy. Building toward a race? One quality session a week adds speed."
};
function renderIntensity() {
  const panel = document.querySelector("#intensityPanel");
  const model = fitnessModel();
  if (!panel || !model) return;
  const balance = FitnessCore.intensityBalance(model.runs, model.types, parseActivityDate);
  panel.hidden = !balance;
  if (!balance) return;
  const hard = Math.round(balance.hardShare * 100), easy = 100 - hard;
  document.querySelector("#intensityBalance").innerHTML = `
    <div class="intensity-bar" role="img" aria-label="${easy}% easy, ${hard}% hard over the last four weeks; the guideline is 80% easy.">
      <span class="intensity-easy" style="width:${easy}%">${easy >= 12 ? `${easy}% easy` : ""}</span><span class="intensity-hard" style="width:${hard}%">${hard >= 12 ? `${hard}% hard` : ""}</span>
      <i class="intensity-target" style="left:80%"><b>80/20</b></i>
    </div>
    <p class="intensity-verdict status-${balance.key}">${escapeHtml(INTENSITY_VERDICT[balance.key])}</p>
    <dl class="intensity-facts"><div><dt>Easy, steady and long</dt><dd>${formatDuration(balance.easySeconds)}</dd></div><div><dt>Quality and races</dt><dd>${formatDuration(balance.hardSeconds)}</dd></div><div><dt>Runs</dt><dd>${balance.runs}</dd></div></dl>`;
}

/* ---------- 8. Shoes ---------- */

function renderShoes() {
  const host = document.querySelector("#shoes");
  if (!host) return;
  const shoes = coachingContext.shoes || [];
  const runs = state.rawActivities.map(normalizeActivity).filter(isRun);
  const rows = FitnessCore.shoeMileage(runs, shoes, parseActivityDate).sort((a, b) => (a.retired ? 1 : 0) - (b.retired ? 1 : 0) || b.start.localeCompare(a.start));
  document.querySelectorAll(".shoe-unit").forEach((node) => { node.textContent = unitLabel(); });
  const form = document.querySelector("#shoeForm");
  if (form && !form.shoeStart.value) form.shoeStart.value = localDateValue(new Date());
  if (form) form.shoeLimit.placeholder = preferences.units === "metric" ? "650" : "400";
  const active = rows.filter((shoe) => !shoe.retired);
  document.querySelector("#shoesSummary").textContent = active.length
    ? active.map((shoe) => `${shoe.name}: ${displayDistance(miles(shoe.meters), 0)}`).join(" · ")
    : "Add a pair to see how far you have run in it, and when to replace it.";
  const date = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const statusText = { fine: "", nearly: "Replace soon", worn: "Past its limit", retired: "Retired" };
  document.querySelector("#shoeList").innerHTML = rows.map((shoe) => `
    <li class="shoe status-${shoe.status}">
      <div class="shoe-main"><strong>${escapeHtml(shoe.name)}</strong><small>Since ${escapeHtml(date(shoe.start))}${shoe.retired ? ` · retired ${escapeHtml(date(shoe.retired))}` : ""} · ${shoe.runs} ${shoe.runs === 1 ? "run" : "runs"}</small></div>
      <div class="shoe-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(1, shoe.share) * 100)}" aria-label="${escapeHtml(`${shoe.name}: ${Math.round(shoe.share * 100)}% of ${displayDistance(miles(shoe.limit), 0)}`)}"><span style="width:${Math.min(100, shoe.share * 100)}%"></span></div>
      <div class="shoe-distance"><strong>${displayDistance(miles(shoe.meters), 0)}</strong><small>of ${displayDistance(miles(shoe.limit), 0)}${statusText[shoe.status] ? ` · <b>${statusText[shoe.status]}</b>` : ""}</small></div>
      <div class="shoe-actions">${shoe.retired ? "" : `<button type="button" class="link-action" data-shoe-action="retire" data-shoe-id="${escapeHtml(shoe.id)}">Retire<span class="visually-hidden"> ${escapeHtml(shoe.name)}</span></button>`}<button type="button" class="link-action danger" data-shoe-action="remove" data-shoe-id="${escapeHtml(shoe.id)}">Remove<span class="visually-hidden"> ${escapeHtml(shoe.name)}</span></button></div>
    </li>`).join("") || '<li class="shoe-empty">No shoes yet.</li>';
}
document.querySelector("#shoeForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const limit = Number(form.shoeLimit.value) || (preferences.units === "metric" ? 650 : 400);
  coachingContext.shoes = [...(coachingContext.shoes || []), { id: crypto.randomUUID(), name: form.shoeName.value.trim() || "Shoes", start: form.shoeStart.value, limit: Math.round(limit * unitMeters()) }];
  coachingContext = sanitizeCoachingContext(coachingContext);
  saveCoachingContext();
  form.reset();
  renderShoes();
  setStatus("Shoes added.", false, "shoeForm");
});
document.querySelector("#shoeList")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-shoe-action]");
  if (!button) return;
  const id = button.dataset.shoeId;
  const shoe = coachingContext.shoes.find((item) => item.id === id);
  if (!shoe) return;
  if (button.dataset.shoeAction === "retire") shoe.retired = localDateValue(new Date());
  else if (window.confirm(`Remove ${shoe.name}? Its runs stop counting toward any shoe.`)) coachingContext.shoes = coachingContext.shoes.filter((item) => item.id !== id);
  else return;
  saveCoachingContext();
  renderShoes();
});

/* ---------- 9. How a run felt ---------- */

const RPE_WORDS = ["", "Very easy", "Easy", "Easy", "Comfortable", "Steady", "Moderately hard", "Hard", "Very hard", "Near max", "All out"];
const runNote = (id) => coachingContext.notes?.[String(id)] || null;
function feelSection(run) {
  const note = runNote(run.id) || {};
  const scale = Array.from({ length: 10 }, (_, index) => {
    const value = index + 1;
    return `<label title="${RPE_WORDS[value]}"><input type="radio" name="runRpe" value="${value}"${note.rpe === value ? " checked" : ""}><span>${value}</span></label>`;
  }).join("");
  return `<section class="run-feel" aria-labelledby="runFeelTitle" data-run-id="${escapeHtml(String(run.id))}">
    <div class="run-feel-head"><h3 id="runFeelTitle">How it felt</h3><span id="runFeelWord">${note.rpe ? `${note.rpe} · ${RPE_WORDS[note.rpe]}` : "Effort from 1 (very easy) to 10 (all out)"}</span></div>
    <fieldset class="rpe-scale"><legend class="visually-hidden">Effort, 1 to 10</legend>${scale}</fieldset>
    <label class="visually-hidden" for="runFeelNote">Note</label>
    <textarea id="runFeelNote" rows="2" maxlength="280" placeholder="A note for later: legs, weather, shoes, fuelling…">${escapeHtml(note.note || "")}</textarea>
    <p class="run-feel-status" role="status"></p>
  </section>`;
}
function saveFeel(section) {
  const id = section.dataset.runId;
  const rpe = Number(section.querySelector("input[name='runRpe']:checked")?.value) || undefined;
  const text = section.querySelector("#runFeelNote").value.trim().slice(0, 280);
  coachingContext.notes = { ...(coachingContext.notes || {}) };
  if (rpe || text) coachingContext.notes[id] = { ...(rpe ? { rpe } : {}), ...(text ? { note: text } : {}) }; else delete coachingContext.notes[id];
  saveCoachingContext();
  section.querySelector("#runFeelWord").textContent = rpe ? `${rpe} · ${RPE_WORDS[rpe]}` : "Effort from 1 (very easy) to 10 (all out)";
  section.querySelector(".run-feel-status").textContent = "Saved";
  renderTable();
}
document.addEventListener("change", (event) => {
  const section = event.target.closest?.(".run-feel");
  if (section && event.target.matches("input[name='runRpe'], #runFeelNote")) saveFeel(section);
});

/* ---------- 10. Year in review ---------- */

function yearRecapData(year = new Date().getFullYear()) {
  const runs = yearRuns(year);
  const months = Array.from({ length: 12 }, (_, month) => runs.filter((run) => parseActivityDate(run).getMonth() === month).reduce((sum, run) => sum + run.distance, 0));
  const records = currentRecords().filter((record) => record.date.getFullYear() === year);
  const days = new Set(runs.map((run) => localDateValue(parseActivityDate(run)))).size;
  // A run's local start hour, only when its timestamp has a time of day.
  const hourOf = (run) => /\d{1,2}:\d{2}/.test(String(run.start_date_local || run.start_date || "")) ? parseActivityDate(run).getHours() : null;
  const facts = FitnessCore.yearHighlights(runs, parseActivityDate, year, { hourOf });
  return {
    year, runs: runs.length, days, months, records, facts,
    meters: runs.reduce((sum, run) => sum + run.distance, 0),
    seconds: runs.reduce((sum, run) => sum + run.moving_time, 0),
    climb: runs.reduce((sum, run) => sum + (run.total_elevation_gain || 0), 0),
    longest: runs.reduce((best, run) => run.distance > (best?.distance || 0) ? run : best, null)
  };
}

// Up to eight accolades earned this year, most notable first.
function yearAccolades(data) {
  const facts = data.facts;
  const metric = preferences.units === "metric";
  const unit = metric ? "km" : "mi";
  const total = metric ? facts.meters / 1000 : miles(facts.meters);
  const list = [];
  const clubs = metric ? [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000] : [250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000];
  const club = clubs.filter((size) => total >= size).pop();
  if (club) list.push({ title: `${club.toLocaleString()} ${unit} club`, detail: `${Math.round(total).toLocaleString()} ${unit} this year` });
  if (facts.ultras) list.push({ title: facts.ultras === 1 ? "Ultra distance" : `${facts.ultras}× ultra distance`, detail: "Runs of 50 km or longer" });
  else if (facts.marathons) list.push({ title: facts.marathons === 1 ? "Marathon distance" : `${facts.marathons}× marathon distance`, detail: "Runs of 26.2 mi or longer" });
  // Records the image already shows elsewhere (longest run, biggest week) are left out here.
  data.records.filter((record) => !["longest", "biggest-week"].includes(record.key)).slice(0, 2).forEach((record) => list.push({ title: record.label, detail: `Record · ${recordValue(record)}, ${recordDate(record.date)}` }));
  if (facts.longestStreak >= 3) list.push({ title: `${facts.longestStreak}-day streak`, detail: "Most days in a row" });
  if (facts.monthsSoFar >= 3 && facts.monthsActive === facts.monthsSoFar) list.push({ title: "Every month", detail: facts.monthsSoFar === 12 ? "Ran in all 12 months" : `Ran in all ${facts.monthsSoFar} months so far` });
  else if (facts.weeksSoFar >= 8 && facts.weeksActive / facts.weeksSoFar >= 0.75) list.push({ title: `${facts.weeksActive} of ${facts.weeksSoFar} weeks`, detail: "Weeks with a run" });
  const everests = facts.climb / 8849;
  if (everests >= 0.5) list.push({ title: everests >= 1 ? `${everests.toFixed(1)}× Everest` : "Half an Everest", detail: `${metric ? `${Math.round(facts.climb).toLocaleString()} m` : `${Math.round(feet(facts.climb)).toLocaleString()} ft`} climbed` });
  if (facts.halves >= 2 && facts.halves > facts.marathons) list.push({ title: `${facts.halves} half-marathon+ runs`, detail: "Runs of 13.1 mi or longer" });
  if (facts.biggestWeek) list.push({ title: `Biggest week ${displayDistance(miles(facts.biggestWeek.meters), 1)}`, detail: `Week of ${recordDate(facts.biggestWeek.start)}` });
  if (facts.earlyRuns >= 10) list.push({ title: "Early bird", detail: `${facts.earlyRuns} runs before 7 am` });
  if (facts.lateRuns >= 10) list.push({ title: "Night owl", detail: `${facts.lateRuns} runs after 8 pm` });
  const earth = facts.meters / 40075000;
  if (earth >= 0.01) list.push({ title: earth >= 1 ? `${earth.toFixed(2)}× around the Earth` : `${Math.round(earth * 100)}% around the Earth`, detail: "Measured at the equator" });
  return list.slice(0, 8);
}

function drawYearRecap(data) {
  const canvas = document.createElement("canvas");
  const W = 1080, H = 1920; canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const font = (weight, size) => `${weight} ${size}px "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif`;
  const background = ctx.createLinearGradient(0, 0, 0, H);
  background.addColorStop(0, "#101a2e"); background.addColorStop(1, "#0d181c");
  ctx.fillStyle = background; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.2, H * 0.12, 0, W * 0.2, H * 0.12, 760);
  glow.addColorStop(0, "rgba(61, 143, 134, 0.35)"); glow.addColorStop(1, "rgba(61, 143, 134, 0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#c8f04a"; ctx.beginPath(); ctx.arc(96, 104, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e8f1ec"; ctx.font = font(800, 40); ctx.fillText("runlore", 126, 118);
  ctx.fillStyle = "#c8f04a"; ctx.font = font(800, 150); ctx.fillText(String(data.year), 72, 330);
  ctx.fillStyle = "#9db4ad"; ctx.font = font(700, 36); ctx.fillText("YOUR YEAR IN RUNNING", 80, 395);
  const [value, unit] = displayDistance(miles(data.meters), 0).split(" ");
  ctx.fillStyle = "#ffffff"; ctx.font = font(800, 170); ctx.fillText(Number(value).toLocaleString(), 72, 580);
  const width = ctx.measureText(Number(value).toLocaleString()).width;
  ctx.fillStyle = "#c8f04a"; ctx.font = font(800, 64); ctx.fillText(unit, 72 + width + 20, 580);
  const stats = [
    [data.runs.toLocaleString(), "runs"], [`${Math.round(data.seconds / 3600).toLocaleString()} h`, "on your feet"],
    [data.days.toLocaleString(), "days you ran"], [preferences.units === "metric" ? `${Math.round(data.climb).toLocaleString()} m` : `${Math.round(feet(data.climb)).toLocaleString()} ft`, "climbed"]
  ];
  stats.forEach(([big, small], index) => {
    const x = 80 + (index % 2) * 470, y = 700 + Math.floor(index / 2) * 140;
    ctx.fillStyle = "#ffffff"; ctx.font = font(800, 60); ctx.fillText(big, x, y);
    ctx.fillStyle = "#9db4ad"; ctx.font = font(600, 30); ctx.fillText(small, x, y + 44);
  });
  // Months.
  const base = 1170, top = 990, barWidth = 60, gap = (W - 160 - barWidth * 12) / 11;
  const most = Math.max(...data.months, 1);
  const busiest = data.months.indexOf(most);
  data.months.forEach((meters, month) => {
    const x = 80 + month * (barWidth + gap);
    const height = meters ? Math.max(8, (base - top) * meters / most) : 4;
    ctx.fillStyle = meters ? (month === busiest ? "#c8f04a" : "#3d8f86") : "rgba(255,255,255,0.12)";
    ctx.beginPath(); ctx.roundRect(x, base - height, barWidth, height, 10); ctx.fill();
    ctx.fillStyle = "#9db4ad"; ctx.font = font(700, 26); ctx.textAlign = "center";
    ctx.fillText(new Date(data.year, month, 1).toLocaleDateString(undefined, { month: "narrow" }), x + barWidth / 2, base + 40); ctx.textAlign = "left";
  });
  ctx.fillStyle = "#e8f1ec"; ctx.font = font(600, 30);
  const footer = [data.longest ? `Longest ${displayDistance(miles(data.longest.distance), 1)}` : "", `Busiest ${new Date(data.year, busiest, 1).toLocaleDateString(undefined, { month: "long" })}`, data.records.length ? `${data.records.length} ${data.records.length === 1 ? "record" : "records"} set` : ""].filter(Boolean).join("   ·   ");
  ctx.fillText(footer, 80, 1290);
  // Accolades: two columns of badges.
  const accolades = yearAccolades(data);
  if (accolades.length) {
    ctx.fillStyle = "#9db4ad"; ctx.font = font(700, 30); ctx.fillText("ACCOLADES", 80, 1370);
    const columnWidth = (W - 160 - 24) / 2, rowHeight = 108, rowGap = 14, top = 1394;
    const fit = (text, weight, size, maxWidth, minimum) => {
      let current = size;
      ctx.font = font(weight, current);
      while (ctx.measureText(text).width > maxWidth && current > minimum) { current -= 2; ctx.font = font(weight, current); }
      if (ctx.measureText(text).width <= maxWidth) return text;
      let cut = text;
      while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
      return `${cut}…`;
    };
    accolades.forEach((accolade, index) => {
      const x = 80 + (index % 2) * (columnWidth + 24), y = top + Math.floor(index / 2) * (rowHeight + rowGap);
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)"; ctx.strokeStyle = "rgba(200, 240, 74, 0.3)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x, y, columnWidth, rowHeight, 18); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#c8f04a"; ctx.beginPath(); ctx.arc(x + 46, y + rowHeight / 2, 24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0d181c"; ctx.font = font(800, 28); ctx.textAlign = "center"; ctx.fillText("★", x + 46, y + rowHeight / 2 + 10); ctx.textAlign = "left";
      const textWidth = columnWidth - 104;
      const title = fit(accolade.title, 800, 32, textWidth, 24);
      ctx.fillStyle = "#ffffff"; ctx.fillText(title, x + 88, y + 48);
      const detail = fit(accolade.detail, 600, 24, textWidth, 20);
      ctx.fillStyle = "#9db4ad"; ctx.fillText(detail, x + 88, y + 82);
    });
  }
  return canvas;
}

function openYearRecap() {
  const data = yearRecapData();
  const accolades = yearAccolades(data).map((accolade) => accolade.title).join(", ");
  showRecapCanvas(drawYearRecap(data), `runlore-${data.year}.png`, `${data.year} in running: ${displayDistance(miles(data.meters), 0)} over ${data.runs} runs.${accolades ? ` Accolades: ${accolades}.` : ""}`, `Your ${data.year}`);
}

/* ---------- Hooks into the existing renderers ---------- */

const baseRenderThisWeek = renderThisWeek;
renderThisWeek = function (model) {
  baseRenderThisWeek(model);
  const head = document.querySelector("#thisWeek .week-head");
  if (head && !head.querySelector("[data-action='share-week']")) {
    (head.querySelector(".today-link") || head.lastElementChild).insertAdjacentHTML(head.querySelector(".today-link") ? "beforebegin" : "afterend", '<button type="button" class="ghost-action share-week" data-action="share-week"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg><span>Share week</span></button>');
  }
};
const baseGoalRaceCard = goalRaceCard;
goalRaceCard = function (goal) {
  return baseGoalRaceCard(goal).replace(/<\/article>\s*$/, `${pacingDetails(goal)}</article>`);
};
const baseRenderFitness = renderFitness;
renderFitness = function () {
  // Sync first so the chosen chart's panel is shown (and measurable) when it draws.
  syncProgressTabs();
  baseRenderFitness();
  renderEfficiency();
  renderIntensity();
  syncProgressTabs();
};
const baseShowWorkoutModal = showWorkoutModal;
showWorkoutModal = function (runId, trigger) {
  baseShowWorkoutModal(runId, trigger);
  const run = state.filteredRuns.find((candidate) => String(candidate.id) === String(runId));
  const body = els.workoutModalContent.querySelector(".workout-body");
  if (run && body && !body.querySelector(".run-feel")) body.insertAdjacentHTML("afterbegin", feelSection(run));
};
const baseRenderTable = renderTable;
renderTable = function (...args) {
  baseRenderTable(...args);
  els.activityRows.querySelectorAll("tr[data-activity-id]").forEach((row) => {
    const note = runNote(row.dataset.activityId);
    const cell = row.children[2];
    if (!note || !cell || cell.querySelector(".feel-chip")) return;
    cell.insertAdjacentHTML("beforeend", ` <span class="feel-chip" title="${escapeHtml([note.rpe ? `Effort ${note.rpe} of 10, ${RPE_WORDS[note.rpe].toLowerCase()}` : "", note.note || ""].filter(Boolean).join(": "))}">${note.rpe ? `RPE ${note.rpe}` : "Note"}${note.note && note.rpe ? " ·✎" : ""}</span>`);
  });
};
const baseRender = render;
render = function (...args) {
  const result = baseRender.apply(this, args);
  renderRecords();
  renderYearGoal();
  renderShoes();
  return result;
};
render();
