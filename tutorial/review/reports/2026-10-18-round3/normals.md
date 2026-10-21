# Beginner's review: "Which way is up" (ch/normals)

## 1. Teach-back
When a ray hits a surface, the renderer needs the normal: an arrow one unit long that points straight out of the surface. In a distance field the normal is the direction in which the distance grows fastest, which the page calls the gradient. Some shapes, like a sphere, give their normal directly: the arrow from the centre to the point. For the other shapes the renderer works it out by differences. It asks for the distance a small step away along each axis and turns how much it grew into an arrow. Forward differences look one way along each axis. Central differences look both ways, which takes twice as many looks but is much more accurate. Near a crease a look can land on the other shape, so the normal blurs there over about one step's width. The step can't be tiny, because the GPU's numbers have only about 7 digits, and rounding then makes the normal noisy. ShadyTracer therefore never uses a step smaller than 128 "spacings". When the shapes' own normals were turned off, a frame took 4.3 times as long, and nobody knows why yet.

## 2. Quiz
1. **Normal:** an arrow one unit long, straight out of the surface. It is the field's gradient, the way the distance grows fastest, at right angles to the lines of equal distance.
2. **Shape gives none:** it asks the scene's distance a small step away along each axis (forward differences). That is 3 extra looks in 3D (2 in 2D), because the distance at the point itself is already known "from the march". The pick tool uses central differences, which take 6.
3. **Central vs forward:** the page says forward's error shrinks "as fast as the step" and central's "as the step squared". It also says forward differences "lean" because they look only one way. The real *why* is left to "a Taylor series", which I don't know: **not taught**. Central differences cost twice the looks (6 instead of 3).
4. **Tiny step:** f32 numbers come in jumps (0.12 µm apart at 1 m). With a step of only a few jumps, rounding decides the difference, and the normal is off by up to 110 mrad (6°). On a shiny surface that shows as grain in the highlight. The code comment adds that "the march can stall".
5. **Floor:** the normal's step is never smaller than 128 f32 spacings at the point (128 × 2^-23 × its largest coordinate). The number came from an f32 emulation that measured the noise at different step sizes: 5 mrad at 128. The page does **not** say what counts as acceptable, why 128 and not 256, or why it isn't the ~700-spacing minimum that Figure 2 shows.
6. **Turning off own normals:** 4.3× slower, 63.6 vs 14.8 ms a sample on "the user's Pascal card". Unknown: why it costs that much, when 3 looks against a march of dozens should cost a few percent. Timing each kernel with the setting on and off would show which kernel grows.

## 3. Where I got lost (worst first)
1. **Section 3's code comment.** It mentions "UB.eps", "a bench row's or the library studio's", "UB.epsAuto, photometry.js sceneEps", "Renderer panel's row in um until then", "TOL_MIN_M" and "autoEps". Only the third term is explained. Then "one to two of them there, so the floor is 128 to 256" contradicts the page's plain "floor of 128 spacings".
2. **"Those two changes, as an arrow, point uphill."** Why should they? A hill picture would help: going right raises me 3, going up raises me 1, so the steepest way is about (3, 1). Without it I took the idea on trust.
3. **"central's [error shrinks] as fast as the step squared … (a Taylor series says why)."** This needs to be said plainly: halve the step and the error drops to a quarter. I only know what a Taylor series is from *outside knowledge*.
4. **Tiny circle:** "Its own numbers are small, so f32's rounding hardly shows." But this circle is also a metre from the origin, and the page just told me a distance there "can only change in such jumps". I can't square the two. (The answer is that the length in the subtraction is small, which I only know from *outside knowledge*.)
5. **"The best step sits between the two."** The graph's minimum is around 512–1024 spacings, yet the floor is 128. The Try-it asks "Why is 128 a little below both?" and the page never answers. I also had to work out myself that the normal's actual step is usually the surface tolerance, not the floor.
6. **calcNormals_fast:** `f32(k == 0u)`, `0u`, `.s.w`, `res`, `Hit`, `normalTol` and `UB` are all unexplained. normalTol and marchTol are never connected.
7. **"2 more looks"** in the readout: more than what? This is only answered inside the fold-out.

## 4. Words and symbols
- **Cards that helped:** normal, normal by differences, and f32 (the ruler analogy is good). The gradient card is fine.
- **march:** has a card, but its first use (in the fold-out) isn't marked.
- **surface tolerance:** the card says what it is, not why it doubles as the normal's step.
- **Never explained:** GPU (assumed), shader, kernel, compiler, unroll (half explained), WGSL, VEC3/VEC4/FLOAT, mrad (the "eighth of a degree" helped), log scale, Taylor series, Math.fround, emulation, "Pascal card", sample vs frame, pick, sign(), "facing test", fillet, blend, "Quilez's list".

## 5. Figures
**Figure 1.** A circle joined to a box, a probe, and three arrows.
- The grey rings are never said to be lines of equal distance. I knew from *outside knowledge*.
- The units of h are not given.
- The dot legend doesn't match what I see. The caption says "plain dots" are forward (two) and "ringed dots" are central (four). On screen there are two filled dots (up and right) and two hollow ones (left and below). I had to guess that the filled ones are shared by both methods.
- In fig-1-round only "exact" is labelled, though the caption promises "each arrow labelled".
- In creaseSmall the three labels overlap into an unreadable pile.
- The crease shot: "leans 20° towards the box", but the red arrow visibly tips *upward*, away from the box. I worked out that this means toward the box's top-face normal; a beginner may not.
- The "small" paragraph's numbers (3.9°, 0.6°) are the ones in the *round* screenshot, not the small one.

**Figure 2.** The idea "noise on the left of the graph, bending error on the right" lands. The colours of the fine (ragged) and coarse (smooth) ticks make the point well. Problems:
- The circle is drawn as a thick ring with a dashed inner circle, which is never explained.
- "A unit of length for 200 mrad": a unit of what?
- The text says "the soft curve"; the label says "the step's own error". Use the label.
- The log axes are not explained.
- In the tiny shot, the f32 curve has an unexplained bump after 128, and its label is pushed off the top.

## 6. Maths fold-out
I could mostly follow it: f(p), x̂ and ∝ are defined, and the look counts are clear. I lost the thread at "a Taylor series says why". "Forward differences also lean" is the only intuition given; I'd want "forward measures the slope half a step away from p; central measures it centred on p."

## 7. The code
- **Nsphere:** clear thanks to the note. length(p) − r is the distance and normalize makes the arrow one unit long, matching the circle.
- **hitNormal:** clear with the note.
- **calcNormals_fast:** I saw a loop over three axes, but not how `VEC3(f32(k==0u), …)` makes (1,0,0), (0,1,0), (0,0,1). Nor did I see that `.s.w` is the distance (nobody says w is the 4th slot).
- **tolerances.js:** opaque apart from line 10.

## 8. Too much, too little
- **Too much:** section 3's code comment, and the repository-rules aside in section 5 ("which this repository's rules forbid treating as a fact").
- **Too little:** the gradient idea in section 1, and how 128 was judged good enough.
- **Rushed:** section 6 is four one-liners leaning on chapters 2 and 3 (sign(0), facing test, warped fillet).

## 9. Wrong or contradictory
- The **MEASURED** stamp sits on "an f32 emulation … not on a GPU". The card says measured means "ran it on real hardware … which graphics card".
- The code comment says "the march can stall" below ~100 spacings. The next paragraph says "in the emulation every march ended at a tolerance of a single spacing."
- Figure 2's readouts: "128 spacings = 16.7 µm at 1 m" (tenth) vs "128 spacings = 15.3 µm at 1 m" (thousandth). Same words, different numbers.
- The page says a "floor of 128" spacings; the code says "the floor is 128 to 256".
- "A frame took 4.3 times as long: 63.6 ms a sample". Is it a frame or a sample?
- "Rounding hardly shows" for the tiny circle vs "a distance can only change in such jumps" at 1 m (see 3.4).

## 10. Five changes, most important first
1. **Teach the gradient and the h vs h² result without calculus:**
   - A hill/slope picture for why the differences point uphill.
   - "Halve the step, quarter the error."
   - Forward is off-centre by half a step; central is centred.
   - Drop the "Taylor series" reference or put it in a fold-out.
2. **Fix the contradictions in section 3:**
   - The MEASURED stamp vs the emulation (a new stamp, or a corrected card).
   - "Stall" vs "every march ended".
   - "128" vs "128 to 256".
   - Say plainly what error counts as acceptable and why 128 is chosen over the ~700 optimum. Answer the Try-it question.
3. **Replace or annotate the tolerances.js excerpt**, and add a line-by-line note to calcNormals_fast: `.s.w` = distance, how `f32(k==0u)` builds the axis, the `u` suffix, and that normalTol is marchTol.
4. **Figure 2:**
   - Explain the ring, the dashed circle, the tick scale and the log axes.
   - Name curves by their labels.
   - Fix the 16.7/15.3 µm readouts.
   - Explain why the tiny circle's rounding is small.
5. **Figure 1 and vocabulary:**
   - Label the grey rings as equal-distance lines and give h a unit.
   - Make the dot legend match what's drawn (shared vs central-only), and keep all three arrow labels visible.
   - Say "leans toward the box's own normal (up)".
   - Define shader, kernel, GPU, frame and sample once.
