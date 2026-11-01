// Printed forms show which app version made them ("Ver 3.0.0"), taken from sw.js — and never Brandon / BrandonAOG.
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { ROOT, open } = require('./helpers');
const SW_VER = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/var CACHE_VERSION = 'v([\d.]+)'/)[1];
const PRINTED = { estimate: '#page', maintenance: '#page', 'qc-checklist': '#page1', 'service-work': '#page1' };

test.use({ serviceWorkers: 'allow' });
for (const [form, pageSel] of Object.entries(PRINTED)) test(`${form}: the printed footer shows Ver ${SW_VER}`, async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  expect(await open(page, `/${form}/`, { settle: 800 })).toEqual([]);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(800);       // now served by the app's offline engine
  const stamps = page.locator('[data-aog-version]');
  expect(await stamps.count()).toBeGreaterThan(0);
  for (const t of await stamps.allTextContents()) expect(t).toBe(`Ver ${SW_VER}`);
  // it's inside the printable page and visible when printing
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator(`${pageSel} [data-aog-version]`).first()).toBeVisible();
  const printed = await page.evaluate(sel => document.querySelector(sel).innerText, pageSel);
  expect(printed, 'no Brandon / BrandonAOG on the printed form').not.toMatch(/brandon/i);
});

test('the version is remembered for offline use', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  await open(page, '/maintenance/', { settle: 600 });
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(600);
  expect(await page.evaluate(() => localStorage.getItem('aog-app-version'))).toBe(`Ver ${SW_VER}`);
});
