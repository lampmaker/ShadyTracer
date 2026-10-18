# Blank-reader review: "Diffuse and mirror" (Chapter 8)

## 1. Teach-back
A material is a surface's rule for what it does with light. The rule is called the BSDF, f. A matte surface such as paper has a constant f, so it looks equally bright wherever I stand. Its albedo ρ is the share of light it sends back, and 0.7 is a light grey. It looks equally bright from everywhere, but less light leaves it sideways in total, because from a slant the patch looks narrower; the dashed circle shows this. In 3D, f = ρ/π (I took the π on trust). The renderer picks random bounce directions, with more of them near the normal. Picked that way, a matte bounce just multiplies the path by ρ. A mirror sends everything one way, so you can't aim a shadow ray at the lamp through it: the path keeps going along the reflection and either hits the lamp or doesn't. A white furnace surrounds things with a sky of brightness 1. Albedo-1 things should disappear, and anything that shows means light was lost. A black control is needed because a broken test that drew nothing would also read 1. Anything smoother than roughness 0.0316 counts as a perfect mirror.

## 2. Quiz
1. You can't tell where you stand from how bright it looks. Its intensity still falls with the cosine "because from a slant the same bright patch looks narrower". I can repeat that sentence, but the page never says how "intensity" differs from "brightness". I only get it from *outside knowledge* (the difference between radiance and intensity).
2. Lit by a sky of 1, the point gets π and sends back fπ, and "that must be ρ of 1", so f = ρ/π. The cosine draw has p = cos θ/π, so f cos θ / p = ρ. I can redo the algebra. I can't explain why it "must be ρ of 1" when the point received π (see §6).
3. A mirror sends light in exactly one direction, and a shadow ray to a random point of the lamp "would almost never lie along it". The path just continues along the reflection and finds the lamp by hitting it. "Chapter 15's weights give such a hit a weight of 1": the page doesn't explain this part.
4. It is a sky of brightness 1 everywhere and nothing else. Albedo-1 surfaces should read exactly 1 and vanish. You need a black control because "a test that only ever passes might not be looking". Section 6 gives the real example: no sphere was drawn and the test still read the sky. I only understood the control from section 6, not section 3.

## 3. Where I got lost (worst first)
- **"Its intensity going out, though, is largest straight up…"** The page uses brightness, intensity and (in the fold-out) "luminance" as if I knew how they differ. Question 1 depends on that difference, and none of the three has a card.
- **"(the flat world's cos 35° / 2.6, chapter 0)"**: I don't know what the flat world is or what 2.6 is (a distance?). I don't know why it is divided rather than squared.
- **"A direction drawn that way carries f cos θ divided by its own chance… multiplies a path's throughput"**: "carries", "its own chance" and "throughput" are all undefined. The page also never says that paths start at the eye and run backwards. I only guessed it from figure 2.
- **"after a page that mixed old cached code with new read exactly the sky on every row, rough glass included"**: I can't parse this sentence ("a page", "every row", "rough glass").
- **"narrower than anything the march can resolve"**: "march" is never explained.
- **"Chapter 15's weights give such a hit a weight of 1, since aiming could not have produced it."** It reads as a rule handed to me, not explained.

## 4. Words and symbols used before they were explained
- **Cards that helped:** BSDF (plain and good), albedo, shadow ray, delta, white furnace.
- **normal:** helped, although its second half (the distance formula) is a detour.
- **No card at all:** intensity, luminance, throughput, path, sample ("96 samples a pixel"), "aiming", flat world, ∫ and dω (I have no calculus), "chance per unit of direction" (probability density, which is *outside knowledge*), Schlick's formula, roughness, coat/specular, plastic, march, cd/m², "Pascal card", ±0.0713.

## 5. Figures
- **Fig 1:** It shows one point under a lamp, with bounce directions and the intensity circle. It is clear that the circle shrinks but keeps its shape between 35° and 75°. Problems:
  - The caption says the circle is "cos θ times its albedo", but it also shrinks with the lamp, so it is really times E as well.
  - The blue lines are identical in both screenshots. That is the point (the bounce doesn't care where the light came from), but nothing says so, and I first expected them to tilt away from the lamp like a reflection.
  - The "point above the floor to read" readout isn't in any screenshot.
- **Fig 2:** I see a room, an eye, a lamp and a mirror wall, and a bright spot appears in the strip.
  - The dashed grey lines and the red dotted line by the box are never explained (shadow rays?).
  - The strip has no pixel numbers, so I can't find "pixel 26" or "pixel 39".
  - "Left to right as the eye sees" doesn't help, because the eye looks to the right, so which end of the strip is the ceiling?
- **Fig 3:** The four screenshots make the furnace's point well: blank white, then grey, then a faint mark, then black.
  - I can't tell which part of the strip is "the gap". The darker band sits near the left end of the discs, which surprised me.
  - "The shaded ground of the drawing" made me look for a floor; I think it means background.
  - The drawn paths are the same at albedo 0, 0.7, 1 and at bounce limit 1.

## 6. The maths fold-out
- I followed f cos θ / p = ρ: it's just cancelling.
- I followed the reflection vector (−x, −y, z) with a sketch.
- I could not follow:
  - The ∫ and dω line. I read it as "add up over all directions" only because the sentence before it says so.
  - "That must be ρ of 1". The point received π, so why isn't the answer ρ of π? Figure 1's readout ("sends back ρE in all… ρE/2") suggests the missing step: it sends back ρπ in all, spread so it looks the same every way, which gives ρπ/π = ρ. The fold-out should say that.
  - "One drawn direction stands for the whole integral (chapter 12)": I take it on faith.

## 7. The code
- makeDiffuse and makeMirror are clear: they set numbers.
- The metal branch is followable thanks to the note.
- The diffuse branch:
  - `rnd.y` and `rnd.z` are never called random numbers from 0 to 1.
  - The note says u but the code says rnd.y.
  - Why √ makes "crowded in proportion to the cosine" is asserted, not shown.
  - The s.w line (ecO, ecI, ecAvg, ps, coatAlbedo) stays opaque; I accept the note that it reduces to ρ.
- Fresnel: the note "(1 − cos)⁵ is 0 straight on and 1 at grazing" made the line readable. This was the best note on the page.
- The ALPHA_MIN comment's words (GGX lobe, MIS pdf, light-tracing split, epsilon) are opaque, but the note's √0.001 = 0.0316 is enough.
- The "comment, checked" stamp was clear and fun.

## 8. Too much, too little
- **Too little:** the step from "looks the same everywhere" to f = ρ/π. Also the bounce weight, which is the core idea but is pushed to chapters 12, 13 and 15.
- **Too much for me:** sections 5 and 6 are full of the repo's history ("the material review", "a density of 10⁹", "a glossy plastic under the sun was lit by chance alone"). Section 6's third bullet is the good one.
- Section 2's paragraph on metals and roughness feels rushed: two new ideas in two sentences.

## 9. Wrong or contradictory
- Fig 1's caption formula (ρ cos θ) is missing E, yet the text says the circle shrinks.
- The text says the blue lines are drawn "exactly as the light leaves". The fold-out says the renderer draws ω_i, the arriving direction. Which is it?
- makeMirror sets `specular = 1.0`, and the note says specular is the "reflective coat". Does a mirror have a coat?
- The furnace sky is 1 in section 3 but 1000 cd/m² in sections 5 and 6, and nothing reconciles the two.
- "The lamp's 1": the lamp's brightness was never given.
- Try-it asks "why do some get darker?" The page never answers it.

## 10. The five changes
1. Define brightness versus intensity in section 1 (cards for both, and luminance). Say what 2.6 and the flat world are in one clause.
2. In the fold-out, add the missing step (receives π, sends ρπ in all, looks ρ). Say in words what ∫ and "chance per unit of direction" mean.
3. Say early that paths run from the eye, and that a path carries a multiplier (throughput) which each bounce scales. Then "multiplies by ρ" and "weight 1" land.
4. In fig 2, label the dashed and red lines, number or mark pixel 26 on the strip, and say which end of the strip is up.
5. In section 3, rewrite the control sentence in plain words (a broken page drew no sphere and still "passed"). In fig 3, mark the gap on the strip, change "ground" to "background", and explain ±.
