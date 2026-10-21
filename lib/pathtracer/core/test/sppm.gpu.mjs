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
// OPTIONAL, AND LOUD ABOUT IT: the `webgpu` package (npm i -g webgpu) and a Vulkan driver (lavapipe). A software
// adapter's speed says nothing about a card's (CLAUDE.md): this times nothing.
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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
const { SPPM_WGSL, storesJS, gathersJS, allLobesJS, TAGS } = await import('../sppm.js')
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

    const render = async (over, samples, lens = 0) => {
        const bag = bagOf(over, lens)
        R.kernelOptions = R.kernelOptionsOf(bag)
        await quietly(() => R.applyKernelOptions())
        Q.resetframecount = 1
        let err = null
        try {
            await quietly(() => R.trace(Q, bag, 1, target))
            Q.resetframecount = 0
            /* each trace's work done before the next is recorded: R.trace hands the GPU its frame and returns, and dozens
               of frames queued on Dawn over lavapipe ended the process (a segfault, 2026-10-15) */
            for (let done = 1; done < samples; done += 16) {
                await quietly(() => R.trace(Q, bag, Math.min(16, samples - done), target))
                await WG.device.queue.onSubmittedWorkDone()
            }
        } catch (e) { err = e?.message ?? String(e) }
        const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
        const f = new Float32Array(a.buffer, a.byteOffset, a.length)
        const lum = i => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]
        const inRegion = region.map(lum)
        const mean = inRegion.reduce((s, v) => s + v, 0) / inRegion.length
        /* the region mean's standard error, from its pixels' spread: right for the camera's own paths, each pixel its own;
           the map's pixels share their photons, so for it this is a floor, not the error */
        const se = Math.sqrt(inRegion.reduce((s, v) => s + (v - mean) ** 2, 0) / (inRegion.length - 1) / inRegion.length)
        const all = Array.from({ length: W * H }, (_, i) => lum(i))
        return { err, mean, se, all, stats: R.sppmStats, batches: R.batches }
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
       the glass comes back: the full picture's but for the bounce light, which on a bare floor under a slab is the
       little the slab's faces send back down (inferred: not separated here) */
    const draftOff = await render({ sppm: 0, renderMode: 1 }, 128)
    const draftMap = await render({ sppm: 1, renderMode: 1 }, 256)
    const pm = (r, ref) => `${(r.mean / ref.mean).toFixed(4)} +- ${(Math.hypot(r.se / r.mean, ref.se / ref.mean)).toFixed(4)}`
    console.log(`  the floor through the slab (${region.length} pixels), mean luminance in cd/m^2 and its standard error: camera's own`
        + ` ${cam1.mean.toFixed(0)} +- ${cam1.se.toFixed(0)}, the photon map ${map.mean.toFixed(0)} (${pm(map, cam1)});`
        + ` through a ${2 * LENS * 100} cm lens: the camera's own ${camLens.mean.toFixed(0)} +- ${camLens.se.toFixed(0)},`
        + ` the map ${mapLens.mean.toFixed(0)} (${pm(mapLens, camLens)});`
        + ` Draft: without the map ${draftOff.mean.toFixed(0)}, with it ${draftMap.mean.toFixed(0)} (${pm(draftMap, cam1)});`
        + ` ${((Date.now() - t0) / 1000).toFixed(0)} s; the map's last sample: ${JSON.stringify(map.stats)}`)
    ok('the six renders ran', [cam1, map, camLens, mapLens, draftOff, draftMap].every(r => r.err === null),
        [cam1, map, camLens, mapLens, draftOff, draftMap].map(r => r.err).join(' | '))
    ok('...the floor through the slab is lit in the camera\'s own picture (the sun found through the glass)', cam1.mean > 100, String(cam1.mean))
    /* AGREEMENT TO THREE STANDARD ERRORS of the two means (the camera's own dominates: a path through the slab finds
       the 30 degree sun a few times in a hundred), and never looser than 4 % */
    const agree = (r, ref) => Math.abs(r.mean / ref.mean - 1) < Math.max(0.04, 3 * Math.hypot(r.se / r.mean, ref.se / ref.mean))
    ok('the photon map\'s picture of it is the camera\'s own: the region\'s mean within three standard errors', agree(map, cam1),
        `${map.mean} against ${cam1.mean}, ${pm(map, cam1)}`)
    ok('...through a lens too', agree(mapLens, camLens), pm(mapLens, camLens))
    /* NEITHER FULL NOR CUT (0.61.2, sppm.js): the same map with room for 200 records -- the slab's sample asks about
       400, so each is kept with probability about 0.4, its power over that -- and a gather budget of 8 records (a share
       of 1 a cell), so every cell is walked by its sub-lists: the picture must not move. Before 0.61.2 the first dropped
       the stores past the capacity and the second cut the gathers short, both dark. */
    R.sppmVisit = 8
    const thin = await render({ sppm: 1, sppmCapacity: 0.0002 }, 384)
    R.sppmVisit = 0
    console.log(`  kept (room for 200) and walked by sub-lists (a budget of 8): the map ${thin.mean.toFixed(0)} (${pm(thin, cam1)}); its last sample: ${JSON.stringify(thin.stats)}`)
    ok(`...kept and walked by sub-lists, the same picture: ${pm(thin, cam1)}; ${JSON.stringify(thin.stats)}`,
        thin.err === null && agree(thin, cam1) && thin.stats?.keep < 0.9 && thin.stats?.keep > 0 && thin.stats?.overflow === 0,
        `${thin.err} ${JSON.stringify(thin.stats)}`)
    ok('...photons stored, none dropped, a sample in two batches (the photons first)', map.stats?.stored > 0 && map.stats?.overflow === 0 && map.batches === 2
        && cam1.batches === 1, `${JSON.stringify(map.stats)} ${map.batches} ${cam1.batches}`)
    ok('Draft: the floor through the slab dark without the map (the light sample blocked by the glass), the full picture\'s with it',
        draftOff.mean < 0.05 * cam1.mean && Math.abs(draftMap.mean / cam1.mean - 1) < Math.max(0.05, 3 * Math.hypot(draftMap.se / draftMap.mean, cam1.se / cam1.mean)),
        `${draftOff.mean} ${draftMap.mean} ${cam1.mean}`)
    // beside the slab nothing changes: the floor lit straight by the sun, the camera's and the photons' straight connections
    const meanOf = (img, ix) => ix.reduce((s, i) => s + img[i], 0) / ix.length
    ok(`...and the floor lit straight by the sun, beside the slab, is the same picture either way (${beside.length} pixels)`,
        Math.abs(meanOf(map.all, beside) / meanOf(cam1.all, beside) - 1) < 0.02, `${meanOf(map.all, beside)} ${meanOf(cam1.all, beside)}`)

    /* MAX DIFFUSE BOUNCES (0.75.0) through the slab, at 0 and 1: the camera's own paths alone (no photons, no map) and with
       the sun's photons and the map -- each side cutting the same paths (tracebasics.js pathEnd THE DIFFUSE CAP), so one
       mean. At 0 the floor through the slab keeps the sun through the glass (one diffuse bounce, the floor's: its last
       scatter into the light) and loses what the slab's faces send back down to it. */
    for (const n of [0, 1]) {
        const own = await render({ maxDiffuse: n, sppm: 0, lt: 0 }, 1024)
        const both = await render({ maxDiffuse: n, sppm: 1 }, 384)
        console.log(`  ${n} diffuse bounce${n === 1 ? '' : 's'}: the camera's own ${own.mean.toFixed(0)} +- ${own.se.toFixed(0)},`
            + ` with the photons and the map ${both.mean.toFixed(0)} (${pm(both, own)}); the full picture's ${(own.mean / cam1.mean).toFixed(4)}`)
        ok(`${n} diffuse bounce${n === 1 ? '' : 's'}: the photons and the map cut what the camera's own paths cut -- one mean, ${pm(both, own)}`,
            own.err === null && both.err === null && agree(both, own) && own.mean > 100 && own.mean <= cam1.mean * 1.04,
            `${own.err} ${both.err} ${own.mean} ${both.mean} ${cam1.mean}`)
    }

    /* THE IDLE SKIP (0.61.0) on Dawn: prog_sppm's own mark (sppm.js SPPM_LOOKED), read back by R.trace. Looking through
       the slab the map stays on; looking down at the floor beside it, no glass in view, it goes idle and the traces after
       run one chain. */
    const settle = () => new Promise(r => setTimeout(r, 50))
    const through = await render({ sppm: 1 }, 8)
    await settle()
    const awake = R._sppmIdle === null && through.batches === 2
    cam.setPose({ pos: [0.75, -0.75, 0.5], target: [0.75, -0.75, 0], up: [0, 1, 0] })
    const away = await render({ sppm: 1 }, 24)
    await settle()
    ok('the idle skip on Dawn: looking through the slab, a camera ray gathers and the map stays on; looking at the floor'
        + ' beside it alone, none does and it goes idle -- one batch a sample, Render stats saying so',
        awake && away.err === null && R._sppmIdle !== null && away.batches === 1 && /glass or a mirror/.test(R.hud.sppm?.idle ?? ''),
        `${awake} ${away.err} ${JSON.stringify(R._sppmIdle)} ${away.batches} ${JSON.stringify(R.hud.sppm)}`)
}

console.log(`sppm GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
