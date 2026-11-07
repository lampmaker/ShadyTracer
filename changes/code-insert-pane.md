bump: minor

**Every code box has an Insert pane: what that code can set, read and call, one click a line in the code.** A material's
code block named six of its material's twenty-one fields in its opening comments, and nowhere said how to write the rest:
a coating's two reflectances are one packed number that `m.coatLow = ...` does not compile against, and a colour depth
written in code is in the scene's unit where the panel's is in mm. Under every code box (an object's, a group's, a
material's, its relief's, the scene's functions), **Insert** now lists, for that kind of block: what it can **set** --
for a material every field, grouped (surface, glass, coating, light), each as the line that sets it written from the
material's own values (`m.roughness = 0.35;`, `m = coatMaterial(m, 1u, 0.0, 1.0, 600.0, 20.0, 1.8);`,
`m.attenuationDistance = mm(5.0);`), with the panel's explanation on hover; for a relief `h` and `slope`; what it can
**read**, its own parameters by name among them; **recipes** that compile as they are (dichroics, a beam splitter, a
graded filter whose edge moves across the part, noise roughness, brushed and turned metal, colour by height; a relief's
grooves, rings, knurling, noise bumps, dents and print layers, each with its slope worked out); the **functions** that
kind of block reaches for, inserted with their arguments' names; and what **cannot be set** there, and why -- the surface
normal above all, which a material cannot change (a relief changes the shape instead). A search box finds a row by any
word it shows. A click puts the line at the caret, or at the end of a box never clicked into, as typing does: one undo
step, checked after the pause. A new material's opening comments are rewritten to say the syntax plainly and point to
it. Help › Reference › Functions for code gains the same tables, *What a material's code sets* and *What a relief's
code sets* (builder/coderef.js, one text for both). check-shaders compiles every line and recipe the pane offers in every
kernel, so a recipe that does not compile fails it.

**A scatter distance set in a material's code now scatters.** The walk inside a material is compiled into the march only
for a scene that needs it, and that was decided from the panel alone: a material whose code set `m.scatterDistance`
compiled clean and its rays walked nothing. Code naming it now compiles the walk in, as a panel value does; a scene whose
code does not name it is the text it was.

**What to look at:** open a material's *material code* box and its **Insert** pane: the lines carry the material's
values; click *Set · Coating*'s first row, Apply, and the material is a dichroic reflecting red; try a recipe under
*Recipes*. Choose a relief and open the relief code's Insert: *Knurled* should look knurled on an object wearing it. A
glass material with `m.transmission = 1.0; m.scatterDistance = mm(5.0);` in its code (and none in the panel) should now
render milky where before it rendered clear.
