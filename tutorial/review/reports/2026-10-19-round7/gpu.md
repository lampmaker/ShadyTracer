# Blank read: "A GPU for beginners" (ch. 21)

## 1. Teach-back
A graphics card doesn't trace one ray after another. It runs one small program, a kernel, as thousands of copies (threads), one per pixel. Threads move in groups that do every instruction together, so if one ray needs many steps, the whole group waits for it. Neighbouring pixels usually need about the same work, so groups of neighbours waste less than shuffled ones, and narrower groups waste less again. Data the kernel reads sits in buffers. Uniform buffers hold the same values for every thread and are laid out in 16-byte rows, so the order of the fields decides how much space is wasted as padding. To start a kernel you "dispatch" a number of workgroups along up to three directions, and each direction can count at most 65,535. A long flat count over a 2048×2048 picture went over that limit, so ShadyTracer now dispatches one row per y. If a batch of work (a submission) runs about 2 s, Windows resets the card, so heavy frames are cut into pieces of about 150 ms. Compiling kernels is slow, and a kernel gets at most 8 storage buffers.

## 2. Quiz
1. All threads in a group take every instruction together (lock-step), so the ones that finish early sit idle until the slowest one finishes. Taught clearly.
2. Neighbouring pixels see neighbouring things, so the slow rays end up together in a few groups. Shuffled, nearly every group gets one slow ray and waits for it. Taught (45% vs 39%).
3. A vec3 takes 12 bytes but starts on a 16-byte boundary, which leaves 4 bytes free in its row, and one number is exactly 4 bytes. Taught, though I had to guess that "one number = 4 bytes" from the caption ("each box 4 bytes").
4. A dispatch asks the card to run a kernel as N workgroups, counted along up to three dimensions. The limit is 65,535 groups per dimension. The page never uses the word "resolve". I'm guessing that's "the kernel that adds up each sample into the picture", which broke above 4,194,240 pixels.
5. After about 2 s Windows decides the card has hung, resets it, and the page loses "its device and everything on it". Taught, but "device" was never explained.
6. A `return` placed before the barrier let some threads leave early. The GPU-less checker passed it and the browser's compiler refused it. *Why* every thread has to reach the barrier (otherwise the others wait forever?) is not said. I only know it from outside knowledge.

## 3. Where I got lost (worst first)
- **Two different "groups".** §1: "groups that take every instruction together… 32 at a time" and "The card decides the width, not the program." §3: workgroups are "of a size fixed in the kernel (64 threads)". So is a group 32 or 64, and does the card or the program choose? The cards don't clear this up either. I only know that a 64-thread workgroup runs as two 32-wide lock-step groups from *outside knowledge*.
- **"lanes"** ("the lanes are busy 45% of the time", "lane-steps occupied") is never defined.
- **"each starts where its alignment allows"**: "alignment" is never explained. The rule I needed (scalar 4, vec2 8, vec3/vec4 16) appears only in a code comment, in "4-byte units".
- **"its heaviest scene took over a second a sample: it hung"**. The limit is "about 2 seconds", so why did 1 s hang? Not answered.
- §6 "A buffer bound and then dropped": "binds", "entry point", "reaches" are never explained. The whole bullet is opaque to me.
- §5 "what it needs from the surface kernel rides beside each hit in the queue": surface kernel, hit, queue are all unknown words.
- "sphere-trace a flat scene (chapter 2)", "march steps": the whole first figure depends on chapter 2.

## 4. Words and symbols before explanation
- **lane, alignment, padding, struct, offset, f32/u32/i32, `vec3<f32>`, KiB, 4K, device, validation error, entry point, bind, asynchronously, ping-pong buffers, photons, sample, frame**: none of these is explained on the page. "struct" and "f32" I understood only from *outside knowledge*.
- **WGSL, WebGPU, compile** have cards in the end list, but their first uses in the text ("WGSL's rules", "WebGPU library", "Compiling is slow") aren't underlined.
- Cards that helped: **lock-step** (answers Q1 by itself), **GPU**, **thread**, **uniform**.
- Cards that added confusion: **kernel** brings in "sample", "rounds", "five a round". **dispatch** ends with "queues also let the GPU write the count for the next one itself", which goes unexplained. **workgroup** adds "may share fast memory" but never says how it relates to the lock-step group.
- "pipeline" is defined in §5, after `makePipeline` has already appeared in §4.

## 5. Figures
- **Fig 1** (ray steps as bars, boxes per group). Clear and the best thing on the page. I could check it myself: 1791/4000 = 45%, /4640 = 39%, /2568 = 70%. Confusing points: "lane-steps" is unexplained, all the bars are blue while the caption says "those of one group blue" (that means the rays above), and offering widths 8–64 contradicts "the card decides the width".
- **Fig 2** (bytes in 16-byte rows). Small and reordered are clear: I can see the red-struck padding. In "engine", the "8 columns of 16-byte rows" wrap is hard to read, and I couldn't tell which way to read it, row by row or column by column.
- **Fig 3** (workgroups vs. 65,535). "flat" and "over" work, and the red bar is clear. In "rows" the right chart looks empty: bars of 60 and 2,160 on an axis up to 262,140 are invisible. The readout in "flat" is cut off ("within"). The submission paragraph is also tagged "[moves figure 3: rows]", but nothing in the figure is about submissions (the same screenshot is shown twice).

## 6. Maths fold-outs
There are none on this page. The arithmetic is just stated: busy % = steps ÷ (box heights × width), 65,535 × 64 = 4,194,240, 112×2 + 272 = 496 bytes, 1 GiB / 496 ≈ 2.16 M. I could work these out, but a fold-out for the busy % and for 4,194,240 would have saved me some guessing.

## 7. The code
- **makeCompute**: the lead-in plus "gid… lid… wid" made the `fn main(...)` line understandable. `${BI}` and `${V3U}` stayed opaque. The comments about `undefined` and `makePipeline` are history I didn't need. And "the function's text and its body" clashes with the label, where "body" means the code *before* the entry point.
- **typeInfo**: the regexes and the `[size, align, components, packRows]` ternary chain are opaque. Only the comment's sentence about vec3 helped, and it should be in the prose.
- **Dispatch comment**: readable, and it matches §3. "ceil" and "adapter" are unexplained.
- **Submit comment**: mostly readable thanks to the label. "R.frameMs", "the queue's wait" and "DXGI_ERROR_DEVICE_HUNG" are noise.
- **Rays-in-flight comment**: a wall of version numbers (0.44.0, 0.22.4…). The lead-in "as memory rather than a count" comes out of nowhere because no section discusses it, and "ping-pong" is unexplained.

## 8. Too much, too little
- **Too much**: the fifth excerpt's history; the compile timings in §5 (four kernel names I don't know); §6's dense bullets with file:line references.
- **Too little**: lock-step group vs workgroup; alignment; why a barrier needs every thread; what a device is; why 1920×1080 doesn't overflow but 2048² does (spelled out only as "by one workgroup").

## 9. Wrong or contradictory
- "The card decides the width, not the program" vs "a size fixed in the kernel (64)".
- "over a second a sample: it hung" vs a limit of "about 2 seconds".
- §2 "bad": "each single number pushes the next vec3 to the next row". In the figure only `t` does that. `k` and `n` sit in vec3 tails, and the other waste comes from `col` and `uv` at the end.
- "stopped working at 4,194,240 pixels". That is actually the last size that *works*. And "2048 × 2048 by one workgroup, a 4K picture, a render sized to a 4K monitor" reads as if 2048² were 4K.
- The newer Ampere card compiles in 21–22 s and the older 1080 Ti in 8 s, with no comment. A beginner would expect the opposite.
- `wg = [8, 8, 1]` as the default vs "64 threads": consistent (8×8), but nothing says so.

## 10. Five changes
1. Separate the two groups. Define "lane". Say that the card's lock-step group is 32 or 64 wide and that a workgroup (chosen in the kernel) is run as one or more of them.
2. Put the alignment rule in prose with a tiny table (scalar 4, vec2 8, vec3/vec4 16, struct rounded to 16). Define struct, offset and f32. Fix the "bad" sentence so it matches the figure.
3. Explain why a 1 s sample hung under a 2 s limit (or correct it). Either give the submission paragraph its own picture or don't tie it to Fig 3. Use a log scale or a zoom for Fig 3 "rows".
4. Add a fold-out with the arithmetic: lane-steps → busy %, 65,535 × 64 = 4,194,240, and the largest square (2047²).
5. Trim the code: explain BI/V3U, cut the version history in excerpt 5, and in §6 say why a barrier needs every thread and what "bind" means.
