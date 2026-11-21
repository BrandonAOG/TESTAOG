// Property Lookup on a touch device: map overlays must swallow their own taps.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test('Property Lookup: tapping the 📝 certificate note opens it and does NOT also run a lookup on the map underneath', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'touch device');
  expect(await open(page, '/property-lookup/', { settle: 1500 })).toEqual([]);
  await page.evaluate(() => {
    window.__opened = []; window.__looked = 0;
    window._openLinkNewTab = u => window.__opened.push(u);
    const _rl = window.runLookup; window.runLookup = function () { window.__looked++; };
    window._collierTapUnits = async () => { window.__looked++; return true; };
    // reveal the map the same way a lookup does, then drop a note in the middle of it
    document.body.classList.add('has-results');
    map.setView([26.2577, -81.8211], 18, { animate: false });
    _ecMakeNote(26.2577, -81.8211, 'https://florida.withforerunner.com/view-file/abc').addTo(ecLookupLayer);
    ecLookupLayer.addTo(map);
  });
  const note = page.locator('.ec-note').first();
  await note.scrollIntoViewIfNeeded();
  await note.tap();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ opened: window.__opened, looked: window.__looked }));
  expect(r.opened).toEqual(['https://florida.withforerunner.com/view-file/abc']);
  expect(r.looked).toBe(0);
});

test('Property Lookup: the 📝 certificate note has a ~44px finger target, so a near-miss is not a map tap', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'touch device');
  expect(await open(page, '/property-lookup/', { settle: 1500 })).toEqual([]);
  await page.evaluate(() => {
    document.body.classList.add('has-results');
    map.setView([26.2577, -81.8211], 18, { animate: false });
    _ecMakeNote(26.2577, -81.8211, 'https://florida.withforerunner.com/view-file/abc').addTo(ecLookupLayer);
    ecLookupLayer.addTo(map);
  });
  const box = await page.locator('.ec-note').first().boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // The glyph is 22px; a fingertip lands up to ~20px off. Every one of these points must belong to the note.
  const hits = await page.evaluate(([cx, cy]) => [[18, 0], [-18, 0], [0, 18], [0, -18], [13, 13]].map(([dx, dy]) => {
    const e = document.elementFromPoint(cx + dx, cy + dy); return !!(e && e.closest('.ec-note'));
  }), [cx, cy]);
  expect(hits).toEqual([true, true, true, true, true]);
  expect(box.width).toBe(22);                                   // looks the same — only the target grew
});
