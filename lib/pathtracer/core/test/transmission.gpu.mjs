//======================================================================================================================
// THE SIDE BEYOND ON A REAL WEBGPU in node (0.next; materials_pbr.js THE SIDE BEYOND, roadmap/DIFFUSERS.md). Run:
//   node lib/pathtracer/core/test/transmission.gpu.mjs
//
// Rough refraction is evaluated now, where it was only sampled: light sampling aims through the face a path leaves
// glass by, and a photon in glass connects out through it to the camera, which leaves that light to it. Compiled by Dawn
// (Tint, the browser's compiler) and run:
//   - THE LOBES: the WGSL's value and density below the surface (lobesEval, lobesPdf with the side beyond lit) against
//     the JS mirror (core/transmission.js, which test/transmission.test.mjs holds to its own draw), case by case;
//   - THE WHOLE RENDERER (raytrace_main.js R.trace, every kernel) on a glass slab frosted on ONE face, seen from below
//     under a large sun -- each way round one of the two new strategies is the only new thing in the picture:
//       FROSTED ON TOP: a camera path enters by the clear underside (a delta) and leaves by the frosted top, where light
//       sampling now aims at the sun through it. With it on and off, the camera's own paths, the slab must read the same.
//       FROSTED UNDERNEATH: the sun's photons pass the clear top (a delta, TAG_PASSED) and now connect out through the
//       frosted underside; the camera's paths leave them that light (CLS_CAND, the transmission EV_EVAL at the first
//       surface). Light tracing on and off must read the same, and with the photon map on too (a transmission is never
//       the map's D: LAST_THROUGH).
//     Each agreement is to three of its own error bars (batch means, as sppm.gpu.mjs), and the error bars are printed:
//     what each strategy buys in noise is shown, not asserted -- a software adapter's numbers are not a card's.
//
// What it does not run: the lights' photons (CLS_LIGHTS, which needs a builder light) -- the bench row
// transmission-parity has one; and the picture itself, which is the user's to judge (CLAUDE.md).
// OPTIONAL, AND LOUD ABOUT IT: the `webgpu` package (npm i -g webgpu) and a Vulkan driver (lavapipe).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.LP_NUM_THREADS ??= '0'                     // the queues' order the same every run (sppm.gpu.mjs says why)
// more samples for a closer look (TRANSMISSION_GPU_SCALE=4: four times each render); the checks are each one's error bar
const K = Math.max(1, Number(process.env.TRANSMISSION_GPU_SCALE ?? 1) | 0)
const SEED = (Number(process.env.TRANSMISSION_GPU_SEED ?? 1) >>> 0) || 1
{
    let a = SEED
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
if (!webgpu) { console.log('(transmission GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
const { SHADE_PRELUDE } = await import('../scene_api.js')
const { MATERIALS_PBR } = await import('../materials_pbr.js')
const { FACE_TABLE, PROCESSING, LEARN_WORDS } = await import('../tracebasics.js')
const { MF_WORDS } = await import('../microfacet.js')
const { lobesJS, roughThroughEvalJS, roughThroughPdfJS } = await import('../transmission.js')
const U = await import('../uniforms.schema.js')
const { derive, LUMA } = await import('../photometry.js')
const { effective } = await import('../../quality.js')
const { RAYTRACER } = await import('../raytrace_main.js')
const { CAMERA } = await import('../../../camera.js')
const { engineCamera } = await import('../units.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(transmission GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }

/*----------------------------------------------------------------------------------------------------------------------
  THE LOBES: one thread a (material, view, light) case, the WGSL's value and density below the surface, and the local
  frame's view and light it used, so the JS mirror is asked about exactly those
----------------------------------------------------------------------------------------------------------------------*/
{
    const cases = []
    for (const [eta, n0, n1] of [[1 / 1.5, 1, 1.5], [1.5, 1.5, 1]]) for (const r of [0.25, 0.4, 0.7]) for (const trans of [1, 0.5])
        for (const th of [0, 30, 60, 75]) for (let k = 0; k < 6; k++) {
            const t = th * Math.PI / 180, v = [Math.sin(t), 0, Math.cos(t)]
            // lights below: straight through, along the refraction, and spread
            const lt = ((k * 13 + th) % 88) * Math.PI / 180, ph = k * 1.1      // below the surface: under 90 degrees from straight down
            cases.push({ eta, n0, n1, r, trans, v, l: [Math.sin(lt) * Math.cos(ph), Math.sin(lt) * Math.sin(ph), -Math.cos(lt)] })
        }
    const N = cases.length
    const inp = new Float32Array(N * 12)
    cases.forEach((c, i) => inp.set([c.r, c.trans, c.n0, c.n1, ...c.v, 0, ...c.l, 0], i * 12))
    const out = WG.createStorageBuffer(N * 8 * 4)
    const k = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}`, /*wgsl*/`
        let i = gid.x;
        if (i >= ${N}u) { return; }
        if (i == 0xffffffffu) {
            _ = &marchBuffer0; _ = &marchBuffer1; _ = &shadeBuffer; _ = &frame_u32; _ = &shadowBuffer0; _ = &shadowBuffer1;
            _ = &counters; _ = UB.res;
        }
        let q0 = cases[i * 3u]; let q1 = cases[i * 3u + 1u]; let q2 = cases[i * 3u + 2u];
        var m = makeDefaultMaterial();
        m.baseColor = VEC3(1.0); m.metallic = 0.0; m.roughness = q0.x; m.specular = 0.5; m.transmission = q0.y; m.ior = 1.5;
        var lb = makeLobes(VEC3(0.0, 0.0, 1.0), q1.xyz, m, q0.z / q0.w, q0.z, q0.z > 1.0);
        lb.through = true;
        let li = toLocal(lb, q2.xyz);
        out[i * 8u] = lobesEval(lb, q2.xyz, 0.0).x;
        out[i * 8u + 1u] = lobesPdf(lb, q2.xyz);
        out[i * 8u + 2u] = lb.o.x; out[i * 8u + 3u] = lb.o.y; out[i * 8u + 4u] = lb.o.z;
        out[i * 8u + 5u] = li.x; out[i * 8u + 6u] = li.y; out[i * 8u + 7u] = li.z;
    `, U.ComputeUniformTypes,
        { marchBuffer0: 'array<Ray>', marchBuffer1: 'array<Ray>', shadeBuffer: 'array<ShadeItem>', frame_u32: 'array<atomic<u32>>',
          shadowBuffer0: 'array<Ray>', shadowBuffer1: 'array<Ray>', learn: 'array<atomic<u32>>', counters: 'array<u32>',
          cases: 'array<vec4<f32>>', out: 'array<f32>' }, { wg: [64, 1, 1], async: false })
    const buf = n => WG.createStorageBuffer(Math.max(n, 256 * K))
    k.resources = { marchBuffer0: buf(512).b, marchBuffer1: buf(512).b, shadeBuffer: buf(512).b, frame_u32: buf(16).b,
        shadowBuffer0: buf(512).b, shadowBuffer1: buf(512).b, learn: buf(4 * (LEARN_WORDS + MF_WORDS)).b, counters: buf(64).b,
        cases: WG.createStorageBuffer(inp).b, out: out.b }
    k.uniforms = { res: [1, 1], renderMode: 0 }
    k.dispatch(Math.ceil(N / 64), 1, 1)
    const g = await out.r(Float32Array)
    let worstF = 0, worstP = 0, nonzero = 0, bad = []
    cases.forEach((c, i) => {
        const o = [g[i * 8 + 2], g[i * 8 + 3], g[i * 8 + 4]], li = [g[i * 8 + 5], g[i * 8 + 6], g[i * 8 + 7]]
        const lb = lobesJS({ o, r: c.r, trans: c.trans, eta: c.eta })
        const f = roughThroughEvalJS(lb, li), p = roughThroughPdfJS(lb, li)
        if (f > 0) nonzero++
        const ef = Math.abs(g[i * 8] - f) / Math.max(f, 1e-3), ep = Math.abs(g[i * 8 + 1] - p) / Math.max(p, 1e-3)
        worstF = Math.max(worstF, ef); worstP = Math.max(worstP, ep)
        if (ef > 2e-3 || ep > 2e-3) bad.push({ c: { r: c.r, trans: c.trans, eta: c.eta.toFixed(3) }, o, li, gpu: [g[i * 8], g[i * 8 + 1]], js: [f, p] })
    })
    ok(`the WGSL's rough-refraction value and density below the surface are the JS mirror's, ${N} cases (${nonzero} with a value;`
        + ` worst relative difference ${worstF.toExponential(1)} and ${worstP.toExponential(1)})`,
        bad.length === 0 && nonzero >= N / 5, JSON.stringify(bad.slice(0, 3)))
}

/*----------------------------------------------------------------------------------------------------------------------
  THE WHOLE RENDERER: a glass slab over nothing, frosted on one face, a 20 degree sun above, the camera below
----------------------------------------------------------------------------------------------------------------------*/
const SLAB_Z = 0.35, SLAB_T = 0.05, SLAB_H = 0.4, ROUGH = 0.4
const W = 32, H = 32
const slabScene = top => ({
    id: `transmission-gpu-${top ? 'top' : 'under'}`, title: `a glass slab frosted ${top ? 'on top' : 'underneath'}`,
    unit: 'm', extent: 2, envRadius: 1.2, uniforms: {},
    wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    var m = makeDefaultMaterial();
    if (idx == 1u) {
        m.baseColor = vec3<f32>(1.0); m.metallic = 0.0; m.specular = 0.5; m.transmission = 1.0; m.ior = 1.5;
        // frosted on one face only: the ${top ? 'top' : 'underside'}
        m.roughness = select(0.0, ${ROUGH}, C.r.pos.z ${top ? '>' : '<'} ${SLAB_Z});
    }
    return m;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.0, ${SLAB_Z}), VEC3(${SLAB_H}, ${SLAB_H}, ${SLAB_T})), 1u);
    return C;
}`,
})

const cam = CAMERA({ aspect: W / H, fov: 55, up: [0, 0, 1] })
cam.setPose({ pos: [0.0, -0.55, -0.25], target: [0, 0, SLAB_Z], up: [0, 0, 1] })
const CU = cam.getUniforms(), M = CU.invView, fx = CU.invProjection[0], fy = CU.invProjection[5]
const right = [M[0], M[1], M[2]], up = [M[4], M[5], M[6]], back = [M[8], M[9], M[10]], pos = [M[12], M[13], M[14]]
// THE REGION: pixels whose ray meets the slab's underside well inside its edge
const region = []
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = ((px + 0.5) / W) * 2 - 1, y = ((py + 0.5) / H) * 2 - 1
    const d = [0, 1, 2].map(a => right[a] * x * fx + up[a] * y * fy - back[a])
    const t = (SLAB_Z - SLAB_T - pos[2]) / d[2]
    if (!(t > 0)) continue
    const hx = pos[0] + d[0] * t, hy = pos[1] + d[1] * t
    if (Math.abs(hx) < SLAB_H - 0.1 && Math.abs(hy) < SLAB_H - 0.1) region.push(px + W * py)
}
ok(`the region seen on the slab's underside: ${region.length} pixels of ${W * H}`, region.length >= 100, String(region.length))

const lumOf = a => { const f = new Float32Array(a.buffer, a.byteOffset, a.length); return i => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2] }
async function renderer(scene) {
    const Q = { w: W, h: H, resetframecount: 1 }
    const R = RAYTRACER(WG, null, Q, scene)
    R.hud = () => { }
    let initErr = null
    try { await quietly(() => R.init()) } catch (e) { initErr = e?.message ?? String(e) }
    ok(`the renderer on Dawn, ${scene.title}: built`, initErr === null && R._built === true, initErr)
    const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
    const bagOf = over => {
        const v = { ...U.defaultUniformValues(), envMode: 0, uSunElevation: 70, uSunAzimuth: 30, sunDiameter: 20, sunIlluminance: 100000,
                    skyIlluminance: 0, nee: 1, lt: 1, ltPhotons: 4, ltLearn: 0, maxbounce: 10, rr: 0, fireflyClamp: 0,
                    maxaverages: 0, autoExposure: 0, sppm: 0, sppmRadius: 2, ...over }
        const traced = effective(v)
        const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius })
        const EC = engineCamera({ ...CU, camLens: [0, 1.6, 0, 0] }, 0, derived.sceneUnit)
        const types = U.ComputeUniformTypes
        return Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
            ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
            .filter(([k]) => k in types || k in U.UniformSpec))
    }
    const landed = async () => { for (let t = 0; R._readingSppm; t++) { if (t > 5000) throw new Error('no reading'); await new Promise(r => setTimeout(r, 2)) } }
    // the region's mean and its batch-means error bar: the region's light summed every 16 samples (sppm.gpu.mjs says why)
    return async (over, samples) => {
        const bag = bagOf(over)
        R.kernelOptions = R.kernelOptionsOf(bag)
        await quietly(() => R.applyKernelOptions())
        Q.resetframecount = 1
        let err = null
        const sums = []
        try {
            for (let done = 0; done < samples;) {
                const n = Math.min(16, samples - done)
                await quietly(() => R.trace(Q, bag, n, target))
                Q.resetframecount = 0
                await WG.device.queue.onSubmittedWorkDone()
                await landed()
                done += n
                const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array), lum = lumOf(a)
                sums.push({ S: region.reduce((s, i) => s + lum(i) * a[i * 4 + 3], 0), C: region.reduce((s, i) => s + a[i * 4 + 3], 0) })
            }
        } catch (e) { err = e?.message ?? String(e) }
        const g = sums.map((s, k) => (s.S - (k ? sums[k - 1].S : 0)) / (s.C - (k ? sums[k - 1].C : 0)))
        const mean = g.reduce((s, v) => s + v, 0) / g.length
        const bse = Math.sqrt(g.reduce((s, v) => s + (v - mean) ** 2, 0) / (g.length - 1) / g.length)
        return { err, mean, bse }
    }
}
const agree = (a, b) => Math.abs(a.mean - b.mean) <= 3 * Math.hypot(a.bse, b.bse)
const show = (r, ref) => `${r.mean.toFixed(0)} +- ${r.bse.toFixed(0)} (${(r.mean / ref.mean).toFixed(4)} of the camera's own)`

{
    const render = await renderer(slabScene(true))
    const t0 = Date.now()
    const own = await render({ nee: 0, lt: 0 }, 768 * K)
    const nee = await render({ nee: 1, lt: 0 }, 384 * K)
    const both = await render({ nee: 1, lt: 1 }, 384 * K)
    console.log(`  FROSTED ON TOP, seen from below (${region.length} pixels), mean luminance in cd/m^2: the camera's own paths`
        + ` ${own.mean.toFixed(0)} +- ${own.bse.toFixed(0)}; light sampling through the frosted face ${show(nee, own)};`
        + ` and light tracing ${show(both, own)}; ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    ok('frosted on top: the three renders ran, and the slab is lit', [own, nee, both].every(r => r.err === null) && own.mean > 100,
        [own, nee, both].map(r => r.err).join(' | ') + ` ${own.mean}`)
    ok('frosted on top: light sampling through the face a path leaves glass by reads what the camera\'s own paths read',
        agree(nee, own), `${show(nee, own)}`)
    ok('...and light tracing on changes nothing (the sun\'s photons end at the frosted top they meet first)', agree(both, own), `${show(both, own)}`)
}
{
    const render = await renderer(slabScene(false))
    const t0 = Date.now()
    const own = await render({ nee: 0, lt: 0 }, 768 * K)
    const lt = await render({ nee: 1, lt: 1 }, 384 * K)
    const map = await render({ nee: 1, lt: 1, sppm: 1 }, 256 * K)
    console.log(`  FROSTED UNDERNEATH, seen from below (${region.length} pixels): the camera's own paths ${own.mean.toFixed(0)} +- ${own.bse.toFixed(0)};`
        + ` the sun's photons out through the frosted face ${show(lt, own)}; and the photon map on ${show(map, own)};`
        + ` ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    ok('frosted underneath: the three renders ran, and the slab is lit', [own, lt, map].every(r => r.err === null) && own.mean > 100,
        [own, lt, map].map(r => r.err).join(' | ') + ` ${own.mean}`)
    ok('frosted underneath: the photons\' connection out of glass, the camera leaving them that light, reads what the camera\'s own paths read',
        agree(lt, own), `${show(lt, own)}`)
    ok('...and with the photon map on, the same (a transmission is never its D)', agree(map, own), `${show(map, own)}`)
}

console.log(`transmission GPU: ${pass} passed, ${fail} failed (seed ${SEED}: TRANSMISSION_GPU_SEED=${SEED} runs it again)`)
process.exit(fail ? 1 : 0)
