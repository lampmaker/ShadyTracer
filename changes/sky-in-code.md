bump: minor

**The sky in code: a background of your own, written in WGSL.** The scene's environment has a third source, *sky in
code*, next to *sun & sky* and *studio*. Choosing it gives the scene a **sky code** block under the environment's rows. It
defines `fn background(dir: VEC3) -> VEC3`: what a ray leaving the scene in direction `dir` sees, which is also the light
the sky casts on the scene. The block starts as the *sun & sky* model itself, Rayleigh and Mie written out, so the sky
you had is there to read and change. **start sky from** replaces it with that model or with **stars**, a Kali-set
fractal after a 2022 shader of KABOOM's, turned from screen rays into sky directions so it wraps the whole sphere. The
sun stays its own light, set by its rows (0 lx for a night sky). **Sky (lx at 1.0)** scales the code, live: 1.0 in every
direction would put that many lux on a level surface. Unlike the *sun & sky* source, it is not measured. The block's
errors are listed at its own lines. Applying it compiles one kernel, shade, which is the only one that has it. It can
call the prelude's functions, noise among them, plus `sunDirection()` and `UB.uSkyTurbidity`. It cannot call the scene's
functions block or its parameters, and is refused if it tries. The Insert pane under it has recipes: an evening
gradient, a ground, noise clouds, a glow round the sun. There is no new file version. A builder that predates this
refuses a scene whose environment was saved by this one, because the new setting is not among its own. Help › Light, environment and camera explains it.

**What to look at:**
- On any example, choose Environment › Source › *sky in code*. After the compile, the picture should look as it did under
  *sun & sky* at the default sun. Moving the sun or the turbidity should change the sky as before. The one difference:
  its brightness is no longer re-measured as the sun moves.
- *start sky from* › *stars*, then set the Sun to 0 lx. You should see the star fractal all around: dim blue-white
  nebulae with points in them, turning with the camera as a sky does and with no seam anywhere. Turn the exposure up
  (or leave auto exposure on): the stars are dark against a daylight exposure.
- Type an error into the sky code. It should be listed under the box at its own line, and Apply should refuse it.
