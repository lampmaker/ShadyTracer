# The test bench

`lib/pathtracer/tests.js` — open `index.html`, pick **Tests** in the menu bar, press a button.
A popup reports the table with a Copy button; the same text goes to the console.

## Why it is a button

Every number that has decided anything in this project was measured on real hardware and pasted
back by hand, because a software adapter in a container measures a CPU emulation of a GPU and
predicts nothing about a real card. That loop is the only honest instrument available here, so
it has to be cheap to run. Until this landed it was not:

- `projects/weavesim/test/sweep.js` is *"open the file, select all, paste it into the console,
  then type `await weavesimSweep()`"* — which is why it has gone unused.
- The Russian-roulette comparison needed a hand-written Playwright harness, and reproducing it
  meant typing a four-call sequence into devtools.

So the bench is a **registry**: the next measurement is a row in a table in `tests.js`, not
another bespoke harness and another round of instructions.

## The two kinds

| | `kind: 'image'` | `kind: 'cost'` |
|---|---|---|
| question | does this change the **picture**? | does this change the **speed**? |
| loop | **paused** | **running** |
| method | `RT.step(samples)`, then `RT.imageStats()` | settle `secs`, then `RTSTATS()` |
| compared on | `trimmedLuma` | `msPerSample` |

They need opposite conditions, which is why they are separate kinds rather than one run with
more columns. Pausing is exactly what makes a cost reading meaningless; a free-running loop is
exactly what makes an image comparison incomparable.

`trimmedLuma` is the mean with the brightest 0.1% of pixels dropped. A plain mean is the wrong
instrument for comparing two unbiased estimators at a low sample count — path tracing's
distribution is heavy-tailed, and Russian roulette's `1/p` compensation is *precisely* a
rare-large-value mechanism. A difference that survives trimming is a real difference.

## Writing a test

```js
{
    id: 'my-question', kind: 'image', title: 'What I want to know',
    samples: 32,                                  // or `secs: 5` for a cost test
    pin: { maxaverages: 0, maxiter: 400 },        // applied to EVERY case
    rt:  { budgetOverride: 16 },                  // renderer properties, not uniforms
    cases: [
        { label: 'before', set: { rr: 0 } },
        { label: 'after',  set: { rr: 1 } },
    ],
}
```

`set` goes through `RT.set()`, the same path the sliders use, so any key in
`core/uniforms.schema.js` works and an unknown one is warned about rather than silently
dropped. `rt` assigns onto the renderer object, for the things that are not uniforms
(`budgetOverride`, `submitEvery`).

**A row whose scene only the host can make** -- a builder document through codegen, which `lib/`
may not import -- is written in the host and handed in with `RT.installUI(..., { tests })`, after
the renderer's own (`builder/lightbench.js`, the `light-vs-emitter` row). Its ids must be ones no
user's scene has: every row is applied over the user's own values, by name, so a bench node called
`ground` would take the demo scene's transform for its own (`xf_ground`) -- the bench's ids all start
`bench`. `extra.read` gets the
row's own image statistics as its fourth argument, for a column that compares two rows.
`clearLearned: true` clears what light tracing and emitter discovery have learned before every
row: the photon map and the emitter list outlive a clear of the picture, so otherwise a row starts
with the emitters the row before it showed. It then runs two rebuilds of the list and reads the
emitter count before it clears the picture and measures: **a count on the CPU is only as fresh as
the page's last yield**, and `step()` does not yield between samples, so `RT.emitCount` holds for
a whole row what it was when the row began. A column that reports it reads `await
RT.readEmitCount()` after the row.

### The rules the runner enforces, every one of them learned by getting it wrong

1. **Pin the confounders in `pin`, not per case.** The comparison that was supposed to rule out
   bounce-cap truncation as the cause of the RR brightening was itself run with the adaptive
   budget live — so the two arms did not even get the same number of wavefront iterations, and
   RR pushes the budget down on its own. Pinned here, that mistake cannot be made twice.
2. **Three layers, re-applied from the snapshot every case**: your settings → the test's `pin` →
   the case's override. Never "the override on top of whatever the last case left behind",
   which makes the table a record of the order the buttons were pressed.
3. **Clear the accumulation** (`RT.clearAccums()`). Nothing in this renderer ever clears it — a
   "reset" only pulls the EMA window in, so a camera move re-weights the picture instead of
   flashing black. Lovely to look at; useless to measure against, because case 2 would start
   from case 1's image.
4. **Consume the reset.** `Q.resetframecount` is cleared by the render loop, which is not
   running during an image test. Left at 1 it pins the averaging window to 0 on every step --
   each sample replaces the last -- so 32 steps converge no further than 1 does.
5. **`maxaverages: 0`** — the true mean, not the EMA window. And **`envMode: 0`, `renderMode: 0`,
   `lampsOnly: 0`** under every test's pin: a user who left the studio light, Draft, Sketch or lamps
   only on would otherwise get a table measuring that instead. A test that wants one sets it.
6. **Drain before timing.** The loop submits without waiting, so when a setting changes there
   can be seconds of queued work; a cost window opened then reports the queue, not the render.
   A discarded 1.2 s window then `COST.reset()` lets the exponential averages forget the
   previous case. On a slow adapter the drain *is* most of the run — 71 s of queue was measured
   on SwiftShader here, which made the first case of a run look like a hang for twelve minutes
   while every later case took two seconds — so the status line says when it is draining and
   how deep. On a real card this is a hundred milliseconds and you will never see it.
7. **Restore in a `finally`.** A test that leaves the renderer in a test configuration is worse
   than no test: the next thing you look at is a lie and nothing tells you so.
8. **Restoring the uniforms does not restore everything.** `R.ensureBuffers` only ever grows,
   so a case that raised `spp` left the ray buffers enlarged for every case after it — which
   is how `autobudget off` came to read +384% against a baseline it never shared. A case that
   can only grow an allocation (today: more `ltPhotons`) goes **last** in the list. `spp`
   itself is gone: at spp > 1 the camera rays filled the ray budget and light tracing got
   fewer photons, then none.

`budget` and `used` are separate columns: `budget` is the wavefront iterations the frame was
given, `used` is what the GPU reported the scene actually needed. Since 0.10.0 the budget is
always the worst case (or `budgetOverride`) and the adaptive controller is gone
(`raytrace_main.js` THE ITERATION BUDGET IS THE WORST CASE); its two properties, `autobudget` and
`flushTolerance`, went in 0.22.3. The readback that produces `used` and `flushed` runs every frame.

A cost row is flagged `QUEUE DEEP` when the queue is deeper than a quarter of the window — the
window never held steady state, so the number is not one. Raise `secs`.

## What is in there now

| id | kind | what it decides | status |
|---|---|---|---|
| `photometry` | image | Whether light comes out in the units it claims: a white floor under sun and sky against ρE/π, with rows that separate sun, sky, disc size, turbidity, light tracing and the scene unit. Two firefly-clamp rows (in × display white): at 4× the floor still reads 1; with NEE off it reads below its unclamped row — the fireflies removed. Loads its own scene and camera. | **answered — passes** (Pascal, third run: 0.9984–1.0001 on every row, *Results*). The two firefly-clamp rows are in no recorded press. |
| `error-bar` | image | Whether each pixel's reported standard error is the noise it really has: on the flat photometry floor, neighbours' mean squared difference against their summed squared errors (`seRatio`, must be 1), and `relSE` falling as 1/√samples. True mean, EMA window, NEE off, light tracing, mm. | open — first press. |
| `illuminance` | image | Whether the illuminance view reads the lux falling on a surface whatever the surface is: the photometry floor as white, dark, mirror and glass, NEE off, light tracing, mm, against E_sun sin h + E_sky (`ratio`, must be 1). `area`: the measure tool's rectangle over the middle of the picture, must be 1 too; a luminance-view row (mode 2) where `ratio` reads the albedo and `area` 1. | open — first press. |
| `cosine-law` | image | Whether a tilted surface receives E_sun sin(elevation + tilt) under the sun alone, in the illuminance view: level, tilted towards and away from the sun, back to it (0 lx), NEE off. | open — first press. |
| `disc-light` | image | Whether an emitter lights the floor as arithmetic says: a 10 000 cd/m² disc 0.99 m up, sensors in the picture at 0–1.5 m from its axis against the closed form plus the integrated rim (`cylinderE`). NEE, BSDF sampling alone, light tracing, emitter share, and the ordinary picture as πL/ρ. | open — first press. The first absolute check of an emitter. |
| `render-modes` | image | Whether Draft keeps the direct light exactly: on the photometry floor, which gets no bounce light, Draft must read what full reads -- `ratio` 1 for the Lambertian rows (sun and sky, sun, sky, studio), `vsFull` 1 for a glossy coat (where Draft stops), a near-mirror coat (where it follows) and a mirror, each against the full row above it. Lamps only reads 0 with the sun and sky still set. Sketch is reported only. | open — built 2026-10-01, never pressed. |
| `draft-lamps` | image | Whether Draft finds a lamp the camera cannot see: the disc light, the camera looking at the floor beside it, sensors at 1 and 1.5 m against the closed form in the picture. Full, Draft, Draft with its seek rays off (`draftSeek` 0: the disc is never found, the floor should read about 0), Draft with lamps only and the sun set. Each row loads the scene afresh, so each starts with no emitter found. | open — built 2026-10-01, never pressed. |
| `scale` | image | Whether the surface tolerance follows the scene's size: one glass sphere in m, cm and mm must give the same meanLuma; the old fixed 1 mm in the mm scene must not. | open — first press. |
| `optics-light` | image | Whether the optics source lights the picture with its real brightness: a 1000 lm Lambertian point 1 m over the floor must give Φh²/(πd⁴) lux at 0, 0.5, 1 m (illuminance view, and the picture as πL/ρ); a collimated disc Φ/(πr²) inside it. A red and a blue source: the same lux (the hue is normalised to luminance 1) and `hue err` 0 — the floor takes the light's colour. **R+G+B mixed to 4000 K** (the royal blue has a negative channel): the same lux, and the floor must read 4000 K, `du'v'` ≈ 0 — only true if the picture adds exact colours and clips once at the display. | colour rows passed (Pascal, 2026-09-27). The mix row's first press read the lux right and the colour 4247 K, du'v' 0.013 -- from a 3 x 3 sensor holding ~17 blue photon hits, where one sigma is 250 K. It now reads the whole frame's colour (~1e6 hits). **Second press: passes** -- 3999.9 K, du'v' 0.00006, lux 0.99 / 0.96 / 1.05 within seMax: the picture adds exact colours, the royal blue's negative channel included. |
| `optics-mode` | image | Whether the **Optics view** (Quality › Optics) lights a floor as arithmetic says and stops its rays at the first diffuse surface: a 1000 lm Lambertian point 0.5 m over the floor, a grey disc above it. With the flat light off the floor must read the direct light Φh²/(πd⁴) exactly (x columns 1); full reads more (the light the disc sends back down: reported, above 1). The flat light 2 stops down adds a quarter of Sketch's 1000 lx (in the expected value: 1 again); mm; the illuminance view traces in full. | **answered** (Ampere, 2026-10-02): the Optics view 1 on every column, full above 1 -- *The Optics view* (Results). |
| `light-vs-emitter` | image | Whether a **light** (light-traced) puts the same light in the picture as the same surface made an **emissive object** (PLAN.md, *Lights*, L0): one two-sided Lambertian disc of 10 000 cd/m², 1 m up, in pairs of rows, over a diffuse floor, the same in the illuminance view (sensors against the closed form, `cylinderE` without a rim), a mirror floor, a metal floor at roughness 0.22 and 0.23 (either side of `LT_MIN_ALPHA`), seen through a clear pane, and under a diffuser. `light/emitter` (on each emitter row) must be 1. `emitters`: what discovery listed, 0 on every light row (L1). Three rows read the light's face 56° off its axis against its distribution: Lambertian L, cos⁴ L cos³, a 30° cone 0 (L3); two more read it in the glass it emits into, through a block's top (L T / n², L4), and transparent with an emissive disc behind it (2 L: it lets the path through). Two more pairs put a 1 cm lamp of the same flux (9e6 cd/m²) over a metal floor at roughness 0.20 and 0.25, its top face shaded from the camera (L4b: its direct reflection shared between photons and camera paths by MIS); two more turn it on edge to light a white wall 1.5 m away, which the metal floor reflects at 0.20 and 0.25 -- the user's reflector (L7: the camera's paths aim at a light's face past their first surface). The 1 cm lamp's pairs run at a march tolerance of 10 um (`eps`), and one more at the automatic one, 0.91 mm here: a ray that close to a surface hits it, which makes the 1 cm emissive disc 1.2x too bright (PLAN.md, finding 7). Two more pairs (2026-10-02) on the diffuse floor: the light and the emitter in Draft, and the light in the Optics view (flat light off) against the emitter in Draft -- both 1, a hair over from Draft's emitter finding the disc a sample late; the light read low in Draft before (inferred from the code: its photons kept only their MIS share of the floor's direct light). The first bench whose scene is a builder document through codegen: the page builds it (`builder/lightbench.js`) and hands it in through `RTTESTS.addTest`, main's route for its benchmark: a button of its own in the Tests panel, not in Run all. Start it from the orbit camera: it names its whole orbit pose, but a bench started from the free camera keeps the user's view (main's runner; the fix for that left with this branch's merge, 2026-10-01). | L1, L3, L4, L4b and L7 hold (five presses, Ampere, 2026-09-29 to 10-02): every pair 1, the 1 cm lamp's too at eps 10 um; at the automatic tolerance 0.82 -- finding 7; Draft and Optics 0.995 as full. Every number: *Light against emitter: the presses* (Results). |
| `optics-balance` | optics | Whether the optics trace ends every ray where arithmetic says: a collimated beam onto a floor of albedo 0 / 0.5 / 0.8 (absorbed 1 − ρ), a mirror floor (all escapes), one step (half the flux in flight), an integrating sphere (arrived = 1/(1 − ρ)); a 1-step trace (half still going); the floor as a detector (all detected); balance 0. The first `kind: 'optics'` test: it runs `lib/pathtracer/optics`, not the picture. | open — first press. |
| `optics-farfield` | optics | Whether the far-field grid (the Intensity tab) gives a source's known curve: a disc shining up into nothing puts all its flux in the far field; Lambertian I0 = Φ/π (fitted as I0 cos γ over 0–20°) and beam angle 120°; cos⁵ 58.98°; a uniform 30° cone 60°; and the grid fed by a detector (the floor, lit from above) gives the same I0. The first run of `optFarAdd` on a GPU. | open — first press. |
| `optics-refraction` | optics | Whether the trace refracts and reflects glass as the textbook says (`optics-balance` has only opaque surfaces). A slab at 0 / 45 / 70° against (1 − R)/(1 + R), and `vs polar.` against the polarised answer — the unpolarised model's own error (0, −0.3%, −3%). A source inside the slab at 40° (escapes 1/(1 + R)) and 44° (total internal reflection: all lost to the bounce cap). A source at the centre of a glass ball: interactions per ray 1/(1 − R) = 1.0417. A 20° wedge: exit angle −10.26° (Snell). Two slabs with a gap: 50 mm passes; 0.5 mm at the automatic tolerance is **expected to fail** (reads one slab, 0.923 against 0.857: the gap is thinner than the surface offset), and passes at eps 10 µm. Known answers in `optics/fresnel.js`, checked by the Node test. | **answered — passes** (Pascal, 2026-09-27, 400k rays a row): every ratio within 2 standard errors of 1 (slab 0.9991 / 0.9999 / 1.0007, inside 0.9990, ball 0.9997, gap 1.0003 / 1.0001); TIR exactly 1; the wedge's exit angle to 2e-6 degrees; balance 0 throughout. `vs polar.` 0.9991 / 0.9966 / 0.9721, as predicted. The 0.5 mm gap at auto eps read 0.9228, one slab's value: the limit is real and is what the note says. |
| `optics-absorption` | optics | Whether glass absorbs with its thickness (Beer-Lambert, 0.37.0: a material's colour depth). The `optics-refraction` slab, colour 0.5, over the detector floor: T = (1 − R)² t / (1 − R² t²), t = 0.5^(L/d) one pass (`optics/fresnel.js absorbingSlabT`) — 200 mm thick at depth 200 mm 0.4610, 400 mm 0.2304, 45° the longer path; the 400 mm slab in an mm scene the same (the depth is a length the scene boundary converts). Depth 0 is the old rule, tinted at each face whatever the thickness: 0.2308 at 200 and at 400 mm. Balance 0 on every row (what the volume absorbs is its own tally, `O_VOL`). | open — first press. |
| `optics-coating` | optics | Whether a coating (0.39.0: a material's dichroic, beam splitter or AR layer) reflects and passes what it says. The `optics-refraction` slab, white, over the detector floor: T = (1 − R) with an AR back, (1 − R)/(1 + F) with a bare back, (1 − R)/(1 + R) coated on every face (`optics/fresnel.js coatedSlabT`). A 50/50 splitter with an AR back 0.5 at 0° and 45°, bare back 0.4808, every face 1/3; R 0 passes 1. A dichroic reflecting above 600 nm (20 nm edge): white light passes Σ luma × (1 − R_c), R_c its channel averages (`core/spectral.js edgeRGB`) — 0.8656 at 0°, 0.5390 at 45° (the edge at 551.8 nm), 0.8231 coated on every face — and its colour must read the predicted xy (du'v' 0 up to noise); a red light passes 1 − R_red, 0.4162. Balance 0 on every row. The furnace has six coated rows too (a coated white sphere must vanish). | open — first press. |
| `optics-dispersion` | optics | Whether dispersion (0.40.0: a material's Abbe number) fans white light as Snell and Cauchy say. A collimated white beam down through a 30° wedge, n_d 1.75, onto the detector floor; each row one channel's mean exit angle over the hits (their colour back in Rec.709 RGB, within a window of the fan) against the mean from the channels' wavelength weights and Snell at each wavelength. Abbe 0 (control): every channel at −23.923°. Abbe 28: red −23.892°, green −24.177°, blue −24.860°. The furnace has three dispersive rows (a dispersive white sphere must vanish). | open — first press. |
| `optics-colour` | optics | Whether a detector reads the colour a light was given: a 3000 K light, a 6500 K Duv +0.005 one through glass, a royal-blue LED outside the Rec.709 gamut (its negative channel must survive the GPU), and red + green + royal-blue LEDs mixed by `mixToTarget` to 4000 K at 1000 lm (directly and through glass). `du'v'` from the target must be 0 up to noise; the mix rows are the noisiest (each ray picks one LED). | **answered — passes** (Pascal, 2026-09-27): the single lights to 1e-8 or better (3000 K 9e-11, 6500 K through glass 5e-9, royal blue 8e-9); the mixes 0.0012 and 0.0005, the counting noise of ~1650 blue rays in the last batch (one sigma ~0.0012). |
| `furnace` | image | Whether a material conserves energy: an albedo-1 sphere in a uniform environment (`envUniform`) must vanish, ratio 1. Lambertian, plastic, metal and glass at several roughnesses, NEE on and off. | **answered.** Every material 1.000 to 0.04%; rough glass 0.959, which a CPU reference shows is the single-scatter model's own loss (below). Later runs read rough glass 0.944: SURFACES.md. |
| `haze` | image | Whether dust in the air (0.62.0, a haze box: `core/haze.js`) conserves energy: the furnace's white sphere inside a box of albedo-1 dust, mean free path 1.5 m, ratio 1 at g 0.6, 0 and -0.5 and with NEE off; no box and a hidden box (density 0, the same kernels) 1 too, their `secs` against the dusty rows what the haze costs. Two controls, each well below 1: a black sphere without a box (the picture holds the furnace) and dust of albedo 0.5 (the dust does something). On Dawn over lavapipe its own furnace read 0.997-1.002 (`haze.gpu.mjs`); this is the card's compiler on the same arithmetic. | open — the first press (2026-10-16, 0.62.0) measured sky: every row 1.0000, noise 0, its camera orbiting the view's own target (fixed in 0.62.1: every test camera names its target). The second (0.62.1, Pascal, 819x1031): controls 0.152 and 0.431; no box 0.9998, hidden 0.9998, the dust 0.9990-0.9994 — 4e-4 of the light lost even with NEE off, a collision placed inside the sphere on a leg that had escaped to the 400 m radius (fixed in 0.62.2: drawn as the leg starts; `haze.gpu.mjs` holds it). **Answered** by the third (0.62.2 · 565fdcb, Pascal, 819x1031, 32 samples): against no box (999.768) the hidden box +0.0002 %, the dust with NEE off +0.002 % (its paths bring back the sky or nothing, so this one is nearly noise-free), with NEE on +0.024 % at g 0.6, +0.015 % at 0, −0.010 % at −0.5 — about 3, 2 and 1 of relSE/√pixels (0.008 %), an estimate that takes the pixels as independent; the controls 0.152 and 0.4315. Wall clock: the haze's code alone 1.2 s as no box, the dust 1.5–1.6 s, NEE off 0.7 s. |
| `bsdf-parity` | image | Whether eval, pdf and sampling are one BSDF: each material seen obliquely with NEE on and off must agree. | **answered — they agree** (below). |
| `frame-cost` | cost | What the f32 compare-and-swap frame buffer costs. | open — needs a real card. |
| `render-modes-cost` | cost | What the Quality presets cost on the scene and view you have: Standard, High quality, Draft, Sketch, Optics, and Draft without its seek rays; since 0.68.0 Draft without the photon map and without the lights' rays too (Draft keeps both, and Standard's iterations a sample), all with the photon map on, as the page traces. | open — built 2026-10-01, never pressed. |
| `rr-bias` | image | Whether Russian roulette is biased. | **answered — it is not.** Kept as a regression check. |
| `nee` | image | Whether next-event estimation is unbiased and cuts noise. | **partly answered.** Clean and 3.8x quieter with sun and sky; the +76% at 20x sun was read in a scene carrying its own emissive light, which light sampling does not cover. |
| `nee-split` | image | Which half of light sampling is wrong, disc or sky. | open — one press. |
| `lt` | image | Whether light tracing keeps the total, and what its learned photon map is worth. Run on the showcase scene with the glass in view, a small bright sun (100 klx, a 3.44° disc): light tracing off, on with a uniform map, on with the learned one, at 1 and 0.1 photons a pixel, a 0.5 m photon square, and NEE off with it off and on. meanLuma must hold on every row; `lt noise` is the noise over the pixels photons reach (a region an untimed pass marks and freezes), with `lt top1%`, `conn/photon` and `lt reach`. | **answered — the split is exact** (Ampere, showcase: meanLuma within 0.03% on all eight rows of the third run). Learned and uniform equal at 1 photon a pixel (its fifth run: `lt noise` 0.489 / 0.491, off 0.534); the 0.1 photons-a-pixel rows came after, no press recorded. PLAN.md, *Light tracing: verified*. |
| `emitters` | image | Whether every way of finding an emissive surface gives the same picture: the showcase scene's emissive sphere the only light (sun and sky off), discovered from the paths that hit it, not declared. NEE towards it with MIS, BSDF sampling alone (NEE off), light tracing on and off, NEE's emitter share 0.2 and 0.9; meanLuma must hold on every row, and a row that moves names its bug (the test's note). `emitters`: the boxes discovery listed. | **answered — passes** (Pascal, 64 samples, third run: every row within 0.31% of row 1); the first run's two biases fixed. PLAN.md, *Emissive surfaces as lights*. |
| `small-caustic` | image | Whether capping the sun's photon square at the scene's radius (0.9.1) keeps the picture and cuts a small scene's caustic noise: a 1 cm glass ball on a white floor 8 cm across in a cm scene, the real sun; radius 5 cm (square 5 cm) against the 400 m default (square 15 m), uniform and learned maps, light tracing off. meanLuma must hold on every row; the gain is `conn/photon` and `lt noise` (inside the caustic, as in `lt`). Loads its own scene and camera. | open — built 2026-10-02, not pressed. |
| `sppm` | image | Whether the photon map (0.60.0, on by default since 0.61.0, `core/sppm.js`) adds exactly what the camera's rays then leave it: a clear glass pane standing on a white floor, the 3.44° sun behind the camera, the floor behind the pane lit and seen through it (the user's picture of 2026-10-15). The map off, on, and on with light tracing off must have one meanLuma; a 5 cm lens off and on another (until 0.61.0 the lens's photons drew the lens row with the map off). The gain is the floor through the pane in the view; `secs` is what the map costs (a second wavefront chain a sample); `map M`, `dropped`, `r mm` what it held. Loads its own scene and cameras. | open — built 2026-10-15, not pressed. |
| `small-emitter` | image | Whether a small emitter, aimed at with a margin of its own size (0.9.1; it was a fixed 2 cm), still lights the floor as the closed form says: `disc-light` at a hundredth of the size, in a cm scene, radius 6 cm and the 400 m default, the old 2 cm margin put back (`emitMargin` 0.02) on two rows. Every column 1 within `seMax`; the gain is `seMax`. Loads its own scene and camera. | open — built 2026-10-02, not pressed. |
| `nee-cost` | cost | What the occlusion queue costs. | open — needs a real card. |
| `iteration-cost` | cost | What a wavefront iteration actually costs, with `budgetOverride` holding everything else still. | open. Since 0.10.0 it says what the worst-case budget costs. |
| `budget-image`, `budget-cost` | | Whether the adaptive budget changed the picture, and what it bought. | **removed in 0.22.3.** The picture: it did not (+0.03%). The cost: both arms ran 24 with `used` 24. Both were one render from 0.10.0, when the adaptive budget went. |
| `cost-sweep` | cost | Where the render time goes: baseline, then one dial turned down per case. | first run below. |
| `bench` | bench | **The benchmark** (below): a frozen Noise library at 1280 x 720, fixed camera and settings, one change per row, its reliefs in a shell, removed, and one at a time; the same scene in cm and m; two drift checks; five other scenes; each scene with its bounding boxes off too; an uncached compile time per scene text; the GPU time of march, shade and occlude per sample. For comparing machines and commits. | five full runs, two on a GTX 1080 Ti and three on Ampere: PERFORMANCE.md, STATUS. |

## The benchmark (`bench`)

A third kind, for a different question: not "does this setting change the speed" (`cost`, on whatever
the view shows) but **how fast is this code, on a stage nothing can move** — so two machines, or two
commits, can be compared. Asked for by the user on 2026-09-29, when the Noise library was measured about
6x slower than showcase, demo, Menger cubes and materials at the same resolution, with the longest
compile, and nobody knew why. (Its first version was built on Surface materials, from a misreading of
which scene was meant; the user corrected it.)

- **The stage.** Frozen copies of the scenes (`bench/scenes`), rendered **offscreen at
  1280 x 720** (`beginOffscreen`, so the window's size plays no part), from a **fixed camera** per scene
  (`bench/index.js` CAMERAS, target included), with **every renderer setting at its schema default** but the
  photon map, off as it was before it went on by default in 0.61.0 (`tests.js` BENCH_BASE: every earlier run was
  without it), then the scene's own environment, then the row's one change.
- **The iteration budget is the row's own worst case** (`(maxbounce + 1) + ceil(maxiter / 32)`: 24 at the
  defaults). Since 0.10.0 by construction: the engine's adaptive budget is gone. Before, it carried from
  row to row until 2026-09-30 (the "maxiter 128" row left every later row at 15 iterations where row 1 had
  24, the fifth run's kernel pass counts), and after that a row could still start at 4 from a stale
  reading and settle at 8 (the third run's materials row). Runs 1-5 compare rows 6 onward against a row 1
  that ran more iterations, and runs before 0.10.0 may have rows below the worst case: read their
  `budgetTimed`.
- **The camera's `elevation` is degrees OFF VERTICAL** (`lib/camera.js:117-118`: the height is
  `distance x cos(elevation)`), not above the horizon. The first version took it the other way: its
  camera stood above the studio scenes' softbox and looked down through it, and the user saw the
  softbox fill the view. The cameras now look 25 degrees down (elevation 65), each at the shortest
  distance that keeps every object's estimated box (`builder/bounds.js`) inside 90% of the frame,
  computed with `lib/camera.js` itself; for the Noise library and Surface materials that is 850 mm,
  the camera 359 mm up, below the softbox. `bench.test.mjs` checks those two through the same module
  with the objects' exact corners: all in the frame, none seen through the softbox. Computed, not
  seen: `BENCH.view` below is how to see it.
- **The clock.** One sample per trace, each awaited: wall clock from recording to the GPU's done, per
  sample. No governor, no pacing, no queue. The first samples of each row are thrown away (at least 3
  and 2 s); then at least 4 samples and 5 s are timed, but never more than 64 (which ends a fast
  row's timing before 5 s). The report gives the median, min and max ms/sample.
- **The rows** (34), the Noise library first:
  1. the Noise library as it is; then one change each on the same scene, swapped in once: light tracing
     off, NEE off, sun and sky instead of its studio light, the softbox dark, maxiter 128, maxbounce 4,
     **bounding boxes off** (every object evaluated at every step, as before the culling); then row 1
     again, unchanged (**drift check**);
  2. scenes of its own: **reliefs in a shell** (row 10: the six reliefs' code replaced by the relief as
     the builder writes it now, which evaluates the noise only near the surface -- row 1 keeps the frozen
     relief so it stays comparable with earlier runs; read row 10 against row 9 above it), the same **with a
     step bound measured for their fBm** (row 11: `modifiers.js` RELIEF_CODE_FBM_BOUND, `noise.js`
     NZ_RELIEF_LIP_MEASURED; read it against row 10, kernel by kernel, and look at it with `BENCH.view(11)`
     against `BENCH.view(10)`), **noise materials plain** (which also removes codegen's per-step `p_local`
     tracking -- the row cannot separate the two), **reliefs removed** (every relief group's code
     dropped, the plain shapes left), and **each relief alone** (six rows, the other five removed);
  3. the same physical scene **in cm and in m** (re-authored, and converted the way a paste converts)
     and **20x larger** -- the same scene text, so they should read the same as the first row, and the
     20x one says what the scene's small physical size costs; then row 1 again (**drift check**);
  4. Surface materials, showcase, demo, Menger cubes and materials, each at its own camera and each
     followed by itself with its **bounding boxes off**: other scenes, a check that the difference shows
     on this machine, not a comparison.

  No anisotropy and no glass rows: the Noise library has neither. The drift checks are there because
  the first full run (1080 Ti, PERFORMANCE.md) had rows that did less and read slower -- maxiter and
  maxbounce lowered, +6% each -- which a GPU clocking down over the run would also produce. If the
  repeats read like row 1, the rows between them are not drift.
- **The compile column** (`compile ms`). For the Noise library, its two shell rows, its materials
  plain, its reliefs removed, and the five other scenes, the build's own 14 kernels (13 before 0.10.0; `raytrace_main.js`
  `wavefrontKernels`, the table `setScene` builds from) are compiled at once, as a scene change compiles
  them, with the loop paused and the GPU drained, **uncached**: `core/profile.js` `profileWG` puts one
  line no cache has seen at the top of every entry point, a test of the WORKGROUP id against a number
  no dispatch reaches, so no browser or driver cache can answer, and makes every kernel async, so each
  one's `ready` waits for its compile. The cell is the time until all 13 are ready; the JSON adds when
  each was ready and which was last. A kernel that fails to compile makes the cell `1 failed` (the JSON
  names it and keeps the time). check-shaders fails if any compute kernel built through that device
  does not start with the guard or is not async.
  - *Why the workgroup id:* the first full run's guard tested `gid` and Tint refused lt_build
    (`'workgroupBarrier' must only be called from uniform control flow`); naga had passed it, so
    check-shaders pass two now lints for that shape.
  - *Why async:* a sync pipeline's `ready` resolves at creation (`tinywebgpu.js:1353`), so in that
    run only genrays, march, occlude and shade were timed; the other nine read 5-44 ms whatever they
    cost, and lt_build's failure reached only the console. **What it does not time** (read in code): a
  structural edit in the builder first compiles the builder's probe, a full compute pipeline with the
  scene in it (`builder/validate.js:60`, from `demo.js` applyNow before `RT.setScene`), and, when boxes
  are shown, the tagged field after (`boxes.js`, `core/field.js`). So the column is less than an edit's
  compile. The builder's own console line, `[builder] scene applied: probe .. ms, pipelines .. ms`, has
  both parts for a live edit, where a cache may answer. The unit rows and the drift checks say `= row 1`
  (the same text, checked byte for byte); the single-relief rows and the settings rows say `-`. `setScene ms` is
  the scene swap before the row, which may come from the browser's cache: it is not a compile
  measurement.
- **The boxes column** (`boxes`). The culling (`builder/codegen.js`: each top-level node skipped while
  farther than its box) needs every box measured, and the page measures only the builder's own document.
  So each row measures its own document's boxes (`bench/index.js` boxesFor, over `RT.sampleTags`) after
  the compile and before the clock, and writes them without restarting the picture. The cell is how many
  top-level nodes had a box, e.g. `14/14`. Fewer means some are rendered unculled: `open` shapes (a
  plane), or a box not found. The JSON adds `boxesMs`, the time the measuring took (its first call
  compiles the tagged field for that scene), and `boxesUnknown`, each node without a box and why (hidden,
  not measured yet, changed since measured, unbounded, no surface found). In the page,
  `CULL_REPORT()` in the console says the same for the scene in the builder.
- **The kernel columns** (`gpu ms`, `march`, `shade`, `occlude`). Where a sample's GPU time goes: after the
  timed samples, 4 more (at least 1 s, at most 16) with a timestamp pair on every kernel's compute pass
  (`lib/pathtracer/core/kerneltime.js`, through tinywebgpu's `timePasses`; how, in its header). Each cell
  is the median over those
  samples in ms per sample. `gpu ms` is the median of each sample's total over every kernel, so it is not the
  sum of the three shown. The JSON adds `kernelMs` (every kernel: genrays, prep_*, flip, resolve, lt_build,
  emit_*, and `other` for a pass no kernel table names), `kernelPasses`, `kernelSamples` and `kernelWallMs`,
  the wall clock of those samples: against `ms/sample` it shows what the timestamps cost. Timestamps leave out
  the gaps between passes, and a browser may round them (Chrome documents 100 us unless its WebGPU developer
  features are on; not checked here). Without the device feature `timestamp-query` the cells are empty and one
  line under the table says so.
- **The gaps column** (`gaps`, added 2026-10-01 with `PERFORMANCE_REVIEW.md`). Of the same samples, the median GPU
  time from the first pass's start to the last one's end that NO pass was running (`kerneltime.js` tally:
  `gpuSpanMs`, `gpuGapMs` in the JSON): uniform copies, barriers, launching ~175 dispatches a sample, and waiting
  for a submission if the CPU fell behind. The one figure that grows with the number of dispatches rather than
  their work.
- **The tail column** (`tail ms`, same date). One more sample after the kernel samples, with the **wavefront
  log** on (`raytrace_main.js` R.wavefrontLog, `wavefront.js` prog_wf_snap: a one-thread pass before every flip
  that copies the counters): the JSON's `wavefront` is that sample's iterations, each with the rays it marched,
  shaded and occluded and its GPU ms by kernel. The cell is the GPU ms of the iterations that marched under a
  tenth of the first iteration's rays (`wavefrontTailIterations` says how many): a few long paths kept going
  through a whole chain of dispatches. A large tail is the case for refilling the wavefront as it drains.
- **The one-at-a-time compile** (`compile seq`, same date). After the uncached compile above, the same 13
  kernels uncached again, each awaited before the next (`R.compileUncached(scene, { sequential: true })`). The
  cell is the total; the JSON adds `compileSeqEach` (what each kernel took alone), `compileSeqSlowest`, and
  `moduleMs`, what the march's text took to parse and validate with no pipeline made of it -- the builder's
  probe's near twin. Against `compile ms` it answers whether a scene change would be quicker compiling in turn
  than all at once. (It would not: the first run, Pascal, 2026-10-02, had all at once 16-20% quicker.)
  **Only when a test asks, since 0.20.3** (`compileSequential: true` on the test or a row): it was a third compile of
  every compile row, its question answered, and the benchmark is meant to be minutes. The column reads `-` otherwise.
- **The recording column** (`record ms`, added 2026-10-02 after that run). The median over the timed samples of
  `R.recordMs`: the JavaScript from the sample's first uniform write to its last submit, which hands the work over
  without waiting for it. The first run put `ms/sample` 2.35 ms an iteration above `gpu ms` in every scene, with
  `gaps` near zero; this says how much of that is the CPU recording, and the rest is the wait for the GPU to say
  it is done.
- **The cut column** (`cut`, same date). In the logged sample, the shadow rays that ended without a surface or
  their light -- out of `maxiter`, and before 0.10.0 also still marching on the last pass, which now gives them
  rounds of occlusion until each has ended -- and so were counted as lit (`wavefront.js` prog_occlude,
  the `shadowcut` counter). The JSON's `wavefront` has it per iteration (`cut`), with `flushed`, the camera rays and
  photons the last pass ended. Zero, or a few in a million, says the rule cannot move the picture.
- **The budget** (JSON only: `budget`, `budgetUsed`, `budgetFlushed`). The iteration budget the timed samples ran
  at (the worst case since 0.10.0), and the counters' last readings: the iterations any ray still marched in,
  and the rays the last pass ended.
- **The pipelined column** (`pipelined`, added 2026-10-02 after the second run). After the timed samples, 8 more
  with the next sample recorded while the GPU runs the one before (`renderFrame(n, null, null, { inFlight: 2 })`,
  `lib/pathtracer/samples.js`), timed as one stretch and divided by 8: a throughput, where `ms/sample` is each
  sample's latency. Read against `ms/sample` and `gpu ms`: near `gpu ms`, and saves would gain the difference.
  Since 0.10.0 saves, the timeline's frames and the studio's pictures render this way, so this column is the
  nearest the benchmark comes to what they pay a sample. Not the same: the stretch is pinned to one submission a
  sample, and a heavy save is cut into several (`raytrace_main.js` NO SUBMIT LONG ENOUGH).
  **Pinned only where the engine would not have cut it anyway, since 0.20.3:** a row whose slowest timed sample is
  under `SPLIT_OVER_MS` (250 ms). A heavier row's stretch keeps the engine's own submissions, and the JSON's
  `pipelinedSubmits` says which (`one a sample`, `the engine's`, or the row's own). The pin had taken away the
  splitting that keeps a sample from Windows' GPU reset, and the scenedata run lost the GPU in this step (the Menger
  cubes as data with the grid, the user's Pascal, 2026-10-04; that this was the cause is inferred, not shown).
- **Each timed sample** (JSON only: `msSamples`, `recordSamples`): the wall clock and the recording of every
  timed sample, in order. The second run had every row's fastest sample 5-16 ms above `gpu ms` and its median
  50-57 ms above; these say whether that is a toll some samples skip or a spread.
- **Rows 35 and 36**: the materials row and row 1 with a submission per wavefront iteration (`R.submitEvery`
  1). Read against rows 33 and 1: lower, and the browser was preparing the whole sample before the GPU started.
- **The budget sample by sample** (JSON only: `budgetWarmup`, `budgetTimed`, and `budgetStart`, the readings
  the row started from). Asked when three runs put the same materials row at 8, 24 and 8 iterations. Since
  0.10.0 every entry should be the row's worst case.
- **The report** adds the browser, the date, each row's camera, and a **code fingerprint** per row (a
  hash of the march, shade and occlude kernels as compiled): two rows with the same fingerprint ran the
  same shader text.

**A run that stops** (since 0.20.3, `lib/pathtracer/runwatch.js`). Every GPU step a run awaits ends with the step, or as
soon as the device is lost (`GPUDevice.lost`), or past its time: a sample 60 s, a wait for the queue or the boxes'
measuring 5 min, a compile never (it stops only on a loss). Then the run stops: the rows done stay in the table, the
row it stopped in keeps the samples it had timed (marked `STOPPED part way`), and a line under the table says the row,
its number and why -- the GPU lost (the browser's reason and the first line of its message) or which step took too
long. The JSON has it as `stopped`. On a lost device nothing that needs the GPU is put back or started (the scene, the
live loop), and the report says to reload; after a stop that was not a loss everything is put back as usual. A run
after a loss on the same device stops at its first step. Before this the run sat on "...running" for ever (the user,
2026-10-04).

**A row whose compile would take minutes is not run** (since 0.20.3). Before a row's scene goes in, the engine predicts
its build from the kernels' text without compiling it (`RT.predictCompile`, this machine's learned rate, the growth
`compileprogress.js` fits), and a row predicted over 60 s says `NOT RUN: predicted ... to compile` with the prediction
in its `compile ms` cell. A compile cannot be called back once started; the lens assembly x 32 as codegen compiled for
over ten minutes. The prediction is a fit (rms 11% over the 16 builds it was fitted on, 2-46 s), so a row near the
limit may run, and one far past it is an extrapolation.

**To look before running:** in the page's console, `await BENCH.view(1)` puts row 1's scene, settings and
camera in the live view and leaves them there -- it does not put your own settings back; `await
BENCH.view(25)` is Surface materials, any row by its number.

**To run some rows:** `await BENCH.run(1, 25, 27, 29, 31, 33)` in the console runs those rows only (here each
scene as it is; 35 and 36 are the submission rows), in the order given, a row given twice run twice -- so an A/B
can be interleaved (`BENCH.run(33, 35, 33, 35)`) and a card that drifts over the run shows as a spread and prints the same report there; a row's `= row N` still counts the full benchmark's rows.

**To run it:** open the page, Tests > **bench**. The first full run took 282 s on a GTX 1080 Ti
(measured, the user, 24 rows; a row on the Noise library took 8-9 s); the fifth, with the kernel
samples, 1442.7 s on Ampere. Leave the window alone meanwhile. Copy the whole report, JSON included,
and say which computer it came from.

**The scaling benchmark** (Tests > **scaling**, `bench/scaling.js`; since 0.10.1) is a second test of the same
kind, a few minutes long: the optics bench and OpticsBench2 as they are (frozen in `bench/scenes/`), and the optics
bench's lens assembly 1, 4, 16 and 32 times, as data (with the candidate grid too until 0.41.0). The copy rows show one picture
-- copy 1 framed, every other copy behind the camera -- with one march tolerance and one scene radius, so the count of
objects is the only thing that changes: whether `march`, `occlude` and `tail ms` grow with it is `PERFORMANCE.md` P3's
step 0, and since 0.22.8 the test of why the lens assembly x 32 spends most of its time in a tail of few rays
(`roadmap/ARCHITECTURE.md`, step 4). `await BENCH.scaling.view(n)` and `await BENCH.scaling.run(...rows)` work as
above. `node bench/test/scaling.test.mjs` checks the rows without a GPU: the copies, one text,
the shared tolerance and radius, the uniforms under 64 KiB, the framing, the boxes; `scaling.gpu.mjs` (optional, a
software GPU) measures the boxes as the bench does and counts a camera ray's steps and records at 1, 16 and 32 copies --
it is what found, in 0.22.10, a lens box measured 49 cm too big at 32. Until 0.22.8 the copy rows were
codegen, whose x 16 and x 32 were predicted at minutes to compile and never ran; as data every count is one text, so x 1
compiles and the others say "= row".

**The scene as data against codegen** (Tests > **scenedata**, `bench/scenedata.js`; since 0.10.2) is the third:
every bench scene and the two optics benches two ways -- as codegen makes it and as data (`builder/scenedata.js`) --
back to back, the same document, camera, settings and measured boxes; the lens assembly x 32 as data only (its codegen
text was still compiling after ten minutes on the user's Pascal); and the first row again. It is `PERFORMANCE.md` P3's
call 5: a data row's `march`, `occlude` and `shade` within 10% of the codegen row's, on every scene. (Its rows with the
candidate grid, and with exact hits, went in 0.41.0 with both: `roadmap/ARCHITECTURE.md`, Removed in 0.41.0.) The lens assembly x 32's rows are predicted at about 3 minutes even as data (in node, at the
starting rate), so since 0.20.3 they are not run: its materials read `p_local`, and in such a scene a group with code
and every CSG group above it is compiled, once for each copy (`builder/scenedata.js` native) -- 410 KB of WGSL against
38 KB for one copy. `await BENCH.scenedata.view(n)` and `.run(...rows)` as above;
`node bench/test/scenedata.test.mjs` checks the rows without a GPU.

**The data walk's own cost** (Tests > **overhead**, `bench/overhead.js`; since 0.22.12) is a fourth, a few minutes: the
Menger cubes as they are, then with their bend and twist made plain groups, then one Menger cube alone, then the material
test, each codegen and as data, and the first row again. Both ways take the same steps a ray (counted on a software GPU),
so each data row's `march` against its own codegen row's is what a step costs; `roadmap/ARCHITECTURE.md` (*Before step 5*)
says how each ratio reads. `await BENCH.overhead.view(n)` and `.run(...rows)` as above;
`node bench/test/overhead.test.mjs` checks the rows without a GPU.

**Baked against codegen** (Tests > **bake**, `bench/bake.js`; since 0.28.0) is a sixth, a few minutes: the eight bench
scenes twice each, as codegen makes them (every value a uniform) and baked (every value a constant in the kernels:
`builder/bake.js`), the culling boxes uniforms in both; each row compiled uncached, so its "compile ms" is a bake's cost.
Read each baked row's `march`, `occlude` and `surface` against its codegen row. `await BENCH.bake.view(n)` and
`.run(...rows)` as above; `node bench/test/bake.test.mjs` checks the rows and the bake without a GPU,
and `node builder/test/bake.gpu.mjs` compiles the baked kernels on Dawn and marches them against
codegen's.

**The step cache** (Tests > **stepcache**, `bench/stepcache.js`; since 0.23.0) is a fifth, a few minutes: the optics benches,
the demo, the showcase, the material test and the optics bench as data, each with the developer setting `stepCache` at 0
(off), 1 (the ball of the cell a ray is in) and 2 (the cells ahead) -- that one at a million, four million and sixteen
million cells (`stepCacheCells`, since 0.24.0) -- then the cells ahead filled before every frame (`stepCacheFill` 2: its
`stepcache_fill` kernel time is what a live edit pays), and the first row again. Every cell is filled by a pass of its
own before the first warm-up sample (the march's own lazy fill went in 0.41.0); read each cached row's `march` and
`occlude` against its own scene's off row.
`await BENCH.stepcache.view(n)` and `.run(...rows)` as above; `node bench/test/stepcache.test.mjs` checks
the rows without a GPU, and `node builder/test/stepcache.gpu.mjs` runs the engine's own march and
occlusion kernels with the cache on and off on Dawn, codegen's scenes and the optics bench as data: the cells filled by
the pass, every ray ends the same, the steps fall, no cell written by a march, and a second camera over the full cache
ends its rays as with it off (the cells are kept across camera moves since 0.24.0). Since 0.25.0 the developer switch
*Step cache: show its cells* draws the filled cells over the picture (orange where a ball is smaller than its cell; the
others clear since 0.32.2); the same test checks that walk against brute force on a grid made by hand.

(`grid.gpu.mjs`, `regrid.test.mjs`, `exact.gpu.mjs` and `analytic.test.mjs` tested the candidate grid and exact hits,
and went with them in 0.41.0. `builder/test/plainshape.test.mjs` keeps analytic.test's cases of which code is one
plain shape, which codegen's dear-only boxes rest on.)

`node builder/test/scenedata.gpu.mjs` is the one test here that runs shaders: the loop's field and
picks against codegen's on every bundled scene and on scenes made for what no bundled one has (arrays; every modifier
as data, nested, in arrays and in CSG groups, over a relief), on Dawn (the `webgpu` package, Tint inside) over whatever Vulkan
driver there is -- lavapipe on the CPU in a container. It says what it computes, never how fast: a CPU's emulation
predicts nothing about a card. Without the package or a device it says so and passes.

`node bench/test/bench.test.mjs` checks, without a GPU, that every row is what its
label says: the variants' scene text (the reliefs gone, or one left, the materials plain), the unit rows
byte-identical with every length scaled by exactly the factor, every setting naming a real uniform,
every camera complete and framing its scene, the drift checks row 1 unchanged, the uncached device's
guard on `wid` and every kernel async; and it runs the runner's bench path, the compile column and a
failed kernel included, the kernel samples after the timed ones and a device without timestamps, against a
renderer that records instead of rendering.

## Results so far

**Units.** The sections down to *Light against emitter* are in physical units (cd/m², lux, the
real sun — see `lib/pathtracer/README.md` § *Units*). The last three — Russian roulette, NEE and
the cost sweep — predate them: their relative results (biased or not, how much quieter, how much
slower) still stand; their absolute luma values are in the old arbitrary units and are not
comparable with a run made since.

**Hardware.** Each section names its own. The photometry, furnace and BSDF-parity tables are
1188×969 on an NVIDIA Pascal card, the light-against-emitter presses on Ampere, the Russian
roulette and cost sweep runs 1024×1024 on Pascal (as this header recorded them); NEE's is 256×256
on a software adapter, which shows the mechanism and nothing about speed. Real cards are the only
kind of number worth recording — see *Why it is a button*.

### Physical units: the first absolute check (first run)

`photometry`, Pascal, 1188×969, 32 samples, a white floor against ρE/π:

| rows | meanLuma / expected |
|---|---|
| sky only (m and mm) | 0.989 |
| sky only, turbidity 4 | 0.998 |
| sun only, 10° disc | 0.975 |
| sun + sky, NEE off, 10° disc | 0.974 |
| every row with the real 0.53° sun | 142–352, **median right** (1.01–1.04) |

The units, the sky normalisation, the disc's luminance and the scene unit held: the mm rows
matched the m rows, and the remaining shortfall of 1–2.5% is the diffuse model (not a pure
Lambertian), as the test's note says.

The real-sun rows were a bug the test was built to find. The light-sample pdf (`envPdf`) still
tested the disc as `dot(L, S) >= cos θ` while the radiance tested `|L×S|² ≤ sin²θ`. At the real
sun the cosine is ~180 f32 steps below 1, so the two disagreed on a band at the rim. A light
sample there carried the full disc divided by a sky-only pdf, about 10⁵ too much: a firefly
class, which is why the median was right and the mean was not. Both now use `inSunDisc`, and
`sunCosHalfAngle` is deleted so a second edge cannot come back.

**Second run, after the fix** (same card, size and samples):

| rows | meanLuma / expected |
|---|---|
| sun + sky, sun only, light tracing on, both mm rows | 0.974–0.975 |
| sun only at elevation 20 | 0.978 |
| sun only, 10° disc | 0.974 |
| sky only | 0.977 |
| sky only, turbidity 4 | 0.976 |
| sun + sky, NEE off, 10° disc | 0.973 |

Mean, trimmed mean and median agree to 0.1% on every NEE-on row: the firefly class is gone.
More telling, the rows agree with EACH OTHER to about half a percent -- sun and sky, two
elevations, two disc sizes, NEE on and off, light tracing on and off, metres and millimetres
all deliver the same light. **The units step is verified on hardware.**

The sky rows moved down, from 0.989 (turbidity 4: 0.998), and that is the same bug leaving:
sky samples near the sun's rim had been over-weighted too, most where the Mie glow is
brightest, which is why the hazier sky read higher.

**The baseline is ~0.975 on every row, and it is the diffuse model**, not the light:
`makeDiffuse` is a Fresnel-weighted diffuse lobe plus a 4% specular one, so a floor of
baseColor 0.8 reflects like one of about 0.78 (slightly more at grazing sun, hence 0.978 at
20 degrees). Read later runs against it: ONE ROW LEAVING THE PACK is a light or sampling bug in
that row's path; THE WHOLE COLUMN MOVING TOGETHER means the material changed -- which the
material review is expected to do, towards 1.

### Physical units: third run, after the material review — the floor reads ρE/π

Pascal, 1188×969, 32 samples, the floor now a pure Lambertian (`makeDiffuse`, specular 0):

| case | meanLuma | expected | ratio |
|---|---|---|---|
| sun + sky | 21827.2 | 21826.0 | 1.0001 |
| sun only | 18006.2 | 18006.3 | 1.0000 |
| sky only | 3817.1 | 3819.7 | 0.9993 |
| sun only, elevation 20 | 8709.3 | 8709.5 | 1.0000 |
| sun only, 10-degree disc | 18005.8 | 18006.3 | 1.0000 |
| sky only, turbidity 4 | 3819.1 | 3819.7 | 0.9998 |
| sun + sky, NEE off, 10-degree disc | 21790.4 | 21826.0 | 0.9984 |
| sun + sky, light tracing on | 21822.2 | 21826.0 | 0.9998 |
| sun + sky, mm scene | 21823.5 | 21826.0 | 0.9999 |
| sky only, mm scene | 3816.9 | 3819.7 | 0.9993 |

**The whole column moved together, from ~0.975 to 1.000**, which is what the baseline above said
a material change would look like, and by the amount the plastic model explained. The floor now
reads ρE/π to 0.1% under every light and strategy. The NEE-off row is the noisiest estimator
here (noise 1.43, ten times the others) and sits within it. The two sky-only rows at 0.9993 are
the one systematic remainder, 0.07%, and agree with each other across units; the sky
normalisation's own quadrature is the first suspect, far below anything visible.

**New baseline: 1.000 on every row.** A row leaving it is a bug in that row's path.

### The white furnace: first run, after the material review

Pascal, 1188×969, 32 samples, `envUniform` 1000 cd/m², maxbounce 40:

| case | ratio |
|---|---|
| Lambertian / NEE off | 1.0000 / 1.0000 |
| plastic rough 0.5 / NEE off | 1.0000 / 1.0000 |
| plastic rough 1.0, smooth, ior 2.4 rough 0.2 | 1.0000, 1.0000, 0.9998 |
| metal rough 0.5, rough 1.0 / NEE off, mirror | 0.9998, 0.9999 / 0.9998, 1.0000 |
| glass smooth ior 1.5, ior 2.4 | 0.9996, 0.9997 |
| **glass rough 0.3** | **0.9231** |

Every material conserves energy to 0.04%, and the NEE-off rows equal their partners: the plastic
coupling, Turquin's metal compensation and the exact Fresnel all hold. Nothing reads above 1.

**Rough glass lost 8% (about 10% on the sphere), far more than masking explains, and it was a
bug.** The interface picked reflection with ps, the Fresnel at the MACRO angle, which is exactly
1 past the critical angle -- so transmission was never sampled there, though tilted facets still
let light out, and the reflection branch carried only F(h). Inside a rough sphere internal rays
soon arrive past the critical angle. A CPU check of one internal bounce at alpha 0.09, ior 1.5:
at 45 degrees the old rule kept 0.793 of the light, the facet-first rule (Walter et al. 2007)
0.976; at 30 and 40 degrees, below critical, both agree (0.988, 0.979). The 2-5% left per grazing
bounce is real single-scatter masking. Expect rough glass close to, and a little under, 1.

**Second run, after the fix:** every other row unchanged (within 0.02%), rough glass **0.9587**,
from 0.9231. A CPU reference -- the same sphere, orthographic, the same facet-first sampling and
G2/G1 weights, maxbounce 40, no bugs to share with the shader -- puts the sphere itself at
0.9468. The sphere covers about 0.78 of the frame, so the renderer's 4.1% in the mean is 5.3%
on the sphere: **it matches the single-scatter model; the remaining loss is the model's**, light
that would scatter between facets and escape. Closing it takes a multiple-scattering
compensation for dielectrics (Kulla-Conty's albedo tables, with transmission), not a fix.
Later runs, at another frame width, read rough glass 0.944, not yet explained: SURFACES.md.


### BSDF parity: sampling and evaluation are one BSDF

Pascal, 1188×969, 32 samples, the floor at 70 degrees from vertical under sun (5-degree disc) and
sky, meanLuma NEE off against NEE on:

| material | NEE on | NEE off | off vs on |
|---|---|---|---|
| Lambertian | 21145 | 20978 | −0.79% |
| plastic 0.3 | 18557 | 18635 | +0.42% |
| metal 0.3 | 3439.7 | 3447.0 | +0.21% |
| metal 0.6 | 7250.3 | 7192.8 | −0.79% |

**The Lambertian pair is the control**: cosine sampling cannot be wrong, so its gap is the
noise. With NEE off the sun is found only when a BSDF sample lands in its disc -- about 50 000
of the 37 M samples here, a standard error near 0.45% -- and every pair sits inside the
control's gap, with mixed signs. No bias. A tighter check needs more samples, not a fix.

### Light against emitter: the presses

`light-vs-emitter` (the table above has what each row is). The steps L0-L7 and the numbered findings
are PLAN.md's (*Lights*).

**First press** (Ampere, 2026-09-29): **finding 1 measured.** `light/emitter` 0.996 on the diffuse
floor, 0.990 in the illuminance view (the light's sensors 0.989 / 1.003 / 1.012 against the closed form,
seMax 0.023), 0.998 at roughness 0.23. Mirror 0.610 and roughness 0.22 0.612: the light's two rows read
the same 90.6 -- its metal floor as black as the mirror -- and jump to 147.8 at 0.23, while the emitter
reads 148.2 at all three: the step the user saw, at LT_MIN_ALPHA. Through the pane **0**: the whole
picture seen through glass is black for a light. Diffuser 0.535. **L3 holds**: the face rows 10 000.0 /
1 706.4 (want 1 706.8) / 0. `emitters` read 0 on every row, the emitter rows too -- so L1 is not yet
shown: the column held the count from each row's first sample (step() never yields, so the readback
landed after the row), and for the same reason the emitter rows ran no emitter photons. Fixed: the count
is read and waited for (`R.readEmitCount`), and a `clearLearned` row first lets discovery rebuild the
list twice.

**Second press** (Ampere, 2026-09-29): **L1 shown** -- `emitters` 4 on every emitter row (the one disc
straddles the discovery grid's centre: four boxes), 0 on every light row; every ratio as in the first
press within the noise, the face rows again exact. The emitter rows now run their photons: 2 s a row
more (3.1-3.4 s to 5.1-5.5), noise 0-11% lower. **L4 built, to press:** every pair 1 -- the light rows
of the mirror, 0.22, pane and diffuser pairs noisier than the rest, the camera's paths finding the lamp
by chance (L7) -- and two closed-form face rows: the lamp in the glass it emits into, seen through the
block's top at Brewster's angle, L T / n^2 = 4 116 (0 before L4; 9 260 without the n^2); a transparent
light with an emissive disc behind it, 20 000 (10 000 if it stops the path). **L4b built, to press:**
the 1 cm lamp's pairs 1 on both sides of the cutoff, and the light rows' `noise` about the same at 0.20
as at 0.25 -- under L4 alone the 0.20 row is the camera finding a 1 cm lamp by chance, the speckle the
user saw as no light at all. The big lamp's pairs stay 1; their light rows may be a little quieter at
0.22 (the camera now shares what it hit easily).

**Third press** (Ampere, 2026-09-29): **L4 holds.** Every pair 1: mirror 1.000 (0.610 before), roughness
0.22 0.999 (0.612), the pane 0.998 (0), the diffuser 0.991 (0.535); the lamp in its glass block 4 190
against L T / n^2 = 4 116 (1.5 sigma), the transparent light 20 000 exactly. The pane's light row the
noisy one, 0.43 against its emitter's 0.14: the floor behind the glass is the camera's, which found the
lamp from it by chance. **L4b:** the 1 cm lamp's light rows' `noise` 0.340 at 0.20 and 0.339 at 0.25 --
no step in the direct reflection. Their ratios, 0.97 and 0.93, said nothing: the lamp's own top face,
9e6 cd/m² over a few pixels, was two thirds of the mean and each pixel's error bar nine times it -- so
those rows now shade that face. The user's jump was still there at 0.223 / 0.224, and was a secondary
reflection: the floor the lamp lit, seen in the reflector, dark below the cutoff -- camera, reflector,
floor, lamp, the camera's alone. **L7 built, to press:** the wall pairs 1 at 0.20 and at 0.25 (before it
the light's 0.20 row found the lamp from the wall only by chance: speckle where the reflected wall
should be, and a mean that usually reads low), with about the same `noise`; the pane's light row about
as quiet as its emitter's; every other number as above.

**Fourth press** (Ampere, 2026-09-29): **L7 holds.** The pane's light row 0.098 `noise` (0.43 before;
its emitter 0.134). The wall in the metal floor, the light: 55.6 at 0.20 and 56.8 at 0.25 -- no step,
and quieter below the cutoff (0.229) than above (0.344). The 1 cm lamp's direct reflection: 91.7 / 91.1,
`noise` 0.167 / 0.162 against its emitter's 0.54 -- light tracing 3x quieter on a small source. Every
other number as in the third press (the block 4 120 against 4 116). **But every 1 cm pair read
0.80-0.84** (0.838, 0.819, 0.803, 0.799), both sides of the cutoff and by either of the light's paths:
finding 7, the march tolerance. At 0.91 mm a 1 cm emissive disc is 1.19x its area face on, 1.22x at the
37 degrees the floor shows it -- 0.82 predicted; the 30 cm disc 0.994, as its diffuse floor and pane
read (0.9946 / 0.9948). The light is the right one: its photons and light sampling start on the disc
itself.

**Fifth press** (Ampere, 1243×1020, 2026-10-02, `Raytracer 0.4.0 · 36aa8d9`): **finding 7 answered, and
the fast modes hold.** The 1 cm pairs at eps 10 um: 0.994 at 0.20 and 0.25, the wall in the metal floor
0.998 / 0.997; at the automatic tolerance 0.822, as predicted. The light rows 4-5x quieter than their
emitters' (`noise` 0.12-0.13 against 0.58-0.59 on the direct reflection). Every other pair as before:
diffuse 0.995, illuminance view 0.989 (the light's sensors 0.972 / 1.008 / 0.983, seMax 0.021), mirror
1.000, 0.22 0.999, 0.23 0.999, pane 0.996, diffuser 0.990; the faces 10 000 / 1 707 (want 1 707) / 0,
in the block 4 113 (want 4 116), transparent 20 000. **New, the fast modes:** Draft 0.9951, and the light
in the Optics view (flat light off) against the emitter in Draft 0.9950 -- the full pair's 0.9953; the
light's meanLuma 129.740 in full, 129.717 in Draft, 129.732 in Optics. So the photons now carry the whole
of a light's direct light in both. How dark Draft read before is still inferred, not measured: the row
did not exist before 0.4.0. Pressed on a build before it, the Draft light row would say.

### The Optics view: first press

`optics-mode` (Ampere, 1243×1020, 64 samples, 2026-10-02, `Raytracer 0.4.0 · 36aa8d9`): a 1000 lm
Lambertian point 0.5 m over the floor, facing down, a grey disc above it; sensors at 0, 0.5 and 1 m
against Φh²/(πd⁴) (1273, 318, 51 lx).

| row | x 0 | x 0.5 | x 1 | seMax |
|---|---|---|---|---|
| full (reported: above 1) | 1.016 | 1.043 | 1.140 | 0.019 |
| Optics, flat light off | 0.994 | 0.995 | 0.999 | 0.019 |
| Optics, flat light 2 stops down (+250 lx in the expected value) | 0.996 | 0.996 | 0.998 | 0.005 |
| Optics, flat light off, mm | 0.997 | 0.993 | 1.023 | 0.018 |
| Optics, illuminance view (traced in full) | 1.015 | 1.054 | 1.104 | 0.019 |

**Answered.** The Optics view's rays light the floor with exactly the direct light and stop there: full
reads more, so the stop is what makes the difference. The flat light's level is right as derived, and
so is the mm scene. The note had predicted full's excess would be largest at x 0. It is largest at
x 1, where the direct light is weakest and the light the disc sends back down, spread wide, is the
largest share. What the view looks like is still the user's to see.

### Russian roulette is unbiased (answered)

32 samples, `autobudget` pinned off:

| case | trimmedLuma | Δ |
|---|---|---|
| RR off, maxbounce 10 | 0.058860 | — |
| RR on,  maxbounce 10 | 0.058779 | −0.14% |
| RR off, maxbounce 40 | 0.058775 | −0.14% |
| RR on,  maxbounce 40 | 0.058770 | −0.15% |

All four arms inside 0.15%, and RR-on-vs-off is the same size as RR-off-vs-RR-off. The
**6–8% brightening that motivated this test does not exist**: it was the adaptive iteration
budget confounding the earlier comparison, exactly as the suspect named in
`core/tracebasics.js` predicted. Rule 1 above is not a hypothetical.

RR nevertheless **stays off by default**, now for a dull reason instead of a worrying one:
`cost-sweep` puts it at +0.9% ms/sample — inside the noise, if anything slower — while rays
flushed fall from 1416 to 360. It does terminate paths earlier; the wavefront just does not
get paid for it.

### Next-event estimation works (answered)

8 samples, 256x256, software adapter — enough to show the mechanism, not the speed:

| case | meanLuma | trimmedLuma | noise |
|---|---|---|---|
| NEE off | 0.135926 | 0.135390 | 0.2562 |
| NEE on | 0.135722 (−0.15%) | 0.135308 | 0.2457 (−4%) |
| NEE off, sun ×20 | 0.151355 | 0.146568 | 0.4254 |
| NEE on, sun ×20 | 0.150748 (−0.40%) | **0.150276** | **0.2723 (−36%)** |

Unbiased: total energy agrees to 0.4% in both pairs. And at a bright sun the noise falls by
36%, which — since variance goes as 1/samples — is about 2.4× fewer samples for the same
picture. At the default sun it is only 4%, because a dim sun means most of the light is sky
and NEE then sampled only the sun. It samples the sky too now, a mixture split by `neeSunPick`
(`tracebasics.js` envSampleDir and envPdf); `nee-split` takes the two halves apart.

**Read the two mean columns together, they are the interesting part.** At sun ×20 the
*trimmed* means differ by 2.5% while the *total* means agree to 0.4%, and the median moves
11%. That is not a bias — it is the effect itself. With NEE off, the sun's energy arrives as
rare spikes that the 0.1% trim throws away; with NEE on the same energy is spread smoothly
and survives trimming. Which is why the `nee` test compares on `meanLuma`: trimming is
precisely what NEE changes, so a trimmed mean would report the improvement as a bias.

### Where the render time goes (first run)

| case | ms/sample | budget | Δ |
|---|---|---|---|
| BASELINE | 14.844 | 24 | — |
| rr on | 14.976 | 24 | +0.9% |
| maxbounce 4 | 15.417 | 18 | **+3.9%** |
| maxiter 128 | 7.842 | 15 | **−47.2%** |
| fastnormals 0 | 63.591 | 23 | +328% |
| autobudget off | 71.839 | 24 | +384% ← **contaminated, see below** |
| spp 2 | 102.868 | 23 | +593% |

Two things to take from it and one not to.

**The marching is the cost, not the iteration count.** `maxbounce 4` removes six wavefront
iterations and leaves the march alone: it is *slower*, by 3.9%. `maxiter 128` removes nine
iterations *and* cuts the march: it halves the frame. Six iterations bought nothing; the
marching bought everything. That directly undercuts the measurement the adaptive budget was
justified by (24→14 iterations, ~95→~170 samples/s), which was taken by lowering `maxiter`
and so could not separate the two. `budget-cost` is the case that settles it, and it has not
been run yet. The mechanism stays on meanwhile — `budget-image` says it is at worst harmless.

**`fastnormals` is not optional.** Turning it off costs 4.3× the entire frame. (So it went, in 0.68.0: the SDF's
own normal is always used where it gives one, and the row is no longer in `cost-sweep`.)

**Do not read the `autobudget off` row.** It ran immediately after `spp 2`, and
`R.ensureBuffers` never shrinks (deliberately — so dragging a window smaller does not churn
allocations), so it inherited ~670 MB of ray buffers and a baseline it never shared. The case
list now puts `spp 2` last for that reason. It is a good illustration of the general hazard:
restoring the uniforms between cases does not restore everything a case changed.

## From the console

`window.RTTESTS` is the bench (`run`, `runAll`, `TESTS`), so a one-off case list needs no edit:

```js
await RTTESTS.run({ id: 'scratch', kind: 'cost', title: 'eps sweep', secs: 4,
    cases: [0.001, 0.003, 0.01].map(v => ({ label: `eps ${v}`, set: { eps: v } })) })
```

The renderer's own debug surface, which the bench is built on and which is worth knowing
independently: `RT.pause()`, `RT.resume()`, `RT.running()`, `RT.step(n)` (resolves when the GPU
has finished, not when the submit was recorded), `RT.set({...})`, `RT.get()`,
`RT.imageStats()`, `RT.clearAccums()`, `RT.budgetOverride`, and `RTSTATS(quiet?)`.

## Without a GPU: the benchmark's static half

`node bench/shaderstats.mjs` (seconds) prints, for every bundled scene -- or with `--bench`
for the benchmark's own frozen copies, the scenes its compile columns time -- what can be measured exactly
without a GPU: each kernel's WGSL text, its size with every call inlined
(`lib/pathtracer/core/wgslgraph.js` says why that is the size a compiler is given), and how many copies of the scene's
`SDF` and `getMaterial2` it holds; and what recording one sample asks of the CPU -- compute passes,
dispatches, uniform copies and their bytes, from the real engine and tinywebgpu over a recording device, and
the JavaScript time on the machine that runs it (compare commits with it, not computers). `--json` for all of
it. `bench/test/wgslgraph.test.mjs` checks the counting. On the Pascal card (the user, 2026-10-02) every kernel
compiled at 8-15 ms per thousand inlined characters, so the inlined size is a forecast of compile time on that
card (`PERFORMANCE_REVIEW.md` §10.3) -- which the compile's progress bar now uses (`core/compileprogress.js`,
checked by `core/test/compileprogress.test.mjs`).

## Headless

There is no headless driver for the bench and deliberately so — a cost number from SwiftShader
is not a cost number. `Q.s = 256` plus a short `samples` makes an image test finish in this
container, which is enough to check that the bench runs and restores state, and nothing more.

## The convergence page (removed in 0.22.6)

**Removed with the user's agreement, as a developer page nothing linked to or checked.** It is in the repository's
history: `git show 9d0f3b5:convergence.html` (0.22.5) restores it, and `depositWGSL`'s `counted`
option, which it used, came out with it. What it was for, kept here in case the question comes back:

`convergence.html` was the one exception to "a row, not a harness", because
the question it answers cannot be asked through a scene: *does the accumulation path converge
at all?* It runs the renderer's own `genrays`, `prog_resolve` and display pass, with the path
replaced by a single draw at a "sun" of known size, so the correct pixel value is exactly 1 and
the error is measured, not eyeballed. It reports **measured / ideal** RMS error: near 1 means the
PRNG, the seeding, the per-dispatch uniforms, the deposit (f32 since the units change, the
same `depositWGSL` the renderer uses) and the EMA are all sound,
and the render's remaining noise is the integrand's variance. A ratio that climbs as samples
grow is a floor, and the page's switches (PRNG, Max Averages, samples per frame, canvas size)
are there to find which part causes it. The old PRNG is one of the switches.

A CPU model of the same chain (seeds, PCG4D, deposit, f32 EMA) holds the ratio at 1.00 out to
10^5 samples, so a ratio above that on hardware is something only the GPU path does.
