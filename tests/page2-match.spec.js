// Elect Install's page 2 comes out of PDF✎ / CAPTURE looking exactly like Site Visit's page 2
// (Brandon's pick). The two pages share the same markup; Elect Install copies Site Visit's look
// at capture time (see "PAGE 2 = SITE VISIT'S PAGE 2" in elect-install/index.html).
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

async function page2Pdf(page, form, kind = 'pdf') {
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { try { window.showSaveFilePicker = undefined; } catch (e) {} });
  expect(await open(page, `/${form}/`, { settle: 1200, theme: 'light' })).toEqual([]);
  return page.evaluate(async kind => {
    const tdu = HTMLCanvasElement.prototype.toDataURL, shots = [];
    HTMLCanvasElement.prototype.toDataURL = function (...a) { const d = tdu.apply(this, a); if (this.width > 1000 && /^data:image\//.test(d)) shots.push(d); return d; };
    const tb = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, ...a) { if (this.width > 1000) shots.push(tdu.call(this, 'image/png')); return tb.call(this, cb, ...a); };
    HTMLAnchorElement.prototype.click = function () {};
    try { navigator.share = () => Promise.resolve(); navigator.canShare = () => false; } catch (e) {}
    if (kind === 'pdf') await saveFillablePdf(); else { await saveSmart(); }
    await new Promise(r => setTimeout(r, kind === 'pdf' ? 1500 : 6000));
    HTMLCanvasElement.prototype.toDataURL = tdu; HTMLCanvasElement.prototype.toBlob = tb;
    return shots[shots.length - 1];                       // page 2
  }, kind);
}
// The y position of every long horizontal rule (table grid lines, footer lines) on the page image.
async function rules(page, dataUrl, thr = 140) {
  return page.evaluate(async ([d, thr]) => {
    const img = new Image(); img.src = d; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data, ys = [];
    const x0 = Math.round(img.width * 0.05), x1 = Math.round(img.width * 0.95);
    let prev = false; const rows = [];
    for (let y = 0; y < img.height; y++) {
      let dark = 0;
      for (let x = x0; x < x1; x += 2) { const i = (y * img.width + x) * 4; if ((px[i] + px[i + 1] + px[i + 2]) / 3 < thr) dark++; }
      const on = dark > (x1 - x0) / 2 * 0.25;                // a quarter of the width or more = a ruled line
      if (on && !prev) ys.push(y);
      if (on) rows.push(y);
      prev = on;
    }
    return { w: img.width, h: img.height, ys, rows };
  }, [dataUrl, thr]);
}

// Lines found at the normal darkness on one image must exist on the other at a slightly looser
// darkness (JPEG and anti-aliasing move a borderline hairline just over or under the cut-off).
async function mismatched(page, A, B) {
  const a = await rules(page, A, 140), b = await rules(page, B, 140), a2 = await rules(page, A, 175), b2 = await rules(page, B, 175);
  const near = (y, list) => list.some(v => Math.abs(v - y) <= 2);
  return { a, b, off: a.ys.filter(y => !near(y, b2.rows)).concat(b.ys.filter(y => !near(y, a2.rows))) };
}

test('page 2 PDF✎: Elect Install lines up with Site Visit, row for row', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const sv = await page2Pdf(page, 'site-visit');
  const p2 = await browser.newPage();
  const ei = await page2Pdf(p2, 'elect-install');
  const { a, b, off } = await mismatched(page, sv, ei);
  expect([b.w, b.h]).toEqual([a.w, a.h]);
  expect(a.ys.length).toBeGreaterThan(30);
  expect(off, `ruled lines that don't line up\nSV ${a.ys}\nEI ${b.ys}`).toEqual([]);
  await p2.close();
});

// CAPTURE pictures look the same as PDF✎: Site Visit's own CAPTURE and Elect Install's CAPTURE both
// line up with Site Visit's PDF✎ page 2.
for (const form of ['site-visit', 'elect-install']) test(`page 2 CAPTURE (${form}) lines up with Site Visit's PDF✎`, async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const sv = await page2Pdf(page, 'site-visit', 'pdf');
  const p2 = await browser.newPage();
  const cap = await page2Pdf(p2, form, 'capture');
  const { a, b, off } = await mismatched(page, sv, cap);
  expect([b.w, b.h]).toEqual([a.w, a.h]);
  expect(off, `ruled lines that don't line up\nPDF ${a.ys}\nCAPTURE ${b.ys}`).toEqual([]);
  await p2.close();
});

// Empty Length boxes show no "—" on page 2, in light AND dark mode, on both forms.
for (const theme of ['light', 'dark']) test(`page 2 shows no dashes in empty boxes (${theme})`, async ({ page }) => {
  const bad = [];
  for (const form of ['site-visit', 'elect-install']) {
    expect(await open(page, `/${form}/`, { settle: 600, theme })).toEqual([]);
    const seen = await page.evaluate(() => [...document.querySelectorAll('input[placeholder="—"]')].filter(i => i.offsetParent)
      .map(i => getComputedStyle(i, '::placeholder').color).filter(c => !/rgba\(0, 0, 0, 0\)|transparent/.test(c)));
    if (seen.length) bad.push(`${form}: ${seen.length} visible`);
  }
  expect(bad).toEqual([]);
});
