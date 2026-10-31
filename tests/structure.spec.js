// App structure: offline list, manifest, shared scripts. No browser needed.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, TOOLS } = require('./helpers');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'file checks run once'));

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('sw.js parses, has a version and update notes', () => {
  const src = read('sw.js');
  new vm.Script(src);                                    // throws on a syntax error
  expect(src).toMatch(/var CACHE_VERSION = 'v\d+\.\d+\.\d+';/);
  const ctx = {};
  vm.runInNewContext(src.slice(src.indexOf('var CHANGELOG'), src.indexOf('];', src.indexOf('var CHANGELOG')) + 2), ctx);
  expect(Array.isArray(ctx.CHANGELOG) && ctx.CHANGELOG.length).toBeTruthy();
});

test('every file the offline cache needs actually exists', () => {
  const src = read('sw.js');
  const ctx = {};
  const s = src.indexOf('var PRECACHE_URLS');
  vm.runInNewContext(src.slice(s, src.indexOf('];', s) + 2), ctx);
  const missing = ctx.PRECACHE_URLS
    .map(u => u.replace(/^\.\//, ''))
    .filter(u => u && !fs.existsSync(path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u)));
  expect(missing).toEqual([]);
});

test('every tool page is in the offline cache', () => {
  const src = read('sw.js');
  const notCached = TOOLS.filter(t => !src.includes(`'./${t}/'`));
  expect(notCached).toEqual([]);
});

test('manifest.json is valid and every shortcut points at a real page', () => {
  const m = JSON.parse(read('manifest.json'));
  expect(m.name).toBeTruthy();
  const bad = (m.shortcuts || []).filter(s => !fs.existsSync(path.join(ROOT, s.url.replace(/^\.\//, ''), 'index.html')));
  expect(bad.map(s => s.url)).toEqual([]);
});

test('every tool page loads the shared update and sound scripts', () => {
  const missing = [];
  for (const t of TOOLS) {
    const html = read(`${t}/index.html`);
    if (!html.includes('../update-banner.js')) missing.push(`${t}: update-banner.js`);
    if (!/<script src="\.\.\/sounds\.js" defer><\/script>/.test(html)) missing.push(`${t}: sounds.js (defer)`);
  }
  expect(missing).toEqual([]);
});

test('every tool uses the one shared theme setting (aog-theme)', () => {
  const noTheme = TOOLS.filter(t => !read(`${t}/index.html`).includes('aog-theme'));
  expect(noTheme).toEqual([]);
});

test('shared scripts parse', () => {
  for (const f of ['update-banner.js', 'sounds.js', 'clean-capture.js', 'seasonal.js', 'address-lookup.js', 'battery-saver.js']) new vm.Script(read(f));
});

test('every local file a page links to (scripts, styles, images, pages) exists', () => {
  const missing = [];
  for (const page of ['index.html', 'offline.html', ...TOOLS.map(t => `${t}/index.html`)]) {
    const html = read(page), dir = path.dirname(path.join(ROOT, page));
    for (const m of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
      const u = m[1];
      if (/^(https?:|mailto:|tel:|#|javascript:|data:|blob:)/.test(u) || /[$+{}()\s]/.test(u)) continue;   // skip remote links and JavaScript-built ones
      const clean = u.split(/[?#]/)[0]; if (!clean) continue;
      const target = path.resolve(dir, clean);
      const ok = fs.existsSync(target) && (fs.statSync(target).isFile() || fs.existsSync(path.join(target, 'index.html')));
      if (!ok) missing.push(`${page} → ${u}`);
    }
  }
  expect(missing).toEqual([]);
});

