bump: patch

**A ray's wavelength at dispersive glass is now drawn in 1 nm steps instead of 10 nm, so a rainbow seen through glass
no longer changes colour in bands.** You asked whether the spectral resolution could go down to 1 nm, perhaps as a
setting. Two things used 10 nm:

- **The camera's wavelength draw.** A camera path, or the photon of a light given by RGB, xy or a CCT off the locus,
  draws its wavelength at the first dispersive glass. It drew it from 40 bins of 10 nm, and took its bin's colour.
  The wavelength itself was always anywhere in its bin, so the angle it bends by was never rounded. Only its colour
  was. So the colour in a rainbow seen through glass changed in 10 nm steps. Near 480 nm, where the hue turns fastest,
  two neighbouring bins were 0.136 apart in u′v′ (computed). The draw is now a table of 400 cells of 1 nm, built from
  the CIE's own 1931 table rather than the analytic fit. The largest step between two cells is 0.014, at 478 nm
  (computed). As before, each channel averages exactly 1 over the draw, and no weight is above 3. The fit's red end,
  where its red response stops at 733 nm, is gone from the draw: in the CIE table red responds to 780 nm.
- **A coating's reflectance per channel** stays at 10 nm. At 1 nm the same arithmetic moves the reflectance by at
  most 0.009 (computed, for an edge 0.01 to 30 nm wide anywhere from 390 to 770 nm). It would also add up 400 terms
  at every coated surface instead of 40.

**There is no setting**, because this change should not make anything slower:
- The new table sits in the learn buffer beside the lights' spectra (`core/lightspectra.js` `CAMERA_TABLE`), and
  the draw finds a cell by binary search: 9 reads where the old bins took a loop of up to 40.
- The draw runs once per ray, where it enters dispersive glass.
- Both points are read in the code. Nobody has timed it.

A second draw kept behind a switch would be code that nothing runs.

The optics bench row `optics-dispersion` now expects red −23.886°, green −24.177°, blue −24.859°. The old
10 nm bins gave −23.891°, −24.177°, −24.860°.

**What to look at:**
- A white light seen *through* a prism or a dispersive glass ball, the view where the camera's own draw shows: its
  rainbow fringes should change colour smoothly, without bands.
- The speed of a scene with dispersive glass should not change. If it does, the Render stats against the previous
  build's would show it, and the 10 nm bins can come back as an option.
- Tests > `optics-dispersion` expects the new angles above.
