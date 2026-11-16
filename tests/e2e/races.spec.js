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

test("searching RunSignup fills the race form, and the race keeps its link", async ({ page }) => {
  const searches = [];
  await page.route("**/api/races/search?*", (route) => {
    searches.push(new URL(route.request().url()));
    return route.fulfill({ json: { source: "RunSignup", races: [{
      id: "1", name: "Riverfront Turkey Trot", date: iso(9), city: "Columbus", state: "OH", url: "https://runsignup.com/Race/OH/Columbus/RiverfrontTurkeyTrot",
      events: [
        { id: "a", name: "5K", date: iso(9), km: 5, distance: "5K", walk: false },
        { id: "b", name: "4 Mile Run", date: iso(9), km: 6.44, distance: "Other", walk: false },
        { id: "c", name: "Fun Walk", date: iso(9), km: null, distance: "Other", walk: true }
      ] }] } });
  });
  await loadDemo(page);
  await nav(page, "Plan");
  await page.locator("#racesDisclosure > summary").click();
  await page.fill("#raceSearch", "tu");
  await expect(page.locator("#raceSearchStatus")).toContainText("at least three letters");
  expect(searches).toHaveLength(0);
  await page.fill("#raceSearch", "turkey trot");
  await page.fill("#raceSearchState", "oh");
  const result = page.locator(".race-result");
  await expect(result).toHaveCount(1);
  expect(searches.at(-1).searchParams.get("q")).toBe("turkey trot");
  expect(searches.at(-1).searchParams.get("state")).toBe("oh");
  await expect(result.locator(".race-event")).toHaveText(["5K", "4 Mile Run", "Fun Walk · walk"]);

  // A non-standard distance is named in the race; a standard one is not.
  await result.getByRole("button", { name: /4 Mile Run/ }).click();
  await expect(page.locator("#raceName")).toHaveValue("Riverfront Turkey Trot (4 Mile Run)");
  await expect(page.locator("#raceDistance")).toHaveValue("Other");
  await result.getByRole("button", { name: /, 5K on/ }).click();
  await expect(page.locator("#raceName")).toHaveValue("Riverfront Turkey Trot");
  await expect(page.locator("#raceDate")).toHaveValue(iso(9));
  await expect(page.locator("#raceDistance")).toHaveValue("5K");
  await expect(page.locator("#racePriority")).toBeFocused();
  await page.selectOption("#racePriority", "B");
  await page.locator("#raceForm button[type=submit]").click();

  const saved = page.locator("#raceList .race-item");
  await expect(saved).toHaveCount(1);
  await expect(saved.getByRole("link", { name: /RunSignup/ })).toHaveAttribute("href", "https://runsignup.com/Race/OH/Columbus/RiverfrontTurkeyTrot");
  await expect(page.locator(".race-result")).toHaveCount(0);
  await expect(page.locator("#raceSearch")).toHaveValue("");
});

test("editing a found race by hand drops its RunSignup link, and search failures stay readable", async ({ page }) => {
  let fail = false;
  await page.route("**/api/races/search?*", (route) => fail
    ? route.fulfill({ status: 502, json: { error: "Race search is unavailable right now. Enter the race by hand." } })
    : route.fulfill({ json: { source: "RunSignup", races: [{ id: "1", name: "Spring Half", date: iso(60), city: "Dayton", state: "OH", url: "https://runsignup.com/Race/OH/Dayton/SpringHalf", events: [{ id: "a", name: "Half Marathon", date: iso(60), km: 21.1, distance: "Half marathon", walk: false }] }] } }));
  await loadDemo(page);
  await nav(page, "Plan");
  await page.locator("#racesDisclosure > summary").click();
  await page.fill("#raceSearch", "spring half");
  await page.locator(".race-event").click();
  await page.fill("#raceName", "My own race");
  await page.locator("#raceForm button[type=submit]").click();
  await expect(page.locator("#raceList .race-item")).toHaveCount(1);
  await expect(page.locator("#raceList a")).toHaveCount(0);
  fail = true;
  await page.fill("#raceSearch", "another race");
  await expect(page.locator("#raceSearchStatus")).toContainText("Enter the race by hand");
});

test("an A race projects form to race day and marks the races on the load chart", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Plan");
  await page.locator("#racesDisclosure > summary").click();
  await addRace(page, { name: "City Marathon", offset: 56, distance: "Marathon", priority: "A" });
  await addRace(page, { name: "Turkey Trot", offset: 21, distance: "10K", priority: "B" });
  await nav(page, "Fitness");
  await expect(page.locator("#projectionLegend")).toBeVisible();
  await expect(page.locator("#raceDayProjection")).toContainText(/Race-day form: [+−-]?\d+ .* for City Marathon/);
  await expect(page.locator("#raceDayProjection")).toContainText("65% of it in the taper");
  const labels = page.locator("#loadChart .chart-marker-label");
  for (const label of ["Today", "B · Turkey Trot", "A · City Marathon"]) await expect(labels.filter({ hasText: label })).toHaveCount(1);
  await expect(page.locator("#loadChart .series-line.projection")).toHaveCount(2);
});

test("a goal time shows whether predictions are on track", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Plan");
  await page.locator("#racesDisclosure > summary").click();
  await page.fill("#raceGoalTime", "fast");
  await addRace(page, { name: "Bad Goal", offset: 30, distance: "Half marathon", priority: "B" });
  await expect(page.locator("#raceList .race-item")).toHaveCount(0);
  await page.fill("#raceGoalTime", "9:00:00");
  await addRace(page, { name: "City Marathon", offset: 56, distance: "Marathon", priority: "A" });
  await expect(page.locator("#raceList")).toContainText("goal 9:00:00");
  await page.fill("#raceGoalTime", "1:00:00");
  await addRace(page, { name: "Dream Half", offset: 30, distance: "Half marathon", priority: "B" });
  await nav(page, "Fitness");
  const cards = page.locator(".goal-race");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("City Marathon");
  await expect(cards.nth(0).locator(".goal-race-verdict.on-track")).toBeVisible();
  await expect(cards.nth(1).locator(".goal-race-verdict.off-track")).toContainText("VO2 max");
});

test("without an A race there is no projection", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Fitness");
  await expect(page.locator("#raceDayProjection")).toBeHidden();
  await expect(page.locator("#projectionLegend")).toBeHidden();
  await expect(page.locator(".goal-race")).toHaveCount(0);
});

test("the cycle names the current phase and its dates even when its bar segment is tiny", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadDemo(page);
  await page.evaluate((date) => { coachingContext.races = [{ id: "h", name: "Fall Classic", date, distance: "Half marathon", priority: "A" }]; saveCoachingContext(); fitnessModelCache.key = ""; render(); location.hash = "#fitness"; }, iso(6));
  const cycle = page.locator("#cyclePanel");
  await expect(cycle.locator(".cycle-now strong")).toHaveText("Race week");
  await expect(cycle.locator(".cycle-now-detail")).toContainText("6 days left in this phase");
  await expect(cycle.locator(".cycle-phase.is-current")).toContainText("Race week");
  await expect(cycle.locator(".cycle-phase")).toHaveCount(6);
  // Nothing in the timeline spills past the panel on a phone.
  const overflow = await cycle.evaluate((panel) => { const edge = panel.getBoundingClientRect().right; return [...panel.querySelectorAll(".cycle-today b, .cycle-axis-race")].some((node) => node.getBoundingClientRect().right > edge); });
  expect(overflow).toBe(false);
});
