//======================================================================================================================
// MAX DIFFUSE BOUNCES IN THE KERNELS, on a real WebGPU in node. Run: node lib/pathtracer/core/test/diffuse.gpu.mjs
//
// What 0.75.0 put in the shaders (tracebasics.js pathEnd THE DIFFUSE CAP, materials_pbr.js diffuseLeft; the cap
// UB.diffuseCap, photometry.js diffuseCapOf), compiled by Dawn (Tint):
//   - A HIT SHADED in prog_shade's own phases (pathBegin, pathPrelude, pathMiddle, pathEnd), thread by thread, at every cap
//     (none, 1 and 2) and diffuse bounces so far (Ray.counts' high half):
//       a camera path with one left: its light sample, an EV_EVAL draw counted and going on;
//       with none left (capped): no light sample, an EV_EVAL draw ending it, a mirror's or a near-mirror's going on with
//         the count kept and nothing it meets shared by MIS (prevPdf -1, sunmis 1);
//       a light's photon connecting only with one left, and ending once it has none; a sun's photon as before; the
//         Optics page's own rays never cut; and the march steps (the low half) kept through all of it.
//   - THE WHOLE RENDERER (raytrace_main.js R.trace, every kernel, the real tinywebgpu) on a white floor and a white wall
//     under a 30 degree sun and a black sky:
//       0 diffuse bounces is the direct light alone -- Draft's picture, by another road (Draft's light sample at weight 1,
//         this one's by MIS with the bounce that finds the sun);
//       at 0 and at 1, light sampling off reads what it reads on: the capped vertex's missing light sample is no light
//         lost, and none counted twice -- it would be brighter on if a capped vertex still sampled one;
//       each bounce more no darker, the default (no cap) brighter still.
//
// No picture: what a room looks like is the user's to judge (CLAUDE.md). OPTIONAL, AND LOUD ABOUT IT: the `webgpu`
// package (npm i -g webgpu) and a Vulkan driver (lavapipe: apt-get install mesa-vulkan-drivers).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(diffuse bounces GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { SHADE_PRELUDE } = await import('../scene_api.js')
const { MATERIALS_PBR } = await import('../materials_pbr.js')
const { FACE_TABLE, PROCESSING, LEARN_WORDS, SHADE_ITEM_BYTES } = await import('../tracebasics.js')
const { counterstruct } = await import('../wavefront.js')
const { MF_WORDS } = await import('../microfacet.js')
const U = await import('../uniforms.schema.js')
const { derive, diffuseCapOf, LUMA } = await import('../photometry.js')
const { effective } = await import('../../quality.js')
const { RAYTRACER } = await import('../raytrace_main.js')
const { engineCamera } = await import('../units.js')
const { CAMERA } = await import('../../../camera.js')
const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])            // kept: the Dawn instance must outlive the device (scenedata.gpu.mjs)
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(diffuse bounces GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }
const buf = n => WG.createStorageBuffer(Math.max(n, 256))

/*----------------------------------------------------------------------------------------------------------------------
  A HIT SHADED, thread by thread: a ray of a tag and diffuse bounces so far onto a surface at the origin, facing up
----------------------------------------------------------------------------------------------------------------------*/
{
    const TAG = { PHOTON: 1, PASSED: 4, OPTIC: 128, LTALL: 256 }
    const EV = { DELTA: 1, EVAL: 2, OTHER: 3 }
    const STEPS = 37                                   // march steps so far, which every case must keep
    /* THE SURFACES: 0 a white diffuse; 1 a mirror (metal, smooth: delta only); 2 a smooth plastic (its reflection drawn as
       an evaluable lobe here, every one of 256: what is held is the rule, whatever it draws); 3 a near-mirror metal
       (roughness 0.1, alpha 0.01, under LT_MIN_ALPHA: EV_OTHER) */
    const KINDS = ['a white diffuse', 'a mirror', 'a smooth plastic', 'a near-mirror metal']
    const WHO = { camera: 0, light: TAG.PHOTON | TAG.OPTIC | TAG.LTALL, sun: TAG.PHOTON | TAG.PASSED, page: TAG.PHOTON | TAG.OPTIC }
    const cases = []
    for (const d of [0, 1, 2]) {
        for (let kind = 0; kind < KINDS.length; kind++) cases.push({ who: 'camera', d, kind })
        for (const who of ['light', 'page']) cases.push({ who, d, kind: 0 })
    }
    cases.push({ who: 'sun', d: 0, kind: 0 })
    const PER = 256, OUTW = 8
    const io = new Uint32Array(cases.length * 4 + cases.length * PER * OUTW)
    cases.forEach((c, i) => { io[i * 4] = WHO[c.who]; io[i * 4 + 1] = c.d; io[i * 4 + 2] = c.kind; io[i * 4 + 3] = STEPS })
    const OUT = cases.length * 4
    const prog = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}`, /*wgsl*/`
    // every binding the text names reached from main, as tinywebgpu binds them (check-shaders pass two says why)
    if (gid.x == 0xffffffffu) {
        _ = &marchBuffer0; _ = &marchBuffer1; _ = &shadeBuffer; _ = &frame_u32; _ = &shadowBuffer0; _ = &shadowBuffer1;
        _ = &counters; _ = &learn; _ = UB.res;
    }
    let c = gid.y;
    let j = gid.x;
    if (c >= ${cases.length}u || j >= ${PER}u) { return; }
    SEED_uvec4(vec4<u32>(31u, 37u, 41u, 43u));
    SEED_u32(j);
    SEED_u32(c);
    let tag = io[c * 4u];
    let d = io[c * 4u + 1u];
    let kind = io[c * 4u + 2u];
    var r = newRay(VEC3(0.0, 0.0, 0.0), normalize(VEC3(0.3, 0.1, -1.0)), VEC4(1.0), 1.0);
    r.radiance = VEC3(1.0);
    r.tag = tag;
    r.bounces = 1u;                                     // its second surface: past a camera path's first-surface rules
    r.pix = 0xFFFFFFFFu;                                // no sun-map cell
    r.counts = io[c * 4u + 3u] + d * DIFFUSE_ONE;
    let h = Hit(r, VEC4(0.0, 0.0, 1.0, 1e-4), 1u, 0u, -1.0e7);
    var m = makeDiffuse(VEC3(0.8), 1.0);
    if (kind == 1u) { m = makeDefaultMaterial(); m.baseColor = VEC3(0.9); m.metallic = 1.0; m.roughness = 0.0; }
    if (kind == 2u) { m = makeDefaultMaterial(); m.baseColor = VEC3(0.8); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.5; m.transmission = 0.0; }
    if (kind == 3u) { m = makeDefaultMaterial(); m.baseColor = VEC3(0.9); m.metallic = 1.0; m.roughness = 0.1; }
    var st = pathBegin(h);
    st.nrm = VEC3(0.0, 0.0, 1.0);
    st = pathPrelude(st);
    st.m = m;
    st = pathMiddle(st);
    if (st.go && st.askMedium) { st.n1 = 1.5; st.mu1 = VEC3(0.0); st.v1 = 0.0; }
    let e = pathEnd(st);
    // a camera path's light sample or a photon's connection: either rides NEE_RAY (pathMiddle, processMaterial_advanced)
    let o = ${OUT}u + (c * ${PER}u + j) * ${OUTW}u;
    io[o] = select(0u, 1u, e.state == RAY_ACTIVE);
    io[o + 1u] = select(0u, 1u, e.state == RAY_TERMINATED);
    io[o + 2u] = select(0u, 1u, NEE_VALID);
    io[o + 3u] = LAST_EVENT;
    io[o + 4u] = rayDiffuse(e);
    io[o + 5u] = raySteps(e);
    io[o + 6u] = bitcast<u32>(e.prevPdf);
    io[o + 7u] = bitcast<u32>(e.sunmis);
    `,
    U.ComputeUniformTypes,
    { marchBuffer0: 'array<Ray>', marchBuffer1: 'array<Ray>', shadeBuffer: 'array<ShadeItem>', frame_u32: 'array<atomic<u32>>',
      shadowBuffer0: 'array<Ray>', shadowBuffer1: 'array<Ray>', learn: 'array<atomic<u32>>', counters: counterstruct,
      io: 'array<u32>' },
    { wg: [64, 1, 1], async: false })
    const ioBuf = buf(io.byteLength)
    prog.resources = { marchBuffer0: buf(112).b, marchBuffer1: buf(112).b, shadeBuffer: buf(SHADE_ITEM_BYTES).b, frame_u32: buf(16).b,
        shadowBuffer0: buf(112).b, shadowBuffer1: buf(112).b, learn: buf(4 * (LEARN_WORDS + MF_WORDS)).b, counters: buf(64).b,
        io: ioBuf.b }
    // THE CAMERA, so a photon's connection lands in the picture: the real lib/camera.js through engineCamera
    const W = 48, H = 32
    const cam = CAMERA({ aspect: W / H, fov: 50, near: 0.01, far: 4000, up: [0, 0, 1] })
    cam.set({ mode: 'orbit', azimuth: 30, elevation: 60, distance: 3, target: [0, 0, 0] })
    const E = engineCamera(cam.getUniforms(), 0, 1)
    const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer)
    const asF = u => { u32[0] = u; return f32[0] }
    for (const cap of [0, 1, 2]) {
        ioBuf.w(io)
        /* every one named: a write merges (toolkit layout.test). A uniform sky (envUniform) for the light sample, no sun,
           the photon map off; diffuseCap the cap as the kernels take it (0 none) */
        prog.uniforms = { res: [W, H], camtype: 0, camPos: E.camPos, invView: E.invView, invProjection: E.invProjection, camLens: E.camLens,
                          measureMode: 0, renderMode: 0, lastpass: 0, maxbounce: 10, rr: 0, nee: 1, envUniform: 1000,
                          sppmCtl: [0, 0, 0, 0], diffuseCap: cap }
        prog.dispatch(PER / 64, cases.length, 1)
        const g = await ioBuf.r(Uint32Array)
        const rows = c => Array.from({ length: PER }, (_, j) => {
            const o = OUT + (cases.indexOf(c) * PER + j) * OUTW
            return { active: g[o] === 1, ended: g[o + 1] === 1, nee: g[o + 2] === 1, ev: g[o + 3], d: g[o + 4], steps: g[o + 5],
                     prevPdf: asF(g[o + 6]), sunmis: asF(g[o + 7]) }
        })
        const capName = cap ? `a cap of ${cap} (${cap - 1} diffuse bounce${cap === 2 ? '' : 's'})` : 'no cap'
        for (const c of cases) {
            const R = rows(c), left = cap === 0 || c.d + 1 <= cap
            const name = `${capName}: ${c.who === 'camera' ? `a camera path at ${KINDS[c.kind]}` : c.who === 'light' ? 'a light\'s photon'
                : c.who === 'sun' ? 'a sun\'s photon past glass' : 'the Optics page\'s ray'}, ${c.d} diffuse bounce${c.d === 1 ? '' : 's'} so far`
            const steps = R.every(x => x.steps === STEPS)
            if (c.who === 'camera' && cap !== 0 && c.d > cap) {
                /* OVER THE CAP ALREADY: no path arrives so (one over ends, pathEnd), and one made so ends whatever it draws */
                ok(`${name}: over the cap already (no path gets there) -- no light sample, and it ends whatever it draws`,
                    R.every(x => x.ended && !x.nee) && steps, JSON.stringify(R.slice(0, 2)))
            } else if (c.who === 'camera') {
                const evals = R.filter(x => x.ev === EV.EVAL), others = R.filter(x => x.ev !== EV.EVAL)
                const evalOk = evals.every(x => x.d === c.d + 1 && (left ? x.active : x.ended))
                const otherOk = others.every(x => x.d === c.d && x.active && (left || (x.prevPdf === -1 && x.sunmis === 1)))
                const neeShare = R.filter(x => x.nee).length / PER
                // a light sample where one is left and the surface has a lobe to evaluate; none where none is left
                const neeOk = !left ? neeShare === 0 : (c.kind === 0 || c.kind === 2) ? neeShare > 0.9 : true
                // ...and with one left, what the near-mirror goes on to meet is shared with its light sample, by MIS
                const misOk = !(left && c.kind === 3) || others.every(x => x.prevPdf >= 0)
                ok(`${name}: ${left ? 'a light sample, and an EV_EVAL draw counted and going on' : 'CAPPED: no light sample, an EV_EVAL draw ending it, the rest going on unshared'}`,
                    evalOk && otherOk && neeOk && misOk && steps && (c.kind !== 0 || evals.length === PER) && (c.kind !== 1 || others.length === PER)
                        && (c.kind !== 3 || others.length === PER && others.every(x => x.ev === EV.OTHER)),
                    JSON.stringify({ evalOk, otherOk, neeShare, misOk, steps, evals: evals.length, sample: R.slice(0, 2) }))
            } else if (c.who === 'light') {
                const conn = R.filter(x => x.nee).length / PER
                const endOk = R.every(x => x.ev === EV.EVAL && x.d === c.d + 1 && (cap !== 0 && x.d >= cap ? x.ended : x.active))
                ok(`${name}: ${left ? 'connects' : 'does not connect'}, and ${cap !== 0 && c.d + 1 >= cap ? 'ends, none left' : 'walks on'}`,
                    (left ? conn > 0.99 : conn === 0) && endOk && steps, JSON.stringify({ conn, endOk, steps, sample: R.slice(0, 2) }))
            } else if (c.who === 'sun') {
                const conn = R.filter(x => x.nee).length / PER
                ok(`${name}: connects, and ends at its first scatter, as before`, conn > 0.99 && R.every(x => x.ended) && steps,
                    JSON.stringify({ conn, sample: R.slice(0, 2) }))
            } else {
                ok(`${name}: never cut -- it walks on through the diffuse lobe`, R.every(x => x.active && x.ev === EV.EVAL) && steps,
                    JSON.stringify(R.slice(0, 2)))
            }
        }
    }
}

/*----------------------------------------------------------------------------------------------------------------------
  THE WHOLE RENDERER: a white floor and a white wall under a 30 degree sun and a black sky
----------------------------------------------------------------------------------------------------------------------*/
{
    const W = 32, H = 32
    const scene = {
        id: 'diffuse-gpu', title: 'a floor and a wall', unit: 'm', extent: 2, envRadius: 1.6, uniforms: {},
        wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    return makeDiffuse(vec3<f32>(0.8), 1.0);
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.0, -0.05), VEC3(1.0, 1.0, 0.05)), 4u);
    C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.6, 0.5), VEC3(1.0, 0.05, 0.5)), 4u);
    return C;
}`,
    }
    const Q = { w: W, h: H, resetframecount: 1 }
    const R = RAYTRACER(WG, null, Q, scene)
    R.hud = () => { }
    let initErr = null
    try { await quietly(() => R.init()) } catch (e) { initErr = e?.message ?? String(e) }
    ok('the renderer on Dawn: built', initErr === null && R._built === true, initErr)
    const cam = CAMERA({ aspect: W / H, fov: 55, up: [0, 0, 1] })
    cam.setPose({ pos: [0.3, -1.4, 0.9], target: [0, 0.3, 0.25], up: [0, 0, 1] })
    const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
    // the sun from behind the camera (the azimuth from +y towards +x), lighting the wall's face and the floor before it
    const bagOf = over => {
        const v = { ...U.defaultUniformValues(), envMode: 0, uSunElevation: 45, uSunAzimuth: 165, sunDiameter: 30, sunIlluminance: 100000,
                    skyIlluminance: 0, nee: 1, lt: 1, ltPhotons: 1, ltLearn: 0, maxbounce: 10, rr: 0, fireflyClamp: 0,
                    maxaverages: 0, autoExposure: 0, sppm: 0, ...over }
        const traced = effective(v)
        const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius })
        const EC = engineCamera(cam.getUniforms(), 0, derived.sceneUnit)
        return Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
            ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
            .filter(([k]) => k in U.ComputeUniformTypes || k in U.UniformSpec))
    }
    ok('the default, 40 against 10 bounces, sends no cap: the kernels trace what they always did', bagOf({}).diffuseCap === 0
        && bagOf({ maxDiffuse: 0 }).diffuseCap === 1 && bagOf({ maxDiffuse: 1 }).diffuseCap === 2 && diffuseCapOf({ maxDiffuse: 10, maxbounce: 10 }) === 0)
    const render = async (over, samples) => {
        const bag = bagOf(over)
        R.kernelOptions = R.kernelOptionsOf(bag)
        await quietly(() => R.applyKernelOptions())
        Q.resetframecount = 1
        let err = null
        try {
            await quietly(() => R.trace(Q, bag, 1, target))
            Q.resetframecount = 0
            // each trace's work done before the next is recorded (sppm.gpu.mjs: dozens queued on lavapipe ended the process)
            for (let done = 1; done < samples; done += 16) {
                await quietly(() => R.trace(Q, bag, Math.min(16, samples - done), target))
                await WG.device.queue.onSubmittedWorkDone()
            }
        } catch (e) { err = e?.message ?? String(e) }
        const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
        const f = new Float32Array(a.buffer, a.byteOffset, a.length)
        return { err, img: Array.from({ length: W * H }, (_, i) => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]) }
    }
    /* TWO PICTURES PIXEL BY PIXEL (haze.gpu.mjs paired): the region's mean of a over b's, its error from the spread of
       the pixels' differences, each pixel's own noise and not the picture's structure */
    const paired = (a, b, ix) => {
        const n = ix.length, mb = ix.reduce((s, i) => s + b[i], 0) / n
        const d = ix.map(i => a[i] - b[i]), md = d.reduce((s, x) => s + x, 0) / n
        return { mean: 1 + md / mb, se: Math.sqrt(d.reduce((s, x) => s + (x - md) ** 2, 0) / (n - 1) / n) / mb }
    }
    const agree = (p, floor = 0.02) => Math.abs(p.mean - 1) < Math.max(floor, 3.5 * p.se)
    const pm = p => `${p.mean.toFixed(4)} +- ${p.se.toFixed(4)}`
    const t0 = Date.now()
    const full = await render({}, 512)
    const draft = await render({ renderMode: 1 }, 256)
    const n0 = await render({ maxDiffuse: 0 }, 512), n0off = await render({ maxDiffuse: 0, nee: 0 }, 2048)
    const n1 = await render({ maxDiffuse: 1 }, 512), n1off = await render({ maxDiffuse: 1, nee: 0 }, 2048)
    const all = [full, draft, n0, n0off, n1, n1off]
    ok('the six renders ran', all.every(r => r.err === null), all.map(r => r.err).join(' | '))
    const peak = Math.max(...full.img)
    const region = full.img.map((v, i) => [v, i]).filter(([v]) => v > 0.05 * peak).map(([, i]) => i)
    const z = paired(n0.img, draft.img, region), zOff = paired(n0off.img, n0.img, region), oOff = paired(n1off.img, n1.img, region)
    const step1 = paired(n1.img, n0.img, region), stepAll = paired(full.img, n1.img, region)
    console.log(`  a floor and a wall (${region.length} pixels lit), ${((Date.now() - t0) / 1000).toFixed(0)} s: 0 diffuse bounces ${pm(z)} of Draft;`
        + ` light sampling off ${pm(zOff)} of on at 0, ${pm(oOff)} at 1; 1 bounce ${pm(step1)} of 0, no cap ${pm(stepAll)} of 1`)
    ok(`0 diffuse bounces is the direct light alone: Draft's picture, ${pm(z)}`, region.length > 200 && agree(z), pm(z))
    ok(`...light sampling off reads what it reads on, at 0 (${pm(zOff)}) and at 1 (${pm(oOff)}): a capped vertex samples no light`,
        agree(zOff) && agree(oOff), `${pm(zOff)} ${pm(oOff)}`)
    ok(`...a bounce more is brighter (the wall's light on the floor, the floor's on the wall), ${pm(step1)}, and no cap brighter still, ${pm(stepAll)}`,
        step1.mean > 1 + 3 * step1.se && stepAll.mean > 1 + 3 * stepAll.se, `${pm(step1)} ${pm(stepAll)}`)
}

console.log(`diffuse bounces GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
