# Beginner read: "Building and bending shapes"

## 1. Teach-back
Every shape is a distance formula, and you join two shapes by combining their two distances. The smaller one gives both shapes together, the larger gives only the overlap, and flipping one shape's sign and then taking the larger cuts that shape out of the other. A smooth blend changes the answer a little where the two distances are within k of each other, and that rounds the corner into a fillet. Lighting uses the normal, the arrow straight out of the surface. When one shape gave no normal, the blend mixed "nothing" with the other shape's arrow and lit the whole fillet wrongly, so now the normal is worked out from the blended distance. To decide which material a point is in, the renderer picks the solid the point is least deep in. That works when one solid sits inside the other, but it guesses wrong when they only partly overlap. A twist turns the point, not the shape. That stretches space, so the formula changes faster than a real distance and has to be divided by its steepest slope, and ShadyTracer's divisor is a little too small. Noise bumps also make the formula too steep. Without division a ray zigzags at the surface for ever. With division it is safe but slow, and the "shell" only uses the noise near the surface.

## 2. Quiz
1. Change the sign of the cutter's distance and take the larger of the two: max(a, −b).
2. Near where the two distances are within k, it takes off (union) or adds (intersection, subtraction) up to k/4, which rounds the crease. k sets how far from the meeting point the rounding reaches; k = 0 is the hard join.
3. The box gave a zero-length normal. The blend mixed it with the ball's normal and stretched the mix to length one, which is just the ball's normal, so the fillet was lit as if it were part of the ball. The distances were right, so the surface was in the right place.
4. Of all the solids with a negative distance at the point, it picks the one nearest zero. It can be wrong when two solids partly overlap: a point inside a ball half out of the water but nearer the water's surface gets "water".
5. Turning by an angle that grows with height stretches space, so the formula claims more empty room than there is and a step can jump the surface. The fix is to divide by √(1 + c²) through `warp`, and to zero the normals so they are worked out from the distances.
6. √(1 + c²) only covers a move straight along the axis. A diagonal move stretches up to (c + √(c² + 4))/2, which is up to 15% more. It is measured, not proved: a copy of the arithmetic, in node, found a slope of 1.14 for a tilted plate, about 3% too long a step. It was not measured beyond the extent.
7. The bumps make the formula too steep, so each step overshoots and the next steps back by the same amount, and the distance never drops below the tolerance. The page did not teach *why* the zigzag never shrinks; my answer there is outside knowledge (it needs a local slope of 2 or more). The shell saves the four noises and the division everywhere beyond twice the reach: 22 steps instead of 33.
8. A blend divides once, by the steepest relief near the point. On the plaster, inside the stucco's band, that was 4.67, and outside it 1.11. That is a jump. Zero divided by anything is zero, so the surface did not move. But the normal is taken from the differences between nearby points, and the jump turned it by up to 86°. The fix: when the renderer is working out a normal, it no longer divides (NORMAL_LOOK). The page did not teach why the line moves "farther out the wider the blend".

## 3. Where I got lost (worst first)
- **Section 6's code comments** ("argmax over negative distances", "calcNormals_fast, the pick", "relief.test.mjs's mirror … on Dawn", "unitlint.js", "a round's offset", "Only a group with no code at or above it reads this"). I could not tell which lines matter and which to skip.
- **"the looks a normal takes"** (sections 6 and 8). I read "looks" as appearance. It took me a while to guess it means "the times the normal is computed". Also, the NORMAL_LOOK excerpt only *declares* the flag, so I could not see the fix working.
- **Why taking off distance adds material.** "takes a little off the smaller distance … and a fillet fills the corner": the link (smaller distance means the surface moves outward) is never said. I understood it only from outside knowledge.
- **"A group under group code still divides: its code may read the distance away from the surface"**: opaque.
- **"Bumps 1/k too big … A relief sized in millimetres needs the true scale of the space it is in"**: rushed. Why does a relief need the scale?
- **Section 7: "The swept shapes in shapes.js … their slices have no slope along the path"**: lost me.
- **Section 2's "two families"** (Nsphere, Nbox, sdBox, "scene builder", "primitives"): names I did not need, and they arrive before the figure's point.

## 4. Words and symbols
- union, intersection, subtraction, fillet, warp, relief, noise pattern: the cards helped.
- **Lipschitz bound**: a scary name, but its card ("a promise…") was the most useful one on the page.
- **gradient, ∇**: the card is fine. The fold-out admits "a step of calculus", which is honest.
- **kernel**: used in the WGSL and shader cards and never explained.
- **NaN**: used in the code comment in section 6, explained only in section 8.
- **radians, arc length r·φ** (twist fold-out and code): outside knowledge.
- **octaves** (code) vs **layers** (prose): the page never says they are the same.
- **f32, u32, `4u`, `1e-12`, `${…}` template strings, `mat3x3<f32>()` as a zero matrix, "frame" (XF_M)**: none explained. XF_K is never explained at all.
- **"0.9 × the distance"** (section 7): where does 0.9 come from?
- **probe, flat world, tolerance, march**: understandable, but they lean on chapter 2.

## 5. Figures
- **Fig 1:** clear. Bold line = result, faint = originals. The carve screenshot shows the pointed tail. Calling the "thin lines" contour lines, as on a map, would help. Between the union and blend screenshots the circle moved without comment.
- **Fig 2:** the screenshots draw "lit" as an orange glow and "unlit" as black, but the caption only says "brighter". The purple arrows are never named. In the "before" screenshot the red arrows point *down into the box*, which is a strong picture. The wide screenshot (k 0.90) makes the point well.
- **Fig 3:** the "glass" label sits in the grey water above the ball. The glass tint and the water grey are close, and in the overlap screenshot I **cannot see** which part "has lost its glass": the whole ball looks tinted, with a curve through it. The readouts match the text (0.37 vs 0.82 → glass; 0.06 vs 0.45 → water).
- **Fig 4:** the best figure. The dots, the circle turning red, and readouts 1.77 / 1.56 / 1.13 / 1.00 all agree with the text and the formulas (I checked them with a calculator).
- **Fig 5:** the plot at the right is great, and it explains its changing scale. The "dashed band" is the ring *between two* dashed circles, which is not said. Outside the band the contour lines become perfect circles, a nice hint the text doesn't point out. 6.50 and 0.166 check out with the stated formulas.

## 6. The maths fold-outs
- **Min/max:** followable. Plugging in a = b gives h = k and k/4. "A mix of two slopes is never steeper than 1" needs one sentence: a mix of two arrows of length one is never longer than one.
- **Slope of a blend:** the result and its one-line bug explanation are clear. The derivation is skipped (calculus), and that is fine.
- **Twist:** (u, v) → (u, v + cu) is followable *if* you know r·φ for angles in radians. "Trying every θ (or a little algebra)" hides the hard step. I could confirm 2.618 for c = 1 only with a double-angle identity.

## 7. The code
- **csg\*:** the lead-in explains dot, select, mix, m and t well, and I could trace `t`. `-b` flips the normal too, which is not mentioned.
- **fold:** the two `if`s are clear thanks to the lead-in. The `pass1` line (`H.r.dir`, `UB.normallimit`, `H.r.n > 1.0`) stays opaque.
- **combine:** here `k` is a variable *name*, not the blend's k (that is `blendOf(c)`). The page warns about this for `warp` but not here.
- **twist:** the best excerpt. I could match `sqrt(1.0 + rate*rate*extent*extent)` to √(1 + c²). The rotation line I understood only from outside knowledge.
- **relief:** the lead-in decodes `peak`, `slope` and `reach`, but never says that `${lip}` is 17.2. `READ_REACH`, `marchEps()`, `XF_S` and `DIVIDED_ABOVE` stay opaque.
- **foldRelief:** I followed the three body lines. The comment above them is far too much. The excerpt also stops before the closing `}`.

## 8. Too much, too little
- **Too much:** section 6's comments; section 2's function names; section 7's twist paragraph, which packs measurement, swept shapes and costs together.
- **Too little:** the "1 +" in the slope bound (it is the shape's own slope, I guessed); why the zigzag persists; the last two bullets of section 8.

## 9. Wrong or contradictory
- **Carve paragraph:** "the blend, which takes off up to k/4". For a subtraction, the fold-out's smax *adds* h²/4k ("Its twin … adds a little instead"). Either "takes off" means material, or it is wrong.
- **Code comment vs section 5:** the code comment says the relief is "up to 'amount' high and low", but section 5 says the reach is 1.386 × amount.
- **Section 5 vs section 7:** section 5 says one layer is "4.3 at most", but section 7 says it is only measured, with a later search at 3.854, a 12% margin, "not a proof".
- **Two different 17.2s:** four measured layers vs one proved layer. "By chance" is honest, but I confused them on first read.
- **Section 2:** "mostly made from functions that hand back their normal" sits beside the quoted "most primitives … return NO normal". Two opposite "mosts".

## 10. The five changes
1. In section 1, say that a smaller distance moves the surface outward and a larger one moves it inward. Fix "takes off" in the carve paragraph.
2. Before each section 6 excerpt, say which lines to read and which to skip. Define kernel, NaN and argmax first. Warn about `k` in `combine`. Show where NORMAL_LOOK is read, or say it is not shown. Replace "the looks a normal takes".
3. Fig 3 overlap: make the region that lost its glass visibly different, and put the "glass" label on the ball.
4. Section 5: explain the "1 +", give the two 17.2s different roles visibly, reconcile "amount high" with 1.386 × amount, and say in one sentence why the zigzag never shrinks.
5. Section 8, "line round a cut": add a tiny number example (0.01/4.67 next to 0.01/1.11, and the arrow they give), explain "farther out the wider the blend", and give "Bumps 1/k too big" one more sentence.
