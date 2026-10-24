//======================================================================================================================
// OVER-RELAXED STEPS ON A REAL WEBGPU, THROUGH THE ENGINE'S OWN KERNELS (lib/pathtracer/core/wavefront.js RELAXED STEPS
// in prog_march and prog_occlude; the developer setting relax, 0.next). Run:
//   node builder/test/relax.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as stepcache.gpu.mjs is: the `webgpu` package and a Vulkan driver (lavapipe), or it says
// so and passes.
//
// Per scene -- the bench scenes as codegen, culled by boxes measured as the page measures them; dichroics, whose plates
// are thin and whose floor the light's sheet runs along; a scene with a haze box (Dusty beam), whose collision a relaxed
// step must never pass; and a scene by hand, a thin plate looked at from just above it at a few degrees, its distance
// overestimated by 10 % (what stepscale 0.9 is there to take back) -- camera rays through the march kernel pass after pass
// as the renderer chains it, then shadow rays from where they ended through the occlusion kernel, round after round,
// built without the relaxed steps and with them:
//   - with them at 1.3 and 1.6, every camera ray ends as without: the same state, a HIT at the same place within the
//     leaving offset (10 x the march's tolerance); every shadow ray blocked or not as it was. A handful may differ where
//     the march's own tolerance decides (a grazing ray), so the bar is a share, the step cache's (0.5 %), printed with
//     the counts;
//   - fewer steps at 1.6 than without, on the plate by hand at least: the mode ran, and a mode nothing runs is code that
//     has never run (CLAUDE.md);
//   - with them built in but the factor 1, or the uniform left out of the bag (which reads 0, clamped to 1): every ray
//     the same steps and the same place, bit for bit, as without.
//   - with the step cache too (the cells ahead, filled once), on the optics bench: the two built together, run at 1.6,
//     every ray ending as plain without the cache, in fewer steps.
// COUNTS AND PLACES, NOT TIMES (CLAUDE.md): what it saves is the card's to say (Tests > relax).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(relaxed-steps GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, boxLoName, boxHiName } = await import('../codegen.js')
const { cullBoxes, createBoxes, cullUniforms } = await import('../boxes.js')
const { prog_tagfield, tagFieldTags } = await import('../../lib/pathtracer/core/field.js')
const { CAMERAS, BENCH_FILES, benchUrl } = await import('../../bench/index.js')
const { CAMERAS: SCALING_CAMERAS, SCALING_FILES } = await import('../../bench/scaling.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { prog_march, prog_occlude, prog_stepcache_fill, SC_FILL_WG, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { stepCacheBox } = await import('../stepbox.js')
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
    console.log(`(relaxed-steps GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const say = console.log
console.warn = () => { }

const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null, haze: scene.haze ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* the boxes, measured as the page measures them (stepcache.gpu.mjs's, the same) */
async function measure(doc, scene) {
    const prog = await prog_tagfield(WG, scene); await prog.ready
    const sample = async input => {
        const count = new Uint32Array(input.buffer, input.byteOffset, 4)[3]
        const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(Math.max(8 * count, 256))
        prog.resources = { fieldIn: inB.b, fieldOut: outB.b }
        prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
        prog.run(count, 1, 1)
        const out = await outB.r(8 * count, 0, Float32Array)
        inB.b.destroy(); outB.b.destroy()
        const n = out.length / 2, d = new Float32Array(n), tag = new Uint32Array(n), bits = new Uint32Array(out.buffer, out.byteOffset, out.length)
        for (let i = 0; i < n; i++) { d[i] = out[2 * i]; tag[i] = bits[2 * i + 1] }
        return { d, tag, tags: tagFieldTags(scene) }
    }
    const B = createBoxes({ sample, doc: () => doc }); await B.update()
    return B
}

/* THE RAYS as the engine's struct (stepcache.gpu.mjs has the layout) */
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
/* in metres, the engine's unit (stepcache.gpu.mjs says why) */
const inMetres = (rays, u) => { const r = rays.slice(); for (let i = 0; i < r.length / RAY_F; i++) for (let c = 0; c < 3; c++) r[RAY_F * i + c] *= u; return r }
async function marchAll(prog, bag, rays0, buffers, passes = 160) {
    const n = rays0.length / RAY_F, u = bag.sceneUnit, rays = inMetres(rays0, u)
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
        out[hu[o + 20]] = { pos: [h[o] / u, h[o + 1] / u, h[o + 2] / u], raw: [h[o], h[o + 1], h[o + 2]], steps: hu[o + 15], state: hu[o + 19] }
    }
    for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
    return out
}
async function occludeAll(prog, bag, rays0, buffers, rounds = 300) {
    const n = rays0.length / RAY_F, rays = inMetres(rays0, bag.sceneUnit)
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
const meanSteps = r => r.reduce((s, h) => s + (h?.steps ?? 0), 0) / r.length
/* ONE SCENE: built without the relaxed steps and with them; with them at 1.3 and 1.6, at 1, and with the uniform left
   out. `buffers` the scene's own, `extra` uniforms over its own (codegen's culling boxes), `rays` the camera's, `light`
   the shadow rays' direction. `fewer`: whether 1.6 must take fewer steps than plain (a scene where rays run along a
   surface; elsewhere it is printed). */
async function check(label, S, buffers, extra, { pts, dirs }, light = L, fewer = false) {
    const base = { ...uniformBag(S), ...extra, res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000 }
    const eps = Math.max((base.eps > 0 ? base.eps : base.epsAuto) / (base.sceneUnit || 1), 1e-7), offset = 10 * eps
    const haze = S.haze ? 1 : 0
    const K = {}
    for (const relax of [0, 1]) {
        K[relax] = { march: await prog_march(WG, S, 64, { relax, haze }), occl: await prog_occlude(WG, S, 64, { relax, haze }) }
        await K[relax].march.ready; await K[relax].occl.ready
    }
    ok(`${label}: built without, march and occlusion hold no check; with, both do`,
        [K[0].march.wgsl, K[0].occl.wgsl].every(t => !/\bprevR\b|UB\.relax/.test(t)) && [K[1].march.wgsl, K[1].occl.wgsl].every(t => /\bprevR\b/.test(t) && /UB\.relax/.test(t)))
    const cam0 = await marchAll(K[0].march, base, raysOf(pts, dirs), buffers)
    const sp = [], sd = []
    cam0.forEach((h, i) => { if (h?.state !== 0) return; const d = dirs.slice(3 * i, 3 * i + 3); sp.push(...h.pos.map((v, k) => v - d[k] * 2 * offset)); sd.push(...light) })
    const shadowRays = raysOf(sp, sd, 1)
    const sh0 = await occludeAll(K[0].occl, base, shadowRays, buffers)
    const lines = [`${label}: plain, steps a camera ray ${meanSteps(cam0).toFixed(1)}; ${cam0.filter(h => h?.state === 0).length} of ${cam0.length} hit, ${sh0.filter(Boolean).length} of ${sh0.length} shadow rays lit`]
    for (const om of [1.3, 1.6]) {
        const bag = { ...base, relax: om }
        const camK = await marchAll(K[1].march, bag, raysOf(pts, dirs), buffers)
        const shK = await occludeAll(K[1].occl, bag, shadowRays, buffers)
        const state = camK.filter((h, i) => (h?.state ?? -1) !== (cam0[i]?.state ?? -1)).length
        // the place of a HIT (RAY_ACTIVE, 0) or of a haze collision (a scatter's state): an escaped ray stops wherever it
        // crosses the radius, which steps move
        const place = camK.filter((h, i) => h && cam0[i] && h.state === cam0[i].state && h.state !== 2 && h.state !== 4
            && Math.hypot(...h.pos.map((v, k) => v - cam0[i].pos[k])) > offset).length
        const shadow = shK.filter((v, i) => v !== sh0[i]).length
        const what = `${label}, relax ${om}`
        lines.push(`${what}: steps a camera ray ${meanSteps(camK).toFixed(1)} (plain ${meanSteps(cam0).toFixed(1)}); ending otherwise: ${state} state, ${place} place of ${camK.length}; shadow rays otherwise ${shadow} of ${shK.length}`)
        ok(`${what}: every camera ray ends as plain, but a share the march's tolerance decides`, state + place <= SHARE * camK.length, `${state} + ${place} of ${camK.length}`)
        ok(`${what}: every shadow ray blocked or not as plain, but such a share`, shadow <= SHARE * Math.max(shK.length, 1), `${shadow} of ${shK.length}`)
        if (om === 1.6 && fewer) ok(`${what}: fewer steps than plain -- the relaxed steps ran`, meanSteps(camK) < meanSteps(cam0), `${meanSteps(camK)} against ${meanSteps(cam0)}`)
    }
    // built in, but the factor 1, or left out of the bag (0, clamped to 1): plain, bit for bit
    const { relax: _, ...without } = base
    for (const [what, bag] of [['relax 1', { ...base, relax: 1 }], ['relax left out of the bag', without]]) {
        const r = await marchAll(K[1].march, bag, raysOf(pts, dirs), buffers)
        ok(`${label}, built with it, ${what}: every camera ray the same steps and the same place, bit for bit, as plain`,
            r.every((h, i) => (h?.state ?? -1) === (cam0[i]?.state ?? -1) && (!h || (h.steps === cam0[i].steps && h.raw.every((v, k) => v === cam0[i].raw[k])))))
    }
    for (const l of lines) say('  ' + l)
    return { cam0, sh0 }
}

/* WITH THE STEP CACHE TOO (the cells ahead, filled once as R.trace fills them: stepcache.gpu.mjs's way): a ball's step is
   a safe one, after which the relaxed steps have nothing to check -- the two compiled together, run, against plain
   without the cache */
async function withCache(label, S, extra, cam, box) {
    const size = [0, 1, 2].map(k => box.hi[k] - box.lo[k]), cs = Math.cbrt(size[0] * size[1] * size[2] / 1e6)
    const dims = size.map(s => Math.max(1, Math.ceil(s / cs))), cells = dims[0] * dims[1] * dims[2]
    const mpu = uniformBag(S).sceneUnit
    const base = { ...uniformBag(S), ...extra, res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000, scLo: [...box.lo.map(x => x * mpu), cs * mpu], scDims: [...dims, 0] }
    const eps = Math.max((base.eps > 0 ? base.eps : base.epsAuto) / (base.sceneUnit || 1), 1e-7), offset = 10 * eps
    const K0 = { march: await prog_march(WG, S, 64), occl: await prog_occlude(WG, S, 64) }
    const KC = { march: await prog_march(WG, S, 64, { stepCache: 2, relax: 1 }), occl: await prog_occlude(WG, S, 64, { stepCache: 2, relax: 1 }) }
    for (const k of [K0, KC]) { await k.march.ready; await k.occl.ready }
    const fill = await prog_stepcache_fill(WG, S); await fill.ready
    const cache = WG.createStorageBuffer(4 * cells)
    fill.resources = { stepCache: cache.b }
    fill.uniforms = base
    fill.dispatch(Math.ceil(cells / SC_FILL_WG), 1, 1)
    await cache.r(Uint32Array)
    const { pts, dirs } = cameraRays(cam, W, H)
    const cam0 = await marchAll(K0.march, base, raysOf(pts, dirs), {})
    const sp = [], sd = []
    cam0.forEach((h, i) => { if (h?.state !== 0) return; const d = dirs.slice(3 * i, 3 * i + 3); sp.push(...h.pos.map((v, k) => v - d[k] * 2 * offset)); sd.push(...L) })
    const shadowRays = raysOf(sp, sd, 1)
    const sh0 = await occludeAll(K0.occl, base, shadowRays, {})
    const bag = { ...base, relax: 1.6 }
    const camC = await marchAll(KC.march, bag, raysOf(pts, dirs), { stepCache: cache.b })
    const shC = await occludeAll(KC.occl, bag, shadowRays, { stepCache: cache.b })
    const state = camC.filter((h, i) => (h?.state ?? -1) !== (cam0[i]?.state ?? -1)).length
    const place = camC.filter((h, i) => h && cam0[i] && h.state === 0 && cam0[i].state === 0 && Math.hypot(...h.pos.map((v, k) => v - cam0[i].pos[k])) > offset).length
    const shadow = shC.filter((v, i) => v !== sh0[i]).length
    const what = `${label}, relax 1.6 with the step cache (cells ahead)`
    say(`  ${what}: steps a camera ray ${meanSteps(camC).toFixed(1)} (plain without the cache ${meanSteps(cam0).toFixed(1)}); ending otherwise: ${state} state, ${place} place of ${camC.length}; shadow rays otherwise ${shadow} of ${shC.length}`)
    ok(`${what}: built together, both in each kernel`, [KC.march.wgsl, KC.occl.wgsl].every(t => /\bscStep\b/.test(t) && /\bprevR\b/.test(t)))
    ok(`${what}: every camera ray ends as plain without the cache, but a share`, state + place <= SHARE * camC.length, `${state} + ${place} of ${camC.length}`)
    ok(`${what}: every shadow ray blocked or not as plain, but such a share`, shadow <= SHARE * Math.max(shC.length, 1), `${shadow} of ${shC.length}`)
    ok(`${what}: fewer steps than plain without the cache -- both ran`, meanSteps(camC) < meanSteps(cam0), `${meanSteps(camC)} against ${meanSteps(cam0)}`)
    cache.b.destroy()
}

// ---- the bench scenes, culled as the page culls, codegen
const fromFile = async (label, file, cam, fewer = false) => {
    const doc = M.parse(readFileSync(fileURLToPath(file), 'utf8'))
    const S = generate(...M.generateArgs(doc, { id: 'built' }))
    const B = await measure(doc, S)
    const cull = {}
    for (const [id, b] of cullBoxes(doc, B)) { if (!(boxLoName(id) in (S.uniforms || {}))) continue; const { lo, hi } = cullUniforms(b); cull[boxLoName(id)] = lo; cull[boxHiName(id)] = hi }
    await check(label, S, {}, cull, cameraRays(cam, W, H), L, fewer)
    return { doc, S, B, cull, cam }
}
{
    const { doc, S, B, cull, cam } = await fromFile('the optics bench', benchUrl(SCALING_FILES.bench), SCALING_CAMERAS.bench)
    const box = stepCacheBox(doc, B)
    ok('the optics bench: a box for the step cache', !!box, JSON.stringify(box))
    if (box) await withCache('the optics bench', S, cull, cam, box)
}
await fromFile('the demo', benchUrl(BENCH_FILES.demo), CAMERAS.demo)
await fromFile('the showcase', benchUrl(BENCH_FILES.showcase), CAMERAS.showcase)
await fromFile('the material test', benchUrl(BENCH_FILES.materials), CAMERAS.materials)
await fromFile('dichroics (thin plates)', benchUrl(BENCH_FILES.dichroics), CAMERAS.dichroics)
// ---- dust in the air: the march's haze build, whose collision a relaxed step must never pass
{
    const url = new URL('../../scenes/dusty-beam.json', import.meta.url)
    const doc = M.parse(readFileSync(fileURLToPath(url), 'utf8'))
    ok('Dusty beam has a haze box (the scene the haze build is checked on)', !!generate(...M.generateArgs(doc, { id: 'built' })).haze)
    await fromFile('Dusty beam (a haze box)', url, doc.view.camera)
}
// ---- A THIN PLATE BY HAND, looked at from just above it: its distance 10 % over the truth (what stepscale takes back),
//      every ray coming down onto it at 1.5 to 6 degrees -- many plain steps a ray, where the relaxed ones must pay and
//      must not pass through it; the shadow rays run along it, half of them into a thin wall on the way
{
    const S = {
        id: 'relax-plate', title: 'relax-plate', unit: 'm', extent: 2, envRadius: 3, uniforms: {},
        wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    var m = makeDefaultMaterial();
    m = makeDiffuse(vec3<f32>(0.8), 1.0);
    return m;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    var b = NboxRounded(r.pos - VEC3(0.0, 0.0, -0.001), VEC3(1.5, 1.5, 0.001), 0.0);
    b.w = b.w * 1.1;
    C = add_new(C, b, 4u);
    var w = NboxRounded(r.pos - VEC3(0.5, 0.6, 0.1), VEC3(0.5, 0.0015, 0.1), 0.0);
    w.w = w.w * 1.1;
    C = add_new(C, w, 4u);
    return C;
}`,
    }
    const pts = [], dirs = []
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const a = (1.5 + 4.5 * j / (H - 1)) * Math.PI / 180, s = (i / (W - 1) - 0.5) * 0.6
        pts.push(s, -1.2, 0.05); dirs.push(...unit([0.15 * s, Math.cos(a), -Math.sin(a)]))
    }
    const { sh0 } = await check('a thin plate and a thin wall by hand, grazed (distance 10 % over)', S, {}, {}, { pts, dirs }, unit([0, 1, 0.03]), true)
    const lit = sh0.filter(Boolean).length
    ok('...its shadow rays both ways: some reach past the wall along the plate, some are stopped by it', lit > 0.1 * sh0.length && lit < 0.9 * sh0.length, `${lit} of ${sh0.length} lit`)
}

console.log(`relaxed steps on the GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
