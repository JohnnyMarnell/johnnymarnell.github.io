// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/**
 * The site is plain Jekyll, so the suite runs against the real `_site` build
 * rather than hand-written fixtures — a broken Liquid include has to fail here.
 * `globalSetup` runs `jekyll build` unless SKIP_BUILD=1 (fast local iteration).
 */
module.exports = defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/helpers/global-setup.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      // iPhone-ish portrait. Real touch + no-hover, which is where this page hurts.
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: {
    command: "node tests/helpers/serve.mjs",
    url: "http://127.0.0.1:4321/led/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
