# Scripts

A scene can hold a **script**: JavaScript that sets any setting, moves the camera, renders pictures and saves them,
runs the analysis and reads its numbers. Use it for a series of generated pictures, a turntable, or a lens tuned by
trying values and measuring each.

The script is part of the scene. It is saved with it and travels with its file. Open it with **View › Script**
([the Script panel](show:tools.script)).

This page is the overview. Every function, with what it gives back and an example, is in
[Script functions](../reference/script.md), and in the Script panel itself: **? Reference** opens it beside the editor,
where you can search it and put an example into your script with **insert**.

## Running one

**▶ Run** (or **Ctrl Enter** in the editor) runs the script. **■ Stop** stops it the next time it waits for
something: a render, an analysis, `sleep`. What it prints, and any error with the line it is on, appears under the
editor; that line is marked in red in the line numbers. **Examples…** puts in a script to start from.

A script never runs on its own: not when a scene is opened, shown or loaded. It runs only when you press Run.

**A script can do anything the page can.** It can read the projects kept in this browser, save files, and reach the
internet. Read a script from someone else before you run it, as you would any program.

A script runs while you watch. Every change it makes shows in the picture, the panels and the charts. A loop that
never waits for anything holds the page until it ends, and **Stop** cannot be pressed meanwhile. Put an
`await sleep(0)` in a long calculation.

## Settings

Every setting has a path, such as `scene/n4/radius`, `scene/n7/light/flux` or `view/camera/azimuth`. The
[Parameters panel](show:parameters) lists them all, and **Ctrl K** finds one by name. A row's **⧉** (shown when the
pointer is over it) copies its path; so does right-clicking the row.

**Drag a setting's name from the Parameters panel into the script.** On an empty line it becomes a variable for it:

```
const lensPosition = param('scene/n4/transform/position')   // lens › position
```

Dropped inside code, after `const r = ` for instance, it becomes only `param('scene/n4/transform/position')`.

A variable made by `param` is the setting, live: reading it reads the setting now, and writing it sets it.

```
lensPosition.value = [1, 2, 4]     // the whole of it
let x = lensPosition[0]            // one part: [0] [1] [2], or .x .y .z (.r .g .b for a colour)
lensPosition.z = 4                 // one part set, the others kept
const radius = param('scene/n4/radius')
radius.value *= 1.1                // a number
log(radius * 2)                    // and in a calculation, its value
```

Writing `lensPosition = [1, 2, 4]` does not set the setting: in JavaScript that replaces the variable. Declared with
`const`, as the dragged line is, it is reported as an error. `lensPosition.value[0] = 5` is an error too, because
`.value` is a copy. Write `lensPosition[0] = 5`.

The same can be done with paths:

| | |
|---|---|
| `param(path)` | a variable for one setting, as above |
| `params.list(path)` | every setting under a path (`'scene'`, `'scene/n4'`, `'renderer'`): each `{ path, label, value, min, max, unit, kind, animated }` |
| `params.list(path, { animated: true })` | only the ones flagged animated (★ in Properties); `{ live: true }` only those that need no compile |
| `params.animated()` | the settings flagged animated: the usual ones for a script to move |
| `params.get(path)` | a value: a number, or a list of numbers for a vector or a colour |
| `params.set(path, value)` | set it, kept to its range; returns the value set. No undo step, unless `{ undo: true }` |
| `params.apply({ path: value, … })` | several at once. Every path is checked before any is set |
| `params.find('radius')` | settings matching the words, best first |
| `await settled()` | wait for a compile to finish. A setting whose `kind` is `'structural'` changes the shader |
| `scene.nodes()`, `scene.node('lens')` | the scene's objects and groups: `{ id, label, path }` |

A path that does not exist is an error, with the paths that are near it. A misspelt path never does nothing in
silence.

## The camera and the live picture

| | |
|---|---|
| `camera.get()`, `camera.set({ azimuth: 30, elevation: 70 })` | the camera; set only what you name. Lengths are in the scene's unit |
| `exposure.get()`, `exposure.set({ exposureEV: 12 })` | the exposure |
| `await picture.wait(64)` | wait until the live picture holds 64 samples |
| `await picture.measure(x, y)` | the luminance at a point, x and y from −1 to 1: `{ L, se }` in cd/m² |
| `await picture.region(xa, ya, xb, yb)` | a rectangle's mean, error, minimum, maximum and uniformity |

## Rendering and saving

`await render({ width: 1920, height: 1080, samples: 256 })` renders as **Render** in the
[Darkroom](show:output) does: the picture is kept as light and shown there. It returns the picture:

| | |
|---|---|
| `await pic.save('frame-001.png')` | develop it and download it. The extension sets the format: `png`, `jpg`, `webp`, `exr`, `hdr`, `pfm` (`{ format: 'png16' }` for 16 bits) |
| `{ look: 'view' }` | as the view showed it (the default) |
| `{ look: 'darkroom' }` | with the Darkroom's settings as they are now |
| `{ look: { ev: 13, toneMap: 2 } }` | the view's settings with these over them; `{ from: 'darkroom', ev: 13 }` the Darkroom's |
| `await pic.blob(name, options)` | the file without downloading it |
| `await pic.pixel(x, y)` | one pixel's light, `{ rgb, Y }` in cd/m² |

The Darkroom keeps one picture: a render replaces the one before, and the earlier picture can no longer be saved.
The browser may ask once whether this page may download several files.

## The analysis

`await optics.run({ rays: 1e6 })` runs the analysis as **▶ Run** in the [Analysis](show:optics) pane does, and the
charts show it. It returns what it found. `optics.last()` is the pane's last analysis, a click's or a script's.

Before a run you can set what feeds it, with the same choices as the pane's **Intensity** box:
`{ rays, from: 'escaped' or a detector material's name, axis: a light's name or [x, y, z], flip, dG, dC }`.
`optics.setup()` lists what the scene offers. What every number means, what its error says and how many rays you
need are in [Script functions](../reference/script.md#the-analysis-running-it).

| | |
|---|---|
| `a.totals` | the flux emitted, escaped, lost, absorbed and detected, each `{ value, se }` in lm |
| `a.objects`, `a.object('lens')` | what each object received and absorbed, named as the tree names it |
| `a.peak()` | the brightest direction: `{ I, se, gamma, C }`, I in cd |
| `a.intensityAt(gamma, C)` | the intensity in one direction |
| `a.stats({ planes: [0, 90] })` | I max, each plane's beam angle (50 %) and field angle (10 %), the flux and the zones |
| `a.beam(C)` | one plane's beam and field angles: `beam.width`, `field.width` |
| `a.fluxWithin(10)`, `a.fluxBetween(10, 30)` | the flux in a cone about the axis, in lm |
| `a.curve(C)` | the plane through C and C + 180, as the polar chart draws it |
| `a.intensityCSV()` | the whole intensity grid as text, a row per γ |
| `a.detectors()` | the detectors hit, and how many hits each |
| `a.map('screen', { cells: 64 })` | a detector's illuminance map: `max`, `meanLit`, `minLit`, `uniformity` (U0), `total` |
| `m.encircled()` | the encircled flux about the peak: `r50`, `r90`, `total` |
| `m.profile('a')`, `m.radial()`, `m.at(x, y)` | a profile, the ring average, one point |
| `a.plane({ h: 3 })` | the far field on a plane 3 m away, as a map |

The `{ symmetry: 'rotational' }` option on `peak`, `stats` and the rest pools each ring of the far field, for a round
beam. These are the numbers the charts show. They come from the same calculations, not a second set.

## Files and output

| | |
|---|---|
| `log(...)`, `warn(...)` | a line under the editor |
| `files.save('data.csv', rows)` | download: a list of rows as CSV, text as text, anything else as JSON |
| `progress(done, total, 'label')` | a bar in the status bar |
| `await sleep(ms)`, `await frame()` | wait |

## Tuning a lens

The **Optimise a lens** example tunes one setting for the highest peak intensity. It runs the analysis for each value,
narrows the range by golden section, and saves the values it tried as a CSV. To use it, flag the setting animated or
write its path at the top. To tune for something else, change the line that reads the result: the flux within 10°,
a detector's uniformity, the beam angle.

Each try is an analysis, so its number is noisy. The errors (`se`) say by how much. Use enough rays that two values
you want to tell apart differ by more than their errors.

A built-in optimiser that tunes several settings at once is planned.
