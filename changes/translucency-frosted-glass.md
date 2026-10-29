bump: minor

**Translucent materials, and light through frosted glass found by light sampling and the lights' rays instead of by
chance** (`roadmap/DIFFUSERS.md`). Two changes:
- **Rough glass's transmission is evaluated, not only sampled.** Two estimators can now follow light through a frosted
  face, in Standard and High. Light sampling aims through the face a path leaves glass by. A photon in glass connects
  out to the camera through the face it leaves by. Anisotropic rough glass too, so an elliptical diffuser is a
  material's own roughness and anisotropy.
- **A new material field, translucency.** It is the share of the diffuse body that passes through, spread evenly: an
  opal diffuser, paper, a lampshade. Each face is the same surface from either side.

In Draft, Sketch and the Optics view both are followed as frosted glass always was. The Optics page's ray trace samples
them as it samples any material.

The library gains:
- *opal diffuser (50 %)*;
- *diffuser film 10° (frosted polycarbonate)*, a thin sheet of rough glass whose roughness, 0.36, spreads a ray
  head-on by about 10° FWHM.

Scene format 25; files of 24 open as they rendered.

**What changes for existing scenes:**
- **Frosted glass** (roughness from 0.224 up) now counts as a diffuse bounce for Max Diffuse Bounces, as gloss always
  has: with a low cap, what lies behind frosted glass gets darker.
- **Material2 is 112 bytes**, so a sample holds about 3 % fewer rays a batch (2.10 M where it held 2.16 M), which only
  shows as an extra batch on very large pictures with photons.

**Checked without a GPU and on Dawn over lavapipe, not on hardware:**
- The lobes' value, density and draw agree with each other, anisotropic too.
- A slab with one frosted, opal or anisotropically frosted face, seen from below under the sun, reads the same with
  light sampling and the photons on or off, each way round.
- Translucent spheres vanish in the furnace.

**What to look at:** an LED (a builder light) behind a frosted cover, an opal sheet and the library's 10° film, in
Standard:
- they should show the same brightness as before, with far less noise at equal samples;
- in Draft they should look as they always did.

Press `furnace-beyond`, `transmission-parity` and `light-vs-emitter` (its frosted and opal diffuser pairs) in Tests and
paste them back. The investigation behind this, with what was decided and measured while it was built, and why a
diffuser film of its own was built and taken out again: `roadmap/DIFFUSERS.md`.
