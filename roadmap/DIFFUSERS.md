# Translucent and scattering materials: the options

**STATUS (2026-10-29).** This is an investigation. Nothing in it is built, and nothing in it is measured. Each fact
about the engine is **read in code**, with its file and line. Each estimate of cost, noise or accuracy is
**inferred**: arithmetic or reasoning, written down so a bench row can test it later.

## The ask

The user (2026-10-29): "investigate possibilities for translucent / hazy materials. Eg. an optical diffuser: milky
glass. Perhaps the haze method can be converted into a material property so it can be applied to any object? Think
about implications, speed, physical accuracy / realism."

Asked which cases matter most, the user named three:
- **Opal sheets on luminaires**: dense PMMA or glass diffusers a few mm thick, near-Lambertian.
- **Narrow-angle diffuser films**: holographic or engineered diffusers, 5–30° FWHM, that soften a beam without making
  it Lambertian.
- **Edge-lit light guides**: panels with scattering particles, lit from the edge.

`MEDIA.md` Phase 3 (scattering inside materials) was the earlier, shorter version of this. This file replaces its
reasoning and keeps its facts.

## What the engine does today (read in code)

- **There is no translucency lobe.** The layered model is metal, coat, GGX transmission and Lambertian diffuse
  (`core/materials_pbr.js:39-51`). `lobesEval` and `lobesPdf` are upper-hemisphere only: `if (i.z <= 0.0)` returns 0
  (`:234`).
- **`transmission` is not translucency.** It blends refraction against an opaque diffuse base, so 0.5 means half glass
  and half paint.
- **Frosted glass is clear glass at roughness 0.3** (`library/items/materials.json`, *frosted glass*). Rough
  refraction is sampled but not evaluated: `EV_OTHER`, "no evaluable BTDF on the other side" (`:359-368`). So NEE
  and light tracing never connect through it (PLAN.md, deferred material work item 6).
- **Every surface blocks a shadow ray**, glass included (`core/wavefront.js:1461-1475`).
  - NEE needs `NoL > 0` on the side the ray came from (`materials_pbr.js:934,964,971`).
  - Its MIS `above` test is `dot(nrm, dir) > 0 && !isDelta` (`:1060`).
  - `ltConnect` runs only from air (`:449`) and only when the camera is on the front side (`:502`).
  - The photon map's gather keeps photons whose normal is within `SPPM_NORMAL_DOT` of its own (`core/sppm.js:408`).
- **A ray has one medium.** It carries `n` and `muR/G/B`, with no stack and no inside flag (`core/tracebasics.js:361-
  427`). At each refraction these are replaced by what a probe a hair across the surface finds
  (`wavefront.js:1049-1079`, `materials_pbr.js:1013-1018`). Absorption is applied lazily from `absLtot`
  (`tracebasics.js:474-487`).
- **The structs are full.**
  - Ray is 112 bytes, with "no padding left" (`tracebasics.js:427`).
  - Hit embeds the Ray and is 144 bytes; ShadeItem is 272 (`core/scene_api.js:105-117`).
  - Material2 is 96 bytes with no free word (`core/materials.js:12-87`).
  - `core/test/structs.gpu.mjs` pins all four against the WGSL compiler.
  - Rays a batch = 1 GiB / (2 Ray + ShadeItem) = 1 GiB / 496 ≈ 2.16 M (`core/raytrace_main.js:150,174`).
- **The haze box is kept to air by three gates:** `hazeDraw`'s `abs(r.n - 1.0) > 1e-3` (`core/haze.js:198`),
  `hazeShadow`'s `vn` (`:419`), and the emitter occlusion kernels' (`wavefront.js:1518,1636`). Its parameters are
  global uniforms (`hazeC/U/V/W/A`).
- **A collision is a whole vertex:** march, then shade (`mediumVertex`), then march again. It counts as a bounce and as
  a diffuse bounce (`haze.js:466`). `maxbounce` is 10 by default and at most 40 (`core/uniforms.schema.js:81`).
- **The Optics page's trace reuses `processMaterial`** (`optics/kernels.js:7,567`), so a new lobe reaches it with no
  work of its own. The haze does not reach it (README § *Dust in the air*).

## The deciding physics: where light can be found from

**A scatter inside a smooth-walled solid cannot use light sampling.** Its own wall blocks every shadow ray (read,
above). For the same reason a photon scattered in there cannot connect to the camera. So inside milky glass, light
arrives in the picture by only three routes:

1. **A camera path refracts out and happens to hit the light.** That is fine for the sky or a large panel. It is
   hopeless for a small LED or the sun. It is the same reason a glass ball casts a shadow rather than a caustic
   (README § *How light gets found*).
2. **Photons light the surroundings through the object.** They refract out (a delta) and the next diffuse surface
   connects. This lights the wall behind a lamp, not the lamp's own glow as the camera sees it.
3. **A volume photon map** that gathers at medium vertices inside glass (MEDIA.md Phase 2, not built).

So a milky shape around a small LED is very noisy in the picture until Phase 2 exists (inferred from the three
routes).

**A scatter on a face can use light sampling on the side it faces.** If the scattering happens at the surfaces:
- the last face before the light can sample it;
- the last face before the camera can take a photon's connection;
- the photon map can gather there.

All three estimators keep working, once evaluation accepts directions on the back side (inferred: the list under B1).

**The Optics page needs no connections at all.** Its rays walk from the source and are tallied where they go
(`optics/kernels.js`'s header). A volume there is exact and no noisier than any other material. This matters for a
light guide's far field and its illuminance on a plane.

## Option B1 — a translucent surface lobe, for opal sheets

**What it is.** Lambertian transmission beside the Lambertian reflection, as PBRT's DiffuseTransmission, Cycles'
Translucent BSDF and the Disney BSDF's diffTrans have it. The interior stays clear, and every face a ray crosses
scatters it. The ray's medium inside, whether it is 1 or the material's index with no refraction, is the one design
choice the haze gates depend on. A ray inside an opal sheet must not see a haze box.

**Its numbers.** These are the datasheet's: total transmittance T and reflectance R. A solid has two faces. For a slab
with no absorption, whose two faces each reflect R_f diffusely, the light between them adds up to

    T = (1 − R_f)² / (1 − R_f²) = (1 − R_f) / (1 + R_f),   so   R_f = (1 − T) / (1 + T).

That is derived here under the two-face model and not checked yet. A JS mirror with its test would hold it, and the
Properties panel could take T and work R_f out from it.

**Speed (inferred).** About one more lobe's arithmetic per hit, and no new rounds. Material2 needs a word:
- Grown to 112 bytes, the ShadeItem becomes 288. That is 2·112 + 288 = 512 bytes a ray, about 3 % fewer rays a batch.
- Packing into an existing word is the other way.

**Accuracy (inferred).**
- Good for the far field and luminance of near-Lambertian sheets.
- Blind to thickness: the glow along a sheet's edge, light walking sideways inside it, and the depth a thick milky
  object shows.
- Light at grazing angles transmits as Lambert says, not as a real sheet's measured curve.

**What it touches (read).**
- `lobesEval` and `lobesPdf` accepting `i.z < 0`.
- NEE's `NoL > 0` guards and the shadow ray's offset, which must follow the side drawn.
- The MIS `above` test (`materials_pbr.js:1060`).
- `ltConnect`'s side test (`:502`).
- The photon map's normal test (`sppm.js:408`).
- `lobesNone` and `sppmEvaluable`, which must still cover every lobe `lobesEval` returns (`sppm.gpu.mjs` sweeps that
  grid).
- Draft's stop at the first evaluable event, the diffuse cap, and the Optics view's photon stop on `LAST_DIFFUSE`.
- The field in `builder/materials.js`, `codegen.js` and `help/reference.mjs`.

**The same back-side plumbing makes rough transmission evaluable** (PLAN.md deferred item 6), which lets NEE through
frosted glass. They belong in one arc.

## Option B2 — a forward-peaked transmission lobe, for narrow-angle films

**What it is.** An evaluable lobe about the straight-through direction, with no net deviation, as a thin film has. Its
width comes from the film's FWHM, through GGX's α or a Gaussian. An elliptical film (60° × 1°) uses the anisotropy
and `Material2.tangent` frame the metals already have (SURFACES.md Phase 1). A JS mirror would check the mapping from
FWHM to α against a brute-force histogram.

**Its limit.** As the FWHM shrinks it nears a delta: light sampling weakens and light tracing must carry it. That is
what happens today to gloss narrower than `LT_MIN_ALPHA` (`tracebasics.js:268`). A 1° film is close to that line.

**Cost and plumbing:** as B1, sharing it.

## Option A — the haze as a material property: volume scattering, for light guides and thick milky glass

**What carries over from `haze.js`:**
- `hgEval` and `hgSample`;
- the free-flight draw;
- `RAY_SCATTER` and `hazeAt`;
- `mediumVertex`'s skeleton.

**What changes:**
- **No box.** Inside a solid the march itself finds the wall, so the draw is just t = −ln(1 − u) / σ_t from the leg's
  start. That is simpler than the box's span.
- **The medium is the ray's**, set at a refraction as `mu` is now: the surface kernel's probe reads σ_t, the albedo and
  g beside `mediumMu`.
- **The gates** read the ray's own medium instead of "in air".
- **`mediumNee` and `ltConnectMedium` are skipped inside a dielectric.** They can only be blocked there, and they
  would waste shadow rays. The phase function's draw then has weight 1.

So "convert" really means **generalise**. The haze box stays: it has no surface, which is exactly why light sampling
works inside it. A material's medium is a second source for the same code.

**Memory (inferred arithmetic).** σ_t, an RGB albedo and g need about two more words in the Ray. Alignment then takes
the Ray to 128 bytes, and the Hit and ShadeItem grow with it (ShadeItem 288). That is 544 bytes a ray, about 9 %
fewer rays a batch. The alternative keeps 112 bytes:
- `muR/G/B` and σ_t as four f16 in two words;
- the albedo and g as pack4x8 in the third.

It costs f16's ~5e-4 relative error in the absorption's exponent, which a test in `floor.test.mjs`'s style would have
to bound.

**Collisions (inferred, the random walk's standard scaling).** For a slab, a transmitted path takes about τ′² / (1 − g)
collisions, where τ′ = σ_s(1 − g)·d is the reduced optical depth.
- **Milky glass** with τ of 1–5 takes a handful: cheap.
- **An opal sheet** passing 30–60 % has τ′ of about 1.5–6, by diffusion theory, depending on its surfaces' index. At
  g ≈ 0.8 that is tens of collisions, already past `maxbounce` 10 and the diffuse cap. Those paths would be cut, and
  the sheet would read too dark.

**Three remedies, all inferred:**
- **Walk inside the march kernel.** Inside a dielectric a collision can do nothing but weigh by the albedo and turn
  the ray: no light sample, no connection. So the march can turn it and keep going without a round trip through
  shade. The cost becomes SDF steps against `maxiter` instead of wavefront rounds and bounces. This is the large one.
- **The similarity relation**: σ_s(1 − g) with g = 0 gives the same multiple scattering with (1 − g) × fewer
  collisions. It is exact only in the dense limit, a bias for thin media.
- **Compiled in only for a scene that uses it**, as the haze box is (`raytrace_main.js` `wavefrontKernels`). Every
  other scene keeps its kernels' text byte for byte.

**Accuracy and realism.** It is exact radiative transfer for a homogeneous medium: the estimator the haze was checked
with (`haze.test.mjs`, `haze.gpu.mjs`). It gives what no surface lobe gives:
- the depth and softness of milky glass;
- the glow along an edge;
- light walking along a guide;
- transmission that depends on thickness;
- opalescence, with σ_s per channel.

Grey σ_t comes first. A ray already on one channel could free-fly at that channel's σ, reusing the wavelength in its
tag (`TAG_LAMBDA_MASK`; inferred). Henyey-Greenstein only approximates the scattering of real particles.

**Light guides specifically:**
- **The Optics page** is exact once its chain has the walk.
- **In the picture**, the LED sits behind the guide's edge and the camera behind its face. Both are refractions, so
  the panel's own glow is found only by chance until Phase 2.
- **A hybrid would converge:** it treats a walk's exit as an evaluable Fresnel-weighted cosine lobe instead of the
  delta refraction. It is biased wherever the light inside has not forgotten its direction, which means thin or
  weakly scattering media. It is written down as an option, not a recommendation.

## The three side by side

| | B1 translucent lobe | B2 forward lobe | A volume in a material |
|---|---|---|---|
| The user's case | opal sheets | narrow-angle films | light guides, thick milky glass |
| Light sampling in the picture | on both sides | on both sides, weaker as it narrows | none inside glass; Phase 2 needed |
| The Optics page | through `processMaterial`, free | same | exact once its chain walks |
| Memory | Material2 +16 B: ~3 % fewer rays | shared with B1 | Ray +16 B: ~9 % fewer, or f16 packing |
| Time | one lobe a hit | one lobe a hit | ~τ′²/(1−g) collisions a path, cut by the walk in the march |
| Accuracy | far field of dense sheets; no thickness | film FWHM; no thickness | exact transfer; HG phase |
| Needs first | back-side eval (shared with rough glass) | B1's plumbing | the Ray's room; Phase 2 for the picture |

## A suggested order (inferred, for the user to decide)

1. **B1 and B2, with evaluable rough transmission, as one arc.** It serves sheets and films in every estimator, and
   on the Optics page, for one lobe's cost.
2. **A on the Optics page first.** It is exact there and needs no connections, which serves a light guide's far field
   and illuminance.
3. **A in the picture**, with the walk in the march kernel.
4. **MEDIA.md Phase 2, the volume photon map**, for the glow of a guide or of milky glass around a small light.

## Known answers each step would need

- **B1:**
  - a JS mirror with a white furnace and reciprocity, and the R_f formula against a brute-force two-face slab;
  - `sppm.gpu.mjs`'s material grid extended;
  - `furnace` and NEE on/off parity rows with a light behind a sheet (the existing `bsdf-parity` floor sees only
    reflection).
- **B2:** the FWHM's mapping against a histogram; a parity row through a film.
- **A:**
  - a JS walk against a slab's diffusion result and an albedo-1 furnace, in `haze.test.mjs`'s style, and again on
    Dawn;
  - an Optics-page slab against the same;
  - a bench row the user presses for its cost.

In each case the user judges the picture on hardware. Nothing here is a claim about how it will look.
