# Performance — compile time and render time

Why this exists: a structural edit (adding or deleting a node, changing a primitive or an op, giving an
object a material, editing code) recompiles the kernels that inline the scene, and on the user's
hardware (Ampere, 2026-09-29) that took **~10 s for *Surface materials*** (7.4 samples/s) and **~20 s for
*Noise library*** (0.8 samples/s), after the fix in *What a compile is made of* that brought it down
from over a minute. An editor that stalls for 20 s on a delete is not usable. Moving, resizing,
recolouring and — with *instant hide/show* — hiding are already uniform writes and compile nothing; this
is about everything else, and about render speed.

Every line below says how it is known (CLAUDE.md: "Do I know this is true, or do I think it is
true?"). A plan built on inferences written as facts was reverted (commit fdc3339):
it had called one scene's slow render "this architecture's full-resolution cost", which the user's
own numbers contradict.

## STATUS (2026-10-16) — a glass-and-light scene: what it runs, what went (0.61.2), what to measure next

The user asked (2026-10-16) whether render speed can be improved without losing anything of the picture, on
`scenes/dichroics.json`: seven dichroic plates, a mirror and a prism under one collimated light sheet, a relief floor,
the studio light. **Nothing about such a scene had been measured**: no bench row loaded it, and every bench row ran with
the photon map off (`tests.js` BENCH_BASE) and without a builder light's photons (the page lights only its own scene:
`optics/page.js` O.picture.applies). A code audit (read in code throughout; 61 candidates, each checked against the code a
second time) found what follows.

**How a sample of it is traced** (read in code):
- **Light chains.**
  - The studio light means no sun: no sun photons, no `lt_build`.
  - There are no emitters.
  - The light's photons are the only ones. It is collimated, so they connect to the camera at every surface they land on
    and are stored in the photon map at every evaluable one (`sppm.js` sppmUnmet).
- **Every light sample is a cosine-weighted studio direction.** A collimated face has weight 0.
- **The photon map never idles here,** because the floor is seen through the plates. Its photons-first plan makes a
  1280 x 720 sample **two wavefront chains where one would hold it** (`photons.js` planInOrder). At 1920 x 1080 it is two
  either way.
- **Each chain is the worst-case budget:** 24 iterations of 9 passes, plus 12 shadow rounds of 3. That is at least 504
  compute passes a sample (`raytrace_main.js`).
- **Within 1 mm of the floor, every march step evaluates the relief's fBm.**

**Gone in 0.61.2: work whose result was exactly 0** (exact, measured, see the CHANGELOG):
- `ltConnect` and the light sample at a surface with no evaluable lobe: a mirror, clear glass, a dichroic.
- The BSDF density at a delta event.
- `envPdf` below the surface.
- Four albedo-table reads nothing used.
- The photon map's gate compared roughness with alpha floors, so the 0.02 mirror stored and gathered for an f of 0.
- Photons stored at maxbounce, which no gather can accept.
- `prog_sppm` reading the hit's material before the ray's own gates.

How much time any of it saves is **not measured**.

**The instrument: Tests > dichroics** (`bench/dichroics.js`). The frozen scene, baked and lit by its own light's photons.
- **The rows:** the map on and off at 1280 x 720 and at 1920 x 1080, NEE off, the lights' rays off, the step cache, and
  the editing build.
- **The per-kernel columns** include `opt_photons` (timed as "other" before 0.61.2) and `sppm`.
- **The map's counts:** stored, dropped, and **cut**.
- The `sppm` image row has a `cut` column too.

**MEASURED: Tests > dichroics, its first run** (the user's card, `ShadyTracer 0.61.2 · 7256423
(claude/inspiring-darwin-vspz6x) · nvidia ampere`, Chrome 155, 2026-10-16). Each row is the median of 23-64 timed samples.
Row 9 (row 1 again) read +0.38%, so the run held still.

| row | ms/sample | gpu | march | surface | shade | occlude | sppm | map M | dropped | map cut | batches |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 baked, as it is (map on) | 196.0 | 181.8 | 110.4 | 13.9 | 19.1 | 20.2 | 16.2 | 1.332 | 0 | **1792** | 2 |
| 2 photon map off | 173.3 (-11.6%) | 164.1 | 104.2 | 13.1 | 21.2 | 21.7 | - | - | - | - | 1 |
| 3 NEE off | 179.6 (-8.3%) | 166.2 | 111.1 | 13.9 | 17.6 | 5.8 | 16.4 | 1.330 | 0 | 1733 | 2 |
| 4 the lights' rays off | **67.2 (-65.7%)** | 60.7 | **29.8** | 4.5 | 9.0 | 16.6 | (stale) | | | | 1 |
| 5 1920 x 1080, map on | 382.2 | 374.7 | 233.3 | 31.6 | 41.6 | 38.7 | 27.1 | 2.000 | **993 823** | **3578** | 2 |
| 6 1920 x 1080, map off | 369.0 | 362.4 | 235.6 | 29.3 | 47.7 | 44.5 | - | - | - | - | 2 |
| 7 the step cache filled once | 198.6 (+1.4%) | 183.3 | 112.8 | | | | | | | | 2 |
| 8 codegen (the editing build) | 226.8 (+15.7%) | 213.2 | 133.4 | | | | | | | | 2 |

`opt_photons` read 0.3 ms. Gaps between passes were 0.1-0.2 ms, and wall - gpu about 14 ms. Row 4's map columns are a
reading left over from another trace: the map ran no photons there (batches 1). Read from it:
- **The light's photons are two thirds of a sample** (196 - 67 = 129 ms), and mostly **march** (110 - 30 = 80 ms).
  - The wavefront log puts the photons' chain at about 118 ms of GPU against the camera's 58.
  - In its first iteration (32 march steps) 471 000 of the 922 000 photons met no surface, and no photon's path
    ended in the first three.
  - Inferred (read in the scene, not measured): the sheet starts 27 mm above the floor and points 2 degrees down
    (`axis.z` -0.035). Sphere tracing a ray that runs down onto a plane at 2 degrees closes about 3% of its height a
    step, so it takes on the order of 100 steps to come down from 27 mm.
- **The photon map is wrong, not only slow, at this scene's settings.**
  - At 1280 x 720, 1792 gathers a sample were cut at 512 records.
  - At 1920 x 1080 it dropped 993 823 of its stores past the 2 M capacity, a third of them, and cut 3578 gathers.
  - Both make the floor seen through the plates darker than it is: a bias that does not average away.
  - The collimated light's photons are stored at every surface they land on, about 1.44 stores a photon here.
- **What the map costs:** 22.7 ms a sample at 720p, of which the sppm kernel is 16.2 ms; 13.2 ms at 1080p.
- **The step cache buys nothing here** (+1.4%, within noise). **The bake buys 13.6%** against codegen.
- **NEE costs 16.4 ms** of 196.
- **Not the cost:** the worst-case iteration budget. Gaps are 0.1 ms, and the drained tail is 21 ms of the photon chain,
  most of that photons genuinely still bouncing.

**Next, each gated by a reading from that test** (inferred, every one, until the numbers come back):
1. **The photon map's cut and overflow -- DONE in 0.61.3.** The user's run read both above 0.
   - **Measured on Dawn** (an RTX 3080 Laptop): over the pixels the map lights, against an exact map, 0.61.2 read 0.355
     of the light at 1280 x 720 and 0.274 at 1920 x 1080.
   - The densest list held 8,315 records.
   - **The fix** (`sppm.js` NEITHER FULL NOR CUT): stores kept with a probability when a sample would overfill the map,
     and full cells walked by random sub-lists. Both are exact in expectation.
   - It reads within the run-to-run spread of the exact map at both sizes (0.884-1.000, the exact map's own second run
     0.894-0.978). Overflow and cut were 0 on Dawn.
   - **Its cost on a card is not measured:** re-run Tests > dichroics.
2. **Slicing's batch count (the live view only).**
   - What the code does: a sample slower than sliceMs (30) is cut into K batches, and each batch runs the whole
     24-iteration chain. K is sized from frame times that include that fixed cost (`raytrace_main.js` A SAMPLE OVER
     SEVERAL FRAMES).
   - The hypothesis: K climbs toward its cap.
   - The test: Developer › GPU time a frame at 0, 15, 30 and 60, interleaved, and whether "batch k/K" climbs.
   - If it does: estimate the per-batch fixed cost on its own, `K = ceil(W / (sliceMs - a))`, at most twice the last
     sample's K.
3. **The second chain.**
   - The test: rows 1 against 2 (720p) beside rows 5 against 6 (1080p).
   - If the 720p gap is clearly larger, a deferred gather lets photons and camera rays share one chain. That is the same
     expectation with a different noise.
4. **The occlusion kernel on a distance-only scene text,** if `occlude` is a large share: no transforms' normals or
   materials at a shadow ray's steps. Codegen would make it for scenes that cannot emit.
5. **Pass folds, then one compute pass per chain,** only if `iteration-cost` (with `envMode: 1` pinned) shows the
   off-GPU cost of an iteration still matters.
6. **The relief:**
   - the measured 11.2 bound instead of the summed 17.2 (row 11 of the benchmark, still unseen);
   - a directional bound on a plain plane;
   - an analytic half-space test for the floor in occlusion.

   Each needs a ray-end check on Dawn and the user's eye. The scene keeps its own copy of the relief code.
7. **Variance trades, each judged on effic with meanLuma holding:**
   - Russian roulette for photons past their first scatter;
   - roulette for shadow rays;
   - the studio's share of light samples;
   - Draft's seek rays in a scene that cannot emit.
8. **The step cache** (off by default):
   - a bake swap restarts the picture with it on (`index.html` pushStepBox);
   - moveFast refills it at every move's start and end (renderMode, nee and lt in its key);
   - the photon map's idle key resets on a Sketch round trip.

   Fix these before any default changes. Its cell (about 3.2 mm here) is wider than the relief's 1 mm band, so it cannot
   help near the floor (read in code).

**Rejected, so they are not proposed again** (each changes the estimator or biases it):
- fewer iterations or shadow rounds, or a shorter budget for photons, all against the user's choice of 2026-10-03;
- a photon map one sample late, which reads the emitter list and radius of another sample;
- turning the map or NEE off for a scene;
- folding `prog_sppm` into shade, which is at the 8 storage bindings;
- an allow-list step-cache key;
- dropping stepscale;
- thinning the stored photons as a fix for the cut, which keeps the brightest first landings capped.

## STATUS (2026-10-02) — measure first

**Which scene is the hard one -- corrected.** This file, and the first version of the benchmark, said
*Surface materials*. The user, later: "the noise library is the most difficult one" and "the noise
library is also the one that has the longest compilation time. I mentioned the surface earlier as the
hardest scene, but I meant noise." The numbers below are the *Noise library*'s.

**The relief's own step bound -- built 2026-09-30 as the benchmark's row 11, NOT yet measured, NOT yet seen**
(the user: "build the measured step limit row"). Run 5 put the reliefs' remaining cost in march and occlude, which
is the steps inside the band. Their length is set by the slope the relief divides by:
`1 + amount / size x (its fBm's bound) / peak`.
- **The bound was** the one-octave bound summed over the four octaves, 17.2: every octave at its steepest,
  pointing the same way, at one point. **Row 11 divides by one measured for the relief's fBm itself**
  (`noise.js` NZ_RELIEF_LIP_MEASURED = 11.2).
- **Computed here** (the JS twin of the noise; a property of the function, not a cost): fbm3 with seed 1, four
  octaves, x2, 0.5 reaches 8.905 at most over 14.4 million points in a million first-octave cells. 4.8 million
  more over four other regions reach 8.84. 1.25 x 8.905 = 11.13, rounded up to 11.2.
  - `noise.test.mjs` fails if its search finds a slope within 25% of the bound.
  - `relief.test.mjs` computes the relief field's gradient at points inside the band, on the real noise, over
    the step bound: 0.80 with the modifier's bound, 0.88 with the measured one. A quarter of the measured
    bound gives 1.12, which the test requires, to show the check can fail.
- **The slopes, computed from the formula,** for the Noise library's six reliefs: 1.92 -> 1.60, 2.10 -> 1.72,
  2.38 -> 1.90, 2.72 -> 2.12, 2.47 -> 1.96, 1.61 -> 1.40 (13-22% lower). Expected, inferred: fewer steps inside
  the band, so less march and occlude time. What would test it: row 11 against row 10, kernel by kernel.
- **For the user to see:** `BENCH.view(11)` against `BENCH.view(10)`. A bound that is too small shows as holes,
  speckles or eroded spots on the reliefs, where the march stepped through.
- **Only the benchmark runs it.** The builder's relief keeps the summed bound until the row has been seen and
  timed (`modifiers.js`: one `reliefCode` function writes both, so they cannot drift apart).

**Next, open questions (after the fifth run):**
- the reliefs' remaining march and occlusion (50 + 36 ms of GPU time): the steps inside the band. Row 11 (a step
  bound measured for the relief's own fBm, above) to measure, and to look at;
- how march and occlude grow with the number of objects, and the optics bench's compile and kernel times, never
  measured (P3, step 0: it decides whether the scene as data needs a BVH on top);
- shade's 21-35 ms in every scene, and its +55 ms at physically x20;
- the wall clock of the fast rows, up to 35 ms longer than their GPU time;
- the 17.7 s the page takes to measure the Noise library's 20 boxes, the scene unculled meanwhile -- the
  benchmark measures the same boxes in 1.2 s with the loop paused;
- what the box tests add to the compile (one machine, with and without them);
- the "in m, re-authored" row, fast in runs 1-4 and marching less in run 5;
- whether the budget reset changes what the next run's settings rows say about row 1;
- what the non-unrolled march costs the render: never measured (*What a compile is made of*);
- the uncached compile on Ampere: the profile's ~4 s against the benchmark's 21-23 s (*After the boxes
  change*).

### The runs, oldest first

**Measured, by the user, earlier:**
- The *Noise library* (`scenes/noise.json`) at 100% resolution: a structural edit takes over a minute
  to compile; it renders at less than one frame a second. (Machine not given with these numbers; the
  previous sessions record the user's as Ampere, Windows, Chrome/D3D12.)
- showcase, demo, Menger cubes and materials render **about 6x faster** at the same resolution.
- (Earlier, recorded in the previous session's handoff: Surface materials ~10 s a structural edit and 7.4
  samples/s, Noise library 20-50 s and ~0.8 samples/s, resolution not recorded; one TDR device loss.)
- The benchmark's first version, partly run on a **GTX 1080 Ti** (Windows, Chrome 154, report dated
  2026-09-29T18:17Z, code fingerprint 65bbb292), *Surface materials* at 1280 x 720, before it was
  stopped at row 7. **The camera looked down through the softbox** (the user saw it; the camera was
  wrong, see TESTING.md), so these rows measure that view, and the benchmark now starts from the
  Noise library with a new camera -- they are kept as what was measured, not as a baseline:

  | row | ms/sample | vs. the first |
  |---|---|---|
  | as it is | 57.9 | |
  | light tracing off | 36.3 | -37.3% |
  | NEE off | 50.6 | -12.6% |
  | sun and sky, not the studio light | 51.0 | -12.0% |
  | softbox emission 0 | 65.1 | +12.4% |
  | anisotropy 0 everywhere | 61.0 | +5.4% |

**Measured, by the user -- the benchmark's first full run** (GTX 1080 Ti "nvidia pascal", Windows,
Chrome 154, 2026-09-29T18:52Z, 282 s; code at fafa241 -- the guard number in its console error is in
the range that commit introduced; the table is copied from the report the user pasted).
1280 x 720, ms per sample, median:

| row | ms/sample | vs. row 1 |
|---|---|---|
| Noise library, as it is | 736.5 | |
| light tracing off | 508.8 | -30.9% |
| NEE off | 615.0 | -16.5% |
| sun and sky, not the studio light | 693.8 | -5.8% |
| softbox emission 0 | 823.8 | +11.9% |
| maxiter 128 (default 400) | 781.4 | +6.1% |
| maxbounce 4 (default 10) | 780.4 | +6.0% |
| noise materials plain (and no p_local tracking) | 708.8 | -3.8% |
| **reliefs removed (plain shapes)** | **81.1** | **-89.0%** |
| only relief 1 mm / 10 mm | 155.1 | |
| only relief 3 mm / 25 mm | 157.9 | |
| only relief 0.3 mm / 2 mm | 164.4 | |
| only relief 1.5 mm / 8 mm (granite) | 172.1 | |
| only relief 0.4 mm / 2.5 mm (leather) | 168.0 | |
| only relief 2 mm / 30 mm (marble) | 152.9 | |
| in cm, re-authored | 721.2 | -2.1% |
| in m, re-authored | 652.8 | -11.4% |
| in m, converted (as a paste) | 722.2 | -1.9% |
| physically x20 (m) | 687.8 | -6.6% |
| Surface materials | 80.0 | |
| showcase / demo / Menger cubes / materials | 93.1 / 95.6 / 177.2 / 61.8 | |

- The reliefs are the Noise library's render time: without them it renders at 81.1 ms, as Surface
  materials (the same layout, no reliefs) does at 80.0. One relief alone adds 72-91 ms; the six alone
  add 484 ms summed, and together they add 655 ms.
- The unit rows ran the same kernel text as row 1 (fingerprint c943f830). "in m, re-authored" lies
  outside row 1's own min-max (724-752) and its neighbours'.
- Uncached compile, the time until genrays, march, occlude and shade were ready (the other nine kernels
  were not timed, see below): Noise library 7931 ms, its materials plain 4562, its reliefs removed 4318,
  Surface materials 4149, showcase 2917, Menger cubes 2706, demo 2163, materials 1532. Shade was the last
  kernel ready in every scene. The `in cm` row's swap-in (7782 ms, the same text as row 1, whose own
  swap-in took 109 ms) looks like a cache miss, and matches row 1's uncached 7931: evidence, inferred,
  that the guard times a real compile.
- The same run logged `'workgroupBarrier' must only be called from uniform control flow` for lt_build --
  the benchmark's own guard line (below), not the renderer, whose kernels are built without it.

**Measured, by the user -- the benchmark's second full run** (GTX 1080 Ti, Windows, Chrome 154,
2026-09-30T08:48Z, 303 s, an incognito window: every swap-in was a cold compile; code at eda0611 or later):
- **Reproduced:** Noise library 737.3 ms/sample (run 1: 736.5); reliefs removed 81.5 (-89%); Surface
  materials 72.3; the single-relief rows 149.6-188.7 (run 1: 152.9-172.1, in another order).
- **The drift band:** row 1 repeated read 737.3, 784.2 (after the settings rows) and 714.9 (after the
  unit rows) -- 9.3% of their mean. Against the nearer repeat: maxiter 128 -0.5%, maxbounce 4 -1.8%, the
  softbox dark +3.3%, materials plain within the band. So run 1's "slower when doing less" was drift, and
  nothing here under ~10% is resolved.
- **"in m, re-authored" -10.2%** against its neighbouring repeat (run 1: -9.5% against its neighbours),
  on the same kernel text; cm +0.5%, converted +0.1%, x20 -1.6%. Unexplained.
- **Compile, all 13 kernels timed:** Noise library 8149 ms (shade 8148, occlude 1893, march 887, the
  other nine by 278); materials plain 4483; reliefs removed 5019; Surface materials 4151; showcase 2510,
  demo 1914, Menger cubes 2693, materials 1376. Shade was last in every scene.
- **The uncached compile is a real compile:** each cold swap-in matched its uncached compile -- 8375/8149,
  4548/4483, 5333/5019, 4237/4151, 2685/2510, 1951/1914, 2692/2693, 1447/1376 ms.
- One relief alone adds nothing measurable to the compile (cold swap-ins 5.2-5.5 s against 5.3 s for
  none); the reliefs and the material code together take it from ~4.5-5 s to 8.1 s.
- Computed: shade's text is 152-171k characters in every scene, and its length does not predict its
  compile time (Surface materials 164k and 4.2 s, the Noise library 171k and 8.1 s).

**Bounding-box culling -- built 2026-09-30, SEEN and MEASURED the same day** (P2 below, proposed by the
user). Every top-level node of the render copy is first measured against its box (`codegen.js`, the SDF's
root; `scene_api.js` cullDist); farther than `cullMargin()` (ten surface tolerances), its box distance stands
in and it is not evaluated. The boxes are the measured ones (`boxes.js`), for every node,
padded by a lattice cell and any smooth union's bulge, unknown (never culled) while missing, open, hidden or
stale. A group that folds a shape of its own is measured too: a relief's displaced surface is tagged with
the group, and without that a relief's box was its undisplaced shape, up to `amount` short (read in code;
`boxes.test.mjs` reproduces it with exact shapes). The renderer setting `cull` (Renderer panel, "Ray marching",
a developer's; "Normals and diagnostics" until 0.16.0) turned it off -- until 0.34.0, which removed it: since then the
builder tests a box only on a top-level node dearer than it, never on one plain shape (`codegen.js`, ONLY THE DEAR
ONES; measured twice in Tests > boxcost, `roadmap/ARCHITECTURE.md`), and only the bench makes a scene with every box
or none.
- **Seen, by the user:** the pictures with `cull` on and off are identical.
- **Measured, by the user -- the benchmark's third full run** (Ampere, Windows, Chrome 154, 2026-09-30T10:12Z,
  611.6 s, code at 84a4d35), each culled row beside the same scene with its boxes off:

  | scene | culled | boxes off | |
  |---|---|---|---|
  | Noise library | 298.8 | 817.7 | 2.74x (-63.5%) |
  | Surface materials | 103.8 | 116.9 | -11.2% |
  | showcase | 109.5 | 149.5 | -26.7% |
  | demo | 117.5 | 149.7 | -21.5% |
  | Menger cubes (3 of 5 boxes) | 250.1 | 315.5 | -20.7% |
  | materials | 76.3 | 100.2 | -23.9% |

  - Every scene faster, none slower. **Run 4 revises this** (below): with the same scene texts, the other
    scenes gain 3-13% and materials nothing; run 3's pairs were inside its drift.
  - Run 3 found a box for **13 of the Noise library's 14** top-level nodes (14 of 14 in its variants). Read
    in code: a group's fine measurement was laid only where the coarse lattice had tagged that group, and on
    the exact-shape sampler 3 of the 6 relief objects find no points of their own (inside a relief the
    group's fold is the nearer). Now a group with no coarse points is looked for over its objects
    (`boxes.test.mjs`), and `boxesUnknown` / `CULL_REPORT()` name any node without a box. Seen after it, by
    the user: `CULL_REPORT()` empty for both studio scenes, `[boxes] 20 measured in 17718 ms` in the page
    (14 objects, 6 relief groups; the compile from the cache, 0.4 s). Run 4: `14/14` in every row.
  - With the culling, the reliefs cost 206 ms of the Noise library's 299 (reliefs removed: 92.4). Before
    it they cost 656 of 737 on the 1080 Ti.
  - **The drift band on this machine is wide:** row 1 repeated read 298.8, 289.4 and 399.4 (after the unit
    rows), a third of their mean. So every comparison here is between neighbouring rows only. The row-1
    repeat right after the unit rows (399.4) reads like "in cm" (400.1) and "in m, converted" (399.9),
    while **"in m, re-authored" is 306.5, -23%** -- the third run in which that row is the fast one
    (-9.5%, -10.2% on the 1080 Ti).
  - Compile, uncached, on this machine: Noise library 21.2 s (shade 21.2), materials plain 20.0,
    reliefs removed 18.6, Surface materials 14.9, showcase 9.1, Menger cubes 8.1, demo 6.2,
    materials 4.1. It is 2.6-3.6x the 1080 Ti's for every scene, and the compile runs on the CPU, so
    this is the machine as much as the code. What the box tests themselves add to the compile has not
    been measured on one machine.

**The relief in a shell -- built 2026-09-30, MEASURED in run 4 (below), SEEN: the pictures look identical**
(P4 below; the user: "relief shell next"). With culling, the reliefs were 206 ms of the Noise library's
299 on the Ampere (measured, run 3, above). The relief now evaluates its noise only near its surface
(`modifiers.js` relief):
- **Proved** (`noise.js` NZ_GRAD_VALUE_BOUND, the proof beside it): gradient noise never exceeds
  NZ_GRAD_SCALE x sqrt(3)/2 = 1.386 in value, so the relief moves the plain surface by at most that x
  `amount`, its `reach`. `noise.test.mjs` checks the proof's one numeric step and climbs toward the largest
  value (1.046 found).
- **Read in code**: farther from the plain shape than 2 x reach + (slope + 1) x `marchEps()`, the relief's
  value is the plain distance less the reach -- a lower bound on the distance to the displaced surface, the
  same sign as before, never a hit. Inside that, the code is the relief as it was. The margin keeps a hit and
  its normal's differences (wavefront.js:684 the hit, tracebasics.js:86 the normal's step) on the noise's
  side, where the field is continuous.
- **Only where nothing above reads more than the surface.** Away from its surface the relief's field is now
  flat. A smooth blend or group code above it reads it there (a round offsets to another level of it, a
  blend's fillet reaches out to it) and would see a different shape. Codegen gives each group's code
  `SURFACE_ONLY`: true at the root and under plain unions; the blend's own live test under a CSG group; false
  under group code. Every relief in the Noise library is at the root.
  *Since 2026-10-01* the template reads `READ_REACH` (0 where `SURFACE_ONLY` is true, 5/4 of the blends in a CSG
  group, unbounded under code) and folds through `foldRelief` with `DIVIDED_ABOVE` (SURFACES.md, phase 6). At the
  root that is the same arithmetic, in different text: rows 10 and 11 run it from then on.
- **Checked here** (`builder/test/relief.test.mjs`): the template is the mirrored code line for line, its
  noise branch the frozen scene's relief; on the real noise over a sphere and a box, in scaled frames, the
  displaced surface lies within the reach, the shell keeps the old sign, never hits and is no farther than any
  surface point found, no hit's normal differences reach the edge, and SURFACE_ONLY is right for each kind of
  parent. check-shaders compiles the relief under all three kinds of parent.
- **Seen, by the user:** the Noise library's pictures look identical.
- **Measured:** the benchmark's row 10, "reliefs in a shell", against the drift check right above it (row
  9). Row 1 keeps the frozen relief, so it stays comparable with runs 1-3. **Run 4 says a third** (below).
- **The step bound NZ_GRAD_LIP_MEASURED (4.3): looked at, left as it is (2026-09-30; the user: "increase the
  step limit if you think it adds value").** It was meant to be 25% above the steepest one-octave gradient
  found.
  - **Computed here** (the JS twin of the noise, a CPU calculation of the function's values, not a cost):
    `noise.test.mjs`'s search finds 3.437 (the 3.380 this file first gave, copied from a comment of mine in
    the test, was wrong), 3.581 from other starts, and 3.854 in a long search (seven seeds, the relief's four octave seeds
    among them, a million cells each). So one octave on its own has 12% to spare, not 25%.
  - **But its only user is the relief**, which divides by the bound summed over four octaves: 17.2. The
    relief's own fBm (seed 1, four octaves) reaches 8.90 in a search of 4.8 million points, which leaves 93%
    to spare. Raising the constant to 4.9 (25% over 3.854) would buy the relief nothing, and cost 5-9% more
    steps near its surface (the slope's change for these reliefs, from the formula, not measured).
  - `noise.test.mjs` now holds the 25% margin on the relief's fBm, and claims no margin for one octave; the
    constant's comment in `noise.js` says both.
  - **A bound measured for the relief's own fBm** (11.2, against 17.2): built as the benchmark's row 11 once
    run 5 put the reliefs' remaining time in march and occlude (STATUS, top).

**Measured, by the user -- the benchmark's fourth full run** (Ampere, Windows, Chrome 154, 2026-09-30T11:56Z,
596.9 s, code at 2405edb):
- **The relief in a shell: 156.0 ms/sample, -22.9%** against the drift check right above it (202.3), and
  -21.9% against the second one (199.8). Reliefs removed: 75.5. So with culling the reliefs cost about
  127 ms (drift check less reliefs removed) and about 80 with the shell. **The shell took a third of their
  cost, not most:** the expectation written before this run (most of the 206 ms, since a ray now pays for
  the noise only within a few reaches of a relief) was wrong. Compile, uncached: 23.2 s,
  against row 1's 22.7.
- **Seen, by the user (2026-09-30):** the pictures look identical.
- **Where the other 80 ms is -- a hypothesis then.** The culling had already skipped the steps far from a
  relief, at its box, so the shell saves only the steps between the box's edge and the band. What is left is
  the steps inside the band, each divided by the slope (1.6-2.7 for these reliefs), taken by every ray that
  hits a relief or leaves one, and each hit's normal. Run 5 timed the kernels: march and occlude, not shade.
- **The drift was tight this time:** row 1 repeated read 216.6, 202.3 and 199.8. The two repeats agree
  within 1.3%. Row 1 itself is 7-9% above them. Run 5 showed why, most likely: row 1 ran 24 wavefront
  iterations a sample and every row from "maxiter 128" on 15 (below).
- **It corrects run 3.** Every row but the new one generates the same scene text at 84a4d35 (run 3's code)
  and at 2405edb: render and pick copies, compared byte for byte. The engine gained one WGSL constant that
  no old scene uses (read in code). Yet the same texts ran 15-38% faster than in run 3, except the Noise
  library with its boxes off (817.7 then, 839.8 now: +2.7%). So run 3's pairs sat inside its drift, and it
  overstated what the boxes do for the other scenes. Run 4's pairs, each culled row beside the same scene
  with its boxes off:

  | scene | culled | boxes off | |
  |---|---|---|---|
  | Noise library | 216.6 | 839.8 | 3.9x (run 3: 2.74x, 13 of 14 boxes) |
  | Surface materials | 75.8 | 79.8 | -5.0% |
  | showcase | 92.5 | 95.6 | -3.2% |
  | demo (7 of 8 boxes: the ground is open) | 88.1 | 101.5 | -13.2% |
  | Menger cubes (3 of 5: two hidden) | 201.2 | 210.5 | -4.4% |
  | materials | 63.3 | 61.8 | +2.5% |

- **All 14 of the Noise library's boxes in the benchmark's own measuring** (the open question from run 3):
  `14/14` in every row on it. The measuring took 1.2 s there (`boxesMs` 1183), with the live loop paused
  (read in code: the runner pauses the loop before anything else; bench.test.mjs checks it). The page took
  17.7 s for the same scene while rendering. That supports, and does not prove, the hypothesis that the
  page's measuring waits behind frames.
- **"in m, re-authored" is the fast one again:** 175.3, against 201.8 (in cm), 199.8 (in m, converted) and
  199.8 (the drift check after them): -12 to -13%. That is four runs out of four. All four unit rows run the
  same kernels (fingerprint f7b1ac9c, row 1's).
- Physically x20: 268.4, +34% against the drift check after it.
- Settings, against row 1 (which reads high): light tracing off -18.7%, NEE off -30.4%, sun and sky -7.9%.
  The softbox dark, maxiter 128 and maxbounce 4 are within +-3%.
- Compile, uncached: Noise library 22.7 s, in a shell 23.2, reliefs removed 13.8, materials plain 12.8,
  Surface materials 12.7, showcase 8.0, Menger cubes 7.5, demo 5.4, materials 3.7. Materials plain is the
  same text as in run 3, where it took 20.0. One text's compile moved 36% between runs, so a 2% difference
  within one run says nothing.
- **Recompiled, not cached:** "in cm, re-authored" has row 1's text and still took 22.4 s to swap in; the
  next unit row took 36 ms. Inferred: the browser's pipeline cache had dropped row 1's text after the nine
  other texts compiled in between. Test: row 1's text swapped back in straight after row 1.

**Measured, by the user -- the benchmark's fifth full run, the first with kernel times** (Ampere, Windows,
Chrome 154, 2026-09-30T14:18Z, 1442.7 s, code at 5f29694). GPU ms per sample, medians:

  | row | iterations | gpu | march | shade | occlude | genphotons |
  |---|---|---|---|---|---|---|
  | 1 Noise library, as it is | 24 | 250.4 | 127.8 | 34.7 | 72.2 | 12.4 |
  | 8 bounding boxes off | 15 | 988.9 | 771.9 | 33.0 | 168.6 | 10.9 |
  | 9 again (drift check) | 15 | 229.0 | 126.2 | 24.4 | 64.7 | 10.9 |
  | 10 reliefs in a shell | 15 | 166.3 | 78.3 | 32.7 | 43.3 | 12.4 |
  | 12 reliefs removed | 15 | 75.2 | 28.2 | 26.8 | 7.0 | 12.4 |

- **Where the reliefs' time is: marching, not shading.**
  - Row 9 less row 12 (the reliefs as frozen): march +98, occlude +58, shade -2.
  - Row 10 less row 12 (in a shell): march +50, occlude +36, shade +6.
  - So the shell took 48 ms off the march (-38%) and 21 off the occlusion rays (-33%). What remains is in
    those two kernels, the ones that march.
  - The normal, three extra scene evaluations per hit, is in shade (read in code: `tracebasics.js:396`,
    `calcNormals_fast`), and shade does not grow with the reliefs.
- **Shade is 21-35 ms a sample in every scene** (Surface materials 29.0, showcase 34.1, demo 31.9, Menger 27.1,
  materials 26.3), whatever the geometry. It is the largest kernel of the fast scenes. Within the Noise
  library's rows it moves between 24.4 and 34.7 with no change to what it runs, so read it to about +-5 ms.
- **genphotons is 11-14 ms in the two studio scenes** (the softbox's light tracing), 6.8 in showcase, and under
  1 ms in demo, Menger cubes and materials.
- **Physically x20: +68 ms of GPU time over the drift check after it, and 55 of those are shade** (89.9
  against 34.4). March +11.
- **"in m, re-authored" marches less:** march 106.6 against 123.8-129.0, occlude 56.4 against 64.8-73.3 in the
  rows beside it; shade the same. The same kernels (fingerprint f7b1ac9c), so the difference is in the
  uniform values. Inferred: a length in the march that re-authoring and converting set differently. Test:
  the march's steps per ray in the two rows.
- **Culling, in GPU time** (the wall clock of the fast rows carries up to 35 ms that no kernel has, see below):
  Noise library 250.4 against 988.9 with boxes off, 3.95x; Surface materials -6.7%; showcase -5.1%; demo
  -13.0%; Menger cubes -4.5%; materials +2.7%. The boxes save marching: with them off the Noise library's march
  is 772 ms, its occlusion 169.
- **Wall clock against GPU time.** The wall clock is longer by 0 to 44 ms a sample, and the gap changes from
  row to row: row 1 +2, the drift check 0, reliefs removed +11, in cm +44, materials +30. Showcase culled is
  116.8 against 82.0 GPU; its boxes-off row 97.9 against 86.4. In GPU time showcase's culling saves 5%; in
  wall clock it cost 19%. So a wall-clock difference between two rows can lie outside the GPU entirely, and
  the GPU columns are the ones to compare. Inferred: per-frame work outside the kernels (the display pass,
  the cut submissions, the wait for the GPU) that varies between rows. Test: the gap with the display pass
  left out.
- **The timestamps cost nothing visible:** the kernel samples' own wall clock is within -7% to +6% of the timed
  samples', in both directions (row 1 260.1 against 252.5, row 10 176.4 against 179.6, light tracing off 199.2
  against 212.9). Every
  small kernel reads a multiple of 0.032768 ms, so this browser's timestamps were rounded to 32.768 us here,
  not the 100 us Chrome documents.
- **A flaw in the benchmark, found by the pass counts, now fixed.** Rows 1-5 ran 24 wavefront iterations a
  sample; every row from "maxiter 128" (row 6) on ran 15; Menger cubes and materials 21. Read in code: the
  adaptive budget is clamped to `(maxbounce + 1) + ceil(maxiter / 32)` (`raytrace_main.js:1105`, `:1176`),
  grows back only when more than 1% of rays are cut short (`:1157`), never shrinks on its own (`:1175`), and
  nothing reset it between rows, so row 6 pulled it down to 15 and it stayed there (the fix: TESTING.md,
  *The benchmark*). **Measured:** row 1 at 24 iterations against its repeat at 15: 250.4 against 229.0 GPU
  ms, shade +10.3, occlude +7.5, march +1.6. **So** every settings row from 6 on, the drift checks and all
  the variants were compared with a row 1 that ran more iterations; the shell, reliefs-removed and
  single-relief rows all ran at 15, so they are comparable with one another. Runs 1-4 had the same row
  order (inferred: no pass counts then): run 4's "row 1 reads 7-9% above its repeats" was this, not the
  compile. From the next run, rows 6 on run 24 iterations: not comparable with runs 1-5. The live
  page has the same trait (read in code); `budget-image` says it moves the picture +0.03%.

### Read without a GPU

**Read in the scene files, and by running the host code in Node (facts about the CPU side, not costs):**
- The Noise library and Surface materials share a layout (floor, softbox, twelve objects in two rows of
  six at the same positions; the Noise library's are nine spheres and three boxes), are in mm, lit by
  the studio light (`envMode 1`) and the emissive softbox, and have material code reading `p_local` (6
  and 3 materials). The Noise library has no anisotropic metal and
  no glass; Surface materials has both; Menger cubes (fast) has anisotropic metal (3) and glass. The
  fast scenes are in metres.
- The Noise library's six lower objects are each inside a relief group whose code calls `fbm3` on the
  SDF's path (`// group nNN (union, code)` in the generated text); a group that keeps its code has its
  children emitted in a helper function, `children_nNN`, which its code calls.
- That code, as generated: `var H = children_nNN(emptyHit(r), p);` then `fbm3(p / size, ...)` with no
  test of `H`'s distance first, then the whole distance divided by `slope`. So every SDF evaluation, at
  any point in the scene, computes all six reliefs' noise, not only near their shapes. (Still so in the
  frozen copies; the builder's relief has the shell since, P4.)
- The noise materials' patterns do not depend on the unit: they take `p_local * S_local * perMm(...)`
  (the scene file), `p_local * S_local` is in scene units and `perMm(c) = c / metres(0.001)`
  (`noise.js:226`).
- Physical size, `generate(...).extent` times the unit: the fast scenes are 22-520 m across (the
  automatic tolerance at its 1 mm cap); Surface materials and the Noise library are 1.725 m (tolerance
  0.17 mm).
- The Noise library re-authored in cm or m (every declared length scaled, the reliefs' amount and size
  among them), or converted the way the builder converts a paste (positions and transform scale
  scaled), generates **byte-identical scene WGSL**, with the same physical extent and tolerance
  (bench.test.mjs checks it; Surface materials came out the same when the first version checked it).
  So a render-time difference between units can only come from how the kernels use unit-dependent
  VALUES.

**Read in code (what the code does; nothing here is a cost):**
- The renderer's fixed physical lengths, not relative to the scene: escape radius 400 m, photon square
  and emitter search +-15 m with a 16-cell emitter grid, `lmax` 1000 m (`uniforms.schema.js:196,78,83`;
  `tracebasics.js:26`; `wavefront.js:654`). For a 1.7 m scene all of these are large.
- Unit-dependent literals (a length in scene units, not through `metres()`): the pick kernel stops at
  `ray.ltot > 1000.0` (`pick.js:62`) -- 1 km in a m scene, 1 m in a mm scene, while the render stops at
  `metres(1000.0)`; `marchEps`'s floor `1e-7` (`tracebasics.js:85`); `emptyHit`'s `1.0e7`
  (`scene_api.js`); the optics trace's `escLen 2` / `maxDist 200` defaults (`optics/index.js:89-90`).
- `sceneExtent` (`builder/bounds.js`), which sets the automatic tolerance, takes the largest of EVERY
  numeric parameter as a length -- a count or an angle included -- because `toTree` does not pass a
  node's `lengths` on. For a scene with such a parameter the tolerance differs between units. (Not for
  these two: their tolerance came out identical.)
- When any material reads `p_local`, codegen adds `XF_P` bookkeeping to every node block of the SDF that
  has a transform (`codegen.js` `wantLocal`, set at line 792; the save and restore at 1047 and 1060) -- so
  it runs at every march step in every kernel, not only at the hit. Found by generating the scenes with and
  without their material code.
- The shade kernel inlines the scene's SDF at 8 sites; `mfLoad` reads the material tables with
  `atomicLoad`; every march step computes each node's normal and frame; every kernel's uniform struct
  carries every scene uniform; the builder's probe compiled a full pipeline.
- The live loop reads no GPU timestamp: it calls `cost.submitted(spp, false)` only
  (`render-loop.js:70`), so the page's ms/sample is wall clock, and so is the benchmark's `ms/sample`
  column (its header says so). The benchmark's `gpu ms`, `march`, `shade` and `occlude` columns, from
  run 5 on, are GPU timestamps on every kernel's pass (`core/kerneltime.js`; how: TESTING.md, *The kernel
  columns*).
- A sync pipeline's `ready` resolves at creation, before any compile (`tinywebgpu.js:1353`). Of
  the 13 wavefront kernels only genrays, march, occlude and shade are async (`genrays.js:85`,
  `wavefront.js:743,907,1064`), so the first run's compile column timed those four. The benchmark's
  device now makes every kernel async (`profile.js` profileWG).
- The guard that run used, `if (gid.x == N) { return; }`, put lt_build's barriers in non-uniform
  control flow: `global_invocation_id` is not uniform, `workgroup_id` is (gpuweb PR #1571). naga passed
  it; Tint refused it. It tests `wid` now (TESTING.md, *Why the workgroup id*).

### Settled, and believed

**Settled by the two full runs (measured, 1080 Ti, above):**
- the reliefs are most of the Noise library's render time (-89% without them, twice);
- NOT the finest relief: the single-relief rows moved about 10% between the runs and changed order;
- NOT the `p_local` material code and its bookkeeping (-3.8%, -4.6%: within the drift band);
- NOT maxiter or maxbounce making it slower: drift (the drift checks);
- the uncached compile measures a real compile (the cold swap-ins agree).

**Believed, not measured -- hypotheses, each with what would test it:**
- that the compile's doubling needs the reliefs AND the material code together (either alone ~4.5-5 s,
  both 8.1 s, measured) because the per-node `XF_P` bookkeeping a `p_local` material adds sits in every
  relief block, inlined at each of shade's SDF sites. Test: the material code kept, the bookkeeping gone;
- that "in m, re-authored" (-10%, twice) comes from a unit-dependent value in the kernels (the lists
  above) that differs between re-authoring and converting -- both are in metres, only the lengths inside
  the nodes differ. Test: rows that re-author only positions, or only parameters;
- that light tracing's emitter photons and NEE cost what their rows say (-30.9%, -16.5%) as a share of
  any studio scene, not only this one (the partial run on Surface materials read -37.3% and -12.6%);
- everything in the sections below this one that explains a cost: per-step normals, shade's size and
  occupancy, compile contention, a starved browser.

## What a compile is made of (measured on the text, not the GPU)

Every compiler behind WebGPU inlines every call, so what a driver compiles is each kernel with every
call replaced by its callee. Estimated inlined size, in tokens (scratch script over the kernels as
check-shaders builds them, 2026-09-29):

| scene | march | **shade** | occlude | one SDF |
|---|---|---|---|---|
| one sphere | 2.8k | **39.6k** | 3.7k | 0.4k |
| Surface materials | 17k | **122k** | 24k | 7.6k |
| Noise library | 31k | **175k** | 38k | 14.8k |

- **Shade is the compile.** The kernels build in parallel, so the wait is the largest, and shade is 4–7x
  the others.
- **40k of it is not the scene** — NEE, light tracing, the BSDF, the tables — yet it recompiles with
  every structural edit because the scene is compiled into the same module.
- **The scene is in shade about ten times**: normals by differences, getMaterial2 at the probe and the
  shade, the medium lookups beyond a surface, localPoint for patterned materials.
- **A scene of 13 plain objects is a 7.6k-token SDF**: every object is evaluated at every step, however far.

**Done since** (commit "One copy of the scene per call site"): loops around an SDF call no longer unroll
(`noUnroll`, `tracebasics.js:97`), and the local point is captured once per getMaterial2, not on the
medium lookup. That took the Noise library from over a minute to ~20 s. **Open, never run:** the march
loop was unrolled on purpose for speed; `cost-sweep` BASELINE on a scene with a number from before
(showcase) says whether that cost anything -- revert that one loop if it cost much. Each build logs when
every pipeline was ready (`RT.lastCompile()`); `RT.profileCompile()` times each kernel (below).

**A compile grows faster than its text** (2026-10-04). Over the 16 uncached builds the benchmarks timed on the
user's Pascal (`compile ms`, 2-46 s), the time is 0.736 x the linear prediction (15.2 ms per 1000 inlined characters)
to the power 1.37, seconds: rms 11%, worst 28%, against rms 27%, worst 59% for the line (the predictions computed in
node from the kernels' text; the times measured). `compileprogress.js` predicts with it since 0.20.3. Doubling a
kernel's inlined size costs 2.6 times the compile, so the lens assembly x 32 as codegen (97 s on the line, about 6.5
min on the curve) was still compiling after ten minutes -- past the data, so the curve is a floor there.
**And a scene as data still grows code with its copies** when a material reads `p_local`: there a group with code
(OpticsBench's pillar has a shell) is compiled, and so is every CSG group above it, once per copy
(`builder/scenedata.js` native, read in code). The lens assembly x 32 as data is 410 KB of WGSL against 38 KB for one
copy -- about 3 minutes predicted, never measured. Open.

## Measured: the pipelines are not the 20 seconds (Ampere, Noise library, 2026-09-29)

`RT.profileCompile()`, each kernel compiled alone from code no cache has seen:

| kernel | ms |
|---|---|
| shade | 3808 |
| shade, one sphere (the floor) | 2110 |
| occlude | 456 |
| march | 342 |
| march, one sphere | 254 |
| genrays, resolve, genphotons, lt_build, emit_collect | 0-3 |

(Its first version read shade at 12 ms: it recompiled the live source and the browser returned its
cached compile. Every profile compile now wraps the SDF in `+ opaqueZero x random`.)

Built in parallel, the scene's pipelines are **about 4 s**, and more than half of that is shade's
physics floor. So P1 below can save at most ~2 s of a structural edit, and **most of the ~20 s the user
sees is elsewhere**. Candidates, now each logged: the builder's probe compile (`[builder] scene applied:
probe .. ms, pipelines .. ms`), the measured boxes, which about a second after every structural edit
compile another full-scene kernel (the tagged field) and evaluate the scene on 64^3 and finer lattices
while the picture waits (`[boxes] N measured in .. ms`), and the pick kernel on the first click.
`profileCompile` now times tagfield and pick as well. **P1 waits until those numbers are in.** A second
profile, recorded in the session's handoff the same day: shade 3.9 s, pick 1.1, occlude 0.5, march 0.3,
tagfield 0.2 -- about 4 s alone, and about 4 s with `{ parallel: true }`.

## Measured: a structural edit, end to end (Ampere, Noise library, 2026-09-29)

    [pathtracer] compiled 'built' in 32.7 s; ready at (ms): shade 32741, occlude 6168, march 2578, genrays 728, ...
    [builder] scene applied: probe 1520 ms, pipelines 32779 ms, total 34396 ms
    [boxes] 14 measured in 37224 ms
    (a second edit: shade 29452, occlude 5852, march 2690; probe 3104 ms)

**Every compile took about 8x what it takes alone** (shade 29-33 s against 3.8 s, occlude 6 s against
0.46 s), and the one thing running beside it was the box measurement: 37 s for 14 nodes. After every
structural edit it measured EVERY node -- a coarse lattice, then up to four refining lattices per node,
each a GPU round trip waiting behind this scene's second-long frames -- and it compiles its own
full-scene kernel (the tagged field) first. It ran straight through the next edit's compile.

What changed: **only the boxes that are shown are measured** -- none, the selection (a group: the objects
in it), or all, as the view's box button says, plus one a caller asks for (the optics page's detector,
`request`) -- and **never while the builder applies or the renderer compiles**: a sample asked for then
returns nothing, which abandons the measurement until later. With the default (the selection's box)
and nothing selected, a structural edit measures nothing and compiles no tagged field at all.
test/boxes.test.mjs checks both. Whether the compile falls back to its ~4 s alone is the next number.

## After the boxes change (2026-09-29)

    [pathtracer] compiled 'built' in 18.5 s; ready at (ms): shade 18546, occlude 3365, march 1765, genrays 507, ...
    [builder] scene applied: probe 1228 ms, pipelines 18571 ms, total 19806 ms
    GPU device lost: DXGI_ERROR_DEVICE_HUNG

Better, and still 4x the 4.6 s the same kernels take one at a time -- genrays too, a few ms alone and
507 ms here. With the boxes held off during a compile, what remains that differs is only that the
build compiles them all AT ONCE. `RT.profileCompile({ parallel: true })` does exactly that with
uncached code; if it reproduces the 18 s, the build should compile in sequence. **It did not** (the
handoff, 2026-09-29): about 4 s in parallel as alone, while a structural edit still reported 18-21 s for
the same pipelines and 1.2-15 s for the probe -- not explained then. That profile ran with the render loop
going; an edit compiles with it stopped, and the browser was starved by this scene's GPU load (P5).
Tried then and reverted: pumping empty submits while a pipeline compiles (it made the probe worse). Later,
the benchmark's uncached compile -- all 13 kernels at once, the loop paused, the GPU drained -- read 21.2 and
22.7 s for the Noise library on Ampere (runs 3 and 4) and 7.9-8.1 s on the 1080 Ti (runs 1 and 2). Its
uncaching is not the profile's (a guard line in every kernel, `profile.js`, against `opaqueZero x random`
in the SDF), and its scene text is the frozen copy. The ~4 s and the 21-23 s have not been reconciled.

**The device loss** is Windows' TDR: one submission ran past ~2 s and the GPU was reset. A frame was
one submission -- a whole sample -- and the Noise library takes over a second a sample (the
non-unrolled march may have made it slower). A heavy frame is now cut into submissions of ~150 ms,
sized from how long the GPU was busy with the last frame (`R.frameMs`: from its recording or the frame
before it ending, whichever is later, so a frame queued behind another is not timed with its wait, since
0.10.0); frames under 250 ms are not cut; a new scene submits every iteration until it has a timing
(`raytrace_main.js` NO SUBMIT LONG ENOUGH; not confirmed on hardware as of 2026-09-29). The experimental TRACE2 flow is not cut.

## Measured: a path edited in the picture (the user's machine, 2026-10-02)

Entering the builder's Points mode compiles the path being edited live, written by position for its points and 8
spare. On the light guide (a profile swept along 4 points) that compile took **70 s**. Each slot had been written
out with its own copy of the section: 51 copies of the profile's chain in every copy of the scene. The fix made it a
loop over the slots (codegen.test counts 5 places). The loop's first bound, `min(count, slots)`, let the compiler
see a maximum, and the user found it only "a bit better". Inferred, not measured: the loop was unrolled back. With
the bound through `noUnroll`, as this file's other loops have it:

    [pathtracer] compiled 'built' in 15.5 s; ready at (ms): shade 15528, occlude 3175, march 2978, genrays 546, ...
    [builder] scene applied: probe 2337 ms, pipelines 15546 ms, total 17940 ms
    (the twisted bar, the same way: shade 12010, occlude 2205, march 1836; probe 1546 ms, total 13660 ms)

Nearly all of what is left is shade, which holds about ten copies of the scene: P1 below. **Not measured:** the
light guide in Transform mode, where it is compiled straight rather than edited. Set beside the 15.5 s, it says
whether any of that is still the path's own.

## The plan

### P1 — Take the scene out of the shade kernel (compile)

A new small **surface kernel** runs between march and shade. For each hit it computes everything shade
asks the scene: the normal (differences, one SDF copy in a loop), the Material2 at the hit, and the IOR
beyond the surface (the SDF probe a hair inside and getMaterial2's medium lookup) — for the camera ray and
for the emitter probe alike — and stores them next to the Hit. **Shade then contains no scene at all**:
it compiles once per session, and since its text never changes the browser's shader cache can keep it
across reloads. A structural edit recompiles march, occlude and the surface kernel: a few copies of the
scene each, instead of shade's ten plus 40k of physics.

Constraints to respect: shade already binds the eight storage buffers the spec guarantees, so the
surface data must live INSIDE an existing binding (the shade queue's element grows from Hit to
{Hit, Surface}), not beside it; light tracing's connection (`ltConnect`) must read the same stored
material the camera side shades with, or the two sides shade different surfaces; the `bsdf-parity`,
`furnace` and `lt` rows are the checks that nothing moved. Expected: the Noise library's longest
scene-dependent kernel from ~175k to ~50k tokens. Not instant — that is P3.

### P2 — Bounding volumes (render) — BUILT 2026-09-30, measured: 3.9x on the Noise library (runs 4 and 5; run 3 read 2.74x)

As built: a box per top-level node as two uniforms, measured (not set by hand), in the node's own frame; the
box distance stands in beyond a margin (the user's rule: every box tested every step, since they overlap),
rather than "farther than the nearest surface so far", which depends on the order the nodes are evaluated
in. How it is built, seen and measured: STATUS, *Bounding-box culling*, and runs 3-5.

### P3 — The scene as data (structural edits without a compile; the road to many objects)

*Expanded 2026-10-03, on the user's question: "What ways could there be to significantly improve speed of
rendering for very complex scenes? maybe switch from the current code-based system (every object is a code
block) to a database or array based system?" Each line says how it is known. The engine -- today's documents as
records and one loop -- is built since 0.10.2, behind a developer switch, not yet measured (*In this order*, step 3,
says what is and is not).*

Every builder object is a code node today, and most carry their primitive's code unchanged. **The architecture
agreed with the user (below, 2026-10-03) splits a scene in two: blocks, which are code, and components, which
are data.** A component says which block it uses and holds that block's values; the components go in a storage
buffer that one fixed SDF evaluator walks. Adding, deleting, moving, regrouping or re-parameterising components
writes the buffer and compiles nothing; only a new block, or a block's code edited, compiles. The largest step,
and the only one that makes structural edits instant.

**What it buys and what it does not.** By itself it makes structural edits compile-free and removes two
ceilings (below). It does **not** make a primitive cheaper: a generic evaluator is probably somewhat slower per
primitive than inlined code (inferred; *What it costs*). The render speed for many objects comes from what data
makes possible -- evaluating only the shapes near the point (*On top of the data*) -- not from the data itself.

#### Where a step's time goes, and what grows with the number of objects

- **Read in code:** every `SDF()` call tests the box of every top-level node -- an `xfPoint` and a box distance
  each -- then evaluates in full every node whose box is within the margin (`codegen.js:1484-1518`,
  `scene_api.js:187-195`). Culling is at the root only (`codegen.js:1476`): a top-level group is evaluated
  whole, although `boxes.js` measures a box for every node. Near one lens assembly of the optics bench, all 16
  of its shapes run at every step.
- **Read in code:** plain sphere tracing, each step `stepscale` (0.9) x d (`wavefront.js:668-696`,
  `uniforms.schema.js:44`); `SDF()` once a step in march and occlude, at 8 sites in shade (*Read without a GPU*).
- **Measured** (runs 4 and 5): evaluating fewer nodes per step is the largest render win there has been -- 3.9x
  on the Noise library, whose culled nodes were reliefs. On the scenes of about 14 cheap primitives it gained
  3-13%, materials ran 2.5-2.7% slower, and shade is 21-35 ms in every scene whatever the geometry. **So for the
  bundled scenes, how many cheap primitives a step evaluates is not where the time is.** That it becomes the
  time once there are hundreds of them is inferred; step 0 below measures it.

What grows with N objects, today:

| | grows as | how known |
|---|---|---|
| a march or shadow step | N top-level box tests, plus every shape in every nearby top-level group | read in code |
| a hit in shade | about 8 of those | read in code |
| the SDF's text | ~0.9 KB per top-level box preset (912k characters at N = 1000), before it is inlined at each call site | computed |
| the uniform struct | ~113 B per top-level box preset, ~129 B with live visibility; the optics bench 88 B a node (93 nodes, 8.8 KB) | computed |
| a structural edit | a whole compile: 3.7-23 s uncached on the Ampere for the bundled scenes of 2-14 objects | measured (run 4) |

#### Two ceilings the code path meets before "very complex"

- **The uniform buffer, 64 KiB.** Every node's transform, parameters and box are fields of the one
  `var<uniform>` struct (`tinywebgpu.js:1234`). `init` raises only the storage limits (`tinywebgpu.js:211-219`)
  and the page asks for no limit (`index.html:282`), so the WebGPU default of 65 536 bytes applies. D3D12 caps a
  constant buffer there in any case (its spec: 4096 x 16 bytes). What the user's adapter reports is not checked:
  `(await navigator.gpu.requestAdapter()).limits.maxUniformBufferBindingSize` in the console says.
  - **Computed** (codegen in Node, sizes by tinywebgpu's layout rules): N copies of the box preset at the root
    take 57 488 B at N = 500, and 65 488 B with live visibility -- 48 bytes short of the limit; N = 1000 takes
    113-129 KB. **The optics bench's lens assembly (20 nodes) fits 36 times** with live visibility (64 608 B), 40
    without. At the bench's 88 B a node the ceiling is about 730 nodes.
  - Past it the pipeline cannot be valid (inferred: which call refuses it is not checked).
- **The shader's size.** 32 copies of that assembly are 895k characters of scene text (computed), and shade
  inlines the SDF about eight times. Compile time at that size is not measured, and length alone has not
  predicted it here (run 2: Surface materials' shade, 164k characters, 4.2 s; the Noise library's, 171k, 8.1 s).
  At several million characters it is inferred to be unusable; step 0 measures points on the way.

#### How much of a scene could be data (computed, 2026-10-03)

Every object's code compared with the presets' (`primitives.js`, `modifiers.js`), comments and whitespace
ignored, over the ten bundled scenes: **130 of 139 code objects carry a preset's code unchanged, and all 42
groups are plain, CSG, or a stock modifier.** The nine that are not are in the scenes written by hand before the
builder (demo 4, materials 2, showcase 2 -- one the Menger sponge -- and menger 1). The optics bench -- 65
objects, 28 groups, 8 at the top level -- is stock throughout, and each of its lens and prism assemblies is in
it twice, as a copy.

#### The architecture: blocks and components (agreed with the user 2026-10-03; not built)

*The user's design, settled over one conversation: "a scene is something that contains both scene geometry and
building blocks ... each building block defines a number of uniforms / parameters and a block of code ... So a
scene geometry element does not contain or generate code anymore. Adding code blocks will add functions to the
code, so requires a recompilation." The decisions are the user's; the reasons and the costs are from the code,
each labelled.*

**Two things in a scene.**
- **A block** is code and its parameter schema: the parameters with their defaults and ranges, which of them are
  lengths, its stretch axes, its bounds, and its code. Built in, or the customer's own. The entries of
  `primitives.js` and `modifiers.js` are blocks in all but name (read in code: each is parameters, ranges,
  lengths, stretch, tags and code, copied into a node today when it is inserted), and so are the materials
  (fields as parameters, optional code: `materials.js`).
- **A component** is an element of the scene: which block, the properties every component has (transform,
  material, visible, locked, name), and values for its block's parameters. **A component holds no code and
  generates none.** A group is a component too.
- **What compiles:** one function per block, and one fixed evaluator over the components. Adding, removing,
  moving, regrouping or re-parameterising components -- or switching one to another block the scene has --
  writes data. Adding a block, or editing its code, compiles. The shader grows with the number of blocks, not of
  components (by construction; today it grows ~0.9 KB a component, computed above).

**Editing a block's code changes every component that uses it** (agreed). A variant is a duplicate of the
block, edited. A built-in block is read-only: editing one starts from a duplicate.

**Where blocks live** (agreed): the scene's own blocks are in the scene file, so a file is complete, and any can
be copied to the library. A built-in block is named with its version (`sphere@1`), so an old file keeps the
shader it had when a built-in changes -- the promise every format upgrade here has kept (`codegen.test.mjs`'s
frozen shaders).

**What the evaluator asks of a block, by kind.** WGSL has no recursion and no function pointers
(`codegen.js:1445-1448`). A group's code cannot call `children()` any more: the children are rows the evaluator
walks, and the evaluator is what calls the group's code. So the evaluator calls a block at fixed points of its
own:

| kind | the evaluator asks | built in |
|---|---|---|
| shape | p in its own frame -> (normal, distance) | the 25 presets |
| before | p -> the p the children see, and a step factor | twist, bend, repeat (one cell), mirror |
| several points (agreed) | p -> a count K and the i-th point; the children are walked at each and joined | repeat with its neighbouring cells, smooth mirror, **an array of positions** |
| after | the children's distance -> the group's | round, shell, displace, relief |
| join | two distances -> one | union, subtract, intersect; a customer's chamfer or stairs |
| material | the hit -> its Material2, once a hit | the PBR fields; the procedural materials |
| function | helpers any block's code may call | today's `functions` block |

- **All eight built-in modifiers are one before or one after:** each calls `children()` once (read in code:
  `modifiers.js:53, 83-170`). None of the bundled scenes' 42 groups has code of its own (computed above).
- **Several points is a loop, not recursion:** the evaluator keeps the group, i, K and the result so far on its
  stack, and walks the children again for the next point.
- **An array is several points from data** (the user: "a group of components placed at positions defined by an
  array"): a list of positions or transforms, in the second buffer as a path's pieces are. **Its cost is K walks
  of its children at every step near it** (by construction): 100 LEDs, 100 walks. So a large array must not stay a
  loop when it is traced: each position becomes a leaf of the BVH (*On top of the data*), the children's box
  moved there, and a step walks only the copies near the point. A computed repeat keeps its one cell, or that
  cell and its neighbours (K at most 8).
- **Legacy code**, an object that folds into `C` itself (several `add_new`s, its own materials): a "fold" kind
  with today's contract, so an old file's custom code runs unchanged.

**Bounds belong to the block:** its box as expressions in its own parameters (`expr.js` already parses such
expressions for a path's points, with errors at line and column). A block without them is measured on the GPU
for each component, as `boxes.js` does now, and culls only once measured.

**Constants belong to the block:** a value baked into the code so a loop unrolls (the Menger sponge's
iterations) is the same for every component that uses the block. Two values are two blocks.

**Component parameters** (the user: "would be nice"). A group component declares parameters of its own, and any
value inside it -- a child's parameter, a transform, an array's positions or count -- can be an expression of
them. **They are resolved on the CPU and written as data:** no compile and no shader cost, as a live path's points
are today (its pieces computed again in JS and written, `codegen.js:114-122`). So "count" and "pitch" on an LED
strip make its array; "diameter" on a lens sizes the lens and its holder; and the timeline and the parameter
registry drive them as they drive any parameter.

**The component database** is the library. **A library component is components only, with no code** (the user);
the blocks it uses go with it. Putting it in the library puts its customer blocks, and the function blocks they
call, in the library too; inserting it brings them into the scene:
- a block identical to one in the scene (code and schema) is reused, as an identical material is
  (`sameMaterial`, `model.js:968`);
- a block of the same name with different code is added beside it ("acme-tir (2)"), never over it: by the rule
  above, replacing it would change every component already using it;
- every block records where it came from (the library item and a hash of its content), so the panel can say
  "differs from the library" and offer to update either way, always as an explicit action.
- **A gap until 0.16.0** (read in code then): a library item did not carry the scene's `functions` block --
  `extractAsset` took the materials only. So an object whose code called a helper was inserted into a scene without
  that helper. Closed by carrying the helpers themselves (`builder/helpers.js`): see step 3 below.

**The calls** (made here at the user's request, 2026-10-03: "Make the calls on any decisions"). Each has its
reason, and the ones resting on a number not yet measured say what would move them.
1. **Assemblies are copies, never live links.** A component inserted from the library is a copy, stamped with
   where it came from (the library item and a hash of its content). *Update from library*, on a stamped
   placement and only when asked, replaces its subtree and keeps the placement's transform and its component
   parameters' values (those whose names the new version still has). Why: blocks already carry a code edit to
   every use in a scene, and component parameters carry the variations; a live link adds overrides per placement
   and the question of which edit wins, for what those two leave over. Revisit if customers need one edit to
   reach many scenes.
2. **What is compiled: the blocks the scene uses, and every block compiled since the scene was opened.**
   Deleting the last use of a block compiles nothing (it stays in the shader); using a block the session has not
   compiled compiles once; opening a scene compiles the blocks it uses. Why: every built-in always compiled puts
   some 25 shapes and the profile and path machinery in a shader that shade inlines about eight times until P1,
   and that compile time is not measured. Revisit after P1, with a bench row: the compile with every built-in
   against one with a sphere alone.
3. **The evaluator's stack is 8 levels deep.** Only a join, a before or after, or a several-points group takes a
   level; a plain group is composed on the CPU. The deepest bundled scene needs 2 (computed: the optics bench and
   demoscene). The model refuses a deeper scene with a message naming the group, as it refuses an outline that
   cannot be compiled. Why 8: four times the deepest scene there is, and small, since a private array indexed
   at run time is local memory on most GPUs (inferred).
4. **Arrays loop up to 16 positions until the BVH exists, and have no limit once each position is a BVH
   leaf.** 16 is chosen, not measured: it caps the slowdown near an array at 16 walks of its children. Only an
   array at the top level or under plain groups can become leaves; inside a join, a before or an after it stays a
   loop, and keeps the 16. A position is a transform -- position, rotation, scale -- the form a component's
   transform has. Step 0's scaling rows say whether 16 should move.
5. **The evaluator replaces codegen only if it is not slower.** The gate: on the bundled scenes, march, occlude
   and shade GPU time within 10% of codegen's, in neighbouring and repeated rows (run 4's repeats agreed within
   1.3%; run 2's drifted 9.3%). Past 10% it waits for the BVH (step 4) and is measured again with it. Why: the
   small scenes are where most work is done, and an editing gain that costs them speed is a trade to see in
   numbers first.
6. **An old file's group code that fits no kind** is kept as a plain group, its code kept word for word in the
   group but not run, and the load names it. The shape changes, so it is said, never silent. Why not refuse the
   file: one group that cannot be converted should not lock its author out of the rest of the scene. None of the
   bundled scenes has one (computed above).
7. **The scene's `functions` block becomes one function block that every block may call,** so an old file
   compiles as it did; a new helper is a function block of its own. A block's use of a helper is found by its name
   in the code (codegen already finds `SURFACE_ONLY` and `p_local` so), and the helper goes with the block into
   the library.
8. **Materials are blocks.** The PBR fields are the built-in material block, with no code; a procedural material
   is a material block of the customer's. A material in the scene is values for a material block, as a component
   is for a shape block. A material's relief is an after block the material names, applied after the shape of
   every component wearing it.
9. **Lights stay built in.** Rectangle and disc (and the ray file) are built-in blocks, and a customer cannot
   make a light shape: light sampling needs each face's area and a point picked evenly on it (`lightFaceArea`,
   `scene_api.js:162-164`), which only those shapes give. A customer's luminaire is components around a built-in
   light.
10. **Visibility is always live:** a flag in each component. The document's `liveVisibility` setting goes, in
    version 16.
11. **Limiters are a flag, not a copy:** a component whose material is a limiter is skipped by the render's walk
    and walked by the optics trace's, in one table. Today they need separate optics copies of the scene
    (`opticsWgsl`, `codegen.js:782-788`).
12. **A block's parameters are of the types parameters have today** -- number, vector, colour, profile, path
    (`model.js:643-646`), and the booleans codegen types (`wgslTypeOf`) -- **and a list of transforms**, for arrays.
13. **The library has three kinds:** block; component (an object, a group, a light, or a whole assembly), which
    brings its blocks with it; and material (values with their block).
14. **Customer code is not obfuscated.** WebGPU takes WGSL source only, so anything done to hide it is undone by
    reading the shader. Where blocks are exported, the panel says so.
15. **P1 still comes before P3:** material blocks then run in P1's surface kernel, not in shade, so a material
    edit never recompiles shade.

**For the user's customers** (inferred from the design): their parametric parts -- a TIR lens family, a
reflector, an LED package -- are blocks; a product is components; variants, parameter sweeps and optimisation
are data, with no compile; their blocks travel in library exports. **Their code is readable by anyone who has
the scene:** WebGPU takes WGSL source only, and there is no compiled shader format to ship instead.

#### The data on the GPU (proposed, not built)

- **A component table** in a storage buffer, in depth-first order:
  - the world-to-local transform, composed on the CPU through every parent up to the nearest group whose block
    changes p (below such a group, from its frame), and the scale `XF_S` that goes with it;
  - the block, the material, flags (visible, analytic normal);
  - an offset into a parameter array, since a block's parameters are as many as it declares;
  - the box in the component's frame, and the index just past its subtree, to skip it.
  - 10 000 components with eight parameters each are about 1.4 MB (computed: a record of 104 bytes padded to
    112, and 32 of parameters).
- **One evaluator:** a loop over the table and a `switch` on the block -- the built-in shapes' functions are the
  N* functions `sdf.js` and `shapes.js` already have -- folding as `fold()` does. A small fixed stack holds what a
  group needs while its children are walked: the running result (distance and normal, material), the point
  before a before-block changed it, a several-points group's i and K. Its depth is the scene's nesting, capped.
- **A block's code goes in byte for byte**, after generated `let`s that read its parameters from the component's
  slot -- the aliasing codegen does now with `UB.<name>_<id>` (its header) -- so an error is still reported at
  the customer's own line.
- **The relief** keeps its shell and its band (`SURFACE_ONLY`, `READ_REACH`, `XF_RL`; *The relief in a shell*,
  above), as arithmetic of its after-function where it is generated text today.
- **Profiles, paths and arrays:** their pieces or positions in a second array, a component holding an offset and
  a count. A live path or profile already reads its pieces by slot index from uniforms (`codegen.js:114-133`,
  `pathUniformDecls`), so half of it exists.

**What it buys besides no compile:**
- **Exact boxes for every block that declares its bounds**, from its parameters on the CPU. The page took 17.7 s
  to measure the Noise library's 20 boxes while rendering (measured, *Bounding-box culling*), and a node is
  unculled until its box is measured. `boxes.js` would go on measuring the blocks that declare none.
- **No uniform ceiling, and no text that grows with the scene:** the kernels' text stops depending on the
  scene, so the browser's shader cache can keep it, as P1 says of shade.
- **Live visibility for nothing:** a flag in the component. Today a hidden node is still compiled and costs a
  branch.
- **Pick** names the component's index, with no second, tagged copy of the scene for it.

**What it costs:**
- **Per component evaluated, probably slower** than the inlined code: a storage load instead of a uniform, a
  switch, and nothing of a component's values folded at compile time (a block's constants still are). Where every
  thread walks the same components, the loads are one address in every lane and the switch takes one branch, so
  close to compiled (inferred). How much is unknown: the fast scenes could get slower, and the bench is what says
  by how much.
- **A ninth storage binding in shade**, which is at the spec's eight (`wavefront.js:891-898`). tinywebgpu asks for
  the adapter's own limit (`tinywebgpu.js:211-219`) and check-shaders notes past eight -- or P1 goes first, and
  shade evaluates no scene at all.
- **Everything codegen does, kept.** `codegen.js` is 1548 lines of rules the evaluator must keep: the relief's
  shell and its deferred slope, the straight material frame (`XF_Q`), the local point a material reads (`XF_P`),
  live visibility, limiters and the optics copies, light faces placed by the same transforms the SDF reads, the
  pick copy. Each is a second caller (CLAUDE.md). Without a GPU, a JS twin of the evaluator, checked against the
  JS twins `shapes.test.mjs` already holds the shapes to, is what a test here can run; the golden shaders
  (`test/fixtures/csg-v10`) say nothing about it.
- **The file format**, version 16 (MINOR), and its upgrader: an object whose code is a preset's becomes a
  component of the built-in block (130 of the bundled scenes' 139, computed above); identical custom codes become
  one scene block; an object whose code folds into `C` becomes the fold kind; a group whose code fits no kind is
  reported by the upgrader, not guessed (none in the bundled scenes).

#### On top of the data: what makes many objects fast

1. **A BVH over solids.** A solid is a leaf of the root's union: a component at the top, a join group, a group
   with a before or after block -- plain groups are see-through -- and **each position of an array**, its children's
   box moved there. Built in JS from the exact boxes when the structure changes, refitted
   when something moves. The SDF becomes a nearest-surface query: nearer boxes first, and a box farther than both
   the margin and the nearest |d| found so far is skipped. Per step, about log N box tests and the few solids
   near the point, instead of N tests and everything in each nearby group (inferred from the operation counts).
   - **The result does not depend on the order** the solids are visited in, only the work does: a skipped solid
     is farther than a surface already found, so it could not have won.
   - **The medium stays right:** a box holding the point has a distance of at most 0 and is never skipped, so
     `fold()`'s choice among the solids the point is inside sees all of them.
   - **It keeps a 1 mm die in a 2 m room**, where a uniform grid would not: 64 cells over 2 m are 31 mm each
     (computed).
2. **The hit says which solid.** `Hit` is 140 bytes padded to 144 (P6): room for a solid's index. Shade's normal
   by differences (three evaluations, `tracebasics.js:405-413`), the material's local point (one) and its
   `getMaterial2` then evaluate that solid, not the scene. The medium probe still asks the whole scene, through
   the BVH.
3. **Culling inside CSG groups, by the join** (derived 2026-10-03, not tested; it needs a test like
   `boxes.test.mjs`, on exact shapes, first). bd is a child's box distance, a lower bound on the distance to
   anything in its box, and a child is skipped only while bd is above the margin:
   - a union child: `min(a, bd)`, as at the root;
   - a subtracted child: `max(a, -bd)`. Outside the result it is `a` exactly; inside, its size is at most the
     distance to either surface, so a step is still safe;
   - an intersected child: `max(a, bd)`, which is below the distance to the intersection;
   - under a smooth join the margin grows by 5/4 of the blend. The polynomial blend lowers a value by at most k/4
     and only within k, so a child farther than margin + 5/4 k cannot turn the sign. It is the reach codegen
     already gives a relief in a CSG chain (`reachOf`).

   These hold for today's generated code too (step 1).
4. **Later, if step 0 says so:**
   - a candidate list per ray: the solids whose boxes its segment crosses, found once per march dispatch (32
     steps), with the empty space between boxes crossed in one step;
   - a coarse baked distance field for the steps far from everything (IMPORT.md §3's grids, as a bound, never as
     the surface: optics needs the exact one);
   - the CSG program simplified per region of space, as Keeter 2020 (*Massively Parallel Rendering of Complex
     Closed-Form Implicit Surfaces*) does with interval arithmetic.

#### Independent of P3

- **Over-relaxed sphere tracing** (Keinert et al. 2014, *Enhanced Sphere Tracing*): a step of ω x d, ω about
  1.2-1.6, taken back when the spheres at its two ends do not overlap. Fewer steps in every scene, whatever the
  representation; the march steps 0.9 x d now. What it gains here is not known.
- **The per-pixel tolerance**, agreed as the next PR (PLAN.md): fewer steps for rays far from the camera.
- **P1** still pays after P3: a material's code is compiled into shade, so a material edit recompiles shade's
  40k tokens of physics.
- **A smaller fold** (inferred): `fold()` takes and returns a whole `Hit`, with its 112-byte `Ray`, at every
  node; the evaluator needs only its distance and normal, material, medium and `insideW`. Possibly register
  pressure; the kernel columns would say.

#### In this order, each measured before the next

0. **Measure the scaling** (bench rows, no architecture): the optics bench as it is -- compile and kernel
   columns, never timed -- and N copies of its lens assembly at the root, N = 1, 4, 16, 32 (32 is 57 568 B of
   uniforms, under the ceiling). If march and occlude grow about linearly with N, the BVH is worth its code; if
   they stay flat, the time is elsewhere and P3 is about edits alone. (Since 0.22.8 its copy rows are as data and with
   the candidate grid: `roadmap/ARCHITECTURE.md`, step 4.) **Built 2026-10-03 (0.10.1), not yet run:**
   Tests > *scaling* (`bench/scaling.js`, TESTING.md). The copies stand behind the camera, so every copy row shows
   one picture, with one tolerance and one radius; 32 copies are 58 592 B of uniforms with the stage, and about 35
   would fill 64 KiB (computed, `scaling.test.mjs`). OpticsBench2 has a row of its own.
1. **Over-relaxation, and culling inside groups in today's codegen** (the rules in item 3 above, with the boxes
   `boxes.js` already measures), each a bench row on and off. Cheap, and a preview of what a hierarchy buys on
   the optics bench. It costs 32 bytes of uniforms a nested node, nearer the ceiling.
2. **P1.**
3. **P3, blocks and components:** built-in shape blocks at the top level first (the buffer, the binding, every
   second caller), then joins, then before and after blocks, then several points and arrays, then materials as
   blocks, then component parameters; the file format and its upgrader with the first of them. It replaces
   codegen only past call 5's gate. While it is built, the bench runs both
   paths on the same scenes and compares meanLuma and the kernel columns. The old path is kept for that
   comparison only, never as a mode for the user: a mode nothing exercises is code that has never run (CLAUDE.md).
   **The engine is built (2026-10-03, 0.10.2), behind a developer switch, and not yet measured** -- out of order: P1
   is not built, so shade binds nine storage buffers in data mode (the scene's is the ninth), which a device with
   the spec's eight cannot run; the builder stays codegen there. What is built (`builder/scenedata.js`): every
   document as it is today, with no new file format -- an object's code is its block, deduplicated by code,
   parameter schema and constants; plain groups composed on the CPU; CSG groups and their joins on a stack of 8;
   lights in a table; visibility, culling (every node under plain groups) and limiters as flags; the pick and optics
   copies by a constant. Compiled as before, each a function the loop calls: group code, an object wearing a
   material's relief, a CSG group with either inside. An edit that adds no code writes the buffer and compiles
   nothing (`builder/demo.js` swapData; the engine's `updateSceneData` checks the text). **Read in code and checked
   on a CPU's WebGPU** (`builder/test/scenedata.gpu.mjs`): the field, materials, normals and picks equal codegen's on
   every bundled scene, and culling by the same boxes gives the same field. **Not known:** its speed on a card --
   Tests > **scenedata** (`bench/scenedata.js`) is the gate's bench -- and the pictures, which are the user's. Not
   built: the document's explicit blocks (format, block editing, library blocks), native modifiers, arrays,
   component parameters, the BVH.
   **The document's blocks are built (2026-10-04, 0.10.3, format version 16):** a scene keeps its blocks -- code with
   its parameters' schema -- and an object or a group names one and holds its values. Editing a block changes every
   user; built-ins (`sphere@1`, the modifiers) are read-only and copied for a node at its first edit; a variant is
   `splitBlock`; blocks travel with pastes and library items, reused where the scene has the same. Call 2's "two
   values are two blocks" for a constant is kept where it matters, in the shader: a constant's type is the block's,
   its value each node's, and two values compile to two functions (scenedata.js) -- an edit to one node's constant
   does not reach the others. A block in the library is kept with an object that uses it, not as an item of its
   own (call 13's third kind is not built).
   **Arrays are built (2026-10-04, 0.10.4, format version 17):** a plain group's `copies`, up to 16 transforms; its
   children once in the text, walked once a copy -- in codegen a loop over a mat4 uniform a copy (uniforms are not
   arrays), as data an ARRAY record, the children's frames relative to the copy, and an ARRAY_END that goes back for
   the next (the evaluator keeps a base frame only in a scene that has arrays). Checked on a CPU's WebGPU: the field and
   the picks of the copies written out as groups. No light inside an array yet (light sampling's one face a light; a
   light at every copy since `0.next`, roadmap/LIGHT_CONTROL.md);
   no group with code or joins as one (put it inside). Each copy is still a walk of its children at every step near
   it: the BVH is what would tell which copies are near.
   **Before and after groups are data (2026-10-04, 0.14.0), with no file format change:** the kind is read off the
   code (codegen.js `isBefore`, `isAfter`), so a customer's code of either shape is one too, and an old file needs no
   upgrade. A before group (twist, bend, repeat, mirror) is a record whose code is a function `bef_<k>` returning the
   point; its children are records in the frame it leaves -- the point, and XF_M and XF_S as its warp() set them --
   on the base-frame stack arrays use (with XF_K where a relief reads it). An after group (round, shell) opens a Hit
   on the CSG stack, its children fold into it, and its code `aft_<k>` gets that Hit for its `children(...)`. Compiled
   as before: displace and the noise relief (they read the CSG chain above them -- SURFACE_ONLY, READ_REACH,
   DIVIDED_ABOVE), code that calls its children twice or works on both sides of the call, any group code in a scene
   whose materials read p_local (codegen's XF_P under a warp and its XF_SUB are not what the records set), and a
   straightMaterial group where that frame is in force. **Read in code and checked on a CPU's WebGPU:** the optics
   bench now has no compiled subtree; on it, demo, demoscene and a scene made with every modifier nested, in arrays,
   in CSG groups and over reliefs, the field, normals, materials and picks equal codegen's. Not known: speed (the
   *scenedata* bench), and the pictures. Not built yet: computed repeats with neighbours (several points from code),
   materials as blocks (call 15: after P1), the functions block split into function blocks.
   **Helpers travel with what calls them (2026-10-04, 0.16.0; `builder/helpers.js`):** call 7's second half without
   splitting the block -- an asset carries the top-level items of the functions block its code, materials and reliefs
   read (and theirs), found by name as the call says; insertion adds the ones the scene lacks and refuses one it has
   differently, naming it (the item would otherwise call the scene's, another shape). The block stays one text in the
   file: splitting it into function blocks would be a format change and buys nothing more for the library.
   **Component parameters are built (2026-10-04, 0.15.0, format version 18; `builder/bind.js`):** a node's `bind` holds
   `target = expression` lines -- a parameter or its component, the transform, a blend, a plain group's copies as a row
   -- reading the parameters of the groups above it (a group's own too, for all but its parameters, so nothing binds
   itself). Resolved in JS top down and written into the values, as the design says: the shader never sees a binding
   (`bind.test.mjs`: a bound scene's codegen text is its values typed in). A group's parameter moved live pushes each
   bound value as a drag would (demo.js `pushBound`): a uniform, or the records; an array's count in codegen asks for
   the compile. Bound values are held as a lock holds them (model.js `heldOf`) and left out of the parameter registry.
4. **The BVH, and the solid at the hit.** Superseded for point queries by the candidate grid (below), decided with the
   user 2026-10-04: a march asks dozens of points a ray, and a grid answers each with a lookup where a tree traverses.

#### The candidate grid (2026-10-04, 0.16.1: a prototype; 0.17.0: in the page, a developer's switch, and benched; REMOVED in 0.41.0)

**Removed in 0.41.0** (the user, 2026-10-08: "Remove the candidate grid"): slower than no grid on four of seven scenes,
a gain only past about 20 copies of an object (`roadmap/ARCHITECTURE.md`, step 4 and Removed in 0.41.0). What follows is
its history, kept for the measurements.

*The user's idea ("3d textures to store info ... a ray could look up which object(s) it would need to calc the SDF
for"), made exact. The gate measured why it is needed (Tests > scenedata, the user's Pascal, 0.16.0): as data a step
costs 3-9x codegen's on the small scenes, with the same number of steps (counted) -- the walk of every record at every
step.*

- **A cell** (`builder/grid.js`) lists the solids (the root's union members, `scenedata.js solidsOf`) that can be nearest
  somewhere in it or contain a point of it, and a floor under the rest. Built by the scene's own evaluator at each
  cell's centre (`GRID_EVAL_MAIN`), with the march's own rule that a distance moves one unit a unit: no declared bounds,
  so a customer's code is covered. Exact near surfaces; far from them (rho = 6 half-diagonals) a cell lists nothing and
  its floor is at least 5/7 of the true distance (the bound and its proof in the file; checked by `grid.test.mjs`).
- **Adaptive:** a coarse 8-cell grid split once into the top grid, and a cell with more than 4 candidates split again,
  twice at most. Lists shared; a cell is two words (its entry and its floor).
- **Outside the grid** a step is the way to it and its pad, and only solids with no box are walked. A box is checked at
  the build -- a solid nearer than its box from any centre has a wrong box, and is built as unbounded.
- **In the scene's buffer**, after its light table: the header's fourth word says where (0: the whole walk, as before), so
  one shader text runs with a grid or without, and a rebuild is a write, never a compile.
- **Counted on a CPU's WebGPU, never timed** (`grid.gpu.mjs`, the bench's cameras, estimated boxes): records walked a
  camera ray, culled -> grid: optics bench 472 -> 55, OpticsBench2 176 -> 37, Noise library 451 -> 20, Surface materials
  440 -> 19, showcase 521 -> 20, material test 80 -> 28; steps within 15% of the field's own, where culling's are up to
  2.3x it (culling stands a box's distance in for a node's, which can only shorten a step; codegen culls by that rule
  too). **Not known:** what a lookup and a step cost on a card -- records are a proxy, and a compiled subtree is one
  record of any cost. That is step 2's bench row.
- **In the page (0.17.0, step 2)**, behind the developer switch *Scene as data: candidate grid* (uniforms.schema.js
  `sceneGrid`, with `sceneData` on): the scene is generated in grid mode (codegen `grid`; the render copy looks the grid
  up, the pick copies never do), and after every write of its records -- a value, a box measured, an edit as data, a
  compile -- the grid is built again once they have rested 150 ms (`builder/regrid.js`), on the GPU by the scene's own
  kernel (`RT.sceneEval`, a host's kernel over the scene's text, kept per scene and main), and written after the records
  (`RT.writeSceneData`: into the buffer, or a bigger one with the loop held, every kernel rebound). Every write of the
  records carries no grid (header word 3 = 0), so a stale grid is never walked: a build overtaken by a write is thrown
  away and another starts (`regrid.test.mjs`). Nothing is built before a box is known; the page measures every box while
  the switch is on, as for culling. The picture is not started again when the grid goes in: near surfaces its distance
  is the scene's own (`grid.gpu.mjs`), so the samples are of one picture -- *inferred from the counts, for the user's
  eye to confirm*.
- **The bench (0.17.0):** Tests > scenedata has a third row a scene, *as data with the grid*, its grid built after the
  row's boxes (`bench/index.js boxesFor`), and a `grid` column; the lens assembly x 32 lost its codegen row (over ten
  minutes compiling, the user's Pascal). **Waiting on:** that run.
- **Next:** (3) exact analytic hits -- built, below; (4) shade's evaluations of the solid at the hit. Later: CSG members
  pruned per cell (a lens holder is walked whole), an array's copies as solids of their own.

#### Exact hits (2026-10-04, 0.18.0: a developer's switch, benched; REMOVED in 0.41.0)

**Removed in 0.41.0** (the user, 2026-10-08: "Remove the exact hits code"): the fastest build on one bench scene of eight,
12 to 30 times codegen's march on the demo and the Menger cubes, and never seen right in the picture
(`roadmap/ARCHITECTURE.md`, Removed in 0.41.0). The list of closed-form shapes lives on in `builder/plainshape.js`, for
codegen's dear-only boxes. What follows is its history, kept for the measurements.

*The user: "exact analytics would be very welcome for optical raytracing accuracy". Step 3 of the grid's plan.*

- **The protocol** (`lib/pathtracer/core/scene_api.js` SCN_MARCH, SCN_EXACT): the kernels that march (prog_march --
  camera rays, photons, the optics trace -- and prog_occlude) say so; a scene may then answer with a bound ALONG the
  ray and say so; the march steps it whole (not `stepscale` of it) and moves a hit onto its surface before shade (up
  to three moves, each a bound; a look that finds the surface still a tolerance off marches on). A scene that never
  says SCN_EXACT -- every codegen scene -- marches exactly as before: the engine change is a `select` and a branch
  never taken.
- **The answers** (`builder/analytic.js`): a block whose code is one call of a shape at p -- sphere, box, cylinder,
  capsule, lens, disc, rectangle, plane -- and the light faces. Exact, but a rounded box (its outer box: exact on the
  flat faces, a bound at the rounding; nothing from inside). Never a negative answer but -1 (never meets it) and -2
  (cannot say): a hair behind is 0.
- **In the evaluator** (`scenedata.js exact`): a record's answer, never under its distance; a hard CSG group's the least
  of its shapes' (its surface is made of theirs), proven when every shape has an answer, a smooth join leaving the
  group's distance alone; culling boxes along the ray (a ray that misses a box never looks inside); with the grid, a
  cell's floor along the ray is its way out (a solid a cell does not name does not reach into it). Under a before
  group (a twist, a repeat) a ray is not straight: those records say so (FLAG.WARPED) and answer by distance.
- **Counted on a CPU's WebGPU, never timed** (`exact.gpu.mjs`, the engine's own prog_march; records by a march that
  keeps its rule): records walked a ray culled -> grid -> grid + exact: optics bench 347 -> 83 -> 54, OpticsBench2
  166 -> 92 -> 81, showcase 254 -> 19 -> 8, material test 97 -> 16 -> 13, demo 276 -> 131 -> 128; steps a ray plain
  -> exact 24.2 -> 6.1, 22.1 -> 10.2, 18.5 -> 2.4, 23.3 -> 5.7, 33.0 -> 30.7. The same rays hit but grazes within the
  tolerance; the lens hits on their surface (a hundredth of a tolerance) but one in 18 in a holder (0.29 of one, the
  plain march's median 0.7). **Not known:** an answer's cost on a card against a distance's -- the bench's exact rows.
- **0.19.0:** answers for the tube, the cone, the round cone, the dome, the octahedron, the pyramid, the prism and the
  reflector (exact from inside its bowl, the mirror's side; its back, an offset parabola, by distance). On a made scene
  of every shape (`exact.gpu.mjs` "shapes"): each shape's hits on its surface, steps a ray 17.1 -> 1.6, records 289
  culled -> 14 with the grid and exact hits -- counted.
- **0.19.1:** the rounded box exact too -- its box where a ray crosses a flat part, the edges' quarter cylinders and the
  corners' spheres where it does not (it had been a bound at the rounding and nothing from inside).
- **0.20.0:** the outlines -- revolved (each straight edge a cone, a cylinder or a ring; a fillet, a torus piece, leaves
  the outline answering by distance) and extruded (walls, fillets' cylinders, the caps where the outline holds the
  crossing): the fresnel lens 46/46 hits on its surface, the extrusion 71/71.
- **Next here:** interval CSG -- a hard group's own first boundary along the ray, not the least of its shapes' (the
  lens in its holder, a ray grazing along the holder's face: 0.29 of a tolerance off); the torus and a revolved
  fillet (quartics); a live profile's pieces (uniforms).

**Not recommended:** codegen and the evaluator as two lasting modes; and a baked grid as the scene itself
(IMPORT.md §3: bricks fine enough for a lens are 70-140 MB).

### P4 — Relief in a shell (render, surface phase 6) — BUILT 2026-09-30, measured in run 4: -22.9% (STATUS)

The noise relief evaluated fBm at every step everywhere the ray went near the object, and that was the
Noise library's render time. It now marches the un-displaced shape until within a PROVED reach (the noise's
value bound), not `amount`: the noise reaches about 1.05 x `amount` and is bounded by 1.386 x it, so a shell
of `amount` would have cut the relief's peaks off. The proof, the checks and the step bound: STATUS, *The
relief in a shell*. Run 4: a third of the reliefs' cost, not most; run 5 put the rest in march and occlude,
the steps inside the band -- row 11's question.

### P5 — Trace a fraction of the image's rays

**Built another way in 0.58.0: a sample over several frames** (`raytrace_main.js`, A SAMPLE OVER SEVERAL FRAMES;
the `sliceMs` setting). The design below came before 0.38.1. Since then every sample reaches every pixel, and a
sample past the buffer's cap runs in batches that resolve once. So the live loop now cuts a slow sample into more of
those batches and runs a few a frame. That needs no per-pixel coverage, and light tracing's photons need no scaling:
each batch carries its share of every stream. The picture changes once a sample, and the frames between it are
short. Whether that keeps the page usable on the Noise library is the user's to see (CHANGELOG 0.58.0); nothing is
measured yet. The design as it was:

**Designed 2026-09-29, NOT built** (read in code: `raytrace_main.js:1005` still sets `R.raycount =
Math.min(R.raybufferSize, Q.w * Q.h)` -- every pixel, every sample). The user's first complaint on the Noise
library was that **the whole browser stalls** while it renders: at 25% resolution usable enough to measure,
at 100% not; and a starved browser makes every timing taken meanwhile suspect (inferred then). The governor
(`lib/render-loop.js`) paces by whole samples per frame, minimum one (`render-loop.js:64`), and one sample
there was over a second of GPU. Needed: less than one sample per frame.

The design: at one sample per frame and frames over ~40 ms, trace a FRACTION of the image's rays
(`R.raycount`, resized from `R.frameMs`, x0.5..x2 a step, floor ~1/256; a new scene starts at 1/16); while
the fraction is below 1 a frame is one sample whatever the governor says; light tracing's photons scale by
the same fraction (flux is divided by the count sent, so brightness does not move). It is unbiased: raygen
already spreads fewer rays than pixels over the whole image (`genrays.js` tiles), and resolve averages each
pixel over the samples that reached it (`wavefront.js` prog_resolve, `n == 0`). The test bench must turn it
off (`tests.js` `RTKEYS` and `apply`), or its sample counts and ms/sample change meaning.

Since it was designed, culling and the shell cut the Noise library to 250 and 166 GPU ms a sample at
1280 x 720 (run 5; 989 with its boxes off). Whether the page still starves the browser at full resolution
has not been reported since.

### P6 — A smaller Ray (render) — inferred, not measured

The one open finding of a review of this wavefront by a second consumer (weavesim; the same finding is
`projects/weavesim/WAVEFRONT.md` §1.2 b). **Read in code:** `Ray` is 112 bytes -- four `vec3<f32>` padded to 64
bytes to carry 48, then twelve 4-byte scalars, 108 used (`tracebasics.js:279-328`) -- and `Hit` embeds the
whole `Ray`, then a `vec4<f32>` and three scalars: 140, rounded to 144 (`tracebasics.js:332-338`;
`raytrace_main.js:55-61` holds both sizes as constants). Every ray in flight is a `Ray` in each of the two
ping-pong buffers and a `Hit` in the shade buffer, 368 bytes; the occlusion queue holds `Ray`s too.

- **Not the hand-off.** Leaving the ray in its buffer and putting an index in the hit record saves nothing
  now (computed from the layout): the march has moved the ray and must write the advanced copy anyway (112),
  and a record of `s`, `m`, `a`, `insideW` and an index pads to 32 -- 144, as embedded. (The review, at Ray
  96 and Hit 128, put it at about 14%.)
- **The struct.** An octahedral direction, the integer scalars (`steps`, `bounces`, `state`, `tag`) packed
  into fewer words, and a narrower `beta`. The review put a packed Ray at 48-64 bytes when it was 96; it
  has six more scalars since (the MIS and light-tracing fields), and `radiance` cannot simply be f16 (next),
  so the same packing lands higher -- by how much is a design question. Inferred: every ray read and write
  in march, shade and occlude gets cheaper by that share. How much of their time is memory traffic is not
  known; the Noise library's march is mostly its reliefs (run 5: 78.3 ms in the shell row, 28.2 without
  them), noise arithmetic between one ray read and one write a chunk (`wavefront.js:639, 716-719`), so it
  may gain least. Computed: the ray budget (`raytrace_main.js:92`, 1 GiB
  over two Rays and a Hit) holds 2.92 M rays today, and would hold more -- room light tracing's photons
  share.
- **Care, read in code:** `radiance` is in cd/m² and carries a photon's flux (`tracebasics.js:569`); the
  sun's disc is 1.6e9 cd/m² (`envPdf`'s comment, `tracebasics.js:518`) and the bench's 1 cm lamp 9e6
  (TESTING.md) -- far past f16's 65 504, and RGB9E5 stops at 65 408 too, so it needs a scale or stays f32.
  Russian roulette's 1/p can lift `beta` above 1 (`rr`, off by default).
- **What touches it:** every kernel that binds a Ray or Hit buffer (`genrays.js:79`; `wavefront.js:433,
  726-728, 886-891, 1046-1047`), TRACE2's cache, the two size constants, and `convergence.html`'s own copy
  of the struct (`raytrace_main.js:57`).
- **What would measure it:** the benchmark's kernel columns before and after, on the Noise library and on
  a fast scene (materials: 63.3 ms a sample, run 4), with `furnace`, `bsdf-parity` and `photometry`
  unchanged and the pictures compared by the user.

**Order** (2026-10-02; proposed here, not agreed with the user). The old order -- numbers, P1, P2, P3, P4
after P2 -- is done as far as the numbers, P2 and P4. What is open: row 11, to be measured and seen; P5,
the user's first complaint, still unbuilt; P1 and P3 for the compile. P6 and the non-unrolled march's cost are
measurements before they are work. Each confirmed on hardware before the next. P3 has its own order since
2026-10-03, and it starts with a measurement: how march and occlude grow with the number of objects (P3, step 0).
