# Chapter 30, "Numbers have grain": a beginner's reading

## 1. Teach-back

The graphics card stores numbers as f32, and the gap between neighbouring values grows with the size of the number. A ray counts as having hit a surface once it gets within the "surface tolerance" of it. That makes every shape look bigger by that amount, so a small lamp looks too big and gives too much light. A ray leaving a surface is also pushed forward by ten tolerances, so a gap thinner than that gets jumped over. The tolerance at a point is the largest of three things: the scene's setting (automatic means 1/10,000 of the scene's size, capped at 1 mm), one nanometre, and 128 f32 steps at that point. Far from the origin the last one wins. The engine always works in metres. A scene written in mm or cm is converted at one place, `sceneAt`, and the conversion only ever multiplies. A program called unitlint reads every kernel and complains if engine code reaches into the scene without going through that place, because that kind of mistake only shows up in non-metre scenes.

## 2. Quiz

1. **Lamp and gap:** A ray stops when it is within the tolerance, so every shape is traced as if it were bigger by that much all round. A 2 cm lamp at 0.91 mm gets traced 1.22 times its area, so it lights the floor 1.22 times too much. The page never says *why* more traced area means more light. I worked that out myself. The gap: a ray leaving a surface is moved on 10 tolerances (1 mm at 0.1 mm), which is more than the 0.5 mm gap. It lands inside the second slab, misses that slab's front face, and the pair lets through 0.923 (one slab) instead of 0.857.
2. **Three lengths:** the scene's setting (typed or automatic), a nanometre, and the floor of 128 f32 steps at the point. Far away the floor wins because it grows with distance. For the RGBW mixer that happens past 69 cm, and for any automatic tolerance past 6.55 × the scene's size.
3. **Automatic:** 1e-4 × the scene's size, converted to metres, clamped between 10 nm and 1 mm. A scene with no size gets 1 mm. The cap exists because "size" includes ground slabs (Menger is 424 m, which would give 4 cm), and that would be coarser than the 1 mm every scene used before. With the cap, size only ever makes the tolerance finer. The page doesn't spell out what would go wrong at 4 cm, but I could infer it from section 1.
4. **Boundary:** in `sceneAt`. The ray goes into scene units, the scene's distance function runs, and the answer's lengths come back in metres. It multiplies because GPU division may be off by 2.5 steps, while 1, 100 and 1000 are exact in f32, so a metre scene comes through unchanged. The page did not teach how the way back (×0.001) can be exact.
5. **Direct call:** it would compile, run and be right in every metre scene (the bench, the demo), but wrong by 1000 in a mm scene. unitlint.js, in check-shaders' second pass, reads every kernel built against every scene and names the line. It also catches a helper that calls the scene, scene globals, and reading the unit outside the unit functions.

## 3. Where I got lost (worst first)

- **"the 1 cm disc in 3D"** (Figure 1 readout) and **"Section 1's 1 cm disc"** (section 6), against **"a lamp 2 cm across"**. Is it 1 cm or 2 cm? Only *outside knowledge* that "1 cm" means the radius saved me. I also tried Steiner's formula face-on (radius 1 cm, margin 0.091 cm): 1 + 2(0.091) + 0.091² ≈ 1.19, not 1.22. The page never says that the 37° viewing angle is what makes it 1.22, or how.
- **"a pair of rows comparing the lamp traced as a light with the same lamp as a glowing object read 0.80 to 0.84"**. I don't know what a bench row is, or why one version is fattened and the other is not. "Traced as a light" sounds like the fattened one, but 1/1.22 suggests it is the exact one.
- **"light-traced photons each carried their share of the light 'divided by nothing'"**. If they were divided by nothing, why did the spot come out *darker*? I can't rebuild this bug from the text.
- **"2^−23 × 10 m is 1.2 µm, one to two steps"**. Two paragraphs earlier one step was "a fixed share of the number, about a ten-millionth". If it's fixed, why "one to two"? I also had to work out on my own that 2^−23 ≈ 1.2 × 10⁻⁷.
- **"1, 100 and 1000 are numbers an f32 holds exactly"**. Going back to metres multiplies by 0.001, which is not one of those. Is that exact?
- **"the face, seen 37° off its axis"**. Off the axis of what: the lamp's, or the camera's?

## 4. Words and symbols before they were explained

- **kernel** (intro, section 3). There is no card for it. Same for **engine**, **host**, **uniform**, **double precision**, **shader**, **SDF / distance function**, **normal** (only "chapter 4"), **shadow ray**, **pick**, **Fresnel**, **photons**, **bench**, **rows**, **lavapipe**, **node**, **lightguide**, **dies**, **ulp**.
- **"the user's Ampere card"** appears in section 1. It is only explained inside the "measured" stamp's card in section 5.
- `h.s.w`: I guessed it is the distance (*outside knowledge*).
- The **f32 card** helped (it's a ruler with marks spreading apart), but "near a light of 25,000" puzzled me: a light of 25,000 what?
- The **surface tolerance**, **lint**, **scene's unit** and **march** cards were all clear and helpful.

## 5. Figures

- **Figure 1, lamp:** this works. The red rays above and below the blue band make the fattening visible, and at 10 µm they disappear. The caption doesn't say what the grey rays are (misses, I guessed). The readout's "the bench's pair reading 0.822 / 0.998" disagrees with the text's measured 0.80–0.84 and 0.994, so the readout looks like a prediction called a reading.
- **Figure 1, gap:** very clear. The red dashed jump lands inside the second slab, and at 10 µm the jump stops in the gap. "Drawn ten times larger": larger than what?
- **Figure 2:** this is dense, with five lines on two log scales, but the crossing points match the text (688 mm, 65.5 m). The "old" screenshot makes its point well: the blue line sits far under the dotted step line. Some confusions: the caption says "each mark ten times the last", but the y labels go 1 nm → 1 µm → 1 mm. The nanometre line has no colour in the caption. The x axis starts at 1 mm, so I don't see how the Try-it "put the point at the origin" can be shown.
- **Figure 3:** clear. The planted red line and the lint's complaint read well, and the `1.0 / UB.sceneUnit` plant nicely shows the forbidden division. Some problems: the lint text is cut off at the right edge in fig-3-direct ("instead (sceneA"). "A scene global read" has no paragraph and no screenshot, and "global" is never explained. "Three empty functions": which three?

## 6. The maths fold-outs

The page has none. I could follow the inline sums with a calculator once I knew 2^−23 ≈ 1.19e-7 (69 cm, 6.55×, 30.5 µm, 65.5 m). I could not follow 1.22 (see above), or 0.923 / 0.857. I also wondered: skipping one face means the ray crosses 3 faces instead of 4, so why does that equal exactly "one slab"?

## 7. The code

- **autoEps:** readable, since I know Math.min, Math.max and `? :`. But it clamps at 1e-8 (10 nm), while section 2 says the minimum is a nanometre. Are those two different minimums?
- **TOLERANCES:** I followed the idea that a test counts each use. The regular expressions (`\bea < marchTol\(` — what is `ea`?) and the "why" of the normal step ("forward… central… pick") stayed opaque.
- **sceneAt:** with the note I could follow the SCN_TOL lines and the multiply-back. The `capture` lines with `${given ? …}` and `insideScaled(h.insideW, k)` stayed opaque.
- **tracebasics:** clear.
- **unitlint comment:** the three rules are clear. The list of names (getMaterial2, HIT_FRAME, XF_*) means nothing to me.

## 8. Too much, too little

- **Too much:** the dates, card names and file paths inside section 1's teaching paragraphs make it hard to find the idea. Section 6 adds new jargon in a recap ("lightguide", "dies").
- **Too little:** why more traced area means more light. The bench pair. The photon bug. The "inferred" sphere pattern ("counts a lens's curvature as size" is too quick).

## 9. Wrong or contradictory

- The lamp is "2 cm across", but the readout and section 6 call it a "1 cm disc".
- The readout's "bench's pair reading 0.822 / 0.998" against the text's measured 0.80–0.84 and 0.994.
- One f32 step is "a fixed share", yet "one to two steps".
- The minimum is "a nanometre" in section 2 but 1e-8 m (10 nm) in autoEps.
- The caption says "each mark ten times the last", but the y labels don't step by ten.
- "Multiplies… 1, 100, 1000 exact", but the factor back to metres is 0.01 or 0.001.

## 10. The five changes

1. Make the lamp one size everywhere ("radius 1 cm" or "2 cm across"). Show Steiner face-on (1.19), then say how 37° raises it to 1.22. Add one sentence on why a bigger traced lamp gives more light, and say which of the bench pair is fattened.
2. Add cards for **kernel**, **engine / scene**, **host / uniform** and **bench row** at their first use, and say that `h.s.w` is the distance.
3. Explain the f32 step once: 2^−23 ≈ 1.2 × 10⁻⁷, and why "2^−23 × x" is one to two steps. Fix figure 2's y labels and give the nanometre line a colour.
4. Answer the 0.001 question in section 3, and explain whether the 10 nm clamp and the 1 nm floor are two separate minimums.
5. Retell the centimetre photon bug as a worked unit mistake (an area in cm² read as m²). Label figure 1's readout "predicted". Fix the clipped lint text, and give "a scene global read" its own paragraph.
