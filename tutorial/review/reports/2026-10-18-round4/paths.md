# Beginner read: "Following a path" (Chapter 13)

## 1. Teach-back
A path tracer starts at the eye and follows one random zig-zag route. Every time the route hits a surface it bounces off in a random direction, until it happens to hit the lamp. It carries one number, β (the throughput). β starts at 1 and gets multiplied by the wall's albedo at each bounce, so with 0.8 walls it goes 1, 0.8, 0.64, 0.51, 0.41. When the route reaches the lamp, it brings back β times the lamp's brightness, and the pixel is the average of many routes. You have to stop routes somewhere. A fixed cap on bounces throws away the light that would have arrived later, which makes the picture too dark for good, not just noisy. That is a "bias", and it is worst in white rooms. Russian roulette stops weak routes at random, and the survivors get boosted (divided by p), so on average nothing is lost. If you leave out the boost, the picture gets darker. In ShadyTracer roulette is proven fair but stays off, because the GPU works in "rounds" that cost the same time however few paths are left. An old 6–8% brightening turned out to come from comparing two runs that were not given the same work.

## 2. Quiz
1. **Throughput** is the share of the light found further on that still gets back to the eye. It starts at 1 and is multiplied at each bounce by what the surface passes on: the albedo for matte, f cos θ / p in general.
2. **A cap** loses all the light found after it, so the picture is darker, and more samples cannot fix that. In a white room each bounce passes on 95%, so a lot of the light arrives late: a cap of 3 keeps only 46%. Why a *corner* is also worse, the page does not explain.
3. **Russian roulette:** after bounce 3, a path continues with p = β, kept between 0.1 and 0.95. Survivors divide β by p, so the average is p·X/p = X.
4. **Why it stays off:** all paths move together in rounds of five kernels, and a round costs time even with few paths. Roulette measured +0.9% time per sample. Since 0.10.0 every sample also gets a fixed number of rounds, so roulette can never save a whole round. I could repeat this, but I only half understood it (see 3).
5. **The 6–8% brightening:** switching roulette on once made the picture 6–8% brighter. That happened because the renderer adapted how many rounds a sample got, so the two runs did different work. With that pinned off, all four runs agreed within 0.15%. Lesson: change one thing at a time. *Why* it came out brighter, the page admits nobody knows.

## 3. Where I got lost (worst first)
- **Section 5, "The rounds no longer shrink… roulette can save only the work inside each round, never a round."** I never learned why rounds *would* shrink. That is only explained in section 6 ("the renderer then adapted how many rounds"). "Plus its marching" is unexplained here. The bus analogy says a near-empty round costs the full time, so what "work inside each round" is left to save?
- **"it cut the rays still going when the last round ended them from 1416 to 360"**: I could not parse this sentence.
- **Figure 3, unfair mode.** The readout says "on's error bar is 0.73× off's", which by the page's own scale ("0.68… a clear win") looks like a *win* for a wrong method. Nothing says that an error bar cannot show bias. The next sentences ("In a dark room (0.5)… 0.68… white… 1.60") come straight after "switch off Survivors divide", so are those numbers fair or unfair?
- **Why the blue curve changes shape** between the two screenshots: a slow tail when survivors divide, gone by about bounce 8 when they don't. *Outside knowledge:* I worked out that with p = β a survivor's β becomes exactly 1 again. The page never says so. That fact also answers the fold-out's puzzle "a path whose β is 1 or more": how can β ever be over 1 if each bounce multiplies by less than 1?
- **"reads each path's running total"** (section 2): section 1 had a "running product". Are these the same thing? (No: one is β, the other the light gathered.)
- **"Why the unequal work came out brighter rather than darker, neither… says."** I expected fewer rounds to mean darker, like a cap, and I am left with that hole.
- **"Four runs on the user's graphics card"**: which user? Me?

## 4. Words and symbols
- **Before they were explained, or never:** probability density, BSDF, radiance, L_e, ρ (just "albedo ρ"), "rendering equation", ∏ (explained *after* the formula), θ (measured from what?), "film", "sample" ("299 samples", "no number of samples"), error bar and ±, `[0, 1)`, WGSL, lobes, microfacet, pdf, F G2/G1, "RR", wavefront, adaptive iteration budget, trimmedLuma, dispatches, "rays flushed", "Pascal", "pinned off", "inside the noise". In the readout, "0.80^4": in JavaScript `^` is XOR.
- **The cards:** albedo, throughput, bias and Russian roulette helped and were clear. The firefly card brings in "probability density, the pdf", which is no help to me. The kernel card says a sample is "a dozen kernels", while the text says "five kernels" *per round*, with many rounds per sample. The two do not agree.

## 5. Figures
- **Fig 1:** clear. Five pieces, red bounce dots, β on each piece, the orange last piece. I could check 0.8 → 0.64 → 0.51 → 0.41. Two small problems:
  - The readout "brings back β × the lamp's brightness, 1 = 0.410" reads as "1 = 0.410".
  - The box in the middle of the room is never mentioned.
- **Fig 2:** makes its point well. The white room's bars climb more slowly, and the readouts match the text.
  - The two screenshots autoscale (0.40 versus 0.80), so I did not notice that the white room is twice as bright overall.
  - The error bars are invisible.
  - Is the cap-40 line the true answer? 0.95^40 ≈ 0.13, so a path in the white room still carries something after 40 bounces.
- **Fig 3:** the spike at the dashed line makes "roulette ends paths early" obvious.
  - The toggle's on and off states (filled versus outlined) are easy to miss.
  - The off line looks dark slate rather than "grey".
  - "24,000" in the text: is that each or total? The readout says "paths each".

## 6. Maths fold-outs
- **"Why nothing is lost":** yes. It is a weighted average, and that is school probability. The floor (at most 10×) and the ceiling arguments were clear once I knew how β can reach 1.
- **"The path's estimate":** no.
  - "Probability density", "radiance" and "BSDF" are new to me.
  - "f cos θ and p cancel all but the albedo" is only asserted. I accept it only through *outside knowledge* (f = ρ/π, p = cos θ/π).
  - "the rendering equation, solved one random path at a time" means nothing to me.

## 7. The code
- **First excerpt:** the annotation is good. Three lines: pick a direction, set it, multiply β by the weight. The 5-line comment is opaque (microfacet, grazing views, F G2/G1). The fact that β is suddenly *three* numbers surprised me, though the annotation covers it.
- **Second excerpt:** the cap `if` and the last eight lines are readable thanks to the annotation. The ~40-line comment between them is a wall of jargon. It also tells the 6–8% story that sections 5 and 6 tell again. A small question: `bounces > UB.maxbounce` means a cap of 10 stops after 11 hits?

## 8. Too much, too little
- **Too much:** the brightening story appears three times (the code comment, section 5, section 6). Section 3's second paragraph is a dense run of numbers, though I could follow it.
- **Too little:**
  - that β resets to about 1 after surviving;
  - why roulette *loses* in a white room ("a path stopped early would still have brought back a lot", but p follows β there, so few are stopped?);
  - why corners collect more bounces;
  - what a "round" is, before it is needed.

## 9. Wrong or contradictory
- The kernel card's "a dozen kernels" per sample against "five kernels" per round.
- The unfair readout presents 0.73× as if it were good.
- Try it: "find a path that bounces more than ten times", but figure 1's bounce limit is 8. Nobody tells me to raise it first.
- In the bus analogy a near-empty round still costs the full time, yet roulette "can save only the work inside each round".

## 10. The five changes
1. **Explain rounds before section 5.** All paths move together, one round at a time. Rounds used to adapt and are now fixed at Max Bounces + 1 plus marching. Then say plainly what roulette could still save. Split the 1416→360 sentence.
2. **Say that a survivor's β becomes 1** (with p = β). Use it to explain figure 3's tail, the steeper unfair curve, and the 0.95 ceiling.
3. **In the unfair paragraph and readout, warn that an error bar cannot see bias.** Mark the dark and white numbers as fair-mode.
4. **Fold-out 1:**
   - define ∏ first;
   - say what θ is measured from;
   - define L_e and ρ;
   - give f = ρ/π and p = cos θ/π so the cancellation can be checked, or drop the rendering-equation line.
5. **Gloss or trim the second code comment** (RR, wavefront, budget, trimmedLuma, dispatches, flushed). Also fix:
   - "the user's graphics card";
   - the kernel card's count;
   - the Try-it's bounce limit.
