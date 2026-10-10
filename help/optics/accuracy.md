# How far to trust the numbers

Every number the analysis gives is an **estimate from random rays**, with an error bar. This page is about reading
that error bar, and what has been checked against known answers.

## Error bars

A run is split into **batches**. Each number is the mean over the batches, and its **standard error** comes from how
much the batches disagree. That is an honest measure of the noise, not a formula assumed to hold.

- **Four times the rays halves the error.** It shrinks as 1 / √N.
- **Small bins are noisy.** A map cell or a far-field bin catches only the rays that land in it. A finer grid means
  fewer rays per bin.
- **The largest of many noisy bins reads high.** I max and E max pick the largest bin, so with too few rays they read
  above the truth, and the beam angle inherits it. The pane shows I max with its error and says so when the error is
  large. The remedies are more rays, a coarser grid, or rotational symmetry for a round beam.
- **Smoothing** (Gaussian or Epanechnikov) lowers a map's noise and keeps its total flux exactly, but blurs sharp
  edges.

## Checked against known answers

Each check below has a closed-form answer and was run on a real graphics card. The results are recorded in
`docs/TESTING.md`; the page's **Tests** panel runs them again on yours.

| check | what must hold | result |
|---|---|---|
| refraction | a slab at 0, 45 and 70°; total internal reflection; a ball; a wedge | within two standard errors; the wedge's angle to 2 × 10⁻⁶ °; every lumen accounted for |
| colour | a detector reads the colour a light was given | single lights to 10⁻⁸ |
| light in the picture | an optics source lights the picture at its real brightness | lux within the error bars; three LEDs mixed to 4000 K read 3999.9 K |
| photometry | a white floor under sun and sky reads ρE/π | 0.9984-1.0001 |

Built but **not yet run on hardware**: the far-field check (`optics-farfield`), the flux balance
(`optics-balance`), a disc light, the cosine law, and the error bar's own check. Until they run, treat beam angles and
intensities with the care any new measurement deserves: compare with a datasheet where you have one.

## Features built and not yet seen on hardware

Some optics features have passed every test that can run without a graphics card, but nobody has yet looked at them
on one (`FEATURES.md` lists each with its status):

- **coatings** (0.39.0);
- **dispersion** (0.40.0);
- **the manifold connection** (0.44.0), which joins light landing on a surface inside glass to the camera, through
  one refraction.

## Good practice

- Look at the **error bars**, not just the numbers. A difference smaller than two standard errors is not a
  difference.
- Run **more rays** for a final number than for a look: Live's rounds for adjusting, a long ▶ Run for the record.
- Check the **Totals**: light lost or still going at the interaction limit means the limits in *Advanced* are too
  tight for the system.
- **Compare with a known answer** when the design is new: a small bare LED over a detector gives E = I cos θ / d² --
  I its intensity towards the point, θ the angle of incidence there, d the distance -- which the map should
  reproduce within its error bars.
