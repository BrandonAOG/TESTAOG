// Launch intro on the hub (v3.1.3): logo spin-up with glitter, once per app launch, tap to skip, never traps
// the hub, silent unless "Intro spin-up" is switched on in Sound Settings.
const { test, expect } = require('@playwright/test');

const errs = (page) => { const e = []; page.on('pageerror', x => e.push(x.message)); return e; };

test('intro plays, removes itself, and leaves the hub usable', async ({ page }) => {
  const e = errs(page);
  await page.goto('/?intro');
  const intro = page.locator('#aog-intro');
  await expect(intro).toBeVisible();
  await page.waitForTimeout(1500);
  // the logo is spinning and glitter is on the canvas
  const lit = await page.evaluate(() => { const c = document.querySelector('#aog-intro canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
  expect(lit).toBeGreaterThan(200);
  await expect(intro).toHaveCount(0, { timeout: 7000 });
  expect(e).toEqual([]);
});

test('a tap skips it right away', async ({ page }) => {
  await page.goto('/?intro');
  await page.waitForTimeout(400);
  await page.locator('#aog-intro').dispatchEvent('pointerdown');
  await expect(page.locator('#aog-intro')).toHaveCount(0, { timeout: 1000 });
});

test('it does not replay when coming back to the hub in the same launch, and test browsers skip it', async ({ page }) => {
  await page.goto('/');                                           // webdriver: skipped
  await expect(page.locator('#aog-intro')).toHaveCount(0);
  // a real phone (no webdriver flag): first hub load plays, the second doesn't
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.goto('/'); await expect(page.locator('#aog-intro')).toHaveCount(1);
  await page.goto('/'); await expect(page.locator('#aog-intro')).toHaveCount(0);
});

test('it is skipped when the phone asks for reduced motion', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.goto('/');
  await expect(page.locator('#aog-intro')).toHaveCount(0);
  await ctx.close();
});

test('intro sound is off by default, and the setting turns it on', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.AOGSound);
  expect(await page.evaluate(() => window.AOGSound.getPrefs().intro)).toBe(false);
  await page.click('#sound-toggle-btn');
  const sw = page.locator('[data-cat="intro"]');
  await expect(sw).toBeVisible();
  await sw.click();
  expect(await page.evaluate(() => window.AOGSound.getPrefs().intro)).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aog-sound-prefs')).intro)).toBe(true);
});
