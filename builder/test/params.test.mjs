//======================================================================================================================
// Tests for the scene's entries in the parameter registry (builder/params.js; the registry itself is
// lib/shell/test/params.test.mjs's). Run: node builder/test/params.test.mjs
//
// THE CHECK THAT MATTERS is the first block: every LIVE entry of every bundled scene, set, names a
// uniform the generated scene declares. A registry entry that writes the document and pokes a uniform
// the shader does not have changes nothing on screen, and neither the timeline nor an optimiser would
// ever say so -- they would sweep a value that does nothing and report the curve flat.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as M from '../model.js'
import { generate, uniformName, xfName, blendName, paramUniform } from '../codegen.js'
import { SCENE_FILES } from '../../scenes/index.js'
import { sceneParams, makeAfter } from '../params.js'
import { makeParams } from '../../lib/shell/params.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

//----------------------------------------------------------------------------------------------
// EVERY BUNDLED SCENE: every live entry writes a uniform the scene declares
//----------------------------------------------------------------------------------------------
const dir = fileURLToPath(new URL('../../scenes/', import.meta.url))
let total = 0
for (const name of SCENE_FILES) {
    const doc = M.parse(readFileSync(dir + name, 'utf8'))
    const calls = []
    const hooks = { live: (id, k) => calls.push(['live', id, k]), commit: k => calls.push(['commit', k]),
                    structure: () => calls.push(['structure']), syncSources: () => { } }
    const entries = sceneParams(doc, hooks)
    total += entries.length
    const paths = entries.map(e => e.path)
    ok(`${name}: paths are unique`, new Set(paths).size === paths.length, paths.filter((p, i) => paths.indexOf(p) !== i).join(', '))
    const disabled = new Set()
    M.walk(doc, (n, parent) => { if (n.enabled === false || disabled.has(parent?.id)) disabled.add(n.id) })
    const g = generate(M.toTree(doc), { id: 'built', title: doc.title })
    const bad = [], shape = []
    for (const e of entries) {
        const v = e.get()
        if ((e.dims | 0) > 1 ? !(Array.isArray(v) && v.length === e.dims && v.every(Number.isFinite)) : !Number.isFinite(v)) shape.push(e.path)
        calls.length = 0
        e.set(v)                                     // the same value: what it touches is the point
        const pushed = calls.filter(c => c[0] === 'live')
        if (e.kind === 'live' && !pushed.length) bad.push(`${e.path}: set pushed nothing`)
        // a structural entry set to what it holds may do nothing; it must never poke a uniform alone
        if (e.kind === 'structural' && pushed.length && !calls.some(c => c[0] === 'structure')) bad.push(`${e.path}: structural, but pushed a uniform and asked no compile`)
        for (const [, id, k] of pushed) {
            if (disabled.has(id)) continue           // not declared while disabled; live() says false
            /* A MATERIAL FIELD IN THE SHADER ONLY WHILE IN USE (materials.js `only`: the colour depth, 0.37.0), at a value
               not in use: not declared, by design -- its first value in use is a compile, which live() asks for (the
               builder block below drives it). Declared it would be an error the other way: codegen's text changed */
            const fieldOnly = M.material(doc, id) && M.MATERIAL_FIELDS[k]?.only
            if (fieldOnly && !fieldOnly(M.material(doc, id).params[k], M.material(doc, id).params)) {
                if (uniformName(id, k) in g.uniforms) bad.push(`${e.path}: not in use, but declared`)
                continue
            }
            // the environment's settings are the renderer's own (model.js ENVIRONMENT), not scene uniforms
            if (id === M.ENVIRONMENT_ID) { if (!(k in M.ENVIRONMENT)) bad.push(`${e.path}: '${k}' is not an environment setting`); continue }
            const want = k === 'transform' ? [xfName(id)] : k === 'blend' ? [blendName(id)]
                : k === 'light' ? (M.hasFace(M.find(doc, id)?.node.light) ? [uniformName(id, 'emissive'), uniformName(id, 'emissiveLuminance')] : [])
                : [paramUniform(id, k)]               // a node's, a material's, or its relief's (<id>#relief)
            for (const u of want) if (!(u in g.uniforms)) bad.push(`${e.path}: '${u}' is not declared`)
        }
    }
    ok(`${name}: every entry reads as its dims say`, !shape.length, shape.join(', '))
    ok(`${name}: every live entry writes a uniform the scene declares`, !bad.length, bad.slice(0, 6).join('\n      '))
}
ok('the bundled scenes have parameters at all', total > 50, `${total}`)

//----------------------------------------------------------------------------------------------
// WHAT A CHANGE DOES, entry by entry
//----------------------------------------------------------------------------------------------
{
    const doc = M.createDoc()
    const g = M.addGroup(doc, 'root', { label: 'G', blend: 0 })
    const o = M.addObject(doc, g.id, { primitive: 'sphere', label: 'Ball' })
    M.addParam(doc, o.id, 'k', 3); M.setConstant(doc, o.id, 'k', 'u32')
    const L = M.addLight(doc, 'root', { shape: 'rectangle', label: 'Panel' })
    const calls = []
    const hooks = { live: (id, k) => calls.push(`live ${id}.${k}`), commit: k => calls.push(`commit ${k}`),
                    structure: () => calls.push('structure'), onLabel: () => calls.push('label') }
    const P = makeParams()
    P.provide('scene', () => sceneParams(doc, hooks))
    const run = (path, v, quiet) => { calls.length = 0; quiet ? P.apply({ [path]: v }) : P.write(path, v); return calls.slice() }

    eq('a transform: the mat4 pushed, one undo step keyed to the node', run(`scene/${o.id}/transform/position`, [1, 2, 3]),
        [`live ${o.id}.transform`, `commit ${o.id}.transform`])
    eq('...and the document holds it', o.transform.pos, { x: 1, y: 2, z: 3 })
    eq('quiet (the timeline): pushed, no undo step', run(`scene/${o.id}/transform/scale`, 2, true), [`live ${o.id}.transform`])
    eq('a compile-time parameter recompiles', run(`scene/${o.id}/k`, 4.6), ['commit null', 'structure'])
    eq('...rounded, it is a u32', o.params.k, 5)
    eq('a blend within a union\'s CSG is live', (g.blend = 0.1, run(`scene/${g.id}/blend`, 0.2)), [`live ${g.id}.blend`, `commit ${g.id}.blend`])
    eq('a blend back to 0 on a union changes how the children combine: a compile', run(`scene/${g.id}/blend`, 0), ['label', 'commit null', 'structure'])
    eq('...and then the entry says it is structural', P.get(`scene/${g.id}/blend`).kind, 'structural')
    eq('a union at 0 set to 0 pushes nothing (it has no blend uniform)', run(`scene/${g.id}/blend`, 0), [`commit ${g.id}.blend`])
    eq('off 0 again: a compile', run(`scene/${g.id}/blend`, 0.3), ['label', 'commit null', 'structure'])
    /* A CHILD'S OWN JOIN BLEND (model version 14): an entry only while it has one, live by the group's rule */
    const cutter = M.addObject(doc, g.id, { primitive: 'sphere', label: 'Hole', join: 'subtract' })
    P.provide('scene', () => sceneParams(doc, hooks))
    ok('no own blend, no entry', !P.get(`scene/${cutter.id}/join/blend`))
    M.setJoinBlend(doc, cutter.id, 0.05)
    P.provide('scene', () => sceneParams(doc, hooks))
    eq('with one: an entry, live while the group combines', P.get(`scene/${cutter.id}/join/blend`)?.kind, 'live')
    eq('...a set pushes jblend_<id>, one undo step', run(`scene/${cutter.id}/join/blend`, 0.08), [`live ${cutter.id}.jblend`, `commit ${cutter.id}.jblend`])
    eq('...and the document holds it', cutter.joinBlend, 0.08)
    // in a plain group (every child a union, no blend) an own blend's first move off 0 changes the code
    const flat = M.addGroup(doc, 'root', { label: 'Flat' })
    M.addObject(doc, flat.id, { primitive: 'box' })
    const soft = M.addObject(doc, flat.id, { primitive: 'sphere', joinBlend: 0 })
    P.provide('scene', () => sceneParams(doc, hooks))
    eq('an own blend of 0 in a plain group: structural', P.get(`scene/${soft.id}/join/blend`)?.kind, 'structural')
    eq('...and off 0 it makes the group combine: a compile', run(`scene/${soft.id}/join/blend`, 0.2), ['label', 'commit null', 'structure'])
    eq('a light\'s luminance: its face\'s uniforms', run(`scene/${L.id}/light/luminance`, 500), [`live ${L.id}.light`, `commit ${L.id}.light`])
    eq('...through the model', M.lightOf(M.find(doc, L.id).node).luminance, 500)
    // THE ENVIRONMENT: a scene without one takes the renderer's whole set the first time, then its own
    const renderer = { envMode: 0, sunIlluminance: 90000, uSunElevation: 40, studioColor: { r: 1, g: 1, b: 1 } }
    const P2 = makeParams()
    P2.provide('scene', () => sceneParams(doc, { ...hooks, environment: () => renderer }))
    eq('a scene without an environment reads the renderer\'s', P2.read('scene/environment/uSunElevation'), 40)
    calls.length = 0; P2.write('scene/environment/uSunElevation', 55)
    eq('setting one pushes it to the renderer, one undo step', calls, ['live #environment.uSunElevation', 'commit environment.uSunElevation'])
    const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
    eq('...and the scene now holds the renderer\'s whole set, with the change', sorted(doc.environment),
        sorted({ envMode: 0, sunIlluminance: 90000, uSunElevation: 55, studioColor: { r: 1, g: 1, b: 1 } }))
    renderer.sunIlluminance = 1
    eq('from then on it reads its own, whatever the renderer has', P2.read('scene/environment/sunIlluminance'), 90000)
    P2.write('scene/environment/studioColor', [0.5, 0.5, 1])
    eq('a colour is stored as the renderer\'s {r, g, b}', doc.environment.studioColor, { r: 0.5, g: 0.5, b: 1 })
    let refused = false
    try { M.setEnvironment(doc, { sunIlluminance: -5 }) } catch { refused = true }
    ok('the model refuses a value out of the setting\'s range, and keeps what it had', refused && doc.environment.sunIlluminance === 90000)
    refused = false
    try { M.setEnvironment(doc, { exposureEV: 3 }) } catch { refused = true }
    ok('...and a setting that is not the environment\'s', refused && !('exposureEV' in doc.environment))
    ok('a scene with an environment saves and loads with it', M.parse(M.serialize(doc)).environment.uSunElevation === 55)
    // a node deleted is gone from the next call: providers are never cached
    M.remove(doc, o.id)
    ok('a removed node\'s entries are gone at once', !P.has(`scene/${o.id}/transform/position`))
    // the panel's own path through the same functions
    const A = makeAfter(hooks)
    calls.length = 0
    const w = console.warn; console.warn = () => { }           // the model's refusal, on purpose
    A.light(doc, M.find(doc, L.id).node, { halfAngle: -5 })
    console.warn = w
    eq('a light setting the model refuses changes nothing and pushes nothing', calls, [])
}

// THE SCENE'S UNIT beside a length, the position and a light's size -- and not beside what is not one
{
    const doc = M.createDoc(); doc.unit = 'cm'
    const s = M.addObject(doc, 'root', { primitive: 'sphere' })
    const t = M.addGroup(doc, 'root', { label: 'twist', params: { rate: 1, extent: 1 }, lengths: ['extent'] })
    const L = M.addLight(doc, 'root', { shape: 'disc' })
    const unit = path => sceneParams(doc, { live: () => { }, commit: () => { }, structure: () => { }, syncSources: () => { } })
        .find(e => e.path === path)?.unit
    eq('a length, the position and a light\'s size are in the scene\'s unit',
        [unit(`scene/${s.id}/radius`), unit(`scene/${s.id}/transform/position`), unit(`scene/${L.id}/radius`), unit(`scene/${t.id}/extent`)],
        ['cm', 'cm', 'cm', 'cm'])
    eq('...a rate is not', unit(`scene/${t.id}/rate`), undefined)
    // a material's lengths are real mm whatever the scene's (materials.js MATERIAL_CODE_TEMPLATE), as its relief's are
    const mt = M.addMaterial(doc, { params: { ...M.addMaterial(M.createDoc(), {}).params, size: 8, amount: 0.5 } })
    mt.lengths = ['size']
    eq('a material\'s length is in mm in a cm scene, its other numbers in nothing',
        [unit(`scene/${mt.id}/size`), unit(`scene/${mt.id}/amount`), unit(`scene/${mt.id}/roughness`)], ['mm', undefined, undefined])
}

// THE PANEL'S NUMBER FIELDS (lib/guistuff PropertyTable, vendored): a min alone is a field unbounded above.
// `!options.min` read a min of 0 as no range given and capped the field at max(its value when drawn, 100):
// a light's flux could not be raised past what it was (the user, 2026-09-28). Fixed in GUISTUFF itself.
{
    const { PropertyTable } = await import('../../lib/guistuff/propertytable/propertytable.js')
    const prep = o => PropertyTable.prototype.bindingPrepper.call({}, { v: 250 }, 'v', o).options
    eq('a flux field (min 0, no max) has no ceiling', prep({ min: 0 }).max, undefined)
    eq('...a field with no range at all still gets the default, widened to hold its value', [prep({}).min, prep({}).max], [0, 250])
    eq('...and a range given is left as given', [prep({ min: 0, max: 10 }).min, prep({ min: 0, max: 10 }).max], [0, 10])
}

//----------------------------------------------------------------------------------------------
// A 2D PARAMETER (the pyramid's base and top since 2026-10-01, the first {x, y} on a builder shape): two dimensions
// in the registry, written back as two -- it was read as x, y, z and came back with z = NaN, a vec3 -- and its
// uniform a vec2 the scene declares
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const o = M.addObject(d, 'root', { primitive: 'pyramid', id: 'py' })
    const calls = []
    const hooks = { live: (id, k) => calls.push([id, k]), commit: () => { }, structure: () => { }, syncSources: () => { } }
    const base = sceneParams(d, hooks).find(e => e.path === 'scene/py/base')
    const g = generate(M.toTree(d))
    ok('a 2D parameter is two dimensions', base?.dims === 2 && JSON.stringify(base.get()) === '[1,1]', JSON.stringify(base && { dims: base.dims, v: base.get() }))
    base.set([1.5, 0.5])
    ok('...set, it writes two numbers into the document and stays 2D', JSON.stringify(o.params.base) === '{"x":1.5,"y":0.5}', JSON.stringify(o.params.base))
    ok('...and pushes its uniform, which the scene declares a vec2', calls.some(c => c[0] === 'py' && c[1] === 'base') && g.uniforms[uniformName('py', 'base')]?.type === 'vec2<f32>',
        JSON.stringify([calls, g.uniforms[uniformName('py', 'base')]]))
}

//----------------------------------------------------------------------------------------------
// A PROFILE AND A PATH are the shader's own text (codegen writes their points as code): never live, never in the
// registry -- a slider on one would have read { path } as a vector with no x, or a list of points as numbers
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    M.addObject(d, 'root', { primitive: 'sphere', id: 'sw' })
    M.addParam(d, 'sw', 'outline', M.DEFAULT_PROFILE())
    M.addParam(d, 'sw', 'route', M.DEFAULT_PATH())
    const paths = sceneParams(d, { live: () => { }, commit: () => { }, structure: () => { }, syncSources: () => { } }).map(e => e.path)
    ok('neither a profile nor a path is a registry entry; the object\'s numbers still are',
        !paths.includes('scene/sw/outline') && !paths.includes('scene/sw/route') && paths.includes('scene/sw/radius'), paths.join(', '))
}

//----------------------------------------------------------------------------------------------
// THE COLOUR DEPTH THROUGH THE REAL BUILDER (materials.js `only`, demo.js live): from 0 its first value in use asks
// for the compile -- from the registry, as the timeline and the properties panel reach it -- and once compiled it is a
// uniform written live; back to 0 compiles nothing (the uniform stays declared, its 0 meaning none)
//----------------------------------------------------------------------------------------------
{
    const WG = { createStorageBuffer: bytes => ({ b: { size: bytes, destroy() { } }, w() { } }), createBuffer: bytes => ({ b: { size: bytes, destroy() { } }, w() { } }) }
    const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}\n${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }),
                  makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), device: { limits: { maxStorageBuffersPerShaderStage: 16 } } }
    let state = { sceneData: 0 }
    const RT = {
        scene: null,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state), settings: () => ({}), applySettings: () => [], updateScene: () => [],
        async setScene(s) {
            if (s.init) s.buffers = await s.init(WG)
            RT.scene = s
            state = { sceneData: 0, ...Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)])) }
            return 1
        },
    }
    const P = await import('../project.js')
    const d = P.blankScene('depth')
    const glass = M.addMaterial(d, { label: 'glass', preset: 'glass' })
    M.addObject(d, 'root', { id: 'pane', primitive: 'box', material: glass.id })
    const log = console.log; console.log = () => { }
    const { installBuilder } = await import('../demo.js')
    const B = installBuilder({}, { RT, gpu, project: P.createProject([d]) })
    let asked = 0
    B.onRestructure = () => { asked++ }
    await B.apply()
    const u = uniformName(glass.id, 'attenuationDistance')
    const PR = makeParams()
    PR.provide('scene', () => sceneParams(B.doc, { live: (id, k) => B.live(id, k), commit: () => { } }))
    const path = `scene/${glass.id}/attenuationDistance`
    ok('the colour depth at 0: an entry, live, saying its first use compiles; no uniform', PR.get(path)?.kind === 'live'
        && /first such value compiles/.test(PR.get(path)?.help ?? '') && !(u in RT.scene.uniforms))
    PR.write(path, 5)
    ok('...set above 0 through the registry: the compile asked (live() on a field not declared yet)', asked === 1 && M.material(B.doc, glass.id).params.attenuationDistance === 5, String(asked))
    await B.apply()
    ok('...compiled: declared, with the value', u in RT.scene.uniforms && state[u] === 5)
    PR.write(path, 7)
    ok('...then live: written, no compile', asked === 1 && state[u] === 7, `${asked} ${state[u]}`)
    PR.write(path, 0)
    ok('...back to 0: written, no compile (the uniform stays, its 0 meaning none)', asked === 1 && state[u] === 0, `${asked} ${state[u]}`)

    /* A COATING (materials.js coating, 0.39.0): none, and the registry offers `coating` alone -- its values are in no
       shader, and one moved would be a compile that changes nothing. Put on through the registry: one compile asked;
       compiled, its six uniforms declared with the values and the material's case calling coatMaterial; its values
       then live; taken off, live too (coat 0 is none in the shader) */
    const cu = k => uniformName(glass.id, k)
    const cpath = k => `scene/${glass.id}/${k}`
    ok('no coating: the registry offers coating, not its values; nothing of it declared', PR.get(cpath('coating'))?.kind === 'live'
        && !PR.get(cpath('coatLow')) && !PR.get(cpath('coatEdge')) && !['coating', ...M.COAT_FIELDS].some(k => cu(k) in RT.scene.uniforms)
        && !RT.scene.wgsl?.includes?.('coatMaterial(m,'))
    PR.write(cpath('coating'), 1)
    ok('...put on through the registry: the compile asked once', asked === 2 && M.material(B.doc, glass.id).params.coating === 1, String(asked))
    await B.apply()
    ok('...compiled: the six declared with their values', ['coating', ...M.COAT_FIELDS].every(k => cu(k) in RT.scene.uniforms && state[cu(k)] === M.material(B.doc, glass.id).params[k]),
        ['coating', ...M.COAT_FIELDS].map(k => `${k}=${state[cu(k)]}`).join(' '))
    ok('...and the registry offers its values now, live, saying they are there while it has a coating',
        M.COAT_FIELDS.every(k => PR.get(cpath(k))?.kind === 'live') && /while the material has a coating/.test(PR.get(cpath('coatEdge'))?.help ?? ''))
    PR.write(cpath('coatEdge'), 520)
    PR.write(cpath('coatLow'), 0.25)
    ok('...a value moved: written, no compile', asked === 2 && state[cu('coatEdge')] === 520 && state[cu('coatLow')] === 0.25, `${asked}`)
    PR.write(cpath('coating'), 3)
    ok('...where it is, moved between faces: written, no compile', asked === 2 && state[cu('coating')] === 3)
    PR.write(cpath('coating'), 0)
    ok('...taken off: written, no compile (coat 0 is none in the shader)', asked === 2 && state[cu('coating')] === 0, `${asked}`)
    console.log = log
}

console.log(`params: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
