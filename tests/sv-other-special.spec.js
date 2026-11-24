// Site Visit — the Other / Special box on page 1 runs down to the footer when printed or saved (v3.1.6).
// Brandon (Nov 2026): "make it extend to the rest of the page to the footer so if the guys print it out they have a
// bigger place to draw".
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test('PDF / capture: page 1 comes out sheet-shaped, with the spare room in the Other / Special box', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  test.setTimeout(60000);
  expect(await open(page, '/site-visit/', { settle: 1000 })).toEqual([]);
  const r = await page.evaluate(async () => {
    const c = await pdfRenderPageCanvases();
    return { ratio2: c[1].height / c[1].width, ratio: c[0].height / c[0].width, sheet: (11 - 0.3) / (8.5 - 0.3), inline: document.querySelector('.os-fill .other-special-notes').style.height };
  });
  expect(r.ratio).toBeLessThanOrEqual(r.sheet);                 // never taller than the sheet (no squashing)
  expect(r.ratio).toBeGreaterThan(r.sheet - 0.015);             // …and no big empty band under the footer
  expect(r.ratio2).toBeGreaterThan(r.sheet - 0.015);            // page 2's footer drops to the bottom too, same spacing
  expect(r.ratio2).toBeLessThanOrEqual(r.sheet);
  expect(r.inline).toBe('');                                    // only the render copy grows; the form on screen keeps no extra height
});

test('desktop print: page 1 stays one sheet and the box fills down to the footer', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  await page.setViewportSize({ width: 784, height: 1000 });
  expect(await open(page, '/site-visit/', { settle: 800 })).toEqual([]);
  await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(300);
  const g = await page.evaluate(() => { const p = document.getElementById('page1').getBoundingClientRect(), b = document.querySelector('.os-fill .other-special-notes').getBoundingClientRect(),
    f = document.querySelector('#page1 .aog-printfoot').getBoundingClientRect(); return { pageH: p.height, boxH: b.height, gap: f.top - b.bottom, footInside: f.bottom <= p.bottom + 1 }; });
  expect(g.pageH).toBeCloseTo(10.7 * 96, 0);
  expect(g.boxH).toBeGreaterThan(150);
  expect(g.gap).toBeLessThan(40);
  expect(g.footInside).toBe(true);
});
