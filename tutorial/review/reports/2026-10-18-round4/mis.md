# Blank-reader report: "Two ways to the light" (ch/mis)

## 1. Teach-back
There are two ways to find out how much lamp light a shiny point sends to the camera. The first is to pick a point on a lamp and check it (NEE, "aiming"). The second is to bounce the way the surface reflects and see whether the bounce hits a lamp. Aiming is bad on near-mirror surfaces under a long lamp: almost every point you pick on the lamp falls outside the narrow band the mirror reflects. Bouncing is bad on rough surfaces under a tiny lamp, because a wide spread of bounces almost never hits it. MIS runs both and gives every result a weight. The two weights at any direction add up to 1, so no light is counted twice. The power heuristic squares the two "how likely" numbers, so whichever way was much more likely to find a direction gets nearly all of it. In ShadyTracer, one small function computes the weight. Shadow rays use it straight away, and bounce rays carry it with them until they hit a light. It goes wrong if one side has a density of 0 where the other side doesn't, or if the two sides use different versions of the material.

## 2. Quiz
1. Picking a lamp point does badly on sharp plates, worst under the long lamp: "a point picked anywhere on it is almost never in the narrow range of directions the plate reflects." Picking a direction does badly on rough plates under the tiny lamp, because "a direction drawn from a wide spread almost never meets it." The page taught this clearly.
2. MIS multiplies each sample by a weight taken at that sample's direction. The weights add up to 1, so on average the two together bring back each direction's light "once, exactly." The page taught this, in the fold-out. It did not quite teach *why this lowers noise*. I had to put that together myself, and that is partly *outside knowledge*.
3. Whichever density is higher at that direction, and the squaring pushes the weight further its way. Taught.
4. A ray refracted through glass towards the sun had a plate density of 0, because clear glass sends light in only one direction. Its lamp density was not 0, so its weight was 0²/(0²+p²) = 0, and the lamp strategy never produced that direction either. The sun through the glass was counted by nobody. I can recite this, but I can't picture which surface "above the surface" refers to (see §3).
5. MIS is only fair if both strategies use the same material. When they didn't, the brightness drifted with the share of shadow rays, from −1.2% to +0.5%. Taught, but *why* a strategy's weight grows with its share is only stated, never shown.

## 3. Where I got lost (worst first)
- **Figure 2, rough state.** The bottom plot shows the blue (plate) weight at 1 almost everywhere. The text says the opposite point: "the tiny lamp's light counts almost entirely through the lamp strategy (weight 0.99)." That 0.99 is a hair-thin orange spike I could barely see. Nothing says that weights where no lamp lies don't matter, because no light comes from there.
- **How weighting removes the streaks.** "An estimate is noisy where its p is small but the light is not" was clear. The next step is missing: the weak strategy's rare, huge find gets a weight near 0, so its spike disappears. Only the MIS *card* hints at this ("tames the bright specks").
- **The glass ball:** "A ray refracted out of glass towards the sun… although the lamp strategy only ever aims at directions above the surface." Above *which* surface, the floor or the glass? Where does the path start? I needed the path told step by step: camera, floor, shadow ray blocked by the ball, and so on.
- **The measured story:** "−1.2% with no shadow rays at all." With no shadow rays, only the real material is used, so wasn't *that* the right brightness? The page measures against 0.5 and never says which value was correct. "Each strategy's weight grows with how often it is used" needs one line saying that the share is a factor in the density (I only spotted that later, in pLout's caption).
- **"the comment above prevPdf", "the comment on delta events"**: these cite things I can't see.
- **"maybe many rounds later"**: rounds of what? Why would a flying ray take rounds? (*outside knowledge*: the GPU processes rays in batches.)

## 4. Words and symbols
- **Cards at first use:** MIS, shadow ray, pdf and bias are used in the text with no ° and only get cards in the end list. The intro's "shadow ray" and "Multiple importance sampling" have no card where they first appear.
- **Never explained:** "unbiased" (§4, no card at that spot); "error bar"; "Veach" (in the fold-out, before the reading box introduces him); "the sun's cone".
- **Code words:** "kernel", "emitter", "lobes", "env", "delta", "WGSL", "NaN".
- **`beta`:** "beta = 2" in misWeight and `res.r.beta` in the next excerpt are two different betas. The second is never explained (*outside knowledge*: it is the path's throughput).
- **N, θ:** "NoL is cos θ". N is never named, and θ is measured from what? "As in chapter 1" assumes I read chapter 1.
- **Units:** "per radian" sits beside an axis marked in degrees.
- **Cards that helped:** σ was well explained (with degree equivalents), and so was the log scale. The cards for glossy, BSDF, caustic and pdf were good. The pdf card's "½ for each metre" let me guess why a smaller-looking lamp has a taller box.

## 5. Figures
- **Figure 1** compares the three ways side by side. The lamp row, the strip-as-plate idea and the 8 → 256 readout (61/48/34% down to 13/12/6%) are clear.
  - The long-lamp streaks on the sharp plate are visible but faint.
  - At σ 0.6 the plate column is streaky everywhere, so "worst under the tiny lamp" was hard to see.
  - It never says that all three columns should end up as the *same* picture.
  - Is the error bar for the whole figure or for one strip?
  - "Each giving the same light in all" is an unclear phrase.
- **Figure 2:** the readouts match the plots (5.86 vs 0.66, then 1.01 vs 19.95).
  - The lamps' "hump" is drawn as a flat-topped box.
  - In the sharp shot the "long" label sits under the blue spike and "mirror direc" is cut off.
  - The both-0 region is explained; the plate-weight-1 region in the rough shot is not (see §3).
  - How does the lamp strategy choose *which* lamp?

## 6. Maths fold-outs
I could follow the weights-add-to-1 argument and the power-heuristic arithmetic (34.3/34.7 = 0.99). Three things got in the way:
- "Pick one direction… gives an estimate of that whole sum" leans entirely on chapter 12.
- "The plain ratio" is never written out. Showing 5.86/6.52 = 0.90 next to 0.99 would make "lean harder" concrete.
- The fold-out uses figure 2's numbers before figure 2 appears.

## 7. The code
- **misWeight:** clear.
- **Lamp side:** the caption maps pS, dS, f and fast well. Still opaque: `select(misWeight(pS,pB), 1.0, fast)`, whose argument order is the reverse of JS's `?:` (I only got it from the caption); `res.r.beta`; `neeMinAlpha`; "FAST MODES: the evaluable lobes"; "the occlusion kernel".
- **Plate side:** `(1.0 - lightFaceShare(...)) * (1.0 - emitShare())`: why "1 minus" twice? Also unexplained: `pOut`; `prevPdf` being −1; the "branched, not selected" comment. It is also unclear how the sun and sky here relate to the figure's lamps.

## 8. Too much, too little
- **Too little:** the noise mechanism, the glass-ball path, which brightness was right.
- **Too much for me:** the GPU detail in the code comments, and the hardware name and file path in §4.
- The third bullet of §5 just repeats §4.

## 9. Wrong or contradictory
- "Lamp strategy wins on rough plates" against a bottom plot that is mostly blue at 1 (§3).
- "Hump" against the boxes in the plot.
- The two different betas.
- "0 at 0.5 (the default, which the others are measured against)" while the no-shadow-ray picture sounds like the correct one.
- "the two stories below": the second one is about the *plate* density being wrong, not "a density that is not zero where it should be" on the lamp side. That phrase is also hard to parse.

## 10. Five changes
1. In figure 2, say that weights only matter where a lamp lies, and point at the orange spike under the tiny lamp. Or shade the no-lamp stretches grey.
2. Add one worked sentence on why MIS removes streaks: a rare find × weight ≈ 0, and the light comes in steadily through the other way. Include the plain ratio's 0.90 next to 0.99.
3. Tell the glass ball and glossy plastic stories step by step, with the path and what the picture looked like (dark? speckled?). Quote the cited comments or drop the references.
4. In the measured story, say which brightness was true. Show that the share multiplies the density, so a bigger share means a bigger weight.
5. Explain or trim the code identifiers (`beta`, `lobes`, `select`'s order, kernel, emitter, env, `pOut`, prevPdf −1). Put cards on MIS, shadow ray, pdf and unbiased where they are first used.
