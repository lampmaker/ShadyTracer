# Blank-reader review: Chapter 6, "Colour" (`page.md` + 9 screenshots)

## 1. Teach-back
My eye has three kinds of cone cell, so all it keeps of a light is three numbers. Two lights that give the same three numbers look the same. In 1931 a standards body turned colour-matching experiments into three curves, x̄, ȳ and z̄. You multiply a light's spectrum by each curve, add it all up, and get X, Y and Z, where Y is the brightness. If you divide X and Y by X+Y+Z, the brightness drops out and you get a point (x, y) on a horseshoe-shaped map. Single wavelengths lie on the curved edge and every real light lies inside it. When you mix two lights, the mix lands on the straight line between them. A screen can only show the colours inside the triangle made by its three lights (Rec.709). A colour outside the triangle has a negative red, green or blue. ShadyTracer keeps that negative number, because clipping each light before adding them changes the total. The screen clips only once, at the end. A light's colour temperature is the temperature of the nearest glowing hot body, and Duv is how far the light sits off that hot-body line. To mix three LEDs to a target colour you solve three equations. If the target is outside the LEDs' triangle, one LED would need negative lumens, which no lamp can give.

## 2. Quiz
1. The eye has three kinds of cone, so three responses are all that survive. X, Y and Z come from weighing a spectrum by the CIE's 1931 curves and adding up. **Not taught:** what the 1931 experiment actually was, and how x̄, ȳ, z̄ relate to the cones. I couldn't tell if they *are* the cones. *Outside knowledge* says they are a linear mix of the cone responses.
2. A chromaticity is x = X/(X+Y+Z), y = Y/(X+Y+Z): colour with the brightness removed. On mixing, the page says the result "works out to an average of the two points, each counted by its own X + Y + Z". I had to take that on trust, because the algebra isn't shown.
3. A negative channel means the screen's three lights can't make this colour: green would have to be taken away. It is kept because adding comes before clipping, as in the (0,−1,3)+(0,2,0) example. That example was clear.
4. CCT is the temperature of the nearest hot body. Duv is the distance from the hot-body line, at right angles, measured on the CIE 1960 map. The card adds that positive means greener and negative means pinker. **Not taught:** which map "nearest" is measured on for CCT. Also not taught: what kelvin is.
5. Write each LED's XYZ per lumen times its unknown lumens, and set the sum equal to the target's XYZ. Then solve three equations in three unknowns. The LEDs can't reach a target outside their triangle, because the solution comes out with a negative flux.

## 3. Where I got lost (worst first)
- **Section 5 and section 6.** These rest on ideas this page never teaches: "photons", "a detector in the optics trace", "deposit", "counting noise of about 1650 blue rays: each ray comes from one LED, picked at random", "one standard deviation is 250 K", "the first press read the right lux", "colour noise everywhere", "the user's Pascal card". I couldn't follow any of the evidence.
- **"only a screen has a ceiling."** Then the screen shows "1.13, 0 and 10.5", still above 1. So what does "clip" mean? On this page it only removes negatives. What the screen does with 10.5 is never said.
- **The maps.** The figure is xy. Duv uses "CIE 1960's (u and v)". Then the readouts, section 5 and section 6 use u′v′ ("a stretch of the 1960 one"). That is three maps, none shown except xy, and u and v are never defined.
- **What X and Z mean.** "X is 1.11 of Y, Z only 0.32." Figure 1 draws x̄ red and z̄ blue, so I assumed X = red and Z = blue. Then x̄ has a bump at 440 nm (blue), which nobody explains.
- **"Y is chapter 5's luminance"** and later "units where Y counts lumens". I can't tell luminance and lumens apart. Lumens (Φ) are never defined here.
- **The "read in code" stamp in section 4.** "within about 3e-4 of the true locus… seven tabulated points… 2856 K". I didn't know the line was computed by a formula, and "locus" and "3e-4" are unexplained.
- **Section 1, the 3024 K aside.** It uses colour temperature a section before it is introduced.
- **The caption's "past those the fit's colours run back on themselves"** is opaque to me, and "the straight line of purples" is never explained.

## 4. Words and symbols used before being explained
- **Never explained here:** ray, renderer, lumens/Φ, K (kelvin), u/v and u′/v′, photon, detector, optics trace, kernel, deposit, lux, luminaire, locus, standard deviation, noise, "linear RGB", the e-notation in 1e-9 and 3e-4.
- **Cards that helped:** gamut, chromaticity and Duv were good. The Duv card adds the green/pink direction, which the text should have said.
- **Cards that half-helped:** the luminance card leans on "radiance", which isn't explained. The colour-matching-functions card doesn't say what the experiment was. The measured card explains "Pascal" only partly.
- **Explained inline, fine:** PMMA and "neutral optics" are explained in a code caption. D65 and primaries are fine.

## 5. Figures
- **Figure 1 (curves and spectrum).**
  - The screenshots and readouts match the text: 530 nm gives X,Y,Z = 0.201, 1, 0.058, and 2700 K leans red.
  - The handle on the dashed curve is visible.
  - Confusing: the curve colours suggest red/green(grey)/blue. In the green shot the readout shows "exact Rec.709 RGB: −0.915…: a channel below 0" before the page has explained negative channels.
  - The 6500 K "white" swatch looks faintly pink.
- **Figure 2 (chromaticity diagram).**
  - This one is clear: the triangle, the hot-body line with its labels, and the bars.
  - Problems:
    - "Ringed dot is D65", but the dragged point is also ringed (red), and the D65 dot carries no label.
    - The 4000 K, Duv +0.02 swatch looks pale **yellow**, not "greenish".
    - The royal blue is called "far outside the triangle", yet on screen it sits just below the blue corner.
    - The bars rescale between screenshots, so 1.77 and 35.01 look similar in height.
    - The "460" label is half hidden.
- **Figure 3 (mixing three LEDs).**
  - The 1500 K shot makes the point well, with "one would have to be negative: the target is outside the triangle".
  - Problems:
    - The handles aren't coloured or labelled; the "green" LED's ring is grey.
    - The caption doesn't mention the dashed triangle or the small black dot.
    - The horseshoe is uncoloured, unlike figure 2.

## 6. Maths fold-outs
I could follow it. Σ is explained, the matrix is explained as "three weighted sums", and the inverse as "the table that undoes it". Gaps:
- M₁₂ uses row and column indices without saying which number is the row.
- X = xY/y isn't derived. I worked it out myself (X+Y+Z = Y/y), but a line would help.
- Only the middle row of M is given.
- Most important, the line-mixing proof belongs in here and is missing.

## 7. Code
- **`gamutClip`:** the caption made it fully followable, and I checked that t brings lo to 0.
- **`mixToTarget`:** clear in intent. `[0,1,2].map(r => cols.map(c => c[r]))` stays opaque, though "M has those three as its columns" explains what it is for.
- **`lightRGB`:** `??`, `...`, the arrow functions, `LIGHT_DEFAULTS` and the `[1, 1, 1]` fallback aren't explained. My JavaScript doesn't cover `??` or spread.
- **WGSL `badDeposit`:** `vec3<f32>`, `${LUMA.join(', ')}` and "kernel is built" are opaque, but the caption gives the gist.
- **The 4–14 comment:** readable as prose.

## 8. Too much, too little
- **Too much:** dates, file paths, "agreed 2026-09-27", the colour tool's history, and the "A coloured light that lit its scene white" bullet, which I couldn't follow at all. Section 5's numbers (9 × 10⁻¹¹ and so on) mean nothing to me.
- **Too little:**
  - the 1931 experiment, which would also set up "negative amounts" nicely;
  - the mixing-line algebra;
  - why the edge is single wavelengths, and why purples close it;
  - how the screen handles values above 1.

## 9. Wrong or contradictory
- **Ceiling vs. screen values:** "only a screen has a ceiling", yet the clipped screen values are 1.13 and 10.53.
- **Lumens vs. luminance:** "Y is luminance" vs. "Y counts lumens".
- **The royal blue's position:** "far outside the triangle" vs. the screenshot, where the point sits close to the blue corner.
- **The green point:** "greenish" vs. a yellow swatch.
- **"Ringed dot is D65":** two dots are ringed in figure 2.
- **Wavelength ranges:** "460 nm to 620 marked" (text) vs. "from 427 to 644" (caption). This may be consistent, but it reads as two different claims.

## 10. Five changes, most important first
1. **Explain what X, Y and Z are.** Say they aren't the cones and aren't red, green and blue. Describe the 1931 matching experiment in two sentences, including that a lamp sometimes had to be added to the *test* side, which is where a negative amount first appears. Recolour or relabel figure 1's curves.
2. **Make clipping and the ceiling consistent.** Say "clip" means removing the negatives, and say what happens to 10.5 (point to the chapter on exposure). Either fix "far outside" or explain why a colour near the purple edge needs huge numbers.
3. **Add a fold-out with the two-line proof** that a mix lies on the line, written as a weighted average of the two points.
4. **Untangle the maps.** One short paragraph on uv vs. u′v′, with their formulas or a small picture, or drop u′v′ from the readouts and sections 5–6. Also say how "nearest" is judged for CCT.
5. **Either translate or cut sections 5–6's renderer jargon:** photons, detector, optics trace, deposit, noise, standard deviation, lux, Pascal and the locus stamp. Give each a card or a chapter link. Also label figure 3's handles by colour and name the dashed triangle and the D65 dot in its caption.
