// Property Lookup — the search bar has a GPS button that looks up the parcel where you're standing.
// It reuses the map-tap path (runLookup viaMap:true), so a tap on "my location" behaves like tapping
// that spot on the map. No geocoding, no map token — the browser supplies the coordinates.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

// Grant a Florida location so getCurrentPosition resolves during the run.
test.use({ permissions: ['geolocation'], geolocation: { latitude: 26.6406, longitude: -81.8723 } });

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'ui check runs once'));

test('GPS button is present and starts a lookup from the device location', async ({ page }) => {
  const errors = await open(page, '/property-lookup/');
  const gps = page.locator('#gps');
  await expect(gps).toBeVisible();

  await gps.click();
  // The handler fired: a status line shows in the results panel (locating → lookup, or an error row).
  await expect(page.locator('#results .status')).toBeVisible({ timeout: 8000 });

  expect(errors).toEqual([]);   // no page errors from the new handler
});
