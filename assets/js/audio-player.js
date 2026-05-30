// Shared audio: Plyr init, speed pills, stall/error recovery with position resume
(function () {
  const PLYR_CONFIG = {
    controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings'],
    settings: ['speed'],
    speed: { selected: 1, options: [0.75, 1, 1.25, 1.5, 2] },
  };

  // Keep speed pill active states in sync with the Plyr instance
  function wireSpeedPills(players) {
    document.querySelectorAll('.speed-pills').forEach(group => {
      const player = players[group.dataset.player];
      if (!player) return;
      const buttons = group.querySelectorAll('button');
      const sync = () => {
        const s = player.speed;
        buttons.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === s));
      };
      buttons.forEach(btn => btn.addEventListener('click', () => {
        player.speed = parseFloat(btn.dataset.speed);
      }));
      player.on('ratechange', sync);
    });
  }

  // Auto-recovery on stall/error: reload source and resume from last good position.
  // Browsers (especially mobile Safari) will fire `stalled` or `waiting` when the
  // server stops sending data mid-stream. We wait STALL_MS before retrying so we
  // don't thrash on temporary pauses.
  function wireStallRecovery(player) {
    const audio = player.media;
    if (!audio) return;

    let lastGoodTime = 0;
    let stallTimer = null;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    const STALL_MS = 5000;

    const clearStall = () => { clearTimeout(stallTimer); stallTimer = null; };

    const recover = () => {
      if (retryCount >= MAX_RETRIES || audio.paused) { clearStall(); return; }
      retryCount++;
      const resumeAt = lastGoodTime;
      // audio.load() resets position; use canplay to seek back before resuming
      audio.load();
      const onReady = () => {
        audio.removeEventListener('canplay', onReady);
        audio.currentTime = resumeAt;
        // play() may be blocked by mobile autoplay policy if user didn't just tap,
        // but usually allowed since they already initiated playback on this page
        audio.play().catch(() => {});
      };
      audio.addEventListener('canplay', onReady);
    };

    // Track the furthest position we've actually played through
    audio.addEventListener('timeupdate', () => {
      if (audio.currentTime > lastGoodTime + 0.5) {
        lastGoodTime = audio.currentTime;
        retryCount = 0; // reset retry budget whenever we make real progress
      }
    });

    audio.addEventListener('playing', clearStall);
    audio.addEventListener('pause',   clearStall);
    audio.addEventListener('ended',   clearStall);

    audio.addEventListener('stalled', () => {
      if (!audio.paused) { clearStall(); stallTimer = setTimeout(recover, STALL_MS); }
    });

    // `waiting` fires sooner than `stalled`; arm the same timer but only once
    audio.addEventListener('waiting', () => {
      if (!audio.paused && !stallTimer) stallTimer = setTimeout(recover, STALL_MS);
    });

    audio.addEventListener('error', () => {
      clearStall();
      if (!audio.paused) setTimeout(recover, 2000);
    });
  }

  // Call once after Plyr is available. Finds all audio[id] elements on the page,
  // inits Plyr, sets preload="metadata" (not "auto"), wires pills and recovery.
  window.initAudioPlayers = () => {
    const players = {};
    document.querySelectorAll('audio[id]').forEach(el => {
      // "metadata" fetches just enough to show duration; avoids pre-downloading
      // the entire large file before the user even presses play
      el.preload = 'metadata';
      const p = new Plyr(`#${el.id}`, PLYR_CONFIG);
      players[el.id] = p;
      wireStallRecovery(p);
    });
    wireSpeedPills(players);
    return players;
  };
})();
