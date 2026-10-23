bump: minor

**A row or a ring of copies costs about what its nearest copies cost.** Every copy of an array used to be evaluated at
every step of every ray. Measured on the user's Ampere card (Tests › Benchmarks › lightarray, 213642c): a floor under
256 copies of one small light took 465 ms of march and 160 ms of occlusion a sample, against 12 and 8 ms for one light.
Light sampling's pick of a face stayed flat at 20 ms, so the copies were the whole cost.

Now a group's copies that form a **row** (evenly spaced, each turned and scaled alike) or a **ring** (evenly turned about
the group's x, y or z axis) are evaluated only near the copy closest to the point (`builder/arrays.js`):
- Every other copy is bounded by the sphere round its content's measured box.
- The nearest such bound stands in for all of them, as a skipped culling box does.
- Near a surface the picture's distances are exact. Elsewhere they are a lower bound, safe to march by.
- Any other list of copies is drawn as before. So is an array inside a joining group or under group code, and one
  whose box is not measured yet.
- A copies edit that turns a row or a ring into another shape compiles again. One that keeps it is live, as before.

The bench gains two rows, rows 2 and 4 with the window off. The test of the window is
`builder/test/arraywindow.gpu.mjs`. The Parametric part example's golden shader was refrozen: its heatsink fins are a
row of 9.

**What to look at:**
- **Tests › Benchmarks › lightarray:** row 4 (16 × 16 in a ring of rows) against row 6 (the same, window off) says what
  the window saves on your card. Row 6 should read about the 684 ms of the last run.
- **The pictures:** any arrayed scene should look as it did, its copies never clipped or missing. Look at the
  Parametric part example's fins, the LED ring, and a row of lights seen close.
- **A copy moved off a row:** in the group's copies box, change one copy's place by hand. The scene recompiles and every
  copy is drawn.
