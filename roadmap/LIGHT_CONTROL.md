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

Found on the way, and **not the arrays'**: with light tracing off, light sampling on reads 0.94 to 0.98 of off, for
the array and for the lights placed by hand alike (seed 1: 0.9397 ± 0.0189 and 0.9527 ± 0.0173). That is about 4 %,
over six such pairs.
- **Not established why.** Inferred: something in face light sampling for small faces, or in its MIS with the face's
  glow, independent of the arrays.
- **What would test it:** the same scene with one light, light tracing off, many more samples, and the faces made
  larger step by step, to see whether the gap follows the face's size.

### Speed

**Not measured yet: the user's to run.**

What can be read:
- the SDF draws an arrayed light in the copy loop, as any arrayed object;
- shade's pick (`tracebasics.js` FACE_TABLE `lightFacePick`) and `optSourceRay`'s source pick are linear scans over
  the faces and the sources.

Inferred:
- at tens of faces the scans are noise against a march;
- at the 1024 faces the table allows (`FACE_MAX`), they may not be.

What would decide it is one light against 16 copies against 16×16 copies, at the same total flux, on the user's card.
If the scans show, a cumulative weight in the table and a binary search fix both.

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
2. The speed rows on the user's card (§3, *Speed*).
3. Phase 3, starting with an angular map alone, which IES import shares.
4. Phase 2, as the copy-recovery loop.
