bump: minor

**Over-relaxed steps in the march and the shadow rays: a developer setting, off by default** (Developer › Performance ›
Over-relaxation; `lib/pathtracer/core/wavefront.js`, RELAXED STEPS). The first item of the list of ways to render
faster: most of a sample is sphere tracing (march and occlusion 80-86% of the Noise library's and the Menger cubes' GPU
time, march 110 of 182 ms on dichroics), and a ray running along a surface takes many small steps.
- **What it does** (Keinert et al., "Enhanced Sphere Tracing", 2014): a step goes `relax` times the distance known
  empty, past the ball it starts in.
  - At the next point the two balls must still overlap along the ray. If they do not, the ray goes back to where a plain
    step would have ended, and steps plainly for the rest of that pass.
  - Nothing is tested at a point not yet checked: not a hit, not running out of steps, not leaving the scene, not a
    shadow ray reaching its light.
  - A step nothing would check is plain: the last of a pass, one that would reach where a shadow ray ends, one that
    would pass the haze's collision.
- **Off is off.** At 1, the default, the march and occlusion kernels are the text they were, byte for byte. Above 1 it
  is compiled in (a kernel option, as the step cache is); moving it from 1.3 to 1.6 builds nothing.
- **What was checked here, on a software GPU** (`builder/test/relax.gpu.mjs`; counts, never times): 64 × 36 camera rays
  and their shadow rays a scene, at 1.3 and 1.6, ending as without it.
  - The scenes: the optics bench, the demo, the showcase, the material test, dichroics' thin plates, Dusty beam's haze
    box, and a grazed thin plate whose distance overestimates by 10 %.
  - One dichroics shadow ray in 2304 differed at 1.6, within the share the march's tolerance decides.
  - Steps a camera ray at 1.3: the demo 26.0 against 33.4, Dusty beam 16.9 against 21.9, the optics bench 19.9 against
    21.9, the grazed plate 74.9 against 97.4.
  - At 1.6 the grazed plate took 60.6, but the other scenes from 13 % fewer steps to 6 % more than plain: there the
    failed checks cost what the long steps save.
- **With the step cache too** (the cells ahead, filled once, the optics bench at 1.6): every ray ending as plain without
  the cache, 11.1 steps a camera ray against 21.9.
- **Tests › relax** is the bench for it: each bench scene at relax 1, 1.3 and 1.6, baked, dichroics first with its
  light's photons and the photon map on.
- The uniform block grew one field, `relax` (UB 768 bytes, from 752).

**What to look at:**
- **Run Tests › relax on your card and paste the whole report.** Read each scene's march and occlude down its three
  rows. Whether fewer steps are less time, and which factor, is the card's to say. The default stays 1 until then.
- **The picture.** Set Developer › Performance › Over-relaxation to 1.3, then 1.6, against 1 on dichroics (the plates,
  the floor under the sheet), a relief, and a view along a surface. It should not change: a thin part missing, a
  speckle, or a shadow gone would be the check failing.
