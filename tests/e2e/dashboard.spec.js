const { test, expect } = require("@playwright/test");

async function loadDemoBlock(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Demo data" }).click();
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);
}

test("a runner can review demo history and open run details", async ({ page }) => {
  await loadDemoBlock(page);
  await expect(page.getByRole("heading", { name: "Small patterns around your running" })).toBeVisible();
  await expect(page.locator("#trainingTextureStats .texture-stat")).toHaveCount(5);

  const detailButtons = page.locator("#activityRows .row-detail-button");
  await expect(detailButtons).not.toHaveCount(0);
  await detailButtons.first().click();

  // The current dashboard uses a native dialog; the redesigned dashboard uses
  // an accessible dialog inside a backdrop. Test the behavior the runner sees,
  // rather than either implementation's visibility attribute.
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { level: 2 })).not.toBeEmpty();

  await page.getByRole("button", { name: "Close workout details" }).click();
  await expect(modal).toBeHidden();
});

test("interactive charts and the training calendar respond to runner input", async ({ page }) => {
  await loadDemoBlock(page);

  const calendarDays = page.locator("#recommendedCalendar [data-action='cycle-plan-status']");
  await expect(calendarDays).toHaveCount(7);
  await calendarDays.first().click();
  await expect(calendarDays.first()).toHaveClass(/completed/);

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

test("an unavailable coach read explains the failure without breaking the dashboard", async ({ page }) => {
  await page.route("**/api/insights", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Coach service is temporarily unavailable." })
  }));
  await loadDemoBlock(page);

  await page.getByRole("button", { name: "Analyze this block" }).click();
  const coachRead = page.locator("#aiInsightContent");
  await expect(coachRead).toContainText("The model did not return an analysis");
  await expect(coachRead).toContainText("Coach service is temporarily unavailable.");
  await expect(page.locator("#activityRows .row-detail-button")).not.toHaveCount(0);
});

test.describe("mobile runner review", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the block review, stats, and run details usable", async ({ page }) => {
    await loadDemoBlock(page);
    await expect(page.getByRole("heading", { name: "Small patterns around your running" })).toBeVisible();
    await expect(page.locator("#trainingTextureStats .texture-stat")).toHaveCount(5);
    await page.locator("#activityRows .row-detail-button").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
