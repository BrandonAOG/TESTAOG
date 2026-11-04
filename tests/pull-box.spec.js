// Pull box (NEC 2023 314.28) — a U pull (both same-conductor entries on ONE wall) must drive
// that wall's length to seat the two entries 6× the larger raceway apart (314.28(A)(2) last
// sentence). Before the fix this went into the pairs list for display only and the wall length
// showed "—".
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'math checks run once'));

test('U pull on the bottom wall drives the WIDTH (2" + 2" → ≥12" separation)', async ({ page }) => {
  expect(await open(page, '/pull-box/')).toEqual([]);
  const r = await page.evaluate(() => {
    const st = { valid: [
      { id: 'a', wall: 'B', row: 1, run: 1, size: 2, ts: '2', label: 'P1', pair: 'b', geo: 'u', spliced: false },
      { id: 'b', wall: 'B', row: 1, run: 1, size: 2, ts: '2', label: 'P1', pair: 'a', geo: 'u', spliced: false },
    ], cond: '4', condType: 'std', cover: false, actW: 0, actH: 0, actD: 0, runWarn: [] };
    const c = compute(st);
    return { w: c.req.w, h: c.req.h, hasULine: c.lines.some(l => /U-pull spacing/.test(l.rule)),
             pairVal: (c.pairs[0] || {}).val };
  });
  // opposite-wall rule still sizes height: 6×2 + 2 = 14
  expect(r.h).toBeCloseTo(14, 5);
  // the pair table still reports the pure NEC 6×2 = 12 separation
  expect(r.pairVal).toBeCloseTo(12, 5);
  // width is now driven by the U-pull separation — at least the 12" code minimum, no longer "—"
  expect(r.w).toBeGreaterThanOrEqual(12);
  expect(r.hasULine).toBe(true);
});

test('a pair on OPPOSITE walls gets no U-pull width line (only same-wall U pulls do)', async ({ page }) => {
  expect(await open(page, '/pull-box/')).toEqual([]);
  const r = await page.evaluate(() => {
    const st = { valid: [
      { id: 'a', wall: 'L', row: 1, run: 1, size: 3, ts: '3', label: 'S1', pair: 'b', geo: 'straight', spliced: false },
      { id: 'b', wall: 'R', row: 1, run: 1, size: 3, ts: '3', label: 'S1', pair: 'a', geo: 'straight', spliced: false },
    ], cond: '4', condType: 'std', cover: false, actW: 0, actH: 0, actD: 0, runWarn: [] };
    const c = compute(st);
    return { w: c.req.w, hasULine: c.lines.some(l => /U-pull spacing/.test(l.rule)) };
  });
  expect(r.w).toBeGreaterThan(0);   // still sized by the normal rules
  expect(r.hasULine).toBe(false);   // entries on different walls → not a same-wall U pull
});
