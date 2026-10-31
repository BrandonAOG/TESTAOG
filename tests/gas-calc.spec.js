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

// ── CSST: manufacturer charts ────────────────────────────────────────
// Spot cells read straight off the PDFs: Gastite / FlashShield Section 7 (Jan 2013), TracPipe CounterStrike FGP-001US (Apr 2022).
test('CSST manufacturer charts are intact (spot cells from the PDFs)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const cell = (id, len, ehd) => { const t = CSST_TABLES.find(x => x.id === id); return t.r.find(x => x[0] === len)[t.s.indexOf(ehd) + 1]; };
    const count = b => CSST_TABLES.filter(t => t.b === b).length;
    return {
      gastite: [cell('7-1', 10, 23), cell('7-2', 200, 37), cell('7-11', 50, 31), cell('7-18', 5, 13), cell('7-20', 1500, 60)],
      tracpipe: [cell('N-1', 5, 15), cell('N-2C', 5, 15), cell('N-5', 100, 39), cell('N-7', 1500, 62), cell('P-1', 30, 31), cell('P-3', 5, 62), cell('P-5', 600, 62), cell('P-5', 700, 62)],
      counts: [count('gastite'), count('tracpipe')],
      rows: [...new Set(CSST_TABLES.map(t => t.b + ':' + t.r.length + 'x' + t.s.length))].sort(),
    };
  });
  expect(r).toEqual({
    gastite: [183, 201, 2417, 621, 7048],
    tracpipe: [63, 120, 1830, 4900, 386, 48362, 11477, 10746],
    counts: [20, 20],
    rows: ['gastite:30x7', 'tracpipe:31x7'],
  });
});

test('every CSST chart is well formed: capacity falls with length and rises with size', async ({ page }) => {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const t of CSST_TABLES) {
      if (!CSST_BRANDS[t.b] || !['ng', 'lp'].includes(t.f) || t.s.some(e => !CSST_BRANDS[t.b].size[e])) out.push(t.id + ' meta');
      t.r.forEach((row, i) => {
        if (row.length !== t.s.length + 1 || row.some(v => !(v > 0))) out.push(`${t.id} row ${row[0]} shape`);
        if (i && (row[0] <= t.r[i - 1][0] || row.slice(1).some((v, j) => v > t.r[i - 1][j + 1]))) out.push(`${t.id} row ${row[0]} rises with length`);
        if (row.slice(2).some((v, j) => v <= row[j + 1])) out.push(`${t.id} row ${row[0]} size order`);
      });
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('CSST sizing never beats the chart and is never below the chart under it (full sweep)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const out = { checked: 0, exact: 0, ex: [] };
    const num = parseFloat, dP = (p1, dp) => { const P1 = p1 + 14.7, P2 = P1 - dp; return P1 * P1 - P2 * P2; };
    const fail = (...a) => { if (out.ex.length < 8) out.ex.push(a.join(' ')); };
    for (const fuel of ['ng', 'lp']) { S.fuel = fuel; const f = F(), m = GM[0];
      for (const pl of [f.low, f.high, f.mid || []]) for (const pr of pl) for (const mat of ['csst', 'tracpipe']) for (const drop of [0.5, 1, 3]) for (const rd of [0, 0.5, 1, 2, 3.5]) {
        S.drop = drop;
        for (let L = 1; L <= 500; L += 4) {
          const res = sizeRun({ len: L, mat, press: pr.v, drop: rd }, pl, 100, m); if (res.over) continue;
          // independent reference: this brand's charts of the same kind, compared on drop (" WC) or P1²−P2² (psi)
          const P = res.p, low = P.p1 === undefined || P.p1 < 1.5;
          const user = low ? (P.p1 === undefined ? drop : P.dp * 27.68) : dP(P.p1, P.dp);
          const val = t => low ? num(t.dp) : dP(num(t.in), num(t.dp));
          const charts = CSST_TABLES.filter(t => t.b === PIPE_MATERIALS[mat].brand && t.f === fuel && (low ? /w\.c\./.test(t.dp) : /psi$/.test(t.dp)));
          const at = t => t.r.find(x => x[0] >= L);
          const same = charts.find(t => Math.abs(val(t) - user) <= user * 1e-3);
          const ceil = charts.filter(t => val(t) >= user * 0.999).sort((a, b) => val(a) - val(b))[0];
          const floor = charts.filter(t => val(t) <= user * 1.001).sort((a, b) => val(b) - val(a))[0];
          const u = fuel === 'lp' ? 1000 / 2516 : 1;
          res.rows.forEach((row, i) => {
            out.checked++;
            const cfh = row.cap * (fuel === 'lp' ? m.lp_btu_gal / 2516 : 1);
            if (same) { out.exact++; if (Math.abs(cfh - at(same)[i + 1] * u) > 1e-6 * cfh) fail('exact', fuel, mat, pr.v, rd, L, i, cfh, at(same)[i + 1] * u); }
            if (ceil && cfh > at(ceil)[i + 1] * u * 1.000001) fail('over', fuel, mat, pr.v, rd, L, i, cfh, ceil.id);
            if (floor && cfh < at(floor)[i + 1] * u * 0.999999) fail('under', fuel, mat, pr.v, rd, L, i, cfh, floor.id);
            if (!ceil && floor && Math.abs(cfh - at(floor)[i + 1] * u) > 1e-6 * cfh) fail('past-largest', fuel, mat, pr.v, rd, L, i, cfh, floor.id);
            // between two charts: scaled down at least as hard as the charts themselves fall with drop (they follow ≈0.37–0.56)
            if (!same && ceil) { const lim = Math.max(at(ceil)[i + 1] * Math.pow(user / val(ceil), 0.55), floor ? at(floor)[i + 1] : 0) * u;
              if (cfh > lim * 1.000001) fail('not scaled', fuel, mat, pr.v, rd, L, i, cfh, lim, ceil.id); }
          });
        }
      }
    }
    return out;
  });
  expect(r.checked).toBeGreaterThan(50000);
  expect(r.exact).toBeGreaterThan(5000);
  expect(r.ex).toEqual([]);
});

test('known answer: 21kW Guardian, 40 ft Gastite, 7" WC → 1-1/4" (Table 7-1, 314 CFH)', async ({ page }) => {
  const r = await page.evaluate(() => {
    S.fuel = 'ng'; S.drop = 0.5;
    const m = GM.find(x => x.num.startsWith('G007260'));
    const res = sizeRun({ len: 40, mat: 'csst', press: '7wc' }, F().low, F().needCfh(m), m);
    return [res.pick.sz, res.pick.ehd, Math.round(res.pick.cap), /Table 7-1 /.test(res.basis)];
  });
  expect(r).toEqual(['1-1/4"', 37, 314, true]);
});

test('Code Reference shows each CSST brand as its own tab with its guide', async ({ page }) => {
  await page.evaluate(() => grOpen('t'));
  for (const [chip, id, guide] of [['Gastite / FlashShield', '7-1', 'Section 7 Sizing Tables (Jan 2013)'], ['TracPipe', 'N-1', 'FGP-001US (Apr 2022)']]) {
    await page.click(`#grMat >> text=${chip}`);
    await expect(page.locator('#grMeta')).toContainText(`Table ${id}`);
    await expect(page.locator('#grMeta')).toContainText(guide);
    await expect(page.locator('#grMeta')).toContainText('not NFPA');
  }
  await page.click('#grMat >> text=Sch 40 Steel');
  await expect(page.locator('#grMeta')).not.toContainText('not NFPA');
});
