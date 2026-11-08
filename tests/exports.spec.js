// Saved images / PDFs: same size every time, and never dark or themed.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test('Maintenance: the saved image is the same size every run', async ({ page }) => {
  expect(await open(page, '/maintenance/', { settle: 1500 })).toEqual([]);
  const sizes = await page.evaluate(async () => {
    const seen = [];
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (img, ...a) {
      if (this.canvas.width === 1632 && img instanceof HTMLCanvasElement) seen.push(img.width + 'x' + img.height);
      return draw.call(this, img, ...a);
    };
    for (let i = 0; i < 3; i++) { await capturePageToCanvas(); await new Promise(r => setTimeout(r, 200)); }
    CanvasRenderingContext2D.prototype.drawImage = draw;
    return seen;
  });
  expect(sizes.length).toBe(3);
  expect(new Set(sizes).size, `sizes: ${sizes.join(', ')}`).toBe(1);
});

test('Estimate: PDF✎ builds a real-text PDF on one page and restores the form', async ({ page }) => {
  expect(await open(page, '/estimate/', { settle: 1500 })).toEqual([]);
  const res = await page.evaluate(async () => {
    const nameInp = [...document.querySelectorAll('#page input[type=text], #page input:not([type])')][0];
    nameInp.value = 'ZZSPECCHECK'; nameInp.dispatchEvent(new Event('input', { bubbles: true }));
    const pdf = await _estimateTextPdf();
    const head = new TextDecoder().decode(new Uint8Array(pdf.output('arraybuffer')).slice(0, 5));
    return {
      pages: pdf.getNumberOfPages(),
      isPdf: head === '%PDF-',
      leftoverSpans: document.querySelectorAll('[data-pdf-text]').length,
      leftoverForceStyle: !!document.getElementById('capture-force-style'),
      leftoverDots: document.querySelectorAll('[data-capture-dot]').length,
      leftoverIcons: document.querySelectorAll('[data-capture-icon]').length,
      leftoverIconImgs: document.querySelectorAll('[data-pdf-icon]').length,
      nameStillThere: getComputedStyle(nameInp).display !== 'none' && nameInp.value === 'ZZSPECCHECK',
      pageWidthReset: document.getElementById('page').style.width === ''
    };
  });
  expect(res.isPdf, 'output is a PDF').toBe(true);
  expect(res.pages, 'a lightly-filled estimate fits one page (no blank 2nd page)').toBe(1);
  expect(res.leftoverSpans, 'text spans removed after export').toBe(0);
  expect(res.leftoverForceStyle, 'print stylesheet removed after export').toBe(false);
  expect(res.leftoverDots).toBe(0);
  expect(res.leftoverIcons).toBe(0);
  expect(res.leftoverIconImgs, 'temporary icon images removed after export').toBe(0);
  expect(res.nameStillThere, 'form controls restored and still editable after export').toBe(true);
  expect(res.pageWidthReset, '#page width reset after export').toBe(true);
});

test('Maintenance: PDF✎ builds a real-text PDF and restores the form', async ({ page }) => {
  expect(await open(page, '/maintenance/', { settle: 1500 })).toEqual([]);
  const res = await page.evaluate(async () => {
    const nameInp = document.getElementById('name');
    nameInp.value = 'ZZSPECCHECK'; nameInp.dispatchEvent(new Event('input', { bubbles: true }));
    const pdf = await _maintenanceTextPdf();
    const head = new TextDecoder().decode(new Uint8Array(pdf.output('arraybuffer')).slice(0, 5));
    return {
      pages: pdf.getNumberOfPages(),
      isPdf: head === '%PDF-',
      leftoverSpans: document.querySelectorAll('[data-pdf-text]').length,
      leftoverProxies: document.querySelectorAll('[data-pdf-proxy]').length,
      leftoverForceStyle: !!document.getElementById('pdf-text-force-style'),
      nameStillThere: getComputedStyle(nameInp).display !== 'none' && nameInp.value === 'ZZSPECCHECK',
      textareaVisible: (function () { const t = document.querySelector('#page textarea'); return t ? getComputedStyle(t).display !== 'none' : true; })()
    };
  });
  expect(res.isPdf, 'output is a PDF').toBe(true);
  expect(res.pages, 'maintenance fits one page').toBe(1);
  expect(res.leftoverSpans, 'text spans removed after export').toBe(0);
  expect(res.leftoverProxies, 'note/box proxies removed after export').toBe(0);
  expect(res.leftoverForceStyle, 'print stylesheet removed after export').toBe(false);
  expect(res.nameStillThere, 'form controls restored and still editable after export').toBe(true);
  expect(res.textareaVisible, 'notes textarea restored after export').toBe(true);
});

test('Estimate: the saved image is the same size every run', async ({ page }) => {
  expect(await open(page, '/estimate/', { settle: 1500 })).toEqual([]);
  const sizes = await page.evaluate(async () => {
    const seen = [];
    for (let i = 0; i < 3; i++) { const c = await capturePageToCanvas(); seen.push(c.width + 'x' + c.height); await new Promise(r => setTimeout(r, 200)); }
    return seen;
  });
  expect(sizes.length).toBe(3);
  expect(new Set(sizes).size, `sizes: ${sizes.join(', ')}`).toBe(1);
});

test('Load Calc: SAVE IMG is identical in light and dark mode', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'runs once');
  const shot = async theme => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    expect(await open(page, '/load-calcs/', { theme, settle: 1500 })).toEqual([]);
    const data = await page.evaluate(() => new Promise(resolve => {
      const orig = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb, ...a) { resolve(this.toDataURL()); return orig.call(this, cb, ...a); };
      captureReport();
      setTimeout(() => resolve(null), 20000);
    }));
    await ctx.close();
    return data;
  };
  const light = await shot('light'), dark = await shot('dark');
  expect(light).toBeTruthy();
  expect(dark === light, 'dark-mode export differs from light-mode export').toBe(true);
});
