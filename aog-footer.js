/* ============================================================
   Always On Generators – Field Hub
   Footer  |  aog-footer.js  |  v1.0.0

   ONE JOB: the same footer at the bottom of every tool and form —
   same lettering, size and colors everywhere:

       ALWAYS ON GENERATORS · FIELD OPERATIONS HUB
       <TOOL NAME> · <code sections it uses>
       BUILT BY BRANDON · @BRANDONAOG

   It's for the SCREEN only: never printed, never in a PDF / CAPTURE image
   (the forms keep their own paperwork footer inside the page).

   HOW TO USE: put this line where the footer goes (after the form / last
   card, normally right before </body>). NOT deferred — the footer appears
   exactly where the line is:
       <script src="../aog-footer.js"></script>
   The tool name and codes come from the list below (by folder name), so a
   wording change is made here once. New tool → add one line to TOOLS.
   ============================================================ */
(function () {
  'use strict';

  var TOOLS = {
    'estimate':          'Estimate',
    'site-visit':        'Site Visit',
    'pre-checklist':     'Pre-Install Checklist',
    'elect-install':     'Electrical Installation',
    'gas-install':       'Gas Installation',
    'qc-checklist':      'QC Checklist',
    'maintenance':       'Maintenance Report',
    'service-work':      'Service Work',
    'load-calcs':        'Load Calculation · NEC 2023 220.82',
    'box-fill':          'Box Fill · NEC 2023 314.16',
    'breaker-conductor': 'Breaker & Conductor · NEC 2023',
    'concrete-calc':     'Concrete Calculator',
    'conduit-fill':      'Conduit Fill · NEC 2023 Ch. 9',
    'gas-bonding':       'Gas Bonding · NFPA 54 7.12 · NEC 250.104(B)',
    'gas-calc':          'Gas Pipe Sizing · NFPA 54 (2024)',
    'pull-box':          'Pull Box · NEC 2023 314.28',
    'quick-calc':        'Electrical Formulas · NEC 2023',
    'trench-depth':      'Trench Depth · NEC 300.5 · NFPA 54/58',
    'spec-viewer':       'Generac Spec Viewer'
  };

  var me = document.currentScript;
  if (!me || document.querySelector('footer.aog-foot')) return;     // one footer per page

  var parts = location.pathname.split('/').filter(Boolean);
  var folder = parts.length ? parts[parts.length - 1].replace(/\.html?$/, '') : '';
  if (folder === 'index' && parts.length > 1) folder = parts[parts.length - 2];
  var name = TOOLS[folder] || '';

  // Fixed lettering and colors (nothing inherited from the page), so it looks identical on every tool.
  var css = document.createElement('style');
  css.id = 'aog-foot-style';
  css.textContent =
    'footer.aog-foot{all:initial;display:block;box-sizing:border-box;width:100%;max-width:720px;margin:32px auto 0;' +
    'padding:14px 12px calc(22px + env(safe-area-inset-bottom,0px));text-align:center;position:relative;z-index:2;' +
    "font:700 10px/1.8 ui-monospace,Menlo,Consolas,'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:#6b7280}" +
    "footer.aog-foot::before{content:'';display:block;height:2px;width:70%;margin:0 auto 10px;" +
    'background:linear-gradient(90deg,transparent,#FBBF24,#F97316,#00D4FF,transparent)}' +
    'footer.aog-foot>div{all:unset;display:block;color:#6b7280!important}' +
    'footer.aog-foot>div.aog-foot-by{color:#D97706!important}' +
    'footer.aog-foot.aog-foot-dark,footer.aog-foot.aog-foot-dark>div{color:#94a3b8!important}' +
    'footer.aog-foot.aog-foot-dark>div.aog-foot-by{color:#00FFC8!important}' +
    '@media print{footer.aog-foot{display:none!important}}';
  (document.head || document.documentElement).appendChild(css);

  var f = document.createElement('footer');
  f.className = 'aog-foot';
  f.setAttribute('data-html2canvas-ignore', 'true');            // never in a CAPTURE / PDF image
  // Own class names only (no page CSS can restyle them). Elect / Gas Install's hidden triple-tap tools hook
  // .aog-foot-hub (layout tuner) and .aog-foot-by (debug report).
  f.innerHTML =
    '<div class="aog-foot-hub">Always On Generators · Field Operations Hub</div>' +
    (name ? '<div class="aog-foot-tool"></div>' : '') +
    '<div class="aog-foot-by">Built by Brandon · @BrandonAOG</div>';
  if (name) f.querySelector('.aog-foot-tool').textContent = name;
  me.parentNode.insertBefore(f, me);

  // Dark look when the page is dark. Read from the page's own text color (light text = dark page) — the one
  // signal every tool sets the same way, whatever class it uses for dark mode and whatever its default is.
  function pageIsDark() {
    var m = (getComputedStyle(document.body).color || '').match(/[\d.]+/g);
    return !!m && (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 128;
  }
  function theme() { f.classList.toggle('aog-foot-dark', pageIsDark()); }

  // A results bar fixed to the bottom of the screen (Breaker / Conductor, Gas Calc) must not cover the footer.
  function room() {
    var H = window.innerHeight, need = 0, list = document.querySelectorAll('body > *, body > * > *');   // bars live near the top of the page tree
    for (var i = 0; i < list.length; i++) {
      var el = list[i]; if (el === f || f.contains(el)) continue;
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < H * 0.4 && r.bottom >= H - 2 && r.top < H && r.width > window.innerWidth * 0.6) need = Math.max(need, H - r.top);
    }
    // extra space INSIDE the footer (padding, not margin — a margin can collapse into the page's)
    f.style.paddingBottom = need ? 'calc(22px + ' + Math.ceil(need) + 'px)' : '';
  }
  var q = false;
  function soon() { if (!q) { q = true; requestAnimationFrame(function () { q = false; theme(); room(); }); } }

  theme();
  try { new MutationObserver(soon).observe(document.documentElement, { attributes: true, subtree: false, attributeFilter: ['class', 'data-theme', 'style'] }); } catch (e) {}
  function watchBody() { try { new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] }); } catch (e) {} }
  if (document.body) watchBody(); else document.addEventListener('DOMContentLoaded', watchBody);
  // Only measure bars while the footer is on screen (cheap the rest of the time).
  try {
    var seen = false;
    new IntersectionObserver(function (e) { seen = e[0].isIntersecting; if (seen) soon(); }).observe(f);
    addEventListener('scroll', function () { if (seen) soon(); }, { passive: true, capture: true });
  } catch (e) {}
  addEventListener('resize', soon);
  // a results bar slides in with an animation — measure again once it has finished moving
  document.addEventListener('transitionend', soon, true);
  document.addEventListener('animationend', soon, true);
  addEventListener('storage', soon);
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', soon); } catch (e) {}
  addEventListener('load', soon);
})();
