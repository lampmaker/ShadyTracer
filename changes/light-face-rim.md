bump: patch

**A light's face glows on the face alone, so light sampling off no longer reads a small light brighter than on.**
The face is a sheet of no thickness, and the march calls a point within the surface tolerance a hit, so a ray could
meet a rim around the face, as wide as the tolerance. That rim glowed. Light sampling aims at the face itself, and
MIS gives a small face's glow almost no weight, so the picture with light sampling on was right. With it off, every
path that met the rim counted it. Measured on lavapipe (`builder/test/lightface.gpu.mjs`), a 0.1 x 0.05 m face over a
matte floor against the closed form: light sampling off read 1.05 at the automatic 0.5 mm tolerance and 1.25 at ten
times it, and light sampling on read 1.00 at both. The gap shrank as the face grew (1.02, 1.007, 1.002 at two, four
and eight times the size). That is the 4 % gap a floor under twelve small lights showed with light sampling on
against off. Now the rim takes the back's material: black, or clear for a transparent light. The light's frame is
used, so each copy of a light tests its own face, codegen and the scene as data alike.

**What to look at:** a small rectangle or disc light over a floor, with light sampling on and off (Developer settings):
the pool of light should be equally bright, where before off was brighter by about the tolerance over the face's size.
The face seen directly loses an edge as wide as the tolerance, which should not be visible. In the
`light-vs-emitter` bench, every pair should read 1 and the one pair at the automatic tolerance about 0.82
(finding 7, now the emissive object's own fatness alone).

**The `light-vs-emitter` bench's 30 cm disc pairs run at a 10 um march tolerance**, as its 1 cm pairs did. With the
light exact where the camera sees it, they read 0.990-0.994 at the automatic tolerance (Ampere, 2026-10-23), against
0.995-1.000 before. That was the emissive disc's own excess, passing 0.1 % inside the bench's 1 % floor.
