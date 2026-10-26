bump: patch

**Answers along the ray, counted before anything is built** (`builder/test/alongray.gpu.mjs`, a test; no renderer
change). You asked about exact intersections for basic shapes, a relief included, for rays running nearly parallel to a
surface. Exact hits existed once and were removed, so this time the steps were counted first.
- **The idea:** a plane, a box, a sphere, a cylinder or a flat rectangle can say exactly how far along the ray its
  surface is, instead of the march creeping towards it. The step is the least of those answers and everything else's
  distance.
- **Reliefs:** a relief on a plane says whether the ray can meet its band at all (|z| within the bumps' height). A ray
  that never meets the band never meets the relief, and one that does reaches the band in one step.
- **Counted on a software GPU** through the renderer's own march, steps a ray before -> after:
  - **Shadow rays under a low sun (5 degrees):** dichroics 29.5 -> 4.2, the prism scene 65.1 -> 6.6, the showcase 45.1
    -> 15.9, the Noise library 41.8 -> 21.9, the Menger cubes 140.8 -> 86.7.
  - **Camera rays:** dichroics 18.3 -> 9.3, the Noise library 19.6 -> 13.4, the showcase 15.9 -> 11.7.
  - **Rays grazing the prism scene's table at 0.1 to 0.5 degrees:** 31 of 320 reach it plainly within the step limit,
    all 320 with answers.
  - **No change** on the optics bench and the demo, whose shapes sit inside CSG groups or group code.
- **Checked:** every answer against a brute march and its JS twin; the answers off marching exactly as now; no answered
  ray through a solid.
- **Not known:** what a step with answers costs on a card. That needs a build behind a switch, with a bench.

**What to look at:** nothing in the page changed. The numbers are in docs/PERFORMANCE.md (STATUS 2026-10-26).
