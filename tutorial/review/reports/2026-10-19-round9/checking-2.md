# Chapter 29, "Noise, bias and checking": read as a beginner

## 1. Teach-back
A picture made from random samples can be wrong in two ways. Noise is the random wobble of a pixel's average. It shrinks as samples are added, and the error bar tells you how much of it is left. Bias is a wrong answer that stays put. In the corner example, cutting every path after one bounce makes the reading settle neatly on 0.94 when the truth is 1.644. It is "precise and wrong", and the error bar can't see this because all the samples agree with each other. Clamping bright samples at 4 is a second deliberate bias: the picture gets quieter and darker. To check a renderer you need a case where you already know the answer. In the white furnace, a white ball in an evenly lit sky has to vanish, so its ratio reads 1. But an empty picture also reads 1, so the test needs a control row that must fail, a black ball. If the control "passes", nothing was measured. You can check the error bar itself on a flat floor: neighbouring pixels differ only by noise, so their squared differences should match their squared error bars, and seRatio should be 1. A moving window of 10 is worth 21 samples, not 10 or 11. Getting that wrong makes the error bars too wide, and seRatio drops to 0.69.

## 2. Quiz
1. **Noise vs bias.** Noise is scatter around the true value and fades with more samples. Bias is "an estimate wrong on average" and does not fade. The error bar "measures how much the samples disagree with each other". Biased samples can agree on a wrong answer, so the bar shrinks around the wrong value: 0.94 sits 19 error bars below 1.644.
2. **Two deliberate biases.** (a) A bounce cap of 1 loses the light that comes off the walls, so the picture is darker (0.94). (b) A firefly clamp cuts samples above a limit, which removes speckles but makes the picture darker too (1.20). The page also calls the photon map *consistent*: it blurs, and the blur shrinks over time.
3. **Why a control.** "An empty picture reads exactly what a perfect one does", so the white rows pass even when the scene didn't load or the camera looked away. When the page is broken, every row reads 1.0000 with noise 0. The white rows pass, the grey row fails, and the control reads 1.0000 too: "a row that must fail, passing".
4. **Checking the error bar from the picture.** On a flat, evenly lit floor, the average of (La − Lb)² over neighbours should equal the average of se_a² + se_b². seRatio is the square root of their ratio and should read 1. Below 1 means the bars are too wide. Above 1 means they are too narrow, or the picture has real detail.
5. **The window.** It is worth about 21 samples (1/S settles at 21), however long it runs, so its error bar stops shrinking. The window row would catch an error bar worked out as if the window were worth its count, 11. That bar reports 0.308 against a real 0.216, with seRatio 0.69. The page says this row has never been run on a real card.

## 3. Where I got lost (worst first)
1. **Fold-out:** "V estimates s² once divided by (1 − S)". The page gives no reason for this. I can't see why it's there, or that for a plain mean it gives the familiar s/√n.
2. **Section 3, opening:** "S, the sum of the squares of their weights in the average". What weights? A plain average has no weights as far as I know. The fold-out only answers this later.
3. **Section 2, "sky":** "its camera kept the view's target in the wrong unit, 40 millimetres read as 40 metres". The "haze test" and "the view's target" are never explained, and I couldn't see why this pointed the camera at the sky.
4. **Section 1:** "the corner in the flat world". I don't know what the flat world is. I also couldn't tell which lines in the drawing start at the eye (see Figures).
5. **Section 1:** "The photon map of chapter 19 … its radius shrinks". The radius of what? I understood this only from *outside knowledge*.
6. **Sections 5 and 6:** "ρE/π", "E sin(elevation + tilt)", "Fresnel term", "critical angle", "facets", "Russian roulette", and "the light's sample and its chance". None of these are explained on this page.
7. **Section 2:** "1000.000244". Why not exactly 1000? *Outside knowledge* (rounding) fills this gap.

## 4. Words and symbols
- noise, error bar, bias, unbiased, consistent, albedo, white furnace, control: the cards helped, and albedo is also explained in the text.
- NEE: the card helps, but "shadow ray" is never explained.
- firefly: the card says "divided by a tiny chance (its probability density, the pdf)". That made no sense to me without *outside knowledge*, and the example has no such division.
- moving window: the card is titled "moving average" and the word list says "moving average°", but the text says "moving window". It helped, and "2N + 1" matches the 21.
- kernel: the card brings in GPU "rounds" and chapter 22, which is too much at this point.
- MIS (figure 2's caption), "exponential distribution", variance, "independent", Σ and w_i: none of these have cards. "Standard deviation" is explained inline, which was good.
- "log scale": not explained anywhere. I noticed the ticks go 1, 4, 16 and so on, each four times the last.
- seRatio: "Its square root over that" is ambiguous. It could mean √a / b or √(a/b). Only the code's description made it clear.

## 5. Figures
- **Figure 1.** The graph works well. The blue line closes in on 1.644, the red one settles on 0.937 while its dashed lines stay well away from 1.644, the orange one settles near 1.20, and the teal one keeps jumping around. The readouts match the text. The left drawing is weaker. There are many grey lines, and I couldn't trace the eye → floor → lamp path. In the "cut" drawing, the label "found after the cap: not counted" sitting next to the dashed red leg helps. It wasn't obvious to me that "± two error bars" in the caption means the dashed lines, while the readout's ± is one error bar.
- **Figure 2.** The point comes across clearly: the "empty" and "sky" screenshots are identical, all 1.0000, with "PASSES: nothing measured" in red. Two things confused me. The black control has noise 0.1455, but the readout says noise appears "where NEE is on or the disc is grey". The black disc also shows grey stripes.
- **Figure 3.** The bars make the point well: blue and orange are equal, then the orange bar turns red and grows to 0.308 in "wrong". The longer error bars on the dots show it too. The window step's seRatio of 0.97 isn't mentioned in the text.

## 6. Maths fold-out
I could follow "1/S counts samples" and the window algebra, S = w/(2 − w) = 1/21. School algebra is enough for those. I could not follow:
- why there is a 1 − S,
- "a thing times w has w² times the variance", which is stated rather than shown,
- why the variance of a *difference* is the *sum*.

## 7. The code
- **tests.js:** clear. The comment tells the story, and "tBase 0 makes its base colour black" explains the only code line.
- **raytrace_main.js:** "the same words of the accumulation read two ways" was opaque to me. I worked out that `* 4` means four numbers per pixel. It's clear that `x + 1 < w` keeps the neighbour inside the picture. The code adds up sums, but the text talks about averages. It compares only horizontal neighbours. The line that actually computes seRatio isn't shown, and seSum/relSE are side notes.
- **measure.js:** the best one. The Y line is a readable running average, and "capped at it, so w never falls below 1/(N + 1)" finally explains 1/11. "select()" and why V's line works stayed opaque.
- **check-shaders.mjs:** mostly opaque: module string, pipeline, async, rejection, storage binding. I got the point (the check passed on a day something was broken), but not the content.

## 8. Too much, too little
- **Too much:** section 2's dated stories with millimetres and the haze test, and the jargon in sections 5 and 6.
- **Too little:** the error-bar formula itself, which relies on chapter 12.
- **Section 1 is excellent:** concrete numbers (7, 4.9, 1.644) and one change per step.

## 9. Wrong or contradictory
- seRatio "here 1.08, within its own noise (a thousand pixels give about 3% of it…)". An 8% error is not within 3%. The hedge "more for a skewed distribution" comes too late to settle this.
- Section 5 says "the furnace 1 for every material". But rough glass "must read a little under 1", and the grey row reads 0.85.
- "a third of before … (√8 is 2.8)": 0.175 → 0.065 is a factor of 2.7, not 3. This is a loose phrase.
- The control's noise of 0.1455 doesn't fit the figure readout's account of where noise comes from.
- The word list says "moving average" where the text says "moving window".

## 10. The five changes
1. Explain the error bar's formula in the fold-out. Show that for a plain mean, S = 1/n, so the formula becomes √(V/(n − 1)) ≈ s/√n. Add one sentence on why 1 − S is there.
2. In figure 1, highlight one whole path (eye → floor → wall → lamp). Say in a line what the flat world is and what a log scale is.
3. In figure 2, explain the control's noise (the disc's edge is real detail, as section 5 says). Retell the "sky" story plainly: "the camera pointed at empty sky".
4. Reconcile seRatio 1.08 with "about 3%": give the real spread of seRatio, or show a run nearer 1.
5. Gloss or trim the unexplained terms in sections 5 and 6 (ρE/π, Fresnel, critical angle, Russian roulette, pdf in the firefly card), and fix "the furnace 1 for every material".
