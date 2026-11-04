bump: minor

**A ray file (or any light with no face) is seen through the camera's lens.** A ray file is no geometry: no camera ray
can meet it, and its photons connected only from the surfaces they landed on, so looking at the light itself through a
lens with an aperture showed nothing. Now each of its photons whose ray crosses the lens's disc -- straight from the
file, or after mirrors and smooth glass only -- adds itself to the pixel a real camera would put it on, with the thin
lens's own measurement, `Phi / (A_px A_L cos^4)` (`core/lens.js`, *A faceless light seen through the lens*). Only for
lights with no face: a ray file, or a source that is only a description. A rectangle or disc light keeps its face,
which the camera's rays see, and a collimated sheet keeps the glow it is given. A photon that has scattered off anything
else (a matte or glossy surface, the dust, a milky material) is that surface's to show, through its connection or the
photon map, and no longer counts at the lens, so nothing is counted twice.
- The march marks the step that crosses the disc (a step is free space, so a crossing is unblocked); shade queues a
  camera connection of length 0 there, and the occlusion kernel deposits it, never clamped as a firefly. A photon that
  leaves the scene short of the lens (a camera outside the scene's radius) is tested ahead of it.
- `Ray.ltMis` -2 (`LT_FACELESS`) marks such a photon while only delta events have turned it; bit 16 of the tag
  (`TAG_LENS_X`, free since 0.61.0) marks the crossing.
- Through a pinhole (aperture 0) such a light is still dark, and so in an orthographic view and the illuminance view.
- Checked on Dawn over lavapipe (`lenslight.gpu.mjs`, every kernel through `R.trace` and the real optics module; no
  picture seen, no card): a 25 cm Lambertian disc of 1000 lm, 1621 cd/m^2, 1 m from a lens of 10 cm radius focused on
  it. As a ray file of 2^20 rays: 4965 of them cross the lens clear of a black plate covering half the disc, and the
  picture of the clear half reads 1622 +- 13 and 1608 +- 10 cd/m^2 (the camera inside and outside the scene's radius)
  against the 1607 those rays make by the same arithmetic in JS; behind the plate 0. As a description: 1625 +- 12.
  In a mirror: 1625 +- 17. The white wall the light shines on reads 173 through the lens and 173 through a pinhole; with
  the scattered photons still counted at the lens it read 344, twice, and the test fails. With ray sets marked as before
  (-1) the clear half reads 0, the picture you saw, and the test fails.
- Speed not measured: the march asks one more question per step of these photons only (a camera ray or any other photon
  skips it on a flag read once a dispatch).

**What to look at:** import a ray file, set the Camera's aperture above 0 and focus on the source, and look at it
directly: the light should show where its rays leave, brighter where more of them point at you. A ray file is its rays:
only those that point into the aperture can ever be seen, so a small aperture or a file of few rays shows specks
(about rays x (aperture radius / distance)^2 of them for a Lambertian source), and a larger aperture fills it in. Seen
in a mirror or through clear glass it should show too. The surfaces it lights should look the same as before, with
the aperture at 0 and above it, and a rectangle or disc light should not change at all.
