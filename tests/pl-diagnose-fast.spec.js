// Property Lookup — "Diagnose live feeds" with a dead city server (v3.1.4). Brandon (23 Nov 2026): "feel like it takes a long
// time to pop up anything — I guess because it keeps trying the downed links". Rows now draw at once and fill as each
// probe answers; a dead host is probed once, not once per feed.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test('diagnose shows rows right away and does not wait on a dead host once per feed', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  test.setTimeout(60000);
  const deadHits = [];
  await page.route(/g\.naplesgov\.com/, r => { deadHits.push(r.request().url()); /* never answers */ });
  await page.route(/arcgis\.com|hazards\.fema\.gov|asce\.org/, r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ name: 'Layer', fields: [{ name: 'OBJECTID' }] }) }));
  expect(await open(page, '/property-lookup/', { settle: 1000 })).toEqual([]);
  const r = await page.evaluate(async () => {
    lastLoc = { lat: 26.1932, lng: -81.80479 }; window.__lastCounty = 'Collier'; window.__lastCity = 'Naples';
    const out = document.getElementById('diagStatus'); const t0 = performance.now();
    const done = diagnoseLiveFeeds();
    await new Promise(res => setTimeout(res, 1500));
    const early = { rows: out.children.length - 1, checking: out.querySelectorAll('[id^=dg]').length, filled: (out.innerHTML.match(/LIVE-OK/g) || []).length };
    await done;
    return { early, ms: performance.now() - t0, unreach: (out.innerHTML.match(/UNREACHABLE/g) || []).length, notAgain: (out.innerHTML.match(/not probed again/g) || []).length, head: out.firstElementChild.textContent };
  });
  expect(r.early.rows).toBeGreaterThan(3);              // every row is on screen right away
  expect(r.early.filled).toBeGreaterThan(0);            // the working feeds already answered
  expect(r.early.checking).toBeGreaterThan(0);          // …while the dead host's rows still say checking
  expect(r.unreach).toBeGreaterThan(1);
  expect(r.ms, 'the dead host is waited on once (in parallel), not once per feed').toBeLessThan(16000);
  expect(r.head).toMatch(/not responding: g\.naplesgov\.com/);
});
