bump: minor

**The Optics page can trace by wavelength, and a detector has a spectrum and a colour rendering index.**

**The spectral optics trace.** The scene's *optical features* have a fourth switch, **Spectral optics trace**. It is
off by default, and **Expert**, a new preset, is Full with it on. Full stays as it was.
- **Each Analysis ray carries three wavelengths of its light's spectrum** instead of a colour. They are drawn afresh for
  every ray, stratified through the eye's sensitivity (pbrt-v4's way; 1 200-2 700 rays for a colour within
  0.001 u′v′, computed).
- **A coating is worked out at each wavelength**, so a dichroic's edge falls where it is. The colour trace averages it
  over each channel, which in phase 0 read 6-10 % off in Y through edge filters on an LED.
- **A material's colour becomes a smooth spectrum of that colour.** Grey stays exactly flat.
- **A dispersive glass** collapses a ray to one of its wavelengths.
- **Which spectrum a light is traced with:** its own if it is given by a spectrum, a blackbody if it is a CCT with
  Duv 0. Any other light, ray files included, is traced as a spectrum of exactly its colour, and the chart says so.
- **The picture is not touched.** Its kernels are byte for byte what they were, and with the switch off the Optics page
  is the colour trace it always was. The spectral kernels are built from the colour trace's text with a few lines
  replaced, each found exactly once or the build stops. A detector hit is four numbers longer. Each switch is a
  compile and one undo step.

**The Spectrum chart**, a seventh kind in the Analysis pane (Analysis › New chart › Spectrum; in Layout: Analyse a tab
behind Encircled flux). It shows what the map's detector received, whole or zoomed, from 380 to 780 nm.
- The area under the line is filled in each wavelength's colour, with the eye's ȳ drawn faintly behind it.
- **rel** shows power relative to its peak, **W/nm** in watts per nanometre. Point at it to read a wavelength.
- Under it: xy, CCT and Duv, **Ra and R9 with their error bars**, the watts and how many hits it is made of.
- It saves as a CSV of nm and W/nm. Without the spectral trace it says where to switch it on.

**CRI**, by CIE 13.3, from the CIE's own tables (its 14 test samples and its daylight components, CC BY-SA 4.0, in
`lib/pathtracer/core/data`). It is checked against colour-science's implementation on the CIE's fluorescent and LED
illuminants: Ra within 0.04 and R9 within 0.2. Past a DC of 5.4e-3 it says the index means little. A light given by
its spectrum now has its **spectrum drawn** in its Properties, with "Ra · R9 · CCT · lm/W" under it. *Start from*
gains the CIE's nine LED illuminants (LED-B1 to B5, BH1, RGB1, V1 and V2).

`lib/pathtracer/optics/spectral.js`, `optics/spectrum.js`, `optics/spectrumchart.js`, `core/cri.js`,
`builder/materials.js` FEATURES; `roadmap/LIGHT_MODEL.md` S0 and S2. Not built yet: PPFD, melanopic EDI, TM-30, and a
ray file's own wavelengths.

**What to look at:**
- **Tests › optics-spectral**, a new row (Optics trace group). It covers a spectral LED's and a blackbody's exact xy
  through clear glass, a stand-in's, the dichroic of optics-coating by wavelength at 0° and 45°, and the CRI of CIE
  LED-B3 through glass against its own (84.8). On lavapipe every row read within 1.1e-3 of its ratio. On your card:
  the verdicts, and **how much longer the optics run takes** than optics-coating's at the same ray count.
- **The example *Dichroic combiner* with Expert pressed.** Its two lights are given by xy, so first the Spectrum chart
  should say they stand in as spectra of their colour. Then set them to *start from › LED red 630 nm* and *LED royal
  blue 450 nm*, and ▶ Run. The detector's spectrum should be two peaks at 630 and 450 nm, and its xy should agree with
  the map's colour.
- **A light set to *start from › CIE LED-B3*:** its Properties should draw the blue peak and the phosphor hump, and
  read about Ra 85 · R9 24 · 4103 K.
- **With the switch off:** the Spectrum chart says where to switch it on, and the Optics page reads exactly what it
  did before.
