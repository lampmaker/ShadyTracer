bump: minor

**The environment is code, in cd/m²: a physical sun and sky, a studio, stars or an image, and whatever you write.**
What surrounds a scene is one function in its Properties, `fn background(dir: VEC3) -> VEC3`. It returns the luminance
seen in direction `dir` (z up). That is both what a ray leaving the scene sees and all the light the surroundings cast.
The **environment code** box shows what the scene is lit by, word for word as the renderer compiles it, and the first
edit makes it the scene's own. Errors are listed at their own lines. **start from** offers four starts:
- **sun & sky**: physical. Sunlight of 128 klx above the air comes down through it, Rayleigh at Hansen & Travis's depths
  and haze by Angstrom's law, scattered once, worked out in 16 bands of the spectrum and added up as colour through
  CIE 1931, and the ozone's Chappuis band taking orange out (Serdyuchenko et al. 2014, 300 Dobson units). The sky's
  light and the sun's colour follow from that, so the sky is no longer set separately: about 91 klx and 4980 K from
  the sun and 11.5 klx from the sky with the sun 45° up, the zenith about 9800 K, and a low sun dimmer, redder and under
  a darker sky (15° up: 51 klx, 4080 K).
- **studio**.
- **stars**: a fractal night sky after Star Nest by Kali (Pablo Andrioli), wrapping the whole sky. Its depth, zoom,
  shift, luminance and peak are parameters, moved live.
- **image…**: a Radiance `.hdr`, PNG, JPEG or WebP panorama, kept in the scene's file. A `.hdr` reads at 179 cd/m² a
  unit; a photograph's white starts at 5000.

The rows shown are the settings the code reads. **Sun sampled directly** marks the cone that light sampling and the
sun's photons aim at, at the sun's azimuth, elevation and diameter; the code says what is in it.

**Parameters of your own**: + number… and + colour… under the code add a value the code reads by its name (`starZoom`),
moved live without a compile and animatable on the timeline; rename / remove renames it in the code too. Up to 16.

**The environment is drawn from a texture** (*Environment from a texture*, on by default; *Texture width* 1024, 2048 or
4096): the code is run once per change into an equirectangular texture, 2 × 2 samples a texel, and every ray reads that.
The sun's cone is still asked of the code exactly. So a heavy code such as the stars costs once per change rather than at
every ray. Off: the code for every ray, as before.

**White balance in Exposure** (◐): *White balance (K)* and *White tint* say which light looks white, as a camera's
white balance (Bradford, from the Darkroom), or *White from the environment* takes what the environment puts on a
level white surface, the sun's and the sky's light together. 6506 K and tint 0 is no change. The display's alone: the
light the picture holds, the readings and the false-colour views are untouched. A physical sun of 4980 K is warm
against the screen's D65 white, as on a camera set to daylight; *White from the environment* makes it white.

Light sampling now also draws from a map of where the environment is bright, baked on the GPU whenever the code or a
setting changes. So stars, a second moon or the sun in a photograph light the scene, instead of being found by chance.
Applying the code compiles only the kernels that hold it.

Files are model version 31. `sunIlluminance` becomes `sunOutside` (× 1.28) and `skyIlluminance` is dropped. A builder of
30 refuses such a file. Scenes made with the old defaults look much the same; a low sun is now dimmer and redder. The
library's thumbnails are drawn again. The Tests panel's photometry rows now compare against what the environment's map
measured; sun-only and sky-only are `envSky` 0 and `envSun` 0.

**What to look at:**
- Open *First steps*. The sun and sky should look as before, a little warmer. Move the sun down to 10°: it should go
  orange and dimmer, and the sky darker.
- *start from* › *stars*, auto exposure on. You should see the star fractal all round, with no seam. The floor and
  objects should now be lit by the stars, faintly and blueish, and settle as samples add up.
- *start from* › *image…* with an HDRI from Poly Haven or similar. The background should be the panorama, the right way
  round (its middle towards +x, not mirrored). Objects should be lit by it, and a sun in the picture should cast
  shadows. Try *Image turn*.
- *start from* › *studio*: as before.
- Type an error into the code: it should be listed under the box at its line, and Apply should refuse it. Undo should
  put the code back and compile it.
- *stars* with *Environment from a texture* on and off: on should be about as fast as the sun & sky once the texture is
  made (a short pause after each change), off as slow as before. The picture should look the same, and the sun's disc
  as sharp either way.
- *stars*: drag *starZoom* and *starLuminance*: the sky should follow without a compile. *+ number…* `twinkle`, use it
  in the code, Apply; rename it; remove it.
- *First steps*, ◐ › *White from the environment* on: the sunlit floor should go neutral. At 6506 K and 0 it should
  look exactly as before. Move the sun to 10° with it on: still neutral; off at 6506 K, orange.
- Tests › photometry, illuminance, cosine-law and render-modes: every ratio should read 1.
