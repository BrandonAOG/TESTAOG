// Offline-health repair: the "N missing" bar must NAME the files, and "Fix Now" must
// bypass a stale cached 404 (otherwise it keeps re-storing the same miss and looks dead
// even on wifi). Static source checks — no browser needed.
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { ROOT } = require('./helpers');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'static checks run once'));

test('sw.js: cache-health reports WHICH files are missing, not just a count', () => {
  const s = read('sw.js');
  // GET_CACHE_HEALTH returns a list of the missing URLs
  expect(s).toContain('missingList');
  expect(s).toMatch(/missing:\s*missingList\.length/);
});

test('sw.js: the repair re-fetch bypasses a stale cached 404', () => {
  const s = read('sw.js');
  // ensurePrecached re-adds through a reload request so a stale 404 cannot stick
  expect(s).toMatch(/cache\.add\(new Request\([^)]*cache:\s*'reload'/);
});

test('update-banner.js: the repair bar names the missing files', () => {
  const s = read('update-banner.js');
  expect(s).toMatch(/function showRepairBar\(worker, missing, total, missingList\)/);
  expect(s).toContain('aog-rsub');          // the sub-line that lists file names
  expect(s).toContain('escName');           // names are HTML-escaped
  // the health check passes the list through to the bar
  expect(s).toContain('showRepairBar(worker, h.missing, h.total, h.missingList)');
});
