# Beginner read: Chapter 29, "Noise, bias and checking"

## 1. Teach-back

A pixel made by averaging random samples can be wrong in two ways. Noise is random wobble that gets smaller as you add samples, and the error bar measures it. Bias is being wrong on average, and it never goes away. The error bar can't see bias because it only measures how much the samples disagree with each other. Cutting paths after one bounce, or clamping bright samples at 4, both give a darker picture that settles neatly on the wrong number. A moving window isn't biased, but it never gets quieter than about 21 samples' worth. To check a renderer you need an answer you know in advance, like the white furnace, where everything should read the sky's brightness. You also need a control row that has to fail, because an empty or broken picture reads exactly 1 too. You can check the error bar itself: on a flat floor, neighbouring pixels differ only by noise, so seRatio should read 1.

## 2. Quiz

1. **Noise vs bias:** noise fades as samples add up, while bias is "an estimate wrong on average" and stays. The error bar "measures how much the samples disagree with each other, and these all agree on the wrong answer". The cut reading has a tight error bar but sits 19 of them below the truth.
2. **Biased on purpose:** (a) a bounce cap of 1 loses light that comes off the walls first, so the reading is darker (0.94 against 1.644). (b) A firefly clamp cuts bright samples to a limit, so the picture is "quieter and darker" (1.20). A photon map's blur is a third, consistent kind.
3. **Control row:** a picture with no disc, or a camera looking at the sky, reads the sky everywhere. "An empty picture reads exactly what a perfect one does", so every white row passes. When the page is broken, all rows read 1.0000 with noise 0 (or 1000.000244 raw), the grey row fails, and the black control reads 1.0000 when it should read about 0.25.
4. **Checking the error bar from the picture:** take neighbouring pixels on a flat, evenly lit surface. The mean of (La − Lb)² should equal the mean of (se_a² + se_b²), and seRatio = √(one over the other) should read 1. Real detail pushes it above 1. *Why* those two must be equal was not taught (I know it from outside: the variance of a difference is the sum of the variances).
5. **Window:** a window of 10 is worth about 21 samples (2N+1), however long it runs. The window row catches an error bar worked out as if the average were worth its count, 11. That bar is too wide (0.308 against a real 0.216), so seRatio reads 0.69. The page also says this row has never been run on a real card.

## 3. Where I got lost (worst first)

- **Section 3, first paragraph:** "how resolve keeps each pixel's error bar from two numbers, the spread V and the sum of squared weights S". I don't know what resolve is, what the weights are, or how V and S turn into an error bar. `standardError` is named but never shown. Everything after this rests on it.
- **"worth 21 samples (1/S)":** nothing on the page says why 1/S counts samples. Outside knowledge: n equal weights of 1/n give S = 1/n.
- **"w/(2 − w)":** stated with no working. I could check that 1/11 gives 1/21, but not why the formula is right (it's a geometric series, which I don't know).
- **"no NEE, chapter 14"** and **"weighted by MIS (chapter 15)":** never expanded. The caption's reason why NEE-on rows have noise depends entirely on MIS.
- **"brings 7 or 4.9":** where do these numbers come from?
- **Section 4, the check-shaders excerpt:** "modules parse", "pipeline", "dispatches", "async", "storage binding". I couldn't see how it relates to noise and bias until I guessed it was another "check that cannot fail".
- **"About once in twenty?"** (Try it): the page only says "two times in three" for one error bar. The 95% for two bars is outside knowledge.

## 4. Words and symbols before explanation

- **No card:** NEE, MIS, albedo (only hinted in the furnace card), kernel, shader, resolve, flat world, ρ and E ("ρE/π"), exponential distribution, skewed, Fresnel, critical angle, Russian roulette, haze test, cached files, node.
- **firefly:** the card helped, but it leans on "pdf", a new term.
- **moving window°:** the card is titled "moving average". Its "2N + 1" was the most useful line on the page.
- **consistent°:** the text's "wrong after any number of samples but less wrong the more there are" reads as a contradiction. The card's "right in the limit" fixed it.
- **error bar, bias, unbiased, control, white furnace:** clear and helpful cards.
- **"the error bar worth 4096 samples"** appears in Figure 1's readout two sections before it is explained.

## 5. Figures

- **Figure 1:** the reading over samples for four ways of averaging. The right-hand graph makes the point well: blue closes on the dashed 1.644, red settles at 0.94 with dashed bars that never reach it, orange settles at 1.20, and teal keeps jumping. Problems:
  - The eye isn't labelled. I'm guessing it's the small ⌀ mark.
  - The left drawing is identical in all four screenshots. The orange path goes floor → wall → lamp, so in "cut after 1 bounce" it should bring nothing, yet it stays orange.
  - "Dashed" means two things: the coloured dashes are the error bars, and the black dash is the true value.
- **Figure 2:** furnace rows. The pass/empty/sky comparison is clear, and showing two causes with identical numbers is effective. Problems:
  - The readout says "4 of 4 rows" next to five rows (the control is counted separately, but that isn't said).
  - The matte row reads 1.0068 and "passes", but no tolerance is given.
  - Nobody shows why the grey row should read 0.85. 0.25 + 0.75 × 0.8 would explain both it and the control's 0.25.
- **Figure 3:** scatter of means against reported bars. The two bar heights side by side (0.216 vs 0.308, the red bar) make the "wrong" step obvious. The left plot's bars look only slightly longer in "wrong", so the right panel does the work. "Scatter by 0.175" assumes I know standard deviation.

## 6. Maths fold-outs

There are none on this page. The maths is inline (1/√n, seRatio, w/(2 − w)), and it is where I most needed one.

## 7. The code

- **tests.js:** clear. The comment tells the whole story.
- **raytrace_main.js:** with the caption I could follow the loop over neighbours and the d2/e2 sums. Things that stayed unclear:
  - Is `f` the same array as `a`? The caption mixes them.
  - `sen` and `seSum` are never explained.
  - `**` and `!= null` are unfamiliar.
  - `w` is the width here but a weight in measure.js.
- **measure.js:**
  - The Y line is a running average I could follow.
  - The S line made sense once I thought of old weights shrinking by (1 − w).
  - The V line, `(1 - w) * (st.V + w * d * d)`, stayed opaque.
  - "as the kernel's select()" is opaque.
- **check-shaders.mjs:** mostly opaque. See section 3.

## 8. Too much, too little

- **Too much:** the rough-glass story appears three times (sections 2, 5, 6) with four numbers (0.9231, 0.9587, 0.9872, 0.944). "24 modules parse" appears twice. Section 6 repeats section 2's stories. The dates and file names in section 5 are heavy going.
- **Too little:** section 3's reasoning, the link between V/S and the error bar, and why the control's expected value is 0.25.

## 9. Wrong or contradictory

- In Figure 1, the left drawing still shows an orange two-bounce path in "cut after 1 bounce" mode.
- Section 2 says "each row's ratio ... must be 1", then that grey must be 0.85 and black well below 1.
- The story says rows "read 1000.000244", while the figure shows 1.0000. These are different scales, and the reader has to connect them.
- Figure 2's 1.0068 "passes", while section 5 calls 0.02–0.09% above 1 "light made" and a bias.
- Section 1: "A third kind sits between these" comes inside the window paragraph, so at first I thought the window was the consistent kind.

## 10. The five changes

1. **Section 3:** add a fold-out that shows how V and S make the error bar, why 1/S is a sample count, why neighbour differences square-add, and how w/(2 − w) comes out.
2. **NEE, MIS, albedo, kernel:** expand each in a phrase or give it a card. If a term isn't needed here, drop it.
3. **Figure 1:**
   - Label the eye.
   - Make the left drawing follow the chosen reading (grey out the orange path when cut, mark clamped ones).
   - Say where 7 and 4.9 come from.
4. **Figure 2:**
   - Count "4 rows and the control".
   - State the pass tolerance.
   - Show 0.25 + 0.75 × 0.8 = 0.85.
5. **Section 4:**
   - Introduce the check-shaders excerpt as "another check that could not fail", or cut it.
   - Explain measure.js's V line.
   - Trim the repeated rough-glass and cached-file stories in sections 5–6.
