//======================================================================================================================
// ANIMATED VALUES (model.js setAnimated, builder/animate.js, the bake keeping them uniforms). Run:
//   node builder/test/animate.test.mjs
//
// No GPU. What is checked:
//   - the flag in the model: set and cleared by registry path, on nodes, materials, a relief and the environment; listed
//     in the scene row's order; refused for a compile-time value and for a path that names nothing; following its
//     parameter renamed, removed, made compile-time or a path; kept by a copy and a library round trip; not counted
//     when a pasted material is matched to the scene's;
//   - THE NAMING HELD TO THE REAL ONE: animate.js liveUniformsOf is a second copy of demo.js liveValue's naming, so every
//     live entry of every bundled scene is set through the real builder over a renderer that records what it is told,
//     and what it writes of the scene's uniforms must be exactly what liveUniformsOf says;
//   - a component parameter flagged keeps what is bound to it, and through a group's parameter bound to it, on;
//   - the bake with flags: the flagged uniforms kept, read as UB.<name>, everything else a constant as before;
//   - the registry: entries flagged `animated`, shown() and onlyAnimated, the timeline's list following them.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as M from '../model.js'
import * as P from '../project.js'
import { SCENE_FILES } from '../../scenes/index.js'
import { sceneParams } from '../params.js'
import { liveKeyOfPath, liveUniformsOf, animatedKeys, keptUniforms } from '../animate.js'
import { generate, uniformName, xfName, blendName } from '../codegen.js'
import { baked, BAKE_PREFIX } from '../bake.js'
import { makeParams } from '../../lib/shell/params.js'
import { liveRegistry } from '../../tools/timeline.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; process.stdout.write(`FAIL  ${name}${extra ? '\n      ' + extra : ''}\n`) }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = f => { try { f(); return false } catch (e) { return e instanceof M.ModelError } }

/* ---- THE FLAG IN THE MODEL ---- */
{
    const d = M.createDoc()
    M.ensureMaterial(d)
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    M.addGroup(d, 'root', { id: 'g' })
    M.addObject(d, 'g', { id: 'cube', primitive: 'box' })
    const mat = d.materials[0]
    M.setAnimated(d, 'scene/ball/radius', true)
    M.setAnimated(d, 'scene/g/transform/position', true)
    M.setAnimated(d, `scene/${mat.id}/roughness`, true)
    M.setAnimated(d, 'scene/environment/sunIlluminance', true)
    eq('flags kept on their owners, relative', [M.find(d, 'ball').node.animate, M.find(d, 'g').node.animate, mat.animate, d.root.animate],
       [['radius'], ['transform/position'], ['roughness'], ['environment/sunIlluminance']])
    eq('listed: the environment, the nodes in tree order, then the materials', M.animatedPaths(d),
       ['scene/environment/sunIlluminance', 'scene/ball/radius', 'scene/g/transform/position', `scene/${mat.id}/roughness`])
    ok('isAnimated', M.isAnimated(d, 'scene/ball/radius') && !M.isAnimated(d, 'scene/cube/size'))
    M.setAnimated(d, 'scene/ball/radius', true)
    eq('flagged twice: once', M.find(d, 'ball').node.animate, ['radius'])
    M.setAnimated(d, 'scene/ball/radius', false)
    ok('unflagged: the field goes when empty', !('animate' in M.find(d, 'ball').node))
    ok('a path naming nothing refused', throws(() => M.setAnimated(d, 'scene/nope/radius', true)) && throws(() => M.setAnimated(d, 'renderer/x', true)))
    ok('the root itself refused (its own values are none)', throws(() => M.setAnimated(d, `scene/${d.root.id}/envRadius`, true)))
    // a relief: its own object
    M.setRelief(d, mat.id, Object.keys(M.RELIEFS)[0])
    const rk = Object.keys(mat.relief.params).find(k => typeof mat.relief.params[k] === 'number' && !mat.relief.constants?.[k])
    M.setAnimated(d, `scene/${M.reliefOwner(mat.id)}/${rk}`, true)
    eq('a relief\'s flag on its material, as #relief/<name> (a relief\'s fields are a closed list)', mat.animate, ['roughness', `#relief/${rk}`])
    ok('...listed after its material\'s', M.animatedPaths(d).at(-1) === `scene/${M.reliefOwner(mat.id)}/${rk}`)
    ok('...a relief\'s flags read through the relief\'s own markings', M.isAnimated(d, `scene/${M.reliefOwner(mat.id)}/${rk}`))
    const keepRelief = structuredClone(mat.relief)
    M.setRelief(d, mat.id, null)
    eq('the relief taken away: its flags with it, the material\'s own kept', mat.animate, ['roughness'])
    mat.relief = keepRelief; mat.animate.push(`#relief/${rk}`)
    // follows its parameter: renamed, removed, made compile-time, made a path
    const code = M.addObject(d, 'root', { id: 'k', primitive: 'sphere' })
    M.addParam(d, 'k', 'wobble', 0.5)
    M.setAnimated(d, 'scene/k/wobble', true)
    M.renameParam(d, 'k', 'wobble', 'wiggle')
    eq('renamed: the flag follows', M.find(d, 'k').node.animate, ['wiggle'])
    M.setConstant(d, 'k', 'wiggle', 'f32')
    ok('made compile-time: the flag goes', !M.find(d, 'k').node.animate)
    ok('...and a compile-time value cannot be flagged', throws(() => M.setAnimated(d, 'scene/k/wiggle', true)))
    M.setConstant(d, 'k', 'wiggle', null)
    M.setAnimated(d, 'scene/k/wiggle', true)
    M.removeParam(d, 'k', 'wiggle')
    ok('removed: the flag goes', !M.find(d, 'k').node.animate, JSON.stringify(code.animate))
    // a copy keeps it, under its own id
    M.setAnimated(d, 'scene/ball/radius', true)
    const cp = M.duplicate(d, 'ball')
    ok('duplicated: the copy flagged too, under its id', M.isAnimated(d, `scene/${cp.id}/radius`))
    const asset = M.extractAsset(d, 'ball')
    const into = M.createDoc(); M.ensureMaterial(into)
    const put = M.insertAsset(into, asset)
    ok('through the library (an asset): kept', M.isAnimated(into, `scene/${put.id}/radius`))
    // a pasted material matched to the scene's own whatever its flags
    const bare = structuredClone(mat); delete bare.animate
    ok('sameMaterial: flags are not what the stuff is', M.sameMaterial({ ...structuredClone(mat), id: 'x' }, { ...bare, id: 'y' }))
    const bad = M.validate(d)
    ok('the document with flags is sound', bad.length === 0, JSON.stringify(bad))
    eq('...and its flags survive a save', M.animatedPaths(M.parse(M.serialize(d))), M.animatedPaths(d))
}

/* ---- WHAT A FLAG KEEPS ---- */
{
    eq('a path to its live key', ['scene/a/radius', 'scene/a/transform/rotation', 'scene/a/join/blend', 'scene/a/light/cct', 'scene/environment/sunIlluminance', 'scene/m1#relief/scale']
        .map(liveKeyOfPath), [{ id: 'a', k: 'radius' }, { id: 'a', k: 'transform' }, { id: 'a', k: 'jblend' }, { id: 'a', k: 'light' },
                              { id: M.ENVIRONMENT_ID, k: 'sunIlluminance' }, { id: 'm1#relief', k: 'scale' }])
    // a component: the group's parameter is no uniform; what is bound to it is -- and on, through a group bound to it
    const d = M.createDoc()
    M.ensureMaterial(d)
    M.addGroup(d, 'root', { id: 'lens', params: { diameter: 2 } })
    M.addObject(d, 'lens', { id: 'body', primitive: 'sphere' })
    M.addGroup(d, 'lens', { id: 'inner', params: { d2: 1 } })
    M.addObject(d, 'inner', { id: 'cap', primitive: 'box' })
    M.setBindings(d, 'body', 'radius = diameter / 2')
    M.setBindings(d, 'inner', 'd2 = diameter\npos.z = diameter')
    M.setBindings(d, 'cap', 'pos.x = d2')
    M.setAnimated(d, 'scene/lens/diameter', true)
    const keys = [...animatedKeys(d).keys()].map(k => k.replace('\n', '.')).sort()
    eq('a component parameter: what reads it, and what reads what it moves', keys, ['body.radius', 'cap.transform', 'inner.d2', 'inner.transform', 'lens.diameter'].sort())
    const S = generate(...M.generateArgs(d, { id: 'built' }))
    const keep = keptUniforms(d, S)
    ok('...kept: the bound values\' uniforms', keep.has(uniformName('body', 'radius')) && keep.has(xfName('inner')) && keep.has(xfName('cap')),
       JSON.stringify([...keep]))
    const B = baked(S, { live: n => /^bx(lo|hi)_/.test(n) || keep.has(n) })
    const declared = [...keep].filter(n => n in S.uniforms)
    ok('the bake with flags: each flagged uniform kept and read as UB.<name>, the rest constants', declared.length > 0
        && declared.every(n => n in B.uniforms && B.baked.kept.includes(n) && !B.wgsl.includes(BAKE_PREFIX + n))
        && declared.some(n => B.wgsl.includes(`UB.${n}`))
        && B.baked.names.length === Object.keys(S.uniforms).length - B.baked.kept.length
        && B.baked.names.every(n => !keep.has(n) && !/^bx(lo|hi)_/.test(n)), JSON.stringify(B.baked.kept))
    // a CSG group's blend
    M.setJoin(d, 'body', 'subtract')
    M.setBlend(d, 'lens', 0.1)
    M.setAnimated(d, 'scene/lens/blend', true)
    ok('a group\'s blend', keptUniforms(d, generate(...M.generateArgs(d, { id: 'built' }))).has(blendName('lens')))
}

/* ---- THE NAMING HELD TO THE BUILDER'S: every live entry of every bundled scene, through the real builder ---- */
{
    const WG = { createStorageBuffer: bytes => ({ b: { size: bytes, destroy() { } }, w() { } }), createBuffer: bytes => ({ b: { size: bytes, destroy() { } }, w() { } }) }
    const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}\n${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }),
                  makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), device: { limits: { maxStorageBuffersPerShaderStage: 16 } } }
    let state = { sceneData: 0 }
    let written = []
    const RT = {
        scene: null,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { written.push(k); if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state), settings: () => ({}), applySettings: () => [], updateScene: () => [],
        async setScene(s) {
            if (s.init) s.buffers = await s.init(WG)
            RT.scene = s
            state = { sceneData: 0, ...Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)])) }
            return 1
        },
    }
    const log = console.log, warn = console.warn; console.log = () => { }
    const { installBuilder } = await import('../demo.js')
    const dir = fileURLToPath(new URL('../../scenes/', import.meta.url))
    let checked = 0
    for (const name of SCENE_FILES) {
        const doc = M.parse(readFileSync(dir + name, 'utf8'))
        M.ensureMaterial(doc)
        const B = installBuilder({}, { RT, gpu, project: P.createProject([doc]) })
        B.onRestructure = () => { }
        const r = await B.apply()
        if (!r.ok) { ok(`${name}: applies over the stand-in`, false, String(r.report).slice(0, 200)); continue }
        const bad = []
        const entries = sceneParams(B.doc, { live: (id, k) => B.live(id, k), syncSources: () => B.syncSources?.() })
        for (const e of entries) {
            if (e.kind !== 'live') continue
            const lk = liveKeyOfPath(e.path)
            const U = RT.scene.uniforms
            const want = liveUniformsOf(B.doc, lk.id, lk.k, RT.scene).filter(n => n in U).sort()
            const wrote = v => { written = []; e.set(v, { quiet: true }); return [...new Set(written.filter(n => n in U))].sort() }
            /* THE SAME VALUE: exactly what it names -- but a flux light's luminance, which follows its size only when the
               size moves (sources.js syncSources) */
            const v0 = e.get()
            const same = wrote(v0), follows = n => lk.k !== 'light' && M.find(B.doc, lk.id)?.node.type === 'light' && n === uniformName(lk.id, 'emissiveLuminance')
            if (JSON.stringify(same) !== JSON.stringify(want.filter(n => !follows(n))))
                bad.push(`${e.path}: wrote ${JSON.stringify(same)}, liveUniformsOf says ${JSON.stringify(want)}`)
            /* ANOTHER VALUE: nothing it does not name -- the direction that matters, since a write the bake made a constant
               would be refused and the picture left as it was (demo.js live stays baked on liveUniformsOf's word) */
            if (!e.options) {
                const nudge = x => x + (Math.abs(x) > 1e-6 ? x * 0.01 : 0.001)
                const moved = wrote(Array.isArray(v0) ? v0.map(nudge) : nudge(v0))
                const extra = moved.filter(n => !want.includes(n))
                if (extra.length) bad.push(`${e.path} moved: wrote ${JSON.stringify(extra)}, which liveUniformsOf does not name`)
                wrote(v0)
            }
            checked++
        }
        ok(`${name}: every live value writes exactly the uniforms liveUniformsOf names`, !bad.length, bad.slice(0, 5).join('\n      '))
    }
    console.log = log; console.warn = warn
    ok('the bundled scenes\' live values were checked', checked > 50, `${checked}`)
}

/* ---- THE REGISTRY: animated entries, the filter, the timeline's list ---- */
{
    const d = M.createDoc()
    M.ensureMaterial(d)
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    M.addObject(d, 'root', { id: 'cube', primitive: 'box' })
    const PR = makeParams()
    PR.provide('scene', () => sceneParams(d, {}))
    PR.provide('renderer', () => [{ path: 'renderer/x', label: 'x', get: () => 1, set: () => { } }])
    const R = liveRegistry(PR)
    ok('nothing flagged: no filter, every entry shown, the timeline offers all', !PR.anyAnimated() && !PR.onlyAnimated()
        && PR.shown().length === PR.list().length && R.list().length === PR.list().filter(p => p.kind !== 'structural').length)
    M.setAnimated(d, 'scene/ball/radius', true)
    M.setAnimated(d, 'scene/cube/transform/rotation', true)
    eq('flagged: entries say so', PR.list().filter(p => p.animated).map(p => p.path).sort(), ['scene/ball/radius', 'scene/cube/transform/rotation'])
    ok('...the filter on by default: shown() and the timeline\'s + track the animated alone', PR.onlyAnimated()
        && JSON.stringify(PR.shown().map(p => p.path).sort()) === JSON.stringify(['scene/ball/radius', 'scene/cube/transform/rotation'])
        && R.list().length === 2)
    ok('...list() and get() still whole: a track on a value not flagged plays on', PR.list().length > 2 && !!R.get('scene/ball/transform/position'))
    ok('...and its header says it is not animated', /\(not animated\)$/.test(R.get('scene/ball/transform/position').label) && !/not animated/.test(R.get('scene/ball/radius').label))
    PR.setOnlyAnimated(false)
    ok('a person unticks it: everything again', !PR.onlyAnimated() && PR.shown().length === PR.list().length && R.list().length > 2)
    PR.setOnlyAnimated(null)
    ok('back to the default', PR.onlyAnimated())
    M.setConstant(d, 'ball', 'radius', 'f32')
    ok('a compile-time value is never `animated` (its flag went with the marking)', !PR.get('scene/ball/radius').animated)
}

console.log(`animate: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
