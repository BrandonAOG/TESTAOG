// One footer on every tool and form: identical lettering and colors, says BrandonAOG,
// shows on screen only (never printed, never in a PDF / CAPTURE image), and never hidden under a results bar.
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { ROOT, TOOLS, open } = require('./helpers');

const NO_FOOTER = ['property-lookup', 'site-annotator'];          // full-screen map / drawing area
const PAGES = TOOLS.filter(t => !NO_FOOTER.includes(t));
const FORMS = ['estimate', 'site-visit', 'pre-checklist', 'elect-install', 'gas-install', 'qc-checklist', 'maintenance', 'service-work'];
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('files: every tool and form loads the shared footer once, and the old footers are gone', () => {
  test.skip(test.info().project.name !== 'desktop', 'file check');
  const bad = [];
  for (const t of PAGES) {
    const s = read(`${t}/index.html`);
    if ((s.match(/<script src="\.\.\/aog-footer\.js"><\/script>/g) || []).length !== 1) bad.push(t + ': footer script');
    if (/Field Operations Portal|AOG FIELD OPERATIONS HUB —|class="app-footer"/i.test(s)) bad.push(t + ': old footer left');
  }
  expect(bad).toEqual([]);
  expect(read('sw.js')).toContain("'./aog-footer.js'");
});

for (const theme of ['light', 'dark']) test(`every page shows the same footer (${theme})`, async ({ page }) => {
  test.skip(test.info().project.name !== 'iphone', 'phone');
  const looks = {};
  for (const t of PAGES) {
    expect(await open(page, `/${t}/`, { theme, settle: 600 }), t).toEqual([]);
    const f = page.locator('footer.aog-foot');
    await expect(f, t).toHaveCount(1);
    await f.scrollIntoViewIfNeeded();
    await expect(f, t).toBeVisible();
    const r = await f.evaluate(el => {
      const cs = getComputedStyle(el), by = el.querySelector('.aog-foot-by');
      return { text: el.innerText.replace(/\s+/g, ' ').trim(), font: cs.fontFamily + ' ' + cs.fontSize + ' ' + cs.fontWeight + ' ' + cs.letterSpacing,
               color: cs.color, by: getComputedStyle(by).color, ignore: el.getAttribute('data-html2canvas-ignore'),
               inPage: !!el.closest('#page, #page1, #page2, #page2-inner, .form-page') };   // the forms' printable pages
    });
    expect(r.text, t).toMatch(/^ALWAYS ON GENERATORS · FIELD OPERATIONS HUB .+ BUILT BY BRANDON · @BRANDONAOG$/);
    expect(r.ignore, t + ': never in a CAPTURE / PDF image').toBe('true');
    if (FORMS.includes(t)) expect(r.inPage, t + ': not inside the printable form').toBe(false);
    looks[t] = [r.font, r.color, r.by].join(' | ');
  }
  const kinds = new Set(Object.values(looks));
  expect(kinds.size, 'identical on every page:\n' + JSON.stringify(looks, null, 1)).toBe(1);
  expect([...kinds][0]).toContain(theme === 'dark' ? 'rgb(0, 255, 200)' : 'rgb(217, 119, 6)');
});

test('the footer never prints', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  for (const t of ['maintenance', 'qc-checklist', 'elect-install', 'box-fill', 'load-calcs']) {
    await open(page, `/${t}/`, { settle: 400 });
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('footer.aog-foot'), t).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
  }
});

test('a results bar at the bottom of the screen never covers the footer (Breaker / Conductor)', async ({ page }) => {
  test.skip(test.info().project.name !== 'iphone', 'phone');
  expect(await open(page, '/breaker-conductor/', { settle: 600 })).toEqual([]);
  await page.evaluate(() => { const m = document.getElementById('mini'); m.style.transform = 'translateY(0)'; m.classList.add('show', 'on'); });
  await page.locator('footer.aog-foot').scrollIntoViewIfNeeded();
  await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTo(0, 1e6));
  await page.waitForTimeout(400);
  const [f, m] = await page.evaluate(() => [document.querySelector('footer.aog-foot .aog-foot-by').getBoundingClientRect().bottom, document.getElementById('mini').getBoundingClientRect().top]);
  expect(f, 'footer ends above the results bar').toBeLessThanOrEqual(m);
});

test('footer matches the page when no theme was ever picked, and after tapping 🌙 / ☀️', async ({ page }) => {
  test.skip(test.info().project.name !== 'iphone', 'phone');
  const bad = [];
  for (const t of PAGES) {
    await open(page, `/${t}/`, { settle: 500 });
    const check = () => page.evaluate(() => { const m = getComputedStyle(document.body).color.match(/[\d.]+/g); const dark = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 128; return dark === document.querySelector('footer.aog-foot').classList.contains('aog-foot-dark'); });
    if (!(await check())) bad.push(t + ' (start)');
    const btn = page.locator('#themeBtn, #theme-toggle-btn, .theme-toggle-ab, .theme-toggle-btn, [onclick*="toggleTheme"]').first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(700); if (!(await check())) bad.push(t + ' (after toggle)'); }
  }
  expect(bad).toEqual([]);
});
