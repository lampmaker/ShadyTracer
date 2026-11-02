bump: minor

**Haze on any transmissive material, scatter inside one, and light through frosted glass found by light sampling and
the lights' rays instead of by chance** (`roadmap/DIFFUSERS.md`). Four changes:
- **Rough glass's transmission is evaluated, not only sampled.** Two estimators can now follow light through a frosted
  face, in Standard and High. Light sampling aims through the face a path leaves glass by. A photon in glass connects
  out to the camera through the face it leaves by. Anisotropic rough glass too, so an elliptical diffuser is a
  material's own roughness and anisotropy.
- **Transmission and haze.** Transmission is how much passes through. The new field **haze** is how much of that is
  diffused, spread evenly on the far side, instead of going straight: a datasheet's haze (ASTM D1003). Roughness
  stays the narrow blur.
  - Clear acrylic with a veil is transmission 1, haze 0.06.
  - An opal diffuser, paper or a lampshade is haze 1.
  - Each face a ray crosses scatters it.
- **Scatter inside a material.** Two new fields, *scatter distance* (the mean free path, in mm) and *scatter forward*
  (g), make the volume itself scatter, so a thick part is milkier than a thin one: milky glass, a light guide's body.
  Haze scatters at the faces whatever the thickness; this scatters inside. Each scattering is a step of the march, so a
  dense, thick part may need more Max Iterations. Light sampling cannot reach inside smooth glass, so a milky part lit
  by a small lamp is noisy until it settles. The Optics page's trace walks it through the same march (not yet run by a
  test).
- **A face that both refracts and diffuses is now right when seen from inside.** This covers hazy glass, and any
  transmission between 0 and 1. From inside the glass, light used to get through where total internal reflection
  forbids it: a hazy glass sphere read 1.23 in the furnace with light sampling and 0.92 without. Light diffused into
  the glass past the critical angle was also never let out. Now it reads 1.

In Draft, Sketch and the Optics view all of it is followed as frosted glass always was. The Optics page's ray trace
samples it as it samples any material.

The library gains:
- *opal diffuser (50 %)*;
- *hazy acrylic (10 % haze)*: haze 0.059 a face, from a walk of the sheet;
- *milky glass (scatters inside)*: a free path of 3 mm, g 0.7;
- *diffuser film 10° (frosted polycarbonate)*, a thin sheet of rough glass whose roughness, 0.36, spreads a ray
  head-on by about 10° FWHM.

Scene format 25; files of 24 open as they rendered.

**What changes for existing scenes:**
- **Frosted glass** (roughness from 0.224 up) now counts as a diffuse bounce for Max Diffuse Bounces, as gloss always
  has: with a low cap, what lies behind frosted glass gets darker.
- **A material with transmission between 0 and 1** (half glass, half a diffuse body) renders differently where it is
  seen from inside: before, it gained light there.
- **A medium's absorption is kept in f16** (with its scattering: the Ray had no room for more), so a colour depth's
  exp(-mu L) moves by at most 3e-4 over 10 m. Every kernel's text changed with it; only a scene with a scattering
  material gets the walk in its march.
- **Material2 is 112 bytes**, so a sample holds about 3 % fewer rays a batch (2.10 M where it held 2.16 M), which only
  shows as an extra batch on very large pictures with photons.

**Checked without a GPU and on Dawn over lavapipe, and pressed on an Ampere card** (`furnace-beyond` 14 of 14,
`transmission-parity` 16 of 16):
- The lobes' value, density and draw agree with each other, anisotropic too.
- A slab with one frosted, opal, anisotropically frosted or hazy face, seen from below under the sun, reads the same
  with light sampling and the photons on or off, each way round.
- Opal and hazy-glass spheres vanish in the furnace, and so do milky ones.
- An index-matched scattering slab passes what a walk in JS passes, thin and thick; that walk is held to Beer-Lambert,
  to energy and to the diffusion regime. Hazy glass needs 2000 march steps for that: light trapped past
  the critical angle walks long, and at the default 400 a smooth hazy sphere reads 0.992.

**What to look at:**
- In Standard, an LED (a builder light) behind a frosted cover, an opal sheet and the library's 10° film:
  - they should show the same brightness as before, with far less noise at equal samples;
  - in Draft they should look as they always did.
- The library's *milky glass*: a thin sheet and a thick block side by side. The thin one should show what lies behind
  it, the thick one glow. On the Optics page, the light guide example with a scatter distance.
- The library's *hazy acrylic* over a checkerboard: the checks should stay sharp under a faint veil.
  - Haze 0.2 and 0.5 should be milkier but still show an image.
  - Haze 1 is an opal.

Press `volume`, `volume-light` and `light-vs-emitter` (its frosted and opal diffuser pairs) in Tests and paste them
back. The investigation behind this is in
`roadmap/DIFFUSERS.md`, with what was decided and measured while it was built. It also says why a diffuser film of its
own was built and taken out again, and why translucency became haze.
