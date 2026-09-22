/*
 * Gallery lightbox. Progressive enhancement: with JS off, every tile is still
 * a plain link to the video or the full-size image.
 *
 * Why this is hand-rolled rather than Fancybox: the four things that were
 * actually broken all live in the player, not the shell —
 *   - open flashed black, because the poster was dropped the moment the iframe
 *     was created instead of being held underneath it;
 *   - the spinner could run forever, because it waited on a "ready" that a
 *     blocked or failed embed never sends;
 *   - nothing played on a phone, because unmuted autoplay is refused there;
 *   - the expand control did nothing on iOS, where only <video> can go
 *     natively fullscreen.
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

  const PLAY_RETRY_MUTED_MS = 2000; // unmuted autoplay refused -> retry muted
  const WATCHDOG_MS = 6000; // still not playing -> stop spinning, offer YouTube
  const SWIPE_PX = 40;

  const gallery = document.querySelector("[data-gallery], .gallery");
  if (!gallery) return;

  const tiles = [...gallery.querySelectorAll("[data-tile]")];
  if (!tiles.length) return;

  // Phones refuse autoplay with sound, so start muted there and hand the sound
  // back with a button. Desktop has no such rule and starts audible.
  const prefersMuted =
    navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;

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
    sound: icon('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
  };

  const root = document.createElement("div");
  root.className = "lightbox";
  root.setAttribute("data-lightbox", "");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Media viewer");
  root.hidden = true;
  root.innerHTML = `
    <div class="lightbox__stage" data-stage>
      <div class="lightbox__slide" data-slide data-state="loading">
        <img class="lightbox__poster" data-poster alt="">
        <div class="lightbox__player" data-player><div data-mount></div></div>
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
        <button class="lightbox__btn" data-action="fullscreen" aria-label="Expand to fullscreen">${ICONS.expand}</button>
      </div>
      <p class="lightbox__caption" data-caption></p>
    </div>`;
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
  const fallbackNote = $("[data-fallback-note]");

  let index = -1;
  let generation = 0; // bumped per slide, so a slow API resolve can't mount late
  let player = null;
  let ready = false;
  let opener = null;
  let timers = [];

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

  function mountVideo(item) {
    const mine = generation;
    youtubeApi().then(
      (YT) => {
        // The visitor may have swiped on, or closed, while the API loaded.
        if (mine !== generation) return;
        player = new YT.Player($("[data-mount]"), {
          videoId: item.youtube,
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            autoplay: 1,
            playsinline: 1, // without this iOS hijacks into its own fullscreen
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            mute: prefersMuted ? 1 : 0,
            origin: location.origin,
          },
          events: {
            onReady: ({ target }) => {
              ready = true;
              if (prefersMuted) target.mute();
              syncMuteButton();
              target.playVideo();
            },
            onStateChange: ({ data }) => {
              if (data === YT.PlayerState.PLAYING) {
                clearTimers();
                setState("playing");
                syncMuteButton();
              }
            },
            onError: ({ data }) => {
              clearTimers();
              fallbackNote.textContent = YT_ERRORS[data] || "This video failed to load.";
              setState("error");
            },
          },
        });

        // Safety net for desktop, where a browser may still refuse sound.
        later(() => {
          if (state() === "playing" || !ready || !player) return;
          try {
            if (!player.isMuted()) { player.mute(); player.playVideo(); syncMuteButton(); }
          } catch { /* player went away */ }
        }, PLAY_RETRY_MUTED_MS);

        // The spinner is never allowed to outlive this.
        later(() => {
          if (state() === "playing") return;
          fallbackNote.textContent = "This is taking longer than it should.";
          setState("stalled");
        }, WATCHDOG_MS);
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

  /* ------------------------------------------------------------- slides --- */

  function show(i) {
    index = (i + tiles.length) % tiles.length;
    const item = describe(tiles[index]);
    generation += 1;
    teardownPlayer();

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
    fallbackNote.textContent = "";
    fallbackLink.href = item.href;
    fallbackLink.textContent = item.kind === "image" ? "Open image" : "Watch on YouTube";

    if (item.kind === "image") {
      // Size the slide from the file's own dimensions — no build-time guess.
      const sized = () => {
        if (poster.naturalWidth && poster.naturalHeight) {
          slide.style.setProperty("--aspect", `${poster.naturalWidth} / ${poster.naturalHeight}`);
        }
        setState("playing");
      };
      if (poster.complete) sized();
      else poster.addEventListener("load", sized, { once: true });
      later(() => { if (state() === "loading") setState("stalled"); }, WATCHDOG_MS);
      return;
    }
    mountVideo(item);
  }

  const go = (delta) => show(index + delta);

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
    opener?.focus({ preventScroll: true });
    opener = null;
  }

  /* --------------------------------------------------------- fullscreen --- */

  function toggleFullscreen() {
    const native = root.requestFullscreen || root.webkitRequestFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      return;
    }
    if (native) {
      const r = native.call(root);
      // iOS Safari has the method on Element but rejects for non-<video>.
      if (r?.catch) r.catch(() => root.classList.toggle("is-expanded"));
      return;
    }
    root.classList.toggle("is-expanded");
  }

  /* ------------------------------------------------------------- events --- */

  tiles.forEach((el, i) =>
    el.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let it open a tab
      e.preventDefault();
      open(i);
    }),
  );

  root.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "close") return close();
    if (action === "prev") return go(-1);
    if (action === "next") return go(1);
    if (action === "fullscreen") return toggleFullscreen();
    if (action === "unmute") {
      try { player?.unMute(); player?.playVideo(); } catch { /* ignore */ }
      syncMuteButton();
      return;
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

  let swipeX = null;
  const touchPoint = (e) => e.changedTouches?.[0] || e.touches?.[0] || null;
  stage.addEventListener("touchstart", (e) => { swipeX = touchPoint(e)?.clientX ?? null; }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (swipeX === null) return;
    const dx = (touchPoint(e)?.clientX ?? swipeX) - swipeX;
    swipeX = null;
    if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1);
  }, { passive: true });

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
