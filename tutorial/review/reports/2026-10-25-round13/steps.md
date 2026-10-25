# Blank-reader review: ch/steps.html ("Fewer and cheaper steps")

*The first reader of round 13 (2026-10-25), on the page as section 5's arrays paragraphs stood after the window's two
fixes: the whole page, its arrays section most closely. Kept as the reader wrote it, shortened only where noted.*

## 1. Teach-back
A ray moves in steps, and at every step the program asks every object in the scene how far away it is. So many
objects, or one costly one, make every step slow. Bumpy surfaces (reliefs) are the costly ones, because each step works
out the noise four times over. A box around an object helps: if the box is far away, its distance is used in place of
the object's, and that can never be longer than the real distance. This only works where objects are joined by
"nearest wins"; inside a lens or a blend, leaving a part out makes the answer wrong. A relief can also be wrapped in a
shell: far from the bumps, the plain shape's distance minus the bumps' reach is safe and cheap. The step cache stores
distances on a grid, and a ray inside a stored ball can jump to the ball's edge without asking the scene. Copies in a
row or a ring can be asked only near the closest copy. The first try was slower, because its GPU code branched
differently per pixel and the copies' boxes were measured far too large.

## 2. Quiz
1. Each step takes the smallest distance over all objects, so every object is asked every time. A step is dear when
   its objects are costly, mainly reliefs with four layers of noise (84% of the cost in the model).
2. Nothing inside a box is nearer than the box. While the box is farther than the margin, its distance stands in. That
   is at or below the true distance, so a step never overshoots, and it is above the margin, so it is never taken for a
   hit.
3. A box test costs about what a plain shape does and shortens steps, so only dear objects get one. At the root
   everything is joined by union. Inside an intersection, a subtraction or a blend, a part's lower bound is not a lower
   bound on the result.
4. A shell is the band where the bumps can be. Outside it the plain distance minus the reach is used, with no noise and
   no division. It saved about a third, not most. The hypothesis given: the boxes had already skipped the far steps, so
   only the steps between a box's edge and the band were saved.
5. A ray inside a cell's ball jumps to where it leaves the ball. The first fill used the scene copy with boxes, so the
   balls stopped at the boxes and were smaller: safe, but slower. Section 7 adds that a lazy fill during the march was
   slower too.
6. The copies' bounds only grow outwards from the nearest copy, so they are asked from the closest outwards, and the
   first copy beyond the margin covers the rest. The first version was slower for two reasons: a per-pixel `switch`
   that the GPU runs one case after another, and boxes measured as all the copies at once (the same "tag"), so the
   bounds were huge and the steps many. *How the closest copy is found, the page did not teach.*

## 3. Where I got lost (worst first)
1. **The arrays section seems to contradict section 2.** Section 2 says "ONLY AT THE ROOT", "A group is boxed as a
   whole", and that boxing B "inside the join" is something "ShadyTracer never does". Then: "The same contract works
   inside an array, a group whose children are drawn again". So copies inside a group are bounded one by one? I
   resolved it only by *outside knowledge*: the copies are joined by a plain union, the root case again. The page never
   says so, and "contract" is never defined.
2. **"the window" is never introduced.** Its first use is "1007 ms a sample with the window", then "a window's copy".
   I guessed: the copies near the closest one.
3. **Three numbers for "every copy asked"**: 465 ms, then 281 ms ("On the user's Pascal card"), then 389 ms ("the same
   card"). Is the first an Ampere number? Why did 281 become 389 on the same card? And 120 ms is still 10 times the
   "12 ms for one light", with no comment.
4. **Sphere or box?** "bounded by its content's box", then "Round a ring the sphere about each copy's box grows with
   the angle", then "Its 'one copy's' sphere was therefore 2 m wide", finally "With that, and the box-shaped bounds
   above". Which bound did the first version use, and which now? Grows with which angle, from where? Why does "one
   ring-shaped band about the axis" matter?
5. **"the march took that sphere for a surface"** contradicts section 2's "the march never takes a box for a surface".
   I think it means the steps were cut short at the sphere.
6. **Step counts:** "47 … against 22", then "30 steps against 21". Is the baseline 22 or 21? After the fix there are
   still more steps, yet it is faster. Because each step is cheaper? Not said.
7. **Words with no explanation:** "256 copies of one small light" (lights are objects?), "Light sampling's choice
   among the 256 faces", "a sample", "tag", "node", "bench row", "the plain loop", "The row of 16" (the scene was 256
   lights; which arrangement?).
8. **"step" means two things:** a row's spacing ("moved by a step at a time") and a ray's step.
9. **Elsewhere:**
   - "The division is the dearer half": half of what?
   - The 17.2 against 11.2 paragraph: "4.3 … (measured)", then "Both are measurements, not proofs: the proved bound
     is four times larger". Four times larger than which?
   - The shell timing sentence (156.0 / 202.3 / "whose first timing of it had read 216.6") took three reads.

## 4. Words and symbols
- **Cards that helped:** march, step scale, tolerance, culling box, shell, union, intersection, Lipschitz bound, step
  cache, kernel.
- **No card:** WGSL, uniform/`UB.`, "pick copy" (explained once, briefly), "tag", "node", "Ampere/Pascal" (the measured
  card names them, which helps), version numbers (0.34.0, …), "fold", "frame", "light sampling", "window".

## 5. Figures
- **Fig 1:** clear; the colours, bar and readout match the text (38,798 → 12,545 → 12,208 → 11,471). One puzzle: the
  shelled readout "885 steps (without boxes 773)", where boxes add steps. The text supports it, but it is easy to miss.
- **Fig 2:** the lens and blend failures are vivid.
- **Fig 3:** good. Its caption says the shell edge is "dashed in the red colour", while Fig 1's says "a shell's edge
  purple".
- **Fig 4:** clear. The text says the renderer showed the cells "in orange"; the figure uses red.
- **The arrays:** no figure, and it is the hardest idea on the page. A 2D row of copies, showing which are asked, would
  fix most of points 1 to 4 above.

## 6. Maths fold-outs
The 2.6 bound's arithmetic is followable, though "the first layer's is the height ÷ 1.875" took effort. The ball-exit
quadratic is good: school algebra, well captioned.

## 7. The code
- **cullDist** and **scStep** are the best explained.
- **Stayed opaque:** `xfPoint`, `[3].w`, `UB.`, `children(emptyHit(r), p)`, `H.m`, `DIVIDED_ABOVE`, `READ_REACH`.
- **The arrays paragraphs** quote no code and interrupt "How ShadyTracer does it", between the codegen line and the
  relief code.

## 8. Too much, too little
- **Too much:** the measurement history (run numbers, drift, re-timings), the version numbers, the scene names in
  section 6.
- **Too little:** the arrays get one dense paragraph, no figure, and no entry in sections 6 and 7. That is odd, since
  the first version is a "what went wrong" story. The intro promises "three ways", and arrays are a fourth.

## 9. Wrong or contradictory
- Arrays: bounds per copy inside a group, against "ONLY AT THE ROOT … A group is culled as a whole" (the union never
  stated).
- "Every copy asked": 465 against 281 against 389 ms ("the same card").
- "took that sphere for a surface" against "the march never takes a box for a surface".
- Sphere against "box-shaped bounds".
- Baselines of 22 against 21 steps.
- The shell edge purple in Fig 1, red in Fig 3; the cells "orange" in the text, red in the figure.
- "the proved bound is four times larger": larger than which?

## 10. Five changes
1. Open the arrays part with why it is allowed (an array's copies are joined by nearest-wins, the root case again),
   and name the rule.
2. Define "the window" before using it. Say how the closest copy is found, and give one consistent bound per case.
3. Label every ms figure with its card and run. Fix the 22/21 baseline, and say why 30 steps against 21 is still
   faster.
4. Add a small figure: a row of copies with a point, the copies asked, the stopping copy, the bound standing in.
5. Explain or replace the section's jargon: light sampling, faces, tag, node, bench row, plain loop, sample. Avoid
   "step" for the spacing, and "took … for a surface".
