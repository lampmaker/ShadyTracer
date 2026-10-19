# Beginner read: "Feeling fast" (ch/feel.html)

## 1. Teach-back

The live view adds samples (full tries at the picture) every frame; a "governor" asks 3% more above 23 frames a second, 3% fewer below 18. The old rule stepped by 0.1 inside a narrow 19–21 band, so it bounced between two counts forever. A rounding error could even make it trace zero samples. While you drag, the picture is traced in a cheaper mode (Draft or Sketch), because it restarts every frame anyway. The program is *told* you are moving: changes "poke" it, and a drag holds "moving" until 400 ms after the button comes up. A slow sample is cut into bands of pixels, about 30 ms a frame, so the page keeps answering. But a band needs at least 16,384 rays, so huge samples still give long frames. Windows resets the card if one piece of work runs about 2 s, so long frames are sent in pieces of about 150 ms. Offscreen, preparing the next sample while the card runs this one makes a sample cost about the larger of the two times, not their sum.

## 2. Quiz

1. **How many samples:** the governor measures frames a second. Above 23 it multiplies the count by 1.03, below 18 it divides by 1.03, and each frame traces the whole part. A sample under 30 ms is also capped at what fits in 30 ms. **Why the old rule hunted:** at 20 ms a sample, 2 samples give 22 fps (above 21, so it climbs) and 3 give 15 (below 19, so it falls). No whole count lands in 19–21. The page never says outright that today's rule settles because 22 lies inside 18–23. I had to work that out.
2. **While dragging:** Draft (direct light with shadows, no bounce) or Sketch (a fixed light). **How it knows:** the camera and live values poke on every change, and a drag holds while the button is down. It does not guess from resets, because other things reset too, including the mode switch itself.
3. **Why pieces:** a 1 s sample traced as one frame would answer the mouse once a second. **Why not always 30 ms:** each batch has a floor of 16,384 rays, so 1280 × 720 allows at most 57 batches, and a 10 s sample then gives 175 ms frames.
4. **Several submissions:** Windows resets the card when one submission runs about 2 s (the Noise library hung). So a frame over 250 ms is cut into submissions of about 150 ms, between "iterations". The page never taught what an iteration is.
5. **Two in flight:** the processor records sample n+1 while the card runs sample n, so a sample costs max(record, card) instead of record + card. Measured: 13–25% faster.

## 3. Where I got lost (worst first)

- **§3, the split:** "The cut falls between iterations, chapter 22's rounds of every kernel, at most 24 a sample." "Kernel" is never explained. Then come "frames of 667 ms, 24 iterations of about 28 ms each": is 24 per sample or per frame? "24 × 150 / 667 = 5.4" only clicked once I rewrote it as 150 ÷ (667/24).
- **§1, the cap:** "holds the count to one more than that: 7, asking 7.21 the next frame, cut back again." Why one more? "A slice of about 30 ms" and then "a frame of 35 ms" looked like a broken rule. Only later did I see that the slice covers the samples, not the 5 ms overhead.
- **§4, one in flight:** "a sample's time by the clock on the wall 50 to 57 ms above its time on the card." Why would those differ? "In flight" and "main thread" are never explained. Are "the Noise library" and "materials" scenes?
- **§3, the floor:** "a lane each (chapter 21)." I understood that only from *outside knowledge*.

## 4. Words and symbols

- **sample°:** the card helped, but it assumes "ray (or path)". I knew "path" from *outside knowledge*.
- **governor° and submission°:** both cards helped.
- **Never explained:** kernel, iteration, lane, main thread, in flight, compile, headless Chrome, uniform (on the builder card), next event estimation and light tracer, Pascal and GTX 1080 Ti, the "0.58.0" version numbers, and fps (I could guess that one).
- **Explained well:** floating point ("a tenth has none that ends"), HUD, offscreen, ray buffer, batch.

## 5. Figures

- **Fig 1:** clear. The blue steps under the grey line show the "whole part" well, and the zigzag in *before* convinced me. Three things puzzled me. The frames-a-second line always starts at 60, unexplained. In *now* the orange line hides the shaded band. In *zero* the frame rate spikes to 200 ("cut at 70"), but §6 says the browser asks for frames only 60 times a second.
- **Fig 2:** the clearest; the gap at 1.1–1.3 s in *free* shows the flashing.
- **Fig 3:** bar height means time and the dashed line is the slice; that came through. The white submission lines in *split* are faint but readable. It took me a while to see the corner label ("60 ms") as the axis.
- **Fig 4:** very clear. In *two* you can see recording 3 wait for card sample 1.

## 6. Maths fold-outs

There are none. The inline arithmetic was fine apart from the problems listed in §3 and §9.

## 7. The code

- **render-loop.js:** clear. With minfps at 20 I could check that 20 × 1.15 = 23.
- **interaction.js:** the caption carries it. `cancel?.()`, `[...listeners]` and `let out = true` stayed opaque.
- **quality.js:** I don't know `| 0`, `??` or `{ ...values }`. The `lampsOnly` lines are off-topic.
- **raytrace_main.js, lines 1538–1552:** lines 1543, 1545 and 1550 were opaque (`streams`, `order`, `!!`). The last line matched §1.
- **raytrace_main.js, lines 1722–1727:** the nested ternaries defeated me. `SPLIT_OVER_MS`, `SUBMIT_MS` and `SPLIT_ITERS` are never given as 250, 150 and 24, and `untimed` is never explained.
- **samples.js:** I don't know `async`/`await`, but the caption got me to the key line, `while (pending.length >= depth)`.

## 8. Too much, too little

- **Too much:** incident detail and hedging in nearly every paragraph ("how long the frame that hung ran was not recorded", "not measured", dates, card models). §6–7 are mostly history.
- **Too little:** kernels and iterations; why a small batch wastes the card; why frames "pile up" (central to how fast the view *feels*, yet only one paragraph). The quote "gentle where it does not matter and violent where it does" is never unpacked.

## 9. Wrong or contradictory

- **The floor:** the page says "no fewer than 16,384 rays", and the figure says "at least 16,384". But 921,600 / 57 = 16,168 and 230,400 / 15 = 15,360. Rounding 56.25 *up* to 57 breaks the floor.
- **Iterations:** "at most 24 a sample", yet each 667 ms frame also has 24.
- **The slice:** "each frame a slice of about 30 ms", yet the frame shown is 35 ms.
- **Frame rate:** Fig 1 shows 200 fps, while §6 says the browser asks for frames only 60 times a second.

## 10. The five changes

1. **Kernel, iteration, lane:** define them plainly, or give them cards, and say whether the 24 iterations are per batch or per sample.
2. **The floor:** fix or explain why rounding up puts 57 batches under 16,384 rays. Write the split as "667/24 ≈ 28 ms each; 150/28 ≈ 5.4", and give the constants' values next to the code.
3. **§1's cap step:** redo it slowly. Say that the slice limits sample time, not the overhead, why the count is held to "one more", and what goes wrong without the hold.
4. **§4:** explain recording time against card time, and "in flight", with an analogy (a washer and a dryer). Say what the Noise library and materials are.
5. **Asides and loose ends:** move the dates, card names and "not measured" asides into the stamps. Unpack the "gentle/violent" quote, and explain Fig 1's starting 60 fps and its 200 fps spikes.
