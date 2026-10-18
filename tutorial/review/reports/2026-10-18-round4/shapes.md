## 1. Teach-back
You can build new shapes out of old ones by combining their distance numbers. Take the smaller of the two distances and you get both shapes together (union). Take the larger and you get only the overlap (intersection). Flip the sign of one shape's distance before taking the larger and you cut that shape out (subtraction). A smooth blend changes the number a little where the two distances are close (within k), and that rounds the corner into a fillet. Light needs the surface's normal arrow. When one shape had no normal, the old blend just used the other shape's arrow, so the fillet was lit wrongly even though it was in the right place. To decide which material a point is inside, the renderer picks the solid it is least deep in, and that guess fails when two solids overlap. Twisting works by turning the point instead of the shape. That stretches space, so the distance has to be divided by how much it stretches, and ShadyTracer's divisor is a bit too small. Noise bumps also make the distance too steep, so it is divided too. A "shell" only bothers with the noise near the surface.

## 2. Quiz
1. Use max(box, −circle): turn the circle inside out by flipping its sign, then take the larger.
2. Where the two distances are within k, it takes off up to k/4 (h²/4k), or adds it for max, and fills the corner with a fillet. k sets how far the rounding reaches.
3. The box gave no normal (a zero arrow). Mixing zero with the ball's arrow and stretching the result back to length 1 always gives the ball's arrow. The distances were right, so only the lighting was wrong.
4. Of the solids with a negative distance, it picks the one it is least deep in. That is wrong when solids overlap without one being inside the other, e.g. a point inside the glass but nearer to the water's surface.
5. A twist stretches space, more the farther you are from the axis. The formula then gets steeper than 1, claims empty space that isn't empty, and a step can jump through the surface. The fix: `warp(1/divisor)` shrinks the distances and zeroes the normals.
6. √(1+c²) only covers a move straight along the axis. A diagonal move stretches up to (c+√(c²+4))/2. In the figure a slope of 1.13 is left. In 3D, a tilted plate gives 1.14, so a step can be about 3% too long. This is "MEASURED" by a test program in 64-bit numbers, not proved, and the region beyond the extent is not measured. The page doesn't teach where "a step of 0.9 × the distance" comes from.
7. Each step lands just past the surface and the next steps back short by the same amount, so the distance never falls below the tolerance. It gives up at 300. The page says this happens but not *why* it never settles. The shell skips the noise and the division far from the surface: 22 steps instead of 33.

## 3. Where I got lost (worst first)
- **§5 the slope bound:** "1 + (amount ÷ size) × 17.2 ÷ 1.875 … (4.3 a layer … for four layers…)". Why is a layer that is half as strong still 4.3 steep? (I only know it's because it is also twice as fine: *outside knowledge*.) Where does 1.875 come from (1+½+¼+⅛)? It isn't said.
- **The two 17.2s:** §7 then says "One layer … can be proved never to slope more than 17.2". So 17.2 means 4×4.3 in one place and the proved one-layer bound in the other. I couldn't tell which one the relief uses.
- **§5 "further than twice that":** why twice the reach and not once? Only the code comment explains it ("a ray grazing it would crawl").
- **§2 "The shapes the scene builder offers mostly give their normal … the plain shapes of the renderer's shape library give none":** two kinds of shapes I've never met, and nothing says which kind I'd be using.
- **§8 "Bumps 1/k too big … sized in millimetres … the scale ShadyTracer kept":** I don't know what this "scale" is or why the bumps need it. It's rushed.
- **§7 "a step of 0.9 × the distance":** the 0.9 appears for the first time here.
- **The §4 fold-out:** "the very same matrix": matrix is never explained. "Trying every θ (or a little algebra)" skips the step that matters.

## 4. Words and symbols
- *WGSL, shader, kernel, NaN, argmax/argmin, octaves, gradient noise, radians, medium, backface, modifier, group*: all used in code or captions without explanation. NaN is explained only in §8, after the excerpt that uses it.
- *accent colour*: never named. From the screenshots it is red.
- *k* means the blend width in §1, but warp's parameter in the excerpt and "the twist's factor k" in §8.
- *shell* means the relief's band in §5, but "nothing for round and shell" in §7 seems to be a different modifier.
- *flat world*: I'm guessing it means the 2D drawings.
- The cards helped. Normal, gradient, warp and Lipschitz bound were clear. fBm's "fractional Brownian motion" means nothing to me, but its first sentence is fine.

## 5. Figures
- **Fig 1:** clear. The bold line against the faint outlines works. In fig-1-carve the blended cut leaves a thin pointed tail along the box's bottom edge. The text says the blend "rounds the edges", so the spike surprised me.
- **Fig 2:** "before" is convincing: red arrows point down-left, some into the box. "Now" is confusing: on the concave fillet the red arrows cross and converge at a point, which looks like a mess and not "square to the surface". Nothing says that the orange thick line means "lit".
- **Fig 3:** clear readouts. The "glass" label sits above the ball, in the water. In overlap the lost-glass sliver is very hard to see, and its wiggly edge isn't explained.
- **Fig 4:** the dots and the red/blue probe circle make the point well. "Not divided" (steepest slope 1.77) and the exact divisor (1.77) give the same number, and the page never says that's no coincidence.
- **Fig 5:** the zigzag plot is excellent. The shell plot's ±2 scale makes steps 2–22 look like zero, so it seems the ray arrived after one step, and I wondered why it needed 22.

## 6. Maths fold-outs
- **Fold-out 1:** I could follow it. I took "a mix … never steeper than 1" on trust. One line saying "an average of two arrows of length 1 is at most 1 long" would help.
- **Fold-out 2:** it honestly skips the calculus, and the last line ("the bug, in one line") lands well.
- **Fold-out 4:** the first half (r·φ, then (u, v+cu)) was clear. But the largest value of cos²θ+(sinθ+c cosθ)² is L², not L. For c=1 I'd compute 2.618 and the page says 1.618.

## 7. The code
- **csgUnion / select:** readable thanks to the `select` and `mix` notes. `t = m + (1 − 2m)·0.5·h/k` stayed opaque: say "t = h/2k when a is nearer, 1 − h/2k when b is".
- **fold:** `UB.normallimit`, `H.r.n > 1.0` and everything under `LOCAL_CAPTURE` stayed opaque.
- **codegen:** `${km}`, `MAT_WINS`, `joinOf`, `-C.s` stayed opaque, and so did "Hard at the middle of a blend".
- **warp:** `XF_K` is never mentioned.
- **twist:** the rotation formula isn't explained.
- **relief:** `READ_REACH`, `marchEps()`, `DIVIDED_ABOVE` and the arguments to `fbm3` stayed opaque.
- **foldRelief:** fine, given §8.

## 8. Too much, too little
- **Too much:** §6 has five long excerpts whose comments repeat the prose. The relief comment alone is 17 lines.
- **Too little:** §5's bound, §8's last bullet, and the repeat trick in §7 (introduced and dropped in two lines).

## 9. Wrong or contradictory
- **Fold caption vs text and code:** the caption says the first `if` is "the most negative distance, deepest inside". The text says "least deep", and so do the code comment and the code (`sdf.w > H.insideW`).
- **§7 "nothing for round and shell (excerpts above)":** there are no round or shell excerpts above.
- **§2 vs the excerpt comment:** §2 says builder shapes "mostly give their normal". The comment says "most primitives … return NO normal".
- **§5 vs §7:** §5 says "Divided by the steepest the noise can make it". §7 says that number is only measured, and a later search found a steeper slope.
- **The relief's height:** the relief comment says bumps go "up to 'amount' high", but the readout says the reach is 0.166 for amount 0.12 (1.386×).
- **Fold-out 4:** L vs L², as in section 6.

## 10. The five changes
1. Fix the fold caption: the solid kept is the *least* negative distance.
2. Rework §5's bound: explain why every layer is equally steep, show where 1.875 comes from, stop using 17.2 for two different things, say it is measured before §7 does, and say why the band is twice the reach.
3. In §2, explain the two families of shapes and square that with the comment. In Fig 2, name the accent colour, say orange means lit, and note that arrows on a concave fillet converge.
4. In fold-out 4, write L² for the squared stretch (or show the algebra), and drop or explain "matrix".
5. In §6, add one paragraph on what WGSL and a shader are, explain the `t` line, fix "round and shell (excerpts above)", and rename warp's k.
