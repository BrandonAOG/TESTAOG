# Always On Generators — Field Operations Hub

A mobile-first Progressive Web App (PWA) built for Always On Generators field technicians. One offline-capable portal that centralizes all field forms, NEC calculators, gas sizing tools, and Generac reference data.

---

## Live Site

**[brandonaog.github.io/AOG](https://brandonaog.github.io/AOG)**

---

## Features

- **14 field tool modules** accessible from a single dashboard
- **Offline support** via service worker — works in the field without a connection
- **Installable PWA** — add to home screen on iOS or Android, works like a native app
- **Auto-update toast** — notifies technicians when a new version is available, shows changelog
- **Dark / light mode** — supported across all calculator and form modules
- **PDF & share export** — most form modules support printing to PDF and iOS/Android share sheets
- **PWA shortcuts** — long-press the home screen icon to jump directly to any tool

---

## Tool Modules

### 📋 Electrical Install
Multi-page installation form covering the full electrical job. Tracks team members, generator setup (pad/stand, Mobile Link, battery, controller settings), transfer switch, and sign-off fields. Includes material tables for fittings, wireway, and Polaris taps, plus a wire run table with footage tracking. Generates a print-ready two-page PDF.

### 🔥 Gas Installation
Gas job checklist and material log. Captures crew info, regulator stage details (1st stage, Norgas, 2nd stage straight/back-mount, 2PSI, Pietro), pass/fail outcomes, and clean-up/walkthrough/inspection sign-offs. Includes a full material table with galvanized nipple sizes, strapping, and cable quantities by foot, with column-per-tech tracking.

### 💲 Estimate Form
Customer-facing quote form with address autocomplete, HOA/community, square footage, fuel type (NG/LP), flood zone, parcel/municipality, and financing flag. Contains job-scoped sections for generator placement (right/left/back), transfer switch, gas and electrical line details, and misc items. Exports a print-ready confidential estimate PDF.

### 🔧 Maintenance Report
Structured service report covering battery (voltage, CCA, SOH, brand, date, water level), visual inspection (corrosion, broken cables), component condition ratings (Good / Average / Poor / Needs Replaced / Replaced), startup test result (Normal / Abnormal), coolant level, belts, and a general notes field. Captures job number, tech, model, serial number, and hours. Exports to PDF.

### 📍 Site Visit / Permitting Info Request
Pre-installation assessment form. Captures new construction status, panel readiness, blueprint availability, meter type, service and breaker size, existing wiring details, generator clearances, window sealing, grounding requirements, run lengths for electric and gas, LP tank size, and other appliance connections. Includes a material table for fittings, wireway, and Polaris taps with footage tracking, and a site plan section for connection mapping.

### 🗺️ Property Lookup
Live FL address intelligence tool. Searches any Florida address and auto-pulls owner, parcel ID, just value, year built, and living area from live county feeds (Collier, Lee, Charlotte, Sarasota). Detects FEMA flood zone (NFHL) with county DFIRM cross-check, zoning district and required setbacks, ASCE 7-22 wind speed interpolated at the point, electric utility by territory polygon (FPL / LCEC / Duke / TECO), and natural gas vs propane by LDC service territory. Exports a PDF report and Excel, and can import owner/address/flood zone straight into the Estimate sheet. Loads offline by design; live searches require a connection.

### ✏️ Site Annotator
Field diagram and site-plan annotation tool. Freehand drawing and markup tools for sketching connection layouts, generator placement, and site measurements directly on a canvas, with a keyboard-shortcut reference panel.

### ✅ Quality Control Checklist
Structured QC checklist module for verifying completed work against standards before sign-off.

### 🛠️ Service Work
Service work logging module for capturing field service activity.

### 📐 Conduit Fill Calculator
NEC Chapter 9 conduit fill calculator. Supports 11 raceway types: RMC, IMC, EMT, FMC, LFMC, LFNC-A, LFNC-B, PVC Sch 40, PVC Sch 80, HDPE, and ENT. Trade sizes from 3/8" through 6". Add multiple wire types and quantities; calculates total fill percentage and flags green (under 40%), yellow (at 40%), or red (over limit). Displays a recommendation with conduit type and fill status.

### ⚡ Load Calculation 
NEC 2020 Article 220.82 Optional Method residential load calculation. Five-step workflow: (1) general lighting, small appliance & laundry by square footage, (2) HVAC loads, (3) fixed appliances, (4) dryers, (5) cooking equipment. Includes a separate pool panel tab. Outputs demand load in VA and amps, conductor sizing per NEC 310.12 (83% 1&2 family) and 310.16 (75°C standard), feeder sets (1–10), copper or aluminum, and neutral demand. Fuel source (NG/LP) and conductor material are configurable.

### 🔥 Gas Calculator
BTU demand analysis and pipe sizing for Generac generators 7–150kW. Covers the full Generac lineup: Guardian NextGen (10–28kW), Guardian Legacy (7–26kW), Protector QS, Protector RG (22–150kW), and Protector XG (32–80kW). Handles three fuel paths — natural gas low and medium pressure, LP vapor/first-stage, and LP second-stage. Supports four pipe materials: Black Steel/Rigid Sch 40, PE Underground IPS SDR-11, CSST Gastite/Wardflex, and TracPipe CounterStrike. Calculates required CFH/GPH demand, applies elevation derate per Generac spec, and sizes pipe from NFPA 54 / NFPA 58 tables using the pressure-drop method. Includes regulator selection guidance and Generac inlet pressure requirements.

### 🔌 Breaker & Conductor Sizing
NEC conductor sizing calculator. Inputs: breaker size (NEC 240.6 standard sizes from 15A to 6000A), conductor material (copper or aluminum/CU-clad AL), application (General 310.16 75°C or 1&2 Family Dwelling 310.12 83%), parallel sets (1–10), conductor temp rating (60°C / 75°C / 90°C with 75°C cap), and ambient temperature for 310.15(B)(1) correction. Outputs minimum conductor size in AWG or kcmil, adjusted ampacity after all derating, EGC size per NEC 250.122, and active/inactive derate flags. Accounts for conduit fill derating with 4+ current-carrying conductors.

### 📄 Spec Viewer
Full specification lookup for Generac generators and transfer switches. Generator coverage: Guardian NextGen (10–28kW), Guardian Legacy (22–26kW), Protector RG (22–150kW), and Protector XG (32–80kW). Per-model data includes: rated kW and amps by voltage config (1-phase and 3-phase 208/240/480V), engine specs (displacement, compression, cylinders, RPM, oil capacity), fuel consumption at ¼/½/¾/full load (CFH for NG, GPH for LP), BTU/hr at full load, inlet pressure requirements, dimensions and weight, sound level (operating and Quiet-Test dB(A) at 23 ft), battery spec, controller, connectivity, certifications, clearances, warranty, protective functions, and accessories with part numbers. Separate ATS section covers all Generac transfer switch models with full spec grids and dimensions tables.

---

## Repo Structure

```
AOG/
├── index.html              # Main hub dashboard (PWA launcher)
├── manifest.json           # PWA manifest — icons, shortcuts, theme
├── sw.js                   # Service worker: cache-first, background update, changelog
├── update-banner.js        # Update toast UI helper
├── offline.html            # Fallback page shown when offline and page not cached
├── logo.png                # Company logo
├── icons/                  # PWA icons (192px, 512px, apple-touch-icon 180px)
├── elect-install/          # Electrical Installation form
├── gas-install/            # Gas Installation checklist & material log
├── estimate/               # Customer estimate / quote form
├── maintenance/            # Generator maintenance report
├── site-visit/             # Site visit / permitting info request
├── property-lookup/        # Live FL address / parcel / flood / utility lookup
├── site-annotator/         # Field diagram & site-plan annotation tool
├── qc-checklist/           # Quality control checklist
├── service-work/           # Service work log
├── conduit-fill/           # NEC Chapter 9 conduit fill calculator
├── load-calcs/             # NEC 220.82 residential load calculation
├── gas-calc/               # Generac gas BTU & pipe sizing calculator
├── breaker-conductor/      # NEC conductor sizing & derating calculator
└── spec-viewer/            # Generac generator & ATS specification lookup
```

---

## Tech Stack

- **Pure HTML / CSS / JavaScript** — no framework, no build step, no dependencies
- **Service Worker** — cache-first with user-controlled update flow; technicians see a changelog before reloading
- **Web App Manifest** — full PWA with home screen install, standalone display, and per-tool shortcuts
- **GitHub Pages** — zero-config static hosting from the `main` branch root

---

## Installing on a Phone

**Android (Chrome)**
1. Open the site in Chrome
2. Tap the menu → *Add to Home Screen* → *Install*

**iOS (Safari)**
1. Open the site in Safari
2. Tap the Share button → *Add to Home Screen* → *Add*

Once installed the app opens full-screen with no browser chrome, and all 14 tools are available offline after the first load.

---

## Updating the App

When you push changes, bump the version and update the changelog in `sw.js`:

```js
var CACHE_NAME = 'aog-forms-v2.2.0'; // bump this every time

var CHANGELOG = [
  'Description of what changed',
  'Another change',
];
```

Technicians will see an update toast the next time they open the app. They can tap **Update Now** to reload immediately, or dismiss and update later.

---

## Adding a New Tool Module

1. Create a folder at the repo root (e.g. `my-tool/`) with an `index.html` inside
2. Register the route in `index.html` under `FORM_URLS`:
   ```js
   'my-tool': './my-tool/',
   ```
3. Add a card in the `forms-grid` section with `data-form="my-tool"`
4. Add the path to `PRECACHE_URLS` in `sw.js` so it caches offline
5. Add a shortcut entry in `manifest.json` if you want it in the long-press menu
6. Bump `CACHE_NAME` in `sw.js` so existing installs pick up the change

---

## Offline Behavior

On first load the service worker pre-caches all core assets and module pages. Subsequent visits — including with no network — are served from cache. An offline banner appears at the top of the screen when the network drops. When a new version is deployed, a toast in the bottom-right corner shows the changelog and lets the technician update on their own schedule.

---

*Always On Generators · Power When You Need It*

---

© 2026 Brandon Keilholz. All Rights Reserved. — See [LICENSE](./LICENSE)
