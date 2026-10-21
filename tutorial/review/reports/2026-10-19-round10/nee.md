# Beginner review: "Aim at the light" (Chapter 14)

## 1. Teach-back
A path tracer makes each pixel by averaging many random paths. A path bounces around and only brings light back if it happens to hit the lamp. When the lamp is small, almost every path misses it. The few that hit bring back far too much, so the picture is speckled and takes a long time to settle. Next event estimation (NEE) fixes this: at each bounce you also send a "shadow ray" to a random point on the lamp, and if nothing blocks it you add that light. One point stands in for the whole lamp, so you multiply by the lamp's length. That is the same as dividing by the chance of picking that point, and the average still comes out right. Because every aimed try gives about the same amount, the error bar shrinks much faster. It does nothing for mirrors and glass, because they send light in only one exact direction. You also must not count the lamp twice when a bounce hits it. In ShadyTracer it costs about 1.35 times the GPU time, which is a good deal.

## 2. Quiz
1. Most random paths miss a small lamp, and the rare hit is far too bright. Each try gives "nothing or far too much", and the average settles slowly.
2. It picks a random point on the lamp and sends a shadow ray there. If nothing blocks it, it adds that light times the lamp's length, times what the surface sends on, times the throughput.
3. So that it is right on average. A choice made with chance p must count 1/p when it is made (the "two lamps, picked half the time, count double" example).
4. A mirror sends light in only one exact direction. A random point on the lamp is never exactly that direction, so the shadow ray brings back zero.
5. The shadow ray from the bounce before has already counted the lamp's direct light at that point. Adding it again would count it twice. The exceptions are a camera ray and a ray off a mirror.
6. 184.7 ms against 136.9 ms of GPU time per sample (about 1.35 times), mostly in the occlusion kernel. It is kept because matching NEE's error bar without it would take about 13 to 34 times the samples. That claim is stamped *inferred*, and it comes from the flat room only.
7. A random direction inside the cone the ball fills, seen from the point, divided by that direction's chance. The page does **not** teach how big the cone is or how directions inside it are spread. It points to PBRT for that.

## 3. Where I got lost (worst first)
- **"Not at the last bounce" (§4), and later "Not on the last round" (§8).** "aiming there would count light one bounce further" did not land. §8 then says the last round "falls back to BSDF sampling alone". Are a round and a bounce the same thing? "BSDF" and "pbrt" are never explained.
- **"Which points of the lamp" (fold-out).** "thin capsule, everything within 0.02 of a line", "outline", "a point of a round end that faces away counts 0", "0.1326 ± 0.0014 … (computed)". This is a bug story packed inside the maths. I lost the thread here.
- **§2's parenthetical.** In "picks directions near straight up more often because, by the cosine law, those carry more light, and it divides by that choice", I could not tell why the surface "sends light equally brightly" while the figure doesn't spread its directions evenly.
- **The sun margin note.** "the patch's size divided by π": why π? I accept it only because I already know the answer (*outside knowledge*).
- **"±9.6%".** Percent of what? Is it relative to the pixel's brightness?
- **§9's code.** `dot(L, S)`, `|L x S|^2`, "f32 steps", "cd/m^2", "mixture density", "bias": all opaque. The prose around it carried me, not the code.

## 4. Words and symbols
- **NEE** appears in figure 1's buttons and on the strip label "the picture without NEE" before §3 defines the abbreviation.
- **steradian** appears in §2's margin note before solid angle is explained in §5. The card helps (sky = 4π).
- **cosine law** has no card and relies on chapter 1.
- **BSDF, pbrt, march, queue, deposit, f32, bias, converges** have no card and no gloss.
- **ρ** is introduced in passing. **ρ/2 and ρ/π** are taken "on trust", which is fair since the page says so.
- Cards that worked: pdf (the 2-metre lamp example is excellent), delta, throughput, error bar.
- Cards that were too dense on first reading: radiance and irradiance.

## 5. Figures
- **Fig 1 (flat room):** clear: eye, blue paths, a strip of pixels and dots with error bars. No orange segment is visible, so I never see a path finding the lamp. The lamp's little tick marks are unexplained. The "whose paths" label matches "circled cross". Good.
- **Fig 2 (one floor point):** very clear. Many orange lines at size 1.20 against 3 of 70 at 0.20 makes the point instantly.
- **Fig 3 (aiming):** "70 of 70 shadow rays reached the lamp" is convincing, and the red blocked rays read well. The two screenshots use different lamp sizes (0.20, then 1.20) without saying so.
- **Fig 4 (both pictures):** at size 0.12 the grey bars are visibly longer than the blue ones. Good. Grey means three different things across the page, though: misses (fig 2), without-NEE dots (fig 4) and shadow rays (fig 4's dashed lines, while fig 3's are dark blue).
- **Fig 5 (3D):** the strongest figure. Black-with-white-dots against a smooth room needs no words.

## 6. The maths fold-out
The first two paragraphs and the formula legend were followable with school maths. "Divide by the chance of the choice" stuck. The legend for θ_y ("seen edge-on looks shorter") is nice. I lost it at "Which points of the lamp". ρ/π is taken on trust and is never connected back to `f` in the code.

## 7. The code
- **Light choice (materials_pbr.js 864–875):** the caption made `pick00`, `fs`, `pick0`, `es` and `uL` clear. The block comment ("camera owns what they light", "sunmis", "codegen LIGHTS") stayed opaque. The caption admits that, which helped.
- **Contribution (964–975):** `contrib = beta * f * NoL * le * (w / dS)` mapped well onto the caption. `select(1e-7, 1e-9, kind == 2u)`, `ltot`, `absLtot`, `steps`, `RAY_ACTIVE`, and *why* beta is reset to `VEC3(1.0)` stayed opaque.
- **Occlusion pass:** I got the idea ("asks one question"). "Hit record", "march", "queue" and "shade kernel's machinery" stayed opaque.
- **envPdf:** see §3 above.

## 8. Too much, too little
- **Too much:** §§7–9, the capsule history, and two "last bounce/last round" paragraphs that say similar things.
- **Too little:** how big the cone is. With school trigonometry this is one line: sin(half-angle) = radius / distance. Also why π appears, and what the % error bar is relative to.

## 9. Wrong or contradictory
- §3 says "here ± 0.001 against ± 0.009". The fig-3-aim screenshot beside it shows ±0.003 against ±0.025. The quoted numbers are fig 2's at lamp size 1.20.
- §3 says "drops from about 0.21". The aim screenshot just before shows 0.248, because the lamp size changed between screenshots.
- §4 says NEE's error bar at the smallest size is "about a fifth"; §8 says "a sixth … about 34 times".
- §8's "at the lamp's starting size (0.28, …" reads as a lamp size, but the starting lamp size is 0.60. The 0.28 is a ratio. The screenshot gives 3.1/9.6 ≈ 0.32.
- §2 says "the exact light at the point hardly changes", but the readouts go from 0.213 to 0.251, about 18% more.
- The NEE card says "a random point of a light", but §5 picks a direction in a cone.

## 10. The five changes
1. Make §3's numbers and lamp sizes match the screenshots beside them, and state the lamp size at each step.
2. Introduce the abbreviation "NEE" in the opening paragraph, before figure 1 uses it.
3. Merge "Not at the last bounce" and "Not on the last round" into one explained rule: say whether a round is a bounce, and define or drop "BSDF" and "pbrt".
4. Move "Which points of the lamp" out of the fold-out (to §9). Add one line on why π, and say what "%" means in the error bars.
5. Use one colour per meaning across figures, and show how the cone's size follows from trigonometry in §5.

## The sun excerpt and "A stale number, corrected"
Clear on the whole.
- **Before:** the comment said the sun was "about 0.03 steradian" and a bounce found it "once in two hundred".
- **Now:** it says 0.000067 sr, about once in 47,000 tries with the sun overhead, and rarer as the sun sets.
- **Why it changed:** ShadyTracer once drew the sun 21 times too wide, and 21 × 21 = 441 times the sky area gives 0.03 sr. Separately, "two hundred" was the chance for a direction picked evenly (0.03 / 6.28), not cosine-weighted (0.03 / π, once in a hundred). The old figure was found while writing this chapter, and the comment was corrected in 0.67.3.

The arithmetic checks out with school maths. Three gaps remain:
- **Where 6.28 comes from:** I had to halve the card's 4π myself.
- **"About twice as often" overhead:** this is stated but never shown.
- **The "divide by π" rule:** this needs outside knowledge.

"Drew the sun" could also be misread as drawing a picture of the sun on screen.
