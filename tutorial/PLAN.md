# ShadyTracer, inside out: the tutorial's plan

*Status 2026-10-18: two rounds written (contents, glossary, chapters 0 to 4 and 12 to 17, eight styles), with 3D
figures where they show more and every figure answering the pointer; each page read by a blank reader and revised from
what it found (`review/REVIEWS.md`). This file is the
plan; `kit/chapters.js` is the contents the pages read, and the two must agree.*

## What it is, and for whom

A tutorial beside the program, not part of it: how ShadyTracer turns shapes and lamps into a picture, explained well
enough that a reader could build a ray tracer or improve this one. It covers the inner workings (rays, signed
distance fields, Monte Carlo, NEE and MIS, materials, dispersion, photon mapping, haze, accuracy) and every trick the
renderer uses to be fast, each with what it costs.

**Audience:** developers at a high-school level. No ray tracing, optics or GPU programming assumed; enough programming
to read JavaScript. Jargon is linked to the glossary or to the chapter that owns it, every time it first appears in a
section.

**Not a user manual.** The in-app Help (`help/`) is for using ShadyTracer; this is for understanding its code.

## How a chapter is built

One page per chapter, the same order every time:

1. **The question**: one line and one picture.
2. **The idea**: plain words and a live figure. Paragraphs marked `data-step` move the figure as they scroll past.
3. **The maths**: a fold-out with the real equation, every term named. A chapter must read fine with it closed.
4. **How ShadyTracer does it**: excerpts of the real code, fetched from the file when the page opens.
5. **Tricks and trade-offs**: each claim stamped *measured* (who, hardware, number, source), *read in code* (a
   citation), or *inferred* (a hypothesis and what would test it), as CLAUDE.md requires of everything here.
6. **What went wrong before**: the bug stories the code's comments tell, which explain why it looks the way it does.
7. **Try it**: things to do in the figures, and in ShadyTracer.
8. **Words from this chapter**: glossary chips; previous and next.

**Reading boxes** sit beside the sections they belong to (`<aside class="refs">`, sources from `kit/reading.js`): where
an idea comes from, and where to go next. Every chapter has at least one. "Where ShadyTracer learned it" is said only
where the code's own comments credit the source (the reading list's `credited`, checked by the test); everything else
is a recommendation, and says so by its wording. A link goes in only once it has been opened and found to be the work
named (`checked`).

A page is **done** only after a blank reader has read it ([`review/README.md`](review/README.md)): a fresh agent that
may see nothing but the page as a reader meets it, says where it got lost, and answers a short quiz. Every finding is
fixed or answered in `review/REVIEWS.md`.

## Rules for authors

- **Figures draw the flat world** (`kit/flatland.js`): a 2D slice, so it can be drawn. Its laws differ from 3D where
  light spreads (1/r, not 1/r²; Lambert is ρ/2, not ρ/π). A function normalised for 3D (Lambert's ρ/π, the HG phase
  function's 1/4π, the photon map's πr²) may be plotted but never put into a flat estimator. Say on the page where a
  formula differs.
- **Flat by default, 3D where the third dimension is the point** (`kit/space.js`, z up as in ShadyTracer). A slice is
  easier to draw, read and drag, so most figures stay flat. A figure goes 3D when the idea lives in depth or in a real
  picture: the screen as a grid of pixels, where a march spends its steps across a whole image, real noise with and
  without NEE, a lobe or a cone of directions, a photon map's cells. Two kinds: **3D drawings** (the pen's lines through
  an orbiting camera: drag to turn) and **3D pictures** (a small CPU renderer, the march kernel's logic in JavaScript,
  blocky on purpose). In 3D the real laws hold (1/d², ρ/π), so the engine's 3D-normalised functions may be used there.
- **Use the engine's own pure-JS functions** where they exist (help/widgets.js, core/spectral.js, colorimetry.js,
  haze.js, sppm.js, lens.js, measure.js, tolerances.js, optics/fresnel.js), never a retyped copy. The test fails if a
  page's imports reach a GPU module.
- **Never paste code.** `<pre data-src="file" data-sym="symbol">` fetches and finds it (`kit/excerpt.js`); `<cite>`
  gives a file:line link. A typed `file.js:123` in a page fails the test. `node tutorial/stamp.mjs` records each
  excerpt's hash once you have re-read it against its text; an excerpt whose code changed is then marked on the page
  and listed by the test.
- **Do not repeat a stale comment.** Read the code the comment describes (e.g. the wavelength rides in 15 bits of the
  tag, not 16; the march loop is no longer unrolled).
- **No numbers without their source.** A speed claim without who and what hardware is inferred, and says so.
- **Let the reader move the shapes.** Where a figure shows distance-field shapes, each can be dragged by a handle at
  its middle (the field, the march, the rooms), so a reader can push two shapes together and watch a blend form.
- **Every style, every figure.** A reader chooses the style (the bar's menu, `kit/styles.js`), so a figure takes its
  colours from roles, never from a value, and is checked in every style and theme (`test/pages.check.mjs`). Within a
  style, no two roles a figure puts side by side (a camera ray and a normal, a lamp's ray and a blocked one) may look
  alike: they differ in colour, or, in a style drawn in one ink (Drafting sheet), in their dashes, and the style's
  description says which.
- **Name what a figure shows.** Every colour a figure uses for a meaning is named in its caption or text the first time
  (orange: found the lamp; dashed: a shadow ray), every handle is said to be draggable, and a step's paragraph says only
  what its screenshot shows. The blank readers' worst findings were all a figure and its text disagreeing.

## The tutorial follows the code

Every change to ShadyTracer includes a review of the tutorial, in the same PR (CLAUDE.md, "The tutorial follows the
code"). `node tutorial/review/affected.mjs` lists the chapters a branch touches: excerpts whose lines changed, citations,
modules a figure runs, and chapters (planned ones too) that are about a changed file, by `code` in `kit/chapters.js`.
Read those sections, fix what no longer holds, re-stamp the excerpts once re-read, and correct this file's line for a
planned chapter. A new file a chapter is about goes into its `code`.

## The toolkit (`kit/`)

| file | what |
|---|---|
| `kit.css`, `styles/*.css`, `styles.js` | layout and components; a style is tokens, a texture and a frame, named in `styles.js` (adding one: its file, its `@import`, its entry), with its own words for its colours (`--say-*`) |
| `page.js` | a page's start: bar, title block, glossary cards, chapter links, excerpts, figures and steps; colour words (`data-say`) rewritten to the style's |
| `figure.js`, `controls.js` | a live figure from a spec: canvas, handles, controls, scroll steps, progressive work |
| `pen.js` | every line, ray, shape, label and glyph, in the style's colours and line character; the pointer (`hover`, `tip`) and the style's colour words (`say`) |
| `plot.js` | small charts in the same ink, read out under the pointer |
| `flatland.js` | the flat world: SDF shapes, sphere tracing, a camera, a path tracer with and without NEE |
| `space.js` | 3D: an orbiting camera for drawings, sphere tracing, a camera, cheap views (steps, normals, sun) and a path tracer with and without NEE |
| `excerpt.js` | finds a symbol in a source file: the page and the test share it |
| `chapters.js`, `glossary.js`, `reading.js` | the contents (with the code each chapter is about), the glossary and the reading list, as data |
| `legend.js` | the key to the figures' colours and lines, on the contents page and every style's card |

## Contents

Status: **draft** = written this round, for judging the direction; everything else is planned. Each line: what the
chapter teaches → its main figure → the code it walks through. *Read:* the sources its reading boxes will name (ids in
`kit/reading.js`; a source not yet in the list is named in words, and goes in once its link is checked).

**Start here**: Contents (the map) · Glossary · **0. How to read this** (draft): a chapter's eight parts, fold-outs,
the figure key, the flat world's 1/r against 3D's 1/r² (a lamp's rays caught by a piece of surface, drag the distance),
excerpts and their stamps of staleness, the three stamps and where a measured number comes from (View › Tests, its
first line), running the app and its tests → version.js, tests.js's result header, check-shaders.mjs's first comment,
the CI's list read from CLAUDE.md. *Read:* rtiow, pbr.

**I. Seeing with rays**
1. **Rays make a picture** (draft): pinhole camera, one ray per pixel, tracing from the eye, shadow rays, the cosine
   law, jitter → genrays.js (the tile grid rounded, not floored).
   *Read:* rtiow, pbr-camera, pbr-sampling.
2. **Shapes as distances** (draft): SDFs, sphere tracing, tolerance, step scale, escape, the Lipschitz rule → the
   march kernel, shapes.js's "exact or safe". *Read:* Inigo Quilez's 2D and 3D distance functions, his smooth minimum,
   distance estimation and interior SDFs (iq-distfunctions2d, iq-distfunctions, iq-smin, iq-distance, iq-interior,
   iq-raymarching); hart1996; keinert2014; iq-normals.
3. **Building and bending shapes** (draft): union, intersection and subtraction, hard and blended; the blend's normal
   and the warped fillet; fold's surface (argmin |d|) and medium (least deep: right for nested solids, a guess for
   overlapping ones); `warp(k)` and the twist's divisor √(1 + c²) against the map's largest stretch
   (c + √(c² + 4)) / 2 (the flat world's swirl, and a 3D plate measured by the test at 1.14); the noise relief raw,
   divided and with its shell, a ray rocking for 300 steps → scene_api.js, modifiers.js, codegen.js combine,
   noise.js. *Read:* iq-distfunctions, iq-interior, iq-fbmsdf, iq-smin.
4. **Which way is up** (draft): the normal as the field's gradient; a shape's own against forward differences (the
   shade kernel's 3 looks) and central ones (the pick's 6), their errors as h and h², a crease; the same differences
   in an f32 emulation, the grain below the floor of 128 spacings and the step's own error above it; fastnormals off
   at 4.3× (measured, Pascal) and why that much is not known → tracebasics.js hitNormal, tolerances.js, sdf.js
   Nsphere, PRECISION.md. *Read:* iq-normals.

**II. What light is**
5. **Measuring light** (draft): flux, intensity, illuminance and luminance; a glowing panel whose pixels read its
   luminance at any distance while the lux at the eye falls as 1/d² (each pixel its covered share, summed against the
   square's exact 4Ls·atan s); the sun by its illuminance and width, its luminance by photometry.js discLuminance, the
   chance a bounce finds it; a white floor's ρE/π against the user's measured rows (TESTING.md, third run); the disc in
   64-bit numbers and one edge (sdf.js inSunDisc); lumens to luminance (builder/lights.js fluxFactor); the old
   unitless sun and the rim's fireflies → photometry.js, sdf.js, builder/lights.js, builder/sources.js. *Read:*
   pbr-radiometry, pbr-radint, wiki-photometry, wiki-lambert.
6. **Colour** (draft): three cones, three numbers; a narrow band or a hot body against the colour-matching functions
   (spectral.js cmf, the fit), its XYZ, xy and exact Rec.709 RGB; the chromaticity diagram with the triangle, the hot
   bodies' line and a point dragged to its CCT, Duv, exact and clipped RGB (colorimetry.js); three LEDs mixed by
   mixToTarget, the user's split 310.5 / 673.0 / 16.5 lm, a target outside the triangle; the negative channel carried
   and the display clipping once (lights.js lightRGB, wavefront.js badDeposit, rendertoscreen.js); the measured
   colour rows; photons once clipped one by one → colorimetry.js, spectral.js, builder/lights.js. *Read:* pbr-color,
   wiki-cie1931, wyman2013, wiki-planckian, krystek1985, wiki-rec709.
7. **From light to pixels** (draft): EV and white at 1.2 × 2^EV; the meter as autoexposure.js runs it (128 log bins,
   the middle 10-90 % averaged, the brightest 5 % within the headroom, black not voting), mirrored and shown on an
   outdoor scene and a lamp-lit room; the six tone curves ported from rendertoscreen.js, grey and coloured ramps
   through them; 8 bits kept linearly against sRGB; a picture kept as light and developed later (measured to the bit);
   the firefly clamp in multiples of white; the old 2.2 multiplier, black voting, the clamp in cd/m² →
   autoexposure.js, rendertoscreen.js, develop.js, photometry.js. *Read:* wiki-ev, khronos-neutral, hable-filmic,
   wiki-tonemapping, wiki-srgb.

**III. What surfaces do**
8. **Diffuse and mirror** (draft): a matte point under a lamp dragged round it, its bounce directions drawn as the
   renderer draws them and its cos θ intensity circle; ρ/π and the cosine draw's weight ρ; a room whose right wall
   becomes a mirror, the lamp seen in it at 0.95 though no shadow ray can find it (flatland.js gains mirrors); the white
   furnace in the flat world, exact on every path at albedo 1, the cap's loss, a black control; makeDiffuse, makeMirror,
   the metal and matte branches of lobesSample, Schlick, ALPHA_MIN; the measured furnace; the 4% coat that made the
   floor a plastic → materials.js, materials_pbr.js. *Read:* pbr-diffuse, pbr-specular, pbr-conductor, rtiow.
9. **Rough and shiny** (draft): microfacets and GGX, a white metal's lobe in the plane of the light, directions drawn
   by visible normals and those lost into the surface; E, the share one reflection keeps, worked out on the renderer's
   warped 32 x 32 grid against the plain grid it replaced (0.97850, the comment's own number) and a fine reference, and
   what a compensated white metal then reads (E_true / E_table); the old density against the true one, 1 straight on,
   0.154 to 1.623 at 60 degrees. The GGX is a teaching mirror of microfacet.js's WGSL, tested against closed forms ->
   microfacet.js, materials_pbr.js. *Read:* pbr-microfacet, heitz2014, dupuy2023, kulla2017, turquin2019.
10. **Glass** (draft): Snell and Fresnel at one interface, from the air and from inside, s, p and the unpolarised
   average the renderer uses, Brewster's angle and total internal reflection; a pane with every bounce counted to
   (1 - R) / (1 + R), the polarised answer beside it, and Beer-Lambert with a colour depth; parallel light through a
   ball to its focus -- all on optics/fresnel.js's own fresnel, refract, slabT and absorbingSlabT; the engine's
   fresnelDielectric, the smooth interface branch, the medium beyond and rayTransmittance; the optics-refraction rows;
   Fresnel from a slider, rough glass past the critical angle, the mirror under water -> optics/fresnel.js,
   materials_pbr.js. *Read:* pbr-specular, wiki-fresnel, wiki-beer, walter2007, rtiow.
11. **Rainbows** (draft): white light through a prism, 31 wavelengths each at its own index (spectral.js cauchyN,
   optics/fresnel.js refract), the flint against BK7 at least deviation; n(lambda) through n_d and V_d with BK7's
   catalogue against it; the wavelength draw and its weights averaging exactly 1, drawn live; a dichroic coat's edge
   moving with the tilt and each channel's reflectance (edgeAt, edgeRGB); the shading kernel's dispersion block; the
   comments' stale bit count, softplus count, red's range and BK7 accuracy; the green reflections of 0.44.1 ->
   spectral.js, materials_pbr.js. *Read:* wiki-dispersion, wiki-abbe, wiki-cauchy, pbr-spectra.

**IV. Path tracing**
12. **Dice and averages** (draft): π from darts with measure.js's error bar, 240 estimates a column against 1/√N,
    resolve's V and S, the old generator's windows against PCG4D's counted exactly (the comment's numbers do not
    follow from its formula: 0.95×–1.83× at 0.0001, not 0.08×–3.2×), seeds, the sun found 50,000 times in 37 M samples.
    *Read:* pbr-montecarlo, finch2009, jarzynski2020 (the hash ShadyTracer's random numbers come from, credited in
    tracebasics.js), oneill-pcg.
13. **Following a path** (draft): one path's throughput β bounce by bounce, the rendering equation in a fold-out; the
    bounce cap's lost light (46/72/95% at caps 1/3/8 for walls of 0.8, less for white ones), a bias; Russian roulette as
    tracebasics.js plays it, off against on (the same average, 4.7 rays a path for 10.0), measured unbiased on Pascal
    and still off, and why; the removed [0, 10] clamp → materials_pbr.js THE BOUNCE, tracebasics.js's cap and roulette,
    flatland.js tracePath (rr, info). *Read:* rtiow, pbr-efficiency, pbr-pathtracer, kajiya1986.
14. **Aim at the light** (draft): next event estimation, shadow rays, choosing among lights, where it cannot help.
    *Read:* rtrest, pbr-lights, pbr-spheres, pbr-pathtracer, veach1997.
15. **Two ways to the light** (draft): Veach's plates in the flat world (four glossy plates, four lamps of equal light,
    lamp points against plate directions against MIS, each exact on average; 13% / 12% / 6% error at 256 samples); the
    two densities and the power heuristic's weights at one point; misWeight, the lamp side and the carried other half;
    weight 1 where aiming could not have found it, the glass ball's plain shadow, glossy plastic lit by chance, the
    first emitter run's bias (Ampere) → tracebasics.js misWeight, materials_pbr.js. *Read:* veach1997 (chapter 9),
    pbr-efficiency, rtrest.
16. **Every glowing thing is a light** (draft): discovery by the paths that hit a glow (a 16 × 16 grid in the flat
    world, the bar behind a wall found by bounces), unbiased from the first sample; Crofton's random lines, crossings
    against perimeters and their cosine spread; the brightness code, linear against log (the comment's "2e-5 of a stop"
    is 4.8e-6 by its own constants); emitConePdf, emitLineDensity; 2.3× a sample and 1.4× sooner (PLAN.md) →
    materials_pbr.js emitDeposit, tracebasics.js LUM_CODE. *Read:* wiki-crofton, pbr-lights, pbr-spheres.
17. **The camera's lens** (draft): the thin lens from the side, its blur by lens.js lensImage against 2R |1/F − 1/D|;
    a 3D picture through the lens (space.js cameraRayLens on lensDisc and lensRay), three balls, the focus and
    aperture the reader's; why the lens was added (light → glass → floor → glass → eye) and what it no longer does
    since 0.61.0; the lens's area cancelling in a connection → lens.js, genrays.js, lib/camera.js. *Read:* rtiow
    (Defocus Blur), pbr-camera.

**V. Light the camera can't find**
18. **Caustics** (draft): a glass ball over a sunlit floor in the flat world, its picture made four ways (the camera's
    paths with NEE, which find the caustic only by chance; light tracing alone; both with ShadyTracer's split; both
    without it, the caustic counted nearly twice); the four kinds of path to the sun and who counts each, the last
    (a caustic seen through glass) nobody's until chapter 19; the learned emission map (hits / emitted, a 20% floor,
    halved each rebuild: 11.7% of photons connect evenly, 61% learned). Kit: flatland.js gains glass, a sun, the
    split and `lightTrace`, tested against the camera's own pictures. -> materials_pbr.js (THE SPLIT, the
    connection), tracebasics.js, wavefront.js (prog_lt_build). *Read:* wiki-caustic, pbr3-pathspace, pbr3-bdpt,
    veach1997.
19. **Photon mapping** (draft): chapter 18's ball with a pane before it, the caustic through the pane missing (9 chance
    finds in 300 samples) and then gathered from the photons stored on the floor; the radius's blur (wide) against its
    noise (narrow); one point's estimate over 300 samples with the radius held (settling on the light averaged over
    2r, 0.623 against the true 0.938 from 400,000 exact rays) and shrinking by Knaus and Zwicker's schedule (r in the
    flat world, r² in 3D), with the convergence argued in a fold-out; the hashed grid (cells 2r, a gather's two cells,
    a collision, the budget's sub-lists right on average over every start). Kit: flatland.js gains `gather`,
    `radiusFlat`, lightTrace's `store` and tracePath's `map`. -> sppm.js (what it is, sppmRadius, the grid, sppmStore,
    the gather's walk, neither full nor cut), raytrace_main.js (sppmGeomFor), wavefront.js (1/n² in a medium).
    *Read:* wiki-photon, pbr3-sppm, knaus2011 (cited by title), wiki-hash.
20. **Dust in the air** (draft): free flight drawn by `haze.js`'s own `hazeCollideJS` in a box, its distances against
    the exponential, and one ray's march stopped where its drawn distance falls and moved back (the user's "move back
    YY"); Henyey–Greenstein by `hgEvalJS` / `hgSampleJS`, its shape and its draws, the flat world's circle version
    beside it; a dark room with a window and a sunbeam in dust, the beam found by the phase function's bounces alone
    (a third of its light after 300 samples, its error bar blind to it) and by aiming at the sun from the air; the
    dust's furnace, its two controls, and the eye turned to the sky reading 1 with no noise, as the first press of the
    bench's haze row did. Kit: flatland.js gains a haze box (`hazeSpan2`, `hazeTr2`, `hazeCollide2`, `phase2`,
    `phaseSample2`, light sampling from the air, shadow rays dimmed), tested against closed forms. -> haze.js (the
    sketch, hazeDraw, hazeArrived/hazeAt, hgSample, mediumNee's weight, hazeShadow, where it is off), tests.js (the
    camera that looked at sky), haze.gpu.mjs (the heavy tail). *Read:* wiki-crepuscular, wiki-beer, pbr3-phase,
    pbr3-volsample, henyey1941 (cited by title).

**VI. The machine**
21. **A GPU for beginners** (draft): 128 rays of a flat scene as lanes in lock-step, each group as long as its slowest
    ray (45% busy in groups of 32, 39% shuffled, 70% in groups of 8); a uniform struct laid out by WGSL's rules in two
    orders (64 and 80 bytes) and ShadyTracer's own UB from `uniforms.schema.js` (108 fields, 752 bytes); the
    workgroups a pass over a picture asks for, flat or one row per y, against 65,535 (the resolve kernel's 2048 × 2048).
    Kit: `kit/gpu.js` mirrors tinywebgpu's packing (the test holds it to makeSchema on a stand-in device). -> tinywebgpu
    (makeCompute, the packing rule), wavefront.js (resolve's 2D), raytrace_main.js (no submission long enough to be
    killed, the ray budget in bytes, nothing to trace with), check-shaders.mjs (the barrier, the empty module), scene_api.js
    (eight storage buffers). *Read:* webgpu-fundamentals, wgsl-spec, gpu-gems-branching.
22. **Wavefront path tracing** (draft): a sunlit room's 1024 paths run as ShadyTracer runs a sample (`kit/wavefront.js`):
    each iteration's rays marched, hits shaded and shadow rays traced, the drained tail, the worst-case budget of 24,
    and a short budget flushing and cutting paths (the mean 0.0153, 0.0145 at 8, 0.0106 at 4); one iteration kernel by
    kernel (ping-pong buffers, the shade queue, the shadow queue's sides, indirect dispatch sizes); one big kernel
    against the wavefront as lane-time, a shading's cost a model's number. -> raytrace_main.js (the iteration, the
    worst case, the accident, the shadow rounds, occlusion with NEE off), wavefront.js (prep, flip, the flush, the
    clamp). Measured: PERFORMANCE_REVIEW §10.1-10.2 (Pascal). *Read:* laine2013, webgpu-fundamentals.
23. **Adding up light on a GPU**: no float atomics, one resolve a sample, batches.
24. **From scene tree to shader**: codegen, uniforms and constants, baking, the scene as data.

**VII. Speed** (every number stamped; the review's ±20% drift between runs stated)
25. **Measure first**: per-kernel timestamps, drift, bench rows, the plan that was reverted.
26. **Fewer and cheaper steps**: culling boxes, boxes on dear nodes only, relief shells, the step cache, what was
    measured and removed. *Read:* iq-bounding (Quilez on bounding volumes for SDFs), keinert2014.
27. **Faster compiles**: off-thread, `noUnroll`, one copy of the scene per kernel, the pipeline cache.
28. **Feeling fast**: the governor, fast-while-moving, presets, slicing, the watchdog, uploading only what moved.

**VIII. Getting it right**
29. **Noise, bias and checking**: unbiased and consistent, closed forms, the furnace, JS mirrors.
30. **Numbers have grain**: f32 spacing, one tolerance, offsets, metres inside, the unit lint.
31. **The optics bench**: far field, illuminance maps, ray files.

**IX. Build your own**
32. **A ray tracer in one page**: the flat world explained line by line, then extended.
33. **Open problems**: what is not built yet, and the measured or inferred case for each.

## Where 3D is planned

Written: the screen as a grid (ch.1), steps per pixel in a real picture (ch.2), a 3D room with and without NEE
(ch.14). Planned: normals as colours on real shapes (4), the inverse-square law on a sphere around a lamp and the sun's
cone (5), a lobe on its hemisphere (8, 9), a ball of glass refracting a picture (10), depth of field in a picture (17), a
caustic under a glass ball and the photon map's cells (18, 19), a beam through a haze box (20), the culling boxes and the
step cache's grid around a scene (26).

## Rounds

1. **This round**: the plan, the toolkit, four styles kept for every reader (a named menu), chapters 1, 2 and 14,
   the contents and the glossary, each read by a blank reader and revised; reading boxes; the rule that the tutorial
   follows the code (`review/affected.mjs`).
2. Every style's fonts kept in the repository (`kit/fonts/`, `fetch.mjs`, their licences): the tutorial loads nothing
   from elsewhere. Then "How to read this", the rest of Part I and Part IV (the flat world grows a glossy surface,
   MIS, Russian roulette and a lens), each read by two blank readers in turn and revised (rounds 3 and 4 in
   `REVIEWS.md`). Asked
   for on the way: every figure interactive (controls where there were none, every chart read out under the pointer,
   chapter 14's room calmer), the notebook lettered by hand, four more styles (Chalkboard and three versions of the
   drafting sheet), and colour words that follow the style.
3. Then Parts II and III (chapters 5 to 11), V; then the machine and speed (VI, VII), which lean most on measured
   numbers; then VIII and IX.

## Checks

- `node tutorial/test/tutorial.test.mjs` (in CI): contents, links, glossary, excerpts, figures drawn into a recording
  canvas, flat-world and 3D closed forms, and the imports' reach.
- `node tutorial/test/pages.check.mjs [dir]` (optional, Playwright): every page in every style and theme, headless.
- `node tutorial/review/extract.mjs <dir>` (Playwright): the pages as a reader meets them, for the blank reader.
- `node tutorial/review/affected.mjs [base]`: which chapters a branch's changes to ShadyTracer touch.
