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

test("tiles read left to right across the first row, not down the first column", async ({ page }) => {
  // The multi-column fallback fills column 1 top-to-bottom before starting
  // column 2, so item 2 lands *under* item 1. gallery.js builds real columns
  // and walks the authored order across them; this is that difference.
  const cols = await page.locator(".gallery__col").count();
  expect(cols, "gallery.js should have built columns").toBeGreaterThan(1);

  const authored = await page.$$eval("[data-tile]", (els) =>
    els
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { order: Number(el.dataset.order), x: r.x, y: r.y };
      })
      .sort((a, b) => a.order - b.order),
  );
  expect(authored.length).toBeGreaterThan(cols);

  const firstRow = authored.slice(0, cols);
  for (let i = 1; i < firstRow.length; i++) {
    expect(
      firstRow[i].x,
      `item ${i + 1} should sit to the right of item ${i}, not below it`,
    ).toBeGreaterThan(firstRow[i - 1].x);
    expect(
      Math.abs(firstRow[i].y - firstRow[0].y),
      `item ${i + 1} should share the top row with item 1`,
    ).toBeLessThan(2);
  }
  expect(
    authored[cols].y,
    `item ${cols + 1} should wrap to the next row, under item 1`,
  ).toBeGreaterThan(firstRow[0].y);
});

test("the columns repack when the viewport changes width", async ({ page }) => {
  // Explicit widths rather than "resize a bit", so the assertion holds for the
  // desktop and the phone project alike.
  const columnsAt = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(
      (w) => Math.abs(document.documentElement.clientWidth - w) < 20,
      width,
      { timeout: 4000 },
    );
    await page.waitForTimeout(100); // ResizeObserver lands on the next frame
    return page.locator(".gallery__col").count();
  };

  const wide = await columnsAt(1200);
  const narrow = await columnsAt(360);
  expect(narrow, `1200px gave ${wide} columns, 360px gave ${narrow}`).toBeLessThan(wide);

  // And every tile is still somewhere, exactly once.
  expect(await page.locator(".gallery__col [data-tile]").count()).toBe(
    await page.locator("[data-tile]").count(),
  );
});
