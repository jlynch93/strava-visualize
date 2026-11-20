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
  // One row at first, new bests first; the rest on request.
  const visible = records.locator(".record:visible");
  const shown = await visible.count();
  expect(shown).toBeGreaterThanOrEqual(4);
  expect(shown).toBeLessThan(7);
  await records.getByRole("button", { name: "All 7 records" }).click();
  await expect(visible).toHaveCount(7);
  await expect(records.locator("#recordsToggle")).toHaveAttribute("aria-expanded", "true");
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
  await page.getByRole("tab", { name: "Aerobic efficiency" }).click();
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

test("a yearly goal shows the pace you are on and what the rest of the year needs", async ({ page }) => {
  await loadDemo(page);
  const card = page.locator("#yearGoal");
  await expect(card).toBeVisible();
  await expect(card).toContainText(`${new Date().getFullYear()} so far`);
  await expect(card).toContainText(/At this pace, [\d,]+ mi by December 31/);
  // A goal far above the pace: it says how far short and what a week needs.
  await page.fill("#yearGoalInput", "5000");
  await page.locator("#yearGoalForm button[type=submit]").click();
  await expect(card).toContainText(/short\. [\d.]+ mi a week from here gets you there/);
  await expect(card.locator(".year-meter i")).toHaveCount(1);
  expect(await page.evaluate(() => coachingContext.yearGoals[String(new Date().getFullYear())])).toBe(5000);
  // Kilometres in, miles stored.
  await page.evaluate(() => { const select = document.querySelector("#unitPreference"); select.value = "metric"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await expect(page.locator("#yearGoalInput")).toHaveValue("8047");
  await card.getByRole("button", { name: "Clear" }).click();
  await expect(card.locator(".year-meter i")).toHaveCount(0);
  // The year as an image.
  await card.getByRole("button", { name: "Share your year" }).click();
  await expect(page.locator("#recapTitle")).toHaveText(`Your ${new Date().getFullYear()}`);
  const year = new Date().getFullYear();
  await page.evaluate(() => { try { localStorage.removeItem("runlore-year-style"); } catch { /* fine */ } });
  await expect(page.locator("#recapDownload")).toHaveAttribute("download", new RegExp(`runlore-${year}-\\w+\\.png`));
  // A story-sized image with the accolades the year earned.
  await expect(page.locator("#recapImage")).toHaveAttribute("alt", /Accolades: [^.]*club/);
  const size = await page.locator("#recapImage").evaluate((image) => [image.naturalWidth, image.naturalHeight]);
  expect(size).toEqual([1080, 1920]);
});

test("intensity balance compares easy and hard running time with 80/20", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Fitness");
  await page.getByRole("tab", { name: "Intensity balance" }).click();
  const panel = page.locator("#intensityPanel");
  await expect(panel).toBeVisible();
  const label = await panel.locator(".intensity-bar").getAttribute("aria-label");
  const [, easy, hard] = label.match(/(\d+)% easy, (\d+)% hard/);
  expect(Number(easy) + Number(hard)).toBe(100);
  await expect(panel.locator(".intensity-verdict")).not.toBeEmpty();
});

test("shoes count the runs made in them and warn as they wear out", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Runs");
  const shoes = page.locator("#shoes");
  await expect(shoes).toBeVisible();
  await expect(shoes.locator(".shoe-empty")).toBeVisible();
  await shoes.locator("#shoeAdd > summary").click();
  await page.fill("#shoeName", "Daily trainers");
  await page.fill("#shoeStart", iso(-60));
  await page.fill("#shoeLimit", "100");
  await page.locator("#shoeForm button[type=submit]").click();
  const shoe = shoes.locator(".shoe");
  await expect(shoe).toHaveCount(1);
  await expect(shoe).toContainText("Daily trainers");
  await expect(shoe).toHaveClass(/status-(nearly|worn)/);
  await expect(shoes.locator("#shoesSummary")).toContainText(/Daily trainers: \d+ mi/);
  // A newer pair takes over from its first day.
  await page.fill("#shoeName", "Race flats");
  await page.fill("#shoeStart", iso(1));
  await page.fill("#shoeLimit", "300");
  await page.locator("#shoeForm button[type=submit]").click();
  await expect(shoes.locator(".shoe")).toHaveCount(2);
  await expect(shoes.locator(".shoe", { hasText: "Race flats" })).toContainText("0 runs");
  await shoes.locator(".shoe", { hasText: "Daily trainers" }).getByRole("button", { name: /Retire/ }).click();
  await expect(shoes.locator(".shoe", { hasText: "Daily trainers" })).toHaveClass(/status-retired/);
  page.once("dialog", (dialog) => dialog.accept());
  await shoes.locator(".shoe", { hasText: "Race flats" }).getByRole("button", { name: /Remove/ }).click();
  await expect(shoes.locator(".shoe")).toHaveCount(1);
  expect(await page.evaluate(() => coachingContext.shoes.map((item) => item.name))).toEqual(["Daily trainers"]);
});

test("how a run felt is saved with it and shows in the ledger", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Runs");
  await page.locator(".row-detail-button").first().click();
  const feel = page.locator(".run-feel");
  await expect(feel).toBeVisible();
  await feel.locator(".rpe-scale label", { hasText: /^7$/ }).click();
  await expect(feel.locator("#runFeelWord")).toHaveText("7 · Hard");
  await feel.locator("#runFeelNote").fill("Windy last mile");
  await feel.locator("#runFeelNote").blur();
  await expect(feel.locator(".run-feel-status")).toHaveText("Saved");
  await page.keyboard.press("Escape");
  const chip = page.locator("#activityRows tr").first().locator(".feel-chip");
  await expect(chip).toContainText("RPE 7");
  await expect(chip).toHaveAttribute("title", /Effort 7 of 10, hard: Windy last mile/);
  // It survives a reload, and opening the run again shows it.
  await page.reload();
  await page.getByRole("button", { name: "Preview demo data", exact: true }).click();
  await nav(page, "Runs");
  await page.locator(".row-detail-button").first().click();
  await expect(page.locator(".rpe-scale input[value='7']")).toBeChecked();
  await expect(page.locator("#runFeelNote")).toHaveValue("Windy last mile");
});


test("the structure leads with today: overview opens on readiness, fitness groups by question", async ({ page }) => {
  await loadDemo(page);
  // No page title or duplicate demo label above readiness, and records come after the trend and key runs.
  // The title stays for screen readers but takes no visible space (1px, clipped).
  const title = await page.locator("#overviewTitle").evaluate((node) => { const box = node.closest(".overview-head").getBoundingClientRect(); return [box.width, box.height]; });
  expect(Math.max(...title)).toBeLessThanOrEqual(1);
  const top = (selector) => page.locator(selector).evaluate((node) => node.getBoundingClientRect().top + scrollY);
  expect(await top("#todayStrip")).toBeLessThan(await top("#thisWeek"));
  expect(await top(".primary-chart")).toBeLessThan(await top("#records"));
  expect(await top(".key-runs")).toBeLessThan(await top("#records"));
  expect(await top("#records")).toBeLessThan(await top("#yearGoal"));
  // The demo button goes once the demo is loaded.
  await expect(page.locator("#demoButton")).toBeHidden();

  await nav(page, "Fitness");
  const order = ["#readinessHero", "#loadChart", "#racePredictions", "#progressPanel", "#trainingPaces", "#runningMetrics"];
  const positions = [];
  for (const selector of order) positions.push(await top(selector));
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  // Running form no longer repeats efficiency or load.
  await expect(page.locator("#runningMetrics")).not.toContainText("Aerobic efficiency");
  await expect(page.locator("#runningMetrics")).not.toContainText("Weekly load");
  // Progress tabs: arrow keys move between them, and the choice is remembered.
  await page.getByRole("tab", { name: "VO2 max" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Aerobic efficiency" })).toBeFocused();
  await expect(page.locator("#efficiencyPanel")).toBeVisible();
  await expect(page.locator("#vo2Section")).toBeHidden();
  await expect(page.locator("#efficiencyChart svg")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Preview demo data", exact: true }).click();
  await nav(page, "Fitness");
  await expect(page.getByRole("tab", { name: "Aerobic efficiency" })).toHaveAttribute("aria-selected", "true");
  // Data notes live with the heart-rate profile now.
  await expect(page.locator(".fitness-profile #fitnessNotes")).toHaveCount(1);
});

test("plan shows the draft before the setup once a goal is set", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Plan");
  const top = (selector) => page.locator(selector).evaluate((node) => node.getBoundingClientRect().top + scrollY);
  await expect(page.locator("#planning .panel-heading")).toContainText("Saved to your account when you are signed in");
  expect(await top(".coaching-grid")).toBeLessThan(await top("#planDraftReview"));
  await page.evaluate(() => { coachingContext.goal = { miles: "30" }; saveCoachingContext(); render(); });
  await expect(page.locator("#planStart")).toBeHidden();
  expect(await top("#planDraftReview")).toBeLessThan(await top(".coaching-grid"));
});

test("pages end at the footer, with no blank scroll below", async ({ page }) => {
  await loadDemo(page);
  for (const name of ["Overview", "Fitness", "Plan", "Runs"]) {
    await nav(page, name);
    const gap = await page.evaluate(() => document.documentElement.scrollHeight - (document.querySelector(".app-footer").getBoundingClientRect().bottom + scrollY));
    expect(gap, name).toBeLessThan(120);
  }
});


test("the year image comes in five styles, each with its own accolades", async ({ page }) => {
  await loadDemo(page);
  await page.locator("#yearGoal").getByRole("button", { name: "Share your year" }).click();
  const styles = page.locator("#recapStyles label");
  await expect(styles).toHaveText(["The year", "Distance", "Speed", "Consistency", "Habits"]);
  const year = new Date().getFullYear();
  const seen = new Map();
  for (const [label, key, expected] of [["Distance", "distance", /around the Earth|club/], ["Speed", "speed", /best|VO2 max|Fastest month/], ["Consistency", "consistency", /weeks|days you ran/], ["Habits", "habits", /runner|rest day|Typical run/], ["The year", "year", /club|Every month/]]) {
    await styles.filter({ hasText: label }).click();
    await expect(page.locator("#recapDownload")).toHaveAttribute("download", `runlore-${year}-${key}.png`);
    const alt = await page.locator("#recapImage").getAttribute("alt");
    expect(alt).toContain(`${label.toLowerCase()} card`);
    expect(alt).toMatch(expected);
    seen.set(key, [await page.locator("#recapImage").getAttribute("src"), alt.split("Accolades: ")[1]]);
    await expect(page.locator(`#recapStyles input[value="${key}"]`)).toBeChecked();
  }
  // Five different images with five different sets of accolades.
  expect(new Set([...seen.values()].map(([src]) => src)).size).toBe(5);
  expect(new Set([...seen.values()].map(([, accolades]) => accolades)).size).toBe(5);
  // The choice is remembered; the week card has no style picker.
  await page.locator("#recapClose").click();
  await page.locator("#thisWeek").getByRole("button", { name: /Share week/ }).click();
  await expect(page.locator("#recapStyles")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("runlore-year-style"))).toBe("year");
});

test("each run shows what can be worked out from it, and can be shared as an image", async ({ page }) => {
  await loadDemo(page);
  await nav(page, "Runs");
  await page.locator(".row-detail-button").first().click();
  const analysis = page.locator(".run-analysis");
  await expect(analysis).toBeVisible();
  await expect(analysis).toContainText(/Training load\s*\d+ points/);
  await expect(analysis).toContainText(/Zone \d · /);
  await expect(analysis).toContainText(/per heartbeat/);
  await expect(analysis).toContainText(/steps a minute/);
  // Share: a story image, no route option without a route.
  await analysis.getByRole("button", { name: /Share run/ }).click();
  await expect(page.locator("#recapTitle")).toHaveText("Share this run");
  await expect(page.locator("#recapRunOptions")).toBeHidden();
  await expect(page.locator("#recapStyles")).toBeHidden();
  await expect(page.locator("#recapImage")).toHaveAttribute("alt", /in \d+h? ?\d*m? at \d+:\d\d\/mi\. Highlights: .*load points/);
  await expect(page.locator("#recapDownload")).toHaveAttribute("download", /^runlore-\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.png$/);
  const size = await page.locator("#recapImage").evaluate((image) => [image.naturalWidth, image.naturalHeight]);
  expect(size).toEqual([1080, 1920]);
});

test("a Strava run adds pacing, drift, grade-adjusted pace and best efforts, and an opt-in route", async ({ page }) => {
  const mile = (seconds, hr, gradeSpeed) => ({ distance: 1609.34, moving_time: seconds, elapsed_time: seconds, average_heartrate: hr, average_grade_adjusted_speed: gradeSpeed, elevation_difference: 3 });
  await page.route("**/api/activities/1234567*", (route) => route.fulfill({ json: { provider: "strava", activity: {
    id: "1234567",
    splits_standard: [mile(492, 148, 3.3), mile(488, 150, 3.3), mile(485, 152, 3.35), mile(480, 154, 3.4), mile(476, 156, 3.4), mile(470, 159, 3.45), { distance: 900, moving_time: 250, average_heartrate: 165, average_grade_adjusted_speed: 3.7 }],
    splits_metric: [{ distance: 1000, moving_time: 300 }],
    best_efforts: [{ name: "1 mile", elapsed_time: 455 }, { name: "5K", elapsed_time: 1420, pr_rank: 1 }],
    map: { summary_polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }
  } } }));
  await loadDemo(page);
  await page.evaluate(() => {
    const run = state.filteredRuns.at(-1);
    const raw = state.rawActivities.find((item) => String(normalizeActivity(item).id) === String(run.id));
    raw.id = 1234567; raw.map = { summary_polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }; run.id = "1234567";
    state.dataSource = "strava";
    showWorkoutModal("1234567");
  });
  const pacing = page.locator(".run-pacing");
  await expect(pacing).toBeVisible();
  await expect(pacing).toContainText("Negative split");
  await expect(pacing).toContainText(/heart-rate drift/);
  await expect(pacing).toContainText("Grade-adjusted pace");
  await expect(pacing.locator(".split-chart li")).toHaveCount(7);
  await expect(pacing.locator(".split-bar.is-partial")).toHaveCount(1);
  await expect(pacing.locator(".best-efforts .is-pr")).toContainText("5K");
  await pacing.getByText("All mile splits").click();
  await expect(pacing.locator(".split-table tbody tr")).toHaveCount(7);
  await expect(page.locator("#enrichedRun")).not.toContainText("Recorded kilometer splits");
  // Sharing: the route is offered, off by default, and changes the image when turned on.
  await page.locator(".run-analysis").getByRole("button", { name: /Share run/ }).click();
  const option = page.locator("#recapRunOptions input");
  await expect(option).toBeVisible();
  await expect(option).not.toBeChecked();
  await expect(page.locator("#recapImage")).toHaveAttribute("alt", /5K PR.*Negative split/);
  const without = await page.locator("#recapImage").getAttribute("src");
  await option.check();
  await expect.poll(() => page.locator("#recapImage").getAttribute("src")).not.toBe(without);
});
