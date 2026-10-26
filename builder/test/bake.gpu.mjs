//======================================================================================================================
// A BAKED SCENE ON A REAL WEBGPU (builder/bake.js: codegen's scene with its values as constants; Tests > bake). Run:
//   node builder/test/bake.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as units.gpu.mjs is: the `webgpu` package and a Vulkan driver (lavapipe), or it says so
// and passes.
//
// Per bench scene, baked as the bench bakes it (the culling boxes live), through the engine's own kernels on Dawn --
// whose WGSL compiler is the browser's (Tint), where check-shaders compiles with naga:
//   - the baked march, occlusion and surface kernels compile;
//   - camera rays from the bench's camera, culled by boxes measured as the page measures them, end as codegen's do: the
//     same state, a HIT at the same place within the leaving offset (10 x the march's tolerance). The compiler may fold
//     a constant's arithmetic in another order than a uniform's, so a handful may differ where the march's own
//     tolerance decides (a grazing ray): the bar is a share, printed with the counts and the steps.
// COUNTS AND PLACES, NOT TIMES (CLAUDE.md): what a bake buys is the card's to say (Tests > bake).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(bake GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, boxLoName, boxHiName } = await import('../codegen.js')
const { cullBoxes, createBoxes, cullUniforms } = await import('../boxes.js')
const { baked } = await import('../bake.js')
const { prog_tagfield, tagSample, TAG_FIELD_WORDS } = await import('../../lib/pathtracer/core/field.js')
const { benchUrl } = await import('../../bench/index.js')
const { SCENES, liveInBench } = await import('../../bench/bake.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { prog_march, prog_occlude, prog_surface, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../../lib/pathtracer/core/tracebasics.js')
const { UniformSpec } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(bake GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const say = console.log
console.warn = () => { }

const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* the boxes, measured as the page measures them: the scene's own tags at a lattice of points (core/field.js) */
async function measure(doc, scene) {
    const prog = await prog_tagfield(WG, scene); await prog.ready
    const sample = async input => {
        const count = new Uint32Array(input.buffer, input.byteOffset, 4)[3]
        const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(Math.max(4 * TAG_FIELD_WORDS * count, 256))
        prog.resources = { fieldIn: inB.b, fieldOut: outB.b }
        prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
        prog.run(count, 1, 1)
        const out = await outB.r(4 * TAG_FIELD_WORDS * count, 0, Float32Array)
        inB.b.destroy(); outB.b.destroy()
        return tagSample(out, scene)
    }
    const B = createBoxes({ sample, doc: () => doc }); await B.update()
    return B
}
/* THE RAYS as the engine's struct (tracebasics.js Ray; units.gpu.mjs has the layout) */
const RAY_F = RAY_BYTES / 4, HIT_F = SHADE_ITEM_BYTES / 4
function raysOf(pts, dirs) {
    const n = pts.length / 3, f = new Float32Array(RAY_F * n), u = new Uint32Array(f.buffer)
    for (let i = 0; i < n; i++) {
        const o = RAY_F * i
        f.set(pts.slice(3 * i, 3 * i + 3), o); f.set(dirs.slice(3 * i, 3 * i + 3), o + 4)
        f[o + 12] = 1; f[o + 13] = 1; f[o + 14] = 1
        u[o + 15] = 0; f[o + 16] = 1; f[o + 17] = 0; u[o + 18] = 0; u[o + 19] = 0; u[o + 20] = i; f[o + 21] = 1
        u[o + 22] = 0; f[o + 23] = 0; f[o + 24] = -1; f[o + 25] = 0; f[o + 26] = 0
    }
    return f
}
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) }
function cameraRays(cam, W, H) {
    const RAD = Math.PI / 180, az = cam.azimuth * RAD, el = (90 - cam.elevation) * RAD
    const pos = [0, 1, 2].map(k => cam.target[k] + cam.distance * [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)][k])
    const z = unit(pos.map((v, k) => v - cam.target[k])), x = unit([-z[1], z[0], 0]), y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    const t = Math.tan(cam.fov * RAD / 2), pts = [], dirs = []
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const u = ((i + 0.5) / W * 2 - 1) * t * W / H, v = ((j + 0.5) / H * 2 - 1) * t
        pts.push(...pos); dirs.push(...unit([0, 1, 2].map(k => -z[k] + u * x[k] + v * y[k])))
    }
    return { pts, dirs }
}
/* the march kernel, pass after pass as the renderer chains it; out per ray { pos, state, steps }. IN METRES, the engine's
   unit since 0.36.0 (scene_api.js SCENE_BOUNDARY): the rays go in at their places times the scene's unit, the hits come
   back divided by it, so the test's numbers stay the scene's */
async function marchAll(prog, bag, rays0, passes = 80) {
    const n = rays0.length / RAY_F, u = bag.sceneUnit, rays = rays0.slice()
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) rays[RAY_F * i + c] *= u
    const mb0 = WG.createStorageBuffer(rays), mb1 = WG.createStorageBuffer(rays.byteLength)
    const shade = WG.createStorageBuffer(HIT_F * 4 * n), counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    // no step cache: compiled in only when asked (wavefront.js stepCacheWGSL), and this march is built without it
    prog.resources = { marchBuffer0: mb0.b, marchBuffer1: mb1.b, shadeBuffer: shade.b, counters: counters.b }
    let inCount = n, readfrom = 0, shaded = 0
    for (let p = 0; p < passes && inCount > 0; p++) {
        counters.w(counterWords({ [readfrom]: inCount, 2: shaded, 3: readfrom }))
        prog.uniforms = { ...bag, lastpass: p === passes - 1 ? 1 : 0 }
        prog.dispatch(Math.ceil(inCount / 64), 1, 1)
        const c = await counters.r(Uint32Array)
        shaded = c[2]; inCount = readfrom === 0 ? c[1] : c[0]; readfrom = 1 - readfrom
    }
    const h = await shade.r(Float32Array), hu = new Uint32Array(h.buffer)
    const out = new Array(n).fill(null)
    for (let k = 0; k < shaded; k++) {
        const o = HIT_F * k
        out[hu[o + 20]] = { pos: [h[o] / u, h[o + 1] / u, h[o + 2] / u], steps: hu[o + 15], state: hu[o + 19] }
    }
    for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
    return out
}

const W = 64, H = 36, SHARE = 0.005
const meanSteps = r => r.reduce((s, h) => s + (h?.steps ?? 0), 0) / r.length
for (const [key, label, file, cam] of SCENES) {
    const doc = M.parse(readFileSync(fileURLToPath(benchUrl(file)), 'utf8'))
    const S = generate(...M.generateArgs(doc, { id: `gpu-${key}` }))
    const Bk = baked(S, { live: liveInBench })
    // the baked kernels compile on Dawn (Tint): march, occlusion, surface
    let built = null, why = ''
    try {
        const [m, o, s] = await Promise.all([prog_march(WG, Bk, 64), prog_occlude(WG, Bk, 64), prog_surface(WG, Bk, 64)])
        await Promise.all([m.ready, o.ready, s.ready])
        built = m
    } catch (e) { why = e?.message ?? String(e) }
    ok(`${label}: baked (${Bk.baked.names.length} values constants, ${Bk.baked.kept.length} live): march, occlusion and surface compile on Dawn`, !!built, why.slice(0, 400))
    if (!built) continue
    const march0 = await prog_march(WG, S, 64); await march0.ready
    // culled as the page culls, the same boxes for both: each top-level node's box as its uniforms
    const Bx = await measure(doc, S)
    const cull = {}
    for (const [id, b] of cullBoxes(doc, Bx)) { if (!(boxLoName(id) in (S.uniforms || {}))) continue; const { lo, hi } = cullUniforms(b); cull[boxLoName(id)] = lo; cull[boxHiName(id)] = hi }
    ok(`${label}: the boxes still the baked scene's to take (live)`, Object.keys(cull).every(k => k in Bk.uniforms), Object.keys(cull).filter(k => !(k in Bk.uniforms)).join())
    const common = { res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000, ...cull }
    const base0 = { ...uniformBag(S), ...common }, baseB = { ...uniformBag(Bk), ...common }
    const eps = Math.max((base0.eps > 0 ? base0.eps : base0.epsAuto) / (base0.sceneUnit || 1), 1e-7), offset = 10 * eps
    const { pts, dirs } = cameraRays(cam, W, H)
    const a = await marchAll(march0, base0, raysOf(pts, dirs)), b = await marchAll(built, baseB, raysOf(pts, dirs))
    const state = b.filter((h, i) => (h?.state ?? -1) !== (a[i]?.state ?? -1)).length
    const place = b.filter((h, i) => h && a[i] && h.state === 0 && a[i].state === 0 && Math.hypot(...h.pos.map((v, k) => v - a[i].pos[k])) > offset).length
    const sameSteps = b.filter((h, i) => h && a[i] && h.steps === a[i].steps).length
    say(`  ${label}: baked against codegen: ending otherwise ${state} state, ${place} place of ${b.length}; the same steps ${sameSteps} of ${b.length} (mean ${meanSteps(b).toFixed(1)} against ${meanSteps(a).toFixed(1)})`)
    ok(`${label}: every camera ray ends as codegen's, but a share the march's tolerance decides`, state + place <= SHARE * b.length && a.every(Boolean) && b.every(Boolean),
        `${state} + ${place} of ${b.length}`)
}

say(`bake on a GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
