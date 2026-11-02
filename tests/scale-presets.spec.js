// Site Annotator scale box: a dropdown of common engineer's scales that FILLS the text
// box (so the existing calculator parses it), while the box still accepts any typed scale.
// Native <select> is used on purpose — datalist is unreliable on iOS Safari, the techs' browser.
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { ROOT } = require('./helpers');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'static check runs once'));

test('scale preset dropdown exists with the common engineer scales', () => {
  const s = read('site-annotator/index.html');
  expect(s).toContain('id="scale-preset"');
  // native select, not a datalist (iOS)
  expect(s).toMatch(/<select[^>]*id="scale-preset"/);
  expect(s).not.toMatch(/<input[^>]*id="dpi-notation"[^>]*list=/);
  // the common scales are present
  for (const n of [10, 20, 30, 40, 50, 60, 100]) {
    expect(s).toContain('1"=' + n + 'ft');
  }
  // picking a preset fills the existing notation box (which the calculator reads)
  expect(s).toMatch(/scale-preset[\s\S]{0,400}note\.value\s*=\s*sel\.value/);
});
