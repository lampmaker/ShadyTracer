# Blank-reader report: "From scene tree to shader" (ch. 24)

## 1. Teach-back
The builder stores a scene as a tree, but the graphics card needs it as a program text (WGSL). There are three ways to write that text. **Code with uniforms**: each shape and join is a line of code, and every number (position, size, blend) is read from a buffer, so dragging a shape only writes new numbers and nothing compiles; adding a shape changes the text, and compiling takes seconds. **Baked**: the numbers are written into the text as constants. The compiler can then simplify, so it runs faster (the march went from 189.7 to 61.2 ms on one scene), but every change, even a drag, means compiling again. So ShadyTracer bakes in the background once you stop editing. **As data**: the text is one loop that reads a list of records, so adding a shape just adds a record, but each step is 3 to 9 times slower on small scenes. Compile time depends on the kernel's size with every function call written out ("inlined"), not on its text: calling SDF from four places makes four copies, and the time grows a bit faster than the size. Hidden copies in the past (a material lookup, a loop that was "unrolled") made compiles take minutes.

## 2. Quiz
1. A uniform is read from a buffer while the program runs, so changing it means writing a number with no compile. A baked value is a constant in the text: it is faster, but a change means new text and a compile.
2. With uniforms, only structural edits need a compile (a shape added, moved to another group, given another material); drags and the blend do not. With baked code, every edit does. The bake.js caption says animated values stay uniforms.
3. The shader is a fixed loop over records, so a new shape is a new record in a buffer and the text stays the same. The page's own scenedata.js comment limits this, though: only "an edit that adds no new code". A shape with new code would still compile, so "never" goes too far.
4. It is the kernel's length with every call replaced by the called function's body. Each call site adds a full copy of the scene, and the time grows like size^1.37. I only half got *why* compilers inline (*outside knowledge*).
5. Its loop costs more per step (3.1 to 9.4 times as long on small scenes; faster only on the biggest, at 0.83). The page never says *why* reading records is slower.

## 3. Where I got lost (worst first)
- **"15.2 ms for every 1000 inlined characters at about 151,000"**. I could not parse "at about 151,000". Only the compileprogress.js comment later explains that the two fits agree there.
- **"The bake, whole:"** This shows five lines: a comment and a function header with no body. "Whole" made me think something was missing.
- **The 58-line WGSL excerpt.** `XF_SUB += 1u`, `VEC4(0.0, 0.0, 1.0, 1.0e7)`, `MAT_AIR`, `emptyHit(r)`, `select(km_hs, C.m, -C.s.w > k_hs.w)`, `cullMargin()`, `[3].w`. Culling is chapter 26, which comes *after* this one. Nothing ties this code to the five-line version in figure 1.
- **"The compiler can fold constants into the arithmetic … loses its matrix products"**. I don't know "fold" or matrices, and figure 1 has no matrices (*outside knowledge*).
- **Section 4's last stamp:** "a uniform buffer of 4096 vec4s, the 64 KiB … room for 585 records … the storage buffer". Storage vs uniform buffer, vec4 = 16 bytes and 7 vec4s per record are all *outside knowledge*.
- **Names never introduced:** the lens assembly, the optics bench, the Menger cubes, the Noise library, "the die's pips", "before step 5", "the demo".
- **"uncached"**: nothing says a compiled program can be kept.
- **The compileprogress comment:** "24 kernel x scene pairs", "rms error 33%", "Chrome 154, code 6b54026", "SIZE_REF", "GROWTH - 1". It is dense, and rms is *outside knowledge*.

## 4. Words and symbols
- **Undefined on this page:** SDF (it labels figure 2's axis), "the scene's distance", join, csgUnion/csgSubtract, UB, inline, fold, march, "a step", normal, Hit, frame, culling, unrolled, noUnroll, f32, `1u`, rms.
- **The cards for uniform, bake and record helped**, and the bake card is the clearest statement of the trade-off.
- **kernel, compile and WGSL are not marked in the prose.** They appear only in the end list, although "kernels" and "WGSL" come in the first paragraph. The kernel card adds "sample", "rounds" and "five a round", which this chapter doesn't need.
- **The "measured" card** explains "the user's card". But the page says "GTX 1080 Ti" in one place and "Pascal" in others; that they are the same card is *outside knowledge*.
- **"live"** means a drag in section 1 and a function argument in bake.js.

## 5. Figures
**Figure 1** (three ways). The labelled handles, the readout and "the same text: the values written, no compile" make the point well. Problems:
- The "add" paragraph says "two new lines (marked)", but only **one** line is red. The second "line" is presumably the two new uniforms.
- The caption says "programs compiled since the figure started", yet the counter is 2 in Baked and 1 in As data after a ball was added. It seems to reset per way. That breaks "Count the compiles each way" in Try it.
- In "add", the dragged ball is back at its start (pos_c 1.15, 0.55). In "baked", the added ball has vanished. Neither change is mentioned.
- Lines are cut off with "…", which hides where k goes. `k_g` is unexplained ("g"?).
- Baked shows no visible gain, because there are no matrices to lose.

**Figure 2** (compile time vs call sites). The idea (more places, more time) is clear. But at 40 objects the red "fitted" curve lies **below** the dashed straight line, and at 400 objects above it. "Growing faster than the size" made me expect it above everywhere; nothing explains the crossing except the Try-it question. Also, inlined (6,794) is smaller than the text (6,795), and "four times" gives 27,020, not 4 × 6,794 = 27,176. Small, but it made me doubt I understood "inlined".

## 6. Maths fold-outs
There are none on this page. I could follow the power 1.37 as algebra. I could not check that "0.736 x the linear prediction to the power 1.37" equals "size x rate x (size/SIZE_REF)^(GROWTH-1)". Is the 0.736 inside the power or outside? A one-line derivation would help.

## 7. The code
- **The WGSL excerpt:** the caption's "two lines starting at the left margin are the shapes' own code" is the best help. From it I could find `UB.size_hsa`/`UB.radius_hsb` (uniforms) and `matid_white`, which shows why a new material is new text. That last point is never said. Everything about frames, Hit, XF_* and culling stayed opaque.
- **bake.js:** `{ live = () => false } = {}` is JavaScript I don't know (*outside knowledge*), and there is no body to see.
- **scenedata.js:** readable prose, the clearest excerpt.
- **compileprogress.js:** too dense for me, though it holds the one real explanation of 151,000.

## 8. Too much, too little
- **Too much:** the full WGSL excerpt; the compileprogress comment; the strings of benchmark numbers in sections 2 and 4.
- **Too little:** what folding a constant looks like (one before/after line); why records cost more per step; why compiling takes seconds at all; caching.
- The 3.7–23 s figure appears twice (sections 1 and 4).

## 9. Wrong or contradictory
- **Section cross-references are off by one.** Section 1's "(section 5)", three times, points to measurements that are in **section 4**. "section 6 has the six copies" points to Try it; they are in **section 5**.
- **"The bake, whole"** shows five lines.
- **"two new lines (marked)"** but one is marked.
- **The figure 1 counter** contradicts its caption.
- **The figure 2 curves** cross, against "growing faster than the size", without explanation.
- **"Never" (Q3)** vs scenedata.js's "an edit that adds no new code".
- **Two different 32s**: the lens assembly ×32 and the unrolled 32-step loop. Easy to merge into one story.

## 10. The five changes
1. **Fix the section references** (5→4, 6→5) and either show the bake's body or drop "whole".
2. **Explain figure 2's crossing in the prose:** "the fitted model and the straight line agree at 151,000 inlined characters (a 2.3 s build); below that the fit predicts less, above it more." Replace "at about 151,000".
3. **Show folding concretely.** One line before and after (`p - UB.pos_c` → `p - vec2(1.4,-0.35)`, or a rotation by 0 vanishing). Add one sentence on why the data loop is slower per step.
4. **Trim or annotate the WGSL excerpt** to the uniform reads, the shape lines, `matid_white` and `csgSubtract`. Say it is figure 1's five lines grown up. Leave culling to chapter 26.
5. **Fix figure 1's states** (one marked line or "two", a counter matching its caption, say what was reset). Define or cut the unexplained names: uncached, storage buffer/vec4, lens assembly, optics bench, Menger cubes, and 1080 Ti = Pascal.
