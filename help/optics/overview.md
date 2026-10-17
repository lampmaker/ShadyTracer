# Optical design with ShadyTracer

Besides the picture, ShadyTracer has a second tracer for **measuring light**: a non-sequential Monte Carlo ray
trace over the same scene, with the same geometry and materials the picture uses. You model an LED, a lens, a
reflector or a light guide, put a **detector** where the light should go, and **▶ Run**: it traces many rays from
the lights to the end, and reports the illuminance on the detector, the intensity in the far field, the colour, and
where every lumen went.

## Two tracers, one scene

| | the picture | the optics trace |
|---|---|---|
| traces | from the camera, and from the lights to the camera | from the lights, to the end |
| gives | an image in cd/m² | numbers: lux, cd, lm, colour, each with its error |
| sees | everything visible | sources, surfaces, **detectors** and **ray limiters** |
| runs | always, refining | when you press ▶ Run, or continuously with **Live** |

Because both march the same distance function, the picture and the numbers cannot disagree about the geometry. The
lights' rays also light the picture: a lens's spot on a screen shows in the picture at its real brightness.

## A first run

1. Open [LED, lens and screen](example:led-lens-screen.json): a 1 × 1 mm LED of 100 lm, a PMMA lens 25 mm across,
   and a screen 250 mm away whose material is a **detector**.
2. **Analysis › Analysis setup** ([open it](cmd:analysis.setup)) opens the Analysis pane.
3. Press **▶ Run**. The charts fill: the screen's illuminance map in lux, its profiles and rings, and the far field.
4. Move the lens up or down in the picture, and press ▶ Run again, or switch **Live** on to have the analysis follow
   each move.

## What is in this track

- [Light in numbers](units.md): lumens, candela, lux, cd/m², and colour as CCT, Duv and xy.
- [Sources](sources.md): light objects, their flux, distribution and colour; Zemax ray files.
- [Optical materials](materials.md): index, dispersion, colour depth, coatings, detectors and limiters.
- [The analysis setup](analysis.md): running, what feeds the far field, the detector map, Live.
- [The charts](charts.md): map, polar, I-γ, profiles, rings, encircled flux.
- [How far to trust the numbers](accuracy.md): error bars, noise, what has been checked against known answers.
- [What the optics trace does not do](limits.md): every known limitation, with where it is written.

The examples for **Optical design** (the Project panel: the project's name over the tree) each show one thing: an aspheric condenser, a Fresnel lens
beside a plano-convex one, a parabolic reflector, a light guide, RGBW colour mixing, a prism's dispersion, a
dichroic combiner, and an office's work-plane illuminance.
