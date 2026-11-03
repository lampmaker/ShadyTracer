bump: minor

**Scatter inside a material: milky glass, whose thickness shows.** Two new material fields, *scatter distance* (the
mean free path between scatterings, in mm whatever the scene's unit, as the colour depth) and *scatter forward*
(Henyey-Greenstein's g), make the volume itself scatter. A thick part is then milkier than a thin one: milky or opal
glass by the block, a light guide's diffusing body. Haze (0.81.0) scatters at the faces whatever the thickness; this
scatters inside.
- **Each scattering is a step of the march**, not a bounce, so a dense, thick part may need more Max Iterations to
  read its full brightness.
- **A beam is seen inside it: the photon map in the volume.** A collimated beam through slightly milky acrylic shows
  its track, as a laser's does. Photons are stored where they scatter in the glass, and a camera ray gathers them
  where it first scatters. Light sampling cannot reach inside smooth glass, so this is how that light reaches the
  picture; with the photon map off it is found only by chance (and a collimated beam not at all). Like the surface
  map, it starts a little soft and sharpens as samples come in. It needs two storage buffers more in the march; desktop
  adapters usually offer 16 a stage (tinywebgpu's note, not checked here), and on one with only the spec's 8 the beam
  stays unseen.
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
- A collimated beam (a builder light set to collimated) through a thin sheet of slightly milky glass, seen from the
  side, the photon map on: the beam's track should show inside the glass and sharpen with samples.
- The library's *milky glass* as a thin sheet and a thick block side by side: the thin one should show what lies behind
  it, the thick one glow.
- On the Optics page, the light guide example with a scatter distance.

**The photon map's keep is planned on the GPU, from the sample before.** When a sample's photons ask for more stores
than the map holds, it keeps a share of them, planned from what the sample before stored. The host planned it from a
readback. RT.step, which the Tests panel's image rows sample with, records every sample before the first readback
lands, so every sample of such a row ran on the first guess, a surface's two stores a photon.
- **Inside milky glass**, where a photon stores at every collision, every sample overflowed: `volume-map` read 0.546 on
  the user's card.
- **With a medium's higher guess** (256 a photon) it read 1.01, but on a map 30x too sparse: kept 0.00082 at the 64th
  sample.

A one-thread kernel now plans the keep at each sample's start, from the count still in the map's heads. The host hands
over only the first guess, for a fresh map. This holds for the surface map too, in any row the Tests panel samples. The
`volume-map` row pins the map's radius and capacity, and shows the map's columns: records, dropped, samples over, cut,
kept and radius.

**Measured on the user's Ampere:** `volume-light` agreed on three presses (within 0.25 %). `volume-map` read 1.0006 at
94a1903 (880 × 896), with the map at 0.85 of its room, kept 0.032, and nothing dropped or cut.

**The photon map has a radius of its own inside glass.** It is under Render settings › Light sources › Photon map,
*radius inside glass (pixels)*, with the developer settings shown. It defaults to 10 pixels, where the surface's is 3.
- **Why:** a gather inside glass finds what lies in a sphere, so what it finds goes as the radius cubed. At the
  surface's radius it found about 0.01 records on the bench's milky sheet, and a beam's track was grainy.
- **Its own grid:** the photons stored inside glass go on a grid of their own, and the radius shrinks over samples as a
  volume shrinks.
- **On Dawn:** twice the surface's radius read the same mean, and the spread across a lit slab's face fell from 0.172 to
  0.068.
- **The limit:** near the glass's own faces a large radius reads dark. The sphere sticks out of the glass and is divided
  as if whole, so keep the radius well under the glass's thickness.

**An image row in Tests waits for the kernels its settings ask for**, as a timing row did. Switching the photon map in a
scene that scatters builds every kernel again. The row's samples were refused while that ran ("trace while the scene's
pipelines are being built"), and a second press worked. The map's columns are read once the row's samples are done, not
from the first sample.

**What to look at:** the beam's track through slightly milky glass, the photon map on: smoother than before, and
sharpening as samples come in. If it is still grainy, raise the radius inside glass; if the glass reads dark near its
faces, lower it. Press `volume` and `volume-map` in Tests and paste them back: `volume-map` now gathers inside glass
at 10 pixels (its `r glass mm` column). `sppm` and `dichroics` take the same plan for the keep.
