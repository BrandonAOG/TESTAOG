// Launch intro on the hub (v3.1.3): glitter + logo spin-up, Keilholz signature, tagline and an arc blast that opens the hub; once per app launch, tap to skip, never traps
// the hub, sound on by default and switched off in Sound Settings.
const { test, expect } = require('@playwright/test');

const errs = (page) => { const e = []; page.on('pageerror', x => e.push(x.message)); return e; };

test('intro plays, removes itself, and leaves the hub usable', async ({ page }) => {
  const e = errs(page);
  await page.goto('/?intro');
  const intro = page.locator('#aog-intro');
  await expect(intro).toBeVisible();
  await page.waitForTimeout(1500);
  // the logo is spinning and glitter is on the canvas
  const lit = await page.evaluate(() => { const c = document.querySelector('#aog-intro canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
  expect(lit).toBeGreaterThan(200);
  await expect(intro).toHaveCount(0, { timeout: 14000 });
  expect(e).toEqual([]);
});

test('a tap skips it right away — and does NOT open the form card underneath (Brandon, Nov 21)', async ({ page }) => {
  await page.goto('/?intro');
  await page.waitForTimeout(600);
  const start = page.url();
  // tap exactly where a hub card / link sits under the intro
  const pt = await page.evaluate(() => { const i = document.getElementById('aog-intro'); i.style.visibility = 'hidden';
    const c = [...document.querySelectorAll('a[href], .card, button')].find(e => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 30 && r.top > 120 && r.bottom < innerHeight - 40; });
    i.style.visibility = ''; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(150);
  await page.mouse.click(pt.x, pt.y);                       // an impatient second tap during the fade
  await expect(page.locator('#aog-intro')).toHaveCount(0, { timeout: 1500 });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(start);
  expect(await page.evaluate(() => !!document.querySelector('.modal.open, [class*="overlay"][style*="flex"]'))).toBe(false);
});

test('an update that arrives during the intro shows only after it has finished', async ({ page }) => {
  await page.goto('/?intro');
  await page.waitForFunction(() => window.AOGIntro);
  // the hub's update card is filled in and shown by the same code path the service worker answer runs
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  expect(src).toMatch(/AOGIntro\.active\) window\.AOGIntro\.onDone\(show\)/);
  await page.evaluate(() => { const show = () => document.getElementById('update-toast').classList.add('visible');
    if (window.AOGIntro.active) window.AOGIntro.onDone(show); else show(); });
  await page.waitForTimeout(300);
  await expect(page.locator('#update-toast')).not.toBeVisible();
  await expect(page.locator('#aog-intro')).toHaveCount(0, { timeout: 14000 });
  await expect(page.locator('#update-toast')).toBeVisible();
});

test('it does not replay when coming back to the hub in the same launch, and test browsers skip it', async ({ page }) => {
  await page.goto('/');                                           // webdriver: skipped
  await expect(page.locator('#aog-intro')).toHaveCount(0);
  // a real phone (no webdriver flag): first hub load plays, the second doesn't
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.goto('/'); await expect(page.locator('#aog-intro')).toHaveCount(1);
  await page.goto('/'); await expect(page.locator('#aog-intro')).toHaveCount(0);
});

test('it is skipped when the phone asks for reduced motion', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.goto('/');
  await expect(page.locator('#aog-intro')).toHaveCount(0);
  await ctx.close();
});

test('intro sound is on by default, and the setting turns it off (and back on)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.AOGSound);
  expect(await page.evaluate(() => window.AOGSound.getPrefs().intro)).toBe(true);
  await page.click('#sound-toggle-btn');
  const sw = page.locator('[data-cat="intro"]');
  await expect(sw).toBeVisible();
  await sw.click();
  expect(await page.evaluate(() => window.AOGSound.getPrefs().intro)).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aog-sound-prefs')).intro)).toBe(false);
  await page.reload(); await page.waitForFunction(() => window.AOGSound);
  expect(await page.evaluate(() => window.AOGSound.getPrefs().intro)).toBe(false);          // remembered
  await page.click('#sound-toggle-btn'); await page.locator('[data-cat="intro"]').click();
  expect(await page.evaluate(() => window.AOGSound.getPrefs().intro)).toBe(true);
});

test('while the intro is up: no page sounds or background bed; normal again afterwards', async ({ page }) => {
  await page.addInitScript(() => {           // record every sound the engine is asked to make
    window.__played = [];
    const o = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...a) { if (this instanceof OscillatorNode || this instanceof AudioBufferSourceNode) window.__played.push(performance.now()); return o.apply(this, a); };
  });
  await page.goto('/?intro');
  await page.waitForFunction(() => window.AOGSound && window.AOGIntro);
  // hub effects asking for sound during the intro are ignored; the intro's own sound is allowed through
  const r = await page.evaluate(() => { const n = window.__played.length; AOGSound.play('boltStrike'); AOGSound.play('zap'); return { before: n, after: window.__played.length, amb: AOGSound._ambStatus().key }; });
  expect(r.after).toBe(r.before); expect(r.amb).toBeFalsy();
  await expect(page.locator('#aog-intro')).toHaveCount(0, { timeout: 14000 });
  expect(await page.evaluate(() => window.AOGIntro.active)).toBe(false);
  // afterwards sounds work normally again (desktop: an iPhone stays silent until the first tap, by design)
  if (test.info().project.name !== 'desktop') return;
  const n2 = await page.evaluate(() => { const n = window.__played.length; AOGSound.previewPlay('click'); return window.__played.length - n; });
  expect(n2).toBeGreaterThan(0);
});

test('desktop app: the spin-up sound plays on launch where the browser allows sound before a click', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop');
  await page.addInitScript(() => { window.__osc = []; const o = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...a) { if (this instanceof OscillatorNode) window.__osc.push(this.type); return o.apply(this, a); }; });
  await page.goto('/?intro');                        // config launches Chromium with autoplay allowed, like the installed app
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => window.__osc.filter(t => t === 'sawtooth').length)).toBeGreaterThan(0);   // the spin-up hum
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__osc.filter(t => t === 'sine').length)).toBeGreaterThan(2);       // the bell chime
});

test('where sound is still blocked, the intro stays silent and a skip tap does NOT set it off afterwards', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop');
  const b2 = await require('@playwright/test').chromium.launch({ args: ['--autoplay-policy=document-user-activation-required'] });
  const page = await b2.newPage({ baseURL: 'http://localhost:8080' });
  await page.addInitScript(() => { window.__osc = 0; const o = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...a) { if (this instanceof OscillatorNode && this.type === 'sawtooth') window.__osc++; return o.apply(this, a); }; });
  await page.goto('/?intro'); await page.waitForTimeout(1200);
  await page.mouse.click(5, 300); await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__osc)).toBe(0);
  await b2.close();
});

test('the full intro: signature writes, tagline types, the arc blast opens a hole onto the hub, then it removes itself', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'sequence check — runs once');
  test.setTimeout(40000);
  await page.addInitScript(() => { window.__osc = []; const o = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...a) { if (this instanceof OscillatorNode) window.__osc.push(this.type + ':' + Math.round(performance.now())); return o.apply(this, a); }; });
  await page.goto('/?intro');
  const st = () => page.evaluate(() => { const i = document.getElementById('aog-intro'); if (!i) return null;
    const ink = [...i.querySelectorAll('.ai-ink path')]; const drawn = ink.reduce((a, p) => a + (parseFloat(p.style.strokeDasharray) - parseFloat(p.style.strokeDashoffset)), 0);
    return { sig: Math.round(drawn), strokes: ink.length, tag: i.querySelector('.ai-tag').textContent, mask: i.querySelector('.ai-bg').style.maskImage || i.querySelector('.ai-bg').style.webkitMaskImage || '' }; });
  await page.waitForTimeout(2400); const a = await st(); expect(a.sig).toBe(0); expect(a.tag).toBe('');
  await page.waitForTimeout(1300); const b = await st(); expect(b.sig).toBeGreaterThan(50); expect(b.strokes).toBeGreaterThan(15);   // ink laid along the pen strokes
  await page.waitForTimeout(1500); const c = await st(); expect(c.tag.length).toBeGreaterThan(10);            // typing
  await page.waitForTimeout(2600); const d = await st(); expect(d.mask).toMatch(/radial-gradient/);           // the hub is opening
  await expect(page.locator('#aog-intro')).toHaveCount(0, { timeout: 6000 });
  // sounds: spin (sawtooth), pen + tagline ticks (square), charge + blast (sawtooth again, later)
  const kinds = await page.evaluate(() => window.__osc.map(x => x.split(':')[0]));
  expect(kinds.filter(k => k === 'square').length).toBeGreaterThan(15);
  expect(kinds.filter(k => k === 'sawtooth').length).toBeGreaterThan(4);
  expect(await page.evaluate(() => window.AOGIntro.active)).toBe(false);
});
