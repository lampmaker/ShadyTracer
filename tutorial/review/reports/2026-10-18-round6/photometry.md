# Beginner review: "Measuring light" (Chapter 5)

## 1. Teach-back
Light can be measured in four ways. Lumens are all the light a lamp gives out. Candela are how much it sends in one direction, which is lumens per steradian, a patch on a ball of radius 1. Lux are how much lands on each square metre of a surface. Candela per square metre (luminance) are how bright a surface looks, and that is what a pixel holds. When a glowing panel moves twice as far away, a pixel on it reads the same, but the panel covers a quarter of the pixels, so it puts a quarter of the light on your eye. That is where the inverse square law comes from. So a ray can carry luminance without changing it, and it doesn't matter whether the scene is built in millimetres or metres. A whole sky of luminance L puts πL lux on the ground, and a round lamp overhead puts πL sin²α. ShadyTracer's sun is set as 100,000 lux and 0.53° wide, so its luminance is about 1.5 billion cd/m². A wider sun with the same lux is dimmer per bit but lights the floor the same. A white matte floor looks ρE/π bright, and a real graphics card matched that to about 0.01%. The sun is so small that the card's 32-bit numbers can't hold 1 − cos α well, so the main processor works it out. One function decides "inside the sun" for everyone.

## 2. Quiz
1. **Lumens** measure total flux. **Candela** measure intensity in one direction. **Lux** measure illuminance, the light landing per m². **cd/m²** measure luminance, how bright a surface looks. A pixel holds cd/m².
2. A pixel wholly on the panel still reads 1000. The panel covers a quarter as many pixels, so the light on the eye falls to a quarter (61.2 → 15.5 lux). Along one line of sight, brightness doesn't change.
3. L = E / (π sin²α), with α half the width. A wider sun at the same lux has a lower L. The floor depends only on E, so the picture is no brighter. The page says the shadows get softer but **doesn't teach why**.
4. Light out per m² is ρE. A matte surface of luminance L sends out πL (the "sky turned round" idea), so L = ρE/π. The measurement was 21,827.2 against 21,826, a ratio of 1.0001, and every row was within 0.07% except the one with aiming off.
5. On the GPU, numbers near 1 come in steps of about 0.00000006. cos α is only about 180 steps below 1, so 1 − cos α is about half a percent wrong. The main processor uses 64-bit numbers and the 2 sin²(α/2) form.
6. One part used the dot/cos test and another the cross-product test, and they disagreed on a thin ring at the rim. Rays there were "divided by the chance of an unaimed bounce", which made them about 10⁵ too bright in a few pixels. **Why you divide by a chance was not taught here.** I can repeat the answer, but I don't understand it.

## 3. Where I got lost (worst first)
1. **Section 6, "Two edges to one sun".** In "The chance of aiming at a direction still tested the disc as dot(L, S) ≥ cos α, the luminance as section 4's cross product", I can't tell what "the chance of aiming" or "the luminance" refer to as parts of the program. "a rare find counts for more" is a whole idea left to chapter 8.
2. **The fold-out's key step.** "A patch of luminance L lights the point by L times the area of its shadow" is simply asserted. Sections 2 and 3 both rest on it. There is no drawing of the dome, and nothing shows why the circle has radius sin α. "very nearly π sin² α" and "about α²/4" need approximations I don't know (*outside knowledge*: cos α ≈ 1 − α²/2).
3. **Section 1's lux sum:** "its reading, times the small solid angle it covers, times the cosine". It doesn't say why luminance × solid angle gives lux, or how I'd know a pixel's solid angle. The cosine law is used here before section 3 or the fold-out explains it.
4. **"0.0000672 × cos 45° / π"** in section 2. The /π is unexplained. Which angle is the 45°? Section 3 writes sin 45° for the same sun. "matte" is used here but only defined in section 3. Why a ray bounces off the ground at all is *outside knowledge* (path tracing).
5. **"348.2 pixels' worth at 2 m"**: the readout shows "294 pixels wholly on it, 106 at its edge". That adds to 400, and nothing gives 348.2.
6. **f32 paragraph:** "the luminance needs sin² α, as small". Is that also a problem, or not?

## 4. Words and symbols before explanation
- **Undefined:** *ray*, *path tracer*, *samples*, *noise*, *shader*, *pdf*, *emitters*, *NEE*, *BSDF*, *march epsilon*, *collimated*, *delta*, *integral*.
- **Partly known:** *normal* (I know it from school reflection, luckily).
- **Radians:** first used in section 2 ("0.00463 radians"), but explained only at the end of the closed fold-out.
- **Σ** in the figure 1 readout, and **1e+9 / 1e11** on the axis and readout, are not explained.
- **Cards:**
  - *solid angle*, *luminance* and *albedo*: helpful.
  - *illuminance*: defined as "Irradiance as the eye sees it", and irradiance is never explained.
  - *cosine law*: says "from the normal", but section 3 then uses sin.
  - *f32*: talks about distance from (0,0,0), not about numbers near 1. The ruler image half-helps.
- **Stamps:** "inferred" is used as a stamp word but has no card.

## 5. Figures
- **Figure 1 (panel):** clear and the best thing on the page. The three screenshots show the pixel reading staying at 1000 while the square shrinks, and the lux readout quartering. Confusions:
  - 348.2 doesn't match the readout's counts.
  - At 2 m the readout shows L a²/d² = 62.5 against 61.2, and the text never says why they differ there.
- **Figure 2 (sun):** the left side works; the 10° disc visibly grows. The caption explains the log scales well, but "1e9" labels will lose many students. Elevation only changes the readout, which the caption does say.
- **Figure 3 (floor):** the curve and dot are clear, and the second ring appearing in "Sun only" makes sense. Problems:
  - The "grey rings" look dark.
  - ρ in the hand font reads as "p".
  - The tiny tilted eye at the top right is hard to recognise.

## 6. Maths fold-out
I could follow the four definitions, E = I cos θ/d², and "whole sky → disc of area π". I couldn't follow:
- why L × shadow area;
- why the radius is sin α;
- "very nearly π sin² α", "(1 − cos α)/(1 + cos α)" and "α²/4". One hint, sin² = (1 − cos)(1 + cos), would have let me do the middle one myself.

## 7. Code
- **photometry header:** I got the first sentences. "frame and accumulation buffers", "march epsilon, surface offsets" and "UNITS is here and not only in the builder" stayed opaque.
- **sunCone:** the caption made `half` and the 2 sin² trick clear. Opaque: `Math.max(diameterDeg, 1e-3)`, `**`, "reciprocal of the uniform-cone pdf". It also isn't clear why the trick is still needed in 64-bit.
- **inSunDisc:** the dot product was well explained. The cross product is 3D and new to me, so I took it on trust. `normalize`, `UB` and "camera's BSDF hit, NEE, the photon emitter" were opaque.
- **fluxFactor:** the n = 1 → k = π check helped. The general formula ("integral"), `??`, and `null` for collimated were opaque.
- **floorExpected:** clear.

## 8. Too much, too little
- **Too much:**
  - The file:line references ("uniforms.schema.js:382", "photometry.js:177", "the comment above derive", "the setting's comment") mean nothing to me.
  - Section 4's "Numbers in the comments, checked" stamp quotes a header I never saw, and "the sun in a mirror" is unexplained.
- **Too little:** the fold-out and section 6 are rushed for how much they carry.
- **About right:** section 1's main idea.

## 9. Wrong or contradictory
- "348.2 pixels' worth" against the readout's 294 + 106.
- "The two sky-only rows, both 0.9993", but only one sky-only row is listed.
- cos 45° in section 2 against sin 45° in section 3 for the sun's height. They only agree because the angle is 45°.
- The code says "1% off at a 10-degree" sun and the page says 0.19%. The page flags this, but it is unsettling.
- Try-it asks how wide the sun must be for a 1% error, but section 4 already gives the answer (about 23°).
- The readout says "reads 1000 … at any distance", but a tiny far panel has no pixel wholly on it.

## 10. The five changes
1. Draw the dome in the fold-out and justify "L × shadow area" in one or two sentences, marking the sin α radius. Sections 2 and 3 depend on it, so don't leave it only in a closed fold-out.
2. Rewrite "Two edges to one sun" in plain steps: what aiming is, what each test decided, and a one-line example of why a rare direction gets divided by its chance.
3. Fix the mismatches:
   - put "pixels' worth" in the readout;
   - the two sky-only rows;
   - say which angle "cos 45°" is and where the /π comes from.
4. Introduce radians, the cosine law, matte and normal before first use. Fix the illuminance card's "irradiance".
5. Fence off developer notes (file:line refs, the comment-checking stamp) in a "for developers" box. Write 1.488 × 10⁹ instead of 1.488e+9, and explain Σ.
