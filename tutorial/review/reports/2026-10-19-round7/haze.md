# Blank-reader report: "Dust in the air" (ch. 20)

## 1. Teach-back
Dust scatters light, which is why you can see a sunbeam. The mean free path is how far a ray goes on average before it hits a speck, and the share that gets through a length L untouched is e^(−L/mfp), the transmittance. To simulate it you take a random u and compute t = −mfp·ln(1−u). That is where the ray meets a particle, and if it lands past the box the ray gets through. A ray that hits something carries on with its light times the albedo. A ray that gets through keeps all its light. At a particle the new direction comes from a phase function (Henyey–Greenstein). Its g sets the shape: 0 means every direction is equally likely, positive means mostly forwards, negative mostly backwards. g is also the average cosine of the turn. Random directions almost never hit the tiny sun, so every dust point also sends a shadow ray straight at it, dimmed by the dust on the way. The two ways are combined with "MIS". A white furnace must read exactly 1, but a camera that only sees sky also reads 1, so you need controls that must fail. ShadyTracer now draws the distance when a leg starts, because working it out afterwards from 400 m away was imprecise and put particles inside solids.

## 2. Quiz
1. It is the average distance before a ray meets a particle. A length L lets through e^(−L/mfp) (37% when L = mfp). Taught well.
2. t = −mfp × ln(1 − u), with u random in 0–1. After a hit the ray's weight is multiplied by the albedo. With no hit it is 1. I know these rules but not *why* they work: "is spread exactly as that curve says" and "not divided by anything" are only asserted.
3. g changes which way light tends to go: forwards, evenly or backwards. It is the average cosine of the turn. Taught well with figure 2.
4. A random direction has to leave through the window inside the sun's half degree, which almost never happens. Aiming at the sun adds a shadow ray from every dust point, weighted by the phase function and dimmed by the transmittance, and the beam gets about 3× brighter. *Why* MIS is needed is not taught.
5. A test that can't fail proves nothing. A camera seeing only sky reads 1 with no noise too. That is why the black disc (0.558) and the albedo-0.5 dust (0.447) have to come out below 1. Taught clearly.
6. Working back from the leg's end at 400 m, where "a 32-bit number's steps are 30 µm", put the start a few steps off. Particles just past a surface then ended up inside the solid, and the furnace lost 4×10⁻⁴. I follow the story, but "a number's steps" is *outside knowledge* (chapter 4).

## 3. Where I got lost (worst first)
- **"the flat world"** (sections 2 and 4, a button in figure 2). This is never explained. I guessed it means the 2D figures, but then the red shape in figure 2 is the 3D one drawn flat? And how are 3D directions placed "on a circle round the point"? The aside "In the flat world the sky is found only by leaving; ShadyTracer also aims at it from the air, so its pictures are noisy" lost me completely.
- **"weighs them by MIS (chapter 15)"** and **"with the phase function where a surface has its f cos θ"**. Both are opaque. I don't know why two ways of finding the sun can't just be added up.
- **"is not divided by anything, because the chance of not meeting one is the transmittance itself"**. Why would anyone divide? This needs *outside knowledge* of Monte Carlo weights. The easy idea is missing: 37% of rays get through carrying everything, so 37% of the light gets through.
- **"three times the 0.003 elsewhere"**. Is that the bounces-only beam (0.0033) or the other pixels in this picture?
- **The real test reads ~1000, the figure reads 1.** "every row read 1000.000244", "against no box (999.768)", and then "the controls 0.152 … and 0.4315". Are those last two fractions or readings? Why does no box read 999.768 and not 1000?
- **"leg"** is used in section 1 but only defined in a code caption in section 5. **"samples"** and **"±"** in section 3 are never explained.

## 4. Words and symbols
- Good cards: mean free path, transmittance, free flight, albedo, white furnace, and solid angle (which explains "per steradian").
- The phase-function card helps, but it brings in "BSDF" without explaining it.
- Never explained: leg (until section 5), march (circles, "chapter 2"), sample, shadow ray, MIS, f cos θ, delta, flat world, kernel, σ_s (only σ_t is defined, in a card), radiance, r.beta, heavy tail, power heuristic, "Pascal card", "the bench", Draft/Sketch.
- e and ln are assumed. The "37%" helps.

## 5. Figures
- **Fig 1 (thin/thick):** clear. Arrows get through, dots stop, and the chart counts match the text (1453 vs 1472, 9 vs 13). What puzzled me: why does the number of rays meeting a particle *at* t follow the chance of being *untouched* to t? One sentence would fix it.
- **Fig 1 (march):** confusing. Which shape is "a stone": the bold circle or the long bar? The caption says the step that passed the particle is red, but I only see a blue arrow and a red dot. The label "met a particle: moved back here…" sits far from the dot, over the circles. In "inside the box from 1.00", from 1.00 what?
- **Fig 2:** works well. The shape squashes forwards or backwards, the chart moves and the mean cosine matches g. The text explains the 90° peak only for g = 0. At g = 0.7 the peak sits at about 15°, not 0°, and I had to work out myself that this is the same sphere effect. At g = −0.5 the red shape covers the "light arriving" label.
- **Fig 3:** the room drawing is clear. Problems:
  - The text says the shadow rays to the sun are "in grey", but in the screenshots almost all of them are red (blocked). I never see one that reaches the sun.
  - The "across the beam" label sits to the right of the red bracket.
  - The text says the patch has "two pixels", but I see one white pixel.
  - I couldn't find the 0.23 ceiling pixel.
  - The floor reads 0.0230 in "bounces only" and 0.0351 in "aim". Why does aiming from the air change the floor? Nothing says.
- **Fig 4:** clear, and the eye turned to the sky makes the point well. Oddly, the black disc is drawn as a *red* dotted circle.

## 6. Maths fold-outs
- I can plug numbers in. I checked that u = 0 gives cos θ = −1 and u = 1 gives +1.
- "^3/2" is ambiguous: is it (…)^(3/2) or (…)³/2?
- The formula divides by g, but the case g = 0 is never mentioned (the code handles it with c = 1 − 2u).
- "adds up to 1 over the sphere" and "the inverse of its distribution" need calculus.
- The flat world's tan(π(u−½)) is opaque.
- Free flight could have a fold-out in plain algebra: set e^(−t/mfp) = 1 − u and solve for t. I could follow that.

## 7. The code
- **hgSample:** I matched the s and c lines to the fold-out. b1, b2, cross and normalize (lines 233–237) stay opaque: I know vectors with x and y, not cross products.
- **hazeDraw:** line 204 matches the formula only if I notice that UB.hazeC.w is σ_t = 1/mfp, and nothing says so. Other unexplained parts:
  - absLtot
  - why it multiplies by r.n (in air n = 1, so the page could just say "ignore it")
  - hazeSpan's s.x and s.y (I think they are where the leg enters and leaves the box)
  - the TAG and `&` tests
  - 1e-30

  The "WHY AT THE START" comment repeats section 7 with more jargon.
- **hazeAt:** readable. It moves back by the overshoot, ltot − tmax.
- **The light-sampling excerpt:** it is cited as "haze.js:258" but shows lines 326–328. The caption explains dS as "what it is divided by", which says nothing.
- **hazeShadow:** hazeTr is clearly the transmittance, but `2.0 * envRadius + length(P)` is a mystery.

## 8. Too much, too little
- Too much: section 5's long comments, the version numbers, and section 6's measured percentages, which I can't judge as good or bad.
- Too little: why free flight works, why the weight is 1, what MIS is for, and how the 3D directions are drawn in 2D.

## 9. Wrong or contradictory
- Shadow rays "in grey" vs the screenshots, where they are red.
- "three times the 0.003 elsewhere": ambiguous.
- The sky is 1 in the figure but readings near 1000 in ShadyTracer's test. The controls (0.152 and 0.4315) look like they are on a different scale.
- Section 4 says ShadyTracer's furnace is noisy, yet the broken test read "noise 0". That was itself a clue, and the page never says so.
- The citation :258 doesn't match the lines 326–328 shown.
- The fold-out's ^3/2.

## 10. Five changes
1. Explain free flight and its weight in plain algebra: solve e^(−t/mfp) = 1 − u, and "37% get through carrying everything = 37% of the light". Drop "not divided by anything", or explain it.
2. Say what "the flat world" is the first time it appears. Also give leg, sample, ± and MIS one line each or a card.
3. Fix figure 3:
   - show a grey shadow ray that reaches the sun
   - line up the "across the beam" label with its bracket
   - reword "the 0.003 elsewhere"
   - say why the floor changes between modes
4. Make the furnace scales consistent: say the real test's sky is 1000 and put the controls on the same scale. Point out that "noise 0" should have looked suspicious.
5. Annotate the code: hazeC.w = σ_t, ignore r.n in air, what absLtot is, one line on b1/b2. Fix the :258 citation and the ^(3/2), and add the g = 0 case to the fold-out.
