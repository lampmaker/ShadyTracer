# What the optics trace does not do

This is every known limitation, with where it is written down in the repository. Read it before you trust a number
for a design decision. Most items are planned (`roadmap/PLAN.md`); none of them is hidden.

## What kind of tool this is

ShadyTracer's optics trace is **non-sequential**: rays go wherever the geometry sends them, through any number of
surfaces in any order, including stray light, ghost reflections and light lost to mounts. That suits LEDs and
luminaires, light guides, reflectors, and an illumination system's efficiency and uniformity.

It is **not a sequential lens-design program**. There are no lens prescriptions, no ray fans, no spot diagrams, no MTF
or wavefront analysis, no tolerancing and no optimiser. You can see a lens's spot on a detector and its encircled
flux, but not its aberrations as numbers. For imaging-lens design, use a sequential tool. Use this one to put the
result into a luminaire and see where the light goes.

## Light is three colour channels, not a spectrum

`lib/pathtracer/optics/README.md`, *Colour*; `FEATURES.md` §3.

- Light is carried as **linear RGB**, exact for light that adds and passes through neutral optics: clear lenses,
  white reflectors, aluminium.
- A **coloured material multiplies the three channels**: a filter's spectrum is approximated by three numbers.
- A **coating's edge** (a dichroic) is averaged over each channel's wavelengths. That assumes the light in a channel is
  spread over its wavelengths as the channel's weights say, whatever the source really emits. A beam splitter's and
  an AR layer's reflectance is flat, so they are exact. The exact method, a wavelength per ray from the source's
  spectrum, is planned.
- **Dispersion** gives a refracted ray a wavelength and its colour. Detectors read the colour (XYZ) of what arrives,
  not the wavelength.
- A Zemax ray file's spectral records are read, but light is still carried as colour, not as a spectrum.

## Physics not yet in the trace

`FEATURES.md` §3.7, *Physics not yet in the optics trace*; `roadmap/PLAN.md`; `README.md`, *Not there yet*.

- **Absorption needs a colour depth.** With a material's *colour depth* set, light inside is filtered with the
  distance travelled (Beer-Lambert, since 0.37.0), and the totals book what the medium absorbed. At 0, the default,
  a coloured transmissive material tints once per crossing, whatever its thickness.
- **Rough glass loses a few per cent too much** to single-scatter masking (a furnace reading of 0.959), booked as
  absorbed by the frosted part: a textured lens reads a little too inefficient (`roadmap/PLAN.md`).
- **An LED's own face does not reflect**: light sent back onto a die is lost, where a real die returns part of it.
- **A light seen through its own lens** shows dark.
- **Air gaps thinner than the surface offset are jumped**. Two slabs closer than the tolerance read as one (measured).
  The workaround is to set the scene's *surface tolerance* (its Properties) by hand, smaller than the gap; or the
  optics trace's own (Analysis › Advanced), for the trace alone.
- **Polarisation is not traced.** Fresnel reflection uses unpolarised light. Against a polarised trace a slab reads
  −0.3 % at 45° and −3 % at 70° (measured).
- **The choice of source is not stratified**: with several sources of different colours, part of a mix's colour noise
  is only the random pick.

## Sources

`lib/pathtracer/optics/README.md`, *Sources* and *What is not here yet*.

- **Only light objects are sources**: a rectangle, a disc or a ray file. A shape with a glowing material lights the
  picture, but sends no rays into the optics trace and has no lumens.
- **A ray file has no face**: the camera cannot see it glow, and with the lights' rays off it lights nothing in the
  picture.
- **No IES or EULUMDAT files**, in or out. Export of the intensity table as IES and EULUMDAT is planned first, then
  import as a source. The intensity table saves as CSV meanwhile.

## The analysis

`FEATURES.md` §3; `README.md`, *Optics*.

- **The far field bins rays by direction only.** It is the luminaire seen from far away. Near a large luminaire it is
  not what a nearby screen receives: put a detector there instead.
- **The virtual plane** (a map of the far field on a plane) is exact for a point source and a plane square to the
  axis. For a large source, or a tilted plane, use a detector.
- **No point sensors or work-plane grids** yet. A work plane is a detector shape: [Office lighting](example:office-lighting.json)
  uses a rectangle at 0.75 m.
- **No glare metrics** (UGR) and **no colour rendering** (CRI, TM-30).
- An **isocandela map** and a reference run or datasheet overlay under the charts are planned.

## Precision

`lib/pathtracer/PRECISION.md`.

The graphics card computes in 32-bit floating point. The finest surface it can resolve is set by the distance from
the scene's origin, not by the unit:

| distance from the origin | finest surface tolerance |
|---|---|
| 1 cm | 0.15 µm |
| 10 cm | 1.5 µm |
| 1 m | 15 µm |
| 10 m | 0.15 mm |

- **Keep optics near the origin.** A lens 1 m from it cannot have features finer than about 15 µm.
- **The automatic tolerance is one number for the whole scene**, estimated from the scene's numbers, and errs coarse:
  a 0.4 mm sphere in an RGBW mixer scene was given 10.5 µm, 5 % of its radius. Set it by hand when small parts matter:
  the scene's *surface tolerance* (its Properties, saved with the scene), or Analysis › Advanced for the optics trace
  alone.

## Not yet confirmed on hardware

`FEATURES.md` lists every feature with its status. These optics features pass every test that runs without a
graphics card but have not yet been seen on one: **coatings**, **dispersion**, and the **far-field** and
**flux-balance** checks. See [How far to trust the numbers](accuracy.md).
