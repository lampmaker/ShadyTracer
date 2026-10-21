bump: minor

**A triangular prism in the library, any triangle.** Library › Optics › *Triangular prism 25 mm, N-BK7*: a prism whose
triangle stands up in the xz plane, its base `width` along x and its `height` up z, run `depth` along y and centred.
`apex` is where the top stands along the base, as a fraction of it: 0 over the base's -x end (a right-angle prism,
the right angle there), 0.5 over its middle (isosceles), 1 over its +x end; past 0 or 1 it leans out over the base
(obtuse) and is still a triangle. All four are live (no compile while dragging). It starts as a 25 × 25 × 25 mm
right-angle prism in N-BK7 (n_d 1.5168, Abbe number 64.17, Schott's catalogue, the values `spectral.test.mjs` holds
BK7 to), so it disperses.
- **The shape is new, `Ntriprism`** in `lib/pathtracer/core/shapes.js`, on a new 2D piece `g2Triangle` (any
  counter-clockwise triangle, with its gradient), extruded along y with `g2Extrude`. It is exact on both sides, and its
  normal is the distance's analytic gradient, as the file's other shapes are. Width and height are taken as their
  size and never below 1e-6, so any value a slider or typed number gives is finite.
- **Tested without a GPU** (`core/test/shapes.test.mjs`, 35 new checks): five triangles (right-angled, isosceles,
  the right angle at +x, leaning out past the base, a sliver 0.05 high) checked against a reference polygon that shares
  no code with the shape: exact inside and out, the normal the gradient and unit length. Any parameters, zero and
  negative included, give a finite, 1-Lipschitz shape, and its corners are where the parameters put them. Moving the
  top to the wrong place in the JS failed 20 of them.
- **Not in the + menu.** It is a library item, a code node like the PMMA lens, and so not one of `plainshape.js`'s
  plain shapes: codegen gives it a bounding box.

**What to look at:** put the prism from the Library (Optics) into a scene in the sun or under a beam. It should be an
upright right triangle seen along y, the right angle at the left (-x) and the hypotenuse facing up and right. Drag
`apex` to 0.5 for an isosceles prism and to 1 to mirror it. White light through it should fan into colours, less than
the flint prism of *Dispersion in a prism* does. Its picture in the Library is rendered the first time the panel shows
it.
