# Where the path tracer stands

Written as a handoff. It says what is done, what is **done but unproven**, and what the next
thing should be — in that order, because the middle category is the one that gets forgotten.
**Trimmed 2026-10-02:** what was finished and written up elsewhere, or obsolete, is gone (git history
has it); what stays is what is open, what is built and not yet seen, the decisions with their reasons,
and the measurements no other doc records.

**Surface modifiers** (brushed and turned metal, rust, dust, leather, stone, bump, displacement,
sheen, thin film, hair) have a phased plan of their own: `SURFACES.md`, beside this file -- phases 1,
1b done and measured, 1c and 2 built. **Performance** (compile time on structural edits, render speed,
a browser starved by heavy scenes) has its own too: `PERFORMANCE.md`, in `../docs/`. Each opens with a
STATUS section. **Where the scene should go** (data, rays answered by objects, shading without geometry, and the
order of that work): `ARCHITECTURE.md`, beside this file (2026-10-04). **Media** -- dust in the air, then a volume
photon map, scattering inside materials, an Optics-view beam view -- has its own: `MEDIA.md`, beside this file
(2026-10-16).

## STEP and STL import as shapes — built 2026-10-21 (0.73.0), NOT yet seen

The user (2026-10-21): "Start working on stl and step import. Investigate possibilities to optimize these for
sdf/pathtracing. Eg conversion to primitives with boolean operations if that helps." Built that way. A solid whose faces
lie on planes, cylinders, cones, spheres and tori becomes a group of the builder's presets joined by union, intersect and
subtract; an STL from CAD is fitted back to those surfaces first (`import/`; the whole account, with what was measured
and what is only inferred, is `IMPORT.md` section 11).
- **Proved without a GPU**: on OpenCascade's own parts and its own classification, every point on the right side, the
  formula, its shapes and the scene document never more than the true distance, no seam inside and no skin outside,
  the STL giving back the STEP's surfaces (`import/test/`). check-shaders with naga compiles the Imported parts
  example through every kernel.
- **The user's first file** (an Onshape part, 2026-10-21): "did not convert/import too well". It was 44 shapes in 29
  groups, half under the floor, with the value under its opening falling to 0.38 mm, and holes in it in the picture
  (a plain union group intersected: IMPORT.md 11.3). Now 7 shapes in 2 groups, standing on the floor, agreeing with
  OpenCascade at all 3000 points, and on Dawn with the formula: what the user saw wrong is asked, not yet answered.
- **Found on the way, fixed in 0.76.0**: a union group built by hand inside a subtraction or an intersection was
  folded by codegen, not combined (IMPORT.md 11.3). Such a group is now combined as a union, an array's copies too
  (codegen.js combinedGroups), in codegen and as data; `builder/test/csgshape.gpu.mjs` holds both to the exact CSG
  value on Dawn.
- **Not seen**: the Imported parts example's picture, the user's part re-imported, and what an imported part costs a
  march step. **Tests › imported** times the example against its rounded boxes and lens as one preset
  each (what recognising those patterns would save) and against the floor alone.
- **Next** (IMPORT.md 11.5): that measurement; then pattern recognition or culling inside a part, whichever it points
  to; B-spline faces that are really planes or cylinders; STEP colours. Freeform faces and scans still need the
  distance grid (IMPORT.md sections 3-5, P0), not built.

## Each scene its own camera, exposure and tolerance — built 2026-10-17 (0.66.0), NOT yet seen

The user (2026-10-17): camera settings and exposure "can vary per scene ... the information should belong to the
scenes. Because switching between scenes almost always causes the camera and exposure to be wrong"; collapsible camera
and exposure segments on the scene's row, where they could be flagged animated; and what the surface tolerance does on a
switch. Decided with the user: the whole Exposure group per scene; the tolerance a scene setting; the environment pushed
whole too; no undo step for a camera or an exposure change. And "review every single example scene".

**What was wrong (read in code):** the builder kept a camera per scene beside the documents and put back only the fields
it had (an example's has no field of view, no projection, no lens: those were the last scene's); the exposure was one for
the project; a tolerance typed in the Renderer panel was every scene's; an example named three of its environment's
settings, the rest the last scene's. **The fix:** `doc.view` (`builder/model.js` VIEW), whole when read; written as it
changes into the scene shown (`demo.js` keepView, the renderer's `watchView`); out of the history (`project.js`
historyText); old projects read into it (`adoptViews`). `doc.tolerance`, the scene's, carried as `UB.epsAuto`
(`photometry.js` sceneEps), so the optics trace follows it. The environment pushed whole (`model.js` environmentOf).
The review of the 24 examples (sizes, cameras, tolerances, worked from the files; nothing rendered): Office lighting's
camera stood outside the room, behind its wall; Lighting a room's field was 40 degrees at 1.4 m (65 now); Glass and
liquid's water sits 10 um inside its glass under an 80 um tolerance (2 um now); the parabolic reflector's tolerance was
0.47 mm, set by its 2 m wall (5 um now). Checked without a GPU: model, project, store, scenes, animate, edit tests;
panel, projects, item editor and renderer checks headless. **Not seen on hardware.**

**What to look at** (the user, on hardware): CHANGELOG.md, 0.66.0.

## Dust in the air: a haze box — built 2026-10-16 (0.62.0), seen working by the user

The user (2026-10-16): "dust particles in the air. Should be realistic and a way to visualise rays", perhaps only in a
box "so it does not add scattering in transparent materials". Decided with the user: a haze box node, physical dust in
the full renderer first, real units. How it works: `lib/pathtracer/README.md` § *Dust in the air*; the phases after it:
`MEDIA.md`. Checked without a GPU (`haze.test.mjs`, `hazebox.test.mjs`, build.test, check-shaders with naga) and on
Dawn over lavapipe (`haze.gpu.mjs`: a furnace, sunlit dust against the integral, the splits). **Seen on hardware** by the
user, in pictures of several scenes (2026-10-16). The `haze` bench row's first press looked at sky (its camera had no
target; 0.62.1). Its second press found 0.04 % of the dust's light lost (a collision placed inside the sphere when a
leg had escaped to the 400 m radius); 0.62.2 draws the collision as a leg starts instead. The third press answers the row: the dust with NEE off within 0.002 %
of no box, with NEE on within 0.024 % (docs/TESTING.md).

**What to look at** (the user, on hardware): `MEDIA.md` § *Phase 1*, *What to look at* -- the example *Beam in dusty
air*, Standard and Draft, the box moved and stretched live, and the `haze` bench row pasted back.

## Quality presets, Draft and Sketch, lamps only, the Developer switch — built 2026-10-01, NOT yet seen

The user (2026-10-01): the renderer's settings are "good for development but for users a bit too
much"; presets (high quality, draft, no sun); and a much faster mode for building, where light stops
at diffuse surfaces and reflection and refraction go on. Decided with the user: two fast levels
(Draft: direct light with shadows; Sketch: a fixed light, no shadows), developer settings behind one
switch, "no sun" as a view override that leaves the scene's environment alone. How it works:
`lib/pathtracer/README.md` § *Draft, Sketch and Optics*; what is in the panel: FEATURES.md §1.2 and §1.6.
Checked without a GPU (check-shaders, `quality.test.mjs`, `renderer.check.mjs`); **not seen on hardware.**

**What to look at** (the user, on hardware):
1. The ⚡ button on the view's toolbar: Draft on a sunlit scene -- sharp sun shadows, shade darker than
   full, glass and mirrors still showing what is behind them and what they reflect; the HUD says DRAFT.
   Then Sketch (Renderer panel, Quality): readable shapes, no shadows, settles at once.
2. A lamp-lit scene with lamps only, in Draft: the lamps light it, and a lamp the camera cannot see
   still does after a sample or two (the seek rays).
3. The Renderer panel: what is shown, and the Developer switch at the bottom.
4. Press `render-modes` (Draft rows ratio / vsFull 1, lamps only 0), `draft-lamps` (seek rays off
   about 0) and `render-modes-cost`, and paste them back.

## The Optics view -- built 2026-10-02, its benches hold, the picture NOT yet seen

The user (2026-10-02): a view mode "purely focused on optics raytracing visualisation": every material
flat shaded from the environment as in Sketch, the rays from the light sources calculated, ending at a
diffuse surface or the camera -- no diffuse bounces. Built as the fifth Quality preset, **Optics**
(`renderMode` 3; `lib/pathtracer/README.md` § *Draft, Sketch and Optics*):
- the camera side is Sketch's, its flat light `opticsFlat` stops below Sketch's (Renderer panel, under
  Quality, only in this mode; 0 = Sketch's, -12 = off, -4 to start);
- the builder's lights' photons run (Sketch drops them), connect wherever they land, go on through
  mirrors, glass, gloss and frosted glass, and end at the first diffuse lobe they draw;
- the sun's photons, light sampling and emissive materials' light are off: the rays are the lights'.
Also found on the way (read in code, not measured): Draft lost 1/(1+R) of a light's direct light on a
diffuse surface, the share of the lights' MIS (L4b) kept for a camera path Draft never continues. No
fast mode shares those paths now.

**What to look at** (the user, on hardware):
1. A scene with a light behind a lens or in a reflector (Optics_test_3 LED, RGBW_mixer), Renderer
   panel › Quality › Optics: the shapes flat-lit as in Sketch, the light's spot or beam on the surfaces
   it reaches, sharp-edged, with no glow of bounce light around it; the HUD says OPTICS.
2. Flat light (starts at -4, a guess): towards 0 the shading brightens against the beam; at -12 only
   the light's spots and the light's own face remain. Is -4 the right start?
3. Draft on a scene with a large panel light: its direct light on the floor should now match
   Standard's near the panel (it could read darker before).
4. ~~Press `optics-mode` and `light-vs-emitter`~~ -- **done** (Ampere, 2026-10-02): the Optics view's
   floor 0.994-0.999 of the closed form with its flat light off, full 1.02-1.14 above it; the Draft
   and Optics pairs 0.995, as full's (docs/TESTING.md, Results).

## The scene's radius, new scenes in cm, 1-unit shapes, the tree's double-click -- built 2026-10-02 (0.9.0), NOT yet seen

The user (2026-10-02): the environment radius among the scene's properties, moved out of the Environment;
a new scene 25 cm and in cm; the standard shapes one size, "ideally 1x1"; a double-click on an object in the
tree zooms in on it. Decided with the user: a new scene also starts with the camera close. How it works:
`model.js` (version 15, envRadius), `lib/pathtracer/README.md` § *The scene unit*, `primitives.js` (SIZES),
`builder/focus.js`. Checked without a GPU (check-shaders with naga, `model`, `photometry`, `project`,
`focus`, `codegen.test`; `panel.check`, `tree.check` headless); **not seen on hardware.**

- The radius is the SCENE's (`scene.envRadius`, in its unit; absent = 400 m in any unit, so every old file
  and every createDoc means what it did). Version 14 files: a radius of exactly 400 m in the environment is
  dropped -- every environment copied from the renderer held it -- any other moves to the scene, converted.
  The engine reads it off the scene it has, as the unit (`UB.envRadius` is derived now); `RT.updateScene`
  changes it live, and the builder routes it through `live()` so a value set during a compile is replayed.
- The tree's double-click: TreeView redraws a group's rows on its first click, and Chromium then sends no
  `dblclick` -- `tree.check` caught it; the second click's `detail` 2 is read instead.

**What to look at** (the user, on hardware):
1. + New scene: Scene settings (⚙) say unit cm, environment radius (cm) 25; the camera close; + sphere a
   1 cm sphere about a third of the view high. The sky starts 25 cm out: an infinite plane ends there.
2. Drag the radius below the scene's size: what is beyond it vanishes at once, with no compile; Ctrl+Z puts
   it back. Change the unit: the row's label follows. The Environment folder has no radius row.
3. The + shapes side by side: each about 1 unit across. The modifiers (a repeat's spacing of 2) were sized
   for the old ones and look loose now -- say if they should follow.
4. Double-click a row in the tree: the camera glides to it, still looking the same way; a group framed
   whole; a plane says it has no end and stays. Then a code node whose box was measured (box on).
5. Menger cubes and Demo look exactly as before (their 400 m radius was dropped as the default).

**Followed by 0.9.1:** a 25 cm scene kept the sun's photon square and the emitter search at 15 m -- most sun
photons missed it. Both are capped at the scene's radius now, and an emitter is aimed at with a margin of its
own size instead of 2 cm (L5 below; benches `small-caustic`, `small-emitter`, not pressed).
6. Press `small-caustic` and `small-emitter`, and paste them back: meanLuma (caustic) and the columns
   (emitter) must hold on every row; `conn/photon`, `lt noise` and `seMax` say what the caps bought.

## A tolerance per pixel -- agreed 2026-10-02, the NEXT PR (designed, not built)

The user (2026-10-02), on eps following the scene's size: "imagine a large scene where I get close (zoom in)
on an object at a distance of a few mm or less. So some relation to camera distance as well maybe? Distance
to first object hit? Could mean different eps for different pixels". And "for optical raytracing of light
sources, maybe a higher accuracy is needed". Agreed to build it in a PR of its own, after the one above.

**Built first, in 0.36.0 (2026-10-07), what this rests on** (`lib/pathtracer/PRECISION.md` is the whole of it):
- **The engine works in metres.** The scene's code stays in its unit and meets the engine at one boundary
  (`core/scene_api.js`), held by `core/unitlint.js` in check-shaders. So a per-pixel tolerance is one number in metres,
  whatever the scene's unit.
- **One tolerance function at a point**, `marchTol(p)` (`core/tolerances.js`, generated into `tracebasics.js`): the
  setting (`UB.eps`, m, 0 = auto: `UB.epsAuto`, 1e-4 of the scene's estimated size, at most 1 mm), never under
  **the f32 floor**, 128 x 2^-23 x the point's largest coordinate, taken at every march step. Every other use is a
  multiple of it, listed in `core/tolerances.js` and counted against the code by `core/test/tolerances.test.mjs`. The
  scene's own code gets the same number at the point it is asked about (`SCN_TOL`), so culling margins agree with the
  march. **This is where the per-pixel term goes**: one more term in `marchTol`, and a ray field or ltot
  to carry it, rather than a change at every site.
- **The floor, measured in an f32 emulation (not a GPU):** a normal by differences at a step of K spacings has noise of
  ~150 mrad at K = 4 and ~5 at K = 128; the march itself ended at a single spacing. So the floor is for the normals,
  not for termination -- an earlier line here said a tolerance under ~1e2 ulp stalls the march, and in the emulation it
  did not.
- **Shown:** Render stats › Picture and the Ray marching box's line; `RT.tolerances()`; the row is in µm with a 1 nm
  step (it could not go below 10 µm before).

**The design:**
- **Camera rays**: eps(t) = max(f32 floor at |p|, k · θpx · t), never above the scene tolerance -- θpx the
  angle of one pixel (from `invProjection` and `res.y`; for a parallel view `dimensions / width` and no t),
  t the distance travelled from the camera, k about 1/2. A close-up a few mm off gets microns; far away keeps
  today's. Different per pixel, as asked.
- **Bounces** keep the tolerance their path has reached (it only grows with path length, the ray cone
  widening), and the step off a surface follows the tolerance of the hit it leaves -- one number per ray,
  carried in the ray (a field, or ltot).
- **Shadow rays** take their origin's; **photons, the optics trace and pick** have no pixel: the
  scene-relative tolerance, the optics trace with a finer share of its own (1e-5?), so thin gaps (item 5
  below) stop being jumped. The automatic tolerance's setting becomes that share, shown as such.
- **The automatic tolerance's size estimate over-counts** (read in code, `builder/bounds.js estimateBox`): it pads
  every object by its largest numeric parameter, a curvature radius too, so the RGBW mixer reads 105 mm and gets
  10.5 µm -- 5% of the radius of the 0.4 mm sphere the user saw a pattern on (the likely cause, inferred; 0.36.0's
  changelog asks the user to set 1 µm by hand and say). A per-pixel term makes the estimate matter less; fixing it is
  its own change.

**Risks (inferred):** camera paths and photons see a thin gap or a small source differently (the camera at
microns, a photon at the scene's tolerance), which can bias caustics -- light tracing's class bits rest on
both sides agreeing what a delta path is; finding 7's fattening shrinks for the camera only. Every march
changes (camera, shadow, photons, optics, pick) and must stay one rule. **Benches that judge it:**
`optics-refraction` (its 0.5 mm gap row at the automatic tolerance), `light-vs-emitter` and finding 7's
1 cm lamp pair, `scale`, and the march-step cost rows.

## The three ways light gets found

BSDF sampling, light sampling (NEE + MIS) and light tracing: `lib/pathtracer/README.md` § *How light
gets found*; the builder's lights, which are light-traced, under *Lights: one model* below.

## Path guiding: removed

Shipped correct and never shown to help (the user: *"does not seem to help a lot"*); why, and where it
is in git history: `lib/pathtracer/README.md` § *Path guiding was removed*. `guideExtent` went with
it: light tracing has its own `ltRadius`, so no uniform ends up meaning two things.

## Light tracing: verified, on by default

Photons from the solar disc through delta chains, connected to the camera at the first surface
that scatters them; the camera side drops the disc along exactly that class of paths, and only
along lines a photon could have travelled. Where photons go is learned. See
`lib/pathtracer/README.md` § *Light tracing*. **On by default** (`lt` 1), paired with NEE:
light tracing does the glass, NEE the direct sun.

What the hardware said (Ampere, showcase):
- **The split is exact.** Third `lt` run: meanLuma within 0.03% of the reference on all eight
  rows -- lt off/on, a tiny photon square, learning warm-up and warmed, and NEE off with lt
  off and on. The user saw the caustic in all four NEE × lt combinations once two bugs were
  fixed: the occlusion pass ran only with NEE on (so NEE off lost every connection), and NEE's
  MIS weighted the sun seen through glass to zero (so NEE on lost the caustic with lt off).
- **The map learns.** Connections per photon 0.0087 uniform -> 0.605 warmed (70x more useful
  photons); the busiest 1% of cells took 72% of them. Better than a hand-placed 0.5 square
  (0.349).
- **Image-wide noise cannot see it** in a view where the caustic is a few percent of the
  pixels (0.1597 uniform vs 0.1602 warmed). In an earlier view where it filled more, a
  concentrated square halved the image noise. The bench now also reports `lt noise` -- the
  same measure over only the pixels photons reached -- which is the number that decides how
  much the learning is worth. **Run 5, same frozen region (17.6% of the view):** off 0.534,
  uniform 0.491, learned 0.489; secs 2.8 / 3.1 / 3.8. Light tracing removes its own class's
  noise, and what is left in those pixels is the camera side's sky, direct and indirect
  light -- so -8%, and at 1 photon/pixel the uniform map already delivers enough that
  learning adds nothing but connection rays. Learning should pay in PHOTON BUDGET instead:
  the bench now compares learned and uniform at 0.1 photons/pixel (*Open* item 1: it does).
- With NEE off the caustic is clean and direct sun noisy, as designed: light tracing does not
  take direct sunlight, NEE does it better.

## Emissive surfaces as lights: verified on hardware

Emissive materials on scene geometry are discovered from the paths that hit them, sampled by NEE
with MIS, and start light-tracing photons through random lines (Crofton). See
`lib/pathtracer/README.md` § *Emissive surfaces as lights*. CPU-checked with partial, empty and
overlapping boxes and position-dependent emission; the `emitters` bench on the showcase scene.

**First run (Ampere, showcase, sun and sky off, 8 boxes found): two biases, both fixed.**
Light tracing on read +0.6% over off in both NEE settings -- camera paths were tagged for the
split only while SUN photons existed, so with the sun off the emitter caustics were counted
twice. And the mean rose with NEE's share (off -1.2%, 0.2 -0.9%, 0.5 0, 0.9 +0.5%): NEE
evaluated its own approximation of the BSDF (model 0's GGX for every material, Fresnel at the
light angle) while the path tracer samples another, and MIS is only unbiased when both estimate
the same integrand. NEE now evaluates `bsdfEvalSampled`, the sampler's own expectation -- for
the sun too, so older NEE bench numbers carry that difference.

**Second run: passes.** Every row within 0.25% (lt on/off -0.03%; the share rows -0.23 / +0.11,
inside the NEE-off rows' own scatter). Cost, from the same table as noise^2 x secs: emitter NEE
costs 2.3x per sample and still reaches a given noise 1.4x sooner than NEE off; light tracing
costs +47% per sample and buys nothing here -- this emitter throws little caustic into view, so
most probes and photons are wasted. The image benches now print that ratio as `effic` (time to
equal noise, relative to row 1). Open: make the photon budget follow what photons are worth
(conn/photon is already measured), so light tracing costs little where it cannot help.

**Third run, after the units change and the material review (Pascal, 64 samples): passes.**
Every row within 0.31% of row 1 (lt on/off -0.00%, share 0.2 / 0.9 +0.09 / -0.05%, NEE off
+0.31 / +0.22% inside their own 2x noise). The emitter path agrees with itself under the new
BSDF, whose NEE and sampling now share one exact pdf. Light tracing still costs +66% per sample
here for nothing (5.8 s vs 3.5 s) -- the parked cost item, *To check or review later*.

(An analytic-lamp version was built first and reverted: the user wants the scene's own emissive
surfaces to be the lights, not a second kind of light beside them.)

## Physical light: where it stands, and what comes next

The user's goal: light that is physically correct, emissive surfaces traced through optics and
reflections, and illuminance measured on surfaces.

**Done:** the **units**, verified (cd/m² and lux throughout; `photometry` 0.998–1.000 on every row,
and `emitters` and `lt` held their means through it -- `lib/pathtracer/README.md` § *Units*,
TESTING.md); the **display**, looked at on hardware (tone curves, GPU auto-exposure, compensation,
meter / lock; README § *Units*); the **material review**, verified (below); and along the way `spp`
removed, `moveAverages` (a window kept through a reset; itself removed in 0.74.0), and a reset that replaces the picture
instead of averaging into it.

**Next, in this order** (agreed with the user; pick up from 1):

1. **Luminance under the cursor, with an error bar — built, not yet seen on hardware** (`core/measure.js`;
   README § *Units*, "Every pixel carries an error bar"). **To press:** `error-bar` (seRatio 1 on every
   row), and hover the floor of the photometry scene: the readout should sit near ρE/π and its ± shrink
   as samples accumulate.
2. **An illuminance view — built, not yet seen on hardware** (README § *Units*, "The illuminance view").
   **To press:** `illuminance` (ratio 1 on every row, the floor dark, mirror or glass). **Next in this
   step, not built:** point sensors, and work-plane grids reporting E_min, E_avg and uniformity -- which
   need a plane that is not a visible surface, so they are a separate kernel, not this view.
3. **Known answers for emitters — built, not yet pressed.** `disc-light`: a 10 000 cd/m² disc over a
   floor, read by sensors in the picture at 0 to 1.5 m from its axis against the closed form plus the
   integrated rim, through NEE, BSDF sampling alone, light tracing and the ordinary picture.
   `cosine-law`: a plane tilted towards and away from the sun must read E_sun sin(elevation + tilt).
4. **A realistic camera — the lens built, the rest not.** Depth of field is there since 0.43.0: a thin
   lens, its aperture and focus (`core/lens.js`, `genrays.js`; *The camera's lens*, below). Not built (no
   f-number, shutter, ISO or sensor anywhere in `genrays.js` or the schema; the camera takes a field of
   view, and an aperture in the scene's units): f-number, shutter and ISO giving the EV; sensor size and
   focal length giving the field of view. With the simple/realistic split: one physical engine,
   *simple* controls computing the physical parameters, never a second renderer (`photometry.derive()`
   is already that seam).
5. **Emitter units beyond cd/m² — half there.** Lights take lumens (`builder/lights.js`: `flux`, the
   luminance derived from the area of their sheets). Emissive objects are still cd/m² only -- an SDF
   gives no area to divide by (README § *Units*); *Lights* L8 measures their flux by Crofton lines
   instead. IES profiles: not built.
6. **Deferred material work.** Rough transmission is still sampled and not evaluated, so NEE cannot
   connect through frosted glass (`materials_pbr.js`, rough transmission's "no evaluable BTDF on the
   other side"); a multiple-scattering compensation for rough glass is *C* below. The anisotropy
   tangent is done (SURFACES.md phase 1, `Material2.tangent`).
7. **The performance pass** — PERFORMANCE.md is that pass now; the parked light-tracing cost is in *To
   check or review later*.

**Material review — verified on hardware.** GGX with VNDF sampling and exact pdfs, exact dielectric
Fresnel from the IOR, Kulla–Conty diffuse coupling and multi-scatter metal from tables computed on the
GPU, one delta threshold (`ALPHA_MIN`); `makeDiffuse` a pure Lambertian; `clearcoat` and `model` (never
read) and the throughput clamp at 10 gone (builder document versions 7 and 8). The model:
`lib/pathtracer/README.md` § *Materials*. The presses -- `photometry` from ~0.975 to 0.998–1.000,
`furnace` to 0.04% with rough glass's 0.959 matching a CPU single-scatter reference, `bsdf-parity`
within the Lambertian control's noise: TESTING.md. SURFACES.md (*Open*) has rough glass at 0.987 in
its phase 1 furnace runs and 0.944 in every run since, unexplained.

**Biases still in place**, each for a later step:

- Shadow rays past `shadowcap` are dropped (dark); last-pass shadow rays deposit unoccluded
  (bright); `maxbounce` truncates.
- (TRACE2, the experimental path that turned NEE and light tracing off, was removed in 0.22.2.)

## Optics module: technical ray tracing and luminaire simulation (agreed 2026-09-26)

The user wants optical work in the same tool that renders: build an LED or optic from scene
objects, send light from real or parametric sources, see the rays, measure flux per object and
angular/spatial distributions. Regular rendering must stay as it is. Decisions: first target LED /
luminaire optics; engine in `lib/pathtracer/optics/`, UI as an Optics page beside Builder; IES import
later. How it is built, and why: `lib/pathtracer/optics/README.md`. The UI it now lives in (the user,
2026-09-27: "everything in a single long tweakpane menu is not practical"): UI_PLAN.md §6-7.

**Phases** (each ends with a bench with a known answer; what is built read in code 2026-10-02):
0. Press `error-bar`, `illuminance`, `disc-light`, `cosine-law` (built, unpressed: TESTING.md).
1. **The visual core — built, not yet seen on hardware.** Sources, a ray count, Run in batches, ray
   paths as lines over the picture, flux per object and per material; at the user's request, detectors
   (now a material type), a **steps** slider that retraces N interactions (the same rays each time),
   **Live** while objects move, and an **optical path length** slider. **To press:** `optics-balance`;
   then on the Optics page drag steps, try Live while moving an object with the gizmo, drag the
   path-length slider, and make a material a detector.
2. **Zemax ray files — built** (`optics/zemax.js`; a `rayfile` light, `builder/lights.js`; kept by
   name, `optics/rayfiles.js`), recorded as not yet seen. **Not built:** the ray filters (by source
   position, direction, fate), and the bench -- the OSRAM file in an absorbing sphere puts 0.875 W on
   it -- which is no bench row; `optics/test/zemax.test.mjs` checks the file's header and flux in Node,
   when the sample is present.
3. **Far field and planar detectors** (use cases and requirements: ANALYTICS.md). **Built, not yet
   seen:** the (C, γ) grid from escaping rays or one detector, the polar diagram and I vs γ (bench
   `optics-farfield`, unpressed); the illuminance charts (map with isolux lines, profiles, radial
   profile, encircled flux) from a detector or the far field on a plane. **Not built** (no code for
   them in `lib/pathtracer/optics/` or the page): an isocandela map, a pinned reference run, a
   datasheet overlay, colour against angle (X and Z far-field tallies). Also named next then, status
   not checked: direct axis zoom, the escaping rays.
4. **Emitting objects as sources** -- measured flux, "set lumens", an optional beam-angle profile in
   the renderer. **Not built:** a glowing material on a code shape is an ordinary emitter and cannot be
   an optics source (optics README § *Sources are the scene's lights*). It is *Lights* L8 and L9.
5. **IES / EULUMDAT / CSV export; presets** (LED die, PMMA dome lens, parabolic reflector). **Not
   built:** IES and EULUMDAT export (no such code anywhere). Built since: the far field as CSV
   (`farfield.js` intensityCSV); a library LED die and biconvex PMMA lens
   (`library/items/optics.json`); a parabolic reflector and a dome among the shapes.
6. **IES / LDT import as a source.** Not built.

## Next steps (agreed 2026-09-27, in this order)

All built: tolerances that follow the scene's size (`eps` 0 = auto, `photometry.js` autoEps), the
optics source lighting the picture, the lens object and a simpler Optics page, the detector as a
material role, the measure tool. Why each is as it is: `lib/pathtracer/README.md` § *Units* (the scene
unit, the measure tool) and the optics README (§ *The source lighting the picture* has the first
report of "nothing visible" and its two causes). What is left:
- **To press:** `scale` -- the same glass sphere in m, cm and mm must give the same picture.
  (`optics-light` has passed: *Physical correctness* below.)
- **To look at** (built, recorded as not yet seen): the `lens` shape (sdf.js `Nlens`: diameter, centre
  thickness, two signed radii; the IOR its material's) and its test scene, one PMMA lens imaging a
  2 x 1 mm LED 1.6x onto a screen; the Optics page's one ray count for looking and one in millions for
  an analysis; a **ray limiter** (a material type: stops and records rays like a detector, absent from
  the picture and the pick copy, for cross-sections of a beam); the measure tool's pins (they stick to
  the clicked surface) and rectangle (mean ± error, min, max, U0, CSV), the luminance view, and the
  Optics page's detector map (lux per cell, max / mean / min / U0).

## Physical correctness for LED optics (agreed 2026-09-27)

A review of the trace against what LED-optics work needs (efficiencies, refraction, Fresnel, colour).
What is right: exact unpolarised Fresnel with TIR, Snell, media tracked per ray and probed across
each interface, exact flux bookkeeping. The order agreed, and where each item stands:

1. **Known answers for refraction — passed on hardware** (`optics-refraction`, Pascal, 2026-09-27; the
   numbers, and the thin-gap row's expected failure, in TESTING.md; the gap itself is B5 below).
2. **Colour of the lights — `optics-light` passed on hardware (hue err 1e-7, lux ratios within their
   error bars):** the light's hue now reaches the trace and the picture's photons (it was dropped; a red
   light lit its scene white). The ray view's "light colour" and "light colour × flux" modes are not yet
   seen (A below).
3. **The cheap physics items** -- absorption, a light's reflectance, a light seen through glass,
   thin gaps: *The plan from here* B, with the stratified source pick first.
4. The far field -- done in another session (*Optics module* phase 3).
5. **Colour, the hybrid (agreed 2026-09-27) — built; `optics-colour` passed on hardware** (Pascal;
   single lights exact to 1e-8, mixes within their counting noise: TESTING.md). **Not a wavelength per
   ray:** a white source traced one wavelength at a time is colour noise everywhere. Instead the ray
   keeps its three channels, and a light is given as a chromaticity: `colour by` RGB / CCT + Duv / CIE
   xy (builder/lights.js), carried as its EXACT Rec.709 RGB -- a negative channel outside the gamut --
   so detectors read XYZ back exactly through neutral optics (core/colorimetry.js; the Planckian
   locus is the user's older luminaire tool's, Duv corrected to CIE 1960 uv). A mix's colour noise is
   the random source pick (B1).
   **The picture adds exact colours** (found building the measure tool's colour): each photon was
   clipped to the display gamut before it was added, which shifts a mix of saturated LEDs. Deposits now
   keep a negative channel (only negative luminance is refused), resolve keeps the sign, and the
   display clips once per pixel. optics-light's R+G+B row **passed on hardware** (3999.9 K, du'v' 6e-5
   over the whole frame; its first press, from a 3 x 3 sensor, read 4247 K -- TESTING.md). A pin or
   small area on a mix with little blue converges in lux long before it converges in colour; the area's
   u'v' rms says when it has.
   **Built, not yet seen:** the mixing helper (Optics page, Colour mixing: three of the scene's lights,
   a target CCT + Duv or xy, a total flux; "Set the fluxes" is one undo step, and writes nothing when the
   target is outside their triangle), and colour in the measure tool (pins and area read CCT + Duv or
   xy beside the lux, the area its u'v' spread; the CSV carries them) -- A below.
   Then, if filters or dichroics need it, spectral bands for materials; dispersion optional after that (C).

### The plan from here (agreed 2026-09-27; parked while the user works on other things)

Not started, except B4, which L4 did (*Lights* below). In the order proposed, cheapest and most
consequential for LED-optics numbers first; each item names the bench that decides it, because a
mode nothing exercises is code that has never run.

**A. Still to look at on hardware** (built, never seen): the mixing helper (Optics page, Colour
mixing) in a 3-LED scene; colour in the measure tool's pins and area in the illuminance view; the
Builder's `colour by` panel; the ray view's "light colour" and "light colour × flux" modes (0.2.0). No
code, a look each.

**B. Cheap, in this order.**

1. **Stratified source pick — not built** (still the random draw, `optics/kernels.js:260-263`). A ray
   picks its light by a random draw against the cumulative flux (optics/kernels.js optSourceRay), so
   each LED's share of the rays is itself noisy -- the only reason a mix's colour is noisy
   (optics-colour: ~0.0012 u'v' from ~1650 blue rays). Pick by the ray's id instead, (id + jitter) / N
   against the same cdf: every light gets its exact share, and the colour of a mix is as clean as a
   single light's. Both the trace and the picture's photons call the same function. Bench:
   optics-colour's mix rows drop to ~1e-5.
2. **Absorption inside materials (Beer-Lambert) — built 0.37.0, not yet seen.** A material may have a COLOUR DEPTH
   (`Material2.attenuationDistance`; the builder's "colour depth (mm)", real millimetres): light inside keeps baseColor
   per that depth, and the interface no longer tints. 0 is the old rule, so no saved scene changes. The medium's
   coefficient rides on the Ray in the padding after its first three vec3s (muR/muG/muB) with the ltot it was applied
   up to (absLtot), so the Ray stays 112; set where n is (a transmission, a photon's start), applied where a ray
   arrives (shade, the optics shade) and where a shadow ray deposits (occlusion). The medium beyond rides in the
   Surface: the shade queue item is 256 bytes (240). The trace's balance holds by a tally of its own (`O_VOL`), in
   ABSORBED. Bench: `optics-absorption`. NOT DONE: per-object or per-material volume tallies (the ray does not know
   its medium's object); an optics source emitting into a medium starts with no absorption (its `emitN` has no
   colour) until its first crossing; a patterned material's medium colour is read at the world point.
3. **A reflectance for a light's face — not built** (an opaque face is black: `codegen.js:600`,
   `MATID_BLACK` behind it). Glowing materials end every ray too, so light sent back onto an LED is
   lost. Real packages reflect 50-90%, and a mixing chamber's efficiency is mostly that recycling. A
   light gets a reflectance (diffuse albedo, perhaps specular) that the trace and the photons scatter
   off; the camera's first look still sees its emission. Bench: an integrating sphere with a reflective
   source inside -- arrived = 1 / (1 - rho_wall (1 - share on the source) - ...), set up so the series
   has a closed form.
4. **Seeing a light through its lens — done by L4** (below), for every camera path the photons cannot
   connect, with the n^2 radiance factor; its bench is L0's lamp in a glass block. What a glare or
   luminance assessment of a luminaire through its optic needs.
5. **Thin air gaps — open.** The index beyond a surface is probed 2 x the surface offset away (20 x
   eps; `tracebasics.js` mediumBeyond), and a gap under the offset is jumped -- optics-refraction's 0.5 mm row
   measures it (reads one slab, 0.923, against 0.857). In a 5 cm LED scene at the automatic tolerance
   that is ~0.1 mm, which a die-to-lens gap can be. Fix the probe so it does not depend on the offset
   (probe just past the surface, or take the medium from the SDF's own inside test), and step off a
   surface by less than the nearest other surface. Until then: set the trace's eps by hand. Bench: the
   same row at the automatic tolerance must pass.
   **A light's own start — fixed 2026-10-02 (0.1.1), not yet seen.** Its rays started 2 x the offset off
   its face: 0.211 mm in RGBW_mixer, whose lightguide is 0.200 mm in front of its dies, so they began
   inside the guide and were drawn from there. They start 2 x marchEps off now (kernels.js
   SOURCE_RAY: a ray leaving a flat face only gets farther from it) and are drawn from the face.
   Still open: bounces and the probe. Face light sampling's shadow-ray stop, 2 x the offset short of
   the face (`materials_pbr.js`), is the same kind but must not simply shrink: an arriving ray meets
   the face at about eps / cos, and a smaller stop would shadow it at grazing angles.

**C. When a design needs them.**

- **Spectral, the user's order (2026-10-08): the "looks" method first (RGB channels kept, a spectrum averaged
  per channel), dichroics first, a dispersive prism next; then the physically exact method for the optics
  analysis only (a wavelength per ray from the source's own spectrum, CMFs at the detector), with a true-colour
  map in the Analysis pane.**
  1. **Coatings -- built (0.39.0), not yet seen.** A material's coating replaces its Fresnel: R(λ) from an edge
     (low, high, edge nm, 10-90 % width, the stack's effective index for the blue shift with angle), each channel
     R averaged over its wavelengths (`core/spectral.js`: the CIE 1931 CMFs in Rec.709, clipped, 10 nm bins). Beam
     splitters and AR layers (an R flat in λ) are exact; a dichroic's edge is the approximation. On the faces light
     enters by; the faces it leaves by AR, bare or coated. Bench `optics-coating` and six furnace rows. Not
     covered: a cube beam splitter (an interface between two touching solids -- not checked whether a ray inside
     one stops at a face it shares with the other), polarising splitters (polarisation, below), a rough coating's
     single-scatter loss. Material2 is 96 bytes, the shade item 272: ~2.16 M rays in flight (2.24 M).
  2. **Dispersion -- built (0.40.0), not yet seen.** An Abbe number on a material (ior as n_d; Cauchy through both);
     at the first refraction into a dispersive medium a wavelength is drawn and the ray weighted by that wavelength's
     channel weights (mean 1 per channel, at most 3), refracting with n(λ) from then on; the pick and Fresnel there the
     d line's, so reflections stay white. The wavelength rides in Ray.tag's upper 16 bits (the user's choice: the Ray
     stays 112). Bench `optics-dispersion` (a wedge's per-channel exit angles) and three furnace rows.
  3. **The exact method for the optics trace** -- a source's spectrum (an LED's SPD, Planck, a Zemax file's own
     wavelength: optRays' unused 4th word), watts as watts, X Y Z from the CMFs at the detector, R(λ) and n(λ) per
     ray; and a true-colour detector map.
- **The camera's lens -- built (0.43.0), not yet seen; its photons removed (0.61.0)** (the user, 2026-10-09: "a more
  realistic camera model that has a lens with certain diameter, and that could work in parallel"). A thin lens (aperture,
  focus; `core/lens.js`): depth of field, and connections to a point of its disc. Until 0.61.0 it was also an area a
  photon could pass through -- photons counted light -> delta+ -> D -> delta+ -> lens, the camera left them that class --
  which counted the class only when a photon happened to cross the disc: the specks in the user's picture of
  2026-10-15. The photon map owns that class now, and the lens's photons went with the map on by default. Checked:
  `lens.test.mjs` (camera rays and connections through the lens agree on a toy scene), `lens.gpu.mjs` (genrays, the
  class's steps, a connection through the lens, a hit shaded in prog_shade's phases, on Dawn).
- **The manifold connection -- built (0.44.0), never seen, removed (0.61.0)** (the user, 2026-10-09: "I'd like to try
  the manifold"). A photon landing on a surface inside a medium joined to the camera through ONE refraction, the face's
  point found by Newton (Hanika et al. 2015), in the surface kernel. The photon map gathers that light and the rest of
  the class (two refractions, mirrors), so it went: 12.7k characters of WGSL out of the surface kernel and 16 bytes out
  of every shade-queue item (~2.10 M -> ~2.16 M rays in the ray budget). In git history before 0.61.0
  (`core/manifold.js`, its two tests and its bench) if a one-refraction case ever needs it again.
- **The photon map -- built (0.60.0), seen (2026-10-15), on by default (0.61.0)** (the user, 2026-10-15: a glass slab
  before a lamp, rendered with an aperture, black through the slab but for specks: "I want optics to show realistic light
  of the parts behind it"; asked for SPPM over a two-face manifold; on their card: "this looks really good").
  Probabilistic progressive photon mapping (`core/sppm.js`): a sample's photons first, stored past a delta event where
  they land; its camera rays, past delta events only, gather them there over a radius that shrinks every sample. It owns
  the class in the full renderer, and adds the same in Draft and Optics, whose camera paths end where they gather. 0.61.0:
  on by default; a light no camera path can meet (`ltMis < 0`: collimated, or no face) stored at every surface its
  photons land on and gathered through every lobe; IDLE where no camera ray gathers in a whole sample (a probe every 16
  traces; a new size, mode or scene at once), and not run without photons. Checked: `sppm.test.mjs` (0.9969 and 1.0032 of
  the camera's own sum through a slab with air under it and one lying on the floor, blocks within 3.3 %; a collimated beam
  under a slab 1.0002 of its closed form), `sppm.gpu.mjs` (the whole renderer on lavapipe: the floor through a slab by the
  camera's own paths, the map, through a lens -- each within its error bar; Draft 0.948 of the full picture, the rest
  its bounce light (0.75.1: measured, halving with the floor's albedo); the keep's planned fill and its rare overflow;
  the idle skip), `build.test.mjs` (the idle skip's every rule). Bench `sppm`. Open: what it costs a sample on a card (a
  second wavefront chain) and its memory; the learned photon map credited by gathers; an orthographic camera and the
  illuminance view; dispersive glass, whose camera wavelength and photon wavelength are drawn apart (inferred).
- **Polarisation** -- unpolarised Fresnel per interface is -0.3% on a slab's transmission at 45
  degrees and -3% at 70 (optics-refraction's `vs polar.`). Matters for beam splitters and near
  Brewster. Stokes vector + frame: +28 bytes a ray (112 -> 144), the one item here that costs memory.
- **Rough glass** loses a few % to single-scatter masking (furnace 0.959), booked by the trace as
  ABSORBED by the frosted part -- a textured lens reads a little too inefficient. Multiple-scattering
  compensation for the rough dielectric.
- **Metals** are Schlick from their colour; conductor Fresnel from F0 and an edge tint is cheap.
- **The HUD's cursor readout** shows lux or cd/m^2 only; the pins and area already read colour.

## Every light is defined in the builder (agreed 2026-09-28)

The user's decisions: a material has a TYPE -- **surface**, **source**, **optics detector**, **ray
limiter** -- and shows only that type's settings; the Optics page's own source goes; plane-shaped
source objects (rectangle, disc) and Zemax ray files become builder objects, several per scene; a
point source is not needed. SOURCES ARE TRANSPARENT, so an LED die can sit inside its silicone or
PMMA, which means a source needs the refractive index of what it emits into.

Built in six steps on the optics branch (model versions 11-13); how it works now is in
`lib/pathtracer/optics/README.md` § *Sources are the scene's lights* and § *Zemax ray files*. The
reasons not written there:
- **The index a source emits into is set, not found** (`emitN`, default 1): "auto" would ask the scene
  which material the point is inside, as refraction does (materials_pbr.js THE MEDIA ON EITHER SIDE),
  but the source's own surface is the nearest there, so it would need excluding first.
- **Transparent or opaque** (the user, 2026-09-28): whether light from other sources, and camera rays,
  pass through it or stop there -- an LED die embedded in silicone passes them, a lamp's opaque
  emitting face stops them (what every emitter did, so opaque is the default and the picture did not
  change).
- **Sheet sources are light-traced in the picture**, as the Optics page's source was: as an ordinary
  emitter behind a lens one was orders of magnitude slower (the user, 2026-09-28). That also made the
  planned changes for a transparent emitter unnecessary: a shadow ray summing the sources along it up
  to an opaque surface, and emitter photons whose "first from the far end is exact" argument assumes
  an emitter blocks.

**Merged with main as model version 10.** Main had meanwhile made every shape a code
node (version 9), so the branch's own versions 9--13 collided with it. The user's decision: geometry
follows main's rule (the lens, rectangle and disc are primitive library entries, editable code), and
**lights are an object kind of their own** (`builder/lights.js`: rectangle, disc, ray file), since a
source's shape must stay known for the trace to start rays on it. Everything the branch put on a
source material or a `rayfile` node (flat sources, their properties, ray files) now lives on the light
object (`node.light`); a material's
type is surface, **emitter** (what "source" meant on any other shape: a glowing surface, not
light-traced), detector or limiter. Branch files (9--13) are recognised by what they hold and
converted (model.js `branchToV10`; fixture `builder/test/fixtures/branch-v13-optics-test.json`).
Nothing in this merge had been seen on a GPU when it was made; the `light-vs-emitter` presses of
2026-09-29 have since rendered disc lights through codegen (TESTING.md).

## Lights: one model, light tracing kept (agreed 2026-09-29)

The user's aim: robust, realistic and physically correct, and still a tool for technical ray
tracing. **The constraint:** lights (the builder's light objects) trace orders of magnitude faster
than emissive surfaces for some jobs -- an LED behind a lens, a luminaire behind a diffuser, a
light guide -- and that stays. Nothing below takes a path away from the photons that count it
today, and light tracing stays a light's default.

A review of the three kinds of light -- sun and sky, emissive objects (a material of type
emitter), lights -- found what follows. **By reading and arithmetic only: nothing here has been
seen on a GPU**, except where a press is quoted. L0-L4, L4b and L7 are built (2026-09-29). L0 was
pressed four times that day on an Ampere card: it measured finding 1, and showed L1, L3, L4, L4b
and L7 (TESTING.md, `light-vs-emitter`) -- and, in the fourth, finding 7, which nothing fixes yet. L2
was superseded by main's own; L5, L6, L8 and L9 are not started.
**Merged with main on 2026-10-01**, changing main as little as it could (the user): the tolerance rule
and the bench-camera fix taken out first, main's ways kept where it had them. Under main's fast modes
(Draft, Sketch) L7's light sample is Draft's -- weight 1 over the evaluable lobes, as the emitter and
environment samples beside it -- and main's Draft seek rays, which list any emitter they meet, pass a
light's face by (L1). A scene without lights compiles to main's text exactly.

### What is wrong now

1. **Some of a light's light was counted by nothing** -- fixed by L4, made clean by L4b and L7. L0
   measured it first: for a light, the reflections in a mirror floor and in a metal floor below
   `LT_MIN_ALPHA` (roughness 0.224) were black, the whole scene seen through a clear pane was black, and
   a diffuser read 0.535 of the emitter's picture (TESTING.md, `light-vs-emitter`, first press). What a light still cannot reach, or reaches
   only by chance: optics README § *The source lighting the picture*, "Through a mirror or glass".
2. **A light's face showed its on-axis luminance in every direction** -- fixed by L3.
3. **A light's face that the camera saw was discovered as an emitter**, taking NEE samples and photons
   for nothing (unbiased: time and noise only) -- fixed by L1.
4. **With the sun off, light tracing still sent a photon a pixel, each with zero flux** -- fixed on main
   (L2, superseded).
5. **Emissive objects and the sun's photon map are sized for rooms.** Only `eps` follows the scene
   (`photometry.js` autoEps). **0.9.1 (not pressed): the margin follows `offsetEps`, the grid and the photon
   square the scene's radius (L5 below)** -- what is left of this finding is the inside of a sphere, below.
   - The emitter sphere's margin is a fixed 2 cm (`wavefront.js:576`, `0.02 / UB.sceneUnit`), set
     when every tolerance was a fixed length. For a 2 x 1 x 0.1 mm die, 26 % of probe lines hit it
     through a tight sphere and 0.08 % through today's (Cauchy: mean projected area A/4 over
     pi r^2) -- 325x; NEE from above lands on it 46 % against 0.14 %.
   - No emitter NEE runs from inside a box's sphere (`materials_pbr.js:720` samples only from outside,
     `tracebasics.js:838` emitConePdf skips the box), so nothing within 2 cm of an emitter -- an LED's
     package, reflector, lens -- gets light sampling towards it.
   - Discovery is a 16^3 grid over +-`emitRadius` (15 m; the GUI's minimum is 1 m;
     `uniforms.schema.js:83`): 1.9 m voxels, every emitter of an optic in one box. The sun's photon
     square (`ltRadius`, 15 m, `uniforms.schema.js:78`) has 234 mm cells; a 1 cm lens is a small part
     of one.
   - Discovery needs a camera path to hit the emitter: a die facing away or behind a lens is found
     late, and fades from the list when the hits stop.

   Probably much of why a die as an emissive object behind a lens was "orders of magnitude slower"
   than as a light (`optics/README.md`).
6. **Emitter NEE keeps half its samples for a black environment.** `neeSunPick` is derived to 0
   without a sun (`photometry.js:167`); `neeEmitShare` is not (schema default 0.5,
   `uniforms.schema.js:86`). Lamps only sets it to 0.95 (`quality.js` effective); a scene that is
   simply dark does not get that.
7. **The march tolerance makes every surface fatter by `eps`, and a small emitter brighter with it**
   (the fourth press, 2026-09-29; not fixed here. Way (a) below was built on 2026-09-29 and taken out
   again on 2026-10-01: the user has ideas of their own for tolerances and takes them up in a thread
   of their own, and wanted this branch to change main as little as it can). The march takes a hit
   when the distance is under `marchEps` (`wavefront.js`, `ea < eps`): 1e-4 of the scene's size,
   at most 1 mm -- 0.91 mm on the bench. So a ray passing that close to a surface meets it: to a
   camera path, a shadow ray and an emitter probe alike, every surface is `eps` bigger all round.
   An emitter's light grows with its apparent area: a disc of radius R, seen th off its axis, puts
   out (pi R^2 cos th + eps x its outline + pi eps^2) / (pi R^2 cos th) of what it should -- 1.19 face
   on for R = 1 cm, 1.22 at 37 degrees; 1.006 for R = 30 cm. Measured: the 1 cm lamp's four pairs
   0.838 / 0.819 / 0.803 / 0.799 against 0.82 predicted (and every one of the four the same, both
   sides of the cutoff, both light paths); the 30 cm disc's diffuse floor and pane 0.9946 / 0.9948
   against 0.994 -- the hair every big pair read under 1 since the first press. The mirror reads
   1.000 and 0.22 / 0.23 0.998 / 0.999: nearly all of those pictures is the camera's on both
   sides (the face seen, and seen in the floor), equally fat.
   - A LIGHT is right where it lights things -- its photons and light sampling (L7) start on the
     exact face -- and fat only where a camera path meets its face: a 1 cm die glows over 1.2x its
     area in the picture. An EMISSIVE OBJECT is fat for everything it lights.
   - A 1 mm die in a room-sized scene has eps as big as itself: as an emissive object it puts out
     several times its light.
   - Ways out: (a) cap the automatic tolerance by a share of the smallest light or emitter, which
     codegen knows (eps <= R / 200 for 1 %) -- cheap to write, costs march steps in the scenes that
     have one, and meets f32 near a millimetre die in a room (finite-difference normals use the same
     eps); (b) exact hits: under eps, go on at a finer tolerance and keep the hit only if the ray
     reaches the surface -- every surface exact, a few steps a hit, a change to every march (camera,
     shadow, photons, optics) that must stay the same in all of them; (c) leave it and say so: a
     source smaller than ~100 eps should be a light.
   - The bench runs the 1 cm lamp's pairs at eps 10 um (0.2 %) so they press the estimators, and
     keeps one pair at the automatic tolerance, reading about 0.82, as this finding's marker.

### The one light model

Every emitter, a light object or an emissive material, is one thing: a surface with an emission
(flux or luminance, colour, distribution, faces, the index it emits into, later a reflectance),
found by all three strategies and split so that every path is counted once. Only two things
differ per emitter:
- **How a point on it is sampled**: exactly on a known shape (rectangle, disc, more later), or on
  any SDF shape through its measured box by Crofton lines (`probeProcess`), which is exact for any
  shape.
- **Which strategy owns the paths both could count** -- a switch per emitter. Both settings are
  exact, so it moves the noise and never the brightness:
  - **light-traced** (a light's default, what lights do now): photons walk through every event and
    own every path whose first surface seen by the camera scatters by a lobe a connection
    evaluates; camera paths own the rest. Best inside a housing, behind a lens or a diffuser, in a
    light guide -- the "orders of magnitude" case.
  - **camera-sampled** (an emissive material's default, what they do now): camera paths with light
    sampling own everything except "emitter, then glass or mirrors, then the first diffuse
    surface", which the photons own. Best for an emitter in the open, lighting what the camera sees.

Pure light tracing stays only for what no camera path can hit: collimated lights and ray files.

**Why not mesh the emissive objects** (the export mesher, `builder/mesh.js`; asked 2026-09-29): the
camera sees the SDF, so NEE and MIS would need the mesh's density wherever a ray crosses it -- a
triangle BVH in `prog_shade`, which already uses its 8 storage bindings; the exporter meshes the
scene's field, in which a die inside silicone has no surface of its own; cells lose thin features
(a 0.1 mm die at 0.4 mm cells) and bevel edges. And what a mesh would give already exists,
exactly: `builder/boxes.js` measures every object's box on the GPU (a die in its silicone
included, live as `window.BOXES`), and Crofton lines give the surface, the flux and any non-delta
distribution. A mesh remains an option as a proposal for narrow beams on odd shapes, if that need
ever appears.

### In this order

L0-L6 are small (L0 and L4 the largest of them), L7-L9 are the model. Each says what it rests on
and the bench that decides it. The built ones say what and why; how the code does it is in
`lib/pathtracer/README.md` § *Light tracing* and the optics README, and every press's numbers are in
TESTING.md's `light-vs-emitter` entry.

**L0. The bench first: a light against the same emissive object.** One two-sided Lambertian disc
of luminance L, once a light and once an emissive object (a disc code node with an emitter
material), over a diffuse floor (both must meet the closed form, as `disc-light` does, less its
rim), a mirror floor, a metal floor either side of `LT_MIN_ALPHA` (roughness 0.22 and 0.23: a metal
has the glossy lobe alone, so the gap is as large as it gets), the scene seen through a clear pane,
and a rough-glass diffuser in front of the disc. meanLuma must agree row by row. The light must come
through codegen's own face rule and the optics photon source -- a hand-written copy of the face rule
would only test itself -- and `lib/` may not import `projects/`, so the host builds the scene
(`builder/lightbench.js`) and hands it to the bench. **Built; pressed 2026-09-29 (Ampere):** the gap
as predicted, and larger at the pane (first press). The harness gained what the row needed: a host's
rows, the row's own statistics in `extra.read`, `clearLearned`, a test camera about the origin
(TESTING.md, *Writing a test*).

**L1. Light faces out of emitter discovery** (finding 3). `Material2.lightTraced`, set by codegen on
every variant of a face (`makeDefaultMaterial` and `mixMaterials`, the only positional constructors,
leave it 0); the emissive branch skips `emitDeposit`, the emitter-photon handover and the MIS weight
for it. Weight 1, because `emitConePdf` counts every box whose cone holds the direction, an emissive
object's box can hold a face, and NEE's shadow ray sees the face black: the weights would stop
summing to one. Needed by L4. **Built; shown by the second press (2026-09-29):** `emitters` 4 on every
emitter row, 0 on every light row. The first press's 0 everywhere was a stale CPU count, which is why
the bench now reads `R.readEmitCount` (TESTING.md).

**L2. No sun photons without a sun** (finding 4). **Superseded (2026-10-01):** main made the same
change on its own (PR #35, raytrace_main.js "NOTHING TO SEND PHOTONS FROM"), and the merge kept main's.

**L3. A light's face shows its distribution** (finding 2). The face's luminance times the
distribution's shape -- cos^(n-1) for cosine, 1/cos for uniform, 0 outside the half angle -- from the
face's normal and the ray (codegen `lightBeam`; the face rule is `codegen.js:558-611`), from a
`beam_<id>` uniform per face (lights.js `beamOf`) pushed live with the colour and luminance, so an
edited distribution needs no compile. A collimated light keeps the Lambertian luminance of its flux:
a display convention. The face's JS twin, `beamShape`, is integrated against `fluxFactor` in
model.test, so the face shows exactly the flux the photons carry -- the camera side and the photons
must agree about the light, which L4 needs. **Built; pressed 2026-09-29, holds** (the face rows). **To
look at:** the `Optics_test_3 LED` dies from the side -- dark outside their 7.5-degree cone.

**L4. Lights counted where their photons cannot connect: the first-surface split** (finding 1;
stage 1 of the model). A camera path whose first surface scattered by a lobe a connection evaluates
(`EV_EVAL`: diffuse, gloss from `LT_MIN_ALPHA` up), in air -- the connection needs that too
(`ltConnect`) -- in a frame that runs the lights' photons (`UB.ltLights`, 1 when `R.extraPhotons > 0`)
is the photons', and carries `CLS_LIGHTS` (1024; main's TAG_SEEK took 512). Any other first event -- a
mirror, smooth or rough refraction, gloss below `LT_MIN_ALPHA` -- makes it the camera path's, and it
counts a light's face wherever it meets it. Exact: a connection only ever estimates the `EV_EVAL` part
of the first surface's BSDF (`ltConnect` evaluates it as `lobesEval` from `LT_MIN_ALPHA` up, once through a helper `ltEvalBsdf` -- the correspondence
the sun's split rests on, `CLS_CAND`), so every path has one owner. Nothing the photons counted moved to
the camera, so nothing that was fast got slower. In a frame without the lights' photons (a kernel
compiling, the ray cap) the camera side counts lights on every path: a noisy picture instead of a dark
one. A transparent face (`lightTraced` 2) adds its glow and lets the path through, at the first look
too. **The glow is over n^2** of the medium the path meets it in: a face's luminance is its radiance in
what it emits into (`syncSources`: flux / (k A), no emitN), what crosses into air is radiance over n^2,
and the refraction weights carry no n^2 -- right for photons, harmless when both ends of a path are in
air. Without it a die in silicone seen through its dome would read twice its luminance. This is B4 of
*The plan from here*, done for every path the photons cannot connect, not only delta chains.
**Built; pressed 2026-09-29, holds** (third press): every pair 1, the lamp in a glass block it emits
into against L T / n^2, a transparent lamp over an emissive disc at 2 L.
The same n^2 question stands for EMISSIVE OBJECTS in glass, by reading and not yet measured: their
camera side shows L T, while their photons start in the emitter's medium with flux L / (probes x line
density) (tracebasics.js probeProcess) -- L taken as a radiance in that medium -- so the two disagree
by n^2 there. L8's.

**L4b. A light's direct paths shared by MIS** (added 2026-09-29, after L4). The user, on a metal
reflector lit by a light: at roughness 0 a sharp reflection and nothing from the reflector to the
camera, at 0.225 the same, at 0.227 a glow -- the jump L4 was meant to remove. L4 made the mean right
and not the picture: below `LT_MIN_ALPHA` the camera's path owns the reflection and finds a small
light by chance, which at 64 samples a pixel is black with a rare speck; above it the photons own it
and it is smooth. Which strategy is better for a DIRECT path -- camera, first surface x1, a light's
face y, nothing between -- depends on the light's size against the lobe's width: a die in a narrow
lobe is the photons', a panel in it the camera's (a photon from its far edge landing in the lobe is a
firefly). So the balance heuristic chooses per path; the ratio of the densities and how it is carried
are in README § *Light tracing*. The parts: `Ray.ltMis`, the last four bytes of the padding (the Ray
stays 112); `ltLightFlux`, the lights' flux per photon, set only when one such source runs -- with
two, 0, and both sides keep L4's split, reading the same number so they cannot disagree about whether
to share; `camFootprint`, one copy for `ltConnect` and the camera's half. A source no camera path can
meet -- no face, or COLLIMATED -- marks its photons -1: they evaluate every lobe at every surface,
since nothing else counts that light; and a collimated face no longer glows past the first hit (L4 had
let camera paths count its Lambertian-equivalent display glow in mirrors and glass, which is no light
at all). Indirect paths keep L4's split.
**Built; pressed 2026-09-29** (third press): the light rows' `noise` the same at 0.20 and 0.25 -- the
step is gone from the direct reflection. (Their ratios said nothing: the lamp's own top face dominated
the mean, so those rows now shade it from the camera.) And the user's jump was still there, at 0.223 /
0.224, and was not this at all: "it is actually a secondary reflection -- above 0.224 I suddenly see
the scattered light on the floor, reflected in the reflector". Camera, reflector, floor, light: below
the cutoff the camera's alone, which found a small light from the floor by chance. L7.

**L5. The emitter search and the sun's photon square follow the scene** (finding 5). **Built in part,
2026-10-02 (0.9.1), not pressed:** both capped at the SCENE'S RADIUS, which each scene now has (`ltHalf`,
`emitHalf`; `photometry.js` photonHalf), and the margin from `offsetEps` (`emitMargin` 0 = auto). Not the
box: the radius is what the user sets and nothing lies beyond it, so the cap loses nothing; the box below
would be tighter still. Bench: `small-caustic`, `small-emitter` (the disc light in cm) -- not disc-light in
mm, as planned, so the 2 cm row and the radius rows sit side by side. What was planned: the margin
from `offsetEps` instead of 0.02 m: the hits are within marchEps of the surface, and the
quantisation term stays. `emitRadius` and `ltRadius` automatic from the scene's box -- its farthest
corner from the origin, since the grid and the square are centred there; `scene.extent` is only
the box's diagonal (`builder/bounds.js` sceneExtent) and says nothing about where the scene is --
and never above the setting, today's 15 m, so a room renders as before (autoEps's rule). The box
is an estimate: an object outside it is still counted, only not aimed at. Bench: `disc-light` in
mm (it runs in metres only): NEE, BSDF alone and light tracing against the closed form, and their
noise at equal samples says what the margin cost.

**L6. `neeEmitShare` derived like `neeSunPick`** (finding 6): 0.95 when the environment is black,
judged from the settings (no sun, no sky, no studio light, no uniform environment) and not from
`skyScale`, which is 0 until the sky has been measured. The `emitters` bench runs in a black
environment, so its share rows would all read the derived value: give them a dim sky, or they
measure nothing.

**L7. Light sampling towards light faces, on the camera's paths** (stage 2). **Built 2026-09-29
(pulled forward by the user's reflector); pressed that day, holds** (fourth press): the pane's light
row as quiet as its emitter's -- the floor behind the glass now aims at the lamp -- and the wall seen
in the metal floor, the user's case, with no step and quieter below the cutoff than above, where the
photons carry it. Its pairs' ratios, 0.80, are finding 7 (the emitter is fat), not this: the light's
two sides agree with each other. How it works -- the faces as the scene's own WGSL (codegen
`emitLightFaces`), `FACE_NEE_SHARE`, the `TAG_FNEE` shadow ray, the power heuristic: README § *Light
tracing*, "The camera's own paths aim at a light's face".
- CODE LINEAR IN THE NUMBER OF LIGHTS. The first version weighed a face's hit inside each face's
  case of `getMaterial2`, by functions that loop over `lightFace` -- a switch composing every
  light's frame -- and picked a face by the same loop. A GPU compiler inlines all of it: some 3 K^2
  frame compositions in every copy of `getMaterial2` (K^3 if it unrolls the loops), ~34 000 lines
  of it at 32 lights, in every kernel that asks for a material. Now each case hands its material and
  index to one weight after the switch, the sum of the weights and the pick are one line a light,
  and a face is fetched once (codegen.test: as many calls with 8 lights as with 2).
- **Not done, from the plan as first written:** light sampling at the camera's first surface while
  photons run -- of the lobes the photons do not own only (`lobesEval(.., 0)` minus `lobesEval(..,
  LT_MIN_ALPHA)`, against those lobes' own pick density), which needs a three-way weight with L4b;
  through glass (its shadow ray stops at any surface, so a die inside its dome is still found by
  chance from outside); a rectangle sampled as a spherical rectangle (Ureña et al. 2013) -- a point is
  uniform on a face now; and `bsdf-parity` lit by a light, face NEE on and off.

**L8. Emissive objects as full lights** (stage 3). Their list from `builder/boxes.js` (objects with
an emitter material; world spheres from `B.corners`), discovery kept only for scenes the builder
did not make. Their flux measured by Crofton lines -- the flux leaving the object, exact on any
shape -- so an emissive object can be set in lumens. Distributions by weighting each Crofton photon
by the radiance's shape: exact for any shape and any non-delta distribution, because an emitter
absorbs what it emits into itself; collimated stays a flat known shape's. The light-traced strategy
for them (their Crofton photons walk through everything and connect at every `EV_EVAL` surface; the
camera owns L4's other class). And emissive objects as optics-trace sources: probes through the
trace's march (`prog_opt_shade` handling `TAG_PROBE` with `probeProcess`, reading the measured
list, not the picture's discovered one), each ray's flux over the probes SENT, not the rays that
found the object (about a quarter find a die in its tight box). Bench: an emissive die,
light-traced, against the same rectangle as a light -- flux, spot, far field; `disc-light` in
lumens.

**L9. One parameter set, and the switch** (stage 4). A light's settings -- flux or luminance,
colour by RGB, CCT or xy, distribution, faces, `emitN`, strategy -- on emissive materials too (what
"an emissive object gets more parameters" means), and camera-sampled available for lights: photons
then only through glass and mirrors, L7's light sampling for the rest -- quieter for a panel light
in a room. Defaults unchanged: light-traced for lights, camera-sampled for emissive materials.
Bench: every L0 row with both strategies on both kinds; meanLuma may not move.

**Later, named, not ordered:** more exact shapes (a die as a box that emits from its sides, a
sphere, a cylinder, a dome) -- exact sampling where Crofton cannot give a narrow beam; a
reflectance for emitting surfaces, both kinds (B3 above); a learned emission map for a light's
photons, as the sun has (70x more useful photons there); SPPM for what no strategy here does well,
light-guide dots and a spot seen through glass (open item 3).

## To check or review later

Found along the way, parked on purpose. Each says what is known and what would settle it.

- **Light tracing with the learned map costs a fixed ~60 ms per sample** (Pascal, 1188×969,
  `frame-cost`, second run): learned map 82 ms at 1 photon/px and **80 ms at 0.1 photons/px**,
  uniform map 18.5 ms, light tracing off 8.4 ms. Ten times fewer photons and connections cost
  the same, so it is not per-photon or per-connection work -- which also argues against the
  first suspect, contention on the f32 compare-and-swap splat (that would scale with
  connections). Ruled out by reading: `prog_lt_build` (microseconds), host-side work per
  frame. **What settles it:** the same scene and view on `main` (integer splat add), HUD
  ms/sample with lt learned / ltLearn 0 / lt off. Main about the same -> older than the units
  change, in how the learned map's photons behave (long delta walks onto the glass?); main
  ~20 ms -> the units change, and the next step is a bench switch that puts the integer splat
  add back for an A/B. The user is doing a performance pass later; this goes into it (PERFORMANCE.md
  does not carry it yet).
  **A contradicting data point** (`lt` bench, showcase, after the material review, wall-clock
  `secs` for 32 samples, not GPU timing): learned map 2.7 s at 1 photon/px, **1.6 s at 0.1
  photons/px -- the same as light tracing off (1.6 s)**; uniform 1.8 / 1.5 s. Here the cost
  scales with photons. So the fixed cost may belong to the frame-cost bench's own setup (its
  scene or view, or its pinned lt settings), not to the learned map. Read, not yet tested:
  the two differ in that `lt` pins the sun (100 klx, 3.44 degrees, sky 15 klx) and warms the
  map with a 64-sample pass before any row, while `frame-cost` leaves the sun as the user has
  it (0.53 degrees by default) and times a map still learning. Both pin ltPhotons 1 and leave
  ltRadius at its 15 m default. First test: `frame-cost` with the sun at 3.44 degrees.

## Open, in rough priority order

1. ~~Press `lt` once more~~ **done** (after the material review): every NEE-on row holds the
   mean to 0.08%; in the caustic region lt noise is 0.963 off, 0.380 uniform, 0.160 learned at
   0.1 photons/px, 0.114 learned at 1 -- the learned map reaches equal noise ~40x sooner than
   light tracing off, the uniform map ~6x. 80% of photons go to the busiest 1% of cells; 55%
   of them connect (uniform: 0.37%). The NEE-off pair read -0.84 / -0.67%, about one standard
   error of a 3.44-degree sun found by chance, and probably correlated (same random sequence).
2. ~~Press `emitters`~~ **done**, above.
3. ~~**SPPM**, for what light tracing cannot do: caustics seen through glass or in a mirror.~~ **Built (0.60.0)**, as
   probabilistic progressive photon mapping (C, *The photon map*); seen on the user's card, on by default since 0.61.0. (Transmissive shadow rays,
   which used to be here, are superseded: they removed the shadow without making the caustic.)
4. **`claude/path-regularization` is undecided.** The branch is no longer on origin (checked
   2026-09-24); its two commits are unmerged, and whether they still exist anywhere is for the user
   to say. The bench came back non-monotonic: `off`
   and `0.30` clustered, `0.15` and `0.60` clustered, median moved 18%. Ruled out by reading:
   readfrom parity, NEE/bounce alpha mismatch, uninitialised `rough`, uniform types. A
   6-row repeat test (`off / 0.30 / off / 0.30 / 0.15 / 0.60`) was added to discriminate an
   ordering dependence and **has never been run**. Note that an ordering dependence was
   afterwards *found and fixed* in the bench itself — the guiding histogram was inherited
   between cases — so this is now a live hypothesis rather than a guess.
5. **`nee-split`.** (Figures in the old units; the default sun is now the real one.) NEE is clean at the default sun but 76% brighter at 20×, read in a scene
   carrying its own light. The test exists and localises disc vs sky; no result is recorded here
   (TESTING.md lists it "open — one press").
6. **Scene builder** — working and confirmed on hardware; see *The scene builder* below for
   what exists and what is next.
7. **`iteration-cost`** — the adaptive budget has never fired in a measurement.

## The scene builder

`builder/`, the **Builder** tab of the raytracer page. Each file's header says what
it is, FEATURES.md §2 what each feature does, BUILDER.md where the builder goes next. The core -- the
document and its operations, transforms, codegen, the probe compile with errors at the user's line and
column, the tree and the panel, apply, save and open -- was recorded here as confirmed working by the
user on real hardware; undo / redo is built since (`history.js`). Format version 15 (model.js
`VERSION`; each version's change is in model.js's header), older files upgraded on load.

**Confirmed on hardware:**
- **A join per child** (2026-09-30; asked: "a group of a, b, c, d: union a, b, c, subtract d"). Format
  version 14 (11–13 skipped: the optics branch's). Version 10 files, and library items and clipboard
  contents saved before (they carry no version), give a group's op to its children on load and compile
  to exactly the shader they did -- `builder/test/fixtures/csg-v10` froze every CSG case, every bundled
  and bench scene, off and live, before the change, and codegen.test holds them to it. A light in a CSG
  group is no longer one of its shapes (it emptied a subtraction it came first in).
- **Live paths** (2026-10-02, after three fixes: a name typed in since the compile now moves the path,
  the caret stays in the text box, a parameter cannot become NaN; asked 2026-10-01: "a separate mode
  where all points are uniforms; once it's finalized switch to compile mode"). Confirmed before the
  slots: since then a change of its chain compiles only past its room (*Live chains in slots*, below). **Not known:** what
  reading the pieces from uniforms costs against literals the compiler can fold -- inferred small, not
  measured.

- **Points drawn in the picture** (2026-10-02, "pretty sweet"; asked: "a tool to draw the paths and sections
  ... interactive, in the main window ... close to the current tools"). The overlay's **Points** mode for an
  object with a path or a profile (`pointsmode.js`; every number decided in `pointedit.js`, pointedit.test):
  arrows along the object's own axes, a name moving its parameter within its range, every step judged against
  every path and profile before it is written, the fillet's diamond, Delete / + / Enter typing entries as
  written, Ctrl to the grid shown, a profile's plane view and back. The path being edited is compiled live
  (`BUILDER.editPoints`). Its numbers and typed entry are in the panel at the top right since the readout panel
  (below). **Not known:** whether the picture follows a drag as smoothly as a Transform drag.
- **Live chains in slots** (2026-10-02, "works, adding points is fast now"; asked: "in points mode, a number of
  extra points are added with some flag that these are empty"). Every live path and profile is written by
  position for its ROOM of points (`core/shapes.js` pathSlotsOf, profileSlotsOf), each slot on or off by a
  uniform; the room is its points, and 8 more while it is edited in the Points mode (`codegen.js` EDIT_SPARE),
  so a corner straightened, a fillet appearing, a point put in or taken out compiles nothing until the room runs
  out. The slotted text with its off slots left out IS the compiled text line for line (codegen.test). **Not
  known:** the GPU cost of a branch per slot and of the spare slots -- not measured.
- **One Transform gizmo, with stretch cubes** (2026-10-02, "works"; asked: "integrate the move and scale tools
  into one. For some elements, scale could be independent for x, y, z axes ... a bit larger so it's easier to
  pick"; the user chose one gizmo with every handle at once, and a stretch by the shape's OWN SIZES over a scale
  per axis). The arrows, squares, centre ring and quarter arcs; a cube on each of the shape's own axes that
  multiplies the parameters its preset names for that axis (`primitives.js` `stretch`, `stretch.js`: a box's
  `size.x`, a cylinder's radius or height), live, within the slider's range, never through zero; a dashed circle
  outside the arrows' heads for uniform scale. Larger handles (arrows 110 px, grab 11). WHY SIZES: the
  transform's scale is uniform on purpose (`transform.js`), and a box made longer by its size stays exact, its
  rounding round. stretch.test, transform.check.
- **The selection's numbers in a panel at the view's top right** (2026-10-02, "works"; asked: "a textual
  indication of the parameters ... a more organized, semi transparent overlay in the upper right corner").
  `readout.js`: position, rotation, scale, the lengths as written (a box's size is its HALF size), the measured
  bounds (≈, along its own axes times every scale above it); while a handle is held what it did and the numbers it
  changed in bold. The Points mode's numbers and typed entry are there too. It lets the mouse through.
  readout.test, transform.check, points.check.
- **The Points mode with the Transform gizmo, every point's legs, Ctrl to the grid in Transform, more shapes that
  stretch** (2026-10-02, "works. make a PR"). The gizmo is one module (`gizmodraw.js`), every part a switch: the
  Points mode draws its arrows, plane squares (two coordinates, the third kept exactly) and centre ring at the
  selected point. A switch on the view's toolbar draws every point's dotted legs, the selected point's twice as
  thick. Ctrl in Transform snaps a move to the Points mode's grid and a size to it in the node's own units, the
  panel saying the step. Stretch cubes on rectangle and disc lights, the export box, the torus, capped torus and
  link. stretch.test, readout.test, pointedit.test, transform.check, points.check.

**Built, NOT yet confirmed on hardware -- what to look at:**

- **A scale and twist per path point** (2026-10-02; asked: "what I would like to have for the tube and sweep formats:
  per-point adjustments / tube: scale, so change diameter per point / sweep: scale (x,y and both) and rotation";
  the user chose more numbers per line, the tube round only, and values that change along a straight and hold round
  a bend). **What changed:**
  - A path point is `x, y, z, fillet, scale x, scale y, twist°`, the last four optional (0, 1, scale x's, 0;
    `core/shapes.js` pathPieces, `expr.js` PATH). No format version: a build before refuses such a point by its
    number (read in code: its resolvePoints took 3 or 4 entries, and `parse` throws on any problem).
  - **The rounded tube** is a round cone per segment and a torus arc per bend (`pdCone`, `pdBend`): exact outside,
    never too deep inside, as with one radius -- one closest point cannot give it once the radius changes.
  - **The sweep and the flat tube** take the slice at p's own place on a segment, `min(sx, sy) g(M^-1 q)`, divided
    by `sqrt(1 + (k rho)^2 + c^2)(1 + c)` and floored at `|q| - e smax`; a bend holds its values, floored the same
    way. Why each part is there, with the numbers that failed without it, is in shapes.js above `swRound`.
  - **Codegen** writes the varying form only for a path whose values are not all the default, or one being edited
    (so the first drag compiles nothing); every other path is the text it was. A live one's values are uniforms
    (`_pv`, 48 bytes a point more).
  - **Points mode**: the section at the selected point, and a second gizmo on it -- a sweep's cubes (scale x along
    N, scale y along B), circle (both) and an arc about the path (twist); a tube's circle (its diameter) alone. A
    value written as a name moves its parameter. Typed entry and the panel take the values. Preset: **twisted bar**.
  - **A live or edited path or profile is a loop** over its slots (`pathWGSL`, `profileWGSL`; asked after the
    user's light guide took 70 s to compile in Points mode, 2026-10-02 -- the user chose the loop over fewer spare
    points). Written slot by slot, the section was copied into every block: 51 places for the light guide with 4
    points and 8 spare, at 5 now whatever the room (codegen.test counts them). Each slot is read by its index through
    a switch, not a const array, and the loop stops at the last slot on. The loop's text, unrolled, is the compiled
    chain line for line (codegen.test). The user then found it only "a bit better": its first bound, `min(count,
    slots)`, told the compiler the loop ran at most `slots` times, and the hypothesis (inferred, not measured) is that
    it was unrolled back into a copy a slot -- tracebasics.js's noUnroll rule exists for exactly that. The bound now
    goes through noUnroll (shapes.test checks every live loop's). **Measured** (the user's machine, entering Points
    mode): the light guide 70 s, then 15.5 s (shade 15.5, occlude 3.2, march 3.0; probe 2.3); the twisted bar 12.0 s.
    **Not known:** which of the two changes gave the larger part (the loop alone was "a bit better", with no
    number); how much of the 15.5 s is the path's own rather than the scene's ten copies in shade (the light guide's
    line in Transform mode would say); whether the loop marches slower than the straight code while editing.
  - **Found on the way, fixed:** a sweep's depth at a sharp corner (or a fillet tighter than the section reaches)
    with a section that does not straddle the path was too deep just inside the face between segment and bend -- a
    step of 40 times the step across it (node, the asymmetric L), so glass could be marched through. The bend now
    counts its end faces as depths there (`swBendEnds` show). Present since the sweep was built.
  **Measured, in node and headless (no GPU):** shapes.test over 3 paths x 4 sets of values x 3 sections: no slope
  over 1 on random pairs, along lines and across every joint face; never too large outside nor too deep inside
  against the slices; the normal its gradient (held to 1e-3 rad; 3e-8 in a probe); the rounded tube exact against
  the union of balls on 7 paths; at worst the bound is 0.068 of the true distance (all three values at once, the
  off-centre L); without the divisor one segment's slope reached 1.79 (a turn along half a unit) and 1.25 (scale x
  1 to 2). codegen.test: the varying live text equals the compiled one, slot for slot; an update equals a fresh
  compile. project.test and points.check: a value dragged or typed while edited compiles nothing. naga compiles
  every kernel with both forms. **Not known:** what the varying form costs per frame -- the divisor makes the
  march's steps shorter near a steep twist or taper (inferred), and each piece works out sines and cosines of its
  twist, twisted or not (read in code). **What to look at:** CHANGELOG 0.8.0's list -- the bent tube given a scale
  on point 2, its circle in Points mode, the twisted bar's turn slider and handles, glass with no stepping
  through, and the frame rate against the light guide.

- **Lock position, lock parameters** (2026-10-02; asked: "objects could use a 'lock position' and 'lock parameters'
  option that prevents accidental changing position/rotation or object size, scale when in edit mode"). Two flags
  on any node but the root (`model.js` setLock, lockOf; true or absent, no format version): position holds the
  position and rotation, parameters the parameters' values and the scale. **Against the hand only**: the gizmo
  draws no handle a lock holds and Points is disabled (`overlay.js`), the panel's rows are disabled with two
  checkboxes above the position (`panel.js`), the tree has a lock beside the eye that locks or opens both
  (`tree.js`), the numbers panel says what is locked (`readout.js`). The timeline, scripts, the Parameters panel
  and undo still change a locked node. Not in the shader (toTree copies neither). **Measured, in node and headless
  (no GPU):** model.test (set, cleared, refused on the root, a stored false refused, the shader text the same,
  kept by a file, a copy and an asset), tree.test, readout.test, transform.check (the handles a lock holds gone, a
  press there moves nothing, a lock arriving mid-drag stops the drag writing), points.check, panel.check,
  tree.check. **What to look at:** the CHANGELOG's 0.6.0 list. **Open:** whether a group's lock should hold its
  children (it does not), and whether the tree's extra column is worth its width.

- **Group code** (BUILDER.md §3; the Modifiers submenu, `modifiers.js`). naga compiles every preset and
  the nested / CSG / p_local combinations in check-shaders; whether they look right, and what a twist
  costs per frame, only the user's card can say.
- **The joins in the tree, and a group's recipe** (`recipe.js`; headless, `tree.check` clicks the marks
  and `panel.check` types a recipe). **What to look at:** the demo's Carved row and its children's marks;
  click a plain group's second child from ∪ to − and see it cut; in a group's recipe, reorder and re-join
  and Ctrl+Enter -- then one Ctrl+Z puts it back.
- **Eight more shapes** (BUILDER.md §6 phase 2). The dome stands on z = 0 and the reflector has its
  focus at the node's origin (the user's choice: an LED placed at a part's origin is where it belongs).
  When the shapes were chosen, a planning check on the CPU refused Quilez's pyramid (too large inside by
  up to half the base, in 15-46% of the solid) and found his parabola's sign flipping in an f32
  emulation near the curve and his capped torus losing 5e-3 at ring 10 -- all three replaced. **Not
  known:** whether the WGSL matches its JS twin, and what any of them costs per frame. **What to look
  at:** each new shape at its default size; every slider through its range, zero included -- no holes,
  no speckles, smooth shading; the dome and the round cone as glass -- no stepping through, no dark rims
  inside; the reflector with a mirror material and a small light at its origin -- a beam along +z; the
  capped torus's angle 0 to 360; the tube's inner radius to 0 -- a solid cylinder.
- **Shapes from points: profiles** (BUILDER.md §6 phase 3). The code reaches a profile through a handle
  (`const outline: u32 = 0u;`), since WGSL cannot pass a function and a node's code goes into the shader
  byte for byte. **Not known:** whether it renders right, and what a profile costs per frame -- every
  piece at every march step, so the Fresnel lens's 14 most of all (inferred). **What to look at:** each
  preset; in the extrusion's outline, change a fillet and Ctrl+Enter -- the corner rounds smoothly, no
  facets; type an outline with crossing edges -- refused by its points, the picture unchanged; the
  Fresnel lens (six rings, focal length 3 in n 1.49) as glass with a light behind it -- rings, and a
  focus somewhere near 3 on the axis (straight facets, so not a sharp one); the revolution from below --
  no seam or skin along the axis.
- **A flexible pyramid, a prism with sides, shapes in groups** (asked 2026-10-01). The pyramid's `{x, y}`
  base and top were the first two-component parameter on a shape, and the live registry read every
  vector as x, y, z -- a timeline track on it would have written z = NaN back -- so it now counts the
  value's own components. **What to look at:** a pyramid with base 1 x 0.5 and top 0.4 x 0.2, then top 0,
  0; drag the base's x and y; the prism's sides from 3 to 4 to 6 -- live, no compile; the three Shapes
  submenus; the library's tag row filtering by primitives, optics, from points.
- **Sweeps along a path** (BUILDER.md §6 phase 4; the user chose the ends a parameter, open paths only,
  and tight bends allowed and made safe per piece). Folding a tight bend's end faces for points within
  the bend changed the distance at 0 of 1.3 million points; they are kept, the argument for leaving them
  out not being a proof. **Not known:** whether it renders right, and what it costs per frame -- about
  2–2.5 cross-sections a point, at most 5–9, is a CPU count from planning, not a GPU time (inferred).
  **What to look at:** the bent tube -- drag radius, switch rounded 0 and 1 (flat and round ends); as
  glass, with a fillet smaller than the radius: no face inside at the bend; the light guide in glass with
  a light at one end -- light carried round the bends, no faces inside at the joints; in a path, take a
  fillet away (a sharp corner) -- a fan, not a gap; type a path that folds back -- refused by its point,
  the picture unchanged.
- **Live profiles** (asked 2026-10-02: "do the same live mode for profiles"). A profile's value is a
  bare list, so whether it is live is its object's, `liveProfiles` -- and `toTree` copies it, or codegen
  would never have seen it. **Not known:** whether it renders right, and the cost of the uniform reads.
  **What to look at:** add `w`, write it into the extrusion's outline, tick live and drag `w` -- no
  "[builder] scene applied"; a revolution with a named radius -- no skin along the axis; the light
  guide's section made live; drag a fillet's name to 0 -- one compile; untick live -- one compile, the
  same picture.
- **One kind of object** (format version 9: every object a code node, `primitives.js`; version 8 files
  compile to the shader they did, codegen.test). Code can put its surface anywhere, so nothing on the CPU
  knows an object's box (`bounds.js` is only the frames the handles need); boxes are measured on the GPU
  since (`boxes.js`). **What to look at:** the Shapes menu, a new box's panel (size, rounding, and its
  code), and that the bundled scenes look exactly as before.

**Export for 3D printing — built, NOT yet seen on hardware or in a slicer** (asked for 2026-09-27:
"something with colour I can use in my Bambu Lab printer"). An **export box** (`exportbox.js`, object
type `export`, from the + menu) marks the part of the scene to print: moved, turned and scaled with
the handles, drawn dashed when selected, nothing in the picture. Its panel exports **3MF with
colour** or **STL**. How: the scene's signed field is sampled on the GPU over a grid fitted to the box
(`lib/pathtracer/core/field.js`, compiled on first export like the pick kernel), cut by the box,
meshed by marching tetrahedra into a closed surface (`mesh.js`), each triangle coloured by the
material's baseColor where it is (material code included), reduced to at most N colours
(k-means), and written as a 3MF whose colour group Bambu Studio's "Standard 3MF" import maps to
filaments (`print.js`). The box's frame is the part's: z up, min corner at the origin, millimetres.
Verified without a GPU: the mesher is closed and outward on spheres, holes, half spaces and
stretched grids; the whole export runs in node against a JavaScript field read through the
kernel's own header (`exportbox.test.mjs`); lib3mf (the 3MF Consortium's reader, strict mode)
opened a written file as manifold and oriented, with the per-triangle colours. **What to look at:**
add an export box around something, Export 3MF, open it in Bambu Studio -- does the colour dialog
appear with the scene's colours, is the part where the box put it, is it solid and the right size.
**Known limits:** thin features below the cell vanish; sharp edges are bevelled by up to a cell (no
feature-preserving mesher); triangle counts are high (about 9 per cell-sized square of surface, measured on
a sphere and a cube -- a 10 cm cube at 0.4 mm cells is about 3 million), there is no decimation
yet; the meshing is JavaScript on the main thread (200^3 cells took 3 s in the container); a floor plane inside the box prints as a
slab; the pick cannot select the box in the picture (it draws nothing), so select it in the tree.

**Live (a uniform write) vs structural (a probe compile, then `setScene`)** (`demo.js` liveValue):
parameters, transforms, a group's blend and a child's own blend, a material's values and its relief's,
a light's colour, luminance and beam, the Environment's settings, a live path's or profile's points,
and -- when the scene keeps
hidden nodes compiled (`liveVisibility`) -- the eye are live; anything else, and anything that changes
the shader text, is structural. Live edits apply only while the builder's scene is showing. A blend
crossing zero is structural, because it switches the group to the CSG path (`codegen.js` isCsg).

**Worth knowing:** `csgNormal` returns no normal unless both children provide one — mixing
a zero normal with a real one warped every sphere-from-box blend, and no step size helped
because the distances were right. PropertyTable's vec3 popup reports through
`binding._onChange`, which only `bindControls()` sets; `panel.js`'s `bind()` works around it
until GUISTUFF stores the `on('change')` handler itself.

## Things that will bite you

`lib/pathtracer/README.md` § *Things that bite* is the list to read before changing anything.
