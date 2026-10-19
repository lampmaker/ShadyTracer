# Beginner review: Chapter 16, "Every glowing thing is a light"

## 1. Teach-back
Some lights are just shapes with a glowing material, and the renderer doesn't know where they are. So it waits for paths bouncing around the room to hit one by luck. Each hit is written into a coarse grid: which cell, a box drawn tight around the hits in that cell, and the brightest glow seen there. After that, the renderer can aim at those cells the way it aims at a lamp, choosing brighter and bigger ones more often. Before a glow is found the picture is still right, only noisier, and something called MIS makes sure nothing is counted twice. To send light *out* of a shape you only have a formula for, you draw random lines through a circle and start the light wherever a line crosses a surface. Longer outlines get crossed more often, and the crossing angles follow a cosine. The brightness is stored as a whole number made from a logarithm, because the old "×16, capped" number made very bright things all look equal and very dim things look like zero.

## 2. Quiz
1. **Finding glows:** paths that hit a glowing surface record the grid cell, stretch the cell's box and keep its brightest glow. Any cell with hits becomes a target, "a circle round its box". The page taught this.
2. **Right before it's found:** the glow is lit by paths that happen to hit it. The aiming method's "chance of picking its directions is 0, so under MIS those hits keep their full weight." I can repeat this sentence but only half understand it. The MIS card helps a little. Why the weights come out at exactly "full" was left to chapter 15.
3. **Random lines:** pick a random direction and offset through a circle round the shapes, and start light where a line crosses a surface. The crossings fall evenly along the outline and their angles follow a cosine. **Not taught:** why finding a crossing is easy when "picking a random point" is hard; which way along the line the light leaves (a line crosses a circle twice); and how "a circle round the shapes" relates to the found boxes. That link only appears in a code caption ("nothing about the shape but the spheres").
4. **Logarithm:** "keep the larger" only works on whole numbers, so brightness must become a whole number in the same order. The old code (×16, capped) gave every bright thing above the cap the same rank and turned anything below 1/16 into 0, "the same as never seen". **Not taught:** what a logarithm is, or *why* it fits a huge range into a few numbers. "Each doubling gets the same number of codes" appears only in a code caption.

## 3. Where I got lost (worst first)
- **Section 6, "camera paths were marked for the split with the photons only while the sun's photons existed".** What split? This is never introduced. "Two estimates of two things… brightness moved with the share of shadow rays" was just as opaque.
- **Section 4, "the density of that choice is what both halves of MIS ask".** "Density" is never defined. I understand it only from *outside knowledge* (probability density). The same goes for "solid angle", "2π(1 − cos α)" (α is never defined) and "which its brightness is divided by". Why divide?
- **Section 2, "spread exactly as a matte glowing surface sends out its light… in proportion to the cosine".** I know this only from *outside knowledge* (Lambert's law). "Normal" is never explained either, though school optics helps a bit.
- **Section 1, the [many] paragraph, "And before?"** It is attached to the 64-sample step, but the figure at that step shows nothing about "before".
- **"The code says it in one line: 'That is why this is unbiased from the first sample'"** and **"(the comment above the collect kernel)".** Neither is shown on the page.
- **"a shape known only by its distance formula"** has no card. "Light tracing (chapters 18 and 19) needs the opposite" leaves me asking: opposite of what?

## 4. Words and symbols before explanation
- **No card at all:** sample, path, light tracing, distance formula, normal, matte, thread, GPU "keep the larger" (atomic), log, **stop** (Fig. 3: "a step every 0.000005 of a stop"), solid angle, density, cone, kernel, voxel, Ampere, WGSL.
- **Cards that come too late:** in the prose, "MIS", "unbiased", "photon" and "caustic" carry no °. Their cards are reachable only from the list at the end, after I needed them.
- **A card for a word the prose doesn't use:** "emitter" appears only in code. The prose says "glow".
- **Cards that helped:** *unbiased* (good), *caustic*, *NEE*. The NEE card let me guess that "aiming" = NEE, but the page never says so.

## 5. Figures
- **Fig. 1:** the eye, a room, a glowing ball and a bar behind a wall, with red dashed circles appearing around the ball and then the bar. The bar going from 2 to 4 to 5 cells is clear. **Confusing:**
  - The caption promises "boxes", but I see no boxes, only circles.
  - The 16×16 grid isn't drawn, and the paper background grid looks like it.
  - Nothing says what the orange lines (hits?) or the tick marks along the bar are.
  - The drawn paths are identical at 1, 8 and 64 samples.
- **Fig. 2:** works well. The bar chart lining up with the dots at 40,000 lines is convincing. **Confusing:**
  - "The circle" (a shape) and "the dashed circle" are two different circles.
  - "Predicts 18000.0" can't be checked, because the dashed circle's radius is never given.
  - The y-axis has no label (fraction of crossings?).
- **Fig. 3:** I can see the blue straight line versus the red curve. **Confusing:**
  - The labels overlap ("a bright panel" / "old: all the same above 1e5" / "the sun in a mirror") and are hard to read.
  - The caption says "rising, then flat", but the red curve looks like zero until 1e4 and then a cliff. That fights "fine while… 5 per channel".
  - "Each step ×10,000" is the only hint that the x-axis is a log scale.

## 6. Maths fold-out
I couldn't follow it.
- "Measure 2πR", "ds", "dA dω" and "density ½ cos φ" need calculus and probability.
- Why θ runs over [0, π) and not [0, 2π) is never said.
- **Where the 2 in "2ℓ" comes from is the step I most wanted.**
- "|n·ω|" assumes the dot product.
- "Matte emission measure" means nothing to me.

## 7. The code
- **emitDeposit:** the caption gets me to "u is 0 to 1, min/max of corners, max of the log code". **Opaque:**
  - `16777215.0` (why that number?)
  - `cell * 8u` (8 slots, never listed)
  - `v.x + EG * (v.y + EG * v.z)`
  - `0.2126, 0.7152, 0.0722` (luminance weights: *outside knowledge*)
  - the `u` suffixes, and `EV_BASE` / `learn`
  - the final `atomicAdd` (a hit count the prose never mentions)
  - the early `return` (glows outside the grid are ignored?)
- **LUM_CODE:** `lumEncode` is readable if you know log2. **Opaque:**
  - why WGSL sits inside a JavaScript string
  - `LUM_DECAY`, a new idea introduced only in the caption ("a glow that is gone": why would it go?)
  - "subtraction in the log domain: × 0.9" (needs log rules)
- **emitConePdf:** the caption is the clearest on the page. `dot(dir, dc) >= (1.0 - omc) * sqrt(d2)` stays opaque without the dot product. Nothing says why a point inside the sphere is skipped.
- **emitLineDensity:** "Crofton factor, 1/(4π² r²)… which its brightness is divided by" is stated but never motivated.

## 8. Too much, too little
- **Too much:** section 6 is three insider bug reports. Section 5's measured stamp ("Ampere card", "second run") is aimed at developers.
- **Too little:**
  - the MIS argument in section 1, which is the heart of question 2
  - how the found boxes feed the random lines (sections 1 → 2 → 4)
  - what a logarithm does
- **Rushed:** the last sentence of section 2 ("In 3D… Cauchy–Crofton") and section 4's prose paragraph.

## 9. Wrong or contradictory
- **The cap:** "times 16, capped at 100,000" reads as if the result were capped. The readout shows old codes of 320,000 and 1,600,000, so the cap must be on the brightness.
- **The bits:** the heading says "in 32 bits"; the text says "24 bits". Why 24 is never explained.
- **Fig. 1:** the caption promises boxes and the screenshots show none.
- **The measured stamp:** its card says the page names "who, on which graphics card". The stamp names neither for the run it quotes.
- **Circle or sphere:** section 4 says "the cone its circle fills", while the code says "bounding sphere".
- **Unshown sources:** the prose cites code lines that aren't on the page.

## 10. The five changes that would help most
1. **Teach the "right from the first sample" argument on this page.** Use a two-way example with the actual weights, put ° cards on MIS and unbiased where they first appear, and make Fig. 1's third step show a glow that is still unfound yet lit.
2. **Section 2:**
   - say why a line's crossing is easy to find (the renderer already finds ray hits) but a random surface point isn't
   - say which way the light leaves at a crossing
   - tie the "circle round the shapes" to the spheres around the found boxes
   - explain matte = cosine and "normal" with a small sketch
3. **Section 3:**
   - explain log as "each doubling gets the same number of codes"
   - define "stop"
   - fix the "capped at 100,000" wording
   - explain 24 vs 32 bits and why many threads need "keep the larger"
   - un-overlap the Fig. 3 labels
4. **Fig. 1:** draw the boxes or drop them from the caption, draw the 16×16 grid so it can't be mistaken for the paper grid, and give a legend for the orange lines, red circles and tick marks.
5. **Section 4:**
   - define density / "chance per direction", solid angle and α
   - explain why a photon's brightness is divided by its line density
   - name the 8 slots per cell and say what LUM_DECAY is for, in the prose rather than only in captions
   - cut section 6's "split with the photons" and "two estimates" items or explain them
