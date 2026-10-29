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
  var DEFAULT_PREFS = { taps: true, animations: true, seasonal: true, forms: true, alerts: true };
  var prefs;
  try { prefs = JSON.parse(lsGet('aog-sound-prefs')) || {}; } catch (e) { prefs = {}; }
  for (var pk in DEFAULT_PREFS) if (typeof prefs[pk] !== 'boolean') prefs[pk] = DEFAULT_PREFS[pk];
  // Output mode: 'sound' | 'vibrate' | 'both'
  var mode = lsGet('aog-sound-mode') || 'sound';
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
    if (hadGesture && ctx._bornAt && Date.now() - ctx._bornAt > 800) recycleCtx();
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
    hohoho:  hoHoHo,
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
    ignite: 15, ping: 12, pulse: 30,
    // Background ambience never vibrates the phone
    wind: 0, owl: 0, moan: 0, toll: 0, creak: 0, howl: 0,
    sleigh: 0, chimes: 0, musicbox: 0, snowsteps: 0, hohoho: 0, jingle: 0
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
    christmas:    { loop: 'hearth', occ: [['sleigh', 25000, 50000], ['snowsteps', 40000, 80000], ['musicbox', 45000, 90000],
                                        ['chimes', 60000, 120000], ['hohoho', 70000, 150000]] },
    newyear:      { occ: [['explosion', 9000, 20000], ['fanfare', 30000, 70000]] },
    fall:         { occ: [['wind', 8000, 18000]] },
    winter:       { loop: 'winterwind', occ: [['wind', 12000, 24000], ['snowsteps', 50000, 100000]] },
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

  window.AOGSound = {
    version: 'v1.0.9',
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
      lsSet('aog-sound-muted', muted ? '1' : '0');
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
})();
