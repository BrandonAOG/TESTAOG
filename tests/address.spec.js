// Address autocomplete: the same Mapbox lookup on every form, one token in one file.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { ROOT, TOOLS, open } = require('./helpers');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Every page with a job address, and the box to type in.
const PAGES = [
  { dir: 'estimate',      box: '#address',                     own: true },   // has its own list (fills street + City/State/ZIP)
  { dir: 'qc-checklist',  box: '#cust_addr',                   own: true },
  { dir: 'maintenance',   box: '#address' },
  { dir: 'site-visit',    box: '[data-field="job-address"]' },
  { dir: 'gas-install',   box: 'input[data-aog-address]' },
  { dir: 'elect-install', box: 'input[data-aog-address]' },
  { dir: 'service-work',  box: '#cust_addr' },
  { dir: 'pre-checklist', box: 'input[data-aog-address]' },
  { dir: 'load-calcs',    box: '#j_addr' },
];

// A fake Mapbox answer, so the check never depends on the internet.
const FEATURES = { type: 'FeatureCollection', features: [
  { place_name: '1234 Del Prado Blvd S, Cape Coral, Florida 33990, United States', address: '1234', text: 'Del Prado Blvd S', context: [{ id: 'postcode.1', text: '33990' }, { id: 'place.1', text: 'Cape Coral' }, { id: 'region.1', text: 'Florida' }] },
  { place_name: '1234 Del Mar Dr, Fort Myers, Florida 33901, United States', address: '1234', text: 'Del Mar Dr', context: [{ id: 'place.2', text: 'Fort Myers' }] },
] };

test.describe('files', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'file checks run once'));

  test('the Mapbox token lives in address-lookup.js only, and every address page loads it', () => {
    const withToken = ['index.html', 'address-lookup.js', ...TOOLS.map(t => `${t}/index.html`)].filter(f => /pk\.eyJ1/.test(read(f)));
    expect(withToken).toEqual(['address-lookup.js']);
    const missing = PAGES.filter(p => !read(`${p.dir}/index.html`).includes('<script src="../address-lookup.js"></script>')).map(p => p.dir);
    expect(missing).toEqual([]);
    expect(read('sw.js')).toContain("'./address-lookup.js'");                  // works offline like the other shared scripts
  });
});

for (const p of PAGES) {
  test(`${p.dir}: typing an address shows SW Florida suggestions and picking one fills the box`, async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop' && p.own, 'own list: checked on desktop');
    page.on('dialog', d => d.accept());
    expect(await open(page, `/${p.dir}/`)).toEqual([]);
    let token = '';
    await page.route(/api\.mapbox\.com/, r => { token = new URL(r.request().url()).searchParams.get('access_token'); r.fulfill({ json: FEATURES }); });
    const box = page.locator(p.box).first();
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await box.pressSequentially('1234 Del', { delay: 30 });
    const item = p.own ? page.locator('#address-suggestions li').first() : page.locator('.aog-addr-list.open li').first();
    await expect(item).toContainText('1234 Del Prado Blvd S, Cape Coral');
    expect(token).toMatch(/^pk\./);
    if (test.info().project.name === 'iphone') await item.tap(); else await item.click();   // a real tap / click, as a tech would
    if (p.dir === 'estimate') await expect(box).toHaveValue('1234 Del Prado Blvd S');
    else await expect(box).toHaveValue('1234 Del Prado Blvd S, Cape Coral');
    if (!p.own) await expect(page.locator('.aog-addr-list')).not.toHaveClass(/open/);
  });
}

test('picked address is saved like typed text (comes back after closing the app)', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  page.on('dialog', d => d.accept());
  expect(await open(page, '/maintenance/')).toEqual([]);
  await page.route(/api\.mapbox\.com/, r => r.fulfill({ json: FEATURES }));
  await page.click('#address'); await page.keyboard.type('1234 Del', { delay: 30 });
  await page.locator('.aog-addr-list.open li').first().dispatchEvent('mousedown');
  await page.waitForTimeout(2500);                                            // autosave
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1200);
  await expect(page.locator('#address')).toHaveValue('1234 Del Prado Blvd S, Cape Coral');
});

test('the suggestion list follows dark mode and never shows in a capture or print', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  expect(await open(page, '/service-work/', { theme: 'dark' })).toEqual([]);
  await page.route(/api\.mapbox\.com/, r => r.fulfill({ json: FEATURES }));
  await page.click('#cust_addr'); await page.keyboard.type('1234 Del', { delay: 30 });
  const list = page.locator('.aog-addr-list.open');
  await expect(list).toBeVisible();
  const dark = await page.evaluate(() => { const m = getComputedStyle(document.getElementById('cust_addr')).color.match(/\d+/g); return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 150; });
  await expect(list).toHaveClass(dark ? /dark/ : /light/);
  await expect(list).toHaveAttribute('data-html2canvas-ignore', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(list).toBeHidden();
});

// 📍 GPS: every form's address box gets the pin INSIDE the box; tapping it fills the address where you stand.
test.describe('GPS pin', () => {
  test.use({ geolocation: { latitude: 26.6406, longitude: -81.8723 }, permissions: ['geolocation'] });
  for (const p of PAGES.filter(x => !x.own)) {
    test(`${p.dir}: 📍 sits inside the address box and fills in the current address`, async ({ page }) => {
      page.on('dialog', d => d.accept());
      expect(await open(page, `/${p.dir}/`)).toEqual([]);
      await page.route(/api\.mapbox\.com\/geocoding\/v5\/mapbox\.places\/-81\.8723,26\.6406\.json/, r => r.fulfill({ json: { features: [FEATURES.features[0]] } }));
      const box = page.locator(p.box).first(), pin = page.locator('button.aog-gps').first();
      await box.scrollIntoViewIfNeeded();
      const [b, q] = [await box.boundingBox(), await pin.boundingBox()];
      const cx = q.x + q.width / 2, cy = q.y + q.height / 2;                            // pin centred on the box's right end
      expect(q.x >= b.x && q.x + q.width <= b.x + b.width + 1 && cy >= b.y && cy <= b.y + b.height, `pin inside the box ${JSON.stringify([b, q])}`).toBe(true);
      expect(await pin.getAttribute('data-html2canvas-ignore')).toBe('true');
      if (test.info().project.name === 'iphone') await pin.tap(); else await pin.click();
      await expect(box).toHaveValue('1234 Del Prado Blvd S, Cape Coral');
    });
  }
});
