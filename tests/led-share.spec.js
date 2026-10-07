/*
 * The share pages the build step writes: /led/<slug>/, one per gallery item,
 * carrying the og: tags a link preview is built from.
 *
 * These assert the *server-rendered* HTML, deliberately — that is all a
 * WhatsApp or iMessage crawler ever sees. It fetches the URL, reads the tags,
 * and never runs a line of JavaScript, so anything the gallery does at runtime
 * is invisible to it. If these pass, a pasted link previews; a page that only
 * looked right in a browser would not.
 *
 * Nothing here reads a list of its own: the expected items come from the built
 * /led/ page's tiles, which is the same thing scripts/share-pages.mjs walks and
 * the same thing gallery.js indexes. There is no third copy to fall out of step.
 */

const { test, expect } = require("@playwright/test");

const SITE = "https://johnnymarnell.github.io";

// Read a page the way a crawler does: one fetch, no browser, no scripts.
async function crawl(request, path) {
  const res = await request.get(path);
  expect(res.status(), `${path} should be a real page`).toBe(200);
  const html = await res.text();
  const meta = {};
  for (const m of html.matchAll(
    /<meta\s+(?:property|name)="((?:og|twitter):[^"]+)"\s+content="([^"]*)"\s*\/?>/g,
  )) {
    meta[m[1]] = m[2];
  }
  meta.__html = html;
  meta.__title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  meta.__canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? "";
  return meta;
}

// Every tile on the built gallery page: slug, kind and caption, as emitted.
async function tiles(request) {
  const res = await request.get("/led/");
  expect(res.status()).toBe(200);
  const html = await res.text();
  const found = [...html.matchAll(/<a class="tile"[^>]*>/g)].map((m) => ({
    slug: m[0].match(/data-slug="([^"]*)"/)?.[1],
    kind: m[0].match(/data-kind="([^"]*)"/)?.[1],
    caption: m[0].match(/data-caption="([^"]*)"/)?.[1],
    youtube: m[0].match(/data-yt="([^"]*)"/)?.[1] ?? "",
  }));
  expect(found.length, "the gallery should have tiles").toBeGreaterThan(0);
  for (const t of found) expect(t.slug, "every tile needs a slug").toBeTruthy();
  return found;
}

test.describe("link previews", () => {
  test("every gallery item has a share page naming that item", async ({ request }) => {
    for (const tile of await tiles(request)) {
      const meta = await crawl(request, `/led/${tile.slug}/`);

      expect(meta["og:title"], `${tile.slug} og:title`).toBe(tile.caption);
      expect(meta.__title, `${tile.slug} <title>`).toContain(tile.caption);
      expect(meta["og:url"], `${tile.slug} og:url`).toBe(`${SITE}/led/${tile.slug}/`);
      // Self-canonical: the preview has to survive the crawler following it.
      expect(meta.__canonical, `${tile.slug} canonical`).toBe(meta["og:url"]);
      expect(meta["og:image:alt"], `${tile.slug} og:image:alt`).toBe(tile.caption);
      // `summary` renders a thumbnail the size of a favicon, which is the
      // thing this whole step exists to avoid.
      expect(meta["twitter:card"], `${tile.slug} card size`).toBe("summary_large_image");
      expect(meta["og:description"], `${tile.slug} og:description`).toBeTruthy();
      // Derived from the page's own opening paragraph, so there is nothing
      // extra to write when a gallery is added.
      expect(meta["og:description"], `${tile.slug} description`).toContain("Burning Man");
    }
  });

  test("a video's preview image is a YouTube poster for that video", async ({ request }) => {
    const videos = (await tiles(request)).filter((t) => t.kind === "video");
    expect(videos.length).toBeGreaterThan(0);

    for (const tile of videos) {
      const meta = await crawl(request, `/led/${tile.slug}/`);
      // i.ytimg.com/vi/<id>/... — the same image a youtube.com link previews
      // with, so a shared clip looks like a shared YouTube clip.
      expect(meta["og:image"], `${tile.slug} og:image`).toMatch(
        new RegExp(`^https://i\\.ytimg\\.com/vi/${tile.youtube}/`),
      );
      expect(Number(meta["og:image:width"]), `${tile.slug} width`).toBeGreaterThanOrEqual(640);
    }
  });

  test("a photo's preview is a downsized copy, not the 2 MB original", async ({ request, baseURL }) => {
    /*
     * The originals are 0.8-2.8 MB at 4032px. Crawlers skip images that big —
     * WhatsApp simply renders no picture — so the build step resizes each one.
     * This is the assertion that would catch "it previews fine in desktop
     * Slack and shows nothing on a phone".
     */
    const photos = (await tiles(request)).filter((t) => t.kind === "image");
    expect(photos.length).toBeGreaterThan(0);

    for (const tile of photos) {
      const meta = await crawl(request, `/led/${tile.slug}/`);
      expect(meta["og:image"], `${tile.slug} should not point at the original`).toBe(
        `${SITE}/assets/share/${tile.slug}.jpg`,
      );

      const res = await request.get(`/assets/share/${tile.slug}.jpg`);
      expect(res.status(), `${tile.slug} preview should be in the build`).toBe(200);
      const bytes = (await res.body()).length;
      expect(bytes, `${tile.slug} preview is ${(bytes / 1024).toFixed(0)} KB`).toBeLessThan(600 * 1024);
      expect(Number(meta["og:image:width"])).toBeLessThanOrEqual(1200);
    }
  });

  test("the gallery index previews too, and says share pages exist", async ({ request }) => {
    const meta = await crawl(request, "/led/");
    expect(meta["og:image"], "/led/ had no image at all before this").toBeTruthy();
    expect(meta["twitter:card"]).toBe("summary_large_image");
    expect(meta["og:title"]).toBe("LEDs");
    expect(meta["og:url"]).toBe(`${SITE}/led/`);
    // What tells gallery.js to write paths rather than ?m=.
    expect(meta.__html).toContain('name="gallery-base" content="/led/"');
  });

  test("a share page is the whole gallery, not a redirect stub", async ({ request }) => {
    // Someone who opens the link gets the real page — prose, every tile, the
    // lot — rather than a bounce through an empty document.
    const all = await tiles(request);
    const meta = await crawl(request, `/led/${all.at(-1).slug}/`);
    expect((meta.__html.match(/data-tile/g) || []).length).toBeGreaterThanOrEqual(all.length);
    expect(meta.__html, "the page's own prose should be there").toContain("Burning Man");
    expect(meta.__html).not.toMatch(/http-equiv="refresh"/i);
  });

  test("no page carries two answers for what it is", async ({ request }) => {
    // The step replaces jekyll-seo-tag's block rather than appending to it;
    // two og:title tags and a crawler picks whichever it likes.
    const first = (await tiles(request))[0].slug;
    for (const path of ["/led/", `/led/${first}/`]) {
      const html = await (await request.get(path)).text();
      for (const tag of ["og:title", "og:image", "og:url", "twitter:card"]) {
        const n = (html.match(new RegExp(`"${tag}"`, "g")) || []).length;
        expect(n, `${path} has ${n} ${tag} tags`).toBe(1);
      }
      expect((html.match(/<title>/g) || []).length, `${path} <title>`).toBe(1);
      expect(html, `${path} still has the original SEO block`).not.toContain("Begin Jekyll SEO tag");
    }
  });

  test("every og:image resolves to something that exists", async ({ request, baseURL }) => {
    /*
     * Our own preview files are fetched from the build. YouTube's posters are
     * not fetched here on purpose — the suite stubs YouTube precisely so it
     * never depends on reaching it (see CLAUDE.md). The build step walks the
     * tile's own poster fallback chain and picks one that answered, which is
     * where that risk is handled.
     */
    for (const tile of await tiles(request)) {
      const meta = await crawl(request, `/led/${tile.slug}/`);
      const url = meta["og:image"];
      expect(url, `${tile.slug} has no og:image`).toBeTruthy();
      expect(Number(meta["og:image:height"]), `${tile.slug} height`).toBeGreaterThan(0);

      if (url.startsWith(SITE)) {
        const res = await request.get(url.replace(SITE, baseURL));
        expect(res.status(), `${url} is not in the build`).toBe(200);
        expect(res.headers()["content-type"], url).toMatch(/^image\//);
      }
    }
  });
});
