const { test, expect } = require("@playwright/test");

test("a runner can review demo history and open run details", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Demo data" }).click();
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);

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
