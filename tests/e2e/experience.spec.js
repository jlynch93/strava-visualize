const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

function history() {
  return Array.from({ length: 16 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - index * 2); date.setHours(8, 0, 0, 0);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { id: String(index + 100), name: `Run ${index + 1}`, sport_type: index === 1 ? "TrailRun" : "Run", workout_type: index === 2 ? 1 : 0, start_date: `${day}T12:00:00Z`, start_date_local: `${day}T08:00:00Z`, distance: 5000, moving_time: 1500, average_heartrate: index % 2 ? 145 : 0, start_latlng: [40.71, -74.01] };
  });
}
async function chooseFile(page, activities = history()) {
  await page.locator("#fileInput").setInputFiles({ name: "runs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(activities)) });
}
async function importHistory(page, activities = history()) {
  await chooseFile(page, activities);
  await page.locator("#importCoverage").check();
  await page.locator("#confirmImportButton").click();
  await expect(page.locator("#status")).toContainText("Imported");
}
async function preferences(page) { await page.locator(".preferences-disclosure").evaluate((element) => element.open = true); }
async function view(page, name) { await page.getByRole("link", { name, exact: true }).click(); }

// Mocks a signed-in account with Strava connected. signedIn may change
// during a test to simulate the session ending.
async function mockStravaAccount(page, { signedIn = () => true, ...extra } = {}) {
  const providers = [{ id: "strava", name: "Strava", configured: true, error: null }];
  await page.route("**/api/status", (route) => route.fulfill({ json: { configured: true, signedIn: signedIn(), connected: signedIn(), providers, ...extra } }));
  await page.route("**/api/me", (route) => signedIn()
    ? route.fulfill({ json: { user: { id: "u1", displayName: "Test Runner" }, connections: [{ provider: "strava", displayName: "Test Runner" }] } })
    : route.fulfill({ status: 401, json: { error: "Sign in first." } }));
}
test("secondary controls stay collapsed and the data menu supports keyboard dismissal", async ({ page }) => {
  await page.goto("/"); await importHistory(page);
  await expect(page.locator("#sourceStatus")).toHaveText("Imported history");
  await expect(page.locator("#demoButton")).toBeHidden();
  await expect(page.locator("#unitPreference")).toBeHidden();
  await expect(page.locator(".exploration")).not.toHaveAttribute("open", "");
  await expect(page.locator("#overview details.secondary-disclosure, [data-view-section='overview'] details.secondary-disclosure, details.exploration")).toHaveCount(2);
  await expect(page.locator("#aiAnalyzeButton")).toBeHidden();
  await page.locator("#dataMenu > summary").click();
  await expect(page.locator("#unitPreference")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#unitPreference")).toBeHidden();
  await expect(page.locator("#dataMenu > summary")).toBeFocused();
});

const dayCard = (page, title) => page.locator(".plan-day").filter({ has: page.getByText(title, { exact: true }) }).first();
const editor = (page) => page.locator("#dayEditor");

test("the suggested week is edited in place, and the first edit saves it", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  await page.locator("#setupPlanButton").click(); await expect(page.locator("#goalMiles")).toBeFocused();
  await page.locator("#previousPlanWeek").click();
  await expect(page.locator(".plan-day")).toHaveCount(7);
  await expect(page.locator("#planWeekLabel")).toContainText("Suggested");
  expect(await page.evaluate(() => Boolean(acceptedPlans[planKey()]))).toBe(false);
  const longRun = dayCard(page, "Long run");
  const date = await longRun.getAttribute("data-date");
  const before = await page.evaluate((day) => weekSessions().find((session) => session.date === day).miles, date);
  await longRun.locator(".plan-day-open").click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByRole("radio", { name: "Long" })).toBeChecked();
  await editor(page).getByRole("button", { name: /more/ }).click();
  await expect(editor(page).locator("#dayEditorSaved")).toHaveText("Saved");
  expect(await page.evaluate((day) => acceptedPlans[planKey()].sessions.find((session) => session.date === day).miles, date)).toBeCloseTo(before + 0.5, 1);
  await editor(page).getByRole("radio", { name: "Easy" }).check();
  await expect(page.locator(`.plan-day[data-date="${date}"] strong`)).toHaveText("Easy run");
  expect(await page.evaluate((day) => acceptedPlans[planKey()].sessions.find((session) => session.date === day).miles, date)).toBeCloseTo(before + 0.5, 1);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeHidden();
  await expect(page.locator(`.plan-day[data-date="${date}"] .plan-day-open`)).toBeFocused();
  await expect(page.locator("#planWeekLabel")).toContainText("Your plan");
  await expect(page.locator("#acceptPlanButton")).toBeHidden();
  // After a reload the plan opens on the week that has a saved plan.
  await page.reload(); await importHistory(page); await view(page, "Plan");
  await expect(page.locator(`.plan-day[data-date="${date}"] strong`)).toHaveText("Easy run");
});
test("import preview supports cancel, deduplicated merge, and explicit replacement", async ({ page }) => {
  await page.goto("/"); await importHistory(page);
  const updated = { ...history()[0], name: "Updated run", distance: 6000 };
  await chooseFile(page, [updated]); await expect(page.locator("#importSummary")).toContainText("1 existing activity IDs");
  await page.locator("#cancelImportButton").click();
  expect(await page.evaluate(() => state.rawActivities[0].name)).toBe("Run 1");
  await chooseFile(page, [updated]); await page.locator("#confirmImportButton").click();
  expect(await page.evaluate(() => ({ count: state.rawActivities.length, name: state.rawActivities[0].name }))).toEqual({ count: 16, name: "Updated run" });
  await chooseFile(page, [updated]); await page.locator("#importMode").selectOption("replace"); await page.locator("#confirmImportButton").click();
  expect(await page.evaluate(() => state.rawActivities.length)).toBe(1);
});
test("remembered imports survive reload and can be removed", async ({ page }) => {
  await page.goto("/"); await preferences(page); await page.locator("#rememberPreference").check();
  await importHistory(page); await page.reload();
  await expect(page.locator("#syncInfo")).toContainText("16 activities");
  await preferences(page); await page.locator("#removeSavedButton").click();
  await page.reload(); await expect(page.locator(".onboarding")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("run-trends-import-v1"))).toBeNull();
});
test("units convert distance and pace without changing underlying data or double conversion", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await preferences(page); await page.locator("#unitPreference").selectOption("metric");
  await view(page, "Runs");
  await expect(page.locator("#activityRows tr").first()).toContainText("5.00 km");
  await expect(page.locator("#activityRows tr").first()).toContainText("5:00/km");
  await expect(page.locator("#activityRows tr").first()).toContainText("Unavailable");
  expect(await page.evaluate(() => state.rawActivities[0].distance)).toBe(5000);
  await preferences(page); await page.locator("#unitPreference").selectOption("imperial");
  await expect(page.locator("#activityRows tr").first()).toContainText("3.11 mi");
  await page.locator("#unitPreference").selectOption("metric");
  await expect(page.locator("#activityRows tr").first()).toContainText("5.00 km");
});
test("planning remains current and stable when reviewing old history or changing grouping", async ({ page }) => {
  await page.goto("/"); await importHistory(page);
  const before = await page.evaluate(() => currentTrainingSummary());
  await page.locator("#bucketSelect").selectOption("month");
  expect(await page.evaluate(() => currentTrainingSummary())).toEqual(before);
  await page.locator("#rangeSelect").selectOption("custom"); await page.locator("#startDate").fill("2020-01-01"); await page.locator("#endDate").fill("2020-02-01");
  expect(await page.evaluate(() => currentTrainingSummary())).toEqual(before);
  await view(page, "Plan"); await expect(page.locator("#readinessContent")).toContainText("last 7 days");
  await expect(page.locator("#planningHistoryNote")).toContainText("independently of the review window");
});
test("stale and undated check-ins have no effect while scheduling misses preserve intent", async ({ page }) => {
  await page.goto("/"); await importHistory(page);
  expect(await page.evaluate(() => {
    coachingContext.checkin = { outcome: "missed", savedAt: "2020-01-01" }; return recommendIntent(currentTrainingSummary(), null).intent;
  })).toBe("maintain");
  await view(page, "Plan"); await page.locator("summary").filter({ hasText: "Weekly check-in" }).click();
  await page.locator("#checkinOutcome").selectOption("missed"); await page.locator("#missedReason").selectOption("schedule"); await page.getByRole("button", { name: "Save check-in" }).click();
  await expect(page.locator("#planAdaptation")).toContainText("scheduling");
  expect(await page.evaluate(() => recommendIntent(currentTrainingSummary(), null).intent)).toBe("maintain");
});
test("rest days become runs, days swap, and statuses change from the board or the editor", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  await page.locator("#acceptPlanButton").click();
  expect(await page.evaluate(() => acceptedPlans[planKey()].sessions.every((session) => session.status === "planned"))).toBe(true);
  const rest = dayCard(page, "Rest / mobility");
  const restDate = await rest.getAttribute("data-date");
  await expect(rest.locator(".plan-day-done")).toHaveCount(0);
  await rest.locator(".plan-day-open").click();
  await editor(page).getByRole("radio", { name: "Easy" }).check();
  await expect(editor(page).locator("#dayMiles")).not.toHaveValue("0.0");
  await page.keyboard.press("Escape");
  const turned = page.locator(`.plan-day[data-date="${restDate}"]`);
  await expect(turned.locator("strong")).toHaveText("Easy run");
  // Swap it with the long run, from the editor.
  const longDate = await dayCard(page, "Long run").getAttribute("data-date");
  await turned.locator(".plan-day-open").click();
  await editor(page).locator("#dayMove").selectOption(longDate);
  await expect(editor(page).locator("#dayEditorTitle")).toContainText(new Date(`${longDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }));
  await page.keyboard.press("Escape");
  await expect(page.locator(`.plan-day[data-date="${longDate}"] strong`)).toHaveText("Easy run");
  await expect(page.locator(`.plan-day[data-date="${restDate}"] strong`)).toHaveText("Long run");
  expect(await page.evaluate(() => new Set(acceptedPlans[planKey()].sessions.map((session) => session.date)).size)).toBe(7);
  // Done straight from the board, skipped from the editor.
  const done = page.locator(`.plan-day[data-date="${longDate}"] .plan-day-done`);
  await done.click();
  await expect(done).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#planWeekTotals")).toContainText("1 done");
  await page.locator(`.plan-day[data-date="${restDate}"] .plan-day-open`).click();
  await editor(page).getByRole("radio", { name: "Skipped" }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(`.plan-day[data-date="${restDate}"]`)).toHaveClass(/status-skipped/);
  await expect(page.locator("#planWeekTotals")).toContainText("1 skipped");
  // Statuses survive a change of view and a reload.
  const saved = await page.evaluate(() => JSON.stringify(acceptedPlans));
  await view(page, "Overview"); await page.locator("#bucketSelect").selectOption("month");
  expect(await page.evaluate(() => JSON.stringify(acceptedPlans))).toBe(saved);
  await page.reload(); await importHistory(page); await view(page, "Plan");
  await expect(page.locator(`.plan-day[data-date="${longDate}"] .plan-day-done`)).toHaveAttribute("aria-pressed", "true");
});
test("a plan saved before the board keeps a second session on one day through edits", async ({ page }) => {
  // The old editor's date picker could put two sessions on one date.
  await page.addInitScript(() => {
    const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    const day = (offset) => { const date = new Date(monday); date.setDate(monday.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
    const rest = (offset) => ({ date: day(offset), title: "Rest / mobility", detail: "", kind: "rest", miles: 0, status: "planned", matchedId: "" });
    const sessions = [rest(0), { date: day(2), title: "Quality option", detail: "", kind: "run", miles: 5, status: "planned", matchedId: "" }, rest(2), { date: day(2), title: "Steady run", detail: "", kind: "run", miles: 4, status: "planned", matchedId: "" }, rest(3), rest(4), { date: day(5), title: "Long run", detail: "", kind: "run", miles: 9, status: "planned", matchedId: "" }, rest(6)];
    if (!localStorage.getItem("run-trends-plans-v1")) localStorage.setItem("run-trends-plans-v1", JSON.stringify({ [day(0)]: { savedAt: new Date().toISOString(), sessions } }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.copiedPlan = value; } } });
  });
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  await expect(page.locator(".plan-day")).toHaveCount(7);
  await expect(page.locator("#planWeekTotals")).toContainText("also saved, not on the board");
  await page.locator(".plan-day").first().locator(".plan-day-open").click();
  await editor(page).getByRole("radio", { name: "Easy" }).check();
  await page.keyboard.press("Escape");
  const titles = await page.evaluate(() => acceptedPlans[planKey()].sessions.map((session) => session.title));
  expect(titles.filter((title) => title === "Quality option")).toHaveLength(1);
  expect(titles.filter((title) => title === "Steady run")).toHaveLength(1);
  expect(titles).toHaveLength(9); // seven board days (Tuesday filled in) plus the two not on the board
  // Copy carries each day's note.
  await page.locator("#copyPlanButton").click();
  expect(await page.evaluate(() => window.copiedPlan)).toContain("Easy run");
  expect(await page.evaluate(() => window.copiedPlan)).toContain("Conversational effort");
  // Reloading keeps every session (the saved plan still validates).
  await page.reload(); await importHistory(page); await view(page, "Plan");
  expect(await page.evaluate(() => acceptedPlans[planKey()]?.sessions.length)).toBe(9);
});

test("dragging one day onto another swaps them", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "HTML drag and drop is simulated reliably in Chromium");
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  const long = dayCard(page, "Long run"); const longDate = await long.getAttribute("data-date");
  const rest = dayCard(page, "Rest / mobility"); const restDate = await rest.getAttribute("data-date");
  await long.dragTo(rest);
  await expect(page.locator(`.plan-day[data-date="${restDate}"] strong`)).toHaveText("Long run");
  await expect(page.locator(`.plan-day[data-date="${longDate}"] strong`)).toHaveText("Rest / mobility");
  expect(await page.evaluate(() => Boolean(acceptedPlans[planKey()]))).toBe(true);
});
test("a recorded run can be matched to a day, and reset returns the suggested week", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  await page.locator("#previousPlanWeek").click();
  // Run 100 was recorded today, which is in this week.
  const today = history()[0].start_date_local.slice(0, 10);
  await page.locator(`.plan-day[data-date="${today}"] .plan-day-open`).click();
  if (await editor(page).getByRole("radio", { name: "Rest" }).isChecked()) await editor(page).getByRole("radio", { name: "Easy" }).check();
  await editor(page).locator("#dayMatch").selectOption("100");
  await expect(editor(page).getByRole("radio", { name: "Done" })).toBeChecked();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => acceptedPlans[planKey()].sessions.filter((session) => session.matchedId === "100").length)).toBe(1);
  // Turning the day into rest drops its status and match.
  await page.locator(`.plan-day[data-date="${today}"] .plan-day-open`).click();
  await editor(page).getByRole("radio", { name: "Rest" }).check();
  await expect(editor(page).locator("#dayMatch")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => acceptedPlans[planKey()].sessions.some((session) => session.matchedId === "100"))).toBe(false);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#resetPlanButton").click();
  expect(await page.evaluate(() => Boolean(acceptedPlans[planKey()]))).toBe(false);
  await expect(page.locator("#planWeekLabel")).toContainText("Suggested");
  await expect(page.locator("#acceptPlanButton")).toBeVisible();
});
test("unknown comparison coverage is not reported as improvement", async ({ page }) => {
  await page.goto("/"); await importHistory(page, history().slice(0, 3));
  await expect(page.locator("#blockReviewSummary")).toContainText("Insufficient comparison history");
  await expect(page.locator("#blockReviewTitle")).toHaveText("Your selected training block");
});
test("Strava sync merges recent changes, loads older history, caches the session, and reconnects after expiry", async ({ page }) => {
  const urls = []; let phase = 0;
  await mockStravaAccount(page, { signedIn: () => phase < 4, analysisService: "https://analysis.test", analysisModel: "test" });
  await page.route("**/api/activities?*", (route) => {
    const url = new URL(route.request().url()); urls.push(url); phase++;
    if (phase === 4) return route.fulfill({ status: 401, json: { error: "expired" } });
    const activities = phase === 1 ? history().slice(0, 2) : phase === 2 ? [{ ...history()[0], name: "Updated Strava run" }] : history().slice(2, 4);
    return route.fulfill({ json: { activities, truncated: phase === 1 } });
  });
  await page.goto("/"); await expect(page.locator("#syncInfo")).toContainText("2 activities");
  await page.locator("#connectButton").click(); await expect(page.locator("#status")).toContainText("Loaded 1 activities");
  expect(urls[1].searchParams.has("after")).toBe(true);
  await page.locator("#dataMenu > summary").click();
  await page.locator("#loadOlderButton").click(); await expect(page.locator("#syncInfo")).toContainText("3 activities");
  expect(urls[2].searchParams.has("before")).toBe(true);
  await page.reload(); await expect(page.locator("#syncInfo")).toContainText("3 activities"); expect(urls).toHaveLength(3);
  await page.locator("#connectButton").click(); await expect(page.locator("#status")).toContainText("session expired"); await expect(page.locator("#connectButton")).toHaveText("Sign in");
});
test("run details fetch and cache splits, support comparisons and previous/next navigation", async ({ page }) => {
  let details = 0;
  await mockStravaAccount(page);
  await page.route("**/api/activities?*", (route) => route.fulfill({ json: { activities: history(), truncated: false } }));
  await page.route(/\/api\/activities\/\d+\?provider=strava$/, (route) => { details++; return route.fulfill({ json: { activity: { splits_metric: [{ distance: 1000, moving_time: 300, average_heartrate: 145 }] } } }); });
  await page.goto("/"); await expect(page.locator("#syncInfo")).toContainText("16 activities"); await view(page, "Runs");
  await page.locator(".row-detail-button").first().click(); await expect(page.locator("#enrichedRun")).toContainText("Recorded kilometer splits");
  await expect(page.locator(".workout-lead-metrics")).toBeVisible();
  await expect(page.locator("#comparisonScope")).toBeHidden();
  await expect(page.locator("#runMeasurements")).not.toHaveAttribute("open", "");
  await expect(page.getByRole("link", { name: "Open in Strava" })).toHaveAttribute("href", /strava.com\/activities\/100$/);
  await page.locator("#runComparisons > summary").click();
  await page.locator("#comparisonScope").selectOption("sport"); expect(details).toBe(1);
  await expect(page.locator("#runComparisons")).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Previous run", exact: true }).click(); await expect(page.locator("#workoutModalTitle")).toHaveText("Run 2");
  await page.keyboard.press("Escape"); await page.locator(".row-detail-button").first().click(); expect(details).toBe(2);
});
test("weather stays off until enabled and converts modeled temperature with unit preferences", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/weather?*", (route) => { requests++; return route.fulfill({ json: { weather: { temperatureF: 68, feelsLikeF: 68, humidityPercent: 50, precipitationInches: 0, windSpeedMph: 5, weatherCode: 0 } } }); });
  await page.goto("/"); await importHistory(page); expect(requests).toBe(0);
  await preferences(page); await page.locator("#unitPreference").selectOption("metric"); await page.locator("#weatherPreference").check();
  await expect.poll(() => requests).toBeGreaterThan(0);
  await view(page, "Runs"); await page.locator(".row-detail-button").first().click(); await expect(page.locator("#workoutModalContent")).toContainText("20°C");
});
test("coach analysis requires disclosure, can be canceled, and sends no route or run names", async ({ page }) => {
  let payload;
  await page.route("**/api/insights", async (route) => { payload = route.request().postDataJSON(); await new Promise((resolve) => setTimeout(resolve, 1200)); try { await route.fulfill({ status: 503, json: { error: "test" } }); } catch { /* Request was canceled. */ } });
  await page.goto("/"); await importHistory(page); await page.locator("#coachDisclosure > summary").click(); await page.locator("#aiAnalyzeButton").click();
  await expect(page.locator("#analysisConsent")).toBeVisible(); await page.locator("#allowAnalysisButton").click();
  await expect(page.getByRole("button", { name: "Cancel analysis" })).toBeVisible();
  await expect.poll(() => Boolean(payload)).toBe(true); await page.getByRole("button", { name: "Cancel analysis" }).click();
  await expect(page.locator("#aiInsightContent")).toContainText("Analysis canceled");
  expect(JSON.stringify(payload)).not.toContain("start_latlng"); expect(payload.recentRuns.every((run) => run.name === "Run")).toBe(true);
});
test("overview, runs, plan and import dialog have no serious accessibility violations", async ({ page }) => {
  await page.goto("/"); await importHistory(page);
  for (const name of ["Overview", "Runs", "Plan"]) {
    await view(page, name);
    const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(report.violations.filter((violation) => ["critical", "serious"].includes(violation.impact)), JSON.stringify(report.violations)).toEqual([]);
  }
  await chooseFile(page);
  const report = await new AxeBuilder({ page }).include("#importReview").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(report.violations).toEqual([]);
});

test("goals and saved plans export, reject malformed restores, and restore explicitly", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Plan"); await page.locator("#acceptPlanButton").click();
  const saved = await page.evaluate(() => JSON.stringify(acceptedPlans));
  await preferences(page);
  const downloadEvent = page.waitForEvent("download"); await page.locator("#backupContextButton").click();
  const download = await downloadEvent;
  const fs = require("node:fs/promises"); const backup = await fs.readFile(await download.path());
  const payload = JSON.parse(backup); expect(payload.version).toBe(1); expect(payload.acceptedPlans).toEqual(JSON.parse(saved));
  await page.locator("#restoreContextInput").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":1,"acceptedPlans":[]}') });
  await expect(page.locator("#status")).toContainText("not a valid"); expect(await page.evaluate(() => JSON.stringify(acceptedPlans))).toBe(saved);
  await page.evaluate(() => { acceptedPlans = {}; savePlans(); render(); });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#restoreContextInput").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: backup });
  await expect(page.locator("#status")).toContainText("Goals and plans restored");
  expect(await page.evaluate(() => JSON.stringify(acceptedPlans))).toBe(saved);
});

test("mobile saved plans and preferences remain within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/"); await importHistory(page); await view(page, "Plan"); await page.locator("#acceptPlanButton").click();
  await page.locator(".plan-day .plan-day-open").first().click();
  await expect(page.locator("#dayEditor")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sheet = await page.locator("#dayEditor").boundingBox();
  expect(sheet.width).toBeLessThanOrEqual(390);
  const editorReport = await new AxeBuilder({ page }).include("#dayEditor").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(editorReport.violations, JSON.stringify(editorReport.violations)).toEqual([]);
  await page.keyboard.press("Escape");
  await preferences(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(report.violations.filter((violation) => ["critical", "serious"].includes(violation.impact)), JSON.stringify(report.violations)).toEqual([]);
});

test("run-type filters round-trip through copied view URLs", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Runs");
  await page.locator("#runTypeFilter").selectOption("trail"); await expect(page.locator("#activityRows tr")).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("type")).toBe("trail");
  await page.reload(); await importHistory(page); await expect(page.locator("#runTypeFilter")).toHaveValue("trail"); await expect(page.locator("#activityRows tr")).toHaveCount(1);
});

test("malformed remembered imports and saved sessions cannot prevent startup", async ({ page }) => {
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("run-trends-preferences", JSON.stringify({ rememberImports: true, weather: "false" }));
    localStorage.setItem("run-trends-import-v1", JSON.stringify({ activities: [null, 1, {}, { start_date: "invalid" }] }));
    localStorage.setItem("run-trends-plans-v1", JSON.stringify({ "2026-10-19": { savedAt: "2026-10-19T00:00:00Z", sessions: [null] } }));
  });
  await page.goto("/"); await expect(page.locator(".onboarding")).toBeVisible();
  expect(errors).toEqual([]); expect(await page.evaluate(() => preferences.weather)).toBe(false);
});

test("failed browser storage reports that accepted plans are only available in this tab", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("quota"); }; });
  await page.locator("#acceptPlanButton").click();
  await expect(page.locator("#planWeekLabel")).toContainText("Your plan");
  await expect(page.locator("#status")).toContainText("browser storage failed");
  // An edit after that says so in the editor too.
  await dayCard(page, "Rest / mobility").locator(".plan-day-open").click();
  await page.locator("#dayEditor").getByRole("radio", { name: "Easy" }).check();
  await expect(page.locator("#dayEditorSaved")).toContainText("browser storage failed");
});

test("fitness view shows readiness, VO2 max, load and accepts a heart-rate profile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview demo data", exact: true }).click();
  const strip = page.locator("#todayStrip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Readiness today");
  await strip.getByRole("link", { name: /Open fitness/ }).click();
  await expect(page.locator("#fitness")).toBeVisible();
  await expect(page.locator("#overview")).toBeHidden();
  await expect(page.locator(".app-nav a[href='#fitness']")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".readiness-gauge")).toHaveAttribute("aria-label", /Readiness \d+ out of 100/);
  await expect(page.locator(".readiness-factors li")).not.toHaveCount(0);
  // The numbers strip is gone: readiness, the load chart and the progress tabs carry them.
  await expect(page.locator("#fitnessKpis")).toBeHidden();
  await expect(page.locator("#progressPanel [role='tab'][aria-selected='true']")).toHaveText("VO2 max");
  await expect(page.locator("#vo2Chart svg")).toBeVisible();
  await expect(page.locator("#loadChart svg")).toBeVisible();
  await expect(page.locator("#racePredictions tbody tr")).toHaveCount(4);
  await expect(page.locator("#trainingPaces tbody tr")).toHaveCount(5);

  // Keyboard users can step through the chart and read each day.
  await page.locator("#loadChart svg").focus();
  await expect(page.locator("#chartTooltip")).toHaveClass(/visible/);
  await expect(page.locator("#chartTooltip")).toContainText("Fitness");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#chartTooltip")).toContainText("Form");

  const vo2 = page.locator("#todayStrip .today-facts dd").first();
  const before = await vo2.textContent();
  await page.locator(".fitness-profile > summary").click();
  // Heart rate is edited in the profile popup and updates the estimates.
  await page.getByRole("button", { name: "Edit heart rate" }).click();
  const details = page.locator("#runnerDetails");
  await expect(details.locator("[name=maxHr]")).toBeFocused();
  await details.locator("[name=restHr]").fill("20");
  await details.locator("[name=restHr]").blur();
  await expect(details.locator(".runner-details-note")).toContainText("resting heart rate between 30 and 100");
  await details.locator("[name=restHr]").fill("45");
  await details.locator("[name=restHr]").blur();
  await expect(details.locator(".runner-details-note")).toHaveText("Saved on this device.");
  await page.locator("#accountDialogClose").click();
  await expect(page.locator("#profileSummary")).toContainText("resting HR 45 (saved)");
  await expect(vo2).not.toHaveText(before);
  await page.reload();
  expect(await page.evaluate(() => athleteProfile.restHr)).toBe(45);

  const report = await new AxeBuilder({ page }).include("#fitness").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(report.violations).toEqual([]);
});

test("today's readiness shapes the auto plan and says why", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  const readiness = await page.evaluate(() => planReadiness());
  const calendar = page.locator("#recommendedCalendar");
  if (readiness && readiness.score < 35) {
    await expect(page.locator("#intentRecommendation")).toContainText(`readiness today is ${readiness.score}/100`);
    await expect(page.locator("#planAdaptation")).toContainText("recovery week");
  } else if (readiness && readiness.score < 55) {
    await expect(calendar).not.toContainText("Quality option");
    await expect(calendar).toContainText(`Readiness ${readiness.score}/100: quality moved out this week`);
    await expect(page.locator("#planAdaptation")).toContainText("quality session is swapped");
  } else {
    await expect(page.locator("#planAdaptation")).not.toContainText("Readiness is");
  }
  // A manual intent is the runner's call: readiness no longer swaps sessions.
  await page.locator("summary").filter({ hasText: "Goal & availability" }).click();
  await page.locator("#goalMode").selectOption("build");
  await page.locator("#goalForm button[type=submit]").click();
  await expect(page.locator("#planAdaptation")).not.toContainText("Readiness is");
  // Weeks further out are not steered by today's readiness.
  expect(await page.evaluate(() => { selectedPlanOffset = 3; const value = planReadiness(); selectedPlanOffset = 1; return value; })).toBeNull();
});

test("theme follows the system and can be pinned, with accessible contrast in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/"); await importHistory(page);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();
  await preferences(page);
  await page.locator("#themePreference input[value=light]").check({ force: true });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await background()).not.toBe(dark);
  await page.locator("#themePreference input[value=dark]").check({ force: true });
  await page.reload(); await importHistory(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await background()).toBe(dark);
  for (const name of ["Overview", "Fitness", "Runs"]) {
    await view(page, name);
    const report = await new AxeBuilder({ page }).withTags(["wcag2aa"]).withRules(["color-contrast"]).analyze();
    expect(report.violations.filter((violation) => ["critical", "serious"].includes(violation.impact)), JSON.stringify(report.violations.map((violation) => violation.nodes.map((node) => node.target)))).toEqual([]);
  }
});

for (const [theme, base] of [["trail", "light"], ["ember", "dark"], ["ocean", "dark"], ["synthwave", "dark"], ["terminal", "dark"], ["broadsheet", "light"], ["blossom", "light"], ["blueprint", "dark"], ["aurora", "dark"], ["studio", "light"]]) {
  test(`the ${theme} theme recolours the app, survives a reload and keeps accessible contrast`, async ({ page }) => {
    // Still frames: contrast is measured on settled panels, not mid-animation.
    await page.emulateMedia({ colorScheme: base === "dark" ? "light" : "dark", reducedMotion: "reduce" });
    await page.goto("/"); await importHistory(page);
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const before = await background();
    await preferences(page);
    await page.locator(`#themePreference input[value=${theme}]`).check({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", base);
    await expect(page.locator("html")).toHaveAttribute("data-palette", theme);
    expect(await background()).not.toBe(before);
    await page.reload(); await importHistory(page);
    await expect(page.locator("html")).toHaveAttribute("data-palette", theme);
    await preferences(page);
    await expect(page.locator(`#themePreference input[value=${theme}]`)).toBeChecked();
    await page.keyboard.press("Escape");
    for (const name of ["Overview", "Fitness", "Plan", "Runs"]) {
      await view(page, name);
      const report = await new AxeBuilder({ page }).withTags(["wcag2aa"]).withRules(["color-contrast"]).analyze();
      expect(report.violations.filter((violation) => ["critical", "serious"].includes(violation.impact)), JSON.stringify(report.violations.map((violation) => violation.nodes.map((node) => `${node.target} ${node.any?.[0]?.message}`)))).toEqual([]);
    }
  });
}

test("themes that change the typeface still fit a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto("/");
  // A wide fallback face, so the check does not depend on which fonts this machine has.
  await page.addStyleTag({ content: `*, *::before, *::after { font-family: "DejaVu Sans", "Liberation Sans", sans-serif !important; }` });
  await importHistory(page);
  for (const theme of ["terminal", "broadsheet", "aurora", "studio"]) {
    await page.evaluate((name) => { preferences.theme = name; applyTheme(); render(); }, theme);
    for (const hash of ["#overview", "#fitness", "#planning", "#runs"]) {
      await page.evaluate((target) => { location.hash = target; }, hash);
      await expect(page.locator(hash)).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${theme} ${hash}`).toBeLessThanOrEqual(0);
    }
  }
});

test("aurora animates unless reduced motion is asked for, and its spotlight follows the mouse", async ({ page }) => {
  await page.goto("/"); await importHistory(page);
  await page.evaluate(() => { preferences.theme = "aurora"; applyTheme(); render(); });
  // The aurora layer, the readiness light and the page title are what move.
  const moving = () => page.evaluate(() => [getComputedStyle(document.body, "::after").animationName, getComputedStyle(document.querySelector(".today-strip"), "::after").animationName]);
  expect(await moving()).toEqual(["aurora-drift", "aurora-orbit"]);
  // Chart bars use the shared gradient.
  await expect(page.locator(".primary-chart .bar").first()).toHaveCSS("fill", /url\("?#aurora-bar"?\)/);
  const panel = page.locator(".chart-panel").first();
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700); // let the entrance animation settle
  const box = await panel.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 30);
  await expect.poll(() => panel.evaluate((node) => node.style.getPropertyValue("--mx"))).toBe("40px");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(moving).toEqual(["none", "none"]);
  // Leaving Aurora leaves no theme-specific decoration behind.
  await page.evaluate(() => { preferences.theme = "dark"; applyTheme(); });
  await expect(page.locator("html")).not.toHaveAttribute("data-palette", /.+/);
});

test("studio changes the layout: a sidebar and bento grid on wide screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/"); await importHistory(page);
  await page.evaluate(() => { preferences.theme = "studio"; applyTheme(); render(); });
  // The header is a sidebar down the left, with navigation stacked.
  const header = await page.locator(".app-header").boundingBox();
  expect(header.x).toBe(0);
  expect(header.height).toBeGreaterThanOrEqual(899);
  expect(header.width).toBeLessThan(300);
  const tabs = await page.locator(".app-nav a").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
  expect(new Set(tabs).size).toBe(4);
  // Overview: readiness tile beside the week, not above it.
  const today = await page.locator("#todayStrip").boundingBox();
  const week = await page.locator("#thisWeek").boundingBox();
  expect(week.x).toBeGreaterThan(today.x + today.width - 1);
  expect(Math.abs(week.y - today.y)).toBeLessThan(4);
  // Fitness: with a goal race, the training cycle sits beside readiness.
  await page.evaluate(() => { const date = new Date(); date.setDate(date.getDate() + 50); coachingContext.races = [{ id: "a", name: "City Half", date: localDateValue(date), distance: "Half marathon", priority: "A" }]; saveCoachingContext(); fitnessModelCache.key = ""; render(); });
  await view(page, "Fitness");
  const hero = await page.locator("#readinessHero").boundingBox();
  const cycle = await page.locator("#cyclePanel").boundingBox();
  expect(cycle.x).toBeGreaterThan(hero.x + hero.width - 1);
  expect(Math.abs(cycle.y - hero.y)).toBeLessThan(4);
  // Settings open beside the sidebar and stay on screen.
  await page.locator("#dataMenu > summary").click();
  const menu = await page.locator(".data-menu-panel").boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(header.width);
  expect(menu.y + menu.height).toBeLessThanOrEqual(900);
  await page.keyboard.press("Escape");

  // Phone: everything stays inside the page.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("this week compares completed runs with the plan or the recent average", async ({ page }) => {
  await page.goto("/"); await importHistory(page);
  const week = page.locator("#thisWeek");
  await expect(week).toBeVisible();
  await expect(week.locator(".week-day")).toHaveCount(7);
  await expect(week.locator(".week-day.is-today")).toHaveCount(1);
  await expect(week).toContainText("4-week average");
  await expect(week.getByRole("meter")).toHaveAttribute("aria-valuenow", /\d+/);
  // Saving this week's plan switches the target to the plan.
  await view(page, "Plan"); await page.locator("#previousPlanWeek").click(); await page.locator("#acceptPlanButton").click();
  await view(page, "Overview");
  await expect(week).toContainText("planned");
  await expect(week.getByRole("link", { name: /Open plan/ })).toBeVisible();
});

test("runs carry an effort-based type that the ledger can filter by", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Runs");
  await expect(page.locator("#activityRows .type-chip").first()).toBeVisible();
  const total = await page.locator("#activityRows tr").count();
  await page.locator("#runTypeFilter").selectOption("easy");
  const easy = await page.locator("#activityRows tr").count();
  expect(easy).toBeLessThanOrEqual(total);
  for (const chip of await page.locator("#activityRows .type-chip").allTextContents()) expect(["Easy", "Recovery"]).toContain(chip);
});

test("signed out, the plan downloads as a calendar file of saved weeks and races", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  await page.locator("#acceptPlanButton").click();
  await page.locator("#planCalendarDisclosure > summary").click();
  await expect(page.locator("#planCalendarCard")).toContainText("Sign in to get a calendar link");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download a calendar file (.ics)" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("runlore-plan.ics");
  const ics = require("node:fs").readFileSync(await download.path(), "utf8");
  expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
  const runs = await page.evaluate(() => acceptedPlans[planKey()].sessions.filter((session) => session.kind === "run").length);
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(runs);
  expect(ics).not.toContain("Rest / mobility");
});

test("signed in, a calendar link is created, offered to Apple and Google, copied, replaced and stopped", async ({ page }) => {
  let url = null; const calls = [];
  await page.route("**/api/calendar", (route) => {
    const method = route.request().method(); calls.push(method);
    if (method === "POST") url = `https://runlore.test/api/calendar/feed/${"a".repeat(31)}${calls.length}.ics`;
    if (method === "DELETE") url = null;
    return route.fulfill({ status: method === "POST" ? 201 : 200, json: { url } });
  });
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.copiedCalendar = value; } } }));
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  await page.evaluate(() => { state.account.signedIn = true; });
  await page.locator("#planCalendarDisclosure > summary").click();
  await page.getByRole("button", { name: "Create calendar link" }).click();
  const apple = page.getByRole("link", { name: "Add to Apple Calendar" });
  await expect(apple).toHaveAttribute("href", /^webcal:\/\/runlore\.test\/api\/calendar\/feed\/a{31}\d\.ics$/);
  const first = await page.locator("#planCalendarUrl").inputValue();
  await expect(page.getByRole("link", { name: /Add to Google Calendar/ })).toHaveAttribute("href", `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(first.replace("https:", "webcal:"))}`);
  const report = await new AxeBuilder({ page }).include("#planCalendarDisclosure").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(report.violations).toEqual([]);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => window.copiedCalendar)).toBe(first);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Make a new link" }).click();
  await expect(page.locator("#planCalendarUrl")).not.toHaveValue(first);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await expect(page.getByRole("button", { name: "Create calendar link" })).toBeVisible();
  expect(calls).toEqual(["GET", "POST", "POST", "DELETE"]);
  // Signing out forgets the link on screen.
  await page.evaluate(() => { state.account.signedIn = false; renderPlanCalendar(); });
  await expect(page.locator("#planCalendarCard")).toContainText("Sign in to get a calendar link");
});
