# Blank reader: "Fewer and cheaper steps" (ch/steps.html)

## 1. Teach-back
A ray moves in steps, and each step asks every object its distance and keeps the smallest. Bumpy "reliefs" cost the most: the noise is expensive, and their distance is divided by a slope bound, which makes steps shorter. A box around an object lets you skip it while the box is far, using the box's distance instead. That is never too big, because nothing inside the box is nearer than the box. Boxes cost a test and sometimes a shorter step, so only expensive things get one. Boxes only work where objects are joined by "nearest wins". Inside a lens or a blend, skipping a part changes the shape. A shell lets a relief skip its noise far from its bumps. It saved less than hoped, probably because the boxes had already skipped those steps. A grid of remembered distances gives empty balls that a ray can jump through without asking the scene.

## 2. Quiz
1. The nearest surface is the smallest of all the objects' distances, so all are asked. A step is dear when an object is expensive (a relief's four noise layers) or when division makes more steps. The page calls groups dear but never says why (*outside knowledge*: they hold many objects).
2. Measure the box's distance (cheap, exact). If it is above the margin (ten surface tolerances), skip the object and let the box's distance stand in. It is safe because nothing inside is nearer, so a step is never too long, and being above the margin means it is never taken for a surface.
3. A box test costs about one plain shape and can shorten steps, so it pays only on reliefs and groups. It goes at the top because there the join is a union. Inside an intersection the lens became disc A ("1.2 short"). Inside a blend the bridge vanished: 0.150 where the surface was 0.054 away.
4. The band where the bumps can be: twice the reach (1.386 × amount), plus a little. Outside it, the plain distance minus the reach is used, with no noise and no division. It saved a third, not "most". The page's hypothesis: the boxes had already skipped the far steps.
5. Inside a cell's ball, the ray jumps to the ball's exit (if that is at least a cell away), times 0.9. "The first way it was filled" has **two answers on the page**. Section 4: from the copy with boxes, so the balls stopped at the boxes (879 vs 794 steps). Section 7: "the cache's first version filled a cell the first time a ray passed through it". I can't tell which is meant.

## 3. Where I got lost (worst first)
- **"A ray's time on the card is its steps"**: the page had just said a "card" is the popup on a dotted word. I only learned it means a graphics card from the "measured" card at the very end.
- **Unintroduced scene names**: "Noise library", "showcase", "demo", "Menger cubes", "optics bench (as data)", "OpticsBench2", "dichroics", "Surface materials", "frozen scene". Also "ms a sample", "GPU time", "kernels that march, not in shading", "shadow rays".
- **"never on the last step of a march pass, which must end on the scene's own answer"**: what is a pass, and why must it end that way?
- **"which for a lens is itself an underestimate"**: the intersection card only says "the larger of the two distances".
- **"a quarter of its blend"**: a quarter of what?
- **"17.2 is the steepest one layer of noise can be, measured, times four layers"**: I first read 17.2 as one layer's slope. 1.875 ("its layers' total strength") is explained only later, in a code caption.

## 4. Words and symbols
- The cards helped: *step scale, relief, culling box, union, intersection, shell, step cache*.
- *slope bound* opens a card titled **"Lipschitz bound"**, a word used nowhere else.
- No card: "tolerance", "the march", "lower bound", "flat world", "blend/smooth union", "closed-form", "uniforms", "f32", "bitcast", "WGSL", "render/pick copy", "drift".
- "noise" means both the bump pattern and measurement scatter ("within that run's noise").

## 5. Figures
- **Fig 1**: clear. All orange without boxes, red where a box stands in, then boxes only on granite and marble. The cost bar works. But the reliefs look like smooth circles, so only the labels say which are bumpy. "Shelled" looks identical to "dear", and no band is drawn. Box tests 4,730 = 946 × 5, yet there are six objects: the floor is unboxed, which is never said.
- **Fig 2**: "lens" and "blend" make their point (a red phantom surface, rays through the bridge). But "whole" shows the scene answering **1.500 < 1.524**, beside text saying it "can be a little more". The caption calls the discs, the box and both circles "dashed". The grey contour rings and the red crescent's jagged edge are unexplained.
- **Fig 3**: the band screenshot is the page's best (red edges, blue outside, orange inside). In "divided" I could not see the ray going "2.6 times slower than it could" from the circles.
- **Fig 4**: the balls show well. No screenshot shows the key idea, a ray *leaving* an off-centre ball. The grey jumps start above the dotted rectangle: is the grid bigger than it? The bug screenshot shows no "orange glow" (the cells are grey), and no visible change around the boxes.

## 6. Maths fold-outs
There are none. I checked 1 + 0.17 × 17.2 ÷ 1.875 ≈ 2.56 against the readout. "-b + sqrt(b² - c2) … from the quadratic for |oc + t dir| = r" needs dot products and a direction of length 1, and neither is taught (*outside knowledge*). "c2 is how far inside the ball the ray is" is really a squared distance minus r².

## 7. The code
- `cullDist`: `d` is explained. The last line stays opaque; one sentence on Pythagoras for the outside parts would fix it.
- "…the one line that lets the nearest skipped box stand in": **the line is not shown**, only "codegen.js:1905".
- Relief shell: the `if` matches the "twice the reach" stamp. I only guessed that `NZ_GRAD_VALUE_BOUND` is 1.386. `H.s.w`, `sign(...)` and `DIVIDED_ABOVE` stayed opaque.
- `scStep`: the page never says `SC_LOOKS` is 1 or 3. The index `k` and `select(...)` are opaque. "towards its 400": 400 what?

## 8. Too much, too little
Too much: the "dear" paragraph (GTX 1080 Ti aside, four percentages), section 6 repeating measurements, section 7's jargon. Too little: what a pass is, an off-centre ball exit.

## 9. Wrong or contradictory
- Fig 2 "whole" shows less than the formula, beside "can be a little more".
- The stamp says "a gain on the optics benches only", but it lists the showcase at −10% with noise "under about 7%". Section 4's "three other scenes 6 to 10%" omits the optics bench as data, at −19%.
- Two different "first" fills (sections 4 and 7).
- 17.2 is described as "measured", yet it is kept because "a measured bound is not a proved one".
- "orange glow" against the grey cells.
- "rough fine one and a broad smooth one, like … marble and granite": the figure shows granite left of marble, so I can't tell which is which.

## 10. Five changes
1. Say "graphics card" in the first sentence. Introduce the benchmark scenes once, or name them less.
2. Show codegen.js:1905, explain `cullDist`'s last line, and say what `SC_LOOKS` is.
3. Move P in fig 2 "whole" to where the box answers *more*. Name the dashed styles apart, and explain the contour rings.
4. Settle which fill was "first", and "optics benches only" against the showcase's −10%.
5. Add a fig 4 view of one ray leaving an off-centre ball. Before using them, explain why groups are dear, why a lens's formula underestimates, and what 1.875 is.
