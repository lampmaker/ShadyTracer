//======================================================================================================================
// Tests for the scene's haze (hazebox.js; a haze box node from version 22 to 26, the scene's `haze` since 27).
// Run: node builder/test/hazebox.test.mjs
//
// The haze as the scene's: switched on (its region fitted to a box given, or a unit cube), off with its settings kept,
// validated, saved and loaded, its settings set and checked. In no tree, and seen as an object under HAZE_ID: what moves
// and sizes an object moves and sizes it, nothing removes, moves or copies it. A FILE OF 26 with a haze box -- moved,
// turned, scaled, nested in a turned group and in an array (its first copy) -- read as the scene's haze exactly where the
// box was in the world, its settings, flags and a timeline track on it following it. Emitted as nothing, and handed to
// the renderer as the scene's `haze`, what it says while off, and that its presence is text to the data path (sceneTextOf)
// while its values are not. The Transform gizmo's cubes, the outline's corners, the focus's box, a unit change, and the
// parameter registry's rows. What it does to light is lib/pathtracer/core/test/haze.test.mjs's and haze.gpu.mjs's; how it
// looks is the user's to judge.
//======================================================================================================================
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { hazeOf, hazeProblems, hazeSettings, hazeRegion, boxCorners, HAZE_DEFAULTS, HAZE_ID, visibilityOf, HAZE_G_MAX } from '../hazebox.js'
import { stretchOf, stretched, startOf } from '../stretch.js'
import { focusBox } from '../focus.js'
import { sceneParams } from '../params.js'
import { changeUnit } from '../unitchange.js'
import { hazeUniforms } from '../../lib/pathtracer/core/haze.js'
import { sceneTextOf } from '../../lib/pathtracer/core/uniforms.schema.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e
const vnear = (name, got, want, e = 1e-9) => ok(name, got.length === want.length && got.every((v, i) => near(v, want[i], e)), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = (name, fn, match) => {
    try { fn() } catch (e) { ok(name, !match || match.test(e.message), `threw: ${e.message}`); return }
    ok(name, false, 'did not throw')
}
const T = (pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) => ({ pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] }, scale })

//----------------------------------------------------------------------------------------------------------------------
// the scene's haze
//----------------------------------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    const before = generate(...M.generateArgs(d))
    ok('a scene without haze says nothing about it (its kernels\' text is as before)', !('haze' in before) && hazeOf(d) === null && M.find(d, HAZE_ID) === null)
    ok('switched off when there is none: nothing made', M.setHazeOn(d, false) === null && !('haze' in d))
    const h = M.setHazeOn(d, true, { lo: [-1, -1.5, 0], hi: [1, 1.5, 4] })
    eq('switched on: its region fills the box given, unturned', [h.transform.pos, h.params.size, h.transform.rot], [{ x: 0, y: 0, z: 2 }, { x: 2, y: 3, z: 4 }, { x: 0, y: 0, z: 0 }])
    eq('...seen as an object of type haze, under its own id, with no material', [h.id, h.kind, h.type, h.material], [HAZE_ID, 'object', 'haze', null])
    ok('...found by its id, under the root, in no tree', M.find(d, HAZE_ID)?.node === h && M.find(d, HAZE_ID).parent === d.root && d.root.children.every(c => c.type !== 'haze'))
    eq('...a sound document', M.validate(d), [])
    eq('its settings default', hazeSettings(h), { ...HAZE_DEFAULTS })
    const back = M.parse(M.serialize(d))
    eq('it saves and loads as it was', back.haze, d.haze)
    M.setHaze(d, HAZE_ID, { mfp: 5, albedo: { r: 0.5, g: 0.6, b: 0.7 }, g: 0.3 })
    eq('settings are set, into the scene\'s haze', d.haze.haze, { mfp: 5, albedo: { r: 0.5, g: 0.6, b: 0.7 }, g: 0.3 })
    M.setHaze(d, HAZE_ID, { albedo: { ...HAZE_DEFAULTS.albedo } })
    eq('...and one set back to its default is dropped', d.haze.haze, { mfp: 5, g: 0.3 })
    throws('a mean free path of 0 is refused', () => M.setHaze(d, HAZE_ID, { mfp: 0 }), /mean free path/)
    throws('an albedo past 1 is refused', () => M.setHaze(d, HAZE_ID, { albedo: { r: 1.2, g: 0, b: 0 } }), /albedo/)
    throws(`a g past ${HAZE_G_MAX} is refused (a delta lobe light sampling cannot weigh)`, () => M.setHaze(d, HAZE_ID, { g: 0.99 }), /g must/)
    throws('an unknown setting is refused', () => M.setHaze(d, HAZE_ID, { density: 3 }), /unknown/)
    throws('there is no haze box to add: it is the scene\'s', () => M.addObject(d, 'root', { type: 'haze' }), /scene's since version 27/)
    ok('...nor a function that adds one', !('addHazeBox' in M))
    throws('it takes no parameters of its own', () => M.addParam(d, HAZE_ID, 'radius', 1), /no parameter/)
    throws('it cannot be removed (switched off instead)', () => M.remove(d, HAZE_ID), /not in the tree/)
    throws('...nor moved into a group', () => M.move(d, HAZE_ID, 'root'), /not in the tree/)
    throws('...nor duplicated', () => M.duplicate(d, HAZE_ID), /not in the tree/)
    ok('...and the scene\'s objects are untouched by each refusal', d.root.children.map(c => c.id).join() === 'ball')
    M.find(d, HAZE_ID).node.transform = T([3, 0, 2], [0, 0, 30])
    ok('what moves an object moves it: its transform, set on what find() gives, is the scene\'s haze\'s', d.haze.transform.pos.x === 3 && d.haze.transform.rot.z === 30)
    const bad = structuredClone(d); bad.haze.colour = 1
    ok('a file whose haze has a key it does not know does not load', M.validate(bad).some(p => /haze\.colour/.test(p)))
    const flat = structuredClone(d); flat.haze.params.size.y = 0
    ok('...nor one of no size', M.validate(flat).some(p => /size/.test(p)))
    const node = structuredClone(d); node.root.children.push({ id: 'dust', kind: 'object', type: 'haze', label: 'haze box', enabled: true,
        transform: T(), material: null, params: { size: { x: 1, y: 1, z: 1 } } })
    ok('...nor one with a haze box in its tree at this version', M.validate(node).some(p => /scene's haze since version 27/.test(p)))
    ok('hazeProblems: a sound haze has none', hazeProblems(hazeRegion(d)).length === 0)
    M.find(d, HAZE_ID).node.transform = T([0, 0, 2])

    const after = generate(...M.generateArgs(d))
    ok('it draws nothing: the SDF is the one without it, to the letter (no node, no comment, no uniform)', after.wgsl === before.wgsl
        && Object.keys(after.uniforms).join() === Object.keys(before.uniforms).join())
    eq('it does not change the scene\'s size estimate', after.extent, before.extent)
    ok('the scene hands the renderer its haze', after.haze?.id === HAZE_ID && after.haze.on === true && after.haze.mfp === 5 && after.haze.g === 0.3
        && JSON.stringify(after.haze.albedo) === JSON.stringify([0.9, 0.9, 0.9]), JSON.stringify(after.haze))
    vnear('...its half-sizes', after.haze.half, [1, 1.5, 2])
    ok('...and to the data path its presence is text, its values are not', sceneTextOf(after) !== sceneTextOf(before)
        && (() => { const d2 = structuredClone(d); M.setHaze(d2, HAZE_ID, { mfp: 50 }); (M.find(d2, HAZE_ID).node.transform = T([1, 1, 1])); return sceneTextOf(generate(...M.generateArgs(d2))) === sceneTextOf(after) })())
    const data = generate(...M.generateArgs(d, { data: true }))
    ok('...made as data, it is there too', data.haze?.id === HAZE_ID)

    // off: not in the scene without live visibility (a compile), kept and off with it (no compile); its settings kept
    M.setHazeOn(d, false)
    ok('off, without live visibility: no haze in the scene, its settings kept', !('haze' in generate(...M.generateArgs(d))) && d.haze.haze.mfp === 5)
    d.liveVisibility = true
    const lv = generate(...M.generateArgs(d))
    ok('...with live visibility: there, and off -- so the switch compiles nothing', lv.haze?.on === false && hazeUniforms(lv.haze, 1, 0).hazeC[3] === 0, JSON.stringify(lv.haze))
    delete d.liveVisibility
    M.setHazeOn(d, true)
    ok('on again: as it was', d.haze.enabled === true && d.haze.haze.mfp === 5 && d.haze.params.size.z === 4)
    M.fitHaze(d, { lo: [0, 0, 0], hi: [10, 10, 10] })
    eq('fitted again to another box', [d.haze.transform.pos, d.haze.params.size], [{ x: 5, y: 5, z: 5 }, { x: 10, y: 10, z: 10 }])
    throws('fitting a scene with none says so', () => M.fitHaze(M.createDoc(), { lo: [0, 0, 0], hi: [1, 1, 1] }), /no haze/)
}

//----------------------------------------------------------------------------------------------------------------------
// a file of 26: its haze box made the scene's haze, where it was in the world
//----------------------------------------------------------------------------------------------------------------------
/** A file of version 26: a document of today's with its version set back and these children (26 and 27 differ in the
 *  haze, the export box and the optics roles only) */
const v26 = (children, extra = {}) => {
    const f = JSON.parse(M.serialize(M.createDoc({ title: 'old' })))
    f.version = 26; f.unit = 'cm'; f.root.children = children
    return { ...f, ...extra }
}
const box = (o = {}) => ({ id: 'dust', kind: 'object', type: 'haze', label: 'haze box', enabled: true, transform: T(), material: null,
    params: { size: { x: 2, y: 4, z: 6 } }, ...o })
{
    // a group turned 90 degrees about z, scaled 2, moved; the box in it moved along its x and scaled 1.5
    const old = v26([{ id: 'g', kind: 'group', label: 'g', enabled: true, transform: T([10, 0, 0], [0, 0, 90], 2), blend: 0,
        children: [box({ transform: T([1, 0, 0], [30, 0, 0], 1.5), haze: { mfp: 7 }, animate: ['haze/mfp'], lockPosition: true })] }],
        { timeline: { fps: 30, duration: 8, tracks: [{ prop: 'scene/dust/haze/mfp', interp: 'linear', keys: [{ t: 0, v: 7 }, { t: 1, v: 3 }] }] } })
    const d = M.parse(JSON.stringify(old))
    ok('a file of 26 with a haze box: at the current version, no haze box in the tree', d.version === M.VERSION && !M.find(d, 'dust') && M.find(d, 'g').node.children.length === 0)
    ok('...its haze the scene\'s, on, its settings, flags and lock kept', d.haze?.enabled === true && d.haze.haze.mfp === 7
        && JSON.stringify(d.haze.animate) === '["haze/mfp"]' && d.haze.lockPosition === true)
    ok('...a timeline track on it follows it', d.timeline.tracks[0].prop === `scene/${HAZE_ID}/haze/mfp`)
    eq('...and the document is sound', M.validate(d), [])
    // where it was: the origin (1, 0, 0) in g turned to (0, 1, 0), scaled 2, moved: (10, 2, 0); x to y, y turned 30 about x
    const h = hazeOf(d)
    vnear('...the centre where the box was, through a turned, scaled, moved group', h.centre, [10, 2, 0], 1e-9)
    vnear('...its x axis turned to the world\'s y', h.axes[0], [0, 1, 0], 1e-9)
    vnear('...its y axis as the box had it', h.axes[1], [-Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6)], 1e-9)
    vnear('...its half-sizes scaled by both (3), scale 1 now', [...h.half, d.haze.transform.scale], [3, 6, 9, 1], 1e-9)
    ok('...in the scene\'s units: the renderer turns them into metres', hazeUniforms(h, 0.01, 0).hazeC[0] === 0.1 && near(hazeUniforms(h, 0.01, 0).hazeU[3], 0.03))
    // in an array: its first copy's place; hidden: the haze off
    const a = M.parse(JSON.stringify(v26([{ id: 'arr', kind: 'group', label: 'arr', enabled: true, transform: T(), blend: 0,
        copies: [T([5, 0, 0]), T([9, 0, 0])], children: [box({ enabled: false })] }])))
    vnear('in an array: the first copy\'s place', hazeOf(a).centre, [5, 0, 0], 1e-12)
    ok('a hidden box: the haze off, kept', a.haze.enabled === false && M.validate(a).length === 0)
    ok('a file with no haze box has no haze', !('haze' in M.parse(JSON.stringify(v26([])))))
}

//----------------------------------------------------------------------------------------------------------------------
// moved and sized in the picture, framed, a unit change
//----------------------------------------------------------------------------------------------------------------------
{
    const d = M.createDoc(); d.unit = 'cm'
    M.setHazeOn(d, true, { lo: [-1, -2, -3], hi: [1, 2, 3] })
    M.find(d, HAZE_ID).node.transform = T([10, 2, 0], [0, 0, 90], 1.5)
    const h = hazeOf(d)
    const C = boxCorners(d, HAZE_ID)
    ok('the outline\'s corners: eight, around the centre', C?.length === 8 && C.reduce((s, c) => s.map((v, k) => v + c[k] / 8), [0, 0, 0]).every((v, k) => near(v, h.centre[k], 1e-9)))
    ok('...none for any other id', boxCorners(d, 'root') === null)
    const F = focusBox(d, HAZE_ID)
    ok('a double-click frames the region itself', !!F && F.measured === true, JSON.stringify(F))
    const R = M.find(d, HAZE_ID).node
    eq('the Transform gizmo\'s cubes stretch its size', Object.keys(stretchOf(R) || {}).sort(), ['x', 'y', 'z'])
    const S = stretchOf(R).y, wide = stretched(R, S, 2, startOf(R, S))
    ok('...a cube pulled: twice as deep along its y', near(wide.size.y, 8), JSON.stringify(wide))
    ok('the visibility: 3.912 mean free paths (Koschmieder)', near(visibilityOf(10), 39.12, 0.01))
    const k = changeUnit(d, 'mm', 'dimensions')
    ok('a unit change by the numbers: its place and its size times 10, the rest as it was', !!k && d.haze.transform.pos.x === 100
        && d.haze.params.size.z === 60 && d.haze.transform.scale === 1.5, JSON.stringify(d.haze))
    const m = structuredClone(d); changeUnit(m, 'm', 'keep')
    ok('...a unit change keeping the numbers: the numbers kept', m.haze.transform.pos.x === 100)
}

//----------------------------------------------------------------------------------------------------------------------
// the parameter registry: its place, its size and its dust, live
//----------------------------------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    ok('no haze: nothing in the registry', !sceneParams(d, {}).some(e => e.path.includes(HAZE_ID)))
    M.setHazeOn(d, true)
    const said = []
    const out = sceneParams(d, { live: (id, k) => said.push(`${id}.${k}`) })
    const paths = out.map(e => e.path)
    const P = s => `scene/${HAZE_ID}/${s}`
    ok('the registry has its place, its size and its three settings', [P('transform/position'), P('size'), P('haze/mfp'), P('haze/albedo'), P('haze/g')].every(p => paths.includes(p)),
        paths.filter(p => p.includes(HAZE_ID)).join(', '))
    out.find(e => e.path === P('haze/mfp')).set(3)
    ok('...a setting written through it reaches the scene\'s haze and is pushed live', hazeSettings(d.haze).mfp === 3 && said.includes(`${HAZE_ID}.haze`), said.join())
    out.find(e => e.path === P('haze/g')).set(2)
    ok('...and held within its limit', hazeSettings(d.haze).g === HAZE_G_MAX)
    M.setHazeOn(d, false)
    ok('off: not offered', !sceneParams(d, {}).some(e => e.path.includes(HAZE_ID)))
    M.setHazeOn(d, true)
    M.setAnimated(d, P('haze/mfp'), true)
    ok('a value of it flagged animated: kept with it, and listed', JSON.stringify(d.haze.animate) === '["haze/mfp"]' && M.animatedPaths(d).includes(P('haze/mfp')))
}

console.log(`hazebox: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
