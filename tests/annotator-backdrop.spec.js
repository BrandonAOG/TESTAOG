// 3.0.1 Site Annotator backdrop fix — a PDF built from many small raster strips
// (e.g. "Microsoft: Print To PDF" slicing a plan into dozens of JPEG bands) must NOT
// be "exploded" on import, or the export can come out blank-white with only the markups.
// Static checks + a pure-logic calibration test using the real numbers from the two
// field-supplied test plans.
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { ROOT } = require('./helpers');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'static / node checks run once'));

test('Layer 1: sliced raster backdrop is detected and kept intact (not exploded)', () => {
  const s = read('site-annotator/index.html');
  // the per-image coverage is accumulated (clamped to the page area)
  expect(s).toContain('_rasterCoverSum+=Math.min(_iw*_ih,_pgArea)');
  // and a many-fragment, high-coverage page is treated as a dominant raster backdrop
  expect(s).toMatch(/_anyImgs>=12&&_rasterCoverSum>=_pgArea\*\.5\)\{_hasDominantRaster=true/);
});

test('Layer 2: a many-fragment raster backdrop also trips the explode-cancel guard', () => {
  const s = read('site-annotator/index.html');
  // belt-and-suspenders: _imgUnreproduced is set even when explode-images is ON
  expect(s).toContain('if(_pgArea>0&&_anyImgs>=12&&_rasterCoverSum>=_pgArea*.5)_imgUnreproduced=true');
  // and _imgUnreproduced still cancels the explode
  expect(s).toMatch(/_imgUnreproduced&&_explodedFromPage\)\{_explodedFromPage=false/);
});

test('threshold is calibrated: catches the sliced plan, ignores a normal page', () => {
  // The guard: a page with >=12 image fragments covering >=50% of the page is a sliced
  // backdrop and is kept intact. (A single >=50% image is already caught separately.)
  const fires = (anyImgs, coveragePct) => anyImgs >= 12 && (coveragePct / 100) >= 0.5;

  // Real measurements from the two field-supplied PDFs (via pdf.js operator list):
  //   Site_Plan.pdf  — 52 fragments, each ~1% of the page, 69% total coverage (the one that broke)
  //   site_plan-MU.pdf — 3 fragments, 1% coverage (a normal page)
  expect(fires(52, 69)).toBe(true);   // the broken plan is now kept intact
  expect(fires(3, 1)).toBe(false);    // a normal page is untouched
  // guard rails around the thresholds
  expect(fires(11, 90)).toBe(false);  // too few fragments to be a sliced backdrop
  expect(fires(40, 40)).toBe(false);  // too little coverage
});
