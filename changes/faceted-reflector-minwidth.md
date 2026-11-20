bump: patch

**The faceted reflector's `minWidth` is what it says: the narrowest a facet may be round its ring.** Until now it was
held at one ring's width, so a `minWidth` wider than a ring (`aperture / rings`) did nothing -- with many thin rings
the count barely halved, however large `minWidth` was set. It was held there because past it the facets are no longer
convex: at a halving, the middle triangle (from the coarse chord out to the next ring) can rise less steeply than
the ring inside it, a ridge on that ring, and the exact distance (the largest of the facets' plane distances) only
holds for a convex bowl. Now `minWidth` is not held. Where every ring's crease is a valley the shape is the same
exact distance as before; where one is a ridge (`facetConvex` in `core/shapes.js` tells, from the slopes, and
`shapes.test.mjs` checks it against the mesh's own convexity over 768 layouts), the shape is the heightfield of the
point's own band's facets, a bound both sides: `|z - h| / sqrt(1 + L^2)` (L the steepest facet), raised by the convex
hull's distance in the air and the bands' under the mirror, so about exact near most facets. With a wall, the wall's
back there is the mirror moved down by `wall` along the smooth paraboloid's normal at that radius -- about `wall`
thick, exactly where a facet is as steep as the paraboloid; moving each facet back along its own normal opened a step
where a ridge and a valley meet. A ring still halves at most once, and never below 3 or from an odd count.

A tie in the halving's test is gone with it: the shape read a ring's radius as `ro - dr` and its mesh
(`facetRings`) as `dr * i`, which split `2 r sin(pi / m) = minWidth` one way in each.

**What to look at:** a faceted reflector with, say, `aperture` 0.5, `rings` 12, `facets` 48 and `minWidth` 0.1 (a
ring is 0.042 wide): the count should now halve from 48 at the rim down to 3 near the centre, each facet round its
ring at least 0.1 wide wherever halving can make it so (48, 24, 12, 6, 3 inward). Before, the same settings stopped at
6 round the centre, with facets down to about a ring's width. Look at the creases where the count halves: the facets
meet edge to edge with no gap or step, solid (`solid` 1, glass) and as a mirror with its wall. A reflector whose `minWidth` is under a ring's width (the preset's 0.04 against 0.083)
renders as before. Where a ridge appears, rendering that reflector may be somewhat slower (the march takes shorter
steps near its steep facets); the preset is unaffected.
