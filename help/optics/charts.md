# The charts

Seven kinds of chart, each a panel of its own. Open them from **Analysis › Open chart ▸**, or all at once with **Layout:
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

## Spectrum

What the map's detector received by wavelength, 380 to 780 nm: the whole detector, or the part of it the map is zoomed
to. The area under the line is filled in each wavelength's colour, and the eye's sensitivity (ȳ) is drawn faintly behind
it. **rel** shows the power relative to its peak, **W/nm** in watts per nanometre. Point at it to read a wavelength.

Under it: the light's **xy**, **CCT** and **Duv**, its colour rendering index **Ra** and **R9** (CIE 13.3) with
their error bars, its watts and how many hits it is made of. The index is read from the spectrum in 5 nm bins. With few
hits that spectrum is noisy, and noise reads as a lower index, so run more rays until the error bar is small. Past a
Duv of 0.0054 CIE 13.3 calls the index meaningless, and the readout says so.

It needs the [spectral optics trace](../modelling/materials.md#the-spectral-optics-trace), one of the scene's optical
features (or **Expert**). Without it the chart says where to switch it on. It saves as a **CSV** of nm and W/nm.

## Polar

Luminous intensity against angle, in **C planes** about the photometric axis (*planes*: `0, 90` by default, up to
nine), linear or logarithmic, with a band of ±1 standard error. The convention of a luminaire's polar diagram: each
plane through C and C + 180.

## I – γ

Intensity against γ, each C plane a line, zooming itself to a narrow beam. The beam angle (50 %) and field angle
(10 %) read off it are in the Analysis pane's results.

## Saving

Each chart saves as a **PNG**. The far field's intensity table, the illuminance map, every detector hit and the
spectrum save as **CSV**, for a spreadsheet or another tool.
