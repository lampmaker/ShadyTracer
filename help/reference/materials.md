# Material fields

> Made by `help/reference.mjs` from the program's own lists: edit that, not this page.

What each field of a material does. Every field is live -- a slider moves the picture with no compile -- except where it says a compile. A material can also have code (a pattern, computed where a ray hits) and a relief (a height on the surface, which is shape). Lengths in a material are real millimetres whatever the scene's unit.

## Fields

| field | panel label | does |
|---|---|---|
| baseColor | baseColor | The surface's colour, linear (not sRGB): how much of each of red, green and blue it reflects -- for a metal, its reflectance head-on; for glass, the tint each crossing gives (or, with a colour depth, the colour at that depth). |
| metallic | metallic | 0 a dielectric (plastic, paint, stone, glass): white reflections over a coloured body. 1 a metal: no body, the reflection itself coloured. In between is rarely physical. |
| roughness | roughness | How rough the surface is at a scale too small to model: 0 a mirror-sharp reflection, 1 fully matte. |
| anisotropy | anisotropy | Roughness different along and across a direction -- brushed or turned metal. 0 the same every way; the direction is the material code's `m.tangent`. |
| specular | specular | How strong a dielectric's reflection is: 0.5 the physical value for its index of refraction, 0 none at all (a pure diffuse surface), 1 twice. |
| specularTint | specularTint | Tints a dielectric's reflection with its base colour: 0 white, as real plastics and paints reflect. |
| transmission | transmission | How much light passes into the material instead of being scattered off it: 1 glass and clear plastics, 0 everything opaque. |
| ior | ior | The index of refraction, at the d line (587.6 nm): 1.5 a typical glass, 1.333 water, 1.49 PMMA, 1.586 polycarbonate. Sets how much a transparent material bends light and how strongly it reflects. |
| abbe | Abbe number (dispersion) | The Abbe number V_d -- how much the index changes with colour: 0 none (no dispersion), 64 a crown glass (BK7), 36 a flint, 30 polycarbonate. Lower spreads colours more. Turning it on is a compile. |
| attenuationDistance | colour depth (mm) | The colour depth, in real mm whatever the scene's unit: light that has travelled this far inside has been filtered to the base colour, so a thick part is darker than a thin one. 0 off: each crossing tints by the colour, whatever the thickness. Turning it on is a compile. |
| coating | coating | A thin-film coating whose reflectance replaces the surface's own: none, on the faces light enters by (the back anti-reflective, or bare), or on every face. Putting one on is a compile. |
| coatLow | R below edge | The coating's reflectance below its edge wavelength (0..1). |
| coatHigh | R above edge | The coating's reflectance above its edge wavelength (0..1). |
| coatEdge | edge (nm) | Where the coating switches, in nm, head-on. At an angle it moves to shorter wavelengths, as real interference filters do. |
| coatWidth | edge width (nm) | How sharp the switch is: nm from 10 % to 90 % of the way. |
| coatIndex | stack index | The coating stack's effective index: how fast the edge moves with the angle -- higher moves it less. |
| emissive | colour | An emitter's colour. Only its hue counts: the brightness is the luminance. |
| emissiveLuminance | luminance (cd/m²) | An emitter's brightness in cd/m²: 300 a monitor, 5000 a frosted bulb, 20 000 a fluorescent tube, 1.6 billion the sun. |

## Starting points

The Properties panel's **+** makes a material from one of these: *diffuse*, *plastic*, *metal*, *mirror*, *glass*, *glowing*. The Library has many more, with real values.

## Coating presets

- **dichroic: reflects red**: R below edge 0, R above edge 1, edge (nm) 600, edge width (nm) 20, stack index 1.8
- **dichroic: reflects blue**: R below edge 1, R above edge 0, edge (nm) 500, edge width (nm) 20, stack index 1.8
- **beam splitter 50/50**: R below edge 0.5, R above edge 0.5
- **anti-reflective**: R below edge 0, R above edge 0

## Reliefs

A relief is a height on every object wearing the material, in real mm -- part of the shape, so it shows in the silhouette, and paid for at every march step near the object.

### noise relief

Noise relief: bumps up to "amplitude" mm high and deep, about "size" mm across -- four octaves of gradient noise (lib/pathtracer/core/noise.js), in real millimetres on the object. Four noises per march step near the surface. slope is the MEASURED gradient bound (a quarter of the proved one, NZ_GRAD_LIP, and a quarter the steps); the normal is taken by differences.

### ripple

Ripple: three crossed waves "amplitude" mm high, "wavelength" mm apart. Three sines per step.

### hammered

Hammered: a dent "amplitude" mm deep in every cell of a Worley pattern "size" mm across, with the ridges between them sharp, as a hammer leaves them. F1 grows at most 1 per cell, so the dent's slope is at most 2 amplitude / size.

### 3D-print layers

3D-print layers: a bead of plastic every "layer" mm up the SCENE's z -- the build plate is its z = 0, so the layers stay level and line up across parts however they are turned or joined; for a part printed lying another way than it is shown, read the object's own z, q.z, in place of world.z. Each bead rounded -- a parabola across it -- with a groove "amplitude" mm deep where it meets the next, and a little fuller or flatter than the next, by up to "variation" of it, as a printer's extrusion is never quite even; pinned at the grooves, so the height is continuous and its slope is at most 4 (1 + variation) amplitude / layer, at a groove. this layer's own number: value noise at a lattice point is that point's value, in [-1, 1]

