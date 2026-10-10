# Changelog — the raytracer

One entry per version, newest first. The version is `VERSION` in `version.js` beside this file, and
`test/version.test.mjs` holds the two to each other: the top entry is the version the code says it is.

**How a version is raised** (CLAUDE.md, *Versions*): every PR that changes the application raises it in
`version.js` and adds its entry here, in the same PR.
- **Semver 0.x.** MINOR (0.**2**.0) for a feature, or for any change to a file format (a scene, project,
  workspace or library file's `version`). PATCH (0.1.**1**) for a fix, a document, or a test.
- **If `main` took the number first**, take the next one when merging `main` in.

The exact code is the git revision. The page reads it live from `.git` and shows it beside the version,
for example "ShadyTracer 0.1.0 · 1819ac6 (main)". So no hash is written here.

**Each entry** says what changed and **what to look at**: what only the user's card or eye can confirm,
as PLAN.md does.

## 0.52.0 — 2026-10-10

**The environment is in the scene's properties; the tree has no Environment row** (the user: "just move the
contents of that to the scene's properties"). A click on the scene's row at the root of the tree shows its
properties: label, unit, environment radius, and then an **environment** folder holding what the row did (the
source, sun and sky or studio, and that source's settings), marked ◆ when one of them is animated. No file
changes: the environment was always the scene document's (`doc.environment`, `builder/model.js`), never a node.
Render › Environment, a parameter revealed from the palette or the Parameters panel, and the environment's old id
all select the scene's row (`builder/tree.js` select). A node dropped at the scene's top level is counted among the
nodes as before; the Materials heading is now the only row that is not one.

**The studio colour can be set.** It always went back to white (the user). Tweakpane sets an object colour's r, g
and b on the object the binding reads; the row handed it a fresh copy each time, so the change was made on the copy
and lost. The colour is now bound to an object that stays, written on `change`, as a light's colour already was. The
same row and the same fault were in the Environment row's folder before this change.

**Every row of the scene's properties has a tooltip** saying what it is and what it does (the user): name, unit,
radius, each environment setting (`ENVIRONMENT_HELP` in `builder/panel.js`, with typical values such as the noon sun's
100 000 lx, and the sun's azimuth as a compass bearing from +y), instant hide / show, the functions block, and the
animated list. `builder/test/panel.check.mjs` fails on any titled row of the scene's properties without one, in the
studio and in sun and sky, and on any environment setting with no explanation.

**What to look at:** the tree starts with the scene's row and its objects, no Environment row. Click the scene's
row: Properties shows the environment folder under the radius. Switch Source to studio: the folder redraws with
the studio's settings. Pick a studio colour: it stays, and the picture takes its hue. Hover each row: a tooltip.
Render › Environment lands on the same place.

## 0.50.0 — 2026-10-10

**The library's materials reviewed for real sizes and optical constants, and four relief materials added**
(`library/items/materials.json`).

Reviewed, with what changed and the source:
- **Glass and clear plastics now disperse.** Each has its Abbe number V_d beside n_d, both from catalogue values
  (the user asked for realistic values; the numbers are typical published figures, not measured here):
  - clear, tinted and frosted glass are soda-lime, n_d 1.52, V_d 59;
  - polycarbonate is n_d 1.586, V_d 30.
- **Green tinted glass is coloured through its body:** a colour depth of 10 mm (`attenuationDistance`), so a thick
  part is darker than a thin one. Before, every crossing tinted it the same whatever the thickness. The 10 mm is a
  choice, not a measurement.
- **New for optics:**
  - **flint glass (F2)**: Schott F2, n_d 1.620, V_d 36.4, for prisms;
  - **PMMA (acrylic)**: n_d 1.491, V_d 57, for LED lenses and light guides.
- **Finer machining marks.** Brushed aluminium's streaks are 0.3 mm wide (were 0.6) and turned aluminium's are
  0.2 mm (were 0.4); a lathe's feed is about 0.05-0.3 mm a turn. Real brushing marks are finer still. These are the
  finest that still read on a 50 mm sample, a choice for the picture.
- **Leather's grain** is 0.2 mm deep (was 0.4).
- **Kept as they were:**
  - granite's 4 mm crystals, marble's veins 50 mm apart, terrazzo's 10 mm chips, wood's 3 mm rings, cork's 2.5 mm
    granules, galvanised steel's 10 mm spangles and carbon fibre's 2 mm tows;
  - the PLA's 0.2 mm layers and the hammered metal's 8 mm dents, 0.4 mm deep;
  - the metals' colours, which are the usual linear reflectances at normal incidence (gold 1.00/0.78/0.34,
    copper, aluminium, chrome).
- **Not changed, for the user to decide:** several diffuse colours are bright for what they are. Sandstone, wood
  and cork are 0.5-0.8 in linear terms, and concrete is 0.56, where such surfaces reflect roughly 0.3-0.45. These
  are colours, not sizes, and lowering them darkens every scene that uses them.

**New relief materials.** The relief is shape: the silhouette shows it, and it is paid at every march step near
the object.
- **white plaster**: a hand-trowelled wall, waves up to 0.3 mm over about 25 mm.
- **knockdown stucco**: blobs of plaster about 15 mm across, trowelled flat, 1 mm proud. This is new relief code:
  the noise relief through a smoothstep, so every top is cut level. Its `edge` and `soft` set how much wall
  shows between the blobs. Its slope bound is the noise relief's times the smoothstep's steepest, 1.5 / soft.
- **sand-float render**: sand grains about 1.5 mm across, up to 0.3 mm.
- **orange-peel paint**: gloss paint whose surface waves 0.015 mm over 3 mm, seen only in reflections. That is
  near the f32 floor far from the origin (`lib/pathtracer/PRECISION.md`), which its help says.

**What to look at:**
- The Library's Materials: the four new reliefs' thumbnails, and whether each reads as what it is named. The
  plaster is a judgement of scale.
- A prism or lens in flint glass, then in PMMA: colour fringes, larger in flint.
- A thick and a thin block of green tinted glass: the thick one darker.
- Brushed and turned aluminium: whether the finer streaks still show.

## 0.47.0 — 2026-10-10

**The numbers box at the view's top right folds.** It can be large and is not always wanted (the user). A chevron in
its head (▾) folds it to the head alone — the selection's name and unit — and ▸ opens it again; the choice is
remembered (`raytracer.builder.edit.readout`). Folded, it still shows what must be read: a refusal or a shape that
will not hold (a 'bad' note), and the typed entry Enter opens in the Points mode. The chevron is the one part of the
box that takes the mouse; the rest still lets the picture through, so a handle under it can be grabbed as before
(`builder/readout.js`; checked in `builder/test/transform.check.mjs`).

**What to look at:** select a shape in Transform mode, click ▾ at the box's top right: the numbers go, the name
stays, and the box is narrow. Reload: still folded. In Points mode press Enter on a point: the typed entry opens
in the folded box. Click ▸: the numbers are back.

## 0.46.0 — 2026-10-10

**ShadyTracer has a repository of its own, open source under MIT, and can run from GitHub Pages.** It lived in
`projects/raytracer` of the private RAYTRACER_WEBGPU monorepo, beside weavesim; it is now `lampmaker/ShadyTracer`,
with the application at the root (`index.html`, `builder/`, `optics/`, ...) and the code it is built on in `lib/`
as before. Entries below this one name files by their old paths (`projects/raytracer/...`, `lib/tinywebgpu.js`);
they are history and are left as written.

**TinyWebGPU and GUISTUFF are git submodules**, `lib/tinywebgpu/` and `lib/guistuff/`, pinned to a commit of their
own repositories, instead of copies. Both copies had moved ahead of their releases, so their additions went
upstream first: tinywebgpu 0.5.0 holds everything the copy had (async pipelines, the pipeline cache, `read` and
`uniform` buffers, `timePasses`), and GUISTUFF took the property table's and tree view's four edits. The code the
page runs is the code it ran, with one difference: a dispatch of a pipeline still compiling, with its resources
already set, now says "Pipeline is still compiling" rather than "No resources bound". A clone needs `--recursive`.

A 3MF export names its application "ShadyTracer scene builder", where it said "RAYTRACER_WEBGPU scene builder".

**The revision on GitHub Pages.** Pages never serves `.git`, so the deploy writes the commit into a `REVISION` file
beside `version.js`, and the page reads that when `.git` is not there (`.git` first: a local checkout is the truth).

**What to look at:**
- from a clone (`git clone --recursive`, `python3 -m http.server 8000`, then <http://localhost:8000/>): the page
  starts, a scene renders, the Builder, Library and Optics panels open, a panel pops out to a second window, and the
  title bar reads "ShadyTracer 0.46.0 · <hash> (<branch>)". Same origin as before, so your projects are kept;
- once Pages is on, <https://lampmaker.github.io/ShadyTracer/>: the same, the title bar naming the deployed commit
  with "(main)". It is a new origin, so it starts as a first visit: on *Builder demo*, with no projects of yours.

## 0.45.2 — 2026-10-10

**The application is called ShadyTracer.** It had no name of its own: the tab said "Raytracer-WEBGPU" until the
page started and "Raytracer 0.45.1 · ..." after, and a pop-out window "Raytracer · panel". All of them now say
ShadyTracer, as do the title bar's line, Help › Report and a test result's header, which all come from `NAME` in
`version.js`. Nothing a file saves carries the name (a file's `app` is the version and revision only), so every
saved scene, project and library opens as before. The docking layout's storage key stays `raytracer.layout`, so a
layout you arranged is kept. The repository and the `projects/raytracer` folder keep their names.

**What to look at:** the browser tab and the title bar read "ShadyTracer 0.45.2 · <hash> (<branch>)"; a panel
popped out to a second window reads "ShadyTracer · panel"; your workspace layout is the one you left.

## 0.45.1 — 2026-10-09

**The maximum distance is in the rays' popover too.** It cuts every drawn ray short, and it was only in the
Analysis pane's Advanced section, folded away, so what was cutting the rays could not be found. It is now also
in the Rays popover (the view's analysis drawer), under "interactions", as "max distance (0 = none)": the same
value as Advanced's, saved with the scene; each place follows the other.

**The rays' "path shown" is a length, not a share.** It was a share of the maximum distance, or of the longest
ray traced when there was none, so the same slider position meant another place after every trace and every
change of the distance. It is now an optical path length in the scene's unit, from 0 to 1000 (or to the maximum
distance, when the page opened with one). **Right-click the row** for the property table's min, max and step: the
slider's range is yours to set. At the slider's right end every ray is drawn whole ("end = all"), and a slider at
its end stays there when the range changes.

**What to look at:** open the Rays popover and find the max distance row; change it and watch the rays stop at the new
length, and Advanced's row show the same number (and the other way round); switch scenes and both show the
new scene's value. Then drag "path shown": the front should stop at the same place across traces; right-click
it, set a max of, say, 50, and the slider should span 0 to 50 with the rays redrawn within half a second.

## 0.45.0 — 2026-10-09

**One menu for each thing: the scene dropdown over the tree folded into File, and nothing in the menu bar said twice.**
You asked for it (2026-10-09: "lots of duplicate entries"). No entry was registered twice; the repeats were different
entries doing the same thing:
- **File is the one place for the project and its scenes.** The dropdown over the tree is gone; File now has, top to
  bottom: Projects…, New project, Import a project from a file… · New scene, **Switch to scene ▸** (● the one worked on),
  **Examples ▸**, Rename / Duplicate / Move up / Move down / Delete this scene · Open a file… · the library item's Save
  and Close (only while one is edited) · Save now · the three files · Save a picture. Switching is still a choice in a
  submenu (a compile). While a library item is edited, everything that switches, adds or opens is greyed, and only one
  row says Ctrl S.
- **The row over the tree** keeps the project's name (plain text now), the ▶ when the scene is not compiled, Undo, Redo.
- **View opens the panels, and only View.** Gone: Render › Renderer, Render stats, Tests, Save a picture; Optics ›
  Analysis; Edit › Add from the library, Find a setting (Help › Find a command…, Ctrl K, is the same palette), and the
  greyed Copy · paste hint; the Tools menu (View › Colour mixing still floats, View › Timeline still docks under the
  view). Save picture is File's alone, no longer in View.
- **The shell** (lib/shell) gained submenu rows (`items`) and panels with no View entry (`menu: false`).

**What to look at:** open each menu and look for anything listed twice. File › Switch to scene ▸ switches and compiles;
Examples ▸ adds a copy; Rename (a prompt), Duplicate, Move, Delete act on the scene worked on and Ctrl+Z undoes each.
Nothing over the tree but the name, ▶ and Undo / Redo. View › Colour mixing floats; View › Timeline docks below the view.

## 0.44.1 — 2026-10-09

**The rays' "light colour × flux" draws each ray's flux per channel.** It drew the ray's hue scaled to a brightest
channel of 1, times its luminance: RGB × Y / max(RGB), which is right for a white ray and nothing else. A ray a prism
has dispersed carries one wavelength, and drew at 0.72 of its flux when green, 0.21 when red and 0.07 when blue -- so a
white bundle of every wavelength summed to (0.35, 0.71, 0.14), computed over the wavelength draw (core/spectral.js), and
the prism's reflections, where the colours overlap again, came out green (yours, 2026-10-09). Now a line is the hue
(luminance 1) times the weight, which is the ray's RGB exactly, and the same bundle sums to (1, 1, 1). Undispersed white
rays draw exactly as before; the picture itself was never affected. optics/paths.js.

**What to look at:** the prism in *light colour × flux*: its reflections white or neutral, not green; the fan's blue and
red lines as strong as its green (blue was about ten times too dim). A white ray that meets no dispersive glass looks as
it did. The blend is additive, so *brightness* is the translucency: lower it where a dense bundle saturates to white.

## 0.44.0 — 2026-10-09

**Seen through glass: a photon that lands inside glass is connected to the camera through the glass's face.** The floor
inside the prism, lit through the glass and seen through it, came only by chance -- through 0.43.0's lens, a photon off
the floor had to happen to leave the glass towards it -- and the picture was noisy (yours, 2026-10-09: "picture is noisy;
I'd like to try the manifold"). Now every such photon is joined to the camera: the point on the glass's face where light
from it, bent by Snell, reaches the camera is found by Newton's method on the face (Hanika et al. 2015, manifold next
event estimation, a chain of one refraction), and the light it sends that way lands on the pixel it belongs to, as a
photon's connection does in air. With a pinhole too: no aperture needed.
- **The setting:** Renderer › Light sources › *Seen through glass (manifold)*, on by default -- it costs nothing where no
  photon lands inside glass, and off is the same picture, noisier there. Full renderer only; the photographic and
  luminance views; a perspective camera.
- **How it splits the light** (`core/manifold.js`): it counts light → glass or mirror → a diffuse or glossy surface
  inside a medium → one refraction into air → the camera. The camera's rays leave it exactly that (their first surface
  a refraction, then that surface, then glass or mirror to the sun, a glowing surface or a light's face), and the lens's
  photons leave it their share. Everything else is counted as before.
- **What it costs:** the surface kernel walks the solve one look at the scene at a time (so the scene is still compiled
  into it once): about 100 looks a photon under a flat face, 300 under a curved one (measured on lavapipe, not a speed).
  The shade queue's item grew 16 bytes (288): ~2.10 M rays in flight, from ~2.16 M. The ray's wavelength gave up one bit
  (0.012 nm a step) for the class's marker.
- **Not found:** a curved face that shows the surface twice gives one of its images; grazing exits at a dome's rim are
  found less often (on a test dome 5 % of the photons under it, under a percent of its light by the sum). Through two
  faces (a ball's caustic seen through the ball) or in a mirror: the lens's photons, as in 0.43.0. A coated face
  (0.39.0) is crossed at plain Fresnel.
- **Checked here:** `manifold.test.mjs` (no GPU): on a lamp-lit floor under glass the connection's picture is the
  camera's own -- a slab 0.997 ± 0.003 of its sum, a dome 0.999, blocks within 2 % (measured at ten times the committed
  samples). `manifold.gpu.mjs` (Dawn, lavapipe, 41 checks): the WGSL walk against the JS mirror on both; the surface
  kernel itself on a builder scene, its 256 photons answered on the mirror's pixels with its weights within 1 %, and
  nothing with the setting off, on the last pass, in Draft, the illuminance view, an orthographic camera, for a photon
  with no glass before or in air; shade's half queuing flux f exp(−μd) w. Planted mistakes (the 1/n², the absorption,
  the gate) were each caught. `lens.gpu.mjs` gains the class's marker and what the camera leaves to whom.
- **What to look at:**
  1. The prism scene, Full, aperture 0 (a pinhole): the floor inside the prism under the slit light, seen through the
     glass -- is it there now, and smooth? Then *Seen through glass* off: the same floor, grainy or black.
  2. The same with an aperture: it should stay smooth.
  3. Bench `manifold` (Tests): rows 1, 2 and 3 the same meanLuma, rows 4 and 5 the same; lt noise lower on 2 than 1;
     secs says what the solve costs.

## 0.43.0 — 2026-10-09

**The camera has a lens: an aperture and a focus, and photons can find it.** The floor inside the prism, lit through the
glass and seen through the glass, was black: light → glass → diffuse → glass → eye, which nothing made with a pinhole
camera (0.40.1). The user's idea: a camera with a lens of some diameter, working beside what is there.
- **The settings** (View › Camera): **aperture**, the lens's diameter, and **focus**, the distance in focus -- 0 is the
  target's, so an orbit stays sharp where it looks. Both in the scene's units; aperture 0 (the default) is the pinhole,
  the picture exactly as before. A perspective camera only. Saved with the camera (a workspace, a project's scenes).
- **The camera's rays** start on the lens's disc and pass through the pinhole's ray at the focus plane: depth of field.
  Light tracing's connections go to a point of the lens drawn the same way (`core/lens.js` says why the two agree).
- **Photons through the lens.** A photon of the sun, an emitter or a light that has passed glass or a mirror, scattered
  off a diffuse or glossy surface, and passed glass or a mirror again is tested against the lens on its way out; one
  that crosses it adds its light to the pixel its ray runs back along. The camera's rays then leave exactly that class
  of path to the photons (the sun's disc, an emitter, a light's face met after it) -- every other path as before, so
  the total is unchanged and only the noise moves. Only in the full renderer, the photographic and luminance views.
- **Checked here:** `lens.test.mjs` (no GPU): on a small lit patch, the camera's rays, photons through the lens and
  connections through the lens give the same picture, in and out of focus (measured: 1.005, 0.994 and 1.001 of the
  camera's sum at ten times the committed samples). `lens.gpu.mjs` (Dawn/lavapipe, 67 checks): genrays' rays through
  the focus plane at their pixel, a radius of 0 the pinhole bit for bit; the class's steps; a photon's lens hit, its
  pixel and weight, and nothing where it must not; a connection through the lens; a hit shaded in the shade kernel's
  own phases. check-shaders' four passes over every kernel and scene.
- **The bench and the library's thumbnails use a pinhole** unless a row names a lens, and put your lens back.
- **What to look at:**
  1. The prism scene with an aperture (try a tenth of the camera's distance to start, Renderer on Full): the floor
     inside the prism, under the slit light, seen through the glass -- is it lit now? It will be grainy: each photon
     must happen to cross the lens. A bigger aperture is less grainy and more blurred.
  2. Depth of field: an aperture, then the focus at a near and a far object.
  3. Bench `lens` (Tests): each lens's two rows must have the same meanLuma (light tracing on and off), and with it
     on the floor seen through the ball should be less grainy.
- **Not done:** whether something like NEE aimed at the camera could cut that grain -- your question, answered next.

## 0.42.0 — 2026-10-09

**The timeline exports an animated GIF.** You asked whether the animation engine could make a GIF as well. The export
menu (Timeline › ⚙ export › format) now offers *GIF (256 colours, loops)* beside MP4 and the PNG sequence.
- **Where it was made:** in the timeline library's canonical home, CODE_WOOD `LIBRARIES/TIMELINE` (commit 8f1a90f, its
  branch `claude/bold-wozniak-d2bxnu`), and synced into `lib/timeline` with `sync.mjs`; `PROVENANCE` names that commit.
  Nothing in `projects/raytracer` changed but its test: the menu lists whatever `ENCODERS` holds.
- **How (read in code):** no browser encodes GIF, so `lib/timeline/gif.js` writes it on the CPU: each frame its own
  256-colour palette, Floyd-Steinberg dithering, LZW, looping for ever. GIF times frames in hundredths of a second, so
  30 fps plays 3, 3, 4 cs and keeps time; above 50 fps frames are dropped, since browsers play a delay under 2 cs as
  10 cs. The bitrate field does not apply to it; *to disk* streams it as it does the others.
- **Measured here, not on your machine:** encoding a 1920×1080 frame took 0.3 to 0.4 s (node, this cloud container's
  CPU), and such a frame of a smooth gradient was about 1 MB. A path-traced frame's noise will likely make it larger
  (inferred). It is for short clips at a small size; for a long or large one, the PNG sequence through ffmpeg's
  `palettegen`/`paletteuse` (the README's command) gives the better GIF.
- **Tested:** `lib/timeline/test/gif.test.mjs` reads the files back with its own decoder, Pillow and ffmpeg (exact on
  256-colour noise, the clock at 25, 30 and 60 fps, streamed equal to collected); `tools/test/timeline.check.mjs`
  records one through the panel over the stand-in renderer and Chromium's own decoder reads each frame's colour back.

**What to look at.** Timeline › ⚙ export: choose GIF, a small size (say 640×360) and a few seconds, RECORD. The
download is `<name>.gif`: does it play in the browser and loop, at the speed the timeline plays, and do the soft
gradients and dark areas look acceptable dithered (a fine grain rather than bands)? How long a frame's encoding adds
next to the render, at the sizes you use, is yours to see.

## 0.41.0 — 2026-10-09

**Three performance options removed: the step cache's lazy fill, exact hits, and the candidate grid.** You asked for this
after the review of the performance work: "Remove the stepcache 0 option. Remove the exact hits code. Remove the
candidate grid." Each was a developer setting, and each had been measured on your Pascal as no general gain.
`roadmap/ARCHITECTURE.md`, *Removed in 0.41.0*, has the runs that decided it. (Written as 0.37.0; `main` took 0.37 to 0.40
first, so it is 0.41.0.)

What went:
- **The step cache's fill 0, "as rays go".** The march no longer fills a cell on a ray's first visit, so no atomics, no
  fill trips and no stand-in ray. When the cache is on, every cell is filled by its own pass before the trace, and the
  march and occlusion only read the cells.
  - *Step cache: fill* now reads *1 when the scene changes, 2 every frame*, and 1 is the default.
  - A saved 0 fills as 1.
  - Filled once was faster than the lazy fill on every scene of your stepcache run of 0.33.1.
- **Exact hits** (`sceneExact`, `builder/analytic.js`). With them went the march's moves onto a surface, the ray's object
  list, and the solids' table after a data scene's records.
  - The march now steps `stepscale` of the distance everywhere, as it did before 0.18.0.
  - The list of closed-form shapes stays, in `builder/plainshape.js`: codegen's dear-only boxes decide with it which
    nodes get no box test. Same 16 shapes, same rule.
  - **What that costs, seen by you in 0.40.1:** the prism scene's slit beam grazing the floor was drawn only with exact
    hits on. It now fades in every build, as 0.40.1 already said it does without them. You chose that on 2026-10-09,
    asked again after 0.40.1. 0.40.1's rule that the bake stands aside while exact hits are on (`BUILDER.bakeBlocked`,
    the status bar's "no bake: exact hits") went with them: there is nothing left for it to stand aside for.
- **The candidate grid** (`sceneGrid`, `builder/grid.js`, `builder/regrid.js`). With it went the renderer's
  `sceneEval`/`writeSceneData`, which only the grid used.
  - A scene as data is now always the plain culled walk.
  - Every copy of it reads its records from the uniform copy (`scnRecs`). With the grid or exact hits on, they were read
    from the storage buffer.
- **codegen refuses `grid`, `exact` and `listMax` by name.** A caller still asking for them gets an error, not a scene
  without them.
- **A saved workspace with `sceneGrid` or `sceneExact`** opens with a console line naming them as ignored, as `cull` did
  in 0.34.0.
- **The benches lost the rows that timed what went.**
  - Tests › stepcache: off, own cell, cells ahead at 1, 4 and 16 M (all filled once), then every frame; the optics bench as
    data last.
  - Tests › builds: the data rows are plain data now, so they cannot be compared with the data rows of earlier runs.
  - Tests › scenedata: codegen and as data.
  - Tests › scaling: as data only, 8 rows.

**Checked here** (none of it on a GPU like yours):
- check-shaders' four passes are clean, naga included: 3331 kernels.
- Every node test touched passes.
- On lavapipe, `builder/test/stepcache.gpu.mjs` passes: every camera and shadow ray ends as with the cache off, on the
  four codegen scenes and the optics bench as data. `units.gpu.mjs` passes too.

**What to look at:**
1. **Renderer › Performance** (Developer on) has no *candidate grid* or *exact hits* row. *Step cache: fill* reads
   *1 when the scene changes, 2 every frame*.
2. **Every bundled scene looks as before**, as code, baked, and with *Scene as data* on. Data scenes that had the grid or
   exact hits on are now the plain walk.
3. **With the step cache on**, the picture is as with it off, and *show its cells* still draws the orange band.
4. **A saved project loads.** If its workspace had the grid or exact hits, the console names `sceneGrid`/`sceneExact`
   as ignored.
5. If you rerun **Tests › stepcache** or **Tests › builds**, paste them: their rows changed, and the data rows are not
   comparable with earlier runs.

## 0.40.1 — 2026-10-09

**The bake stands aside while exact hits are on: it drew another picture.** The user's prism scene: a slit light's narrow
beam grazing the floor vanished from the picture once the scene was baked -- all of it or parts -- and the same with the
scene as data and exact hits off; with exact hits on it was there. Tilted down or made wider, the baked picture was right.
- **Why (read in code; the step count inferred):** exact hits (`builder/analytic.js`: where along the ray a shape's
  surface is) exist only in the scene as data (`demo.js exactMode`). The bake is codegen's text with its values constant
  -- compiled code, marched by distance. Marching by distance closes in on a surface it approaches at angle θ by a
  factor of about (1 − sin θ) a step: hundreds to thousands of steps at the beam's 0 to 0.5°, and a photon still
  marching at the end of its budget is lost. So the bake promised "the same picture" (it keeps the samples so far) and
  drew another one.
- **Now:** with exact hits on (Renderer › Developer), the bake does not start, and a baked scene shown is left for the
  editing build. The status bar says "no bake: exact hits", its tooltip why (`BUILDER.bakeBlocked`). Bake and exact hits
  are both developer settings; exact hits on means no bake until the baked build has them too -- the fix that keeps both
  (codegen with exact hits) is not built.
- **Not changed:** without exact hits, a beam grazing a surface still fades -- as data, as code or baked. Exact hits, or
  a beam that meets the floor at more than a degree or so, are what draws it.
- **The light inside the prism, on the floor it cuts** (the user expected it): not drawn, with exact hits on or off,
  read in code -- the path is light → glass → diffuse floor → glass → camera, which no strategy here makes: the light's
  photons connect to the camera only from a point in air (`ltConnect`), a shadow ray stops at the prism's face (occlusion
  is geometry only), and a camera path would have to find a 0.1 mm slit within its 0.5° beam. It needs photon mapping
  (PLAN.md: SPPM). What the second picture showed inside the prism without exact hits was not that light (inferred: grazing
  photons that reached the floor sheet without entering the glass, connecting as if in air).
- `scenes/Prism.json` (the user's) is in the golden shaders, frozen without moving any other.

**What to look at.** The prism scene with Renderer › Performance › bake on and exact hits on: the status bar says
ends "· no bake: exact hits", and the beam on the floor stays. Exact hits off: the bake comes after 2 s,
and the grazing beam is gone in it as in the editing build -- the same picture now, both without the beam.

## 0.40.0 — 2026-10-09

**Glass can disperse: a material's Abbe number, and a prism that splits white light into its colours.** The second
step of the user's spectral plan (the "looks right" method: the colour channels kept), after the dichroic.
- **What to set** (Properties › material, under ior): "Abbe number (dispersion)", V_d -- with ior as n_d, the two numbers
  a glass catalogue gives (BK7 1.517 and 64.2; a dense flint 1.75 and 28). 0, the default, is no dispersion. Lower is
  more dispersive. In the shader only while above 0, so every scene without one compiles to the text it did (the golden
  shaders pass); the first value is a compile, then live.
- **n(λ)** is Cauchy's A + B/λ² through n_d and V_d (`core/spectral.js cauchyN`): exact at the d line and in F − C;
  BK7's n_F and n_C come out within 6e-5 of the catalogue's (`core/test/spectral.test.mjs`).
- **How a ray gets a colour:** a ray has no wavelength until it is REFRACTED INTO a dispersive material. There one is
  drawn (each 10 nm bin by the three channels' summed weights, then uniform within it) and the ray's channels are
  weighed by what that wavelength is to them -- exactly 1 on average in each, at most 3 -- so a white beam leaves as a
  spread of single colours that average back to white. From then on every index it meets is n(its wavelength): out of
  the prism, into the next glass.
- **What a prism reflects stays white:** the reflect-or-refract choice and its Fresnel are the d line's, and only the
  refracted light carries a wavelength -- reflections get no colour noise. The Fresnel's own change with wavelength is
  left out at that first surface: head-on, from 380 to 780 nm, 0.0029 for BK7 and 0.0107 for the dense flint above
  (computed from the formula, not measured).
- **Where the wavelength lives** (the user's choice): the top 16 bits of `Ray.tag`, whose flags use bits 0-11; 0.006 nm
  a step. The Ray stays 112 bytes, nothing else grows. The one write of a whole tag a wavelength must outlive -- a camera
  path's first surface (`tracebasics.js pathEnd`) -- keeps those bits; starting rays and shadow rays write it whole, as
  before.
- **The coating's two reflectances are packed** into one word (two 16-bit unorms, 1.5e-5 a step) to make room for the
  Abbe number: Material2 stays 96 bytes. The scene file is version 21 (a 20 file gets Abbe 0).
- **Checked on a WebGPU in Node** (Dawn's Tint on lavapipe, a CPU driver: correctness, never speed;
  `core/test/dispersion.gpu.mjs`): the shade kernel's own bounce, 65 536 times a case, a ray at 45° onto n_d 1.75 glass
  -- reflected at the d line's Fresnel and white weight for weight; refracted along Snell at n(its wavelength) within
  1e-5, its medium's index n(λ), spanning 380-780 nm, averaging 1 − F in every channel; Abbe 0 as before, no wavelength;
  a ray already at 550 nm keeping it, reflecting and refracting at n(550). Found on the way: a loop around
  `processMaterial_advanced` segfaults lavapipe, on main's code as on this one; the test calls it once a thread.
- **Not covered:** a light that starts inside a dispersive material (an LED in dispersive silicone) gets no wavelength
  there, and leaves at n_d; rough dispersive glass refracts at n(λ) but a facet totally reflecting at n(λ) and not at
  n_d loses that ray; the optics trace's detectors read the colour (XYZ) of what arrives, not its wavelength -- the
  exact method (a wavelength per ray from the source's spectrum) is the next step.

**What to look at.**
1. **Tests › optics-dispersion** (new): a white beam through a 30° wedge of n_d 1.75. Abbe 0: every channel at
   -23.923°. Abbe 28: red -23.892°, green -24.177°, blue -24.860° -- ratio 1 within a few 1e-4.
2. **Tests › furnace**: three new rows, a dispersive white sphere, must read 1 (rough 0.3 as the rough glass row).
3. **The look:** a prism (the Builder's prism, 3 sides) of glass with ior 1.75 and Abbe 28 in the sun or under a small
   bright light, with light tracing on: a rainbow fan on the floor beside it; the prism seen against a white background
   shows coloured fringes at edges behind it. Expect colour noise in the refracted light that clears with samples (each
   path is one colour); the reflections should be clean.

## 0.39.0 — 2026-10-08

**A material can carry a coating: a dichroic, a beam splitter, an anti-reflective layer.** The user asked what spectral
calculation there is (none: a ray carries three channels, never a wavelength) and chose to start with the "looks right"
method -- the channels kept, a spectrum averaged per channel -- with dichroics first, a dispersive prism next, and the
exact method (a wavelength per ray) later for the optics analysis only.
- **What a coating is** (Properties › material › coating): a thin-film stack whose reflectance REPLACES the surface's
  Fresnel. R runs from "R below edge" to "R above edge" across an edge at "edge (nm)", "edge width (nm)" wide from 10 %
  to 90 %; the edge moves to shorter wavelengths as the light tilts, edge × √(1 − (n sin θ / stack index)²) -- the
  usual first-order dichroic blue shift. Transmitted is 1 − R. Presets: a dichroic reflecting red (above 600 nm), one
  reflecting blue (below 500 nm), a 50/50 beam splitter, an anti-reflective layer.
- **Where it is:** on the faces light ENTERS the material by; the faces it LEAVES by are AR (nothing reflects but total
  internal reflection), bare (the glass's own Fresnel) or the same coating. A plate with "entry faces (AR back)" is a
  real dichroic or plate beam splitter (a lossless stack reflects alike from either side).
- **Per channel** (`lib/pathtracer/core/spectral.js`): each channel reflects R averaged over its wavelengths -- the CIE
  1931 colour-matching functions in Rec.709, negative parts clipped, in 10 nm bins (a logistic edge integrates exactly
  over a bin, so the colour moves smoothly with the edge). **Exact** for an R that is the same at every wavelength (a
  beam splitter, an AR layer); **an approximation** for an edge: it assumes the light in each channel is spread over
  that channel's wavelengths, whatever the source really emits. The binning moves a step's reflectance by at most
  0.0092 against the unbinned weights (measured in `core/test/spectral.test.mjs`).
- **A coloured ray picks by what it carries:** a ray reflects with the channels' R weighed by its own colour, so a red
  ray at a red-reflecting dichroic reflects as often as red does, with weight 1. Picking by the largest channel, as an
  uncoated tint still does, sends most rays to the mirror and the passing colours to a few heavy ones: a blue ray
  through a dichroic reflecting 95 % of red carried weight 21.3 (measured on lavapipe with that rule put back,
  `core/test/coating.gpu.mjs`), up to 1000 as a channel's R reaches 1 (the pick's clamp; read in code).
- **Checked on a WebGPU in Node** (Dawn's Tint on lavapipe, a CPU driver: correctness, never speed): the shade kernel's
  own BSDF text with a coating, 200 000 picks a case -- its R per channel the JS mirror's within 1e-4, reflected R and
  passed 1 − R per channel within 0.005, a one-channel ray's weight exactly 1; AR, bare and coated back faces, total
  internal reflection, an opaque base, and the uncoated glass as before (`core/test/coating.gpu.mjs`, 38 checks).
- **The scene file is version 20** (every material has the six fields; a 19 file gets coating none). The coating is in
  the shader only while a material has one, so every scene without one compiles to the text it did (the golden shaders
  pass); putting one on is one compile, after that every value is live. The bundled scene files are saved at 20 (they
  were still at 18, which `scenes.test` reported as 10 failures).
- **Memory:** Material2 is 96 bytes (80), the shade queue item 272 (256): ~2.16 M rays in flight in the 1 GiB budget
  (~2.24 M), still over 1080p at one per pixel (computed from the sizes, not measured).
- **Not covered:** a cube beam splitter (an interface between two touching solids: not checked whether a ray inside one
  stops at a face it shares with the other -- a plate avoids the question); polarising beam splitters (no polarisation);
  a rough coating's glossy lobe is not compensated for what single scattering loses; the angle is the view's for every
  facet of a rough coating.

**What to look at.**
1. **Tests › optics-coating** (new): ratio 1 within a few 1e-3 on every row, balance 0. A 50/50 splitter with an AR back
   0.5 at 0° and 45°, bare back 0.4808, every face 1/3, an AR layer 1; the dichroic 0.8656 (0°), 0.5390 (45°),
   0.8231 (every face), a red light through it 0.4162; du'v' near 0 on the dichroic rows (the colour that comes out).
2. **Tests › furnace**: the six new coated rows must read 1 like the glass and plastic rows.
3. **The look:** a glass plate at 45° with the "dichroic: reflects red" preset under a white light: red in the
   reflection, cyan through it, and both shifting towards shorter wavelengths (the reflection more orange-yellow) as
   the plate tilts further. A "beam splitter 50/50" plate: two equal images, no tint.

## 0.38.1 — 2026-10-08

**A picture's size changes its resolution and nothing else: a sample with more rays than the buffer holds runs in
batches.** The user's save of two blue glass cubes in the sun came out with plain dark shadows, where the live view
showed blue light through the glass and its reflections -- "the picture size should have no impact on the rays traced".
- **Why (read in code; the save's size not confirmed):** the ray buffer holds about 2.31 M rays (`R.maxRays`). A sample
  was one fill of it: the camera rays came first, one a pixel, and light tracing's photons got what they left -- at one
  photon a pixel thinned out above ~1.15 Mpx, none from ~2.31 Mpx. With none the engine switches light tracing off, and
  the light only it carries (sun through glass) is gone. Above the cap the camera rays were cut as well: a 4K sample
  reached about a quarter of the pixels.
- **Now** every stream -- camera rays, emitter probes, sun photons, each optics source's photons -- is traced whole at
  any size. What does not fit runs in batches (`core/photons.js planBatches`): each a slice of every stream, the whole
  wavefront chain each, the sample folded into the picture once after the last. Each photon is divided by its source's
  count for the whole sample, so the batches add up to the estimate one fill would have made. Live view, save, the
  timeline and the benchmark alike; where everything fits (one batch) a sample is what it was.
- **The cost (inferred, not measured):** a large picture's sample now traces everything it asks, so it takes longer
  than it did -- about in proportion to the rays and photons, where before the cap held it to one buffer. A 1080p live
  view with light tracing at one photon a pixel is now 2 batches (it had about an eighth of its photons before).
  Submissions are cut by each batch's share of the frame's time, so no submission is longer than before.
- The Render stats' Samples row says "× N batches" when there is more than one; the save panel's note says so before
  the render ("a sample in N batches: every pixel, every photon") where it said "N% of pixels per sample";
  `RT.lightReport()` gives the batches.
- **What to look at:** Save picture at the size that lost the light -- the blue light through the cubes and the pale
  streak across them should be there, as in the view. A large live view (over ~1.15 Mpx with light tracing) should show
  its caustics as a small one does, and be slower per sample than before. If a picture of any size still differs from
  the view in anything but resolution and noise, paste `RT.lightReport()` after the render with the size.
## 0.38.0 — 2026-10-08

**Values flagged as animated: kept live in the bake, listed at the top of the scene, and the only ones the timeline offers.**
The user: "the Bake mode could use some uniforms. e.g. for animations, any variables that need to be animated should
be a uniform. Ideally, in the scene tree, properties can be flagged ... and these appear at the top of the scene in a
list of adjustable properties. The parameters list can then reflect only those properties."
- **The flag.** A ◇ before a live value's name in the properties panel (a parameter, position, rotation, scale, a
  group's blend, a join blend, a material's field, a light's setting, an environment setting) flags it; ◆ unflags it.
  One undo step, nothing compiled. A compile-time value, and one bound to a component's parameters, have no ◇: no
  uniform carries them. Kept on the node or material as `animate: [...]`, by the parameter registry's names, so a
  duplicate, a paste and a library item keep it. No file format version: a builder that does not know it loses the flag
  and nothing else (as the locks).
- **In the bake.** A flagged value stays a uniform in the baked scene (builder/animate.js says which: position,
  rotation and scale are one matrix, so flagging one keeps all three; a light's look is three; a component parameter
  keeps what is bound to it). Moving it while the baked scene is shown writes it there, and the bake stays shown.
  Moving anything else goes back to the editing build, as before. Flagged values moving (a timeline playing) no longer
  count as edits the bake waits out, so a bake can start, and be swapped in, while they play; those moved during the
  swap are pushed again once it is in.
- **No bake during a recording or a save** (`RT.offscreenBusy`): a swap would change the kernels under the frames being
  made. Read in code before this change, with frames slower than 2 s; with flagged tracks it would have been the rule.
- **The list.** The scene's row shows an "animated" folder first: each flagged value's control (a change there is the
  same as anywhere else), ⌖ to show where it lives, ◆ to unflag. The tree marks a row with flagged values ◆.
- **The Parameters panel and the timeline's + track** offer only the flagged values while any are, behind an "animated
  only" box (on by default; unticked, everything as before; one choice for both). A track on a value not flagged keeps
  playing, its header saying "(not animated)": it still leaves the bake.

- **Which build is shown, at the status bar's right** (the user: "it's hard to see any difference. Maybe show the
  render mode in the status bar?"): `baked · N animated live` (in yellow) or `editing · data+grid+exact` (the editing
  build's mode, as the developer switches make it), with `· baking…` while a bake compiles. Its tooltip says what last
  left the bake and why ("ball radius moved: not animated", or an apply), and the console says it once a time:
  `[bake] left for the editing build: ...`.
- **A flagged position dragged stays baked** -- read in code, and now tested through the real builder (baker.test):
  the gizmo's every move and the position row write the matrix into the baked scene, rotation and scale too, and
  nothing is applied.
- **Tests > animated: what the flags cost** (the user: "make a test where speed is compared: no bake, scene as data;
  bake, no uniforms (as it was); bake, some uniforms (let's say 4)"). Each bench scene three ways, back to back, one
  camera and measured boxes: as data with the grid and exact hits (the editing build, as Tests > builds has it), baked,
  and baked with four objects' positions flagged through the model (each one's matrix a uniform again; the four named
  in the row). Also `BENCH.animated.run(...rows)` from the console. Not run: its numbers are the card's.
- **params.test green again after 0.37.0's colour depth.** It failed 10 checks on main: the field is in the shader
  only while above 0, so at 0 its live entry named no uniform, which the test took for a value that moves nothing. Read in
  code, it does move: live() asks for the compile at its first value above 0 (demo.js). The test now says so for such a
  field, and drives it through the real builder from the registry: the compile asked once, then written live, back to 0
  with no compile. Its entry's tooltip says the first value above 0 compiles. Nothing the page does changed.
- **Known, not changed: undo leaves the bake**, even of a flagged value only. Undo compares the editing build's text
  with the scene shown's, and a baked text is never codegen's (index.html step, demo.js sync), so it applies.

**What to look at** (I cannot see the picture or time it):
- **Tests > animated**, the whole run pasted back: per scene, the third row's "gpu ms" against the second is what four
  animated positions cost the bake; against the first, whether the bake with them still beats the editing build.
- The status bar's right end: `editing · ...` after an edit, then `baked · 1 animated live` about 2 s later with a
  position flagged. Drag that object with the gizmo: it should stay `baked`. Drag one not flagged: `editing · ...`,
  then `baked` again 2 s after letting go, its tooltip naming what moved.
- Flag a node's position (◇ before "position"), put a timeline track on it, and wait about 2 s for the bake. Play: the
  object should move, the status bar should stay `baked`, and there should be no `[builder] scene applied` line when
  play starts.
- A track on a value not flagged, played: the bake should leave, as before.
- The scene row's "animated" list: typing a value there moves the object as the row's own control does.
- Recording a video with flagged tracks: no `[bake] ... shown baked` line during the recording.
- **Not measured: what a kept uniform costs against a folded constant.** A guess: one matrix read per evaluation for a
  kept transform, small against the whole step. Tests > bake on a scene with one transform flagged, against the same
  scene unflagged, would say.

## 0.37.0 — 2026-10-08

**Glass absorbs with its thickness (Beer-Lambert).** The user: two boxes of one transmissive material, one thicker,
transmitted the same. Read in code: a transmissive material's colour multiplied the ray at every crossing
(`materials_pbr.js`, the two refraction branches) and nothing along the path inside, so thickness could not matter
(`roadmap/PLAN.md` B2 had it as not built).
- **A material's COLOUR DEPTH** (Properties › material, "colour depth (mm)", real millimetres whatever the scene's
  unit): the depth at which light inside has been filtered to the material's colour. A ray keeps colour^(L / depth)
  per channel over a path L inside, and the surface no longer tints it. **0, the default, is the old rule**, so every
  saved scene renders as it did, and its shader text is the same (the field is in the shader only while above 0: the
  first value above 0 is one compile, after that a slider like the others).
- **The scene file is version 19** (every material has the field; an 18 file gets it at 0). A builder of 0.36 refuses
  a 19 file. A library item or clipboard asset from before gets the field at 0 as it goes in.
- **The optics trace counts what a volume absorbs** in its own tally, inside "absorbed" (the Results panel shows it
  as "of it inside, between surfaces"), so balance still reads 0. It is not split per object or material: a ray does
  not know which object its medium is.
- **Memory:** the shade queue item is 256 bytes (240): ~2.24 M rays in flight in the 1 GiB budget (2.31 M), still
  over 1080p at one per pixel. The Ray is still 112 bytes: the medium's absorption sits in its padding.
- **Not covered:** an Optics-page source emitting into a medium (its `emitN`) starts with no absorption until its
  first crossing; a patterned material's colour as a medium is read at the world point.

**What to look at.**
1. **Tests › optics-absorption** (new): every row ratio 1 within a few 1e-3, balance 0. The 200 and 400 mm slabs
   must now differ (0.4610, 0.2304); the depth-0 rows must read the same as each other (0.2308).
2. **In the builder:** a glass material, colour a tint, colour depth e.g. 10 mm; two boxes of it, 5 mm and 20 mm
   thick. The thick one should be visibly darker and more saturated; with depth 0 they look alike as before.
3. **Speed:** any scene, before and after: shade does one more branch a hit and the queue item is 16 bytes larger.
   Not measured.

## 0.36.0 — 2026-10-07

**The engine works in metres; the surface tolerance is shown, set in micrometres, and never finer than f32 resolves.**
The user saw a fixed, texture-like pattern zoomed in on a 0.4 mm sphere in the RGBW mixer's beam (an mm scene), and
asked what the scene's unit does, for an engine in one fixed unit, and for every tolerance written down.
`lib/pathtracer/PRECISION.md` is the whole answer; this is what changed.
- **The likely cause of the pattern (inferred, not yet seen gone):** the automatic tolerance is 1e-4 of the scene's
  estimated size, and the estimate counts the lens's curvature radius as a size, so the RGBW mixer reads 105 mm and gets
  10.5 µm (computed with `builder/bounds.js` on the file): 5% of the sphere's radius. The march stops anywhere in that
  shell. The PRNG is not it (read in code: nothing is seeded by position). A tolerance per pixel is the next step
  (`roadmap/PLAN.md`); the estimate itself is not changed here.
- **The tolerance row could not go below 10 µm.** Its step was 1e-5 m, and Tweakpane rounds what is typed to the step:
  a typed 1 µm became 0, which is automatic. The row is now in µm with a 1 nm step (stored in metres as before, so a
  saved workspace reads the same). **It is a box to type into, not a slider, with no upper limit** (asked for,
  2026-10-08): the slider ran from 0 to 500 000 µm, where a few µm could not be dragged to. 0 is automatic.
- **The engine is in metres.** Rays, hits, tolerances, the camera as the kernels read it, photons, light faces, the step
  cache and the optics trace. The scene's own code, the builder and every host tool stay in the scene's unit; the two
  meet only at one boundary (`core/scene_api.js`: `sceneAt`, `materialAt`, `lightFaceAt`, ...), which converts every
  length that crosses and multiplies, never divides, so a metre scene's numbers are exact. `core/unitlint.js`, in
  check-shaders, refuses any engine function that reaches the scene's side another way, for every kernel and scene.
  The unit changes no precision (f32 is relative); this is for one meaning per number. Measured on lavapipe: the noise
  library in mm and re-authored in m give the same ends for 2304 of 2304 rays, plainly, as data and with exact hits
  (`builder/test/units.gpu.mjs`).
- **The unit did not reach the engine on every path:** a scene edited as data kept the old unit, `updateScene` refused
  it, and the builder's live sync pushed the radius but not the unit or the extent. All three carry them now.
- **The pick stopped at 1000 scene units:** 1 m in an mm scene, where the picture reaches 1 km. It is 1 km now.
- **The f32 floor.** The tolerance at a point is now `max(setting, 1 nm, 128 × 2^-23 × the point's largest coordinate)`,
  taken at every step of the march and the shadow rays. The old floor was 1e-7 of a scene unit, 0.1 nm in an mm scene.
  The floor is 15 µm at 1 m from the origin, 0.15 mm at 10 m, 1.5 mm at 100 m (computed). Why 128 spacings: below about
  a hundred, a normal by differences is f32's noise (measured in an f32 emulation, `core/test/floor.test.mjs`, not on a
  GPU). It changes the automatic tolerance only beyond 6.5 times the scene's size from the origin (65 m for a scene of
  10 m or more); there the march takes coarser steps than before.
- **Every tolerance in one table** (`core/tolerances.js`), checked against the code by `core/test/tolerances.test.mjs`:
  each use, its multiple and why. `node lib/pathtracer/core/tolerances.js 0.0000105` prints it at any tolerance;
  `RT.tolerances()` in the console resolves it for the scene showing.
- **The tolerance shown:** Render stats › Picture, *Surface tolerance* and how it was chosen; and a line under
  Renderer › Ray marching.

**What to look at:**
1. **The pattern.** RGBW_mixer with your sphere. Render stats › Picture should read *Surface tolerance 10.5 µm,
   automatic: 1e-4 of the scene's 105 mm*. Then, with Developer on, type **1** in Renderer › Ray marching › Surface
   tolerance (µm) -- a box now, no slider; 2000 should take as well (or `RT.set({ eps: 1e-6 })` in the console). If the pattern goes, or shrinks to a few pixels, it was
   the tolerance. 0 puts automatic back. Tell me which.
2. **Every bundled scene looks as before.** Metre scenes go through the same arithmetic (times 1); mm and cm scenes
   should match within noise. A large floor or ground far out from the origin is where a difference would show, if any.
3. **In an mm scene:** measure pins, drops and gizmos land on the clicked point; the Optics page's rays and detector map
   are where they were; an orthographic camera works.
4. **Tests › scale, optics-refraction, small-caustic and light-vs-emitter** read as before.

## 0.35.4 — 2026-10-07

**A shadow offset from an object standing in front of a lamp-lit surface, fixed (the cause read in code, not yet seen
gone).** The user saw it: a lamp's light off a diffuse surface toward the camera, an object partly in front of that
surface, and a shadow round the object "as if the rays are blocked by the object but there is a bit of an offset".
- **What was wrong:** a light's photon reaches the picture through a shadow ray from where it lands, P, to the camera
  (`ltConnect`, `materials_pbr.js`). That ray asks whether the camera sees P, so it must run along the camera's own line
  of sight to P. It started a little off the surface (h = 20 times the march epsilon: 2 cm in a room, 2 mm in a 1 m
  scene) along the surface's normal, but kept the direction from P. That made a line parallel to the line of sight, h
  to one side of it all the way to the camera. Seen from the camera, an object at distance D was tested h/D away from
  where the picture draws it. The light past the object was cut off beside its edge, not at it: a dark band on one side
  of the object, and the surface's light painted onto the object on the other. The nearer the object is to the camera,
  the wider the band. Arithmetic, not a measurement: a room, the camera 1.5 m above the floor, an object 1 m away, 1200 px over 50°:
  the band was 15 to 27 px.
- **The fix:** the shadow ray now starts on the line of sight itself, as far along it as lifts it h off the surface.
  Only that stretch beside P, within h of the surface, goes untested. At grazing views (the line within about 15° of the
  surface) the start would run far along the line, so it stops at 4 h and takes the rest of the height along the
  normal, aimed at the camera. There the line is off by at most the angle the leftover height subtends at P, under a
  pixel in the case above. Light sampling toward a light's face already re-aimed from its moved start; the camera
  connection was the one shadow ray that did not.

**What to look at:** the scene where you saw it, as it was. The band beside the object should be gone, with the
surface's light now meeting the object's silhouette. Check both sides of the object: the dark band on one side and any
glow on the object's opposite edge. If a dark rim is still there **all round** the object, evenly, it is something else.
Tell me, and say which Quality preset and which light-source switches were on.

## 0.35.3 — 2026-10-07

*0.33.11 on its branch (lampmaker/RAYTRACER_WEBGPU#57). Renumbered when main came in: main had gone on from 0.33.10 to
0.35.2, and a fix raises the version above main's.*

**The lens-assembly copy rows culled without 0.33.1's safety net, fixed** (found checking 0.33.1 against its own rule: a
box that leaves out a part with a surface is never culled by).
- **What was wrong:** 0.33.1 gives no culling box to a group with a part that found no surface; the culling asks the boxes
  which parts those are. It asked in a way that took "can't say" for "none". The benchmark's view of the boxes for the
  lens-assembly copies (each copy given its original's box) could not say. So on Tests › scaling's copy rows and Tests ›
  scenedata's *lens assembly x n* rows, every node -- the stage and the original assembly too -- was culled as if no part
  had gone unfound: the optics bench, as data, where the pillars were found. Every other row, and the page, had the net.
- **The fix:** that view answers the question too, each copy with its original's answer. And boxes that cannot answer are
  now refused with an error rather than culled by, so the next view of the boxes cannot drop it silently.
- **0.33.1 checked again on the optics bench,** on a software GPU (lavapipe), boxes measured as the bench measures them:
  the pillars' cylinders n22, n24 and n28 have boxes, and the pillar's box reaches past the surface 0.33.0's box left out
  (its own z 12.73, the surface at 11.15). The four cylinders still without one (n25 and its three counterparts) are each
  inside a shell group whose own box holds them: their code makes them 0.70 tall, the shell's box is 0.85.

**What to look at:** nothing should move. Measured on the same software GPU, with the view answering: every node the
copy rows' records cull, stage and copies, still has its box at x 1, x 16 and x 32 (7/7, 52/52, 100/100). So Tests › scaling and Tests ›
scenedata's lens rows cull as before, and should time as before. If one of those rows ever lists a group without a box
because "a part found no surface", that is the net doing its job.

## 0.35.2 — 2026-10-07

*On main as 0.18.1 (lampmaker/RAYTRACER_WEBGPU#56). Renumbered when main came into this branch: this branch had gone
on from 0.18.0 to 0.35.1 first, its 0.19.0 dated three days before this entry, so the only number keeping this changelog
in version and date order is above this branch's.*

**Fixed**
- **Applying a group's own recipe changed the document.** If a group's first shape kept a join, a recipe that said
  "as the group is" removed that join when applied. A join on the first shape does nothing to the picture: the model
  keeps it, dormant, so a node dragged to the top still has its join when it is dragged down again. But the recipe
  has no way to write it, because the first line's op belongs to the other names on it. Applying used to write union
  over it anyway. OpticsBench's and OpticsBench2's lens holders are like this: their first box joins by intersect.
  This is the one failure in `builder/test/recipe.test.mjs`. It was there before 0.18.0.
  - A recipe that keeps the same first shape now leaves that shape's join and own blend as they are. Every shape after
    it still takes exactly what the recipe says. A recipe that moves another shape to the top still clears that
    shape's join, as before, and the shape that was first takes the join written for it.
  - The scene files are unchanged: a dormant join is valid (`model.js`, `OPS`).

**What to look at**
1. OpticsBench, the first **lensholder** group. Its recipe says *as the group is*. Press **Apply recipe**: the picture
   should not change. Then drag the first **box** below **box copy** in the tree. It should show **∩** and cut the
   holder as an intersection, as it does without the Apply first. Before this fix it showed ∪ after an Apply. Undo
   afterwards.

## 0.35.1 — 2026-10-07

**What you saw of 0.34.2, recorded** (`roadmap/ARCHITECTURE.md`, *The bake in the background*: the lights at the swap). A
document only. With the bake on, the light from the light sources stays on through the swap: no more flash.

**What to look at:** nothing new in the page.

## 0.35.0 — 2026-10-07

**Bake when the edits stop is on by default** (`core/uniforms.schema.js` sceneBake; you, 2026-10-07: "make bake default
on"). A feature.
- **What changes:** once nothing has been edited for two seconds, the builder's scene is compiled again in the
  background with every value a constant and swapped in, the picture kept; the first edit puts the editing build back.
  Until now that was a developer setting you had to switch on.
- **Saved projects keep what they saved:** every renderer setting is saved with a workspace, so a project saved with the
  bake off opens with it off. A new project, or a first visit, has it on. It is in Renderer › Performance (a developer's
  row) either way.
- **Not carried through a bake, as before:** with the step cache on, each bake's swap starts the picture over (the cache's
  box is set again for the new scene, and that restarts it). The Optics page's first trace after a bake compiles the
  optics kernels for the baked scene.

**What to look at:** open a new project (or one saved with the bake on), edit, wait two seconds: the status line should
say the scene was baked, and the picture should go on without a jump, the light from the light sources included (0.34.2).

## 0.34.2 — 2026-10-07

**The lights no longer go off for a frame or two after a bake** (`lib/pathtracer/optics/kernels.js` prog_opt_photons,
`optics/index.js` the picture's photon source). A fix.
- **What was wrong (read in code; whether it is all of what you saw is yours to say):** the kernel that sends the
  light-traced lights' photons into the picture was made again for every scene shown, because it took the scene's
  uniforms into its uniform struct. It reads none of them. Until it was made, a frame had no lights' photons. The bake
  swaps in a scene whose only uniforms are its culling boxes, so a new struct and a compile, and the picture is kept
  through the swap: those frames, without the lights' photons, were averaged into it.
- **Now** the kernel is made once, without the scene, and every scene finds it ready, the baked one and every edit build
  after it. `optics/test/drawn.test.mjs` swaps in a scene with other uniforms and checks it is ready at the first frame
  with nothing compiled; the code before this fails that check.

**What to look at:** with *Bake when the edits stop* on, edit a scene with light-traced lights (the RGBW mixer, an LED
scene), let it bake, and watch the light from the light sources through the swap: it should not dip. Also the first
frames after an ordinary edit, which went through the same gap.

## 0.34.1 — 2026-10-07

**What you saw of 0.34.0, recorded** (`roadmap/ARCHITECTURE.md`, *Made the builder's way*). A document only.
- The showcase, the demo and the Noise library with boxes on the dear nodes only: the same pictures, nothing missing.
- Renderer › Performance without "Skip far objects", and a saved project loading.

**What to look at:** nothing new in the page.

## 0.34.0 — 2026-10-07

**The builder puts a bounding box only on the objects worth one, and the setting "Skip far objects (bounding boxes)" is
gone** (`builder/codegen.js`, ONLY THE DEAR ONES; `core/uniforms.schema.js`; you, 2026-10-07: "yes, make dear-only the
default and remove the setting"). A feature.
- **What changes:** every scene the builder makes tests a box only on a top-level node dearer than its box: a group, a
  relief, an outline (a revolve or an extrusion), code with no answer along the ray. One plain shape (a sphere, a box, a
  cylinder, a lens, a light's face) gets no box test. Until now every top-level node had one, or none with the setting
  off. Your two boxcost runs: against every box, the showcase 13 and 15% faster, Surface materials 4 and 5%, the demo
  level, the Noise library 6% slower (still 72% faster than no boxes).
- **The setting is gone** from Renderer › Performance. A saved workspace that has it opens with a console line naming it
  ignored.
- **The bench keeps every box and none** for itself (Tests › boxcost, and the "bounding boxes off" rows). Every other
  codegen and baked row now times the builder's boxes, so a row compared with a run before 0.34.0 is a different build
  where the scene has plain shapes. Expected from boxcost (not measured on those rows): the Noise library's about 6%
  higher, the showcase's lower. In Tests › bench, Surface materials now has no box test at all, so its "bounding boxes
  off" row is the same text as the row before and says "= row 25".
- **Unchanged:** a scene as data still tests every record's box; what that costs on a plain shape was never measured.
  Every box is still measured in the page (the records, the grid and the step cache use them all).

**What to look at:** open the showcase, the demo and the Noise library and check each picture is as before, nothing cut
off or missing. A box too small now shows only on a group, a relief, an outline or code. Renderer › Performance should
list Bake, the three scene-as-data rows and the four step cache rows, and no "Skip far objects". Open a saved project
and check it loads (the console may name `cull` as ignored).

## 0.33.10 — 2026-10-07

**Your second boxcost run, recorded** (`roadmap/ARCHITECTURE.md`, after the first run's table: *Again, on 0.33.9*). A
document only.
- **It replicates the first:** every row within 4% of it, the drift row -0.3%. Two timings of one text in one run differ by
  about 4% (Surface materials' dear row is the boxes-off text again), so that is the smallest difference this test calls.
- **Dear only against every box measured, twice:** the showcase -14.8% (-13.4% before), Surface materials -4.4% (-4.6%),
  the demo level (+0.6%, -1.1%), the Noise library +5.8% (+5.6%), its occlusion higher both times. Against no boxes at all
  the Noise library is still -72% with dear only.

**What to look at:** nothing new in the page. Whether dear-only becomes the way the builder makes boxes is still yours to
say.

## 0.33.9 — 2026-10-07

**Your boxcost run with the dear-nodes row, recorded** (`roadmap/ARCHITECTURE.md`, under *The closest object per cell,
counted*: the measured table after the fourth row's description). A document only.
- **Boxes on the dear nodes only is the best box mode, or level with it, on all four scenes:** -72% against boxes off on
  the Noise library (all boxes: -74%), the boxes-off scene on Surface materials, -8% on the demo (all boxes: -7%), -5% on
  the showcase (all boxes: +9%).
- **A box on a plain shape costs twice:** its test, and a shorter step, because a skipped node is stood in for by its
  box's distance. With every box measured, fewer rays finished in the first march pass on Surface materials, the showcase
  and the demo than with no boxes; on the Noise library more, since its relief groups' own distance is the shorter one.
- Nothing in the page changes yet: the builder still makes every scene with all its boxes or none.

**What to look at:** nothing new in the page. Whether dear-only becomes the way the builder makes boxes is yours to say
(the reply that came with this version).

## 0.33.8 — 2026-10-07

**Tests › boxcost has a fourth row per scene: boxes on the dear nodes only** (`bench/boxcost.js`; `builder/codegen.js`,
the generation option `cull: 'dear'`, which only the bench sets). A test.
- **Why:** your boxcost run of 0.33.5 showed that on Surface materials, the demo and the showcase the bounding boxes'
  tests cost about what the culling saved. Those scenes are one plain shape a node, whose box test costs about as much as
  the shape itself.
- **What the row does:** the scene is made with a box test only where a top-level node is dearer than its box: a relief,
  an outline, code with no answer along the ray, any group. One plain shape (a sphere, a rounded box, a cylinder, a lens,
  a light's face, ...) is evaluated with no box test. Those boxes are measured as in the other rows.
- **On the four scenes**, counted from the generated text: the Noise library 6 box tests of 14, Surface materials none
  (that row is the boxes-off scene timed again, marked "= row"), the demo 6 of 8, the showcase 2 of 13.
- Nothing changes in the page: the builder still makes every scene with all its boxes or none.

**What to look at:** run **Tests › boxcost** (or `BENCH.boxcost.run()`) and paste the whole result. Per scene, compare
"boxes on the dear nodes only" against "boxes measured" and "boxes off". The picture should not change between a scene's
rows.

## 0.33.7 — 2026-10-07

**The LEDs light the picture again with exact hits on** (`lib/pathtracer/optics/index.js`, the picture's photons). A fix.
- **What was wrong:** with the scene as data and exact hits on (`sceneExact`), no light from RGBW_mixer's LEDs reached
  the floor or the detector in the picture: in the Optics preset the spot was simply gone, and in Standard the detector
  was darker. The analysis numbers (the optics trace) were never affected.
- **Why:** the kernel that makes the lights' photons for the picture was never given the three settings the march
  tolerance is made of, so it stepped each photon off its LED's face by nothing. Marching by distance let a photon
  leaving its face go on. Exact hits found the face just behind it, moved the photon back across it, and the face's
  black back took every one.
- **The fix:** the photon kernel is handed those three. A test (`optics/test/drawn.test.mjs`) now walks that kernel's
  text from its entry point and fails if it reads any setting it is not handed.
- **Measured on the container's software GPU** (RGBW_mixer as data, Optics preset, one camera): the picture's mean 3.6
  with exact hits before the fix, 22.9 after, and 22.3 without exact hits.

**What to look at:** RGBW_mixer with Scene as data and exact hits on, in the Optics preset and in Standard: the LEDs'
spot on the detector and their light on the floor, as with exact hits off.

## 0.33.6 — 2026-10-07

**Your filled-once and box-cost runs, recorded** (`roadmap/ARCHITECTURE.md`: *The cache filled once on the baked
build*, and the measured table under *The closest object per cell, counted*). A document only.
- **The step cache filled once on the baked build:** 20.5% faster on the optics bench, which makes baked with the cache
  that scene's fastest build. The showcase is 7.7% faster, at the edge of what a run can tell apart. The other scenes are
  level, except the Noise library, which this run cannot answer: its baked row read 23% faster than the same kernels an
  hour before.
- **What the bounding boxes' tests cost:** about a third of the GPU time on Surface materials, the demo and the showcase
  when every box is tested. The culling saves about as much as that, so on those three scenes the boxes come out between
  10% slower and 7.5% faster than no boxes at all. On the Noise library they save 74%.
- **What it points at, untested:** a box test only for nodes dearer than their box (reliefs, groups, code), not for one
  plain shape.

**What to look at:** nothing new in the page. The next step is yours to choose (the reply that came with this version).

## 0.33.5 — 2026-10-07

**Your builds run, recorded** (`roadmap/ARCHITECTURE.md`, beside the first builds run: the run of 0.33.1 · 4c78e94 on the
Pascal). A document only.
- **It ran on 0.33.1, so its cache rows are the old ones** (the cells ahead, filled as rays go), not the filled-once rows
  of 0.33.3. Whether the cache filled once beats the baked build is still open.
- **It agrees with the first builds run:** every scene's fastest build is the same row. That is baked on five scenes,
  baked with the cache on the Noise library, and data with the grid and exact hits on Surface materials. On the material
  test codegen and baked are level. 32 of 37 rows read within 4% of the first run.
- **One row moved beyond the noise:** the Menger cubes as data, 10.6% faster. Its grid's cells shrank from 124 m to
  16.5 m with the box fix (inferred cause). It is still 28 times codegen.

**What to look at:** reload until the page says 0.33.5. Then run only the baked rows against the baked, filled-once rows,
about three minutes (inferred from this run's rows): `BENCH.builds.run(2,3,7,8,12,13,17,18,22,23,27,28,35,36)` in the
console, and paste it back. Then Tests › boxcost.

## 0.33.4 — 2026-10-07

**Tests › boxcost: what the bounding boxes' tests cost** (you: "yes, add the box test cost row"). A test only.
- **Why:** the closest object per cell (0.33.3) would mostly save box tests, and whether those cost enough to matter only
  your card can say.
- **The rows:** the Noise library, Surface materials, the demo and the showcase, each three ways back to back.
  *Boxes off* is the scene made without boxes. *Boxes that never cull* is the same scene with its boxes, each set to hold
  everything: every box is tested at every step, and every object is still evaluated, as with no boxes. *Boxes measured*
  is the boxes as every bench row has them. The last row repeats the first as a drift check.

**What to look at:** run Tests › boxcost and paste it back. In each scene, *never cull* minus *off* in "gpu ms" (and march,
occlude) is what the box tests cost, with the same evaluations and steps. *Never cull* minus *measured* is what culling
saves. The picture should not change between a scene's three rows.

## 0.33.3 — 2026-10-07

**Tests › builds with the step cache filled once, and the closest object per cell counted** (you: "yes, add the builds
rows and do step 2").
- **Tests › builds:** its two cache rows are now the cache filled once, own cell (they were the cells ahead, filled as rays
  go): *baked, step cache filled once* and *as data, grid and exact hits, step cache filled once*. Your stepcache run had
  filled once faster than as rays go everywhere, and the own cell the better look on four of six scenes.
- **Step 2, the closest object per cell, counted on a software GPU** (steps and evaluations, not time; the full table is in
  `roadmap/ARCHITECTURE.md`, *The closest object per cell, counted*). Near surfaces the bounding boxes already leave one
  node to evaluate per step, or none: a scene call evaluates under one top-level node on six of seven bench scenes. So
  storing each cell's nearest object would save few evaluations (30% on the optics bench, 0 to 8% elsewhere). It would
  mostly save box tests (27 to 86% of them on six scenes), and what those cost is not known. **Not built**; the cheap test
  of what box tests cost is written down there.
- **Found on the way:** the box fix of 0.33.1 also made the optics bench's march take 15% fewer steps (21.9 a camera ray,
  25.7 before, software GPU): its boxes are tighter.

**What to look at:** run Tests › builds and paste it back. Read each scene's *baked, step cache filled once* row against
*baked*: that answers whether the cache pays on the build the bake mode shows.

## 0.33.2 — 2026-10-07

**Your stepcache run, recorded** (`roadmap/ARCHITECTURE.md`, *The step cache filled once, read-only*: the run of
0.33.1 · 4c78e94 on the Pascal). A document only.
- **Filled once is faster than filled as rays go in every scene,** with the same lookups: 11 to 22% less GPU time with
  the own cell on five scenes, 6 to 20% with the cells ahead.
- **Against the cache off:** the optics bench 27% faster, the optics bench as data 19%, OpticsBench2 and the showcase
  10%. The material test and the demo are level (within 7%, about how much two rows of the same kernels differed).
  Filled as rays go, the cache was no faster than off on four of these six scenes.
- **The own cell beats the cells ahead on four of six scenes.**
- **An edit frame's fill** costs 0.2 to 3.3 ms on the codegen scenes and 26 ms on the optics bench as data.

**What to look at:** nothing new in the page. The open question is whether filled once also beats the baked build, the
fastest build in your builds run.

## 0.33.1 — 2026-10-07

**Bounding boxes that left out part of a group, fixed** (found while building 0.33.0; you asked for it to be done here).
- **What was wrong:** the box measurement starts with a coarse search over the whole scene and widens it while something
  is missing. In the optics bench it widened three times, to 35 m cells. After that it kept only the widest search's
  findings, and the pillars' thin cylinders, found by the first search, were found by none after. So each lens pillar's
  box was measured without its top cylinders. With the scene as data, which culls groups inside groups, a ray near those
  cylinders could step past them: 0.61 by the box where the surface was 0.23 away.
- **The fix:** each part keeps what the finest search found, and is measured again from there. A part looked for afresh
  starts from the first search's cells, not the widened one's.
- **And a safety net:** a group with a part that can add to its shape but found no surface now gets no box at all, so it
  is never culled rather than culled wrongly. The console's `CULL_REPORT()` says which part. On the bench scenes, measured
  on a software GPU, no group is left unculled by it.
- **Counted on a software GPU,** objects with no box: the optics bench 24 -> 4 (the four left are inside the shell
  group, whose own box covers them), the Noise library 6 -> 1, the Menger cubes 3 -> 2 (the two hidden boxes). The
  Menger cubes' marble, given a box about 1 200 m wide until now, is about 160 m.

**What to look at:**
- The optics bench with *Scene as data* on: the tops of the three lens pillars, the cylinders the lens holders sit in.
  They should look whole and the same as with it off. If anything in them changes, that is where the boxes were wrong.
- The Menger cubes, as data with the grid: the marble's box was most of the grid's spread, so a speed difference there is
  possible. Measured only if you run Tests › builds again.

## 0.33.0 — 2026-10-07

**The step cache filled once, read-only** (your question: "writing the cache once and then using it in read-only mode
during the trace, does that help"). A new developer setting, *Step cache: fill*, in Renderer › Performance:
- **0, as rays go:** as before. A cell is filled the first time a ray asks for it.
- **1, once:** a pass of its own fills every cell before the frame, again whenever the scene changes (not when the camera
  moves). The march and the shadow rays then only read the cells: no atomic operations, no fill steps. Switching 0 to 1
  rebuilds the march.
- **2, every frame:** that pass before every frame. It is what a live edit pays, there to be timed.
- **No more orange around the bounding boxes** (your note: "I see orange glow around objects but also around their
  boundingboxes"). The fill now measures the distance to the objects, not to their boxes.
- **Counted on a software GPU** (steps, not time): with the cells filled once, a camera ray took fewer steps than with
  them filled as rays go on every bench scene. The optics bench went from 20.4 to 11.2, the material test from 20.0 to
  14.6, the demo from 33.5 to 32.9. Every ray still ended where it does with the cache off.
- **Tests › stepcache** has three new rows a scene: filled once (own cell, cells ahead) and filled every frame.

**Found on the way, and fixed in 0.33.1:** in the optics bench, the box measurement misses four thin cylinders in each
lens pillar. As data, that pillar's box leaves them out, so a ray can step past them.

**What to look at:**
- Performance: the step cache on, *fill* 1, *show its cells* ticked. The orange shell should hug the objects, with none
  around the boxes. The picture itself should not change when you switch the fill between 0, 1 and 2.
- Tests › stepcache, run and pasted back. Read each scene's "filled once" rows against its lazy rows with the same looks.
  The "every frame" row's `stepcache_fill` time is the price of one edit frame.

## 0.32.2 — 2026-10-07

**The step cache's cells shown: only the ones near surfaces** (your note: "the green is not useful; make the cells clear
instead of green. Now it's just a huge green blob with nothing else visible").
- **Green is gone.** A cell whose ball reaches past it, where a ray takes a step without asking the scene, is now clear,
  like an empty one.
- **Only the orange fog shows:** cells filled near a surface, whose ball is smaller than the cell. There a ray still
  evaluates the scene, so this is the band the cache cannot help with.

**What to look at:** Developer settings › Performance, the step cache on (1 or 2) and *show its cells* ticked. Let it
render a few seconds. You should see the objects, wrapped in a thin orange shell where the cache has been filled, with
nothing over the open space between them.

## 0.32.1 — 2026-10-07

**Your builds run, recorded** (`roadmap/ARCHITECTURE.md`, *Every option a build, not a test*: the run of 0.32.0 · 1eea9a8
on the Pascal). A document only.
- **Baked is the fastest build on five of the eight scenes,** 16 to 63% below codegen in GPU time, and level on the
  material test and the Noise library. The bake mode renders that build.
- **Two exceptions:** the Noise library is fastest baked with the step cache (11% below baked); Surface materials as data
  with the grid and exact hits (15% below baked).
- **The step cache costs more than it saves on most scenes:** slower on six of seven baked, faster only on the Noise
  library.
- **The data build is far off on the demo and the Menger cubes** (12.6 and 30.5 times codegen), a known gap made worse by
  exact hits.
- **The run's drift was 0.4%.**

**What to look at:** nothing new in the page.

## 0.32.0 — 2026-10-07

**Tests › builds: which build renders fastest, side by side** (your aim: "find the optimal solution(s) for highest
render speed and most flexible editing"; `bench/builds.js`).

For editing the answer is already the scene as data: it compiles nothing per edit. For rendering, the candidates were
each benched on their own (Tests › bake, › scenedata, › stepcache), never side by side and never combined. This runs
them together, per scene, on your card.
- **Each bench scene five ways, back to back,** with the same document, camera and measured boxes:
  - codegen (today's default);
  - baked (what the bake mode shows once the edits stop);
  - baked with the step cache;
  - as data with the grid and exact hits (the editing build);
  - that with the step cache.
- **Each row is its own build, compiled uncached,** so *compile ms* is what making it costs.
- **The Menger cubes have no cache rows:** their measured boxes include the marble, about 1200 m across, which would
  spread the cache over a kilometre. That is a known bug of the box measurement.

**What to look at:** run Tests › **builds** (about 40 rows, several minutes) and paste the report. For each scene, read
*gpu ms*, *march* and *occlude* down its rows: the lowest is the build to render that scene with. The picture should not
change between a scene's rows.

## 0.31.0 — 2026-10-07

**Bake mode: edit as now, render baked once the edits stop** (your ask: "yes, build the bake mode"; `builder/baker.js`;
`roadmap/ARCHITECTURE.md`, *The bake in the background*). In 0.28.1 your card measured baked kernels marching 16 to 68%
faster than codegen's, on seven of the eight bench scenes.
- **A switch in Renderer › Performance:** *Bake when the edits stop*, off by default.
- **On:** two seconds after the last edit, the scene shown is compiled again in the background, with every value written
  into the kernels as a constant. The editing build stays on screen while that compiles.
- **When every kernel is ready,** the baked scene is swapped in from the cache. The picture is kept, because it is the
  same picture: the samples so far and the light map stay.
- **The first edit after** (a value dragged, a node added, an undo) puts the editing build back at once, from the
  cache, and the bake starts again once you stop. The same scene baked again is found in the cache, so it does not
  compile twice.
- **Works with the scene as data or as code.** The culling boxes stay live in the baked scene, as the bench measured
  them. The status line says what each bake cost.
- **Not yet:** the optics module's kernels are not compiled ahead. It compiles its own for the baked scene the next time
  it runs.
- **Fixed, Tests › stepcache:** since 0.29.0 the cache off, own cell and cells ahead are three different builds, but the
  bench still compiled them once and called the other rows "= row 1". Each mode is now timed with its own compile.

**What to look at:**
- **Developer settings › Performance:** tick *Bake when the edits stop* and leave the scene alone for a few seconds.
  The status line says "baked: … kernels compiled in … s, swapped in … ms". The picture should go on converging, with
  no restart and no change.
- **Then drag a value:** it should move as before, with at most a short pause on the first step.
- **Tell me** whether the frame rate is visibly higher while baked, and whether the picture stutters while a bake
  compiles in the background (not measured; your card is the judge).

## 0.30.0 — 2026-10-07

**A Performance box in the Renderer panel** (your ask: "a special section in the render settings (now everything is
under ray marching) to test/optimize all the render & compile stuff ... with a tooltip (hover) section explaining. Make
sure that things that don't work together cannot be switched on both").

The box holds every way the scene can be built:
- the scene as data, its candidate grid, its exact hits;
- the bounding boxes;
- the step cache, its cells and the view of them.

*Ray marching* keeps only the march's own settings. The box shows with the Developer switch, as the rows did before.
- **A paragraph at the top** says that each switch is a different build: turning one compiles again, and an option
  switched off is not in the kernels at all (0.29.0).
- **Hover a row** for what it does, what it costs, and what it needs.
- **What does nothing without another setting is greyed and cannot be ticked** until that setting is on: the grid and
  exact hits without the scene as data, the step cache's cells and view without the cache. The tooltip names what to
  switch on. A value set while greyed is kept for when it applies again.

**What to look at:** Renderer › *Developer settings* on, then the **Performance** box under *Ray marching*.
- Hover each row and the box's title.
- Untick *Scene as data*: the grid and exact hits grey out.
- Set the step cache to 0: its cells and view grey out.

## 0.29.0 — 2026-10-07

**An option switched off costs nothing now** (your question: "if the bounding boxes are not used, does it still slow down
the code?"; `roadmap/ARCHITECTURE.md`, *Every option a build, not a test*).

Until now, two options stayed in the kernels when switched off, and a uniform skipped them at run time:
- **the step cache:** its lookups in every march and occlusion step;
- **the bounding boxes:** every box test, in codegen's scene and in the scene as data.

Each is now compiled in only when it is on, as you suggested ("they could be different compile options"). Off, the code
is not in the kernels at all, which the tests check by comparing kernel text.
- **Step cache on or off, or its cells shown:** the march and occlusion kernels, or the display pass, are built again.
  The compile bar shows it. Off, they are exactly what they were before the cache existed, and the cells use no memory.
- **Bounding boxes on or off** (the developer setting *Skip far objects*): the builder's scene is made again with or
  without them, like the *Scene as data* switches.
- **The benchmark:** the "bounding boxes off" rows are now scenes made without boxes, not the same scene with a switch
  off. A step cache row's kernels are built before its scene is timed or compiled. Nothing is compiled twice.

**What to look at:**
- **Developer settings, the step cache:** turn it on and off, and the view of its cells. Each change shows the compile
  bar, then the picture comes back the same.
- **Developer settings, *Skip far objects*:** turn it off in the builder. The scene compiles again and looks the same,
  only slower. Turn it back on.
- **Tests › bench and Tests › scaling:** the "bounding boxes off" rows now time a scene with no box code at all. Paste
  them if you run them, to set against the old rows.
- **Tests › stepcache:** the "off" rows are kernels without the cache now, not with it skipped. Paste it if you run it.

## 0.28.1 — 2026-10-07

**Your bake run, recorded** (`roadmap/ARCHITECTURE.md`, *A bake mode, tested*: the run of 0.28.0 · 273aa0d on the
Pascal). A document only.
- **Baked is faster on seven of the eight bench scenes:** the march 16 to 68% faster, occlusion 15 to 67%. The optics
  benches gain most: march and occlusion a third of codegen's, a sample 59% faster on the optics bench.
- **The Noise library is the exception:** 5% slower to march, 11% to occlude. Not yet explained.
- **Compiling baked is no slower anywhere:** OpticsBench2's scene kernels were ready in 2.5 s against 11.7 s, the
  optics bench's in 4.6 s against 8.5 s.
- **The GPU times held within 2%** from the first row to the drift check at the end. The wall clock rose 12%, from the
  page's CPU side.

**What to look at:** nothing new in the page.

## 0.28.0 — 2026-10-06

**Baked against codegen, a bench test** (your question: "what if the default mode is data, and there is a bake mode that
compiles everything ... Could that be better than current codegen?"; `roadmap/ARCHITECTURE.md`, *A bake mode, tested*).
- **Tests › bake:** each of the eight bench scenes twice, back to back. First as codegen makes it, every value (each node's
  transform, culling box and sizes, the materials) a uniform read at every step. Then baked, every value a constant
  written into the kernels, which the compiler can fold. Same document, camera and measured boxes; each row compiled
  uncached, so "compile ms" is what a bake costs.
- **The culling boxes stay uniforms in both:** the bench measures them after the compile, and a box not yet measured
  culls nothing. So the rows compare everything but the box values.
- **Checked on a software GPU:** on Dawn, the baked march, occlusion and surface kernels compile for all eight scenes.
  Every camera ray ends exactly as codegen's, with the same steps (one ray of 18 432 differs by one step).
  `check-shaders` builds and compiles the baked scenes too.
- **Engine:** a scene constant may now be a vector or a matrix (`builder/bake.js` uses that). Scalars are written as
  before; the golden shaders are unchanged.

**What to look at:** run Tests › **bake** and paste the report. For each scene, read the baked row's `march`, `occlude`
and `surface` against its codegen row, and its `compile ms`.
- **If baked is clearly faster,** a bake mode beats today's codegen: data for editing, baked for rendering.
- **If not,** today's codegen already is the bake.

The picture should not change between the two rows.

## 0.27.1 — 2026-10-05

**Main merged in: Save picture develops the light first, and the scene's row is the tree's root again** (main's 0.17.0 and
0.18.0, here 0.26.0 and 0.27.0 below).
- **Renumbered.** Main's two entries are 0.26.0 and 0.27.0 here. This branch had already used 0.17.0 and 0.18.0 for its
  own work, which its documents cite (the grid in the page, exact hits). Its entries 0.17.0 to 0.21.0 are also dated a
  day before main's two. So the only numbers that keep this changelog in version and date order are above this branch's.
  Where main's files cite them (FEATURES.md, UI_PLAN.md, three browser checks), they now say 0.26.0 and 0.27.0.
- **One conflict of substance: the display pass.** Main made what the display does to a pixel one function,
  `displayPixel`, shared by the live view and its new develop pass for saved pictures. This branch had put the step
  cache's cells view (0.25.0) into the live display. The view now comes after `displayPixel`, in the live display only,
  so a saved picture never carries it.
- **Two things only the merged tree had wrong, both caught by main's `develop.test.mjs`:**
  - Main's develop pass wrote a uniform `time`, which this branch removed in 0.22.3 because no shader read it.
    tinywebgpu refuses a name the pipeline doesn't declare, so every develop would have thrown. It no longer writes it.
  - The cells view's uniforms had come into the develop pass through the display's shared list. They're now the live
    display's own (`DisplayUniformTypes`), and its text is placed so that both passes still share `displayPixel` letter
    for letter.

**What to look at:** Save picture as main's 0.27.0 entry below lists it. Then, with Step cache at 2 and *show its cells*
on, save a picture: the fog must be in the view and not in the PNG.

## 0.27.0 — 2026-10-05

*On main as 0.18.0. Renumbered when main came into this branch (0.27.1): this branch had used 0.17.0 and 0.18.0
first, and its entries 0.17.0 to 0.21.0 are dated a day before main's two, so the only numbers keeping
this changelog in version and date order are above this branch's.*

**Added**
- **Develop a picture before saving it.** Save picture now renders first and saves second:
  - **Render** keeps the result as light: the linear values in cd/m², a copy on the GPU. The old Save PNG wrote the
    8-bit picture straight away, so the exposure and tone curve had to be right before a render that can take minutes.
  - **Develop** shows it on a preview with its own **EV100**, a **Meter** button (the EV from the picture's median
    luminance, as the view's Meter does), the **tone curve**, **contrast**, **saturation** and **brightness**. A
    luminance render can also be shown in false colour. A lux-on-surfaces render shows its false-colour scale instead.
  - The settings start as **the view's for that render**: the exposure the display used, the metered one when
    auto-exposure was on. Saved untouched, the PNG is the picture the old Save PNG wrote, including the optics paths
    when they are drawn. **As the view showed it** puts those settings back.
  - **Save PNG** writes at the full size, as often as wanted, from one render. A second render keeps the develop
    settings. **Discard the picture** gives back its memory (16 bytes a pixel: 33 MB at 1920 × 1080).
- The display and the develop pass share one function for each pixel's exposure, tone curve and grading
  (`rendertoscreen.js` `displayPixel`), so the two cannot drift apart. `RT.saveImage` is unchanged.
  `RT.renderPicture` and `RT.darkroom` are new, for scripts.
- Checked headless on the GTX 1080 Ti before review: Tint compiles the develop pass. A 480 × 270 render developed
  untouched equals the display's own output pixel for pixel with manual exposure and in false colour. With auto
  exposure, 4 of 518 400 values are 1/255 off (the EV turned into a multiplier in JavaScript, not on the GPU).

**What to look at**
1. **The live view looks exactly as before.** Its shader was split into a function, with no change meant: any change
   in brightness, colour or the false-colour views is a bug.
2. File › Save a picture: **Render** at 64 samples. The Develop section should appear under it with a preview of the
   picture, and the preview should look like the view.
3. **Save PNG** without touching anything. The file should match what the view showed, like a save from 0.26.0 (0.17.0 on main).
4. Move **EV100**, the **tone curve** and the grading. The preview should follow at once and the saved PNG should match
   the preview. Try **Meter** on a picture rendered too dark or too bright.
5. A **4K render**: the preview should be smooth rather than speckled (it averages up to 8 × 8 pixels each).
6. With the optics **paths** drawn: they should be on the saved PNG, in the right place and the right way up.
7. Render in **lux on surfaces**, then in **luminance**: the false-colour min, max and bands should change the preview.
   For luminance, switching to photographic should work too.

## 0.26.0 — 2026-10-05

*On main as 0.17.0. Renumbered when main came into this branch (0.27.1): this branch had used 0.17.0 and 0.18.0
first, and its entries 0.17.0 to 0.21.0 are dated a day before main's two, so the only numbers keeping
this changelog in version and date order are above this branch's.*

**Changed**
- **The scene is the tree's root row again**, as it was before 0.7.0. Its name heads the tree, with the Environment,
  the groups and objects, and Materials under it.
  - A click on it shows the scene's settings in Properties: its name, unit, radius, instant hide and show, and
    functions. For a library item being edited, its details.
  - Its **+** sits in the same column as a group's + and Materials' +, and opens the same menu.
  - Only its chevron folds it, as for every row (below).
  - It has no eye, lock, duplicate or delete. Scenes are renamed, duplicated, ordered and deleted in the menu.
- **A click on a row selects it, and only its chevron folds it.** A click on a group, a modifier, Materials or the
  scene used to fold or unfold it as well as select it, so a group picked to edit closed under the pointer. Now:
  - A click on the row selects it and Properties shows it. Nothing folds.
  - A click on the chevron folds or unfolds the row and changes no selection, so Properties keeps what it shows.
  - A double-click on a row still frames it in the view. A double-click on a chevron only folds and unfolds.
  - Folding the scene's row folds the whole tree. Picking something in the picture opens it again.
- **One row over the tree instead of two**: the project menu, a ▶ that appears only when the scene is not compiled,
  then Undo and Redo at the right.
  - **The menu's button names the project**, so the scene is named only once, on its row.
  - The + and ⚙ beside the old switcher are gone; the scene's row does what they did.
  - The Open button and the Save menu are gone from the toolbar. They are in the menu now.
- **The menu has two sections**:
  - **Scenes**: the project's scenes, each with rename, duplicate, up, down and delete; **+ New scene**;
    **Examples ▸**; **Import scenes from a file…** (Ctrl O); **Export this scene to a file**; **Export all scenes
    to a file**.
  - **Project**, with its name: **Projects…**; **New project**; **Import a project from a file…** (kept as a project
    of its own and opened, as the Projects list's Import does); **Export the project to a file** (scenes, renderer
    settings and cameras).
  - Each entry does what the matching File menu entry does. The File menu itself is unchanged, and Ctrl S and
    Ctrl O work as before.

**What to look at**
1. The Scene panel's top: one row, with the project's name ▾ on the left and Undo and Redo on the right. Does it fit
   at your panel's width?
2. The tree's first row is the scene's name. Its + should line up with the + on a group and on Materials. Click the
   row: Properties should show the scene's settings, and the tree should stay open. Click it again: still open.
   Click a group or a modifier: it should be selected and stay open. Click its chevron: it should fold, and
   Properties should still show what it showed. Is the chevron easy enough to hit?
3. Use the scene row's + to add a sphere. It should land at the scene's top level, after the last object.
4. Open the menu and check the Scenes section, then the Project section under a rule. Try **Export this scene to a
   file** (a download), and **Import scenes from a file…** with that file: the scene should come back as a copy,
   after the current one, and be worked on.
5. Edit a library item. The tree should show "back to …", with the item's row under it as the root, and the menu
   should say why it will not open.
## 0.25.0 — 2026-10-05

**The step cache's cells, shown** (your question: "is there a way to visualise the 3D grid?"). Advanced › Ray marching ›
**Step cache: show its cells**, a developer's switch.
- **What it draws:** every filled cell along each pixel's camera ray, as a light fog over the picture. **Green** where
  the cell's ball reaches past the cell, so a ray there can take a cached step. **Orange** where it doesn't: near a
  surface, a fill that bought nothing. Cells not yet filled are clear.
- **How:** the display pass walks each pixel's ray through the grid cell by cell; the scene is not involved. On a
  software GPU the walk was checked against brute force on a hand-made grid, from a perspective and an orthographic
  camera: every pixel agrees. Switching the view on or off does not empty the cells it shows.
- **Only in the photographic view, and only while Step cache is on.** While the cache is off its cells aren't kept up
  to date, so they aren't shown.

**What to look at:** on the optics bench, set Step cache to 2 and switch on *show its cells*. Fog should build up
within
a few frames where the rays go: green in the open space in front of and between the parts, orange hugging their
surfaces. **Orbit:** the fog should stay, and grow where the camera now looks. **Move a part:** it should vanish and
build up again. **If no fog appears at all, the cache isn't running in your page** (no box was given, or it's
switched off): tell me. Then compare the picture with the view off, at Step cache 0 and 2: it should not change.

## 0.24.1 — 2026-10-05

**Fix: Tests › stepcache failed at once with "Maximum call stack size exceeded"** (your report). The renderer's facade
(`lib/pathtracer/index.js`) copies its methods onto the engine object. Its `setStepCacheBox` replaced the engine's, then
called itself until the stack ran out, on the first box the bench or the page handed in. So the step cache never ran in
the page in 0.23.0 or 0.24.0. The facade now keeps the engine's own function, as it already did for `pick` and
`setScene`. The engine's re-cut on a new cell count also calls its own function now; before, it reached the facade's.
- **Why no test saw it:** every test drove the engine alone, and the facade was never built in one. `build.test.mjs` now
  builds it. For every engine method it replaces, it checks that the facade's version never calls itself and the engine
  never calls the replaced one. It also drives the step cache through it: a box, a trace, a new cell count.

**What to look at:** run Tests › **stepcache** again and paste the report. Then, as for 0.24.0, try Step cache 2 in the
page: orbit, then move a part. The picture must stay right throughout.

## 0.24.0 — 2026-10-05

**The step cache kept across camera moves, and its cell count a setting** (your two picks; `roadmap/ARCHITECTURE.md`,
*Kept across camera moves*).
- **Kept across camera moves.** The cells hold the scene's shape, which a camera doesn't move. Until now every reset of
  the picture emptied them, so an orbit paid every fill again. Now they're emptied only when anything but the camera
  changes: a scene value, a setting, another scene, the scene's data written.
- **Advanced › Ray marching › Step cache: cells (millions)**, a quarter to sixteen, four by default. Finer cells reach
  closer to surfaces but cost more fills; a change cuts the box again.
- **Tests › stepcache** now runs the cells-ahead mode at 1, 4 and 16 million cells for every scene: five rows a scene.
- **Checked on a software GPU:** a second camera over the full cache ends every ray as with the cache off, on every
  scene and way, with fewer steps where the cache already saved them.

**What to look at:** with Step cache at 2 on the optics bench, **orbit the camera**. The picture must stay right, with no
holes or ghosts, while moving and after. Then **move a part** and check the picture follows with no trace of where it
was: that's the cache being emptied on an edit. Then run Tests › **stepcache** and paste the report: compare each scene's
cells-ahead rows at 1, 4 and 16 million against each other and its "cache off" row.

## 0.23.0 — 2026-10-05

**A step cache, as a developer setting** (your idea; `roadmap/ARCHITECTURE.md`, *A lazy step cache, simulated*: *The
prototype*). Advanced › Ray marching › **Step cache**: 0 off (the default), 1 the cell the ray is in, 2 the cells ahead.
- **What it does:** a grid of cells over the scene's measured boxes, each filled on first visit with the distance at its
  centre. A ray inside a cell's empty ball moves to where it leaves the ball, with no SDF. It runs in the march and
  occlusion kernels, for codegen and data alike, through each kernel's one SDF call.
- **Emptied whenever the picture starts over**, which includes every camera move (the prototype's simple rule).
- **Checked on a software GPU** with the engine's own kernels: every ray ends the same with it on as off, and with 2 the
  steps fall (the optics bench 25.7 to 20.4 a camera ray) -- also as data. **Not with exact hits:** there one SDF call can
  take a ray to its hit, and the cache's shorter step comes first, so the steps rose (6.9 to 11.9 with the grid). The
  rays still end the same. Whether it is slower there is your card's to say: the bench's last scene is that one.
- **The engine's side checked without a GPU** (`build.test.mjs`): the box's cells, the new buffer bound, the grid in
  march's and occlusion's uniforms at every dispatch, emptied when the picture starts over and only then.
- tinywebgpu-level: nothing. The march and occlusion kernels have a new binding; the optics trace keeps it off.

**What to look at:** run Tests › **stepcache** and paste the report. Read each scene's `march` and `occlude` with the cache
(rows 2 and 3 of a scene) against its row with it off. If they fall, the cache pays on your card; if they rise, the
lookups cost more than the SDF calls they save. The last scene, the optics bench with exact hits, is where the cache may
lose. Also: switch Step cache to 2 in the page on the optics bench and look -- the picture should not change at all. Any
hole, ghost or missing shadow is a bug.

## 0.22.23 — 2026-10-05

**The step cache with the ray's direction, simulated** (your idea; `roadmap/ARCHITECTURE.md`, *A lazy step cache,
simulated*). A document only.
- **A filled cell certifies an empty ball,** so a ray can go to where it leaves that ball, or the ball of one of the two
  cells ahead of it. That saves 28 to 58% of the camera rays' full SDF calls and 22 to 56% of the shadow rays' on the eight
  bench scenes, and takes fewer steps than the plain march everywhere.
- **A correction:** 0.22.22 called the cache "not always sound" from a check stricter than safety needs. The direct check
  (a cached step's two ends on the two sides of a surface) found 0 to 6 in tens of thousands a scene, not yet traced.

**What to look at:** nothing changed in the page.

## 0.22.22 — 2026-10-05

**The step cache simulated on the six other bench scenes** (`roadmap/ARCHITECTURE.md`, *A lazy step cache, simulated*). A
document only.
- **They gain more than the Menger rows:** a fifth to just under a third fewer full SDF calls for camera rays, a fifth to
  nearly a half for shadow rays; the optics benches most (shadow rays -37% and -45%).
- **Not always sound as it stands:** on the Noise library with coarse cells, 3.5% of cached steps took a bound past the
  scene's own distance; no ray ended differently, but a cache would need the margin the grid gives compiled subtrees.
- What a lookup at every step costs is the card's to say: a prototype behind a developer switch would measure it.

**What to look at:** nothing changed in the page.

## 0.22.21 — 2026-10-05

**Your idea of a lazily filled step cache, simulated** (`roadmap/ARCHITECTURE.md`, *A lazy step cache, simulated*). A
document only.
- **Sound:** none of 2.1 million cached steps passed the true distance at its point.
- **Small:** with every cell filled, a tenth to a quarter fewer full SDF calls for camera rays, less for shadow rays, and
  almost nothing for one Menger cube, whose rays spend their steps at its surface. Most calls are near surfaces, where no
  distance cache can help. Not built.

**What to look at:** nothing changed in the page.

## 0.22.20 — 2026-10-05

**Your overhead run of 0.22.19 recorded** (`roadmap/ARCHITECTURE.md`, *Before step 5*). A document only.
- **The uniform copy halved the material test's cost a record** (93 to 46 ps): it marches 1.7 times codegen's, not 3.1.
- **It hardly moved the Menger rows** (8.8 to 8.6 and 5.3 to 5.0 times codegen's) or one cube (1.5 to 1.4). Their records
  cost about 100 ps each either way, so where those records are read from is not what they cost.

**What to look at:** nothing changed in the page.

## 0.22.19 — 2026-10-05

**The scene as data reads its records from a uniform buffer** (your choice: the test of what a record costs).
- **Why:** counted against your overhead run, a record walked costs as data about what a whole codegen step costs (93 to
  124 ps against 96 to 117), whatever the record. Inferred, not measured: the cost is the walk's reads from the scene's
  storage buffer, each waiting for the one before. A uniform buffer is read through the path GPUs keep for a value every
  thread reads alike, which is what the walk does.
- **What changed:** the header and records are copied into a uniform buffer of their own (64 KiB: 585 records), written
  with the scene's buffer, and the walk reads every record from it. A record past its room is read from the scene's
  buffer, so there is one text whatever the size. Parameters, lights and the grid stay where they were. With the grid or
  exact hits nothing changes, since neighbouring rays there walk different records. tinywebgpu learned a `uniform `
  marker for this, and the shader check now counts uniform buffers apart from storage ones.
- The arithmetic is unchanged; the software GPU tests compare the walk with codegen through it, including scenes with
  more records than the copy holds.

**What to look at:** run Tests › **overhead** again and paste the report. If the data rows' march falls toward codegen's,
the reads were the cost; if it does not move, they were not. The picture should not change, and codegen (the page's
default) is not touched.

## 0.22.18 — 2026-10-05

**Why small scenes are slower as data, counted** (your choice: option 1; `roadmap/ARCHITECTURE.md`, *Before step 5*). A
document only.
- **Counted on a software GPU:** the records the walk visits a step on each overhead row's camera rays: 11.0 for the Menger
  cubes, 5.2 without their warps, 1.0 for one cube, 4.1 for the material test. Codegen and data took the same steps.
- **Against your run's first march pass** (the same camera rays): as data, 93 to 124 ps of GPU a record walked on every
  row, whatever the record; as codegen, 96 to 117 ps a step. So data ÷ codegen is about the records walked a step: 9.9,
  6.7, 1.3 and 3.7 measured against 11.0, 5.2, 1.0 and 4.1 counted.
- **Inferred, not tested:** a record costs the chain of reads from the scene's buffer, each waiting for the last, rather
  than arithmetic. The test would be the records in a uniform buffer.

**What to look at:** nothing changed in the page.

## 0.22.17 — 2026-10-05

**Your two overhead runs of 0.22.16 recorded** (`roadmap/ARCHITECTURE.md`, *Before step 5*). A document only.
- **The frames were not the walk's cost:** the subtraction's frame out of its array changed nothing (5.1 to 5.3 times
  codegen's march), the warps' gave about a tenth (9.7 to 8.8). The rows whose shader did not change moved by as much as
  0.2, which is the run's noise.
- **The GPU was lost once,** in the first run, during the Menger cubes' one sample with the wavefront log; the second run
  of the same build was not. Not established as 0.22.16's.

**What to look at:** nothing changed in the page.

## 0.22.16 — 2026-10-05

**The data walk keeps its innermost open frame out of an indexed array** (your choice: option 1, the test of the frames'
cost).
- **Why:** after 0.22.14 the only rows still far behind codegen were the two whose data shader keeps frames, a
  subtraction's (`stack`) and the warps' (`astack`), each read and written by an index known only while the walk runs:
  at every shape's join, every answer folded in, every next copy. Inferred, not measured: a GPU compiler keeps such an
  array in memory rather than registers.
- **What changed:** the innermost open frame now lives in a variable of its own (`top`, `atop`); the arrays hold only the
  frames it is inside, and are touched only when a group opens or ends. Same arithmetic, same order. The arrays keep
  their size, so no edit compiles where it did not before. A test now fails if the walk indexes them anywhere else; the
  software GPU tests run the walk against codegen, nested groups and arrays in arrays included, unchanged.

**What to look at:** run Tests › **overhead** again and paste the report. If the Menger cubes' ratios (about 5 without
their warps, about 10 with them) fall toward the 1.3 to 3 of the other rows, the frames were the cost; if they do not move,
they were not. The picture should not change. Codegen, the page's default, is not touched.

## 0.22.15 — 2026-10-05

**Your overhead run of 0.22.14 recorded** (`roadmap/ARCHITECTURE.md`, *Before step 5*). A document only.
- **The read-only binding was most of the walk's bare cost:** one Menger cube as data went from 3.0 times codegen's march
  to 1.3, and the material test from 4.2 to 3.1.
- **It did nothing where the walk keeps frames** (a subtraction's, a warp's): the Menger cubes stay at about 5 and 10
  times. Those are the only rows whose data shader holds an array indexed at run time.

**What to look at:** nothing changed in the page.

## 0.22.14 — 2026-10-05

**The scene as data's buffer bound read-only** (your choice: the test of the walk's own cost).
- **Why:** one Menger cube as data marched 3.0 times its codegen row (0.22.12), and the two shaders do the same arithmetic:
  the difference is where the values come from. Codegen reads uniforms; the data walk reads the scene's buffer, which
  every kernel bound read_write (tinywebgpu's default) though none writes it.
- **What changed:** tinywebgpu understands a `read ` marker on a buffer's type (`'read array<vec4<f32>>'`) and binds it
  read-only in every pipeline that declares it; the scene's buffer has it. Nothing else moves; the shader checks compile
  every kernel with it, and the software GPU tests run the engine's march and the boxes with it, unchanged.

**What to look at:** run Tests › **overhead** again and paste the report. If one Menger cube's data / codegen ratio falls
from 3.0 toward 1, the binding was the cost. The picture should not change. A scene rendered as codegen, the page's
default (the scene as data is a developer setting), is not touched at all.

## 0.22.13 — 2026-10-05

**Your overhead run of 0.22.12 recorded** (`roadmap/ARCHITECTURE.md`, *Before step 5*). A document only.
- **The warps are about half the Menger cubes' gap:** made plain groups, data / codegen march falls from 9.2 to 4.9.
- **The walk itself costs about 3 times around a single object:** one Menger cube, nothing else, is 3.0. So most of what
  is left is the data walk's own machinery, not the number of records.

**What to look at:** nothing changed in the page.

## 0.22.12 — 2026-10-05

**A test of why small scenes are 3 to 9 times slower as data** (Tests › **overhead**, `bench/overhead.js`; what was
found so far is in `roadmap/ARCHITECTURE.md`, *Before step 5*).
- **Found, counted on a software GPU:** the Menger cubes and the demo take exactly the same steps a ray as data as as
  codegen, and the data walk visits only 8 to 11 records a step. So the gap is what one step costs on your card.
- **The new test**, codegen and as data each, about three minutes: the Menger cubes as they are; the same with the bend and
  the twist made plain groups (no warps); one Menger cube alone; the material test. How each ratio reads is in the
  architecture document.
- **Found on the way:** the Menger cubes' "knikker" group gets a bounding box about 1 200 m wide, the same failure as the
  lens's in 0.22.10, which its fix does not reach. It costs codegen and data alike, and is not the gap. Not fixed yet.

**What to look at:** run Tests › **overhead** on the Pascal and paste the whole report. Rows 5 and 6 show one Menger cube
nearer than the scene's camera; the rest of the page is unchanged.

## 0.22.11 — 2026-10-05

**Your scaling run of 0.22.10 recorded** (`roadmap/ARCHITECTURE.md`, step 4). A document only.
- **The 32-copy cliff is gone:** the lens assembly x 32 as data marches in 168.4 ms (1248.6 before the fix; I had
  estimated about 170).
- **As data, each object costs about 3.5 ms of march and 1.3 ms of occlusion**, steadily from 1 to 32 copies.
- **With the grid the cost is flat** from 4 to 32 copies (about 132 ms of march), but it costs more than the plain walk with
  few objects (100.5 against 59.8 at 1 copy). They cross at about 20 copies.

**What to look at:** nothing changed in the page.

## 0.22.10 — 2026-10-05

**Why 32 copies cost 20 times as much as 16: a bounding box measured wrong. Fixed.** (`roadmap/ARCHITECTURE.md`, step 4.)
- **What happened:** the bounding boxes are measured on a coarse grid of points over the whole scene, then on fine grids
  over what that found. With 32 copies the scene is big, so the coarse grid is coarse. It missed the lens inside its
  holder, grew three times to 49 cm points, and then two far-off points counted as the lens. No fine grid found the lens
  again, so the lens kept those two points as its box, padded by 49 cm. The lens assembly's box grew by 49 cm on every
  side, every copy got that box, and every ray walked every copy at every step.
- **The fix** (`builder/boxes.js`): something only the coarse grid found is measured once more on a fine grid laid
  over where the document says it is. The lens is then found at its own size.
- **Checked on a software GPU, counts not times:** at 32 copies a camera ray now takes 22.7 steps (was 37.2; 23.8 at 16)
  and walks 38.1 records a step (was 61.8; 21.3 at 16). That is one record more for each copy, the walk's own cost. The
  eight bench scenes measure exactly the same boxes as before, so no scene you have changes.
- **New test:** `bench/test/scaling.gpu.mjs` (optional, software GPU) counts this, and fails on the old code.
  `builder/test/boxes.test.mjs` replays the case with its stand-in GPU.

**What to look at:** run Tests › **scaling** again. The lens assembly x 32 as data should drop from about 1250 ms of march
to somewhere near 170 (my estimate, from 16's 113 and 3.5 ms a copy), and its grid rows mean something now (0.22.9).
Your scenes should look and run the same.

## 0.22.9 — 2026-10-05

**Your scaling run of 0.22.8 recorded, and the grid rows' boxes fixed** (`roadmap/ARCHITECTURE.md`, step 4).
- **As data, 1 to 16 copies cost little** (about 3.5 ms of march a copy). **At 32 every ray costs about 20 times more**,
  the camera's rays too, which never come near the hidden copies. Not known why: the records and the shader are built the
  same at 16 and 32 (read in code and checked in node). So a BVH is not shown to be the next step.
- **Fixed, a defect of the benchmark:** the copies 2 to 32 were given copy 1's box, but their parts got none. The records'
  walk never needed them; the candidate grid walks a part without a box everywhere outside its volume, so its rows timed
  that (62 such parts at 32). Every part now gets its counterpart's box, in the scaling bench and in the scenedata bench's
  x 32 rows, and `scaling.test.mjs` checks every node has one.

**What to look at:** nothing changed in the page. The grid rows of Tests › scaling (and the scenedata bench's x 32 grid and
exact rows) mean something now if you run them again.

## 0.22.8 — 2026-10-05

**The scaling benchmark's copy rows run as data** (your choice of the three: the test before a BVH). Tests › scaling
keeps its picture: one lens assembly framed, 1, 4, 16 and 32 of them in the scene, the copies behind the camera.
- **Rows 4-7 are the copies as data, rows 8-11 the same with the candidate grid.** They were codegen, whose x 16 and x 32
  were predicted at minutes to compile and never ran. As data every count is one text, so x 1 compiles and the others
  say "= row 4" (or 8).
- **Gone: x 32 with its bounding boxes off.** Unculled as data, every step would evaluate all 32 copies whole, and a
  dispatch that long risks losing the GPU, which ends the run. As codegen it never ran either.
- Row 12 is row 4 again, the drift check. Rows 1-3 (the optics benches as they are) are unchanged.

**What to look at:** run Tests › **scaling** on the Pascal (a few minutes) and paste the whole report, JSON included.
Whether `march`, `occlude` and `tail ms` grow from x 1 to x 32 decides whether a BVH is the next step
(`roadmap/ARCHITECTURE.md`, step 4, says how each answer reads).

## 0.22.7 — 2026-10-05

**Your scenedata run of 0.22.6 recorded** (`roadmap/ARCHITECTURE.md`, steps 3 and 4). A document only.
- **Step 4's check is met:** the lens assembly x 32 as data compiles in 1.8 s (52 s in 0.21.6), the optics bench's own
  text. Its grid and exact rows ran for the first time.
- **On the optics bench, the scene as data is now under codegen's march** (114.7 ms, 111.9 with the grid, against
  138.0), which is step 3's written check; exact hits are not (175.8). OpticsBench2 is 12% over, and its exact row got
  slower (58.2 -> 82.8 ms), for a reason not known.
- **The demo and the Menger cubes are about 9 times slower as data than as codegen,** in every data row, as before.
- **Most of x 32's time is a tail of a few rays** that still costs about 50 ms an iteration; why is a hypothesis with a
  test written beside it.

**What to look at:** nothing changed in the page.

## 0.22.6 — 2026-10-05

**Developer extras removed** (your choice). Nothing in the page linked to or called any of them.
- **The convergence test page** (`convergence.html`). TESTING.md keeps what it was for and the command that restores it
  from the repository's history.
- **`RT.profileCompile()`,** a console diagnosis of each kernel's compile time. The benchmark's uncached compile
  (`compileUncached`) gives per-kernel times too.
- **Embedding methods nothing called:**
  - `RT.sample(n)`, which did what `RT.step(n)` does; the README's "central verb" is now `step(n)`;
  - `recompile()`, `sceneState()`, `lastCompile()` and `resize()`;
  - the camera's `appendUniforms` and `syncFromConfig`, and two keys for depth-of-field controls no page has.
- **Kept, as you said:** the `normallimit` and `moveAverages` settings.

**What to look at:** nothing should change in the page.

## 0.22.5 — 2026-10-05

**The ray's-list test option removed.** Step 3's question was whether the per-ray list helps without exact hits. Your run
of 0.21.6 answered it: it ties codegen on the optics bench and is three times slower on the demo. So the option that
built it (`rayList`) and the scenedata bench's three "as data with the ray's list" rows are gone.
- The list with exact hits stays, behind the developer setting as before.
- The test that runs the list cut to 2 entries stays too: it is the only thing that exercises the list's overflow path.

**What to look at:** Tests › scenedata has four rows a scene again (codegen, as data, with the grid, with exact hits).
Nothing else changes.

## 0.22.4 — 2026-10-05

**The material's unread `model` field removed.** Every material carried it, and nothing read it: there has been one
microfacet model since `core/microfacet.js`, and old files already drop it when they load.
- Each hit waiting to be shaded is 16 bytes smaller: 240 instead of 256. A real WGSL compiler (Dawn on the software GPU)
  lays it out that way. So the 1 GiB ray budget holds about 2.31 M rays in flight instead of 2.24 M. That is counted,
  not timed.
- **The sizes are now checked.** The bytes a ray and a hit take were written by hand in three places, under a comment
  saying they "MUST match the WGSL structs", which nothing checked. They are in one place now (`tracebasics.js`), and a
  new optional test, `core/test/structs.gpu.mjs`, asks the compiler for its strides and holds the two to each other
  exactly.
- A material of yours, in a project in the browser, that sets `m.model` would no longer compile. None of the bundled
  scenes or library items does.

**What to look at:** everything should render exactly as before.

## 0.22.3 — 2026-10-05

**Dead code removed** (your choice from the list of unused paths). None of it ran, so nothing you see should change.
- **The old page shell:** `lib/pathtracer/viewport.js` and `lib/ui-shell.js`, replaced by `lib/shell` on 2026-09-27.
- **The live loop's GPU-timestamp timer** in `lib/render-cost.js`. A wavefront sample spans many passes, so it was never
  armed. The Render stats' "per sample" now says what it always was: wall clock. The benchmark's per-kernel GPU timer
  (`kerneltime.js`) is separate and stays.
- **`autobudget` and `flushTolerance`,** which did nothing since 0.10.0. Also gone: the 20 test rows that set them, and
  the `budget-image` and `budget-cost` rows, which the code marked as answering nothing.
- **Five uniforms no shader read:** `time`, `frame`, `flipbuffer`, `resetframecount`, `invViewProjection`. A code node of
  yours that read `UB.time` would no longer compile; none of the bundled scenes or library items does.
- **Shader helpers nothing called:**
  - four in the PBR material model (`materials_pbr.js`);
  - an unused central-difference normal;
  - the commented-out sheen and thin fields of the material struct, and some other commented-out code.
- **Kept on purpose:** helpers in the prelude your own code can call, even where nothing in the repository calls them,
  such as the spare samplers and seeds in `tracebasics.js` and the material makers.

**What to look at:**
- Everything should render as before.
- Render stats › Per sample should read "wall clock".
- Tests should show no `budget-image` or `budget-cost` rows.

## 0.22.2 — 2026-10-05

**TRACE2 removed.** The experimental tracing flow ("TRACE2 (cache first bounce; experimental)" in Renderer ›
Diagnostics) is gone, its switch with it. You no longer used it.
- It had no shader of its own, so compiles and render speed do not change.
- What goes: about 150 lines of the engine, the third ray buffer it allocated when switched on, and a second way of
  handing the kernels their uniforms that every change there had to keep right. It ran with next-event estimation and
  light tracing off, so its pictures were never the normal ones anyway.

**What to look at:** Renderer › Diagnostics (with the Developer switch on) now has only the uniform environment. Rendering
is otherwise exactly as before.

## 0.22.1 — 2026-10-05

**The Render stats panel is a table again, and one of them.** It had become a stream of run-together text, for two
reasons:
- **A growing stream:** the readout looked itself up in the page by its id at every repaint. When the panel was outside
  the page (a tab not shown, or popped out), the lookup failed, and a new readout was added four times a second. Now it
  keeps the one it made.
- **No line breaks:** its lines were text in a box that does not keep line breaks. Now each reading is a row: what it is,
  the number (right-aligned, in a column of its own), its unit, and a note in a fainter colour.

The rows: warnings first in amber (Draft, Sketch or Optics, lamps only, rays flushed, photons short), then **Speed**
(samples per second, per sample, CPU, queue, loop), **Picture** (samples averaged, photons, exposure) and **Under the
cursor** (luminance or illuminance, its error, what it is worth in samples). A section with nothing to show is left out.
The numbers are the same as before; only their layout changed.

**What to look at:** Render › Render stats. Leave it open while you render, switch its tab away and back, and pop it out:
it should always be one short table of the latest numbers, not a growing list.

## 0.22.0 — 2026-10-05

**Step 4: copies compile once** (`roadmap/ARCHITECTURE.md`, step 4). As data, the lens assembly x 32 is now the same
shader as x 1, byte for byte, with the same uniforms. It was 410 KB of shader text against 38 KB, and your card took 52 s
to compile it.
- **Why it was not:** in a scene whose materials read the local point (the optics bench's brushed aluminium and dirty glass
  do), round, shell, twist, bend, repeat and mirror groups were compiled as code. Each lens assembly's shell was code, once
  per copy.
- **What changed:** codegen now gives the local point the way the scene as data does, in the two cases where they
  differed: a child with no transform of its own under a twist, bend, repeat or mirror, and the shapes inside a round or
  shell. So those groups are data in such scenes too.
- **Pictures:** in the optics benches and the demo nothing can change (their shells sit in a CSG group already, and their
  twists' children all have transforms). Six scenes' shaders gained a few lines that do nothing there.

**What to look at:**
- **Tests > scenedata, the three "lens assembly x 32" rows.** Its `compile ms` as data should fall from 52 s to about the
  optics bench's data rows' (4.9 s; 23 s with exact hits). That is an expectation, not a measurement. Its grid and exact
  rows were skipped for their predicted compiles and should now run.
- **The optics benches' data rows' march may move.** Their lens assemblies are now walked as records, not called as
  one compiled function. Counted on a software GPU (records walked a ray, steps unchanged): the optics bench 347 -> 361
  as data and 42 -> 118 with the grid; OpticsBench2 166 -> 180 and 78 -> 240. What that costs on your card is yours to
  measure.
- Your scenes in the normal view should look exactly as before.

## 0.21.7 — 2026-10-05

**A document: the ray's-list test on the Pascal** (your scenedata run of 0.21.6, `roadmap/ARCHITECTURE.md` step 3).
- **The optics bench: a tie.** With the list its march takes 144.9 ms, against codegen's 145.2 (139.1 in the drift row)
  and 135.5 as data without the list.
- **The demo: three times slower with the list**, 700.5 ms against 229.7 as data. Exact hits there cost the same as the
  list alone (670.7).
- So the list is no general gain, and the next form of step 3 is yours to decide before any more code.
- **A correction.** A march pass stops a ray after 32 steps, so the rays in a given pass differ from row to row. The
  per-pass comparisons in 0.21.0's and 0.21.5's notes are withdrawn. The whole march is the comparison.

**What to look at:** nothing in the application changed.

## 0.21.6 — 2026-10-05

**A test: is the ray's list a gain without exact hits?** Tests > scenedata has a new fifth row for the optics bench,
OpticsBench2 and the demo: "as data with the ray's list". It uses the list of objects each ray passes, with no grid and no
exact hits. Compare it with the same scene's "as data" row and its codegen row. The list-size rows of 0.21.2 are gone: they
showed that the list's size is not the cost.
- Counted on a software GPU (records walked a ray, and steps; not times), on the optics bench: 92 (9.6 steps) against 347
  (24.2) for the plain walk, and 60 (5.5) with exact hits. The test checks that its hits are the plain march's on the three
  scenes.
- The box test the list uses came with exact hits' code; it is now emitted on its own when the list runs without them.

**What to look at:** Tests > scenedata, "the optics bench, as data with the ray's list", its march against "the optics
bench, codegen" (138.1 ms in your last run).
- **At or under it:** the list is worth keeping, and exact hits should ask each object once a ray, not at every step.
- **Over it:** this way of doing step 3 stops here, and we decide the next one together.

The other rows should be about as before.

## 0.21.5 — 2026-10-05

**A document: the list-size test on the Pascal** (your scenedata run of 0.21.4, `roadmap/ARCHITECTURE.md` step 3).
- **Step 3's check is still not met.** The optics bench with exact hits marches in 181.8 ms against codegen's 138.1
  (127.7 in the drift row). As data, without the grid or exact hits, it takes 134.8.
- **The list's size is not the cost.** Cut to 2, the optics bench got slower (236.8 ms) and the demo 11% faster.
- **Fewer steps, dearer steps.** Counted on a software GPU, exact hits take far fewer steps a ray: on the optics bench
  6.9 against 29.8 for the camera's rays, 10.4 against 24.9 for rays bounced off a surface. Yet on your card the camera's
  pass costs the same and the bounced rays' pass about twice as much. So each exact step costs several times a plain one.
  That is an estimate from counts and times together, not a measurement.
- The document says what would test the likely cause: the ray's list without exact hits.

**What to look at:** nothing in the application changed.

## 0.21.4 — 2026-10-05

**A document: the list-size test as far as it ran**, from your scenedata run of 0.21.2 on an NVIDIA Ampere card
(`roadmap/ARCHITECTURE.md`, step 3).
- **The optics bench's pair did not run.** That card's compiles took about twice the Pascal's, and its exact rows were
  predicted over the bench's 60 s limit.
- **The demo's pair ran:** march 406.9 ms with the list of 8, 352.9 with 2. That is 13% lower, less than the run's own
  drift (17% between its first row and the same row at the end). Both are about three times the demo's grid row
  (128.7). On the demo, holding the list is not what makes exact hits slow.

**What to look at:** nothing in the application changed. Step 3's question, on the optics bench, still needs a run on
the Pascal, where those rows compiled in 27 and 34 s.

## 0.21.3 — 2026-10-05

**Main merged in: its 0.11.0 to 0.16.0.** Their entries are below, between 0.16.1 and 0.10.4, under main's own
numbers:
- **Optics:** a Live analysis, the ray count typed as a number times a multiplier, one readback a round, and Live's
  rounds adding up only with Σ.
- **Optics:** the far field's axis typed as a vector, or flipped.
- **Builder:** an aspheric lens, which starts as a condenser exact on axis.
- **The Renderer panel** in boxes, with presets as buttons, the Developer switch on one line, and a switch for the
  lights' rays.

Nothing in this branch's path tracer changes with it. The lights' rays switch is read on the host, where the photons
are planned (`core/raytrace_main.js`), not in a shader, so it does not meet step 2's split of shade. The aspheric lens
has no answer along the ray, so with exact hits it is marched as code, as every such shape is.
- Six files conflicted. In each, both sides' changes are kept: the builder's properties panel (a bound row's label, and
  main's typed coefficients), its check (both new blocks), the optics trace's buffers (main's settings for a run, and
  this branch's rebinding of the scene's buffers), CLAUDE.md's test list, this changelog and `version.js`.
- **One change the merge needed beyond the conflicts.** Main's Renderer panel shows a setting only in one of its boxes,
  and this branch's three developer switches (scene as data, its grid, its exact hits) were in none, so they had
  vanished from the panel. `quality.test.mjs` caught it. They are in **Ray marching** now, after **Skip far objects**,
  and show with the Developer switch on, as before.
- **Three of this branch's entries are renumbered.** It had numbered them 0.11.0, 0.12.0 and 0.13.0 (the scene as data,
  blocks, arrays), and main had used those numbers first. They are now 0.10.2, 0.10.3 and 0.10.4, the only numbers
  that keep this list in order of version and date. Each says so, and the documents that cite them now name the new
  numbers. A file saved under one of the old numbers still names its build by its revision.

**What to look at:**
- Main's own entries below 0.16.1 list what to check for each of its features. In this build, start with the Renderer
  panel and an Optics Live run.
- With the Developer switch on, **Ray marching** should end with the three scene-as-data switches. The bench's scenedata
  rows set them themselves, so the bench does not depend on where they are shown.
- In node, headless Chromium and lavapipe, every test in CLAUDE.md's list passes on the merged tree but one,
  `builder/test/recipe.test.mjs`. It fails the same way on main and at every commit of this branch: the two optics
  benches' group recipes do not read back as a no-op. Whether the merged page renders is yours to say.

## 0.21.2 — 2026-10-05

**A test, and a fix it found: does holding the ray's list cost the march more than the records it saves?** Tests >
scenedata runs the optics bench and the demo a fifth time, right after their exact row, with the list holding 2 solids
instead of 8. Nothing else in those rows changes: the same records, camera, settings and boxes, and the same text but
the list's size (`bench/test/scenedata.test.mjs` checks this).
- **The fix.** When more boxes held a point than the list had room for, 0.21.0 kept the nearest ones and walked only
  those, leaving out a solid the ray was already inside. At 8 the GPU test's rays never met that case; at 2 it put 122 of
  the optics bench's 7 232 rays on another surface. Where the list cannot hold every box at a point, the whole walk now
  answers that step, as it did before the list. On the optics bench the test's rays count the same at 8 before the fix
  and after it.
- Counted on a software GPU in node (per ray, not times), lists made at 8 -> 2: the optics bench 1.44 -> 1.86, with
  records 60 -> 64 and 5.5 steps both ways. So the cut row mostly changes the list's size, not the work around it.
- `builder/test/exact.gpu.mjs` marches every scene at 2 against 8 for the same hits, and counts the lists made.

**What to look at:**
- **Tests > scenedata**, "the optics bench, as data with the grid and exact hits, the list cut to 2" against the row
  above it (0.21.0: 198.4 ms march). If the cut row's march is well under it, holding the list is what costs. If they are
  about the same, the list's size is not the cost. The demo's pair the same way (0.21.0: 648.2 ms).
- The other exact rows should be about as they were in 0.21.0, unless they met the fixed case.

## 0.21.1 — 2026-10-05

**A document: step 3's first increment recorded in `roadmap/ARCHITECTURE.md`** from your scenedata run of 0.21.0. Its
check is not met: the optics bench's march as data with exact hits took 198.4 ms against codegen's 161.4 (138.1 in the
drift row), and OpticsBench2's took 68.3 against 54.0.
- On the optics bench's camera rays the list matches codegen (22.2 ms against 23.3). The loss is on the rays leaving
  their first surface: 215 ns a ray against codegen's 101.
- Faster than 0.20.8's exact rows where shapes answer in closed form: the Noise library 396.8 -> 147.9 ms, the showcase
  27.3 -> 22.7, Surface materials 13.1 -> 11.9. The demo is slower: 430.0 -> 648.2.
- Exact rows compile longer: 27.1 s on the optics bench and 33.7 s on OpticsBench2, against 4.7 and 6.1 s as data.
- The BVH waits until the cost of the list's steps is understood. The document says what would test it.

**What to look at:** nothing in the application changed.

## 0.21.0 — 2026-10-04

**Step 3 of `roadmap/ARCHITECTURE.md`, its first increment: a march finds the ray's objects.** In the scene as data with
exact hits, a march (camera rays, photons, shadow rays) lists the objects whose boxes its ray crosses, once per pass.
At each step it evaluates only the objects whose box the ray is in, and it crosses the empty space to the next box in
one step. Exact answers decide the steps inside a box, as before. The grid now answers only the other questions: a
normal, a material's point, the medium.
- Every set of records the builder makes carries a table of its objects and their boxes in the world, so the list is
  never built from stale boxes.
- Counted in node on a software GPU (records walked per ray, steps per ray; not times): the optics bench 54 -> 60
  (6.1 -> 5.5 steps), OpticsBench2 81 -> 11, the showcase 8 -> 2, the material test 13 -> 5, the demo 128 -> 37
  (30.7 steps either way: its shapes are code), against the grid with exact hits as counted for 0.18.0. Every exact hit is one the plain
  march makes too.
- **Not changed:** exact hits are still not right in the picture. The GPU test above passed before this change as well,
  while they looked wrong to you.
- The scenedata bench runs the two optics benches first now: step 3's check is theirs, and the last run lost the GPU
  before reaching them.
- `builder/test/grid.gpu.mjs` failed one check since 0.20.2, when the grid stopped checking boxes by default; its
  comparison with the page's build now asks for the same check its own build makes.

**What to look at:**
- **Tests > scenedata, the first rows:** the optics bench's `march` in "as data with the grid and exact hits" against
  its codegen row (0.20.3: 138.8 ms). That is step 3's check. OpticsBench2 the same.
- **The exact rows' march elsewhere**, against your 0.20.8 run: Surface materials 13.1, the showcase 27.3, the demo
  430.0, the Noise library 396.8 ms.
- The Menger cubes' exact row lost the GPU last time and may again; it now comes after the rows that matter here.

## 0.20.9 — 2026-10-04

**A document and a note: step 2 recorded in `roadmap/ARCHITECTURE.md`** from your scenedata run of 0.20.8: compiling
faster, the picture the same but for exact hits; shade 13-21 ms of GPU a sample on every scene; on a scene change only
the scene's kernels compile, and in your run they were ready by 0.7-1.8 s in the codegen rows.
- The scenedata report's closing note said a data row needs a ninth storage binding. Since 0.20.8 no kernel has more
  than 8. It also says now that "compile ms" includes shade, which a real scene change takes from the cache.
- A bench test still read the old "gpu ms, march, shade, occlude: none" line, which 0.20.8 changed by adding surface
  after the test had run. It fails on 0.20.8 and passes now.

**What to look at:** nothing in the application changed.

## 0.20.8 — 2026-10-04

**Step 2 of `roadmap/ARCHITECTURE.md`: shade holds no scene.** A new kernel between the march and shade, the surface
kernel, asks the scene everything shade used to ask: the normal, the material, the object's own point, the medium
beyond. It writes the answers beside each hit, and shade reads them. The lights' faces that light sampling aims at are
copied into a table the same way. Shade's text is now the same for every scene, so a scene change takes it from the
cache and compiles the surface kernel instead.
- Kernel sizes, measured in node from the text (inlined characters, not times), the optics bench: shade 356 000 to
  113 000, the surface kernel 252 000, march 227 000 and occlusion 251 000 unchanged. Predicted from the compile model
  (inferred, not measured): the slowest kernel of a scene change from shade's 7.4 s to 4.6 s (surface and occlusion).
- **Checked for the same answers, on a software GPU in node (lavapipe), not on yours.** The last commit's shade and the
  new surface + shade ran on the same 4 096 marched hits: camera paths, photons, probes and seek rays, with fast normals
  off and on. Seven scenes, the optics bench as data among them. Every ray sent on, every shadow ray, the frame buffer,
  the counters and the emitter discovery came out bit for bit the same. Each branch was also broken on purpose (the
  light table, the medium's direction, the object's point, a probe's medium), and the comparison caught each one.
- Each hit's record in the shade queue is 256 bytes, up from 144, so the ray budget holds about 2.24 M rays in flight
  instead of 2.92 M. That still covers 1080p at one ray a pixel.
- Shade still has 8 storage bindings: the answers ride in the shade queue and the light table in the learn buffer. In
  data mode, shade drops from 9 to 8.
- Tests > bench has a `surface` column beside `shade`.

**What to look at:**
- **`compile ms`** in Tests > scenedata or bench, against 0.20.6's. Also the console's `compiled '...' (N of 15 from
  the cache)` on a scene change: N one more than the same change gave before (of 14), the one more being shade.
- **The picture unchanged:** the LED faces and what they light (light sampling now reads the table), glass, the Surface
  materials scene's patterns, and the Optics view and the Analysis charts (the optics trace reads the new queue layout).
- **Render time:** `surface` + `shade` against 0.20.6's `shade` in the bench rows. Each iteration now has one more
  dispatch, and 112 more bytes written and read per hit.

## 0.20.7 — 2026-10-04

**A document: step 1 recorded in `roadmap/ARCHITECTURE.md`** (compiling much faster on your card, the tests good),
and step 2 written out with what is left of the scene in shade: on the optics bench the SDF 207 000 of 339 000
inlined characters, the materials 19 000, the lights 5 000.

**What to look at:** the document's step 2. Nothing in the application changed.

## 0.20.6 — 2026-10-04

**Step 1 of `roadmap/ARCHITECTURE.md`: one copy of the scene in shade and in occlusion**, for compile time. Shade
asked the scene at two places and its materials at two, and a material that reads its object's own point (`p_local`)
ran the scene once more inside each; every call is a whole copy once the compiler inlines it. Now every question is a
trip of one loop with one scene call and one material call in it, and the object's point is captured on a trip of that
call rather than looked up again. Occlusion does the same for an emitter's point. The questions, their arguments and
their order are the same, so the picture should not change.
- Kernel sizes, measured in node from the text (inlined characters, not times): the optics bench's shade 979 000 to
  339 000, occlusion 441 000 to 234 000; optics bench 2's shade 583 000 to 239 000; the noise scene's shade 374 000 to
  185 000. Predicted from the compile model (inferred, not measured): the optics bench's shade about 30 s to about 7 s,
  occlusion about 10 s to about 4 s.
- `bench/test/copies.test.mjs` pins shade and occlusion at one scene call and one material call each, every scene.
- Not run on any GPU here: the kernels compile under naga, and nothing in node runs shade.

**What to look at:**
- **`compile ms`** in Tests > scenedata (or bench): shade's and occlusion's against 0.20.3's run, the optics bench first.
- **The picture unchanged**, with the fast normals both on and off: the Surface materials and Noise scenes (their
  patterned materials read `p_local`), glass (the medium beyond), and lights seen through a shadow ray (an emitter's
  colour).

## 0.20.5 — 2026-10-04

**A document: `roadmap/ARCHITECTURE.md`.** Where the scene should go: data rather than code, rays answered by the
objects they pass (a BVH, closed-form hits where a shape has one), shading without geometry, copies as instances;
and the order of that work, each step with the check on your card. Step 1 is next: one copy of the scene per kernel,
for compile time.

**What to look at:** the document. Nothing in the application changed.

## 0.20.4 — 2026-10-04

**Fixed: an exact hit handed shade the bound along the ray, not the scene's distance there** (0.1 of a tolerance where
the distance was 0.057 on the optics bench). Shade uses that number only for a normal taken by differences; on the
optics benches, in node, no exact hit had such a normal, so no visible change is expected.
- `builder/test/exact.gpu.mjs` now checks every exact hit's distance and normal against the scene's own, and follows
  camera rays through the glass for up to six bounces both ways: on the optics benches they agree except grazes
  (rays passing within a tolerance of a surface, which the plain march counts as hits).
- **Found, not fixed:** a ray that starts inside the floor plane heading deeper escapes with exact hits on (one random
  ray of the shapes scene, when it runs after the optics benches).

**What to look at:** nothing new; this does not explain what you saw on the optics scenes.

## 0.20.3 — 2026-10-04

**Fixed: a benchmark that lost the GPU sat on "...running" for ever** (you asked for a timeout or a device-lost check,
after the scenedata run lost the GPU at row 19). Nothing in the raytracer listened for a lost device, and a sample waits
for the GPU to say it is done, which after the loss it never did (inferred from the run not moving on).
- **A run now ends when the GPU is lost, or when a step takes too long**: a sample 60 s, a wait for the queue or the
  boxes 5 min. Compiles have no time limit, since they cannot be stopped once started; they are judged before they
  start (below). The rows done stay in the table. The row it stopped in keeps the samples it had timed, marked
  `STOPPED part way`. A line under the table says the row, its number and why: the browser's reason and the first line
  of its message, or which step took too long. On a lost GPU nothing that needs it is started (the scene, the live
  view), and the report says to reload.
- **The probable cause of that loss, removed** (inferred, not shown). The "one sample in flight" step sent each sample
  as ONE submission, which takes away the splitting that keeps a heavy sample under Windows' ~2 s GPU reset. The Menger
  cubes as data had run it at 1.35 s a sample. With the grid, the demo's row had been 1.56 times its data row, which
  would put this one past 2 s. Its console's last line was "one sample in flight...". Now a row is sent one submission
  a sample only when every timed sample was under the engine's own split (250 ms). The JSON's `pipelinedSubmits` says
  which way a row ran.

**Shorter benchmarks** (you: ten minutes of compiling is an order of magnitude too long).
- **A row whose compile is predicted over 60 s is not run.** The engine predicts a build from its kernels' text without
  compiling anything (`RT.predictCompile`). The row says `NOT RUN: predicted … to compile` with the prediction in its
  `compile ms` cell. At the starting rate that drops the scaling bench's lens assembly x 16 and x 32 (about 2.6 and 6.5
  minutes predicted), and the scenedata bench's lens assembly x 32 rows (below).
- **The prediction now grows faster than the text, as your compiles did.** Over the 16 uncached builds your Pascal
  timed (2–46 s), the time is 0.736 × the old linear prediction to the power 1.37: rms error 11%, worst 28%, where the
  line was 27% and 59%. The optics bench took 35 s where the line said 16. The compile bar uses it too, so it should
  sit at "taking longer than usual" less on big scenes.
- **The one-kernel-at-a-time compile runs only when a test asks for it.** It was a third compile of every compile row,
  and the question it answered (all at once is faster) is settled.

**Found, not yet fixed:** the lens assembly x 32 *as data* is still 410 KB of WGSL against 38 KB for one copy. Its
materials read `p_local`, and in such a scene a group with code (the pillar's shell) and every CSG group above it are
compiled, once per copy. About 3 minutes predicted, never measured. That is the next thing to fix.

**What to look at:**
1. **Tests > scenedata again.** It should run to the end. The lens x 32 rows should say `NOT RUN`. If the GPU is still
   lost, the report should say STOPPED, at which row, and why, instead of hanging; please paste it.
2. **The `pipelined` column** on the heavy rows (Noise with the grid, the demo with the grid, the Menger cubes): it now
   runs on the engine's submissions there, so it may read a little higher than before.
3. **Tests > scaling** should take minutes, with x 16 and x 32 `NOT RUN`, and their predictions in `compile ms`.

## 0.20.2 — 2026-10-04

**Fixed: the candidate grid called right boxes wrong, and ran slower than no grid** (your scenedata rows on 0.20.0:
Noise 1261.5 ms a sample with the grid against 358.4 without). The grid's build checked every solid's bounding box
against the distances it evaluated, and on a distance less than the way to the box called the box wrong and walked
that solid unculled outside the grid, at every step. The rule holds for an exact distance only: a relief's, a twist's
and a smooth join's are lower bounds, less than the way to a box that is right. It flagged 6 of Noise's boxes, one of
the showcase's and one of the demo's.
- **The page's boxes are now trusted, as culling already trusts them** (they are measured, and padded). The check stays
  for the tests, whose boxes are estimates (`checkBoxes`).
- Checked in node with the page's measured boxes: none of the boxes it flagged on the demo or the Menger cubes left a
  point of its solid outside, and on the showcase only the part of the bar buried in the floor, which the floor's box
  holds. Noise was not checked this way.

**What to look at:** Tests > scenedata again: the grid rows beside the data rows, Noise above all, and the `grid`
column no longer naming bad boxes. The pictures with the grid on should be the same as without.

## 0.20.1 — 2026-10-04

**Fixed: exact hits made surfaces look translucent and refraction wrong** (you saw it on Surface materials and the
builder demo). Since 0.18.0 an exact hit was moved exactly onto its surface. On the surface, the scene's distance is
as likely to be a hair negative as a hair positive. Shade reads the medium the ray is in from that sign, so a large
share of hits thought they had arrived from inside the object: diffuse surfaces looked see-through, and refraction ran
with the indices swapped. On the node WebGPU, a quarter of the showcase's exact hits (554 of 2295) recorded another
medium than the plain march.
- **An exact hit now stops a tenth of a tolerance short of its surface**, along the ray, on the side it came from,
  as the plain march always does (the plain march stops anywhere up to a whole tolerance short).
- **A surface the ray passed by a hair** (float rounding, or the grid's step into the next cell) is now reported a
  hair behind, and the march steps back to the right side. Before, it reported the surface as at the ray's own
  position, so the ray never stepped back.
- **A CSG group reports where its surface is** only when that is what bounds it. Otherwise a march could step back
  and forth across a hole's or cut's boundary for ever; two rays on OpticsBench2 did, until they ran out of steps.

**Checked here, not timed** (`builder/test/exact.gpu.mjs`, through the engine's own march on a CPU's WebGPU, with
bounding boxes measured as the page does). This test is now held to what would have caught the bug:
- Exact and plain hits agree on the medium and the side of the surface, on every scene.
- No exact hit lies on its surface.
- Lens hits land a tenth of a tolerance short: optics bench glass 14/15, frosted 17/18, dirty 7/8; OpticsBench2
  19/19.
- Every built-in shape with an answer lands there too.
- Records and steps per ray are as in 0.20.0.

**What to look at:** Surface materials and the builder demo with *exact hits* on, against off. They should be the same
picture: nothing translucent that isn't, refraction as with the switch off. The scenedata bench's exact rows timed
before this fix were timing wrong hits; they need running again.

## 0.20.0 — 2026-10-04

**Added: exact hits for outlines: the fresnel lens, revolved outlines and extrusions** (`builder/analytic.js`
profileRayWGSL). An outline you draw now answers along the ray, revolved or extruded, still behind the developer switch
*Scene as data: exact hits*.
- **Revolved:** each straight edge revolves to a cone, a cylinder or a ring, and each is found exactly. The fresnel
  lens's outline is all straight edges, so its hits are exact.
- **Fillets in a revolved outline** revolve to pieces of a torus, a quartic. An outline with a fillet answers by
  distance, as before.
- **Extruded:** each edge is a wall, each fillet a piece of a cylinder, and the caps are where the outline holds the
  crossing. All exact, fillets included.
- **A live profile** (one being edited in the picture, its points as uniforms) answers by distance until it is compiled.

**Checked here, not timed.** `builder/test/analytic.test.mjs` compares the answers with the outline's own distance
function, revolved and extruded, walked and bisected: the fresnel lens, a cup with slanted walls, the extrusion with its
fillets, an L. Through the engine's march (`builder/test/exact.gpu.mjs`, a made scene with every shape in its own
material, counts on a CPU's WebGPU), hits on the surface: fresnel lens 46/46, extrusion 71/71. The revolution primitive,
whose outline has fillets, is at 38/114, by distance as designed.

**What to look at:** a fresnel lens with *exact hits* on and off: the same picture. Through an optics trace, the rays
should agree within the noise.

## 0.19.1 — 2026-10-04

**Fixed: rounded boxes now give exact hits too** (`builder/analytic.js`). Since 0.18.0 a rounded box (the builder's box
has a 0.02 rounding by default) answered only with the plain box around it. That is exact on its flat faces, only a
bound at its rounded edges, and nothing at all from inside. It now finds the exact surface at the edges (quarter
cylinders) and corners (sphere pieces), from outside and from inside. The expensive search runs only when a ray
crosses near an edge or corner.

**Checked here, not timed.** `builder/test/analytic.test.mjs` compares rounded boxes, edges and corners included, with
their own distance function walked and bisected. Through the engine's march (`builder/test/exact.gpu.mjs`), hits that
now land on the surface:

| | before | now |
|---|---|---|
| showcase floor | 1322/1342 | 1342/1342 |
| showcase PMMA pillar | 125/128 | 128/128 |
| material test floor | 1447/1474 | 1473/1473 |
| demo chrome | 153/154 | 154/154 |

**What to look at:** as for 0.18.0. Box edges are where to look for anything cut off or holed, with *exact hits* on.

## 0.19.0 — 2026-10-04

**Added: exact hits for eight more shapes** (`builder/analytic.js`): the tube, the cone, the round cone, the dome, the
octahedron, the pyramid (any frustum), the prism and the reflector. With the 0.18.0 shapes, every built-in shape with
flat or quadric faces now answers along the ray. Still behind the developer switch *Scene as data: exact hits*.
- **The reflector** answers exactly from inside its bowl, which is its working side: the mirror is a paraboloid, so
  a ray from the focus is known to the float where it meets it. Its back wall is not a quadric, so from outside it
  answers by distance, as before.
- **Not yet:** the torus, the capped torus and the link (quartics), and outlines (revolutions, the fresnel lens,
  extrusions, tubes and sweeps along paths). These still answer by distance.

**Checked here, not timed.** `builder/test/analytic.test.mjs` compares every answer with its shape's own distance
function, walked and bisected, from outside and inside. `builder/test/exact.gpu.mjs` runs a made scene with every shape
in its own material through the engine's march (counts on a CPU's WebGPU):
- Every shape's hits land on its surface. The one exception is a disc hit on its rim, inside the tolerance.
- Steps per ray drop from 17.1 to 1.6.
- Records walked per ray: 289 with today's culled walk, 74 with exact hits, 47 with the grid, 14 with the grid and
  exact hits.

**What to look at:** as for 0.18.0. In a scene with these shapes, the picture with *exact hits* on should be the
picture with it off. A reflector with a light at its focus is the case worth an optics trace both ways.

## 0.18.0 — 2026-10-04

**Added: exact hits, behind a developer switch** (`builder/analytic.js`; `docs/PERFORMANCE.md` P3, *Exact hits*). This
follows your "exact analytics would be very welcome for optical raytracing accuracy". A march no longer creeps up on a
sphere, a lens or a box. It asks where along the ray the surface is, steps there in one go, and stops on the surface
itself, not up to a tolerance short of it.
- **The switch:** Renderer > Developer > *Scene as data: exact hits*. It needs *Scene as data*; it works with or
  without the candidate grid. Turning it recompiles the scene shown.
- **Which shapes:** sphere, box, cylinder, capsule, lens, disc, rectangle, plane, and light faces. A shape qualifies
  only if its code is still the single built-in line; any edit makes it an ordinary distance shape again.
  - A rounded box is exact on its flat faces and only a safe bound at its rounded edges.
  - A hard CSG group (union, subtract, intersect with no blend) of these shapes is bounded by the nearest of its parts,
    so a lens cut into a holder is nearly always hit exactly.
  - Smooth blends, code, twists, repeats and shells behave as before.
- **Every march uses it:** camera rays, shadow rays, photons and the optics trace. Normals, media, the pick, the
  bounding boxes and the grid's build still get plain distances.
- **Bounding boxes are tested along the ray.** A ray that misses a box never looks inside it, and with the grid a
  step through a cell may go to the cell's far side. Both are proven safe: a box holds its object, and a cell names
  every object that reaches into it.
- **Tests > scenedata has a fourth row per scene,** *as data with the grid and exact hits*, and the lens assembly x 32
  has one too.

**Counted on a CPU's WebGPU, not timed** (`builder/test/exact.gpu.mjs`). These are bench cameras and rays from inside
each scene. The plain and exact runs use the engine's own march kernel; records walked per ray come from a counting
march that follows the same stepping rule:

| scene | records walked a ray: culled (today) → grid → grid + exact | steps a ray: plain → exact |
|---|---|---|
| optics bench | 347 → 83 → 54 | 24.2 → 6.1 |
| OpticsBench2 | 166 → 92 → 81 | 22.1 → 10.2 |
| showcase | 254 → 19 → 8 | 18.5 → 2.4 |
| material test | 97 → 16 → 13 | 23.3 → 5.7 |
| demo | 276 → 131 → 128 | 33.0 → 30.7 (twists and code: nothing to answer) |

- **The same rays hit.** The only differences are rays that graze a surface or clip an edge within one tolerance:
  the plain march calls those hits, the exact one sees them pass.
- **Lens hits land on the surface.** Optics bench: glass 15/15, dirty glass 8/8, frosted glass 17/18; OpticsBench2:
  glass 19/19. That is a hundredth of a tolerance or less from the surface, where the plain march stops anywhere
  within one (median 0.7 of a tolerance). The one frosted-glass miss is a lens in its holder, where the holder's face
  is within a tolerance; it lands 0.29 of a tolerance off. Making that exact needs interval CSG, which is the next
  step.
- **The same with the grid:** the same hits in the same places.
- **The first runs found two bugs, both fixed and now tested:**
  - A surface a hair behind the point was read as "never". The ray went through the showcase's floor.
  - A move onto a bound that was not exact could stop the march farther from the surface than the plain march ever
    does.

**What to look at:**
1. **Tests > scenedata, the whole run, pasted back.** On each scene, compare *grid and exact hits* with *as data with
   the grid* (`march`, `occlude`, `shade`). An exact answer costs more arithmetic than a distance, and only your card
   can weigh that against the fewer records and steps.
2. **The picture with *exact hits* on, against off** (both with *Scene as data*), on the optics bench, OpticsBench2
   and the showcase. It should look the same. Anything missing, cut off or holed, especially at box edges and where
   a lens meets its holder, is a bug: please send a screenshot.
3. **An optics trace through a lens, both ways** (Analysis). The rays and the far field should agree within the noise.
   If they differ, the exact one is the one to believe, and I would like to see both.

## 0.17.0 — 2026-10-04

**Added: the candidate grid in the page, behind a developer switch, and in the scene-as-data bench**
(`builder/regrid.js`; `docs/PERFORMANCE.md` P3, *The candidate grid*). This is step 2 of the grid from 0.16.1. With
the switch on, each point of a march evaluates only the few objects its grid cell names, instead of every object.
- **The switch:** Renderer > Developer > *Scene as data: candidate grid*. It needs *Scene as data* on as well. Turning
  either one recompiles the scene shown.
- **Rebuilt after every change, at rest.** Every change to the scene (a slider, a box measured, an edit applied
  without a compile, a compile) is written without a grid first. So the picture never uses a grid built for the scene
  as it was before. The grid is built again on the GPU 150 ms after the changes stop, by the scene's own code, and
  written in. A drag builds once, when you let go.
- **Not before the boxes.** The grid's extent comes from the measured bounding boxes. While the switch is on, the page
  measures every object's box, as it does with culling on. Until then the scene draws as it does without a grid.
- **The picture is not restarted** when a grid goes in. Near every surface the grid gives the scene's own distance, so
  it should be the same picture.
- **The console says what each build came to:** `[grid] built in … ms: … solids (… without a box), … top cells, …
  leaves; … solids a point on average, … at most; … KiB, … evaluations`. A box the build finds wrong is a warning
  naming it. That solid is then evaluated everywhere, so it is correct but slower.
- **Tests > scenedata has a third row per scene**, *as data with the grid*, and a `grid` column (solids a point walks,
  average and most; the grid's size; how long it took to build). The grid is built after the row's boxes are measured,
  so building it is not in the timing.
- **The lens assembly x 32 has no codegen row any more.** You reported it still compiling after ten minutes. It runs as
  data and as data with the grid.

**Checked here, not timed** (a CPU's WebGPU says nothing about your card's speed): on all 8 bundled scenes the grid
matches the scene's own distance and hits. The page's own route (the renderer's kernel plus the page's build) produces
the same grid as the test's (`builder/test/grid.gpu.mjs`). A build overtaken by a change is never written, a drag
builds once, and nothing is built before a box is known (`builder/test/regrid.test.mjs`). check-shaders passes,
naga included.

**What to look at:**
1. **Tests > scenedata, the whole run, pasted back.** On each scene, compare the *as data with the grid* row's
   `march`, `occlude` and `shade` with *as data* and with *codegen*. Include the `grid` column. Grid against no grid is
   the question this answers; the counts predict 3-25x fewer records walked per ray.
2. **The picture, with both switches on** (Developer: *Scene as data*, then *candidate grid*). Open the optics bench and
   OpticsBench2, and wait for the `[grid] built` line in the console. The picture should look exactly as it does with
   the grid switch off. Anything missing, cut off, holed or dark that is not there with the switch off is a bug:
   please send a screenshot and the console's `[grid]` lines.
3. **Drag a slider** that moves an object, then let go. The object should be right while dragging and after, and a new
   `[grid] built` line should appear once you let go. Any `[grid] ... nearer than their boxes say` warning is worth
   pasting.

## 0.16.1 — 2026-10-04

**Added, not yet in the page: the candidate grid, as a prototype and its tests** (`builder/grid.js`;
`docs/PERFORMANCE.md` P3, *The candidate grid*). This follows your idea: a 3D grid that tells a ray which objects to
evaluate. Nothing you see changes yet.
- **What a cell holds:** the solids that can be nearest somewhere in it, and a floor under all the others. The scene's
  own evaluator builds it, by evaluating each solid once at each cell's centre. So it works for any code, a customer's
  included, with no bounds declared.
- **What a cell gives:** exactly the full scene's distance near surfaces, and never more than it anywhere.
- **Adaptive:** crowded cells are split finer; far from every surface a cell lists nothing and gives its floor.
- **Boxes are checked, not trusted.** A box that misses part of its solid is caught at build time, and that solid is
  treated as unbounded.

**Counted on a CPU's WebGPU, not timed** (`builder/test/grid.gpu.mjs`, from each bench scene's own camera). Today's
culling walk is compared with the grid, and the boxes are my estimates, not the page's measured ones:

| scene | records walked per camera ray, culled → grid | steps per camera ray, culled → grid (field's own) |
|---|---|---|
| optics bench | 472 → 55 | 25.8 → 19.0 (17.0) |
| OpticsBench2 | 176 → 37 | 22.0 → 21.7 (20.5) |
| Noise library | 451 → 20 | 32.2 → 16.7 (15.7) |
| Surface materials | 440 → 19 | 31.4 → 16.1 (15.2) |
| showcase | 521 → 20 | 40.1 → 20.3 (17.8) |
| material test | 80 → 28 | 19.9 → 18.5 (18.4) |

Today's culling roughly doubles the steps on the small scenes, which codegen pays too (it culls by the same rule). The
grid keeps the field's own step count. demo and Menger cubes are left out of the table: my estimated boxes are wrong for
their code shapes, and the build caught them.

**Also checked:** the grid's distance never above the scene's, and the scene's own wherever the floor didn't decide it
(4096 points a scene, 8 scenes); the camera's rays hitting what the full scene hits. check-shaders compiles grid mode
with naga.

**What to look at:** nothing in the page yet. Step 2 wires the grid into the scene as data, and Tests > scenedata gets a
row with it.



**Fixed: a library item, a copy or a paste now brings the helper functions its code calls** (`builder/helpers.js`;
`docs/PERFORMANCE.md` P3, call 7). The scene's *functions* block holds WGSL helpers any code may call. An item used to
carry its code and materials but none of those helpers, so a lens whose code called `lensSag(...)` arrived in another
scene without it: a compile error there, or that scene's own `lensSag`, which can be another shape.
- An item now carries every helper its code, its materials and their reliefs read (functions, constants, structs), and
  the ones those read, each with the comment lines above it.
- Put into a scene, the helpers it lacks are added to that scene's *functions*; ones it already has, the same, are not
  added twice.
- **One the scene has differently is refused**, with nothing changed and the status line naming it: "'lensSag' in this
  scene's functions is not the one the pasted code calls: rename one of them first". Using the scene's own would
  quietly change the item's shape.
- In the library's pictures, two items from two scenes with different helpers of one name cannot share a picture
  scene: the second one's picture fails alone, and its neighbours are drawn.
- An item whose code calls no helper is exactly what it was, so nothing in the library shows as changed.

**What to look at:**
1. In a scene's *functions*, add `fn bump(x: f32) -> f32 { return x * 1.2; }`; make a code object that calls it, e.g.
   `C = add_new(C, Nsphere(p, bump(0.5)), MATERIAL);`. Select it in the tree, Ctrl+C, switch to another scene, Ctrl+V.
   That scene's *functions* now ends with `bump`, and the object compiles there.
2. Give the second scene's `bump` another body and paste the object again: refused, and the status line says why.



**Added: component parameters** (scene format version 18; `builder/bind.js`; `docs/PERFORMANCE.md` P3; you: "component
parameters would be nice"). A group's parameters can now drive the values inside it. A lens group with `diameter`
sizes its body and its holder; an LED strip with `count` and `pitch` makes its own array.
- Properties > a node inside a group with parameters > **from parameters**: one `target = expression` a line, e.g.
  `radius = diameter / 2`, `size.x = diameter + 2 * gap`, `pos.z = height`, `copies.count = count`. The names it can
  read are listed above the box. A mistake is shown at its line and column as you type; Ctrl+Enter or Apply binds it.
- **What can be bound:** a number parameter, or one component of a vector or colour (`size.x`, `tint.r`); the position,
  rotation and scale (`pos.z`, `rot.x`, `scale`); a group's blend and a child's own join blend (`blend`,
  `join.blend`); and a plain group's copies, as a row (`copies.count`, `copies.pitch`, `copies.along = y`).
- **What it can read:** the parameters of the groups above it, nearest first. A group's own parameters too, but only
  for its placement, blend and copies, never for its parameters: nothing can be bound to itself.
- **Changing a group's parameter moves everything bound to it, live** -- from the panel, the parameter registry or the
  timeline alike. In the default mode each bound value is a uniform written. An array whose count changes compiles,
  as a count typed in does; with *Scene as data* on it does not.
- A bound value is **held**: its row in the panel is greyed out with its expression on the label, the picture has no
  handle for it, and the numbers' panel says "from parameters". It is not offered to the timeline: the parameter it
  reads is.
- Renaming a group's parameter rewrites the bindings that read it. Renaming it to a name a nearer group has is
  refused, since the binding would then read that one. Removing it, or making it a vector, is refused while a binding
  reads it. A bound parameter of an object, renamed or removed, takes its binding with it.
- A bound node moved out of its component keeps its last values, and says why it no longer follows.
- A component in the library keeps its bindings; inserted elsewhere, they read the inserted copy's parameters.
- **Changed:** a group with parameters but no code can now be an array (an LED strip owns its count).

**The file:** version 18. Version 17 files load unchanged. A builder of 0.14 refuses a version 18 file rather than
drop its bindings on the next save. The bundled scenes are re-saved at 18; only their version number changed.

**What it costs the picture:** nothing, read in code (`bind.js` header). Bindings are resolved in JavaScript and
written into the document's values, so codegen's text for a bound scene is the text of the same values typed in
(`test/bind.test.mjs` compares the two).

**What to look at:**
1. Make a group, add a parameter `diameter` (its parameters header, +). Put a cylinder in it. In the cylinder's *from
   parameters*: `radius = diameter / 2`, Ctrl+Enter. Drag the group's `diameter`: the cylinder grows, with no
   "compiling" in the status line.
2. In the same box, `radius = diamter / 2`: the line and column of the misspelt name, in red.
3. A group with parameters `count` 4 and `pitch` 1, a sphere in it, and in the group's own *from parameters*:
   `copies.count = count` and `copies.pitch = pitch`. Change `count` to 6: six spheres, after one compile (none with
   *Scene as data* on). Change `pitch`: live.
4. Select the bound cylinder: no stretch cubes in the picture, its radius row greyed, and the numbers' panel at the top
   right says "from parameters".



**Added: modifiers as data** (`builder/scenedata.js`, `builder/codegen.js`; `docs/PERFORMANCE.md` P3, the before
and after kinds). This applies only with the developer switch *Scene as data* on. Until now, a group with code was
compiled together with everything inside it. So moving, adding or deleting anything under a twist, a repeat or a
shell meant a compile, and the optics bench's lens assemblies (each under a shell) were compiled code.
- A group whose code only **moves the point its children see** (twist, bend, repeat, mirror, or your own code of that
  shape) is now a record. Its code runs as a function, and its children are records in the frame it leaves.
- A group whose code only **works on what its children gave** (round, shell, or your own) is now a record too. Its
  children fold into a Hit of their own, and its code then runs on that Hit.
- **Which kind a group is comes from its code.** Nothing is declared, and the file format does not change.
  - *Before*: the code ends with `C = children(C, p);` and does not name `C` before that.
  - *After*: the code starts with `var H = children(emptyHit(r), p);` and does not warp after it.
  - Anything else stays compiled as before: displace and the noise relief, which read the CSG chain above them; code
    that calls its children twice; any group code in a scene whose materials read `p_local`.
- **The optics bench is now data throughout:** nothing in it is compiled as a subtree. Demo's twist and demoscene's
  twist are data too. The noise library's reliefs are still compiled.
- A group's parameters (a twist's rate, a shell's thickness) are written to the buffer, not to uniforms.

**Checked without a GPU of the user's:** on Dawn over a CPU Vulkan, data and codegen agree on every bundled scene and
on a scene made for this: field, materials, normals, picks, and culling with the same boxes
(`builder/test/scenedata.gpu.mjs`). The made scene has every modifier, turned and scaled, holding CSG groups, arrays
and other modifiers; it also has one inside an array, one as a subtracted shape, and a relief under a twist and under
a round. Three deliberately broken evaluators each failed it. All four check-shaders passes are clean, including naga
on a new scene with both kinds. Nothing here says how fast it is, or what it looks like.

**Fixed:** with *Scene as data* on, a block with a parameter called `o` and more parameters after it did not compile.
The functions read each parameter's slot from an offset that was also called `o`, so the parameter hid it from the
ones declared after it. The offset is now `_slots`,
which no parameter can be called (a parameter's name starts with a letter). check-shaders has the case: with the old
name, 9 kernels fail naga.

**What to look at** (Developer > *Scene as data* on):
1. **OpticsBench:** select a lens inside an assembly and move it, duplicate it, delete it. None of these should say
   "compiling" in the status line. The picture should be the same as with the switch off.
2. **demo:** add a box inside the twisted group, then move it. No compile; it twists with the rest.
3. Change a twist's rate or a shell's thickness. It is live either way, as before.
4. **Tests > scenedata**, the OpticsBench and demo rows, against their codegen rows. This is the gate (call 5 in
   PERFORMANCE.md): whether the loop is within 10% of codegen's march, occlude and shade times.

## 0.16.0 — 2026-10-04

**Changed**
- **The Renderer panel is in boxes**, outlined like the Analysis pane's sections, each with its icon:
  - **Quality** at the top. The presets are buttons now, not a dropdown: **Preview** (Sketch, Draft), **Accurate**
    (Standard, High), and Optics on its own. A line under them says what the chosen one traces. On settings of your
    own it says what differs from the nearest preset, for example "Max Bounces 12 (Standard: 10)". When a
    false-colour view is on, it also says that the view traces in full whatever is chosen.
  - **The Developer switch** is now one line at the foot of the Quality box, where it was a box of its own at the
    bottom of the panel. The line holds the switch, a count of developer settings not at their default, and
    **Reset**. The count names them in its tooltip, and it turns amber while the switch hides them. Reset is greyed
    when there is nothing to put back.
  - **Light sources**: a checkbox for each kind of light and whether it is traced:
    - **Sun, sky or studio**: the scene's environment. Unticked is lamps only.
    - **Caustics (sun, glowing surfaces)**: what was "Light Tracing (caustics)".
    - **Lights' rays**: new, below.
    - **Photons per pixel**, as before.
    With the developer settings on, three folders follow: light sampling (NEE and its shares), the photon map, and
    the glowing surfaces' search.
  - **Paths and noise**: bounces and the firefly clamp. With the developer settings on, also Russian roulette and
    the averaging windows.
  - **Render size**, as before.
  - **Ray marching** and **Diagnostics** hold the developer settings that were in Tracing and in "Normals and
    diagnostics". TRACE2 moved into Diagnostics; it was in a folder of its own.
- **Switches are checkboxes**, not sliders from 0 to 1. This also applies to **Auto exposure** in the view's
  exposure menu.
- **Each row's tooltip** says what the setting does. The Parameters panel shows the same text.

**Added**
- **Lights' rays** on/off (`lightRays`), in Light sources and the Render menu. It switches off the light objects'
  photons. Before, nothing could: unticking caustics left them running.
  - Off, the camera's paths count a light's visible face themselves. The light still reaches the picture, but
    through glass it is much noisier.
  - Off, a point light, a ray file and a collimated beam light nothing: only their photons carry their light.
  - The HUD says "LIGHTS' RAYS OFF", and Save picture says the picture is made without them.
  - Standard and High quality switch it back on. The measurement bench pins it on for every row.

**What to look at**
1. The Renderer panel. Are the boxes drawn as in the Analysis pane? Does Quality's row of five buttons fit on one
   line at your panel's width? Do the line's words change as you click from Sketch to High?
2. Click ⚡ on the view's toolbar. Draft (or Sketch) should light up in the Quality box, and Standard should light up
   again when you click ⚡ a second time.
3. A scene with an LED behind a lens: untick **Lights' rays**. The spot should go noisy or dark, the HUD should say
   so, and the Quality line should read "Lights' rays (light objects) off (Standard: on)". Tick it again, or click
   Standard, and the spot should come back.
4. The foot of the Quality box: **Developer settings**, the count and **Reset** should sit on one line. Tick it.
   Light sources should gain its three folders, and Ray marching and Diagnostics should appear under Render size.
   Move one of them (Max Iterations, say) and untick: the count should read "1 not at default" in amber, and Reset
   should put it back.

## 0.15.0 — 2026-10-04

**Added**
- **A custom axis**: **axis** in the Analysis pane's Intensity data offers **custom (a vector)** after the scene's
  lights. It brings a field, **axis x, y, z**, for γ = 0 in the world's x, y, z: for a beam that does not run along
  any light's axis. Three numbers separated by commas or spaces. Anything else, or 0, 0, 0, is refused with a word
  under the run bar, and the field shows the vector as it was. C = 0 is the world's +x made square to the axis, or +y
  when the axis runs along x.
- **Flip direction**, under **axis** in the Analysis pane's Intensity data. γ = 0 then runs along the light's −z
  instead of its +z, for a beam that leaves the other way, such as a light facing into a reflector. Before, such a
  beam had its peak at γ ±180° in the polar diagram and I – γ.
  - C = 0 stays where it was, so the frame turns half a turn about it: γ becomes 180 − γ, and C 90 and C 270 change
    places. It is turned, not mirrored.
  - Like choosing another axis, it needs the analysis traced again: Live picks it up from its next round, and after
    ▶ Run the charts say to run it again.

**What to look at**
1. Axis › custom, then type the beam's direction, for example `1, 0, 0` for a beam along +x. After ▶ Run (or the
   next Live round), I – γ should peak at 0°.
2. A scene whose beam peaks at ±180° in I – γ. Tick **flip direction**, then ▶ Run (or watch Live). The peak should
   be at 0°, and the polar diagram's beam should point down the chart, where it pointed up.

## 0.14.0 — 2026-10-04

**Changed**
- **Live's rounds add up only with Σ**, the new switch beside Live on the run bar. It is **off at first**: each round
  is shown on its own, that many rays every time, so two results compare like for like, as in 0.11.0. With Σ on,
  the rounds add up while nothing changes, as in 0.12.0 and 0.13.0, and start over when something does. Switching
  Σ either way while Live runs lets go of what was added up: with it on, the sum starts again from the next round.

**What to look at**
1. Live with Σ off: the run bar reads `live · 1,000 rays · … s a round` every round, and the charts jitter by the
   noise of that many rays.
2. Click Σ (it turns green): the run bar reads `live · N rays in M rounds`, and M should climb while nothing moves.
3. Click it off again: back to one round at a time.

## 0.13.0 — 2026-10-04

**Added**
- **An aspheric lens** (+ › Shapes › Optics › aspheric lens), for a condenser. It has two faces, each an even asphere:
  `z(r) = c r² / (1 + √(1 − (1 + k) c² r²)) + a4 r⁴ + a6 r⁶ + a8 r⁸ + a10 r¹⁰`, with `c = 1 / r`. Each face's sag is
  measured into the lens from its vertex at ± thickness/2:
  - a positive radius bulges out, 0 is flat, a negative radius is hollowed in;
  - `k` is the conic constant: 0 a sphere, −1 a paraboloid, below −1 a hyperboloid;
  - the a's are in the scene's unit.
  A datasheet in Zemax's signs lists the face the light enters by in this sense. For the face it leaves by, negate
  `r` and the a's (`k` stays). It is a glass by its material, like the lens.
- **It starts as a condenser** that is exact on axis: diameter 1, thickness 0.3, a hyperboloid face (r 0.5,
  k −2.25 = −n²) over a flat one. In glass of n 1.5, a light on the axis 1 unit beyond the curved face's vertex
  (z = 1.15 from the lens's centre) leaves the flat face as a parallel beam. The shapes test traces 40 rays from that
  point through the face's own normal with Snell's law, and every one runs along the axis to within 1e-9.
- **Its distance is a bound on both sides, never too large**, which glass needs. Each face's height above its
  surface is divided by the steepest the face can be inside the aperture, worked out from its parameters. So it
  holds for any values the sliders give. Its normal is exact. Steep faces march in shorter steps for it: a face at
  60° at the rim halves them. Its cost per frame is not measured.
- **Its ranges are wide** (diameter and thickness up to 1000, radius ±10 000): ranges are not converted with the
  scene's unit, and a 25 mm condenser in a millimetre scene is 25 of them.

**Fixed**
- **A number parameter with no range** can now be typed below 0 and above 100, and shows its own digits.
  - The property table gave such a number a range of its own, 0 to 100 widened to its first value, so −0.5 typed
    in became 0. That held for a lens's a's, and for any parameter a person added without a range.
  - It also showed the number to two decimals, so an a4 of 1.6e-5 read 0.00. It now reads `1.6e-5`.
  - These fields have no slider; arrow keys still step by 1.

**Known limit**
- **The a's are in the scene's unit, and are not converted** when the lens moves to a scene of another unit (the
  library, a copy to another scene). Its lengths are converted; the a's are not, so retype them there.

**What to look at**
1. Builder › + › Shapes › Optics › aspheric lens in a centimetre scene. Give it a glass (n 1.5) and put a small light
   on the axis 1.15 above its centre, shining down. Turn on the rays. They should leave the flat face parallel.
2. The same lens in the picture: it should look like a smooth plano-convex lens, with no speckles or holes. Speckles
   at its rim would mean the bound is not holding.
3. Type a datasheet's values: r, k and the a's, e.g. an a4 of `1.6e-5`. The field should show what you typed, and a
   negative one should stay negative.
4. Its frame rate against the spherical lens, the same size, in the same scene.

## 0.12.0 — 2026-10-04

**Measured before it, on the user's machine** (0.11.0): a Live round of 4 batches took 1.4 s with the picture
running and 0.2 s with it stopped (`RT.stop()`), at 1 000 rays and at 100 000 alike. So the time was waiting, not
tracing.

**Faster**
- **One readback a round, where there were sixteen.** Each batch was read back four times (tallies, far field,
  the hits' count, the hits), and every readback waits for everything submitted before it, the picture's frames
  included. Now each batch's results are copied on the GPU into a slot of their own as soon as it is traced, and a
  run reads a group of batches back at once: as many as fit in 32 MB, which is a whole round of up to about
  800 000 rays (with a detector in the scene; more without). The rays' own trace reads once where it read twice. No number changes; only when they are read.
- How fast a round is now is **not measured**. Inferred: about the 0.2 s a round took with the picture stopped,
  plus about one picture frame.

**Added**
- **Live's rounds add up while nothing changes.** Each round is merged into one estimate: the error bars shrink,
  the far field smooths and the map fills in, as the picture does. The run bar reads
  `live · 12,000 rays in 12 rounds · 0.21 s a round`. It starts over from one round whenever the picture starts
  over (a scene value, the camera, the scene, a light), or when the trace's own settings or the ray count change.
  A round during which something changed is shown on its own and not kept. So while you drag something, each round
  is shown alone, as in 0.11.0; once you let go, the rounds add up.
  - **The camera starts it over too**, since it starts the picture over. That is safe, but orbiting to look at
    something throws the rounds so far away.
  - **The map stops filling in at 500 000 detector hits**, the same limit as ▶ Run. The totals and the far field go
    on converging. To keep the script's work down while it adds up, the map is made again only when the kept hits
    have grown by a quarter. For half a million hits, rescaling and mapping took about half a second in Node on the
    build machine, which is not your computer.
- `RT.resets()`: how many times the picture has been asked to start over.

**Fixed**
- **A run keeps the settings it started with.** A setting changed during a ▶ Run used to apply from the next batch
  on. Now it applies from the next run.
- **Each batch is scaled by the lights it was traced with**, not the ones there when it is read back.
- **The readback is the same size every round.** Reading each batch's hits at their own count made a new staging
  buffer size almost every batch, and tinywebgpu keeps up to four buffers of every size it has seen. With Live
  left on that was GPU memory growing without bound (read in the code, not seen).

**What to look at**
1. RGBW_mixer, Live at `1 × 1k` with the picture running. Please paste "s a round". It was 1.4 s; with the
   picture stopped it was 0.2 s. Then `100 × 1k`. Now it should grow with the count, where it did not before.
2. Leave it still. The run bar's rays and rounds should climb, the polar diagram should smooth out, and the
   cards' "±" should shrink.
3. Move the lens with the gizmo. While you drag, the rounds should read one at a time. When you let go they
   should climb again. Orbiting the camera starts it over too.
4. If the rounds never climb with nothing moving (always `1,000 rays`, no "in N rounds"), something resets the
   picture every frame. Please say so: then the counting is wrong somewhere.
5. ▶ Run at `1 × 10M`. It should take less time than in 0.11.0 for the same rays (fewer waits), and give the same
   numbers within their error bars.

## 0.11.0 — 2026-10-04

**Added**
- **Live analysis.** A **Live** switch on the Analysis pane's run bar, beside ▶ Run. While it is on, the analysis
  runs again and again. Each round is what ▶ Run does (that many rays, in at least four batches, each number with
  its standard error) on fresh rays, for the scene as it is at that moment. Every chart, card and total shows the
  last whole round, swapped in when the round ends, so they follow each edit in the Builder. A round does not add
  to the one before, so the noise of the ray count stays as it is. Switching Live off lets the round in progress
  go, and the charts keep the last whole round. ▶ Run is disabled while Live is on, and Live while ▶ Run runs. The
  run bar reads `live · 1,000 rays · 0.20 s a round`. A round that fails stops Live and says why under the run bar.
- **Live goes on through a structural edit.** The renderer puts a new scene in `RT.scene` before it builds it,
  and the scene's uniforms in after. A trace in between can be refused by name ("Unknown uniform"), and that
  would have stopped Live on the very edit it is for. So no round starts while a scene is being built or swapped
  in (the run bar says `live · waiting for the scene to build`), and a round the scene changed under, or during
  which a build began, is let go rather than stopped on. The renderer says when it is building through a new
  `RT.sceneBusy()`, the host's own test for when to present a frame.
- **The ray count is a number times a multiplier**: × 1, × 10, × 100, × 1k, × 10k, × 100k, × 1M or × 10M. It
  was a field in millions, with at least 10 000 rays. Now it is anything from 1 ray to 50 million. Typing 500k
  or 2M in the number sets the multiplier too. ▶ Run traces that many in all, and Live that many each round.

**Changed**
- **The rays drawn over the picture are only ever a trace's.** The optics module copies the rays' paths into a
  buffer of its own after each of their traces (and each step), and draws that copy. It drew whatever was in the
  trace buffer, which an analysis fills with its own batches. So during ▶ Run, with the rays shown, it drew each
  batch's paths in turn (read in the code, not seen on screen), and with Live it would have done that every round.
  Now the rays stay on screen as they were, then follow the scene again once ▶ Run is over. During Live they are
  traced once between rounds.
- **An analysis gives the rays back their random numbers.** Each batch draws its own, and the last batch's used
  to stay, so after a ▶ Run the rays drawn were a different set. They are now the same set as before.
- **The rays switched on during a ▶ Run** start when it ends. Before, they switched themselves off again with
  "rays stopped: a trace is already running".

**What to look at**
1. Optics: the run bar reads `1` and `× 1M`. ▶ Run should behave as before: four batches, the charts filling as
   they come, `1,000,000 rays · time` when done.
2. Choose `× 1k` and press **Live**. The button turns green (`■ Live`), ▶ Run greys out, and the run bar says
   `live · 1,000 rays · N s a round`. Every chart, the cards and Totals should change every round. Move a lens
   or a light in the Builder: the polar diagram and the map should follow within a round or two.
3. Raise the count (`100 × 10k` is a million) with Live on. Rounds should take longer and the charts move less
   from round to round. How long a round takes on the card is not measured; please paste the run bar's number for
   a light scene and a heavy one at 1 000 and at 100 000 rays.
4. With the rays shown (the view's RAYS) and Live on: the rays should look exactly as they do with Live off. No
   flicker, no long rays traced to the end flashing over them. Moving a light, they should follow it as before,
   once a round.
5. Press Live again in the middle of a round with many rays (`5 × 1M`). It should stop at the end of the batch it
   is in, not the round. The charts keep the round before, and the run bar says the rays and the time.
6. With Live on, make a structural edit (add a shape, or change a material's type). The run bar should say
   `live · waiting for the scene to build` while the scene compiles, and then go on with rounds of the new scene.
   Live should not stop. If it stops, the message under the run bar says why: please paste it.
7. With the rays shown, press ▶ Run. The rays should stay as they were during the run, then follow edits again
   after it, and be the same rays as before the run (the same lines, not a new random set).

## 0.10.4 — 2026-10-04

*This branch numbered it 0.13.0. Main had already used 0.13.0 for its own entry, so it took 0.10.4 when main was merged in (0.21.3).*

**Added: arrays** (scene format version 17; `docs/PERFORMANCE.md` P3, call 4; the user: "a group of components placed
at positions defined by an array"). A plain group can have **copies**, up to 16. Its children are drawn once at each
copy, and their code is in the shader once however many copies there are.
- Properties > a group > *copies*: **Make it an array** makes a row (count, pitch, axis). Each copy's place is then
  typed, one a line: `x, y, z`, and `rx, ry, rz, scale` after it to turn or scale that copy. *No copies* makes it a
  plain group again. The tree marks an array `× n`.
- Moving copies is live. Changing the count compiles in the default mode; as data (the developer switch) it does not.
- An array can hold anything a plain group can: objects, CSG groups, other arrays. It cannot hold a light yet, since
  light sampling needs each face once, where it is. A group with code or with joins among its children cannot be an
  array; put that group inside one.
- Something inside an array is shown, measured and moved where its **first** copy is.
- Culling sees every copy: an array's box holds them all.

**Checked without a GPU of the user's:** on Dawn over a CPU Vulkan, an array gives the same field, normals and picks as
the same copies written out as groups. That holds in codegen and as data, with turned and scaled copies, a CSG group
in each, and an array inside an array (`builder/test/scenedata.gpu.mjs`). Nothing says how fast it is, or what it
looks like.

**Changed:** in the scene as data, a value of a node inside a compiled subtree (group code, a relief) is live only
through that subtree's uniforms. A count changed there compiles, as it must.

**What to look at:**
1. Make a group with a lens in it (or anything), then Properties > copies > *Make it an array* with 5 along x at the
   lens's width. Five lenses; the march kernel's size in the status line after the compile should be about what it
   is with one (each copy adds a uniform and a line of a switch, not the lens's code again).
2. Type a place, Apply: that copy moves, no "compiling" in the status. Turn one: `x, y, z, 0, 0, 45, 1`.
3. Change the count: a compile (default), none with *Scene as data* on.
4. Select the lens inside: its handles are on the first copy.

## 0.10.3 — 2026-10-04

*This branch numbered it 0.12.0. Main had already used 0.12.0 for its own entry, so it took 0.10.3 when main was merged in (0.21.3).*

**Changed: the scene file format, version 16 — blocks** (`builder/model.js`; `docs/PERFORMANCE.md` P3, the
architecture agreed with the user). A scene now keeps a list of **blocks**: a piece of code with its parameters'
names, kinds, defaults, ranges, constants and lengths. An object or a group with code names a block and keeps only
its own values.
- **Editing a block's code or parameters changes every node that uses it.** Duplicating an object shares its block.
  Properties > *block* says which block it is and how many use it, and offers **Make a copy for this one alone** (a
  variant), a name, and another block of the scene's to use instead.
- **Built-in blocks** (every primitive and modifier, e.g. `sphere@1`) are read-only. The first edit to a sphere's
  code or parameters gives that sphere a copy of its own, so editing one preset sphere still changes only that one.
- A constant's *value* is still each object's own; two values compile to two functions.
- Version 15 files load as before: each distinct code with its schema becomes one block. Every bundled scene was
  re-saved at version 16 and compiles to the same shader, byte for byte (`codegen.test`'s frozen shaders). The
  optics benches' files are about 25% smaller.
- Pasting, the clipboard and the library carry an item's blocks with it. A block the scene already has (the same
  code and schema) is reused; one with the same name and other code is added beside it (`lens 2`), never over it.
  Library items saved before this version get their blocks as they are put in. To keep a block in the library,
  keep an object that uses it (*Keep* in the Library panel). The library's export file is version 2.

**Fixed**
- A built-in block took the name and the values of whichever node first used it (a library item's floor).

**Not fixed, found:** `recipe.test` fails on the optics benches, at this version and the one before. Applying a
group's recipe unchanged clears the dormant join its first shape carries, and another test says it should. Which
one is right is the user's call.

**What to look at:**
1. Open the optics bench (or any scene). Select an object: Properties shows *block: …* and how many use it. Select
   a lens and edit its code, then Apply: every lens with the same block changes.
2. Duplicate an object with code of its own, edit one copy's code: both change. Then *Make a copy for this one
   alone* on one, edit it: only that one changes.
3. Edit a preset sphere's code: only that sphere changes, and its block row no longer says *built in*.
4. Open a scene saved before this version (or a library item made before): it looks and renders as it did.

## 0.10.2 — 2026-10-03

*This branch numbered it 0.11.0. Main had already used 0.11.0 for its own entry, so it took 0.10.2 when main was merged in (0.21.3).*

**Added**
- **The scene as data, behind a developer switch** (Renderer > Developer > *Scene as data*, off by default;
  `builder/scenedata.js`, `docs/PERFORMANCE.md` P3). A builder scene becomes a table of records that one loop in the
  shader walks, instead of one block of code per node. The shader holds each distinct piece of object code once (a
  *block*), the loop, and whatever the loop does not handle yet, compiled as before: group code, an object wearing a
  material's relief, and a CSG group with either inside it.
  - **An edit that adds no code compiles nothing**: a node added that is a copy of one there, deleted, moved to
    another group, hidden, given another of the scene's materials -- and undoing any of them. The builder writes the
    records and the picture follows; the console says `scene applied as data: no compile`. New code, a new material,
    or CSG nested deeper than 8 groups still compiles (the deep CSG scene is made as before, and says why).
  - **Culling goes deeper**: every node under plain groups is skipped by its own box, where codegen skipped the top
    level only.
  - Off on a device that offers only 8 storage buffers a shader stage: the shade kernel needs a ninth for the
    scene's buffer.
  - It stays a developer's switch until the bench below says the loop is not slower (call 5: march, occlude and shade
    GPU time within 10% of codegen's).
- **A bench for that gate** (Tests > **scenedata**; `bench/scenedata.js`): every bench scene, the two optics benches
  and 32 lens assemblies, each as codegen and then as data, back to back, then the first row again.

**Fixed**
- The renderer could not take a scene with GPU buffers of its own, which no scene had until now: binding them threw
  (`resources` is write-only), the first scene's `init` was never called, the scene before was never freed, and the
  optics trace kept a freed buffer bound when the same scene was set again.
- An undo that changed only values left a codegen scene unculled until a box changed (the boxes' uniforms were put
  back to "unknown", and the page believed it had sent them).

**Checked without a GPU of the user's**: the loop's distances, materials, normals and picks equal codegen's on every
bundled scene, and culling with the same boxes gives the same field (`builder/test/scenedata.gpu.mjs`, on Dawn over a
CPU Vulkan; optional, and says so when it cannot run). None of this says how fast it is, or what it looks like.

**What to look at:**
1. Press Tests > **scenedata** (about five minutes; leave the window alone) and paste the whole report. The columns
   that decide are `march`, `occlude` and `shade` of each "as data" row against the "codegen" row above it.
2. Turn on Renderer > Developer > *Scene as data*. The scene is made again once. Then, in the Noise library or the
   optics bench: duplicate an object, delete it, drag one into another group, hide one, give one another material.
   Each should take effect at once, with no "compiling" in the status, and look as it did with the switch off.
3. With the switch on, check a pick (a click in the picture selects the right node, also after a duplicate) and the
   boxes (the toolbar's box button) on a scene with groups.

## 0.10.1 — 2026-10-03

**Added**
- **A scaling benchmark** (Tests > **scaling**; `bench/scaling.js`). It times how a sample's cost grows with the
  number of objects in the scene, which decides whether P3 needs a BVH (`docs/PERFORMANCE.md` P3, step 0).
  - The optics bench and OpticsBench2 as they are, frozen in `bench/scenes/`, and the optics bench with its culling
    off. Neither optics scene had ever been timed.
  - The optics bench's lens assembly 1, 4, 16 and 32 times. Every copy row shows the same picture: one assembly
    framed, the other copies standing behind the camera. The march tolerance and the scene's radius are the same in
    every copy row, so the count is the only thing that changes. Then 32 with culling off, and 1 again as a drift
    check.
  - A copy row measures the culling boxes of the stage and the first assembly only, and gives every copy the first
    one's box (a box is in its node's own frame). Measuring all 640 nodes on the GPU would take minutes.
  - Not in these rows: the lights' photons. The page lights only the builder's own scene with them.

**What to look at:** press Tests > **scaling** (a few minutes; leave the window alone) and paste the whole report.
The columns that decide: `march` and `occlude` across rows 4-7 (1, 4, 16, 32 copies), and `compile ms` across the
same rows. `await BENCH.scaling.view(4)` shows what the copy rows render: the same picture in each of them.

## 0.10.0 — 2026-10-03

**Measured** on the user's GTX 1080 Ti, interleaved against 6b54026, the review's code (`docs/PERFORMANCE_REVIEW.md` §10.8): shade
compiles in 38-48% less time in every benchmark scene (the Noise library 11.4 → 5.9 s); a fresh structural edit
of the Noise library with the picture rendering took 4.9-5.9 s where it took 14-18 s; a sample's JavaScript is
44-74% less; a light scene's save renders a third faster (materials, 57 → 39 ms a sample). GPU time a sample is
unchanged, except that showcase and demo now run all 24 iterations (8-13% slower) where an accident had cut them
to 10 and 14. The pictures agree with it within the tests' own spread.

**Added**
- **A pipeline cache in `lib/tinywebgpu.js`.** A compute kernel whose text this GPU has already compiled in
  this session is reused, not compiled again. That covers a scene switched back to, an undo or redo of a
  structural edit, a scene change that fails and puts the scene before back, and the studio's renderer
  building kernels the main one already has (today the few with no scene in them). The key is the kernel's
  whole text, not a hash, so one kernel can never be handed another's pipeline. It keeps at most 48 kernels,
  and 24 million characters of their text, and drops the one used longest ago first. Only the compiled
  pipeline is shared. Each renderer keeps its own uniforms and bindings.
- **The console says how many came from the cache:** `[pathtracer] compiled 'scene' in 0.0 s from the request
  (14 of 14 from the cache)`. `RT._lastCompile` carries `fromCache` and `total`.
- **The measurements stay uncached.** The benchmark's `compile ms` and `compile seq` columns, and
  `RT.profileCompile()`, compile every kernel themselves and put nothing in the cache.
- **The builder's check never enters the cache.** Since 0.9.5 it makes a shader module and no pipeline, so the
  code editor's probe on every pause in typing cannot push the live scene's kernels out.
- **A pipeline is kept only once it is known to have no error of any kind.** A kernel compiled without
  `async` is checked for internal (backend) and out-of-memory errors as well as validation ones before it
  goes in the cache, so a failed compile is tried again rather than handed out. (Today the build compiles
  with `async`, whose failures were never kept.)
- **The `setScene ms` column changes meaning.** For a scene this session has already compiled it now reads
  about 0, so it is not comparable with earlier runs.
- **The "compiling the scene" bar moves by the clock.** It counted kernels ready, and nine of the thirteen are
  ready within a second, so it jumped to 12 of 13 and sat there until the shade kernel was done. Now the
  renderer predicts the build's time from the biggest kernel's size with every call inlined
  (`lib/pathtracer/core/compileprogress.js`). Measured on the 1080 Ti over 24 kernel and scene pairs, that size
  predicted a kernel's compile within a third on average (rms 33%), shade within 26% in every scene, and small
  kernels off by up to 85%. The plain text length was off by 366% rms. The bar moves with the time against that prediction and says
  "about N s left", then "taking longer than usual" once past it. It never reaches the end before the build
  does. The rate starts at the 1080 Ti's 15.2 ms per 1000 characters and is learned again on each computer from
  its own builds (kept in the browser). A build faster than a quarter of the prediction teaches nothing: after a
  reload the browser's own cache can answer, and the Noise library then built in 0.2 s, not 6.3 s (measured on
  the 1080 Ti, headless). No one build moves the rate more than twice, so a stalled one does little harm. A build
  all from the cache shows the count as before. The console's `compiled` line gives the time from the request,
  which is the interval the prediction is of, beside the prediction. `wgslgraph.js` moved to `lib/pathtracer/core` for it.

**Changed**
- **Four kernels no longer change with the scene.** Ray generation, resolve, the light tracer's photons and
  the emitter list's collect pass declared the scene's own uniforms, though none of them reads one. So their
  text changed with every scene, and with every edit that added or removed one of the scene's parameters, and
  each change compiled them again. They now declare only the uniforms every scene has. A scene change then
  finds them in the pipeline cache, and the studio's renderer shares them with the main one.
  `check-shaders.mjs` fails if any of the four differs between two scenes.
- **The uniforms are written once a trace, then only what moves.** March, shade and occlude were handed every
  uniform (up to 457 in OpticsBench) on every wavefront iteration, and the other kernels every sample, each
  value packed one by one. Now each kernel gets the whole set at its first write in a trace. After that it
  gets only the seed, the clock, the averaging window and the last-pass flag. The bytes the GPU receives are
  the same. Recording one sample at 1280x720 took 4-25 ms before and 0.5-2.4 ms after, across the ten
  bundled scenes (measured in node on a recording device, `bench/shaderstats.mjs` JS ms; that is this
  computer's JavaScript, not a browser and not a GPU time).
- **The shade kernels hold the BSDF fewer times.** Every call is a whole copy once the compiler inlines it, so
  each evaluation now has one call site. Light tracing's connection builds the camera's lobes once and
  evaluates them once, its floor chosen at run time; the `ltEvalBsdf` helper is gone. The three lights of light
  sampling (a light's face, an emitter, the environment) each choose a direction, a density and a radiance, and
  the lobes are evaluated once after them. The bounce takes its pdf once for both of its weights. Sketch's three
  lights are the passes of a loop the compiler cannot unroll. Each light keeps its own random draws, guard,
  divisor and threshold. Copies in shade and the optics shade: makeLobes 4 → 2, lobesEval 9 → 3, lobesPdf 6 → 3,
  misWeight 5 → 3. Inlined size (`bench/shaderstats.mjs`, static, not a compile time): shade 75K smaller in
  every scene, for example the Noise library 500K → 426K, Builder demo 245K → 170K, OpticsBench 1031K → 956K.
- **The pick kernel holds the scene once instead of eight times.** The march, the capture and the six points of
  the fallback normal are the passes of one loop with one SDF call. They are the same points in the same order
  with the same arithmetic. Inlined size: Noise library 487K → 63K, OpticsBench 1610K → 203K. It compiles on the
  first click after a scene change.
- **`bench/test/copies.test.mjs` pins those counts** for every bundled and benchmark scene, in shade, the
  optics shade and pick, so a call site that comes back fails a test.
- **Saving a picture, the timeline's frames and the library's pictures keep one sample in flight.** The next
  sample is recorded while the GPU runs the one before, where each was waited for in turn. Same samples, same
  kernels, same picture. In the benchmark this took a sample from 257.6 to 225.0 ms in the Noise library and
  from 57.5 to 42.9 ms in materials (measured by the user, GTX 1080 Ti, 1280x720, 0.9.2 · e1c7aad). That was
  before the uniforms change above cut the recording, so the gain now should be smaller. A timeline frame's
  samples overlap only within the frame. The library's live tile still draws on samples 1, 2, 3, 4 and then
  every second one, but after a stop it can now take two samples to give the view back, where it took one.
  `renderFrame` still defaults to one at a time, so the benchmark's single samples are unchanged.
- **Every sample runs the full iteration budget: the worst case, `(maxbounce + 1) + ceil(maxiter / 32)`.**
  The adaptive budget is gone. Its shrink never fired when it should, because `used` reads the budget itself
  whenever one path is still going. It did fire by accident: from a fresh start with a stale reading it dropped to
  4 iterations and climbed back only to 8, which is how the benchmark's materials row ran 8, 24 and 8 iterations
  in three runs (measured by the user, GTX 1080 Ti). And it never followed a rise in the worst case: High quality
  (maxbounce 24, worst case 38) kept running 24 iterations. Now light scenes run all their iterations. At 8
  iterations, 0.32% of materials' paths were cut short; at 24, 15 paths a sample. That costs a light scene the time
  outside the GPU of the extra iterations: materials went from 53.7 to 85.6 ms a sample between 8 and 24
  iterations, before this version's uniform writes cut the recording (measured by the user, GTX 1080 Ti); not
  measured since. `budgetOverride` still pins the count. `autobudget` and `flushTolerance` still exist, so old
  scripts and the test bench's rows can set them, but they do nothing. The `budget-image` and `budget-cost` tests
  now compare a render with itself, and their notes say so. The counters are read back every frame, with
  `autobudget` off too, so the HUD's and the cost tests' `used` and `flushed` are never left over from before.

**Fixed**
- **A shadow ray in the last pass is traced to the end, not counted lit after 32 steps.** Nothing traces the
  last pass's shadow rays again, and one still marching after 32 steps was treated as unoccluded: a bright
  bias. In the Menger cubes that was 3,945 of the last pass's 6,253 shadow rays (measured by the user, GTX 1080
  Ti, the benchmark's wavefront log). The last pass now runs the occlusion test again on what is left, round after
  round, 32 steps each as on every pass, until every shadow ray is blocked, reaches its light, or runs out of
  `maxiter`: 13 rounds at the default `maxiter` 400. Only shadow rays out of `maxiter` are still counted lit, and
  the benchmark's `cut` column now counts only those. No dispatch marches further than before: a draft that marched
  the last pass up to `maxiter` steps in one dispatch was running when the user's page lost its GPU
  (`DXGI_ERROR_DEVICE_HUNG`) on a heavy scene. That was not established as the cause, but the rounds rule it out.
  The rounds come in pairs, and a heavy frame may end a submission between pairs, as it may between iterations.
  Each round costs three small dispatches, and almost always over an empty queue (not measured). The build has a
  14th kernel for them, the shadow queue's own flip.
- **A heavy frame is not cut more coarsely because the budget grew.** A frame over 250 ms is cut into submissions
  of about 150 ms, so that none nears Windows's 2 s limit. The cut assumed every iteration costs the same, and
  they do not: the first few carry nearly all the rays. More iterations, which cost almost nothing, made each one
  seem cheaper and put more of the heavy first ones in one submission. High quality's 38 iterations would have cut
  a 600 ms frame every 9 iterations instead of every 6. Now the frame's time is divided by at most 24 iterations,
  so no submission is coarser than at 24.
- **A frame of a new shape is cut every iteration until it has been timed.** The cut is sized from the last
  frame's time, so raising `maxiter` or `maxbounce`, or choosing High quality, sent the next frame, the new worst
  case at once, with the old frame's time: a fast frame's reading would have left it uncut, one submission
  several times as long (inferred in review, not seen). A frame time now counts only for frames with the same
  iterations and `maxiter` as the one it timed.
- **`check-shaders.mjs` runs its lint pass on Windows.** It started `npx` without a shell, which fails there
  (`npx` is `npx.cmd`), so the pass always said SKIPPED.
- **A structural edit no longer waits behind the live picture.** The builder's apply checked the new scene
  with the render loop still submitting frames, and only `setScene` stopped the loop and drained it. With the
  loop running, applying a scene already compiled once in the Noise library took 1.4-6.8 s, and 0.2 s with
  it paused (measured on a GTX 1080 Ti, headless Chrome). The apply now holds the loop from before its check
  until the new scene is in and the values set during the compile are replayed. Held is not paused: the loop
  stays running, the play/pause control does not change, and it draws again on its own when the apply ends,
  whether the scene compiled, was refused, or threw. Meanwhile the picture does not move. That is the check
  (9-59 ms in the Builder demo, measured with another window rendering) and then the compile, during which the loop was already stopped. For a host, `RT.hold()`
  returns the release, and holds nest (`lib/render-loop.js` `held`, `makeHolds`).
- **A frame queued behind another is no longer timed with its wait.** `R.frameMs` decides how finely a heavy
  frame is cut into submissions, so that no submission nears Windows's 2 s limit. It was timed from recording
  to done, so with two frames queued (the live loop, or a save keeping one in flight) a frame also counted the
  wait for the one before. A 200 ms frame could read over 250 ms and be cut into submissions it did not need.
  It now counts from its recording or the frame before it ending, whichever is later, and every frame is timed,
  up to four at a time. A frame left untimed past that makes the next reading too long, and a reading too long
  cuts finer, which is the safe side.
- **A light inside a CSG group is drawn and traced.** It was treated as if it were under group code, so it had
  no face in the picture and the optics trace skipped it. Its rays never showed, and nothing in the view said
  why (OpticsBench2's laser: the disc light sits in a group inside the CSG group `lensholder`). A combine moves
  nothing, so the light is now where its transforms say, as under a plain group. It is drawn after the
  combine of its outermost CSG group, through the frames of the groups between, so it is never unioned into a
  shape or cut by one. The CSG shape's own code is unchanged. A light under group code is still not drawn
  (code can move it anywhere), and the trace still skips it.
- **The Rays view says when a light is not traced, and why.** With the rays on, the RAYS group of the view's
  analysis drawer names each light the trace skips with its reason, or says there is no light to trace and
  how to add one. The rays' settings list the lights the rays start from, and the ones they do not.

**What to look at**
1. Switch scene A → B → A. The second A should come up at once, and its console line should read about
   0.0 s with `14 of 14 from the cache` (14 kernels since the shadow flip below; 13 before). The `[builder] scene applied: ... pipelines N ms` line should be
   small too.
2. Make a structural edit (add a shape), wait for it to compile, then undo and redo. Each should apply
   without a compile wait.
3. Nothing in the picture should change. A cached pipeline is the same compiled text.
4. A kernel that comes from the cache logs no compile warnings. Its first compile still logged them.
5. Nothing in the picture should change from the uniforms being written once a trace, in any scene, with
   NEE and light tracing on or off. Let a scene accumulate for a few seconds. Then drag one of the scene's
   own sliders (a material's colour) while it renders: the picture should follow at once.
6. The console should show no `Unknown uniform` error in any scene. Check with TRACE2 on too (Experimental ›
   TRACE2), which is the one other path that hands these kernels their uniforms.
7. The benchmark's `record ms` column should fall. Compare it with runs of the code before, interleaved.
8. Nothing in the picture should change from the BSDF being evaluated once. Look at light sampling with
   faces, emitters and the sky (a scene with a lamp and an emissive object, NEE on), light tracing through
   glass (caustics), and Draft and Sketch. The benchmark's `compile seq` for shade should fall.
9. Click a surface without an exact normal, such as a blended shape or a relief. The gizmo should sit on it
   and face along the surface as before. The first click after a scene change should be quicker.
10. With the picture rendering (not paused), make a structural edit in a heavy scene such as the Noise library
    (hide a node, then show it again). It should apply in about the time of its compile. The console's
    `[builder] scene applied: probe P ms, pipelines Q ms, total T ms` should have T close to P + Q, where it
    was seconds more. Afterwards the picture should go on rendering by itself and the play/pause button should
    never have changed. Do the same with a scene that does not compile (a typo in a node's code). The picture
    should keep rendering the last scene that did.
11. Save a PNG (64 samples) and export a short timeline. Each should finish sooner than in the build before, and
    the pictures should look the same, with no frame darker, brighter or noisier than its neighbours. Abort a
    save halfway: it should still stop and give the view back.
12. In the Library, rest the pointer on a tile so it renders live. It should converge as before, and the main
    view should come back when you leave the tile.
13. Save a PNG of the Noise library, then type `RT.frameMs` in the console. It should be about one sample's GPU
    time (the benchmark's `gpu ms` for that scene and size), not about twice that.
14. Choose High quality and read the iterations on the HUD's speed line (`[Nx38 it]`, or `RT.hud.iterations`
    in the console). It should read 38. 24 means the budget did not follow the worst case. At the default
    quality it should read 24 in every scene, and stay there.
15. Run the benchmark. Every row's `budgetTimed` in the JSON should be its own worst case throughout, 24 at
    the defaults. Light rows such as materials may be slower than in runs where they sat at 8 iterations.
    Compare only interleaved runs.
16. In the same run, the `cut` column should fall to about 0 in every scene, and to the `maxiter` cuts alone in
    the Menger cubes (about 1,000 at the full budget in the second run). Pictures with NEE on should look the
    same. Where a shadow is cast through a long, thin gap, it may be a touch darker than before, never brighter.
17. Open the heaviest scene you have (the Noise library, or one of your own with everything on) with NEE
    on, at High quality, and leave it rendering. The GPU must not be lost (`DXGI_ERROR_DEVICE_HUNG` in the console). `RT.hud.splitEvery`
    is how many iterations go in a submission: it should be no larger than at the default quality for the same
    scene.
18. Make a structural edit in a heavy scene (the Noise library: add a shape). The compile bar, over the view
    and in the status bar, should move steadily rather than jump near the end and wait. After a build or two
    its "about N s left" should be roughly right. Compare the console's `compiled ... in X s from the request ...
    predicted Y s`. Then reload the page on that scene and edit again: the reload's build may come from the
    browser's cache in a fraction of a second, and the edit after it should still be predicted about right.
19. Open OpticsBench2 and click Rays. The laser's rays should start at its disc light inside the lens holder,
    and the lens holder should look as it did. The picture is now lit by the laser too, and the drawer should
    say nothing under the RAYS buttons.
20. Put a light in a group with code, such as a Twist modifier, and click Rays. The RAYS group under its
    buttons should name the light and say it is not traced because it is inside group code. With no light in
    the scene at all it should say there is no light to trace. Switch the rays off and the note goes.

## 0.9.5 — 2026-10-03
*Numbered 0.9.3 on the branch it was made on (`claude/brave-tesla-q2y8za`); `main` took 0.9.3 first, for the P3
design, so it is renumbered here (CLAUDE.md, Versions).*

**Faster** (compile time; nothing in the picture should change)
- **The builder's check before a structural edit no longer builds a pipeline.** The probe that says which node
  broke a scene used to be compiled into a full pipeline and waited for, about 1.2-3.1 s before every
  structural edit and on every pause in the code editor's typing (recorded, `PERFORMANCE.md`). Its messages
  always came from the shader module alone, and that takes tens of milliseconds (measured: 27-33 ms for a
  march kernel's module on the Pascal card). It is the module alone now. A kernel only the driver refuses is
  still reported, by the build itself.
- **The shade kernel holds half as many copies of the scene.** Shading a hit asks the scene three things: its
  normal, its material and the medium beyond it. The emitter probes and the paths each asked all three in
  their own functions, and the compiler pastes the whole scene in at every call. Now each question is asked
  at one place for both. The Noise library's shade kernel holds the scene's SDF 4 times instead of 8, and its
  materials 2 times instead of 4.
  - Measured here (static): shade's inlined size falls 13-37% across the benchmark's scenes.
  - Forecast, from the Pascal card's measured rate per size: the Noise library's shade compile from 10.7 to
    about 6.7 s, Surface materials from 7.0 to about 4.7 s, materials from 2.5 to about 2.2 s.

**What to look at**
1. A structural edit in the builder: the console line `[builder] scene applied: probe .. ms, pipelines .. ms`.
   The probe should read tens of milliseconds, not seconds. A typo in a code node is still named at its node
   and line.
2. The pictures, unchanged: a glass scene (the medium beyond a surface), an emissive object with emitter photons
   on (the probes), the illuminance view, Draft mode. These Tests check themselves: `furnace`, `illuminance`,
   `emitters`, `lt`, `render-modes`, `optics-refraction`.
3. The compile, on the same card as before: `await BENCH.run(1, 25, 33)`. Read `compile ms`, `compile seq` and
   the JSON's `compileSeqEach.shade` against the earlier runs (Noise library: shade alone 10.5-12.0 s), and the
   `shade` column for its run time.

## 0.9.4 — 2026-10-03
*Made on 2026-10-02 and numbered 0.9.2 on the branch it was made on (`claude/brave-tesla-q2y8za`); `main` took 0.9.2 first, for the P3
design, so it is renumbered here (CLAUDE.md, Versions). Build stamps in measurements of the time still read `0.9.2`.*

**Added** (measurement only: nothing a render does has changed, and no picture can move)
- **A performance review**, `docs/PERFORMANCE_REVIEW.md`. It covers render and compile speed from the
  architecture down, ranks twenty-seven improvements on ease and gain, and sets them against `PERFORMANCE.md`'s
  plan.
- **Three columns in the benchmark:**
  - `gaps`: the GPU time between kernels that no kernel ran.
  - `tail ms`: the GPU time of the wavefront iterations that marched under a tenth of the first one's rays,
    from one more sample a row with a new wavefront log. The JSON carries every iteration's rays and kernel ms.
  - `compile seq`: the same 13 kernels compiled uncached one at a time, against the parallel compile beside
    it. The JSON adds each kernel's time, and what the march's text takes to validate with no pipeline made.
  - The compile rows now take about twice as long. Each row takes one sample more.
- **`await BENCH.run(1, 25, ...)`** in the console runs some of the benchmark's rows.
- **`node projects/raytracer/bench/shaderstats.mjs`** works without a GPU. For each bundled scene it prints
  each kernel's size with every call inlined, its copies of the scene, and what recording one sample asks of
  the CPU. `--bench` does the same for the benchmark's own scenes.
- **The first measured run** (the user's Pascal card) is the review's §10. It re-ranks the list and adds two
  items: one sample in flight offscreen (#24), and the shadow rays the last pass cuts short (#25).
- **Two more columns, from what that run left open:**
  - `record ms`: the JavaScript that records a sample, to its last submit.
  - `cut`: shadow rays a sample ended without a surface or their light, and so counted as lit. A new word in
    the GPU counters counts them. The JSON also keeps the iteration budget each row ran at.
  - The renderer's counters are now sized from their struct, in one place for the renderer and the optics
    trace both.
- **The second run** is the review's §10.5. The JavaScript is 6-12 ms of the 50-57 ms a sample spends outside
  the GPU; the rest is the browser's, about 1.9 ms an iteration in every scene, and some samples skip most of it.
  Cut shadow rays are a few per million at the full budget. The list gains #26, a sample cut into submissions.
- **For what that run left open:**
  - `pipelined`: ms a sample with the next one recorded while the GPU runs this one. Offscreen rendering
    (`renderFrame`) takes an `inFlight` option for it, and its loop is now a module of its own
    (`lib/pathtracer/samples.js`) with a test. Saves, the timeline and the studio keep the default, one at a time.
  - Each timed sample's wall clock and recording, in the JSON.
  - Rows 35 and 36: materials and row 1 with a submission per wavefront iteration (`R.submitEvery`, a renderer
    property for measuring, 0 = as before). Appended, so no row's number changes.
- **The third run** is the review's §10.6. One sample in flight took 13-25% off a sample (#24, measured). The
  iteration budget's drops to 8-18 iterations are, read in code, a shrink from the start state landing on the
  floor of 4 (#27, left as it is: exact or faster is the user's choice). The same kernels read 185 to 256 ms of
  GPU time over the evening, so the card drifts.
- **For the A/B the third run asks for:** `BENCH.run` takes rows in the order given, a row twice runs twice. Each
  row's JSON has the budget for every warm-up and timed sample, and the readings it started from.

**What to look at**
1. Nothing in the picture. Every render path is the one 0.9.1 had. The counter for cut shadow rays adds one
   atomic per such ray in the occlusion pass, and changes nothing it decides. The log and the timers run only
   inside the benchmark's own extra sample.
2. Optics: a trace runs and its counts read as before. It shares the counters' layout, which grew by a word.
3. A save (and its progress bar) works as before. It runs through the new sample loop, one sample at a time.
4. In the console, on the same card: `RT.autobudget = false`, then `await BENCH.run(33, 35, 33, 35, 1, 36, 1,
   36)`, then `RT.autobudget = true`. Paste the whole report back, JSON included. Each row against its pair says
   what a submission per iteration does; the repeats' spread is the card's drift.

## 0.9.3 — 2026-10-03

**Documented**
- **The scene as data: the architecture agreed** (`docs/PERFORMANCE.md` P3). A scene holds **blocks**, which are
  code and the parameters it declares, and **components**, which say which block they use and hold its values,
  a transform and a material. A component has no code and generates none. Adding, moving, regrouping or
  re-parameterising components would compile nothing; only a new block, or a block's code edited, would.
  - Editing a block's code changes every component that uses it; a variant is a duplicate of the block.
  - A scene's own blocks are in its file and can be copied to the library. A library component is components
    only; the blocks it uses go with it, and an identical block is reused rather than added again.
  - A group's code can no longer call its children; the evaluator calls a group's block before its children,
    after them, between two of them, or once per point of a list. That last kind is a loop, and gives arrays of
    components at positions from data. A large array has to become entries in a BVH, or every step near it pays
    for every copy.
  - Component parameters: a group's own values, with expressions inside it resolved on the CPU, so changing one
    compiles nothing.
  - Found in the code: a library item does not carry the scene's `functions` block, so an object whose code
    calls a helper would arrive in another scene without it (not tested).

  - **The open questions decided** (the user: "Make the calls on any decisions"), fifteen calls in P3, each with
    its reason. Among them: a library component is inserted as a copy, never a live link; the shader holds the
    blocks the scene uses, plus any compiled since it was opened; the new evaluator replaces today's generated
    code only if the bundled scenes are no more than 10% slower with it; materials are blocks; lights stay built
    in.

**What to look at:** nothing changes in the application. Read P3's *The architecture: blocks and components*,
and its calls, and say which you would decide differently.

## 0.9.2 — 2026-10-03

**Documented**
- **The scene as data, and speed for scenes of many objects** (the user: "maybe switch from the current
  code-based system (every object is a code block) to a database or array based system?"). `docs/PERFORMANCE.md`
  P3 is now a design, not a paragraph. It says what a step costs today and what grows with the number of objects,
  and what the change buys: no compile for a structural edit, exact boxes for stock shapes, no limit on scene
  size. What it does not buy by itself is speed; that comes from a BVH over the data, which it makes possible.
  - **A limit found:** every node's transform, parameters and box live in one uniform buffer of at most 64 KiB.
    Worked out from the code, not measured: about 500 single shapes at the top level, or 36 copies of the optics
    bench's lens assembly with live visibility on, fill it. Past that a scene cannot run.
  - **Worked out from the scene files:** 130 of the bundled scenes' 139 objects, and all their groups, are stock
    shapes and modifiers that could be data. The optics bench is stock throughout.
  - **An order**, each step measured before the next. It starts with two benchmark rows that do not exist yet: the
    optics bench timed, and 1 to 32 copies of its lens assembly, to see whether the march grows with the number
    of objects.

**What to look at:** nothing changes in the application. Read P3 in `docs/PERFORMANCE.md`, and say whether its
step 0, the two benchmark rows, should be built next.

## 0.9.1 — 2026-10-02

**Fixed**
- **Sun caustics in a small scene.** The sun's photons cross a square through the scene, 15 m half-size, whose
  learned map is 128 × 128 cells, each 23 cm. A 25 cm scene fit in a few cells, so even a photon aimed at the right
  cell met a 1 cm lens about one time in 500 (arithmetic on the code's numbers, not measured). The square is now
  never wider than the scene's radius: in a 25 cm scene a cell is 4 mm. The total cannot change, because the camera
  side keeps every path a photon could not have taken, whatever the square's size. Scenes with the default 400 m
  radius (every scene from before 0.9.0) keep the 15 m square exactly.
- **Light sampling of small glowing objects** (emissive materials; lights from the + menu were not affected). Light
  sampling aims at a sphere around the hits seen on the object, and that sphere was padded by a fixed 2 cm: around
  a 1 cm emitter, a sphere four times its size, most of whose cone missed it. Points within 2 cm of an emitter got no
  light sampling towards it at all. The padding is now the surface tolerance, and the search grid (also 15 m) is
  capped at the scene's radius like the photon square.
- What was learned is forgotten when the square or the grid changes size, as on a scene swap. Before, dragging the
  radius would have left the emitter grid aiming at positions from the old size.
- The bench took its light-tracing mask before the test's own scene and camera were set. That was harmless while
  the only test with a mask (`lt`) had neither.

**What to look at**
1. A small scene with a glass object in the sun, light tracing on: the caustic should be much less noisy than in
   0.9.0 after the same number of samples.
2. A small glowing object lighting its surroundings: the light around it should be cleaner.
3. Press **`small-caustic`** and **`small-emitter`** (Tests) and paste them back. Every row must hold its meanLuma
   (caustic) or its columns at 1 (emitter); `conn/photon`, `lt noise` and `seMax` say what the caps bought, against
   the rows that put the old square or the old 2 cm back.

## 0.9.0 — 2026-10-02

**Changed**
- **The environment radius is the scene's own** (the user: "I want the scene properties to contain the environment
  radius"). It is in the Scene settings (⚙ beside the scene's name), right after the unit, **in the scene's unit**,
  and it left the Environment folder, where it was a renderer setting in metres shared by every scene. It is live:
  dragging it changes the picture at once, with no compile, and is one undo step. Changing the unit relabels it and
  keeps the number, as it does for every length in the scene.
  - **Scene files are version 15.** A version 14 file's radius moves out of its environment onto the scene. A radius
    of exactly 400 m, the old default, is simply dropped, because every environment that was edited holds it. A
    scene without a radius has 400 m, whatever its unit, so every bundled scene looks as before.
- **A new scene is in centimetres, with a 25 cm radius**, and it opens with the camera close: looking at the origin
  from 4 cm, at the usual angle. Before, it kept wherever the last scene's camera was.
- **Every + shape fits a 1-unit cube** (the user: "sphere is now larger than cube ... ideally 1x1"). The sphere is
  1 across instead of 2. The capsule, torus, cone, round cone, octahedron, capped torus, link, dome, Fresnel lens,
  reflector, extrusion and revolution are smaller too, with their proportions kept. A shape already in a scene keeps
  its size, and so does an old (version 8) file.

**Added**
- **Double-click a node in the tree: the camera glides to it.** It frames the node's box and keeps the direction
  you were looking from. A group is framed whole. For a plane, the status says it has no end, and the camera stays.

**Fixed while testing**
- A double-click on a group's row did nothing: its first click redraws the tree, and the browser then sends no
  double-click event. The second click is counted instead (`tree.check` caught it).

**What to look at**
1. + New scene: ⚙ shows unit cm and environment radius (cm) 25, and the camera is close. + sphere gives a 1 cm
   sphere, about a third of the view high. The sky starts 25 cm out, so an infinite plane ends there.
2. Drag the radius below the scene's size: whatever lies beyond it vanishes at once, and Ctrl+Z brings it back.
3. The + shapes side by side: each is about 1 unit across. The modifiers were sized for the old shapes (a repeat
   spaces them 2 apart) and may look loose now.
4. Double-click tree rows: an object, a group, a plane.
5. Menger cubes and Demo look exactly as before.
- **Expected, not measured:** in a 25 cm scene the sun's caustics are probably much noisier than in a room. Its
  photons still cross a 30 m square, so most of them miss so small a scene (PLAN.md, L5).

## 0.8.0 — 2026-10-02

**Added**
- **A scale and twist per path point.** The user: "tube: scale, so change diameter per point / sweep: scale
  (x,y and both) and rotation".
  - A point is `x, y, z`, then a fillet, scale x, scale y and twist in degrees, each optional; left off they
    read 0, 1, scale x's, and 0.
  - The values change evenly along a straight and hold round a bend (the user's choice).
  - A tube reads scale x alone, as its diameter (the user's choice: round only).
  - The rounded tube stays **exact** outside: round cones along the straights, torus arcs round the bends.
  - A sweep or flat tube whose section turns or scales along a straight is a **bound**, so the march takes
    shorter steps there. How much that costs on a GPU is not measured. In shapes.test the bound is at least
    0.068 of the true distance, at worst, and its slope never above 1.
  - A path whose values are all the default is the same shader text as before.
  - A live path, or one being edited, writes its values as uniforms with no compile.
  - The scene format stays version 14. An older build refuses a file with such a point, by that point's
    number, and never reads it wrong.
- **The Points mode drags them.** At the selected path point, its section is drawn as it is swept there,
  with a second gizmo on it:
  - a sweep gets a cube for scale x and one for scale y, the dashed circle for both, and a violet arc
    about the path for its twist;
  - a tube gets the circle alone.
  - Ctrl puts a scale on 0.1 and a twist on 15°.
  - The panel at the top right shows the values, and Enter types them.
  - The panel's path text takes up to seven numbers a line.
- **A new shape, the twisted bar** (From points): a bar swept along a live path. It turns by `turn` degrees
  along its first straight, holds that round the bend, and narrows to 0.6 along the second.

**Changed**
- **A path or profile being edited, or live, is a loop in the shader**, over its slots, each read by its index.
  It used to be written out slot by slot, so a sweep's section was copied into the shader once per block. The
  light guide in Points mode (4 points, 8 spare) had its section at 51 places, and on the user's machine that
  compile took 70 s; it now has it at 5 places, however many points it has room for. The loop stops at the
  last slot in use, so the spare ones cost nothing while it renders. Compiled paths and profiles are written
  as before.
  - The loop's bound now goes through `noUnroll` (tracebasics.js), as every loop around the scene does. Its
    first bound said "at most this many slots", and the user found the compile only "a bit better". The likely
    reason (inferred, not measured) is that the compiler unrolled the loop back into a copy per slot.
  - **Measured on the user's machine**, entering Points mode, after both changes:
    - the light guide went from 70 s to 15.5 s (`compiled 'built' in 15.5 s; ready at (ms): shade 15528,
      occlude 3175, march 2978`; the builder's probe 2.3 s);
    - the twisted bar takes 12.0 s (shade 12010, occlude 2205, march 1836; probe 1.5 s).
  - Nearly all of what is left is shade, which holds about ten copies of the scene (`docs/PERFORMANCE.md`, P1).

**Fixed**
- Tint warned "code is unreachable" in the tube's function, in every kernel, when every path in the scene had
  a scale or twist.
- **A sweep through a sharp corner, with a section that does not straddle the path** (a profile beside its
  path, as the asymmetric L): just inside the face between a segment and the corner, the distance read too
  deep. In node it stepped 40 times the step across that face, so glass there could be marched through. The
  same held where a section reaches past a fillet's centre. Such a bend now counts its end faces too. With
  the section clear of the axis nothing changes, and the distance inside stays exact.

**To look at:**
1. The bent tube: in its route, give point 2 a fifth number, `0.5, -0.5, 0, 0.2, 2`. The tube should be twice
   as thick there, tapering along both straights. Check it with `rounded` 1 and 0, and as glass: no stepping
   through, no dark rims.
2. Points mode on the bent tube, point 2: drag the dashed circle out. The tube thickens there live, with no
   compile, the section's outline following it. Hold Ctrl for steps of 0.1; Escape puts it back.
3. Add › From points › **twisted bar**: a quarter turn along the first straight, held round the bend, narrowing
   along the second. Move its `turn` slider: no compile. Speckles or holes anywhere would mean the bound is too
   loose there.
4. Points mode on the twisted bar: drag a point's two cubes (scale x and y), its circle and its violet arc.
5. The frame rate on the twisted bar against the light guide (the same kind of section with no values): what
   the varying form costs.
6. ~~The light guide in Points mode: how long entering it takes now~~ -- **measured**: 15.5 s, from 70 s
   (Changed, above). Still open: the same `[pathtracer] compiled 'built' …` line for the light guide in
   Transform mode, not edited. Set beside the 15.5 s, it says whether any of that is still the path's own or
   all the scene's. Then drag a point and
   its section's handles: the picture should follow as it did once the compile was in. Whether a loop marches
   slower than the straight code did while editing is not known; the frame rate in Points mode against
   Transform says.

## 0.7.1 — 2026-10-02

**Fixed**
- **A scene that does not compile stuck the page, and every reload with it** (the user: a material that would
  not compile; a defective library material). Since 0.7.0 the page starts on your scene as it was left, and a
  material's code is in the scene while it is being typed, before it compiles. The first compile threw, and
  everything after it on the page never ran: the render loop and the autosave. So nothing done afterwards was
  kept, not even a new scene, and the next reload compiled the same scene. Before 0.7.0 the page always started
  on a bundled scene, which compiled. Now:
  - **A start whose scene does not compile** goes on with an empty scene. The status says which scene and what is
    wrong (the node and the line, as the code editor says it). The page works as usual: fix the code, or switch
    scenes; **▶ beside the scene's name** compiles it.
  - **A safe start** compiles nothing of yours: add `?safe` to the address, or it happens by itself when the last
    start never finished (closed, reloaded, or stuck while compiling, for a scene that hangs rather than fails).
    The ▶ compiles the scene when you are ready.
  - **A scene the renderer refuses after the compile check passed it** (a kernel the check does not cover) no longer
    leaves the renderer holding a scene it cannot draw, with its picture frozen: the scene before is put back and
    the status says it does not compile. The same when a project you open does not compile: the empty scene,
    not the last project's picture.
  - **"does NOT compile" now says what** in the status bar: the first line of the report (node, line, message),
    not just "see console".
  - **The library's pictures** no longer compile a part that has already failed again for each item in it (each
    a pause of the view); a part with a defective item is tried again when it changes.

**To look at:**
1. **Your stuck project**: reload. It should start on an empty scene, with the status naming the scene and the
   error, and the ▶ beside its name. Fix the material (or delete it, or switch scenes) and the picture comes back.
   If the page still sticks, open it with `?safe` (for example `index.html?safe`) and say what the console says.
2. Type a material's code so it is wrong, wait a second, reload: the same as 1, not a stuck page.
3. The library's defective material: its picture missing (with a warning in the console), the other pictures
   made, and the view not paused again and again.

## 0.7.0 — 2026-10-02

Scenes and projects, as decided by the user the same day (UI_PLAN.md section 10). No file format changed: a
project kept in the browser is a workspace, the format File › Save already wrote.

**Added**
- **Projects kept in the browser.** The project you work on is saved in the browser (IndexedDB) as it changes,
  so a **refresh comes back to it**: its scenes, the scene being worked on, the renderer's settings, every
  scene's camera, and a library item that was being edited (reopened, Save and Close over the view). The undo
  history is not kept. An edit made just before a reload is kept too (written to localStorage as the page goes).
- **File › Projects…**, the list of projects kept here: open one, **+ New project**, rename, duplicate,
  download as a workspace file, import a file, delete (it asks; no undo). Each row says its scenes, when it last
  changed, and whether it is open here or in another tab. Its foot says where they live, and offers to ask the
  browser to keep them for good.
- **A second tab on the same project works on its own copy**, saved as "<name> (copy)" once something is edited
  in it, never over the first tab's work. The switcher says "not saved yet" until then.
- **The scene switcher**, over the tree: the scene being worked on, its **+** (add to the scene: the menu the
  scene's row had) and its **⚙** (the scene's settings in Properties: name, unit, instant hide and show,
  functions), and the project's name. Its dropdown: Projects… at its head, the project's scenes (click one to
  switch; rename, duplicate, up, down, delete on hover), + New scene, and **Examples ▸**, a submenu. Nothing
  switches while a library item is edited.
- **Examples**: the bundled scenes, in the switcher's Examples submenu (and File › Open an example…). One opens as
  a copy in your project.
- **Submenus in the shell's popup menus** (`lib/shell/menu.js`), which the + and the Examples use.
- **Copy to / Move to another scene**: right-click an object, group or material in the tree. Nothing compiles in
  the scene it goes to; a move recompiles this one. One undo step.

**Changed**
- **The tree shows one scene**, the one being worked on, and **no row for the scene itself**: its Environment,
  objects and Materials are the top level, and the switcher names the scene. Clicking a row can no longer
  switch scenes. The scene row's ▶ (compile and show) went with it: a scene compiles when it changes, and when
  it is switched to. A library item's ✓ and × were on its row: they are the strip's over the view.
- **The toolbar has no New scene button**: it is in the switcher's list and the File menu. A + there beside the
  switcher's + would have meant two things.
- **A page starts on your project, not on the nine bundled scenes.** A first visit starts on one lightweight
  demo scene, *Builder demo* (5.4-6.2 s to compile on your Ampere card in PERFORMANCE.md's runs 3-4; *Material
  test* was faster, at 3.7-4.1 s, but is a test chart). `FIRST_VISIT` in `scenes/index.js` changes it.
- **Ctrl+S saves the project in the browser** at once. It used to download every scene as a file. The three
  files are under File (*… to a file*) and the toolbar's Save menu.
- **Opening a workspace file makes it a project of its own** in the list, and opens it. It used to replace
  everything open. A scene or project file still joins the project.
- **Ctrl+C / Ctrl+V go through the system clipboard**, so a copied object also pastes in another tab, another
  project, or after a reload.

**To look at:**
1. The Scene panel: the switcher over the tree, with the scene's name, its + and ⚙, and the project's name. The
   tree starts at Environment. Try the + (Shapes ▸ Primitives ▸ sphere) and the ⚙ (Properties shows the scene).
   Open the list: switch scenes, + New scene, rename (✎), up and down, delete and Ctrl+Z, Examples ▸. Say if the
   list reads well, and if the buttons that show on hover are findable.
2. Reload the page (F5) after some edits and a camera move: the same scene, contents and view should come back.
   Then the same with a library item open for editing: it should come back open, strip and all.
3. Open the page in a second tab: the switcher should say "not saved yet"; edit something there, then look at
   File › Projects… in either tab: a "(copy)" project, and the first tab's project unchanged.
4. File › Projects…: open, new, rename, duplicate, download, delete.
5. Right-click an object: Copy to and Move to another scene; then switch to it and see it there.
6. Ctrl+C on an object, Ctrl+V in another tab's tree.
7. **The first visit** (a fresh browser profile, or after clearing the site's data): Builder demo alone. Say if
   another scene should be the first one.
8. An example opens from the camera the view has, as any scene shown for the first time always has. Say if
   examples should come with a camera of their own.

## 0.6.0 — 2026-10-02

**Added**
- **Lock position and lock parameters**, per object, so a slip of the hand in edit mode cannot move or
  resize it. The user: "objects could use a 'lock position' and 'lock parameters' option that prevents
  accidental changing position/rotation or object size, scale when in edit mode".
  - **Lock position** holds the position and rotation. **Lock parameters** holds the values of the
    parameters (a box's size, a cylinder's radius, a path's or a profile's points) and the scale.
  - A group, a light and an export box can be locked too. A group's lock is its own: what is inside it
    can still be moved.
  - **In the properties panel**: two checkboxes, *lock position* and *lock parameters*, just above the
    position. The rows they hold are greyed out and cannot be changed; a vector's **+** sliders are gone
    while locked. The parameters' ✎, × and +, and the code, stay editable.
  - **In the picture**: a locked position has no arrows, squares, centre ring or arcs; locked parameters
    have no stretch cubes and no scale circle, and the **Points** button stays but is disabled (its
    tooltip says why). A press where a hidden handle would be is the camera's. A small padlock follows
    the name, and the numbers panel at the top right says what is locked.
  - **In the tree**: a lock beside the eye on every object and group. A click on an open lock locks both,
    a click on any lock opens both; a node with only one locked shows a dimmer lock.
  - Saved with the scene, and kept by a copy, a paste and a library item. A lock is never in the shader:
    locking compiles nothing. Each toggle is one undo step.
  - **Not locked**: the timeline, a script, the command palette and the Parameters panel still change a
    locked node (they are deliberate, and a timeline should not stop at a lock), and so does an undo. A
    light's own settings (luminance, colour, beam) and a group's blend are not parameters, so they stay
    editable. Dragging a locked node into another group in the tree keeps its own numbers, but it then
    sits where its new group puts it.
  - The scene file's version is unchanged: the locks are two optional fields, and a build that does not
    know them loses only the lock.

**To look at:**
1. Select a box, tick *lock position*: the arrows, squares, centre ring and arcs vanish, the cubes and the
   dashed circle stay, a padlock appears after the name, and position and rotation are greyed out in the
   panel. Try dragging where an arrow was: the camera turns, the box stays.
2. Tick *lock parameters* as well: no handles at all. On a bent tube or an extrusion, the Points button
   is greyed out.
3. The lock in the tree, beside the eye: click it on an object and check both boxes in the panel tick;
   click again and both clear. Say whether the extra column makes the tree too wide.
4. Say whether a group's lock should also hold what is inside it. It does not now.

## 0.5.0 — 2026-10-02

**Added**
- **Each chart's settings are on the chart**, in a strip along its top (`lib/pathtracer/strip.js`), no longer
  in the Analysis pane. The user: "put the controls for the chart (what it shows) into the chart itself".
  - The strip follows its rules from 2026-09-27: a value is said once, by its control; two or three choices
    are a row of short words (lin / log, steps / % / off, peak / centroid / pressed); longer lists are a
    dropdown; every control has a tooltip.
  - Controls that only apply sometimes appear when they do: log's decades, the true colour's brightness,
    Δu′v′'s target and its CCT and Duv or x and y, and ‹ (back to the whole detector) while zoomed.
  - The saves, ⧉ and ✕ are at the strip's right end.
  - The Analysis pane keeps the run bar, the data the charts are made from, and the results. Its Chart
    section, and with it the selected chart and its accent edge, are gone.
- **More than one chart of a kind**, each with its own settings (`optics/charts.js`). The user: the map's
  "shows" was one setting for every map, and they wanted to "compare 2D map of intensity and 2D map of CCT".
  - A chart's **⧉** makes another like it, opened to its right, with its settings copied. Change the one
    thing to compare.
  - An added chart is "Map 2", "Polar 2" and so on, listed in View like any panel. Its **✕** removes it.
    The first chart of each kind stays (the Analyse layout opens those six); it can only be closed.
  - The charts and every chart's settings are **kept between visits**, as the layout is. Before this, a
    chart's settings went back to the defaults on reload.
- **The profiles and the rings have their own "shows"**. They used to follow the map's. They start on the
  illuminance; *True colour* and *Colour only* are the map's alone.

**Changed**
- **The Optics menu's charts are its "New chart: …" entries only** (the six "… chart" entries are gone). Each
  opens the first chart of its kind when that is closed, and makes another when it is open.
- **On a map, a plain drag no longer zooms.** Press and hold: the point the profiles, rings and encircled
  flux are taken about goes there and follows the pointer, and the readout shows the value under it.
  **Shift-drag zooms**; double-click still goes back to the whole detector.
- What the maps are made of (the detector, area, cells, smoothing) is still one set, in the Analysis pane's
  Map folder, and so are a zoom and the point. Every map zooms together and marks the same point.

**Fixed**
- `strip.js`'s `show()` gave a control shown again `display: ''`, which stacked a segmented choice's words
  in a column. Nothing had shown one again until the map's target did. It now puts back the control's own
  display.

**To look at:**
1. Analyse layout, ▶ Run on a scene with colour (RGBW_mixer). Every chart has its strip at the top, and the
   Analysis pane has no Chart section. Say whether the strips read well at your panel widths; in a narrow
   panel they wrap onto two or three lines.
2. On the map's strip, ⧉: a **Map 2** should open to the right of the map, with the same settings. Set its
   dropdown to CCT. Point at either map: the other should mark the same place with a small circle, and each
   map's readout should give its own quantity there (lux in one, K in the other).
3. Set Map 2 to *Δu′v′ from target*: own / CCT / xy appear. Choose CCT; K and Duv fields appear. Type a CCT and
   press Enter: the map and the Δu′v′ card change.
4. Hold the left button on a map and move: the dashed cross and the **profiles should follow** the pointer
   with no zoom rectangle, and the Profiles, Rings and Encircled flux strips should say *pressed*. Say whether
   it keeps up at 256 cells; that has not been measured.
5. **Shift-drag** on a map: the rectangle, then the zoom on both maps, and ‹ in the maps' strips. Double-click
   or ‹ to go back.
6. Optics menu: only "New chart: …" entries. Close the Polar chart, then *New chart: Polar*: it should come
   back. Again: a Polar 2.
7. Reload the page: Map 2 should come back where it was, still showing CCT. Then ✕ it.

## 0.4.0 — 2026-10-02

**Added**
- **The Optics view**, a fifth Quality preset (Renderer panel › Quality › *Optics (light rays, flat
  light)*), for looking at what the optics do to the lights' light:
  - every surface is shaded by Sketch's flat light, which follows the scene's environment;
  - the rays from the builder's lights are traced through lenses, mirrors, glossy and rough-metal
    reflectors and frosted glass, show where they land, and **stop at the first diffuse surface**: no
    diffuse bounces, so no glow of bounce light around a beam;
  - **Flat light** (a row under Quality, in this view only) dims the flat shading in stops, so a beam
    weaker than the daylight still shows. It starts at -4 (a sixteenth of Sketch's), 0 is Sketch's own,
    and at -12 it is off and only the lights' light remains;
  - **Photons per Pixel** sets how many rays the lights send. It now shows whenever the lights' rays run
    (it used to hide when the sun's caustics were switched off, though it still set the lights' count);
  - not traced in this view: the sun's caustics, and light from glowing *materials* (they only glow);
    the measuring views still trace in full.
- **Bench rows**: `optics-mode` (the view against the lux arithmetic, and full against it), and two
  more pairs in `light-vs-emitter`. Both pressed on the user's Ampere card the same day: the Optics
  view's floor reads 0.994-0.999 of the closed form, full 1.02-1.14 (the light it bounces back),
  and the Draft and Optics pairs 0.995, as the full pair.

**Fixed**
- **Draft could show a light's direct light too dark on a diffuse surface**, most for a large panel
  light. Found by reading the code: the light's rays kept only their share of it for a camera path
  that, in Draft, never goes on to the light. No fast mode shares that light now. Since the fix, Draft
  reads within 0.02% of full on the bench's open floor; how dark it was before was not measured.

**To look at:**
1. A scene with a light behind a lens or in a reflector (Optics_test_3 LED, RGBW_mixer), Quality ›
   Optics: the shapes flat-lit as in Sketch, and the light's spot or beam on the surfaces it reaches,
   sharp-edged, with no bounce glow round it. The HUD's first line says OPTICS.
2. Move Flat light: towards 0 the shading gets brighter against the beam, as in Sketch; at -12 only
   the light's spots and its own face should remain. Say whether -4 is a good place for it to start.
3. A light's spot seen in a mirror or through a lens is **not** shown in this view (as in Draft). Say if
   that is something you want.
4. Draft on a scene with a large panel light: its light on the floor near it should now match
   Standard's direct light. It may have been darker before.
5. ~~Press `optics-mode` and `light-vs-emitter`~~: done, both hold (above).

## 0.3.0 — 2026-10-02

The branch after PR #38: the view's controls grouped, one Transform gizmo, and the selection's numbers in a
panel. All three were confirmed working on the user's hardware the same day. Then the Points mode on the same
gizmo, every point's legs, Ctrl to the grid in Transform, and more shapes that stretch, not yet seen.

**Added**
- **The Analyse drawer**, bottom right of the view (`lib/pathtracer/viewtools.js`). One button opens captioned
  groups:
  - **Display**: the three views and the false-colour range;
  - **Measure**: the measure tool, its clear and save greyed while there is nothing to clear or save;
  - **Rays**: the optics rays.
  Closed, its button shows a badge for whatever is still on. On the top-left strip, switches sit in outlined
  pills and menus carry a caret (`icons.js` `iconPill`, `menuButton`).
- **One Transform gizmo** in place of Move and Scale (`builder/overlay.js`):
  - the arrows, squares, centre ring and quarter arcs, as before;
  - a **cube on each of the shape's own axes** that stretches it by its own sizes, as its preset names them
    (`primitives.js` `stretch`, `builder/stretch.js`): a box's `size.x`, a cylinder's radius or height. It is
    live, held in the slider's range, and never goes through zero;
  - a dashed circle outside the arrows for uniform scale;
  - larger handles.
- **The selection's numbers** in a semi-transparent panel at the view's top right (`builder/readout.js`):
  - position, rotation, scale, the lengths as written and the measured bounds;
  - while a handle is held, what it did and the numbers it changed, in bold.
  The Points mode's numbers and its typed entry moved there from beside the point. The panel lets the mouse
  through.
- **The Points mode on the Transform gizmo** (`builder/gizmodraw.js`, one module for both; every part a switch). At
  the selected point:
  - its arrows, as before but Transform's length;
  - a **square** per pair of coordinates, which moves two and keeps the third exactly;
  - the centre ring;
  - the arcs, cubes and circle hidden until points turn and scale.
- **Every point's legs**: a switch on the view's toolbar, beside the bounding boxes', shown in Points mode. It draws
  every point's dotted steps from the one before, and the selected point's are twice as thick. Off by default,
  remembered.
- **More shapes stretch**:
  - rectangle lights (width, height) and disc lights (radius);
  - the export box (size);
  - the torus and capped torus (ring, in x and y);
  - the link (span, in y).
  The panel shows what a cube changes even when it is not marked a length.

**Changed**
- The view's first drawer group is called **Display** ("Shows" at first).
- **Ctrl in Transform** snaps a move to the grid at the node, the Points mode's (about 24 px apart on screen), not
  a fixed 0.1; a size to the same grid in the node's own units. The panel says the step.

**Removed**
- The **fast drag** switch, with the half resolution and the tenth of the photons while a handle was held. A drag
  renders at full quality; ⚡ is the way to a lighter picture.
- `pointedit.js` `placeBox`, which put the Points readout beside its point. Nothing uses it now.

**To look at:** the drawer, Transform and the panel are confirmed. New:
- **Points mode, on the bent tube:**
  - point 2's squares: drag the blue one, and z stays;
  - the legs switch at the top: every step is dotted and point 2's is thicker. Is it readable, or too busy?
- **Transform, with Ctrl:**
  - drag an arrow close up and far away: the step changes, and the panel says it.
- **New stretches:**
  - a rectangle light's two cubes: its luminance or flux follows, as set;
  - an export box's three cubes;
  - a torus wider in x and y;
  - a link longer in y.

## 0.2.0 — 2026-10-02

**Added**
- **A fifth ray colouring, "light colour × flux"** (Rays popover › colour by). Each ray is drawn in its
  light's colour, as "light colour" draws it, at a brightness proportional to the flux the ray still
  carries along that leg. The scale is linear, so where rays overlap the brightness adds up to the
  flux through there.
  - "Light colour" stays as it was: every ray at full strength, whatever it has lost.
  - The colour is the one the ray carries: its light's, times any coloured glass it has passed.
  - What dims a ray is absorption (a diffuse or metal surface's colour, tinted glass). Clear glass
    does not, because reflection or refraction is picked at random rather than split. Every ray leaves
    its light at the same strength, so a brighter light shows as more rays, not brighter ones; rays
    from a Zemax ray file start at the file's own weights.

**To look at:** show the rays over a scene with a light, a white or grey diffuse surface and a clear
lens, and switch colour by between "light colour" and "light colour × flux". In the new mode the rays
should be in the light's colour, just as bright as "light colour" up to the first diffuse or coloured
surface, and dimmer after it (a grey of 50% halves them). Through the clear lens they should not dim.
With a tinted glass, the rays after it should change colour and dim. The brightness slider should
scale both modes alike.

## 0.1.1 — 2026-10-02

**Fixed**
- **A light's rays started off its face.** A rectangle or disc light's rays were moved 20 march
  tolerances in front of the face before they were traced (`optics/kernels.js` `SOURCE_RAY`). That is
  the distance a bounce steps off a surface. In RGBW_mixer it came to 0.21 mm, off 1 mm dies whose
  lightguide begins 0.20 mm in front of them. So every ray began just inside the guide, and was drawn
  from there.
  - They now start 2 tolerances off. That is enough, because a ray leaving a flat face only gets
    farther from it.
  - They are drawn from the point on the face.
  - Bounces still step off by the full offset (`roadmap/PLAN.md`, *Thin air gaps*).

**To look at:** RGBW_mixer with the rays drawn, zoomed onto the four dies and the lightguide's entrance.
The rays should leave the LED faces, cross the 0.2 mm gap and bend at the guide's face. Before, they
started at the guide's face. In a metre scene a light's photons now start about 18 mm closer to its
face, so `light-vs-emitter` may move a little; its error bars are about as wide as that.

## 0.1.0 — 2026-10-02

The first numbered version: `main` as of PR #38 (the Points mode, live chains in slots), plus PR #39.
What was built before this point is inventoried in `FEATURES.md` with the evidence for each line; git
history has the rest.

**Added**
- **A version and its revision**, shown in the window title, Help › About, the first line of
  Help › Report, and the head of every test and benchmark result (`version.js`; the renderer's
  `installUI` takes a `build` line).
  - The revision is the commit the server's checkout is on, read from `.git` at start-up. Wherever
    `.git` is not served, only the version shows.
- **Saved files record which version wrote them**, as `app`, for example `"app": "0.1.0+1819ac6"`,
  right after their format `version`. This covers a scene, the project, the workspace and an
  exported library. Reading a file drops it, so it never enters a document, the undo history or a
  thumbnail's key.
- `roadmap/IMPORT.md`: what CAD and mesh import would take, format by format, and what optics needs.
  This is an investigation; nothing is built.

**Changed**
- The documents are reorganised: the plans are in `roadmap/` (`PLAN.md` first), the reference in
  `docs/`, and `README.md` beside this file says which is which.
  - Obsolete files are deleted, and the rest are trimmed to what is open, what is unproven, the
    decisions with their reasons, and every measurement.

**Fixed**
- Comments in `raytrace_main.js` and the renderer's `index.js` gave the old ray sizes: a Ray of 96 B,
  a Hit of 128 B, ~3.35 M rays. They are 112 B and 144 B, which gives ~2.92 M rays in the 1 GiB
  budget.

**To look at:** served from the checkout as the README says, the title bar should read
"Raytracer 0.1.0 · " followed by the commit's short hash and branch. The same line should head
Help › About, the report Help › Report copies, and any test's popup. File › Save the current scene, open
the file in a text editor, and look for `"app": "0.1.0+…"` after `"version"`. Open the file again: it
loads as before.
