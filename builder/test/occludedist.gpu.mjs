//======================================================================================================================
// SHADOW RAYS ON DISTANCE ONLY ON A REAL WEBGPU (lib/pathtracer/core/wavefront.js prog_occlude's distOnly, prog_occlude_emit
// and prog_prep_occlude_indirect's `emit`; 0.next, the renderer's always). Run:
//   node builder/test/occludedist.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as marchdist.gpu.mjs is: the `webgpu` package and a Vulkan driver (lavapipe), or it says
// so and passes.
//
// No change to the picture, the user's requirement for the march (2026-10-25) and so for this. It was the developer setting
// occludeDist for one run of Tests > occludedist, and is always on since; the full kernel is still prog_occlude with no
// option. What is compared:
//   - THE KERNELS, SHADOW RAYS AS THE SCENES MAKE THEM: from where the bench scenes' camera rays end (as code, the optics
//     bench as data, a haze box), towards the sun, through the full occlusion kernel and the distance-only one, round
//     after round as R.trace chains them. Every ray's deposit the same, bit for bit, and every round's queue: a ray that
//     took more steps would leave it later, and at a sample's last round be cut and counted unoccluded.
//   - THE EMITTER RAYS, the one shadow ray that asks a material: a scene by hand with glowing panels -- one whose glow asks
//     for its own point (the capture trip) -- an occluder and a floor, emitter shadow rays from the floor towards the
//     panels, some blocked by the occluder, with and without a haze box. Through the full kernel, and through the
//     distance-only kernel with the prep and the resolve between its rounds and after the last. The frame buffer the
//     same, bit for bit; rays marked and resolved (the mode ran); none dropped past the queue's cap.
//   - THE WHOLE RENDERER (R.trace): a few samples as built, and from the same seeds with the full occlusion kernel put in
//     its place, lavapipe on one thread (sppm.gpu.mjs says why both). Every pixel bit for bit -- the bench scenes baked,
//     Dusty beam, and the glowing panels by hand, whose emitters discovery finds, so emitter shadow rays run.
// COUNTS AND PICTURES, NOT TIMES (CLAUDE.md): what it saves is the card's to say (Tests > occludedist).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

process.env.LP_NUM_THREADS ??= '0'
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
if (!webgpu) { console.log('(distance-only shadow rays GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, boxLoName, boxHiName } = await import('../codegen.js')
const { baked } = await import('../bake.js')
const { liveInBench } = await import('../../bench/bake.js')
const { cullBoxes, createBoxes, cullUniforms } = await import('../boxes.js')
const { prog_tagfield, tagFieldTags } = await import('../../lib/pathtracer/core/field.js')
const { CAMERAS, BENCH_FILES, benchUrl } = await import('../../bench/index.js')
const { CAMERAS: SCALING_CAMERAS, SCALING_FILES } = await import('../../bench/scaling.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const W_ = await import('../../lib/pathtracer/core/wavefront.js')
const { prog_march, prog_occlude, prog_occlude_emit, prog_prep_occlude_indirect, prog_shadow_flip, counterWords, COUNTER_WORDS, EMIT_ARGS_WORDS } = W_
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
    console.log(`(distance-only shadow rays GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
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

/* THE RAYS as the engine's struct (stepcache.gpu.mjs has the layout): pos, dir, radiance, beta, then counts, n, ltot,
   bounces, state, pix, sunmis, tag, tmax, prevPdf, vtxLtot, ltMis */
const RAY_F = RAY_BYTES / 4, HIT_F = SHADE_ITEM_BYTES / 4
function raysOf(pts, dirs, radiance = 0, tag = 0) {
    const n = pts.length / 3, f = new Float32Array(RAY_F * n), u = new Uint32Array(f.buffer)
    for (let i = 0; i < n; i++) {
        const o = RAY_F * i
        f.set(pts.slice(3 * i, 3 * i + 3), o); f.set(dirs.slice(3 * i, 3 * i + 3), o + 4)
        f[o + 8] = radiance; f[o + 9] = radiance; f[o + 10] = radiance
        f[o + 12] = 1; f[o + 13] = 1; f[o + 14] = 1
        u[o + 15] = 0; f[o + 16] = 1; f[o + 17] = 0; u[o + 18] = 0; u[o + 19] = 0; u[o + 20] = i; f[o + 21] = 1
        u[o + 22] = tag; f[o + 23] = 0; f[o + 24] = -1; f[o + 25] = 0; f[o + 26] = 0
    }
    return f
}
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) }
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
/* camera rays through the full march, for where shadow rays start: { pos (scene units), state } per ray */
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
    for (let k = 0; k < shaded; k++) { const o = HIT_F * k; out[hu[o + 20]] = { pos: [h[o] / u, h[o + 1] / u, h[o + 2] / u], state: hu[o + 19] } }
    for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
    return out
}

/* THE SHADOW RAYS' ROUNDS, as R.trace chains them: prep, (the resolve,) occlusion, then a flip, round after round until
   the queue is empty; on distance only, a last flip, prep and resolve for what the last round marked. Out: the frame
   buffer's bits, how many rays were marked and resolved, and how many shadow rays the queue was asked to hold past its
   cap (none may be). `K` { occl, prep, emit, flip }: emit and its prep only on distance only. */
async function shadowRounds(K, bag, rays0, buffers, rounds = 300) {
    const n = rays0.length / RAY_F, rays = inMetres(rays0, bag.sceneUnit)
    const sb0 = WG.createStorageBuffer(rays), sb1 = WG.createStorageBuffer(rays.byteLength)
    const frame = WG.createStorageBuffer(16 * n), splat = WG.createStorageBuffer(16 * n)
    const counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    // the renderer's emitArgs (raytrace_main.js), and COPY_SRC (4) so the test can read it through a storage buffer
    const indirect = WG.createIndirectBuffer(), emitArgs = WG.createBuffer(4 * EMIT_ARGS_WORDS, 256 | 128 | 8 | 4, 'emitArgs')
    emitArgs.w(new Uint32Array(EMIT_ARGS_WORDS))
    const probe = WG.createStorageBuffer(4 * EMIT_ARGS_WORDS)
    const readEmit = async () => {
        const enc = WG.device.createCommandEncoder()
        enc.copyBufferToBuffer(emitArgs.b, 0, probe.b, 0, 4 * EMIT_ARGS_WORDS)
        WG.device.queue.submit([enc.finish()])
        return await probe.r(Uint32Array)
    }
    const dist = !!K.emit
    K.occl.resources = { shadowBuffer0: sb0.b, shadowBuffer1: sb1.b, frame_u32: frame.b, splat_u32: splat.b, counters: counters.b, ...(dist ? { emitArgs: emitArgs.b } : {}), ...buffers }
    K.prep.resources = { counters: counters.b, indirectOut: indirect.b, ...(dist ? { emitArgs: emitArgs.b } : {}) }
    K.flip.resources = { counters: counters.b }
    if (dist) K.emit.resources = { shadowBuffer0: sb0.b, shadowBuffer1: sb1.b, frame_u32: frame.b, counters: counters.b, ...buffers }
    counters.w(counterWords({ 6: n, 3: 0, 8: n }))       // the read side (0) holds the rays, the cap one a ray
    let marked = 0, resolvedRounds = 0, over = 0, cut = 0
    const side = c => [c[6], c[7]], queue = []
    for (let p = 0; p < rounds; p++) {
        K.occl.uniforms = { ...bag, lastpass: 0 }
        if (dist) K.emit.uniforms = { ...bag, lastpass: 0 }
        K.prep.dispatch(1, 1, 1)
        if (dist) { K.emit.dispatchIndirect(emitArgs.b, 0); const a = await readEmit(); if (a[0] > 0) resolvedRounds++ }
        K.occl.dispatchIndirect(indirect.b, 0)
        const c = await counters.r(Uint32Array)
        const readfrom = c[3], next = side(c)[1 - readfrom]
        over = Math.max(over, next - n); queue.push(next); cut = c[10]
        if (dist) { const a = await readEmit(); if (a[3]) marked++ }
        if (next === 0) break
        K.flip.dispatch(1, 1, 1)
    }
    if (dist) {                                          // what the last round marked: flip, prep, resolve
        K.flip.dispatch(1, 1, 1); K.prep.dispatch(1, 1, 1); K.emit.dispatchIndirect(emitArgs.b, 0)
        const a = await readEmit(); if (a[0] > 0) resolvedRounds++
    }
    const f = await frame.r(Uint32Array)
    for (const b of [sb0, sb1, frame, splat, counters, indirect, emitArgs, probe]) b.b.destroy()
    return { bits: Array.from(f), marked, resolvedRounds, over, queue, cut }
}
async function kernelsFor(S, haze) {
    const K0 = { occl: await prog_occlude(WG, S, 64, { haze }), prep: await prog_prep_occlude_indirect(WG, 64), flip: await prog_shadow_flip(WG) }
    const K1 = { occl: await prog_occlude(WG, S, 64, { haze, distOnly: 1 }), prep: await prog_prep_occlude_indirect(WG, 64, { emit: 1 }),
                 emit: await prog_occlude_emit(WG, S, 64, { haze }), flip: await prog_shadow_flip(WG) }
    for (const k of [K0, K1]) for (const p of Object.values(k)) await p.ready
    return { K0, K1 }
}
const sameBits = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d }

/* the scenes' own shadow rays: from where the camera rays end, backed off along them, towards the sun's direction */
const SUN = unit([0.3, 0.2, 0.93])
async function sceneShadows(label, S, buffers, extra, cam) {
    const bag = { ...uniformBag(S), ...extra, res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000 }
    const eps = Math.max((bag.eps > 0 ? bag.eps : bag.epsAuto) / (bag.sceneUnit || 1), 1e-7), offset = 10 * eps
    const haze = S.haze ? 1 : 0
    const KM = await prog_march(WG, S, 64, { haze }); await KM.ready
    const { pts, dirs } = cameraRays(cam, 48, 27)
    const hits = await marchAll(KM, bag, raysOf(pts, dirs), buffers)
    const sp = [], sd = []
    hits.forEach((h, i) => { if (h?.state !== 0) return; const d = dirs.slice(3 * i, 3 * i + 3); sp.push(...h.pos.map((v, k) => v - d[k] * 2 * offset)); sd.push(...SUN) })
    const { K0, K1 } = await kernelsFor(S, haze)
    const a = await shadowRounds(K0, bag, raysOf(sp, sd, 1), buffers), b = await shadowRounds(K1, bag, raysOf(sp, sd, 1), buffers)
    const differ = sameBits(a.bits, b.bits), lit = a.bits.filter((v, i) => i % 4 === 0 && v !== 0).length
    say(`  ${label}: ${sp.length / 3} shadow rays, ${lit} lit, ${a.queue.length} rounds; on distance only, ${differ} frame words differ`)
    ok(`${label}: every shadow ray's deposit on distance only bit for bit the full kernel's`, sp.length > 0 && differ === 0, `${differ} words`)
    /* ...AND EVERY RAY ENDING IN THE SAME ROUND, none cut: a ray that took more steps on distance only would leave the
       queue later, and at the renderer's last round be cut and counted unoccluded -- the user's Pascal log (64535ad) had
       the queue draining later on the Menger cubes and the Noise library, two scenes this test did not have then */
    ok(`${label}: ...each round's queue the same both ways, and as many cut by maxiter`, a.queue.join() === b.queue.join() && a.cut === b.cut,
        `full ${a.queue.join(' ')} cut ${a.cut}; distance only ${b.queue.join(' ')} cut ${b.cut}`)
    ok(`${label}: ...and no emitter ray among them marked (none was sent)`, b.marked === 0 && b.resolvedRounds === 0)
}
const docOf = url => M.parse(readFileSync(fileURLToPath(url), 'utf8'))
const BENCH_SCENES = [
    ['the optics bench', benchUrl(SCALING_FILES.bench), SCALING_CAMERAS.bench],
    ['the showcase', benchUrl(BENCH_FILES.showcase), CAMERAS.showcase],
    ['the material test', benchUrl(BENCH_FILES.materials), CAMERAS.materials],
    ['dichroics', benchUrl(BENCH_FILES.dichroics), CAMERAS.dichroics],
    // the two whose queues drained later in the user's log (above, sceneShadows)
    ['the Noise library', benchUrl(BENCH_FILES.noise), CAMERAS.noise],
    ['the Menger cubes', benchUrl(BENCH_FILES.Menger_cubes), CAMERAS.Menger_cubes],
]
for (const [label, url, cam] of BENCH_SCENES) {
    const doc = docOf(url)
    const S = generate(...M.generateArgs(doc, { id: 'built' }))
    const B = await measure(doc, S)
    await sceneShadows(`${label} (codegen)`, S, {}, cullOf(doc, S, B), cam)
    if (url !== BENCH_SCENES[0][1]) continue
    const [tree] = M.generateArgs(doc, { data: true })
    const D = generate(...M.generateArgs(doc, { id: 'built', data: true }))
    D.data = D.dataOf(tree, cullBoxes(doc, B, { nested: true })).data
    await sceneShadows(`${label} (as data)`, D, await D.init(WG), {}, cam)
}
{
    const url = new URL('../../scenes/dusty-beam.json', import.meta.url), doc = docOf(url)
    const S = generate(...M.generateArgs(doc, { id: 'built' }))
    ok('Dusty beam has a haze box', !!S.haze)
    await sceneShadows('Dusty beam (a haze box)', S, {}, {}, doc.view.camera)
}

/*----------------------------------------------------------------------------------------------------------------------
  THE EMITTER RAYS: glowing panels by hand, an occluder, a floor
----------------------------------------------------------------------------------------------------------------------*/
const box = (centre, half, mfp, albedo, g) => ({ centre, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half, mfp, albedo, g })
const panels = (id, haze = null) => ({
    id, title: id, unit: 'm', extent: 3, envRadius: 6, uniforms: {}, ...(haze ? { haze } : {}),
    wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    var m = makeDefaultMaterial();
    if (idx == 1u) { m = makeDiffuse(vec3<f32>(0.7), 1.0); }
    if (idx == 2u) { m = makeEmissive(vec3<f32>(3.0, 2.0, 1.0)); }
    // a glow that asks for its own point: the capture trip
    if (idx == 3u) { m = makeEmissive(vec3<f32>(1.0 + 0.5 * abs(localPoint(C.r).x), 1.0, 2.0)); }
    return m;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    C = add_new(C, Nplane(r.pos), 1u);
    C = add_new(C, NboxRounded(r.pos - VEC3(-0.5, 0.0, 1.2), VEC3(0.4, 0.4, 0.02), 0.0), 2u);
    C = add_new(C, NboxRounded(r.pos - VEC3(0.6, 0.2, 1.0), VEC3(0.3, 0.3, 0.02), 0.0), 3u);
    C = add_new(C, Nsphere(r.pos - VEC3(0.0, 0.0, 0.6), 0.25), 1u);
    return C;
}`,
})
async function emitterRays(label, S) {
    const bag = { ...uniformBag(S), res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000 }
    const haze = S.haze ? 1 : 0
    // from a grid on the floor towards points on the two panels: some meet the sphere first
    const pts = [], dirs = []
    for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++) {
        const p = [-1 + 2 * i / 23, -1 + 2 * j / 23, 0.002]
        const to = (i + j) % 2 ? [-0.5 + 0.6 * (i / 23 - 0.5), 0.6 * (j / 23 - 0.5), 1.17] : [0.6 + 0.4 * (i / 23 - 0.5), 0.2 + 0.4 * (j / 23 - 0.5), 0.97]
        pts.push(...p); dirs.push(...unit(to.map((v, k) => v - p[k])))
    }
    const { K0, K1 } = await kernelsFor(S, haze)
    const TAG_EMIT = 32
    const a = await shadowRounds(K0, bag, raysOf(pts, dirs, 1, TAG_EMIT), {}), b = await shadowRounds(K1, bag, raysOf(pts, dirs, 1, TAG_EMIT), {})
    const differ = sameBits(a.bits, b.bits), lit = a.bits.filter((v, i) => i % 4 === 0 && v !== 0).length, n = pts.length / 3
    say(`  ${label}: ${n} emitter rays, ${lit} found a glow; on distance only ${b.marked} rounds marked, ${b.resolvedRounds} resolved, ${differ} frame words differ, ${b.over} past the cap`)
    ok(`${label}: emitter rays, the frame on distance only bit for bit the full kernel's`, differ === 0, `${differ} words`)
    ok(`${label}: ...both ways some found a glow and some did not (the sphere in the way): a picture to compare`, lit > n / 10 && lit < n * 0.95, `${lit} of ${n}`)
    ok(`${label}: ...rays marked and resolved -- the mode ran -- and none asked for past the queue's cap`, b.marked > 0 && b.resolvedRounds > 0 && b.over <= 0)
}
await emitterRays('glowing panels by hand', panels('od-panels'))
await emitterRays('glowing panels by hand, in a haze box', panels('od-panels-haze', box([0, 0, 0.6], [1.2, 1.2, 0.6], 2.0, [0.8, 0.8, 0.8], 0.3)))

/*----------------------------------------------------------------------------------------------------------------------
  THE WHOLE RENDERER: the picture as built and with the full occlusion kernel put in, from the same seeds
----------------------------------------------------------------------------------------------------------------------*/
const W = 32, H = 24, SAMPLES = 6
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
/* `full`: the full occlusion kernel put in the renderer's place, as it was before. It declares no emitArgs, which the
   renderer binds to its own (raytrace_main.js rebind) -- tinywebgpu refuses a name a pipeline does not declare, so that
   one binding is left out on the way in. The prep and the resolve stay: no ray is marked, so the resolve is zero groups. */
const fullOcclusion = async (R, scene) => {
    const k = await prog_occlude(WG, scene, R.wvf_wg, { haze: scene.haze ? 1 : 0 }); await k.ready
    return new Proxy(k, { set(t, key, v) { if (key === 'resources') { const { emitArgs, ...rest } = v; t.resources = rest } else t[key] = v; return true } })
}
const picture = async (scene, cam, over, seed, full = false) => {
    const Q = { w: W, h: H, resetframecount: 1 }
    const R = RAYTRACER(WG, null, Q, scene)
    R.hud = () => { }
    let err = null
    try { await quietly(() => R.init()) } catch (e) { return { err: e?.message ?? String(e) } }
    const bag = bagFor(scene, cam, over)
    R.kernelOptions = R.kernelOptionsOf(bag)
    await quietly(() => R.applyKernelOptions())
    if (full) { R.prog_wvfocclude = await fullOcclusion(R, scene); R.rebind() }
    const occludeText = R.prog_wvfocclude.wgsl, emit = !!R.prog_occlude_emit
    reseed(seed)
    try {
        Q.resetframecount = 1
        await quietly(() => R.trace(Q, bag, 1, target))
        Q.resetframecount = 0
        for (let s = 1; s < SAMPLES; s++) { await quietly(() => R.trace(Q, bag, 1, target)); await WG.device.queue.onSubmittedWorkDone(); await R.readEmitCount?.() }
        await WG.device.queue.onSubmittedWorkDone()
    } catch (e) { err = e?.message ?? String(e) }
    const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
    const f = new Float32Array(a.buffer, a.byteOffset, a.length)
    return { err, occludeText, emit, emitters: R.emitCount, bits: Array.from(a), img: Array.from({ length: W * H }, (_, i) => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]) }
}
const camOf = (orbit, aspect) => {
    const cam = CAMERA({ aspect, fov: orbit.fov ?? 40, up: [0, 0, 1] })
    cam.setPose({ pos: eyeOf(orbit), target: orbit.target, up: [0, 0, 1] })
    return cam
}
async function compare(label, scene, orbit, over = {}, emitters = false) {
    const cam = camOf(orbit, W / H)
    const off = await picture(scene, cam, over, 7, true), on = await picture(scene, cam, over, 7)
    ok(`${label}: both pictures traced, the renderer's occlusion on distance only with its resolve and the full one put in its place`,
        !off.err && !on.err && on.emit && /RAY_HIT_TARGET;/.test(on.occludeText) && !/RAY_HIT_TARGET;/.test(off.occludeText), `${off.err ?? ''} ${on.err ?? ''}`)
    if (off.err || on.err) return
    const px = W * H
    let same = 0, worst = 0, where = ''
    const fo = new Float32Array(new Uint32Array(off.bits).buffer), fn = new Float32Array(new Uint32Array(on.bits).buffer)
    for (let i = 0; i < px; i++) {
        if ([0, 1, 2, 3].every(c => on.bits[4 * i + c] === off.bits[4 * i + c])) { same++; continue }
        for (let c = 0; c < 4; c++) { const d = Math.abs(fn[4 * i + c] - fo[4 * i + c]) / Math.max(Math.abs(fo[4 * i + c]), 1e-30); if (d > worst) { worst = d; where = `pixel ${i} word ${c}: ${fo[4 * i + c]} against ${fn[4 * i + c]}` } }
    }
    const lit = off.img.filter(x => x > 0).length
    say(`  ${label}: ${same} of ${px} pixels bit for bit (${lit} lit), ${on.emitters} emitters found${same < px ? `; the largest difference ${worst.toExponential(2)} (${where})` : ''}`)
    ok(`${label}: a picture to compare -- most pixels lit`, lit > px / 2, `${lit} of ${px}`)
    /* BIT FOR BIT, OR THE SAME SUM IN ANOTHER ORDER: an emitter ray's light lands a round later on distance only (its
       resolve runs before the next round), and the frame adds its floats atomically in the order they come -- so with
       emitters about, a pixel can be the same terms summed in another order, a few units of f32's last place apart
       (the showcase, 2026-10-25: 2 of 768 pixels, 1.5e-7). Without emitters, nothing comes later: bit for bit. */
    ok(`${label}: every pixel bit for bit as with the full kernel${on.emitters > 0 ? ', or the same sum in another order (within 1e-6)' : ''}`,
        same === px || (on.emitters > 0 && worst <= 1e-6), `${same} of ${px}, ${worst}`)
    if (emitters) ok(`${label}: ...emitters found, so emitter shadow rays ran`, on.emitters > 0 && off.emitters > 0, `${off.emitters} ${on.emitters}`)
}
const bakedOf = (doc, id) => baked(generate(...M.generateArgs(doc, { id })), { live: liveInBench })
for (const [label, url, cam] of BENCH_SCENES.slice(1)) await compare(`${label}, baked`, bakedOf(docOf(url), `od-${label}`), cam)
{
    const url = new URL('../../scenes/dusty-beam.json', import.meta.url), doc = docOf(url)
    await compare('Dusty beam (a haze box)', generate(...M.generateArgs(doc, { id: 'od-dusty' })), doc.view.camera)
}
await compare('glowing panels by hand, the sun low', panels('od-panels-pic'), { azimuth: -60, elevation: 55, distance: 4, target: [0, 0, 0.5], fov: 45 },
    { uSunElevation: 15 }, true)

say(`  ${((Date.now() - t0) / 1000).toFixed(0)} s`)
console.log(`distance-only shadow rays on the GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
