# Blank-reader review: Chapter 9 "Rough and shiny" (microfacets)

## 1. Teach-back
A shiny surface that isn't a perfect mirror is made of tiny flat mirrors called microfacets, tilted at random. Light bounces off each one like a mirror, so the reflection spreads into a blob (a "lobe") around the mirror direction. The more rough the surface, the more the facets tilt and the wider the lobe. Some light that bounces off one facet hits a neighbouring facet. If the renderer only counts one bounce, that light is lost, so a rough metal comes out a bit too dark. ShadyTracer works out ahead of time how much light one bounce keeps (E), stores it in a table, and multiplies the reflection by about 1/E to give the light back. The table used to be computed on an even 32 × 32 grid of random numbers. That grid missed a thin strip where the losses happen, so the table said too much light was kept. Squeezing the grid's points into that strip, and counting each squeezed point for less, fixed it. Separately, an older sampler stated the wrong chance for each direction it picked. That was only correct when looking straight down, which is why a straight-down test never caught it.

## 2. Quiz
1. **Microfacet / roughness:** a tiny flat mirror on the surface. Roughness sets how far the facets tilt, and so how wide the lobe is. The formulas use α = roughness².
2. **Lost light, given back:** some reflected directions point into the surface, meaning they would hit a neighbouring facet, and one reflection counts them as 0. ShadyTracer computes E for every roughness and angle on the graphics card, then multiplies a metal's reflection by 1 + F₀(1/E − 1), which is 1/E for a white metal, so a white metal in a white furnace reads 1. *Unsure:* the fold-out says the directions that do come out also keep only F·G₂/G₁ < 1, so I can't tell whether the loss is only the dashed ones.
3. **Old table / warp:** the losses come from the second random number near 1 (the rim, the facets seen most edge-on). That is a thin strip, and a plain grid puts few points there. So E came out too high (0.97850 vs 0.97505), the metal was under-compensated and read 0.997. The warp u.y = 1 − (1 − v)² puts ten times as many points there and weights each one by 2(1 − v). *Not taught:* why 2(1 − v) is the right weight, and why "the average is unchanged".
4. **Old density:** its formula matched the true one only straight on. At 60° the ratio was 0.154–1.623, and at 80° as low as 0.023, so weights were up to 6.5× or 43× off. That gave bias, plus fireflies that a clamp at 10 hid. A straight-down test sits exactly where the ratio is 1. *Gap:* the text says "right when the **light** comes straight down" but the test **looks** straight down. I had to assume the eye and the light swap roles (*outside knowledge*).

## 3. Where I got lost (worst first)
- **Light vs view.** Fig 1 and Fig 3 say "light 40° from the normal". Section 2 and the code say "the view", `o`, "the eye sees". Section 3 says "right when the light comes straight down" and then "a test that looks straight down … can never see this". Nothing tells me these are the same thing.
- **"the two random numbers a pick is made from" … "the second number, near 1, picks the facets the eye sees most edge-on … at the rim of what it sees"** (section 2). The two numbers, the "cap" and the "rim" are only explained in section 4's code caption. Section 2 can't be followed in reading order.
- **"The top tenth of the rim, from 0.99 to 1, now gets the grid's points from 0.9 to 1."** 0.99–1 is a hundredth of the range, not a tenth. I re-read this three times.
- **"Each of them then counts for less, 2(1 − v) times … so the average is unchanged."** It is stated but not shown. It could be shown with numbers: v from 0.94 to 0.96 moves u only from 0.9964 to 0.9984, a step 10× smaller.
- **What E counts.** Section 1: the loss is the directions that "run into a neighbouring one" (dashed). Fold-out: every direction's weight is F·G₂/G₁, which is below 1 even above the surface. Is the "19.88%" the dashed share, or 1 − E?
- **Why roughness 1 loses most straight on (0.307), while roughness 0.3 loses most near 85°,** and roughness 0.6 loses less at 78° than at 40°. The numbers are given but there is no intuition.

## 4. Words and symbols
- **lobe:** no card. The figure makes it clear enough.
- **normalised, ω, θ_h:** not explained. ω is never named.
- **"plane of the light"** (Fig 1 caption) and **"plane of incidence"** (Fig 3 chart title): not explained.
- **albedo** (furnace card, code comment): not explained.
- **cap of a sphere:** not explained.
- **transmitted, height-correlated, integrate, converged, dielectric, ior, Schlick, isotropic, interpolation axis:** none explained.
- **shading, shadow ray, cosine pick, cd/m²:** used in section 5 without explanation.
- **"long tail"** (GGX card): jargon.
- **Cards that helped:** BSDF, solid angle, pdf, bias and firefly were good. The microfacets and roughness cards were fine. The masking card helped, but "Smith" is never introduced. The furnace card helped, apart from "albedo 1".

## 5. Figures
- **Fig 1** (lobe and picked directions): the smooth → rough → grazing screenshots make the point well, and the red dashed lines inside the metal are visible, though faint. Confusing:
  - In the rough shot, many blue lines lie well outside the red lobe, including some pointing back towards the light. The page should say that the lobe is only the slice in the page, and that a short line points mostly out of the page.
  - The thin spike at 0.15 is no longer than the wide lobe at 0.6. If length means "how much light", the spike should be much longer. Is each lobe scaled to fit?
  - The text never says the picked lines are blue.
- **Fig 2:** the r03 screenshot works: red dots above the line, blue rings on it, red line below 1 in the bottom chart. The same screenshot is reused for four paragraphs, so the "warp" step shows nothing new. The rough screenshot makes "squeezing buys nothing" clear.
- **Fig 3:** clear, and the readout's "0.023 to 1.329" matches the text. The straight-on screenshot hides the dashed 1-line under the curve. "−0°" on the axis is odd. The page never says what the roughness slider changes in this figure.

## 6. Maths fold-out
- I could follow D, Λ, G₁ and G₂ as formulas to plug numbers into.
- I could not follow "4 cos θ_o cos θ_i turns a density of facet normals into one of reflected directions, and the facets' area into the surface's". Section 4 then uses a different 4·(o·h), and I couldn't connect the two.
- "works out to G₁ D/(4 cos θ_o)" has to be taken on trust. That is fine, but say so.
- The step f cos θ_i ÷ pdf = F G₂/G₁ is plain algebra I *could* do. Show it.
- G₂ ≤ G₁ (because Λ ≥ 0) would justify "never more than F". Say it.

## 7. Code
- **mfLambda / mfG1:** the caption lets me match `t2` to α² tan²θ and the return line to Λ. Good. `max(w.z*w.z, 1e-12)` is unexplained, and so is the `1e-12` notation.
- **mfD:** the caption's derivation of t is checkable. Nice. `MF_PI` I guessed to be π.
- **mfSampleVNDF:** the "stretch, cap, unstretch" idea comes across. `z = (1 − u.y)(1 + os.z) − os.z` and `hs = c + os` stay opaque, especially *why* adding the view to a point on the sphere gives a facet normal.
- **materials_pbr.js:** I could map `s.w = cm · F · G₂/G₁` to the fold-out. `lb`, `rnd.yz` and `fresnelSchlick3` are opaque. "materials_pbr.js:207" is noise to me.
- **Grid excerpt:** the caption helps. The comment's last sentence ("refining any interpolation axis…") is opaque.

## 8. Too much, too little
- **Too much:** section 5's measured numbers (Ampere, Pascal, cd/m², four metals) and section 6's history list. Section 6's mirror threshold, the 4% glass and the anisotropic tables all belong to other chapters and mean nothing to me here.
- **Too little:** the two random numbers and the visible cap (needed in section 2), the weight 2(1 − v), and why Turquin's formula works for coloured metals.

## 9. Wrong or contradictory
- "Top tenth … 0.99 to 1" is a hundredth of the range.
- The text gives 0.97505 and the readout 0.97506 (trivial).
- Fig 2's bottom red line sits near 0.991 straight on. That is about 0.9% low, more than the comment's "overstated by 0.3–0.7%", and lower than the "read 0.997" in the text. Perhaps a sphere averages over angles, but the page doesn't say so.
- The loss is pictured as the dashed directions only, yet the fold-out's weight F·G₂/G₁ loses light on the others too (see §3).

## 10. The five changes
1. Say once that the renderer starts from the eye, so the "light" in Figs 1 and 3 is the view `o`. Then use one word throughout, so that "a test looking straight down" visibly matches "right straight down".
2. Introduce the pick's two random numbers, the visible cap and its rim in section 1 or 2, with a small drawing, before section 2 relies on them. Better still, colour Fig 1's lines by u.y so the dashed ones are seen to come from near 1.
3. Fix "top tenth". Show the 2(1 − v) weight with a numeric example, and give one sentence on why the average stays the same.
4. Make the meaning of E consistent: either the dashed share, or the average of F·G₂/G₁. Tie Fig 1's readout to the fold-out's weight.
5. In the fold-out, show the one-line algebra to F G₂/G₁ and why G₂ ≤ G₁. Either explain the "4 cos" and "4 o·h" conversions or plainly mark them as given. In Fig 1, explain the lines outside the lobe (out of the page) and whether lobes are scaled to fit.
