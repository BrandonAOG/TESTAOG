# Always On Generators — Field Operations Hub

A mobile-first Progressive Web App (PWA) built for Always On Generators field technicians. One offline-capable portal that centralizes every field form, NEC / NFPA calculator, gas sizing tool, Florida property lookup and Generac reference — installable on any phone, tablet or computer.

---

## Live Site

**[brandonaog.github.io/AOG](https://brandonaog.github.io/AOG)** — public site used by the team

---

## Features

- **21 field tools** on one dashboard, with category tabs and ★ Favorites
- **Works offline** after the first load — and tells you (with a one-tap **Fix Now**) if any offline files are missing
- **Installable** on iPhone, iPad, Android and computers, with long-press shortcuts to every tool (Android / desktop)
- **Update prompt with a "what's new" list** — nothing changes until the tech taps **Update Now**
- **One dark / light setting** shared by every tool
- **Forms export a resumable PDF and an image** — and reload from that PDF later; holiday themes never appear in exports
- **Auto-saved drafts** on every form — close the app mid-job and pick up where you left off
- **Holiday themes** on the 8 forms (falling snow, bats, fireworks…) all year round and **50 animated hub backgrounds**
- **Built-in sounds and vibration** — tap sounds, holiday ambience — adjustable in Sound Settings
- **Report a Bug / Suggestions / Share App** — bug emails attach device details and recent errors automatically

---

## Hub Dashboard

The hub (`index.html`) is the home screen. Each time it opens it plays one of **50 animated backgrounds** (lightning, hurricane, substation, tornado…), picked at random without repeating the last 10 shown in that session; some have their own background sound.

- **Header & status bar** — time-of-day greeting with today's date; System Ready · **21 Tools Active** (counts itself from the tool list) · Field Ready · **Sync Enabled**, which switches to **Offline Mode** with a "No network connection · Hub available offline" banner when signal drops.
- **Category tabs** — ★ Favorites, Estimate, Installs, Maintenance and Tools (Tools is split into Lookup, Electrical and Install Planning). Load Calculation and Site Annotator appear under both Estimate and Tools.
- **Favorites** — tap ☆ on any card to pin it to Favorites, ★ to unpin. Saved on that device.
- **Sounds** — opens Sound Settings (see *Shared Features*).
- **Report a Bug / Suggestions** — short form (which tool, what happened, name, optional "credit me in the update banner"). Sending opens an email to Brandon with app version, phone/browser, screen size, online status, installed-app mode, connection type, time zone and the last 3 errors on that device.
- **Share App** — opens the phone's share sheet (or copies the link).
- **First install** — a "Caching Files" progress box counts up to **✓ Cache Ready**.
- **Updates** — a bottom-right "Update Available" box with the version, what's new, **Update Now**, **Remind me later** and ✕.
- **Footer** — live version (e.g. `SYSTEM v2.8.1`, or `vTEST2.8.1` on the test site). Triple-tap it for a hidden ‹ › background-scene switcher.

**`offline.html`** appears if a page can't load and isn't saved on the device: links to every tool, a **Try Again** button and its own animated background. It reloads by itself when the connection returns.

---

## How the Forms Save & Export

These behaviors are shared by the 8 forms (Estimate, Site Visit, Pre-Install, Electrical Install, Gas Install, QC Checklist, Maintenance, Service Work), so they're described once here.

- **Auto-save** — every change is saved on the device (and every 30 seconds on most forms); reopening the form restores the draft, usually with a "Draft saved" badge or a "Restored draft" notice. **🗑 CLEAR** asks for confirmation before wiping the form.
- **Address autocomplete** — every form's job address suggests Southwest-Florida addresses as you type (Mapbox Geocoding v6; when Mapbox has no match, the free US Census address check finds the full street address, and OpenStreetMap suggests from partial typing as the last resort). Every address box has a 📍 button (inside the box) that fills in the address where you're standing. Estimate splits the result into street + City/State/ZIP; the rest fill "street, city". Load Calc's job address has it too.
- **📝 PDF✎ — resumable PDF** — builds the form as US-Letter PDF pages with the form's data tucked inside the file. It is not a fill-in-the-blanks PDF; instead, **📂 LOAD** reads that PDF (or a `.json` draft) back in and refills the form, so a job can be reopened on any device.
- **📸 CAPTURE — image** — a JPG of each page. iPhone/iPad opens the share sheet (or shows the image full-screen to long-press and save); Android saves to Downloads and then offers a **📤 SHARE IT** bar; computers download the file.
- **Same toolbar on every form** — 🏠 HOME · 📝 PDF✎ · 📸 CAPTURE · 📂 LOAD · 🗑 CLEAR · theme (Electrical Install adds 🎤 VOICE). It fits on one row on an iPhone. There is no plain print-PDF button; techs use PDF✎ and CAPTURE.
- **File names** use the customer name and address, e.g. `Name - Address - Estimate - RESUMABLE.pdf`.
- **Hidden diagnostics** (most forms) — triple-tap or long-press the version text in the footer for a device report; triple-tap "· CONFIDENTIAL" for a print-scale slider; add `#debug` to the address for an on-screen print debugger.

---

## Tool Modules

### Estimate

#### 💲 Estimate Form
A one-page installation estimate filled out on site with the customer. It records the customer and property, then sizes up the generator, transfer switch, pad, fuel and install effort.

**Features**
- **Customer & Property Info** — name, address with live autocomplete (Mapbox v6 with the US Census address check as backup; Florida results first) and a 📍 GPS button, Community/HOA, phone, email, how they heard about us, square footage, financing, Property Survey Y/N, estimate date and time.
- **Flood bar** — Flood Zone / Footage, Parcel / Municipality, Estimate Done On, Estimator.
- **Generator** — size, placement (Right / Left / Back), seal window, electric run feet (Under Ground / Above Ground / Attic), Al/Cu wiring, bore.
- **Transfer Switch** — number of panels and switches, type and placement, FPL/LCEC shutdown, grounding update, SE / Non-SE, load shed with 60A and 100A circuit counts, Whole House / Partial / Pool coverage, circuit swap.
- **Precast Pad** — Precast / Poured / Elevated (with height), Legs in Concrete / Bolted to Pad / Cantilever / Existing.
- **Fuel Tank** — Natural Gas / Needs Tank, new or existing tank size, existing gas appliances, gas run lengths (underground / above ground / attic).
- **Install Details** — Easy / Med / Hard difficulty, days, new build.
- **Property Lookup import** — 📂 LOAD accepts the Property Lookup's 📊 EXCEL file and fills name, address, city/state/ZIP, square footage, today's date, flood zone and parcel.

**Exports:** 📝 PDF✎ (one page) · 📸 CAPTURE. 📂 LOAD also takes a resumable PDF or JSON.

#### 📍 Site Visit / Permitting Info Request
A two-page permitting info request filled out at the pre-install site visit. Page 1 collects what permitting and the crew need to know about the house; page 2 is a materials take-off.

**Features**
- **Header** — Homeowner's Name and Job Address.
- **New Construction** — panels installed? blueprints on site? with a reminder to photograph every panel and its schedule.
- **Electrical Service** — Standard or Meter Main, service size (A), meter-main breaker size, existing wiring size and type.
- **Generator Location & Clearances** — clearances, alternate location, window sealing, grounding update.
- **Generator Electrical Run** (length; U.G. / A.G. / Attic) and **ATS Installation Location** (at meter, in garage, back-to-back with panels).
- **Gas** — piping length and route, other gas connections, LP tank size, and a connection checklist (range, cooktop, oven, water heater, dryer, fireplace, grill, pool heater, generator).
- **Tank Location Dig & Special Notes** — big machine or mini, room to operate, special circumstances.
- **Page 2 materials** — CU and AL wire (500 kcmil–#6) with footage, THWN / OMNI cable by kW, fittings (½"–5"), wireway (2'–6'), Polaris taps, PVC J-boxes, strut, 60A/100A disconnects, Sakrete, surge protectors, PSP load-shed modules, other. Each table has its own Clear button; on phones page 2 becomes collapsible sections with dots marking the ones that have entries.

**Exports:** 📝 PDF✎ (two pages) · 📸 CAPTURE (one image per page).

#### 🗺️ Property Lookup
A Florida address intelligence tool for siting generators. Search an address (or tap the map) and it pulls parcel, flood, zoning, wind, utility and permit information onto a large interactive map. On phones the results slide up in a bottom sheet. Search history and your measuring unit are remembered.

**Features**
- **Result tabs** — Aerial & Street View, Parcel & Owner, Jurisdiction, HOA / Community Association, Zoning & Setbacks, FEMA Flood Hazard, Elevation Certificate, Wind Design (FBC), Electric Utility, Natural Gas / Propane, Permits & Documents. Each card fills in as its source answers.
- **Parcel & owner** — live county property-appraiser feeds for **62 of Florida's 67 counties**, with the statewide FL Dept. of Revenue parcel roll as a fallback everywhere; custom county feed URL and a "Diagnose live feeds" tool.
- **Flood** — FEMA flood zone (NFHL) with zones on the parcel, BFE lines, FIRM panel, LiMWA and LOMA/LOMC changes, plus a county DFIRM cross-check (and Lee County's estimated Zone A BFE). Elevation certificates from FDEM and county records.
- **Zoning & setbacks** — live zoning district from county/city layers; setbacks and generator / mechanical-equipment rules from the local code, with a full-page Municode reader.
- **Wind** — ASCE 7-22 / FBC 8th Ed. (2023) design wind speed interpolated at the point, plus Vasd, exposure category and wind-borne debris region.
- **Utilities** — electric provider by service-territory polygon (FPL, Duke, TECO, LCEC, co-ops, municipal utilities…); natural gas availability with a "plan for propane" call where mains are sparse.
- **Jurisdiction & HOA** — city/county limits (Census TIGERweb); HOA from county GIS and Sunbiz.
- **Permits** — link to the local permit portal and a drafted public-records request (Fla. Stat. ch. 119).
- **Map** — basemaps (Satellite, clean Aerial, county "Local HD" aerials, Street, Gray, Topo, USGS Quad, NatGeo), historical aerial time-lapse, parcel lines, neighbor house numbers, zoning, easements / septic / wells, building footprints, flood shading and ASCE wind contours.
- **Weather** — NHC hurricane cone, NOAA SLOSH storm surge (Cat 1–5), evacuation zones, NWS warnings, forecast temperatures and radar.
- **Measuring** — 📏 distance, area/perimeter and elevation profile (1 m LiDAR) in ft·in, ft, yd, m or mi; an elevation grid across the lot and neighbors (USGS 3DEP, NAVD88).

**Exports:** 📄 PDF report (one page) · 📸 MAP PNG · 📊 EXCEL (`.xlsx` formatted for the Estimate form's 📂 LOAD). The app opens offline; live searches need a connection.

#### ✏️ Site Annotator
A full markup tool for site plans, permit sheets and photos. Open an image or PDF (or start a blank sheet), draw, measure to scale, label equipment and export a permit-ready PDF. A customer bar holds the customer and address (used in file names) and an optional watermark line.

**Features**
- **Open** — images (including iPhone HEIC and TIFF), PDFs with a page picker, drag-and-drop, 📷 Camera, or ✦ New blank sheet (Letter to Arch D / A-sizes, portrait or landscape, white / grid / clear, 96–300 dpi).
- **Edit existing PDFs** — pull text, shapes and pictures off the page as editable pieces; signatures and seals are left alone unless you choose otherwise. Opening a digitally sealed PDF shows its seal status.
- **Drawing** — pen, line, arrow, polyline, rectangle, ellipse, revision cloud, leader, text, note, highlight, image and eraser, with 7 line styles, fills and 70+ fonts.
- **Measuring to scale** — straight line, path distance (trench runs) and area; set the scale from a reference line or the sheet's scale + DPI; grid and snap.
- **Presets** — ⚡ Labels (LP tanks 120–1000 gal, air-cooled 14–28 kW and liquid-cooled 25–150 kW generators, ATS 100–800 A, meter/panel, gas appliances), ⬡ Equipment symbols (Generac, Kohler, Cummins, Briggs & Stratton, ATS, meters, panels, NG meter, LP tank), ☰ standard-notes library, and stamps (north arrow, tree, hydrant, power pole…).
- **Layers**, image overlays (move, resize, rotate, flip, opacity), multi-page sheets, title block and legend.
- **Undo / Redo** — one tap per change (toolbar, Ctrl+Z / Ctrl+Y, or a 3-finger tap); covers drawings, text, measurements and image overlays, and each PDF page keeps its own history.
- **✍ Sign-off block** with saved "prepared by" profiles.
- **Auto-save** of the whole session on the device, with "Unsaved Session Found → Restore" on return.
- **Keyboard shortcuts** on computers — press `?` for the full list.

**Exports:** PNG · PDF (flattened for permit submittal, or "Acrobat-edit" mode that keeps markups editable in Acrobat). A PDF made here reopens with its markup still editable.

#### ⚡ Load Calculation
A residential load calculation using the **NEC 2023 Art. 220.82 Optional Method**. It works out service demand, minimum service size and minimum generator size, and sizes the feeder, neutral and grounding conductors. Tabs: 📊 Summary, Steps 1–5, Pool Panel, ❓ Help.

**Features**
- **Setup** — generator brand (Generac or Kohler), fuel (LP / NG), conductor (Cu / Al), feeder table (310.12 at 83% or 310.16 at 75°C), 1–10 feeder sets.
- **Step 1** general lighting at 3 VA/sq ft plus small-appliance and laundry circuits · **Step 2** HVAC per air handler (blower from tonnage; heat at 65%, or 40% with four or more units per 220.82(C)) · **Steps 3–5** fixed appliances, dryers and cooking at nameplate, each with **GAS** (excluded) and **Managed** checkboxes.
- **Managed loads** are removed from generator demand per 702.4(B)(2)(b) and listed on the report. They are also left out of the service / feeder / neutral results, which then size the **generator feeder** (the card and report say so); the utility service must still carry all loads.
- **Pool Panel** tab — sizes the pool sub-panel feeder at 125% (phase A/B amps, wire, panel rating, neutral, EGC).
- **Results** — service demand (VA and amps at 240 V), minimum service / generator feeder, minimum generator (Generac 10–150 kW or Kohler 10RESV–KG150R, NG and LP ratings from the manufacturers' spec sheets) and feeder wire.
- **Neutral** per 220.61 with Tables 220.54 / 220.55; **EGC** per 250.122; **GEC** per 250.66 with electrode checkboxes and a 250.64(F) arrangement picker.
- **Jobs** — collapsible customer banner, auto-save on the device, ↺ NEW JOB.

**Exports:** ⎙ PDF (the job is embedded, so ⤒ LOAD reopens it) · ⤓ SAVE IMG · share sheet where supported.

### Installs

#### 📋 Pre-Install Checklist
A one-page parts and materials checklist, confirmed in the shop and again on the install truck before a job leaves.

**Features**
- **Header** — customer name, date, address, install truck, job, lead.
- **Equipment** — generator size; transfer switch quantity, type (SE / NSE / Existing) and size (100–800 A, 16 or 20 space); undamaged generator packaged; no scratches or dents.
- **Material table** with a **Shop** check and an **Install Truck** check on every row — permit, service change kit, PSP load-shed modules (with qty), emergency stop button, Gen-Pro and OMNI cable (Al/Cu with footage), THWN wire (footage and size), battery, conduit, fittings, mounting hardware, Seal Tight / Car-Flex, pad / stand / existing, correct mounting hardware, rock.
- **Notes** box that grows as you type.

**Exports:** 📝 PDF✎ (one page) · 📸 CAPTURE. Reload with **📂 LOAD**.

#### 📋 Electrical Install
A two-page electrical installation checklist the install crew completes during the job. Every section is signed off by a team member and a "double checked by"; page 2 logs the materials used.

**Features**
- **Header** — customer, date, address, install truck, job, team member names.
- **Generator** — size, pad or stand, set and mounted, Mobile Link, battery, electrical made up, controller set to NG / LP / NOT SET, who received the manual.
- **Transfer Switch** — **+ Add Transfer Switch** for up to 4 switches, each with quantity, type (ASE / NSE / Existing, 100–600 A, 16/20 space), inside/outside, mounted, surge protectors, and torque checks on the generator run and panel lugs.
- **Walk Through** — service change, harness, grounding, grounds and neutrals separated, run route, 60A / 100A load shed programmed.
- **Inspection(s)** — private provider / county, service change, rough, final, underground, footing, pad, photos taken. **Clean Up** — clean, ready for homeowner training, miscues or delays.
- **Page 2 materials** — the same wire, fittings, wireway, Polaris tap, J-box, strut, disconnect, Sakrete, surge and PSP tables as Site Visit, each with its own Clear button.
- **🎤 VOICE entry** — speak to fill any field or table cell (e.g. wire sizes with lengths). Understands English and Spanish (button shows EN / ES), has an optional filter to ignore distant voices, turns itself off when idle, and needs an internet connection.

**Exports:** 📝 PDF✎ (two pages) · 📸 CAPTURE (one image per page).

#### 🔥 Gas Installation
A two-page gas installation checklist the gas crew completes during the job. Page 1 holds the sign-offs; page 2 holds the regulators and the gas materials log.

**Features**
- **Header** — customer, date, address, gas truck, job, team member names.
- **Gas** — natural gas or LP tank install, tank size (AG / UG), tank serial #, existing gas, surface / underground / attic CSST lengths, needs completed. Each section has Team Member and Checked By sign-offs.
- **Walk Through** — gas affidavit, leak check, sediment trap, shutoff valves, flex whip, pressure check, purge, painted threads, 1st-stage connection, regulators installed to code.
- **Inspection(s)** — private provider, fire inspector, county, gas rough, tank, underground, final gas passed, photos uploaded. **Clean Up** — clean, ready for homeowner training, why not, miscues or delays.
- **Regulators** — 1st Stage, Norgas, 2nd Stage Straight and Back Mount, 2PSI, Pietro.
- **Material tables** by pipe size (2"–½") — galvanized pipe and fittings, close and standard nipples (1½"–12"), risers and transitions, poly fittings (per foot), appliance whips (12"–60"), strapping and cable, anodes and anchors, CSST, shut-offs and test gauge, PVC / POL fittings, plus Other / Notes.

**Exports:** 📝 PDF✎ (two pages) · 📸 CAPTURE (one image per page).

#### ✅ Quality Control Checklist
A two-page sign-off checklist used to check a finished generator install before the job is closed. Every item has a pair of answers (Good/Bad, Yes/No, Installed/Removed or Complete/Not Done) and a notes line that grows as you type.

**Features**
- **Header** — Customer Name, Date (defaults to today), Address with autocomplete (Mapbox v6, US Census backup) and 📍 GPS, Install Crew, Project Manager. Page 2 repeats the name and date automatically.
- **Page 1** — Transfer Switch, Meter (tap the header to switch between **Meter** and **Meter Main** item sets), Customer Panel, Load Shedding and Conduit Strapping.
- **Page 2** — Generator, Gas Tank (filled, vacuumed, bonded (attic only), leak check), Gas (including leak-down check), Job Site (cleaned, placards).
- **Summary** — Overall Job Status (Pass / Fail / Needs Follow-Up), Items Requiring Follow-Up and Additional Comments.

**Exports:** 📝 PDF✎ (two pages) · 📸 CAPTURE (one image per page).

### Maintenance

#### 🔧 Maintenance Report
A one-page report for a scheduled generator service visit.

**Features**
- **Customer & Job Info** — name, job #, date, address, tech, model, serial # and hours.
- **Battery** — visual (corrosion / broken cables / good), condition (Good / Average / Poor / Needs Replaced), replaced Y/N, voltage, CCA, SOH, brand, date, water level (Low / Full / Add), notes.
- **Oil & Filters** — oil change (Full / Half), filter changed Y/N, filter part #, notes.
- **Generator** — startup test (Normal / Abnormal), voltage, case (Clean / Debris), coolant level and ounces added, wiring check, interior check (belts, pulleys, hoses, harness), condition, exercise schedule, notes.
- **Simulated Power Test** — tap the header to switch between a short "performed? Y/N (with reason)" view and the full 4-step test (started, transferred to generator, transferred back, shut down) with voltage during the test.
- **Gas System** — NG / LP, tank level, leak found Y/N with location, visual checks (rust, shut-off valve, straps, flex connection, regulator), vented Y/N.
- **Transfer Switch** — two switches, each with serial #, inside/outside and condition.
- **Monitoring & Protection** — surge protection, green light, monitor ready, connected (Y/N) and signal %, plus a **Service Notes** box.

**Exports:** 📝 PDF✎ (one page) · 📸 CAPTURE.

#### 🛠️ Service Work
A one-page service-call record: what the customer reported, what the tech found, what was fixed and what was used.

**Features**
- **Header** — Emergency / After Hours checkbox and Control #.
- **Info** — tech, date (defaults to today), time in, customer name, address, generator model, serial # and warranty details.
- **Text blocks** — Issue Reported, Found, Fixed, Materials Used.
- **Bottom row** — time out, run hours, firmware.

**Exports:** 📝 PDF✎ · 📸 CAPTURE.

### Tools — Lookup

#### 📄 Spec Viewer
Generac specification lookup with three tabs — ⚡ Generators, 🔀 Transfer Switches and 📖 Manuals — and a search box that finds models by name, kW or part number. Values come from Generac spec sheets.

**Features**
- **Generators** — Guardian NextGen 10, 14, 18, 22, 24, 26, 28 kW; Guardian Legacy 22, 24, 26 kW; Protector RG 22–150 kW (2.4L 22–60, 4.5L 48–80, 9.0L V8 100/130/150); Protector XG 25–80 kW.
- **Fuel consumption** — NG (CFH) and LP (GPH) at exercise (where listed), ¼, ½, ¾ and full load, plus BTU/hr and inlet pressure; estimated values are marked with an asterisk.
- **Rated output** — LP and NG kW and amps by voltage configuration (1-phase; 3-phase 208 / 240 / 480 V).
- **Key specs** — breaker, current, sound (operating and Quiet-Test at 23 ft), warranty, battery, controller, connectivity, certifications, clearances, fuel connection, altitude derate; plus engine, dimensions and weight, standard features, protective functions and accessories with part numbers.
- **Transfer switches** — 15 models in Service Rated (100–400 A, including SPD / meter / load-center models), Non-Service (100–800 A) and 3-Phase (100–800 A), each tagged NEW / REPLACED / NOT LISTED with electrical specs, timing and sensing, dimensions, features, accessories and SPD specs where they apply.
- **Manuals** — generator and ATS installation and owner manuals transcribed in the app, with part number and revision.
- **Navigation** — sticky jump chips, 🔗 Copy link to a specific model or section, ↑ Change to pick another model.

**Exports:** none — on-screen (🔗 Copy link).

### Tools — Electrical

#### 🧮 Electrical Formulas
Everyday electrical math in seven tabs (NEC 2023). Results update as you type, the last tab used is remembered, and every tab has a **🧮 Show the math** section that walks through the calculation.

**Features**
- **⚡ kW ⇄ Amps** — 1Φ or 3Φ, voltage (1Φ 120/208/240/277; 3Φ 208/240/480/600) and power factor; enter kW, kVA or amps to solve the other two.
- **📉 Voltage Drop** — Cu or Al, load amps, one-way length, wire size and 1–6 parallel sets against branch 3%, feeder 3% or whole-run 5% limits; shows volts dropped, % drop and volts at the load, recommends the smallest wire (ampacity per Table 310.16, held to the 240.4(D) small-wire limits), and lists "max ft @ 3%" by size. Resistance can be DC (Ch. 9 Table 8) or AC effective impedance (Ch. 9 Table 9) for PVC, aluminum or steel conduit at any power factor.
- **🔋 Gen Load** — loads in A, W, kW or HP placed on each leg (1Φ 120/240, 3Φ 120/208 or 277/480); shows amps and % per leg, imbalance, the kW needed to keep the heaviest leg ≤ 80%, and an OK / TIGHT / OVERLOADED verdict (motor starting surge not included).
- **⚙️ Motor FLA** — Table 430.248 / 430.250 FLA by HP and voltage, minimum wire amps at 125%, running kVA, and the largest breaker/fuse per Table 430.52(C)(1).
- **🔌 Breaker Size** — load amps with optional ×125% continuous; minimum rating and the standard sizes above and below (240.6(A)).
- **Ω Ohm's Law** — enter any two of V, I, R, W.
- **🔄 HP · kW · BTU · Tons** converter.
- **📋 FORMULAS** reference — formulas, Ohm's-law wheel, Chapter 9 Table 8 conductor resistance, motor FLA tables and 240.6(A).

**Exports:** none — on-screen results.

#### 🔌 Breaker & Conductor Sizing
Finds the minimum conductor per set and the equipment grounding conductor for a breaker (NEC 2023: 240.4, 240.6, 310.12, 310.16, 310.15 corrections, 110.14(C), 250.122). Results update live.

**Features**
- **Wire** — copper or aluminum / copper-clad aluminum.
- **Breaker** — common-size chips (15–1200 A) or any 240.6 size from 15 to 6000 A; generator quick-pick (Guardian 10–28 kW, Protector XG 25–80 kW) sized by nameplate amps (445.13, 100% or 115%) or by the generator breaker.
- **What it's feeding** — General (310.16) or Whole-home service (310.12 at 83%, 100–400 A). Whole-home is only available with no temperature or conduit-fill derating (and uses the 75 °C column); if heat or fill is set, the tool switches to General (Table 310.16 at 100%) with an orange note, and switches back when the derating is removed.
- **Conditions** — wire temperature 60 / 75 / 90 °C (90 °C used only for derating, result capped at 75 °C per 110.14(C)); ambient 50–185 °F (310.15(B)(1)); current-carrying conductor count chips from 1–3 up to 41+ (310.15(C)(1)); 1–10 parallel sets (if the load would need less than 1/0 per set, it uses 1/0 — shown in orange — per 310.10(G)); optional 240.4(B) next-size-up (not for 14–10 AWG).
- **Answer** — wire per set, usable ampacity, EGC in Cu and Al, temperature column used, combined derate factor, and notes (1/0 parallel minimum, over-800 A rule, 250.122(B)/(F)).
- **📋 CODE** reference — 310.16 with an amps lookup, derating, 310.12, 250.122, breaker sizes (240.6(A), 240.4(D)) and rules.

**Exports:** none — on-screen; **Copy for job notes** copies a text summary.

#### 📐 Conduit Fill Calculator
NEC 2023 Chapter 9 conduit fill (Tables 1, 4 and 5). Add conductors by type, size and quantity, press **Calculate**, and it checks your conduit and every size of that raceway type.

**Features**
- **11 raceway types** — RMC, IMC, EMT, FMC, LFMC, LFNC-A, LFNC-B, PVC Sch 40, PVC Sch 80, HDPE, ENT — each offering only its own trade sizes (3/8"–6" overall).
- **Fill rules** — Raceway mode uses Table 1 (53% for 1 conductor, 31% for 2, 40% for 3+); Nipple mode uses 60%.
- **13 wire types** (THHN/THWN-2, TW/THW, XHHW, RHH/RHW with and without cover, USE-2, THHW, MTW, PFA, TFN/TFFN, ZW, bare solid and stranded), 14 AWG–1000 kcmil.
- **Results** — total wire area, fill % with a bar (green **GOOD** up to 80% of the limit, yellow **NEAR LIMIT** up to the limit, red **OVER LIMIT**), the smallest passing size with headroom, an all-sizes table with cross-section drawings and ⭐ BEST FIT, and a jam-ratio warning (2.8–3.2).
- **📋 TABLES** reference — Table 1, Table 4 by conduit type, Table 5 by wire type and the Chapter 9 notes.

**Exports:** none — on-screen results.

#### 📦 Box Fill
Sizes outlet, device and junction boxes for 6 AWG and smaller under NEC 2023 314.16 (Tables 314.16(A) and (B)(1)) — check a box is legal before you close it up, or find the smallest box that works. Recalculates live.

**Features**
- **Box** — standard metal box from Table 314.16(A) (round/octagonal, square, device, masonry, FS/FD) with gang count, or a **marked-volume** box (NM or listed) with its stamped in³.
- **Barriers** (metal or nonmetallic) and **added volume** from marked plaster rings, extension rings or domed covers.
- **Conductor groups** — terminated/spliced and pass-through count 1, unbroken loops ≥ 12" count 2, pigtails count 0; up to four small fixture wires under a domed canopy are exempt.
- **Devices / yokes** (receptacle, switch, GFCI/AFCI, combo, dimmer…) at 2× their conductor; internal clamps, luminaire studs, hickeys, EGCs (1× for up to 4, + ¼ each after) and terminal blocks.
- **Results** — required vs available in³, fill % bar and verdict (**✔ BOX FILL OK** with spare in³, or **✖ OVERFILLED** with the shortfall and the smallest standard box that fits), a line-by-line breakdown with NEC references, and an all-boxes PASS / FAIL / SMALLEST FIT table.
- **📋 TABLES** reference — Table 314.16(A) with max conductors per size, Table 314.16(B)(1) and a plain-language 314.16 summary.

**Exports:** none — on-screen results.

#### 🧰 Pull & Junction Box
Sizes pull and junction boxes for 4 AWG and larger under NEC 2023 314.28 and Table 312.6(A), then checks a real box: will the fittings fit on each wall, and can the knockouts be laid out legally.

**Features**
- **Conductors** — largest size (14 AWG–2000 kcmil) and type (copper/other or compact AA-8000 aluminum) for 312.6(A) bending space.
- **Runs** — in and out wall (left, right, top, bottom, back, or none for taps), row 1–4, trade size ½"–6", "spliced in box". Pull type is automatic: straight (8×), angle, or U; spliced runs use the 6× rule.
- **Options** — removable cover opposite the back wall (312.6(A) exception) and straight-pull raceways in angle-row sums.
- **Actual box check** — enter the real W × H × D for **✔ BOX SIZE OK** / **✖ BOX TOO SMALL**, or get the minimum W × H × D rounded to the next common size.
- **Wall-fit check** (practical, not an NEC rule) — fitting widths, gaps and corner clearance per wall: FITS / TIGHT / WON'T FIT. Fitting widths are editable and remembered.
- **Knockout placement** — a true-scale solver keeping same-conductor entries ≥ 6× the larger raceway apart (center-to-center or edge-to-edge).
- **Drawings** — the box layout facing the cover with arrows between paired raceways, plus side views of each wall.
- **Notes** — any dimension over 6 ft (314.28(B)) and the > 100 in³ check for power distribution blocks (314.28(E)).
- **📋 CODE** reference — 314.28 summary, Table 312.6(A), worked formulas and the fitting-size table.

**Exports:** none — on-screen results.

### Tools — Install Planning

#### 🔥 Gas Calculator
Step-by-step gas pipe sizing for Generac generators on natural gas or LP, using the **NFPA 54 (2024)** Chapter 6 sizing equations at your exact run length (never exceeding the published tables), and CSST straight from the Gastite / FlashShield or TracPipe sizing charts. Live results for every run, plus regulator, meter and inlet-pressure checks.

**Features**
- **Steps** — (1) fuel, (2) generator, (3) gas delivery, (4) pipe runs, (5) other appliances.
- **Generators** — Guardian NextGen 10–28 kW and Legacy 7–26 kW; Protector QS 22–60 kW, RG 48–150 kW and XG 25–80 kW.
- **Gas delivery** — NG standard (7" WC, one run) or elevated (2 PSI with a regulator, two runs); LP twin-stage at the tank, two-stage, or three-stage (10 PSI → 2 PSI → 11" WC, for attic runs).
- **Each run** — length (stepper or quick-pick 5–300 ft), material (galvanized / Sch 40, CSST Gastite / FlashShield, TracPipe CounterStrike, buried PE) and pressure.
- **House appliances** — 11 presets plus custom; generator on its own line or teed into the house line.
- **Answer** — pipe size per run, minimum regulator ratings, NG meter check (250–1,000 CFH meters), full / half-load CFH or GPH, BTU/hr, required inlet pressure, and LP runtime on a 500-gal tank at ½ load.
- **Warnings** — inlet pressure, PE above grade, CSST bonding, the 5 PSI indoor limit, CSST brand and extra-fitting length.
- **More options** — allowed pressure drop (0.5 / 1 / 3" WC) and elevation (derates generator kW only).
- **📋 CODE** reference — NFPA 54 (2024) Tables 6.2.1 / 6.3.1 (Sch 40, CSST, PE) with a length/load lookup, the Gastite / FlashShield (Section 7, Jan 2013) and TracPipe CounterStrike (FGP-001US, Apr 2022) sizing charts the calculator uses, equations 6.4.1–6.4.2, sizing rules, CSST EHD and a Florida fuel-gas note.

**Exports:** none — on-screen; **Copy for job notes** copies a text summary.

#### 🔗 Gas Pipe Bonding
Works out the gas piping bonding a job needs under **NFPA 54 (2024) 7.12** and **NEC 2023 250.104(B)**: describe the fuel, pipe materials and appliances, and it tells you whether a separate CSST bonding jumper is required or whether the appliance grounds already bond the pipe — and draws the job.

**Features**
- **Fuel** — natural gas or propane (LP changes the wording to "house regulator" and lets outdoor appliances have their own poly line from the tank).
- **Pipe** — PE underground, rigid steel, copper, standard (yellow) CSST, arc-resistant (black) CSST.
- **Appliances** — generator, furnace / air handler, tank or tankless water heater, range, dryer, gas logs, pool/spa heater, grill stub, other — each with location (outside / attic / inside), "has power / EGC" and how it's fed; plus the meter-to-attic run.
- **Result** — **SEPARATE BONDING JUMPER REQUIRED** (any standard CSST), **BONDED THROUGH THE APPLIANCE GROUND** (steel or arc-resistant CSST), or no bond needed for poly alone; bond wire minimum, max jumper length (75 ft) and UL 467 clamp.
- **Optional checks** — lightning protection system (NFPA 780), jumper length over 75 ft, underground metal pipe.
- **Install checklist** tied to code sections — clamp location, landing points, tracer wire, NFPA 54 Ch. 9 appliance hookup rules, wall penetrations, striker plates, poly and risers, Florida Building Code – Fuel Gas.
- **Drawing** — "How It Connects" elevation of the job.
- **📋 CODE** reference — NFPA 54 7.12, NEC 250.104(B) and Table 250.122.

**Exports:** **📋 COPY FOR JOB NOTES** — a plain-text summary with verdict, checklist and code citations.

#### ⛏️ Trench & Burial Depth
Finds the minimum cover and dig depth for a trench holding any mix of electrical runs and gas lines under **NEC 2023 300.5** and **NFPA 54 / 58 (2024)** — the deepest requirement sets the trench. Recalculates as you add runs.

**Features**
- **Electrical runs** — wiring method (direct-burial cable; RMC/IMC; PVC/HDPE/EMT), circuit type (generator/feeder/other; 120 V GFCI 20 A residential; ≤ 30 V landscape), location, conduit size ½"–4", cable-in-raceway and service-conductor options.
- **Locations (Table 300.5(A))** — yard, under 2" concrete, under a 4" slab, home driveway, street or commercial lot, under a building, airport runway.
- **Gas lines** — natural gas (NFPA 54) or LP (NFPA 58), PE or coated steel, pipe size, location (yard 12", damage likely 18", can't get 12", under a building).
- **Results** — deepest minimum cover, **dig at least** (cover + pipe OD), and a per-run table (E1, G1…) with cover, dig-to depth and code citation.
- **Also required** — wet location, all conductors together, 8 ft riser protection, warning ribbon for services, Sch 80 where subject to damage, raceway under a building.
- **Warnings** — shared-trench separation (often 12" by the AHJ), PE under a building, gas under a building needs vented conduit.
- **Drawing** — trench cross-section measured to the top of the pipe.
- **📋 CODE** reference — full Table 300.5(A) with slab footnotes, NFPA 54 7.1 / NFPA 58 6.11 gas rules, a Florida note and the 300.5(D)–(K) notes.

**Exports:** none — on-screen results.

#### 🧱 Concrete Calculator
Estimates concrete for generator pads, piers and footings in cubic yards (or m³), cubic feet and premix bags. Calculates when you press **Calculate** (or Enter).

**Features**
- **Shapes** — Slab, Sonotube, Footing, and Slab + Tubes (a slab with piers).
- **Units** — Imperial or Metric, with a unit picker on every field (in / ft / yd or mm / cm / m).
- **Sonotubes** — standard 6"–24" or a custom diameter, plus depth/height.
- **Quantity** — number of identical pours, or number of tubes in Slab + Tubes.
- **Waste factor** — 0%, 5%, 10% or 15%.
- **Bags** — 80 / 60 / 40 lb or 20 / 30 kg (rounded up).
- **Results** — total volume with waste, raw volume, ft³, bag count, a slab-vs-tube breakdown, and a ready-mix vs bags suggestion at 1 yd³ and up.

**Exports:** none — on-screen results.

---

## Shared Features

These files are shared by every page so each feature works the same way everywhere. Pages include them; they never carry their own copy of the code.

**`sw.js` — offline engine**
- Saves the hub, all 21 tools, the shared files, the PDF / map / spreadsheet libraries and the fonts so everything works with no signal.
- Pages open from the saved copy and refresh in the background; libraries and images use the saved copy.
- County data files (Property Lookup) live in a separate store that is **kept across updates**, so techs don't re-download ~15 MB after every release.
- Public and test sites share this file but keep separate offline copies.
- A new version waits until someone taps **Update Now**. If files failed to save on a weak signal, they're re-downloaded on the next launch with a connection.

**`update-banner.js` — on every tool page**
- Sets up offline mode, and checks for updates on open, every 5 minutes and whenever the app comes back on screen.
- Shows the **⚡ App Update Ready** bar across the top with the changelog and **Update Now**.
- About 6 seconds after a page opens it checks the offline copy; only if files are missing does it show "X of Y offline files are missing" with **Fix Now**.
- Keeps a log of the last 10 errors on the device (used by Report a Bug) and asks the browser not to clear the offline copy.
- Holds the one shared dark / light setting (`aog-theme`).

**`sounds.js` — sound engine** (every page)
- All sounds are generated in code (no sound files), so they work offline.
- Automatic sounds for taps, checkboxes (fanfare when a checklist of 4+ boxes hits 100%), dropdowns, number boxes and photo pickers. Calculate → clunk, Delete / Clear → trash, Copy → copied, PDF / Save / Send → chime. A button can pick its own sound with `data-sound="name"`.
- Holiday background sounds on the forms, update and online/offline tones, and the hub's background-scene sounds.
- **Sound Settings** (hub): master switch; categories (Taps, Background Animations, Seasonal & Fireworks, Forms & Checklists, Alerts & Updates); Sound only / Vibrate only / Sound + Vibrate (vibration is Android-only); tone choices for clicks, checkboxes, toasts, success, fireworks, thunder, checklist done and update alerts.
- iPhone: sound starts on the first tap and mixes with music. Android / computers: sound can start as soon as the app opens.

**`clean-capture.js` — clean exports** (the 8 forms)
- Turns the holiday theme off (and pauses its particles) while printing, saving a PDF or making an image, then turns it back on — customers never see Halloween bats on a quote.

**`address-lookup.js` — address autocomplete** (the 8 forms + Load Calc)
- Holds the one Mapbox token, the lookups (Mapbox Geocoding v6 while typing; US Census address check when Mapbox has no match; 📍 GPS uses Mapbox, then OpenStreetMap), the suggestion list and the 📍 button. Forms mark their address box with `data-aog-address`; Estimate and QC Checklist keep their own list and GPS (street + City/State/ZIP) but use the same lookups (`AOGAddress.search` / `AOGAddress.reverse`).
- The list and 📍 follow dark / light mode and never appear in a PDF, print or image.

**`seasonal.js` — holiday engine** (the 8 forms)
- One shared copy of the holiday dates and the falling-particle layer. Each form keeps only its own holiday colors and can set its tab title and particle strength.
- **Testing:** add `?season=halloween` (any theme name, or `?season=off`) to a form's address.

---

## Holiday Themes

Themes run on the 8 forms. The first matching theme in the list wins, so some date ranges are cut short by others — the "Shows" column is what techs actually see.

| Theme | Dates in code | Shows | Background sounds |
|---|---|---|---|
| New Year | Jan 1–7 | Jan 1–7 | Fireworks, fanfare |
| Winter | Jan 8–Mar 19 | Jan 8–Feb 6, Feb 16–Mar 9 | Soft cold wind, gusts, footsteps in snow |
| Valentine's | Feb 7–15 | Feb 7–15 | Harp |
| St. Patrick's | Mar 10–24 | Mar 10–24 | Harp |
| Easter | 10 days before → 7 days after the real Easter Sunday (worked out each year) | 2026: Mar 26–Apr 12 · 2027: Mar 25–Apr 4 | Birdsong |
| Spring | Mar 20–Jun 20 | Late March / April days outside Easter, May 15–24 | Birdsong |
| Mother's Day | May 1–14 | May 1–14 | — |
| Memorial Day | May 25–31 | May 25–31 | — |
| Father's Day | Jun 1–20 | Jun 1–20 | — |
| Summer | Jun 21–Sep 22 | Jun 21–30, Sep 8–22 | Birdsong |
| 4th of July | Jul 1–10 | Jul 1–10 | Firework launches & bursts |
| Hot Summer | Jul 11–Aug 10 | Jul 11–Aug 10 | — |
| Back to School | Aug 11–31 | Aug 11–31 | School bell |
| Labor Day | Sep 1–7 | Sep 1–7 | — |
| Fall | Sep 23–Oct 31 | Sep 23–30 | Wind |
| Halloween | Oct 1–31 | Oct 1–31 | Haunted drone, wind, creaking door, owl, ghost moan, church bell, thunder, wolf howls |
| Veterans Day | Nov 11 | Nov 11 | — |
| Thanksgiving | Nov 1–30 | Nov 1–30 (except Nov 11) | Wind |
| Christmas | Dec 1–31 | Dec 1–31 | Crackling fireplace, sleigh bells, snowy footsteps, music box, church chimes, "Ho ho ho" |

Winter fills the gaps around New Year, Valentine's and St. Patrick's with icy blue colors and quiet snowfall. Holiday sounds need **Seasonal & Fireworks** on in Sound Settings and don't play in Vibrate-only mode.

---

## Repo Structure

```
AOG/
├── index.html              # Hub dashboard (PWA launcher)
├── offline.html            # Shown when a page isn't saved and there's no signal
├── manifest.json           # PWA manifest — icons, long-press shortcuts, theme color
├── sw.js                   # Offline engine: version, CHANGELOG, saved-file list
├── update-banner.js        # Shared on every tool: offline setup, update bar, error log, theme setting
├── sounds.js               # Shared sound engine (taps, holiday ambience, Sound Settings)
├── clean-capture.js        # Shared: keeps holiday themes out of every PDF / print / image
├── seasonal.js             # Shared holiday-theme engine for the 8 forms
├── address-lookup.js       # Shared address autocomplete + the one Mapbox token
├── logo.png                # Company logo
├── icons/                  # App icons (192, 512, apple-touch 180)
├── estimate/               # Estimate form
├── site-visit/             # Site visit / permitting info request
├── property-lookup/        # FL address / parcel / flood / zoning / utility lookup (+ county data files)
├── site-annotator/         # Site-plan & PDF markup tool
├── load-calcs/             # NEC 2023 220.82 residential load calculation
├── pre-checklist/          # Pre-install parts & materials checklist
├── elect-install/          # Electrical installation checklist
├── gas-install/            # Gas installation checklist & materials log
├── qc-checklist/           # Quality control checklist
├── maintenance/            # Generator maintenance report
├── service-work/           # Service call record
├── spec-viewer/            # Generac generator & ATS specifications + manuals
├── quick-calc/             # Electrical formulas
├── breaker-conductor/      # Breaker & conductor sizing
├── conduit-fill/           # Conduit fill
├── box-fill/               # Box fill
├── pull-box/               # Pull & junction box sizing
├── gas-calc/               # Gas pipe sizing
├── gas-bonding/            # Gas pipe bonding
├── trench-depth/           # Trench & burial depth
└── concrete-calc/          # Concrete calculator
```

---

## Tech Stack

- **Pure HTML / CSS / JavaScript** — no framework, no build step; each tool is one self-contained `index.html`
- **Libraries from cdnjs / jsDelivr** (saved for offline use) — html2canvas, jsPDF, pdf-lib, PDF.js, Leaflet, SheetJS
- **Service worker** — saved-copy-first with background refresh, a permanent data store for county files, and a user-approved update flow
- **Web App Manifest** — home-screen install, full-screen display, per-tool shortcuts
- **GitHub Pages** — static hosting from the `main` branch root

---

## Installing on a Phone

**Android (Chrome)** — open the site → menu (⋮) → *Add to Home Screen* / *Install*.

**iPhone / iPad (Safari)** — open the site → Share → *Add to Home Screen* → *Add*.

**Computer (Chrome / Edge)** — open the site → install icon in the address bar.

Installed, the app opens full-screen and all 21 tools work offline after the first load. On iPhone, installing to the Home Screen is also what keeps iOS from clearing the offline copy. Long-press shortcuts work on Android and computers (Android shows the first few); iPhones don't support them.

---

## Offline Behavior

On first load the app saves every tool page, the shared files, the libraries and the fonts (with a progress box on the hub). After that, pages open from the saved copy and refresh quietly in the background when there's signal. Property Lookup's county data files download the first time they're needed and are kept across updates. If any saved files go missing, tool pages show "X of Y offline files are missing" with a **Fix Now** button. The hub shows **Offline Mode** and a banner when signal drops; a page that was never saved shows the offline page, which links to every tool and reloads itself when the connection returns. Live features — Property Lookup searches, address autocomplete and voice entry — need a connection.

---

*Always On Generators · Power When You Need It*

---

© 2026 Brandon Keilholz. All Rights Reserved. — See [LICENSE](./LICENSE)
