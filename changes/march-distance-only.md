bump: minor

**The march asks the scene for its distance only: 2-35 % less GPU time a sample on five of six bench scenes, the same
picture** (`lib/pathtracer/core/scene_api.js` FOLD_DIST, `wavefront.js` prog_march and prog_surface, THE HIT ITSELF). Most
of a sample is sphere tracing, and every march step asked the scene for its whole answer -- each shape's normal turned
into the world frame, the material, the solid the point is in -- and read one number of it, the distance.
- **Now a step asks only that number.** The march is built against a second `add_new` and `fold` that keep the nearest
  surface's distance and nothing else.
- **The rest is asked once a hit.** The surface kernel asks the scene for the whole hit at the ray the march stopped.
  - It does so on a trip of the loop it already had, so no second copy of the scene is compiled into it.
  - It writes the hit back before the photon map and shade read it.
- **Measured on your Pascal**, Tests › marchdist (`ShadyTracer 0.78.0 · c3be0d6 (ccr-0f3a020a-590jz2) · nvidia pascal`,
  2026-10-25), GPU ms a sample, before → now:

  | scene | march | surface | the whole sample |
  |---|---|---|---|
  | dichroics, its light's photons | 177.8 → 144.0 | 21.1 → 42.0 | 283.7 → 270.9 (−4.5 %) |
  | the Noise library | 70.7 → 58.8 | 18.8 → 24.8 | 144.3 → 138.3 (−4.2 %) |
  | the Menger cubes | 49.6 → 41.2 | 4.8 → 7.4 | 90.6 → 88.7 (−2.1 %) |
  | the showcase | 17.3 → 8.8 | 3.8 → 6.0 | 50.9 → 44.6 (−12.4 %) |
  | the material test | 11.3 → 10.4 | 4.7 → 6.0 | 39.8 → 40.2 (+1 %) |
  | the optics bench | 49.3 → 10.2 | 5.5 → 12.5 | 91.9 → 59.3 (−35.5 %) |

  Its drift row read +1.5 %.
  - **The surface kernel gives back part of the march's saving:** 21 of the 34 ms on dichroics. It now makes the one
    full evaluation the march's last step used to make.
  - **Always on, as you asked:** it was the developer setting March on distance only for that run, and the setting is
    gone. A workspace that saved it has it ignored.
- **The same picture.** You saw it identical. On a software GPU (`builder/test/marchdist.gpu.mjs`):
  - every camera ray ends at the same place in the same steps, bit for bit;
  - the hit the surface kernel writes back is the full march's, field by field;
  - the whole renderer's pictures, with this march and with the full one put in its place, are the same pixel for pixel.
- **What stays the same:** the Optics page's trace keeps the full march, because its shading reads the march's hit
  directly. Shadow rays have an entry of their own.

**What to look at:** your scenes, as ever: nothing in the picture should differ from before, and a heavy scene should
be quicker. The Performance box has one row fewer.
