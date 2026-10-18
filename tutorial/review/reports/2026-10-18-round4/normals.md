# Report: "Which way is up" (ch/normals), read as a beginner

## 1. Teach-back
When a ray hits something, the renderer needs the **normal**. That is the arrow pointing straight out of the surface, one unit long, and light, bounces and glass all depend on it. In a distance field the normal is the way the distance grows fastest, like walking uphill. Some shapes work it out directly: for a sphere it is the point minus the centre, made one unit long, and the shape hands it over with its distance. For any other shape the renderer takes a small step h along each axis and checks how much the distance changed. Forward differences look one way per axis, which is 3 extra looks in 3D. Central differences look both ways, which is 6, and they are more accurate because they are centred on the point. A big step goes wrong on curves and near creases. A tiny step goes wrong because the GPU's numbers only have about 7 digits, so the normal turns into rounding noise. So ShadyTracer's step is the surface tolerance, but never less than a floor of 128 "spacings". Turning off the shapes' own normals made it 4.3× slower, and nobody knows why yet.

## 2. Quiz
1. A normal is the one-unit arrow straight out of the surface. In a distance field it is the direction the distance grows fastest (the gradient), which runs across the lines of equal distance.
2. By differences: it asks the distance a step away along each axis, subtracts the distance it already has, and makes the result one unit long. That is 3 extra looks in 3D (2 in the 2D figure). I had to *infer* that ShadyTracer uses forward differences. The page never says so plainly; I worked it out from the code comment "six looks... uncalled" and from section 6.
3. Forward measures the slope half a step to one side; central measures it centred on the point. Halving the step halves forward's error but quarters central's. Central costs twice the looks (6 instead of 3).
4. f32 has about 7 digits, so near 1 m the numbers jump in steps of 0.12 µm. With a tiny step the change being measured is only a few jumps, so the normal is ragged noise (up to 6° at 2 spacings). That shows up as grain in highlights.
5. The floor is 128 × 2⁻²³ × the point's largest coordinate, which is 128 to 256 f32 spacings. 128 was "chosen" by measuring the noise in an f32 emulation: about 5 mrad at 128, 11 at 64. **The page never says what the rule was** (why 5 mrad is acceptable and 11 is not). I only get "below about a hundred, it is noise" from a code comment.
6. A sample took 63.6 ms instead of 14.8 ms (4.3×) on an NVIDIA Pascal card. Not known: why three extra looks cost that much when the march takes dozens. Timing each kernel with the setting on and off would tell.

## 3. Where I got lost (worst first)
- **Section 3 and its code comment.** "UB.eps", "sceneEps and autoEps", "TOL_MIN_M", "a bench row's or the library studio's", "the Renderer panel's row in um until then": these are all internal names I can't decode. "2⁻²³" is never explained (*outside knowledge*: the 23-bit mantissa). "128 to 256 spacings... depending on where the coordinate sits between two powers of two" needs knowing that float spacing doubles at each power of two. The f32 card only says the marks spread out.
- **Why is the normal's step the surface tolerance?** It is stated, never justified. "a hair's breadth (section 3)", but section 3's prose gives no typical value. I found "1e-4 of the scene's size" only by digging through the code comment.
- **Why forward differences, when section 1 says central is "far better"?** The page never answers this.
- **"Why 128" stamp, last two sentences.** "what the floor is not for: in the emulation every march ended at a tolerance of a single spacing", and then the page tells me its own code comment ("can stall") wasn't confirmed. I couldn't tell what the floor is for after all.
- **Tiny circle:** "puts it down to the shape's numbers being its own size". I don't understand this. Why would a *smaller* shape far away have *less* rounding noise? That feels backwards and isn't explained.
- **Section 4's last paragraph:** "unroll", "kernel", "shader", "compiler", and "a loop it shares with its other questions (wavefront.js:1007)" are all unexplained. Why would a loop otherwise turn into three copies?
- **Crease:** "land in the box's field" needs knowing that a join picks the nearer shape's distance (*outside knowledge*, maybe from chapter 3).
- **Section 6:** "sign(0) is 0" (what is sign?), why that gives a wrong length, "a comparison instead", "the facing test" — I couldn't follow any of these.

## 4. Words and symbols
- **No card:** distance field, GPU, shader, kernel, compiler/unroll, WGSL, sample, radian/mrad ("milliradians" is written out once, but a radian is never explained), Taylor series, first order, fillet/blend, Math.fround, emulation, "Pascal".
- **Cards that helped:** normal, gradient, normal by differences (all clear and consistent), f32 (the ruler image is good), the stamps (good).
- **surface tolerance:** the card is clear but doesn't connect it to normals.

## 5. Figures
**Figure 1** (circle + box, probe, arrows).
- The point lands: a big step bends away and a small one doesn't; at the crease, central's looks hit the box.
- **Problems:**
  - The caption never says which colour is which. Only the crease screenshot labels them (central red, forward blue, exact purple).
  - In "round" only the "exact" label shows, clipped at the top, so I couldn't tell the red arrow from the blue one.
  - The "plain" forward dots look ringed, because central's rings sit on them.

**Figure 2** (lit ring with error ticks + log chart).
- Fine vs coarse works well: a ragged fringe against smooth ticks.
- **Problems:**
  - "It is the red curve, labelled f32 noise, falling": on the left the red curve is hidden under the bold black one, so I see a black curve falling.
  - "Too short to see" at 128, but the floor screenshot shows some red ticks on the right.
  - In the coarse screenshot there are gaps in the ticks at upper-right and lower-left. These are unexplained.
  - In "tiny" the red curve vanishes and then jumps up at 128 with no explanation, and "the step's own error" overlaps the chart title.
  - The slider's "radius" label hangs with nothing beside it.
  - "1.1e+2" and "1.95e+3 µm" are written in e-notation.

## 6. Maths fold-out
- I could follow the formulas: x̂ and ∝ are explained, and "subtract f(p)" is clear.
- I could not follow "spoils forward's difference at first order and cancels between central's two sides (a Taylor series...)". That is *outside knowledge*. The halving argument in the main text was enough for me anyway.

## 7. Code
- **Nsphere:** clear thanks to its caption.
- **calcNormals_fast:** mostly readable thanks to the caption (the `f32(k == 0u)` explanation is very good).
- The caption says "moved by dif", but no `dif` appears in the excerpt.
- "So inside the material, normals are inverted" stays opaque.
- `noUnroll` is only half explained, because "unroll" isn't.
- **The tolerances.js comment** is almost entirely opaque to me (see 3).

## 8. Too much / too little
- **Too much:** internal names, file references and version history (0.22.3, 0.66.0, PRECISION.md, PLAN.md) in sections 3 to 5.
- **Too little:** why the step equals the tolerance; why forward rather than central; how 128 was picked from the table; how a normal affects lighting (the figure is "lit through its normals", but I'm never told how).
- **Rushed:** section 6.

## 9. Wrong or contradictory
- **Figure 2's x axis:** the caption says "each mark is ten times the last", but the x-axis reads 1, 16, 128, 1024, 8192, 65536. That is only true of the y axis.
- **"Same size" isn't quite true:** "The figure above is the same sum in 2D, and its numbers are of the same size". The emulation gives 700 mrad at K=1; the figure shows about 100. At 128 it is 5 against 2.2.
- **creaseSmall:** the text says "both are right again", but the readout says forward is 0.8° off.
- **A tenth of the step:** going from 0.3 to 0.03 gives forward 3.9° → 0.5°, which is about an eighth, not the tenth that "error halves when the step halves" predicts. This is minor.
- **"Can stall":** the code comment says the march can stall below about a hundred spacings; the stamp says the emulation never found that. The page admits it, but leaves me unsure which to believe.

## 10. Five changes, most important first
1. Say plainly that ShadyTracer uses **forward** differences, and why: cost, and a step small enough that its error doesn't show.
2. Rewrite section 3 in plain words before the code: what the step usually is (with a number, e.g. 0.1 mm for a 1 m scene), why it equals the tolerance, and what 2⁻²³ means. Shorten or replace the tolerances.js excerpt.
3. State the rule that picked 128: what error was acceptable, and why 64 was not. Fix "of the same size" and untangle the stall sentences.
4. Fix figure 2: the x-axis caption, a visible red f32 curve (dashed, drawn on top), and an explanation of why the tiny circle has less noise.
5. Add one sentence each for kernel, shader, unrolling and sample. In figure 1's caption, name each arrow's colour and make sure every label is visible.
