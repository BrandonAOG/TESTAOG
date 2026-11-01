// Pop-up windows: while one is open, a swipe scrolls the WINDOW, never the page behind it,
// and closing it puts the page back exactly where it was.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'iphone', 'phone behaviour'));

const WINDOWS = [
  ['box-fill', () => document.querySelector('.ref-btn').click(), '#refModal', () => closeRef()],
  ['conduit-fill', () => document.querySelector('.ref-btn').click(), '.modal-bg', () => document.querySelector('.modal-bg.open [aria-label="Close"], .modal-bg.open .modal-x, .modal-bg.open button').click()],
  ['breaker-conductor', () => brOpen(), '#brModal', () => brClose()],
  ['gas-calc', () => grOpen('t'), '.gr-bg', () => grClose()],
];
for (const [dir, openFn, sel, closeFn] of WINDOWS) test(`${dir}: page stays put behind the Code Reference window`, async ({ page }) => {
  expect(await open(page, `/${dir}/`)).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(200);
  const y0 = await page.evaluate(() => scrollY);
  await page.evaluate(openFn);
  await expect(page.locator(sel).first()).toBeVisible();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => AOGScrollLock.locked), 'page pinned while the window is open').toBe(true);
  // swipe on the dark backdrop / window: the page underneath must not move
  const top0 = await page.evaluate(() => document.querySelector('h1,header,.action-bar,.container,main,body > *').getBoundingClientRect().top);
  await page.mouse.move(195, 420); await page.mouse.wheel(0, 600); await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollBy(0, 400));
  const top1 = await page.evaluate(() => document.querySelector('h1,header,.action-bar,.container,main,body > *').getBoundingClientRect().top);
  expect(top1, 'nothing behind the window moved').toBe(top0);
  await page.evaluate(closeFn);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => AOGScrollLock.locked)).toBe(false);
  expect(await page.evaluate(() => scrollY), 'back where you were').toBe(y0);
});

test('any full-screen pop-up on a form is covered (found by what it is, not by name)', async ({ page }) => {
  expect(await open(page, '/maintenance/')).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 500)); await page.waitForTimeout(200);
  const y0 = await page.evaluate(() => scrollY);
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'testPop'; d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6)'; document.body.appendChild(d); });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => AOGScrollLock.locked)).toBe(true);
  await page.evaluate(() => document.getElementById('testPop').remove());
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => [AOGScrollLock.locked, scrollY])).toEqual([false, y0]);
});

test('normal page: nothing is locked, the page scrolls as usual', async ({ page }) => {
  expect(await open(page, '/site-visit/')).toEqual([]);
  expect(await page.evaluate(() => AOGScrollLock.locked)).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(200);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
});

test('no page starts out locked (backgrounds, banners and toolbars are not pop-ups)', async ({ page }) => {
  const { TOOLS } = require('./helpers');
  const bad = [];
  for (const t of ['', ...TOOLS.filter(d => !['property-lookup', 'site-annotator'].includes(d)).map(d => d + '/')]) {
    await open(page, '/' + t, { settle: 900 });
    const s = await page.evaluate(() => window.AOGScrollLock ? AOGScrollLock.locked : 'missing');
    if (s !== false) bad.push(t + ':' + s);
  }
  expect(bad).toEqual([]);
});

// Every Code Reference window opens in the SAME spot (top of the screen, scrolled to its top) no matter which
// table you pick, how tall it is, or how far you scrolled the last one — and switching tabs starts at the top too.
for (const dir of ['box-fill', 'conduit-fill', 'pull-box', 'quick-calc', 'trench-depth', 'gas-bonding', 'gas-calc', 'breaker-conductor']) test(`${dir}: every reference window opens in the same spot`, async ({ page }) => {
  expect(await open(page, `/${dir}/`)).toEqual([]);
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const btns = [...document.querySelectorAll('.ref-btn, .br-card .br-btns button, [onclick^="grOpen"], [onclick^="brOpen"], [onclick^="openRef"], [onclick^="cfOpenRef"]')];
    const tops = [], scrolled = [];
    const scrollAll = bg => { bg.scrollTop = 400; bg.querySelectorAll('*').forEach(e => { if (e.scrollHeight > e.clientHeight + 5) e.scrollTop = 300; }); };
    const inner = bg => [bg, ...bg.querySelectorAll('*')].reduce((a, e) => a + e.scrollTop, 0);
    for (const b of btns) {
      b.scrollIntoView({ block: 'center' }); await sleep(80); b.click(); await sleep(250);
      const bg = [...document.querySelectorAll('.modal-bg, .gr-bg, .br-bg')].find(e => getComputedStyle(e).display !== 'none');
      if (!bg) continue;
      tops.push(Math.round(bg.firstElementChild.getBoundingClientRect().top)); scrolled.push(inner(bg));
      scrollAll(bg);
      const tabs = bg.querySelectorAll('.modal-tab, .gr-tab, .br-tab');
      if (tabs.length > 1) { tabs[tabs.length - 1].click(); await sleep(150); tops.push(Math.round(bg.firstElementChild.getBoundingClientRect().top)); scrolled.push(inner(bg)); }
      scrollAll(bg);
      const x = bg.querySelector('[aria-label="Close"], .modal-x, .modal-close, .gr-x, .br-x'); if (x) x.click(); else bg.click(); await sleep(200);
    }
    return { n: btns.length, tops, scrolled };
  });
  expect(r.tops.length).toBeGreaterThan(1);
  expect(new Set(r.tops).size, `same top every time: ${r.tops}`).toBe(1);
  expect(r.tops[0]).toBeGreaterThanOrEqual(16);
  expect(r.scrolled.every(v => v === 0), `opens scrolled to its top: ${r.scrolled}`).toBe(true);
});
