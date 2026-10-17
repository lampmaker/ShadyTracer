# What is in this repository — every feature, and how far along it is

Written 2026-09-30 against `main` at `aeef5b9`, for deciding what this could be sold as. It is
an inventory, read from the code and from the status documents, not a plan. It covers the
raytracer and what it is built on. It was written in the RAYTRACER_WEBGPU monorepo; on 2026-10-10
the application moved into this repository of its own, and the lines about the repository itself
(the table below, sections 10, 11 and 13) were brought up to date then.

**How sure each line is.** CLAUDE.md's rule applies: know or think. Nothing below was run on a
GPU by whoever wrote it — the container has none. Every hardware status is copied from where
the user's own measurements are recorded (`docs/TESTING.md`, `PLAN.md`,
`PERFORMANCE.md`, `SURFACES.md`, `roadmap/BUILDER.md`), with the card and date where they give one.
The Node tests named here were run in the container on 2026-09-30 and all pass.

| status | meaning |
|---|---|
| **verified** | a known-answer bench passed on the user's hardware |
| **in use** | the user has used it on hardware and said it works; no known-answer test |
| **built** | in the code and reachable in the UI; checked without a GPU (Node or headless tests) or not at all; **not recorded as seen on hardware** |
| **script** | in the code, reachable only from the console, a URL flag or the API |
| **planned** | in a plan document; no code found |

Several "built" entries (the shell, the library, the timeline) have code comments quoting the
user's feedback on them, so they have probably been used; the status documents just do not say
so. See *Docs that disagree* at the end.

---

## At a glance

| | what it is | open | where it stands |
|---|---|---|---|
| **ShadyTracer** | A browser application: a physically based path tracer in real light units (cd/m², lux), a scene builder over signed-distance geometry, and a non-sequential optics trace for LED and luminaire optics — far field, illuminance maps, colour — over the same scene | `index.html` | Renderer, light units and refraction **verified**; builder **in use**; most of the optics analysis and the measuring **built** |
| **TinyWebGPU** | A single-file WebGPU micro-framework | `lib/tinywebgpu/` (submodule) | Public at `lampmaker/tinywebgpu`, MIT; 0.5.0 took in everything this application's copy had grown |
| **Shared libraries** | Application shell (docking, palette, parameters), keyframe timeline with MP4 export, property table / tree view, render loop and cost meter | `lib/` | Used by the raytracer |

About 62 000 lines of JavaScript, WGSL and HTML (vendored libraries and the toolkit's release tree
included) and 8 600 lines of documentation, weavesim not counted. Everything runs in the browser,
on the user's own GPU; there is no server.

---

## 1. The renderer — `lib/pathtracer/`

### 1.1 Engine

| feature | status | evidence |
|---|---|---|
| **Wavefront path tracer on WebGPU**: rays live in GPU buffers; march, shade and occlusion kernels; GPU-side counters drive indirect dispatch | in use | `lib/pathtracer/README.md`, `core/wavefront.js`, `core/raytrace_main.js` |
| **Signed-distance scenes**: every surface is WGSL distance code; no meshes anywhere | in use | `core/scene_api.js` (`SCENE_PRELUDE`) |
| **Embeddable component**: `createPathTracer({gpu, ctx, scene, CAMERA})`, `sample(n)`, an opt-in loop, `set`/`get` of every setting, `pick(x, y)`, `setScene`, `invalidate` | script | `lib/pathtracer/index.js`; README § *The API* |
| **Offscreen rendering** at any size: `beginOffscreen` / `renderFrame` / `grabFrame` / `endOffscreen` (the timeline's host contract) | built | `index.js` |
| **Pipelines compiled off the main thread**, so a heavy scene does not freeze the tab | in use | README § *Compile off-thread* |
| **Ray budget capped by memory** (~2.31 M rays): a sample with more rays and photons runs in batches, so every size traces one camera ray a pixel and every photon -- the size changes the resolution, never the light | built | README § *The ray budget is capped; a sample in batches* |
| **Bounding-box culling**: each top-level object's box measured on the GPU, far objects skipped | **measured**: Noise library 250 vs 989 GPU ms/sample with boxes off (3.95×), other scenes 3–13 % (Ampere, 2026-09-30) | `builder/boxes.js`; `PERFORMANCE.md` |
| **Per-kernel GPU timing** (timestamp queries) | measured in the benchmark | `lib/render-cost.js`, `core/kerneltime.js` |

### 1.2 How light is found

| feature | status | evidence |
|---|---|---|
| BSDF sampling | verified (every bench) | |
| **Next-event estimation with MIS** toward the sun and sky | verified: unbiased and 3.8× quieter with sun and sky; `nee-split` never run | TESTING.md `nee` |
| **Light tracing for caustics**: photons from the sun through glass and mirrors, connected to the camera; where photons go is **learned** (a 128×128 map) | **verified**: the split is exact, means within 0.03 % on every row (Ampere); in the caustic region the learned map reaches equal noise ~40× sooner than without light tracing (the run after the material review) | PLAN.md *Light tracing*, *Open* item 1 |
| **Emissive surfaces as lights, nothing declared**: discovered from the paths that hit them, sampled by NEE with MIS, and sending photons along random lines (Crofton) | **verified** (Pascal, third run): every row within 0.31 % | PLAN.md *Emissive surfaces* |
| Russian roulette | verified unbiased (`rr-bias`) | TESTING.md |
| Caustics seen *through* glass or in a mirror | **the photon map** (0.60.0; **on by default since 0.61.0**, Light sources › *Seen through glass and mirrors*): photons stored where they land past glass or a mirror, gathered by the camera's rays that reach that surface through glass or a mirror, a radius shrinking every sample; in the full renderer, Draft and Optics; a collimated beam's photons stored wherever they land (0.61.0); idle where nothing is seen through glass or a mirror (0.61.0). **Seen** on the user's card (2026-10-15: "this looks really good"), its cost not measured; `sppm.test.mjs` (0.997 and 1.003 of the camera's own sum, a collimated beam 1.000 of its closed form), `sppm.gpu.mjs` (the whole renderer on lavapipe, within its error bar; the idle skip); bench `sppm` not pressed. Before it, the lens's photons (0.43.0) and the manifold connection (0.44.0), both removed in 0.61.0 | `core/sppm.js`; PLAN.md C *The photon map* |
| **The camera's lens**: aperture and focus (Camera popover), depth of field; a perspective camera's | built (0.43.0), not yet seen; `lens.test.mjs`, `lens.gpu.mjs` | `core/lens.js` |
| **Draft** (fast mode): a path stops at the first diffuse or glossy surface it meets, which gets the direct light from the sun, the sky and the lamps (one shadow ray, weight 1); mirrors, clear and frosted glass and near-mirror gloss are followed; light tracing as set; seek rays find lamps the camera cannot see | built 2026-10-01; naga-compiled; `render-modes`, `draft-lamps` not pressed; **not seen on hardware** | README § *Draft, Sketch and Optics*; `core/materials_pbr.js` FAST MODES |
| **Sketch** (fast mode): the same stop, a fixed headlight / top / fill light and no shadow rays, no photons | built 2026-10-01; **not seen on hardware** | same |
| **Optics** (view mode): Sketch's flat light (dimmable in stops, or off) and the builder's lights' rays traced through lenses, mirrors and glossy reflectors to the first diffuse surface, where they show and stop; no bounce light | built 2026-10-02; **`optics-mode` holds** (Ampere: the floor's direct light 0.994-0.999 of the closed form, full above it); the picture **not yet seen** | README § *Draft, Sketch and Optics*; PLAN.md *The Optics view* |
| Draft and Optics: a light's photons keep the whole of its direct light on a diffuse surface (no MIS share with a camera path that stops there) | built 2026-10-02; **verified** (Ampere): `light-vs-emitter`'s Draft and Optics pairs 0.995, as full's; how dark Draft was before, inferred only | same |
| **Lamps only**: the view lit by the scene's own emitters, sun, sky and studio light off, the scene's environment untouched | built 2026-10-01; Node-tested (`quality.test.mjs`); `render-modes` row not pressed | `lib/pathtracer/quality.js` `effective` |
| Path guiding | removed (never shown to help) | PLAN.md |

### 1.3 Materials

| feature | status | evidence |
|---|---|---|
| One layered model: **GGX** with visible-normal sampling, **exact dielectric Fresnel** from the IOR, **Kulla–Conty** energy coupling, **multiple-scattering metal**, tables integrated on the GPU at start | **verified**: `furnace` every material to 0.04 %; `bsdf-parity` agrees | README § *Materials*; TESTING.md |
| **Anisotropy along a grain** (brushed, turned, radial), with its own tables | verified (`furnace` anisotropic rows) | SURFACES.md phases 1, 1b |
| Visible brush streaks | built | SURFACES.md phase 1c |
| **Rough (frosted) glass** | open: read 0.959 in the furnace, explained as single-scatter loss; reads **0.944 since, unexplained** | SURFACES.md *Open* |
| Glass, mirror, metal, plastic, Lambertian, emitter presets | in use | `builder/materials.js` |
| **Material code**: any material field can be WGSL (checker, stripes, grain examples ship) | in use | `builder/codegen.js` |
| **Surface noise library**: value, gradient, fBm, Worley, each with its analytic gradient and a proved or measured Lipschitz bound | built; Node-tested | `core/noise.js`, `core/test/noise.test.mjs` |
| Rust, dust, wear, bump, sheen, clear coat, thin film, hair | planned (SURFACES.md phases 3–9) | |

### 1.4 Light in physical units

| feature | status | evidence |
|---|---|---|
| **Buffers hold luminance in cd/m²; illuminance in lux** | **verified**: a white floor reads ρE/π to 0.1 % under every light and strategy (`photometry`, Pascal, third run: 0.9984–1.0001) | README § *Units*; TESTING.md |
| **Sun** by its direct normal illuminance (lx) and real angular size; **sky** by the horizontal illuminance it gives, its shape from a Rayleigh + Mie model normalised on the GPU; turbidity | verified (same bench) | `core/photometry.js`, `core/sdf.js` |
| **Studio light**: a set illuminance, a top-light share, a tint | built | `photometry.js` `studioLuminance` |
| **Scene unit** m / cm / mm; tolerances follow the scene's size automatically | built; `scale` bench not pressed | README § *The scene unit* |
| **The scene's radius** (where it stops and the sky begins) is the scene's own property, in its unit, in the Scene settings (a click on the scene's row) beside the unit -- live, no compile; it was the Environment's, in metres. A **new scene** is in cm with a 25 cm radius, seen from close by (2026-10-02) | built 2026-10-02 (0.9.0); node-tested (`model`, `photometry`, `project.test`) and headless-checked (`panel.check`); **not seen on hardware** | `model.js` envRadius, `photometry.js` envRadiusMetres, `project.js` NEW_SCENE |
| **Exposure**: EV100, GPU auto-exposure (trimmed log-mean, highlight headroom, eased), compensation, meter-and-lock | in use ("looked at on hardware") | `core/autoexposure.js` |
| **Seven tone curves**: clip, Khronos PBR Neutral (default), AgX, AgX punchy, ACES fitted, Reinhard, Hable | in use | `rendertoscreen.js` |
| **Exact colour addition**: colours outside the Rec.709 gamut keep a negative channel; the display clips once per pixel | **verified**: three LEDs mixed to 4000 K read 3999.9 K, Δu′v′ 6e-5 (Pascal) | TESTING.md `optics-light` |
| **Every pixel carries an error bar** (standard error of its luminance), shown under the cursor | built; `error-bar` bench not pressed; Node-tested | `core/measure.js` |
| Sun position from date and place; CIE standard skies; HDRI environments | not there | |

### 1.5 Seeing and measuring light in the picture

| feature | status | evidence |
|---|---|---|
| **Three views**: photographic; **lux on surfaces** (every visible surface's illuminance, whatever its material); **luminance in cd/m²**; both measuring views in log false colour with bands and a legend | built; `illuminance`, `cosine-law`, `disc-light` benches not pressed | `lib/pathtracer/viewtools.js`; README § *The illuminance view* |
| **Measure tool**: pins that stay on the clicked surface and re-read as the picture converges; a rectangle's mean ± error, min, max, **U0**; each reading's colour as **CCT + Duv** or CIE xy, an area's **Δu′v′** spread; **CSV** | built; Node-tested | `lib/pathtracer/measure/tool.js` |
| Point sensors and work-plane grids that are not visible surfaces | planned | PLAN.md *Next* item 2 |
| Glare (UGR), CRI, TM-30 | not there | |

### 1.6 Output

| feature | status | evidence |
|---|---|---|
| **Quality presets**: Sketch, Draft, Standard, High quality, Optics -- buttons at the top of the Render settings panel, Preview (Sketch, Draft) and Accurate (Standard, High), with a line saying what the one in force traces or what Custom changed (0.16.0; a dropdown before); the Render settings menu. On the view's toolbar (0.59.0), the preset in force named in a word, a menu of the presets, and **⚡ fast while moving** (a full picture traced as Draft or Sketch while the camera, a drag or a live value moves). The measuring views always trace in full | built 2026-10-01, the buttons 2026-10-04, the toolbar's menu and ⚡ 2026-10-11 (headless, `example.check.mjs`; not seen in the page); the panel checked headless (`renderer.check.mjs`); `render-modes-cost` not pressed | `lib/pathtracer/quality.js`, `settingsui.js`, `viewtools.js` |
| **The Render settings panel in boxes** (the Renderer panel until 0.57.0) (0.16.0): Quality, Light sources, Paths and noise, Render size, and a developer's Ray marching and Diagnostics, outlined as the Analysis pane's sections; switches as checkboxes; each row's help as its tooltip | built 2026-10-04; checked headless (`renderer.check.mjs`); not seen in the page | `settingsui.js` `RENDERER_BOXES`, `lib/shell/shell.css` `.shell-boxes` |
| **Light sources, each switched**: the environment (lamps only), the caustics of the sun and glowing surfaces (`lt`), and the **lights' rays** (`lightRays`, 0.16.0: the light objects' photons, which nothing turned off before), with their photons per pixel | built 2026-10-04; the switch run through `R.trace` without a GPU (`build.test.mjs`); not seen on hardware | `raytrace_main.js` (photon sources), `core/uniforms.schema.js` |
| **Developer switch**: the settings a user has no reason to move (march, light-sampling shares, the bench's A/B switches, diagnostics) hidden behind one switch at their defaults; one line at the foot of the Quality box (0.16.0) with a count of any that are not, named in its tooltip, and a reset | built 2026-10-01, the line 2026-10-04; checked headless | `settingsui.js`; `gui.dev` in `core/uniforms.schema.js` |
| **Save a PNG** at any size up to 16384 px, 1–16384 samples, abortable; 8-bit | built | `index.js` `installOutputUI` |
| **Develop before saving** (0.27.0): the render kept as light; EV (and a meter), tone curve, contrast, saturation, brightness -- or the false-colour scale -- on a preview, then PNGs at full size, as many as wanted from one render | built 2026-10-05; the arithmetic and the darkroom on a stand-in device (`develop.test.mjs`), the shader through naga; run headless on the user's GTX 1080 Ti by the agent that built it: Tint compiles it, an untouched develop of a 480 × 270 render equals the display's own output pixel for pixel (manual, false colour; auto exposure 4 of 518 400 values 1/255 off), the panel's Render, Meter and Save PNG ran; not yet judged by eye | `lib/pathtracer/develop.js`, `rendertoscreen.js` `develop_prog` |
| HDR output (EXR, 16-bit) | not there | |
| Video | see §6 | |

---

## 2. The scene builder — `builder/`

Core editing is **in use** (PLAN.md *The scene builder* records the core as "confirmed working by the
user on real hardware"). What PLAN.md or BUILDER.md marks unconfirmed is marked **built**.

| feature | status | evidence |
|---|---|---|
| **Scenes as documents**: groups and objects under a root, a material list, an environment, a WGSL functions block; format version 15, every older version upgraded on load; every problem listed on a failed load, nothing half-loaded | in use | `model.js` |
| **Projects of several scenes**; the tree shows the one being worked on, **its row the root** (a click shows its settings, its + in the + column; 0.26.0, as it was before 0.7.0); **a click on any row selects it, only its chevron folds it** (0.26.0), and a **project menu** over it -- the project's name ▾, Undo and Redo on the same row -- lists the scenes: switch, + New scene, rename, duplicate, up / down, delete (undoable), **Examples ▸** (a copy into the project), import scenes from a file, export this scene or all; and the project: Projects…, New project, import a project from a file, export it; a row's right-click **Copy to / Move to** another scene, compiling nothing there (2026-10-02; until then every scene was a row of the tree, and touching one switched and compiled) | built 2026-10-02, the menu and the root row 2026-10-05; node-tested (`tree.test`) and headless-checked (`workspace/test/projects.check`); **not seen on hardware** | `project.js`, `tree.js`, `switcher.js`, `toolbar.js` |
| **Ten shapes**, each an editable code node from the start: sphere, box, cylinder, capsule, torus, cone, **lens** (diameter, thickness, two signed radii), rectangle, disc, plane; or blank WGSL | built ("one kind of object", not confirmed) | `primitives.js` |
| **Shapes from points**: a **profile** parameter -- an outline, one point a line, `x, y` and a fillet radius to round a corner -- that a node's code turns into a shape with `extrude(outline, p, height)` or `revolve(outline, p)`; edges and fillet arcs, the distance exact both sides; presets extrusion, revolution, **Fresnel lens** | built; node-tested and panel-checked, not confirmed | `core/shapes.js` (profilePieces), `codegen.js`, `panel.js`, `core/test/shapes.test.mjs` |
| **Sweeps along a path**: a **path** parameter -- an open line, one point a line, `x, y, z` and a fillet radius to round a corner (none: a sharp one), and since 2026-10-02 the section's scale and twist there (the row below) -- along which a node's code sweeps a tube, `tube(route, p, radius, rounded)` with rounded or flat ends, or a profile, `sweep(route, outline, p)`; segments and fillet arcs, the cross-section carried without twisting; outside exact at any bend however tight, inside never too deep (no faces inside at the joints); presets **bent tube**, **light guide** | built; node-tested and panel-checked, not confirmed | `core/shapes.js` (pathPieces, pathWGSL), `codegen.js`, `panel.js`, `core/test/shapes.test.mjs` |
| **Live paths**: a path's points may be expressions of the object's parameters (`rise`, `-w/2`, `corner.x`); a **live** path's pieces are uniforms, so a slider on such a parameter -- or a typed edit -- moves it with no compile, unless it is given more points than it has room for (since 2026-10-02 the chain is slots, each on or off: a corner made straight, a point taken away, is written); a value that makes it unsound draws nothing and the editor says why; untick live to compile its numbers in. The bent tube preset is live, with a `rise` | built; node-tested (the live text equals the compiled one, an update equals a fresh compile) and panel-checked; **confirmed working on hardware by the user, 2026-10-02** | `builder/expr.js`, `codegen.js` (livePointsUpdate), `demo.js` (liveValue), `panel.js` |
| **Live profiles**: the same for a profile -- its outline's points may name the object's parameters, and a **live** profile (listed on its object) changes extrude, revolve and a sweep's cross-section with no compile, unless it is given more points than it has room for (a fillet appearing or going is written, into its slot, since 2026-10-02); a corner turning concave or a point leaving the axis is written live | built; node-tested (the live outline equals the compiled one, an update equals a fresh compile) and panel-checked, not confirmed | `builder/expr.js`, `model.js` (liveProfiles), `codegen.js` (profileUniformDecls, livePointsUpdate), `panel.js` |
| **Points drawn in the picture**: the overlay's **Points** mode, beside Transform (Move and Scale until 2026-10-02), for an object with a path or a profile -- its points as dots numbered as the text box numbers them, the curve as the shader is given it (red, with the reason, when it is not sound), an arrow per coordinate along the object's own axes (none along one written as an expression), a diamond that sets a corner's fillet and stops at the largest that fits, dotted legs and a readout to the point before; a coordinate written as a parameter's name moves that parameter, within its slider's range; Delete, Insert or +, Enter to type a point's entries as written; Ctrl snaps to the grid shown; a profile's **plane** button looks square at its plane (orthographic, with a grid) and back. A path or profile is compiled live while it is edited, with room for 8 points more, so a drag, a point put in or taken out, compiles nothing; and back when the mode is left | built 2026-10-02; node-tested (`pointedit.test`) and headless-checked over the real builder and camera (`points.check`); **confirmed working on hardware by the user, 2026-10-02** ("pretty sweet"; the slots: "works, adding points is fast now") | `builder/pointedit.js`, `pointsmode.js`, `overlay.js`; `codegen.js` (forceLive), `demo.js` (editPoints) |
| **Every + shape fits a 1-unit cube** (2026-10-02: the sphere was 2 across, the cube 1): sphere, capsule, torus, cone, round cone, octahedron, capped torus, link, dome, Fresnel lens, reflector, extrusion and revolution made smaller, their proportions kept; old files keep their sizes | built 2026-10-02 (0.9.0); node-tested (`model`, `codegen.test`), **not seen** | `primitives.js` (SIZES) |
| **Double-click a node in the tree**: the camera glides to it -- its box framed, the viewing direction kept (2026-10-02) | built 2026-10-02 (0.9.0); node-tested (`focus.test`, through the real camera) and headless-checked (`tree.check`); **not seen on hardware** | `builder/focus.js`, `tree.js`, `index.html` focusOn |
| **Each scene its own view and tolerance** (0.63.0): the camera (every setting, its lens too) and the exposure (every setting) saved in the scene's file, written as they change, put back whole on a switch -- nothing left from the scene before; also in the scene row's Properties as two folders, where a value is flagged for the Timeline. The surface tolerance is the scene's (its Properties, in its unit), the optics trace's too. Old projects read into it | built 2026-10-17; node-tested (`model`, `project`, `store`, `scenes`, `animate`), headless-checked (`panel.check`, `projects.check`, `edit.check`); **not seen on hardware** | `builder/model.js` VIEW, `demo.js` keepView, `project.js` adoptViews, `panel.js` cameraFolder |
| **A scale and twist per path point** (2026-10-02): after a point's fillet, its cross-section's **scale x, scale y and twist** in degrees (left off: 1, scale x's, 0), changing evenly along a straight and held round a bend; a tube reads scale x alone, its diameter. The rounded tube stays exact outside (round cones); a sweep or flat tube whose section changes along a straight is a bound (shorter march steps there). A path whose values are all the default is the shader text it was; a live or edited one writes its values as uniforms. In the **Points** mode, the selected point's section is drawn with its own gizmo -- a sweep's cubes for scale x and y, its circle for both, an arc for the twist; a tube's circle -- Ctrl on 0.1 and 15°, typed entry and the panel take them. Preset **twisted bar** | built 2026-10-02; node-tested (`shapes.test`: slope never over 1, never too large or too deep against the slices, the rounded tube exact; `codegen.test`, `pointedit.test`, `project.test`) and headless-checked (`points.check`, `panel.check`); **not seen on hardware**; its cost per frame not measured | `core/shapes.js` (pdCone, swSegLocalV, swSegFoldV, pathWGSL vary), `codegen.js`, `pointedit.js`, `pointsmode.js`, `gizmodraw.js` |
| **Shapes in groups**: the + menu's Shapes is Primitives, Optics and From points, and the library tags each built-in shape with its group; the **pyramid** a rectangular base and top (base x, y; top x, y; height: an apex or a frustum), the **prism** a regular polygon whose number of sides is a live slider | built; node-tested, not confirmed | `primitives.js` (SHAPE_GROUPS), `tree.js`, `library/store.js`, `core/shapes.js` (Nfrustum, Nprism) |
| **Eight more shapes**, each normal its distance's gradient: round cone, pyramid, octahedron, capped torus, link, tube, **dome** (base on z = 0), **parabolic reflector** (focus at the node's origin); every distance exact or a stated bound, never too large inside | built; node-tested, not confirmed | `core/shapes.js`, `primitives.js`, `core/test/shapes.test.mjs` |
| **Aspheric lens** (2026-10-04): two even-asphere faces -- radius, conic constant, a4 to a10 each -- a rim; it starts as a condenser exact on axis (a hyperboloid of k = -n^2 over a flat face). Its distance a bound both sides, from the steepest the faces can be inside the aperture; its normal exact. Its a's typed from a datasheet, shown in their own digits | built 2026-10-04 (0.13.0); node-tested (`shapes.test`: never too large, any parameters, and 40 rays from the condenser's focus leaving parallel to 1e-9), naga-compiled, panel-checked; **not seen on hardware**; its cost per frame not measured | `core/shapes.js` (Nasphere), `primitives.js`, `panel.js` |
| **Booleans per child**: each child of a group joins what is above it by union, subtract or intersect, with the group's smooth blend or its own (format version 14; version 10 files compile to exactly the shader they did) | in use (confirmed 2026-09-30) | `codegen.js`, `builder/test/fixtures/csg-v10` |
| **Joins in the tree, and a group's recipe**: a clickable ∪ / − / ∩ per child, the group's row as `a ∪ b ∪ c − d`; a recipe (`union a, b, c` / `subtract d`) typed, checked at its lines, applied as one undo step | built; headless-tested, not confirmed | `tree.js`, `recipe.js`, `builder/test/tree.check.mjs`, `recipe.test.mjs` |
| **Eight modifiers** (groups whose code wraps their children): twist, bend, repeat, mirror, round, shell, displace, **noise relief** | built ("group code", not confirmed) | `modifiers.js` |
| **Write any node in WGSL**, with typed parameters (number, vector, colour; live or compile-time; ranges; length in the scene unit); errors come back **at the user's own line and column** 500 ms after typing stops | in use | `emit.js`, `validate.js`, `panel.js` |
| **Live vs structural edits**: parameters, transforms, blends and material values are uniforms (no recompile); structure recompiles | in use | PLAN.md |
| **In-picture editing**: GPU picking; move arrows, plane squares, a screen-plane ring, rotation arcs; uniform scale; local axes; Ctrl snaps; Esc cancels (a drag at full quality: the half resolution while dragging, and its switch, removed 2026-10-02) | in use (click-selection depth rules built) | `overlay.js`, `gizmo.js`, `selection.js` |
| **The Points mode with the Transform gizmo** (2026-10-02): at the selected point, the gizmo's arrows, plane squares (a square moves two coordinates, the third exactly kept) and centre ring, drawn by the one module the Transform mode uses (`gizmodraw.js`), its arcs, cubes and circle hidden; **every point's legs** (the dotted steps from the point before) behind a switch on the view's toolbar, the selected point's twice as thick | built 2026-10-02; node-tested (`pointedit.test`) and headless-checked (`points.check`); **confirmed working on hardware by the user, 2026-10-02** ("works") | `builder/gizmodraw.js`, `pointsmode.js`, `pointedit.js` |
| **The numbers in a panel** at the view's top right (2026-10-02): the selection's position, rotation, scale, its lengths as written and its measured bounds (≈, along its own axes, times every scale above it), in the scene's unit; while a handle is held what it did and the numbers it changed in bold; over a stretch cube what it would change. The Points mode's point numbers and its typed entry are in the same panel. It lets the mouse through, and sits below the library's strip | built 2026-10-02; node-tested (`readout.test`) and headless-checked (`transform.check`, `points.check`); **confirmed working on hardware by the user, 2026-10-02** | `builder/readout.js`, `overlay.js`, `pointsmode.js` |
| **More stretches, Ctrl to the grid** (2026-10-02): a stretch cube on rectangle lights (width, height), disc lights (radius), the export box (size), the torus and capped torus (ring, in x and y) and the link (span, in y) -- left out where it would be forced (a round tube's thickness, the reflector, the shapes from points); the panel shows what a cube changes. Ctrl snaps a move and a size to the grid at the node (the Points mode's), and the panel says the step | built 2026-10-02; node-tested (`stretch.test`, `readout.test`) and headless-checked (`transform.check`); **confirmed working on hardware by the user, 2026-10-02** ("works") | `builder/stretch.js`, `lights.js`, `exportbox.js`, `primitives.js`, `overlay.js` |
| **One Transform gizmo** (2026-10-02): Move and Scale as one mode, every handle at once -- the arrows, squares, centre and arcs, a **stretch cube** on each of the shape's own axes, and a dashed circle outside them for uniform scale; the handles larger (arrows 110 px, grab 11). A cube stretches the shape by its **own sizes** -- a box's `size.x`, a cylinder's radius or height, a pyramid's base and top -- as its preset names them (`stretch`), live, in the slider's range, Ctrl to the grid; a sphere, a torus, a group or code of one's own get the circle only | built 2026-10-02; node-tested (`stretch.test`) and headless-checked over the real builder and camera (`transform.check`); **confirmed working on hardware by the user, 2026-10-02** | `builder/overlay.js`, `stretch.js`, `gizmo.js`, `primitives.js` |
| **Lock position, lock parameters** (2026-10-02): per node (an object, a group, a light, an export box), saved with the scene. Position locks the position and rotation, parameters lock the parameters' values (sizes, a path's or profile's points) and the scale. In the picture a lock's handles are not drawn, the Points mode is offered but disabled, and a padlock follows the name; in the properties panel two checkboxes above the position, and the rows they hold disabled; in the tree a lock beside the eye (a click locks or opens both). Against the hand only: the timeline, a script and an undo still change a locked node | built 2026-10-02; node-tested (`model.test`, `tree.test`, `readout.test`) and headless-checked (`transform.check`, `points.check`, `panel.check`, `tree.check`); **not seen on hardware** | `builder/model.js`, `overlay.js`, `panel.js`, `tree.js`, `readout.js` |
| **Undo / redo** across the whole project: 100 steps, edits coalesced | built | `history.js` |
| **Clipboard**: copy, paste, duplicate nodes and materials, across scenes -- and through the system clipboard, so across tabs, projects and reloads (2026-10-02) | built; the system clipboard headless-checked | `tree.js` |
| **Instant hide/show** without a recompile | built | `model.js` `liveVisibility` |
| **Files**: scene, project, or workspace (all scenes + renderer settings + camera + size); open by menu, Ctrl O or dropping a file on the page -- a scene or project file joins the project, a workspace file becomes a project of its own (since 2026-10-02) | in use | `demo.js`, `project.js` |
| **Projects kept in the browser** (2026-10-02): the project being worked on saved in IndexedDB as it changes -- its scenes, the scene worked on, the renderer's settings, every scene's camera, a library item being edited -- so a reload comes back to it (not the undo history); **File › Projects…** lists them: open, new, rename, duplicate, download, import, delete (asks); a **second tab** on a project works on its own copy, kept once it is edited (Web Locks); one that cannot be read is kept as it was; Ctrl+S saves at once | built 2026-10-02; node-tested (`workspace/test/store.test`) and headless-checked over real IndexedDB and locks (`projects.check`); **not seen on hardware** | `workspace/` |
| Mesh import (OBJ, STL, glTF) or CAD import (STEP, IGES) | **not there**; investigated, routes and phases in `roadmap/IMPORT.md` (2026-10-02) | |
| Ellipsoid, polar repeat, smoother blend profiles | planned | `roadmap/BUILDER.md` |

---

## 3. Optics — `lib/pathtracer/optics/`, `optics/`

A **non-sequential Monte Carlo trace** over the same scene, march and materials the picture uses,
so the numbers and the picture cannot disagree. Rays are weighted, never killed; tallies are exact
integer fixed-point, and **emitted = escaped + lost + absorbed** balances to zero. A run is split
into batches, so **every number carries a standard error**. Target: LED and luminaire optics.

### 3.1 Sources

| feature | status | evidence |
|---|---|---|
| **Light objects** in the builder, as many as wanted, placed with the handles: **rectangle**, **disc**, **Zemax ray file** | built (the merge that made them objects was not seen on a GPU when made; the `light-vs-emitter` presses have rendered disc lights since) | `builder/lights.js`; PLAN.md *Every light is defined in the builder* |
| **Distribution**: Lambertian / cosⁿ, uniform cone, collimated; any of them limited to a cone | built; sampling Node-tested against closed forms | `optics/kernels.js`, `optics/test/optics.test.mjs` |
| **Amount**: flux in **lm** or luminance in **cd/m²**, the other derived | built | `builder/sources.js` |
| **Colour** as RGB, **CCT + Duv**, or **CIE xy**, carried exactly | **verified** (`optics-colour`, Pascal: single lights exact to 1e-8) | `core/colorimetry.js` |
| **Transparent or opaque, one- or two-sided, the index it emits into** (an LED die inside silicone) | built | `builder/lights.js` |
| **Optics sources light the rendered picture** at their real brightness (the lens's spot on a screen, readable in lux) | **verified** (`optics-light`, Pascal: lux within error, hue error 1e-7) | PLAN.md |
| Point source | script (the benches use it) | `optics/sources.js` |
| Glowing geometry as an optics source; "set lumens" on it | planned | PLAN.md phase 4 |
| IES / EULUMDAT as a source | planned | PLAN.md phase 6 |
| Watts, radiometric units | not there: watts are taken as lumens | `optics/README.md` |

### 3.2 Zemax / OSRAM ray files

| feature | status | evidence |
|---|---|---|
| **Read Zemax OpticStudio binary source files** (.DAT): flux-only and spectral records, m / in / cm / ft / mm, the file's own placement; refused with the numbers if malformed | built; Node round-trip test; the real OSRAM sample's checks skip here (file absent) | `optics/zemax.js` |
| Kept in the browser (IndexedDB) by name, so a reload keeps it | built | `optics/rayfiles.js` |
| Limits: the rotation convention is unverified; the wavelength is read and discarded; rays are resampled with replacement | stated in the code | |
| Writing ray files | script (test only) | `zemax.js` `writeZemax` |
| LightTools, TracePro, Radiant, TM-25 ray files | not there | |

### 3.3 The trace and what it counts

| feature | status | evidence |
|---|---|---|
| **Detector** and **ray limiter** material types (a limiter is invisible in the picture: a cross-section of a beam) | built | `builder/model.js` `MATERIAL_TYPES` |
| **Totals**: emitted, escaped, absorbed, on detectors, lost; per object and per material: arriving, absorbed, hits — each ± standard error | built | `optics/page.js` |
| **Refraction, Fresnel, total internal reflection** | **verified** (`optics-refraction`, Pascal, 400 k rays a row): slab at 0/45/70° within 2 SE, TIR exact, glass ball 0.9997, wedge exit angle to 2e-6°, balance 0 | TESTING.md |
| Energy balance, absorbing and reflecting floors, integrating sphere | built; `optics-balance` not pressed | TESTING.md |
| **Rays drawn over the picture**, live while objects move: up to 20 000 rays, coloured by remaining flux, step, plain or the light's colour; an **optical-path-length slider** that sweeps the light through the system | built | `optics/paths.js` |
| **Live analysis**: the analysis again and again, every chart, card and total following each edit; with **Σ** the rounds adding up while nothing changes (starting over when the picture does), without it each round on its own, to compare; one readback a round; the ray count a number times × 1 … × 10M | built 2026-10-04 (0.11.0, 0.12.0, Σ 0.14.0); **confirmed working by the user** (tracing and analysis, 2026-10-04); headless-checked over a stand-in (`page.check.mjs`), the readback and what is drawn Node-tested on recording devices (`readback.test.mjs`, `drawn.test.mjs`); a round was 1.4 s with the picture running and 0.2 s without it before 0.12.0 (measured by the user); since, **not measured** | `optics/page.js`, `optics/index.js` (publish) |
| Ray filters (by source position, direction, fate) | planned | PLAN.md |

### 3.4 Far field — luminous intensity

| feature | status | evidence |
|---|---|---|
| **Type C (C, γ) grid**, fed by escaping rays or by one detector; γ from 0.25°, C from 1° | built; `optics-farfield` not pressed; binning mirrored and Node-tested | `optics/farfield.js` |
| **Intensity in cd or cd/klm**, with an error per bin; rotational-symmetry pooling | built; Node-tested (Lambertian I₀ = Φ/π to 1e-4) | |
| **Beam angle (50 %) and field angle (10 %)** per C plane, **I max**, **optical efficiency**, **zonal flux** (0–30, 0–60, 0–90, 90–180°) | built; Node-tested | |
| **Polar diagram** (up to 9 C planes, linear or log, ±1 SE band) and **I–γ chart** (auto-zoom to narrow beams) | built; drawn into a recording canvas by `charts.test.mjs` | `optics/polar.js`, `optics/cartesian.js` |
| Intensity table as **CSV** | built | |
| **IES LM-63 / EULUMDAT export** | **planned** — the grid it would need exists | PLAN.md phase 5 |
| Isocandela map, a pinned reference run, a datasheet overlay, colour against angle | planned | ANALYTICS.md |

### 3.5 Illuminance — detector maps

| feature | status | evidence |
|---|---|---|
| **Illuminance map in lux** on a detector (plane fitted to the hits), 8–256 cells, zoom by Shift-dragging; the button held moves the profiles' point | built; Node-tested (a uniform square reads exactly 2500 lx); the pointer driven headless by `page.check.mjs` | `optics/detmap.js` |
| **Any number of charts of a kind**, each with its own settings on its own strip (an illuminance map beside a CCT map; profiles and rings with their own quantity), kept between visits | built; `chartset.test.mjs`, `page.check.mjs`; not yet seen by the user | `optics/charts.js`, `lib/pathtracer/strip.js` |
| **Smoothing**: none, Gaussian, Epanechnikov (flux-conserving), k-nearest photon-map estimate | built; Node-tested | |
| **E max / mean / min, U0 = min/mean, Ud = min/max**, lit area, noise per cell, a warning when the detector is not flat | built | |
| **Isolux lines**, **profiles** along both axes, **radial profile**, **encircled flux with r50 / r90** | built; Node-tested (r50 = R/√2 on a disc) | `optics/illum.js` |
| **Virtual plane** from the far field (E = I cos³γ / h²), no new trace | built; exact for a point source only; square to the axis only | `illum.js` `virtualPlane` |
| Map, hits and chart **CSV**; any chart as **PNG** | built | `optics/page.js` |
| Limits: a ray stops at the first detector; the page keeps 500 000 hits per analysis | stated in the code | |

### 3.6 Colour

| feature | status | evidence |
|---|---|---|
| Rays carry three exact channels; detectors read **XYZ** back exactly through neutral optics | **verified** (`optics-colour`) | `core/colorimetry.js` |
| **CIE xy, u′v′, CCT and Duv** (ANSI C78.377 sign), the Planckian locus 1000–15000 K | Node-tested (illuminant A 2856 K, D65 6504 K) | |
| Detector colour, **colour uniformity Δu′v′** (max, rms), maps of CCT, x, y, Duv, Δu′v′ from a target | built | `optics/quantities.js` |
| **Colour mixing tool**: three of the scene's lights, a target CCT + Duv or xy and a total flux → the fluxes, written as one undo step | built | `optics/page.js` |
| **Coatings: dichroics, beam splitters, AR layers** -- R(λ) with an edge that moves with the angle, averaged per colour channel; on the entry faces, the back AR, bare or coated | built (0.39.0), not yet seen; `optics-coating` and furnace rows | `core/spectral.js`, `core/materials_pbr.js` |
| **Dispersion** -- an Abbe number with the index (Cauchy through n_d and V_d); a refracted ray takes a wavelength and its colour, a prism splits white light | built (0.40.0), not yet seen; `optics-dispersion` and furnace rows | `core/spectral.js`, `core/materials_pbr.js` |
| A wavelength per ray for the optics analysis (a source's spectrum, CMFs at the detector); filters by spectrum | planned | PLAN.md *C* |

### 3.7 Physics not yet in the optics trace

All planned, in PLAN.md *The plan from here* (**bulk absorption (Beer–Lambert)** was listed here and has been in
since 0.37.0: a material's colour depth); a
**reflectance for an LED's own face** (light sent back onto a die is lost); **a light seen through
its own lens** (shows dark); **air gaps thinner than the surface offset** are jumped (measured:
reads one slab; workaround: set the tolerance by hand); a **stratified source pick** (a mix's
colour noise is only the random pick); **polarisation** (−0.3 % at 45°, −3 % at 70° on a slab,
measured). (Aspheric and Fresnel lenses are shapes now: *Builder*.)

---

## 4. Export for 3D printing — `builder/exportbox.js`, `mesh.js`, `print.js`

| feature | status | evidence |
|---|---|---|
| An **export box** placed with the handles marks what to print | built — "NOT yet seen on hardware or in a slicer" | PLAN.md *Export for 3D printing* |
| The SDF sampled on the GPU, meshed by **marching tetrahedra** into a closed surface, coloured per triangle from the materials, reduced to at most 16 colours | built; Node-tested closed and outward; lib3mf opened a written file as manifold | |
| **3MF with colour** (aimed at Bambu Studio's filament mapping) or **binary STL**, in mm | built | |
| Limits: features under one cell vanish; edges bevelled; ~3 M triangles for a 10 cm cube at 0.4 mm, no decimation; meshing on the main thread | stated in PLAN.md | |

---

## 5. The library — `library/`

| feature | status | evidence |
|---|---|---|
| **49 built-in items**: the 10 shapes, 8 modifiers, 3 lights and 6 material presets; **18 named materials** (plastics, gold, copper, brushed and turned aluminium, chrome, clear / tinted / frosted glass, polycarbonate…); **4 optics assemblies** (PMMA lens Ø 18 mm, LED die 2 × 1 mm 100 lm, detector screen, a whole LED-lens-screen bench) | built | `store.js`, `items/*.json` |
| **Your own items**: keep the selection, rename, remove; export and import as `library.json`; kept in IndexedDB | built; headless-tested | `panel.js` |
| **Search**, kind filters, grid or list | built; headless-tested | |
| **Drag onto the tree or the picture**: a material onto the object under the pointer; a node stands on the surface it was dropped on; units converted | built; headless-tested | `builder/test/drop.check.mjs` |
| **Rendered thumbnails**: a second, hidden path tracer renders each item in a studio while the main view is idle; cached by content; a tile renders live under the pointer | built | `thumbs.js`, `studio.js` |

---

## 6. Timeline and video — `tools/`, `lib/timeline/`

| feature | status | evidence |
|---|---|---|
| **Keyframes on any live parameter**: camera, a light's flux, an object's position, the sun… with linear / smooth / spline / step interpolation and easing | built; headless-tested over a stand-in renderer | `tools/timeline.js` |
| **Record**: every frame rendered offscreen at the export size with its own samples | built | |
| **MP4** (H.264, else VP9 or AV1, in MP4; Chromium only) or a **ZIP of PNG frames** (any browser); stream to disk where the browser allows | built | `lib/timeline/encoders.js` |
| WebM | **not there** (README.md said so; corrected) | |

---

## 7. The application shell — `lib/shell/`

| feature | status | evidence |
|---|---|---|
| **Menu bar, docked panels, status bar**; 17 panels, each can be dragged, stacked, floated, maximised, **popped out to another window** (second monitor) | built | `lib/shell/shell.js`, `index.html` |
| **Layout presets** Design, Analyse, Animate (Render dropped in 0.53.0: Design with the Analysis pane hidden); your own named layouts; the last layout restored | built | |
| **Command palette** (Ctrl K) that also finds settings and sets them (`name = value`) | built | `lib/shell/paramspanel.js` |
| **Parameters panel**: every renderer and scene setting by a path, typed exactly, ⌖ jumps to its control | built; Node-tested | `lib/shell/params.js` |
| Help panel (F1), its links that open examples, run commands and point at panels; reference pages made from the program's lists; an SDF explainer | built (0.55.0), not yet seen — the tracks' pages are being written; no guided tour yet | help/README.md |
| A study panel: parameter sweeps and an optimiser | planned (the parameter registry is the groundwork) | UI_PLAN.md |

Also: a stale-cache check that reloads changed files at start-up, and Help › Report, which copies
a diagnostic report of the page's light and files.

---

## 8. What checks it

| | what | evidence |
|---|---|---|
| **In-page known-answer benches** (one button each, on the user's card): `photometry`, `error-bar`, `illuminance`, `cosine-law`, `disc-light`, `scale`, `furnace`, `bsdf-parity`, `rr-bias`, `nee`, `nee-split`, `lt`, `emitters`, `optics-light`, `optics-balance`, `optics-farfield`, `optics-refraction`, `optics-colour`, and cost tests | status per bench in TESTING.md | `lib/pathtracer/tests.js` |
| **The benchmark**: a frozen scene at 1280 × 720, one change per row, GPU time per kernel, an uncached compile per scene; five full runs on a GTX 1080 Ti and an Ampere card | measured | `bench/`, PERFORMANCE.md |
| **`check-shaders`**: every module parses; every kernel built against every scene (1269 builds) and checked for undeclared names, reachable bindings and binding limits; eslint; naga where installed | runs in Node | `lib/pathtracer/core/check-shaders.mjs` |
| **About 40 Node and headless test files** (list in CLAUDE.md): light units, error bars, colorimetry, noise, optics, far field, illuminance, charts, Zemax, the builder's model, codegen, history, mesher, 3MF, the library, the timeline, the shell | run in Node; headless ones need Playwright | |

For selling, this is the evidence behind any claim of accuracy: the light is checked against
closed-form answers on real hardware, and every number carries its error bar.

---

## 9. Bundled scenes

**File › Examples** (`scenes/index.js`), each opened as a copy into the project with a camera of its own: 23 scenes
made in code (`scenes/make.mjs`) in real sizes, by audience -- **Modelling and rendering** (Start; Shapes: the gallery,
combining, modifiers, from points, a parametric part, infinite detail; Materials: the board, relief and texture,
glass and liquid; Light and camera: a room, depth of field, animation, a product shot) and **Optical design** (an
LED and lens, an aspheric condenser, Fresnel against plano-convex, a parabolic reflector, a light guide, RGBW mixing,
a prism's dispersion, a dichroic combiner, office lighting). **Built (0.54.0), not yet seen**: none has been
rendered on real hardware; the geometry and cameras are reasoned, not looked at. A first visit starts on *First
steps*. The examples before 0.54.0 are test fixtures (`test/fixtures/scenes/`).

---

## 10. TinyWebGPU and the shared libraries

- **TinyWebGPU** (`lib/tinywebgpu/`, a git submodule): a no-build WebGPU framework — uniform
  structs and binding layouts generated from a plain object, compute and render pipelines, async
  compiles and a pipeline cache, indirect dispatch, frame batching, texture upload. **Public at
  `lampmaker/tinywebgpu`, MIT, © Matthijs Keuper, 0.5.0**, not on npm. Until 0.5.0 this application
  ran its own copy, well ahead of the release; the submodule ended that.
- **`lib/timeline/`**: keyframes, sequencer, editor, recorder, MP4 and PNG-ZIP encoders. A vendored
  copy of the author's CODE_WOOD library.
- **`lib/guistuff/`** (a git submodule: property table, tree view, split pane — the author's public
  GUISTUFF, MIT), **`lib/shell/`**, **`lib/render-loop.js`**, **`lib/render-cost.js`**,
  **`lib/camera.js`**.

---

## 11. Requirements

- A browser with **WebGPU** (the TinyWebGPU README says Chrome/Edge 113+, Firefox 141+ on Windows,
  Safari 26+; the raytracer states no minimum), served over **http(s)** — `file://` does not work.
- A **real GPU**. Software adapters are for tests only; the user's results are from NVIDIA cards:
  Pascal (the benchmark names a GTX 1080 Ti) and Ampere. The benchmark's runs name Chrome 154 on
  Windows; the other results record no browser.
- **No network at run time**: every library is in the repository or one of its two submodules, so
  the page works offline once served. A clone needs `--recursive` (or `git submodule update --init`).
- MP4 export needs WebCodecs (Chromium).

---

## 12. File formats

| read | written |
|---|---|
| Scenes, projects, workspaces (`.json`, every version) | Scenes, projects, workspaces (`.json`) |
| Zemax ray files (`.DAT`) | **PNG** pictures; **MP4** or PNG-ZIP video |
| Library files, timeline files (`.json`) | **3MF with colour**, **STL** |
| | **CSV**: measure readings, intensity table, illuminance map, detector hits; chart PNGs |
| | Library files, timeline files (`.json`) |

Since 0.1.0 every scene, project, workspace and library file written records the application's version
and git revision that wrote it, as `app` (`version.js`, `CHANGELOG.md`); reading ignores it.

Not read: meshes, CAD, IES, EULUMDAT, HDRI (meshes and CAD: what each format would take is in
`roadmap/IMPORT.md`). Not written: IES, EULUMDAT, EXR, reports.

---

## 13. Licensing and provenance (facts, not advice)

- **`lampmaker/ShadyTracer` is open source under the MIT licence** (`LICENSE`), © Matthijs Keuper.
  The app shows "ShadyTracer © Matthijs Keuper". It was private, with no licence, while it lived in
  RAYTRACER_WEBGPU.
- **Vendored third-party code**, all MIT: dockview 8.3.1 (full licence included), mp4-muxer 5.2.1
  (full licence in the file), Tweakpane 4.0.4, modified, and Heroicons SVGs in the tree view (both
  inside GUISTUFF). `THIRD_PARTY.md` lists them all, with the full text of each licence.
- **The author's own libraries**: TinyWebGPU (public, MIT), GUISTUFF (public, MIT, its `LICENSE`
  added 2026-10-10), the timeline (vendored from CODE_WOOD, no licence statement of its own; in this
  repository it is under this repository's MIT licence).
- **Who wrote it**: of the 342 commits in this (shallow) history, weavesim's included, 270 are
  authored by an AI coding assistant, 72 by the user. Outside weavesim, 17 blocks carry an AI
  assistant's "generated by" marker, and `lib/camera.js` is marked throughout as generated by
  another assistant. `lib/utils.js` is the user's own and off limits to tools.

---

## 14. Docs that disagree with the code (found while writing this)

- `README.md` and `lib/README.md` said the timeline exports **WebM**; it writes MP4 and PNG-ZIP.
  Corrected in the same commit as this file.
- Resolved 2026-10-02, when the raytracer's documents were trimmed: TESTING.md's `photometry` status, the
  two rough-glass readings (SURFACES.md's STATUS has both, in order), ANALYTICS.md's "What exists today",
  PLAN.md's builder version and undo, ui-mockups/INVENTORY.md (deleted), and the "not yet seen" build
  logs of UI_PLAN.md and PLAN.md.
