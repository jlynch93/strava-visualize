const { test, expect } = require("@playwright/test");

test.use({ timezoneId: "America/New_York" });

test("Strava CSV import preserves empty columns, quoted lines, exact distance, and activity identity", async ({ page }) => {
  await page.goto("/");
  const csv = '\uFEFFActivity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Moving Time,Distance,Average Heart Rate\r\n42,"Sep 5, 2026, 07:30:00","Morning, easy",Run,"First line\nSecond ""quoted"" line",,5.00,00:25:00,5000,\r\n43,"Sep 4, 2026, 07:30:00",Bike commute,Ride,,,10,1800,10000,130\r\n';
  await page.locator("#fileInput").setInputFiles({ name: "activities.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.locator("#status")).toContainText("Imported 2 activities");
  const imported = await page.evaluate(() => ({ raw: state.rawActivities, runs: state.filteredRuns, source: state.dataSource }));
  expect(imported.source).toBe("import");
  expect(imported.runs).toHaveLength(1);
  expect(imported.runs[0]).toMatchObject({ id: "42", name: "Morning, easy", distance: 5000, moving_time: 1500, elapsed_time: 1500, average_heartrate: 0, description: 'First line\nSecond "quoted" line', start_latlng: null });
  expect(imported.raw[1].sport_type).toBe("Ride");
});

test("an invalid import explains the problem and keeps the existing history", async ({ page }) => {
  await page.goto("/");
  const valid = [{ id: "kept", name: "Morning run", start_date_local: "2026-09-05T07:00:00Z", distance: 5000, moving_time: 1500 }];
  await page.locator("#fileInput").setInputFiles({ name: "runs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(valid)) });
  await expect(page.locator("#status")).toContainText("Imported 1 activities");
  await page.locator("#fileInput").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"activities": {}}') });
  await expect(page.locator("#status")).toContainText("Expected an activities array");
  expect(await page.evaluate(() => state.rawActivities.map((run) => run.id))).toEqual(["kept"]);
  await page.locator("#fileInput").setInputFiles({ name: "broken.csv", mimeType: "text/csv", buffer: Buffer.from('name,start_date\n"unclosed,2026-09-05') });
  await expect(page.locator("#status")).toContainText("unfinished quoted field");
  expect(await page.evaluate(() => state.rawActivities.map((run) => run.id))).toEqual(["kept"]);
});

test("weekly baselines count quiet days and weeks and remain stable under monthly grouping", async ({ page }) => {
  await page.goto("/");
  const values = await page.evaluate(() => {
    const runs = ["2026-08-03", "2026-08-24"].map((day, index) => normalizeActivity({ id: index, start_date_local: `${day}T08:00:00Z`, distance: 16093.44, moving_time: 5000 }));
    const range = { start: new Date("2026-08-03T00:00:00"), end: new Date("2026-08-30T23:59:59") };
    els.bucketSelect.value = "week";
    const weekly = summarize(runs, buildBuckets(runs), range);
    els.bucketSelect.value = "month";
    const monthly = summarize(runs, buildBuckets(runs), range);
    const previousRuns = [normalizeActivity({ start_date_local: "2026-07-07T08:00:00Z", distance: 16093.44, moving_time: 5000 })];
    const previous = summarizePreviousPeriod(previousRuns, range.start, range.end);
    return { weekly, monthly, previous };
  });
  expect(values.weekly.spanDays).toBe(28);
  expect(values.weekly.averageWeeklyMiles).toBeCloseTo(5);
  expect(values.weekly.averageRunsPerWeek).toBeCloseTo(0.5);
  expect(values.weekly.consistency).toBe(0.5);
  expect(values.weekly.peakWeek).toBeCloseTo(10);
  expect(values.monthly.peakWeek).toBeCloseTo(values.weekly.peakWeek);
  expect(values.monthly.consistency).toBe(values.weekly.consistency);
  expect(values.previous.spanDays).toBe(28);
  expect(values.previous.averageWeeklyMiles).toBeCloseTo(2.5);
});

test("local running days and streaks survive midnight and daylight saving changes", async ({ page }) => {
  await page.goto("/");
  const values = await page.evaluate(() => {
    const runs = ["2026-03-07T23:30:00Z", "2026-03-08T00:30:00Z", "2026-03-09T00:15:00Z"].map((date) => normalizeActivity({ start_date_local: date, distance: 5000 }));
    const utcRun = normalizeActivity({ start_date: "2026-03-08T02:00:00Z", distance: 5000 });
    return { dates: runs.map((run) => dateOnly(parseActivityDate(run))), span: getSpanDays(runs), streaks: getRunStreaks(runs), utcDay: dateOnly(parseActivityDate(utcRun)), duration: formatDuration(7199), blankLocation: normalizeLatLng(["", ""]), validLocation: normalizeLatLng([0, 0]) };
  });
  expect(values.dates).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  expect(values.span).toBe(3);
  expect(values.streaks).toEqual({ longestStreak: 3, longestRestGap: 0 });
  expect(values.utcDay).toBe("2026-03-07");
  expect(values.duration).toBe("2h 00m");
  expect(values.blankLocation).toBeNull();
  expect(values.validLocation).toEqual([0, 0]);
});

test("malformed saved coaching context cannot prevent startup", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("run-trends-coaching-context-v1", JSON.stringify({ goal: null, checkin: ["bad"], plan: 3 })));
  await page.goto("/");
  expect(await page.evaluate(() => coachingContext)).toEqual({ goal: {}, checkin: {}, plan: {} });
  expect(errors).toEqual([]);
  const repaired = await page.evaluate(() => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ goal: { miles: 30, mode: {} }, checkin: { feel: null } }));
    return loadCoachingContext();
  });
  expect(repaired).toEqual({ goal: { miles: "30" }, checkin: {}, plan: {} });
});

test("a three-run draft protects the chosen long-run day before allocating other sessions", async ({ page }) => {
  await page.goto("/");
  const plan = await page.evaluate(() => {
    coachingContext = { goal: { runDays: "3", longRunDay: "Sun" }, checkin: {}, plan: {} };
    return renderRecommendedCalendar("maintain", { averageRunsPerWeek: 5, longRun: 12 }, 30, null);
  });
  expect(plan).toMatchObject({ plannedRuns: 3, maxRuns: 3, longRunDay: "Sun", longRunMiles: 10.5, hasRace: false });
  await expect(page.locator("#recommendedCalendar [data-plan-kind='run']")).toHaveCount(3);
  await expect(page.locator("#recommendedCalendar button").nth(6).locator("strong")).toHaveText("Long run");
  await expect(page.locator("#recommendedCalendar button").nth(6).locator("small")).toHaveText("At or below 10.5 mi");
});

test("saved availability and a missed check-in constrain a manually selected build week", async ({ page }) => {
  await page.goto("/");
  const plan = await page.evaluate(() => {
    coachingContext = { goal: { runDays: "3", longRunDay: "Sat", availability: "Tuesday and Thursday" }, checkin: { outcome: "missed" }, plan: {} };
    return renderRecommendedCalendar("build", { averageRunsPerWeek: 5, longRun: 12 }, 30, null);
  });
  expect(plan).toMatchObject({ plannedRuns: 2, maxRuns: 3, longRunDay: null, longRunMiles: 0, availabilityLimited: true });
  await expect(page.locator("#recommendedCalendar [data-plan-kind='run']")).toHaveCount(2);
  await expect(page.locator("#recommendedCalendar")).not.toContainText("Quality option");
  await expect(page.locator("#recommendedCalendar button").nth(5).locator("strong")).toHaveText("Rest / unavailable");
});

test("a race reserves one of the limited run days and replaces the separate long run", async ({ page }) => {
  await page.goto("/");
  const plan = await page.evaluate(() => {
    coachingContext = { goal: { runDays: "3", longRunDay: "Sat", availability: "Mon Tue Thu Sat" }, checkin: {}, plan: {} };
    const summary = { averageRunsPerWeek: 5, longRun: 12 };
    renderRecommendedCalendar("maintain", summary, 30, null);
    coachingContext.goal.raceDate = els.recommendedCalendar.querySelectorAll("button")[6].dataset.planDate;
    return renderRecommendedCalendar("maintain", summary, 30, { label: "Sunday 10K" });
  });
  expect(plan).toMatchObject({ plannedRuns: 3, maxRuns: 3, hasRace: true, longRunDay: null });
  await expect(page.locator("#recommendedCalendar [data-plan-kind='run']")).toHaveCount(3);
  await expect(page.locator("#recommendedCalendar .race-day strong")).toHaveText("Race day");
  await expect(page.locator("#recommendedCalendar .race-day small")).toContainText("Race date takes priority");
  await expect(page.locator("#recommendedCalendar")).not.toContainText("Long run");
  await expect(page.locator("#recommendedCalendar")).not.toContainText("Quality option");
});

test.describe("positive UTC offset", () => {
  test.use({ timezoneId: "Asia/Tokyo" });
  test("Monday buckets retain the local Monday date", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => bucketKey(new Date("2026-09-07T00:15:00"), "week"))).toBe("2026-09-07");
  });
});
