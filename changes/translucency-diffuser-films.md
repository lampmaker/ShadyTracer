bump: minor

**Translucent materials, diffuser films, and light through frosted glass found by light sampling and the lights' rays
instead of by chance** (`roadmap/DIFFUSERS.md` B1 and B2). Three changes:
- **Rough glass's transmission is evaluated, not only sampled.** Two estimators can now follow light through a frosted
  face, in Standard and High. Light sampling aims through the face a path leaves glass by. A photon in glass connects
  out to the camera through the face it leaves by.
- **A new material field, translucency.** It is the share of the diffuse body that passes through, spread evenly: an
  opal diffuser, paper, a lampshade.
- **Two new fields, film spread x and y.** What the material transmits is spread about the straight-through direction
  by that FWHM in degrees, at each face, instead of refracted: a holographic or engineered diffuser film, round or
  elliptical along the material's grain.

In Draft, Sketch and the Optics view all three are followed as frosted glass always was. The Optics page's ray trace
samples them as it samples any material. The library gains *opal diffuser (50 %)*, *diffuser film 10°* and *elliptical
diffuser film 60° × 1°*; scene format 25 (files of 24 open as they rendered).

**What changes for existing scenes:**
- **Frosted glass** (roughness from 0.224 up) now counts as a diffuse bounce for Max Diffuse Bounces, as gloss always
  has: with a low cap, what lies behind frosted glass gets darker.
- **Material2 is 112 bytes**, so a sample holds about 3 % fewer rays a batch (2.10 M where it held 2.16 M), which only
  shows as an extra batch on very large pictures with photons.

**Checked without a GPU and on Dawn over lavapipe, not on hardware:**
- The lobes' value, density and draw agree with each other.
- A slab with one frosted, opal or film face, seen from below under the sun, reads the same with light sampling and
  the photons on or off, each way round.
- Translucent and film spheres vanish in the furnace.

**What to look at:** an LED (a builder light) behind a frosted cover, an opal sheet and a film, in Standard:
- they should show the same brightness as before, with far less noise at equal samples;
- in Draft they should look as they always did.

Press `furnace-beyond`, `transmission-parity` and `light-vs-emitter` (its diffuser pairs: frosted, opal, film) in Tests and
paste them back. The Optics page's tallies through an opal sheet show its spread. The investigation behind this, with
what was decided and measured while it was built: `roadmap/DIFFUSERS.md`.
