/*
 * Gallery masonry + lightbox. Progressive enhancement: with JS off, the
 * stylesheet's multi-column fallback still lays the tiles out and every tile is
 * still a plain link to the video or the full-size image.
 *
 * Why this is hand-rolled rather than Fancybox: the things that were actually
 * broken all live in the player, not the shell —
 *   - open flashed black, because the poster was dropped the moment the iframe
 *     was created instead of being held underneath it;
 *   - the spinner could run forever, because it waited on a "ready" that a
 *     blocked or failed embed never sends;
 *   - nothing played on a phone, because unmuted autoplay is refused there;
 *   - the expand control did nothing on iOS, where only <video> can go
 *     natively fullscreen;
 *   - swiping did nothing, because an <iframe> is a separate browsing context
 *     and the touch never reached this document at all.
 * Each of those is handled explicitly below.
 */
(() => {
  "use strict";

  // YouTube IFrame API error codes, which are otherwise opaque to a visitor.
  const YT_ERRORS = {
    2: "That video link looks wrong.",
    5: "This video can't play in this browser.",
    100: "This video has been removed or made private.",
    101: "The owner doesn't allow this video to be embedded.",
    150: "The owner doesn't allow this video to be embedded.",
  };

  /*
   * YouTube's chrome is all-or-nothing. There is no parameter for "keep the
   * scrubber but drop the CC button", no way to remove the title/share overlay
   * that appears on hover and on pause, and `modestbranding` has been a no-op
   * since 2023 — the only real switch is `controls`:
   *   1  the player draws its own bar: scrubber, CC, settings/quality gear,
   *      the "Watch on YouTube" link bottom-left, title overlay on pause.
   *   0  no bar and no overlays at all; playback is then whatever this file
   *      drives — tap to play/pause, our own sound and nav buttons — with no
   *      scrubbing and no caption or quality menu.
   * Flip this one constant to choose. It is not per-button, and cannot be.
   */
  const YT_CONTROLS = 1;

  const PLAY_RETRY_MUTED_MS = 1200; // unmuted autoplay refused -> retry muted
  const WATCHDOG_MS = 6000; // still not playing -> stop spinning, offer YouTube
  const SWIPE_PX = 40; // horizontal travel that counts as a page turn
  const TAP_PX = 10; // travel under which a touch is a tap, not a drag
  const TAP_ZONE = 0.3; // outer third of the stage, either side: page back/forward
  const LETTERBOX_MIN = 64; // empty band under the slide worth moving nav into
  const PLAYING = 1; // YT.PlayerState.PLAYING, needed before YT has loaded

  const gallery = document.querySelector("[data-gallery], .gallery");
  if (!gallery) return;

  const tiles = [...gallery.querySelectorAll("[data-tile]")];
  if (!tiles.length) return;

  // The DOM stops carrying authored order once the columns below are built,
  // so stamp it on the way past — it is what the lightbox indexes by, and the
  // only way to tell "item 3" from "third in the DOM" when debugging.
  tiles.forEach((tile, i) => { tile.dataset.order = String(i); });

  const isTouch =
    navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;

  /*
   * Not a UA sniff: iPhone (Safari and every other browser there, since they
   * are all WKWebView) reports no Fullscreen API at all, while iPad and desktop
   * Safari report the webkit-prefixed one.
   *
   * This used to also decide whether to let YouTube draw its own fullscreen
   * control, on the theory that if we cannot go fullscreen then neither can the
   * player. That is wrong, and an iPhone proved it: iOS 26.6 / CriOS 142
   * reports fullscreenEnabled false, requestFullscreen and
   * webkitRequestFullscreen both absent — and YouTube's own expand button works
   * anyway. It can, because inside the iframe it calls webkitEnterFullscreen on
   * its own <video>, which is the one thing iOS does allow (the same call takes
   * a plain <video> fullscreen there). We cannot reach into a cross-origin
   * iframe to do that; YouTube can.
   *
   * So this now decides only one thing: whether *our* expand button can work.
   */
  const canNativeFullscreen = !!(
    document.fullscreenEnabled || document.webkitFullscreenEnabled
  );

  /* ------------------------------------------------------------- masonry --- */

  /*
   * The stylesheet's `columns:` fallback packs perfectly but fills column 1 top
   * to bottom before starting column 2, so the authored order reads downwards:
   * with 13 tiles across 4 columns, item 2 lands *under* item 1 rather than
   * beside it. Nothing in CSS can change that — multi-column balances by
   * height, and it is the only CSS layout that flows items at their own height.
   *
   * So build the columns here instead: walk the tiles in authored order and
   * append each to whichever column is currently shortest, ties going left.
   * Item 1..N therefore fill the first row across, and every column still packs
   * to its own height with no gaps and nothing stretched.
   *
   * Heights are computed rather than measured — a tile is either 16:9 or
   * `--portrait-scale` times that — so there is no read-back of layout in the
   * placement loop.
   */
  let columnCount = 0;

  function layoutMasonry() {
    const cs = getComputedStyle(gallery);
    const gap = parseFloat(cs.getPropertyValue("--tile-gap")) || 14;
    const min = parseFloat(cs.getPropertyValue("--col-min")) || 240;
    const scale = parseFloat(cs.getPropertyValue("--portrait-scale")) || 1.5;
    const width = gallery.clientWidth;
    if (!width) return; // display:none, or not laid out yet

    // Matches how `columns: <length>` picks a count, so JS and the fallback
    // break at the same widths.
    const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
    if (cols === columnCount) return;
    columnCount = cols;

    const colWidth = (width - gap * (cols - 1)) / cols;
    const columns = Array.from({ length: cols }, () => {
      const el = document.createElement("div");
      el.className = "gallery__col";
      return el;
    });
    const heights = new Array(cols).fill(0);

    tiles.forEach((tile) => {
      let best = 0;
      // Strictly shorter, so equal columns fill left to right.
      for (let i = 1; i < cols; i++) if (heights[i] < heights[best] - 0.5) best = i;
      columns[best].appendChild(tile);
      const ratio = tile.dataset.orientation === "portrait" ? (9 / 16) * scale : 9 / 16;
      heights[best] += colWidth * ratio + gap;
    });

    gallery.replaceChildren(...columns);
    gallery.dataset.masonry = "js";
  }

  const relayout = () => { columnCount = 0; layoutMasonry(); };

  layoutMasonry();
  if (window.ResizeObserver) new ResizeObserver(() => layoutMasonry()).observe(gallery);
  else window.addEventListener("resize", layoutMasonry);

  /* -------------------------------------------------------------- sound --- */

  /*
   * Sound is on by default. Whether it actually starts that way is the
   * browser's call, not ours: an autoplaying embed is only allowed audio once
   * the origin has enough media engagement, and on iOS effectively never
   * without a gesture aimed at the player. So try unmuted, notice within
   * PLAY_RETRY_MUTED_MS if nothing started, and fall back to muted with the
   * sound button showing — rather than starting muted on every touch device
   * the way this used to.
   *
   * `mustStartMuted` remembers that this tab's browser refused, so only the
   * first video pays the retry. It is cleared the moment a real gesture turns
   * the sound on, because from then on the *same player instance* keeps its
   * unmuted permission across loadVideoById — which is why the player below is
   * reused rather than rebuilt per slide.
   */
  const SOUND_PREF = "led-gallery:sound";
  const MUTED_FALLBACK = "led-gallery:autoplay-needs-mute";

  const readPref = (store, key, dflt) => {
    try { return window[store].getItem(key) ?? dflt; } catch { return dflt; }
  };
  const writePref = (store, key, value) => {
    try { window[store].setItem(key, value); } catch { /* private mode */ }
  };

  let soundWanted = readPref("localStorage", SOUND_PREF, "1") !== "0";
  let mustStartMuted = readPref("sessionStorage", MUTED_FALLBACK, "0") === "1";
  const startMuted = () => mustStartMuted || !soundWanted;

  function rememberMuteFallback(needed) {
    mustStartMuted = needed;
    writePref("sessionStorage", MUTED_FALLBACK, needed ? "1" : "0");
  }

  /* ------------------------------------------------------------- shell --- */

  // Read lazily rather than snapshotting: an image tile's orientation is
  // corrected from its real pixel dimensions once it decodes (see below), and a
  // poster may have fallen back to a lower-res URL by the time it is opened.
  const describe = (el) => {
    const media = el.querySelector("[data-media]");
    return {
      el,
      kind: el.dataset.kind,
      youtube: el.dataset.yt || "",
      href: el.getAttribute("href"),
      poster: media?.currentSrc || media?.src || "",
      aspect: (el.dataset.aspect || "16:9").replace(":", " / "),
      caption: el.dataset.caption || media?.alt || "",
    };
  };

  const icon = (d) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  const ICONS = {
    close: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
    prev: icon('<path d="m15 18-6-6 6-6"/>'),
    next: icon('<path d="m9 18 6-6-6-6"/>'),
    expand: icon('<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3m0 6v3a2 2 0 0 1-2 2h-3m-5 0H5a2 2 0 0 1-2-2v-3"/>'),
    thumbs: icon('<rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>'),
    sound: icon('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
  };

  const root = document.createElement("div");
  root.className = "lightbox";
  root.setAttribute("data-lightbox", "");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Media viewer");
  root.classList.toggle("is-touch", isTouch);
  root.hidden = true;
  root.innerHTML = `
    <div class="lightbox__stage" data-stage>
      <div class="lightbox__slide" data-slide data-state="loading">
        <img class="lightbox__poster" data-poster alt="">
        <div class="lightbox__player" data-player><div data-mount></div></div>
        <div class="lightbox__gesture" data-gesture aria-hidden="true"></div>
        <div class="lightbox__spinner" data-spinner></div>
        <div class="lightbox__fallback" data-fallback>
          <p class="lightbox__note" data-fallback-note></p>
          <a data-fallback-link target="_blank" rel="noopener">Watch on YouTube</a>
        </div>
      </div>
      <button class="lightbox__btn lightbox__nav" data-action="prev" data-nav aria-label="Previous">${ICONS.prev}</button>
      <button class="lightbox__btn lightbox__nav" data-action="next" data-nav aria-label="Next">${ICONS.next}</button>
      <div class="lightbox__bar">
        <button class="lightbox__btn" data-action="close" aria-label="Close">${ICONS.close}</button>
        <span class="lightbox__counter" data-counter></span>
        <span class="lightbox__spacer"></span>
        <button class="lightbox__btn" data-action="unmute" aria-label="Turn sound on" hidden>${ICONS.sound}</button>
        <button class="lightbox__btn" data-action="thumbs" aria-label="Toggle thumbnails" aria-pressed="true">${ICONS.thumbs}</button>
        <button class="lightbox__btn" data-action="fullscreen" aria-label="Expand to fullscreen" aria-pressed="false">${ICONS.expand}</button>
      </div>
      <p class="lightbox__caption" data-caption></p>
    </div>
    <div class="lightbox__rail" data-rail role="tablist" aria-label="Gallery thumbnails"></div>`;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const stage = $("[data-stage]");
  const slide = $("[data-slide]");
  const poster = $("[data-poster]");
  const playerBox = $("[data-player]");
  const fallbackLink = $("[data-fallback-link]");
  const counter = $("[data-counter]");
  const caption = $("[data-caption]");
  const unmuteBtn = $('[data-action="unmute"]');
  const thumbsBtn = $('[data-action="thumbs"]');
  const fsBtn = $('[data-action="fullscreen"]');
  /*
   * Kept on iPhone rather than hidden. Two routes to real fullscreen are
   * available there and both are confirmed on device, so the gallery offers
   * both: YouTube's own control (one tap, playback uninterrupted) and this
   * button, which rebuilds the embed without playsinline (see goNative) and
   * costs the autoplay. Ours is the toolbar, theirs is the player bar, so they
   * do not sit on top of each other.
   */
  const fallbackNote = $("[data-fallback-note]");
  const rail = $("[data-rail]");

  /*
   * The thumbnail rail. Fancybox showed one by default and the first pass of
   * this rewrite quietly dropped it; with 13 items it is the only way to see
   * where you are in the set without stepping through.
   */
  const RAIL_PREF = "led-gallery:thumbs";
  tiles.forEach((tile, i) => {
    const media = tile.querySelector("[data-media]");
    const btn = document.createElement("button");
    btn.className = "lightbox__thumb";
    btn.type = "button";
    btn.dataset.thumb = "";
    btn.dataset.index = String(i);
    btn.style.setProperty("--thumb-aspect", (tile.dataset.aspect || "16:9").replace(":", " / "));
    btn.setAttribute("aria-label", tile.dataset.caption || `Item ${i + 1}`);
    const img = document.createElement("img");
    img.src = media?.currentSrc || media?.src || "";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    btn.appendChild(img);
    rail.appendChild(btn);
  });
  const thumbs = [...rail.querySelectorAll("[data-thumb]")];

  function setRailVisible(visible) {
    rail.hidden = !visible;
    thumbsBtn.setAttribute("aria-pressed", String(visible));
    writePref("localStorage", RAIL_PREF, visible ? "1" : "0");
  }
  setRailVisible(readPref("localStorage", RAIL_PREF, "1") !== "0");

  let index = -1;
  let generation = 0; // bumped per slide, so a slow API resolve can't mount late
  let player = null;
  let ready = false;
  let opener = null;
  let timers = [];
  let playerInline = true; // false once expand has handed it to iOS's player
  let swallowClick = false; // a swipe's trailing click is not a tap

  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const setState = (s) => slide.setAttribute("data-state", s);
  const state = () => slide.getAttribute("data-state");

  function teardownPlayer() {
    clearTimers();
    ready = false;
    if (player) {
      try { player.destroy(); } catch { /* already gone */ }
      player = null;
    }
    // destroy() removes the iframe, so put the mount point back.
    playerBox.innerHTML = "<div data-mount></div>";
    unmuteBtn.hidden = true;
  }

  /* ------------------------------------------------------- YouTube API --- */

  let apiPromise = null;
  function youtubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const prior = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prior?.(); resolve(window.YT); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = () => reject(new Error("iframe_api blocked"));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error("iframe_api timed out")), WATCHDOG_MS);
    });
    return apiPromise;
  }

  /*
   * Two timers per video, both cancelled by the first PLAYING:
   *   - the browser refused unmuted autoplay, so retry muted and remember it;
   *   - it is simply not coming, so stop spinning and offer the link out.
   */
  function armWatchdogs(mine) {
    later(() => {
      // `ready` gates this: a player that never handshook cannot be told to do
      // anything, and poking playVideo() at one would only paper over the stall
      // the second timer is there to report.
      if (mine !== generation || state() === "playing" || !ready || !player) return;
      try {
        if (!player.isMuted()) {
          rememberMuteFallback(true);
          player.mute();
          player.playVideo();
          syncMuteButton();
        }
      } catch { /* player went away */ }
    }, PLAY_RETRY_MUTED_MS);

    later(() => {
      if (mine !== generation || state() === "playing") return;
      fallbackNote.textContent = "This is taking longer than it should.";
      setState("stalled");
    }, WATCHDOG_MS);
  }

  function createPlayer(YT, item, mine, overrides = {}) {
    playerInline = overrides.playsinline !== 0;
    player = new YT.Player($("[data-mount]"), {
      videoId: item.youtube,
      host: "https://www.youtube-nocookie.com",
      playerVars: {
        autoplay: 1,
        /*
         * 1 keeps playback on the page, which is what a gallery needs — and is
         * also precisely what stops iOS handing the video to its own fullscreen
         * player. The expand button flips it to 0 on demand; see goNative().
         */
        playsinline: 1,
        rel: 0,
        controls: YT_CONTROLS,
        // Always 1. Where we have the Fullscreen API the player's button uses
        // it; where we do not (iPhone) it is the *only* route to real
        // fullscreen, so suppressing it was removing the one thing that worked.
        fs: 1,
        iv_load_policy: 3, // no annotation cards over the video
        modestbranding: 1,
        enablejsapi: 1,
        mute: startMuted() ? 1 : 0,
        origin: location.origin,
        ...overrides,
      },
      events: {
        onReady: ({ target }) => {
          ready = true;
          if (startMuted()) target.mute();
          syncMuteButton();
          target.playVideo();
        },
        onStateChange: ({ data }) => {
          if (data === YT.PlayerState.PLAYING) {
            clearTimers();
            setState("playing");
            syncMuteButton();
          } else if (data === YT.PlayerState.ENDED) {
            advance();
          }
        },
        onError: ({ data }) => {
          clearTimers();
          fallbackNote.textContent = YT_ERRORS[data] || "This video failed to load.";
          setState("error");
        },
      },
    });
    armWatchdogs(mine);
  }

  /*
   * Reuse the player across slides rather than destroying and rebuilding it.
   * Two reasons, both about sound: a player the visitor has unmuted keeps that
   * permission through loadVideoById, so the rest of the gallery plays audible
   * and an auto-advance does not silently re-mute; and there is no iframe
   * teardown/handshake between slides.
   */
  function mountVideo(item) {
    const mine = generation;
    youtubeApi().then(
      (YT) => {
        if (mine !== generation) return; // swiped on, or closed, while it loaded
        // A player left in iOS's fullscreen mode (playsinline: 0) cannot
        // autoplay inline, so it is rebuilt rather than reused.
        if (player && !playerInline) teardownPlayer();
        if (player?.loadVideoById) {
          try {
            player.loadVideoById(item.youtube);
            syncMuteButton();
            armWatchdogs(mine);
            return;
          } catch { teardownPlayer(); } // wedged — fall through to a fresh one
        }
        createPlayer(YT, item, mine);
      },
      () => {
        if (mine !== generation) return;
        fallbackNote.textContent = "Couldn't reach YouTube.";
        setState("stalled");
      },
    );
  }

  function syncMuteButton() {
    let muted = false;
    try { muted = !!player?.isMuted?.(); } catch { muted = false; }
    unmuteBtn.hidden = !muted;
  }

  function playerState() {
    try { return player?.getPlayerState?.() ?? -1; } catch { return -1; }
  }

  /* ------------------------------------------------------------- slides --- */

  function show(i) {
    index = (i + tiles.length) % tiles.length;
    const item = describe(tiles[index]);
    generation += 1;
    clearTimers();

    slide.style.setProperty("--aspect", item.aspect);
    slide.dataset.index = String(index);
    slide.dataset.kind = item.kind;
    setState("loading");

    // Painted immediately from cache, and kept underneath the player for the
    // whole load — this is what removes the black flash.
    poster.src = item.kind === "image" ? item.href : item.poster;
    poster.alt = item.caption;

    caption.textContent = item.caption;
    counter.textContent = `${index + 1} / ${tiles.length}`;
    thumbs.forEach((t, n) => {
      if (n === index) t.setAttribute("aria-current", "true");
      else t.removeAttribute("aria-current");
    });
    thumbs[index]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    fallbackNote.textContent = "";
    fallbackLink.href = item.href;
    fallbackLink.textContent = item.kind === "image" ? "Open image" : "Watch on YouTube";

    if (item.kind === "image") {
      // Hold the player rather than destroying it — see mountVideo.
      try { player?.pauseVideo?.(); } catch { /* fine */ }
      unmuteBtn.hidden = true;
      // Size the slide from the file's own dimensions — no build-time guess.
      const sized = () => {
        if (poster.naturalWidth && poster.naturalHeight) {
          slide.style.setProperty("--aspect", `${poster.naturalWidth} / ${poster.naturalHeight}`);
        }
        setState("playing");
        positionNav();
      };
      if (poster.complete) sized();
      else poster.addEventListener("load", sized, { once: true });
      later(() => { if (state() === "loading") setState("stalled"); }, WATCHDOG_MS);
      positionNav();
      return;
    }
    mountVideo(item);
    positionNav();
  }

  const go = (delta) => show(index + delta);

  // A finished video rolls into the next item, and the last wraps to the first
  // (show() takes the index modulo the set).
  function advance() {
    if (root.hidden || slide.dataset.kind !== "video") return;
    go(1);
  }

  function open(i) {
    opener = tiles[i] ?? null;
    root.hidden = false;
    document.body.classList.add("lightbox-open");
    show(i);
    $('[data-action="close"]').focus({ preventScroll: true });
  }

  function close() {
    teardownPlayer();
    setState("closed");
    root.hidden = true;
    document.body.classList.remove("lightbox-open");
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    root.classList.remove("is-expanded");
    syncExpanded();
    opener?.focus({ preventScroll: true });
    opener = null;
  }

  /* ----------------------------------------------------------- chrome --- */

  /*
   * Put the arrows in the empty band under the slide whenever there is one —
   * a 16:9 video on a portrait phone letterboxes hard, and that band is free
   * real estate. Only when the media fills the stage (a 9:16 video, say) do
   * they sit on the picture, at the very edges and half-faded.
   */
  function positionNav() {
    if (root.hidden) return;
    const sb = stage.getBoundingClientRect();
    const lb = slide.getBoundingClientRect();
    const band = sb.bottom - lb.bottom;
    const letterboxed = band >= LETTERBOX_MIN;
    root.classList.toggle("is-letterboxed", letterboxed);
    root.style.setProperty(
      "--nav-top",
      letterboxed ? `${lb.bottom - sb.top + band / 2}px` : "50%",
    );
  }

  function syncExpanded() {
    const on =
      !!(document.fullscreenElement || document.webkitFullscreenElement) ||
      root.classList.contains("is-expanded");
    fsBtn.setAttribute("aria-pressed", String(on));
    fsBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Expand to fullscreen");
  }

  /*
   * Real fullscreen on an iPhone, which no amount of DOM fullscreen can give
   * you: there is no Fullscreen API there for any browser (all WKWebView), so
   * neither our button nor the player's own could ever have worked through it.
   *
   * What *does* work — and what this page used to get for free — is iOS's own
   * video player. A YouTube embed is handed to it whenever the video is not
   * playsinline, complete with the system scrubber, AirPlay and the rest. We
   * pass playsinline: 1 so the gallery can play on the page at all, which is
   * exactly what took that away. So on expand, rebuild the player with
   * playsinline: 0 from the current position: the tap is a user gesture, the
   * video resumes, and iOS takes it fullscreen.
   *
   * The player is left in that mode until the next slide, which rebuilds it
   * inline (see mountVideo) — it cannot autoplay on the page while it is set
   * to go fullscreen.
   */
  function goNative() {
    if (canNativeFullscreen) return false;
    if (slide.dataset.kind !== "video" || !window.YT?.Player || !player) return false;

    let at = 0;
    try { at = Math.max(0, Math.floor(player.getCurrentTime?.() || 0)); } catch { at = 0; }

    // This is a gesture, so the rebuilt player may have sound even if the
    // autoplayed one was refused it.
    rememberMuteFallback(false);

    const item = describe(tiles[index]);
    generation += 1;
    const mine = generation;
    teardownPlayer();
    setState("loading");
    createPlayer(window.YT, item, mine, { playsinline: 0, start: at });
    return true;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      syncExpanded();
      return;
    }
    const native = root.requestFullscreen || root.webkitRequestFullscreen;
    if (native) {
      const r = native.call(root);
      // Present on Element but rejecting is the iPad/desktop-Safari shape.
      if (r?.catch) r.catch(() => { root.classList.add("is-expanded"); syncExpanded(); });
      syncExpanded();
      return;
    }
    if (goNative()) return;
    // An image, or no player yet: all that is left is giving it the chrome's
    // space. The class must have stylesheet rules behind it — it didn't once,
    // which is why this looked dead.
    root.classList.toggle("is-expanded");
    syncExpanded();
  }

  document.addEventListener("fullscreenchange", () => { syncExpanded(); positionNav(); });

  /* ------------------------------------------------------------- events --- */

  tiles.forEach((el, i) =>
    el.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let it open a tab
      e.preventDefault();
      open(i);
    }),
  );

  function turnSoundOn() {
    soundWanted = true;
    writePref("localStorage", SOUND_PREF, "1");
    rememberMuteFallback(false);
    try { player?.unMute(); player?.playVideo(); } catch { /* ignore */ }
    syncMuteButton();
  }

  /*
   * A tap in the middle of the media. If it is muted only because autoplay
   * forced it, this tap is the user gesture that can lift that — take the sound
   * off mute rather than pausing. Otherwise it is play/pause, the thing a tap
   * on a video means.
   */
  function tapCentre() {
    if (slide.dataset.kind !== "video" || !player) return;
    let muted = false;
    try { muted = !!player.isMuted?.(); } catch { muted = false; }
    if (muted && soundWanted) return turnSoundOn();
    try {
      if (playerState() === PLAYING) player.pauseVideo();
      else player.playVideo();
    } catch { /* ignore */ }
  }

  root.addEventListener("click", (e) => {
    if (swallowClick) { swallowClick = false; return; } // tail of a swipe
    if (e.target.closest("a[href]")) return; // the fallback link out

    const thumb = e.target.closest("[data-thumb]");
    if (thumb) return show(Number(thumb.dataset.index));

    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "close") return close();
    if (action === "prev") return go(-1);
    if (action === "next") return go(1);
    if (action === "fullscreen") return toggleFullscreen();
    if (action === "thumbs") { setRailVisible(rail.hidden); return positionNav(); }
    if (action === "unmute") return turnSoundOn();

    /*
     * Tap zones, on touch only. The outer third either side pages the carousel
     * wherever it lands — over the video, over the letterbox band, over the
     * arrows' own corner of the screen — so paging never depends on finding a
     * 48px button. The middle third is play/pause over the media, and close
     * over the backdrop, which is what a tap there meant before.
     */
    if (isTouch) {
      const r = stage.getBoundingClientRect();
      const inStage =
        e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom;
      if (inStage) {
        const x = (e.clientX - r.left) / r.width;
        if (x < TAP_ZONE) return go(-1);
        if (x > 1 - TAP_ZONE) return go(1);
        if (e.target.closest("[data-gesture]")) return tapCentre();
      }
    }

    // Backdrop only: a tap on the media itself belongs to the player.
    if (e.target === stage || e.target === root) close();
  });

  document.addEventListener("keydown", (e) => {
    if (root.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key === "Tab") {
      const focusable = [...root.querySelectorAll("button:not([hidden]), a[href]")];
      if (!focusable.length) return;
      const edge = e.shiftKey ? focusable[0] : focusable.at(-1);
      if (document.activeElement === edge) { e.preventDefault(); (e.shiftKey ? focusable.at(-1) : focusable[0]).focus(); }
    }
  });

  /*
   * Swipe. The listener is on the stage, but the touches only get here because
   * of .lightbox__gesture — the sheet over the player. Without it a drag that
   * starts on the video is consumed by the iframe's own document and this
   * handler never runs, which is why swiping did nothing before.
   */
  let swipe = null;
  const touchPoint = (e) => e.changedTouches?.[0] || e.touches?.[0] || null;
  stage.addEventListener("touchstart", (e) => {
    const p = touchPoint(e);
    swipe = p ? { x: p.clientX, y: p.clientY, onMedia: !!e.target.closest("[data-gesture]") } : null;
  }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (!swipe) return;
    const p = touchPoint(e);
    const dx = (p?.clientX ?? swipe.x) - swipe.x;
    const dy = (p?.clientY ?? swipe.y) - swipe.y;
    const { onMedia } = swipe;
    swipe = null;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 400);
      return go(dx < 0 ? 1 : -1);
    }
    // A tap is handled on the click that follows it, where the
    // co-ordinates decide between paging and play/pause.
  }, { passive: true });

  // Anything that changes the slide's box — rail toggled, an image resolving
  // its real aspect, the phone turned — moves the arrows with it.
  if (window.ResizeObserver) new ResizeObserver(() => positionNav()).observe(slide);
  window.addEventListener("resize", positionNav);
  window.addEventListener("orientationchange", positionNav);

  /*
   * An image carries its own dimensions, so a tile the author did not label can
   * be corrected once it decodes. A YouTube poster cannot: it is always a
   * 1280x720 composite, which is why video orientation has to be declared.
   */
  gallery.querySelectorAll("[data-tile][data-orientation-auto] [data-media]").forEach((img) => {
    const apply = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (!w || !h || h <= w) return;
      const tile = img.closest("[data-tile]");
      tile.dataset.orientation = "portrait";
      tile.dataset.aspect = `${w}:${h}`;
      relayout(); // its height estimate just changed, so repack the columns
    };
    if (img.complete) apply();
    else img.addEventListener("load", apply, { once: true });
  });

  // YouTube posters: maxresdefault is missing for some uploads, so step down.
  gallery.querySelectorAll("[data-media][data-poster-fallback]").forEach((img) => {
    const chain = img.dataset.posterFallback.split("|");
    img.addEventListener("error", () => {
      const next = chain.shift();
      if (next) { img.dataset.posterFallback = chain.join("|"); img.src = next; }
    });
  });
})();
