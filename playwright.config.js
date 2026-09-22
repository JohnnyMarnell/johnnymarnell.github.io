// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/**
 * The site is plain Jekyll, so the suite runs against the real `_site` build
 * rather than hand-written fixtures — a broken Liquid include has to fail here.
 * tests/helpers/serve.mjs rebuilds the site before it starts listening.
 */
module.exports = defineConfig({
  testDir: "./tests",
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
    // Never reused: a leftover server would serve a stale _site, and tests
    // quietly passing against last hour's build is worse than a port clash.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
  },
});
