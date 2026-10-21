# Beginner read: "Building and bending shapes" (Part I, ch. 3)

## 1. Teach-back
Each shape is a formula that tells you how far a point is from its surface, and you make new shapes by combining those numbers. The smaller of two distances glues two shapes together. The larger keeps only their overlap. To cut one shape out of another, you flip the sign of the cutter's distance and then take the larger. A smooth blend changes the number where the two distances are within k of each other, which fills a corner with a fillet or rounds the rim of a cut. Shading needs the normal, the arrow pointing straight out of the surface. Before the fix, blending a shape that gives no normal with one that does gave the whole fillet the ball's arrow: the surface was in the right place but lit wrong. Now the renderer works the normal out itself. For "what am I inside?", it picks the solid the point is least deep in. That works when one solid sits inside another, but it guesses wrong when two solids overlap. A twist moves the point instead of the shape. That stretches space, so the formula grows faster than a real distance and a step can land inside the shape. Dividing by the steepest slope fixes this, and ShadyTracer's divisor is a little too small. Noise bumps cause the same problem. Dividing makes them safe but slow, and a "shell" skips the noise far from the surface.

## 2. Quiz
1. Use max(box, −circle): flip the cutter's sign, then take the larger. The page taught this clearly.
2. A smooth blend changes the distance only where the two distances are within k. For a union it subtracts up to k/4; for an intersection or subtraction it adds. k sets how far the rounding reaches, and k = 0 is a hard join. Taught.
3. The box gives a zero arrow. Mixing zero with the ball's arrow and making the result one unit long always gives back the ball's arrow. So the lighting was wrong while the distances were right. Taught well.
4. Among the solids the point is inside (negative distance), the renderer picks the one it is least deep in. That fails when solids overlap and neither is inside the other. Taught, but the page never shows a point where "nearest surface" and "inside which solid" give different answers, so I didn't see why two rules are needed.
5. A twist stretches space, so the formula changes up to 1.77× faster than a real distance and a step overshoots. The fix: warp() shrinks the distances and zeroes the normals. Taught.
6. √(1+c²) covers only a move straight along the axis. A move that is partly along and partly around stretches more, up to (c+√(c²+4))/2, which is up to about 15% more. How sure: "measured" in a node test on a copy of the arithmetic, and not measured beyond the extent. I couldn't work out where the "0.9 × the distance" step comes from.
7. Only half taught. I learned that each step overshoots and the next undershoots, forever. The page never says when a march is allowed to stop, so I only know "it never stops" from *outside knowledge* (that it stops once the distance falls below a tolerance). The shell: farther than twice the reach from the plain circle, use the plain distance minus the reach. No noise and no division there, which took the ray from 33 steps to 22.

## 3. Where I got lost (worst first)
- **Twist fold-out:** "the largest singular value of the matrix [[1, 0], [c, 1]]". I don't know matrices or singular values, and L just appears. *Outside knowledge.* Also, "moves the turned point around by c·u" needs "arc length = radius × angle", which the page never states.
- **Section 4 main text:** "a move straight along the axis". The flat figure has no axis. Only the end of the fold-out says that "up" means "away from the middle" there.
- **Blend fold-out:** "Working out how it changes when a or b changes gives ∇ smin = …". This is calculus, which I don't have. I have to trust the result.
- **Fold-out 1:** "The blends … add at most k/4, and stay safe too." Chapter 2's rule is "never too large", so how can *adding* be safe? The missing step is that the shape shrinks, so the true distance grows too.
- **Section 6 excerpts:** `H.r.dir`, `UB.normallimit`, `H.r.n > 1.0`, `add_new`, argmin/argmax, `XF_K` and `READ_REACH` are never explained.
- **Section 8, "Bumps 1/k too big":** "needs the true scale of the space it is in" is too rushed to follow.

## 4. Words and symbols used before they were explained
- **∇:** the gradient card helped.
- **mix(…):** used in fold-out 2 but defined only in section 6.
- **NaN:** appears in a code comment (section 6) but is explained only in section 8.
- **No explanation at all:** WGSL, kernel, shader, VEC4's `.w`/`.xyz` (inferable), `dot(a,a)` as length squared, octaves, "gradient noise" (which clashes with the gradient card), pips, "in node", "64-bit numbers", "flat world", "accent colour" (I guessed red).
- **Lipschitz bound:** the card exists and is good, but the prose never uses the term; it says "slope bound". The card would help most next to "steeper than 1" in section 4.

## 5. Figures
- **Fig 1 (joins):** clear, and the readout naming min/max/−circle is excellent. The carve screenshot has a sharp spike at the bottom right, which looks odd next to "comes out smooth". The text says "a hole drilled", but the figure shows a bite out of the edge.
- **Fig 2 (fillet normals):**
  - "Before" and "wide" make the point, and some red arrows even point *into* the box, which the text could say.
  - In "now" the red arrows converge into a tangle. That is correct for a curved-in fillet, but it reads as a mess.
  - The box "gives no normal", yet arrows are drawn on its top, and nothing says where those come from.
- **Fig 3 (glass in water):**
  - Nested and overlap work.
  - The "pool" is a disc, yet the text says "waterline".
  - In the overlap shot the probe's circle is too small to see, and the glass region's edge is jagged.
  - Nothing says which cross is the probe (I guessed the red one).
- **Fig 4 (swirl):** strong. The dots and the red circle reaching into the arm make the danger visible. Nice detail: the raw slope of 1.77 equals the exact divisor of 1.77, but the page never says so. "Still steeper" in the caption is odd for the undivided case.
- **Fig 5 (relief):** the side plot's scale changes between modes (±0.009, ±0.068, ±2) and so do its step ranges. In "shell", the first point at 2 flattens everything else, so you can't see the settling. The divided shot's sparse contour lines show "short steps", but nothing points that out. "Cut through at one height" confused me in a flat figure.

## 6. The maths fold-outs
- **Min/max:** followable, but "never larger than it" for max and for the blends has to be taken on trust.
- **Blend slope:** the setup and conclusion are followable, and "the bug, in one line" is great. The derivation step is calculus.
- **Twist:** I could follow it through u² + (v+cu)² and the "1 + c²" case. I was lost at singular values. Writing u = cos θ, v = sin θ and finding the largest value over θ, or simply saying "found by trying every direction", would keep me with it.

## 7. The code
- **csgUnion:** the caption's select/mix definitions helped. The `m`/`t` line (`m + (1 − 2m)·0.5·h/k`) stayed opaque until I compared it with t = h/2k myself.
- **fold:** the two `if`s match section 3. The capture block and the backface line are opaque.
- **combine:** JavaScript writing WGSL. I couldn't read it; the caption carried it.
- **warp:** it is called with 1/divisor, but the prose says "calls it with the divisor".
- **Relief excerpt:** 27 lines, almost all a dense comment, and it stops at `slope` before any shell code, although the intro promises "its shell".
- **Twist excerpt:** the cos/sin line is a rotation. I know that only from *outside knowledge*.

## 8. Too much, too little
- **Too much:** section 6 has five excerpts of jargon-heavy comments, and section 7's MEASURED notes pile up 3.437, 3.854, 12%, 25%, 1.25, 4.3 and 17.2.
- **Too little:**
  - why the march stops;
  - why two "inside" rules exist;
  - how 4.3 per layer becomes the figure's slope bound of 6.50 (amount/size and the four layers);
  - why bigger bumps lower the slope (the Try-it asks this but the text never teaches it).

## 9. Wrong or contradictory
- Before foldRelief: "the next section says why". The reason is in section 8, not section 7.
- Section 2 says "Many … give their normal … some give none". The csgNormal comment says "most primitives (sdBox and every sd() one) return NO normal".
- The MEASURED card promises "real hardware … who, on which graphics card". The twist entry was measured "in node, in 64-bit numbers" and names no person or card, and the noise entry names neither.
- Section 8 calls k "the twist's divisor", but in `warp(k)` k is the multiplier (1/divisor). k is also the blend size elsewhere on the page.
- Section 7 says the relief "divides by … 4.3", while Fig 5 shows "slope bound 6.50" with no bridge between them.

## 10. The five changes, most important first
1. Fix the contradictions in §9: the "next section" pointer, many vs most normals, the MEASURED card vs node measurements, and k as divisor vs multiplier.
2. Make the twist and blend fold-outs work without calculus or matrices. Use a cos θ/sin θ search for the largest stretch, state arc length = rθ, and label the gradient step "needs calculus, here's a check at a = b".
3. In section 5, say when a march stops and why an overshoot repeats. Keep the plot's scale fixed (or say it rescales), and link 4.3 → 6.50 → "wider bumps, gentler slope".
4. In section 3, add a probe position where the nearest surface is the glass but the point is in the water, to show why there are two rules.
5. Trim section 6. For each excerpt, name the 2–3 lines to read, explain `.w`/`.xyz` and `dot(a,a)`, and show the shell's actual lines.
