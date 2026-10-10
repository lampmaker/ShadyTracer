# How shapes are made: distance functions

Most 3D programs store a shape as its surface: thousands of small triangles. ShadyTracer stores a shape as a
**rule** instead: for any point in space, *how far is the nearest surface?* That rule is a **signed distance
function**, an SDF. Outside the shape the distance is positive, inside it is negative, and the surface is exactly
where it is zero.

## One shape

A sphere of radius 1 is the distance to its centre, minus 1. That is the whole shape: one subtraction, and it is
exactly round at any zoom -- there are no triangles to see.

```widget sdf
mode: circle
ray: off
```

The picture is a slice through space. Orange is inside, blue outside; each line is another 0.25 of distance; the
white line is the surface.

## How the picture finds the surface

The renderer sends a ray from the camera through every pixel and asks the distance function at the ray's start.
Whatever it answers, nothing is closer than that -- so the ray can safely jump that far. It asks again, jumps again,
and stops when the distance is tiny: that is the surface. This is called **sphere tracing**. Drag the white dot:

```widget sdf
mode: union
```

Far from anything the jumps are big; near a surface they shrink. A ray that passes close to an edge takes many small
steps, which is why fine detail and grazing views cost more time to render.

## Combining shapes

Because a shape is a number at every point, combining shapes is arithmetic on numbers:

| join | is | in the tree |
|---|---|---|
| union | the smaller of the two distances | **∪** |
| intersect | the larger | **∩** |
| subtract | the larger of the first and the second turned inside out | **−** |

These never fail. There are no edges to intersect and no faces to stitch, so there is nothing that can come out
broken. A group's **blend** makes any of them smooth: where two shapes come within the blend's width of each other,
they melt together. Try the slider:

```widget sdf
mode: blend
```

A subtraction can be blended too, rounding the edge it cuts:

```widget sdf
mode: subtract
```

## Changing every shape at once

A **modifier** changes the space or the distance before or after the shapes inside it are asked. Growing any shape
is subtracting a number from its distance: every corner comes out rounded.

```widget sdf
mode: box
ray: off
```

Taking the absolute value and subtracting a thickness makes any shape a hollow skin -- **shell**:

```widget sdf
mode: shell
ray: off
```

And folding space into one cell before asking draws endless copies for the price of one -- **repeat**:

```widget sdf
mode: repeat
```

The [Modifiers](../reference/modifiers.md) reference lists them all: twist, bend, repeat, mirror, round, shell,
displace and relief.

## What this is good at

- **Smooth, organic and exact shapes.** A sphere is a sphere, a fillet is a formula, a blend has no seams.
- **Booleans that always work**, at any depth, live as you drag.
- **Repetition and detail for free.** A [Menger sponge](example:infinite-detail.json) four levels deep is one short
  formula; a forest of copies costs what one copy does.
- **Parameters.** Every number is live: sizes, blends and positions move the picture as you drag, with no rebuild.

## What it is not

- **Not a mesh modeller.** There are no vertices or faces to pick, so you cannot select an edge and fillet only
  that one. You round things by blends, the *round* modifier, or a shape's own rounding.
- **Not a sketch-and-constraint CAD program.** There are no dimension-driven sketches. The closest thing is
  component parameters: a group's parameters bound into what it holds, as in the
  [Parametric part](example:parametric-part.json) example.
- **Precision has a limit.** The graphics card computes in 32-bit floating point, so the finest surface it can
  find is set by how far a point is from the scene's origin: about 15 µm at 1 m, 0.15 mm at 10 m
  (`lib/pathtracer/PRECISION.md`). The unit does not change this; distance from the origin does. Keep small,
  precise parts near the origin.
- **Getting a mesh out is a conversion.** Export for printing samples the shape on a grid (Properties of an
  *export box*); the result is as fine as the grid.

Next: open [Combining shapes](example:combining-shapes.json) and [Modifiers](example:modifiers.json) and take
them apart in the tree.
