//======================================================================================================================
// A JOIN'S SHAPE ON A GPU (model version 28, 0.next): the round and chamfer joins' WGSL (scene_api.js csgRound*,
// csgChamfer*) through codegen and the scene as data, on a WebGPU in node (Dawn). Run:
//   node builder/test/roundjoin.gpu.mjs     (optional: npm i -g webgpu, and lavapipe; says so and passes without)
//
// WHAT IT SHOWS: for documents made here -- a hole's rim rounded and chamfered (a box less a cylinder), two boxes at
// 60 degrees intersected round, an L of two boxes joined by a round union (a concave fillet), the same turned and
// scaled, and as data -- the scene's SDF at points in and around each against the document as import/test/docsdf.mjs
// computes it in JS: the presets' exact distances, combined by builder/joins.js (the WGSL's twin), with each side's
// normal its gradient. And the hole's rim against its closed form, the torus a filleted rim is.
//   THE TWO BUILDS ONE DISTANCE: the renderer marches, and casts every ray that leaves a surface, in the distance-only
// build (scene_api.js FOLD_DIST), and shades with the full one. At every point, codegen and as data, the two must give
// the same distance. They did not: the joins read their inputs' normals into the distance, and the distance-only build
// has none -- the user's fillets came out black in every mode (2026-11-04); its scene is among the documents here, and
// the whole renderer draws it with no black pixel.
// WHAT IT CANNOT SHOW: the picture, which is the user's.
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { nodeSDF } from '../../import/test/docsdf.mjs'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(round join GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate } = await import('../codegen.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE, SCENE_PRELUDE_DIST } = await import('../../lib/pathtracer/core/scene_api.js')
const { computeUniformTypes, sceneConstantsWGSL, UniformSpec } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
// the Dawn instance in a global: held in a local it was collected, and the next wait crashed (scenedata.gpu.mjs)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)        // as the page does (app.html)
} catch (e) {
    console.log(`(round join GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}
console.warn = () => { }

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

/* the uniforms the renderer would have: every schema default, what derive() works out for the scene, the scene's own */
const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* THE SCENE'S SDF AT A LIST OF POINTS: its distance and material, each point with a direction of its own */
async function field(scene, pts, dirs, prelude = SCENE_PRELUDE) {
    const prog = await WG.makeCompute(`${prelude}${sceneConstantsWGSL(scene)}${scene.wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&evalIn) / 2u) { return; }
        let h = SDF(newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0));
        evalOut[2u * i] = h.s.w; evalOut[2u * i + 1u] = f32(h.m);`,
        computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) },
        { async: false, wg: [64, 1, 1] })
    await prog.ready
    const n = pts.length
    const input = new Float32Array(8 * n)
    for (let i = 0; i < n; i++) { input.set(pts[i], 8 * i); input.set(dirs[i], 8 * i + 4) }
    const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(8 * n)
    const buffers = scene.init ? await scene.init(WG) : {}
    prog.resources = { evalIn: inB.b, evalOut: outB.b, ...buffers }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    return out
}


//----------------------------------------------------------------------------------------------------------------------
// THE DOCUMENTS (in mm, as an import's)
//----------------------------------------------------------------------------------------------------------------------
const T = (x, y, z, rz = 0, s = 1, rx = 0) => ({ pos: { x, y, z }, rot: { x: rx, y: 0, z: rz }, scale: s })
const box = (d, g, id, size, extra = {}) => M.addObject(d, g, { id, primitive: 'box', params: { size: { x: size[0], y: size[1], z: size[2] }, rounding: 0 }, ...extra })
const doc = () => { const d = M.ensureMaterial(M.createDoc({ title: 'joins' })); d.unit = 'mm'; return d }
const DOCS = {
    'a hole\'s rim rounded': () => {
        const d = doc()
        M.addGroup(d, 'root', { id: 'part', blend: 0.3 })
        box(d, 'part', 'plate', [2, 2, 0.5])
        M.addObject(d, 'part', { id: 'hole', primitive: 'cylinder', params: { radius: 0.6, height: 3 }, join: 'subtract', joinShape: 'round' })
        return d
    },
    'a hole\'s rim chamfered': () => {
        const d = doc()
        M.addGroup(d, 'root', { id: 'part', blend: 0.3 })
        box(d, 'part', 'plate', [2, 2, 0.5])
        M.addObject(d, 'part', { id: 'hole', primitive: 'cylinder', params: { radius: 0.6, height: 3 }, join: 'subtract', joinShape: 'chamfer' })
        return d
    },
    'two boxes at 60 degrees, intersected round': () => {
        const d = doc()
        M.addGroup(d, 'root', { id: 'part' })
        box(d, 'part', 'a', [1, 1, 1])
        box(d, 'part', 'b', [1, 1, 1.5], { join: 'intersect', joinBlend: 0.25, joinShape: 'round', transform: T(0.5, 0, 0, 30) })
        return d
    },
    'an L of two boxes, a round union (a concave fillet)': () => {
        const d = doc()
        M.addGroup(d, 'root', { id: 'part' })
        box(d, 'part', 'a', [1.2, 0.3, 0.5])
        box(d, 'part', 'b', [0.3, 1.2, 0.5], { joinBlend: 0.3, joinShape: 'round', transform: T(-0.9, 0.9, 0) })
        box(d, 'part', 'c', [0.2, 0.2, 2], { join: 'subtract', transform: T(0.6, 0, 0) })
        return d
    },
    'the same turned and scaled, chamfered': () => {
        const d = doc()
        M.addGroup(d, 'root', { id: 'part', transform: T(0.2, -0.1, 0.1, 25, 1.3, 10) })
        box(d, 'part', 'a', [1.2, 0.3, 0.5])
        box(d, 'part', 'b', [0.3, 1.2, 0.5], { joinBlend: 0.3, joinShape: 'chamfer', transform: T(-0.9, 0.9, 0, 0, 0.9) })
        return d
    },
    /* THE USER'S SCENE (2026-11-04, its fillet black): a cylinder standing in a rounded box, a round union */
    USER: () => {
        const d = doc()
        M.addGroup(d, 'root', { id: 'part' })
        M.addObject(d, 'part', { id: 'base', primitive: 'box', params: { size: { x: 1, y: 1, z: 0.5 }, rounding: 0.02 } })
        M.addObject(d, 'part', { id: 'post', primitive: 'cylinder', params: { radius: 0.5, height: 1 }, joinBlend: 0.174, joinShape: 'round', transform: T(0, 0, 0.5035392) })
        return d
    },
}
const USER = 'a cylinder standing in a rounded box, a round union (the user\'s scene)'
DOCS[USER] = DOCS.USER; delete DOCS.USER

let seed = 4242
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const N = 4096
const pts = [], dirs = []
for (let i = 0; i < N; i++) {
    pts.push([0, 1, 2].map(() => (2 * rnd() - 1) * 2.4))
    const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z)
    dirs.push([s * Math.cos(a), s * Math.sin(a), z])
}

for (const [name, make] of Object.entries(DOCS)) {
    const d = make()
    const asset = M.extractAsset(d, 'part')
    const want = pts.map(p => nodeSDF(asset.node, p, asset.blocks))
    for (const [how, opts] of [['codegen', {}], ['as data', { data: true }]]) {
        const scene = generate(M.toTree(d), { id: 'roundjoin', ...opts })
        if (opts.data && !scene.init) { ok(`${name} (${how}): the scene is data`, false, 'no records'); continue }
        const fn = /csgRound|csgChamfer/.test(scene.wgsl)
        ok(`${name} (${how}): the shaped join's functions in the text`, fn)
        const got = await field(scene, pts, dirs)
        /* the JS side's normals are gradients by differences, the shader's analytic: they differ where a box's
           gradient turns (inside it, on its medial planes), so a point is counted off only past 1e-3 and a few such
           are allowed (each said) */
        let off = 0, sign = 0, worst = 0, at = 0
        for (let i = 0; i < N; i++) {
            const e = Math.abs(got[2 * i] - want[i])
            if (e > 1e-3) off++
            if (Math.sign(got[2 * i]) !== Math.sign(want[i]) && Math.abs(want[i]) > 1e-3) sign++
            if (e > worst) { worst = e; at = i }
        }
        ok(`${name} (${how}): the field the JS twin's`, off <= N / 200 && sign <= N / 1000,
            `${off} of ${N} points off by more than 1e-3 (${sign} on the wrong side), worst ${worst.toFixed(4)} at `
            + `(${pts[at].map(v => v.toFixed(3)).join(', ')}): ${got[2 * at].toFixed(4)} for ${want[at].toFixed(4)}`)
        if (off) console.log(`      (${name}, ${how}: ${off} of ${N} past 1e-3, ${sign} on the wrong side)`)
        const dist = await field(scene, pts, dirs, SCENE_PRELUDE_DIST)
        let differ = 0, most = 0
        for (let i = 0; i < N; i++) { const e = Math.abs(dist[2 * i] - got[2 * i]); if (e > 1e-6) differ++; most = Math.max(most, e) }
        ok(`${name} (${how}): the distance-only build's distance the full build's everywhere (what the march and the shading each see)`,
            differ === 0, `${differ} of ${N} points differ, by up to ${most}`)
    }
}

// THE HOLE'S RIM AGAINST ITS CLOSED FORM: in (rho, z), the plate's top z = 0.5 and the wall rho = 0.6 filleted with
// radius 0.3 -- the fillet's centre at (0.9, 0.2), and a point near the rim at its distance from that circle
{
    const d = DOCS['a hole\'s rim rounded']()
    const scene = generate(M.toTree(d), { id: 'roundjoin' })
    const P = [], D = [], E = []
    for (let i = 0; i < 512; i++) {
        const a = 2 * Math.PI * rnd(), t = Math.PI / 2 * rnd(), rr = 0.3 + (rnd() - 0.5) * 0.2    // about the fillet, in its quarter
        const rho = 0.9 - rr * Math.cos(t), z = 0.2 + rr * Math.sin(t)
        P.push([rho * Math.cos(a), rho * Math.sin(a), z]); D.push([0, 0, 1]); E.push(rr - 0.3)
    }
    const got = await field(scene, P, D)
    let worst = 0
    for (let i = 0; i < P.length; i++) worst = Math.max(worst, Math.abs(got[2 * i] - E[i]))
    ok('the hole\'s rim: the torus a fillet of radius 0.3 is, to 1e-5', worst < 1e-5, worst)
}

/* THE WHOLE RENDERER ON THE USER'S SCENE (raytrace_main.js R.trace, every kernel): its fillet black was every path
   from it starting inside the solid, so no pixel may be black (the background is the sky's), Final and Sketch */
{
    const { RAYTRACER } = await import('../../lib/pathtracer/core/raytrace_main.js')
    const { CAMERA } = await import('../../lib/camera.js')
    const { engineCamera } = await import('../../lib/pathtracer/core/units.js')
    const { effective } = await import('../../lib/pathtracer/quality.js')
    const U = await import('../../lib/pathtracer/core/uniforms.schema.js')
    const { LUMA } = await import('../../lib/pathtracer/core/photometry.js')
    const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
        console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }
    const d = DOCS[USER]()
    const scene = generate(...M.generateArgs(d, { id: 'roundjoin-user' }))
    const W = 48, H = 48
    const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
    const cam = CAMERA({ aspect: W / H, fov: 40, up: [0, 0, 1] })
    cam.setPose({ pos: [1.6, -3.2, 2.2], target: [0, 0, 0.6], up: [0, 0, 1] })
    for (const [mode, renderMode] of [['Final', 0], ['Sketch', 2]]) {
        const Q = { w: W, h: H, resetframecount: 1 }
        const R = RAYTRACER(WG, null, Q, scene)
        R.hud = () => { }
        let err = null
        try { await quietly(() => R.init()) } catch (e) { err = e?.message ?? String(e) }
        const traced = effective({ ...U.defaultUniformValues(), maxaverages: 0, autoExposure: 0, renderMode, maxbounce: 4 })
        const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius, tolerance: scene.tolerance })
        const EC = engineCamera(cam.getUniforms(), 0, derived.sceneUnit)
        const bag = Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
            ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
            .filter(([k]) => k in U.ComputeUniformTypes || k in U.UniformSpec))
        for (const [k, u] of Object.entries(scene.uniforms || {})) bag[k] = flat(u.def)
        if (!err) try {
            R.kernelOptions = R.kernelOptionsOf(bag)
            await quietly(() => R.applyKernelOptions())
            await quietly(() => R.trace(Q, bag, 16, target))
            await WG.device.queue.onSubmittedWorkDone()
        } catch (e) { err = e?.message ?? String(e) }
        const a = err ? null : await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
        const f = a && new Float32Array(a.buffer, a.byteOffset, a.length)
        const img = f ? Array.from({ length: W * H }, (_, i) => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]) : []
        const mx = Math.max(...img.filter(Number.isFinite)), black = img.filter(x => !(x >= 1e-3 * mx)).length
        ok(`the user's scene through the whole renderer (${mode}): no black pixel`, !err && img.length && black === 0, err ?? `${black} of ${W * H} black`)
    }
}

console.log(`round joins on a GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
