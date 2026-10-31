// Battery saver: no button — it follows the phone (Reduce Motion, or ≤20% battery not charging) and stops decorative motion in every tool.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { ROOT, TOOLS, open } = require('./helpers');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// a cheap fingerprint of what a canvas is showing right now
const frame = (page, sel) => page.evaluate(s => {
  const c = document.querySelector(s); if (!c || !c.width) return 'none';
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, n = 0;
  for (let i = 3; i < d.length; i += 64) if (d[i]) { n++; h = (h * 31 + d[i - 1] + i) % 1000000007; }
  return n + ':' + h;
}, sel);

test.describe('files', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'file checks run once'));
  test('every page loads battery-saver.js (not deferred, before sounds.js) and it works offline', () => {
    const bad = [];
    for (const [f, rel] of [['index.html', './'], ...TOOLS.map(t => [`${t}/index.html`, '../'])]) {
      const s = read(f), a = s.indexOf(`<script src="${rel}battery-saver.js"></script>`), b = s.indexOf(`<script src="${rel}sounds.js" defer></script>`);
      if (a < 0 || b < 0 || a > b) bad.push(f);
    }
    expect(bad).toEqual([]);
    expect(read('sw.js')).toContain("'./battery-saver.js'");
  });
});

test('hub: normal phone → animated background; Reduce Motion → a still picture', async ({ browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const normal = await browser.newContext({ serviceWorkers: 'block' }), p1 = await normal.newPage();
  expect(await open(p1, '/', { settle: 1200 })).toEqual([]);
  expect(await p1.evaluate(() => window.AOGSaver.on)).toBe(false);
  const moving = [await frame(p1, '#bg-canvas')]; await p1.waitForTimeout(400); moving.push(await frame(p1, '#bg-canvas'));
  expect(moving[0], 'background animates normally').not.toBe(moving[1]);
  expect(await p1.locator('#saver-btn').count(), 'no battery button on the hub').toBe(0);
  await normal.close();

  const calm = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' }), p2 = await calm.newPage();
  expect(await open(p2, '/', { settle: 1200 })).toEqual([]);
  expect(await p2.evaluate(() => document.documentElement.classList.contains('aog-saver'))).toBe(true);
  const still = [await frame(p2, '#bg-canvas')]; await p2.waitForTimeout(600); still.push(await frame(p2, '#bg-canvas'));
  expect(still[0], 'background is a still picture').toBe(still[1]);
  expect(still[0], 'not a blank background').not.toMatch(/^0:/);
  await calm.close();
});

test('forms with the saver on: no holiday particles, glow effects finish, spinners still turn; back on when it turns off', async ({ browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const ctx = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' }), page = await ctx.newPage();
  expect(await open(page, '/maintenance/?season=halloween', { settle: 1200 })).toEqual([]);
  expect(await page.evaluate(() => window.AOGSaver.on)).toBe(true);
  expect(await page.evaluate(() => document.body.className)).toMatch(/seasonal-halloween/);          // holiday colors stay
  expect(await frame(page, '#seasonal-canvas'), 'no falling particles').toMatch(/^(0:|none)/);
  const r = await page.evaluate(() => {
    const logo = document.querySelector('.logo-img, img[src*="logo"]');
    const sp = document.createElement('div'); sp.style.cssText = 'animation:render-spin .8s linear infinite'; document.body.appendChild(sp);
    return { logo: logo ? getComputedStyle(logo).animationIterationCount : '1', spinner: getComputedStyle(sp).animationIterationCount };
  });
  expect(r.logo, 'pulsing logo stops').toBe('1');
  expect(r.spinner, 'a "building your PDF" spinner keeps turning').toBe('infinite');
  // Reduce Motion switched off on the phone → particles come back without a reload
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.AOGSaver.on)).toBe(false);
  expect(await frame(page, '#seasonal-canvas')).not.toMatch(/^0:/);
  await ctx.close();
});

test('turns on by itself at 20% battery (not charging) and with Reduce Motion', async ({ browser }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const low = await browser.newContext({ serviceWorkers: 'block' });
  const p1 = await low.newPage();
  await p1.addInitScript(() => {
    const b = { level: 0.15, charging: false, addEventListener() {} };
    Object.defineProperty(navigator, 'getBattery', { value: () => Promise.resolve(b) });
  });
  await open(p1, '/quick-calc/');
  expect(await p1.evaluate(() => [window.AOGSaver.on, window.AOGSaver.reason])).toEqual([true, 'low battery (15%)']);
  await low.close();

  const charging = await browser.newContext({ serviceWorkers: 'block' });
  const p2 = await charging.newPage();
  await p2.addInitScript(() => {
    const b = { level: 0.15, charging: true, addEventListener() {} };
    Object.defineProperty(navigator, 'getBattery', { value: () => Promise.resolve(b) });
  });
  await open(p2, '/quick-calc/');
  expect(await p2.evaluate(() => window.AOGSaver.on), 'plugged in → stays off').toBe(false);
  await charging.close();

  const calm = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  const p3 = await calm.newPage();
  await open(p3, '/quick-calc/');
  expect(await p3.evaluate(() => [window.AOGSaver.on, window.AOGSaver.reason])).toEqual([true, 'Reduce Motion is on']);
  await calm.close();
});
