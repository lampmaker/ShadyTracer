//======================================================================================================================
// ONE SCENE IN TWO UNITS, THROUGH THE ENGINE IN METRES (0.36.0: lib/pathtracer/core/scene_api.js SCENE_BOUNDARY). Run:
//   node builder/test/units.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package and a Vulkan driver (lavapipe), or it says so
// and passes.
//
// The engine works in metres, a scene in its own unit, and the boundary converts. So the same physical scene written in
// millimetres and re-authored in metres (bench/variants.js rescaled: every position and declared length times 0.001 -- the
// same scene text, checked below) is the same scene to the engine: the same physical rays, in metres, must end in the
// same places, on the same materials, and the same shadow rays be blocked -- through the engine's own march and
// occlusion kernels, plainly and as data (and with exact hits until they went, 0.41.0) -- the noise library, its reliefs
// in real millimetres; and the surface materials, plainly. A conversion missed anywhere the scene is asked -- a distance,
// a capture -- moves one side's hits by a factor of 100 or 1000, not by an ulp.
// What the f32 rounding of the conversion does move is a share of rays the tolerance decides, as in every GPU check here.
// COUNTS AND DISTANCES, NOT TIMES (CLAUDE.md).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(units GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate } = await import('../codegen.js')
const { rescaled } = await import('../../bench/variants.js')
const { CAMERAS, BENCH_FILES, benchUrl } = await import('../../bench/index.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { prog_march, prog_occlude, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { UniformSpec, sceneTextOf } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../../lib/pathtracer/core/tracebasics.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(units GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const say = (...a) => console.log(...a)

const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
// the uniforms the renderer would hand the kernels: the schema's defaults, derive() for the scene, the scene's own
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
const RAY_F = RAY_BYTES / 4, HIT_F = SHADE_ITEM_BYTES / 4
/* THE RAYS as the engine's struct (tracebasics.js Ray, RAY_BYTES): pos, dir, radiance, beta -- vec3s, 16 bytes apart --
   then steps, n, ltot, bounces, state, pix, sunmis, tag, tmax, prevPdf, vtxLtot, ltMis from byte 60, where beta's twelve
   bytes end (a u32's alignment is 4: WGSL puts it there, not at 64). THE HITS as the shade queue holds them (scene_api.js
   ShadeItem, SHADE_ITEM_BYTES): the Hit first, the surface kernel's answers after it. (This layout note lived in
   exact.gpu.mjs until exact hits went, 0.41.0; the other GPU checks cite it here.) */
function raysOf(pts, dirs, radiance = 0) {
    const n = pts.length / 3, f = new Float32Array(RAY_F * n), u = new Uint32Array(f.buffer)
    for (let i = 0; i < n; i++) {
        const o = RAY_F * i
        f.set(pts.slice(3 * i, 3 * i + 3), o); f.set(dirs.slice(3 * i, 3 * i + 3), o + 4)
        f[o + 8] = radiance; f[o + 9] = radiance; f[o + 10] = radiance       // a shadow ray's: what it deposits if it gets through
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
/* the march, pass after pass as the renderer chains it: the rays in METRES in, the hits in metres out */
async function marchAll(prog, bag, rays, buffers, passes = 80) {
    const n = rays.length / RAY_F
    const mb0 = WG.createStorageBuffer(rays), mb1 = WG.createStorageBuffer(rays.byteLength)
    const shade = WG.createStorageBuffer(HIT_F * 4 * n), counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    prog.resources = { marchBuffer0: mb0.b, marchBuffer1: mb1.b, shadeBuffer: shade.b, counters: counters.b, ...buffers }
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
        out[hu[o + 20]] = { pos: [h[o], h[o + 1], h[o + 2]], steps: hu[o + 15], state: hu[o + 19], sw: h[o + 31], m: hu[o + 32] }
    }
    for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
    return out
}
/* the occlusion kernel, round after round; out per ray: whether its light got through */
async function occludeAll(prog, bag, rays, buffers, rounds = 200) {
    const n = rays.length / RAY_F
    const sb0 = WG.createStorageBuffer(rays), sb1 = WG.createStorageBuffer(rays.byteLength)
    const frame = WG.createStorageBuffer(16 * n), splat = WG.createStorageBuffer(16 * n)
    const counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    prog.resources = { shadowBuffer0: sb0.b, shadowBuffer1: sb1.b, frame_u32: frame.b, splat_u32: splat.b, counters: counters.b, ...buffers }
    let inCount = n, readfrom = 0
    for (let p = 0; p < rounds && inCount > 0; p++) {
        counters.w(counterWords({ [6 + readfrom]: inCount, 3: readfrom, 8: n }))
        prog.uniforms = { ...bag, lastpass: p === rounds - 1 ? 1 : 0 }
        prog.dispatch(Math.ceil(inCount / 64), 1, 1)
        const c = await counters.r(Uint32Array)
        inCount = readfrom === 0 ? c[7] : c[6]; readfrom = 1 - readfrom
    }
    const f = await frame.r(Float32Array)
    for (const b of [sb0, sb1, frame, splat, counters]) b.b.destroy()
    return Array.from({ length: n }, (_, i) => f[4 * i] + f[4 * i + 1] + f[4 * i + 2] > 0)
}

const W = 64, H = 36, SHARE = 0.005
const L = unit([0.3, 0.2, 0.93])
const isHit = h => h && h.state === 0
/* the scene, made as the page makes it: codegen, or as data -- its records written into its buffer */
async function made(doc, way) {
    const tree = M.toTree(doc, { keepDisabled: true })
    const S = generate(tree, { id: 'built', liveVisibility: true, ...way })
    if (S.dataOf) { S.data = S.dataOf(tree, new Map()).data }
    const buffers = S.init ? await S.init(WG) : {}
    return { S, buffers }
}
const WAYS = [['codegen', {}], ['as data', { data: true }]]
/* THE SCENES: the two the bench can re-author in metres (bench/variants.js rescaled refuses a parameter it cannot tell is a
   length: the optics benches' array counts, the LED scenes' sizes). NOT THE OPTICS BENCH CONVERTED the builder's way
   (variants.js converted, a paste between units): about 2% of the camera's rays hit a part in cm that they pass in m, and
   5% more on its table -- the same rays, ray for ray, through the engine before 0.36.0, which worked in each scene's own
   unit (measured here on lavapipe, 2026-10-07). So that pair is not one physical scene, whatever the engine's unit, and
   cannot judge it; why it is not is the builder's conversion's question, not this test's. */
const CASES = [
    ['the noise library (mm)', readFileSync(benchUrl(BENCH_FILES.noise), 'utf8'), CAMERAS.noise, WAYS, rescaled],
    ['the surface materials (mm)', readFileSync(benchUrl(BENCH_FILES.surfaces), 'utf8'), CAMERAS.surfaces, [WAYS[0]], rescaled],
]
for (const [label, text, cam, ways, toMetres] of CASES) {
    const docA = M.parse(text), docB = toMetres(docA, 'm')
    const uA = derive({}, { unit: docA.unit }).sceneUnit
    // the camera's rays, in the scene's own unit (A), said in metres: the same physical rays for both
    const C = cameraRays(cam, W, H)
    const pts = C.pts.map(x => x * uA), rays = raysOf(pts, C.dirs)
    for (const [way, opts] of ways) {
        const A = await made(docA, opts), B = await made(docB, opts)
        ok(`${label}, ${way}: one scene text in ${docA.unit} and in m (the unit is no text)`, sceneTextOf(A.S) === sceneTextOf(B.S))
        const bagA = { ...uniformBag(A.S), res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000 }
        const bagB = { ...uniformBag(B.S), res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000 }
        ok(`${label}, ${way}: the same automatic tolerance in metres either way, and the factors each unit's`,
            Math.abs(bagA.epsAuto - bagB.epsAuto) <= 1e-12 * Math.max(1, bagA.epsAuto) * 1e6 && bagA.sceneUnit === uA && bagB.sceneUnit === 1 && bagA.perMetre * uA === 1,
            JSON.stringify([bagA.epsAuto, bagB.epsAuto, bagA.sceneUnit, bagA.perMetre]))
        const tol = Math.max(bagB.eps > 0 ? bagB.eps : bagB.epsAuto, 1e-7), offset = 10 * tol
        const [PA, PB] = await Promise.all([prog_march(WG, A.S, 64), prog_march(WG, B.S, 64)])
        await PA.ready; await PB.ready
        const ha = await marchAll(PA, bagA, rays, A.buffers), hb = await marchAll(PB, bagB, rays, B.buffers)
        const state = ha.filter((h, i) => (h?.state ?? -1) !== (hb[i]?.state ?? -1)).length
        const place = ha.filter((h, i) => isHit(h) && isHit(hb[i]) && Math.hypot(...h.pos.map((v, k) => v - hb[i].pos[k])) > 2 * tol).length
        const mat = ha.filter((h, i) => isHit(h) && isHit(hb[i]) && h.m !== hb[i].m).length
        const hits = ha.filter(isHit).length
        say(`  ${label}, ${way}: ${hits} of ${ha.length} camera rays hit; in ${docA.unit} against in m: ${state} end otherwise, ${place} elsewhere (> 2 tolerances, ${(tol * 1e6).toFixed(2)} um), ${mat} on another material`)
        ok(`${label}, ${way}: the camera's rays hit (the check sees something)`, hits > 0.2 * ha.length, `${hits} of ${ha.length}`)
        ok(`${label}, ${way}: every ray ends the same in ${docA.unit} as in m, in the same place and on the same material, but a share the tolerance decides`,
            state + place + mat <= SHARE * ha.length && ha.every(Boolean) && hb.every(Boolean), `${state} + ${place} + ${mat} of ${ha.length}`)
        if (way === 'codegen') {
            // shadow rays from the hits, backed off along their rays, toward one direction: blocked or not alike
            const sp = [], sd = []
            ha.forEach((h, i) => { if (!isHit(h)) return; const d = C.dirs.slice(3 * i, 3 * i + 3); sp.push(...h.pos.map((v, k) => v - d[k] * 2 * offset)); sd.push(...L) })
            const sr = raysOf(sp, sd, 1)
            const [OA, OB] = await Promise.all([prog_occlude(WG, A.S, 64), prog_occlude(WG, B.S, 64)])
            await OA.ready; await OB.ready
            const la = await occludeAll(OA, bagA, sr, A.buffers), lb = await occludeAll(OB, bagB, sr, B.buffers)
            const shadow = la.filter((v, i) => v !== lb[i]).length
            say(`  ${label}, ${way}: shadow rays lit ${la.filter(Boolean).length} of ${la.length} in ${docA.unit}, ${lb.filter(Boolean).length} in m; ${shadow} differ`)
            ok(`${label}, ${way}: some shadow rays get through and some do not (the check sees both)`, la.some(Boolean) && la.some(v => !v), `${la.filter(Boolean).length} of ${la.length}`)
            ok(`${label}, ${way}: every shadow ray blocked or not alike in ${docA.unit} and in m, but such a share`, shadow <= SHARE * la.length, `${shadow} of ${la.length}`)
        }
    }
}

say(`units on a GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
