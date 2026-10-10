# When something is wrong

## The page does not start

- **Your browser needs WebGPU.** Chrome or Edge 113 or later, Firefox 141 or later on Windows, Safari 26 or later.
  A browser without it shows nothing to render with.
- **It needs a real graphics card.** A software adapter (a virtual machine, a remote desktop without the GPU) is for
  tests only.
- **Served from a file, it does not work**: the page must come from a web address (`http://localhost` counts), not
  a `file://` path.
- **A scene that cannot compile does not stop the page.** It starts on an empty scene instead and says why. If a
  start ever hangs, add `?safe` to the address: the page starts without compiling your scene, so you can fix or
  delete it.

## The picture is black, white, or far too dark

- **Exposure**: see [Light, environment and camera](light-camera.md#how-bright-the-picture-is-exposure). A room lit
  by a lamp is far darker than daylight, and the meter has to follow.
- **Lamps only** is on (Render settings menu) and the scene has no lamps of its own.
- **The sun is below the horizon** (elevation under 0) and there is no other light.
- **Everything is inside something**: a camera inside a closed box sees its inside. Hide groups with the eye to find
  which.
- **The scene's radius is smaller than the scene**: what is beyond it is not drawn.

## It is slow

See [How fast it is](rendering.md#how-fast-it-is). Switch **⚡** or **Sketch** on while modelling. Look for a relief
on a large surface, a noisy modifier, or a shape that many rays graze.

## It is noisy

The picture gets cleaner the longer it stands still, roughly halving its noise for every four times the samples.
What stays noisy longest:

- small, bright lights seen through glass;
- caustics;
- light that reaches a room only by bouncing.

The **High** preset helps with chains through glass. The firefly clamp removes single bright specks, at the cost of a
little energy.

## The compile takes long

The first compile of a scene can take tens of seconds on a large scene. The bar over the picture says how far it
has got. The bar's prediction learns your computer's speed as you go. A scene compiled before comes from the
browser's cache. The longer the scene's code, the longer the compile.

## A shape looks wrong

- **A small part far from the scene's origin looks rough**: the graphics card's precision is set by the distance
  from the origin. Keep small, precise parts near it ([How shapes are made](sdf.md#what-it-is-not)).
- **Holes or stripes in a shape with code of your own**: its distance is too large somewhere, and the rays step
  through it. A modifier that stretches space needs its *extent* set to how far its children reach.
- **A path or outline draws nothing**: a fillet is too large for its corner, or two points coincide. Points mode
  draws it red, with the reason ([Shapes from points](points.md)).

## Asking for help

**Help › Report** copies a report of the picture's light and the page's files to the clipboard. Paste it in a bug
report. **Help › Reload every file fresh** reloads past the browser's cache, for when an update seems not to have
arrived.
