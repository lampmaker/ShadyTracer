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

A light's colour can be given four ways, each exact:

- **RGB**: a hue, linear;
- **CCT and Duv**: a colour temperature in kelvin, and how far from the black-body line (positive greener, negative
  pinker), as white LEDs are specified;
- **CIE 1931 xy**: a chromaticity, as a coloured LED's datasheet gives it;
- **spectrum**: a blackbody at a temperature, Gaussian peaks (an LED's die, a phosphor's hump), or a measured table
  of nm against relative power from a CSV. Its colour is what the CIE 1931 2° observer's table (the CIE's own, at 1 nm)
  makes of it, and the panel draws it and says its **luminous efficacy of radiation**, lm per radiated W, and its
  **CRI**. It is traced as that colour, unless the scene traces the Analysis pane's rays
  [by wavelength](../modelling/materials.md#the-spectral-optics-trace): then by its spectrum.

A **Zemax ray file with a wavelength per ray** (its format 2) takes the colour its rays add up to, each at its own
wavelength and by its flux. A flux-only file stays white, whatever wavelength its header names, because many
photometric files put a placeholder there. **In the picture** each ray of such a file lights what it reaches in its
own wavelength's colour, so where the colour of the light changes with direction (a white LED bluer straight on and
yellower to the side, say) the picture shows it. Glass refracts each such ray at its own index, and a coating reflects
it as its edge does at that wavelength. A ray outside what the eye sees carries no light. In a file in lumens each
ray's flux is its luminous flux; in one in watts its luminous flux follows from its wavelength. The light's flux stays
what you set, or the file's. Rays of single wavelengths add up to their colour only over many of them, so the picture
starts out speckled in strong colours and settles as samples add up. The Analysis pane's own trace still traces such a
file in its overall colour.

Colours are carried exactly through the trace, **even outside the display's gamut** (a royal blue LED): only the
picture clips them, once, at the screen. A detector reads what arrives as CIE xy, u′v′, CCT and Duv. Three LEDs mixed
to 4000 K read 3999.9 K (checked: `README.md`, *Light in physical units*).

**Colour uniformity** is Δu′v′: how far a point's chromaticity is from the whole's. Colour maps show CCT, x, y, Duv
or Δu′v′ per cell.

## Limits of the colour model

Colours are three channels, not a spectrum, unless the scene traces [by wavelength](../modelling/materials.md#the-spectral-optics-trace). That is exact for light
that only adds, through clear lenses, white reflectors and metals. A **coloured filter** multiplies three numbers, which
approximates its spectrum. A **coating**'s edge is averaged over each channel's wavelengths. **Dispersion** gives each
refracted ray a wavelength. See [What the optics trace does not do](limits.md).
