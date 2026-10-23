//======================================================================================================================
// THE WINDOW OF AN ARRAY ON A REAL WEBGPU (0.next; builder/arrays.js). Run: node builder/test/arraywindow.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package (npm i -g webgpu) and a Vulkan driver
// (lavapipe: apt-get install mesa-vulkan-drivers), or it says so and passes. Dawn compiles with Tint.
//
// A row of spheres in a turned and scaled group, a ring of boxes, a ring of rows of spheres (an array in an array), and
// a row of light faces -- beside a sphere of their own at the top -- their content boxes given through the real
// cullBoxes (from boxes made by the estimate, as measured ones would be), generated with the window and without it,
// codegen, as data and baked (the build the page shows once edits stop), the SDF run on Dawn:
//   - at points on every surface (moved onto them by the field's own distance and normal): the same distance and the
//     same material with the window as without -- exact, where the march decides a hit and the normal is taken;
//   - at points all round: never above the field without the window (a lower bound, safe to march by), and below it
//     somewhere (the copies left out did stand in by their bound);
//   - and with every box unknown, the text the window's and the field the one without it, everywhere.
// WHAT IT CANNOT SHOW: speed, or the picture -- the user's (Tests > lightarray, BENCH.lightarray).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(array window GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, boxLoName, boxHiName } = await import('../codegen.js')
const { estimateBox } = await import('../bounds.js')
const { cullBoxes, cullUniforms } = await import('../boxes.js')
const { baked } = await import('../bake.js')
const { liveInBench } = await import('../../bench/bake.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { computeUniformTypes, sceneConstantsWGSL, UniformSpec } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])            // kept: the Dawn instance must outlive the device (scenedata.gpu.mjs)
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(array window GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}
console.warn = () => { }

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* the field at each point (s.xyzw, the material): every resource named in main, so each is bound (lightarray.gpu.mjs) */
async function field(scene, pts) {
    const n = pts.length / 3
    const touch = Object.keys(scene.resources || {}).map(k => `_ = ${k}[0];`).join(' ')
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.wgsl}`, `
        _ = UB.res; _ = evalIn[0]; ${touch}
        let i = gid.x;
        if (i >= ${n}u) { return; }
        let h = SDF(newRay(evalIn[i].xyz, VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.0));
        evalOut[8u * i] = h.s.x; evalOut[8u * i + 1u] = h.s.y; evalOut[8u * i + 2u] = h.s.z; evalOut[8u * i + 3u] = h.s.w;
        evalOut[8u * i + 4u] = f32(h.m);`, computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) },
        { async: false, wg: [64, 1, 1] })
    await prog.ready
    const input = new Float32Array(4 * n)
    for (let i = 0; i < n; i++) input.set(pts.slice(3 * i, 3 * i + 3), 4 * i)
    const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(32 * n)
    const buffers = scene.init ? await scene.init(WG) : {}
    prog.resources = { evalIn: inB.b, evalOut: outB.b, ...buffers }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    return out
}

let seed = 4242
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const N = 3072
const at = (x, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale })

/* THE BOXES, as measured ones would be: each node's estimate in its own frame, a cell of 0.01 -- through the real
   cullBoxes, which makes the content boxes the window reads */
const boxesOf = doc => {
    const own = id => { const n = M.find(doc, id)?.node; return n ? estimateBox({ kind: 'group', children: [{ ...n, transform: null }] }) : null }
    const B = { fresh: () => true, get: id => { const e = own(id); return e ? { ...e, cell: 0.01 } : null }, missing: () => [] }
    return { top: cullBoxes(doc, B), nested: cullBoxes(doc, B, { nested: true }) }
}
/* the scene with its content boxes written, as the page writes them: codegen's uniforms, or the records */
const withBoxes = (scene, doc, { data }) => {
    // in place, on a scene made for it: a data scene's buffers are made from its own `data` (scenedata.js attachData)
    const out = scene
    out.uniforms = structuredClone(scene.uniforms)
    const { top, nested } = boxesOf(doc)
    if (data) { out.data = scene.dataOf(M.toTree(doc, { keepDisabled: true }), nested).data; return out }
    for (const [id, b] of top) {
        if (!(boxLoName(id) in out.uniforms)) continue
        const { lo, hi } = cullUniforms(b)
        out.uniforms[boxLoName(id)].def = lo; out.uniforms[boxHiName(id)].def = hi
    }
    return out
}
/* points moved onto the nearest surface by the field's own distance and normal, a few times */
async function onSurfaces(scene, pts) {
    const P = pts.slice()
    for (let it = 0; it < 6; it++) {
        const h = await field(scene, P)
        for (let i = 0; i < N; i++) {
            const o = 8 * i, d = h[o + 3], nn = [h[o], h[o + 1], h[o + 2]], l = Math.hypot(...nn)
            if (l > 0.5 && Math.abs(d) < 1e6) for (let k = 0; k < 3; k++) P[3 * i + k] -= nn[k] / l * d
        }
    }
    return P
}

const SCENES = {
    'a row of 16 spheres, turned and scaled': () => {
        const d = M.createDoc({})
        M.addGroup(d, 'root', { id: 'rowg', transform: at(0.2, -0.3, 0.1, 15, -20, 35, 1.3) })
        M.addObject(d, 'rowg', { id: 'ball', primitive: 'sphere', params: { radius: 0.1 }, transform: at(0, 0.05, 0) })
        M.setCopies(d, 'rowg', M.copiesRow(16, 0.3, 'x'))
        M.addObject(d, 'root', { id: 'lone', primitive: 'sphere', params: { radius: 0.4 }, transform: at(0, 1.5, 0) })
        return d
    },
    'a ring of 16 boxes about z': () => {
        const d = M.createDoc({})
        M.addGroup(d, 'root', { id: 'ringg' })
        M.addObject(d, 'ringg', { id: 'tooth', primitive: 'box', params: { size: { x: 0.12, y: 0.05, z: 0.2 }, rounding: 0.01 } })
        M.setCopies(d, 'ringg', M.copiesRing(16, 1, 'z'))
        M.addObject(d, 'root', { id: 'lone', primitive: 'sphere', params: { radius: 0.3 } })
        return d
    },
    'a ring of 8 rows of 6 spheres (an array in an array)': () => {
        const d = M.createDoc({})
        M.addGroup(d, 'root', { id: 'outer', transform: at(0, 0, 0.3, 90, 0, 0) })
        M.addGroup(d, 'outer', { id: 'inner', transform: at(0.8, 0, 0, 0, 0, 90) })
        M.addObject(d, 'inner', { id: 'bead', primitive: 'sphere', params: { radius: 0.05 } })
        M.setCopies(d, 'inner', M.copiesRow(6, 0.12, 'x'))
        M.setCopies(d, 'outer', M.copiesRing(8, 0, 'z'))
        M.addObject(d, 'root', { id: 'lone', primitive: 'box', params: { size: { x: 0.2, y: 0.2, z: 0.2 }, rounding: 0 }, transform: at(0, 0, -1) })
        return d
    },
    'a row of 12 light faces': () => {
        const d = M.createDoc({})
        M.addGroup(d, 'root', { id: 'leds', transform: at(0, 0, 0.5, 180, 0, 0) })
        M.addLight(d, 'leds', { id: 'led', shape: 'rectangle', params: { width: 0.04, height: 0.04 } })
        M.setCopies(d, 'leds', M.copiesRow(12, 0.08, 'x'))
        // (a small one aside, not a floor: a floor would take most of the points moved onto a surface, and few the faces)
        M.addObject(d, 'root', { id: 'lone', primitive: 'sphere', params: { radius: 0.05 }, transform: at(0, 0.6, 0.5) })
        return d
    },
}

for (const [label, make] of Object.entries(SCENES)) {
    const doc = make()
    ok(`${label}: a sound scene`, M.validate(doc).length === 0, JSON.stringify(M.validate(doc)))
    const world = estimateBox(M.toTree(doc))
    const scatter = grow => Array.from({ length: 3 * N }, (_, i) => { const k = i % 3, c = (world.lo[k] + world.hi[k]) / 2, h = (world.hi[k] - world.lo[k]) * grow / 2 + 0.2; return c + (2 * rnd() - 1) * h })
    for (const [how, data, bake] of [['codegen', false, false], ['as data', true, false], ['baked', false, true]]) {
        const make2 = arrayWindow => {
            const s = generate(...M.generateArgs(doc, { id: `aw-${data ? 'd' : 'c'}`, data, arrayWindow }))
            return bake ? baked(s, { live: liveInBench }) : s
        }
        const plain = make2(false), win0 = make2(true)
        ok(`${how}: the window in the text, none without it`, /fn arrWindow/.test(win0.wgsl) && !/fn arrWindow/.test(plain.wgsl))
        const win = withBoxes(make2(true), doc, { data })
        const off = withBoxes(make2(false), doc, { data })
        // ON EVERY SURFACE: exact
        const S = await onSurfaces(off, scatter(1))
        const a = await field(off, S), b = await field(win, S)
        let near = 0, differ = 0, worst = 0
        for (let i = 0; i < N; i++) {
            const o = 8 * i
            if (Math.abs(a[o + 3]) > 1e-3) continue
            near++
            const r = Math.abs(a[o + 3] - b[o + 3])
            if (r > 1e-6 || a[o + 4] !== b[o + 4]) { differ++; worst = Math.max(worst, r) }
        }
        ok(`${how}, ${label}: on every surface (${near} points) the same distance and material with the window`, near > 100 && differ === 0,
            `${differ} differ, by up to ${worst}`)
        /* ALL ROUND: a lower bound, and a bound somewhere -- half the points scattered, half near the surfaces (within a
           fifth of a unit of them): the window works inside an array's own box, which the top-level culling leaves to it,
           and few points scattered over the scene fall in a row's thin box */
        const F = scatter(2.5).map((v, i) => (Math.floor(i / 3) % 2) ? S[i] + (rnd() - 0.5) * 0.4 : v)
        const u = await field(off, F), c = await field(win, F)
        let above = 0, below = 0
        for (let i = 0; i < N; i++) {
            const o = 8 * i, du = Math.abs(u[o + 3]), dc = Math.abs(c[o + 3])
            if (dc > du * (1 + 1e-5) + 1e-6) above++
            if (dc < du * (1 - 1e-3)) below++
        }
        ok(`${how}, ${label}: all round, never above the field without the window, and below it at ${below} of ${N}`, above === 0 && below > 0,
            `${above} above, ${below} below`)
        // ...AND WITH NO BOX KNOWN: every copy, the same field -- against the scene without the window and without boxes
        const z = await field(win0, F), u0 = await field(plain, F)
        let moved = 0
        for (let i = 0; i < N; i++) if (Math.abs(z[8 * i + 3] - u0[8 * i + 3]) > 1e-6 * Math.max(1, Math.abs(u0[8 * i + 3]))) moved++
        ok(`${how}, ${label}: with no box known, the field without the window`, moved === 0, `${moved} differ`)
    }
}

console.log(`array window on Dawn: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
