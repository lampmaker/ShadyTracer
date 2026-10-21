bump: minor

**A ninth modifier, the circular array: copies of a group's children round its z axis.** In the group's + menu under
Modifiers (and the Library), with two numbers: `count` (1 to 64) and `reach`. The copies are 360 / count degrees
apart, the first where the children are; turn the group for another axis. A child off the axis is drawn `count`
times. A child across the axis, or copies that overlap, become one merged shape: the copies are combined by the
smallest distance in a Hit of their own, a true union, so a ring of overlapping glass is one piece of glass with no
faces inside it.
- **Why every copy is evaluated, and not the point folded into one slice** (polar domain repetition, which
  `roadmap/BUILDER.md` had planned): a fold asks one copy, and a slice narrows to nothing at the axis. A shape across
  the centre came out as a wedge of itself, and a copy crossing a slice's edge lost its tip. So each step asks every
  copy, and costs `count` evaluations of the children (read in the code's loop; not timed on hardware).
- **`reach` buys the speed back** for copies that stay near their own slice: within `reach` slices either side (0:
  inside its own, like a bolt circle's bolts or a gear's teeth; the first slice is centred on the group's +x). Then
  only the nearest copy and `reach` + 1 either side are asked, and the rest get a bound: at least a slice away in angle,
  and no nearer than the farthest copy asked, less twice the distance from the axis. That second term keeps a ray
  through the centre from crawling. A copy reaching farther than `reach` says is drawn wrong. At 32 (the start) every
  copy is asked, whatever the count.
- **Normals stay analytic**: each copy's frame is turned with it. A material's local point and frame (`p_local`, a
  grain) and the pick's tag are the winning copy's own: while those are recorded, the winning copy is asked once more
  outside the copies' own Hit, where a surface is recorded as the scene's.
- **Checked on Dawn over lavapipe** (`builder/test/circular.gpu.mjs`, new; arithmetic, not speed), at 4096 points
  around each case, in codegen, with visibility live, as data and baked. Every copy asked: the distance is the exact
  union everywhere (within 1e-4), for a ring of spheres, a box across the axis, a turned and scaled group with an odd
  count, one copy, and a plate less a bolt circle. With `reach`: never above the union, the union itself within 0.1 of a
  surface, on its side everywhere, and never under sin(slice) / (2 + sin(slice)) of it. The normal is the nearest
  copy's own. Capturing gives the same distance, the local point and frame the copy's, and the sphere's tag. Each of
  those checks was seen to fail against a copy of the code broken that way: one copy asked, normals not turned, no
  bound, no far term, no capture.
- **The Modifiers example** has a front row: eight spheres apart, and a block across the axis merged into a rosette
  of twelve. Its camera moved back to take the row in (a first guess).
- **Not changed:** several children in one copy still fold as a plain group's do, by the nearest surface, so two that
  overlap inside one copy keep their faces there. For one shape, put them in a group of their own with a blend above 0
  or a cut (a CSG group, `codegen.js isCsg`). A light in the group is not drawn, as in any group with code.

**What to look at:** the Modifiers example's front row. On the left, eight separate spheres. On the right, one
rosette with no seams or wedge edges where the copies cross. Made glass, it should be one piece with no faces inside.
Then set the spheres' `reach` to 0: the picture should not change. That it renders faster (3 copies asked of 8, not
8) is inferred from the code, not timed: only a card can say by how much.
