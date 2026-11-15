const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

// Sixteen runs and ten walks over the last month; three of the walks are hikes.
function mixedHistory() {
  const day = (offset) => {
    const date = new Date(); date.setDate(date.getDate() - offset); date.setHours(8, 0, 0, 0);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const runs = Array.from({ length: 16 }, (_, index) => ({
    id: String(100 + index), name: `Run ${index + 1}`, sport_type: "Run", start_date_local: `${day(index * 2)}T07:00:00Z`,
    distance: 8000, moving_time: 2600, average_heartrate: 150, max_heartrate: 180, total_elevation_gain: 40
  }));
  const walks = Array.from({ length: 10 }, (_, index) => ({
    id: String(500 + index), name: index < 3 ? `Hill hike ${index + 1}` : `Lunch walk ${index + 1}`, sport_type: index < 3 ? "Hike" : "Walk",
    start_date_local: `${day(index * 3 + 1)}T12:00:00Z`, distance: index < 3 ? 9000 : 3500, moving_time: index < 3 ? 7200 : 2400,
    average_heartrate: index < 3 ? 115 : 98, total_elevation_gain: index < 3 ? 600 : 20
  }));
  return [...runs, ...walks];
}

async function importHistory(page, activities = mixedHistory()) {
  await page.locator("#fileInput").setInputFiles({ name: "activities.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(activities)) });
  await page.locator("#importCoverage").check();
  await page.locator("#confirmImportButton").click();
  await expect(page.locator("#status")).toContainText("Imported");
}

async function chooseWalks(page) {
  await page.locator("#activityModeControl label").filter({ hasText: "Walks" }).click();
}

test("runs and walks are reviewed separately through the same views", async ({ page }) => {
  await page.goto("/"); await importHistory(page);
  const control = page.locator("#activityModeControl");
  await expect(control).toBeVisible();
  await expect(page.locator("#runModeCount")).toHaveText("16");
  await expect(page.locator("#walkModeCount")).toHaveText("10");
  // Run mode never counts walks.
  await expect(page.locator("#activityCount")).toHaveText("16 runs in range");

  await chooseWalks(page);
  await expect(page).toHaveURL(/activity=walk/);
  await expect(page.locator("#activityCount")).toHaveText("10 walks in range");
  await expect(page.locator(".app-nav a[href='#runs']")).toHaveText("Walks");
  await expect(page.locator("#keyRunsTitle")).toHaveText("Key walks in this block");
  // The same trend chart and drilldown, now over walks.
  const period = page.locator("#mainChart [role='button']").first();
  await expect(period).toHaveAccessibleName(/Open \d+ walks?\./);

  await page.getByRole("link", { name: "Walks", exact: true }).click();
  const names = await page.locator("#activityRows td[data-label='Name']").allTextContents();
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((name) => /walk|hike/i.test(name))).toBe(true);
  // Activity names are never rewritten by the walk wording.
  await page.locator("#activityModeControl label").filter({ hasText: "Runs" }).click();
  await expect(page.locator("#activityCount")).toHaveText("16 runs in range");
  await expect(page.locator(".app-nav a[href='#runs']")).toHaveText("Runs");
});

test("walks get their own types and filters", async ({ page }) => {
  await page.goto("/"); await importHistory(page); await chooseWalks(page);
  await page.getByRole("link", { name: "Walks", exact: true }).click();
  const filter = page.locator("#runTypeFilter");
  await expect(filter.locator("option[value='quality']")).toHaveText("Hikes");
  await filter.selectOption("quality");
  await expect(page.locator("#activityRows tr")).toHaveCount(3);
  for (const chip of await page.locator("#activityRows .type-chip").allTextContents()) expect(chip).toBe("Hike");
  await filter.selectOption("easy");
  for (const chip of await page.locator("#activityRows .type-chip").allTextContents()) expect(["Walk", "Long walk"]).toContain(chip);
});

test("walks add to training load while VO2 max stays run-only", async ({ page }) => {
  await page.goto("/"); await importHistory(page);
  await page.getByRole("link", { name: "Fitness", exact: true }).click();
  await expect(page.locator("#fitnessNotes")).toContainText("Walks count toward fitness, fatigue and readiness");
  const model = await page.evaluate(() => {
    const value = fitnessModel();
    const walkLoad = [...value.walkDayLoads.values()].reduce((sum, load) => sum + load, 0);
    const runLoad = [...value.runDayLoads.values()].reduce((sum, load) => sum + load, 0);
    const total = [...value.loads.values()].reduce((sum, load) => sum + load, 0);
    return { walks: value.walks.length, vo2Samples: value.vo2Points.length, runs: value.runs.length, walkLoad, runLoad, total };
  });
  expect(model.walks).toBe(10);
  expect(model.vo2Samples).toBe(model.runs);
  expect(model.walkLoad).toBeGreaterThan(0);
  expect(Math.abs(model.total - (model.walkLoad + model.runLoad))).toBeLessThan(0.001);
  // The load tooltip separates the two sources.
  await page.locator("#loadChart svg").focus();
  await expect(page.locator("#chartTooltip")).toContainText("from walks");
});

test("walk mode survives a reload and the coach is told it is reading walks", async ({ page }) => {
  let payload;
  await page.route("**/api/insights", async (route) => { payload = route.request().postDataJSON(); await route.fulfill({ status: 503, json: { error: "test" } }); });
  await page.goto("/?activity=walk"); await importHistory(page);
  await expect(page.locator("#activityModeControl input[value='walk']")).toBeChecked();
  await expect(page.locator("#activityCount")).toHaveText("10 walks in range");
  await page.locator("#coachDisclosure > summary").click(); await page.locator("#aiAnalyzeButton").click();
  await page.locator("#allowAnalysisButton").click();
  await expect.poll(() => payload?.activity).toBe("walk");
  expect(payload.recentRuns.length).toBeGreaterThan(0);
});

test("the switch stays hidden without walks and walk mode is accessible", async ({ page }) => {
  await page.goto("/?activity=walk");
  await importHistory(page, mixedHistory().filter((activity) => activity.sport_type === "Run"));
  await expect(page.locator("#activityModeControl")).toBeHidden();
  // A walk link with no walks falls back to runs instead of an empty dashboard.
  await expect(page.locator("#activityCount")).toHaveText("16 runs in range");
  await importHistory(page);
  await chooseWalks(page);
  const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(report.violations.filter((violation) => ["critical", "serious"].includes(violation.impact)), JSON.stringify(report.violations)).toEqual([]);
});
