const { test, expect } = require("@playwright/test");

test("a runner can review demo history and navigate run details", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Demo data" }).click();
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);

  const detailButtons = page.locator("#activityRows .row-detail-button");
  await expect(detailButtons).not.toHaveCount(0);
  await detailButtons.first().click();

  const modal = page.locator("#workoutModal");
  await expect(modal).toHaveAttribute("open", "");
  await expect(page.locator("#workoutModalTitle")).not.toBeEmpty();

  const initialRun = await page.locator("#workoutModalMeta").textContent();
  const adjacentRun = modal.locator("button[data-action='navigate-run']:not([disabled])");
  await expect(adjacentRun).toHaveCount(1);
  await adjacentRun.click();
  await expect(page.locator("#workoutModalMeta")).not.toHaveText(initialRun || "");

  await page.getByRole("button", { name: "Close workout details" }).click();
  await expect(modal).not.toHaveAttribute("open", "");
});
