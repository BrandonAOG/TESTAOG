// The remaining tools end to end: Load Calc job round trip, Site Annotator drawing
// and export, Spec Viewer vs Gas Calc data, Property Lookup's local data, and sounds.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, open } = require('./helpers');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'runs once'));

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('Load Calc: PDF → NEW JOB → LOAD brings the whole job back', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { try { window.showSaveFilePicker = undefined; } catch (e) {} });   // plain download instead of the save dialog
  expect(await open(page, '/load-calcs/', { settle: 1500 })).toEqual([]);
  // fill the job info and change the house so it isn't the default job
  await page.fill('#j_co', 'Test Customer'); await page.fill('#j_addr', '12 Test Rd');
  await page.fill('#j_city', 'Ocala FL 34470'); await page.fill('#j_phone', '3525550100');
  await page.evaluate(() => { const a = document.querySelector('#tab-step1 input'); a.value = '3450'; a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true })); if (typeof calc === 'function') calc(); });
  await page.waitForTimeout(800);
  const snap = () => page.evaluate(() => ({
    fields: [...document.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'file').map(e => (e.type === 'checkbox' || e.type === 'radio') ? e.checked : e.value),
    demand: document.getElementById('s_dem').textContent, gen: document.getElementById('s_gen').textContent,
  }));
  const before = await snap();
  expect(before.demand).not.toContain('31,491');            // really changed

  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => capturePDF(document.querySelector('[onclick^="capturePDF"]')))]);
  const pdf = path.join(require('os').tmpdir(), 'aog-loadcalc-job-' + Date.now() + '.pdf'); await dl.saveAs(pdf);
  expect(fs.readFileSync(pdf).slice(0, 5).toString()).toBe('%PDF-');

  await page.evaluate(() => aogResetJob()); await page.waitForTimeout(1000);
  expect((await snap()).demand).toContain('31,491');          // back to the default job

  await page.setInputFiles('#aog_job_in', pdf);
  // "Load this job?" confirm pop-up
  await expect.poll(() => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /^load job$/i.test(x.textContent.trim())); if (b) { b.click(); return true; } return false; }), { timeout: 15000 }).toBe(true);
  await page.waitForTimeout(2000);
  const after = await snap();
  expect(after.demand).toBe(before.demand);
  expect(after.gen).toBe(before.gen);
  expect(after.fields).toEqual(before.fields);
});

test('Site Annotator: draw shapes, and the PNG / PDF exports contain the drawing', async ({ page }) => {
  await page.addInitScript(() => { try { window.showSaveFilePicker = undefined; } catch (e) {} });   // use plain downloads
  page.on('dialog', d => d.accept());
  expect(await open(page, '/site-annotator/', { settle: 1500 })).toEqual([]);
  await page.click('#new-canvas-btn'); await page.click('#nc-create-btn'); await page.waitForTimeout(1500);
  const ink = () => page.evaluate(() => { const c = document.getElementById('shapes-cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
  const box = await (await page.$('#draw-cv')).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  let last = 0;
  for (const [tool, dx, dy] of [['rect', -120, -80], ['ellipse', 40, -80], ['line', -120, 60], ['arrow', 40, 60]]) {
    await page.click(`[data-tool="${tool}"]`);
    await page.mouse.move(cx + dx, cy + dy); await page.mouse.down();
    await page.mouse.move(cx + dx + 40, cy + dy + 25, { steps: 6 }); await page.mouse.move(cx + dx + 80, cy + dy + 50, { steps: 6 });
    await page.mouse.up(); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const now = await ink();
    expect(now, `${tool} drew nothing`).toBeGreaterThan(last);
    last = now;
  }
  const [png] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#btn-png')]);
  const pngPath = test.info().outputPath('plan.png'); await png.saveAs(pngPath);
  const stats = await page.evaluate(async b64 => {
    const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode();
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 0; k < d.length; k += 16) if (d[k] < 128) n++;
    return { w: i.width, h: i.height, ink: n };
  }, fs.readFileSync(pngPath).toString('base64'));
  expect(stats.w).toBeGreaterThan(800);
  expect(stats.ink, 'PNG export is missing the drawing').toBeGreaterThan(200);

  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#btn-pdf')]);
  const pdfPath = test.info().outputPath('plan.pdf'); await pdf.saveAs(pdfPath);
  expect(fs.readFileSync(pdfPath).slice(0, 5).toString()).toBe('%PDF-');
});

// Site Annotator Undo / Redo: one tap = one change, nothing left selected on screen.
async function annotatorCanvas(page) {
  page.on('dialog', d => d.accept());
  expect(await open(page, '/site-annotator/', { settle: 1500 })).toEqual([]);
  await page.click('#new-canvas-btn'); await page.click('#nc-create-btn'); await page.waitForTimeout(1500);
  const box = await (await page.$('#draw-cv')).boundingBox();
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // what is on screen: the drawn objects plus any selection box, as a fingerprint
  const look = () => page.evaluate(() => ['shapes-cv', 'sel-cv'].map(id => { const cv = document.getElementById(id); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0, h = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) { n++; h = (h * 31 + i) % 1000000007; } return n + ':' + h; }).join('|'));
  const ink = async () => (await look()).split('|').reduce((n, part) => n + +part.split(':')[0], 0);
  const draw = async (tool, dx, dy) => {
    await page.click(`[data-tool="${tool}"]`);
    await page.mouse.move(c.x + dx, c.y + dy); await page.mouse.down(); await page.mouse.move(c.x + dx + 45, c.y + dy + 30, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(400);
  };
  const tap = async id => { await page.click(id); await page.waitForTimeout(400); };
  return { c, look, ink, draw, tap };
}

test('Site Annotator: each Undo tap removes one shape, Redo puts them all back', async ({ page }) => {
  const a = await annotatorCanvas(page);
  const start = await a.look();
  const after = [];
  for (const [i, t] of ['rect', 'ellipse', 'rect', 'ellipse', 'rect'].entries()) {
    await a.draw(t, -140 + i * 55, -40);                   // the blank page is ~310 px wide at fit zoom
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);                     // deselect: shape stays, box goes
    after.push(await a.look());
  }
  expect(new Set([start, ...after]).size, 'each shape changed the drawing').toBe(6);
  // 5 shapes → 5 Undo taps → back to blank, every tap stepping back exactly one shape (no "dead" taps)
  for (let i = after.length - 2; i >= -1; i--) {
    await a.tap('#btn-undo');
    expect(await a.look(), `Undo tap ${after.length - 1 - i}`).toBe(i >= 0 ? after[i] : start);
  }
  for (const [i, want] of after.entries()) {
    await a.tap('#btn-redo');
    expect(await a.look(), `Redo tap ${i + 1}`).toBe(want);
  }
});

test('Site Annotator: Undo with a shape still selected removes it and clears the selection box', async ({ page }) => {
  const a = await annotatorCanvas(page);
  await a.draw('rect', -120, -40);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const before = await a.look();
  await a.draw('ellipse', 20, -40);                        // the new shape is left selected
  expect((await a.look()).split('|')[1], 'new shape is selected').not.toBe('0:0');
  await a.tap('#btn-undo');
  expect(await a.look(), 'ellipse and its selection box both gone after ONE tap').toBe(before);
  await page.keyboard.press('Control+y'); await page.waitForTimeout(400);
  const redone = await a.look();
  expect(redone).not.toBe(before);
  expect(redone.split('|')[1], 'redo brings it back unselected').toBe('0:0');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  expect(await a.look(), 'Ctrl+Z steps the same history as the button').toBe(before);
});

test('Site Annotator: moving a selected shape is one Undo step', async ({ page }) => {
  const a = await annotatorCanvas(page);
  await a.draw('rect', -60, -60);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const placed = await a.look();
  await page.mouse.click(a.c.x - 38, a.c.y - 45); await page.waitForTimeout(400);             // select it
  await page.mouse.move(a.c.x - 38, a.c.y - 45); await page.mouse.down();
  await page.mouse.move(a.c.x + 60, a.c.y + 60, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const moved = await a.look();
  expect(moved, 'the drag moved the shape').not.toBe(placed);
  await a.tap('#btn-undo');
  expect(await a.look(), 'one Undo puts it back where it was').toBe(placed);
  await a.tap('#btn-redo');
  expect(await a.look(), 'Redo moves it again').toBe(moved);
});

test('Spec Viewer and Gas Calc agree on every generator\'s fuel data', () => {
  const block = (file, start) => { const s = read(file); const i = s.indexOf(start); let d = 0, j = s.indexOf('[', i); for (let k = j; k < s.length; k++) { if (s[k] === '[') d++; else if (s[k] === ']' && --d === 0) return s.slice(j, k + 1); } };
  const GM = vm.runInNewContext(block('gas-calc/index.html', 'const GM = ['));
  const SV = vm.runInNewContext(block('spec-viewer/index.html', 'const GENS=['));
  const mismatch = []; let compared = 0;
  for (const g of GM) {
    const num = g.num.split(' / ')[0];
    const s = SV.find(x => x.num && x.num.startsWith(num));
    if (!s) continue;
    compared++;
    for (const [a, b] of [['ng_cfh_f', 'ngf'], ['ng_cfh_h', 'ngh'], ['lp_gph_f', 'lpf'], ['lp_gph_h', 'lph'], ['kw_ng', 'kng'], ['kw_lp', 'klp']])
      if (+g[a] !== +s[b]) mismatch.push(`${num}: Gas Calc ${a}=${g[a]} vs Spec Viewer ${b}=${s[b]}`);
  }
  expect(compared).toBeGreaterThan(20);
  expect(mismatch).toEqual([]);
});

test('Spec Viewer: every generator opens without an error', async ({ page }) => {
  expect(await open(page, '/spec-viewer/', { settle: 1200 })).toEqual([]);
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const n = await page.evaluate(async () => {
    const sel = [...document.querySelectorAll('select')].find(s => s.options.length > 20);
    if (!sel) return -1;
    for (const o of [...sel.options]) { if (!o.value) continue; sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 20)); }
    return sel.options.length;
  });
  expect(errs).toEqual([]);
  if (n === -1) test.info().annotations.push({ type: 'note', description: 'no model dropdown found — page opened only' });
});

test('Property Lookup: its own map and setback data files load and parse', async ({ page }) => {
  for (const f of ['property-lookup/fl_gas_territories.geojson', 'property-lookup/fl_electric_territories.geojson']) {
    const g = JSON.parse(read(f));
    expect(g.type).toBe('FeatureCollection');
    expect(g.features.length).toBeGreaterThan(0);
  }
  if (fs.existsSync(path.join(ROOT, 'property-lookup/fl-setbacks.json'))) JSON.parse(read('property-lookup/fl-setbacks.json'));
  expect(await open(page, '/property-lookup/', { settle: 1500 })).toEqual([]);
  const counties = await page.evaluate(() => typeof COUNTY_LIVE === 'object' ? Object.keys(COUNTY_LIVE).length : 0);
  expect(counties).toBeGreaterThan(10);
});

test('Sounds: every sound plays without an error, and mute is remembered', async ({ page }) => {
  const src = read('sounds.js');
  const raw = src.slice(src.indexOf('var RAW = {'), src.indexOf('var S = {};'));
  const names = [...raw.matchAll(/^\s{4}([a-zA-Z0-9_]+)\s*:\s*function/gm)].map(m => m[1]);
  expect(names.length).toBeGreaterThan(10);
  expect(await open(page, '/', { settle: 1500 })).toEqual([]);
  await page.mouse.click(5, 5);                                  // the tap that unlocks audio
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const r = await page.evaluate(async names => {
    if (!window.AOGSound) return 'no AOGSound';
    const bad = [];
    for (const n of names) { try { AOGSound.previewPlay(n); } catch (e) { bad.push(n + ': ' + e.message); } await new Promise(r => setTimeout(r, 30)); }
    const m1 = AOGSound.isMuted(); AOGSound.toggleMute(); const m2 = AOGSound.isMuted();
    return { version: AOGSound.version, bad, toggled: m1 !== m2, saved: localStorage.getItem('aog-sound-muted') };
  }, names);
  expect(r.bad).toEqual([]);
  expect(r.toggled).toBe(true);
  expect(r.saved).toMatch(/^[01]$/);
  expect(errs).toEqual([]);
});

test('Hub: every tool card opens a real page', async ({ page }) => {
  expect(await open(page, '/', { settle: 1200 })).toEqual([]);
  const unlinked = await page.evaluate(() => [...document.querySelectorAll('.form-card')].filter(c => !c.getAttribute('href')).map(c => c.getAttribute('data-form')));
  expect(unlinked, 'tool cards with no page').toEqual([]);
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && !/^(https?:|mailto:|tel:|#|javascript:|data:|blob:)/.test(h)));
  const missing = [...new Set(links)].map(h => h.replace(/^\.\//, '').replace(/[?#].*$/, '')).filter(h => h && !fs.existsSync(path.join(ROOT, h.endsWith('/') || !path.extname(h) ? path.join(h, 'index.html') : h)));
  expect(missing).toEqual([]);
});
