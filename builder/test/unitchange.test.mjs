//======================================================================================================================
// node builder/test/unitchange.test.mjs
//
// A UNIT CHANGE THREE WAYS (unitchange.js, 0.72.0): keep the numbers, keep the real size by a scale, keep it by the
// numbers. Measured IN METRES, through the builder's own readings of a document -- every node's place (bounds.js
// selectionGeometry), the estimate of what it covers (estimateBox), every light's face and flux (sources.js
// sourceTable), the camera, the radius, the tolerance -- for every example, to another unit and back: both real-size
// ways leave all of it where it was, and agree with each other; keeping the numbers moves all of it by the factor.
// The new scene the user switched (2026-10-19): a box typed 10 in mm is 10 mm, and the camera stands outside it. The
// built-ins' per-length parameters through the asphere's own JS twin (shapes.js Nasphere): one lens, the same distance
// in metres. What the document cannot say -- own code, an expression adding a plain number, a binding that does, a
// compile-time whole number -- said and left. A ray file's world scale, the timeline's keys, the view across an undo
// and a redo. No GPU: what the picture shows is the user's to judge.
//======================================================================================================================
import { readFileSync, readdirSync } from 'node:fs'
import * as M from '../model.js'
import * as P from '../project.js'
import { changeUnit, outsideAcross, trackFactor, unitFactor, UNIT_CHANGES } from '../unitchange.js'
import { selectionGeometry, estimateBox, framesTo } from '../bounds.js'
import { sourceTable } from '../sources.js'
import { primitiveObject } from '../primitives.js'
import { modifierGroup } from '../modifiers.js'
import { generate } from '../codegen.js'
import { Nasphere } from '../../lib/pathtracer/core/shapes.js'
import { envRadiusMetres } from '../../lib/pathtracer/core/photometry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1e-12, Math.abs(a), Math.abs(b))
const nearV = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, k) => near(v, b[k], tol))
const mpu = d => M.UNITS[d.unit ?? 'm']

/* WHAT A DOCUMENT IS IN METRES: every node's place, every top-level node's estimated box, every light's face, the
   camera's lengths, the radius, the tolerance, the optics' reach */
function metres(d) {
    const s = mpu(d), out = { places: {}, boxes: {}, lights: {}, blends: {}, camera: null }
    M.walk(d, n => { if (n !== d.root) out.places[n.id] = selectionGeometry(d, n.id).origin.map(v => v * s) })
    // a blend is a world length (boxes.js): a group's own and a child's join blend
    M.walk(d, n => { if (n !== d.root && (n.blend || n.joinBlend)) out.blends[n.id] = [(n.blend ?? 0) * s, (n.joinBlend ?? 0) * s] })
    for (const n of d.root.children) {
        const b = estimateBox(d.root, n, d)
        if (b) out.boxes[n.id] = [...b.lo, ...b.hi].map(v => v * s)
    }
    // a face's place and size; its area and flux apart: in m^2 and lm they scale by no one factor when the numbers are
    // kept (a light given by its luminance shines less over a smaller face) -- and stay as they were when the size does
    out.flux = {}
    for (const x of sourceTable(d).sources) {
        out.lights[x.id] = [...x.origin.map(v => v * s), ...(x.half || []).map(v => v * s)]
        out.flux[x.id] = [(x.area ?? 0) * s * s, x.flux ?? 0]
    }
    const c = d.view?.camera
    if (c) out.camera = M.CAMERA_LENGTHS.filter(k => c[k] !== undefined).flatMap(k => [c[k]].flat()).map(v => v * s)
    out.radius = envRadiusMetres(d.envRadius, d.unit)
    out.tolerance = (d.tolerance ?? 0) * s
    out.reach = (d.optics?.maxDist ?? 0) * s
    return out
}
/* the same in metres, to nine digits, or the first thing that is not */
function differ(a, b, f = 1) {
    for (const part of ['places', 'boxes', 'lights', 'blends']) {
        const ka = Object.keys(a[part]), kb = Object.keys(b[part])
        if (ka.join() !== kb.join()) return `${part}: ${ka} / ${kb}`
        for (const k of ka) if (!nearV(a[part][k].map(v => v * f), b[part][k])) return `${part} ${k}: ${a[part][k]} x${f} / ${b[part][k]}`
    }
    if (f === 1) for (const k of Object.keys(a.flux)) if (!nearV(a.flux[k], b.flux[k] || [])) return `flux ${k}: ${a.flux[k]} / ${b.flux[k]}`
    if (!!a.camera !== !!b.camera || (a.camera && !nearV(a.camera.map(v => v * f), b.camera))) return `camera: ${a.camera} x${f} / ${b.camera}`
    // a scene with no radius has the renderer's 400 m in any unit: no factor
    for (const k of ['tolerance', 'reach']) if (!near(a[k] * f, b[k])) return `${k}: ${a[k]} x${f} / ${b[k]}`
    return null
}
const load = f => M.parse(readFileSync(new URL(`../../scenes/${f}`, import.meta.url), 'utf8'))

// ---- THE NEW SCENE THE USER SWITCHED: cm to mm, + box, its size typed 10 ------------------------------------------
{
    const fresh = () => P.blankScene()
    ok('a new scene is in cm, 4 off, its world 25 (project.js NEW_SCENE)', fresh().unit === 'cm' && fresh().view.camera.distance === 4 && fresh().envRadius === 25)
    const got = {}
    for (const how of UNIT_CHANGES) {
        const d = fresh(), r = changeUnit(d, 'mm', how)
        const box = M.addObject(d, 'root', { ...primitiveObject('box'), material: M.defaultMaterial(d)?.id })
        box.params.size = { x: 10, y: 10, z: 10 }
        got[how] = { d, r, box }
    }
    ok('keep: the numbers stay -- the camera 4 mm off, the world 25 mm (what it always did)',
        got.keep.d.unit === 'mm' && got.keep.d.view.camera.distance === 4 && got.keep.d.envRadius === 25 && got.keep.r.factor === 1)
    for (const how of ['scale', 'dimensions'])
        ok(`${how}: the camera 40 mm off and the world 250 mm, as they were in cm`, got[how].d.view.camera.distance === 40
            && got[how].d.envRadius === 250 && got[how].r.factor === 10 && !got[how].r.skipped.length, JSON.stringify(got[how].d.view.camera))
    // the box typed 10 is a 10 mm half size whichever way; outside it the camera only where the real size was kept
    const outside = d => { const c = d.view.camera, k = Math.PI / 180, e = c.elevation * k, a = c.azimuth * k
        const p = [c.distance * Math.sin(e) * Math.cos(a), c.distance * Math.sin(e) * Math.sin(a), c.distance * Math.cos(e)]
        return p.some(v => Math.abs(v) > 10) }
    ok('...and the box typed 10 has the camera outside it then, and inside it after keep', outside(got.scale.d) && outside(got.dimensions.d) && !outside(got.keep.d))
    ok('...its size 10 in the shader in a mm scene', (() => { const g = generate(...M.generateArgs(got.dimensions.d))
        return g.unit === 'mm' && Object.entries(g.uniforms).some(([k, u]) => k.startsWith('size_') && u.def.x === 10) })())
    ok('the unit it has: nothing done', changeUnit(fresh(), 'cm', 'scale') === null)
    const d = fresh(), was = M.serialize(d)
    let threw = false
    try { changeUnit(d, 'furlong', 'scale') } catch { threw = true }
    let threw2 = false
    try { changeUnit(d, 'mm', 'stretch') } catch { threw2 = true }
    ok('a unit or a way it does not know: refused, nothing changed', threw && threw2 && M.serialize(d) === was)
    // a problem the document had already (here a block's parameter its user has no value for) is not this change's
    const odd = fresh(), o = M.addObject(odd, 'root', { primitive: 'sphere' })
    delete o.params.radius
    const had = M.validate(odd).length
    ok('a problem the scene had before does not stop it: converted, the problem as it was', had > 0 && changeUnit(odd, 'mm', 'dimensions')?.to === 'mm'
        && odd.unit === 'mm' && M.validate(odd).length === had)
    ok('the factor: what a number is multiplied by', unitFactor('cm', 'mm') === 10 && unitFactor('mm', 'm') === 0.001 && unitFactor('m', 'm') === 1)
}

// ---- EVERY EXAMPLE, TO ANOTHER UNIT AND BACK -- and one of this test's own: blends, nested scales, copies, a light in a
// turned and scaled group, a haze box and an export box, which no example has all of ---------------------------------
const own = () => {
    const d = M.createDoc({ title: 'blends' }); d.unit = 'cm'; d.envRadius = 80; d.tolerance = 0.002; M.setOpticsMaxDist(d, 300)
    M.ensureMaterial(d)
    const g = M.addGroup(d, 'root', { label: 'smooth', blend: 0.4, transform: { pos: { x: 3, y: -2, z: 1 }, rot: { x: 10, y: 20, z: 30 }, scale: 1.5 } })
    M.addObject(d, g.id, { primitive: 'sphere' })
    const b = M.addObject(d, g.id, { primitive: 'box', transform: { pos: { x: 0.8, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 45 }, scale: 0.5 } })
    M.setJoin(d, b.id, 'subtract'); M.setJoinBlend(d, b.id, 0.1)
    const row = M.addGroup(d, 'root', { label: 'row', transform: { pos: { x: -4, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 2 } })
    M.setCopies(d, row.id, M.copiesRow(4, 1.5, 'y'))
    M.addObject(d, row.id, { primitive: 'cylinder', transform: { pos: { x: 0, y: 0, z: 0.5 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    const lum = M.addGroup(d, 'root', { label: 'lamp', transform: { pos: { x: 0, y: 5, z: 4 }, rot: { x: 180, y: 0, z: 15 }, scale: 3 } })
    M.addLight(d, lum.id, { shape: 'rectangle', params: { width: 0.4, height: 0.2 }, luminance: 5000 })
    M.addLight(d, 'root', { shape: 'disc', params: { radius: 0.3 }, flux: 120, transform: { pos: { x: 1, y: 1, z: 6 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    M.addHazeBox(d, 'root', { size: { x: 4, y: 4, z: 3 } })
    M.addExportBox(d, 'root', { size: { x: 2, y: 2, z: 2 } })
    M.setView(d, { camera: { ...M.CAMERA_DEFAULTS, distance: 30, target: [1, 2, 3], aperture: 0.5, focus: 25 } })
    return d
}
ok('this test\'s own scene is sound', M.validate(own()).length === 0, M.validate(own()).join('; '))
const scenes = [...readdirSync(new URL('../../scenes/', import.meta.url)).filter(f => f.endsWith('.json')), 'blends (this test\'s)']
ok('the examples are there', scenes.length >= 20, String(scenes.length))
for (const f of scenes) {
    const doc = f.endsWith('.json') ? load(f) : own(), to = doc.unit === 'mm' ? 'm' : 'mm', from = doc.unit ?? 'm', k = unitFactor(from, to)
    const m0 = metres(doc), out = {}
    for (const how of UNIT_CHANGES) {
        const d = structuredClone(doc)
        let r = null
        try { r = changeUnit(d, to, how) } catch (e) { ok(`${f} ${how}: converts`, false, e.message); continue }
        out[how] = { d, r }
        const m1 = metres(d)
        if (how === 'keep') {
            ok(`${f} keep: every number as it was, the unit said`, M.serialize({ ...d, unit: from }) === M.serialize(doc) && d.unit === to)
            ok(`${f} keep: everything in metres times the factor's inverse`, differ(m0, m1, 1 / k) === null, differ(m0, m1, 1 / k))
            continue
        }
        // own code: a number written in it is not converted (dimensions); what the estimate guesses from it is not either
        const exact = !r.skipped.length
        const m1b = exact ? m1 : { ...m1, boxes: m0.boxes }
        ok(`${f} ${how}: everything where it was, in metres`, differ(m0, m1b) === null, differ(m0, m1b))
        if (how === 'scale') ok(`${f} scale: nothing it cannot say`, exact, JSON.stringify(r.skipped))
        // and back: the numbers they were, to twelve digits
        const back = structuredClone(d)
        changeUnit(back, from, how)
        const same = (a, b) => typeof a === 'number' ? near(a, b) : a && typeof a === 'object' ? Object.keys({ ...a, ...b }).every(x => same(a[x], b?.[x])) : a === b
        ok(`${f} ${how}: and back, every number as it was`, same(JSON.parse(M.serialize(back)), JSON.parse(M.serialize(doc))))
    }
    if (out.scale && out.dimensions) ok(`${f}: both real-size ways the same scene in metres`, differ(metres(out.scale.d), metres(out.dimensions.d)) === null
        || out.dimensions.r.skipped.length > 0, differ(metres(out.scale.d), metres(out.dimensions.d)))
    if (f === 'infinite-detail.json') ok('Infinite detail by the numbers: the Menger sponge\'s own code said, and only it',
        out.dimensions?.r.skipped.length === 1 && /own code/.test(out.dimensions.r.skipped[0].what), JSON.stringify(out.dimensions?.r.skipped))
    if (f === 'parametric-part.json') {
        const d = out.dimensions.d, fins = M.walk ? (() => { let x = null; M.walk(d, n => { if (n.label === 'fins (an array)') x = n }); return x })() : null
        ok('Parametric part by the numbers: its lengths marked, so its bindings follow -- nothing said, the fins 5 mm apart in metres',
            !out.dimensions.r.skipped.length && near(fins.copies[1].pos.x - fins.copies[0].pos.x, 0.005), JSON.stringify(out.dimensions.r.skipped))
    }
}

// ---- THE BUILT-INS' PER-LENGTH PARAMETERS: the asphere through its JS twin, a twist's rate, the blocks themselves --
{
    const d = M.createDoc(); d.unit = 'cm'
    const lens = M.addObject(d, 'root', { primitive: 'aspheric lens' })
    Object.assign(lens.params, { diameter: 2, thickness: 0.6, r1: 1.2, k1: -1.5, a4_1: 0.02, a6_1: -0.003, a8_1: 0.0004, a10_1: -0.00002,
                                 r2: -3, k2: 0.5, a4_2: -0.01, a6_2: 0.001, a8_2: 0, a10_2: 0.00001 })
    const tw = M.addGroup(d, 'root', modifierGroup('twist'))
    tw.params.rate = 0.5
    const before = structuredClone(lens.params)
    const r = changeUnit(d, 'mm', 'dimensions')
    const P2 = lens.params, sdf = (q, A) => Nasphere(q, A.diameter, A.thickness, A.r1, A.k1, [A.a4_1, A.a6_1, A.a8_1, A.a10_1], A.r2, A.k2, [A.a4_2, A.a6_2, A.a8_2, A.a10_2])[3]
    let worst = 0
    for (const q of [[0, 0, 0.5], [0.3, 0.2, 0.31], [0.9, 0, 0.1], [0.5, -0.4, -0.35], [1.2, 0.3, 0], [0, 0.7, -0.2], [0.2, 0.1, 2]]) {
        const cm = sdf(q, before) * 0.01, mm = sdf(q.map(v => v * 10), P2) * 0.001
        worst = Math.max(worst, Math.abs(cm - mm) / Math.max(1e-9, Math.abs(cm)))
    }
    ok('an asphere by the numbers: the same distance in metres at every point (its a4..a10 by the factor to 3, 5, 7, 9)', worst < 1e-9 && !r.skipped.length, `${worst}`)
    ok('...its conic constants pure numbers, untouched', P2.k1 === -1.5 && P2.k2 === 0.5)
    ok('a twist\'s rate per unit: 0.5 a cm is 0.05 a mm', tw.params.rate === 0.05)
    const B = M.blockOf(d, lens)
    ok('...and a built-in block stays the built-in, read-only (+ in a mm scene starts from its defaults too)',
        B.builtin === 'aspheric lens@1' && M.builtinOf(B) === 'aspheric lens@1' && B.params.diameter === 1)
    const tracks = [['scene/' + tw.id + '/rate', 0.1], ['scene/' + lens.id + '/a4_1', 0.001], ['scene/' + lens.id + '/k1', 1], ['scene/' + lens.id + '/diameter', 10]]
    ok('...a timeline key on them by the same factor', tracks.every(([p, f]) => near(trackFactor(d, p, 'dimensions', 10), f)),
        tracks.map(([p]) => trackFactor(d, p, 'dimensions', 10)).join())
}

// ---- WHAT THE DOCUMENT CANNOT SAY: said and left, never guessed --------------------------------------------------
{
    const d = M.createDoc(); d.unit = 'cm'
    // a block of the scene's own: its defaults and ranges converted, its code's numbers said
    const own = M.addObject(d, 'root', { label: 'own', code: 'C = add_new(C, sdSphere(p, radius + 0.5), MATERIAL);', params: { radius: 1, count: 3 },
                                         lengths: ['radius'], ranges: { radius: { min: 0, max: 4, step: 0.01 } } })
    const T = M.addObject(d, 'root', { primitive: 'bent tube' })
    T.params.route = { path: [[0, 0, 0], [2, 0, 0, 'rise / 4'], [2, 'rise', 0], [2, 'rise + 0.5', 1, 0, 1, 1, 'rise']], live: true }
    T.params.rise = 2
    const Q = M.addObject(d, 'root', { primitive: 'extrusion' })
    Q.params.outline = [[0, 0], ['1/4', 0], [1, 1]]
    const C = M.addObject(d, 'root', { label: 'counted', code: 'C = add_new(C, sdSphere(p, f32(n)), MATERIAL);', params: { n: 3 }, lengths: ['n'] })
    M.setConstant(d, C.id, 'n', 'u32')
    const r = changeUnit(d, 'mm', 'dimensions')
    const said = id => r.skipped.filter(s => s.id === id).map(s => s.what)
    const B = M.blockOf(d, own)
    ok('own code: its length 10, its range 0 to 40 by 0.1, said once with what is not a length',
        own.params.radius === 10 && own.params.count === 3 && B.ranges.radius.max === 40 && near(B.ranges.radius.step, 0.1) && B.params.radius === 10
        && said(own.id).length === 1 && /own code/.test(said(own.id)[0]) && /count/.test(said(own.id)[0]), JSON.stringify(said(own.id)))
    const pts = T.params.route.path
    ok('a point reading a length follows it, unwritten: "rise / 4" and "rise"', pts[1][3] === 'rise / 4' && pts[2][1] === 'rise' && T.params.rise === 20)
    ok('...a number added to one does not: "rise + 0.5" said and left', pts[3][1] === 'rise + 0.5' && said(T.id).some(w => /rise \+ 0\.5/.test(w)), JSON.stringify(said(T.id)))
    ok('...a twist reading a length would change: said too (the twist is no length)', said(T.id).some(w => /point 4.*"rise"/.test(w)), JSON.stringify(said(T.id)))
    ok('...a number written out ("1/4") becomes the number converted', Q.params.outline[1][0] === 2.5 && !said(Q.id).length, JSON.stringify(Q.params.outline))
    ok('a compile-time whole number holds 30 mm from 3 cm: converted, only its code said', C.params.n === 30 && !said(C.id).some(w => /u32/.test(w)), JSON.stringify(said(C.id)))
    const d2 = M.createDoc(); d2.unit = 'mm'
    const C2 = M.addObject(d2, 'root', { label: 'counted', code: 'C = add_new(C, sdSphere(p, f32(n)), MATERIAL);', params: { n: 3 }, lengths: ['n'] })
    M.setConstant(d2, C2.id, 'n', 'u32')
    const r2 = changeUnit(d2, 'cm', 'dimensions')
    ok('...but 0.3 cm from 3 mm it cannot: kept, and said', C2.params.n === 3 && r2.skipped.some(s => s.id === C2.id && /u32/.test(s.what)), JSON.stringify(r2.skipped))
    // a binding: one that follows a length is silent, one that adds a plain number is said, and gives what it says
    const d3 = M.createDoc(); d3.unit = 'cm'
    const g = M.addGroup(d3, 'root', { label: 'part', params: { gap: 1, n: 2 } })
    M.setLength(d3, g.id, 'gap', true)
    const a = M.addObject(d3, g.id, { primitive: 'sphere' }), b = M.addObject(d3, g.id, { primitive: 'sphere' })
    M.setBindings(d3, a.id, 'pos.z = gap * 2')
    M.setBindings(d3, b.id, 'pos.z = gap + 1')
    const r3 = changeUnit(d3, 'mm', 'dimensions')
    ok('a binding that follows a length: silent, its value converted', a.transform.pos.z === 20 && !r3.skipped.some(s => s.id === a.id))
    ok('...one adding a plain number: what it says (11), and said', b.transform.pos.z === 11 && r3.skipped.some(s => s.id === b.id), JSON.stringify(r3.skipped))
    const d4 = structuredClone(d3); d4.unit = 'cm'
    const r4 = changeUnit(d3, 'cm', 'scale')
    ok('by a scale nothing below the top moves: the binding is silent', !r4.skipped.length, JSON.stringify(r4.skipped))
    // a light's own setting bound (0.69.0): a flux in lm from a parameter that is no length follows nothing, and is
    // silent; one read from a length would change the lumens with the unit -- said
    const d5 = M.createDoc(); d5.unit = 'cm'
    const lamp = M.addGroup(d5, 'root', { label: 'lamp', params: { lm: 800, w: 2 } })
    M.setLength(d5, lamp.id, 'w', true)
    const L1 = M.addLight(d5, lamp.id, { shape: 'rectangle' }), L2 = M.addLight(d5, lamp.id, { shape: 'rectangle' })
    M.setBindings(d5, L1.id, 'light.flux = lm\nwidth = w')
    M.setBindings(d5, L2.id, 'light.flux = w * 100')
    const r5 = changeUnit(d5, 'mm', 'dimensions')
    ok('a light\'s flux bound to a number: 800 lm still, its width bound to a length 20 mm, silent', L1.light.flux === 800 && L1.params.width === 20
        && !r5.skipped.some(s => s.id === L1.id), JSON.stringify([L1, r5.skipped]))
    ok('...one bound to a length: what its binding says (2000 lm), and said', L2.light.flux === 2000 && r5.skipped.some(s => s.id === L2.id), JSON.stringify([L2.light, r5.skipped]))
}

// ---- A RAY FILE KEEPS ITS WORLD SCALE (its rays are real-sized by its own unit), and its box follows ---------------
{
    const d = M.createDoc(); d.unit = 'mm'
    const g = M.addGroup(d, 'root', { label: 'luminaire' })
    const L = M.addLight(d, g.id, { shape: 'rayfile', file: 'led.dat', box: [[-1, -1, 0], [1, 1, 0.5]] })
    const top = M.addLight(d, 'root', { shape: 'rayfile', file: 'led.dat', box: [[-1, -1, 0], [1, 1, 0.5]] })
    const world = id => framesTo(d, id).reduce((s, t) => s * t.scale, 1)
    changeUnit(d, 'm', 'scale')
    ok('by a scale: the group 0.001, the ray file in it 1000 -- its world scale 1 as before', g.transform.scale === 0.001 && L.transform.scale === 1000 && near(world(L.id), 1))
    ok('...a top-level one: its scale as it was, its place converted', top.transform.scale === 1 && near(world(top.id), 1))
    ok('...its box in the new unit', nearV(L.light.box.flat(), [-0.001, -0.001, 0, 0.001, 0.001, 0.0005]))
    ok('...and a key on its scale the same way', near(trackFactor(d, `scene/${L.id}/transform/scale`, 'scale', 0.001), 1000)
        && near(trackFactor(d, `scene/${g.id}/transform/scale`, 'scale', 0.001), 0.001) && trackFactor(d, `scene/${top.id}/transform/scale`, 'scale', 0.001) === 1)
}

// ---- THE TIMELINE AND THE VIEW: converted with the scene, back across an undo, on again across a redo ---------------
{
    const d = P.blankScene()
    const g = M.addGroup(d, 'root', { label: 'g' })
    const s = M.addObject(d, g.id, { primitive: 'sphere' })
    const keys = v => [{ t: 0, v }, { t: 1, v: Array.isArray(v) ? v.map(x => x * 2) : v * 2 }]
    M.setTimeline(d, { fps: 30, duration: 2, tracks: [
        { prop: 'view/camera/distance', interp: 'smooth', keys: keys(4) },
        { prop: 'view/camera/azimuth', interp: 'smooth', keys: keys(30) },
        { prop: `scene/${g.id}/transform/position`, interp: 'smooth', keys: keys([1, 2, 3]) },
        { prop: `scene/${s.id}/transform/position`, interp: 'smooth', keys: keys([1, 0, 0]) },
        { prop: `scene/${s.id}/radius`, interp: 'smooth', keys: keys(0.5) },
    ] })
    const vals = doc => Object.fromEntries(doc.timeline.tracks.map(t => [t.prop.split('/').slice(-2).join('/') + (t.prop.includes(s.id) ? '@s' : ''), t.keys[0].v]))
    const a = structuredClone(d), b = structuredClone(d)
    changeUnit(a, 'mm', 'scale'); changeUnit(b, 'mm', 'dimensions')
    const A = vals(a), Bv = vals(b)
    ok('by a scale: the camera\'s distance and the top group\'s place x10; an angle, a nested place, a radius as they were',
        A['camera/distance'] === 40 && A['camera/azimuth'] === 30 && A['transform/position'].join() === '10,20,30'
        && A['transform/position@s'].join() === '1,0,0' && A['g/radius@s'] === undefined && a.timeline.tracks[4].keys[0].v === 0.5, JSON.stringify(A))
    ok('by the numbers: every place and the radius x10 too', b.timeline.tracks[3].keys[0].v.join() === '10,0,0' && b.timeline.tracks[4].keys[1].v === 10
        && b.timeline.tracks[2].keys[1].v.join() === '20,40,60', JSON.stringify(b.timeline.tracks.map(t => t.keys)))
    // AN UNDO: the history brings the old document back with the view and the timeline as they are now (carryOutside)
    for (const [label, conv] of [['scale', a], ['dimensions', b]]) {
        const restored = structuredClone(d)
        restored.view = structuredClone(conv.view); restored.timeline = structuredClone(conv.timeline)
        restored.view.camera.azimuth = 77                    // looked around after the change: that stays
        outsideAcross(restored, { from: 'cm', to: 'mm', how: label }, { undo: true })
        ok(`undo (${label}): the camera and the keys back in cm, the look around kept`, restored.view.camera.distance === 4 && restored.view.camera.azimuth === 77
            && JSON.stringify(restored.timeline) === JSON.stringify(d.timeline), JSON.stringify(restored.timeline.tracks.map(t => t.keys[0].v)))
        const redone = structuredClone(conv)
        redone.view = structuredClone(restored.view); redone.timeline = structuredClone(restored.timeline)
        outsideAcross(redone, { from: 'cm', to: 'mm', how: label })
        ok(`redo (${label}): on to mm again`, redone.view.camera.distance === 40 && JSON.stringify(redone.timeline) === JSON.stringify(conv.timeline))
    }
    ok('keep: nothing outside to carry', outsideAcross(structuredClone(d), { from: 'cm', to: 'mm', how: 'keep' }) === false)
}

// ---- THROUGH THE REAL BUILDER (demo.js setUnit) over a stand-in renderer with a view, as project.test.mjs's: one undo
// step; the camera and the timeline into the renderer and its panel WITH THE SCENE IN ITS NEW UNIT -- when it is swapped
// in (markShown, which apply() calls after setScene), not before, or the old scene is seen from ten times as far for the
// whole compile; an orbit during it kept, converted; back across the undo, on again across the redo, a look around
// between kept. The view is no part of a snapshot (project.js OUTSIDE_HISTORY): nothing else would carry them.
{
    const { installBuilder } = await import('../demo.js')
    const R = { cam: { mode: 'orbit', distance: 1, azimuth: 0 }, exposure: { exposureEV: 15 } }
    const watchers = new Set(), tell = () => watchers.forEach(f => f())
    const RT = { view: () => ({ camera: structuredClone(R.cam), exposure: structuredClone(R.exposure) }),
        applyView: ({ camera, exposure } = {}) => { if (camera) Object.assign(R.cam, structuredClone(camera)); if (exposure) Object.assign(R.exposure, exposure); tell() },
        watchView: f => (watchers.add(f), () => watchers.delete(f)), settings: () => ({ values: {} }), applySettings: () => [] }
    const log = console.log; console.log = () => { }
    try {
        const d = P.blankScene('U')
        const s = M.addObject(d, 'root', { primitive: 'sphere' })
        M.setTimeline(d, { fps: 30, duration: 2, tracks: [{ prop: 'view/camera/distance', interp: 'smooth', keys: [{ t: 0, v: 4 }, { t: 2, v: 8 }] },
                                                        { prop: `scene/${s.id}/transform/position`, interp: 'smooth', keys: [{ t: 0, v: [1, 0, 0] }] }] })
        const B = installBuilder({}, { RT, project: P.createProject([d]) })
        const shown = []
        B.onTimeline = t => shown.push(t.tracks.map(x => x.keys[0].v))
        const cam = () => B.doc.view.camera
        ok('the scene starts as a new one is seen: 4 cm off', R.cam.distance === 4 && B.doc.unit === 'cm')
        const r = B.setUnit('mm', 'scale')
        ok('setUnit (scale): the document in mm, the sphere 10x scaled, its camera 40 off -- one undo step', B.doc.unit === 'mm' && r.factor === 10
            && M.find(B.doc, s.id).node.transform.scale === 10 && cam().distance === 40 && B.canUndo, JSON.stringify(cam()))
        ok('...the renderer still at 4 and the panel told nothing: the scene shown is still the one in cm', R.cam.distance === 4 && shown.length === 0)
        R.cam.azimuth = 50; R.cam.distance = 5; tell()            // an orbit during the compile
        ok('...an orbit then is kept, in the new unit', cam().azimuth === 50 && cam().distance === 50, JSON.stringify(cam()))
        R.exposure.exposureEV = 12; tell()                         // the meter moving
        ok('...and the meter writes no camera in the old numbers over it', cam().distance === 50 && B.doc.view.exposure.exposureEV === 12)
        B.markShown()                                              // the scene in mm swapped in (apply, after setScene)
        ok('the scene in mm shown: the camera 50 off -- the same place -- and the keys converted, at that moment',
            R.cam.distance === 50 && R.cam.azimuth === 50 && JSON.stringify(shown.at(-1)) === JSON.stringify([40, [10, 0, 0]]), JSON.stringify([R.cam, shown]))
        B.markShown()
        ok('...once', shown.length === 1)
        R.cam.azimuth = 77; tell()                                 // looked around after it
        B.undo()
        ok('undo: cm again, its camera 5 off, the look around kept; the renderer waits for the scene', B.doc.unit === 'cm'
            && M.find(B.doc, s.id).node.transform.scale === 1 && cam().distance === 5 && cam().azimuth === 77 && R.cam.distance === 50, JSON.stringify([cam(), R.cam]))
        B.markShown()
        ok('...shown: 5 off, the keys back', R.cam.distance === 5 && R.cam.azimuth === 77 && JSON.stringify(shown.at(-1)) === JSON.stringify([4, [1, 0, 0]])
            && B.doc.timeline.tracks[0].keys[1].v === 8, JSON.stringify([R.cam, shown]))
        B.redo(); B.markShown()
        ok('redo: mm, 50 off, the keys on again', B.doc.unit === 'mm' && R.cam.distance === 50 && B.doc.timeline.tracks[0].keys[1].v === 80
            && JSON.stringify(shown.at(-1)) === JSON.stringify([40, [10, 0, 0]]), JSON.stringify([R.cam, shown.at(-1)]))
        // an undo before the scene was ever shown: nothing waits, nothing is handed over
        const n = shown.length
        B.setUnit('cm', 'dimensions'); B.undo(); B.markShown()
        ok('a change undone before its scene was shown: the renderer and the panel never moved', B.doc.unit === 'mm' && R.cam.distance === 50 && cam().distance === 50
            && shown.length === n)
        // two changes before one swap: their factors together
        B.setUnit('cm', 'scale'); B.setUnit('m', 'dimensions'); B.markShown()
        ok('two changes before the scene is shown: the camera by both, 0.05 m', B.doc.unit === 'm' && near(R.cam.distance, 0.05) && near(cam().distance, 0.05), JSON.stringify(R.cam))
        B.setUnit('mm', 'keep'); B.markShown()
        ok('setUnit (keep): the numbers stay, the camera 0.05 off -- 0.05 mm now', B.doc.unit === 'mm' && near(R.cam.distance, 0.05) && near(cam().distance, 0.05))
        B.undo(); B.markShown()
        ok('...its undo moves nothing outside either', B.doc.unit === 'm' && near(R.cam.distance, 0.05))
        ok('the unit it has: nothing, no step', B.setUnit('m', 'scale') === null)
        let threw = false
        try { B.setUnit('furlong', 'scale') } catch { threw = true }
        ok('...one it does not know: refused, the scene as it was', threw && B.doc.unit === 'm' && near(R.cam.distance, 0.05))
    } finally { console.log = log }
}

// ---- A LIBRARY ITEM BEING EDITED is saved in the unit its numbers are in; "no size of its own" stays so ------------
{
    const d = P.blankScene(); d.libraryItem = { id: 'x', kind: 'node', unit: 'cm' }
    changeUnit(d, 'mm', 'dimensions')
    const e = P.blankScene(); e.libraryItem = { id: 'y', kind: 'node', unit: null }
    changeUnit(e, 'mm', 'scale')
    ok('a library item\'s unit follows; null stays null', d.libraryItem.unit === 'mm' && e.libraryItem.unit === null)
}

console.log(`unitchange: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
