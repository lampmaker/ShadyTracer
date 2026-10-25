//======================================================================================================================
// THE MARCH ON DISTANCE ONLY ON A REAL WEBGPU (lib/pathtracer/core/wavefront.js prog_march's distOnly and prog_surface's
// THE HIT ITSELF, scene_api.js FOLD_DIST; the developer setting marchDist, 0.next). Run:
//   node builder/test/marchdist.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as stepcache.gpu.mjs is: the `webgpu` package and a Vulkan driver (lavapipe), or it says
// so and passes.
//
// The user's requirement (2026-10-25): no change to the picture. So the picture is what is compared:
//   - THE KERNELS: camera rays through the march built without the option and with it, pass after pass as the renderer
//     chains it -- every bench scene as codegen, the optics bench as data, culled by boxes measured as the page measures
//     them. Every ray ends in the same state, at the same place and in the same number of steps; the distance is the
//     same expression, so the places are compared bit for bit and the count of any that differ printed.
//   - THE WHOLE RENDERER (R.trace): a few samples of each scene with the setting off and on, from the same seeds, with
//     lavapipe on one thread so the queues' order is the same both times (sppm.gpu.mjs says why both are needed). The
//     pictures compared pixel by pixel -- how many bit for bit, the largest difference -- and, whatever that count,
//     the two means within their paired error bar. The scenes: the showcase, the material test and dichroics, baked as
//     the page shows them once the edits stop; Dusty beam's haze box (the march's haze build with it); and spheres
//     and a smooth blend by hand, whose shapes give the normals the march no longer asks for.
// COUNTS AND PICTURES, NOT TIMES (CLAUDE.md): what it saves is the card's to say (Tests > marchdist).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

/* lavapipe reads it when the device is made, below: one thread, so the queues' order is the same every run */
process.env.LP_NUM_THREADS ??= '0'
/* every seed the renderer draws comes from Math.random (utilities.js seed_vec4u32): reseeded before each picture */
const reseed = seed => {
    let a = seed >>> 0
    Math.random = () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = Math.imul(a ^ (a >>> 15), a | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(distance-only march GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, boxLoName, boxHiName } = await import('../codegen.js')
const { baked } = await import('../bake.js')
const { liveInBench } = await import('../../bench/bake.js')
const { cullBoxes, createBoxes, cullUniforms } = await import('../boxes.js')
const { prog_tagfield, tagFieldTags } = await import('../../lib/pathtracer/core/field.js')
const { CAMERAS, BENCH_FILES, benchUrl } = await import('../../bench/index.js')
const { CAMERAS: SCALING_CAMERAS, SCALING_FILES } = await import('../../bench/scaling.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { prog_march, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../../lib/pathtracer/core/tracebasics.js')
const U = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive, LUMA } = await import('../../lib/pathtracer/core/photometry.js')
const { effective } = await import('../../lib/pathtracer/quality.js')
const { RAYTRACER } = await import('../../lib/pathtracer/core/raytrace_main.js')
const { CAMERA } = await import('../../lib/camera.js')
const { engineCamera } = await import('../../lib/pathtracer/core/units.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(distance-only march GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const say = console.log
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }
const t0 = Date.now()

const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
const sceneValues = scene => Object.fromEntries(Object.entries(scene.uniforms || {}).map(([k, u]) => [k, flat(u.def)]))
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(U.UniformSpec).map(([k, s]) => [k, s.def]))
    return { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null, haze: scene.haze ?? null }), ...sceneValues(scene) }
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
const cullOf = (doc, S, B) => {
    const cull = {}
    for (const [id, b] of cullBoxes(doc, B)) { if (!(boxLoName(id) in (S.uniforms || {}))) continue; const { lo, hi } = cullUniforms(b); cull[boxLoName(id)] = lo; cull[boxHiName(id)] = hi }
    return cull
}

/*----------------------------------------------------------------------------------------------------------------------
  THE KERNELS: camera rays through the march, without the option and with it
----------------------------------------------------------------------------------------------------------------------*/
/* the rays as the engine's struct (stepcache.gpu.mjs has the layout) */
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
/* an orbit camera's place, as the bench's cameras are written (stepcache.gpu.mjs cameraRays) */
const eyeOf = cam => {
    const RAD = Math.PI / 180, az = cam.azimuth * RAD, el = (90 - cam.elevation) * RAD
    return [0, 1, 2].map(k => cam.target[k] + cam.distance * [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)][k])
}
function cameraRays(cam, W, H) {
    const pos = eyeOf(cam), RAD = Math.PI / 180
    const z = unit(pos.map((v, k) => v - cam.target[k])), x = unit([-z[1], z[0], 0]), y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    const t = Math.tan(cam.fov * RAD / 2), pts = [], dirs = []
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const u = ((i + 0.5) / W * 2 - 1) * t * W / H, v = ((j + 0.5) / H * 2 - 1) * t
        pts.push(...pos); dirs.push(...unit([0, 1, 2].map(k => -z[k] + u * x[k] + v * y[k])))
    }
    return { pts, dirs }
}
const inMetres = (rays, u) => { const r = rays.slice(); for (let i = 0; i < r.length / RAY_F; i++) for (let c = 0; c < 3; c++) r[RAY_F * i + c] *= u; return r }
async function marchAll(prog, bag, rays0, buffers, passes = 160) {
    const n = rays0.length / RAY_F, rays = inMetres(rays0, bag.sceneUnit)
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
        out[hu[o + 20]] = { pos: [hu[o], hu[o + 1], hu[o + 2]], steps: hu[o + 15], state: hu[o + 19] }      // the place's bits
    }
    for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
    return out
}
async function kernels(label, S, buffers, extra, cam) {
    const bag = { ...uniformBag(S), ...extra, res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000 }
    const haze = S.haze ? 1 : 0
    const K0 = await prog_march(WG, S, 64, { haze }), K1 = await prog_march(WG, S, 64, { haze, distOnly: 1 })
    await K0.ready; await K1.ready
    ok(`${label}: the march built without the option folds the whole hit, with it the distance alone`,
        /let pass1 = /.test(K0.wgsl) && !/let pass1 = /.test(K1.wgsl))
    const { pts, dirs } = cameraRays(cam, 64, 36)
    const a = await marchAll(K0, bag, raysOf(pts, dirs), buffers), b = await marchAll(K1, bag, raysOf(pts, dirs), buffers)
    const state = b.filter((h, i) => (h?.state ?? -1) !== (a[i]?.state ?? -1)).length
    const steps = b.filter((h, i) => h && a[i] && h.steps !== a[i].steps).length
    const place = b.filter((h, i) => h && a[i] && h.pos.some((v, k) => v !== a[i].pos[k])).length
    const hits = a.filter(h => h?.state === 0).length
    say(`  ${label}: ${a.length} camera rays, ${hits} hit, ${(a.reduce((s, h) => s + (h?.steps ?? 0), 0) / a.length).toFixed(1)} steps a ray; on distance only otherwise: ${state} state, ${steps} steps, ${place} place (bit for bit)`)
    ok(`${label}: on distance only, every camera ray ends in the same state, in the same steps, at the same place bit for bit`, state + steps + place === 0,
        `${state} state, ${steps} steps, ${place} place of ${a.length}`)
}
const docOf = url => M.parse(readFileSync(fileURLToPath(url), 'utf8'))
const BENCH_SCENES = [
    ['the optics bench', benchUrl(SCALING_FILES.bench), SCALING_CAMERAS.bench],
    ['the demo', benchUrl(BENCH_FILES.demo), CAMERAS.demo],
    ['the showcase', benchUrl(BENCH_FILES.showcase), CAMERAS.showcase],
    ['the material test', benchUrl(BENCH_FILES.materials), CAMERAS.materials],
    ['dichroics', benchUrl(BENCH_FILES.dichroics), CAMERAS.dichroics],
]
for (const [label, url, cam] of BENCH_SCENES) {
    const doc = docOf(url)
    const S = generate(...M.generateArgs(doc, { id: 'built' }))
    const B = await measure(doc, S)
    await kernels(`${label} (codegen)`, S, {}, cullOf(doc, S, B), cam)
    if (url !== BENCH_SCENES[0][1]) continue
    // the optics bench as data: every node's box in its records (the page's pushCull: nested)
    const [tree] = M.generateArgs(doc, { data: true })
    const D = generate(...M.generateArgs(doc, { id: 'built', data: true }))
    D.data = D.dataOf(tree, cullBoxes(doc, B, { nested: true })).data
    await kernels(`${label} (as data)`, D, await D.init(WG), {}, cam)
}
{
    const url = new URL('../../scenes/dusty-beam.json', import.meta.url), doc = docOf(url)
    const S = generate(...M.generateArgs(doc, { id: 'built' }))
    ok('Dusty beam has a haze box (the march\'s haze build is checked on it)', !!S.haze)
    await kernels('Dusty beam (a haze box)', S, {}, {}, doc.view.camera)
}

/*----------------------------------------------------------------------------------------------------------------------
  THE WHOLE RENDERER: the picture with the setting off and on, from the same seeds
----------------------------------------------------------------------------------------------------------------------*/
const W = 32, H = 24, SAMPLES = 4
const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
const bagFor = (scene, cam, over) => {
    const v = { ...U.defaultUniformValues(), envMode: 0, uSunElevation: 50, uSunAzimuth: 30, sunDiameter: 0.53, sunIlluminance: 100000,
                skyIlluminance: 20000, nee: 1, lt: 1, ltPhotons: 1, ltLearn: 0, maxbounce: 8, rr: 0, fireflyClamp: 0,
                maxaverages: 0, autoExposure: 0, sppm: 0, ...over }
    const traced = effective(v)
    const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius, haze: scene.haze })
    const EC = engineCamera({ ...cam.getUniforms(), camLens: [0, 1, 0, 0] }, 0, derived.sceneUnit)
    return Object.fromEntries(Object.entries({ ...sceneValues(scene),
        ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
        ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
        .filter(([k]) => k in U.ComputeUniformTypes || k in U.UniformSpec || k in (scene.uniforms || {})))
}
/* a fresh renderer a picture, so the two start alike; its seeds from `seed` */
const picture = async (scene, cam, over, seed) => {
    const Q = { w: W, h: H, resetframecount: 1 }
    const R = RAYTRACER(WG, null, Q, scene)
    R.hud = () => { }
    let err = null
    try { await quietly(() => R.init()) } catch (e) { return { err: e?.message ?? String(e) } }
    const bag = bagFor(scene, cam, over)
    R.kernelOptions = R.kernelOptionsOf(bag)
    await quietly(() => R.applyKernelOptions())
    const built = { ...R.builtOptions }
    reseed(seed)
    try {
        Q.resetframecount = 1
        await quietly(() => R.trace(Q, bag, 1, target))
        Q.resetframecount = 0
        if (SAMPLES > 1) await quietly(() => R.trace(Q, bag, SAMPLES - 1, target))
        await WG.device.queue.onSubmittedWorkDone()
    } catch (e) { err = e?.message ?? String(e) }
    const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
    const f = new Float32Array(a.buffer, a.byteOffset, a.length)
    return { err, built, bits: Array.from(a), img: Array.from({ length: W * H }, (_, i) => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]) }
}
/* the two pictures' means, a over b, with the error of the pixels' paired differences (haze.gpu.mjs paired) */
const paired = (a, b) => {
    const n = a.length, mb = b.reduce((s, x) => s + x, 0) / n
    const d = a.map((x, i) => x - b[i]), md = d.reduce((s, x) => s + x, 0) / n
    return { mean: 1 + md / mb, se: Math.sqrt(d.reduce((s, x) => s + (x - md) ** 2, 0) / Math.max(n - 1, 1) / n) / mb, of: mb }
}
const camOf = (orbit, aspect) => {
    const cam = CAMERA({ aspect, fov: orbit.fov ?? 40, up: [0, 0, 1] })
    cam.setPose({ pos: eyeOf(orbit), target: orbit.target, up: [0, 0, 1] })
    return cam
}
async function compare(label, scene, orbit, over = {}) {
    const cam = camOf(orbit, W / H)
    const off = await picture(scene, cam, { ...over, marchDist: 0 }, 7), on = await picture(scene, cam, { ...over, marchDist: 1 }, 7)
    ok(`${label}: both pictures traced, built as asked (off, then on)`, !off.err && !on.err && off.built.distOnly === 0 && on.built.distOnly === 1,
        `${off.err ?? ''} ${on.err ?? ''} ${JSON.stringify([off.built, on.built])}`)
    if (off.err || on.err) return
    const px = W * H
    let same = 0, worst = 0
    for (let i = 0; i < px; i++) {
        if ([0, 1, 2, 3].every(c => on.bits[4 * i + c] === off.bits[4 * i + c])) same++
        const m = Math.max(Math.abs(off.img[i]), 1e-30)
        worst = Math.max(worst, Math.abs(on.img[i] - off.img[i]) / m)
    }
    const p = paired(on.img, off.img)
    const lit = off.img.filter(x => x > 0).length
    say(`  ${label}: ${same} of ${px} pixels bit for bit (${lit} lit), the largest difference ${(100 * worst).toFixed(3)} %, mean on/off ${p.mean.toFixed(5)} +- ${p.se.toFixed(5)}`)
    ok(`${label}: a picture to compare -- most pixels lit`, lit > px / 2, `${lit} of ${px}`)
    ok(`${label}: the picture's mean on distance only within its paired error bar of off's`, Math.abs(p.mean - 1) <= Math.max(3.5 * p.se, 1e-6), `${p.mean} +- ${p.se}`)
    ok(`${label}: every pixel bit for bit as off`, same === px, `${same} of ${px}`)
}
const bakedOf = (doc, id) => baked(generate(...M.generateArgs(doc, { id })), { live: liveInBench })
for (const [label, url, cam] of BENCH_SCENES.slice(2)) await compare(`${label}, baked`, bakedOf(docOf(url), `md-${label}`), cam)
{
    const url = new URL('../../scenes/dusty-beam.json', import.meta.url), doc = docOf(url)
    const S = generate(...M.generateArgs(doc, { id: 'md-dusty' }))
    await compare('Dusty beam (a haze box)', S, doc.view.camera)
}
/* SPHERES AND A SMOOTH BLEND BY HAND, on a floor, in glass and out: shapes that give a normal (Nsphere, csgUnion's blend
   of two), the normals the march no longer asks for and the surface kernel now does */
{
    const scene = {
        id: 'md-spheres', title: 'md-spheres', unit: 'm', extent: 3, envRadius: 6, uniforms: {},
        wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    var m = makeDefaultMaterial();
    if (idx == 1u) { m = makeDiffuse(vec3<f32>(0.7, 0.7, 0.7), 1.0); }
    if (idx == 2u) { m = makeDiffuse(vec3<f32>(0.8, 0.3, 0.2), 1.0); }
    if (idx == 3u) { m = makeGlassSmooth(vec3<f32>(1.0), 1.5); }
    return m;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    C = add_new(C, Nplane(r.pos), 1u);
    C = add_new(C, csgUnion(Nsphere(r.pos - VEC3(-0.5, 0.0, 0.45), 0.45), Nsphere(r.pos - VEC3(0.1, 0.2, 0.35), 0.35), 0.2), 2u);
    C = add_new(C, Nsphere(r.pos - VEC3(0.7, -0.5, 0.4), 0.4), 3u);
    return C;
}`,
    }
    await compare('spheres, a blend and a glass ball by hand', scene, { azimuth: -60, elevation: 65, distance: 4, target: [0, 0, 0.3], fov: 45 })
}

say(`  ${((Date.now() - t0) / 1000).toFixed(0)} s`)
console.log(`distance-only march on the GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
