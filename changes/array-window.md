bump: minor

**A row or a ring of copies costs about what its nearest copies cost.** Every copy of an array used to be evaluated at
every step of every ray. Measured on the user's Ampere card (Tests › Benchmarks › lightarray, 213642c): a floor under
256 copies of one small light took 465 ms of march and 160 ms of occlusion a sample, against 12 and 8 ms for one light.
Light sampling's pick of a face stayed flat at 20 ms, so the copies were the whole cost.

Now a group's copies that form a **row** (evenly spaced, each turned and scaled alike) or a **ring** (evenly turned about
the group's x, y or z axis) are evaluated only near the copy closest to the point (`builder/arrays.js`):
- Every other copy is bounded by its content's measured box:
  - a row's copy by the box's own distance, which grows each way from the nearest copy;
  - a ring's by the sphere round the box, and never below the ring-shaped band about the axis that every copy lies in.
- The nearest such bound stands in for all of them, as a skipped culling box does.
- Near a surface the picture's distances are exact. Elsewhere they are a lower bound, safe to march by.
- Any other list of copies is drawn as before. So is an array inside a joining group or under group code, and one
  whose box is not measured yet.
- A copies edit that turns a row or a ring into another shape compiles again. One that keeps it is live, as before.

**The first version of the window was slower, for two reasons, both now addressed (whether enough is the next run's to say):**
- **Measured on the user's Pascal card (a81cac9):** the ring of 256 marched in 1007.5 ms a sample with the window,
  against 281.0 with it off.
- **Each step cost more.** The loop fetched each copy through a switch on a number that differs from pixel to pixel, and
  a GPU runs such a switch's cases one after another.
  - Measured at c9577ae: bench row 7, every copy fetched that way, marched in 399.6 ms against row 6's 279.3.
  - Now a window's copy is worked out from the first copy by the pattern (`arrays.js` `arrCopy`): moved along the row,
    or turned round the ring. It is the stored copy to f32's precision.
  - Measured: row 4 went from 1007.5 ms of march to 740.0.
- **The rays took more steps.**
  - At c9577ae only 34% of row 4's rays finished in the first 32-step march pass, against 77% of row 6's.
  - The cause: the bench's measured boxes held every copy of a node in an array (the change note
    `array-boxes-per-copy.md`), and the window bounded each copy by a sphere round such a box.
  - Counted on lavapipe with boxes measured as the bench measures them (`builder/test/arraywindow.gpu.mjs`, which now
    holds the count): 47.1 steps a camera ray with the window against 21.9.
  - With each copy measured as one, 32.1 against 21.4. With the box-shaped bounds above as well, 29.6 against 21.4
    (codegen) and 32.8 against 30.4 (as data); the row about 1.0 either way.
  - Inferred, not measured: what is left is the sphere round a ring's copy inside the lights' own plane, where the
    band says nothing. A bound by the angle about the axis would be the next step.

The bench gains three rows: rows 2 and 4 with the window off, and row 7, the ring's every copy fetched through the
switch from the window's first copy, which says what the switch costs. The test of the window is
`builder/test/arraywindow.gpu.mjs`. The Parametric part example's golden shader was refrozen: its heatsink fins are a
row of 9.

**What to look at:**
- **Tests › Benchmarks › lightarray:**
  - Row 4 (16 × 16 in a ring of rows) against row 6 (the same, window off) says what the window saves on your card.
    At c9577ae on Pascal they read 1063.7 and 406.0 ms a sample.
  - Row 4's first march pass: the share of its rays shaded there against row 6's (34% against 77% at c9577ae) says
    whether the extra steps have gone.
  - Row 7 against row 6 is what the switch cost the first version (399.6 against 279.3 ms of march at c9577ae).
- **The pictures:** any arrayed scene should look as it did, its copies never clipped or missing. Look at the
  Parametric part example's fins, the LED ring, and a row of lights seen close.
- **A copy moved off a row:** in the group's copies box, change one copy's place by hand. The scene recompiles and every
  copy is drawn.
