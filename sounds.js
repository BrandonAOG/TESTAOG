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

  function getCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function ready() { return !muted && ctx && ctx.state === 'running'; }

  // Browsers block audio until first user gesture; unlock then start ambience
  function unlock() {
    var c = getCtx();
    if (c) setTimeout(applyScene, 150);
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, unlock, { once: true, passive: true });
  });

  /* ================= INSTRUMENTS ================= */

  function tone(o) {
    if (muted) return;
    var c = getCtx(); if (!c || c.state !== 'running') return;
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
    var c = getCtx(); if (!c || c.state !== 'running') return;
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

  function boom(vol) { // firework / explosion
    if (muted) return;
    vol = vol || 0.18;
    noiseBurst({ dur: 0.5 + Math.random() * 0.4, vol: vol, from: 2000 + Math.random() * 1500, to: 120, curve: 2.2 });
    tone({ type: 'sine', from: 90 + Math.random() * 30, to: 35, dur: 0.38, vol: vol * 1.2 });
  }

  function thunder(vol) { // long distant rumble
    if (muted) return;
    var c = getCtx(); if (!c || c.state !== 'running') return;
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

  function launchWhistle() {
    tone({ type: 'sine', from: 500 + Math.random() * 300, to: 1600 + Math.random() * 600, dur: 0.5, vol: 0.03 });
  }

  /* ================= PRESETS ================= */

  var S = {
    click:   function () { tone({ type: 'sine', from: 880, to: 660, dur: 0.06, vol: 0.10 }); },
    hover:   function () { tone({ type: 'sine', from: 1200, dur: 0.03, vol: 0.04 }); },
    toast:   function () { tone({ type: 'sine', from: 660, to: 990, dur: 0.14, vol: 0.12 });
                           tone({ type: 'sine', from: 990, to: 1320, dur: 0.12, vol: 0.10, delay: 0.10 }); },
    success: function () { tone({ type: 'triangle', from: 523, dur: 0.1, vol: 0.12 });
                           tone({ type: 'triangle', from: 659, dur: 0.1, vol: 0.12, delay: 0.09 });
                           tone({ type: 'triangle', from: 784, dur: 0.16, vol: 0.12, delay: 0.18 }); },
    error:   function () { tone({ type: 'square', from: 220, to: 140, dur: 0.22, vol: 0.09 }); },
    welcome: function () { whoosh(0.4, 0.06);
                           tone({ type: 'sine', from: 440, to: 880, dur: 0.3, vol: 0.08, delay: 0.05 }); },
    whoosh:  function () { whoosh(); },
    pulse:   function () { tone({ type: 'sine', from: 200, to: 60, dur: 0.4, vol: 0.06 }); },
    explosion: function () { boom(); },
    launch:  launchWhistle,
    thunder: function () { thunder(); },
    boltStrike: function () { // homepage lightning: crack now, rumble after
      zap(true);
      setTimeout(function () { thunder(0.09); }, 250 + Math.random() * 500);
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
    pop:     pop,
    fanfare: fanfare,
    tick:    tick,
    result:  function () { tone({ type: 'sine', from: 660, to: 880, dur: 0.09, vol: 0.07 });
                           tone({ type: 'sine', from: 880, dur: 0.1, vol: 0.06, delay: 0.08 }); },
    notify:  function () { tone({ type: 'sine', from: 830, dur: 0.18, vol: 0.09 });
                           tone({ type: 'sine', from: 623, dur: 0.28, vol: 0.09, delay: 0.16 }); },
    online:  function () { tone({ type: 'sine', from: 440, to: 660, dur: 0.12, vol: 0.08 });
                           tone({ type: 'sine', from: 660, to: 880, dur: 0.12, vol: 0.08, delay: 0.11 }); },
    offline: function () { tone({ type: 'sine', from: 660, to: 440, dur: 0.12, vol: 0.08 });
                           tone({ type: 'sine', from: 440, to: 280, dur: 0.15, vol: 0.08, delay: 0.11 }); }
  };

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
    drone:  function () { oscLoopNode('sine', 42, 0.02); oscLoopNode('sine', 63, 0.01); }
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
    'lightning':      {},                                   // bolts hooked directly
    'tesla':          {},                                   // arcs hooked directly
    'plasma':         { loop: 'hum' },
    'emp':            {},                                   // pulses hooked directly
    'powergrid':      { loop: 'hum' },
    'voltage':        { loop: 'hum' },
    'rain':           { loop: 'rain', occ: [['thunder', 15000, 35000]] },
    'hurricane':      { loop: 'wind', occ: [['thunder', 12000, 30000]] },
    'fog':            { loop: 'wind' },
    'supercell':      { loop: 'wind', occ: [['thunder', 7000, 16000]] },
    'matrix':         { occ: [['tick', 400, 900]] },
    'sonar':          { occ: [['ping', 3600, 4400]] },
    'blueprint':      { loop: 'hum' },
    'solarflare':     { occ: [['zapBig', 8000, 16000]] },
    'lichtenberg':    { occ: [['zap', 2000, 5000]] },
    'aurora g5':      { loop: 'drone' },
    'tornado alley':  { loop: 'wind', occ: [['wind', 5000, 11000]] },
    'power lines':    { loop: 'hum' },
    'xfmr explosion': { occ: [['explosion', 9000, 18000]], loop: 'hum' },
    'engine cutaway': { loop: 'engine' },
    'elec fire':      { occ: [['zap', 1000, 2600]] },
    'solar wind':     { loop: 'wind' },
    'cosmic ray':     { occ: [['ping', 4000, 9000]] },
    'magnetosphere':  { loop: 'drone' },
    'pulsar':         { occ: [['ping', 1300, 1900]] },
    'faraday cage':   { occ: [['zap', 3000, 7000]] },
    'oscilloscope':   { loop: 'hum' },
    'jacobs ladder':  { occ: [['zap', 700, 1800]] },
    'emf field lines':{ loop: 'hum' },
    'substation':     { loop: 'hum', occ: [['zap', 6000, 15000]] },
    'underground cable': { loop: 'hum' },
    'switchgear trip':{ occ: [['zapBig', 5000, 12000]] },
    'van de graaff':  { occ: [['zap', 1500, 4000]] },
    'ball lightning': { occ: [['zap', 2500, 6000]] },
    'black hole':     { loop: 'drone' },
    'ion storm':      { occ: [['zapBig', 3000, 8000]] },
    'gamma ray burst':{ occ: [['zapBig', 6000, 14000]] },
    'power outage':   { once: 'powerDown' },
    'synapse':        { occ: [['pop', 1500, 4000]] },
    'grid goes down': { once: 'powerDown', occ: [['zap', 6000, 14000]] },
    'combustion':     { loop: 'engine' },
    'cooling fan':    { loop: 'engine' },
    'battery charge': { occ: [['result', 6000, 12000]] },
    'three-phase':    { loop: 'hum' },
    'circuit traces': { occ: [['tick', 600, 1400]] },
    'arc flash':      { occ: [['zapBig', 4000, 9000]] },
    'strike on grid': { occ: [['boltStrike', 8000, 16000]] },
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
    else if (ready()) applyScene();
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
    if (/pdf|export|download|save|print|submit|send/.test(sig)) S.result();
  }, { passive: true });

  // Checkboxes: pop on check; fanfare when a page's checklist hits 100%
  var fanfared = false;
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.matches) return;
    if (t.matches('input[type="checkbox"], input[type="radio"]')) {
      if (t.checked) pop(); else tone({ type: 'sine', from: 700, to: 420, dur: 0.05, vol: 0.06 });
      if (t.type === 'checkbox') {
        var boxes = document.querySelectorAll('input[type="checkbox"]');
        if (boxes.length >= 4) {
          var all = true;
          for (var i = 0; i < boxes.length; i++) if (!boxes[i].checked) { all = false; break; }
          if (all && !fanfared) { fanfared = true; setTimeout(fanfare, 150); }
          if (!all) fanfared = false;
        }
      }
      return;
    }
    if (t.matches('select')) { tick(); return; }
    if (t.matches('input[type="number"]')) { S.result(); return; }
    if (t.matches('input[type="file"]')) { shutter(); return; }
  }, true);

  // Soft tick while typing numbers into the calculators
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"], input[type="range"]')) tick();
  }, true);

  // Connectivity
  window.addEventListener('online',  function () { S.online();  });
  window.addEventListener('offline', function () { S.offline(); });

  /* ================= PUBLIC API ================= */

  window.AOGSound = {
    play: function (name) { if (S[name]) S[name](); },
    scene: function (name) { amb.scene = name; if (ready()) applyScene(); },
    toggleMute: function () {
      muted = !muted;
      localStorage.setItem('aog-sound-muted', muted ? '1' : '0');
      if (muted) stopAmbient();
      else { getCtx(); setTimeout(applyScene, 100); }
      return muted;
    },
    isMuted: function () { return muted; },
    mapAnimation: function (a, s) { animationSounds[a] = s; }
  };
})();
