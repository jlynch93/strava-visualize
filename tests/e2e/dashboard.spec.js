const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");

// More than two pages, with distinct oldest, longest, and fastest runs. This
// avoids depending on random demo values or the date when a test happens to run.
const ledgerActivities = Array.from({ length: 38 }, (_, index) => {
  const distanceMiles = index === 3 ? 17 : 3 + index % 5;
  return {
    id: `fixture-${index + 1}`,
    name: index === 0 ? "Riverside recovery" : index === 3 ? "Longest run" : index === 6 ? "Fastest run" : index === 19 ? 'Training run 20, "river loop"' : `Training run ${String(index + 1).padStart(2, "0")}`,
    sport_type: "Run",
    start_date: new Date(Date.UTC(2025, 0, index + 1, 8)).toISOString(),
    start_date_local: index === 1 ? "" : new Date(Date.UTC(2025, 0, index + 1, 8)).toISOString(),
    distance: distanceMiles * 1609.344,
    moving_time: distanceMiles * (index === 6 ? 400 : 450 + index),
    total_elevation_gain: 20 + index,
    average_heartrate: 140 + index % 10
  };
});

async function importLedger(page) {
  await page.locator("#fileInput").setInputFiles({
    name: "training-history.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(ledgerActivities))
  });
  await expect(page.locator("#status")).toContainText("Imported 38 activities.");
}

async function loadLedger(page) {
  await page.goto("/");
  await importLedger(page);
  await expect(page.locator("#activityCount")).toHaveText("38 runs in range");
}

async function loadDemoBlock(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Demo data", exact: true }).click();
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);
}

test("first use presents onboarding and reveals the dashboard after data is loaded", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bring your training history into view." })).toBeVisible();
  for (const selector of [".toolbar", "#overview", ".key-runs", "#planning", ".training-texture", ".advanced-exploration", ".dashboard", "#runs"]) {
    const sections = page.locator(selector);
    for (let index = 0; index < await sections.count(); index += 1) {
      await expect(sections.nth(index)).toBeHidden();
    }
  }
  await expect(page.locator("#emptyWindow")).toBeHidden();

  await page.getByRole("button", { name: "Preview demo data", exact: true }).click();
  await expect(page.locator(".onboarding")).toBeHidden();
  await expect(page.locator("#overview")).toBeVisible();
  await expect(page.locator("#dataSource")).toContainText("Demo");
  await expect(page.locator("#goalForm")).toBeHidden();
  await expect(page.locator("#checkinForm")).toBeHidden();
  await page.locator("summary").filter({ hasText: "Goal & availability" }).click();
  await expect(page.locator("#goalMiles")).toBeVisible();
});

test("a runner can review demo history and open run details", async ({ page }) => {
  await loadDemoBlock(page);
  await expect(page.getByRole("heading", { name: "Small patterns around your running" })).toBeVisible();
  await expect(page.locator("#trainingTextureStats .texture-stat")).toHaveCount(5);

  const detailButton = page.locator("#activityRows .row-detail-button").first();
  await detailButton.click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { level: 2 })).not.toBeEmpty();
  await page.getByRole("button", { name: "Close workout details" }).click();
  await expect(modal).toBeHidden();
  await expect(detailButton).toBeFocused();
});

test("interactive charts and the training calendar respond to runner input", async ({ page }) => {
  await loadLedger(page);
  const calendarDays = page.locator("#recommendedCalendar [data-action='cycle-plan-status']");
  await expect(calendarDays).toHaveCount(7);
  await calendarDays.first().click();
  await expect(calendarDays.first()).toHaveClass(/completed/);
  await expect(calendarDays.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(calendarDays.first()).toHaveClass(/skipped/);
  await expect(calendarDays.first()).toBeFocused();

  const chartAction = page.locator("#structureChart [role='button']").first();
  await expect(chartAction).toBeVisible();
  await chartAction.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Chart selection");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the main trend supports keyboard drilldown and returns focus to the selected period", async ({ page }) => {
  await loadLedger(page);
  const chartAction = page.locator("#mainChart [role='button']").first();
  await expect(chartAction).toHaveAccessibleName(/Open \d+ runs?\./);
  await chartAction.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Chart selection");
  await expect(dialog.locator(".chart-run-option")).toHaveCount(5);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(chartAction).toBeFocused();

  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  const runChoice = dialog.locator(".chart-run-option").first();
  const runName = await runChoice.locator("strong").textContent();
  await runChoice.click();
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(runName);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the run ledger reaches every page and searches the full selected history", async ({ page }) => {
  await loadLedger(page);
  const rows = page.locator("#activityRows tr");
  await expect(rows).toHaveCount(15);
  await expect(page.locator("#pageSummary")).toHaveText("1–15 of 38 runs");
  await expect(page.locator("#previousPage")).toBeDisabled();
  await expect(rows.first()).toHaveAttribute("data-activity-id", "fixture-38");

  await page.locator("#nextPage").click();
  await expect(page.locator("#pageSummary")).toHaveText("16–30 of 38 runs");
  await expect(rows.first()).toHaveAttribute("data-activity-id", "fixture-23");
  await page.locator("#nextPage").click();
  await expect(page.locator("#pageSummary")).toHaveText("31–38 of 38 runs");
  await expect(rows).toHaveCount(8);
  await expect(page.locator("#nextPage")).toBeDisabled();
  await expect(rows.last()).toContainText("Riverside recovery");
  await page.locator("#previousPage").click();
  await expect(page.locator("#pageSummary")).toHaveText("16–30 of 38 runs");

  await page.locator("#runSearch").fill("rIvErSiDe");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Riverside recovery");
  await expect(page.locator("#pageSummary")).toHaveText("1–1 of 1 runs matching your search");
  await expect(page.locator("#previousPage")).toBeDisabled();
  await expect(page.locator("#nextPage")).toBeDisabled();
  await expect(page.locator("#activityCount")).toHaveText("38 runs in range");

  await page.locator("#runSearch").fill("there is no run with this name");
  await expect(rows).toHaveCount(0);
  await expect(page.locator("#ledgerEmpty")).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator("#runSearch")).toHaveValue("");
  await expect(rows).toHaveCount(15);
  await expect(page.locator("#ledgerEmpty")).toBeHidden();
});

test("ledger sorting considers runs beyond the current page", async ({ page }) => {
  await loadLedger(page);
  await page.locator("#nextPage").click();
  for (const [sort, expectedId] of [["oldest", "fixture-1"], ["distance", "fixture-4"], ["pace", "fixture-7"], ["newest", "fixture-38"]]) {
    await page.locator("#runSort").selectOption(sort);
    await expect(page.locator("#activityRows tr").first()).toHaveAttribute("data-activity-id", expectedId);
    await expect(page.locator("#pageSummary")).toHaveText("1–15 of 38 runs");
  }
});

test("an empty custom window keeps imported history available for recovery", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loadLedger(page);
  await page.locator("#rangeSelect").selectOption("custom");
  await page.locator("#startDate").fill("2025-02-10");
  await page.locator("#endDate").fill("2025-02-20");
  await expect(page.locator("#emptyWindow")).toBeVisible();
  await expect(page.locator("#emptyWindowTitle")).toHaveText("No runs in this window");
  await expect(page.locator(".onboarding")).toBeHidden();
  await expect(page.locator(".toolbar")).toBeVisible();
  await page.getByRole("button", { name: "Show all history", exact: true }).click();
  await expect(page.locator("#emptyWindow")).toBeHidden();
  await expect(page.locator("#rangeSelect")).toHaveValue("all");
  await expect(page.locator("#activityCount")).toHaveText("38 runs in range");
  await expect(page.locator("#dataSource")).toHaveText("Imported activity history");
  await page.locator("#rangeSelect").selectOption("custom");
  await page.locator("#startDate").fill("");
  await page.locator("#startDate").press("Tab");
  await page.locator("#endDate").fill("");
  await page.locator("#endDate").press("Tab");
  await expect(page.locator("#windowDates")).toHaveText("Earliest run – Latest run");
  await expect(page.locator("#activityCount")).toHaveText("38 runs in range");
  expect(errors).toEqual([]);
});

test("view links restore dates, chart settings, and ledger filters after reimport", async ({ page }) => {
  await loadLedger(page);
  await page.locator("#rangeSelect").selectOption("custom");
  await page.locator("#startDate").fill("2025-01-10");
  await page.locator("#endDate").fill("2025-01-20");
  await page.locator("#bucketSelect").selectOption("month");
  await page.locator("#metricSelect").selectOption("pace");
  await page.locator("#runSearch").fill("Training");
  await page.locator("#runSort").selectOption("oldest");
  await expect(page.locator("#pageSummary")).toHaveText("1–11 of 11 runs matching your search");

  expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({
    range: "custom", start: "2025-01-10", end: "2025-01-20", group: "month", metric: "pace", search: "Training", sort: "oldest"
  });
  await page.reload();
  await importLedger(page);
  for (const [id, value] of [["rangeSelect", "custom"], ["startDate", "2025-01-10"], ["endDate", "2025-01-20"], ["bucketSelect", "month"], ["metricSelect", "pace"], ["runSearch", "Training"], ["runSort", "oldest"]]) {
    await expect(page.locator(`#${id}`)).toHaveValue(value);
  }
  await expect(page.locator("#mainChartTitle")).toHaveText("Pace trend");
  await expect(page.locator("#activityCount")).toHaveText("11 runs in range");
  await expect(page.locator("#activityRows tr").first()).toHaveAttribute("data-activity-id", "fixture-10");
});

test("CSV export includes the full window and reimports every run name and distance", async ({ page }) => {
  await loadLedger(page);
  await page.locator("#nextPage").click();
  await expect(page.locator("#pageSummary")).toHaveText("16–30 of 38 runs");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("run-trends-2025-01-01-to-2025-02-07.csv");
  const csv = await readFile(await download.path());
  expect(csv.toString("utf8").trim().split(/\r?\n/)).toHaveLength(39);
  await expect(page.locator("#status")).toContainText("Exported 38 runs");

  await page.locator("#fileInput").setInputFiles({
    name: download.suggestedFilename(), mimeType: "text/csv", buffer: csv
  });
  await expect(page.locator("#status")).toContainText("Imported 38 activities.");
  await expect(page.locator("#activityCount")).toHaveText("38 runs in range");
  await page.locator("#runSort").selectOption("oldest");
  for (let offset = 0; offset < ledgerActivities.length; offset += 15) {
    const expectedRuns = ledgerActivities.slice(offset, offset + 15);
    await expect(page.locator("#activityRows td[data-label='Name']")).toHaveText(expectedRuns.map((run) => run.name));
    await expect(page.locator("#activityRows td[data-label='Distance']")).toHaveText(expectedRuns.map((run) => `${(run.distance / 1609.344).toFixed(2)} mi`));
    if (offset + 15 < ledgerActivities.length) await page.locator("#nextPage").click();
  }
  await expect(page.locator("#nextPage")).toBeDisabled();
});

test("copy view link writes the selected filters and confirms the copy", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.copiedViewLink = value; } }
    });
  });
  await loadLedger(page);
  await page.locator("#rangeSelect").selectOption("30");
  await page.locator("#runSearch").fill("Training");
  await page.locator("#runSort").selectOption("distance");
  await page.getByRole("button", { name: "Copy view link", exact: true }).click();
  await expect(page.locator("#copyViewButton")).toHaveText("Link copied");
  const copiedLink = await page.evaluate(() => window.copiedViewLink);
  expect(copiedLink).toBe(page.url());
  expect(Object.fromEntries(new URL(copiedLink).searchParams)).toMatchObject({
    range: "30", search: "Training", sort: "distance"
  });
});

test("the plan summary matches a three-run calendar and its Sunday long-run cap", async ({ page }) => {
  await loadLedger(page);
  await page.locator("summary").filter({ hasText: "Goal & availability" }).click();
  await page.locator("#goalMode").selectOption("maintain");
  await page.locator("#goalMiles").fill("20");
  await page.locator("#goalRunDays").selectOption("3");
  await page.locator("#goalLongRunDay").selectOption("Sun");
  await page.locator("#goalAvailability").fill("Mon, Wed, Sun");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();

  const plannedRuns = page.locator("#recommendedCalendar [data-plan-kind='run']");
  await expect(plannedRuns).toHaveCount(3);
  await expect(plannedRuns.locator("span")).toHaveText(["Mon", "Wed", "Sun"]);
  const longRun = plannedRuns.filter({ has: page.locator("strong").getByText("Long run", { exact: true }) });
  await expect(longRun).toHaveCount(1);
  await expect(longRun.locator("span")).toHaveText("Sun");
  await expect(longRun.locator("small")).toHaveText("At or below 7.0 mi");
  await expect(page.locator("#planDraftCopy")).toContainText("18–20 mi across 3 planned runs.");
  await expect(page.locator("#planDraftCopy")).toContainText("Sun long run: up to 7.0 mi.");
});

test("a missed session adapts the next-week plan without asking the runner to make it up", async ({ page }) => {
  await loadLedger(page);
  await page.locator("summary").filter({ hasText: "Weekly check-in" }).click();
  await page.locator("#checkinOutcome").selectOption("missed");
  await page.getByRole("button", { name: "Save check-in" }).click();
  await expect(page.locator("#planAdaptation")).toContainText("missed session");
  await expect(page.locator("#recommendedCalendar")).not.toContainText("Quality option");
});

test("an unavailable coach read explains the failure without breaking the dashboard", async ({ page }) => {
  let coachPayload;
  await page.route("**/api/insights", (route) => {
    coachPayload = route.request().postDataJSON();
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Coach service is temporarily unavailable." })
    });
  });
  await loadLedger(page);
  await page.locator("#coachQuestion").fill("Should I keep the quality session this week?");
  await page.getByRole("button", { name: "Analyze this block" }).click();
  const coachRead = page.locator("#aiInsightContent");
  await expect(coachRead).toContainText("The model did not return an analysis");
  await expect(coachRead).toContainText("Coach service is temporarily unavailable.");
  await expect(page.locator("#activityRows .row-detail-button")).not.toHaveCount(0);
  expect(coachPayload.question).toBe("Should I keep the quality session this week?");
});

test.describe("mobile runner review", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the block review, ledger navigation, and run details usable", async ({ page }) => {
    await loadLedger(page);
    await expect(page.getByRole("heading", { name: "Small patterns around your running" })).toBeVisible();
    await expect(page.locator("#trainingTextureStats .texture-stat")).toHaveCount(5);
    await page.locator("#nextPage").click();
    await expect(page.locator("#pageSummary")).toHaveText("16–30 of 38 runs");
    await page.locator("#activityRows .row-detail-button").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
