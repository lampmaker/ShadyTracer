bump: minor

**A join can round or chamfer its edge: a circular fillet, or a flat cut, of the blend's radius.** A shape in a group
has a new **edge** setting beside its join (Properties: *smooth blend*, *round (fillet)*, *chamfer*), and the recipe
writes it at a line's end (`subtract b  round 0.5`, or `round` alone at the group's blend). The smooth blend is what
every join was; **round** is a circular fillet of the blend's radius where two faces meet at a right angle -- two flat
faces, or a flat face across a cylinder, a cone or a prism's side: a hole's rim filleted is the torus it should be --
and a rounded corner, not quite a circle, at other angles. Its normal is analytic. Its distance reads the two shapes'
distances alone, never their normals: the first version read the angle between them, which the renderer's
distance-only march does not have, so the march stopped on the sharp corner while the shading saw the fillet, and the
fillets rendered black in every mode (your scene of 2026-11-04). It is also held to what it adds on the fillet itself,
so far from it, where the two sides no longer meet squarely, it never reads more than the true distance. **Chamfer** is the flat cut between the same two lines on the faces. Scene files go to
version 27 (`joinShape` on a node; absent is smooth, so older files read unchanged, and a builder of 26 refuses a file
of 27). The WGSL is scene_api.js `csgRound*` / `csgChamfer*`; builder/joins.js is its JS twin and has the derivation.
Codegen calls them for such a join, and the scene as data does only when the scene has one, so every other scene's
shader text is unchanged.

**What to look at:** a box with a cylinder subtracted, the cylinder's edge set to *round* and an own blend of a fifth
of its radius. The hole's rim should be a smooth quarter-round, lit like a torus, with no crease where it meets the top
face or the wall. Try *chamfer*: a flat ring at 45 degrees. Two boxes intersected, one turned 30 degrees, with the
second's edge round: the long edge where they meet should be rounded along its whole length.
