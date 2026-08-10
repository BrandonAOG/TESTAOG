/* ============================================================================
 *  AOG Site Annotator — TRUE CLICKABLE FORM FIELDS (AcroForm) patch
 *  © 2026 Brandon Keilholz / Always On Generators — for use in your own app.
 *
 *  WHAT IT DOES
 *  ------------
 *  Reads the real interactive form fields (checkboxes + text fields) out of a
 *  PDF on import, draws them as clickable overlay objects, lets you toggle /
 *  fill them, and on export writes the values back into the ACTUAL AcroForm
 *  via pdf-lib — so the saved PDF keeps genuine, still-fillable form fields
 *  (not flattened marks). Checkmark appearances regenerate in every viewer
 *  because we also set NeedAppearances.
 *
 *  HOW TO INSTALL
 *  --------------
 *  STEP 1. Paste the whole PART A block below inside your main <script>, at top
 *          level (e.g. right after your `afterLoad` function is defined). These
 *          are function DECLARATIONS in module scope, so they can see zoom,
 *          shCtx, ptToCanvasPx, currentPage, composite, pushUndo, etc.
 *
 *  STEP 2. Make the small insertions in PART B at the named anchors.
 *
 *  STEP 3. Add the toolbar button in PART C.
 *
 *  Field-name matching is the only real risk: pdf.js `fieldName` must equal the
 *  name pdf-lib looks up. This form's names include spaces/colons (e.g.
 *  "Shingle over shingle:  Yes") — they match verbatim, so it works, but if a
 *  field ever fails on export it's logged to console with its exact name.
 * ==========================================================================*/


/* ======================= PART A — paste as-is ============================ */

var formFieldObjs = [];   // {name, kind:'check'|'radio'|'text', onState, checked,
                          //  value, x1,y1,x2,y2 (canvas px), readOnly, _page}

/* Called from the import pipeline (see PART B, anchor #1). vp = page viewport
 * already used by the explode pass, so transforms line up with the backdrop. */
function _extractFormFields(annots, vp) {
  try {
    // drop any fields we previously loaded for THIS page, keep other pages
    formFieldObjs = formFieldObjs.filter(function (f) { return f._page !== currentPage; });
    var U = pdfjsLib.Util;
    (annots || []).forEach(function (an) {
      if ((an.subtype || "") !== "Widget") return;         // only form widgets
      var ft = an.fieldType;                                // 'Btn' | 'Tx' | 'Ch' | 'Sig'
      var name = an.fieldName;
      if (name == null || name === "") return;
      if (ft === "Sig") return;                             // never touch signatures
      var r = an.rect || [0, 0, 0, 0];
      var c1 = U.applyTransform([r[0], r[1]], vp.transform);
      var c2 = U.applyTransform([r[2], r[3]], vp.transform);
      var x1 = Math.min(c1[0], c2[0]), y1 = Math.min(c1[1], c2[1]);
      var x2 = Math.max(c1[0], c2[0]), y2 = Math.max(c1[1], c2[1]);
      if (x2 - x1 < 1 || y2 - y1 < 1) return;

      if (ft === "Btn" && !an.pushButton) {
        var on = an.buttonValue || an.exportValue || "On";
        var fv = an.fieldValue;
        var checked = fv != null && String(fv) !== "Off" &&
                      (String(fv) === String(on) || an.radioButton !== true && fv !== "Off");
        formFieldObjs.push({
          name: name, kind: an.radioButton ? "radio" : "check",
          onState: String(on), checked: !!checked,
          x1: x1, y1: y1, x2: x2, y2: y2,
          readOnly: !!an.readOnly, _page: currentPage
        });
      } else if (ft === "Tx") {
        formFieldObjs.push({
          name: name, kind: "text",
          value: an.fieldValue != null ? String(an.fieldValue) : "",
          x1: x1, y1: y1, x2: x2, y2: y2,
          readOnly: !!an.readOnly, _page: currentPage
        });
      }
      // 'Ch' (dropdowns/lists) intentionally skipped in v1.
    });
    if (typeof toast === "function" && formFieldObjs.length) {
      toast(formFieldObjs.length + " form fields — tap the Checkbox tool to fill", "ok", 3000);
    }
  } catch (e) { console.warn("[AcroForm] extract failed:", e); }
}

/* Draw fields on the shape layer, in canvas coordinates (same space as shapeObjs). */
function renderFormFieldObjs(ctx) {
  if (!formFieldObjs.length) return;
  ctx.save();
  ctx.setLineDash([]);
  formFieldObjs.forEach(function (f) {
    if (f._page !== currentPage) return;
    var w = f.x2 - f.x1, h = f.y2 - f.y1;
    // faint interactive outline so the user can see what's clickable
    ctx.lineWidth = Math.max(0.75, 1.1 / zoom);
    ctx.strokeStyle = f.readOnly ? "rgba(120,120,120,0.45)"
                    : (f.kind === "text" ? "rgba(0,150,90,0.6)" : "rgba(0,120,220,0.75)");
    ctx.strokeRect(f.x1, f.y1, w, h);

    if (f.kind !== "text" && f.checked) {
      ctx.strokeStyle = f.markColor || "#c81e1e";
      ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.16);
      ctx.lineCap = "round";
      var p = Math.min(w, h) * 0.22;
      ctx.beginPath();
      ctx.moveTo(f.x1 + p, f.y1 + p); ctx.lineTo(f.x2 - p, f.y2 - p);
      ctx.moveTo(f.x2 - p, f.y1 + p); ctx.lineTo(f.x1 + p, f.y2 - p);
      ctx.stroke();
    }
    if (f.kind === "text" && f.value) {
      ctx.fillStyle = f.markColor || "#111";
      var fs = Math.min(h * 0.72, ptToCanvasPx(11));
      ctx.font = fs + "px Arial,sans-serif";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.beginPath(); ctx.rect(f.x1 + 2, f.y1, w - 4, h); ctx.clip();
      ctx.fillText(f.value, f.x1 + 3, f.y1 + h / 2);
      ctx.restore();
    }
  });
  ctx.restore();
}

function _findFormFieldAt(x, y) {
  for (var i = formFieldObjs.length - 1; i >= 0; i--) {
    var f = formFieldObjs[i];
    if (f._page !== currentPage) continue;
    if (x >= f.x1 && x <= f.x2 && y >= f.y1 && y <= f.y2) return f;
  }
  return null;
}

/* Toggle a checkbox, or fill a text field. Radios uncheck their group-mates. */
function _formFieldClick(f) {
  if (!f || f.readOnly) return;
  captureState(false);
  if (f.kind === "text") {
    var v = window.prompt("Field value:", f.value || "");   // v1: simple; inline editor later
    if (v === null) return;
    f.value = v;
  } else if (f.kind === "radio") {
    formFieldObjs.forEach(function (g) { if (g.name === f.name) g.checked = false; });
    f.checked = true;
  } else {
    f.checked = !f.checked;
  }
  renderShapeAndMeasure(); composite(); pushUndo();
}

/* Called at export time with the pdf-lib PDFDocument that is about to be saved.
 * Drives the REAL form fields, then flags NeedAppearances so viewers redraw. */
function _applyFormFieldsToPdf(pdf) {
  if (!formFieldObjs.length) return;
  var form;
  try { form = pdf.getForm(); } catch (e) { console.warn("[AcroForm] no form on export:", e); return; }
  var okC = 0, okT = 0, miss = 0;
  formFieldObjs.forEach(function (f) {
    try {
      if (f.kind === "text") {
        form.getTextField(f.name).setText(f.value || ""); okT++;
      } else {
        var cb = form.getCheckBox(f.name);
        if (f.checked) cb.check(); else cb.uncheck();
        okC++;
      }
    } catch (e) {
      miss++;
      console.warn('[AcroForm] could not set field "' + f.name + '":', e && e.message);
    }
  });
  // Belt-and-suspenders: force appearance regeneration everywhere.
  try {
    var acro = form.acroForm && form.acroForm.dict;
    if (acro) acro.set(PDFLib.PDFName.of("NeedAppearances"), PDFLib.PDFBool.True);
  } catch (e) {}
  try { console.log("[AcroForm] export: " + okC + " checks, " + okT + " text, " + miss + " missed"); } catch (e) {}
}

/* ======================= PART B — insertions ============================= *

  Make these edits in your existing code. Each shows a SEARCH ANCHOR (text that
  already exists) and what to ADD. The whole app is one minified line, so use
  your editor's Find for the anchor.

  ── #1  IMPORT: extract fields after annotations are fetched ───────────────
     ANCHOR (in _explodePDFPage's .then chain):
         _pageAnnots=annots;
     ADD immediately AFTER it:
         try{_extractFormFields(annots,vp)}catch(e){}
     (vp is in scope at that point — the same viewport used for the backdrop.)

  ── #2  RENDER: draw the fields on the shape layer ─────────────────────────
     ANCHOR (first line inside renderShapeAndMeasure's try{ ... }):
         renderMarkupObjs();
     ADD immediately AFTER it:
         try{renderFormFieldObjs(shCtx)}catch(e){}

  ── #3  CLICK: handle the checkbox tool at the top of onDown ───────────────
     ANCHOR (very start of onDown):
         function onDown(e){if(!baseLoaded||pinching)return;
     ADD immediately AFTER that guard:
         if(tool==="checkbox"){var _fp=getPos(e);var _ff=_findFormFieldAt(_fp.x,_fp.y);if(_ff){if(e.cancelable)e.preventDefault();_formFieldClick(_ff);}return;}

  ── #4  RESET: clear fields on new file (inside afterLoad) ──────────────────
     ANCHOR (in afterLoad, near the other array resets):
         markupObjs=[];commentObjs=[];
     ADD after it:
         formFieldObjs=[];

  ── #5  UNDO/SAVE SNAPSHOTS: include the new array ─────────────────────────
     ANCHOR — every occurrence of:
         markupObjs:JSON.parse(JSON.stringify(markupObjs))
     CHANGE each to:
         markupObjs:JSON.parse(JSON.stringify(markupObjs)),formFieldObjs:JSON.parse(JSON.stringify(formFieldObjs))
     (There are ~3: captureState, the pushUndo fallback, and _snapCurrentState.)

     ANCHOR — in BOTH undoFn and redoFn:
         if(snap.markupObjs!==undefined){markupObjs=snap.markupObjs}
     ADD after each:
         if(snap.formFieldObjs!==undefined){formFieldObjs=snap.formFieldObjs}

  ── #6  EXPORT: drive the real form on your editable-save path ──────────────
     Your editable-save path loads the source PDF with pdf-lib and later calls
     `.save()`. Call _applyFormFieldsToPdf on THAT document instance, just
     before it is saved. Find the save call:
         return pdfDoc.save()
     and make sure _applyFormFieldsToPdf(<thatDoc>) ran on the same document
     first, e.g.:
         _applyFormFieldsToPdf(pdfDoc); return pdfDoc.save()
     If the variable in your builder is `src` (from PDFLib.PDFDocument.load),
     call _applyFormFieldsToPdf(src) there instead. This is the one spot to
     place by hand — send me the export function and I'll pin the exact line.

     IMPORTANT: export permit forms via the EDITABLE-save path (the one that
     preserves /AcroForm). The rasterize/flatten path bakes the page to an
     image and will drop the live fields.
 * ========================================================================= */


/* ======================= PART C — toolbar button ======================== *
   Add next to your other .tb-btn buttons (e.g. after the Pen button). Your
   switchTool()/delegated handler reads data-tool, so no JS change is needed.

   <button class="tb-btn" data-tool="checkbox"
     title="Checkbox — click the real form boxes to check/uncheck; click text fields to fill. Exports as a live fillable PDF.">
     <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"
       stroke="currentColor" stroke-width="2"/><path d="M7 12l3.5 3.5L18 8" fill="none"
       stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
     <span class="lbl">Checkbox</span>
   </button>
 * ========================================================================= */
