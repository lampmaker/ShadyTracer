# Proposal: the Darkroom — a full-picture image editor for Save picture

## Context

Today (read in code): File › Save picture… opens a floating 420×760 panel (`index.html:1355`, panel `output`).
It renders offscreen and keeps the result **as linear light** (cd/m², Rec.709, negative channels kept for
out-of-gamut colours) in a GPU copy — `lib/pathtracer/develop.js makeDarkroom`, `index.js:1048 renderPicture`.
A Develop folder then shows it on a canvas **at most 320 CSS px high** (`index.js:1362`), with EV + meter, one of 7
tone curves, contrast / saturation / brightness (applied to the *encoded* picture, `rendertoscreen.js:258-265`),
false-colour settings, and Save PNG (8-bit only, `develop.js:160`).

So the hard part — a render kept as light, developed after the fact — already exists. What is missing is a
place to *look* at it, real colour controls, and a way to get the light itself out. "Full picture controls only":
every tool below acts on the whole picture; no masks, brushes or local edits.

The intended outcome: render once, then in a large tab where the viewport is, inspect at any zoom, grade with
photographer-grade global tools, and export either a finished picture or the scene-linear data.

---

## 1. Where it lives: a Darkroom tab beside the viewport

- A new dock panel **`darkroom`** ("Darkroom"), opened as a tab **within the viewport's group** — exactly how the
  Project panel opens (`index.html:1100`, `{ referencePanel: 'viewport', direction: 'within' }`). File › Save picture…
  opens it; a finished render brings it to the front.
- Layout inside the tab: **the picture fills the left/centre; a column of boxes on the right** (PropertyTable with
  `boxes: true`, the Render settings panel's look). Boxes, top to bottom:
  **Render** (size, samples, Render / Abort, progress — today's Save an image rows, `addSaveSize` reused) ·
  **Exposure** · **White balance** · **Tone** · **Colour** · **Curves** · **Finish** · **Export**.
  Each box has its own reset; boxes fold and remember.
- The floating `output` panel retires; its id is kept as an alias that opens the darkroom, so saved layouts and the
  help's links still land somewhere.
- **The live view is held while the darkroom is in front** (`RT.hold()`, `index.js:974`, released on
  `SHELL.onVisible` going away). The viewport panel is `renderer: 'always'` (`index.html:176`), so it would otherwise
  keep tracing behind the tab and compete with the preview for the GPU. *Inferred* that this matters; the user's
  machine decides — the hold can be a checkbox if it turns out not to.

### Viewer: pan, zoom, inspect
- **Zoom**: wheel around the cursor; Fit · 50 · 100 · 200 · 400 % buttons; double-click toggles Fit ↔ 100 %;
  keys `0` (fit), `1` (100 %), `+`/`-`. **Pan**: drag (or Space-drag), arrows. A small navigator rectangle when zoomed.
- Implementation: the develop pass gains a view transform (`view: vec4` offset + scale) instead of `uv * src`
  (`rendertoscreen.js:342`). Below 100 % it keeps today's box filter (`boxFor`); above, **nearest** sampling so pixels
  read as pixels, with a neutral backdrop outside the picture. The view maths are plain functions, tested without a GPU.
- **Before / after**: hold `\` (or a button) to show the picture as the view showed it (`pic.view`); a draggable
  **split** line for side-by-side.
- **Pixel readout** under the cursor: picture x,y · luminance in cd/m² · linear RGB · output RGB (8-bit). One 16-byte
  read of the kept buffer per hover settle (`img.hdr.r`, as `meter()` already reads it).
- **Clipping warnings** (toggle): pixels clipped high / crushed low tinted, per channel or any.
- **Histogram** at the top of the column: RGB + luma of the developed output (256 bins), with a second mode showing
  **scene luminance in stops** with the exposure's white and black marked. Computed on the GPU by a small compute pass
  over the developed picture, 4 KB read back per redraw, throttled while dragging.

---

## 2. The develop pipeline: order matters

One fragment shader, stages in this order. Stage A works on light (scene-linear), B is the tone mapping, C works on
the encoded picture. **Every new stage at its identity value leaves the output bit for bit as today**, so an
untouched save is still the view's picture (develop.js's contract, `develop.js:11-14`).

The shared `displayPixel` (`rendertoscreen.js:209`) is split into its existing parts —
`exposeLinear` → `toneMap` → `encode` → `gradeEncoded` — so the develop pass can put its stages between them while the
live display calls the same parts with nothing between. The live view is unchanged.

**A. Scene-linear (light)**
1. **Exposure** — EV100 + Meter (exists); plus **Meter at a point/area**: click the picture to put that spot at middle grey.
2. **White balance** — temperature (K) and tint (Duv) as a chromatic adaptation (Bradford, in LMS) from the chosen
   white to D65, built on `core/colorimetry.js cctDuvToXy` / `xyToCctDuv`. **Eyedropper**: click a surface that should
   be neutral. "As rendered" = identity (the renderer's light colours are physical; WB is a look, said in the help).
3. **Channel gains / mixer** — R, G, B multipliers (developer row: the full 3×3 mixer).
4. **Tone equaliser** (shadows / highlights done right) — a gain curve over log₂ luminance, ~9 sliders from −8 to 0 EV
   below white; applied as a luminance-only gain so hues stay. This is the global "shadows / highlights" tool on HDR
   data, where it works far better than on an 8-bit picture.
5. **Saturation / vibrance / hue shift** in **Oklab** (chroma scaled, hue rotated), luminance preserved.
6. **Gamut clip** into the display gamut (exists, `GAMUT_CLIP_WGSL`).

**B. Tone mapping**
7. The **7 tone curves** as today (numbers stable: a saved setting keeps meaning the same, `rendertoscreen.js:32`),
   plus **Parametric**: white point (EV above grey), black point, toe, shoulder, contrast — a filmic curve whose
   handles the user sets.

**C. Encoded (display-referred)**
8. **Output transfer**: sRGB (default, exact curve as today) · gamma 2.2 · gamma 2.4 (BT.1886) · linear.
9. **Levels**: input black / white, **gamma** (midtone), output black / white — per channel or all. This is the
   "gamma" control asked for.
10. **Curves editor**: master, R, G, B and a **luminance** mode (hue-preserving). Monotone cubic splines
    (Fritsch–Carlson: no overshoot between points), histogram drawn behind, click to add a point, drag, drag off to
    delete, presets (S-curve, fade, cross-process). Baked on the CPU to a 4 × 1024 LUT, uploaded on change, sampled with
    linear interpolation in the shader.
11. **Lift / gamma / gain wheels** (ASC CDL: slope, offset, power per channel + saturation) — the colourist's
    global grade; the CDL numbers export as a `.cdl` too.
12. **Contrast / saturation / brightness** — today's three, same meaning, kept for saved settings.
13. **Finish**: vignette (amount, midpoint, roundness — positional but whole-picture), film grain (amount, size),
    and **dither** on 8-bit output (on by default once the curves exist: steep curves band otherwise).

**D. Later, separate (optional phase)**: **bloom / glare** from the HDR data (a mip-chain blur, energy-conserving,
threshold in cd/m²) — the one effect a sun or a lamp in view really wants; and **sharpen** (unsharp mask). Both need
extra passes over the whole picture, so they are kept apart from the single-pass core.

### Settings as a recipe
- All develop settings are one plain object (today's `DV`), versioned. **Undo / redo** inside the darkroom
  (snapshots merged by drag, as `builder/history.js` does). **Presets**: save / apply / delete named recipes
  (kept in the workspace store). **Copy / paste** settings between renders. The recipe is embedded in every PNG
  (`tEXt`) and EXR (attribute) so a file says how it was made, and can be loaded back from a JSON sidecar.
- The darkroom's settings are carried to the next render (as today, `index.js:1431`).

---

## 3. Export: the finished picture, and the light itself

Box **Export**: format, options, file name (the stamped name as today, `lib/filename.js`), **Save**.

| Format | What | Notes |
|---|---|---|
| **PNG 8-bit** | developed | as today (`gpu.save`), now with dither and the recipe in `tEXt` |
| **PNG 16-bit** | developed | rendered into `rgba16float`, quantised on the CPU, own PNG encoder (deflate via the browser's `CompressionStream`), sRGB chunk |
| **JPEG / WebP** | developed | quality slider; via `OffscreenCanvas.convertToBlob` from the 8-bit pixels |
| **OpenEXR** ("raw") | **scene-linear light** | half (default) or float32; ZIP or no compression; `chromaticities` = Rec.709/D65; values **in cd/m²** with `whiteLuminance = 1` so the file is absolute; negative (out-of-gamut) channels kept; option *"exposed"* (× the exposure scale so 1.0 = white, what a compositor expects) and *"gamut-clipped"*; attributes: samples, version + git revision, scene, recipe |
| **Radiance .hdr** | scene-linear | RGBE with RLE; cannot hold negatives, so gamut-clipped and ≥ 0 |
| **PFM** | scene-linear | float32, trivial, for scripts / scientific use |

- The optics overlay (rays drawn over the picture) goes into developed formats only; never into the linear ones.
- Large pictures: the kept buffer is read back **in strips** and encoded strip by strip (an 8K float picture is
  ~530 MB; *read in code*: 16 bytes a pixel, `develop.js:133`), with progress and Abort.
- No new dependency: EXR / HDR / PFM / PNG-16 writers are small, written here, each with a reader in its test.

---

## 4. Phases (one PR each, each with its change note, help page and tutorial review)

1. **Darkroom tab + viewer** (*built 2026-10-25; seen by the user the same day: "looks great"*) — the panel within the viewport group, the column of boxes (today's controls moved in,
   Render box included), pan/zoom/nearest at > 100 %, before/after and split, pixel readout, histogram, clipping
   warnings, live view held while in front. *No new colour tools yet* — so the user can judge the viewer alone.
   Left out of it, said here so nobody assumes them: the navigator rectangle, the readout's output RGB (it needs
   phase 3's JS mirror of the pipeline), Space-drag (a plain drag pans), clipping per channel (any channel, for now).
2. **Export** (*built 2026-10-25, 0.next; not yet seen in the page*; the recipe is embedded, loading a sidecar waits for phase 4's presets) — EXR, HDR, PFM, PNG-16, JPEG/WebP, recipe embedded + sidecar, strip-wise readback.
3. **Light-stage tools** (*built 2026-10-25, 0.next; not yet seen in the page*; `displayPixel` copied as `developPixel` rather than split, so the live display and the tutorial's excerpt stay as they are; the EXR not white-balanced, a later choice) — `displayPixel` split; white balance + eyedropper, spot meter, channel gains, tone
   equaliser, Oklab saturation / vibrance / hue, parametric tone curve.
4. **Display-stage tools** (*built 2026-10-25, 0.next; not yet seen in the page*; Levels on all channels at once, per channel through the curves; the undo is the Darkroom's own, since the library imports nothing of the builder's; dither off by default, so an untouched save stays the view's picture) — output transfer, Levels (gamma), Curves editor, CDL wheels, vignette, grain, dither;
   undo / redo, presets, copy / paste.
5. *(optional)* **Bloom / glare, sharpen.**

## Files

- `lib/pathtracer/develop.js` — darkroom: view transform, histogram, recipe, exports' readback; pure maths stays here.
- `lib/pathtracer/core/rendertoscreen.js` — `displayPixel` split into stages; `develop_prog` gains the new stages,
  the view transform, the curves LUT and the histogram kernel. Identity = today's bytes.
- New: `lib/pathtracer/darkroom/` — `panel.js` (tab, viewer, interactions), `curves.js` (spline + LUT + editor
  widget), `grade.js` (JS mirror of every WGSL stage, for tests), `export/{exr,hdr,pfm,png16}.js`.
- `lib/pathtracer/index.js` — `installOutputUI` / `installDevelopUI` (`index.js:1226-1440`) move to the darkroom panel.
- `index.html` — the `darkroom` panel, `output` as its alias, Save picture… opening it `within` the viewport.
- `help/` — a Darkroom page; `changes/<slug>.md` per phase.
- Untouched: `lib/utils.js`, the submodules (`lib/tinywebgpu`, `lib/guistuff`). If 16-bit render targets or a
  float readback helper need tinywebgpu, that is a PR there first.

## Verification

- `node lib/pathtracer/core/check-shaders.mjs` before every commit (the develop pass and new kernels in pass 2 & 4).
- Extend `lib/pathtracer/test/develop.test.mjs` (uniforms complete, view transform, box/nearest switch, recipe round trip).
- New no-GPU tests: `curves.test.mjs` (monotone, endpoints, LUT vs spline), `grade.test.mjs` (each stage's JS mirror:
  WB adapts the chosen white to D65 exactly, identities exact, Oklab round trip), `export.test.mjs` (EXR / HDR / PFM /
  PNG-16 written then read back by our own readers; by Python `OpenEXR`/Pillow where installed, as the GIF test does).
- `develop.gpu.mjs` (optional webgpu + lavapipe): every stage at identity bit for bit the display's `displayPixel`;
  each stage against `grade.js`.
- `darkroom.check.mjs` (playwright): the tab opens within the viewport group, boxes, zoom buttons and keys, readout,
  Save buttons per format; `savesize.check.mjs` and `renderer.check.mjs` kept passing.
- Tutorial: `node tutorial/review/affected.mjs` (the colour and pixels chapters cite `rendertoscreen.js`), then the
  tutorial test and stamp after re-reading.
- **The user judges every picture**: after each phase, what to look at (e.g. phase 1: render, the tab appears where
  the viewport was, zoom to 400 % shows square pixels, pan, `\` toggles, readout values plausible, and whether holding
  the live view makes the preview's sliders feel faster on their card).
