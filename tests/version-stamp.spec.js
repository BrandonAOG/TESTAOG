// Printed forms show which app version made them ("Ver 3.0.0"), taken from sw.js — and never Brandon / BrandonAOG.
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { ROOT, open } = require('./helpers');
const SW_VER = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/var CACHE_VERSION = 'v([\d.]+)'/)[1];
const PRINTED = { estimate: '#page', maintenance: '#page', 'qc-checklist': '#page1', 'service-work': '#page1',
                  'site-visit': '#page1', 'pre-checklist': '#page1', 'elect-install': '#page1', 'gas-install': '#page1' };

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

test('every page of every form prints its footer with the page number', () => {
  test.skip(test.info().project.name !== 'desktop', 'file check');
  const bad = [];
  for (const f of ['site-visit', 'pre-checklist', 'elect-install', 'gas-install', 'qc-checklist', 'service-work']) {
    const src = fs.readFileSync(path.join(ROOT, f, 'index.html'), 'utf8');
    const pages = (src.match(/<div class="form-page" id="page\d">/g) || []).length;
    for (let i = 1; i <= pages; i++) if (!src.includes(`Page ${i} of ${pages} · <span data-aog-version></span>`)) bad.push(`${f} page ${i}`);
  }
  expect(bad).toEqual([]);
});

// Every form's printed page says "© <year> Always On Generators" — the year it's printed, so 2027 says 2027.
test('printed forms show © with the current year (and roll over to 2027 on their own)', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const PAGES = { estimate: '#page', maintenance: '#page', 'qc-checklist': '#page1', 'service-work': '#page1',
                  'site-visit': '#page1', 'pre-checklist': '#page1', 'elect-install': '#page1', 'gas-install': '#page1' };
  await page.clock.setFixedTime(new Date('2027-01-05T09:00:00'));
  const bad = [];
  for (const [form, sel] of Object.entries(PAGES)) {
    await open(page, `/${form}/`, { settle: 600 });
    await page.emulateMedia({ media: 'print' });
    const t = await page.evaluate(s => document.querySelector(s).innerText, sel);
    if (!/© 2027 Always On Generators/i.test(t)) bad.push(form);
    await page.emulateMedia({ media: 'screen' });
  }
  expect(bad).toEqual([]);
});
