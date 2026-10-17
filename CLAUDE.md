# Working on this repository

Read this first, then `README.md` for what the application is. If you are touching the path
tracer, `lib/pathtracer/README.md` is the real orientation and
`roadmap/PLAN.md` is where the work currently stands.

## Rules that are not negotiable

**`lib/utils.js` is off limits.** It carries the banner *"NOTHING IN THIS FILE MAY BE
CHANGED BY AI OR OTHER AUTONOMOUS TOOLS"*. Do not edit it, reformat it, or refactor around
it in a way that requires changing it. Everything else in `lib/` is fair game.

**`lib/tinywebgpu/` and `lib/guistuff/` are git submodules: never edit them here.** They are
[lampmaker/tinywebgpu](https://github.com/lampmaker/tinywebgpu) and
[lampmaker/GUISTUFF](https://github.com/lampmaker/GUISTUFF), pinned to a commit. A change to either
is a pull request in its own repository first; once merged, this repository moves the pin
(`git -C lib/tinywebgpu checkout <commit>`, then commit the submodule) in a PR of its own, with its
version entry. This repository used to carry its own copies of both, and both drifted ahead of
their releases with nobody noticing: the copy here was the one in use and the one not published.
`lib/timeline/` (vendored from CODE_WOOD, with its own `sync.mjs`) and `lib/dockview/` (dockview
8.3.1, third party) are copies, and are changed only by their sync or update steps.

**No model identifiers in anything that gets pushed.** Not in commit messages, not in PR
titles or bodies, not in code comments. Chat replies only.

**Do not make assumptions.** If a number, a limit or a contract matters, go and read it.
Several of the worst bugs in this repo's history were a comment asserting an invariant that
nothing checked.

**"Do I know this is true, or do I think it is true?"** Ask it every time, before writing
anything down -- in chat, in a doc, in a commit message, in a comment. Then say which it is:
- **measured**: by whom, on what hardware, with the number;
- **read in code**: with file:line -- which says what the code DOES, never what it COSTS;
- **inferred**: written as a hypothesis, with what would test it -- never as a finding.

This rule exists because a performance plan here was built on inferences written as facts: it
called a scene's slow render "this architecture's cost" when other scenes ran 6x faster at the
same resolution, and it was reverted (2026-09-29).

## You cannot see the picture, and the user can

The container's software WebGPU adapter kills the browser at startup. **The user is the only
judge of whether anything renders.** Say what you changed, say exactly what to look at, and
wait for the answer — do not claim a visual result you have not been told.

The same goes for speed. **Do not benchmark locally**: a CPU emulation of a GPU predicts
nothing about a real card, and the user's feedback is faster and more reliable than your
measurement. Keep your own test runs few; they are slow.

Every number that has decided anything here was measured on real hardware and pasted back by
hand. That loop is the instrument, so it has to stay cheap — which is why measurements are a
row in `lib/pathtracer/tests.js`, not a new harness. See `docs/TESTING.md`.

## Setting up

```
git clone --recursive https://github.com/lampmaker/ShadyTracer.git   # or, in a clone made without it:
git submodule update --init
python3 -m http.server 8000                                         # then http://localhost:8000/
```

Without the submodules every import of tinywebgpu or the property table fails, and so does
almost every test below.

## What you CAN verify, and must

```
node lib/pathtracer/core/check-shaders.mjs      # four passes -- run this before every commit
node lib/pathtracer/core/test/photometry.test.mjs  # the light units, no GPU
node lib/pathtracer/core/test/measure.test.mjs     # the per-pixel error bar, no GPU
node lib/pathtracer/core/test/unitlint.test.mjs    # the engine meets the scene only at the boundary: violations planted and caught, the clean kernels clean, every Ray and Hit field classed a length or not
node lib/pathtracer/core/test/units.test.mjs       # the engine in metres, the host's side: the camera as the kernels read it (ortho too), a pick's round trip, light sources, the step cache's box, flux per photon, the optics uniforms and read-backs
node lib/pathtracer/core/test/tolerances.test.mjs  # every tolerance in one table (core/tolerances.js): each use counted in its file, no use outside it, every row in PRECISION.md, RT.tolerances() resolved
node lib/pathtracer/core/test/floor.test.mjs       # the f32 floor, in an f32 emulation: a normal's noise at the floor's step and below it, the march ending, the numbers the shader is made of, the automatic tolerance against it
node lib/pathtracer/core/test/colorimetry.test.mjs # chromaticity, CCT/Duv, the Rec.709 matrix, mixing
node lib/pathtracer/core/test/spectral.test.mjs    # the CMF fit against the CIE table, each channel's wavelengths, a coating's reflectance per channel against brute force and in f32; Cauchy from n_d and V_d against BK7's catalogue, the wavelength draw's mean weight 1, the wavelength's code in a tag
node lib/pathtracer/core/test/photons.test.mjs     # a sample in batches: every stream traced whole at any size, no batch over the buffer, each a fair slice, more batches when asked, no GPU
node lib/pathtracer/core/test/build.test.mjs       # a trace during a build refused before any frame; a build predicted without compiling; tinywebgpu opens no pass it cannot bind; its pipeline cache, a rebuild and a restore from it, the measurements never; R.trace on the real tinywebgpu with a builder scene's uniforms: the four scene-free kernels handed no scene name, every program the whole bag at its first write and only what moves after, a value changed seen at once; the last pass's shadow rounds, their lastpass and their shadow flips; the lights' rays switched off; a sample in batches: every pixel's ray and every photon, each batch its own seed and the whole chain, resolve once; the step cache's box: its cells, as many as the setting says, bound to march and occlude, in their bags; kept across a camera move, a fill owed by a scene value, a setting, the data, another scene; the step cache compiled in only when on, off the kernels' text as before it, the cells a word; on, read-only kernels and a fill pass before the first sample in a submission of its own, chunk by chunk, from the pick copy, every trace with 2, a saved 0 as 1; the facade built: no engine method it replaces calls itself or is called by the engine, the step cache through it, a setting's kernels built by one job, a scene swapped in with them building them once; the display pass bound to the cells and handed the grid, the view switched without filling them again; a sample over several frames (sliceMs): the slices' batches one call's, resolve once, a pending sample dropped and cleared, a reset going on with it, a timed sample cut by its time, three drops and a whole one; the photon map (0.60.0): built alone and only when on, its buffers at the capacity (its lists, counts and sub-lists), the photons in batches before the camera's rays, emptied once a sample, dispatched between surface and shade, its radius the sample's own and shrinking, its stores' keep the sample's own, 1 while it fits and the fill over a reading asking more (0.61.3); in Draft and Optics too, not in Sketch, the illuminance view or an orthographic camera; idle after a whole sample no camera ray gathered in, a probe every 16 traces, woken by a gather or a new scene and not by a camera move, never without photons, a pending sample keeping its choice (0.61.0); off, no kernel and no memory; the facade started as the page starts it (a real camera, the defaults, a task before the first build): no promise left rejected, the map built (0.61.1); the haze box (0.62.0): its code in the march (0.62.2: a leg's collision drawn as it starts), shade and occlusion kernels only for a scene with one, in one build, the kernels without one the text they were byte for byte, its values in the bag in metres, live through the facade, a box added or taken away live refused, none in Sketch
node lib/tinywebgpu/test/layout.test.mjs          # (the submodule's own test) tinywebgpu's uniform packing, and a write merging into the struct (a field not named keeps its value), which R.trace's once-a-trace writes rest on; a buffer typed `read ...` bound read-only wherever declared, one typed `uniform ...` bound var<uniform>
node lib/pathtracer/core/test/noise.test.mjs       # the noise library: gradients, continuity, every Lipschitz bound, Worley exact
node lib/pathtracer/core/test/shapes.test.mjs      # the newer primitives: normal = gradient, exact or a bound as claimed, never too large inside, any live parameters; the aspheric condenser focusing exactly; profiles, and paths swept -- a scale and twist per point too, slope never over 1
node lib/pathtracer/core/test/compileprogress.test.mjs # the compile bar: a build's time predicted from its uncached kernels' inlined sizes, growing faster than them as the user's 16 builds did, the rate learned and kept (not from a browser-cache answer, at most twice a build), the bar by the clock never at its end early
node lib/pathtracer/core/test/kerneltime.test.mjs  # per-kernel GPU time: tinywebgpu's pass hook, the timestamp pairs and their sums, a whole trace named; the frame timer's GPU-busy time with two queued; the iteration budget always the worst case, budgetOverride winning; the submission split over at most 24 iterations, the last pass's shadow rounds a place to cut, a frame's time over its batches, no GPU
node lib/pathtracer/core/test/structs.gpu.mjs     # the bytes a ray and a shade queue item take, as the host allocates them, against the WGSL compiler's strides, exactly (optional: webgpu + lavapipe)
node lib/pathtracer/core/test/dispersion.gpu.mjs  # dispersion through the shade kernel's own bounce on Dawn: n(lambda), the draw and the tag's wavelength against the JS mirror; a fresh ray reflecting white at the d line's Fresnel, refracting along Snell at n(its wavelength) and averaging white; a ray with one keeping it (optional: webgpu + lavapipe)
node lib/pathtracer/core/test/lens.test.mjs       # the camera's lens, no GPU: its rays and connections to it give one picture of a lit patch, in and out of focus; the focus plane, the disc, the pinhole's limit
node lib/pathtracer/core/test/lens.gpu.mjs        # ...in the kernels on Dawn: genrays through the focus plane at its pixel, a radius of 0 the pinhole bit for bit; the photon map's class step by step and what the camera leaves it; a connection through the lens; a hit shaded in prog_shade's phases, the map on and off (optional: webgpu + lavapipe)
node lib/pathtracer/core/test/sppm.test.mjs       # the photon map, no GPU: light -> glass -> floor -> glass -> eye drawn by the camera's own rays and by the map over samples -- a slab with air under it (two faces each way) and one lying on the floor (a gather in glass, its 1/n^2 planted); a collimated beam under the slab against its closed form; the grid against brute force, the radius's schedule, the store and gather gates, a light no camera path can meet; a record stored exactly when a gather can count it (none at the bounce cap); within its budget a gather the whole lists' sum, past it sub-lists, kept stores and both at once each the exact sum on average (0.61.3), the hard cap counted
node lib/pathtracer/core/test/sppm.gpu.mjs        # ...on Dawn: the gates' WGSL against the JS, a light no camera path can meet too; lobesEval exactly 0 wherever sppmEvaluable or lobesNone skips the work (a 0.02 mirror among them); the whole renderer -- and again with room for 200 records and a gather budget of 8, the stores kept and the cells walked by sub-lists, the same picture; (R.trace) on a glass slab over a sunlit floor, the floor through it by the camera's own paths, the map, the map through a lens, Draft without and with it -- each region mean within its error bar; beside the slab unchanged; idle where no glass is in view (optional: webgpu + lavapipe)
node lib/pathtracer/core/test/haze.test.mjs       # dust in the air (0.62.0, a haze box), no GPU: a leg's stretch in a turned box and the radius, the collision ("move back YY": 1 - exp(-sigma L), the truncated exponential), Henyey-Greenstein, the uniforms in metres and off in Sketch and Optics, a photon's connection from the air against a beam's closed form and a pinhole's own integral (dist / z^3), light sampling from the air by MIS, an albedo-1 slab walked through
node lib/pathtracer/core/test/haze.gpu.mjs        # ...on Dawn: the WGSL against the JS, the rays a collision leaves alone, a shadow ray's haze; the whole renderer: a furnace (albedo 1 reads 1, 0.5 does not), sunlit dust in Draft against the integral, light sampling off against on, a box inside glass changing nothing, dust under a slab with the sun's photons and the photon map on and off, a mirror's photons connecting from the air, the illuminance view's first leg clear (optional: webgpu + lavapipe)
node lib/pathtracer/core/test/coating.gpu.mjs     # a coating through the shade kernel's own BSDF on Dawn: its R per channel the JS mirror's, reflected R and passed 1 - R per channel whatever the pick, a one-channel ray's weight 1; AR, bare, every face, TIR, an opaque base (optional: webgpu + lavapipe)
node lib/pathtracer/core/test/diffuse.gpu.mjs    # Max Diffuse Bounces (0.69.0) on Dawn: a hit through prog_shade's phases at every cap -- a camera path with one left sampling light and going on, one with none (capped) sampling none, ended by an EV_EVAL draw and going on past a mirror or a near-mirror unshared by MIS; a light's photon connecting only with one left and ending without; the Optics page's rays never cut; the march steps kept; the whole renderer on a floor and a wall: 0 bounces Draft's picture, light sampling off as on at 0 and 1, each bounce more brighter (optional: webgpu + lavapipe)
node lib/pathtracer/test/runwatch.test.mjs         # a test run that ends on a lost GPU or a sample that never returns: the rows kept, the row it stopped in with its samples, why, nothing on the GPU put back after a loss; a row predicted to compile for minutes not run; the in-flight stretch pinned only under the engine's split; every test camera, and every row's, naming its target (0.62.1: one without orbits the view's own)
node lib/pathtracer/test/develop.test.mjs          # a save's picture kept as light: where a develop starts (the view's exposure, metered or manual), its uniforms, the preview's box, the meter, the darkroom on a stand-in device
node lib/pathtracer/test/samples.test.mjs          # the offscreen sample loop: one in flight as it always was, two never more, one sample the same either way, nothing left running however it ends
node lib/pathtracer/test/renderloop.test.mjs       # the live loop held: nothing submitted, still running, the governor not fooled by the hold; holds nest, a release once; the picture's resets counted; what a frame really traced (opts.done) counted, the count held within one of it
node lib/pathtracer/test/interaction.test.mjs      # the user moving something (fast while moving): a poke and idleMs after it, a hold through any quiet, a release once, holds nest, heard once each way
node lib/pathtracer/test/stats.test.mjs            # the Render stats readout: one however often painted, outside the page's document too; a table, warnings first, then Speed, Picture, the cursor; the photon map's share kept
node lib/pathtracer/test/quality.test.mjs          # the Quality presets and their line, a preset chosen writing only what differs, the developer settings, what Draft / Sketch / Optics / lamps only / a move hand the kernels, the sketch light's level and Optics' dimming; every renderer setting in one box
node lib/pathtracer/test/renderer.check.mjs        # the Render settings panel (its id still `renderer`): its boxes, the Quality buttons and line, the light sources' switches, the Developer switch's line and its box where there is no Quality, a preset chosen, Custom; the Performance box, its word, its rows greyed while what they need is off (optional: playwright)
node lib/pathtracer/optics/test/optics.test.mjs    # the optics module's sampling and tallies, and the estimate over batches against the two-pass list it replaced, merged, no GPU
node lib/pathtracer/optics/test/readback.test.mjs  # a run's batches read back together on a device that carries out every copy: each its own, one readback a group, the run's settings kept, a trace one readback
node lib/pathtracer/optics/test/drawn.test.mjs     # what the optics module draws: a trace's paths published to a copy, a run's never; a run gives the trace its seed back; the picture's photons handed every uniform their kernel reads, one kernel for every scene: ready at a swap, nothing compiled
node lib/pathtracer/optics/test/farfield.test.mjs  # the far field: binning, intensity, beam angles, the polar scale
node lib/pathtracer/optics/test/illum.test.mjs     # illuminance off a map: profiles, rings, encircled flux, isolux, the virtual plane
node lib/pathtracer/optics/test/charts.test.mjs    # every chart drawn into a recording fake canvas: nothing else runs them
node lib/shell/test/registry.test.mjs               # the shell's panels, commands and menu model, a submenu row, a panel made at run time let go, no DOM
node lib/shell/test/params.test.mjs                 # the parameter registry, a timeline track on it, the renderer's settings in it
node lib/shell/test/example.check.mjs              # the shell in headless Chromium; a submenu row, a panel with no View entry; a chart's strip, a control hidden and shown again; the view toolbar, its analysis drawer and the measure tool in it; the host's buttons on the bar after the menus (S.tools), the window verbs and "Layout: X" kept out of the menus and in the palette (optional: needs playwright, says so)
node lib/pathtracer/test/camera.check.mjs          # the camera popover: position and target as numbers, typed in, following; the lens's aperture and focus (optional: playwright)
node optics/test/chartset.test.mjs # the charts that exist: the six kinds' first always, more of a kind with their own settings, kept and read back, no DOM
node optics/test/page.check.mjs # the Analysis pane and chart panels, headless, on made-up data: each chart's own strip, the map's button held and Shift-drag, a second map with its own quantity, a chart made and taken away; the rays in the view's analysis drawer; the ray count's multiplier; Live, each round on its own and with Σ its rounds adding up, a reset starting them over, the rays between them, switched off mid-round, through a scene build (optional: playwright)
node test/diagnose.check.mjs    # stale cached files found and reloaded fresh, headless (optional: playwright)
node test/version.test.mjs      # VERSION and CHANGELOG.md agree; the revision read from .git, or the REVISION file a Pages deploy writes, every failure null; a file's `app` stamp never read into a document
node test/start.test.mjs        # the page's start when its scene will not compile: the empty scene instead, why, and the safe start (?safe, or a start that never finished), no GPU
node library/test/panel.check.mjs # the Library panel: search, filters, tags, put in, keep, rename, remove, duplicate, edit, export, import, drag out (optional: playwright)
node builder/test/drop.check.mjs # a library item dropped on the tree or the picture: materials onto objects, nodes placed (optional: playwright)
node builder/test/panel.check.mjs # the properties panel: a child's join and own blend, the base, the top level, a group's blend and recipe, a profile's and a path's points; the lock rows and what they disable; the scene's radius beside its unit and its surface tolerance after it, typed unrounded; the scene row's camera and exposure boxes (0.66.0): folded and remembered, the popovers' fields, following a move, flagged; the bindings editor and the rows it holds; an aspheric lens's coefficients typed whole, negative and small; the animated flag on a live row, the scene row's animated list, its box first (optional: playwright)
node builder/test/tree.check.mjs # the tree's join marks clicked: ∪ to − makes a group a subtraction, the base refuses, the top level has none; the lock beside the eye; a row double-clicked focuses it, a group's too (optional: playwright)
node library/test/edit.check.mjs # a library item edited: the tree isolated, the strip over the view, Save, Close asking, Discard, the back row (optional: playwright)
node builder/test/properties.check.mjs # the Properties panel: in boxes, the selection's own first and a box a category; a material's relief, a library item's details, the functions editor's errors (optional: playwright)
node builder/test/transform.check.mjs # the Transform gizmo over the real builder and camera: one mode, a stretch cube grows one size live, back, Escape, undo, Ctrl, a turned shape's own axes, the circle; the numbers' panel; Ctrl's grid; a light's cubes; the handles a lock holds gone (optional: playwright)
node builder/test/points.check.mjs # the Points mode over the real builder and camera: offered, a dot, an arrow, a name in range, unsound held, Delete and +, typed, the fillet, Escape, the plane view and back; its numbers and typed entry in the panel; the Transform gizmo's squares at a point; every point's legs; a path point's section: a tube's circle, a sweep's cubes and twist (optional: playwright)
node lib/pathtracer/optics/test/zemax.test.mjs     # the Zemax ray file reader (the OSRAM sample too, if present)
node builder/test/emit.test.mjs
node builder/test/validate.test.mjs   # the builder's probe through the real tinywebgpu: a module and never a pipeline, an error at the node and line written, no answer never clean
node builder/test/codegen.test.mjs   # ...and the golden shaders (test/fixtures/csg-v10): every CSG case, every scene, as frozen; the boxes off a scene with no box code, every way; the builder's boxes on the dear nodes only (codegen's default since 0.34.0): none for one plain shape, `true` refused; every box (cull 'all') the bench's
node builder/test/model.test.mjs     # the document model; a scene's view (0.66.0): its camera and exposure whole when read, refused when unsound, a camera in another unit; its tolerance; its environment whole; the view's flags on the root; a scene's timeline (0.67.0): whole when read, the film's settings only, set whole, refused when unsound
node builder/test/tree.test.mjs
node builder/test/expr.test.mjs     # the expressions in a path's points: what reads, precedence, errors at column, rename, a path resolved by point
node builder/test/bind.test.mjs     # component parameters: what a node binds and reads, refusals at line and column, values top down, a group's own for its copies, renamed and removed, held, the file, the shader the same, through the library
node builder/test/helpers.test.mjs  # the helpers an asset carries: the functions block's items, what code needs transitively, added once, a different one refused with nothing changed
node builder/test/bindlive.test.mjs # ...through the builder over a stand-in renderer: a group's parameter moved live, its bound values as uniforms or records, a count's compile asked, the registry
node builder/test/recipe.test.mjs   # a group's joins as text: every group's own recipe a no-op, what is written is what happens, errors at line and column
node builder/test/pointedit.test.mjs # points edited in the picture: planes, the curve as given the shader, drags exact, names in range, every path judged, the fillet handle, the plane view through the real camera; a path point's section, its handles and what they write
node builder/test/history.test.mjs  # undo and redo as snapshots, merged by key, the limit; each step's meta given back as it is undone or redone (0.63.0)
node builder/test/filemenu.test.mjs  # File's five rows (0.63.0): New project, Projects…, Import from file…, Export ▸ (scene, project, 3D print), Save picture…, each the host's; no Save, no label twice; greyed while a library item is edited; the scenes' commands in no menu, on the one worked on, the last refused; the examples by audience and group
node builder/test/scenestrip.test.mjs # the cards over the tree (0.63.0): one per scene, a library item's left out, the open one marked; objects (not a group, a light or a box) and lights counted; a time to open said
node builder/test/animate.test.mjs  # values flagged animated: the flag on its owner by registry path, following its parameter, kept by a copy; what it keeps a uniform in the bake held to what the real builder writes, every scene's live values; a component parameter's bound values; the registry's animated-only list; the view's camera and exposure flagged, offered by the registry beside the scene's (0.66.0)
node builder/test/modeline.test.mjs # the status bar's word for the build shown: baked and how many animated uniforms live, or the editing build's mode and the bake's state; the last leave and why
node builder/test/baker.test.mjs     # the bake in the background: only once the edits stand still, compiled then swapped in, dropped when an edit comes during it, a refusal not retried until the edits move; through the real builder: the scene baked, shown with the picture kept, a live value asking the editing build back, one swap at a time; none during an offscreen render; an animated value kept a uniform, written to the baked scene with the bake staying, pushed again when moved during the swap; a flagged position dragged as the gizmo does, staying baked; why the bake was left
node builder/test/scenes.test.mjs    # every example and fixture compiles and declares what it reads; every example's file whole -- its camera, exposure and environment (0.66.0) -- and the review's findings held: Office lighting seen from inside, one lens, the glass's and the reflector's tolerances
node builder/test/project.test.mjs   # projects, files, a timeline per scene (0.67.0: out of the history and carried across a restore, handed to the host as each scene is shown, kept into the scene shown, no undo step but a save revision, a deleted scene's back), a view per scene (0.66.0: in its document, put back whole over a renderer that sets only what it is given, written as it changes and no edit, out of the history, read from an old workspace's cameras and exposure, converted to a scene's unit, a deleted scene's back with its undo), undo staying on the scene worked on for a change to the list of scenes (0.63.0: a delete, a copy to, a rename, a reorder; a new scene's undo back where it began, a load's too) and showing the scene an edit inside it changed, a live value set during a compile pushed once it ends, a path edited in the picture compiled live, the code editor's probe kept out of the pipeline cache, the live loop held through an apply and let go however it ends
node builder/test/bounds.test.mjs
node builder/test/gizmo.test.mjs
node builder/test/focus.test.mjs    # a tree row double-clicked: the box a node is framed by, the camera that frames it through the real lib/camera.js, the glide
node builder/test/readout.test.mjs  # the numbers' panel at the view's top right: position, rotation, scale, lengths, the bounds times the scales, what a drag lights and says
node builder/test/stretch.test.mjs  # a shape stretched by its own sizes: each preset's axes, lights and the export box, the code match, constants, ranges, never through zero, the snap
node builder/test/selection.test.mjs
node builder/test/mesh.test.mjs
node builder/test/print.test.mjs
node builder/test/exportbox.test.mjs
node builder/test/hazebox.test.mjs  # the haze box (version 22): one a scene, its settings checked, saved and loaded, an old file read; emitted as a comment, the scene's `haze` in the world through turned, scaled and arrayed groups, hidden with live visibility off not on; its outline, focus, stretch and registry rows
node builder/test/params.test.mjs   # every scene's parameters: each live one writes a uniform the scene declares; a material field only in the shader while in use (the colour depth) not declared at 0, its first use a compile through the real builder, then live
node builder/test/scenedata.test.mjs # the scene as data: an edit that adds no code is the same text and other records, every scene; what is compiled as before; a twist's or a shell's children as data; the records' skips; the records read through their uniform copy in the plain walk, one text whatever their number; the data's revision a write
node builder/test/dataapply.test.mjs # the builder with the scene as data: what compiles and what is written, live values, undo, the boxes -- over a stand-in renderer; every write followed by the records' uniform copy's
node builder/test/plainshape.test.mjs # one plain shape, which codegen gives no box: every built-in closed-form shape recognised from its own code, anything more than that one call not, an outline not
node builder/test/scenedata.gpu.mjs  # ...the loop computes what codegen computed, every modifier as data too, an array what its copies written out do, on a WebGPU in node (optional: npm i -g webgpu, and lavapipe; says so)
node builder/test/units.gpu.mjs      # the engine in metres on a WebGPU in node: scenes in mm against the same re-authored in m, plainly and as data; march, occlusion and shadow rays end the same (optional: webgpu + lavapipe)
node builder/test/boxes.test.mjs    # the measured bounding boxes, against a sampler of exact shapes -- and the culling's: every shape inside its padded box, a copy moved off its original too; a part only the first coarse lattice finds kept, a part none finds leaving its group no culling box -- through the bench's view of the copies' boxes too (boxesFor `same`), and a store that cannot say what is missing refused
node builder/test/relief.test.mjs   # the relief in a shell: its code mirrored, a lower bound on the real noise, the step bound in the band, what group code is told per parent; a material's relief and the modifier through a smooth blend
node library/test/store.test.mjs    # the library: every built-in item inserts soundly, one's own items, duplicate and update, tags, export and import, search
node workspace/test/store.test.mjs  # projects kept in the browser: the store, nothing unreadable overwritten, the autosave and its flush, the tabs' locks, a first visit, a second tab's copy; a session's views, and an old one's cameras, read into its scenes (0.66.0)
node workspace/test/projects.check.mjs # File's five rows on the real builder, Import's question; the line and cards over the tree (a click selects, ▶ and a double-click open, ⋯ duplicates beside and deletes with undo staying put, drags reorder (by the mouse, and with the cards redrawn mid-drag and mid-click: 0.67.1), a tree row dropped on a card copied or with Shift moved, folded, the ▶ of a scene not compiled); the scene's row at the root of the tree, a click selecting and only a chevron folding, copy and move to a scene, the system clipboard, a reload, an item reopened with the cards waiting, a second tab, the Project panel's projects, scenes and examples -- over real IndexedDB and locks (optional: playwright)
node workspace/test/scenepics.test.mjs # the scenes' pictures (0.63.0): kept per project and scene, a picture and a time to open each, read back on first asking, a project's gone with it; taken once settled, once a picture start, never while busy, moving or a library item, never mislabelled by a switch during the read
node library/test/thumbs.test.mjs   # the library's pictures: keyed by what an item is, rendered once, kept, queued
node library/test/studio.test.mjs   # the studio's scenes and camera framing, an item that cannot share a part failing alone, no GPU (what it renders is the user's to judge)
node library/test/edit.test.mjs     # an item's editing scene for every built-in item; open, save, close, undo and redo on the real builder
node tools/test/timeline.test.mjs   # the timeline's registry: live parameters only, a track moving one, quietly; the page's timeline from before 0.67.0 given to the scene shown, once
node bench/test/bench.test.mjs     # the benchmark: every row what its label says (reliefs, units byte-identical, settings), the studio scenes framed, the runner
node bench/test/wgslgraph.test.mjs # the call graph shaderstats.mjs counts scene copies with (node bench/shaderstats.mjs: kernel sizes, per-sample CPU)
node bench/test/copies.test.mjs    # the copies shade, the optics shade and pick hold of the SDF, getMaterial2, the normal and the BSDF's functions, every scene: a new call site fails it
node bench/test/scenedata.test.mjs # the scene-as-data bench: each scene as codegen then as data, nothing else changed, the drift row
node bench/test/scaling.test.mjs   # the scaling benchmark: n lens assemblies and nothing else changed, as data, one text, one tolerance and radius, uniforms under 64 KiB, the copies behind the camera
node bench/test/scaling.gpu.mjs    # ...on a WebGPU in node, boxes measured as the bench does: copy 1's box its own size at every count, the same picture, about one record more a step a copy and no more steps (optional: webgpu + lavapipe)
node bench/test/overhead.test.mjs  # the data walk's own-cost bench: codegen and data pairs, the Menger cubes without their warps (no warp code, no warp frames, the subtraction kept), one cube alone, the drift row
node bench/test/stepcache.test.mjs # the step cache's bench: each scene off, own cell, cells ahead at 1, 4 and 16 million cells, all filled once, and every frame -- one scene, text and boxes, the settings the one difference, three compiles; the optics bench as data last; the cache's box from measured boxes
node builder/test/stepcache.gpu.mjs # ...the engine's march and occlusion kernels with the step cache on and off, codegen and as data: the cells filled by the pass, every cell, chunks bit for bit; every ray ends the same, the steps fall, nothing written by a march, off is off, a second camera over the full cache; the cells shown (stepCacheView) against brute force on a grid by hand (optional: webgpu + lavapipe)
node builder/test/cellobject.gpu.mjs # the closest object per cell, counted before it is built: each top-level node's own distance, the march simulated plain, with the cache filled once, and with A alone where it answers -- steps, scene calls, node evaluations and box tests a ray; every ray ending as plain's, no A-alone step over every node's own distance (optional: webgpu + lavapipe)
node bench/test/bake.test.mjs     # baked against codegen: each bench scene twice, one camera and boxes; the baked text codegen's with the reads renamed, un-baked byte for byte; every value a constant but the culling boxes; vectors and matrices as WGSL literals, scalars as before; a value no literal holds kept a uniform
node bench/test/animated.test.mjs # what animated values cost the bake: each bench scene as data, baked, and baked with four positions flagged -- one camera and boxes, each compiled; exactly those matrices kept uniforms, the text otherwise the baked row's
node builder/test/bake.gpu.mjs    # ...on Dawn (Tint): every bench scene's baked march, occlusion and surface kernels compile, and every camera ray ends as codegen's (optional: webgpu + lavapipe)
node bench/test/builds.test.mjs   # which build renders fastest: each bench scene as codegen, baked, baked with the step cache filled once (own cell), as data, and that with the cache; the Menger cubes without the cache rows; one camera and boxes a scene, each row compiled
node bench/test/boxcost.test.mjs  # what the box tests cost: four scenes with boxes off (no box test in the text), boxes that never cull (every box declared written known and holding everything, never culled through cullDist in f32), and measured -- one scene object for the last two; boxes on the dear nodes only, a box test for exactly those, the others one plain shape -- the builder's text, the two before it every box's; the drift row
node bench/test/dichroics.test.mjs # a glass-and-light scene's time (Tests > dichroics): the frozen dichroics baked under its studio light, its own light's photons on every row, one change a row (the map off, NEE off, the lights' rays off, two sizes, the step cache, the editing build), the batches its note reads them by, the camera on the plates and the prism
node tools/test/timeline.check.mjs  # the Timeline panel over a stand-in renderer: + track, the frame guide, RECORD's verbs, a GIF recorded and read back by Chromium; each scene its own timeline (0.67.0): kept, another shown whole, the encoder's settings the browser's, one shown while recording, a file loaded, a reload, the old timeline taken once (optional: playwright)
node lib/timeline/test/gif.test.mjs                # the GIF writer (lib/timeline, CODE_WOOD's): read back exactly by its own decoder, Pillow and ffmpeg where installed, the centisecond clock
node help/test/markdown.test.mjs                  # the help's markdown and links: each construct, nothing in a page put into the panel as HTML or a link it would not follow, anchors, a widget's block
node help/test/coverage.test.mjs                  # the help holds together: every page listed and on disk with its title, every link going somewhere (a page and its heading, an example, a command, a panel); the reference pages as reference.mjs writes them now, every material field and light setting with its words
node help/test/widgets.test.mjs                   # the SDF explainer's numbers: the shapes exact, the blend the renderer's own, sphere tracing stopping at the surface
node help/test/panel.check.mjs                    # the Help panel headless: contents, a page link, back and forward, the SDF widgets drawn and redrawn, links handed to the host (an example, a command, a panel), search, the last page (optional: playwright)
```

`check-shaders.mjs` does four things and its header explains why each exists:

1. **imports every module** — a backtick inside a WGSL comment ends the template literal and
   breaks the shader pages away from the cause. This has happened six times. It also parses the
   host page's inline script, which nothing imports: a stray brace there once shipped a page
   that never started.
2. **builds every kernel against every scene** with a device that records instead of
   compiling, then checks no `SCREAMING_SNAKE` identifier is undeclared, the bind group
   fits, and every binding is reachable from `main` (tinywebgpu binds what the text names;
   `layout:'auto'` keeps only what `main` reaches — a mismatch is an invalid bind group). A kernel shipped with an empty module string and pass one still said "24 modules
   parse".
3. **lints `lib/pathtracer`** for the mistakes that are always mistakes (`no-undef` chiefly).
   Optional — it says loudly when eslint is missing rather than passing silently.
4. **compiles every kernel with naga**, the WGSL front end wgpu uses, rebuilt exactly as
   tinywebgpu assembles it (schema, entry point, `G.defines`). This is the pass that sees a
   WGSL **type** error without a GPU. Optional and loud like pass three; install it once per
   container with `cargo install naga-cli` (a few minutes) and put it on `PATH` or set `NAGA=`.

naga is not the browser's compiler (Tint), so even a clean pass four is strong evidence, not
proof. It is **never** evidence the page renders. Nor does it check **uniformity**: a
`workgroupBarrier()` after `if (gid.x == N) { return; }` passed naga and Tint refused it on the
user's machine (2026-09-29). Pass two lints for that one shape; any other non-uniform barrier only
Tint sees.

## The failure this repo keeps repeating

Almost every bug here has one shape: **something that was true for the only caller that
existed became false when a second one appeared.** The backtick checker that did not cover
the scenes directory. `setScene` trusting its callers to stop the loop. A uniform contract
that had only ever carried scalars. `envRadius` reused as a scene extent by guiding.

The second shape, newer: **a feature behind a flag that nothing exercises is code that has
never run.** Three bugs in the guiding path shipped that way in a row, each invisible until
someone set `guide != 0`. If you add a mode, find a way to execute it.

## Conventions

- Comments explain **why**, including what went wrong before. Match the density around you.
- Commit messages are prose that says what was wrong and what the fix rests on.
- Work on a branch, never commit to `main` directly, and only open a PR if asked.
- `main` is what GitHub Pages serves (`.github/workflows/pages.yml`): a merge is a release.
- CI (`.github/workflows/test.yml`) runs `check-shaders.mjs` and every `*.test.mjs` above on each
  push and PR. It is no substitute for running them yourself before a push.

## Versions

The application has a version: `VERSION` in `version.js`, semver 0.x, with one entry
per version in `CHANGELOG.md`, newest first. **Every PR that changes the application
raises it, in the same PR, with its entry.**
- **MINOR** for a feature, or for any change to a file format's `version` (scene, project, workspace,
  library).
- **PATCH** for a fix, a document or a test.
- If `main` took that number first, take the next one when merging `main` in.

The entry says what changed and **what to look at**. `version.test.mjs` fails when the code and the
changelog disagree.

The exact code is the git revision, which the page reads from `.git` (on GitHub Pages, from the `REVISION`
file the deploy writes) and shows beside the version. So a
pasted test result, a report and a saved file each name their build without anyone typing a hash. When
recording a measurement, copy that line from the result's header rather than writing "code at ..." by
hand.
