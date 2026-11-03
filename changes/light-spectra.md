bump: minor

**A light can be given by its spectrum.** *Colour by* has a fourth way, **spectrum**, beside RGB, CCT + Duv and xy.
- **A blackbody** at a temperature.
- **Peaks**: one a line, *nm FWHM weight*. One peak is a single-colour LED; a blue die and a broad phosphor hump make
  a white one.
- **A measured table** of nm against relative power, pasted or loaded with *Load CSV…*. The table may use commas,
  tabs or semicolons; with semicolons it may use decimal commas, as a European spreadsheet writes them.

**How it is coloured.** The colour is what the CIE 1931 2° observer's own table makes of the spectrum: the CIE's file
at 1 nm, now in the repository under its CC BY-SA 4.0 licence. The colour is carried exactly, as a chromaticity is,
and is live, with no compile. The readout under the colour also gives the light's luminous efficacy of radiation, in
lm per radiated watt.

**Typing a spectrum.** Peaks and tables are checked as you type. A problem is said at its line and column, and
nothing is put in until the text reads clean.

**Starting points.** *Start from* offers blackbodies, CIE illuminant A, single-colour LEDs (450, 470, 525, 590, 630
and 660 nm) and a white LED at 3990 K. These are models, not datasheets.

**Ray files with wavelengths.** A Zemax ray file with a wavelength per ray (its format 2) now takes the colour its
rays add up to; the panel shows it under the file's numbers. A flux-only file stays white, whatever wavelength its
header names, because many photometric files put a placeholder there.

**What it does not change.** The light is still traced as that colour, not wavelength by wavelength: that is S2 in
`roadmap/LIGHT_MODEL.md`. `lib/pathtracer/core/spd.js`, `core/cie1931.js`, `builder/lights.js`.

**What to look at:**
- A light set to *start from › LED red 630 nm* should look red. The Optics page's detector should read about x 0.704,
  y 0.296.
- A blackbody at 2700 K should match *CCT + Duv* at 2700 K, 0.
- Paste a CSV of a real LED's spectrum and check that its colour is the datasheet's.
- Run Tests › optics-colour: its two new rows, a deep red LED and a white LED given by their spectra, should read
  du'v' near 0.
- Load a spectral Zemax file, if you have one: it should show its colour.
