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
  // Google Fonts → local @fontsource copies (same fonts GitHub loads from the real CDN),
  // so text widths — and layout checks like "the toolbar fits on an iPhone" — match a real phone.
  const fontDir = path.join(dir, 'node_modules', '@fontsource');
  if (fs.existsSync(fontDir)) {
    await page.route(/fonts\.googleapis\.com\/css2/, r => {
      const u = new URL(r.request().url()); let css = '';
      for (const fam of u.searchParams.getAll('family')) {
        const [name, spec] = fam.split(':'), pkg = name.toLowerCase().replace(/\s+/g, '-'), files = path.join(fontDir, pkg, 'files');
        if (!fs.existsSync(files)) continue;
        const weights = spec && /wght@/.test(spec) ? spec.split('@')[1].split(';').map(w => w.split(',').pop()) : ['400'];
        for (const w of weights) {
          const f = `${pkg}-latin-${w}-normal.woff2`;
          if (fs.existsSync(path.join(files, f))) css += `@font-face{font-family:'${name}';font-style:normal;font-weight:${w};font-display:swap;src:url(https://fonts.gstatic.com/__aog/${pkg}/${f}) format('woff2')}\n`;
        }
      }
      r.fulfill({ contentType: 'text/css', body: css });
    });
    await page.route(/fonts\.gstatic\.com\/__aog\//, r => {
      const [pkg, f] = new URL(r.request().url()).pathname.split('/').slice(-2);
      r.fulfill({ path: path.join(fontDir, pkg, 'files', f), contentType: 'font/woff2' });
    });
  }
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
  await page.route(/api\.mapbox\.com|nominatim\.openstreetmap\.org|geocoding\.geo\.census\.gov/, r => r.abort());
  await useLocalLibs(page);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(opts.settle ?? 800);
  return errors;
}

module.exports = { ROOT, TOOLS, open, useLocalLibs };
