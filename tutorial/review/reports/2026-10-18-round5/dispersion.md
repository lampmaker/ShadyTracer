# Beginner read of "Rainbows" (Chapter 11, dispersion)

## 1. Teach-back
Glass bends light by different amounts depending on its colour, and blue bends more than red. That's why a prism spreads white light into a rainbow. A glass is described by two numbers. n_d is how much it bends yellow light, and the Abbe number says how little it spreads colours: a high number means a small fan. The program works out the bending for every wavelength from those two numbers using Cauchy's formula, n = A + B/λ². Its rays carry three numbers (red, green, blue), not real wavelengths. So when a ray goes into spreading glass, the program picks one wavelength at random, from 40 slots of 10 nm. Slots that the channels "respond" to more get picked more often. Each channel is then multiplied by its response divided by the chance of that slot. That makes each channel average 1 over many rays, so white still comes out white on average. Reflections are decided before the wavelength is picked, so they stay white. A coloured coating needs no wavelength: each channel already covers a range of wavelengths, so the program averages the coating over that range. Tilting the light moves the coating's edge towards blue.

## 2. Quiz
1. **Prism, n_d, Abbe:** the index is larger at shorter wavelengths, so blue bends more and the colours fan out. n_d is the index at the yellow d line (588 nm). The Abbe number, (n_d − 1)/(n_F − n_C), says how little the glass disperses: 64 for BK7, 28 for flint. *Taught.*
2. **When a ray gets a wavelength:** when it refracts into a glass whose Abbe number is above 0 and it doesn't already have one. It keeps that wavelength afterwards. Each channel is multiplied by W_c/P. *Taught.* I only half-understood that "a wavelength drawn but used only if it refracts" means the reflect-or-refract choice is random. That was **outside knowledge**.
3. **Why the average is 1:** the chance P cancels: Σ P × W/P = Σ W = 1. Why (1, 1, 1) means "white" is never said. *Outside knowledge.* Why "chance × value, summed" is how you average is also never taught: the page points to "chapter 12's rule **again**", and chapter 12 comes after this one.
4. **Why the reflection stays white:** the reflect-or-refract pick uses the d-line index, so a reflected ray gets no wavelength. *Partly taught.* What "Fresnel" means and what "colour noise" is were *not taught*.
5. **Coating without a wavelength:** the coating's reflectance is averaged over each channel's own wavelengths, and that fraction of the channel is reflected. *Taught.* Why this is "an approximation at an edge" was *not explained*.

## 3. Where I got lost (worst first)
- **"yellow-green often, deep violet and deep red rarely"**: the tallest bars in fig-3 are at about 440–450 nm, drawn violet. The page never explains why the blue end is picked most.
- **"That division is chapter 12's rule again"**: this is a rule I haven't met yet, so it can't be "again". The core idea (pick with chance P, divide by P) is never put into plain words.
- **"A reflection off the prism is decided before any wavelength is drawn"**: decided how? I thought light partly reflects and partly passes through. The random pick and "Fresnel" are only in a code comment.
- **The "INFERRED" note**: "ȳ outlasts its x̄", "the CIE's own deep reds". I couldn't follow any of this.
- **"red 0.584"**: if the coating reflects everything above 600 nm, why doesn't red reflect almost all of it?
- **The "Numbers in the comments, checked" stamp**: "softplus differences", "bits 17-31", "red's response is negative". This is for the program's maintainers, not for me.

## 4. Words and symbols
Not explained on the page:
- ray, renderer, channel, "draw", bin, weight, "respond", noise
- colour-matching curves, x̄ and ȳ, CIE
- Fresnel, Snell, normal, first-order rule, n_eff, reflectance
- kernel, WGSL, tag, flags, 32-bit, PRNG, photon, facet, Dawn, caustics (in "Try it"!)
- λ (I guessed it means wavelength)

Explained well inline: dichroic, and the Fraunhofer lines (briefly).

The cards helped. Index of refraction, Abbe ("lower disperses more" settled the meaning of "the higher, the less"), spectrum (gave me nm and the 380–780 range) and total internal reflection were all good. There are no cards for the hardest words.

## 5. Figures
- **Fig 1 (prism):** the flint, BK7 and none screenshots clearly show a wide fan, a narrow fan and a single line, and the readout's 3.24° and 0.71° match the text. Confusing:
  - The "white light" arrow is dark navy.
  - Inside the prism, and in the no-dispersion case, the beam is drawn **orange**, while the text says "the white beam stays white". Section 7 criticises exactly this kind of misleading colour.
  - The ⊕ handle is clear enough.
- **Fig 2 (index curves):** there's no legend for which curve is which (I guessed red is mine, blue is BK7), and the y-axis has no label. The rings sit right on the curve, so the agreement is clear. The slope downward (blue higher) is visible but slight.
- **Fig 3 (bins):** the two screenshots make the "average near 1" point well. But:
  - The **G bar is grey**, here and in fig 4.
  - "exactly, over the draw: 1.000000" next to 0.993: I couldn't tell what "exactly" was measuring.
  - The bars have no scale.
  - The bar shape contradicts the text (see section 3 above).
- **Fig 4 (coating):** the two screenshots show the edge moving and the bars changing, which is clear. Missing: each channel's range drawn over the strip, which would explain 0.584. "Light 0° from the normal" uses "normal", which isn't defined.

## 6. Maths fold-out
I could follow the algebra, and I could check "at most 3": W/(W/3) = 3. Missing:
- the sigma notation itself;
- why an average is Σ P × value;
- why the responses are made to add up to 1;
- why small weights are good.

The tilt formula I could check with my calculator: it gives 551.8 nm. Good. Cauchy's A and B are only derived in a code caption. I could follow that once told A cancels, but it belongs in a fold-out.

## 7. The code
- **cauchyN:** I could follow it with the caption. Opaque:
  - `!(vd > 0)` instead of `vd <= 0`;
  - `**`;
  - the units of LAMBDA_F.

  The caption mentions "The WGSL copy below it", but no WGSL copy is shown.
- **specDraw:** "walks the bins until their chances add up past u" is the key idea. A small picture of chances laid end to end would make it click. Opaque:
  - `.map(w => …)`;
  - `|| k === SPEC_BINS - 1`;
  - the `Math.min(Math.max…)` ternary;
  - the excerpt ends mid-function.
- **WGSL:**
  - `select(_n1, cauchyN(...), lam0 > 0.0)` reads backwards to a JS reader;
  - `PRNG().x` and `res.r.n` aren't explained;
  - "a photon started inside one" uses a word I don't know;
  - the excerpt stops before the line where the weights multiply the ray's colour, which is the part I most wanted to see.
- "materials_pbr.js:1003" means nothing to me.

## 8. Too much, too little
- **Too much:**
  - the comment-checking stamp;
  - section 7's version numbers and driver crash;
  - test file names;
  - Dawn;
  - "the user chose (2026-10-08)": which user? It sounds like me.
- **Too little:**
  - the averaging idea (a dice example would do it);
  - the random reflect-or-refract choice;
  - why the 600 nm edge gives red 0.584;
  - why (1, 1, 1) is white.
- **Rushed:** section 3 packs bins, chance, response and weight into two paragraphs.
- **Small things:**
  - "three numbers a ray" read oddly; I'd say "per ray".
  - The tag's "400/32,766" puzzled me, because 15 bits give 32,768 values.

## 9. Wrong or contradictory
- Abbe number 0 means "no dispersion", but by the formula a smaller Abbe number means *more* dispersion. That 0 is a special switch is never explained.
- "exactly the catalogue's F − C", yet n_F and n_C are each 5e-5 off. One sentence saying that only the gap matches, not each value, would resolve it.
- "F" means the 486 nm line in section 2, then "1 − F" (Fresnel) in section 6.
- The tallest bars (violet-blue) disagree with "deep violet rarely".
- A "white" beam is drawn orange.
- "chapter 12's rule again" refers to a chapter that comes later.
- A forward pointer to "chapter 21" for WGSL.
- Section 6 angles are negative (−23.9°) while fig 1's are positive "below the horizontal".
- A stamp labelled "read in code" gives numbers "computed from the formula".

## 10. The five changes
1. Explain the averaging in plain words (choose with chance P, divide by P, a dice example), and fix the forward reference to chapter 12. Say that (1, 1, 1) is white.
2. Explain the reflect-or-refract random choice and give Fresnel and colour noise their own cards, before the "stays white" claim.
3. Explain why the 440–450 nm bins are drawn most (blue's response is narrow, and each channel adds up to 1), or reword "deep violet rarely".
4. Fix the figures:
   - draw the undispersed beam white, or say the lines overlap;
   - add a legend to fig 2;
   - colour G green;
   - draw the channels' ranges in fig 4 so that red 0.584 makes sense.
5. Move the maintainer material (comment checks, version history, test names) into a fold-out. Explain `select`'s argument order and `PRNG`, and show the line where the weights multiply the colour.
