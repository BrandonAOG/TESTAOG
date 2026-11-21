// Electrical Theory — full-screen One-Line, compact "What's happening", Ctrl/Shift-wheel zoom (v3.1.3).
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');
const PAGE = '/electrical-theory/';
const desk = info => test.skip(info.project.name !== 'desktop', 'desktop only');
const phone = info => test.skip(info.project.name !== 'iphone', 'iPhone only');

test('Full screen: opens the live drawing, chips press the real buttons, closes back where you were', async ({ page }, info) => {
  desk(info);
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  expect(await open(page, PAGE, { settle: 2000 })).toEqual([]);
  await page.evaluate(() => document.querySelector('.card-scope').scrollIntoView());
  const y0 = await page.evaluate(() => scrollY);
  await page.evaluate(() => document.querySelector('.fs-btn').click()); await page.waitForTimeout(400);   // a script click: the test tool would scroll the page to reach the button first
  expect(await page.evaluate(() => !!document.querySelector('.fs-ov #svg') && !document.querySelector('.scope #svg'))).toBe(true);
  expect(await page.$('.fs-ov [data-z=mk]')).toBeNull();                       // mockup controls are gone
  await page.click('.fs-chips [data-ft="LN"]');
  expect(await page.evaluate(() => document.querySelector('#ftGrp button.on').dataset.ft)).toBe('LN');
  await page.click('.fs-chips [data-act=util]'); await page.waitForTimeout(200);
  expect(await page.evaluate(() => utilOff)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('.fs-ov .wh-bar').classList.contains('new'))).toBe(true);   // the bar lights up
  await page.click('.fs-chips [data-act=util]');
  await page.evaluate(() => document.querySelector('[data-z=x]').click()); await page.waitForTimeout(400);
  expect(await page.evaluate(() => !!document.querySelector('.card-scope .scope #svg') && !document.querySelector('.fs-ov'))).toBe(true);
  await page.waitForTimeout(600);
  expect(Math.abs((await page.evaluate(() => scrollY)) - y0)).toBeLessThan(4);
  expect(errs).toEqual([]);
});

test('Full screen: zoom stays sharp, a mouse drag pans without selecting text, Shift+wheel pans sideways', async ({ page }, info) => {
  desk(info);
  expect(await open(page, PAGE, { settle: 2000 })).toEqual([]);
  await page.click('.fs-btn'); await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) await page.click('[data-z=in]');
  await page.waitForTimeout(400);
  const z = await page.evaluate(() => ({ tf: document.querySelector('.fs-ov .pan').style.transform, w: parseFloat(document.querySelector('.fs-ov #svg').style.width), vb: document.querySelector('.fs-ov #svg').viewBox.baseVal.width }));
  expect(z.tf).not.toMatch(/scale/);                                            // laid out at the zoom — not a blown-up bitmap
  expect(z.w).toBeGreaterThan(z.vb);
  const c = await page.evaluate(() => { const s = document.querySelector('.fs-stage').getBoundingClientRect(); return { x: s.x + s.width / 2, y: s.y + s.height / 2 }; });
  const tx = s => +s.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).slice(1, 3)[0];
  const before = await page.evaluate(() => document.querySelector('.fs-ov .pan').style.transform);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x - 150, c.y - 80, { steps: 10 }); await page.mouse.up();
  const after = await page.evaluate(() => ({ tf: document.querySelector('.fs-ov .pan').style.transform, sel: String(getSelection()) }));
  expect(Math.round(tx(before) - tx(after.tf))).toBe(150);
  expect(after.sel).toBe('');
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, 120); await page.keyboard.up('Shift'); await page.waitForTimeout(150);
  const sh = await page.evaluate(() => ({ tf: document.querySelector('.fs-ov .pan').style.transform, w: parseFloat(document.querySelector('.fs-ov #svg').style.width) }));
  expect(Math.round(tx(after.tf) - tx(sh.tf))).toBe(120);
  expect(sh.w).toBe(z.w);                                                       // Shift+wheel never zooms
});

test('Full screen: changing the inverter count keeps the zoom and the tapped button under the pointer; WHY and menus open on top', async ({ page }, info) => {
  desk(info);
  expect(await open(page, PAGE, { settle: 2000 })).toEqual([]);
  await page.click('[data-svc="400"]'); await page.waitForTimeout(300);
  await page.click('#solarBtn'); await page.waitForTimeout(400);
  await page.click('.fs-btn'); await page.waitForTimeout(400);
  await page.click('[data-z=in]'); await page.click('[data-z=in]'); await page.waitForTimeout(400);
  const find = re => page.evaluate(src => { const re = new RegExp(src); const g = [...document.querySelectorAll('.fs-ov #svg g')].filter(g => getComputedStyle(g).cursor === 'pointer' && re.test(gTxt(g)))[0]; if (!g) return null; const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, t: gTxt(g) }; }, re.source);
  const st = await page.evaluate(() => { const s = document.querySelector('.fs-stage').getBoundingClientRect(); return { cx: s.x + s.width / 2, cy: s.y + s.height / 2 }; });
  let u = await find(/×2/); expect(u).toBeTruthy();
  await page.mouse.move(st.cx, st.cy); await page.mouse.down(); await page.mouse.move(st.cx + (st.cx - u.x), st.cy + (st.cy - u.y), { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
  u = await find(/×2/);
  const w0 = await page.evaluate(() => parseFloat(document.querySelector('.fs-ov #svg').style.width));
  const vb0 = await page.evaluate(() => document.querySelector('.fs-ov #svg').getAttribute('viewBox'));
  await page.mouse.click(u.x, u.y); await page.waitForTimeout(500);
  const vb1 = await page.evaluate(() => document.querySelector('.fs-ov #svg').getAttribute('viewBox'));
  expect(vb1).not.toBe(vb0);                                                    // the drawing really changed size
  expect(await page.evaluate(() => parseFloat(document.querySelector('.fs-ov #svg').style.width))).toBe(w0);   // zoom kept
  const a = await page.evaluate(t => { const r = gSame(t)[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, u.t);
  expect(Math.abs(a.x - u.x)).toBeLessThan(2); expect(Math.abs(a.y - u.y)).toBeLessThan(2);
  const w = await find(/WHY/); await page.mouse.click(w.x, w.y); await page.waitForTimeout(300);
  expect(await page.evaluate(() => { const b = document.getElementById('whyBody').getBoundingClientRect(); return document.getElementById('whyModal').contains(document.elementFromPoint(b.x + b.width / 2, b.y + 20)); })).toBe(true);
  await page.evaluate(() => closeWhy());
  await page.click('[data-z=fit]'); await page.waitForTimeout(200);
  const rg = await page.evaluate(() => { const t = [...document.querySelectorAll('.fs-ov #svg text')].find(e => /^(Range|Lighting)/.test(e.textContent.trim())); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (rg) {
    await page.mouse.click(rg.x, rg.y); await page.waitForTimeout(300);
    const m = await page.evaluate(() => { const m = document.getElementById('ckMenu'); if (!m) return null; const b = m.getBoundingClientRect(); return m.contains(document.elementFromPoint(b.x + b.width / 2, b.y + Math.min(30, b.height / 2))); });
    if (m !== null) expect(m).toBe(true);                                       // equipment menu above full screen
  }
});

test('Page: Ctrl+wheel zooms only the One-Line (layout does not move), Shift+wheel pans, the chip resets it', async ({ page }, info) => {
  desk(info);
  await page.setViewportSize({ width: 1600, height: 860 });
  expect(await open(page, PAGE, { settle: 2000 })).toEqual([]);
  await page.evaluate(() => { document.querySelector('.card-scope .scope').scrollIntoView({ block: 'start' }); window.__prev = []; document.addEventListener('wheel', e => window.__prev.push(e.defaultPrevented), { passive: true }); });
  const snap = () => page.evaluate(() => { const sc = document.querySelector('.card-scope .scope').getBoundingClientRect(); return { scopeH: Math.round(sc.height), resultBelowScope: Math.round(document.getElementById('resultCard').getBoundingClientRect().top - sc.top) }; });
  const s0 = await snap();
  const m = await page.evaluate(() => { const t = [...document.querySelectorAll('#svg text')].find(e => e.textContent.trim() === 'Range').getBoundingClientRect(); return { x: t.x + t.width / 2, y: t.y + t.height / 2 }; });
  await page.mouse.move(m.x, m.y);
  await page.keyboard.down('Control'); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(50); } await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const z = await page.evaluate(() => { const sc = document.querySelector('.card-scope .scope'); const t = [...document.querySelectorAll('#svg text')].find(e => e.textContent.trim() === 'Range').getBoundingClientRect(); return { svgW: document.getElementById('svg').getBoundingClientRect().width, boxW: sc.clientWidth, rx: t.x + t.width / 2, ry: t.y + t.height / 2, chip: (document.querySelector('.pz-chip') || {}).textContent, prevented: window.__prev.slice(-1)[0], sl: sc.scrollLeft }; });
  expect(z.prevented).toBe(true);                                               // the browser did not zoom
  expect(z.svgW).toBeGreaterThan(z.boxW * 2);
  expect(z.chip).toMatch(/🔍 \d+% · Reset/);
  expect(Math.abs(z.rx - m.x)).toBeLessThan(4); expect(Math.abs(z.ry - m.y)).toBeLessThan(4);   // zooms around the mouse
  expect(await snap()).toEqual(s0);                                             // nothing else on the page moved
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, 200); await page.keyboard.up('Shift'); await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.querySelector('.card-scope .scope').scrollLeft)).toBe(z.sl + 200);
  await page.mouse.move(20, 20); await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  expect(await page.evaluate(() => window.__prev.slice(-1)[0])).toBe(false);   // Ctrl+wheel elsewhere is the browser's
  await page.evaluate(() => document.querySelector('.pz-chip').click()); await page.waitForTimeout(300);
  expect(await page.$('.pz-chip')).toBeNull();
  expect(await snap()).toEqual(s0);
});

test('Phone: "What\'s happening" is a one-line bar that lights up on a change and opens on tap', async ({ page }, info) => {
  phone(info);
  expect(await open(page, PAGE, { settle: 2000 })).toEqual([]);
  const bar = await page.evaluate(() => { const b = document.querySelector('#resultCard .wh-bar'); const r = b.getBoundingClientRect(); return { h: r.height, readoutHidden: getComputedStyle(document.getElementById('readout')).display === 'none' }; });
  expect(bar.readoutHidden).toBe(true);
  expect(bar.h).toBeLessThan(60);
  await page.evaluate(() => toggleUtil()); await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.querySelector('#resultCard .wh-bar').classList.contains('new'))).toBe(true);
  await page.tap('#resultCard .wh-bar'); await page.waitForTimeout(200);
  const op = await page.evaluate(() => { const b = document.querySelector('#resultCard .wh-bar'); return { open: b.classList.contains('open'), txt: b.querySelector('.txt').textContent.length, full: document.getElementById('readout').textContent.length }; });
  expect(op.open).toBe(true);
  expect(op.txt).toBe(op.full);
});

test('Phone: in full screen a tap still works after zooming and dragging with a finger', async ({ page }, info) => {
  phone(info);
  expect(await open(page, PAGE, { settle: 2000 })).toEqual([]);
  await page.tap('.fs-btn'); await page.waitForTimeout(400);
  await page.tap('[data-z=in]'); await page.waitForTimeout(400);
  const pre = await page.evaluate(() => { const tx = [...document.querySelectorAll('.fs-ov #svg text')].find(e => /UTILITY ON/i.test(e.textContent)); const r = tx.getBoundingClientRect(); const s = document.querySelector('.fs-stage').getBoundingClientRect(); return { dx: (s.x + s.width / 2) - (r.x + r.width / 2), dy: (s.y + s.height / 2) - (r.y + r.height / 2), cx: s.x + s.width / 2, cy: s.y + s.height / 2 }; });
  const c = await page.context().newCDPSession(page);
  const tp = (type, x, y) => c.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await tp('touchStart', pre.cx, pre.cy);
  for (let i = 1; i <= 8; i++) await tp('touchMove', pre.cx + pre.dx * i / 8, pre.cy + pre.dy * i / 8);
  await page.waitForTimeout(350); await tp('touchMove', pre.cx + pre.dx, pre.cy + pre.dy); await tp('touchEnd');   // finger held still before lifting (no fling)
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => { const tx = [...document.querySelectorAll('.fs-ov #svg text')].find(e => /UTILITY ON/i.test(e.textContent)); const r = tx.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(t.x, t.y); await page.waitForTimeout(500);
  expect(await page.evaluate(() => utilOff)).toBe(true);
});

test('Phone: after closing full screen the page scrolls again (Brandon, Nov 21)', async ({ page }, info) => {
  phone(info);
  expect(await open(page, PAGE, { settle: 2000 })).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('.fs-btn').click()); await page.waitForTimeout(500);
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');    // page behind is frozen
  await page.evaluate(() => document.querySelector('.fs-ov [data-z=x]').click()); await page.waitForTimeout(800);
  const st = await page.evaluate(() => ({ ov: !!document.querySelector('.fs-ov'), pos: getComputedStyle(document.body).position, ob: getComputedStyle(document.body).overflowY, oh: getComputedStyle(document.documentElement).overflowY, y: Math.round(scrollY) }));
  expect(st).toEqual({ ov: false, pos: 'static', ob: 'visible', oh: 'visible', y: 400 });
  // a real finger swipe moves the page
  const y0 = await page.evaluate(() => scrollY);
  await page.mouse.move(200, 600); await page.mouse.wheel(0, 500); await page.waitForTimeout(400);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(y0 + 100);
  // and again after a second open/close
  await page.evaluate(() => document.querySelector('.fs-btn').click()); await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('.fs-ov [data-z=x]').click()); await page.waitForTimeout(800);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe('visible');
});

test('Phone: the opened "What\'s happening" text runs full width under the label, not squeezed to the right', async ({ page }, info) => {
  phone(info);
  expect(await open(page, PAGE, { settle: 2000 })).toEqual([]);
  const bar = page.locator('#resultCard .wh-bar');
  await bar.click(); await page.waitForTimeout(200);
  const g = await page.evaluate(() => { const b = document.querySelector('#resultCard .wh-bar'), t = b.querySelector('.txt'), l = b.querySelector('.lab');
    const rb = b.getBoundingClientRect(), rt = t.getBoundingClientRect(), rl = l.getBoundingClientRect();
    return { open: b.classList.contains('open'), wide: rt.width / rb.width, below: rt.top >= rl.bottom - 1, leftAligned: Math.abs(rt.left - rl.left) < 4 }; });
  expect(g.open).toBe(true); expect(g.wide).toBeGreaterThan(0.85); expect(g.below).toBe(true); expect(g.leftAligned).toBe(true);
});

test('Phone: closing full screen puts the One-Line back at its normal size (Brandon\'s screen recording, Nov 21)', async ({ page }, info) => {
  phone(info);
  expect(await open(page, PAGE, { settle: 2000 })).toEqual([]);
  const box = () => page.evaluate(() => { const s = document.getElementById('svg'), r = s.getBoundingClientRect(), b = s.getBBox ? null : null;
    return { w: Math.round(r.width), h: Math.round(r.height), styleH: s.style.height }; });
  const before = await box();
  for (const zoom of [false, true]) {
    await page.evaluate(() => document.querySelector('.fs-btn').click()); await page.waitForTimeout(500);
    if (zoom) { await page.evaluate(() => document.querySelector('.fs-ov [data-z=in]').click()); await page.waitForTimeout(400); }
    await page.evaluate(() => document.querySelector('.fs-ov [data-z=x]').click()); await page.waitForTimeout(500);
    const after = await box();
    expect(Math.abs(after.w - before.w)).toBeLessThan(3);
    expect(Math.abs(after.h - before.h)).toBeLessThan(3);
  }
  // and a tap on the page after that redraws exactly as it would had full screen never been opened
  const tap = () => page.evaluate(() => { document.querySelectorAll('[data-sys]')[1].click(); });
  await tap(); await page.waitForTimeout(400); const a1 = await box();
  await page.reload(); await page.waitForTimeout(2000); await tap(); await page.waitForTimeout(400); const a2 = await box();
  expect(Math.abs(a1.w - a2.w)).toBeLessThan(3); expect(Math.abs(a1.h - a2.h)).toBeLessThan(3);
});
