# Beginner's read of "Measuring light" (ch/photometry)

## 1. Teach-back
There are four ways to say how bright a light is:
- **Lumens** count all the light a lamp gives off.
- **Candela** count the light it sends in one direction.
- **Lux** count the light landing on each square metre of a surface.
- **Candela per square metre** say how bright a surface looks. A camera pixel holds this one.

If you move a glowing panel farther away, a pixel on it stays just as bright. The panel only covers fewer pixels, so less light reaches your eye in total. That is where the inverse square law comes from. For this reason a ray carries luminance, which doesn't change along the way.

The sun is set by the lux it gives (100,000) and how wide it looks (0.53°). Its luminance comes out as about 1.5 billion cd/m², from E = πL sin² α. A wider sun is less bright per bit, so the picture isn't brighter.

A white matte floor shows ρE/π, and a real graphics card matched that to about 0.01%. Small numbers like 1 − cos α go wrong in 32-bit floats, so they are worked out on the CPU in 64-bit. One bug happened because two parts of the code drew the sun's edge in slightly different places.

## 2. Quiz
1. Lumens measure total light out (flux). Candela measure light in one direction (intensity). Lux measure light landing per m² (illuminance). cd/m² measure how bright a surface looks (luminance). A pixel holds cd/m².
2. A pixel wholly on the panel still reads 1000 cd/m², because luminance doesn't change along a ray. The panel covers a quarter as many pixels, so the light at the eye drops to a quarter (61.2 → 15.5 lux). *Why* luminance stays the same along a ray is shown in the figure but never explained.
3. L = E / (π sin² α), with α = half the width. A wider sun means a bigger sin² α and so a smaller L, while E stays fixed at 100,000 lux. The floor gets the same light, and only the shadows get softer. The page never explains why shadows get softer.
4. The floor gets E = 100,000·sin(elevation) + 15,000 (the sky). It sends back ρ of that. A matte surface of luminance L sends out πL ("the sky turned round"), so πL = ρE. Results: 21,826 expected against 21,827.2 measured (ratio 1.0001), and at 20°, 8,709.5 against 8,709.3. I only followed the π because I had opened the fold-out.
5. 1 − cos α = 0.0000107. Near 1, a 32-bit float only has steps of about 0.00000006, so the answer has about 0.5% error. Instead it is worked out once in 64-bit on the CPU, using 2 sin²(α/2). I got the "what". The claim "that number is ... the chance of aiming" was not taught.
6. One part tested the edge with a dot product against cos α, and another with a cross product against sin² α. On a thin ring at the rim they disagreed. Rays there came back about 10⁵ too bright, so some test rows were 142–352× off. The fix is one function, inSunDisc, for everything. The page did not teach me why a ray "divides by the sky's small chance".

## 3. Where I got lost (worst first)
1. **Section 6: "the whole disc's luminance divided by the sky's small chance"**, and section 2's "the chance of aiming at any one direction of it". The page never says that rays get divided by a probability, or why. Chapter 14 is only mentioned in passing.
2. **"1 time in 66,111"**. I can't rebuild this number. A "random direction" over the half-sky gives 2π / 0.0000672 ≈ 93,500. I only know it means a cosine-weighted bounce because I already knew that (*outside knowledge*).
3. **"It also has no length in it"**. cd/m² *has* metres in it, and so does lux, which is lumens per square metre. This sentence made me doubt the whole chapter.
4. **The fold-out is "closed until the reader opens it"**, but sections 2 and 3 depend on it ("the fold-out above", "the fold-out's sky, turned round"). If I skip it, πL and π sin² α come from nowhere.
5. **WGSL note: "cross(L, sd) has length sin of the angle"**. I know vectors as 2D arrows. Cross and dot products are *outside knowledge*, and so are "normalize", "UB" and "from the host".
6. **"1 − cos α is worked out as 2 sin²(α/2)"**. This half-angle identity isn't school maths for me (*outside knowledge*). The page needs a one-line check.
7. **"Numbers in the comments, checked"**. This corrects comments I mostly never saw (the "file's header", "the sun in a mirror"). It is hard to follow.

## 4. Words and symbols
- **solid angle**: used in a bullet before it is explained. The card helped (ball of radius 1).
- **steradian**: fine inline.
- **radiance**: its card ("what a camera pixel measures") and the luminance card ("radiance as the eye sees it") define each other in a circle.
- **irradiance**: appears in the illuminance card and is never defined anywhere. That card doesn't help.
- **normal** (fold-out): known from physics reflection, so fine.
- **radians**: not explained.
- **ρ**: never said to stand for albedo except on a slider.
- **f32**: its card is about distance from (0, 0, 0), not about numbers near 1, so it only half fits here.
- **No card or explanation**: samples (per pixel), jitter, "chapter 1's slant", aiming, host, median, inferred (no card, unlike the other stamps), pdf, NEE, BSDF, Lambertian, collimated, delta, Rec.709 (the note helps), march epsilon, emitter, `??` (a JS operator I haven't met).

## 5. Figures
- **Fig 1, panel and pixels.** The three screenshots make the point well: the square shrinks while the readout keeps saying 1000, and the lux drops 61.2 → 15.5 → 3.90. Confusing parts:
  - The dotted centre line isn't explained.
  - The orange ⊕ is presumably the handle, but nothing says so.
  - The "≡" marks on the panel point away from the eye.
  - "The cosine at the eye": which angle?
  - The "near" readout shows L a²/d² = 62.5 next to an exact 61.2, and the text only comments on this at 8 m.
- **Fig 2, sun's width.** The dot on the sky and the cone at 10° are clear. On the log chart, I don't know why the line is straight (*outside knowledge*: it goes as 1/α²). The caption says "each mark is ten times the last", but the x marks are 0.1°, 0.53°, 2°, 10°. The elevation slider changes only the 1-in-N chance, and nothing says so.
- **Fig 3, floor.** This one is the clearest. The rings next to the curve show the measured values agreeing, and the sky dome disappearing in "Sun only" is a nice touch. The readout "34,202 lux = 34,202 lux" looks like a glitch.

## 6. The maths fold-outs
I could follow these:
- E = I cos θ / d².
- Whole sky → πL.
- Overhead disc → a circle of radius sin α → πL sin² α. This one was satisfying.

I couldn't follow these:
- "Pressing down" is stated, not shown. It badly needs a drawing.
- "Its solid angle is 2π(1 − cos α)" has no reason given.
- "Very nearly π sin² α" and "about α²/4" need small-angle approximations (*outside knowledge*).
- "The usual shortcut": a shortcut for what? It was never introduced.

## 7. The code
- **The header comment** is mostly opaque: "frame and accumulation buffers", "march epsilon, surface offsets", "absorbing medium", "UNITS is here and not only in the builder".
- **sunCone**: the note helped. Opaque lines: `* Math.PI / 360` (why 360?), `1e-3`, "uniform-cone pdf", and the unused `cosHalf`.
- **discLuminance**: clear.
- **inSunDisc**: the idea is clear from the note, the maths isn't (see section 3 above).
- **fluxFactor**: the n = 1 → π check helped. Opaque: cos^n, "radiance cos^(n-1)", "a delta has no luminance".
- **The test excerpt**: clear.

## 8. Too much, too little
- **Too much**: file:line references in the prose (uniforms.schema.js:382, docs/TESTING.md, "derive"), the paragraph correcting the comments, and section 5's list of ratios. Section 6 is dense: five bugs in compressed sentences.
- **Too little**: why luminance stays constant along a ray, why we divide by a chance, where 66,111 comes from, why a wider sun gives softer shadows, and cross and dot products.

## 9. Wrong or contradictory
- **"No length in it"** against the units being per square metre.
- **"The units hold, to a hundredth of a percent"** against sky-only 0.9993 (0.07% off), and section 3's own "within 0.07%".
- **"a quarter as many (39 whole and 61 at its edge, against 294 and 106)"**: 39 is not a quarter of 294. Only the totals (100 against 400) are.
- **"That number [1 − cos α] is both the sun's luminance…"**, while discLuminance uses `Math.sin(half) ** 2`, not 1 − cos.
- **The discLuminance comment says 1% off at 10°**, but the text and figure say 0.19%. This is resolved, but only later in the "checked" paragraph.
- **The fig 2 caption's "ten times the last"** doesn't match the x axis.

## 10. Five changes
1. Bring E = πL sin² α and the "floor is a sky turned round" argument into the main text with a pressing-down drawing, or leave the fold-out open, since the sections rely on it.
2. Rewrite "no length in it": say the *scene's* unit doesn't matter, because a room twice as big seen from twice as far looks identical.
3. Either explain in two sentences "dividing by the chance of a direction", or rephrase section 2's last paragraph and section 6's second bug without it. Also say how 66,111 is computed, or that the bounce isn't uniformly random.
4. Give the maths tools inline:
   - radians
   - the dot and cross product as "cos and sin of the angle between two directions"
   - the identity 1 − cos α = 2 sin²(α/2)
   - a definition of irradiance on its card
5. Fix the inconsistencies:
   - "hundredth of a percent"
   - the 39 / 294 "quarter"
   - "that number is the sun's luminance"
   - the log-axis caption
   - the duplicated readout
   - move the comment corrections next to their excerpts, and trim the file references out of the prose.
