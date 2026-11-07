# Materials

A material says how a surface looks: its colour, how rough or shiny it is, whether light passes through it, whether
it glows. Every object wears one. The scene's materials are listed under **Materials** at the bottom of the tree.
Select one to edit it; every object wearing it changes.

## Getting one

- **The Library** has many with real values: plastics, metals (gold, copper, brushed, turned and anodised
  aluminium, chrome, galvanised steel), glasses (soda-lime, flint, tinted, frosted), PMMA and polycarbonate, stone,
  wood, cork, concrete, leather, plaster and more. Drag one onto an object in the picture or in the tree.
- **The tree's Materials**: drag one of the scene's own materials onto an object's or a group's row.
- **+ on the Materials row** makes one from a starting point: diffuse, plastic, metal, mirror, glass or glowing.
- An object's Properties choose which of the scene's materials it wears.

## A group's material

A group can give one material to everything in it. Drag a material onto the group's row, from the Library or from
the tree's Materials, or choose it as the group's **material** in its Properties. Every object in the group wears it instead of its own, also inside groups
in the group.

To make one object an exception, drag another material onto it, or check its **own material** in Properties. A
group inside with a material of its own also keeps it. Each object remembers its own material underneath, so
choosing *(each its own)* for the group gives every object back what it had.

See [Material board](example:material-board.json) for the library's materials side by side.

## The fields

The main ones:

| field | low | high |
|---|---|---|
| **base colour** | the colour reflected (linear) | |
| **metallic** | 0: plastic, paint, stone, glass -- white reflections over a coloured body | 1: metal -- the reflection itself coloured |
| **roughness** | 0: mirror-sharp | 1: fully matte |
| **specular** | 0: no reflection at all (pure diffuse) | 0.5: the physical reflection for its index |
| **transmission** | 0: opaque | 1: glass, clear plastic |
| **ior** | | the index of refraction: 1.5 glass, 1.333 water |

The rest -- anisotropy for brushed metal, the Abbe number for colour fringes, the colour depth for tinted glass,
coatings, glow -- are in the [Material fields](../reference/materials.md) reference. Every field is live: drag it and
the picture follows. Three turn a feature on and compile the first time: the Abbe number, the colour depth, and a
coating.

## Optical features

Those three are also the scene's to have or not. The scene's row in the tree has a box, **optical features**, with a
switch for each:
- **dispersion**: the Abbe number;
- **absorption inside**: the colour depth;
- **coatings**: the coating box;
- **spectral optics trace**: the [Analysis pane](../optics/analysis.md)'s rays traced by wavelength rather than in
  colour (below). It has no field of its own.

A feature switched off is not traced at all, in the picture or on the Optics page, and its fields are not shown on any
material. Their values are kept: switch it on and they are back. The box says which materials have a value it is
hiding, for instance one a library glass brought in.

**Basic** switches the first three off, for a scene that needs no more than colour and glass. **Full**, the default and
every older scene, switches them on. **Expert** is Full with the spectral optics trace. Anything between reads Custom.
Each change is a compile and one undo step.

### The spectral optics trace

Off, the Analysis pane's rays carry a colour, as the picture's do: red, green and blue. On, each ray carries three
wavelengths, drawn afresh for every ray, and everything it meets is worked out at those wavelengths:
- a material's colour, as a smooth spectrum of that colour;
- a coating, at each wavelength rather than averaged over a channel (a dichroic's edge falls where it is);
- dispersion, a ray taking one of its wavelengths at the first glass with an Abbe number.

A detector then knows the [spectrum](../optics/charts.md#spectrum) it received, and its colour rendering index. A
light given by its spectrum is traced with that spectrum, and one given by a CCT with Duv 0 as that blackbody. Any
other light, a ray file's included, is traced as a spectrum of its exact colour, which the Spectrum chart says.

The picture stays in colour whichever way this is set: it changes only the Analysis pane's trace.

## Glowing

A **glowing** material makes any shape a light. Its brightness is a luminance in cd/m²: 300 is a monitor, 5000 a
frosted bulb, 20 000 a fluorescent tube. The renderer finds glowing surfaces by itself and samples them as lights.

For a lamp whose output in lumens matters, use a **light object** instead ([Lights and camera](light-camera.md)):
a flat rectangle or disc whose flux is exact.

## Patterns: material code

A material can have **code** that runs where a ray hits it and changes its fields from the hit point: wood's rings,
marble's veins, a checker, brushed metal's grain. The library's patterned materials are all code. Open one's *code*
box to see it. A pattern's sizes are its own parameters, in **real millimetres** whatever the scene's unit, so a wood
grain is a wood grain on a 2 m table and on a 20 mm block.

## Turning a pattern: the pattern frame

A pattern is laid out in its **object's own frame**, so it moves and turns with the object. Wood's log runs along the
object's z, brushed metal's strokes along its x. One material on several objects then runs the same way on each:
along a table leg's length, but through its top's thickness, so the top shows end grain.

Each object has a **pattern frame** under its placement in the properties: *pattern at* moves the pattern and
*pattern turn* turns it (degrees about x, then y, then z, like the rotation), in the object's own frame. The shape
stays where it is. Turning the table top 90° about y lays the log along its length, as in
[Lighting a room](example:lighting-room.json). The first value you change gives the object a pattern frame, which
takes a moment to compile. After that it updates as you drag. *Take it away* puts the pattern back in the object's
own frame.

It moves everything the material lays out from the hit point: the pattern in its code, a grain's direction, and its
**relief**. Only a material that reads the point (`p_local`, `R_local`) or has a relief changes. A plain colour looks
the same however it is turned. In a group that makes its children into one shape (a subtraction, an
intersection, a blend, a round, a shell), the material is laid out in the **group's** frame, so give the group its
pattern frame. The
box on one of its shapes says so, and there it moves only that shape's relief.

## Pictures

A material can show a **picture**: a PNG, JPEG or WebP, up to 4096 pixels on its longer side (a larger one is scaled
down, and the console says so). In a material's Properties, **pictures** › **+ picture…** chooses one. The picture is kept
in the scene, so a saved file, an exported scene, a copy and a library item all carry it.

**What it does.** The first picture is the material's colour:
- on a surface, its **base colour**;
- on a **glowing** material, its **glow**. A white pixel glows at the material's luminance, a pixel half as bright half as
  much, and a black one not at all. It works like a screen showing the picture at that brightness: 200 cd/m² is a
  television, 300 an office monitor.

Where the picture is transparent, the material's own colour or glow shows. A second picture, or one set to *code only*,
is for the material's code: `sample(picture)` is the picture at the hit, `mapped(picture)` the position on it, and
`sampleAt(picture, uv)` the picture at a position of your own ([Functions for code](../reference/code.md#a-materials-pictures)).

**Where it goes.** A shape has no built-in picture coordinates, so the picture is projected onto it, in the object's
[pattern frame](#turning-a-pattern-the-pattern-frame). It moves and turns with the object, and *pattern at* and *pattern
turn* move and turn it like any pattern. The **projection** says how:
- **planar**: along the frame's z, the picture's top towards +y. For a screen, a sign, a poster or a floor.
- **box**: one of six faces, picked by the direction the surface faces. Each reads the right way round from outside.
- **triplanar**: the three directions blended, for stone or concrete on any shape with no visible seam.
- **cylindrical**: round the frame's z. Across the picture is the distance round in mm, so a label of 207 mm goes once
  round a 66 mm can.
- **spherical**: the whole picture once over a sphere.

Then the picture is placed:
- **width** and **height** are one copy, in real millimetres whatever the scene's unit; *Height from the picture's
  shape* keeps its proportions.
- **offset** is where its centre is, in mm, and **turn** turns it in its own plane.
- **wrap**, across and up separately: *repeat*, *mirror* (every other copy flipped, so the edges meet with no seam),
  *clamp* (the edge pixels go on) or *none* (one copy, the material's own value outside it).
- **filter**: *smooth* mixes between pixels; *pixels* keeps each one a sharp square, for an LED wall or pixel art.
- **faces**, for planar: the *front* faces only (where the surface faces +z), *both* (the back mirrored, as a slide seen
  from behind) or *all*.
- **colour (sRGB)**: on for a colour picture. Off reads it as data, for a roughness map or a mask.

Every one of these is live. Choosing another picture, renaming it, changing its use or taking it away is a compile.

**A glowing picture's dark parts.** A black pixel emits nothing, so there the material is not a light, and its surface
shows. A glowing material with a picture keeps a surface's base colour, metallic, roughness and specular for that. They
start as a screen's dark glass, so a black pixel looks like a switched-off screen reflecting the room. A pixel that
glows reflects nothing, as every glowing surface: on a real screen the reflection is small next to the glow.

Try [Pictures](example:pictures.json): one test card on a glowing screen, on a poster, round a can and on a ball.

## Relief

A material can have a **relief**: a height on the surface of everything that wears it, in real millimetres. Plaster,
stucco, hammered metal, leather and stone in the library have one. Unlike a pattern, a relief is **shape**: it shows
in the silhouette and casts its own small shadows. That makes it costly: it is evaluated at every step of every ray
that comes within two of its heights of the surface, so a scene full of relief renders more slowly.

Compare them in a low, raking light: [Relief and texture](example:relief-texture.json).

### A relief from a picture

A material's picture can be its relief: in the **relief** box choose **from a picture:** and the picture's name. Its
luminance (times its alpha) is the height, so white is `amplitude` mm up and black is the surface itself. *raise* -1
engraves it instead. It is placed by the picture's own width, height, offset, turn and wrap, read **planar** along the
object's z whatever the picture's projection, and on every face: the sides of a box show its edge unless the wrap is
*none* and the picture has a black border.

- **Smooth:** the height between pixels is a smooth curve through them (a cubic B-spline). Shading does not show the
  pixel grid, and sharp edges come out slightly rounded.
- **Safe to march:** how steep the relief can be is worked out from the picture's own pixels when it is read, so a ray
  never steps through it. A steep picture, small and high, makes the march take more steps near it.
- **16 bits:** a 16-bit greyscale PNG keeps all of its 65 536 heights; any other picture has 256, a step of
  amplitude / 255. For a tall relief under a raking light, use a 16-bit height map.
- **Its cost:** sixteen reads of the picture at every march step near the surface, on top of what a relief costs.

To show the picture's colour without the relief, or the relief without the colour, set the picture's **use** to
*code only*: the relief still reads it. [Pictures](example:pictures.json) has an embossed plaque made this way.

## Realistic values

- **Nothing is perfectly white or black.** White paint typically reflects about 0.8-0.9, charcoal 0.03-0.05. A base
  colour of 1 makes a surface that returns all the light it gets, which nothing real does.
- **Metals take their colour from the base colour** with metallic 1: gold's is its yellow reflectance.
- **Glass is transmission 1, roughness 0**, with its index; frosted glass is the same with roughness about 0.3.
- **Thick and thin glass differ** only with a colour depth set: without it, every crossing tints the same.
