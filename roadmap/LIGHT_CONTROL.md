# Programmable lights: what is possible, and in what order

The user, 2026-10-22: *"It would be nice to get more programmatic control over light sources. Objects and materials
have code segments. I would love to have something similar for light sources. E.g. what cannot be done today: an
array of light sources. More control of colour dependency over angle, or over position. Intensity over position.
Investigate what could be possible without a significant impact on compile time and render speed."*

The user's choices, the same day:
- **Phase 1: arrays of lights.** Built in `0.next` (below).
- **Emission over angle or position: a tabulated map**, not code run wherever a light is evaluated.

This replaces the open decision *Lights as parameters and code* in `UI_PLAN.md`, investigated 2026-09-28.

Every claim below is marked:
- **read** (in code, with file:line), which says what the code does, never what it costs;
- **measured** (by whom, on what, the number);
- **inferred** (a hypothesis, with what would test it).

## 1. Where a light is needed

A light reaches the picture three ways, and each needs its face exactly (read):

1. **A camera path hitting its face.** The face's own case in the scene's generated `getMaterial2`: its glow, weighed by
   MIS against light sampling. (`builder/codegen.js` emitMaterials, the `for (const L of lights)` cases, and the one
   weight after the switch.)
2. **Light sampling towards its face (NEE).** This runs in the **shade** kernel, which holds no scene since 0.20.8: it
   reads a table of faces that the surface kernel copies each iteration. That table is `FACE_TABLE` and
   `FACE_TABLE_WRITE` in `lib/pathtracer/core/tracebasics.js`. The sampling itself is in `materials_pbr.js`
   (processMaterial_advanced, `pick00 < fs`).
3. **Its photons** (light tracing, the photon map, the Optics page's trace).
   - They start in `optSourceRay`, `lib/pathtracer/optics/kernels.js`.
   - The picture's photons come from `prog_opt_photons`: one kernel for every scene, with no scene in it since 0.34.2
     (`optics/kernels.js`, *NO SCENE IN IT*).
   - Both are fed by a table built in JS from the document: `builder/sources.js` sourceTable.

So two of the three consumers, shade and the photon generator, are **compiled once for every scene** (read: the
comments cited above). They see a light only as data. That decides what "a light with code" can be without a compile
per scene in those two kernels:
- **an array of lights:** more rows in the face and source tables, enumerated in JS;
- **emission code:** something that turns the code into data before those kernels run (§4).

## 2. What exists today

- **A light is a node of its own**, not code (read: `builder/lights.js`, its header *A LIGHT IS NOT A CODE NODE*).
  - A rectangle or a disc, flat, emitting along +z, or a ray file.
  - Colour (RGB, CCT and Duv, or xy), luminance or flux, distribution (cos^n, uniform, collimated), a cone, one or two
    faces, transparent, emitN.
- **The only angular dependence is the distribution** (read: `LIGHT_BEAM_LINES`, tracebasics.js). There is no colour
  over angle, and nothing over position.
- **The light's numbers are live uniforms** (read: codegen `emissive_`, `emissiveLuminance_`, `beam_`). Component
  parameters can drive a light's colour, flux and luminance (read: `builder/bind.js` LIGHT_MODES). That is the
  programmability lights have today: CPU expressions over a group's parameters.
- **An emissive material** (type `emitter`) can already vary its emission over the surface with material code, through
  `m.emissive` (read: `builder/materials.js` MAT_CONDITIONAL).
  - It is found by discovery (read: `materials_pbr.js`, emitDeposit, `EMIT_MAX = 64` boxes), and evaluated where a
    shadow ray lands (`TAG_EMIT`).
  - It is **not an optics source**, and has **no lumens** (read: `builder/sources.js` header).
  - For a glowing pattern seen by the camera, this is the closest thing to "intensity over position" today.
- **Group code moves its children anywhere**, so a light under it is not drawn (read: codegen collectLights). That
  includes the circular array, which is group code (`builder/modifiers.js` circular).

## 3. Phase 1, built in `0.next`: lights inside arrays

**What it is.** A rectangle, disc or ray-file light inside a plain group with `copies` (nested arrays too) is a light at
every copy:
- a face in the face table,
- a case of `lightFace`,
- an entry in the scene-as-data light table,
- a source for the photons and the Optics page.

Each copy has the light's settings, and **its flux is each copy's**. The rules and their reasons are in
`builder/lights.js`, *A LIGHT INSIDE ARRAYS*.

A ring of lights is a ring of copies: `model.js` copiesRing, and *Make them a ring* in a group's copies box. The
circular array cannot be used for this: it is group code.

### How it is built (read)

- **Face order.** One function set enumerates the copies, the same way for codegen, the scene as data and the sources:
  `copyCount` and `copyIndices` in `builder/lights.js`. The order is the arrays outermost first, the innermost copy
  fastest. `builder/test/codegen.test.mjs` holds all three to the same faces, in the same order.
- **Text linear in lights, not in copies** (codegen `faceTotalLine`, `facePickLine`, `faceCases`, `copyIndexLines`).
  - The total and the pick are one line a light, its weight times its number of faces.
  - `lightFace(i)` is one case a light. It lists every copy's index, composes each array's copy through a switch over
    that array's copy uniforms, and is the same composition as the SDF's.
  - A light under no array is the text it was, byte for byte: the golden shaders hold that.
- **One material a light.** A hit on any copy gives the MIS weight the light's first face.
  - This is exact only because `lightFaceDensity` reads nothing of a face but its area and its weight (read:
    `scene_api.js`).
  - So **the copies of an array with a light in it must share one scale**. The model refuses anything else
    (`copiesProblems`, checked from setCopies, addLight, move and a load).
  - `builder/test/lightarray.gpu.mjs` holds the weight on Dawn: the same at every copy, and the power heuristic's
    number.
- **An array with a light in it inside a joining (CSG) group** is not drawn.
  - The reason: the light is hoisted after the outermost combine, outside the copy loop.
  - It is not refused either, because a join changed above would make a saved scene unreadable.
  - The Optics page lists such a light as skipped, with the reason (sources.js).
- **Nothing in shade or the photon kernel changed.** They read the faces and sources as data already.

### Measured (lavapipe, in a container, 2026-10-22)

These are correctness numbers, not speed.

`builder/test/lightarray.gpu.mjs` renders a floor under 12 small lights, as a ring of 4 rows of 3, against the same
12 lights placed by hand through plain groups. Seeds 1 to 3, 256 samples, light sampling on: the array reads
0.9929 ± 0.0070, 0.9933 ± 0.0088 and 0.9998 ± 0.0084 of the lights placed by hand.

Found on the way, and **not the arrays'**: with light tracing off, light sampling on read 0.94 to 0.98 of off, for
the array and for the lights placed by hand alike (seed 1: 0.9397 ± 0.0189 and 0.9527 ± 0.0173). That was about 4 %,
over six such pairs.
- **Found and fixed on `dev`** (4026e9a, PR #53): a face glowed on the rim the surface tolerance grows it by, which
  only the paths without light sampling counted. With light sampling off it read too bright, against the closed form.
  Now the rim takes the back's material, in the light's own frame, so each copy of an array tests its own face.
- **Measured after the merge** (lavapipe, 2026-10-24, seeds 1–3): on reads 0.9630 ± 0.0193, 1.0021 ± 0.0181 and
  0.9941 ± 0.0193 of off for the array, and 0.9780 ± 0.0178, 0.9759 ± 0.0208 and 0.9901 ± 0.0187 by hand. Each is
  within two standard errors of 1, and `lightarray.gpu.mjs` holds it again, along with the rim of every copy.

### Speed

**Measured** (the user, NVIDIA Ampere, Tests › Benchmarks › lightarray, `ShadyTracer 0.77.0 · 213642c
(claude/youthful-brahmagupta-hu4yii)`, 1280×720, 2026-10-23): a floor under 1000 lm in every row, times in ms.

| row | a sample | GPU | march | occlude | shade | opt_photons |
|---|---|---|---|---|---|---|
| one light | 61.4 | 48.9 | 12.3 | 7.6 | 21.2 | 0.59 |
| 16 in an array | 67.5 | 55.6 | 19.0 | 8.7 | 20.9 | 0.33 |
| 16 placed by hand | 83.6 | 50.1 | 14.9 | 8.1 | 20.5 | 0.33 |
| 16 × 16 in a ring of rows | 684.2 | 657.3 | 465.0 | 160.0 | 20.0 | 1.57 |
| one light, again | 60.8 | 49.0 | 12.3 | 7.8 | 21.3 | 0.59 |

What it settles:
- **Picking a face costs nothing measurable.** Shade, where light sampling picks a face, stays at 20–21 ms from 1 face
  to 256. The photons' pick of a source grows by about 1 ms. The binary search proposed here before is not needed.
- **The SDF is where the time goes.** At 256 faces, march goes from 12 to 465 ms and occlusion from 8 to 160 ms.
  - Read in code: every copy of an array was evaluated at every step. That is codegen's copies loop and the data
    evaluator's ARRAY records; data mode culls each child record inside a copy, but still visits every copy.
  - So the cost is the copies, not the lights. It is the same for any arrayed object.
- **Unexplained:** the 16-by-hand row's wall clock is 33 ms over its GPU time, where the other rows are about 12 over.
  The user will rerun it (`BENCH.lightarray.run(2, 3, 2, 3)`) to see whether it reproduces before anyone looks for a
  cause.

**The fix: a window of the copies** (`builder/arrays.js`, `0.next`).
- A row or a ring of copies, recognised from the copies' own matrices, evaluates only the copies near the point.
- Every other copy is bounded by the sphere round its content's measured box (`boxes.js` cullBoxes, `contentKey`).
  The bound is folded into `CULL` under the top-level culling's contract: a lower bound beyond `cullMargin()`.
- Near a surface the field is exact. `builder/test/arraywindow.gpu.mjs` holds that on Dawn, in codegen, as data and
  baked. It also holds that the field all round is never above the field without the window.
- Bench rows 5 and 6 are rows 2 and 4 with the window off.
  - Inferred when it was written: the 16 × 16 row's march falls towards the single row's, since about three copies of
    each array lie within a copy's reach of any point. What would refute it: row 4 near row 6.

**Refuted: the first window was slower.** Measured on the user's Pascal card, a81cac9, 2026-10-25:

| row | a sample | march | occlusion |
|---|---|---|---|
| 4: 16 × 16 ring, window on | 1385.1 ms | 1007.5 | 382.7 |
| 6: the same, window off | 398.9 ms | 281.0 | 87.7 |
| 2: row of 16, window on | 68.1 ms (50–108, noisy) | 15.2 | |
| 5: the same, window off | 50.3 ms | 11.9 | |

- **Not the steps.** Counted on lavapipe by `builder/test/arraywindow.gpu.mjs`, with the bench's own documents and
  camera through the engine's march kernel: the ring took 22.0 steps a camera ray with the window and 19.4 without.
  The row took 12.1 both ways. A step count is the algorithm's, the same on any card.
  - So the first guess is ruled out: a phantom surface from the loose sphere bound would show as more steps.
- **Each step's cost, then. Inferred, not measured:**
  - The window's loop fetched each copy's matrix through a 16-way `switch` on the copy's number, and that number
    differs from pixel to pixel.
  - A GPU runs a group of pixels on one instruction stream, so it runs a switch's cases one after another when they
    disagree.
  - With every copy walked, the number is the same for every pixel and the loop's trip count fixed.
- **The change:** a window's copy is now worked out from copy 0 by the pattern (`arrays.js` `arrCopy`): a row's moved by
  k steps, a ring's turned by k·360/n. Its matrix is the stored one to f32's precision.
- **Bench row 7 tests the inference.** It is row 6's every copy, walked from the window's own first copy and fetched by
  the switch, as the first window fetched them. Row 7 against row 6 is what the switch costs, and row 4 against row 6
  says whether the window now saves anything.

## 4. Later phases: what is possible, and what it would cost

### Phase 2: per-copy variation

What it would be: an intensity and a colour factor per copy, from an expression of the copy's index `i` (`0.5 + 0.5 *
cos(i * 0.3)`), evaluated in JS like the component parameters (`builder/expr.js` gains `i` and a few functions). It
costs the shaders nothing in the tables, but **a hit does not know which copy it is** (read: the `Hit` struct,
tracebasics.js, has no spare field). Its glow and its MIS weight would then need the copy. Three ways:

1. **A copy-dependent material id.**
   - Simple, but the Optics page tallies hits by material id and has room for 64 (read: `OPT_MATS`,
     `optics/kernels.js`).
   - An array of 100 lights would overflow it.
2. **A private variable the SDF writes when a light's face wins** (`c_<group>` is in scope there), read by
   `getMaterial2`.
   - Fragile: it is right only for kernels that call the SDF and then the material at the same point, in the same
     thread.
   - That is the "true for the only caller that existed" shape of bug (CLAUDE.md).
3. **Recovering the copy from the hit point**, after the switch.
   - A loop over the light's copies, each copy's frame from `lightFace`, the one whose face holds the point.
   - Exact, and one call site.
   - It costs a loop of up to the light's number of copies per light hit (inferred: rare against the march, worth
     measuring).

The recommendation is 3, with its loop run only for a light whose copies differ. It would also lift the
one-scale rule.

### Phase 3: emission over angle and position, as a map (the user's choice)

**The user's code**, in the light's frame:

```wgsl
fn emission(uv: vec2<f32>, dir: vec3<f32>, i: u32) -> vec3<f32>
```

- `uv` is the point on the face;
- `dir` is the direction it leaves in;
- `i` is the copy;
- the parameters are in scope, as an object's;
- the result is a non-negative factor on the face's colour and luminance.

**How it would work.**
- **A bake.** A small kernel per scene, holding only the lights' codes (no SDF, no materials), runs the code over a
  grid. It runs when the code or a value it reads changes, not every frame. The map is separable: position (say 32 ×
  32) times angle (θ, φ, say 32 × 64). A full product of the two is 4-D, and too big for a map.
- **One map, read everywhere.**
  - The hit (`getMaterial2`) reads it.
  - Shade's light sampling reads it, from the face table's region of `learn` or a buffer beside it.
  - The photon generator reads it and **samples by it**: a cumulative table over the map, so a gobo's photons go where
    its light goes.
- **Flux.** The flux is the map's integral, exact for the map: a light set in lumens stays in lumens.
- **The same machinery serves an IES or EULUMDAT import as a source**, which the roadmap already plans
  (`roadmap/PLAN.md`, phases 5 and 6). An IES table is an angular map.
- **What a map cannot be:** finer than its grid. A sharp gobo edge blurs at the map's cell, and a colour that varies
  with angle and position together, other than as a product, is out.

**Costs** (inferred; each to be measured on the user's card):
- one more compile, small, and only for a scene with a coded light;
- a fixed amount of map-reading code in shade and the photon kernel, compiled once for every scene, not per scene;
- the map's memory: about 48 KB a light at the sizes above (3,072 cells of three floats, and their cumulative tables).

### Not proposed, and why

- **Running the code wherever a light is evaluated.**
  - It needs the scene's code in shade and in the photon kernel, ending one kernel for every scene: a compile per
    scene, and per edit, of the largest kernels.
  - Its photons could only be re-weighted, not aimed, so a gobo would waste most of them.
- **A light as `emit(u) -> { position, direction, weight }`**, with no face: `UI_PLAN.md`'s first proposal.
  - It has no visible face and no light sampling (like a ray file), and needs its flux measured.
  - It stays a later option, for sources no flat face describes.

## 5. Order

1. Arrays of lights (done in `0.next`).
2. The speed rows on the user's card (§3, *Speed*): measured, and the array window built from them.
3. Phase 3, starting with an angular map alone, which IES import shares.
4. Phase 2, as the copy-recovery loop.
