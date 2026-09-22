/**
 * Stubs YouTube so the lightbox's state machine is testable.
 *
 * Real YouTube can't run here at all — an embed loaded from a test origin
 * answers "Error 153, video player configuration error" — and even where it
 * loads, asserting on someone else's player is flake. So we install a fake
 * `window.YT` with the same surface as the IFrame API before the page's own
 * script runs, and record every call on `window.__yt`.
 *
 * The important part: `playVideo()` mimics the *browser autoplay policy* —
 * under mode "autoplay-blocked" it only reaches PLAYING if the player is
 * muted. That is exactly what phones do, and what the old page never handled.
 */

const MODES = ["normal", "autoplay-blocked", "never-ready", "error"];

async function stubYouTube(page, { mode = "normal" } = {}) {
  if (!MODES.includes(mode)) throw new Error(`unknown stub mode: ${mode}`);

  // Nothing should reach youtube.com. Fail loudly if it does, rather than
  // silently letting a test pass against the network.
  await page.route(/(?:youtube|ytimg|youtube-nocookie)\.com/, async (route) => {
    const url = route.request().url();
    if (/\/(?:embed|iframe_api)/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: /iframe_api/.test(url) ? "text/javascript" : "text/html",
        body: /iframe_api/.test(url)
          ? "window.__ytApiScriptLoaded = true; if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();"
          : "<!doctype html><title>stub player</title><body style='margin:0;background:#123'>",
      });
    }
    // Thumbnails: 1x1 gif, so tiles have a decoded image without the network.
    return route.fulfill({
      status: 200,
      contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
    });
  });

  await page.addInitScript((mode) => {
    const UNSTARTED = -1, ENDED = 0, PLAYING = 1, PAUSED = 2;
    window.__yt = { calls: [], players: [], mode };

    class FakePlayer {
      constructor(el, opts = {}) {
        this.opts = opts;
        this.muted = String(opts.playerVars?.mute) === "1";
        // A browser lifts its autoplay block once the visitor acts on the
        // player. unMute() is only ever called from a tap or a click in
        // gallery.js, so it stands in for that user activation here.
        this.activated = false;
        this.state = UNSTARTED;
        const host = (opts.host || "https://www.youtube.com").replace(/\/$/, "");
        const qs = new URLSearchParams(opts.playerVars || {}).toString();
        this.iframe = document.createElement("iframe");
        this.iframe.src = `${host}/embed/${opts.videoId}?${qs}`;
        this.iframe.setAttribute("allow", "autoplay; encrypted-media; fullscreen");
        this.iframe.setAttribute("allowfullscreen", "");
        this.iframe.style.cssText = "width:100%;height:100%;border:0;display:block";
        const node = typeof el === "string" ? document.getElementById(el) : el;
        node.replaceWith(this.iframe);
        window.__yt.players.push(this);
        window.__yt.calls.push({ fn: "construct", videoId: opts.videoId, muted: this.muted });

        if (mode === "never-ready") return;
        setTimeout(() => {
          if (mode === "error") return opts.events?.onError?.({ target: this, data: 2 });
          opts.events?.onReady?.({ target: this });
        }, 10);
      }
      #emit() { this.opts.events?.onStateChange?.({ target: this, data: this.state }); }
      playVideo() {
        window.__yt.calls.push({ fn: "playVideo", muted: this.muted });
        // The policy: unmuted autoplay is refused on mobile, until the
        // visitor has interacted with this player.
        if (mode === "autoplay-blocked" && !this.muted && !this.activated) return;
        this.state = PLAYING;
        setTimeout(() => this.#emit(), 10);
      }
      pauseVideo() { window.__yt.calls.push({ fn: "pauseVideo" }); this.state = PAUSED; this.#emit(); }
      /*
       * The real API swaps the video in place and keeps the player — including
       * whether the visitor has unmuted it. gallery.js relies on that, so the
       * stub has to model it rather than pretending each slide is a new player.
       */
      loadVideoById(id) {
        window.__yt.calls.push({ fn: "loadVideoById", videoId: id, muted: this.muted });
        this.opts.videoId = id;
        this.state = UNSTARTED;
        if (mode === "error") return this.opts.events?.onError?.({ target: this, data: 2 });
        if (mode === "never-ready") return;
        this.playVideo();
      }
      // Test hook: there is no way to reach the end of a stub video otherwise.
      __end() { this.state = ENDED; this.#emit(); }
      mute() { window.__yt.calls.push({ fn: "mute" }); this.muted = true; }
      unMute() { window.__yt.calls.push({ fn: "unMute" }); this.muted = false; this.activated = true; }
      isMuted() { return this.muted; }
      getPlayerState() { return this.state; }
      getIframe() { return this.iframe; }
      destroy() { window.__yt.calls.push({ fn: "destroy" }); this.iframe.remove(); }
    }

    window.YT = { Player: FakePlayer, PlayerState: { UNSTARTED, PLAYING, PAUSED, ENDED, BUFFERING: 3, CUED: 5 } };
  }, mode);
}

const ytCalls = (page) => page.evaluate(() => window.__yt?.calls ?? []);

// Drive the live player to its end, the way a video finishing would.
const endCurrentVideo = (page) =>
  page.evaluate(() => {
    const p = window.__yt?.players?.at(-1);
    if (!p) throw new Error("no player to end — did the slide mount one?");
    p.__end();
  });

module.exports = { stubYouTube, ytCalls, endCurrentVideo };
