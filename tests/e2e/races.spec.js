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

async function addRace(page, { name, offset, distance, priority }) {
  await page.fill("#raceName", name);
  await page.fill("#raceDate", iso(offset));
  await page.selectOption("#raceDistance", distance);
  await page.selectOption("#racePriority", priority);
  await page.locator("#raceForm button[type=submit]").click();
}

const nav = (page, name) => page.locator(".app-nav").getByRole("link", { name, exact: true }).click();

test("races are added by priority, saved, and removable", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Plan");
  await page.locator("#racesDisclosure > summary").click();
  await expect(page.locator("#raceList")).toContainText("No races yet");
  await addRace(page, { name: "City Marathon", offset: 56, distance: "Marathon", priority: "A" });
  await addRace(page, { name: "Turkey Trot", offset: 21, distance: "10K", priority: "B" });
  const items = page.locator("#raceList .race-item");
  await expect(items).toHaveCount(2);
  // Sorted by date, each with its priority; the A race shows the current phase.
  await expect(items.nth(0).locator(".race-priority")).toHaveText("B");
  await expect(items.nth(1).locator(".race-priority")).toHaveText("A");
  await expect(items.nth(1).locator(".race-phase")).toHaveText("Build");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("run-trends-coaching-context-v1")).races.map((race) => race.priority).sort());
  expect(saved).toEqual(["A", "B"]);
  await items.nth(0).getByRole("button", { name: /Remove Turkey Trot/ }).click();
  await expect(items).toHaveCount(1);
});

test("readiness follows the training cycle toward the goal race", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Plan");
  await page.locator("#racesDisclosure > summary").click();
  await addRace(page, { name: "City Marathon", offset: 56, distance: "Marathon", priority: "A" });
  await nav(page, "Fitness");
  await expect(page.locator(".cycle-chip")).toHaveText("Build · City Marathon in 8 weeks");
  await expect(page.locator(".readiness-factors")).toContainText("Training cycle");
  await expect(page.locator(".readiness-advice")).toContainText(/^Build phase/);
  const cycle = page.locator("#cyclePanel");
  await expect(cycle).toBeVisible();
  await expect(cycle.locator(".cycle-segment.is-current")).toContainText("Build");
  await expect(cycle.locator(".cycle-today")).toBeVisible();
  await expect(cycle).toContainText("56 days to go");
  await nav(page, "Overview");
  await expect(page.locator("#todayStrip .today-label")).toHaveText("Readiness today · Build");

  // Three days after the race: recovery comes first, however fresh it feels.
  await page.evaluate((date) => { coachingContext.races = [{ id: "m", name: "City Marathon", date, distance: "Marathon", priority: "A" }]; saveCoachingContext(); fitnessModelCache.key = ""; render(); }, iso(-3));
  await nav(page, "Fitness");
  await expect(page.locator(".cycle-chip")).toContainText("Recovery");
  await expect(page.locator(".readiness-verdict")).not.toContainText("Primed");
  await expect(page.locator(".readiness-advice")).toContainText("Recovering from your race");
  await expect(cycle.locator(".cycle-segment.is-current")).toContainText("Recovery");
});

test("a goal race saved before the race calendar becomes the A race", async ({ page }) => {
  await page.addInitScript((date) => {
    localStorage.setItem("run-trends-coaching-context-v1", JSON.stringify({ goal: { raceName: "Old Goal Half", raceDistance: "Half marathon", raceDate: date }, checkin: {}, plan: {} }));
  }, iso(40));
  await loadDemo(page);
  const races = await page.evaluate(() => coachingContext.races);
  expect(races).toHaveLength(1);
  expect(races[0]).toMatchObject({ name: "Old Goal Half", distance: "Half marathon", priority: "A" });
  await nav(page, "Fitness");
  await expect(page.locator(".cycle-chip")).toContainText("Old Goal Half");
});

test("a tune-up race in the planned week takes its day on the calendar", async ({ page }) => {
  await loadDemo(page);
  const saturday = await page.evaluate(() => { const start = selectedPlanStart(); start.setDate(start.getDate() + 5); return localDateValue(start); });
  await page.evaluate((date) => { coachingContext.races = [{ id: "b", name: "Turkey Trot", date, distance: "10K", priority: "B" }]; saveCoachingContext(); render(); }, saturday);
  await nav(page, "Plan");
  const raceDay = page.locator("#recommendedCalendar .race-day");
  await expect(raceDay).toHaveCount(1);
  await expect(raceDay).toContainText("Turkey Trot · 10K (B race)");
  await expect(raceDay).toHaveAttribute("data-plan-date", saturday);
});

test("without races nothing about readiness changes", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Fitness");
  await expect(page.locator("#cyclePanel")).toBeHidden();
  await expect(page.locator(".cycle-chip")).toHaveCount(0);
  await expect(page.locator(".readiness-factors")).not.toContainText("Training cycle");
});

test("races and goals survive a reload", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Plan");
  await page.locator("#racesDisclosure > summary").click();
  await addRace(page, { name: "City Marathon", offset: 56, distance: "Marathon", priority: "A" });
  await page.evaluate(() => { coachingContext.goal.miles = "30"; saveCoachingContext(); });
  await page.reload();
  const context = await page.evaluate(() => ({ races: coachingContext.races.map((race) => race.name), miles: coachingContext.goal.miles }));
  expect(context).toEqual({ races: ["City Marathon"], miles: "30" });
});
