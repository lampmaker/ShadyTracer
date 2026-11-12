bump: minor

**A 3D print can carry the picture's colours, lit** (File › Export ▸ 3D print…, *colour from: As lit*). Each point of the
part gets the colour the render gives it: its light, shadows and glow, developed with the view's exposure and tone curve.
The colours are then reduced to the colour count as before. The renderer traces it with a new camera type, the
**probes** (`genrays.js` camtype 2, `R.setProbes`, `core/probes.js`). In it, each pixel's ray is one the host lists, the
same ray every sample. The export puts a probe at each vertex of the mesh, half a cell off the surface and looking
straight at it, and renders them offscreen (`RT.renderProbes`). A probe sees the light the surface sends back along its
normal. That is the whole look of a matte surface. A glossy one shows what it reflects straight out, glass what is
behind it. A probe can't join light tracing's photons to the camera, so the probes' render runs with light tracing and the
lights' rays off and in Final quality. The camera's paths then find every light's face themselves. A light that is only a
ray file has no face and gives no light here. The faces the box cuts through keep their material's colour. Whether a face
is a cut is decided by the sampled field, not by its position, so a part whose own faces lie on the fitted box keeps its
light. The probes' vertex colours are averaged once over each vertex's neighbours, and a triangle takes its corners'
mean.

Measured on Dawn over lavapipe in this container (`builder/test/probes.gpu.mjs`): 250 probes on a white floor under one
light face read 0.9985 ± 0.0030 of the closed form with light sampling on (512 samples) and 1.047 ± 0.024 with it off
(4096). The probes keep their order through the darkroom's develop. Nothing about how it looks printed, or how long it
takes on a real GPU, has been measured.

**What to look at:** export a scene with a matte part lit by a lamp (a shadow on it helps) as 3MF, with *colour from: As
lit*, at 64 samples and at more colours than usual (say 8 to 16). In the slicer, check that the colours follow the
picture's light and shadow, how much speckle there is, and how long the "lighting" step took for how many points. Also
try a part whose box cuts through it (a floor), and check that the cut faces are the material's colour.
