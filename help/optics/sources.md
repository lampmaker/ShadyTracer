# Sources

Every source of the optics trace is a **light object** in the scene (**+ › Lights**): a **rectangle**, a **disc**,
or a **ray file**. A shape with a glowing material lights the picture, but it is not an optics source: the trace has
to know a source's shape exactly to start rays on it.

## Placing one

A rectangle or disc emits from its **front face, its +z**. Place and turn it with the handles, as any object. Its
size is its parameters: the rectangle's width and height, the disc's radius. An LED die is a rectangle of the die's
size, for example 1 × 1 mm.

## How much light

- **flux** in lumens: the whole output. Set it and the face's luminance follows from its area, so resizing the die
  keeps its lumens;
- or **luminance** in cd/m²: how bright the face is. Set it and the flux follows.

Each ray from a source carries an equal share of the total flux of all sources, so a source of twice the lumens
sends twice the rays.

## Which way the light goes

| distribution | is | for |
|---|---|---|
| **cosine**, n = 1 | Lambertian: intensity ∝ cos θ | an LED die, a diffuser, a panel |
| **cosine**, n > 1 | cosⁿ θ: narrower as n grows | a lensed LED, roughly |
| **uniform** | the same intensity in every direction of the cone | |
| **collimated** | one direction, along +z | a laser; light from very far |

**half angle** limits any of them to a cone about +z (90° is the whole hemisphere).

## Colour

As **RGB**, as **CCT + Duv**, or as **CIE xy**, carried exactly ([Light in numbers](units.md#colour)). Several sources
of different colours mix exactly: [RGBW colour mixing](example:rgbw-mixing.json) has four. **Analysis › Colour
mixing** picks three of the scene's lights, a target colour and a total flux, and sets their fluxes for it, in one
undo step.

## The rest

- **two-sided**: both faces emit; otherwise the back is black and stops light.
- **transparent**: rays and the camera pass through the face. Use it for a source in front of something.
- **emits into n**: the index of what the face emits into: 1 in air, about 1.41 for a die in silicone. It sets how the
  light refracts as it leaves.

## Zemax ray files

A light of shape **ray file** reads a **Zemax OpticStudio binary source file** (`.DAT`), as LED makers publish them:
flux-only and spectral records, in any of their units, in the file's own placement. Place it with its handles. Its
flux is the file's unless you give one. The file is kept in the browser by its name, so a reload keeps it. A
malformed file is refused, with the numbers that are wrong.

A ray file has no face: the camera does not see it glow, and only its rays light the picture. With **Render ›
Lights' rays** off, it lights nothing ([limits](limits.md)).
