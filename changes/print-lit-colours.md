bump: minor

**A 3D print can carry the view's colours** (File › Export ▸ 3D print…, *colour from: As lit (the view)*). Each point
of the part that the camera sees gets the colour the view shows there. That's the picture the view has accumulated,
developed as the display develops it: its exposure (metered or set), its tone curve, and every light in it, including
the lights' rays, the photon map and light through glass (`RT.viewColours`). Nothing is rendered for it, and the
colours are then reduced to the colour count as before. A point the camera can't see takes its material's colour:
outside the picture, facing away from the camera, or hidden behind something. The field kernel's new SEEN mode
(`core/field.js`) decides the last case by marching from each point towards the camera. It now shares one SDF call site
across its three modes, because each call site is a whole copy of the scene to compile.

*As lit, all around* (`RT.viewsAround`, `core/probes.js` aroundViews) covers the side the view doesn't show, such as a
back lit from behind. It renders the part from 6, 14 or 26 cameras round it (the cube's faces, then its corners, then its
edges). Each camera is far enough out to frame the whole part, and each picture is an ordinary offscreen render with the
user's settings, so every light is in it. Every picture is developed with the live view's look and one exposure, and each
point takes its colour from the camera that sees it most squarely. The user's camera is put back after, its up vector too,
which the facade test caught missing on the first try. A shiny surface can change where two cameras meet.

The first version traced each point on its own, from every side, with a ray list instead of a camera (the **probes**:
`genrays.js` camtype 2, `R.setProbes`, `RT.renderProbes`). That can't use light tracing, the lights' rays or the photon
map, which are joined to a camera's picture. On a cube lit through a lamp's glass, the lit patch came out black where the
view showed a green glow (the user, 2026-11-16). It stays as a second choice, *Lit from all sides (no light through
glass)*, for a part whose hidden side matters and whose light falls on it directly.

For all three, **brightness** (stops of exposure) and **contrast** (added to the view's) adjust the look over the view's own
(`core/probes.js` probeView); 0 and 0 is the view's look. After the export the dialog says what the colours came to:
- the points, and how many of them the view showed;
- the EV;
- the brightness of the darkest 5 %, the median and the brightest 5 %;
- the share black and the share white;
- the palette.

Faces the box cuts through keep their material's colour, and the sampled field, not position, decides which faces are
cuts. Vertex colours are averaged once over each vertex's neighbours, and a triangle takes its corners' mean.

Measured on Dawn over lavapipe in this container:
- SEEN (`builder/test/seen.gpu.mjs`): a box with a ball in front of it, in metres and in millimetres. Every point of the
  box's face more than 1 cm from the ball's silhouette came out seen or hidden as an exact ray to the camera says,
  perspective and orthographic, and the back face came out hidden.
- The probes (`builder/test/probes.gpu.mjs`): 250 probes on a white floor under one light face read 0.9985 ± 0.0030 of
  the closed form with light sampling on and 1.047 ± 0.024 off.

How it looks printed, or how long it takes on a real GPU, hasn't been measured.

**What to look at:** the user's cube under the lamp with the green glass. Let the view settle, then export it as 3MF or
OBJ with *colour from: As lit (the view)* and 8 to 16 colours. In the slicer, the top should carry the green patch where
the view shows it, and the sides their light and shadow. The side away from the camera should be the wood's own colour.
The dialog's "lit:" line says how much of the part the view showed. Then try *As lit, all around* with 6 views. The
part's back should carry its own light too, including any light from behind it. Note how long the export took, and
whether two views meet visibly on a glossy part.
