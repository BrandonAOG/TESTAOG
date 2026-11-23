// Property Lookup — City of Naples zoning (v3.1.4). Brandon (23 Nov 2026): "700 Park Shore Dr on my property lookup is
// acting weird". The city's on-prem GIS (g.naplesgov.com) stopped answering, so the card sat on "confirming live
// district…" and then claimed the service "gave no polygon". Zoning now reads the city's ArcGIS Online copy (the layer
// the official Naples Interactive Map uses), and a server that doesn't answer is reported as down, not as "no polygon".
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

const NAPLES = /services1\.arcgis\.com\/rXoq3MI8ZjnfUJwc\/arcgis\/rest\/services\/ZoningUpdated\/FeatureServer\/0/;
const json = (r, body) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function mock(page, state) {
  await page.route(/g\.naplesgov\.com\/arcgis\/rest\/services\/Planning\/Zoning/, r => {   // the city's on-prem server — the BACKUP
    if (state.backupDown) return r.abort('timedout');
    if (/\/query/.test(r.request().url())) return json(r, { features: [{ attributes: { Layer: 'R1-10A', Descript: 'SINGLE FAMILY' } }] });
    return json(r, { name: 'Zoning', fields: ['Layer', 'Descript'].map(name => ({ name })) });
  });
  await page.route(/services2\.arcgis\.com\/.*Zoning_General/, r => json(r, /\/query/.test(r.request().url())
    ? { features: [{ attributes: { ZONING: 'CITY OF NAPLES', BASE: 'CITY OF NAPLES' } }] } : { name: 'Zoning_General', fields: [{ name: 'ZONING' }, { name: 'BASE' }] }));
  await page.route(NAPLES, r => {
    if (state.down) return r.abort('timedout');
    if (/\/query/.test(r.request().url())) return json(r, { features: [{ attributes: { OBJECTID: 71, Layer: 'R1-10A', Descript: 'SINGLE FAMILY', ORD_1: '98-8362', PD_NAME: '' } }] });
    return json(r, { name: 'Zoning', fields: ['OBJECTID', 'Layer', 'Descript', 'ORD_1', 'PD_NAME'].map(name => ({ name })) });
  });
}

test('a Naples parcel reads its district from the city\'s ArcGIS Online zoning layer (backup not asked)', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const state = { down: false, backupDown: false }; const asked = [];
  page.on('request', q => { if (/naplesgov/.test(q.url())) asked.push(q.url()); });
  await mock(page, state);
  expect(await open(page, '/property-lookup/', { settle: 1200 })).toEqual([]);
  const z = await page.evaluate(() => queryZoning(26.19320, -81.80479, 'Naples', 'Collier'));
  expect(z).toMatchObject({ code: 'R1-10A', desc: 'SINGLE FAMILY' });
  expect(asked.filter(u => /Zoning/i.test(u)), 'the on-prem backup is only asked when the main layer fails').toEqual([]);
});

test('main layer down → the city\'s own server answers as the backup', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const state = { down: true, backupDown: false };
  await mock(page, state);
  expect(await open(page, '/property-lookup/', { settle: 1200 })).toEqual([]);
  const z = await page.evaluate(() => queryZoning(26.19320, -81.80479, 'Naples', 'Collier'));
  expect(z).toMatchObject({ code: 'R1-10A', __backup: true });
});

test('both down → reported as down, not as "no polygon"', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'once');
  const state = { down: true, backupDown: true };
  await mock(page, state);
  expect(await open(page, '/property-lookup/', { settle: 1200 })).toEqual([]);
  const z = await page.evaluate(() => queryZoning(26.19320, -81.80479, 'Naples', 'Collier'));
  expect(z).toMatchObject({ __down: true, hosts: ['services1.arcgis.com', 'g.naplesgov.com'] });
  // the card's text for that state
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'property-lookup', 'index.html'), 'utf8');
  expect(src).toContain("zoning server isn't responding right now");
});
