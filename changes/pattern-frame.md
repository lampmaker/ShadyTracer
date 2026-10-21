bump: minor

**Each object has a pattern frame: a material's pattern moved and turned on it, the shape left where it is.** A
patterned material is laid out in its object's own frame. Wood's log runs along the object's z, brushed metal's strokes
along its x, so one material on several objects ran the same way on each. *Lighting a room* showed it: one wood on the
table's legs and top, the grain along each leg's length and through the top's thickness, so the top showed end grain.
Turning the object to turn its grain turned the shape with it.
- **The pattern frame** (`model.js setPattern`, the scene format's version 24): a place and a turn, `{ pos, rot }` (no
  scale: every library material reads its point in real millimetres, `p_local * S_local`, and a scale would cancel
  there), on an object or a CSG group, in its own frame as a child's transform would be. A material's `p_local`,
  `R_local` (a grain's direction) and its relief are read in it. `S_local` is as it was. A version 23 file is read as 24
  with nothing changed. A builder of 23 refuses a file of 24 rather than lose every frame on its first save. A
  parameter may no longer be called `pat` (`pat_<id>` is the frame's uniform).
- **Whose frame:** a CSG group's material is read in the group's frame, so a CSG group has a frame of its own, and so
  does group code on its children's result (a round, a shell), whose code makes the one fold. A frame on one of their
  shapes moves only that shape's relief. The panel says so on that shape (`model.js patternOwner`). A plain group, or a
  twist or a bend, folds nothing of its own, so it has none to offer.
- **In the shader** (`codegen.js patterned, patIn`): only while a hit records its point (`LOCAL_CAPTURE`), around the
  object's block, a CSG group's own fold or a round's or shell's code, the frame moves `XF_P` and turns `XF_QM`, through the straight-material
  frame `fold` already records (`XF_STRAIGHT`). So the march itself pays one branch per patterned node. A relief
  reads its point through the frame directly. A node gets these lines only where they change something: some material
  in the scene reads its point, or the node's own material has a relief. Every other scene's text is byte for byte
  what it was, and so are the golden shaders of every document but *Lighting a room*.
- **The scene as data** (`scenedata.js`): a node in its pattern frame is compiled as before, as an object wearing a
  relief is. The records carry one frame a node, the shape's. Giving a node a frame is a compile; moving it after
  that is a uniform, live.
- **The properties panel**: a *pattern frame* box under the placement of each object, CSG group, round and shell,
  folded until it has one. *pattern at* and *pattern turn* edit it (the first value moved gives it one), and *Take it away* removes it.
- **A unit change** by the numbers converts the frame's place as it converts a position. By a scale, or a paste from
  another unit, the place stays, inside the frame the scale reaches.
- ***Lighting a room*** turns its table top's and its floor's frames 90° about y: the log along x, the top's length,
  where both showed end grain (the floor one log's rings, 4 m across).
- **Help:** Materials › *Turning a pattern: the pattern frame*. The wood library item's description points to it.
- Checked: `builder/test/pattern.test.mjs` (new: the model, the text, live through the builder over a stand-in, in
  codegen and as data); `builder/test/pattern.gpu.mjs` (new, Dawn over lavapipe: on 2048 points over every surface, the
  pick's capture in a frame is R^T (p - t) with frame F R, codegen's and as data, and the capture without one bit for
  bit everywhere else, a CSG shape's and a shelled shape's own frames included; a relief of q.z in a frame turned 90° about y is a relief of
  q.x without one, and without the frame another field); `check-shaders.mjs` with naga, the frames at the top level, on
  a CSG group and inside a straight group; `panel.check.mjs`.

**What to look at:** *Lighting a room*. The table top and the floor should show long stripes and arches along x, not
rings around a point, and the legs as before. Then any object wearing wood, brushed aluminium or a checker: select it
and open *pattern frame*. The first change compiles, taking about as long as giving it another material. After
that, dragging *pattern turn* should turn the grain live while the shape stays put, and *pattern at* should slide it.
On a part of a subtraction (a cut box), the box says to turn the group's frame instead.
