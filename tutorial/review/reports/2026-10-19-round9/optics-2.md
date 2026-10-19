# Chapter 31, "The optics bench": a beginner's reading

## 1. Teach-back
ShadyTracer can measure a lamp the way a lab does. It traces rays out of the lamp and sorts the escaping ones by direction into "bins": γ is the angle from the axis, C the angle around it. A bin's light divided by its share of all directions is the intensity, in candela. The bins round the axis are tiny and noisy. The highest of many noisy bins reads too high, so the beam angle (the width at half the peak) reads too narrow. More rays help only slowly, because noise falls with the square root of the number of rays. Pooling a ring's 24 bins helps cheaply. On a floor, you count hits in square cells and divide by the cell's area to get lux. Smoothing gives less noise but a blur that reads low at a peak. A 32-bit float can't add up millions of weights, because its steps grow as the total grows. So the GPU adds whole-number units into two 32-bit counters with a carry, like an odometer.

## 2. Quiz
1. **Intensity.** Each escaping ray goes into a bin by its direction (γ in 5° steps, C in 15° steps). A bin's lumens divided by its solid angle (steradians) gives candela. The peak reads high because the bins near the axis are the smallest and noisiest, and the peak is the largest of all the bins, so it takes on their noise. *Not taught:* what one ray carries in lumens (I guessed 1000 lm ÷ rays), or how a bin's solid angle is worked out.
2. **Beam angle.** The full width between the directions where the intensity falls to half the peak. A peak that is too high puts that half level too high, so the beam comes out too narrow (44° against 59°).
3. **Illuminance map.** Rays stop on a "detector" surface, and the page records where each landed and how much light it carried. A cell's light ÷ its area in m² is lux, with noise ≈ 1/√hits. Smoothing spreads each hit into the cells around it. Noise drops (51% → 10%), but the blur (8 cm) reads low at the peak (913 against 955 lx on average). That is bias: less noise for more bias.
4. **Float totals.** Past 2²⁴ the step is 2, so adding 1 changes nothing. A weight of 0.7 gets rounded to 0.5 or 1, and the order of the adds changes the answer. The kernels instead turn each weight into units (× 2²⁰, rounded once) and add them atomically into a low 32-bit word, carrying into a high word. The result is exact except for that one rounding, the same in any order, with no retries. *Half taught:* why a float needs a "compare-and-swap loop".
5. **Weights, not survival.** Nothing ends a ray at random. Absorption only lowers its weight, and the ray ends only at a black or glowing surface, at the bounce cap, or by leaving the scene. So every bit of weight lands in one tally: emitted = escaped + cut + absorbed. *Not taught:* what Russian roulette is, so I can't see why random ending would spoil this. That it is "right only on average" is *outside knowledge*.

## 3. Where I got lost (worst first)
1. **How to read the polar diagram.** The caption says "the light's axis straight up", but nothing says the lamp is the bottom point, or that the *distance* to the curve is the candela. *Outside knowledge* told me. I also don't know why "cos" draws a circle. The legend's "blue: the grid cut through its axis" is opaque.
2. **Fig 3 at 0.7.** "too little (0.5, between 4 and 8 million) or too much (1, between 8 and 16 million: the curve's rise above 1)". Is that 4–8 million rays, or a total of 4–8 million? The x-axis counts rays. The clearest bump above 1, around 2²¹–2²², is never explained. The bump the text means, near 2²⁴, barely gets past 1.
3. **"So the totals add up exactly."** The "so" doesn't follow without Russian roulette explained. Why does a *glowing* surface end a ray? What is a "bounce cap"?
4. **"compare-and-swap loop", "retry storm".** Neither is explained, so the third benefit is lost on me.
5. **"12.8 short … is 0.2 units each".** 0.2 × 67 million = 13.4 million. It only works after dividing by 2²⁰, which the page leaves out.
6. **§5–6** use words from nowhere: readback, Live round, Fresnel, polarisations, Zemax, "sensor 3 × 3 pixels".

## 4. Words and symbols
- **Unexplained:** "fitting", "binned" (in the intro), "photon … that never stops to make a picture", goniophotometer, Lambertian, steradians/4π, "optics kernels" (only the detmap note hints that a kernel is a GPU program), GPU threads, Math.fround, sigma, u32, dot/cross product, atan2, Russian roulette, bounce cap.
- **Cards:** *intensity*, *bias*, *f32* (the ruler with widening marks) and *atomic operation* all helped. *illuminance* explains itself with "irradiance", a word I don't know either.

## 5. Figures
- **Fig 1:** the screenshots match the text (362 cd; 1281 cd, 34.2%, 43.75°; 2.4%; pooled 1.1%, 58.91°), and the curve going from jagged to smooth works. Two problems: the reading issue in §3.1, and the text saying "the curve follows the true one" at 200,000 rays while the screenshot's top is spiky.
- **Fig 2:** clear. The scattered dots against the dashed line show noise, and the Gaussian's flat top under the dashed peak shows bias. The knn text says "edges stay sharp", but this spot has no edge to look at.
- **Fig 3:** weight 1 falling away at 2²⁴ is clear and convincing. The wiggles at 0.7 need labels. The readout gives "the integer pair" as one number, not as the odometer's two words.

## 6. Maths fold-out
The beam angle part I followed, and checked 2·acos(0.5^0.2) = 58.95° on a calculator. The floor part I followed too (d = 1/cos γ, the slant, then adding the powers). The peak part ("adding the intensity over the half sphere's solid angle") is calculus, so I took it on trust. "0.5^1/n" is ambiguous as written. A sketch of the floor triangle would help.

## 7. Code
- **optAdd:** with the note, the wrap test `old + v < old` was satisfying. Still opaque: `&optData[slot]`, the `u` suffix, and why the clamp is 4000.
- **farBin:** still opaque: the `c90` line, `atan2`, and `(nG - 1)`.
- **detmap comment:** it mostly repeats §2 in harder words (Epanechnikov, KNN_MAX_CELLS).

## 8. Too much, too little
- **Too little:** how to read the polar plot, one ray's lumens, Russian roulette, compare-and-swap.
- **Too much:** §5's glass and readback items and all of §6. They read like a lab notebook. The "58.98° vs 58.95°" note is noise to a beginner.

## 9. Wrong or contradictory
- A weight "starts at 1 … every surface that absorbs some lowers it", yet the code clamps it to 0..4000. My guess is that 4000 × 2²⁰ just fits under 4,294,967,295, but the page should say why.
- "the curve's rise above 1" points to the smaller of the two bumps.
- The text calls the bump "1.5 cells wide", while the code has "sigma = bandwidth" and "cut at 3 sigma". Is the bump 1.5 cells wide, or 9?

## 10. Five changes
1. Fig 1: add one sentence and a mark showing that the lamp is the bottom point and that distance = candela at angle γ. Reword "cut through its axis".
2. §3: write "while the *total* is between 4 and 8 million (about 6–12 million rays)", and label both bumps of the 0.7 curve.
3. Explain Russian roulette in two sentences, so that "add up exactly" follows.
4. Explain compare-and-swap and "kernel/GPU thread" in plain words (cards).
5. Say what one ray carries and how a ring bin's solid angle is found. Shorten §5's glass and readback items and §6.
