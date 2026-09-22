# CLAUDE.md

Jekyll site for johnnymarnell.github.io, served by GitHub Pages from `main`.

## Commands

```bash
just install       # bundle install (Ruby gems -> vendor/bundle)
just serve         # jekyll serve --livereload on :4000
just build         # jekyll build -> _site/
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

**There is no fullscreen on an iPhone, for anyone.** Every browser there is
WKWebView, and none of them exposes the Fullscreen API — not to us, and not to
the YouTube player inside the iframe, whose own fullscreen button is therefore
dead too (`fs` is set to 0 wherever `document.fullscreenEnabled` is false, so
it isn't drawn). Feature-test it; don't sniff the UA, because iPad *does* have
the webkit-prefixed API. `toggleFullscreen()` falls back to `.is-expanded`,
which must have stylesheet rules behind it; at first it didn't, which is why
the button looked dead, and then it only hid the rail — on a phone the lightbox
already covers the viewport, so that is not what anyone tapped for. It now also
adds `.is-rotated` for landscape media on an upright screen, turning the slide
90° so a 16:9 video goes from 390x219 to 390x693. The `--aspect` sizing formula
is reused with the container's axes swapped, so nothing is stretched.

*If true iOS fullscreen ever matters more than the inline gallery:* dropping
`playsinline` makes iOS hijack playback into its own fullscreen player. That is
almost certainly what the pre-rewrite page did, and it is incompatible with a
swipeable lightbox — every video would leave the page to play.

**Nav is by tap zone, not just by button.** The outer 30% of the stage either
side pages the carousel wherever the tap lands: over the video, over the
letterbox band, anywhere. The middle is play/pause over the media and close
over the backdrop. It runs on `click` (the browser synthesises one from a tap)
rather than on `touchend`, so a swipe sets `swallowClick` to stop its trailing
click being read as a tap.

## CI

`.github/workflows/tests.yml` is `workflow_dispatch` only, on purpose. GitHub
Pages publishes from `main` on its own, and installing Ruby, Node, gems, npm
deps and Chromium on every push cost minutes for a gate nothing waits on. Run
the suite locally with `just test` (or from the Actions tab when you want it).
