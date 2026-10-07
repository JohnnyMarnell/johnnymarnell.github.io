/*
 * The share pages: /led/<slug>/, one per gallery item, carrying the og: tags a
 * link preview is built from.
 *
 * These assert the *server-rendered* HTML, deliberately — that is all a
 * WhatsApp or iMessage crawler ever sees. It fetches the URL, reads the tags,
 * and never runs a line of JavaScript, so anything the gallery does at runtime
 * is invisible to it. If these pass, a pasted link previews; if the page only
 * looked right in a browser, it would not.
 */

const { test, expect } = require("@playwright/test");
const { execFileSync } = require("node:child_process");
const { statSync } = require("node:fs");
const { join } = require("node:path");

const REPO = join(__dirname, "..");

const yaml = (name) =>
  JSON.parse(
    execFileSync("ruby", [
      "-ryaml", "-rjson", "-e", "puts YAML.load_file(ARGV[0]).to_json",
      join(REPO, "_data", name),
    ], { encoding: "utf8" }),
  );

const led = yaml("led.yml");
const media = yaml("media.yml");

const slugFor = (item) =>
  item.video || item.image.split("/").pop().split(".")[0].toLowerCase().replace(/_/g, "-");

// Read the page as a crawler does: one fetch, no browser, no scripts.
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
  meta.__title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  meta.__canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? "";
  return meta;
}

// Run under both projects even though none of this is device-dependent: they
// are HTTP fetches with no rendering, so the second pass is nearly free and
// proves exactly that.
test.describe("link previews", () => {
  test("every gallery item has a share page naming that item", async ({ request }) => {
    expect(led.items.length, "the gallery should not be empty").toBeGreaterThan(0);

    for (const item of led.items) {
      const slug = slugFor(item);
      const meta = await crawl(request, `/led/${slug}/`);

      expect(meta["og:title"], `${slug} og:title`).toBe(item.alt);
      expect(meta.__title, `${slug} <title>`).toContain(item.alt);
      expect(meta["og:url"], `${slug} og:url`).toBe(
        `https://johnnymarnell.github.io/led/${slug}/`,
      );
      // Self-canonical: the preview has to survive the crawler following it.
      expect(meta.__canonical, `${slug} canonical`).toBe(meta["og:url"]);
      expect(meta["og:image:alt"], `${slug} og:image:alt`).toBe(item.alt);
      // A bare `summary` card renders as a thumbnail the size of a favicon,
      // which is the thing this whole feature exists to avoid.
      expect(meta["twitter:card"], `${slug} card size`).toBe("summary_large_image");
      expect(meta["og:description"], `${slug} og:description`).toBeTruthy();
    }
  });

  test("a video's preview image is that video's own YouTube poster", async ({ request }) => {
    const videos = led.items.filter((i) => i.video);
    expect(videos.length).toBeGreaterThan(0);

    for (const item of videos) {
      const meta = await crawl(request, `/led/${item.video}/`);
      // i.ytimg.com/vi/<id>/... — the same image youtube.com's own links
      // preview with, so a shared clip looks like a shared YouTube clip.
      expect(meta["og:image"], `${item.video} og:image`).toBe(
        `https://i.ytimg.com/vi/${item.video}/${media.videos[item.video].poster}`,
      );
      expect(Number(meta["og:image:width"]), `${item.video} width`).toBeGreaterThanOrEqual(640);
    }
  });

  test("a photo's preview is the downsized copy, not the 2 MB original", async ({ request }) => {
    /*
     * The originals here are 0.8-2.8 MB at 4032px. Crawlers skip images that
     * big — WhatsApp simply renders no picture — so each photo gets a ~1200px
     * copy. This is the assertion that would have caught "it previews fine on
     * desktop Slack and shows nothing on a phone".
     */
    const photos = led.items.filter((i) => i.image);
    expect(photos.length).toBeGreaterThan(0);

    for (const item of photos) {
      const slug = slugFor(item);
      const meta = await crawl(request, `/led/${slug}/`);
      expect(meta["og:image"], `${slug} should not point at the original`).toBe(
        `https://johnnymarnell.github.io/assets/share/${slug}.jpg`,
      );

      const res = await request.get(`/assets/share/${slug}.jpg`);
      expect(res.status(), `${slug} preview should be published`).toBe(200);
      const bytes = (await res.body()).length;
      expect(bytes, `${slug} preview is ${(bytes / 1024).toFixed(0)} KB`).toBeLessThan(600 * 1024);

      const original = statSync(join(REPO, item.image.replace(/^\//, ""))).size;
      expect(bytes, `${slug} should be smaller than the original`).toBeLessThan(original);
    }
  });

  test("the gallery index has a preview of its own", async ({ request }) => {
    const meta = await crawl(request, "/led/");
    expect(meta["og:image"]).toBeTruthy();
    expect(meta["twitter:card"]).toBe("summary_large_image");
    expect(meta["og:title"]).toBe("LEDs");
  });

  test("a share page is the whole gallery, not a redirect stub", async ({ page }) => {
    // Someone who opens the link gets the real page — prose, every tile, the
    // lot — rather than a bounce through an empty document.
    const res = await page.request.get("/led/img-7415/");
    const html = await res.text();
    expect((html.match(/data-tile/g) || []).length).toBeGreaterThanOrEqual(led.items.length);
    expect(html, "the page's own prose should be there").toContain("Burning Man");
    expect(html).not.toMatch(/http-equiv="refresh"/i);
  });

  test("share/ is in step with _data/led.yml", async () => {
    /*
     * The pages are generated and committed, so adding a gallery item without
     * running `just share` would ship an item whose link previews as nothing —
     * invisible in a browser, and only noticed when someone pastes it. This is
     * the generator's own --check: regenerate in memory, diff against disk.
     */
    let out = "";
    try {
      out = execFileSync("node", ["scripts/build-share-pages.mjs", "--check"], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      throw new Error(
        `run \`just share\` and commit the result:\n${err.stderr || ""}${err.stdout || ""}`,
      );
    }
    expect(out).toContain("up to date");
  });

  test("every share page is reachable, and none is left over", async ({ request }) => {
    // The other direction: a file in share/ that no longer has a gallery item
    // behind it would publish a page the gallery cannot open.
    const onDisk = execFileSync("ls", ["share"], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.slice(0, -3))
      .sort();
    expect(onDisk).toEqual(led.items.map(slugFor).sort());

    for (const slug of onDisk) {
      expect((await request.get(`/led/${slug}/`)).status()).toBe(200);
    }
  });

  test("every og:image resolves to something that exists", async ({ request, baseURL }) => {
    /*
     * Our own preview files are fetched from the build. YouTube's posters are
     * not fetched here on purpose — the suite stubs YouTube precisely so it
     * never depends on reaching it (see CLAUDE.md) — their existence is
     * settled by `just media`, which probes maxresdefault/hq720/mqdefault and
     * records the one that is real. So this checks the page points at what was
     * recorded, and `just media` is what checks it is there.
     */
    const site = "https://johnnymarnell.github.io";

    for (const item of led.items) {
      const meta = await crawl(request, `/led/${slugFor(item)}/`);
      const url = meta["og:image"];
      expect(url, `${slugFor(item)} has no og:image`).toBeTruthy();

      if (url.startsWith(site)) {
        const res = await request.get(url.replace(site, baseURL));
        expect(res.status(), `${url} is not in the build`).toBe(200);
        expect(res.headers()["content-type"], url).toMatch(/^image\//);
      } else {
        const known = media.videos[item.video];
        expect(url, "should be the poster `just media` found").toBe(
          `https://i.ytimg.com/vi/${item.video}/${known.poster}`,
        );
        expect(meta["og:image:width"]).toBe(String(known.poster_width));
        expect(meta["og:image:height"]).toBe(String(known.poster_height));
      }
    }
  });
});
