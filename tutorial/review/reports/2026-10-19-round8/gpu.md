# Blank reader: "A GPU for beginners" (ch. 21)

## 1. Teach-back
The graphics card runs one program, a kernel, as thousands of copies called threads, one per pixel's ray. Threads go in groups of 32 (or 64) that do every instruction together, so one slow ray holds up its whole group. Neighbouring pixels need similar work and waste less than shuffled ones. Settings live in a uniform buffer (at most 64 KiB). Its fields start at multiples of their alignment, and the gaps are wasted padding, so field order changes the size. You start a kernel with a dispatch, a count of workgroups along x, y and z, each count at most 65,535. ShadyTracer counted pixels in one line and went over the limit at 2048 × 2048, so it now counts one row per y. Windows resets the card if a submission runs about 2 s, so heavy frames are split into pieces of about 150 ms.

## 2. Quiz
1. In lock-step, the group can't move on until its slowest ray is done. Lanes that finished early sit idle.
2. Neighbours "need similar work", so slow rays share a few groups. Shuffled, there is "a slow one in nearly every group": 45% busy against 39%.
3. A vec3 is 12 bytes starting on a 16-byte boundary, which leaves 4 bytes in its row. A single number needs 4 bytes at a multiple of 4, and byte 12 qualifies.
4. A dispatch asks the card to run a kernel as a number of workgroups along up to three dimensions. Resolve counted pixels flat, 64 to a group, along x, and so it hit 65,535 groups a dimension (4,194,240 pixels). 2048 × 2048 was one over: a validation error, and nothing drawn.
5. At about 2 s Windows decides the card hung and resets it. The page loses its device and every buffer and kernel on it.
6. A `return` for some threads before a barrier meant not every thread reached it. The GPU-less checker passed it, and the browser's compiler on the user's machine refused it. The page doesn't say how it was fixed, or what "the checker" is.

## 3. Where I got lost (worst first)
- **Compile times (§5):** "Ampere card … GTX 1080 Ti … not reconciled with a profile of about 4 s". I don't know these card names (the card says "Pascal", which matches neither), "profile" or "reconciled", or which number to believe.
- **The hang (§3):** "the Noise library hung". Is that a scene or a code library? I also hit "the march's loop, rolled up again" and a doc path I can't open. "Over a second" is under 2 s, so why did it hang?
- **Workgroup vs lock-step group:** §1's groups are 32, §3's workgroups are 64. Only the *workgroup* card says "a workgroup of 64 is two groups of 32".
- **"Each thread works out its item from its group's place and its own":** this needs one worked example.
- **"Compiled off the page's thread"** gives "thread" a second meaning.
- These went unexplained: "the scene's records, when the scene is sent as data", "the test holds this figure's arithmetic" (which test?), light tracing, photons, hit, shade queue.

## 4. Words and symbols
- **WGSL** is used in §2, and its card comes in §4.
- **i32** is never explained (that it is signed is *outside knowledge*).
- **matrix** appears only in the legend and the code.
- **GiB/GB/MB/1080p:** only KiB is given in bytes. 1080p = 1920 × 1080 is *outside knowledge*.
- **Also unexplained:** entry point, validation error, asynchronously, uniformity rule, occlusion, frame vs sample, regular expressions.
- **The cards** *lock-step*, *lane*, *dispatch* and *ping-pong* are clear. *workgroup* is essential.

## 5. Figures
- **Fig. 1:** the clearest thing on the page. 45/39/70%, and the scattered blue rays when shuffled, make the point instantly. One snag: "4000 lane-steps occupied" sounds like "busy", but it counts the boxes.
- **Fig. 2:** the small and reordered structs match the text exactly (64/8, 80/24). But the text never lists the fields, so I read the order off the picture. ShadyTracer's view is tiny and unlabelled in a screenshot, and the legend sits far below it.
- **Fig. 3:** it makes the point, with these snags:
  - "flat": the "32,400" label sits on the bar edge, and "along y" has no bar and no "1".
  - "over": "x 0 to 65,535" spills left of the frame, and the 65,536 bar looks as tall as the 65,535 line. Only the red tells.
  - The frame stays wide for 2048 × 2048.
  - "rows": the orange y bar stretches oddly to the right edge.

## 6. Maths fold-outs
None on this page. I checked the inline arithmetic myself (1791/4000, 2048²/64, 112 × 2 + 272, 1 GiB/496) and it holds.

## 7. The code
- **makeCompute:** the note (BI, V3U, wg) got me to "it glues body, a header and main into one text". The arrow function, `{ wg = …, ...opts }`, `??`, `${}` and the history comments ("interpolate `undefined`", "`moduleOnly`", "hashed") stayed opaque.
- **typeInfo:** regexes and nested `? :` are unexplained. Only after working it out could I match vec3 → `[3, 4, 3, 0]` to the table, and the text should walk that. The matrix branch is lost on me.
- **Excerpts 3–4:** these are comments and readable, though they repeat the text. `ceil`, `R.frameMs` and "the queue's wait" are unexplained.

## 8. Too much, too little
§1–3 are well paced. §5–6 are rushed and crowded with file:line references, dates, chapters 22–27 and card models. "24 modules parse" never says what modules or parsing are. The "out of x" story is told three times, which was fine.

## 9. Wrong or contradictory
- **The stamp contradicts its own card.** "Compiled off the page's thread" is stamped READ IN CODE, yet it says "can hold the page for seconds to a minute". The card says this stamp tells "never what it costs: how long it takes".
- **"About 1.7 GB":** "4 million rays in three ray buffers and the hit buffer". With §5's sizes I get 4 M × (3 × 112 + 272) ≈ 2.4 GB. Were the sizes different then?
- **The buffer limit:** under the 1 GiB budget the shade queue alone is ≈ 590 MB, still over the 256 MB default a buffer. Is the big-buffer request still needed?
- **Thread numbers:** vec3 is "three f32s", but gid is `vec3<u32>`. And "the thread's three numbers" are three triples.
- **Workgroup shape:** the default `[8, 8, 1]` is a square, but Fig. 3 draws each workgroup as a row of 64.
- **Which card?** The *measured* card promises "whose and which" card, but the compile times say only "the user's machine".
- **Where compiling happens:** "The card's compiler … in the browser". Which does it?

## 10. The five changes
1. **Workgroups in the text.** Say that a workgroup of 64 runs as two lock-step groups of 32, and reconcile `[8, 8, 1]` with Fig. 3's rows.
2. **Rewrite the beginner-hostile paragraphs** (compile times, the Noise hang, 1.7 GB). Explain or drop the card models, profile, rolled-up and doc paths, and say what "the Noise library" is.
3. **Walk vec3 through typeInfo**, add a line on what the regex tests, and explain matrices or drop them.
4. **Re-stamp "Compiled off the page's thread"** (a time is a cost), and don't reuse "thread" for the browser's.
5. **Add an index example:** item = wid.x × 64 + lid.x; by rows, x = wid.x × 64 + lid.x, y = wid.y. Also define sample, frame, hit and photon on first use, or cut them.
