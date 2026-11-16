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
  expect(r.solarDay).toEqual(['grid', 6, -6.4]);   // 6 kW of solar under a ~12.4 kW house: it imports the rest
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
  expect(r.all).toBeGreaterThan(11); expect(r.all).toBeLessThan(14);
  expect(r.all - r.noAC).toBeCloseTo(2.5, 1);
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
