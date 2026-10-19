# Blank reader: Chapter 19, Photon mapping

## 1. Teach-back
A caustic is light that glass focuses onto a floor. Seen through a second pane, the camera finds it only by lucky bounces, so the pixels are very noisy. A photon map fixes this. Each sample first sends photons from the sun and stores the ones that went through glass or a mirror where they land on a matte surface. Then a camera path that has met only glass adds up the stored photons within a radius r of where it lands. A big r blurs the caustic (bias, which more samples don't fix), and a small r is sharp but noisy. Shrinking r every sample makes the average creep up to the true value, and α sets how fast. Cells 2r wide, kept in a hash table of lists, mean a gather checks only two cells (eight in 3D). When a cell is overfull, the gather walks only some random sub-lists and counts each find extra, so it is still right on average.

## 2. Quiz
1. **What is stored and when it is gathered.** Stored: photons that "passed glass or a mirror", where they land "on a surface that scatters". Each keeps its position, its light and which way the surface faces. A camera path gathers when it lands having "met only glass since the eye".
2. **Large and small r.** A large r averages over 2r of floor and spreads the peak (pixel 25 drops from 0.72 to 0.48), and this stays however many samples are taken. A small r finds "a photon or two", so the error bar roughly doubles.
3. **Fixed and shrinking radius.** A fixed r gives "every sample … the same blur", so the average settles on the blurred 0.623, not 0.938. With a shrinking r, the early blur's "share falls towards nothing". The fold-out says the noise falls as k^(−α), but I took the *why* on trust.
4. **Two cells, eight in 3D.** The stretch is 2r, as wide as a cell, so it overlaps its own cell and one neighbour. The page says "two on each axis, eight", and I worked out 2×2×2 myself.
5. **Collisions.** A collision is two cells whose hash picks the same list. A record keeps its position and counts "only on the visit to its own cell, and only within r", so a list walked twice is counted once.
6. **Walking only some sub-lists.** A record is on one of 32 random sub-lists, and a gather walks m of them with weight 32/m. A record is walked in m of the 32 starts, so on average m/32 × 32/m = 1. I did that last step myself.

## 3. Where I got lost (worst first)
- **Section 4's WGSL.** In `(r.bounces + 1u) | (sub << SPPM_SUB_SHIFT) | select(0u, SPPM_ALL, sppmUnmet(r))` and `lobesEval(lb, …)`, the names SPPM_ALL, sppmUnmet, lb, bc, rad, sppmCtl.y and hard are never explained.
- **The n² excerpt.** It opens on absorption ("absorbAlong… rayTransmittance… manifold connection"). Its note says "n² times the radiance", but radiance is undefined and no reason is given.
- **The recap.** "a lucky find counts for a lot (85 here, the sun's own brightness), because a path's light is divided by the chance of finding it". Which is the reason? I followed it only with *outside knowledge* of Monte Carlo weighting. "every kind of path exactly one owner" is vague.
- **The hash parenthesis.** "32-bit whole number without a sign… wraps round… power of two… last bits". It also never says how a 3D cell becomes one "cell's number".
- **Section 6.** "a floor set for alpha, roughness squared", "a delta to the BSDF" and "path class" are opaque.

## 4. Words and symbols
- **Cards that helped:** bias, consistent, hash table, photon, caustic, gather.
- **Cards with gaps:** atomic operation has a card, but thread doesn't.
- **Undefined, needing *outside knowledge*:** ρ, L, f (later "BSDF", also undefined), light tracing, throughput, radiance, delta event, evaluable lobe, kernel, trace (versus sample and `frames`), WebGPU/Dawn, dichroics, "Light piled into a line", Russian roulette, PRNG, and `mod` (in the figure; the text says "remainder").
- ∝ and variance are defined in fold-out 2, which helps.

## 5. Figures
- **Fig 1:** the scene and the eye's strip. The white pixel near 25 appearing with the map, and the circles growing at r = 0.4, are both visible. Problems:
  - The screenshots read 158 to 181 samples ("0.252 ± 0.066"), but the text quotes 300-sample values ("0.324 ± 0.060", "0.366 ± 0.003").
  - Pixel values need hovering, so I can't check them.
  - The gather is drawn as circles, while the maths uses a 2r stretch.
- **Fig 2:** clear: red settles under the dashed line, and blue climbs (overshooting in *fast*). The axis is logarithmic, which is never said, and its label "1, 10, 100 and 300: each step ten times as many" doesn't hold for 300.
- **Fig 3:** the key makes *walk* and *collide* readable, and the top lines in *budget* spell out m and 32/m. Faint orange ("not walked") and orange ("farther than r") are hard to tell apart.

## 6. Maths fold-outs
- **Fold-out 1:** I could follow the sum of Φ over 2r (or πr²). Three things are unexplained: the "/2", ρ, and why "in 3D f depends on the direction" when the flat matte floor doesn't.
- **Fold-out 2:** the table checks out (0.51² ≈ 0.26, 1000^(−1/3) = 1/10). Three steps are only asserted: "behaves like a power", "a count's spread is its square root" (*outside knowledge*: Poisson) and "grows as r²".
  - The algebra to "variance ∝ 1/r_k" is skipped.
  - "Averaged over k samples it still falls, as k^(−α)" goes beyond the only rule given ("samples of equal variance"), because these variances differ.

## 7. Code
- **`sppmRadius`:** clear. The loop is the product, and the square root makes the area shrink.
- **`sppmGeomFor`:** its note is clear, but `+u?.camLens?.[1] || 1` and `k | 0` are opaque to a school JavaScript programmer.
- **`sppmStore`:** the note on the atomics is good, but the bit-packing stays opaque.
- **The gather loop:** the note's list of `continue`s helps, but the variable names don't.

## 8. Too much, too little
- **Too much:** section 4, and sections 5 and 6, which lean on six other chapters.
- **Too little:**
  - the recap and the hash arithmetic;
  - why a cell is 2r wide;
  - that the m sub-lists are consecutive and wrap round, which I learned only from `(start + j) % SPPM_SUBS`.

## 9. Wrong or contradictory
- The screenshots' numbers don't match the text's (see 5), and fig 2's "300" label is wrong.
- Section 3 says "hashCell, read in code", but the code calls `sppmHash`. Are they the same?
- The text says "each list counts its records", while the comment says "the cell's records are counted".
- In section 5's table (flattened in my copy), "the exact map, run again" gives 0.894 of itself. Without an explanation, that undermines "within the spread".

## 10. Five changes
1. **Make section 4 readable without WGSL.** Give a plain store and gather outline first, a gloss for every name the shown lines use, and a reason for n² (or move that excerpt out).
2. **Match the screenshots to the text.** Retake them at 300 samples, or say the figure keeps sampling.
3. **Fill in fold-out 2.** Show the noise algebra (count N·2r, spread √(N·2r), ÷2r, squared) and the average of unequal variances. Add one line on why blur ∝ r².
4. **Fix the "85" sentence and add cards** for light tracing, f/ρ/BSDF, radiance, throughput, thread, kernel and trace.
5. **Add a worked hash example** with a negative cell and a 3D cell made one number. State 2×2×2 = 8, use one name for the hash function, and fix fig 2's axis label.
