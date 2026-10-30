// Gas Calc — pipe capacity never exceeds the NFPA 54 (2024) equation or published tables.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'math checks run once'));

test.beforeEach(async ({ page }) => {
  const errors = await open(page, '/gas-calc/');
  expect(errors).toEqual([]);
});

test('NFPA 54 table values are intact (spot cells)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cell = (id, len, col) => { const t = GR_TABLES.find(x => x.id === id); return t.r.find(x => x[0] === len)[col]; };
    return [cell('6.2.1(a)', 10, 1), cell('6.2.1(b)', 50, 4), cell('6.2.1(e)', 100, 3), cell('6.2.1(o)', 10, 6), cell('6.3.1(d)', 10, 1) > 0, GR_TABLES.length];
  });
  expect(r).toEqual([131, 583, 1710, 192, true, 24]);
});

test('steel and PE never carry more than the NFPA equation or table (full sweep)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const out = { checked: 0, overTable: 0, overEq: 0, ex: [] };
    for (const fuel of ['ng', 'lp']) { S.fuel = fuel; const f = F();
      for (const pl of [f.low, f.high, f.mid || []]) for (const pr of pl) for (const mat of ['steel', 'pe']) for (const drop of [0.5, 1, 3]) {
        S.drop = drop;
        for (let L = 5; L <= 500; L += 5) {
          const res = sizeRun({ len: L, mat, press: pr.v }, pl, 100, GM[0]); if (res.over) continue;
          const cm = codeTable(mat, res.p);
          res.rows.forEach((row, i) => {
            out.checked++;
            const cfh = row.cap * (fuel === 'lp' ? GM[0].lp_btu_gal / 2516 : 1);
            const d = Object.values(PIPE_ID[mat])[i], P = res.p; let eq;
            if (P.p1 !== undefined && P.p1 >= 1.5) { const P1 = P.p1 + 14.7, P2 = P1 - P.dp; eq = 2237 * Math.pow(d, 2.623) * Math.pow(((P1 * P1 - P2 * P2) * f.Y) / (f.Cr * L), 0.541); }
            else { const dh = P.p1 !== undefined ? P.dp * 27.68 : drop; eq = 2313 * Math.pow(d, 2.623) * Math.pow(dh / (f.Cr * L), 0.541); }
            if (cfh > eq * 1.001) { out.overEq++; if (out.ex.length < 5) out.ex.push(['equation', fuel, pr.v, mat, L, i, cfh, eq]); }
            if (cm && cm.exact) { const t = cm.t, u = t.u === 'k' ? 1000 / f.btuCf : 1, lo = [...t.r].reverse().find(x => x[0] <= L);
              if (lo && cfh > lo[i + 1] * u * 1.001) { out.overTable++; if (out.ex.length < 5) out.ex.push(['table', fuel, pr.v, mat, L, i, cfh, lo[i + 1] * u]); } }
          });
        }
      }
    }
    return out;
  });
  expect(r.checked).toBeGreaterThan(50000);
  expect(r.ex).toEqual([]);
  expect(r.overEq + r.overTable).toBe(0);
});

test('known answer: 21kW Guardian, 50 ft steel, 7" WC → 1-1/4"', async ({ page }) => {
  const size = await page.evaluate(() => {
    S.fuel = 'ng'; S.drop = 0.5;
    const m = GM.find(x => x.num.startsWith('G007260'));
    const res = sizeRun({ len: 50, mat: 'steel', press: '7wc' }, F().low, F().needCfh(m), m);
    return res.pick && res.pick.sz;
  });
  expect(size).toBe('1-1/4"');
});
