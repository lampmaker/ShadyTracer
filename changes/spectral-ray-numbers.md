bump: patch

**Which spectral ray, computed before one is built.** A new test, `lib/pathtracer/core/test/spectralnoise.test.mjs`,
puts three ways a ray could carry a spectrum side by side on an LED's light: one wavelength a path, four hero
wavelengths (drawn Wilkie's way and pbrt-v4's), and 8, 16 or 40 fixed bands. The light goes through a grey, a
dichroic, an amber filter, two filters met at a gather, and a phosphor layer. For each way the test gives one path's
noise, summed exactly over every wavelength draw and checked against Monte Carlo, or the bias against a 0.1 nm
integral. Today's RGB is in the table too. Through an edge filter it is 6-10 % off in Y on these cases. The table
and what it leaves open are in `roadmap/PLAN.md` C 4. Nothing in the application changes.

**And a roadmap from it:** `roadmap/LIGHT_MODEL.md` -- what a ray carries (colour, polarisation, a medium), each
a scene's choice in an Optical features block that also decides which material fields are shown (dispersion off,
no Abbe numbers), with Basic / Optics / Expert presets; coatings from layer stacks as a table, phosphor, scattering
inside solids, polarisation, gratings, and what diffraction stays outside; the order, spectral detectors first.

**What to look at:** nothing on screen. The table in PLAN.md C 4 is the decision to take: the noise of hero
wavelengths against the bias and memory of bands, and whether the RGB coatings' Y error on an LED matters to you.
And `roadmap/LIGHT_MODEL.md`: whether the Optical features block and its order are what you want.
