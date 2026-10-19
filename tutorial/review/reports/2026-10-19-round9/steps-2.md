# Blank reader: "Fewer and cheaper steps" (ch/steps.html)

## 1. Teach-back
A ray moves in steps. Each step, the scene asks every object how far it is, keeps the smallest, and the ray moves 0.9 of that. So every step pays for every object, and bumpy objects (reliefs) pay most: 84% of the work in the page's model. A cheap box around an object lets it be skipped while the box is farther than a small margin; the box's distance then only caps the answer. Only reliefs and groups get one. They go only at the top of the scene, because inside an intersection or a blend, skipping a part changes the shape. Far from the bumps, a relief's shell uses the plain distance minus the bumps' reach. It saved a third, not most. The step cache keeps a distance per grid cell, so a ray inside a cell's ball can jump to the ball's exit without asking the scene.

## 2. Quiz
1. The scene can't know which object is nearest without asking all of them. A step is dear when it asks a relief: 16 for its noise, against 1 for a plain shape.
2. Nothing in the box is nearer than the box, so while the box is beyond ten tolerances, the object is skipped and the box distance caps the answer. That cap is never more than the true distance (no step too long) and always above the margin (never taken for a hit). The price is shorter steps (387 of 946).
3. A box test costs about a plain shape and shortens steps, so it pays only on reliefs and groups (+23 to +42% measured on plain scenes). At the top, objects join by union. Inside an intersection or a blend a skipped B vanishes: the lens becomes all of A, the bridge disappears. *Why* min is safe and max isn't, the page asserts but doesn't show.
4. A band of twice the noise's reach (1.386 × amount) around the plain shape; outside it, plain distance minus reach, no noise, no division. It saved 22.9%, not "most", probably because the boxes already skipped the far steps (a hypothesis).
5. A ray jumps to its cell ball's exit along the ray, if that is at least a cell. The page gives **two** "first ways": filled from the boxed copy, so the balls stopped at the boxes (879 against 794 steps; section 4), and filled lazily during the march, no faster than no cache on four of six scenes (section 7). I don't know which is meant.

## 3. Where I got lost (worst first)
1. **"a box's distance in place of what it holds"** (section 2). Read as substitution, max(A, boxB) never reaches 0 on A and the lens figure is impossible. Only the code (`CULL = min(CULL, bd)`, applied at the end) showed that a skipped object *leaves* its join. Section 1's wording was right.
2. **"The formula, the larger of the two discs' distances, is an underestimate there."** The intersection card says the larger *is* its distance. I know these formulas are only bounds from *outside knowledge*.
3. **"17.2 ... four of them at their steepest"**: with layers ½, ¼, ⅛ as strong I expected 1.875 × 4.3; it is 4 × only because each is twice as fine (*outside knowledge*). Why divide by 1.875 is never said.
4. **"Both are measurements, not proofs"**: so can today's rays go through bumps? Left hanging.
5. **"a march pass's 32 steps ... the pass ends by handing on"**: pass, kernel, round, flush and shade have no card.
6. Benchmark talk (frozen, row, run, drift, "ms a sample"). The "dear" paragraph mixes model numbers with three cards' results.

## 4. Words and symbols
- The cards helped: march, step scale, tolerance, relief, culling box, shell, union, intersection, step cache, Lipschitz (very clear), and the stamps.
- No card: **dear** (I read "beloved"), noise and "layers", pass/kernel, sample, uniform, pick/render copy, subtraction, k, "holes", fold, `C.s.w`, `n.w`.
- `NZ_GRAD_VALUE_BOUND` is presumably the 1.386, but nothing says so.

## 5. Figures
- **Fig 1:** clear, and the readouts match the text (1,021 / 946 / 907 / 885). In "every", *all* dots are orange, even by the plain discs, because the colour means "paid for the reliefs", not "near one". In "shelled", I couldn't pick out the dashed shell from the dashed boxes.
- **Fig 2:** convincing; the crescent and the vanished bridge make the point. But the caption says "the red solid one", and the screenshots show it dashed. In "whole", P's circles leave the frame and "the join's box" label covers the tip. 0.901 is shown nowhere. In "blend" I couldn't find "the third" ray.
- **Fig 3:** the best: the step circles against the big dashed circle make "2.6 times shorter" visible; the shell's edges are clear. The header label overlaps the eye; the plain dashed circle hides under the outline.
- **Fig 4:** good. Cache jumps are dashed like outlines; the callout covers the scene; "orange" in the text, red in the figure.

## 6. Maths fold-outs
There are none. I could check the inline sums (1 + 0.17 × 17.2 ÷ 1.875 = 2.56, as the header says) but not why each term is there.

## 7. The code
- `cullDist`: "Pythagoras over the axes" worked; `abs(q - centre) - half` didn't. The codegen comment is jargon (render copy, emitScene, uniform cull).
- `culled` is the clearest: its `if (bd > cullMargin()) ... else` *is* the idea.
- Relief: `sign(H.s.w)`, `fbm3`'s arguments and `foldRelief` stayed opaque.
- `scStep`: the quadratic needs the dot product, which I don't have, and the clamp is unexplained. The march snippet is clear.

## 8. Too much, too little
- **Too much:** card timings repeated across sections 1, 3, 4, 6 and 7; section 7's orange shell repeats section 4.
- **Too little:** why union is safe, subtraction (named, never shown), what noise is, proved vs measured bounds.
- **Rushed:** the "saved less" reasoning and the 11.2 paragraph.

## 9. Wrong or contradictory
- "Its test: 4,730 here, one for every object at every step". 4,730 = 5 × 946, so the floor isn't counted; it should say every *boxed* object.
- Section 4 says cells are filled "by a pass of their own before the rays are traced". Section 7 says the first version filled them during the march, and that 0.33.0 "added the fill ... before the trace (and fixed the orange shell, which both had)". How could a fill added in 0.33.0 have a bug that 0.33.0 fixed?
- The intersection card vs "underestimate" (3.2); fig 2's "solid" circle drawn dashed (5).
- The Noise library with boxes takes 216.6 ms (section 1) but 202.3 ms before the shell (section 3). These are probably different runs, but the page doesn't say so.
- "so the march does not step through a bump" vs an unproven 17.2 and "a bound too small makes holes".

## 10. Five changes
1. Section 2: say that a skipped object leaves its join and its box only caps the final answer. Show in two lines why that is safe under min and not under max or a blend. Fix the intersection card.
2. Explain 17.2 = 4 × 4.3 (half as tall, twice as fine) and the ÷ 1.875. Say which bound is proved and which is measured, and whether today's relief can leave holes.
3. Move the card timings into one small table. Define sample, run and row once, and keep the model's numbers in the prose.
4. Add cards for pass, kernel, the 32-step round, flush/shade, uniform, pick/render copy, and "dear".
5. Fix the small mismatches: "every boxed object", "solid", the lazy fill missing from section 4 and the 0.33.0 "both had", the third ray in fig 2, and the overlapping labels.
