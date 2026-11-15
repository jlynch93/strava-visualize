const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

// iPhone-sized viewport: data should reach the first screen and navigation the thumb.
test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

async function loadDemo(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview demo data", exact: true }).click();
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);
}
const top = (locator) => locator.evaluate((element) => element.getBoundingClientRect().top);

test("the phone layout puts data on the first screen and navigation at the bottom", async ({ page }) => {
  await loadDemo(page);
  const header = await page.locator(".app-header").boundingBox();
  expect(header.height).toBeLessThan(100);
  // Tab bar pinned to the bottom edge, with every view reachable.
  const nav = await page.locator(".app-nav").boundingBox();
  expect(Math.round(nav.y + nav.height)).toBe(664);
  await expect(page.locator(".app-nav .nav-icon").first()).toBeVisible();
  expect(await top(page.locator("#todayStrip"))).toBeLessThan(220);
  // Filters stay reachable while scrolling.
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => top(page.locator(".toolbar"))).toBeLessThanOrEqual(1);

  await page.locator(".app-nav").getByRole("link", { name: "Fitness", exact: true }).click();
  expect(await top(page.locator("#readinessHero"))).toBeLessThan(260);
  await page.locator(".app-nav").getByRole("link", { name: "Runs", exact: true }).click();
  expect(await top(page.locator("#activityRows tr").first())).toBeLessThan(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("runs list options open on demand and rows stay two lines", async ({ page }) => {
  await loadDemo(page);
  await page.locator(".app-nav").getByRole("link", { name: "Runs", exact: true }).click();
  const toggle = page.locator("#ledgerOptionsToggle");
  await expect(toggle).toBeVisible();
  await expect(page.locator("#runSort")).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#runSort")).toBeVisible();
  await expect(page.locator("#runTypeFilter")).toBeVisible();
  const row = await page.locator("#activityRows tr").first().boundingBox();
  expect(row.height).toBeLessThan(80);
});

test("plan opens on the week, and confirmations are a dismissible toast", async ({ page }) => {
  await loadDemo(page);
  await page.locator(".app-nav").getByRole("link", { name: "Plan", exact: true }).click();
  expect(await top(page.locator("#planActions"))).toBeLessThan(await top(page.locator("#planning .coaching-grid")));
  await expect(page.locator("#previousPlanWeek")).toHaveAccessibleName("Previous week");
  // A page-level confirmation (not one scoped beside a button) becomes the toast.
  const status = page.locator("#status");
  await page.evaluate(() => { feedbackScopeId = null; setStatus("History synced."); });
  await expect(status).toBeVisible();
  const toast = await status.boundingBox();
  const nav = await page.locator(".app-nav").boundingBox();
  expect(toast.y + toast.height).toBeLessThanOrEqual(nav.y);
  await status.click();
  await expect(status).toHaveClass(/toast-dismissed/);
});

test("the phone layout has no serious accessibility violations", async ({ page }) => {
  await loadDemo(page);
  for (const name of ["Overview", "Fitness", "Runs"]) {
    await page.locator(".app-nav").getByRole("link", { name, exact: true }).click();
    const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(report.violations.filter((violation) => ["critical", "serious"].includes(violation.impact)), JSON.stringify(report.violations.map((violation) => [violation.id, violation.nodes.map((node) => node.target)]))).toEqual([]);
  }
});
