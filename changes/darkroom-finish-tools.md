bump: minor

**The Darkroom's finishing tools and its recipe: output gamma, Levels, a Curves editor, colour wheels, vignette, grain
and dither; undo and redo, copy and paste, presets, and settings read back from a saved picture.** After the tone curve,
the picture now goes through these, in this order:
- an **output** transfer: sRGB as before, gamma 2.2, gamma 2.4 or linear;
- **Levels**: input black and white, a gamma for the midtones, output black and white;
- **Curves**: master, then red, green and blue, each drawn by hand in the side column. A click adds a point, a drag
  moves it, a double-click or a drag out of the square takes it away. **Luminance** puts the master curve on brightness
  alone, so colours keep their hue. The curves are monotone cubics (Fritsch–Carlson), so a curve never swings past its
  points (`lib/pathtracer/darkroom/curves.js`, `curveeditor.js`);
- **Colour wheels**: lift, gamma and gain (shadows, midtones, highlights). Drag a disc's dot towards a colour to tint
  that part of the picture, and use a slider each for its brightness. They are applied as an ASC CDL
  (`darkroom/wheels.js`, `grade.js` `cdlFromWheels`);
- the old contrast, saturation and brightness, unchanged;
- **Finish**: a **vignette** on the light, darkening or brightening towards the corners as a lens does (its strength
  in stops, where it starts, how round); **grain**, fixed to the picture's pixels so it is the same in every preview and
  save; and **dither** for the 8-bit files, against banding (off by default; never in the 16-bit PNG).

**The recipe** (`darkroom/recipe.js`):
- **Undo** and **Redo** for the look: the buttons, or Ctrl+Z and Ctrl+Y while the Darkroom has focus. The scene's own
  undo is left alone.
- **Copy** and **Paste** of the settings.
- **Presets** kept in this browser: apply one, save as, delete.
- **From a picture…**: the settings a PNG the Darkroom saved was developed with, read back out of the file.

An untouched develop is still the view's picture to the bit, held on Dawn with the new code in place. Each stage is
held to its JavaScript twin, and the grain and dither are held to the same hash as their twin's
(`lib/pathtracer/test/develop.gpu.mjs`).

**What to look at:** Levels' gamma on a flat picture. An S-curve, then Luminance, on a saturated one. A blue lift and a
warm gain on the same picture. A vignette at −1 stop. Grain at 100 %. Dither on a smooth gradient with a steep curve, in
an 8-bit PNG. Undo and redo after several changes; Ctrl+Z in the Darkroom does not undo the scene. A preset saved,
another look made, the preset applied. A PNG saved, every setting changed, then From a picture… with that PNG. An
untouched save as before.
