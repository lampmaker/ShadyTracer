bump: minor

**The Darkroom saves the light itself: OpenEXR, Radiance HDR and PFM, and the developed picture as 16-bit PNG, JPEG or
WebP.** The kept render is luminance in cd/m², and until now it could leave the page only through an exposure, a tone
curve and 8 bits. The Save box has a **format**:
- **PNG 8-bit** as before, now saying in the file how it was made (the build, the size, the samples, the develop
  settings, as text chunks);
- **PNG 16-bit**, the develop pass drawn at full size in float strip by strip (`develop.js` `developedRows`) and written
  at 16 bits, so a steep curve no longer bands in the file;
- **JPEG** and **WebP**, with a quality;
- **OpenEXR**, the light as the renderer made it (`develop.js` `lightRows`, `lib/pathtracer/darkroom/export/exr.js`):
  **absolute cd/m² in float32** by default, the sun and colours outside the gamut kept, or **exposed** (1.0 = white,
  half float if you like); Rec.709 chromaticities and `whiteLuminance` in the header, so a reader that honours it gets
  the renderer's numbers either way; ZIP-compressed;
- **Radiance HDR**, in Radiance's own units (cd/m² ÷ 179) with its Rec.709 `PRIMARIES`, clipped into the display gamut
  (RGBE holds no negative);
- **PFM**, the floats and nothing else.

The light formats carry no tone curve, grading or overlay, which the line under the format says, with what the file
will hold and how large it can be. A render of the illuminance view is saved as lux (×π, as the display shows it). An
export reads the picture back in strips of about 16 MB with its progress in the status and over the picture, so an 8K
EXR does not hold half a gigabyte twice over. Every writer is checked against a reader written in its test from the
format's specification (`lib/pathtracer/test/export.test.mjs`), and against ffmpeg where it is installed.

**What to look at:** Save picture… → Render → Save, each format in turn. Open the EXR in your own tools (Photoshop,
Affinity, Blender, DJV, or `exrheader`/`oiiotool`) and compare a pixel's value with the Darkroom's cd/m² readout at the
same place. The HDR and PFM open. A smooth gradient with a steep curve: banding in the 8-bit PNG, none in the 16-bit. A 4K
or 8K EXR finishes, its rows counting up. The file's text: the build and settings in the PNG's properties.
