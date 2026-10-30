// Every page opens without a JavaScript error — on a desktop and on an iPhone-size screen,
// in light and dark mode.
const { test, expect } = require('@playwright/test');
const { TOOLS, open } = require('./helpers');

const PAGES = ['', ...TOOLS.map(t => t + '/')];

for (const p of PAGES) {
  for (const theme of ['light', 'dark']) {
    test(`${p || 'hub'} opens cleanly (${theme})`, async ({ page }) => {
      const errors = await open(page, '/' + p, { theme, settle: 1200 });
      await expect(page.locator('body')).toBeVisible();
      expect(errors, 'JavaScript errors on the page').toEqual([]);
    });
  }
}
