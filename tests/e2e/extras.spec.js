const { test, expect } = require("@playwright/test");

const iso = (offset) => {
  const date = new Date(); date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
async function loadDemo(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview demo data", exact: true }).click();
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);
}
const nav = (page, name) => page.locator(".app-nav").getByRole("link", { name, exact: true }).click();

test("records list your bests, open the run behind them, and step aside for walks", async ({ page }) => {
  await loadDemo(page);
  const records = page.locator("#records");
  await expect(records).toBeVisible();
  await expect(records.locator(".record")).toHaveCount(7);
  for (const label of ["Longest run", "Fastest 5–10K run", "Fastest 10K–half run", "Fastest half+ run", "Most climbing", "Biggest week", "Longest streak"]) {
    await expect(records.locator(".record-label", { hasText: label })).toHaveCount(1);
  }
  // A record set inside the window opens its run.
  const openable = records.locator(".record-open").first();
  await openable.click();
  await expect(page.locator("#workoutModal")).toBeVisible();
  await page.keyboard.press("Escape");
  // Walk mode: records are about runs, so they step aside.
  await page.locator('input[name="activityMode"][value="walk"]').check({ force: true });
  await expect(records).toBeHidden();
});

test("aerobic efficiency charts metres per heartbeat and says which way it is going", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Fitness");
  const panel = page.locator("#efficiencyPanel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("#efficiencySummary")).toContainText(/per heartbeat/);
  await expect(panel.locator("#efficiencyChart svg")).toBeVisible();
  await page.evaluate(() => { const select = document.querySelector("#unitPreference"); select.value = "metric"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await expect(panel.locator("#efficiencySummary")).toContainText(/\d\.\d\d m per heartbeat/);
});

test("a goal race gets a pacing plan that lands on the goal, in miles or kilometres", async ({ page }) => {
  await loadDemo(page);
  await page.evaluate((date) => { coachingContext.races = [sanitizeRace({ id: "h", name: "City Half", date, distance: "Half marathon", priority: "A", goalSeconds: 5700 })]; saveCoachingContext(); fitnessModelCache.key = ""; render(); }, iso(40));
  await nav(page, "Fitness");
  const plan = page.locator(".goal-race .pacing-plan").first();
  await expect(plan.locator("summary")).toContainText("for your goal of 1:35:00");
  await plan.locator("summary").click();
  const rows = plan.locator("tbody tr");
  await expect(rows).toHaveCount(14);
  await expect(rows.last().locator("td").first()).toContainText("1:35:00");
  await expect(rows.last().locator("td").nth(1)).toContainText("1:35:00");
  // It stays open through a re-render, and follows the unit setting.
  await page.evaluate(() => { const select = document.querySelector("#unitPreference"); select.value = "metric"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await expect(page.locator(".goal-race .pacing-plan").first()).toHaveAttribute("open", "");
  await expect(page.locator(".goal-race .pacing-plan tbody tr")).toHaveCount(22);
});

test("the command palette jumps to views, themes, ranges and runs from the keyboard", async ({ page }) => {
  await loadDemo(page);
  const dialog = page.locator("#commandPalette");
  const input = page.locator("#paletteInput");
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("fitness");
  await expect(page.locator(".palette-item.is-active")).toContainText("Fitness");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#fitness")).toBeVisible();

  await page.locator("body").press("/");
  await expect(dialog).toBeVisible();
  await input.fill("ember");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ember");

  await page.keyboard.press("Control+k");
  await input.fill("last year");
  await page.keyboard.press("Enter");
  await expect(page.locator("#rangeSelect")).toHaveValue("365");

  // Runs are found by name; arrow keys move, Enter opens.
  await page.keyboard.press("Control+k");
  await input.fill("long run");
  await expect(page.locator(".palette-group").first()).toHaveText("Runs");
  await expect(page.locator(".palette-item").first()).toContainText("Long run");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".palette-item").nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", "palette-1");
  await page.keyboard.press("Enter");
  await expect(page.locator("#workoutModal")).toBeVisible();
  await page.keyboard.press("Escape");

  // Nothing matches: it says so. Escape closes.
  await page.keyboard.press("Control+k");
  await input.fill("zzzz");
  await expect(page.locator(".palette-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the week becomes a shareable image made on the device", async ({ page }) => {
  await loadDemo(page);
  await page.locator("#thisWeek").getByRole("button", { name: /Share week/ }).click();
  const dialog = page.locator("#recapDialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#recapImage")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.locator("#recapImage")).toHaveAttribute("alt", /Weekly recap: .* over \d+ runs?/);
  await expect(page.locator("#recapDownload")).toHaveAttribute("download", /^runlore-week-\d{4}-\d{2}-\d{2}\.png$/);
  await expect(page.locator("#recapDownload")).toHaveAttribute("href", /^(blob:|data:image\/png)/);
  const size = await page.locator("#recapImage").evaluate((image) => [image.naturalWidth, image.naturalHeight]);
  expect(size).toEqual([1080, 1350]);
  await page.locator("#recapClose").click();
  await expect(dialog).toBeHidden();
});
