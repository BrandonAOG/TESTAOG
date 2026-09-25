// ============================================================
//  Always On Generators – Field Hub
//  Service Worker  |  sw.js  |  Version: v2.5.1
//
//  ⚠ WHEN YOU UPDATE ANY TOOL:
//    1. Bump CACHE_VERSION
//    2. Update CHANGELOG below with what changed
//
//  ⚠ THIS SAME FILE GOES ON BOTH THE PUBLIC SITE AND THE TEST SITE.
//    Do not give them different version strings any more — the cache name
//    now includes the scope, so /TESTAOG/ and the public root get separate
//    caches automatically. See the note on CACHE_PREFIX below.
// ============================================================

// The cache name now carries this build's SCOPE, not just a version string.
// WHY: CacheStorage is per-ORIGIN, not per-scope. Both service workers live on
// https://brandonaog.github.io, so caches.keys() in activate() returned the OTHER
// build's cache too — and the old `if (cacheName !== CACHE_NAME) delete` line
// therefore DELETED THE PUBLIC SITE'S ENTIRE OFFLINE CACHE every time the test
// site activated, and vice versa. Every switch between the two forced a full
// 52-file re-download. A literal prefix could not fix it either: 'aog-forms-v'
// is itself a prefix of 'aog-forms-vTEST2.5.0', so public would still eat test.
// The scope is different by construction, so this cannot collide.
var CACHE_VERSION = 'v2.5.1';
var CACHE_PREFIX  = 'aog-forms::' + self.registration.scope + '::';
var CACHE_NAME    = CACHE_PREFIX + CACHE_VERSION;

// What the UPDATE BANNER / FOOTER shows the user. CACHE_NAME is now a long
// internal string with the site address inside it, which must never reach the
// screen — so the display version is rebuilt in the old familiar format, with
// the TEST marker derived from the scope. Test site shows aog-forms-vTEST2.5.1,
// public shows aog-forms-v2.5.1, from this one identical file.
// NOTE: this keys off the word "test" appearing in the folder name (TESTAOG).
// If the test site ever moves to a folder without "test" in it, set this by hand.
var IS_TEST_BUILD   = /test/i.test(self.registration.scope);
var DISPLAY_VERSION = 'aog-forms-v' + (IS_TEST_BUILD ? 'TEST' : '') +
                      CACHE_VERSION.replace(/^v/, '');

var DEV_MODE   = false;   // ← SET TRUE during development/testing

// Tracks whether this SW instance has already run a precache repair pass
var _repairRan = false;

// Stores last known cache progress so late-loading pages can request it
var cacheProgress = { percent: 0, label: '', done: false };

// ============================================================
//  CHANGELOG — Update this every time you bump CACHE_VERSION.
//  This is what shows up in the update banner on their device.
//  Keep each line short — one change per item.
// ============================================================
var CHANGELOG = [
'📖 PROPERTY LOOKUP — live municipal code lookups, pulled from each city or county’s own code',
'🗺️ PROPERTY LOOKUP — now live in 60 Florida counties',
];
//
// ============================================================

var PRECACHE_URLS = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './logo.png',
  './sw.js',
  './update-banner.js',
  './sounds.js',
  './estimate/',
  './maintenance/',
  './site-visit/',
  './gas-install/',
  './elect-install/',
  './qc-checklist/',
  './service-work/',
  './pre-checklist/',
  './site-annotator/',
  './load-calcs/',
  './breaker-conductor/',
  './conduit-fill/',
  './property-lookup/',
  './property-lookup/fl_gas_territories.geojson',
  './property-lookup/fl_electric_territories.geojson',
  './gas-calc/',
  './spec-viewer/',
  './concrete-calc/'
];

// CDN assets that must be cached on install for 100% offline support
var PRECACHE_CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  // Site Annotator: true-font PDF export (Calibri/Times/Courier metric twins)
  'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/carlito/Carlito-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/carlito/Carlito-Bold.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/carlito/Carlito-Italic.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/carlito/Carlito-BoldItalic.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Bold.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Italic.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-BoldItalic.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/cousine/Cousine-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/cousine/Cousine-Bold.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/cousine/Cousine-Italic.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/cousine/Cousine-BoldItalic.ttf',
  // Site Annotator: HEIC (iPhone photo) import — page tries jsdelivr, then unpkg
  'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
];

// Google Fonts CSS URLs — cached on install so fonts load offline
// Font files themselves are cached on first visit via staleWhileRevalidate
var PRECACHE_FONTS = [
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Share+Tech+Mono&family=Exo+2:wght@300;400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Share+Tech+Mono&family=Exo+2:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Share+Tech+Mono&family=Exo+2:wght@300;400;500;600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@700&family=Share+Tech+Mono&display=swap',
  // Site Annotator's exact font CSS (URL must match verbatim to hit the cache)
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&family=Exo+2:wght@300;400;600&display=swap',
];

var CACHE_CDN = [
  'https://api.mapbox.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdnjs.cloudflare.com'
];

// ============================================================
//  INSTALL — Pre-cache all core files
//  ⚠ NO skipWaiting here — we wait for the user to tap
//  "Update Now" before taking over. This gives them time
//  to read the changelog before the page reloads.
// ============================================================
self.addEventListener('install', function(event) {
  console.log('[SW] Installing — Cache:', CACHE_NAME);

  if (DEV_MODE) {
    console.log('[SW] ⚠ DEV MODE — taking control immediately');
    self.skipWaiting();
    return;
  }

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('[SW] Pre-caching core files');
        var total = PRECACHE_URLS.length;
        var completed = 0;
        var scope = self.registration.scope; // e.g. https://brandonaog.github.io/TESTAOG/

        // Combine all URLs to cache: app pages + CDN assets + fonts
        var allUrls = PRECACHE_URLS.concat(PRECACHE_CDN).concat(PRECACHE_FONTS);
        total = allUrls.length;

        // Sequential caching so progress is accurate and stored for polling
        return allUrls.reduce(function(chain, url) {
          return chain.then(function() {
            // CDN and font URLs are already absolute; convert relative ones using scope
            var absUrl = url.startsWith('http') ? url : new URL(url, scope).href;
            var label = absUrl.replace(scope,'').replace(/\/$/,'') || absUrl.split('/').pop() || 'cdn';
            return cache.add(absUrl)
              .then(function() {
                completed++;
                cacheProgress = {
                  percent: Math.round((completed / total) * 100),
                  label: label,
                  done: completed === total
                };
                console.log('[SW] Cached (' + cacheProgress.percent + '%):', absUrl);
              })
              .catch(function(err) {
                completed++;
                cacheProgress = {
                  percent: Math.round((completed / total) * 100),
                  label: 'skipped: ' + label,
                  done: completed === total
                };
                console.warn('[SW] Pre-cache skipped:', absUrl, err);
              });
          });
        }, Promise.resolve());
      })
      .then(function() {
        cacheProgress = { percent: 100, label: 'All files cached', done: true };
        console.log('[SW] Install complete — waiting for user to approve update');
        // No skipWaiting() on purpose — user taps Update Now to activate
      })
  );
});


// ============================================================
//  ACTIVATE — Delete old caches, claim clients
// ============================================================
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating — Cache:', CACHE_NAME);

  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(cacheName) {
            // ONLY delete caches belonging to THIS build (same scope prefix).
            // Without the prefix test, this deleted the other site's cache —
            // see the CACHE_PREFIX note at the top of this file.
            if (cacheName.indexOf(CACHE_PREFIX) === 0 && cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(function() {
        // SELF-HEAL: install() skips files that fail to download (one LTE hiccup
        // and a page silently never gets cached — e.g. "pre-checklist doesn't
        // work offline"). Re-check every core URL here and re-fetch any that are
        // missing, so a bad install repairs itself on the next activation/launch.
        return ensurePrecached();
      })
      .then(function() {
        console.log('[SW] Activated — claiming all clients');
        return self.clients.claim();
      })
  );
});

// Re-add any precache entries missing from the current cache — core pages AND
// the CDN libraries/fonts (a library that failed to cache on install is exactly
// the "PDF export doesn't work offline" failure, so repair those too).
// Safe to run repeatedly; only fetches what's absent.
function ensurePrecached() {
  return caches.open(CACHE_NAME).then(function(cache) {
    var scope = self.registration.scope;
    var all = PRECACHE_URLS.concat(PRECACHE_CDN).concat(PRECACHE_FONTS);
    return Promise.all(all.map(function(url) {
      var absUrl = url.startsWith('http') ? url : new URL(url, scope).href;
      return cache.match(absUrl).then(function(hit) {
        if (hit) return;
        console.log('[SW] Repairing missing precache entry:', absUrl);
        return cache.add(absUrl).catch(function(err) {
          console.warn('[SW] Repair failed (will retry next activation):', absUrl, err);
        });
      });
    }));
  });
}

// ============================================================
//  FETCH — Request handling strategies
// ============================================================
self.addEventListener('fetch', function(event) {

  var request = event.request;

  // Safari fix: wrap URL parsing in try/catch — malformed URLs throw and
  // crash the entire fetch handler, causing the respondWith error
  var url;
  try { url = new URL(request.url); } catch(e) { return; }

  // Only handle GET requests over http/https — let everything else pass through
  if (request.method !== 'GET') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Safari fix: skip cross-origin requests that aren't in our CDN list —
  // Safari throws on certain cross-origin fetches inside the SW.
  // NOTE: arcgisonline.com is deliberately NOT here, so every basemap tile and
  // every parcel query bypasses this worker entirely and goes straight to the
  // network. The map's tile behaviour is not affected by anything in this file.
  var isSameOrigin = url.origin === self.location.origin;
  var isAllowedCDN = url.hostname.includes('fonts.googleapis.com') ||
                     url.hostname.includes('fonts.gstatic.com')    ||
                     url.hostname.includes('cdnjs.cloudflare.com') ||
                     url.hostname.includes('cdn.jsdelivr.net')     ||
                     url.hostname.includes('unpkg.com')            ||
                     url.hostname.includes('mapbox.com')           ||
                     url.hostname.includes('mapbox.cn');
  if (!isSameOrigin && !isAllowedCDN) return;

  if (DEV_MODE) {
    event.respondWith(
      fetch(request).catch(function() {
        return new Response(
          '<h2 style="font-family:sans-serif;color:red;padding:20px">⚠ Network unavailable (Dev Mode)</h2>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  if (url.hostname.includes('mapbox.com') || url.hostname.includes('mapbox.cn')) {
    event.respondWith(
      fetch(request).catch(function() {
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  var accept = request.headers.get('Accept') || '';

  if (accept.includes('text/html')) {
    // Once per SW startup (the browser kills and restarts SWs constantly), run a
    // background repair pass so any precache entry that failed earlier gets
    // retried whenever there's network.
    // DELAYED BY 5s: this checks 52 entries and refetches any that are missing.
    // Firing it the instant a page navigates put that burst in direct competition
    // with the page's own loading — and on the property-lookup page, concurrent
    // requests are exactly what starves the map tiles. Still inside waitUntil so
    // the browser will not kill the worker mid-repair.
    if (!_repairRan) {
      _repairRan = true;
      event.waitUntil(new Promise(function(resolve) {
        setTimeout(function() {
          ensurePrecached().catch(function(){}).then(resolve, resolve);
        }, 5000);
      }));
    }
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Google Fonts CSS can change server-side (UA-dependent) — keep it SWR.
  if (url.hostname.includes('fonts.googleapis.com')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  // Versioned/immutable CDN files (cdnjs, jsdelivr, unpkg, gstatic woff2):
  // the URL changes when the version does, so cache-first is safe and avoids
  // re-downloading megabytes of libraries on every online visit over LTE.
  if (url.hostname.includes('fonts.gstatic.com')    ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('cdn.jsdelivr.net')     ||
      url.hostname.includes('unpkg.com')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Safari fix: request.destination can be empty string — use || '' guard
  var dest = request.destination || '';
  if (dest === 'image' || url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|webp)$/i)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // The sound engine and update banner should be CURRENT after an update, but
  // must never be SLOW. Timed race: give the network 600ms — if a fresh copy
  // arrives that fast, use it (instant updates on good connections); otherwise
  // serve the cached copy immediately (reliable on job-site connections) and
  // let the network response refresh the cache in the background for next load.
  if (isSameOrigin && url.pathname.match(/(sounds|update-banner)\.js$/i)) {
    event.respondWith(networkRace(request, 600));
    return;
  }

  if (url.pathname.match(/\.(js|css)$/i)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Versioned data files (county compact .json.gz, territory geojson, manifest).
  // These are versioned in the filename (e.g. _v3), so cache-first is safe: a new
  // build gets a new filename and simply misses the cache once. Without this rule
  // they fell through to networkFirst and re-downloaded 5–11 MB per file on every
  // online visit even though a cached copy was sitting right there.
  if (url.pathname.match(/\.(json|json\.gz|geojson)$/i)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

// ============================================================
//  STRATEGY: Network Race — network wins only if faster than timeoutMs,
//  otherwise cached copy is served and the network refreshes cache silently
// ============================================================

// Is this response worth caching? `res.ok` alone REJECTED every no-cors
// cross-origin response: a CDN <script> or a font file referenced from CSS
// comes back as type "opaque" with status 0, so ok===false — the runtime
// cache silently never stored the gstatic woff2 files, fontkit, heic2any,
// or the export TTFs, and they all broke offline. Opaque responses cache
// and replay fine; accept them for the CDN hosts we route through here.
function _cacheable(res) {
  return !!res && (res.ok || res.type === 'opaque' || res.type === 'opaqueredirect');
}

function networkRace(request, timeoutMs) {
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(request).then(function(hit) {
      return hit || caches.match(request);
    }).then(function(cached) {
      var networkFetch = fetch(request).then(function(res) {
        if (_cacheable(res)) {
          caches.open(CACHE_NAME).then(function(c) { c.put(request, res.clone()); });
        }
        return res;
      });
      if (!cached) {
        // nothing cached (first ever load) — network is the only option
        return networkFetch;
      }
      var timer = new Promise(function(resolve) {
        setTimeout(function() { resolve(cached); }, timeoutMs);
      });
      // Whichever finishes first wins; network errors fall back to cache
      return Promise.race([networkFetch.catch(function() { return cached; }), timer]);
    });
  });
}

// ============================================================
//  STRATEGY: Network First
// ============================================================
function networkFirst(request) {
  return fetch(request)
    .then(function(networkResponse) {
      if (_cacheable(networkResponse)) {
        var responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, responseClone);
        });
      }
      return networkResponse;
    })
    .catch(function() {
      return caches.match(request)
        .then(function(cachedResponse) {
          if (cachedResponse) return cachedResponse;
          var accept = request.headers.get('Accept') || '';
          if (accept.includes('text/html')) {
            // Build offline URL relative to SW scope — matches how it was cached
            var offlineUrl = self.registration.scope + 'offline.html';
            console.log('[SW] Looking for offline page at:', offlineUrl);
            return caches.match(offlineUrl)
              .then(function(r) {
                if (r) return r;
                // Fallback: search all caches for offline.html
                return caches.keys().then(function(cacheNames) {
                  return Promise.all(
                    cacheNames.map(function(name) {
                      return caches.open(name).then(function(c) {
                        return c.match(offlineUrl);
                      });
                    })
                  ).then(function(results) {
                    for (var i = 0; i < results.length; i++) {
                      if (results[i]) return results[i];
                    }
                    // Last resort inline fallback
                    return new Response(
                      '<!DOCTYPE html><html><head><meta charset=UTF-8><meta name=viewport content=width=device-width,initial-scale=1><title>Offline</title></head><body style=background:#060913;color:#FBBF24;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center><div><div style=font-size:3rem>⚡</div><h2 style=margin:16px 0>You are offline</h2><p style=color:#7A8BA8>Connect to the internet and try again</p><br><button onclick=location.reload() style=background:#FBBF24;color:#060913;border:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:1rem;cursor:pointer>Try Again</button></div></body></html>',
                      { headers: { 'Content-Type': 'text/html' } }
                    );
                  });
                });
              });
          }
          return new Response('Service Unavailable', { status: 503 });
        });
    });
}

// ============================================================
//  STRATEGY: Stale While Revalidate
// ============================================================
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then(function(cache) {
    // Check our own cache first, then ALL caches. The global fallback covers the
    // "update hostage" case: a newly shipped page already precached by a WAITING
    // service worker (new cache) can still be served offline by the active one.
    return cache.match(request).then(function(hit) {
      return hit || caches.match(request);
    }).then(function(cachedResponse) {
      var networkFetch = fetch(request).then(function(networkResponse) {
        if (_cacheable(networkResponse)) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(function(err) {
        console.log('[SW] Revalidate failed:', err);
        var accept = request.headers.get('Accept') || '';
        // For navigations with no cache + no network, serve the offline page
        if (accept.includes('text/html')) {
          var offlineUrl = self.registration.scope + 'offline.html';
          return caches.match(offlineUrl).then(function(r) {
            return r || new Response('Service Unavailable', { status: 503 });
          });
        }
        // Return a valid empty response so respondWith never gets undefined
        return new Response('', { status: 503 });
      });
      return cachedResponse || networkFetch;
    });
  });
}

// ============================================================
//  STRATEGY: Cache First
// ============================================================
function cacheFirst(request) {
  return caches.match(request).then(function(cachedResponse) {
    if (cachedResponse) return cachedResponse;
    return fetch(request).then(function(networkResponse) {
      if (_cacheable(networkResponse)) {
        var responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, responseClone);
        });
      }
      return networkResponse;
    }).catch(function() {
      return new Response('', { status: 503 });
    });
  });
}

// ============================================================
//  MESSAGE HANDLER
// ============================================================
self.addEventListener('message', function(event) {

  // User tapped "Update Now" — activate and let page reload
  if (event.data && event.data.action === 'SKIP_WAITING') {
    console.log('[SW] User approved update — activating now');
    self.skipWaiting();
  }

  if (event.data && event.data.action === 'CLEAR_CACHE') {
    // Same origin-wide hazard as activate(): without the prefix test this wiped
    // the OTHER site's offline cache as well as this one's.
    caches.keys().then(function(keys) {
      keys.forEach(function(key) {
        if (key.indexOf(CACHE_PREFIX) === 0) caches.delete(key);
      });
    });
    event.ports[0].postMessage({ result: 'Cache cleared' });
  }

  // Page asks new waiting SW what changed — reply with fresh changelog
  if (event.data && event.data.action === 'GET_CHANGELOG') {
    event.ports[0].postMessage({
      version:   DISPLAY_VERSION,   // NOT CACHE_NAME — that is internal now
      changelog: CHANGELOG
    });
  }

  // Page requests current cache progress (for late-loading pages that missed broadcasts)
  if (event.data && event.data.action === 'GET_CACHE_PROGRESS') {
    if (event.ports[0]) {
      event.ports[0].postMessage({
        action:  'CACHE_PROGRESS',
        percent: cacheProgress.percent,
        label:   cacheProgress.label,
        done:    cacheProgress.done
      });
    }
  }

});

// ============================================================
//  END OF SERVICE WORKER
// ============================================================
