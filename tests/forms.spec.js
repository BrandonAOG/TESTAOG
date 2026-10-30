// The job forms, end to end: every field saves and comes back, the resumable PDF
// round-trips through LOAD, CAPTURE makes real images, and no holiday theme or
// dark mode ever reaches what the customer gets.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

const FORMS = [
  { dir: 'estimate',      pdf: 'saveFillablePdf', clear: 'confirmClear', load: '#load-draft-input' },
  { dir: 'maintenance',   pdf: 'saveFillablePdf', clear: 'clearForm',    load: '#load-draft-input' },
  { dir: 'site-visit',    pdf: 'saveFillablePdf', clear: 'clearForm',    load: '#load-draft-input' },
  { dir: 'gas-install',   pdf: 'saveFillablePdf', clear: 'clearForm',    load: '#load-draft-input' },
  { dir: 'elect-install', pdf: 'saveFillablePdf', clear: 'clearForm',    load: '#load-draft-input' },
  { dir: 'qc-checklist',  pdf: 'saveFillablePdf', clear: 'clearForm',    load: '#load-draft-input' },
  { dir: 'service-work',  pdf: 'saveEditablePdf', clear: 'clearForm',    load: '#import-data-input' },
  { dir: 'pre-checklist', pdf: 'saveEditablePdf', clear: 'clearForm',    load: '#import-data-input' },
];

// Same fixed day for every run, so dates in exports match from run to run.
const DAY = new Date('2026-10-15T10:00:00');

// Every user-editable field on the page (not the toolbar, file pickers or sliders).
const FIELDS = `[...document.querySelectorAll('input,textarea,select')].filter(e =>
  !e.closest('.action-bar,#action-bar,.toolbar') && !['file','range','hidden','button','submit'].includes(e.type))`;

// Fill every field with a distinct value, the way a tech would (input + change events).
async function fillAll(page, mirror = []) {
  return page.evaluate(([F, mirror]) => {
    const els = eval(F).filter(e => !e.disabled && !e.readOnly && !mirror.includes(e.id));
    const radios = {}; const pad = n => String(n).padStart(2, '0'); let i = 0;
    for (const e of els) {
      i++;
      if (e.type === 'radio') { radios[e.name] = e; continue; }
      if (e.type === 'checkbox') { if (!e.checked) e.click(); continue; }
      if (e.tagName === 'SELECT') { if (e.options.length > 1) e.selectedIndex = e.options.length - 1; }
      else if (e.type === 'number') e.value = String((i % 9) + 1);
      else if (e.type === 'date') e.value = '2026-03-' + pad(i % 28 + 1);
      else if (e.type === 'time') e.value = '08:' + pad(i % 60);
      else if (e.type === 'tel') e.value = '555' + String(1000000 + i).slice(1);
      else if (e.type === 'email') e.value = 't' + i + '@example.com';
      else e.value = 'T' + i;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    }
    Object.values(radios).forEach(e => { if (!e.checked) e.click(); });
    return els.length;
  }, [FIELDS, mirror]);
}
const snapshot = page => page.evaluate(F => eval(F).map(e =>
  (e.type === 'checkbox' || e.type === 'radio') ? (e.checked ? '☑' : '☐') : e.value), FIELDS);
const differences = (a, b) => a.map((v, i) => v === b[i] ? null : `field ${i}: "${v}" → "${b[i]}"`).filter(Boolean);

async function start(page, form, query = '?season=off', theme = 'light') {
  page.on('dialog', d => d.accept());
  await page.clock.setFixedTime(DAY);
  const errors = await open(page, `/${form.dir}/${query}`, { theme, settle: 1500 });
  return errors;
}

// Run an export and return the downloaded files as { name, bytes }.
async function downloadsFrom(page, fnName, expectCount = 1) {
  const files = [];
  const listener = async d => { const p = await d.path(); files.push({ name: d.suggestedFilename(), bytes: require('fs').readFileSync(p) }); };
  page.on('download', listener);
  await page.evaluate(fn => window[fn](), fnName);
  // wait for the first file, then until no new page has arrived for 4 seconds
  const t0 = Date.now(); let last = 0, lastAt = Date.now();
  while (Date.now() - t0 < 90000) {
    await page.waitForTimeout(250);
    if (files.length !== last) { last = files.length; lastAt = Date.now(); }
    if (files.length >= expectCount && Date.now() - lastAt > 4000) break;
  }
  page.off('download', listener);
  return files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// How much two images differ: share of pixels that changed visibly, and where.
async function pixelDiff(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = async s => { const i = new Image(); i.src = 'data:image/*;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
    const A = await load(a), B = await load(b);
    if (A.width !== B.width || A.height !== B.height) return { sizeChanged: [A.width, A.height, B.width, B.height], share: 1 };
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < A.data.length; i += 4) {
      if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 120) {
        n++; const p = i / 4, x = p % A.width, y = (p / A.width) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return { share: n / (A.width * A.height), box: n ? [x0, y0, x1, y1] : null };
  }, [a, b]);
}

// Pixel stats of an image file, decoded in the browser.
async function imageStats(page, bytes) {
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/*;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let ink = 0, dark = 0;
    for (let i = 0; i < d.length; i += 64) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l < 200) ink++; if (l < 60) dark++; }
    return { w: img.width, h: img.height, ink: ink / (d.length / 64), dark: dark / (d.length / 64) };
  }, bytes.toString('base64'));
}

test.describe.configure({ mode: 'parallel' });

for (const form of FORMS) {
  test.describe(form.dir, () => {
    test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'downloads checked on desktop; phone share path below'));

    test('every field saves and comes back after closing the app', async ({ page }) => {
      expect(await start(page, form)).toEqual([]);
      const n = await fillAll(page, form.mirror);
      expect(n).toBeGreaterThan(5);
      await page.waitForTimeout(2500);                       // autosave
      const before = await snapshot(page);
      await page.reload(); await page.waitForTimeout(2000);
      expect(differences(before, await snapshot(page))).toEqual([]);
    });

    test('resumable PDF: export → CLEAR → LOAD brings every field back', async ({ page }) => {
      expect(await start(page, form)).toEqual([]);
      await fillAll(page, form.mirror); await page.waitForTimeout(1500);
      const before = await snapshot(page);
      const files = await downloadsFrom(page, form.pdf);
      expect(files.length, 'PDF was not produced').toBe(1);
      expect(files[0].name).toMatch(/\.pdf$/i);
      expect(files[0].bytes.slice(0, 5).toString()).toBe('%PDF-');
      expect(files[0].bytes.length).toBeGreaterThan(20000);

      await page.evaluate(fn => window[fn](), form.clear); await page.waitForTimeout(800);
      // forms that ask "are you sure?" in their own pop-up: press its confirm button
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && !x.closest('#action-bar,.action-bar') && /^(yes|clear|confirm|ok|delete|start over|new)/i.test(x.textContent.trim()));
        if (b) b.click();
      });
      await page.waitForTimeout(1200);
      const cleared = await snapshot(page);
      expect(differences(before, cleared).length, 'CLEAR left the form filled').toBeGreaterThan(before.filter(v => v && v !== '☐').length * 0.5);

      const tmp = test.info().outputPath(files[0].name);
      require('fs').writeFileSync(tmp, files[0].bytes);
      await page.setInputFiles(form.load, tmp);
      await page.waitForTimeout(4000);
      expect(differences(before, await snapshot(page))).toEqual([]);
    });

    test('CAPTURE makes full-page images with the job on them', async ({ page }) => {
      expect(await start(page, form)).toEqual([]);
      await fillAll(page, form.mirror); await page.waitForTimeout(1000);
      const files = await downloadsFrom(page, 'saveSmart');
      expect(files.length, 'no image produced').toBeGreaterThan(0);
      for (const f of files) {
        expect(f.name).toMatch(/\.(jpe?g|png)$/i);
        const s = await imageStats(page, f.bytes);
        expect(s.h / s.w, `${f.name} is not a portrait page`).toBeGreaterThan(1.1);
        expect(s.w).toBeGreaterThan(1000);
        expect(s.ink, `${f.name} looks blank`).toBeGreaterThan(0.01);
        expect(s.dark, `${f.name} looks dark-themed`).toBeLessThan(0.25);
      }
    });

    test('no holiday theme or dark mode in the CAPTURE image', async ({ page, browser }) => {
      test.setTimeout(300 * 1000);   // three full captures
      const shoot = async (query, theme) => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
        const p = await ctx.newPage();
        expect(await start(p, form, query, theme)).toEqual([]);
        await fillAll(p, form.mirror); await p.waitForTimeout(800);
        const f = await downloadsFrom(p, 'saveSmart');
        await ctx.close();
        return f.map(x => x.bytes.toString('base64'));
      };
      const plain = await shoot('?season=off', 'light');
      expect(plain.length).toBeGreaterThan(0);
      for (const [q, th] of [['?season=halloween', 'light'], ['?season=christmas', 'dark']]) {
        const other = await shoot(q, th);
        expect(other.length).toBe(plain.length);
        for (let i = 0; i < other.length; i++) {
          if (other[i] === plain[i]) continue;
          const d = await pixelDiff(page, plain[i], other[i]);
          // a leaked theme or dark background changes large areas; allow only anti-aliasing noise
          expect(d.share, `page ${i + 1} differs with ${q} / ${th} mode ${JSON.stringify(d)}`).toBeLessThan(0.0005);
        }
      }
    });

    test('printing turns the holiday theme off and back on', async ({ page }) => {
      expect(await start(page, form, '?season=halloween')).toEqual([]);
      const r = await page.evaluate(() => {
        const has = () => [...document.body.classList].some(c => c.startsWith('seasonal-'));
        const on1 = has(); window.dispatchEvent(new Event('beforeprint')); const during = has();
        window.dispatchEvent(new Event('afterprint')); return { on1, during, after: has() };
      });
      expect(r).toEqual({ on1: true, during: false, after: true });
      const pdf = await page.pdf({ format: 'Letter' });
      expect(pdf.length).toBeGreaterThan(5000);
    });
  });
}

// Phones: CAPTURE goes out through the share sheet instead of a download.
for (const form of FORMS) {
  test(`${form.dir}: CAPTURE on a phone hands image files to the share sheet`, async ({ page }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone only');
    await page.addInitScript(() => {
      window.__shared = [];
      navigator.canShare = () => true;
      navigator.share = async d => { for (const f of (d.files || [])) window.__shared.push({ name: f.name, type: f.type, size: f.size }); };
    });
    expect(await start(page, form)).toEqual([]);
    await fillAll(page, form.mirror); await page.waitForTimeout(800);
    const dl = []; page.on('download', d => dl.push(d.suggestedFilename()));
    await page.evaluate(() => saveSmart());
    // some forms show a "Share" button first (the tap is what iOS needs to allow sharing)
    for (let i = 0; i < 60; i++) {
      const got = await page.evaluate(() => window.__shared.length);
      if (got) break;
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button,a')].find(x => x.offsetParent && /share|save|send/i.test(x.textContent) && !x.closest('#action-bar,.action-bar'));
        if (b) b.click();
      });
      await page.waitForTimeout(500);
    }
    const shared = await page.evaluate(() => window.__shared);
    expect(shared.length + dl.length, 'nothing shared or saved').toBeGreaterThan(0);
    for (const f of shared) { expect(f.type).toMatch(/image\//); expect(f.size).toBeGreaterThan(30000); }
  });
}

test('QC: page 2 customer name and date copy page 1 and cannot be typed into', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'runs once');
  expect(await open(page, '/qc-checklist/')).toEqual([]);
  await page.fill('#cust_name', 'Page One Name');
  await page.fill('#cust_date', '2026-04-09');
  const r = await page.evaluate(() => ['cust_name2', 'cust_date2'].map(id => { const e = document.getElementById(id); return [e.readOnly, e.value]; }));
  expect(r).toEqual([[true, 'Page One Name'], [true, '2026-04-09']]);
});

