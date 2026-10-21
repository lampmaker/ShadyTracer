# Beginner's review of "Shapes as distances" (ch/distances)

## 1. Teach-back
In ShadyTracer a shape is a formula, not a set of triangles. The formula tells you how far any point is from the nearest surface: positive outside, zero on the surface, negative inside. To combine two shapes you take the smaller of their two distances. A smooth blend takes a little off where the two distances are close, which gives a rounded join. To find where a ray hits something, you ask for the distance, move forward by about that much (0.9 of it), and repeat. Nothing is closer than that distance, so the ray can't jump over anything. Rays that skim past an edge take many small steps, so edges and grazing angles cost the most. The march stops when the distance drops below a tolerance, or when the ray is outside the scene's circle and heading away (then it gets the sky). If a formula ever claims more empty space than there really is (a squashed circle does), rays step through surfaces, and nothing looks broken. The fix is to divide by how much faster than a real distance the formula can change.

## 2. Quiz
1. A negative number. Its size says how deep the point is.
2. The distance is to the *nearest* surface in any direction, so a circle of that size around the point is empty, and a step that long can't cross a surface. Section 5 adds that a true distance never changes faster than you move.
3. Rays that pass close to a surface without hitting it, because every distance is small, so every step is small. In 3D that means the outlines around shapes and the floor near the horizon.
4. The ray overshoots. It jumps thin walls or lands inside things and comes out the far side, and the pixel shows sky with nothing looking broken. *The page did not teach me, at that point, why landing inside doesn't count as a hit* (see section 3 below).
5. It decides how close counts as a hit. Too big: near misses count as hits, edges get fat and gaps close. Too small: more steps.
6. The promise is that the formula never changes faster than a true distance. The fix is to divide by its steepest slope (multiply by s for the ellipse).
7. Each step it checks whether the ray is outside the scene's radius and moving away from the middle. *How* two "dot products" test that was not taught. I only know it from outside knowledge.
8. Inigo Quilez's articles (2D/3D distance functions, smooth minimum), and Hart's paper for sphere tracing.

## 3. Where I got lost (worst first)
- **"the march stops when the distance is below a small number"** (§3). Then in §3 and §4 rays land *inside* the ball and keep going: "steps inside and, from then on, further in with each step, until it comes out the far side". Inside, the distance is negative, and that is below a small number, so it should have stopped. The answer ("uses the absolute distance") only arrives in §6's last bullet. Until then the overshoot figures contradict the rule I had just learned.
- **"ShadyTracer asks where the ray is, not how far it has gone"** (§3). Then the code stops on `ray.ltot > lmax`, and the caption says "gone too far". Nothing explains that this is a different kind of stop from an escape.
- **"two dot products"** (§7) and `dot(ray.pos, ray.dir) > 0.0`. I know vectors as arrows, not dot products. The page also never says the scene's middle is at (0,0,0).
- **§5's leap.** "Never changes faster than you move" and "never claims more room than there is" are treated as the same thing. The missing sentence is: *it is zero on the surface and grows at most one per unit, so it can never exceed the true distance.*
- **"A ray starts somewhere and wants to know where it first hits anything"** (§2). What a ray is *for* (one per pixel, to make a picture) only comes in §4, and §3 already says "The pixel shows the sky". I filled this in from outside knowledge.
- **The §5 code header** is unreadable for me: "inside glass it is stepped through from within", "JS twin", "dense spines", "sign flips in f32", "15-46% of the solid".

## 4. Words and symbols
- **Ray, pixel, triangles:** used without explanation. I understood them only from outside knowledge.
- **WGSL:** appears in every code label and is never explained.
- **f32:** used in the §5 code before its card in §8. The card itself (the ruler with marks that spread apart) is excellent.
- **kernel:** the card says "Each of ShadyTracer's samples is a dozen kernels", which brings in "samples" without explaining it.
- **sdf.js:227, transform.js:9, wavefront.js:821:** this file:line notation is never explained.
- **"the scene's radius":** labelled in figure 2 before §3 explains it.
- **Cards that helped:** SDF, union, fillet, escape ("a ball around everything") and shadow ray all helped. Lipschitz helped, though the word itself is scary.
- **normal:** the card helped. But §8's "normals of the wrong length" baffled me: a direction has a length?

## 5. Figures
- **Fig 1:** clear, and the contours read as map height lines. Two problems. The inside probe's circle is red and dashed, which nothing explains. And the caption's "holds nothing else" seems false when the circle is full of the shape; "no surface crosses it" would say it. The blend bulge "under the box" is visible but subtle.
- **Fig 2:** the march screenshot works. In it, the red "aim" handle overlaps the ball's own handle, which is confusing. The graze screenshot (27 steps) makes the point well.
- **Fig 3:** the tolerance screenshot is very clear ("a near miss, counted as a hit"). In the overshoot screenshot, the wall's circled cross sits exactly on the ray and looks like a step dot, so I thought the ray stopped at the wall. The escape screenshot crosses the dashed circle at the top edge, where it is clipped.
- **Fig 4:** the steps view and its legend are good. The text says "pale for few and red for many" but doesn't mention the blue in between. At 1.6 the text says "the ball is gone", but the screenshot keeps a dark rim of the ball. The sky "beneath" the floor is just a thin strip at the bottom; easy to miss. Normals mode is in the caption but never shown or discussed.
- **Fig 5:** the lie screenshot works ("inside the shape!"), though the red circle is only an arc, so I couldn't see that it is centred on start. In the fix screenshot the ray reaches the surface in one visible hop. I couldn't find the "3 steps" or see that the steps "get shorter".

## 6. Maths fold-outs
- **Circle/union/blend:** I could follow it, and the |−3| = 3 note helps. "most (k/4) where equal" I could check myself. The definitions ran together in one paragraph.
- **Dividing by the slope:** "far from the middle" puzzled me, because why far? Saying "along the x axis, where y = 0, f = |x|/s − r" would let me check it without calculus. "So f can be up to 1/s times too large, and f_safe = s·f never is" reads oddly because the formula interrupts the sentence.

## 7. The code
- **widgets.js:** the caption explains the box well, except the case "outside one side only". `hx, hy` (half sizes?) and the `=>` arrow syntax went unexplained.
- **wavefront.js:** the caption helps with the structure. Still opaque: `hit.s.w`, `UB.`, `atomicAdd`, `shadeBuffer`, `RAY_MAXITER`, `moveBy`, and the comments about "0.36.0", "SCN_TOL", "culling", "MAT_SKY", "add_new", "32 of them per march iteration" (a different 32 from §6's "32 steps a round"?).

## 8. Too much, too little
- **Too much:** §6's long code comments and §8's sign(0) item are aimed at developers.
- **Rushed:** §5's central argument, and the escape test.
- **About right:** §§1–3. Strong and well paced.

## 9. Wrong or contradictory
- "Most rays need only a handful of steps" (§2), but figure 4 averages 32.4 steps a ray.
- "Stops when the distance is below a small number", while inside-the-ball rays keep marching (resolved only in §6).
- "Not how far it has gone", but the code has `ray.ltot > lmax`.
- "The ball is gone", but a rim remains in the screenshot.
- Section 2 says each hop goes 0.9 of the way to the circle's edge, but in fig-5-fix the hop appears to reach the edge.

## 10. The five changes
1. **Explain the absolute distance where step scale >1 first appears (§3).** Say that inside a shape the march uses the distance's size, so the ray marches on rather than stopping. Move §6's bullet up to there.
2. **Add the one sentence linking §5's two ideas.** "Zero on the surface, grows at most one per unit, so it is never more than the true distance." Also replace "far from the middle" with the y = 0 case.
3. **Explain the escape test in plain words.** pos·pos is the squared distance from the middle (at the origin), and pos·dir > 0 means heading away. Also explain the `ltot > lmax` stop, or cut it from the excerpt.
4. **Fix the figure and text mismatches:**
   - the ball's rim at 1.6;
   - the wall handle on the overshoot ray;
   - the red dashed inside circle and "holds nothing else";
   - "the scene's radius" before §3;
   - fig 5's invisible steps.
5. **Trim or gloss the §5 header and §6 comments.** Explain WGSL and file:line once, and say early what a ray and a pixel are for.
