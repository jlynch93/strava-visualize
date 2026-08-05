const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:43174",
    browserName: "chromium",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "node scripts/start-e2e-server.js",
    url: "http://127.0.0.1:43174/api/status",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
});
