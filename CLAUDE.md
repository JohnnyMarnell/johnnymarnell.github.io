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

**Masonry is CSS multi-column, not grid.** A grid cannot do masonry with
`aspect-ratio` items: every row grows to its tallest item, so shorter ones
stretch or leave a gap. Note the consequence for tile heights — a landscape tile
is `0.5625 x column`, so a *full-bleed* 9:16 tile would be `3.16x` its height.
Portrait tiles are therefore `--portrait-scale` (1.5) times the landscape
height, with the 9:16 poster centred at full tile height over a blurred blow-up
of itself. A centred 9:16 crop of a 1280x720 YouTube composite is `405px` wide,
which is exactly where the real vertical frame sits, so plain
`object-fit: cover` lands on it — no crop hackery needed.

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
muted — which is the rule that made phones show a dead player, and the spec that
drove the muted-start behaviour in `gallery.js`.

The lightbox's watchdog matters for exactly this reason: whatever YouTube does,
a slide that isn't playing within 6s stops spinning and offers a link out.
