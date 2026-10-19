# Blank reader: "From scene tree to shader" (ch. 24)

## 1. Teach-back

The builder keeps the scene as a tree, but the graphics card needs it as a program, so ShadyTracer writes the program. Turning program text into something the card can run (compiling) takes seconds, so what matters is which edits change the text. There are three ways. With **uniforms**, every number is read from a buffer, so moving or resizing a shape just writes a number, but adding a shape adds a line and means a compile. With **baked**, the numbers are written into the text as constants. That runs faster (up to 68% faster on one scene), but every change is a compile, so ShadyTracer bakes only once you stop editing. With **data**, there is one fixed loop over a list of records, so adding a ball only adds a record. The catch is that the loop is slower to run, 3 to 9 times slower on most scenes. Compile time follows a kernel's size with every function call written out (inlined), not its text, so calling SDF from 4 places costs about 4 times as much, and the cost grows faster than the size.

## 2. Quiz

1. A uniform is read at run time (`UB.pos_c`). Changing it writes the buffer and nothing compiles. A baked value is a constant in the text (`const bk_pos_c = …`). The compiler can fold it, so the kernel runs faster, but changing it means new text and a compile.
2. **Code with uniforms:** a structural edit needs a compile: a shape added, moved to another group, or given another material (a material is a name in the text). Moving a shape, resizing it or changing the blend does not. **Baked:** every change needs one, except the values kept live (animated values, culling boxes, and values no literal can hold).
3. The text is one loop over records. A ball is one more record (kind, join, numbers) written into a buffer, so the text does not change. You need a compile when you add a shape of a kind the loop has no code for ("a shape whose code the loop does not hold is new text still"). Switching to data is also a compile.
4. It is the kernel's length with every call replaced by the function's body. Compilers inline nearly every call, so SDF called from 4 places is compiled 4 times. Compile time follows the inlined size (33% error, against 366% for the text) and grows a little faster than linearly.
5. Data marches 3.1 to 9.4 times slower on most scenes, and only the biggest scene was faster (0.83). Each record is read from memory and the page infers that each read waits for the last. So data is a developer switch, off by default.

## 3. Where I got lost (worst first)

1. **The numbers don't add up.** Figure 2 says 40 objects called from 4 places compile in "0.22 s" and 400 objects in "5.18 s". But the bundled scenes "of 2 to 14 objects" took "3.7 to 23 s", on the newer Ampere card. Fewer objects, a newer card, and 100 times slower? The page never says what a real kernel holds that the figure's 40 objects don't.
2. **Section 3's first excerpt.** `XF_M`, `XF_S`, `XF_P` ("keep the frame for normals and materials"), `XF_SUB -= 1u` (not explained at all), `select(km_hs, C.m, -C.s.w > k_hs.w)` (why `-C.s.w`?), and the names `hsb` and `hs` all stayed closed to me. The excerpt is "a sphere", but the figure has circles.
3. **The baked paragraph:** "every shape's point is moved into its own frame by a matrix … so it may drop those products". The page never explains matrix, frame or products. I only followed it from *outside knowledge*.
4. **"Data costs a step."** I didn't know what a "step" is, nor "warps", "Menger cubes" or "keeps frames for". "Since where the next record is, is in this one" doesn't match figure 1's loop, which just does `i++`. "Not more work a ray … 11.4 records a step" gives me nothing to compare with.
5. **The basics are assumed.** The page never says what a scene's "distance" is, what "the march" is, or why "the normal's differences" are "four calls". "Blended by k" doesn't say what a blend looks like. I needed chapters 2–4, or *outside knowledge*.
6. "A loop's 32 (another 32) unrolled": is that the lens's 32 again, or a different 32?

## 4. Words and symbols

- **The cards that helped:** kernel, compile, uniform, bake and record were all clear. The "measured" card explained Pascal and Ampere.
- **WGSL:** the card helped, but "WebGPU" is never explained.
- **SDF:** spelled out only in section 2, and its meaning never given (*outside knowledge*).
- **UB:** never expanded. I guessed "uniform buffer".
- **"uniform buffer":** used in section 1 with no card. The buffer card only comes in section 4.
- **No cards for:** `vec2<f32>`, `f32`, `0u`/`1u`, `csgUnion`/`csgSubtract` (I guessed the meaning from the words), `sdBox`, march, normal, matrix, frame, "culling boxes", "sample", KiB, "storage buffer" in section 3.
- **"rms":** used in section 2 but explained only in the caption of a later code excerpt. "Typical error" helped.

## 5. Figures

**Figure 1 (the three ways):** this is clear and the best thing on the page. The counters ("Code with uniforms: 2 · Baked: 2 · As data: 1") and the status line ("the text changed: a compile" / "the same text: the values written, no compile") make the point without the prose. Confusing parts:
- The csg lines end in "…", so I never see `UB.k_g`, though the text and section 3 quote it.
- The letters b, c, h, e are never mapped to the labels.
- The record columns `kind` and `join` hold 0s and 1s that I had to decode from the code.
- The numbers are formatted unevenly ("0", "1", "1.05").
- In the move screenshot the labels "the block a ball" overlap.
- Baked's red line `bk_pos_c` shows nicely that a move changed one constant, but the text never points to it.
- The first compile shows no red lines. That makes sense, but nothing says so.

**Figure 2 (compile time):** clear. Red is the model, dashed is the straight line, and the dot is this kernel. In fig-2-big the crossing near 2 places is visible. The readouts match the formula: I checked 27,020 → 0.22 s against 0.41 s, and 273,500 → 5.18 s against 4.16 s. Confusing parts:
- The one-place readout says "text 6,795, inlined 6,794". If inlining only writes more out, how can it be smaller?
- "1 copies".
- The y-axis rescales between screenshots without comment.

## 6. Maths fold-outs

The page has none. With a calculator I could follow the inline formula, `15.2 ms × (size ÷ 1000) × (size ÷ 151,000)^0.37`, though a power of 0.37 is at the edge of school maths. The code's form, "0.736 × the linear prediction to the power 1.37", is the same model, but the page never shows that. I could check it only with algebra of powers that I found by working it out (*outside knowledge*).

## 7. The code

- **Codegen excerpt:** the caption made `xfPoint`, `radius`, `matid_white` and `csgSubtract` clear. The rest stayed opaque (see 3.2).
- **bake.js:** the caption gave the gist: loop over the uniforms, bake unless live, rename `UB.x` to `bk_x`. Explaining `{ live = () => false } = {}` was helpful. The regex, `Object.defineProperties` and the "NO BODY" comment (probes, line map, prelude) were beyond me.
- **scenedata.js:** a readable prose comment. This was the clearest.
- **compileprogress.js:** readable until "the shorthand the compiler is given", `SIZE_REF` and "the power GROWTH - 1". One useful fact is only here: kernels compile in parallel, so a build takes as long as its largest kernel. It should be in the prose.

## 8. Too much, too little

- **Repeated:** "3.7 to 23 s … Ampere" appears twice (sections 1 and 4).
- **Too dense:** section 4's stamps are walls of numbers. The bench names (optics bench, Noise library, Menger cubes) are meaningless to me.
- **Too little:** what an SDF is (one sentence), why data is slower (one inferred sentence), and how a figure kernel compares with a real one.

## 9. Wrong or contradictory

- Figure 2's sub-second predictions against the 3.7–23 s real builds (3.1).
- The blend has three names: figure 1's `k_g` for "the group", section 3's `UB.blend_hs`, and a `k` in every record in the data view.
- "Where the next record is, is in this one" against the figure's `recs[i]` with `i++`.
- "Inlined" (6,794) is smaller than "text" (6,795).
- The bake card says baked "runs faster". Section 4 says the Noise library was 5% slower. The paragraph's "mostly" saves it, but the card doesn't.

## 10. The five changes

1. **Reconcile figure 2 with the real build times.** Say what a real kernel holds beyond the figure's objects (the shape code, the materials, more call sites, several kernels) and why the Ampere numbers are larger.
2. **Open with a three-line recap:** an SDF answers "how far is the nearest surface?", the march calls it at every step, and the normal calls it 4 more times. Name what "step" means in section 4.
3. **Cut or annotate section 3's first excerpt.** Keep `xfPoint`, `radius`, `matid_white` and `csgSubtract`. Explain or drop `XF_*`, `XF_SUB`, the `select` test and the `hsb`/`hs` names.
4. **Give the matrix argument one plain sentence,** or replace it with the "×1 / +0" example only. Show why data reads wait on each other, and how that differs from the figure's simple loop.
5. **Make figure 1 self-explaining:**
   - Wrap long lines so `UB.k_g` shows.
   - Map b, c, h, e to the labels.
   - Label the kind and join codes.
   - Say what `UB` stands for.
   - Define rms where it is first used.
