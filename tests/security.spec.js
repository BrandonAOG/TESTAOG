// 3.0.1 security hardening — static checks + behaviour (helpers run in a sandbox, like tools.spec.js).
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { ROOT, open } = require('./helpers');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Pull a named `function NAME(...){...}` out of a source file by brace-matching.
function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error('no ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) { const c = src[j]; if (c === '{') { d++; started = true; } else if (c === '}') { if (--d === 0 && started) return src.slice(i, j + 1); } }
  throw new Error('unbalanced ' + name);
}
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'static / node checks run once'));

test('Site Annotator: every pdf.js load forces isEvalSupported:false (CVE-2024-4367)', () => {
  const s = read('site-annotator/index.html');
  expect(s.includes('pdfjsLib.getDocument(')).toBe(false);                 // no raw calls left
  expect((s.match(/_pdfGetDocument\(/g) || []).length).toBeGreaterThanOrEqual(6);
  const ctx = { seen: [], pdfjsLib: { getDocument(o) { ctx.seen.push(o); return { promise: null }; } }, URL, ArrayBuffer, Uint8Array };
  vm.runInNewContext(fnSource(s, '_pdfGetDocument') + '\n_pdfGetDocument("a.pdf");_pdfGetDocument({data:new Uint8Array([1])});_pdfGetDocument(new ArrayBuffer(4));', ctx);
  expect(ctx.seen.length).toBe(3);
  expect(ctx.seen.every(o => o.isEvalSupported === false)).toBe(true);
  expect(ctx.seen.every(o => o.url || o.data)).toBeTruthy();
});

test('Site Annotator: layer names are escaped, not injected as HTML', () => {
  const s = read('site-annotator/index.html');
  expect(s.includes("'+l.name+")).toBe(false);                             // no raw layer name anywhere
  expect(s.split('l.name==null?"":String(l.name))').length - 1).toBe(2);   // both sites escaped inline
  // the inline escaper neutralises &<>\"
  const esc = x => (x==null?"":String(x)).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const out = esc('<img src=x onerror=alert(1)>"&');
  expect(/[<>]/.test(out)).toBe(false);
  expect(out).toContain('&lt;'); expect(out).toContain('&quot;');
});

test('Property Lookup: external links are forced to http(s)', async ({ page }) => {
  expect(await open(page, '/property-lookup/', { settle: 1200 })).toEqual([]);
  const r = await page.evaluate(() => [
    _safeUrl('javascript:alert(1)'), _safeUrl('  javascript:alert(1)'),
    _safeUrl('https://library.municode.com/fl'), _safeUrl('http://example.com'),
    _safeUrl('data:text/html,x'), _safeUrl(''), _safeUrl(null),
  ]);
  expect(r).toEqual(['#', '#', 'https://library.municode.com/fl', 'http://example.com', '#', '#', '#']);
  expect((read('property-lookup/index.html').match(/esc\(_safeUrl\(/g) || []).length).toBeGreaterThanOrEqual(7);
});

test('Excel: the vendored SheetJS is the patched 0.20.3, loaded same-origin (not the 0.18.5 CDN)', () => {
  const lib = read('xlsx.full.min.js');
  expect(lib).toContain('version="0.20.3"');
  for (const f of ['estimate/index.html', 'property-lookup/index.html']) {
    const s = read(f);
    expect(s, f).toContain('<script src="../xlsx.full.min.js"');
    expect(s.includes('cdnjs.cloudflare.com/ajax/libs/xlsx'), f + ' still on the old CDN').toBe(false);
  }
  expect(read('sw.js')).toContain("'./xlsx.full.min.js'");
  expect(read('sw.js').includes('libs/xlsx/0.18.5')).toBe(false);
});

test('Excel: the vendored library actually loads in the browser as XLSX 0.20.3', async ({ page }) => {
  for (const f of ['estimate', 'property-lookup']) {
    expect(await open(page, `/${f}/`, { settle: 1500 }), f).toEqual([]);
    const v = await page.evaluate(() => (window.XLSX && XLSX.version) || null);
    expect(v, f + ': XLSX not loaded').toBe('0.20.3');
  }
});
