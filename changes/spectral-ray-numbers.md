bump: patch

**Which spectral ray, computed before one is built.** A new test, `lib/pathtracer/core/test/spectralnoise.test.mjs`,
puts three ways a ray could carry a spectrum side by side on an LED's light: one wavelength a path, four hero
wavelengths (drawn Wilkie's way and pbrt-v4's), and 8, 16 or 40 fixed bands. The light goes through a grey, a
dichroic, an amber filter, two filters met at a gather, and a phosphor layer. For each way the test gives one path's
noise, summed exactly over every wavelength draw and checked against Monte Carlo, or the bias against a 0.1 nm
integral. Today's RGB is in the table too. Through an edge filter it is 6-10 % off in Y on these cases. The table
and what it leaves open are in `roadmap/PLAN.md` C 4. Nothing in the application changes.

**What to look at:** nothing on screen. The table in PLAN.md C 4 is the decision to take: the noise of hero
wavelengths against the bias and memory of bands, and whether the RGB coatings' Y error on an LED matters to you.
