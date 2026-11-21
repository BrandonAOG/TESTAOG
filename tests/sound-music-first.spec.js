// iPhone: the app must never pause the user's music (CarPlay / Music / Spotify).
// The only thing that can is the silent HTML <audio> "session kick" — a playing media element becomes
// "Now Playing" on iOS. It may run ONLY after the WebAudio clock has been seen stuck (cold-launch bug).
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

async function setup(page, frozen) {
  await page.addInitScript(frozen => {
    if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
    window.__mediaPlays = 0;
    const _p = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__mediaPlays++; return _p.apply(this, arguments).catch(() => {}); };
    if (frozen) {                       // the iOS dead-session bug: 'running' but the clock never moves
      const d = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'currentTime');
      Object.defineProperty(BaseAudioContext.prototype, 'currentTime', { get() { return 0; }, configurable: true });
      window.__unfreeze = () => Object.defineProperty(BaseAudioContext.prototype, 'currentTime', d);
    }
  }, frozen);
}

test('iPhone: with sound working (e.g. music already playing), tapping around never starts a media element', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'iPhone only');
  await setup(page, false);
  expect(await open(page, '/estimate/?season=christmas', { settle: 1200 })).toEqual([]);
  for (let i = 0; i < 4; i++) { await page.touchscreen.tap(200, 300 + i * 20); await page.waitForTimeout(600); }
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__mediaPlays)).toBe(0);
});

test('iPhone: only when the sound engine is seen stuck does a LATER tap start the silent kick', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'iPhone only');
  await setup(page, true);
  expect(await open(page, '/estimate/', { settle: 1200 })).toEqual([]);
  await page.touchscreen.tap(200, 300);
  expect(await page.evaluate(() => window.__mediaPlays)).toBe(0);      // first tap: WebAudio only
  await page.waitForTimeout(1500);                                     // watchdog sees the clock stuck
  await page.touchscreen.tap(200, 320);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__mediaPlays)).toBeGreaterThan(0);
});
