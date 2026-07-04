/* ============================================================
   AOG Sound Engine — drop-in UI sounds (no audio files needed)
   Add to any page:  <script src="./sounds.js"></script>
   (use src="../sounds.js" from sub-folder pages)

   - Synthesized with Web Audio API → works offline in your PWA
   - Auto-plays sounds when your CSS animations start
   - Click/tap sounds on buttons and links
   - Mute toggle persisted in localStorage:  AOGSound.toggleMute()
   ============================================================ */
(function () {
  'use strict';

  var ctx = null;
  var muted = localStorage.getItem('aog-sound-muted') === '1';

  // Browsers block audio until the user interacts with the page,
  // so we lazily create/resume the AudioContext on first gesture.
  function getCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, getCtx, { once: true, passive: true });
  });

  // Core tone generator
  function tone(opts) {
    if (muted) return;
    var c = getCtx();
    if (!c || c.state !== 'running') return;
    var o = c.createOscillator();
    var g = c.createGain();
    var t = c.currentTime + (opts.delay || 0);
    var dur = opts.dur || 0.12;

    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.from, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);

    var vol = (opts.vol || 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Filtered-noise "whoosh"
  function whoosh(dur, vol) {
    if (muted) return;
    var c = getCtx();
    if (!c || c.state !== 'running') return;
    dur = dur || 0.35; vol = vol || 0.08;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(2200, c.currentTime + dur);
    var g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  }

  // ---- Named sound presets ----
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
    pulse:   function () { tone({ type: 'sine', from: 330, dur: 0.08, vol: 0.05 }); }
  };

  // ---- Map your CSS animation names → sounds ----
  // When any element starts one of these animations, the sound plays.
  var animationSounds = {
    toastIn:     'toast',
    welcomeIn:   'welcome',
    bannerPulse: null,      // set to 'pulse' if you want it (it loops — can get noisy)
    logoPulse:   null,
    dotPulse:    null
  };

  document.addEventListener('animationstart', function (e) {
    var name = animationSounds[e.animationName];
    if (name && S[name]) S[name]();
  });

  // ---- Click sounds on interactive elements ----
  document.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button, a, [role="button"], input[type="checkbox"], input[type="radio"], select')) {
      S.click();
    }
  }, { passive: true });

  // ---- Public API ----
  window.AOGSound = {
    play: function (name) { if (S[name]) S[name](); },
    toggleMute: function () {
      muted = !muted;
      localStorage.setItem('aog-sound-muted', muted ? '1' : '0');
      return muted;
    },
    isMuted: function () { return muted; },
    /* map more animations at runtime:
       AOGSound.mapAnimation('myKeyframeName', 'success') */
    mapAnimation: function (animName, soundName) { animationSounds[animName] = soundName; }
  };
})();
