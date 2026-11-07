bump: patch

**`optics/test/spectral.gpu.mjs` runs again.** It made its detector floor the way a scene did before model version 27,
a material of type `detector`, which 0.83.0 moved to the object (an optics role), so the test threw `ModelError:
material type must be one of surface, emitter` before any check ran. Its floor is now a detector by
`setOpticsRole`, with the scene's `analysis` feature on (a role counts only then, as `toTree` reads it). Nothing in its
checks changed: on Dawn with lavapipe all 13 pass, the dichroic plate reading 0.9673 +- 0.0006 against its integral
0.9677.

**What to look at:** nothing in the page; `node lib/pathtracer/optics/test/spectral.gpu.mjs` (webgpu + lavapipe)
says 13 passed.
