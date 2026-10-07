# CLAUDE.md

Jekyll site for johnnymarnell.github.io, served by GitHub Pages from `main`.

## Commands

```bash
just install       # bundle install (Ruby gems -> vendor/bundle)
just serve         # jekyll serve --livereload on :4000
just build         # jekyll build + the share-page step -> _site/
just share         # the share-page step alone, over the existing _site
just test-install  # npm install + playwright install chromium (once)
just test          # jekyll build, then Playwright (desktop + phone projects)
just test-fast     # same, against the existing _site — skips the ~15s rebuild
```

`bundle` lives in `~/.local/share/gem/ruby/3.2.0/bin` on the OCI box, which is
**not** on a non-login shell's PATH. Export it before running `just test`, or
the Playwright `globalSetup` fails with a message telling you the same thing.

## The gallery (`/led`, `_layouts/gallery.html`)

`assets/css/gallery.css` + `assets/js/gallery.js`, no third-party runtime deps
(Fancybox and the FontAwesome kit were both removed — only `_drafts/` still
references FA, and it inlines its own copy). Tiles are emitted by
`_includes/video` and `_includes/image` and share one contract: `.tile[data-tile]`
carrying `data-kind`, `data-orientation`, `data-aspect`, `data-caption`.

**A video's orientation must be declared; it cannot be detected.** YouTube
serves every poster as a 1280x720 composite no matter the source video, and the
oEmbed endpoint reports the *embed* box — `noembed.com` answers `200x113` for
every id, so the `data.height > data.width` probe that used to live in the
layout could never have fired. An *image* is different: it carries real pixel
dimensions, so an image tile left unlabelled is marked `data-orientation-auto`
and corrected from `naturalWidth/naturalHeight` once decoded.

Unknown include parameters are emitted as `data-unknown-params` and asserted
empty by `tests/led-masonry.spec.js`. This exists because
`{% include video protrait=true %}` — one transposed letter — silently rendered a
portrait video as landscape, and nothing caught it.

**Masonry is built in JS; CSS multi-column is the no-JS fallback.** A grid
cannot do masonry with `aspect-ratio` items: every row grows to its tallest
item, so shorter ones stretch or leave a gap. Multi-column packs correctly but
fills column 1 top-to-bottom before starting column 2, so the authored order
reads *downwards* — item 2 lands under item 1, not beside it, and no CSS
property changes that. So `gallery.js` builds `.gallery__col` elements and walks
the tiles in authored order, appending each to the shortest column (ties go
left); the first row then reads 1, 2, 3, 4 across. It sets `data-masonry="js"`
only once the columns exist, so a script error leaves the `columns:` fallback
alone. `--col-min` is shared by both so they break at the same widths, and each
tile carries `data-order` because the DOM no longer holds authored order.

Note the consequence for tile heights — a landscape tile is `0.5625 x column`,
so a *full-bleed* 9:16 tile would be `3.16x` its height. Portrait tiles are
therefore `--portrait-scale` (1.5) times the landscape height, with the 9:16
poster centred at full tile height over a blurred blow-up of itself. A centred
9:16 crop of a 1280x720 YouTube composite is `405px` wide, which is exactly
where the real vertical frame sits, so plain `object-fit: cover` lands on it —
no crop hackery needed. Those two ratios are also what the placement loop uses
to predict heights, so it never reads back layout.

## Link previews — a build step, not files in the repo (`/led/<slug>/`)

A link pasted into WhatsApp, iMessage, Slack or Discord previews **the item it
points at**. That is the only reason the shareable URL is a path.

A preview is made by a crawler that fetches the URL and reads `og:` tags out of
the HTML. It never runs JavaScript, and GitHub Pages answers every query string
with byte-identical HTML — so `/led/?m=<slug>` can only ever preview as
`/led/`, whatever the page does at runtime. A per-item preview needs a per-item
*path*.

**`scripts/share-pages.mjs` writes those paths at build time, into `_site`.**
Nothing it makes is committed and nothing in the source tree knows it exists:
adding a clip is still one `{% include video %}` line in `led.md`. It reads the
*built* `/led/` page — the tiles already carry `data-slug`, `data-kind` and
`data-caption`, which is what `gallery.js` indexes by too — so there is no
second list to keep in step. For each tile it copies the page, swaps
jekyll-seo-tag's block (which is delimited by `<!-- Begin/End Jekyll SEO tag -->`,
so it is one replaceable unit) for per-item tags, and writes
`_site/led/<slug>/index.html`. The description comes from the page's own first
paragraph; the index gets a preview of its own from the first tile.

**An earlier attempt committed a generated page per item and was reverted** (#3,
#4). It worked, and it cost an edit to a data file plus a generator run plus 18
committed artifacts every time a clip was added. Don't go back to that.

**Why not a Jekyll generator plugin,** which would be the idiomatic answer: the
`github-pages` gem forces safe mode, so `_plugins/` is ignored even in a local
`bundle exec jekyll build`. Verified, not assumed. Dropping that gem would
re-float every pinned version the rest of the site renders with, to buy nothing
the build step cannot do.

**Preview images.** Videos use the poster chain the tile itself carries
(`src` then `data-poster-fallback`), walked until one answers — `maxresdefault`
is missing for plenty of uploads and an `og:image` that 404s renders as no
preview at all. Results are cached in `.jekyll-cache/share/`; offline, the
first is used unprobed with a warning rather than failing the build. Photos
cannot be their own preview (0.8-2.8 MB at 4032px — crawlers skip images that
big), so each is resized to ~1200px into `_site/assets/share/`, using whichever
of `magick`/`convert`/`ffmpeg`/`sips` is present.

**`just serve` deliberately skips the step.** Those pages do not exist under
`jekyll serve`, so the `<meta name="gallery-base">` the step injects is absent
and `gallery.js` falls back to `?m=` rather than linking at 404s. That marker
is what switches the two shapes, which is also why it is injected by the step
and not put in the layout.

## Deep links (`/led/<slug>/`, or `?m=` without the build step)

The slug is the tile's `data-slug` — a video's YouTube id, a photo's filename
stem (`IMG_0328.HEIC.jpg` -> `img-0328`). Not the index: inserting a tile at
the top would silently repoint every link ever shared. `gallery.js` settles
duplicates (Liquid cannot see a tile's siblings) and keeps the authored case,
folding it only to match, so a pasted `/led/Kg0VKvDbvkU/` still reads as the
video it is.

**One `pushState` per opening, `replaceState` per slide.** A carousel that
auto-advances would otherwise bury the page you arrived from under thirteen
entries, and Back has to mean "close the viewer" however far in you walked.
Arriving on a share page, `open()` rewrites that entry to the bare gallery and
pushes the item back on top, so Back means the same thing there as after a
click while a reload still lands on the shared slide. `popstate` treats the URL
as the only truth and never writes history back.

`?m=` is still read and upgraded to the path on arrival — links shared before
the share pages existed don't get a migration. `?v=` and `?item=` are read as
aliases, and a bare 1-based index works for hand-typed links. **An unrecognised
value opens nothing** — silently showing item 1 for a link that asked for
something else is a worse answer than ignoring it.

The tiles' own `href` still points at YouTube / the full-size image, because
with JS off that link is the only thing that works. The share button is what
hands over the share URL (`navigator.share`, else the clipboard).

**A deep link scrolls in.** It starts at the top of the page whatever the
browser restored, travels down to the gallery, and only then opens — a lightbox
materialising over a page the visitor has never seen tells them nothing about
where they are. There is no portable "smooth scroll finished" event
(`scrollend` is absent on Safari), so it watches the position settle, with
`SCROLL_SETTLE_MS` as the backstop; `prefers-reduced-motion` gets a jump.

**Photos take a turn and move on, videos always did.** A video advancing on
ENDED is old behaviour; the cycle used to stop dead at item 9 of 13, the first
photo. `autoCycle` is the rule: set by an auto-advance and by arriving on a
shared link, cleared by any arrow, swipe, tap-zone or thumbnail — so the show
runs itself, and a photo you opened to look at stays put. The dwell is armed
when the photo is actually on screen (or gave up loading), not when the slide
was asked for.

## Testing YouTube

**You cannot verify real YouTube playback from the OCI box.** Embeds there
return error `150`/`153` inconsistently — the same video id flips between
`ready` and `error 150` across runs, from a real `http://127.0.0.1` origin, on
both `youtube.com` and `youtube-nocookie.com` hosts. It's the datacenter IP and
origin, not the code. Don't chase it, and don't conclude a video has embedding
disabled from a local failure.

So the suite **stubs YouTube** (`tests/helpers/youtube.js`): it installs a fake
`window.YT` with the IFrame API surface before page scripts run, and fails any
request that escapes to youtube.com. Its `autoplay-blocked` mode reproduces the
browser autoplay policy — `playVideo()` only reaches PLAYING if the player is
muted (until `unMute()` marks the player activated, the way a real user gesture
does) — which is the rule that made phones show a dead player, and the spec that
drives the muted *fallback* in `gallery.js`.

The lightbox's watchdog matters for exactly this reason: whatever YouTube does,
a slide that isn't playing within 6s stops spinning and offers a link out.

## Player behaviour worth knowing before changing it

**One player, reused across slides** (`loadVideoById`, not destroy/recreate).
This is about sound: an embed the visitor has unmuted keeps that permission for
the life of the player, so a swipe or an auto-advance stays audible. Rebuilding
per slide silently re-mutes everything after the first. The stub models this —
`unMute()` sets `activated`, which is what lifts `autoplay-blocked`.

**Sound is on by default, and the fallback is remembered.** Videos mount
unmuted; if nothing is playing 1.2s later the browser refused, so the player is
muted, restarted, and `sessionStorage` records it — only the first video in a
tab pays that stall. A tap on a muted video turns the sound on rather than
pausing, because a tap is the user gesture that can.

**YouTube's chrome is all-or-nothing.** There is no parameter for "keep the
scrubber, drop the CC button", nothing hides the "Watch on YouTube" link or the
title overlay, and `modestbranding` has been a no-op since 2023. The only real
switch is `YT_CONTROLS` in `gallery.js`: `1` for YouTube's own bar, `0` for no
chrome at all (and then no scrubbing or captions either).

**`.lightbox__gesture` is why swiping works.** An `<iframe>` is a separate
browsing context, so a touch that lands on the player never reaches this
document — the swipe handler simply never fired. That transparent sheet takes
the touch instead. It stops 56px short of the bottom so YouTube's own controls
stay reachable, and it is only present on touch pointers.

**Fullscreen on an iPhone is iOS's video player, not the Fullscreen API.**
There is no Fullscreen API there for any browser (all WKWebView), which is why
our expand button *and* the player's own were both dead — `fs` is set to 0
wherever `document.fullscreenEnabled` is false so YouTube stops drawing one.
Feature-test it; don't sniff the UA, because iPad has the prefixed API.

What does work is what this page used to get for free: a YouTube embed that is
**not** `playsinline` is handed to the iOS system player, scrubber and all.
`playsinline: 1` is what a gallery needs to play on the page at all, and is
exactly what took that away. So expand rebuilds the player with
`playsinline: 0` and `start: <current time>` — the tap is the user gesture, the
video resumes, iOS takes over. `playerInline` tracks that, and the next slide
rebuilds inline, because a player set to go fullscreen cannot autoplay on the
page. For an image there is no player, so expand falls back to `.is-expanded`,
which must have stylesheet rules behind it; at first it didn't, which is why it
looked dead.

Do not "improve" this by rotating the slide 90° to fill an upright phone. It
was tried, it is not fullscreen, and it was not wanted.

**Nav is by tap zone, not just by button.** The outer 30% of the stage either
side pages the carousel wherever the tap lands: over the video, over the
letterbox band, anywhere. The middle is play/pause over the media and close
over the backdrop. It runs on `click` (the browser synthesises one from a tap)
rather than on `touchend`, so a swipe sets `swallowClick` to stop its trailing
click being read as a tap.

## CI

`.github/workflows/pages.yml` builds and publishes the site on every push to
`main`. It replaced GitHub's own Pages builder, which runs Jekyll with no build
step and ignores `_plugins/` — and the site needs one (see the link-previews
section). The trade: the site now updates only if that workflow succeeds, where
before GitHub's builder just worked. It is minimal for that reason — Ruby,
gems, Jekyll, one node script, no browsers, no npm — and it asserts the share
pages actually got written rather than publishing a site that looks fine until
somebody pastes a link.

`.github/workflows/tests.yml` stays `workflow_dispatch` only, on purpose:
installing Chromium and npm deps on every push costs minutes for a gate nothing
waits on, and it must never stand between a push and the site being live. Run
the suite locally with `just test` (or from the Actions tab when you want it).
