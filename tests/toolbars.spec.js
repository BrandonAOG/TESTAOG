// Toolbars: every form has the same buttons in the same order, and every calculator tool the same bar.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

const FORMS = ['estimate', 'site-visit', 'pre-checklist', 'elect-install', 'gas-install', 'qc-checklist', 'maintenance', 'service-work'];
const CALCS = ['quick-calc', 'box-fill', 'breaker-conductor', 'conduit-fill', 'gas-bonding', 'pull-box', 'trench-depth', 'gas-calc', 'concrete-calc'];
const visibleButtons = page => page.evaluate(() => [...document.querySelectorAll('.action-bar > a, .action-bar > button')]
  .filter(e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.offsetWidth > 0; })
  .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()));

for (const f of FORMS) {
  test(`${f}: toolbar is HOME · PDF✎ · CAPTURE · LOAD · CLEAR · theme, and fits on an iPhone`, async ({ page }) => {
    page.on('dialog', d => d.accept());
    expect(await open(page, `/${f}/`)).toEqual([]);
    const names = (await visibleButtons(page)).filter(Boolean);
    expect(names.slice(0, 5)).toEqual(['🏠 HOME', '📝 PDF✎', '📸 CAPTURE', '📂 LOAD', '🗑 CLEAR']);
    expect(names.some(n => n === '📄 PDF'), 'no plain print-PDF button').toBe(false);
    await expect(page.locator('.action-bar .theme-toggle-btn')).toBeVisible();
    if (test.info().project.name === 'iphone' && f !== 'elect-install') {            // Elect Install also has 🎤 VOICE, so it scrolls
      const spill = await page.evaluate(() => { const a = document.querySelector('.action-bar'); return a.scrollWidth - a.clientWidth; });
      expect(spill, 'every button, theme included, is on screen without scrolling').toBeLessThanOrEqual(1);
    }
  });
}

for (const t of CALCS) {
  test(`${t}: same calculator bar (🏠 HOME first, square 🌙/☀️ theme button last)`, async ({ page }) => {
    expect(await open(page, `/${t}/`)).toEqual([]);
    const names = await visibleButtons(page);
    expect(names[0]).toBe('🏠 HOME');
    const theme = page.locator('.action-bar > .theme-toggle-ab');
    await expect(theme).toBeVisible();
    const before = await theme.innerText();
    expect(['🌙', '☀️']).toContain(before);
    await theme.click();
    await expect(theme).not.toHaveText(before);                                        // icon flips with the theme
  });
}

// Code Reference windows on the calculators: kept clear of the iPhone notch / Dynamic Island and home bar
// (the browser here reports a 0 safe area, so the rule itself is checked), and the × closes the window on a phone.
test.describe('Code Reference windows', () => {
  const fs = require('fs'), path = require('path');
  const { ROOT, open } = require('./helpers');
  const PAGES = [['breaker-conductor', '.br-bg', () => brOpen && brOpen()], ['gas-calc', '.gr-bg', () => grOpen('t')],
                 ['box-fill', '.modal-bg'], ['conduit-fill', '.modal-bg'], ['pull-box', '.modal-bg'], ['quick-calc', '.modal-bg'],
                 ['trench-depth', '.modal-bg'], ['gas-bonding', '.modal-bg']];
  test('every window\'s backdrop pads for the safe area (notch / island / home bar)', () => {
    test.skip(test.info().project.name !== 'desktop', 'file check');
    const bad = [];
    for (const [dir, sel] of PAGES) {
      const src = fs.readFileSync(path.join(ROOT, dir, 'index.html'), 'utf8');
      const rule = src.match(new RegExp(sel.replace('.', '\\.') + '\\s*\\{[^}]*\\}'));
      if (!rule || !/safe-area-inset-top/.test(rule[0])) bad.push(dir);
      // …and no phone-size rule that takes that padding away again (edge-to-edge put the × under the island)
      if (new RegExp(sel.replace('.', '\\.') + '\\s*\\{\\s*padding\\s*:\\s*0\\b').test(src)) bad.push(dir + ' (phone rule removes the padding)');
    }
    expect(bad).toEqual([]);
  });
  for (const [dir, sel, tabSel] of [['gas-calc', '.gr-bg', '.gr-tab'], ['breaker-conductor', '.br-bg', '.br-tab']]) test(`${dir}: switching Code Reference tabs doesn't move the window or the tab row`, async ({ page }) => {
    test.skip(test.info().project.name !== 'iphone', 'phone');
    expect(await open(page, `/${dir}/`)).toEqual([]);
    await page.evaluate(dir === 'gas-calc' ? () => grOpen('t') : () => brOpen());
    const tabs = page.locator(`${sel}.open ${tabSel}`);
    const n = await tabs.count(); expect(n).toBeGreaterThan(1);
    const ys = [];
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).tap(); await page.waitForTimeout(150);
      ys.push(await page.evaluate(([s, t]) => { const a = document.querySelector(s + '.open ' + t).parentElement.getBoundingClientRect(); return [Math.round(a.top), Math.round(a.bottom)]; }, [sel, tabSel]));
    }
    expect(ys.every(y => y[0] === ys[0][0] && y[1] === ys[0][1]), `tab row stays put: ${JSON.stringify(ys)}`).toBe(true);
  });
  for (const [dir, sel] of PAGES.slice(0, 2)) test(`${dir}: on a phone the whole window fits and × closes it`, async ({ page }) => {
    test.skip(test.info().project.name !== 'iphone', 'phone');
    expect(await open(page, `/${dir}/`)).toEqual([]);
    await page.evaluate(dir === 'gas-calc' ? () => grOpen('t') : () => { const b = [...document.querySelectorAll('button')].find(x => /code reference|nec/i.test(x.textContent)); window.brOpen ? brOpen() : b && b.click(); });
    const x = page.locator(`${sel}.open [aria-label="Close"]`).first();
    await expect(x).toBeVisible();
    const box = await x.boundingBox();
    expect(box.y, '× is on screen, not cut off at the top').toBeGreaterThanOrEqual(8);
    await x.tap();
    await expect(page.locator(`${sel}.open`)).toHaveCount(0);
  });
});
