# Blank reader: ch/measure.html ("Measure first")

## 1. Teach-back

Before speeding a program up, find out where the time goes. Someone guessed one slow scene showed the whole design was slow. Other scenes ran several times faster on the same card, and timing that scene with and without its "reliefs" showed the reliefs were the cost. So the project made a rule: mark every claim *measured*, *read in code* or *inferred*. To see where time goes, the card writes its clock reading when each kernel starts and ends, and the readings are added up per kernel. Time between kernels is the "gap". Wall clock also counts what happens outside the card. Browsers round timestamps, so one short kernel can read 0, but totals over many come out about right. The same code can read up to 38% differently between runs because the card's speed drifts. To compare two versions, alternate them (A, B, A, B) in one run. Every number carries the version, the revision, the card and a fingerprint of the code.

## 2. Quiz

1. **Why the plan was wrong:** it called the Noise library's 736.5 ms "this architecture's cost". But "a cost of the architecture would be paid by every scene", and the other scenes took 61.8–177.2 ms. The scene's own rows showed the real cause: 81.1 ms without reliefs (Surface materials took 80.0), plus 72–91 ms for each relief alone.
2. **Timing each kernel:** each kernel run gets its own compute pass. The card writes a nanosecond timestamp at each pass's start and end into a "query set". After the last submit these are copied out and read. End minus start is summed by kernel name (`tally`). This needs `timestamp-query`. I could not explain "query set", "descriptor" or "mappable".
3. **The gap and wall clock:** the gap is the part of the span (first start to last end) that no pass covers, here 0.4 ms of 88. It is the cost of launching kernel after kernel, and it grows with the number of dispatches. Wall clock is how long the program waits, so it adds everything outside the card (1.5 ms + 2.35 ms per iteration).
4. **Rounding:** one short pass reads 0 or one tick (0.1 ms), "which no single pass took". Big kernels' sums stay close: march 44.6 vs 44.3. Small ones come out right only on average, over more passes than a sample has. **Why** it averages out is not taught. I supplied it from *outside knowledge*: a tick boundary falls inside a pass with a probability matching its length.
5. **Different readings and comparing versions:** the card's speed moves, perhaps from heat, power state or other work (inferred), by up to 38% in an evening. To compare, interleave A, B, A, B in one run, repeat a row as a drift check, use medians, and use the fingerprint to know which code ran.

## 3. Where I got lost (worst first)

- **"ms a sample"** appears all through section 1. "Sample" is defined only inside the *kernel* card ("one try at the whole picture"), which first appears in section 2. Why would a picture be tried more than once? That is *outside knowledge*.
- **"124 of the 194 passes read 0 and a few read 0.1 ms."** How does rounding turn 4 µs into 0.1 ms? The page never says that start and end are rounded separately.
- **Kernel names** (genrays, march, surface, shade, occlude, prep, flip, resolve) are never explained. "march", "shadow ray" and "every step near a surface" make sense to me only from *outside knowledge*.
- **"the flat world's counts"**, **"chapter 22's room"**, **"the drained tail"**, **"maxiter 128"**, **"adaptive budget"**: all assume earlier chapters.
- **"a tenth of a millisecond each over 24 passes"**: per pass, or in total? **"prep_occlude 0.2"**: is that what it reads, or what it took?
- **Spread:** ±20%, "9.3% of their mean", "16%" and 38% are four undefined measures, as is "points".
- **"Pascal card" vs "GTX 1080 Ti"**: I know they are the same card only from *outside knowledge*.

## 4. Words and symbols

- **kernel°**: helps, and quietly defines "sample" and "round".
- **timestamp°, drift°, benchmark°**: help.
- **GPU°**: helps, but the text says "the card" everywhere and never ties the two together.
- **The stamp cards**: clear. The *measured* card is the only place I learn the user's two cards.
- **compute pass**: defined only in the section 4 code annotation, after figure 2 has used it.
- **Never defined:** dispatch, WebGPU, iteration (the card calls it "round"), git revision, hash/xor, governor/pacing/queue, softbox, photon map, compile, cache, uniform, barrier, "draws".

## 5. Figures

- **Figure 1:**
  - **fig-1-scenes.png shows the same state as fig-1-one.png**: "One scene" is still selected, with one bar. So I never saw 61.8–177.2, or which scene is "the demo, 7.7 times faster".
  - The red note is cut off on the right.
  - In the reliefs view, the meaning of "only relief 1 mm / 10 mm" is never given.
  - The relief rows use the "sun's colour", which the caption reserves for "other scenes".
- **Figure 2:**
  - In the kernels view, grey means "the model's own times" and also occlude.
  - The iterations view has no colour legend.
  - The rounded view's red outlines work, but nothing shows which passes read 0.1.
- **Figure 3:**
  - **fig-3-readings.png is byte-identical to fig-3-separate.png**, so the step shows nothing new.
  - The axis is negative for "B faster", and nothing says so. I had to work it out from the "truth" line at −10%.
  - The dashed line at 0 has no label.
  - The readout counts "more than 5 points" while the text says "within 2 points", so I can't check the 37.

## 6. Maths fold-outs

There are none. The arithmetic I checked agrees with the figures (march about half, 255.5/184.7 ≈ 1.38, 40 − 32 = 8).

## 7. The code

- **CLAUDE.md:** clear.
- **kerneltime.js 2–21:** the "WHAT IT IS NOT" list is clear. Lines 9–12 stay opaque (R.trace, "beginCompute chain", descriptor, query set, resolved, mappable).
- **tally:** readable as JavaScript, and the annotation explains BigInt. `overflow` is unexplained, and so is why `b > a` is checked.
- **bench/index.js:** the clearest excerpt. "schema default" and "UNCACHED COMPILE" stay opaque.
- **Fingerprint:** its purpose is clear. `h ^=`, `Math.imul`, `>>> 0`, `0x811c9dc5`, `?.` and the `prog_wvf…` names stay opaque.

## 8. Too much, too little

- The opening paragraph tries to cover the whole chapter at once.
- The rounding paragraph is the densest on the page and lacks its key idea.
- Section 6 is rushed: six stories, a line each, full of file:line references and new words.
- Section 1 is well paced.

## 9. Wrong or contradictory

- **The reliefs don't add up.** 81.1 + six × (72–91) ≈ 565 ms, not 736.5. The missing ~170 ms is never explained.
- **"Chrome documents 100 µs"** but "the user's run read multiples of 32.768 µs". Which browser was it, and why did it differ?
- The text says the gap is "0.4 ms of 88". The rounded readout says "gaps 0.20 ms", and the page never says that rounding moves the gap too.
- The code lists "free" under WHAT IT IS NOT, while section 5 says "cost nothing visible". This can be reconciled (−7%…+6% is within the drift), but the page doesn't do it.

## 10. The five changes

1. **Define "sample"** in section 1's text (one noisy try at the picture, averaged with many), before the first "ms a sample".
2. **Show why rounding averages out:** a short pass reads one tick when a tick boundary falls inside it, with probability length ÷ tick. Add a small drawing.
3. **One line per kernel name**, plus "compute pass" and "dispatch", before figure 2.
4. **Fix the figures:**
   - make the "Every scene" and "readings" steps actually change the figure;
   - label figure 3's axis ("left: B faster");
   - give grey one meaning and add a legend to the iteration view;
   - explain "1 mm / 10 mm".
5. **Define the drift measures** (range vs spread, "points"), say that GTX 1080 Ti = Pascal, and account for the reliefs' missing ~170 ms.
