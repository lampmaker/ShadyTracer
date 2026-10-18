# ShadyTracer, inside out: the tutorial's plan

*Status 2026-10-18: first round written (contents, glossary, chapters 1, 2 and 14, the style mockups). The style is
not chosen yet. This file is the plan; `kit/chapters.js` is the contents the pages read, and the two must agree.*

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

## Rules for authors

- **Figures draw the flat world** (`kit/flatland.js`): a 2D slice, so it can be drawn. Its laws differ from 3D where
  light spreads (1/r, not 1/r²; Lambert is ρ/2, not ρ/π). A function normalised for 3D (Lambert's ρ/π, the HG phase
  function's 1/4π, the photon map's πr²) may be plotted but never put into a flat estimator. Say on the page where a
  formula differs.
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

## The toolkit (`kit/`)

| file | what |
|---|---|
| `kit.css`, `styles/*.css` | layout and components; a style is tokens, a texture and a frame |
| `page.js` | a page's start: bar, title block, glossary cards, chapter links, excerpts, figures and steps |
| `figure.js`, `controls.js` | a live figure from a spec: canvas, handles, controls, scroll steps, progressive work |
| `pen.js` | every line, ray, shape, label and glyph, in the style's colours and line character |
| `plot.js` | small charts in the same ink |
| `flatland.js` | the flat world: SDF shapes, sphere tracing, a camera, a path tracer with and without NEE |
| `excerpt.js` | finds a symbol in a source file: the page and the test share it |
| `chapters.js`, `glossary.js` | the contents and the glossary, as data |

## Contents

Status: **draft** = written this round, for judging the direction; everything else is planned. Each line: what the
chapter teaches → its main figure → the code it walks through.

**Start here**: Contents (the map) · Glossary · **0. How to read this** (the figure legend, the stamps, fold-outs,
excerpts; running the app and its tests).

**I. Seeing with rays**
1. **Rays make a picture** (draft): pinhole camera, one ray per pixel, tracing from the eye, shadow rays, jitter →
   genrays.js (the tile grid rounded, not floored).
2. **Shapes as distances** (draft): SDFs, sphere tracing, tolerance, step scale, escape, the Lipschitz rule → the
   march kernel, shapes.js's "exact or safe".
3. **Building and bending shapes**: CSG, the smooth blend and its normal (the warped fillet), fold tracking surface and
   medium, uniform scale, `warp(k)`, noise relief's Lipschitz bound → scene_api.js, noise.js.
4. **Which way is up**: normals from the field's slope, analytic against three extra evaluations.

**II. What light is**
5. **Measuring light**: lm, cd, lx, cd/m²; inverse-square and cosine laws; emitters in cd/m²; the sun's disc in double
   precision; the ρE/π check → photometry.js.
6. **Colour**: cones, colour matching, xy, Rec.709, CCT and Duv → colorimetry.js.
7. **From light to pixels**: EV100, auto-exposure ("black does not vote"), tone curves, gamut clip, sRGB.

**III. What surfaces do**
8. **Diffuse and mirror**: the BSDF, energy conservation, the white furnace.
9. **Rough and shiny**: microfacets, GGX, Smith, visible-normal sampling, albedo tables, Kulla–Conty.
10. **Glass**: Snell, Fresnel from the IOR, total internal reflection, Beer–Lambert, which medium a ray is in.
11. **Rainbows**: dispersion from n_d and the Abbe number, a wavelength per channel, coatings → spectral.js.

**IV. Path tracing**
12. **Dice and averages**: Monte Carlo, 1/√N, the per-pixel error bar, PCG4D.
13. **Following a path**: the rendering equation in words, throughput, importance sampling, Russian roulette (off,
    and why).
14. **Aim at the light** (draft): next event estimation, shadow rays, choosing among lights, where it cannot help.
15. **Two ways to the light**: MIS and the power heuristic; delta directions keep weight 1.
16. **Every glowing thing is a light**: emitter discovery, unbiased from the first sample.
17. **The camera's lens**: thin lens, focus, depth of field.

**V. Light the camera can't find**
18. **Caustics**: light → glass → floor → eye; light tracing; a split of path space.
19. **Photon mapping**: a hashed grid built with atomics, a shrinking radius, 1/n² in glass, the gather budget.
20. **Dust in the air**: transmittance, free flight, Henyey–Greenstein, light sampling from the air.

**VI. The machine**
21. **A GPU for beginners**: lock-step workers, WGSL, buffers, pipelines, dispatch, the limits.
22. **Wavefront path tracing**: kernels and queues, ping-pong, indirect dispatch, the flush, shadow rounds.
23. **Adding up light on a GPU**: no float atomics, one resolve a sample, batches.
24. **From scene tree to shader**: codegen, uniforms and constants, baking, the scene as data.

**VII. Speed** (every number stamped; the review's ±20% drift between runs stated)
25. **Measure first**: per-kernel timestamps, drift, bench rows, the plan that was reverted.
26. **Fewer and cheaper steps**: culling boxes, boxes on dear nodes only, relief shells, the step cache, what was
    measured and removed.
27. **Faster compiles**: off-thread, `noUnroll`, one copy of the scene per kernel, the pipeline cache.
28. **Feeling fast**: the governor, fast-while-moving, presets, slicing, the watchdog, uploading only what moved.

**VIII. Getting it right**
29. **Noise, bias and checking**: unbiased and consistent, closed forms, the furnace, JS mirrors.
30. **Numbers have grain**: f32 spacing, one tolerance, offsets, metres inside, the unit lint.
31. **The optics bench**: far field, illuminance maps, ray files.

**IX. Build your own**
32. **A ray tracer in one page**: the flat world explained line by line, then extended.
33. **Open problems**: what is not built yet, and the measured or inferred case for each.

## Rounds

1. **This round**: the plan, the toolkit, the style mockups, chapters 1, 2 and 14, the contents and the glossary.
   Decide the style.
2. Next: vendor the chosen style's fonts, delete the other styles and the hub; "How to read this", then Part I and
   Part IV in order (the flat world grows mirrors, glass and MIS as they are needed).
3. Then Parts II, III, V; then the machine and speed (VI, VII), which lean most on measured numbers; then VIII and IX.

## Checks

- `node tutorial/test/tutorial.test.mjs` (in CI): contents, links, glossary, excerpts, figures drawn into a recording
  canvas, flat-world closed forms, and the imports' reach.
- `node tutorial/test/pages.check.mjs [dir]` (optional, Playwright): every page in every style and theme, headless.
