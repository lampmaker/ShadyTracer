# Architecture: where the scene should go

Written 2026-10-04 on the user's question: if the approach were started again, would it converge better on a
fast renderer? Each claim says how it is known: **measured** (on the user's Pascal card, the scenedata run of
0.20.3 · f560ff1), **read in code**, or **inferred**.

## The problem in one sentence

The scene is one distance function, compiled into every kernel that needs geometry and evaluated at every step of
every ray. Culling boxes, the candidate grid, exact hits, the records evaluator and compiled subtrees are all
patches on that one choice. (The candidate grid and exact hits went in 0.41.0: *Removed in 0.41.0*, at the end.)

What it costs (measured, march GPU ms a sample):

| scene | codegen | as data | + grid | + exact hits |
|---|---|---|---|---|
| Surface materials | 21.8 | 83.5 | 31.1 | 10.1 |
| showcase | 30.0 | 96.3 | 68.2 | 26.7 |
| demo | 25.0 | 219.5 | 305.8 | 443.6 |
| Menger cubes | 88.2 | 833.8 | 2834.2 | 3611.1 |
| optics bench | 138.8 | 136.9 | 281.0 | not run |

- Where a ray can be answered in closed form, it beats codegen marching (Surface materials 10.1 against 21.8).
- The data path costs 1.4-9.5x in the march. The grid is slower than no grid on four scenes of seven.
- Shade is the slowest compile in every row (the optics bench: shade 32.3 s, occlude 11.2 s, march 4.1 s).
- A compile grows faster than its text: time is about size^1.37 (`core/compileprogress.js`, fitted on 16 of
  the user's builds).

## Four decisions, from scratch

1. **The scene is data.** Each object is a row in a buffer: shape kind, transform, parameters, material. Code
   exists once per kind of shape or material, never per object or per copy.
2. **Rays find objects, objects answer rays.** A bounding-volume hierarchy (BVH) says which objects a ray passes,
   in order. Each object says where the ray hits it: in closed form for most optical parts (`builder/analytic.js`
   had 16 shapes and the outlines, until 0.41.0), by marching inside its own box for the rest (noise, smooth blends, twists).
3. **Shading never touches geometry.** The hit carries its normal, material and local point. Shade compiles once,
   and a geometry edit never recompiles it.
4. **Copies are instances.** Arrays, repeats and mirrors are transforms on one prototype.

What stays: the document model and the builder, the wavefront engine, photometry and the optics tallies,
tinywebgpu, the analytic shapes, the box measurement, the benchmark loop.
What goes, once replaced: codegen as the scene's interface, the records evaluator, the grid, the exact-hit flags,
compiled subtrees. **Overtaken by the measurements (0.41.0):** codegen baked renders fastest on five of eight bench scenes
and is no slower to compile (*A bake mode, tested*; the builds runs), so codegen stays as the render build; the grid and
exact hits went instead (*Removed in 0.41.0*). Step 5 below, as written, is no longer the plan.
What does not improve (inferred): a scene that is all distance field (Noise, Menger) runs at codegen speed at
best, which codegen already gives.

## The order, each step checked on the user's card

| step | what | why first | the check |
|---|---|---|---|
| 1 | One copy of the scene per kernel (**done, 0.20.6**) | compile time, which is testing time | `compile ms` per row; the picture unchanged |
| 2 | Shade without the scene (a small surface kernel before it) (**done, 0.20.8**) | shade compiles once | shade's compile gone from a scene change |
| 3 | BVH over the objects, closed-form answers, marching only inside a box (**0.21.0-0.21.6: not met by the list; since step 4 (0.22.6) met on the optics bench as data, not on OpticsBench2; many objects: 3.5 ms each as data, flat with the grid (0.22.10); next form open**) | render time and accuracy | optics bench `march` at or below codegen's |
| 4 | Instances for copies (**done, 0.22.0; met on the card in 0.22.6: x 32 compiles in 1.8 s, the optics bench's own text**) | many objects without many compiles | the lens assembly x 32 compiles like x 1 |
| 5 | Delete the old paths | less to keep right | the bench rows match |

## Step 1: one copy of the scene per kernel

Read in code (`bench/test/copies.test.mjs` pins the counts): shade calls the scene's SDF at two places (the normal,
the medium beyond the surface) and `getMaterial2` at two (the hit's material, the medium's), and where a material
reads its object's own point (`p_local`) each `getMaterial2` holds one more SDF for it. Occlusion holds the SDF
twice the same way. Every call is a whole copy once the compiler inlines it.

Measured in node from the kernels' text (sizes, not times): on the optics bench about 876 000 of shade's 979 000
inlined characters are the scene; the physics is 104 000.

Step 1 asks every question in one loop with one SDF call and one `getMaterial2` call in it, and gives the material
the local point the loop captured instead of letting it evaluate the scene again. Predicted (inferred, from the
compile model): the optics bench's shade from about 30 s to about 8 s, occlusion from about 10 s to about 5 s.
The picture must not change: the same questions are asked with the same arguments, in the same order.

**Done in 0.20.6.** Measured in node (sizes): the optics bench's shade 979 000 to 339 000 inlined characters,
occlusion 441 000 to 234 000. Reported by the user on their card (2026-10-04, no numbers pasted): compiling is much
faster, and the tests look good.

## Step 2: shade without the scene

What is left of the scene in shade after step 1, measured in node (sizes, the optics bench): the SDF 207 000 of
339 000 inlined characters, `getMaterial2` 19 000, the lights' functions (`lightFace*`, `lightBeam`, `clearSheet`)
5 000. The rest is the physics: 107 000 here, and between 107 000 and 110 000 in each of the five bench scenes measured.

Step 2 moves the one SDF call and the one `getMaterial2` call into a small surface kernel between the march and
shade. It writes a surface record per hit (normal, material, the local point, the medium's index beyond), and shade
reads that record. The lights become rows in a buffer, so shade holds no scene code at all and compiles once.

Predicted (inferred, from the compile model): a scene change compiles the surface kernel, about 4 s on the optics
bench, instead of shade's 7 s; shade's own 1.4 s once. The larger reason is step 3: the surface record is what a
closed-form answer from an object would write directly, without the SDF.

**Done in 0.20.8.** The record rides beside the hit in the shade queue (`scene_api.js` Surface, ShadeItem), and the
lights' faces in a table in the learn buffer, so shade keeps 8 storage bindings. Measured in node (sizes, the optics
bench, inlined with the defines as the build sizes them): shade 113 000, the surface kernel 252 000. Checked on a
software GPU in node (lavapipe), not on the user's card: the old shade and the new pair gave the same output, bit for
bit, on seven scenes (CHANGELOG 0.20.8 says how).

**Measured on the user's Pascal card** (the scenedata run of 0.20.8 · 1518d0f, 1280 x 720, 19 rows before the GPU was
lost on the 20th): the user reports compiling faster and the picture unchanged, except exact hits (known; not step 2's).
- The bench compiles every kernel uncached, shade included. Shade was ready at 1.6-2.4 s in every row. The scene's own
  kernels (march, surface, occlusion), which are all a scene change compiles now, were all ready by 0.7-1.8 s in the
  codegen rows and 0.5-3.4 s in every row.
- GPU time a sample: shade 13-21 ms in every row, whatever the scene; surface 3-5 ms in the codegen rows but the Noise
  library's 23 ms (its patterned materials). The codegen march is unchanged: 21.6, 30.2, 25.0 and 89.0 ms against
  0.20.3's 21.8, 30.0, 25.0 and 88.2.
- The GPU was lost (DXGI_ERROR_DEVICE_HUNG) on the Menger cubes as data with the grid and exact hits, so the optics
  bench rows did not run. Not established whether 0.20.8 has anything to do with it: that row ran in 0.20.3's run.

## Step 3: the ray's objects

**First increment, built in 0.21.0** (the scene as data with exact hits, a developer's switch). Read in code
(`builder/scenedata.js` withSolids, scnRayList, scnRayWalk):
- Every set of records carries a table of the solids (the root's union members) with their boxes in the world, made where
  the records are made, so it is never stale.
- A march lists the solids whose boxes its ray crosses, once per dispatch. At each step it walks only the solids whose
  box the ray is in. The space between boxes is one step. Exact answers decide the steps inside a box, as before.
- This is sound because the union of solids is a plain one: every solid's surface counts and the nearest wins
  (`scene_api.js` fold), so a solid whose box the ray never enters is never its next surface.
- The list is a flat scan of the table, not yet a BVH, with room for 8 solids. A ninth or later is reached by listing
  again where the eighth begins.
- Only the march and occlusion use it. A normal, a material's point and the medium still ask the grid or the whole walk.

Counted on a CPU's WebGPU (`builder/test/exact.gpu.mjs`), records walked and steps per ray, before -> after:

| scene | culled walk | grid | grid + exact (as counted for 0.18.0, PERFORMANCE.md) | the ray's objects + exact |
|---|---|---|---|---|
| optics bench | 347 (24.2) | 42 (11.7) | 54 (6.1) | 60 (5.5) |
| OpticsBench2 | 166 (22.1) | 78 (14.5) | 81 (10.2) | 11 (10.2) |
| showcase | 254 (18.5) | 11 (15.9) | 8 (2.4) | 2 (2.4) |
| material test | 97 (23.3) | 16 (15.6) | 13 (5.7) | 5 (5.7) |
| demo | 276 (33.0) | 42 (32.4) | 128 (30.7) | 37 (30.7) |

Every exact hit there is one the plain march makes too, in every scene the test runs. That does not mean the pictures
are right: exact hits already passed this check while they looked wrong on the user's screen.

**Measured on the user's Pascal card** (the scenedata run of 0.21.0 · 2dae314, 1280 x 720, every row run but the lens
assembly's grid and exact rows, which the bench skipped for their predicted compiles), march GPU ms a sample. The last
column is the same row before the list, from the 0.20.8 run:

| scene | codegen | as data | + grid | + exact hits, the ray's objects | + exact hits, 0.20.8 (the grid) |
|---|---|---|---|---|---|
| optics bench | 161.4 (138.1 in the drift row) | 145.2 | 307.3 | 198.4 | not run |
| OpticsBench2 | 54.0 | 65.1 | 215.5 | 68.3 | not run |
| Noise library | 109.1 | 162.5 | 397.8 | 147.9 | 396.8 |
| Surface materials | 22.0 | 85.6 | 32.0 | 11.9 | 13.1 |
| showcase | 30.9 | 99.1 | 67.2 | 22.7 | 27.3 |
| demo | 25.8 | 235.7 | 321.2 | 648.2 | 430.0 |
| Menger cubes | 90.7 | 842.7 | 2739.4 | 3667.4 | GPU lost |
| material test | 14.0 | 58.3 | 44.8 | 17.4 | not run |

- **The check is not met.** The optics bench's march is 198.4 ms against codegen's 161.4 (138.1 in the drift row at the
  run's end); OpticsBench2 68.3 against 54.0.
- **Where the time goes on the optics bench** (withdrawn in 0.21.7: a pass's rays differ by row, see the correction
  below), from the bench's per-pass column. On the first pass (camera rays) the list
  is at codegen's time: 22.2 ms against 23.3 (as data, 24.2). On the second pass (rays leaving their first surface) it
  takes 83.0 ms for 386 000 rays against codegen's 56.9 ms for 562 000: 215 ns a ray against 101. That pass alone is
  26 of the 46 ms between them.
- **Fewer records walked did not make the march faster** on the optics bench: the whole walk culled 145.2 ms, the grid
  307.3, the list 198.4, with 347, 42 and 60 records a ray counted. The counts are camera rays on lavapipe, the times all
  passes on the card, so this is a strong hint, not a proof.
- **The demo got worse**, on camera rays too: its first pass 166.2 ms against 111.7 in 0.20.8, though its records counted
  fell from 128 to 37 a ray (30.7 steps both ways).
- **Faster where shapes answer in closed form:** the Noise library 396.8 -> 147.9, the showcase 27.3 -> 22.7, Surface
  materials 13.1 -> 11.9. The Menger cubes' exact row ran this time; in 0.20.8 it lost the GPU.
- **Compiles** (the `compile ms` column, the last kernel ready). With exact hits, the optics bench took 27.1 s (occlusion
  last; surface 17.3, march 23.4) and OpticsBench2 33.7 s. As data they took 4.7 and 6.1 s, codegen 6.2 and 9.2 s
  (surface last in all four). The list made exact compiles longer wherever both runs have the row: the march ready at
  2.3 -> 3.5 s on the demo, 3.2 -> 5.5 on the Noise library, 1.6 -> 2.5 on the showcase, 1.0 -> 1.6 on Surface materials.

**Inferred, not measured.** The list's own work at each step costs more than the records it saves, at least on rays that
are not coherent. One candidate: each thread holds the list (8 entries, read with an index that varies), and a GPU
compiler usually puts such an array in memory, not registers, so every step reads it from memory. The test: the same
rows with the list cut to 2 entries. If the second pass's time a ray falls toward codegen's, the list's storage is the
cost. Until this is known, the BVH waits: it would cut the records further, and on the optics bench the records are not
what costs.

**The test, built in 0.21.2.** The scenedata bench runs the optics bench and the demo a fifth time, right after their exact
row, with the list holding 2 solids (`bench/scenedata.js` LIST_CUT; the page has no setting for it). Building it found a
bug in 0.21.0's list: when more boxes held a point than the list had room for, it kept the nearest and walked only those,
leaving out a solid the ray was already inside. At 8 the test's rays on the optics bench count the same before the fix
and after it, so none of them met it; at 2, `builder/test/exact.gpu.mjs` found 122 of its 7 232 rays on another surface. Where the list cannot hold every box at a point, the whole walk
now answers that step, as it did before the list. Counted on lavapipe (camera rays and rays from inside the scene, per
ray), holding 8 -> 2 after the fix: the optics bench lists made 1.44 -> 1.86, records 60 -> 64, steps 5.5 both ways.
So the cut row mostly changes the list's size, not the work around it.

**Measured, on an NVIDIA Ampere card** (the user's scenedata run of 0.21.2 · c26de1b, 1280 x 720; not the Pascal of the
runs above). Its compiles took about twice the Pascal's (the optics bench codegen 14.6 s against 6.2), so the optics
benches' exact rows, the cut row among them, were predicted at 63 and 77 s and not run (the bench's 60 s limit). The
step-3 question on the optics bench is still open. The demo's pair ran, march GPU ms a sample:

| the demo, as data | + grid | + exact hits, list of 8 | + exact hits, list of 2 | codegen |
|---|---|---|---|---|
| 142.7 | 128.7 | 406.9 | 352.9 | 31.3 |

- Cut to 2 the march is 13% lower (occlusion 153.6 -> 128.0, 17% lower), and lower in each of the first three passes.
  The run's drift row, the optics bench codegen again, came in 17% under its first row (149.0 -> 123.6 ms), so a
  difference that size is not established by one run.
- Either way the exact rows take 2.7 to 3.2 times the grid row on the demo, whose shapes are code and take 30.7 steps a
  ray with exact hits or without (counted above). On the demo, holding the list is at most a small part of what exact
  hits cost. What the rest is, is not known.

**Measured on the Pascal** (the user's scenedata run of 0.21.4 · b9890b4, every optics-bench row run), march GPU ms a
sample, then by pass (the first is the camera's rays, the second the rays leaving their first surface):

| row | march | pass 1 | pass 2 |
|---|---|---|---|
| the optics bench, codegen (drift row) | 138.1 (127.7) | 22.0 (21.8) | 50.1 (36.2) |
| ...as data | 134.8 | 22.2 | 35.0 |
| ...as data with the grid | 275.4 | 37.9 | 115.3 |
| ...exact hits, list of 8 | 181.8 | 23.5 | 73.8 |
| ...exact hits, list of 2 | 236.8 | 27.5 | 98.8 |
| OpticsBench2: codegen, as data, exact hits | 49.9, 62.0, 57.8 | | |
| the demo: grid, exact hits list of 8, list of 2 | 313.2, 639.8, 567.3 | | |

- **Step 3's check is still not met:** 181.8 ms against codegen's 138.1 (127.7 in the drift row), 32-42% over. The
  scene as data without the grid or exact hits is at codegen's time (134.8).
- **The list cut to 2 made the optics bench slower** (236.8 against 181.8, more than this run's 8% drift), and the demo
  11% faster (567.3 against 639.8; 13% on the Ampere). So a smaller list is no general gain, and its size is not where
  the time goes. Inferred, not measured: at 2 the list is made again more often and hands more points to the whole walk.
- **Fewer steps, dearer steps.** Counted on lavapipe, once, with `builder/test/exact.gpu.mjs`'s march (not a test kept in
  the repo: 192 x 108 camera rays, then a cosine-weighted bounce off each exact hit with a normal), steps a ray, plain ->
  exact: the optics bench's camera rays 29.8 -> 6.9 and its bounced rays 24.9 -> 10.4; OpticsBench2 24.3 -> 11.0 and
  21.2 -> 12.2; the demo 34.0 -> 32.3 and 29.0 -> 27.7. On the card, against the plain data row, the camera's pass costs
  the same with exact hits and the second pass about twice as much (withdrawn in 0.21.7: a pass's rays differ by row,
  see the correction below; the whole march, 181.8 against 134.8, still says the same). Taken together (counts on lavapipe, times on the card, so an estimate, not a
  measurement): an exact step costs several times a plain data step.

**Inferred, not measured: what makes an exact step dear.** At every step, every solid the ray is in the box of runs its
answer along the ray as well as its distance, with the bookkeeping that folds them. The kernels that do it take about
5 times as long to compile as the plain data ones (the optics bench: 23.4 s against 4.5), so they are much bigger, and a bigger
kernel usually runs fewer rays at once. The test: the ray's list without exact hits (each step the plain distances of
the solids whose box the ray is in, the space between boxes still one step). If that row is at or under codegen's, the
list is a gain on its own, and the answers asked at every step are the cost.

**The test, built in 0.21.6:** the scenedata bench's fifth row for the optics benches and the demo, "as data with the
ray's list" (`bench/scenedata.js` LIST_ROWS; the list-size rows are gone). Counted on lavapipe (`builder/test/exact.gpu.mjs`,
records walked a ray and steps a ray): the optics bench 92 (9.6) against the plain walk's 347 (24.2) and exact hits' 60
(5.5); OpticsBench2 13 (12.2) against 166 (22.1) and 11 (10.2); the demo 39 (30.9) against 274 (32.7) and 37 (30.3). Its hits
are the plain march's. What happens next depends on that row:
- **At or under codegen's march on the optics bench:** keep the list, and make exact hits ask an object with a closed-form
  answer once a ray, not at every step.
- **Over it:** stop this way of doing step 3 and decide its next form with the user before any more code.

**Measured on the Pascal** (the user's scenedata run of 0.21.6 · d77a20c), march GPU ms a sample. The exact row holds the
list too (it always has, since 0.21.0):

| scene | codegen | as data | + the ray's list | + grid | + grid, exact hits and the list |
|---|---|---|---|---|---|
| optics bench | 145.2 (139.1 in the drift row) | 135.5 | 144.9 | 275.8 | 182.6 |
| OpticsBench2 | 50.6 | 61.4 | 59.8 | 196.0 | 58.2 |
| demo | 25.0 | 229.7 | 700.5 | 305.9 | 670.7 |

Compiles (the last kernel ready): the optics bench 7.2 s codegen, 4.9 as data, 9.8 with the list, 23.1 with exact hits;
OpticsBench2 8.8, 5.3, 13.2, 29.2.

- **On the optics bench the list ties.** 144.9 ms against codegen's 145.2, and 139.1 in the drift row: the rule's line
  falls inside this run's own 4% drift. The plain data row, with no list, is under both (135.5).
- **On the demo the list triples the march:** 700.5 ms against 229.7 as data, though it walks 39 records a ray against
  274, in about the same steps (30.9 against 32.7; counted on lavapipe, 0.21.6 above). Exact hits there cost what the list
  costs (670.7), so on the demo the answers are not what is dear.
- **On the optics bench exact hits add 38 ms to the list** (182.6 against 144.9). There the answers are the extra.
- **Inferred, not measured:** a step with the list costs much more than a step of the plain walk on this card, enough to
  eat 2.5 times fewer steps on the optics bench and 7 times fewer records on the demo. Not tested further.

So the list is no general gain: level on the scene it was meant for, three times slower on another. The next form of
step 3 is the user's decision, before any more code.

**The test's option removed (0.22.5),** with the user's agreement: `rayList` (the list without exact hits) and the
scenedata bench's list rows are gone. The list with exact hits stays, and so does `listMax`: `builder/test/exact.gpu.mjs`
still marches with the list cut to 2, the only thing that runs the list's overflow path (0.21.2's fix).

**A correction to the per-pass figures above** (read in code, `lib/pathtracer/core/wavefront.js` 735, 748, 770-798): a
march pass takes at most 32 steps a ray, and a ray not done by then goes on to the next pass. The log's `shaded` counts
the rays a pass finished (a hit, out of the scene, or out of steps). On the optics bench's first pass, of 921 600 camera
rays the plain data row finishes 596 000, codegen 830 000, the list, grid and exact rows 913 000-920 000. So a later pass
holds camera rays still marching and bounced rays, in different shares in each row, and a time a ray by pass compares
different rays. The by-pass comparisons in the 0.21.0 and 0.21.4 notes (215 ns a ray against 101; the second pass about
twice the plain data row's) are withdrawn. The sample's whole march is the comparison, as in the tables.

**Where the check stands after step 4** (the user's scenedata run of 0.22.6 · b41a409 on the Pascal; what changed is
under step 4). Each scene's fastest data row against codegen's march, GPU ms a sample:

| scene | codegen | fastest as data | which row (the others) |
|---|---|---|---|
| optics bench | 138.0 (130.1 in the drift row) | 111.9 | the grid (as data 114.7, exact hits 175.8) |
| OpticsBench2 | 50.8 | 57.0 | as data (the grid 128.7, exact hits 82.8) |
| Noise library | 104.9 | 108.2 | exact hits |
| Surface materials | 21.4 | 11.9 | exact hits |
| showcase | 30.5 | 21.9 | exact hits |
| material test | 13.5 | 17.1 | exact hits |
| demo | 25.7 | 228.8 | as data |
| Menger cubes | 88.9 | 834.2 | as data |

- **On the optics bench the written check is met**, by the scene as data with the grid or without it, not by exact hits.
  On OpticsBench2 it is not: 12% over.
- **No one data row is the fastest everywhere,** and on the demo and the Menger cubes every data row is about 9 times
  codegen's. Why is not known. That gap, more than the optics benches, is what stands between this and step 5.
- **Inferred, not tested:** the optics benches moved because of step 4, their lens assemblies' groups now records instead
  of compiled code. The scenes whose compiles fell between 0.21.6 and 0.22.6 (the optics benches, the Noise library) are
  the ones whose march fell; every other scene's march moved by 8 ms or less either way (the Menger cubes' by under 1%).

**Not built yet:** the BVH (the flat scan is a test per solid per ray per dispatch, fine for tens of solids; step 4's
lens assembly x 32 is the case that needs it); answers for a CSG group's own boundary (interval CSG); the optics trace's
copy (its limiters are not in the table); and exact hits that look right.


## Step 4: copies compile once

Chosen by the user on 2026-10-05, after step 3's list. The check: the lens assembly x 32 compiles like x 1.

**What made copies cost a compile** (read in code). As data, a copy of an object or a plain or CSG group is records
only: its code is a block, one function for every node with the same code (`builder/scenedata.js` planOf). What stays
code is compiled once per node, as codegen emits it, with that node's own uniforms, so once per copy. In the optics
bench that was the lens assembly's shell group, and with it the CSG group around it. The reason was one rule
(`scenedata.js` native): in a scene whose materials read the local point (`p_local`; the bench's brushed aluminium and
dirty glass do), twist, bend, repeat, mirror, round and shell groups were never data. Codegen's local point and the
records' differed in two cases:
- a child with no transform of its own under a twist, bend, repeat or mirror: codegen gave it the point from before the
  warp, the records the point after it (codegen gave a child WITH a transform the point after it too);
- a round's or shell's children, a Hit of their own that the group folds in itself: codegen did not count it as private
  (XF_SUB), so a surface that won inside it but not in the scene left its local point on the scene's winner.

**Built in 0.22.0.** Codegen now does what the records do: a before group's children function sets the local point to
the point its code hands them, and an after group's counts its Hit as private (`builder/codegen.js`, the children
functions). The data path takes these groups in such scenes too; one marked straightMaterial stays compiled (its material
frame). Read in code and counted, no GPU: as data, the lens assembly x 1, 4, 16 and 32 are one text, byte for byte, with
one uniform struct, in all three data rows (`bench/test/scaling.test.mjs`); it was 38 KB x 1 and 410 KB x 32, and the
user's card took 52 s to compile x 32 (0.21.6 run). The golden shaders of six documents gained only the new lines
(`fixtures/csg-v10/golden.mjs`). On a software GPU (`builder/test/scenedata.gpu.mjs`, a made-up scene of every such group
with a material reading `p_local`) codegen and data give the same local point at 2 048 points near surfaces; with the
codegen half undone, 470 differ.

**What can look different** (read in code): in the optics benches and the demo, nothing. Their shells sit inside a CSG
group's shape, where the private Hit was already counted, and every child of their before groups has a transform. In the
benchmark's frozen Noise library, six round-shaped relief groups fold after the six patterned spheres, so the old text
could put the last group's local point on a sphere's hit. Inferred, not tested: with culling on, those groups are far from
the spheres and were skipped, so nothing changed there either.

**Measured on the Pascal** (the user's scenedata run of 0.22.6 · b41a409, 1280 x 720, every row run), against the run of
0.21.6 · d77a20c: compile ms (the last kernel ready, uncached), march GPU ms a sample, and the whole sample's ms:

| row | compile | march | ms a sample |
|---|---|---|---|
| lens assembly x 32, as data | 52 205 -> 1 802 | 1958.2 -> 1008.5 | 5081 -> 2069 |
| ...with the grid | not run (predicted 2.2 min) -> 2 557 | -> 1125.1 | -> 1709 |
| ...with the grid and exact hits | not run (predicted 4.0 min) -> 5 690 | -> 1897.9 | -> 2924 |
| the optics bench, as data | 4 864 -> 1 762 | 135.5 -> 114.7 | 262 -> 242 |
| ...with the grid | 11 773 -> 2 286 | 275.8 -> 111.9 | 433 -> 247 |
| ...with the grid and exact hits | 23 104 -> 5 726 | 182.6 -> 175.8 | 309 -> 298 |
| OpticsBench2, as data | 5 349 -> 1 697 | 61.4 -> 57.0 | 175 -> 172 |
| ...with the grid | 15 313 -> 2 446 | 196.0 -> 128.7 | 338 -> 249 |
| ...with the grid and exact hits | 29 244 -> 5 659 | 58.2 -> 82.8 | 179 -> 209 |
| the optics bench, codegen (the drift row) | 7 175 -> 6 476 | 145.2 (139.1) -> 138.0 (130.1) | 266 -> 266 |

- **The check is met.** The lens assembly x 32 compiles in 1.8 s, as the optics bench does as data (1.76 s). They are
  one text: the report's `code` column, a hash of the march, surface, shade and occlusion kernels' WGSL
  (`lib/pathtracer/tests.js` 2016), is the same for both in each data row (287a6747, 9e4cf30b, 5ede9a67).
- **It runs faster too:** x 32 as data 5.1 -> 2.1 s a sample, its occlusion 3178.9 -> 1107.3 ms. Its grid and exact rows
  ran for the first time (with its copies' parts given no box: a defect of the bench, found in the scaling run of 0.22.8
  and fixed in 0.22.9, below; those two rows' times say little).
- **OpticsBench2 with exact hits got slower:** march 58.2 -> 82.8, occlusion 23.8 -> 32.6, more than the run's drift
  (6%). Not known why.
- **Most of x 32's time is a tail of few rays** (the run's per-iteration log, `wavefront` in its JSON; the tail is the
  iterations that march under a tenth of the first one's rays, `tests.js` 2225-2240). As data, its first four
  iterations take 483 ms of GPU time and the other twenty, from 74 914 rays down to 143, take 1 558. An iteration of
  1 850 rays marches for 50.7 ms, where the optics bench as data marches 1 811 rays in 2.2 ms.
- **Inferred, not tested:** with so few rays the card is far from full, so an iteration costs about what its longest
  rays' 32 steps cost; and every step of the walk visits every top-level node, at least its box (`builder/scenedata.js`
  579-580), so 32 copies' boxes. The test: the lens assembly x 1, 4 and 16 as data, beside x 32. If the tail's
  iterations grow with the count, a BVH over the objects is what would cut them.

**The test, built in 0.22.8:** Tests › scaling now runs its copy rows as data, then with the candidate grid (they were
codegen, whose x 16 and x 32 never compiled in time): one picture, 1, 4, 16 and 32 lens assemblies, the copies behind the
camera. What to read in the run, per count: `march`, `occlude` and `tail ms`, and in the JSON (`wavefront`) what an
iteration of about the same few thousand rays costs, and how many rays and iterations the tail holds.
- **Such an iteration costs more as the count grows:** each step pays for every copy, and a BVH (or the grid, if its rows
  stay flat) is the next form of step 3.
- **It costs the same, but the tail holds more rays or iterations:** the copies behind the camera catch rays and make
  longer paths. The time is the paths, not the walk, and a BVH would not take it away.
- **Neither:** the tail is the lens assembly's own, at any count, and what to do about it goes back to the user.

**Measured on the Pascal** (the user's scaling run of 0.22.8 · b70009c, 1280 x 720, every row run), GPU ms a sample:

| copies | as data: march, occlusion, tail | with the grid: march, occlusion, tail | as data: an iteration of about 15 000 rays |
|---|---|---|---|
| 1 | 61.0, 23.6, 39.3 | 100.9, 41.3, 75.0 | 1.3 (14 545 rays) |
| 4 | 72.4, 26.0, 42.2 | 187.5, 79.1, 117.6 | 1.2 (14 839) |
| 16 | 113.4, 46.6, 74.6 | 687.2, 282.1, 453.2 | 2.3 (14 966) |
| 32 | 1248.6, 1209.2, 1823.7 | 1252.6, 590.0, 818.1 | 57.3 (15 049) |

The drift row (x 1 as data again) came in at 58.9, 22.3, 41.0: 3.5% under its first run.
- **Up to 16 copies, as data, the copies cost little:** about 3.5 ms of march a copy, and an iteration of the same
  number of rays costs about the same at 1, 4 and 16, whose iterations hold about the same rays (the eighth: 8 747, 9 440
  and 8 930).
- **At 32 every ray costs about 20 times more,** not only the ones near the copies: the same 15 000-ray iteration 57.3 ms
  against 2.3; the camera's first pass, whose rays never come near copies 2 to 32 (all behind the camera), 122.6 ms
  against 28.2, and it finishes half as many rays (362 794 of 921 600, against 713 979). The scenedata run of 0.22.6
  showed the same pass the same way (83.8 ms, 364 311 finished).
- **Neither reading written above fits.** Visiting every copy's box grows with the count, so 16 to 32 would about double.
  Longer paths would put more rays in the tail, and at 32 it does hold more (the eighth iteration 15 049), but under
  twice as many, and an iteration of as many rays costs 20 times as much. Something changes between 16 and 32.
- **Read in code and checked in node, no GPU:** at 32 the records are built as at 16 -- every top-level node, 36 of 36,
  carries its box and is marked cullable (20 of 20 at 16), the shader is the same text (the `code` column), and the
  boxes are measured on each object's own lattice (`builder/boxes.js` 264-283), not coarser for a bigger scene. Not
  known what changes. Inferred, untested: something only the card does differently with 155 KB of records against
  78 KB, or with these 32 positions. The test that would split it: steps and records walked a camera ray at 16 and 32,
  counted on a software GPU (`builder/test/exact.gpu.mjs` counts both). The same counts would put it on the card; more
  steps or more records would put it in the walk.
- **The grid rows timed a defect of the bench, not the grid.** Only each copy was given copy 1's box, not its parts
  (`bench/scaling.js` lensCopies, fixed in 0.22.9: every part its counterpart's). The records' walk culls the copy whole
  and never needs its parts' boxes; the grid walks a part with no box everywhere outside its volume -- 6, 30 and 62 such
  parts at 4, 16 and 32 -- and its march grew 14 to 19 ms with each. The scenedata bench's x 32 grid and exact rows
  (0.22.6, above) had the same defect. Both need running again before the grid says anything about copies.
- **So a BVH is not shown to be the next step.** It would cut the 3.5 ms a copy; it would not explain, or obviously
  cure, what happens at 32.

**Understood, and fixed in 0.22.10: a bounding box measured wrong, not the walk or the card.** Counted on a software GPU
(lavapipe, `bench/test/scaling.gpu.mjs`, 5 184 camera rays, the boxes measured as the bench measures them):

| copies | copy 1's culling box | steps a camera ray | records a step | camera rays over 32 steps |
|---|---|---|---|---|
| 1 | about 17 x 7 x 20 cm | 24.0 | 5.7 | 1 118 |
| 16 | about 17 x 7 x 20 cm | 23.8 | 21.3 | 1 104 |
| 32, before the fix | 146 x 115 x 136 cm | 37.2 | 61.8 | 2 995 |
| 32, after it | about 17 x 7 x 20 cm | 22.7 | 38.1 | 978 |

The rays hit and missed the same at every count, before and after. More than half the camera's rays over 32 steps at
x 32 is what the card showed as its first pass finishing half as many.
- **What went wrong** (read in code, `builder/boxes.js` measure; replayed by its stand-in GPU in `boxes.test.mjs`): a
  box is measured on a coarse lattice over the whole scene, then on fine lattices over what that found. The optics bench's
  lens, inside its holder, was missed by the first coarse lattice, so the search grew, three times, to a 48.9 cm cell at
  x 32 (a bigger scene, a coarser start). Two points of that lattice, up to 44 cm off, had the lens as their nearest
  surface; every fine lattice laid over them missed it again, and the lens kept those two points as its box with the
  48.9 cm cell. The culling pads a box by its cell, and a group takes its children's coarsest, so the whole assembly's
  box grew by 49 cm on every side and every copy was given it. Each box then held the camera and its neighbours, and
  every step walked every copy.
- **At 1 copy the lens is found on the first lattice; at 4 and 16 by none**, which is harmless: it is inside its holder,
  whose box holds it.
- **The fix:** what the coarse lattice found and no fine one did is measured once more, on a fine lattice over the
  document's own guess of it. The lens is then found at its own size, as at 1 copy. A node no lattice finds stays without
  a box, as before. Measured on a software GPU, the old and the new code give every node of the eight bench scenes the
  same box (the optics bench takes one GPU sample more, 160 against 159): no scene of the page changes.
- **What is left is the walk's own cost, one record more a step for each copy** (21.3 at 16, 38.1 at 32), with the steps
  unchanged. That is the cost a BVH over the objects would cut. Inferred, not measured: on the card, the lens assembly x
  32 as data near 170 ms of march (16's 113.4 and 3.5 ms a copy) instead of 1248.6. The test: Tests › scaling again.

**Measured on the Pascal after the fix** (the user's scaling run of 0.22.10 · ef55368, 1280 x 720, every row run), GPU
ms a sample -- march, occlusion, and the whole sample's GPU time:

| copies | as data | with the grid |
|---|---|---|
| 1 | 59.8, 22.6, 102.2 | 100.5, 43.6, 165.7 |
| 4 | 67.6, 25.9, 113.5 | 135.1, 59.7, 219.4 |
| 16 | 109.8, 40.8, 169.6 | 131.9, 57.5, 212.8 |
| 32 | 168.4, 61.7, 252.4 | 131.7, 58.7, 212.7 |

The drift row (x 1 as data again) came in at 60.1, 22.4, 102.2: under 1%.
- **The cliff is gone.** The lens assembly x 32 as data: march 1248.6 -> 168.4 ms, the sample's GPU time 2492.6 -> 252.4.
  The camera's first pass finishes 838 687 of its 921 600 rays (362 794 before), as the counts on the software GPU said.
- **As data, a copy costs about 3.5 ms of march and 1.3 of occlusion, the same from 1 to 32** (the march 59.8 + 3.5 a
  copy fits all four rows within 3 ms). It is the walk looking at each copy's box at every step, counted at one record a
  step a copy. At 32 copies the copies cost about 150 of the sample's 252 ms (102.2 at 1). That is what a BVH would take
  away.
- **The grid already takes it away:** its march is the same at 4, 16 and 32 copies (135.1, 131.9, 131.7), its grid
  holding no part without a box now (`open` 0 in every row, 0.22.9). But it costs more than the plain walk where there are
  few objects: 100.5 against 59.8 at 1 copy. On these rows the two cross at about 20 copies (inferred from the two lines,
  not measured between 16 and 32).
- **So for step 3:** for many objects the grid gives what a BVH would give; what a BVH would add is not paying the
  grid's cost where objects are few. Whether that is worth building is the user's decision; nothing here needs it yet.

**Not done, and why it may not matter yet.** What is still code is compiled once per copy: an object with a material's
relief, a displace or noise relief group, group code that reads what came before it, a straightMaterial group, and a CSG
group over any of them. True instances -- one prototype, a transform per copy, so 32 copies are not 32 x 20 records -- are
not built: they would save records and box tests, not compiles. Whether either matters is for a scene that needs it.

## Before step 5: a small scene as data

Step 5 deletes codegen once the data path is not slower. On the optics benches it is not (step 3). On small scenes it is,
measured on the Pascal (the scenedata run of 0.22.6 · b41a409), march as data against codegen:

| scenes | data / codegen | what the data shader keeps (read in code) |
|---|---|---|
| the material test, Surface materials, the showcase | 4.2, 3.9, 3.1 | no frame arrays: no group with code, no subtraction |
| the demo, the Menger cubes | 8.9, 9.4 | warp groups' frames (twist, bend, mirror: `astack`) and a subtraction's (`stack`) |
| the Noise library, OpticsBench2, the optics bench | 1.36, 1.12, 0.83 | a CSG or shell group's (`stack`); big or costly scenes |

**Not more work a ray, more cost a step** (counted on a software GPU, camera rays from the bench's camera, the boxes
measured as the page measures them): the Menger cubes take 107.6 steps a ray as codegen and 107.6 as data, the demo 34.0
and 34.0, with the same hits; the data walk visits 11.4 and 8.3 records a step.

**What a data step does that codegen does not** (read in code, `builder/scenedata.js` the walk, as the Menger cubes'
shader has it): for each record, 7 values loaded from the buffer, a matrix carrying the point into its frame, a box test,
a branch on the record's kind, and a `switch` into the object's code; a warp or a subtraction keeps a frame in a small
array indexed as the walk goes. Codegen inlines the same objects' code, with no loop and no arrays. The objects' code is
the same function both ways (the Menger cube's iteration count is a runtime value in both).

**Inferred, not measured:** the walk has a cost a record that inlined code does not, which on a few small objects is most of
a step (3 to 4 times); a GPU compiler usually puts an array indexed at run time in memory rather than registers, which
would be why scenes with frames are twice as slow again; on big scenes codegen's own size costs as much (step 1).

**The test, built in 0.22.12:** Tests › **overhead** (`bench/overhead.js`), a few minutes, codegen and as data each:

| rows | the data shader keeps | if its ratio is near... |
|---|---|---|
| the Menger cubes | warp frames and a subtraction's | (the reference, 9.4 in 0.22.6) |
| ...without their warps (bend, twist made plain groups) | a subtraction's | the material test's: the warp frames were the extra cost |
| one Menger cube, alone, nearer | nothing | 1: the walk costs little around one object, so the cost is in records and frames; still 3 or more: the loop's own machinery |
| the material test | nothing | (the no-frames reference, in the same run) |

Counted on a software GPU, each pair takes the same steps a ray both ways (107.6, 52.5 without the warps, 30.5 for the
cube alone), so each ratio is what a step costs. The warps change the steps, so rows compare by ratio, not by time.

**Found on the way, not the cause:** the Menger cubes' "knikker" group (a sphere and three thin rectangles in a twist) is
given a box about 1 200 m wide. The scene's 150 m floor starts the coarse lattice at 7.1 m cells; the knikker is missed,
the search grows to 57 m, and stray points of it become the rectangles' boxes, with a 58.6 m cell. No fine lattice finds
the rectangles again, the one laid over the document's guess (0.22.10) either, so they keep the stray points. Codegen
culls by the same boxes, so it costs both ways alike, and the knikker is a few records. The same failure as the lens's
(step 4), not yet fixed. **0.33.1 (lavapipe):** the knikker's sphere is now found, from the first coarse lattice's points.
The knikker's box went from about 1 177 m to about 161 m across, its cell from 58.6 to 7.5 m, and the step cache's box
for the scene from 3.7 km to about 0.5 km. The rectangles' boxes are still about 110 m: whether that is their extent was
not looked at.

**Measured on the Pascal** (the user's overhead run of 0.22.12 · 28993bf, 1280 x 720; the drift row 1.1% under row 1),
GPU ms a sample:

| rows | march: codegen, as data, ratio | occlusion: codegen, as data, ratio |
|---|---|---|
| the Menger cubes | 90.1, 826.3, 9.2 | 33.0, 292.6, 8.9 |
| ...without their warps | 31.3, 153.4, 4.9 | 14.5, 72.1, 5.0 |
| one Menger cube | 10.5, 31.9, 3.0 | 4.8, 13.1, 2.7 |
| the material test | 13.4, 56.4, 4.2 | 5.5, 20.3, 3.7 |

- **The warps are about half of the Menger cubes' gap:** made plain groups, the ratio falls from 9.2 to 4.9, near the
  material test's 4.2. What the bend and twist cost as data -- their frames kept in `astack`, their code called from the
  walk -- doubles a step there.
- **The walk itself costs about 3 times around a single object:** one Menger cube, one record a step, no array, the same
  cube code both ways, is still 3.0 (2.7 for occlusion). So the rest of the gap is the walk's own machinery, not the
  number of records or the subtraction's frames.
- **What that machinery's cost is made of is not known.** Read in code: every scene buffer is bound as storage
  (`lib/tinywebgpu/src/tinywebgpu.js` 1276), where codegen's values are uniforms; the walk is one loop holding every kind of record's
  branch and a `switch` into the objects' code. Inferred, not tested: storage reads, or a bigger kernel running fewer rays
  at once, or both.

**The test, built in 0.22.14: the scene's buffer bound read-only.** Read in code: tinywebgpu binds a storage buffer
`read_write` unless a pipeline names it in its `readOnly` (`lib/tinywebgpu/src/tinywebgpu.js`, the schema), no kernel named the scene's,
and none writes it (the records come from the CPU, `writeData`; naga compiles every kernel with it read-only, check-shaders
pass four). A buffer's type can now say `read ` (`'read array<vec4<f32>>'`), and the scene's does, so every kernel that
declares it binds it read-only, wherever it was built. Inferred, not measured: under Chrome's D3D12 path a read-only
buffer may be read through a cache a read_write one is not. The test is Tests › overhead again: if one Menger cube's
ratio falls from 3.0 toward 1, the binding was the walk's cost; if it does not move, it was not, and the next candidate is
a uniform buffer for scenes under 64 KiB.

**Measured on the Pascal after it** (the user's overhead run of 0.22.14 · 4d79f3f; its drift row 5% over row 1), march GPU
ms a sample, codegen and as data, and the ratio against 0.22.12's:

| rows | codegen | as data | ratio | in 0.22.12 |
|---|---|---|---|---|
| the Menger cubes | 101.4 | 980.1 | 9.7 | 9.2 |
| ...without their warps | 37.3 | 190.8 | 5.1 | 4.9 |
| one Menger cube | 13.5 | 17.8 | 1.3 | 3.0 |
| the material test | 15.7 | 48.4 | 3.1 | 4.2 |

Occlusion the same way: 9.5, 5.2, 1.5 and 2.4, against 8.9, 5.0, 2.7 and 3.7.
- **The card ran slower in this run:** every codegen row, the same shader text as in 0.22.12 (the `code` column), took
  12% to 29% longer. So the ratios compare, and the times across the runs do not -- except that one cube as data took
  less time in absolute terms all the same (31.9 -> 17.8 ms), and the material test too (56.4 -> 48.4).
- **The read-only binding was most of the walk's bare cost:** one Menger cube as data is now 1.3 times codegen's (3.0
  before), and the material test 3.1 (4.2).
- **It did nothing for the scenes whose walk keeps frames:** the Menger cubes without their warps (a subtraction's frame,
  `stack`) 5.1 against 4.9, with them (and the warps' `astack`) 9.7 against 9.2 -- both within the card's slower run.
  Read in code: those two are the only rows whose data shader holds an array indexed at run time. Inferred, not tested:
  a GPU compiler puts such an array in memory rather than registers, and every frame pushed and read is a memory
  round trip; the material test's remaining 3.1 is its records' own cost, four objects a step against one.

**The test of the frames (0.22.16):** the walk keeps its innermost open frame in a variable of its own (`top` for a CSG or
after group, `atop` for an array or a before group); the arrays hold only the frames it is inside and are indexed only where
a group opens or ends (scenedata.test.mjs fails otherwise). Read in code: before, every join, every answer folded into a
group and every next copy read or wrote the array by `depth - 1` or `ad - 1`. The test is Tests › overhead again: if the
two Menger rows fall toward the others' ratios, the frames were their cost; if they do not move, the next candidate is what
the warps' and the subtraction's records do per step, not where their frames live.

**Measured on the Pascal after it** (the user's overhead run of 0.22.16 · c2731dd; its drift row 1% under row 1), march GPU
ms a sample, codegen and as data, and the ratio against 0.22.14's:

| rows | codegen | as data | ratio | in 0.22.14 | the data text |
|---|---|---|---|---|---|
| the Menger cubes | 100.2 | 877.6 | 8.8 | 9.7 | changed (both arrays) |
| ...without their warps | 34.6 | 184.0 | 5.3 | 5.1 | changed (`stack`) |
| one Menger cube | 11.3 | 16.4 | 1.5 | 1.3 | the same as 0.22.14's |
| the material test | 14.7 | 45.3 | 3.1 | 3.1 | the same as 0.22.14's |

Occlusion the same way: 8.1, 4.9, 1.4 and 2.5, against 9.5, 5.2, 1.5 and 2.4. Every codegen row's `code` is 0.22.14's.
- **The rows whose data text did not change are the run's noise:** one cube 1.3 -> 1.5, the material test 3.1 -> 3.1. So a
  ratio moving by 0.2 says nothing.
- **The frames were not the walk's cost.** The subtraction's frame out of its array changed nothing (5.1 -> 5.3). The warps'
  frames out of theirs gave about a tenth (9.7 -> 8.8; as data 980.1 -> 877.6 ms, codegen 101.4 -> 100.2). An earlier
  run of the same build, stopped by the loss below, said 8.5. The hypothesis of 0.22.15 is refuted for the subtraction
  and explains little of the warps. The change stays: it costs nothing and is pinned by a test.
- **The GPU was lost once:** the first run of 0.22.16 lost the GPU (DXGI_ERROR_DEVICE_HUNG) in the Menger cubes' data row,
  after its timed samples, in the one sample with the wavefront log. The second run, the same build, did not. Read in code:
  that sample is cut into submissions as the others are (raytrace_main.js NO SUBMIT LONG ENOUGH TO BE KILLED). Counted on
  a software GPU: the walk takes the same steps and visits the same records on that scene as before 0.22.16. Not
  established as this change's; a second loss there would make it something to find.

**Where that leaves the small scenes:** one object as data is now within half again of codegen; what grows the gap is the
number of records a step walks (the material test's four objects, 3.1; the Menger cubes' groups, subtraction and warps, 5
to 9). Inferred, not tested: the cost is per record walked -- its words read, its frame applied, its block chosen --
rather than in any one kind of record. What would test it: the records walked a step on each row, counted on a software
GPU, against the ratios above. If the ratio follows the count, the next change makes each record cheaper or walks fewer;
if it does not, it is in what particular records do.

**The count (0.22.18): a data step costs what its records cost, each about one codegen step.** Counted on a software GPU
(lavapipe): each row's camera rays (96 x 54 of them, the bench's camera), marched at most 32 steps as the first march pass
marches them, boxes measured as the bench measures them, the records the walk visits counted by kind. Against it, measured
(the user's second overhead run of 0.22.16, Pascal): the first iteration's march GPU ms in the wavefront log -- the same
1,843,200 camera rays, the same at most 32 steps:

| rows | records a step | ...culled by their box | ...shapes evaluated | first pass, data ÷ codegen | a whole sample's |
|---|---|---|---|---|---|
| the Menger cubes | 11.0 | 1.8 | 4.2 | 9.9 | 8.8 |
| ...without their warps | 5.2 | 2.7 | 0.4 | 6.7 | 5.3 |
| one Menger cube | 1.0 | 0.7 | 0.3 | 1.3 | 1.5 |
| the material test | 4.1 | 3.8 | 0.3 | 3.7 | 3.1 |

Codegen and data took the same steps on every ray and every ray ended the same way (counted). Dividing the measured first pass
by the counted work, GPU time over every ray:
- **as data, 93 to 124 ps a record walked**, on all four rows -- whatever the record: the material test's are nearly all
  culled boxes, the Menger cubes' include two warps' code and four Menger shapes a step;
- **as codegen, 96 to 117 ps a step**, on all four rows -- whatever the step does.

So the ratio is about the records walked a step: a record costs about what a whole codegen step costs, and a shape's own
work is small beside it (the Menger cubes evaluate thirteen times the shapes a step of the cube alone, and their record
costs the same). This explains the gap on every row this test has, from 1.3 to 9.9. Inferred, not tested: what a record
costs is the walk's chain of reads from the scene's buffer -- which record comes next is in the one before, so each read
waits for the last -- not arithmetic. What would test it: the records read from a uniform buffer (made for every thread
reading the same address, as here) instead of a storage buffer, Tests > overhead again. If the data rows' ps a record
fall, that was it; the other road is fewer records a step (a hidden node's record and a before group's end do nothing but
say where the next record is: 2 of the Menger cubes' 11 a step, counted).

**The test of the reads (0.22.19):** the header and the records, copied into a uniform buffer of their own (64 KiB: the
header and 585 records), which the plain walk reads every record from (`scnRec`, scenedata.js RECORDS_IN_UNIFORM); a
record past its room is read from the scene's buffer, so it is one text whatever the number of records (the scaling bench's
lens assemblies have 612 at 16 copies and 1220 at 32). Parameters, the light table, the solids' table and the grid stay in
the scene's buffer. Not with the grid or exact hits: there neighbouring rays walk different records, and a uniform buffer is
the path for a value every thread reads alike. Read in code: the arithmetic and its order are unchanged; the software GPU
tests run the walk against codegen through it. The test is Tests › overhead again, the same rows: if the data rows' cost a
record walked falls from about 100 ps, the reads were the cost.

**Measured on the Pascal after it** (the user's overhead run of 0.22.19 · 10b4e1e; its drift row 8% over row 1). Each data
row's march against its own codegen row's, a whole sample and the first pass, and the first pass's GPU time a record walked
(the records a ray counted for 0.22.18; the scenes are the same):

| rows | a sample | in 0.22.16 | first pass | in 0.22.16 | ps a record | in 0.22.16 |
|---|---|---|---|---|---|---|
| the Menger cubes | 8.6 | 8.8 | 10.4 | 9.9 | 98 | 105 |
| ...without their warps | 5.0 | 5.3 | 6.0 | 6.7 | 107 | 124 |
| one Menger cube | 1.4 | 1.5 | 1.2 | 1.3 | 105 | 123 |
| the material test | 1.7 | 3.1 | 1.8 | 3.7 | 46 | 93 |

Codegen's step: 91 to 103 ps, as before. Occlusion, data against codegen: 7.9, 4.9, 1.6 and 1.5.
- **The material test's records cost half what they did:** 93 -> 46 ps each, and the test is 1.7 times codegen's march, not
  3.1. Its records are four objects at the top level, nearly all of them culled by their box a step: reads, a frame and a
  box test. For those, the reads were the cost.
- **The Menger rows' records hardly moved** (105 -> 98, 124 -> 107 ps: a tenth or so, within reach of the run's noise), and
  one cube's neither (123 -> 105). So what a record costs there is not, or not mostly, where it is read from. Read in code:
  their shaders carry what the material test's does not -- the Menger cube's own code (a loop, in the walk's switch), a
  subtraction's frames, two warps' code. Inferred, not tested: a heavier shader keeps fewer rays on the card at once, and
  then each read's wait is hidden less; that would make the cost the shader's weight, paid at every record. What would test
  it: the material test with a Menger cube in it that the rays never reach -- its code in the shader, its record culled.
  If the material test's cost a record rises toward 100 ps, the weight is the cost.

## A lazy step cache, simulated (0.22.21; the user's idea)

**The idea:** a dense grid of cells over the scene, empty at first. The first march step in an empty cell evaluates the
scene's distance at the cell's centre and keeps it; a later step at a point q in that cell may move by `centre distance -
|q - centre|` -- a lower bound on the distance at q, since a distance changes by at most one a unit -- without evaluating
the scene, where that bound is at least a cell wide. Near surfaces the cell gives nothing and the step evaluates as now.
Any change to the scene empties it. It is the empty-space half of the candidate grid (whose empty cells hold only a floor),
filled lazily, with no candidate lists.

**Counted on a software GPU** (lavapipe; scratchpad probe, not in the repository): 128 x 72 camera rays from each overhead
row's camera, marched to the end (at most 400 steps), and shadow rays from their hits (the normal from the field's gradient)
toward one fixed direction. The cache's box around the camera rays' hits (2nd to 98th percentile each way, a metre more).
Cold: the cache empty. Filled: every cell of the box filled first -- the steady state a sample of the card's 921 600 rays
would leave the cells they cross -- and the camera rays jittered half a pixel. Every cached step was checked against the
true distance at its point: a step past the march's own (culled) distance there was judged again by the scene compiled
without culling, and the culled distance is itself a lower bound. **None of 2.1 million cached steps passed the true
distance.** Every ray ended where the plain march's did but for one or two in nine thousand; with no step too long, that
is the march's tolerance ending a ray a little elsewhere (inferred: where, not looked at).

Full SDF calls a ray, filled, against the plain march (cells of 0.5 m / 0.25 m):

| rows | camera rays | shadow rays | camera steps (0.25 m) | cache (0.25 m) |
|---|---|---|---|---|
| the Menger cubes | -16% / -22% | -8% / -12% | +4% | 80 MiB (the floor's hits make the box 150 m wide) |
| ...without their warps | -12% / -15% | -17% / -19% | +2% | 81 MiB |
| one Menger cube | -1% / -8% | 0% / -2% | -4% | 0.3 MiB |
| the material test | -11% / -25% | -5% / -9% | +2% | 0.2 MiB |

- **It is sound** (counted above), and it saves a tenth to a quarter of the full SDF calls of camera rays, less of shadow
  rays. One cube hardly gains: its rays spend their steps at its surface.
- **The rest of the calls are near surfaces**, where no distance cache can help: the approach and the grazing rays. That
  is where sphere tracing spends its steps.
- **On these four rows, not worth building.** The test set beforehand was a third fewer full calls; this is less, and a
  step would pay a lookup in a storage buffer, a read neighbouring rays make at different addresses, at every step, near
  surfaces too. Inferred, not measured: on the small scenes that lookup would eat most of what it saves. What cuts
  near-surface steps is an answer along the ray (exact hits, step 3), for the shapes that have one.

**The other bench scenes (0.22.22; the user: "menger is only one of the scenes, and that's a quite peculiar one").** The
same simulation on the six other bench scenes, the cells sized by a budget instead (the scenes are in m, cm and mm): a
million cells (4 MiB) and four million (16 MiB) over the box; a ray's end compared within the leaving offset (10 x the
march's tolerance), in the scene's units. Full SDF calls a ray, filled, against the plain march:

| scene | camera rays (1 M / 4 M cells) | shadow rays | camera steps (4 M) |
|---|---|---|---|
| the demo | -20% / -23% | -22% / -24% | +6% |
| the showcase | -20% / -28% | -25% / -35% | -1% |
| Surface materials | -18% / -22% | -21% / -25% | +2% |
| the Noise library | -18% / -19% | -18% / -23% | +3% |
| the optics bench | -22% / -29% | -37% / -45% | +2% |
| OpticsBench2 | -26% / -29% | -26% / -32% | +5% |

- **These gain more than the Menger rows**: a fifth to just under a third of the camera rays' full SDF calls, a fifth to
  nearly a half of the shadow rays' -- the optics benches most, whose shadow rays cross open space between the parts.
- **Not always sound as it stands.** On the Noise library at a million cells, 1572 of 45 366 cached camera steps (and 17 of
  19 678 shadow) took a bound past the scene's own unculled distance there -- that distance moves by more than one a unit
  somewhere. At four million cells 1 step; on the optics benches 1 to 4 steps in about a hundred thousand. No ray ended
  otherwise: the march steps 0.9 of what it is given (`stepscale`), which absorbs a bound up to a ninth too long -- here,
  not as a rule. Inferred, not traced: the compiled subtrees (a displace, a relief in its shell), which grid.js already
  gives a margin of a cell for, since they jump at a shell's edge. A cache would need the same margin.
- **Still to know: what a lookup costs.** That is the card's to say, and what a prototype behind a developer switch would
  measure: the saving is about a quarter of the march's SDF calls and a third of occlusion's, less the lookup at every
  step.

**With the ray's direction (0.22.23; the user: "use direction information as well").** A filled cell certifies a ball: its
centre and, as radius, the distance there -- no surface is inside it, whenever that distance is no more than the true
distance at the centre, which is the march's own contract at every point it evaluates. So a point inside the ball can move
to where the RAY leaves the ball, not only to the ball's nearest edge, and a neighbouring cell's ball serves as well as its
own. Three rules, simulated as before over a filled cache (a budget of four million cells; the box padded a twentieth of
its size, which on the Menger cubes covers more of the open space above them than before, and makes the material test's
cells 4.9 cm): `iso` the nearest edge (the rule above); `ray` the own ball's exit along the ray; `ahead` the farthest exit
among the balls of the own cell and the two cells ahead along the ray (three lookups a step).

Full SDF calls a ray against the plain march, iso / ray / ahead:

| scene | camera rays | shadow rays | camera steps, ahead |
|---|---|---|---|
| the optics bench | -29% / -32% / -33% | -45% / -46% / -52% | -11% |
| OpticsBench2 | -29% / -34% / -43% | -32% / -48% / -46% | -13% |
| the demo | -23% / -27% / -31% | -24% / -31% / -50% | -7% |
| the showcase | -28% / -30% / -36% | -35% / -41% / -56% | -14% |
| Surface materials | -22% / -26% / -28% | -25% / -32% / -38% | -10% |
| the Noise library | -19% / -23% / -28% | -23% / -31% / -35% | -9% |
| the material test | -46% / -51% / -58% | -28% / -35% / -43% | -21% |
| the Menger cubes | -34% / -42% / -48% | -12% / -16% / -22% | -23% |

- **The direction is worth a tenth to a quarter more**, and with it every scene clears the third set beforehand on one ray
  kind or both; the optics benches, the demo and the showcase save about half of their shadow rays' calls. And `ahead`
  takes FEWER steps than the plain march, everywhere: a ray in open space crosses balls whole.
- **A CORRECTION to the line above (0.22.22) that called the cache "not always sound":** that check took a bound above the
  scene's own distance at the step's point for a step too long. It is not: the ball argument needs the centre's value to
  be a lower bound, not the scene's distance to change by one a unit, and a relief's or a displace's distance is a looser
  bound at one point than another. The check now is the direct one: a cached step whose two ends lie on the two sides of a
  surface (its sign changes). That found 0 to 6 in the tens of thousands a scene (6 of Surface materials' 27 305 cached
  shadow steps, iso; 1 on each optics bench, ray and ahead), and no ray's outcome changed with them but on the Menger cubes
  (1 or 2 in 9216, as many as the plain march's own tolerance moves elsewhere). Not traced: a centre whose value is above the
  true distance (the march's contract broken there, which its 0.9 step factor would hide), or a shadow ray starting a hair
  inside a surface. A step that passes through a thin part whole is not seen by a sign test at all. Both need knowing before
  a cache is trusted.
- **Still uncounted, and the card's to say: what the lookups cost** -- one a step for `ray`, three for `ahead`, at addresses
  neighbouring rays do not share, and the cache's fill after every change to the scene.

**The prototype (0.23.0; the user: "yes, build the prototype").** The developer setting `stepCache` (Advanced > Ray
marching): 0 off, 1 the own cell's ball, 2 the cells ahead (lib/pathtracer/core/wavefront.js stepCacheWGSL). Read in code:
- **In the march and occlusion kernels**, codegen's scene or data's alike. A cached step moves the ray with no SDF; an empty
  cell is filled on a trip of the kernel's one SDF call (it asks the cell's centre instead of the ray's point), so no
  kernel holds a second copy of the scene (bench/test/copies.test.mjs unchanged). The march never caches on a pass's last
  iteration, whose hit the flush hands to shade.
- **The box** is the solids' measured boxes joined, a tenth of its largest side more each way (builder/stepbox.js, from the
  scene-as-data records whatever the scene's form), set by the page while the setting is on and by the bench for every row;
  about four million cells (16 MiB). No box, no cache.
- **Emptied whenever the picture starts over** (R.trace's reset): every edit, and every camera move -- which a camera does
  not need; the prototype's one rule. Changed in 0.24.0, below.
- **Not in the optics trace**, whose copy of the scene draws limiters the render's leaves out: it binds a word of its own and
  keeps the setting off.
- **Run on a software GPU** (builder/test/stepcache.gpu.mjs, the engine's own kernels): on the optics bench, the demo, the
  showcase and the material test, with 1 and 2, cold and warm, every camera ray ends in the same state and every hit at the
  same place, every shadow ray blocked or not as with the cache off; with 2 the steps a camera ray fall (the optics bench
  25.7 -> 20.4, the showcase 19.6 -> 17.1, the material test 26.6 -> 20.0, the demo 34.1 -> 33.5).
- **...and the optics bench as data, three ways** (counted there, lavapipe): as data 29.9 -> 23.9 steps a camera ray with 2,
  sound. **With exact hits the steps rise**: 6.9 -> 17.8, and 6.9 -> 11.9 with the grid too -- every ray still ends as with
  the cache off. Read in code why: with exact hits one SDF call can take a ray to its hit (SCN_EXACT), and the cache, asked
  first, moves the ray only to a ball's exit, which is shorter; the ray then needs its exact call anyway. Inferred, not
  measured: whether that is slower. A step there is a lookup or a call, and `steps` does not tell them apart, so the card
  says it (Tests > stepcache's last scene). If it is slower, the simple rule is the cache off wherever the scene has exact
  hits; a finer one, a lookup only where the cell's ball is large, would need its own test.
- **The cost when off:** the text of both kernels grew (a uniform test a step, the look-up's code), so every scene's march
  and occlusion text is new; whether that costs anything with the setting at 0 is the drift against earlier runs, not
  measured here.
The test is Tests > stepcache on the card: each scene off, 1 and 2, and the optics bench with exact hits last.

**Kept across camera moves, and the cell count a setting (0.24.0; the user: "keep the cache across camera moves", and the
cell budget as a developer setting with bench rows).** Read in code:
- **What empties the cells** (lib/pathtracer/core/raytrace_main.js R.stepCacheFor, every trace while the setting is on): a
  change to any uniform but the camera's four (invView, invProjection, camPos, camtype: lib/pathtracer/index.js
  buildUniforms), another scene, or the scene's data written -- `scene.dataRev`, counted where every write happens
  (builder/scenedata.js attachData: init and writeData), since four callers write a data scene's records and a count in
  one of them would see one. More than the shape (an exposure change empties them too), but nothing is guessed about which
  uniforms a scene's distance reads. Read in code that none moves while the camera does: the page's bag is rebuilt on an
  edit (index.js update), never a frame, and holds the camera's arrays by reference; no scene's distance reads the camera
  (the one scene read of a ray's length, codegen.js's emission weighting, is in the material). A scene with GPU state of
  its own and no revision keeps the old rule; switched off and on again, the cells start empty.
- **The cell count** is the developer setting `stepCacheCells` (Advanced > Ray marching, in millions: a quarter to
  sixteen, four by default); a change cuts the box again, empty. Host-side only: the kernels read the grid's corner, cell
  size and counts, which the host cuts from any count.
- **Counted on a software GPU** (builder/test/stepcache.gpu.mjs, a million cells): a second camera, 35 degrees round and
  10 up, marching over the cells the first one's rays filled ends every ray as its own run with the cache off does, on
  every scene and way above, and takes fewer steps where the cache already did (the optics bench 22.3 -> 18.1, the
  material test 33.1 -> 26.1, the showcase 19.9 -> 17.8; with exact hits more, as above). build.test.mjs runs the rule
  through R.trace (a camera moved: kept; a scene value, another setting, the data, the scene: emptied) and the count's
  change.
- **Still the card's to say:** which count pays (Tests > stepcache: cells ahead at 1, 4 and 16 million for every scene),
  and what an orbit feels like now -- the fills an orbit paid again are gone, which no bench row measures.
- **0.24.1: none of it had run in the page.** The user's first run of Tests > stepcache stopped on "Maximum call stack size
  exceeded": the facade (lib/pathtracer/index.js) bolts its methods onto the engine object, its setStepCacheBox replaced
  the engine's and called itself. Every test drove the engine alone; build.test.mjs now builds the facade and checks every
  method it replaces. The same shape as CLAUDE.md's: true for the only caller the tests had, false for the page's.
- **0.25.0: the cells shown** (the user: "I'm wondering if the cache works correctly at all. Is there a way to visualise
  the 3D grid?"). The developer switch stepCacheView: the display pass walks each pixel's camera ray through the grid
  (lib/pathtracer/core/rendertoscreen.js STEP_CACHE_VIEW_WGSL, a 3D DDA) and draws every filled cell as fog, green where
  its ball reaches past the cell, orange where not. The page's own answer to "is it running here": no fog, no cache.
  0.32.2: the green cells clear (the user: "the green is not useful ... now it's just a huge green blob with nothing else
  visible"); only the orange band near surfaces shows, where a ray still asks the scene.
  Checked against brute force on a grid by hand on a software GPU (builder/test/stepcache.gpu.mjs): every pixel agrees.

## A bake mode, tested (0.28.0; the user: "what if the default mode is data, and there is a bake mode that compiles everything")

**The idea:** data as the default -- edits without a compile -- and a bake for rendering: the scene compiled with every
value fixed, but a few the user keeps live. Codegen already compiles the structure; what a bake adds is the values.

**What codegen reads at every step, read in code** (builder/codegen.js; the demo's text): per node its transform
(`UB.xf_<id>`: `xfPoint` multiplies the point by the matrix, and `XF_M * xfRot(...)` carries the frame on for normals and
materials, a 3x3 product), its culling box (`UB.bxlo_/bxhi_<id>`), its sizes (`UB.radius_<id>` ...), and the materials --
97 uniforms in the demo with 129 reads in its text, 464 in the optics bench with 736. As constants the compiler may fold
them: a node neither turned nor scaled loses its matrix products. Inferred, not measured: that this is a real share of a
codegen step (91 to 103 ps on the Pascal, measured); how large, only the card says.

**The test, built in 0.28.0** (Tests > bake; builder/bake.js, bench/bake.js): each bench scene as codegen, then baked --
every uniform a scene constant (uniforms.schema.js sceneConstantsWGSL, which since 0.28.0 writes vectors and matrices),
the text reading those, nothing else changed (un-baked it is codegen's byte for byte: bench/test/bake.test.mjs). The
culling boxes stay uniforms: the bench measures them after the compile, so a bake that folded them would need the boxes
first -- not done; the rows compare everything but the box values. On a software GPU (builder/test/bake.gpu.mjs, Dawn):
all eight scenes' baked kernels compile and every camera ray ends as codegen's, the same steps but one ray in 18 432.

**How to read the card's run:** if the baked rows' march, occlusion and surface times are clearly below codegen's, a bake
mode beats today's codegen, and the shape is data for editing, baked for rendering (compiled in the background once
edits stop; inferred, not built). If they are level, today's codegen is already the bake, and the shape is data for
editing, codegen for rendering. Either way the compile ms column is what one bake costs after every change.

**Measured on the user's Pascal card** (the bake run of Raytracer 0.28.0 · 273aa0d, 1280 x 720, Chrome 154 on Windows), GPU
ms a sample, codegen -> baked, and the compile: the time until every kernel was ready, each text uncached:

| scene | GPU | march | occlusion | surface | compile ms |
|---|---|---|---|---|---|
| the optics bench | 297.4 -> 109.1 (-63%) | 189.7 -> 61.2 (-68%) | 78.2 -> 25.6 (-67%) | 13.2 -> 7.6 | 8456 -> 4643 |
| OpticsBench2 | 129.8 -> 57.9 (-55%) | 71.2 -> 22.8 (-68%) | 32.0 -> 11.0 (-66%) | 6.1 -> 4.0 | 11682 -> 2806 |
| the Noise library | 227.7 -> 241.7 (+6%) | 128.5 -> 135.1 (+5%) | 52.7 -> 58.5 (+11%) | 22.0 -> 23.6 | 2874 -> 2301 |
| Surface materials | 65.0 -> 57.3 (-12%) | 28.7 -> 21.4 (-25%) | 7.1 -> 5.9 (-17%) | 3.8 -> 3.8 | 2221 -> 2128 |
| the showcase | 86.9 -> 68.2 (-22%) | 37.6 -> 24.3 (-35%) | 11.6 -> 8.2 (-29%) | 4.8 -> 4.4 | 2167 -> 2138 |
| the demo | 79.2 -> 68.2 (-14%) | 34.0 -> 24.3 (-29%) | 10.4 -> 8.8 (-15%) | 5.7 -> 6.1 | 2139 -> 2034 |
| the Menger cubes | 182.5 -> 122.6 (-33%) | 111.9 -> 69.4 (-38%) | 40.0 -> 23.4 (-42%) | 6.1 -> 5.4 | 2462 -> 2104 |
| the material test | 54.4 -> 48.5 (-11%) | 17.2 -> 14.5 (-16%) | 6.9 -> 5.0 (-28%) | 5.2 -> 5.3 | 2152 -> 2050 |

- **Baked is faster on seven of the eight**, the march by a sixth to two thirds and occlusion alike; the optics benches
  most, their march and occlusion a third of codegen's -- the scenes with the most values (464 uniforms, 736 reads in the
  optics bench's text). Shade does not move, as it should not: it holds no scene since 0.20.8.
- **The exception is the Noise library**, 5% slower to march and 11% to occlude. Not explained: its time is in the
  noise its reliefs evaluate, which reads no scene value, and the compiler may lay out a kernel of constants otherwise
  (registers, unrolling). Inferred, not tested; what would: the two kernels' sizes and registers side by side, or the
  run again.
- **Compiling baked is no slower anywhere, and much faster for the optics benches:** OpticsBench2's scene kernels were
  ready in 2.5 s against 11.7 s, the optics bench's in 4.6 s against 8.5 s. The other scenes' totals are shade's, the
  same in both rows (about 2.1 s), their own kernels a little faster baked. Read in the report, not explained: the
  codegen texts declare every value in one uniform struct, hundreds of fields for the optics benches; whether that is
  what the driver's compiler is slow on is inferred.
- **The run's own drift:** the last row, the optics bench as codegen again, 292.7 GPU ms against row 1's 297.4 (-1.6%).
  Its wall clock rose 12%, the recording with it (9.6 ms a sample against 1.6): the page's CPU side slowed by the run's
  end, not the GPU. So the GPU columns are the ones to read here. The material test's baked wall clock is noisy for the
  same kind of reason (samples to 148 ms); its GPU time is not.
- **What this settles:** with these values constants, the kernels are cheaper on this card than codegen's for every
  scene but one, and no slower to build. So the bake earns its place: data for editing, baked for rendering. Still
  inferred: a bake with the culling boxes folded too (the bench kept them live); and that a bake compiled in the
  background once edits stop would never be waited for.


## Every option a build, not a test (0.29.0; the user: "make sure that all these different options, even when turned off, dont impose an overhead")

**The question:** "if the bounding boxes are not used, does it still slow down the code?" Read in code, before 0.29.0:
yes, potentially. Two options were in the kernels whichever way they were set, and only a uniform decided at run time.
- **The step cache:** its lookup block, its fill and its binding sat in the march and occlusion kernels. The kernels
  tested `UB.stepCache` at every step, and passed the scene a stand-in ray (`SDF(ask)`) instead of their own.
- **The bounding boxes:** every box test was in codegen's text and in the records' walk. Each one asked `UB.cull` at
  every step, and so did the ray's object list.

What either cost when off was never measured. It would show as the difference between off and a kernel without the
code, and no such kernel existed. Now one does, and it is the only kind used when the option is off.

**Now each is compiled in only when on** (the user: "they could be different compile options"):
- **The step cache and its view are kernel options** (raytrace_main.js `R.kernelOptions`, `R.builtOptions`). The facade
  builds again when a setting changes (index.js `syncKernels`): one job, with the loop held, after any swap under way.
  - Off, march and occlusion are byte for byte what they were before the cache existed. The display pass is the same.
    The cells' buffer is one word.
  - The benchmark sets a row's options before it swaps the row's scene in, so that swap builds them. Nothing compiles
    the scene before with the row's options (build.test.mjs counts the builds).
- **The bounding boxes are a generation option of the builder** (codegen.js `cull`, from the renderer's setting).
  - Off, the scene is made without a box test or a box uniform anywhere: codegen, as data, with exact hits, with the
    grid (codegen.test.mjs). `cullDist` and the ray's list no longer test a uniform.
  - The benchmark's "bounding boxes off" rows are such scenes now, not the same scene with `cull` 0.

**What it settles, and what it does not:** an option switched off now costs nothing in the kernels, and the kernel text
shows it (the tests compare it). Whether the old uniform tests cost anything measurable was never known, and still is
not. Inferred: on a GPU a branch on a uniform is uniform across a warp and cheap, but the code it guards still takes
registers and compile time. The card's next runs say how much, if anything.

**Where this goes** (the user: "find the optimal solution(s) for highest render speed and most flexible editing"): every
option is now a choice of what to build, so editing and rendering can be built differently from one scene. The scene
as data for editing (nothing compiles per edit); for rendering, whichever combination of bake, step cache, grid, exact
hits and boxes the card says is fastest, measured as combinations side by side rather than one at a time. Not yet
built: that bench, and the bake in the background.

## The bake in the background (0.31.0; the user: "yes, build the bake mode")

**The shape the bake run argued for** (*A bake mode, tested*): data, or codegen, for editing, and baked for rendering,
the bake compiled where nothing waits for it.

**Built** (builder/baker.js, the developer setting `sceneBake`):
- **Waiting for quiet:** the page looks twice a second. The builder's edits (`revision`, `liveEdits`) must stand still
  for IDLE_MS (2 s), the scene being edited must be shown, and no apply or build may be under way.
- **Compiling:** the builder bakes the scene shown (`bakeScene`: codegen's text, every value a constant but the culling
  boxes). The engine compiles its kernels without showing it (raytrace_main.js `R.precompile`: the build's table, the
  pick and the tagged field, all async) into tinywebgpu's pipeline cache.
- **Swapping in:** if nothing moved meanwhile, it is swapped in through the builder's queue (`showBaked`: one swap at a
  time with the applies), from the cache, with `keepPicture`. The samples and the light map stay, since the baked
  scene draws what the edit build drew (bake.gpu.mjs: every camera ray the same).
- **Going back:** a live value with the baked scene shown asks for the editing build (an apply, from the cache), which
  builds from the document as it is. Undo, structural edits and switching modes reach the same apply by their own
  roads. A bake an edit overtook is dropped, its kernels left in the cache.

- **Animated values (0.38.0; the user, 2026-10-08: "any variables that need to be animated should be a uniform"):** a
  value flagged ◆ in the properties panel (model.js setAnimated, kept on its node or material) stays a uniform in the
  bake (builder/animate.js: the registry path to the uniforms its live push writes, and what is bound to a component
  parameter flagged). A live value whose every uniform the baked scene still declares is written to it, and the bake
  stays; anything else goes back as above. Flagged writes are counted apart from `liveEdits`, so a timeline playing
  them does not keep the bake from starting; those moved during a bake's swap are pushed again once it is in. No bake
  starts during an offscreen render (`RT.offscreenBusy`: a recording would otherwise see its kernels swapped).
  What a kept uniform costs against a folded constant is not measured.

**Inferred, not measured:**
- That a compile in the browser's GPU process does not visibly stall the frames drawn meanwhile.
- That a swap from the cache is short: tinywebgpu's cache answers with no module and no pipeline (build.test.mjs), but
  what setScene costs then on a card has not been timed.

The status line and the console say what each bake cost, for the user to paste.

**The lights at the swap (0.34.2).** Seen by the user: "the light goes off once or twice right after the bake compile",
the rest steady. Read in code: the optics module's photon kernel for the picture's light-traced lights took the scene's
uniforms into its struct, so it was built again for every scene shown, and until then the renderer left those photons
out of the frame. A baked scene declares only its boxes, so every bake was such a compile, into a picture kept. The
kernel reads none of the scene's uniforms; it is built once now (optics/kernels.js prog_opt_photons). Seen by the user
on 0.35.0 · 920e1ff (2026-10-07): "no more flash, light stays on through the bake".

**On by default (0.35.0; the user, 2026-10-07: "make bake default on").** A new workspace or a first visit bakes; a saved
one keeps what it saved, since settings() saves every value. What a swap to the baked scene still does not carry, read in
code and not changed:
- **The step cache**, while it is on: the page sets its box again for the new scene object (index.html pushStepBox), and
  setting it restarts the picture (lib/pathtracer/index.js setStepCacheBox); the cells are emptied for another scene
  (build.test.mjs). So with the cache on, a bake starts the picture over rather than keeping it.
- **The optics trace's kernels** (the Optics page's runs and Live): not precompiled with the bake (baker.js, NOT DONE), so
  the first trace after each bake compiles them for the baked text. They compile: check-shaders builds them against every
  baked bench scene.

**Which build to render with, asked of the card (0.32.0, Tests > builds, bench/builds.js):** each bench scene as
codegen, baked, baked with the step cache, as data with the grid and exact hits, and that with the cache, side by side
with the same camera and boxes. Its answer, per scene, is what the bake mode should build. Not run yet.

**Measured on the user's Pascal card** (the builds run of Raytracer 0.32.0 · 1eea9a8, 1280 x 720, Chrome 154 on Windows), GPU
ms a sample (march / occlusion in brackets); the step cache is the cells ahead at 4 million cells:

| scene | codegen | baked | baked, step cache | data, grid, exact | data, grid, exact, step cache |
|---|---|---|---|---|---|
| the optics bench | 253.7 (159.0 / 68.1) | **93.1** (52.0 / 21.3) | 99.7 (57.5 / 21.9) | 291.2 (201.7 / 66.2) | 267.6 (186.9 / 52.2) |
| OpticsBench2 | 108.3 (56.1 / 29.4) | **47.7** (18.6 / 8.3) | 56.4 (24.2 / 10.7) | 144.3 (86.3 / 26.1) | 158.8 (97.3 / 29.0) |
| the Noise library | 206.9 (110.8 / 49.0) | 209.7 (108.9 / 53.1) | **186.3** (102.2 / 41.7) | 261.7 (144.6 / 72.8) | 266.0 (154.0 / 67.5) |
| Surface materials | 59.2 (23.9 / 6.7) | 49.1 (16.3 / 5.1) | 68.5 (31.9 / 9.1) | **41.6** (11.8 / 3.9) | 74.2 (35.7 / 10.9) |
| the showcase | 76.9 (32.9 / 9.9) | **60.0** (20.8 / 7.3) | 78.7 (34.8 / 10.2) | 66.1 (23.5 / 10.9) | 102.7 (52.0 / 17.5) |
| the demo | 66.4 (27.2 / 9.5) | **56.1** (19.1 / 7.3) | 77.9 (36.7 / 11.7) | 838.1 (569.0 / 195.6) | 893.9 (607.1 / 206.4) |
| the Menger cubes | 151.9 (92.3 / 34.7) | **103.7** (58.7 / 20.3) | (none) | 4636.9 (3323.2 / 1235.8) | (none) |
| the material test | **43.2** (13.7 / 4.6) | 44.2 (13.4 / 4.9) | 61.5 (27.9 / 8.3) | 54.0 (19.7 / 8.5) | 72.4 (37.6 / 10.7) |

- **Baked is the fastest build on five of the eight scenes,** 16 to 63% below codegen, and level with codegen on the
  material test (+2%) and the Noise library (+1%). The bake mode as built (0.31.0: baked, no cache) renders those.
- **The two exceptions:** the Noise library, where baked with the step cache is fastest (10% below codegen, 11% below
  baked); and Surface materials, where the scene as data with the grid and exact hits is (30% below codegen, 15% below
  baked).
- **The step cache, as built, costs more than it saves almost everywhere:** on the baked build it is slower on six of
  seven scenes (+7% on the optics bench to +40% on Surface materials) and faster only on the Noise library (-11%); on
  the data build faster only on the optics bench (-8%), slower on the other six (+2% to +78%).
- **The data build with the grid and exact hits is far off codegen on two scenes:** 12.6 times on the demo, 30.5 times on
  the Menger cubes. Not new: as data alone they were about 9 times codegen in 0.22.6 (*Before step 5*), and exact hits
  made the demo 2.7 to 3.2 times slower again in 0.21 (step 3). The Menger cubes' grid is spread over the marble's box
  (124 m cells), so it narrows nothing there.
- **Compiling:** the baked rows were ready sooner where codegen's were slow (the optics bench 6.9 -> 3.4 s, OpticsBench2
  9.4 -> 2.2 s), level elsewhere (about 1.7 s, shade's). **Drift:** the last row, row 1 again, 254.6 GPU ms against
  253.7 (+0.4%).

**Inferred, not measured -- and what would test each:**
- *Why the cache loses:* a step with it reads three cells and does a ball test before anything else, and the baked SDF
  it saves is cheap; it wins where the SDF is dear (the Noise library's reliefs). Test: the cache's own cell only
  (setting 1, one read a step) on the same rows, which the stepcache bench has.
- *Why the data build wins Surface materials:* its shapes answer exactly and the grid holds under one solid a point
  (0.83 mean). Test: its "as data" and "with the grid" rows apart (the scenedata bench).
- *What it says about the step cache's second version* (filled once and read-only; the closest object per cell): its
  saving is bounded by the SDF calls it removes, which on a baked build are cheap. Worth it only if a lookup becomes far
  cheaper than now, or for scenes whose SDF is dear. Not built.

**The builds run again, on 0.33.1 · 4c78e94** (the user's Pascal, Chrome 154 on Windows, 1280 x 720, 2026-10-07). The
same rows as above: its cache rows are still the cells ahead, filled as rays go (the report's settings: stepCache 2, 4 M
cells, no fill setting). They are **not** the filled-once rows that 0.33.3 put in. What changed in between, read in git
(1eea9a8..4c78e94): the box fix (0.33.1), the filled-once option (0.33.0, a kernel option that is off in every row
here), and the cells' view (0.32.2, off). GPU ms a sample (march / occlusion):

| scene | codegen | baked | baked, step cache | data, grid, exact | data, grid, exact, step cache |
|---|---|---|---|---|---|
| the optics bench | 238.2 (145.4 / 66.3) | **92.0** (49.2 / 21.9) | 97.6 (53.5 / 21.2) | 285.6 (198.4 / 59.8) | 247.3 (173.3 / 48.2) |
| OpticsBench2 | 107.8 (52.7 / 29.3) | **48.8** (18.7 / 7.9) | 56.0 (23.1 / 9.9) | 149.0 (89.5 / 27.9) | 163.5 (101.4 / 28.0) |
| the Noise library | 203.0 (107.0 / 50.1) | 202.0 (103.5 / 50.6) | **181.3** (100.7 / 38.4) | 265.1 (145.4 / 77.4) | 266.5 (160.1 / 66.0) |
| Surface materials | 59.5 (23.5 / 6.8) | 49.0 (16.7 / 4.9) | 69.9 (33.4 / 8.5) | **41.6** (11.7 / 3.8) | 74.5 (36.8 / 10.6) |
| the showcase | 76.2 (32.8 / 10.1) | **59.5** (20.7 / 7.2) | 79.4 (35.3 / 10.5) | 65.6 (23.9 / 10.8) | 103.1 (53.3 / 17.1) |
| the demo | 65.9 (26.1 / 9.7) | **55.4** (18.7 / 6.9) | 77.8 (36.8 / 11.7) | 895.0 (610.3 / 207.3) | 950.3 (656.1 / 213.2) |
| the Menger cubes | 148.4 (89.0 / 33.6) | **100.5** (55.0 / 19.7) | (none) | 4147.3 (3139.1 / 927.4) | (none) |
| the material test | **43.8** (13.5 / 4.6) | 45.0 (13.6 / 5.2) | 63.3 (29.6 / 9.1) | 54.3 (20.0 / 8.6) | 74.3 (38.2 / 10.9) |

- **Every scene's fastest build is the one the first run found.** Baked is fastest on five scenes. Baked with the cache
  is fastest on the Noise library (11% below codegen). Data with the grid and exact hits is fastest on Surface materials
  (30% below codegen, 15% below baked). On the material test codegen and baked are level (baked +2.7%).
- **Baked against codegen:** the optics bench -61%, OpticsBench2 -55%, the Menger cubes -32%, the showcase -22%, Surface
  materials -18%, the demo -16%; level on the Noise library (-0.5%) and the material test (+2.7%).
- **The lazy cache on the baked build** is again slower on six of seven scenes, from +6% (the optics bench) to +43% (Surface
  materials), and faster only on the Noise library (-10%).
- **The two runs agree:** 32 of 37 rows are within 4% of the first run's. Within this run, the drift row (row 1 again)
  read 241.3 against 238.2 (+1.3%), its march +4.3%. Five rows moved more: the optics bench codegen -6.1% (march 159.0 ->
  145.4), the optics bench as data with the cache -7.6%, the demo as data +6.8% and with the cache +6.3%, and the Menger
  cubes as data -10.6%. Only the last is beyond the 7% that the stepcache run could not call. Inferred: its grid's cells
  are 16.5 m in this run's grid stats, where the first run's were 124 m, because the box fix shrank the marble's box.
  The grid narrows more per cell. It is still 28 times codegen, and the demo as data 14 times.
- **Compiling:** baked was ready sooner where codegen was slow (the optics bench 7.3 -> 3.7 s, OpticsBench2 9.4 ->
  2.2 s). Elsewhere the two are within 0.2 s of each other, at 1.6 to 2.1 s.
- **Still not answered:** whether the cache filled once, own cell, beats the baked build. That is the 0.33.3 rows' question
  (Tests > builds rows 2 and 3, 7 and 8, 12 and 13, 17 and 18, 22 and 23, 27 and 28, 35 and 36).

**The cache filled once on the baked build** (the user's Pascal, those 14 rows only, 0.33.5 · 8d55fc3, 2026-10-07T11:06Z;
no drift row). GPU ms a sample (march / occlusion); filled once, own cell, 4 M cells:

| scene | baked | baked, cache filled once | |
|---|---|---|---|
| the optics bench | 91.4 (49.0 / 22.3) | **72.7** (37.0 / 16.5) | -20.5% |
| OpticsBench2 | 44.5 (17.5 / 7.4) | 45.2 (16.9 / 7.5) | +1.6% |
| the Noise library | 156.0 (79.4 / 35.3) | 181.4 (90.4 / 46.5) | +16.3%, not callable (below) |
| Surface materials | 47.2 (16.0 / 4.8) | 48.2 (15.8 / 5.3) | +2.1% |
| the showcase | 60.0 (21.2 / 7.1) | 55.4 (19.3 / 6.8) | -7.7% |
| the demo | 51.8 (18.0 / 6.5) | 54.7 (20.2 / 7.2) | +5.6% |
| the material test | 42.0 (12.6 / 4.8) | 39.5 (11.9 / 4.5) | -6.0% |

- **It pays on the optics bench (-20.5%), which is now fastest baked with the cache.** The showcase (-7.7%) is at the
  edge of the 7% band. The other four are within it.
- **Smaller than on codegen,** as inferred before the run (the bake makes the SDF cheaper, so a step saved saves less).
  The stepcache run's filled-once own cell against off on codegen: the optics bench -27%, OpticsBench2 -7%, the showcase
  -10%, the material test -6%, the demo +4%.
- **The Noise library cannot be read from this run.** Its baked row has the same kernels as the last run's (fingerprint
  fc735a5d) and read 156.0 where that run read 202.0: 23% less, beyond anything else. Every kernel that holds the scene
  was 22 to 30% faster (march, surface, occlusion), shade 9%. The other six baked rows moved -9% to +1% against the last
  run. Its filled-once row's 181.4 sits between. Inferred: a GPU clock state that differed between the two rows; nothing
  in the code differs (git: index.html alone between the runs). What would test it: rows 12 and 13 alternated, twice.
- **More rays finish in the first march pass with the cache,** in every scene: e.g. Surface materials shaded 1.77 M of
  its 1.84 M camera rays in the first iteration, against 1.56 M baked. A march pass takes at most 32 steps and carries the
  unfinished rays to the next iteration (read in code: wavefront.js MAX_STEPS, raytrace_main.js readWavefrontLog). So
  this means fewer steps a ray. It does not mean a different picture.

## The step cache filled once, read-only (0.33.0; the user: "writing the cache once and then using it in read-only mode during the trace, does that help")

**What changed** (the setting `stepCacheFill`, a kernel option: raytrace_main.js `cacheOnce`):
- **0, as before:** a cell is filled the first time a ray stands in it. The march's own loop does the filling. It costs
  atomics, a trip of the loop, and a stand-in ray.
- **1, filled once:** a pass of its own (wavefront.js `prog_stepcache_fill`) fills every cell before the trace's first
  sample, in a submission of its own, a million cells a dispatch. The march and occlusion kernels then only read the cells,
  through a read-only binding, with plain loads and no fill code in them at all. The pass runs again when what the cells
  were filled for changes, by the same rule that emptied them before (any non-camera uniform, the scene, its data).
- **2, filled every frame:** that pass before every trace. This is what a live edit pays, because each edit frame changes
  a uniform. It is there so the bench can time the pass (its `stepcache_fill` kernel row).

**The fill asks the pick copy of the scene** (no bounding-box culling in it), not the render copy. That answers the
user's "orange glow around objects but also around their boundingboxes". Read in code (codegen.js `culled`): beyond a
node's box margin, the render copy answers with the box's distance. So a cell centre just outside a box got a ball that
stopped at the box. That was a shell one cell thick around every box, drawn orange by the cells' view.

**Counted on lavapipe** (builder/test/stepcache.gpu.mjs, 64 x 36 camera rays, a million cells; steps, not time):

| scene | camera steps, off | lazy, cells ahead, warm | filled once, own cell | filled once, cells ahead |
|---|---|---|---|---|
| the optics bench | 25.7 (21.9 since the box fix of 0.33.1) | 20.4 (before the fix) | 12.7 | 11.2 |
| the optics bench as data | 29.9 | 23.9 | 12.8 | 11.3 |
| ...with exact hits | 6.9 | 17.8 | 11.4 | 10.0 |
| ...with exact hits and the grid | 6.9 | 11.9 | 11.4 | 10.0 |
| the demo | 34.1 | 33.5 | 33.2 | 32.9 |
| the showcase | 19.6 | 17.1 | 15.0 | 14.0 |
| the material test | 26.6 | 20.0 | 16.9 | 14.6 |

Every camera and shadow ray ended as with the cache off (0 of 2304 differing on every row).

Of the cells the march had filled, those whose ball was under a cell (the orange ones): the optics bench 11 925 -> 6 004,
as data 14 640 -> 6 036, the demo 3 040 -> 2 268, the showcase 7 857 -> 4 645, the material test 5 195 -> 2 902.

**Not "never a smaller ball", which was the first test and is false two ways.** Each was checked by marching 4096
directions from the cell to its nearest surface:
- **A shape whose own distance is looser than its box** (the demo's twisted column, about 4.6 m above it). The box gave
  4.16, the twist's distance 3.16, the surface is 4.86 away. Both bounds are sound; the box's is the better one there.
  431 of the demo's 9 837 cells.
- **A box that is wrong** (the optics bench as data). The nested box of the pillar group n13 leaves out its cylinder n22,
  for which the box measurement found no surface. The culled distance was 0.61 where the surface is 0.23 away. That is
  unsound, and the march's own fill inherits it; the filled-once cells do not. 20 of 48 544 cells. The fix is the box
  measurement's (0.33.1).

**The box fix (0.33.1), measured on lavapipe.** The coarse search had widened three times, to 35 m cells, and the
measurement kept only the widest search's points. The cylinders found by the first search (4.4 m cells) were then looked
for over their guess padded by 1.5 of those cells: a 113 m lattice of 2.9 m cells, where they were not found. Now each
node keeps the points of the finest coarse lattice that found it. A node found by none is looked for from the first
lattice's cell. Objects with no box, before -> after: the optics bench 24 -> 4 (inside the shell group, whose own box
holds them), the Noise library 6 -> 1, the Menger cubes 3 -> 2 (hidden), OpticsBench2 57 -> 47 (hidden groups and
cuts). A safety net too: a group with a part that could add surface and found none gets no culling box (boxes.js
`B.missing`). On the eight bench scenes no group is refused by it.

**What to read on the card:** Tests > stepcache, each scene's two "filled once" rows against the lazy rows with the
same looks. Their march and occlude times are what reading costs without atomics, plus what the fuller cells save. The
"every frame" row's `stepcache_fill` time is the price of an edit frame. Inferred, untested: on a baked build, where the
SDF is cheap, the fuller cells may still not pay for the lookups. The builds bench has no filled-once row yet; it gets
one if the stepcache run says it is worth it.

**Measured on the Pascal** (the user's stepcache run of 0.33.1 · 4c78e94, 1280 x 720, GPU ms a sample, all kernels;
in brackets march / occlude; cells ahead at 4 M cells):

| scene | cache off | as rays go, own cell | as rays go, cells ahead | filled once, own cell | filled once, cells ahead | fill a frame |
|---|---|---|---|---|---|---|
| the optics bench | 217.6 (131.0 / 60.4) | 194.2 (120.6 / 46.7) | 171.9 (104.8 / 42.1) | **158.7** (95.0 / 39.4) | 160.1 (95.7 / 39.8) | 3.3 |
| OpticsBench2 | 96.7 (50.3 / 23.3) | 101.1 (53.1 / 24.7) | 100.2 (52.2 / 24.0) | 89.8 (45.5 / 21.6) | **86.7** (45.5 / 18.4) | 1.7 |
| the demo | **61.9** (25.0 / 8.6) | 72.6 (33.0 / 11.1) | 81.8 (40.6 / 12.9) | 64.4 (26.5 / 9.3) | 68.8 (30.7 / 9.7) | 0.3 |
| the showcase | 71.5 (29.9 / 9.7) | 72.9 (32.9 / 10.3) | 78.4 (37.0 / 11.0) | **64.7** (26.1 / 8.5) | 73.2 (31.0 / 10.2) | 0.5 |
| the material test | 44.0 (13.5 / 5.5) | 53.2 (22.2 / 6.8) | 60.3 (27.9 / 8.6) | **41.5** (12.8 / 4.8) | 48.0 (16.8 / 6.8) | 0.2 |
| the optics bench as data, grid, exact hits | 248.5 (169.5 / 55.0) | 219.1 (149.7 / 45.7) | 214.5 (145.8 / 44.8) | 214.3 (147.1 / 44.3) | **201.2** (137.6 / 39.3) | 26.1 |

How much two rows of the same kernels differ: the drift row, row 1 again, 218.2 against 217.6 (+0.3%); the "every frame"
rows run the filled-once kernels again, and their march was within 6.5% of the filled-once row's in every scene (89.5
against 95.7 on the optics bench, the widest). So a difference under about 7% is not one this run can call.

- **Filled once beats as rays go in every scene, same looks:** own cell 11 to 22% below on five scenes (2% on the optics
  bench as data, within the band); cells ahead 6 to 20% below.
- **Against the cache off,** the better filled-once row: the optics bench -27%, the optics bench as data -19%,
  OpticsBench2 -10%, the showcase -10%, the material test -6%, the demo +4% (the last two within the band). As rays go,
  the cache was no faster than off on four of these six scenes; filled once, slower on none beyond the band.
- **The own cell is the better look on four of six** (the optics bench level, the showcase, the demo, the material test);
  the cells ahead on OpticsBench2 and the optics bench as data. Inferred: two more reads a step cost more than the
  longer exits save where the cells near surfaces are dense. What would test it: the lavapipe count of steps against
  reads, per scene.
- **What an edit frame pays** (the `stepcache_fill` kernel, 4 M cells): 0.2 to 3.3 ms on codegen scenes, 0.4 to 2.1% of
  their frame; 26.1 ms (11%) on the optics bench as data, whose fill walks every record with no culling and no grid.
- **The "every frame" rows' GPU span holds an 11 to 63 ms idle gap** between the fill's submission and the sample's,
  where the other rows have under 0.5 ms. Their wall clock is not longer than the filled-once rows' (the demo 134.7 against
  134.6, the showcase 132.9 against 139.1), and every row of these scenes already has 13 to 70 ms of wall clock beyond its
  GPU time. Inferred: that idle time existed before and now falls inside the span, between two submissions. What would
  test it: the fill in the sample's own submission, and the gap gone.
- **Compiling:** the fill kernel was ready at 0.4 to 4.0 s and was never the build's slowest kernel (that was surface,
  shade or occlude); the filled-once builds took between 11% less and 9% more than the lazy ones, either way.
- **Not answered by this run:** whether filled once beats the baked build without a cache, which the builds run said is
  the fastest build on five of eight scenes. Codegen here; the bake makes the SDF cheaper and so the saving smaller.

## The closest object per cell, counted (0.33.3; the user: "storing the ID of the SDF it needs to evaluate for cells close to a surface")

**The idea:** a cell filled once keeps, beside its ball, the top-level node A its nearest surface belongs to and dRest,
the nearest of all the others at its centre. At a point p in the cell no other node is nearer than dRest - |p - c|, so
where that still clears A's own distance at p, A alone answers the step: one node, no box test. Where it does not, the
scene is asked as now. Sound by the same rule the balls rest on.

**Counted on lavapipe** (builder/test/cellobject.gpu.mjs: each top-level node's distance from a scene of that node
alone, the march's rules simulated on the CPU; 64 x 36 camera rays from the bench camera, shadow rays from their hits; a
million cells). Three marches along the same rays: *plain*, the scene as codegen marches it, culled by its measured
boxes; *cache*, filled once, own cell; *object*, the cache and A alone where it answers. Per camera ray:

| scene | nodes evaluated a scene call (plain / cache) | node evaluations, cache -> object | box tests, cache -> object | scene calls, cache -> object (+ A alone) |
|---|---|---|---|---|
| the optics bench | 0.53 / 0.85 | 5.0 -> 3.5 | 47.4 -> 21.4 | 5.9 -> 2.7 (+3.3) |
| OpticsBench2 | 0.45 / 0.91 | 6.8 -> 6.7 | 29.8 -> 4.2 | 7.4 -> 1.0 (+6.5) |
| the demo | 1.03 / 1.02 | 33.5 -> 32.9 | 230.2 -> 220.4 | 32.9 -> 31.5 (+1.4) |
| the showcase | 0.22 / 0.30 | 3.3 -> 3.2 | 143.1 -> 100.8 | 11.0 -> 7.8 (+3.2) |
| the material test | 0.33 / 0.69 | 6.6 -> 6.6 | 38.1 -> 11.5 | 9.5 -> 2.9 (+6.6) |
| the Noise library | 0.29 / 0.38 | 5.4 -> 5.0 | 197.6 -> 134.7 | 14.1 -> 9.6 (+4.7) |
| Surface materials | 0.24 / 0.30 | 3.9 -> 3.6 | 180.1 -> 132.2 | 12.9 -> 9.4 (+3.5) |

Shadow rays the same way: node evaluations 0 to 15% fewer but the optics bench's 29% (3.8 -> 2.7). Moves unchanged. A
answered nearly every time it was asked (the optics bench 3.2 of 3.3 a camera ray). Every ray of every way ended where
plain's does, and no A-alone step said more than the least of all the nodes' own distances.

- **Near surfaces the boxes already leave one node to evaluate, or none.** A scene call evaluates under one top-level node
  on six of seven scenes, and about one on the demo, whose open ground plane has no box and so is evaluated at every
  call. So A alone cannot save the evaluations it was meant to: 30% of them on the optics bench, 0 to 8% elsewhere.
- **What it would save is box tests** (27 to 86% of them on six scenes; 4% on the demo) and the rest of a scene call
  around the one node evaluated: every top-level node's box test, the folds.
- **The demo hardly uses the cache** (moves 34.0 -> 33.2). Inferred: its rays spend their steps over the open ground
  plane, outside the cache's box (the solids' boxes joined, which the plane is not among). What would test it: the
  share of its camera rays' steps taken outside that box.
- **The optics bench's plain march** took 21.9 steps a camera ray on the current code, 25.7 before the box fix of 0.33.1
  (lavapipe, the step-cache GPU test both times): the boxes measured from finer lattices are tighter, and the culling
  steps further.

**Not built.** The gate was "if the count is worth it". For node evaluations it is not, on these scenes; for box tests,
whether they cost enough to matter is not known: a box test is a point taken through the node's transform and a box
distance, read in code (codegen.js culled, scene_api.js cullDist), and what that costs against a node's evaluation only a
card can say. What would test it, cheaply: the same scene built with its boxes set so that none ever culls, against it
built without boxes -- the same evaluations, the difference the box tests -- on the scene with the most nodes (the Noise
library or Surface materials, 14).

**That test is Tests > boxcost (0.33.4, bench/boxcost.js):** the Noise library and Surface materials (14 box tests each in
their generated text), the demo (8) and the showcase (13), each with its boxes off, with boxes that never cull (each set
to hold everything, 1e30 a side, known: every box tested, every node evaluated), and with its boxes measured. *Never
cull* minus *off* is the box tests; *never cull* minus *measured* is what the culling saves. One thing it leaves out:
every invocation takes the same branch when no box culls, so what diverging on a box test costs is not in the
difference (inferred from the code's shape).

**Measured on the user's Pascal** (Tests > boxcost, 0.33.5 · 8d55fc3, 2026-10-07T11:11Z). GPU ms a sample (march /
occlusion):

| scene | boxes off | boxes that never cull | boxes measured | the box tests (never - off) | culling's saving (measured - never) | measured against off |
|---|---|---|---|---|---|---|
| the Noise library | 734.7 (555.6 / 124.0) | 816.1 (611.9 / 145.4) | **188.9** (99.7 / 45.9) | +81.4 (+11%) | -627.2 (-77%) | -74% |
| Surface materials | **50.8** (18.8 / 5.1) | 67.0 (31.8 / 7.9) | 56.0 (22.2 / 6.4) | +16.2 (+32%) | -11.0 (-16%) | +10% |
| the demo | 65.7 (28.7 / 9.9) | 86.2 (42.1 / 15.8) | **60.8** (25.0 / 8.7) | +20.5 (+31%) | -25.4 (-29%) | -7.5% |
| the showcase | **62.1** (25.1 / 7.4) | 84.9 (41.4 / 11.9) | 66.4 (27.7 / 9.0) | +22.8 (+37%) | -18.5 (-22%) | +7% |

The drift row (the Noise library's boxes off, again, at the end) read 778.7: +6.0%. So the Noise library's +11% may be
partly drift. The others are far beyond it. The demo's never-culling row tests one box more than its measured row: the
open ground's, which the measured row skips (no box: cullDist returns at once, read in code).

- **The box tests are dear where the shapes are cheap:** with every box tested and none culling, a third more GPU time on
  Surface materials, the demo and the showcase. March is +47 to +69%. Occlusion is +55 to +61%.
- **So on those three scenes the boxes buy little or nothing:** the measured boxes against none are +10% (Surface
  materials), +7% (the showcase), -7.5% (the demo). They are at or past the 7% band either way. The culling does save
  work, 16 to 29% against the never-culling row. The tests cost about as much as that saves. On the Noise library,
  whose reliefs are dear, the boxes save 74%.
- **Why, read in code** (Surface materials' SDF as generated): a top-level node there is one shape, a rounded box or a
  sphere. Its box test is `xfPoint` and `cullDist`, a box distance. The node's own evaluation is `xfPoint` again and
  `NboxRounded`, also a box distance. The test costs about what it could save. Whether Tint shares the two `xfPoint`
  calls is not known.
- **What it says about the closest object per cell:** box tests are worth removing on scenes like these. That is what
  the closest object per cell would do in the cells where it answers: 27% of Surface materials' box tests, 30% of the
  showcase's, 4% of the demo's (the lavapipe count above). There is a simpler way to the same end that this run points
  at, not tested: no box test for a node no dearer than its box (one plain shape), a box test only for the dear ones
  (reliefs, groups, code with noise). What would test it: a fourth row per scene in Tests > boxcost, boxes on the dear
  nodes only.
- **Against the earlier benchmark runs:** on the Ampere (runs 4 and 5, PERFORMANCE.md) culling read -3 to -13% on these
  scenes against boxes off. That was another card, and before the box fix of 0.33.1. Here it is +10% to -7.5%. Either way
  it is small next to the Noise library's.

**That fourth row is in Tests > boxcost (0.33.8): boxes on the dear nodes only.** Each scene is made with a box test only
where a top-level node is dearer than its box (codegen.js, ONLY THE DEAR ONES; the generation option `cull: 'dear'`, which
only the bench sets). A node counts as one plain shape, and gets no box test, when it is an object whose code is one call
of a shape with an answer along the ray (analytic.js ANALYTIC, builder/plainshape.js PLAIN_SHAPES since 0.41.0: no loop, no noise; an outline's revolve or extrude walks its
pieces and is not one) and whose material has no relief, or a light's face. Every group keeps its box. What that leaves,
read off the generated text in node: the Noise library 6 box tests of 14 (its relief groups), Surface materials none of 14
(so its row is the boxes-off scene timed again), the demo 6 of 8, the showcase 2 of 13. Whether a lens or a frustum costs
more than its box test is not known: the bench scenes' plain shapes are spheres, rounded boxes and cylinders.

**Measured on the user's Pascal** (Tests > boxcost, 0.33.8 · 376bfcb, Chrome 154 on Windows, 1280 x 720,
2026-10-07T12:31Z). GPU ms a sample (march / occlusion), and against boxes off:

| scene | boxes off | never cull | boxes measured | dear nodes only |
|---|---|---|---|---|
| the Noise library | 787.3 (597.2 / 132.7) | 867.0 (652.8 / 150.9), +10% | **207.6** (111.2 / 51.0), -74% | 219.3 (112.3 / 59.8), -72% |
| Surface materials | **52.3** (19.7 / 5.0) | 74.0 (34.5 / 8.7), +41% | 56.7 (22.9 / 6.4), +8% | 54.1 (20.3 / 5.4), +3% (the same text as boxes off) |
| the demo | 71.2 (30.7 / 10.4) | 92.5 (45.8 / 16.4), +30% | 66.3 (27.0 / 8.8), -7% | **65.6** (26.4 / 9.1), -8% |
| the showcase | 71.0 (28.9 / 8.0) | 89.1 (43.7 / 12.3), +25% | 77.6 (32.0 / 10.5), +9% | **67.2** (26.9 / 8.2), -5% |

How much two rows of the same kernels differ in this run: the drift row (row 1 again) 795.4 against 787.3 (+1.0%), and
Surface materials' dear row, the boxes-off text timed again, 54.1 against 52.3 (+3.4%). Against the run of 0.33.5 the same
rows read 7 to 14% higher (the showcase off 71.0 against 62.1), so only rows within one run are compared here.

- **Dear only is the best box mode, or level with it, on all four scenes.** It keeps nearly all of the boxes' saving on the
  Noise library (-72% against -74% measured; the 5.6% between the two is within what this run can call, its occlusion 17%
  higher). It is the boxes-off scene on Surface materials. It beats every box tested on the showcase (-13.4% against
  measured), and is level with it on the demo (-1.1%).
- **The never-culling rows again cost a quarter to two fifths more** on the three plain-shape scenes (+25 to +41%), as in
  0.33.5 (+31 to +37%).
- **A second cost of a box, besides its test, counted in the wavefront log:** the rays that finish in the first march pass.
  Read in code (codegen.js culled): a node skipped by its box is stood in for by its box's distance, and the step is never
  longer than that. On a plain shape that is a shorter step than the shape's own distance would give. With every box
  measured, the first pass finished fewer rays than with none on Surface materials (1.56 M against 1.78 M), the showcase
  (1.62 M against 1.78 M) and the demo (1.37 M against 1.43 M). On the Noise library it is the other way: 1.54 M against
  1.10 M. A relief group's own distance is divided by its slope bound at every point (read in code: its group code in
  bench/scenes/noise.json, `/ slope`), and the box gives the longer step there. Dear only
  takes the better of the two on each node: 1.74 M on the Noise library, 1.74 M on the showcase. Inferred: that is the
  showcase's 13% over the measured row, beyond its 2 of 13 box tests' own cost. What would test it: the step count a ray
  (builder/test/cellobject.gpu.mjs counts them on lavapipe) on the showcase with boxes measured and dear only.
- **What it settles:** a box test for a plain shape costs more than it saves on every scene measured, in the test and in
  the step; a box on a dear node pays for itself many times over. Not yet the default: the builder still makes every scene
  with all its boxes or none (the renderer's `cull`).

**Again, on 0.33.9 · d253a06** (the user's Pascal, the same Chrome 154 on Windows, 1280 x 720, 2026-10-07T12:42Z; the
same code as the run above apart from the version and this document, read off `git diff 376bfcb d253a06`). GPU ms a sample (march / occlusion), and against boxes off:

| scene | boxes off | never cull | boxes measured | dear nodes only |
|---|---|---|---|---|
| the Noise library | 791.2 (601.2 / 131.8) | 867.5 (653.2 / 152.6), +10% | **208.5** (110.3 / 52.9), -74% | 220.5 (114.0 / 58.2), -72% |
| Surface materials | **51.8** (19.9 / 5.0) | 73.5 (34.3 / 8.7), +42% | 56.4 (22.4 / 6.2), +9% | 53.9 (20.5 / 5.4), +4% (the same text as boxes off) |
| the demo | 73.4 (31.3 / 10.2) | 94.8 (45.3 / 16.6), +29% | **67.8** (26.7 / 9.3), -8% | 68.2 (26.9 / 9.1), -7% |
| the showcase | 69.9 (28.2 / 8.1) | 86.2 (42.1 / 12.0), +23% | 76.2 (32.4 / 10.1), +9% | **64.9** (25.5 / 8.1), -7% |

- **Every row within 4% of the first run** (the Noise library +0.1 to +0.5%, Surface materials -0.4 to -1.0%, the demo
  +2.3 to +4.0%, the showcase -1.5 to -3.4%); the drift row 788.5 against 791.2 (-0.3%). Within this run, Surface
  materials' dear row, the boxes-off text again, reads +4.1% (+3.4% in the first): two timings of one text differ by about
  that much, so a difference under 4 or 5% between two rows of one run is not one this test can call.
- **Dear only against every box measured, this run (the first):** the showcase -14.8% (-13.4%), Surface materials -4.4%
  (-4.6%), the demo +0.6% (-1.1%), the Noise library +5.8% (+5.6%). The showcase's is well outside the noise, twice. The
  Noise library's is at its edge, but the same sign and size twice, and its occlusion higher both times (58.2 against
  52.9; 59.8 against 51.0). The demo's is level.
- **The rays the first march pass finished agree with the first run's within 0.08% on every row** (read off both runs'
  wavefront logs: the Noise library 1,538,187 measured and 1,742,950 dear; the showcase 1,778,514 off, 1,620,803
  measured, 1,740,361 dear), so the step-length reading above stands as it was: an inference, with its test named.
- **So, replicated:** dear only wins the showcase by about 14% and Surface materials by about 4%, is level on the demo, and
  costs about 6% on the Noise library against every box measured, where it still saves 72% against none. Which of these
  becomes the builder's way is the user's decision, not this run's.

**Made the builder's way (0.34.0; the user, 2026-10-07: "yes, make dear-only the default and remove the setting").**
- **Codegen's `cull` is `'dear'` by default** (codegen.js emitScene). `'all'` (a box test on every top-level node that
  draws something, as before) and `false` (none) are the bench's alone: Tests > boxcost's rows and the "bounding boxes
  off" rows. `true`, which the builder passed for every box until now, is refused by name rather than read as either.
- **The renderer's setting `cull` ("Skip far objects (bounding boxes)", Renderer > Performance) is gone.** A saved
  workspace that has it opens with a console line naming it ignored (index.js applySettings, index.html).
- **Unchanged:** a scene as data. Its records' walk tests a box wherever a record has one, every node under plain groups.
  What a box on a plain record costs as data was not measured. Inferred, and not tested: the same two costs apply there
  (the test, and the shorter step). What would test it: boxcost's four rows as data. The page still measures every box:
  the records, the candidate grid (until 0.41.0) and the step cache's box are made from them all.
- **What moves in the other benches:** every codegen row made by bench/index.js sceneOf with its default (and the
  baked rows, made from codegen's text) now has boxes on the dear nodes only. Read in code, not measured: that is the
  text boxcost's dear row timed, so the Noise library's codegen rows should read about 6% higher than before 0.34.0, and
  the showcase's lower. The as-data rows' texts did not change.
- **The golden shaders refrozen** (builder/test/fixtures/csg-v10/golden.mjs says how it was checked): with every box,
  all 44 fingerprints as frozen; with the default, only the plain shapes' box tests and their uniforms left the texts.
- **Seen, by the user (0.34.0 · 2b25789, 2026-10-07):** the showcase, the demo and the Noise library "look the same,
  nothing missing"; Renderer > Performance has no "Skip far objects" row; a saved project loads.

## Removed in 0.41.0 (the user, 2026-10-08)

Asked after a review of where the performance work stood: "Remove the stepcache 0 option. Remove the exact hits code.
Remove the candidate grid." Each was a developer's option, and each had been measured on the user's Pascal as no general
gain. The sections above keep the runs; this says what went and what decided it.

- **The step cache's lazy fill** (`stepCacheFill` 0, the cache's default fill until now): a cell filled by the march on a
  ray's first visit, with atomics, a fill trip of the loop and a stand-in ray. In the stepcache run of 0.33.1 the cells
  filled once by a pass of their own were faster than the lazy fill on every scene, same looks -- 6 to 22%, but the own
  cell on the optics bench as data, 2%, within the run's noise -- and the lazy fill was no faster than the cache off on
  four of six (*The step cache filled once, read-only*); on the baked build it was
  slower than off on six of seven in both builds runs. Now the cache is filled only by `prog_stepcache_fill`, and the march
  and occlusion only read the cells. `stepCacheFill` keeps 1 (when what the cells were filled for changes; the default
  now) and 2 (every frame); a saved 0 fills as 1. The kernel option `cacheOnce` is gone: on, the cache is always the
  read-only kernels and the fill pass.
- **Exact hits** (`sceneExact`, `builder/analytic.js`, the `SCN_MARCH`/`SCN_EXACT` protocol, the march's moves onto a
  surface, the ray's object list `listMax` and the solids' table after the records). The fastest build on one bench scene
  of eight (Surface materials, as data with the grid: 41.6 ms a sample against baked 49.0, builds run of 0.33.1); 12.6 to
  13.6 and 28 to 30.5 times codegen's GPU time a sample on the demo and the Menger cubes (the two builds runs); with the step
  cache, more steps a camera ray, counted on lavapipe (6.9 -> 11 to 18). And the
  picture with them was never confirmed right (step 3: "exact hits that look right", not built). What stayed:
  `builder/plainshape.js`, the list of closed-form shapes and the parse that recognises one, which codegen's dear-only
  boxes rest on (*That fourth row*): the same 16 shapes and the same rule, now named for what they decide.
  **What it cost, seen by the user (0.40.1, 2026-10-09):** in the prism scene, a slit light's beam grazing the floor at 0
  to 0.5 degrees was drawn only with exact hits; baked, as code and as data without them it vanished. Inferred there, not
  counted: marching by distance closes in on a surface met at angle theta by about (1 - sin theta) a step, so a grazing
  photon runs out of steps. 0.40.1 made the bake stand aside while exact hits were on (`BUILDER.bakeBlocked`); asked
  again after it, the user kept the removal, and that rule went with exact hits. What would draw such a beam now is not
  built: a march that does not run out of steps along a surface, or codegen with answers along the ray.
- **The candidate grid** (`sceneGrid`, `builder/grid.js`, `builder/regrid.js`, the facade's `sceneEval` and
  `writeSceneData`, the engine's `_sceneEval`). Slower than no grid on four of seven scenes (0.20.3); flat with the number
  of copies, but under about 20 copies slower than the plain walk (the scaling run of 0.22.10, step 4).

**What is not known, and changes:** nothing here was timed on the card after the removal. Read in code: codegen's and the
plain data walk's march and occlusion are what they were with the options off -- the march's step is `stepscale` of the
distance again, its text without `SCN_MARCH`; the records' walk is the culled walk, every copy of the scene reading its
records from the uniform copy (`scnRecs`) where a grid or exact-hits scene read the storage buffer. The step cache's kernels
are the filled-once kernels they were. Counted on lavapipe after the change (builder/test/stepcache.gpu.mjs, a million
cells, 64 x 36 camera rays): every camera and shadow ray ends as with the cache off on the four codegen scenes and the
optics bench as data; camera steps with the cells ahead: the optics bench 21.9 -> 11.3, the showcase 15.9 -> 13.7, the
material test 23.3 -> 14.5, the demo 33.4 -> 32.5. The builds, stepcache, scenedata and scaling benches lost the rows that
timed what went (their data rows are now plain data, not comparable with earlier runs' data rows); boxcost, bake and
overhead are unchanged.

