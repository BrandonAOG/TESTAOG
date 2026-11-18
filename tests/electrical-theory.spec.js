// Electrical Theory: the panel one-line runs in every system and the teaching behaviours stay correct.
const { test, expect } = require('@playwright/test');
// the page follows the real sun by default; pin it to DAY so results don't depend on what time the tests run
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { window.__ET_SUN = 'day'; }); });
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

test('dock panel: GFPE trips the feeder on a fault into the water; without it the water stays energized; fed from Panel A or B at 400 A', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const r = await page.evaluate(async () => { const w = ms => new Promise(res => setTimeout(res, ms)), out = {};
    document.getElementById('dockBtn').click(); out.feeder = aDemo()[40].dock === true; out.mwbc = aDemo()[36].n; out.kwA = +(mainKW() - 0).toFixed(2);
    faultType = 'LG'; prot['K:0'] = 'std'; ckEgc['K:0'] = 'broken'; dockFaultAt(0); await w(1000);
    out.gfpeTrip = !isOn(40) && /GFPE TRIPPED/.test(document.getElementById('readout').innerText);
    clearFault(); delete offCkts[MODE + ':40']; render(); SB.K.gfpe = false; prot['K:0'] = 'std'; ckEgc['K:0'] = 'broken'; dockFaultAt(0); await w(1000);
    out.wet = SB.K.wet; out.stillOn = isOn(40); out.vG = voltBetween('K:G', 'N');
    clearFault(); SB.K.gfpe = true; delete prot['K:0']; delete ckEgc['K:0'];
    out.shore = protOf('K', 1); dockFaultAt(1); await w(800); out.shoreOff = !!SB.K.off[1];
    clearFault(); document.querySelector('#svcGrp [data-svc="400"]').click(); out.baseboard = aDemo()[30].n;
    const a0 = mainKW(), b0 = b4KW(); subSrc('K', 'B'); out.movedA = +(a0 - mainKW()).toFixed(2); out.movedB = +(b4KW() - b0).toFixed(2); out.inA = !!aDemo()[40].dock;
    faultType = 'LG'; subFdrB('K', 0); await w(800); out.bTrip = !!b4C[39];
    return out; });
  expect(r.feeder).toBe(true); expect(r.mwbc).toBe('Kitchen MWBC');
  expect(r.gfpeTrip).toBe(true);
  expect(r.wet).toBe(1); expect(r.stillOn).toBe(true); expect(r.vG).toBeGreaterThan(100);
  expect(r.shore).toBe('gfpe'); expect(r.shoreOff).toBe(true);
  expect(r.baseboard).toBe('Baseboard heat');
  expect(r.movedA).toBeCloseTo(6.45, 1); expect(r.movedB).toBeCloseTo(6.45, 1); expect(r.inA).toBe(false);
  expect(r.bTrip).toBe(true);
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
  await tap('A/C condenser 1');
  await expect(page.locator('#ckMenu')).toContainText('n/a');
});

test('a 120 V circuit on L2 runs the opposite way to one on L1 — hot AND neutral (closed loop)', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const r = await page.evaluate(() => {
    const rows = {};   // y → dot directions on the straight run from the breaker / to the N bar
    const top = +[...document.querySelectorAll('#svg text')].find(t => t.textContent.startsWith('LOAD CENTER')).getAttribute('y') + 43;   // panel top (label sits on the enclosure)
    dotPool.forEach(dp => { const m = dp.P.d.match(/^M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)$/); if (m && m[2] === m[4]) rows[Math.round(+m[2]) - top] = dp.dir; });
    return rows;
  });
  // circuit 1 (L1): hot top+13 out, neutral top+22 back · circuit 3 (L2): hot top+38 back, neutral top+47 out
  expect([r[13], r[22], r[38], r[47]]).toEqual([1, 1, -1, -1]);
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

test('service disconnect probes: line side stays hot when open, load side dies, N–G reads 0 at the MBJ', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const r = await page.evaluate(() => {
    const v = voltBetween, o = {};
    o.closedLL = v('SD:L1', 'SD:L2'); o.lineN = v('SL:L1', 'SN'); o.ng = v('SN2', 'SG');
    toggleSvc(); o.openLine = v('SL:L1', 'SL:L2'); o.openLoad = v('SD:L1', 'SN2'); o.acrossPole = v('SL:L1', 'SD:L1');
    probePick = ['SL:L1', 'SG']; render(); o.msg = document.getElementById('readout').innerText;
    return o; });
  expect([r.closedLL, r.lineN, r.ng, r.openLine, r.openLoad, r.acrossPole]).toEqual([240, 120, 0, 240, 0, 120]);
  expect(r.msg).toMatch(/LINE side is still hot/);
});

// ---------- standby generator + service-rated transfer switch ----------
async function genOn(page, sys, atsn) {
  await page.evaluate(([s, n]) => { document.querySelector(`[data-sys="${s}"]`).click(); document.getElementById('genBtn').click();
    document.querySelector(`[data-atsn="${n}"]`).click(); GSPEED = 50; }, [sys, atsn]);
}
const gs = page => page.evaluate(() => ({ SRC, GST, live: srcLive(), brk: genBrkOff }));

for (const sys of ['single', 'v208', 'v480']) {
  test(`generator (${sys}): outage → start → transfer → retransfer → cool-down → standby`, async ({ page }) => {
    const errs = await open(page, '/electrical-theory/');
    await genOn(page, sys, 'solid');
    await page.evaluate(() => toggleUtil());
    expect(await gs(page)).toMatchObject({ SRC: 'util', GST: 'sense', live: false });
    await page.waitForTimeout(600);
    expect(await gs(page)).toMatchObject({ SRC: 'gen', GST: 'run', live: true });
    await page.evaluate(() => toggleUtil());
    await page.waitForTimeout(1900);
    expect(await gs(page)).toMatchObject({ SRC: 'util', GST: 'off', live: true });
    expect(errs).toEqual([]);
  });
}

test('generator: OFF → AUTO during an outage (switch already on gen) brings the loads back', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  await genOn(page, 'single', 'solid');
  await page.evaluate(() => toggleUtil()); await page.waitForTimeout(600);
  await page.evaluate(() => setGenMode('off'));
  expect(await gs(page)).toMatchObject({ SRC: 'gen', live: false });
  await page.evaluate(() => setGenMode('auto')); await page.waitForTimeout(300);
  expect(await gs(page)).toMatchObject({ SRC: 'gen', GST: 'run', live: true });
});

test('generator: utility back with the generator dead retransfers almost instantly', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  await genOn(page, 'single', 'solid');
  await page.evaluate(() => toggleUtil()); await page.waitForTimeout(600);
  await page.evaluate(() => { toggleGenBrk(); GSPEED = 1; toggleUtil(); });
  await page.waitForTimeout(1400);
  expect(await gs(page)).toMatchObject({ SRC: 'util', live: true });
});

for (const atsn of ['solid', 'switched']) {
  test(`generator feeder fault (${atsn} neutral) trips the generator breaker`, async ({ page }) => {
    const errs = await open(page, '/electrical-theory/');
    await genOn(page, 'v480', atsn);
    await page.evaluate(() => toggleUtil()); await page.waitForTimeout(600);
    await page.evaluate(() => faultGenFdr('A'));
    expect(await page.evaluate(() => ({ z: faultZone, a: FAULT_A }))).toEqual({ z: 'genfdr', a: 240 });   // 80 A breaker × 3 (48 kW @ 480 V, 0.8 PF = 72 A)
    await page.waitForTimeout(2600);
    expect(await gs(page)).toMatchObject({ brk: true, live: false });
    await page.evaluate(() => toggleGenBrk());
    expect(await gs(page)).toMatchObject({ brk: false, live: true });
    expect(errs).toEqual([]);
  });
}

test('generator: switched neutral draws the SBJ and two ground rods; solid neutral has neither', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  await genOn(page, 'single', 'switched');
  const txt = () => page.evaluate(() => document.getElementById('svg').textContent);
  expect(await txt()).toContain('GEN GEC · 2 rods');
  expect(await txt()).toContain('N–G bond here (SBJ)');
  await page.evaluate(() => document.querySelector('[data-atsn="solid"]').click());
  expect(await txt()).not.toContain('GEN GEC · 2 rods');
  expect(await txt()).toContain('no N–G bond here');
});

test('generator E-stop: drops the controller to OFF, locks it there until reset, AUTO restarts it', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  await genOn(page, 'single', 'solid');
  await page.evaluate(() => toggleUtil()); await page.waitForTimeout(600);
  await page.evaluate(() => toggleEstop());
  expect(await gs(page)).toMatchObject({ SRC: 'gen', GST: 'off', live: false });
  expect(await page.evaluate(() => GMODE)).toBe('off');                  // E-stop drops the controller to OFF
  await page.evaluate(() => setGenMode('auto'));                          // locked in OFF while pressed
  expect(await page.evaluate(() => GMODE)).toBe('off');
  await page.evaluate(() => toggleEstop()); await page.waitForTimeout(400);
  expect(await page.evaluate(() => GMODE)).toBe('off');                  // reset clears the alarm, stays OFF
  expect(await gs(page)).toMatchObject({ live: false });
  await page.evaluate(() => setGenMode('auto')); await page.waitForTimeout(400);
  expect(await gs(page)).toMatchObject({ SRC: 'gen', GST: 'run', live: true });
  expect(errs).toEqual([]);
});

test('CODE window has a GEN tab with 445 and 702 references', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  await page.evaluate(() => openRef('gen'));
  const t = await page.locator('#rl-gen').innerText();
  for (const ref of ['445.13(A)', '445.19(C)', '702.5(A)', '702.7(B)', '250.30(C)']) expect(t).toContain(ref);
});

test('generator works on high-leg delta: 150 A breaker, B–N reads 208 V at the generator', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  await genOn(page, 'highleg', 'solid');
  await page.evaluate(() => toggleUtil()); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ ok: genOK(), amps: genAmps(), b: Math.round(cMag(nodeVph('GN:B'))), a: Math.round(cMag(nodeVph('GN:A'))), live: srcLive() }));
  expect(r).toEqual({ ok: true, amps: 150, b: 208, a: 120, live: true });
  expect(errs).toEqual([]);
});

test('generator breaker sizes follow the 48 kW nameplate (3Ø at 0.8 PF)', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const r = await page.evaluate(() => ['single', 'v208', 'highleg', 'v480'].map(s => { document.querySelector(`[data-sys="${s}"]`).click(); return genAmps(); }));
  expect(r).toEqual([200, 175, 150, 80]);
});

test('toggling the generator does not shift the drawing', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  for (const s of ['single', 'v208', 'v480', 'highleg']) {
    const geo = () => page.evaluate(() => document.getElementById('svg').getAttribute('viewBox'));
    await page.evaluate(sys => document.querySelector(`[data-sys="${sys}"]`).click(), s);
    const off = await geo();
    await page.evaluate(() => document.getElementById('genBtn').click());
    expect(await geo()).toBe(off);
    await page.evaluate(() => document.getElementById('genBtn').click());
  }
});

test('open service breaker / panel main: line side glows (energized, 0 A), no moving dots, readout explains it', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const st = () => page.evaluate(() => ({ glow: document.querySelectorAll('#svg .vglow').length, dots: dotPool.length, ro: document.getElementById('readout').innerText }));
  let r = await st(); expect(r.glow).toBe(0); expect(r.dots).toBeGreaterThan(0);
  await page.evaluate(() => toggleSvc());
  r = await st(); expect(r.glow).toBeGreaterThan(0); expect(r.dots).toBe(0); expect(r.ro).toContain('SERVICE DISCONNECT OPEN');
  await page.evaluate(() => { toggleSvc(); toggleLcMain(); });
  r = await st(); expect(r.glow).toBeGreaterThan(0); expect(r.dots).toBe(0); expect(r.ro).toContain('PANEL MAIN OPEN');
});

test('open EGC ground fault: MBJ carries nothing, FRAME probe reads near line voltage and stays; intact EGC clears to 0 V', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  const r = await page.evaluate(() => { prot['M:3'] = 'std'; ckEgc['single:3'] = 'broken'; faultType = 'LG'; applyFault(3);   // a plain breaker: nothing to trip it
    const mbjRed = [...document.querySelectorAll('#svg line')].some(l => l.getAttribute('stroke-dasharray') === '3 3' && /ff3b30/i.test(l.getAttribute('stroke') || ''));
    return { frp: !!FRP, v: Math.round(voltBetween('FR', 'SG')), mbjRed }; });
  expect(r.frp).toBe(true); expect(r.v).toBeGreaterThan(100); expect(r.mbjRed).toBe(false);
  await page.waitForTimeout(2600);
  expect(Math.round(await page.evaluate(() => voltBetween('FR', 'SG')))).toBeGreaterThan(100);   // never trips
  await page.evaluate(() => { clearFault(); delete ckEgc['single:3']; applyFault(3); });
  await page.waitForTimeout(2600);
  expect(Math.round(await page.evaluate(() => voltBetween('FR', 'SG')))).toBe(0);              // tripped → frame back to ground
});

test('circuit menu can be dragged by its title bar, stays open, and reopens where it was left', async ({ page }) => {
  expect(await open(page, '/electrical-theory/')).toEqual([]);
  await page.evaluate(() => openCkMenu('M', 7, { clientX: 200, clientY: 200 }));
  const m = page.locator('#ckMenu'), h = page.locator('#ckMenu > div').first();
  const b0 = await m.boundingBox(), hb = await h.boundingBox();
  await page.mouse.move(hb.x + 30, hb.y + 8); await page.mouse.down();
  await page.mouse.move(hb.x + 30 - 60, hb.y + 8 + 40, { steps: 5 }); await page.mouse.up();
  const b1 = await m.boundingBox();
  expect(Math.round(b1.y - b0.y)).toBe(40);
  await page.locator('#ckX').click(); await expect(m).toHaveCount(0);
  await page.evaluate(() => openCkMenu('M', 7, { clientX: 20, clientY: 20 }));
  const b2 = await page.locator('#ckMenu').boundingBox();
  expect([Math.round(b2.x), Math.round(b2.y)]).toEqual([Math.round(b1.x), Math.round(b1.y)]);
});

test('utility transformer symbol matches the system (coil · wye · delta) without script errors', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  const r = {};
  for (const s of ['single', 'v208', 'v480', 'highleg', 'cgd', 'ungd']) {
    r[s] = await page.evaluate(sys => { document.querySelector(`[data-sys="${sys}"]`).click();
      const svg = document.getElementById('svg');
      const tri = [...svg.querySelectorAll('path')].some(p => /Z$/.test((p.getAttribute('d') || '').trim()) && (p.getAttribute('d').match(/L/g) || []).length === 2);
      const cnt = {}; [...svg.querySelectorAll('line')].forEach(l => { const k = l.getAttribute('x1') + ',' + l.getAttribute('y1'); cnt[k] = (cnt[k] || 0) + 1; }); const wye = Object.values(cnt).some(n => n >= 3);   // three windings from one star point
      return tri ? 'delta' : (wye ? 'wye' : 'coil'); }, s);
  }
  expect(r).toEqual({ single: 'coil', v208: 'wye', v480: 'wye', highleg: 'delta', cgd: 'delta', ungd: 'delta' });
  expect(errs).toEqual([]);
});

test('line side starts at the transformer winding, and the neutral shows its N–G bond to the POCO rod', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  const r = {};
  for (const s of ['single', 'v208', 'highleg', 'cgd', 'ungd']) {
    r[s] = await page.evaluate(sys => { document.querySelector(`[data-sys="${sys}"]`).click();
      const t = [...document.querySelectorAll('#svg text')].map(x => x.textContent);
      return { leads: Object.keys(window.AOG_XL).length, bond: t.some(x => /N–G bond|B–G bond/.test(x)), poco: t.some(x => /POCO/.test(x)) }; }, s);
  }
  expect(r.single).toEqual({ leads: 2, bond: true, poco: true });
  expect(r.v208).toEqual({ leads: 3, bond: true, poco: true });
  expect(r.highleg).toEqual({ leads: 3, bond: true, poco: true });
  expect(r.cgd).toEqual({ leads: 3, bond: true, poco: true });
  expect(r.ungd).toEqual({ leads: 3, bond: false, poco: false });
  expect(errs).toEqual([]);
});

test('customer transformer: sizing follows Table 450.3(B) and the kVA menu re-sizes it', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  const r = await page.evaluate(() => { document.querySelector('[data-sys="v480"]').click(); document.getElementById('xfBtn').click();
    const a = xfC(); xfSetKva(3); const b = xfC(); return { on: xfActive(), pri45: a.priA, sec45: a.secA, pri3: b.priA, fuse3: b.priFuse, pct3: b.po.pct }; });
  expect(r).toEqual({ on: true, pri45: 70, sec45: 175, pri3: 6, fuse3: true, pct3: 167 });
  expect(errs).toEqual([]);
});

test('transformer windings: voltages to ground, bonding and fault behaviour per type', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  const r = await page.evaluate(() => { document.querySelector('[data-sys="v480"]').click(); document.getElementById('xfBtn').click();
    const V = q => Math.round(Math.hypot(xfNodeV(q).re, xfNodeV(q).im)), out = {};
    const run = (w, dg) => { xfSetWind(w); if (dg) xfSetDG(dg); const C = xfC(); return { sec: C.sec, v: [V('A'), V('B'), V('C')], ret: xfReturns(), sds: !C.common, bondable: C.bondable, hasN: C.hasN }; };
    out.dy = run('dy'); out.yy = run('yy'); out.yyc = run('yyc'); out.hl = run('yd', 'hl'); out.corner = run('dd', 'corner'); out.ung = run('dd', 'ung');
    xfFaultAt('L0'); out.ungFault = [V('A'), V('B'), V('C')]; out.ungTimer = !!xfTimer;
    const lamps = [...document.querySelectorAll('#svg text')].some(t => /GROUND DETECTOR/.test(t.textContent)); out.lamps = lamps;
    xfClear(); render(); return out; });
  expect(r.dy).toEqual({ sec: '208Y/120', v: [120, 120, 120], ret: true, sds: true, bondable: true, hasN: true });
  expect(r.yy.sds && r.yy.bondable).toBe(true);
  expect(r.yyc).toMatchObject({ ret: true, sds: false, bondable: false });
  expect(r.hl).toMatchObject({ v: [120, 208, 120], hasN: true, bondable: true });
  expect(r.corner).toMatchObject({ v: [240, 0, 240], hasN: false, bondable: true });
  expect(r.ung).toMatchObject({ v: [139, 139, 139], ret: false, bondable: false });
  expect(r.ungFault).toEqual([240, 240, 0]);   // heater on C–A: C grounded, the other two rise to 240 V to ground
  expect(r.ungTimer).toBe(false);               // nothing trips on a first ground fault
  expect(r.lamps).toBe(true);
  expect(errs).toEqual([]);
});

test('transformer: every winding / bond / first-disconnect combination draws and faults without errors', async ({ page }) => {
  test.setTimeout(240000);   // dozens of full redraws
  const errs = await open(page, '/electrical-theory/');
  for (const sys of ['v480', 'v208']) {
    await page.evaluate(s => { document.querySelector(`[data-sys="${s}"]`).click(); if (!xfActive()) document.getElementById('xfBtn').click(); }, sys);
    for (const w of ['dy', 'yy', 'yyc', 'yd', 'dd']) {
      await page.evaluate(w => { ['ung', 'corner', 'hl'].forEach(dg => ['xf', 'disc', 'none'].forEach(bd => ['disc', 'panel'].forEach(fs => {
        xfSetWind(w); xfSetDG(dg); xfSetBond(bd); xfSetFirst(fs);
        ['L0', 'sec', 'fdr2', 'pri'].forEach(f => { xfFaultAt(f); probePick = ['X:A', 'X:G']; render(); xfClear(); });
        probePick = []; xfOff = {}; }))); dotPool.length = 0; render(); }, w);
    }
  }
  expect(errs).toEqual([]);
});

test('animation is light: precomputed dot paths, no redraw on height-only resize, touch screens scroll instead of shrinking', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  await page.evaluate(() => document.getElementById('poolBtn').click()); await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    let n = 0; const orig = window.render; window.render = function () { n++; return orig.apply(this, arguments); };
    window.dispatchEvent(new Event('resize'));
    const svg = document.getElementById('svg'), vbW = +svg.getAttribute('viewBox').split(' ')[2];
    return new Promise(res => setTimeout(() => res({ redraws: n, tables: dotPool.length > 0 && dotPool.every(dp => dp.P && dp.P.xs.length > 1), touch: MOBILE_ANIM, fullSize: svg.getBoundingClientRect().width >= vbW * 0.95 }), 300)); });
  expect(r.redraws).toBe(0);
  expect(r.tables).toBe(true);
  if (r.touch) expect(r.fullSize).toBe(true);
  expect(errs).toEqual([]);
});

test('the toggle buttons never push the page wider than the screen', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  const r = await page.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
    right: Math.max(...[...document.querySelectorAll('.toggle-row2 .toggle')].map(b => b.getBoundingClientRect().right)) }));
  expect(r.sw).toBeLessThanOrEqual(r.vw);
  expect(r.right).toBeLessThanOrEqual(r.vw);
  expect(errs).toEqual([]);
});

test('tablet width on a touch screen: the pool drawing stays full size and the box can actually be swiped', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const errs = await open(page, '/electrical-theory/');
  const r = await page.evaluate(() => { document.getElementById('poolBtn').click(); const sc = document.getElementById('svg').parentElement;
    return { touch: MOBILE_ANIM, ovf: getComputedStyle(sc).overflowX, wide: sc.scrollWidth > sc.clientWidth + 100 }; });
  if (r.touch) expect(r).toEqual({ touch: true, ovf: 'auto', wide: true });   // overflow:hidden lets code scroll it but blocks a finger
  expect(errs).toEqual([]);
});

test('solar + battery: grid-tied export, anti-islanding, whole-home and backup-panel islanding', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  const r = await page.evaluate(() => { const out = {}; const S = () => derState();
    document.getElementById('solarBtn').click(); let D = S(); out.solarDay = [D.inv, D.pv, Math.round(D.exp * 10) / 10];
    toggleUtil(); D = S(); out.solarOutage = [D.inv, D.pv]; toggleUtil();
    document.getElementById('battBtn').click(); derSet('sun', false); toggleUtil(); D = S(); out.whole = [D.inv, D.midClosed, D.mainLive, D.batt < 0];
    derSet('mode', 'partial'); D = S(); out.partial = [D.inv, D.mainLive, D.backLive];
    derSet('soc', 0); D = S(); out.empty = [D.inv, D.backLive];
    return out; });
  expect(r.solarDay).toEqual(['grid', 6, -27.6]);   // 6 kW of solar under a ~33.6 kW house: it imports the rest
  expect(r.solarOutage).toEqual(['off', 0]);
  expect(r.whole).toEqual(['island', false, true, true]);
  expect(r.partial).toEqual(['island', false, true]);
  expect(r.empty).toEqual(['empty', false]);
  expect(errs).toEqual([]);
});

test('solar + battery: string voltage limit, battery drain clock, generator never backfed', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  const r = await page.evaluate(() => { const out = {};
    document.getElementById('solarBtn').click(); derSet('mods', 25); derSet('str', 1); out.overV = [pvVoc(), pvOverV(), derState().pv];
    derSet('str', 5); out.ok = [pvVoc(), pvOverV(), derState().pv > 0];
    document.getElementById('battBtn').click(); derSet('sun', false); toggleUtil();
    const s0 = derSoc; derTickT = Date.now() - 2000; derTick(); out.drained = derSoc < s0;
    let bad = 0; ['whole', 'partial'].forEach(m => [true, false].forEach(sun => { derSet('mode', m); derSet('sun', sun); GEN = true; genReset(); SRC = 'gen'; GST = 'run'; derLastSrc = null; derWaitUntil = 0; render();
      const D = derState(); if (D.inv === 'gen' && !D.genPort && D.toMain > D.pvAvail + 0.01) bad++; if (D.exp > 0.05 && D.src !== 'util') bad++; }));
    out.bad = bad; return out; });
  expect(r.overV).toEqual([1025, true, 0]);
  expect(r.ok).toEqual([205, false, true]);
  expect(r.drained).toBe(true);
  expect(r.bad).toBe(0);
  expect(errs).toEqual([]);
});

test('solar + battery: backup-panel fault trips, generator on the inverter GEN port starts at 30 %', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  await page.evaluate(() => { document.getElementById('battBtn').click(); derSet('mode', 'partial'); derSet('sun', false); toggleUtil(); derBuFaultAt(9); });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => { const out = { tripped: !!buOff[9] };
    GSPEED = 20; document.getElementById('genBtn').click(); derSet('gstart', 'batt'); derSet('soc', 29); out.genOK = genOK(); genBattCheck(); out.ig = igSt; return out; });
  await page.waitForTimeout(600);
  const r2 = await page.evaluate(() => { const D = derState(); return [igSt, D.inv, !!D.genPort, D.batt > 0, D.mainLive]; });
  expect(r).toEqual({ tripped: true, genOK: false, ig: 'start' });
  expect(r2).toEqual(['run', 'gen', true, true, false]);   // backup-panel system: the GEN-port generator never reaches the main panel
  expect(errs).toEqual([]);
});

test('solar + battery: every combination draws without script errors', async ({ page }) => {
  const errs = await open(page, '/electrical-theory/');
  for (const conn of ['bus', 'svc']) {
    await page.evaluate(c => { const R = []; pvConn = c;
      [[1, 0], [0, 1], [1, 1]].forEach(sb => ['whole', 'partial'].forEach(m => [false, true].forEach(gen => [false, true].forEach(uo => {
        solarOn = !!sb[0]; battOn = !!sb[1]; battMode = m; GEN = gen; genReset(); utilOff = uo; derLastSrc = null; derWaitUntil = 0; derFltClear(); render();
        probePick = ['PV:+', 'PV:-']; render(); probePick = ['BU:L1', 'BU:N']; render(); probePick = []; })))); utilOff = false; dotPool.length = 0; render(); }, conn);
  }
  expect(errs).toEqual([]);
});

test('house load is realistic, follows the breakers, and the EMS sheds big loads (or the inverter trips on overload)', async ({ page }) => {
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => {
    const all = mainKW(); offCkts['single:13'] = 1; const noAC = mainKW(); delete offCkts['single:13'];
    solarOn = true; battOn = true; battMode = 'whole'; GEN = false; genReset(); derSoc = 100; sunMode = 'night'; utilOff = true; derLastSrc = null; derWaitUntil = 0; nBat = 1; emsOn = true; render();
    let D = derState(); const ems = [D.inv, Object.keys(D.shed).length > 0, -D.batt <= 5.01];
    emsOn = false; render(); D = derState(); const off = [D.inv, D.mainLive];
    emsOn = true; battMode = 'partial'; render(); const bAll = -derState().batt; buOff[2] = 1; render(); const bSome = -derState().batt;
    buOff = {}; battMode = 'whole'; utilOff = false; render(); return { all, noAC, ems, off, bAll, bSome };
  });
  expect(r.all).toBeGreaterThan(33); expect(r.all).toBeLessThan(35);
  expect(r.all - r.noAC).toBeCloseTo(3.0, 1);
  expect(r.ems).toEqual(['island', true, true]);
  expect(r.off).toEqual(['overload', false]);
  expect(r.bSome).toBeLessThan(r.bAll - 0.5);
});

test('CODE window has a SOLAR · ESS tab (690 / 705 / 706 / 702) and opens on it when solar or battery is on', async ({ page }) => {
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { solarOn = true; render(); openRef('flow');
    const t = document.getElementById('rl-der').textContent, act = document.querySelector('.modal-tab.active').dataset.tab; closeRef(); solarOn = false; render(); return { t, act }; });
  expect(r.act).toBe('der');
  for (const ref of ['690.7', '690.12', '705.12(B)(2)', '705.40', '705.70', '706.15', '702.4(A)(2)']) expect(r.t).toContain(ref);
});

test('breaker types: GFCI trips an open-EGC ground fault and a neutral-ground fault, AFCI trips an arc, a plain breaker trips none', async ({ page }) => {
  await page.goto('/electrical-theory/');
  const run = (ft, ck, pr, egc) => page.evaluate(([ft, ck, pr, egc]) => { clearFault(); prot = {}; if (pr) prot['M:' + ck] = pr; ckEgc = {}; if (egc) ckEgc['single:' + ck] = egc; faultType = ft; applyFault(ck); }, [ft, ck, pr, egc]);
  const st = () => page.evaluate(() => ({ t: tripped, by: protBy && protBy.by }));
  await run('LG', 12, null, 'broken'); await page.waitForTimeout(900); expect(await st()).toEqual({ t: true, by: 'GFCI' });
  await run('LG', 12, 'std', 'broken'); await page.waitForTimeout(900); expect(await st()).toEqual({ t: false, by: null });
  await run('NG', 12); await page.waitForTimeout(900); expect(await st()).toEqual({ t: true, by: 'GFCI' });
  await run('NG', 12, 'std'); await page.waitForTimeout(900); expect(await st()).toEqual({ t: false, by: null });
  await run('ARC', 1); await page.waitForTimeout(900); expect(await st()).toEqual({ t: true, by: 'AFCI' });
  await run('ARC', 12); await page.waitForTimeout(900); expect(await st()).toEqual({ t: false, by: null });
  const req = await page.evaluate(() => [protOf('M', 3), protOf('M', 13), protOf('M', 19), protShort('M', 12), (prot['M:12'] = 'std', protShort('M', 12))]);
  expect(req).toEqual(['df', 'gfci', 'std', '', 'GFCI']);
});

test('solar follows the real sun in AUTO (dark at night, ramps with the sun), and DAY / NIGHT still override it', async ({ page }) => {
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => {
    const y = new Date().getFullYear(), at = h => sunElev(new Date(y, 5, 21, h, 0));
    const el = [at(1), at(7), at(13), at(22)];
    document.getElementById('solarBtn').click(); sunMode = 'day'; const day = derState().pvAvail; sunMode = 'night'; const night = derState().pvAvail;
    sunMode = 'auto'; const auto = derState().pvAvail, up = sunElev() > 0.5;
    derSet('sunCycle'); const m1 = sunMode; derSet('sunCycle'); const m2 = sunMode; derSet('sunCycle'); const m3 = sunMode;
    return { el, day, night, auto, up, modes: [m1, m2, m3] };
  });
  expect(r.el[0]).toBeLessThan(0); expect(r.el[3]).toBeLessThan(0);   // 1 AM and 10 PM: dark
  expect(r.el[2]).toBeGreaterThan(60); expect(r.el[1]).toBeGreaterThan(0); expect(r.el[1]).toBeLessThan(r.el[2]);   // summer: morning sun is lower than midday
  expect(r.day).toBe(6); expect(r.night).toBe(0);
  if (r.up) { expect(r.auto).toBeGreaterThan(0); expect(r.auto).toBeLessThanOrEqual(6); } else expect(r.auto).toBe(0);
  expect(r.modes).toEqual(['day', 'night', 'auto']);
});

test('every system has its own realistic circuits: no overlaps, no 120 V circuit on the high leg, 480Y/277 has only 277 V single-pole circuits', async ({ page }) => {
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { const bad = [];
    for (const m of Object.keys(SYS)) { MODE = m; const d = DEMO[SYS[m].demo], occ = {};
      for (const k of Object.keys(d)) { const c = d[k], s = +k;
        for (let j = 0; j < c.p; j++) { const t = s + 2 * j; if (t > 42 || occ[t]) bad.push(m + ':' + t); occ[t] = 1; }
        if (m === 'highleg' && c.p === 1 && c.nt) { if (phaseOfCkt(s) === 'B') bad.push('high leg ' + s); STACKED = !STACKED; if (phaseOfCkt(s) === 'B') bad.push('high leg stacked ' + s); STACKED = !STACKED; } } }
    MODE = 'single'; return { bad, v480: SYS.v480.demo, recept480: Object.values(DEMO.v480).some(c => /Recept/.test(c.n)), n: Object.keys(SYS).map(m => Object.keys(DEMO[SYS[m].demo]).length) }; });
  expect(r.bad).toEqual([]); expect(r.v480).toBe('v480'); expect(r.recept480).toBe(false);
  r.n.forEach(n => expect(n).toBeGreaterThanOrEqual(14));
});

test('inverter size and parallel units: capacity adds up, it stays legal by default (smaller main or supply-side tap), PANEL BKR shows the 120 % violation', async ({ page }) => {
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { const o = {}; solarOn = true; battOn = true; battMode = 'whole'; utilOff = true; sunMode = 'night'; derLastSrc = null; derWaitUntil = 0;
    const st = () => { render(); const D = derState(); return [INV_KW, invBrk(), pvConn, mainA(), inv120ok(), Object.keys(D.shed).length > 0, Math.round(-D.batt * 10) / 10]; };
    nBat = 1; derSet('invkw', 7.6); derSet('ninv', 1); o.one = st();
    nBat = 3; derSet('ninv', 2); o.two = st();
    derSet('conn', 'bus'); o.illegal = st(); o.msg = document.getElementById('readout').innerText.includes('120 % RULE VIOLATED');
    derSet('ninv', 3); o.three = st();
    derSet('invkw', 11.5); derSet('ninv', 1); o.pw3 = st();
    derSet('invkw', 7.6); derSet('ninv', 1); derSet('conn', 'bus'); nBat = 1; utilOff = false; render(); return o; });
  expect(r.one).toEqual([7.6, 40, 'bus', 200, true, true, 4]);   // one 5 kW battery: the EMS sheds every big load, 4 kW left
  expect(r.two).toEqual([15.2, 80, 'derate', 150, true, true, 11.1]);   // legal: 150 A main + 80 A ≤ 240 A; 3 batteries + 2 inverters carry 11.1 kW of the 33.6 kW house, the EMS sheds the rest
  expect(r.illegal.slice(2, 5)).toEqual(['bus', 200, false]); expect(r.msg).toBe(true);
  expect(r.three.slice(2, 5)).toEqual(['svc', 200, true]);   // 3 × 7.6 kW needs 125 A — even a 100 A main won't do, so it goes to the supply-side tap
  expect(r.pw3.slice(1, 5)).toEqual([60, 'derate', 175, true]);
});

test('battery modes: BACKUP keeps it full (solar first, grid tops up); SELF-POWERED uses only extra solar and covers the house down to 20 %', async ({ page }) => {
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { const o = {}; solarOn = true; battOn = true; battMode = 'whole';
    const S = () => { render(); const D = derState(); return [D.inv, Math.round(D.batt * 10) / 10, Math.round((D.chSol || 0) * 10) / 10, Math.round((D.chGrid || 0) * 10) / 10]; };
    sunMode = 'day'; derSoc = 50; battPri = 'backup'; o.bDay = S(); sunMode = 'night'; o.bHold = S(); gridChg = true; o.bNight = S(); gridChg = false;
    battPri = 'self'; sunMode = 'day'; o.sDay = S(); derSoc = 20; sunMode = 'night'; o.sRes = S();
    battPri = 'backup'; derSoc = 100; render(); return o; });
  expect(r.bDay).toEqual(['grid', 5, 5, 0]);     // solar charges it even though the house wants more
  expect(r.bHold).toEqual(['grid', 0, 0, 0]);   // grid charging off (default): it just holds at night
  expect(r.bNight).toEqual(['grid', 5, 0, 5]);   // grid charging on: the grid tops it up
  expect(r.sDay).toEqual(['grid', -5, 0, 0]);    // house (12.4 kW) > solar (6 kW): the battery covers the gap
  expect(r.sRes).toEqual(['grid', 0, 0, 0]);     // holds the 20 % outage reserve
});

test('parallel inverters: each AC-combiner breaker can be opened — that unit drops out, capacity and PV follow, nothing errors', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { const o = {}; solarOn = true; battOn = false; sunMode = 'day'; derSet('invkw', 7.6); derSet('ninv', 3); derSet('mods', 40); derSet('str', 5); render();
    o.all = [nUp(), derState().pv]; derSet('cmb', 3); render(); o.off3 = [nUp(), derState().pv]; derSet('cmb', 3);
    let n = 0; for (const b of [false, true]) for (const m of ['whole', 'partial']) for (const u of [1, 2, 3]) for (const c of [0, 1, 2, 3]) {
      battOn = b; battMode = m; derSet('ninv', u); cmbOff = {}; if (c) cmbOff[c] = true; dotPool.length = 0; render(); n++; }
    cmbOff = {}; derSet('ninv', 1); battOn = false; render(); o.n = n; return o; });
  expect(r.all).toEqual([3, 16]); expect(r.off3).toEqual([2, 12.8]);   // #3's one string (3.2 kW) drops out
  expect(r.n).toBe(48); expect(errs).toEqual([]);
});

test('parallel hybrid inverters split the PV strings (each converts its own), each has its own PV DC disconnect, built-in by default', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { solarOn = true; battOn = true; battMode = 'whole'; sunMode = 'day'; derSet('invkw', 7.6); derSet('ninv', 3); derSet('mods', 30); derSet('str', 3); render();
    const a = derState().pvU.slice(1, 4); derSet('pvdu', 2); render(); const b = derState().pvU.slice(1, 4), pv = derState().pv; derSet('pvdu', 2);
    const mode = dcDisc; derSet('dcd', 'ext'); render(); const ext = [...document.querySelectorAll('#svg text')].some(t => t.textContent === 'PV DC DISC'); derSet('dcd', 'int'); derSet('ninv', 1); battOn = false; render();
    return { a, b, pv, mode, ext }; });
  expect(r.a).toEqual([4, 4, 4]); expect(r.b).toEqual([4, 0, 4]); expect(r.pv).toBe(8);
  expect(r.mode).toBe('int'); expect(r.ext).toBe(true); expect(errs).toEqual([]);
});

test('parallel backup outputs land on their own breakers in a backup combiner by default (705.12(B)(3)); splicing them is flagged', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { solarOn = true; battOn = true; battMode = 'partial'; sunMode = 'day'; derSet('invkw', 7.6); derSet('ninv', 3); render();
    const T = () => [...document.querySelectorAll('#svg text')].map(t => t.textContent).join('|');
    const def = buTie, a = T(); derSet('butie', 'splice'); const b = T(); derSet('butie', 'cmb'); derSet('invkw', 11.5); const c = T();
    derSet('invkw', 7.6); derSet('ninv', 1); battOn = false; battMode = 'whole'; render(); return { def, a, b, c }; });
  expect(r.def).toBe('cmb');
  expect(r.a).toContain('BACKUP COMBINER · 3 × 40 A 2P → 125 A bus'); expect(r.a).toContain('#3 · 40 A 2P'); expect(r.a).toContain('#2 DC');
  expect(r.b).toContain('SPLICED TOGETHER'); expect(r.b).not.toContain('BACKUP COMBINER');
  expect(r.c).toContain('3 × 60 A 2P → 200 A bus');
  expect(errs).toEqual([]);
});

test('backup combiner breakers toggle: an open one drops that inverter off the backup panel, the rest share it; all open = dark', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { solarOn = true; battOn = true; battMode = 'partial'; sunMode = 'day'; derSet('invkw', 7.6); derSet('ninv', 3); render();
    const lbs = () => { const D = derState(); const n = nBu(); return { live: D.backLive, n }; };
    const a = lbs(); derSet('cbk', 2); const b = lbs(); const t = [...document.querySelectorAll('#svg text')].some(x => x.textContent === '#2 · 40 A 2P · OFF');
    derSet('cbk', 1); derSet('cbk', 3); const c = lbs(); derSet('cbk', 1); derSet('cbk', 2); derSet('cbk', 3); derSet('ubu', 2); const d = lbs(); derSet('ubu', 2);
    derSet('ninv', 1); battOn = false; battMode = 'whole'; render(); return { a, b, c, d, t }; });
  expect(r.a).toEqual({ live: true, n: 3 }); expect(r.b).toEqual({ live: true, n: 2 }); expect(r.t).toBe(true);
  expect(r.c).toEqual({ live: false, n: 0 }); expect(r.d).toEqual({ live: true, n: 2 });
  expect(errs).toEqual([]);
});

test('backup panel: main lugs ⇄ main breaker (opening it kills the bus, feeder stays live), illegal bond flagged, feeder EGC broken = fault never clears', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { solarOn = true; battOn = true; battMode = 'partial'; sunMode = 'day'; derSet('invkw', 7.6); derSet('ninv', 1); render();
    const T = () => [...document.querySelectorAll('#svg text')].map(t => t.textContent).join('|');
    const mlo = buMLO; derSet('bumlo'); const t1 = T(); derSet('bumain'); const D1 = derState(); derSet('bumain'); derSet('bumlo');
    derSet('bubond'); const t2 = T(); derSet('bubond');
    derSet('buegc', 'broken'); derFeederFault('bu'); const m = derFltMsg, stillOn = !invBackupOff; derFltClear(); derSet('buegc', 'intact');
    battOn = false; battMode = 'whole'; render(); return { mlo, t1, d: [D1.backLive, D1.buFeedLive], t2, m, stillOn }; });
  expect(r.mlo).toBe(true); expect(r.t1).toContain('MAIN 100 A'); expect(r.d).toEqual([false, true]);
  expect(r.t2).toContain('N–G BONDED HERE'); expect(r.m).toContain('EGC BROKEN'); expect(r.stillOn).toBe(true);
  expect(errs).toEqual([]);
});

test('battery module size and location: kWh/kW follow the module, NFPA 855 15.5.2 limits (80 kWh garage/outside, 40 kWh utility room) are flagged', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { solarOn = true; battOn = true; battMode = 'whole'; sunMode = 'day'; derSet('invkw', 7.6); derSet('ninv', 1); nBat = 3; render();
    const T = () => [...document.querySelectorAll('#svg text')].map(t => t.textContent).join('|');
    const def = [batKwh(), batKW(), batLoc, derKwh()]; derSet('bloc', 'util'); const u = [batLimOk(), T().includes('NFPA 855 15.5.2'), document.getElementById('readout').innerHTML.includes('TOO MUCH BATTERY')];
    derSet('batt', 0); const small = [derKwh(), batLimOk()]; derSet('batt', 4); nBat = 5; render(); const big = [derKwh(), batLimOk('garage'), batLimOk('util')];
    derSet('batt', 2); derSet('bloc', 'garage'); nBat = 1; battOn = false; render(); return { def, u, small, big }; });
  expect(r.def).toEqual([13.5, 5, 'garage', 40.5]);
  expect(r.u).toEqual([false, true, true]);
  expect(r.small).toEqual([15, true]);
  expect(r.big).toEqual([75, true, false]);
  expect(errs).toEqual([]);
});

test('parallel units never feed each other through the battery: full bank = every unit idle, solar charging = each unit charges from its own PV', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { solarOn = true; battOn = true; battMode = 'whole'; sunMode = 'day'; derSet('invkw', 11.5); derSet('ninv', 2); derSet('mods', 15); derSet('str', 3); nBat = 3;
    const kw = () => [...document.querySelectorAll('#svg text')].map(t => t.textContent).filter(t => /^PV .* · BATT /.test(t));
    derSoc = 100; gridChg = true; render(); const full = kw(); derSoc = 50; gridChg = false; render(); const chg = kw();
    derSet('ninv', 1); battOn = false; render(); return { full, chg }; });
  expect(r.full).toEqual(['PV 4.0 kW · BATT 0.0 kW', 'PV 2.0 kW · BATT 0.0 kW']);
  expect(r.chg).toEqual(['PV 4.0 kW · BATT +4.0 kW', 'PV 2.0 kW · BATT +2.0 kW']);
  expect(errs).toEqual([]);
});

test('supply-side tap + whole home in an outage: inverters are stranded, nothing goes to the panel; solar only charges the battery over DC (stops when full)', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { solarOn = true; battOn = true; battMode = 'whole'; sunMode = 'day'; derSet('invkw', 15); derSet('ninv', 2); derSet('mods', 15); derSet('str', 3); nBat = 5; derSet('conn', 'svc'); toggleUtil();
    derSoc = 100; render(); const a = derState(); derSoc = 50; render(); const b = derState(); const kw = [...document.querySelectorAll('#svg text')].map(t => t.textContent).filter(t => /^PV .* · BATT /.test(t));
    toggleUtil(); derSet('ninv', 1); battOn = false; render(); return { a: [a.inv, a.pv, a.toMain, a.pvU.slice(1, 3)], b: [b.inv, b.pv, b.batt, b.toMain], kw }; });
  expect(r.a).toEqual(['stranded', 0, 0, [0, 0]]);
  expect(r.b).toEqual(['stranded', 6, 6, 0]);
  expect(r.kw).toEqual(['PV 4.0 kW · BATT +4.0 kW', 'PV 2.0 kW · BATT +2.0 kW']);
  expect(errs).toEqual([]);
});

test('generator on the GEN port with parallel inverters lands on every unit (gen panel) and the box clears the left controls', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { solarOn = true; battOn = true; battMode = 'partial'; sunMode = 'night'; derSet('invkw', 15); derSet('ninv', 3); nBat = 5; derSoc = 10;
    if (!GEN) document.getElementById('genBtn').click(); derSet('gstart', 'batt'); if (!utilOff) toggleUtil(); igSt = 'run'; render();
    const T = [...document.querySelectorAll('#svg text')].map(t => t.textContent);
    const g = [...document.querySelectorAll('#svg text')].find(t => t.textContent.startsWith('GENERATOR →')).getBoundingClientRect();
    const ctl = [...document.querySelectorAll('#svg text')].filter(t => t.textContent === 'GRID CHARGING · OFF' || t.textContent === 'GRID CHARGING · ON')[0].getBoundingClientRect();
    const out = { t: T.filter(x => /GENERATOR →|feeds #1|multi-tap|ON GENERATOR/.test(x)), clear: g.left > ctl.right };
    igReset(); toggleUtil(); document.getElementById('genBtn').click(); derSet('ninv', 1); battOn = false; battMode = 'whole'; render(); return out; });
  expect(r.t).toContain('GENERATOR → 3 GEN PORTS'); expect(r.t).toContain('feeds #1 · #2 · #3 (one J-box)'); expect(r.t.some(x => x.startsWith('multi-tap: 1 in · 3 out'))).toBe(true);
  expect(r.t.filter(x => x === 'ON GENERATOR').length).toBe(3); expect(r.clear).toBe(true);
  expect(errs).toEqual([]);
});

test('400 A service: meter-main / two disconnects / illegal shared compartment, Panel B takes the big loads and has its own 200 A disconnect', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { const T = () => [...document.querySelectorAll('#svg text')].map(t => t.textContent);
    const V = (a, b) => { probePick = [a, b]; const v = voltBetween(a, b); probePick = []; return v; };
    s4Set('mm'); const mm = T(), kwA = meterKW0(), kw = meterKW(), msgMM = document.getElementById('readout').innerHTML;
    const ev = mm.filter(t => t === 'EV charger').length, vB = V('PB:L1', 'PB:L2'), vA = V('SD:L1', 'SD:L2');
    b4Brk(); const vBoff = V('PB:L1', 'PB:L2'), vAon = V('SD:L1', 'SD:L2'), kwOff = meterKW(); b4Brk();
    s4Set('dual'); const du = T(); s4Set('bad'); const bad = T(), msgBad = document.getElementById('readout').innerHTML;
    s4Set('mm'); toggleUtil(); const vOut = V('PB:L1', 'PB:L2'); toggleUtil();
    s4Set(null); const off = T();
    return { mm: mm.includes('400 A METER-MAIN · CLASS 320'), pb: mm.includes('PANEL B (LOAD CENTER) · big loads'), ev, kwA, kw, vB, vA, vBoff, vAon, kwOff,
      du: du.includes('DISCONNECT B · 200 A → PANEL B'), bad: bad.includes('⚠ 400 A · 2 BREAKERS IN ONE COMPARTMENT'), msgMM: /230\.71\(B\)/.test(msgMM) && /400 kcmil Cu/.test(msgMM), msgBad: /NOT ALLOWED/.test(msgBad), vOut, off: off.includes('PANEL B (LOAD CENTER) · big loads') }; });
  expect(r.mm).toBe(true); expect(r.pb).toBe(true); expect(r.ev).toBe(1);
  expect(r.kw).toBeGreaterThan(r.kwA + 10); expect(r.vB).toBe(240); expect(r.vA).toBe(240);
  expect(r.vBoff).toBe(0); expect(r.vAon).toBe(240); expect(r.kwOff).toBeCloseTo(r.kwA, 1);
  expect(r.du).toBe(true); expect(r.bad).toBe(true); expect(r.msgMM).toBe(true); expect(r.msgBad).toBe(true);
  expect(r.vOut).toBe(0); expect(r.off).toBe(false);
  expect(errs).toEqual([]);
});

test('400 A with a generator: two 200 A service-rated ATSs, the generator passes through ATS A to ATS B, Panel B transfers and sheds its big loads', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(async () => { GSPEED = 50; s4Set('mm'); document.getElementById('genBtn').click(); render();
    const T = () => [...document.querySelectorAll('#svg text')].map(t => t.textContent);
    const a = T(); toggleUtil(); await new Promise(res => setTimeout(res, 5000)); render();
    const b = T(), live = b4Live(), onG = b4Gen(), shed = b4Shed(1); const ev0 = B4_LDS[0].kw; B4_LDS[0].kw = 40; const shedOver = b4Shed(1) && genLoad().kw <= GEN_KW; B4_LDS[0].kw = ev0; const v = voltBetween('PB:L1', 'PB:L2'), mk = meterKW(), rows = b.filter(t => t === '42').length;
    toggleUtil(); genReset(); document.getElementById('genBtn').click(); s4Set(null); return { ats: a.includes('ATS B · ') && a.includes('BREAKER B'), pt: a.some(t => t.startsWith('▲ GEN PASS-THROUGH')) && a.some(t => t.startsWith('L1 · L2 · N · EGC together')) && a.includes('N · G bars'), live, onG, shed, v, mk, shedOver, shedTxt: b.filter(t => t === 'LOAD-MANAGED · ON').length, rows }; });
  expect(r.ats).toBe(true); expect(r.pt).toBe(true); expect(r.live).toBe(true); expect(r.onG).toBe(true); expect(r.shed).toBe(false); expect(r.shedOver).toBe(true);
  expect(r.v).toBe(240); expect(r.mk).toBe(0); expect(r.shedTxt).toBe(5);   // 46.2 kW after air handler 1 sheds (52.2 kW wanted) — every Panel B managed load stays on expect(r.rows).toBeGreaterThanOrEqual(2);
  expect(errs).toEqual([]);
});

test('400 A Panel B has its own MAIN LUGS ⇄ MAIN BREAKER, illegal bond and feeder EGC controls', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { s4Set('mm'); const T = () => [...document.querySelectorAll('#svg text')].map(t => t.textContent);
    b4Ctl('mlo'); const t1 = T(); b4Ctl('main'); const a = [b4Feed(), b4Live(), b4KW()]; b4Ctl('main'); b4Ctl('mlo');
    b4Ctl('bond'); const t2 = T(); b4Ctl('bond'); b4Ctl('egc', 'broken'); b4FaultAt(1); const m = ckMsg, stuck = !b4C[1]; b4Clear(); b4Ctl('egc', 'intact'); s4Set(null);
    return { main: t1.includes('MAIN 200 A'), a, bond: t2.some(t => t.startsWith('⚠ N–G BONDED HERE')), m: m.includes('EGC OPEN'), stuck }; });
  expect(r.main).toBe(true); expect(r.a).toEqual([true, false, 0]); expect(r.bond).toBe(true); expect(r.m).toBe(true); expect(r.stuck).toBe(true);
  expect(errs).toEqual([]);
});

test('400 A + generator with a switched-neutral ATS: ATS B switches its neutral too; meter-main ATSs are separate enclosures', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(async () => { GSPEED = 50; s4Set('mm'); document.getElementById('genBtn').click(); document.querySelector('[data-atsn="switched"]').click(); render();
    const T = () => [...document.querySelectorAll('#svg text')].map(t => t.textContent); const a = T();
    toggleUtil(); await new Promise(res => setTimeout(res, 5000)); render(); const v = voltBetween('PB:L1', 'PB:L2');
    toggleUtil(); genReset(); document.querySelector('[data-atsn="solid"]').click(); document.getElementById('genBtn').click(); s4Set(null);
    return { pole: a.includes('N pole switched'), sepA: a.includes('BREAKER A') && a.some(t => t.startsWith('ATS A')), sepB: a.includes('ATS B · '), v }; });
  expect(r.pole).toBe(true); expect(r.sepA).toBe(true); expect(r.sepB).toBe(true); expect(r.v).toBe(240);
  expect(errs).toEqual([]);
});

test('400 A Panel B bus type switches between BRANCH BUS and STACKED (right side flipped)', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { s4Set('mm'); const T = () => [...document.querySelectorAll('#svg text')].map(t => t.textContent);
    const a = T().includes('BRANCH BUS'); b4Ctl('stk'); const b = T().includes('STACKED · R L2-L1'); b4Ctl('stk'); s4Set(null); return { a, b }; });
  expect(r.a).toBe(true); expect(r.b).toBe(true); expect(errs).toEqual([]);
});

test('400 A Panel B loads open the same circuit menu (fault · EGC · polarity · breaker type) and the breaker type changes how a fault clears', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(() => { s4Set('mm'); openCkMenu('Q', 2, { clientX: 100, clientY: 100 }); const m = document.getElementById('ckMenu').innerText; ckMenuClose();
    const req = protOf('Q', 2); prot['Q:2'] = 'std'; render(); const short = protShort('Q', 2); const t = [...document.querySelectorAll('#svg text')].some(x => / · NO GFCI/.test(x.textContent));
    faultType = 'LG'; b4FaultAt(2); const msgStd = ckMsg; b4Clear(); delete prot['Q:2']; b4FaultAt(2); const msgGf = ckMsg; b4Clear(); s4Set(null);
    return { menu: /680\.44\(A\)/.test(m) && /POLARITY/.test(m), req, short, t, msgStd: /magnetic/.test(msgStd), msgGf: /GFCI/.test(msgGf) }; });
  expect(r.menu).toBe(true); expect(r.req).toBe('gfci'); expect(r.short).toBe('GFCI'); expect(r.t).toBe(true); expect(r.msgStd).toBe(true); expect(r.msgGf).toBe(true);
  expect(errs).toEqual([]);
});

test('generator controller: weekly exercise Friday 12:00 PM runs unloaded, then stops; load shed only when the generator would be overloaded', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.clock.install({ time: new Date('2026-11-20T12:05:00-05:00') });   // Friday 12:05 PM Eastern (the browser runs on America/New_York)
  await page.goto('/electrical-theory/');
  await page.evaluate(() => { document.getElementById('genBtn').click(); render(); });
  await page.clock.runFor(3000);
  const a = await page.evaluate(() => ({ GST, gExer, SRC, pg: genDispPages()[0][0], txt: [...document.querySelectorAll('#svg text')].some(t => t.textContent === 'EXERCISE') }));
  expect(a).toEqual({ GST: 'run', gExer: true, SRC: 'util', pg: 'EXERCISING', txt: true });
  await page.clock.fastForward(8 * 60000); await page.clock.runFor(2500);
  const b = await page.evaluate(() => ({ GST, gExer, pages: genDispPages().map(p => p[0]) }));
  expect(b.GST).toBe('off'); expect(b.gExer).toBe(false);
  expect(b.pages).toEqual(['GEN VOLTS', 'GEN AMPS', 'POWER', 'EXERCISE', 'ENGINE', 'LOAD SHED', 'STATUS']);
  expect(errs).toEqual([]);
});

test('generator size cycles 22–48 kW; too small after load shedding → overload alarm, then its output breaker trips', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(async () => { GSPEED = 8; document.getElementById('genBtn').click(); render(); const sizes = [];
    for (let i = 0; i < 7; i++) { genSize(); sizes.push(GEN_KW + ':' + genAmps()); }
    s4Set('mm'); GEN_KW = 22; const gs0 = GEN_SHED.slice(); GEN_SHED = ['B9']; render(); toggleUtil(); await new Promise(res => setTimeout(res, 2500));
    const mid = { ovl: !!gOvl0, shed: genShedSet().length }; await new Promise(res => setTimeout(res, 2500));
    const end = { brk: genBrkOff, note: document.getElementById('readout').textContent.includes('TRIPPED') };
    toggleUtil(); genReset(); GEN_KW = 48; GEN_SHED = gs0; s4Set(null); return { sizes, mid, end }; });
  expect(r.sizes).toEqual(['22:100', '24:100', '26:110', '28:125', '32:150', '40:175', '48:200']);
  expect(r.mid).toEqual({ ovl: true, shed: 1 });   // only air handler 2 managed here: shedding it is not enough on 22 kW
  expect(r.end).toEqual({ brk: true, note: true });
  expect(errs).toEqual([]);
});

test('load shed demo: tapping a shed load forces it on — the next managed loads shed instead; tap again to release', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(async () => { GSPEED = 50; s4Set('mm'); document.getElementById('genBtn').click(); render(); toggleUtil(); await new Promise(res => setTimeout(res, 5000));
    const a = genShedSet().slice(); genForceTog('A22'); const b = genShedSet().slice(), kw = genLoad().kw; genForceTog('A22'); const c = genShedSet().slice();
    toggleUtil(); genReset(); s4Set(null); return { a, b, kw, c }; });
  expect(r.a).toEqual(['A22']); expect(r.b[0]).toBe('A13'); expect(r.b).not.toContain('A22'); expect(r.kw).toBeLessThanOrEqual(48); expect(r.c).toEqual(['A22']);
  expect(errs).toEqual([]);
});

test('400 A: a fault on the Panel B feeder trips breaker B on utility, the generator breaker on generator', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/electrical-theory/');
  const r = await page.evaluate(async () => { s4Set('mm'); faultType = 'LG'; b4FdrFault('L1'); const ff = b4FF; await new Promise(res => setTimeout(res, 1200)); const util = b4Off; b4Brk();
    faultType = 'NG'; b4FdrFault('L1'); const ng = b4Off; faultType = 'LG';
    GSPEED = 50; document.getElementById('genBtn').click(); render(); toggleUtil(); await new Promise(res => setTimeout(res, 5500));
    b4FdrFault('L2'); await new Promise(res => setTimeout(res, 1300)); const gen = { gb: genBrkOff, b4: b4Off };
    toggleUtil(); genReset(); document.getElementById('genBtn').click(); s4Set(null); return { ff, util, ng, gen }; });
  expect(r).toEqual({ ff: 'L1', util: true, ng: false, gen: { gb: true, b4: false } });
  expect(errs).toEqual([]);
});
