bump: minor

**A spectral ray file lights the picture in each ray's own colour.** A Zemax file with a wavelength on every ray (its
format 2) was drawn in one colour, what all its rays add up to: the wavelength of each ray was read and then dropped.
Now each of its rays lights the picture in that wavelength's exact colour, from the CIE's own table at 1 nm, so a light
whose colour changes with direction shows that change where its rays land, on the walls and through the camera's lens.
- Each ray keeps its wavelength in the packed ray data (`optics/sources.js placeRays`, the direction's fourth slot,
  which was always 0), only for a file with one a ray: a flux-only file's header wavelength is often a placeholder.
- The picture's photon carries its wavelength in its tag, as a dispersed ray does, so glass refracts it at its own
  index instead of drawing a wavelength. A coating now meets any ray that has a wavelength of its own (this one, or a
  dispersed ray) at that wavelength exactly, the same reflectance in every channel, not each channel's average
  (`materials_pbr.js makeLobes`). The average assumed each channel's light spread over that channel's wavelengths,
  which a single wavelength is not.
- A file in lumens gives each ray its luminous flux; one in watts its radiant flux times y-bar. A ray the eye cannot see
  carries nothing. The set is scaled so its mean luminance is what the light's flux says, as before, and the colours add
  up to the file's own colour (`zemax.js raysXYZ`) exactly (`optics.test.mjs`).
- The Analysis pane's own trace is unchanged: it traces such a file in its overall colour, its tallies in the file's
  unit. Its spectral trace still treats the file as a smooth spectrum of that colour; using each ray's own wavelength
  there is still to do (`roadmap/LIGHT_MODEL.md`).
- Checked on Dawn over lavapipe (no picture seen, no card; `lenslight.gpu.mjs`, `coating.gpu.mjs`): a disc whose left
  half emits 450 nm and right half 610 nm, seen through the lens in a mirror. Its 450 nm half reads 1765 +- 14 cd/m^2
  against the 1753 its rays make by the same arithmetic in JS (lm), and 249 +- 2 against 246 (W). Its colour per unit
  luminance is 450 nm's to 1e-3 in every channel, a negative green of -4.76 among them. A coating at a ray's own
  wavelength gives R(lambda) in every channel at 0 and 45 degrees and inside the glass; with the wavelength not handed
  to it, 12 checks fail.
- Speed not measured: a ray file's photon does one table read more when it starts, and a coating meeting a ray with a
  wavelength skips the per-channel average (41 exp and log) for one.

**What to look at:** load a spectral Zemax file (format 2), if you have one, and look at what it lights and at the
light itself through a lens with an aperture. The colour should vary where the file says it does, and over the whole
picture it should average to the colour its Properties give. Few samples are speckled in strong colours (each photon is
one wavelength) that settle into the real colour. A flux-only file should look exactly as before, and so should a
dichroic lit by an ordinary light.
