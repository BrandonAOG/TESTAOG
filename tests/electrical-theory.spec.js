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
    const top = +[...document.querySelectorAll('#svg text')].find(t => t.textContent.startsWith('LOAD CENTER')).getAttribute('y') + 43;   // panel top (label sits on the enclosure)
    dotPool.forEach(dp => { const m = dp.mp.getAttribute('d').match(/^M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)$/); if (m && m[2] === m[4]) rows[Math.round(+m[2]) - top] = dp.dir; });
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
