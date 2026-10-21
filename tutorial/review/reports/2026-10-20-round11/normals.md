# Beginner review: "Which way is up" (ch/normals.html)

## 1. Teach-back
The normal is a one-unit arrow pointing straight out of a surface, and you need it for lighting, bouncing and bending through glass. In a distance field it points the way the distance grows fastest (uphill on the "distance hill"), across the lines of equal distance. Some shapes, like a sphere, give it straight from a formula. For the others, the renderer takes small steps along each axis, sees how much the distance grew, and uses those changes as the arrow. Forward differences look one way per axis (3 looks in 3D). Central differences look both ways (6 looks) and are much more accurate for the same step. Near a crease, a look can land on the other shape and bend the arrow. You can't just make the step tiny, because GPU numbers (f32) only have about 7 digits, so tiny differences turn into rounding noise. ShadyTracer therefore steps by the surface tolerance, but never less than 128 f32 spacings. Using a shape's own normal is much faster (4.3x on one card), and nobody yet knows why it makes that much difference.

## 2. Quiz
1. It is the one-unit arrow out of the surface: the direction the distance grows fastest, i.e. the gradient. Answered well.
2. It uses forward differences. It asks the scene's distance one step (the surface tolerance) along x, y and z, subtracts the distance at the hit (already known from the march), and makes that arrow one unit long. That is three extra looks, or four in scenes using NORMAL_AT_HIT. Answered.
3. Forward measures the slope half a step to one side, while central is centred, so the surface's bend cancels between its two sides: the error goes like h², not h. The cost is twice the looks (6 instead of 3), because it cannot reuse f(p). The "cancels" part I only half follow (the Taylor series is waved at).
4. f32 can only change in jumps (0.12 µm at 1 m). With a tiny step, the measured change is a few jumps, so rounding decides the arrow: up to 6° of ragged error and grain in highlights. Answered.
5. It is the smallest step allowed: 128 × 2⁻²³ × the largest coordinate, which is 128 to 256 spacings (15 µm at 1 m). An f32 imitation measured the noise against the step. A document says that below about 100 spacings, shading is f32's pattern, and 128 is the first power of two past that (about 5 mrad). Why 128 and not 100 is only inferred. Answered, but hard work.
6. A sample took 4.3x as long (63.6 ms against 14.8 ms) on an NVIDIA Pascal. What isn't known is why: three more looks against dozens in the march should cost a few percent. Timing each kernel would tell. Answered, although I don't know what a "sample" or a "kernel" is.
7. Partly. The scene divides its distance by the steepest nearby relief. That divisor jumped fourfold between the hit and a look, so the difference measured the jump, not the slope. Leaving the division out of the looks removes the jump. The march's distance at the hit is still divided, so it can't be the base, and the hit needs its own undivided look: one more. **Not taught:** why the scene divides at all, and why the undivided distance is safe for a normal. I filled both in from *outside knowledge* (a Lipschitz bound for a safe march; a normal only needs direction).

## 3. Where I got lost (worst first)
1. **§6 "A line round a cut".** "Where a steep relief stopped counting, a step away from a gentle one's surface, the division jumped fourfold" took me several reads. "Relief", "the division" and "stucco" all lean on chapter 3, and the page never says why the fix is right.
2. **§4 after the code:** "a loop the compiler is not allowed to unroll keeps one copy of it in the kernel". Kernel, shader, compiler and unroll are never explained, and nobody says *why* shader size matters.
3. **"Why 128" (§3).** It mixes 3D numbers with the 2D figure's (5 against 2.2), quotes a document quoting a rule, and then says the code comment above ("can stall") is not what was found. What is "stall"? Who is right? I also don't know what "Math.fround" is.
4. **§2, tiny circle:** "the renderer's own floor test finds the same, and puts it down to the shape's numbers being its own size". What is the floor test? And "backwards-sounding": backwards compared to what? The page never says what I should have expected.
5. **§2:** "The renderer's floor is lower than that because it is only a floor". It took me a while to see that it means "the real step is usually bigger anyway".
6. **§5:** "a sample took 4.3 times as long". A sample of what?

## 4. Words and symbols
- **Never explained:** kernel (§4, §5, and the march card), shader (Read more box, §4), compiler/unroll, sample, UB, "Pascal family", Math.fround, "first order", fillet, blend, relief, the facing test (the last four send me to chapter 3).
- **mrad / radian:** I've barely met radians. The degree conversions ("an eighth of a degree", "6°") helped, but a single "1 mrad ≈ 0.06°" would have been better.
- **select(...)** appears in the code in §4 but is only explained in §6. Its argument order (false-value first) misleads: from select(1u, 0u, NORMAL_AT_HIT) I'd guess "1 when true". Only the caption saved me.
- **Cards:**
  - normal, gradient, surface tolerance, march: helpful. The gradient card's "length says how fast" is a nice extra.
  - f32: the ruler analogy is great, but "near a light of 25,000" is baffling. 25,000 what?
  - The stamp cards are clear.
  - The march card brings in new words of its own ("sphere tracing", "march kernel").
- **Spacing, x̂, ∝, 2⁻²³:** explained in place, good.

## 5. Figures
**Figure 1** (circle and box, normal arrows). It works: the step slider plus the readout make the 3.9° → 0.5° and 20.5° → 0.0° story clear.
- Problems:
  - In `fig-1-creaseSmall` the three labels pile up and "forward" is half hidden behind "central".
  - In `fig-1-crease` the "central" label sits far above its arrow.
  - The "blue" dots look dark navy with red rings, so it's hard to tell which dot belongs to which method.
- The crease case left me believing forward is *better* near creases. Only the fold-out hints that this depends on which side the probe is on. Say "drag the probe to the other side of the crease and forward is the one that fails".

**Figure 2** (f32 noise against the step's error). The log-scale graph is well explained by the caption.
- Confusing:
  - `fig-2-floor`: the text says "the ticks are too short to see", but short red ticks are clearly visible at the left and right.
  - `fig-2-coarse`: the ticks merge into a solid red rim that looks like part of the drawing, not ticks.
  - `fig-2-fine`: the "grain in the highlight" can't be seen; the ticks dominate. The ticks also bunch at top, bottom, left and right, which is unexplained.
  - `fig-2-tiny`: the red f32 curve vanishes between about 16 and 128, then comes back as a bump around 256–1024. The readout says f32's part is 0.40 at 128, more than at 16. Unexplained.
  - In `fig-2-tiny` the "the step's own error" label collides with the axis title ("log scalethe step's own error").
  - The readouts use "1.95e+3 µm" and "1.1e+2 mrad" while the text says "2 mm" and "110 mrad".
  - "radius" dangles after the slider, as if it labelled something.

## 6. Maths fold-out
I could read both formulas thanks to the legend. The legend's lines run together ("from the march x̂, ŷ -- one unit").
- p is never defined.
- "Shrink like h and like h²" is fine after the halving/quarter sentence.
- "Spoils forward's difference at first order and cancels between central's two sides" is where I stopped understanding. A two-line picture (the curve's bend adds the same amount on both sides, so subtracting them cancels it) would do it without Taylor.

## 7. The code
- **Nsphere:** clear with the caption.
- **tolerances.js:** line 10 (the max of three) is readable. Lines 11–14 are opaque: UB.eps, bench row, library studio, epsAuto, "since 0.66.0", "Renderer panel's row in um".
- **calcNormals_fast:** the caption makes the loop readable.
  - `g[k - 1u] = s - d` is clear.
  - Still opaque: noUnroll, NORMAL_LOOK ("tells the scene these looks are for a normal": why would the scene care? That only becomes clear in §6), the comment "(normalAtHitWGSL; the surface kernel's trips do the same)", "inside the material, normals are inverted", and UB.fastnormals.
  - It isn't said that r.pos is the hit point.

## 8. Too much, too little
- **Good length:** §1 and the crease paragraphs.
- **Too long and meta:** the "Why 128" paragraph spends many words on which document says what.
- **Rushed:** §6. Five past bugs in a few lines each, several of which need chapter 3. In "Six looks nobody asked for", why an unused function was a problem isn't said.
- **Missing:** why the normal must be one unit long.

## 9. Wrong or contradictory
- The page quotes a code comment saying the march "can stall" below about 100 spacings, then says the emulation found otherwise. Is the comment out of date?
- §2 says "ticks too short to see", but the floor screenshot shows visible ticks.
- §2 says f32's part "stays small at every step", but the tiny case's curve rises again after 128 (0.40 at 128).
- Try-it 2: "How many times smaller must it be for central ones?" Central is 0.6° off at h = 0.3, so for 1° its step would be *larger*, not smaller.
- The fold-out calls forward's one-sidedness a weakness ("lean"), but the crease example showed it as an advantage.

## 10. The five changes
1. Give §6 "A line round a cut" its own short explanation:
   - why the scene divides (one sentence from chapter 3);
   - a two-number example of the jump;
   - why the undivided distance points the right way;
   - ideally a small figure.
2. Define kernel, shader and "unrolling" once (cards), and say why a shader's size matters.
3. Trim "Why 128" to the measured table and the rule. Settle the "can stall" comment (fix it or say it is stale). Explain Math.fround in five words.
4. Fix figure 2's mismatches:
   - "ticks too short to see";
   - the tiny case's f32 bump, explained;
   - the label collision;
   - plain units in the readout;
   - a one-line radian/mrad note.
5. Figure 1:
   - separate the overlapping labels;
   - add "now put the probe on the other side of the crease" so forward's lean shows as a weakness too;
   - reword try-it 2.
