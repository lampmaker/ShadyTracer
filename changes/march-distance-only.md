bump: minor

**The march can ask the scene for its distance only: a developer setting, off by default** (Developer › Performance ›
March on distance only; `lib/pathtracer/core/scene_api.js` FOLD_DIST, `wavefront.js` prog_march and prog_surface, THE HIT
ITSELF). Most of a sample is sphere tracing, and every march step asked the scene for its whole answer and read one
number of it. On, a step asks only that number; the rest is asked once a hit.
- **What a step no longer computes:** each shape's normal and its turn into the world frame, the material, the solid
  the point is in, and the capture bookkeeping.
  - The march is built against a second `add_new` and `fold` that keep only the nearest surface's distance.
  - The surface kernel asks the scene for the whole hit at the ray the march stopped. It does so on a trip of the loop
    it already had, so no second copy of the scene is compiled into it, and writes the hit back before the photon map
    and shade read it.
- **The same picture.** The distance is the same expression, so the rays take the same steps. Checked on a software GPU
  (`builder/test/marchdist.gpu.mjs`):
  - Every camera ray ends in the same state, in the same steps and at the same place, bit for bit. The scenes: the
    optics bench as code and as data, the demo, the showcase, the material test, dichroics, and Dusty beam's haze box.
  - The whole renderer's pictures, off and on from the same seeds, are the same pixel for pixel. The scenes: the
    showcase, the material test and dichroics baked, Dusty beam, and spheres, a smooth blend and a glass ball by hand.
  - The one rule that differs: a shape whose normal is not a number (a sphere's exact centre) no longer drops out of
    the distance there.
- **Off is off.** The march and surface kernels are byte for byte what they were. The Optics page's trace, whose shading
  reads the march's hit as it is, never uses it. Occlusion is unchanged: an emitter's shadow ray needs the material
  where it is blocked.
- **Tests › marchdist** is the bench for it: each bench scene off and on, baked, dichroics first with its light's photons
  and the photon map on.
- The uniform block grew one field, `marchDist` (768 bytes, from 752).

**What to look at:**
- **Run Tests › marchdist on your card and paste the whole report.** Read each scene's march down its two rows, and
  surface, which asks the scene once more a hit. The default turns on only if the march gains.
- **The picture.** Switch Developer › Performance › March on distance only on and off on your scene. It should not
  change at all.
