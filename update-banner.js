// ============================================================
//  Always On Generators – Field Hub
//  Update Banner  |  update-banner.js
//
//  HOW TO USE:
//  Add this ONE line to the <head> of every page:
//    <script src="../update-banner.js"></script>
//
//  DO NOT edit changelog text here.
//  Edit the CHANGELOG array in sw.js instead.
//  That's the only file you need to touch when you update.
// ============================================================

// ── Lightweight error log ─────────────────────────────────────
// Records the last 10 JS errors (per device) so the Hub's
// "Report a Bug" email can attach them automatically. Stored in
// localStorage under 'aog_error_log'. No network, no tracking.
(function () {
  var KEY = 'aog_error_log', MAX = 10;
  function log(msg, src) {
    try {
      var arr = JSON.parse(localStorage.getItem(KEY) || '[]');
      arr.push({
        t: new Date().toISOString(),
        page: location.pathname,
        msg: String(msg || 'unknown').slice(0, 200),
        src: String(src || '').slice(0, 120)
      });
      while (arr.length > MAX) arr.shift();
      localStorage.setItem(KEY, JSON.stringify(arr));
    } catch (e) { /* storage full/blocked — never break the page over logging */ }
  }
  window.addEventListener('error', function (e) {
    log(e.message, (e.filename || '') + (e.lineno ? ':' + e.lineno + ':' + (e.colno || 0) : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    log('Unhandled promise rejection: ' + (r && r.message ? r.message : r), r && r.stack ? String(r.stack).split('\n')[1] : '');
  });
})();

(function () {
  if (!('serviceWorker' in navigator)) return;

  // ── Inject banner CSS ──────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#aog-update-banner {',
    '  position: fixed;',
    '  top: 0; left: 0; right: 0;',
    '  z-index: 9999;',
    '  background: var(--panel, var(--bg2, #1a1a2e));',
    '  color: var(--text, #fff);',
    '  font-family: var(--font-body, sans-serif);',
    '  font-size: 14px;',
    '  padding: 12px 16px;',
    '  display: flex;',
    '  align-items: flex-start;',
    '  gap: 12px;',
    '  box-shadow: 0 2px 8px rgba(0,0,0,0.4);',
    '  border-bottom: 1px solid var(--border-bright, rgba(232,160,32,0.5));',
    '  transform: translateY(-100%);',
    '  transition: transform 0.35s ease;',
    '}',
    '#aog-update-banner.show { transform: translateY(0); }',
    '#aog-update-banner .aog-text { flex: 1; line-height: 1.5; }',
    '#aog-update-banner .aog-title {',
    '  font-weight: bold;',
    '  font-size: 15px;',
    '  margin-bottom: 4px;',
    '}',
    '#aog-update-banner .aog-list {',
    '  margin: 0;',
    '  padding-left: 18px;',
    '  color: var(--text-muted, #ccc);',
    '}',
    '#aog-update-banner .aog-list li { margin: 2px 0; }',
    '#aog-update-banner .aog-btn {',
    '  background: var(--amber, var(--cyan, #e8a020));',
    '  color: var(--bg, #000);',
    '  border: none;',
    '  border-radius: 6px;',
    '  padding: 8px 14px;',
    '  font-weight: bold;',
    '  font-size: 13px;',
    '  cursor: pointer;',
    '  white-space: nowrap;',
    '  align-self: center;',
    '}',
    '#aog-update-banner .aog-btn:hover { filter: brightness(1.15); }'
  ].join('\n');
  document.head.appendChild(style);

  // ── Ask the waiting SW for its changelog, then show banner ─
  function askAndShow(waitingWorker) {
    var channel = new MessageChannel();

    channel.port1.onmessage = function (event) {
      var version   = event.data.version   || 'New Version';
      var changelog = event.data.changelog || ['App has been updated'];
      showBanner(version, changelog, waitingWorker);
    };

    // Send GET_CHANGELOG to the *waiting* (new) SW, not the active one.
    // This guarantees we always get the fresh changelog text.
    waitingWorker.postMessage({ action: 'GET_CHANGELOG' }, [channel.port2]);
  }

  // ── Build and display the banner ───────────────────────────
  function showBanner(version, changelog, waitingWorker) {
    if (document.getElementById('aog-update-banner')) return; // already showing

    var listItems = changelog.map(function (item) {
      return '<li>' + item + '</li>';
    }).join('');

    var banner = document.createElement('div');
    banner.id = 'aog-update-banner';
    banner.innerHTML =
      '<div class="aog-text">' +
        '<div class="aog-title">⚡ App Update Ready — ' + version + '</div>' +
        '<ul class="aog-list">' + listItems + '</ul>' +
      '</div>' +
      '<button class="aog-btn" id="aog-update-btn">Update Now</button>';

    document.body.insertBefore(banner, document.body.firstChild);

    setTimeout(function () {
      banner.classList.add('show');
      if (window.AOGSound) AOGSound.play('notify');
    }, 100);

    document.getElementById('aog-update-btn').addEventListener('click', function () {
      waitingWorker.postMessage({ action: 'SKIP_WAITING' });
    });
  }

  // ── Reload once the new SW takes control ───────────────────
  // Guard against reload loops: controllerchange can fire in multiple tabs / more than once.
  // Also guard against the FIRST-EVER install: on a brand-new visit there is no
  // controller yet, so when the fresh SW finishes precaching and calls clients.claim(),
  // controllerchange fires — reloading the page out from under the user (possibly
  // mid-form). Only reload when we're swapping an OLD controller for a new one.
  var aogHadController = !!navigator.serviceWorker.controller;
  var aogRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!aogHadController) { aogHadController = true; return; } // first install — no reload
    if (aogRefreshing) return;
    aogRefreshing = true;
    window.location.reload();
  });

  // ── Register SW and watch for a waiting update ─────────────
  // Resolve sw.js relative to this script's own URL so it works no matter
  // where the app is hosted (GitHub Pages subpath, custom domain root, etc.)
  var _swUrl = new URL('sw.js', document.currentScript && document.currentScript.src ? document.currentScript.src : window.location.href).href;
  navigator.serviceWorker.register(_swUrl, { scope: new URL('./', _swUrl).href })
    .then(function (reg) {

      // Actively check for a new sw.js NOW and every few minutes. Without this, the browser
      // only re-checks on its own schedule (often only on navigation, or ~once a day), so a
      // freshly pushed update (bumped CACHE_NAME) may not surface the banner for a long time.
      try { reg.update(); } catch (e) {}
      setInterval(function () { try { reg.update(); } catch (e) {} }, 5 * 60 * 1000);
      // Also re-check whenever the user returns to the tab/app.
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { try { reg.update(); } catch (e) {} }
      });

      // Waiting worker already present on page load
      if (reg.waiting) {
        askAndShow(reg.waiting);
        return;
      }

      // New worker found while user has the page open
      reg.addEventListener('updatefound', function () {
        var newWorker = reg.installing;
        newWorker.addEventListener('statechange', function () {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            askAndShow(newWorker);
          }
        });
      });
    })
    .catch(function (err) {
      console.warn('[AOG Banner] SW registration failed:', err);
    });

})();
