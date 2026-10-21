# Chapter 31, "The optics bench": read as a beginner

## 1. Teach-back

The Optics page doesn't make a picture. It fires rays out of a lamp and counts where the light goes, the way a lighting lab would. Rays that fly away are sorted into direction "bins" by two angles (γ from the lamp's axis, C around it). Each bin's light divided by the bin's size gives the intensity in that direction, in candela. The brightest bin reads too high: the bins near the axis are tiny, catch few rays and are noisy, and the biggest of many noisy numbers is high by luck. The beam angle is measured at half that peak, so it comes out too narrow. More rays fix this slowly (100× the rays for 10× less noise). For a round beam you can pool a whole ring of bins into one. A floor can be a detector: cut it into squares, and each square's light over its area is illuminance in lux. With only a few hits per square, that map is mostly noise. Smoothing cuts the noise but blurs the sharp middle, which then reads low: that is bias. Adding millions of rays into a 32-bit float goes wrong because its steps grow, so the kernels add whole-number units instead, into two 32-bit numbers, which is exact and gives the same answer in any order.

## 2. Quiz

1. Each ray that leaves the scene goes into a bin by its direction (γ, C). A bin's light over the solid angle it covers is the intensity in candela. The peak reads high because the bins near the axis are the smallest, catch the fewest rays and are the noisiest, and the peak is "the largest of many noisy numbers". *What a solid angle is, and why candela is light divided by one, I know only from outside knowledge; the page points to chapter 5.*
2. The beam angle is the angle across the beam between the two directions where the intensity falls to half the peak. A peak that reads too high pushes those half-points closer to the axis, so the beam reads **narrower** (cos⁵ at 20,000 rays gives 44° against 59°). The page only shows "narrower" through its numbers: "inherits that" never says which way.
3. Each ray that reaches the surface stops, and its landing point and light are recorded. Square cells; light ÷ area in m² = lux. A cell's noise is about 1/√(its hits). Smoothing lets a hit count in its neighbours' cells too (a Gaussian), or reads each cell from its 32 nearest hits. The trade: less noise but more bias. It blurs over about 8 cm, and the sharp middle reads low (831 against 955).
4. A float's steps grow with its size. Past 2²⁴ the step is 2, so adding 1 rounds away; 0.7 gets added as 0.5 or 1; and the order of the adds changes the result. The kernels turn each weight into units (×2²⁰, rounded) and add them atomically into a low/high pair of 32-bit words, carrying by hand. This also avoids a "compare-and-swap loop", but *what that is, the page didn't teach me.*
5. A ray isn't killed at random. It carries a weight (the light it has left), absorption lowers it, and only a black or glowing surface, the bounce cap or leaving the scene ends it. So all the light lands in some tally: emitted = escaped + cut by the cap + absorbed. *Why killing rays at random would spoil this, the page doesn't say. I know from outside knowledge that Russian roulette boosts the survivors, so the totals are only right on average.*

## 3. Where I got lost (worst first)

1. **"rays of weight 1", "A weight of 0.7"** (§3). What a ray's weight is gets explained only in §5. In §3 I didn't know why a ray of light would weigh less than 1.
2. **"A bin's light over the solid angle it covers (chapter 5) is the luminous intensity … in candela"**. The chapter's key definition rests on solid angle, lumen and candela, and none of them is explained here. It doesn't even say what unit "light" is measured in.
3. **"I_0 = 1000 / π = 318 cd"**, **"the true 955"**, **"I(γ) cos γ / d², which here is 955 cos⁸ γ"**. Where π, 955 and the cos⁸ come from, and what d is the distance to.
4. **"a pair of 32-bit words, the carry into the high word done by hand when the low word wraps round"**. "Word", "wraps round" and u32 are never explained. A car-odometer picture would have done it.
5. **"a ring 5° wide round the axis cut into 24"**. I couldn't picture the bins at all. I know why bins near the axis are small (longitude lines meeting at a pole) only from a globe.
6. §5's "Glass as the textbook says" (which formula? what does "polarised" mean?), "One readback" ("readback", "Live round", why the picture's frames get in the way), and §6's "4247 K" and "Zemax".

## 4. Words and symbols

Used without an explanation: photon, solid angle, lm, candela, goniophotometer, Lambertian ("matte" helped), "a cos⁵ source" (I guessed that intensity ∝ cos⁵ γ), polar diagram, lux, Gaussian, photon map, thread, 2²⁴, word, wrap, compare-and-swap, Russian roulette, bounce cap, total internal reflection, K (kelvin), error bar, Math.fround, WGSL.

The cards:
- **bias** is exactly what I needed.
- **atomic operation** is clear.
- **intensity** helps.
- **illuminance** defines it through "irradiance", another unknown word.
- **f32** has a great ruler image, but "near a light of 25,000" confused me (a light? a value?), and the part about positions and tolerances belongs to another chapter.
- The **stamp** cards are clear.

## 5. Figures

- **Fig. 1**: a polar plot with the axis up. Blue is the measured curve, dashed is the true one, and the red dots mark the half-peak points. The four screenshots make the point well: jagged with a spike on top at 20k, smooth at 2M, smooth at 200k pooled. Three things confused me:
  - The legend's "the grid's C0-C180 plane" is never explained.
  - I had to work out for myself that a point's distance from the bottom point *is* the intensity, because the rings carry no cd values.
  - There is no 90° label.
- **Fig. 2**: a map plus its middle row, and it is clear. The 5,000-ray screenshot is obviously noisy. The knn screenshot has smooth edges while the middle still scatters, which looks like it contradicts "18% everywhere" until you realise that the percentage is relative. The page should say so.
- **Fig. 3**: clear axes, and "(1: exact)" helps. Three things are confusing:
  - The red 0.7 curve goes *above* 1 near 2²².
  - The "more" step shows nothing new, since the blue line was there from the first screenshot.
  - The readout's integer 46,976,192 doesn't match the true 46,976,204.8.

## 6. The maths fold-outs

There are none on this page. With school trig I could check the beam angles myself: cos γ = ½ gives 60°, so 120°; cos⁵ γ = ½ gives 2·acos(0.5^(1/5)) ≈ 59°. The page should show that. As written, "0.5^1/5" reads like 0.5/5. I took π, 955, cos⁸ and 1/√N on trust.

## 7. The code

- **optAdd**: the note makes it readable. The test `old + v < old` clicked only because I already knew that unsigned numbers wrap (*outside knowledge*). Still opaque: why the clamp is at 4000, and what `slot` and `&optData` are.
- **farBin**: the note helps. A dot product, acos of one, and a 3D cross product are beyond school maths, where vectors are 2D arrows. The clamp to [-1, 1] and the `nG - 1` are unexplained. I understood `ig * nC + ic` from arrays.
- **detmap**: dense (KDE, Epanechnikov, "conserve flux", KNN_MAX_CELLS), and line 43 stops mid-sentence: "`relNoise` estimates a lit cell's relative".
- **estimate.js**: opaque. Batches, Welford, Chan, "quadratic", "two-pass" and "Live analysis" never appear in the chapter's text.

## 8. Too much, too little

- **Too much:** the last two code excerpts, §5's glass and readback items, and all of §6 (written for insiders).
- **Too little:** §1's first paragraph packs photon, the grid, solid angle, candela, goniophotometer, Lambertian, the true formula and two results into one paragraph. §3 explains the integer method in one sentence.

## 9. Wrong or contradictory

- "γ … and C … in 5° steps" disagrees with "cut into 24" and "24 times the rays": 24 × 5° is 120°, not 360°, so C must be in 15° steps.
- farBin says the bins are "centred on 0". That makes the first γ bin a 2.5° cap, not "a ring 5° wide"?
- The integer pair is called "Exact for any count", yet the readout is 12.8 short. The "0.2 units short" rounding explains it, but the page never connects the two.
- Fig. 3 at 0.7: the float reads *high* near 2²², while the text only ever says it goes low.
- Gaussian: a blur should flatten the peak, but the screenshot's blue dots *dip* at the centre, below their neighbours. Plain and knn at the same ray count read 800 and 832. So is 831 the blur's bias, or leftover noise? The 13% shortfall is bigger than the "about 10%" noise.

## 10. The five changes

1. Define a ray's weight before §3, and move "Weights, not survival" up beside it. Say what Russian roulette is and why it would make the totals right only on average.
2. Give one sentence each (plus a sketch) for solid angle, lumen, candela and lux. Add a globe picture of the bins showing why the ones near the axis are tiny, and fix the 5°-versus-24 clash.
3. Explain the low/high word and the wrap with an odometer. Say that the integer sum is exact in units, with each weight rounded once, and point at the readout's 12.8. Explain why figure 3's red curve goes above 1.
4. Show the derivations a school student can do (the beam angle from cos γ = ½; 0.5^(1/5) with brackets). Say where 318, 955 and cos⁸ come from, or link the exact section of chapter 5.
5. Cut the detmap and estimate excerpts, or introduce batches and error bars in the text before them. Drop or explain §5–6's glass, readback, Zemax and 4247 K items, and fix the cut-off comment line.
