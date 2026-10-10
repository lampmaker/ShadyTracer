# Render performance review, 2026-10-01

This review looks at render speed and compile speed from the architecture down. It was written fresh against
the code of 2026-10-01; the older reports were not used for their conclusions. **Brought up to date with main on
2026-10-02 (0.9.1):** the static numbers re-measured on the merged code, the two scenes main added (demoscene,
OpticsBench) measured with the rest, the scene's own radius and the ray budget corrected, every file:line
re-read, and a section on how this list relates to `PERFORMANCE.md`'s plan (P1-P6, §7). **Then measured on
hardware (2026-10-02, Pascal):** three runs of the new columns are §10, and the ranking in §6 is revised by them.
Image quality comes first: every proposal below either leaves the estimator exactly as it is or says plainly what
it would change.

**How every claim is labelled** (CLAUDE.md):
- **measured here:** by the static tools in this commit, in the container (node 22, 4 vCPU). These are counts
  and sizes that do not depend on a GPU, plus JavaScript time on this machine.
- **measured (Pascal):** by the user on 2026-10-02, on this branch's code (`0.9.2 · 3dd6fb2`), with the new
  columns (§10). Current values, for that card.
- **recorded:** measured on real hardware by the user before this review, with the date, the card and the commit.
  The kernels have changed since: 60 commits to `lib/pathtracer/core` since run 5's code (5f29694), among them
  lights L4-L7 in the shade kernel and the Optics view. A recorded number is a **direction, not a current value**.
- **read in code:** what the code does, with file:line. It never says what something costs.
- **inferred:** a hypothesis, always with what would test it.

**What this branch adds to measure the rest** (§8):
- `node bench/shaderstats.mjs [--bench]`: kernel sizes, scene copies, and per-sample CPU
  recording, for the bundled scenes or the benchmark's own.
- New benchmark columns: `gaps`, `tail ms` and `compile seq` (first run, §10), then `record ms` and `cut` (second
  run, §10.5), then `pipelined`, per-sample timings in the JSON and two rows with a submission per iteration,
  for what the second run left open.
- `BENCH.run(rows…)`, to run a few rows from the console.

---

## 1. The short version

**What the first measured run changed** (§10; Pascal, 2026-10-02):
- **Compile time is inlined size:** 8-15 ms per thousand characters for every kernel in every scene measured, 13
  on average (a line fits all 18 with R² 0.98).
  Shade is 76-82% of a build. That makes #4 and #11's compile gains predictable (§10.3). Building the kernels one
  at a time is slower, not faster (#3).
- **The GPU never idles between kernels** (`gaps` under 0.13 ms a sample). #9 has nothing to buy on the GPU.
- **Outside the GPU, a sample costs 1.5 ms + 2.35 ms an iteration,** whatever the scene's uniform count.
  - That is 21-58 ms a sample, which saves and the benchmark pay in full because they wait for each sample.
  - **#24 (new): keep a sample in flight offscreen.**
  - The second run: only 6-12 ms of it is JavaScript. The rest, 44-46 ms at 24 iterations in every scene, is
    the browser's, and some samples skip most of it (§10.5). #1 is bounded by the 6-12.
- **The drained tail is 45% of the Noise library's iteration time on the GPU,** and latency-bound. #12 rises.
- **Shadow rays are a quarter of the Noise library's GPU time** (NEE off: −26%). Light tracing is 4%: #10 falls.
- **A quality question:** shadow rays still marching on a sample's last pass are counted as lit. **#25 (new).**
  The second run counted them: a few per million at the full budget, 0.1% in Menger cubes (§10.5).
- **The budget never shrinks** (second run: 24 of 24 in every row). Its near-empty iterations cost 0.1-0.4 ms
  each on the GPU and about 2 ms each off it (§10.5).
- **Third run (§10.6):** one sample in flight took 13% off the Noise library's samples and 25% off materials'
  (#24, measured). The budget's drops to 8-18 iterations are, read in code, a shrink from the start state landing
  on the floor (#27): 1.6× faster light scenes, by accident, at a small cost in paths cut short. And the card
  itself drifted: the same kernels read 185 to 256 ms of GPU time over the evening.

**The foundations are sound where it matters most.** The light transport is physically based and unbiased
(MIS, light tracing with an exact path-space split, measured light units). The wavefront design is the right one
for a GPU path tracer with a programmable scene: compaction and indirect dispatch, and the live loop never waits
for the GPU (offscreen rendering does: #24). Live parameters are uniforms. The instruments and checks are unusually good. None of this needs to be
replaced.

**What does not scale is how much each piece of work drags along with it:**

1. **The shade kernel is the whole renderer, and the scene is inlined into it several times.**
   - The scene's SDF is in it 4 times (8 with `p_local` materials), its `getMaterial2` 4 times, `lobesEval` 9
     times and `makeLobes` 4 times (measured here, static call sites).
   - With every call inlined, shade is 185K characters with a one-sphere scene, 819K with the Noise library
     and 1877K with OpticsBench, the scene main added on 2026-10-02. The march is 3K, 73K and 205K (measured
     here).
   - Recorded:
     - shade was the slowest kernel in every recorded compile that names its kernels (Ampere and 1080 Ti,
       2026-09-29 to 09-30);
     - its one-sphere floor alone took 2.1 s to compile (Ampere, 2026-09-29);
     - it ran 21-35 ms a sample at 1280 × 720 in every scene the benchmark has (run 5, Ampere, 2026-09-30).
   - **This is the main compile-time problem, and a candidate runtime one.**
2. **The march computes far more than a distance at every step.**
   - Per evaluated object and step, a step does all of this (read in code: `scene_api.js:199-231`,
     `codegen.js:1104-1129`):
     - a 3 × 3 frame-matrix product (`XF_M = XF_M * xfRot(T)`);
     - each primitive's analytic normal;
     - a matrix-vector product to bring that normal to world space;
     - medium tracking;
     - a 144-byte `Hit` with a full `Ray` inside, copied through every `fold`.
   - Only the last step's normal and material are ever used (`wavefront.js:701`, the hit is stored once).
   - At its default (`normallimit` 1.0, `uniforms.schema.js:162`), the backface test that reads the normal
     (`scene_api.js:218`) can never reject anything.
   - Recorded: march and occlusion were 80% of the Noise library's GPU time, 200 of 250 ms a sample (run 5).
3. **The host re-sends the entire uniform world three times per wavefront iteration.**
   - Per sample, that is 82 staged copies, 74-638 KB in all, and 174 compute passes (measured here, counts
     exact).
   - Recording one sample takes 4.8-29.9 ms of main-thread JavaScript in the container, whatever the resolution
     (measured here; 29.9 is OpticsBench, with 457 uniform fields). 74% of it is tinywebgpu repacking fields
     that did not change (CPU profile, measured here). Only `seed` and `lastpass` change between iterations
     (read in code, `raytrace_main.js:1351-1355`).
   - It caps the interactive frame rate of light scenes and inflates the benchmark's wall clock. Recorded: wall
     clock exceeded GPU time by 0-44 ms a sample (run 5).
4. **A ray leaves the scene only at its radius, which is 400 m unless the scene says otherwise.**
   - A ray counts as escaped only past `envRadius` from the origin (`wavefront.js:718`, `:1030`). Since 0.9.0
     that is the scene's own property; a scene that sets none has 400 m (`photometry.js:124-126`). Every
     bundled scene but OpticsBench (200 cm) has none, so 400 m, in scenes centimetres to metres across. A new
     scene starts at 25 cm.
   - Sphere tracing gets there in a logarithmic but long run of steps. For a ray leaving a floor, that is
     roughly twice the steps it takes to leave the scene's own bounds (inferred, §5.2).
   - A radius set by hand helps, but it has to be right: anything beyond it is invisible (read in code,
     `uniforms.schema.js:320-322`). Leaving at the bounds needs no setting and cannot cut anything off (#8).
   - Every shadow ray that reaches the sky pays it, and NEE sends one per vertex. Recorded: occlusion was 72 ms
     of the Noise library's 250 (run 5).
5. **Compiles pile up.** Read in code, from the builder's compile map:
   - A structural edit first compiles the builder's probe as a full pipeline and waits for it
     (`demo.js:261`). Recorded: 1.2-3.1 s on 2026-09-29, and 1.5-2.3 s on 2026-10-02 (`PERFORMANCE.md`, *a path
     edited in the picture*).
   - Then all 13 kernels, while panel probes, the library studio's batches and a first pick may compile
     alongside.
   - Nothing is cached by text, so switching back to a scene compiles it again.
   - Recorded: the build's kernels one at a time took 4.6 s in all, while a real scene change took 18-33 s
     (2026-09-29). The cause is not established. The new `compile seq` column measures it directly.
   - Recorded on 2026-10-02: a path edited in the picture compiled in 15.5 s, after a fix that took it down
     from 70 s (`PERFORMANCE.md`). In that parallel build march was ready at 3.0 s and occlude at 3.2 s. Shade
     was the last, at 15.5 s.

**What to do first** is easy and changes no pixel. Details in §6, revised by §10:
- Keep a sample in flight when rendering offscreen (#24): measured, 13-25% off every offscreen sample.
- Decide the budget (#27): exact, or a shorter budget on purpose. It is an accident now.
- Validate the probe without making a pipeline (#2).
- Deduplicate the scene and BSDF call sites inside shade (#4).
- Cache pipelines by their text (#6).
- Cut a sample into submissions (#26), if rows 35-36 say it lets the GPU start sooner.
- Stop re-sending the uniform bag per iteration (#1): up to part of the 6-12 ms of JavaScript a sample.
- Settle the shadow rays the last pass cuts short (#25): cheap, and small at the full budget.

**What to plan:**
- A distance-only march with one full evaluation at the hit (#7).
- Leaving the scene at its own bounds (#8).
- Photons that pay for themselves (#10).
- Splitting shade into a scene part and a scene-free part (#11, which is `PERFORMANCE.md`'s P1).
- Better sampling (#14).

And now on evidence: keeping the wavefront full through the tail of each sample (#12), for the heavy scenes.

**What to run next** is three console lines, an interleaved A/B (§8).

---

## 2. The architecture as it stands

### 2.1 One sample, pass by pass

Read in code, `raytrace_main.js` R.trace (1042-1474); counts measured here:

```
R.trace(count samples)                         one frame encoder; cut into ~150 ms submissions when heavy
 ├ ensureSky                                   readback only when the sun/turbidity changed
 ├ per sample:
 │   genrays          1 pass                   one camera ray per pixel (ray budget 1 GB ≈ 2.92 M rays)
 │   genphotons       1 pass                   light tracing: sun photons + emitter probes, after the camera rays
 │   [optics sources] n passes                 the lights' photons, when the scene has light-traced sources
 │   iterations × (budget, 24 at the defaults: (maxbounce + 1) + ceil(maxiter / 32)):
 │       uniforms → march, shade, occlude      3 staged copies of the WHOLE uniform struct
 │                                             (since 0.10.0 packed whole once a trace, then the seed and lastpass)
 │       prep_march   1 thread                 indirect args from the counters
 │       march        ≤ 32 SDF steps a ray     hit → shade queue; still going → other ping-pong buffer
 │       prep_shade   1 thread
 │       shade        material, BSDF, NEE, light-tracing connection, discovery
 │       prep_occlude 1 thread
 │       occlude      ≤ 32 steps a shadow ray  deposit into the frame buffer if nothing is in the way
 │       flip         1 thread                 swap ping-pong, reset the other side's counters
 │   resolve          1 pass                   fold the sample into the accumulation (EMA + error bar)
 │   lt_build         every 4 samples          learned photon map
 │   emit_collect/publish every 2 samples      emitter list
 ├ auto-exposure      2 passes
 └ display            1 render pass
= 174 compute passes, 173 dispatches, 82 uniform copies per sample (measured here, every bundled scene)
```

**Data** (read in code):
- A `Ray` is 112 bytes and a `Hit` 144 bytes, as arrays of structs (`tracebasics.js:288-347`): 368 bytes a ray
  in flight, so the 1 GB budget is ~2.92 M rays (`raytrace_main.js:110`).
- Each iteration reads and writes them once per kernel.
- Contributions are f32 added by compare-and-swap (`wavefront.js` depositWGSL).

### 2.2 What each kernel holds

Measured here with `shaderstats.mjs`, in characters of comment-free WGSL. "Inlined" is the size with every call
inlined, which is what FXC and the drivers' compilers work on (`bench/wgslgraph.js` says why). Copies are static
call sites, an upper bound.

| scene | march | shade | occlude | probe | pick | SDF in shade | getMaterial2 in shade | one SDF | one getMaterial2 |
|---|---|---|---|---|---|---|---|---|---|
| one sphere (the floor) | 3K | **185K** | 8K | – | – | 4 | 4 | 1K | 0.2K |
| menger | 10K | 247K | 24K | 9K | 55K | 4 | 4 | 8K | 9K |
| materials | 14K | 244K | 23K | 13K | 75K | 4 | 4 | 12K | 4K |
| optics-test | 13K | 252K | 25K | 12K | 69K | 4 | 4 | 12K | 6K |
| RGBW_mixer | 23K | 317K | 40K | 21K | 139K | 4 | 4 | 21K | 12K |
| demo | 30K | 307K | 39K | 28K | 176K | 4 | 4 | 28K | 4K |
| showcase | 37K | 347K | 49K | 35K | 201K | 4 | 4 | 35K | 7K |
| surfaces | 37K | 539K | 97K | 36K | 199K | **8** | 4 | 35K | 55K |
| noise | 73K | 819K | 167K | 71K | 487K | **8** | 4 | 71K | 89K |
| demoscene (main, 2026-10-02) | 44K | 687K | 133K | 42K | 295K | **8** | 4 | 42K | 85K |
| **OpticsBench** (main, 2026-10-02) | 205K | **1877K** | 431K | 203K | **1610K** | **8** | 4 | 203K | 221K |

**Where shade's copies come from** (read in code):
- the normal by differences in `processMaterial` (`tracebasics.js:405`, `calcNormals_fast`);
- the medium behind a transmissive surface (`materials_pbr.js:647`);
- the emitter probe's own normal and its medium (`tracebasics.js:567-591`, `probeProcess`).

Each site has its own `getMaterial2`. In a scene whose materials read `p_local`, each `getMaterial2` also holds a
`localPoint()`, which is the whole SDF again (`codegen.js:550-556`). Two of those sit behind
`checkInside = true`, and a compiler that inlines can fold them away. So 6 is likely the real count, not 8
(inferred).

**Shade's floor**, 185K with one sphere (measured here):
- `processMaterial_advanced` 100K, of which `ltConnect` 65K;
- `lobesEval` inlined 9 times (7K each);
- `makeLobes` 4 times (13K each);
- `lobesPdf` 6 times.

The three NEE branches each evaluate the lobes separately (`materials_pbr.js:709`, `:756`, `:782`). Sketch
evaluates them three times more (`:577-579`), and `ltConnect` builds lobes twice (`:447-449`).

### 2.3 From the design tree to WGSL

Read in code, `builder/codegen.js`.

- **One function, `SDF(r: Ray) -> Hit`.** Every node is a block inside it:
  - a transform is `xfPoint` plus `XF_M`/`XF_S` bookkeeping;
  - a plain union folds each child into the scene's `Hit`;
  - a CSG group gives each child a private `Hit` and combines them;
  - group code is a `children_<id>` function it calls.
- **Every number is a uniform**, so a slider never recompiles: transforms as `mat4x4`, blends, materials'
  fields, live paths and profiles. A scene with 14 objects has ~200-300 uniforms (measured here: 118-292
  fields in the compute struct for the older scenes, 457 for OpticsBench).
- **Culling** is a box per top-level node, tested at every SDF call (`codegen.js:1481-1497`). The boxes are
  measured on the GPU from a tagged copy of the scene (`boxes.js`, `field.js` tagfield). It is applied only at
  the root, not inside groups. Recorded: it made the Noise library 3.95 × faster (run 5).
- **Three copies of the scene are generated:**
  - render (`wgsl`);
  - pick (`pickWgsl`, tags every node);
  - optics, only with a limiter.
  - A fourth text, the probe body, is the prelude and the render copy together.

The design is clean, and it keeps the user's code byte-identical. What it costs: every evaluation of the scene
computes everything, the distance, normal, material, medium and frames, because `add_new`/`fold` do all of it
whatever the caller needs.

### 2.4 Light transport

Read in code, `materials_pbr.js`, `tracebasics.js`, `wavefront.js`:

- **Next-event estimation** picks among three kinds of light: light faces (the camera's own paths), discovered
  emitters (cones toward the boxes of a 16³ discovery grid), and the analytic sun/sky. One shadow ray per
  vertex, weighted against BSDF sampling with the power heuristic.
- **Light tracing** sends photons from the sun (a learned 128 × 128 map over a square) and from discovered
  emitters (Crofton probes). They connect to the camera at the first evaluable vertex after one or more delta
  events, with an exact split against the camera paths. The lights' photons come from the optics module.
- **Layered GGX** (VNDF sampling, exact dielectric Fresnel, Kulla-Conty, tables on the GPU).
- **Fast modes**, Draft and Sketch.

This is careful, state-of-the-art work, and it is unbiased. Its performance side:
- One shadow ray per vertex, marched like any ray (§2.1).
- Photons cost what camera rays cost.
- Sun photons are sent whenever the sun is up: `ltPhotons` 1 per pixel by default
  (`uniforms.schema.js:67-73`, `raytrace_main.js:1067`). The same setting counts the lights' photons too, and
  in the Optics view (renderMode 3, added on main) they are the whole of the light.
- A sun or emitter photon can only ever connect after a delta event, a mirror or smooth glass
  (`tracebasics.js:663`), and its walk ends at the first other scatter (`:685-686`). So in a scene with no such
  surface, every photon is marched to its first hit and shaded for nothing (read in code).

### 2.5 What compiles, and when

Read in code:

| action | what compiles | scene copies |
|---|---|---|
| cold load | 6 init kernels, then the build's 13 (`raytrace_main.js:328-341`); tagfield once boxes are wanted | 3 + 1 |
| structural edit or scene switch | **probe** (full pipeline, awaited first, `demo.js:261` → `validate.js:60-64`), then the 13; panel probes on selection (`panel.js:1080`); tagfield after (`boxes.js`) | 4-6 |
| first click after a change | pick (`pick.js`, 8 SDF copies) | +1 |
| Library visible | the studio's own renderer: 6 + 13, then 13 per batch of 8 items, re-done when it revisits a batch (`studio.js:297-355`); not held off while the main renderer compiles | +3 per batch |
| optics Run / live rays | opt_gen, opt_shade (4-6 SDF copies), march over the optics copy | +2 |
| slider, transform, live path | nothing | 0 |

Of the build's 13:
- 3 inline the scene: march, shade, occlude.
- 4 declare only the scene's uniforms: genrays, resolve, genphotons, emit_collect. They therefore change text
  whenever the uniform list does.
- 6 are byte-identical every time.

Nothing in the app caches a pipeline by its text (read in code). The browser's own cache may still answer.
Recorded: "from the cache (0.4 s)", run 3.

---

## 3. Are the fundamentals solid?

### What is solid, and should stay

- **The estimators.**
  - Unbiased MIS, a light-tracing split that cannot double count, measured units, error bars.
  - Image tests with closed-form answers.
  - Performance work here must never trade these away, and none of the proposals below does.
- **The wavefront structure.**
  - Compaction through atomic queues, indirect dispatch, and no CPU round trip inside a sample.
  - The flush, so a short iteration budget costs convergence and never light.
  - Submissions cut against the Windows watchdog.
- **The memory bound on rays.** A 1 GB budget instead of a count, with the image tiled when it is exceeded.
- **Uniforms for everything live.** Editing a value never compiles.
- **Bounding-box culling, measured on the GPU.** Recorded: 3.95 × on the heaviest scene.
- **The instruments.**
  - The benchmark, per-kernel timestamps and uncached compiles.
  - check-shaders with naga.
  - The habit of labelling evidence.

  This review leans on all of them.

### Where the structure costs (findings, with evidence)

**F1. One uber-kernel for every kind of ray.**
- Shade runs camera rays, sun photons, emitter probes, optics photons, seek rays and escaped rays in one kernel,
  with branches per ray type (read in code, `wavefront.js` prog_shade, `tracebasics.js` processMaterial).
- On a GPU, a kernel's register allocation and occupancy are set by its heaviest path, and lanes of one warp
  that take different branches run them one after the other.
- Inferred:
  - Shade's cost is high whatever the scene. Recorded: 21-35 ms a sample in every benchmark scene (run 5),
    and one-sphere shade took 2.1 s to compile (2026-09-29).
  - The camera rays pay for the photon paths' code and the reverse.
  - Test: shade ms per shaded hit, per iteration, from the new wavefront log (§8). Iteration 0 is mostly first
    hits, later ones are bounces.

**F2. The scene is inlined everywhere it is asked a question.**
- Four to eight copies of the SDF and four of `getMaterial2` in shade (measured here, §2.2).
- In the heavy scenes the copies are most of shade's inlined size: 819K for the Noise library and 1877K for
  OpticsBench, against the 185K floor (measured here).
- Compile time follows the scene's weight: recorded uncached compiles took 22.7 s for the Noise library
  against 3.7 s for materials (run 4, Ampere). That they follow the copies is inferred; `compile seq` per
  kernel before and after #4 tests it.
- Every structural edit recompiles all of shade, its scene-independent 185K included.

**F3. A march step does a whole evaluation's bookkeeping** (finding 2 above).
- The fix keeps the user's code as it is: the march kernel's prelude can define `fold` to keep only the
  distance, and the compiler then drops everything that computes a normal, a frame or a material as dead code
  (inferred, standard dead-code elimination after inlining; test: march ms in the benchmark).

**F4. Per-iteration host work is proportional to the scene's size, not to what changes.**
- 82 full uniform copies a sample (measured here).
- The JavaScript cost follows the uniform count: 4.8 ms with 122 fields, 14.6 ms with 296, 29.9 ms with 457
  (measured here, node).

**F5. Fixed dispatch structure.**
- Seven passes per iteration, four of them one-thread bookkeeping, and up to 24 iterations at the defaults.
- The code's own note says the adaptive budget's shrink "has never once fired". **Measured (Pascal): it does.**
  Four scenes ran 8-18 iterations. How is open; the note now says so (§10.4).
- **Measured (Pascal):** the gaps between passes cost the GPU nothing (under 0.13 ms a sample), and the drained
  tail is 7-45% of a sample's iteration time (§10.1-10.2). The fixed structure costs where the wavefront is
  nearly empty, not between its passes.

**F6. Empty space is long.**
- Escape is only past the scene's radius, 400 m for most scenes (finding 4 above).
- Photons also start at `envRadius` (`wavefront.js:451`). That costs few steps: they head at the scene, so the
  distance shrinks geometrically (inferred).

**F7. Photons whatever the materials** (§2.4).

**F8. Compile orchestration.**
- The probe compiles a full pipeline and serialises ahead of the build.
- Nothing stops other compiles running alongside the build.
- There is no text cache (§2.5).

---

## 4. Compile time in detail

**What the user waits for after a structural edit** (read in code; recorded where marked):

```
probe pipeline (prelude + scene)             recorded 1.2-3.1 s (2026-09-29), 1.5-2.3 s (2026-10-02)
  └ then setScene: 13 kernels at once        recorded 18.5-32.7 s for the Noise library (2026-09-29, "shade 18546");
                                             15.5 s for a path edited in the picture (2026-10-02, "shade 15528")
       shade  = floor 185K + scene copies    the slowest every time it was recorded
       occlude, march, genrays…              recorded occlude 3.4-6.2 s, march 1.8-2.6 s, genrays 0.5-0.7 s in those changes
  └ meanwhile: panel probe(s), tagfield after, studio batches if the Library is visible, pick on a click
```

**The levers, by size:**

1. **Shade's floor should not be in an edit at all** (#11). 185K of BSDF, NEE and light-tracing code is
   recompiled because the kernel also holds the scene.
   - Split it in two:
     - a **surface** kernel: the scene's normal, material, medium and emission at each hit, written to a
       compact record;
     - a **scatter** kernel: the BSDF, NEE and connections, reading only that record and uniforms.
   - The scatter kernel then compiles once per session; light faces would come from a small storage buffer the
     host fills, instead of generated code.
   - It also gives F1 a seam: camera rays and photons could be shaded by different kernels.
   - Hard: the record's layout, a pass and a buffer more per iteration, and every path in shade has to be
     checked. Image results must be identical: photometry, furnace, bsdf-parity, lt, emitters.
2. **Fewer copies of the scene inside shade** (#4). This is easy to medium, and its static effect can be read
   now:
   - compute the hit's normal and material once at the top of the kernel, for camera rays and probes alike;
   - put the two medium probes on one call site.
   - Expected, by the same count: SDF copies 4 → 2 (8 → 3 or 4 with `p_local`), `getMaterial2` 4 → 2.
   - The BSDF side: let the three NEE branches choose a direction and a pdf, then evaluate the lobes once
     (`lobesEval` 9 → about 4).
   - Compile time should fall roughly in proportion to the inlined size (inferred; test: `compile seq` per
     kernel before and after).
3. **The probe without a pipeline** (#2).
   - `createShaderModule` plus `getCompilationInfo` runs WGSL's parse, types and uniformity checks, which is
     where the user's errors come from. Making a pipeline adds the backend compile on top (inferred from how
     WebGPU splits the two; test: the new `moduleMs` against the probe's recorded 1.2-3.1 s).
   - Errors only a pipeline can raise (binding limits) would still surface from setScene.
   - Even without that change, the build need not wait for the probe: start both, and drop the build if the
     probe fails.
4. **One thing at a time** (#3).
   - Hold the studio, pick, tagfield and panel probes while `RT._building` is set.
   - Choose parallel or sequential for the build by measurement: the new `compile seq` against `compile ms`.
5. **Kernels that do not use the scene should not be rebuilt by it** (#5).
   - genrays, resolve, genphotons and emit_collect declare the scene's uniforms only because the whole bag is
     handed to every pipeline (`genrays.js:6-9`, the code's own note). Recorded: genrays 546 ms in the path edit
     of 2026-10-02.
   - Filter the bag per pipeline, as `forRender` already does for the display (`raytrace_main.js:26-28`). Their
     text then stays the same, and the browser's cache answers.
6. **A pipeline cache keyed by text** (#6). Switching back to a scene, undoing an edit and revisiting a studio
   batch would cost nothing.
7. **pick holds 8 SDF copies** (measured here).
   - `pickNormal` makes six calls by central differences, plus the march and the capture (`pick.js:41-49`).
     OpticsBench's pick is 1610K inlined (measured here).
   - A loop over six offsets, as `calcNormals` does, makes them one. This is a first-click delay, not an edit's.

---

## 5. Render time in detail

### 5.1 Where a sample's GPU time went

Recorded, run 5, Ampere, 1280 × 720, ms a sample:

| row | gpu | march | shade | occlude | genphotons |
|---|---|---|---|---|---|
| Noise library | 250.4 | 127.8 | 34.7 | 72.2 | 12.4 |
| Noise library, reliefs removed | 75.2 | 28.2 | 26.8 | 7.0 | 12.4 |
| Noise library, boxes off | 988.9 | 771.9 | 33.0 | 168.6 | 10.9 |

The run also records:
- shade 26-34 ms in Surface materials, showcase, demo, Menger and materials;
- wall clock 0-44 ms a sample above GPU time.

The code has changed since (see the top). Read as directions:
- Heavy geometry is march and occlusion time.
- Every scene pays ~25-35 ms of shade.
- Some time is outside the kernels altogether.

### 5.2 March and occlusion: what a step costs, and how many steps

- **Per step** (F3). Removing per-step bookkeeping is #7.
  - "Find where" becomes a distance-only loop. "Then what" becomes one full evaluation at the hit, in the same
    kernel, after the loop.
  - That evaluation can also record the local point and frame (`LOCAL_CAPTURE`). That would remove
    `localPoint()`'s extra SDF evaluation per hit from shade, and its copies from shade's code.
  - Occlusion needs only distance, except for an emitter shadow ray at its hit.
- **How many steps.** An escaping ray, idealised:
  - Setup: a ray leaving a floor at elevation θ, nothing else near. Each step is 0.9 × its height, so the
    distance travelled grows by (1 + 0.9 sin θ) per step.
  - Steps to reach distance D from a start height h₀ ≈ ln(D sin θ / h₀) / ln(1 + 0.9 sin θ).
  - With h₀ = 2 mm (10 × the auto epsilon of a 2 m scene):

    | | to 400 m | to the 2 m scene's edge |
    |---|---|---|
    | θ = 30° | ≈ 31 steps | ≈ 17 |
    | θ = 10° | ≈ 72 | ≈ 36 |
    | θ = 3° | ≈ 200 | ≈ 86 |

  - Inferred arithmetic, not a measurement: objects shorten the steps in a real scene, and grazing rays also
    hit `maxiter`. Test: the wavefront log's shadow rays still queued after each iteration (`shadowsNext`).
    Shadow rays that need over 32 steps show up there.
- **The fix (#8):** treat a ray as escaped once it is outside every top-level box and cannot hit any of them.
  - Each box is already tested at every step (`cullDist`). A ray-box test against the same boxes says whether
    any lies ahead.
  - It is exact for bounded scenes. A scene with an unbounded node (a plane) needs that node's own analytic
    test, or keeps the old exit.
  - A simpler first step: an escape radius from the scene's extent (`scene.extent`, already computed) when every
    top-level node is bounded.
- **Over-relaxed sphere tracing (#16)**, Keinert et al. 2014: step by ω·d with a fallback when consecutive
  spheres stop overlapping. The literature reports fewer steps in open scenes (inferred for these scenes). It is
  exact in principle, but it is the one proposal that can lose thin features if done carelessly. Only with
  image tests showing identical results.

### 5.3 Shade

- **25-35 ms a sample whatever the scene** (recorded, §5.1). Candidates, all inferred, each with its test:
  - **occupancy, from code size and register pressure (F1);**
    - test: shade ms per hit before and after #4;
  - **the normal by differences:** 3 more scene evaluations per hit where a primitive or warp gives no analytic
    normal (`tracebasics.js:405-413`);
    - recorded: `fastnormals 0` cost 4.3 × the frame in cost-sweep's first run (Pascal, old code);
    - **every relief hit pays it, though the relief already has its gradient.** `fbm3` returns (gradient,
      value) (`noise.js:171-182`). The noise relief uses only the value and folds `VEC4(0, 0, 0, d)`, so the
      normal is dropped (`modifiers.js:60-61`, `scene_api.js:245-250`).
    - With the base shape's analytic normal, the relief's is exact: the gradient of d_base − a·n(p / size) is
      ∇d_base − (a / size)·∇n. That is three fewer evaluations of the whole scene per relief hit (#20). Material
      reliefs return only (height, slope) (`codegen.js:917-924`), so they would need a gradient out too;
  - **divergence between ray types;**
    - test: photons on and off (rows 1 and 2), shade ms per hit;
  - **the emitter list read through atomics:**
    - `emitPick`, `emitConePdf`, `emitCovers` and `emitLineDensity` loop over up to 64 listed boxes with an
      `atomicLoad` per field (`tracebasics.js:831-893`);
    - read-only during a sample, but they share a binding with the atomics written in it;
    - inferred: Tint lowers `atomicLoad` for D3D12 to an interlocked operation, not a plain load;
    - matters only where many boxes are listed (#18, low priority);
    - test: shade with `softbox emission 0` (row 5) against row 1.

### 5.4 The CPU and the gaps between kernels

> **Measured since (§10.1):** the GPU gaps are nil, and outside the GPU a sample costs 2.35 ms an iteration in
> Chrome whatever its uniform count. That is not the per-field cost the node profile below describes. Read this
> section as the node half of the story; `record ms` gives the browser's.

Measured here per sample: 174 passes, 82 uniform copies, 74-638 KB in all, and 4.8-29.9 ms of JavaScript. The
same at 128 × 128 as at 1280 × 720 (measured on the code of 2026-10-01).

Read in code, the render loop (`render-loop.js:63-66`) aims at 20 fps with up to 64 samples a frame. In a light
scene the CPU therefore fills the frame before the GPU does (inferred; test: `cpu ms` in the cost tests). The
same holds for small renders: the studio's thumbnails, and half resolution while dragging.

The fix comes in two steps (#1):
1. **Step 1:** set the full bag on march, shade and occlude once a sample, and per iteration only `seed` and
   `lastpass` (and the few per-iteration counts). tinywebgpu then packs a few fields instead of ~300. It still
   stages a copy of the struct.
   **Done in 0.10.0, once a TRACE rather than once a sample**, for every program R.trace writes: the whole bag
   at a program's first write in a trace, then only what moves. The appendix has the node numbers after it.
2. **Step 2:**
   - Let flip count iterations in the counters buffer, and derive the seed and `lastpass` from that count on
     the GPU. This needs one uniform write a frame, no copy between dispatches, and lets a whole chain run in
     one compute pass (tinywebgpu's `beginCompute`, which R.trace does not use, `kerneltime.js:9`).
   - With it, merge `flip`, `prep_march` and `prep_occlude` into one one-thread kernel (#9): 7 → 5 passes an
     iteration.
   - The three scene kernels have identical uniform structs, so one shared buffer would do (a small tinywebgpu
     option).

### 5.5 The drained tail

> **Measured since (§10.2):** 45% of the Noise library's iteration time, 22-26% in Surface materials and showcase,
> 7-14% elsewhere. Latency-bound, and made of bounces rather than long marches, so the cheaper option below would
> not help.

Each sample runs the whole budget (24 iterations at the defaults). The first iterations march every camera ray
and photon; the last ones a few long paths: glass, deep interiors, grazing shadow rays. Two ways to keep the
GPU busy:
- **Path regeneration (#12).** A camera path that ends starts the next sample's path for its pixel in the same
  wavefront. Resolve already divides by the paths that landed on a pixel (`wavefront.js` prog_resolve), so the
  accounting fits.
  - Hard, because of the seeds, the flush, the light-tracing epochs, and what a "sample" means for the EMA.
  - **Only worth it if `tail ms` is large.**
- Cheaper: grow the march's step budget per iteration as the queue empties.
  - Small changes, but `MAX_STEPS` is a constant both kernels share with the host (`raytrace_main.js:34`).

### 5.6 Photons (#10)

- Sun photons up to double the primary rays whenever the sun is up: one per pixel, in whatever room the 1 GB
  ray budget leaves after the camera rays (§2.4; `raytrace_main.js` sharePhotons). The sun's photon square is
  capped at the scene's radius since 0.9.1, which spends the same photons better in a small scene; it does not
  change how many are sent.
- In a scene with no mirror or smooth glass, none can ever connect (read in code). In one with a little glass,
  the learned map spends where it helps, but every photon still costs a march.
- Proposal: steer the photon count from the connection rate the renderer already tracks (`R.ltStats`,
  `connPerPhoton`):
  - when it is zero, fall to a floor (say 5% of the setting), so a caustic that appears is still found;
  - when it is high, return to the setting.
- Brightness never depends on the count (each photon carries flux over the count sent, read in code). Only the
  noise of the caustic class does. Unbiased.
- Test: row 2 (light tracing off) against row 1 says what photons cost in that scene. The frame-cost test says
  it for any scene. Recorded: 70 ms with light tracing against 9 ms without, frame-cost's first run (Pascal,
  1188 × 969, old code).

### 5.7 Convergence: speed in the only currency that counts

The bench already scores noise² × time (tests.js, `imageEff`). Two levers on the noise side, both
quality-positive:
- **Better sampling (#14).**
  - Every random number is PCG4D (`tracebasics.js:256-267`).
  - A low-discrepancy or blue-noise sequence for the pixel jitter, the light pick and the first bounces
    typically lowers the noise at equal samples (inferred from the literature).
  - Test: the image tests' noise column at equal samples, means unchanged.
- **Adaptive sampling from the per-pixel error bar**, which resolve already keeps. Send more rays where the
  relative error is high (caustics, small lamps).
  - It changes which pixels converge first, not what they converge to.
  - Strictly, a sample-dependent stopping rule can bias a pixel slightly. For the measuring views, keep it off
    or fixed per pass.

### 5.8 Baking what is locked (the user's suggestion, 2026-10-02)

A node can now lock its position and its parameters. The suggestion: write a locked node's values into the
shader as numbers instead of reading them from uniforms.

**What locks are today** (read in code, `model.js:1057-1069`):
- `lockPosition` covers position and rotation. `lockParams` covers the parameters and the uniform scale.
- They are *"against the hand, not the program"*. The gizmo and the panel honour them, but a model operation,
  the parameter registry (the timeline, a script, the command palette) and undo still change a locked node.
- Codegen never sees them: `toTree` does not copy them, so a lock compiles nothing.

**What baking could buy:**

| | evidence |
|---|---|
| **GPU.** Each evaluated object pays `xfPoint`, a 3 × 3 product and a division, at every step, on both the box test and its own frame. With the matrix a literal and its rotation the identity, a compiler folds that to a subtraction; the frame product `XF_M * xfRot(T)` folds away too, though #7 removes it anyway. | read in code (`codegen.js:1104-1129`, `scene_api.js:149-154`); the folding is inferred |
| OpticsBench has 93 transforms, 65 of them with no rotation and scale 1, and 37 nodes position-locked. In the other bundled scenes 63 of 96 transforms have no rotation and scale 1, and nothing is locked. | measured here (static) |
| **CPU.** Transforms are 70% of OpticsBench's uniform struct, 1488 of 2126 words, and its 37 locked ones 592. Recording a sample costs in proportion to the struct (§5.4). | measured here |
| ...but **#1 removes that cost for every value, locked or not**. Do #1 first, and this half of the gain mostly goes. Materials are the largest share of the fields in most scenes (193 of 334 in demoscene), and locks do not touch them. | measured here; reasoning |
| **Compile.** Neutral to slightly better per compile, since folded code is smaller. | inferred |

**What it would cost:**
- **More compiles.** Locking compiles, and so does unlocking, before the gizmo can move the node: seconds, at
  the moment the user wants to act (recorded: 15.5 s for a path edit, `PERFORMANCE.md`).
  - With #6, a pipeline cache by text, unlocking would return to a text compiled before: instant if cached.
- **Every program change to a locked value becomes a compile,** as a compile-time parameter's already is
  (`panel.js:575-580`).
  - A **timeline track** on a locked node would then recompile every frame.
  - Either the timeline skips baked values, or the lock contract changes to "against the program too". **That is
    a decision for the user.** Nothing in the code can settle it.
- **The golden shaders of a scene with locks move.** That is a refreeze, an agreed change.

**Ease 2-3.** Parameters are nearly there: a compile-time parameter is already a `const` (`codegen.js`
`aliasPrelude`), so a locked node could take all its parameters that way. A transform needs a literal path of its
own. The light faces read the transform too (`emitLightFaces`), so they need the same literal. Routing writes to
a compile is the larger part.

**Measure the ceiling first:** a benchmark variant that bakes every transform and parameter of a scene, as if
all were locked, against the same scene as it is. It is the same picture, so the GPU ms difference is the most
locking could ever buy. Run it on the Noise library and on a frozen copy of OpticsBench. Under a few percent,
leave it. *Not built yet:* it adds rows, and the benchmark should not change while it is being run.

**Related, from the same count:** OpticsBench's 93 nodes have culling boxes only for its 8 top-level ones
(measured here: 16 box uniforms). Culling inside union groups (#13a) would reach the rest.

---

## 6. The ranked list

**Ease:**
- 1: hours, local;
- 2: a day, one subsystem;
- 3: days, two subsystems;
- 4: a week or more, cross-cutting;
- 5: a redesign.

**Gain**, the expected size of the effect where it applies: S < 5%, M 5-20%, L 20-50%, XL > 50%. Each gain is
labelled with the evidence behind it. **Revised after the first measured run (§10):** the rows it moved say
"Pascal" in their evidence.

**Quality** says what it changes in the picture; "none" means the estimator is untouched.

| # | improvement | where it pays | ease | gain | evidence | quality |
|---|---|---|---|---|---|---|
| 1 | Uniforms: the bag once a sample, then GPU-side iteration count and seed; one compute pass a chain | CPU per sample | 1 (step 1), 2 (step 2) | S-M: the JavaScript is 6-12 ms a sample, of 50-57 outside the GPU; step 1 saves part of that | Pascal (`record ms`, matching node's recording within 10%) | none |
| 2 | Probe by module validation; don't make the build wait for it | every structural edit | 1-2 | ~1-3 s an edit: a module checked in 27-33 ms against a pipeline's 1.2-3.1 s | Pascal (`moduleMs`, march text) + recorded probe | none. **Done in 0.9.5** (the module part; the build still waits, now for milliseconds) |
| 3 | One compile at a time: hold the studio, pick, tagfield and panel probes during a build | edits with other compiles about | 1-2 | ? (not measured: the benchmark compiles alone). Building the kernels one at a time is refuted: 16-20% slower | Pascal | none |
| 4 | Deduplicate shade's call sites: the normal, the material and the medium beyond, asked once each for probes and paths | compile; maybe shade time | 2 | compile **L** for heavy scenes: shade's inlined size −13% to −37% (measured here), Noise library's shade forecast 10.7 → 6.7 s | measured here (static) + Pascal (rate per size); the seconds inferred | none. **Done in 0.9.5** (§10.7); the lobe evaluations (`lobesEval` 9) not touched |
| 5 | Each kernel gets only its own uniforms (genrays, resolve, genphotons, emit_collect) | compile; CPU | 1 | S (they compile in 12-126 ms alone) | Pascal (`compile seq`) | none |
| 6 | Pipeline cache by text (LRU of a few scenes) | revisits: switch back, undo, studio batches | 1-2 | **XL** on a revisit | read in code (no cache) | none |
| 7 | Distance-only march and occlusion, one full evaluation at the hit, capturing the local point there | march + occlude (Pascal: 80% of the Noise library's GPU time, 86% of Menger's); shade's `localPoint` | 3 | M-L | Pascal (share) + read in code; the saving a step inferred | none (`normallimit` < 1, a developer setting, would lose its meaning in the march) |
| 8 | Leave the scene at its bounds, and enter it there: ray against the top-level boxes, or an escape radius from the extent | escaping and shadow rays (Pascal: a quarter of the Noise library's GPU time); camera rays crossing empty space (Menger: no hit in the first 32 steps) | 2-3 | M (idealised: about half the steps of an escaping ray) | Pascal (where it applies) + inferred arithmetic | none |
| 9 | Merge flip, prep_march and prep_occlude (7 → 5 passes an iteration) | CPU per iteration, if the calls are the cost | 2 | GPU: none; CPU: ? | Pascal (`gaps` under 0.13 ms); `record ms` to measure | none |
| 10 | Photon count steered by the connection rate, with a floor | sun-lit scenes with little or no glass | 2 | S in the Noise library (light tracing is 4% of its GPU time); other scenes unmeasured | Pascal (row 2) | noise of the caustic class only; unbiased |
| 11 | Split shade: a scene surface kernel and a scene-free scatter kernel (`PERFORMANCE.md` P1) | every edit's compile; shade occupancy | 4 | compile **XL** for edits (Noise library ≈ 11 s → ≈ 2.5 s); runtime ? | Pascal (13 ms per 1000 chars) + measured here (sizes); the gain inferred from both | none |
| 12 | Keep the wavefront full (path regeneration) | the drained tail | 4-5 | **L** for heavy scenes (tail 45% of the Noise library's iteration time, 22-26% Surface materials, showcase); S-M elsewhere | Pascal (`tail ms`) | none if the accounting holds |
| 13 | Culling inside plain union groups (13a); a BVH over the top-level boxes (13b) | scenes with nested groups or many objects | 2 / 3-4 | scene-dependent | inferred | none |
| 14 | Low-discrepancy or blue-noise sampling; adaptive sampling from the error bar | time to a given noise | 3 | M-L in noise² × time | inferred (literature) | better; adaptive off for measurements |
| 15 | Ray and Hit layout: struct of arrays, smaller fields (`PERFORMANCE.md` P6) | memory traffic | 3-4 | S-M | inferred | none (f16 fields would need care) |
| 16 | Over-relaxed sphere tracing with fallback | march steps | 2 | M | inferred | **risk**: thin features if wrong |
| 17 | Shade by ray type, or hits sorted by material | shade divergence | 4 | ? | inferred | none |
| 18 | Emitter list read without atomics | emissive scenes with many boxes | 3 | S-M | inferred (Tint's D3D12 lowering) | none |
| 19 | Subgroup operations for the queues (one atomic per subgroup) | every append | 2-3 | S | inferred | none |
| 20 | Analytic relief normals from the noise's own gradient (and a value-only noise in the march) | every relief hit in shade; relief steps | 2 | M for relief scenes (3 fewer scene evaluations per relief hit) | read in code | none (exact where differences were approximate) |
| 21 | The scene as data: standard nodes in a buffer, one fixed SDF interpreter (`PERFORMANCE.md` P3) | structural edits of standard nodes compile nothing | 5 | compile **XL** for those edits; render: ? (an interpreted step against an inlined one) | inferred | none |
| 22 | Trace a fraction of the image's rays when a sample is slow (`PERFORMANCE.md` P5) | a page that stays responsive on a heavy scene | 2-3 | interactivity, not throughput | inferred (designed, not built) | none (unbiased: resolve averages what reached each pixel) |
| 23 | Bake a locked node's transform and parameters into the shader (the user's suggestion; §5.8) | march steps of locked objects (OpticsBench: 37 locked, 65 of 93 transforms foldable) | 2-3 | ? measure the ceiling first; the CPU half is #1's | read in code + inferred | none; the lock contract needs a decision (timeline) |
| 24 | One sample in flight offscreen: record the next while the GPU runs this one, as the live loop already does | saves, the timeline's frames, the studio's batches | 1 | **M-L: −13% (Noise library) to −25% (materials) a sample** | Pascal (`pipelined`, the same row back to back) | none. The benchmark's own samples: keep them awaited, so rows stay comparable, or time both (a decision) |
| 25 | The last pass's shadow rays: march them to `maxiter`, not 32 steps, so none is counted lit for lack of steps (§10.4) | the picture, not the speed | 1 | a cost: the last iteration's occlusion | Pascal (`cut`: a few per million at the full budget; 3,945 of Menger's last 6,253) + read in code | **removes a small bright bias** at the full budget; a large one when the budget is short |
| 26 | Cut a sample into submissions of a few iterations, so the GPU starts while the browser prepares the rest (`R.submitEvery`) | awaited samples; the first picture after a change | 1 | S-M: the time outside the GPU fell 41 → 8 ms (Noise library) and 16 → 6 ms (materials), but the GPU's rose too, cost or drift | Pascal (rows 35-36); an interleaved A/B to settle | none |
| 27 | The iteration budget as a decision: shrink from the worst case, not to the floor (`raytrace_main.js:1280`), or a shorter budget on purpose from a stated tolerance | light scenes | 1 | exact: none on the GPU, ~2 ms an iteration off it until #24/#26; deliberate: up to 1.6× (materials, 8 against 24 iterations) | read in code + Pascal (runs 1-3) | exact removes a 0.3% path truncation that comes and goes; deliberate keeps one, stated |

### The same list on the two axes

After the first measured run (§10):

```
                 gain →   small / unknown             medium                         large
ease ↓
easy (1-2)         5 own uniforms per kernel       1 uniforms once a sample       24 a sample in flight offscreen
                   3 compiles held in a build (?)  8 leave at the scene's bounds  2 probe without a pipeline
                   26 submissions per sample       20 analytic relief normals     4 shade call sites (compile)
                                                   13a culling in union groups
                   9 merge bookkeeping passes                                     6 pipeline cache (revisits)
                   10 photons that pay
                   19 subgroup appends
                   23 bake locked nodes (?)
medium (3)         18 emitter list, no atomics     16 over-relaxation (risk)      7 distance-only march
                   15 ray layout                                                  14 sampling (time to noise)
hard (4-5)         17 shade by ray type            13b BVH over the boxes         11 split shade (compile, P1)
                   22 a fraction of the rays (P5)                                 12 full wavefront (heavy scenes)
                                                                                  21 the scene as data (compile, P3)

quality, not speed: 25 the last pass's shadow rays (ease 1): small at the full budget (second run)
a decision first:  27 the iteration budget, exact or deliberate (ease 1), best taken after 24 and 26
```

### A suggested order

Each step is measured with the benchmark before the next. Revised after the first measured run (§10).

1. **#24 now** (measured, third run), **#26 after the interleaved A/B,** then #27 decided, then #2 and #6. No
   kernel changes. A save's samples should approach `gpu ms`, and edits lose the probe's wait.
2. **#25,** cheap and quality-positive. The second run found it small at the full budget.
3. **#4, then #11.** `shaderstats.mjs --bench` predicts each before it is run, at 13 ms per thousand inlined
   characters on the Pascal card. `compile seq` per kernel checks it.
4. **#7 and #8 together,** both inside the march and occlusion loops. The march and occlude columns decide them;
   the image tests must be unchanged.
5. **#12** for the heavy scenes, now that `tail ms` has shown the tail. Hard, so after the cheap items.
6. **#1 and #9:** `record ms` put the JavaScript at 6-12 ms a sample, so they buy part of that.
7. **#20, #10, #14 and #16** on evidence: the Noise library's shade column, the photon rows of other scenes,
   noise² × time, identical images.

---

## 7. Against `PERFORMANCE.md`'s plan

`docs/PERFORMANCE.md` has its own plan, P1-P6, reorganised on main on 2026-10-02. This review was written without
it, as asked, and arrived at three of its items from the code alone. Read beside it:

| `PERFORMANCE.md` | here | how they relate |
|---|---|---|
| P1, take the scene out of the shade kernel | #11 | **The same design.** P1 is more specific about the constraint: shade binds the eight storage buffers the spec guarantees, so the surface record must live inside the shade queue's element. This review adds the static sizes behind it: a 185K floor that compiles once, and scene copies that are most of the rest (§2.2). And #4 is a smaller step on the way, measurable first. |
| P2, bounding volumes | culling (§2.3) | Built; recorded 3.9 ×. #13 and #8 extend the same boxes: culling inside union groups, and leaving the scene at them. |
| P3, the scene as data | #21 | Not reached here from the code. Added to the list as recorded in `PERFORMANCE.md`: the only item that makes a structural edit compile nothing. Its render cost, an interpreted SDF step against an inlined one, is unmeasured (inferred to be higher). |
| P4, the relief in a shell | §5.1 | Built; recorded -22.9 %. #20 is the next step for the same scenes: their normals, not their steps. |
| P5, trace a fraction of the rays | #22 | Responsiveness, not throughput. It complements #1: #1 makes each sample cheaper to record; P5 lets a frame hold less than a sample. |
| P6, a smaller Ray | #15 | The same item. P6 has worked the layout out further (what the hand-off cannot save). |

**Not in that plan, from this review:**
- the per-iteration uniform copies and CPU cost (#1);
- the probe and compile scheduling (#2, #3, #6);
- shade's duplicated call sites (#4);
- the distance-only march (#7);
- leaving at the bounds (#8);
- photons by connection rate (#10);
- the relief normals (#20);
- the instruments in §8.

## 8. What to measure next, and what each answer decides

### Run this

**First run, done:** `await BENCH.run(1, 2, 3, 25, 27, 29, 31, 33)` on the Pascal card, 187 s. It is §10.

**Second run, done:** `await BENCH.run(1, 25, 31, 33)`, 128 s. It is §10.5.

**Third run, done:** `await BENCH.run(1, 33, 35, 36)`, 95 s. It is §10.6.

**Next**, on the same card: an A/B interleaved, every row at the full budget so the budget's accident (#27)
cannot pick a side:

```js
RT.autobudget = false
await BENCH.run(33, 35, 33, 35, 1, 36, 1, 36)
RT.autobudget = true
```

- `BENCH.run` takes the rows in the order given, repeats included.
- Row 33 compiles each time it comes round; the rest do not.
- Each pair, read against itself, is what a submission per iteration does. The spread between the repeats is
  what the card's drift is.

### The new columns, and what each decides

| column | what it is | what it decides |
|---|---|---|
| `gaps` | GPU time between the first pass's start and the last one's end that no pass ran (`kerneltime.js` tally) | how much #1 step 2 and #9 can buy on the GPU: the cost of the pass count itself |
| `tail ms` | GPU ms of the iterations that marched under a tenth of the first iteration's rays, from one extra sample with the wavefront log on; the JSON's `wavefront` has every iteration's rays and kernel ms | whether #12 is worth building; per iteration, shade ms ÷ hits shaded (F1); shadow rays that spill past 32 steps (#8) |
| `compile seq` | the same 13 kernels uncached, one at a time; the JSON's `compileSeqEach` per kernel and `moduleMs` for the march's text without a pipeline | sequential or parallel builds (#3); which kernel to cut first (#4, #11); what #2 saves |
| `record ms` (new, after §10) | the JavaScript from the sample's first uniform write to its last submit (`R.recordMs`), median over the timed samples | how much of `wall − gpu`, 2.35 ms an iteration on Pascal, is recording: #1 and #9 if most, #24 alone if little |
| `cut` (new, after §10) | shadow rays the logged sample ended without a surface or their light, by the last pass or by `maxiter`, and so counted as lit (`shadowcut`); per iteration in the JSON's `wavefront` | whether #25 is needed |
| `budget`, `budgetUsed`, `budgetFlushed` (JSON only) | the iteration budget the timed samples ran at, and the controller's last readings | how the budget came down (§10.4); the second run: it did not |
| `pipelined` (new, after §10.5) | ms a sample over 8 samples with the next one recorded while the GPU runs this one (`renderFrame`'s `inFlight`, `lib/pathtracer/samples.js`) | #24: if it reads near `gpu ms`, offscreen rendering should keep a sample in flight |
| `msSamples`, `recordSamples` (JSON only, new) | each timed sample's wall clock and recording, in order | whether the time outside the GPU is a toll some samples skip or a spread |
| rows 35-36 (new) | materials and row 1 with a submission per wavefront iteration (`R.submitEvery`) | #26: lower than rows 33 and 1, and cutting submissions lets the GPU start sooner |

Compare the rows already there too:
- row 2 against row 1 is the photons' cost (#10); measured, 4% of the Noise library's GPU time;
- row 3 against row 1 is NEE's, mostly occlusion (#8); measured, 26%.

### Without a GPU, before and after every change

`node bench/shaderstats.mjs` (`--bench` for the benchmark's own scenes). #4 and #11 show up
there as copies and inlined size, which on the Pascal card is compile time at about 13 ms per thousand characters
(§10.3). #1 shows up as passes, copies and JS ms.

### Instruments not built, worth building with the changes they test

- **Steps per ray by type.** A counter of march steps for camera rays, shadow rays and photons, as a developer
  setting. It would settle #8 and #16 directly, without inferring from queue spill.
- **Shade ms by ray type.** Falls out of #11 or #17, when shading is split.

---

## 9. Limits of this review

- **Two runs, one card.** §10 is the Pascal card on 2026-10-02, twice. They agree where they ran the same
  budget. The sections before it were written on recorded numbers from older code, and say so where §10 changed
  them.
- **The timestamps are coarse.** All 450 march, shade and occlude pass times in the logged samples are whole
  multiples of 0.0655 ms. Sums over a sample's passes are fair; a single pass under a tick is not.
- **Compile cost per inlined character differs by compiler** (FXC, DXC, Metal, the NVIDIA and AMD drivers).
  On the Pascal card it was 8-15 ms per thousand characters for every kernel (§10.3); on another card, measure it
  again. Static call sites over-count where constant arguments fold code away.
- **Not examined:**
  - the optics module's own trace performance;
  - the timeline's offscreen rendering;
  - weavesim;
  - export meshing.
- **Which compiler Chrome uses on this Windows machine** (FXC or DXC behind Dawn's D3D12 backend) was not
  checked. It changes the absolute compile times, and maybe how parallel builds behave. `chrome://gpu` lists
  Dawn's toggles.

---

## 10. The first measured run (Pascal, 2026-10-02)

**Measured by the user:** `BENCH.run(1, 2, 3, 25, 27, 29, 31, 33)` on an NVIDIA Pascal card, Chrome 154 on
Windows, 1280 × 720, code `0.9.2 · 3dd6fb2`. One run, one machine. Each row's kernel times are medians over four
samples of their own, and its wavefront log is one sample. Where a conclusion below is arithmetic on these
numbers (a fit, a share), it says so; where it goes further, it is marked inferred.

### 10.1 Where a sample's time went

ms a sample; `wall − gpu` is the timed samples' median less the kernel-timed samples' GPU total.

| row | wall | gpu | march | shade | occlude | genphotons | gaps | wall − gpu | iterations |
|---|---|---|---|---|---|---|---|---|---|
| Noise library | 243.1 | 184.7 | 102.8 | 27.2 | 45.5 | 5.5 | 0.07 | 58.4 | 24 |
| ...light tracing off | 236.4 | 177.6 | 91.8 | 22.6 | 60.0 | – | 0.07 | 58.7 | 24 |
| ...NEE off | 194.9 | 136.9 | 104.3 | 23.9 | 0.1 | 5.4 | 0.13 | 58.0 | 24 |
| Surface materials | 110.0 | 52.6 | 22.7 | 15.1 | 6.3 | 5.3 | 0.07 | 57.5 | 24 |
| showcase | 93.3 | 62.8 | 28.2 | 19.9 | 7.6 | 3.7 | 0.07 | 30.5 | 12 |
| demo | 93.5 | 54.8 | 24.2 | 17.7 | 8.5 | 1.3 | 0.07 | 38.7 | 16 |
| Menger cubes | 177.1 | 135.6 | 87.3 | 14.9 | 28.7 | 1.2 | 0.10 | 41.6 | 18 |
| materials | 53.7 | 33.0 | 11.7 | 13.4 | 4.0 | 0.9 | 0.00 | 20.7 | 8 |

**The GPU never waits between kernels.** `gaps` is under 0.13 ms a sample in every row, against 60-175 passes.
The pass count costs the GPU nothing measurable. #9 has no GPU gain, and neither has the GPU half of #1 step 2.

**The time outside the GPU grows with the iterations, not with the scene.** Fitted over the eight rows,
`wall − gpu ≈ 1.5 ms + 2.35 ms × iterations` (R² 0.995).
- It does not follow the uniform count. Menger cubes (189 uniform fields) and Surface materials (289) both pay
  about 2.35 ms an iteration (fields: `shaderstats.mjs --bench`, measured here).
- In node, recording these scenes takes 6-13 ms a sample at 24 iterations, or 0.25-0.55 ms an iteration, in
  proportion to the fields (measured here, the same tool).
- **Inferred:** most of the browser's 2.35 ms an iteration is therefore not tinywebgpu repacking uniforms. The
  likelier costs are the WebGPU calls themselves (seven compute passes and three uniform writes an iteration,
  through Chrome's GPU process) and waiting for the GPU to say it is done. #1 step 1 may buy less than the node
  profile suggested.
- Test: the new `record ms` column, the JavaScript from the first uniform write to the last submit.

**Where that time is paid** (read in code):
- Offscreen, every sample waits for the GPU before the next is recorded (`lib/pathtracer/index.js:444-459`,
  renderFrame). Saves, the timeline's frames and the benchmark pay the whole of `wall − gpu`: 23-52% of the wall
  clock in these rows.
- The live loop records the next frame without waiting for the GPU (`render-loop.js:69-71`). There the CPU's part
  overlaps the GPU's, and costs only where it is the larger (inferred).
- That makes **#24, one sample in flight offscreen**, the cheapest large item on the list. Its gain is inferred.

**Shadow rays are a quarter of the Noise library's GPU time.** NEE off: −47.8 ms (−26%). Occlude goes to 0.1;
march barely moves (102.8 → 104.3). This is the budget #7 and #8 work on for occlusion.

**Light tracing costs the Noise library 4%** (−7.1 ms GPU, −2.8% wall). genphotons is 5.5 ms; march falls 11 ms
and shade 4.6. But occlude *rises* by 14.5 ms with light tracing off, at nearly the same shadow-ray counts
(iteration 1: 300k with, 307k without).
- Why is not established. Hypothesis: with light tracing on, part of the queue is camera connections, which end
  at the camera, while NEE rays run to the sky.
- Test: steps per ray by type (§8, not built).
- Either way, #10 has little to buy in this scene.

**Menger cubes: no ray hit anything in its first 32 steps.** Iteration 0 marched 1,843,200 rays and shaded 0.
- March is 64% of the GPU time, and march plus occlude 86%.
- Every camera ray crosses empty space, or creeps along the fractal's bound, before its first hit.
- #8's ray against the boxes would let a ray start at its first box rather than at the camera. #16 is the
  other lever.

**Shade costs 2.6-5.8 ns a hit at iteration 0,** which is mostly first hits:

| scene | ns a hit |
|---|---|
| materials | 2.6 |
| demo | 4.0 |
| Surface materials | 5.3 |
| Noise library | 5.5 |
| showcase | 5.8 |

Later iterations cost more a hit in materials (5.2 ns at iteration 2), where rays have scattered. Camera hits
cost more than photon hits: 6.8 ns at iteration 0 with light tracing off, against 5.5 ns with photons in the mix.

### 10.2 The drained tail

`tail ms`: the iterations that marched under a tenth of the first one's rays, from the one logged sample.

| row | iterations | in the tail | tail ms | iterations' GPU ms | share |
|---|---|---|---|---|---|
| Noise library | 24 | 21 | 81.1 | 179.9 | **45%** |
| ...light tracing off | 24 | 20 | 76.0 | 179.0 | 42% |
| ...NEE off | 24 | 21 | 48.2 | 130.5 | 37% |
| Surface materials | 24 | 21 | 11.5 | 44.8 | 26% |
| showcase | 12 | 8 | 12.1 | 55.6 | 22% |
| demo | 16 | 11 | 6.9 | 50.6 | 14% |
| Menger cubes | 18 | 4 | 9.8 | 131.9 | 7% |
| materials | 8 | 4 | 2.2 | 29.2 | 7% |

- **The tail is latency, not work.** In the Noise library, iterations 7 to 16 each took 2.9-3.7 ms while the rays
  they marched fell from 10,151 to 164. With 164-455 rays (a handful of warps), march still took 1.4-1.5 ms: about
  45 µs a step for one warp, if each ran its 32 steps (inferred).
- **The tail rays are bouncing, not marching far.** In those iterations, 60-73% of the rays marched were shaded
  in the same iteration (iteration 10: 2,465 of 3,425).
  - A larger step budget per iteration would not shorten the tail; a path needs an iteration per bounce
    (inferred).
  - Keeping the GPU busy with new paths would. That is **#12, which this moves from "if the tail is large" to L
    for the heavy scenes.**

### 10.3 Compile

Seconds, uncached. "All at once" is how a scene change compiles; "one at a time" is the same 13 kernels in turn.
Inlined sizes are measured here by `shaderstats.mjs --bench` on the benchmark's own frozen scenes.

| scene | all at once | one at a time | shade alone | occlude | march | shade inlined | shade ms per 1000 chars |
|---|---|---|---|---|---|---|---|
| Noise library | 11.2 | 13.4 | 10.7 | 1.62 | 0.75 | 715K | 15.0 |
| Surface materials | 7.0 | 8.6 | 7.0 | 0.80 | 0.42 | 552K | 12.7 |
| showcase | 4.7 | 5.8 | 4.6 | 0.50 | 0.42 | 355K | 12.9 |
| demo | 3.6 | 4.4 | 3.4 | 0.36 | 0.35 | 314K | 10.7 |
| Menger cubes | 4.3 | 5.2 | 4.1 | 0.41 | 0.33 | 306K | 13.4 |
| materials | 2.6 | 3.3 | 2.5 | 0.22 | 0.19 | 250K | 10.2 |

- **Compile time is inlined size.** Over all 18 kernel and scene pairs (march, shade and occlude in six scenes),
  every one compiled at 8-15 ms per thousand inlined characters. Through zero, 13.4 ms per thousand; a free
  fit gives R² 0.98. That is arithmetic on measured times and measured sizes.
  - Static counts now predict compile time on this card. Before, they were a proxy (§9).
- **Shade is the build.** It is 76-82% of the kernels' time one at a time. All at once, the build is ready when
  shade is.
- **Parallel is already right.** All at once beat one at a time by 16-20%, and equals shade alone within 0.5 s.
  #3's sequential variant is refuted. What is left of #3, holding the studio, pick and panel compiles during a
  build, was not measured: the benchmark compiles with nothing else running.
- **Validating a module is cheap.** `moduleMs`, the march's text made into a module and checked without a
  pipeline, took 27-33 ms. A probe pipeline was recorded at 1.2-3.1 s. #2 is confirmed for the march's text; the
  probe's text is the same prelude and scene (inferred to behave alike).
- **The kernels that do not inline the scene compile in 12-126 ms each alone.** genrays takes 32-39 ms and
  genphotons, the largest, 112-126 ms. In a build they are ready at 177-402 ms only because they queue behind the
  rest. #5 has little compile time to save: S.
- **What #4 and #11 would buy follows from the fit** (inferred):
  - materials' shade, with four thin copies of a small scene, compiled in 2.5 s. That is about shade's
    scene-free floor (185K × 13.4 ≈ 2.5 s).
  - The Noise library's shade is then about 2.5 s of floor and 7-8 s of scene copies.
  - Halving the copies (#4) would take its shade from 10.7 to about 7 s.
  - Taking the floor and most copies out of an edit (#11) leaves a surface kernel of about two scene copies,
    roughly 2.5 s, with occlude's 1.6 s alongside: an edit at about 2.5 s instead of 11 s.

### 10.4 The iteration budget, and two things that cut a path short

**The budget does shrink.** The logged samples ran these iterations against a worst case of 24 everywhere
(`raytrace_main.js:1195`; no bundled scene sets `maxbounce` or `maxiter`):

| scene | iterations |
|---|---|
| materials | 8 |
| showcase | 12 |
| demo | 16 |
| Menger cubes | 18 |
| Noise library, Surface materials | 24 |

- The code's note, quoted in F5, says the shrink never fires. It is out of date, and the note now says so.
- How the controller got there is open. By its rule it shrinks only while `used + 3 < budget`
  (`raytrace_main.js:1265`), and the materials sample had rays in all 8 of its iterations.
- The rows now record `budget`, `budgetUsed` and `budgetFlushed` in the JSON.

**Camera paths cut by the budget.** The last pass hands every ray still marching to shade, which keeps the light
it carries (THE FLUSH, `wavefront.js:749`). A ray that hits something on that pass is shaded, but sends no NEE ray or
camera connection (`materials_pbr.js:672`, `:836`, `:402`), and the bounce it writes is never marched: the next
sample resets the queue. Rays still alive in the last iteration of the logged
sample, of 1.84 M marched at the start:

| scene | rays alive | share |
|---|---|---|
| Menger cubes | 12,967 | 0.7% |
| showcase | 12,382 | 0.7% |
| materials | 10,796 | 0.6% |
| demo | 3,351 | 0.2% |

- Read in code, this is a truncation: the light those paths would have gathered from then on is not added. It is the
  same kind of truncation as `maxbounce`.
- The controller allows it by design: up to 1% of rays (`flushTolerance`, `raytrace_main.js:102`).
- Recorded: `budget-image` read +0.03% on old code.

**Shadow rays cut by the last pass: a possible bright bias.**
- What the code does (read in code):
  - The last pass sends no new shadow rays (`materials_pbr.js:672`, `:836`). But the ones already queued get
    32 steps (`wavefront.js:1009`).
  - Whatever has neither hit a surface nor reached its light by then is deposited as unoccluded
    (`wavefront.js` prog_occlude).
  - So is a shadow ray that runs out of `maxiter`.
- What was measured: Menger cubes traced 240,253 shadow rays in its last iteration. The wavefront log cannot say
  how many of them were cut.
- New in this branch: a counter of exactly those, the `cut` column (`shadowcut`, `wavefront.js:1085`).
- **#25:** if the count is material, let the last pass march its shadow rays to `maxiter` instead of 32 steps.
  - The result becomes exact. The cost is the last iteration's occlusion time.
  - Quality comes first, so this goes ahead of any speed item if `cut` is large in a scene.


### 10.5 The second run (same card, same day, `0.9.2 · 0a21d88`)

**Measured by the user:** `BENCH.run(1, 25, 31, 33)` with the `record ms` and `cut` columns, 128 s.

**It reproduces.**

| | wall | gpu | compile, all at once |
|---|---|---|---|
| Noise library | 242.1 (243.1) | 184.8 (184.7) | 11.4 s (11.2) |
| Surface materials | 109.8 (110.0) | 52.5 (52.6) | 7.0 s (7.0) |

The first run's figures are in brackets. Menger cubes and materials differ, for the reason below.

**Every row ran the full budget this time: 24 iterations, `used` 24.**
- This is what the code's note and the `budget-cost` test's note say: the shrink never fires.
- The reason, read in code and measured: shade writes a bounce even on the last pass, so `used`
  (`prog_flip`) reaches the budget whenever one path does. The last iteration's `next` was 7, 9, 1,896 and 4
  rays in the four rows.
- What made the first run's samples run 8-18 iterations was not found. Those rows are not comparable with these.

**The iteration count, measured in the same scene.** Between the runs, materials went from 8 iterations to 24 and
Menger cubes from 18 to 24:

| | iterations | gpu ms | wall ms | per added iteration |
|---|---|---|---|---|
| materials | 8 → 24 | 33.0 → 35.1 | 53.7 → 85.6 | 0.13 ms GPU, 2.0 ms wall |
| Menger cubes | 18 → 24 | 135.6 → 138.1 | 177.1 → 193.6 | 0.42 ms GPU, 2.75 ms wall |

An iteration with almost no rays is nearly free on the GPU and costs about 2 ms off it. Shrinking the budget
would buy that by cutting paths short, and quality comes first, so the time should come from the overhead
instead.

**The JavaScript is a fifth of the time outside the GPU, and node predicts it.**

| row | wall − gpu | `record ms` | node's recording (`shaderstats --bench`) | the rest |
|---|---|---|---|---|
| Noise library | 57.3 | 11.9 | 11.7 | 45.4 |
| Surface materials | 57.3 | 12.3 | 13.4 | 45.0 |
| Menger cubes | 55.5 | 9.6 | 8.7 | 45.9 |
| materials | 50.5 | 6.1 | 6.1 | 44.4 |

- The JavaScript that records a sample is 6-12 ms, 12-21% of the time outside the GPU. The node tool's figure for
  it is within 10% in every scene, so it stands in for the browser's (measured, both).
- That bounds #1: it can save part of 6-12 ms a sample, not the 50.
- **The rest is 44-46 ms in every scene at 24 iterations, about 1.9 ms an iteration whatever the scene.** It is
  neither the kernels nor the JavaScript.
  - Inferred: the browser's own work per pass (Chrome's GPU process preparing each pass for the driver), or its
    scheduling.
- **Not every sample pays it.** In both runs, every row's fastest sample was only 5-16 ms above its GPU time, while
  the median was 50-57 ms above. In materials the fastest was 44.8 ms, 9.7 above the GPU's 35.1 and below what
  the JavaScript plus the rest would add up to.
  - Inferred: the cost varies from sample to sample, rather than being a fixed toll.
- Three instruments, added after this run, separate the explanations:
  - `msSamples` and `recordSamples` in the JSON: every timed sample's wall clock and recording. They show
    whether the cost is a toll some samples skip, or a spread.
  - The `pipelined` column: the row again with the next sample recorded while the GPU runs this one. If it reads
    near `gpu ms`, #24 is proven.
  - Rows 35 and 36: materials and row 1 with a submission per iteration (`R.submitEvery`). If the browser
    prepares a whole submission before the GPU may start, these read lower than the rows they repeat.

**Shadow rays cut short (`cut`).**

| row | cut |
|---|---|
| Noise library | 3 |
| Surface materials | 7 |
| materials | 1 |
| Menger cubes | 4,928 |

- In Menger cubes:
  - 983 ran out of `maxiter` over the sample. Shadow rays start at step 0 (`materials_pbr.js:470`, `:721`,
    `:767`, `:792`), so these needed more than 400 steps.
  - 3,945 were still marching on the last pass, 63% of the 6,253 it traced.
  - Against the 5.5 M shadow-ray traces of the sample, that is under 0.1%.
- **At the full budget, #25 matters only in Menger cubes, and little there.** It matters wherever the budget is
  short: the first run's Menger sample, at 18 iterations, traced 240k shadow rays in its last iteration.
- The last pass also writes bounces nothing marches: 1,896 in Menger cubes, besides the 593 rays flushed. That
  is the truncation §10.4 describes, counted.

### 10.6 The third run: one sample in flight, a submission per iteration, and the budget

**Measured by the user:** `BENCH.run(1, 33, 35, 36)`, same card, `0.9.2 · e1c7aad`, 95 s.

| row | iterations | wall | gpu | wall − gpu | pipelined | pipelined against wall |
|---|---|---|---|---|---|---|
| 1 Noise library | 24 | 257.6 | 216.6 | 41.0 | 225.0 | **−12.7%** |
| 33 materials | 8 | 57.5 | 41.1 | 16.4 | 42.9 | **−25.4%** |
| 35 materials, a submission per iteration | 8 | 49.7 | 44.0 | 5.7 | 44.7 | −10.1% |
| 36 Noise library, a submission per iteration | 24 | 263.4 | 255.5 | 7.9 | 233.2 | −11.5% |

**#24 works.** Recording the next sample while the GPU runs this one took the same row from 257.6 to 225.0 ms
(Noise library) and from 57.5 to 42.9 ms (materials).
- The stretches ran back to back in the same row, with one submission a sample in both.
- What was left above the GPU's time was 8.4 and 1.8 ms.
- The time outside the GPU is overlappable work, not a wait every sample must pay.
- **#24 is the cheapest large item measured so far:** 13-25% off every offscreen sample (saves, the timeline,
  the studio) for no change to any picture.

**#26 cuts the time outside the GPU, but this run cannot say by how much wall clock.** A submission per iteration
took `wall − gpu` from 41.0 to 7.9 ms (Noise library) and from 16.4 to 5.7 ms (materials). Materials' wall
clock fell 57.5 → 49.7 ms. The Noise library's did not: its GPU time rose 216.6 → 255.5 ms on the same kernels.
- More submissions may cost the GPU something.
- Or the card drifted (below).
- Only an interleaved A/B tells the two apart: `BENCH.run` now takes rows in any order, repeated (§8).

**The card's speed drifts more than any difference measured here.** The same kernels (fingerprint `6a5a9930`),
the same scene and settings, read a GPU time of:

| when | GPU time |
|---|---|
| run 1 | 184.7 ms |
| run 2 | 184.8 ms |
| run 3, row 1 | 216.6 ms |
| run 3, row 36 | 255.5 ms |

Materials at 8 iterations read 33.0 ms in run 1 and 41.1 ms here.
- Inferred: the card's clocks (heat, power state) or other work on it.
- A comparison across runs, or across commits run at different times, is good to about ±20%, and sometimes not
  that.
- Hence the interleaving. This also bears on "an earlier version felt faster": the same code reads up to 38%
  apart within an evening.

**The budget, again: materials at 8 iterations, and probably why.**
- The controller sat at 8 with `used` 8 and 0.17% of rays flushed: from there it can neither shrink nor grow.
- Read in code (`raytrace_main.js:1280`): the shrink tests `used + 3 < (R.budget || worstCase)` but subtracts
  from `R.budget` itself.
  - In the start state, `R.budget` 0, which the benchmark sets at every row and the page has at load, it lands
    on the floor of 4, not on 23.
  - Growth then adds 2 a sample while more than `flushTolerance` (1%) of the rays are cut short, so the budget
    settles on the first even number that cuts fewer.
  - That is the 8, 12, 16 and 18 of the first run and the 8 here.
- What makes `used` small enough at a row's start is not established. The second run's rows never dropped, and
  this run's row 36 started straight after a row at 8 without dropping.
- The JSON now has the budget for every warm-up and timed sample, and the readings each row started from.

**What it costs and buys:**
- Materials at 8 iterations against 24 was 53.7 against 85.6 ms a sample (runs 1 and 2), for nearly the same GPU
  time.
- At 8, per sample (this run):
  - 3,242 paths were flushed, and 2,651 bounces written on the last pass were never marched: 0.32% of the paths
    started, cut short.
  - 1,282 shadow rays were counted lit for lack of steps (`cut`).
- At 24 in run 2, the same counts were 11, 4 and 1.
- So the budget trades a measurable, small truncation for a 1.6× faster light scene. It does so by accident, and
  which way it goes depends on the history.

**#27: make the budget a decision, not an accident.** Read in code and measured above; ease 1 to fix, but the
fix chooses between two behaviours:
- **Exact:** shrink from the worst case, not to the floor. Light scenes then run all 24 iterations, as run 2 did.
  This costs nothing on the GPU (0.13 ms an iteration). Off the GPU it costs 2 ms an iteration until #24 and #26
  hide that time.
- **Deliberate:** keep a shorter budget on purpose, sized from a stated tolerance of paths cut. Fix #25 first, so
  a cut shadow ray is not counted lit.
- Quality first suggests exact, after #24 and #26. Inferred: they remove most of what the extra iterations cost.

**Decided (the user, 2026-10-03): exact, and in 0.10.0.** The budget is always the worst case unless
`budgetOverride` pins it; the shrink and the growth are gone, and so is the controller (`raytrace_main.js` THE
ITERATION BUDGET IS THE WORST CASE). The counters are still read every frame, for the HUD and these columns.
**#25 with it:** the last pass runs occlusion again on the shadow rays left, in rounds of the usual 32 steps
(`raytrace_main.js` THE LAST PASS'S SHADOW ROUNDS: 13 rounds at `maxiter` 400), so a shadow ray is no longer
counted lit for running out of steps there; `cut` then counts only rays out of `maxiter`. Not one dispatch of
`maxiter` steps, as the plan had it: a draft that did that was running when the user's page lost its GPU on a heavy
scene (2026-10-03, not established as the cause), and a round of 32 steps is the bound every pass already had.
The submission split now divides a frame by at most 24 iterations, so the exact budget's 38 at High quality does
not put more of the heavy first iterations in one submission. Neither cost is measured yet: what the extra
iterations and the rounds' dispatches cost is for the next interleaved run.

### 10.7 0.9.5: the first two compile changes, before they are measured

**#2.** The builder's probe is a shader module, no pipeline (`builder/validate.js`, tinywebgpu's `moduleOnly`). Its
messages always came from the module; the pipeline added the driver's compile, recorded at 1.2-3.1 s an edit. The
module took 27-33 ms for a march kernel's text on the Pascal card. What only the driver refuses is still reported,
by `setScene`.

**#4.** Shading a hit asks the scene three things: the normal, the material and the medium beyond the surface. The
emitter probe and the path each asked all three in its own function. Now the shade kernel asks each once, between
phases of both (`Shading`, `tracebasics.js`), with the same arguments under the same conditions. Measured here,
`shaderstats.mjs --bench`; the seconds are each scene's own measured rate per size (§10.3) applied to the new size,
so a forecast:

| scene | SDF copies | getMaterial2 copies | shade inlined | shade compile, forecast |
|---|---|---|---|---|
| Noise library | 8 → 4 | 4 → 2 | 715K → 451K (−37%) | 10.7 → 6.7 s |
| Surface materials | 8 → 4 | 4 → 2 | 552K → 369K (−33%) | 7.0 → 4.7 s |
| showcase | 4 → 2 | 4 → 2 | 355K → 271K (−24%) | 4.6 → 3.5 s |
| demo | 4 → 2 | 4 → 2 | 314K → 251K (−20%) | 3.4 → 2.7 s |
| Menger cubes | 4 → 2 | 4 → 2 | 306K → 246K (−20%) | 4.1 → 3.3 s |
| materials | 4 → 2 | 4 → 2 | 250K → 218K (−13%) | 2.5 → 2.2 s |

March, occlude and the probe are unchanged. What is left of shade in a light scene is mostly its scene-free floor,
which only #11 removes from an edit. Not known: whether keeping a material, a hit and two rays live across the
three questions changes shade's run time; the `shade` column will say.

### 10.8 0.10.0 measured (the user's GTX 1080 Ti, 2026-10-03)

**How.** On the user's own machine (Windows 10, GTX 1080 Ti, driver 560.94, Chrome 154), headless Chrome driven by
playwright with `--enable-unsafe-webgpu` gets the real card (adapter `nvidia / pascal`, timestamps on), so these
are the page's own instruments run there, not a new harness: `BENCH.run(1, 25, 27, 29, 31, 33)` for the six
scenes, the image tests by id, and the builder's own `scene applied` console line for edits. The baseline is
`6b54026` (this review's last commit before 0.10.0), served from a git worktree beside the final `a571207`, and
the benchmark ran **interleaved**: baseline, final, baseline, final. A change smaller than the baseline's spread
between its own two runs is not read as a change.

**Compile (uncached, the benchmark's `compileSeqEach.shade`; mean of two runs each):**

| scene | shade, before | shade, after | change | baseline's own spread |
|---|---|---|---|---|
| Noise library | 11.4 s | 5.9 s | −48% | 16% |
| Surface materials | 7.5 s | 4.0 s | −47% | 21% |
| showcase | 5.0 s | 2.6 s | −48% | 17% |
| Menger cubes | 4.3 s | 2.4 s | −44% | 9% |
| demo | 3.5 s | 2.2 s | −38% | 9% |
| materials | 2.6 s | 1.6 s | −39% | 10% |

The forecast in §10.7 (from 0.9.5 alone) was −37% for the Noise library; the measured −48% includes the lobes'
deduplication after it (4b-4d). Shade's GPU time did not move beyond the spread in any scene: the change is
compile time, not run time.

**A structural edit in the builder, with the picture rendering** (one run each; the totals the builder logs):

| edit | before | after |
|---|---|---|
| Noise library: hide a node (fresh text) | 18.0 s | 4.9 s |
| Noise library: hide another (fresh) | 14.3 s | 5.9 s |
| Noise library: show it again, hide it again (texts seen before) | 4.2 s, 3.0 s | 2.0 s, 0.56 s |
| demo: two fresh edits | 4.7 s, 4.4 s | 1.75 s, 1.6 s |
| demo: two revisits | 0.52 s, 0.53 s | 0.18 s, 0.13 s |

Before, a fresh Noise library edit spent 4.6 s neither probing nor compiling: waiting for live frames already
queued (measured: the same revisit took 1.4-6.8 s with the loop running and 0.2 s paused). The apply now holds the
loop from its start.

**Rendering, a sample awaited (ms a sample, mean of two runs):**
- JavaScript recording a sample (`record ms`): −44 to −74% in every scene (Noise library 11.4 → 2.9, Surface
  materials 11.4 → 3.0). That is what moved Surface materials' wall clock 85 → 75.5 (−11%, spread 8%).
- GPU time: within the baseline's spread in every scene. The GPU-side items (#7, #8) are not in 0.10.0.
- showcase +13% and demo +8%: the baseline ran them at 10 and 14 iterations, the accident of §10.6; they now run
  the worst case, 24 (#27, decided: exact). That is the cost of no longer cutting their paths short.
- One sample in flight offscreen (#24), a 32-sample render at 1280 × 720 interleaved on one page: materials 57.2 →
  38.6 ms a sample (−32.5%), the Noise library 640 → 634 (−0.9%, GPU-bound). Saves, timeline frames and the
  studio's pictures take this path.

**Pictures.** The fifteen image tests against the baseline: the largest difference is −4.0% (small-caustic, whose
baseline differs from itself by up to 6.2%); every row is within its own baseline spread.

**A lost GPU, on the way.** The first version of #25 marched the last pass's shadow rays up to `maxiter + 1` = 401
steps in one dispatch. The user's page lost its device while it was in the working tree
(`DXGI_ERROR_DEVICE_HUNG`, OpticsBench2, everything on), and so did one headless run of it (observed twice; the
cause is inferred). It became rounds of the usual 32 steps (raytrace_main.js, THE LAST PASS'S SHADOW ROUNDS).
Separately, one optics trace in four lost the device in OpticsBench-class scenes on a branch without #25: **open**,
cause unknown.

**Left for next, by measured size:**
- The optics module's own kernels: an optics scene's first trace took 74 s (OpticsBench) and 101-109 s
  (OpticsBench2) in a browser with no cache (measured, one run each). Not examined by this review (§9).
- #7 and #8: march and occlusion are 70-86% of the GPU time in every scene here, unchanged by 0.10.0.
- A1 (one compute pass an iteration) and A3 (the hit's store out of the march loop), planned and not built.

---

## Appendix: what recording one sample asks of the CPU

Measured here: `node bench/shaderstats.mjs` at 1280 × 720, at the defaults, on node 22 in the
container, on the code merged with main on 2026-10-02.

| scene | uniform fields | iterations | passes | dispatches | uniform copies | copied KB | JS ms |
|---|---|---|---|---|---|---|---|
| menger | 122 | 24 | 174 | 173 | 82 | 74 | 4.8 |
| materials | 143 | 24 | 174 | 173 | 82 | 95 | 5.5 |
| optics-test | 141 | 24 | 174 | 173 | 82 | 94 | 5.8 |
| RGBW_mixer | 165 | 24 | 174 | 173 | 82 | 136 | 7.2 |
| demo | 183 | 24 | 174 | 173 | 82 | 162 | 9.1 |
| showcase | 247 | 24 | 174 | 173 | 82 | 199 | 9.8 |
| surfaces | 289 | 24 | 173 | 172 | 81 | 221 | 13.2 |
| demoscene | 334 | 24 | 174 | 173 | 82 | 236 | 13.3 |
| noise | 296 | 24 | 173 | 172 | 81 | 256 | 14.6 |
| **OpticsBench** | 457 | 24 | 173 | 172 | 81 | 638 | **29.9** |

A V8 CPU profile of this loop (on the code of 2026-10-01):
- 40.6% `uniformWrite` and 33.6% its setter (`tinywebgpu.js:1204`, `:1485`);
- 4.6% garbage collection;
- 4.2% `computeUniformTypes`;
- 2.8% R.trace itself.

At 128 × 128 the times were the same to within run-to-run noise (5.7-14.7 ms, code of 2026-10-01).

A second V8 CPU profile, the one #1 step 1 was planned on: 200 samples of the noise scene at 1280 × 720 over a
recording device (shaderstats' method, in a scratch harness), node v22.17.0 on the user's Windows machine, run by
the agent session that planned the change, on the code of 2026-10-03 just before it:
- 52.2% `uniformWrite` and 40.9% its setter (`tinywebgpu.js:1204`, `:1485`), 93% between them;
- 3.0% garbage collection;
- 2.2% R.trace itself;
- 0.6% `stageCopy`.

It gives the packing a larger share than the profile above (93% against 74%). Why is not known. The profile above
does not name its scene, and noise is one of the scenes with the most uniform fields (296); that, and two days of
code between them, are the differences known (inferred, not tested). Both put the packing first by far.

**After #1 step 1 and #5 (0.10.0, 2026-10-03).** Measured with the same command on node 22.17 on the user's Windows
machine, each number the median of 20 samples. The before row is the same command on the same machine just before
the change, and the after row just after it, each run twice (before 4.1-24.7 and 5.1-24.8 ms, after 0.5-2.4 and
0.5-1.8 ms):

| scene | JS ms before | JS ms after | copied KB after |
|---|---|---|---|
| menger | 4.1 / 5.1 | 1.0 / 0.8 | 73 |
| materials | 5.1 / 5.2 | 0.5 / 0.5 | 93 |
| optics-test | 5.3 / 5.1 | 1.2 / 0.7 | 92 |
| RGBW_mixer | 6.4 / 7.5 | 0.8 / 1.5 | 132 |
| demo | 7.4 / 7.9 | 1.2 / 1.2 | 157 |
| showcase | 9.3 / 9.3 | 0.8 / 0.7 | 193 |
| surfaces | 11.0 / 11.4 | 0.9 / 0.9 | 216 |
| demoscene | 11.5 / 18.1 | 1.3 / 1.2 | 228 |
| noise | 12.1 / 12.1 | 1.1 / 1.1 | 250 |
| **OpticsBench** | 24.7 / 24.8 | **2.4 / 1.8** | 622 |

Passes, dispatches and uniform copies are unchanged (174, 173, 82; 173, 172, 81). The bytes copied fall a little
because the four kernels that no longer declare the scene's uniforms (#5) have smaller structs. This is node's
JavaScript on a recording device. What it saves in Chrome is the `record ms` column, measured on the card.
