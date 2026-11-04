//======================================================================================================================
// THE SCRIPT'S REFERENCE (0.82.0): every name a script is handed, what it does, what it gives back, and an example --
// shown in the Script panel's Reference pane (tools/script.js) and written as Help › Reference › Script functions by
// help/reference.mjs. One text, two places: the user asked for more help with the analysis beside the editor
// (2026-11-03), and a help page and a pane written apart would drift.
//
// EVERY NAME THE API HAS IS HERE, AND NOTHING ELSE (tools/test/script.test.mjs walks the API -- its objects, a render's
// handle, an analysis, a map, a setting's handle -- against `names`): a function added to the API without words fails
// the test, the "second caller" this repository's bugs come from (CLAUDE.md).
//
// What the numbers mean was read in the code they come from, not written from memory: optics/page.js (the setup and the
// batches), lib/pathtracer/optics/estimate.js (the totals and their errors), farfield.js (the far field), detmap.js and
// illum.js (the maps).
//
// Text is plain with `code` and **bold**; examples are JavaScript the Reference pane can put in the editor.
//======================================================================================================================

export const SCRIPT_REF = [
    {
        title: 'Start here', id: 'start',
        intro: 'A script is the body of an async function: `await` works at the top level, and `return` ends it (what it returns is printed). '
            + 'Every name below is in scope. In examples, `p` is a setting (from `param`), `pic` a render, `a` an analysis and `m` a map. '
            + 'Nothing runs until **▶ Run** (or Ctrl Enter); **■ Stop** ends a script at its next `await`.',
        items: [
            { names: ['st'], sig: 'st', text: 'Everything below in one object, for passing to a function of your own: `st.params`, `st.optics`, ...' },
        ],
    },
    {
        title: 'Settings', id: 'settings',
        intro: 'Every setting has a path: `scene/<node id>/<name>`, `renderer/...`, `view/camera/...`. The Parameters panel lists them; '
            + 'its ⧉ copies a path, and a row\'s name dragged into the editor becomes a `param` line. A path that does not exist is an error naming the paths near it. '
            + 'A write makes no undo step unless asked.',
        items: [
            { names: ['param'], sig: 'param(path)', returns: 'a handle p, live: reading it reads the setting now, writing it sets it',
              text: 'A setting as a variable. A path that does not exist throws here.',
              example: "const pos = param('scene/n4/transform/position')\npos.value = [0, 0, 10]\nlog(pos.z)" },
            { names: ['p.value'], sig: 'p.value', text: 'The whole value: a number, or a list for a vector or a colour. Assign it to set the setting. A list read from it is a frozen copy: write a part with `p[0] = ...`, not `p.value[0] = ...` (an error).' },
            { names: ['p[i]', 'p.x', 'p.y', 'p.z', 'p.w', 'p.r', 'p.g', 'p.b', 'p.a', 'p.length'], sig: 'p[0]  p.x  p.r  p.length',
              text: 'One part of a vector or a colour, read or written alone (the others kept): by index, or as x y z w, or r g b a. `p.length` is how many parts it has. A number has no parts.',
              example: "const pos = param('scene/n4/transform/position')\npos.z += 5\nconst [x, y, z] = pos" },
            { names: ['p.set'], sig: 'p.set(value, { undo })', text: 'Set it, as `p.value = ...` does; with `{ undo: true }` one undo step (Ctrl Z puts it back).' },
            { names: ['p.get'], sig: 'p.get()', text: 'The value, not frozen: a list you may change (it is a copy).' },
            { names: ['p.info'], sig: 'p.info', returns: '{ path, label, value, min, max, step, unit, kind, animated, dims, options }', text: 'What the setting is. `kind` is \'live\' (a uniform: the picture follows at once) or \'structural\' (a compile: `await settled()` after).' },
            { names: ['p.path'], sig: 'p.path', text: 'Its path.' },
            { names: ['params.list'], sig: 'params.list(prefix, { animated, live })', returns: 'a list of { path, label, value, min, max, unit, kind, animated, dims, ... }',
              text: 'Every setting under a path: \'scene\', \'scene/n4\', \'renderer\', \'view/camera\'; \'\' for all. `{ animated: true }` only those flagged ★, `{ live: true }` only those that need no compile.',
              example: "for (const s of params.list('scene/n4')) log(s.path, s.value, s.unit ?? '')" },
            { names: ['params.animated'], sig: 'params.animated(prefix)', text: 'The settings flagged animated (★ beside a value in Properties): the usual ones for a script to move.' },
            { names: ['params.info'], sig: 'params.info(path)', text: 'One setting\'s entry, as `p.info`.' },
            { names: ['params.get'], sig: 'params.get(path)', text: 'A value by its path.' },
            { names: ['params.set'], sig: 'params.set(path, value, { undo })', returns: 'the value as set', text: 'Set a value by its path, kept to its range (the value returned is what was set).' },
            { names: ['params.apply'], sig: 'params.apply({ path: value, ... })', text: 'Several at once, no undo step. Every path is checked before any is set: one typo sets nothing.',
              example: "const before = { 'scene/n4/radius': params.get('scene/n4/radius') }\n// ... change things ...\nparams.apply(before)" },
            { names: ['params.find'], sig: 'params.find(words, limit)', text: 'Settings matching every word, in label, path or group; best first.' },
            { names: ['settled'], sig: 'await settled({ timeout })', text: 'Wait until a compile has finished: after setting a \'structural\' setting, before rendering or measuring. Waits for nothing when nothing compiles.' },
        ],
    },
    {
        title: 'Scene, camera and exposure', id: 'scene',
        items: [
            { names: ['scene.title', 'scene.unit'], sig: 'scene.title  scene.unit', text: 'The scene\'s name and its unit (\'m\', \'cm\' or \'mm\'): every length a setting has is in it.' },
            { names: ['scene.nodes'], sig: 'scene.nodes()', returns: 'a list of { id, label, kind, type, parent, path }', text: 'Every object and group; `path` is where its settings are (`params.list(n.path)`).' },
            { names: ['scene.node'], sig: 'scene.node(name)', text: 'An object or group by its label or id, or null.',
              example: "const lens = scene.node('lens')\nfor (const s of params.list(lens.path)) log(s.path, s.value)" },
            { names: ['camera.get'], sig: 'camera.get()', returns: '{ mode, camtype, azimuth, elevation, distance, target, fov, aperture, focus, ... }', text: 'The camera. Lengths are in the scene\'s unit, angles in degrees.' },
            { names: ['camera.set'], sig: 'camera.set({ ... })', text: 'Change only what you name; returns the camera after.', example: 'camera.set({ azimuth: 30, elevation: 70 })' },
            { names: ['exposure.get', 'exposure.set'], sig: 'exposure.get()  exposure.set({ ... })', text: 'The exposure settings by name (exposureEV, autoExposure, toneMap, ...), as the Exposure box has them.' },
        ],
    },
    {
        title: 'The live picture', id: 'picture',
        items: [
            { names: ['picture.samples'], sig: 'picture.samples()', text: 'How many samples the live picture holds now.' },
            { names: ['picture.wait'], sig: 'await picture.wait(n, { timeout })', text: 'Wait until the live picture holds n samples (it starts over after any change). An error when the picture is paused.' },
            { names: ['picture.measure'], sig: 'await picture.measure(x, y)', returns: '{ L, se, rel, nEff, count, px, py } -- and E, seE in lux in the illuminance view',
              text: 'The luminance (cd/m²) at a point and its standard error, x and y from -1 to 1, left to right and bottom to top. null where nothing is sampled.',
              example: 'await picture.wait(64)\nconst r = await picture.measure(0, 0)\nlog(`centre: ${r.L.toFixed(1)} ± ${r.se.toFixed(1)} cd/m²`)' },
            { names: ['picture.region'], sig: 'await picture.region(xa, ya, xb, yb)', returns: '{ mean, se, rel, min, max, uniformity, pixels, sampled, unit }', text: 'A rectangle\'s mean over its pixels, error, minimum, maximum and uniformity (cd/m², or lux in the illuminance view).' },
            { names: ['picture.size'], sig: 'picture.size()', returns: '{ w, h, ... }', text: 'The live view\'s size in pixels.' },
        ],
    },
    {
        title: 'Rendering and saving', id: 'render',
        items: [
            { names: ['render'], sig: 'await render({ width, height, samples, show })', returns: 'the picture, pic',
              text: 'Render as the Darkroom\'s Render does: kept as light, and shown in the Darkroom unless `show: false`. Width and height default to the live view\'s. The Darkroom keeps one picture: a render replaces the one before.',
              example: "const pic = await render({ width: 1920, height: 1080, samples: 256 })\nawait pic.save('render.png')" },
            { names: ['pic.width', 'pic.height', 'pic.samples', 'pic.view'], sig: 'pic.width  pic.height  pic.samples  pic.view', text: 'Its size, its samples, and the develop settings the view had (`view.ev`, `view.toneMap`, ...).' },
            { names: ['pic.save'], sig: 'await pic.save(name, { format, look, quality, values, precision, gamut })', returns: '{ name, bytes }',
              text: 'Develop and download it under `name`, as it is. The extension sets the format -- png, jpg, webp, exr, hdr, pfm -- or `format: \'png16\'`. `look`: \'view\' (as the view showed it, the default), \'darkroom\' (the Darkroom\'s settings now), or settings over the view\'s, `{ ev: 13, toneMap: 2 }` (`{ from: \'darkroom\', ev: 13 }` over the Darkroom\'s). For exr, hdr and pfm, `values` is \'absolute\' (cd/m²) or \'exposed\', and exr\'s `precision` \'float\' or \'half\'.',
              example: "await pic.save('light.exr')\nawait pic.save('bright.jpg', { look: { ev: 11 }, quality: 0.9 })" },
            { names: ['pic.blob'], sig: 'await pic.blob(name, options)', text: 'The same file as a Blob, without downloading it.' },
            { names: ['pic.pixel'], sig: 'await pic.pixel(x, y)', returns: '{ rgb, Y }', text: 'One pixel\'s light in cd/m², x and y in the picture\'s pixels, row 0 at the bottom.' },
            { names: ['pic.meter'], sig: 'await pic.meter()', text: 'The EV the Darkroom\'s meter reads off the picture: what to give `look: { ev }`.' },
        ],
    },
    {
        title: 'The analysis: running it', id: 'analysis',
        intro: 'The analysis traces rays from every light in the scene, each to its end, and books every lumen: escaped, absorbed by each object, '
            + 'caught by a detector, or lost. It runs exactly as ▶ Run in the Analysis pane does, and the pane and every chart show a script\'s run. '
            + '**Every number is a mean over batches, with its standard error (`se`) from their spread**: a run is at least 4 batches of at most 250 000 rays. '
            + 'Four times the rays halves the errors. Two settings compared by their numbers differ only where the difference is larger than the errors. '
            + 'The haze box\'s dust is not traced here (`a.note` says so). An analysis is refused while the pane\'s Live is on.',
        items: [
            { names: ['optics.run'], sig: 'await optics.run({ rays, from, axis, flip, dG, dC })', returns: 'the analysis, a',
              text: 'Run it, with any setup given first (the rest as the pane has it).',
              example: "const a = await optics.run({ rays: 1e6 })\nlog('I max', a.peak().I, 'cd')" },
            { names: ['optics.configure'], sig: 'optics.configure({ rays, from, axis, flip, dG, dC })', returns: 'the setup as it is after',
              text: 'Change the setup without running. `rays`: 1 to 50 million. `from`: what feeds the far field -- \'escaped\' (the rays leaving the scene) or a detector material by its name (the rays reaching it; a closed scene needs one). '
                  + '`axis`: γ = 0, the photometric axis -- a light by its name (its +z) or its number in `axisOptions`, or a direction [x, y, z]; `flip`: its −z instead. '
                  + '`dG`: the γ step, one of 0.25, 0.5, 1, 2, 2.5, 5 degrees; `dC`: the C step, one of 1, 2.5, 5, 10, 15, 22.5, 30, 45, 90. A finer grid has smaller bins, each with fewer rays and more noise.' },
            { names: ['optics.setup'], sig: 'optics.setup()', returns: '{ rays, from, axis, flip, dG, dC, fromOptions, axisOptions, dGOptions, dCOptions }', text: 'The setup now, and the choices this scene offers: its detector materials (fromOptions) and its lights (axisOptions).',
              example: 'log(optics.setup().fromOptions)' },
            { names: ['optics.last'], sig: 'optics.last()', text: 'The pane\'s last analysis -- a click\'s or a script\'s -- or null.' },
        ],
    },
    {
        title: 'The analysis: what it found', id: 'result',
        intro: 'Fluxes are in lm (or W for a ray file given in watts). A number with an error is `{ value, se }`; `se` is null after one batch.',
        items: [
            { names: ['a.rays', 'a.batches', 'a.at', 'a.unit'], sig: 'a.rays  a.batches  a.at  a.unit', text: 'How many rays, in how many batches, when, and the flux unit.' },
            { names: ['a.stale'], sig: 'a.stale', text: 'True when the scene has changed since the run: its numbers are of a scene that is no longer there.' },
            { names: ['a.note'], sig: 'a.note', text: 'What the run could not trace (a haze box), or \'\'.' },
            { names: ['a.totals'], sig: 'a.totals', returns: '{ emitted, escaped, lost, absorbed, detected, volume }, each { value, se }',
              text: 'Every lumen booked. escaped: left the scene. absorbed: taken by surfaces (and the media between them, `volume`). detected: caught by detectors. lost: ended by a limit -- the maximum distance, the march steps or the bounces. Together they are what was emitted.',
              example: "const t = a.totals\nlog(`escaped ${t.escaped.value.toFixed(1)} ± ${t.escaped.se?.toFixed(1)} of ${t.emitted.value.toFixed(1)} lm`)" },
            { names: ['a.efficiency'], sig: 'a.efficiency', text: 'escaped / emitted: what leaves the scene. (The far field\'s own share is `a.stats().efficiency`.)' },
            { names: ['a.objects', 'a.object'], sig: 'a.objects  a.object(name)', returns: '{ tag, name, incident, absorbed, hits }', text: 'What each object received and absorbed, by its name in the tree; `a.object(\'lens\')` one by name or tag.',
              example: "const lens = a.object('lens')\nlog('lens absorbs', lens.absorbed.value, 'of', lens.incident.value, 'lm')" },
            { names: ['a.materials'], sig: 'a.materials', returns: '{ index, name, incident, absorbed, hits }', text: 'The same per material.' },
        ],
    },
    {
        title: 'The analysis: the far field', id: 'far',
        intro: 'The far field is the light as seen from far away: luminous intensity I (cd) in each direction, on a type C grid -- γ the angle from the photometric axis (0 to 180), '
            + 'C the angle about it (0 to 360, from the light\'s +x). A ray counts by its direction only. These functions read it as the Polar and I–γ charts do. '
            + 'Each takes `{ symmetry: \'rotational\' }` to pool every C plane (a round beam: far less noise) and `{ perKlm: true }` for cd per 1000 lm emitted. '
            + 'They are errors when the run had no far field (`a.hasFarField`).',
        items: [
            { names: ['a.hasFarField', 'a.far'], sig: 'a.hasFarField  a.far', text: 'Whether there is one, and its raw grid: { nC, nG, axis, c0, flux (per bin, lm), se, emitted, ... }.' },
            { names: ['a.peak'], sig: 'a.peak({ symmetry, perKlm })', returns: '{ I, se, gamma, C }', text: 'The brightest direction: I max and where.',
              example: "const pk = a.peak({ symmetry: 'rotational' })\nlog(`I max ${pk.I.toFixed(0)} ± ${pk.se?.toFixed(0)} cd at γ ${pk.gamma}°`)" },
            { names: ['a.intensityAt'], sig: 'a.intensityAt(gamma, C, opts)', returns: '{ I, se }', text: 'I in one direction, interpolated between bins.' },
            { names: ['a.beam'], sig: 'a.beam(C, opts)', returns: '{ C, peak, beam: { minus, plus, width }, field: { minus, plus, width } }',
              text: 'The beam angle (where I falls to 50 % of I max) and field angle (10 %) in the plane through C and C + 180: each side on its own (`minus` towards C + 180, `plus` towards C) and the full `width`, in degrees. null where the curve never falls that far.',
              example: "const b = a.beam(0)\nlog('beam', b.beam?.width?.toFixed(1), '° field', b.field?.width?.toFixed(1), '°')" },
            { names: ['a.stats'], sig: 'a.stats({ planes, symmetry, perKlm })', returns: '{ max, planes: [a.beam(C) per plane], flux, emitted, efficiency, zones: [{ from, to, flux }] }',
              text: 'What a datasheet gives, at once: I max; each plane\'s beam and field angles (planes default [0, 90]); the flux in the far field and its share of what was emitted; the zonal flux in 0–30, 0–60, 0–90 and 90–180°.' },
            { names: ['a.fluxWithin'], sig: 'a.fluxWithin(angle)', text: 'The flux in lm within a cone of `angle` degrees about the axis -- the share of a bin the cone cuts counted by its solid angle.',
              example: "log('within 10°:', (100 * a.fluxWithin(10) / a.totals.emitted.value).toFixed(1), '% of the light')" },
            { names: ['a.fluxBetween'], sig: 'a.fluxBetween(from, to)', text: 'The flux between two angles from the axis: a ring of directions.' },
            { names: ['a.farFlux'], sig: 'a.farFlux', text: 'All the flux the far field holds, lm.' },
            { names: ['a.curve'], sig: 'a.curve(C, opts)', returns: '[{ a, I, se }]', text: 'The plane through C and C + 180 as the polar chart draws it: `a` the signed angle (−180 to 180; minus is the C + 180 half).',
              example: "files.save('curve.csv', [['gamma', 'I (cd)'], ...a.curve(0).map(p => [p.a, p.I])])" },
            { names: ['a.intensity'], sig: 'a.intensity(opts)', returns: '{ nC, nG, dC, dG, I, se, unit }', text: 'The whole intensity grid: I[j * nC + i] at γ = j·dG, C = i·dC.' },
            { names: ['a.intensityCSV'], sig: 'a.intensityCSV(opts)', text: 'The grid as CSV text, a row per γ and a column per C, as the pane saves it.', example: "files.save('intensity.csv', a.intensityCSV())" },
            { names: ['a.plane'], sig: 'a.plane({ h, half, cells, symmetry })', returns: 'a map, m', text: 'The far field on a plane `h` metres along the axis, square to it, `half` metres each way (0: wide enough for the beam): E = I cos³γ / h². Exact for a point source, off by about the luminaire\'s size over h.' },
        ],
    },
    {
        title: 'The analysis: detectors and maps', id: 'maps',
        intro: 'A detector is an object with a detector (or limiter) material: rays stop on it and are recorded where they land. A map is those hits as illuminance '
            + '(lx; W/m² for watts) on square cells over a plane fitted to them -- a flat detector\'s own plane, laid out along the world\'s axes when it is square to one. '
            + 'A cell\'s noise is about 1 / √(its hits): with few hits a fine map is noise, so use fewer cells or smoothing. At most 500 000 hits are kept for maps.',
        items: [
            { names: ['a.detectors'], sig: 'a.detectors()', returns: '[{ tag, name, hits }]', text: 'Every detector hit, by its object\'s name.' },
            { names: ['a.hits'], sig: 'a.hits(detector)', returns: '[{ pos, dir, flux, tag, xyz }]', text: 'One detector\'s hits: where (scene unit), from which direction, each one\'s flux, its colour as XYZ.' },
            { names: ['a.map'], sig: 'a.map(detector, { cells, smooth, bandwidth, k, area })', returns: 'a map, m',
              text: 'A detector\'s map, by its name or tag (the first detector hit when not given). `cells` across (64). `smooth`: \'none\', \'gauss\' or \'epan\' (a kernel `bandwidth` cells wide; both keep the flux exactly) or \'knn\' (the `k` nearest hits: sharp where hits are dense). `area`: \'detector\' (its whole measured box) or \'lit\' (where light landed).',
              example: "const m = a.map('screen', { cells: 32, smooth: 'gauss' })\nlog(`E max ${m.max.toFixed(0)} lx, mean ${m.meanLit.toFixed(0)}, U0 ${m.uniformity?.toFixed(2)}`)" },
            { names: ['m.max', 'm.meanLit', 'm.minLit', 'm.uniformity', 'm.Ud'], sig: 'm.max  m.meanLit  m.minLit  m.uniformity  m.Ud',
              text: 'The illuminance: the brightest cell, the mean and least over the lit cells (those any hit landed in), U0 = min / mean, Ud = min / max.' },
            { names: ['m.total', 'm.litArea', 'm.litCells'], sig: 'm.total  m.litArea  m.litCells', text: 'The flux the map holds (lm), the lit area (m²) and how many cells are lit.' },
            { names: ['m.relNoise', 'm.hitsPerLitCell', 'm.flatness'], sig: 'm.relNoise  m.hitsPerLitCell  m.flatness',
              text: 'How far to trust it: a lit cell\'s relative noise (0.1 is ±10 %), hits per lit cell, and how far the detector is from flat (rms, over its size: above 0.01 the map is a projection).' },
            { names: ['m.colour'], sig: 'm.colour', returns: '{ x, y, u, v, cct, duv, cctInRange, dUpVpMax, dUpVpRms } or null', text: 'The colour of all the light that arrived, and its uniformity: the largest and rms Δu′v′ of a cell from it, over the cells at 10 % of the peak or more.' },
            { names: ['m.E', 'm.nx', 'm.ny', 'm.cell', 'm.range', 'm.unit', 'm.lengthUnit', 'm.axisNames', 'm.name', 'm.raw'], sig: 'm.E  m.nx  m.ny  m.cell  m.range  m.axisNames',
              text: 'The cells: E[y * nx + x] (row 0 at the low edge), `cell` wide in `lengthUnit`, covering `range` { a: [lo, hi], b: [lo, hi] }, the axes named (x and y for a floor). `name` the detector, `raw` everything the map knows.' },
            { names: ['m.at'], sig: 'm.at(a, b)', returns: '{ E, se }', text: 'E at a point in the map\'s coordinates, or null off it.' },
            { names: ['m.peak', 'm.centroid'], sig: 'm.peak()  m.centroid()', returns: '[a, b]', text: 'Where the brightest cell is, and the flux-weighted centre.' },
            { names: ['m.profile'], sig: 'm.profile(axis, at)', returns: '[{ x, y, se }]', text: 'E along \'a\' or \'b\' through a point: \'peak\' (default), \'centroid\' or [a, b] -- a row of cells, as the Profiles chart.' },
            { names: ['m.radial'], sig: 'm.radial(at)', returns: '[{ x, y, se, cells, full }]', text: 'E averaged over rings a cell wide about a point (the Rings chart); `full` is false once a ring reaches past the map.' },
            { names: ['m.encircled'], sig: 'm.encircled(at)', returns: '{ points, total, r50, r90 }', text: 'The share of the flux within each radius of a point (the Encircled flux chart): r50 and r90 hold half and nine tenths of it -- how tight a spot is.',
              example: "const e = a.map('screen').encircled()\nlog('r50', e.r50, 'r90', e.r90, a.map('screen').lengthUnit)" },
            { names: ['m.isolux'], sig: 'm.isolux([levels])', returns: '[{ level, segs: [[a0, b0, a1, b1]] }]', text: 'Isolux lines at those illuminances, as line segments.' },
        ],
    },
    {
        title: 'Files, output and waiting', id: 'files',
        items: [
            { names: ['log', 'warn'], sig: 'log(...)  warn(...)', text: 'A line under the editor; numbers to 6 figures, lists and objects written out.' },
            { names: ['files.save'], sig: 'files.save(name, data)', returns: '{ name, bytes }', text: 'Download: a list of rows (lists or objects) as CSV, text as text, anything else as JSON, a Blob as it is. The browser may ask once whether this page may download several files.',
              example: "files.save('results.csv', [{ radius: 2, I: 410 }, { radius: 2.5, I: 455 }])" },
            { names: ['files.csv'], sig: 'files.csv(rows)', text: 'Rows as CSV text, without saving.' },
            { names: ['progress'], sig: 'progress(done, total, label)', text: 'A bar in the status bar; `progress(null)` takes it away.' },
            { names: ['sleep', 'frame'], sig: 'await sleep(ms)  await frame()', text: 'Wait a time, or one frame of the picture. A long calculation that never waits holds the page, and Stop cannot be pressed: put an `await sleep(0)` in it.' },
            { names: ['check', 'signal'], sig: 'check()  signal', text: '`check()` ends the script if Stop was pressed; `signal` is the run\'s AbortSignal, for a `fetch` of your own.' },
        ],
    },
    {
        title: 'Recipes', id: 'recipes', items: [
            { names: [], sig: 'A sweep: one setting against two numbers', text: 'Each value an analysis, every number with its error, into a CSV.',
              example: "const r = param('scene/n4/radius')            // drag your own setting in\nconst rows = []\nfor (const v of [2, 2.5, 3, 3.5, 4]) {\n    r.value = v\n    if (r.info.kind === 'structural') await settled()\n    const a = await optics.run({ rays: 5e5 })\n    const pk = a.peak({ symmetry: 'rotational' })\n    rows.push({ radius: v, Imax: pk.I, se: pk.se, within10: a.fluxWithin(10) })\n    log(v, pk.I.toFixed(0), '±', pk.se?.toFixed(0))\n}\nfiles.save('sweep.csv', rows)" },
            { names: [], sig: 'Uniformity on a screen', text: 'A detector\'s U0 and Ud, with how noisy the map is.',
              example: "const a = await optics.run({ rays: 2e6 })\nconst m = a.map(a.detectors()[0]?.name, { cells: 24, smooth: 'gauss' })\nlog(m.name, 'U0', m.uniformity?.toFixed(3), 'Ud', m.Ud?.toFixed(3), `±${(100 * m.relNoise).toFixed(0)} % a cell`)" },
            { names: [], sig: 'Is B better than A?', text: 'Compare with the errors: a difference smaller than about twice its error is noise.',
              example: "const p = param('scene/n4/radius')\nconst merit = async v => { p.value = v; const a = await optics.run({ rays: 1e6 }); return a.peak() }\nconst A = await merit(2), B = await merit(3)\nconst d = B.I - A.I, e = Math.hypot(A.se ?? 0, B.se ?? 0)\nlog(`B - A = ${d.toFixed(0)} ± ${e.toFixed(0)} cd: ${Math.abs(d) > 2 * e ? 'a real difference' : 'within the noise'}`)" },
        ],
    },
]

/** Every name the reference documents (the test holds them to the API's). */
export const documentedNames = () => new Set(SCRIPT_REF.flatMap(s => s.items.flatMap(i => i.names)))

/** The reference as a help page in markdown (help/reference.mjs writes it to help/reference/script.md). */
export function referenceMarkdown() {
    let md = '# Script functions\n\n> Made by `help/reference.mjs` from `tools/scriptref.js`, which the Script panel\'s Reference pane shows too: edit that, not this page.\n\n'
        + 'What a scene\'s [script](../modelling/scripts.md) can call. The same text is in the Script panel: its **?** button.\n\n'
    for (const s of SCRIPT_REF) {
        md += `## ${s.title}\n\n`
        if (s.intro) md += `${s.intro}\n\n`
        for (const i of s.items) {
            md += `### \`${i.sig}\`\n\n${i.text}\n\n`
            if (i.returns) md += `Gives: ${i.returns}\n\n`
            if (i.example) md += '```\n' + i.example + '\n```\n\n'
        }
    }
    return md
}
