bump: minor

**The Darkroom's tools that work on the light: white balance with an eyedropper, a spot meter, channel gains, a tone
equaliser, saturation, vibrance and hue, and an adjustable filmic curve.** The grading the Darkroom had acts on the
encoded picture, after the tone curve has decided what is white. These act on the light before it, as a camera's raw
tools do (`lib/pathtracer/darkroom/grade.js` says why, and is their JavaScript twin). The Develop box is now a column of
boxes in the order the picture is made:
- **Exposure**: EV, Meter, and **Spot meter**. Click the picture, and a 9 × 9 patch there becomes middle grey.
- **White balance**: the white's temperature and tint, which a Bradford adaptation takes to D65, so a warm lamp's
  scene is neutralised by setting the white to the lamp's temperature. **Pick a white**: click a surface that should
  be white or grey. Red, green and blue gains.
- **Tone**: the curve, now with a new **Hable, adjustable** (its white point, toe and shoulder; at its defaults it is
  the Hable curve). Below it, a **tone equaliser**: a gain in stops for each band of light from 7 stops below white to
  white, which lifts shadows or holds highlights without shifting hues.
- **Colour**: saturation, vibrance (it raises dull colours and leaves vivid ones alone) and hue, in Oklab.
- **Grading**: contrast, saturation and brightness as before.

Each box has a Reset. An untouched develop is still the view's picture to the bit: with every tool at its identity,
the develop pass runs the display's own per-pixel function. The new path at identity was held to it byte for byte on
Dawn, and each stage to its JavaScript twin (`lib/pathtracer/test/develop.gpu.mjs`). The histogram counts what the
tools make. Before and Split compare with the picture untouched. The EXR, HDR and PFM exports are still the light as
rendered, without these tools.

**What to look at:** a scene under a warm lamp. Pick a white on a wall: the cast goes, and Split shows before and after.
The spot meter on a face or a wall. The equaliser's −5 and −6 EV raised: shadows open, highlights stay. Vibrance against
saturation on a picture with both dull and vivid colours. The adjustable curve at its defaults against Hable, then its
shoulder moved. An untouched save as before.
