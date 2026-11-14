const { test, expect } = require("@playwright/test");

// Regression: the run detail sheet had overflow: hidden, so content below the
// first screen (splits, comparisons, weather, coach) couldn't be reached.
// Scroll with a real wheel gesture, as a runner would, not element.scrollTo().
for (const viewport of [{ width: 1280, height: 600 }, { width: 390, height: 700 }]) {
  test(`the run detail sheet scrolls with the mouse wheel at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#runs");
    await page.getByRole("button", { name: "Preview demo data", exact: true }).click();
    await page.locator("#activityRows .row-detail-button").first().click();
    const sheet = page.locator(".workout-modal");
    await expect(sheet).toBeVisible();

    const metrics = await sheet.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollable: element.scrollHeight > element.clientHeight
    }));
    expect(["auto", "scroll"]).toContain(metrics.overflowY);
    expect(metrics.scrollable).toBe(true);

    // Opening a run can scroll the page to it first; measure from here.
    const pageScroll = await page.evaluate(() => window.scrollY);
    const box = await sheet.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => sheet.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    // The last section is reachable.
    const coach = page.locator("#runCoach > summary");
    await coach.scrollIntoViewIfNeeded();
    await expect(coach).toBeInViewport();

    // Scrolling stays inside the sheet; the page behind doesn't move.
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  });
}
