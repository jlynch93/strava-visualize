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
test("accepted plans retain editable distances and explicit statuses across reloads and filters", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  await page.locator("#acceptPlanButton").click(); await expect(page.locator("#acceptedPlan .saved-session")).toHaveCount(7);
  const row = page.locator("#acceptedPlan .saved-session").filter({ has: page.getByText("Long run", { exact: true }) });
  await row.locator('input[type="number"]').fill("4"); await row.locator('input[type="number"]').press("Tab");
  await row.locator("select").first().selectOption("skipped");
  const saved = await page.evaluate(() => JSON.stringify(acceptedPlans));
  await view(page, "Overview"); await page.locator("#bucketSelect").selectOption("month");
  expect(await page.evaluate(() => JSON.stringify(acceptedPlans))).toBe(saved);
  await page.reload(); await importHistory(page); await view(page, "Plan");
  const restored = page.locator("#acceptedPlan .saved-session").filter({ has: page.getByText("Long run", { exact: true }) });
  await expect(restored.locator('input[type="number"]')).toHaveValue("4.0");
  await expect(restored.locator("select").first()).toHaveValue("skipped");
  await page.locator("#previousPlanWeek").click(); await expect(page.locator("#acceptedPlan .saved-session")).toHaveCount(0);
  await page.locator("#nextPlanWeek").click(); await expect(page.locator("#acceptedPlan .saved-session")).toHaveCount(7);
});
test("saved sessions can be rescheduled and explicitly matched, never completing rest days automatically", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await view(page, "Plan");
  await page.locator("#previousPlanWeek").click(); await page.locator("#acceptPlanButton").click();
  const rows = page.locator("#acceptedPlan .saved-session");
  expect(await page.evaluate(() => acceptedPlans[planKey()].sessions.every((session) => session.status === "planned"))).toBe(true);
  const firstRun = rows.filter({ has: page.getByText("Quality option", { exact: true }) });
  const date = history()[0].start_date_local.slice(0, 10);
  await firstRun.locator('input[type="date"]').fill(date); await firstRun.locator('input[type="date"]').press("Tab");
  await firstRun.locator("select").last().selectOption("100");
  await expect(firstRun.locator("select").first()).toHaveValue("completed");
  expect(await page.evaluate(() => acceptedPlans[planKey()].sessions.filter((session) => session.matchedId === "100").length)).toBe(1);
});
test("unknown comparison coverage is not reported as improvement", async ({ page }) => {
  await page.goto("/"); await importHistory(page, history().slice(0, 3));
  await expect(page.locator("#blockReviewSummary")).toContainText("Insufficient comparison history");
  await expect(page.locator("#blockReviewTitle")).toHaveText("Your selected training block");
});
test("Strava sync merges recent changes, loads older history, caches the session, and reconnects after expiry", async ({ page }) => {
  const urls = []; let phase = 0;
  await page.route("**/api/status", (route) => route.fulfill({ json: { configured: true, connected: true, analysisService: "https://analysis.test", analysisModel: "test" } }));
  await page.route("**/api/activities?*", (route) => {
    const url = new URL(route.request().url()); urls.push(url); phase++;
    if (phase === 4) return route.fulfill({ status: 401, json: { error: "expired" } });
    const activities = phase === 1 ? history().slice(0, 2) : phase === 2 ? [{ ...history()[0], name: "Updated Strava run" }] : history().slice(2, 4);
    return route.fulfill({ json: { activities, truncated: phase === 1 } });
  });
  await page.goto("/"); await expect(page.locator("#syncInfo")).toContainText("2 activities");
  await page.locator("#connectButton").click(); await expect(page.locator("#status")).toContainText("Loaded 1 activities");
  expect(urls[1].searchParams.has("after")).toBe(true);
  await page.locator("#loadOlderButton").click(); await expect(page.locator("#syncInfo")).toContainText("3 activities");
  expect(urls[2].searchParams.has("before")).toBe(true);
  await page.reload(); await expect(page.locator("#syncInfo")).toContainText("3 activities"); expect(urls).toHaveLength(3);
  await page.locator("#connectButton").click(); await expect(page.locator("#status")).toContainText("session expired"); await expect(page.locator("#connectButton")).toHaveText("Connect Strava");
});
test("run details fetch and cache splits, support comparisons and previous/next navigation", async ({ page }) => {
  let details = 0;
  await page.route("**/api/status", (route) => route.fulfill({ json: { configured: true, connected: true } }));
  await page.route("**/api/activities?*", (route) => route.fulfill({ json: { activities: history(), truncated: false } }));
  await page.route(/\/api\/activities\/\d+$/, (route) => { details++; return route.fulfill({ json: { activity: { splits_metric: [{ distance: 1000, moving_time: 300, average_heartrate: 145 }] } } }); });
  await page.goto("/"); await expect(page.locator("#syncInfo")).toContainText("16 activities"); await view(page, "Runs");
  await page.locator(".row-detail-button").first().click(); await expect(page.locator("#enrichedRun")).toContainText("Recorded kilometer splits");
  await expect(page.getByRole("link", { name: "Open in Strava" })).toHaveAttribute("href", /strava.com\/activities\/100$/);
  await page.locator("#comparisonScope").selectOption("sport"); expect(details).toBe(1);
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
  await page.goto("/"); await importHistory(page); await page.locator("#aiAnalyzeButton").click();
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
  await expect(page.locator("#acceptedPlan .saved-session")).toHaveCount(7);
  await expect(page.locator("#status")).toContainText("browser storage failed");
});
