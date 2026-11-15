// Electrical Theory: the panel one-line runs in every system and the teaching behaviours stay correct.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

const SYSTEMS = ['single', 'v208', 'v480', 'highleg', 'cgd', 'ungd'];

test('every system draws, faults and resets without a script error', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  for (const s of SYSTEMS) {
    await page.evaluate(sys => document.querySelector(`[data-sys="${sys}"]`).click(), s);
    await page.evaluate(() => { applyFault(3); faultFeeder(SYS[MODE].ph[0][0]); faultService(SYS[MODE].ph[0][0]); clearFault(); render(); });
  }
  await page.waitForTimeout(300);
  expect(errs).toEqual([]);
});

test('branch bus: 1 and 2 share a phase · stacked bus: the right side is reversed', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const r = await page.evaluate(() => {
    const out = {}; out.branch = [phaseOfCkt(1), phaseOfCkt(2), phaseOfCkt(3), phaseOfCkt(4)];
    busToggle(); out.stacked = [phaseOfCkt(1), phaseOfCkt(2), phaseOfCkt(3), phaseOfCkt(4)];
    document.querySelector('[data-sys="v208"]').click(); out.stacked3 = [phaseOfCkt(2), phaseOfCkt(4), phaseOfCkt(6)];
    return out; });
  expect(r).toEqual({ branch: ['L1', 'L1', 'L2', 'L2'], stacked: ['L1', 'L2', 'L2', 'L1'], stacked3: ['C', 'B', 'A'] });
});

test('pool feeder fault with the pool EGC broken does not trip the 100 A breaker', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  await page.evaluate(() => { document.getElementById('poolBtn').click(); poolEgcSet('broken'); poolFdrK = 0; applyFault(2); });
  await page.waitForTimeout(2600);
  const r = await page.evaluate(() => ({ on: isOn(2), msg: document.getElementById('readout').innerText }));
  expect(r.on).toBe(true);
  expect(r.msg).toMatch(/EGC OPEN/);
});

test('line-side service fault explains it returns on the service neutral, not the EGC', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const msg = await page.evaluate(() => { faultService('L1'); return document.getElementById('readout').innerText; });
  expect(msg).toMatch(/service neutral/);
  expect(msg).toMatch(/feeder EGC and the panel ground bars carry none of it/);
});

test('tapping a load opens its menu: range offers L2 ↔ N, A/C has no polarity', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const tap = async name => {
    const t = await page.evaluateHandle(n => [...document.querySelectorAll('#svg text')].find(e => e.textContent === n), name);
    await t.scrollIntoViewIfNeeded(); const b = await t.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  };
  await tap('Range');
  await expect(page.locator('#ckMenu')).toContainText('L2 ↔ N');
  await page.locator('#ckX').click();
  await tap('A/C condenser');
  await expect(page.locator('#ckMenu')).toContainText('n/a');
});
