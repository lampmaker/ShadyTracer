//======================================================================================================================
// SCATTER INSIDE A MATERIAL ON A REAL WEBGPU in node (0.next; core/haze.js THE MEDIUM'S WALK). Run:
//   node lib/pathtracer/core/test/volume.gpu.mjs
//
// The march's walk, compiled by Dawn (Tint) and run in the whole renderer (raytrace_main.js R.trace, every kernel, the
// real tinywebgpu), on hand-written scenes:
//   - THE KERNELS: the walk in the march only for a scene that says it scatters (scene.scatter), and not otherwise;
//   - THE WALK AGAINST ITS MIRROR: a wide index-matched slab (ior 1: no face does anything) seen head-on in front of a
//     glowing plane, against a black world: each pixel reads the plane's luminance times what the slab passes, which
//     core/haze.js slabWalkJS walks in JS (test/volume.test.mjs holds that to radiative transfer) -- isotropic and
//     forward, thin and thick;
//   - A FURNACE: a sphere of milky glass (n 1.5, its faces smooth: total internal reflection traps what is scattered
//     past the critical angle until it is scattered again), and an index-matched one, under a uniform sky must vanish,
//     light sampling on and off; one that absorbs too must not;
//   - A FLOOR UNDER A MILKY SLAB in the sun: the camera's own paths, the sun's photons (which walk the slab as the
//     camera's rays do and land on the floor) and the photon map, one mean.
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
if (!webgpu) { console.log('(volume GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
const { slabWalkJS } = await import('../haze.js')
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
    console.log(`(volume GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }

/* THE WHOLE RENDERER, as haze.gpu.mjs drives it */
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
                skyIlluminance: 0, nee: 1, lt: 0, ltPhotons: 1, ltLearn: 0, maxbounce: 40, maxiter: 2000, rr: 0, fireflyClamp: 0,
                maxaverages: 0, autoExposure: 0, sppm: 0, sppmRadius: 2, ...over }
    const traced = effective(v)
    const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius, tolerance: scene.tolerance })
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
const paired = (a, b, ix) => {
    const n = ix.length, mb = ix.reduce((s, i) => s + b[i], 0) / n
    const d = ix.map(i => a[i] - b[i]), md = d.reduce((s, x) => s + x, 0) / n
    return { mean: 1 + md / mb, se: Math.sqrt(d.reduce((s, x) => s + (x - md) ** 2, 0) / (n - 1) / n) / mb, of: mb }
}
const pm = p => `${p.mean.toFixed(4)} +- ${p.se.toFixed(4)}`
const all = Array.from({ length: W * H }, (_, i) => i)
const sceneOf = (id, sdf, mats, { scatter = true, envRadius = 3 } = {}) => ({
    id, title: id, unit: 'm', extent: 2, envRadius, uniforms: {}, ...(scatter ? { scatter: true } : {}),
    wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    var m = makeDefaultMaterial();
    ${mats}
    return m;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    ${sdf}
    return C;
}`,
})
const t0 = Date.now()

/* THE WALK AGAINST ITS MIRROR: a slab 0.1 m thick and 10 m wide, index-matched, its mean free path 0.1 / tau, a
   millimetre in front of a plane glowing at 1 cd/m^2 and 100 m wide, seen head-on from 1 m with a 6 degree view (at
   its edge a ray crosses the slab 0.14 % longer); nothing else, the world black -- a uniform 1e-6 cd/m^2, the sun off
   with it (envUniform 0 is the sky, which is not black at 0 lux: what the slab sends back found it, and every slab read
   about 0.016 x its reflectance too bright). Each pixel: 1 x what the slab passes */
{
    const cases = [[1, 0], [3, 0.8], [6, 0.5]]
    for (const [tau, g] of cases) {
        // (Nbox rounds its edges by growing the box 0.01 m every way: these half sizes are 0.01 short of the box's)
        const sdf = `C = add_new(C, Nbox(r.pos, VEC3(4.99, 4.99, 0.04)), 1u);
    C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.0, -0.0625), VEC3(49.99, 49.99, 0.001)), 2u);`
        const mats = `if (idx == 1u) { m.baseColor = vec3<f32>(1.0); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.5; m.transmission = 1.0;
        m.ior = 1.0; m.scatterDistance = ${(0.1 / tau).toFixed(6)}; m.scatterAnisotropy = ${g.toFixed(3)}; }
    if (idx == 2u) { m.emissive = vec3<f32>(1.0); }`
        const scene = sceneOf(`volume-slab-${tau}-${g}`, sdf, mats, { envRadius: 80 })
        const E = await engine(scene)
        if (tau === cases[0][0]) {
            ok('the renderer with a scattering material on Dawn: built, the walk in its march and in no other kernel',
                E.err === null && E.R._built === true && /\bfn mediumDraw\b/.test(E.R.prog_wvfmarch.wgsl) && /\bfn mediumCollide\b/.test(E.R.prog_wvfmarch.wgsl)
                && !/\bfn medium(Draw|Collide)\b/.test(E.R.prog_wvfsurface.wgsl) && !/\bfn medium(Draw|Collide)\b/.test(E.R.prog_wvfshade.wgsl), E.err)
            const clear = await engine({ ...scene, id: 'volume-slab-unmarked', scatter: undefined })
            ok('...and a scene that does not say it scatters has no walk in its march', clear.err === null && !/\bfn medium(Draw|Collide)\b/.test(clear.R.prog_wvfmarch.wgsl), clear.err)
        }
        const cam = CAMERA({ aspect: 1, fov: 6, up: [0, 1, 0] })
        cam.setPose({ pos: [0, 0, 1.05], target: [0, 0, 0], up: [0, 1, 0] })
        const r = await render(E, scene, cam, { envUniform: 1e-6, sunIlluminance: 0 }, 256)
        const s = stats(r.img, all), js = slabWalkJS({ tau, g, rays: 400000, seed: 3 })
        const jse = Math.sqrt(js.T * (1 - js.T) / 400000)
        // the pixels' spread is each one's own noise: 256 samples of a ray that gets through or does not
        console.log(`  AN INDEX-MATCHED SLAB, tau ${tau}, g ${g}: passes ${s.mean.toFixed(4)} +- ${s.se.toFixed(4)} on Dawn, ${js.T.toFixed(4)} +- ${jse.toFixed(4)} walked in JS`
            + ` (${js.steps.toFixed(1)} collisions a ray)`)
        ok(`an index-matched slab of optical depth ${tau}, g ${g}: the march's walk passes what the JS walk does (${s.mean.toFixed(4)} and ${js.T.toFixed(4)})`,
            r.err === null && Math.abs(s.mean - js.T) < 4 * Math.hypot(s.se, jse) + 0.003, r.err ?? '')
    }
}

/* A FURNACE: a sphere 0.3 m across of white milky glass under a uniform sky of luminance 1 must vanish -- every path
   brings back the sky, however it walked -- with its faces smooth glass (total internal reflection keeps what is
   scattered past the critical angle until the next collision turns it), and index-matched; with light sampling on and
   off. The same glass absorbing too (a colour depth of 2 cm at 0.5) must read less. */
{
    const cam = CAMERA({ aspect: 1, fov: 50, up: [0, 0, 1] })
    cam.setPose({ pos: [0, -1.0, 0.0], target: [0, 0, 0], up: [0, 0, 1] })
    const inS = all.filter(i => { const x = ((i % W) + 0.5) / W * 2 - 1, y = (((i / W) | 0) + 0.5) / H * 2 - 1
        return Math.hypot(x, y) * Math.tan(25 * Math.PI / 180) < 0.27 })
    const FURN = {
        'milky glass, n 1.5, g 0': 'm.ior = 1.5; m.scatterDistance = 0.02; m.scatterAnisotropy = 0.0;',
        'milky glass, n 1.5, g 0.8': 'm.ior = 1.5; m.scatterDistance = 0.01; m.scatterAnisotropy = 0.8;',
        'index-matched, g 0.5': 'm.ior = 1.0; m.scatterDistance = 0.02; m.scatterAnisotropy = 0.5;',
    }
    for (const [what, set] of Object.entries(FURN)) {
        const scene = sceneOf(`volume-furnace-${what.replace(/[^a-z0-9]+/g, '-')}`, 'C = add_new(C, Nsphere(r.pos, 0.15), 1u);',
            `if (idx == 1u) { m.baseColor = vec3<f32>(1.0); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.5; m.transmission = 1.0; ${set} }`)
        const E = await engine(scene)
        const on = await render(E, scene, cam, { envUniform: 1, sunIlluminance: 0, nee: 1 }, 192)
        const off = await render(E, scene, cam, { envUniform: 1, sunIlluminance: 0, nee: 0 }, 192)
        const a = stats(on.img, inS), b = stats(off.img, inS)
        console.log(`  FURNACE, ${what}: light sampling on ${a.mean.toFixed(4)} +- ${a.se.toFixed(4)}, off ${b.mean.toFixed(4)} +- ${b.se.toFixed(4)} (${inS.length} pixels)`)
        ok(`the furnace, ${what}: the sphere vanishes, light sampling on and off (ratio 1 within three error bars and 0.001)`,
            on.err === null && off.err === null && Math.abs(a.mean - 1) <= 3 * a.se + 0.001 && Math.abs(b.mean - 1) <= 3 * b.se + 0.001,
            `${on.err} ${off.err}`)
    }
    const scene = sceneOf('volume-furnace-absorbing', 'C = add_new(C, Nsphere(r.pos, 0.15), 1u);',
        'if (idx == 1u) { m.baseColor = vec3<f32>(0.5); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.5; m.transmission = 1.0; m.ior = 1.5; m.attenuationDistance = 0.02; m.scatterDistance = 0.02; }')
    const E = await engine(scene)
    const r = await render(E, scene, cam, { envUniform: 1, sunIlluminance: 0 }, 64)
    ok(`...and one that absorbs too reads less: the furnace can fail (${stats(r.img, inS).mean.toFixed(4)})`, r.err === null && stats(r.img, inS).mean < 0.8)
}

/* A FLOOR UNDER A MILKY SLAB in a 20 degree sun at 70 degrees, a black sky: the floor beneath it lit only through it, seen
   from the side under the slab. The camera's own paths find the sun through the walk by chance; with the sun's photons on
   they leave that light to the photons (the floor is their first surface: CLS_CAND, a walk being no event), which walk the
   slab as the camera's rays do and land on the floor; with the photon map on, the same again -- one mean. */
{
    const sdf = `C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.0, -0.02), VEC3(1.5, 1.5, 0.02)), 4u);
    C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.0, 0.45), VEC3(0.6, 0.6, 0.05)), 1u);`
    const mats = `if (idx == 4u) { m = makeDiffuse(vec3<f32>(0.8), 1.0); }
    if (idx == 1u) { m.baseColor = vec3<f32>(1.0); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.5; m.transmission = 1.0; m.ior = 1.5;
        m.scatterDistance = 0.04; m.scatterAnisotropy = 0.7; }`
    const scene = sceneOf('volume-floor', sdf, mats, { envRadius: 3 })
    const E = await engine(scene)
    const cam = CAMERA({ aspect: 1, fov: 30, up: [0, 0, 1] })
    cam.setPose({ pos: [0.0, -1.6, 0.18], target: [0, 0, 0], up: [0, 0, 1] })
    // the pixels whose ray meets the floor under the slab, well inside its shadow's footprint, and passes under the slab
    const under = all.filter(i => {
        const CU = cam.getUniforms(), M = CU.invView, fx = CU.invProjection[0], fy = CU.invProjection[5]
        const x = ((i % W) + 0.5) / W * 2 - 1, y = (((i / W) | 0) + 0.5) / H * 2 - 1
        const d = [0, 1, 2].map(a => M[a] * x * fx + M[4 + a] * y * fy - M[8 + a]), o = [M[12], M[13], M[14]]
        if (d[2] >= 0) return false
        const t = -o[2] / d[2], p = [o[0] + d[0] * t, o[1] + d[1] * t]
        return Math.abs(p[0]) < 0.3 && Math.abs(p[1]) < 0.3
    })
    const sun = { sunDiameter: 20, uSunElevation: 70, envUniform: 0 }
    const own = await render(E, scene, cam, { ...sun, lt: 0 }, 1024)
    const lt = await render(E, scene, cam, { ...sun, lt: 1, ltPhotons: 2 }, 384)
    const map = await render(E, scene, cam, { ...sun, lt: 1, ltPhotons: 2, sppm: 1 }, 256)
    const l = paired(lt.img, own.img, under), m = paired(map.img, own.img, under)
    console.log(`  A FLOOR UNDER A MILKY SLAB (${under.length} pixels): the camera's own ${l.of.toFixed(0)} cd/m^2, the sun's photons on ${pm(l)},`
        + ` the photon map on ${pm(m)}`)
    ok('a floor under a milky slab: the three renders ran, and the floor is lit through it', [own, lt, map].every(r => r.err === null) && l.of > 10 && under.length >= 30,
        [own, lt, map].map(r => r.err).join(' | ') + ` ${l.of} ${under.length}`)
    ok(`...the sun's photons on: the same mean (they walk the slab and land on the floor; the camera leaves them that), ${pm(l)}`,
        Math.abs(l.mean - 1) < Math.max(0.02, 3.5 * l.se))
    ok(`...the photon map on: the same mean, ${pm(m)}`, Math.abs(m.mean - 1) < Math.max(0.02, 3.5 * m.se))
}

console.log(`volume GPU: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
process.exit(fail ? 1 : 0)
