# Blank-reader review: Chapter 6, "Colour"

## 1. Teach-back
Light is a mix of wavelengths from about 380 to 780 nm, and how much there is at each wavelength is the light's spectrum. My eye doesn't see the whole spectrum. It has three kinds of cone cell and keeps only three numbers, so two different spectra can look identical. In 1931 the CIE made three curves, x̄, ȳ and z̄, from colour-matching experiments. You multiply the spectrum by each curve and add up, and that gives X, Y and Z. Y is the brightness (luminance). Dividing X and Y by X+Y+Z gives x and y, the chromaticity: a point on a horseshoe-shaped map, with brightness taken out. A screen has three primaries (Rec.709) and can only show colours inside their triangle. A colour outside the triangle needs a negative amount of one primary. ShadyTracer keeps that negative number, because everything is adding and multiplying, so sums stay exact. Only the screen clips, once at the end, and it keeps the brightness. Lamps are described by a colour temperature (the nearest glowing hot body) and a Duv (how far off that line, plus meaning greenish). To mix three LEDs you solve three equations for three unknown lumens. If one comes out negative, the target is outside the LEDs' triangle.

## 2. Quiz
1. **Three numbers:** the eye has three cone types and keeps only how strongly each responds. X, Y and Z come from the CIE's 1931 colour-matching curves, measured by people matching colours: weigh the spectrum by each curve and add. *Not taught:* how the experiments worked, or how x̄, ȳ and z̄ relate to the cones. I half-assumed x̄ = red cone, and nothing corrected me.
2. **Chromaticity:** x = X/(X+Y+Z) and y = Y/(X+Y+Z), a colour with its brightness removed. *Why mixes lie on a straight line:* the page only states it. The fold-out shows that XYZ add, but not why adding XYZ then dividing lands on the line. I could not derive it. (Outside knowledge: it is a weighted average.)
3. **Negative channel:** the colour is outside the screen's triangle, so it needs a primary "taken away". It is kept because materials multiply channels by numbers ≥ 0, which is linear, so sums stay exact and a detector gets the true XYZ back. Clipping each deposit first would shift a mix. Only negative *luminance* is refused. *Not taught:* why "≥ 0" matters. Linear would work without it.
4. **CCT and Duv:** CCT is the temperature of the nearest hot body. Duv is the distance off the hot-body line, measured at right angles on the 1960 map, plus towards green and minus towards pink. *Not taught:* how "nearest" is found, or what the 1960 map is.
5. **Mixing:** each LED's XYZ per lumen times its lumens must add up to the target's XYZ: three equations, three unknowns. It is unreachable when the target is outside the LEDs' triangle, because one flux goes negative. *Not taught:* how the equations are solved ("inverse" is never explained).

## 3. Where I got lost (worst first)
- **The matrix fold-out:** "the columns of a 3 × 3 matrix M: a colour R, G, B is M times (R, G, B)", "M⁻¹", "linear". I've never multiplied a matrix. The one bridge I have, "Three unknowns, three equations", is in section 3, but the equations are never written out.
- **Section 2, blue LED paragraph:** negative green, materials, detectors, exactness and clipping are all in five sentences. "Every material multiplies each channel by a number of 0 or more, which keeps sums of colours exact" left me unsure why ≥ 0 gives exactness.
- **Section 1, last paragraph:** "reads 3024 K, Duv +0.0004, on the standard's line of hot bodies" uses CCT and Duv a section before they are defined.
- **"Its red, green and blue at luminance 1 are 1.45, −2.57 and 35.0":** why is blue 35? Why is 1.77 fine but −2.57 not? Screen values above 1 are never mentioned. I later worked it out from the fold-out (0.2126·1.45 − 0.7152·2.57 + 0.0722·35 ≈ 1), but the page never invites that check.
- **Sections 4–5:** "true locus", "3.8 × 10⁻⁴ at 2856 K", "colour noise everywhere", "the user's Pascal card", "the hybrid", "the counting noise of about 1650 blue rays". I couldn't tell why these matter.
- **"The user's own luminaire / colour tool":** which user?

## 4. Words and symbols before explanation
- **Rec.709:** used in fig 1's readout; section 2 only says it is "the standard ShadyTracer's red, green and blue are". It is never said to be what ordinary screens use. No card.
- **u′, v′:** in fig 2's readout and the "measured" stamp, and only explained in section 6, and then only relative to a 1960 map that is never drawn.
- **"square to":** I had to guess that it means perpendicular.
- **Others:** locus, Σ, inverse, linear, kernel, WGSL, deposit, detector, lux, photons, standard deviation, converges, "Pascal". Ray, lumen and material lean on earlier chapters.
- **Cards:** the gamut card ("A colour outside it needs a negative amount of one of them") explained things better than the main text. The CCT card's examples (candle 1900 K) helped. The chromaticity card's "twice as bright is the same point" helped. The luminance card leans on "radiance", which isn't defined here.

## 5. Figures
- **Fig 1:** the curves plus a dashed spectrum, clear, and the 2700 K vs 6500 K slopes make their point. Problems:
  - The "+" handle covers the ȳ label at 530 nm.
  - Nothing says the red/grey/blue curves aren't the cones.
  - x̄'s second bump near 440 nm is unexplained.
  - The "weigh and add" step isn't drawn. A shaded product would show it.
- **Fig 2:**
  - **The outline looks broken.** The left edge runs below 480 to a sharp corner at about (0.03, 0.03). From there a straight dark line cuts up across the map to about 580 nm. The right end past 620 is left open. Because of this, the dashed triangle's red and blue corners and the warm end of the orange line sit outside the coloured shape, which contradicts "every real light lies inside". (Outside knowledge: the real diagram is closed by a straight line from the violet end to the red end.)
  - The temperature labels overlap ("6500"/"10000", "2000"/"1500"), and neither 1000 K nor 15,000 K is labelled.
  - The dashed R bar (1.77) is unexplained.
  - In the blue case the −2.57 bar is a sliver.
  - The "greenish" Duv +0.02 patch looks yellow to me.
- **Fig 3:** clear. The triangle, the bars and the red note "one would have to be negative" make the point well. The same stray dark line crosses the LED triangle.

## 6. Maths fold-out
- I could follow X = Σ S(λ)x̄(λ) only because the text had already said "weigh and add". Σ itself is never explained.
- I can use X = xY/y as a formula.
- Everything about M and M⁻¹ I took on trust.
- "Because all of it is a matrix times a vector, it is linear" means nothing to me without matrices. "The XYZ of two lights added is their XYZs added" is the bit I actually understood.

## 7. Code
- **lightRGB:** the caption made the three branches readable. `??`, `...` and `.map(v => v / Y)` are beyond my JS, but I could guess them.
- **badDeposit:** the comment is the explanation. `vec3<f32>` and `${LUMA.join(', ')}` stayed opaque. "Filled in when the kernel is built" assumes I know what a kernel is.
- **gamutClip:** the best one. With the caption I checked that `t = Y/(Y−lo)` sends the lowest channel to exactly 0.
- **mixToTarget:** `[0,1,2].map(r => cols.map(c => c[r]))` is opaque. I would never have seen that it "makes columns". `inv3` is a black box. The `-1e-9` note was helpful.

## 8. Too much, too little
- **Too much:** the fit-error paragraph in section 1, the locus stamp, the dates, PLAN.md and card names in section 5, and much of section 6's history.
- **Too little:**
  - why a mix lies on a straight line
  - the three equations written out
  - what RGB > 1 means
  - why blue needs 35
  - why one wavelength per ray gives noise
  - u′v′ and the 1960 map
- **Rushed:** section 2's last paragraph.

## 9. Wrong or contradictory
- **Fig 2/3 outline:** as described above, it contradicts "every real light lies inside".
- **Section 3, "below the line from red to green":** in fig 3 the triangle lies *below* that edge, on the blue side. A target below it would be inside. The target is outside with negative *blue*, so it should be on the far side from blue, i.e. above. The screenshot shows it right on the edge, barely above.
- **Exactness condition:** section 2 says "Every material… so a detector turns the three back into exactly the X, Y and Z". The code comment says exact only "as long as the optics are neutral", and section 5 says "materials that treat the three alike". Section 2 drops that condition.
- **Hot-body range:** the text says 1000–15,000 K, but the labels shown reach only 10000.

## 10. The five changes
1. Fix the chromaticity diagram's outline: close it from the violet end to the red end and remove the stray line. Correct "below" in section 3.
2. Show the arithmetic before the matrix. Add two lights' XYZ to show the straight-line mix. Write section 3's three simultaneous equations. Give one sentence or a mini fold-out on what a matrix and its inverse are.
3. Explain the RGB scale: "at luminance 1" means brightness is set later, so values above 1 are fine. Show the 0.0722 check for why blue is 35. Explain the dashed bars.
4. Remove early or internal jargon:
   - Move the 3024 K/Duv paragraph after section 2 or into a fold-out.
   - Define u′v′ or drop it from the readouts.
   - Replace "square to" with "perpendicular".
   - Say Rec.709 is ordinary screens' standard.
   - Gloss "Pascal card", the locus and "colour noise", or cut them.
5. Split the blue-LED paragraph. Add the neutral-materials condition. Give a tiny numeric example of two LEDs clipped separately vs summed then clipped, to show the mix shifting.
