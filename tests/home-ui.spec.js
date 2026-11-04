// Home screen: density pass, calmer background, no footer overlap, and hold-and-drag
// favorites reordering. Static source checks — no browser needed.
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { ROOT } = require('./helpers');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'static checks run once'));

test('background animation is dialed back so it stops competing with content', () => {
  const s = read('index.html');
  expect(s).toMatch(/#bg-canvas\s*\{[^}]*opacity:\s*0\.\d+/);
});

test('caching toast reserves footer clearance only while it is showing', () => {
  const s = read('index.html');
  expect(s).toContain("classList.add('caching-active')");
  expect(s).toContain("classList.remove('caching-active')");
  expect(s).toMatch(/body\.caching-active \.footer\s*\{[^}]*margin-bottom/);
});

test('favorites hold-and-drag reorder is wired and persists order', () => {
  const s = read('index.html');
  expect(s).toContain('FAVORITES HOLD-AND-DRAG REORDER');
  // long-press pickup + scroll lock while dragging
  expect(s).toMatch(/setTimeout\(function\(\)\{\s*pickUp\(card\)/);
  expect(s).toContain('fav-dragging');
  // new order is read from the DOM and saved
  expect(s).toMatch(/saveFavs\(order\)/);
  // the hint appears when there are 2+ favorites
  expect(s).toContain('Hold & drag to reorder');
  // iOS long-press link preview must be suppressed, or the hold can't start a drag
  expect(s).toMatch(/\.card-group\[data-group="favorites"\] \.form-card \{[^}]*-webkit-touch-callout:\s*none/);
});

test("the 'Select a Category' label is hidden (density pass)", () => {
  const s = read('index.html');
  expect(s).toMatch(/\.forms-section-label\s*\{\s*display:\s*none/);
});
