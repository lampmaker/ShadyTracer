# Blank reader: "Dust in the air" (ch/haze.html)

## 1. Teach-back
A box of dust makes the air scatter light, which is why sunbeams show. A ray goes on average one "mean free path" before it hits a speck. The chance of getting through a stretch untouched falls exponentially with its length. A random number picks where the ray hits (free flight). On a hit, the ray's light is multiplied by the albedo; on a miss, it stays as it is. At a speck the light turns in a direction picked from the phase function, and one number g makes it forward, even or backward. In a dark room, random bounces rarely hit the tiny sun, so the beam barely shows. A shadow ray aimed at the sun from every dust point makes it appear. A white furnace checks that dust neither makes nor loses light, but only if the controls that should fail do fail. ShadyTracer picks the distance when a leg starts and moves the ray back to it once the march passes it.

## 2. Quiz
1. It is the average distance before a ray meets a particle. A share e^(−L/mfp) crosses L untouched (37% at L = mfp).
2. Draw u from 0 to 1 and take t = −mfp ln(1 − u). In the box, a collision happens if t < t1. The ray is multiplied by the albedo on a collision and by 1 without one, because the share that gets through already *is* the transmittance. I follow "solve for t" only with *outside knowledge* (ln undoes e).
3. It shapes the phase function: g > 0 sends light forward, g = 0 every way alike, g < 0 back. g is also the average cosine of the turn. In fig 3 it changes the beam from 0.0109 (g 0.7) to 0.0048 (g −0.5).
4. The sun spans half a degree, so a direction drawn from the phase function rarely leaves through the window towards it. Aiming sends a shadow ray to the sun from every dust point, weighted by phase function × transmittance. The beam triples, and the patch brightens from the lit dust in front of it. MIS stops the sun being counted twice.
5. A test that cannot fail tests nothing: an eye seeing only sky also reads exactly 1 with no noise, even with a black disc. The controls (0.558, 0.447) must fall below 1. Noise of 0 was a clue too, since the real furnace is slightly noisy.
6. The collision used to be worked back from where the leg ended. Escaped legs ended 400 m out, where 32-bit numbers step in 30 µm. So the start came out off, a particle just past a surface landed inside the solid, and the path was lost (4 × 10^−4 of the furnace's light).

## 3. Where I got lost (worst first)
- **Bounces only vs aiming.** The text says bounces only reads "a third of what they will read below". Is it *wrong* or just *slow*? I inferred slow from "the error bar cannot show the light no sample has found yet", but the page should say so. Nothing says that surfaces still aim at the sun in both modes, so the patch's 0.023 in "bounces only" puzzled me. "pixel 9 ... reads 0.23 ± 0.23: a single find": I can't see it in fig-3-phase (201 samples), and I don't see what it shows.
- **Why exponential.** "the meetings fall off with distance as that curve does" is asserted, not shown. I needed the idea that each unit of distance keeps the same share.
- **"A share e^−t/mfp of the us give..."**: I read "us" as the pronoun.
- **Section 5's code comments** (see 7) and **§6–7's numbers** (see 9; "a heavy tail" is never explained).

## 4. Words and symbols
- **ln** and **e^−t/mfp**: neither is explained, and the exponent has no brackets.
- **weight / "carrying"**: assumed from earlier chapters. **σ_s** and **w** in "σ_s p(90°) w against 1/π" are never defined.
- **steradian**: the solid-angle card helped. The **phase function** card leans on "BSDF", which this page never explains.
- **MIS, shadow ray, f cos θ, delta**: short glosses with chapter numbers. Enough to keep going, but "nothing could aim light at it (a delta)" stayed unclear.
- **kernel, WGSL**: these point *forward* (ch. 21, 22). Unexplained: RAY_ACTIVE/RAY_SCATTER, photon map, probe, seek ray, UB, absLtot, r.beta, power heuristic, f32.
- **cross product**: glossed in one line. School vectors are 2D, so it's new.
- The cards I used (transmittance, free flight, albedo, white furnace, the stamps) were short and clear.

## 5. Figures
- **Fig 1 thin/thick**: clear. Dots, arrows and bars match the text (1453 vs 1472, 9 vs 13). **March**: the slider is suddenly 2.00 and the text never says so. Two solid shapes (a circle and a slab under the box) but "a stone (the solid shape)": which one? The red dot and red arrowhead overlap. Circles cover the "dust, mean free path" label. Without chapter 2, I can't tell why the circles shrink.
- **Fig 2**: forward and back read well, and the mean cosine ≈ g is convincing. But the page says figures are "in the flat world", while these dots are 3D directions "laid on that plane", which I half followed. In fig-2-back the red shape covers "light arriving". No screenshot shows the teal shape.
- **Fig 3**: the room, beam edges and strip work. The screenshots (175–201 samples) differ slightly from the text's 300-sample numbers. In "thick" the annotated shadow ray still reaches the sun from deep in the room, although the text says the dust stops light near the window.
- **Fig 4**: "its colour shows which albedo": the albedo-0 disc is a *red dotted outline*, not black. The paths seem to stop at their first dot. Where do they go next?

## 6. Maths fold-out
I could plug numbers into p(θ) and cos θ, and the "power 3/2" note helped. *Why* the draw is right ("the inverse of its distribution") needs *outside knowledge*. The flat world's tan(θ/2) formula lost me.

## 7. The code
- **hgSample**: well explained (b1, b2, c, ph), and I followed it.
- **hazeDraw**: the log line is clear thanks to the note. absLtot and `t * r.n` stay opaque. The history comment (lines 186–193: f32, um, tests.js, node) is too dense.
- **hazeAt**: has no note. Its comment just about carries it.
- **Light sampling**: f, w, dS and le are explained, but `r.beta` (the main multiplier) is not.
- **hazeShadow**: good note. The sky's length and offsetTol made sense.

## 8. Too much, too little
- The 0.62.0 → 0.62.2 story is told four times (§1, two code comments, §7).
- §6 is packed with percentages (+0.024% vs +0.015%) that a beginner can't weigh.
- There's too little on why the exponential holds and why bounces only reads low.

## 9. Wrong or contradictory
- The note says "1e-30 keeps it above 0, which means no particle". The code comment says 0 is "not yet drawn" and −1 is "none".
- §6 sets the 3D controls (0.152, 0.4315) beside "the flat world's 0.558 and 0.447, in 3D", which reads as if they should match. They don't, and nothing says why.
- The text names pixel 9's single find, but the screenshot shows none.

## 10. Five changes
1. Add two sentences on why transmittance is exponential (the same share kept per unit) and that ln undoes e. Bracket the exponent and write "the u values" for "the us".
2. In §3, say that bounces only would reach the aimed value given enough samples but rarely finds the sun, and that surfaces aim in both modes. Show pixel 9's find or drop it.
3. Fix the figures: label stone vs slab, say the slider moved to 2, fill the furnace disc white or black, and move the covered labels.
4. Give hazeAt and the light-sampling line a note (`r.beta`), shorten the history comments, and fix the "0 means no particle" wording.
5. In §6–7, say whether the 3D controls should match the flat world's, and define σ_s, w and "heavy tail".
