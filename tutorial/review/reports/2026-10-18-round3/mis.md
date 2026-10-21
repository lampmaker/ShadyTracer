# Beginner read: Chapter 15, "Two ways to the light"

## 1. Teach-back
There are two ways to find out how much lamp light a shiny plate sends to the camera. You can aim at the lamp, by picking a random point on it, or you can bounce a ray the way the plate reflects and hope it hits a lamp. Aiming works badly on mirror-like plates under long lamps, and bouncing works badly on rough plates under tiny lamps. MIS does both and gives each answer a weight. A strategy that was more likely to pick a direction gets more of the weight for it, using squares of the two likelihoods. For any one direction the two weights add up to 1. The pictures show that MIS is smooth everywhere, with an error of 6% against 12–13% for either way alone. In code it is one small function, `a/(a+b)`. The two ways must use the same material. Bugs happened when a direction was weighed against a way that could never have picked it.

## 2. Quiz
1. Picking a lamp point does badly on sharp plates, worst under the long lamp: "a point picked anywhere on it is almost never in the narrow range of directions the plate reflects." Picking a direction does badly on rough plates under the tiny lamp: "a direction drawn from a wide spread almost never meets it." The fold-out gives the reason: a rare direction carrying a lot of light gets divided by a tiny p.
2. MIS multiplies each estimate by a weight and adds them, and the weights for one direction sum to 1. The page only *asserts* that this means nothing is counted twice. That each sample's weight uses *both* densities at *its own* direction I took from the code (`lobesPdf`), which is *outside knowledge* for a real beginner.
3. Whichever density is higher at that direction: weight = p_this² / (p_this² + p_other²). I checked this against the readout: 5.86 against 0.66 gives 0.99.
4. A ray refracted out of glass towards the sun was weighed against the lamp strategy, which wrongly claimed a non-zero density below the surface. Its weight came out 0, and the lamp strategy never sends rays there, so neither counted that light. *Why* the weight was 0 is only in the code comment ("the BSDF density is also 0"). The page also never says what a *non*-plain shadow would look like.
5. MIS is only unbiased if both use the same material. When they did not, brightness moved with the share of shadow rays (−1.2% to +0.5%). The page never explains *why* a mismatch makes the result depend on that share.

## 3. Where I got lost (worst first)
- **Fold-out:** "is an integral over the directions" — I have no calculus. f, θ and L_e are never defined, so I could not read the formula at all.
- **"the weights for any one direction add up to 1, so nothing is counted twice"** — but the two strategies pick *different* directions. How do their weights pair up? Why squares? "Power heuristic" gets no explanation.
- **Third code excerpt:** the chapter is about lamps, but this code handles "the sky or the sun", and lamps are pushed off to "chapter 16". So I don't know which code does what the figures show.
- **"MEASURED" stamp:** "−1.2% with none, −0.9%, 0, +0.5%". Relative to what? What is "the share of shadow rays"? With *no* shadow rays the lamp side never runs, so why would anything be wrong?
- **Glossy plastic, 10⁹:** I can't see why a big number for the coat "switched off aiming for the matte base". Working it through the formula would show it. "Coat" and "base" are new ideas.
- **Section 4:** "weighing it against a density that is not zero where it should be loses light" — this is missing "zero", and I had to reread it.
- **"cannot be weighed when the bounce is chosen … So the weight is worked out at the bounce"** — this reads as a contradiction until you see that it is *computed* at the bounce and *applied* later.

## 4. Words and symbols
- **Not explained:** integral, f, θ, L_e, radiance, heuristic, log scale, error bar, radians (school uses degrees, and Fig. 2's axis is in degrees), WGSL, f32, NaN, kernel, lobe(s), BSDF, delta event, emitter, environment, sun cone, "Ampere card", FAST MODES.
- **Used with no card:** "light sampling" and "BSDF sampling" in *Try it*.
- **Too many names for the two strategies:** lamp side / lamp strategy / aiming / light sampling / NEE / picking a point on a lamp, and plate side / plate's way / bounce / BSDF sampling / picking a direction.
- **Cards that helped:** the pdf card (½ per metre of a 2 m lamp) is excellent and made "taller where a lamp looks smaller" click. The glossy, NEE, shadow-ray and bias cards are good; bias explained "unbiased".
- **Card that didn't:** the MIS card says "neither can make a firefly", and firefly is never explained.

## 5. Figures
- **Fig. 1:** the point comes across, and the 8 → 256 screenshots plus the readout (61/48/34% → 13/12/6%) back up the text. What tripped me up:
  - The strips look like barcodes. Nothing says the plate is a line, so each pixel column is one point on it.
  - The red σ labels sit on the strips, and "σ 0.25" is unreadable.
  - "From 0.2 to 8.6" has no unit.
  - The orange ticks under the lamps are not explained.
  - "Speckled" describes what are really vertical streaks.
- **Fig. 2:** the top plot shows densities and the bottom one shows weights; the rough and sharp screenshots match their paragraphs, and the readout numbers fit the formula. What tripped me up:
  - Log scale is not explained.
  - Humps aren't labelled with their lamp. With four lamps I count only three humps in the rough shot.
  - The axis says the plate is "the camera-ray colour" (blue), but Fig. 1's camera rays are grey.
  - In the readout, "lamp smallest/largest" stands for the text's "tiny/long".

## 6. Maths fold-out
I could follow "noisy where p is small but the light is not" and the w_lamp formula, and I could check it with the readouts. I could not follow the integral or the meaning of the numerator. The p_lamp and p_plate definitions run together on one line. w_plate is never written out.

## 7. Code
- **misWeight:** clear, because a, b and `a/(a+b)` match the formula. `max(…,1e-20)` and NaN stayed opaque.
- **Lamp side:** I could match f, le and w. The page never says `NoL` = cos θ or `dS` = p_lamp. `res.r.beta`, `neeMinAlpha`, `lobes` and `select`'s argument order stayed opaque. "dS … the same, here": why have two names, then?
- **Plate side:** almost all opaque (lightFaceShare, emitShare, envPdf, isDelta, vtxLtot, misOut). The one useful line is `sunmis = misWeight(pBout, pLout)`.

## 8. Too much, too little
- **Too much:** the 34-line third excerpt. The glass-ball and 10⁹ stories are told three times: in the code comment, in section 4 and in section 5.
- **Too little:** why squares, why "sums to 1" means correct, and how two different directions combine. Each "what went wrong" story is a single dense sentence.

## 9. Wrong or contradictory
- In the **sharp screenshot** both weights sit at 0 across most directions, which seems to contradict "the weights … add up to 1". The 0/0 caption on misWeight hints at the reason, but the figure never says so.
- **"fast … every answer counts in full"** sounds like counting twice, which contradicts the fold-out.
- **"flat-topped humps"**, but the 56–70° hump in the sharp shot slopes from about 0.5 to 2.
- **σ is in radians**, while the plot is in degrees.
- **Glass ball:** the glass picked the refracted direction, yet its own density there was 0?

## 10. Five changes
1. Rewrite the fold-out without "integral". Say in words that f is how much the plate reflects towards the camera, cos θ is the tilt, and L_e is the lamp's brightness. Map `NoL`, `le` and `dS` onto those letters.
2. Show one worked example with a lamp sample and a plate sample, each weighted with both densities at its own direction. Explain why weights summing to 1 means counted once, and why squaring.
3. Give each strategy one name throughout, and define BSDF and NEE in the text, or drop them from *Try it*.
4. Cut the third excerpt to the `above` / `pLout` / `sunmis` lines, and say how sun, sky and lamps relate.
5. Fix the figures and stories:
   - Label the humps.
   - Explain the both-zero weights.
   - Explain log scale.
   - Make the colours match Fig. 1.
   - Move the σ labels off the strips.
   - Say what a glass ball's shadow should look like.
   - Show 10⁹ in the formula.
   - Say what the measured percentages were compared with.
