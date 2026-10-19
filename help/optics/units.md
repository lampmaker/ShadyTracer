# Light in numbers: units and colour

Everything about light in ShadyTracer is in photometric units, the ones a lighting datasheet uses.

| quantity | unit | what it is | where you meet it |
|---|---|---|---|
| luminous flux | **lm** (lumen) | the total visible light a source sends out | a light object's *flux*; the totals |
| luminous intensity | **cd** (candela) = lm/sr | flux per solid angle, in one direction | the far field, polar diagram, I-γ |
| illuminance | **lx** (lux) = lm/m² | flux arriving per area | the detector map; *lux on surfaces*; the sun and sky |
| luminance | **cd/m²** | how bright a surface looks, from a direction | a glowing material; a light's face; the picture |

Some reference values:

- a clear noon sun gives about 100 000 lx, and the sky alone about 15 000 lx;
- an office desk is asked for about 500 lx;
- a monitor is about 300 cd/m², a frosted bulb about 5000.

**cd/klm**, candela per 1000 lumens, is the intensity of a luminaire scaled to its output, as photometric files give
it. The far field offers it.

## Lengths, and what they do to the numbers

A scene's numbers are in its unit (m, cm or mm). The engine works in metres inside: lux is lumens per square
**metre** whatever the scene's unit, and a map's distances are in metres. Changing a scene's unit while keeping the
real size (scaling the objects, or converting their dimensions) changes no reading. Keeping the numbers makes the
scene bigger or smaller, so a light of fixed lumens gives a different illuminance on a detector that has grown or
shrunk.

## Colour

A light's colour can be given three ways, each exact:

- **RGB**: a hue, linear;
- **CCT and Duv**: a colour temperature in kelvin, and how far from the black-body line (positive greener, negative
  pinker), as white LEDs are specified;
- **CIE 1931 xy**: a chromaticity, as a coloured LED's datasheet gives it.

Colours are carried exactly through the trace, **even outside the display's gamut** (a royal blue LED): only the
picture clips them, once, at the screen. A detector reads what arrives as CIE xy, u′v′, CCT and Duv. Three LEDs mixed
to 4000 K read 3999.9 K (checked: `README.md`, *Light in physical units*).

**Colour uniformity** is Δu′v′: how far a point's chromaticity is from the whole's. Colour maps show CCT, x, y, Duv
or Δu′v′ per cell.

## Limits of the colour model

Colours are three channels, not a spectrum. That is exact for light that only adds, through clear lenses, white
reflectors and metals. A **coloured filter** multiplies three numbers, which approximates its spectrum. A
**coating**'s edge is averaged over each channel's wavelengths. **Dispersion** gives each refracted ray a wavelength.
See [What the optics trace does not do](limits.md).
