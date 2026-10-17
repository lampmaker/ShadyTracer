# `lib/pathtracer/` — the path tracer as something a program calls

A wavefront SDF path tracer that does **not** own the frame, the canvas, the camera or the
scene. You give it a device and a scene; it gives you `step(n)` and a picture.

It lives in `lib/` rather than in `core/` — which `lib/README.md`
otherwise forbids — because being usable by a program that does not exist yet is the entire
point of it. ShadyTracer, the application at this repository's root, is now just one host.

```js
import { createPathTracer } from '../../lib/pathtracer/index.js'

const RT = await createPathTracer({ gpu, ctx, Q, scene, CAMERA, minfps: 20 })
await RT.init()
RT.start()                       // or drive it yourself: RT.pause(), then await RT.step(n)
```

## Why it is shaped like this

It used to be an application: the page owned the loop, the camera, the uniform assembly and
the canvas, and the only way to get a picture was to **be** that page. Every use it is
actually wanted for inverts that.

- An object builder owns an editor and wants a preview.
- A weave editor's real UI is 2D jacquard; rendering is a button.
- A flow simulation owns its data and its frame and wants the current state drawn.

In none of them is the renderer the host. So the central verb is `step(n)` — advance the
picture when the caller says so — and everything else is arranged around it. The rAF loop is
opt-in (`lib/render-loop.js`), because a renderer that schedules its own frames cannot be
embedded in a program that schedules its own frames.

**The host owns the device.** `gpu` is an already-initialised tinywebgpu instance, not one
created here. That is what lets a simulation hand over textures it is still writing: they
are already on this device, so a scene declares them as resources and the kernels sample
them in place.

## The API

`createPathTracer()` returns the engine object with the facade merged onto it — one object,
one surface, because the test bench reaches for engine-level state (`budgetOverride`,
`submitEvery`, `imageStats`) on the same object it calls `set()` on.

### Drawing

| | |
|---|---|
| `await step(n)` | advance the picture by n samples, resolving when the GPU has finished them (not when they were submitted); refused while the live loop runs (`pause()` first). **The central verb.** (`sample(n)` did the same until 0.22.6.) |
| `invalidate()` | the scene changed; what has accumulated is of a different picture |
| `await init()` | build buffers and pipelines. Once, before anything else |

### Settings

| | |
|---|---|
| `set(values, reset = true)` | set any UI-backed uniform by name — the renderer's own or the scene's. **Returns the keys it did not recognise** rather than swallowing them |
| `get()` | every UI-backed uniform in one bag, so a harness can put back exactly what it found |
| `update(reset = true)` | rebuild the uniform bag from the camera and the states |
| `quality.js` | the Quality presets (`QUALITY_PRESETS`, `presetOf`, `presetValues` for `set`; `QUALITY_GROUPS`, their buttons' order; `describe`, the Quality box's line), the developer settings (`devKeys`, `devChanged`, `devDefaults`: every `gui.dev` in the schema), and `effective(values)` -- the settings **as traced**: the measuring views in full, Draft's light sample, Sketch without light, Optics with the lights' rays alone (its flat light's level is `derive`'s, `opticsFlat`), lamps only's black environment. `buildUniforms` puts it in the bag, so every path to the kernels agrees; the states keep what was set. Pure; `test/quality.test.mjs` |

### Size

| | |
|---|---|
| `size()` | `{mode, width, height, scale}` plus the resolved `w`/`h` |
| `setSize({mode, width, height, scale})` | `mode` is `'fit'` (follow the panel) or `'fixed'`; `scale` is the downscale |

Letterboxing and the filtered upscale are free: the canvas is created
`width:100%; height:100%; object-fit: contain`, so a backing store of any shape is centred
and scaled into the panel by the browser. A half-scale buffer is the same size on screen and
only softer — which is why `scale` is the control that matters on a large display.

### Output

| | |
|---|---|
| `await saveImage({width, height, samples, filename, onProgress, signal})` | render and download a PNG as the view would show it; an aborted `signal` stops it between samples (AbortError, no file) |
| `await renderPicture({width, height, samples, onProgress, signal})` | render and **keep the result as light** (a copy of the accumulation, cd/m²) in `darkroom`; returns its size, samples and `view`, the settings the display used for it |
| `darkroom.save(settings, filename)` / `.preview(ctx, settings)` / `.meter()` / `.discard()` | the kept picture exposed, tone-mapped and graded with settings chosen after the render (`develop.js`: `viewSettings`, the develop pass in `rendertoscreen.js`), written as PNG at full size; `view` saves the picture `saveImage` would have |
| `await beginOffscreen({width, height})` | stop the loop, point the renderer at an offscreen target |
| `await renderFrame(samples, onProgress, signal, {inFlight})` | accumulate into it; `inFlight: 2` records the next sample while the GPU runs this one (the save, the timeline and the studio ask for it; the default is 1) |
| `await grabFrame()` | it, as an `OffscreenCanvas` |
| `await endOffscreen()` | free, restore the live size, restart the loop |

**Those four names are `lib/timeline`'s host contract, deliberately.** `makeSequencer` asks a
host for `begin({width,height,samples})` / `render(samples)` / `grab()` / `end()`, and
weavesim implements them by hand in its page. Building them here with those shapes means
wiring the sequencer up is a call site rather than a change to the renderer. What is still
missing for that is a keyable-property registry, not the plumbing.

It has to be offscreen rather than a canvas readback: the swapchain is configured
`RENDER_ATTACHMENT` only, so the presented image has no `COPY_SRC` and cannot be read back
at all.

### The loop (opt-in)

`start()`, `stop()`, `running()`, `pause()`, `resume()`, `await step(n)`.

`step` is deterministic and resolves when the GPU has actually finished, not when the submit
was recorded. Two things need that: a buffer readback while the loop is hammering may never
resolve on some adapters, and comparing two builds is only meaningful at the same sample
count.

`const release = hold()` keeps the loop from submitting until `release()`, without stopping it:
`running()` and the play/pause control stay as they were. Holds nest, and a release runs once
however often it is called. The builder's apply holds from its probe to the end of `setScene`:
with the loop submitting, a revisit apply of the Noise library took 1.4-6.8 s against 0.2 s paused
(measured on a GTX 1080 Ti, 2026-10-03; see `lib/render-loop.js`).

### Scenes and UI

| | |
|---|---|
| `await setScene(s)` | swap the scene; returns the milliseconds it took to compile |
| `tolerances(at = [0, 0, 0])` | the surface tolerance in use and every length made from it (`core/tolerances.js`), resolved at a point in scene units: each in metres and in the scene's unit, how it was chosen, f32's floor there. `hud.tolerance` is what Render stats › Picture and the Ray marching box show (`.line`, the box's text) |
| `updateScene({ envRadius, unit, extent, haze, tolerance })` | change what the scene says about itself that is not code, without a compile: its radius (scene units, `null` for the 400 m default), its unit, its extent (the automatic tolerance's size), its haze box's values and its surface tolerance (scene units, `null` for the automatic one; 0.66.0). Written into the scene object the engine holds, never a copy (the engine and hosts compare `RT.scene` to tell a scene change); returns the keys it refused |
| `installUI(shell, { onRefresh, pages, sections, untitled, omit })` | fill the renderer's pages. `pages` routes a named page to a different shell; `sections` routes one FOLDER (Show, Camera, Exposure, Environment, the Renderer panel's boxes -- Quality, Light sources, Paths and noise, Render size, Ray marching, Diagnostics -- Save an image, Tests, and Developer where there is no Quality box) to any property table. The boxes are `settingsui.js` `RENDERER_BOXES`, a list of its own rather than the schema's groups (a group is its settings' parameter path): **Quality** is the presets as buttons, Preview (Sketch, Draft) and Accurate (Standard, High) and Optics, with a line saying what the one in force traces or what Custom changed (`quality.js` `describe`); it is `renderMode`'s control. **Light sources** is a switch per kind of light and how it is traced -- the environment (lamps only, ticked when lit), the caustics of the sun and glowing surfaces (`lt`), the lights' rays (`lightRays`) -- and their photons per pixel, then a developer's light sampling, photon map and emitter search. A switch is a checkbox; every row's tooltip is its schema `gui.help`. A host gives the panel a table of boxes (GUISTUFF's `PropertyTable`, `boxes: true`) to draw each box outlined, with the icon the box names (`boxIcon`); the colours are `--pt-box-*` (`lib/shell/shell.css`). Every `gui.dev` setting, and the Ray marching and Diagnostics boxes whole, wait behind the **Developer** switch (remembered in localStorage): one line at the foot of the Quality box, with a count of those off their default (named in its tooltip) and Reset; a box of its own (section Developer) only for a host that places no Quality box. `test/renderer.check.mjs` runs the panel headless over the real PropertyTable. `untitled` lists sections whose table holds that folder alone: it goes in flat, since the panel or icon already names it (`sections.js`). `omit` lists settings the host shows its own way (the view's mode, as icons). A section given as `null` gets no folder at all (the raytracer's Environment: its scene document carries it). With every section placed, `shell` may be null. `build`, a function returning a line of text, heads every test and benchmark result with the build that produced it -- the raytracer passes its version and git revision (`version.js`) |
| `view()` / `applyView({ camera, exposure }, { fresh })` / `watchView(fn)` | **the view** (0.66.0): the camera's settings (not its aspect or planes) and every exposure setting, as plain data; put back (the camera only in the fields given, as `applySettings` does; `fresh` starts the auto-exposure meter again, for another picture); and a watcher told whenever either changes, by any way in -- a drag, a popover, a timeline, Meter / lock, a script -- from the camera's `onChange` and from `update()`. A host keeps its own copy per scene with them (the builder: `builder/model.js` VIEW, `demo.js` keepView). `cameraBindings()` / `cameraShown()` hand out the camera popover's fields and which of them show, for a host that shows them elsewhere too |
| `parameters()` (`params.js`) | the renderer's settings as entries for an application's parameter registry (`lib/shell/params.js`, the timeline's contract with a path for an id): `view/show/…`, `view/exposure/…`, `view/camera/…`, `scene/environment/…`, `renderer/tracing/…`, `renderer/advanced/…`. Each `set` goes the way its slider does (uniforms, the group's reset rule, the host's refresh). `GROUP_PARAMS` there is the one table of each group's path and reset rule, which `installUI` reads too |
| `installViewToolbar(stage, { PropertyTable, RT, tips })` (`viewtools.js`) | the view's own controls, icons with tooltips (`icons.js`), in two places (2026-10-02). TOP LEFT, the picture: the camera and the exposure, menus (a caret), then the quality, a menu named by the preset in force (Draft▾: the presets, the Quality box's line, what a move traces), and ⚡ fast while moving, a switch in a pill (moveFast: a full picture traced as moveMode, Draft or Sketch, while `RT.interacting` -- `interaction.js`, poked by the camera, a host's live values and its drags -- says something moves, in the live loop only; neither the exposure, the quality nor ⚡ in a false-colour view, which traces in full). BOTTOM RIGHT, the ANALYSE drawer behind one button: DISPLAY -- photographic / lux on surfaces / luminance, the lit one is the view, and the false-colour range there -- and the host's groups (`V.analyse.add`: the measure tool's MEASURE, the raytracer's RAYS); closed, its button shows what is on (`V.analyse.mark`), and what is on stays on. Returns the popovers' tables as `sections`, with `untitled` and `omit` for `installUI`, and `.open('Camera')`. What changes a VIEW sits on the view; the scene's light and the renderer's effort are the host's panels (roadmap/UI_PLAN.md section 8) |
| `strip.js` | a chart's own strip of controls (`chartStrip`: segmented choices, toggles, dropdowns, typed values, icon actions, all with tooltips; the raytracer's charts no longer use it -- their settings are in the Analysis pane), and `saveCanvases` / `saveText` for a panel's PNG and CSV |
| `icons.js` | the line icons and the one look of a strip of icon buttons over a picture or in a panel (`iconBar`, `iconButton`, `lit`, `enable`), and how switches and menus tell themselves apart: `iconPill` a set of switches in one outlined group, `menuButton` an icon with a caret, no outline: the view toolbar, the measure tool, the Builder's toolbar |
| `await pick(x, y)` | what is at a point of the picture, x and y in the ray kernel's [-1, 1], y up: `{ hit, tag, distance, pos, normal }`, or null if the scene changed first. One thread, one ray, nothing per frame; the kernel compiles on the first pick after a scene change (`core/pick.js`). `tag` is the scene's own numbering, from `pickWgsl` |
| `setHud(el)` | where the live readout renders. A **method, not a setter** — the facade is merged with `Object.assign`, which copies values, so an accessor would be read once and lost |

## The scene contract

```js
{
    id, title,
    wgsl,                   // fn SDF(r: Ray) -> Hit,  fn getMaterial2(...) -> Material2
    constants: {...},       // name -> {type, def, gui} -- baked into the source, RECOMPILES
    uniforms:  {...},       // name -> {type, def, gui, page?} -- merged into the shared struct
    resources: {...},       // name -> WGSL type, merged into every kernel that compiles the scene
    async init(gpu),        // create buffers, run one-off compute; returns name -> buffer
    dispose(),              // optional: free them -- called when another scene has taken this one's place
    writeData(data),        // optional: the scene's data written in place (the builder's scene as data)
    pickWgsl,               // optional: `wgsl` again, setting XF_TAG per part, for pick() only
    unit,                   // optional: 'm' (default), 'cm' or 'mm' -- what the scene's numbers are in
    extent,                 // optional: its size in those units, for the automatic tolerance
    envRadius,              // optional: where it stops and the sky begins, in those units (default 400 m)
}
```

**`pickWgsl` is how a scene says what was clicked.** The pick kernel compiles it in place of
`wgsl`; while it has capture on, `fold()` records the XF_TAG of the winning surface, and that is
the `tag` pick() returns. A separate copy because a tag store per part of the scene is a store at
every march step of every ray, and the render kernels should not pay for a click. Without it a
scene picks as tag 0. The scene builder's copy tags every node and carries `tags`, tag n being
node `tags[n - 1]`.

**What a scene writes against** is `SCENE_PRELUDE` (`core/scene_api.js`): the primitives,
`Ray`/`Hit`, the `Material2` constructors, and the three things every SDF is built from —
`emptyHit(r)` to start, `add_new(C, sdf, matId)` to fold each primitive in, and `MAT_AIR`
(id 0), the ambient medium, which `getMaterial2(C, true)` must answer with an IOR of 1. They
used to live in the host's `scenes/common.js`; `add_new` reads a renderer setting and every
scene carried its own copy of the starting `Hit`, so they are the renderer's now. The same
string is what the scene builder's compile probe uses, so "the probe compiles against the
kernel's prelude" is true by construction.

Code that bends space before folding — a twist, a bend, a mirror — calls `warp(k)` first:
distances folded in afterwards are scaled by `k` (below 1 for a stretching warp, so the march
does not step through the surface), and their analytic normals are dropped, so the shade kernel
takes one by differences instead. It works through `XF_S` and `XF_M`, so whoever set those up
puts them back; the scene builder does so at the end of the group whose code called it.

**A march only ever asks for a distance.** From 0.18.0 to 0.36.0 a scene could answer a march along
the ray instead (`SCN_MARCH`, `SCN_EXACT`: the scene builder's exact hits); that went in 0.41.0
(`roadmap/ARCHITECTURE.md`, Removed in 0.41.0), and every caller gets the
scene's distance, stepped `stepscale` of it.

**Constants and uniforms are visibly separate because the cost of changing one is nothing
and the cost of changing the other is three kernel compiles.** A uniform is poked and the
next frame uses it. A constant is baked into the source — so it can be a loop bound the
compiler unrolls — and moving it rebuilds every pipeline that inlines the scene.

That distinction has teeth. `scenes/menger.js` declares its iteration count as a constant
precisely so the compiler can unroll `sdMenger`; it is called three times per SDF
evaluation, inlined into three kernels. Raising it multiplies the compiled size. See
**Compile off-thread** below.

**Every call to `SDF()` is a whole copy of the scene**, because every compiler behind WebGPU
inlines every call, and a loop with a constant bound around one is unrolled into that many
copies. The march and occlusion loops had a constant 32 so they would unroll; with normals by
differences and a `localPoint()` per patterned material at every `getMaterial2` call, the Noise
library scene held about a hundred copies of itself and compiled for over a minute. Loops around
an SDF call now take their bound from `noUnroll(n)` (`core/tracebasics.js`: n plus `opaqueZero`,
a uniform that is always 0), and the builder captures the local point once per `getMaterial2`,
never on the medium lookup: a handful of copies per kernel. Whether the unrolled march was
worth its compile time in frame time is `cost-sweep`'s BASELINE to answer.

`page` on a uniform is a hint to the HOST, not to the renderer, which passes it through
untouched like any key it does not recognise. Without it every parameter a scene declares
lands in one list, and since the material override became a scene uniform that list is twelve
colour and roughness sliders with the geometry ones lost among them. Which tab a parameter
belongs on is the host's question — it owns the panel, and a host with different tabs answers
differently.

Values SURVIVE a scene switch where both scenes declare the same name, so the material
override does not snap back to its defaults every time you compare two scenes.

A scene's `resources` reach every kernel that compiles its WGSL: march, shade and occlude
(`raytrace_main.js` rebind), pick, field and tagfield (`core/pick.js`, `core/field.js`), and the
optics march and shade (`optics/kernels.js`, `optics/index.js`). The first scene to use them is
the builder's scene as data (0.10.2, `builder/scenedata.js`: one buffer of
records), and it found the path broken in four places, all fixed then: `rebind` assigned onto
`resources`, which tinywebgpu has as a setter only; `init` ran only in `setScene`, never for the
scene the renderer is constructed with (`R.init` calls it now); nothing freed the buffers of the
scene before (`setScene` calls its `dispose` once the new one is built, not before -- a failed
build puts it back); and the optics trace kept its pipelines, and the buffers bound to them, when
the same scene was set again. A scene whose data changes without its text changing is taken in
place by `updateSceneData`, which checks the text (`sceneTextOf`, `uniforms.schema.js`) and bumps
`sceneRev`: a pick or a box measurement under way when a scene's nodes are renumbered returns
nothing, as one under way across a `setScene` does. What imported geometry would need from this
path is in `roadmap/IMPORT.md` §1 and §7.

## The page around it

The raytracer's page lays itself out with `lib/shell` (`createShell`: a menu bar, docked panels, a status bar) and
hands the renderer its folders through `RT.installUI(null, { sections })`. An earlier host, `createViewport`
(`viewport.js`, with `lib/ui-shell.js`'s menu bar), floated the renderer's controls over the picture; `lib/shell`
replaced it on 2026-09-27, and the two files went in 0.22.3, nothing having imported them since.

## Units

Light is physical. `core/photometry.js` is the whole of the arithmetic, and its test
(`core/test/photometry.test.mjs`) executes every line of it.

- **The buffers hold linear Rec.709 RGB whose luminance Y is in cd/m².** Illuminance is in lux.
  A colour anywhere in the settings is a hue normalised to Y = 1; a separate number carries the
  magnitude.
- **The sun** is its direct normal illuminance (`sunIlluminance`, default 100 000 lx) and its
  angular diameter (`sunDiameter`, default the real 0.53°). The disc's luminance is derived from
  both on the host, in double precision, so the size changes the shadow's softness and not the
  picture's brightness. The disc edge is hard and tested as |L×S|² ≤ sin²θ, which keeps its
  precision where a cosine test does not. Below the horizon the sun is off.
- **The sky** is the illuminance it alone puts on a horizontal surface (`skyIlluminance`,
  default 15 000 lx). The scattering model gives its shape; `prog_skynorm` integrates that model
  over the hemisphere on the GPU — the same WGSL function the tracer calls — and `skyScale` makes
  it deliver exactly the setting. `R.ensureSky` re-measures before any frame whose sun position
  or turbidity changed, before `beginFrame`, so no sample is traced with a stale scale. trace()
  reads the reset flag before that await: the host clears it right after the call.
- **The studio light** (`envMode` 1, the first setting under Lighting) replaces sun and sky with
  L(d) = L0 (1 + top·d.z): even from everywhere, brighter from above by `studioTop` (0 flat, 1
  black straight down). L0 is derived (`photometry.studioLuminance`) so a level surface facing
  up receives exactly `studioIlluminance` lux whatever the top share, and `studioColor` is a
  tint normalised to luminance 1. No sun, so no sun samples: `neeSunPick` is derived to 0
  whenever the sun is off (studio, furnace, below the horizon), and the mixture pdf reads the
  same number. The bench always starts from sun and sky; the `illuminance` bench has studio rows.
- **Emitters** are a hue and a luminance in cd/m² (the builder's `emissiveLuminance`). Not
  lumens: an SDF has no surface area to divide by. Discovery ranks emitters by a log-encoded
  brightness (`LUM_CODE` in `tracebasics.js`); the linear code it replaced saturated at
  1e5 cd/m².
- **Light tracing needed no formula change.** A sun photon's flux is radiance × cos × Ω / (N ·
  area pdf), and the camera connection's G = |n·v|·dist/z³ cancels the area, so it is right in any
  length unit once the sun's radiance is.
- **The display** divides by the luminance that clips at the exposure's EV100, applies a tone
  curve (`toneMap`, a dropdown: clip, Khronos PBR Neutral — the default, hue-preserving — AgX,
  AgX punchy, ACES fitted, Reinhard on luminance, Hable filmic; `rendertoscreen.js`), and
  encodes sRGB. The EV is **metered on the GPU** by default (`autoExposure`,
  `core/autoexposure.js`): a log-luminance histogram of the accumulation, the middle 10–90%
  averaged in log space, turned into EV100 by the same meter formula as the host's
  (`EXPOSURE_WGSL` in `photometry.js`), and eased by `aeSpeed` so a noisy frame after a move does
  not make it shimmer. Black (below 1e-3 cd/m²) does not vote. **Highlight protection:** the
  brightest 5% may sit at most `aeHeadroom` stops (default 2) above white, or the exposure darkens
  -- an average meter alone exposes a lamp-lit scene for its dim majority and blows out what the
  lamp reaches. It never brightens; 12 is effectively off. `exposureComp` is in stops. The HUD shows the metered EV100. **Meter /
  lock** copies it (or, with auto off, the median's EV) into the manual `exposureEV` and turns
  auto off.
- **The frame and splat buffers are f32**, added by compare-and-swap (`depositWGSL` in
  `wavefront.js`). The u32 fixed point they replaced
  could not hold a sunlit wall, and the 1e4 clamp that protected it is gone. `fireflyClamp`
  (0 = off, the default) is the one knob that biases on purpose. It is in multiples of the
  display white -- the luminance the exposure, metered or manual, maps to 1.0 (`fireflyWhite`) --
  never below 1x, and never applied to what the camera sees directly. It was in cd/m², where
  any value low enough to touch a firefly also capped every sunlit surface. NaN, infinite and
  negative-luminance contributions are dropped and counted (`NON-FINITE` on the HUD). A negative
  CHANNEL is kept: it is an exact colour outside the Rec.709 gamut (a royal-blue LED given by its
  chromaticity, `core/colorimetry.js`), and a mix of such lights is only right if their exact colours
  are added. The display clips into the gamut once per pixel (`gamutClip`, luminance kept).

**The scene unit.** A scene says whether its numbers are metres, centimetres or millimetres
(`scene.unit`, default `'m'`; builder document version 6), and the host turns that into
`UB.sceneUnit` and `UB.perMetre`. **The engine works in metres** (since 0.36.0): rays, hits, the
camera as the kernels read it, photons, light faces, the step cache and the optics trace. The scene's
own code stays in its unit, and the engine meets it only through the boundary in `core/scene_api.js`
(`sceneAt`, `materialAt`, `lightFaceAt`, ...), which `core/unitlint.js` holds in check-shaders.
**Radiance has no length in it**, so the unit never changes a lux figure, and **f32 is relative**, so
it changes no precision either: distance from the world origin does. **The scene's radius is the
scene's own** (`scene.envRadius`, in its units; 400 m when it gives none; since 0.9.0): where the scene
stops and the environment begins, read off the scene the engine has into the derived `UB.envRadius`,
in metres (`photometry.js envRadiusMetres`); `updateScene` changes it, the unit and the extent live.
**The surface tolerance** is the scene's (`scene.tolerance`, in its units, since 0.66.0; none =
automatic: 10⁻⁴ of `scene.extent`, `photometry.js sceneEps`, `autoEps`), carried as `UB.epsAuto` and
changed live by `updateScene`; `eps`, metres, is an override with no control that a bench row sets. It
is one number at a point, never finer than f32 resolves there, and every other tolerance is a multiple
of it. **`lib/pathtracer/PRECISION.md`** is the whole of this: who is in which unit, the
tolerance and its floor, every use of it (`core/tolerances.js`, printed by `node
lib/pathtracer/core/tolerances.js`, resolved for the scene showing by `RT.tolerances()`), what f32
allows in micrometres, and how large a scene can be. The `scale` bench checks a glass sphere in m, cm
and mm gives one picture.

**Measuring is not displaying.** Every number above is read from the linear accumulation, never
from displayed pixels. The `photometry` bench row renders a white floor under sun and sky and
compares its mean luminance with ρE/π — the first test here with an absolute answer.

**Every pixel carries an error bar.** Beside the mean colour, resolve keeps per pixel the weighted
variance V of its samples' luminance and S = Σw², the sum of the squared weights still in the
average, both on the mean's own weight w = 1/cnt (THE ERROR BAR in `wavefront.js`; the formula
and a JS mirror in `core/measure.js`). The standard error of the pixel's luminance is
√(S·V/(1−S)): exact for a true mean (S = 1/n) and for an EMA window, whose worth settles at
2N+1 samples, not N. The HUD shows the pixel under the cursor as cd/m² ± % with that worth as n,
also while the loop is paused; `measure(x, y)` returns the same reading to a script, and
`RTSTATS()` carries it. The `error-bar` bench checks the bars against the picture: on the flat
photometry floor neighbouring pixels differ only by noise, so their mean squared difference must
equal their summed squared errors (`seRatio` = 1).

**The illuminance view** (Measure group, `measureMode` 1) shows lux on every visible surface. The
camera's first hit becomes a white Lambertian for that one bounce (`tracebasics.js`), so the
light it sends back is E/π whatever the surface is; the display multiplies by π and draws a
logarithmic false colour (turbo) from `measureMin` to `measureMax` lux, in `measureBands` bands,
with the scale as a strip along the bottom edge. Everything after the first bounce is the real
scene: reflections, glass, emitters count. Light tracing's camera connection evaluates the same
white surface, since the vertex it connects is the camera's first hit; a camera ray that hits
nothing shows 0. The cursor line and `measure()` then read lux, with the same error bar. The
`illuminance` bench checks it against E_sun sin h + E_sky on the photometry floor made dark,
mirror and glass.

**The luminance view** (`measureMode` 2) is the picture itself, real materials and sky, on the same
false-colour scale in cd/m² instead of exposed: a glare source or a dim corner reads as a number.

**The measure tool** (`measure/tool.js`, the MEASURE group of the view's analysis drawer, bottom right) does the reading:
- **Pin:** click a surface and a reading stays there. The click is picked, so the pin follows the
  surface when the camera moves and re-reads as the picture converges; a click on a pin removes it.
- **Area:** drag a rectangle for its mean ± standard error, min, max and U0 = min/mean
  (`measureRegion`, `core/measure.js regionReading`). The mean is over pixels, which on a surface
  seen at an angle weights the far part more than an area average would; square-on it is the area
  average. Its error bar is null until every pixel in it has one.
- **Colour:** every reading also carries its chromaticity (`core/measure.js chromaOf`): CCT + Duv near
  white, CIE xy away from it. In the illuminance view that is the colour of the light arriving there,
  what a colour meter on the surface would read; in the picture, light times surface. An area gives
  the colour of all its pixels added, and their spread from it (Δu'v', max and rms, over the pixels at
  10% of the brightest or more).
- **CSV** saves both, colour included; `window.MEASURE.readings()` gives them to a script.
- In either false-colour view it numbers the strip: band edges for up to 12 bands, decades beyond.
Values are lux in the illuminance view and cd/m² otherwise.

The Optics page's **detector map** has its own smoothing (`optics/detmap.js`): Gaussian or
Epanechnikov kernel density estimation with a width in cells (each hit deposits exactly its flux),
or the photon-map estimate from the k nearest hits, which adapts its reach to the hit density.

## Materials

`core/materials_pbr.js` with `core/microfacet.js`. One layered model, every lobe with an exact
pdf, so light sampling and BSDF sampling can be weighted against each other honestly.

- **Specular is GGX** with the height-correlated Smith G2, sampled by its visible normals (the
  spherical-cap VNDF of Dupuy & Benyoub 2023), pdf G1(o)·D/(4 o.z). Roughness below
  `ALPHA_MIN` (1e-3, one constant, used everywhere) is a delta: a mirror, not a very sharp
  lobe, and it counts as "light sampling could not have produced this" for MIS.
- **Fresnel is the exact dielectric one from `ior`**, not Schlick. `specular` scales it (0.5 is
  physical, 0 turns the coat off); transmission takes the coat to full Fresnel, since glass has
  nothing else. Metals keep a Schlick F0 from their colour.
- **Energy is conserved between the lobes.** The diffuse base sees only what the rough coat did
  not reflect, by the Kulla–Conty coupling base·(1−Ec(o))(1−Ec(i))/(π(1−Ec_avg)); rough metal gets
  back the multiple-scattering energy single-scatter GGX loses (1 + F0(1/E − 1)). The tables Ec,
  Ec_avg and E are integrated **on the GPU at init** (`prog_mf_lut`, `prog_mf_lut_avg`) into the
  tail of the `learn` buffer: the shade kernel is at the eight-storage-binding floor and has no
  room for another one. An ANISOTROPIC lobe reads tables of its own, with two more dimensions --
  the ratio of its alphas and the direction's azimuth from the rough axis -- because its albedo
  depends on the azimuth and matches no single isotropic roughness (`roadmap/SURFACES.md`
  phase 1b).
- **A coating replaces the Fresnel** (0.39.0; `Material2.coat`, `core/spectral.js`): a thin-film stack -- a
  dichroic, a beam splitter, an AR layer -- given as R(λ), coatLow below an edge and coatHigh above it, a logistic
  edge coatWidth nm wide at coatEdge nm, moving to shorter wavelengths with the angle through the stack's effective
  index (edge·√(1 − (n₀ sin θ₀ / n_eff)²)). Each channel reflects R averaged over that channel's wavelengths (the
  CIE 1931 CMFs in Rec.709, negative parts clipped, in 10 nm bins; a logistic integrates exactly over a bin).
  Exact for an R that is the same at every wavelength; for an edge it assumes each channel's light is spread as its
  weights say, whatever the source emits. On the faces light enters by; those it leaves by are AR, bare or coated
  alike. A coloured coating picks reflection by what the RAY carries (`coatPick`): a red ray reflects as often as
  red does, with weight 1. Evaluated once, at the view's angle -- exact for a smooth coating; a rough one's glossy
  lobe is not compensated for single-scatter loss.
- **Dispersion** (0.40.0; `Material2.abbe`, `core/spectral.js`): an Abbe number beside the index (n_d), n(λ)
  Cauchy's through both. A ray refracted INTO a dispersive medium draws a wavelength there and weighs its channels by
  it (mean 1 in each); every index it meets after is n(that wavelength). It rides in `Ray.tag`'s upper 16 bits
  (`TAG_LAMBDA_MASK`: a new flag stays below bit 16). The pick and Fresnel at that first refraction are the d line's,
  so reflections stay white.
- **Transmission** refracts with the same IOR (the ray's current IOR from the path, the other
  side's from the material, or an SDF probe for glass), reflecting by the exact Fresnel. Rough
  transmission is SAMPLED (a facet from the visible normals, then reflect or refract by that
  facet's Fresnel, as Walter et al. 2007) but not EVALUATED: NEE and light tracing do not
  connect through it. Single scattering loses what masking takes at grazing angles inside, so
  rough glass reads a little under 1 in the furnace.
- **Anisotropy runs along a grain**, `Material2.tangent` (world space; `roadmap/SURFACES.md`
  phase 1). `makeLobes` projects it onto the surface and builds the one frame that eval, pdf,
  sampling and light tracing's `ltConnect` all use; with it, positive anisotropy is smooth along
  the grain and rough across it, as brushing is. Zero is the old frame from the normal alone,
  horizontal in the world, with the old unsigned anisotropy, so nothing written before it moved.
  `grainAlong` / `grainAround` / `grainRadial` (`core/materials.js`) make one from the object's
  frame, which `localPoint()` now records as `HIT_FRAME` (and its scale as `HIT_SCALE`) with the
  point. `streaksAlong` / `streaksAround` vary a material per brush line, from `srfNoise`, a value
  noise that is a pure function of position: every caller of `getMaterial2` must see the same surface.
- **Noise for surfaces** is `core/noise.js`, in the scene prelude: value, gradient, fBm and Worley,
  each with its analytic gradient and a Lipschitz bound that is proved or measured, never asserted,
  and checked by `core/test/noise.test.mjs` through a JS mirror. A displacement divides its distance
  by 1 + amplitude x frequency x bound, or the marcher steps through the surface.
- **`makeDiffuse` is a pure Lambertian** (`specular 0`). The per-bounce throughput clamp at 10 is
  gone, and so is `clearcoat`, which nothing ever read (builder document version 7 drops it).
  The `model` field is no longer read either: every material takes this path.

The known answers are `furnace` (a sphere of albedo 1 in a uniform environment, `envUniform`, must
disappear: ratio 1) and `bsdf-parity` (each material with NEE on and off must agree, which only
happens when eval, pdf and sampling are one BSDF).

## How light gets found

The strategies, and the useful way to hold them is that each one knows something the others
do not.

**BSDF sampling** knows the surface. It asks where this material likes to scatter and sends a
ray there. It is the only strategy that can follow a mirror or a smooth refraction, because
those are delta lobes — one direction with infinite density — and nothing else can propose a
direction that satisfies them. It is also the only one that needs nothing set up.

**Light sampling (NEE) with MIS** knows the lights. At every non-specular vertex it aims a
shadow ray at one and weights the two strategies against each other with the power heuristic,
so a small bright sun stops being a firefly. One pick chooses among three: the **analytic
environment** (the solar disc and the sky); the **emissive surfaces** discovery has found, with
`neeEmitShare` (*Emissive surfaces as lights*, below); and, on the camera's own paths, a
**light's face**, with `FACE_NEE_SHARE` (below, after the lights' split). Each keeps what the
ones before it leave, in its density and in the weight a BSDF hit on it gets. Until the second
arrived it was the environment alone and emissive geometry was found by BSDF sampling alone,
which is why the `nee` bench's older numbers say what they say; its note records it.

**NEE cannot apply to a delta lobe, in this or any renderer.** There is no way to weight a
light sample against a strategy whose density is infinite at one direction and zero
everywhere else. So a shadow ray that meets a glass sphere is blocked, and glass casts a
shadow where it should be casting a caustic. That is not a bug in the MIS code; it is what
the estimator can express. Light tracing, below, is the answer for caustics landing on a
surface the camera sees directly.

### Light tracing (`lt`)

**Walks from the sun instead of from the eye, for caustics.** Each photon is a direction in the
solar cone and a point where it crosses a square of half-size `ltRadius` through the origin,
facing the sun; it starts far back along that line, at `envRadius` (the scene's radius), where by
contract nothing is. It goes through glass and off mirrors exactly (Snell, Fresnel, the material's own sampler),
and at each surface after the first delta event sends a shadow ray to the camera. What that ray
carries is photon flux × the surface's evaluable BSDF × a geometry factor that converts area on
the surface to area on the image plane, divided by the pixel's area there. It lands in its own
`splat_u32` buffer, which resolve adds once per sample rather than averaging it with the camera
paths.

**It is a split of path space, not a second opinion.** The light tracer owns exactly: sun →
one or more delta events → a first visible vertex, where it counts that vertex's evaluable
part — *and only along lines that cross the square*. The camera side marks the class as it
forms (`CLS_CAND`, `CLS_SPEC` on `Ray.tag`) and, on escape, gives it the sky but not the disc,
if `ltCovers` says a photon could have come down that line. Both sides classify with the same
`EV_*` the material sets per branch and test the square with the same function, so they cannot
disagree about the boundary. Nothing is weighted: each path is counted once, by one side, so
switching `lt`, or moving `ltRadius`, must move the noise and not the mean. The `lt` bench row
checks both.

**`ltRadius` is therefore an efficiency setting, not a correctness one.** Glass outside the
square keeps its caustic on the camera side, noisy but present. **Never wider than the scene's
radius** (since 0.9.1): the kernels read `UB.ltHalf`, the setting capped at the scene's radius,
worked out once on the host (`photometry.js photonHalf`) so the generator and `ltCovers` read one
number. Nothing lies beyond the radius, so the cap loses nothing; it is what makes the learned
128 × 128 map useful in a small scene, whose 25 cm would otherwise sit in a few of the 15 m
square's 23 cm cells (bench: `small-caustic`). The learned state is forgotten when the square or
the emitter grid changes size (`R.trace`), as on a scene swap. (The first version emitted
from a disc and handed over every such path regardless; glass outside the disc lost its caustic
outright. Parametrising photons by where they cross the scene, rather than where they start,
is what made the test exact.)

**Where photons go is learned.** The square is a 128 × 128 map. Every photon counts itself
against its cell (`ltEmit`); every camera connection it makes counts against the same cell
(`ltHit`, carried in the photon's `pix`, since a photon has no pixel). Every four samples
`prog_lt_build` turns hits per photon into a row CDF and per-row conditional CDFs, mixed with a
uniform floor (`LT_FLOOR`, 20%) so no cell is ever unreachable, and halves both counts so the
map forgets and follows a moving sun, camera or scene. Photons divide by the density they were
drawn from, so the map decides the noise only. `RT.ltStats()` reads it back: `topCellShare`
well above 0.01 means the busiest 1% of cells get far more than 1% of the photons — the map
has found the glass.

What stays on the camera side, and therefore noisy: caustics seen *through* glass or in a
mirror (the first vertex is then a delta, which cannot be connected through), sky light
through glass, rough refraction (no evaluable BTDF here), GGX narrower than `LT_MIN_ALPHA`
(a firefly to connect to), and **all light from emissive geometry** — these photons come from
the sun only. With emitters in the scene nothing is wrong, they simply get no help from these;
emissive objects have photons of their own (*Emissive surfaces as lights*), and so do lights (next).
Every photon asked for is sent at any size: a sample with more rays and photons than the ray
buffer holds runs in batches (*A sample in batches*, below). Until 0.38.1 the camera rays came first,
and at the ray cap (about 2.3 Mpx) they used the whole budget and `lt` was off for the frame -- a
large save lost the light through its glass. It sends none while there is **nothing to send them from**: no sun (the
studio light, night, lamps only) and no emitter found yet. They would all be sun photons carrying a
luminance of 0 -- a march and a connection each, for nothing (read in code; the cost was never
measured). They start once a camera path has found an emitter.

The emission and connection math was checked on the CPU against a diffuse plane in direct sun
— perspective and orthographic, uniform and deliberately lopsided maps — to within 1% of the
analytic radiance. The split itself needs the bench, on hardware.

**A light's face has a split of its own** (PLAN.md L4). A light's photons (`R.photonSources`, the
optics module) connect at every surface they land on, through the evaluable lobes, from air. So a
camera path whose first surface scattered that way, in air, is marked `CLS_LIGHTS` -- only in a frame
where those photons run (`ltLights`) -- and a light's face shows it nothing; every other camera path
(through a mirror, glass, a diffuser, gloss below `LT_MIN_ALPHA`) counts the face where it meets it,
over n² of the medium it meets it in. Without the photons the camera side counts lights on every
path. Except for DIRECT paths (the face met at bounce 2, right after a first surface a photon can
connect from, whatever its lobe): both sides make those, and which does it better depends on the
light's size against the lobe's width, so they are shared by the balance heuristic (PLAN.md L4b).
The ratio of the two densities is R = Le |cos x1| A_px / (flux per photon · G_cam · pdf_bsdf); the
camera carries all of it but Le from its first surface (`Ray.ltMis`), the face completes it and keeps
1/(1+R), the photon's first connection keeps R/(1+R). A source no camera path can meet (no face, or
collimated) has its photons connect through every lobe they can evaluate, at every surface. The
`light-vs-emitter` bench holds a light against the same disc as an emissive object, pair by pair.

**The camera's own paths aim at a light's face** (PLAN.md L7). Photons connect only to the camera,
so a path the camera owns -- past a mirror, gloss below `LT_MIN_ALPHA`, glass -- reached a light
only by hitting it, and a small one almost never: the floor a lamp lights, seen in a reflector,
looked dark just below the cutoff and appeared above it (the photons' side of it). Where the path
is the camera's (no `CLS_LIGHTS`, past its first surface, or at it too in a frame that runs no
light photons), light sampling picks a face with `FACE_NEE_SHARE`, by its weight, and a point
uniform on it. The faces are the scene's own WGSL, which codegen writes from the builder document
(`LIGHT_FACES`, `lightFace(i)`, `lightFaceTotal`, `lightFacePick`, `lightFaceLe`): each face's
world frame is composed from the same transform uniforms the SDF reads, so the face sampled and the
surface hit cannot disagree about where the light is, and its weight is 0 when it or a parent is
hidden, or it is collimated. A scene with no lights gets a stub (`sceneConstantsWGSL`). The shadow
ray (`TAG_FNEE`) stops short of the point, as a photon's connection does, and a face a BSDF sample
meets is weighed against the same `lightFaceDensity`, by the power heuristic -- once, after the
material switch, not in each face's case. A GPU compiler inlines every call, and `lightFace` is a
switch over every light: called from every face's case, it was code the square of the number of
lights in every kernel that asks for a material. So the sum and the pick are one line a light, and
a face is fetched once (codegen.test checks the calls are as many with 8 lights as with 2). Not at
the first surface while photons run -- those paths are the photons', or shared with them above, and
a third strategy there needs a three-way weight -- and not through glass: a shadow ray stops at any
surface, so a die inside its dome is still found from outside by chance.

**The camera's lens (0.43.0; `core/lens.js`).** With an aperture the camera is a thin lens -- a disc at camPos, square
to the axis, focused at a distance -- and its rays start on the disc and pass the pinhole's ray at the focus plane:
depth of field. Connections (`ltConnect`) go to a point of the disc, the footprint measured from there. From 0.43.0 to
0.60.0 the lens was also a way for light to find the camera: a photon that crossed the disc after glass, a diffuse
surface and glass again added itself where it crossed (`lensHit`), and the camera's paths left it that class. It counted
the class only when a photon happened to cross the disc -- the white specks in the user's picture of 2026-10-15 -- and
went in 0.61.0, when the photon map (below) went on by default and owned the class through any aperture or none.
**The manifold connection (0.44.0 to 0.60.0)** went with it: a photon landing on a surface *inside* glass joined to the
camera through one refraction, found by Newton's method on the face in the surface kernel (12.7k characters of WGSL
there, and 16 bytes of every shade-queue item). The map gathers that light too, through any chain of glass and mirrors.

**Through glass and mirrors, the photon map (0.60.0, on by default since 0.61.0; `core/sppm.js`).** The class light ->
delta+ -> D -> delta+ -> eye -- a floor in air behind a glass pane, lit through it and seen through it (the user's picture,
2026-10-15), a ball's caustic seen through the ball, a beam's spot seen in a mirror -- is gathered: probabilistic
progressive photon mapping (Knaus & Zwicker 2011). A sample traces its photons first (`photons.js planBatches`'s
`first`), and a kernel of its own between the surface kernel and shade (`wavefront.js prog_sppm`) STORES every photon that
has passed a delta event where it lands on a surface with an evaluable lobe (its field of the tag 0, `TAG_PASSED`), in a
hash table of linked lists two radii a cell; then the sample's camera rays, each one that has seen only delta events
since the eye (its field 1) GATHERS there, `f Phi / (pi r^2)` over the evaluable lobes for the photons within r, over n^2
of the medium it is in, and the camera's path leaves the class to the map (`lensOwned`; the class is named for the lens
that owned it first). The radius is `sppmRadius` pixels at the distance in focus at the first sample and shrinks every
sample after (`r_k^2 = r_1^2 prod (i + alpha)/(i + 1)`, alpha 2/3): a little blurred at first, consistent as the samples
are averaged. A merged path counts only if the camera alone could have made it (`b_c + b_p - 1 <= maxbounce`). In Draft
and Optics too, where the camera's path ends at the surface it gathers on, so the map adds what nothing there counts
(Optics stores every one of the lights' photons). Not in Sketch, the illuminance view or an orthographic camera.
A LIGHT NO CAMERA PATH CAN MEET (0.61.0: collimated, or no face; `Ray.ltMis < 0`) has its photons stored at every surface
they land on, glass passed or not, and gathered through every lobe (`SPPM_ALL`): a beam on a floor seen through glass.
IDLE (0.61.0): a gather marks the map's header; a whole sample in which no camera ray gathered makes the traces after run
without it, one chain, until a probe every 16 traces (`SPPM_PROBE`) or a new size, mode or scene -- so a scene with no
glass in view does not pay for it (Render stats: *Photon map: idle*). It does not run at all without photons.
NEITHER FULL NOR CUT (0.61.3): a sample that would overfill the map keeps each store with the probability that fits, its
power over it, and a cell too full to walk is walked by some of its 32 sub-lists, each record found weighing what the
others would have -- both exact in expectation, where the stores past the capacity were dropped and the gathers cut at 512
records. On the dichroics bench's scene, at 1280 x 720, that had the light the map brings through the plates at about a
third of what it is (measured on Dawn, an RTX 3080 Laptop, against an exact map: `docs/PERFORMANCE.md`).
What it costs: on the dichroics bench (the user's card, Ampere, 2026-10-16) 22.7 ms of a 196 ms sample at 1280 x 720, its
own kernel 16.2 of them; and 44 bytes a photon (`sppmCapacity`, 2 M: 88 MB) and 12 MiB of lists. Not covered: with dispersive glass the camera's wavelength and the photon's are drawn apart,
so a spectrum seen through a prism is mixed (inferred, not measured).

### Emissive surfaces as lights

**Nothing is declared.** Any surface whose material emits — the showcase's orange/petrol sphere,
whose colour depends on where it is hit — becomes a light the renderer aims at, found by the
paths that see it.

- **Discovery.** Every camera path that hits an emissive surface records the hit in a 16³ grid
  over ±`emitHalf` (`emitRadius`, capped at the scene's radius like the photon square): the tight
  box of hits per voxel, and the brightest emission seen. A box is aimed at through its bounding
  sphere padded by the step off a surface (`emitMargin` 0 = automatic; it was a fixed 2 cm, four
  times the size of a 1 cm emitter -- bench: `small-emitter`).
  Every two samples, `prog_emit_collect` / `prog_emit_publish` turn occupied voxels into a
  snapshot list of up to 64 boxes (bounding sphere, probability ∝ brightness × size²). Voxels
  fade out when no path hits them any more. **A light's face is never discovered** (the builder's
  light objects: `lightTraced` on its material, `core/materials.js`): its light reaches the picture
  through its own photons and the camera paths they cannot reach (the split above), every strategy
  here sees it black, and listed it only wasted light sampling and turned light tracing's photons
  into probes that could not start on it.
- **NEE toward emitters, with MIS.** With probability `neeEmitShare` NEE picks a box and a
  direction inside the cone its sphere subtends. The shadow ray (`TAG_EMIT`) then asks the
  scene's own `getMaterial2` what the first thing it hits emits — so emission that varies over
  the surface is evaluated where it is, and a box with nothing along that line returns nothing.
  It divides by the whole mixture's density (`emitConePdf`), and a BSDF ray that hits an emitter
  is weighted against that same density, recovered from where the previous vertex was
  (`prevPdf`, `vtxLtot` on the Ray, which made it 112 bytes). **An emitter not yet discovered
  has NEE density 0, so its hits keep weight 1: the picture is unbiased from the first sample**
  and only gets less noisy as the list fills.
- **Photons from emitters, for their caustics.** A probe runs along a uniformly random line
  through one box's sphere, from the far end back. It passes through anything that is not an
  emissive surface seen from outside; at the first that is, it becomes a photon leaving along
  the line. A random line crosses a surface with density |n·ω| dA dω / (4π²r²) — Crofton — which
  is the Lambertian emission measure itself, so the flux, Le / (probes · Σ P_b/(4π²r_b²)), is
  exact with no knowledge of the shape. Taking the first emissive hit from the far end is exact
  because anything further back emits into this emitter, which absorbs it; passing through
  non-emitters means a lens hugging an LED is refracted through, not mistaken for the source.
  The camera side hands an emitter hit in the caustic class to the photons only if a probe
  could have started there (`emitCovers`), so the split is exact whatever has been found.

One `learn` buffer holds the photon-map counts, the discovery grid and the emitter list, so
`prog_shade` stays at 8 storage bindings.

Checked on the CPU with awkward boxes — one covering part of the emitter, one all of it, one
empty, two overlapping — and emission varying over the surface: NEE + MIS 0.996 of a BSDF-only
reference, probe-photon irradiance 0.99 (±1.5% run to run). On hardware: the `emitters` bench.

### Draft, Sketch and Optics: stopping at the first real scatter

**Fast modes for building a scene rather than judging its light** (`renderMode` 1, 2 and 3, the
Quality presets, `quality.js`). Camera paths only: a photon, a probe or an optics ray is never in
one. The **measuring views ignore them** and trace in full (`effective`): a lux reading that is
quietly the direct light only is the worst kind of wrong.

**The rule is light tracing's split, turned round** (`materials_pbr.js` FAST MODES). At a surface
met from outside, the light added there is counted over the **evaluable** lobes (`lobesEval` from
`LT_MIN_ALPHA`: the diffuse base, glossy reflection at alpha >= 0.05), and the path **ends** if
the lobe drawn is one of those (`EV_EVAL`). It **goes on** through everything else: mirrors and
clear glass (`EV_DELTA`), near-mirror gloss and rough refraction (`EV_OTHER`) -- so frosted glass
and diffusers stay lit, and a polished surface still reflects. Inside a solid nothing is added and
everything goes on (a shadow ray from there meets the solid's own wall). A path that goes on goes
along a lobe nothing at the vertex counted, so it collects what it meets in full (prevPdf -1,
sunmis 1), and nothing is counted twice. What is left out is the bounce light.

- **Draft** adds NEE there, **at weight 1**: the BSDF ray that would have carried the rest of the
  direct light under MIS is never traced. Light tracing stays as set -- its photons connect at
  exactly the first evaluable vertex, which Draft's paths end at and never count past, so an LED
  behind its lens still lights the floor. Emitters are discovered only by camera paths that hit
  them, and a Draft path stops at the wall a hidden lamp lights, so a share of the paths that end
  (`draftSeek`, 1 in 8) go one segment on as **seek rays** (`TAG_SEEK`): no light on them, only
  `emitDeposit` if what they hit emits.
- **Sketch** adds a fixed light instead -- a headlight, a top light and a fill along the normal,
  scaled to `sketchE` (what the environment puts on a level surface, `photometry.js derive`) --
  and traces no shadow rays and no photons. It settles in a few samples and says nothing about
  the scene's light.
- **Optics** (`renderMode` 3, the last preset) is Sketch's camera side with **the lights' rays** on
  top: the photons of the builder's lights (`R.photonSources`), which Sketch leaves out, walk through
  mirrors, glass, gloss of any roughness and rough refraction, connect to the camera at every surface
  they land on, and **end at the first diffuse lobe they draw** (`LAST_DIFFUSE`, `tracebasics.js`).
  So: the shapes in a flat light, and where the optics put the lights' light, with no bounce light to
  blur a beam's edge. The flat light is `opticsFlat` stops below Sketch's (0 is Sketch's; -12, the
  slider's left end, is none -- the lights alone; it starts at -4, a choice not yet seen), so a beam
  weaker than the daylight still shows.
  No sun photons, no light samples, and an emissive *material* only glows: the rays are the lights'.
  The camera side counts a light's face where it meets it (straight on, or past a mirror, glass,
  near-mirror gloss), the photons what lands on the evaluable lobes, so nothing is counted twice.
  A beam's spot looked at in a mirror or through a lens is a connection through a delta, which no photon
  can make (as in Draft): the photon map (above, on by default since 0.61.0) gathers it there.

**No MIS between a light's photons and the camera in a fast mode.** The lights' direct paths are
shared by the balance heuristic in full (`Ray.ltMis`, PLAN.md L4b), which assumes the camera's path
goes on from its first surface to the face. A fast path stops there. So in every fast mode the photon
keeps the whole of what it connects through the evaluable lobes and the face the whole of what is
met past the others (read in code, 2026-10-02: before this, Draft kept only R/(1+R) of a light's
direct light on a diffuse surface from the photons and nothing from the camera -- dark by 1/(1+R),
most for a large panel, least for a small die; not measured).

**Known limits** (inferred, for the bench to test): a hidden lamp's light arrives once the seek
rays have found it, a sample or two in; a rough metal's sky is grainier than in full, cosine
samples being a poor fit to a narrow lobe. `render-modes` checks Draft against full on a floor
that has no bounce light (they must agree), `draft-lamps` the seek rays, `optics-mode` the Optics
view's rays against the lux arithmetic (with the flat light off a lamp's floor must read what full
reads), `light-vs-emitter`'s Draft pair the photons' whole share, `render-modes-cost` what each
preset costs.

**Lamps only** (`lampsOnly`) is the other view override: the sun, the sky, the studio light and the
furnace's uniform light at zero in the bag, NEE aimed at the emitters (`neeEmitShare` 0.95). The
scene's environment is not touched, so the builder's Environment shows and keeps it.

### Dust in the air: a haze box (0.62.0; `core/haze.js`)

**A homogeneous participating medium in the air inside one box**, the scene's (`scene.haze`, from the builder's haze
box: `builder/hazebox.js`). It has a grey extinction σ_t = 1/mfp (the mean free path, in real metres), an albedo per
channel, and a Henyey-Greenstein phase function of asymmetry g (|g| ≤ 0.95). Only air scatters: a ray whose medium's
index is not 1 never sees the haze, so glass and water inside the box stay clear. Nothing beyond the scene's radius
scatters either. That keeps the sun's photons, which start on it, and a camera path escaping along the same line
seeing the same haze. The values are DERIVED uniforms (`hazeC/U/V/W/A`, metres), live through `RT.updateScene`.
Whether there is a box is the kernels' text: the march, shade and occlusion kernels carry the code only for a scene
with one (`wavefrontKernels`). Without one they are the text they were.

**Free flight, drawn as a leg starts** (the user's own sketch: "if a ray has moved XX, random chance it met a particle;
move back YY"). A path ray's `tmax` was free: it is a shadow ray's and a probe's field. So at a leg's first march pass,
where the ray is, the march draws the collision on the line's stretch inside the box, t = t0 − ln(1 − u)/σ_t, and keeps
the ltot it falls at in `tmax` (`hazeDraw`, its own random stream; −1 for none). The march stops the ray when it gets
there: moved back along its last step, `RAY_SCATTER`, handed to shade as a hit (`hazeAt`). A surface met first ends the
leg as it would have. Shade starts every leg it writes on with `tmax` 0. A collision is weighed by the albedo; passing,
by 1, since its probability is the transmittance. (0.62.0 drew it after the march, in the surface kernel, from the leg
made again from where it ended. A leg that escaped ended at the scene's radius, 400 m by default, where f32 put the
start a few steps off, and a collision just past a bounce landed inside the solid: the `haze` row's furnace lost 4e-4
of its light on the user's card. 0.62.2 moved it here.) The photon map's kernel takes only `RAY_ACTIVE`, so a photon that collided is not
stored at a surface it never reached. Shade makes the point a vertex (`mediumVertex`):
- a **photon** connects to the camera through the phase function (`ltConnectMedium`: the splat flux × p × G/A_px with
  the volume's footprint G = dist/z³, the surface's without its |n·v|), under the rule a surface's connection has;
- a **camera path** samples a light (`mediumNee`: processMaterial's three-way pick with no normal; the sky drawn from
  a uniform sphere, `envPdfM`) and weighs it by the power heuristic against the phase function's own draw. `prevPdf`
  and `vtxLtot` are left for the emitter and face MIS to recover the point;
- every **shadow ray** carries the haze it crosses, computed in shade over the true segment from the vertex
  (`hazeShadow`). An emitter ray gets its haze in the occlusion kernel, where its length is known.

**The splits.** A medium vertex is EV_EVAL to the light-tracing and lights' splits: CLS_LIGHTS and CLS_CAND at the
first vertex. A camera path whose first vertex is in the air leaves a light's face to the photons; its ltMis is 0, so
the face's direct-path share does not apply, and the photon's medium connection keeps weight 1. To the photon map it
is EV_OTHER: both fields go out. Counted as the map's D, a camera path through glass, dust and glass would hand the
light it reaches to a map that stores no photons in the air, and lose it. `haze.gpu.mjs` holds that: the photon map
on against off over dust under a glass slab.

**Modes.** Standard and High trace it in full; Draft does single scattering, its path ending at the first point in
the dust. Sketch and the Optics view have density 0 (`hazeUniforms`). In the illuminance view the camera's first leg
passes and its photons' connections are not dimmed; light reaching the surface is. The Optics page's trace has its own
chain and does not see the dust; its status line says so.

**What it does not do yet** (`roadmap/MEDIA.md`): light scattered in dust and seen *through* glass or in a mirror is
the camera's alone, found by chance, so it is noisy; a volume photon map is the next phase. Nor is there scattering
inside materials, or a thin-limit beam view for the Optics view. **Checked** on the CPU (`haze.test.mjs`: a beam's
closed form, the MIS, an albedo-1 slab) and on Dawn over lavapipe (`haze.gpu.mjs`, 2026-10-16). There a furnace read
0.997–1.002, sunlit dust in Draft 0.996–1.010 of the integral, and the splits within their error bars. **Not seen on
hardware**: the `haze` bench row, and the example *Beam in dusty air*.

### Path guiding was removed

It learned, per 16³ cell, a 64-bin histogram of which directions saw sky, and the diffuse
lobe could sample from it. The math was right (a JavaScript port with 62 assertions); the
value never showed. It learned one bounce deep, from escapes only, guided only the diffuse
lobe at ~25° per bin, and with NEE on the sun direction recorded no brighter than sky. None of
that can find a lens, which is what this renderer is for, and it held two storage bindings in
`prog_shade` (then at nine, past the spec floor). The whole of it is in git history before the
commit that removed it, should an interior scene ever want it back.

## Things that bite, and why they are written down

### Compile off-thread

`createComputePipeline` **blocks the calling thread** until the driver has compiled the
module — tinywebgpu's own header calls it "seconds to a minute in which the page cannot
paint". The three kernels that inline the scene — march, shade, occlude — are built with
`async: true` and their `ready` promises awaited, as is genrays; `_buildWavefrontPipelines`
builds all nine with `Promise.all`, so the cost is the longest compile rather than the sum
of nine.

This was found the hard way: raising the Menger iteration count froze the tab with no error
in the console, and because the compile began in the same task that set the status text, the
"recompiling…" line never even reached the screen.

### The resolve kernel is dispatched 2D

`maxComputeWorkgroupsPerDimension` is 65535 on effectively every adapter. A flat
`run(w*h, 1, 1)` at a workgroup size of 64 runs out of x at **4,194,240 pixels** — 1080p and
1440p fit, 2048×2048 misses by one workgroup, and 4K is a validation error. One row per y
instead.

### Buffers grow and do not shrink

`ensureBuffers(w, h, photons)` runs at the top of every trace and returns immediately unless the
requirement grew, so dragging a window smaller does not churn allocations. Two consequences:

- **A resolution change must clear the accumulation**, not just re-weight it. Shrinking
  reallocates nothing, so the old picture is reinterpreted at the new stride — an aspect swap
  at equal pixel count shears the whole image and decays only as `2/(k+2)`.
- **A one-off render at a size the session will never use again should give the memory
  back.** `releaseBuffers()` drops the high-water marks; it must be followed immediately by
  an `ensureBuffers`, because `rebind()` dereferences the buffer fields unconditionally.

### The ray budget is capped; a sample in batches

`maxRays ≈ 2.31 M`, expressed as memory rather than as a count. **The picture's size changes its
resolution and nothing else** (the user, 2026-10-08): a sample is one camera ray a pixel and every
photon asked for, at any size. What does not fit the buffer in one go runs in **batches**
(`core/photons.js planBatches`): every stream -- camera rays, emitter probes, sun photons, each
optics source's photons -- is split evenly over the fewest batches whose largest fits, each batch
runs the whole wavefront chain into the frame and splat buffers, and resolve folds the sample in
once after the last. Each photon is divided by its source's count for the whole sample, so the
batches add up to the estimate one fill would have made. A batch holds no more than the buffer, and
the chain is cut into submissions by its share of the frame's time, which is why high-resolution
renders here do not need weavesim's strip rendering to stay under Windows's two-second
command-list watchdog. The Render stats' Samples row says "× N batches" when there is more than one.

**A sample over several frames (0.58.0).** The live loop's frames (and only they: `R.trace(..., { slice: true })`)
cut a sample slower than `sliceMs` (Performance, default 30 ms) into more batches than the buffer needs, run a few
a frame, and keep the sample pending in `R._slice` until the frame that runs its last batch resolves it. So the GPU
is never handed a whole slow sample in one go, and the browser draws in between. The per-pixel cost of a sample
(`R._pxMs`, an EMA) sizes the slices; `R.sampled` says how much of a sample a call traced, for the loop's rate.
- **What drops a pending sample:** another size, photon plan or scene, the buffers reallocated or cleared, or a
  trace that is not a slice. Its part is then cleared from the frame and splat buffers, since only resolve empties
  them otherwise. If three are dropped in a row, the next sample runs whole.
- **A reset does not drop it:** it goes on under the new view and replaces the picture, and the average starts again
  after it.
- **Fast samples** are not cut, and a frame holds no more of them than fit in `sliceMs`.

Until 0.38.1 a sample was one fill: above the cap it fired fewer camera rays than there were
pixels (a 4K frame about a quarter of them per pass), and the photons got what the camera rays
left -- none from about 2.3 Mpx, so light tracing switched itself off and a large save lost the
light through its glass.

### `maxaverages` is an EMA window; 0, the default, is the true mean

It defaulted to 10 "so an interactive view forgets the frames from before the camera moved". A
move restarts the picture now (`moveAverages` 0), as every edit does, so all the 10 still did was
stop a still view converging past about 21 samples' worth -- hidden by the tone curve, plain in the
false-colour views. Set to N it is still an EMA of N: a 500-sample save would be an N-sample image,
which is why `saveImage` and the test bench pin it to 0 whatever it is.

### `resetframecount` applies to one trace

Left at 1 it is re-read at the top of every trace and sets the averaging window back to 0
each time — every sample replaces the picture, and five hundred converge no further than one.
(A reset replaces rather than re-weights: see `R.trace` for why the old window of 2 left bright
spots behind after a move once light was in cd/m².) The loop clears it after
each frame; `step()` and `renderFrame()` now clear it after each trace
(`traceOnce` in `index.js`), so no caller has to remember. A caller of `RT.trace` directly
still does.

**And `update()` only resets when the uniforms actually changed.** Tweakpane's `refresh()` fires
a binding's `change` handler for any value set programmatically, so every `RT.set` used to be
followed a frame later by a second, identical update and a reset. With the loop stopped that
landed between the bench clearing the flag and stepping, and held for the whole step: the `lt`
bench's `noise` column read 2.3× high on exactly the rows where the refresh won the race.
**Any `noise` figure from an image bench before this fix may carry it; `meanLuma` does not** —
an EMA of unbiased samples is unbiased, it is only fewer of them.

### Backticks in WGSL comments, and what `check-shaders` can now see

The kernels are JS template literals. A backtick inside a WGSL comment ends the literal and
produces a syntax error pages away from the cause. `core/check-shaders.mjs` imports every
module and, on failure, points at the backticked comment lines.

A second pass then **builds every kernel against every scene** with a stand-in device that
records instead of compiling, and checks two things the driver would otherwise have to find:

- **every `SCREAMING_SNAKE` identifier the source names is declared somewhere in it.** This
  exists because `prog_guide_build` shipped with an empty module string — `GUIDE_CELLS`
  unresolved, the pipeline failing at startup for everyone — and pass one said "24 modules
  parse". Nothing dispatches that kernel unless guiding is on, and pipeline creation is
  `async`, so the rejection arrives long after the call that caused it.
- **every binding is reachable from `main`.** tinywebgpu decides what to declare and bind by
  searching the source text; `layout:'auto'` keeps only what the entry point can actually
  reach. A resource or `UB` named only in a helper nothing calls is therefore bound and absent
  from the layout — an invalid bind group, and the frame's whole command buffer with it.
  `prog_lt_build` shipped that way (its prelude carried `marchEps`, which names `UB`) and
  failed the first frame light tracing was switched on.
- **the bind group fits.** Every kernel is checked against the spec floor of 8 storage
  bindings. `tinywebgpu.init` requests the adapter's own limit, which is 16 or more on
  desktop hardware and can never fail, but an adapter offering only 8 will not run a kernel
  past it. The check says so. (`prog_shade` sat at 9 until path guiding was removed.)

A third pass runs **eslint over `lib/pathtracer` with only the rules that are always bugs** —
`no-undef` foremost, plus `no-dupe-keys` and a handful of others nothing can reasonably
disagree with (`core/lint.config.mjs`). It is deliberately not a style pass: a checker that
reports opinions is a checker people learn to skip. It earned its place when `perIterUniforms`,
a `const` scoped to one iteration of the sample loop, was read by the guide rebuild outside it
— valid syntax, a `ReferenceError` only on the line that runs, and only once guiding was
switched on. eslint is not a dependency here, so a machine without it gets a line saying the
pass **did not run** rather than a silent success.

A fourth pass, if **naga** is installed (`cargo install naga-cli`), compiles every kernel
against every scene for real -- the source rebuilt the way tinywebgpu assembles it, schema from
tinywebgpu's own `makeSchema` -- and is the only one that can see a WGSL **type** error. It
arrived with the scene builder's transforms and CSG, which were the first generated code
complicated enough to want it. naga is not Tint, so it is strong evidence and never proof the
page works.

### Storage bindings are capped per stage

`maxStorageBuffersPerShaderStage` defaults to **8** and is the limit that bites silently: a
kernel grows a ninth binding and pipeline creation throws at `setScene`, pages away from the
line that added it. `tinywebgpu.init` now raises it to whatever the adapter reports, alongside
`maxStorageBufferBindingSize` and `maxBufferSize` — asking for exactly the adapter's own value
can never fail, which is what makes that safe to do unconditionally. A scene that declares its
own storage resources spends from the same budget as the renderer's own.

## Two post-mortems this design is built on

### `CODE_WOOD/FLOWTRACER`

Nine page variants, ending with the path tracer deleted in favour of a renderer specialised
to the simulation's texture layout.

Passing a live GPU handle in worked, cost nothing and survived every rewrite — zero-copy was
never the problem. What rotted was the contract *around* the handle: channel meanings drifted
from their comments, uv mapping was re-derived per call site (three conventions, two wrong,
in one function), and resolution was hardcoded to 2000 while 2048 sat on the resource. Hence:
a resource is **described** — extent, world box, channel roles — never a bare texture plus
loose uniforms.

It also mutated geometry under an accumulating tracer with no way to signal it, which is why
`invalidate()` is core API; and it had no "render N samples at size S to target T", so the
save path duplicated the loop body. That factoring **is** the service API.

### `lampmaker/raytracer` `scenebuilder/`

A tree, a property panel and a GLSL editor that emitted `sdfResult(d, m)` while the engine
had moved to a three-field `sdfResult{d, m, nd}`. **Every scene it generated was a hard
compile error.** The change handler was commented down to a bare `;`, the menu index was off
by one so the branch was unreachable, and a fully written compile-error line remapper was
wired up and never called.

It failed for want of one loop: generate → compile → show the error. When the scene builder
comes back, that loop is built first, with two hardcoded nodes and no UI, and nothing else
starts until it round-trips.

## What is still missing, honestly

This **wraps** the existing engine rather than replacing it. `core/` still reaches for a
canvas through `Q`, and `Q.w`/`Q.h` is still the single global render resolution — so two
tracers on one device would fight over it.

Two things that used to be on this list are done, and they were the ones that made the scene
contract a fiction. The environment is the renderer's: a ray that leaves gets `envRadiance`,
instead of every scene declaring a `MAT_SKY` dome so the occlusion kernel could recognise one.
And the material override uniforms became scene uniforms, declared by the host's scenes next
to the `getUniformMaterial2` that was the only thing reading them, rather than in the renderer's
own groups -- which is what let the raytracer host drop them entirely once its scenes became
builder documents that declare only their own materials.

`grabFrame()` is a real render-to-texture path; `imageStats()` is not — it reads the
accumulation buffer as linear HDR floats with none of the tone mapping applied.
