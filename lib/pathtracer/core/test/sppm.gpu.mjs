//======================================================================================================================
// THE PHOTON MAP ON A REAL WEBGPU in node. Run: node lib/pathtracer/core/test/sppm.gpu.mjs
//
// What 0.60.0 put in the frame (core/sppm.js, wavefront.js prog_sppm), compiled by Dawn (Tint) and run:
//   - THE GATES, the WGSL's sppmStores and sppmGathers against the JS transcription (sppm.js storesJS, gathersJS) over
//     every tag a ray can carry into them, in the full renderer and the Optics view, the manifold on and off;
//   - THE WHOLE RENDERER (raytrace_main.js R.trace, every kernel, the real tinywebgpu) on a glass slab standing over a
//     white floor under a large sun, the camera looking at the floor through the slab -- light -> glass -> floor ->
//     glass -> eye, the user's case of 2026-10-15. The floor seen through the slab is drawn three ways, which must
//     agree: the camera's own paths (the map off, no lens: they find the sun through the glass by chance -- a 20 degree
//     sun, so they do), the photon map, and the lens's photons through a lens (the map off). The map's picture is
//     a little blurred at first and its mean over the region must still be the camera's.
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
const { FACE_TABLE, PROCESSING } = await import('../tracebasics.js')
const { SPPM_WGSL, storesJS, gathersJS, TAGS } = await import('../sppm.js')
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
        for (const bounces of [0, 1, 2, 9, 10]) for (const n of [1, 1.5]) {
            const tag = (photon ? T.PHOTON : 0) | (f << (photon ? T.PH_SHIFT : T.CAM_SHIFT)) | extra
            cases.push({ tag, bounces, n })
        }
    const N = cases.length
    const words = new Uint32Array(N * 4)
    cases.forEach((c, i) => { words[i * 4] = c.tag; words[i * 4 + 1] = c.bounces; words[i * 4 + 2] = new Uint32Array(new Float32Array([c.n]).buffer)[0] })
    const inBuf = WG.createStorageBuffer(words)
    const outBuf = WG.createStorageBuffer(N * 8)
    const k = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}${SPPM_WGSL}`, /*wgsl*/`
        let i = gid.x;
        if (i >= arrayLength(&cases) / 4u) { return; }
        // every binding the text names reached from main (layout 'auto' keeps only those: check-shaders says why)
        if (i == 0xFFFFFFFFu) { atomicAdd(&learn[0], 0u); atomicAdd(&sppmHeads[0], 0u); sppmRecs[0] = 0u; }
        var r: Ray;
        r.tag = cases[i * 4u];
        r.bounces = cases[i * 4u + 1u];
        r.n = bitcast<f32>(cases[i * 4u + 2u]);
        out[i * 2u] = select(0u, 1u, sppmStores(r));
        out[i * 2u + 1u] = select(0u, 1u, sppmGathers(r));
    `, U.ComputeUniformTypes, { cases: 'array<u32>', out: 'array<u32>', learn: 'array<atomic<u32>>',
        sppmHeads: 'array<atomic<u32>>', sppmRecs: 'array<u32>' })
    await k.ready
    k.resources = { cases: inBuf.b, out: outBuf.b, learn: WG.createStorageBuffer(16).b, sppmHeads: WG.createStorageBuffer(16).b,
                    sppmRecs: WG.createStorageBuffer(16).b }
    for (const [label, mode, manifold] of [['the full renderer', 0, 0], ['the full renderer, the manifold on', 0, 1], ['the Optics view', 3, 0]]) {
        k.uniforms = { renderMode: mode, manifold, maxbounce: 10, camtype: 0, measureMode: 0, sppmCtl: [1, 1000, 0, 0] }
        k.run(N, 1, 1)
        const got = await outBuf.r(N * 8, 0, Uint32Array)
        const bad = cases.filter((c, i) => (got[i * 2] === 1) !== storesJS(c.tag, c.bounces, 10, { optics: mode === 3 })
            || (got[i * 2 + 1] === 1) !== gathersJS(c.tag, c.bounces, c.n, { manifold: manifold === 1 }))
        const stores = cases.filter((c, i) => got[i * 2] === 1).length, gathers = cases.filter((c, i) => got[i * 2 + 1] === 1).length
        ok(`the gates on Dawn, ${label}: the WGSL's store and gather answer as the JS's, every one of ${N} rays (${stores} stored, ${gathers} gathering)`,
            bad.length === 0 && stores > 0 && gathers > 0, JSON.stringify(bad.slice(0, 4)))
    }
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
                    skyIlluminance: 0, nee: 1, lt: 1, ltPhotons: 4, ltLearn: 0, maxbounce: 10, rr: 0, manifold: 0, fireflyClamp: 0,
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
    const lensRun = await render({ sppm: 0 }, 384, LENS)
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
        + ` through a ${2 * LENS * 100} cm lens: the camera's own ${camLens.mean.toFixed(0)} +- ${camLens.se.toFixed(0)}, the lens's photons`
        + ` ${lensRun.mean.toFixed(0)} (${pm(lensRun, camLens)}), the map ${mapLens.mean.toFixed(0)} (${pm(mapLens, camLens)});`
        + ` Draft: without the map ${draftOff.mean.toFixed(0)}, with it ${draftMap.mean.toFixed(0)} (${pm(draftMap, cam1)});`
        + ` ${((Date.now() - t0) / 1000).toFixed(0)} s; the map's last sample: ${JSON.stringify(map.stats)}`)
    ok('the seven renders ran', [cam1, map, camLens, lensRun, mapLens, draftOff, draftMap].every(r => r.err === null),
        [cam1, map, camLens, lensRun, mapLens, draftOff, draftMap].map(r => r.err).join(' | '))
    ok('...the floor through the slab is lit in the camera\'s own picture (the sun found through the glass)', cam1.mean > 100, String(cam1.mean))
    /* AGREEMENT TO THREE STANDARD ERRORS of the two means (the camera's own dominates: a path through the slab finds
       the 30 degree sun a few times in a hundred), and never looser than 4 % */
    const agree = (r, ref) => Math.abs(r.mean / ref.mean - 1) < Math.max(0.04, 3 * Math.hypot(r.se / r.mean, ref.se / ref.mean))
    ok('the photon map\'s picture of it is the camera\'s own: the region\'s mean within three standard errors', agree(map, cam1),
        `${map.mean} against ${cam1.mean}, ${pm(map, cam1)}`)
    ok('...through a lens too: the map\'s and the lens\'s photons\' (the map off) each the camera\'s own',
        agree(mapLens, camLens) && agree(lensRun, camLens), `${pm(mapLens, camLens)} ${pm(lensRun, camLens)}`)
    ok('...photons stored, none dropped, a sample in two batches (the photons first)', map.stats?.stored > 0 && map.stats?.overflow === 0 && map.batches === 2
        && cam1.batches === 1, `${JSON.stringify(map.stats)} ${map.batches} ${cam1.batches}`)
    ok('Draft: the floor through the slab dark without the map (the light sample blocked by the glass), the full picture\'s with it',
        draftOff.mean < 0.05 * cam1.mean && Math.abs(draftMap.mean / cam1.mean - 1) < Math.max(0.05, 3 * Math.hypot(draftMap.se / draftMap.mean, cam1.se / cam1.mean)),
        `${draftOff.mean} ${draftMap.mean} ${cam1.mean}`)
    // beside the slab nothing changes: the floor lit straight by the sun, the camera's and the photons' straight connections
    const meanOf = (img, ix) => ix.reduce((s, i) => s + img[i], 0) / ix.length
    ok(`...and the floor lit straight by the sun, beside the slab, is the same picture either way (${beside.length} pixels)`,
        Math.abs(meanOf(map.all, beside) / meanOf(cam1.all, beside) - 1) < 0.02, `${meanOf(map.all, beside)} ${meanOf(cam1.all, beside)}`)
}

console.log(`sppm GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
