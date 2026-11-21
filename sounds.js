/* ============================================================
   AOG Sound Engine v1.0.9 — drop-in UI + ambient sounds (no files)
   Pages only include this file. Taps, checkboxes, selects and number inputs are
   sounded automatically; a button can pick its own sound with data-sound="name".
   Never call AOGSound.play() for a tap — only for non-tap events (fireworks etc.)
   <script src="./sounds.js"></script>  (../sounds.js from sub-pages)

   - Synthesized with Web Audio API → 100% offline in the PWA
   - UI sounds: clicks, toasts, checkbox pops, fanfares, ticks
   - Scene audio for the 50 homepage canvas themes (AOGSound.scene)
   - Seasonal ambience on form pages (auto-detects body.seasonal-*)
   - Fireworks explosions/launches (called by the seasonal engine)
   - Update-banner chime, online/offline tones, camera shutter
   - Mute persists in localStorage:  AOGSound.toggleMute()
   ============================================================ */
(function () {
  'use strict';

  // Storage can THROW (Safari with all cookies blocked, private/locked-down
  // modes). Every read/write goes through these so a blocked store only means
  // settings don't persist — it must never stop the sound engine from loading.
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var ctx = null;
  var muted = lsGet('aog-sound-muted') === '1';
  // Ambient state must exist BEFORE the startup retry loop runs: on desktop
  // revisits the browser grants audio instantly, so goLive() -> applyScene()
  // -> stopAmbient() fires synchronously at load. Defining amb later crashed
  // the whole script (killing window.AOGSound and the sound panel button).
  var amb = { nodes: [], timers: [], scene: null, playingKey: null };

  // All audible output routes through the context's master limiter
  // (built in getCtx) instead of raw destination — prevents the hard
  // clipping that sounds like crackling static on older iOS.
  function out(c) { return (c && c._master) || c.destination; }

  // Restore the master bus after any duck/hard-mute (hide, pagehide). MUST be
  // called on every comeback path — a bfcache restore brings the page back
  // with the SAME context and a zeroed gain, which silenced everything.
  function unduck() {
    try {
      if (ctx && ctx._masterGain) {
        var lvl = (ctx._masterLevel != null) ? ctx._masterLevel : 0.9;
        if (ctx.state === 'running') ctx._masterGain.gain.setTargetAtTime(lvl, ctx.currentTime, 0.02);
        else ctx._masterGain.gain.value = lvl;
      }
    } catch (e) {}
  }

  // Set the iOS audio session category (no-op elsewhere / if unsupported)
  function setSession(type) {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== type) {
        navigator.audioSession.type = type;
        
      }
    } catch (e) {}
  }
  // Per-category sound preferences (controlled by the hub Sound Panel)
  var DEFAULT_PREFS = { taps: true, animations: true, seasonal: true, forms: true, alerts: true, intro: true }; // intro: launch spin-up — on by default, off in Sound Settings
  var prefs;
  try { prefs = JSON.parse(lsGet('aog-sound-prefs')) || {}; } catch (e) { prefs = {}; }
  for (var pk in DEFAULT_PREFS) if (typeof prefs[pk] !== 'boolean') prefs[pk] = DEFAULT_PREFS[pk];
  // Output mode: 'sound' | 'vibrate' | 'both'
  var mode = lsGet('aog-sound-mode') || 'sound';
  if (mode !== 'sound' && mode !== 'vibrate' && mode !== 'both') mode = 'sound';
  var preview = false; // true while the Sound Settings panel is open
  // Hub launch intro on screen (window.AOGIntro, set by the hub before this file loads): only the intro's
  // own sound plays; the background bed and page effects wait until it has finished.
  var held = !!(window.AOGIntro && window.AOGIntro.active);
  function allowed(cat) {
    if (muted) return false;
    if (held && cat !== 'intro') return false;
    if (preview && (cat === 'animations' || cat === 'seasonal')) return false;
    return prefs[cat] !== false;
  }

  // Selectable tone styles for the most audible sounds (hub Sound Panel)
  var DEFAULT_TONES = { click: 'thock', toast: 'slide', pop: 'bubblepop', success: 'tada', explosion: 'deep', notify: 'gentlealarm', fanfare: 'victory', thunder: 'random' };
  var toneChoice;
  try { toneChoice = JSON.parse(lsGet('aog-sound-tones-v4')) || {}; } catch (e) { toneChoice = {}; }
  for (var tk in DEFAULT_TONES) if (!toneChoice[tk]) toneChoice[tk] = DEFAULT_TONES[tk];

  // preset name → category
  var CATS = {
    click:'taps', hover:'taps', tick:'taps',
    toast:'alerts', notify:'alerts', online:'alerts', offline:'alerts', success:'alerts', error:'alerts',
    welcome:'animations', whoosh:'animations', pulse:'animations',
    boltStrike:'animations', zap:'animations', zapBig:'animations', thunder:'animations',
    ping:'animations', powerDown:'animations', surge:'animations', sizzle:'animations',
    shimmer:'animations', flare:'animations', grb:'animations', arcflash:'animations',
    ignite:'animations', trip:'animations',
    explosion:'seasonal', launch:'seasonal', jingle:'seasonal', bell:'seasonal',
    chirp:'seasonal', harp:'seasonal', wind:'seasonal',
    owl:'seasonal', moan:'seasonal', toll:'seasonal', creak:'seasonal', howl:'seasonal',
    sleigh:'seasonal', chimes:'seasonal', musicbox:'seasonal', snowsteps:'seasonal', hohoho:'seasonal',
    gobble:'seasonal', introSpin:'intro', introTwinkle:'intro', introPen:'intro', introType:'intro', introBlast:'intro',
    pop:'forms', fanfare:'forms', result:'forms', shutter:'forms',
    trash:'forms', copied:'forms', sweep:'forms', clunk:'taps', tink:'taps'
  };

  function getCtx() {
    // iOS 17+ Audio Session: AMBIENT ONLY. 'ambient' mixes with the user's
    // music/podcasts and respects the ringer switch. 'playback' was tried and
    // removed — it is non-mixable and paused Music/Spotify/Pandora. Cost: on
    // the buggy iOS cold-launch case, sound may need an app-switcher
    // round-trip to wake up. Acceptable; music is sacred.
    if (IS_IOS) setSession('ambient'); // no-op elsewhere — skip the work on desktop/Android
    if (ctx && ctx.state === 'closed') ctx = null; // rebuilt after zombie teardown
    if (!ctx && !hadGesture && IS_IOS) return null; // iOS only — see hadGesture note
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      // DO NOT pass sampleRate: iPhone hardware runs at 48000 Hz, and on
      // older iOS (13–15) forcing 44100 pushes WebKit through a low-quality
      // software resampler that makes ALL output crackle and distort.
      // Let the context run at the device's native rate.
      // OLD-iOS CRACKLE FIX: 'interactive' requests the smallest render
      // buffer the hardware offers; older iPhones can't fill it in time
      // when several sounds overlap, and every underrun is an audible
      // crackle/pop on the speaker. 'balanced' asks for a larger buffer
      // (~2x latency, still fine for UI blips) and removes the underruns.
      var hint = LEGACY_IOS ? 'balanced' : 'interactive';
      try { ctx = new AC({ latencyHint: hint }); } catch (e) { ctx = new AC(); }
      ctx._bornAt = Date.now();
      // Master bus: soft limiter so overlapping sounds (booms + clicks +
      // ambient loops) can't sum past 0dB. Older iOS hard-clips the mix,
      // which sounds like crunchy static; the limiter prevents that.
      try {
        var lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -10;
        lim.knee.value = 6;
        lim.ratio.value = 12;
        lim.attack.value = 0.002;
        lim.release.value = 0.15;
        var mg = ctx.createGain();
        // Old iPhone speakers physically distort near full scale even when
        // the digital signal is clean — leave them more headroom.
        mg.gain.value = LEGACY_IOS ? 0.7 : 0.9;
        lim.connect(mg).connect(ctx.destination);
        ctx._master = lim;
        ctx._masterGain = mg; // kept so the hide/close path can duck the bus
        ctx._masterLevel = mg.gain.value; // restore target on resume
      } catch (e) { ctx._master = ctx.destination; }
    }
    // iOS PWAs surface an extra 'interrupted' state after backgrounding —
    // treat anything not running as resumable
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // ── iOS standalone-PWA zombie watchdog ─────────────────────
  // After iOS suspends a home-screen PWA, the context can report 'running'
  // while its clock is frozen and no audio plays; resume() lies. Detect a
  // frozen clock and rebuild the whole context (Safari tabs recover on
  // their own; installed PWAs frequently do not).
  var watchdogBusy = false;
  function verifyAlive() {
    if (watchdogBusy || !ctx || ctx.state !== 'running') return;
    watchdogBusy = true;
    var t0 = ctx.currentTime;
    setTimeout(function () {
      watchdogBusy = false;
      if (!ctx || ctx.state !== 'running') return;
      if (ctx.currentTime === t0) {
        // GRACE PERIOD: a newborn context legitimately sits at 0.00 while
        // iOS spins up the session — killing it here strangled every
        // recovery attempt (watchdog executed each new ctx within 300ms).
        if (ctx._bornAt && Date.now() - ctx._bornAt < 3000) {  return; }
        // Zombie: clock frozen. Tear down and rebuild from scratch.
        
        try { ctx.close(); } catch (e) {}
        ctx = null;
        sceneStarted = false;
        getCtx();
        startRetryLoop();
      }
    }, 300);
  }
  // iOS: DO NOT create a context at load. On some iOS builds, creating an
  // AudioContext before ANY user touch wedges the app's entire audio system
  // for its lifetime — every context (even later gesture-born ones) stays
  // frozen at 0.00 until the app is backgrounded. So on iOS creation waits
  // for the first tap. Android / desktop have no such bug: there we create
  // at load, so sound starts on open whenever the browser allows autoplay
  // (installed PWAs and frequently used sites), and otherwise on first tap.
  var hadGesture = false;
  function ready() { return !muted && ctx && ctx.state === 'running'; }

  // ── Zero-tap audio strategy ─────────────────────────────────
  // Browsers block audio until the FIRST user gesture on a fresh visit
  // (a hard platform rule). But permission carries across same-origin
  // navigation and is granted outright to frequently-used sites, so:
  //   1. Try to start audio IMMEDIATELY on load
  //   2. Keep retrying for 15s — the instant the browser allows it, go
  //   3. React to onstatechange so ambience starts the same millisecond
  //   4. Catch every gesture type as the fallback unlock
  var sceneStarted = false;
  function goLive() {
    if (sceneStarted || muted || held) return;
    
    sceneStarted = true;
    applyScene();
    if (typeof flushPending === 'function') flushPending();
  }
  function tryStart() {
    var c = getCtx(); // getCtx() also calls resume()
    if (!c) return;
    verifyAlive();
    c.onstatechange = function () { if (c === ctx && c.state === 'running') goLive(); }; // ignore stale/rebuilt contexts
    if (c.state === 'running') goLive();
    else if (c.resume) c.resume().then(goLive).catch(function () {});
  }
  // Retry loop — restartable, because the OS suspends audio when the app is
  // backgrounded and we must fight to get it back the moment we return.
  var retryTimer = null;
  function startRetryLoop() {
    if (retryTimer) clearInterval(retryTimer);
    var retries = 0;
    tryStart();
    retryTimer = setInterval(function () {
      var c = ctx;
      if ((sceneStarted && c && c.state === 'running') || ++retries > 30) {
        clearInterval(retryTimer); retryTimer = null; return;
      }
      tryStart();
    }, 500);
  }
  // NOTE: the initial startRetryLoop() call happens at the BOTTOM of this
  // file (just before the public API) — running it here crashed on desktop
  // because goLive -> applyScene touches SCENES/SEASONS/amb defined below.

  // PERSISTENT gesture rescue: any tap/keypress revives a suspended context.
  // (Not once-only — after returning from the background the context is
  // suspended again and needs reviving again.)
  // iOS unlock ritual: resume() alone is sometimes ignored — playing a
  // silent buffer SYNCHRONOUSLY inside the gesture is what reliably
  // unlocks audio on iOS. Some iOS versions only honor touchend/click,
  // so we listen on those too.
  var ctxTrusted = false; // becomes true only for a context born inside a user gesture
  // ── iOS AUDIO SESSION ACTIVATOR ──────────────────────────────
  // Debug overlay proved: on cold PWA launch every AudioContext (even ones
  // born inside a gesture) reports 'running' with currentTime frozen at
  // 0.00 forever. iOS simply never activated the app's system audio
  // session. WebAudio cannot force that — but playing an HTML <audio>
  // element inside a gesture CAN. Once the session is live, contexts tick.
  // (A switcher round-trip activates the session as a side effect, which is
  // why that "fixed" it.) We keep doing this on every gesture until we see
  // the clock actually advance.
  var SILENT_WAV = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
  // Only iOS needs any of this — on desktop/Android these workarounds just
  // burn CPU (looping elements) and can wedge the audio stack.
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // LEGACY iOS (pre-17, feature-detected via the Audio Session API): the
  // cold-launch dead-session bug does NOT exist there, so the looping
  // <audio> activator is pure downside — HTMLMediaElement playback on old
  // iOS claims the audio session and PAUSES the user's Music app, and a
  // forever-looping element keeps it paused. Legacy unlocks fine with the
  // in-gesture silent WebAudio buffer alone, which mixes with music.
  var LEGACY_IOS = IS_IOS && !navigator.audioSession;
  // 'playback' escalation flag — see getCtx(). false = stay 'ambient'
  // (mix with the user's music); true = cold-launch kick in progress.
  // ── COLD-LAUNCH FIRST-TAP KICK (iOS standalone PWA) ─────────────────
  // On the buggy iOS builds a cold home-screen launch comes up with a DEAD
  // system audio session: the polite 'ambient' kick on the first gesture
  // silently fails, escalation to 'playback' happens 1.5s later, but that
  // escalated kick only works inside a NEW gesture — so sound (and the
  // Dynamic Island indicator) only appeared after a SECOND tap or an
  // app-switcher round-trip. Pre-arm sessionForce on cold standalone
  // launches so the VERY FIRST activating tap plays the silent looper
  // under 'playback' — the one category that reliably activates the
  // session — reproducing the switcher effect on first launch. The
  // clock-tick watcher above already hands the category back to 'ambient'
  // (and clears sessionForce) the moment audio is confirmed live, so the
  // ringer/silent switch is respected after the kick. The interrupted
  // guard in gestureUnlock stands this down if music owns the session.
  // (pre-arm removed — AMBIENT ONLY policy; sessionForce is permanently false)
  var sessionEl = null, sessionLive = false, pipedCtx = null, pipedEl = null;
  /* MUSIC-FIRST (20 Nov 2026): the silent looper is an HTMLMediaElement, and iOS treats a playing
     media element as "Now Playing" — with the phone on CarPlay that took over the car's audio and
     PAUSED the user's music the moment the app was opened, even under the 'ambient' category.
     So the looper is now a LAST RESORT: it only runs after we've actually SEEN the WebAudio clock
     stuck at 0 (the cold-launch dead-session bug). If music or a podcast is playing, the system
     audio session is already live, our context ticks straight away, needKick never turns on, and
     the looper never starts — the app's sounds just mix in. Cost: on the buggy cold launch with
     nothing else playing, sound may take a second tap to wake up. Music is sacred. */
  var needKick = false;
  function stopPipedEl() {
    if (pipedEl) { try { pipedEl.pause(); pipedEl.src = ''; } catch (e) {} pipedEl = null; }
  }
  // The audio session CATEGORY is applied when playback STARTS. If the
  // silent looper is already playing (or has a pending play) under
  // 'ambient', flipping audioSession.type to 'playback' does nothing to
  // it — the element must be stopped and re-played for the escalated
  // category to actually take the session. Called whenever sessionForce
  // flips true; the next activateSession()/gesture replays it fresh.
  // ── MUSIC-FIRST GATE for the 'playback' kick ────────────────────────
  // 'playback' is non-mixable: starting the looper under it PAUSES whatever
  // the user is playing (Music, Spotify, Pandora...). Only allow the forced
  // kick when we have a context AND it is not 'interrupted'. No context yet
  // (e.g. the very first activateSession() of a tap, which runs before the
  // context is built) => we cannot know if music owns the session, so stay
  // 'ambient'; the activation-event re-kick later in the SAME tap runs
  // after the context exists and makes the informed call. If music is
  // detected, stand sessionForce down entirely: a playing music app means
  // the OS audio session is already live, so the cold-launch dead-session
  // bug can't be present and 'ambient' will mix in fine.
  function activateSession() {
    // iOS-ONLY MACHINERY: the silent looper, the piped element, and the
    // session kick exist solely to work around iOS's audio-session
    // lifecycle. Android / desktop Chrome / Edge / Firefox / desktop Safari
    // have no such bug — WebAudio just works after a gesture — so running
    // looping audio elements there is pure battery/CPU overhead. Skip it.
    if (!IS_IOS) { sessionLive = true; return; }
    if (sessionLive || LEGACY_IOS) return;
    setSession('ambient'); // AMBIENT ONLY
    if (!needKick) return;   // MUSIC-FIRST: no media element until the clock has been seen stuck
    try {
      if (!sessionEl) {
        sessionEl = new Audio(SILENT_WAV);
        sessionEl.setAttribute('playsinline', '');
        sessionEl.loop = true;
        sessionEl.volume = 0.01;
        // FAST PATH: 'playing' on the looper is the EARLIEST signal that
        // iOS accepted the audio session. A context born before that moment
        // never ticks — so recycle it NOW instead of waiting for the 1.5s
        // watchdog cycle. This is most of the old 5-10s cold-start silence.
        sessionEl.addEventListener('playing', function () {
          if (!IS_IOS || sessionLive) return;
          if (ctx && ctx.state === 'running' && ctx.currentTime > 0) return; // already ticking
          if (ctx && ctx._bornAt && Date.now() - ctx._bornAt < 250) return;  // newborn — give it a beat
          recycleCtx();
        });
      }
      // Second known unfreezer: route the element THROUGH the WebAudio
      // graph. The element's playback drags the context's rendering onto
      // the same live session, which can start a frozen clock.
      var c = ctx;
      if (c && pipedCtx !== c) {
        stopPipedEl(); // release the previous context's looping element
        try {
          // an element can only be attached to ONE context ever, and we
          // rebuild contexts — so each context gets its own fresh element
          var el2 = new Audio(SILENT_WAV);
          el2.setAttribute('playsinline', '');
          el2.loop = true;
          var src = c.createMediaElementSource(el2);
          var g = c.createGain(); g.gain.value = 0.0001;
          src.connect(g); g.connect(out(c));
          el2.play().then(function(){  }).catch(function(e){  });
          pipedCtx = c; pipedEl = el2;
          
        } catch (e2) {  }
      }
      var p = sessionEl.play();
      if (p && p.then) {
        p.then(function () {  })
         .catch(function (e) {  });
      }
    } catch (e) {  }
  }
  // Watch for the clock finally ticking; once it does, session is confirmed
  // live and we stop poking it. Also restart ambience since earlier
  // goLive() calls happened on a frozen engine.
  setInterval(function () {
    if (!IS_IOS) return; // iOS-only watchdog — no dead-session bug elsewhere
    if (sessionLive || !ctx) return;
    if (ctx.state === 'running' && ctx.currentTime > 0) {
      sessionLive = true;
      
      // Session is up — hand it back to 'ambient' so the ringer/silent
      // switch is respected from here on. ('playback' was only the starter.)
      setSession('ambient');
      stopPipedEl();
      // DO NOT stop sessionEl: the silent looper is what HOLDS the iOS
      // audio session open. Stopping it (a past "cleanup") let iOS drop the
      // session and the clock refroze — the cold-launch bug came back.
      // BUT: the looper started under the 'playback' category, and a
      // media element KEEPS the category it started with — which is what
      // put the audio chip in the Dynamic Island / Now Playing. The
      // category is re-evaluated when playback starts, so RESTART the
      // looper here so it re-acquires the session under 'ambient'
      // (mixable, no media indicator). The refreeze guard below is the
      // backstop if iOS drops the session during the swap.
      if (sessionEl) {
        try {
          sessionEl.pause(); sessionEl.currentTime = 0;
          var pr = sessionEl.play();
          if (pr && pr.catch) pr.catch(function () {});
          
        } catch (e) {}
      }
      sceneStarted = false;
      tryStart();
      return;
    }
    // iOS 18 finding (from device logs): a context created BEFORE the OS
    // audio session is ready NEVER starts ticking — no resume/suspend
    // cycle revives it. The only cure is a context created AFTER the
    // session comes up. So while the session isn't confirmed live, keep
    // recycling: close the frozen context and build a fresh one every
    // ~1.5s. The moment the OS session is ready, the next fresh context
    // ticks within a second instead of after 10+ seconds of lucky taps.
    // MUSIC-FIRST: an interrupted context means another app is playing.
    // Don't escalate and don't churn rebuilds (a fresh ctx would just come
    // up interrupted again) — nudge resume() and wait for iOS to end it.
    if (ctx.state === 'interrupted') {
      try { ctx.resume().catch(function () {}); } catch (e) {}
      return;
    }
    // 800ms (was 1500): resume() settles well inside this, and every extra
    // waiting round was a full silent cycle added to cold-start. The
    // looper's 'playing' listener usually recycles even sooner.
    if (hadGesture && ctx._bornAt && Date.now() - ctx._bornAt > 800) {
      // Stuck after a real tap: this is the dead-session bug, not music (music would have the
      // session live). Allow the looper from the NEXT tap on — playing media needs a gesture.
      if (ctx.state === 'running' && ctx.currentTime === 0) needKick = true;
      recycleCtx();
    }
  }, 250);
  // Throw away a frozen pre-session context and build a fresh one — the only
  // cure for the iOS cold-launch dead session (see watchdog comment above).
  var _lastRecycle = 0;
  function recycleCtx() {
    var now = Date.now();
    if (now - _lastRecycle < 400) return; // event + watchdog can both fire
    _lastRecycle = now;
    try { if (ctx) ctx.close(); } catch (e) {}
    ctx = null; sceneStarted = false; pipedCtx = null;
    var c = getCtx(); // fresh context; getCtx() resumes non-running states
    if (c && c.state !== 'running') { try { c.resume().catch(function () {}); } catch (e) {} }
    activateSession(); // re-pipe the looper element through the new ctx
  }
  // RE-FREEZE GUARD (iOS): if the clock ever stops advancing again while
  // 'running', re-arm the unlock so the next tap does the full activation.
  var lastLiveT = 0, stuckTicks = 0;
  setInterval(function () {
    if (!IS_IOS) return; // iOS-only refreeze guard
    if (!sessionLive || !ctx || ctx.state !== 'running') { stuckTicks = 0; return; }
    if (ctx.currentTime === lastLiveT) {
      if (++stuckTicks >= 3) {
        
        sessionLive = false; pipedCtx = null; stuckTicks = 0;
        // AMBIENT ONLY: no 'playback' escalation on refreeze — just make
        // sure the ambient looper is playing and let the rebuild path run.
        setSession('ambient');
        // MUSIC-FIRST: don't restart a media element on a timer (that's what can grab "Now
        // Playing"). Mark the kick as needed; the next tap — the user's own action — does it.
        needKick = true;
      }
    } else stuckTicks = 0;
    lastLiveT = ctx.currentTime;
  }, 400);

  // Events that actually carry TRANSIENT USER ACTIVATION for touch input.
  // Per the HTML spec (and WebKit's implementation of it), the down-events
  // only activate for MICE: mousedown, and pointerdown when pointerType is
  // 'mouse'. For fingers, activation is granted on the UP side of the tap:
  // pointerup / touchend / click. touchstart and pointerdown(touch) grant
  // NOTHING — HTMLMediaElement.play() called from them is rejected with
  // NotAllowedError on iOS.
  var ACTIVATION_EVENTS = { touchend: 1, pointerup: 1, click: 1, mousedown: 1, keydown: 1 };
  function gestureUnlock(evt) {
    // One physical tap fires pointerdown+touchstart+touchend+click. Treat
    // that burst as ONE unlock attempt, or the fail counter hits 2 within a
    // single tap and destroys the context MID-RESUME (resume is async).
    hadGesture = true;
    var now = Date.now();
    var etype = (evt && evt.type) || '';
    // ── SESSION KICK ON ACTIVATING EVENTS (runs even inside the dedupe) ──
    // THE COLD-LAUNCH KILLER LIVED HERE: the 350ms dedupe below pins the
    // full unlock ritual to the FIRST event of every tap burst — always
    // pointerdown(touch) on iOS — which carries NO user activation. So
    // sessionEl.play(), the ONE call that can activate the iOS system
    // audio session from inside the page, was rejected on every tap
    // forever; the touchend/click of the same tap (which WOULD have been
    // allowed) hit the dedupe and returned early. Interval-driven retries
    // have no activation at all. Net effect: nothing in the page could
    // ever bring the session up, and only an app-switcher round-trip
    // (which reactivates the session at the OS level) produced sound.
    // Fix: re-attempt the media-element kick + resume + primer buffer on
    // the activation-carrying events of the SAME tap, bypassing the dedupe.
    if (!sessionLive && ACTIVATION_EVENTS[etype]) {
      // MUSIC-FIRST POLICY: an 'interrupted' context means another app
      // (Music, podcast) owns the audio session. The ONLY way to force
      // sound out of an interruption from inside a page is a 'playback'
      // takeover — which pauses the user's music. Per app policy we now
      // NEVER do that while music holds the session: stay 'ambient',
      // keep gently nudging resume()/the silent looper (on healthy
      // builds ambient mixes in fine), and accept that on the buggy
      // builds our sounds stay silent until iOS ends the interruption.
      // The 'playback' escalation below only ever fires when NOTHING
      // else is playing (frozen/suspended context, not interrupted).
      if (ctx && ctx.state === 'interrupted') {
        
        try { ctx.resume().catch(function () {}); } catch (e) {}
      }
      
      activateSession(); // safe to re-enter: reuses sessionEl, guards piping
      var ca = ctx; // created moments ago by this tap's pointerdown pass
      if (ca) {
        if (ca.state !== 'running') { try { ca.resume().catch(function () {}); } catch (e) {} }
        try { // primer buffer, now from a context that HAS activation
          var ba = ca.createBuffer(1, 1, ca.sampleRate);
          var sa = ca.createBufferSource();
          sa.buffer = ba; sa.connect(out(ca)); sa.start(0);
        } catch (e) {}
      }
    }
    if (gestureUnlock._last && now - gestureUnlock._last < 350) return;
    gestureUnlock._last = now;
    
    activateSession(); // MUST be first — inside the gesture, activates iOS system audio session
    // If the session just came alive but our context was born BEFORE it
    // (frozen clock), rebuild it now inside this gesture.
    if (ctx && ctx.state === 'running' && ctx.currentTime === 0 && gestureUnlock._sawFrozen &&
        !(ctx._bornAt && Date.now() - ctx._bornAt < 3000)) {
      
      try { ctx.close(); } catch (e) {}
      ctx = null; sceneStarted = false;
    }
    gestureUnlock._sawFrozen = !!(ctx && ctx.state === 'running' && ctx.currentTime === 0);
    // COLD-LAUNCH SILENT DUD: on a fresh iOS PWA launch the context created
    // at page load can report 'running' with a ticking clock while
    // outputting pure silence — NO status check can catch it. The only cure
    // is a brand-new context created inside a user gesture (which is what a
    // switcher round-trip effectively forces). So: the first tap after
    // every page load unconditionally discards the load-time context and
    // rebuilds fresh, right here inside the gesture.
    if (!ctxTrusted) {
      // iOS-only cure: on desktop/Android a load-time context is healthy —
      // discarding it here ate the first click's sound for no benefit.
      if (IS_IOS && ctx) { try { ctx.close(); } catch (e) {} ctx = null; sceneStarted = false; }
      ctxTrusted = true;
    }
    var c = getCtx();
    if (c && c.state !== 'running') {
      gestureUnlock._fails = (gestureUnlock._fails || 0) + 1;
      // never rebuild a context still inside its resume window
      if (gestureUnlock._fails >= 2 && c._bornAt && now - c._bornAt > 1500) {
        try { c.close(); } catch (e) {}
        ctx = null;
        gestureUnlock._fails = 0;
        sceneStarted = false;
        
        c = getCtx(); // fresh context, born inside a user gesture
        pipedCtx = null; // force activateSession below/next to pipe THIS ctx
      }
    } else {
      gestureUnlock._fails = 0;
    }
    if (c) {
      if (c.state !== 'running') {
        try {
          var rid = (gestureUnlock._rid = (gestureUnlock._rid || 0) + 1);
          
          c.resume().then(function () {  })
                    .catch(function (e) {  });
        } catch (e) {  }
      }
      else if (c.currentTime === 0 && c._bornAt && now - c._bornAt > 1200) {
        // running-but-frozen: plain resume() is a no-op on a wedged state
        // machine — a full suspend->resume cycle can unstick it
        
        try { c.suspend().then(function(){ return c.resume(); }).catch(function(){}); } catch (e) {}
      }
      try {
        var b = c.createBuffer(1, 1, c.sampleRate);
        var src = c.createBufferSource();
        src.buffer = b;
        src.connect(out(c));
        src.start(0);
      } catch (e) {}
    }
    if (!ctx || ctx.state !== 'running') {  tryStart(); }
    else { verifyAlive(); goLive(); } // ctx rebuilt in-gesture comes up 'running', which skipped tryStart — so ambient scene loops (rain/wind/hum/fan/engine) never launched until something else forced a restart. goLive() is guarded by sceneStarted, so this is a no-op when already live.
    if (ctx && pipedCtx !== ctx) activateSession(); // pipe the CURRENT ctx (it may have just been rebuilt above)
  }
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, gestureUnlock, { passive: true });
  });
  // Fallback: a scroll is a gesture too — but ONLY a human one. Chrome fires
  // a synthetic 'scroll' at load when restoring scroll position after a
  // refresh; treating that as a gesture spent the one-shot in-gesture ctx
  // rebuild with zero audio permission, permanently wedging sound for the
  // visit. navigator.userActivation.hasBeenActive is true only after a real
  // click/tap/keypress, so gate on it (browsers without the API skip the
  // fallback — the direct tap/click listeners above still cover them).
  function gestureIfActive(evt) {
    // Once audio is confirmed healthy there is nothing left to unlock —
    // without this, every scroll/wheel tick past the dedupe re-ran the full
    // activation ritual (primer buffers, session pokes) forever.
    if (ctx && ctx.state === 'running' && (!IS_IOS || (sessionLive && ctx.currentTime > 0))) return;
    if (navigator.userActivation && navigator.userActivation.hasBeenActive) gestureUnlock(evt);
  }
  ['wheel', 'touchmove'].forEach(function (ev) {
    document.addEventListener(ev, gestureIfActive, { passive: true });
  });
  window.addEventListener('scroll', gestureIfActive, { passive: true });

  // Returning to the app: kick the retry loop immediately on every path the
  // browser can take back to us — tab switch, app switcher, back/forward cache.
  ['focus', 'pageshow'].forEach(function (ev) {
    window.addEventListener(ev, function () {
      if (!document.hidden) { unduck(); sceneStarted = false; startRetryLoop(); }
    });
  });
  // iOS standalone PWAs often fire ONLY visibilitychange (no focus/pageshow)
  // when returning via the app switcher. If the context came back anything
  // other than 'running', don't trust resume() — tear it down and rebuild.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      
      // CLICK/STUTTER FIX: duck the master bus and fade ambience FIRST,
      // while the context is still rendering. Previously we suspended the
      // context here and stopAmbient()'s fade ran on a frozen graph — the
      // looping noise beds were then chopped mid-waveform, producing the
      // clipping/stuttering pop heard when closing/backgrounding the app.
      try {
        if (ctx && ctx._masterGain && ctx.state === 'running') {
          ctx._masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
        }
      } catch (e) {}
      stopAmbient(); // fades sources while audio is still live

      // NON-iOS BATTERY: suspend the context while hidden — safe on
      // Android/desktop (resume() is reliable there) and stops all audio
      // rendering. NOT done on iOS: rebuild-on-return handles it and
      // suspend/resume cycles are what trigger the frozen-clock bug.
      // Deferred ~80ms so the duck/fade above gets rendered first.
      if (!IS_IOS && ctx && ctx.state === 'running') {
        setTimeout(function () {
          if (!document.hidden) return; // came back before we suspended
          try { if (ctx) ctx.suspend().catch(function(){}); } catch (e) {}
        }, 80);
      }
      // LOCK-SCREEN / BACKGROUND SILENCE: pause the silent looper (and the
      // piped element) whenever the app leaves the foreground — locking the
      // phone included. A playing media element is what surfaces the audio
      // chip on the lock screen / Dynamic Island; with everything paused
      // while hidden, nothing shows there. The session may lapse while
      // paused, but the resume path below (plus the gesture unlock and
      // refreeze guard) re-acquires it as soon as the app is back.
      if (sessionEl) { try { sessionEl.pause(); } catch (e) {} }
      if (pipedEl)   { try { pipedEl.pause();   } catch (e) {} }
      return;
    }
    
    if (!IS_IOS && ctx && ctx.state === 'suspended') {
      try { ctx.resume().catch(function(){}); } catch (e) {}
    }
    unduck(); // master bus was faded to 0 on hide
    // MUSIC-FIRST: do NOT auto-restart the silent looper on return — coming back to the app with
    // music playing (CarPlay) would hand "Now Playing" to us and pause the music. If our clock is
    // stuck after returning, the refreeze guard sets needKick and the user's next tap restarts it.
    if (ctx && ctx.state !== 'running') {
      if (!IS_IOS && ctx.state === 'suspended') {
        // non-iOS: resume() above will finish — don't tear down a healthy
        // suspended context, rebuilding is the iOS workaround only
      } else {
        try { ctx.close(); } catch (e) {}
        ctx = null;
      }
    }
    sceneStarted = false;
    startRetryLoop();
  });

  /* ================= INSTRUMENTS ================= */

  function tone(o) {
    if (muted) return;
    var c = getCtx(); if (!c) return;
    var osc = c.createOscillator(), g = c.createGain();
    var t = c.currentTime + (o.delay || 0), dur = o.dur || 0.12;
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.from, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out(c));
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  function noiseBurst(o) { // one-shot noise through a filter
    if (muted) return;
    var c = getCtx(); if (!c) return;
    var t = c.currentTime + (o.delay || 0), dur = o.dur || 0.3;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    var curve = o.curve || 2;
    for (var i = 0; i < len; i++) {
      var p = i / len;
      var env = o.rev ? Math.pow(p, 1.2) * (1 - p * 0.3) : Math.pow(1 - p, curve);
      if (o.mod) env *= (0.6 + 0.4 * Math.sin(p * o.mod + Math.random() * 0.5));
      d[i] = (Math.random() * 2 - 1) * env;
    }
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = o.filter || 'lowpass'; f.Q.value = o.q || 0.8;
    f.frequency.setValueAtTime(o.from || 2000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    var g = c.createGain(); g.gain.value = o.vol || 0.1;
    src.connect(f).connect(g).connect(out(c));
    src.start(t);
  }

  function whoosh(dur, vol) {
    noiseBurst({ dur: dur || 0.35, vol: vol || 0.08, filter: 'bandpass', from: 400, to: 2200, curve: 1 });
  }

  function boom(vol) { // realistic firework burst
    if (muted) return;
    var c = getCtx(); if (!c) return;
    vol = vol || 0.22;
    var t = c.currentTime;

    // 1) Sharp initial CRACK — loud, short, full-spectrum
    noiseBurst({ dur: 0.06, vol: vol * 1.4, filter: 'highpass', from: 300, q: 0.5, curve: 1.2 });

    // 2) Deep concussive thump right behind it
    tone({ type: 'sine', from: 120 + Math.random() * 40, to: 30, dur: 0.5, vol: vol * 1.1, delay: 0.01 });

    // 3) Body of the explosion — noise with falling filter
    noiseBurst({ dur: 0.7 + Math.random() * 0.4, vol: vol * 0.7, from: 3000 + Math.random() * 2000, to: 100, curve: 2.5, delay: 0.02 });

    // 4) Crackle tail — dozens of tiny random pops as sparks burn out
    var crackles = 18 + (Math.random() * 14 | 0);
    for (var i = 0; i < crackles; i++) {
      var when = 0.15 + Math.pow(Math.random(), 0.7) * 1.1; // denser early, sparser late
      var fade = 1 - when / 1.4;
      noiseBurst({ dur: 0.015 + Math.random() * 0.02, vol: vol * 0.35 * fade,
                   filter: 'highpass', from: 2000 + Math.random() * 4000, q: 1, curve: 1, delay: when });
    }

    // 5) Distant echo rumble rolling back
    noiseBurst({ dur: 0.9 + Math.random() * 0.5, vol: vol * 0.25, from: 400, to: 60, curve: 1.8, delay: 0.25 + Math.random() * 0.15 });
  }

  function thunder(vol) { // long distant rumble
    if (muted) return;
    var c = getCtx(); if (!c) return;
    vol = vol || 0.1;
    var dur = 1.6 + Math.random() * 1.2;
    var t = c.currentTime;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    var e = 0;
    for (var i = 0; i < len; i++) {
      var p = i / len;
      // rolling envelope: several overlapping decaying rumbles
      e = Math.pow(1 - p, 1.5) * (0.6 + 0.4 * Math.sin(p * 20 + Math.random()));
      d[i] = (Math.random() * 2 - 1) * e;
    }
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(220, t);
    f.frequency.exponentialRampToValueAtTime(70, t + dur);
    var g = c.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(out(c));
    src.start(t);
  }

  var lastZap = 0;
  function zap(big) { // electric crackle, self-throttled
    if (muted) return;
    var now = Date.now();
    if (now - lastZap < (big ? 400 : 160)) return;
    lastZap = now;
    noiseBurst({ dur: big ? 0.25 : 0.09, vol: big ? 0.12 : 0.05, filter: 'highpass', from: 2500, q: 1.2, curve: 3 });
    tone({ type: 'square', from: big ? 1800 : 2600, to: big ? 200 : 700, dur: big ? 0.18 : 0.07, vol: big ? 0.06 : 0.03 });
  }

  function ping() { tone({ type: 'sine', from: 1150, to: 1100, dur: 0.5, vol: 0.05 }); }

  function powerDown() {
    tone({ type: 'sawtooth', from: 320, to: 40, dur: 1.1, vol: 0.07 });
    tone({ type: 'sine', from: 160, to: 30, dur: 1.1, vol: 0.06 });
  }

  function jingle() { // sleigh-bell shimmer
    for (var i = 0; i < 6; i++) {
      tone({ type: 'triangle', from: 2200 + Math.random() * 1600, dur: 0.09, vol: 0.035, delay: i * 0.09 + Math.random() * 0.03 });
    }
  }

  function bell() { // school bell: two rings
    [0, 0.45].forEach(function (dl) {
      tone({ type: 'triangle', from: 1320, dur: 0.35, vol: 0.06, delay: dl });
      tone({ type: 'sine', from: 1980, dur: 0.3, vol: 0.03, delay: dl });
    });
  }

  function chirp() { // bird
    tone({ type: 'sine', from: 2600, to: 3600, dur: 0.09, vol: 0.04 });
    tone({ type: 'sine', from: 3400, to: 2400, dur: 0.11, vol: 0.04, delay: 0.13 });
    if (Math.random() > 0.5) tone({ type: 'sine', from: 2900, to: 3800, dur: 0.08, vol: 0.035, delay: 0.3 });
  }

  function harp() { // gentle arpeggio
    var notes = [523, 659, 784, 1046];
    notes.forEach(function (f, i) {
      tone({ type: 'triangle', from: f, dur: 0.5, vol: 0.045, delay: i * 0.12 });
    });
  }

  function windGust() {
    noiseBurst({ dur: 1.8 + Math.random(), vol: 0.045, filter: 'bandpass', from: 200, to: 600, q: 0.6, curve: 1 });
  }

  /* ── HALLOWEEN: spooky one-shots (all quiet, all distant) ───────────── */
  // A soft-attack voice: tone() snaps in over 10ms, which reads as a beep.
  // Owls, moans and bells need a slow swell, a pitch path and a long tail.
  function voice(o) {
    if (muted) return;
    var c = getCtx(); if (!c) return;
    var t = c.currentTime + (o.delay || 0), dur = o.dur || 1;
    var osc = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    g.gain.value = 0.0001;
    osc.type = o.type || 'sine';
    var path = o.path || [o.from];
    osc.frequency.setValueAtTime(path[0], t);
    for (var i = 1; i < path.length; i++)
      osc.frequency.linearRampToValueAtTime(path[i], t + dur * i / (path.length - 1));
    if (o.vib) { // vibrato
      var lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = o.vib; lg.gain.value = o.vibDepth || 6;
      lfo.connect(lg).connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    f.type = 'lowpass'; f.frequency.value = o.lp || 2200;
    var atk = o.atk || 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.03, t + atk);
    if (o.hold) g.gain.setValueAtTime(o.vol || 0.03, t + dur * o.hold); // sustain, then fade
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f).connect(g).connect(out(c));
    osc.start(t); osc.stop(t + dur + 0.1);
  }
  function owlHoot() { // "hoo ... hoo-hoo" from somewhere out in the trees
    var f = 330 + Math.random() * 40;
    voice({ path: [f, f * 1.02, f * 0.96], dur: 0.7, vol: 0.06, atk: 0.12, lp: 900 });
    voice({ path: [f * 0.98, f * 0.94],    dur: 0.4, vol: 0.05, atk: 0.06, lp: 900, delay: 1.0 });
    voice({ path: [f * 0.98, f * 0.92],    dur: 0.6, vol: 0.055, atk: 0.06, lp: 900, delay: 1.45 });
  }
  function ghostMoan() { // a slow, wavering "ooooOOOooo"
    var b = 260 + Math.random() * 60;
    voice({ type: 'triangle', path: [b, b * 1.45, b * 1.3, b * 0.85], dur: 3.2, vol: 0.045,
            atk: 0.9, vib: 5, vibDepth: 7, lp: 1100 });
    voice({ type: 'sine', path: [b * 2, b * 2.9, b * 2.6, b * 1.7], dur: 3.2, vol: 0.015,
            atk: 1.0, vib: 5.3, vibDepth: 10, lp: 1600 }); // airy upper "breath"
  }
  function wolfHowl() { // long rising howl, then a fainter wolf answers from further off
    var b = 330 + Math.random() * 50;
    var path = [b, b * 1.55, b * 1.95, b * 2.0, b * 1.98, b * 1.9, b * 1.5, b * 1.15];
    voice({ type: 'triangle', path: path, dur: 3.6, vol: 0.05, atk: 0.5, hold: 0.7, vib: 4.5, vibDepth: 5, lp: 1500 });
    voice({ type: 'sine', path: path.map(function (f) { return f * 2; }), dur: 3.6, vol: 0.012,
            atk: 0.6, hold: 0.7, vib: 4.5, vibDepth: 9, lp: 2600 }); // breathy upper harmonic
    var a = b * 1.12; // the answer: higher, shorter, more distant (lower + darker)
    voice({ type: 'triangle', path: [a, a * 1.6, a * 1.85, a * 1.8, a * 1.3], dur: 2.6, vol: 0.022,
            atk: 0.5, hold: 0.65, vib: 5, vibDepth: 5, lp: 1000, delay: 3.0 });
  }
  function churchToll() { // distant bell: inharmonic partials, long ringing tail
    var f = 196;
    [[1, 0.03], [2.0, 0.016], [2.4, 0.013], [3.0, 0.009], [4.2, 0.006]].forEach(function (p) {
      voice({ path: [f * p[0], f * p[0] * 0.998], dur: 4.5, vol: p[1], atk: 0.01, lp: 1500 });
    });
  }
  function doorCreak() { // stick-slip friction: a train of clicks whose rate drifts
    if (muted) return;
    var c = getCtx(); if (!c) return;
    var dur = 1.1 + Math.random() * 0.8, sr = c.sampleRate;
    var len = Math.floor(sr * dur), buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0);
    var next = 0, k = 0;
    for (var i = 0; i < len; i++) {
      var p = i / len;
      if (i >= next) { // one "slip"
        k = 1;
        var rate = 38 + 50 * Math.sin(p * 3.1 + 0.4) + Math.random() * 14; // 25–100 slips/sec
        next = i + Math.floor(sr / Math.max(22, rate));
      }
      var env = Math.sin(Math.PI * p);        // swell in, fade out
      d[i] = k * env * (Math.random() * 0.6 + 0.4);
      k *= 0.993;                            // each slip rings briefly
    }
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 620; f.Q.value = 6;
    var g = c.createGain(); g.gain.value = 0.09;
    src.connect(f).connect(g).connect(out(c));
    src.start();
  }

  function shutter() { // camera: two fast clicks
    noiseBurst({ dur: 0.03, vol: 0.14, filter: 'highpass', from: 1500, curve: 4 });
    noiseBurst({ dur: 0.04, vol: 0.1, filter: 'highpass', from: 1200, curve: 4, delay: 0.07 });
  }

  function pop() { tone({ type: 'sine', from: 440, to: 880, dur: 0.05, vol: 0.09 }); }

  function fanfare() {
    var seq = [523, 659, 784, 1046, 1318];
    seq.forEach(function (f, i) {
      tone({ type: 'triangle', from: f, dur: i === seq.length - 1 ? 0.5 : 0.14, vol: 0.1, delay: i * 0.13 });
      tone({ type: 'sine', from: f / 2, dur: 0.14, vol: 0.05, delay: i * 0.13 });
    });
  }

  var lastTick = 0;
  function tick() {
    var now = Date.now();
    if (now - lastTick < 80) return;
    lastTick = now;
    tone({ type: 'sine', from: 2000, dur: 0.02, vol: 0.025 });
  }

  function launchWhistle() { // realistic shell launch
    if (muted) return;
    // 1) Mortar tube THUMP — the deep "toomp" of the lift charge
    noiseBurst({ dur: 0.06, vol: 0.1, filter: 'lowpass', from: 480, curve: 2.5 });
    tone({ type: 'sine', from: 75, to: 42, dur: 0.14, vol: 0.08 });

    // 2) Breathy rising hiss as the shell climbs (noise, not a pure tone)
    noiseBurst({ dur: 0.9 + Math.random() * 0.4, vol: 0.03, filter: 'bandpass',
                 from: 800 + Math.random() * 300, to: 3200 + Math.random() * 800,
                 q: 2.5, curve: 0.8, delay: 0.06 });

    // 3) Sometimes a faint wavering whistle rides on top (whistling shell)
    if (Math.random() < 0.45) {
      var c = getCtx(); if (!c) return;
      var t = c.currentTime + 0.1;
      var dur = 0.8 + Math.random() * 0.3;
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(900 + Math.random() * 200, t);
      o.frequency.exponentialRampToValueAtTime(2300 + Math.random() * 500, t + dur);
      // vibrato LFO makes it warble like a real whistle
      var lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 22 + Math.random() * 8;
      lg.gain.value = 45;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.014, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out(c));
      lfo.start(t); o.start(t);
      lfo.stop(t + dur + 0.05); o.stop(t + dur + 0.05);
    }
  }

  var lastIgnite = 0;
  function ignite() { // engine combustion pop, throttled per cycle
    var now = Date.now();
    if (now - lastIgnite < 220) return;
    lastIgnite = now;
    noiseBurst({ dur: 0.04, vol: 0.08, filter: 'lowpass', from: 500, curve: 3 });
    tone({ type: 'sine', from: 85, to: 45, dur: 0.09, vol: 0.07 });
  }

  function trip() { // breaker trip: heavy mechanical CLACK + arc snap
    noiseBurst({ dur: 0.035, vol: 0.16, filter: 'lowpass', from: 900, curve: 3 });
    tone({ type: 'square', from: 170, to: 90, dur: 0.07, vol: 0.07 });
    noiseBurst({ dur: 0.1, vol: 0.06, filter: 'highpass', from: 2800, curve: 2, delay: 0.03 });
  }

  function surge() { // rising electrical whine
    tone({ type: 'sawtooth', from: 180, to: 850, dur: 0.55, vol: 0.035 });
  }

  function sizzle() { // spreading electric crackle (lichtenberg / fire)
    var n = 8 + (Math.random() * 6 | 0);
    for (var i = 0; i < n; i++) {
      noiseBurst({ dur: 0.012 + Math.random() * 0.02, vol: 0.045 * (1 - i / n),
                   filter: 'highpass', from: 2500 + Math.random() * 3500, curve: 1,
                   delay: Math.pow(Math.random(), 0.6) * 0.7 });
    }
  }

  // Hub launch intro (v3.1.3): a 1.7 s rising hum + whoosh as the logo spins up, then a soft bell chime when
  // it stops. Category 'intro' is ON by default; switch off in Sound Settings → Intro spin-up.
  function introSpin() {
    if (muted) return;
    var c = getCtx(); if (!c) return;
    var t = c.currentTime + 0.02, dur = 1.7, o = out(c);
    var osc = c.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(45, t); osc.frequency.exponentialRampToValueAtTime(520, t + dur * 0.85); osc.frequency.exponentialRampToValueAtTime(380, t + dur);
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(200, t); lp.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.85);
    var g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    osc.connect(lp).connect(g).connect(o); osc.start(t); osc.stop(t + dur + 0.3);
    var len = Math.floor(c.sampleRate * (dur + 0.4)), nb = c.createBuffer(1, len, c.sampleRate), nd = nb.getChannelData(0);
    for (var j = 0; j < len; j++) nd[j] = Math.random() * 2 - 1;
    var ns = c.createBufferSource(); ns.buffer = nb;
    var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3200, t + dur * 0.85);
    var ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.07, t + dur * 0.7); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    ns.connect(bp).connect(ng).connect(o); ns.start(t); ns.stop(t + dur + 0.4);
    var bell = [[1318.5, 0.06], [1975.5, 0.045], [2637, 0.03], [3951, 0.018]];
    for (var i = 0; i < bell.length; i++) tone({ type: 'sine', from: bell[i][0], dur: 1.4, vol: bell[i][1], delay: 0.02 + dur * 0.95 + i * 0.045 });
  }

  // ── the rest of the hub launch intro (v3.1.3), same 'intro' switch ──
  function introNoise(c, t, dur) { // looping white noise source, started at t for dur
    var len = Math.floor(c.sampleRate * 1), b = c._introNoise;
    if (!b) { b = c.createBuffer(1, len, c.sampleRate); var d = b.getChannelData(0); for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; c._introNoise = b; }
    var n = c.createBufferSource(); n.buffer = b; n.loop = true; n.start(t, Math.random() * 0.9); n.stop(t + dur); return n;
  }
  function introEnv(c, t, pts) { var g = c.createGain(); g.gain.setValueAtTime(0.0001, t); for (var i = 0; i < pts.length; i++) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, pts[i][1]), t + pts[i][0]); return g; }
  function introTwinkle() { // a few high glints as the name comes into focus
    for (var i = 0; i < 5; i++) tone({ type: 'sine', from: 2600 + Math.random() * 2600, dur: 0.25, vol: 0.016, delay: Math.random() * 0.9 });
  }
  function introPen() { // pen on paper: bright filtered noise in short strokes, ~1.3 s
    if (muted) return; var c = getCtx(); if (!c) return;
    var t = c.currentTime + 0.01, dur = 1.3, g = c.createGain(); g.gain.value = 0.0001;
    var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 0.9;
    var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    introNoise(c, t, dur + 0.1).connect(bp).connect(hp).connect(g).connect(out(c));
    var x = t; while (x < t + dur) { var d = 0.07 + Math.random() * 0.12; g.gain.setTargetAtTime(0.035 + Math.random() * 0.035, x, 0.012); g.gain.setTargetAtTime(0.002, x + d * 0.8, 0.02); bp.frequency.setTargetAtTime(3000 + Math.random() * 2200, x, 0.03); x += d + 0.01 + Math.random() * 0.04; }
    g.gain.setTargetAtTime(0.0001, t + dur, 0.03);
    tone({ type: 'sine', from: 1318.5, dur: 1.2, vol: 0.035, delay: dur + 0.1 }); tone({ type: 'sine', from: 1975.5, dur: 1.2, vol: 0.025, delay: dur + 0.15 });
  }
  function introType() { // the tagline typing out: 28 soft ticks, 40 ms apart (spaces silent)
    var txt = '// POWER WHEN YOU NEED IT //';
    for (var i = 0; i < txt.length; i++) if (txt[i] !== ' ') tone({ type: 'square', from: 1700 + Math.random() * 400, dur: 0.035, vol: 0.012, delay: i * 0.04 });
  }
  function introBlast() { // 1.2 s charge-up buzz with crackle, then the arc: crack, thump, 120 Hz buzz dying away
    if (muted) return; var c = getCtx(); if (!c) return;
    var o = out(c), t = c.currentTime + 0.01, F = 1.2, i, s;
    [120, 240].forEach(function (f, k) { var z = c.createOscillator(); z.type = 'sawtooth'; z.frequency.setValueAtTime(f, t); z.frequency.linearRampToValueAtTime(f * 1.12, t + F);
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1; bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(2400, t + F);
      z.connect(bp).connect(introEnv(c, t, [[F * 0.9, 0.05 / (k + 1)], [F + 0.02, 0.0001]])).connect(o); z.start(t); z.stop(t + F + 0.05); });
    for (s = t; s < t + F; s += (0.03 + Math.random() * 0.08) * (1.2 - (s - t) / F)) { var h = c.createBiquadFilter(); h.type = 'bandpass'; h.frequency.value = 2500 + Math.random() * 3500; h.Q.value = 3;
      introNoise(c, s, 0.015).connect(h).connect(introEnv(c, s, [[0.001, 0.04 + Math.random() * 0.06], [0.014, 0.0001]])).connect(o); }
    var a = t + F;
    var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; introNoise(c, a, 0.09).connect(hp).connect(introEnv(c, a, [[0.002, 0.5], [0.08, 0.0001]])).connect(o);
    var th = c.createOscillator(); th.frequency.setValueAtTime(95, a); th.frequency.exponentialRampToValueAtTime(30, a + 0.55); th.connect(introEnv(c, a, [[0.006, 0.42], [0.6, 0.0001]])).connect(o); th.start(a); th.stop(a + 0.65);
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; introNoise(c, a, 0.5).connect(lp).connect(introEnv(c, a, [[0.01, 0.32], [0.45, 0.0001]])).connect(o);
    [120, 180, 240].forEach(function (f, k) { var z = c.createOscillator(); z.type = 'sawtooth'; z.frequency.value = f; var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8;
      z.connect(bp).connect(introEnv(c, a + 0.01, [[0.01, 0.07 / (k + 1)], [0.3, 0.045 / (k + 1)], [1.3, 0.0001]])).connect(o); z.start(a); z.stop(a + 1.35); });
    for (i = 0; i < 14; i++) { s = a + 0.03 + Math.random() * 0.9; var h2 = c.createBiquadFilter(); h2.type = 'bandpass'; h2.frequency.value = 2500 + Math.random() * 3500; h2.Q.value = 3;
      introNoise(c, s, 0.02).connect(h2).connect(introEnv(c, s, [[0.001, 0.08 + Math.random() * 0.1], [0.018, 0.0001]])).connect(o); }
  }

  function shimmer() { // cosmic / aurora: descending glassy notes
    var f = 2400 + Math.random() * 800;
    for (var i = 0; i < 5; i++) {
      tone({ type: 'sine', from: f * Math.pow(0.84, i), dur: 0.22, vol: 0.03, delay: i * 0.09 });
    }
  }

  function flare() { // solar flare eruption: deep slow whoosh
    noiseBurst({ dur: 1.3, vol: 0.055, filter: 'bandpass', from: 90, to: 480, q: 0.7, curve: 1.2 });
    tone({ type: 'sine', from: 55, to: 90, dur: 1.0, vol: 0.045 });
  }

  function grb() { // gamma ray burst: colossal slow detonation
    boom(0.26);
    tone({ type: 'sine', from: 48, to: 18, dur: 1.6, vol: 0.14, delay: 0.05 });
    noiseBurst({ dur: 1.8, vol: 0.07, from: 300, to: 45, curve: 1.5, delay: 0.3 });
  }

  function arcflash() { // violent electrical blast
    zap(true);
    noiseBurst({ dur: 0.25, vol: 0.16, filter: 'highpass', from: 1200, curve: 2 });
    tone({ type: 'sine', from: 110, to: 35, dur: 0.35, vol: 0.14, delay: 0.01 });
    sizzle();
  }

  function arpN(fs, y, u, v, g, d0) {
    fs.forEach(function (f, i) { tone({ type: y, from: f, dur: u, vol: v, delay: (d0 || 0) + i * g }); });
  }
  var VARIANTS = {
    click: {
      thock: function(){ noiseBurst({dur:.02,vol:.11,filter:'lowpass',from:900,curve:3}); tone({type:'sine',from:250,dur:.04,vol:.08}); },
      knock: function(){ noiseBurst({dur:.03,vol:.14,filter:'lowpass',from:650,curve:3}); tone({type:'sine',from:190,to:120,dur:.05,vol:.09}); },
      classic: function(){ tone({type:'sine',from:880,to:660,dur:.06,vol:.1}); },
      typewriter: function(){ noiseBurst({dur:.025,vol:.12,filter:'bandpass',from:2200,q:1.5,curve:3}); },
      bubble: function(){ tone({type:'sine',from:320,to:950,dur:.07,vol:.1}); },
      waterdrop: function(){ tone({type:'sine',from:950,to:400,dur:.05,vol:.09}); tone({type:'sine',from:480,to:1000,dur:.07,vol:.08,delay:.05}); },
      retro: function(){ tone({type:'square',from:660,dur:.04,vol:.05}); tone({type:'square',from:880,dur:.05,vol:.05,delay:.05}); },
      pluck: function(){ tone({type:'triangle',from:523,to:500,dur:.14,vol:.09}); },
      switch: function(){ noiseBurst({dur:.012,vol:.1,filter:'highpass',from:2500,curve:3}); tone({type:'sine',from:300,dur:.03,vol:.06,delay:.01}); },
      chirpclick: function(){ tone({type:'sine',from:1400,to:2200,dur:.05,vol:.07}); },
      doubletap: function(){ noiseBurst({dur:.015,vol:.1,from:1000,curve:3}); noiseBurst({dur:.015,vol:.08,from:900,curve:3,delay:.07}); },
      softpad: function(){ tone({type:'sine',from:180,dur:.08,vol:.09}); },
      glasstap: function(){ tone({type:'sine',from:2400,to:2300,dur:.06,vol:.06}); },
      zapclick: function(){ noiseBurst({dur:.02,vol:.07,filter:'highpass',from:3500,curve:2}); tone({type:'square',from:2200,to:900,dur:.03,vol:.03}); },
      boing: function(){ tone({type:'sine',from:700,to:280,dur:.06,vol:.08}); tone({type:'sine',from:300,to:620,dur:.08,vol:.07,delay:.06}); },
      keypress: function(){ tone({type:'square',from:1046,dur:.025,vol:.04}); noiseBurst({dur:.012,vol:.06,filter:'highpass',from:2800,curve:3}); },
      pebble: function(){ tone({type:'sine',from:800,to:500,dur:.03,vol:.08}); noiseBurst({dur:.01,vol:.05,from:1200,curve:3}); },
      muffled: function(){ noiseBurst({dur:.04,vol:.12,from:350,curve:3}); },
      hitick: function(){ tone({type:'sine',from:3000,dur:.02,vol:.05}); },
      clack: function(){ tone({type:'triangle',from:1900,dur:.03,vol:.09}); tone({type:'triangle',from:1300,dur:.04,vol:.07,delay:.03}); },
      dew: function(){ tone({type:'sine',from:1200,to:700,dur:.09,vol:.06}); },
      smallping: function(){ tone({type:'sine',from:1568,dur:.09,vol:.06}); },
      buzztap: function(){ tone({type:'square',from:130,dur:.04,vol:.05}); },
      fingersnap: function(){ noiseBurst({dur:.02,vol:.15,filter:'bandpass',from:1600,q:1.2,curve:2}); }
    },
    pop: {
      bubblepop: function(){ tone({type:'sine',from:260,to:1250,dur:.06,vol:.1}); },
      pop: function(){ tone({type:'sine',from:440,to:880,dur:.05,vol:.09}); },
      tick: function(){ noiseBurst({dur:.02,vol:.13,from:1400,curve:3}); },
      blip: function(){ tone({type:'square',from:990,dur:.045,vol:.05}); },
      cork: function(){ noiseBurst({dur:.025,vol:.1,filter:'bandpass',from:800,q:2,curve:3}); tone({type:'sine',from:320,to:160,dur:.06,vol:.08}); },
      marble: function(){ tone({type:'sine',from:1250,to:950,dur:.035,vol:.09}); noiseBurst({dur:.012,vol:.07,filter:'highpass',from:3000,curve:2}); },
      ding: function(){ tone({type:'triangle',from:1568,dur:.28,vol:.06}); },
      snap: function(){ noiseBurst({dur:.018,vol:.13,filter:'highpass',from:2800,curve:2}); },
      clave: function(){ tone({type:'triangle',from:1650,dur:.05,vol:.11}); noiseBurst({dur:.01,vol:.06,filter:'bandpass',from:2200,q:3,curve:3}); },
      boop: function(){ tone({type:'sine',from:520,dur:.07,vol:.1}); },
      kiss: function(){ noiseBurst({dur:.03,vol:.09,filter:'bandpass',from:900,q:2,curve:2}); tone({type:'sine',from:600,to:1100,dur:.04,vol:.07,delay:.02}); },
      latch: function(){ noiseBurst({dur:.015,vol:.11,from:800,curve:3}); noiseBurst({dur:.02,vol:.08,from:500,curve:3,delay:.05}); },
      droppop: function(){ tone({type:'sine',from:900,to:350,dur:.06,vol:.09}); },
      tinybell: function(){ tone({type:'triangle',from:2093,dur:.18,vol:.06}); },
      chirppop: function(){ tone({type:'sine',from:1800,to:2600,dur:.05,vol:.06}); },
      plip: function(){ tone({type:'sine',from:700,to:1400,dur:.04,vol:.08}); },
      knuckle: function(){ noiseBurst({dur:.025,vol:.13,from:450,curve:3}); },
      softsnap: function(){ noiseBurst({dur:.015,vol:.08,filter:'highpass',from:2000,curve:2}); },
      uncork: function(){ tone({type:'sine',from:180,to:520,dur:.09,vol:.1}); noiseBurst({dur:.02,vol:.07,filter:'bandpass',from:700,q:2,curve:3,delay:.07}); },
      pip: function(){ tone({type:'square',from:1319,dur:.03,vol:.04}); },
      taptap: function(){ tone({type:'sine',from:880,dur:.03,vol:.07}); tone({type:'sine',from:1100,dur:.04,vol:.07,delay:.08}); },
      bloopdn: function(){ tone({type:'sine',from:1000,to:420,dur:.08,vol:.08}); },
      stone: function(){ noiseBurst({dur:.03,vol:.12,from:600,curve:2.5}); tone({type:'sine',from:300,to:180,dur:.05,vol:.06}); },
      clickpop: function(){ noiseBurst({dur:.01,vol:.09,filter:'highpass',from:2500,curve:3}); tone({type:'sine',from:500,to:900,dur:.04,vol:.07,delay:.01}); }
    },
    toast: {
      slide: function(){ tone({type:'sine',from:700,to:1400,dur:.25,vol:.07}); tone({type:'sine',from:1400,dur:.15,vol:.05,delay:.24}); },
      harp: function(){ arpN([659,784,988,1319,1568],'triangle',.35,.045,.06); },
      chime: function(){ tone({type:'sine',from:660,to:990,dur:.14,vol:.12}); tone({type:'sine',from:990,to:1320,dur:.12,vol:.1,delay:.1}); },
      doorbell: function(){ tone({type:'sine',from:830,dur:.2,vol:.11}); tone({type:'sine',from:623,dur:.32,vol:.11,delay:.18}); },
      marimba: function(){ arpN([523,659,784],'triangle',.18,.1,.08); },
      glass: function(){ tone({type:'sine',from:2093,dur:.3,vol:.07}); tone({type:'sine',from:2637,dur:.26,vol:.05,delay:.05}); },
      digital: function(){ tone({type:'square',from:990,dur:.06,vol:.045}); tone({type:'square',from:1320,dur:.07,vol:.045,delay:.09}); },
      belltree: function(){ for(var i=0;i<6;i++) tone({type:'triangle',from:1400+i*300,dur:.15,vol:.04,delay:i*.05}); },
      kalimba: function(){ tone({type:'triangle',from:880,dur:.3,vol:.09}); tone({type:'triangle',from:1174,dur:.4,vol:.08,delay:.14}); },
      cosmic: function(){ tone({type:'sine',from:1568,dur:.5,vol:.05}); tone({type:'sine',from:1573,dur:.5,vol:.05}); tone({type:'sine',from:2093,dur:.4,vol:.03,delay:.15}); },
      flute: function(){ tone({type:'sine',from:1046,dur:.4,vol:.06}); tone({type:'sine',from:1052,dur:.4,vol:.04}); },
      musicbox: function(){ arpN([1568,1319,1760],'triangle',.3,.05,.14); },
      zen: function(){ tone({type:'triangle',from:523,dur:.9,vol:.07}); tone({type:'sine',from:527,dur:.9,vol:.04}); },
      steeldrum: function(){ tone({type:'triangle',from:784,to:760,dur:.25,vol:.09}); tone({type:'triangle',from:1175,dur:.2,vol:.05,delay:.02}); },
      churchbell: function(){ tone({type:'triangle',from:660,dur:.6,vol:.08}); tone({type:'triangle',from:880,dur:.5,vol:.05,delay:.3}); },
      rise3: function(){ arpN([659,880,1175],'sine',.14,.08,.11); },
      twonote: function(){ tone({type:'sine',from:784,dur:.14,vol:.08}); tone({type:'sine',from:988,dur:.24,vol:.08,delay:.13}); },
      crystal: function(){ tone({type:'sine',from:2637,dur:.25,vol:.05}); tone({type:'sine',from:3136,dur:.3,vol:.04,delay:.08}); },
      bubbleup: function(){ tone({type:'sine',from:400,to:1200,dur:.18,vol:.08}); },
      celesta: function(){ arpN([1046,1319],'triangle',.35,.07,.1); },
      dingdong: function(){ tone({type:'triangle',from:988,dur:.3,vol:.09}); tone({type:'triangle',from:659,dur:.45,vol:.09,delay:.3}); },
      single: function(){ tone({type:'sine',from:880,dur:.3,vol:.08}); },
      retroarp: function(){ arpN([523,659,784,1046],'square',.06,.035,.06); }
    },
    success: {
      tada: function(){ tone({type:'triangle',from:587,dur:.12,vol:.11}); tone({type:'triangle',from:880,dur:.4,vol:.12,delay:.12}); tone({type:'sine',from:440,dur:.4,vol:.06,delay:.12}); },
      arpeggio: function(){ arpN([523,659,784],'triangle',.12,.12,.09); },
      gentle: function(){ tone({type:'sine',from:660,dur:.2,vol:.08}); tone({type:'sine',from:880,dur:.3,vol:.07,delay:.15}); },
      levelup: function(){ arpN([392,523,659,784,1046],'square',.07,.045,.07); },
      cash: function(){ noiseBurst({dur:.05,vol:.08,filter:'highpass',from:2000,curve:2}); tone({type:'triangle',from:1760,dur:.25,vol:.09,delay:.07}); tone({type:'triangle',from:2093,dur:.3,vol:.07,delay:.14}); },
      choir: function(){ [523,659,784].forEach(function(f){ tone({type:'sine',from:f,dur:.7,vol:.045}); }); tone({type:'sine',from:1046,dur:.7,vol:.03,delay:.1}); },
      chord: function(){ [262,330,392,523].forEach(function(f){ tone({type:'sawtooth',from:f,dur:.45,vol:.03}); }); },
      sparkles: function(){ for(var i=0;i<6;i++) tone({type:'triangle',from:900+i*220,dur:.1,vol:.06,delay:i*.06}); },
      orchestra: function(){ [262,330,392,523,659].forEach(function(f,i){ tone({type:'sawtooth',from:f,dur:.8,vol:.022,delay:i*.02}); tone({type:'sine',from:f,dur:.8,vol:.03,delay:i*.02}); }); },
      coin: function(){ tone({type:'square',from:988,dur:.08,vol:.045}); tone({type:'square',from:1319,dur:.3,vol:.045,delay:.08}); },
      winner: function(){ arpN([659,784,1046],'triangle',.12,.09,.1); tone({type:'triangle',from:1319,dur:.4,vol:.09,delay:.32}); },
      softwin: function(){ tone({type:'sine',from:523,dur:.25,vol:.07}); tone({type:'sine',from:784,dur:.4,vol:.07,delay:.2}); },
      pipeorgan: function(){ [262,392,523,659].forEach(function(f){ tone({type:'sine',from:f,dur:.8,vol:.04}); tone({type:'sine',from:f*2,dur:.8,vol:.015}); }); },
      arcade: function(){ arpN([523,659,784,1046,1319,1568],'square',.05,.035,.05); },
      swell: function(){ tone({type:'sawtooth',from:392,to:523,dur:.6,vol:.05}); tone({type:'sine',from:784,dur:.4,vol:.05,delay:.4}); },
      donedone: function(){ tone({type:'sine',from:659,dur:.1,vol:.09}); tone({type:'sine',from:659,dur:.18,vol:.09,delay:.14}); },
      triumph: function(){ arpN([392,523,659],'sawtooth',.2,.04,.16); tone({type:'sawtooth',from:784,dur:.5,vol:.045,delay:.5}); },
      unlock: function(){ noiseBurst({dur:.02,vol:.1,from:900,curve:3}); tone({type:'sine',from:600,to:1200,dur:.15,vol:.08,delay:.05}); },
      stamp: function(){ noiseBurst({dur:.04,vol:.14,from:500,curve:3}); tone({type:'triangle',from:1568,dur:.25,vol:.07,delay:.1}); },
      harpwin: function(){ arpN([523,659,784,1046,1319,1568],'triangle',.25,.045,.06); },
      bellwin: function(){ tone({type:'triangle',from:1046,dur:.4,vol:.09}); tone({type:'triangle',from:1568,dur:.5,vol:.07,delay:.18}); },
      whistlewin: function(){ tone({type:'sine',from:900,to:1800,dur:.25,vol:.05}); tone({type:'sine',from:1400,to:2200,dur:.3,vol:.05,delay:.25}); },
      quest: function(){ arpN([587,698,784,1175],'square',.09,.04,.1); }
    },
    explosion: {
      deep: function(){ noiseBurst({dur:.05,vol:.28,filter:'lowpass',from:800,curve:1.5}); tone({type:'sine',from:100,to:22,dur:.9,vol:.3,delay:.01}); noiseBurst({dur:1.1,vol:.14,from:900,to:60,curve:2,delay:.03}); noiseBurst({dur:1.2,vol:.08,from:300,to:40,curve:1.6,delay:.35}); },
      realistic: function(){ boom(); },
      distant: function(){ noiseBurst({dur:.9,vol:.12,from:500,to:60,curve:2}); tone({type:'sine',from:70,to:28,dur:.8,vol:.12,delay:.05}); noiseBurst({dur:1.2,vol:.06,from:250,to:45,curve:1.5,delay:.4}); },
      finale: function(){ boom(0.2); setTimeout(function(){ if (allowed('seasonal')) boom(0.22); }, 220 + Math.random()*120); setTimeout(function(){ if (allowed('seasonal')) boom(0.26); }, 500 + Math.random()*150); },
      artillery: function(){ noiseBurst({dur:.045,vol:.32,filter:'highpass',from:400,curve:1}); tone({type:'sine',from:140,to:30,dur:.45,vol:.24,delay:.005}); noiseBurst({dur:.3,vol:.1,from:900,to:100,curve:2,delay:.42}); },
      thunderous: function(){ boom(0.24); setTimeout(function(){ if (allowed('seasonal')) thunder(0.1); }, 300); },
      mortar: function(){ tone({type:'sine',from:65,to:20,dur:1.1,vol:.3}); noiseBurst({dur:.07,vol:.24,from:700,curve:2}); noiseBurst({dur:1.4,vol:.1,from:400,to:50,curve:1.7,delay:.1}); },
      doubleburst: function(){ boom(0.18); setTimeout(function(){ if (allowed('seasonal')) boom(0.22); }, 180); },
      sparkstorm: function(){ noiseBurst({dur:.05,vol:.16,filter:'highpass',from:600,curve:1.5}); for(var i=0;i<60;i++){ var w=.05+Math.pow(Math.random(),.5)*1.8; noiseBurst({dur:.012,vol:.08*(1-w/2),filter:'highpass',from:2000+Math.random()*5000,curve:1,delay:w}); } },
      lowbloom: function(){ tone({type:'sine',from:80,to:30,dur:.8,vol:.2}); noiseBurst({dur:1.6,vol:.08,filter:'bandpass',from:700,to:120,q:.9,curve:1.3,delay:.05}); },
      crackleonly: function(){ for(var i=0;i<35;i++){ var w=Math.pow(Math.random(),.6)*1.3; noiseBurst({dur:.015,vol:.1*(1-w/1.5),filter:'highpass',from:3000+Math.random()*4000,curve:1,delay:w}); } },
      skyrumble: function(){ boom(0.2); noiseBurst({dur:2.2,vol:.07,from:300,to:45,curve:1.4,mod:12,delay:.4}); },
      popcorn: function(){ for(var i=0;i<9;i++){ noiseBurst({dur:.03,vol:.12,filter:'bandpass',from:900+Math.random()*800,q:1.5,curve:2,delay:i*.09+Math.random()*.04}); } }
    },
    thunder: {
      boomer: function(){ tone({type:'sine',from:80,to:22,dur:1.2,vol:.26}); noiseBurst({dur:1.4,vol:.12,from:350,to:45,curve:1.6,delay:.02}); },
      rumble: function(){ thunder(0.13); },
      roll: function(){ thunder(0.09); setTimeout(function(){ if (!muted) thunder(0.065); }, 600 + Math.random()*400); },
      grumble: function(){ noiseBurst({dur:3,vol:.12,from:120,to:40,curve:1.2,mod:14}); tone({type:'sine',from:45,to:25,dur:2.5,vol:.1}); },
      stadium: function(){ noiseBurst({dur:.1,vol:.26,from:900,to:150,curve:1.2}); tone({type:'sine',from:100,to:30,dur:.7,vol:.21}); noiseBurst({dur:2.2,vol:.09,from:500,to:80,curve:1.4,mod:9,delay:.15}); },
      finale3: function(){ [0,.55,1.2].forEach(function(d,i){ tone({type:'sine',from:95-i*12,to:28,dur:.7,vol:.19-i*.04,delay:d}); noiseBurst({dur:.9,vol:.1-i*.02,from:400,to:60,curve:1.7,delay:d+.03}); }); },
      heavy: function(){ tone({type:'sine',from:70,to:24,dur:.9,vol:.28}); noiseBurst({dur:.08,vol:.23,filter:'lowpass',from:600,curve:2}); tone({type:'sine',from:55,to:20,dur:1.1,vol:.18,delay:.45}); noiseBurst({dur:1.5,vol:.09,from:250,to:45,curve:1.5,delay:.5}); },
      ripper: function(){ noiseBurst({dur:1.1,vol:.17,filter:'bandpass',from:1800,to:120,q:1.1,curve:1,mod:40}); tone({type:'sine',from:90,to:28,dur:1.3,vol:.16,delay:.4}); },
      mountain: function(){ noiseBurst({dur:2.6,vol:.09,from:110,to:38,curve:1.3,mod:11,delay:.3}); tone({type:'sine',from:38,to:24,dur:2.2,vol:.08,delay:.35}); },
      growl: function(){ noiseBurst({dur:2.2,vol:.14,from:260,to:60,curve:1.3,mod:34}); tone({type:'sine',from:52,to:30,dur:1.8,vol:.09,delay:.1}); }
    },
    fanfare: {
      victory: function(){ [659,659,659,784,659,784,1046].forEach(function(f,i){ tone({type:'square',from:f,dur:i===6?.45:.09,vol:.05,delay:i*.11}); }); },
      powerup: function(){ tone({type:'square',from:260,to:1046,dur:.4,vol:.04}); [523,659,784,1046].forEach(function(f){ tone({type:'triangle',from:f,dur:.5,vol:.05,delay:.4}); }); },
      drumroll: function(){ for(var i=0;i<14;i++) noiseBurst({dur:.03,vol:.03+i*.005,from:800,curve:2,delay:i*.055}); noiseBurst({dur:.5,vol:.09,filter:'highpass',from:4000,curve:1.5,delay:.8}); [523,659,784].forEach(function(f){ tone({type:'triangle',from:f,dur:.5,vol:.06,delay:.8}); }); },
      jazzy: function(){ arpN([523,659,784,932],'triangle',.45,.05,.09); },
      minimal: function(){ tone({type:'sine',from:784,dur:.15,vol:.08}); tone({type:'sine',from:1046,dur:.4,vol:.08,delay:.14}); },
      classic: function(){ var q=[523,659,784,1046,1318]; q.forEach(function(f,i){ tone({type:'triangle',from:f,dur:i===4?.5:.14,vol:.1,delay:i*.13}); tone({type:'sine',from:f/2,dur:.14,vol:.05,delay:i*.13}); }); },
      horn: function(){ tone({type:'sawtooth',from:349,to:523,dur:.5,vol:.05}); [523,659,784].forEach(function(f){ tone({type:'sawtooth',from:f,dur:.6,vol:.035,delay:.4}); }); },
      sparkle: function(){ for(var i=0;i<9;i++) tone({type:'triangle',from:800+i*180,dur:.12,vol:.05,delay:i*.055}); tone({type:'triangle',from:2400,dur:.5,vol:.06,delay:.55}); },
      royal: function(){ [392,392,392].forEach(function(f,i){ tone({type:'sawtooth',from:f,dur:.11,vol:.045,delay:i*.14}); }); [523,659,784].forEach(function(f){ tone({type:'sawtooth',from:f,dur:.7,vol:.035,delay:.45}); }); },
      chimes: function(){ arpN([2093,1568,1319,1046,784],'triangle',.4,.06,.12); },
      tvgame: function(){ arpN([784,988,1175,1568],'triangle',.12,.07,.09); tone({type:'triangle',from:1568,dur:.4,vol:.07,delay:.4}); },
      retrowin: function(){ arpN([392,523,659,784,659,784,1046],'square',.08,.04,.09); },
      olympic: function(){ [523,523,659,784].forEach(function(f,i){ tone({type:'sawtooth',from:f,dur:i===3?.6:.15,vol:.04,delay:i*.18}); }); },
      bugle: function(){ [392,523,659].forEach(function(f,i){ tone({type:'sawtooth',from:f,dur:.18,vol:.045,delay:i*.17}); }); tone({type:'sawtooth',from:784,dur:.55,vol:.05,delay:.55}); },
      choirfan: function(){ [523,659,784,1046].forEach(function(f){ tone({type:'sine',from:f,dur:.9,vol:.04}); }); tone({type:'sine',from:1319,dur:.8,vol:.03,delay:.25}); },
      cascade: function(){ arpN([523,659,784,1046,1319,1568,2093],'triangle',.25,.045,.07); },
      marimbarun: function(){ arpN([523,587,659,784,880,1046],'triangle',.14,.07,.08); },
      heroic: function(){ tone({type:'sawtooth',from:392,dur:.3,vol:.05}); tone({type:'sawtooth',from:587,dur:.3,vol:.05,delay:.25}); tone({type:'sawtooth',from:784,dur:.6,vol:.055,delay:.5}); },
      quickta: function(){ tone({type:'triangle',from:659,dur:.09,vol:.1}); tone({type:'triangle',from:1046,dur:.3,vol:.1,delay:.09}); },
      regal: function(){ arpN([523,698,880],'triangle',.25,.08,.2); tone({type:'triangle',from:1046,dur:.5,vol:.08,delay:.6}); },
      celebration: function(){ for(var i=0;i<6;i++) tone({type:'triangle',from:1200+Math.random()*1200,dur:.15,vol:.04,delay:i*.07}); [523,659,784].forEach(function(f){ tone({type:'sine',from:f,dur:.5,vol:.05,delay:.45}); }); },
      whistlefan: function(){ tone({type:'sine',from:1000,to:2000,dur:.3,vol:.04}); tone({type:'sawtooth',from:523,dur:.5,vol:.045,delay:.3}); tone({type:'sawtooth',from:659,dur:.5,vol:.04,delay:.3}); },
      drumhit: function(){ for(var i=0;i<6;i++) noiseBurst({dur:.03,vol:.05,from:700,curve:2,delay:i*.06}); noiseBurst({dur:.08,vol:.14,from:400,curve:2,delay:.4}); tone({type:'triangle',from:784,dur:.4,vol:.07,delay:.42}); },
      staircase: function(){ [392,494,587,698,784,988].forEach(function(f,i){ tone({type:'triangle',from:f,dur:.16,vol:.06,delay:i*.1}); tone({type:'triangle',from:f*1.25,dur:.16,vol:.04,delay:i*.1}); }); }
    },
    notify: {
      gentlealarm: function(){ for(var i=0;i<3;i++) tone({type:'sine',from:880,dur:.07,vol:.06,delay:i*.12}); },
      pager: function(){ tone({type:'square',from:1046,dur:.09,vol:.05}); tone({type:'square',from:1046,dur:.09,vol:.05,delay:.15}); },
      doorbell: function(){ tone({type:'sine',from:830,dur:.18,vol:.09}); tone({type:'sine',from:623,dur:.28,vol:.09,delay:.16}); },
      sonar: function(){ tone({type:'sine',from:1150,to:1100,dur:.55,vol:.06}); },
      tritone: function(){ arpN([523,659,880],'sine',.12,.08,.1); },
      ding: function(){ tone({type:'triangle',from:1568,dur:.4,vol:.08}); },
      twinkle: function(){ tone({type:'sine',from:2093,dur:.12,vol:.06}); tone({type:'sine',from:2637,dur:.2,vol:.05,delay:.1}); },
      bounce: function(){ tone({type:'sine',from:600,to:950,dur:.1,vol:.08}); tone({type:'sine',from:950,to:650,dur:.12,vol:.07,delay:.1}); },
      droplet: function(){ tone({type:'sine',from:1000,to:420,dur:.06,vol:.08}); tone({type:'sine',from:500,to:1050,dur:.08,vol:.07,delay:.06}); },
      radio: function(){ noiseBurst({dur:.08,vol:.04,filter:'highpass',from:3000,curve:1}); tone({type:'square',from:1046,dur:.12,vol:.05,delay:.09}); },
      knock2: function(){ noiseBurst({dur:.03,vol:.14,from:600,curve:3}); noiseBurst({dur:.03,vol:.13,from:550,curve:3,delay:.16}); },
      chirpalert: function(){ tone({type:'sine',from:2200,to:2800,dur:.07,vol:.05}); tone({type:'sine',from:2200,to:2800,dur:.07,vol:.05,delay:.14}); },
      marimba2: function(){ tone({type:'triangle',from:988,dur:.2,vol:.09}); tone({type:'triangle',from:784,dur:.3,vol:.09,delay:.15}); },
      cuckoo: function(){ tone({type:'sine',from:1175,dur:.15,vol:.08}); tone({type:'sine',from:932,dur:.25,vol:.08,delay:.2}); },
      submarine: function(){ tone({type:'sine',from:520,to:500,dur:.7,vol:.07}); },
      typeding: function(){ noiseBurst({dur:.015,vol:.08,from:900,curve:3}); tone({type:'triangle',from:2093,dur:.35,vol:.07,delay:.02}); },
      blip2: function(){ tone({type:'square',from:880,dur:.05,vol:.04}); tone({type:'square',from:1175,dur:.06,vol:.04,delay:.1}); },
      attention: function(){ arpN([659,784,988],'sine',.08,.07,.07); },
      softbuzz: function(){ tone({type:'square',from:180,dur:.12,vol:.035}); tone({type:'square',from:180,dur:.12,vol:.035,delay:.18}); },
      harpalert: function(){ tone({type:'triangle',from:1046,dur:.35,vol:.07}); tone({type:'triangle',from:1568,dur:.45,vol:.06,delay:.12}); },
      popalert: function(){ tone({type:'sine',from:500,to:1000,dur:.06,vol:.09}); tone({type:'sine',from:1000,dur:.15,vol:.06,delay:.07}); },
      morse: function(){ tone({type:'sine',from:988,dur:.05,vol:.05}); tone({type:'sine',from:988,dur:.05,vol:.05,delay:.1}); tone({type:'sine',from:988,dur:.18,vol:.05,delay:.2}); },
      phone: function(){ for(var i=0;i<4;i++) tone({type:'square',from:440+((i%2)*40),dur:.05,vol:.035,delay:i*.06}); },
      windup: function(){ tone({type:'sine',from:400,to:1200,dur:.3,vol:.06}); tone({type:'sine',from:1200,dur:.12,vol:.05,delay:.3}); },
      calm: function(){ tone({type:'sine',from:523,dur:.5,vol:.07}); tone({type:'sine',from:659,dur:.5,vol:.05,delay:.05}); }
    }
  };
  // Random: every lightning strike gets a different one of the 10
  VARIANTS.thunder.random = function () {
    var ks = ['boomer','rumble','roll','grumble','stadium','finale3','heavy','ripper','mountain','growl'];
    VARIANTS.thunder[ks[Math.floor(Math.random() * ks.length)]]();
  };
  function pick(name) {
    var v = VARIANTS[name] && (VARIANTS[name][toneChoice[name]] || VARIANTS[name][DEFAULT_TONES[name]]);
    if (!v) { // stale/tampered localStorage — fall back to any variant
      for (var k in VARIANTS[name]) { v = VARIANTS[name][k]; break; }
    }
    if (v) return v();
  }

  function trashSound() { // delete: sci-fi disintegrate (picked by Brandon)
    noiseBurst({ dur: 0.4, vol: 0.08, filter: 'highpass', from: 1500, to: 6000, curve: 1, mod: 50 });
    tone({ type: 'square', from: 600, to: 120, dur: 0.35, vol: 0.03 });
  }
  function copiedSound() { // two quick high ticks — "got it"
    tone({ type: 'sine', from: 1320, dur: 0.05, vol: 0.07 });
    tone({ type: 'sine', from: 1760, dur: 0.07, vol: 0.07, delay: 0.08 });
  }
  function sweepSound() { // clear/reset: fast broom sweep
    noiseBurst({ dur: 0.3, vol: 0.06, filter: 'bandpass', from: 800, to: 2600, q: 1.2, curve: 1 });
    noiseBurst({ dur: 0.25, vol: 0.05, filter: 'bandpass', from: 2600, to: 700, q: 1.2, curve: 1, delay: 0.18 });
  }

  function clunk() { // heavy pipe clank — raceway
    noiseBurst({ dur: 0.03, vol: 0.12, filter: 'lowpass', from: 700, curve: 3 });
    tone({ type: 'triangle', from: 220, to: 180, dur: 0.12, vol: 0.1 });
    tone({ type: 'sine', from: 440, dur: 0.08, vol: 0.04 });
  }
  function tink() { // short bright pipe tap — nipple
    tone({ type: 'triangle', from: 1150, to: 1050, dur: 0.09, vol: 0.1 });
    noiseBurst({ dur: 0.012, vol: 0.06, filter: 'highpass', from: 3000, curve: 3 });
  }

  /* ── CHRISTMAS: cozy one-shots ─────────────────────────────────────── */
  // Small shared room reverb (generated, no files) so voices/bells sound like
  // they're IN a space instead of coming straight out of the speaker.
  function roomVerb(c, secs) {
    var key = '_verb' + secs;
    if (c[key]) return c[key];
    var len = Math.floor(c.sampleRate * secs), buf = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    var cv = c.createConvolver(); cv.buffer = buf;
    var wet = c.createGain(); wet.gain.value = 0.35;
    cv.connect(wet).connect(out(c));
    c[key] = cv;
    return cv;
  }
  /* ── THANKSGIVING: turkey gobble ──────────────────────────────────────
     A REAL recording — a synthesized gobble didn't sound like a turkey. SoundBible #1737 "Turkey
     Gobble" by bod, Public Domain (soundbible.com/1737-Turkey-Gobble.html), trimmed to the 1-second
     gobble, mono 64 kbps, 9 KB — embedded below as REC.gobble.
     Each call: one tom close by, then a second answers from across the field — the same clip a
     little lower, quieter, darker and wetter, panned off to one side (Brandon's pick of the mockup). */
  /* Recorded clips are EMBEDDED in this file (REC, at the bottom — base64 MP3, 42 KB of audio in all):
     no extra files in the repo, nothing extra to download or precache, and they can't go missing
     offline because they arrive with sounds.js itself. Decoded once per audio context and kept on it. */
  var recPending = {};
  function recBuffer(c, name) {
    var key = '_rec_' + name;
    if (c[key]) return Promise.resolve(c[key]);
    if (!recPending[name] || recPending[name].c !== c) {
      var p = new Promise(function (ok, no) {
        var b64 = REC[name]; if (!b64) { no(new Error('no clip ' + name)); return; }
        var bin = atob(b64), u = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        c.decodeAudioData(u.buffer, ok, no);                 // callback form: older iOS Safari
      }).then(function (b) { c[key] = b; delete recPending[name]; return b; },
              function (e) { delete recPending[name]; throw e; });
      recPending[name] = { c: c, p: p };
    }
    return recPending[name].p;
  }
  function gobbleBuffer(c) { return recBuffer(c, 'gobble'); }
  function gobbleOne(c, b, when, far) {
    var t = c.currentTime + when;
    var s = c.createBufferSource(); s.buffer = b;
    s.playbackRate.value = far ? 0.9 + Math.random() * 0.06 : 0.97 + Math.random() * 0.06;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = far ? 2400 : 12000;
    var g = c.createGain(); g.gain.value = far ? 0.12 : 0.3;
    s.connect(lp).connect(g);
    var tail = g;
    if (c.createStereoPanner) { var pn = c.createStereoPanner(); pn.pan.value = (Math.random() * 2 - 1) * (far ? 0.6 : 0.25); g.connect(pn); tail = pn; }
    tail.connect(out(c));
    var wet = c.createGain(); wet.gain.value = far ? 0.55 : 0.12;
    tail.connect(wet).connect(roomVerb(c, 1.8));
    s.start(t);
    setTimeout(function () { try { tail.disconnect(); wet.disconnect(); } catch (e) {} }, (when + 3) * 1000);
  }
  function turkeyGobble() {
    if (muted) return;
    var c = getCtx(); if (!c) return;
    gobbleBuffer(c).then(function (b) {
      if (muted || c !== ctx) return;
      gobbleOne(c, b, 0.02, false);
      gobbleOne(c, b, 1.4 + Math.random() * 0.6, true);
    }).catch(function () {});
  }
  function bellHit(c, t, f, vol, decay, dest) { // one small metal bell: inharmonic partials
    [[1, 1], [2.76, 0.45], [5.4, 0.2]].forEach(function (p) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f * p[0];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * p[1], t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay / p[0] * 1.6);
      o.connect(g).connect(dest); o.start(t); o.stop(t + decay * 1.7);
    });
  }
  function sleighPass() { // a sleigh trots by: bells shake on every hoof-beat, swell, fade away
    if (muted) return;
    var c = getCtx(); if (!c) return;
    var t0 = c.currentTime + 0.05, len = 4.5 + Math.random() * 1.5;
    var bus = c.createGain(); bus.gain.value = 1;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3500, t0); lp.frequency.linearRampToValueAtTime(9000, t0 + len * 0.5);
    lp.frequency.linearRampToValueAtTime(3000, t0 + len);
    bus.connect(lp).connect(out(c)); lp.connect(roomVerb(c, 1.2));
    for (var tb = 0; tb < len; tb += 0.42 + Math.random() * 0.04) {
      var env = Math.pow(Math.sin(Math.PI * tb / len), 1.5);
      var n = 4 + Math.floor(Math.random() * 4);
      for (var k = 0; k < n; k++)
        bellHit(c, t0 + tb + Math.random() * 0.11, 2600 + Math.random() * 2200, 0.028 * env + 0.001, 0.12, bus);
    }
    setTimeout(function () { try { bus.disconnect(); lp.disconnect(); } catch (e) {} }, (len + 2) * 1000);
  }
  function churchChimes() { // distant tower bells ringing down a scale
    if (muted) return;
    var c = getCtx(); if (!c) return;
    var t0 = c.currentTime + 0.05;
    var notes = [784, 698.5, 659.3, 587.3, 523.3]; // G5 F5 E5 D5 C5
    var rounds = 2;
    var bus = c.createGain(); bus.gain.value = 1;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    bus.connect(lp).connect(out(c)); lp.connect(roomVerb(c, 2.5));
    for (var r = 0; r < rounds; r++) notes.forEach(function (f, i) {
      var t = t0 + (r * notes.length + i) * 0.55;
      [[1, 0.02], [2.0, 0.009], [2.4, 0.008], [3.0, 0.005], [0.5, 0.008]].forEach(function (p) {
        var o = c.createOscillator(), g = c.createGain();
        o.frequency.value = f * p[0];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(p[1], t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        o.connect(g).connect(bus); o.start(t); o.stop(t + 2.7);
      });
    });
    setTimeout(function () { try { bus.disconnect(); lp.disconnect(); } catch (e) {} }, 12000);
  }
  function musicBox() { // short ORIGINAL winter tune on a music box (3/4 waltz feel)
    if (muted) return;
    var c = getCtx(); if (!c) return;
    // MIDI notes + beats. Written for this app — not an existing song.
    var tune = [[76,1],[79,1],[81,1],[79,2],[76,1],[74,1],[76,1],[72,3],
                [74,1],[76,1],[79,1],[77,2],[74,1],[72,3]];
    var beat = 0.36, t = c.currentTime + 0.05;
    var bus = c.createGain(); bus.gain.value = 1; bus.connect(out(c)); bus.connect(roomVerb(c, 1.2));
    tune.forEach(function (n) {
      var f = 440 * Math.pow(2, (n[0] + 12 - 69) / 12); // up an octave: tiny comb, bright
      [[1, 0.03, 1.4], [3.9, 0.006, 0.25], [6.3, 0.003, 0.12]].forEach(function (p) {
        var o = c.createOscillator(), g = c.createGain();
        o.frequency.value = f * p[0];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(p[1], t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);
        o.connect(g).connect(bus); o.start(t); o.stop(t + p[2] + 0.05);
      });
      t += n[1] * beat * (0.97 + Math.random() * 0.06); // a little wind-up wobble
    });
    setTimeout(function () { try { bus.disconnect(); } catch (e) {} }, 14000);
  }
  function snowSteps() { // someone crunches past through fresh snow
    if (muted) return;
    var c = getCtx(); if (!c) return;
    var steps = 6 + Math.floor(Math.random() * 3), sr = c.sampleRate;
    for (var s = 0; s < steps; s++) {
      var env = Math.sin(Math.PI * (s + 0.5) / steps);
      var dur = 0.22, len = Math.floor(sr * dur), buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) { // dense random grains = compressed-snow crunch
        var p = i / len, a = Math.pow(Math.sin(Math.PI * Math.pow(p, 0.6)), 2);
        d[i] = (Math.random() < 0.18 ? (Math.random() * 2 - 1) : 0) * a;
      }
      var src = c.createBufferSource(); src.buffer = buf;
      var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 600; f.Q.value = 0.9;
      var g = c.createGain(); g.gain.value = 0.22 * env + 0.01;
      src.connect(f).connect(g).connect(out(c));
      src.start(c.currentTime + 0.05 + s * 0.58 + Math.random() * 0.05);
    }
  }
  function hoHoHo() { // Santa's laugh — formant (vocal-tract) synthesis, three falling "HO"s in a room
    if (muted) return;
    var c = getCtx(); if (!c) return;
    var t0 = c.currentTime + 0.08, sr = c.sampleRate;
    // Vocal tract for "oh": F1..F4 of a big adult male voice, gliding toward "oo"
    var FORM = [[540, 420, 6, 1.0], [860, 760, 8, 0.32], [2450, 2350, 14, 0.07], [3300, 3250, 16, 0.03]];
    var bus = c.createGain(); bus.gain.value = 0.8;
    var warm = c.createBiquadFilter(); warm.type = 'lowshelf'; warm.frequency.value = 220; warm.gain.value = 6; // chest
    bus.connect(warm).connect(out(c)); warm.connect(roomVerb(c, 0.9));
    // breath noise buffer for the "H" and the breathiness under the vowel
    var nb = c.createBuffer(1, sr, sr), nd = nb.getChannelData(0);
    for (var i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;
    // Quick, bouncy rhythm (~0.27s apart) like a real belly laugh; last one held.
    var hos = [{ at: 0.00, p: [118, 128, 100], dur: 0.24, v: 1.0 },
               { at: 0.27, p: [114, 122, 96],  dur: 0.24, v: 0.92 },
               { at: 0.54, p: [108, 114, 84],  dur: 0.42, v: 0.88 }];
    hos.forEach(function (h) {
      var t = t0 + h.at, end = t + h.dur;
      // glottal source: bright sawtooth, softened like real vocal folds
      var src = c.createOscillator(); src.type = 'sawtooth';
      src.frequency.setValueAtTime(h.p[0], t);
      src.frequency.linearRampToValueAtTime(h.p[1], t + h.dur * 0.25);
      src.frequency.exponentialRampToValueAtTime(h.p[2], end);
      var jit = c.createOscillator(), jg = c.createGain(); // natural wobble
      jit.frequency.value = 5.5 + Math.random(); jg.gain.value = 2.2;
      jit.connect(jg).connect(src.frequency);
      var soft = c.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 1800; soft.Q.value = 0.5;
      var vg = c.createGain(); vg.gain.value = 0.0001; // voice envelope: voicing starts after the "h"
      vg.gain.setValueAtTime(0.0001, t);
      vg.gain.setValueAtTime(0.0001, t + 0.04);
      vg.gain.exponentialRampToValueAtTime(0.11 * h.v, t + 0.08);
      vg.gain.setValueAtTime(0.11 * h.v, end - Math.min(0.14, h.dur * 0.4));
      vg.gain.exponentialRampToValueAtTime(0.0001, end);
      src.connect(soft).connect(vg);
      // breath: strong at the start ("H"), faint underneath the vowel
      var br = c.createBufferSource(); br.buffer = nb;
      var bg = c.createGain(); bg.gain.value = 0.0001; // start silent: a default gain of 1 let the
      bg.gain.setValueAtTime(0.0001, t);                // first noise sample through as a click
      bg.gain.exponentialRampToValueAtTime(0.06 * h.v, t + 0.025);
      bg.gain.exponentialRampToValueAtTime(0.006 * h.v, t + 0.09);
      bg.gain.exponentialRampToValueAtTime(0.0001, end);
      br.connect(bg);
      FORM.forEach(function (F) { // parallel formant resonators shape both sources into "HO"
        var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = F[2];
        bp.frequency.setValueAtTime(F[0], t); bp.frequency.linearRampToValueAtTime(F[1], end);
        var fg = c.createGain(); fg.gain.value = F[3] * 5;
        vg.connect(bp); bg.connect(bp); bp.connect(fg).connect(bus);
      });
      var body = c.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 190; // chest buzz (below F1 so they don't cancel)
      var bodyG = c.createGain(); bodyG.gain.value = 0.5;
      vg.connect(body).connect(bodyG).connect(bus);
      src.start(t); jit.start(t); br.start(t);
      src.stop(end + 0.05); jit.stop(end + 0.05); br.stop(end + 0.05);
    });
    setTimeout(function () { try { bus.disconnect(); warm.disconnect(); } catch (e) {} }, 4000);
  }
  /* Recorded Santa laugh — Brandon's pick (Pixabay "santaclaus_hohoho" by freesound_community,
     Pixabay Content License: free for commercial use, no credit required). The source was 19 s with
     three laughs; REC.hohoho is just the first one, 2.7 s, mono 40 kbps, 14 KB. If it ever fails to
     decode, the synthesized laugh below plays instead so Christmas is never silent. */
  function santaHoHoHo() {
    if (muted) return;
    var c = getCtx(); if (!c) return;
    recBuffer(c, 'hohoho').then(function (b) {
      if (muted || c !== ctx) return;
      var s = c.createBufferSource(); s.buffer = b;
      var g = c.createGain(); g.gain.value = 0.8;
      s.connect(g).connect(out(c));
      var wet = c.createGain(); wet.gain.value = 0.12; g.connect(wet).connect(roomVerb(c, 0.9));
      s.start(c.currentTime + 0.02);
      setTimeout(function () { try { g.disconnect(); wet.disconnect(); } catch (e) {} }, 4000);
    }).catch(function () { hoHoHo(); });
  }
  /* Fireplace — rendered once into looping buffers (no timers, no files).
     A real fire is three things layered: a low breathing ROAR, a soft
     HISS of steam, and CRACKLES — sub-millisecond snaps of wildly varying
     loudness that arrive in clusters, plus the odd big POP with a thump.
     Two loops of different lengths (9s / 11.3s) play together so the
     combined crackle pattern only repeats every ~100 seconds. */
  // Built in small slices between frames (never one long block), then handed
  // to done(buffer). Cached on the audio context, so it's only built once.
  function fireBuffer(c, secs, withRoar, done) {
    var key = '_fire' + secs + (withRoar ? 'r' : '');
    if (c[key]) { done(c[key]); return; }
    // Built at 22.05kHz (fire has nothing worth keeping above 11kHz) — half the
    // work, so it's ready in a blink even on older phones. R rescales per-sample constants.
    var sr = 22050, R = 44100 / sr, N = Math.floor(sr * secs), F = Math.floor(sr * 0.5);
    var g = new Float32Array(N + F);
    var brown = 0, lp = 0, slow = 0, slow2 = 0, env = 0.8, envT = 0.8, hissEnv = 0.5, hissT = 0.5, hp = 0, prevW = 0;
    var halfSec = Math.floor(sr * 0.5), hissStep = Math.floor(sr * 0.4);
    var nextCrack = 0, inCluster = 0, nextPop = Math.floor(sr * (1 + Math.random() * 2));
    var i = 0;
    function slice() {
    for (var end = Math.min(N + F, i + 30000); i < end; i++) {
      var w = Math.random() * 2 - 1, v = 0;
      if (withRoar) {
        if (i % halfSec === 0) envT = 0.55 + Math.random() * 0.45; // flames breathe (slowly)
        env += (envT - env) * 0.00008 * R;
        brown = brown * (1 - 0.015 * R) + w * 0.06 * Math.sqrt(R); // deep rumble
        lp += (brown - lp) * 0.08 * R;
        slow += (lp - slow) * 0.025 * R;                                // cut the sub-rumble (<~175Hz)
        var hr = lp - slow; slow2 += (hr - slow2) * 0.025 * R; hr -= slow2; // second stage: steeper cut
        // hiss level drifts SMOOTHLY — it used to jump ~11 times a second,
        // which chopped the sound and made the fire seem to skip
        if (i % hissStep === 0) hissT = 0.25 + Math.random() * 0.75;
        hissEnv += (hissT - hissEnv) * 0.0003 * R;
        hp = w - prevW; prevW = w;                                  // bright steam hiss
        v += hr * 0.5 * env + hp * 0.012 * hissEnv;               // soft whoosh, not a rumble
      }
      if (i >= nextCrack) {                                         // crackle event
        var amp = 0.08 + 0.92 * Math.pow(Math.random(), 3);         // mostly small, some loud
        // a snap: a sharp tick that rings briefly in the wood at a random pitch
        var len = Math.floor((80 + Math.random() * 260) / R);
        var wf = 2 * Math.PI * (1200 + Math.random() * 3800) / sr, r = 0.88 + Math.random() * 0.09;
        var c1 = 2 * r * Math.cos(wf), c2 = r * r, y1 = 0, y2 = 0;
        for (var k = 0; k < len && i + k < N + F; k++) {
          var x = (k < 2 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * 0.15 * Math.exp(-k * R / 20)) * amp;
          var y = x + c1 * y1 - c2 * y2; y2 = y1; y1 = y;
          g[i + k] += y * 0.35 + (k < 3 ? x * 0.6 : 0);
        }
        if (inCluster > 0) { inCluster--; nextCrack = i + Math.floor(sr * (0.004 + Math.random() * 0.03)); }
        else {
          inCluster = Math.random() < 0.35 ? 2 + Math.floor(Math.random() * 6) : 0; // bursts of snaps
          nextCrack = i + Math.floor(sr * (0.03 + Math.random() * 0.35));
        }
      }
      if (!withRoar && i >= nextPop) {                              // big pop: a loud wood CRACK
        // (No low thump — a short thud + click is exactly what a skipping CD
        //  sounds like. A real log pop is a bright, ringing snap.)
        var pa = 0.7 + Math.random() * 0.3, pw = 2 * Math.PI * (700 + Math.random() * 1100) / sr;
        var pr = 0.965, p1 = 2 * pr * Math.cos(pw), p2 = pr * pr, q1 = 0, q2 = 0, plen = Math.floor(sr * 0.05);
        for (var q = 0; q < plen && i + q < N + F; q++) {
          var px = (q < 3 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * 0.2 * Math.exp(-q / (sr * 0.004))) * pa;
          var py = px + p1 * q1 - p2 * q2; q2 = q1; q1 = py;
          g[i + q] += py * 0.25 + (q < 3 ? px * 0.8 : 0);
        }
        inCluster = 3 + Math.floor(Math.random() * 5);               // embers fizz right after
        nextCrack = i + Math.floor(sr * 0.02);
        nextPop = i + Math.floor(sr * (2 + Math.random() * 5));
      }
      g[i] += v;
    }
    if (i < N + F) { setTimeout(slice, 0); return; }
    var buf = c.createBuffer(1, N, sr), d = buf.getChannelData(0), pk = 0;
    for (var j = 0; j < N; j++) {                                   // seamless loop: fade tail into head
      d[j] = j < F ? g[j] * Math.sqrt(j / F) + g[N + j] * Math.sqrt(1 - j / F) : g[j];
      if (Math.abs(d[j]) > pk) pk = Math.abs(d[j]);
    }
    for (j = 0; j < N; j++) d[j] /= (pk || 1);
    c[key] = buf;
    done(buf);
    }
    slice();
  }
  function fireLoop(buf, vol, lpHz) {
    var c = ctx;
    var src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpHz;
    var g = c.createGain(), t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 1.5); // ease the fire in
    src.connect(f).connect(g).connect(out(c)); src.start();
    amb.nodes.push(src, f, g);
  }


  /* ================= PRESETS ================= */

  var RAW = {
    click:   function () { pick('click'); },
    hover:   function () { tone({ type: 'sine', from: 1200, dur: 0.03, vol: 0.04 }); },
    toast:   function () { pick('toast'); },
    success: function () { pick('success'); },
    error:   function () { tone({ type: 'square', from: 220, to: 140, dur: 0.22, vol: 0.09 }); },
    welcome: function () { whoosh(0.4, 0.06);
                           tone({ type: 'sine', from: 440, to: 880, dur: 0.3, vol: 0.08, delay: 0.05 }); },
    whoosh:  function () { whoosh(); },
    pulse:   function () { tone({ type: 'sine', from: 200, to: 60, dur: 0.4, vol: 0.06 }); },
    explosion: function () { pick('explosion'); },
    launch:  launchWhistle,
    introSpin: introSpin, introTwinkle: introTwinkle, introPen: introPen, introType: introType, introBlast: introBlast,
    thunder: function () { pick('thunder'); },
    boltStrike: function () { // homepage lightning: crack now, rumble after
      zap(true);
      setTimeout(function () { if (allowed('animations')) pick('thunder'); }, 250 + Math.random() * 500);
    },
    zap:     function () { zap(false); },
    zapBig:  function () { zap(true); },
    ping:    ping,
    powerDown: powerDown,
    jingle:  jingle,
    bell:    bell,
    chirp:   chirp,
    harp:    harp,
    wind:    windGust,
    owl:     owlHoot,
    moan:    ghostMoan,
    toll:    churchToll,
    creak:   doorCreak,
    howl:    wolfHowl,
    sleigh:  sleighPass,
    chimes:  churchChimes,
    musicbox: musicBox,
    snowsteps: snowSteps,
    hohoho:  santaHoHoHo,
    gobble:  turkeyGobble,
    shutter: shutter,
    pop:     function () { pick('pop'); },
    fanfare: function () { pick('fanfare'); },
    tick:    tick,
    result:  function () { tone({ type: 'sine', from: 660, to: 880, dur: 0.09, vol: 0.07 });
                           tone({ type: 'sine', from: 880, dur: 0.1, vol: 0.06, delay: 0.08 }); },
    notify:  function () { pick('notify'); },
    online:  function () { tone({ type: 'sine', from: 440, to: 660, dur: 0.12, vol: 0.08 });
                           tone({ type: 'sine', from: 660, to: 880, dur: 0.12, vol: 0.08, delay: 0.11 }); },
    ignite: ignite,
    trip: trip,
    surge: surge,
    sizzle: sizzle,
    shimmer: shimmer,
    flare: flare,
    grb: grb,
    arcflash: arcflash,
    clunk:  clunk,
    tink:   tink,
    trash:  trashSound,
    copied: copiedSound,
    sweep:  sweepSound,
    offline: function () { tone({ type: 'sine', from: 660, to: 440, dur: 0.12, vol: 0.08 });
                           tone({ type: 'sine', from: 440, to: 280, dur: 0.15, vol: 0.08, delay: 0.11 }); }
  };

  // Haptic patterns (ms on/off). Android Chrome supports navigator.vibrate;
  // iPhones do not expose it to web apps, so iOS stays sound-only.
  var VIB = {
    click: 8, hover: 0, tick: 5, introSpin: 0, introTwinkle: 0, introPen: 0, introType: 0, introBlast: 0, pop: 12, result: 15, copied: [10, 40, 10],
    toast: [20, 60, 20], notify: [30, 60, 30], online: [15, 50, 15], offline: [40, 60, 40],
    success: [20, 50, 20, 50, 40], error: [60, 40, 60], fanfare: [30, 60, 30, 60, 30, 60, 80],
    explosion: [10, 20, 120], launch: 20, boltStrike: [15, 30, 90], thunder: 120,
    zap: 10, zapBig: 35, trip: [30, 30, 50], trash: [15, 40, 30], sweep: 25,
    shutter: [12, 30, 12], clunk: 30, tink: 10, welcome: [15, 40, 25],
    arcflash: [20, 20, 80], grb: [20, 30, 200], powerDown: [80, 60, 40], surge: 40,
    ignite: 15, ping: 12, pulse: 30,
    // Background ambience never vibrates the phone
    wind: 0, owl: 0, moan: 0, toll: 0, creak: 0, howl: 0,
    sleigh: 0, chimes: 0, musicbox: 0, snowsteps: 0, hohoho: 0, jingle: 0, gobble: 0
  };
  function buzz(k) {
    if (!navigator.vibrate) return;
    var p = VIB[k];
    if (p === undefined) p = 10;
    if (p) { try { navigator.vibrate(p); } catch (e) {} }
  }

  var S = {};
  // The tap that UNLOCKS audio would normally be silent (engine not running
  // yet when the sound fires). Queue it and replay the moment we go live.
  var pendingSound = null;
  function flushPending() {
    if (!pendingSound) return;
    var p = pendingSound; pendingSound = null;
    if (Date.now() - p.t < 1500 && S[p.k]) S[p.k]();
  }
  Object.keys(RAW).forEach(function (k) {
    S[k] = function () {
      verifyAlive(); // self-heal a zombie context; if frozen, it rebuilds so the NEXT tap plays
      if (!allowed(CATS[k] || 'taps')) {  return; }
      
      var deferred = false;
      if (mode !== 'vibrate' && ctx && ctx.state !== 'running') {
        pendingSound = { k: k, t: Date.now() }; // replay once unlocked
        deferred = true;
        try { ctx.resume().then(flushPending).catch(function () {}); } catch (e) {}
      }
      // Skip the immediate play when deferred — it was a silent no-op that
      // still allocated buffers on a frozen graph.
      if (mode !== 'vibrate' && !deferred) RAW[k]();
      
      if (mode !== 'sound') buzz(k);
    };
  });

  /* ================= AMBIENT LOOPS ================= */
  // Continuous quiet beds: rain, wind, hum (60Hz electrical), engine, drone

  // (amb is declared at the top of the file — see note there)

  function stopAmbient() {
    // Fade gain nodes to zero over ~60ms before stopping sources — a hard
    // stop() mid-waveform produces an audible click/pop on scene changes.
    amb.playingKey = null;
    var nodes = amb.nodes; amb.nodes = [];
    amb.timers.forEach(clearTimeout);
    amb.timers = [];
    var t = (ctx && ctx.state === 'running') ? ctx.currentTime : 0;
    var faded = false;
    nodes.forEach(function (n) {
      if (t && n.gain && n.gain.setTargetAtTime) {
        try {
          n.gain.setTargetAtTime(0, t, 0.02);
          faded = true;
        } catch (e) {}
      }
    });
    function kill() {
      nodes.forEach(function (n) {
        try { if (n.stop) n.stop(); } catch (e) {}
        try { n.disconnect(); } catch (e) {} // release gains/filters too, not just sources
      });
    }
    if (faded) setTimeout(kill, 120); else kill();
  }

  function noiseLoopNode(filter, freq, q, vol, wobble) {
    var c = ctx;
    var len = c.sampleRate * 2;
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    var f = c.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
    var g = c.createGain(); g.gain.value = vol;
    if (wobble) { // slow LFO on filter freq for wind
      var lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 0.13; lg.gain.value = freq * 0.5;
      lfo.connect(lg).connect(f.frequency); lfo.start();
      amb.nodes.push(lfo, lg);
    }
    src.connect(f).connect(g).connect(out(c));
    src.start();
    amb.nodes.push(src, f, g); // filter tracked too, so teardown disconnects it
  }

  function oscLoopNode(type, freq, vol) {
    var c = ctx;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g).connect(out(c)); o.start();
    amb.nodes.push(o, g);
  }

  // Cooling fan: broadband air noise with a gentle blade-pass flutter (AM on
  // the gain) and a very faint motor tone. Distinct from 'hum'/'engine' which
  // are tonal — a fan is mostly moving-air noise.
  function fanLoopNode() {
    var c = ctx;
    var len = c.sampleRate * 2;
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600; f.Q.value = 0.5;
    var g = c.createGain(); g.gain.value = 0.05;
    // Blade-pass flutter: ~22Hz amplitude wobble, shallow depth
    var lfo = c.createOscillator(), lg = c.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 22; lg.gain.value = 0.013;
    lfo.connect(lg).connect(g.gain); lfo.start();
    src.connect(f).connect(g).connect(out(c));
    src.start();
    // lg tracked so the fade zeros the LFO depth too — otherwise the flutter
    // keeps riding on top of the faded gain and pulses during teardown
    amb.nodes.push(src, f, g, lfo, lg);
    // Faint motor whir underneath
    oscLoopNode('triangle', 95, 0.009);
  }

  // Engine idle: the defining trait is the firing-pulse LOPE — a rhythmic
  // amplitude throb (~13Hz) on a rough low tone, plus intake/exhaust noise.
  // A steady sawtooth with no modulation just reads as electrical hum.
  function engineLoopNode() {
    var c = ctx;
    // Rough rumble: sawtooth through a lowpass, gain pulsed by the firing LFO
    var o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 82;
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.9;
    var g = c.createGain(); g.gain.value = 0.026;
    var lfo = c.createOscillator(), lg = c.createGain();
    lfo.type = 'triangle'; lfo.frequency.value = 13; lg.gain.value = 0.016; // deep throb
    lfo.connect(lg).connect(g.gain); lfo.start();
    o.connect(f).connect(g).connect(out(c)); o.start();
    amb.nodes.push(o, f, g, lfo, lg); // lg tracked: fade must zero the throb depth or the fade itself pulses
    // Second harmonic so it carries on phone speakers
    var o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 164;
    var g2 = c.createGain(); g2.gain.value = 0.012;
    lg.connect(g2.gain); // pulses in sync with the rumble
    o2.connect(g2).connect(out(c)); o2.start();
    amb.nodes.push(o2, g2);
    // Intake/exhaust noise bed
    noiseLoopNode('lowpass', 260, 0.6, 0.02);
  }

  // Rain: the old version was two steady filtered-noise beds — i.e. TV
  // static. What makes rain read as rain: (1) a darker wash whose density
  // slowly shifts (gusting), (2) individual droplet transients on top —
  // mostly noisy ticks (drops on pavement/leaves) with the occasional
  // pitched plink (drops on water/metal). Droplet one-shots self-stop, so
  // only the scheduler timer needs tracking; stopAmbient's timer clear
  // halts new drops and any in-flight ones end within ~100ms of the fade.
  var dropBuf = null;
  function rainLoopNode() {
    var c = ctx;
    // Downpour roar: a heavy low rumble under a broader, louder wash.
    // Pouring rain is mostly this dense white roar — the drops sit on top.
    noiseLoopNode('lowpass', 400, 0.6, 0.05);           // low rumble floor
    noiseLoopNode('lowpass', 1800, 0.5, 0.055, true);   // main wash, gust swells
    // Sheeting-water sizzle — much more present than a light shower
    noiseLoopNode('highpass', 5000, 1, 0.018);
    // Shared 60ms decaying-noise burst reused by every noise-tick droplet
    if (!dropBuf || dropBuf.sampleRate !== c.sampleRate) {
      var len = (c.sampleRate * 0.06) | 0;
      dropBuf = c.createBuffer(1, len, c.sampleRate);
      var dd = dropBuf.getChannelData(0);
      for (var i = 0; i < len; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    function tick() {
      var t = c.currentTime, n = 5 + Math.floor(Math.random() * 6);
      for (var i = 0; i < n; i++) {
        var at = t + Math.random() * 0.05;
        if (Math.random() < 0.8) {
          // Noise tick: drop hitting pavement/leaves. Randomized band + rate
          // so no two ticks sound alike — identical ticks read as clicking.
          var s = c.createBufferSource(); s.buffer = dropBuf;
          s.playbackRate.value = 0.7 + Math.random() * 0.9;
          var f = c.createBiquadFilter(); f.type = 'bandpass';
          f.frequency.value = 1800 + Math.random() * 3500; f.Q.value = 2.5;
          var g = c.createGain(); g.gain.value = 0.02 + Math.random() * 0.03;
          s.connect(f).connect(g).connect(out(c));
          s.start(at);
        } else {
          // Pitched plink: drop on water — quick downward pitch bend
          var o = c.createOscillator(); o.type = 'sine';
          var f0 = 900 + Math.random() * 2200;
          o.frequency.setValueAtTime(f0, at);
          o.frequency.exponentialRampToValueAtTime(f0 * 0.55, at + 0.025);
          var pg = c.createGain();
          pg.gain.setValueAtTime(0.012 + Math.random() * 0.012, at);
          pg.gain.exponentialRampToValueAtTime(0.0001, at + 0.05 + Math.random() * 0.05);
          o.connect(pg).connect(out(c));
          o.start(at); o.stop(at + 0.12);
        }
      }
      amb.timers.push(setTimeout(tick, 35 + Math.random() * 30));
    }
    tick();
  }

  var LOOPS = {
    rain:   rainLoopNode,
    wind:   function () { noiseLoopNode('bandpass', 320, 0.7, 0.08, true); noiseLoopNode('bandpass', 900, 0.8, 0.02, true); },
    hum:    function () { // weighted toward harmonics — 60Hz alone is inaudible on phone/laptop speakers
              oscLoopNode('sine', 60, 0.02); oscLoopNode('sine', 120, 0.022);
              oscLoopNode('triangle', 180, 0.014); oscLoopNode('sine', 240, 0.009); },
    engine: engineLoopNode,
    // Drafting room: soft paper/air room tone — a barely-there mid-band wash,
    // no electrical character. Used by blueprint (was wrongly on 'hum').
    paper:  function () { noiseLoopNode('lowpass', 1400, 0.7, 0.011); noiseLoopNode('bandpass', 3000, 0.6, 0.004); },
    // Sub-bass foundation kept for systems that can reproduce it, but small
    // laptop/phone speakers can't play 42–126 Hz at all — the drone scenes
    // (aurora g5, black hole, ion storm...) were silent on them. Added mid
    // harmonics (168/252 Hz, quiet) plus a faint slow-breathing airy noise
    // wash so the bed is audible everywhere without changing its character.
    drone:  function () {
      oscLoopNode('sine', 42, 0.03); oscLoopNode('sine', 84, 0.02); oscLoopNode('sine', 126, 0.01);
      oscLoopNode('sine', 168, 0.008); oscLoopNode('sine', 252, 0.005);
      noiseLoopNode('bandpass', 900, 0.8, 0.012, true); // wobbling filtered air — the "shimmer"
    },
    fire:   function () { noiseLoopNode('lowpass', 1100, 0.6, 0.045); noiseLoopNode('highpass', 3200, 1, 0.016); },
    arcbuzz:function () { oscLoopNode('sawtooth', 110, 0.011); noiseLoopNode('highpass', 3000, 1, 0.009); },
    fan:    fanLoopNode,
    // Halloween bed: two notes a half-step apart BEAT against each other (the
    // classic horror-film unease), an octave up so phone speakers can play it,
    // under a low wobbling night wind. Kept just above silence.
    haunt:  function () {
      oscLoopNode('sine', 110, 0.010); oscLoopNode('sine', 116.5, 0.009);
      oscLoopNode('sine', 220, 0.007); oscLoopNode('sine', 233.1, 0.006);
      noiseLoopNode('bandpass', 280, 0.7, 0.018, true);
    },
    /* Thanksgiving bed: a STEADY autumn wind that slowly builds and eases (Brandon, Nov 21 2026 — the
       old "silence, then a 2-3 s gust that snaps on" felt off). Brown-ish noise (smoother than white —
       sounds like air, not hiss) through a broad low band, plus a narrow higher "whistle" band that only
       comes up when it blows hard. Every few seconds the wind picks a new speed (mostly gentle, now and
       then a stronger swell) and glides there over 4-8 s: faster = louder + a little higher. Fades in
       over 3 s; never stops, never hits. Level = the 50% chosen in the mockup. */
    autumnwind: function () {
      var c = ctx, t = c.currentTime, sr = c.sampleRate, key = amb.playingKey;
      var buf = c._autumnNoise;
      if (!buf) {
        var n = Math.floor(sr * 6); buf = c.createBuffer(1, n, sr); var d = buf.getChannelData(0), l = 0;
        for (var i = 0; i < n; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; }
        c._autumnNoise = buf;
      }
      var master = c.createGain(); master.gain.setValueAtTime(0.0001, t); master.gain.linearRampToValueAtTime(0.45, t + 3);
      master.connect(out(c));
      var s1 = c.createBufferSource(); s1.buffer = buf; s1.loop = true;
      var f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 0.5; f1.frequency.value = 260;
      var g1 = c.createGain(); g1.gain.value = 0.05;
      s1.connect(f1).connect(g1).connect(master);
      var s2 = c.createBufferSource(); s2.buffer = buf; s2.loop = true; s2.loopStart = 1.3; s2.loopEnd = 5.7;
      var f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 3; f2.frequency.value = 700;
      var g2 = c.createGain(); g2.gain.value = 0;
      s2.connect(f2).connect(g2).connect(master);
      s1.start(t); s2.start(t, 2.1);
      amb.nodes.push(s1, s2, f1, f2, g1, g2, master);
      function glide(p, v, now, ramp) { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(v, now + ramp); }
      function step() {
        if (amb.playingKey !== key || ctx !== c) return;              // theme changed or context rebuilt
        var now = c.currentTime;
        var sp = Math.random() < 0.25 ? 0.75 + Math.random() * 0.25 : 0.15 + Math.random() * 0.45;
        var ramp = 4 + Math.random() * 4;
        glide(g1.gain, 0.035 + 0.075 * sp, now, ramp);
        glide(f1.frequency, 200 + 260 * sp, now, ramp);
        glide(g2.gain, 0.03 * sp * sp, now, ramp);
        glide(f2.frequency, 550 + 500 * sp, now, ramp);
        amb.timers.push(setTimeout(step, (ramp + 1 + Math.random() * 3) * 1000));
      }
      step();
    },
    // Winter bed: a soft, cold wind under the window — quieter than Halloween's
    winterwind: function () { noiseLoopNode('bandpass', 520, 0.6, 0.010, true); noiseLoopNode('bandpass', 1400, 0.9, 0.003, true); },
    // Christmas bed: a fire in the hearth (low roar + crackle pops) with a soft
    // winter wind outside the window.
    hearth: function () {
      noiseLoopNode('bandpass', 420, 0.6, 0.004, true);  // faint wind outside (starts at once)
      var key = amb.playingKey, c = ctx;                  // fire joins a moment later, once built —
      function add(vol, lp) {                             // unless the scene changed meanwhile
        return function (buf) { if (amb.playingKey === key && ctx === c) fireLoop(buf, vol, lp); };
      }
      fireBuffer(c, 9, true, add(0.16, 10000));           // whoosh + hiss + crackle
      fireBuffer(c, 11.3, false, add(0.15, 8000));        // more crackle + the odd pop
      /* Sleigh bells, looping quietly on top (Brandon's pick: Pixabay "christmas sleigh bells
         jingling" by dragon-studio, Pixabay Content License). REC.bells is exactly six
         shakes (0.3336 s each = 2.0016 s), cut on the beat and cross-faded into what precedes it, with
         0.3 s of the loop's own tail/head padded on either side — so loopStart/loopEnd land inside
         periodic audio and the join stays seamless even if a decoder shifts the MP3 by its priming
         delay. 19 KB. Level = the 30% Brandon chose in the mockup. */
      recBuffer(c, 'bells').then(function (b) {
        if (amb.playingKey !== key || ctx !== c) return;
        var s = c.createBufferSource(); s.buffer = b; s.loop = true;
        s.loopStart = 0.30; s.loopEnd = 0.30 + 6 * 0.3336;
        var g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.18, c.currentTime + 1.5);   // ease in, never a sudden jingle
        s.connect(g).connect(out(c));
        s.start(c.currentTime + 0.02, 0.30);
        amb.nodes.push(s, g);
      }).catch(function () {});
    }
  };

  function scheduleOccasional(name, minMs, maxMs) {
    function go() {
      if (S[name]) S[name]();
      amb.timers.push(setTimeout(go, minMs + Math.random() * (maxMs - minMs)));
    }
    amb.timers.push(setTimeout(go, minMs * 0.4 + Math.random() * minMs));
  }

  /* ---- Homepage canvas themes → sound profile ---- */
  var SCENES = {
    'lightning':      {},                                    // bolt strikes hooked to visuals
    'tesla':          {},                                    // arcs hooked
    'plasma':         { loop: 'hum' },
    'emp':            {},                                    // pulses hooked
    'powergrid':      { loop: 'hum' },
    'voltage':        { loop: 'hum' },                       // spikes hooked
    'rain':           { loop: 'rain' },                      // bolts hooked
    'hurricane':      { loop: 'wind' },                      // bolts hooked
    'fog':            { loop: 'wind' },                      // bolts hooked
    'supercell':      { loop: 'wind' },                      // bolts hooked
    'matrix':         { occ: [['tick', 400, 900]] },
    'sonar':          {},                                    // ping synced to sweep
    'blueprint':      { loop: 'paper', occ: [['tick', 1800, 4500]] }, // drafting room + pencil strokes (was 'hum' — mains buzz fit electrical scenes, not a drawing)
    'solarflare':     { loop: 'fire' },                      // eruptions hooked — continuous plasma roar underneath (was silent between eruptions)
    'lichtenberg':    {},                                    // figures hooked
    'aurora g5':      { loop: 'drone' },                     // bursts hooked
    'tornado alley':  { loop: 'wind', occ: [['wind', 5000, 11000]] },
    'power lines':    { loop: 'hum' },                       // bolts + arcs hooked
    'xfmr explosion': { loop: 'hum' },                       // blasts hooked
    'engine cutaway': { loop: 'engine' },                    // ignition hooked
    'elec fire':      { loop: 'fire', occ: [['sizzle', 900, 2200]] },
    'solar wind':     { loop: 'wind' },
    'cosmic ray':     {},                                    // showers hooked
    'magnetosphere':  { loop: 'drone' },
    'pulsar':         { occ: [['ping', 1300, 1900]] },
    'faraday cage':   {},                                    // strikes hooked
    'oscilloscope':   { loop: 'hum' },
    'jacobs ladder':  { loop: 'arcbuzz' },
    'emf field lines':{ loop: 'hum' },                       // bolts hooked
    'substation':     { loop: 'hum' },                       // coronas + arcs hooked
    'underground cable': { loop: 'hum' },
    'switchgear trip':{ loop: 'hum' },                       // trips hooked
    'van de graaff':  { loop: 'hum' },                       // arcs + discharge hooked
    'ball lightning': { occ: [['zap', 2500, 6000]] },
    'black hole':     { loop: 'drone' },
    'ion storm':      { loop: 'drone' },                     // bolts hooked
    'gamma ray burst':{},                                    // bursts hooked
    'power outage':   { once: 'powerDown' },                 // flicker sparks hooked
    'synapse':        {},                                    // neuron firing hooked
    'grid goes down': { once: 'powerDown' },                 // node failures hooked
    'combustion':     { loop: 'engine' },                    // ignition hooked
    'cooling fan':    { loop: 'fan' },
    'battery charge': { occ: [['result', 6000, 12000]] },
    'three-phase':    { loop: 'hum' },
    'circuit traces': { occ: [['tick', 600, 1400]] },
    'arc flash':      {},                                    // blasts hooked
    'strike on grid': {},                                    // strikes + surges hooked
    'ice storm':      { loop: 'wind' },
    'solar eclipse':  { loop: 'drone' },
    'thermal scan':   { occ: [['ping', 3000, 6000]] }
  };

  /* ---- Seasonal form-page themes → sound profile ---- */
  var SEASONS = {
    fourthofjuly: {},                                        // engine calls explosion/launch itself
    halloween:    { loop: 'haunt', occ: [['wind', 9000, 18000], ['creak', 22000, 45000], ['owl', 28000, 55000],
                                       ['moan', 35000, 70000], ['toll', 60000, 120000], ['thunder', 45000, 90000],
                                       ['howl', 50000, 110000]] },
    christmas:    { loop: 'hearth', occ: [['hohoho', 15000, 20000], ['snowsteps', 40000, 80000], ['musicbox', 45000, 90000],
                                        ['chimes', 60000, 120000]] },   // sleigh bells now loop in 'hearth'
    newyear:      { occ: [['explosion', 9000, 20000], ['fanfare', 30000, 70000]] },
    fall:         { occ: [['wind', 8000, 18000]] },
    winter:       { loop: 'winterwind', occ: [['wind', 12000, 24000], ['snowsteps', 50000, 100000]] },
    thanksgiving: { loop: 'autumnwind', occ: [['gobble', 30000, 60000]] },   // steady, swelling wind (no more snap-on gusts)
    spring:       { occ: [['chirp', 5000, 12000]] },
    easter:       { occ: [['chirp', 6000, 14000]] },
    summer:       { occ: [['chirp', 9000, 18000]] },
    valentines:   { occ: [['harp', 12000, 25000]] },
    stpatricks:   { occ: [['harp', 10000, 22000]] },
    backtoschool: { occ: [['bell', 20000, 45000]] }
  };

  function applyScene() {
    if (held) return;   // launch intro on screen — the bed starts when it finishes
    // Resolve the target profile FIRST so an unchanged scene is a no-op.
    // applyScene is re-triggered constantly (window focus, pageshow,
    // visibilitychange, ANY body class mutation) and used to tear down and
    // rebuild the loops every time — an audible split-second dropout.
    var profile = null, key = null;
    if (ready()) {
      if (amb.scene && SCENES[amb.scene]) { profile = SCENES[amb.scene]; key = 'scene:' + amb.scene; }
      if (!profile) { // form pages: read seasonal class off <body>
        var m = (document.body && document.body.className || '').match(/seasonal-([a-z]+)/);
        if (m && SEASONS[m[1]]) { profile = SEASONS[m[1]]; key = 'season:' + m[1]; }
      }
      if (profile) {
        var cat = (key.indexOf('scene:') === 0) ? 'animations' : 'seasonal';
        // Battery saver (battery-saver.js): no ambient background loops; taps and alerts still play
        if (!allowed(cat) || mode === 'vibrate' || (window.AOGSaver && window.AOGSaver.on)) { profile = null; key = null; }
        else key += '|' + mode; // mode change must rebuild
      }
    }
    // Same profile already live (nodes or timers still armed)? Leave it be.
    if (key && amb.playingKey === key && (amb.nodes.length || amb.timers.length)) {
      unduck(); // still make sure the bus isn't ducked
      return;
    }
    stopAmbient();
    if (!profile) return;
    unduck(); // never start a scene into a ducked/zeroed master bus
    amb.playingKey = key;
    try {
      if (profile.loop && LOOPS[profile.loop]) LOOPS[profile.loop]();
      if (profile.once && S[profile.once]) S[profile.once]();
      if (profile.occ) profile.occ.forEach(function (o) { scheduleOccasional(o[0], o[1], o[2]); });
    } catch (e) {
      // A broken loop must never propagate into the theme cycler (it calls
      // AOGSound.scene() synchronously — an exception here stopped the theme
      // from rendering at all). Ambience degrades to silence instead.
      stopAmbient();
    }
  }

  // Seasonal class can be added by page scripts after load — watch for it
  function watchBodyClass() {
    if (!document.body || !window.MutationObserver) return;
    new MutationObserver(function () { if (ready()) applyScene(); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.body) watchBodyClass();
  else document.addEventListener('DOMContentLoaded', watchBodyClass);

  // Restart ambience on return. (Stopping on hide is handled by the main
  // visibilitychange handler above, which fades BEFORE suspending — calling
  // stopAmbient here as well ran after the context froze and caused pops.)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { sceneStarted = false; startRetryLoop(); }
  });

  /* ================= AUTO EVENT HOOKS ================= */

  // CSS animations → sounds
  var animationSounds = { toastIn: 'toast', welcomeIn: 'welcome' };
  document.addEventListener('animationstart', function (e) {
    var n = animationSounds[e.animationName];
    if (n && S[n]) S[n]();
  });

  // Clicks — plus a "result" chime on export/save/send-style buttons
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest('button, a, [role="button"], select');
    if (!el) return;
    // Per-button sound: <button data-sound="tink"> (or data-sound on a container
    // to cover every button inside it). Pages never call AOGSound.play() for taps —
    // they label the button and this one handler plays it. data-sound="none" = silent.
    var tagged = el.closest('[data-sound]');
    if (tagged) {
      var nm = tagged.getAttribute('data-sound');
      if (nm !== 'none' && S[nm]) S[nm]();
      return;
    }
    S.click();
    var sig = (el.id + ' ' + el.className + ' ' + (el.textContent || '').slice(0, 60)).toLowerCase();
    // Is this button inside a confirmation popup? (custom modals like the
    // Estimate sheet's Clear dialog, or any role="dialog" overlay)
    var inDialog = el.closest('[role="dialog"], [aria-modal="true"], .confirm-modal, .confirm-modal-backdrop, #themed-confirm-overlay');
    if (/\bclear\b|\breset\b|start over/.test(sig)) {
      // Confirming inside a popup → delete noise now.
      // Opening the popup (or a no-confirm clear button) → stay quiet;
      // native confirm() dialogs are handled by the confirm override.
      if (inDialog) S.trash();
    }
    else if (/delete|remove|trash|\ud83d\uddd1/.test(sig)) S.trash();
    else if (/\bok\b|\byes\b/.test(sig) && inDialog) S.trash();
    else if (/copy|clipboard/.test(sig)) S.copied();
    else if (/\bcalculate\b|\bcalc-btn\b/.test(sig)) S.clunk();
    else if (/pdf|export|download|save|print|submit|send/.test(sig)) S.result();
  }, { passive: true });

  // Checkboxes: pop on check; fanfare when a page's checklist hits 100%
  var fanfared = false;
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.matches) return;
    if (t.matches('input[type="checkbox"], input[type="radio"]')) {
      if (t.checked) S.pop(); else if (allowed('forms')) tone({ type: 'sine', from: 700, to: 420, dur: 0.05, vol: 0.06 });
      if (t.type === 'checkbox') {
        // Only count VISIBLE checkboxes — hidden toggles (settings panels,
        // template rows) made "100% complete" unreachable or false-positive
        var allBoxes = document.querySelectorAll('input[type="checkbox"]');
        var boxes = [];
        for (var bi = 0; bi < allBoxes.length; bi++) {
          if (allBoxes[bi].offsetParent !== null || allBoxes[bi] === t) boxes.push(allBoxes[bi]);
        }
        if (boxes.length >= 4) {
          var all = true;
          for (var i = 0; i < boxes.length; i++) if (!boxes[i].checked) { all = false; break; }
          if (all && !fanfared) { fanfared = true; setTimeout(S.fanfare, 150); }
          if (!all) fanfared = false;
        }
      }
      return;
    }
    if (t.matches('select')) { S.tick(); return; }
    if (t.matches('input[type="number"]')) { S.result(); return; }
    if (t.matches('input[type="file"]')) { S.shutter(); return; }
  }, true);

  // Soft tick while typing numbers into the calculators
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"], input[type="range"]')) S.tick();
  }, true);

  // Confirm dialogs: hitting OK on a destructive confirm plays the delete noise
  var nativeConfirm = window.confirm ? window.confirm.bind(window) : null;
  if (nativeConfirm) {
    window.confirm = function (msg) {
      var ok = nativeConfirm(msg);
      if (ok && /clear|delete|remove|reset|cannot be undone|new job|start over/i.test(String(msg || ''))) {
        S.trash();
      }
      return ok;
    };
  }

  // Required-field validation failure → error buzz (one per burst)
  var lastInvalid = 0;
  document.addEventListener('invalid', function () {
    var now = Date.now();
    if (now - lastInvalid < 600) return;
    lastInvalid = now;
    S.error();
  }, true);

  // TRUE CLOSE (swipe-away / navigation): no time for automation — zero the
  // master bus instantly so the OS session teardown doesn't clip mid-wave.
  // pageshow/focus/applyScene all call unduck(), so a bfcache restore (which
  // resumes the SAME page state, gain still 0) recovers immediately.
  window.addEventListener('pagehide', function () {
    try { if (ctx && ctx._masterGain) ctx._masterGain.gain.value = 0; } catch (e) {}
  });
  window.addEventListener('pageshow', function (e) {
    if (e && e.persisted) unduck(); // bfcache restore — same ctx, gain was zeroed
  });

  // Connectivity
  window.addEventListener('online',  function () { S.online();  });
  window.addEventListener('offline', function () { S.offline(); });

  /* ============ THEMED CONFIRM DIALOG (all forms) ============ */
  // AOGConfirm('message', {title, confirmText, cancelText}) -> Promise<boolean>
  // The confirm button is caught by the in-dialog click matcher above,
  // so the delete noise plays exactly when the user confirms.
  window.AOGConfirm = function (message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      // Seasonal flair for the title, keyed off the page's seasonal class
      var flair = '';
      var m = (document.body && document.body.className || '').match(/seasonal-([a-z]+)/);
      if (m) {
        flair = ({ fourthofjuly: '\uD83C\uDF86 ', halloween: '\uD83C\uDF83 ', christmas: '\uD83C\uDF84 ',
                   newyear: '\uD83C\uDF89 ', valentines: '\uD83D\uDC96 ', stpatricks: '\uD83C\uDF40 ',
                   spring: '\uD83C\uDF38 ', easter: '\uD83D\uDC23 ', summer: '\u2600\uFE0F ',
                   fall: '\uD83C\uDF42 ', winter: '\u2744\uFE0F ', thanksgiving: '\uD83E\uDD83 ', backtoschool: '\uD83D\uDCDA ' })[m[1]] || '';
      }

      var back = document.createElement('div');
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(3px);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
      var card = document.createElement('div');
      // Built entirely from the page's theme variables: --panel/--text flip with
      // light/dark mode, --cyan/--amber/--border-bright recolor with each
      // seasonal theme. Fallbacks keep it usable on any page missing a var.
      card.style.cssText = 'background:var(--panel, var(--bg2, #0f172a));border:1px solid var(--border-bright, rgba(251,191,36,.4));border-radius:14px;max-width:340px;width:100%;padding:20px;box-shadow:var(--glow, 0 20px 60px rgba(0,0,0,.5));font-family:var(--font-body, inherit);';
      var h = document.createElement('div');
      h.textContent = flair + (opts.title || '\u26A0 CLEAR ALL FIELDS');
      h.style.cssText = 'font-family:var(--font-display, inherit);font-weight:800;font-size:.9rem;letter-spacing:2px;color:var(--cyan, #fbbf24);margin-bottom:10px;';
      var p = document.createElement('div');
      p.textContent = message || '';
      p.style.cssText = 'font-size:.85rem;color:var(--text-muted, #94a3b8);line-height:1.5;margin-bottom:18px;';
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
      function done(ok) {
        if (back.parentNode) back.parentNode.removeChild(back);
        document.removeEventListener('keydown', onKey);
        resolve(ok);
      }
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = opts.cancelText || 'Cancel';
      cancel.style.cssText = 'padding:9px 16px;border-radius:8px;font-size:.82rem;cursor:pointer;border:1px solid var(--border, #334155);background:transparent;color:var(--text, #cbd5e1);font-family:var(--font-body, inherit);';
      cancel.addEventListener('click', function () { done(false); });
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = opts.confirmText || 'Clear';
      ok.style.cssText = 'padding:9px 18px;border-radius:8px;font-size:.82rem;font-weight:700;cursor:pointer;border:none;background:var(--amber, var(--cyan, #fbbf24));color:var(--bg, #0f172a);font-family:var(--font-body, inherit);';
      ok.addEventListener('click', function () { done(true); });
      function onKey(e) { if (e.key === 'Escape') done(false); }
      back.addEventListener('click', function (e) { if (e.target === back) done(false); });
      document.addEventListener('keydown', onKey);
      row.appendChild(cancel); row.appendChild(ok);
      card.appendChild(h); card.appendChild(p); card.appendChild(row);
      back.appendChild(card);
      document.body.appendChild(back);
      ok.focus();
    });
  };


  /* ================= PUBLIC API ================= */

  // Scene queued by the hub's inline theme script (which runs before this
  // deferred file): MUST be picked up BEFORE the retry loop starts. On
  // desktop with autoplay granted, goLive() fires immediately — grabbing the
  // scene afterwards meant applyScene ran with no scene, marked itself done,
  // and the queued theme (aurora g5, black hole, ...) never played at load.
  if (window.__aogPendingScene) { amb.scene = window.__aogPendingScene; window.__aogPendingScene = null; }
  startRetryLoop(); // zero-tap start attempt — everything above is now defined

  // Battery saver turned on / off: stop or bring back the ambient loops right away
  if (window.AOGSaver) window.AOGSaver.onChange(function () { try { applyScene(); } catch (e) {} });

  if (held) window.AOGIntro.onDone(function () { held = false; sceneStarted = false; tryStart(); });

  window.AOGSound = {
    version: 'v1.0.9',
    play: function (name) { if (S[name]) S[name](); },
    // Force-play for the Sound Settings panel: taps must always be audible,
    // even for 'animations' sounds (fireworks/thunder) that preview mode
    // silences to stop background bleed. Still respects master mute + mode.
    // Test/diagnostic hook: which embedded recordings have decoded on the live audio context.
    // Test/diagnostic hook: which background bed is playing and how many audio nodes it holds.
    _ambStatus: function () { return { key: amb.playingKey, nodes: amb.nodes.length, timers: amb.timers.length }; },
    _recStatus: function () { var c = ctx || {}; return { gobble: !!c._rec_gobble, hohoho: !!c._rec_hohoho, bells: !!c._rec_bells }; },
    previewPlay: function (name) {
      if (!RAW[name]) return;
      if (mode !== 'vibrate') RAW[name]();
      if (mode !== 'sound') buzz(name);
    },
    scene: function (name) { amb.scene = name; sceneStarted = false; tryStart(); },
    toggleMute: function () {
      muted = !muted;
      lsSet('aog-sound-muted', muted ? '1' : '0');
      if (muted) stopAmbient();
      else { sceneStarted = false; tryStart(); }
      return muted;
    },
    isMuted: function () { return muted; },
    // Calls back true if audio is (or within `ms` becomes) actually running — the installed desktop app and
    // browsers that allow sound before a tap — and false where the phone/browser is still holding it back.
    // Used by the hub's launch intro so it plays its sound where it can, and never queues it for a later tap.
    whenRunning: function (ms, cb) {
      var done = false; function fin(ok) { if (!done) { done = true; cb(ok); } }
      if (muted || mode === 'vibrate') return fin(false);
      var c = getCtx(); if (!c) return fin(false);
      if (c.state === 'running') return fin(true);
      try { var p = c.resume(); if (p && p.then) p.then(function () { fin(c.state === 'running'); }, function () { fin(false); }); } catch (e) {}
      setTimeout(function () { fin(c.state === 'running'); }, ms || 300);
    },
    previewMode: function (on) {
      preview = !!on;
      if (preview) stopAmbient();
      else { sceneStarted = false; tryStart(); }
    },
    getMode: function () { return mode; },
    setMode: function (m) {
      if (m !== 'sound' && m !== 'vibrate' && m !== 'both') return;
      mode = m;
      lsSet('aog-sound-mode', mode);
      stopAmbient(); sceneStarted = false; tryStart();
    },
    canVibrate: function () { return !!navigator.vibrate; },
    getTones: function () { var o = {}; for (var k in toneChoice) o[k] = toneChoice[k]; return o; },
    setTone: function (name, variant) {
      if (VARIANTS[name] && VARIANTS[name][variant]) {
        toneChoice[name] = variant;
        lsSet('aog-sound-tones-v4', JSON.stringify(toneChoice));
      }
    },
    getPrefs: function () { var o = { master: !muted }; for (var k in prefs) o[k] = prefs[k]; return o; },
    setPref: function (key, on) {
      if (key === 'master') {
        if (!!on === !muted) return;
        muted = !on;
        lsSet('aog-sound-muted', muted ? '1' : '0');
        if (muted) stopAmbient(); else { sceneStarted = false; tryStart(); }
        return;
      }
      prefs[key] = !!on;
      lsSet('aog-sound-prefs', JSON.stringify(prefs));
      // restart or stop ambience to reflect animation/seasonal changes
      stopAmbient(); sceneStarted = false; tryStart();
    },
    mapAnimation: function (a, s) { animationSounds[a] = s; }
  };

  /* ================= EMBEDDED RECORDINGS (base64 MP3) =================
     gobble — SoundBible #1737 "Turkey Gobble" by bod, Public Domain. 1 s, mono 64 kbps, 9 KB.
     hohoho — Pixabay "santaclaus_hohoho" (freesound_community), Pixabay Content License. 2.7 s, 14 KB.
     bells  — Pixabay "christmas sleigh bells jingling" (dragon-studio), Pixabay Content License.
              2.6 s file = 0.3 s pad + 6-shake loop (0.30 → 2.3016 s) + 0.3 s pad, 19 KB. */
  var REC = {
    gobble: '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sAX/atX9IpA+ycmwbYmIwSeG2S1MJtDV5pJdiwIBhgEBhwCwCLUS5HgECDgECDhhSiXIlEi1EiiRaiRall/8omRJLIlqJFqK/9HKjrNMrGVjf///8F/go4OODjg43//7UsTqAAuwhykGaMWJjpRkQaSOUfxgUYFHBCFEJuowGTCejzSpIosSvK7sSdrIsaaKJhLbMA0Jf/moklFwlLa3lt/5yU1slBVmo5/3IwS3lR6B5xEATivyp///+4UYBb3ARKfyqGFf0UBbmQKJTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQACQQRUPZYRonqrTkvJ3LuPO5WZu6fFUpGaM9ahpeny18z7rTdIL89W20+z//tSxOcCy6BZHqykzIlslWKBh41ZNP7623c/ssqxBIzmRkac/I0ERp///NisqkVKnF2Hu3oRSIi6Cax0gR7HNjV5/9jJVZdhlZZMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LE6IALwUj6B5hPwVApWaRii8BVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsTSA8whSHBGBTyIAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=',
    hohoho: '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',
    bells: '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MNFlHqDwFAi//LnPBz9NqAuQyQqQAAEA1AAAAAACADRgUyl4A9C0UySxmhkasQITdT9wtv4O0unDf/BbiRHsOIeS6/6kUhwj6QP/xzF4YwyjYlTfr1/zZk0QtwXISYBzCZ///mygboTYW4ggyQW42LqS/SSq//oIJnNdZUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVV//tAxOMAChlddeYMr1Eoou58wwmKVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+0LE5gAJ9V935LBD0VwirT6YUABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+0LE44ANmUdV+RaACAAANIOAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU='
  };
})();
