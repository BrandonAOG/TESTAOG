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

test('a 120 V circuit on L2 runs the opposite way to one on L1 — hot AND neutral (closed loop)', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const r = await page.evaluate(() => {
    const rows = {};   // y → dot directions on the straight run from the breaker / to the N bar
    dotPool.forEach(dp => { const m = dp.mp.getAttribute('d').match(/^M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)$/); if (m && m[2] === m[4]) rows[Math.round(+m[2])] = dp.dir; });
    return rows;
  });
  // circuit 1 (L1): hot y≈233 out, neutral y≈242 back · circuit 3 (L2): hot y≈258 back, neutral y≈267 out
  expect([r[233], r[242], r[258], r[267]]).toEqual([1, 1, -1, -1]);
});

test('panel main OFF: the feeder probes (line side of the main) still read voltage; service disconnect OFF kills them', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const r = await page.evaluate(() => {
    const read = () => voltBetween('L1', 'L2');
    const out = { on: read() };
    toggleLcMain(); out.mainOff = read(); out.msg = (probePick = ['L1', 'L2'], render(), document.getElementById('readout').innerText);
    toggleLcMain(); toggleSvc(); out.svcOff = read();
    return out; });
  expect(r.on).toBe(240);
  expect(r.mainOff).toBe(240);
  expect(r.msg).toMatch(/LINE side/);
  expect(r.svcOff).toBe(0);
});

test('breaker probes: read their own leg, 0 V when the breaker is off, and work across systems', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const r = await page.evaluate(() => {
    const v = (a, b) => voltBetween(a, b); const out = {};
    out.range = v('BK:5', 'BK:7');           // 2-pole L1–L2
    out.sameLeg = v('BK:2', 'BK:6');         // both L1
    out.toN = v('BK:1', 'N');
    toggleCkt(1); out.off = v('BK:1', 'N'); toggleCkt(1);
    document.querySelector('[data-sys="v208"]').click(); out.v208 = v('BK:1', 'BK:3');
    return out; });
  expect(r).toEqual({ range: 240, sameLeg: 0, toN: 120, off: 0, v208: 208 });
  expect(await page.locator('#svg circle[r="7"]').count()).toBeGreaterThan(20);   // one per breaker pole (empty spaces have none), same size as the feeder probes
  const msg = await page.evaluate(() => { document.querySelector('[data-sys="single"]').click();
    const m = {}; probePick = ['BK:24', 'N']; toggleCkt(22); m.off = document.getElementById('readout').innerText; toggleCkt(22);
    toggleLcMain(); m.dead = document.getElementById('readout').innerText; toggleLcMain(); return m; });
  expect(msg.off).toMatch(/Breaker 24 \(L2\) is OFF/);
  expect(msg.off).not.toMatch(/or its bus/);
  expect(msg.dead).toMatch(/bus is dead — the panel main is OFF/);
});
