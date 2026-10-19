# Blank reader: Chapter 18, Caustics

## 1. Teach-back
A caustic is the bright patch that glass or a mirror focuses onto a surface. The renderer works backwards from the eye, and at each floor point it fires a shadow ray straight at the sun. Under a glass ball that ray hits the glass and counts as blocked. Only one exact bent line reaches the sun, and a ray aimed straight at it never lies on that line. So the camera finds the caustic only when a random bounce happens to be turned onto the sun. That is rare, so each find counts hugely, and the result is specks and a jumpy average. The fix is to also send photons forwards from the sun through the glass, then join where they land to the eye with a straight line. Each kind of path is counted by exactly one side: photons get "eye sees a matte point, then only glass, then sun", and the camera gets the rest. Caustics seen through another pane stay with the camera, which is noisy there. Finally, the renderer learns where to start photons, keeping 20% spread evenly.

## 2. Quiz
1. The glass bends the line. The only working line is the one Snell's law makes, and a shadow ray aimed straight at the sun lies on it "with chance 0" (a delta).
2. Light tracing follows light forwards: a photon goes through glass by Snell and Fresnel, lands, and a straight connection to the eye adds it to a pixel. ShadyTracer gives it only light from the sun that has passed glass or a mirror and lands where the eye sees directly. Section 6 also mentions "glowing objects' photons", but the page never says when lamps get photons.
3. The caustic is counted twice. The bracket reads 0.738 instead of 0.313, and the camera's specks are on top.
4. A caustic seen through glass. The photon's connection to the eye would hit the pane, so only the camera can count it.
5. Photons start evenly over a square across the rays. Each cell counts photons sent and connections made, and the next sample sends photons in proportion to connections ÷ sent, each divided by its chance. The ratio is used because a favoured cell sends more photons and so gets more connections "for that reason only": the map would feed on itself.
6. It keeps an undiscovered caustic findable and every cell's chance above 0. I understood why a zero chance makes the picture *wrong*, not just slow, only from *outside knowledge*.

## 3. Where I got lost (worst first)
- **Section 4.** The excerpts are packed with "EVAL", "DELTA+", "x1", "CLS_CAND|CLS_SPEC", "flux * beta * f * G / A_px", "Jacobian", "MIS (Ray.ltMis)" and "GGX alpha". I got the captions' gist and nothing more.
- **"A find carries the sun's own brightness, 85 … because a path's weight is what it found divided by the chance of finding it."** Why is the find exactly the sun's brightness, not divided? I noticed 85 ÷ 220 ≈ 0.39, the open floor's value. Is that the point? The page never does the sum.
- **"ltCovers … the square's size changes the noise and never the total."** I can't picture this.
- **Project jargon.** "(materials_pbr.js:405)" sits mid-sentence. Section 5 has "the lt test", "eight rows", "the entry", "a tenth of a photon a pixel" and "the Noise library scene". Section 6's bullets ("rays' buffer", "2.3 million pixels") assume the codebase.
- **"its illuminance held the same"** is unexplained. "1 in 66,111 with the sun 45° up" comes right after a 75° sun, with no reason for the change.

## 4. Words and symbols
- **Cards that helped:** caustic, shadow ray, NEE, path and photon. The delta card is the best: it made "chance 0" click.
- **Explained well in passing:** sample, error bar, flat world, Snell and Fresnel.
- **Never explained:** illuminance, radiance, "evaluable lobes", matte/glossy/rough, ρ, Φ, flux, solid angle, Jacobian, firefly, alpha, MIS, WGSL, tag bits, luminance and Ampere/Pascal.
- **"floor" is overloaded.** "The floor of 20%" in section 3 sits in a scene with a real floor. At first I read it as photons landing on the floor.

## 5. Figures
- **Fig 1 works.** Shadow shows red blocked rays and a speckled bracket. Wide gives a smoother bump. Light gives a clean spot. Both gives the full picture, and Twice is visibly brighter. Confusing: "brightened 12 times" (why?), strip labels that run together ("the ball the floor seen through it, its shadowed part dark"), and the ± being the real point of the comparisons.
- **Fig 2 is clear.** The corner headings ("Counted by light tracing", "The camera's, found only by chance") make the point at a glance. The prose writes the pane as one "glass", the readout as two; the caption explains, but only on a second read.
- **Fig 3: the uniform → learned bars are striking.** But in "learned" the dashed 20% line lies on the orange baseline, so I can't see that the empty cells still have a chance. The "learning" shot shows tall bars and "176 connected"; it took the parenthesis to see that the bars are for the *next* sample.

## 6. Maths fold-out
I followed Φ (the photon's light), f (what the floor sends on) and cos θ_x / d (how big the patch looks). I was lost at:
- **"f = ρ/2"**: ρ is never defined, and I don't know why it is halved.
- **"1/cos²θ_c"**: why squared?
- **"radiance" and "solid angle"**.

The code caption's algebra (z = dist cos θc, so dist/z³ = 1/(dist² cos³θc)) I could follow, and it was satisfying.

## 7. The code
- **The photon walk (858–859)** is clear with its caption: after glass, mark the photon; otherwise stop it.
- **camFootprint**'s caption maps each line, which helped. Still opaque: `UB.`, `invView[2].xyz`, `invProjection[0][0]`, `VEC2`, why `1e-4`, and where the pair goes.
- **LT_MIN_ALPHA**: I got the gist, but "~1/(PI alpha^2)" stayed opaque.
- **The learned-map comment** echoes section 3 nicely.
- **The first excerpt** is a wall of notation. "(… past D, from 0.43.0 to 0.60.0 …)" means nothing to me.

## 8. Too much, too little
**Too much:** sections 4–6 are written for the developer (file names, versions, card models), and they are the most tiring part.

**Too little:**
- The "twice" paragraph rushes the most surprising number: 2.4, not 2.
- Section 1's third paragraph puts three new ideas (1/220, the weight rule, 85) into two sentences.

## 9. Wrong or contradictory
- **Light tracing on the open floor.** The text says light tracing shows "the caustic … and nothing else", yet its screenshot reads **open floor 0.007 ± 0.000**, not 0.
- **"Only the camera counts" the open floor.** Camera paths reads **0.388 ± 0.000** there, and Both, split reads **0.395 ± 0.001**. The two differ by more than their error bars, so photons do add light out there. The cause might be reflections off the ball (an orange line heads far left in fig-1-light), but the page never says.
- **2.4× instead of 2×.** It matches 0.455 (camera alone) + 0.282 (light alone). But the camera alone reads 0.455 against a true 0.313, and the page never says that this excess is noise.
- **"≈ 36 … which the entry calls about 40"** reads as sloppy.

## 10. The five changes
1. **Reconcile fig 1's numbers with the text.** Explain the 0.007 and the 0.388 vs 0.395. Explain 2.4× as 0.455 + 0.282, with the camera's 0.455 being noise.
2. **Do the weight arithmetic in section 1.** One find in 220, worth 85, averages to about 0.39. Also say why a find is worth the sun's brightness.
3. **Make section 4 readable.** Put one plain sentence before each excerpt and define EVAL/DELTA, x1, flux, beta, G, MIS, alpha and firefly, or mark the section as optional.
4. **Rename section 3's "floor"** (for example to "minimum share") and draw it visibly apart from the baseline in the learned figure.
5. **Translate sections 5–6 for outsiders.** Drop file:line and PLAN.md references from the prose, and say plainly what was compared. Define illuminance, radiance, lobe and ρ where they first appear.
