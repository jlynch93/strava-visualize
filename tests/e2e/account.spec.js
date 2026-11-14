const { test, expect } = require("@playwright/test");

// Twelve recent easy runs, newest first, so every view has data.
function runs() {
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - index * 2); date.setHours(7, 0, 0, 0);
    return { id: 500 + index, name: `Morning run ${index + 1}`, sport_type: "Run", start_date: date.toISOString(), start_date_local: date.toISOString(), distance: 8000, moving_time: 2700, elapsed_time: 2760, total_elevation_gain: 40, average_heartrate: 145 };
  });
}

// Signed-in Strava account; `state` is what /api/state returns, and every
// PUT to /api/state/<key> is recorded in `saves`.
async function signedInAccount(page, { state = {}, activitiesDelay = 0 } = {}) {
  const saves = [];
  const providers = [{ id: "strava", name: "Strava", configured: true, error: null }];
  await page.route("**/api/status", (route) => route.fulfill({ json: { configured: true, signedIn: true, connected: true, providers } }));
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: { id: "u1", displayName: "Test Runner" }, connections: [{ provider: "strava", displayName: "Test Runner" }] } }));
  await page.route("**/api/state", (route) => route.fulfill({ json: { state } }));
  await page.route("**/api/state/*", async (route) => {
    saves.push({ key: decodeURIComponent(route.request().url().split("/api/state/")[1]), value: route.request().postDataJSON() });
    await route.fulfill({ json: { saved: true } });
  });
  await page.route("**/api/activities?*", async (route) => {
    if (activitiesDelay) await new Promise((resolve) => setTimeout(resolve, activitiesDelay));
    await route.fulfill({ json: { provider: "strava", activities: runs(), truncated: false } });
  });
  return saves;
}

test("a returning signed-in runner sees a loading state, never the welcome panel", async ({ page }) => {
  await signedInAccount(page, { activitiesDelay: 1200 });
  let welcomeSeen = false;
  await page.exposeFunction("markWelcome", () => { welcomeSeen = true; });
  await page.addInitScript(() => {
    // Record if the welcome panel is ever rendered visibly during startup.
    const check = () => {
      const panel = document.querySelector(".onboarding");
      if (panel && panel.offsetParent !== null && getComputedStyle(panel).visibility !== "hidden") window.markWelcome();
      if (document.body?.classList.contains("is-loading") !== false) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await page.goto("/");
  await expect(page.locator(".app-loading")).toBeVisible();
  await expect(page.locator(".app-loading")).toContainText("Loading your runs");
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);
  await expect(page.locator(".app-loading")).toBeHidden();
  expect(welcomeSeen).toBe(false);
});

test("a signed-out visitor gets the welcome panel without leftover loading UI", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Every run adds to the story." })).toBeVisible();
  await expect(page.locator(".app-loading")).toBeHidden();
  await expect(page.getByText("What Runlore shows you")).toBeVisible();
  // The header doesn't repeat the welcome panel's demo entry point.
  await expect(page.getByRole("button", { name: "Demo data", exact: true })).toBeHidden();
  await expect(page.locator("#sourceStatus")).toBeHidden();
});

test("a fresh visit keeps a clean URL until the runner changes a view setting", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview demo data", exact: true }).click();
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);
  expect(new URL(page.url()).search).toBe("");
  await page.locator("#rangeSelect").selectOption("30");
  expect(new URL(page.url()).searchParams.get("range")).toBe("30");
  await page.locator("#rangeSelect").selectOption("90");
  expect(new URL(page.url()).search).toBe("");
});

test("settings saved to the account load on a new device and changes are saved back", async ({ page }) => {
  const saves = await signedInAccount(page, {
    state: {
      "run-trends-preferences": { value: { units: "metric", theme: "dark" } },
      "run-trends-athlete-v1": { value: { maxHr: 191, restHr: 48 } },
      "run-trends-coaching-context-v1": { value: { goal: { raceName: "City Marathon" }, checkin: {}, plan: {} } }
    }
  });
  await page.goto("/");
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("run-trends-athlete-v1")).maxHr)).toBe(191);
  expect(await page.evaluate(() => coachingContext.goal.raceName)).toBe("City Marathon");
  expect(await page.evaluate(() => preferences.units)).toBe("metric");

  // A device with settings the account doesn't have yet uploads them once.
  expect(saves.map((save) => save.key)).not.toContain("run-trends-preferences");

  await page.evaluate(() => { coachingContext.goal.raceName = "Trail Half"; saveCoachingContext(); });
  await expect.poll(() => saves.find((save) => save.key === "run-trends-coaching-context-v1")?.value.goal.raceName).toBe("Trail Half");
});

test("signing out removes the account's plans and goals from this browser", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("run-trends-coaching-context-v1", JSON.stringify({ goal: { raceName: "Previous runner's race" }, checkin: {}, plan: {} }));
    localStorage.setItem("run-trends-athlete-v1", JSON.stringify({ maxHr: 200, restHr: 50 }));
    localStorage.setItem("run-trends-preferences", JSON.stringify({ units: "metric" }));
  });
  await page.goto("/?signedout=1");
  await expect(page.locator("#status")).toContainText("Signed out");
  expect(await page.evaluate(() => localStorage.getItem("run-trends-coaching-context-v1"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("run-trends-athlete-v1"))).toBeNull();
  expect(await page.evaluate(() => coachingContext.goal.raceName)).toBeUndefined();
  // Display preferences belong to the device and stay.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("run-trends-preferences")).units)).toBe("metric");
  expect(new URL(page.url()).searchParams.has("signedout")).toBe(false);
});
