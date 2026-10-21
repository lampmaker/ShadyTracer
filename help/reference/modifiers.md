# Modifiers

> Made by `help/reference.mjs` from the program's own lists: edit that, not this page.

A modifier is a group that changes what is inside it: the space its children are drawn in (twist, bend, repeat, mirror, circular array) or the shape they make (round, shell, displace, relief). Put shapes in it; nest modifiers for more. Its parameters are live: dragging one compiles nothing.

## twist

Twist about z: "rate" radians per unit of height. Costs a sin and a cos per step. A twist stretches space, the more the farther from the axis; "extent" -- how far the children reach from it -- sets the step scale that keeps the march from overshooting.

| parameter | starts at | a length |
|---|---|---|
| rate | 1 | no: per the scene's unit |
| extent | 1 | yes, in the scene's unit |

## bend

Bend along x, curling toward z: "amount" radians per unit of x. A cheap bend, not an exact one; a sin and a cos per step. "extent" -- how far along x the children reach -- sets the step scale.

| parameter | starts at | a length |
|---|---|---|
| amount | 0.3 | no: per the scene's unit |
| extent | 2 | yes, in the scene's unit |

## repeat

Repeat: copies "spacing" apart, "count" each way along each axis (0: not along it), so 2 count + 1 per axis -- all for the price of one, which makes it the cheapest thing here. The children must fit in one cell, half a spacing around this group's origin, or the distance is wrong near the cell borders.

| parameter | starts at | a length |
|---|---|---|
| spacing | 2, 2, 2 | yes, in the scene's unit |
| count | 2, 2, 0 |  |

## mirror

Mirror across this group's x = 0 plane (turn the group to mirror across another): the children on the +x side and their reflection, for the price of one. A reflection turns analytic normals the wrong way, so they are taken by differences -- warp(1.0).


## circular array

Circular array: "count" copies of the children around this group's z axis, 360 / count degrees apart, the first where they are (turn the group for another axis). A child off the axis is drawn count times; one across it, or copies that overlap, make one merged shape -- a true union, the least distance of the copies, so a ring of overlapping glass is one glass with no faces inside it. Normals stay analytic, each turned with its copy. COST: every copy is evaluated, count times the children per step, which is right whatever they are. "reach" makes it cheaper when each copy stays within that many slices either side of its own (a slice is 360 / count degrees, the first centred on this group's +x; 0: inside its own slice, as a bolt circle's bolts or a gear's teeth -- so put the children on +x, off the axis): then only the copy nearest the point and reach + 1 either side are evaluated, 2 reach + 3 of them, and the rest bounded -- a slice away at least, and no nearer than the farthest evaluated less 2 x the distance from the axis, the farthest a turn moves a point. A copy reaching farther than "reach" says is drawn wrong. With 2 reach + 3 count or more, every copy is evaluated: so at 32, always.

| parameter | starts at | a length |
|---|---|---|
| count | 6 |  |
| reach | 32 |  |

## round

Round: every edge rounded by "radius" -- the shape grown outward by it, so it is that much bigger too. Free per step, but through a Hit of the children's own: inside, the medium is the nearest surface's rather than tracked per child (as in a CSG group).

| parameter | starts at | a length |
|---|---|---|
| radius | 0.1 | yes, in the scene's unit |

## shell

Shell: the children's surface as a skin "thickness" thick, hollow inside -- cut it open with a subtract group to see in. Free per step; a Hit of their own, as round.

| parameter | starts at | a length |
|---|---|---|
| thickness | 0.05 | yes, in the scene's unit |

## displace

Displace: a ripple "amount" high, "frequency" waves per unit, on the children's surface. Three sines per step, and the ripple steepens the field, so distances are divided by its steepest slope -- smaller steps -- and the normal is by differences. In a CSG group foldRelief leaves that to the group, after its blend (DIVIDED_ABOVE).

| parameter | starts at | a length |
|---|---|---|
| amount | 0.05 | yes, in the scene's unit |
| frequency | 2 | no: per the scene's unit |

## noise relief

Noise relief: a rough surface up to "amount" high and low, with features about "size" across -- four octaves of gradient noise (lib/pathtracer/core/noise.js). Costs four noises per step. The relief steepens the field by at most amount / size times the fBm's bound over its peak, so distances are divided by that: shorter steps, no holes. The bound is the MEASURED one (a quarter of the proved one, and a quarter the steps); for a proof use NZ_GRAD_LIP. The normal is by differences. IN A SHELL: the noise moves the surface by at most NZ_GRAD_VALUE_BOUND x amount (proved, noise.js), so beyond that from the plain shape, the plain distance less it is a safe distance -- no noise, no division. Only points near the surface pay for the noise. The edge is twice that out, so a step from the shell is never shorter than the reach (a ray grazing it would crawl), plus the hit tolerance times (slope + 1): a hit is within slope tolerances of the plain shape's reach and its normal's differences one more, so they never straddle the edge, where the value jumps. Under a smooth blend the edge is farther by READ_REACH, as far as the blend reads the field off its surface (unbounded under group code: no shell there). And foldRelief divides by the slope -- or, in a CSG group (DIVIDED_ABOVE), leaves it to the group, which divides once after the blend: divided before it, the fillet would come out the wrong size.

| parameter | starts at | a length |
|---|---|---|
| amount | 0.03 | yes, in the scene's unit |
| size | 0.3 | yes, in the scene's unit |
