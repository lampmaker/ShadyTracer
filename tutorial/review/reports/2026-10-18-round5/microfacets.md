# Beginner review: "Rough and shiny" (Chapter 9, microfacets)

## 1. Teach-back
Most shiny things are not perfect mirrors. Up close their surface is made of tiny flat mirrors, called microfacets, tilted every which way. Each one reflects like a mirror, so the reflection spreads into a blob (the "lobe") around the mirror direction. The roughness setting says how tilted the facets are, and the wider the lobe gets. Some reflected light runs into a neighbouring facet and goes into the surface. With only one bounce that light is lost, so a rough metal looks darker than it should. ShadyTracer makes a table of how much light one bounce keeps (E) and multiplies the reflection by about 1/E to give the rest back. That table used to be slightly wrong because its grid of test points missed a thin "rim" where the lost light comes from. Squeezing the grid towards that rim fixed it. Separately, the old code that picked directions used the wrong formula for how likely each direction was. The formula was right only for light coming straight down, so a straight-down test never caught it.

## 2. Quiz
1. **Microfacet / roughness:** a microfacet is a tiny flat mirror on the surface. Roughness says how tilted the facets are, from 0 (a mirror) to 1 (very blurred), and it sets the lobe's width. The formulas use α = roughness². The page answers this well.
2. **Lost light / giving it back:** some reflected directions point into the surface, because they hit a neighbouring facet. One reflection drops them, and the path ends. ShadyTracer multiplies by 1 + F_0(1/E − 1) using a precomputed table of E. For a white metal that is 1/E. *The page never told me what F_0 is* (outside knowledge: the colour straight on).
3. **Old table:** it came from a plain 32 × 32 grid of "draws" that barely touched the thin rim where reflections go below the surface. So it overestimated E (0.97850 instead of 0.97505), compensated too little, and the metal read 0.997. The warp u.y = 1 − (1 − v)² crowds the points towards the rim, and the weight 2(1 − v) keeps the average fair. *Not taught:* what a "draw" is, what the "rim of the visible cap" is, and why the weight is 2(1 − v) (outside knowledge: a derivative).
4. **Old density:** the code that picks directions and the code that states their chance p disagreed. Its formula was right only for straight-down light. At 60° it was off by 0.154× to 1.623×, so weights were up to 6.5× wrong (fireflies), and a clamp at 10 hid them. Straight down the ratio is exactly 1 everywhere, so there was nothing to see. *Not taught:* why a direction is weighed by 1/p. That is "Chapter 12's rule", and chapter 12 comes after this one.

## 3. Where I got lost (worst first)
- **"Chapter 12's rule: a direction drawn with chance p is weighed by 1/p … every estimate is biased."** Section 3, and the fold-out's last paragraph, both rest on this. It points *forward*. "Estimate", "biased", "weight", "density", "firefly" and "clamp" are all undefined.
- **"draw" means two things.** The renderer "draws a direction" (picks at random), the figure "draws" lines, and there is a "New directions" button. Nothing says the renderer picks directions *at random*, or that u holds two random numbers between 0 and 1.
- **"from a thin rim of the draws the plain grid barely touched."** Which rim? I only learn of "the visible cap" in a later code caption, and still never see a picture of it.
- **"multiplied by 1 + F_0(1/E − 1)"**: F_0 is never defined, and "Fresnel" only points to chapter 8.
- **Section 5:** "four metal rows", "Ampere card, 946 × 1061", "Pascal card", "aiming at the sun and without", "cosine draw", "18,557 against 18,635" (units?) and "roadmap/SURFACES.md" read like a lab notebook.

## 4. Words and symbols
- **Cards that helped:**
  - microfacets, roughness and white furnace: good.
  - GGX: good ("long tail of steep ones").
  - BSDF: OK.
  - masking and shadowing: clear, but the main text never uses that phrase, so I only met it in the list at the end.
- **Used without explanation:**
  - lobe (the figure saves it)
  - "perceptual"
  - ω_i, ω_o, θ_h (I guessed in, out and half)
  - solid angle
  - Λ: has a formula but no meaning
  - G_1: never defined in the fold-out, although the code caption says it is there
  - F_0
  - albedo: the furnace card uses it but does not define it
  - visible normals
  - pdf
  - Schlick
  - kernel
  - path
  - isotropic
  - "plane of incidence" (only on the fig 3 axis)

## 5. Figures
- **Fig 1:** the light arrow, the mirror direction and a red lobe, with the lobe narrow at 0.15 and wide at 0.6. That point is clear.
  - The caption says the lobe is "bold", but it is red.
  - Nothing says what the lobe's *shape* means (I assumed: distance = how much light).
  - The blocked directions are faint red dashes inside the hatched block, easy to miss.
  - The line lengths vary, and "flattened onto the page" did not tell me why.
- **Fig 2:** the top chart compares red dots (plain) and blue rings (warped) with the true line. The bottom chart has a red and a blue line *with no legend*; I guessed red = plain.
  - At roughness 0.3 the error is clear: the red line sits at about 0.991–0.997.
  - The roughness-1 screenshot makes no point that I could see. Both lines just wobble around 1.
- **Fig 3:** clear. A flat line at 1 straight down, then a curve running from 0.154 to 1.623, then from 0.023 up.
  - The slider says **"the view"**, but the text, caption and readout say **"light"**.
  - The x-axis "mirror direction is 60" left me unsure which side the light is on.

## 6. The maths fold-out
- I could do the algebra: f·cos θ_i ÷ (G_1 D / 4cos θ_o) = F G_2 / G_1. That was nice.
- I could not see *why* any piece has its form. "per unit of solid angle" and "turns a density of facet normals into one of reflected directions, and the facets' area into the surface's" stayed opaque.
- The D, G_2, F and 4cosθcosθ definitions run together as one paragraph.

## 7. The code
- **Excerpt 1:**
  - `mfLambda` and `mfG2` match the fold-out once I worked out that (x² + y²)/z² = tan²θ (outside knowledge; the page should say it).
  - `mfD` looks nothing like the fold-out's D, and no one says they are the same.
  - `mfAnisoAlpha`, `mfAnisoU` and `mfAnisoOfU` (0.9, log10, "geometric mean") are opaque and off-topic.
- **Excerpt 2:** "stretch", "cap" and the line `z = (1.0 - u.y)*(1.0 + os.z) - os.z` stayed opaque. The comment "D Gv NoH / (4 VoH)" uses undefined names.
- **Excerpt 3:** readable thanks to its caption. `lb.cm`, `fresnelSchlick3` and `s.w` I took on trust.
- **Excerpt 4:** this is the best one. I checked by hand that v = 0.5 gives u.y = 0.75, so the points do crowd towards 1. But "makes up for the crowding" with 2(1 − v) is unexplained, and `${MF_SQRT_SAMPLES}`/"kernel" mean nothing to me.

## 8. Too much, too little
- **Too much:**
  - Sections 5 and 6: test logs, GPU names, file paths, "three answers to 'is it a mirror?'".
  - Three near-equal numbers in one sentence: 0.97506, 0.9751 and 0.97505.
  - The anisotropy functions.
- **Too little:**
  - What sampling is, and why weights are 1/p.
  - Why the lost light comes from a rim.
  - What E's table is averaging over.

## 9. Wrong or contradictory
- **Fig 1 grazing:** the text says "more of what is drawn hits neighbouring facets", yet the loss *falls* from 19.88% (40°) to 17.76% (78°).
- **The intro** promises two errors "no straight-down test could see". But fig 2 shows the old table wrong straight on: the red dot is at 1.00 against a line at 0.99, and the bottom chart reads 0.991 at 0°. Only section 3's error matches the claim.
- **The read-in-code stamp:** "weighs at most F G2/G1 ≤ 1" is called "checked", then "a single weight can exceed 1". Was the claim right or not?
- **At roughness 1** the warped table is *worse* (1.0013) than the plain one (1.0002), and nothing is said about it.
- **Section 2** says E is "close to 1 straight on and at grazing". At roughness 1 it is 0.31 straight on and rises towards grazing. At 0.3 the low point is near 85°, not "between".
- **The code caption** says the fold-out defines G₁; it does not.
- **Light vs view in fig 3:** see section 5.

## 10. The five changes
1. **Teach sampling on this page.** Say the renderer picks directions at random, that E is an average over many such picks, and why a pick is weighed by 1/p. Do not lean on chapter 12. Stop using "draw" for both picking and painting.
2. **Fix the contradictions:**
   - the grazing sentence;
   - the intro's "no straight-down test" claim against fig 2;
   - "view" vs "light" in fig 3;
   - the ≤1 stamp;
   - say why the warp is slightly worse at roughness 1.
3. **Show the rim:**
   - a sketch or figure of which picks reflect below the surface, and why a regular grid misses them;
   - a worked number for 1 − (1 − v)²;
   - a no-calculus reason for the weight 2(1 − v) (strip widths).
4. **Close the fold-out's gaps:**
   - define F/F_0, G_1 and what Λ means;
   - say that tan²θ = (x² + y²)/z², so the code's `mfD` and `mfLambda` visibly match it;
   - cut or explain "solid angle".
5. **Trim for the reader:**
   - cut or explain the GPU names, "rows", resolution, file paths and "aiming at the sun" in sections 5 and 6;
   - drop the anisotropy functions from excerpt 1;
   - give one value for "converged";
   - add a legend to fig 2's bottom chart and explain the lobe's shape and the line lengths in fig 1.
