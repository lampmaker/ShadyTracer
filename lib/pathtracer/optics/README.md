# `lib/pathtracer/optics/`: technical ray tracing over the renderer's scene

The renderer makes pictures. This module traces **rays**. N rays leave a source, walk through every material in the scene, and the module records where their flux goes:
- which object each ray hits
- how much each object absorbs
- what escapes
- along which path

It uses the same scene, march and material sampling as the picture, so the optics and the picture cannot disagree about the geometry or the materials.

```js
import { createOptics } from 'lib/pathtracer/optics/index.js'
const O = createOptics(RT, WG)
O.setSources([{ type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], size: [0.3, 0.3],   // any number of them
                distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, emitN: 1, twoSided: false }])
await O.run({ rays: 100000, batches: 4 })   // every ray to the end; mean +- standard error
await O.reset({ rays: 10000 })              // or: rays at the source, then
await O.step()                              // every live ray on to its next interaction
await O.trace({ rays: 5000, steps: 6 })     // N interactions in one go -- the same rays each time
O.live(true, () => ({ rays, steps }))       // ...again and again, for moving things and watching
await O.readHits()                          // what the detectors caught: pos, flux, dir, object
O.results                                   // totals, per object, per material, in lm (or W)
O.drawPaths(true)                           // the last trace's or step's rays as lines over the picture
```

The UI is `optics/page.js`, the Optics page beside Builder: the **Rays** (one ray count, a steps slider that retraces, live while shown) for looking, the **Analysis** run bar for measuring -- a ray count (a number times × 1 … × 10M), ▶ Run (batches sized by the page), and **Live**, the analysis again and again with every chart following each edit -- each round on its own, or with **Σ** the rounds adding up while nothing changes -- and the engine's limits under Advanced. Reset / Step remain in the engine for the benches.

| file | what |
|---|---|
| `kernels.js` | `prog_opt_gen` (rays from the source) and `prog_opt_shade` (one interaction, tallied), plus the layout of the `optData` buffer, which the host shares |
| `index.js` | `createOptics`: pipelines compiled on first use, its own buffers, run / reset / step, results with error bars |
| `estimate.js` | an estimate over batches: each number's mean and standard error as running sums (Welford's), the far field per bin, two estimates merged -- what `O.run` adds to (`into`) |
| `sources.js` | a source description turned into the generator's uniforms; the JS mirror of its sampling |
| `paths.js` | the recorded paths drawn as a line list over the picture (`R.overlays`): the last trace's or step's, from a copy of their own (`O.drawn`, *What is drawn* below) |
| `farfield.js` | the far field as luminous intensity: cd per (C, γ) bin, the plane curves, I max, beam and field angles, zones, CSV |
| `polar.js` | the polar diagram on a 2D canvas (the raytracer's Polar panel) |
| `illum.js` | illuminance read off a map: profiles, the radial profile, encircled flux (r50, r90), isolux lines, and the far field projected onto a plane (`virtualPlane`) |
| `xychart.js`, `heatmap.js` | the raytracer's Profiles, Rings and Encircled flux panels, and its Map with isolux lines; a map of another quantity is drawn over its own range (`lo`..`hi`), a line chart can start where its values are (`yMin: 'auto'`) and breaks where a value is missing |
| `quantities.js` | what a map shows: E, and from a map with colour each cell's CCT, x, y, Duv or Δu′v′ from a target (`quantityMap`), as a map of the same shape; or the light itself, painted in its own colour (`paint`: true colour, or colour only); adding a quantity is an entry in `MAP_QUANTITIES` |
| `test/illum.test.mjs`, `test/charts.test.mjs` | the illuminance arithmetic against known maps; every chart drawn into a recording fake canvas |
| `cartesian.js` | I against γ on a signed angle axis that zooms to the light: for beams too narrow for the polar diagram (the I – γ panel) |
| `test/farfield.test.mjs` | the far field against closed forms (Lambertian, cosⁿ), the binning, the polar scale (Node, no GPU) |
| `test/optics.test.mjs` | the sampling against closed forms, and the tally decoding (Node, no GPU) |
| `test/readback.test.mjs` | a run's batches read back together, on a recording device that carries out every copy: each batch read as its own, one readback a group, the settings kept through a run, a trace one readback (Node, no GPU) |
| `test/drawn.test.mjs` | what is drawn and which rays a trace takes, on the real tinywebgpu over a recording device: a trace, a reset and a step publish their paths, a run publishes nothing and gives the trace its seed back (Node, no GPU) |

## How it is built, and why

**One change to the renderer's core: `TAG_OPTIC`.**
- The renderer's photons stop at the first diffuse bounce and only count through a camera connection, because they exist to make a picture.
- An optics ray is `TAG_PHOTON | TAG_OPTIC`: a photon everywhere (no NEE, emitters end it) that walks on through every event and never connects to the camera (`tracebasics.js`).

**Its own pipelines and buffers.**
- The render loop may run between two steps of a trace (you orbit to look at the rays), so nothing is shared except `learn`.
- `learn` holds the GGX tables and is only read here.
- Everything is compiled the first time Run or Reset is pressed (like `core/pick.js`), so a session that never opens the page pays nothing.

**Objects, not only materials.**
- The shade compiles the scene's pick copy (`pickWgsl`) and evaluates the SDF once more at each interaction with capture on, as the pick kernel does per click.
- So every interaction knows which object it hit.
- Scenes without a pick copy tally everything as "untagged", and per material.

**Integer tallies.**
- Flux is fixed point (2^20 units per unit of ray weight) in lo/hi u32 pairs, with the carry done by hand: exact and deterministic, with no float compare-and-swap retry storms when a narrow beam lands on one object.
- Per object, what arrives and what leaves are tallied. Absorbed is the difference, so it never needs a signed tally.
- Balance: emitted = escaped + lost + Σ (arriving − leaving), exactly.

**Weights, not survival.**
- A ray carries what is left of its flux. There is no Russian roulette and absorption does not kill it, so the per-object numbers are low-noise.
- Only a black surface, an emitter, the bounce cap (counted as lost) or leaving the scene ends a ray.
- A consequence: "rays still going" is not "flux still going". The balance line is the flux.

**Stepping is the wavefront.**
- In a step, the shade parks every ray that interacted.
- The iterations run until every live ray has either interacted or run out.
- The parked rays are then copied back as the next step's input.
- So one step is exactly one interaction per live ray, interface to interface.

**Units.**
- A ray starts with weight 1. Results are weight × flux / rays, in the source's unit (lm or W).
- Lengths are in the scene's unit.

## Detectors, tracing N steps, Live, path length

**Detectors and limiters: a material's type** (model version 10; Builder, material → type: surface, glowing surface, optics detector, ray limiter).
- **detector:** a surface of that material stops every ray that arrives at it from outside, whatever its fields say. Its flux counts as DETECTED, and each hit is recorded (position, flux, arriving direction, object) for analysis elsewhere; `readHits()` returns the records and the page saves them as CSV. The picture renders it as its fields say.
- **ray limiter:** the same in the trace, and not in the picture at all: codegen leaves its objects out of the render and pick copies and gives the trace copies of its own (`opticsWgsl` for the march, `opticsPickWgsl` / `opticsTags` for the shade). For cutting the rays off where a cross-section is wanted.
- The kernels test the hit's MATERIAL id (codegen `detectors`, a 256-bit mask), so a detector needs no pick tag. It was an object flag in files from the optics branch; loading such a file gives the flag to the material, or to a copy where the material was shared (model.js `branchToV10`).

**The detector map** (`detmap.js`; the page's Analysis → detector map) turns the hits on each detector into an illuminance map: a plane fitted to the hits (squared up to the world axes when it is within a degree of them), square cells over their extent, E = flux / cell area in m², so lux for a source in lm. With it: E max, mean and min over the lit cells, U0, the flux, and the hits per cell, which says how noisy each cell is (about 1/√hits). An analysis maps every batch's hits together, each carrying its batch's share, up to half a million hits. The hits' own extent is a little short of the lit area, so edge cells read slightly high; `range` fixes a known extent.

**Tracing N steps.**
- `trace()` runs one chain with the bounce cap set to N, not N readbacks.
- The shade seeds each ray by its id and bounce count, with one seed per trace, so it gives the same paths that stepping N times would. N+1 extends the same rays by one leg.
- That is what lets the page's steps slider retrace on every change, and Live repeat it every frame while objects are moved.
- Rays cut by the cap are the "still going" line.

**One readback for a group of batches.**
- A batch's results were read back four times: the tallies, the far field, the detector hits' count, the hits. Each readback waits for everything submitted before it, the picture's frames too, and the picture keeps submitting while a script waits. A Live round of four batches took 1.4 s with the picture running and 0.2 s with it stopped, at 1 000 rays as at 100 000 (measured by the user, 2026-10-04).
- Now each batch's tallies, far-field bins and hits (up to as many as it has rays: a ray stops at the first detector it reaches) are copied on the GPU into a slot of their own right after its chain, and `O.run` reads a group of batches back at once: as many as fit in 32 MB, all of a Live round's at the counts it uses. A trace, a reset and a step read once each.
- A run keeps the settings it started with (`cfg`): the slots are laid out from its first batch, and a setting changed meanwhile would have had a later batch read at the wrong offsets.
- `O.run({ into })` adds to an estimate (`estimate.js`) it is given; `onBatch(results, b, { hits, last })` hands each batch's hits with it.

**What is drawn.**
- The last trace's or step's paths: the rays traced to be looked at. A trace, a reset and a step copy the start of the trace buffer (the tallies and the paths, to `detBase`) into a buffer of their own, `O.drawn`, and the drawer and `readPaths` read that.
- A run publishes nothing: its paths are recorded and never drawn. It also gives the trace its seed back at the end (each batch draws its own), so the rays drawn after an analysis are the rays drawn before it.
- **Why:** the drawer drew whatever was in the trace buffer, which every trace clears first. While the rays were the only thing tracing between two frames that was the same thing. The page's Live analysis runs its batches between two of the rays' traces, and each batch -- other rays, traced to the end -- would have flashed over the view, and every round would have drawn other rays.

**Maximum distance.**
- `settings.maxDist` (scene units, 0 = none) is the longest optical path traced.
- A hit further along the ray stops it at the limit, counted with the rays still going.
- An escaping ray is drawn up to the limit.
- The page's path slider is a share of it.

**Optical path length.**
- Every path vertex stores the ray's optical path length (Σ n × length, the march's `ltot`).
- The drawer cuts each ray at a chosen length, so the light moves through the system as a front and glass visibly holds it back. This works as in the old tool, but it only redraws.

## The far field: intensity over angle

**What it is.** A (C, γ) grid of flux per direction, tallied in the shade kernel (`optFarAdd`) at the
tail of `optData`, after the detector hits. γ is the angle from the photometric axis, C the angle
about it (the lighting convention's type C). γ bins are centred on 0 … 180° (the two end ones are
caps), C bins on 0, ΔC, … A trace that does not ask for it has no grid and pays nothing.

**What feeds it** (`O.setFar({ mode })`):
- `'escaped'`: every ray that leaves the scene.
- `'detector'`: every ray arriving at one detector MATERIAL (`material`, its id). This is how the
  user says which rays count: a surface placed to catch the light through the lens and not the
  light off the mount.

Either way a ray is binned by its **direction only**. That makes it the luminaire seen from far away,
which is what intensity means. A closed scene (a room) lets nothing escape, so it needs a detector.

**The frame.** `axis` is γ = 0 and `c0` is C = 0, both in world space. The page uses a light's +z
(where it shines) and +x, or its −z with **flip direction** (C = 0 kept: the frame turned half a turn about it), or a
vector typed in (**custom**), with C = 0 the world's +x made square to it. C = 90 is `axis × c0`, so C runs counterclockwise seen from where the light
shines. The host makes the pair right-angled before it reaches the kernel.

**Errors.** `O.far` holds each bin's mean over batches and its standard error, kept as running sums
(`farAccumulator`). A fine grid kept batch by batch would be hundreds of MB.

**Reading it** (`farfield.js`):
- **Intensity:** cd = flux / solid angle.
- **Pooling:** the pole caps are pooled over C, since every C bin there is the same direction.
  `symmetry: 'rotational'` pools every row.
- **Plane curves:** through C and C + 180, the polar diagram's convention.
- **Beam and field angles:** where the curve falls to 50 % / 10 % of the whole grid's I max, per side.
- **Zones:** flux in 0–30°, 0–60°, 0–90° and 90–180°.

**The noise is in the smallest bins.** Near the axis a 1° × 5° bin is tiny, and I max is the largest
bin. The largest of many noisy bins reads high, and the beam angle inherits that. The page shows
I max ± its error and says so when it is large. The remedies are more rays, a coarser γ step, or
rotational symmetry for a round beam.

## Sources are the scene's lights (model version 10)

In the app every source is a builder **light**: an object kind of its own (`builder/lights.js`),
a rectangle, a disc or a Zemax ray file, since the trace has to know its shape exactly to start rays
on it. A light holds its own settings: its flux (or its luminance, the other derived), its colour, its
distribution, one face or two, transparent or not, and the index of what it emits into. Shapes that
are code (every other object, main's rule) cannot be sources; a glowing material on them is an
ordinary emitter. The page turns the scene's lights into descriptions (`builder/sources.js`
`sourceTable`) and calls `setSources` before every trace.

- **The table.** `sourceRecords` packs them into a storage buffer (`SRC_VEC4` vec4s each, the layout in
  `kernels.js`). A ray picks its source by flux (a cumulative share in each record), so every ray
  carries the same share of the total.
- **Colour.** A light's colour is given as RGB, as a CCT + Duv, or as CIE xy (the Builder's `colour by`;
  `builder/lights.js lightRGB`), and becomes its EXACT linear Rec.709 RGB at luminance 1 (`sources.js
  hue`), which rides on the ray's `beta`. Tallies weigh a ray by its luminance, so no flux figure
  changes.
  - **Outside the Rec.709 gamut** (a royal-blue LED) that RGB has a negative channel, and keeps it:
    materials only scale channels, which is linear, so the XYZ a detector computes back is still exact
    for neutral optics. Only the picture clips, where a photon lands on it (`ltConnect`, `gamutClip`,
    luminance kept); the camera's view of the face shows the clipped colour too.
  - **Detector hits carry X and Z** beside their flux (which is Y): `readHits()` gives `xyz`, the CSV
    has them. The detector map maps X and Z like the flux, so each cell has a colour: the page shows
    the detector's colour (xy, u'v', CCT, Duv), its **colour uniformity** (the largest and the rms
    Δu'v' of the cells at 10% of the peak or more from the whole), and can draw the map as the light's
    colour (brightness by illuminance, or every lit cell at full brightness so a dim fringe shows), as
    each cell's Duv, or as its Δu'v' from a target: the detector's own colour, a CCT + Duv, or an xy
    (`quantities.js`). This is how an RGB mix is judged -- white in the middle, a fringe at the edge --
    and it is also the true-colour view of a detector the camera cannot see behind the optics.
  - **The hybrid, and its limit.** This is exact for light that only ADDS and passes neutral optics
    -- which clear lenses, white reflectors and aluminium are. A coloured material multiplies the three
    channels, which approximates a filter's spectrum by three numbers; there is no dispersion yet.
  - **Coatings (0.39.0).** A material's coating -- a dichroic, a beam splitter, an AR layer -- is given as a
    spectrum, R(λ) with an edge that moves with the angle, and each channel reflects R averaged over that
    channel's wavelengths (`core/spectral.js`). A beam splitter's or an AR layer's R is the same at every
    wavelength, so the trace is exact for it; a dichroic's edge is an approximation of the spectrum, the
    "looks right" method: it assumes the light in a channel is spread over its wavelengths as the channel's
    weights say, whatever the source really emits. The exact way -- a wavelength per ray from the source's own
    spectrum, CMFs at the detector -- is planned for this module (PLAN.md C). Bench: `optics-coating`.
  - **Dispersion (0.40.0).** A material's Abbe number makes its index n(λ); a ray refracted into it takes a wavelength
    and that wavelength's colour, so a prism fans white light out by colour. The detectors read the colour (XYZ) of
    what arrives, as before -- not the wavelength. Bench: `optics-dispersion`.
  - The maths is `core/colorimetry.js`: the Planckian locus (Krystek, as in the user's older luminaire
    tool), CCT and Duv both ways, and `mixToTarget`, three lights' fluxes for a target colour.
- **Off the sheet, in its medium.** A sheet is geometry, so its rays start two march tolerances off it
  on the side they leave by -- enough, since a ray leaving a flat face only gets farther from it -- and
  are drawn from the face itself. It was two surface offsets (20 tolerances) until 2026-10-02: 0.21 mm
  in RGBW_mixer, past the lightguide 0.20 mm in front of its dies, and the rays were seen starting
  off the light. A description with no geometry (a bench's point) is not moved. A ray starts with the
  source's `emitN`: an LED die in silicone emits into 1.41, not air.
- **One face.** Codegen gives the back of a one-sided light a black material (`MATID_BLACK`), so
  the camera, light sampling and the emitter photons all see it emit forward only, and it stops light
  from behind, as every emitter has.
- **Transparent.** The trace passes through a transparent source (its front, and its back,
  `MATID_CLEAR`: codegen `passes`). So does the picture, for a light-traced one: everything meets a
  clear sheet (codegen `clearSheet`: smooth, no coat, fully transmissive, the index beyond it the
  medium it sits in, so no bend and no reflection), and a camera path that sees it glow goes on
  through it (`lightTraced` 2): its glow over what is behind it. Light sampling's shadow rays still stop at a clear sheet
  as they do at glass, and the renderer's usual glass limits apply.
- **The picture light-traces every light**: its
  photons, from the same table with its distribution and faces, connect to the camera wherever they
  land -- through the lens, onto the screen, at once. They connect at the camera's first surface,
  through the lobes a connection evaluates (diffuse, gloss from roughness 0.224), from air; a camera
  path whose first surface scattered that way leaves the face to them (`CLS_LIGHTS`), and every other
  camera path -- through a mirror, glass, a diffuser, smoother gloss -- counts the face where it meets
  it (PLAN.md L4; before it, those were black). Each path has one owner, so nothing counts twice --
  except the DIRECT ones (the face right after that first surface), which both strategies make and
  share by the balance heuristic (L4b, `Ray.ltMis`): a small die in a narrow lobe goes to the photons,
  a panel in it to the camera, with no switch at roughness 0.224 between them.
  Where it meets the face inside a medium the glow is over n² (its luminance is its radiance in what
  it emits into; what crosses into air is radiance over n²). Each light face has a material id of its own (after the document's materials,
  `MATID_BLACK` and `MATID_CLEAR`), whose uniforms carry its colour, luminance and beam: seen from an
  angle the face shows the luminance its distribution gives there (codegen `lightBeam`, lights.js
  `beamShape`) -- a die in a 7.5° cone is dark from the side -- and a collimated one its Lambertian
  equivalent, since a delta has no luminance to show. It is never discovered as an emitter
  (`lightTraced`).
  **Why:** as an ordinary emitter, a 2 mm die behind a lens was orders of magnitude slower. Light
  sampling cannot aim through glass, and the camera only saw the die's black back, so it was never
  even discovered. Paths reached it by luck, dot by dot (the user, 2026-09-28). The Optics page's own
  source had been light-traced all along; every light now is.

## Zemax ray files (model version 10)

A **ray set** is a builder light of shape `rayfile`: no geometry, a Zemax source file named in its
settings, placed by its transform, its flux the file's unless given, and the index it emits into.
- **The reader.** `zemax.js` reads the 208-byte header and both record formats: 7 floats a ray (flux
  only), or 8 (spectral). It applies the file's units (the positions end up in metres) and its own
  location and rotation. It refuses a file whose length disagrees with its header. The rotation is
  applied x, then y, then z; that convention is unverified, and the page says so for a file that
  has one. `writeZemax` writes them for the tests.
- **By name.** The file is referenced by its name: 100 000 rays are 2.8 MB. It is chosen in the ray-file
  light's panel and kept by `optics/rayfiles.js`, in memory and in IndexedDB, so a
  reload still has it. A scene naming a file this browser has not seen lists it as not loaded.
- **On the GPU.** The page places the rays through the node's frame (`placeRays`: metres to scene
  units, times its scale, into world space) and registers them (`setRayData`). The source table's
  record for a ray set (shape 3) points at them in a second buffer (`optRays`). A traced ray takes
  one of them at random, weighted by its flux over the set's mean, so the set's flux is what the
  description says. The picture's photons do the same: a ray set is always light-traced (it has no
  geometry to find).
- **Watts.** A file in watts is taken as lumens (there is no wavelength conversion yet); the page and
  the panel say so.

## The source lighting the picture

No page toggle: the Optics page turns it on for the scene's light-traced sources (`setSources(list, pictureList)`), and only while the renderer shows the builder's scene (`picture.applies`), so a bench scene is not lit by them. The renderer's **Lights' rays** switch (`lightRays`, the Renderer panel's Light sources, 0.16.0) gives every photon source none while it is off, as Sketch does (`raytrace_main.js`): the camera's paths then count a light's face themselves, and a light with no face to see -- a point, a ray file, a collimated beam past its first hit -- lights nothing. `O.lightPicture(true)` registers the sources with the renderer as a photon source (`R.photonSources` in `raytrace_main.js`). Every sample, its photons ride in the renderer's ray buffer after its own. Each carries flux/N and connects to the camera at every surface it lands on (`TAG_LTALL`). N is the renderer's own light-tracing budget (Light sources: photons per pixel), so there is no second count to set: the flux sets the brightness, N only how fast it converges. A bench may pin N as the second argument.

- **Per scene unit squared:** the connection divides by distances in scene units, so a photon carries flux / (N s²), s the metres per unit. Without the s² a centimetre scene came out 10⁴ too dark, which is invisible; the `optics-light` bench has an mm row for this.
- **Only the lit side shows:** a connection needs the camera on the side of the surface the light arrives on. A screen lit from below, seen from above, stays dark in the picture while the trace counts its flux. The bundled test scene is lit from above for this reason.
- **Why light tracing alone is exact here:** the source is not geometry, so no camera path can find it. Light tracing is then the only estimator of its light, with nothing to split or weight against. A light with a face is geometry, and since L4 its light is split with the camera's paths by the camera's first surface (above), still with nothing to weight.
- **Units:** the renderer's connection turns lumens into cd/m², so the lens's spot appears at its real brightness and reads in lux in the illuminance view.
- **Through a mirror or glass:** a connection cannot reach the camera there. For a light with a face, the camera's own paths count it instead (PLAN.md L4): exact, and since L7 they aim at the face from every vertex past their first surface -- the floor a small lamp lights, seen in a reflector just below the cutoff, is no longer found by chance. Still by chance: a light such a path can reach only through glass -- a die inside its dome, lighting a floor seen in a reflector -- since a shadow ray stops at any surface. (The face seen directly in a near-mirror is shared with the photons, L4b; in a perfect mirror it is simply an image.) A source with no face (a point, a ray file: codegen draws nothing for it) has nothing for a camera path to meet, and its light there is still missing -- through a delta; through a glossy lobe of any width its photons now connect (they evaluate every lobe, having no one to share with), as do a collimated light's. It was once called "the same limit as the sun's caustics"; it was worse -- the sun's are still counted by the camera side, and a light's were counted by nothing.
- **Resets:** the picture restarts when the source actually changes, not every time the page re-sets it.

## What is not here yet (roadmap/PLAN.md, Optics module)

Filters (phase 2; Zemax ray files, the rest of it, are built -- *Zemax ray files* above); an isocandela map and comparison overlays (phase 3, `roadmap/ANALYTICS.md`); emitting objects as sources and lumens (phase 4); IES / EULUMDAT export (phase 5); IES import (phase 6).
