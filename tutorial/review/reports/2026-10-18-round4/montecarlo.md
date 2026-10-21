# Report: "Dice and averages" (Part IV, ch. 12), read as a beginner

## 1. Teach-back
You can work out a number like π by throwing random darts at a square. You score 4 for each dart inside the quarter circle, and the average score settles towards π. The more darts you throw, the less the answer wanders. But it is slow: to halve the error you need four times as many darts, because the spread shrinks as 1/√N. The darts themselves also tell you roughly how wrong you still are (the error bar). That bar is not a guarantee: the true answer is outside it about one time in three. A renderer does the same for each pixel. It averages random light paths and keeps two extra numbers per pixel, V and S, so every pixel has its own error bar. All of this needs fair random numbers. ShadyTracer's old generator went through a 24-digit float, so its outputs fell on a coarse grid. Tiny "windows" like a small sun then got too many or too few hits. That is a bias: more samples don't remove it, and the error bar shrinks around the wrong answer. The new generator, PCG4D, has a fine, even grid.

## 2. Quiz
1. **π from darts:** the quarter circle covers π/4 of the unit square, so that is the chance a dart lands inside. Score 4 inside and 0 outside, and the average score is π.
2. **Error bar:** it says how far the estimate typically is from the truth, and it is worked out from how much the tries disagree. It does not promise the truth is inside it: about 1 in 3 estimates are more than one bar away, and 1 in 20 more than two. It is meaningless for the first few dozen tries. It sees noise, never bias.
3. **Half the noise:** you need 4 times the samples. The spread of an average is σ/√N, because for independent tries "variances add". The page states that rule but never shows why it holds.
4. **Per-pixel bar:** each pixel keeps V (how much its samples scatter about their average) and S (the sum of the squared weights). The bar is √(S·V/(1−S)), which for a plain average is √(V/(n−1)). It only needs the samples, not the answer.
5. **Old generator:** fract(f32(state)/671040). Converting to f32 keeps 24 binary digits, so most states became multiples of 64 or more, and the outputs fell on a grid 1/10,485 apart. Small windows then got 0.95× to 1.83× (or 0.01× to 8.76×) of their fair share. More samples can't fix this because every sample draws from the same uneven grid, so the average settles on the wrong value.
6. **The disagreement:** it is about the old output's share of a 0.0001 window (the comment says 0.08× to 3.2×, the page 0.95× to 1.83×) and the grid spacing (the comment says ~1/2600, the page 1/10,485). The page is sure about the formula: it counted all 2³² states and checked against 63 million random ones. It cannot check whether the old code did more than the formula, because the history starts at 0.46.0.

## 3. Where I got lost (worst first)
- **The grid argument in §4 ("narrow").**
  - "Every state from 2²⁹ up … becomes a multiple of 64 or more." I had to work out alone why 64: 30 digits, keep 24, so 6 are lost and 2⁶ = 64.
  - Worse, the page's own logic leads me to the comment's answer. States ≥ 2³¹ are multiples of 256, and 256/671,040 ≈ 1/2600, so why isn't the grid that coarse? The page never says. I only know the answer is that fract wraps around, and that is *outside knowledge*.
  - "A window 0.0001 wide holds one of those points or two," yet the bars are 0.95 and 1.83, not about 1 and 2. The other eighth of the states is never brought back to explain this.
- **§3 code, lines 452–458:** `prev`, `prevn`, `moments[idx*2u+0u]`, `select`, "a reset", "1e20", "inf", "NaN". The update `V <- (1-w)(V + w d²)` is never explained either, and nobody says that d is measured from the *old* average.
- **"√(S·V/(1−S))"** appears from nowhere. "s worked out the usual way (dividing by n − 1)": there is no "usual way" for me. School taught me dividing by n.
- **"about one estimate in three … one in twenty"** is given with no source. I accept it only because I know the bell curve (*outside knowledge*).
- **"Each sample sends one random path through the pixel"**, "bounce", "the surface's own normal", "shadow ray", "tone curve (chapter 7)" all lean on earlier chapters. §7 even says "a pixel no path landed on", which seems to contradict "every sample sends a path through the pixel".
- **§6 "1/√50,000 is 0.45%":** why the count of *hits*, not the 37 million paths? This is never connected to the √N rule.
- **"The textbook variance, the mean of the squares less the square of the mean"** is never shown, so "cancels to nothing" is taken on trust.

## 4. Words and symbols before they were explained
- **state, fract, [0, 1):** used in §4's first paragraphs, explained two paragraphs later.
- **bits, lane, `^=`, `>>`, host, pass, threads:** never explained.
- **EMA, maxaverages, M2:** appear only in the code comment.
- **LUMA "by dot":** needs the dot product, which I don't have.
- **seed:** has a card but no ° in the text.
- **Cards:**
  - *error bar*, *noise*, *bias*, *variance* and *NEE* helped.
  - The *f32* card's ruler image is good, but it talks about "the scene's middle" and "tolerance", which confused me here.
  - "estimate°" in the text opens a card titled *estimator*. That's a small mismatch.

## 5. Figures
- **Fig. 1:** clear. Blue dots are inside and grey outside. The blue line is the estimate, the grey lines are the bar, and the red line is π, but the caption never names the colours; the "π" tick saved me. The flat ±0 start at 4.0 matches the text nicely.
- **Fig. 2:** clear. The 1/2/3/4 rows at N=4 make the point well. I wondered whether the sideways scatter within a column means anything; it isn't said. The solid (black) and dashed (red) bars are fine.
- **Fig. 3:**
  - Red = old and blue = PCG4D is clear.
  - In "wide", the red bars alternate about 0.96/1.04. Why alternate?
  - In "tiny", there are small red bars of about 0.1–0.4 that the text never mentions. With the y-axis now going to 5, the "0.01×" is invisible.
  - The x-axis labels have different decimal places (0.32400, 0.30240, 0.30024).
  - "Try it" calls it "the dice figure"; nothing else does.

## 6. Maths fold-out
I followed most of it.
- "(put π = 4p in and it simplifies)" took me a while. One line, 16p(1−p)² + 16p²(1−p) = 16p(1−p), would save that.
- "its average is 4p" is fine.
- "Variances add" is the whole point, and it is only asserted.
- The 10¹² argument for even spacing was a good surprise.

## 7. Code
- **§3:** the caption explains cnt, w, y, V and S, so lines 449–451 and the two update lines make sense. The reset/NaN guard and the long comment (Finch, EMA, maxaverages, f32 cancelling) stayed opaque.
- **§5:** the story in the comment is readable. In `pcg4d` I only get "it scrambles". `>> 8` keeping the top 24 bits is guessable only from the caption.

## 8. Too much, too little
- **Too much:**
  - §2 is one dense paragraph with six ideas.
  - The §5 disagreement paragraph is long for a beginner.
  - §7's leaking-slot and 65,535-groups items feel off-topic.
- **Too little:**
  - Why variances add.
  - The 1-in-3 rule.
  - A worked V update using the page's own 2, 4, 9 example (V goes 0 → 1 → 8.67; S goes 1 → ½ → ⅓).
  - Why rare events are noisy.

## 9. Wrong or contradictory
- **§2:** "wanders … by about 5%", but the example 0.093 vs 0.103 is about 10% off.
- **§8:** "Try it" asks me to test the 1-in-3 rule at 20 darts, but §1 says the bar "settles after a few dozen".
- **§5:** the comment also gives 0.96× to 1.29× at 1e-3, while Fig. 3 shows 0.96× to 1.04×. The page doesn't mention this second disagreement.
- **The grid:** the page's own reasoning seems to support the comment's 1/2600 for states ≥ 2³¹ (see §3 of this report).
- **"Sit only on 1, 2, 3 or 4":** 0 is possible too, just rare.
- **§7:** "a pixel no path landed on" vs "one random path through the pixel".

## 10. Five changes
1. **Rewrite the §4 grid paragraph step by step.** Show why 64, why coarser multiples still give a 1/10,485 grid after fract (which is also where the comment went wrong), why 0.95/1.83 instead of 1/2, and what the small red bars in "tiny" are.
2. **Walk V and S through 2, 4, 9.** Say d is measured from the old average. Either define prev, prevn, moments and reset in the caption, or cut the excerpt to lines 449–458 with the comment trimmed.
3. **Back up "variances add" and "1 in 3 / 1 in 20".** A reason would be best. At least say "take this on trust; Fig. 2 checks it".
4. **Fix the small contradictions:** the 5% vs 10% example, the 20-dart Try-it, "no path landed", and the 1e-3 numbers.
5. **Add a recap and two small examples.** A two-sentence recap of path, bounce and normal for readers arriving here. A tiny seven-digit example of the textbook variance cancelling. One line on why a rare event's error is 1/√(hits).
