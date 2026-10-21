//======================================================================================================================
// THE PHOTON MAP ON A REAL WEBGPU in node. Run: node lib/pathtracer/core/test/sppm.gpu.mjs
//
// What 0.60.0 put in the frame (core/sppm.js, wavefront.js prog_sppm), compiled by Dawn (Tint) and run:
//   - THE GATES, the WGSL's sppmStores, sppmGathers and sppmUnmet against the JS transcription (sppm.js storesJS,
//     gathersJS, allLobesJS) over every tag a ray can carry into them, a light no camera path can meet (ltMis < 0) and
//     any other, in the full renderer, Draft and the Optics view;
//   - THE WHOLE RENDERER (raytrace_main.js R.trace, every kernel, the real tinywebgpu) on a glass slab standing over a
//     white floor under a large sun, the camera looking at the floor through the slab -- light -> glass -> floor ->
//     glass -> eye, the user's case of 2026-10-15. The floor seen through the slab is drawn two ways, which must
//     agree: the camera's own paths (the map off: they find the sun through the glass by chance -- a 20 degree sun, so
//     they do) and the photon map, without a lens and through one. (The lens's photons were a third, until 0.61.0
//     removed them.) The map's picture is a little blurred at first and its mean over the region must still be the
//     camera's. And the idle skip (0.61.0): a view of the floor beside the slab alone looks through nothing, and the
//     map goes idle there.
//
// REPRODUCIBLE, AND EACH TOLERANCE ITS OWN ERROR BAR (0.75.1). Run on main at 3ffa63c, the same code failed a different
// check in different runs (2026-10-21): the overflow, the idle skip, Draft. A run's randomness had two sources, both
// measured on lavapipe that day. The renderer draws every sample's seed from Math.random (utilities.js seed_vec4u32),
// and rays take their places in the queues by atomicAdd (wavefront.js) and seed their random numbers by that place
// (prog_shade, prog_sppm: SEED_u32 of the index), an order lavapipe's threads change from run to run. With Math.random
// seeded alike, two runs differed from the first sample; with lavapipe single-threaded too (LP_NUM_THREADS 0 or 1),
// they were identical bit for bit. So both are fixed below, and a run is repeated by its seed (SPPM_GPU_SEED, printed
// with the result). That only makes a failure repeatable. What makes the test stable is that every tolerance is the
// error bar of what it compares: another seed, another driver's queue order or LP_NUM_THREADS=4 passes as well.
//
// OPTIONAL, AND LOUD ABOUT IT: the `webgpu` package (npm i -g webgpu) and a Vulkan driver (lavapipe). A software
// adapter's speed says nothing about a card's (CLAUDE.md): this times nothing.
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/* lavapipe reads it when the device is made, below: one thread, so the queues' order is the same every run */
process.env.LP_NUM_THREADS ??= '0'
/* ...and every seed the renderer draws from Math.random, from this one (mulberry32) */
const SEED = (Number(process.env.SPPM_GPU_SEED ?? 1) >>> 0) || 1
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
if (!webgpu) { console.log('(photon map GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
const { SHADE_PRELUDE } = await import('../scene_api.js')
const { MATERIALS_PBR } = await import('../materials_pbr.js')
const { FACE_TABLE, PROCESSING, LEARN_WORDS } = await import('../tracebasics.js')
const { MF_WORDS } = await import('../microfacet.js')
const { SPPM_WGSL, SPPM_FILL, storesJS, gathersJS, allLobesJS, TAGS } = await import('../sppm.js')
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
    console.log(`(photon map GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }

/*----------------------------------------------------------------------------------------------------------------------
  THE GATES: one thread a case, a ray of that tag, bounces and index, the gates' answers written back
----------------------------------------------------------------------------------------------------------------------*/
{
    const T = TAGS
    const cases = []
    for (const photon of [0, 1]) for (const f of [0, 1, 2, 3]) for (const extra of [0, T.PASSED, T.PROBE, T.OPTIC, T.OPTIC | T.LTALL, T.PASSED | T.OPTIC | T.LTALL, T.SEEK])
        for (const bounces of [0, 1, 2, 9, 10]) for (const ltMis of [0, 0.5, -1]) for (const diffuse of [0, 1, 3]) {
            const tag = (photon ? T.PHOTON : 0) | (f << (photon ? T.PH_SHIFT : T.CAM_SHIFT)) | extra
            cases.push({ tag, bounces, ltMis, diffuse })     // diffuse: the ray's diffuse bounces (Ray.counts, 0.75.0)
        }
    const N = cases.length
    const words = new Uint32Array(N * 4)
    cases.forEach((c, i) => { words[i * 4] = c.tag; words[i * 4 + 1] = c.bounces; words[i * 4 + 2] = new Uint32Array(new Float32Array([c.ltMis]).buffer)[0]; words[i * 4 + 3] = c.diffuse })
    const inBuf = WG.createStorageBuffer(words)
    const outBuf = WG.createStorageBuffer(N * 12)
    const k = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}${SPPM_WGSL}`, /*wgsl*/`
        let i = gid.x;
        if (i >= arrayLength(&cases) / 4u) { return; }
        // every binding the text names reached from main (layout 'auto' keeps only those: check-shaders says why)
        if (i == 0xFFFFFFFFu) { atomicAdd(&learn[0], 0u); atomicAdd(&sppmHeads[0], 0u); sppmRecs[0] = 0u; }
        var r: Ray;
        r.tag = cases[i * 4u];
        r.bounces = cases[i * 4u + 1u];
        r.ltMis = bitcast<f32>(cases[i * 4u + 2u]);
        r.counts = cases[i * 4u + 3u] * DIFFUSE_ONE;
        out[i * 3u] = select(0u, 1u, sppmStores(r));
        out[i * 3u + 1u] = select(0u, 1u, sppmGathers(r));
        out[i * 3u + 2u] = select(0u, 1u, sppmUnmet(r));
    `, U.ComputeUniformTypes, { cases: 'array<u32>', out: 'array<u32>', learn: 'array<atomic<u32>>',
        sppmHeads: 'array<atomic<u32>>', sppmRecs: 'array<u32>' })
    await k.ready
    k.resources = { cases: inBuf.b, out: outBuf.b, learn: WG.createStorageBuffer(16).b, sppmHeads: WG.createStorageBuffer(16).b,
                    sppmRecs: WG.createStorageBuffer(16).b }
    // ...and with the diffuse cap (0.75.0): none, and 2 (one diffuse bounce)
    for (const [label, mode, cap] of [['the full renderer', 0, 0], ['Draft', 1, 0], ['the Optics view', 3, 0],
                                      ['the full renderer, a diffuse cap of 2', 0, 2], ['the Optics view, a diffuse cap of 2', 3, 2]]) {
        k.uniforms = { renderMode: mode, maxbounce: 10, camtype: 0, measureMode: 0, sppmCtl: [1, 1000, 0, 0], diffuseCap: cap }
        k.run(N, 1, 1)
        const got = await outBuf.r(N * 12, 0, Uint32Array)
        const bad = cases.filter((c, i) => (got[i * 3] === 1) !== storesJS(c.tag, c.bounces, 10, { optics: mode === 3, ltMis: c.ltMis,
                                                                                                   diffuse: c.diffuse, diffuseCap: cap })
            || (got[i * 3 + 1] === 1) !== gathersJS(c.tag) || (got[i * 3 + 2] === 1) !== allLobesJS(c.tag, c.ltMis))
        const stores = cases.filter((c, i) => got[i * 3] === 1).length, gathers = cases.filter((c, i) => got[i * 3 + 1] === 1).length
        const unmet = cases.filter((c, i) => got[i * 3] === 1 && got[i * 3 + 2] === 1 && !(c.tag & T.PASSED)).length
        ok(`the gates on Dawn, ${label}: the WGSL's store, gather and every-lobe answer as the JS's, every one of ${N} rays`
            + ` (${stores} stored, ${unmet} of them an unmet light's past no glass; ${gathers} gathering)`,
            bad.length === 0 && stores > 0 && gathers > 0 && unmet > 0, JSON.stringify(bad.slice(0, 4)))
    }
}

/*----------------------------------------------------------------------------------------------------------------------
  THE TESTS BEFORE THE WORK (0.61.2): where sppmEvaluable says a surface has nothing to store or gather, and where
  lobesNone (materials_pbr.js) says a material has nothing a connection or a light sample could evaluate, lobesEval is
  exactly 0 -- for every view, every light and both floors (0 for a camera ray or an unmet light's photon, LT_MIN_ALPHA
  for any other photon). Both skip work on that promise alone, so it is held here against the BSDF itself, roughness on
  either side of both alpha floors, anisotropic and coated too. sppmEvaluable compared roughness with the alpha floors
  until 0.61.2; the scene's silver mirror (roughness 0.02, alpha 4e-4: a delta) is the case it let through.
----------------------------------------------------------------------------------------------------------------------*/
{
    const mats = []
    for (const r of [0, 0.01, 0.02, 0.0316, 0.0317, 0.05, 0.1, 0.2236, 0.2237, 0.5, 1]) for (const metallic of [0, 0.5, 1])
        for (const trans of [0, 0.5, 1]) for (const an of [0, 0.8]) for (const coat of [0, 1]) mats.push([r, metallic, trans, an, coat])
    const M = mats.length, VIEWS = 16, LIGHTS = 64
    const k = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}${SPPM_WGSL}`, /*wgsl*/`
        let i = gid.x;
        if (i >= ${M}u) { return; }
        // every binding the text names reached from main, the uniforms too (nothing below reads UB)
        if (i == 0xFFFFFFFFu) { atomicAdd(&learn[0], 0u); atomicAdd(&sppmHeads[0], 0u); sppmRecs[0] = 0u; _ = UB.maxbounce; }
        let q = mats[i];
        var m = makeDefaultMaterial();
        m.roughness = q.x; m.metallic = q.y; m.transmission = q.z; m.anisotropy = q.w; m.ior = 1.5;
        m.baseColor = VEC3(0.9, 0.7, 0.5);
        if (i % 2u == 1u) { m = coatMaterial(m, 1u, 0.1, 0.9, 550.0, 20.0, 1.8); }     // coat, the list's innermost: odd rows
        let nrm = VEC3(0.0, 0.0, 1.0);
        SEED_uvec4(vec4<u32>(3u, 5u, 7u, 11u)); SEED_u32(i);
        var fAll = 0.0; var fPh = 0.0;
        for (var a = 0u; a < ${VIEWS}u; a++) {
            let u = PRNG();
            let z = 0.02 + 0.98 * u.x; let s = sqrt(1.0 - z * z);
            let v = VEC3(s * cos(6.2831853 * u.y), s * sin(6.2831853 * u.y), z);
            let lb = makeLobes(nrm, v, m, 1.0 / ownMedium(m, 1.0), 1.0, false);
            for (var b = 0u; b < ${LIGHTS}u; b++) {
                let w = PRNG();
                // half the lights spread over the hemisphere, half near the mirror direction, where a narrow lobe is
                let zz = select(0.02 + 0.98 * w.x, 1.0 - 0.001 * w.x, b % 2u == 0u); let ss = sqrt(max(0.0, 1.0 - zz * zz));
                var l = VEC3(ss * cos(6.2831853 * w.y), ss * sin(6.2831853 * w.y), zz);
                if (b % 2u == 0u) { l = normalize(reflect(-v, nrm) + VEC3(ss * cos(6.2831853 * w.y), ss * sin(6.2831853 * w.y), 0.0)); }
                fAll = max(fAll, max3(abs(lobesEval(lb, l, 0.0))));
                fPh = max(fPh, max3(abs(lobesEval(lb, l, LT_MIN_ALPHA))));
            }
        }
        out[i * 5u] = select(0.0, 1.0, sppmEvaluable(m, true));
        out[i * 5u + 1u] = select(0.0, 1.0, sppmEvaluable(m, false));
        out[i * 5u + 2u] = select(0.0, 1.0, lobesNone(m));
        out[i * 5u + 3u] = fAll;
        out[i * 5u + 4u] = fPh;
    `, U.ComputeUniformTypes, { mats: 'array<vec4<f32>>', out: 'array<f32>', learn: 'array<atomic<u32>>',
        sppmHeads: 'array<atomic<u32>>', sppmRecs: 'array<u32>' })
    await k.ready
    const outBuf = WG.createStorageBuffer(M * 5 * 4)
    k.resources = { mats: WG.createStorageBuffer(new Float32Array(mats.flatMap(([r, me, t, an]) => [r, me, t, an]))).b, out: outBuf.b,
                    learn: WG.createStorageBuffer(4 * (LEARN_WORDS + MF_WORDS)).b, sppmHeads: WG.createStorageBuffer(16).b, sppmRecs: WG.createStorageBuffer(16).b }
    // (the albedo tables left at 0: the energy terms they feed stay finite, and what is held is where f is exactly 0)
    k.uniforms = { renderMode: 0, maxbounce: 10, camtype: 0, measureMode: 0, sppmCtl: [1, 1000, 0, 0] }
    k.run(M, 1, 1)
    const g = await outBuf.r(M * 5 * 4, 0, Float32Array)
    const row = i => ({ mat: mats[i], all: g[i * 5], ph: g[i * 5 + 1], none: g[i * 5 + 2], fAll: g[i * 5 + 3], fPh: g[i * 5 + 4] })
    const rows = Array.from({ length: M }, (_, i) => row(i))
    const badAll = rows.filter(r => !r.all && r.fAll !== 0), badPh = rows.filter(r => !r.ph && r.fPh !== 0)
    const badNone = rows.filter(r => r.none && (r.fAll !== 0 || r.fPh !== 0))
    const mirror = rows.find(r => r.mat[0] === 0.02 && r.mat[1] === 1 && r.mat[2] === 0 && r.mat[3] === 0 && r.mat[4] === 0)
    ok(`a surface the map passes by has nothing to evaluate: of ${M} materials, ${rows.filter(r => !r.all).length} not gathered on`
        + ` by a camera ray (nor stored for an unmet light), ${rows.filter(r => !r.ph).length} not stored for any other photon --`
        + ` lobesEval exactly 0 on each, every view and light`, badAll.length === 0 && badPh.length === 0
        && rows.some(r => !r.all) && rows.some(r => !r.ph && r.all), JSON.stringify([...badAll, ...badPh].slice(0, 3)))
    ok(`...and a material with nothing to evaluate (lobesNone): ${rows.filter(r => r.none).length} of them, lobesEval exactly 0 at both floors`,
        badNone.length === 0 && rows.filter(r => r.none).length > 0, JSON.stringify(badNone.slice(0, 3)))
    ok('...the scene\'s silver mirror (roughness 0.02, a delta) among them: neither gathered on nor stored at, nothing to connect through',
        mirror && !mirror.all && !mirror.ph && mirror.none, JSON.stringify(mirror))
    ok('...and gloss that does evaluate is passed: a lobe at roughness 0.2237 for every photon, 0.0317 for a camera ray',
        rows.filter(r => r.mat[0] === 0.2237 && r.mat[1] === 1 && r.mat[3] === 0).every(r => r.ph && r.fPh > 0)
        && rows.filter(r => r.mat[0] === 0.0317 && r.mat[1] === 1).every(r => r.all && r.fAll > 0),
        JSON.stringify(rows.filter(r => (r.mat[0] === 0.2237 || r.mat[0] === 0.0317) && r.mat[1] === 1).slice(0, 4)))
}

/*----------------------------------------------------------------------------------------------------------------------
  THE WHOLE RENDERER: a glass slab over a white floor under a 20 degree sun, the floor seen through the slab
----------------------------------------------------------------------------------------------------------------------*/
{
    const SLAB_Z = 0.35, SLAB_T = 0.05, SLAB_H = 0.4
    const scene = {
        id: 'sppm-gpu', title: 'a glass slab over a floor', unit: 'm', extent: 2, envRadius: 1.2, uniforms: {},
        wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    var m = makeDefaultMaterial();
    if (idx == 4u) { m = makeDiffuse(vec3<f32>(0.8), 1.0); }
    if (idx == 1u) { m.baseColor = vec3<f32>(1.0); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.5; m.transmission = 1.0; m.ior = 1.5; }
    return m;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    C = add_new(C, Ncylinder(r.pos - VEC3(0.0, 0.0, -0.05), 0.05, 1.0), 4u);
    C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.0, ${SLAB_Z}), VEC3(${SLAB_H}, ${SLAB_H}, ${SLAB_T})), 1u);
    return C;
}`,
    }
    const W = 32, H = 32
    const Q = { w: W, h: H, resetframecount: 1 }
    const R = RAYTRACER(WG, null, Q, scene)
    R.hud = () => { }
    let initErr = null
    try { await quietly(() => R.init()) } catch (e) { initErr = e?.message ?? String(e) }
    ok('the renderer on Dawn: built', initErr === null && R._built === true, initErr)

    const cam = CAMERA({ aspect: W / H, fov: 55, up: [0, 0, 1] })
    cam.setPose({ pos: [0.0, -0.8, 1.3], target: [0, 0, 0], up: [0, 0, 1] })
    const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()

    const bagOf = (over, lens = 0) => {
        const v = { ...U.defaultUniformValues(), envMode: 0, uSunElevation: 70, uSunAzimuth: 30, sunDiameter: 20, sunIlluminance: 100000,
                    skyIlluminance: 0, nee: 1, lt: 1, ltPhotons: 4, ltLearn: 0, maxbounce: 10, rr: 0, fireflyClamp: 0,
                    maxaverages: 0, autoExposure: 0, sppm: 0, sppmRadius: 2, ...over }
        const traced = effective(v)
        const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius })
        const CU = cam.getUniforms()
        const EC = engineCamera({ ...CU, camLens: [lens, 1.6, 0, 0] }, 0, derived.sceneUnit)
        const types = U.ComputeUniformTypes
        return Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
            ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
            .filter(([k]) => k in types || k in U.UniformSpec))
    }
    /* THE REGION: pixels whose ray from the camera's centre meets the slab's top well inside its edge, and whose floor
       point (refracted by the slab's displacement, under a centimetre here) is in the slab's shadow from the sun -- lit
       only through the glass. Read off the pinhole; the lens's rays spread round it, so a margin. */
    const CU = cam.getUniforms(), M = CU.invView, fx = CU.invProjection[0], fy = CU.invProjection[5]
    const right = [M[0], M[1], M[2]], up = [M[4], M[5], M[6]], back = [M[8], M[9], M[10]], pos = [M[12], M[13], M[14]]
    const sunEl = 70 * Math.PI / 180, sunAz = 30 * Math.PI / 180
    const region = [], beside = []
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const x = ((px + 0.5) / W) * 2 - 1, y = ((py + 0.5) / H) * 2 - 1
        const d = [0, 1, 2].map(a => right[a] * x * fx + up[a] * y * fy - back[a])
        const t = (SLAB_Z + SLAB_T - pos[2]) / d[2], hx = pos[0] + d[0] * t, hy = pos[1] + d[1] * t
        const tb = (SLAB_Z - SLAB_T - pos[2]) / d[2], bx = pos[0] + d[0] * tb, by = pos[1] + d[1] * tb
        const t0 = -pos[2] / d[2], fxp = pos[0] + d[0] * t0, fyp = pos[1] + d[1] * t0
        // up the sun's line from the floor point, to the slab's height: in its footprint, with a margin for the disc
        const k = SLAB_Z / Math.tan(sunEl)
        const sx = fxp + Math.cos(sunAz) * k, sy = fyp + Math.sin(sunAz) * k
        const clear = (x, y, m) => Math.abs(x) > SLAB_H + m || Math.abs(y) > SLAB_H + m
        // BESIDE IT: the floor seen past the slab and lit by the sun past it, on the floor's disc
        if (clear(hx, hy, 0.05) && clear(bx, by, 0.05) && clear(sx, sy, 0.15) && Math.hypot(fxp, fyp) < 0.9) { beside.push(px + W * py); continue }
        if (Math.abs(hx) > SLAB_H - 0.08 || Math.abs(hy) > SLAB_H - 0.08) continue
        if (Math.abs(sx) > SLAB_H - 0.12 || Math.abs(sy) > SLAB_H - 0.12) continue
        region.push(px + W * py)
    }
    ok(`the region seen through the slab and lit only through it: ${region.length} pixels of ${W * H}; beside it ${beside.length}`,
        region.length >= 40 && beside.length >= 40, `${region.length} ${beside.length}`)

    /* EACH TRACE WAITS FOR ITS OWN READING (0.75.1). R.trace reads the photon map's header back without awaiting it,
       one reading at a time (raytrace_main.js, the stats' readback), and a trace steers by the last one that has landed:
       the stores' keep and the idle skip. Here that was left to the clock -- the trace after a reading ran on it or
       not, as Dawn delivered it -- so the idle skip's check rested on a race. Now every trace that runs the map is
       read before the next begins, and the next is steered by it. */
    const landed = async () => {
        for (let t = 0; R._readingSppm; t++) {
            if (t > 5000) throw new Error('the photon map\'s reading never came back')
            await new Promise(r => setTimeout(r, 2))
        }
    }
    const lumOf = a => { const f = new Float32Array(a.buffer, a.byteOffset, a.length); return i => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2] }
    /* THE ERROR BARS (0.75.1): the region's light summed every 16 samples, its mean over each 16 from the differences.
       Every sample traces new photons and new camera rays, so those means are independent, and their spread is the
       region mean's own standard error (batch means: `bse`). The pixels' spread (`se`) was used until 0.75.1. It is
       right for the camera's own paths, whose pixels are independent, and only a floor for the map, whose pixels share
       photons: 1.5 times under for Draft and for the 200-record map (measured on lavapipe, 2026-10-21). The sum is the
       mean times the count, both kept per pixel (wavefront.js prog_resolve; a plain mean with maxaverages 0). */
    const render = async (over, samples, lens = 0, { each = false } = {}) => {
        const bag = bagOf(over, lens)
        R.kernelOptions = R.kernelOptionsOf(bag)
        await quietly(() => R.applyKernelOptions())
        Q.resetframecount = 1
        let err = null, last = R.sppmStats
        const sums = [], readings = [], traces = []
        try {
            for (let done = 0; done < samples;) {
                const n = each ? 1 : Math.min(16, samples - done)
                await quietly(() => R.trace(Q, bag, n, target))
                Q.resetframecount = 0
                /* each trace's work done before the next is recorded: R.trace hands the GPU its frame and returns, and dozens
                   of frames queued on Dawn over lavapipe ended the process (a segfault, 2026-10-15) */
                await WG.device.queue.onSubmittedWorkDone()
                await landed()
                traces.push(R.batches)                                       // 2 while the map ran (photons first), else 1
                if (R.sppmStats && R.sppmStats !== last) readings.push(last = R.sppmStats)
                if ((done += n) % 16 === 0) {
                    const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array), lum = lumOf(a)
                    sums.push({ S: region.reduce((s, i) => s + lum(i) * a[i * 4 + 3], 0), C: region.reduce((s, i) => s + a[i * 4 + 3], 0) })
                }
            }
        } catch (e) { err = e?.message ?? String(e) }
        const lum = lumOf(await R.accumulation_u32.r(W * H * 16, 0, Uint32Array))
        const inRegion = region.map(lum)
        const mean = inRegion.reduce((s, v) => s + v, 0) / inRegion.length
        const se = Math.sqrt(inRegion.reduce((s, v) => s + (v - mean) ** 2, 0) / (inRegion.length - 1) / inRegion.length)
        const g = sums.map((s, k) => (s.S - (k ? sums[k - 1].S : 0)) / (s.C - (k ? sums[k - 1].C : 0)))
        const gm = g.reduce((s, v) => s + v, 0) / g.length
        const bse = g.length > 1 ? Math.sqrt(g.reduce((s, v) => s + (v - gm) ** 2, 0) / (g.length - 1) / g.length) : NaN
        const all = Array.from({ length: W * H }, (_, i) => lum(i))
        return { err, mean, se, bse, all, stats: R.sppmStats, readings, batches: R.batches, traces }
    }
    /* WITH A LENS (a 6 cm aperture, focused at the slab): its depth of field mixes the bright floor beside the slab into
       the region's edge, so the reference is the camera's own paths through the same lens -- light tracing off, so no
       photon owns anything and the camera keeps every path (lensOwned reads the sun's photons' switch) */
    const LENS = 0.03
    const t0 = Date.now()
    const cam1 = await render({ sppm: 0 }, 1024)
    const map = await render({ sppm: 1 }, 384)
    const camLens = await render({ sppm: 0, lt: 0 }, 1024, LENS)
    const mapLens = await render({ sppm: 1 }, 256, LENS)
    /* DRAFT (renderMode 1): a camera path ends at the floor it reaches through the slab, with the sun's light sample there
       -- which the slab blocks. So without the map the floor through the slab is dark, and with it the light through
       the glass comes back: the full picture's but for the bounce light (DRAFT_SHARE, below) */
    const draftOff = await render({ sppm: 0, renderMode: 1 }, 128)
    const draftMap = await render({ sppm: 1, renderMode: 1 }, 256)
    // a ratio's relative standard error: the two means' own (batch means, render above), independent runs
    const sig = (r, ref) => Math.hypot(r.bse / r.mean, ref.bse / ref.mean)
    const pm = (r, ref) => `${(r.mean / ref.mean).toFixed(4)} +- ${sig(r, ref).toFixed(4)}`
    console.log(`  the floor through the slab (${region.length} pixels), mean luminance in cd/m^2 and its standard error: camera's own`
        + ` ${cam1.mean.toFixed(0)} +- ${cam1.bse.toFixed(0)}, the photon map ${map.mean.toFixed(0)} (${pm(map, cam1)});`
        + ` through a ${2 * LENS * 100} cm lens: the camera's own ${camLens.mean.toFixed(0)} +- ${camLens.bse.toFixed(0)},`
        + ` the map ${mapLens.mean.toFixed(0)} (${pm(mapLens, camLens)});`
        + ` Draft: without the map ${draftOff.mean.toFixed(0)}, with it ${draftMap.mean.toFixed(0)} (${pm(draftMap, map)} of the map's);`
        + ` ${((Date.now() - t0) / 1000).toFixed(0)} s; the map's last sample: ${JSON.stringify(map.stats)}`)
    ok('the six renders ran', [cam1, map, camLens, mapLens, draftOff, draftMap].every(r => r.err === null),
        [cam1, map, camLens, mapLens, draftOff, draftMap].map(r => r.err).join(' | '))
    ok('...the floor through the slab is lit in the camera\'s own picture (the sun found through the glass)', cam1.mean > 100, String(cam1.mean))
    /* AGREEMENT TO THREE STANDARD ERRORS of the two means (the camera's own dominates: a path through the slab finds
       the 30 degree sun a few times in a hundred), and never looser than 4 % */
    const agree = (r, ref) => Math.abs(r.mean / ref.mean - 1) < Math.max(0.04, 3 * sig(r, ref))
    ok('the photon map\'s picture of it is the camera\'s own: the region\'s mean within three standard errors', agree(map, cam1),
        `${map.mean} against ${cam1.mean}, ${pm(map, cam1)}`)
    ok('...through a lens too', agree(mapLens, camLens), pm(mapLens, camLens))
    /* NEITHER FULL NOR CUT (0.61.2, sppm.js): the same map with room for 200 records -- the slab's sample asks about
       400, so each is kept with probability about 0.4, its power over that -- and a gather budget of 8 records (a share
       of 1 a cell), so every cell is walked by its sub-lists: the picture must not move. Before 0.61.2 the first dropped
       the stores past the capacity and the second cut the gathers short, both dark. One sample a trace, so every
       sample's header is read (below). */
    R.sppmVisit = 8
    const thin = await render({ sppm: 1, sppmCapacity: 0.0002 }, 384, 0, { each: true })
    R.sppmVisit = 0
    /* ...AND WHAT THE KEEP PROMISES (0.75.1). The keep is the room's planned fill (SPPM_FILL of it) over what the sample
       before asked: a plan, not a guarantee. raytrace_main.js says so where it is chosen: "a sample asking more than the
       one before can still overfill it, and is counted (overflow)". This check required the last sample to have
       overflowed by nothing, a bet lost in the user's run 2 of 2026-10-21 (219 kept of 200) and in one of five runs here
       (206). Measured on lavapipe (2026-10-21, 2 x 200 samples, every one read): with room for 200, a sample's kept
       count has an sd of 18 about a mean of 171, so the 15 % headroom is about 1.6 sd. One sample in twenty overflowed
       (10 of 200, twice), dropping 0.25 % of the stores kept (79 and 86 of about 34,000). At the default room of two
       million the same spread is about 0.1 %, so the headroom is over a hundred sd (inferred: the spread goes as one
       over the root of the count).
       HELD: every sample read; past the first, whose keep is a guess from the photons' count, each keeps under 0.9;
       on average they keep the planned share to 3 % (its own error is about 0.5 %, and the mean sits about 0.6 % over
       the plan: 171.0 and 171.1 measured, inferred to be the estimate's noise, since the keep goes as one over it);
       and the stores dropped past the room are under 1 % of those kept over the run. A keep the kernel ignored keeps
       about 417 a sample, and one applied twice about 70: both fail the share. A fill of 0.95 would drop about 2 % and
       fail the second (inferred, from the same spread). */
    const reads = thin.readings, planned = SPPM_FILL * (reads[0]?.capacity ?? 0)
    const keptOf = m => m.stored + m.overflow
    const after = reads.slice(1), meanKept = after.reduce((s, m) => s + keptOf(m), 0) / Math.max(1, after.length)
    const kept = reads.reduce((s, m) => s + keptOf(m), 0), dropped = reads.reduce((s, m) => s + m.overflow, 0)
    const overS = reads.filter(m => m.overflow > 0).length
    console.log(`  kept (room for ${reads[0]?.capacity}) and walked by sub-lists (a budget of 8): the map ${thin.mean.toFixed(0)} (${pm(thin, cam1)});`
        + ` ${reads.length} samples read, each past the first keeping ${meanKept.toFixed(1)} on average (planned ${planned.toFixed(1)}),`
        + ` ${overS} past the room, ${dropped} of ${kept} stores dropped (${(100 * dropped / Math.max(1, kept)).toFixed(2)} %)`)
    ok(`...kept and walked by sub-lists, the same picture: ${pm(thin, cam1)}`, thin.err === null && agree(thin, cam1),
        `${thin.err} ${thin.mean} against ${cam1.mean}`)
    ok(`...the keep as planned: ${reads.length} samples read, each past the first keeping under 0.9; ${meanKept.toFixed(1)}`
        + ` kept on average, ${planned.toFixed(1)} planned; ${(100 * dropped / Math.max(1, kept)).toFixed(2)} % of the stores dropped past the room`,
        reads.length === 384 && after.every(m => m.keep > 0 && m.keep < 0.9) && Math.abs(meanKept / planned - 1) < 0.03 && dropped < 0.01 * kept,
        JSON.stringify({ reads: reads.length, keeps: [Math.min(...after.map(m => m.keep)), Math.max(...after.map(m => m.keep))], meanKept, planned, dropped, kept }))
    ok('...photons stored, none dropped, a sample in two batches (the photons first)', map.stats?.stored > 0 && map.stats?.overflow === 0 && map.batches === 2
        && cam1.batches === 1, `${JSON.stringify(map.stats)} ${map.batches} ${cam1.batches}`)
    /* DRAFT IS THE FULL PICTURE LESS ITS BOUNCE LIGHT (0.75.1). Its camera paths end at the floor (FAST MODES), so light
       that reaches the floor under the slab by way of a second diffuse surface is the full renderer's alone: the sunlit
       floor beside the slab, and the floor under it, seen in the slab's underside. This check held Draft to the full
       picture itself within max(5 %, 3 sd), the gap "inferred: not separated", and failed whenever the noise added to the
       gap (0.9163 +- 0.0239 on lavapipe, 2026-10-21). Measured on lavapipe that day (16-sample batch means), Draft with
       the map is 0.9476 +- 0.0052 of the full picture with it (1024 samples against 1536). With the floor's albedo
       halved it is 0.9772 +- 0.0045: Draft itself halves (21198 -> 10620 cd/m^2), and the gap halves too, as
       light that met two diffuse surfaces does (albedo squared). So the gap is the bounce light, not an error of Draft's,
       and Draft is held to that share of the full map's picture, which is itself held to the camera's own above, with a
       far smaller error. */
    const DRAFT_SHARE = 0.9476, DRAFT_SHARE_SE = 0.0052
    const dr = draftMap.mean / map.mean, dsd = Math.hypot(dr * sig(draftMap, map), DRAFT_SHARE_SE)
    ok(`Draft: the floor through the slab dark without the map (the light sample blocked by the glass), and with it the full`
        + ` picture less its bounce light: ${dr.toFixed(4)} of the map's, ${DRAFT_SHARE} +- ${dsd.toFixed(4)} expected`,
        draftOff.mean < 0.05 * cam1.mean && Math.abs(dr - DRAFT_SHARE) < 3 * dsd,
        `${draftOff.mean} ${draftMap.mean} ${map.mean}`)
    // beside the slab nothing changes: the floor lit straight by the sun, the camera's and the photons' straight connections
    const meanOf = (img, ix) => ix.reduce((s, i) => s + img[i], 0) / ix.length
    ok(`...and the floor lit straight by the sun, beside the slab, is the same picture either way (${beside.length} pixels):`
        + ` ${(meanOf(map.all, beside) / meanOf(cam1.all, beside)).toFixed(4)}`,
        Math.abs(meanOf(map.all, beside) / meanOf(cam1.all, beside) - 1) < 0.02, `${meanOf(map.all, beside)} ${meanOf(cam1.all, beside)}`)

    /* MAX DIFFUSE BOUNCES (0.75.0) through the slab, at 0 and 1: the camera's own paths alone (no photons, no map) and with
       the sun's photons and the map -- each side cutting the same paths (tracebasics.js pathEnd THE DIFFUSE CAP), so one
       mean. At 0 the floor through the slab keeps the sun through the glass (one diffuse bounce, the floor's: its last
       scatter into the light) and loses what the slab's faces send back down to it.
       A CAP CUTS LIGHT, NEVER ADDS IT: the camera's own picture under it no brighter than the full one, within three of
       the two's standard errors (0.75.1). It was held under 1.04 of it, a fixed slack about one standard error of the
       difference wide (two camera renders of 1024 samples, about 3 % each: 0.9890 +- 0.040 at 1 here, seed 1), and at 1
       nearly all the light is kept, so that bet would be lost about one run in seven (inferred, from those errors). */
    for (const n of [0, 1]) {
        const own = await render({ maxDiffuse: n, sppm: 0, lt: 0 }, 1024)
        const both = await render({ maxDiffuse: n, sppm: 1 }, 384)
        console.log(`  ${n} diffuse bounce${n === 1 ? '' : 's'}: the camera's own ${own.mean.toFixed(0)} +- ${own.bse.toFixed(0)},`
            + ` with the photons and the map ${both.mean.toFixed(0)} (${pm(both, own)}); the full picture's ${pm(own, cam1)}`)
        ok(`${n} diffuse bounce${n === 1 ? '' : 's'}: the photons and the map cut what the camera's own paths cut -- one mean, ${pm(both, own)}`,
            own.err === null && both.err === null && agree(both, own) && own.mean > 100 && own.mean / cam1.mean <= 1 + 3 * sig(own, cam1),
            `${own.err} ${both.err} ${own.mean} ${both.mean} ${cam1.mean}`)
    }

    /* THE IDLE SKIP (0.61.0) on Dawn: prog_sppm's own mark (sppm.js SPPM_LOOKED), read back by R.trace. Looking through
       the slab the map stays on; looking down at the floor beside it, no glass in view, the first trace runs the map
       and finds no camera ray gathering, and every trace after it runs one chain. Each trace waits for its reading
       (render, above). Until 0.75.1 two 50 ms pauses stood for that, and the trace that had to be idle ran on a
       reading only if Dawn had delivered it in time; this check failed once in the user's runs of 2026-10-21, and passed in
       every run and 32 instrumented rounds here (alone and two at once). Which part failed then was not recorded:
       the detail below now names each. */
    const through = await render({ sppm: 1 }, 8)
    const awake = R._sppmIdle === null && through.err === null && through.traces.join() === '2'
    cam.setPose({ pos: [0.75, -0.75, 0.5], target: [0.75, -0.75, 0], up: [0, 1, 0] })
    const away = await render({ sppm: 1 }, 24)
    ok('the idle skip on Dawn: looking through the slab, a camera ray gathers and the map stays on; looking at the floor'
        + ' beside it alone, none does and it goes idle -- one batch a sample from the trace after, Render stats saying so',
        awake && away.err === null && away.traces.join() === '2,1' && R._sppmIdle !== null && /glass or a mirror/.test(R.hud.sppm?.idle ?? ''),
        JSON.stringify({ awake, through: { err: through.err, traces: through.traces }, away: { err: away.err, traces: away.traces },
                         idle: R._sppmIdle, hud: R.hud.sppm }))
}

console.log(`sppm GPU: ${pass} passed, ${fail} failed (seed ${SEED}: SPPM_GPU_SEED=${SEED} runs it again; lavapipe's threads`
    + ` LP_NUM_THREADS=${process.env.LP_NUM_THREADS})`)
process.exit(fail ? 1 : 0)
