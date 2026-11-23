// Electrical Theory — PANEL · SHARED (v3.1.4): one battery bank feeding the inverters of BOTH panels (EG4 18kPV manual §8.2–8.3).
// Brandon (Nov 2026): "the shared bank should be an option A B BOTH SHARED" · "text under lines and paralleling shows going
// through batteries — make sure it looks good on all available options" · "what if there is 3 or 4 inverters".
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

async function shared(page, na, nb, nbat, extra) {
  await page.evaluate(([na, nb, nbat, extra]) => {
    document.querySelector('[data-svc="400"]').click(); document.getElementById('solarBtn').click(); document.getElementById('battBtn').click(); render();
    pnlPick('shared'); if (na > 1) derSet('ninv', na); if (nb > 1) sysBSet('n', nb); nBat = nbat; if (extra) eval(extra); render();
  }, [na, nb, nbat, extra || '']);
  await page.waitForTimeout(250);
}
// every line / path drawn on top of a label it runs through
const crossings = () => {
  const svg = document.getElementById('svg'), ord = [...svg.querySelectorAll('*')], idx = new Map(ord.map((e, i) => [e, i]));
  const T = [...svg.querySelectorAll('text')].map(t => ({ t, r: t.getBoundingClientRect() })).filter(o => o.r.width > 0 && o.t.textContent.trim());
  const out = new Set();
  for (const p of svg.querySelectorAll('path,line')) { const st = p.getAttribute('stroke'); if (!st || st === 'none' || st === 'transparent') continue;
    let L; try { L = p.getTotalLength(); } catch (e) { continue; } if (!L || L < 20) continue; const M = p.getScreenCTM(), N = Math.min(400, Math.ceil(L / 3));
    for (let i = 0; i <= N; i++) { const q = p.getPointAtLength(L * i / N), s = new DOMPoint(q.x, q.y).matrixTransform(M);
      for (const o of T) { const r = o.r; if (s.x > r.left + 1 && s.x < r.right - 1 && s.y > r.top + 2 && s.y < r.bottom - 2 && idx.get(p) > idx.get(o.t) && o.t.textContent.length > 2) out.add(o.t.textContent.slice(0, 50)); } } }
  return [...out];
};

test('SHARED sits next to A · B · BOTH and needs a whole-home battery', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  expect(await open(page, '/electrical-theory/', { settle: 1200 })).toEqual([]);
  const r = await page.evaluate(() => { document.querySelector('[data-svc="400"]').click(); document.getElementById('solarBtn').click(); render();
    pnlPick('shared'); const refused = !bankShared && /needs a whole-home battery/.test(ckMsg);
    document.getElementById('battBtn').click(); render(); pnlPick('shared'); render();
    const words = [...document.querySelectorAll('#svg text')].map(t => t.textContent).join(' | ');
    return { refused, on: bankShared, pnl: pvPanel, labels: ['A', 'B', 'BOTH', 'SHARED'].every(w => words.includes(w)), cap: /SHARED BANK × \d/.test(words), follows: /HYBRID INVERTER B[\s\S]*follows #1/.test(words) || words.includes('follows #1') }; });
  expect(r.refused, 'no battery → SHARED explains instead of switching').toBe(true);
  expect(r).toMatchObject({ on: true, pnl: 'both', labels: true, cap: true, follows: true });
  // back to BOTH → two separate systems again
  expect(await page.evaluate(() => { pnlPick('both'); render(); return bankShared; })).toBe(false);
});

test('one bank: inverters A and B both drain it, and B shows the same state of charge', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  expect(await open(page, '/electrical-theory/', { settle: 1200 })).toEqual([]);
  await shared(page, 1, 1, 2);
  const r = await page.evaluate(() => { sunMode = 'night'; derSun = false; battPri = 'self'; render();
    const D = derState(), B = sysB(), s0 = derSoc; derTickT = Date.now() - 2000; derTick();
    return { a: D.batt, b: B.batt, d: derSoc - s0, want: (D.batt + B.batt) * 2 * (DER_TS / 60) / derKwh() * 100, socB: derSocB, soc: derSoc }; });
  expect(r.a).toBeLessThan(0); expect(r.b).toBeLessThan(0);
  expect(r.d).toBeCloseTo(r.want, 6);
  expect(r.socB).toBe(r.soc);
});

test('the paralleling cable daisy-chains every inverter, A and B', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  expect(await open(page, '/electrical-theory/', { settle: 1200 })).toEqual([]);
  for (const [na, nb, chain] of [[1, 1, 'A – B · terminate the two end units (A, B)'], [2, 2, '#2 – #1 – B1 – B2 · terminate the two end units (#2, B2)'], [3, 3, '#3 – #2 – #1 – B1 – B2 – B3']]) {
    await open(page, '/electrical-theory/', { settle: 900 });
    await shared(page, na, nb, 3);
    const w = await page.evaluate(() => [...document.querySelectorAll('#svg text')].map(t => t.textContent).join(' | '));
    expect(w).toContain('daisy-chain ' + chain);
    expect(w).toContain('ONE paralleled system: ' + (na + nb) + ' inverters share one bank');
    expect(w).not.toContain('leads system B');
  }
});

test('no wire runs through a label, for every inverter / battery count', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'sweep — runs once');
  test.setTimeout(180000);
  const errs = []; page.on('pageerror', e => { if (!/AudioContext/.test(e.message)) errs.push(e.message); });
  const bad = [];
  for (const [na, nb, nbat, extra] of [[1, 1, 2], [1, 1, 5], [2, 1, 3], [1, 2, 2], [2, 2, 5], [3, 1, 2], [1, 3, 4], [3, 3, 5],
    [2, 3, 5, "derSet('how','ftap')"], [3, 3, 5, "document.getElementById('genBtn').click()"]]) {
    await open(page, '/electrical-theory/', { settle: 900 });
    await shared(page, na, nb, nbat, extra);
    const hit = (await page.evaluate(crossings)).filter(t => !/^(N|G|GEC · 250\.24)/.test(t));   // N / G letters on the panel and the service-tap GEC label predate this
    if (hit.length) bad.push([na, nb, nbat, extra || ''].join(',') + ' → ' + hit.join(' ‖ '));
  }
  expect(errs).toEqual([]);
  expect(bad).toEqual([]);
});
