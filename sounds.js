/* ============================================================
   AOG Sound Engine v2 — drop-in UI + ambient sounds (no files)
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

  // Per-category sound preferences (controlled by the hub Sound Panel)
  var DEFAULT_PREFS = { taps: true, animations: true, seasonal: true, forms: true, alerts: true };
  var prefs;
  try { prefs = JSON.parse(localStorage.getItem('aog-sound-prefs')) || {}; } catch (e) { prefs = {}; }
  for (var pk in DEFAULT_PREFS) if (typeof prefs[pk] !== 'boolean') prefs[pk] = DEFAULT_PREFS[pk];
  function allowed(cat) { return !muted && prefs[cat] !== false; }

  // Selectable tone styles for the most audible sounds (hub Sound Panel)
  var DEFAULT_TONES = { click: 'thock', toast: 'slide', pop: 'bubblepop', success: 'tada', explosion: 'realistic', notify: 'gentlealarm', fanfare: 'victory', thunder: 'boomer' };
  var toneChoice;
  try { toneChoice = JSON.parse(localStorage.getItem('aog-sound-tones-v3')) || {}; } catch (e) { toneChoice = {}; }
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
    trash:'forms', copied:'forms', sweep:'forms'
  };

  function getCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    }
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }
  // Create the context IMMEDIATELY at load (starts suspended, resumes on
  // first gesture) so there is zero setup cost when the first sound fires.
  getCtx();
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
  }
  function tryStart() {
    var c = getCtx(); // getCtx() also calls resume()
    if (!c) return;
    c.onstatechange = function () { if (c.state === 'running') goLive(); };
    if (c.state === 'running') goLive();
    else if (c.resume) c.resume().then(goLive).catch(function () {});
  }
  tryStart(); // attempt zero-tap start right now
  var retries = 0;
  var retryTimer = setInterval(function () {
    if (sceneStarted || ++retries > 30) { clearInterval(retryTimer); return; }
    tryStart();
  }, 500);
  function unlock() { tryStart(); }
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, unlock, { once: true, passive: true });
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
    osc.connect(g).connect(c.destination);
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
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, curve);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = o.filter || 'lowpass'; f.Q.value = o.q || 0.8;
    f.frequency.setValueAtTime(o.from || 2000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    var g = c.createGain(); g.gain.value = o.vol || 0.1;
    src.connect(f).connect(g).connect(c.destination);
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
    src.connect(f).connect(g).connect(c.destination);
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
      o.connect(g).connect(c.destination);
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

  var VARIANTS = {
    click: {
      classic:    function () { tone({ type: 'sine', from: 880, to: 660, dur: 0.06, vol: 0.10 }); },
      typewriter: function () { noiseBurst({ dur: 0.025, vol: 0.12, filter: 'bandpass', from: 2200, q: 1.5, curve: 3 }); },
      bubble:     function () { tone({ type: 'sine', from: 320, to: 950, dur: 0.07, vol: 0.10 }); },
      laser:      function () { tone({ type: 'square', from: 1800, to: 220, dur: 0.11, vol: 0.05 }); },
      knock:      function () { noiseBurst({ dur: 0.03, vol: 0.14, filter: 'lowpass', from: 650, curve: 3 });
                                tone({ type: 'sine', from: 190, to: 120, dur: 0.05, vol: 0.09 }); },
      waterdrop:  function () { tone({ type: 'sine', from: 950, to: 400, dur: 0.05, vol: 0.09 });
                                tone({ type: 'sine', from: 480, to: 1000, dur: 0.07, vol: 0.08, delay: 0.05 }); },
      retro:      function () { tone({ type: 'square', from: 660, dur: 0.04, vol: 0.05 });
                                tone({ type: 'square', from: 880, dur: 0.05, vol: 0.05, delay: 0.05 }); },
      thock:      function () { noiseBurst({ dur: 0.02, vol: 0.11, filter: 'lowpass', from: 900, curve: 3 });
                                tone({ type: 'sine', from: 250, dur: 0.04, vol: 0.08 }); },
      pluck:      function () { tone({ type: 'triangle', from: 523, to: 500, dur: 0.14, vol: 0.09 }); },
      switch:     function () { noiseBurst({ dur: 0.012, vol: 0.1, filter: 'highpass', from: 2500, curve: 3 });
                                tone({ type: 'sine', from: 300, dur: 0.03, vol: 0.06, delay: 0.01 }); }
    },
    toast: {
      chime:    function () { tone({ type: 'sine', from: 660, to: 990, dur: 0.14, vol: 0.12 });
                              tone({ type: 'sine', from: 990, to: 1320, dur: 0.12, vol: 0.10, delay: 0.10 }); },
      doorbell: function () { tone({ type: 'sine', from: 830, dur: 0.2, vol: 0.11 });
                              tone({ type: 'sine', from: 623, dur: 0.32, vol: 0.11, delay: 0.18 }); },
      marimba:  function () { [523, 659, 784].forEach(function (f, i) {
                                tone({ type: 'triangle', from: f, dur: 0.18, vol: 0.10, delay: i * 0.08 }); }); },
      glass:    function () { tone({ type: 'sine', from: 2093, dur: 0.3, vol: 0.07 });
                              tone({ type: 'sine', from: 2637, dur: 0.26, vol: 0.05, delay: 0.05 }); },
      harp:     function () { [659, 784, 988, 1319, 1568].forEach(function (f, i) {
                                tone({ type: 'triangle', from: f, dur: 0.35, vol: 0.045, delay: i * 0.06 }); }); },
      digital:  function () { tone({ type: 'square', from: 990, dur: 0.06, vol: 0.045 });
                              tone({ type: 'square', from: 1320, dur: 0.07, vol: 0.045, delay: 0.09 }); },
      belltree: function () { for (var i = 0; i < 6; i++) {
                                tone({ type: 'triangle', from: 1400 + i * 300, dur: 0.15, vol: 0.04, delay: i * 0.05 }); } },
      kalimba:  function () { tone({ type: 'triangle', from: 880, dur: 0.3, vol: 0.09 });
                              tone({ type: 'triangle', from: 1174, dur: 0.4, vol: 0.08, delay: 0.14 }); },
      slide:    function () { tone({ type: 'sine', from: 700, to: 1400, dur: 0.25, vol: 0.07 });
                              tone({ type: 'sine', from: 1400, dur: 0.15, vol: 0.05, delay: 0.24 }); },
      cosmic:   function () { tone({ type: 'sine', from: 1568, dur: 0.5, vol: 0.05 });
                              tone({ type: 'sine', from: 1573, dur: 0.5, vol: 0.05 });
                              tone({ type: 'sine', from: 2093, dur: 0.4, vol: 0.03, delay: 0.15 }); }
    },
    pop: {
      pop:  function () { tone({ type: 'sine', from: 440, to: 880, dur: 0.05, vol: 0.09 }); },
      tick: function () { noiseBurst({ dur: 0.02, vol: 0.13, filter: 'lowpass', from: 1400, curve: 3 }); },
      blip: function () { tone({ type: 'square', from: 990, dur: 0.045, vol: 0.05 }); },
      cork: function () { noiseBurst({ dur: 0.025, vol: 0.1, filter: 'bandpass', from: 800, q: 2, curve: 3 });
                          tone({ type: 'sine', from: 320, to: 160, dur: 0.06, vol: 0.08 }); },
      marble: function () { tone({ type: 'sine', from: 1250, to: 950, dur: 0.035, vol: 0.09 });
                            noiseBurst({ dur: 0.012, vol: 0.07, filter: 'highpass', from: 3000, curve: 2 }); },
      ding: function () { tone({ type: 'triangle', from: 1568, dur: 0.28, vol: 0.06 }); },
      snap: function () { noiseBurst({ dur: 0.018, vol: 0.13, filter: 'highpass', from: 2800, curve: 2 }); },
      bubblepop: function () { tone({ type: 'sine', from: 260, to: 1250, dur: 0.06, vol: 0.1 }); },
      clave: function () { tone({ type: 'triangle', from: 1650, dur: 0.05, vol: 0.11 });
                           noiseBurst({ dur: 0.01, vol: 0.06, filter: 'bandpass', from: 2200, q: 3, curve: 3 }); },
      boop: function () { tone({ type: 'sine', from: 520, dur: 0.07, vol: 0.1 }); }
    },
    success: {
      arpeggio: function () { tone({ type: 'triangle', from: 523, dur: 0.1, vol: 0.12 });
                              tone({ type: 'triangle', from: 659, dur: 0.1, vol: 0.12, delay: 0.09 });
                              tone({ type: 'triangle', from: 784, dur: 0.16, vol: 0.12, delay: 0.18 }); },
      tada:     function () { tone({ type: 'triangle', from: 587, dur: 0.12, vol: 0.11 });
                              tone({ type: 'triangle', from: 880, dur: 0.4, vol: 0.12, delay: 0.12 });
                              tone({ type: 'sine', from: 440, dur: 0.4, vol: 0.06, delay: 0.12 }); },
      gentle:   function () { tone({ type: 'sine', from: 660, dur: 0.2, vol: 0.08 });
                              tone({ type: 'sine', from: 880, dur: 0.3, vol: 0.07, delay: 0.15 }); },
      levelup:  function () { [392, 523, 659, 784, 1046].forEach(function (f, i) {
                                tone({ type: 'square', from: f, dur: 0.07, vol: 0.045, delay: i * 0.07 }); }); },
      cash:     function () { noiseBurst({ dur: 0.05, vol: 0.08, filter: 'highpass', from: 2000, curve: 2 });
                              tone({ type: 'triangle', from: 1760, dur: 0.25, vol: 0.09, delay: 0.07 });
                              tone({ type: 'triangle', from: 2093, dur: 0.3, vol: 0.07, delay: 0.14 }); },
      choir:    function () { [523, 659, 784].forEach(function (f) {
                                tone({ type: 'sine', from: f, dur: 0.7, vol: 0.045 }); });
                              tone({ type: 'sine', from: 1046, dur: 0.7, vol: 0.03, delay: 0.1 }); },
      chord:    function () { [262, 330, 392, 523].forEach(function (f) {
                                tone({ type: 'sawtooth', from: f, dur: 0.45, vol: 0.03 }); }); },
      sparkles: function () { for (var i = 0; i < 6; i++) {
                                tone({ type: 'triangle', from: 900 + i * 220, dur: 0.1, vol: 0.06, delay: i * 0.06 }); } },
      orchestra:function () { [262, 330, 392, 523, 659].forEach(function (f, i) {
                                tone({ type: 'sawtooth', from: f, dur: 0.8, vol: 0.022, delay: i * 0.02 });
                                tone({ type: 'sine', from: f, dur: 0.8, vol: 0.03, delay: i * 0.02 }); }); },
      coin:     function () { tone({ type: 'square', from: 988, dur: 0.08, vol: 0.045 });
                              tone({ type: 'square', from: 1319, dur: 0.3, vol: 0.045, delay: 0.08 }); }
    },
    explosion: {
      realistic: function () { boom(); },
      distant:   function () { // far-off shell, all muffled rumble
                   noiseBurst({ dur: 0.9, vol: 0.12, from: 500, to: 60, curve: 2 });
                   tone({ type: 'sine', from: 70, to: 28, dur: 0.8, vol: 0.12, delay: 0.05 });
                   noiseBurst({ dur: 1.2, vol: 0.06, from: 250, to: 45, curve: 1.5, delay: 0.4 }); },
      willow:    function () { // golden willow: soft burst, long falling sparkle trails
                   noiseBurst({ dur: 0.08, vol: 0.16, filter: 'highpass', from: 600, curve: 1.5 });
                   tone({ type: 'sine', from: 100, to: 40, dur: 0.4, vol: 0.12 });
                   for (var i = 0; i < 8; i++) {
                     tone({ type: 'sine', from: 1100 + Math.random() * 500, to: 250 + Math.random() * 150,
                            dur: 0.9 + Math.random() * 0.6, vol: 0.02, delay: 0.15 + i * 0.1 });
                   }
                   for (var j = 0; j < 25; j++) {
                     var w = 0.2 + Math.pow(Math.random(), 0.5) * 1.8;
                     noiseBurst({ dur: 0.015, vol: 0.05 * (1 - w / 2.1), filter: 'highpass',
                                  from: 3000 + Math.random() * 3000, curve: 1, delay: w });
                   } },
      finale:    function () { // triple burst
                   boom(0.2);
                   setTimeout(function () { boom(0.22); }, 220 + Math.random() * 120);
                   setTimeout(function () { boom(0.26); }, 500 + Math.random() * 150); },
      artillery: function () { // single vicious CRACK + slap-back echo
                   noiseBurst({ dur: 0.045, vol: 0.32, filter: 'highpass', from: 400, curve: 1 });
                   tone({ type: 'sine', from: 140, to: 30, dur: 0.45, vol: 0.24, delay: 0.005 });
                   noiseBurst({ dur: 0.3, vol: 0.1, from: 900, to: 100, curve: 2, delay: 0.42 }); },
      strobe: function () { // rapid triple pop like a strobe shell
                for (var i = 0; i < 3; i++) {
                  noiseBurst({ dur: 0.04, vol: 0.18, filter: 'highpass', from: 700, curve: 1.5, delay: i * 0.12 });
                  tone({ type: 'sine', from: 130, to: 50, dur: 0.15, vol: 0.12, delay: i * 0.12 }); } },
      thunderous: function () { boom(0.24);
                setTimeout(function () { thunder(0.1); }, 300); },
      peony:  function () { // soft round bloom, all whoosh, few crackles
                noiseBurst({ dur: 0.08, vol: 0.14, filter: 'lowpass', from: 1500, curve: 1.5 });
                tone({ type: 'sine', from: 95, to: 38, dur: 0.55, vol: 0.16 });
                noiseBurst({ dur: 1.3, vol: 0.09, filter: 'bandpass', from: 1200, to: 200, q: 0.8, curve: 1.4, delay: 0.05 });
                for (var i = 0; i < 6; i++) {
                  noiseBurst({ dur: 0.02, vol: 0.03, filter: 'highpass', from: 3500, curve: 1, delay: 0.3 + Math.random() * 0.8 }); } },
      deep:      function () { // heavier sub, minimal crackle — the "mortar shell"
                   noiseBurst({ dur: 0.05, vol: 0.28, filter: 'lowpass', from: 800, curve: 1.5 });
                   tone({ type: 'sine', from: 100, to: 22, dur: 0.9, vol: 0.3, delay: 0.01 });
                   noiseBurst({ dur: 1.1, vol: 0.14, from: 900, to: 60, curve: 2, delay: 0.03 });
                   noiseBurst({ dur: 1.2, vol: 0.08, from: 300, to: 40, curve: 1.6, delay: 0.35 }); },
      crackler:  function () { // light report, huge sparkle tail
                   noiseBurst({ dur: 0.05, vol: 0.2, filter: 'highpass', from: 500, curve: 1.5 });
                   tone({ type: 'sine', from: 110, to: 40, dur: 0.3, vol: 0.12 });
                   for (var i = 0; i < 45; i++) {
                     var when = 0.1 + Math.pow(Math.random(), 0.6) * 1.6;
                     noiseBurst({ dur: 0.012 + Math.random() * 0.02, vol: 0.09 * (1 - when / 1.9),
                                  filter: 'highpass', from: 2500 + Math.random() * 4500, curve: 1, delay: when }); } }
    }
    ,
    notify: {
      doorbell: function () { tone({ type: 'sine', from: 830, dur: 0.18, vol: 0.09 });
                              tone({ type: 'sine', from: 623, dur: 0.28, vol: 0.09, delay: 0.16 }); },
      pager:    function () { tone({ type: 'square', from: 1046, dur: 0.09, vol: 0.05 });
                              tone({ type: 'square', from: 1046, dur: 0.09, vol: 0.05, delay: 0.15 }); },
      sonar:    function () { tone({ type: 'sine', from: 1150, to: 1100, dur: 0.55, vol: 0.06 }); },
      tritone:  function () { [523, 659, 880].forEach(function (f, i) {
                                tone({ type: 'sine', from: f, dur: 0.12, vol: 0.08, delay: i * 0.1 }); }); },
      ding:     function () { tone({ type: 'triangle', from: 1568, dur: 0.4, vol: 0.08 }); },
      twinkle:  function () { tone({ type: 'sine', from: 2093, dur: 0.12, vol: 0.06 });
                              tone({ type: 'sine', from: 2637, dur: 0.2, vol: 0.05, delay: 0.1 }); },
      bounce:   function () { tone({ type: 'sine', from: 600, to: 950, dur: 0.1, vol: 0.08 });
                              tone({ type: 'sine', from: 950, to: 650, dur: 0.12, vol: 0.07, delay: 0.1 }); },
      gentlealarm: function () { for (var i = 0; i < 3; i++) {
                                tone({ type: 'sine', from: 880, dur: 0.07, vol: 0.06, delay: i * 0.12 }); } },
      droplet:  function () { tone({ type: 'sine', from: 1000, to: 420, dur: 0.06, vol: 0.08 });
                              tone({ type: 'sine', from: 500, to: 1050, dur: 0.08, vol: 0.07, delay: 0.06 }); },
      radio:    function () { noiseBurst({ dur: 0.08, vol: 0.04, filter: 'highpass', from: 3000, curve: 1 });
                              tone({ type: 'square', from: 1046, dur: 0.12, vol: 0.05, delay: 0.09 }); }
    },
    fanfare: {
      classic:  function () { var seq = [523, 659, 784, 1046, 1318];
                              seq.forEach(function (f, i) {
                                tone({ type: 'triangle', from: f, dur: i === seq.length - 1 ? 0.5 : 0.14, vol: 0.1, delay: i * 0.13 });
                                tone({ type: 'sine', from: f / 2, dur: 0.14, vol: 0.05, delay: i * 0.13 }); }); },
      victory:  function () { [659, 659, 659, 784, 659, 784, 1046].forEach(function (f, i) {
                                tone({ type: 'square', from: f, dur: i === 6 ? 0.45 : 0.09, vol: 0.05, delay: i * 0.11 }); }); },
      horn:     function () { tone({ type: 'sawtooth', from: 349, to: 523, dur: 0.5, vol: 0.05 });
                              [523, 659, 784].forEach(function (f) {
                                tone({ type: 'sawtooth', from: f, dur: 0.6, vol: 0.035, delay: 0.4 }); }); },
      sparkle:  function () { for (var i = 0; i < 9; i++) {
                                tone({ type: 'triangle', from: 800 + i * 180, dur: 0.12, vol: 0.05, delay: i * 0.055 }); }
                              tone({ type: 'triangle', from: 2400, dur: 0.5, vol: 0.06, delay: 0.55 }); },
      royal:    function () { // brass ta-ta-ta-TAAA
                [392, 392, 392].forEach(function (f, i) {
                  tone({ type: 'sawtooth', from: f, dur: 0.11, vol: 0.045, delay: i * 0.14 }); });
                [523, 659, 784].forEach(function (f) {
                  tone({ type: 'sawtooth', from: f, dur: 0.7, vol: 0.035, delay: 0.45 }); }); },
      chimes:   function () { [2093, 1568, 1319, 1046, 784].forEach(function (f, i) {
                                tone({ type: 'triangle', from: f, dur: 0.4, vol: 0.06, delay: i * 0.12 }); }); },
      powerup:  function () { tone({ type: 'square', from: 260, to: 1046, dur: 0.4, vol: 0.04 });
                              [523, 659, 784, 1046].forEach(function (f) {
                                tone({ type: 'triangle', from: f, dur: 0.5, vol: 0.05, delay: 0.4 }); }); },
      drumroll: function () { for (var i = 0; i < 14; i++) {
                                noiseBurst({ dur: 0.03, vol: 0.03 + i * 0.005, filter: 'lowpass', from: 800, curve: 2, delay: i * 0.055 }); }
                              noiseBurst({ dur: 0.5, vol: 0.09, filter: 'highpass', from: 4000, curve: 1.5, delay: 0.8 });
                              [523, 659, 784].forEach(function (f) {
                                tone({ type: 'triangle', from: f, dur: 0.5, vol: 0.06, delay: 0.8 }); }); },
      jazzy:    function () { [523, 659, 784, 932].forEach(function (f, i) {
                                tone({ type: 'triangle', from: f, dur: 0.45, vol: 0.05, delay: i * 0.09 }); }); },
      minimal:  function () { tone({ type: 'sine', from: 784, dur: 0.15, vol: 0.08 });
                              tone({ type: 'sine', from: 1046, dur: 0.4, vol: 0.08, delay: 0.14 }); }
    },
    thunder: {
      rumble: function () { thunder(); },
      crack:  function () { // storm directly overhead: instant violent crack
                noiseBurst({ dur: 0.07, vol: 0.24, filter: 'highpass', from: 350, curve: 1 });
                tone({ type: 'sine', from: 130, to: 30, dur: 0.6, vol: 0.16, delay: 0.01 });
                noiseBurst({ dur: 1.4, vol: 0.09, from: 400, to: 55, curve: 1.8, delay: 0.08 }); },
      roll:   function () { // long distant rolling thunder
                thunder(0.07);
                setTimeout(function () { thunder(0.05); }, 600 + Math.random() * 400); },
      double: function () { // crack + echoing second crack
                noiseBurst({ dur: 0.06, vol: 0.2, filter: 'highpass', from: 400, curve: 1 });
                tone({ type: 'sine', from: 120, to: 32, dur: 0.5, vol: 0.14 });
                noiseBurst({ dur: 0.1, vol: 0.1, filter: 'highpass', from: 350, curve: 1.5, delay: 0.5 });
                noiseBurst({ dur: 1.2, vol: 0.07, from: 350, to: 55, curve: 1.8, delay: 0.6 }); },
      grumble: function () { // very low, very slow 3-second grumble
                noiseBurst({ dur: 3, vol: 0.09, from: 120, to: 40, curve: 1.2 });
                tone({ type: 'sine', from: 45, to: 25, dur: 2.5, vol: 0.08 }); },
      sharp:  function () { // short close snap, fast decay
                noiseBurst({ dur: 0.05, vol: 0.22, filter: 'highpass', from: 500, curve: 1 });
                tone({ type: 'sine', from: 140, to: 40, dur: 0.35, vol: 0.15 });
                noiseBurst({ dur: 0.5, vol: 0.07, from: 400, to: 70, curve: 2.2, delay: 0.06 }); },
      canyon: function () { // strike with three fading canyon echoes
                noiseBurst({ dur: 0.07, vol: 0.18, filter: 'highpass', from: 400, curve: 1 });
                tone({ type: 'sine', from: 110, to: 35, dur: 0.5, vol: 0.13 });
                [0.55, 1.2, 1.95].forEach(function (d, i) {
                  noiseBurst({ dur: 0.7, vol: 0.06 * (1 - i * 0.3), from: 300, to: 60, curve: 1.8, delay: d }); }); },
      tropical: function () { // warm rumble with brief rain hiss riding on it
                thunder(0.09);
                noiseBurst({ dur: 1.6, vol: 0.02, filter: 'bandpass', from: 3800, q: 0.5, curve: 1, delay: 0.15 }); },
      boomer: function () { // one huge deep thud
                tone({ type: 'sine', from: 80, to: 22, dur: 1.2, vol: 0.2 });
                noiseBurst({ dur: 1.4, vol: 0.09, from: 350, to: 45, curve: 1.6, delay: 0.02 }); },
      vintage: function () { // old-movie sheet-metal thunder shimmer
                noiseBurst({ dur: 1.8, vol: 0.08, filter: 'bandpass', from: 700, to: 150, q: 1.6, curve: 1.3 });
                tone({ type: 'sine', from: 65, to: 35, dur: 1.5, vol: 0.07, delay: 0.05 }); }
    }
  };
  function pick(name) { return (VARIANTS[name][toneChoice[name]] || VARIANTS[name][DEFAULT_TONES[name]])(); }

  function trashSound() { // delete: down-whoosh + soft thud landing
    noiseBurst({ dur: 0.18, vol: 0.06, filter: 'bandpass', from: 1800, to: 300, q: 1, curve: 1 });
    tone({ type: 'sine', from: 500, to: 180, dur: 0.14, vol: 0.07 });
    noiseBurst({ dur: 0.04, vol: 0.09, filter: 'lowpass', from: 500, curve: 3, delay: 0.15 });
  }
  function copiedSound() { // two quick high ticks — "got it"
    tone({ type: 'sine', from: 1320, dur: 0.05, vol: 0.07 });
    tone({ type: 'sine', from: 1760, dur: 0.07, vol: 0.07, delay: 0.08 });
  }
  function sweepSound() { // clear/reset: fast broom sweep
    noiseBurst({ dur: 0.3, vol: 0.06, filter: 'bandpass', from: 800, to: 2600, q: 1.2, curve: 1 });
    noiseBurst({ dur: 0.25, vol: 0.05, filter: 'bandpass', from: 2600, to: 700, q: 1.2, curve: 1, delay: 0.18 });
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
    trash:  trashSound,
    copied: copiedSound,
    sweep:  sweepSound,
    offline: function () { tone({ type: 'sine', from: 660, to: 440, dur: 0.12, vol: 0.08 });
                           tone({ type: 'sine', from: 440, to: 280, dur: 0.15, vol: 0.08, delay: 0.11 }); }
  };

  var S = {};
  Object.keys(RAW).forEach(function (k) {
    S[k] = function () { if (allowed(CATS[k] || 'taps')) RAW[k](); };
  });

  /* ================= AMBIENT LOOPS ================= */
  // Continuous quiet beds: rain, wind, hum (60Hz electrical), engine, drone

  var amb = { nodes: [], timers: [], scene: null };

  function stopAmbient() {
    amb.nodes.forEach(function (n) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) {} });
    amb.nodes = [];
    amb.timers.forEach(clearTimeout);
    amb.timers = [];
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
      amb.nodes.push(lfo);
    }
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    amb.nodes.push(src, g);
  }

  function oscLoopNode(type, freq, vol) {
    var c = ctx;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g).connect(c.destination); o.start();
    amb.nodes.push(o, g);
  }

  var LOOPS = {
    rain:   function () { noiseLoopNode('bandpass', 3800, 0.4, 0.022); noiseLoopNode('lowpass', 500, 0.5, 0.012); },
    wind:   function () { noiseLoopNode('bandpass', 320, 0.7, 0.03, true); },
    hum:    function () { oscLoopNode('sine', 60, 0.014); oscLoopNode('sine', 120, 0.008); oscLoopNode('triangle', 180, 0.004); },
    engine: function () { oscLoopNode('sawtooth', 55, 0.012); oscLoopNode('sine', 110, 0.01); noiseLoopNode('lowpass', 300, 0.5, 0.012); },
    drone:  function () { oscLoopNode('sine', 42, 0.02); oscLoopNode('sine', 63, 0.01); },
    fire:   function () { noiseLoopNode('lowpass', 1100, 0.6, 0.02); noiseLoopNode('highpass', 3200, 1, 0.008); },
    arcbuzz:function () { oscLoopNode('sawtooth', 110, 0.011); noiseLoopNode('highpass', 3000, 1, 0.009); }
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
    'blueprint':      { loop: 'hum' },
    'solarflare':     {},                                    // eruptions hooked
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
    'cooling fan':    { loop: 'engine' },
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
    stopAmbient();
    if (!ready()) return;
    var profile = null;
    if (amb.scene && SCENES[amb.scene]) profile = SCENES[amb.scene];
    if (!profile) { // form pages: read seasonal class off <body>
      var m = (document.body && document.body.className || '').match(/seasonal-([a-z]+)/);
      if (m && SEASONS[m[1]]) profile = SEASONS[m[1]];
    }
    if (!profile) return;
    var cat = (amb.scene && SCENES[amb.scene]) ? 'animations' : 'seasonal';
    if (!allowed(cat)) return;
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

  // Pause ambience in background tabs
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopAmbient();
    else { sceneStarted = false; tryStart(); }
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
    if (/delete|remove|trash|\ud83d\uddd1/.test(sig)) S.trash();
    else if (/copy|clipboard/.test(sig)) S.copied();
    else if (/\bclear\b|\breset\b|start over/.test(sig)) S.sweep();
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
        var boxes = document.querySelectorAll('input[type="checkbox"]');
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

  // Required-field validation failure → error buzz (one per burst)
  var lastInvalid = 0;
  document.addEventListener('invalid', function () {
    var now = Date.now();
    if (now - lastInvalid < 600) return;
    lastInvalid = now;
    S.error();
  }, true);

  // Connectivity
  window.addEventListener('online',  function () { S.online();  });
  window.addEventListener('offline', function () { S.offline(); });

  /* ================= PUBLIC API ================= */

  window.AOGSound = {
    play: function (name) { if (S[name]) S[name](); },
    scene: function (name) { amb.scene = name; sceneStarted = false; tryStart(); },
    toggleMute: function () {
      muted = !muted;
      localStorage.setItem('aog-sound-muted', muted ? '1' : '0');
      if (muted) stopAmbient();
      else { sceneStarted = false; tryStart(); }
      return muted;
    },
    isMuted: function () { return muted; },
    getTones: function () { var o = {}; for (var k in toneChoice) o[k] = toneChoice[k]; return o; },
    setTone: function (name, variant) {
      if (VARIANTS[name] && VARIANTS[name][variant]) {
        toneChoice[name] = variant;
        localStorage.setItem('aog-sound-tones-v3', JSON.stringify(toneChoice));
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
