# Blank read: Chapter 22, Wavefront path tracing

## 1. Teach-back
ShadyTracer splits each path into small programs ("kernels") run in turn: march, shade, shadow rays. Rays pass between them on lists in the card's memory. One round of all the kernels is an iteration. It marches every waiting ray up to 32 steps, shades the hits and queues their next legs. Paths end at different times, so the lists shrink, but the number of iterations is fixed in advance at the worst case, 24. With fewer, unfinished rays are flushed (their light kept), paths are cut and the picture comes out darker. Tiny one-thread "prep" kernels count the rays and tell the card how big the next job is, so the main processor never has to ask. Each group of 32 lanes then does the same kind of work, so more lanes stay busy.

## 2. Quiz
1. In order:
   - prep_march sizes the march.
   - march moves each ray up to 32 steps. Hits and escapes go to the shade queue, the rest to the other ray buffer.
   - prep_shade sizes surface and shade.
   - surface finds the material and "normal".
   - shade works out the light, queues a shadow ray (not on the last pass) and writes the next leg.
   - prep_occlude sizes occlusion.
   - occlude traces the *previous* iteration's shadow rays.
   - flip swaps the buffers and clears the counts.
2. Paths end at the sky, at the bounce cap (11 legs) or after 400 steps. The big drop at iteration 12 (822 to 475) is the paths whose every leg fitted in one pass. The drained tail is the late, nearly empty iterations that are still dispatched. On a real card they took 45% of the card's time ("latency": the page didn't teach me that word).
3. (10 + 1) passes that end a leg, plus ceil(400/32) = 13 full ones, gives 24. It has to be fixed in advance because the counts are never read back.
4. On the last pass, march hands its still-marching rays to shade, so the light they gathered is kept. A short budget still loses the light of legs never traced: the mean falls from 0.0153 to 0.0145 at 8 iterations and 0.0106 at 4. That is a bias, not just noise. I only follow "bias" and "averaging samples" from *outside knowledge*.
5. A one-thread prep kernel reads the atomic count, writes ceil(count/64) into a buffer, and dispatchIndirect reads the size from there.
6. In one big kernel, a group waits for its slowest leg, stops to shade whenever any of its paths needs it, and runs until its longest path ends. A wavefront packs rays that need the same step into full groups. Does figure 3's model count the drained tail and the prep and flip kernels? The page doesn't say.

## 3. Where I got lost (worst first)
- **"does not wait to read the counts back"**: why would waiting be bad? I know it's a costly round trip only from *outside knowledge*.
- **"the occlusion runs again, round after round, until every one has ended"**: how does the main processor know how many rounds to run if it never learns the counts?
- **Sections 5 and 6** assume a developer: "Pascal card", "§10.1", "submissions", "would queue more than they took", "light tracing's connections", "fell to the floor of 4".
- **pass / iteration / round** seem to mean the same thing. "Round" is also an occlusion re-run, and the kernel card says "about eight to a round".
- **"a full pass and 8 steps of the next"**: I first read "the next" as the next *leg*.
- **"16 paths each"**: the page never says why a pixel needs many paths.

## 4. Words and symbols
- **No card at all:** thread, buffer, normal, uniforms, seed, WGSL, "records the whole chain", maxiter (dropped in as a variable name), "the flat world", exposure, bias, convergence.
- **Card exists but the word isn't marked at first use:** kernel (first sentence), workgroup ("zero workgroups"), dispatch.
- **Cards that helped:** lane, atomic, indirect dispatch, ping-pong and workgroup. "A workgroup of 64 is two groups of 32" made section 2's tail make sense.
- **32 march steps and 32 lanes:** same number. Are they linked?

## 5. Figures
- **Fig. 1:** clear. Iteration 1 has no grey bar, as the text says, and the "drained tail" band works well. Problems:
  - The legend says "hits shaded" but the text says "hits and escapes".
  - The dots' legend swatch is a square.
  - The grey bars zig-zag (≈520, 220, 575, 320...) with no explanation. I guess floor and ceiling hits alternate.
  - The 64-pixel strip looks nearly the same at 24 and 8 iterations, so the darkening can't be seen.
  - The room itself is never shown.
- **Fig. 2:** the best figure. The red highlight and the dispatch sizes (16 = 1024/64, 13 for 812) let me check that the count rounds up. Problems:
  - In fig-2-occlude, "523 from the iteration before" runs into the dispatch box.
  - prep_march is never shown.
  - "18 new legs" from 47 hits (iteration 15) is not explained.
- **Fig. 3:** the bars are clear, but no lanes are drawn waiting. The axis scale changes between screenshots (0.8 M, 0.6 M, 1.5 M). The blue parts are equal (the same work), which is worth saying. 16/32/64 is never discussed.

## 6. Maths fold-outs
None. The inline worst-case sum (40, 10, 30 steps giving 4 passes; 11 + 13) was the clearest reasoning on the page.

## 7. The code
- **Main loop:** the dispatch pairs are clear. setU, `whole`, ownBase, maxaverages, sppmRuns and "0.20.8" stayed opaque.
- **Prep kernel:** the note makes it readable. `&counters`, `atomicLoad` and why y = z = 1 stayed opaque.
- **Flip:** the comments carry it.
- **Flush:** the comment is readable, but the excerpt stops in the middle of the `if`.
- **Budget:** clear, and it matches section 1.

## 8. Too much, too little
- **Too much:** section 5's stamps and section 6's history.
- **Too little:** why waiting on counts costs anything, why surface is separate from shade, why compiling or the eight-buffer limit matter.

## 9. Wrong or contradictory
- Section 5 says "the prep kernel clamps the count ... (wavefront.js:276)", but the prep kernel shown (lines 237–253) has no clamp.
- At iteration 15 the shade queue holds 48. The readout says 47 hits + 1 escape + 1 out of steps, and the flush comment says out-of-steps rays go to shade, which makes 49.
- The kernel card says "a few more [rounds] to start and finish", but the budget is exactly 11 + 13.
- The page says "nothing is cut" at the worst case, yet shade skips NEE on the last pass, and the Math.max note says queued shadow rays need one more iteration. Doesn't a path whose last leg ends on pass 24 lose its shadow ray? (My question; I can't settle it.)
- "Costs the card nothing measurable", then "an added iteration ... cost the card 0.13 to 0.42 ms": reads as a reversal.
- "The user chose exact": I thought "the user" meant me.

## 10. The five changes
1. Explain why the main processor doesn't read the counts, and how the last pass's extra occlusion rounds are decided without them.
2. Define thread, buffer, kernel, workgroup and normal at first use, marked °. Use one word for iteration, and say whether 32 steps and 32 lanes are linked.
3. Fix the clamp, 48 vs 49, the kernel card's "a few more", and the last-pass shadow ray question.
4. Give fig. 3 a lane picture (one group of 32 over time, both ways) and say why the blue bars are equal.
5. Cut sections 5 and 6 to what a beginner can use, explain bias and averaging in a sentence, and drop the sppm and version lines from the excerpt.
