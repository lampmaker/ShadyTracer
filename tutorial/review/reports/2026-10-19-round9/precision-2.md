# Chapter 30, "Numbers have grain": a beginner's reading

## 1. Teach-back

The graphics card stores numbers like a ruler whose marks get further apart the further you are from zero. A ray counts as having hit a surface once it gets closer than a small length, the surface tolerance, so every shape behaves as if it were that much bigger. That doesn't matter for big things. But a 2 cm glowing disc at 0.91 mm comes out about 1.22 times too big, and so 1.22 times too bright. The tolerance also decides how far past a glass face the renderer looks to find out what comes next. If a gap is thinner than that look, two slabs act as one. The tolerance used at a point is the largest of three lengths: the scene's setting, 1 nm, and a "floor" that grows with distance from the origin, because the number grid gets coarser out there. The automatic setting is a ten-thousandth of the scene's size, kept between 10 nm and 1 mm. The engine works in metres and the scene works in its own unit, and they only meet in one function. A checker program called unitlint fails the build if engine code talks to the scene any other way.

## 2. Quiz

1. A ray stops once it is within the tolerance, so a shape is traced bigger by that much all round. A glowing surface gives out light in proportion to its area, so a fatter small lamp is too bright (1.22× at 0.91 mm, seen 37° off its axis). At glass, the renderer asks what material lies "twenty tolerances across". If the gap is narrower than that, the answer is the next slab's glass. Glass against glass is no face, so the two slabs are traced as one.
2. They are the scene's setting (typed or automatic), one nanometre, and the floor (128 × 2⁻²³ × the distance from the origin). Far from the origin the floor wins.
3. It is 1e-4 of the scene's size in metres, clamped between 10 nm and 1 mm, and a scene with no size gets 1 mm. The cap is there because "size" includes things like a ground slab: Menger's is 424 m, which would give 4 cm. With the cap, the automatic value can only make a scene finer than the old 1 mm, never coarser.
4. They meet in `sceneAt` in scene_api.js. It multiplies because a multiplication rounds by at most half a step, while GPU division may be off by 2.5 steps. In a metre scene both factors are 1, so nothing changes. *Only from the code in section 4 did I see that there are two factors (×1000 going in, ×0.001 coming out).*
5. The code would compile and be right in every metre scene, but wrong by 1000× in a millimetre scene. unitlint.js reads every kernel built against every scene during check-shaders' second pass. It names the line and follows calls one level down. The page did not tell me what check-shaders is or when it runs.

## 3. Where I got lost (worst first)

1. **"It multiplies by the unit, never divides"** (section 3). Turning metres into millimetres by multiplying by 0.001 goes the wrong way. Then "both factors are 1" talks about two factors before I'd been told there are two. It only made sense after the tracebasics excerpt.
2. **What "the engine" and "the scene" are.** The whole of section 3 depends on the scene being *code* (functions like SDF) that the engine calls. The only hint is figure 3's caption, "the three functions a scene gives". I filled this in with *outside knowledge*. "Kernel" is never explained.
3. **The lamp: camera rays vs. light on the floor.** The figure shows rays from the camera, but the bench measures light landing on a floor. Where does the 37° come from? "The light over the glowing object read 0.80 to 0.84": I first read "over" as "above" before I realised it is a ratio. "Rays and photons start on the disc itself": photons are never explained.
4. **The floor.** "128 steps … since below about a hundred a surface's normal is the numbers' own pattern" leans on chapter 4. Then "one f32 step is between 2⁻²⁴ and 2⁻²³": why 23? (*outside knowledge*: the mantissa bits). "A nanometre, so the tolerance is never zero whatever is set (two different minimums…)" is a broken sentence, and I couldn't tell why there are two minimums.
5. **"twenty tolerances across"**: "across" means past the face, which I had to guess. "Bend the ray by the two indices": refraction and index are *outside knowledge*. "(the table of every use, section 4)": the excerpt there stops before any row about this probe.
6. **"farAway calls metres, a scene-side function"**: the engine works in metres, so why is `metres` the scene's? What does `metres(1000.0)` return?

## 4. Words and symbols

- **f32**: the card's ruler picture helped a lot.
- **surface tolerance**, **lint**, **scene's unit**: the cards are good.
- **march**: the card comes at the end, after "marching" is already used in section 1. It is fine once found.
- **bench**: the card says "a fixed test of speed", but here the bench measures brightness and rows pass or fail. The card doesn't fit.
- **No card at all**: kernel, normal, photons, refractive index, Fresnel, SDF, WGSL/shader (only the caption), uniform, host, double precision, ulp, the pick, `h.s.w` (explained only in section 4, after figure 3 uses it), lavapipe and "node".
- **"the user's Ampere/Pascal card"** first appears in section 1. It is only explained by the "measured" card in section 5.
- **0.36.0, 0.66.0**: I guessed these are ShadyTracer versions.

## 5. Figures

- **Figure 1 (lamp)**: clear. The blue, red and grey rays and the dashed margin work, and the red rays at the top and bottom show the fattening. The "fine" screenshot makes the red vanish, which is a good contrast. I'd like the disc's axis drawn so "37° off its axis" can be seen. Calling the two tabs "left choice / right choice" is awkward.
- **Figure 1 (gap)**: the best figure. The dashed arrow lands inside the second slab and is labelled "no face here, one slab". At 10 µm a short arrow stops in air. I understood it at a glance.
- **Figure 2**: dense. The five lines have no labels on the plot, so I kept going back to the caption for the colours. The readout line rescued it ("so the floor wins: 30.5 µm"). In "old" the red floor goes flat at 0.1 nm, and the text never says that this flatness is the point. The "0.1 nm" and "1 nm" axis labels are cramped.
- **Figure 3**: clear. Each plant turns red and gets one complaint. The messages are full of jargon ("tagCaptureEnd() and the boundary's functions are the engine's", "materialAt, lightFaceAt", "EPS_WGSL"). The "unit" plant is `1.0 / UB.sceneUnit`, a division, right after the page says never to divide, and nothing comments on it. There is a big empty gap above the buttons.

## 6. Maths fold-outs

The page has none. The inline maths: 1.091² = 1.19 is easy. Steiner's formula is stated, but I can't work out an ellipse's perimeter ("computed" is honest about that). 10.5 µm / (128 × 2⁻²³) = 69 cm is followable if you accept the floor formula, and 6.55 likewise.

## 7. The code

- **autoEps**: the caption made it readable: clamp with `Math.min(Math.max(...))`, with a fallback. The `? :` operator is new to me.
- **TOLERANCES**: the regular expressions are opaque even with the caption. The excerpt cuts off in the middle of the "two steps off" row, so I can't see its `why`.
- **sceneAt**: lines 412–413, 415 and 418–420 are clear thanks to the caption. 414 and 416 (`capture`, `${given ? …}`) and 421 (`insideScaled`, `h.insideW`) stayed opaque.
- **engPerScene/scenePerEng**: clear, and this is what fixed my confusion from section 3.
- **unitlint comment**: the idea is clear. The name lists (HIT_FRAME, XF_*, perMm) mean nothing to me.

## 8. Too much, too little

- The section 1 lamp paragraph stacks too many numbers: 1.11, 1.091, 1.19, 1.22, plus Steiner.
- Section 2's first paragraph packs three lengths, two minimums, the floor and the RGBW example into one block.
- Section 3's unit paragraph rushes the photon story, and "divided by the square of their distance" assumes the inverse-square law.
- Section 5's "small sphere" is rushed. "Counts a lens's curvature as size" is opaque.
- Section 6 repeats earlier sections, which is fine as a recap.

## 9. Wrong or contradictory

- Section 2 says "128 steps", then "the floor 128 to 256" steps.
- Section 2 says that for an automatic tolerance the floor passes at "always … 6.55 times the scene's size … far outside the scene". By the page's own numbers, though, a capped scene passes at 65.5 m. Menger's is 424 m, so that is inside the scene.
- The bench card says "speed", but the page uses the bench for light readings.
- Section 1 points to section 4's table for the twenty-tolerance probe. The excerpt doesn't show it, and section 5 says twenty tolerances is the *shadow ray's* offset.
- Section 1 says a light's rays "start on the disc itself", but section 5 says they start "two tolerances off its exact flat face". This is probably compatible, but it reads as a clash.
- In figure 1 "fine", the readout says the pair should read 0.998. The text says it read 0.994, and the gap isn't commented on.
- Try-it 3 asks "which one would pass in a metre scene and fail in a millimetre one?" By the text, all of them would, so the question looks like a trick.

## 10. The five changes

1. Start section 3 by saying what the engine, the scene and a kernel are: the scene is functions the engine calls, compiled together. Then introduce the two factors (×1000 in, ×0.001 out) *before* "multiplies, never divides".
2. In section 1, link the camera rays to the floor's light: say how a floor point finds the lamp and where 37° comes from. Rephrase "the light over the glowing object" as a ratio, and explain or drop "photons".
3. In section 2, write the three lengths as one clean list and fix the broken nanometre sentence. Make "128 steps" and "128 × 2⁻²³ × distance" agree, and fix "always far outside the scene" for capped scenes. Label the lines on figure 2 and point out the flat old floor.
4. Show the table row for the material probe, or drop the pointer to it. Say that "across" means past the face, and give refraction and index one line.
5. Fix the bench card and explain "the user's Ampere card" where it first appears. Explain `metres` as a scene-side function, and tone down the jargon in figure 3's messages, or comment on the `1.0 / UB.sceneUnit` division.
