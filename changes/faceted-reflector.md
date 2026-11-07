bump: minor

**A solid paraboloid, and a faceted parabolic reflector.** The **reflector** preset gains a live `solid` switch
(`Nparabolic`). At 0 it is the mirror with its wall, as before. At 1 it is the filled paraboloid, capped flat at the
rim (`Nparaboloid`): glass for a TIR reflector, or a tool to subtract from another shape for a parabolic cavity. A
new **faceted reflector** preset (+ › Optics, `NfacetedReflector`) is made of flat facets whose corners lie on the
paraboloid: `rings` rings of equal width, `facets` facets round the rim, and going inward the count halves wherever a
facet would be narrower than `minWidth`, so the centre has fewer facets than the rim. Where the count halves, each
coarse sector is closed with three triangles, so no gaps open. `facets` 0 makes it round, faceted along the radius
only. `rings` 0 makes it smooth along the radius, faceted round the axis only. Both 0 make it the smooth reflector.
It has the same `solid` and `wall` as the reflector, and every number is live, with no compile.

Each facet is a line in its sector's (u, z) half-plane: an extrusion turned round the axis and intersected. With the
corners on a paraboloid, the facets are the corners' lower convex hull, so the distance is the largest of the facets'
plane distances. It is exact inside (for glass, and for a cut) and a bound outside. It stays convex only while
`minWidth` is at most one ring's width: past that a coarse facet's plane rose through a finer ring (15 of 108 layouts
at 1.5 ring widths, 2026-11-07), so `minWidth` is held there. `shapes.test.mjs` holds every mode to the facets' mesh
by brute force, and checks convexity over 352 layouts. `reflector.gpu.mjs` runs the WGSL against its JS twin on Dawn.
Old scenes keep their reflectors' `Ndish` code unchanged.

**What to look at:**
- + › Optics › **faceted reflector** with a mirror material. As it starts there are 6 facets round the centre ring,
  then 12, then 24 out to the rim, with triangles where the count doubles. `facets`, `rings` and `minWidth` should move
  it live.
- `solid` 1 with a glass: a filled paraboloid, flat across the rim. Put it in a group with a box and switch its join
  to − : the box gets a parabolic cavity, faceted or smooth.
- In the Optics page, the faceted reflector's far field beside the smooth one's (the Parabolic reflector example
  with its reflector swapped).
