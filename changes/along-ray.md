bump: minor

**Answers along the ray, behind a developer switch (Answers along the ray, Render settings › Performance), with Tests ›
alongray to time it.** You asked about exact intersections for basic shapes, a relief included, for rays running nearly
parallel to a surface. Exact hits existed once and were removed, so this time the steps were counted first, then built
behind a switch, off by default.
- **What it does.** A plain sphere, box, cylinder, plane or flat rectangle says exactly how far along the ray its surface
  is, and the march and the shadow rays go nearly that far in one step instead of creeping towards it.
  - **The nearest only:** at each step only the nearest of them works out its answer; the others count by their
    distance, as before.
  - **The culling boxes too:** a culled object's box says where the ray enters it, where before it gave only its
    distance.
  - **Which shapes:** only those under plain groups and arrays. A shape inside a CSG group, a blended group or group code
    answers by its distance as before, since those bend what "the first crossing" means.
  - **Reliefs:** a relief on a plane answers for its band (the slab the bumps live in). A ray that never meets the band
    never meets the relief, and one that does reaches the band in one step.
- **Where it acts:** the scene compiled as code (`lib/pathtracer/core/along.js`, `builder/codegen.js` `along`,
  `lib/pathtracer/core/wavefront.js` `along`).
  - That is the bake, which is what you see once the edits stop, and the editing build with Scene as data off.
  - The scene as data has no answers.
  - Turning the switch makes the scene shown again, and the bake follows.
  - Off, codegen's text and every kernel are byte for byte what they were.
- **Counted on a software GPU** through the renderer's own march, steps a ray, without -> with:
  - **Shadow rays under a sun 5 degrees up:** dichroics 29.5 -> 4.2, the prism scene 65.1 -> 6.6, the showcase 45.1 ->
    15.9, the Noise library 41.8 -> 21.9, the Menger cubes 140.8 -> 86.7.
  - **Camera rays:** dichroics 18.3 -> 9.3, the Noise library 19.6 -> 13.4, the showcase 15.9 -> 11.7.
  - **Rays grazing the prism scene's table at 0.1 to 0.5 degrees:** 31 of 320 reach it plainly within the step limit, all
    320 with answers.
  - **No change** on the optics bench (its shapes are in CSG groups) and the demo (in group code).
- **Checked on a software GPU** (`builder/test/along.gpu.mjs`):
  - every answer against its JS twin and a brute march;
  - the scene's text with answers, in every kernel that does not read them, marching exactly as without;
  - no answered ray through a solid, nor ending inside one;
  - the bake with answers marching as codegen's with them;
  - the whole renderer with and without answers, a haze box among the scenes, each picture's mean within its paired
    error bar.
- **Found while building it, and fixed before this:** a step exactly to the answer ended some rays a hair inside the
  surface, where f32 rounding put them (19 in 100 of the showcase's camera-ray hits). Every picture's mean read a little
  low. An answer now stops half the tolerance short.
- **The first build, measured on your Ampere, Tests › alongray** (`ShadyTracer 0.78.0 · 4c69c91 (ccr-0f3a020a-590jz2) ·
  nvidia ampere`, 2026-10-26), with every shape answering at every step: fewer steps, mostly not less time. GPU ms a
  sample, without -> with:
  - **Slower where many shapes answer:** dichroics 176.1 -> 189.7 (its march +15 %), the Noise library 91.6 -> 106.9,
    the showcase 39.9 -> 42.0 (its march +28 %).
  - **Faster where few answer and rays graze:** the material test under a 5 degree sun 38.1 -> 32.3, its shadow rays
    5.0 -> 2.9 ms.
  - **About even:** the prism scene, the material test, the Menger cubes.
  - **The run's own noise:** the optics bench answers nothing, and its two identical rows read 12 % apart.
  - **The likely cause (inferred):** every answering shape worked out its answer at every step. The numbers are in
    docs/PERFORMANCE.md. Hence the nearest only, with the boxes, since: not measured yet.
  - **Off by default, so nothing changes unless you turn it on.**
- **Tests › alongray:** each scene baked twice, without answers then with. It runs dichroics and the prism scene first,
  each with its light's photons; the prism scene is new to the bench, frozen from the example and seen 5 degrees over its
  table. Then the material test, also with a sun 5 degrees up, the Noise library, the Menger cubes, the showcase, the optics
  bench (only its culling boxes answer: its shapes are all in CSG groups), and a drift row.

**What to look at:**
- Turn Render settings › Performance › Answers along the ray on and off, and wait for the bake. Look at the prism scene's
  beam on its table, dichroics' floor and plates, and anything seen at a grazing angle or under a low sun. The picture
  should not change beyond noise; the prism scene's table may now be reached where rays ran out of steps before.
- Run Tests › alongray again and paste the report. Read march and occlude down each scene's two rows, and against the
  first run's.
