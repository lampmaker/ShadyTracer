# What a ray carries: colour, polarisation, coatings, media and diffraction — a roadmap

Written 2026-10-30 on the user's questions. On 2026-10-29 they asked for real spectral rendering: light sources
defined by a spectrum, wavelengths, phosphor conversion, and a ray with more colours than three. On 2026-10-30 they
added: *"Think about the future too: what would I or other users ask for? Would a more flexible way of handling
colour help, a setting per scene: plain RGB, single wavelengths, bands or hero? Think also of other optical properties
that may have to be modelled: polarisation, thin layers, maybe even diffraction. The trick is to keep the speed up,
and to switch on the ray's capabilities only when they are really needed: a hero shot can be much simpler than a model
with multilayer dichroics."* And then: *"I'd rather not have automatic rules. I'd rather have a choice somewhere that
shows extra properties per material. Dispersion, for example, is a trace parameter now, but it could be a scene
setting: no dispersion, and the materials' Abbe numbers are not shown either. So more or fewer options shown,
depending on what the user knows."*

Nothing here is built. Each claim says how it is known: **computed** (by a program, named), **read in code**
(file:line, what the code does, never what it costs), or **inferred** (a hypothesis, with what would test it).
Nothing in this file was measured on a graphics card.

## 0. Where it starts

- **A ray carries three linear Rec.709 channels** (read in code): `radiance` and `beta` vec3, the absorption
  `muR/G/B` (`lib/pathtracer/core/tracebasics.js:368-398`). It is 112 bytes with no padding left
  (`tracebasics.js:56`). Rays in flight are `floor(1 GiB / (2 x 112 + 272))`, about 2.16 M
  (`core/raytrace_main.js:150, 174`; 272 is the shade item, `tracebasics.js:57`).
- **A light is a chromaticity** carried as its exact Rec.709 RGB at Y = 1, negative channels kept
  (`builder/lights.js:64-72`). So neutral optics are exact in colour and lux (`optics-colour`, 1e-8 on hardware:
  PLAN.md C).
- **What the "looks" method covers** (read in code): a coating is a logistic edge averaged per channel
  (`core/spectral.js:100-112`). Dispersion draws one wavelength at the first refraction into dispersive glass and
  keeps it in `Ray.tag` (`spectral.js:33-44`). A runtime switch, `UB.dispersionOff`, reads every Abbe number as 0
  (`core/materials_pbr.js:837-840`). It sits in the render settings (`lib/pathtracer/settingsui.js:63-65`) and in
  Quality's Standard (`lib/pathtracer/quality.js:25`).
- **What a ray carrying a spectrum would cost in noise and bias** (computed, `core/test/spectralnoise.test.mjs`,
  the table in PLAN.md C 4):
  - **one wavelength a path:** a path's Y is off by about its own size;
  - **four hero wavelengths, drawn stratified as pbrt-v4 does:** 800-1 400 paths for the draw to leave 0.001 u'v',
    4-11 times fewer than Wilkie's uniform rotation;
  - **16 fixed bands:** about 1 % off in Y through edge filters and 9 % through a phosphor layer;
  - **today's RGB:** 6-10 % off in Y through an edge filter, on an LED's narrow blue.
- **Patterns already there to build on** (read in code):
  - **compiled in only when there:** the haze box (only for a scene with one, otherwise the kernels' text byte for
    byte as before: `core/wavefront.js:1180, 1398`), and the step cache and photon map as kernel settings
    (`raytrace_main.js:452-492`);
  - **a material field out of the shader while it does nothing:** `only` (`builder/materials.js:44, 50, 61, 72`);
  - **the panel showing a material type's own fields:** `FIELDS_OF` (`builder/materials.js:153-159`);
  - **a preset that writes only what differs, then Custom:** Quality (`lib/pathtracer/quality.js`).

## 1. The principle: a ray pays only for what the scene uses — and the user chooses it

Three independent axes. Each is the scene's choice, and a choice not made is not compiled. With every axis at its
first value the kernels are byte for byte today's, so a hero shot never gets slower.

| axis | settings | what a ray carries more (from the struct's bytes: inferred, not timed) |
|---|---|---|
| **colour** | RGB (today) · RGB + a wavelength where a surface needs one (today's dispersion) · spectral, K wavelengths a path (K = 1 mono, 4 hero, maybe 8) · N bands (only if a measurement asks for them, §6) | 0 · 0 · beta and mu as vec4: about 128 B, 2.03 M rays in flight (K = 4) · 3N floats and more |
| **polarisation** | off · one Stokes vector shared by the wavelengths · a Stokes vector per wavelength | 0 · 4 + 3 floats (the vector and its frame), about +28 B (PLAN.md C) · 4K + 3 |
| **medium inside solids** | none · absorption (today) · scattering and fluorescence (MEDIA.md phase 3) | 0 · today's · σ_s and g, 112 → 128 B (MEDIA.md phase 3's arithmetic) |

### No automatic rules: a block of features per scene

The user's decision (2026-10-30). Nothing in the scene silently switches a capability on. A block called
**Optical features** sits in the scene row's Properties, beside the camera and the exposure (`builder/panel.js:801`,
`cameraFolder`). Each feature is on or off, and **a feature decides two things at once**:

1. **what is compiled in**, by the patterns above;
2. **what the panels show**: the material, light and detector fields that belong to the feature. Dispersion off, and
   no material shows its Abbe number. Coatings off, and the coating box is gone. Spectral off, and no light offers
   "colour by: spectrum".

The features, in roughly the order they would exist:

| feature | the fields it shows | without the feature it needs |
|---|---|---|
| **Absorption** (colour depth) | `attenuationDistance` | — |
| **Dispersion** | `abbe` (later Sellmeier coefficients) | — (one wavelength where needed, as today) |
| **Coatings: edge** | today's six coating fields | — (averaged per channel in RGB, as today) |
| **Spectral** (K wavelengths) | "colour by: spectrum" on lights, spectra on materials, the wavelength range | — |
| **Spectral detectors** | W, photons / PPFD, melanopic, UV, CRI, TM-30 on detectors | **requires Spectral**: a detector cannot weigh a spectrum it was never given |
| **Coatings: stacks and measured curves** | a layer table, a CSV curve | works without Spectral, averaged per RGB channel, and says so in the coating's box |
| **Phosphor** | absorption, QE and emission spectra | **requires Spectral**: RGB cannot move light from one wavelength to another at all (computed: phase 0's phosphor row) |
| **Scattering inside solids** | σ_s(λ), g | works in RGB with σ per channel; colour over angle (the yellow ring) is then an approximation, and the box says so |
| **Polarisation** | polarisers, polarised sources, a detector's degree of polarisation | — |
| **Gratings** | period, orders, efficiencies | — (one wavelength at the grating, as dispersion does) |

The rules around them:

- **A dependency is stated, never switched on.** "Requires Spectral" greys the feature and names what to switch on.
  "Works, averaged" keeps it on and says in the feature's own box what the numbers mean then.
- **Switching off loses nothing.** The values stay in the file and do not reach the shader (`only`'s rule, extended
  to the feature). The block says once per scene what is hidden: "2 materials have an Abbe number; dispersion is off".
- **How much the user knows.** Three presets set the features in one click:
  - *Basic*: RGB, no extra fields;
  - *Optics*: absorption, dispersion, coating edges, detectors;
  - *Expert*: everything built.

  Any feature changed after that reads *Custom*, as Quality does. The level is the scene's: a beginner's example opens
  plain, a dichroic model opens Expert.
- **Render settings are about sampling, scene settings about physics.** `dispersionOff` moves out of the render
  settings and out of Quality's Standard into the scene. That is a change to the scene file's `version`
  (`bump: minor`). An old file reads as dispersion on, which was the default. A workspace that had it off reads as off
  in each of its scenes.
- **The status bar names the model running**, as the modeline names the build (`builder/modeline.js`):
  "RGB · dispersion", "spectral 4λ · polarisation".
- **A preview in a cheaper model** than the final render is possible (inferred: the same scene compiled twice). It
  would be a choice in the Optical features block, labelled in the picture, because the numbers differ. Open: whether
  the user wants it.

## 2. The foundation: one spectrum type in the kernels

What makes every later setting cheap to add is pbrt-v4's SampledSpectrum, done the way `VEC3` already is: a text
macro (`lib/wgsl_shorthand.js:19`).

- **The type and its functions:** `SPEC`, with
  - `specMul`;
  - `specFromRGB`: an RGB material's colour as a spectrum, by a fixed basis;
  - `specToRGB` / `specToXYZ`: at the deposit;
  - `specLum`: for Russian roulette, the firefly clamp and the photon map's gates, which read luminance today
    (`wavefront.js:1142, 465`);
  - `specCollapse`: to one wavelength, for dispersion and a grating;
  - `specRedraw`: new wavelengths after a phosphor, by Kasha's rule (§4.2).

  All BSDF and transport code is written against `SPEC`. In RGB `SPEC` is `vec3<f32>` and every function is the
  arithmetic there now.
- **The Ray composed from the features**, with the host's `RAY_BYTES` read from the same table, so the two cannot
  disagree. `structs.gpu.mjs` checks every combination against the compiler.
- **The picture stays RGB in every setting.** Radiance is added along the path and deposited once at its end
  (`wavefront.js:1325`, read in code). A sum is linear, so radiance can become RGB as it is added, and only `beta` and
  `mu` grow with K (inferred from that linearity; one exception is noted: emitter NEE multiplies by the emission at the
  hit, `wavefront.js:1522`, so its shadow ray needs a `SPEC`). Only a detector that asks gets more channels (§3).
- **The test:** in RGB, every kernel's text byte for byte today's, for every scene — the haze box's test, widened.

## 3. Data, independent of the setting (and useful in RGB)

- **Spectra:**
  - Planck, CIE illuminants, LED models (a pump plus a phosphor, asymmetric Gaussians), a CSV of nm against
    relative power;
  - the **user's LED database** (the user, 2026-10-30): an Excel workbook of LEDs, with Vf and flux against current and
    temperature and spectra digitised from datasheets. A light is then chosen by name, with its spectrum and its flux.
    Its format is read when that step comes, not before (inferred: not seen yet). Current and temperature are a step
    after, because they change the source, not the ray;
  - a Zemax ray file's wavelength, read and dropped today (`optics/sources.js:107-121`, `optics/zemax.js:52, 81`).

  In RGB a spectrum becomes its exact XYZ, then RGB, as a chromaticity does today, so the step is useful before any
  spectral kernel exists.
- **Materials:**
  - spectral reflectance and transmittance;
  - an absorption spectrum k(λ): coloured glass, PMMA's UV edge;
  - Sellmeier coefficients from a glass catalogue beside today's Cauchy;
  - a metal's complex index n, k.
- **A wavelength range per scene:** 380-780 nm by default, wider (say 300-1100) for UV curing, photodiodes and IR. The
  CMFs are 0 outside the visible; a detector with its own response counts it.
- **Detectors with response curves:**
  - XYZ (today);
  - radiometric W;
  - photons and PPFD (horticulture, µmol/s in 400-700 nm);
  - melanopic EDI (circadian);
  - a UV dose.

  Each is one more weighted tally a hit. A spectrum per detector cell gives CRI and TM-30. These bands cost detector
  memory, not ray memory, so bands belong at the detector whatever the ray carries (inferred).

## 4. The optical phenomena

1. **Thin films and multilayer coatings: how a dichroic stays fast.** The host computes a coating once and the shader
   reads a table:
   - **the table:** R and T against λ and cos θ, s and p apart. It is filled from a layer stack (a material and a
     thickness a layer, through the transfer matrix, Abelès) or from a vendor's measured curves (R(λ) at a few angles
     of incidence, interpolated);
   - **in the shader:** one lookup a hit, so **the cost does not depend on the number of layers** (inferred: a lookup
     against today's 41 softplus differences, `spectral.js:162-172`, to be timed by a bench row);
   - **in RGB:** the same table averaged per channel, as today. Today's logistic edge is one way to fill a table;
   - **without polarisation:** the s and p average, exact for unpolarised light at one interface;
   - **metals:** a thin film on a metal (heat-tinted steel, anodised titanium: SURFACES.md) is the same machinery;
   - **bench:** a quarter-wave AR layer and a stack against their closed forms.
2. **Phosphor.** A thin layer first (the user's choice, 2026-10-29), a volume after (item 3). Light falls in:
   - **absorbed** by A(λ);
   - **re-emitted** with a quantum efficiency into its own spectrum, whatever blue pumped it (Kasha's rule), with the
     Stokes loss in energy;
   - **passing** for the rest.

   With K wavelengths the K collapse into one absorbed count and K new ones are drawn from the emission (forward) or
   the absorption (from the camera), with nothing lost (computed: phase 0's phosphor row, stratified, 0.118 a path).
   Bench: a blue beam on a plate, the energy balance in closed form; the colour over angle of a remote phosphor plate.
3. **Scattering inside solids**: opal PMMA diffusers, phosphor in silicone, fluorescent PMMA. It is the haze box's
   vertex (`core/haze.js:439-514`) with each material its own medium: σ(λ), a phase function (Henyey-Greenstein, Mie
   later), and fluorescence. This is MEDIA.md phase 3; that file keeps the media's own plan, and this one the colour.
4. **Polarisation.** What it adds:
   - a Stokes vector with its frame, and a Mueller matrix at each interface (exact s and p Fresnel, a coating table's
     s and p);
   - a polariser as a material, a polarised source (a laser, an LCD's light), a detector reading the degree of
     polarisation.

   When it matters: beam splitters, near Brewster, a light guide's many reflections (PLAN.md C: unpolarised Fresnel
   is -0.3 % on a slab's transmission at 45 degrees, -3 % at 70). Birefringence is later or never: its ordinary and
   extraordinary rays could be a random pick, and the stress birefringence of moulded PMMA matters only between
   polarisers.
5. **Diffraction, bounded honestly.**
   - **Gratings and DOEs:** a surface with a set of orders. The grating equation for each order, its efficiency from
     scalar theory or a table computed elsewhere (RCWA). A grating collapses a spectral ray to one wavelength, as
     dispersion does, and mono (K = 1) suits laser work.
   - **Engineered or holographic diffusers:** a measured scatter BSDF, no wave optics needed.
   - **The camera aperture's diffraction** (a starburst, a bloom, for hero shots): a pass in the Darkroom, the PSF the
     aperture's Fourier transform per wavelength. No cost to a ray.
   - **Not modelled, and said so:** general wave propagation, coherence between paths, diffraction at small edges,
     speckle. A path tracer is geometric optics plus the local wave effects that have a closed form (thin films,
     gratings). SURFACES.md's "diffraction by fine grooves … is wave optics and outside this renderer" still holds
     for a CD's grooves as geometry; as a grating, this item covers them.
6. **What else users will ask, and where it goes:**
   - measured BSDFs and the ABg scatter model of optical software: a material, any colour setting;
   - IES / EULUMDAT in and out: planned (PLAN.md, FEATURES.md);
   - UGR;
   - circadian quantities: §3;
   - camera sensor curves instead of the CMFs: §3's response curves on the picture;
   - an LED's flux and spectrum with current and temperature: §3, the source.

## 5. Speed, and how it is watched

- A feature is switched on only by a compile, and a feature off is today's text byte for byte (§2's test).
- A grating or dispersion collapses a spectral ray to one wavelength, and from there it costs no more than one
  (inferred).
- A coating table is one lookup whatever its layers (§4.1).
- **A row in `lib/pathtracer/tests.js` for each setting**: one scene, the setting switched, so the user measures the
  real price on their Pascal and Ampere cards. Its note gives the ray budget as arithmetic, not as a time. Nothing
  here is timed locally (CLAUDE.md).

## 6. The order proposed

One PR a step, each with its change note, its Node and Dawn tests, and its `tests.js` row for the hardware.

| step | what |
|---|---|
| **S0a** | **The Optical features block** and its presets. Dispersion, absorption and coating edges move into it and hide their fields when off; `dispersionOff` out of the render settings. Useful with no new physics. |
| **S0** | The `SPEC` type and the composed Ray, RGB byte for byte. Nothing visible; everything after rests on it. |
| **S1** | Spectra as data (§3), the user's LED database among the sources, exact RGB. |
| **S2** | Spectral (K = 4, and K = 1) in the optics trace, with spectral detectors. **The user's priority (2026-10-30):** response curves first (W, PPFD, melanopic, UV: weighted tallies), then a spectrum per cell for CRI and TM-30. |
| **S3** | Spectral in the picture, the photon map included, and the same detectors in the measure tool. A photon's wavelengths are not the camera path's (PLAN.md C 4). A bench decides between one draw shared by a sample and bands for photons only: N bands, here and only here. |
| S4 | Coating tables: stacks and measured curves. |
| S5 | The phosphor layer. |
| S6 | Polarisation. |
| S7 | Scattering inside solids (MEDIA.md phase 3). |
| S8 | Gratings and DOEs. The Darkroom's aperture diffraction is independent and can come at any time. |

After S3 the user chooses the order of S4-S8.
