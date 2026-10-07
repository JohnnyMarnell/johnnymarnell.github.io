/*
 * Post-build step: give every gallery item a URL that previews as that item.
 * Runs over _site after `jekyll build` (see the `build` recipe and
 * .github/workflows/pages.yml). Nothing it makes is committed, and nothing in
 * the source tree knows it exists — adding a clip is still one
 * `{% include video %}` line in led.md.
 *
 * Why a build step and not a page per item in the repo. A link preview is made
 * by a crawler that fetches the URL and reads og: tags out of the HTML: it
 * never runs JavaScript, and GitHub Pages answers every query string with
 * byte-identical HTML, so /led/?m=<slug> can only ever preview as /led/. A
 * per-item preview needs a per-item *path*. Committing one stub per item does
 * that and costs an editing step per clip forever, which is not worth it. This
 * does it at build time instead.
 *
 * Why not a Jekyll generator plugin, which would be the idiomatic answer: the
 * `github-pages` gem forces safe mode, so _plugins/ is ignored even in a local
 * `bundle exec jekyll build`. Dropping that gem would re-float every pinned
 * version the rest of the site renders with, to buy nothing this cannot do.
 *
 * It reads the built page rather than any list of its own, so it cannot drift
 * from what the gallery actually shows: the tiles already carry data-slug,
 * data-kind and data-caption, and gallery.js indexes by the same slugs.
 */
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const SITE = join(REPO, process.argv[2] ?? "_site");
const CACHE = join(REPO, ".jekyll-cache/share");
const PREVIEW_WIDTH = 1200; // what a photo is shrunk to; see makePreview
const DESCRIPTION_MAX = 200;

const MARKER_BEGIN = "<!-- Begin share page tags (scripts/share-pages.mjs) -->";
const MARKER_END = "<!-- End share page tags -->";

const log = (...a) => console.log(" ", ...a);

/* ------------------------------------------------------------------ html --- */

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/*
 * Tiles, in the order the page lists them — which is authored order, since
 * gallery.js only repacks them into columns at runtime.
 */
function tilesIn(html) {
  return [...html.matchAll(/<a class="tile"[^>]*>/g)]
    .map((m) => m[0])
    .map((tag) => ({
      slug: attr(tag, "data-slug"),
      kind: attr(tag, "data-kind"),
      caption: attr(tag, "data-caption"),
      youtube: attr(tag, "data-yt"),
      href: attr(tag, "href"),
    }))
    .filter((t) => t.slug);
}

/*
 * The poster chain the tile itself carries: src first, then the steps in
 * data-poster-fallback. maxresdefault is missing for plenty of uploads, and an
 * og:image that 404s renders as no preview at all, so the chain is walked
 * rather than guessed — and it is the same chain the <img> falls back through,
 * so the preview and the tile can never disagree.
 */
function posterChain(html, slug) {
  const img = html.match(new RegExp(`data-slug="${slug}"[\\s\\S]{0,1200}?<img[^>]*>`))?.[0] ?? "";
  const tag = img.match(/<img[^>]*>$/)?.[0] ?? "";
  return [attr(tag, "src"), ...attr(tag, "data-poster-fallback").split("|")].filter(Boolean);
}

/* ----------------------------------------------------------------- cache --- */

async function cached(key, fn) {
  const file = join(CACHE, "probes.json");
  const all = JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
  if (all[key]) return all[key];
  const value = await fn();
  all[key] = value;
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(all, null, 1));
  return value;
}

/** Width/height from a JPEG's SOF marker. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/*
 * The first poster in the chain that is actually there, with its real pixel
 * size. Offline, the first one is used unprobed and the build carries on with
 * a warning: a wrong og:image size is a worse preview, not a broken site, and
 * a deploy that fails because YouTube was unreachable helps nobody.
 */
async function resolvePoster(chain, slug) {
  return cached(`poster:${slug}`, async () => {
    for (const url of chain) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const size = jpegSize(Buffer.from(await res.arrayBuffer()));
        if (size) return { url, ...size };
      } catch {
        console.warn(`  ! could not reach ${url} — using it unprobed`);
        return { url: chain[0], width: 1280, height: 720 };
      }
    }
    console.warn(`  ! no poster in the chain for ${slug} answered — using ${chain[0]}`);
    return { url: chain[0], width: 1280, height: 720 };
  });
}

/* -------------------------------------------------------------- previews --- */

const has = (cmd) => {
  try {
    execFileSync("/bin/sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const RESIZER = ["magick", "convert", "ffmpeg", "sips"].find(has);

/*
 * A photo cannot be its own preview: the originals here are 0.8-2.8 MB at
 * 4032px, and crawlers skip images that big — the failure mode where a link
 * previews fine in desktop Slack and shows nothing on a phone. So each gets a
 * ~1200px copy, built into _site and cached between builds.
 */
async function makePreview(src, dest) {
  if (!RESIZER) {
    throw new Error(
      "no image resizer found — need one of magick, convert (ImageMagick), ffmpeg or sips.\n" +
        "  macOS ships sips; ubuntu-latest ships ImageMagick; otherwise `brew install imagemagick`.",
    );
  }
  const info = await stat(src);
  const key = join(CACHE, `${info.size}-${Math.round(info.mtimeMs)}-${dest.split("/").pop()}`);
  const warm = await readFile(key).catch(() => null);
  await mkdir(dirname(dest), { recursive: true });

  if (warm) {
    await writeFile(dest, warm);
  } else {
    if (RESIZER === "ffmpeg") {
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src,
        "-vf", `scale=${PREVIEW_WIDTH}:-2:flags=lanczos`, "-q:v", "4", "-map_metadata", "-1", dest]);
    } else if (RESIZER === "sips") {
      execFileSync("sips", ["-Z", String(PREVIEW_WIDTH), src, "--out", dest], { stdio: "ignore" });
    } else {
      execFileSync(RESIZER, [src, "-resize", `${PREVIEW_WIDTH}x>`, "-strip", "-quality", "82", dest]);
    }
    await mkdir(CACHE, { recursive: true });
    await writeFile(key, await readFile(dest));
  }
  return jpegSize(await readFile(dest)) ?? { width: PREVIEW_WIDTH, height: PREVIEW_WIDTH };
}

/* ----------------------------------------------------------------- pages --- */

function seoBlock({ title, siteTitle, description, url, image, locale }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    description,
    headline: title,
    image: image.url,
    url,
  };
  return [
    MARKER_BEGIN,
    `<title>${esc(title)} | ${esc(siteTitle)}</title>`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:locale" content="${esc(locale)}" />`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:site_name" content="${esc(siteTitle)}" />`,
    `<meta property="og:image" content="${esc(image.url)}" />`,
    `<meta property="og:image:width" content="${image.width}" />`,
    `<meta property="og:image:height" content="${image.height}" />`,
    `<meta property="og:image:alt" content="${esc(title)}" />`,
    `<meta property="og:type" content="website" />`,
    // `summary` renders a thumbnail the size of a favicon, which is the thing
    // this whole step exists to avoid.
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta property="twitter:image" content="${esc(image.url)}" />`,
    `<meta name="twitter:image:alt" content="${esc(title)}" />`,
    `<meta property="twitter:title" content="${esc(title)}" />`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
    MARKER_END,
  ].join("\n");
}

// jekyll-seo-tag wraps its output in these, which makes the whole block one
// replaceable unit instead of a dozen separate tags to pick out.
const SEO_RE = /<!-- Begin Jekyll SEO tag[\s\S]*?<!-- End Jekyll SEO tag -->/;

function withTags(html, block) {
  if (!SEO_RE.test(html)) throw new Error("no jekyll-seo-tag block to replace — is {% seo %} still in the layout?");
  return html.replace(SEO_RE, block);
}

/*
 * Tells gallery.js that share pages exist, so it writes /led/<slug>/ rather
 * than ?m=. Injected here rather than put in the layout on purpose: a build
 * that skipped this step (`jekyll serve`, say) has no share pages, and the
 * gallery should fall back to ?m= there instead of linking at 404s.
 */
const baseMeta = (base) => `<meta name="gallery-base" content="${esc(base)}">`;

const inHead = (html, tag) => html.replace("</head>", `${tag}\n  </head>`);

/*
 * The page's own opening paragraph, as the line under the item's caption in a
 * preview. Derived rather than authored, so there is nothing extra to write
 * when a gallery is added.
 */
function describe(html, fallback) {
  const p = html.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? "";
  const text = p.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (text.length < 40) return fallback;
  if (text.length <= DESCRIPTION_MAX) return text;
  const cut = text.slice(0, DESCRIPTION_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,;:.]$/, "")}…`;
}

/* ------------------------------------------------------------------ walk --- */

async function htmlFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^(assets|img|jupyter)$/.test(entry.name)) continue;
      await htmlFiles(path, out);
    } else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

const pages = [];
for (const file of await htmlFiles(SITE)) {
  const html = await readFile(file, "utf8");
  // Skip pages this step made on a previous run over the same _site.
  if (!html.includes("data-gallery") || html.includes(MARKER_END)) continue;
  pages.push({ file, html });
}

if (!pages.length) {
  console.log("no gallery pages in _site — nothing to do");
  process.exit(0);
}

let made = 0;
for (const { file, html } of pages) {
  const dir = dirname(file);
  const base = `/${relative(SITE, dir)}/`.replace(/^\/\.\//, "/").replace("//", "/");
  const siteUrl = (html.match(/property="og:url" content="([^"]*)"/)?.[1] ?? "").replace(/\/[^/]*\/?$/, "");
  const siteTitle = html.match(/property="og:site_name" content="([^"]*)"/)?.[1] ?? "";
  const locale = html.match(/property="og:locale" content="([^"]*)"/)?.[1] ?? "en_US";
  const siteDescription = html.match(/property="og:description" content="([^"]*)"/)?.[1] ?? "";
  const description = describe(html, siteDescription);

  const tiles = tilesIn(html);
  console.log(`${base}  ${tiles.length} items`);

  const images = [];
  for (const tile of tiles) {
    if (tile.kind === "video") {
      const p = await resolvePoster(posterChain(html, tile.slug), tile.slug);
      images.push({ tile, image: p });
    } else {
      const src = join(REPO, tile.href.replace(/^\//, ""));
      const dest = join(SITE, "assets/share", `${tile.slug}.jpg`);
      const size = await makePreview(src, dest);
      images.push({
        tile,
        image: { url: `${siteUrl}/assets/share/${tile.slug}.jpg`, ...size },
      });
      log(`assets/share/${tile.slug}.jpg  ${size.width}x${size.height}`);
    }
  }

  // The gallery index gets a preview of its own, from its first item.
  const index = withTags(
    html,
    seoBlock({
      title: html.match(/property="og:title" content="([^"]*)"/)?.[1] ?? siteTitle,
      siteTitle, description, locale,
      url: `${siteUrl}${base}`,
      image: images[0].image,
    }),
  );
  await writeFile(file, inHead(index, baseMeta(base)));

  for (const { tile, image } of images) {
    const page = withTags(
      html,
      seoBlock({
        title: tile.caption, siteTitle, description, locale,
        url: `${siteUrl}${base}${tile.slug}/`,
        image,
      }),
    );
    const out = join(dir, tile.slug, "index.html");
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, inHead(page, baseMeta(base)));
    made += 1;
  }
  log(`${tiles.length} share pages under ${base}`);
}

console.log(`\n${made} share pages written into ${relative(REPO, SITE)}/`);
