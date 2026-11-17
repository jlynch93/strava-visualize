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
  document.querySelector("#recordsList").innerHTML = ordered.map((record) => {
    const previous = record.isNew && record.previous ? `<small class="record-previous">Beat ${escapeHtml(recordValue({ ...record, value: record.previous.value }))} from ${escapeHtml(recordDate(record.previous.date))}</small>` : "";
    const body = `<span class="record-label">${escapeHtml(record.label)}${record.isNew ? ' <b class="record-new">New</b>' : ""}</span><strong class="record-value">${escapeHtml(recordValue(record))}</strong><small>${escapeHtml(recordDetail(record))}</small>${previous}`;
    const openable = record.run && inWindow.has(String(record.run.id));
    return `<li class="record${record.isNew ? " is-new" : ""}">${openable ? `<button type="button" class="record-open" data-action="open-record" data-run-id="${escapeHtml(String(record.run.id))}" aria-label="${escapeHtml(`${record.label}: ${recordValue(record)}, ${recordDetail(record)}. Open run`)}">${body}</button>` : `<div class="record-body">${body}</div>`}</li>`;
  }).join("");
}

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
function openRecap() {
  const data = weekRecapData();
  const canvas = drawRecap(data);
  const dialog = document.querySelector("#recapDialog");
  const image = document.querySelector("#recapImage");
  image.src = canvas.toDataURL("image/png");
  image.alt = `Weekly recap: ${displayDistance(miles(data.meters), 1)} over ${data.count} ${data.walking ? "walks" : "runs"}, ${formatDuration(data.seconds)} moving.`;
  const name = `runlore-week-${localDateValue(data.start)}.png`;
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
      share.onclick = () => navigator.share({ files: [file], title: "My week on Runlore" }).catch(() => { /* Cancelled. */ });
    }
  }, "image/png");
  if (!dialog.open) dialog.showModal();
}
document.querySelector("#recapClose").addEventListener("click", () => document.querySelector("#recapDialog").close());
document.querySelector("#recapDialog").addEventListener("click", (event) => { if (event.target.id === "recapDialog") event.target.close(); });
document.addEventListener("click", (event) => { if (event.target.closest?.("[data-action='share-week']")) openRecap(); });

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
  baseRenderFitness();
  renderEfficiency();
};
const baseRender = render;
render = function (...args) {
  const result = baseRender.apply(this, args);
  renderRecords();
  return result;
};
render();
