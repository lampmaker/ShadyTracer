# Importing CAD and meshes — an investigation

Written 2026-10-02 against `main` at `8611305`, because the user asked: *"Investigate possibilities for cad
import. Stl, step, solidworks, obj and whatever exists. Ideally, converted into as fast as possible sdf. So may
mean different operations or tools for different file types. Optics?"* Sections 0-10 are that investigation: the
ground a plan would stand on: what the formats hold, what the renderer can take, what each route costs, and
what has to be measured before choosing.

> **Update 2026-10-21 (0.71.0): STEP and STL import is built, by a route sections 0-10 did not have.** A CAD part's
> faces lie on planes, cylinders, cones, spheres and tori, and the part is a boolean formula over those surfaces'
> half-spaces. The formula becomes the builder's own shapes joined by union, intersect and subtract. That needs none of
> P0's plumbing (no GPU assets, no 3D textures) and no OpenCascade. It is exact, the lens included, and the normals
> are analytic. **Section 11** is what was built, what it was checked against, what its cost per march step is
> believed to be, and what is still the grid's: freeform faces and scans.

The parts in question (the user, 2026-10-02): supplier optics (STEP lenses), mechanical context (housings,
holders), and the user's own optical parts. The files: STEP and other CAD, mesh files, and Zemax lens files.

**How sure each line is** (CLAUDE.md): **measured** names who, on what and the number; **read in code** gives
file:line and says what the code does, never what it costs; **inferred** is a hypothesis with what would test
it; **derived** is arithmetic or a proof written out here, checkable on paper and, where it says so, by a Node
test that does not exist yet. Facts about outside libraries were read on their pages on 2026-10-02 (Sources,
at the end). No GPU was available to whoever wrote this; **no speed claim below is measured**.

**Paths:** `core/…` is `lib/pathtracer/core/…`; `builder/…`, `library/…`, `optics/rayfiles.js`, `index.html`,
Paths are written out from the repository's root.
Other documents in this folder (PLAN.md, BUILDER.md) are named bare.

---

## 0. The answer on one screen

There is no single route, because two kinds of part need two different things.

1. **Optical surfaces need exact geometry, so they become analytic SDF, not a mesh.** A refracting or
   reflecting surface is only as good as its normal. Through a tessellation the normal is off by about
   √(2δ/R): **2.6°** for a 10 mm radius at a 0.01 mm chord tolerance (derived, §6). The builder already has
   exact shapes that most optics reduce to: profiles of segments and arcs, revolved or extruded
   (`core/shapes.js:772`). So:
   - a **Zemax lens file** (.zmx, text) becomes a revolve, its aspheres fitted with arcs;
   - a **STEP solid of revolution** becomes a revolve, cut through its axis by OpenCascade;
   - a **DXF outline** becomes a profile, because a DXF polyline's bulges *are* arcs.

   These cost what any profile costs per march step: a compiled profile is a straight chain of one call per
   piece (`core/shapes.js:851-874`), and what that costs has not been measured.
2. **Mechanical parts tolerate a fraction of a millimetre, so they become a baked distance grid.** Their
   source is a triangle mesh:
   - **STL, OBJ, PLY, 3MF and glTF** are read by small parsers of our own;
   - **STEP, IGES and BREP** are tessellated by OpenCascade compiled to WebAssembly (LGPL-2.1), in a Worker.

   The mesh is baked once into a grid of signed distances: a 3D texture, or an f16 storage buffer. A march
   step inside the part's box then costs one interpolated read (inferred; §3).
3. **SolidWorks, Parasolid, Creo, NX, CATIA, Inventor and JT have no free reader of their exact geometry.**
   The route is to export STEP from the CAD tool. One open project decodes SolidWorks' display mesh only (§2).

**What blocks all of it is in the renderer, not in any format.** The scene contract can bring GPU data, but no
scene ever has, and the path has gaps that would bite on first use (§1, §7). The first step (P0, §8) is to make
that path real and measure two numbers on the user's GPU:
- what a grid costs per march step;
- how far a grid lens's far field is from the analytic lens's.

Those two decide everything after.

---

## 1. What the repository has today (read in code)

**No meshes, no grids, no 3D textures, no BVH.** Every surface is WGSL distance code (FEATURES.md §1). The only
acceleration is a bounding box per top-level node, measured on the GPU (`builder/boxes.js:406-445`) and tested
in the generated SDF (`builder/codegen.js:1395-1433`).

### The scene contract can carry GPU data, and nothing has ever used it

- **`resources` and `init(gpu)` are in the contract** (`lib/pathtracer/README.md:119-131`): `init` creates
  buffers, and resources are named WGSL types the scene's kernels declare.
- **The builder returns neither.** Not from `generate()` (`builder/codegen.js:728-756`), not from `emitScene`
  (`:1457-1472`).
- **`init` runs only in `setScene`** (`core/raytrace_main.js:680`). It does not run in `R.init` (`:772-791`), so
  a scene handed to the constructor never has its `init` run.
- **`setScene` runs on every builder edit that compiles** (`builder/demo.js:235`), and on every `recompile`
  (`lib/pathtracer/index.js:729`). It also runs in the library studio's second renderer (`library/studio.js:354`).
- **There is no dispose.** A scene whose `init` uploads 32 MiB would upload it again on every edit, and nothing
  would free the last copy. A cache of GPU assets keyed by content, with reference counts, has to exist first.
- **The resources reach more kernels than the README says.** After march, shade and occlude
  (`raytrace_main.js:501-508`), they also go to:
  - pick (`core/pick.js:94`, bound at `raytrace_main.js:711`);
  - field and tagfield (`core/field.js:93,148`; bound at `:739,765`);
  - the optics march and shade (`lib/pathtracer/optics/kernels.js:570`;
    `lib/pathtracer/optics/index.js:198-202`).

  `lib/pathtracer/README.md` said "Only `prog_march`, `prog_shade` and `prog_occlude` see geometry"; corrected
  2026-10-02. Every one of these kernels is a second caller (CLAUDE.md).

### Binding limits, and why a texture is not a ninth buffer

- **The shade kernel already uses 8 storage bindings** (`core/wavefront.js:885-895`). That is the WebGPU
  default `maxStorageBuffersPerShaderStage`. tinywebgpu raises the limit to the adapter's
  (`lib/tinywebgpu/src/tinywebgpu.js:217-219`), and check-shaders notes anything past 8 and refuses past 16
  (`core/check-shaders.mjs:536, 632-641`).
- **The optics shade uses 7** (`lib/pathtracer/optics/index.js:200-201`).
- **A `texture_3d` and a `sampler` count against other limits:** 16 sampled textures and 16 samplers per stage
  by default (the WebGPU spec). tinywebgpu already declares a resource whose type starts with `texture_` or
  `sampler` without an address space, and binds a texture's default view (`lib/tinywebgpu/src/tinywebgpu.js:1239-1269`).
- **But tinywebgpu creates and writes only 2D textures.** `createTexture` goes through `tex2d`, size
  `{width, height}` (`:510-514, 995-998`). `writeTexture` copies one image of width × height (`:535-542`,
  `texWH`/`sz` at `:1058-1059`).
- **check-shaders counts every resource as a storage binding** (`nStorage = Object.keys(k.resources).length`,
  `:632`). It would need to count textures apart.
- **The builder's compile probe declares only its own buffer** (`builder/validate.js:60-61`). A scene naming
  a texture would fail the probe before it reached the renderer.

### What the march asks of a distance

- **A step is `|d| · stepscale`, 0.9 by default** (`core/wavefront.js:664-691`). A hit is `|d| < eps`. Up to
  `maxiter` 400 steps, and 2000 in the optics trace (`lib/pathtracer/optics/index.js:44,89`).
- **Every shape is exact or a bound, and never too large inside.** "Inside glass it is stepped through from
  within" (`core/shapes.js:5-12`).
- **The marcher has no per-shape safety factor.** Two places divide distances, and both drop the analytic
  normal:
  - `warp(k)` (`core/scene_api.js:56-71`);
  - a relief's `foldRelief(…, slope)` (`:244-251`).

  So a grid shape must divide by its own Lipschitz constant and return its own gradient.
- **Without an analytic normal the shade kernel takes three more evaluations of the whole scene**
  (`core/tracebasics.js:396-404`, chosen at `:597-603`).
  - **Measured** (the user, NVIDIA Pascal, 1024², before physical units; docs/TESTING.md *Where the render
    time goes*): turning analytic normals off for every shape cost +328%.
  - One imported part without a normal would pay its share of that on its own hits only (inferred).
- **The march is where the time goes.** **Measured** (the user, Ampere, Chrome 154, 2026-09-30;
  docs/PERFORMANCE.md, run 5): the Noise library is 250.4 ms/sample, of which march is 127.8. With bounding
  boxes off it is 988.9, march 771.9. Shade is 21-35 ms in every scene "whatever the geometry". What an SDF costs per
  step multiplies by every step of every ray; that is the currency below.

### Pieces to reuse

- **`core/field.js` samples a scene's signed distance on a lattice** (GRID mode), for the exporter
  (`builder/exportbox.js:142` onward). It compiles `scene.wgsl`, the render copy *with* box culling
  (`field.js:53`), so it is a bound away from objects but not necessarily a 1-Lipschitz one (inferred). To bake
  an existing scene, use the pick copy, which is not culled (`codegen.js:1395-1397`).
- **`builder/mesh.js` has `openEdges` and `meshVolume`** (`:157, 174`): the watertightness check and the volume
  a round trip compares.
- **A precedent for binary assets** is `optics/rayfiles.js:1-20`. Ray files are kept in IndexedDB by **name**,
  because "100 000 rays are 2.8 MB, too much to carry in a scene file". A scene names its file, and another
  machine shows "not loaded" until the file is chosen again.
- **A precedent for content keys** is `library/thumbs.js:31-37`: SHA-256 through `crypto.subtle`.
- **Why an asset cannot ride in the scene document:** undo keeps 100 whole copies of the project, on the
  ground that "a document is a few kilobytes of JSON" (`builder/history.js:7-8, 29`).
- **The only zip reader is in a test** (`builder/test/print.test.mjs:40`, `DecompressionStream('deflate-raw')`).
  The app writes 3MF; it reads none.
- **Profiles.** Their pieces are `segment` and `arc` (`core/shapes.js:772`), revolved or extruded, exact both
  sides. Nlens is spherical only (`core/sdf.js:446-468`). An aspheric lens is planned
  (BUILDER.md §6, phase 5).
- **Scene units.** A scene says which unit its numbers are in (`codegen.js:1461`, `unit: tree.unit ?? 'm'`).
  The bundled optics scenes are in cm and mm.

---

## 2. The formats, and how each would get in

| format | holds | units in the file | reader | route |
|---|---|---|---|---|
| **STL** (binary, ASCII) | triangles, a normal each; a triangle soup | none | own parser, ~100 lines | weld vertices, then grid |
| **OBJ** (+ MTL) | polygons, vertex normals, groups, material names | none | own parser | fan-triangulate, grid; MTL names → material slots |
| **PLY** | triangles or polygons, optional colours | none | own parser | grid |
| **3MF** | triangles, objects, colours, build transforms | yes (default mm) | own zip + XML reader | grid; colours → slots. Workers have no `DOMParser` |
| **glTF / GLB** | meshes, scene graph, PBR materials | metres by spec | own parser, uncompressed only | grid; Draco/meshopt would need their decoders |
| **STEP** (AP203/214/242) | exact B-rep: faces on planes, cylinders, cones, spheres, tori, B-splines; assemblies, names, colours | yes | OpenCascade, WASM | mechanical: tessellate → grid. Optical: section → profile (§6) |
| **IGES** | exact surfaces, often unsewn | yes | OpenCascade (occt-import-js reads it; occt-wasm does not) | as STEP |
| **BREP** (OpenCascade's own) | exact B-rep | n/a | OpenCascade | as STEP |
| **FreeCAD .FCStd** | a zip holding BREP files per shape (inferred from the format, no file opened) | as BREP | zip + OpenCascade | as STEP |
| **Rhino .3dm** | NURBS, B-reps, meshes, SubD | yes | rhino3dm.js (openNURBS, WASM, MIT) | meshes → grid. Whether it can mesh a B-rep with no render mesh cached in the file: **not checked** |
| **DXF** | 2D: LINE, ARC, CIRCLE, LWPOLYLINE with bulges, SPLINE | header variable | own text parser | **exact profiles**: a bulge is tan(θ/4) of an arc, so polylines become `segment`/`arc` pieces as they are. SPLINE needs fitting |
| **SolidWorks** .sldprt/.sldasm | Parasolid B-rep plus a display mesh, in a proprietary container | — | no free reader of the B-rep | **export STEP from SolidWorks** (below) |
| **Parasolid** .x_t, **ACIS** .sat, Creo, NX, CATIA, Inventor, **JT** | proprietary kernels | — | commercial SDKs only | export STEP |
| **OpenVDB / NanoVDB** | already a sparse level set | yes | own reader of NanoVDB's flat layout (inferred feasible) | straight into bricks (§3). Niche |
| **Zemax .zmx** | a sequential prescription: per surface CURV, CONI, PARM (asphere coefficients), DISZ (thickness), GLAS, DIAM. Text, possibly UTF-16 with a BOM | lens units in the file | own parser | **exact lenses** (§6). `GLAS` needs an index per glass; dispersion is only planned (FEATURES.md §3) |
| Zemax non-sequential objects | usually a CAD part wrapped in a Zemax object (inferred) | | | the CAD part's own route |
| **Zemax ray files** (.DAT) | rays of a source | yes | **built** (`lib/pathtracer/optics/zemax.js`) | already a light |
| **IES / LDT** | a luminaire's intensity distribution | | planned (PLAN.md, *Optics module* phases 5-6) | a source, not geometry |

### SolidWorks

- **SolidWorks' exact geometry is Parasolid, which needs the Parasolid SDK.** There is no free reader.
- **A SolidWorks file also carries a display mesh, which can be decoded.**
  [sldprt-export](https://github.com/XRTC5/sldprt-export) does so: MIT, Python plus a browser viewer, 26
  commits and no stars on 2026-10-02.
  - It reports one part within 0.02 mm of the same part exported through Fusion.
  - A component that was itself imported from STEP has no tessellation to decode.
  - It is the display mesh, at whatever quality the file was saved with.
- **Commercial SDKs read all of these:** CAD Exchanger, HOOPS Exchange, Datakit. Not priced here.
- **For this tool the route is File → Save As → STEP** (AP214 or AP242), which every one of these programs
  has. The user does not use SolidWorks natively (2026-10-02), so this costs nothing now.

### OpenCascade in the browser: two packages

Both are OCCT compiled to WebAssembly, and both are LGPL-2.1 in what they ship.

- **[occt-import-js](https://github.com/kovacsv/occt-import-js)**: reads STEP, IGES and BREP and returns
  **triangles only**. Per mesh it gives positions, normals, indices, a name, a colour, and `brep_faces`
  (triangle ranges per source face, each with its colour).
  - `linearDeflection` is a ratio of the bounding box by default, or an absolute value; there is also
    `angularDeflection`, and `linearUnit` sets the output unit.
  - **No surface types.** It cannot tell a sphere from a B-spline.
  - Mature: it is what the Online 3D Viewer uses (inferred from that project's dependency, not checked
    today).
- **[occt-wasm](https://github.com/henmedia/occt-wasm)**: OCCT 8.0.1, about 4.5 MB brotli.
  - Has `surfaceType()`, a plane `section()`, `tessellate()` with linear and angular deflection, and an
    `OcctWorker` class (Comlink).
  - Reads STEP, STL and BREP. **No IGES**, by design.
  - Needs WASM SIMD, tail calls and wasm exceptions (Chrome 114+). Newer, with less history.

**Recommendation:** occt-wasm, because the optics route (§6) needs surface types and sections, which only it
has. Load it lazily, in a Worker, vendored under `lib/` like dockview. It is the first dependency of this size
the app would carry, and the first WASM.

---

## 3. What the SDF could be, by what a march step costs

All costs here are **inferred** until P0 measures them. They are ordered by what the hardware does per step.

1. **Analytic shapes and profiles.** Exact, and arithmetic only.
   - A profile evaluates every piece at every step (`core/shapes.js:851-874`), so an asphere fitted with 40
     arcs is 40 pieces.
   - **2D grids** are the cheap middle ground for extrusions and revolutions: the profile's distance baked
     into a 2D table. Its interpolant's gradient is at most √2, against √3 in 3D (§4), and it costs width ×
     height, not a cube.
2. **A dense 3D texture of `r16float`, read with one hardware-trilinear sample.**
   - In a compute shader the read is `textureSampleLevel`; `textureSample` is fragment-only.
   - **r32float cannot be filtered without `float32-filterable`**, which the host does not ask for
     (`index.html:264` asks for `timestamp-query` only). r16float can.
   - **r16float is not a core storage-texture format**, so a GPU bake writes a buffer and copies it in with
     `copyBufferToTexture`, rows aligned to 256 bytes.
   - **Core WebGPU has no 3D texture arrays**, so one atlas texture must hold every import. A binding per
     import would meet the 16-texture limit.
   - **Memory, derived:** 256³ is 32 MiB, 512³ is 256 MiB, and the default `maxTextureDimension3D` is 2048.
     A 200 mm housing at 512³ has 0.39 mm cells; at 256³, 0.78 mm.
   - **Hardware filtering is fixed point.** Texture units quantise the position inside a texel to 1/256:
     D3D requires at least 8 bits, and ~89% of Vulkan devices report exactly 8 (Reed, Sources). That
     WebGPU on the user's GPU is the same is inferred. So the *value* is good to about 1/256 of a cell's
     variation, but finite differences of it at `normalEps` would be noisy. The normal has to come another
     way (§4).
3. **A packed-f16 storage-buffer pool**, interpolated in the shader from 8 reads.
   - It puts `prog_shade` at 9 bindings: a check-shaders note, needing an adapter past the floor. The optics
     shade goes to 8.
   - It has an **exact JS twin**, which a Node test can hold to the same numbers, and no weight quantisation.
   - It costs 8 loads instead of 1 filtered sample. Whether that matters on the user's card is exactly what
     P0 measures.
4. **Sparse narrow-band bricks.** Fine cells only near the surface, in bricks packed into an atlas, with a
   coarse index grid: two dependent reads per step.
   - **Memory, derived:** a 9³ brick sharing its border is 1458 B in f16.
   - A 200 mm × 100 mm × 100 mm housing (outer area ~1×10⁵ mm²) at h = 0.2 mm has area/(8h)² ≈ 39 000
     bricks ≈ 57 MB. Real counts run 1.5-3× that, because a surface crosses more cubes than its area fills
     and the band spills into neighbours: **~85-170 MB**, and double for a hollow part's inner walls.
   - An 18 mm lens (~800 mm²) at h = 0.02 mm is ≈ 31 000 naive bricks: **~70-140 MB**.

   So bricks make a 0.2 mm housing affordable and a micron lens not. Optics goes the exact way (§6).
5. **Distance to the triangles, through a BVH, at every step.** Tens of node visits and triangle tests per step
   (inferred), and a ninth storage buffer in shade. This is how a grid is *baked* (§5), not how it is marched.
   - The renderer's README planned meshes this way until 2026-10-02 ("`init` uploads vertex/index/BVH
     buffers and `wgsl` traverses a BVH"); it points here now.
   - A BVH that returns a ray's hit distance, rather than a distance field, would break field, the box
     measurement, the exporter and finite-difference normals. With `stepscale` 0.9 it would still be
     traversed several times per hit (inferred).
6. **Hybrid.** The grid gives the step; within a cell or two of the surface, the exact surface (the binned
   triangles, or the analytic B-rep face) gives the hit and the normal. Exact where it matters and cheap
   elsewhere.
   - It works only for a part at the top level. Inside a smooth blend the field itself must be continuous,
     and switching from grid to exact is not.
   - It is the most code of any of these. For freeform optics only, if ever.
7. **A neural SDF** (a small network per part): skipped. It needs training, its per-step cost is a
   matrix-vector product per layer, and it has no bound the march could trust.

**Per-node culling already helps all of these.** A part at the top level is only evaluated when the ray is
inside its padded box (`codegen.js:1395-1433`), so what one costs per step is paid only near it.

---

## 4. Is a grid safe to march? (derived)

`f` is the true signed distance of the part, sampled exactly at the lattice points with spacing `h`; `I` is its
trilinear interpolant. A Node test should check each of these numerically, the way `core/test/shapes.test.mjs`
checks the shapes. None does yet.

- **I's gradient is at most √3 in length.**
  - ∂I/∂x is a convex combination of the four x-edge differences of its cell, each at most `h` because `f` is
    1-Lipschitz. So |∂I/∂x| ≤ 1, and likewise for y and z.
  - The bound is tight: next to a convex vertex of the part, `f` is |p − v| and the three edge differences at
    the nearest corner all approach `h`.
  - So **a march step of |I|·0.9 can overshoot I's own surface**. The safe step is |I| / L.
- **L can be computed exactly per cell at bake time.** Each component of ∇I squared is convex along every axis
  line, so |∇I|² peaks at a corner. There ∇I is the three edges meeting at that corner, divided by `h`. So
  L_cell = max over the 8 corners of |(Δx, Δy, Δz)| / h.
  - Every CAD part has convex vertices, so a single L for the whole part will be about 1.5-1.7 (inferred).
  - That makes every step near the part that much shorter. An L per brick or per coarse cell, read with the
    distance, keeps L ≈ 1 on the flat faces (inferred; the bake can report the histogram).
- **The surface moves by at most (√3/2)·h.**
  - |I(p) − f(p)| ≤ Σ wᵢ |cᵢ − p| ≤ √(Σ wᵢ |cᵢ − p|²) = h·√(Σₐ tₐ(1 − tₐ)) ≤ (√3/2)·h, at a cell's centre.
  - **A wall thinner than h can vanish**: an axis-aligned sheet that fits between two lattice planes has no
    sample inside it. Sheet-metal reflectors (0.5-1 mm) need h well under their thickness: bricks, or an exact
    extruded or revolved profile.
- **Outside the grid's box**, the distance must be a bound too. Use the distance to the part's bounding box
  (exact or less). Do not use `sdBox(p) + I(clamp(p))`, which can be too large where the clamped point's
  distance points sideways.
- **The far field is a band clamped, plus a coarse grid.** A narrow band of exact values clamped to ±band
  is a bound outside the band. A coarse exact grid minus its own (√3/2)·h_coarse is a bound everywhere.
  **Jump flooding is not**: it propagates the nearest *seed*, and can overestimate.
- **Normals.**
  - Interpolated, ∇I is continuous inside a cell but jumps across cell faces, by an angle of order h/R on a
    surface of radius R (inferred). That is 0.3° at h = 0.05 mm, R = 10 mm.
  - Finite differences of a hardware-filtered sample add the 1/256 quantisation of §3 on top.
  - **The safe choice is the analytic gradient of I from its 8 corner values** (`textureLoad`, or the
    buffer), computed only when |I| is within a cell or two of zero. That is when the march is about to
    stop, so the cost is near the surface only.
  - Alternatively, store the closest point's true normal per texel (4 more bytes), interpolated.

---

## 5. Baking a mesh into a grid

Start on the **CPU, in a Worker**, so that a Node test can hold the result to exact point-to-triangle
distances. Move it to the GPU only if the user finds it slow.

1. **Weld** an STL's soup: equal positions become one vertex. Then `openEdges` (`builder/mesh.js:157`) says
   whether the mesh is closed. OpenCascade's tessellation of a valid solid is (inferred); STL from the wild
   often is not.
2. **The exact distance, in a narrow band.** Bin triangles into the bricks they touch, padded by the band.
   Each lattice point takes the minimum over its brick's triangles of the exact point-to-triangle distance.
   On the GPU this is a scatter with `atomicMin`.
3. **The sign.**
   - **Closed mesh:** parity of crossings along lattice columns, voted over three axes. It is cheap, and wrong
     only where a column grazes an edge, which the vote outvotes.
   - **Open mesh or a soup:** generalized winding numbers (Barill et al. 2018). They are robust to holes and
     cost more.
4. **The far field:** a coarse exact grid, or a clamp (§4).
5. **L per brick** (§4), stored next to the bricks.
6. **A cache**, keyed by (the file's SHA-256, h, the bake's own version), so the bake runs once per file and
   resolution, not once per reload.

**Checks a bake can make without a GPU:**
- the baked field against exact point-to-triangle distances at random points (never too large inside);
- the zero set's volume against `meshVolume` of the source;
- for a closed source, the sign everywhere against parity along random rays.

**Round trip:** import → bake → `runExport` (`exportbox.js:142`) → compare volume and open edges. This needs
the GPU, so it is the user's to run.

**How long a bake takes is unknown.** The one published figure found is not comparable: Unity's mesh-to-sdf
does a 32³ grid of a 5k-triangle mesh in ~0.2 ms on an RTX 3090 (its README), real-time-sized, not a CAD part.

---

## 6. Optics

### What an optical surface needs

**The zero set and the normal on it.** The distance off the surface only decides how many steps the march
takes. A shape whose distance is only a *bound*, but whose zero set and normal are exact, is optically exact.

### Why not through a mesh (derived)

- A chord on an arc of radius R with sag δ spans a half-angle θ, where δ = R(1 − cos θ) ≈ Rθ²/2. So the facet's
  normal is off by up to θ = √(2δ/R).
- At R = 10 mm, δ = 0.01 mm that is **0.045 rad = 2.56°**. At δ = 1 µm, still 0.8°.
- A refracted ray inherits an error of the same order, so a 10° beam would be blurred by its own facets.
- OpenCascade's angular deflection caps the facet angle directly, but a cap of 0.1° on a whole housing is a
  lot of triangles.
- A grid of the tessellation inherits the facets; a grid of the exact surface still has the h/R of §4.

### The exact routes

1. **A sag surface as a bound.** For z = s(r) (conic plus even asphere), the distance g = (z − s(r)) / L with
   L = max over the aperture of √(1 + s′²):
   - **is 1-Lipschitz**: |∇g| = √(1 + s′²)/L ≤ 1;
   - **is zero exactly on the surface**, so it is never more than the true distance, inside or out;
   - **gives the exact normal** on the surface: ∇g normalised.

   For a lens, which is the intersection of two such half-spaces and a cylinder, `max()` of the bounds stays
   a bound both sides. Inside, |max gᵢ| = min |gᵢ| ≤ min |dᵢ| ≤ the true distance. Two caveats:
   - s must be defined for every r: s(min(r, r_aperture)), with a conic's square root kept real inside the
     aperture;
   - a steep wall makes L 2-3 and every step near it shorter.

   This is BUILDER.md §6, phase 5.
2. **Better, with no new primitive: arcs.** Fit the sag curve with biarcs (pairs of arcs, tangent where they
   meet) to ~0.1 µm. Feed them to the existing **revolve**, whose pieces are segments and arcs
   (`core/shapes.js:772`).
   - The result is an exact distance to the fitted curve, with a continuous normal.
   - The cost is one piece per arc per step (unmeasured).
   - A Zemax prescription becomes a profile this way. So does a supplier's TIR lens, if its profile can be got
     at (next).
3. **A STEP solid of revolution, cut through its axis.**
   - occt-wasm's `surfaceType()` tells whether a part's faces share an axis: planes across it, and cylinders,
     cones, spheres and tori around it.
   - Its plane `section()` through that axis gives the meridian curve. Lines and circular arcs map onto profile
     pieces exactly; a B-spline in it is fitted as in 2.
   - An extruded part (a light guide, an aluminium profile) gives its outline the same way.
4. **DXF outlines** of the same parts, if the user has them, are profiles directly (§2).

### What may not work

- **Supplier STEP may not keep the surface types** (inferred). A symmetric lens can arrive as B-spline faces,
  or as open shells needing sewing. Before building route 3, list the face types of three real supplier files
  with occt-wasm.
- **CAD exchange is itself approximate for high-order aspheres.** Zemax's own documentation says conics
  survive as NURBS exactly, but polynomial aspheres only to limited accuracy. So for the user's own lenses the
  .zmx is the better source than a STEP export.
- **Supplier photometry may beat supplier geometry.** For an optic used as-is on its LED, the supplier's ray
  file or IES file of that pair is the measured answer. Ray files are already read; IES is planned. Geometry
  is needed only when the optic interacts with the user's own parts: a cover, a reflector around it, a guide.
- **A transparent material on a grid part should warn**, since its normals are only as good as §4.

### How to know (to run on the user's GPU)

- A `tests.js` row:
  1. bake the analytic `Nlens` of the optics test scene into a grid at two resolutions;
  2. trace the far field of each;
  3. compare against the analytic lens: beam angle, peak cd, total flux.

  That measures what a grid does to optics, in the units that matter, before any importer exists.
- The same row later takes a .zmx-imported lens against the same lens built by hand.

---

## 7. What an import touches (the second-caller list)

The failure this repository repeats is a thing true for its only caller that stops being true for the second
(CLAUDE.md). An imported part is the first scene data the renderer has ever had to carry. Every place it
reaches:

- **The asset.**
  - Its bytes go in IndexedDB keyed by SHA-256, like rayfiles but by content, not name.
  - The scene stores {hash, name, unit, bake settings}.
  - "Not loaded" is shown on a machine without the file (as `builder/panel.js:376` does for ray files).
  - The library's export and its studio thumbnails need the asset present too.
- **The GPU copy.** A cache keyed by hash, with reference counts and a dispose; `init` must not reupload per
  edit. `R.init` must run the first scene's `init` (`raytrace_main.js:772-791`).
- **A new object type**, like `light` and `export`, which exist because their data must stay known
  (`builder/lights.js:4-10`, `exportbox.js:5-10`):
  - model: add/set, `validate`, `toTree`, a `VERSION` upgrade;
  - codegen: `NODE_TYPES`, `object()`, and `generate()` returning `resources` and `init`;
  - the tree's menu, the properties panel, the parameter registry;
  - `bounds.js` / `boxes.js`, the overlay;
  - `extent` (`codegen.js:752`), which sizes `autoEps`;
  - with a limiter, the optics copies need every resource the render copy has.
- **Every kernel the resources reach** (§1): march, shade, occlude, pick, field, tagfield, the optics march and
  shade.
- **tinywebgpu**: create and write 3D textures, if the texture route wins. `lib/tinywebgpu/src/tinywebgpu.js` is fair game
  (CLAUDE.md); `lib/utils.js` is not, and nothing here needs it.
- **The compile probe** (`validate.js:60-61`) must declare the scene's resources.
- **check-shaders** must count textures apart from storage buffers. It must also build **a scene that binds a
  resource**, since none does today: "a feature behind a flag that nothing exercises is code that has never
  run" (CLAUDE.md).

---

## 8. A recommended order (a recommendation; nothing is built)

| phase | what | what it decides or delivers |
|---|---|---|
| **P0** | Make the resources path real: first-scene `init`, the asset cache and dispose, the probe, check-shaders, one checked scene that binds a grid. Bake an existing scene (pick copy) into a grid in JS. **Two `tests.js` rows:** (a) the same scene analytic vs. as a texture vs. as an f16 buffer, ms/sample and steps; (b) the Nlens far field of §6. | Texture or buffer; whether L per brick is needed; whether a grid is ever good enough for glass. Measured by the user, not here |
| **P1** | Exact optics with no assets: biarc-fitted sag → revolve; .zmx sequential reader; DXF outlines → profiles | The user's own lenses, exactly |
| **P2** | STL / OBJ / 3MF → weld → bake (CPU Worker) → dense grid; a `mesh` object in the builder; opaque materials | Mechanical context from mesh files |
| **P3** | STEP through occt-wasm in a Worker: tessellate for mechanical parts; `surfaceType` + `section` → profiles for optics; colours → material slots, assemblies → groups | Supplier and own CAD |
| **P4** | Sparse bricks | Only if P0/P2 show dense grids too coarse at an affordable size |
| **P5** | Hybrid exact refinement near the hit | Only for freeform optics that neither a profile nor a grid serves |

**P1 before P2:**
- it needs none of P0's plumbing;
- it serves the parts where accuracy is the point;
- it reuses shapes that are already exact and tested.

**P0 before both,** because without it nothing that carries data can be tested.

---

## 9. Open questions, and what answers each

- **What does a grid cost per march step, against an analytic shape, on the user's card?** P0 row (a). Until
  then every cost in §3 is a guess.
- **Hardware-filtered texture or 8 loads from a buffer?** P0 row (a), both variants.
- **How far is a grid lens's far field from the exact one, at what h?** P0 row (b).
- **What L does a real part's bake have, and is L per brick worth it?** The bake reports it; the steps in P0
  row (a) show it.
- **Do supplier STEP files keep their surfaces' types?** Open three with occt-wasm (Node is enough) and list
  the face types.
- **Does rhino3dm.js mesh a B-rep itself?** Its API reference; only if Rhino files turn up.
- **How long does a bake of a real housing take in a Worker?** The user, on the first real file.
- **What does an arc-fitted asphere cost per step, and how many arcs does 0.1 µm take?** The fit can be counted
  in Node; the cost is a `tests.js` row.

---

## 10. Licences (facts, not advice; FEATURES.md §13 is the inventory)

- **OpenCascade (OCCT) is LGPL-2.1**, and so are both WASM builds' outputs. occt-wasm's tooling is MIT or
  Apache-2.0, and it states that end users may substitute the `.wasm` file. Everything vendored today is MIT
  (FEATURES.md §13), so this would be the first LGPL file in the app.
- **rhino3dm.js** is MIT.
- **sldprt-export** is MIT.
- **Parasolid, ACIS, JT and the commercial exchange SDKs** are licensed per seat or per product. Not priced.

---

## 11. Primitives and booleans: built (2026-10-21, 0.71.0)

The user, 2026-10-21: *"Start working on stl and step import. Investigate possibilities to optimize these for
sdf/pathtracing. Eg conversion to primitives with boolean operations if that helps to simplify the model/optimize for
fast tracing."* It helps. For the parts this tool imports (mechanical context, holders, housings, spherical lenses), it
also beats every route sections 2-8 weighed, on everything that can be checked without a GPU.

**How sure each line is:** as at the top. Everything **measured** here was measured in Node, in the container (Intel
Xeon, 2.1 GHz, 4 cores), against OpenCascade 7.9's own answers (CadQuery 2.8, `import/test/fixtures/make.py`). **No
render time is measured.** A conversion time is the JavaScript's on that CPU, not the user's browser.

### 11.1 The answer on one screen

- **A solid whose faces lie on planes, cylinders, cones, spheres and tori is a boolean formula over its surfaces'
  half-spaces** (Shapiro and Vossler, 1991). Min and max of exact half-space distances is 1-Lipschitz and zero
  exactly on the surface, so it is a lower bound on the distance, safe to march. Held, `import/test/csg.test.mjs`: at
  every OpenCascade point of every fixture, |f| <= OpenCascade's distance to the surface, and the sign is right.
- **The formula becomes the builder's own presets**: box, cylinder, sphere, torus, and a cone written for the import
  with its own normal. Each is a code node sharing its preset's block, in groups joined by union, intersect and
  subtract. So an imported part is something the user can see, select, edit and move. The renderer compiles it like any
  scene (check-shaders: all four passes, naga included, over the new Imported parts example). Its normals are analytic.
  The renderer's culling boxes are measured for it as for any top-level node.
- **The same route takes an STL from CAD.** Its vertices lie on the surfaces it was tessellated from, so those
  surfaces can be fitted back (`import/fit.js`). Each fixture's STL gives back exactly the faces OpenCascade's B-rep
  has, and the same shapes as its STEP (measured, table below): a 24-sided hole is a cylinder again.
- **Optics comes for free.** A STEP lens with spherical faces is two spheres and a capped cylinder, exactly: section
  6's route 3, without OpenCascade and without a profile.
- **What it cannot do goes to the grid route of sections 3-5, which is still not built.** That is freeform (B-spline)
  faces and meshes that are not CAD tessellations (scans, sculpts). Both are refused by name, with why.

### 11.2 What was built (read in code)

- **`import/step.js`: our own STEP reader, not OpenCascade's.** Section 2 recommended occt-wasm, a 4.5 MB LGPL
  WebAssembly build, for the surface types only it reported. But the file says each face's type in plain text, and
  reading the topology and the analytic geometry is about 450 lines with no dependency. It reads:
  - entities lazily, units (an SI prefix or the inch; the angle unit, since a cone's semi-angle is in it);
  - faces, loops and edges, each edge sampled along its curve (line, circle, ellipse, B-spline, or one inside a
    SURFACE_CURVE or SEAM_CURVE);
  - an assembly's placements, by REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION and by MAPPED_ITEM.

  A face on a B-spline, a surface of revolution or extrusion, or an offset surface is kept and typed, and the solid is
  refused.
- **`import/brep.js`: inside the solid, exactly.** Rays meet the exact surfaces, and each hit is counted where its
  face's loops say, in the surface's (u, v). Plane, cylinder and cone faces use parity along their axis. Sphere and
  torus faces use the nearest boundary point. Seam edges are dropped. On 15,000 OpenCascade points over five parts,
  and 2,000 more on an assembly, it disagrees nowhere (measured).
  - **Found on the way: OpenCascade 7.9's own STEP export breaks ISO 10303-42 for a torus whose axis it flipped.**
    The boss's inner fillet has its face on the wrong side of its loop. Read by the rule, the fillet was the other
    three quarters of the tube. So a sphere's or torus's face takes its side from a neighbouring face across a shared
    edge; the file's rule is only a fallback, and is counted (`guessed`).
- **`import/fit.js`: an STL's surfaces found again.** Flat patches first, then curved regions grown from the smallest
  patches. A region's type is decided from 12, 8, 5 or 3 neighbouring patches, simplest first. Cones and tori need 8
  or more patches, and every fit three vertices more than it has parameters. A region grows only by patches whose
  vertices are on the surface and whose facets stray from it by less than a tenth of their edge. It is refitted
  whole, and merged into a bigger neighbour it lies on. A chamfer one facet wide fits a sphere as well as its cone,
  through the same two circles; the facets' sag tells them apart. A cone's axis comes from its normals' plane,
  because the line-complex axis is ill-posed on a narrow band.
- **`import/csg.js`: the formula.**
  - Half-spaces from the faces, plus SEPARATORS where a curved face ends: planes through its axis at the angles it
    spans, planes across it, a torus's cones.
  - Cells sampled on both sides of every face, around every edge and through the box, and classified by
    `brep.js`/`fit.js`.
  - GLOBAL literals taken out first (the outer planes, the through-holes).
  - A cover of the remaining cells inside by prime implicants (Espresso's EXPAND, by coverage gain). Every pair of
    inside cells across one surface is covered by one product, so no union of two touching products leaves a zero
    inside the solid (a SEAM, which a ray inside glass would stop at).
  - Factored, intersected with its sampled box, then checked against the solid at points it was not built from.
- **`import/shapes.js`: bounded shapes.** Planes become oriented boxes (a pocket's five sides are one box standing
  out of the top). A cylinder takes a box's caps when the box holds its circle. Anything infinite is cut to the
  part's box, which is safe because the whole formula is inside it. De Morgan turns a union of complements into a
  subtracted shape.
- **The page**: File › Import from file… and a dropped file take `.step`, `.stp` and `.stl`. The conversion runs in a
  module Worker (`import/worker.js`). The part is pasted into the scene being worked on as one undo step, in mm
  converted to the scene's unit (model.js insertAsset), and made of the scene's default material.
- **What is checked without a GPU:** `import/test/step.test.mjs`, `stl.test.mjs`, `csg.test.mjs`, `import.test.mjs`,
  `bench/test/imported.test.mjs`, and check-shaders over the Imported parts example (`scenes/make.mjs` makes it from
  the fixtures).

### 11.3 What it gives, part by part (measured, Node, the container, 2026-10-21)

Times are two runs on an idle CPU, as a range.

| part | faces (OpenCascade) | half-spaces (separators) | literals | shapes / groups | STEP: read + convert | STL: triangles | STL: fit | STL: convert |
|---|---|---|---|---|---|---|---|---|
| plate | 15 (11 plane, 4 cylinder) | 15 (0) | 16 | 6 / 1 | 0.4-0.5 s | 1052 | 0.1 s | 0.1 s |
| bracket | 12 (8 plane, 4 cylinder) | 16 (4) | 17 | 9 / 4 | 0.3 s | 660 | 0.07 s | 0.08-0.09 s |
| boss | 9 (3 cylinder, 1 cone, 2 torus, 3 plane) | 13 (4) | 14 | 9 / 3 | 1.2-1.3 s | 4978 | 2.7-3.2 s | 0.1 s |
| lens | 3 (2 sphere, 1 cylinder) | 3 (0) | 4 | 3 / 1 | 0.5 s | 534 | 0.05-0.06 s | 0.04 s |
| rounded box | 26 (6 plane, 12 cylinder, 8 sphere) | 32 (6) | 39 | 27 / 8 | 0.8-0.9 s | 2796 | 0.3-0.4 s | 0.2 s |

In headless Chromium, the page's own Worker (`import/worker.js`) took the whole of each file in 0.5 s (plate.step),
1.8 s (boss.stl), 1.7 s (assembly.step) and 0.2 s (lens.stl): measured once, in the container.

- **Every point agrees.** For the STEP of all five, the formula and the shapes are on OpenCascade's side of the
  surface at all 3000 points each, and never more than its distance (`csg.test.mjs`). For the STL, they agree at
  every point farther from the surface than 2.5 times the mesh's band, the distance its facets stray from the fitted
  surfaces (0.002 to 0.04 mm here; the files were exported at 0.02 mm and 0.2 rad).
- **The plate is what a hand writes:** a 40 x 30 x 5 box, four 4 mm holes, a 12 x 8 pocket.
- **The lens is its two spheres (R 20 and R 30) and its edge.**
- **The rounded box is not.** It is 27 shapes where one rounded box would do (11.5).
- **Where the conversion's time goes** (inferred from what each step does, not profiled):
  - for STEP, mostly the cell sampling's ray tests, every face's surface against every ray; a torus is stepped
    along each ray (geom.js);
  - for STL, the fits, refitted as a region grows and checked against every facet's probes. The boss's tori are
    4978 triangles.

### 11.4 What a march step costs (inferred: Tests › imported measures it)

- **Per step, every shape in the part is evaluated** while the ray is within its top-level box. codegen culls only at
  the root (ONLY AT THE ROOT, `builder/codegen.js`). Far from the part it is one box test. Near it, it is the
  sum of its shapes: 6 closed-form shapes for the plate, 27 for the rounded box. Against section 3's
  alternatives: a grid is one filtered read or eight loads per step, plus its normal. A triangle BVH is tens of
  node and triangle tests. Neither is measured; nor is this.
- **The step is a bound, not the distance.** Beyond a right-angled edge, max of the two planes' distances is never
  less than 0.707 of the true distance (derived: max(a, b) >= sqrt(a^2 + b^2) / sqrt(2)); it is less beyond a sharper
  edge. So a ray grazing an edge takes more steps than with an exact distance. How many more is unmeasured. The
  recognised shapes (a box, a capped cylinder) are exact where their planes were a max.
- **The normal is the nearest shape's, analytic.** None of the three extra scene evaluations a hit costs without one
  (section 1, measured +328% when every shape lacked one).
- **What would make it slow:** a part of hundreds of faces (a filleted housing) as hundreds of shapes in one top-level
  group, all evaluated at every step near it. Three remedies, none built: boxes per group inside a part (codegen culls
  only at the root today); recognising patterns (11.5); one code node evaluating each half-space once and combining
  them by min and max (a shape used by two products is evaluated twice now).
- **Tests › imported** (`bench/imported.js`) measures the first question on the card:
  - the Imported parts example as imported;
  - the same with its two rounded boxes (27 shapes each) and its lens (3) one preset each;
  - the floor alone.

  Row 1 less row 3 is what the parts cost; row 1 against row 2 is what recognition would save.

### 11.5 Next, in this order (a recommendation)

1. **The user runs Tests › imported**, opens the Imported parts example and judges the picture. Both have to come
   first: nothing here has been seen.
2. **Recognition of the patterns CAD makes most**, if row 1 is clearly slower than row 2:
   - a box rounded on every edge (12 cylinders and 8 spheres of one radius: one `box` with `rounding`);
   - a tube (a cylinder less a coaxial one);
   - a spherical lens (`lens`);
   - a cylinder with a chamfer or a fillet at its end.
3. **Culling inside a part**: a box per group under the part, tested before the group's shapes, if a big part's step
   cost is what row 1 shows.
4. **B-spline faces that are really planes or cylinders.** Some exporters write every face as a B-spline. Sample the
   face, run fit.js's fitters on it, and keep the analytic surface if it fits to the tolerance. A face that is truly
   freeform is the grid's (sections 3-5, P0), or the asphere's (BUILDER.md section 6) if it is a lens.
5. **Colours and names from STEP** (STYLED_ITEM's COLOUR_RGB) as materials; OBJ, PLY and 3MF through the same fitter.
6. **Speed of the conversion**, only if a real part is slow: face boxes for the ray tests, and the cover's bit sets.

### 11.6 Limits, said

- **Sampled cells.** A cell of the arrangement smaller than the sampling can be missed. It is then decided by the
  cover, possibly wrongly. The conversion checks itself at 3000 fresh points and reports `mismatches`; on these five
  parts it is 0. Five parts are not every part.
- **STL is taken as millimetres**, as every slicer and CAD exporter writes it.
- **One material per import**, the scene's default; an assembly's parts are separate groups and can be given others.
- **MAX_FACES = 400** a solid (csg.js). The rounded box's STL as 2598 facets, before fitting found its surfaces,
  took 144 s to convert in Node.
- **Not read:** IGES, B-spline faces, open shells (a STEP surface model), meshes that are not closed.

---

## Sources (read 2026-10-02)

- occt-import-js: https://github.com/kovacsv/occt-import-js (README: formats, `params`, output, LGPL-2.1)
- occt-wasm: https://github.com/henmedia/occt-wasm and https://unpkg.com/occt-wasm/README.md (OCCT 8.0.1,
  ~4.5 MB brotli, `section()`, `surfaceType()`, `OcctWorker`, LGPL-2.1 output)
- rhino3dm: https://github.com/mcneel/rhino3dm
- sldprt-export: https://github.com/XRTC5/sldprt-export
- CAD Exchanger on SolidWorks/Parasolid into OpenCascade:
  https://cadexchanger.com/blog/how-to-import-solidworks-or-parasolid-jt-nx-creo-files-into-open-cascade/
- Zemax, accuracy of CAD exchange: https://support.zemax.com/hc/en-us/articles/1500005486861-How-accurate-is-the-CAD-exchange
- Zemax .zmx keywords: https://raytracing.readthedocs.io/en/1.3.6/modules/raytracing.ZMXReader.html
- Sub-texel precision: https://www.reedbeta.com/blog/texture-gathers-and-coordinate-precision/
- WebGPU limits: https://www.w3.org/TR/webgpu/ (`maxTextureDimension3D` 2048, `maxStorageBuffersPerShaderStage`
  8, `maxSampledTexturesPerShaderStage` 16)
- Barill, Dickson, Schmidt, Levin, Jacobson, *Fast Winding Numbers for Soups and Clouds*, SIGGRAPH 2018:
  https://www.dgp.toronto.edu/projects/fast-winding-numbers/
- Unity mesh-to-sdf: https://github.com/Unity-Technologies/com.unity.demoteam.mesh-to-sdf
- (2026-10-21, section 11; from memory, not fetched) Shapiro and Vossler, *Construction and optimization of CSG
  representations*, Computer-Aided Design 23(1), 1991, and *Separation for boundary to CSG conversion*, ACM TOG 12(1),
  1993: half-spaces of a B-rep's faces, separators where they do not suffice, a union of products. Brayton et al.,
  *Logic Minimization Algorithms for VLSI Synthesis* (Espresso), 1984: EXPAND and IRREDUNDANT. Pottmann and Randrup,
  *Rotational and helical surface approximation for reverse engineering*, Computing 60, 1998: the axis of a surface of
  revolution as the line its normal lines meet. ISO 10303-42 for the surfaces' parametrisations and a face's loops.
