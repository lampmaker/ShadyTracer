# Optical materials, detectors and limiters

The optics trace uses the same materials as the picture. These are the fields and types that matter for optics. The
[Material fields](../reference/materials.md) reference has them all.

## Refraction and reflection

- **transmission 1** makes a material transparent: glass, PMMA, polycarbonate.
- **ior** is its index of refraction at the d line (587.6 nm). Refraction follows Snell's law. How much is reflected at
  each surface follows the exact Fresnel equations for that index, and **total internal reflection** happens where it
  should: a light guide works by it.
- **roughness** above 0 scatters what passes through: frosted glass, a diffuser.

Checked against textbook answers: a slab at three angles, a glass ball and a wedge agree within two standard errors,
and the wedge's exit angle to 2 × 10⁻⁶ ° (`README.md`, *The trace*).

The library's optical materials, with catalogue values:

| material | n_d | Abbe number V_d |
|---|---|---|
| clear glass (soda-lime) | 1.52 | 59 |
| flint glass (Schott F2) | 1.620 | 36.4 |
| PMMA (acrylic) | 1.491 | 57 |
| polycarbonate | 1.586 | 30 |

## Dispersion

**abbe**, the Abbe number V_d, makes the index depend on the wavelength (a Cauchy fit through n_d and V_d). A ray
refracted into such a material takes a wavelength and that wavelength's colour, so white light fans out by colour. 0
is no dispersion. Lower is more. Turning it on compiles once.
See [Dispersion in a prism](example:prism-dispersion.json).

## Absorption: colour depth

**colour depth** (*attenuationDistance*), in real millimetres: light that has travelled that far inside has been
filtered to the base colour. A thick part absorbs more than a thin one. At 0 it is off, and each crossing tints by
the base colour whatever the thickness.

## Coatings

A **coating** replaces a surface's own reflectance with a thin-film stack's:

- **where**: the faces light enters by (the back anti-reflective, or bare), or every face;
- **R below** and **R above** an **edge** wavelength in nm, switching over a **width** in nm;
- a **stack index** that sets how the edge moves to shorter wavelengths at an angle.

Presets: dichroic reflecting red, dichroic reflecting blue, a 50/50 beam splitter, anti-reflective.
[Dichroic combiner](example:dichroic-combiner.json) joins a red and a blue beam with one.

A beam splitter's and an AR layer's reflectance is the same at every wavelength, so the trace is exact for them. A
dichroic's edge is averaged over each colour channel's wavelengths, which approximates the spectrum
([limits](limits.md)).

## Detectors

A material of type **detector** (the material's *type* in Properties) **stops every ray that arrives at it** and
records it: where, how much flux, from which direction, and its colour. The Analysis pane's map is made from these
hits. In the picture, a detector looks as its fields say, so it can be a visible screen, a wall or a work plane.

A detector stops rays whatever its fields say: it does not reflect or transmit them. A **rectangle** or **disc**
shape with a detector material makes a flat screen of no thickness.

## Ray limiters

A material of type **ray limiter** does what a detector does in the trace, and is **not in the picture at all**.
Use it to cut a beam where you want a cross-section, without anything showing in the render.
