# Script functions

> Made by `help/reference.mjs` from `tools/scriptref.js`, which the Script panel's Reference pane shows too: edit that, not this page.

What a scene's [script](../modelling/scripts.md) can call. The same text is in the Script panel: its **?** button.

## Start here

A script is the body of an async function: `await` works at the top level, and `return` ends it (what it returns is printed). Every name below is in scope. In examples, `p` is a setting (from `param`), `pic` a render, `a` an analysis and `m` a map. Nothing runs until **▶ Run** (or Ctrl Enter); **■ Stop** ends a script at its next `await`.

### `st`

Everything below in one object, for passing to a function of your own: `st.params`, `st.optics`, ...

## Settings

Every setting has a path: `scene/<node id>/<name>`, `renderer/...`, `view/camera/...`. The Parameters panel lists them; its ⧉ copies a path, and a row's name dragged into the editor becomes a `param` line. A path that does not exist is an error naming the paths near it. A write makes no undo step unless asked.

### `param(path)`

A setting as a variable. A path that does not exist throws here.

Gives: a handle p, live: reading it reads the setting now, writing it sets it

```
const pos = param('scene/n4/transform/position')
pos.value = [0, 0, 10]
log(pos.z)
```

### `p.value`

The whole value: a number, or a list for a vector or a colour. Assign it to set the setting. A list read from it is a frozen copy: write a part with `p[0] = ...`, not `p.value[0] = ...` (an error).

### `p[0]  p.x  p.r  p.length`

One part of a vector or a colour, read or written alone (the others kept): by index, or as x y z w, or r g b a. `p.length` is how many parts it has. A number has no parts.

```
const pos = param('scene/n4/transform/position')
pos.z += 5
const [x, y, z] = pos
```

### `p.set(value, { undo })`

Set it, as `p.value = ...` does; with `{ undo: true }` one undo step (Ctrl Z puts it back).

### `p.get()`

The value, not frozen: a list you may change (it is a copy).

### `p.info`

What the setting is. `kind` is 'live' (a uniform: the picture follows at once) or 'structural' (a compile: `await settled()` after).

Gives: { path, label, value, min, max, step, unit, kind, animated, dims, options }

### `p.path`

Its path.

### `params.list(prefix, { animated, live })`

Every setting under a path: 'scene', 'scene/n4', 'renderer', 'view/camera'; '' for all. `{ animated: true }` only those flagged ★, `{ live: true }` only those that need no compile.

Gives: a list of { path, label, value, min, max, unit, kind, animated, dims, ... }

```
for (const s of params.list('scene/n4')) log(s.path, s.value, s.unit ?? '')
```

### `params.animated(prefix)`

The settings flagged animated (★ beside a value in Properties): the usual ones for a script to move.

### `params.info(path)`

One setting's entry, as `p.info`.

### `params.get(path)`

A value by its path.

### `params.set(path, value, { undo })`

Set a value by its path, kept to its range (the value returned is what was set).

Gives: the value as set

### `params.apply({ path: value, ... })`

Several at once, no undo step. Every path is checked before any is set: one typo sets nothing.

```
const before = { 'scene/n4/radius': params.get('scene/n4/radius') }
// ... change things ...
params.apply(before)
```

### `params.find(words, limit)`

Settings matching every word, in label, path or group; best first.

### `await settled({ timeout })`

Wait until a compile has finished: after setting a 'structural' setting, before rendering or measuring. Waits for nothing when nothing compiles.

## Scene, camera and exposure

### `scene.title  scene.unit`

The scene's name and its unit ('m', 'cm' or 'mm'): every length a setting has is in it.

### `scene.nodes()`

Every object and group; `path` is where its settings are (`params.list(n.path)`).

Gives: a list of { id, label, kind, type, parent, path }

### `scene.node(name)`

An object or group by its label or id, or null.

```
const lens = scene.node('lens')
for (const s of params.list(lens.path)) log(s.path, s.value)
```

### `camera.get()`

The camera. Lengths are in the scene's unit, angles in degrees.

Gives: { mode, camtype, azimuth, elevation, distance, target, fov, aperture, focus, ... }

### `camera.set({ ... })`

Change only what you name; returns the camera after.

```
camera.set({ azimuth: 30, elevation: 70 })
```

### `exposure.get()  exposure.set({ ... })`

The exposure settings by name (exposureEV, autoExposure, toneMap, ...), as the Exposure box has them.

## The live picture

### `picture.samples()`

How many samples the live picture holds now.

### `await picture.wait(n, { timeout })`

Wait until the live picture holds n samples (it starts over after any change). An error when the picture is paused.

### `await picture.measure(x, y)`

The luminance (cd/m²) at a point and its standard error, x and y from -1 to 1, left to right and bottom to top. null where nothing is sampled.

Gives: { L, se, rel, nEff, count, px, py } -- and E, seE in lux in the illuminance view

```
await picture.wait(64)
const r = await picture.measure(0, 0)
log(`centre: ${r.L.toFixed(1)} ± ${r.se.toFixed(1)} cd/m²`)
```

### `await picture.region(xa, ya, xb, yb)`

A rectangle's mean over its pixels, error, minimum, maximum and uniformity (cd/m², or lux in the illuminance view).

Gives: { mean, se, rel, min, max, uniformity, pixels, sampled, unit }

### `picture.size()`

The live view's size in pixels.

Gives: { w, h, ... }

## Rendering and saving

### `await render({ width, height, samples, show })`

Render as the Darkroom's Render does: kept as light, and shown in the Darkroom unless `show: false`. Width and height default to the live view's. The Darkroom keeps one picture: a render replaces the one before.

Gives: the picture, pic

```
const pic = await render({ width: 1920, height: 1080, samples: 256 })
await pic.save('render.png')
```

### `pic.width  pic.height  pic.samples  pic.view`

Its size, its samples, and the develop settings the view had (`view.ev`, `view.toneMap`, ...).

### `await pic.save(name, { format, look, quality, values, precision, gamut })`

Develop and download it under `name`, as it is. The extension sets the format -- png, jpg, webp, exr, hdr, pfm -- or `format: 'png16'`. `look`: 'view' (as the view showed it, the default), 'darkroom' (the Darkroom's settings now), or settings over the view's, `{ ev: 13, toneMap: 2 }` (`{ from: 'darkroom', ev: 13 }` over the Darkroom's). For exr, hdr and pfm, `values` is 'absolute' (cd/m²) or 'exposed', and exr's `precision` 'float' or 'half'.

Gives: { name, bytes }

```
await pic.save('light.exr')
await pic.save('bright.jpg', { look: { ev: 11 }, quality: 0.9 })
```

### `await pic.blob(name, options)`

The same file as a Blob, without downloading it.

### `await pic.pixel(x, y)`

One pixel's light in cd/m², x and y in the picture's pixels, row 0 at the bottom.

Gives: { rgb, Y }

### `await pic.meter()`

The EV the Darkroom's meter reads off the picture: what to give `look: { ev }`.

## The analysis: running it

The analysis traces rays from every light in the scene, each to its end, and books every lumen: escaped, absorbed by each object, caught by a detector, or lost. It runs exactly as ▶ Run in the Analysis pane does, and the pane and every chart show a script's run. **Every number is a mean over batches, with its standard error (`se`) from their spread**: a run is at least 4 batches of at most 250 000 rays. Four times the rays halves the errors. Two settings compared by their numbers differ only where the difference is larger than the errors. The haze box's dust is not traced here (`a.note` says so). An analysis is refused while the pane's Live is on.

### `await optics.run({ rays, from, axis, flip, dG, dC })`

Run it, with any setup given first (the rest as the pane has it).

Gives: the analysis, a

```
const a = await optics.run({ rays: 1e6 })
log('I max', a.peak().I, 'cd')
```

### `optics.configure({ rays, from, axis, flip, dG, dC })`

Change the setup without running. `rays`: 1 to 50 million. `from`: what feeds the far field -- 'escaped' (the rays leaving the scene) or a detector object by its name (the rays reaching it; a closed scene needs one). `axis`: γ = 0, the photometric axis -- a light by its name (its +z) or its number in `axisOptions`, or a direction [x, y, z]; `flip`: its −z instead. `dG`: the γ step, one of 0.25, 0.5, 1, 2, 2.5, 5 degrees; `dC`: the C step, one of 1, 2.5, 5, 10, 15, 22.5, 30, 45, 90. A finer grid has smaller bins, each with fewer rays and more noise.

Gives: the setup as it is after

### `optics.setup()`

The setup now, and the choices this scene offers: its detectors (fromOptions) and its lights (axisOptions).

Gives: { rays, from, axis, flip, dG, dC, fromOptions, axisOptions, dGOptions, dCOptions }

```
log(optics.setup().fromOptions)
```

### `optics.last()`

The pane's last analysis -- a click's or a script's -- or null.

## The analysis: what it found

Fluxes are in lm (or W for a ray file given in watts). A number with an error is `{ value, se }`; `se` is null after one batch.

### `a.rays  a.batches  a.at  a.unit`

How many rays, in how many batches, when, and the flux unit.

### `a.stale`

True when the scene has changed since the run: its numbers are of a scene that is no longer there.

### `a.note`

What the run could not trace (a haze box), or ''.

### `a.totals`

Every lumen booked. escaped: left the scene. absorbed: taken by surfaces (and the media between them, `volume`). detected: caught by detectors. lost: ended by a limit -- the maximum distance, the march steps or the bounces. Together they are what was emitted.

Gives: { emitted, escaped, lost, absorbed, detected, volume }, each { value, se }

```
const t = a.totals
log(`escaped ${t.escaped.value.toFixed(1)} ± ${t.escaped.se?.toFixed(1)} of ${t.emitted.value.toFixed(1)} lm`)
```

### `a.efficiency`

escaped / emitted: what leaves the scene. (The far field's own share is `a.stats().efficiency`.)

### `a.objects  a.object(name)`

What each object received and absorbed, by its name in the tree; `a.object('lens')` one by name or tag.

Gives: { tag, name, incident, absorbed, hits }

```
const lens = a.object('lens')
log('lens absorbs', lens.absorbed.value, 'of', lens.incident.value, 'lm')
```

### `a.materials`

The same per material.

Gives: { index, name, incident, absorbed, hits }

## The analysis: the far field

The far field is the light as seen from far away: luminous intensity I (cd) in each direction, on a type C grid -- γ the angle from the photometric axis (0 to 180), C the angle about it (0 to 360, from the light's +x). A ray counts by its direction only. These functions read it as the Polar and I–γ charts do. Each takes `{ symmetry: 'rotational' }` to pool every C plane (a round beam: far less noise) and `{ perKlm: true }` for cd per 1000 lm emitted. They are errors when the run had no far field (`a.hasFarField`).

### `a.hasFarField  a.far`

Whether there is one, and its raw grid: { nC, nG, axis, c0, flux (per bin, lm), se, emitted, ... }.

### `a.peak({ symmetry, perKlm })`

The brightest direction: I max and where.

Gives: { I, se, gamma, C }

```
const pk = a.peak({ symmetry: 'rotational' })
log(`I max ${pk.I.toFixed(0)} ± ${pk.se?.toFixed(0)} cd at γ ${pk.gamma}°`)
```

### `a.intensityAt(gamma, C, opts)`

I in one direction, interpolated between bins.

Gives: { I, se }

### `a.beam(C, opts)`

The beam angle (where I falls to 50 % of I max) and field angle (10 %) in the plane through C and C + 180: each side on its own (`minus` towards C + 180, `plus` towards C) and the full `width`, in degrees. null where the curve never falls that far.

Gives: { C, peak, beam: { minus, plus, width }, field: { minus, plus, width } }

```
const b = a.beam(0)
log('beam', b.beam?.width?.toFixed(1), '° field', b.field?.width?.toFixed(1), '°')
```

### `a.stats({ planes, symmetry, perKlm })`

What a datasheet gives, at once: I max; each plane's beam and field angles (planes default [0, 90]); the flux in the far field and its share of what was emitted; the zonal flux in 0–30, 0–60, 0–90 and 90–180°.

Gives: { max, planes: [a.beam(C) per plane], flux, emitted, efficiency, zones: [{ from, to, flux }] }

### `a.fluxWithin(angle)`

The flux in lm within a cone of `angle` degrees about the axis -- the share of a bin the cone cuts counted by its solid angle.

```
log('within 10°:', (100 * a.fluxWithin(10) / a.totals.emitted.value).toFixed(1), '% of the light')
```

### `a.fluxBetween(from, to)`

The flux between two angles from the axis: a ring of directions.

### `a.farFlux`

All the flux the far field holds, lm.

### `a.curve(C, opts)`

The plane through C and C + 180 as the polar chart draws it: `a` the signed angle (−180 to 180; minus is the C + 180 half).

Gives: [{ a, I, se }]

```
files.save('curve.csv', [['gamma', 'I (cd)'], ...a.curve(0).map(p => [p.a, p.I])])
```

### `a.intensity(opts)`

The whole intensity grid: I[j * nC + i] at γ = j·dG, C = i·dC.

Gives: { nC, nG, dC, dG, I, se, unit }

### `a.intensityCSV(opts)`

The grid as CSV text, a row per γ and a column per C, as the pane saves it.

```
files.save('intensity.csv', a.intensityCSV())
```

### `a.plane({ h, half, cells, symmetry })`

The far field on a plane `h` metres along the axis, square to it, `half` metres each way (0: wide enough for the beam): E = I cos³γ / h². Exact for a point source, off by about the luminaire's size over h.

Gives: a map, m

## The analysis: detectors and maps

A detector is an object whose optics role is detector (or ray limiter: its Optics-Analysis box, with the scene's optics analysis on): rays stop on it and are recorded where they land. A map is those hits as illuminance (lx; W/m² for watts) on square cells over a plane fitted to them -- a flat detector's own plane, laid out along the world's axes when it is square to one. A cell's noise is about 1 / √(its hits): with few hits a fine map is noise, so use fewer cells or smoothing. At most 500 000 hits are kept for maps.

### `a.detectors()`

Every detector hit, by its object's name.

Gives: [{ tag, name, hits }]

### `a.hits(detector)`

One detector's hits: where (scene unit), from which direction, each one's flux, its colour as XYZ.

Gives: [{ pos, dir, flux, tag, xyz }]

### `a.map(detector, { cells, smooth, bandwidth, k, area })`

A detector's map, by its name or tag (the first detector hit when not given). `cells` across (64). `smooth`: 'none', 'gauss' or 'epan' (a kernel `bandwidth` cells wide; both keep the flux exactly) or 'knn' (the `k` nearest hits: sharp where hits are dense). `area`: 'detector' (its whole measured box) or 'lit' (where light landed).

Gives: a map, m

```
const m = a.map('screen', { cells: 32, smooth: 'gauss' })
log(`E max ${m.max.toFixed(0)} lx, mean ${m.meanLit.toFixed(0)}, U0 ${m.uniformity?.toFixed(2)}`)
```

### `m.max  m.meanLit  m.minLit  m.uniformity  m.Ud`

The illuminance: the brightest cell, the mean and least over the lit cells (those any hit landed in), U0 = min / mean, Ud = min / max.

### `m.total  m.litArea  m.litCells`

The flux the map holds (lm), the lit area (m²) and how many cells are lit.

### `m.relNoise  m.hitsPerLitCell  m.flatness`

How far to trust it: a lit cell's relative noise (0.1 is ±10 %), hits per lit cell, and how far the detector is from flat (rms, over its size: above 0.01 the map is a projection).

### `m.colour`

The colour of all the light that arrived, and its uniformity: the largest and rms Δu′v′ of a cell from it, over the cells at 10 % of the peak or more.

Gives: { x, y, u, v, cct, duv, cctInRange, dUpVpMax, dUpVpRms } or null

### `m.E  m.nx  m.ny  m.cell  m.range  m.axisNames`

The cells: E[y * nx + x] (row 0 at the low edge), `cell` wide in `lengthUnit`, covering `range` { a: [lo, hi], b: [lo, hi] }, the axes named (x and y for a floor). `name` the detector, `raw` everything the map knows.

### `m.at(a, b)`

E at a point in the map's coordinates, or null off it.

Gives: { E, se }

### `m.peak()  m.centroid()`

Where the brightest cell is, and the flux-weighted centre.

Gives: [a, b]

### `m.profile(axis, at)`

E along 'a' or 'b' through a point: 'peak' (default), 'centroid' or [a, b] -- a row of cells, as the Profiles chart.

Gives: [{ x, y, se }]

### `m.radial(at)`

E averaged over rings a cell wide about a point (the Rings chart); `full` is false once a ring reaches past the map.

Gives: [{ x, y, se, cells, full }]

### `m.encircled(at)`

The share of the flux within each radius of a point (the Encircled flux chart): r50 and r90 hold half and nine tenths of it -- how tight a spot is.

Gives: { points, total, r50, r90 }

```
const e = a.map('screen').encircled()
log('r50', e.r50, 'r90', e.r90, a.map('screen').lengthUnit)
```

### `m.isolux([levels])`

Isolux lines at those illuminances, as line segments.

Gives: [{ level, segs: [[a0, b0, a1, b1]] }]

## Files, output and waiting

### `log(...)  warn(...)`

A line under the editor; numbers to 6 figures, lists and objects written out.

### `files.save(name, data)`

Download: a list of rows (lists or objects) as CSV, text as text, anything else as JSON, a Blob as it is. The browser may ask once whether this page may download several files.

Gives: { name, bytes }

```
files.save('results.csv', [{ radius: 2, I: 410 }, { radius: 2.5, I: 455 }])
```

### `files.csv(rows)`

Rows as CSV text, without saving.

### `progress(done, total, label)`

A bar in the status bar; `progress(null)` takes it away.

### `await sleep(ms)  await frame()`

Wait a time, or one frame of the picture. A long calculation that never waits holds the page, and Stop cannot be pressed: put an `await sleep(0)` in it.

### `check()  signal`

`check()` ends the script if Stop was pressed; `signal` is the run's AbortSignal, for a `fetch` of your own.

## Recipes

### `A sweep: one setting against two numbers`

Each value an analysis, every number with its error, into a CSV.

```
const r = param('scene/n4/radius')            // drag your own setting in
const rows = []
for (const v of [2, 2.5, 3, 3.5, 4]) {
    r.value = v
    if (r.info.kind === 'structural') await settled()
    const a = await optics.run({ rays: 5e5 })
    const pk = a.peak({ symmetry: 'rotational' })
    rows.push({ radius: v, Imax: pk.I, se: pk.se, within10: a.fluxWithin(10) })
    log(v, pk.I.toFixed(0), '±', pk.se?.toFixed(0))
}
files.save('sweep.csv', rows)
```

### `Uniformity on a screen`

A detector's U0 and Ud, with how noisy the map is.

```
const a = await optics.run({ rays: 2e6 })
const m = a.map(a.detectors()[0]?.name, { cells: 24, smooth: 'gauss' })
log(m.name, 'U0', m.uniformity?.toFixed(3), 'Ud', m.Ud?.toFixed(3), `±${(100 * m.relNoise).toFixed(0)} % a cell`)
```

### `Is B better than A?`

Compare with the errors: a difference smaller than about twice its error is noise.

```
const p = param('scene/n4/radius')
const merit = async v => { p.value = v; const a = await optics.run({ rays: 1e6 }); return a.peak() }
const A = await merit(2), B = await merit(3)
const d = B.I - A.I, e = Math.hypot(A.se ?? 0, B.se ?? 0)
log(`B - A = ${d.toFixed(0)} ± ${e.toFixed(0)} cd: ${Math.abs(d) > 2 * e ? 'a real difference' : 'within the noise'}`)
```

