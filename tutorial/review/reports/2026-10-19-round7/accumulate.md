# Adding up light on a GPU: a beginner's read

## 1. Teach-back
A graphics card runs thousands of workers (threads) at once, and several may add light to the same pixel at the same moment. If each one reads the pixel's number and then writes back "that plus mine", they overwrite each other. In the example all six threads read 0, and the pixel ends at 2 instead of 26. An atomic add can't be interrupted, so it always gives 26, but the GPU's language (WGSL) has it only for whole numbers. So ShadyTracer used to store light as whole numbers, 65,536 to a unit. That worked near 1, but bright light had to be cut off at 10,000: a sunny wall lost 60% and the sun almost all of it. Anything under 1/65,536 became 0. Now it stores decimals (f32) and adds them with compare-and-swap: write only if nobody changed the pixel since you read it, and otherwise retry. That is always right, but when n threads crowd one pixel, about n(n−1)/2 tries fail. Once a sample, one thread per pixel folds the sample into the picture's average. That is safe because no two threads share a pixel. When a sample needs more rays than memory holds, it is split into batches. Each batch adds into the same buffer, and the average is updated once, at the end.

## 2. Quiz
1. In lock-step they all load first (all read 0), then each stores its own value, which overwrites the others. The last store wins: 2 of 26. Interleaved, the result is luck (10 in the figure).
2. Load, compute the new value, then write it only if the pixel still holds what you loaded. If it doesn't, take the value it now holds and retry. In the page's model one thread succeeds per round, so 6 threads give 15 failures and 16 threads give 120 failures over 17 rounds (an atomic add takes 1). The failures grow as n(n−1)/2.
3. Small values were rounded, which was fine near 1. A pixel held at most 65,535 a sample, so each contribution was clamped at 10,000: the wall lost 60% and the sun all but 6 parts in a million. Anything under 1/65,536 became 0. The page says *why* the maximum is 65,535 nowhere (see 3.6).
4. Partly taught. One thread per pixel means no two threads meet, so a plain read-change-write is safe. The old way, folding each path straight into the average, lost updates. The page never says the other reason, which is that the average needs the whole sample's total divided by n (I inferred that from the code).
5. The rays in flight must fit 1 GiB at 496 bytes each, which is 2,164,802 rays. A 3840×2160 picture plus 1M photons needs 5 batches. They add up because the average is updated only after the last batch, and photons are divided by the sample's whole count. *Why* dividing by the whole count matters (otherwise five batches would count as five samples) is not said. That is outside knowledge.

## 3. Where I got lost (worst first)
1. **"sample" and "the picture's average" are never explained.** The chapter rests on them. Why is a pixel an average at all? *Outside knowledge*: many random samples are averaged.
2. **Which buffer is which.** "frame buffer", "the picture", `accumulation_u32`, "splat buffers", "the light tracer's splats". **"resolve"** appears in figure 3's readout ("resolve once"), in the reset comment and in section 6 ("Resolve returned early"), but the text never says that resolve is the once-a-sample fold of section 4.
3. Section 6, "Resolve returned early for a pixel no camera path reached… (the resolve excerpt's comment, just above its first line)". That comment isn't shown, and line 418 `if (n == 0u) { return; }` looks like the very bug being described.
4. The first paragraph uses path, shadow ray, "a photon's connection to the camera", light tracer, caustic, photon map, "gathers" and "wavefront chain". Each points to another chapter, and nothing reminds me in one line what it is.
5. "A pixel's 32-bit word could hold at most 65,535 a sample". Why 65,535? A 32-bit number goes to about 4 billion. I worked out 2³² ÷ 65,536 myself. "word" and "wrapping round" are not explained either.
6. Section 5 "MEASURED: What the float frame buffer may cost". The measurement compares light tracing on and off, not floats against whole numbers, so I couldn't see how it measures the frame buffer.

## 4. Words and symbols
- **WGSL**: used from section 1 and never explained (*outside knowledge*: the GPU's shader language).
- **float / floating-point**: used in section 1, but the f32 card only arrives in section 2. The **f32 card** talks about "the scene's middle, the point (0, 0, 0)" and "tolerance", which is about positions, not light. The ruler image helped, the rest confused me.
- **u32**: appears in figure 2 ("the old u32") and in the code, never explained.
- Unexplained: clamped, GiB, kernel (only in the thread card), radiance, **EMA**, gamut, white point, splat, deposit, contention, exponent bits, `UB.`, `3u`, `&`.
- **cd/m²**: only in a code header ("luminance, chapter 5's"). The numbers still told me "very bright".
- Why `x != x` would detect NaN: *outside knowledge*.
- Cards that helped: lock-step, atomic operation, compare-and-swap. The buffer card's "uniform buffer… 64 KiB" isn't relevant here.

## 5. Figures
- **Figure 1** (threads × time): very good. I traced the interleaved screenshot step by step and got 10. The CAS staircase makes 15 and 120 visible, but the text never says "count the red triangle, 5+4+3+2+1". Confusing points:
  - In lock-step all six store together, so why does "the last thread's" value win?
  - The caption says "struck in red", but the boxes are *filled* red with ×.
  - The readout says "152 steps" and the text says "17 rounds". Both are right (boxes against columns), but the page doesn't say they count different things.
- **Figure 2** (log line): clear, and it makes its point. The label "kept to 1/65536" reads as "kept *up to* 1/65536", the opposite of the "nothing" region below it. I think it means "rounded to steps of 1/65536". The text says "one part in 25,000" while the readout says "4.1e-5", and the e-notation is never explained. "1.0000e+4" and "10⁴" also mix two notations.
- **Figure 3** (batches): clear, and I could check 9,294,400 ÷ 2,164,802 → 5. The title is clipped ("the buffers ho…"). The map readout "the first 1 photons only" is garbled. Why photons must go first with the map ("before the first camera ray gathers") is unclear to me.

## 6. The maths fold-outs
There are none. The maths is inline. I could follow n(n−1)/2 from the staircase, 60%, and six parts in a million. Things that would deserve a fold-out:
- **The running average** `(prev × prevn + s) / cnt`: not explained in prose at all.
- **2/(n+2)** in the reset comment: I checked it myself with algebra, with no help from the text.
- **537 MB**: I first tried 56 bytes × 16.8M ≈ 940 MB. Only picture plus frame (32 bytes) gives 537 MB, and the sentence doesn't spell that out.
- **"1 GiB"**: its byte count is needed for the 2,164,802.

## 7. The code
- **Excerpt 1** is prose that repeats section 2. "integer addition commutes, which is what made it race-free": I thought the *atomic* made it race-free. "contention is low" clashes with section 1's crowd (see 9).
- **addF32**: the header (bitcast, `${buf}`, weak) made it readable. `&` and `r.old_value` I could guess.
- **Resolve**: the atomicExchange note was good. What stayed opaque:
  - `base + 3u` (I guessed 0–2 are red, green, blue and 3 is the count; the page doesn't say)
  - `VEC3`
  - `lt`, and why it is "added, not averaged"
  - the ±1e20 clamp and "badDeposit"
  - why `atomicLoad` at all if no two threads meet.
- **Reset comment**: long. "white point", "ray cap" and "0.38.1" are opaque.
- **planBatches**: a signature only, and `{ first = null } = {}` is beyond my JavaScript.

## 8. Too much, too little
Too much:
- Section 4's comments retell sections 2 and 6.
- Section 5 leans on test-suite jargon ("Tests > frame-cost", "the row's other cases", "the learned light tracer").

Too little:
- what a sample is
- the running average
- what resolve is
- why the batches divide by the whole count
- section 3's photon-map paragraph.

## 9. Wrong or contradictory
- Section 6 bullet 2 against line 418 (see 3.3).
- `UB.maxaverages` "(0, none)" and line 424 `min(count, UB.maxaverages)`. Read together with section 6's "0 meaning unlimited… every sample replaced the picture", the bug seems to still be in the shown code.
- Excerpt 1 says "contention is low: a few deposits per sample", while sections 1 and 5 say caustic pixels get crowded. The page cites wavefront.js:160, which is not shown.
- Section 6 says "above about 2.3 million pixels", but section 3 says the buffers hold 2,164,802 rays.
- Section 5 says "negative luminance… is not added", but the resolve comment keeps "a negative channel". Maybe channel and luminance differ; that isn't explained.
- Section 5's MEASURED title against what was actually measured (see 3.6).

## 10. The five changes
1. **Add a short opening reminder.** Say what a sample is, why a pixel is averaged over samples, and that there are two buffers (this sample's frame buffer, then the picture's average), with the fold between them named **resolve**.
2. **Resolve the apparent contradictions.** That means line 418 against section 6 bullet 2, and `maxaverages` 0 against section 6 bullet 4. Show the comment the page cites.
3. **Explain the running-average formula and the batches' division** in prose, or in a small fold-out with numbers.
4. **Define WGSL, u32/f32 and "word", and explain 65,535** (2³²/65,536). Give the f32 card a version about light values for this chapter.
5. **Fix figure 3's clipped title and its "first 1 photons only" readout.** In figure 2, relabel "kept to 1/65536" as "rounded to 1/65536 steps". In figure 1, change "struck" to "marked ×" and say what steps and rounds each count.
