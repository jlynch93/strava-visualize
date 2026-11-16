const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "allow" });

test("the manifest describes an installable app", async ({ request }) => {
  const response = await request.get("/site.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "Runlore", display: "standalone", scope: "/", id: "/" });
  expect(manifest.icons.some((icon) => icon.purpose === "maskable" && icon.sizes === "512x512")).toBe(true);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual(["/#fitness", "/#planning", "/#runs"]);
});

test("the app shell opens offline, and account requests never go through the cache", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Offline emulation with service workers is exercised in Chromium.");
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // A second visit is served through the worker, which saves the shell.
  await page.reload();
  await expect(page.locator(".app-nav")).toBeAttached();
  await page.waitForFunction(async () => (await (await caches.open("runlore-shell-v1")).keys()).some((request) => new URL(request.url).pathname === "/"));
  const cachedPaths = await page.evaluate(async () => (await (await caches.open("runlore-shell-v1")).keys()).map((request) => new URL(request.url).pathname));
  expect(cachedPaths).toContain("/script.js");
  expect(cachedPaths.filter((path) => /^\/(api|auth)\//.test(path))).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Preview demo data", exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText("you may be offline");
  // The shell still works with data already on the device.
  await page.getByRole("button", { name: "Preview demo data", exact: true }).click();
  await expect(page.locator("#activityCount")).toContainText(/runs in range/);
  await context.setOffline(false);
});
