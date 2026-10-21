# Review of chapter 14, "Aim at the light", read as a beginner

## 1. Teach-back

When a lamp is small, most random bounces miss it. The few that hit it bring back a lot, because a small lamp has to be very bright to give the same total light. So each try gives either nothing or far too much, and the picture stays speckled for a long time. Next event estimation (NEE) fixes this. At every bounce you also pick a random point on the lamp and send a "shadow ray" to it. If nothing is in the way, you add that light. Every ray that isn't blocked counts, so the noise drops a lot and the average stays the same. The bigger the lamp, the less it helps. It cannot help for mirrors or glass, because they only send light one exact way. The rule underneath is: whatever you chose at random, divide by the chance of choosing it. In ShadyTracer the shadow rays cost about a quarter of the GPU time, and they are kept because the noise saving is worth more.

## 2. Quiz

1. Small lamp: most paths miss it, and the hits are huge, so the average settles slowly. **Taught.**
2. NEE at each bounce: send a shadow ray to a random point of the lamp, and add its light if nothing blocks it. **Taught.**
3. Dividing by the probability: the page gives the rule and says it makes things "counted fairly". I could repeat that, but I couldn't explain *why* it is fair. "Dividing by 1/ℓ is multiplying by ℓ" almost says "one point stands in for the whole lamp", but it never says it outright. **Partly taught.**
4. Mirror: it reflects in only one exact direction, and a random point on the lamp is never exactly that one, so the shadow ray brings back zero. **Taught.**
5. Not counting the lamp twice: the shadow ray already counted that lamp's light at that bounce. **Taught**, but one thing is left open: what if the camera looks straight at the lamp? No shadow ray came before that hit.
6. Cost: 184.7 ms against 136.9 ms of GPU time per sample (about a quarter), plus about 200 MB of memory. Why keep it: "what that quarter buys is the noise". **Half taught.** The page never shows that it wins when both get the same *time*.
7. In 3D: a random direction inside the cone the ball fills, seen from the point, divided by the chance of that direction. **Taught**, but the maths fold-out gives a different 3D formula (see 9).

## 3. Where I got lost (worst first)

- **Section 7's code.** The second excerpt ("lightFaceShare; PLAN.md L7", "camera owns what they light", "neeSunPick", "BSDF side's weights", "sunmis", "codegen LIGHTS") meant nothing to me. It also stops before the choice is actually made, so I never see "one random number chooses which".
- **The fold-out's formula.** I understood the formula only because of outside knowledge:
  - E is never named.
  - It never says why the flat world uses 1/r and 3D uses 1/r².
  - "the cosine law", "normal" and "radiance" are not explained.
  - "albedo over 2 … over π" just appears from nowhere.
  - "what the path has kept so far" assumes I know each bounce loses light. Nothing on the page says so.
- **Section 6:** "A shadow ray asks a surface: how much of the light … do you send to the eye?" The card and the code both say a shadow ray asks "is anything in the way?" I couldn't tell which question it asks.
- **"Not on the last round":** if the last round's shadow ray is never traced, is its bounce traced either? I didn't see how "falls back to finding light by bouncing" can work.
- **Section 8:** "the user's NVIDIA Pascal card": which user? The "MEASURED" and "READ IN CODE" stamps are never explained. "Noise library scene" is unknown to me.
- **Section 10:** "tell where the ball is": the flat room has a ball as an obstacle, and the 3D room's lamp *is* a ball. I didn't know which room was meant.

## 4. Words and symbols before their explanation

- **Marked words whose cards helped:** path, noise, shadow ray, albedo, kernel, caustic.
- **error bar:** the card adds "standard error", which is new jargon.
- **pdf:** the card says "how likely … to land at each value". "1/ℓ per unit of length" is a new idea (a density), and the card doesn't make it clear.
- **delta:** the card never says why it is called "delta".
- **"steradian"** appears in section 2, three sections before solid angle is introduced. The card helped.
- **Used with no card:** diffuse, sample, radiance, normal, cosine law, variance ("the variance was not"), converge, cosine-weighted, WGSL, PRNG, `.x`/`.xy`, f32, BSDF, march, queue, buffer, Hit record, cd/m², the cross product `|L x S|`.
- **"Monte Carlo"** is in the word list, but it is not marked where it is used in the fold-out.
- **"direct light"** is in the word list but never appears in the text.

## 5. Figures

- **Fig 1 (flat room).** I couldn't see which drawn paths reached the lamp: they are all the same blue. "One row of pixels" isn't visible. The red ⊕ labelled "pixel" sits in the middle of the room, which confused me, because I thought a pixel belongs to the camera. I didn't know the ⊕ marks on the lamp, ball and box can be dragged until "Try it" asks me to drag the lamp. The red box on the strip is not explained.
- **Fig 2 (one floor point).** Clear: orange rays found the lamp, grey ones missed. "Light here: 0.208" has no unit or meaning. I wondered why we sample at all if the exact value is known. "aiming: 0.208 ± 0.000" looks like aiming is perfect, while the text says "many times smaller".
- **Fig 3.** It has the same controls as Fig 2, so I wasn't sure it was a separate figure. The "block" shot jumps to lamp size 1.20 and hides the lamp completely (0 of 70 rays, everything 0.000). It doesn't show "drops to the light that really gets past it"; a partly hidden lamp would.
- **Fig 4.** Grey dashed lines (the shadow rays, I guess) and red against blue dots have no legend. The two strips look almost alike; only the dots show the difference.
- **Fig 5.** Very convincing: black with white dots against a smooth picture. But "±90%" means little to me for a black pixel.

## 6. Maths fold-out

I followed "dividing by 1/ℓ is multiplying by ℓ" and "divide by p as well". I didn't follow:
- what E is;
- why 1/r in the flat world;
- the cosine at the floor;
- "albedo over 2 / over π";
- why the pdf itself makes the estimate fair.

One concrete example would fix most of this. For instance: "a light picked half the time counts double".

## 7. Code

- **Excerpts 1 and 4:** the comments are prose, and their headers translate them well. Excerpt 1's header turns "variance" into "how much it scattered", which saved me.
- **Excerpt 3:** the caption explains beta, f, NoL, w, dS and offsetTol. Still opaque:
  - The prose says "density pS" but the code divides by dS. Are they different?
  - `select(1e-7, 1e-9, kind == 2u)`, `max3`, `ltot`/`absLtot` "(prog_occlude)", `VEC3(1.0)`, `RAY_ACTIVE`.
  - `w` "the MIS weight" was never in the fold-out's formula.
- **Excerpt 2** is labelled JavaScript and **Excerpt 3** WGSL, and WGSL is never explained. `max(1.0 - fs, 1e-6)` and the rescaling trick stayed opaque.
- **Section 9's code:** "mixture density, BOTH terms evaluated for EVERY direction" was asserted with no reason I could follow.

## 8. Too much, too little

- **Too much:** section 7's three code excerpts and the stale-number note, and sections 8 and 9's engineering detail (buffers, rounds, f32 steps, 1.6e9 cd/m²).
- **Rushed:** the fold-out, the 3D aiming paragraph ("into the cone of a sphere around it": what about objects that aren't spheres?), and caustics.
- **Good as they are:** the "142× too bright, median right" story and the lesson in "a comparison that did not compare".

## 9. Wrong or contradictory

- **Section 2** says the bouncing estimate "agrees with the exact value within its error bar". In fig-2-small it reads 0.237 ± 0.025 against an exact 0.208. The difference is 0.029, which is bigger than the error bar.
- **The sun's numbers.** I tried to check them, and the page's own figures give three different ratios:
  - The note says the real sun is "some 470 times smaller" than the old 0.03 sr sun.
  - 0.03 ÷ 0.00007 ≈ 430, and 21² = 441.
  - The old comment says the sun is found once in 200 tries and the margin says once in 47,000. That is only 235 times.
- **The fold-out's 3D formula** picks a point on an area A, divided by r². Section 5 says "In 3D the lamp is aimed at differently … a random direction inside the cone".
- **Section 6's "asks a surface"** against the card's "asks one question: is anything in the way?"
- **Fig 4 "big"** gives ±7.6% against ±3.5%. That is still twice the noise, so "much closer" is generous.
- **Fig 5 "big"** gives 69.7% against 13.3%, about five times, which is the same ratio as at 0.22 (90.2 against 16.6). The readout doesn't show that "the two come closer".
- **"The lamp gives the same total light"**, yet the exact value moves from 0.206 to 0.208 when the lamp shrinks, with no explanation.

## 10. The five changes that would help most

1. **Rework the fold-out:**
   - name E;
   - say "one random point stands in for the whole lamp, so multiply by ℓ";
   - give "chosen half the time, count it double";
   - explain 1/r against 1/r² and the cosine;
   - say what albedo/2 is;
   - match the 3D formula to section 5's cone, or say both ways exist.
2. **Fix the contradictions:**
   - the fig-2-small error-bar claim (or say "usually within");
   - 470 / 430 / 235;
   - section 6's "asks a surface";
   - "come closer" in fig 5.
3. **Cut section 7 to what a reader can follow:** drop or heavily annotate excerpt 2, gloss pS against dS, and explain WGSL and PRNG in one line each.
4. **Add legends and drag cues:**
   - orange and grey rays;
   - dashed shadow rays;
   - red against blue dots;
   - "⊕ = drag me";
   - what the "pixel" marker and the strip's red box mean;
   - what "light here" measures.
5. **Make the trade-off concrete:** using the noise card's "four times the samples halve it", show that NEE beats the 26% cost at equal time. Explain the stamps and "the user's card", and say what happens when the camera sees the lamp directly with NEE on.
