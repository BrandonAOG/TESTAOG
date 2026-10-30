// Known-answer checks for the other calculators (hand-checked against NEC 2023 / NFPA 54 & 58).
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'math checks run once'));

test('Load Calc: default job = 31,491 VA service demand, 150 A, LQ 32KW', async ({ page }) => {
  expect(await open(page, '/load-calcs/', { settle: 1500 })).toEqual([]);
  const r = await page.evaluate(() => ({
    dem: document.getElementById('s_dem').textContent.replace(/\D/g, ''),
    svc: document.getElementById('s_svc').textContent.trim(),
    gen: document.getElementById('s_gen').textContent.trim(),
  }));
  expect(r).toEqual({ dem: '31491', svc: '150', gen: 'LQ 32KW' });
});

test('Conduit Fill: 3 × 1/0 + 1 × #6 THHN → 1-1/2" EMT; USE-2 sized as RHW-2', async ({ page }) => {
  expect(await open(page, '/conduit-fill/')).toEqual([]);
  const r = await page.evaluate(() => {
    document.getElementById('conduitType').value = 'EMT';
    document.querySelectorAll('.wire-row').forEach(x => x.remove());
    addWire(); addWire();
    const rows = [...document.querySelectorAll('.wire-row')];
    const set = (row, t, s, q) => { row.querySelector('select').value = t; updateWireSizes(row.id); document.getElementById('size_' + row.id).value = s; document.getElementById('qty_' + row.id).value = q; };
    set(rows[0], 'THHN/THWN-2', '1/0 AWG', 3); set(rows[1], 'THHN/THWN-2', '6 AWG', 1);
    calculate(true);
    return { rec: document.getElementById('r-rec-size').textContent.trim(), emt1: CONDUIT_DATA.EMT['1'].total, use2: WIRE_DATA['USE-2']['4/0 AWG'].area, thhn: WIRE_DATA['THHN/THWN-2']['1/0 AWG'].area };
  });
  expect(r).toEqual({ rec: '1-1/2" EMT', emt1: 0.864, use2: 0.3718, thhn: 0.1855 });
});

test('Box Fill: 314.16(B) allowances add up', async ({ page }) => {
  expect(await open(page, '/box-fill/')).toEqual([]);
  const r = await page.evaluate(() => [
    computeRequired({ wires: [{ size: '12', qty: 6, type: 'term' }], devices: [{ type: 'Receptacle', size: '12', gangs: 1 }], addons: [], clamp: true, stud: false, hickey: false, egc: '12', egcQty: 3, tb: null }).total,
    computeRequired({ wires: [{ size: '14', qty: 4, type: 'term' }, { size: '18', qty: 5, type: 'fixture' }], devices: [], addons: [], clamp: false, stud: true, hickey: true, egc: '14', egcQty: 6, tb: null }).total,
  ]);
  expect(r).toEqual([22.5, 16.5]);
});

test('Electrical Formulas: 240.4(D) limits, 10 A breaker, Table 9 voltage drop', async ({ page }) => {
  expect(await open(page, '/quick-calc/')).toEqual([]);
  const r = await page.evaluate(() => {
    const vd = (A, L, tc, basis, size) => { $('vdA').value = A; $('vdL').value = L; $('vdTc').value = tc; $('vdBasis').value = basis; $('vdSize').value = size; calcVd(); return [$('vdMin').textContent, $('vdOutP').textContent]; };
    const i350 = String(WIRE.findIndex(w => w[0] === '350'));
    const out = { a: vd(18, 30, '75', 'dc', '')[0], b: vd(25, 30, '75', 'dc', '')[0], dc: vd(300, 200, '75', 'dc', i350)[1], ac: vd(300, 200, '75', 'steel', i350)[1] };
    $('brA').value = 7; $('brCont').checked = true; calcBr(); out.br = $('brStd').textContent;
    return out;
  });
  expect(r).toEqual({ a: '#12 CU', b: '#10 CU', dc: '1.84%', ac: '2.97%', br: '10 A' });
});

test('Concrete: 10 × 10 ft × 4" slab, 5% waste → 1.30 yd³, 70 × 30 kg bags', async ({ page }) => {
  expect(await open(page, '/concrete-calc/')).toEqual([]);
  await page.fill('#r-length', '10'); await page.fill('#r-width', '10'); await page.fill('#r-thick', '4');
  await page.selectOption('#u-r-length', 'ft'); await page.selectOption('#u-r-width', 'ft'); await page.selectOption('#u-r-thick', 'in');
  await page.selectOption('#bagsize', '30kg');
  await page.evaluate(() => document.getElementById('calc-btn').click());
  const txt = await page.locator('#results').innerText();
  expect(txt).toContain('1.30');
  expect(txt).toMatch(/\b70\b/);
});

test('Trench Depth: NEC Table 300.5(A) and NFPA 54/58 cover', async ({ page }) => {
  expect(await open(page, '/trench-depth/')).toEqual([]);
  const r = await page.evaluate(() => ({
    yardDB: elecReq({ loc: 'all', method: 0, circ: 'std', race: false }).cover,
    yardRMC: elecReq({ loc: 'all', method: 1, circ: 'std', race: false }).cover,
    yardPVC: elecReq({ loc: 'all', method: 2, circ: 'std', race: false }).cover,
    slabRace: elecReq({ loc: 'slab4', method: 0, circ: 'std', race: true }).cover,
    drive: elecReq({ loc: 'dwdrv', method: 2, circ: 'std', race: false }).cover,
    gfci: elecReq({ loc: 'all', method: 0, circ: 3, race: false }).cover,
    gas: gasReq({ fuel: 'ng', mat: 'pe', gloc: 'yard' }).cover,
    gasDmg: gasReq({ fuel: 'lp', mat: 'steel', gloc: 'damage' }).cover,
  }));
  expect(r).toEqual({ yardDB: 24, yardRMC: 6, yardPVC: 18, slabRace: 4, drive: 18, gfci: 12, gas: 12, gasDmg: 18 });
});

test('Pull Box: 314.28 straight 8× and angle 6× rules', async ({ page }) => {
  expect(await open(page, '/pull-box/')).toEqual([]);
  const r = await page.evaluate(() => {
    const e = (id, wall, size, pull, geo, pair) => ({ id, label: id, run: 1, wall, row: 1, ts: String(size), size, pull, geo, spliced: false, pair });
    const st = { entries: [], runWarn: [], cond: '4/0', condType: 'std', cover: true, inclStraight: true, actW: null, actH: null, actD: null,
      valid: [e('a-in', 'L', 2, 'angle', 'angle', 'a-out'), e('a-out', 'T', 2, 'angle', 'angle', 'a-in'),
              e('b-in', 'L', 3, 'straight', 'straight', 'b-out'), e('b-out', 'R', 3, 'straight', 'straight', 'b-in')] };
    st.entries = st.valid;
    const c = compute(st);
    return { w: c.req.w, h: c.req.h, pair: c.pairs.find(p => p.kind === 'Angle').val };
  });
  // width: straight 8 × 3 = 24 beats angle row (6 × 3 + 2 = 20); height: 6 × 2 = 12; same-conductor spacing 6 × 2 = 12
  expect(r).toEqual({ w: 24, h: 12, pair: 12 });
});

test('Gas Bonding: standard CSST needs a 6 AWG jumper, 75 ft max', async ({ page }) => {
  expect(await open(page, '/gas-bonding/')).toEqual([]);
  const r = await page.evaluate(() => {
    document.querySelectorAll('#pipeList input').forEach(i => i.checked = i.dataset.p === 'csst');
    calc();
    return [$('recV').textContent, $('sWire').textContent, $('sLen').textContent];
  });
  expect(r).toEqual(['SEPARATE BONDING JUMPER REQUIRED', '6 AWG Cu', '75 ft']);
});
