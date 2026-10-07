/*
 * Deep links into the carousel: /led/<slug>/.
 *
 * The contract these specs pin down, in order of how much it would hurt to get
 * wrong:
 *   - a link that is shared reopens the same item, from cold;
 *   - one Back closes the viewer, however far into the set you walked, because
 *     the carousel auto-advances and must not bury the page you came from;
 *   - a ?m= nobody recognises leaves the page alone rather than opening item 1.
 */

const { test, expect } = require("@playwright/test");
const { stubYouTube, endCurrentVideo } = require("./helpers/youtube");

const lightbox = (page) => page.locator("[data-lightbox]");
const slide = (page) => page.locator("[data-slide]");

/*
 * The item the URL names. A path, not a query param — see
 * scripts/build-share-pages.mjs for why link previews force that — so this
 * reads the last path segment, and null at the bare gallery.
 */
const itemInUrl = (page) =>
  page.evaluate(() => {
    const rest = new URL(location.href).pathname.replace(/^\/led\/?/, "").replace(/\/+$/, "");
    return rest || null;
  });

/*
 * By authored order, not DOM order — gallery.js repacks the tiles into column
 * elements, so `[data-tile]` nth(5) is the sixth tile down the columns and has
 * nothing to do with item 6 of the set. data-order is stamped on for exactly
 * this; using nth() here quietly compared the wrong tile's slug.
 */
const tileAt = (page, i) => page.locator(`[data-tile][data-order="${i}"]`);
const slugAt = (page, i) => tileAt(page, i).getAttribute("data-slug");

test.describe("rewriting the URL", () => {
  test("opening a tile names it in the address bar", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    await itemInUrl(page).then((p) => expect(p, "clean before any click").toBeNull());

    const tile = tileAt(page, 0);
    const slug = await tile.getAttribute("data-slug");
    await tile.click();
    await expect(lightbox(page)).toBeVisible();

    expect(await itemInUrl(page)).toBe(slug);
    // Readability of the shared link is the whole point: for a video the slug
    // is the YouTube id, cased as YouTube cases it.
    expect(slug).toBe(await tile.getAttribute("data-yt"));
  });

  test("the param follows the carousel, slide by slide", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    await tileAt(page, 0).click();
    await expect(lightbox(page)).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(slide(page)).toHaveAttribute("data-index", "1");
    expect(await itemInUrl(page)).toBe(await slugAt(page, 1));

    await page.keyboard.press("ArrowRight");
    await expect(slide(page)).toHaveAttribute("data-index", "2");
    expect(await itemInUrl(page)).toBe(await slugAt(page, 2));
  });

  test("closing puts the URL back", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    await tileAt(page, 0).click();
    await expect(lightbox(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(lightbox(page)).toBeHidden();
    await expect.poll(() => itemInUrl(page)).toBeNull();
  });

  test("a whole walk through the set costs one history entry", async ({ page }) => {
    /*
     * Why replaceState and not pushState: with a pushState per slide, a video
     * that auto-advances three times would need four Backs to leave the page,
     * and the visitor never asked to go anywhere.
     */
    await stubYouTube(page);
    await page.goto("/led/");
    const before = await page.evaluate(() => history.length);

    await tileAt(page, 0).click();
    await expect(lightbox(page)).toBeVisible();
    for (const _ of [0, 1, 2]) await page.keyboard.press("ArrowRight");
    await expect(slide(page)).toHaveAttribute("data-index", "3");

    expect(await page.evaluate(() => history.length) - before).toBe(1);

    await page.goBack();
    await expect(lightbox(page), "one Back should close it").toBeHidden();
    await expect.poll(() => itemInUrl(page)).toBeNull();
  });

  test("Forward reopens where you were", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    await tileAt(page, 2).click();
    await expect(slide(page)).toHaveAttribute("data-index", "2");

    await page.goBack();
    await expect(lightbox(page)).toBeHidden();
    await page.goForward();
    await expect(lightbox(page)).toBeVisible();
    await expect(slide(page)).toHaveAttribute("data-index", "2");
  });
});

test.describe("honouring the URL", () => {
  test("a shared link opens that item, playing", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    const slug = await slugAt(page, 5);

    await page.goto(`/led/${slug}/`);
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });
    await expect(slide(page)).toHaveAttribute("data-index", "5");
    await expect(slide(page)).toHaveAttribute("data-state", "playing", { timeout: 8000 });
  });

  test("a photo's link opens the photo", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/img-7415/");
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });
    await expect(slide(page)).toHaveAttribute("data-kind", "image");
    expect(await page.locator("[data-poster]").getAttribute("src")).toContain("7415");
  });

  test("the old ?m= links still work, and upgrade themselves to the path", async ({ page }) => {
    /*
     * ?m= was the shareable URL before share pages existed, and links in other
     * people's chat histories do not get a migration. They are still honoured,
     * and rewritten to /led/<slug>/ on arrival so the copy the visitor shares
     * on is the one that previews.
     */
    await stubYouTube(page);
    await page.goto("/led/");
    const slug = await slugAt(page, 1);

    await page.goto(`/led/?m=${slug}`);
    await expect(slide(page)).toHaveAttribute("data-index", "1", { timeout: 8000 });
    await expect.poll(() => itemInUrl(page)).toBe(slug);
    expect(await page.evaluate(() => location.search), "the param should be gone").toBe("");
  });

  test("?v= and a bare index are honoured too", async ({ page }) => {
    // What someone hand-editing a link reaches for.
    await stubYouTube(page);
    await page.goto("/led/");
    const slug = await slugAt(page, 1);

    await page.goto(`/led/?v=${slug}`);
    await expect(slide(page)).toHaveAttribute("data-index", "1", { timeout: 8000 });
    await expect.poll(() => itemInUrl(page)).toBe(slug);

    await page.goto("/led/?m=3");
    await expect(slide(page)).toHaveAttribute("data-index", "2", { timeout: 8000 });
  });

  test("an unrecognised item leaves the page alone", async ({ page }) => {
    // Opening item 1 for a link that asked for something else is a worse
    // answer than ignoring it — the visitor would never know they'd been
    // redirected. (A nonexistent *path* is a 404 from the host; this is the
    // query form, which reaches the page.)
    await stubYouTube(page);
    await page.goto("/led/?m=no-such-thing");
    await page.waitForSelector(".gallery__col");
    await page.waitForTimeout(1200);

    await expect(lightbox(page)).toBeHidden();
    expect(await page.evaluate(() => window.scrollY), "and should not scroll off").toBe(0);
  });

  test("Back from a shared link closes the viewer onto the gallery", async ({ page }) => {
    /*
     * Arriving on ?m=, the entry underneath is the referrer, so Back would
     * leave the site with the visitor never having seen the page they landed
     * on. open() rewrites that entry to the bare gallery and pushes the item
     * on top, so Back means the same thing it does after a click.
     */
    await stubYouTube(page);
    await page.goto("/led/");
    const slug = await slugAt(page, 4);
    await page.goto(`/led/${slug}/`);
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });

    await page.goBack();
    await expect(lightbox(page)).toBeHidden();
    await expect.poll(() => itemInUrl(page)).toBeNull();
    await expect(page.locator(".gallery__col").first()).toBeVisible();
  });

  test("a reload of a shared link lands on the same item", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/img-0494/");
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });
    const index = await slide(page).getAttribute("data-index");

    await page.reload();
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });
    await expect(slide(page)).toHaveAttribute("data-index", index);
  });
});

test.describe("the scroll in", () => {
  // Every scroll position the page passed through, so "it glided" and "it
  // jumped" are distinguishable without sampling from the test side.
  const recordScroll = (page) =>
    page.addInitScript(() => {
      window.__trail = [];
      addEventListener("scroll", () => window.__trail.push(Math.round(window.scrollY)), {
        passive: true,
      });
    });

  const trail = (page) => page.evaluate(() => window.__trail ?? []);

  test("a shared link travels from the top of the page down to the tiles", async ({ page }) => {
    /*
     * A lightbox materialising over a page the visitor has never seen tells
     * them nothing about where they are. The scroll is what makes a shared
     * link read as "this page, and this thing in it".
     */
    await recordScroll(page);
    await stubYouTube(page);
    await page.goto("/led/qo0L7gmySvQ/");
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });

    const seen = await trail(page);
    expect(seen.length, "should have moved at all").toBeGreaterThan(0);
    expect(seen[0], "should set off from the top of the page").toBeLessThan(400);
    expect(seen.at(-1), "and arrive at the gallery").toBeGreaterThan(80);
    expect(seen.at(-1)).toBe(await page.evaluate(() => Math.round(window.scrollY)));

    // Travelled to, not just landed on: the tiles should be on screen.
    const [box, h] = await Promise.all([
      page.locator("[data-gallery]").boundingBox(),
      page.evaluate(() => innerHeight),
    ]);
    expect(box.y).toBeLessThan(h);
  });

  test("it glides, rather than teleporting", async ({ page }) => {
    await recordScroll(page);
    await stubYouTube(page);
    await page.goto("/led/qo0L7gmySvQ/");
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });

    const seen = await trail(page);
    expect(
      seen.length,
      `a smooth scroll fires a scroll event per frame; got ${seen.length}: ${seen}`,
    ).toBeGreaterThan(2);
  });

  test("it is a jump, not a glide, under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordScroll(page);
    await stubYouTube(page);
    await page.goto("/led/qo0L7gmySvQ/");
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });

    expect(await page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(80);
    const seen = await trail(page);
    expect(seen.length, `should be one hop, got ${seen}`).toBeLessThanOrEqual(2);
  });

  test("closing leaves the visitor at the gallery, not back at the top", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/qo0L7gmySvQ/");
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });
    await page.keyboard.press("Escape");
    await expect(lightbox(page)).toBeHidden();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(80);
  });
});

test.describe("the cycle", () => {
  test("a shared link plays the set through, photos included", async ({ page }) => {
    /*
     * Videos already rolled into the next item when they ended. A photo had no
     * clock of its own, so the show stopped dead at the first one — which on
     * this page is item 9 of 13.
     */
    await stubYouTube(page);
    await page.goto("/led/img-0328/");
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });
    await expect(slide(page)).toHaveAttribute("data-kind", "image");
    const from = Number(await slide(page).getAttribute("data-index"));

    await expect(slide(page)).toHaveAttribute("data-index", String(from + 1), {
      timeout: 12000,
    });
  });

  test("a photo opened by hand stays put", async ({ page }) => {
    // The other half of the rule: looking at a photo is not a slideshow.
    await stubYouTube(page);
    await page.goto("/led/");
    await tileAt(page, 8).click(); // the first photo in the set
    await expect(lightbox(page)).toBeVisible();
    const at = await slide(page).getAttribute("data-index");

    await page.waitForTimeout(8000);
    await expect(slide(page)).toHaveAttribute("data-index", at);
  });

  test("steering stops the show", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/img-0328/");
    await expect(lightbox(page)).toBeVisible({ timeout: 8000 });
    await expect(slide(page)).toHaveAttribute("data-kind", "image");

    // An arrow is the visitor taking the wheel, even mid-show.
    await page.keyboard.press("ArrowRight");
    const at = await slide(page).getAttribute("data-index");
    await page.waitForTimeout(8000);
    await expect(slide(page)).toHaveAttribute("data-index", at);
  });

  test("a video that ends hands the show to the photo after it", async ({ page }) => {
    await stubYouTube(page);
    await page.goto("/led/");
    const total = await page.locator("[data-tile]").count();
    // The last video, so one auto-advance lands on the first photo.
    await tileAt(page, 7).click();
    await expect(slide(page)).toHaveAttribute("data-state", "playing", { timeout: 8000 });

    await endCurrentVideo(page);
    await expect(slide(page)).toHaveAttribute("data-index", "8");
    await expect(slide(page)).toHaveAttribute("data-kind", "image");

    // Arrived by itself, so the carousel keeps going rather than stopping on
    // a photo nobody chose.
    await expect(slide(page)).toHaveAttribute("data-index", "9", { timeout: 12000 });
    expect(9).toBeLessThan(total);
  });
});

test.describe("the share button", () => {
  test("hands over the absolute link to the current item", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await stubYouTube(page);
    await page.goto("/led/");
    // No share sheet here, so the clipboard path is the one under test.
    await page.evaluate(() => { delete navigator.share; });

    await tileAt(page, 3).click();
    await expect(lightbox(page)).toBeVisible();
    const slug = await slugAt(page, 3);

    await page.locator('[data-action="share"]').click();
    await expect(page.locator("[data-toast]")).toHaveAttribute("data-on", "");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied, "the path form, which is the one that previews").toContain(`/led/${slug}/`);
    expect(copied).not.toContain("?m=");
    expect(copied, "a link worth sharing is absolute").toMatch(/^https?:\/\//);
  });

  test("uses the share sheet where there is one", async ({ page }) => {
    await stubYouTube(page);
    await page.addInitScript(() => {
      window.__shared = [];
      navigator.share = (data) => { window.__shared.push(data); return Promise.resolve(); };
    });
    await page.goto("/led/");
    await tileAt(page, 0).click();
    await expect(lightbox(page)).toBeVisible();

    await page.locator('[data-action="share"]').click();
    const shared = await page.evaluate(() => window.__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].url).toMatch(/\/led\/[^/]+\/$/);
    expect(shared[0].title, "the caption, so the link arrives with a name").toBeTruthy();
  });
});
