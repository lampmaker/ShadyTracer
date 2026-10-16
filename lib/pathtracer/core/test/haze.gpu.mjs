//======================================================================================================================
// THE HAZE BOX ON A REAL WEBGPU in node (core/haze.js, 0.62.0). Run: node lib/pathtracer/core/test/haze.gpu.mjs
//
// What the kernels' haze does, compiled by Dawn (Tint) and run:
//   - THE FUNCTIONS against their JS mirrors (haze.test.mjs holds those): the box's stretch, Henyey-Greenstein's value and
//     its draw, a leg's collision -- its probability and where it puts the ray, and the rays it must leave alone (glass, a
//     probe, a seek ray, the illuminance view's camera) -- and the haze a shadow ray is given from its vertex;
//   - THE WHOLE RENDERER (raytrace_main.js R.trace, every kernel, the real tinywebgpu), hand-written scenes:
//       a FURNACE: an albedo-1 haze box under a uniform sky reads the sky everywhere (multiple scattering, light sampling
//         from the air against the phase function's draw, the uniform sphere's density for the sky); albedo 0.5 does not;
//       SUNLIT DUST against a black sky, seen side on: single scattering (maxbounce 1, and Draft) the integral along each
//         pixel's ray of sigma_s p E T T, per pixel; the full renderer at least that;
//       a box INSIDE A GLASS BLOCK, absorbing, in a furnace: the block reads the sky's 1 -- the air scatters, the glass
//         does not; the same box a fifth bigger than the block does dim it;
//       DUST UNDER A GLASS SLAB (sppm.gpu.mjs's scene): the sun's photons on or off, the photon map on or off -- the same
//         mean, where a medium vertex counted as the map's D would have handed light to a map that holds none;
//       DUST OVER A MIRROR in a 20 degree sun: the sun's photons off the mirror connecting from the air (ltConnectMedium:
//         the volume's footprint) against the camera's own paths finding the sun in the mirror -- the same mean;
//       THE ILLUMINANCE VIEW: the camera's first leg through dust is not stopped by it.
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
if (!webgpu) { console.log('(haze GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
const { SHADE_PRELUDE } = await import('../scene_api.js')
const { MATERIALS_PBR } = await import('../materials_pbr.js')
const { FACE_TABLE, PROCESSING } = await import('../tracebasics.js')
const { HAZE_WGSL, HAZE_SHADE_WGSL, hazeUniforms, hazeSpanJS, hazeTrJS, hgEvalJS, hgSampleJS } = await import('../haze.js')
const U = await import('../uniforms.schema.js')
const { NO_LIGHT_FACES } = U
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
    console.log(`(haze GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }
const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(99)
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l) }
const sphere = () => { const z = 1 - 2 * rng(), s = Math.sqrt(1 - z * z), p = 2 * Math.PI * rng(); return [s * Math.cos(p), s * Math.sin(p), z] }
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer)
const bits = v => { f32[0] = v; return u32[0] }

/*----------------------------------------------------------------------------------------------------------------------
  THE FUNCTIONS: a thread a case, the box a turned one, the answers written back
----------------------------------------------------------------------------------------------------------------------*/
const FBOX = hazeUniforms({ centre: [0.1, -0.2, 0.3], axes: [norm([1, 1, 0]), norm([-1, 1, 0]), [0, 0, 1]], half: [0.4, 0.6, 0.3], mfp: 0.5,
                            albedo: [0.9, 0.8, 0.7], g: 0.6 }, 1, 0)
const R_ENV = 5
const fnBag = over => ({ renderMode: 0, maxbounce: 10, camtype: 0, measureMode: 0, envRadius: R_ENV, seed: [1, 2, 3, 4], ...FBOX, ...over })
{
    const N = 2000
    const cases = []
    for (let i = 0; i < N; i++) {
        const A = [2 * (rng() - 0.5), 2 * (rng() - 0.5), 2 * (rng() - 0.5)], d = sphere(), len = 3 * rng()
        cases.push({ A, d, len, cos: 2 * rng() - 1, g: [-0.9, -0.3, 0, 0.5, 0.95][i % 5], u: [rng(), rng()] })
    }
    const words = new Float32Array(N * 12)
    cases.forEach((c, i) => words.set([...c.A, c.len, ...c.d, c.cos, c.g, ...c.u, 0], i * 12))
    const k = WG.makeCompute(`${SHADE_PRELUDE}${NO_LIGHT_FACES}${HAZE_WGSL}`, /*wgsl*/`
        let i = gid.x;
        if (i >= arrayLength(&cases) / 12u) { return; }
        let b = i * 12u;
        let A = vec3<f32>(cases[b], cases[b + 1u], cases[b + 2u]);
        let len = cases[b + 3u];
        let d = vec3<f32>(cases[b + 4u], cases[b + 5u], cases[b + 6u]);
        let s = hazeSpan(A, d, len);
        let w = hgSample(d, cases[b + 8u], vec2<f32>(cases[b + 9u], cases[b + 10u]));
        out[i * 8u] = s.x; out[i * 8u + 1u] = s.y;
        out[i * 8u + 2u] = hazeTr(A, d, len);
        out[i * 8u + 3u] = hgEval(cases[b + 7u], cases[b + 8u]);
        out[i * 8u + 4u] = w.x; out[i * 8u + 5u] = w.y; out[i * 8u + 6u] = w.z;
    `, U.ComputeUniformTypes, { cases: 'array<f32>', out: 'array<f32>' })
    await k.ready
    const outBuf = WG.createStorageBuffer(N * 32)
    k.resources = { cases: WG.createStorageBuffer(words).b, out: outBuf.b }
    k.uniforms = fnBag({})
    k.run(N, 1, 1)
    const got = await outBuf.r(N * 32, 0, Float32Array)
    let spanWorst = 0, trWorst = 0, hgWorst = 0, drawWorst = 0
    cases.forEach((c, i) => {
        const s = hazeSpanJS(FBOX, c.A, c.d, c.len, R_ENV)
        const L = Math.max(0, s[1] - s[0]), Lg = Math.max(0, got[i * 8 + 1] - got[i * 8])
        spanWorst = Math.max(spanWorst, Math.abs(L - Lg))
        trWorst = Math.max(trWorst, Math.abs(hazeTrJS(FBOX, c.A, c.d, c.len, R_ENV) - got[i * 8 + 2]))
        const p = hgEvalJS(c.cos, c.g)
        hgWorst = Math.max(hgWorst, Math.abs(p - got[i * 8 + 3]) / p)
        const w = hgSampleJS(c.d, c.g, c.u)
        drawWorst = Math.max(drawWorst, Math.hypot(w[0] - got[i * 8 + 4], w[1] - got[i * 8 + 5], w[2] - got[i * 8 + 6]))
    })
    ok(`the box's stretch and its transmittance on Dawn are the JS's (${N} segments, turned box, the radius)`, spanWorst < 2e-5 && trWorst < 2e-5, `${spanWorst} ${trWorst}`)
    ok('Henyey-Greenstein\'s value on Dawn is the JS\'s, g -0.9 to 0.95', hgWorst < 1e-4, `${hgWorst}`)
    // a draw at g 0.95 from u near 0 is ill-conditioned in f32 (1 - g + 2 g u): measured against the JS's, not exact
    ok('...and its draw, the same direction for the same numbers', drawWorst < 2e-3, `${drawWorst}`)
}
{
    /* THE COLLISION ON Dawn (0.62.2): hazeDraw at the start of a leg -- N rays at A, each its own index (its own numbers)
       -- and hazeAt once a march has stepped past it. The share that collide on the line's stretch in the box and the
       radius, where the draw puts it (tmax, an ltot), the ray brought back to that point, and the rays it leaves alone. A
       quarter start a step off their vertex already taken (ltot past absLtot, as after a bounce): the same stretch. */
    const N = 65536
    const A = [-1, -0.25, 0.3], d = [1, 0, 0], L0 = 5, OFF = 0.01
    const s = hazeSpanJS(FBOX, A, d, 1e30, R_ENV), P = 1 - Math.exp(-FBOX.hazeC[3] * (s[1] - s[0]))
    const k = WG.makeCompute(`${SHADE_PRELUDE}${NO_LIGHT_FACES}${HAZE_WGSL}`, /*wgsl*/`
        let i = gid.x;
        if (i >= ${N}u) { return; }
        SEED_uvec4(UB.seed); SEED_u32(i);
        let A = vec3<f32>(${A.join(', ')});
        var r: Ray;
        r.dir = vec3<f32>(${d.join(', ')});
        r.pos = A; r.n = 1.0; r.ltot = ${L0}.0; r.absLtot = ${L0}.0; r.tmax = 0.0;
        r.state = RAY_ACTIVE; r.tag = 0u; r.bounces = 2u;
        let kind = i % 8u;                                   // 0-3 as it is (3 a step off); then glass, a probe, a seek ray, not active
        if (kind == 3u) { r.pos = A + r.dir * ${OFF}; r.ltot = ${L0}.0 + ${OFF}; }
        if (kind == 4u) { r.n = 1.5; }
        if (kind == 5u) { r.tag = TAG_PROBE; }
        if (kind == 6u) { r.tag = TAG_SEEK; }
        if (kind == 7u) { r.state = RAY_MAXITER; }
        let h = hazeDraw(r);
        let again = hazeDraw(h);                             // a later pass of the same leg: drawn once
        out[i * 8u] = h.tmax;
        out[i * 8u + 1u] = select(0.0, 1.0, again.tmax == h.tmax);
        // a march past it, by 0.3, and one short of it, by 0.01
        var past = h; past.pos = A + r.dir * (h.tmax - ${L0}.0 + 0.3); past.ltot = h.tmax + 0.3;
        var short = h; short.ltot = h.tmax - 0.01;
        let at = hazeAt(past);
        out[i * 8u + 2u] = select(0.0, 1.0, hazeArrived(past) && !hazeArrived(short));
        out[i * 8u + 3u] = dot(at.pos - A, r.dir);
        out[i * 8u + 4u] = length(cross(at.pos - A, r.dir));
        out[i * 8u + 5u] = at.ltot;
        out[i * 8u + 6u] = select(0.0, 1.0, at.state == RAY_SCATTER);
    `, U.ComputeUniformTypes, { out: 'array<f32>' })
    await k.ready
    const outBuf = WG.createStorageBuffer(N * 32)
    k.resources = { out: outBuf.b }
    k.uniforms = fnBag({})
    k.run(N, 1, 1)
    const g = await outBuf.r(N * 32, 0, Float32Array)
    let hits = 0, n = 0, badPlace = 0, badBack = 0, redrawn = 0, touched = 0, untouched = 0
    for (let i = 0; i < N; i++) {
        const kind = i % 8, tmax = g[i * 8]
        if (g[i * 8 + 1] !== 1) redrawn++
        if (kind >= 4) {
            const want = kind === 5 || kind === 7 ? 0 : -1   // a probe's and a ray not active untouched; glass and seek: none
            if (tmax === want) untouched++; else touched++
            continue
        }
        n++
        if (tmax === -1) continue
        hits++
        const t = tmax - L0
        if (!(t >= s[0] - 1e-5 && t <= s[1] + 1e-5)) badPlace++
        if (!(g[i * 8 + 2] === 1 && g[i * 8 + 6] === 1 && Math.abs(g[i * 8 + 3] - t) < 1e-5 && g[i * 8 + 4] < 1e-5 && g[i * 8 + 5] === tmax)) badBack++
    }
    const se = Math.sqrt(P * (1 - P) / n)
    ok(`a leg's collision on Dawn, drawn as it starts: probability 1 - exp(-sigma L) on the line's stretch (${(hits / n).toFixed(4)} vs ${P.toFixed(4)} +- ${se.toFixed(4)})`,
        Math.abs(hits / n - P) < 4 * se)
    ok('...each one on the line, inside the box, its tmax the ltot there; drawn once a leg', badPlace === 0 && redrawn === 0, `${badPlace} of ${hits}, ${redrawn} redrawn`)
    ok('...a march past it brought back to it exactly, RAY_SCATTER, its ltot the drawn one; one short of it not', badBack === 0, `${badBack} of ${hits}`)
    ok('...and glass, a seek ray (none on the leg), a probe and one not active (untouched) left alone', touched === 0 && untouched === N / 2, `${touched} touched`)
    // the illuminance view: a camera ray's first leg does not collide, a photon's does, and later legs
    const k2 = WG.makeCompute(`${SHADE_PRELUDE}${NO_LIGHT_FACES}${HAZE_WGSL}`, /*wgsl*/`
        let i = gid.x;
        if (i >= 4096u) { return; }
        SEED_uvec4(UB.seed); SEED_u32(i);
        var r: Ray;
        r.dir = vec3<f32>(${d.join(', ')});
        r.pos = vec3<f32>(${A.join(', ')});
        r.n = 1.0; r.ltot = 0.0; r.absLtot = 0.0; r.tmax = 0.0; r.state = RAY_ACTIVE;
        r.tag = select(0u, TAG_PHOTON, i % 2u == 1u); r.bounces = select(0u, 1u, i % 4u >= 2u);
        out[i] = select(0.0, 1.0, hazeDraw(r).tmax > 0.0);
    `, U.ComputeUniformTypes, { out: 'array<f32>' })
    await k2.ready
    const o2 = WG.createStorageBuffer(4096 * 4)
    k2.resources = { out: o2.b }
    k2.uniforms = fnBag({ measureMode: 1 })
    k2.run(4096, 1, 1)
    const h2 = await o2.r(4096 * 4, 0, Float32Array)
    const of = m => { let c = 0, t = 0; for (let i = 0; i < 4096; i++) if (i % 4 === m) { t++; c += h2[i] } return c / t }
    ok('the illuminance view: the camera\'s first leg passes, its later legs and a photon\'s collide', of(0) === 0 && of(1) > 0.5 * P && of(2) > 0.5 * P && of(3) > 0.5 * P,
        `${of(0)} ${of(1)} ${of(2)} ${of(3)}`)
}
{
    /* THE HAZE A SHADOW RAY CARRIES (hazeShadow): from the vertex P to the face's point or the camera (tmax two offsets
       short), or to the radius for the environment -- against the JS's transmittance over the same segment */
    const N = 512
    const cases = []
    for (let i = 0; i < N; i++) {
        const P = [0.6 * (rng() - 0.5), 0.6 * (rng() - 0.5), 0.6 * (rng() - 0.5)], dir = sphere(), dist = 0.2 + 2 * rng()
        cases.push({ P, dir, dist, kind: i % 4 })      // 0 the environment, 1 a face, 2 a connection, 3 an emitter ray
    }
    const words = new Float32Array(N * 8)
    cases.forEach((c, i) => words.set([...c.P, c.dist, ...c.dir, c.kind], i * 8))
    const k = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}${HAZE_WGSL}${HAZE_SHADE_WGSL}`, /*wgsl*/`
        let i = gid.x;
        if (i >= ${N}u) { return; }
        if (i == 0xFFFFFFFFu) { atomicAdd(&learn[0], 0u); }
        let b = i * 8u;
        let P = vec3<f32>(cases[b], cases[b + 1u], cases[b + 2u]);
        let dir = vec3<f32>(cases[b + 4u], cases[b + 5u], cases[b + 6u]);
        let kind = u32(cases[b + 7u]);
        var s: Ray;
        s.pos = P + vec3<f32>(0.0, 0.0, 1.0) * offsetTol(P) * 2.0;     // off its surface, as light sampling starts one
        s.dir = dir; s.radiance = vec3<f32>(1.0); s.n = 1.0;
        s.tag = select(select(select(0u, TAG_FNEE, kind == 1u), TAG_CONN, kind == 2u), TAG_EMIT, kind == 3u);
        s.tmax = cases[b + 3u] - offsetTol(P) * 2.0;
        out[i] = hazeShadow(s, P, 1.0).radiance.x;
        out[${N}u + i] = hazeShadow(s, P, 1.5).radiance.x;          // from a vertex in glass: none
    `, U.ComputeUniformTypes, { cases: 'array<f32>', out: 'array<f32>', learn: 'array<atomic<u32>>' })
    await k.ready
    const outBuf = WG.createStorageBuffer(N * 8)
    k.resources = { cases: WG.createStorageBuffer(words).b, out: outBuf.b, learn: WG.createStorageBuffer(16).b }
    k.uniforms = fnBag({ eps: 1e-5 })
    k.run(N, 1, 1)
    const g = await outBuf.r(N * 8, 0, Float32Array)
    let worst = 0, emit = 0, glass = 0
    cases.forEach((c, i) => {
        if (c.kind === 3) { if (g[i] !== 1) emit++; return }
        const T = c.kind === 0 ? hazeTrJS(FBOX, c.P, c.dir, 100, R_ENV)
            : (() => { const e = c.P.map((v, k) => v + 1e-5 * 20 * (k === 2) + c.dir[k] * c.dist); const dd = e.map((v, k) => v - c.P[k]), L = Math.hypot(...dd)
                       return hazeTrJS(FBOX, c.P, dd.map(v => v / L), L, R_ENV) })()
        worst = Math.max(worst, Math.abs(T - g[i]))
        if (g[N + i] !== 1) glass++
    })
    ok('a shadow ray\'s haze on Dawn, from its vertex to where it stops: the JS\'s transmittance (the environment, a face, a connection)', worst < 5e-4, `${worst}`)
    ok('...none on an emitter ray here (the occlusion kernel\'s, where its length is known), nor from a vertex in glass', emit === 0 && glass === 0, `${emit} ${glass}`)
}

/*----------------------------------------------------------------------------------------------------------------------
  THE WHOLE RENDERER
----------------------------------------------------------------------------------------------------------------------*/
const W = 24, H = 24
const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
const engine = async (scene) => {
    const Q = { w: W, h: H, resetframecount: 1 }
    const R = RAYTRACER(WG, null, Q, scene)
    R.hud = () => { }
    let err = null
    try { await quietly(() => R.init()) } catch (e) { err = e?.message ?? String(e) }
    return { R, Q, err }
}
const bagFor = (scene, cam, over) => {
    const v = { ...U.defaultUniformValues(), envMode: 0, uSunElevation: 60, uSunAzimuth: 30, sunDiameter: 0.53, sunIlluminance: 100000,
                skyIlluminance: 0, nee: 1, lt: 0, ltPhotons: 1, ltLearn: 0, maxbounce: 10, rr: 0, fireflyClamp: 0,
                maxaverages: 0, autoExposure: 0, sppm: 0, sppmRadius: 2, ...over }
    const traced = effective(v)
    const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius, haze: scene.haze })
    const EC = engineCamera({ ...cam.getUniforms(), camLens: [0, 1, 0, 0] }, 0, derived.sceneUnit)
    return Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
        ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
        .filter(([k]) => k in U.ComputeUniformTypes || k in U.UniformSpec || k in (scene.uniforms || {})))
}
const render = async ({ R, Q }, scene, cam, over, samples) => {
    const bag = bagFor(scene, cam, over)
    R.kernelOptions = R.kernelOptionsOf(bag)
    await quietly(() => R.applyKernelOptions())
    Q.resetframecount = 1
    let err = null
    try {
        await quietly(() => R.trace(Q, bag, 1, target))
        Q.resetframecount = 0
        for (let done = 1; done < samples; done += 16) {
            await quietly(() => R.trace(Q, bag, Math.min(16, samples - done), target))
            await WG.device.queue.onSubmittedWorkDone()
        }
    } catch (e) { err = e?.message ?? String(e) }
    const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
    const f = new Float32Array(a.buffer, a.byteOffset, a.length)
    return { err, img: Array.from({ length: W * H }, (_, i) => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]) }
}
const stats = (img, ix) => {
    const v = ix.map(i => img[i]), m = v.reduce((s, x) => s + x, 0) / v.length
    return { mean: m, se: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1) / v.length) }
}
/* TWO PICTURES OF ONE SCENE, PIXEL BY PIXEL: the region's mean of a over its mean of b, its error from the spread of the
   pixels' differences -- each pixel's own noise, not the picture's structure, which the spread of either picture alone
   counts as noise (a region with a slab's edge in it read +-26 % that way) */
const paired = (a, b, ix) => {
    const n = ix.length, mb = ix.reduce((s, i) => s + b[i], 0) / n
    const d = ix.map(i => a[i] - b[i]), md = d.reduce((s, x) => s + x, 0) / n
    return { mean: 1 + md / mb, se: Math.sqrt(d.reduce((s, x) => s + (x - md) ** 2, 0) / (n - 1) / n) / mb, of: mb }
}
const agree = (p, floor = 0.01) => Math.abs(p.mean - 1) < Math.max(floor, 3.5 * p.se)
const pm = p => `${p.mean.toFixed(4)} +- ${p.se.toFixed(4)}`
// a pixel's ray from a pinhole camera (genrays' mapping, as ltConnect inverts it), for the closed forms
const rayOf = (cam, px, py, jx = 0.5, jy = 0.5) => {
    const CU = cam.getUniforms(), M = CU.invView, fx = CU.invProjection[0], fy = CU.invProjection[5]
    const x = ((px + jx) / W) * 2 - 1, y = ((py + jy) / H) * 2 - 1
    return { o: [M[12], M[13], M[14]], d: norm([0, 1, 2].map(a => M[a] * x * fx + M[4 + a] * y * fy - M[8 + a])) }
}
// a scene: nothing but a ball far outside the radius (never reached), and what is asked
const sceneOf = (id, haze, sdf = '', mats = '', envRadius = 3) => ({
    id, title: id, unit: 'm', extent: 2, envRadius, uniforms: {}, ...(haze ? { haze } : {}),
    wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    var m = makeDefaultMaterial();
    if (idx == 4u) { m = makeDiffuse(vec3<f32>(0.8), 1.0); }
    ${mats}
    return m;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    C = add_new(C, Nsphere(r.pos - VEC3(0.0, 0.0, -50.0), 1.0), 4u);
    ${sdf}
    return C;
}`,
})
const box = (centre, half, mfp, albedo, g) => ({ centre, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half, mfp, albedo, g })
const t0 = Date.now()

/* A FURNACE: a uniform sky of luminance 1 and an albedo-1 haze box, nothing else -- every pixel 1, however the light
   scattered; at albedo 0.5, less wherever the box is seen */
{
    const scene = sceneOf('haze-furnace', box([0, 0, 0], [0.6, 0.6, 0.6], 0.6, [1, 1, 1], 0.6))
    const E = await engine(scene)
    ok('the renderer with a haze box on Dawn: built', E.err === null && E.R._built === true && /\bhazeDraw\b/.test(E.R.prog_wvfmarch.wgsl) && !/\bhaze(Draw|At|Leg)\b/.test(E.R.prog_wvfsurface.wgsl), E.err)
    const cam = CAMERA({ aspect: 1, fov: 50, up: [0, 0, 1] })
    cam.setPose({ pos: [0, -2.2, 0.4], target: [0, 0, 0], up: [0, 0, 1] })
    const all = Array.from({ length: W * H }, (_, i) => i)
    const inBox = all.filter(i => { const r = rayOf(cam, i % W, (i / W) | 0); const s = hazeSpanJS(hazeUniforms(scene.haze), r.o, r.d, 10, 3); return s[1] - s[0] > 0.3 })
    const runs = []
    for (const g of [0.6, 0, -0.5]) {
        scene.haze.g = g
        runs.push({ g, r: await render(E, scene, cam, { envUniform: 1, maxbounce: 40 }, 256) })
    }
    scene.haze.g = 0.6; scene.haze.albedo = [0.5, 0.5, 0.5]
    const dark = await render(E, scene, cam, { envUniform: 1, maxbounce: 40 }, 128)
    const said = runs.map(({ g, r }) => `g ${g}: ${stats(r.img, inBox).mean.toFixed(4)} +- ${stats(r.img, inBox).se.toFixed(4)}`).join(', ')
    console.log(`  the furnace (${inBox.length} pixels through the box): ${said}; albedo 0.5: ${stats(dark.img, inBox).mean.toFixed(4)}`)
    ok(`a furnace: an albedo-1 haze box reads the sky's 1 through it, scattered many times, whatever g (${said})`,
        runs.every(({ r }) => r.err === null && Math.abs(stats(r.img, inBox).mean - 1) < Math.max(0.01, 3.5 * stats(r.img, inBox).se))
        && runs.every(({ r }) => all.every(i => Number.isFinite(r.img[i]))), runs.map(({ r }) => r.err).join(' | '))
    ok('...and an albedo-0.5 one reads less: the furnace can fail', dark.err === null && stats(dark.img, inBox).mean < 0.9, String(stats(dark.img, inBox).mean))
}

/* A FURNACE WITH A SOLID IN THE DUST, AT THE SCENE'S DEFAULT RADIUS (0.62.2): the `haze` bench row's own scene (tests.js
   testScene's white sphere, its material Lambertian as the row pins it) in an albedo-1 box, the radius 400 m, NEE off --
   where a path brings back exactly the sky or nothing, so any pixel under 1 is a path lost. 0.62.1's kernels lost
   3.9e-4 of the light here (this session, 2026-10-16): the collision was decided after the march, from the leg made again
   from where it ended, and a leg that escaped ended at 400 m, where f32 put a collision just past a bounce inside the
   sphere (core/haze.js hazeDraw; the user's card read the dust 0.04 % under the box hidden). The furnace above has no
   solid in it and a 3 m radius; this file's own scene with a sphere added (sceneOf) lost only 0.5e-4 on those kernels,
   too near its noise to be a test, and why it lost less is not known. */
{
    const { testScene } = await import('../../tests.js')
    const scene = { ...testScene('m', 'sphere'), id: 'haze-furnace-solid', haze: box([0, 0, 0], [1.6, 1.6, 1.6], 1.5, [1, 1, 1], 0.6) }
    const E = await engine(scene)
    const cam = CAMERA({ aspect: 1, fov: 50, up: [0, 0, 1] })
    cam.setPose({ pos: [1.299, 0.75, 2.598], target: [0, 0, 0], up: [0, 0, 1] })     // the row's: azimuth 30, elevation 60, 3 m
    const r = await render(E, scene, cam, { envUniform: 1, maxbounce: 40, nee: 0,
        tBase: 1, tMetal: 0, tRough: 0.5, tSpec: 0, tTrans: 0, tIor: 1.5, tAniso: 0, tGrain: 0, tCoat: 0, tAbbe: 0, tDepth: 0 }, 256)
    const lost = r.img.reduce((a, v) => a + (1 - v), 0) / r.img.length
    console.log(`  the bench's furnace with its sphere, radius 400 m, NEE off: ${(lost * 1e4).toFixed(2)}e-4 of its light lost`)
    ok(`a furnace with a sphere in its dust at a 400 m radius loses no path (${(lost * 1e4).toFixed(2)}e-4 lost; 0.62.1's kernels, 3.9e-4)`,
        r.err === null && lost < 1e-4, r.err ?? '')
}

/* SUNLIT DUST against a black sky, seen side on: single scattering is the integral along each pixel's ray of
   sigma_s p(cos) E T_sun T_cam -- Draft's picture (its path ends at the first point in the dust, its light sample at
   weight 1), pixel region by region; the full renderer adds the light scattered more than once. (maxbounce 1 is not
   single scattering: a vertex past the cap still samples a light before the path ends, as a surface's does.) Then the
   two halves of the MIS at a point in the dust: with light sampling off, the phase function's draw alone finds a 60
   degree sun -- the same mean as with it on. (At 30 degrees and 1024 samples it read 0.91 +- 0.03 once and 0.98 +- 0.04
   another time: the draw finds the sun a few times a pixel, a heavy tail; at 60 degrees and 2048, four cases within one
   error bar of 1, 2026-10-16.) */
{
    const H0 = box([0, 0, 0.3], [0.5, 0.25, 0.3], 0.8, [0.9, 0.9, 0.9], 0.6)
    const scene = sceneOf('haze-sun', H0)
    const E = await engine(scene)
    const cam = CAMERA({ aspect: 1, fov: 50, up: [0, 0, 1] })
    cam.setPose({ pos: [0.2, -1.8, 0.35], target: [0, 0, 0.3], up: [0, 0, 1] })
    const u = hazeUniforms(H0)
    // the sun's direction as sdf.js sunDirection has it: the azimuth from +y towards +x
    const el = 60 * Math.PI / 180, az = 30 * Math.PI / 180
    const S = [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)]
    const sigma = 1 / H0.mfp, Es = 100000
    const ref = new Float64Array(W * H)
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        let L = 0
        const J = 4
        for (let j = 0; j < J * J; j++) {
            const r = rayOf(cam, px, py, ((j % J) + 0.5) / J, (Math.floor(j / J) + 0.5) / J)
            const s = hazeSpanJS(u, r.o, r.d, 10, 3)
            if (!(s[1] > s[0])) continue
            const K = 48, p = hgEvalJS(r.d[0] * S[0] + r.d[1] * S[1] + r.d[2] * S[2], H0.g)
            for (let k = 0; k < K; k++) {
                const t = s[0] + (k + 0.5) / K * (s[1] - s[0]), P = r.o.map((v, a) => v + r.d[a] * t)
                L += H0.albedo[0] * sigma * p * Es * hazeTrJS(u, P, S, 10, 3) * Math.exp(-sigma * (t - s[0])) * (s[1] - s[0]) / K
            }
        }
        ref[px + W * py] = L / (J * J)
    }
    const region = Array.from({ length: W * H }, (_, i) => i).filter(i => ref[i] > 0.2 * Math.max(...ref))
    const draft = await render(E, scene, cam, { renderMode: 1 }, 512)
    const full = await render(E, scene, cam, {}, 256)
    const d1 = paired(draft.img, ref, region), f1 = paired(full.img, draft.img, region)
    const big = { sunDiameter: 60 }
    const misOn = await render(E, scene, cam, big, 512)
    const misOff = await render(E, scene, cam, { ...big, nee: 0 }, 2048)
    const off = paired(misOff.img, misOn.img, region)
    console.log(`  sunlit dust (${region.length} pixels): the integral ${d1.of.toFixed(1)} cd/m^2; Draft ${pm(d1)} of it, the full renderer ${pm(f1)} of Draft;`
        + ` a 60 degree sun, light sampling off ${pm(off)} of on`)
    ok(`sunlit dust seen side on: single scattering (Draft: the light sample alone, at weight 1) is the integral, ${pm(d1)}`, draft.err === null && agree(d1, 0.02), draft.err)
    ok(`...and the full renderer more (light scattered more than once added), ${pm(f1)}`, full.err === null && f1.mean > 1 + 3 * f1.se, full.err)
    ok(`...a 60 degree sun: the phase function's draw alone (light sampling off) is light sampling and the draw by MIS, ${pm(off)}`,
        misOn.err === null && misOff.err === null && agree(off, 0.02), `${misOn.err} ${misOff.err}`)
    // a box of no density (hidden, kept: on false) is the scene without one, pixel region for pixel region
    scene.haze = { ...H0, on: false }
    const none = await render(E, scene, cam, {}, 32)
    ok('...hidden (on false, the kernels the same): black, nothing scatters', none.err === null && stats(none.img, region).mean === 0, String(stats(none.img, region).mean))
}

/* A BOX INSIDE A GLASS BLOCK, in a furnace (a uniform sky of 1): the dust ABSORBS (albedo 0) and is dense, so wherever
   it acted the block would go dark -- and clear glass in a furnace reads the sky's 1 through it, reflection and refraction
   together -- but for what the bounce cap cuts off of the light total internal reflection holds in a cube (0.989 of 1 at
   maxbounce 24, measured here, 2026-10-16), so the reference is the block with the box there and off (on false: the same
   kernels), pixel by pixel. A box 5 mm inside the block's faces holds no air: the same picture. The same box a fifth
   bigger than the block holds a shell of air round it, and does dim it: the test can fail. */
{
    const half = [0.2, 0.2, 0.15], centre = [0, 0, 0.3]
    const sdf = `C = add_new(C, Nbox(r.pos - VEC3(${centre.join(', ')}), VEC3(${half.join(', ')})), 1u);`
    const mats = `if (idx == 1u) { m.baseColor = vec3<f32>(1.0); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.5; m.transmission = 1.0; m.ior = 1.5; }`
    const scene = sceneOf('haze-glass', box(centre, half.map(h => h - 0.005), 0.05, [0, 0, 0], 0.5), sdf, mats)
    const E = await engine(scene)
    const cam = CAMERA({ aspect: 1, fov: 30, up: [0, 0, 1] })
    cam.setPose({ pos: [0, -1.2, 1.0], target: [0, 0, 0.3], up: [0, 0, 1] })
    // the pixels whose ray meets the block (as the box's stretch says, the box being the block)
    const block = Array.from({ length: W * H }, (_, i) => i).filter(i => { const r = rayOf(cam, i % W, (i / W) | 0)
        return hazeSpanJS(hazeUniforms({ ...scene.haze, mfp: 1 }), r.o, r.d, 10, 3).reduce((a, b) => b - a) > 0.05 })
    // (a ray through the box inside meets the block: the box is in it)
    const furnace = { envUniform: 1, maxbounce: 24 }
    const exact = await render(E, scene, cam, furnace, 64)
    const inside = scene.haze
    scene.haze = { ...inside, on: false }
    const none = await render(E, scene, cam, furnace, 64)
    scene.haze = { ...inside, half: half.map(h => h * 1.2) }      // a fifth bigger than the block
    const bigger = await render(E, scene, cam, furnace, 64)
    const a = paired(exact.img, none.img, block), b = paired(bigger.img, none.img, block)
    console.log(`  an absorbing box inside a glass block, in a furnace (${block.length} pixels through it, the block alone ${a.of.toFixed(4)}): ${pm(a)} of the block alone;`
        + ` a fifth bigger than the block ${pm(b)}`)
    ok(`a haze box inside a glass block changes nothing: the glass does not scatter or absorb, ${pm(a)} of the block alone`,
        exact.err === null && none.err === null && block.length >= 40 && agree(a, 0.002), `${exact.err} ${none.err} ${block.length}`)
    ok(`...and a fifth bigger than the block, the air round it in the box, darkens it (${pm(b)}): the test can fail`, bigger.err === null && b.mean < 0.9)
}

/* DUST UNDER A GLASS SLAB (sppm.gpu.mjs's scene) in a 20 degree sun: the camera's own paths, the sun's photons on, the
   photon map on -- one mean. A medium vertex is the photon map's D to nothing (it stores no photons in the air): counted
   as one, the map would own what the camera finds past it through the slab, and the picture would lose it */
{
    const SLAB_Z = 0.35, SLAB_T = 0.05, SLAB_H = 0.4
    const sdf = `C = add_new(C, Ncylinder(r.pos - VEC3(0.0, 0.0, -0.05), 0.05, 1.0), 4u);
    C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.0, ${SLAB_Z}), VEC3(${SLAB_H}, ${SLAB_H}, ${SLAB_T})), 1u);`
    const mats = `if (idx == 1u) { m.baseColor = vec3<f32>(1.0); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.5; m.transmission = 1.0; m.ior = 1.5; }`
    const scene = sceneOf('haze-slab', box([0, 0, 0.15], [0.5, 0.5, 0.14], 0.4, [0.9, 0.9, 0.9], 0.5), sdf, mats, 1.2)
    const E = await engine(scene)
    const cam = CAMERA({ aspect: 1, fov: 55, up: [0, 0, 1] })
    cam.setPose({ pos: [0.0, -0.8, 1.3], target: [0, 0, 0], up: [0, 0, 1] })
    const centreP = Array.from({ length: W * H }, (_, i) => i).filter(i => Math.abs((i % W) - W / 2 + 0.5) < W / 4 && Math.abs(((i / W) | 0) - H / 2 + 0.5) < H / 4)
    const sun = { sunDiameter: 20, uSunElevation: 70 }
    const camOnly = await render(E, scene, cam, { ...sun, lt: 0 }, 768)
    const lt = await render(E, scene, cam, { ...sun, lt: 1, ltPhotons: 2 }, 512)
    const map = await render(E, scene, cam, { ...sun, lt: 1, ltPhotons: 2, sppm: 1 }, 384)
    const l = paired(lt.img, camOnly.img, centreP), m = paired(map.img, camOnly.img, centreP)
    console.log(`  dust under a glass slab (${centreP.length} pixels): the camera's own ${l.of.toFixed(0)} cd/m^2, the sun's photons on ${pm(l)}, the photon map on ${pm(m)}`)
    ok('dust under a glass slab: the three renders ran', [camOnly, lt, map].every(r => r.err === null), [camOnly, lt, map].map(r => r.err).join(' | '))
    ok(`...the sun's photons on: the same mean (they connect from the dust where they passed glass, the camera leaves them that), ${pm(l)}`, l.of > 0 && agree(l, 0.02))
    ok(`...the photon map on: the same mean (a medium vertex is no D of the map's), ${pm(m)}`, agree(m, 0.02))
}

/* DUST OVER A MIRROR in a 20 degree sun, against a black sky: the sun off the mirror into the dust, seen from the side
   above the mirror's plane -- the sun's photons connecting from the air (ltConnectMedium) against the camera's own paths
   finding the sun in the mirror -- one mean */
{
    const sdf = `C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.0, -0.02), VEC3(1.0, 1.0, 0.02)), 2u);`
    const mats = `if (idx == 2u) { m.baseColor = vec3<f32>(0.95); m.metallic = 1.0; m.roughness = 0.0; }`
    const scene = sceneOf('haze-mirror', box([0, 0, 0.35], [0.4, 0.4, 0.3], 0.6, [0.9, 0.9, 0.9], 0.3), sdf, mats, 2)
    const E = await engine(scene)
    const cam = CAMERA({ aspect: 1, fov: 40, up: [0, 0, 1] })
    cam.setPose({ pos: [0.0, -1.6, 0.4], target: [0, 0, 0.45], up: [0, 0, 1] })
    // the pixels looking up from above the mirror: their rays meet the dust and then the black sky, never the mirror
    const up = Array.from({ length: W * H }, (_, i) => i).filter(i => {
        const r = rayOf(cam, i % W, (i / W) | 0); const s = hazeSpanJS(hazeUniforms(scene.haze), r.o, r.d, 10, 2)
        return r.d[2] > 0.02 && s[1] - s[0] > 0.3 })
    const sun = { sunDiameter: 20, uSunElevation: 50 }
    const camOnly = await render(E, scene, cam, { ...sun, lt: 0 }, 1024)
    const lt = await render(E, scene, cam, { ...sun, lt: 1, ltPhotons: 4 }, 512)
    const l = paired(lt.img, camOnly.img, up)
    console.log(`  dust over a mirror (${up.length} pixels): the camera's own ${l.of.toFixed(0)} cd/m^2, the sun's photons on ${pm(l)}`)
    ok(`dust over a mirror: the sun's photons off the mirror, connecting from the air, are what the camera's own paths find (${up.length} pixels), ${pm(l)}`,
        camOnly.err === null && lt.err === null && up.length >= 40 && l.of > 0 && agree(l, 0.02), `${camOnly.err} ${lt.err} ${up.length}`)
}

/* THE ILLUMINANCE VIEW: the floor's lux under the sun, with dust between the camera and the floor (but not between the
   sun and the floor), dust that only ABSORBS (albedo 0: a scattering one lights the floor a little itself, which is lux
   the floor really gets): the camera's first leg passes, so the reading is the floor's without the dust */
{
    const sdf = `C = add_new(C, Ncylinder(r.pos - VEC3(0.0, 0.0, -0.05), 0.05, 1.5), 4u);`
    const scene = sceneOf('haze-lux', box([0, -0.9, 0.5], [0.6, 0.15, 0.5], 0.1, [0, 0, 0], 0.5), sdf, '', 2.5)
    const E = await engine(scene)
    const cam = CAMERA({ aspect: 1, fov: 30, up: [0, 0, 1] })
    cam.setPose({ pos: [0, -1.4, 0.6], target: [0, 0, 0], up: [0, 0, 1] })
    const centreP = Array.from({ length: W * H }, (_, i) => i).filter(i => Math.abs((i % W) - W / 2 + 0.5) < W / 4 && Math.abs(((i / W) | 0) - H / 2 + 0.5) < H / 4)
    const sun = { uSunElevation: 80, uSunAzimuth: 90, measureMode: 1 }
    const withBox = await render(E, scene, cam, sun, 64)
    scene.haze = { ...scene.haze, on: false }
    const without = await render(E, scene, cam, sun, 64)
    const a = paired(withBox.img, without.img, centreP)
    console.log(`  the illuminance view (${centreP.length} pixels): dust between the camera and the floor ${pm(a)} of none`)
    ok(`the illuminance view: dust between the camera and the floor does not dim the floor's lux, ${pm(a)}`, withBox.err === null && a.of > 0 && agree(a, 0.01))
}

console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s for the renders`)
console.log(`haze GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
