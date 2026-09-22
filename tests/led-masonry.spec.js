const { test, expect } = require("@playwright/test");
const { stubYouTube } = require("./helpers/youtube");

// Ground truth, established by probing YouTube directly: `/shorts/<id>` answers
// 200 for a vertical video and 303-redirects to /watch for a landscape one.
const VERTICAL = ["Kg0VKvDbvkU", "uXDbkIkoSk0", "nLRTtxrm7z0", "SzUIuTK63jA"];
const LANDSCAPE = ["n92QxOXHpaI", "qo0L7gmySvQ", "C8sHgpCKFPA", "UL10vjc54Lw"];

test.beforeEach(async ({ page }) => {
  await stubYouTube(page);
  await page.goto("/led/");
  await page.waitForSelector("[data-tile]");
});

test("every tile declares its orientation, and the vertical videos are portrait", async ({ page }) => {
  const byId = Object.fromEntries(
    await page.$$eval("[data-tile][data-yt]", (els) =>
      els.map((el) => [el.dataset.yt, el.dataset.orientation]),
    ),
  );
  // Kg0VKvDbvkU is the regression: it was flagged `protrait=true` (typo), so the
  // Liquid fell through to the landscape branch and the tile rendered wide.
  for (const id of VERTICAL) expect(byId[id], `${id} should be portrait`).toBe("portrait");
  for (const id of LANDSCAPE) expect(byId[id], `${id} should be landscape`).toBe("landscape");
});

test("a portrait tile is taller than a landscape tile, but no more than 2x", async ({ page }) => {
  const h = async (sel) => (await page.locator(sel).first().boundingBox()).height;
  const portrait = await h('[data-tile][data-orientation="portrait"]');
  const landscape = await h('[data-tile][data-orientation="landscape"]');
  const ratio = portrait / landscape;
  expect(ratio, `portrait/landscape tile height ratio was ${ratio.toFixed(3)}`).toBeGreaterThan(1);
  expect(ratio, `portrait/landscape tile height ratio was ${ratio.toFixed(3)}`).toBeLessThanOrEqual(2);
});

test("portrait tiles stay portrait on a phone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone layout only");
  // The old stylesheet collapsed .vertical-video to `grid-row: span 1` under
  // 767px and letterboxed the poster against `background: black` — portrait
  // videos became short, black-barred landscape boxes.
  const tile = page.locator('[data-tile][data-orientation="portrait"]').first();
  const box = await tile.boundingBox();
  expect(box.height / box.width, "portrait tile should not be a wide box on mobile").toBeGreaterThan(0.6);
});

test("the poster fills its tile — no letterbox bars", async ({ page }) => {
  const media = page.locator("[data-tile] [data-media]").first();
  await expect(media).toHaveCSS("object-fit", "cover");
  const [tile, box] = await Promise.all([
    media.evaluate((el) => el.closest("[data-tile]").getBoundingClientRect().height),
    media.evaluate((el) => el.getBoundingClientRect().height),
  ]);
  expect(Math.abs(tile - box), "media should be full tile height").toBeLessThan(2);
});

test("every tile resolves an orientation from data, with no flags in the page", async ({ page }) => {
  // A video missing from _data/media.yml would otherwise default to landscape
  // and look exactly like the `protrait=true` bug. Regenerate with `just media`.
  const unresolved = await page.$$eval("[data-orientation-unresolved]", (els) =>
    els.map((el) => el.dataset.orientationUnresolved),
  );
  expect(unresolved, "run `just media` — these ids are not in _data/media.yml").toEqual([]);

  const unknownParams = await page.$$eval("[data-unknown-params]", (els) =>
    els.map((el) => `${el.dataset.yt || el.getAttribute("href")}: ${el.dataset.unknownParams}`),
  );
  expect(unknownParams, "misspelled include parameters").toEqual([]);

  // Images should be sized from the JPEG header, not corrected after decode.
  const late = await page.$$eval("[data-tile][data-orientation-auto]", (els) => els.length);
  expect(late, "image tiles should get their aspect at build time").toBe(0);
});

test("no request to noembed.com — orientation is declared, not sniffed", async ({ page }) => {
  const stray = [];
  page.on("request", (r) => {
    if (/noembed\.com/.test(r.url())) stray.push(r.url());
  });
  await page.reload();
  await page.waitForSelector("[data-tile]");
  await page.waitForTimeout(600);
  expect(stray, "the dead oEmbed probe should be gone").toEqual([]);
});
