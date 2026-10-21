# How this differs from regular CAD

If you have used a CAD program (SolidWorks, Fusion, FreeCAD, Onshape) or a mesh modeller (Blender, 3ds Max),
some habits carry over and some do not. This page is the short list.

## What a shape is

| | mesh modellers | CAD (B-rep) | ShadyTracer |
|---|---|---|---|
| a shape is | triangles | faces, edges and vertices with exact curves | a distance function: a rule, no surface stored |
| a sphere is | many flat facets | an exact surface | exact, at any zoom |
| booleans | can fail on bad meshes | can fail on tangent or tiny faces | always work: a min or a max of two numbers |
| a fillet | modelled or beveled | picked on an edge | a blend between two shapes, or the *round* modifier |
| copies | each one costs | each one costs | a *repeat* or an array: many for the price of one |
| editing | move vertices | edit sketches and features | change numbers; most changes need no rebuild |

See [How shapes are made](sdf.md) for why booleans and blends are free here.

## What you will miss

- **Picking an edge or a face.** There are none to pick. You select whole objects and groups in the
  [tree](tree.md) or in the picture.
- **Sketches with constraints.** Dimensions are parameters: numbers in Properties, and component
  parameters that drive what is inside a group ([Parameters and code](parameters.md)).
- **Exact export.** A file for a slicer is made by sampling the shape on a grid and meshing it (the
  [export box](projects.md#export-for-3d-printing)). Edges come out bevelled by up to a cell, and features
  thinner than a cell disappear.
- **Importing meshes or CAD files.** Not there yet (`roadmap/IMPORT.md` has the routes looked at).

## What you will gain

- **Blends everywhere**, sharp or smooth, between any shapes, at any depth of nesting.
- **Shapes that cost nothing to repeat**: a lattice, a forest, a Menger sponge
  ([Infinite detail](example:infinite-detail.json)).
- **Shapes no B-rep kernel offers**: twists, bends and noise reliefs applied to anything.
- **One model for the picture and the measurement.** The renderer and the optics trace march the same
  distance function, so a picture and a lux reading cannot disagree about the geometry.

## Order matters in a group

In a CAD feature tree, order is history. Here, order is how a group combines its children: each child
joins *what is above it in its group* by union, subtract or intersect. A subtraction cuts everything above it
in that group, and nothing outside it. To cut only one part, put that part and the cutter in a group of their own.

## Numbers are in the scene's unit

Every length in a scene is in its unit: metres, centimetres or millimetres, chosen in the scene's
Properties. A new scene starts in centimetres. Changing the unit asks what should happen:

- **Scale the objects**: everything keeps its real size. Each object at the top of the tree gets its position and
  scale multiplied (from cm to mm, by 10); the numbers inside it stay as they are. It works for any code, your own
  included.
- **Convert the dimensions**: everything keeps its real size, and the numbers change instead: every position and
  every length is multiplied, so a box of 1 cm reads 10 mm. Before you choose, it lists what it cannot convert: a
  number written in your own code, a parameter not marked as a length, a point that adds a plain number to a length,
  a binding that does.
- **Keep the numbers**: a radius of 1 becomes 1 of the new unit, so the whole scene grows or shrinks, the camera
  with it, and the picture looks the same. Use it when the numbers were meant in the new unit all along.

The first two convert the camera, the scene's radius and tolerance, and the timeline's keys too, and an undo puts
all of it back. A material's own lengths (a pattern's size, a relief's height) are real millimetres
whatever the unit, so a wood grain stays a wood grain on a 1 m table and on a 10 mm cube.
