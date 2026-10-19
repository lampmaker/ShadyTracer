# Blank reader: "Adding up light on a GPU" (chapter 23)

## 1. Teach-back

Many GPU workers (threads) add light to one pixel at once. If each reads the number and then writes "what I read plus mine", most additions get overwritten. An atomic add can't be interrupted, but the GPU language only has it for whole numbers. For decimals you use compare-and-swap: write only if the pixel still holds what you read, otherwise retry. It's always correct, but n threads on one pixel waste about n(n−1)/2 tries. Light used to be stored as whole numbers, 65,536 to a unit. In real units a wall is 25,000 and the sun 1.6 billion, so values were clamped at 10,000, and tiny values became 0. Each sample's light collects in a frame buffer, then one thread per pixel folds it into the average. If the rays don't fit in memory the sample is split into batches, with photons divided by the whole sample's count, so the batches add up to one sample.

## 2. Quiz

1. Each thread loads, then stores "loaded value + mine". In lock-step all six load 0 and only one store survives (pixel = 2, 24 lost). Interleaved, any store landing between a thread's load and its store is overwritten (the figure ends at 10).
2. Load, compute the new value, and swap it in only if the pixel still holds the loaded value. Otherwise take the value it holds now and retry. In the model one swap succeeds per round: 6 threads give 15 failures in 7 rounds, 16 give 120 in 17 rounds, against 1 round for an atomic add. Whether this causes the measured 7.8× slowdown is only "inferred".
3. A word holds at most about 65,535 units per pixel per sample and then wraps to 0. So each contribution was clamped at 10,000 (the wall lost 60%, the sun almost everything), and anything under 1/65,536 became 0. Those limits came from the format, not physics.
4. Folding each path straight into the average (load, arithmetic, store on four separate words) lost updates when two paths met. Once per sample, with one thread per pixel, nobody else touches the pixel, so a plain read-change-write is safe. *My inference:* the page never says that the average's formula can't be an atomic add.
5. The rays in flight must fit the buffers (2,164,802 rays), and 4K needs 5 batches. Each batch gets a fair slice and leaves its light in the frame buffer, and resolve runs once after the last. A photon carries light ÷ the whole sample's photon count, so the light isn't counted five times.

## 3. Where I got lost (worst first)

- **The first sentence:** "A path that ends hands its light to its pixel; so does a shadow ray that reaches the sun, and a photon's connection to the camera." Path, shadow ray, photon, light tracer and "caustic" are never explained. I followed only with *outside knowledge*.
- **"which one, the card decides"**. I first read this as the hover cards. It means the graphics card. The lock-step card has the same problem ("the card decides the width").
- **The averaging window.** "the first sample replaces the picture", "UB.maxaverages", "EMA" and the "'Unlimited', backwards" bullet rest on a window no prose introduces. Section 1 even says "the average of every sample so far".
- **The count n.** Section 1: "a camera path through every pixel". Yet resolve divides by "the count of camera paths that landed" and returns when "no path landed". When do those happen? And what is "a camera path [that] did not count"?
- **"1 GiB, 496 bytes a ray (two ray buffers and a shade queue item)"**: rays in flight, shade queue item, "wavefront chain" and "stream" are all unknown to me.
- **"x != x may be folded to false; it is found by its exponent bits"**: opaque.

## 4. Words and symbols

- **thread, buffer:** used from the first paragraph, but their cards appear only in the end list. The cards are good, so they belong at first use.
- **kernel:** never explained.
- **lock-step, atomic, compare-and-swap:** the cards helped.
- **f32:** the ruler image helped. Its "tolerance" half is off-topic here.
- **Never explained:** clamped, address, radiance ("of order 1"), contention, unbiased, gamut (and why a colour can be negative), UB, error bar, compiler.
- **EMA:** explained only in the *next* excerpt's note.

## 5. Figures

- **Figure 1** is excellent: the top row of pixel values makes each screenshot readable. In "plain", though, every box just says "S", so I couldn't see what each thread stored. In "mixed", the decisive drop from 10 to 2 (thread 4 storing 0+2) isn't pointed out. The CAS staircase and crowd triangle show n(n−1)/2 well. The readout says "1 rounds".
- **Figure 2** is clear: the caption explains the log scale, and the readouts match the text (60%, 99.9994%, 0 kept). The draggable marker is red, the same as "lost". The 65,535 word limit isn't marked.
- **Figure 3** is clear: the dashed limit, five equal bars, photons first as their own bar.

## 6. Maths fold-outs

There are none. The inline maths was followable, but "the average of 2 and 4 … (3 × 2 + 9) ÷ 3" reuses 2 as both a sample and n, and I had to stop and check.

## 7. The code

- **Comment excerpt (147–158):** it repeats section 2.
- **addF32:** with the note (bitcast, weak, ${buf}) I followed the loop.
- **Resolve:** `s = fr / f32(n) + lt` and the last line were fine. "base", "badDeposit above", "unbiased" and the ±1e20 clamp stayed opaque.
- **Reset excerpt:** clear only through its note, and UB.moveAverages is not explained.
- **planBatches:** the comment "the fewest batches whose largest fits" carried it. `+budget || 0`, `?.`, `reduce`, planInOrder and "emitter probes" stayed opaque.

## 8. Too much, too little

- **Rushed:** window and reset, NaN detection, and "What a pixel costs" (56 bytes, then "× 32" without saying why).
- **Repeated:** the first excerpt and section 6's first bullets restate sections 1–2.
- **Well paced:** sections 1–2.

## 9. Wrong or contradictory

- **Exact or not?** "An f32 keeps 25,000 exactly" against the f32 card's "a light of 25,000 is kept to about 0.002".
- **Two sizes of error:** "off by 0.00001, about one part in 25,000 (4 × 10⁻⁵)" mixes absolute and relative error.
- **Is contention low?** The excerpt says "contention is low: a pixel receives a few deposits", against the caustic crowds of sections 1 and 5. The note flags this, but the reader is told both.
- **Why "exponential"?** It's called an "exponential moving average", but the formula shown is a plain mean. The exponential part (the cap) is never shown.
- **Every pixel or not?** "every sample reaches every pixel", yet resolve handles "no path landed".

## 10. The five changes

1. **A recap box at the top** defining path, camera path, shadow ray, photon/light tracer, kernel and caustic, with the thread and buffer cards at first use.
2. **Introduce the averaging window in prose:** the cap, why it makes the average "exponential", and what a reset does. Otherwise, cut the reset excerpt and the "Unlimited" bullet.
3. **Say "graphics card"** wherever "card" means the GPU.
4. **Explain resolve's n:** when a pixel gets 0 or several camera paths, and what "did not count" means.
5. **In figure 1, write each store's value** ("S 6") and highlight the overwriting store. Also change the average example so its numbers don't collide with n.
