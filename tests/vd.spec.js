// Voltage drop (quick-calc) — the phase/current type is now THREE modes, not two.
// Before the fix single-phase and DC shared one button ("1Φ / DC") and the AC
// options (power factor, Table 9 reactance) stayed live on DC, which is wrong:
// DC has no reactance and no power factor. Now 1Φ · 3Φ · DC are separate.
//   VD = (1.732 for 3Φ else 2) × A × R × L ÷ 1000   — DC & 1Φ are both ×2 (out and back).
//   DC uses Table 8 resistance only (basis forced to 'dc', power factor hidden).
//   AC modes (1Φ, 3Φ) keep the power-factor control.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'math checks run once'));

// Open the Voltage Drop pane, pick a phase mode, and read back the state.
async function mode(page, v) {
  return await page.evaluate((v) => {
    const t = [...document.querySelectorAll('button,[data-pane],[data-tab]')]
      .find(e => /voltage drop/i.test(e.textContent) && e.offsetParent !== null);
    if (t) t.click();
    const btn = [...document.querySelectorAll('[data-tog="vdPh"] .toggle-opt')].find(x => x.dataset.v === v);
    btn.click();
    document.getElementById('vdA').value = '100';
    document.getElementById('vdL').value = '100';
    document.getElementById('vdSize').value = '7';   // #6 AWG Cu
    document.getElementById('vdSets').value = '1';
    const vEl = document.getElementById('vdV'); if (vEl) vEl.value = (v === '3' ? '480' : '240');
    calcVd();
    return {
      tog: TOG.vdPh,
      basisDisabled: document.getElementById('vdBasis').disabled,
      basisVal: document.getElementById('vdBasis').value,
      pfHidden: document.getElementById('vdPfW').style.display === 'none',
      ac: vdBasis().ac,
      // pure formula check, DC-resistance basis so 1Φ vs 3Φ is apples-to-apples
      vd: +(vdFor(7, 100, 100, 1, v === '3', false)).toPrecision(4),
    };
  }, v);
}

test('three separate modes: 1Φ and DC are ×2, 3Φ is ×1.732', async ({ page }) => {
  expect(await open(page, '/quick-calc/')).toEqual([]);
  // the toggle now offers all three
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('[data-tog="vdPh"] .toggle-opt')].map(x => x.dataset.v));
  expect(opts).toEqual(['1', '3', 'dc']);

  const one = await mode(page, '1');
  const three = await mode(page, '3');
  // 1Φ: 2 × 100A × R(#6) × 100ft ÷ 1000
  expect(one.vd).toBeCloseTo(3.88, 2);
  // 3Φ: 1.732 × same → smaller by √3/2
  expect(three.vd).toBeCloseTo(3.36, 2);
  expect(three.vd / one.vd).toBeCloseTo(0.866, 2);
});

test('each mode offers its full nominal-voltage list plus Other', async ({ page }) => {
  expect(await open(page, '/quick-calc/')).toEqual([]);
  const lists = await page.evaluate(() => {
    const t = [...document.querySelectorAll('button,[data-pane],[data-tab]')]
      .find(e => /voltage drop/i.test(e.textContent) && e.offsetParent !== null);
    if (t) t.click();
    const read = v => {
      [...document.querySelectorAll('[data-tog="vdPh"] .toggle-opt')].find(x => x.dataset.v === v).click();
      return [...document.getElementById('vdV').options].map(o => o.value);
    };
    return { one: read('1'), three: read('3'), dc: read('dc') };
  });
  expect(lists.one).toEqual(['120', '208', '240', '277', '480', 'o']);
  expect(lists.three).toEqual(['208', '240', '480', '600', 'o']);
  expect(lists.dc).toEqual(['12', '24', '48', '120', '125', '240', '250', 'o']);
});

test('1Φ keeps the AC power-factor control (revealed when an AC basis is chosen)', async ({ page }) => {
  expect(await open(page, '/quick-calc/')).toEqual([]);
  const one = await mode(page, '1');
  expect(one.tog).toBe('1');
  expect(one.basisDisabled).toBe(false);   // 1Φ may switch to an AC conduit basis
  // picking an AC basis reveals the power-factor input (DC never can)
  const r = await page.evaluate(() => {
    $('vdBasis').value = 'pvc'; calcVd();
    return { shown: document.getElementById('vdPfW').style.display !== 'none' && vdBasis().ac === true,
             pfDefault: document.getElementById('vdPf').value };
  });
  expect(r.shown).toBe(true);
  expect(r.pfDefault).toBe('1');   // power factor defaults to unity
});

test('DC forces resistance-only: Table 8 basis locked, no power factor, no reactance', async ({ page }) => {
  expect(await open(page, '/quick-calc/')).toEqual([]);
  const dc = await mode(page, 'dc');
  expect(dc.tog).toBe('dc');
  expect(dc.basisVal).toBe('dc');       // Table 8 DC resistance
  expect(dc.basisDisabled).toBe(true);  // can't switch to an AC basis
  expect(dc.pfHidden).toBe(true);       // power factor hidden
  expect(dc.ac).toBe(false);            // reactance never applied on DC
  expect(dc.vd).toBeCloseTo(3.88, 2);   // same ×2 as 1Φ
});
