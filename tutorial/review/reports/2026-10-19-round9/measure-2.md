# Blank reader: "Measure first" (ch. 25)

## 1. Teach-back
Before speeding a program up you need to know where its time goes and how far to trust a number. A plan blamed the whole design for one scene's 736.5 ms a sample, but other scenes took 62–177 ms, so the cost was that scene's six bumpy "reliefs" (81 ms without them). That led to a rule: say whether something was measured, read in the code, or guessed. The graphics card writes its own clock at the start and end of each pass, and the program adds up end minus start per kernel. Time between passes is the "gap". Wall clock also counts everything outside the card. Browsers may round those readings to 100 µs: one short pass then reads 0 or a whole tick, but many passes add up about right. The same code can read 38% apart between runs because the card's speed drifts. So you compare A and B by alternating them in one run.

## 2. Quiz
1. It called 736.5 ms "this architecture's cost", but an architecture cost would hit every scene, and the others ran 61.8–177.2 ms on the same card, size and code. The scene's own rows showed the reliefs: 81.1 ms without them (Surface materials 80.0), and each alone added 72–91 ms.
2. Each dispatch gets its own compute pass. The card writes a start and end timestamp (ns) into a "query set". After the sample these are copied into a buffer the program can read, and `tally` sums end − start per kernel name. It needs `timestamp-query`.
3. The gap is the part of the span (first start to last end) where no pass is running. It's the cost of launching kernels and grows with their number (0.39 of 88 ms). Wall clock is how long the program waits, including everything outside the card. "Uniform copies" and "barriers" were never explained.
4. One pass reads 0 if no tick falls inside it and a whole tick if one does, so it is wrong every time. A sum over many passes averages to the truth: march 44.6 vs 44.3 ms. Small kernels come out right only over more passes than one sample has, and the gaps shift (0.20 vs 0.39).
5. The card's speed drifts, maybe from heat, power state or other work (the page marks that as a guess). To compare, interleave A, B, A, B in one run, repeat the first row to check for drift, use medians, and stamp each number with the version, revision, card and kernel fingerprint. Not taught: how A,B,A,B becomes one number.

## 3. Where I got lost (worst first)
- **§2's first paragraph** lists kernels and unexplained words ("sphere-tracing steps", "the queues swap", "one thread", "compute pass, WebGPU's unit of work"). I only needed "a sample is about 200 small programs in a row".
- **§6, "A budget that shrank"**: "adaptive… raised again only when more than 1% of rays were cut short… capped at 128, not 400". Budget, worst case and "cut short" are never explained.
- **§5's first stamp**: it says "cost nothing", then "not free", then "−7% to +6%", then adds an unrelated fact about 0.032768 ms.
- **§2**: "the small kernels … about a tenth of a millisecond each, all 24 of its passes together". I had to read it three times.
- **§5**: "the 'slower when doing less' of the first run" is never explained.

## 4. Words and symbols
- *kernel* is used in the intro before it's explained; the card helps.
- The *dispatch* card ("workgroups, three dimensions, 65,535, indirect dispatch") made it harder, not easier.
- These have no card: *compute pass*, *WebGPU*, *shader*, *compile*, *cache*, *thread*, *barrier*, *uniform*, *relief*, *step near a surface*. I knew them only from *outside knowledge*.
- The cards for *sample*, *benchmark*, *GPU*, *drift* and the three stamps helped.

## 5. Figures
- **Fig 1**: clear, and the three steps make the argument. In "Every scene", Surface materials is blue although the caption says other scenes are "the sun's colour"; I worked out it's because it has no reliefs.
- **Fig 2**: `fig-2-passes` and `fig-2-stamps` are identical, so "Point at a pass" shows nothing. Red has two meanings (the genrays/resolve colour, and "read as 0"). Surface's purple isn't in the caption's colour list. The kernel and iteration views are very clear, though iteration 12 is still about half as tall as 11 while the text says "the first eleven carry the work". The rounded step's per-kernel claims (prep_march 0, prep_occlude 0.2) aren't visible in its per-pass screenshot, and the triangles are tiny. The tick view is the best figure on the page. Its readout says 4.33 µs where the text says 4, and doesn't say the difference is random scatter.
- **Fig 3**: the readings, their mean and range are clear. The dots' height means nothing, unsaid. Separate against interleaved is striking.

## 6. Maths fold-outs
There are none. The inline maths (percentages, range, standard deviation, the tick argument) I followed with the figure. "Holds a tick mark 4 times in a hundred" needs one reason: its start has to land in the 4 µs before a tick.

## 7. The code
- kerneltime header: "WHAT IT IS NOT" is readable. "no beginCompute chain there", "timePasses(fn)" and "descriptor" stay opaque.
- `tally`: the note makes `d`, `busy`, `first/last` and `gapMs` followable. I only guessed that `t[2*k]`/`t[2*k+1]` are a start and an end, and I didn't see why a zero pass is left out of the span. "Rounded to one tick" reads like "reads one tick".
- fingerprint: clear with the note. "wgsl" is never named.

## 8. Too much, too little
**Too much:** the §2 kernel list; §6's six stories, each one sentence with file:line references. **Too little:** what WebGPU and a compute pass are; why a fine clock is dangerous (*outside knowledge*: timing attacks); that 33 and 35 in `BENCH.run(33, 35, 33, 35)` are row numbers.

## 9. Wrong or contradictory
- **"Range" means two things.** §3 uses "the highest over the lowest, 38%" (255.5/184.7). §5 uses "highest less lowest, over the mean" (9.3%). By §5's definition, §3's readings give 34%.
- **The 16% can't be reproduced from its stated definition.** "The usual distance of a reading from their mean" gives about 12% (mean distance 25.7 of 210.4), and the population standard deviation gives 13.8%. Only the n−1 standard deviation gives 16%.
- **The within-run noise doesn't match §5.** The model's "rows in one run 1.5%" seems to clash with §5's repeated first row moving 9.3% *within one run*. The page doesn't say that adjacent rows are what matters, or where 1.5% comes from.
- **The step counts don't fit together.** "Up to 32 sphere-tracing steps a ray" (§2) and "capped at 128, not 400" (§6) are never explained against each other.

## 10. The five changes
1. Before §2, say plainly what WebGPU, a compute pass and a compiled kernel are, and cut the kernel catalogue to one sentence.
2. Use one definition of range. Make the 16% reproducible by naming the n−1 standard deviation or showing the arithmetic.
3. Give the source of the 1.5%, square it with §5's 9.3%, and show how A,B,A,B becomes one number.
4. Rewrite §6 as cause → what was seen → lesson, without file:line references, explaining budget, iterations and steps (32 / 128 / 400) once.
5. In Figure 2, give the "stamps" step its own screenshot with a pass and its two timestamps shown, use red for one meaning only, and show the per-kernel numbers at 100 µs that the text quotes.
