# Blank reader: "Feeling fast" (ch/feel.html)

## 1. Teach-back
The live view adds some samples (whole-picture tries) each frame, and a "governor" picks how many by watching frames a second. The old rule's fixed steps made it bounce for ever, and a rounding slip let frames draw nothing. While you drag, the view uses a cheaper mode (Draft or Sketch). It does that only when the camera or a value *says* something moves, and it keeps it for 400 ms after the last move or after you let go. A very slow sample is cut into pixel batches of about 30 ms a frame, so the page keeps answering. Batches can't be tiny (at least 16,384 rays), so very slow samples still make slow frames. Windows resets the card after about 2 s of one piece of work, so big frames go in several pieces. When saving a picture, the processor prepares the next sample while the card runs this one.

## 2. Quiz
1. It measures frames a second. Above 23 it multiplies the count by 1.03, below 18 it divides by 1.03, and in between it does nothing. The count is a fraction, and the frame traces its whole part (1 to 64). The old rule had ±0.1 steps and a 19–21 band. At 2 samples (45 ms, 22 fps) it climbed, and at 3 (65 ms, 15 fps) it fell. No whole count landed in the band, so it hunted.
2. It draws Draft (direct light from the sun, sky and lamps, with shadows, no bounce) or Sketch (a fixed light). It is *told*: the camera and the live values `poke()` on every change, and a drag `hold()`s while the button is down. Moving ends 400 ms after the last poke or release. It is not guessed from resets, because the mode switch itself resets and would keep itself on.
3. As one frame, a 1 s sample means the view answers the mouse once a second. Batches of ~30 ms let it answer every frame. It can't always fit because a batch needs at least 16,384 rays, which caps the batches (57 at 1280×720, 15 at 640×360). A 10 s sample then gives 175 or 667 ms frames.
4. Windows resets the card when one submission runs about 2 s, and the Noise library hung that way. So frames over 250 ms are cut into ~150 ms submissions "by iterations". *What an iteration is, the page did not teach* (it points to chapter 22).
5. The processor records the next sample while the card runs this one, so neither waits. A sample costs about the larger of the two times, not their sum (figure: 312 → 252 ms; measured 13–25% off).

## 3. Where I got lost (worst first)
1. **"submissions of about 150 ms each, by iterations (chapter 22) … 5 submissions of 5 iterations."** "Iteration" is undefined. It is not said why the cut is at 250 but the target is 150. The figure says "about 133 ms each".
2. **"50 to 57 ms above its time on the card, of which 6 to 12 ms was the recording."** What is the other ~40 ms? Fig 4 treats the gap as recording only. Yet Noise saved 32.6 ms, more than any recording time given.
3. **Section 6 is shorthand.** Examples: "a stop inside another (a scene swap's, inside the builder's apply) saw the loop paused and never started it again; holds are counted and nest". Also "waits while one frame is queued if a sample, and the frame, take over 50 ms, while two are queued otherwise" (read four times), and "the library this comes from" (which?).
4. **"a batch that small leaves most of the card idle."** Why would a small job leave a card *idle*? I only know because the card runs thousands of rays at once (*outside knowledge*). Sections 3 and 4 rest on this.
5. **"Steps of 0.1 do not land on whole numbers in a computer's arithmetic."** Why not? That binary can't hold 0.1 exactly is *outside knowledge*. It is also not said that the guard is checked *before* the step.
6. **"every frame resets the picture (chapter 23)"**: why needs one clause here.

## 4. Words and symbols
- **sample**: the card helped, but it uses "path" and "ray" undefined. "path-traced" (§2) is never explained.
- **governor**, **submission** and the three stamp cards: clear and enough.
- Unexplained: HUD, builder, live values, compile / kernel build, ray buffer, iterations, wall clock, "in flight" (the figure rescues it), "main thread" vs "main processor" (the same?), benchmark, watchdog, Pascal / GTX 1080 Ti, offscreen, Optics, nee, lt.
- Code: `??`, `!!`, nested ternaries, destructured defaults, `async` and "resolves" are all *outside knowledge*.

## 5. Figures
- **Fig 1**: the best figure, and its four shots match the text. Confusing: grey "count" near 2.9 with blue at 2 (needed "whole part" twice). In the zero shot the fps spikes overrun the 60 axis (readout says 200).
- **Fig 2**: clear story in three shots. The axis seems to read "12 s", "16 s" for 1.2 and 1.6.
- **Fig 3**: clear for light/heavy/floor. In the split shot the white lines are faint, and "5 iterations" means nothing to me. "ray buffer" in the caption is undefined.
- **Fig 4**: very clear: the card's gaps vanish with two. Why recording 3 waits for card job 1 to end (the "no more than two" rule) is visible but not pointed out.

## 6. Maths fold-outs
None. I checked the arithmetic myself (921,600/16,384 = 56.25 → 57; 10,000/57 = 175); showing it would make the floor feel earned.

## 7. The code
- **render-loop.js 77–80**: followable. From minfps 20 I got 23 and 18.
- **interaction.js 24–25**, **quality.js 128** and **samples.js 25** are bare signatures. The notes describe poke/hold/check, MODE and in-flight depth, but none of it is in the lines shown.
- **raytrace_main.js 1538–1552**: mostly opaque. With effort, `want = ceil(sampleMs/sliceMs)` is the figure's "asked 34" and `ceil(planned.total / SLICE_MIN_RAYS)` is the 57, but the page never says so. `SLICE_UNTIMED`, `SLICE_MAX`, `pending`, `planBatches`, `streams`, `order` are unexplained. The heading promises "a frame in submissions", but no submission code is shown.

## 8. Too much, too little
- §1 and §2 are well paced.
- §3's last paragraph and §4 are rushed; §6–§7 are incident lists (dates, rows, other chapters), too much for a beginner.
- The light-scene cap appears three times (code note, comment, §7) but never in §1 or §3's prose.

## 9. Wrong or contradictory
- **Fig 1 vs the code's last line.** Fig 1 has 20 ms samples settle at 2 a frame and 5 ms at 8. But with sliceMs = 30 the code caps them at floor(30/20) = 1 and floor(30/5) = 6 ("holds a light scene to the samples that fit a slice, whatever the governor asked"). §3 even says "the governor of section 1 gives the frame more". Either fig 1 assumes slicing is off, or it disagrees with the code.
- "about 150 ms each" (text) vs "about 133 ms each" (figure).
- Windows resets at "about 2 seconds", yet Noise "over a second … hung".
- Fig 4's recording-only model doesn't explain the 50–57 ms gap or the 32.6 ms saving.

## 10. The five changes
1. Add one sentence: the card runs thousands of rays side by side, so it needs big batches to stay busy.
2. Define "iteration" here, show how 667 ms becomes 5 × 5, and reconcile 150/133 and "over a second"/"about 2 s".
3. Reconcile fig 1 with the slice cap: say what sliceMs it assumes, or show the cap.
4. In §4, say what fills the rest of the 50–57 ms gap, and why overlapping saved more than the recording.
5. In §5, show the lines that *do* the work (poke/hold, the submission split) instead of signatures, and point out `want` → 34 and the floor → 57. Rewrite §6 plainly, defining builder, HUD, compile and "the library".
