bump: minor

**A ray file's colour is chosen as a rectangle's is, and can be its header's wavelength.** A ray-file light had no
colour rows: a spectral file took its rays' own colours and a flux-only file was white, whatever its header said. Its
Properties now offer what a rectangle or disc light does -- RGB, CCT + Duv, CIE xy, a spectrum -- with two more first:
*from the file* (the default: what it did before) and *its header's wavelength* (every ray at that one wavelength).
- At a wavelength the eye cannot see -- the user's ams-OSRAM LZ4-00R608 file says 854 nm, an infrared emitter -- the
  light shows nothing in the picture and lights nothing, as a camera would see it. Before, a flux-only file in watts
  was always shown as white light of that many lumens. Its rays still trace on the Optics page, in the file's watts.
- At a visible one, every ray is that wavelength's exact colour and carries it, so glass refracts it at its own index
  and a coating reflects it at that wavelength. The spectral optics trace takes it as a line 0.01 nm wide.
- The four other ways colour every ray of the file alike, its own wavelengths left aside.
- The line under the choice says what it comes to for the file loaded (`optics/sources.js rayFileColour`, the one place
  it is decided, for the Optics page and the panel alike).
- A ray file's default colour is its own (`builder/lights.js lightDefaults`), so RGB chosen for one is stored and read
  back as RGB, not dropped as the faces' default. No file version change: a builder from before refuses the two new
  values by name.
- Checked (no picture seen, no card): `optics.test.mjs` (each choice on a flux-only file at 854 nm and a spectral one,
  a chosen infrared wavelength giving its record K 0), `model.test.mjs` (stored and read back, refused on a rectangle),
  `lenslight.gpu.mjs` on Dawn over lavapipe (854 nm chosen: the mirror's image and the wall exactly 0; the same rays not
  chosen: white, 1742 cd/m^2 in the mirror, as before).

**What to look at:** select the ray-file light in the Builder. *Colour by* should offer *from the file*, *its header's
wavelength (854 nm)* and the four of a rectangle. With your LZ4-00R608 file at its header's wavelength, the picture
should be dark where it was dimly white, the line under the choice saying why, and the Optics page's numbers should not
change. Pick *RGB* or a CCT and the light should take that colour.
