// Elect Install's page 2 comes out of PDF✎ / CAPTURE looking exactly like Site Visit's page 2
// (Brandon's pick). The two pages share the same markup; Elect Install copies Site Visit's look
// at capture time (see "PAGE 2 = SITE VISIT'S PAGE 2" in elect-install/index.html).
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

async function page2Pdf(page, form) {
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { try { window.showSaveFilePicker = undefined; } catch (e) {} });
  expect(await open(page, `/${form}/`, { settle: 1200, theme: 'light' })).toEqual([]);
  return page.evaluate(async () => {
    const tdu = HTMLCanvasElement.prototype.toDataURL, shots = [];
    HTMLCanvasElement.prototype.toDataURL = function (...a) { const d = tdu.apply(this, a); if (this.width > 1000) shots.push(d); return d; };
    HTMLAnchorElement.prototype.click = function () {};
    try { navigator.share = () => Promise.resolve(); navigator.canShare = () => false; } catch (e) {}
    await saveFillablePdf(); await new Promise(r => setTimeout(r, 1500));
    HTMLCanvasElement.prototype.toDataURL = tdu;
    return shots[shots.length - 1];                       // page 2
  });
}
// The y position of every long horizontal rule (table grid lines, footer lines) on the page image.
async function rules(page, dataUrl) {
  return page.evaluate(async d => {
    const img = new Image(); img.src = d; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data, ys = [];
    const x0 = Math.round(img.width * 0.05), x1 = Math.round(img.width * 0.95);
    let prev = false;
    for (let y = 0; y < img.height; y++) {
      let dark = 0;
      for (let x = x0; x < x1; x += 2) { const i = (y * img.width + x) * 4; if ((px[i] + px[i + 1] + px[i + 2]) / 3 < 140) dark++; }
      const on = dark > (x1 - x0) / 2 * 0.25;                // a quarter of the width or more = a ruled line
      if (on && !prev) ys.push(y);
      prev = on;
    }
    return { w: img.width, h: img.height, ys };
  }, dataUrl);
}

test('page 2 PDF✎: Elect Install lines up with Site Visit, row for row', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const sv = await page2Pdf(page, 'site-visit');
  const p2 = await browser.newPage();
  const ei = await page2Pdf(p2, 'elect-install');
  const a = await rules(page, sv), b = await rules(page, ei);
  expect([b.w, b.h]).toEqual([a.w, a.h]);
  expect(a.ys.length).toBeGreaterThan(30);
  const off = a.ys.filter(y => !b.ys.some(v => Math.abs(v - y) <= 2)).concat(b.ys.filter(y => !a.ys.some(v => Math.abs(v - y) <= 2)));
  expect(off, `ruled lines that don't line up\nSV ${a.ys}\nEI ${b.ys}`).toEqual([]);
  await p2.close();
});
