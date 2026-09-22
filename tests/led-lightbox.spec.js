const { test, expect } = require("@playwright/test");
const { stubYouTube, ytCalls } = require("./helpers/youtube");

const PORTRAIT_TILE = '[data-tile][data-orientation="portrait"]';
const lightbox = (page) => page.locator("[data-lightbox]");
const slide = (page) => page.locator("[data-slide]");

// Records requestFullscreen instead of calling it — headless has no real
// fullscreen, and what matters is that the control is wired to something.
async function spyFullscreen(page) {
  await page.addInitScript(() => {
    window.__fs = [];
    const spy = function () {
      window.__fs.push(this.tagName + "." + (this.className || ""));
      return Promise.resolve();
    };
    Element.prototype.requestFullscreen = spy;
    Element.prototype.webkitRequestFullscreen = spy;
  });
}

async function open(page, selector = PORTRAIT_TILE) {
  await page.locator(selector).first().click();
  await expect(lightbox(page)).toBeVisible();
}

test.describe("phone lightbox", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a portrait video autoplays even when unmuted autoplay is refused", async ({ page }) => {
    // Phones refuse unmuted autoplay. The player must notice and retry muted
    // rather than sitting there showing a play button (or a spinner) forever.
    await stubYouTube(page, { mode: "autoplay-blocked" });
    await page.goto("/led/");
    await open(page);

    await expect(slide(page)).toHaveAttribute("data-state", "playing", { timeout: 8000 });
    const calls = await ytCalls(page);
    expect(calls.some((c) => c.fn === "playVideo" && c.muted), "should retry playback muted").toBe(true);
    // ...and offer the sound back, since we had to mute to get going.
    await expect(page.locator('[data-action="unmute"]')).toBeVisible();
  });

  test("a portrait video fills the portrait viewport", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    await open(page);
    await expect(slide(page)).toHaveAttribute("data-state", "playing", { timeout: 8000 });

    const box = await slide(page).boundingBox();
    // Fancybox pinned these to data-width=640/data-height=1138 and rendered
    // them tiny in the middle of a black screen.
    expect(box.width / 390, "should use nearly the full viewport width").toBeGreaterThan(0.85);
    expect(box.height / 844, "should use most of the viewport height").toBeGreaterThan(0.7);
  });

  test("the expand control is a real, tappable 44px target that triggers fullscreen", async ({ page }) => {
    await spyFullscreen(page);
    await stubYouTube(page);
    await page.goto("/led/");
    await open(page);

    const btn = page.locator('[data-action="fullscreen"]');
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box.width, "tap target width").toBeGreaterThanOrEqual(44);
    expect(box.height, "tap target height").toBeGreaterThanOrEqual(44);

    // Nothing may sit on top of it — the old one was there but not clickable.
    const onTop = await btn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el.contains(hit) || el === hit;
    });
    expect(onTop, "expand control must be the topmost element at its centre").toBe(true);

    await btn.click();
    expect(await page.evaluate(() => window.__fs)).not.toEqual([]);
  });

  test("swiping moves through the gallery", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    await open(page);
    const first = await slide(page).getAttribute("data-index");
    await slide(page).evaluate((el) => {
      const pt = (x) => [{ identifier: 1, target: el, clientX: x, clientY: 400 }];
      const fire = (type, x) =>
        el.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true,
          touches: type === "touchend" ? [] : pt(x).map((t) => new Touch(t)),
          changedTouches: pt(x).map((t) => new Touch(t)),
        }));
      fire("touchstart", 320); fire("touchmove", 120); fire("touchend", 120);
    });
    await expect(slide(page)).not.toHaveAttribute("data-index", first);
  });
});

test.describe("loading behaviour", () => {
  test("the poster covers the slide until playback starts — never a black gap", async ({ page }) => {
    await stubYouTube(page, { mode: "never-ready" });
    await page.goto("/led/");
    await open(page);

    const poster = page.locator("[data-poster]");
    await expect(poster).toBeVisible();
    await expect(poster).toHaveCSS("opacity", "1");
    const [p, s] = await Promise.all([poster.boundingBox(), slide(page).boundingBox()]);
    expect(Math.abs(p.height - s.height), "poster should cover the slide").toBeLessThan(2);
  });

  test("a player that never becomes ready stops spinning and offers YouTube", async ({ page }) => {
    await stubYouTube(page, { mode: "never-ready" });
    await page.goto("/led/");
    await open(page);

    // The reported symptom: "sometimes they spin indefinitely and never play."
    await expect(page.locator("[data-spinner]")).toBeHidden({ timeout: 12000 });
    await expect(slide(page)).toHaveAttribute("data-state", "stalled");
    const link = page.locator("[data-fallback] a");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /youtube\.com\/watch|youtu\.be/);
  });

  test("a player error surfaces instead of spinning", async ({ page }) => {
    await stubYouTube(page, { mode: "error" });
    await page.goto("/led/");
    await open(page);
    await expect(page.locator("[data-spinner]")).toBeHidden({ timeout: 12000 });
    await expect(slide(page)).toHaveAttribute("data-state", "error");
    await expect(page.locator("[data-fallback] a")).toBeVisible();
  });
});

test.describe("carousel", () => {
  test("arrow keys and escape work, and focus comes back to the tile", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    const tile = page.locator("[data-tile]").first();
    await tile.click();
    await expect(lightbox(page)).toBeVisible();
    expect(await slide(page).getAttribute("data-index")).toBe("0");

    await page.keyboard.press("ArrowRight");
    await expect(slide(page)).toHaveAttribute("data-index", "1");
    await page.keyboard.press("ArrowLeft");
    await expect(slide(page)).toHaveAttribute("data-index", "0");

    await page.keyboard.press("Escape");
    await expect(lightbox(page)).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.dataset?.yt)).toBe(
      await tile.getAttribute("data-yt"),
    );
  });

  test("images and videos share one carousel", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    const total = await page.locator("[data-tile]").count();
    await page.locator("[data-tile]").first().click();
    await expect(page.locator("[data-counter]")).toHaveText(`1 / ${total}`);
    // Wrap backwards from the first slide to the last, which is an image.
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("[data-counter]")).toHaveText(`${total} / ${total}`);
    await expect(slide(page)).toHaveAttribute("data-kind", "image");
  });
});

test.describe("thumbnail rail", () => {
  // Fancybox showed a filmstrip by default (Thumbs plugin, minCount: 2) and the
  // rewrite dropped it. With 13 items it is the only way to see where you are.
  test("lists every item, marks the current one, and jumps on click", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    const total = await page.locator("[data-tile]").count();
    await open(page, "[data-tile]");

    const thumbs = page.locator("[data-thumb]");
    await expect(thumbs).toHaveCount(total);
    await expect(thumbs.nth(0)).toHaveAttribute("aria-current", "true");

    await thumbs.nth(4).click();
    await expect(slide(page)).toHaveAttribute("data-index", "4");
    await expect(thumbs.nth(4)).toHaveAttribute("aria-current", "true");
    await expect(thumbs.nth(0)).not.toHaveAttribute("aria-current", "true");
  });

  test("follows keyboard navigation", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    await open(page, "[data-tile]");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-thumb]").nth(1)).toHaveAttribute("aria-current", "true");
  });

  test("the toggle hides and restores it, returning the space", async ({ page }, testInfo) => {
    await stubYouTube(page);
    await page.goto("/led/");
    await open(page, "[data-tile]");

    const rail = page.locator("[data-rail]");
    const stage = page.locator("[data-stage]");
    await expect(rail).toBeVisible();
    const before = { stage: await stage.boundingBox(), slide: await slide(page).boundingBox() };

    await page.locator('[data-action="thumbs"]').click();
    await expect(rail).toBeHidden();
    const after = { stage: await stage.boundingBox(), slide: await slide(page).boundingBox() };

    // The freed height goes to the stage rather than being left as a gap.
    expect(after.stage.height).toBeGreaterThan(before.stage.height);
    expect(after.slide.height).toBeGreaterThanOrEqual(before.slide.height);

    // On a phone a 9:16 slide is already as wide as the viewport, so it is
    // width-constrained and cannot grow — only on the wider viewport does the
    // media itself actually get bigger.
    if (testInfo.project.name === "desktop") {
      expect(after.slide.height).toBeGreaterThan(before.slide.height);
    }

    await page.locator('[data-action="thumbs"]').click();
    await expect(rail).toBeVisible();
  });
});

test.describe("phone lightbox with the rail", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a portrait video still fills the viewport with the rail showing", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    await open(page);
    await expect(page.locator("[data-rail]")).toBeVisible();

    const box = await slide(page).boundingBox();
    expect(box.width / 390).toBeGreaterThan(0.85);
    expect(box.height / 844).toBeGreaterThan(0.7);
    // And it must not run under the rail.
    const rail = await page.locator("[data-rail]").boundingBox();
    expect(box.y + box.height, "slide should sit above the rail").toBeLessThanOrEqual(rail.y + 1);
  });
});
