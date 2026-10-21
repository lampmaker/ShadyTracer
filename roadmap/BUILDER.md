# Scene builder — roadmap

*Moved here from `builder/ROADMAP.md` and trimmed on 2026-10-02: what is built is a few lines each,
with its decisions and their reasons; §6 and what is still open are kept whole, their statuses brought
up to date. Section numbers are cited from code and tests, so they stay.*

What the builder should become next, in the order it should be built, and what each step costs
the renderer. Written after the builder reached: a document model with transforms, CSG groups
and blends, materials as data with optional WGSL, a code editor with errors at the user's line,
save / load with upgrades, and a naga pass that compiles every generated scene without a GPU.
`PLAN.md` § *The scene builder* is where it stands; this is where it goes.

**Speed is the constraint everything below is judged against.** One fact decides most of it:
the SDF runs at every march step, for every normal difference and every shadow ray — hundreds of
times per ray — while `getMaterial2` runs about once per bounce. So:

- anything added **inside the SDF** multiplies by the march; it has to be justified per step;
- anything added **at the hit** (materials, picking) is nearly free;
- anything that makes the SDF **evaluate less** (bounds, repetition) is the biggest win there is.

---

## 1. Several scenes, and the hand-written ones as builder scenes — done

Done: the hand-written scenes are JSON documents in `scenes/`, and several scenes are a project
(`project.js`; FEATURES.md §2, PLAN.md). **Why a container:** the first plan said none was needed —
one file per scene, the dropdown as the list — but that made switching scenes a save, an open and a
lost undo history. One undo history covers the project, and a drag into another scene is a copy
(`model.insertAsset`, §4's operation, built early for it); scenes do not share materials. The three
files (scene, project, workspace) and how they are told apart: `project.js`'s header.

**Since 0.7.0 (2026-10-02)** the tree shows the scene being worked on alone, and a dropdown over it the
others (`switcher.js`): every scene in the tree made a stray click a scene switch and a compile. The drag
between scenes became a row's right-click *Copy to* / *Move to*. Projects are kept in the browser and listed
(`workspace/`), and the bundled scenes are the switcher's Examples. **Since 0.45.0** the dropdown is gone and all of it is
File's (`filemenu.js`). UI_PLAN.md section 10 has the decisions.

## 2. A list of primitives, in their own submenu — done, and then made code

**Since then the primitives are not node types at all.** There is one kind of object, a code node;
the Shapes menu adds one that starts as an entry of `primitives.js` (label, parameters, ranges and
code), the way a modifier is a group that starts as an entry of `modifiers.js`. Emitted through the
same path the types used, so it costs the renderer nothing — a v8 file upgraded to it is the same
shader. What it cost is the bounding box a type could be measured by (§5, and bounding volumes
below): code can put its surface anywhere -- so boxes are now measured on the GPU (`boxes.js`).
Format version 9.

Of the original plan's list only the **ellipsoid** is not built. What it said holds for any primitive
added: **analytic normals where cheap**, because a primitive without one costs the renderer a normal
by differences, i.e. four or six extra SDF evaluations per hit. The submenu is built: the + menu's
Shapes is Primitives, Optics and From points (`primitives.js` SHAPE_GROUPS).

## 3. Modifiers: a node that changes the space its children live in — done, as group code

**What was built is simpler than what is sketched below.** Not a modifier node type: any group
can have code of its own, which *calls* its children — `C = children(C, p)` — rather than
running before or after them. Change `p` first and it is a domain modifier; fold them into a Hit
of their own and change the distance and it is a distance modifier; call them twice and it is
something a before/after pair cannot express. The children become a function per coded group
(`children_<id>`, the one rename codegen makes to typed code, agreed as such), and a group whose
code is only comments emits exactly what it did before. The two rules below are kept by
`warp(k)` in `scene_api.js`. **Modifiers** in the + menu are groups whose code and parameters
start as one of `modifiers.js`: twist, bend, repeat, mirror, round, shell, displace, and the noise
relief (SURFACES.md phase 6). Format version 5. Built, not yet confirmed on hardware (PLAN.md
*Group code*). The original plan's two kinds, kept for their reasoning. **Polar repeat** is built as
the **circular array** (0.77.0), and not as this table's domain kind: folding the point into one
slice cuts off a copy that crosses a slice's border and turns one across the axis into a wedge, so it
evaluates every copy into a Hit of its own and keeps the least (a union) -- or, with `reach`, the
nearest few and a bound on the rest (`builder/test/circular.gpu.mjs`):

| kind | examples | what codegen emits | speed |
|---|---|---|---|
| **domain** (p → p′ before the children) | repeat / limited repeat, mirror / symmetry, polar repeat, twist, bend | `let p = modTwist(p, k);` in the block, like a transform | repeat and mirror are *cheaper than the copies they replace* — N objects for the price of one. Twist and bend are **not distance-preserving**: the field is no longer a true distance, and the marcher must take shorter steps |
| **distance** (d → d′ after the children) | round (d − r), shell / onion (\|d\| − t), displacement | the children evaluated into their own Hit, as a CSG group does, then the distance adjusted | round / shell: free. Displacement: whatever the noise costs, per step |

Two rules make them safe:

- **A non-isometric warp must scale the distance down** by its Lipschitz bound (twist by
  `1/sqrt(1 + (k·r)²)` or a user "step scale"), and the modifier says so in its definition —
  otherwise the marcher oversteps and punches holes. This belongs in the modifier, not in a
  global step-scale slider that slows every scene to fix one object.
- **Analytic normals do not survive a warp.** Inside a non-isometric modifier the normal must be
  dropped (zero), so the renderer takes one by differences — the same rule `csgNormal` follows.

## 4. A library of objects and materials — done

Done: `library/` (`store.js`, `panel.js`, pictures; FEATURES.md §5), on the operation planned here,
`model.insertAsset`: fresh ids, the materials a subtree references brought along, an identical one
reused.

## 5. Selecting and moving objects in the picture

Built. As confirmed on hardware, and the one thing that is not:

- **The box.** A box from a primitive's parameters (confirmed) went when every object became code
  (§2): it is wrong the moment the code is changed. The box drawn now is measured (`boxes.js`, objects
  and groups; the view's box button, UI_PLAN.md), projected by `genrays.js projectPoint`, which inverts
  the kernel's ray construction rather than the camera's matrices (`bounds.test.mjs`: a point on the
  kernel's ray projects back onto its pixel).
- **Move handles — confirmed.** An arrow per axis, a square per plane and a centre ring, a constant
  size on screen, along the PARENT's axes so an arrow changes exactly one of the panel's position
  numbers (`gizmo.js`). A drag is measured on the constraint as it was at mousedown, so the grabbed
  point stays under the pointer; it is a live uniform write and one undo step; Escape puts the node
  back. `gizmo.test.mjs` checks both promises inside a turned, scaled group with the real camera.
- **Scale, snaps — confirmed.** Scale is one circle on screen; Ctrl snaps (15° / 0.1 of scale; a move to
  0.1, then to the grid shown, 2026-10-02). The half scale while a handle was held, and its switch, were removed
  at the user's asking (2026-10-02): a drag renders at full quality.
- **One Transform gizmo, with stretch cubes — confirmed** (2026-10-02). Move and Scale are one mode: the
  arrows, squares, centre and arcs, a cube on each of the shape's own axes that stretches it by its own
  sizes (`stretch.js`, the presets' `stretch` maps), and the scale circle outside the arrows' heads; the
  handles larger. PLAN.md, *The scene builder*.
- **The Points mode with the Transform gizmo — built 2026-10-02, not yet seen.** One gizmo module
  (`gizmodraw.js`), every part a switch: the Points mode draws its arrows, plane squares and centre at the
  selected point, the arcs, cubes and circle hidden until points turn and scale; every point's legs behind a
  switch on the view's toolbar. Ctrl in Transform snaps to the Points mode's grid. More shapes stretch (lights,
  the export box, the tori's ring, the link's span). PLAN.md, *The scene builder*.
- **The numbers in a panel at the top right — confirmed** (2026-10-02, `readout.js`): position, rotation,
  scale, lengths and measured bounds; the Points mode's numbers and typed entry moved there from beside
  the point.
- **Rotate from Move — confirmed; the Rotate mode is gone.** A quarter arc between each pair of arrows
  makes the old ring's drag (`ringAngle`, `gizmo.arcPoints`); the x and y angles go through `eulerOf`,
  which picks the angle triple nearest the ones at mousedown so the panel's numbers do not jump.
- **Local axes — confirmed.** On by default: every handle along the node's own turned axes; a local
  ring is R' = R * Rot(e_k).
- **Picking — confirmed.** `RT.pick(x, y)` marches one ray (`core/pick.js`) against the scene's
  `pickWgsl`, the builder's tagged copy compiled only for the pick kernel; `fold()` records the tag in
  the capture branch it already had for p_local, so the render kernels pay nothing new.
- **Clicking selects from the top, shift goes down — built, NOT yet confirmed on hardware.** The pick
  names the DEEPEST node whose surface passes through the hit, and `selection.js` decides the level: a
  click selects the top-level node, or stays inside a group you went into; shift-click one level
  deeper; double-click the deepest; Esc up one. The inside of a CSG cut names the group.

**Found while building it:** the camera listens for `mousedown`, not pointer events, so a handle has to
stop `mousedown` (capture, on the stage) or the drag also orbits; the render canvas is `object-fit:
contain`, so screen positions go through the picture's rectangle, not the panel's (`overlay.js`). The
tree now takes a `select(id)` (`installBuilderTree`, tree.js).

## 6. Booleans per child, shapes from points, more primitives (agreed 2026-09-30)

**Want:** "a group of a, b, c, d: union a, b, c, subtract d" without nesting groups, maybe written as code;
more primitives; extrusion and sweep of a shape given by points (in code for now, a 2D drawing tool later).

**Decided with the user, in phases, each confirmed on hardware before the next:**

0. **Fixes first — done.** A version 10 file lost typed materials on load (fromBranch took this line's
   material types for the optics branch's); `vis` reserved; a light no longer a CSG group's shape; blends
   converted on paste between units; every CSG case's shader frozen (`test/fixtures/csg-v10`).
1. **A join per child — 1a built and confirmed** (model version 14: `join`, `joinBlend`; see `PLAN.md`).
   **1b built, not yet confirmed:** the tree shows each child's join as a glyph before its name and as a clickable toggle
   (● base, ∪, −, ∩; TreeView cycles multi-value toggles without a GUISTUFF change, treeview.js 409-454)
   and a group row a summary (`a ∪ b ∪ c − d`); the group's panel a RECIPE (`union a, b, c` / `subtract d
   blend 0.02`, `recipe.js`), handles by position, `"Label"` or `@id` otherwise, applied as model operations
   — never a second source of truth. Nesting stays a subgroup.
2. **Primitives — built, not yet confirmed:** round cone, octahedron, pyramid, capped torus, link; dome, tube, parabolic
   reflector, each normal its distance's gradient (`core/shapes.js`, embedded in sdf.js's PRIMITIVES; a 2D
   vocabulary with gradients for the solids of revolution). Every distance exact or a stated bound and never
   too large inside, against independent references (`core/test/shapes.test.mjs`); Quilez's pyramid refused
   for being too large inside, his parabola and capped torus rewritten for f32. See `PLAN.md`.
3. **Shapes from points — built, not yet confirmed:** a profile parameter `[[x, y], [x, y, fillet], ...]`, compile-time, a code
   object's; fillets make lines and arcs, exact and smooth. The code reaches it through a handle --
   `extrude(outline, p, height)`, `revolve(outline, p)`, `profile(outline, q)` -- since WGSL cannot pass a
   function and the code is not rewritten; each profile is its own straight-line function (`core/shapes.js`
   profileWGSL), not a loop over a const array. Presets: extrusion, revolution, a Fresnel lens (the
   prisms became one shape with a sides slider). A profile costs its pieces at every march step (inferred; to be measured). See `PLAN.md`.
4. **Sweep and tube along a path — built, not yet confirmed:** a path parameter `{ path: [[x, y, z], [x, y, z, fillet], ...] }`, open,
   compile-time, a code object's, reached through a handle as a profile is: `tube(route, p, radius, rounded)`,
   `sweep(route, outline, p)`. ONE closest point on the whole path is the rounded tube only. A flat tube and a
   sweep are PER PIECE -- each segment the cross-section extruded, each bend it turned about the bend's axis --
   because one closest point scaled to the cross-section was measured unsafe at bends tighter than it reaches
   (it jumps), and a plain union of capped pieces leaves faces inside the solid at the joints: so outside is the
   nearest piece (exact), inside the nearest side or path-end face, the joints left out (never too deep). Each
   path is two straight-line functions (`core/shapes.js` pathWGSL). Presets: bent tube, light guide. The cost per
   point is about 2–2.5 cross-sections (CPU-counted, not GPU-timed). **Live paths** (asked the same day): points may
   name the object's parameters, and a live path's pieces are uniforms the builder rewrites in JS as they move,
   recompiling only when it has more points than room for -- the chain is slots, each on or off, since 2026-10-02 --
   (confirmed working by the user, 2026-10-02, before the slots). **Live profiles**
   likewise (2026-10-02, not yet confirmed). **Points drawn in the picture** (2026-10-02, not yet seen): the overlay's
   Points mode -- dots, arrows along the object's own axes, a fillet's diamond, typed entries, a view square to a
   profile's plane -- with the path compiled live while it is edited (`pointsmode.js`, `pointedit.js`). **A scale and
   twist per point** (2026-10-02, not yet seen): after the fillet, scale x, scale y and twist, linear along a straight
   and held round a bend; the rounded tube as round cones (exact outside), a varying sweep a bound with its slope held
   to 1; a section gizmo at the point in the Points mode; the twisted bar preset. See `PLAN.md`.
5. **An aspheric lens / condenser** -- built 2026-10-04 (0.13.0): `shapes.js` Nasphere, two even-asphere faces, its
   distance a bound both sides under any live parameters (`shapes.test`), the preset a condenser exact on axis. Not
   seen on hardware. **A parabolic glass TIR cone**: not started.

---

## Also worth doing, found while building

- **Bounding volumes — the largest speed item on this page — done:** measured per node on the GPU
  (`builder/boxes.js`), not set by hand; see PERFORMANCE.md P2.
- **Blend profiles** — quadratic smooth-min is C1 only; a cubic (C2) or circular profile per
  group removes the visible seam where a blend meets a glossy surface.
- **PropertyTable's vec3 popup** — store the `on('change')` handler upstream in GUISTUFF, then
  drop `panel.js`'s `bind()` workaround.

The order this page proposed (undo / redo, primitives, the scene conversions, bounding volumes,
modifiers, the library, picking and the gizmo) is all built; each step landed as small commits.
