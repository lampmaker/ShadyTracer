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

## Relief

A material can have a **relief**: a height on the surface of everything that wears it, in real millimetres. Plaster,
stucco, hammered metal, leather and stone in the library have one. Unlike a pattern, a relief is **shape**: it shows
in the silhouette and casts its own small shadows. That makes it costly: it is evaluated at every step of every ray
that comes within two of its heights of the surface, so a scene full of relief renders more slowly.

Compare them in a low, raking light: [Relief and texture](example:relief-texture.json).

## Realistic values

- **Nothing is perfectly white or black.** White paint typically reflects about 0.8-0.9, charcoal 0.03-0.05. A base
  colour of 1 makes a surface that returns all the light it gets, which nothing real does.
- **Metals take their colour from the base colour** with metallic 1: gold's is its yellow reflectance.
- **Glass is transmission 1, roughness 0**, with its index; frosted glass is the same with roughness about 0.3.
- **Thick and thin glass differ** only with a colour depth set: without it, every crossing tints the same.
