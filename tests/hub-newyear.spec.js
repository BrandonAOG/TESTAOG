// Hub — the New Year show and the New Year touch on the launch intro (v3.1.4). Brandon (Nov 2026): a one-time ball drop
// + fireworks "Happy New Year … from Always On Generators" after the 1st of the year, no skip, a tap first so iPhones
// get sound; then for the rest of the seasonal New Year theme, confetti + "Happy New Year" in the normal intro.
// Kept OUT of the update notes on purpose — it's a surprise.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test('the New Year show: tap card → countdown → fireworks → hub, then never again that year', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  test.setTimeout(60000);
  expect(await open(page, '/?newyear&year=2031', { settle: 600 })).toEqual([]);
  const before = await page.evaluate(() => ({ card: !!document.querySelector('#aog-ny .ny-start:not(.gone)'), held: window.AOGIntro && window.AOGIntro.active,
    intro: !!document.getElementById('aog-intro'), yr: document.querySelector('#aog-ny .ny-t1').textContent }));
  expect(before).toEqual({ card: true, held: true, intro: false, yr: 'RING IN 2031' });
  // it waits for the tap
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.querySelector('#aog-ny .ny-count').textContent)).toBe('');
  await page.click('#aog-ny');
  await page.waitForTimeout(2200);
  const mid = await page.evaluate(() => ({ n: document.querySelector('#aog-ny .ny-count').textContent, key: localStorage.getItem('aog-newyear-shown') }));
  expect(['4', '3']).toContain(mid.n);
  expect(mid.key).toBe('2031');
  // a tap during the show does NOT skip it
  await page.click('#aog-ny'); await page.waitForTimeout(300);
  expect(await page.$('#aog-ny')).not.toBeNull();
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => document.querySelector('#aog-ny .ny-msg').classList.contains('on') && document.querySelector('#aog-ny .ny-yr').textContent)).toBe('2031');
  await page.waitForTimeout(6500);
  expect(await page.evaluate(() => ({ gone: !document.getElementById('aog-ny'), held: window.AOGIntro.active }))).toEqual({ gone: true, held: false });
});

test('outside the New Year theme there is no show, and a device that already had it skips it', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  // a real browser (not forced): seasonal New Year, but this year already shown → nothing
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); try { localStorage.setItem('aog-newyear-shown', String(new Date().getMonth() === 0 ? new Date().getFullYear() : new Date().getFullYear() + 1)); } catch (e) {} });
  expect(await open(page, '/?season=newyear', { settle: 600 })).toEqual([]);
  expect(await page.$('#aog-ny')).toBeNull();
  // and Christmas never shows it
  await page.evaluate(() => localStorage.removeItem('aog-newyear-shown'));
  await page.goto(page.url().replace('season=newyear', 'season=christmas')); await page.waitForTimeout(600);
  expect(await page.$('#aog-ny')).toBeNull();
});

test('first launch of the New Year theme on a real device shows it', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  expect(await open(page, '/?season=newyear', { settle: 600 })).toEqual([]);
  expect(await page.$('#aog-ny .ny-start')).not.toBeNull();
});

test('the launch intro gets the New Year touch: confetti and the greeting as the tagline', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  test.setTimeout(30000);
  expect(await open(page, '/?intro&season=newyear', { settle: 300 })).toEqual([]);
  await page.waitForTimeout(6200);
  const r = await page.evaluate(() => { const t = document.querySelector('#aog-intro .ai-tag'); return t ? { txt: t.textContent, ny: t.classList.contains('ny') } : null; });
  expect(r).toEqual({ txt: expect.stringMatching(/^\/\/ HAPPY NEW YEAR \d{4} \/\/$/), ny: true });
});

test('the normal launch intro is unchanged outside New Year', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  test.setTimeout(30000);
  expect(await open(page, '/?intro&season=christmas', { settle: 300 })).toEqual([]);
  await page.waitForTimeout(6200);
  expect(await page.evaluate(() => document.querySelector('#aog-intro .ai-tag').textContent)).toBe('// POWER WHEN YOU NEED IT //');
});
