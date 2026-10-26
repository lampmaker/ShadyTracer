//======================================================================================================================
// THE STEP CACHE ON A REAL WEBGPU, THROUGH THE ENGINE'S OWN KERNELS (lib/pathtracer/core/wavefront.js stepCacheWGSL in
// prog_march and prog_occlude; the developer setting stepCache). Run:
//   node builder/test/stepcache.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as units.gpu.mjs is: the `webgpu` package and a Vulkan driver (lavapipe), or it says so
// and passes.
//
// Per bench scene (codegen, culled by boxes measured as the page measures them, the cache's box made from them as the page
// makes it: builder/stepbox.js) -- and the optics bench again as data -- the cells filled by the pass of their own, as
// R.trace puts it before a trace's first sample (wavefront.js prog_stepcache_fill, its chunk's first cell in scDims.w),
// then camera rays from the bench's camera through the march kernel, pass after pass as the renderer chains it, and shadow
// rays from where they ended through the occlusion kernel, round after round -- with the cache off, then each way on
// (1: the own cell's ball, 2: the cells ahead):
//   - every cell filled, a finite distance, the same bits in two chunks as in one;
//   - every ray ends as with the cache off: the same state, a HIT at the same place within the leaving offset (10 x the
//     march's tolerance); a shadow ray blocked or not as it was. A handful may differ where the march's own tolerance
//     decides (a grazing ray), so the bar is a share, printed with the counts;
//   - the cache was used: with 2 fewer steps than with it off -- a mode nothing runs is code that has never run
//     (CLAUDE.md); and no cell written by a march or an occlusion: they only read;
//   - off is off: a full cache with the setting 0 changes no ray and no cell;
//   - the camera moved over the full cache (kept across camera moves since 0.24.0): rays from elsewhere end as that
//     camera's own with the cache off, shadow rays from their hits likewise;
//   - the cells shown (stepCacheView, the display pass's walk through the grid): against brute force, on a grid by hand.
// The fill asks the scene's pick copy, with no box culling (0.33.0): the render copy's culled distance made a ball stop at
// a box, the orange shell the user saw around the boxes. (Until 0.41.0 the march could also fill a cell on a ray's first
// visit, the lazy fill, and the optics bench ran with exact hits and the grid too: all three went in 0.41.0. NOT "never a
// smaller ball than the lazy fill's", which was the first version of the filled-once check and is false two ways, found
// here on 2026-10-07 by marching 4096 directions from the cells to their nearest surface: where a shape's own distance is
// looser than its box's -- the demo's twisted column -- and where a box is wrong -- fixed in 0.33.1, boxes.js.) The count
// of cells with a ball under a cell is printed.
// COUNTS AND PLACES, NOT TIMES (CLAUDE.md): what the cache costs is the card's to say (Tests > stepcache).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(step-cache GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, boxLoName, boxHiName } = await import('../codegen.js')
const { cullBoxes, createBoxes, cullUniforms } = await import('../boxes.js')
const { stepCacheBox } = await import('../stepbox.js')
const { prog_tagfield, tagSample, TAG_FIELD_WORDS } = await import('../../lib/pathtracer/core/field.js')
const { CAMERAS, BENCH_FILES, benchUrl } = await import('../../bench/index.js')
const { CAMERAS: SCALING_CAMERAS, SCALING_FILES } = await import('../../bench/scaling.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { prog_march, prog_occlude, prog_stepcache_fill, SC_FILL_WG, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../../lib/pathtracer/core/tracebasics.js')
const { UniformSpec, computeUniformTypes, sceneConstantsWGSL } = await import('../../lib/pathtracer/core/uniforms.schema.js')
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
    console.log(`(step-cache GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}.)`)
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

/* THE RAYS as the engine's struct (tracebasics.js Ray; units.gpu.mjs has the layout): pos, dir, radiance, beta, then
   counts (the march steps), n, ltot, bounces, state, pix, sunmis, tag, tmax, prevPdf, vtxLtot, ltMis */
const RAY_F = RAY_BYTES / 4, HIT_F = SHADE_ITEM_BYTES / 4
function raysOf(pts, dirs, radiance = 0) {
    const n = pts.length / 3, f = new Float32Array(RAY_F * n), u = new Uint32Array(f.buffer)
    for (let i = 0; i < n; i++) {
        const o = RAY_F * i
        f.set(pts.slice(3 * i, 3 * i + 3), o); f.set(dirs.slice(3 * i, 3 * i + 3), o + 4)
        f[o + 8] = radiance; f[o + 9] = radiance; f[o + 10] = radiance
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

/* the march kernel, pass after pass as the renderer chains it; out per ray { pos, state, steps }. `cache` the cells, for a
   kernel built with the step cache; null for one built without (which declares none: wavefront.js, compiled in only when on) */
/* IN METRES, the engine's unit since 0.36.0 (scene_api.js SCENE_BOUNDARY): the rays go in at their places times the
   scene's unit (the bag's sceneUnit), and the hits come back divided by it -- the test's numbers stay the scene's */
const inMetres = (rays, u) => { const r = rays.slice(); for (let i = 0; i < r.length / RAY_F; i++) for (let c = 0; c < 3; c++) r[RAY_F * i + c] *= u; return r }
async function marchAll(prog, bag, rays0, cache, buffers, passes = 80) {
    const n = rays0.length / RAY_F, u = bag.sceneUnit, rays = inMetres(rays0, u)
    const mb0 = WG.createStorageBuffer(rays), mb1 = WG.createStorageBuffer(rays.byteLength)
    const shade = WG.createStorageBuffer(HIT_F * 4 * n), counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    prog.resources = { marchBuffer0: mb0.b, marchBuffer1: mb1.b, shadeBuffer: shade.b, counters: counters.b, ...(cache ? { stepCache: cache.b } : {}), ...buffers }
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
/* the occlusion kernel, round after round; out per ray: whether its light got through (its pixel lit) */
async function occludeAll(prog, bag, rays0, cache, buffers, rounds = 200) {
    const n = rays0.length / RAY_F, rays = inMetres(rays0, bag.sceneUnit)
    const sb0 = WG.createStorageBuffer(rays), sb1 = WG.createStorageBuffer(rays.byteLength)
    const frame = WG.createStorageBuffer(16 * n), splat = WG.createStorageBuffer(16 * n)
    const counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    prog.resources = { shadowBuffer0: sb0.b, shadowBuffer1: sb1.b, frame_u32: frame.b, splat_u32: splat.b, counters: counters.b, ...(cache ? { stepCache: cache.b } : {}), ...buffers }
    let inCount = n, readfrom = 0, steps = 0
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

/* a million cells, not the page's four million (stepCacheCells): the kernels read only the grid's corner, cell and counts,
   which the host cuts from any count (raytrace_main.js R.setStepCacheBox; build.test.mjs runs the count's change) */
const W = 64, H = 36, CELLS = 1e6, SHARE = 0.005
const L = unit([0.3, 0.2, 0.93])
/* ONE SCENE, ONE WAY: off, then the cells filled, 1 and 2 over them, then off over the full cache, then a camera moved.
   `buffers`: the scene's own (a scene as data's records), `extra`: uniforms over the scene's own (codegen's culling boxes) */
async function check(label, S, buffers, extra, cam, box) {
    const size = [0, 1, 2].map(k => box.hi[k] - box.lo[k]), cs = Math.cbrt(size[0] * size[1] * size[2] / CELLS)
    const dims = size.map(s => Math.max(1, Math.ceil(s / cs))), cells = dims[0] * dims[1] * dims[2]
    // the box in the scene's unit, the cells the kernels read in metres (raytrace_main.js R.stepCacheUniforms): mpu
    const mpu = uniformBag(S).sceneUnit
    const base = { ...uniformBag(S), ...extra, res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000, scLo: [...box.lo.map(x => x * mpu), cs * mpu], scDims: [...dims, 0] }
    const eps = Math.max((base.eps > 0 ? base.eps : base.epsAuto) / (base.sceneUnit || 1), 1e-7), offset = 10 * eps
    /* THE KERNELS BUILT THREE WAYS (0.29.0: the step cache is compiled in only when on, the setting a kernel option, not a
       uniform): without it, with the own cell's ball, with the cells ahead -- reading the cells only */
    const K = {}
    for (const mode of [0, 1, 2]) {
        K[mode] = { march: await prog_march(WG, S, 64, { stepCache: mode }), occl: await prog_occlude(WG, S, 64, { stepCache: mode }) }
        await K[mode].march.ready; await K[mode].occl.ready
    }
    ok(`${label}: built without the cache, march and occlusion hold none of it -- not a lookup, not the cells; with it, a lookup and the cells read-only`,
        [K[0].march.wgsl, K[0].occl.wgsl].every(t => !/\bscStep\b|var<storage[^>]*>\s*stepCache\b/.test(t))
        && [1, 2].every(m => [K[m].march.wgsl, K[m].occl.wgsl].every(t => /\bscStep\b/.test(t) && /var<storage,\s*read>\s*stepCache\b/.test(t))))
    const { pts, dirs } = cameraRays(cam, W, H)
    const cam0 = await marchAll(K[0].march, base, raysOf(pts, dirs), null, buffers)
    // shadow rays from where the camera rays ended, backed off along them, toward one direction
    const sp = [], sd = []
    const hitIdx = cam0.map((h, i) => [h, i]).filter(([h]) => h?.state === 0)          // RAY_ACTIVE: ended on a surface
    for (const [h, i] of hitIdx) { const d = dirs.slice(3 * i, 3 * i + 3); sp.push(...h.pos.map((v, k) => v - d[k] * 2 * offset)); sd.push(...L) }
    const shadowRays = raysOf(sp, sd, 1)
    const sh0 = await occludeAll(K[0].occl, base, shadowRays, null, buffers)
    const meanSteps = r => r.reduce((s, h) => s + (h?.steps ?? 0), 0) / r.length
    const lines = []
    /* THE FILL, as R.trace puts it before a trace's first sample (its chunk's first cell in scDims.w) */
    const fillK = await prog_stepcache_fill(WG, S); await fillK.ready
    const fillAll = async (buf, chunks) => {
        fillK.resources = { stepCache: buf.b, ...buffers }
        for (const [from, count] of chunks) {
            fillK.uniforms = { ...base, scDims: [...dims, from] }
            fillK.dispatch(Math.ceil(count / SC_FILL_WG), 1, 1)
        }
        return buf.r(Uint32Array)
    }
    const cache = WG.createStorageBuffer(4 * cells), twice = WG.createStorageBuffer(4 * cells)
    const full = await fillAll(cache, [[0, cells]])
    const half = 64 * Math.floor(cells / 128)
    const b = await fillAll(twice, [[0, half], [half, cells - half]])
    twice.b.destroy()
    const af = new Float32Array(full.buffer, full.byteOffset, full.length)
    ok(`${label}: the cells filled, every one a finite distance, and two chunks bit for bit as one`,
        af.every(v => Number.isFinite(v) && v > 0) && full.every((v, k) => v === b[k]))
    lines.push(`${label}: of ${cells} cells, ${af.filter(v => v < cs * mpu).length} with a ball under a cell`)   // radius in metres, the cell in the scene's unit
    for (const mode of [1, 2]) {
        const camK = await marchAll(K[mode].march, base, raysOf(pts, dirs), cache, buffers)
        const shK = await occludeAll(K[mode].occl, base, shadowRays, cache, buffers)
        const state = camK.filter((h, i) => (h?.state ?? -1) !== (cam0[i]?.state ?? -1)).length
        // the place of a HIT (RAY_ACTIVE, 0): an escaped ray stops wherever it crosses the radius, which steps move
        const place = camK.filter((h, i) => h && cam0[i] && h.state === 0 && cam0[i].state === 0 && Math.hypot(...h.pos.map((v, k) => v - cam0[i].pos[k])) > offset).length
        const shadow = shK.filter((v, i) => v !== sh0[i]).length
        const what = `${label}, cache ${mode}`
        lines.push(`${what}: steps a camera ray ${meanSteps(camK).toFixed(1)} (off ${meanSteps(cam0).toFixed(1)}); ending otherwise: ${state} state, ${place} place of ${camK.length}; shadow rays otherwise ${shadow} of ${shK.length}`)
        ok(`${what}: every camera ray ends as with the cache off, but a share the march's tolerance decides`, state + place <= SHARE * camK.length, `${state} + ${place} of ${camK.length}`)
        ok(`${what}: every shadow ray blocked or not as with it off, but such a share`, shadow <= SHARE * shK.length, `${shadow} of ${shK.length}`)
        if (mode === 2) ok(`${what}: fewer steps than with it off -- the cache ran`, meanSteps(camK) < meanSteps(cam0), `${meanSteps(camK)} against ${meanSteps(cam0)}`)
    }
    const read = await cache.r(Uint32Array)
    ok(`${label}: no cell written by a march or an occlusion -- they only read`, read.every((v, k) => v === full[k]))
    const off2 = await marchAll(K[0].march, base, raysOf(pts, dirs), null, buffers)
    const after = await cache.r(Uint32Array)
    ok(`${label}: off is off -- built without the cache, with it left full, no ray changes and no cell`, off2.every((h, i) => (h?.state ?? -1) === (cam0[i]?.state ?? -1) && (!h || h.steps === cam0[i].steps))
        && after.every((v, k) => v === full[k]))
    /* THE CAMERA MOVED OVER THE FULL CACHE (0.24.0 keeps the cells across camera moves: raytrace_main.js R.stepCacheFor):
       rays from elsewhere, through balls filled for the scene, end as that camera's own rays with the cache off do, and
       shadow rays from their hits likewise */
    {
        const cam2 = { ...cam, azimuth: cam.azimuth + 35, elevation: Math.min(80, cam.elevation + 10) }
        const { pts: p2, dirs: d2 } = cameraRays(cam2, W, H)
        const off = await marchAll(K[0].march, base, raysOf(p2, d2), null, buffers)
        const on = await marchAll(K[2].march, base, raysOf(p2, d2), cache, buffers)
        const state = on.filter((h, i) => (h?.state ?? -1) !== (off[i]?.state ?? -1)).length
        const place = on.filter((h, i) => h && off[i] && h.state === 0 && off[i].state === 0 && Math.hypot(...h.pos.map((v, k) => v - off[i].pos[k])) > offset).length
        const sp2 = [], sd2 = []
        off.forEach((h, i) => { if (h?.state !== 0) return; const d = d2.slice(3 * i, 3 * i + 3); sp2.push(...h.pos.map((v, k) => v - d[k] * 2 * offset)); sd2.push(...L) })
        const sr = raysOf(sp2, sd2, 1)
        const shOff = await occludeAll(K[0].occl, base, sr, null, buffers), shOn = await occludeAll(K[2].occl, base, sr, cache, buffers)
        const shadow = shOn.filter((v, i) => v !== shOff[i]).length
        lines.push(`${label}, the camera moved over the full cache: steps a camera ray ${meanSteps(on).toFixed(1)} (off ${meanSteps(off).toFixed(1)}); ending otherwise: ${state} state, ${place} place of ${on.length}; shadow rays otherwise ${shadow} of ${shOn.length}`)
        ok(`${label}: the camera moved over the full cache -- every camera ray ends as that camera's own with it off, but a share`, state + place <= SHARE * on.length, `${state} + ${place} of ${on.length}`)
        ok(`${label}: ...every shadow ray blocked or not as with it off, but such a share`, shadow <= SHARE * shOn.length, `${shadow} of ${shOn.length}`)
    }
    for (const l of lines) say('  ' + l)
    cache.b.destroy()
}

const SCENES = [
    ['the optics bench', SCALING_FILES.bench, SCALING_CAMERAS.bench],
    ['the demo', BENCH_FILES.demo, CAMERAS.demo],
    ['the showcase', BENCH_FILES.showcase, CAMERAS.showcase],
    ['the material test', BENCH_FILES.materials, CAMERAS.materials],
]
/* the optics bench as data, the page's other way: the records' walk answers at a cell's centre */
const DATA_WAYS = [['as data', {}]]
for (const [label, file, cam] of SCENES) {
    const doc = M.parse(readFileSync(fileURLToPath(benchUrl(file)), 'utf8'))
    const S = generate(...M.generateArgs(doc, { id: 'built' }))
    const B = await measure(doc, S)
    // culled as the page culls: each top-level node's box as its uniforms
    const cull = {}
    for (const [id, b] of cullBoxes(doc, B)) { if (!(boxLoName(id) in (S.uniforms || {}))) continue; const { lo, hi } = cullUniforms(b); cull[boxLoName(id)] = lo; cull[boxHiName(id)] = hi }
    // the cache's grid, as R.setStepCacheBox cuts it
    const box = stepCacheBox(doc, B)
    ok(`${label}: a box for the cache`, !!box, JSON.stringify(box))
    if (!box) continue
    await check(label, S, {}, cull, cam, box)
    if (file !== SCALING_FILES.bench) continue
    // as data: every node's box in its records (the page's pushCull: nested)
    const [tree] = M.generateArgs(doc, { data: true })
    const boxes = cullBoxes(doc, B, { nested: true })
    for (const [way, opts] of DATA_WAYS) {
        const D = generate(...M.generateArgs(doc, { id: 'built', data: true, ...opts }))
        D.data = D.dataOf(tree, boxes).data
        await check(`${label} ${way}`, D, await D.init(WG), {}, cam, box)
    }
}

/* THE CELLS SHOWN (lib/pathtracer/core/rendertoscreen.js STEP_CACHE_VIEW_WGSL, the developer setting stepCacheView): the
   display pass's walk of each pixel's ray through the grid, run here in a kernel over a grid made by hand -- 8 cells a
   side of 0.5, its corner off the origin, a fifth of them filled, half of those with a ball smaller than a cell -- from
   a perspective and an orthographic camera, against brute force: the ray sampled every two-hundredth of a cell, each new
   cell it enters with a ball smaller than a cell composited in order (0.32.2: the others clear, empty or not) -- and where the two disagree, sampled a hundred times finer, since a corner the ray
   grazes for less than a sample is a cell brute force skips. The walk (a 3D DDA) must then visit the cells brute force
   does, in its order: the same cover and colour, every pixel. */
{
    const { STEP_CACHE_VIEW_WGSL } = await import('../../lib/pathtracer/core/rendertoscreen.js')
    const prog = await WG.makeCompute(STEP_CACHE_VIEW_WGSL, `
        let i = gid.x;
        if (i >= arrayLength(&viewIn)) { return; }
        viewOut[i] = scView(viewIn[i].xy);`,
        { scLo: 'vec4<f32>', scDims: 'vec4<u32>', invView: 'mat4x4<f32>', invProjection: 'mat4x4<f32>', camPos: 'vec4<f32>', camtype: 'u32' },
        { viewIn: 'array<vec4<f32>>', viewOut: 'array<vec4<f32>>', stepCache: 'read array<u32>' }, { async: false, wg: [64, 1, 1] })
    await prog.ready
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const N = 8, cs = 0.5, lo = [-1, 2, 0.5]
    const cells = new Uint32Array(N * N * N), f = new Float32Array(1), fu = new Uint32Array(f.buffer)
    let filled = 0, small = 0
    for (let k = 0; k < cells.length; k++) if (rnd() < 0.2) { f[0] = rnd() < 0.5 ? cs * (0.1 + 0.8 * rnd()) : cs * (1 + 2 * rnd()); cells[k] = fu[0]; filled++; if (f[0] < cs) small++ }
    const cacheB = WG.createStorageBuffer(cells)
    const sub = (a, b) => a.map((v, k) => v - b[k]), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const centre = lo.map(v => v + N * cs / 2)
    /* the ray as STEP_CACHE_VIEW_WGSL makes it (genrays.js's), then brute force along it */
    function reference(cam, uv, perCell = 200) {
        const xy = [uv[0] * 2 - 1, uv[1] * 2 - 1]
        let o = cam.pos, d = cam.fwd.map(v => -v)
        if (cam.type === 0) d = unit([0, 1, 2].map(k => cam.right[k] * xy[0] * cam.fx + cam.up[k] * xy[1] * cam.fy - cam.fwd[k]))
        else o = [0, 1, 2].map(k => o[k] + cam.right[k] * xy[0] * cam.fx + cam.up[k] * xy[1] * cam.fy)
        let acc = [0, 0, 0, 0], last = -1
        const far = Math.hypot(...sub(o, centre)) + N * cs, dt = cs / perCell
        for (let t = 0; t < far; t += dt) {
            const g = [0, 1, 2].map(k => Math.floor((o[k] + d[k] * t - lo[k]) / cs))
            if (g.some(v => v < 0 || v >= N)) { if (last >= 0) break; continue }
            const k = g[0] + N * (g[1] + N * g[2])
            if (k === last) continue
            last = k
            if (!cells[k]) continue
            fu[0] = cells[k]
            if (f[0] >= cs) continue                      // a ball that reaches past its cell: clear
            const col = [1.0, 0.45, 0.1], a = 0.05, w = 1 - acc[3]
            acc = [acc[0] + col[0] * a * w, acc[1] + col[1] * a * w, acc[2] + col[2] * a * w, acc[3] + a * w]
        }
        return acc
    }
    /* whether the pixel's ray crosses any filled cell at all (brute force, coarse): for the pixels that show nothing */
    function crossesAny(cam, uv) {
        const xy = [uv[0] * 2 - 1, uv[1] * 2 - 1]
        let o = cam.pos, d = cam.fwd.map(v => -v)
        if (cam.type === 0) d = unit([0, 1, 2].map(k => cam.right[k] * xy[0] * cam.fx + cam.up[k] * xy[1] * cam.fy - cam.fwd[k]))
        else o = [0, 1, 2].map(k => o[k] + cam.right[k] * xy[0] * cam.fx + cam.up[k] * xy[1] * cam.fy)
        const far = Math.hypot(...sub(o, centre)) + N * cs, dt = cs / 50
        for (let t = 0; t < far; t += dt) {
            const g = [0, 1, 2].map(k => Math.floor((o[k] + d[k] * t - lo[k]) / cs))
            if (g.some(v => v < 0 || v >= N)) continue
            if (cells[g[0] + N * (g[1] + N * g[2])]) return true
        }
        return false
    }
    const camAt = (pos, type, fx) => {
        const fwd = unit(sub(pos, centre)), right = unit(cross([0, 0, 1], fwd)), up = cross(fwd, right)
        return { pos, fwd, right, up, type, fx, fy: fx }
    }
    for (const [what, cam] of [['a perspective camera', camAt([3.3, -2.1, 4.4], 0, 0.6)], ['an orthographic camera', camAt([-4.2, 9.5, 3.1], 1, 2.6)]]) {
        const P = 1024, input = new Float32Array(4 * P), uvs = []
        for (let i = 0; i < P; i++) { const uv = [rnd(), rnd()]; uvs.push(uv); input[4 * i] = uv[0]; input[4 * i + 1] = uv[1] }
        const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(16 * P)
        prog.resources = { viewIn: inB.b, viewOut: outB.b, stepCache: cacheB.b }
        prog.uniforms = { scLo: [...lo, cs], scDims: [N, N, N, 0], camPos: [...cam.pos, 1], camtype: cam.type,
                          invView: [...cam.right, 0, ...cam.up, 0, ...cam.fwd, 0, ...cam.pos, 1],
                          invProjection: [cam.fx, 0, 0, 0, 0, cam.fy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
        prog.dispatch(Math.ceil(P / 64), 1, 1)
        const out = await outB.r(Float32Array)
        inB.b.destroy(); outB.b.destroy()
        let differ = 0, refined = 0, covered = 0, green = 0, orange = 0, crossesBig = 0
        const unlike = (g, r) => g.some((v, k) => Math.abs(v - r[k]) > 1e-4)
        uvs.forEach((uv, i) => {
            const g = [0, 1, 2, 3].map(k => out[4 * i + k])
            let r = reference(cam, uv)
            if (unlike(g, r)) { refined++; r = reference(cam, uv, 20000) }
            if (unlike(g, r)) differ++
            if (r[3] > 0) covered++
            if (g[3] > 0 && g[1] > g[0]) green++
            if (g[3] > 0 && g[0] > g[1]) orange++
            // a pixel whose ray crosses only cells with big balls: clear (brute force with those drawn would see them)
            if (r[3] === 0 && crossesAny(cam, uv)) crossesBig++
        })
        say(`  the cells shown, ${what}: ${covered} of ${P} pixels cross a cell with a small ball (${filled} of ${N ** 3} filled, ${small} of them small); ${refined} sampled finer, ${differ} differ from brute force`)
        // (P / 8: only the small balls are drawn since 0.32.2, half the filled cells -- P / 4 was every filled cell's share)
        ok(`the cells shown, ${what}: the walk composites the cells brute force enters, in its order, every pixel`, differ === 0 && covered > P / 8, `${differ} differ, ${covered} covered`)
        ok(`the cells shown, ${what}: orange alone -- a cell whose ball is smaller than a cell; one whose ball reaches past it clear, not green`,
            orange > 0 && green === 0 && crossesBig > 0, `${orange} orange, ${green} green, ${crossesBig} pixels crossing big balls alone, clear`)
    }
    cacheB.b.destroy()
}

say(`step cache on a GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
