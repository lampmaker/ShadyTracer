# Beginner review: "Shapes as distances" (ch/distances.html)

## 1. Teach-back
A shape can be stored as a formula that tells you, for any point, how far away the nearest surface is. Outside, that number is positive, on the surface it is zero, and inside it is negative. For a circle you take the distance to the middle and subtract the radius. To combine two shapes you keep the smaller of their two distances, and a "blend" takes a bit off where they are close so they melt together. A ray finds a surface by asking for the distance, moving that far (nothing can be closer) and asking again. Near a surface the steps shrink, so it creeps up to it. It stops when the distance is below a small tolerance, or when it is outside the scene's circle and heading away, in which case it gets the sky. Rays that skim past edges take the most steps. Stepping further than the distance, or using a formula that claims too much distance (like a squashed circle), lets rays pass through walls. So every formula must never be too large, and the fix is to divide by how much too fast it grows.

## 2. Quiz
1. A negative number. Its size is how deep the point is. Taught clearly.
2. The field promises that nothing is closer than that distance in any direction, so a step of that length cannot cross a surface. Taught clearly.
3. Rays that pass close to a surface without hitting it, at edges and along the floor near the horizon. Every distance they get is small, so every step is small. Taught. (The steps screenshot's reddest area, the top of the image, is not explained.)
4. The ray can jump through a thin wall and show a surface it could never have seen, or the sky. Nothing looks obviously broken. Taught.
5. How close counts as a hit. If it is too big, rays stop short: edges go soft and thin gaps close. Taught, but no screenshot shows it.
6. The promise is that the formula never changes faster than a true distance. The fix is to divide by how much faster it changes. Only half taught: I could repeat the words but not explain them (see §3).
7. When the ray is outside the scene's radius and moving away from the middle, judged by where it is, not how far it travelled. Taught in prose. I could read the `dot(...)` test only from outside knowledge.

## 3. Where I got lost (worst first)
- **§5: "how much faster than a real distance the formula can change."** The page never says that a true distance changes by at most 1 for each 1 you move. Without that, "faster", "steepest slope" and "one over the squeeze" mean nothing to me. Slope of a field in 2D is calculus I don't have. I followed it only from outside knowledge.
- **§5 figure: "The red circles claim to be empty and are not, and the ray lands inside."** fig-5-lie shows no red circles at all, and its readout says "4 steps · stopped at the surface". The main demonstration of the chapter's "one rule" is not visible.
- **§3: "Why move only 0.9 of the distance? Because a step longer than the real distance can carry the ray straight through a thin wall."** That explains why not *above* 1, not why not exactly 1. The real reason (a formula might be slightly too large) only appears in the step-scale card and in §7.
- **§3: "The distances shrink but never quite reach zero."** Why not? If I aim straight at a wall and step the full distance, I land on it. Nothing explains that a slanted approach, or the 0.9, keeps a gap.
- **§4: "with a shadow ray where it hits."** I don't know what a shadow ray is.
- **§6–8 jargon:** "GPU thread", "put back in a queue", "the two circles do not overlap" (which two?), "asks the scene three more times per hit" (why three?), "sign(0) is 0 … normals of the wrong length".

## 4. Words and symbols before explanation
- **ray**: no card. I assume it comes from Chapter 1.
- **fillet**: no card. To me this is fish. The fig-1-blend picture shows what it means once I guess the link.
- **step scale**: appears in fig 2's caption before §3. The card helps.
- **|p − c|** is explained as a length. **|d₁ − d₂|** uses the same bars to mean "absolute value", and that is never said.
- **dot product**: §7 says "two dot products". No card, and not taught at school for everyone.
- **kernel**: the card helps. **GPU thread**: no card.
- **f32**: the card helps a little. "Seven significant digits" makes sense, but "the computer's numbers can tell apart" is a new idea and gets one line.
- **Lipschitz bound**: the card repeats the same unexplained "changes faster", so it didn't help.
- **normal**: the card's "direction the distance grows fastest" would click if it said "uphill on the height-line map".
- **dearer**, **over-relaxed**, **Quilez**, **JS twin**, **culling**: none explained.
- The **"READ IN CODE" / "INFERRED"** stamps are never explained. I don't know why some paragraphs carry them.

## 5. Figures
- **Fig 1 (distance field).** Clear and the best part of the page. The blue circle outside, red dashed inside and the ± readout make the sign obvious, and the height-map comparison works.
  - The text says "as large as it can be without touching the shape", but the caption says "touches".
  - The blend slider is shown and looks active in "A circle" and "Circle and box" modes, where it does nothing.
  - In fig-1-blend the probe's circle is drawn open, like a "C".
  - The box has a small bump below its bottom edge after blending, and nothing explains it.
- **Fig 2 (march).** fig-2-graze makes its point very well: small circles crowd along the block and the ball, and the readout says 27 steps against 4.
  - "aim" looks like the place the ray should end. Say it only sets the direction.
  - "the scene's rad…" is cut off at the right edge.
- **Fig 3.**
  - fig-3-tolerance: at 0.25 the ray stops perhaps 3 pixels earlier than in fig-2-march. "Stops short" is invisible.
  - fig-3-overshoot contradicts the text (see §9).
  - fig-3-escape is clear, but the scene's "middle" is never marked.
- **Fig 4 (3D).**
  - In "Picture", the sky and the floor are the same beige, so I can't see a horizon.
  - In "Steps", the outlines are dark blue and red, not "bright". The reddest (dearest) area is the top band, which the text never mentions.
  - In fig-4-scale the red ball has vanished entirely and a pale-blue area appears. The text says only "edges" and "sky beneath". I had to guess that pale blue is the sky.
  - No screenshot of "Normals", and nothing says how a direction becomes a colour.
- **Fig 5 (squashed circle).** See §3: neither screenshot shows the failure. "squash × 0.30" against "squeeze" and "one over the squeeze" left me unsure whether 0.30 is the squeeze or its inverse.

## 6. Maths fold-out
- The circle and the union are easy to follow.
- In the blend I can follow h, but h²/(4k) comes from nowhere, and nobody says the "blend" slider is k.
- As I received it, the key runs together: "the point k -- how far the blend reaches" reads as if k were a point. Check how the page lays it out.
- §5 badly needs a fold-out of its own. For example: "squeeze x by s, the formula reads x/s, so moving 1 changes it by up to 1/s".

## 7. Code
- `circle` is clear. The `box` code stays opaque: what hx and hy are, and why abs, max, min. The text promises "a few more lines" and never explains them. `len` is never defined.
- The march: the intro explains sceneAt, marchTol and stepscale, and that is enough to read lines 853–854 and 877–879.
- What stays opaque:
  - `hit.s.w` (only later "the absolute distance").
  - `ltot`/`lmax` and `maxiter`.
  - The whole `atomicAdd`/`shadeBuffer` block. One sentence would do: "a hit is put on a list for the next stage".
  - The comment's "32 of them per iteration", which I confused with "at most 32 steps at a time".
- The shapes.js header is almost entirely jargon to me: f32 sign flips, "dense spines", "point-to-triangle".

## 8. Too much, too little
- **Too much:** §6–8 is written for programmers on the project: the sky dome twice, file:line references, the pyramid percentages twice.
- **Too little:** §5, the most important rule, gets two short paragraphs. Also too short: why distances never reach zero, and the tolerance.
- §4's "for a few more steps a ray" undersells it: the readouts show 25.7 average steps at 0.9 against 13.4 at 1.6, nearly double.

## 9. Wrong or contradictory
- **§3 vs fig-3-overshoot.** The text says the ray "goes on to hit the ball". The screenshot shows it passing through the ball as well, with the readout "escaped — straight through a surface".
- **§5 vs fig-5-lie.** The text promises red circles and a ray ending inside. The screenshot has no circles, and the readout says "stopped at the surface".
- **§5 "The steps get shorter"**, but the fixed version takes 3 steps against 4 for the raw one.
- **§2:** "hops from the middle of one to its edge", but at 0.9 it stops short of the edge.
- **"Bright outlines"** in §4, but they are drawn dark.
- **§9:** "largest squeeze" is ambiguous: the largest slider value, or the strongest squash?

## 10. Five changes, most important first
1. Fix fig 5 so the raw formula visibly fails at its default (red circles, a ray ending inside). Add one sentence: "a real distance changes by at most 1 for each 1 you move; the squashed formula can change by 1/0.3".
2. Make fig 3's overshoot match the text (a ray that hits the ball), or change the text to "and the ball too, then the sky".
3. In §3, say why 0.9 and not 1.0, and why the distance never quite reaches zero.
4. Explain fig 4: which area is sky and which is floor, why the top is reddest, that the ball vanishes at 1.6, and what a shadow ray is.
5. Trim §6–8 for beginners. Explain the box in words, gloss `hit.s.w`, maxiter and the shade queue in one line each, define "thread" and "dot product", and explain or remove the READ IN CODE / INFERRED stamps.
