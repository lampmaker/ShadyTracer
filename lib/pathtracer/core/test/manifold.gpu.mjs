//======================================================================================================================
// THE MANIFOLD CONNECTION'S WALK ON A REAL WEBGPU in node. Run: node lib/pathtracer/core/test/manifold.gpu.mjs
//
// What 0.44.0 put in the surface kernel (core/manifold.js MANIFOLD_WGSL), compiled by Dawn (Tint) and stepped exactly as
// prog_surface steps it -- mfBegin, then mfLook and mfTake a trip at a time, one look at the scene each -- over the same
// two glasses test/manifold.test.mjs measures (a slab, a dome over a floor), their distance fields written in WGSL here.
// Against the JS mirror (manifoldSolve), point for point: whether a path is found, the camera ray's direction, the
// point on the face, the glass leg, the transmittance and the Jacobian; and mfAnswer's pixel and weight against
// manifoldWeight and the pinhole's picture. A path the mirror refuses must be refused here too, and the walk must end
// within its trips. Then the two kernels it lives in:
//   - THE SURFACE KERNEL ITSELF (wavefront.js prog_surface) on a builder scene -- a glass box standing in a floor, its
//     distance mirrored in JS -- its hits made by the engine's own march from photons inside the glass: the answer it
//     leaves beside each hit (Surface.mf) against the mirror's, and nothing where its gates say no -- the setting off,
//     a photon with no delta before, one in air, the last pass, Draft, the illuminance view, an orthographic camera --
//     and with an aperture, a point of the lens: answers, on other pixels;
//   - SHADE'S HALF (materials_pbr.js mfConnect, through tracebasics.js pathMiddle): the connection queued with the
//     answer's pixel and flux f exp(-mu d) w, f the BSDF towards the face, ending before it marches; none where the
//     gates say no.
//
// OPTIONAL, AND LOUD ABOUT IT: the `webgpu` package (npm i -g webgpu) and a Vulkan driver (lavapipe).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(manifold GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { DEFINITIONS } = await import('../tracebasics.js')
const { LENS_WGSL } = await import('../lens.js')
const { MANIFOLD_WGSL, MANIFOLD_SHARED_WGSL, MANIFOLD_TRIPS, manifoldSolve, manifoldWeight } = await import('../manifold.js')
const { ComputeUniformTypes } = await import('../uniforms.schema.js')
const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(manifold GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(99)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l) }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// the scenes, as manifold.test.mjs has them
const SLAB_H = 0.08, RD = 0.11, N_GLASS = 1.5, TOL = 2e-5
const SCENES = [
    { name: 'slab', js: p => { const g = Math.max(-p[2], p[2] - SLAB_H), f = p[2]; return Math.abs(g) < Math.abs(f) ? g : f },
      wgsl: `let g = max(-p.z, p.z - ${SLAB_H}); let f = p.z; return select(f, g, abs(g) < abs(f));`,
      d: () => [(rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3, 0] },
    { name: 'dome', js: p => { const g = Math.max(Math.hypot(...p) - RD, -p[2]), f = p[2]; return Math.abs(g) < Math.abs(f) ? g : f },
      wgsl: `let g = max(length(p) - ${RD}, -p.z); let f = p.z; return select(f, g, abs(g) < abs(f));`,
      d: () => { const r = RD * Math.sqrt(rng()), a = 2 * Math.PI * rng(); return [r * Math.cos(a), r * Math.sin(a), 0] } },
]
// the camera: a pinhole at Y looking at the origin, 64 x 64, 30 degrees -- as a camera.js would hand it (columns)
const Y = [0.17, 0.06, 0.55], RES = 64, tf = Math.tan(15 * Math.PI / 180)
const fwd = norm(Y), right = norm(cross([0, 0, 1], fwd)), up = cross(fwd, right)
const invView = [...right, 0, ...up, 0, ...fwd, 0, ...Y, 1]
const invProjection = [tf, 0, 0, 0, 0, tf, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
const apx = 4 * tf * tf / (RES * RES)

const N = 512
const OUT = 20
// an angle between two directions, by the cross product in f64: acos of a dot near 1 cannot see below 0.4 mrad in f32
const angle = (a, b) => { const u = norm(a), v = norm(b); return Math.asin(Math.min(1, Math.hypot(...cross(u, v)))) }
for (const S of SCENES) {
    const Ds = Array.from({ length: N }, S.d)
    const io = new Float32Array(N * (4 + OUT))
    Ds.forEach((D, i) => io.set(D, 4 * i))
    const prog = WG.makeCompute(`${DEFINITIONS}${LENS_WGSL}${MANIFOLD_SHARED_WGSL}${MANIFOLD_WGSL}
fn sdfTest(p: vec3<f32>) -> f32 { ${S.wgsl} }
`, /*wgsl*/`
    let i = gid.x;
    if (i >= ${N}u) { return; }
    let D = vec3<f32>(io[4u * i], io[4u * i + 1u], io[4u * i + 2u]);
    mfBegin(UB.camPos.xyz, D, vec3<f32>(0.0, 0.0, 1.0), ${N_GLASS}, ${TOL});
    var trips = 0u;
    // as prog_surface's loop: one look a trip
    for (var k = 0u; k < MF_TRIPS + 2u; k++) {
        let lk = mfLook();
        var d = 0.0;
        if (lk.w > 0.5) { d = sdfTest(lk.xyz); }
        mfTake(d, lk.w > 0.5);
        trips = k + 1u;
        if (MF.phase == MF_OK || MF.phase == MF_FAIL) { break; }
    }
    let a = mfAnswer(vec3<f32>(0.0));
    let o = ${4 * N}u + ${OUT}u * i;
    io[o] = select(0.0, 1.0, MF.phase == MF_OK);
    io[o + 1u] = MF.w.x; io[o + 2u] = MF.w.y; io[o + 3u] = MF.w.z;
    io[o + 4u] = MF.cq.x; io[o + 5u] = MF.cq.y; io[o + 6u] = MF.cq.z;
    io[o + 7u] = MF.detj; io[o + 8u] = MF.tr;
    io[o + 10u] = f32(trips); io[o + 11u] = f32(MF.it);
    io[o + 12u] = bitcast<f32>(a.x); io[o + 13u] = bitcast<f32>(a.y);
    let toX = mfUnoct(unpack2x16snorm(a.z));
    io[o + 14u] = toX.x; io[o + 15u] = toX.y; io[o + 16u] = toX.z;
    io[o + 9u] = bitcast<f32>(a.w);
    `, ComputeUniformTypes, { io: 'array<f32>' }, { wg: [64, 1, 1], async: false })
    const buf = WG.createStorageBuffer(io.byteLength)
    buf.w(io)
    prog.resources = { io: buf.b }
    prog.uniforms = { res: [RES, RES], camtype: 0, camPos: [...Y, 1], invView, invProjection, camLens: [0, 1, 0, 0],
                      manifold: 1, measureMode: 0, renderMode: 0, lastpass: 0, maxbounce: 10 }
    prog.dispatch(N / 64, 1, 1)
    const g = await buf.r(Float32Array), gu = new Uint32Array(g.buffer)

    /* GRAZING EXITS APART: where the camera's ray meets the face more than 75 degrees off its normal (cos below 0.25) a
       dome's answer turns fast with the point, and f32 against f64 there differed by up to 10 % in the Jacobian
       (measured here: 4 of 353 dome paths beyond 1 %, all of them grazing, 78 to 86 degrees). The rest is held to 1 %. */
    const GRAZING = 0.25
    const W0 = () => ({ w: 0, x: 0, j: 0, t: 0, d: 0, weight: 0, dir: 0 })
    const worst = { fair: W0(), grazing: W0() }
    let both = 0, onlyJs = 0, onlyGpu = 0, maxTrips = 0, trips = 0, pixWrong = 0, grazed = 0
    const keep = (k, v) => { for (const s of [k]) worst[s.cls][s.key] = Math.max(worst[s.cls][s.key], v) }
    Ds.forEach((D, i) => {
        const o = 4 * N + OUT * i
        const js = manifoldSolve({ D, nD: [0, 0, 1], nMed: N_GLASS, y: Y, sdf: S.js, tol: TOL })
        const gpuOk = g[o] === 1
        maxTrips = Math.max(maxTrips, g[o + 10]); trips += g[o + 10] / N
        if (js && gpuOk) {
            both++
            const cls = -dot(js.w, js.nx) < GRAZING ? 'grazing' : 'fair'
            if (cls === 'grazing') grazed++
            keep({ cls, key: 'w' }, angle(js.w, [g[o + 1], g[o + 2], g[o + 3]]))
            keep({ cls, key: 'x' }, Math.hypot(js.x[0] - g[o + 4], js.x[1] - g[o + 5], js.x[2] - g[o + 6]))
            keep({ cls, key: 'j' }, Math.abs(g[o + 7] / js.detJ - 1))
            keep({ cls, key: 't' }, Math.abs(g[o + 8] / js.T - 1))
            // mfAnswer: the pinhole's pixel of the ray, and T / n^2 / (cos^3 |det J| A_px)
            const c = -dot(js.w, fwd), xy = [dot(js.w, right) / (c * tf), dot(js.w, up) / (c * tf)]
            if (Math.abs(xy[0]) < 0.98 && Math.abs(xy[1]) < 0.98) {
                const pix = Math.floor((xy[0] + 1) / 2 * RES) + RES * Math.floor((xy[1] + 1) / 2 * RES)
                if (gu[o + 12] !== pix) pixWrong++
                keep({ cls, key: 'weight' }, Math.abs(g[o + 13] / manifoldWeight(js, N_GLASS, c, apx) - 1))
                keep({ cls, key: 'dir' }, angle([g[o + 14], g[o + 15], g[o + 16]], js.toX))
                keep({ cls, key: 'd' }, Math.abs(g[o + 9] - js.dist))      // the answer's glass leg (zero off the picture)
            }
        } else if (js) onlyJs++
        else if (gpuOk) onlyGpu++
    })
    console.log(`  ${S.name}: ${both} found by both of ${N} (${grazed} grazing), ${onlyJs} by the mirror only, ${onlyGpu} by the GPU only; trips ${trips.toFixed(0)} on average, ${maxTrips} at most`)
    const f = worst.fair, z = worst.grazing
    // f32 against f64, a solve converged to a tolerance: a refusal on one side near its edge is allowed, rarely
    ok(`${S.name}: the walk finds what the mirror finds (all but 2 %)`, onlyJs + onlyGpu <= 0.02 * N && both > N / 2, `${onlyJs} + ${onlyGpu}`)
    ok(`${S.name}: the camera ray's direction within 0.1 mrad`, f.w < 1e-4, `${f.w}`)
    ok(`${S.name}: the point on the face within 0.1 mm`, f.x < 1e-4 && z.x < 1e-4, `${f.x} ${z.x}`)
    ok(`${S.name}: the Jacobian within 1 %`, f.j < 0.01, `${f.j}`)
    ok(`${S.name}: the transmittance within 0.5 %, the glass leg within 0.1 mm`, f.t < 0.005 && f.d < 1e-4 && z.d < 1e-4, `${f.t} ${f.d}`)
    ok(`${S.name}: mfAnswer's pixel the pinhole's`, pixWrong <= 2, `${pixWrong} elsewhere`)
    ok(`${S.name}: ...its weight manifoldWeight's within 1 %`, f.weight < 0.01, `${f.weight}`)
    /* the direction from D to the face: the two solutions' own difference in x (under 0.1 mm, a few centimetres off) and
       the 16-bit pair's rounding (3e-5 a step) */
    ok(`${S.name}: ...its direction towards the face through the octahedral pair within 0.5 mrad`, f.dir < 5e-4, `${f.dir}`)
    ok(`${S.name}: grazing exits: the weight within 12 %, the direction within 3 mrad`, z.weight < 0.12 && z.j < 0.12 && z.dir < 3e-3 && z.w < 3e-3,
        JSON.stringify(z))
    ok(`${S.name}: every walk ended within its trips`, maxTrips <= MANIFOLD_TRIPS + 2, `${maxTrips}`)
}

// ---- THE SURFACE KERNEL ON A BUILDER SCENE ------------------------------------------------------------------------
{
    const M = await import('../../../../builder/model.js')
    const { generate } = await import('../../../../builder/codegen.js')
    const { prog_march, prog_surface, counterWords, COUNTER_WORDS } = await import('../wavefront.js')
    const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../tracebasics.js')
    const { UniformSpec } = await import('../uniforms.schema.js')
    const { derive } = await import('../photometry.js')
    const { marchTolAt } = await import('../tolerances.js')
    console.warn = () => { }
    // a glass box (n 1.5) standing 2 cm deep in a floor whose top is z = 0: a photon inside it lands on the floor
    const doc = M.createDoc()
    const glass = M.addMaterial(doc, { preset: 'glass' }), white = M.addMaterial(doc, { preset: 'diffuse' })
    const GB = [0.15, 0.15, 0.05], GC = [0, 0, 0.03], FB = [1, 1, 0.05], FC = [0, 0, -0.05]
    const box = (id, mat, c, b) => M.addObject(doc, 'root', { id, primitive: 'box', material: mat.id,
        params: { size: { x: b[0], y: b[1], z: b[2] }, rounding: 0 }, transform: { pos: { x: c[0], y: c[1], z: c[2] }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    box('glassbox', glass, GC, GB); box('floor', white, FC, FB)
    const scene = generate(...M.generateArgs(doc, { id: 'manifold-gpu' }))
    const sdBox = (p, c, b) => { const q = [0, 1, 2].map(k => Math.abs(p[k] - c[k]) - b[k])
        return Math.hypot(...q.map(v => Math.max(v, 0))) + Math.min(Math.max(q[0], q[1], q[2]), 0) }
    const sceneJs = p => { const a = sdBox(p, GC, GB), b = sdBox(p, FC, FB); return Math.abs(a) < Math.abs(b) ? a : b }
    const EPS = 2e-5
    const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
    const bag0 = Object.fromEntries(Object.entries(UniformSpec).map(([k, sp]) => [k, sp.def]))
    bag0.eps = EPS
    const bag = { ...bag0, ...derive(bag0, { unit: 'm', extent: null, envRadius: null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) bag[k] = flat(u.def)
    Object.assign(bag, { res: [RES, RES], camtype: 0, camPos: [...Y, 1], invView, invProjection, camLens: [0, 1, 0, 0],
        measureMode: 0, renderMode: 0, lastpass: 0, maxbounce: 10, manifold: 1 })
    const [march, surface] = await Promise.all([prog_march(WG, scene, 64), prog_surface(WG, scene, 64)])
    await Promise.all([march.ready, surface.ready])
    // the photons: inside the glass, 5 cm up, heading down at a tilt -- the march takes them to the floor
    const RAY_F = RAY_BYTES / 4, HIT_F = SHADE_ITEM_BYTES / 4, NP = 256
    const photons = (tag, n) => {
        const f = new Float32Array(RAY_F * NP), u = new Uint32Array(f.buffer)
        for (let i = 0; i < NP; i++) {
            const o = RAY_F * i, a = 2 * Math.PI * i / NP, r = 0.1 * Math.sqrt((i * 0.618) % 1)
            f.set([r * Math.cos(a), r * Math.sin(a), 0.05], o)
            f.set(norm([0.2 * Math.sin(3 * a), 0.2 * Math.cos(5 * a), -1]), o + 4)
            f[o + 8] = 1; f[o + 9] = 1; f[o + 10] = 1                // radiance: the photon's flux
            f[o + 12] = 1; f[o + 13] = 1; f[o + 14] = 1              // beta
            f[o + 16] = n; u[o + 18] = 1; u[o + 19] = 0; u[o + 20] = i; f[o + 21] = 1
            u[o + 22] = tag; f[o + 23] = 0; f[o + 24] = -1; f[o + 25] = 0; f[o + 26] = 0
        }
        return f
    }
    const run = async (tag, n, over = {}) => {
        const rays = photons(tag, n)
        const mb0 = WG.createStorageBuffer(rays), mb1 = WG.createStorageBuffer(rays.byteLength)
        const shade = WG.createStorageBuffer(HIT_F * 4 * NP), counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
        march.resources = { marchBuffer0: mb0.b, marchBuffer1: mb1.b, shadeBuffer: shade.b, counters: counters.b }
        let inCount = NP, readfrom = 0, shaded = 0
        for (let pass = 0; pass < 60 && inCount > 0; pass++) {
            counters.w(counterWords({ [readfrom]: inCount, 2: shaded, 3: readfrom }))
            march.uniforms = { ...bag, lastpass: 0 }
            march.dispatch(Math.ceil(inCount / 64), 1, 1)
            const c = await counters.r(Uint32Array)
            shaded = c[2]; inCount = readfrom === 0 ? c[1] : c[0]; readfrom = 1 - readfrom
        }
        counters.w(counterWords({ 2: shaded }))
        surface.resources = { shadeBuffer: shade.b, counters: counters.b, learn: WG.createStorageBuffer(4 * 65536).b }
        surface.uniforms = { ...bag, ...over }
        surface.dispatch(Math.ceil(shaded / 64), 1, 1)
        const h = await shade.r(Float32Array), hu = new Uint32Array(h.buffer)
        const out = []
        for (let k = 0; k < shaded; k++) {
            const o = HIT_F * k
            out.push({ i: hu[o + 20], pos: [h[o], h[o + 1], h[o + 2]], mf: [hu[o + 68], h[o + 69], hu[o + 70], h[o + 71]] })
        }
        for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
        return out
    }
    const PH = 1 | 4                                        // TAG_PHOTON | TAG_PASSED
    const hits = await run(PH, 1.5)
    let found = 0, agree = 0, worstW = 0, pixWrong = 0, refusedBoth = 0, onlyOne = 0
    for (const r of hits) {
        const D = r.pos, js = manifoldSolve({ D, nD: [0, 0, 1], nMed: 1.5, y: Y, sdf: sceneJs, tol: marchTolAt(EPS, D) })
        const c = js && -dot(js.w, fwd), xy = js && [dot(js.w, right) / (c * tf), dot(js.w, up) / (c * tf)]
        const inView = js && Math.abs(xy[0]) < 0.98 && Math.abs(xy[1]) < 0.98
        const gpu = r.mf[1] > 0
        if (gpu) found++
        if (!inView && !gpu) { refusedBoth++; continue }
        if (!inView || !gpu) { onlyOne++; continue }
        agree++
        const pix = Math.floor((xy[0] + 1) / 2 * RES) + RES * Math.floor((xy[1] + 1) / 2 * RES)
        if (r.mf[0] !== pix) pixWrong++
        worstW = Math.max(worstW, Math.abs(r.mf[1] / manifoldWeight(js, 1.5, c, apx) - 1))
    }
    console.log(`  the surface kernel: ${hits.length} photons on the floor, ${found} answered, ${agree} with the mirror, ${refusedBoth} refused by both, ${onlyOne} by one`)
    ok('prog_surface: photons inside the glass reach the floor (the march) and most are answered', hits.length === NP && found > NP / 2, `${hits.length} ${found}`)
    ok('prog_surface: its answers are the mirror\'s -- the same photons answered (all but 2 %)', onlyOne <= 0.02 * NP, `${onlyOne}`)
    ok('prog_surface: ...on the same pixel', pixWrong <= 2, `${pixWrong}`)
    ok('prog_surface: ...with the same weight, within 1 %', worstW < 0.01, `${worstW}`)
    const none = async (what, tag, n, over) => {
        const h = await run(tag, n, over)
        ok(`prog_surface: no answer with ${what}`, h.length > 0 && h.every(r => r.mf[0] === 0 && r.mf[1] === 0 && r.mf[2] === 0 && r.mf[3] === 0), `${h.length}`)
    }
    await none('the setting off', PH, 1.5, { manifold: 0 })
    await none('a photon straight from its source (no TAG_PASSED)', 1, 1.5, {})
    await none('a photon in air', PH, 1.0, {})
    await none('a camera path', 0, 1.5, {})
    await none('the last pass', PH, 1.5, { lastpass: 1 })
    await none('Draft', PH, 1.5, { renderMode: 1 })
    await none('the illuminance view', PH, 1.5, { measureMode: 1 })
    await none('an orthographic camera', PH, 1.5, { camtype: 1 })
    // a lens: each answer from a point of its disc -- answers still, and pixels the pinhole's were not
    const lensed = await run(PH, 1.5, { camLens: [0.02, 0.5, 0, 0] })
    const moved = lensed.filter(r => r.mf[1] > 0 && hits.find(q => q.i === r.i)?.mf[0] !== r.mf[0]).length
    ok('prog_surface with an aperture: answers from points of the lens, most on another pixel than the pinhole\'s',
        lensed.filter(r => r.mf[1] > 0).length > NP / 2 && moved > NP / 4, `${lensed.filter(r => r.mf[1] > 0).length} answered, ${moved} moved`)
    await surface.ready
}

// ---- SHADE'S HALF ---------------------------------------------------------------------------------------------------
{
    const { SHADE_PRELUDE } = await import('../scene_api.js')
    const { MATERIALS_PBR } = await import('../materials_pbr.js')
    const { FACE_TABLE, PROCESSING, LEARN_WORDS } = await import('../tracebasics.js')
    const { counterstruct } = await import('../wavefront.js')
    const { MF_WORDS } = await import('../microfacet.js')
    /* cases: [what, tag, n, weight, uniforms over] -- an answer with pixel 1234, weight w, the direction (0.3, 0.1, 1)
       normalised, 2 cm of glass absorbing mu (0.5, 1, 2) per metre */
    const CASES = [['a photon in glass with an answer', 5, 1.5, 0.7, {}, true],
                   ['...the setting off', 5, 1.5, 0.7, { manifold: 0 }, false],
                   ['...the last pass', 5, 1.5, 0.7, { lastpass: 1 }, false],
                   ['...no answer (weight 0)', 5, 1.5, 0, {}, false],
                   ['a photon with no delta before', 1, 1.5, 0.7, {}, false],
                   ['a photon in air', 5, 1.0, 0.7, {}, false]]
    const toX = norm([0.3, 0.1, 1]), MU = [0.5, 1, 2], DIST = 0.02, PIX = 1234
    const prog = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}`, /*wgsl*/`
    if (gid.x == 0xffffffffu) {
        _ = &marchBuffer0; _ = &marchBuffer1; _ = &shadeBuffer; _ = &frame_u32; _ = &shadowBuffer0; _ = &shadowBuffer1;
        _ = &counters; _ = &learn; _ = UB.res;
    }
    let i = gid.x;
    if (i > 0u) { return; }
    var r = newRay(VEC3(0.0, 0.0, 1e-5), normalize(VEC3(0.2, -0.1, -1.0)), VEC4(1.0), io[1]);
    r.radiance = VEC3(1.0, 2.0, 3.0);
    r.beta = VEC3(0.5, 0.5, 0.5);
    r.tag = bitcast<u32>(io[0]);
    r.bounces = 1u;
    r.pix = 0xFFFFFFFFu;
    r = withMu(r, VEC3(${MU.join(', ')}));
    let h = Hit(r, VEC4(0.0, 0.0, 1.0, 1e-5), 1u, 0u, -1.0e7);
    let m = makeDiffuse(VEC3(0.8), 1.0);
    var st = pathBegin(h);
    st.nrm = VEC3(0.0, 0.0, 1.0);
    st = pathPrelude(st);
    st.m = m;
    st.mf = vec4<u32>(${PIX}u, bitcast<u32>(io[2]), pack2x16snorm(mfOct(VEC3(${toX.join(', ')}))), bitcast<u32>(${DIST}));
    st = pathMiddle(st);
    io[8] = select(0.0, 1.0, NEE_VALID);
    io[9] = bitcast<f32>(NEE_RAY.pix);
    io[10] = NEE_RAY.radiance.x; io[11] = NEE_RAY.radiance.y; io[12] = NEE_RAY.radiance.z;
    io[13] = bitcast<f32>(NEE_RAY.tag); io[14] = NEE_RAY.tmax;
    // f as mfConnect makes it: the lobes seen from the face's side inside the glass, towards where the photon came from
    let toXd = mfUnoct(unpack2x16snorm(st.mf.z));
    let lb = makeLobes(VEC3(0.0, 0.0, 1.0), toXd, m, r.n / ownMedium(m, r.n), r.n, false);
    let f = lobesEval(lb, -r.dir, LT_MIN_ALPHA);
    io[15] = f.x; io[16] = f.y; io[17] = f.z;
    `, ComputeUniformTypes,
    { marchBuffer0: 'array<Ray>', marchBuffer1: 'array<Ray>', shadeBuffer: 'array<ShadeItem>', frame_u32: 'array<atomic<u32>>',
      shadowBuffer0: 'array<Ray>', shadowBuffer1: 'array<Ray>', learn: 'array<atomic<u32>>', counters: counterstruct, io: 'array<f32>' },
    { wg: [64, 1, 1], async: false })
    const b = n => WG.createStorageBuffer(Math.max(n, 256))
    const io = b(4 * 32)
    prog.resources = { marchBuffer0: b(112).b, marchBuffer1: b(112).b, shadeBuffer: b(288).b, frame_u32: b(16).b,
        shadowBuffer0: b(112).b, shadowBuffer1: b(112).b, learn: b(4 * (LEARN_WORDS + MF_WORDS)).b, counters: b(64).b, io: io.b }
    for (const [what, tag, n, w, over, want] of CASES) {
        const inp = new Float32Array(32), iu = new Uint32Array(inp.buffer)
        iu[0] = tag; inp[1] = n; inp[2] = w
        io.w(inp)
        prog.uniforms = { res: [RES, RES], camtype: 0, measureMode: 0, renderMode: 0, lastpass: 0, maxbounce: 10, manifold: 1, nee: 0, ...over }
        prog.dispatch(1, 1, 1)
        const g = await io.r(Float32Array), gu = new Uint32Array(g.buffer)
        if (!want) { ok(`mfConnect: ${what} -- nothing queued`, g[8] === 0); continue }
        const ab = MU.map(mu => Math.exp(-mu * DIST))
        const expect = [1, 2, 3].map((rad, k) => rad * 0.5 * g[15 + k] * ab[k] * w)
        ok(`mfConnect: ${what} -- queued`, g[8] === 1)
        ok('...on the answer\'s pixel, a connection that ends before it marches', gu[9] === PIX && gu[13] === 2 && g[14] < 0, `${gu[9]} ${gu[13]} ${g[14]}`)
        ok('...carrying flux f exp(-mu d) w, f the BSDF towards the face (within 1e-5)', expect.every((v, k) => Math.abs(g[10 + k] / v - 1) < 1e-5) && g[15] > 0,
            `${[...g.slice(10, 13)]} against ${expect}`)
    }
}

console.log(`manifold GPU: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
