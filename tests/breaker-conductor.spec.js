// Breaker & Conductor — checked against an independent NEC 2023 reference over every combination.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'math checks run once'));

test.beforeEach(async ({ page }) => {
  const errors = await open(page, '/breaker-conductor/');
  expect(errors).toEqual([]);
});

test('never picks a wire smaller than the NEC allows (full sweep)', async ({ page }) => {
  const r = await page.evaluate(() => {
    // Independent reference: Tables 310.16 / 310.15(B)(1)(1) / 310.15(C)(1), 240.4(B)/(D), 310.10(G), 310.12
    const corr = {10:[1.29,1.20,1.15],15:[1.22,1.15,1.12],20:[1.15,1.11,1.08],25:[1.08,1.05,1.04],30:[1,1,1],35:[0.91,0.94,0.96],40:[0.82,0.88,0.91],45:[0.71,0.82,0.87],50:[0.58,0.75,0.82],55:[0.41,0.67,0.76],60:[0,0.58,0.71],65:[0,0.47,0.65],70:[0,0.33,0.58],75:[0,0,0.50],80:[0,0,0.41],85:[0,0,0.29]};
    const adj = {3:1,4:.8,7:.7,10:.5,21:.45,31:.4,41:.35};
    const std = [10,15,20,25,30,35,40,45,50,60,70,80,90,100,110,125,150,175,200,225,250,300,350,400,450,500,600,700,800,1000,1200,1600,2000,2500,3000,4000,5000,6000];
    const small = {copper:{'14 AWG':15,'12 AWG':20,'10 AWG':30}, aluminum:{'12 AWG':15,'10 AWG':25}};
    const sizes = cuTable.map(x => x.size);
    function ref(B, mat, tc, amb, ccc, n, rb, app) {
      const t = mat === 'copper' ? cuTable : alTable, ti = tc === 60 ? 0 : tc === 90 ? 2 : 1, f = corr[amb][ti] * adj[ccc];
      if (corr[amb][ti] === 0) return 'ERR';
      if (app === 'dwelling') {
        if (B < 100 || B > 400 || n > 1) return 'ERR';
        for (const x of t) if (Math.min(x.a75 * f, x.a75) >= B * 0.83) return x.size;
        return 'ERR';
      }
      if (tc === 90 && f === 1) return 'ERR';
      for (const x of t) {
        const use = Math.min(x['a' + tc] * f, tc === 60 ? x.a60 : x.a75);
        const lim = small[mat][x.size]; if (lim && B > lim) continue;
        const tot = use * n;
        const ok = tot >= B || (rb && !lim && B <= 800 && std.indexOf(tot) < 0 && std.find(s => s >= tot) >= B);
        if (ok) return (n > 1 && sizes.indexOf(x.size) < sizes.indexOf('1/0 AWG')) ? '1/0 AWG' : x.size;
      }
      return 'ERR';
    }
    let cases = 0; const unsafe = [];
    for (const app of ['general', 'dwelling']) for (const B of STD) for (const mat of ['copper', 'aluminum'])
    for (const tc of [60, 75, 90]) for (const amb of Object.keys(AMB).map(Number)) for (const ccc of [3, 4, 7, 10, 21, 31, 41])
    for (const n of (app === 'dwelling' ? [1] : [1, 2, 3, 4])) for (const rb of (app === 'dwelling' ? [false] : [false, true])) {
      if (rb && B > 800) continue;
      if (app === 'dwelling' && (B < 100 || B > 400 || amb > 30 || ccc !== 3)) continue;
      S = { breaker: B, gen: null, mat, app, tc, amb, ccc, sets: n, rb, gmode: 'np', gpct: 100 };
      const R = solve(), tool = R.errs.length ? 'ERR' : R.row.size, want = ref(B, mat, tc, amb, ccc, n, rb, app);
      cases++;
      if (tool === want) continue;
      if (tool !== 'ERR' && (want === 'ERR' || sizes.indexOf(tool) < sizes.indexOf(want)))
        unsafe.push([app, B + 'A', mat, tc + 'C', amb + 'C amb', ccc + ' CCC', n + ' sets', rb ? 'round-up' : '', '→ tool', tool, 'NEC', want].join(' '));
    }
    return { cases, unsafe: unsafe.slice(0, 20) };
  });
  expect(r.cases).toBeGreaterThan(100000);
  expect(r.unsafe, 'tool picked a smaller wire than the NEC allows').toEqual([]);
});

test('known answers', async ({ page }) => {
  const r = await page.evaluate(() => {
    const run = o => { S = Object.assign({ breaker: 100, gen: null, mat: 'copper', app: 'general', tc: 75, amb: 30, ccc: 3, sets: 1, rb: false, gmode: 'np', gpct: 100 }, o); const R = solve(); return R.errs.length ? 'ERR' : R.row.size; };
    return {
      cu100: run({ breaker: 100 }),
      cu200: run({ breaker: 200 }),
      home200: run({ breaker: 200, app: 'dwelling' }),
      par200: run({ breaker: 200, sets: 2 }),
      al100: run({ breaker: 100, mat: 'aluminum' }),
    };
  });
  expect(r).toEqual({ cu100: '3 AWG', cu200: '3/0 AWG', home200: '2/0 AWG', par200: '1/0 AWG', al100: '1 AWG' });
});
