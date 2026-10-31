/* ============================================================
   Always On Generators – Field Hub
   Address Lookup  |  address-lookup.js  |  v1.2.0

   ONE JOB: the same address autocomplete on every form, with the Mapbox
   token kept in ONE place (this file).

   HOW TO USE: add this line to the <head> of the page:
       <script src="../address-lookup.js" defer></script>
   and mark the address box:
       <input type="text" data-aog-address>
   That's all. Typing shows Southwest-Florida addresses first (Mapbox
   Geocoding v6). When Mapbox has no match, the US Census Bureau address
   check (free, no key) looks up a full street address, and OpenStreetMap
   suggests from partial typing as the last resort. Picking one fills "street, city" — the
   same format the QC Checklist uses — and fires the normal input/change
   events, so the form's autosave and PDFs pick it up like typed text.
   A 📍 button next to the box fills in the address where you're standing
   (add data-aog-no-gps to the box to leave it off).

   Pages with their own list (Estimate, QC Checklist) use the same lookups:
   AOGAddress.search(text) and AOGAddress.reverse(lat, lon) both give
   { label, street, city, state, zip, value, fl, accuracy, source }.

   The suggestion list is never part of a saved image, PDF or print.
   ============================================================ */
(function () {
  'use strict';
  if (window.AOGAddress) return; // loaded twice — keep the first

  // Mapbox public (pk.) token — meant to live in browser code.
  var TOKEN = 'pk.eyJ1Ijoic2FzaGFrbyIsImEiOiJjazBjdnNxZXowMGR6M3BtMG5iajB6cGVlIn0.eHV32lGEeGa0r82TDjM6Sw';
  window.AOG_MAPBOX_TOKEN = TOKEN;

  var BBOX = '-82.2,26.0,-81.2,27.0';      // Southwest Florida
  var CENTER = '-81.76,26.14';
  var MAPBOX = 'https://api.mapbox.com/search/geocode/v6/';               // Geocoding v6 (better house numbers + units than v5)
  var CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&address=';

  // Every source is turned into the same shape:
  //   { label, street, city, state, zip, value: "street, city", fl, accuracy, source }
  function make(street, city, state, zip, label, accuracy, source) {
    street = (street || '').trim(); city = (city || '').trim();
    return { label: label || [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
             street: street, city: city, state: state || '', zip: zip || '',
             value: [street, city].filter(Boolean).join(', '),
             fl: /^(fl|florida)$/i.test(state || ''), accuracy: accuracy || '', source: source };
  }
  function fromMapbox(f) {
    var p = f.properties || {}, c = p.context || {}, a = c.address || {};
    var street = (a.address_number && a.street_name) ? a.address_number + ' ' + a.street_name : (p.name || '');
    var region = c.region || {};
    return make(street, (c.place || {}).name, region.region_code || region.name, (c.postcode || {}).name,
                p.full_address || [p.name, p.place_formatted].filter(Boolean).join(', '), (p.coordinates || {}).accuracy, 'mapbox');
  }
  // US Census Bureau: free, no key, very good on US house numbers. It needs a whole street address
  // (no suggest-as-you-type) and sends no CORS header, so it is called the way it supports: JSONP.
  var KEEP_UP = /^(N|S|E|W|NE|NW|SE|SW|US|SR|CR|FL)$/;
  function nice(t) {                                        // "1015 CULTURAL PARK BLVD N" → "1015 Cultural Park Blvd N"
    return String(t || '').toLowerCase().replace(/[a-z0-9]+/g, function (w) {
      var W = w.toUpperCase();
      if (KEEP_UP.test(W)) return W;
      if (/^\d+(st|nd|rd|th)$/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
  }
  function fromCensus(m) {
    var parts = String(m.matchedAddress || '').split(',').map(function (x) { return x.trim(); });  // STREET, CITY, ST, ZIP
    var c = m.addressComponents || {};
    return make(nice(parts[0]), nice(c.city || parts[1]), (c.state || parts[2] || '').toUpperCase(), c.zip || parts[3] || '', null, 'street range', 'census');
  }
  var jsonpN = 0;
  function jsonp(url, ms) {
    return new Promise(function (resolve, reject) {
      var cb = '__aogCensus' + (++jsonpN), s = document.createElement('script'), t;
      function done() { clearTimeout(t); window[cb] = function () {}; if (s.parentNode) s.parentNode.removeChild(s); }   // a late reply lands on a no-op
      window[cb] = function (d) { done(); resolve(d); };
      s.onerror = function () { done(); reject(new Error('census')); };
      t = setTimeout(function () { done(); reject(new Error('census timeout')); }, ms || 8000);
      s.src = url + '&format=jsonp&callback=' + cb;
      document.head.appendChild(s);
    });
  }
  function census(q) {
    if (!/^\s*\d+[a-z]?\s+\S+/i.test(q) || q.length < 8) return Promise.resolve([]);   // needs "number street"
    var full = /\b(fl|florida)\b|\b\d{5}\b/i.test(q) ? q : q + ', FL';                   // assume Florida if no state / ZIP typed
    return jsonp(CENSUS + encodeURIComponent(full))
      .then(function (d) { return ((d && d.result && d.result.addressMatches) || []).map(fromCensus); })
      .catch(function () { return []; });
  }
  function fromNominatim(r) {                               // last-resort backup (partial typing, and 📍 — the Census can't do either)
    var a = r.address || {};
    return make(((a.house_number || '') + ' ' + (a.road || '')).trim() || (r.display_name || '').split(',')[0],
                a.city || a.town || a.village || a.county, /florida/i.test(a.state || '') ? 'FL' : a.state, a.postcode, null, '', 'osm');
  }
  function floridaFirst(list) { return list.filter(function (x) { return x.fl; }).concat(list.filter(function (x) { return !x.fl; })).slice(0, 8); }

  // OpenStreetMap: weakest on Florida house numbers, but it can suggest from partial typing ("201 SW"),
  // so it stays as the safety net when Mapbox is down.
  function osm(q) {
    return fetch('https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=us&viewbox=-82.2,27.0,-81.2,26.0&bounded=1&q=' +
                 encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } })
      .then(function (r) { return r.json(); })
      .then(function (rs) { return floridaFirst((rs || []).filter(function (r) { return r.address; }).map(fromNominatim)); })
      .catch(function () { return []; });
  }

  // Typing: Mapbox suggestions. When Mapbox has nothing (or is down), the Census checks a full street
  // address; if it can't (partial typing) OpenStreetMap suggests instead. Both are asked at once.
  function search(q) {
    return fetch(MAPBOX + 'forward?q=' + encodeURIComponent(q) + '&autocomplete=true&country=us&types=address&limit=8&proximity=' + CENTER +
                 '&bbox=' + BBOX + '&access_token=' + TOKEN)
      .then(function (r) { if (!r.ok) throw new Error('mapbox ' + r.status); return r.json(); })
      .then(function (d) { var f = (d && d.features) || []; if (!f.length) throw new Error('none'); return floridaFirst(f.map(fromMapbox)); })
      .catch(function () {
        var o = osm(q);
        return census(q).then(function (c) { return c.length ? c : o; });
      });
  }
  // 📍 GPS: where am I → address.
  function reverse(lat, lon) {
    return fetch(MAPBOX + 'reverse?longitude=' + lon + '&latitude=' + lat + '&types=address&limit=1&access_token=' + TOKEN)
      .then(function (r) { if (!r.ok) throw new Error('mapbox ' + r.status); return r.json(); })
      .then(function (d) { if (!d || !d.features || !d.features.length) throw new Error('none'); return fromMapbox(d.features[0]); })
      .catch(function () {
        return fetch('https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=' + lat + '&lon=' + lon, { headers: { 'Accept-Language': 'en' } })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (!d || !d.address) throw new Error('none'); return fromNominatim(d); });
      });
  }

  // ── Suggestion list: one shared list on <body>, placed under whichever box is active ──
  var css = document.createElement('style');
  css.textContent =
    '.aog-addr-list{position:fixed;z-index:2147483000;margin:0;padding:0;list-style:none;max-height:260px;overflow-y:auto;' +
    'border-radius:8px;font:14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:none;-webkit-overflow-scrolling:touch}' +
    '.aog-addr-list.open{display:block}' +
    '.aog-addr-list li{padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--aog-al-line)}' +
    '.aog-addr-list li:last-child{border-bottom:0}' +
    '.aog-addr-list li.fl{font-weight:700}' +
    '.aog-addr-list li.active,.aog-addr-list li:hover{background:var(--aog-al-hi)}' +
    '.aog-addr-list.light{--aog-al-line:#eee;--aog-al-hi:rgba(217,119,6,.10);background:#fff;color:#1f2933;border:1px solid #ddd;box-shadow:0 8px 24px rgba(0,0,0,.15)}' +
    '.aog-addr-list.light li.fl{color:#b45309}' +
    '.aog-addr-list.dark{--aog-al-line:rgba(255,255,255,.08);--aog-al-hi:rgba(0,255,200,.10);background:#0f1530;color:#e0f7ff;border:1px solid rgba(0,255,200,.25);box-shadow:0 8px 24px rgba(0,0,0,.5)}' +
    '.aog-addr-list.dark li.fl{color:#00ffc8}' +
    '.aog-addr-list li.msg{cursor:default;font-weight:600;opacity:.85}' +
    /* 📍 sits INSIDE the right end of the address box (overlaid), so no form layout changes */
    'button.aog-gps{position:absolute!important;display:flex!important;align-items:center;justify-content:center;box-sizing:border-box!important;' +
    'width:26px!important;height:26px!important;min-width:0!important;min-height:0!important;max-width:none!important;margin:0!important;padding:0!important;flex:none!important;' +
    'border:0!important;border-radius:6px!important;background:transparent!important;box-shadow:none!important;clip-path:none!important;transform:none!important;' +
    'font-size:15px!important;line-height:1!important;cursor:pointer;opacity:.75;z-index:5;-webkit-tap-highlight-color:transparent;touch-action:manipulation}' +
    'button.aog-gps:hover{opacity:1}button.aog-gps:disabled{opacity:.35;cursor:wait}' +
    '@media print{.aog-addr-list,.aog-gps{display:none!important}}';
  var list = document.createElement('ul');
  list.className = 'aog-addr-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Address suggestions');
  list.setAttribute('data-html2canvas-ignore', 'true');   // never in a capture
  var owner = null, items = [], active = -1, timer = 0, seq = 0;

  function styles() { if (!css.parentNode) document.head.appendChild(css); }
  function mount() { styles(); if (!list.parentNode && document.body) document.body.appendChild(list); }
  function darkInput(el) {
    var m = (getComputedStyle(el).color || '').match(/\d+(\.\d+)?/g);
    return !!m && (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 150;   // light text → dark theme
  }
  function place() {
    if (!owner) return;
    var r = owner.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) { close(); return; }
    var below = innerHeight - r.bottom, up = below < 180 && r.top > below;
    list.style.left = Math.max(4, Math.min(r.left, innerWidth - Math.max(r.width, 260) - 4)) + 'px';
    list.style.width = Math.max(r.width, 260) + 'px';
    list.style.maxHeight = Math.min(260, (up ? r.top : below) - 8) + 'px';
    list.style.top = up ? '' : (r.bottom + 2) + 'px';
    list.style.bottom = up ? (innerHeight - r.top + 2) + 'px' : '';
  }
  function close() {
    list.classList.remove('open'); list.innerHTML = ''; items = []; active = -1;
    if (owner) owner.setAttribute('aria-expanded', 'false');
  }
  function show(el, results) {
    if (el !== owner || document.activeElement !== el) return;
    items = results; active = -1; list.innerHTML = '';
    if (!results.length) { close(); return; }
    list.className = 'aog-addr-list ' + (darkInput(el) ? 'dark' : 'light');
    results.forEach(function (it, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option'); li.textContent = it.label; if (it.fl) li.className = 'fl';
      li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(i); });   // mousedown: before the box loses focus
      list.appendChild(li);
    });
    list.classList.add('open'); el.setAttribute('aria-expanded', 'true'); place();
  }
  function fill(el, value) {
    el.value = value;
    el._aogPicking = true;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } finally { el._aogPicking = false; }
  }
  function pick(i) {
    var el = owner, it = items[i]; if (!el || !it) return;
    close(); fill(el, it.value);
  }
  function message(el, text, ms) {                          // one line under the box, e.g. "Getting your location…"
    mount(); owner = el; items = []; active = -1;
    list.className = 'aog-addr-list ' + (darkInput(el) ? 'dark' : 'light');
    list.innerHTML = ''; var li = document.createElement('li'); li.className = 'msg'; li.textContent = text; list.appendChild(li);
    list.classList.add('open'); place();
    if (ms) setTimeout(function () { if (owner === el && list.querySelector('li.msg')) close(); }, ms);
  }
  function addGps(el) {
    if (el.hasAttribute('data-aog-no-gps') || !navigator.geolocation) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'aog-gps'; b.textContent = '📍';
    b.title = 'Use my current location'; b.setAttribute('aria-label', 'Use my current location');
    b.setAttribute('data-html2canvas-ignore', 'true');      // never in a capture
    el.insertAdjacentElement('afterend', b);
    el.style.paddingRight = 'max(30px, ' + getComputedStyle(el).paddingRight + ')';   // typed text never runs under the pin
    function seat() {                                       // keep the pin on the box's right end (same offset parent as the box)
      if (!el.offsetWidth || !el.offsetHeight || getComputedStyle(el).display === 'none') { b.style.setProperty('display', 'none', 'important'); return; }
      b.style.removeProperty('display');
      b.style.left = (el.offsetLeft + el.offsetWidth - 28) + 'px';
      b.style.top = (el.offsetTop + (el.offsetHeight - 26) / 2) + 'px';
    }
    seat(); setTimeout(seat, 300); addEventListener('load', seat); addEventListener('resize', seat);
    try { new ResizeObserver(seat).observe(el); if (el.parentNode) new ResizeObserver(seat).observe(el.parentNode); } catch (e) {}
    b.addEventListener('click', function () {
      mount(); b.disabled = true; message(el, 'Getting your location…');
      navigator.geolocation.getCurrentPosition(function (pos) {
        reverse(pos.coords.latitude, pos.coords.longitude).then(function (r) {
          b.disabled = false; fill(el, r.value); message(el, '✓ ' + r.value, 2500);
        }).catch(function () { b.disabled = false; message(el, 'Address lookup failed — type it in', 4000); });
      }, function (err) {
        b.disabled = false;
        message(el, err.code === 1 ? 'Location permission is off for this app' : err.code === 3 ? 'Location timed out — try again' : 'Location unavailable', 4000);
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    });
  }
  function highlight(n) {
    var lis = list.children; if (!lis.length) return;
    if (active >= 0 && lis[active]) lis[active].classList.remove('active');
    active = (n + lis.length) % lis.length; lis[active].classList.add('active'); lis[active].scrollIntoView({ block: 'nearest' });
  }

  function attach(el) {
    if (!el || el._aogAddress) return; el._aogAddress = true;
    styles();
    el.setAttribute('autocomplete', 'off');                 // the browser's own list would cover ours
    el.setAttribute('aria-autocomplete', 'list');
    el.setAttribute('aria-expanded', 'false');
    addGps(el);
    el.addEventListener('input', function () {
      if (el._aogPicking) return;
      mount(); owner = el; clearTimeout(timer);
      var q = el.value.trim(), mine = ++seq;
      if (q.length < 3) { close(); return; }
      timer = setTimeout(function () { search(q).then(function (r) { if (mine === seq) show(el, r); }); }, 200);
    });
    el.addEventListener('keydown', function (e) {
      if (owner !== el || !list.classList.contains('open')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    el.addEventListener('blur', function () { setTimeout(function () { if (owner === el && document.activeElement !== el) close(); }, 150); });
  }
  function attachAll(root) { (root || document).querySelectorAll('input[data-aog-address]').forEach(attach); }

  addEventListener('scroll', place, true);
  addEventListener('resize', place);
  addEventListener('beforeprint', close);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { attachAll(); }); else attachAll();

  window.AOGAddress = { attach: attach, attachAll: attachAll, search: search, reverse: reverse, close: close, token: TOKEN };
})();
