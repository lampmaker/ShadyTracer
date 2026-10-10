# The charts

Six kinds of chart, each a panel of its own. Open them from **Analysis › Open chart ▸**, or all at once with **Layout:
Analyse**. Each chart has a line of its own settings along its top, and a readout under the pointer.

- **⧉** makes another chart of the same kind with its settings, so you can compare an illuminance map beside a CCT map.
- **Analysis › New chart** makes one of any kind. An added chart can be removed with its **✕**.
- Pointing at one chart moves the marks on its siblings: an angle on the far-field charts, a place or a radius on
  the map's.

All of them are empty until **▶ Run** in the [Analysis pane](analysis.md).

## Map

A detector's map, or the far field on a virtual plane ([what it is of](analysis.md#map-what-the-map-is-of)). It
shows one of:

- **illuminance** in lux, with **isolux** lines;
- the **light's colour** as it arrived, with an exposure for its brightness;
- **CCT**, **x**, **y**, **Duv**, or **Δu′v′** from a target colour (the detector's own mix, a CCT and Duv, or an xy).

Hold the mouse button down and move to read a place: the profiles, rings and encircled flux go through that point.
**Shift-drag** zooms. **Double-click** shows the whole detector again.

## Profiles

The map along both of its axes, through its point, in what this chart is set to show.

## Rings

The map averaged over rings about its point: a radial profile. A round spot reads with the noise of a whole ring
rather than a line of cells.

## Encircled flux

The share of the map's flux within each radius of its point, with **r50** and **r90**, the radii holding half and
nine tenths of it: how tight a spot is.

## Polar

Luminous intensity against angle, in **C planes** about the photometric axis (*planes*: `0, 90` by default, up to
nine), linear or logarithmic, with a band of ±1 standard error. The convention of a luminaire's polar diagram: each
plane through C and C + 180.

## I – γ

Intensity against γ, each C plane a line, zooming itself to a narrow beam. The beam angle (50 %) and field angle
(10 %) read off it are in the Analysis pane's results.

## Saving

Each chart saves as a **PNG**. The far field's intensity table, the illuminance map and every detector hit save as
**CSV**, for a spreadsheet or another tool.
