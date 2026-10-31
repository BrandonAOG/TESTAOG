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
