/* ============================================================
   Always On Generators – Field Hub
   Scroll Lock  |  scroll-lock.js  |  v1.0.0

   ONE JOB: while a pop-up window is open (Code Reference, PDF preview,
   photo viewer, signature pad, "what's new"…), your finger scrolls the
   WINDOW, never the page behind it.

   Why it's needed: on an iPhone a swipe that reaches the end of a pop-up —
   or lands on its dark backdrop or on a part that doesn't scroll — is passed
   to the page underneath, so the form slides around behind the window and
   the window itself feels stuck. Safari ignores overflow:hidden on <body>,
   so the page is pinned in place instead (and put back exactly where it was
   when the window closes).

   It finds pop-ups by what they ARE, not by name: anything fixed to the
   screen that covers (almost) the whole screen and can be touched. So every
   tool's windows — today's and future ones — are covered without listing them.

   HOW TO USE: one line in the <head> of the page:
       <script src="../scroll-lock.js" defer></script>
   Not used on Property Lookup or Site Annotator: those pages are a map /
   drawing surface that never scrolls, so there is nothing to lock.
   ============================================================ */
(function () {
  'use strict';
  if (window.AOGScrollLock) return;

  // Likely pop-up elements. Checked by size/position below, so a loose list is fine.
  var CANDIDATES = '[role="dialog"],[aria-modal="true"],[class*="modal" i],[id*="modal" i],[class*="overlay" i],' +
                   '[id*="overlay" i],[class*="-bg"],[class*="lightbox" i],[class*="sheet" i],[class*="popup" i],body > div';

  var locked = false, savedY = 0, saved = null, queued = false;

  function isOpenPopup(el) {
    if (!el || el === document.body || el.hasAttribute('data-aog-no-lock')) return false;
    var cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' ||
        cs.pointerEvents === 'none' || parseFloat(cs.opacity) < 0.05) return false;
    var r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    return r.width >= W * 0.9 && r.height >= H * 0.85 && r.left <= W * 0.05 && r.top <= H * 0.1;
  }
  function openPopups() {
    var out = [], list = document.querySelectorAll(CANDIDATES);
    for (var i = 0; i < list.length; i++) if (isOpenPopup(list[i])) out.push(list[i]);
    return out;
  }

  function lock(popups) {
    // Inside the window: a swipe at the end of a scrolling list stays in the window.
    popups.forEach(function (p) {
      if (p._aogContained) return; p._aogContained = true;      // once per window
      p.style.overscrollBehavior = 'contain';
      var kids = p.querySelectorAll('*');
      for (var i = 0; i < kids.length && i < 2000; i++) {
        var oy = getComputedStyle(kids[i]).overflowY;
        if (oy === 'auto' || oy === 'scroll') kids[i].style.overscrollBehavior = 'contain';
      }
    });
    if (locked) return;
    locked = true;
    savedY = window.scrollY || window.pageYOffset || 0;
    var b = document.body.style;
    saved = { position: b.position, top: b.top, left: b.left, right: b.right, width: b.width, overflow: b.overflow };
    b.position = 'fixed'; b.top = (-savedY) + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'; b.overflow = 'hidden';
    document.documentElement.classList.add('aog-scroll-locked');
  }
  function unlock() {
    if (!locked) return;
    locked = false;
    var b = document.body.style;
    b.position = saved.position; b.top = saved.top; b.left = saved.left; b.right = saved.right; b.width = saved.width; b.overflow = saved.overflow;
    document.documentElement.classList.remove('aog-scroll-locked');
    // Back to exactly where you were — instantly, even on pages that scroll smoothly.
    var h = document.documentElement.style, sb = h.scrollBehavior;
    h.scrollBehavior = 'auto'; window.scrollTo(0, savedY); h.scrollBehavior = sb;
  }

  function check() {
    queued = false;
    if (!document.body) return;
    var p = openPopups();
    if (p.length) lock(p); else unlock();
  }
  function soon() { if (!queued) { queued = true; requestAnimationFrame(check); } }

  function start() {
    // A window opens or closes = a class / style / hidden change, or a new element added.
    new MutationObserver(soon).observe(document.body, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden']
    });
    addEventListener('resize', soon);
    check();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.AOGScrollLock = { get locked() { return locked; }, check: check };
})();
