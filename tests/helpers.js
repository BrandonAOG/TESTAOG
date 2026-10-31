// Shared helpers for the AOG Field Hub checks.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Every tool folder that has its own page.
const TOOLS = fs.readdirSync(ROOT)
  .filter(d => fs.existsSync(path.join(ROOT, d, 'index.html')))
  .sort();

// Offline/local runs only: point the CDN libraries at local copies when
// AOG_LOCAL_LIBS is set (folder holding node_modules/html2canvas, jspdf, …).
// On GitHub the real CDN is used.
async function useLocalLibs(page) {
  const dir = process.env.AOG_LOCAL_LIBS;
  if (!dir) return;
  const map = [
    [/html2canvas(\.min)?\.js/, 'html2canvas/dist/html2canvas.min.js'],
    [/jspdf(\.umd)?(\.min)?\.js/, 'jspdf/dist/jspdf.umd.min.js'],
    [/leaflet(\.min)?\.js/, 'leaflet/dist/leaflet.js'],
    [/leaflet(\.min)?\.css/, 'leaflet/dist/leaflet.css'],
    [/pdf-lib(\.min)?\.js/, 'pdf-lib/dist/pdf-lib.min.js'],
    [/fontkit(\.umd)?(\.min)?\.js/, '@pdf-lib/fontkit/dist/fontkit.umd.min.js'],
    [/xlsx(\.full)?(\.min)?\.js/, 'xlsx/dist/xlsx.full.min.js'],
  ];
  // Registered first: Playwright tries the most recently added route first,
  // so the local copies below win and everything else from a CDN is blocked.
  await page.route(/googleapis|gstatic|jsdelivr|unpkg|cdnjs/, r => r.abort());
  for (const [re, file] of map) {
    const p = path.join(dir, 'node_modules', file);
    if (fs.existsSync(p)) await page.route(re, r => r.fulfill({ path: p, contentType: p.endsWith('.css') ? 'text/css' : 'text/javascript' }));
  }
}

// Open a page and collect any JavaScript errors it throws.
async function open(page, url, opts = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (opts.theme) await page.addInitScript(t => { try { localStorage.setItem('aog-theme', t); } catch (e) {} }, opts.theme);
  // address lookups never leave the test run (a check that wants them mocks them after open())
  await page.route(/api\.mapbox\.com|nominatim\.openstreetmap\.org/, r => r.abort());
  await useLocalLibs(page);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(opts.settle ?? 800);
  return errors;
}

module.exports = { ROOT, TOOLS, open, useLocalLibs };
