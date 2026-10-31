// Address autocomplete: the same lookup on every form (Mapbox Geocoding v6, US Census backup), one token in one file.
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

// A fake Mapbox Geocoding v6 answer (same shape as the real one), so the check never depends on the internet.
const v6 = (num, street, city, zip) => ({ type: 'Feature', properties: {
  feature_type: 'address', name: `${num} ${street}`, full_address: `${num} ${street}, ${city}, Florida ${zip}, United States`,
  place_formatted: `${city}, Florida ${zip}, United States`,
  context: { address: { address_number: num, street_name: street, name: `${num} ${street}` }, street: { name: street },
             postcode: { name: zip }, place: { name: city }, region: { name: 'Florida', region_code: 'FL' }, country: { name: 'United States', country_code: 'US' } },
  coordinates: { longitude: -81.87, latitude: 26.64, accuracy: 'rooftop' } } });
const FEATURES = { type: 'FeatureCollection', features: [v6('1234', 'Del Prado Blvd S', 'Cape Coral', '33990'), v6('1234', 'Del Mar Dr', 'Fort Myers', '33901')] };
const MAPBOX_FWD = /api\.mapbox\.com\/search\/geocode\/v6\/forward\?/;

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
    await page.route(MAPBOX_FWD, r => { token = new URL(r.request().url()).searchParams.get('access_token'); r.fulfill({ json: FEATURES }); });
    const box = page.locator(p.box).first();
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await box.pressSequentially('1234 Del', { delay: 30 });
    const item = p.own ? page.locator('#address-suggestions li').first() : page.locator('.aog-addr-list.open li').first();
    await expect(item).toContainText('1234 Del Prado Blvd S, Cape Coral');
    expect(token).toMatch(/^pk\./);
    if (test.info().project.name === 'iphone') await item.tap(); else await item.click();   // a real tap / click, as a tech would
    if (p.dir === 'estimate') {
      await expect(box).toHaveValue('1234 Del Prado Blvd S');
      await expect(page.locator('#address2')).toHaveValue('Cape Coral, FL 33990');          // City, ST ZIP box
    } else await expect(box).toHaveValue('1234 Del Prado Blvd S, Cape Coral');
    if (!p.own) await expect(page.locator('.aog-addr-list')).not.toHaveClass(/open/);
  });
}

test('picked address is saved like typed text (comes back after closing the app)', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  page.on('dialog', d => d.accept());
  expect(await open(page, '/maintenance/')).toEqual([]);
  await page.route(MAPBOX_FWD, r => r.fulfill({ json: FEATURES }));
  await page.click('#address'); await page.keyboard.type('1234 Del', { delay: 30 });
  await page.locator('.aog-addr-list.open li').first().dispatchEvent('mousedown');
  await page.waitForTimeout(2500);                                            // autosave
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1200);
  await expect(page.locator('#address')).toHaveValue('1234 Del Prado Blvd S, Cape Coral');
});

test('the suggestion list follows dark mode and never shows in a capture or print', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  expect(await open(page, '/service-work/', { theme: 'dark' })).toEqual([]);
  await page.route(MAPBOX_FWD, r => r.fulfill({ json: FEATURES }));
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
      await page.route(/api\.mapbox\.com\/search\/geocode\/v6\/reverse\?longitude=-81\.8723&latitude=26\.6406&/, r => r.fulfill({ json: { features: [FEATURES.features[0]] } }));
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

// Backup: when Mapbox has no match (or is down), the US Census address check answers instead.
// The Census sends no CORS header, so the app calls it as JSONP — the fake reply below answers the same way.
const CENSUS = { result: { addressMatches: [{ matchedAddress: '1015 CULTURAL PARK BLVD N, CAPE CORAL, FL, 33990',
  coordinates: { x: -81.9588, y: 26.6351 }, addressComponents: { zip: '33990', streetName: 'CULTURAL PARK', city: 'CAPE CORAL', state: 'FL', suffixType: 'BLVD', suffixDirection: 'N' } }] } };
async function censusBackup(page, { mapbox = 'none' } = {}) {
  const asked = [];
  await page.route(MAPBOX_FWD, r => mapbox === 'down' ? r.fulfill({ status: 401, json: { message: 'Not Authorized - Invalid Token' } }) : r.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
  await page.route(/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress/, r => {
    const u = new URL(r.request().url()); asked.push(u.searchParams.get('address'));
    r.fulfill({ contentType: 'text/javascript', body: `${u.searchParams.get('callback')}(${JSON.stringify(CENSUS)});` });
  });
  return asked;
}
for (const mapbox of ['none', 'down']) {
  test(`Census backup when Mapbox ${mapbox === 'none' ? 'has no match' : 'is down'}: full address is found and filled in`, async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'once');
    expect(await open(page, '/service-work/')).toEqual([]);
    const asked = await censusBackup(page, { mapbox });
    await page.click('#cust_addr'); await page.keyboard.type('1015 Cultural Park Blvd', { delay: 20 });
    const item = page.locator('.aog-addr-list.open li').first();
    await expect(item).toHaveText('1015 Cultural Park Blvd N, Cape Coral, FL 33990');         // Census CAPS made readable
    expect(asked.pop()).toBe('1015 Cultural Park Blvd, FL');                                  // Florida assumed when no state / ZIP typed
    await item.click();
    await expect(page.locator('#cust_addr')).toHaveValue('1015 Cultural Park Blvd N, Cape Coral');
    expect(await page.evaluate(() => document.querySelectorAll('script[src*="census.gov"]').length), 'JSONP script tags cleaned up').toBe(0);
  });
}
test('Census backup also feeds Estimate (street + City/State/ZIP) and QC Checklist', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  page.on('dialog', d => d.accept());
  expect(await open(page, '/estimate/')).toEqual([]);
  await censusBackup(page);
  await page.click('#address'); await page.keyboard.type('1015 Cultural Park Blvd', { delay: 20 });
  await page.locator('#address-suggestions li').first().click();
  await expect(page.locator('#address')).toHaveValue('1015 Cultural Park Blvd N');
  await expect(page.locator('#address2')).toHaveValue('Cape Coral, FL 33990');
  expect(await open(page, '/qc-checklist/')).toEqual([]);
  await censusBackup(page);
  await page.click('#cust_addr'); await page.keyboard.type('1015 Cultural Park Blvd', { delay: 20 });
  await page.locator('#address-suggestions li').first().click();
  await expect(page.locator('#cust_addr')).toHaveValue('1015 Cultural Park Blvd N, Cape Coral');
});
test('a partial address that is not a full street address does not ask the Census', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  expect(await open(page, '/service-work/')).toEqual([]);
  const asked = await censusBackup(page);
  await page.click('#cust_addr'); await page.keyboard.type('Del Prado', { delay: 20 });
  await page.waitForTimeout(800);
  expect(asked).toEqual([]);
  await expect(page.locator('.aog-addr-list')).not.toHaveClass(/open/);
});
