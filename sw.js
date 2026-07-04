// ============================================================
//  Always On Generators – Field Hub
//  Service Worker  |  sw.js  |  Version: aog-forms-v3.1.0
//  Scope: root (../)
//
//  ⚠ WHEN YOU UPDATE ANY TOOL:
//    1. Bump CACHE_NAME
//    2. Update CHANGELOG below with what changed
// ============================================================

var CACHE_NAME = 'aog-forms-v3.1.0';
var DEV_MODE   = false;

// Tracks whether this SW instance has already run a precache repair pass
var _repairRan = false;

// Stores last known cache progress so late-loading pages can request it
var cacheProgress = { percent: 0, label: '', done: false }; // ← SET TRUE during development/testing

// ============================================================
//  CHANGELOG — Update this every time you bump CACHE_NAME.
//  This is what shows up in the update banner on their device.
//  Keep each line short — one change per item.
// ============================================================
var CHANGELOG = [
  '📳 New Vibrate setting in Sound Settings — choose Sound only, Vibrate only, or Sound + Vibrate (vibration on Android).',
  '🗑️ Hitting OK on Clear All Fields now plays a delete sound, and Conduit Fill\'s Raceway/Nipple toggle has pipe-tap sounds.',
  '🎚️ 80 sound styles to pick from in Sound Settings, including 10 thunder and 10 firework variants.',
];
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
  './spec-viewer/'
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
];

// Google Fonts CSS URLs — cached on install so fonts load offline
// Font files themselves are cached on first visit via staleWhileRevalidate
var PRECACHE_FONTS = [
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Share+Tech+Mono&family=Exo+2:wght@300;400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Share+Tech+Mono&family=Exo+2:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Share+Tech+Mono&family=Exo+2:wght@300;400;500;600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@700&family=Share+Tech+Mono&display=swap',
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
        var scope = self.registration.scope; // e.g. https://brandonaog.github.io/AOGTEST/

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
            if (cacheName !== CACHE_NAME) {
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

// Re-add any PRECACHE_URLS entries missing from the current cache.
// Safe to run repeatedly; only fetches what's absent.
function ensurePrecached() {
  return caches.open(CACHE_NAME).then(function(cache) {
    var scope = self.registration.scope;
    return Promise.all(PRECACHE_URLS.map(function(url) {
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
  // Safari throws on certain cross-origin fetches inside the SW
  var isSameOrigin = url.origin === self.location.origin;
  var isAllowedCDN = url.hostname.includes('fonts.googleapis.com') ||
                     url.hostname.includes('fonts.gstatic.com')    ||
                     url.hostname.includes('cdnjs.cloudflare.com') ||
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
    // Once per SW startup (the browser kills and restarts SWs constantly),
    // piggyback a background repair pass on the first page navigation so any
    // precache entry that failed earlier gets retried whenever there's network.
    if (!_repairRan) {
      _repairRan = true;
      event.waitUntil(ensurePrecached().catch(function(){}));
    }
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')    ||
      url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Safari fix: request.destination can be empty string — use || '' guard
  var dest = request.destination || '';
  if (dest === 'image' || url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|webp)$/i)) {
    event.respondWith(cacheFirst(request));
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
//  STRATEGY: Network First
// ============================================================
function networkFirst(request) {
  return fetch(request)
    .then(function(networkResponse) {
      if (networkResponse && networkResponse.ok) {
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
        if (networkResponse && networkResponse.ok) {
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
      if (networkResponse && networkResponse.ok) {
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
    caches.keys().then(function(keys) {
      keys.forEach(function(key) { caches.delete(key); });
    });
    event.ports[0].postMessage({ result: 'Cache cleared' });
  }

  // Page asks new waiting SW what changed — reply with fresh changelog
  if (event.data && event.data.action === 'GET_CHANGELOG') {
    event.ports[0].postMessage({
      version:   CACHE_NAME,
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
