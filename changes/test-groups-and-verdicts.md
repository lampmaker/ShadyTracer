bump: minor

**The Tests panel in groups, a verdict on every row, and the integrating sphere fixed.** The panel was some forty
buttons in the order they were written, and every report was read by eye. Now it is eight folders, each with its own
Run all first: *Light & units*, *Lights & emitters*, *Materials & energy*, *Estimators agree*, *Render modes*, *Optics
trace*, *Speed* and *Benchmarks*. The top Run all runs the first six, every test with a known answer. A test that
measures the scene you have loaded says **(your scene)** on its button.

Every row now reads **PASS**, **CHECK**, **FAIL**, **INFO** or **VOID** (`lib/pathtracer/verdict.js`).
- PASS: within 3σ of its answer (its own error bar) or the allowance its note gives, whichever is wider.
- CHECK: out to 5σ or twice the allowance. Rerun it first.
- FAIL: past that.
- INFO: no answer to hold it to (a speed, a reference row).
- VOID: nothing was measured. `emitters` on a scene with no emitter reads VOID, where it used to show a table of zeros.

The verdict is in the report's last column with the reason, in a line under the header, and in the JSON. A Run all
opens with a summary: one line a test, and every row that did not pass. The allowances are choices, read from each
test's note and from the 0.77.0 run on Pascal, and are tuned from the next run. Replayed through the rules, that run
would have read FAIL on the integrating sphere, on `draft-lamps`' lamps-only row (3% under Draft) and on `optics-mode`'s
x 0.5 sensor two stops down (5σ). It would have read CHECK on the furnace's dichroic coated on every face (0.997) and
on `sppm`'s map rows, whose reference has no error bar.

The integrating sphere in `optics-balance` read 0 because its scene was the furnace's *solid* ball: the source at its
centre sat inside an opaque solid, and no ray met a wall. It is now a hollow shell, material 1 between r = 1 and 1.1
round a cavity of air. The report's columns also widen to their widest number, which a millimetre scene's had run past.

**What to look at:**
- The Tests panel: the eight folders, each Run all, the "(your scene)" marks.
- Optics trace › `optics-balance`: the two integrating-sphere rows should read arrived 5.000 and 2.000, escaped 0, and
  PASS.
- Run all: the summary at the top. Do its FAILs and CHECKs match what you would judge from the numbers? An allowance
  too tight or too loose is the next thing to tune.
