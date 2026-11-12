bump: minor

**The 3D print export simplifies its mesh** (File › Export ▸ 3D print…). Marching tetrahedra gave about the same
number of triangles per cell everywhere, so a flat face 100 mm across was a quarter of a million triangles. The mesh is
now simplified by edge collapse ordered by quadric error (`builder/simplify.js`). Flat regions become a few large
triangles and curved regions keep small ones. Each kept vertex stays within the new **deviation** setting (mm, 0.05 to
start, 0 for off) of the plane of every original triangle merged into it. The mesh stays closed, consistently wound
and of the same genus. In a 3MF the colours are sampled on the full mesh first, and the simplification keeps their
borders, so no triangle changes colour.

Measured in node (`builder/test/simplify.test.mjs`), not in a browser: a 10 mm sphere at a 0.4 mm cell goes from
70 056 triangles to about 7 100 at 0.05 mm, and no point of the mesh is more than 0.013 mm from the true sphere. A
16 × 12 × 8 mm box goes from 38 072 triangles to 24 at 0.01 mm. A 964 224-triangle ball on a plinth went to 11 844 triangles at 0.02 mm in
6.2 s on this container's CPU. A browser's time will differ.

**What to look at:** export a scene with flat and curved parts (a lens on a plate, a box with round holes) as 3MF and
as STL, at the default deviation and at 0. Open both in your slicer and check that the simplified one has the same
shape, that it reports no errors (non-manifold edges, holes) and that the colour regions match the 0 export. The
dialog's line says how many triangles were written and how many the mesher made. Also note how long the
"simplifying" step takes on a large part.
