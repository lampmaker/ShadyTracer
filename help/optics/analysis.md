# The analysis setup

**Analysis › Analysis setup** ([open it](cmd:analysis.setup)) shows or hides the **Analysis pane**: it starts a
run, says what the charts are made from, and holds the results. The charts are panels of their own (**Analysis ›
New chart ▸**, **Open chart ▸**), and the **Analyse** layout (its button on the menu bar) shows them all beside the pane.

## Running

The run bar at the top:

- **how many rays**: a number times a multiplier (thousands, millions). More rays, smaller error bars: four times the
  rays halves them.
- **▶ Run** traces them, every ray to the end, in batches, and fills every chart. Each number is the mean over the
  batches, with its **standard error** from their spread.
- **Live** runs the analysis again and again, that many rays a round, and every chart follows as you move things: the
  way to adjust a lens's position by eye. **Σ** beside it adds the rounds up instead of showing each alone, for
  numbers that get steadily better while nothing moves.

## The rays in the picture

Separately from the analysis, the view's **analysis drawer** (bottom right) has **RAYS**: a few thousand rays from
the sources drawn over the picture and traced again every frame, so they follow every move. They are coloured by the
flux they still carry, by step, or by their light's colour. A **path length** slider sweeps the light through the
system as a front. They are for seeing what the optics do. Nothing they trace reaches a chart.

## Intensity: what feeds the far field

The far field is the luminaire seen from far away: its intensity in each direction, on a **type C** grid (C, γ):
γ the angle from the axis, C the angle about it.

- **from**: the rays that **escape** the scene, or the rays reaching one **detector**. A closed scene, such as a
  room, lets nothing escape, so it needs a detector. A detector also lets you count only the light through the lens,
  not the light off the mount.
- **axis**: γ = 0 along a light's +z (where it shines), or its −z with **flip direction**, or a direction you type.
- **γ step**, **C step**: the grid. A finer grid means smaller bins, each with fewer rays and more noise.
- **unit**: cd, or cd/klm.
- **rotational symmetry**: pool every C plane, for a round beam; much less noise.

A ray is binned by its **direction only**: the far field assumes you look from much farther than the luminaire is
large.

## Map: what the map is of

- **of**: a **detector** of the scene, or the **far field on a plane** at a distance you give: a virtual screen
  computed from the far field without tracing again. The virtual plane is exact for a point source, square to the
  axis.
- **area**: the whole detector, or only its lit area.
- **cells**: 8 to 256 across. More cells are finer, with fewer hits each and more noise.
- **smoothing**: none, Gaussian or Epanechnikov over a width in cells (both keep the flux exactly), or the k nearest
  hits.

## The results

Under the run bar are cards with the main numbers, such as:

- **E max, mean and min**, **U0** (min / mean) and **Ud** (min / max), the lit area;
- **I max**, the beam angle (where the intensity falls to 50 %) and field angle (10 %), the zonal flux, the optical
  efficiency;
- the **colour** of what arrived: CCT, Duv, xy, and its uniformity Δu′v′.

Folded below them:

- **Sources**: a summary of the scene's lights.
- **Totals**: every lumen emitted, escaped, absorbed, on detectors, lost, per object and per material, each ± its
  error. Every lumen is booked: the totals account for all that was emitted.
- **Advanced**: the maximum optical distance, interactions per ray, march steps, the surface tolerance.

Every chart and table can be saved: the intensity table, the illuminance map and every detector hit as **CSV**, and
any chart as a **PNG**.
