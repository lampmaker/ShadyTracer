# Welcome to ShadyTracer

ShadyTracer models with **distance functions** instead of meshes, and renders what you model with a **path tracer**
that runs on your graphics card, in the browser. Light in it is in real units -- lumens, candela, lux -- so the
same program that makes a picture can also measure one.

## Two ways in

This help has two tracks. Most people want the first.

- **Modelling and rendering**: making shapes and pictures. You will not need any optics: the analysis menus can be
  ignored entirely. Start with [How shapes are made](../modelling/sdf.md), then
  [How this differs from regular CAD](../modelling/vs-cad.md) if you know CAD.
- **Optical design**: lenses, reflectors, light guides and LEDs, measured -- illuminance on a detector, intensity
  in the far field, colour over a screen. Start with [Optical design with ShadyTracer](../optics/overview.md), and
  read [what it does not do](../optics/limits.md) before you rely on it.

Both tracks use the same scenes, the same tree and the same materials.

## Five minutes

1. Open an example: click the project's name over the tree, and under **Examples** choose **First steps** -- or [open it from here](example:first-steps.json).
2. Drag in the picture to orbit round it; the wheel moves you in and out, a middle-drag pans.
3. Click the red ball. Its handles appear; drag one to move it. The numbers at the top right of the view say where
   it is; fold them away with ▾ when they are in the way.
4. Open the [Library](show:library), find *gold* under Materials and drag it onto the ball: the picture follows.
   Then drag the ball's *roughness* in **Properties**: a material's values change with no waiting.
5. Click **+** in the tree and add a **box**. A new shape changes the program the graphics card runs, so it is
   compiled first: a bar over the picture, and one at the bottom, show how far it has got.

## Where things are

| | |
|---|---|
| The picture | the **Viewport**; its toolbar has the camera, the view's modes and exposure |
| What is in the scene | the **Scene** tree on the left: groups, objects, lights, materials |
| The selection's settings | [Properties](show:properties), under the tree |
| Ready-made shapes and materials | the [Library](show:library), a tab beside the tree |
| How hard the renderer works | the [Render settings](show:renderer) panel on the right |
| Measuring light | the **Analysis** menu (optical design) |
| This help | **Help › Contents**, or **F1** |
