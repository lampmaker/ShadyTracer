//======================================================================================================================
// Tests for the haze box (hazebox.js; version 22). Run: node builder/test/hazebox.test.mjs
//
// The box as a document object: added, validated, one a scene, saved and loaded, copied, its settings set and checked,
// an old file read. Emitted as nothing, and handed to the renderer as the scene's `haze`: where it is in the world for
// a box moved, turned, scaled, nested in a turned group and in an array (its first copy), what it says while hidden,
// and that its presence is text to the data path (sceneTextOf) while its values are not. The Transform gizmo's cubes,
// the outline's corners, the focus's box, and the parameter registry's rows. What it does to light is
// lib/pathtracer/core/test/haze.test.mjs's and haze.gpu.mjs's; how it looks is the user's to judge.
//======================================================================================================================
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { hazeOf, hazeNode, hazeProblems, hazeSettings, HAZE_DEFAULTS, visibilityOf, HAZE_G_MAX } from '../hazebox.js'
import { boxCorners } from '../exportbox.js'
import { stretchOf } from '../stretch.js'
import { focusBox } from '../focus.js'
import { sceneParams } from '../params.js'
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
// the box in the document
//----------------------------------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    const before = generate(...M.generateArgs(d))
    ok('a scene without a haze box says nothing about one (its kernels\' text is as before)', !('haze' in before) && hazeOf(d) === null && hazeNode(d) === null)
    const h = M.addHazeBox(d, 'root', { id: 'dust', size: { x: 2, y: 3, z: 4 } })
    eq('a haze box is an object of type haze, with a size and no material', [h.kind, h.type, h.material, h.params], ['object', 'haze', null, { size: { x: 2, y: 3, z: 4 } }])
    eq('...and a sound document', M.validate(d), [])
    eq('its settings default', hazeSettings(h), { ...HAZE_DEFAULTS })
    const back = M.parse(M.serialize(d))
    eq('it saves and loads as it was', M.find(back, 'dust').node, h)
    throws('one a scene: a second is refused', () => M.addHazeBox(d, 'root', { id: 'more' }), /one a scene/)
    const two = structuredClone(d); two.root.children.push({ ...structuredClone(h), id: 'dust2' })
    ok('...and a file with two does not load', M.validate(two).some(p => /second haze box/.test(p)), M.validate(two).join('; '))
    M.setHaze(d, 'dust', { mfp: 5, albedo: { r: 0.5, g: 0.6, b: 0.7 }, g: 0.3 })
    eq('settings are set', h.haze, { mfp: 5, albedo: { r: 0.5, g: 0.6, b: 0.7 }, g: 0.3 })
    M.setHaze(d, 'dust', { albedo: { ...HAZE_DEFAULTS.albedo } })
    eq('...and one set back to its default is dropped', h.haze, { mfp: 5, g: 0.3 })
    throws('a mean free path of 0 is refused', () => M.setHaze(d, 'dust', { mfp: 0 }), /mean free path/)
    throws('an albedo past 1 is refused', () => M.setHaze(d, 'dust', { albedo: { r: 1.2, g: 0, b: 0 } }), /albedo/)
    throws(`a g past ${HAZE_G_MAX} is refused (a delta lobe light sampling cannot weigh)`, () => M.setHaze(d, 'dust', { g: 0.99 }), /g must/)
    throws('an unknown setting is refused', () => M.setHaze(d, 'dust', { density: 3 }), /unknown/)
    throws('a flat box is refused', () => M.addHazeBox(M.createDoc(), 'root', { size: { x: 1, y: 0, z: 1 } }), /size/)
    throws('addObject will not make one', () => M.addObject(d, 'root', { type: 'haze' }), /addHazeBox/)
    throws('it takes no parameters of its own', () => M.addParam(d, 'dust', 'radius', 1), /no parameter/)
    const bad = structuredClone(d); M.find(bad, 'dust').node.material = 'x'
    ok('a file with a box that has a material does not load', M.validate(bad).some(p => /no material/.test(p)))
    ok('hazeProblems: a sound box has none', hazeProblems(h).length === 0)

    const after = generate(...M.generateArgs(d))
    ok('it draws nothing: the SDF is the one without it, plus a comment', after.wgsl.replace(/^\s*\/\/ node \w+ \(haze\).*\n/gm, '') === before.wgsl,
        after.wgsl.split('\n').filter(l => !before.wgsl.includes(l)).join('\n'))
    ok('...its transform and size declared uniforms, as an export box\'s, so a drag or a slider is not refused', ['xf_dust', 'size_dust'].every(k => k in after.uniforms))
    eq('it does not change the scene\'s size estimate', after.extent, before.extent)
    ok('the scene hands the renderer its haze', after.haze?.id === 'dust' && after.haze.on === true && after.haze.mfp === 5 && after.haze.g === 0.3
        && JSON.stringify(after.haze.albedo) === JSON.stringify([0.9, 0.9, 0.9]), JSON.stringify(after.haze))
    vnear('...its half-sizes', after.haze.half, [1, 1.5, 2])
    ok('...and to the data path its presence is text, its values are not', sceneTextOf(after) !== sceneTextOf(before)
        && (() => { const d2 = structuredClone(d); M.setHaze(d2, 'dust', { mfp: 50 }); return sceneTextOf(generate(...M.generateArgs(d2))) === sceneTextOf(after) })())
    // as data too: a generation with every node kept
    const data = generate(...M.generateArgs(d, { data: true }))
    ok('...made as data, it is there too', data.haze?.id === 'dust')

    // hidden: pruned without live visibility (the box gone, a compile), kept and off with it (no compile)
    M.setEnabled(d, 'dust', false)
    ok('hidden, without live visibility: no haze in the scene', !('haze' in generate(...M.generateArgs(d))))
    d.liveVisibility = true
    const lv = generate(...M.generateArgs(d))
    ok('...with live visibility: there, and off -- so the eye compiles nothing', lv.haze?.on === false && hazeUniforms(lv.haze, 1, 0).hazeC[3] === 0, JSON.stringify(lv.haze))
    delete d.liveVisibility
    M.setEnabled(d, 'dust', true)

    const copy = M.duplicate(structuredClone(d), 'ball')
    ok('another object duplicated: no second box', copy.type !== 'haze')

    // an old file: version 21 reads as 22 with nothing changed -- and on to the current version (23: a group's material, also nothing)
    const old = structuredClone(d); old.version = 21; old.root.children = old.root.children.filter(n => n.type !== 'haze')
    const up = M.parse(JSON.stringify(old))
    ok('a version 21 file is read as 22 and on, nothing changed', up.version === M.VERSION && M.VERSION >= 22 && M.validate(up).length === 0
        && JSON.stringify(up.root) === JSON.stringify(old.root))
}

//----------------------------------------------------------------------------------------------------------------------
// where it is in the world
//----------------------------------------------------------------------------------------------------------------------
{
    const d = M.createDoc(); d.unit = 'cm'
    // a group turned 90 degrees about z, scaled 2, moved; the box in it moved along its x and scaled 1.5
    M.addGroup(d, 'root', { id: 'g', transform: T([10, 0, 0], [0, 0, 90], 2) })
    M.addHazeBox(d, 'g', { id: 'dust', size: { x: 2, y: 4, z: 6 }, transform: T([1, 0, 0], [0, 0, 0], 1.5) })
    const h = hazeOf(d)
    // the box's origin: (1, 0, 0) in g, turned to (0, 1, 0), scaled 2 to (0, 2, 0), moved to (10, 2, 0)
    vnear('the centre through a turned, scaled, moved group', h.centre, [10, 2, 0], 1e-12)
    vnear('...its x axis turned to the world\'s y', h.axes[0], [0, 1, 0], 1e-12)
    vnear('...its y to -x', h.axes[1], [-1, 0, 0], 1e-12)
    vnear('...its half-sizes scaled by both (3)', h.half, [3, 6, 9], 1e-12)
    ok('...in the scene\'s units: the renderer turns them into metres', hazeUniforms(h, 0.01, 0).hazeC[0] === 0.1 && near(hazeUniforms(h, 0.01, 0).hazeU[3], 0.03))
    const S = generate(...M.generateArgs(d))
    eq('codegen\'s haze is the document\'s', S.haze, h)
    // in an array: its first copy's place
    const a = M.createDoc()
    M.addGroup(a, 'root', { id: 'arr' })
    M.setCopies(a, 'arr', [T([5, 0, 0]), T([9, 0, 0])])
    M.addHazeBox(a, 'arr', { id: 'dust' })
    vnear('in an array: the first copy\'s place', hazeOf(a).centre, [5, 0, 0], 1e-12)
    ok('hazeNode finds it anywhere', hazeNode(a)?.id === 'dust')
    // the outline and the focus
    const C = boxCorners(d, 'dust')
    ok('the outline\'s corners: eight, around the centre', C?.length === 8 && C.reduce((s, c) => s.map((v, k) => v + c[k] / 8), [0, 0, 0]).every((v, k) => near(v, h.centre[k], 1e-9)))
    const F = focusBox(d, 'dust')
    ok('a double-click frames the box itself', !!F && F.measured === true, JSON.stringify(F))
    eq('the Transform gizmo\'s cubes stretch its size, as an export box\'s', Object.keys(stretchOf(M.find(d, 'dust').node) || {}).sort(), ['x', 'y', 'z'])
    ok('the visibility: 3.912 mean free paths (Koschmieder)', near(visibilityOf(10), 39.12, 0.01))
}

//----------------------------------------------------------------------------------------------------------------------
// the parameter registry: its size and its dust, live
//----------------------------------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    M.addHazeBox(d, 'root', { id: 'dust' })
    const said = []
    const out = sceneParams(d, { live: (id, k) => said.push(`${id}.${k}`) })
    const paths = out.map(e => e.path)
    ok('the registry has its size and its three settings', ['scene/dust/size', 'scene/dust/haze/mfp', 'scene/dust/haze/albedo', 'scene/dust/haze/g'].every(p => paths.includes(p)),
        paths.filter(p => p.includes('dust')).join(', '))
    const mfp = out.find(e => e.path === 'scene/dust/haze/mfp')
    mfp.set(3)
    ok('...a setting written through it reaches the document and is pushed live', hazeSettings(M.find(d, 'dust').node).mfp === 3 && said.includes('dust.haze'), said.join())
    const g = out.find(e => e.path === 'scene/dust/haze/g')
    g.set(2)
    ok('...and held within its limit', hazeSettings(M.find(d, 'dust').node).g === HAZE_G_MAX)
}

console.log(`hazebox: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
