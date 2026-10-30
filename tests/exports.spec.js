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
