//======================================================================================================================
// ANSWERS ALONG THE RAY (0.next; the user, 2026-10-26: "exact (no stepping) intersection solutions for basic shapes ...
// possibly including relief (check if there is any intersection possible at all). It could improve rays traveling fairly
// parallel to surfaces"), the real build: codegen's `along`, the renderer's march and occlusion with `along`
// (lib/pathtracer/core/along.js; the developer setting alongRay). Run:
//   node builder/test/along.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU tests are: the `webgpu` package and a Vulkan driver (lavapipe), or it says
// so and passes.
//
// THE IDEA. Sphere tracing steps a ray by its distance to the nearest surface, and a ray running nearly parallel to a
// surface closes on it by about (1 - sin theta) a step: many steps, and at a graze it runs out of them (the prism scene's
// slit beam on the table, drawn only by the exact hits removed in 0.41.0: roadmap/ARCHITECTURE.md, Removed in 0.41.0). A
// closed-form shape can say instead how far along the ray its boundary first is -- entering or leaving -- and the ray may
// go that far at once. The step is the least of those answers and stepscale times every other fold's distance; the first
// crossing of any hard union is no nearer than the least first crossing of its shapes, so that is safe wherever no CSG,
// blend or warp bends the surface (codegen.js ANSWERS ALONG THE RAY).
//
// FIRST COUNTED, THEN BUILT. Until the build this file modelled the rule by rewriting codegen's text and asking the scene
// twice (the count, 3dd0b5d; its numbers in docs/PERFORMANCE.md STATUS 2026-10-26). It now runs the build itself, one
// evaluation a step: codegen's text with `along` and prog_march's `along`. Since the user's first run of Tests > alongray
// (every answer at every step: fewer steps, mostly more time), the nearest answering shape alone answers at a step, and a
// culled node's box answers where the ray enters it (along.js alNearer, alTake, alBoxEntry): the boxes are measured here
// as the page measures them, so they answer in every scene below.
//   1. THE TWINS: each answer (ALONG_WGSL) against its JS twin on the GPU, and the JS against a brute march of the shape's
//      own field.
//   2. THE RENDERER'S OWN MARCH, per bench scene (the bench's camera, 64 x 36 rays, codegen with measured boxes) and the
//      prism scene: camera rays, and shadow rays from where they end towards a sun at 50 and at 5 degrees (the march's
//      rule is the occlusion kernel's step), plain against answering -- steps a ray, how each ends (a hit, the sky, out of
//      steps). And in the prism scene rays lowered onto the table at 0.1 to 0.5 degrees: how many reach it within maxiter.
//      WHAT MUST HOLD: the text with answers, marched by a kernel that never sets AL_ON, the plain march bit for bit
//      (add_along is add_new there: every other kernel); no answered ray through a solid -- the plain field traced along
//      every stretch the answers skipped past a plain hit (skippedChecker); fewer steps in all; the bake with answers
//      marching as codegen's with answers; and no more rays ending inside a solid than plainly (fieldAt: an answer once
//      landed rays on the far side of the surface). What does go on past a plain hit is a graze: the plain march stops a
//      tolerance short of a surface, eps / sin(theta) along a ray at a shallow angle, where an answer lands near it.
//   3. THE WHOLE RENDERER (R.trace): a few samples of a scene as it is and with answers, from the same seeds -- shadow
//      rays through prog_occlude's `along` too -- the pictures' means within their paired error bar; a haze box among them.
//      Not bit for bit: an answer lands on a surface where the plain march stops a tolerance short of it.
// COUNTS, NOT TIMES (CLAUDE.md): what an answer costs beside a distance is the card's to say (Tests > alongray).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(answers along the ray GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

/* lavapipe reads it when the device is made, below: one thread, so the queues' order is the same every run */
process.env.LP_NUM_THREADS ??= '0'

const M = await import('../model.js')
const { generate, boxLoName, boxHiName } = await import('../codegen.js')
const { baked } = await import('../bake.js')
const { liveInBench } = await import('../../bench/bake.js')
const { cullBoxes, createBoxes, cullUniforms } = await import('../boxes.js')
const { prog_tagfield, tagSample, TAG_FIELD_WORDS } = await import('../../lib/pathtracer/core/field.js')
const { CAMERAS, BENCH_FILES, benchUrl } = await import('../../bench/index.js')
const { CAMERAS: SCALING_CAMERAS, SCALING_FILES } = await import('../../bench/scaling.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { prog_march, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../../lib/pathtracer/core/tracebasics.js')
const U = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')
const { ALONG_WGSL, JS, NEVER, NONE } = await import('../../lib/pathtracer/core/along.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(answers along the ray GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const say = console.log
const t0 = Date.now()

/* ...and each shape's own distance (sdf.js's), for the brute force: signed for the solids, |z| past a sheet */
const SDF = {
    plane: p => p[2],
    box: (p, b, r) => { const q = [0, 1, 2].map(k => Math.abs(p[k]) - (b[k] - r)); return Math.hypot(...q.map(v => Math.max(v, 0))) + Math.min(Math.max(...q), 0) - r },
    sphere: (p, r) => Math.hypot(...p) - r,
    cylinder: (p, h, r) => { const d = [Math.hypot(p[0], p[1]) - r, Math.abs(p[2]) - h]; return Math.min(Math.max(d[0], d[1]), 0) + Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0)) },
    band: (p, a) => Math.abs(p[2]) - a,
}

/*----------------------------------------------------------------------------------------------------------------------
  1. THE TWINS: each answer against its JS twin on the GPU, and the JS against a brute march of the shape's own field
----------------------------------------------------------------------------------------------------------------------*/
{
    let seed = 12345
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const dirOf = () => { const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z); return [s * Math.cos(a), s * Math.sin(a), z] }
    // shapes: [name, wgsl call, js answer, js field (null for the sheet), the field's own kind]
    const B = [0.7, 0.4, 0.5], RR = 0.15
    const shapes = [
        ['plane', 'Aplane(p, d)', (p, d) => JS.plane(p, d), p => SDF.plane(p)],
        ['sharp box', `AboxRounded(p, d, VEC3(${B}), 0.0)`, (p, d) => JS.box(p, d, B, 0), p => SDF.box(p, B, 0)],
        ['rounded box', `AboxRounded(p, d, VEC3(${B}), ${RR})`, (p, d) => JS.box(p, d, B, RR), p => SDF.box(p, B, RR)],
        ['sphere', 'Asphere(p, d, 0.6)', (p, d) => JS.sphere(p, d, 0.6), p => SDF.sphere(p, 0.6)],
        ['cylinder', 'Acylinder(p, d, 0.5, 0.4)', (p, d) => JS.cylinder(p, d, 0.5, 0.4), p => SDF.cylinder(p, 0.5, 0.4)],
        ['rectangle', 'Arectangle(p, d, VEC2(0.6, 0.3))', (p, d) => JS.rectangle(p, d, [0.6, 0.3]), null],
        ['plane band', 'AplaneBand(p, d, 0.05)', (p, d) => JS.band(p, d, 0.05), p => SDF.band(p, 0.05)],
        /* a culling box, off centre -- asked only from outside it (codegen.js culled: a node is skipped only while its box is
           farther than the margin), so the rays from inside are not its to answer */
        ['culling box', 'alBoxEntry(p, d, vec4<f32>(-0.4, -0.1, -0.3, 1.0), vec4<f32>(0.6, 0.5, 0.2, 1.0))',
         (p, d) => JS.boxEntry(p, d, [-0.4, -0.1, -0.3], [0.6, 0.5, 0.2]), p => SDF.box(p.map((v, k) => v - [0.1, 0.2, -0.05][k]), [0.5, 0.3, 0.25], 0), true],
    ]
    const N = 1500, rays = []
    for (let i = 0; i < N; i++) {
        // half the rays aimed near the shape (most meet it), half anywhere; a tenth nearly parallel to z = 0
        const p = [0, 1, 2].map(() => 3 * (2 * rnd() - 1))
        let d = i % 2 ? dirOf() : (() => { const q = [0, 1, 2].map(() => 0.5 * (2 * rnd() - 1)); const v = q.map((x, k) => x - p[k]); const l = Math.hypot(...v); return v.map(x => x / l) })()
        if (i % 10 === 3) { d[2] = (2 * rnd() - 1) * 0.01; const l = Math.hypot(...d); d = d.map(x => x / l) }
        rays.push([p, d])
    }
    const inB = new Float32Array(8 * N)
    rays.forEach(([p, d], i) => { inB.set(p, 8 * i); inB.set(d, 8 * i + 4) })
    for (const [name, call, js, field, outsideOnly] of shapes) {
        const prog = await WG.makeCompute(`${ALONG_WGSL}`, `
            let i = gid.x;
            if (i >= arrayLength(&tOut)) { return; }
            let p = rIn[2u * i].xyz; let d = rIn[2u * i + 1u].xyz;
            tOut[i] = ${call};`, {}, { rIn: 'array<vec4<f32>>', tOut: 'array<f32>' }, { async: false, wg: [64, 1, 1] })
        await prog.ready
        const a = WG.createStorageBuffer(inB), b = WG.createStorageBuffer(4 * N)
        prog.resources = { rIn: a.b, tOut: b.b }
        prog.dispatch(Math.ceil(N / 64), 1, 1)
        const g = await b.r(4 * N, 0, Float32Array)
        a.b.destroy(); b.b.destroy()
        let twinBad = 0, past = 0, early = 0, met = 0, never = 0, none = 0
        rays.forEach(([p0, d0], i) => {
            // the ray as the GPU had it (f32), so both sides answer the same question
            const p = Array.from(inB.subarray(8 * i, 8 * i + 3)), d = Array.from(inB.subarray(8 * i + 4, 8 * i + 7))
            const t = js(p, d), tg = g[i]
            const same = t === NEVER ? tg >= 1e29 : t === NONE ? tg === -1 : Math.abs(tg - t) <= 1e-4 * Math.max(1, t)
            if (!same) twinBad++
            if (t === NONE) { none++; return }
            if (outsideOnly && field(p) <= 0) { none++; return }
            // THE BRUTE FORCE: the field along the ray in steps of 2e-3 to 8 (every crossing is nearer), its first change of sign
            // (a sheet: of z within it)
            const dt = 2e-3
            let tTrue = NEVER, prev = null
            for (let s = 0; s <= 8; s += dt) {
                const q = [0, 1, 2].map(k => p[k] + s * d[k])
                const v = field ? field(q) : (Math.abs(q[0]) <= 0.6 && Math.abs(q[1]) <= 0.3 ? q[2] : null)
                if (v !== null && prev !== null && Math.sign(v) !== Math.sign(prev) && s > 0) { tTrue = s; break }
                prev = v
            }
            if (t >= NEVER) { never++; if (tTrue < NEVER && tTrue < 7.9) past++; return }
            met++
            if (t > tTrue + 2 * dt) past++                    // the answer beyond the true first crossing: unsafe
            else if (name !== 'rounded box' && tTrue < NEVER && t < tTrue - 2 * dt) early++
        })
        say(`  ${name}: ${met} met, ${never} never, ${none} no answer; ${past} past the field's first crossing, ${early} short of it, ${twinBad} unlike the JS twin`)
        ok(`the answer for a ${name}: the WGSL its JS twin's`, twinBad === 0, `${twinBad} of ${N}`)
        // a graze within the brute march's step can flip either way: allow a few in ten thousand
        ok(`...never beyond the shape's first crossing by the brute march (a safe step)`, past <= Math.ceil(N * 5e-4), `${past} of ${N}`)
        if (name !== 'rounded box') ok(`...and exactly it (within the brute march's step), not short of it`, early <= Math.ceil(N * 5e-4), `${early} of ${N}`)
    }
}

/*----------------------------------------------------------------------------------------------------------------------
  2. THE MARCHES: the renderer's own (distance only), plain, and codegen's text with answers -- read and not -- along the same rays
----------------------------------------------------------------------------------------------------------------------*/
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
const cullOf = (doc, S, B) => {
    const cull = {}
    for (const [id, b] of cullBoxes(doc, B)) { if (!(boxLoName(id) in (S.uniforms || {}))) continue; const { lo, hi } = cullUniforms(b); cull[boxLoName(id)] = lo; cull[boxHiName(id)] = hi }
    return cull
}
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
/* every ray to its end through the renderer's march: { pos (scene units), steps, state } -- a ray still marching after
   the passes: state -1 */
async function marchAll(prog, bag, rays0, buffers, passes = 40) {
    const n = rays0.length / RAY_F, u = bag.sceneUnit, rays = inMetres(rays0, u)
    const mb0 = WG.createStorageBuffer(rays), mb1 = WG.createStorageBuffer(rays.byteLength)
    const shade = WG.createStorageBuffer(HIT_F * 4 * n), counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    prog.resources = { marchBuffer0: mb0.b, marchBuffer1: mb1.b, shadeBuffer: shade.b, counters: counters.b, ...buffers }
    let inCount = n, readfrom = 0, shaded = 0
    for (let p = 0; p < passes && inCount > 0; p++) {
        counters.w(counterWords({ [readfrom]: inCount, 2: shaded, 3: readfrom }))
        prog.uniforms = { ...bag, lastpass: 0 }
        prog.dispatch(Math.ceil(inCount / 64), 1, 1)
        const c = await counters.r(Uint32Array)
        shaded = c[2]; inCount = readfrom === 0 ? c[1] : c[0]; readfrom = 1 - readfrom
    }
    const h = await shade.r(Float32Array), hu = new Uint32Array(h.buffer)
    const out = Array.from({ length: n }, () => ({ pos: null, steps: 0, state: -1 }))
    for (let k = 0; k < shaded; k++) {
        const o = HIT_F * k
        out[hu[o + 20]] = { pos: [h[o] / u, h[o + 1] / u, h[o + 2] / u], steps: hu[o + 15] & 0xffff, state: hu[o + 19] }
    }
    for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
    return out
}
const HIT = 0, SKY = 2, OUT = 4
/* how the answered march's ends compare with the plain one's, ray by ray */
function compare(origins, plain, along, tol) {
    const c = { n: plain.length, sameEnd: 0, reached: 0, passed: 0, other: 0, stepsP: 0, stepsA: 0, outP: 0, outA: 0, skyP: 0, skyA: 0 }
    const tOf = (h, i) => h.pos ? Math.hypot(...h.pos.map((v, k) => v - origins[3 * i + k])) : Infinity
    plain.forEach((p, i) => {
        const a = along[i]
        c.stepsP += p.steps; c.stepsA += a.steps
        if (p.state === OUT || p.state === -1) c.outP++
        if (a.state === OUT || a.state === -1) c.outA++
        if (p.state === SKY) c.skyP++
        if (a.state === SKY) c.skyA++
        const pHit = p.state === HIT, aHit = a.state === HIT
        if (pHit && aHit && Math.abs(tOf(p, i) - tOf(a, i)) <= 4 * tol) c.sameEnd++
        else if (!pHit && p.state !== SKY && aHit) c.reached++               // plain ran out; the answers reached a surface
        else if (pHit && (!aHit || tOf(a, i) > tOf(p, i) + 4 * tol)) c.passed++   // a surface plain met, the answers went on
        else if (p.state === a.state && !pHit) c.sameEnd++
        else c.other++
    })
    return c
}
const pct = (a, n) => `${(100 * a / Math.max(n, 1)).toFixed(1)}%`
const fmt = c => `steps a ray ${(c.stepsP / c.n).toFixed(1)} -> ${(c.stepsA / c.n).toFixed(1)}; out of steps ${c.outP} -> ${c.outA}; sky ${c.skyP} -> ${c.skyA}; same end ${pct(c.sameEnd, c.n)}, reached ${c.reached}, passed ${c.passed}, other ${c.other}`

/* THE STRETCH THE ANSWERS SKIPPED, CHECKED: where the plain march hit and the answers went on, the plain scene's own field
   (SDF, every shape, no culling) traced along the ray from the plain hit to where the answers ended -- by half the
   distance, never under a quarter of the tolerance, so a thin plate is not stepped over. Inside a solid by more than two
   tolerances anywhere there: the answers passed through it. Else a graze: the plain march stops a tolerance short of a
   surface, eps / sin(theta) along a grazing ray, where an answer lands on it -- or brushes an edge an answer passes. */
async function skippedChecker(S) {
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${U.sceneConstantsWGSL(S)}${S.wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&segOut)) { return; }
        let o = segIn[2u * i].xyz; let t1 = segIn[2u * i].w;
        let d = segIn[2u * i + 1u].xyz; let tol = segIn[2u * i + 1u].w;
        var t = 0.0; var least = 1.0e30; var n = 0u;
        loop {
            if (t > t1 || n >= 200000u) { break; }
            let h = SDF(newRay(o + t * d, d, VEC4(1.0), 1.5));
            least = min(least, h.s.w);
            if (h.s.w < -2.0 * tol) { break; }
            t = t + max(0.5 * abs(h.s.w), 0.25 * tol);
            n = n + 1u;
        }
        segOut[i] = vec2<f32>(least, select(0.0, 1.0, t > t1));`,
        U.computeUniformTypes(S.uniforms), { segIn: 'array<vec4<f32>>', segOut: 'array<vec2<f32>>', ...(S.resources || {}) }, { async: false, wg: [64, 1, 1] })
    await prog.ready
    const bag = { ...uniformBag(S), res: [64, 64] }
    return async segs => {                    // [o (3), length, dir (3), tol] each; resolves to [least distance, finished]
        if (!segs.length) return []
        const n = segs.length / 8, inB = WG.createStorageBuffer(new Float32Array(segs)), outB = WG.createStorageBuffer(8 * Math.max(n, 4))
        prog.resources = { segIn: inB.b, segOut: outB.b }
        prog.uniforms = bag
        prog.dispatch(Math.ceil(n / 64), 1, 1)
        const out = await outB.r(8 * n, 0, Float32Array)
        inB.b.destroy(); outB.b.destroy()
        return Array.from({ length: n }, (_, k) => [out[2 * k], out[2 * k + 1]])
    }
}

/* THE FULL FIELD WHERE A RAY ENDED (SDF, every shape): a hit the march calls one is under the tolerance, and the plain march
   stops while still outside. An answer once ended a ray on the far side of the surface where f32 put it -- inside the
   solid, 69 of 1576 camera rays' hits on the material test, 142 of 752 on the showcase -- and the whole picture read a few
   percent dark (wavefront.js ALONG_STEP_WGSL: half the tolerance short since). */
async function fieldAt(S) {
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${U.sceneConstantsWGSL(S)}${S.wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&dOut)) { return; }
        dOut[i] = SDF(newRay(pIn[i].xyz, VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.5)).s.w;`,
        U.computeUniformTypes(S.uniforms), { pIn: 'array<vec4<f32>>', dOut: 'array<f32>', ...(S.resources || {}) }, { async: false, wg: [64, 1, 1] })
    await prog.ready
    const bag = { ...uniformBag(S), res: [64, 64] }
    return async hits => {              // the hits' places, scene units; resolves to the field there (NaN for no hit)
        const n = Math.max(hits.length, 1), inB = new Float32Array(4 * n)
        hits.forEach((h, i) => inB.set(h.pos ?? [0, 0, 0], 4 * i))
        const A = WG.createStorageBuffer(inB), O = WG.createStorageBuffer(4 * Math.max(n, 4))
        prog.resources = { pIn: A.b, dOut: O.b }
        prog.uniforms = bag
        prog.dispatch(Math.ceil(n / 64), 1, 1)
        const o = await O.r(4 * n, 0, Float32Array)
        A.b.destroy(); O.b.destroy()
        return hits.map((h, i) => h.state === HIT ? o[i] : NaN)
    }
}

const SUN = elev => { const e = elev * Math.PI / 180, a = 30 * Math.PI / 180; return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)] }
const TOTALS = []
async function count(label, doc, cam, extraRays = null) {
    const id = `al-${label.replace(/\W+/g, '')}`
    const S = generate(...M.generateArgs(doc, { id })), SA = generate(...M.generateArgs(doc, { id, along: true }))
    const answered = (SA.wgsl.match(/alTake\(A(?!planeBand)\w+\(/g) || []).length, reliefs = (SA.wgsl.match(/alTake\(AplaneBand\(/g) || []).length
    const boxes = (SA.wgsl.match(/alTake\(alBoxEntry\(/g) || []).length
    ok(`${label}: codegen with \`along\` says so exactly when a shape or a box answers, its uniforms the plain text's`, !S.along && !!SA.along === answered + reliefs + boxes > 0
        && JSON.stringify(Object.keys(SA.uniforms)) === JSON.stringify(Object.keys(S.uniforms)) && SA.pickWgsl === S.pickWgsl)
    const B = await measure(doc, S)
    const bag = { ...uniformBag(S), ...cullOf(doc, S, B), res: [64, 64], seed: [1, 2, 3, 4] }
    const buffers = {}
    /* plain; with answers, the renderer's build of it (wavefront.js `along`); and the same text by a march that never sets
       AL_ON, as every other kernel compiles it -- add_along is add_new there */
    const Kp = await prog_march(WG, S, 64, { distOnly: 1 })
    const Ka = SA.along ? await prog_march(WG, SA, 64, { distOnly: 1, along: 1 }) : Kp
    const Ko = await prog_march(WG, SA, 64, { distOnly: 1 })
    // ...and the bake with answers, the build the page shows once the edits stop, against codegen's with them
    const SB = baked(SA, { live: liveInBench })
    const Kb = SA.along ? await prog_march(WG, SB, 64, { distOnly: 1, along: 1 }) : null
    for (const k of [Kp, Ka, Ko, Kb]) if (k) await k.ready
    const bagB = { ...uniformBag(SB), ...cullOf(doc, S, B), res: [64, 64], seed: [1, 2, 3, 4] }
    const tol = Math.max((bag.eps > 0 ? bag.eps : bag.epsAuto) / (bag.sceneUnit || 1), 1e-7)
    const check = await skippedChecker(S), field = await fieldAt(S)
    const run = async (pts, dirs) => {
        const rays = raysOf(pts, dirs)
        const [p, a, o] = [await marchAll(Kp, bag, rays, buffers), await marchAll(Ka, bag, rays, buffers), await marchAll(Ko, bag, rays, buffers)]
        // THE SAFETY CHECK: the text with answers, never read, is the plain march's -- AL_ON false, add_along is add_new
        const fewer = o.filter((h, i) => h.steps < p[i].steps && p[i].state !== -1).length
        const offDiffer = o.filter((h, i) => h.steps !== p[i].steps || h.state !== p[i].state || String(h.pos) !== String(p[i].pos)).length
        // THE BAKE: every ray ending as codegen's with answers, but a share the march's tolerance decides (bake.gpu.mjs)
        let bakeOff = 0
        if (Kb) {
            const b = await marchAll(Kb, bagB, rays, buffers)
            bakeOff = b.filter((h, i) => h.state !== a[i].state || (h.state === HIT && Math.hypot(...h.pos.map((v, k) => v - a[i].pos[k])) > 10 * tol)).length
        }
        // the rays the answers took past a surface the plain march hit: a few, to read
        const tOf = (h, i) => h.pos ? Math.hypot(...h.pos.map((v, k) => v - pts[3 * i + k])) : Infinity
        const passed = []
        p.forEach((h, i) => { if (h.state === HIT && (a[i].state !== HIT || tOf(a[i], i) > tOf(h, i) + 4 * tol) && passed.length < 3)
            passed.push(`ray ${i} from [${pts.slice(3 * i, 3 * i + 3).map(v => v.toFixed(3))}] dir [${dirs.slice(3 * i, 3 * i + 3).map(v => v.toFixed(4))}]: plain hit at t ${tOf(h, i).toFixed(4)} [${h.pos.map(v => v.toFixed(4))}], answers ${a[i].state === HIT ? 'hit' : a[i].state === SKY ? 'sky' : 'out'} at t ${tOf(a[i], i).toFixed(4)}`) })
        // every ray the answers took past the plain hit: its skipped stretch through the plain field
        const segs = [], which = []
        p.forEach((h, i) => {
            if (h.state !== HIT || (a[i].state === HIT && tOf(a[i], i) <= tOf(h, i) + 4 * tol)) return
            const t0 = tOf(h, i), t1 = a[i].pos ? tOf(a[i], i) - t0 : 0
            if (!(t1 > 0)) return
            segs.push(...h.pos, t1, ...dirs.slice(3 * i, 3 * i + 3), tol); which.push(i)
        })
        const got = await check(segs)
        const tunnelled = got.filter(([least]) => least < -2 * tol).length, unfinished = got.filter(([least, done]) => least >= -2 * tol && !done).length
        // where the hits end: inside a solid (the field below 0), plainly and with answers
        const insideOf = async r => (await field(r)).filter(d => d < 0).length
        const insideP = await insideOf(p), insideA = await insideOf(a)
        return { c: compare(pts, p, a, tol), fewer, offDiffer, bakeOff, passed, p, skipped: got.length, tunnelled, unfinished, insideP, insideA }
    }
    const { pts, dirs } = cameraRays(cam, 64, 36)
    const cam1 = await run(pts, dirs)
    say(`  ${label}: ${answered} shapes answering, ${reliefs} a relief's band, ${boxes} culling boxes; camera rays: ${fmt(cam1.c)}`)
    const skipped = r => `${r.skipped} went on past the plain hit: ${r.skipped - r.tunnelled - r.unfinished} grazes, ${r.tunnelled} through a solid${r.unfinished ? `, ${r.unfinished} not finished checking` : ''}`
    say(`    ${skipped(cam1)}`)
    ok(`${label}: the text with answers, never read (AL_ON false), every camera ray the plain march's bit for bit`, cam1.offDiffer === 0, `${cam1.offDiffer} rays differ, ${cam1.fewer} in fewer steps`)
    if (Kb) ok(`${label}: ...baked with answers, every camera ray ending as codegen's with them, but a share the tolerance decides`, cam1.bakeOff <= 0.005 * cam1.c.n, `${cam1.bakeOff} of ${cam1.c.n}`)
    if (SA.along) ok(`${label}: ...camera rays in fewer steps in all with answers`, cam1.c.stepsA <= cam1.c.stepsP, `${cam1.c.stepsA} against ${cam1.c.stepsP}`)
    ok(`${label}: ...no more camera rays ending inside a solid with answers than without (${cam1.insideP})`, cam1.insideA <= cam1.insideP, `${cam1.insideA} against ${cam1.insideP}`)
    ok(`${label}: ...no camera ray with answers through a solid`, cam1.tunnelled === 0, `${cam1.tunnelled}: ${cam1.passed.join('; ')}`)
    const row = { label, answered, cam: cam1.c }
    // SHADOW RAYS from where the camera rays hit, backed off along them, towards a sun at 50 and at 5 degrees
    const hitPts = [], back = 10 * tol
    cam1.p.forEach((h, i) => { if (h.state !== HIT) return; hitPts.push(h.pos.map((v, k) => v - dirs[3 * i + k] * 2 * back)) })
    for (const elev of [50, 5]) {
        const sd = SUN(elev), sp = hitPts.flat(), sdirs = hitPts.flatMap(() => sd)
        const sh = await run(sp, sdirs)
        say(`    shadow rays to a sun at ${elev} degrees (${hitPts.length}): ${fmt(sh.c)}`)
        say(`      ${skipped(sh)}`)
        ok(`${label}: ...shadow rays at ${elev} degrees: the text with answers, never read, the plain march's bit for bit`, sh.offDiffer === 0, `${sh.offDiffer} differ, ${sh.fewer} in fewer steps`)
        if (SA.along) ok(`${label}: ...in fewer steps in all with answers`, sh.c.stepsA <= sh.c.stepsP, `${sh.c.stepsA} against ${sh.c.stepsP}`)
        if (Kb) ok(`${label}: ...and baked as codegen's`, sh.bakeOff <= 0.005 * sh.c.n, `${sh.bakeOff} of ${sh.c.n}`)
        ok(`${label}: ...none more ending inside a solid with answers (${sh.insideP} without)`, sh.insideA <= sh.insideP, `${sh.insideA} against ${sh.insideP}`)
        ok(`${label}: ...and none with answers through a solid`, sh.tunnelled === 0, `${sh.tunnelled}: ${sh.passed.join('; ')}`)
        row[`sun${elev}`] = sh.c
    }
    if (extraRays) {
        for (const [name, pts2, dirs2] of extraRays) {
            const x = await run(pts2, dirs2)
            say(`    ${name} (${pts2.length / 3}): ${fmt(x.c)}`)
            say(`      ${skipped(x)}`)
            ok(`${label}: ...${name}: none with answers through a solid`, x.tunnelled === 0, `${x.tunnelled}`)
            ok(`${label}: ...${name}: none more ending inside a solid with answers (${x.insideP} without)`, x.insideA <= x.insideP, `${x.insideA} against ${x.insideP}`)
            row[name] = x.c
        }
    }
    TOTALS.push(row)
}

const docOf = url => M.parse(readFileSync(fileURLToPath(url), 'utf8'))
const SCENES = [
    ['the optics bench', benchUrl(SCALING_FILES.bench), SCALING_CAMERAS.bench],
    ['the Noise library', benchUrl(BENCH_FILES.noise), CAMERAS.noise],
    ['the showcase', benchUrl(BENCH_FILES.showcase), CAMERAS.showcase],
    ['the demo', benchUrl(BENCH_FILES.demo), CAMERAS.demo],
    ['the Menger cubes', benchUrl(BENCH_FILES.Menger_cubes), CAMERAS.Menger_cubes],
    ['the material test', benchUrl(BENCH_FILES.materials), CAMERAS.materials],
    ['dichroics', benchUrl(BENCH_FILES.dichroics), CAMERAS.dichroics],
]
for (const [label, url, cam] of SCENES) await count(label, docOf(url), cam)
{
    /* THE PRISM SCENE (scenes/prism-dispersion.json), and rays lowered onto its table (the plane z = -15 mm) at 0.1 to 0.5
       degrees, each meeting it 40 to 120 mm ahead, heading away from the prism -- the slit beam's graze, the march alone */
    const url = new URL('../../scenes/prism-dispersion.json', import.meta.url), doc = docOf(url)
    const pts = [], dirs = []
    for (const deg of [0.1, 0.2, 0.3, 0.4, 0.5]) for (let k = 0; k < 64; k++) {
        const L = 40 + 80 * k / 63, th = deg * Math.PI / 180
        pts.push(-70, -20 + 0.1 * k, -15 + L * Math.tan(th)); dirs.push(...unit([-Math.cos(th), 0, -Math.sin(th)]))
    }
    await count('the prism scene', doc, doc.view.camera, [['rays grazing the table, 0.1 to 0.5 degrees', pts, dirs]])
    const g = TOTALS.at(-1)['rays grazing the table, 0.1 to 0.5 degrees']
    say(`    the graze: ${g.n - g.outP} of ${g.n} reach the table plainly within maxiter, ${g.n - g.outA} with the answers`)
    ok('the prism scene: every ray grazing its table reaches it with answers', g.outA === 0, `${g.outA} of ${g.n} out of steps`)
}

/*----------------------------------------------------------------------------------------------------------------------
  3. THE WHOLE RENDERER: a scene as it is and with answers, from the same seeds -- the march and the shadow rays both
----------------------------------------------------------------------------------------------------------------------*/
const { RAYTRACER } = await import('../../lib/pathtracer/core/raytrace_main.js')
const { CAMERA } = await import('../../lib/camera.js')
const { engineCamera } = await import('../../lib/pathtracer/core/units.js')
const { effective } = await import('../../lib/pathtracer/quality.js')
const { LUMA } = await import('../../lib/pathtracer/core/photometry.js')
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
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }
const W = 32, H = 24, SAMPLES = 4
const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
const bagFor = (scene, cam, { cull = {}, ...over } = {}) => {
    const v = { ...U.defaultUniformValues(), envMode: 0, uSunElevation: 50, uSunAzimuth: 30, sunDiameter: 0.53, sunIlluminance: 100000,
                skyIlluminance: 20000, nee: 1, lt: 1, ltPhotons: 1, ltLearn: 0, maxbounce: 8, rr: 0, fireflyClamp: 0,
                maxaverages: 0, autoExposure: 0, sppm: 0, ...over }
    const traced = effective(v)
    const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius, haze: scene.haze })
    const EC = engineCamera({ ...cam.getUniforms(), camLens: [0, 1, 0, 0] }, 0, derived.sceneUnit)
    return Object.fromEntries(Object.entries({ ...sceneValues(scene),
        ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
        ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0, ...cull })
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
    const texts = { march: R.prog_wvfmarch.wgsl, occlude: R.prog_wvfocclude.wgsl }
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
    return { err, texts, img: Array.from({ length: W * H }, (_, i) => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]) }
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
async function whole(label, doc, orbit, over = {}) {
    const id = `alw-${label.replace(/\W+/g, '')}`
    const off = baked(generate(...M.generateArgs(doc, { id })), { live: liveInBench })
    const on = baked(generate(...M.generateArgs(doc, { id, along: true })), { live: liveInBench })
    const cam = camOf(orbit, W / H)
    const a = await picture(off, cam, over, 7), b = await picture(on, cam, over, 7)
    // the march and the shadow rays built to read the answers: their resets in the kernels' text, and only there
    const reads = t => /AL_ON = true;/.test(t)
    ok(`${label}: both pictures traced, the march and the shadow rays reading answers only with them`, !a.err && !b.err && on.along
        && reads(b.texts.march) && reads(b.texts.occlude) && !reads(a.texts.march) && !reads(a.texts.occlude), `${a.err ?? ''} ${b.err ?? ''}`)
    if (a.err || b.err) return
    const p = paired(b.img, a.img), lit = a.img.filter(x => x > 0).length
    say(`  ${label}: ${lit} of ${W * H} lit; mean with answers / without ${p.mean.toFixed(5)} +- ${p.se.toFixed(5)}`)
    ok(`${label}: a picture to compare -- most pixels lit`, lit > W * H / 2, `${lit} of ${W * H}`)
    ok(`${label}: the picture's mean with answers within its paired error bar of the one without`, Math.abs(p.mean - 1) <= Math.max(3.5 * p.se, 1e-6), `${p.mean} +- ${p.se}`)
}
await whole('the material test, baked', docOf(benchUrl(BENCH_FILES.materials)), CAMERAS.materials)
await whole('the material test, baked, the sun at 5 degrees', docOf(benchUrl(BENCH_FILES.materials)), CAMERAS.materials, { uSunElevation: 5 })
await whole('the showcase, baked', docOf(benchUrl(BENCH_FILES.showcase)), CAMERAS.showcase)
await whole('dichroics, baked', docOf(benchUrl(BENCH_FILES.dichroics)), CAMERAS.dichroics)
{
    const doc = docOf(new URL('../../scenes/dusty-beam.json', import.meta.url))
    ok('Dusty beam has a haze box (answers with the haze are checked on it)', !!generate(...M.generateArgs(doc, { id: 'alw-dusty-h' })).haze)
    await whole('Dusty beam (a haze box), baked', doc, doc.view.camera)
}

say(`  ${((Date.now() - t0) / 1000).toFixed(0)} s`)
console.log(`answers along the ray on the GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
