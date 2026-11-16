const { test, expect } = require("@playwright/test");

function activity(id, daysAgo, name = `Run ${id}`) {
  const date = new Date(); date.setDate(date.getDate() - daysAgo); date.setHours(7, 0, 0, 0);
  const iso = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return { id: String(id), name, sport_type: "Run", start_date: iso, start_date_local: iso, distance: 8000, moving_time: 2600, average_heartrate: 150 };
}

async function mockAccount(page, provider) {
  const providers = [{ id: "strava", name: "Strava", configured: true, error: null }, { id: "garmin", name: "Garmin", configured: true, error: null }];
  await page.route("**/api/status", (route) => route.fulfill({ json: { configured: true, signedIn: true, connected: true, providers } }));
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: { id: "u1", displayName: "Test Runner" }, connections: [{ provider, displayName: "Test Runner" }] } }));
  await page.route("**/api/state**", (route) => route.fulfill({ json: {} }));
}

// Serves /api/activities from a script of responses, recording each request.
async function scriptActivities(page, responses) {
  const requests = [];
  await page.route("**/api/activities?*", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const next = responses[Math.min(requests.length, responses.length) - 1];
    return route.fulfill({ json: typeof next === "function" ? next(url) : next });
  });
  return requests;
}

const importing = (cursor, stored) => ({ state: "importing", cursor, stored, windowsDone: 4, windowsTotal: 4, lastReceivedAt: cursor, error: null });
const idle = (cursor, stored) => ({ ...importing(cursor, stored), state: "idle" });

test("Garmin history appears as it arrives, then new activities keep arriving", async ({ page }) => {
  await page.clock.install();
  await mockAccount(page, "garmin");
  const requests = await scriptActivities(page, [
    { provider: "garmin", activities: [activity(1, 1), activity(2, 3)], truncated: false, sync: importing(100, 2) },
    { provider: "garmin", activities: [activity(3, 400, "Old backfilled run")], truncated: false, sync: importing(101, 3) },
    { provider: "garmin", activities: [], truncated: false, sync: idle(101, 3) },
    { provider: "garmin", activities: [activity(4, 0, "Fresh upload")], truncated: false, sync: idle(102, 4) }
  ]);
  await page.goto("/");
  const source = page.locator("#sourceStatus");
  await expect(source).toContainText("Importing history… 2 so far");
  await expect(source).toHaveClass(/is-importing/);
  await expect(page.locator("#status")).toContainText("Garmin is sending your history");

  // No click needed: the watcher checks again 15 seconds later, asking only for arrivals.
  await page.clock.fastForward(16_000);
  await expect(source).toContainText("3 so far");
  expect(requests[1].searchParams.get("changed_since")).toBe("100");
  expect(requests[1].searchParams.has("after")).toBe(false);

  await page.clock.fastForward(16_000);
  await expect(page.locator("#status")).toContainText("Garmin history imported: 3 activities.");
  await expect(source).not.toHaveClass(/is-importing/);
  await expect(source).toContainText("Synced");

  // Once idle it keeps a slow watch, so a new upload still appears on its own.
  await page.clock.fastForward(60_000);
  expect(requests).toHaveLength(3);
  await page.clock.fastForward(125_000);
  await expect(page.locator("#status")).toContainText("1 new activity from Garmin.");
  expect(requests[3].searchParams.get("changed_since")).toBe("101");
});

test("Checks pause while the tab is hidden and catch up when it returns", async ({ page }) => {
  await page.clock.install();
  await mockAccount(page, "garmin");
  const requests = await scriptActivities(page, [
    { provider: "garmin", activities: [activity(1, 1)], truncated: false, sync: importing(100, 1) },
    { provider: "garmin", activities: [activity(2, 2)], truncated: false, sync: importing(101, 2) }
  ]);
  await page.goto("/");
  await expect(page.locator("#sourceStatus")).toContainText("1 so far");
  const setHidden = (hidden) => page.evaluate((value) => {
    Object.defineProperty(document, "hidden", { value, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await setHidden(true);
  await page.clock.fastForward(90_000);
  expect(requests).toHaveLength(1);
  await setHidden(false);
  await expect(page.locator("#sourceStatus")).toContainText("2 so far");
  expect(requests).toHaveLength(2);
});

test("Strava is never polled in the background", async ({ page }) => {
  await page.clock.install();
  await mockAccount(page, "strava");
  const requests = await scriptActivities(page, [{ provider: "strava", activities: [activity(1, 1), activity(2, 2)], truncated: false }]);
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("Loaded 2 activities from Strava");
  await page.clock.fastForward(10 * 60_000);
  expect(requests).toHaveLength(1);
  await expect(page.locator("#sourceStatus")).not.toHaveClass(/is-importing/);
});
