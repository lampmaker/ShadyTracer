bump: minor

**Scatter inside a material: milky glass, whose thickness shows.** Two new material fields, *scatter distance* (the
mean free path between scatterings, in mm whatever the scene's unit, as the colour depth) and *scatter forward*
(Henyey-Greenstein's g), make the volume itself scatter. A thick part is then milkier than a thin one: milky or opal
glass by the block, a light guide's diffusing body. Haze (0.81.0) scatters at the faces whatever the thickness; this
scatters inside.
- **Each scattering is a step of the march**, not a bounce, so a dense, thick part may need more Max Iterations to
  read its full brightness.
- **Light sampling cannot reach inside smooth glass**, so a milky part lit by a small lamp is noisy until it settles.
  The sun's photons do light what lies beyond it.
- **The Optics page's rays walk it too**, through the same march. No test runs that page with it yet.
- **Only a scene with a scattering material compiles the walk**; every other scene's march is the text it was.

The library gains *milky glass (scatters inside)*: a free path of 3 mm, g 0.7. Scene format 26; files of 25 open as
they rendered, with a clear volume.

**What changes for existing scenes:** a medium's absorption is now kept in f16, beside its scattering, because the
ray had no room for more. A colour depth's exp(-mu L) moves by at most 3e-4 over 10 m. Every kernel's text changed with
it.

**Checked without a GPU and on Dawn over lavapipe, not on hardware:**
- A walk in JS through an index-matched slab is held to Beer-Lambert, to energy and to the diffusion regime. The
  march's own walk passes what it passes at three depths.
- Milky spheres vanish in the furnace, with light sampling on and off.
- A floor lit through a milky slab reads one mean by the camera's own paths, the sun's photons and the photon map.

**What to look at:**
- The library's *milky glass* as a thin sheet and a thick block side by side: the thin one should show what lies behind
  it, the thick one glow.
- On the Optics page, the light guide example with a scatter distance.

Press `volume` and `volume-light` in Tests and paste them back.
