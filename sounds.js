/* ============================================================
   AOG Sound Engine v1.0.8 — drop-in UI + ambient sounds (no files)
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

  var ctx = null;
  var muted = localStorage.getItem('aog-sound-muted') === '1';
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
  var DEFAULT_PREFS = { taps: true, animations: true, seasonal: true, forms: true, alerts: true };
  var prefs;
  try { prefs = JSON.parse(localStorage.getItem('aog-sound-prefs')) || {}; } catch (e) { prefs = {}; }
  for (var pk in DEFAULT_PREFS) if (typeof prefs[pk] !== 'boolean') prefs[pk] = DEFAULT_PREFS[pk];
  // Output mode: 'sound' | 'vibrate' | 'both'
  var mode = localStorage.getItem('aog-sound-mode') || 'sound';
  if (mode !== 'sound' && mode !== 'vibrate' && mode !== 'both') mode = 'sound';
  var preview = false; // true while the Sound Settings panel is open
  function allowed(cat) {
    if (muted) return false;
    if (preview && (cat === 'animations' || cat === 'seasonal')) return false;
    return prefs[cat] !== false;
  }

  // Selectable tone styles for the most audible sounds (hub Sound Panel)
  var DEFAULT_TONES = { click: 'thock', toast: 'slide', pop: 'bubblepop', success: 'tada', explosion: 'deep', notify: 'gentlealarm', fanfare: 'victory', thunder: 'random' };
  var toneChoice;
  try { toneChoice = JSON.parse(localStorage.getItem('aog-sound-tones-v4')) || {}; } catch (e) { toneChoice = {}; }
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
    pop:'forms', fanfare:'forms', result:'forms', shutter:'forms',
    trash:'forms', copied:'forms', sweep:'forms', clunk:'taps', tink:'taps'
  };

  function getCtx() {
    // iOS 17+ Audio Session API — HYBRID strategy (see setSession below):
    // 'playback' is the only type that reliably ACTIVATES the audio session
    // on a cold standalone-PWA launch (with 'ambient' the whole session —
    // WebAudio AND <audio> elements — stays frozen until an app-switcher
    // round-trip). But 'playback' bypasses the ringer/silent switch. So we
    // use 'playback' only while kick-starting the session, then flip to
    // 'ambient' the moment the clock is confirmed ticking.
    // MUSIC-FRIENDLY ESCALATION: default to 'ambient', which MIXES with
    // whatever the user is already playing (Music, podcasts). 'playback'
    // is non-mixable — the moment we touch it, iOS PAUSES the user's music
    // and never resumes it. So 'playback' is now a last resort: only used
    // (sessionForce=true) after a gesture-driven kick left the clock
    // frozen, and handed back to 'ambient' the moment the clock ticks.
    // AMBIENT ONLY — 'playback' escalation removed entirely. 'playback' is
    // non-mixable and was pausing the user's music (Music/Spotify/Pandora).
    // 'ambient' mixes with everything and respects the ringer switch. Cost:
    // on the buggy iOS cold-launch dead-session case, sound may need an
    // app-switcher round-trip to wake up — acceptable; music is sacred.
    if (IS_IOS) setSession('ambient'); // no-op elsewhere — skip the work on desktop/Android
    if (ctx && ctx.state === 'closed') ctx = null; // rebuilt after zombie teardown
    if (!ctx && !hadGesture) {  return null; }
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
  // DO NOT create a context at load. On some iOS builds, creating an
  // AudioContext before ANY user touch wedges the app's entire audio system
  // for its lifetime — every context (even later gesture-born ones) stays
  // frozen at 0.00 until the app is backgrounded. Creation is deferred to
  // the first gesture.
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
    if (sceneStarted || muted) return;
    
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
    try {
      if (!sessionEl) {
        sessionEl = new Audio(SILENT_WAV);
        sessionEl.setAttribute('playsinline', '');
        sessionEl.loop = true;
        sessionEl.volume = 0.01;
        ['playing', 'pause', 'suspend', 'stalled', 'error', 'ended'].forEach(function (ev) {
          sessionEl.addEventListener(ev, function () {
            
          });
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
    if (hadGesture && ctx._bornAt && Date.now() - ctx._bornAt > 1500) {
      // A gesture happened, the polite 'ambient' kick ran, and the clock is
      // STILL frozen 1.5s later — this is the genuine cold-launch dead
      // session. NOW escalate to 'playback' (this will pause the user's
      // music, unavoidable on the buggy builds) until the clock ticks.
      
      
      try { ctx.close(); } catch (e) {}
      ctx = null; sceneStarted = false; pipedCtx = null;
      var c = getCtx(); // fresh context; getCtx() resumes non-running states
      if (c && c.state !== 'running') { try { c.resume().catch(function () {}); } catch (e) {} }
      activateSession(); // re-pipe the looper element through the new ctx
    }
  }, 250);
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
        if (sessionEl) { try { sessionEl.play().catch(function(){}); } catch (e) {} }
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
    // Re-arm the looper: a previously-allowed element may resume without a
    // fresh gesture; if iOS blocks it, the next tap's unlock handles it.
    if (sessionEl) {
      try { var pv = sessionEl.play(); if (pv && pv.catch) pv.catch(function () {}); } catch (e) {}
    }
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
    click: 8, hover: 0, tick: 5, pop: 12, result: 15, copied: [10, 40, 10],
    toast: [20, 60, 20], notify: [30, 60, 30], online: [15, 50, 15], offline: [40, 60, 40],
    success: [20, 50, 20, 50, 40], error: [60, 40, 60], fanfare: [30, 60, 30, 60, 30, 60, 80],
    explosion: [10, 20, 120], launch: 20, boltStrike: [15, 30, 90], thunder: 120,
    zap: 10, zapBig: 35, trip: [30, 30, 50], trash: [15, 40, 30], sweep: 25,
    shutter: [12, 30, 12], clunk: 30, tink: 10, welcome: [15, 40, 25],
    arcflash: [20, 20, 80], grb: [20, 30, 200], powerDown: [80, 60, 40], surge: 40,
    ignite: 15, ping: 12, pulse: 30
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
      // Scene-aware remap: the voltage theme fires success() on its spikes,
      // which plays the user's success tone (Mario coin, tada, ...) — a UI
      // reward sound, wrong for an electrical event. Reroute to zap here so
      // the theme file doesn't need touching.
      if (k === 'success' && amb.scene === 'voltage') { S.zap(); return; }
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

  var LOOPS = {
    rain:   function () { noiseLoopNode('bandpass', 3800, 0.4, 0.05); noiseLoopNode('lowpass', 500, 0.5, 0.020); },
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
      noiseLoopNode(900, 0.012, true); // wobbling filtered air — the "shimmer"
    },
    fire:   function () { noiseLoopNode('lowpass', 1100, 0.6, 0.045); noiseLoopNode('highpass', 3200, 1, 0.016); },
    arcbuzz:function () { oscLoopNode('sawtooth', 110, 0.011); noiseLoopNode('highpass', 3000, 1, 0.009); },
    fan:    fanLoopNode
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
    halloween:    { occ: [['wind', 6000, 14000], ['thunder', 20000, 45000]] },
    christmas:    { occ: [['jingle', 8000, 18000]] },
    newyear:      { occ: [['explosion', 9000, 20000], ['fanfare', 30000, 70000]] },
    fall:         { occ: [['wind', 8000, 18000]] },
    thanksgiving: { occ: [['wind', 10000, 20000]] },
    spring:       { occ: [['chirp', 5000, 12000]] },
    easter:       { occ: [['chirp', 6000, 14000]] },
    summer:       { occ: [['chirp', 9000, 18000]] },
    valentines:   { occ: [['harp', 12000, 25000]] },
    stpatricks:   { occ: [['harp', 10000, 22000]] },
    backtoschool: { occ: [['bell', 20000, 45000]] }
  };

  function applyScene() {
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
        if (!allowed(cat) || mode === 'vibrate') { profile = null; key = null; }
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
    if (profile.loop && LOOPS[profile.loop]) LOOPS[profile.loop]();
    if (profile.once && S[profile.once]) S[profile.once]();
    if (profile.occ) profile.occ.forEach(function (o) { scheduleOccasional(o[0], o[1], o[2]); });
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
                   fall: '\uD83C\uDF42 ', thanksgiving: '\uD83E\uDD83 ', backtoschool: '\uD83D\uDCDA ' })[m[1]] || '';
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



  /* ================= DEBUG OVERLAY v2 ================= */
  // Goal: pinpoint WHY cold-launch audio is silent until an app-switcher
  // round-trip. Key diagnostics:
  //   graphRMS  — analyser on the master bus. >0 means WebAudio IS rendering
  //               samples. If graphRMS>0 during a beep but you HEAR nothing,
  //               the block is the OS audio session, not WebAudio.
  //   EL BEEP   — audible beep via an HTML <audio> element (a totally
  //               separate audio path). If EL BEEP is audible while TEST
  //               BEEP is silent, WebAudio specifically is blocked. If BOTH
  //               are silent, the whole app audio session is dead.
  //   COPY LOG  — copies the FULL event history to the clipboard so you can
  //               paste it back for analysis.
  

  // Scene queued by the hub's inline theme script (which runs before this
  // deferred file): MUST be picked up BEFORE the retry loop starts. On
  // desktop with autoplay granted, goLive() fires immediately — grabbing the
  // scene afterwards meant applyScene ran with no scene, marked itself done,
  // and the queued theme (aurora g5, black hole, ...) never played at load.
  if (window.__aogPendingScene) { amb.scene = window.__aogPendingScene; window.__aogPendingScene = null; }
  startRetryLoop(); // zero-tap start attempt — everything above is now defined

  window.AOGSound = {
    version: 'v1.0.8',
    play: function (name) { if (S[name]) S[name](); },
    // Force-play for the Sound Settings panel: taps must always be audible,
    // even for 'animations' sounds (fireworks/thunder) that preview mode
    // silences to stop background bleed. Still respects master mute + mode.
    previewPlay: function (name) {
      if (!RAW[name]) return;
      if (mode !== 'vibrate') RAW[name]();
      if (mode !== 'sound') buzz(name);
    },
    scene: function (name) { amb.scene = name; sceneStarted = false; tryStart(); },
    toggleMute: function () {
      muted = !muted;
      localStorage.setItem('aog-sound-muted', muted ? '1' : '0');
      if (muted) stopAmbient();
      else { sceneStarted = false; tryStart(); }
      return muted;
    },
    isMuted: function () { return muted; },
    previewMode: function (on) {
      preview = !!on;
      if (preview) stopAmbient();
      else { sceneStarted = false; tryStart(); }
    },
    getMode: function () { return mode; },
    setMode: function (m) {
      if (m !== 'sound' && m !== 'vibrate' && m !== 'both') return;
      mode = m;
      localStorage.setItem('aog-sound-mode', mode);
      stopAmbient(); sceneStarted = false; tryStart();
    },
    canVibrate: function () { return !!navigator.vibrate; },
    getTones: function () { var o = {}; for (var k in toneChoice) o[k] = toneChoice[k]; return o; },
    setTone: function (name, variant) {
      if (VARIANTS[name] && VARIANTS[name][variant]) {
        toneChoice[name] = variant;
        localStorage.setItem('aog-sound-tones-v4', JSON.stringify(toneChoice));
      }
    },
    getPrefs: function () { var o = { master: !muted }; for (var k in prefs) o[k] = prefs[k]; return o; },
    setPref: function (key, on) {
      if (key === 'master') {
        if (!!on === !muted) return;
        muted = !on;
        localStorage.setItem('aog-sound-muted', muted ? '1' : '0');
        if (muted) stopAmbient(); else { sceneStarted = false; tryStart(); }
        return;
      }
      prefs[key] = !!on;
      localStorage.setItem('aog-sound-prefs', JSON.stringify(prefs));
      // restart or stop ambience to reflect animation/seasonal changes
      stopAmbient(); sceneStarted = false; tryStart();
    },
    mapAnimation: function (a, s) { animationSounds[a] = s; }
  };
})();
