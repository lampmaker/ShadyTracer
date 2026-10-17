# The application's UI: what was decided, why, and what is open

The first UI (2026-09-27) was one long tweakpane menu, which suits an agent and not a person, and its
Picture / Intensity / Illuminance buttons over the canvas said the wrong thing about how the program is
split (the user's verdict). This file keeps what the user decided instead, with the reasons, and what is
still open (section 7, *Open*; section 9; *Open decisions* at the end). What is built is FEATURES.md's;
the build log this file carried was removed 2026-10-02 (git history has it).

## 1. What the program is for: the design loop

The first target is LED and luminaire optics (PLAN.md, Optics module). The work goes round one loop,
many times:

```
  MODEL ──────► LOOK ─────────► MEASURE ────────► ANALYSE ──────► DECIDE
  geometry,     the picture,    where light is     the numbers:     change a parameter,
  materials,    rays over it,   counted: detectors, E, U0, beam,    keep or undo; the
  lights        a few thousand  the far field, a    efficiency --    next run is compared
     ▲          traced live     plane h away        with errors      with this one
     └──────────────────────────────────────────────────────────────────┘
                                   and at the end: REPORT (IES / LDT / CSV / pictures)
```

What each step needs on screen:

| step | needs to see | needs to touch |
|---|---|---|
| model | the 3D view, the scene tree, the selected thing's properties | handles in the view; numbers in the properties |
| look | the 3D view with rays over it, big | rays, steps, live, colour-by |
| measure | which surfaces are detectors, the far field's frame | a material's role; what feeds the far field |
| analyse | a map, a polar diagram, profiles, and the few numbers that matter, each ± its error | ray count; run |
| decide | **the parameter and the number it moves, side by side**, and the last runs to compare with | the parameter; pin a run as reference; undo |

The last row is the one the first UI could not do at all. The worked case the user named:
**optimise uniformity across a detector by changing an element's properties.** To do that by hand
a person needs, visible at once and without switching anything:
1. the property being changed (a lens's back radius), as a slider or a number;
2. the detector's map, so the shape of the change is seen, not only its score;
3. the score (U0 on that detector, ± its error) and the ones it trades against (efficiency, E mean);
4. the previous runs, as a table and ideally as the score against the parameter;
5. the 3D view, small, to see the rays still go where they should.

When this was written, (1) was in the Builder page and (2) and (3) in a tab that covered the picture and
(5); (4) did not exist. So the layout question was: **can the thing being changed and the thing being
measured be on screen together?** The docked panels (section 6) answer it; (4) is still open (section 7).

The step after doing it by hand is letting the program do it: pick parameters and ranges, pick a
score and a goal, and let it SWEEP (a chart of score against parameter) or OPTIMISE (a search). Both
are the same loop with the hand taken off. A UI that shows the manual loop well is most of the way to
showing the automatic one: a runs table becomes a sweep's table, and "the score against the
parameter" becomes its chart.

## 2. What the split between modules means for the UI

`lib/pathtracer` stays a component other hosts embed (its README: being usable by a program that does
not exist yet "is the entire point of it"). Three consequences, built in this shape
(`lib/pathtracer/viewtools.js`; `lib/shell/README.md`: the shell knows nothing about renderers, optics or
scenes). Section 8 then settled where each control goes: the view has no overflow menu, and Tests is a
renderer panel opened from Render (`index.html:171`, `:734`).

- **The renderer ships a VIEW, and the view carries its own controls.** Camera, exposure, sampling,
  display mode (picture / illuminance / luminance), the measure tool and the HUD belong to the 3D view,
  wherever the host puts it: in the view's own toolbar and overflow menu, not in the application's
  menus. Any host that embeds the renderer gets the same view with the same controls. The renderer's
  Tests are a developer tool and stay in the renderer too, reachable from the view's menu.
- **Optics is a second module with its own panels**, not a feature of the view: the trace settings,
  the analysis, the results, the charts. It *uses* the view (rays drawn over it) but does not live in
  it. `lib/pathtracer/optics` already has this shape; the charts (`polar.js`, `cartesian.js`,
  `heatmap.js`, `xychart.js`) are plain canvases any layout can place.
- **The application owns the arrangement**: the menu bar, the docking or the modes, the Builder, the
  project, and the study (parameters, scores, runs). It is the one place that knows the Builder's
  objects and the optics' results are the same scene.

## 3–5. (removed 2026-10-02)

The first round: the charts' own controls, four layouts (A to D) drawn as mockups, and the questions
between them. Section 6 records what the user decided; what was still open is in section 7's *Open*
list. Git history has the text.

## 6. Decided (the user, 2026-09-27, second round)

- **A's docking**, with windows that can be moved, docked, floated and closed. **Presets**, such as
  Design, which shows only the view and the tree, bring back B's simplicity. A preset is a layout;
  the user can change it and save it as their own.
- **A real menu bar.**
- **Multiple monitors.**
- **An object and material library**: built in and user-defined, and one that can grow past what a
  dropdown can hold.
- **Modular.** Adding a feature, such as CCT or CIE x,y in place of flux on a chart, should be a
  small change in one place.
- **Help** (tooltips, pointers, a manual): it is to be released, open source or paid.
- **The study (C) is occasional.** It starts manual, but **every parameter must be readable and
  settable** so that an optimiser can be added later. The same holds for **the timeline**
  (`lib/timeline`), which is coming soon.

Of the four layouts drawn -- A a workbench (VS Code, KiCad), B fixed workspaces (Blender), C a study
column, D a canvas with floating panels (Figma) -- **A's docking** is the user's choice. As the first
round weighed them, A puts the property being changed, the detector's map, the runs and the view side by
side and keeps that layout, where B's layouts cannot be changed, C makes the picture a side show and
D's floating panels cover the view. B lives on as presets, C as a panel (it is occasional), and D gave
the command palette.

### Menu bar or not: what new applications do

**Professional desktop tools keep a menu bar** with a command palette on top (VS Code, Blender, KiCad,
FreeCAD, Fusion 360, DaVinci Resolve): the menu bar is how a new user finds what exists and learns each
command's shortcut, the palette how an experienced one skips the menus. **Web-first design tools dropped
it** (Figma, Linear, Notion): a few dozen commands, and designers who learn them once. **This program has
150 or more settings and commands** (the first round counted about 90 renderer and 45 optics controls,
besides the Builder, the measure tool and the charts) and users meeting it for the first time: so a real
menu bar, a command palette (Ctrl K, which also finds parameters), right-click menus on things, and the
toolbars on each panel.

## 7. The architecture that makes it modular

The rule: **everything the user can reach is an entry in a registry**. The menus, the command
palette, the presets, the tooltips and the manual are generated from the registries, never written
by hand. A new feature is new entries, not a change to the shell.

| registry | an entry is | used by |
|---|---|---|
| **panels** | id, title, module (renderer / optics / builder / app), help, create(el) | the dock, View menu, presets, palette |
| **commands** | id, label, menu, shortcut, `when` (enabled if), run, help | menus, palette, shortcuts, toolbars |
| **parameters** | a path (`scene/<node id>/<parameter>`: ids, never labels), label, unit, min, max, step or options, get, set, help | properties panel, timeline, optimiser, palette, scripts, undo |
| **quantities** | id (E, I, CCT, x, y, Δu'v'), label, unit, which charts, how to compute it from a tally | every chart's quantity switch |
| **library** | kind (object / light / material), category, name, source (built in / mine / project), tags, preview, the model JSON it inserts | the Library panel, the Add menu's recently used |
| **presets** | name, help, the panels and where they go (or a saved layout) | the layout switcher |

Where each lives: panels and commands `lib/shell/registry.js`; parameters `lib/shell/params.js`, fed by
`lib/pathtracer/params.js` and `builder/params.js`; quantities `lib/pathtracer/optics/quantities.js`
(detector maps only -- the far-field charts have no quantity switch); the library `library/store.js`;
presets `lib/shell/shell.js` (`layout.preset`).

**Parameters are the timeline's registry.** `lib/shell/params.js` takes `lib/timeline/registry.js`'s
contract as it is (`{ id, label, group, get, set, min, max, step, options, dims }`), with a path as the
id and a unit, help and a kind (live: a uniform; structural: a compile) added. The timeline, the palette,
a console script and a future optimiser drive the same entries, and undo follows from set.

**Quantities need their data.** A detector's hits carry X and Z beside Y, so CCT, x and y on a map are
arithmetic on data that exists, and a colour chart's value axis starts where its values do (`yMin:
'auto'`, `lib/pathtracer/optics/xychart.js:13`). Colour against angle needs more tallies (*Open*).

**The library** holds items as the model's own JSON, a node or a material, so inserting one is the
same as pasting. Built-in items ship as files in the repository; the user's live in IndexedDB, as ray
files do; a library is exported and imported as a file, for sharing between people or machines.

**Help comes with the entry.** Every registry entry carries its help text, so tooltips come from it,
the Help panel (F1) shows it for whatever is under the pointer, and the manual's reference pages can be
generated from the registries and cannot drift from the program. The tour is a list of steps pointing at
real parts of the program. Only the tooltips are built (*Open*).

**Docking: dockview** (vendored in `lib/dockview`, 8.3.1, as tweakpane is). MIT licence, no
dependencies, plain JavaScript without a framework; its free package has docking by drag, floating
groups, **pop-out windows** (multiple monitors), maximising, and a layout saved and restored as JSON (the
presets and the user's own). What it keeps for a paid package (auto-hiding edge panels, pinned and
multi-row tabs, keyboard docking, layout history, smart guides) this program does not need. Writing our
own is possible (`lib/guistuff/splitpane` is a start) but pop-out windows and drag-docking are most of
the work, and done.

**A risk to test first: the renderer's view in a pop-out window.** A WebGPU canvas belongs to the page
that made it; moving it into another window may lose its context, or need it configured again. The
charts are 2D canvases and move fine. A one-page test on a real GPU settles it: move the renderer's
canvas into a popped-out window, keep rendering, move it back. If it cannot move, the view stays in the
main window and everything else can still go to a second monitor.

**The renderer stays a component.** Its view and its settings are two panels it registers itself.
A host that embeds it (weavesim, a second tool) gets those panels, not this shell.

### Rules the user set (and one the timeline needs)

**Less is more** (the user, on the first version): paths are for scripts, the timeline and the
optimiser, not for reading. The first version showed one under every name in the Parameters panel,
as the palette's hint and as a tooltip on every Properties row. None of those show it now; a
right-click on a Parameters row copies it. A row's range and "recompiles" are its tooltip.

**Minimal, and nothing said twice** (the user, 2026-09-27, on the view toolbar: "Shows:
Photographic ▾" opened a dropdown saying photographic again). The rules now:
- **icons with tooltips, not words**, on everything over the picture or at the head of a panel
  (`lib/pathtracer/icons.js`): the view toolbar, the measure tool, the Builder's toolbar;
- **a value goes in the tooltip** (the EV, the false-colour range), not on the button;
- **a choice of three is three toggles**, not a button that opens a list: photographic, lux on
  surfaces, luminance, the lit one is the view. The mode is in no popover;
- **a control shown only where it does something**: the exposure icon in the photographic view, the
  range icon in the others;
- **no title that repeats its container**: a panel or popover holding one folder shows it flat
  (Environment, Tests, Save picture, the three popovers); a label never repeats its group's name
  ("Source", not "Environment" in Environment); Properties is headed by the kind, not "Object — n3";
- **tabs carry a dot** in their module's colour, not a word; the group buttons (float, pop out,
  maximise) show while the pointer is over the tab strip;
- the Builder's status line is gone: it repeated the status bar word for word.

**The look** is the mockups' (the user preferred it): the slate palette as tokens in
`lib/shell/shell.css`, dockview and every property table themed from them. **The workbench mockup's
type and one background** (the user: lighter, and the tree's background was not the panels'): the
property tables are the system face at 13px, regular weight, section titles in small muted capitals,
numbers in monospace (shell.css, through Tweakpane's classes); the tree takes the same (TreeView has a
`styles` option now) and the panel's background instead of a grey of its own.

**The timeline moves live parameters only** (the design, 2026-09-29, `tools/timeline.js`): a
structural one is a compile per frame, and during a recording a compile would swap kernels under the
offscreen target; the + track list leaves them out and a track naming one is skipped.

### Open

Built of the steps planned 2026-09-27: the shell, presets and saved layouts, the parameter registry,
the charts' settings (on each chart's own strip since 2026-10-02) with the quantity registry, the library, the
timeline. Still to do:

1. **The pop-out test** above (a day; it decides one thing). Until a second monitor, the viewport
   refuses to pop out (`popout: false`, `index.html:142`); every other panel can.
2. **Help past the tooltips**: the Help panel (F1), the tour, the manual. Tooltips come from each
   entry's `help` (`lib/shell/shell.js:169`, `:374`; `lib/shell/paramspanel.js:62`); the Help menu has
   Arranging the panels, Report, Reload fresh, About, Find a command (`index.html:744-757`).
3. **Runs and a pinned reference**: every analysis kept with its parameters, and a previous run drawn
   dashed under every chart that has it -- the loop's "compare", in the chart. The Analysis pane keeps
   one result (`ANA`, `optics/page.js:139`).
4. **Direct axis zoom**: drag an axis, double-click to reset, wheel about the pointer. No chart handles
   a wheel or an axis drag; the map zooms by a Shift-dragged rectangle (`optics/page.js:811-851`, since
   2026-10-02: a plain drag moves the profiles' point instead).
5. **A score list**: the numbers that matter, each ± its error, readable by the whole application (the
   study); today they are the Analysis pane's cards.
6. **Colour against angle**: the far field tallies flux alone (`optFarAdd`,
   `lib/pathtracer/optics/kernels.js:223-238`); CCT, x and y over angle need X and Z per bin.
7. **Stop and More** on the run bar, and the trace's other open items (section 9).
8. **"Recently used"** from the library, and Shift A: not in the code (`builder/tree.js:81` is the
   menu's "From the library…").
9. **The study, then the optimiser**: parameters, scores, runs, a sweep, a search, all on the parameter
   registry; a panel, being occasional (section 6).

A decision about lights waits on the user (*Open decisions*, at the end).

## 8. Every control lives with the thing it changes

The user's catch on mockup E (2026-09-27): its viewport still had three buttons, Picture /
Illuminance / Luminance. They were not the old chart tabs but the renderer's display mode (the
View page's "Show"). Still, they showed two problems, and both the old UI and the first E had them.

**The same word for two measurements.**
- *Lux on surfaces*, the renderer's mode (`measureMode` 1), traces the picture again with every
  visible surface white for one bounce. It shows the lux falling everywhere in view: walls, floor,
  anything.
- *The detector map*, the optics trace, is the flux that reached one chosen surface. It has a
  standard error, isolux lines and profiles.

Both were called "Illuminance". They answer different questions, and a user comparing their
numbers would not know which to trust. So each is named for what it is: the view "shows: lux on
surfaces", and the optics panel is the **Detector map**. The view says where the other one is (the
mode's tooltip: `lib/pathtracer/viewtools.js:52-53`, `tips`).

**Controls in the wrong place.** The first E's viewport toolbar also carried the sun and sky (☼)
and sampling (∷). Neither belongs to a view. The rule that sorts them:

| a control changes… | so it lives… | what that is |
|---|---|---|
| **this view** | in the view's toolbar, per viewport | the camera, what it shows (photographic / lux on surfaces / luminance), exposure and tone curve, or the false-colour range and bands; the overlays (rays, handles, measure pins); split, pop out, save image |
| **the scene** | in the tree and Properties, saved with the scene | objects, lights, materials, **the Environment** (sun, sky, studio: it was the renderer's Light page, but a room scene should keep its sun); **the surface tolerance** (0.66.0: a Ray marching row before, one for every scene) |

**The camera and the exposure: the view's controls, the scene's values** (the user, 2026-10-17: "Now these are shown
over the viewport, where they belong, but the information should belong to the scenes. Because switching between
scenes almost always causes the camera and exposure to be wrong"). Since 0.66.0 the controls stay the view's -- its
toolbar's camera and exposure popovers -- and the values are each scene's, saved in its document (`builder/model.js`
VIEW), shown again too in the scene row's Properties as two folders, where they are flagged animated. Moving the
camera is still no undo step. A second viewport would need a camera of its own: the scene's is the main view's.
| **the renderer's effort** | the Renderer panel | in boxes since 2026-10-04 (below): quality, light sources, paths and noise, render size; a developer's march and diagnostics |
| **the optics trace's data** | Optics setup | sources, where light is counted, far field from / axis / grid, ray counts, limits |
| **how a chart shows its data** | the chart's own strip | the quantity (flux, CCT, x, y), planes, scale, range, reference, export |
| **a file or the program** | the menu bar | open, save, export, layouts, help |

For the optics charts the last but one row was overtaken by mockup F, the user's choice (section 9):
each chart a dock panel drawn edge to edge, and the selected chart's settings in the Analysis pane beside
the data it is made from. It came back on 2026-10-02, once there could be two maps side by side (the user:
"put the controls for the chart (what it shows) into the chart itself. Not in the analysis pane"): each
chart's settings are its own strip (`lib/pathtracer/strip.js`), and the pane keeps the data and the results.

Two consequences:
- **What a view shows is per viewport.** A photographic view and a lux view can sit side by side.
  But the lux view is a second render (the first bounce is traced differently), so two views
  showing different things cost two renders. The renderer does one today; a second viewport means
  a second picture state, and possibly one shared trace with two display passes when only
  exposure differs.
- **The renderer's old pages split up.** View goes to the view's toolbar. Light goes to the scene
  (Environment). Sampling and Advanced go to the Renderer panel. Output becomes File → Save
  picture. Tests stays a panel. The renderer still owns all of it: its view registers the toolbar,
  its Environment is a scene node kind it defines. A host that embeds it gets the same parts.

### The view's controls, grouped (decided 2026-10-02; confirmed: "it works")

The user: the viewport's controls (top left, bottom left, bottom right) "need to be grouped better"; the rays and
their settings and the luminance controls "should belong together", with the photo / lux / luminance toggles,
"maybe hidden behind a master toggle"; and the top bar should make clear "what are toggles that belong together and
what is a menu item". Three ways were proposed -- **A** a drawer behind one button, **B** an analysis mode on/off,
**C** one panel of labelled rows -- and the user chose **A**:

- **Top left, the picture** (`viewtools.js`): camera ▾ and exposure ▾ are **menus** -- an icon and a caret, no
  outline -- and ⚡ the fast preview a **switch** in an outlined pill of its own; the host's switches follow in pills
  of theirs (the bounding boxes; the Points mode's while it is on). `icons.js` `iconPill`, `menuButton`.
- **Bottom right, Analyse**: one button opening a drawer of captioned groups -- **Display** (the three views as one
  pill and the false-colour range ▾; "Shows" at first, renamed by the user), **Measure** (pin, area, clear and save,
  greyed while there is nothing to clear or save), **Rays** (the optics rays' switch and settings ▾). Closing it only
  hides the buttons: what is on stays on, and the drawer's button shows a badge for each. Remembered.
- **Top right, the selection's numbers** (`builder/readout.js`, 2026-10-02): position, rotation, scale, lengths and
  bounds, or the Points mode's point and its typed entry -- one semi-transparent panel that lets the mouse through,
  below the library's strip while an item is edited.
- **Bottom left, editing**: Edit, then Transform / Points as one pill (Move and Scale became one gizmo, 2026-10-02),
  `local` a pill of its own, the Points mode's controls after them. The **fast drag** switch is gone, and with it
  the half resolution and the tenth of the photons while a handle is held: ⚡ is the way to a lighter picture.

### The Renderer panel in boxes (built 2026-10-04, not yet seen by the user)

The user: "group the render settings a bit better ... groups with boxed outlines, like the analysis settings ...
lightsources should have their own box - enable/disable tracing of these and the relevant settings ... main goal is
to make it easier to switch between quick preview mode and accurate render mode; now it's just too hard to find (and
understand) the right settings." It was one Tracing folder: the presets in a dropdown, then twenty rows in the
schema's order (the march's tolerance beside the bounces, the photon shares beside the firefly clamp), switches as
sliders from 0 to 1. Now (`lib/pathtracer/settingsui.js` `RENDERER_BOXES`), each box outlined as the Analysis pane's:
- **Quality**: the presets as buttons in two pills, **Preview** (Sketch, Draft) and **Accurate** (Standard, High),
  and Optics apart; under them a line saying what the one in force traces, or what Custom changed against the
  nearest preset ("Max Bounces 12 (Standard: 10)"), and when a false-colour view overrides it.
- **Light sources**: a checkbox per kind of light and whether it is traced -- *Sun, sky or studio* (lamps only,
  the other way round), *Caustics (sun, glowing surfaces)* (`lt`, once "Light Tracing (caustics)"), *Lights' rays*
  (`lightRays`, new: the light objects' photons, which `lt` never turned off) -- and their photons per pixel. For a
  developer, three folders: light sampling (NEE and its shares), the photon map, the glowing surfaces' search.
- **Paths and noise**: bounces, the firefly clamp; for a developer roulette and the averaging windows.
- **Render size**; and a developer's **Ray marching** (tolerance, iterations, step, normals, culling) and
  **Diagnostics** (the uniform environment; TRACE2 was here until 0.22.2 removed it).
- **The Developer switch** at the foot of Quality, on one line with a count of what it hides that has moved and
  Reset (the user, the same day: "put the developer settings toggle & reset at the top, in the quality box ... on a
  single line"), where it had been a box of its own at the bottom.

The boxes are a list of their own, not the schema's groups: a group is its settings' parameter path, an id a
timeline track or a file keeps.

## 9. The optics use path (proposed 2026-09-27, for the user to decide)

The user's reading of the Optics panel once the charts had their own controls: the Rays folder is a
VIEW and belongs on the picture; it is not clear that the charts need a trace, nor which settings need
one; the Illuminance map does not show the whole detector. The panel mixes three different things --
looking at rays, running the trace, and analysing its results -- and the charts do not say where their
data came from.

### The path

Build, look, trace, analyse, change and compare. Settled 2026-09-27 with mockup F, which the user chose
("multiple charts in a single pane is not optimal"), and built as `optics/page.js:1-35` describes:
**rays are a view**, live, from the viewport's rays icon, and feed no chart; **the trace** is the
Analysis pane's run bar (a ray budget, ▶ Run, when it ran, and "scene changed since" once an edit makes
it stale: `optics/page.js:1129-1134`); **each chart** is a dock panel of its own, drawn from the stored
result without tracing again. **Any number of charts of a kind** (the user, 2026-10-02: the map's
quantity was one setting for every map, and "compare 2D map of intensity and 2D map of CCT"): a chart is
an entry of `optics/charts.js` with its own settings, the first of each kind always there at the kind's own
id, more made from a chart's ⧉ (its settings copied) or Analysis › New chart, and kept between
visits, because the layout is. The profiles and rings have a quantity of their own; what the maps are made
of (the detector, its area, cells, smoothing, a zoom) stays one set in the Analysis pane. The same day: on
a map the button held down moves the point the profiles go through, and Shift-drag zooms. **Live** (the user,
2026-10-04: "a 'live' mode that traces continuously, updates all charts"): the analysis again and again, each
round that many rays and a whole estimate of its own, every chart swapped when a round is whole; the ray count
a number times × 1 … × 10M, so 100 or 1000 rays a round is two clicks. Switching Live off lets the round in
progress go. Since 0.12.0 Live's rounds can **add up** while nothing changes -- Live is **More** -- and start over when
the picture does (`RT.resets`) or the trace's own settings change; since 0.14.0 only with **Σ** beside it, off at
first (the user: "make the cumulative optional. that makes it easier to compare results"). Not built: **Stop** for ▶ Run, and More after a ▶ Run;
and the pinned reference (section 7).

### What that needs underneath (open)

- **The far field is tallied for every escaping ray, always**, on a fine grid (0.25 deg gamma x 1 deg C)
  that the Intensity window re-bins coarser. "From" and the grid then stop being trace settings. Not
  built: off is still a mode (`FAR_OFF`, `lib/pathtracer/optics/index.js:135-136`).
- **The far field of a detector's rays comes from its hits** (they carry direction and flux), binned in
  the Intensity window -- so "rays arriving at detector X" is an analysis choice too. Not built: a
  detector-fed grid is a trace mode, tallied on the GPU (`kernels.js:519`); `farBin`, its JS mirror,
  only tests call.
- **Hits kept compactly** (ten numbers each in a typed array, not an object), so a 10 M-ray run can keep
  millions of them for the maps; today a map keeps at most 500 000 hits, as JS objects
  (`MAP_HITS`, `optics/page.js:1142-1143`).

**Decided (the user):** the map shows the whole detector by default; escaping rays are for later; first
a tool that measures every object's bounding box. The first and the last are built: `builder/boxes.js`
measures the boxes, and the map covers the detector's box unless zoomed (`optics/page.js:633-641`).

## 10. Scenes, projects and examples (decided 2026-10-02)

**What was wrong.** Every scene of the project was a top-level row of one tree, and touching any row of
another scene made it current and compiled it (`builder/tree.js`, then `onSelectionChange`). A compile is
3.7-23 s per scene, uncached, on the user's Ampere card (PERFORMANCE.md, runs 3 and 4), so a mis-click
cost up to twenty seconds of a frozen view, for something the user does rarely. Every page load also put
the nine bundled scenes into a fresh project and restored nothing: a refresh lost all unsaved work, and
the examples cluttered the tree each time.

**The three things the one tree mixed**, and the weight each gets now: what is being worked on (one
scene, for hours: the whole tree); the user's other scenes (visited now and then: a switcher); the
examples (read, copied from, not edited: a list to open a copy from).

**Decided (the user, 2026-10-02):**
- **One scene in the tree, a DROPDOWN switcher above it** (not tabs: tabs say switching is free, and it
  is a compile). The list switches, adds, duplicates, renames, deletes and orders the project's scenes;
  the tree cannot switch scenes any more.
- **Projects are kept in the browser, in a LIST** (File › Projects…): open, new, duplicate, rename,
  delete, export as a workspace file, import one. The project being worked on is saved as it changes, so
  a refresh comes back to the same scene, camera and renderer settings. A workspace file opened becomes a
  new project in the list instead of replacing the one open. Files stay the backup and the exchange.
- **The undo history is not kept** across a reload.
- **A library item open at a reload is reopened**, Save and Close over the view as before.
- **A second tab on the same project gets its own copy**: the first tab keeps saving the project; the
  second works on a copy, added to the list as "<name> (copy)" once something in it is changed.
- **The bundled scenes are Examples**: not loaded at start; the switcher's list opens a copy of one into
  the project. **A first visit starts on one lightweight demo scene.**
- ~~No row for the scene in the tree~~ (2026-10-02, 0.7.0, the user: "it's kind of duplicated, since there is
  always one scene"; its + and settings went beside the switcher's name, as + and ⚙). **Reversed 2026-10-05
  (0.26.0), the user: the scene's row is the tree's root again** -- a click on it shows its settings in
  Properties, its + is in the same column as every other +. Its ▶ stays gone (a scene compiles as it changes
  and when switched to; the ▶ beside the menu is only there when the scene shown is not this one).
- **A click on a row selects it; only its chevron folds it** (the user, 2026-10-05: "This makes it easier to
  edit properties"). TreeView folded a row with children on any click on it, so a group picked to edit closed
  under the pointer, and the scene's row, clicked for its settings, closed the whole tree. A chevron's click
  changes no selection (TreeView's `toggleOnClick: false`).
- **One project menu over the tree** (the user, 2026-10-05: "combine the open/save and dropdown menu in some
  menu structure"; Open and Save "feel like it should belong in that menu structure"). One row: the menu, a ▶
  when needed, Undo and Redo -- it was two, Undo, Redo, Open, Save over the switcher, its +, its ⚙ and the
  project's name. **The button names the project** (the user's choice of three: the project's name, the
  scene's, or an icon), so the scene is named once, by its row. **Two sections** (the user's choice over a
  menu of submenus): SCENES -- the project's scenes and their ✎ ⧉ ˄ ˅ 🗑, + New scene, Examples ▸, Import
  scenes from a file…, Export this scene / all scenes to a file; PROJECT -- Projects…, New project, Import a
  project from a file…, Export the project to a file. The File menu keeps every one of them as it was.
- **The examples in a submenu** (Examples ▸), "so they're not always shown"; Projects… once.
- **The project menu folded into File** (the user, 2026-10-09, 0.45.0: "lots of duplicate entries ... the scene
  dropdown at top. remove that and make sure it's covered in the file menu"). The dropdown said New scene, Open and
  the saves again under other words, and held what File did not. File now has all of it (builder/filemenu.js):
  Projects…, New project, Import a project from a file…; New scene, **Switch to scene ▸**, **Examples ▸**, Rename /
  Duplicate / Move up / Move down / Delete this scene; Open; the library item's Save and Close; Save now; the
  three files; Save a picture. Switching stays a choice in a submenu, never a click on something else. The row
  over the tree keeps the project's name as plain text, the ▶ and Undo / Redo (builder/projectrow.js).
- **View opens panels, and only View** (same day): Render, Optics, Tools and Edit each had an entry that opened a
  panel View already listed, Save a picture was in File, Render and View, and Find was in Edit and Help with one
  key. Each now in one place: the other menus hold actions only; Tools, left empty, is gone.
- Moving things between scenes without seeing both: Ctrl+C / Ctrl+V across a switch (it already worked;
  it now goes through the system clipboard, so it also works between tabs and after a reload), and a
  row's right-click menu, *Copy to* and *Move to* another scene, which compiles nothing in the scene it
  goes to.

**Chosen here, for the user to overrule:**
- The first visit's scene is *Builder demo* (`scenes/demo.json`): 5.4-6.2 s to compile in runs 3 and 4,
  against 3.7-4.1 s for *Material test*, which is a test chart rather than a demo. *Demo scene*
  (`demoscene.json`), the first scene until now, has a relief and was never measured. One line
  (`FIRST_VISIT`, `scenes/index.js`) changes it.
- ~~An example opens from the camera the view has~~ -- each has its own since 0.54.0, chosen in `scenes/make.mjs`
  and, since 0.66.0, in its file with its exposure, whole (`builder/model.js` VIEW). The box estimate
  (`builder/bounds.js`) is still too loose to frame a scene with: Menger's floor makes its box 300 m wide.
- Ctrl+S saves the project in the browser at once (it downloaded a project file before); the File menu
  still saves the three files.

## 11. Scenes, projects and the menus (proposed 2026-10-17, for the user to decide)

**The user (2026-10-17):** "I dont like how the file menu is organized. I want a better overview of scenes in the project.
Its pretty unclear now. Same for the render settings menu. Those are already covered by the icons in the viewport and
setings in the render pane. ... Originally the scene tree contained multiple scenes. That was logical (scenetree shows
the whole project) but unpractical as youre having a lot of navigation overload. ... Maybe a special project view or only
show active scene in the tree. ... Look at save, load, export. Minimise the number of menu options where possible."
Mockup H (`ui-mockups/h-scenes.html`) draws today and four answers on one made-up project.

### What is there (read in code, 0.62.4)

**Seven menus, 67 rows.** Counted from the code (the mockup's banner counts them from the same lists):

| Menu | Rows | Defined at |
|---|---|---|
| File | 19 | `builder/filemenu.js:57-135` |
| Edit | 2 | `index.html:1174-1175` |
| View | 16 | `lib/shell/shell.js:491-500`, `index.html:306, 314` |
| Render settings | 11 | `index.html:1177-1196` |
| Analysis | 9 | `index.html:302, 1203-1217` |
| Window | 4 | `shell.js:502-507` |
| Help | 6 | `shell.js:501`, `index.html:1239-1255` |

- **The scenes are seen nowhere but File › Switch to scene ▸,** as names. The 0.45.0 fold (section 10) made File the one
  place for them, with Examples ▸ three levels deep, five "…this scene" verbs, and three kinds of file. The row over the
  tree names only the project (`builder/projectrow.js`).
- **File says two things twice:**
  - "Save the library item" and "Save now" both show Ctrl S. One of them is always greyed (`filemenu.js:118, 125`).
  - "Project" names two formats. "Save all scenes to a file" writes the project format; "Save the project to a file"
    writes the workspace format, as the Projects dialog's Download does (`builder/demo.js:738-747`,
    `workspace/dialog.js:109`).
- **Every Render settings row is also somewhere visible.** The Quality presets and Fast while moving have three
  homes each:
  - the pane's Quality box (`lib/pathtracer/settingsui.js:55`);
  - the view's Quality ▾ and ⚡ (`viewtools.js:175-240`);
  - the menu.

  Lamps only and Lights' rays have two: the pane's Light sources box (`settingsui.js:56-58`) and the menu. Environment
  is a click on the scene's row.
- **Other rows repeat a visible control:**
  - Window's four rows are the buttons on every panel group's header (`shell.js:152-159`).
  - View's "Layout: X" rows are the menu bar's layout buttons (`shell.js:284-299`).
  - View › Help is Help › Contents.
  - Rename this scene… is the scene row's label in Properties (`builder/panel.js:280-289`).
- **A command with no menu row is still a command.** Ctrl K finds it (`lib/shell/registry.js:58-62, 72-79`). Taking a
  row out of a menu loses nothing but the row. Two catches:
  - The palette matches the menu's name too (`registry.js:76-79`), so a command taken out of Render settings needs
    "render" in its label to be found by that word.
  - A submenu row is never a palette answer (`registry.js:75`).
- **Shared across a project, not per scene:**
  - the render settings (`workspace/store.js:96-100`);
  - the undo history.

  Each scene has its own camera and environment (`demo.js:134-158`).

### The workflow it serves (inferred from the code and this file's history: the user corrects it)

- **Every session:** resume, then work on one scene for hours.
- **Several times a session:** look at or compare another scene of the project, often a variant.
- **Sometimes:**
  - start a scene: empty, a duplicate, an example, a file;
  - send work out: a picture, a scene or project file, a 3D print, a video.
- **Rarely:**
  - rename, reorder or delete scenes;
  - other projects.

Today the frequent task is the hidden one (three clicks, names only), and the rare ones fill the menu.

### The principles

- **P1.** Each level, project › scene › objects, is visible where the work is.
- **P2.** The scene's commands have one home, beside the scenes. File keeps the files and the projects.
- **P3.** Nothing a visible control does is said again in a menu. Ctrl K still finds it.
- **P4.** Switching is always a deliberate act: a compile, 3.7-23 s on the user's card (section 10). It is never a
  side effect of selecting.
- **P5.** Saving is automatic (`workspace/autosave.js`). Files are for sending work out and bringing it in.

### What every proposal shares

**The menu bar: File · Edit · View · Analysis · Help, 30 rows.**
- **Render settings and Window go.** Their commands keep their ids, with no menu row, and are labelled with "render" and
  "window" so a search still finds them.
- **View loses** Help and the "Layout: X" rows.
- **Analysis** has New chart ▸ in place of six rows. The six commands stay in the palette.
- **File:**
  - New project · Open… (Ctrl O) · Projects and scenes…
  - Save (Ctrl S). It is "Save library item" while an item is being edited, and "Close library item" appears only then.
    This needs a row whose label and visibility follow the state; the registry copies a label once and only greys
    (`registry.js:44-47`, `shell.js:397-400`).
  - Save picture…
  - Export ▸ Scene file… / Project file… / 3D print (3MF / STL)… The last selects the scene's Export box, whose Properties
    hold the two buttons (`builder/panel.js:783-823`), or adds one.

**Two kinds of file instead of three.**
- A **scene file**, and a **project file** in today's workspace format. The project format, without the settings, still
  opens. Nothing bundled is in either project format (read: the examples are scene files).
- **Open…** reads any of them:
  - a scene file joins this project;
  - a project file opens as a project of its own. For a project-format file this changes behaviour: today it joins
    (`index.html:1033-1043`; `store.js:206-213` already reads one as a project).
- That was the only way to bring another project's scenes in, so it moves to **+ New scene › Add scenes from a file…**.

**The Project view** (the user's "special project view"). It replaces the Projects dialog (`workspace/dialog.js`) and
File › Examples.
- **Where it goes:** over the docked panels, not the menu bar. It is opened from the project's name over the tree,
  File › Projects and scenes…, or Ctrl K, and Esc goes back.
- **The projects in this browser:** one another tab has open, and this tab's "not saved yet" copy, keep the dialog's
  rules (`workspace/session.js:33-44`, `dialog.js:116-118`).
- **The scenes as cards:**
  - a picture, the unit, the counts, when edited, and how long the scene took to open last time;
  - a click opens one (a compile) and goes back to the work;
  - drag to reorder; ⋯ for duplicate, export and delete; a + New scene card.
- **The 24 examples**, by audience and group, each with its line.

**Smaller shared changes:**
- **The scene is named once,** by its row, and renamed in Properties.
- **A right-click on the scene's row** duplicates, exports and deletes it.
- **Undoing a change to the list of scenes stays on the scene being worked on (proposed).** Today `restore()` makes the
  changed scene current, a compile (`builder/demo.js:166-174`). Rename, delete, reorder or copy acting on another scene
  would otherwise make Ctrl Z a switch.

### The four everyday layers over it

| | What you see of the other scenes while working | Switch | Against |
|---|---|---|---|
| **A** the view only | nothing; ⇄ on the scene's row opens the view | 2 clicks | every switch is a round trip |
| **B** a quick list | ⇄ on the scene's row: a popover, a small picture each, a click opens | 2 | the overview only on request |
| **C** a scenes strip | cards over the tree, foldable; a click selects (its card in Properties), ▶ or a double-click opens; a tree row dropped on a card is copied there | 1 | height out of a 300 px column; cards look like tabs, which say switching is free |
| **D** the project in the tree | every scene a root row; the open one unfolded, the others one dimmed line that never unfolds; a click selects (its card in Properties), ▶ or a double-click opens; rows dropped on a scene are copied there, scenes dragged to reorder | 1 | rows below the open scene move on a switch (unless it is kept first); reverses 0.7.0's "one scene in the tree" |

**D is not the overload of before 0.7.0.** That came from three things, and D has none of them:
- every scene was a full tree;
- touching any of its rows compiled it;
- nine examples were loaded at every start.

**Recommendation, for the user to overrule: D with the Project view, or B if D does not suit.**
- Every level stays in sight while working, and the overview with pictures is one click away.
- No dropdown comes back.
- The scene is still named once.

### Read in code: what building it needs

**D through TreeView** (`lib/guistuff/treeview/treeview.js`, a7ad397) needs **no change to the submodule**:
- The other scenes are a row type of their own (`nodeTypes`):
  - dimmed by its `labelStyle` and `svgStyle`;
  - with `open`, `duplicate` and `delete` as actions (a toggle with `values: []`), which reach `onToggleClick`.
  - Never style the row div itself: selection, hover and drag reset its colour, background and opacity.
- **A drop into a row without children** is allowed by that type's `allowedChildren`. The tree turns it into
  `sendTo(mid, scene)`.
- **Reordering root rows** splices the root array. `rowsFor` maps the new order to `sceneOps.move`.
- **Drops:** no drop callback gets the DOM event. To read Shift (move instead of copy), the tree records it in a
  capture listener, as it already does for a double-click (`builder/tree.js:616-630`). TreeView sets
  `effectAllowed = 'move'`, so a key that asks for "copy" may cancel a drop. This is untested.
- **The rows that move on a switch:** TreeView has no scroll API, and `rebuild()` makes a new container, so the tree
  keeps the clicked row's place itself.
- **Two bugs in the submodule** that matter here, for its own repository:
  - `_handleDragEnter` is called and never defined, so every dragenter logs a TypeError.
  - `destroy()` calls the undefined `_removeInsertionIndicators`.

**The scene's picture.**
- **What the code allows:** the canvas cannot be read back; its swapchain is RENDER_ATTACHMENT only
  (`lib/pathtracer/index.js:409-411`). The offscreen grab the library's studio uses (`index.js:487-532`,
  `library/studio.js:427-433`) can. It stops the loop and clears the accumulation, so it would run when a scene is
  left: a switch, or another project opened.
- **Where they would be kept:** in a database of their own through `library/thumbs.js:37-56` `indexedDbThumbs`, keyed
  by project and scene. Scene keys repeat across projects (`index.html:1004-1005`). Pictures stay out of the files, so
  there is no format change.
- **Gaps:**
  - A scene never shown in this browser has no picture.
  - The examples have none; they show their line instead.

**How long a scene takes to open.**
- **Measured:** `RT._lastCompile.fromRequestMs` (`raytrace_main.js:570-571`) gives the time of the last compile,
  recorded by scene.
- **Predicted:** before a scene has been opened here, `R.predictCompile` compiles nothing (`raytrace_main.js:646-660`).
  Its fit is rms 11 %, worst 28 % (`compileprogress.js:16-25`). It ignores the browser's own cache, so a scene the
  browser has cached opens faster than it says.
- **Not measured:** what generating a scene's code for a prediction costs on the CPU.

### Decided (the user, 2026-10-17): C, refined (C′ in the mockup)

The user: "go with C -> but combine the 'My project' line and Scenes header into one line. Make a mockup of that
first." Also: "ctrlz - move that out of the scene view. where is that shown typicallu?"; "Save picture - keep where
it is"; "Save: what does this do? Isn't evertything automatically store din the browser? same for open".

**The Scene panel's first line** holds both the project and the scenes:
`▾  ▦ Lamp study · 6 scenes  ……  ＋`
- **The chevron** folds the cards. Folded, the line also names the open scene.
- **The project's name** opens the Project view: the projects, the scenes large, the examples.
- **＋** is New scene: Empty · Duplicate this scene · From an example…, which opens the Project view at its
  examples.
- **A second tab's copy** shows "· not saved yet" after the name.
- **The ▶ "not compiled"** is on the open scene's card, the scene it is about. Today the row over the tree has it.
- **Undo / Redo are no longer here.**

The cards are C's: a click selects a card and shows it in Properties; ▶ or a double-click opens it; a tree row
dropped on a card is copied there, and Shift moves it; dragging the cards reorders them.

**Undo / Redo: Edit and the keys, as before, plus ↶ ↷ on the menu bar after the menus.**
- The usual place is the Edit menu with Ctrl Z / Ctrl Y. Design and CAD tools often add icons to the top bar. This
  is a general convention, not a measurement.
- The undo history is the project's and covers every scene (`builder/demo.js:87-89`), so it belongs to the
  application's bar, not the Scene panel. Each icon's tooltip names the step.

**Save is gone. The project was always saved as it changed.**
- It is written to the browser's storage once a second when something changed, when the tab is hidden, and when
  the page closes (`index.html:1273-1276`). On closing it is also flushed to localStorage, so a reload just after an
  edit loses nothing (`workspace/autosave.js:14-17, 99-137`).
- "Save now" only ran that write at once: `autosave.tick()` twice (`workspace/session.js:117`).
- **The one save that is not automatic is a library item's,** put back into the library (`library/edit.js:300`).
  It has its button on the item's strip over the view (`library/edit.js:247`), and Ctrl S, which keeps working with
  no menu row (`builder/toolbar.js:57-58`). Otherwise Ctrl S confirms that the project is saved.
- **The status bar says "saved in this browser".** When the browser refuses storage, nothing is kept beyond the
  visit (`index.html:341-346`), and the status bar says so. Today's warning there names "File › Save to a file", a
  row that does not exist.

**Open becomes Import from file….**
- It never opened a project kept in the browser: the last one reopens by itself (`session.js:5-14`), and the others
  are in Projects….
- What it did was read a .json file from disk: a backup, or one someone sent (`index.html:973-978, 1033-1049`).
  Dropping a file on the page does the same.
- **A scene file joins this project.** A file of several scenes asks whether to open it as a project of its own or
  to add its scenes to this one. That is the one way to bring another project's scenes in, without a second row.

**File, 5 rows:** New project · Projects… | Import from file… (Ctrl O) · Export ▸ | Save picture….
- Save picture stays where it is.
- Nothing is added while a library item is edited: its strip has Save and Close.
- **The menu bar: 29 rows** (File 5, Edit 2, View 12, Analysis 4, Help 6), against today's 67.

**Then decided (the user, 2026-10-17):** "go, undo stays put, project view is a dockable panel of its own. if it isnt
open, open it in the same pane as the viewport, as these will rarely have to be viewed side by side."

### Built (0.63.0)

- **The cards** (`builder/scenestrip.js`): the line and a card per scene over the tree, in place of the row
  (`builder/projectrow.js`, gone).
  - A card's click shows it in Properties (`builder/panel.js` showScene), read from the project, so nothing compiles.
  - ▶ or a double-click opens it.
  - A tree row dropped on a card goes through `tree.js` sendTo: TreeView tells the tree a drag started, so the tree
    knows the row. The drop asks for 'move', the only effect TreeView allows; Shift on the drop says which.
- **The Project panel** (`workspace/projectview.js`): a dock panel, `menu: false`. It opens as a tab in the viewport's
  group when it is not open; choosing a scene, an example or another project in it brings the picture back.
  - It replaces `workspace/dialog.js` and keeps its rules (delete asks; the project open here, or in another tab,
    cannot be deleted).
- **Undo stays put.** A step carries what it was (`builder/history.js` meta). `demo.js` restore keeps the scene being
  worked on for any step marked `scenes`, and returns 'live' without pushing the uniforms when that scene is untouched.
  - A library item opened or closed is marked `follow`: a mode, whose undo goes with it.
- **The pictures** (`workspace/scenepics.js`, `RT.thumbnail`): a second darkroom develops a copy of the live
  accumulation, small, once a picture has settled.
  - Their cost on a card was not measured. The user judges whether the view hitches when one is taken.
- **The menus:**
  - five on the bar; Render settings and Window menu-less (`standardCommands({ window: false, layouts: false })`);
  - Undo and Redo in `SHELL.tools`;
  - File in five rows (`builder/filemenu.js`);
  - Import from file… asks of a project file (`workspace/ask.js`).
- **Read in code, left for the submodule's own repository:** TreeView calls `_handleDragEnter`, which it never defines,
  on every dragenter (`lib/guistuff/treeview/treeview.js:196`). A tree row dragged onto a card logs a TypeError and
  drops anyway; `projects.check.mjs` lets it through by name.

**Still open:** nothing the user was asked. Not measured: a picture's cost.

**Building it (outline, once the user has seen C′):**
- **The Scene panel.** `builder/projectrow.js` becomes the panel's line and cards, in a module of its own.
- **Dropping tree rows onto cards.** TreeView tells the tree when a drag starts (`onNodeDrop(path, null,
  'dragstart', node)`, `lib/guistuff/treeview/treeview.js:931-933`), so the strip can copy the row there with
  `sendTo`. Nothing in guistuff changes.
- **Undo / Redo.** They move from the row over the tree (`index.html:1082`) to a slot after the menus, which
  `lib/shell/shell.js` needs.
- **File.** `builder/filemenu.js` shrinks to the five rows.
- **The Project view** (`workspace/projectview.js`) replaces `workspace/dialog.js`.
- **The scenes' pictures,** as above.
- **Tests and help:** the tests and help pages listed in this section's hazards.

## Open decisions

**Lights as parameters and code: investigated (2026-09-28), a decision for the user.** A light is a node of
type `light` with `params` (its size: live uniforms, as an object's) and a `light` block of settings, and no
code -- lights.js says why: three things need its shape exactly.
1. Its RAYS: the optics trace and the picture's photons both start from `optSourceRay` (optics/kernels.js),
   which samples a point on a rectangle, disc or point and a direction by the distribution, from a table
   packed in JS (optics/sources.js). WGSL, on the GPU -- so a sampler written as code is possible.
2. Its FLUX against its LUMINANCE: the area, in JS (builder/sources.js sourceTable).
3. Its FACE, the sheet the camera sees (codegen LIGHTS), glowing at that luminance.
A code light would be an EMISSION function, not an SDF: in the node's frame, with its parameters in scope as
an object's are, `emit(u) -> { position, direction, weight }`. What that takes:
- the two generators (the trace's and prog_opt_photons) compiled with the scene's light code -- they are
  compiled per scene already, but hold only the shared sampler today;
- its flux normalised: each ray carries flux / N, so the weights must average 1, or a GPU pass measures
  their mean (as the sky's scale is measured) and divides;
- no face in general -- nothing says what an arbitrary sampler looks like head on -- so, like a ray file, it
  is seen by what it lights (an ordinary emitter-material object can stand in for its look);
- its box measured by sampling emission points, as builder/boxes.js measures shapes.
The rectangle and disc would stay exact types (luminance from area, a visible face), and could show their
sampler as read-only code; code lights would start from library items (a ring, a strip, a COB array, a
sphere).
