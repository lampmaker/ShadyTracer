bump: patch

**A light given by its spectrum now throws its own rainbow through a prism.** You reported two wrong pictures. The
450 nm LED (10 nm wide) threw a fan of blue from 380 to 510 nm through a prism, plus a band of red at the red end,
where it emits nothing. A red LED put a band of red in the violet. The picture's renderer carries three colour
channels, and a ray gets a wavelength only when it refracts into dispersive glass. That wavelength was drawn from
the channels' own weights, whatever the light emits, so each channel's light was spread over every wavelength that
channel covers. The 450 nm LED's colour at luminance 1 is (3.69, −4.60, 48.5). Its red part went where the red
channel's weights are, 83 % of them at 560–640 nm. The red LED's red lost the 4.6 % of the red channel's weights
that sit below 480 nm, in the violet. These figures come from the code's own weights, not from a measurement.

Now a photon from a light given by its spectrum carries that light's spectrum with it. That means a peak, a table
or a blackbody (a CCT on the locus). At the first dispersive glass the photon draws its wavelength from that
spectrum, in 1 nm cells from 380 to 780 nm, and takes that wavelength's exact colour, a negative channel and all.
So a narrow LED's light leaves the prism only at its own wavelengths, each in its own colour, and the rainbow still
adds up to the light's colour. Anything that coloured the photon before the glass carries over channel by channel.
The tables are in `core/lightspectra.js`. They sit in the renderer's learn buffer, past its microfacet tables (shade
has no binding to spare), and the picture's photon source writes them there. A photon names its table in `Ray.pix`.

**Not changed:**
- A light seen *through* a prism by the camera is still each channel spread. A camera path draws its wavelength at
  the glass before it knows which light it will reach. Only the camera's paths can reach a light behind a prism
  through a pinhole, so the LED itself, seen through the glass, still looks smeared. The rainbow it throws on a wall
  or floor comes from the photons, and is now right.
- A light given by RGB, xy or a CCT off the locus has no spectrum, and draws as before.
- Past 16 distinct spectra in a scene, the rest draw as before, and the console says how many.

**What to look at:** your two scenes again: the 450 nm LED (peaks `450 10 1`) and the red LED through the prism.
- The blue LED's rainbow on the wall should be a narrow blue band, with nothing at the red end.
- The red LED's should be a red band, with nothing in the purple.
- A white light given by a spectrum (a blackbody or a measured white LED) should still throw a full rainbow.
  Its colours should now be each wavelength's own, rather than each channel's share of one.
- The LED seen directly through the prism is unchanged (above).
- `core/test/prism.gpu.mjs` renders this on a simulated card: a beam through a 30° prism onto a wall. Both of your
  cases read nothing where they used to show red. The same lights given only by their colour, the old way, do show
  it there, so the check can fail.
