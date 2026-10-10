# Lengths, tolerances and f32 precision

How the renderer handles size: the scene's unit, the engine's unit, the surface tolerance and everything made from
it, and what 32-bit floats allow. Written for 0.36.0, when the engine moved to metres. The quick lookups are
`node lib/pathtracer/core/tolerances.js [tolerance in m]` (the table below, at any tolerance) and, in the page,
`RT.tolerances()` (the same, resolved for the scene showing). `core/test/tolerances.test.mjs` keeps the table true to
the code; `core/test/floor.test.mjs` and `core/test/unitlint.test.mjs` hold the floor and the boundary.

Each claim says how it is known: **read in code** (file), **computed** (arithmetic, no GPU), **measured** (where, how)
or **inferred**.

## The short answers

- **The scene's unit** (m, cm or mm; Scene properties) says what the scene's numbers mean. A radius of 0.2 in a mm
  scene is 0.2 mm. It converts the scene's numbers into the engine's unit, and nothing else changes with it: light
  has no length in it (cd/m², lux), and a lumen is converted through an area in m² (`builder/sources.js`).
- **The engine works in metres** (since 0.36.0). Rays, hits, tolerances, the camera as the GPU sees it, photons,
  light faces, the step cache and the optics trace are all in metres. The scene's own code, the builder and every
  host tool (gizmos, picks, the measure tool, the optics page) stay in the scene's unit.
- **Precision does not depend on the unit.** f32 has 24 bits of mantissa, relative to the number's own size, so 0.2 mm
  written as 0.2 or as 0.0002 is just as exact. What decides accuracy is **how far a point is from the world origin**,
  and the surface tolerance. Moving the engine to metres was for one meaning per number, not for accuracy.
- **Accuracy in micrometres** (computed), at distance D from the origin:

  | D | f32 spacing (resolution of a position) | the floor (finest tolerance allowed) |
  |---|---|---|
  | 1 cm | 0.93 nm | 0.15 µm |
  | 10 cm | 7.5 nm | 1.5 µm |
  | 1 m | 0.12 µm | 15 µm |
  | 10 m | 0.95 µm | 0.15 mm |
  | 100 m | 7.6 µm | 1.5 mm |
  | 1 km | 61 µm | 15 mm |

- **How large a scene can be** for a given finest tolerance, with the floor at 128 × 2⁻²³ of the largest coordinate:
  1 µm within 6.5 cm of the origin, 10 µm within 65 cm, 100 µm within 6.5 m, 1 mm within 65 m. So a scene under a
  metre has 15 µm or better everywhere, and a building-sized lighting scene has 1 mm out to 65 m and 1.5 mm at 100 m.
  **A sub-millimetre part wants to sit near the origin.**

## Who is in which unit

| what | unit | converted where |
|---|---|---|
| the scene's text, its parameters and positions, its radius (`envRadius`), its extent | the scene's | -- |
| the camera object, gizmos, picks, measure pins, the builder, optics settings (reach, escape length), detector maps | the scene's | -- |
| rays, hits, tolerances, photons, the step cache's cells, the light-face table, the emitter grid, the sun's square | metres | -- |
| settings that are lengths: the tolerance (`eps`), `ltRadius`, `emitRadius`, `emitMargin` | metres | -- |
| the camera as the kernels read it | metres | `core/units.js engineCamera`, in `index.js buildUniforms` |
| a pick's ray / its answer | metres in / the scene's out | `index.js pick` |
| the step cache's box | the scene's, handed to the kernels in metres | `raytrace_main.js stepCacheUniforms(u)` |
| optics sources, reach, hits, paths | metres in / the scene's out | `optics/sources.js sourceRecords`, `optics/index.js` |
| a material sized in mm (reliefs, patterns) | real millimetres | `mm()` in the scene's code |

**The boundary** (`core/scene_api.js SCENE_BOUNDARY`) is the only place the engine meets the scene:
`sceneAt(ray, capture)`, `materialAt(hit, inside)`, `lightFaceAt(i)` and the pick's tag capture. Each converts every
length that crosses -- a ray's `pos`, `ltot`, `tmax`, `vtxLtot`, a hit's distance, a light face's centre and size -- and
keeps the sentinels as they are (`insideW`'s -1e7, "inside nothing"). (Until 0.41.0 it also carried exact hits' place
along the ray, `sceneHitT()` and `sceneSD()`.) It multiplies by `UB.sceneUnit` or `UB.perMetre`, never divides, so a
metre scene's numbers are exact. **Checked:** `core/unitlint.js`, in check-shaders' second pass, refuses any engine
function that calls the scene's side, reads its globals or the unit, for every kernel and every scene.
`builder/test/units.gpu.mjs` renders the noise library in mm and re-authored in m through the engine's kernels:
measured on lavapipe (2026-10-07), 0 of 2304 rays differ, plainly, as data and with exact hits (gone since 0.41.0).

## The surface tolerance

**One number at a point p, in metres** (read in code: `core/tolerances.js`, generated into `tracebasics.js`):

    marchTol(p) = max(setting, 1 nm, 128 × 2⁻²³ × max(|p.x|, |p.y|, |p.z|))

- **The setting** is Renderer › Ray marching › *Surface tolerance (µm, 0 = auto)*, stored in metres. At 0 it is
  **automatic**: 1e-4 of the scene's estimated size, between 10 nm and 1 mm (`photometry.js autoEps`).
- **The estimated size** is the diagonal of a box around every object, each padded by its largest numeric parameter
  times its scale (`builder/bounds.js estimateBox`). That over-counts: the RGBW mixer's lens is padded by its curvature
  radius r2 (7.23 × 4.21 = 30 mm), so its size reads 105 mm and its automatic tolerance is 10.5 µm (computed with
  bounds.js on the file).
- **The floor** is 128 to 256 spacings of f32 at the point. It is evaluated **at every step** of the march and the
  shadow rays, at every normal, and at every step off a surface. The scene's own code gets the same number at the
  point it is asked about, through the boundary (`SCN_TOL`), so a culling margin agrees with the march.
- **Why 128 (measured in an f32 emulation, `core/test/floor.test.mjs`, not on a GPU).** The floor is for the noise in a
  normal by differences, which shades every shape without its own normal. Its worst angle against the same
  differences in double precision, at a step of K spacings, on spheres and turned boxes a third to a tenth of their
  distance from the origin:

  | K (spacings) | 1 | 4 | 16 | 64 | 128 | 256 |
  |---|---|---|---|---|---|---|
  | worst noise (mrad) | ~700 | ~150 | ~44 | ~11 | ~5 | ~2 |

  Below a hundred or so spacings, a surface's shading is f32's pattern. What the floor is **not** for: the march's
  ending, which in the same emulation ended at a single spacing.
- **What it costs.** A tolerance set by hand finer than the floor is not given: 15 µm at 1 m from the origin. A part
  much smaller than that (a 0.2 mm sphere at 1 m) then has its normal by differences taken over a step that is a fair
  share of its size, a smooth error rather than noise. The automatic tolerance (1e-4 of the scene's size, at most 1 mm)
  is above the floor within **6.5 times the scene's estimated size** of the origin, and within 65 m for a scene of 10 m
  or more, where the 1 mm cap holds (computed; `core/test/floor.test.mjs`). Beyond that -- a ground plane running out
  past the scene, a ray on its way to the sky -- the floor decides, and the march there takes coarser steps than
  before 0.36.0: the RGBW mixer (105 mm by its estimate, 10.5 µm) gets the floor beyond 69 cm from its origin.
- **Where it is shown:** Render stats › Picture (the tolerance and how it was chosen), the Ray marching box's line,
  and `RT.tolerances()`.

## Every use

Multiples of the tolerance at the point, or fixed lengths. "Scene" rows are the scene's own code, given the engine's
tolerance at the point it is asked about. `node lib/pathtracer/core/tolerances.js 0.0000105` prints these at the RGBW
mixer's 10.5 µm.

| use | size | where | why |
|---|---|---|---|
| hit test | 1 × | march, shadow rays, pick | a ray this near a surface has hit it |
| normal step | 1 × | surface kernel (forward differences), pick (central) | larger: the curvature shows; finer than the floor: f32 noise |
| leaving a surface | 10 × | a bounce, a ray moving away | the next march must not find the surface it left |
| two steps off | 20 × | shadow rays' start and end, the camera connection's lift, the medium beyond, an emitter's photon and probe | from an estimated normal, so twice a bounce's |
| manifold connection | 1 × (8, 20, 100) | surface kernel, its walk (`core/manifold.js`), taken at D | hit tests and convergence 1 ×; the normal's step 8 × (f32 rounding read by its differences); the checks 20 ×; the differences' span 100 × |
| optics source start | 2 × | a light's ray off its exact face | two hit tests suffice off an exact flat face; twenty put rays inside a lightguide 0.2 mm in front of a die |
| emitter aim margin | 10 × | light sampling's sphere round an emitter | a hit is within one tolerance of the surface |
| scene: its tolerance | 1 × | a relief's band, a user's code that asks for it | the scene's code, in its unit |
| scene: culling margin | 10 × | a node farther than this from its box answers with the box | always above the hit test |
| longest march | 1 km | march, shadow rays, pick | a ray this far along has left |
| connection overshoot | 0.1 mm | a shadow ray that ends at a point | its last step reaches the point; never tested there |
| camera too near | 0.1 mm | light tracing's camera connection | the footprint divides by depth |
| step cache ball floor | 1 µm | a cell's ball | a ball moves a ray only a whole cell ahead: never decides a step |
| the scene's radius | the scene's (400 m default) | escape test, sun photons' start | where the sky begins |

## What to do about a small precise part

1. **Keep it near the origin.** Every number about it is then small, and f32's spacing with it.
2. **Set the tolerance by hand** (Renderer › Ray marching, µm) to a few hundredths of the part's size, for instance 1 µm
   for a 0.4 mm sphere. The Render stats say what is in use. Within 6.5 cm of the origin 1 µm is above the floor.
3. **Coming:** a tolerance per pixel (`roadmap/PLAN.md`, *A tolerance per pixel*), so a close-up gets
   a fine tolerance automatically while the rest of the scene keeps its own.

## Known limits

- **The automatic tolerance follows an estimate** that counts any parameter's largest number as a size: curvature
  radii, counts and angles too (`PERFORMANCE.md`). It errs coarse, and it is one number for the whole scene: a
  0.4 mm sphere in the RGBW mixer gets 10.5 µm, 5% of its radius.
- **The floor follows the point, not the shape:** a shape whose own numbers are far larger than the point's (a 10 m
  sphere passing through the origin) needs the setting, not the floor, to be safe.
- **The optics bench converted to metres the builder's paste way is not the same physical scene.** About 2% of the
  camera's rays hit a part in cm that they pass in m. The rays are the same ones through the engine before 0.36.0, so
  this is not the engine's unit (measured on lavapipe, 2026-10-07; `builder/test/units.gpu.mjs` says why it uses other
  scenes). Why the conversion differs is open.
