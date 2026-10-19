//======================================================================================================================
// Component parameters through the builder (demo.js live, pushBound; model.js version 18): a group's parameter moved
// live moves every value bound to it, as a drag of each would. Run: node builder/test/bindlive.test.mjs
//
// Over dataapply.test.mjs's stand-in renderer and device (copied: each test runs alone). What it shows:
//   - codegen: a bound parameter and a bound transform written as their uniforms, no compile;
//   - codegen: an array's count bound, and changed -- a compile asked of the host (onRestructure), as a path's new
//     pieces ask: the panel and the registry do not read live()'s answer;
//   - as data: the bound values written into the records, no compile;
//   - the parameter registry offers the group's parameter and not the values bound to it;
//   - a compile resolves first: a node moved into a component takes its values at that compile.
//   - a light's own settings (0.69.0): its flux and colour from a lamp's parameters, written as its face's uniforms at
//     a compile and live -- the luminance derived from the bound flux and size, never from the values before them.
// What it cannot show is the picture: the user's.
//======================================================================================================================
import * as M from '../model.js'
import * as P from '../project.js'
import { sceneParams } from '../params.js'
import { sceneTextOf, SCENE_DATA_KEYS } from '../../lib/pathtracer/core/uniforms.schema.js'
import { UNITS } from '../../lib/pathtracer/core/photometry.js'
import { lightRGBObject } from '../lights.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const { installBuilder } = await import('../demo.js')

/* a device that records: each buffer's last write */
const writes = []
const WG = {
    createStorageBuffer(bytes) {
        const b = { size: bytes, destroyed: false, destroy() { this.destroyed = true }, last: null }
        return { b, w(d) { b.last = new Float32Array(d); writes.push(b) } }
    },
    createBuffer(bytes) {             // the records' uniform copy (scenedata.js RECORDS_IN_UNIFORM)
        const b = { size: bytes, destroyed: false, destroy() { this.destroyed = true }, last: null }
        return { b, w(d) { b.last = new Float32Array(d) } }
    },
}
const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}\n${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }),
              makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), device: { limits: { maxStorageBuffersPerShaderStage: 16 } } }

function standIn() {
    let state = { sceneData: 1 }
    const RT = {
        scene: null, compiles: 0, swaps: 0, invalidated: 0,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state),
        settings: () => ({}), applySettings: () => [],
        invalidate() { RT.invalidated++ },
        updateScene(p) { for (const [k, v] of Object.entries(p)) RT.scene[k] = v; return [] },
        async setScene(s) {
            RT.compiles++
            const before = RT.scene
            if (s.init) s.buffers = await s.init(WG)
            if (before && before !== s) before.dispose?.()
            RT.scene = s
            state = { sceneData: state.sceneData, ...Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)])) }
            return 1
        },
        // lib/pathtracer/index.js updateSceneData, as it is there
        updateSceneData(next) {
            const S = RT.scene
            if (!S?.writeData || !(next?.data instanceof Float32Array)) return false
            if (sceneTextOf(S) !== sceneTextOf(next)) return false
            if (!S.writeData(next.data)) return false
            for (const k of SCENE_DATA_KEYS) if (k in next) S[k] = next[k]
            for (const [k, u] of Object.entries(next.uniforms || {})) if (k in state) state[k] = structuredClone(u.def)
            RT.swaps++
            return true
        },
    }
    return RT
}
const u32 = (d, i) => new Uint32Array(d.buffer, d.byteOffset + 4 * i, 1)[0]
const records = d => { const out = []; for (let i = HEADER; i < u32(d, 0); i += REC) out.push(i); return out }
const objectsIn = d => records(d).filter(i => u32(d, 4 * i) === KIND.OBJECT).length
const lastWrite = () => writes.at(-1)?.last

const lens = () => {
    const d = P.blankScene('lens')
    M.addGroup(d, 'root', { id: 'lens', params: { diameter: 2, height: 0.5 } })
    M.addObject(d, 'lens', { id: 'body', primitive: 'cylinder' })
    M.addObject(d, 'lens', { id: 'cap', primitive: 'box' })
    M.setBindings(d, 'body', 'radius = diameter / 2')
    M.setBindings(d, 'cap', 'pos.z = height')
    M.addGroup(d, 'root', { id: 'strip', params: { count: 3, pitch: 0.5 } })
    M.addObject(d, 'strip', { id: 'led', primitive: 'sphere' })
    M.setBindings(d, 'strip', 'copies.count = count\ncopies.pitch = pitch')
    M.addObject(d, 'root', { id: 'loose', primitive: 'sphere' })
    return d
}
/* A LAMP (0.69.0): its flux, its tint and its width are the group's; a rectangle light inside reads all three */
const lamp = () => {
    const d = P.blankScene('lamp')
    M.addGroup(d, 'root', { id: 'lamp', params: { flux: 100, tint: { r: 1, g: 0.5, b: 0.25 }, w: 0.5 } })
    M.addLight(d, 'lamp', { id: 'led', shape: 'rectangle' })
    M.setBindings(d, 'led', 'light.flux = flux\nlight.colour = tint\nwidth = w')
    return d
}
/* the luminance a Lambertian rectangle of width w and height 1 emitting `flux` has (sources.js syncSources: pi A L) */
const lambertL = (d, flux, w) => flux / (Math.PI * w * 1 * (UNITS[d.unit] ?? 1) ** 2)
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))
const sameRGB = (a, b) => !!a && ['r', 'g', 'b'].every(k => near(a[k], b[k]))

const log = console.log, warn = console.warn
console.log = () => { }; console.warn = () => { }
const got = {}
try {
    // ---- codegen
    {
        const RT = standIn(); RT.set({ sceneData: 0 })
        // the renderer told of a move at every live value (lib/pathtracer/interaction.js: fast while moving)
        RT.interacting = { n: 0, poke() { RT.interacting.n++ } }
        const B = installBuilder({}, { RT, gpu, project: P.createProject([lens()]) })
        await B.apply()
        let asked = 0
        B.onRestructure = () => asked++
        const n0 = RT.compiles
        M.find(B.doc, 'lens').node.params.diameter = 3
        const took = B.live('lens', 'diameter')
        got.radius = [took, RT.get().radius_body, M.find(B.doc, 'body').node.params.radius, RT.compiles - n0, asked]
        M.find(B.doc, 'lens').node.params.height = 0.75
        B.live('lens', 'height')
        const xf = RT.get().xf_cap
        got.cap = [Array.isArray(xf) ? xf[14] : xf?.[14] ?? JSON.stringify(xf), RT.compiles - n0, asked]
        // the same count, another pitch: the copies' uniforms, live
        M.find(B.doc, 'strip').node.params.pitch = 1
        got.pitch = [B.live('strip', 'pitch'), asked]
        // another count: only a compile has the uniforms for it
        M.find(B.doc, 'strip').node.params.count = 5
        got.count = [B.live('strip', 'count'), asked, M.find(B.doc, 'strip').node.copies.length]
        got.poked = RT.interacting.n
        // the registry: the group's parameters, not what is bound to them
        const paths = sceneParams(B.doc).map(e => e.path)
        got.registry = [paths.includes('scene/lens/diameter'), paths.includes('scene/body/radius'), paths.includes('scene/body/height'),
                        paths.includes('scene/cap/transform/position'), paths.includes('scene/cap/transform/rotation')]
        // a node moved into the component takes its values at the next compile
        M.move(B.doc, 'loose', 'lens'); M.setBindings(B.doc, 'loose', 'radius = height')
        M.find(B.doc, 'lens').node.params.height = 0.25
        await B.apply()
        got.moved = [M.find(B.doc, 'loose').node.params.radius, RT.scene.uniforms.radius_loose?.def]
    }
    // ---- a light's own settings, codegen and as data
    for (const data of [0, 1]) {
        const RT = standIn(); RT.set({ sceneData: data })
        const B = installBuilder({}, { RT, gpu, project: P.createProject([lamp()]) })
        const G = () => M.find(B.doc, 'lamp').node.params
        /* changed in the document, then compiled: the compile resolves the flux and the width before it derives the
           luminance from them (demo.js build) -- after, it compiled the luminance of 100 lm over 0.5 */
        G().flux = 300; G().w = 0.25
        await B.apply()
        const U = RT.scene.uniforms
        const g = { compiled: [near(U.emissiveLuminance_led?.def, lambertL(B.doc, 300, 0.25)), sameRGB(U.emissive_led?.def, lightRGBObject({ colour: G().tint }))] }
        let asked = 0
        B.onRestructure = () => asked++
        const n0 = RT.compiles
        // live: the lamp's flux, then its tint, then its width -- each the face's uniforms, no compile
        G().flux = 600
        const tookF = B.live('lamp', 'flux')
        const lF = RT.get().emissiveLuminance_led
        G().tint.g = 1
        const tookT = B.live('lamp', 'tint')
        const cT = RT.get().emissive_led
        G().w = 1
        const tookW = B.live('lamp', 'w')
        g.live = [tookF, near(lF, lambertL(B.doc, 600, 0.25)), tookT, sameRGB(cT, lightRGBObject({ colour: { r: 1, g: 1, b: 0.25 } })),
                  tookW, near(RT.get().emissiveLuminance_led, lambertL(B.doc, 600, 1)), RT.compiles - n0, asked]
        // the registry: the lamp's parameters, not the light's settings bound to them (its others still there)
        const paths = sceneParams(B.doc).map(e => e.path)
        g.registry = ['scene/lamp/flux', 'scene/lamp/tint', 'scene/led/light/flux', 'scene/led/light/colour', 'scene/led/width',
                      'scene/led/light/emitN'].map(x => paths.includes(x))
        got[`light${data}`] = g
    }
    // ---- as data
    {
        const RT = standIn()
        const B = installBuilder({}, { RT, gpu, project: P.createProject([lens()]) })
        await B.apply()
        const n0 = RT.compiles, S = RT.scene
        const before = lastWrite()
        M.find(B.doc, 'lens').node.params.diameter = 4
        const took = B.live('lens', 'diameter')
        const after = lastWrite()
        // the radius is in the records' parameters: find a 2 (the radius once) and a 2 not there before
        const has = (d, v) => d && Array.from(d).some(x => Math.abs(x - v) < 1e-6)
        got.data = [took, RT.compiles - n0, RT.scene === S, after !== before, has(after, 2) && !has(before, 2)]
        let asked = 0
        B.onRestructure = () => asked++
        M.find(B.doc, 'strip').node.params.count = 6
        got.dataCount = [B.live('strip', 'count'), asked, RT.compiles - n0]
    }
} finally { console.log = log; console.warn = warn }

ok('codegen: a group\'s parameter moved, the bound radius written as its uniform, no compile, none asked',
    JSON.stringify(got.radius) === JSON.stringify([true, 1.5, 1.5, 0, 0]), JSON.stringify(got.radius))
ok('codegen: a bound position written into its transform\'s uniform', got.cap[0] === 0.75 && got.cap[1] === 0 && got.cap[2] === 0, JSON.stringify(got.cap))
ok('codegen: an array\'s pitch from its parameter: the copies\' uniforms, live', JSON.stringify(got.pitch) === JSON.stringify([true, 0]), JSON.stringify(got.pitch))
ok('every live value tells the renderer a move is under way (RT.interacting.poke: fast while moving), a compile-asking one too',
    got.poked === 4, `${got.poked}`)
ok('codegen: its count from its parameter: not live, and a compile asked of the host', JSON.stringify(got.count) === JSON.stringify([false, 1, 5]), JSON.stringify(got.count))
ok('the registry: the component\'s parameter, not the values bound to it (the rest of the node\'s are there)',
    JSON.stringify(got.registry) === JSON.stringify([true, false, true, false, true]), JSON.stringify(got.registry))
ok('a node moved into a component and bound: its value from the component at the next compile', JSON.stringify(got.moved) === JSON.stringify([0.25, 0.25]), JSON.stringify(got.moved))
ok('as data: the bound radius written into the records, no compile, the same scene', JSON.stringify(got.data) === JSON.stringify([true, 0, true, true, true]), JSON.stringify(got.data))
ok('as data: an array\'s count from its parameter is data too -- no compile asked', JSON.stringify(got.dataCount) === JSON.stringify([true, 0, 0]), JSON.stringify(got.dataCount))
for (const data of [0, 1]) {
    const g = got[`light${data}`], how = data ? 'as data' : 'codegen'
    ok(`${how}: a light's flux and colour from its lamp's parameters, compiled with the luminance of the flux and width resolved first`,
        JSON.stringify(g.compiled) === JSON.stringify([true, true]), JSON.stringify(g.compiled))
    ok(`${how}: the lamp's flux, tint and width moved live: the face's luminance and colour follow, no compile, none asked`,
        JSON.stringify(g.live) === JSON.stringify([true, true, true, true, true, true, 0, 0]), JSON.stringify(g.live))
    ok(`${how}: the registry offers the lamp's parameters, not the light settings bound to them; its others it does`,
        JSON.stringify(g.registry) === JSON.stringify([true, true, false, false, false, true]), JSON.stringify(g.registry))
}

console.log(`bindings through the builder: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
