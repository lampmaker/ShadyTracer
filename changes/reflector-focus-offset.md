bump: minor

**Both parabolic reflectors have a `focusOffset`: the focus moved off the axis to a ring of that radius.** At 0 (where
a new one starts) the reflector is the paraboloid it was. Otherwise each half of the mirror, seen in a cut through the
axis, is the parabola whose focus sits `focusOffset` out from the axis in z = 0 -- the mirror `z = (r - focusOffset)^2
/ 4f - f`, turned about the axis -- so the foci make a ring, and a source as wide as that ring sends its edge out
parallel instead of its centre: room to tune the beam of an LED that is not a point. Positive puts each half's focus
on its own side (the mirror rises from the ring both ways: a bump on the axis); negative puts it across the axis
(each half focuses through the axis: a point there, like a cone's). The offset is a length, converted with the scene's
unit, and held at most the aperture.

The faceted reflector takes it too: its corners on that mirror, the apex included. A negative offset keeps the facets
convex wherever they were (the exact distance, as before); a positive one makes the bands inside the ring fall outward
-- a tent, whose sectors meet in ridges -- and the shape is then the facets' heightfield, the bound both sides that a
`minWidth` past a ring's width already gave (`facetConvex` takes the offset and says which). Its troughs (`rings` 0)
are the same heightfield with a positive offset.

The distance is never too large either way, and the code says on which side it is exact (`g2ParabolaOffset` in
`core/shapes.js`): the profile is the parabola and its mirror image across the axis, intersected for a negative offset
(exact in the bowl) and joined for a positive one (exact behind the wall). Both presets' code calls new functions,
`NparabolicOffset` and `NfacetedReflectorOffset`; the old `Ndish`, `Nparaboloid`, `Nparabolic` and
`NfacetedReflector` stay, the new ones at 0 bit for bit, so a scene saved before keeps its reflector as it was -- and
without the new parameter: insert a new reflector to get it. `shapes.test.mjs` holds the new shapes to their profile
and their mesh (and a ray from the ring leaving along +z, smooth and solid); `reflector.gpu.mjs` their WGSL to their
JS twins on Dawn.

**What to look at:** a new reflector from the + menu's Optics shapes (`aperture` 0.5, `focal` 0.125), a mirror
material, a light at its origin. Move `focusOffset` up to about 0.1 and down to about -0.1: the mirror should grow a
low bump on the axis and then a point there, the rim lower and higher, with no hole, seam or black ring at the axis or
at the ring's radius, mirror and `solid` 1 alike. The same on the faceted reflector: the facets should stay closed,
and with a positive offset the inner rings tilt down toward the rim. In the Optics page's far field, with a source
about as wide as the ring, watch the beam angle as the offset moves: nothing here has measured what it does to a beam.
