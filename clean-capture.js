/* ============================================================
   Always On Generators – Field Hub
   Clean Capture  |  clean-capture.js  |  v1.0.0

   ONE JOB: seasonal themes (Halloween, Christmas, ...) must never show up in
   anything a customer or office receives — PDF, print, or image capture.

   HOW TO USE: add this ONE line to the <head> of every form page, right
   after sounds.js. It must NOT be deferred (it has to be in place before
   html2canvas loads):
       <script src="../clean-capture.js"></script>

   Pages need no other code. This file turns the season OFF automatically:
     - while the browser prints / saves as PDF   (beforeprint → afterprint)
     - while html2canvas renders an image or PDF (call → render finished)
   and turns it back on afterwards, exactly as it was.

   It also exposes AOGSeason.off() / AOGSeason.on() for any future export
   path that needs to strip the theme earlier (calls nest safely).

   "Season OFF" means: remove every body.seasonal-* class, disable the
   #seasonal-styles sheet, and hide the particle canvas(es). Because every
   seasonal rule hangs off those three things, nothing seasonal can leak —
   no matter which form or export path is used.
   ============================================================ */
(function () {
  'use strict';
  if (window.AOGSeason) return; // loaded twice — keep the first

  var depth = 0;      // nested off() calls (print + capture can overlap)
  var saved = null;   // what we removed, so on() can put it back exactly

  function off() {
    if (depth++ > 0) return;
    var b = document.body;
    if (!b) { saved = null; return; }
    var cls = [];
    b.classList.forEach(function (c) { if (c.indexOf('seasonal-') === 0) cls.push(c); });
    cls.forEach(function (c) { b.classList.remove(c); });

    var sheets = [];
    var st = document.getElementById('seasonal-styles');
    if (st) { sheets.push({ el: st, media: st.getAttribute('media') }); st.setAttribute('media', 'not all'); }

    var canv = [];
    document.querySelectorAll('#seasonal-canvas, .seasonal-canvas').forEach(function (c) {
      canv.push({ el: c, display: c.style.display });
      c.style.display = 'none';
    });
    // stop the particle animation too (hidden canvases still burn CPU every frame)
    try { if (window._seasonalPauseAnimation) window._seasonalPauseAnimation(); } catch (e) {}
    saved = { cls: cls, sheets: sheets, canv: canv };
  }

  function on() {
    if (depth === 0) return;
    if (--depth > 0) return;
    var s = saved; saved = null;
    if (!s) return;
    s.cls.forEach(function (c) { document.body.classList.add(c); });
    s.sheets.forEach(function (x) {
      if (x.media === null) x.el.removeAttribute('media'); else x.el.setAttribute('media', x.media);
    });
    s.canv.forEach(function (x) { x.el.style.display = x.display; });
    try { if (window._seasonalResumeAnimation) window._seasonalResumeAnimation(); } catch (e) {}
  }

  window.AOGSeason = { off: off, on: on };

  /* ── PRINT / "SAVE AS PDF" ─────────────────────────────────── */
  var printing = false;
  window.addEventListener('beforeprint', function () { if (!printing) { printing = true; off(); } });
  window.addEventListener('afterprint',  function () { if (printing)  { printing = false; on(); } });

  /* ── IMAGE CAPTURE / FILLABLE PDF (html2canvas) ────────────── */
  // Strip the clone too, so a theme that is re-applied mid-render (e.g. a
  // page's own restore running early) still can't reach the picture.
  function cleanClone(doc) {
    try {
      var b = doc.body, rm = [];
      b.classList.forEach(function (c) { if (c.indexOf('seasonal-') === 0) rm.push(c); });
      rm.forEach(function (c) { b.classList.remove(c); });
      var st = doc.getElementById('seasonal-styles');
      if (st) st.setAttribute('media', 'not all');
      doc.querySelectorAll('#seasonal-canvas, .seasonal-canvas').forEach(function (c) {
        if (c.parentNode) c.parentNode.removeChild(c);
      });
    } catch (e) {}
  }

  function wrap(real) {
    if (typeof real !== 'function' || real.__aogClean) return real;
    var w = function (el, opts) {
      opts = opts || {};
      var pageClone = opts.onclone;
      var o = {};
      for (var k in opts) o[k] = opts[k];
      o.onclone = function (doc) {
        cleanClone(doc);
        if (typeof pageClone === 'function') return pageClone.apply(this, arguments);
      };
      off();
      var p;
      try { p = real.call(this, el, o); } catch (e) { on(); throw e; }
      return Promise.resolve(p).then(
        function (c) { on(); return c; },
        function (e) { on(); throw e; }
      );
    };
    w.__aogClean = true;
    return w;
  }

  // html2canvas arrives from the CDN AFTER this file (normal or deferred
  // <script>). Catch the moment it assigns window.html2canvas and wrap it.
  var current = wrap(window.html2canvas);
  try {
    Object.defineProperty(window, 'html2canvas', {
      configurable: true,
      get: function () { return current; },
      set: function (v) { current = wrap(v); }
    });
  } catch (e) {}
})();
