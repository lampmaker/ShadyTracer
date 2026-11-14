//======================================================================================================================
// THE PROBES ON A REAL WEBGPU (0.next; genrays.js camtype 2, raytrace_main.js R.setProbes). Run:
//   node builder/test/probes.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package (npm i -g webgpu) and a Vulkan driver
// (lavapipe: apt-get install mesa-vulkan-drivers), or it says so and passes.
//
// WHY. The print export's lit colours (builder/exportbox.js, index.js renderProbes) are the light leaving each point of
// the part, traced by the whole renderer along a ray of its own: pixel k's ray is probe k's, from just off the point
// straight at it. What decides whether that is the light there is that the renderer, given those rays and no camera,
// traces what it traces for a camera -- and that pixel k is probe k.
//
// What it holds, through R.trace with every kernel (lightface.gpu.mjs's scene): a white matte floor under one 0.1 x
// 0.05 m face, light tracing and the lights' rays off as the probes' render has them, probes at points of the floor
// looking straight down -- 250 of them in a 16 x 16 picture, the rest padding:
//   - every probe's pixel the floor's radiance there, rho / pi times the face's irradiance (the closed form), on average
//     within its error and each one within its own noise: the order of the pixels is the probes';
//   - the same with light sampling off (the face found by its glow alone);
//   - a probe turned the other way, looking up at the face from under it, its luminance; one looking at the sky, black.
// WHAT IT CANNOT SHOW: a picture, or speed (CLAUDE.md).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.LP_NUM_THREADS ??= '0'
{
    let a = (Number(process.env.PROBES_GPU_SEED ?? 1) >>> 0) || 1
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
if (!webgpu) { console.log('(probes GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { PRESETS } = await import('../materials.js')
const { generate } = await import('../codegen.js')
const { sourceTable } = await import('../sources.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const U = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')
const { RAYTRACER } = await import('../../lib/pathtracer/core/raytrace_main.js')
const { CAMERA } = await import('../../lib/camera.js')
const { engineCamera } = await import('../../lib/pathtracer/core/units.js')
const { effective } = await import('../../lib/pathtracer/quality.js')
const { probeRays, probePicture, developProbes, PROBE_OVERRIDES } = await import('../../lib/pathtracer/core/probes.js')
const { makeDarkroom, viewSettings } = await import('../../lib/pathtracer/develop.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(probes GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
const at = (x, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale })
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }

const ALBEDO = 0.8
const d = M.createDoc({})
M.addMaterial(d, { id: 'matte', params: { ...PRESETS.diffuse.params(), baseColor: { r: ALBEDO, g: ALBEDO, b: ALBEDO }, specular: 0 } })
M.addObject(d, 'root', { id: 'floor', primitive: 'box', material: 'matte', params: { size: { x: 1.5, y: 1.5, z: 0.05 }, rounding: 0 }, transform: at(0, 0, -0.05) })
M.addLight(d, 'root', { id: 'led', shape: 'rectangle', params: { width: 0.1, height: 0.05 }, transform: at(0, 0, 0.6, 180, 0, 0) })
const scene = generate(...M.generateArgs(d, { id: 'probes' }))
const L = scene.uniforms.emissiveLuminance_led.def
const face = sourceTable(d).sources[0]

// E at (x, y, 0): L times the sum of cos cos / r^2 dA over the face, by the midpoint rule (lightface.gpu.mjs)
const irradiance = (x, y, N = 32) => {
    const c = face.origin, u = face.u, n = face.normal, h = face.half, v = cross(n, u)
    const dA = (2 * h[0] / N) * (2 * h[1] / N)
    let E = 0
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const a = ((i + 0.5) / N * 2 - 1) * h[0], b = ((j + 0.5) / N * 2 - 1) * h[1]
        const dd = [0, 1, 2].map(k => c[k] + u[k] * a + v[k] * b - [x, y, 0][k]), r2 = dd[0] ** 2 + dd[1] ** 2 + dd[2] ** 2, r = Math.sqrt(r2)
        const cosF = dd[2] / r, cosL = -(n[0] * dd[0] + n[1] * dd[1] + n[2] * dd[2]) / r
        if (cosF > 0 && cosL > 0) E += cosF * cosL / r2 * dA
    }
    return L * E
}

/* 250 probes on the floor, a spiral out to 0.55 m (so neighbours in the list are far apart on the floor, and a pixel
   given its neighbour's ray reads wrong), looking straight down from 5 mm above it; then one looking up at the face's
   middle from 5 mm under it, and one beside the face looking on up at the black sky */
const N = 250
const pts = [], dirs = []
for (let k = 0; k < N; k++) {
    const r = 0.55 * Math.sqrt((k + 0.5) / N), a = k * 2.39996
    pts.push([r * Math.cos(a), r * Math.sin(a), 0]); dirs.push([0, 0, -1])
}
pts.push([0, 0, 0.6]); dirs.push([0, 0, 1])                 // N: the face's middle, from under it (it faces down)
pts.push([0.5, 0.5, 0.6]); dirs.push([0.3, 0, 1])            // N + 1: beside the face, the ray on to the sky (black here)
const n = pts.length
const offset = 0.005
// the picture the page makes for them (probePicture): rows of padding at the bottom, the probes from `first` on
const pic = probePicture(n), W = pic.w, H = pic.h

// the display pass needs somewhere to draw; the probes' light is read from the accumulation, not from this
const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
const render = async (over, samples) => {
    const Q = { w: W, h: H, resetframecount: 1 }
    const R = RAYTRACER(WG, null, Q, scene)
    R.hud = () => { }
    let err = null
    try { await quietly(() => R.init()) } catch (e) { err = e?.message ?? String(e) }
    const v = { ...U.defaultUniformValues(), envMode: 0, sunIlluminance: 0, skyIlluminance: 0, nee: 1, maxbounce: 6, rr: 0,
                fireflyClamp: 0, maxaverages: 0, autoExposure: 0, sppm: 1, lt: 1, ...PROBE_OVERRIDES, ...over }
    const traced = effective(v)
    const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius, tolerance: scene.tolerance })
    // a camera whatever: the probes' trace reads none of it (genrays, camtype 2)
    const cam = CAMERA({ aspect: 1, fov: 50, up: [0, 0, 1] })
    cam.setPose({ pos: [0, -1.2, 0.35], target: [0, 0, 0], up: [0, 0, 1] })
    const EC = engineCamera(cam.getUniforms(), 0, derived.sceneUnit)
    const bag = Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
        ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 2 })
        .filter(([k]) => k in U.ComputeUniformTypes || k in U.UniformSpec))
    for (const [k, u] of Object.entries(scene.uniforms || {})) bag[k] = flat(u.def)
    if (!err) try {
        R.kernelOptions = R.kernelOptionsOf(bag)
        await quietly(() => R.applyKernelOptions())
        R.setProbes(probeRays(pts, dirs, { offset, unit: derived.sceneUnit, pixels: W * H, first: pic.first }))
        for (let done = 0; done < samples; done += 16) {
            await quietly(() => R.trace(Q, bag, Math.min(16, samples - done), target))
            Q.resetframecount = 0
            await WG.device.queue.onSubmittedWorkDone()
        }
    } catch (e) { err = e?.message ?? String(e) }
    const a = err ? null : await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
    const f = a && new Float32Array(a.buffer, a.byteOffset, a.length)
    // ...and developed as the page develops them (developProbes, the darkroom's pass), at a manual exposure
    let developed = null
    if (!err && over.develop) try {
        const dr = makeDarkroom(WG)
        const view = viewSettings({ ...bag, autoExposure: 0, exposureEV: over.develop.ev, measureMode: over.develop.show ?? 0 }, null)
        developed = await developProbes(dr, { from: R.accumulation_u32, pic, n, view, samples })
        dr.discard()
    } catch (e) { err = `develop: ${e?.message ?? e}` }
    return { err, developed, rgb: f ? Array.from({ length: n }, (_, i) => [f[4 * (pic.first + i)], f[4 * (pic.first + i) + 1], f[4 * (pic.first + i) + 2]]) : [] }
}

{
    const rays = probeRays([[1, 2, 3]], [[0, 0, 2]], { offset: 0.5, unit: 0.001, pixels: 3 })
    ok('probeRays: 8 floats a pixel, the origin off the point along the reverse of its direction, in metres, padded with the first',
        rays.length === 24 && [...rays.slice(0, 8)].join() === [0.001, 0.002, 0.0025, 0, 0, 0, 1, 0].map(x => +Math.fround(x)).join()
        && [...rays.slice(16, 24)].join() === [...rays.slice(0, 8)].join(), [...rays].join())
}

const pred = pts.slice(0, N).map(([x, y]) => ALBEDO / Math.PI * irradiance(x, y))
const fit = rgb => {
    const q = pred.map((p, k) => rgb[k][1] / p), m = q.reduce((s, x) => s + x, 0) / N
    return { mean: m, se: Math.sqrt(q.reduce((s, x) => s + (x - m) ** 2, 0) / (N - 1) / N), worst: Math.max(...q.map(x => Math.abs(x - 1))) }
}
const pm = p => `${p.mean.toFixed(4)} +- ${p.se.toFixed(4)}, worst ${(100 * p.worst).toFixed(1)} %`
const t0 = Date.now()
// EV 2: the floor's radiance (tens of cd/m^2 under the face) mid-scale, the face itself (1000) past white
const on = await render({ nee: 1, develop: { ev: 2 } }, 512), off = await render({ nee: 0 }, 4096)
ok('the two renders of the probes ran', on.err === null && off.err === null, `${on.err} | ${off.err}`)
if (on.err === null && off.err === null) {
    const a = fit(on.rgb), b = fit(off.rgb)
    console.log(`  ${N} probes on a floor under a 0.1 x 0.05 m face, ${((Date.now() - t0) / 1000).toFixed(0)} s: light sampling on ${pm(a)} of the closed form, off ${pm(b)}`)
    const agree = (q, floor) => Math.abs(q.mean - 1) < Math.max(floor, 3.5 * q.se)
    ok(`light sampling on: each probe the floor's radiance where it looks, ${pm(a)}`, agree(a, 0.01), pm(a))
    // one probe's own noise at 512 samples is about 5 % (lightface.gpu.mjs: 0.3 % over 286 pixels); a pixel given another's ray is off by tens of percent
    ok('...each probe within 20 % of its own point\'s (the pixels in the probes\' order)', a.worst < 0.2, pm(a))
    ok(`light sampling off, the face found by its glow alone, ${pm(b)}`, agree(b, 0.02), pm(b))
    const up = on.rgb[N][1], sky = on.rgb[N + 1]
    ok(`a probe looking up at the face reads its luminance, ${(up / L).toFixed(4)} of it`, Math.abs(up / L - 1) < 0.01, `${up} against ${L}`)
    ok('a probe looking at the black sky reads black', sky.every(c => c === 0), JSON.stringify(sky))
    /* DEVELOPED, IN THE PROBES' ORDER: grey in, grey out, and brighter light never a darker colour -- across the picture's
       rows, so a probe given another's place (the rows run from the bottom; the first rows are padding) shows */
    const D = on.developed, Y = on.rgb.map(c => c[1])
    ok('developed: a colour per probe, in [0, 1]', D && D.length === 3 * n && [...D].every(x => x >= 0 && x <= 1), D && `${Math.min(...D)} .. ${Math.max(...D)}`)
    if (D) {
        const grey = Array.from({ length: N }, (_, k) => Math.abs(D[3 * k] - D[3 * k + 1]) + Math.abs(D[3 * k + 2] - D[3 * k + 1]))
        ok('...the white floor grey', Math.max(...grey) < 1e-3, Math.max(...grey))
        const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => Y[a] - Y[b])
        let back = 0
        for (let i = 1; i < n; i++) if (D[3 * order[i] + 1] < D[3 * order[i - 1] + 1] - 1e-6) back++
        ok('...brighter light never a darker colour, every probe in its own place', back === 0, `${back} out of order`)
        const spread = Math.max(...Array.from({ length: N }, (_, k) => D[3 * k + 1])) - Math.min(...Array.from({ length: N }, (_, k) => D[3 * k + 1]))
        ok('...the floor\'s fall-off seen (its colours spread over a tenth of the scale)', spread > 0.1, spread)
        ok('...the face itself white, the sky black', D[3 * N + 1] > 0.99 && D[3 * (N + 1) + 1] < 1e-3, `${D[3 * N + 1]} ${D[3 * (N + 1) + 1]}`)
    }
}

console.log(`probes on Dawn: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
