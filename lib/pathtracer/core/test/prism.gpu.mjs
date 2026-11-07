//======================================================================================================================
// A LIGHT'S OWN SPECTRUM THROUGH A PRISM, the whole renderer on a real WebGPU (0.next; core/lightspectra.js). Run:
//   node lib/pathtracer/core/test/prism.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package (npm i -g webgpu) and a Vulkan driver
// (lavapipe: apt-get install mesa-vulkan-drivers), or it says so and passes.
//
// WHY. The user's two LEDs through a prism (2026-11-07): one peak at 450 nm, 10 nm wide, threw a band of red at the red
// end of its rainbow, and a red LED a band of red in the violet. A photon's wavelength at the glass was drawn by the
// colour's channels, each spread over every wavelength it covers. Now a light given by its own spectrum hands its
// photons that spectrum (optics/sources.js record [4].w, optics/kernels.js prog_opt_photons, Ray.pix PIX_LS), the host
// puts the tables in the renderer's learn buffer (optics/index.js pictureSource), and the shade kernel draws from it
// (materials_pbr.js processMaterial_advanced). This holds that through R.trace, every kernel, the real tinywebgpu and the
// real optics module (createOptics, lightPicture): a collimated beam (a description, not geometry: its photons connect
// to the camera from the wall) into a 30 degree prism of n_d 1.75 and Abbe number 20, entering square on, onto a white
// wall 1.4 m beyond; a pinhole camera looking at the wall. Where each wavelength lands on the wall is Snell's law at
// n(lambda) (spectral.js cauchyN), worked out here:
//   - the 450 nm LED: the red end of the rainbow (where 550 nm and longer land) reads nothing in any channel; the band
//     where 430-470 nm land holds its light, in its own colour (its negative green kept);
//   - the red LED (630 nm, 20 nm): the violet (480 nm and shorter) reads nothing; its band, its colour;
//   - each light given by its colour alone (the same RGB, no spectrum): the old draw, which DOES put red in those places
//     -- so the two checks above can fail.
// WHAT IT CANNOT SHOW: the picture, or speed. Those are the user's (CLAUDE.md).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/* as lenslight.gpu.mjs: lavapipe on one thread and Math.random seeded, so a failure is one a run can repeat */
process.env.LP_NUM_THREADS ??= '0'
{
    let a = 7
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
if (!webgpu) { console.log('(prism GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
const U = await import('../uniforms.schema.js')
const { derive } = await import('../photometry.js')
const { effective } = await import('../../quality.js')
const { RAYTRACER } = await import('../raytrace_main.js')
const { CAMERA } = await import('../../../camera.js')
const { engineCamera } = await import('../units.js')
const { createOptics } = await import('../../optics/index.js')
const { cauchyN } = await import('../spectral.js')
const { spdRGB } = await import('../spd.js')
const { lightSpectrumTable } = await import('../lightspectra.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(prism GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const quietly = async f => {
    const keep = { log: console.log, info: console.info, warn: console.warn }
    console.log = console.info = console.warn = () => { }
    try { return await f() } finally { Object.assign(console, keep) }
}

/* THE PRISM: glass where x > 0, inside the exit face through (X_EXIT, 0, 0) of outward normal (cos A, sin A, 0), and
   |y|, |z| < 0.15 -- the beam along +x meets the entry face square on (its wavelength drawn there, its direction kept)
   and the exit face at A. THE WALL: the plane x = X_WALL, white. */
const A = 30 * Math.PI / 180, ND = 1.75, ABBE = 20, X_EXIT = 0.1, X_WALL = 1.5, BEAM = 0.01, FLUX = 1000
const scene = {
    id: 'prism-gpu', title: 'a beam through a prism onto a wall', unit: 'm', extent: 2.5, envRadius: 2.5, uniforms: {},
    wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    // material 0 is the air around everything (the medium beyond a face a ray leaves glass by): the default, n 1
    var m = makeDefaultMaterial();
    if (idx == 4u) { m = makeDiffuse(vec3<f32>(0.8), 1.0); }
    if (idx == 6u) { m = makeGlassSmooth(vec3<f32>(1.0), ${ND}); m.abbe = ${ABBE}.0; }
    return m;
}
// the prism: the largest of its faces' plane distances (a bound outside, exact inside), with that face's normal
fn prismN(q: VEC3) -> VEC4 {
    var d = VEC4(-1.0, 0.0, 0.0, -q.x);
    let n2 = VEC3(${Math.cos(A)}, ${Math.sin(A)}, 0.0);
    let e = dot(q - VEC3(${X_EXIT}, 0.0, 0.0), n2);
    if (e > d.w) { d = VEC4(n2, e); }
    let a = abs(q.y) - 0.15;
    if (a > d.w) { d = VEC4(0.0, sign(q.y), 0.0, a); }
    let b = abs(q.z) - 0.15;
    if (b > d.w) { d = VEC4(0.0, 0.0, sign(q.z), b); }
    return d;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    let q = r.pos;
    C = add_new(C, prismN(q), 6u);
    C = add_new(C, Nbox(q - VEC3(${X_WALL + 0.005}, -0.6, 0.0), VEC3(0.005, 1.0, 1.0)), 4u);
    return C;
}`,
}
/* WHERE A WAVELENGTH LANDS ON THE WALL (its y; z is the beam's own): out of the exit face at asin(n sin A) from its
   normal, from the face at y = 0 (the beam's centre) */
const wallY = l => {
    const th = Math.asin(cauchyN(ND, ABBE, l) * Math.sin(A))
    const d = [Math.cos(th) * Math.cos(A) + Math.sin(th) * Math.sin(A), Math.cos(th) * Math.sin(A) - Math.sin(th) * Math.cos(A)]
    return d[1] / d[0] * (X_WALL - X_EXIT)
}
/* the beam's spread on the wall about each wavelength's centre: its 2 cm width through the faces and onto the wall at
   its angle -- well under 1.5 cm a side (inferred from the geometry; the margins below are 2 cm and more) */
const W = 64, H = 64, FOV = 28
const Q = { w: W, h: H, resetframecount: 1 }
const R = RAYTRACER(WG, null, Q, scene)
R.hud = () => { }
let initErr = null
try { await quietly(() => R.init()) } catch (e) { initErr = e?.message ?? String(e) }
ok('the renderer on Dawn: built', initErr === null && R._built === true, initErr)
if (initErr) { console.log(`prism GPU: ${pass} passed, ${fail} failed`); process.exit(1) }

const YC = 0.5 * (wallY(400) + wallY(780))
const cam = CAMERA({ aspect: W / H, fov: FOV, up: [0, 0, 1] })
cam.setPose({ pos: [X_WALL - 0.6, YC, 0], target: [X_WALL, YC, 0], up: [0, 0, 1] })
const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
const bag = (() => {
    const v = { ...U.defaultUniformValues(), envMode: 0, sunIlluminance: 0, skyIlluminance: 0, nee: 1, lt: 0, ltPhotons: 1,
                ltLearn: 0, maxbounce: 10, rr: 0, fireflyClamp: 0, maxaverages: 0, autoExposure: 0, sppm: 0 }
    const traced = effective(v)
    const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius })
    const EC = engineCamera({ ...cam.getUniforms(), camLens: [0, 1, 0, 0] }, 0, derived.sceneUnit)
    const types = U.ComputeUniformTypes
    return Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
        ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
        .filter(([k]) => k in types || k in U.UniformSpec))
})()

/* THE REGIONS, by where each pixel's centre ray meets the wall -- the camera's own mapping, read off its uniforms as
   genrays reads them (lenslight.gpu.mjs) */
const CU = cam.getUniforms(), M = CU.invView, fx = CU.invProjection[0], fy = CU.invProjection[5]
const pos = [M[12], M[13], M[14]], right = [M[0], M[1], M[2]], up = [M[4], M[5], M[6]], fwd = [M[8], M[9], M[10]]
const onWall = []
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = ((px + 0.5) / W) * 2 - 1, y = ((py + 0.5) / H) * 2 - 1
    const d = [0, 1, 2].map(a => right[a] * x * fx + up[a] * y * fy - fwd[a])
    const t = (X_WALL - pos[0]) / d[0]
    onWall.push([pos[1] + d[1] * t, pos[2] + d[2] * t])
}
const strip = (l0, l1) => {
    const [a, b] = [wallY(l0), wallY(l1)].sort((p, q) => p - q)
    return [...onWall.keys()].filter(p => onWall[p][0] >= a && onWall[p][0] <= b && Math.abs(onWall[p][1]) < 0.6 * BEAM)
}
// the band each LED's light falls in, with the beam's spread; and where it must not be, 2 cm and more past it
const blueBand = strip(415, 490), redEnd = strip(550, 780)
const redBand = strip(560, 720), violet = strip(380, 480)
ok(`the regions: ${blueBand.length} and ${redBand.length} pixels of the bands, ${redEnd.length} of the red end, ${violet.length} of the violet`,
   blueBand.length >= 10 && redBand.length >= 10 && redEnd.length >= 10 && violet.length >= 10)
console.log(`  on the wall: 400 nm at y ${wallY(400).toFixed(3)} m, 450 at ${wallY(450).toFixed(3)}, 550 at ${wallY(550).toFixed(3)}, 630 at ${wallY(630).toFixed(3)}, 780 at ${wallY(780).toFixed(3)}`)

const O = createOptics(R, WG)
/* A RENDER: each region's mean per channel and its error bar, from batch means of 16 samples (sppm.gpu.mjs THE ERROR
   BARS) */
const render = async (sources, samples, regions) => {
    O.setSources(sources)
    await quietly(() => O.lightPicture(true, 48))
    R.kernelOptions = R.kernelOptionsOf(bag)
    await quietly(() => R.applyKernelOptions())
    Q.resetframecount = 1
    const keys = Object.keys(regions), sums = []
    let err = null
    try {
        for (let done = 0; done < samples; done += 16) {
            await quietly(() => R.trace(Q, bag, 16, target))
            Q.resetframecount = 0
            await WG.device.queue.onSubmittedWorkDone()
            const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array), f = new Float32Array(a.buffer, a.byteOffset, a.length)
            sums.push(Object.fromEntries(keys.map(k => [k, { S: [0, 1, 2].map(c => regions[k].reduce((s, i) => s + f[i * 4 + c] * a[i * 4 + 3], 0)),
                                                             N: regions[k].reduce((s, i) => s + a[i * 4 + 3], 0) }])))
        }
    } catch (e) { err = e?.message ?? String(e) }
    const out = { err }
    for (const k of keys) {
        out[k] = [0, 1, 2].map(c => {
            const g = sums.map((s, j) => (s[k].S[c] - (j ? sums[j - 1][k].S[c] : 0)) / (s[k].N - (j ? sums[j - 1][k].N : 0)))
            const m = g.reduce((s, v) => s + v, 0) / g.length
            return { mean: m, se: Math.sqrt(g.reduce((s, v) => s + (v - m) ** 2, 0) / (g.length - 1) / g.length) }
        })
    }
    return out
}
const fmt = ch => ch.map(c => `${c.mean.toFixed(1)} +- ${c.se.toFixed(1)}`).join(', ')
const beam = extra => [{ type: 'disc', pos: [-0.3, 0, 0], axis: [1, 0, 0], u: [0, 1, 0], size: [BEAM, BEAM],
                         distribution: 'collimated', halfAngle: 90, n: 1, flux: FLUX, emitN: 1, twoSided: false, ...extra }]

for (const [name, spectrum, band, empty, emptyName] of [
    ['the 450 nm LED (10 nm)', { kind: 'peaks', peaks: [{ nm: 450, fwhm: 10, weight: 1 }] }, 'blueBand', 'redEnd', 'the red end (550 nm and longer)'],
    ['the red LED (630 nm, 20 nm)', { kind: 'peaks', peaks: [{ nm: 630, fwhm: 20, weight: 1 }] }, 'redBand', 'violet', 'the violet (480 nm and shorter)']]) {
    const colour = spdRGB(spectrum), hue = lightSpectrumTable({ spectrum }).hue
    const regions = { [band]: band === 'blueBand' ? blueBand : redBand, [empty]: empty === 'redEnd' ? redEnd : violet }
    const own = await render(beam({ colour, spectrum }), 128, regions)
    const rgbOnly = await render(beam({ colour }), 128, regions)
    const B = own[band], E = own[empty], big = Math.max(...B.map(c => Math.abs(c.mean)))
    console.log(`  ${name} by its spectrum: its band ${fmt(B)}; ${emptyName} ${fmt(E)}`)
    console.log(`  ...by its colour alone (the old draw): its band ${fmt(rgbOnly[band])}; ${emptyName} ${fmt(rgbOnly[empty])}`)
    ok(`${name} by its spectrum: rendered, its band lit`, own.err === null && big > 0, own.err ?? String(big))
    ok(`${name} by its spectrum: ${emptyName} reads nothing in any channel (each under 1e-3 of the band's largest, and its error bar)`,
       E.every(c => Math.abs(c.mean) <= 1e-3 * big + 3 * c.se), fmt(E))
    // its band holds all its light: the band's colour the light's own, per unit of its largest channel
    const worst = Math.max(...B.map((c, k) => Math.abs(c.mean / big - hue[k] / Math.max(...hue.map(Math.abs))) ))
    ok(`${name} by its spectrum: its band in its own colour (each channel per its largest within 0.02)`, worst < 0.02,
       `${B.map(c => (c.mean / big).toFixed(4))} against ${hue.map(h => (h / Math.max(...hue.map(Math.abs))).toFixed(4))}`)
    // ...and the check can fail: the old draw, the same light by its colour, puts its red there
    const red = rgbOnly[empty][0]
    ok(`${name} by its colour alone: ${emptyName} has red, as the user saw (so the check above can fail)`,
       rgbOnly.err === null && red.mean > 0.01 * big && red.mean > 3 * red.se, `${red.mean} +- ${red.se} against the band's ${big}`)
}

console.log(`prism GPU: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
