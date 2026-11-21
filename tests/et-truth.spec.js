// Electrical Theory must tell the TRUTH about why power is off. Brandon (Nov 21 2026): "when there's no
// utility power it says that it's an open breaker, but it's not — test other ways too."
// Sweep: every system × service size × add-on, knock the power out every way the page offers, and read
// EVERYTHING it says (What's Happening + every label in the drawing). It must never claim a device is
// open / off / pressed / failed that isn't — and a plain utility outage must be called a utility outage.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test('Electrical Theory never blames a breaker, disconnect or generator control that is not actually open', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'state sweep — runs once');
  test.setTimeout(240000);
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  expect(await open(page, '/electrical-theory/', { settle: 1500 })).toEqual([]);
  const bad = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const click = sel => { const b = document.querySelector(sel); if (b) b.click(); };
    const words = () => (document.getElementById('readout').textContent + ' ¶ ' + [...document.querySelectorAll('#svg text')].map(t => t.textContent).join(' · ')).replace(/\s+/g, ' ');
    // claim → the state that must be true for the claim to be allowed
    const RULES = [
      [/SERVICE OPEN|service disconnect (is )?open|Service disconnect is OPEN|utility breaker (is )?open/i, () => svcOff, 'service disconnect open'],
      [/MAIN OPEN|panel main is OFF|PANEL MAIN OPEN|the main breaker is open/i, () => lcMainOff || (typeof buMainOff !== 'undefined' && buMainOff) || (typeof b4MainOff !== 'undefined' && b4MainOff), 'panel main open'],
      [/generator breaker is open|GEN BREAKER OPEN|its breaker is OFF/i, () => genBrkOff, 'generator breaker open'],
      [/E-STOP PRESSED|E-stop is pressed|GEN E-STOP/i, () => ESTOP, 'E-stop pressed'],
      [/controller is in OFF|GEN IN OFF|GENERATOR IN OFF|controller is switched OFF/i, () => GMODE === 'off', 'controller in OFF'],
      [/UTILITY OUT|power failure|UTILITY POWER FAILURE/i, () => utilOff, 'utility outage'],
      [/breaker 39\/41 is open|SOLAR BREAKER OFF/i, () => !isOn(39), 'solar breaker 39/41 off'],
      [/GRID breaker is open/i, () => invGridOff, 'inverter GRID breaker open'],
      [/AC DISCONNECT OPEN/i, () => derAcOff, 'AC disconnect open'],
    ];
    const out = [], seen = new Set();
    // the voltmeter: every pair of probe points on screen, explained in this state
    const probes = () => { const ids = Object.keys(PROBE_SEEN); const t = []; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { probePick = [ids[i], ids[j]]; try { t.push(probeText().replace(/<[^>]+>/g, '')); } catch (e) { t.push('PROBE ERROR ' + ids[i] + '/' + ids[j] + ': ' + e.message); } } probePick = []; return t.join(' ⁞ '); };
    const check = (label) => {
      for (const k of Object.keys(PROBE_SEEN)) delete PROBE_SEEN[k]; render();
      const w = words() + ' ⟦probes⟧ ' + probes();
      if (/PROBE ERROR/.test(w)) out.push(label + ' → ' + w.match(/PROBE ERROR[^⁞]*/)[0]);
      for (const [re, ok, what] of RULES) {
        const m = w.match(re);
        if (m && !ok()) { const k = what + '|' + label.replace(/ \(.*/, ''); if (!seen.has(k)) { seen.add(k); out.push(label + ' → says "' + m[0] + '" but ' + what + ' is FALSE · …' + w.slice(Math.max(0, m.index - 70), m.index + 70) + '…'); } }
      }
      return w;
    };
    const reset = async () => { if (utilOff) toggleUtil(); if (svcOff) toggleSvc(); if (lcMainOff && !MLO) toggleLcMain(); try { genReset(); } catch (e) {} render(); await wait(20); };
    GSPEED = 60;                                                            // run the generator timers fast
    const systems = [...document.querySelectorAll('#sysGrp [data-sys]')].map(b => b.dataset.sys);
    const addons = [[], ['#genBtn'], ['#solarBtn'], ['#solarBtn', '#battBtn'], ['#genBtn', '#solarBtn', '#battBtn'], ['#poolBtn'], ['#dockBtn'], ['#xfBtn']];
    for (const sys of systems) for (const svc of ['200', '400']) for (const add of addons) {
      click('[data-sys="' + sys + '"]'); await wait(10); click('[data-svc="' + svc + '"]'); await wait(10);
      ['#genBtn', '#solarBtn', '#battBtn', '#poolBtn', '#dockBtn', '#xfBtn'].forEach(s => { const b = document.querySelector(s); if (b && b.classList.contains('on')) b.click(); });
      await reset();
      for (const s of add) click(s);
      render(); await wait(10);
      const tag = sys + ' ' + svc + 'A +' + (add.map(a => a.slice(1, -3)).join('+') || 'nothing');
      check(tag + ' (normal)');
      // 1) utility power failure — and, with a generator, every stage of it coming on
      toggleUtil(); render(); await wait(10);
      const w1 = check(tag + ' (utility out)');
      if (!genOK() && !/UTILITY OUT|power failure|UTILITY POWER FAILURE/i.test(w1) && !/NO GRID|ISLAND|ON BATTERY|SOLAR \+ BATTERY|ON SOLAR/i.test(w1))
        out.push(tag + ' (utility out) → never says the utility is out');
      if (genOK()) { await wait(150); check(tag + ' (utility out, gen started)'); await wait(250); check(tag + ' (utility out, on generator)'); }
      await reset();
      // 2) service disconnect opened by hand
      toggleSvc(); render(); await wait(10); check(tag + ' (service open)'); if (genOK()) { await wait(400); check(tag + ' (service open, on generator)'); }
      await reset();
      // 3) panel main opened
      if (!MLO) { toggleLcMain(); render(); await wait(10); check(tag + ' (panel main open)'); await reset(); }
      if (genOK()) {
        // 4) E-stop pressed, then the utility fails
        toggleEstop(); toggleUtil(); render(); await wait(300); check(tag + ' (E-stop + utility out)'); await reset();
        // 5) controller in OFF, then the utility fails
        setGenMode('off'); toggleUtil(); render(); await wait(300); check(tag + ' (gen OFF + utility out)'); await reset();
        // 6) on generator with its breaker opened
        toggleUtil(); await wait(450); if (SRC === 'gen') { toggleGenBrk(); render(); await wait(10); check(tag + ' (on gen, gen breaker open)'); } await reset();
      }
    }
    return out;
  });
  expect(bad, bad.join('\n')).toEqual([]);
  expect(errs).toEqual([]);
});

test('400 A two-disconnect service: the gutter taps are called SERVICE conductors (not feeders) and the line-side splice rule is named', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'text check — runs once');
  expect(await open(page, '/electrical-theory/', { settle: 1200 })).toEqual([]);
  const t = await page.evaluate(() => { document.querySelector('[data-svc="400"]').click(); const o = {};
    for (const m of ['dual', 'mm']) { s4Set(m); o[m] = document.getElementById('readout').textContent.replace(/\s+/g, ' '); } return o; });
  expect(t.dual).toMatch(/meter to the gutter\): 400 kcmil Cu/);
  expect(t.dual).toMatch(/tap conductors to a 200 A disconnect is still a service conductor/);
  expect(t.dual).toMatch(/past the disconnect the feeder runs on to its panel/);
  expect(t.dual).toMatch(/suitable for use on the line side of the service equipment" \(230\.46\)/);
  expect(t.mm).not.toMatch(/tap conductors|gutter/);                       // meter-main: no taps, wording unchanged
  expect(t.mm).toMatch(/Each 200 A feeder to a panel does NOT carry the whole load/);
});
