const { defineConfig } = require("@playwright/test");

// Several runners on one machine run browser tests at the same time, so CI
// passes each job its own free port. Read here once per process; every worker
// must see the same value, which is why it is not picked at random here.
const port = Number(process.env.E2E_PORT) || 43174;
const origin = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: origin,
    browserName: "chromium",
    // The service worker would sit between tests and their mocked routes;
    // tests/e2e/app.spec.js turns it on to test it.
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } }
  ],
  webServer: {
    command: "node scripts/start-e2e-server.js",
    url: `${origin}/api/status`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
});
