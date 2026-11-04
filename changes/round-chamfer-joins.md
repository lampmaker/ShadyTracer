bump: minor

**A join can round or chamfer its edge: a circular fillet, or a flat cut, of the blend's radius.** A shape in a group
has a new **edge** setting beside its join (Properties: *smooth blend*, *round (fillet)*, *chamfer*), and the recipe
writes it at a line's end (`subtract b  round 0.5`, or `round` alone at the group's blend). The smooth blend is what
every join was; **round** is an exact circular fillet of the blend's radius where two flat faces meet at any angle, or
where a flat face meets a cylinder, a cone or a prism's side squarely: a hole's rim filleted is the torus it should
be. Its normal is analytic. **Chamfer** is the flat cut between the same two lines on the faces. Scene files go to
version 27 (`joinShape` on a node; absent is smooth, so older files read unchanged, and a builder of 26 refuses a file
of 27). The WGSL is scene_api.js `csgRound*` / `csgChamfer*`; builder/joins.js is its JS twin and has the derivation.
Codegen calls them for such a join, and the scene as data does only when the scene has one, so every other scene's
shader text is unchanged.

**What to look at:** a box with a cylinder subtracted, the cylinder's edge set to *round* and an own blend of a fifth
of its radius. The hole's rim should be a smooth quarter-round, lit like a torus, with no crease where it meets the top
face or the wall. Try *chamfer*: a flat ring at 45 degrees. Two boxes intersected, one turned 30 degrees, with the
second's edge round: the long edge where they meet should be rounded along its whole length.
