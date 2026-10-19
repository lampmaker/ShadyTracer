# Beginner review: "Following a path" (Chapter 13)

## 1. Teach-back
A path tracer starts at the eye and follows one ray at a time. Each time the ray hits a matte wall it goes off in a random direction. Every wall keeps some of the light. A wall with albedo 0.8 passes on 80%, so the path keeps a running product called β (the throughput): 1, then 0.8, then 0.64, and so on. When the path reaches the lamp, it adds β times the lamp's light, and a pixel's value is the average of many paths. In a closed room a path could bounce forever, so the renderer has to stop it somewhere. If you stop it after a fixed number of bounces (a cap), you lose the light that would have come later. The picture then comes out too dark, and more samples don't fix it (that is called bias). This is worse with white walls, because more of the light arrives late. Russian roulette stops weak paths at random, but each survivor's β is divided by its chance of surviving, so on average nothing is lost. The picture gets noisier, but each path is cheaper. ShadyTracer has roulette but leaves it off, because in their test it didn't save any time.

## 2. Quiz
1. **Throughput:** the share of the light found further along that still gets back to the eye. It starts at 1 and gets multiplied at every bounce: by the albedo for a matte wall, and by "f cos θ / p" in general. I could only follow the albedo version.
2. **Cap:** any light that would arrive after the cap is lost, so the picture is too dark, and more samples don't help. White walls (0.95) give more back at each bounce, so a bigger share of the light comes late: a cap of 3 keeps 46% instead of 72%.
3. **Roulette:** after bounce 3, the path carries on with probability p = β (kept between 0.1 and 0.95). If it survives, β is divided by p. Average: p·X/p + (1−p)·0 = X.
4. **Why off:** in ShadyTracer the time per sample didn't go down (+0.9%, "inside the noise"), because "a round with fewer rays left still costs its five kernel launches". The page told me this but didn't teach it. I don't know what a round or a kernel launch is.
5. **6–8%:** turning roulette on once seemed to make the picture 6–8% brighter. The cause was that the renderer adapts how many rounds a sample gets, so the two runs didn't do the same work. With that switched off, all four runs agreed within 0.15%. The lesson: when you compare two settings, hold everything else still. The page did **not** teach why unequal work would make the picture *brighter*.

## 3. Where I got lost (worst first)
- **"for the same number of rays, the error bar comes out a little smaller (0.96 of the other's)"**, right after "its result is noisier". I couldn't work out where 0.96 comes from. Only with *outside knowledge* (error bars shrink like 1/√N, and 10/4.7 ≈ 2.1 times as many paths) can I get there, and from the readout numbers I get about 0.98, not 0.96.
- **"a round with fewer rays left still costs its five kernel launches (chapter 22)"** and **"rays it flushed fell from 1416 to 360"**. Rounds, kernel launches and "flushed" are never explained. 1416 and 360 *what*? On top of that, §3 says roulette "is a small win" and §5 says "the renderer is not paid for it". To a beginner those two claims look like they disagree.
- **"reads each one at every cap"** (Figure 2). Does every cap get its own paths, or is one path's running total read off at bounce k? I only know it's the second from *outside knowledge*. "The room's average light" never says what is being averaged. And why does a cap of 0 give anything? (I guess it's the lamp seen directly.)
- **The first code comment**: "one lobe, drawn by lobesSample… F G2/G1 <= 1 over its pick probability… a refraction a microfacet totally reflects… marching it". It's almost all opaque.
- **"as in the flat world"**: I don't know what the flat world is. **"the code's extra terms are for a coat on top"**: the excerpt shows no extra terms.
- **"the user's Pascal card"**: which user? And what is a Pascal? (*Outside knowledge*: a family of graphics cards.)

## 4. Words and symbols
- **Cards that helped:** albedo, throughput, bias, Russian roulette. They're short and clear.
- **firefly:** the card says "divided by a tiny chance (its pdf)". A student will read "pdf" as a file format.
- **No card at all:** error bar, radiance L_e, BSDF, probability density, ∏ (school doesn't teach product notation), the rendering equation, matte, WGSL, PRNG, lobe, estimator, wavefront, dispatches, autobudget, trimmedLuma, Pascal, kernel.
- **"ray" vs "bounce":** "9.9 rays a path" assumes I know that one ray is one straight piece. The relationship is never stated.
- **Code comment:** "// essential for energy conservation" clashes with the prose, which says division by p keeps the *average* right. As a physics student, I'd have expected energy conservation to mean something else.

## 5. Figures
- **Figure 1** (one path): clear. The β labels 1.00 → 0.80 → 0.64 → 0.51 → 0.41 make the point straight away. Problems:
  - The caption says "the bold last piece", but on screen it is *orange*.
  - The readout "β × 1" never says that 1 is the lamp's brightness.
  - I couldn't tell whether the lamp lights both upward and downward (it has ticks on both sides).
- **Figure 2** (bars per cap): the shape makes the point well, and comparing the Light and White screenshots really shows the white room filling in late. Problems:
  - The text says "the bold line", but it's a thin *red* line.
  - The caption says "0, 1, 2 … 40", but the bars are 0, 1, 2, 3, 4, 6, 8, 12, 20, 40 and evenly spaced, so the curve looks smoother than it is.
  - The y-axis has no unit.
  - "46%" turns up for two different things (Light at cap 1, White at cap 3), which is easy to mix up.
- **Figure 3** (where paths end): the spike at 3 next to the dashed "roulette starts" line is very clear, and so is the fact that both lines match before bounce 3. Problems:
  - I don't know what ends a path when roulette is off (the lamp? the cap? and which cap?).
  - The text says "10.0" rays a path, but the readouts show 9.9 and 9.8.

## 6. Maths fold-outs
- **"The path's estimate":** I followed the idea but not the symbols: ∏, radiance, BSDF, density. "f cos θ and p cancel all but the albedo" has to be taken on trust; one line showing the actual formulas would make it real. "The rendering equation" is named but never shown.
- **"Why nothing is lost":** I could follow it. The weighted average p·X/p + (1−p)·0 is fine. A number example first would make it obvious (10 paths at β 0.2, 2 survive carrying 1.0, total 2.0 either way). The floor of 0.1 is explained. The ceiling of 0.95 is never explained in the prose, and the code comment's "no-op on bright paths" doesn't help a beginner.

## 7. The code
- **Bounce excerpt:** the intro sentence makes `res.r.beta *= smp.w` clear: β is multiplied by the weight. Everything else stays opaque: `lobesSample`, `PRNG()`, `lobes`, and the whole comment.
- **Cap/roulette excerpt:** the last six lines map nicely onto §3 once I guess that `PRNG().x` is a random number between 0 and 1. The page never says so. Also opaque: `0u`, `RAY_ACTIVE`, `UB.`.
- **The 40-line comment:** mostly jargon (wavefront iterations, adaptive iteration budget, trimmedLuma). §5 and §6 retell it in simpler words, which helps, but the comment itself is a wall.
- **Small question:** "a cap of 10" against `bounces > UB.maxbounce`. Does that mean 10 bounces or 11?

## 8. Too much, too little
- **Too much:** the long code comment repeats §5 and §6 almost word for word, so the 6–8% story comes up three times. The reading box sits in the middle of §3.
- **Too little:**
  - why a path tracer starts from the eye rather than the lamp (I relied on earlier chapters, or *outside knowledge*);
  - what a "round" is, and why fewer rays don't save time;
  - how the 0.96 is computed;
  - why unequal work made the picture *brighter*.
- **Rushed:** §5's second stamp packs four new ideas into one sentence.

## 9. Wrong or contradictory
- **0.96:** from the readout's own numbers I get about 0.98 (error × √(rays): 0.0047·√4.7 against 0.0033·√9.9).
- **10.0 vs 9.9:** the text's "10.0 rays" doesn't match the readouts' 9.9 or 9.8.
- **Line and piece styles:** "bold line" (Figure 2) is a thin red line, and "bold last piece" (Figure 1) is orange.
- **Caption vs axis:** Figure 2's caption says "0, 1, 2 … 40", but some caps have no bar.
- **Missing code:** "extra terms … for a coat" don't appear in the excerpt.
- **Small win or not:** "roulette is a small win" (§3) against "not paid for it" (§5). This isn't really a contradiction, but the page never says that one counts rays and the other counts time.
- **Energy conservation:** the code comment's phrase against the prose's "on average nothing is lost".

## 10. The five changes
1. **Explain rounds in plain words, with an analogy or small picture.** A bus that runs its whole route whether it carries 50 passengers or 2 would do. Then reconcile "small win in rays" with "no win in time", and define or drop "kernel launches", "flushed", "Pascal" and "the user".
2. **Show the 0.96 arithmetic:** cheaper paths mean more paths, and the error bar shrinks like 1/√paths. Make it match the readout numbers, and give 10.0 vs 9.9 one value.
3. **Fix Figure 2's wording:** say that one path's running total is read off at each bounce; say what the "average light" is and what cap 0 shows; call it the red line; mention the skipped caps.
4. **Trim or gloss the code:** cut the bounce comment, or gloss lobe/pdf/marching; say that `PRNG().x` is a random number in [0, 1); explain "the flat world"; remove "extra terms" or show them.
5. **Add a numeric roulette example** before the algebra, explain the 0.95 ceiling, and fix the "pdf" in the firefly card. Also say why the unfair comparison came out brighter, or that nobody knows.
