// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/**
 * The site is plain Jekyll, so the suite runs against the real `_site` build
 * rather than hand-written fixtures — a broken Liquid include has to fail here.
 * tests/helpers/serve.mjs rebuilds the site before it starts listening.
 */
/*
 * Not 4321: that is Astro's default dev port, so a `just test` here collided
 * with an Astro site running in another checkout — and `reuseExistingServer:
 * false` (deliberately, see below) then timed out after three minutes with
 * "Timed out waiting from config.webServer" and nothing about a port clash.
 * Override with PORT= if this one is ever taken too.
 */
const PORT = Number(process.env.PORT || 4765);
const ORIGIN = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: ORIGIN,
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
    env: { PORT: String(PORT) },
    url: `${ORIGIN}/led/`,
    // Never reused: a leftover server would serve a stale _site, and tests
    // quietly passing against last hour's build is worse than a port clash.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
  },
});
