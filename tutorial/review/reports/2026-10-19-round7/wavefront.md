# Blank reader report: Wavefront path tracing (ch. 22)

## 1. Teach-back
The graphics card doesn't follow each light path from start to end in one go. ShadyTracer chops the work into small programs (kernels) that run one after another, each over a list (queue) of rays that need the same job. One round of them is an iteration: march the rays forward up to 32 steps, shade the ones that hit something (which makes a shadow ray towards the sun and the path's next leg), trace last round's shadow rays, then swap the two ray lists. Paths finish at different times, so the lists shrink and the last iterations are almost empty, but they still run. The number of iterations is fixed before the sample starts at the worst case, (10+1) + ceil(400/32) = 24, because the main processor never reads the counts back. Instead a one-thread "prep" kernel turns each count into a number of workgroups, and the card reads that number for the next kernel. With too few iterations, still-marching rays are "flushed" (their light is kept) but cut paths lose their later bounces, so the picture gets darker. Splitting keeps more of the card's lanes busy than one big program, where 32 paths have to wait for the slowest one.

## 2. Quiz
1. **One iteration:** from Figure 2's strip, not the prose: prep_march, march, prep_shade, surface, shade, prep_occlude, occlude, flip (plus the photon map between surface and shade, from the code). I can say what each does except **surface**: the page only says "the scene's answers about each hit". The prose never lists all eight.
2. **Why the counts fall:** paths end "at the sky, at the bounce cap, or out of steps". The drained tail is the late iterations with few or no rays, still dispatched (iterations 12 to 24 here; 45% of card time in one real scene). Why the drop at iteration 12 is so sharp I *guessed* (11 legs at bounce cap 10). The page doesn't say.
3. **Why 24:** 10 bounces + 1, plus 400/32 rounded up = 13. I can recite it, but only half follow "each end part-way through a pass ... at most one pass a leg plus its steps over 32". And 400 is only explained in a code caption ("maxiter").
4. **Flush:** on the last iteration, rays still marching are ended and sent to shade so their gathered light counts. A short budget means paths are cut, so the picture is darker (0.0153 → 0.0145 at 8, 0.0106 at 4). Whether *cut* paths lose light they already had is unclear.
5. **Sizing without reading:** a one-thread prep kernel reads the atomic count and writes a workgroup count into a buffer, and the next kernel's dispatch reads its size from there (indirect dispatch). Clear.
6. **Busier lanes:** the page says a group of 32 marches as long as its slowest path and keeps going until its longest path ends. *Why* lanes must move together is "chapter 21". I only know because of *outside knowledge* (SIMD/warps).

## 3. Where I got lost (worst first)
1. **§3 "Chapter 21's lanes again ... lanes in step ... lane-steps".** There's no card for lane, and no explanation of why finished lanes "wait". The whole "why split" argument rests on it.
2. **The worst-case argument** ("a path's legs each end part-way through a pass of 32 steps..."). It needs one worked example path. "maxiter" is a code name used in prose.
3. **"the march moves every waiting ray up to 32 steps".** Why does a ray take steps at all? I'd expect it to fly straight to what it hits. I understand marching only from *outside knowledge* (sphere tracing).
4. **§5:** "The many small dispatches cost the card nothing measurable", then two paragraphs later the tail "took 45% of the iterations' time on the card". I couldn't reconcile these.
5. **"775 cut" vs "88 flushed".** Is a cut path's light kept? Why not flush those too?
6. **"occlusion traces the shadow rays queued the iteration before"**: why the lag? And iteration 1 queues 523 shadow rays from 774 hits, though shade "queues a shadow ray towards the sun" for each.
7. **"A count clamped before it sizes a dispatch"**: I couldn't follow it.
8. **§6:** "It tested one thing and set another", "light tracing's connections to the camera", "glass cast a plain shadow" (why is that wrong?).
9. **"the flat world"** (captions) is never introduced here.

## 4. Words and symbols
- **Had cards, and they helped:** wavefront, shadow ray, ping-pong, atomic, indirect dispatch, workgroup (the "64" was useful).
- **kernel** card helps, but says "five a round" while the page has eight.
- **dispatch** card: "three dimensions, each at most 65,535" was noise for me.
- **No card:** thread (first sentence), lane, "card" = GPU (assumed), march/step, shade, surface, occlusion, leg, NEE (never expanded, even on the button), "picture's mean" (of what? units?).
- **No card, later sections:** pass vs round vs iteration (three words, overlapping meanings), uniforms, WGSL, radiance, accumulator, HUD, wall clock, R², Pascal, submission, "clamped", "Megakernels" (reading list only).

## 5. Figures
- **Fig 1 (bars per iteration):** shows the queues draining and the cut. It's clear, and the red "last pass: 88 flushed, 775 shaded and cut" helps.
  - The slider reads "0: the worst case": the far-left position means 24, which is backwards.
  - There's no y-axis label.
  - The *picture* is never shown, only a mean number.
  - Iteration 1 has no grey bar, and the caption doesn't say why.
  - fig-1-sample and fig-1-tail are identical, so the "tail" step highlights nothing.
- **Fig 2 (boxes per kernel):** the march/shade/flip screenshots are good, and "212 + 774 new legs" made the buffer sharing click.
  - **The "dispatch sizes" box is empty in every screenshot**, and no prep kernel step is shown. So the chapter's key trick is never drawn, even beside the paragraph about it.
  - There's no shot of "surface".
  - In the flip shot the text "written next" runs over the box border.
  - The shade queue still says 812 after the flip, though the flip code clears `shadeCount`.
- **Fig 3 (busy/grey bars):** clear: same blue work, less grey waste. "0.8 M" needs "million lane-steps" spelled out. The 16/64 choice is never shown or discussed.

## 6. Maths fold-outs
There are none on this page. The only maths is the budget formula and the rounding up, which I could do. What I couldn't follow was the reasoning behind it (see 3.2).

## 7. The code
- **Iteration loop:** the comments and "dispatchIndirect" made march/shade readable. The `setU`/`moves`/`whole`/`baseUniforms`/`ownBase` lines and the `...` spread stayed opaque. The excerpt stops at shade, so the occlude and flip that "the iteration" promises are missing.
- **Prep kernel:** readable thanks to the caption. `groups_for` is guessable. The `u` suffix and `${wgsize}` are unexplained.
- **Flip:** readable. `1u - readfrom` as a toggle was nice to work out.
- **Flush:** the comment is readable, but "radiance", "accumulator", `hit.r = ray` and `UB.maxiter` are not.
- **Budget:** `| 0` and `Math.max(2, …)` (why 2?) are opaque.

## 8. Too much, too little
- **Too much:** §5/§6 citations (§10.1, raytrace_main.js:1651, R² 0.995), which mean nothing to me. The uniform-setting lines.
- **Too little:** lanes; what a march step is; the surface kernel; a plain prose list of the eight kernels; why occlusion lags.
- **Rushed:** the budget proof in one sentence.

## 9. Wrong or contradictory
1. The kernel card says "five a round". Figure 2 says "kernel 2 of 8", and the flip caption admits "eight today".
2. **Iteration 15: 56 marched, but 47 + 1 + 7 = 55.** Try-it asks me to check exactly this sum (iterations 1 and 2 do add up).
3. "cost the card nothing measurable" vs the tail's "45% of the iterations' time on the card".
4. The flush comment says lowering the budget "costs convergence ... instead of quietly stealing light". §1 says at 4 iterations "nearly a third of the light gone".
5. "every dispatch after the first sized by the card", yet the code shows `prog_prep_shade.dispatch(1, 1, 1)`, which is not indirect.
6. "56 rays marched, a few workgroups": by the workgroup card (64), that's one.
7. 774 hits → 523 shadow rays, against "queues a shadow ray towards the sun" (implying one each).

## 10. The five changes
1. **Explain lanes in step here**, with a small drawing of 32 lanes waiting for the slowest. Add cards for thread and lane.
2. **Walk the 24 with one example path:** introduce maxiter = 400 in prose, show three legs' steps falling into passes, and explain the sharp drop at iteration 12.
3. **Fix the contradictions:** the "five", iteration 15's missing ray, "nothing measurable" vs 45%, and the flush comment vs lost light. Say plainly what "cut" loses and what it keeps.
4. **Show a prep kernel in Figure 2** with the dispatch-sizes box filled (e.g. "1024 rays → 16 workgroups"). Add a prose list of the eight kernels, surface included.
5. **One recap paragraph** on what a march step and shading are, expand NEE, and say why shadow rays are traced an iteration late. Also why fewer shadow rays than hits.
