/* ============================================================
   Always On Generators – Field Hub
   Address Lookup  |  address-lookup.js  |  v1.0.0

   ONE JOB: the same address autocomplete on every form, with the Mapbox
   token kept in ONE place (this file).

   HOW TO USE: add this line to the <head> of the page:
       <script src="../address-lookup.js" defer></script>
   and mark the address box:
       <input type="text" data-aog-address>
   That's all. Typing shows Southwest-Florida addresses first (Mapbox, with
   free OpenStreetMap as the backup). Picking one fills "street, city" — the
   same format the QC Checklist uses — and fires the normal input/change
   events, so the form's autosave and PDFs pick it up like typed text.

   Pages with their own address code (Estimate, QC Checklist) just read the
   token from here:  window.AOG_MAPBOX_TOKEN

   The suggestion list is never part of a saved image, PDF or print.
   ============================================================ */
(function () {
  'use strict';
  if (window.AOGAddress) return; // loaded twice — keep the first

  // Mapbox public (pk.) token — meant to live in browser code.
  var TOKEN = 'pk.eyJ1IjoicHJvamVjdHdyYXBwZXIiLCJhIjoiY201d2k1eHU3MDAwajJrbzU2a2c5dW40NSJ9.WJlNJ4o5CqBhWpHKMKOzIQ';
  window.AOG_MAPBOX_TOKEN = TOKEN;

  var BBOX = '-82.2,26.0,-81.2,27.0';      // Southwest Florida
  var CENTER = '-81.76,26.14';
  var NOMINATIM_BOX = '-82.2,27.0,-81.2,26.0';

  function isFlorida(text, addr) {
    if (addr && addr.state) { var s = addr.state.toLowerCase(); if (s === 'florida' || s === 'fl') return true; }
    var p = (text || '').toLowerCase();
    return p.indexOf('florida') >= 0 || /,\s*fl\b/.test(p) || /\bfl\s+\d{5}/.test(p);
  }
  function fromMapbox(f) {
    var street = ((f.address ? f.address + ' ' : '') + (f.text || '')).trim(), city = '';
    (f.context || []).some(function (c) { if (/^place\./.test(c.id)) { city = c.text; return true; } return false; });
    if (!street) street = (f.place_name || '').split(',')[0];
    return { label: f.place_name, fl: isFlorida(f.place_name), value: [street, city].filter(Boolean).join(', ') };
  }
  function fromNominatim(r) {
    var a = r.address || {};
    var street = ((a.house_number || '') + ' ' + (a.road || '')).trim() || (r.display_name || '').split(',')[0];
    var city = a.city || a.town || a.village || a.county || '';
    return { label: r.display_name, fl: isFlorida(r.display_name, a), value: [street, city].filter(Boolean).join(', ') };
  }
  function floridaFirst(list) { return list.filter(function (x) { return x.fl; }).concat(list.filter(function (x) { return !x.fl; })).slice(0, 8); }

  function search(q) {
    return fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(q) + '.json?access_token=' + TOKEN +
                 '&country=US&types=address&autocomplete=true&limit=10&proximity=' + CENTER + '&bbox=' + BBOX)
      .then(function (r) { if (!r.ok) throw new Error('mapbox ' + r.status); return r.json(); })
      .then(function (d) { if (!d.features || !d.features.length) throw new Error('none'); return floridaFirst(d.features.map(fromMapbox)); })
      .catch(function () {
        return fetch('https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&countrycodes=us&viewbox=' + NOMINATIM_BOX +
                     '&bounded=1&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } })
          .then(function (r) { return r.json(); })
          .then(function (rs) { return floridaFirst((rs || []).map(fromNominatim)); })
          .catch(function () { return []; });
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
    '@media print{.aog-addr-list{display:none!important}}';
  var list = document.createElement('ul');
  list.className = 'aog-addr-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Address suggestions');
  list.setAttribute('data-html2canvas-ignore', 'true');   // never in a capture
  var owner = null, items = [], active = -1, timer = 0, seq = 0;

  function mount() { if (!list.parentNode && document.body) { document.head.appendChild(css); document.body.appendChild(list); } }
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
  function pick(i) {
    var el = owner, it = items[i]; if (!el || !it) return;
    close();
    el.value = it.value;
    el._aogPicking = true;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } finally { el._aogPicking = false; }
  }
  function highlight(n) {
    var lis = list.children; if (!lis.length) return;
    if (active >= 0 && lis[active]) lis[active].classList.remove('active');
    active = (n + lis.length) % lis.length; lis[active].classList.add('active'); lis[active].scrollIntoView({ block: 'nearest' });
  }

  function attach(el) {
    if (!el || el._aogAddress) return; el._aogAddress = true;
    el.setAttribute('autocomplete', 'off');                 // the browser's own list would cover ours
    el.setAttribute('aria-autocomplete', 'list');
    el.setAttribute('aria-expanded', 'false');
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

  window.AOGAddress = { attach: attach, attachAll: attachAll, search: search, close: close, token: TOKEN };
})();
