// Property Lookup — a city server that doesn't answer must not freeze the card (v3.1.4).
// Brandon (23 Nov 2026), on 700 Park Shore Dr while g.naplesgov.com was down: "anything keeping the live code from reading?"
// The dead Naples elevation-certificate layer held the card ~16 s; the LIVE CODE panel gave up waiting for it after 10 s
// and sat on "loading Naples code…" for good.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test('a dead elevation-certificate server gives up fast instead of holding the card', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  await page.route(/g\.naplesgov\.com/, r => r.abort('timedout'));
  expect(await open(page, '/property-lookup/', { settle: 1000 })).toEqual([]);
  const r = await page.evaluate(async () => { const t0 = performance.now();
    const x = await queryEC('https://g.naplesgov.com/arcgis/rest/services/CityView/CityView_FloodPlainManagement/MapServer/1/query', 26.1932, -81.80479);
    return { ms: performance.now() - t0, x }; });
  expect(r.x.err).toMatch(/not responding/);
  expect(r.ms).toBeLessThan(7000);
});

test('the LIVE CODE panel still fills when its card mounts late', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  test.setTimeout(60000);
  expect(await open(page, '/property-lookup/', { settle: 1000 })).toEqual([]);
  const txt = await page.evaluate(async () => {
    const html = renderCodeFinder('Naples', 'Collier', 'Naples', 'R1-10A', true);
    await new Promise(r => setTimeout(r, 15000));                           // the card shows up 15 s later
    const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d);
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 250)); if (!/loading Naples code/.test(d.textContent)) break; }
    return d.textContent.replace(/\s+/g, ' ').slice(0, 200);
  });
  expect(txt).not.toMatch(/loading Naples code/);
  expect(txt).toMatch(/Naples/);
});
