// node scenes/make.mjs
//
// THE EXAMPLES, MADE IN CODE (the user, 2026-10-10: "replace all example scenes. think of a useful list of examples;
// maybe even grouped in subcategories. SDF's may be new to people and I want to be able to demonstrate all the
// features. consider correct dimensions"). Each example is a function here that builds its scene through the model's
// own API (builder/model.js) -- the calls the tree and the panel make -- and this script writes it to scenes/<file>,
// in the scene format, with the menu's list beside it (examples.js: group, audience, description).
//
// EACH FILE IS WHOLE (0.63.0; the user, 2026-10-17: "switching between scenes almost always causes the camera and
// exposure to be wrong", and "review every single example scene to make sure camera, exposure etc. are set correctly
// there"): its view -- the camera it opens with, every setting of it, and its exposure (model.js VIEW) -- and its
// environment with every setting, each the default where the example says nothing. The camera was in examples.js,
// with no field of view, projection or lens, and the environment named three settings: each of those was whatever the
// scene shown before had left, so Depth of field's open lens blurred the next example opened.
//
// WHY A SCRIPT AND NOT SCENES SAVED FROM THE PAGE: the sizes are the point. A wine glass is 210 mm tall and its wall
// 1.5 mm thick, a die 16 mm, a room 4 x 3 x 2.6 m, an LED die 1 mm; written here as numbers with their reasons, they
// can be read, checked and changed, and the file made again. A scene saved from the page has the numbers and none of
// the reasons. An example improved in the page can still be saved over its file -- this script then no longer makes
// it, which its entry in EXAMPLES says by `made: false`.
//
// WHAT NOBODY HAS SEEN: these were written without a GPU (the container's cannot render). The geometry is reasoned,
// not looked at; the user is the judge of every picture, and the camera each one opens with is a first guess.
//
// LIGHT IN REAL UNITS: the sun is 100 000 lx and the sky 15 000 (the renderer's defaults); a studio's light is lx
// on the horizontal; a lamp's flux is lumens. What the picture shows is metered by the view's exposure.
//======================================================================================================================
import { writeFileSync, readFileSync } from 'node:fs'
import * as M from '../builder/model.js'
import { modifierGroup } from '../builder/modifiers.js'
import { rotationTowards } from '../builder/lights.js'
import { COAT_PRESETS } from '../builder/materials.js'

const here = new URL('./', import.meta.url)
const LIB = JSON.parse(readFileSync(new URL('../library/items/materials.json', import.meta.url), 'utf8')).items

//----------------------------------------------------------------------------------------------------------------------
// HELPERS: a scene, a material from the library, a shape, a light, a camera
//----------------------------------------------------------------------------------------------------------------------
const T = (at = [0, 0, 0], rot = [0, 0, 0], scale = 1) => ({ pos: { x: at[0], y: at[1], z: at[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] }, scale })
const V = (x, y, z) => ({ x, y, z })
const RGB = (r, g, b) => ({ r, g, b })

/** A scene: title, unit, how far it reaches (its radius, in its unit), and its environment -- whole: every setting the
 *  example does not name at its default, so nothing of the scene shown before it is left in it (model.js environmentOf). */
function scene(title, { unit = 'mm', radius, env = {} }) {
    const doc = M.createDoc({ title })
    doc.unit = unit
    M.setEnvRadius(doc, radius)
    M.setEnvironment(doc, { ...Object.fromEntries(Object.entries(M.ENVIRONMENT).map(([k, sp]) => [k, structuredClone(sp.def)])), ...env })
    doc.$mats = new Map()
    return doc
}
/* THE SUN'S AZIMUTH is a compass bearing: from +y towards +x (lib/pathtracer/core/sdf.js sunDirection), where the
   camera's below counts from +x towards +y. -140 puts the sun over the left shoulder of a camera on the -y side. */
const SUN = (elevation = 40, azimuth = -140) => ({ envMode: 0, uSunElevation: elevation, uSunAzimuth: azimuth })
const STUDIO = (lx = 500, top = 0.6) => ({ envMode: 1, studioIlluminance: lx, studioTop: top })

/** A library material by its name (library/items/materials.json), put in once per scene; its id. */
function lib(doc, name) {
    if (doc.$mats.has(name)) return doc.$mats.get(name)
    const item = LIB.find(i => i.name === name)
    if (!item) throw new Error(`no library material '${name}'`)
    const m = M.insertAsset(doc, item.asset)
    doc.$mats.set(name, m.id)
    return m.id
}
/** A material of the scene's own: a preset's fields with `params` over them. */
function own(doc, label, preset, params = {}, type) {
    const m = M.addMaterial(doc, { label, preset, params: { ...M.addMaterial(M.createDoc(), { preset }).params, ...params }, type })
    return m.id
}
/** A shape: a primitive with its parameters, at a place. */
const shape = (doc, parent, primitive, { at, rot, scale, ...o } = {}) =>
    M.addObject(doc, parent, { primitive, transform: T(at, rot, scale), ...o })
/** A group, optionally a modifier's (modifiers.js) with its parameters over the modifier's. */
function group(doc, parent, label, { at, rot, scale, modifier, params, ...o } = {}) {
    const m = modifier ? modifierGroup(modifier) : null
    return M.addGroup(doc, parent, { label, transform: T(at, rot, scale), ...(m ? { ...m, label, params: { ...m.params, ...params } } : params ? { params } : {}), ...o })
}
/** A light facing along `towards` (default straight down, -z). */
const light = (doc, parent, shapeName, { at, towards = [0, 0, -1], ...o }) => {
    const r = rotationTowards(towards)
    return M.addLight(doc, parent, { shape: shapeName, transform: T(at, [r.x, r.y, r.z]), ...o })
}
/** The floor: the plane z = 0, solid below. */
const floor = (doc, material) => shape(doc, 'root', 'plane', { label: 'floor', material })
/** A camera orbiting `target`: azimuth from +x towards +y, `above` degrees above the horizon (the camera's own
 *  elevation counts from straight up, lib/camera.js), `distance` away, all in the scene's unit. `more`: the field of
 *  view, a lens -- whatever is not the page's start (model.js CAMERA_DEFAULTS: 40 degrees, perspective, a pinhole). */
const orbit = (target, azimuth, above, distance, more = {}) =>
    ({ mode: 'orbit', target, azimuth, elevation: 90 - above, distance, dimensions: distance, ...more })
/** THE VIEW AN EXAMPLE IS SAVED WITH: its camera and its exposure, each whole (the defaults where it says nothing) */
const viewOf = (camera, exposure = {}) => ({
    camera: { ...structuredClone(M.CAMERA_DEFAULTS), ...camera },
    exposure: { ...Object.fromEntries(Object.entries(M.VIEW_EXPOSURE).map(([k, sp]) => [k, sp.def])), ...exposure },
})

//----------------------------------------------------------------------------------------------------------------------
// MODELLING AND RENDERING -- for anyone; no optics assumed
//----------------------------------------------------------------------------------------------------------------------

/* FIRST STEPS: the smallest scene that shows what the program is -- shapes on a table in daylight, one of them glass,
   one blended into another. Light to compile: it is a first visit's scene (FIRST_VISIT). Tabletop sizes in mm. */
function firstSteps() {
    const doc = scene('First steps', { radius: 3000, env: SUN(35) })
    floor(doc, lib(doc, 'white'))
    shape(doc, 'root', 'sphere', { label: 'ball', params: { radius: 30 }, at: [-70, 0, 30], material: lib(doc, 'glossy red plastic') })
    shape(doc, 'root', 'box', { label: 'block', params: { size: V(25, 25, 25), rounding: 4 }, at: [0, 20, 25], rot: [0, 0, 20], material: lib(doc, 'wood') })
    shape(doc, 'root', 'cylinder', { label: 'glass cylinder', params: { radius: 22, height: 70 }, at: [70, -10, 35], material: lib(doc, 'clear glass') })
    // two shapes melted into one: a group's blend
    const g = group(doc, 'root', 'blended pair', { at: [0, -80, 0], blend: 12 })
    shape(doc, g.id, 'sphere', { params: { radius: 22 }, at: [-18, 0, 22], material: lib(doc, 'sky blue') })
    shape(doc, g.id, 'box', { params: { size: V(18, 18, 18), rounding: 2 }, at: [18, 0, 18], material: lib(doc, 'sky blue') })
    return { doc, camera: orbit([0, -20, 25], -60, 25, 330) }
}

/* THE SHAPE GALLERY: every closed-form primitive (primitives.js), in two rows, each about 50 mm across -- what each is
   called and how big it starts is what the + menu gives. On a matte white board, in daylight. */
function shapeGallery() {
    const doc = scene('Shape gallery', { radius: 3000, env: SUN(45) })
    floor(doc, lib(doc, 'white'))
    const m = [lib(doc, 'soft red'), lib(doc, 'sage green'), lib(doc, 'sky blue'), lib(doc, 'satin yellow plastic')]
    const P = 80
    const row1 = [
        ['sphere', { radius: 25 }, 25],
        ['box', { size: V(22, 22, 22), rounding: 3 }, 22],
        ['cylinder', { radius: 22, height: 50 }, 25],
        ['capsule', { radius: 15, height: 30 }, 30],
        ['torus', { ring: 20, tube: 7 }, 7],
        ['cone', { base: 25, top: 0, height: 50 }, 25],
        ['round cone', { bottom: 20, top: 10, height: 30 }, 20],
    ]
    const row2 = [
        ['pyramid', { base: { x: 50, y: 50 }, top: { x: 0, y: 0 }, height: 45 }, 22.5],
        ['prism', { sides: 6, radius: 25, height: 40 }, 20],
        ['octahedron', { size: 28 }, 28],
        ['capped torus', { ring: 20, tube: 6, angle: 270 }, 6],
        ['link', { span: 14, ring: 12, tube: 5 }, 5],
        ['tube', { outer: 22, inner: 17, height: 45 }, 22.5],
        ['dome', { radius: 25, height: 20 }, 0],
    ]
    for (const [r, row] of [[1, row1], [-1, row2]])
        row.forEach(([p, params, z], i) => shape(doc, 'root', p, { label: p, params, at: [(i - 3) * P, r * 50, z], material: m[(i + (r < 0)) % 4] }))
    return { doc, camera: orbit([0, -10, 15], -90, 35, 700) }
}

/* COMBINING SHAPES: a group's children joined -- union, subtract, intersect -- sharply and with a blend, a box and a
   sphere each time, left to right; and a die, made the way a die is: a cube's corners rounded by a sphere it is
   intersected with, its pips spheres subtracted. A die is 16 mm. */
function combining() {
    const doc = scene('Combining shapes', { radius: 3000, env: SUN(40) })
    floor(doc, lib(doc, 'white'))
    const mat = lib(doc, 'glossy blue plastic')
    const pair = (label, x, join, { blend = 0, joinBlend } = {}) => {
        const g = group(doc, 'root', label, { at: [x, 0, 0], blend })
        shape(doc, g.id, 'box', { params: { size: V(18, 18, 18), rounding: 1 }, at: [0, 0, 18], material: mat })
        shape(doc, g.id, 'sphere', { params: { radius: 20 }, at: [12, -12, 30], material: mat, join, joinBlend })
    }
    pair('union', -150, 'union')
    pair('union, blended 8 mm', -75, 'union', { blend: 8 })
    pair('subtract', 0, 'subtract')
    pair('subtract, blended 4 mm', 75, 'subtract', { blend: 4 })
    pair('intersect', 150, 'intersect')
    // THE DIE: 16 mm, corners rounded by intersecting the cube with a sphere 1.36 times its half size, pips 1.6 mm
    const die = group(doc, 'root', 'die (16 mm)', { at: [0, -70, 0], rot: [0, 0, 25] })
    const ivory = lib(doc, 'white'), h = 8
    shape(doc, die.id, 'box', { label: 'cube', params: { size: V(h, h, h), rounding: 0.6 }, at: [0, 0, h], material: ivory })
    shape(doc, die.id, 'sphere', { label: 'rounding sphere', params: { radius: h * 1.36 }, at: [0, 0, h], material: ivory, join: 'intersect' })
    const pip = (x, y, z) => shape(doc, die.id, 'sphere', { label: 'pip', params: { radius: 1.6 }, at: [x, y, z + h], material: lib(doc, 'charcoal'), join: 'subtract', joinBlend: 0.3 })
    const o = 4
    pip(0, 0, h)                                                   // 1 on top
    pip(-o, -h, o); pip(o, -h, -o)                                 // 2 on the front
    pip(h, -o, o); pip(h, 0, 0); pip(h, o, -o)                     // 3 on the right
    return { doc, camera: orbit([0, -25, 15], -70, 30, 420) }
}

/* MODIFIERS: a group that changes the space its children are drawn in (twist, bend, repeat, mirror) or the shape they
   make (round, shell, displace, relief) -- each on the plainest shape that shows it, 80 mm apart. */
function modifiers() {
    const doc = scene('Modifiers', { radius: 3000, env: SUN(40) })
    floor(doc, lib(doc, 'white'))
    const a = lib(doc, 'brushed aluminium'), r = lib(doc, 'soft red'), g = lib(doc, 'sage green'), b = lib(doc, 'sky blue')
    const P = 90
    // TWIST: a square column 80 mm tall, half a turn over its height -- rate in radians per mm
    const tw = group(doc, 'root', 'twist', { modifier: 'twist', params: { rate: Math.PI / 80, extent: 22 }, at: [-1.5 * P, 50, 0] })
    shape(doc, tw.id, 'box', { params: { size: V(14, 14, 40), rounding: 1 }, at: [0, 0, 40], material: a })
    // BEND: a bar 80 mm long curled at its ends, 0.4 rad over each half -- high enough that either way it curls clears the floor
    const be = group(doc, 'root', 'bend', { modifier: 'bend', params: { amount: 0.01, extent: 40 }, at: [-0.5 * P, 50, 25] })
    shape(doc, be.id, 'box', { params: { size: V(40, 8, 4), rounding: 1 }, material: r })
    // REPEAT: one sphere drawn 3 x 3 times, 20 mm apart, for the price of one
    const re = group(doc, 'root', 'repeat', { modifier: 'repeat', params: { spacing: V(20, 20, 20), count: V(1, 1, 0) }, at: [0.5 * P, 50, 7] })
    shape(doc, re.id, 'sphere', { params: { radius: 7 }, material: b })
    // MIRROR: half a shape, and its reflection across the group's x = 0
    const mi = group(doc, 'root', 'mirror', { modifier: 'mirror', at: [1.5 * P, 50, 0] })
    shape(doc, mi.id, 'torus', { params: { ring: 14, tube: 5 }, at: [16, 0, 25], rot: [90, 0, 30], material: g })
    // ROUND: a sharp box grown by 5 mm round every edge
    const ro = group(doc, 'root', 'round', { modifier: 'round', params: { radius: 5 }, at: [-1.5 * P, -50, 0] })
    shape(doc, ro.id, 'box', { params: { size: V(17, 17, 17), rounding: 0 }, at: [0, 0, 22], material: g })
    // SHELL: a sphere made a 2 mm skin, cut open by a box to show it is hollow
    const cut = group(doc, 'root', 'shell, cut open', { at: [-0.5 * P, -50, 0] })
    const sh = group(doc, cut.id, 'shell', { modifier: 'shell', params: { thickness: 2 } })
    shape(doc, sh.id, 'sphere', { params: { radius: 25 }, at: [0, 0, 25], material: r })
    shape(doc, cut.id, 'box', { label: 'cut', params: { size: V(20, 20, 20), rounding: 0 }, at: [-18, -18, 45], material: r, join: 'subtract' })
    // DISPLACE: a ripple 1 mm high, a wave every 12.5 mm
    const di = group(doc, 'root', 'displace', { modifier: 'displace', params: { amount: 1, frequency: 0.08 }, at: [0.5 * P, -50, 0] })
    shape(doc, di.id, 'sphere', { params: { radius: 25 }, at: [0, 0, 26], material: b })
    // NOISE RELIEF: bumps up to 1.5 mm, about 8 mm across
    const nr = group(doc, 'root', 'noise relief', { modifier: 'relief', params: { amount: 1.5, size: 8 }, at: [1.5 * P, -50, 0] })
    shape(doc, nr.id, 'sphere', { params: { radius: 25 }, at: [0, 0, 26.5], material: a })
    return { doc, camera: orbit([0, 0, 20], -75, 35, 520) }
}

/* FROM POINTS: shapes drawn as a list of points -- an outline extruded (a cookie cutter's star), an outline turned
   (a wine glass, 210 mm tall, its bowl's wall 1.5 mm), a tube along a path (a bent pipe) and a profile swept
   along one (a twisted bar). */
function fromPoints() {
    const doc = scene('From points', { radius: 3000, env: SUN(35) })
    floor(doc, lib(doc, 'white'))
    // A STAR, 80 mm across, 10 mm thick: five points out at 40 mm and five in at 17, the tips rounded 1.5 mm
    const star = []
    for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 17 : 40
        star.push([+(rr * Math.cos(a)).toFixed(3), +(rr * Math.sin(a)).toFixed(3), i % 2 ? 1 : 1.5])
    }
    shape(doc, 'root', 'extrusion', { label: 'star (extruded)', params: { outline: star, height: 10 }, at: [-130, 0, 5], rot: [0, 0, 10], material: lib(doc, 'glossy red plastic') })
    // A WINE GLASS, as (radius, z) turned about z: foot 75 mm across, stem 4 mm thick, bowl 84 mm across, 210 tall.
    // The outline goes up the outside and back down the inside, so the glass is 1.5 mm thick and the bowl is open.
    const glass = [[0, 0], [37.5, 0, 0.5], [37.5, 2, 0.8], [6, 5, 4], [2.2, 14], [2.2, 92, 3], [20, 104, 12], [42, 150, 25], [36, 210, 0.7],
        [34.5, 210, 0.7], [40.5, 150, 24], [18.5, 105.5, 11], [0, 102]]
    shape(doc, 'root', 'revolution', { label: 'wine glass (turned)', params: { outline: glass }, at: [-30, 30, 0], material: lib(doc, 'clear glass') })
    // A BENT PIPE: 8 mm across, along a path with its corners filleted 20 mm
    shape(doc, 'root', 'bent tube', { label: 'bent pipe (a tube along a path)', at: [70, 20, 0], material: lib(doc, 'copper'),
        params: { route: { path: [[-40, -40, 4], [40, -40, 4, 20], [40, 40, 4, 20], [40, 40, 70]] }, radius: 4, rounded: 1, rise: 70 } })
    // A TWISTED BAR: a 24 x 8 mm section swept along a bent path, a quarter turn along the first straight
    shape(doc, 'root', 'twisted bar', { label: 'twisted bar (a profile swept)', at: [150, -40, 0], material: lib(doc, 'brushed aluminium'),
        params: { route: { path: [[-60, 0, 6], [20, 0, 6, 25, 1, 1, 'turn'], [20, 50, 30, 0, 0.6, 0.6, 'turn']], live: true }, turn: 90,
                  section: [[-12, -4, 2], [12, -4, 2], [12, 4, 2], [-12, 4, 2]] } })
    return { doc, camera: orbit([10, 0, 60], -80, 25, 600) }
}

/* A PARAMETRIC PART: a heatsink whose fin count, pitch and height are the group's parameters (component parameters,
   bind.js) and whose fins are one fin drawn as an array -- change `fins` in its properties and the part follows. A
   40 mm-class aluminium heatsink, fins 1.5 mm thick. */
function parametric() {
    const doc = scene('Parametric part', { radius: 3000, env: STUDIO(600, 0.6) })
    floor(doc, lib(doc, 'white'))
    const al = lib(doc, 'anodised aluminium')
    const hs = group(doc, 'root', 'heatsink', { params: { fins: 9, pitch: 5, finHeight: 25, base: 4, depth: 40 } })
    const plate = shape(doc, hs.id, 'box', { label: 'base plate', params: { size: V(23, 20, 2), rounding: 0.5 }, at: [0, 0, 2], material: al })
    M.setBindings(doc, plate.id, 'size.x = fins * pitch / 2\nsize.y = depth / 2\nsize.z = base / 2\npos.z = base / 2')
    const fins = group(doc, hs.id, 'fins (an array)')
    M.setCopies(doc, fins.id, M.copiesRow(9, 5, 'x'))
    M.setBindings(doc, fins.id, 'copies.count = fins\ncopies.pitch = pitch\ncopies.along = x')
    const fin = shape(doc, fins.id, 'box', { label: 'fin', params: { size: V(0.75, 20, 12.5), rounding: 0.3 }, at: [0, 0, 16.5], material: al })
    M.setBindings(doc, fin.id, 'size.y = depth / 2\nsize.z = finHeight / 2\npos.z = base + finHeight / 2')
    M.resolveBindings(doc)
    return { doc, camera: orbit([0, 0, 12], -60, 30, 170) }
}

/* INFINITE DETAIL: what a distance function does that a mesh cannot -- a Menger sponge four levels deep (8000 cubes'
   worth of holes, one formula), and a forest of columns to the horizon, one column repeated 41 x 41 times for the
   price of one. In metres: the sponge is 3 m across. */
function infinite() {
    const doc = scene('Infinite detail', { unit: 'm', radius: 400, env: SUN(25, -100) })   // from the side
    floor(doc, lib(doc, 'concrete'))
    M.addObject(doc, 'root', { label: 'Menger sponge', material: lib(doc, 'marble'), transform: T([0, 0, 1.5]),
        code: '// A Menger sponge "size" across, "iterations" levels deep (iterations is a compile-time constant: the loop\n'
            + '// bound has to be known to the compiler). sdMenger\'s sponge is 2 across, so the point is scaled to it.\n'
            + 'let s = size * 0.5;\nC = add_new(C, sdMenger(p / s, iterations) * s, MATERIAL);',
        params: { size: 3, iterations: 4 }, constants: { iterations: 'u32' }, lengths: ['size'],
        ranges: { size: { min: 0.1, max: 20, step: 0.01 }, iterations: { min: 1, max: 6, step: 1 } } })
    /* The lattice is offset by half a spacing so no column stands in the sponge -- by moving the GROUP, not the
       column. Repeat folds space into one cell, half a spacing around the group's origin (modifiers.js); a column
       placed at (4, 4) in the group stood on that cell's corner, and every copy showed only the quarter of it inside
       its own cell (the user, 2026-10-10: "only parts of pillars are shown"). */
    const forest = group(doc, 'root', 'columns (repeat)', { modifier: 'repeat', params: { spacing: V(8, 8, 8), count: V(20, 20, 0) }, at: [4, 4, 0] })
    shape(doc, forest.id, 'cylinder', { label: 'column', params: { radius: 0.25, height: 6 }, at: [0, 0, 3], material: lib(doc, 'sandstone') })
    return { doc, camera: orbit([0, 0, 1.6], -50, 12, 9) }
}

/* MATERIAL BOARD: the library's materials, each on a 40 mm sphere, in four rows -- under a studio's even light and a
   soft key, so each shows its own colour and sheen. */
function materialBoard() {
    const doc = scene('Material board', { radius: 3000, env: STUDIO(400, 0.6) })
    floor(doc, lib(doc, 'charcoal'))
    const rows = [
        ['white', 'soft red', 'sage green', 'sky blue', 'glossy red plastic', 'satin yellow plastic', 'black plastic'],
        ['gold', 'copper', 'chrome', 'brushed aluminium', 'anodised aluminium', 'galvanised steel', 'rust'],
        ['clear glass', 'green tinted glass', 'frosted glass', 'polycarbonate', 'flint glass (F2)', 'PMMA (acrylic)', 'rubber'],
        ['marble', 'granite', 'terrazzo', 'wood', 'cork', 'concrete', 'carbon fibre'],
    ]
    rows.forEach((row, j) => row.forEach((name, i) =>
        shape(doc, 'root', 'sphere', { label: name, params: { radius: 20 }, at: [(i - 3) * 55, (1.5 - j) * 55, 20], material: lib(doc, name) })))
    light(doc, 'root', 'rectangle', { label: 'softbox', at: [-150, -200, 400], towards: [150, 200, -400], params: { width: 300, height: 200 }, luminance: 8000 })
    return { doc, camera: orbit([0, 0, 15], -90, 40, 620) }
}

/* RELIEF AND TEXTURE: a relief is part of the shape (its silhouette shows it), a texture only colours it. Six wall
   panels 120 mm square stand in a row, lit by a low sun that rakes across them, which is what shows a relief. */
function reliefTexture() {
    const doc = scene('Relief and texture', { radius: 3000, env: SUN(15, 110) })   // low, almost along the panels' faces
    floor(doc, lib(doc, 'charcoal'))
    const names = ['white plaster', 'knockdown stucco', 'sand-float render', 'rough stone', 'hammered metal', 'leather']
    names.forEach((n, i) => shape(doc, 'root', 'box', { label: `panel: ${n}`, params: { size: V(60, 8, 60), rounding: 1 },
        at: [(i - 2.5) * 135, 0, 60], material: lib(doc, n) }))
    // and paint whose orange peel shows only in what it reflects: a glossy sphere
    shape(doc, 'root', 'sphere', { label: 'orange-peel paint', params: { radius: 40 }, at: [0, -130, 40], material: lib(doc, 'orange-peel paint') })
    return { doc, camera: orbit([0, -40, 60], -90, 12, 950) }
}

/* GLASS AND LIQUID: a tumbler of water (glass 2 mm thick, water n 1.333 with its own dispersion), a green bottle whose
   colour deepens with thickness (the colour depth), and a flint prism splitting the sun into colours. */
function glassLiquid() {
    const doc = scene('Glass and liquid', { radius: 3000, env: SUN(30, 20) })   // behind the glass: its caustics fall towards the camera
    floor(doc, lib(doc, 'white'))
    // water: n_d 1.333, Abbe number 55.7 (typical figures for water at 20 C)
    const water = own(doc, 'water', 'glass', { ior: 1.333, abbe: 55.7, baseColor: RGB(0.92, 0.97, 1), attenuationDistance: 1000 })
    // a TUMBLER, 80 mm across and 100 tall: a tube with a 6 mm base, turned as one outline
    shape(doc, 'root', 'revolution', { label: 'tumbler', material: lib(doc, 'clear glass'), at: [-60, 0, 0],
        params: { outline: [[0, 0], [40, 0, 2], [40, 100, 0.9], [38, 100, 0.9], [38, 6, 2], [0, 6]] } })
    shape(doc, 'root', 'cylinder', { label: 'water', params: { radius: 37.99, height: 64 }, at: [-60, 0, 38], material: water })
    /* THE WATER IS 10 um INSIDE THE GLASS (37.99 against the tumbler's 38): a liquid against its glass. The automatic
       tolerance is 1e-4 of the scene's size, about 80 um here (the bottle and the floor's reach make it), eight times
       the gap -- a ray could not tell the water's surface from the glass's. 2 um is a fifth of the gap, and above the
       f32 floor there (about 1.7 um, 0.1 m from the origin: core/tolerances.js), which marchTol takes when it is
       larger. Reasoned, not seen: the water's edge is what to look at (CHANGELOG 0.63.0). */
    M.setTolerance(doc, 0.002)
    // a BOTTLE, 70 mm across and 230 tall, its wall 3 mm, the glass green through its body
    shape(doc, 'root', 'revolution', { label: 'bottle', material: lib(doc, 'green tinted glass'), at: [60, 40, 0],
        params: { outline: [[0, 0], [35, 0, 3], [35, 150, 25], [13, 195, 10], [13, 225, 1], [15, 230, 1], [12.5, 232], [10, 232], [10, 195, 8],
                            [32, 150, 22], [32, 3, 3], [0, 3]] } })
    // a PRISM of flint glass, 40 mm on a side, standing in the sun
    shape(doc, 'root', 'prism', { label: 'flint prism', params: { sides: 3, radius: 23, height: 60 }, at: [80, -70, 11.5], rot: [90, 0, 30], material: lib(doc, 'flint glass (F2)') })
    return { doc, camera: orbit([10, 0, 60], -110, 18, 520) }
}

/* LIGHTING A ROOM: a room 4 x 3 m and 2.6 m high, in metres, with a window 1.6 x 1.2 m in one wall and a lamp over
   the table -- daylight and a lamp together, each in real units: the sun through the window, the lamp's 1500 lm. */
function lighting() {
    const doc = scene('Lighting a room', { unit: 'm', radius: 200, env: SUN(30, 20) })   // on the window's side, +y
    floor(doc, lib(doc, 'wood'))
    const room = group(doc, 'root', 'room')
    shape(doc, room.id, 'box', { label: 'outside', params: { size: V(2.1, 1.6, 1.4), rounding: 0 }, at: [0, 0, 1.3], material: lib(doc, 'white plaster') })
    shape(doc, room.id, 'box', { label: 'inside', params: { size: V(2, 1.5, 1.3), rounding: 0 }, at: [0, 0, 1.3], material: lib(doc, 'white plaster'), join: 'subtract' })
    shape(doc, room.id, 'box', { label: 'window', params: { size: V(0.8, 0.2, 0.6), rounding: 0 }, at: [0, 1.55, 1.5], material: lib(doc, 'white plaster'), join: 'subtract' })
    // a table 1.6 x 0.9 m, 0.75 high; a bowl on it
    const t = group(doc, 'root', 'table', { at: [0, -0.2, 0] })
    shape(doc, t.id, 'box', { label: 'top', params: { size: V(0.8, 0.45, 0.02), rounding: 0.005 }, at: [0, 0, 0.73], material: lib(doc, 'wood') })
    for (const [x, y] of [[-0.72, -0.38], [0.72, -0.38], [-0.72, 0.38], [0.72, 0.38]])
        shape(doc, t.id, 'box', { label: 'leg', params: { size: V(0.03, 0.03, 0.355), rounding: 0.003 }, at: [x, y, 0.355], material: lib(doc, 'wood') })
    shape(doc, 'root', 'sphere', { label: 'ball', params: { radius: 0.12 }, at: [0.3, -0.2, 0.87], material: lib(doc, 'glossy red plastic') })
    light(doc, 'root', 'disc', { label: 'lamp (1500 lm)', at: [0, -0.2, 2.2], params: { radius: 0.2 }, flux: 1500, colourBy: 'cct', cct: 3000 })
    /* INSIDE, 11 cm from the back wall, at eye height. The field is 65 degrees (0.63.0): at the page's 40, 1.4 m from the
       target sees about 1 x 1.8 m -- the table and little of the room. A first guess still: the user judges. */
    return { doc, camera: { mode: 'orbit', target: [0, 0, 1], azimuth: -90, elevation: 85, distance: 1.4, dimensions: 4, fov: 65 } }
}

/* DEPTH OF FIELD: a row of chess pawns 30 mm across, 60 mm apart, going away from the camera; the camera's lens is
   open (aperture 8 mm) and focused on the third, so the ones before and after it blur. */
function depthOfField() {
    const doc = scene('Depth of field', { radius: 3000, env: SUN(35, -120) })
    floor(doc, lib(doc, 'checker'))
    const pawn = [[0, 0], [15, 0, 1], [15, 4, 1], [11, 7, 2], [6, 16, 4], [5, 30, 2], [9, 32, 1], [6.5, 34], [0, 34]]
    for (let i = 0; i < 6; i++) {
        shape(doc, 'root', 'revolution', { label: `pawn ${i + 1}`, params: { outline: pawn }, at: [0, i * 60, 0], material: lib(doc, i % 2 ? 'charcoal' : 'white') })
        shape(doc, 'root', 'sphere', { label: `head ${i + 1}`, params: { radius: 8 }, at: [0, i * 60, 41], material: lib(doc, i % 2 ? 'charcoal' : 'white') })
    }
    // the camera 150 mm in front of the first pawn: the third is 270 mm away
    return { doc, camera: { mode: 'orbit', target: [0, 120, 20], azimuth: -90, elevation: 80, distance: 270, dimensions: 300, aperture: 8, focus: 0 } }
}

/* ANIMATION: values marked as animated stay live in the baked scene, for the Timeline to move -- a twisted bar's turn
   and a spinning top's rotation here. Open View › Timeline, add tracks on them and play. */
function animation() {
    const doc = scene('Animation', { radius: 3000, env: SUN(40) })
    floor(doc, lib(doc, 'white'))
    const bar = shape(doc, 'root', 'twisted bar', { label: 'twisted bar', at: [-60, 0, 0], material: lib(doc, 'gold'),
        params: { route: { path: [[0, 0, 5], [0, 0, 80, 0, 1, 1, 'turn']], live: true }, turn: 180, section: [[-12, -4, 2], [12, -4, 2], [12, 4, 2], [-12, 4, 2]] } })
    M.setAnimated(doc, `scene/${bar.id}/turn`, true)
    const top = group(doc, 'root', 'spinning top', { at: [60, 0, 0] })
    shape(doc, top.id, 'cone', { label: 'body', params: { base: 25, top: 2, height: 30 }, at: [0, 0, 22], rot: [180, 0, 0], material: lib(doc, 'glossy red plastic') })
    shape(doc, top.id, 'cylinder', { label: 'stem', params: { radius: 3, height: 20 }, at: [0, 0, 45], material: lib(doc, 'wood') })
    M.setAnimated(doc, `scene/${top.id}/transform/rotation`, true)
    return { doc, camera: orbit([0, 0, 30], -70, 25, 300) }
}

/* A PRODUCT SHOT: a perfume bottle (tinted glass, a gold cap) on a white plaster plinth, in a studio's even light and
   one softbox -- the kind of picture the program is for. A 50 ml bottle, 80 mm tall. */
function productShot() {
    const doc = scene('Product shot', { radius: 3000, env: STUDIO(300, 0.7) })
    floor(doc, lib(doc, 'white'))
    shape(doc, 'root', 'box', { label: 'plinth', params: { size: V(70, 70, 30), rounding: 2 }, at: [0, 0, 30], material: lib(doc, 'white plaster') })
    const amber = own(doc, 'amber glass', 'glass', { ior: 1.52, abbe: 59, baseColor: RGB(0.95, 0.6, 0.25), attenuationDistance: 15 })
    shape(doc, 'root', 'box', { label: 'bottle', params: { size: V(28, 14, 32), rounding: 6 }, at: [0, 0, 92], material: amber })
    shape(doc, 'root', 'cylinder', { label: 'neck', params: { radius: 6, height: 8 }, at: [0, 0, 128], material: amber })
    shape(doc, 'root', 'box', { label: 'cap', params: { size: V(10, 10, 12), rounding: 2 }, at: [0, 0, 142], material: lib(doc, 'gold') })
    light(doc, 'root', 'rectangle', { label: 'softbox', at: [-250, -150, 350], towards: [250, 150, -250], params: { width: 400, height: 300 }, luminance: 6000 })
    return { doc, camera: orbit([0, 0, 95], -65, 12, 380) }
}

//----------------------------------------------------------------------------------------------------------------------
// OPTICAL DESIGN -- lights in lumens, detectors to read, the Analysis pane to run. All in mm but the luminaire.
//----------------------------------------------------------------------------------------------------------------------

const detector = (doc, label = 'detector') => own(doc, label, 'diffuse', { baseColor: RGB(0.8, 0.8, 0.8) }, 'detector')
const black = doc => own(doc, 'black', 'diffuse', { baseColor: RGB(0.02, 0.02, 0.02) })

/* LED, LENS, SCREEN: a 1 x 1 mm LED of 100 lm, a PMMA lens 25 mm across 30 mm above it, and a detector 200 mm away
   that the Analysis pane reads -- illuminance in lux, its map, its rings and profiles. A first optics bench. */
function ledLens() {
    const doc = scene('LED, lens and screen', { radius: 1000, env: STUDIO(5, 0.5) })
    M.setOpticsMaxDist(doc, 600)
    light(doc, 'root', 'rectangle', { label: 'LED (100 lm)', at: [0, 0, 0], towards: [0, 0, 1], params: { width: 1, height: 1 }, flux: 100, colourBy: 'cct', cct: 5000 })
    shape(doc, 'root', 'cylinder', { label: 'board', params: { radius: 15, height: 1.6 }, at: [0, 0, -0.8], material: black(doc) })
    // biconvex, both faces r 40 mm, 6 mm thick: f = 1 / ((n - 1)(2/40)) = 40.7 mm in PMMA (thin lens)
    shape(doc, 'root', 'lens', { label: 'PMMA lens', params: { diameter: 25, thickness: 6, r1: 40, r2: 40 }, at: [0, 0, 45], material: lib(doc, 'PMMA (acrylic)') })
    shape(doc, 'root', 'rectangle', { label: 'screen (detector)', params: { width: 150, height: 150 }, at: [0, 0, 250], material: detector(doc, 'screen') })
    return { doc, camera: orbit([0, 0, 120], -60, 15, 450) }
}

/* A BEAM IN DUSTY AIR (0.62.0): the first optics bench's LED and PMMA lens, turned to shine along +x, inside a haze box
   -- dust in the air (builder/hazebox.js; the renderer's lib/pathtracer/core/haze.js). The beam shows where the dust
   scatters it towards the camera, brightest looking into it (g 0.7, as real dust and haze scatter forward), and dims
   along its length; a PMMA block in the beam stays clear inside (only the air in the box scatters), and the spot on the
   screen beyond is dimmer for the dust it crossed. A dim room, so the beam is what the eye finds.
   THE DUST IS DENSE: a mean free path of 0.3 m, thick smoke or a stage's haze (a rough figure). A beam a couple of
   centimetres across, seen from the side in thin dust (a mean free path of 10 m), is thousands of times dimmer than the
   spot it lights (the help's scale note); here about a two-hundredth (inferred, the same arithmetic), and still about 200
   times the dim room's walls (inferred). Not seen yet. */
function dustyBeam() {
    const doc = scene('Beam in dusty air', { radius: 2000, env: STUDIO(2, 0.5) })
    M.setOpticsMaxDist(doc, 1200)
    floor(doc, own(doc, 'grey', 'diffuse', { baseColor: RGB(0.3, 0.3, 0.3) }))
    light(doc, 'root', 'rectangle', { label: 'LED (100 lm)', at: [-250, 0, 100], towards: [1, 0, 0], params: { width: 1, height: 1 }, flux: 100, colourBy: 'cct', cct: 5000 })
    // the bench's lens (biconvex, r 40 mm both faces, f 40.7 mm), 45 mm in front of the LED: the beam converges slowly
    shape(doc, 'root', 'lens', { label: 'PMMA lens', params: { diameter: 25, thickness: 6, r1: 40, r2: 40 }, at: [-205, 0, 100], rot: [0, 90, 0], material: lib(doc, 'PMMA (acrylic)') })
    shape(doc, 'root', 'box', { label: 'PMMA block (clear inside)', params: { size: V(40, 60, 60), rounding: 1 }, at: [0, 0, 100], material: lib(doc, 'PMMA (acrylic)') })
    shape(doc, 'root', 'rectangle', { label: 'screen', params: { width: 160, height: 160 }, at: [230, 0, 100], rot: [0, 90, 0], material: lib(doc, 'white') })
    M.addHazeBox(doc, 'root', { label: 'dust', size: V(560, 220, 200), transform: T([-10, 0, 100]), mfp: 0.3, g: 0.7 })
    return { doc, camera: orbit([0, 0, 100], -55, 15, 750) }
}

/* AN ASPHERIC CONDENSER: one aspheric surface collimates a point at its focus exactly -- the primitive's own design
   (shapes.js: a light on the axis one diameter beyond the curved face's vertex comes out parallel in glass of n 1.5),
   made 30 mm across. A small LED at the focus, a detector 300 mm on: the spot stays about the lens's size. */
function aspheric() {
    const doc = scene('Aspheric condenser', { radius: 1500, env: STUDIO(5, 0.5) })
    M.setOpticsMaxDist(doc, 800)
    const glass = own(doc, 'glass n 1.50', 'glass', { ior: 1.5 })
    const s = 30
    // the primitive's starting shape, scaled 30 times: diameter 30, focus 30 mm from the curved face's vertex
    shape(doc, 'root', 'aspheric lens', { label: 'aspheric condenser', at: [0, 0, 0], rot: [180, 0, 0], scale: s, material: glass })
    light(doc, 'root', 'disc', { label: 'LED (50 lm)', at: [0, 0, -(s + 0.15 * s)], towards: [0, 0, 1], params: { radius: 0.5 }, flux: 50, colourBy: 'cct', cct: 5000 })
    shape(doc, 'root', 'rectangle', { label: 'screen (detector)', params: { width: 120, height: 120 }, at: [0, 0, 300], material: detector(doc, 'screen') })
    return { doc, camera: orbit([0, 0, 100], -60, 15, 500) }
}

/* FRESNEL OR PLANO-CONVEX: the same focal length, 60 mm, made two ways -- a plano-convex lens 40 mm across (r 29.4 mm
   in PMMA, 9 mm thick) and a Fresnel lens (the primitive's six rings, scaled to 40 mm), each over its own LED at the
   focus and its own detector. Compare their spots in the Analysis pane. */
function fresnel() {
    const doc = scene('Fresnel or plano-convex', { radius: 1500, env: STUDIO(5, 0.5) })
    M.setOpticsMaxDist(doc, 800)
    const pmma = lib(doc, 'PMMA (acrylic)'), scr = detector(doc, 'screen')
    // plano-convex: r1 = f (n - 1) = 60 x 0.491 = 29.5 mm, the flat face down
    shape(doc, 'root', 'lens', { label: 'plano-convex', params: { diameter: 40, thickness: 9, r1: 29.5, r2: 0 }, at: [-50, 0, 64.5], material: pmma })
    // its front focal point is f - t / n = 60 - 9 / 1.491 = 54 mm before the flat face, which is at z = 60
    light(doc, 'root', 'rectangle', { label: 'LED A (50 lm)', at: [-50, 0, 6], towards: [0, 0, 1], params: { width: 1, height: 1 }, flux: 50, colourBy: 'cct', cct: 5000 })
    shape(doc, 'root', 'rectangle', { label: 'screen A', params: { width: 90, height: 90 }, at: [-50, 0, 350], material: scr })
    // the Fresnel: its outline is focal length 1.5 in n 1.49 at diameter 1; scaled 40 times, f = 60 mm, flat back down
    shape(doc, 'root', 'fresnel lens', { label: 'Fresnel', at: [50, 0, 60], scale: 40, material: pmma })
    light(doc, 'root', 'rectangle', { label: 'LED B (50 lm)', at: [50, 0, 0], towards: [0, 0, 1], params: { width: 1, height: 1 }, flux: 50, colourBy: 'cct', cct: 5000 })
    shape(doc, 'root', 'rectangle', { label: 'screen B', params: { width: 90, height: 90 }, at: [50, 0, 350], material: scr })
    return { doc, camera: orbit([0, 0, 150], -70, 15, 600) }
}

/* A PARABOLIC REFLECTOR: a torch's -- a paraboloid of focal length 8 mm, 50 mm across, an LED at its focus facing into
   it. What leaves is nearly parallel: the Analysis pane's far field shows the beam, its intensity in cd and its angle. */
function reflector() {
    const doc = scene('Parabolic reflector', { radius: 3000, env: STUDIO(5, 0.5) })
    M.setOpticsMaxDist(doc, 2500)
    const mirror = own(doc, 'aluminium mirror', 'mirror', { baseColor: RGB(0.91, 0.92, 0.92) })
    shape(doc, 'root', 'reflector', { label: 'reflector', params: { focal: 8, aperture: 25, wall: 1 }, material: mirror })
    light(doc, 'root', 'rectangle', { label: 'LED (200 lm)', at: [0, 0, 0], towards: [0, 0, -1], params: { width: 1, height: 1 }, flux: 200, colourBy: 'cct', cct: 6000 })
    shape(doc, 'root', 'rectangle', { label: 'wall 2 m away (detector)', params: { width: 1200, height: 1200 }, at: [0, 0, 2000], material: detector(doc, 'wall') })
    /* THE TOLERANCE OF THE REFLECTOR, NOT OF THE WALL (0.63.0): the automatic one is 1e-4 of the scene's size, and the
       wall 2 m away makes that 4.7 m -- 0.47 mm, against a 1 mm wall, a 1 mm LED and a focal length of 8. The optics
       trace's far field is marched with it too (its own eps 0 follows the scene's). 5 um is 1e-4 of the 50 mm reflector;
       at the wall the f32 floor, 30 um at 2 m, takes over by itself (core/tolerances.js marchTol). Reasoned, not
       measured: the far field's beam angle before and after is the test (CHANGELOG 0.63.0). */
    M.setTolerance(doc, 0.005)
    return { doc, camera: orbit([0, 0, 10], -60, 25, 160) }
}

/* A LIGHT GUIDE: an LED's light carried 120 mm round two bends in a PMMA bar 8 x 4 mm, by total internal reflection,
   to a detector at its far end -- how much arrives, and where it is lost (the Analysis pane's totals). */
function lightGuide() {
    const doc = scene('Light guide', { radius: 1000, env: STUDIO(5, 0.5) })
    M.setOpticsMaxDist(doc, 400)
    shape(doc, 'root', 'light guide', { label: 'light guide', material: lib(doc, 'PMMA (acrylic)'),
        params: { route: { path: [[-60, 0, 0], [-10, 0, 0, 15], [20, 30, 0, 15], [20, 30, 50]] }, section: [[-4, -2, 0.5], [4, -2, 0.5], [4, 2, 0.5], [-4, 2, 0.5]] } })
    light(doc, 'root', 'rectangle', { label: 'LED (20 lm)', at: [-60.5, 0, 0], towards: [1, 0, 0], params: { width: 1, height: 1 }, flux: 20, colourBy: 'cct', cct: 5000 })
    shape(doc, 'root', 'rectangle', { label: 'exit (detector)', params: { width: 20, height: 20 }, at: [20, 30, 52], material: detector(doc) })
    return { doc, camera: orbit([-10, 15, 20], -50, 35, 220) }
}

/* COLOUR MIXING: red, green, blue and white LEDs side by side (each 1 x 1 mm, colours as chromaticities and a CCT),
   a square PMMA mixing rod 6 mm across and 40 long to blend them, and a detector: the Analysis pane's colour map shows
   how even the mix is. Analysis › Colour mixing sets their fluxes for a target colour. */
function rgbw() {
    const doc = scene('RGBW colour mixing', { radius: 1000, env: STUDIO(5, 0.5) })
    M.setOpticsMaxDist(doc, 400)
    const g = group(doc, 'root', 'RGBW LED')
    const led = (label, x, y, o) => light(doc, g.id, 'rectangle', { label, at: [x, y, 0], towards: [0, 0, 1], params: { width: 1, height: 1 }, ...o })
    // typical saturated LED chromaticities (CIE 1931 xy) and fluxes for a white-ish mix
    led('red (630 nm)', -0.7, -0.7, { colourBy: 'xy', xy: { x: 0.700, y: 0.299 }, flux: 25 })
    led('green (525 nm)', 0.7, -0.7, { colourBy: 'xy', xy: { x: 0.170, y: 0.700 }, flux: 60 })
    led('blue (460 nm)', -0.7, 0.7, { colourBy: 'xy', xy: { x: 0.140, y: 0.040 }, flux: 8 })
    led('white (4000 K)', 0.7, 0.7, { colourBy: 'cct', cct: 4000, flux: 80 })
    shape(doc, 'root', 'box', { label: 'mixing rod', params: { size: V(3, 3, 20), rounding: 0.2 }, at: [0, 0, 20.3], material: lib(doc, 'PMMA (acrylic)') })
    shape(doc, 'root', 'rectangle', { label: 'screen (detector)', params: { width: 60, height: 60 }, at: [0, 0, 80], material: detector(doc, 'screen') })
    return { doc, camera: orbit([0, 0, 30], -60, 20, 160) }
}

/* DISPERSION IN A PRISM: a beam of white light through an equilateral prism of flint glass (F2, n_d 1.620, V_d 36.4)
   at minimum deviation, 48 degrees, onto a detector 120 mm on -- the colours spread across about 3.5 mm. Seen from
   above: the prism stands on its triangle, the beam level. Geometry: incidence asin(1.62 sin 30) = 54.1 degrees. */
function prism() {
    const doc = scene('Dispersion in a prism', { radius: 1000, env: STUDIO(5, 0.5) })
    M.setOpticsMaxDist(doc, 400)
    const R = 20, a = 54.1 - 30          // the beam's direction in, degrees from +x; out is the mirror image
    const din = [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180), 0], dout = [din[0], -din[1], 0]
    const hitIn = [-R * Math.sqrt(3) / 4, R / 4, 0], hitOut = [R * Math.sqrt(3) / 4, R / 4, 0]
    shape(doc, 'root', 'prism', { label: 'flint prism (F2)', params: { sides: 3, radius: R, height: 30 }, at: [0, 0, 0], rot: [0, 0, 0], material: lib(doc, 'flint glass (F2)') })
    const L = 60, src = hitIn.map((c, i) => +(c - L * din[i]).toFixed(3))
    // turned to face along the beam (rotationTowards: x then y), a rectangle's own x is vertical: the slit's 10 mm length
    light(doc, 'root', 'rectangle', { label: 'slit (collimated white)', at: src, towards: din, params: { width: 10, height: 0.5 },
        flux: 10, colourBy: 'cct', cct: 6500, distribution: 'collimated' })
    const D = 120, at = hitOut.map((c, i) => +(c + D * dout[i]).toFixed(3))
    shape(doc, 'root', 'rectangle', { label: 'screen (detector)', params: { width: 20, height: 40 }, at,
        rot: (r => [r.x, r.y, r.z])(rotationTowards(dout.map(c => -c))), material: detector(doc, 'screen') })
    shape(doc, 'root', 'plane', { label: 'table', at: [0, 0, -15], material: black(doc) })
    return { doc, camera: { mode: 'orbit', target: [30, -10, 0], azimuth: -90, elevation: 5, distance: 260, dimensions: 260 } }
}

/* A DICHROIC COMBINER: a red and a blue LED beam at right angles, joined by a plate at 45 degrees whose coating reflects
   red and passes blue (the coating preset "dichroic: reflects red", an edge at 600 nm) -- one beam of both on the
   detector. Each LED has a lens to make its beam. */
function dichroic() {
    const doc = scene('Dichroic combiner', { radius: 1000, env: STUDIO(5, 0.5) })
    M.setOpticsMaxDist(doc, 500)
    const pmma = lib(doc, 'PMMA (acrylic)')
    const coated = own(doc, 'dichroic (reflects red)', 'glass', { ior: 1.52, coating: 3, ...COAT_PRESETS['dichroic: reflects red'] })
    // BLUE along +z through the plate; RED from +x, turned up the axis by it
    light(doc, 'root', 'rectangle', { label: 'blue LED (10 lm)', at: [0, 0, -60], towards: [0, 0, 1], params: { width: 1, height: 1 }, flux: 10, colourBy: 'xy', xy: { x: 0.14, y: 0.04 } })
    shape(doc, 'root', 'lens', { label: 'blue lens', params: { diameter: 20, thickness: 5, r1: 30, r2: 30 }, at: [0, 0, -30], material: pmma })
    light(doc, 'root', 'rectangle', { label: 'red LED (20 lm)', at: [60, 0, 0], towards: [-1, 0, 0], params: { width: 1, height: 1 }, flux: 20, colourBy: 'xy', xy: { x: 0.70, y: 0.299 } })
    shape(doc, 'root', 'lens', { label: 'red lens', params: { diameter: 20, thickness: 5, r1: 30, r2: 30 }, at: [30, 0, 0], rot: [0, 90, 0], material: pmma })
    // its normal halfway between the red's way back (+x) and the way out (+z): (1, 0, 1), the plate's z turned 45 degrees about y
    shape(doc, 'root', 'box', { label: 'dichroic plate', params: { size: V(15, 15, 0.5), rounding: 0 }, rot: [0, 45, 0], material: coated })
    shape(doc, 'root', 'rectangle', { label: 'screen (detector)', params: { width: 60, height: 60 }, at: [0, 0, 150], material: detector(doc, 'screen') })
    return { doc, camera: orbit([10, 0, 30], -90, 25, 330) }
}

/* AN OFFICE LUMINAIRE: four 600 x 600 mm LED panels of 3600 lm in the ceiling of an office 6 x 4 m and 2.8 m high, and
   a detector over the whole desk height, 0.75 m: the illuminance on the work plane in lux, as a lighting designer
   would check it (offices are asked about 500 lx; EN 12464-1). In metres. */
function office() {
    const doc = scene('Office lighting', { unit: 'm', radius: 100, env: STUDIO(0, 0.5) })
    M.setOpticsMaxDist(doc, 30)
    floor(doc, lib(doc, 'concrete'))
    const room = group(doc, 'root', 'room')
    shape(doc, room.id, 'box', { label: 'outside', params: { size: V(3.1, 2.1, 1.5), rounding: 0 }, at: [0, 0, 1.4], material: lib(doc, 'white plaster') })
    shape(doc, room.id, 'box', { label: 'inside', params: { size: V(3, 2, 1.4), rounding: 0 }, at: [0, 0, 1.4], material: lib(doc, 'white plaster'), join: 'subtract' })
    for (const [x, y] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]])
        light(doc, 'root', 'rectangle', { label: 'LED panel (3600 lm)', at: [x, y, 2.79], params: { width: 0.6, height: 0.6 }, flux: 3600, colourBy: 'cct', cct: 4000 })
    shape(doc, 'root', 'rectangle', { label: 'work plane at 0.75 m (detector)', params: { width: 5.6, height: 3.6 }, at: [0, 0, 0.75], material: detector(doc, 'work plane') })
    /* FROM INSIDE THE ROOM (0.63.0). The camera was 2.5 m from (0, 0, 1) at 20 degrees above level: y -2.35 m, outside
       the outer wall (-2.1 .. -2.0), looking at its outside face -- which the studio's 0 lx leaves unlit. Now 1.8 m from
       (0, 0, 1.2): y -1.69, 1.82 m up, under the 2.8 m ceiling, looking down 20 degrees over the work plane at a field of
       70 degrees. Reasoned from the sizes, not seen. */
    return { doc, camera: { mode: 'orbit', target: [0, 0, 1.2], azimuth: -90, elevation: 70, distance: 1.8, dimensions: 6, fov: 70 } }
}

//----------------------------------------------------------------------------------------------------------------------
// THE LIST: File › Examples, by audience and group, in this order
//----------------------------------------------------------------------------------------------------------------------
export const EXAMPLES = [
    { audience: 'Modelling and rendering', group: 'Start', items: [
        ['first-steps.json', firstSteps, 'Shapes on a table in daylight: one glass, two blended into one'],
    ] },
    { audience: 'Modelling and rendering', group: 'Shapes', items: [
        ['shape-gallery.json', shapeGallery, 'Every built-in shape, about 50 mm across'],
        ['combining-shapes.json', combining, 'Union, subtract and intersect, sharp and blended; a die made the way a die is'],
        ['modifiers.json', modifiers, 'Twist, bend, repeat, mirror, round, shell, displace and relief, each on a plain shape'],
        ['from-points.json', fromPoints, 'An extruded star, a turned wine glass, a pipe along a path, a swept bar'],
        ['parametric-part.json', parametric, 'A heatsink whose fin count, pitch and height are its parameters'],
        ['infinite-detail.json', infinite, 'A Menger sponge four levels deep, and columns repeated to the horizon'],
    ] },
    { audience: 'Modelling and rendering', group: 'Materials', items: [
        ['material-board.json', materialBoard, 'The library\'s materials on 40 mm spheres'],
        ['relief-texture.json', reliefTexture, 'Plaster, stucco, render, stone, hammered metal, leather: reliefs in a raking light'],
        ['glass-liquid.json', glassLiquid, 'A tumbler of water, a green bottle, a flint prism in the sun'],
    ] },
    { audience: 'Modelling and rendering', group: 'Light and camera', items: [
        ['lighting-room.json', lighting, 'A room in metres: daylight through a window and a 1500 lm lamp'],
        ['depth-of-field.json', depthOfField, 'A row of pawns through an open lens, focused on the third'],
        ['animation.json', animation, 'Values marked animated, for the Timeline'],
        ['product-shot.json', productShot, 'A perfume bottle on a plinth in studio light'],
    ] },
    { audience: 'Optical design', group: 'Optical design', items: [
        ['led-lens-screen.json', ledLens, 'An LED, a PMMA lens and a detector: illuminance in lux'],
        ['dusty-beam.json', dustyBeam, 'An LED\'s beam through a lens, seen in dust; a PMMA block in it stays clear'],
        ['aspheric-condenser.json', aspheric, 'An aspheric lens collimating a small source'],
        ['fresnel-plano-convex.json', fresnel, 'One focal length made two ways, side by side'],
        ['parabolic-reflector.json', reflector, 'A torch\'s reflector: the far field, intensity and beam angle'],
        ['light-guide.json', lightGuide, 'Light carried round two bends by total internal reflection'],
        ['rgbw-mixing.json', rgbw, 'Four LEDs and a mixing rod: the colour map'],
        ['prism-dispersion.json', prism, 'White light split by a flint prism at minimum deviation'],
        ['dichroic-combiner.json', dichroic, 'Red and blue beams joined by a coated plate'],
        ['office-lighting.json', office, 'Four LED panels and the work plane\'s illuminance'],
    ] },
]

/* WRITTEN: each scene, and examples.js -- what scenes/index.js lists, read by the page without running this */
if (import.meta.url === `file://${process.argv[1]}`) {
    const list = []
    for (const { audience, group: g, items } of EXAMPLES) for (const [file, make, description] of items) {
        const { doc, camera, exposure } = make()
        delete doc.$mats
        // the view in the file, whole (viewOf above): what the example is seen with whatever was shown before it
        M.setView(doc, viewOf(camera, exposure))
        const bad = M.validate(doc)
        if (bad.length) throw new Error(`${file}: ${bad.join('; ')}`)
        writeFileSync(new URL(file, here), M.serialize(doc) + '\n')
        list.push({ file, title: doc.title, audience, group: g, description })
        console.log(`${file}: ${doc.title}`)
    }
    writeFileSync(new URL('examples.js', here), `// MADE BY scenes/make.mjs -- edit that, and run it, rather than this.
// File › Examples, in order: each example's file, title, who it is for, its group, and a line saying what it shows.
// The camera and the exposure it opens with are in its file (builder/model.js VIEW).
export const EXAMPLES = ${JSON.stringify(list, null, 1)}
`)
}
