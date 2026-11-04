bump: minor

**An imported part's fillets come in as round joins: one exact rounded edge each, where they were a cylinder or a
torus cut into place.** A face of a STEP part that is a fillet -- a cylinder or a torus tangent to the two faces it
rounds, along its whole length -- is now those two faces joined by a round join of its radius (the new join shape),
a group of two shapes labelled *fillet R1*. Before, each was a curved surface with the planes and cones that say
where it ends, and those were where the import went wrong: on your Onshape part of 2026-11-04 (121 faces, 62 of them
1 mm fillets) 6 of OpenCascade's 3000 classified points came out on the wrong side, 4 deep inside read near zero (a
seam) and 9 read more than their distance (measured, Node; the black notches in your render are likely these, not
seen). Now: 0 on the wrong side, 0 over the distance, 0 seams; 3 points outside still read under a fifth of their
distance (a slower march there, not a wrong surface: each is above the hit tolerance). The formula is 95 literals where
it was 302, the part 139 shapes where it was 235 -- in 87 groups, as many as before, each fillet being a group of two --
and it converts in 15 to 17 s instead of 24 to 29 (the container). A part made like it in
OpenCascade, the holder (import/test/fixtures/holder.step: a filleted tray, an upright with a U slot and two slanted
slots, 40 fillets), was 7 points wrong and 178 shapes; it is 0 and 61. A fillet that is not exactly two faces' round
join -- one between a plane and a curved face met obliquely, the bottom of a U between parallel walls -- is left as
before and counted in the import dialog. The conversion also keeps two new kinds of thin sheet out of the formula
(import/csg.js: a fillet's anti-supports, and walls across a surface a fillet shares), and samples where each
fillet's two faces meet. STL files keep the old route: a mesh has no edges to tell a fillet's rails by.

**What to look at:** import your part again (or import/test/fixtures/holder.step). The U slot's rims and the slanted
slots should be clean, with no black notches on the uprights' faces; the rims round, without creases where a straight
fillet meets one round a corner. The import dialog should close by itself (nothing refused, nothing disagreeing).
