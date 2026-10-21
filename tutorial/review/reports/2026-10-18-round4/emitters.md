# Beginner review: "Every glowing thing is a light" (ch. 16)

## 1. Teach-back
Any shape can glow, not just the lamps you place. The renderer doesn't know where the glowing shapes are, so it waits for its ordinary bouncing paths to bump into them. When a path hits a glow, it notes which cell of a coarse grid the hit was in. It also stretches a box around all the hits in that cell and remembers the brightest glow seen there. Between samples, each cell with hits becomes a box with a sphere around it, and the renderer starts aiming shadow rays into those spheres the way it aims at a lamp. Bright, large boxes get picked more often. Before a glow is found, nothing aims at it, so a path that hits it by luck counts in full. Because of that the picture is right from the start, just noisier. To send light *out* of a shape it only knows by distance, it shoots random lines through the sphere. Where a line crosses the glowing surface, it starts a photon. The crossings come out evenly spread over the surface, and their angles follow the cosine (Lambert). The brightness has to be stored as a whole number so the GPU can keep the biggest with atomicMax. The old linear code stopped at 100,000, so the log code gives every doubling the same number of steps.

## 2. Quiz
1. Camera paths hit a glow. Each hit records its cell (16×16×16), grows that cell's box, and keeps the max brightness. Between samples, cells become boxes with spheres, get a score, and are listed (64 at most), then aimed at.
2. Under MIS the hit's weight is p_plate²/(p_plate²+p_lamp²). With p_lamp = 0 the weight is 1, so the hit counts fully. Once the glow is listed, the light is split between the two ways, and either way it is counted once. *I took this on trust:* the page never says what p_plate is.
3. Pick random lines through the sphere around a found box (random direction, random offset). March along each one, and where it crosses a glowing surface, start a photon leaving along the line. Crossings land evenly per unit of surface with cosine-shaped angles (Crofton). Each photon's brightness is divided by the line density, which needs only the spheres. Not taught: which way along the line the photon goes, and what happens when a line crosses a surface that isn't glowing.
4. atomicMax works on whole numbers whose order must match the brightness's order. The old code was brightness×16, capped at 100,000. Everything above the cap ranked equal (a 20,000 panel was fine, but the sun in a mirror at 1.6e9 ranked with it), and anything under 1/16 became 0, which means "never seen". The log code gives each doubling 209,715 codes across 2⁻⁴⁰..2⁴⁰. **The page never says what a logarithm is.** I connected "log2" with "counts doublings" only because I already knew it (*outside knowledge*).

## 3. Where I got lost (worst first)
- **"p_plate² / (p_plate² + p_lamp²)"** (§1). "p_plate" is never defined, and "density" is used here but only explained in §4. Q2 rests on this sentence. I understood it only from outside knowledge (it's the bounce's probability).
- **Fold-out: "|cos φ| over a half turn adds up to 2"** and **"|n·ω| dA dω / (4π²r²)"**. Adding up over infinitely many angles is calculus. The dA, dω and n·ω notation is never introduced.
- **"In the log code, multiplying by 0.9 is subtracting a fixed number of codes."** This needs log(ab) = log a + log b (*outside knowledge*).
- **Fig 1, one sample:** the text says "A cell with hits (shaded) becomes a target for aiming: the dashed circle". In the screenshot the bar's cells are shaded but have no circles, and then "After 8 samples both are listed". So is "hit" the same as "listed"? Unexplained.
- **"the cone its sphere fills as seen from the point"** and the code's `dot(dir, dc) >= (1.0 - omc) * sqrt(d2)`. This tests an angle through a dot product. The page never says dot = |a||b|cos.
- **"marching along a ray"**, **"thread of the GPU"**, **"32-bit float"**: each assumed.
- **§6 "Two estimates of two things… share of shadow rays"**: opaque without chapter 15.

## 4. Words and symbols
- **Cards that helped:** MIS, NEE, unbiased, normal, caustic, photon.
- **The MIS card** doesn't define p_plate or p_lamp.
- **Unexplained, no card:** density, sample ("one sample of 48 paths"?), log/log2/exp2, thread, float, WGSL, kernel, voxel, u32, Le, EG, EV_BASE, `learn`, probe, "mixture", "(y, w)", "less its cos".
- **Explained inline:** "stop" (well), solid angle (very well), Lambert's law.
- **"bar"** means three things: the glowing bar in fig 1, the shape "bar" in fig 2, and the histogram bars ("point at a bar to read it").
- **"box"** means both the hit box and fig 2's rectangle.
- **"card"** in §5 ("names no card for that run") means a graphics card, which clashes with the word cards. "the user's NVIDIA Ampere": which user?

## 5. Figures
- **Fig 1 (room, ball, bar).**
  - Shows hits accumulating into cells and circles. The readouts match the text (28/2, then 1861/120).
  - Problems:
    - I could not find "the small rectangles" (tight boxes) anywhere.
    - The short orange dashes beside the bar are never explained.
    - The dashed grid is hard to tell apart from the graph-paper background.
    - The shaded-but-uncircled cells at one sample (see §3).
    - At 64 samples the bar's lowest shaded cell has no circle.
- **Fig 2 (random lines).**
  - The point comes across: the readout matches length/(πR), and at 40,000 lines the histogram sits right on the cosine dots.
  - Problems:
    - The 40,000-line screenshot draws the same ~40 lines as the 40-line one, and nobody says only a few are drawn.
    - The chart title is cut off ("from the norma").
    - Shape "bar" and histogram "bars" clash.
- **Fig 3 (codes).**
  - The straight blue line against the red cliff makes the point instantly, and the readout (1,600 against 9,781,926) checks out.
  - Problems:
    - The labels overlap: "a dark night, abo**lit** page about" is unreadable, and the "about…" values are missing.
    - "the sun in a mirror" sits beside the bright-panel line near 1e4, not the dashed line near 1e9.

## 6. Maths fold-out
I followed the θ ∈ [0, π) choice and why π. I followed the shadow width |cos φ| ds. I could not follow "range π × 2R" (a range of what?), "adds up to 2" (needs integration) or "spread as ½ cos φ". The 3D density line is pure notation to me. The final formula ℓ/(πR) I accepted, and checked it against the readout (2.83/2π × 40,000 ≈ 18,000).

## 7. The code
- **emitDeposit.** The caption helps a lot: the 8 numbers per cell, the 0.2126 weights, the early return.
  - Still opaque: `cell = v.x + EG * (v.y + EG * v.z)` (turning 3D into one index is never explained), what EG and `learn` are, and `&`.
- **LUM_CODE.** The caption explains the +1 and the decay. The +40 I inferred.
  - Still opaque: `select(0.0, exp2(...), q > 0u)`. The argument order is unclear and exp2 is never named.
- **emitConePdf.** The caption ("add the box's chance divided by…") helps.
  - Never said: *why* the densities of all boxes are **added**.
  - Opaque: what `coneOneMinusCos` computes.
  - I couldn't tell `emitF(b, 3u)` is the radius until I guessed from `r`.
- **emitLineDensity.** The sentence "what is picked often counts for little" is good.
  - Never said: why only boxes whose sphere *contains* y count.

## 8. Too much, too little
- **§1's first paragraph** packs grid, box, brightest glow, target and circle into one sentence.
- **The MIS paragraph** is rushed: it carries the chapter's key claim on undefined symbols.
- **§3** is clear and well paced. It's the best part.
- **§5–6** lean on internal documents ("roadmap/PLAN.md, second run", "the comment above the collect kernel", "materials_pbr.js:754") that a reader can't see. Two of the §6 bullets need chapters 15, 18 and 19.

## 9. Wrong or contradictory
- **"Shaded… becomes a target"** against the uncircled shaded bar cells at one sample, with the bar listed only "after 8 samples".
- **The comment's "2e-5 of a stop"** is correctly flagged as wrong. Even so, the excerpt still teaches the wrong number for anyone who skips the stamp.
- **"as many from each part as it gives off"** (§2) against crossings "spread evenly over every surface". How do brighter parts send more? Not reconciled.
- **"0.6% too bright"** for light "counted twice" sounds small. It isn't said that this is because it's a small part of the picture.
- **Fig 3's sun label** is misplaced.

## 10. The five changes
1. **Define p_plate, p_lamp and "density" in §1** with one plain sentence (the chance that the bounce, or the aiming, picks this direction). Q2 depends on it.
2. **Add one sentence on logarithms**: log₂x is how many doublings from 1, so multiplying adds codes. That answers "why a logarithm" and makes LUM_DECAY readable.
3. **Fix fig 1's story.**
   - Say why a hit cell isn't yet a circled target after one sample.
   - Make the tight boxes visible and labelled, and explain the dashes on the bar.
   - Make the dashed grid stand out from the graph paper.
4. **Make the fold-out calculus-free.** For example: "the average of |cos| over a half turn is 2/π, times π angles = 2", shown with a small plot. Mark the 3D notation as "for later".
5. **Clean up the figures and names.**
   - Rename fig 2's "bar" shape.
   - Say only some lines are drawn.
   - Fix fig 3's overlapping and misplaced labels.
   - In the code captions, explain the 3D-to-1D index, the dot-product cone test, and why boxes' densities add. Gloss WGSL, u32 and kernel.
