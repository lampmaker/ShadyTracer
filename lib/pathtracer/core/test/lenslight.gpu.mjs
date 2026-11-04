//======================================================================================================================
// A FACELESS LIGHT SEEN THROUGH THE LENS, the whole renderer on a real WebGPU (0.next; core/lens.js). Run:
//   node lib/pathtracer/core/test/lenslight.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package (npm i -g webgpu) and a Vulkan driver
// (lavapipe: apt-get install mesa-vulkan-drivers), or it says so and passes.
//
// WHY. A ray file is no geometry, so no camera ray meets it, and its photons connected only from the surfaces they
// landed on: looking at the light itself through a lens with an aperture, the user saw nothing (2026-11-04). Its
// photons crossing the lens now add themselves where they land on the picture. This holds that through R.trace, every
// kernel, the real tinywebgpu and the real optics module (createOptics, setRayData, lightPicture), on a Lambertian
// disc of radius 0.25 m and 1000 lm facing a camera 1 m off, focused on it, with a lens of radius 0.1 m; a black plate
// halfway covers the disc's right half:
//   - A RAY SET (the user's case): rays drawn from that disc into a file of FILE_RAYS. The picture's left half of the
//     disc reads what those rays put there -- the file's own picture through the lens, worked out here in JS from the
//     same rays (lens.js lensCross and lensSplat, which lens.test.mjs holds to the camera's own measurement) -- within
//     its error bar, and that is the disc's luminance  Phi / (pi^2 r^2)  within the file's own counting noise. Its
//     right half, behind the plate, reads nothing.
//   - Both ways a crossing is found: the camera inside the scene's radius (the march marks the step) and outside it
//     (the photon left the scene short of the lens, and shade finds the crossing ahead).
//   - THE SAME LIGHT AS A DESCRIPTION (a disc that is not geometry, as a bench writes one): its luminance, no file.
//   - NOT SEEN: through a pinhole (a radius of 0), as before; and a builder sheet's light (onSurface) never adds a
//     crossing: its face is the camera's to see.
//   - IN ITS RAYS' OWN COLOURS (0.next): a spectral file's rays light the picture each in its own wavelength's colour --
//     a half of the disc at 450 nm seen in a mirror exactly that colour, and as bright as its rays make it, in lm and W.
// WHAT IT CANNOT SHOW: the picture, or speed. Those are the user's (CLAUDE.md).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/* as sppm.gpu.mjs: lavapipe on one thread, so the queues' order is the same every run, and every seed the renderer draws
   from Math.random from this one (mulberry32) -- a failure here is then one run can repeat */
process.env.LP_NUM_THREADS ??= '0'
{
    let a = 1
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
if (!webgpu) { console.log('(lens light GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
const U = await import('../uniforms.schema.js')
const { derive, LUMA } = await import('../photometry.js')
const { effective } = await import('../../quality.js')
const { RAYTRACER } = await import('../raytrace_main.js')
const { CAMERA } = await import('../../../camera.js')
const { engineCamera } = await import('../units.js')
const { lensCross, lensSplat, lensImage } = await import('../lens.js')
const { createOptics } = await import('../../optics/index.js')
const { RAYSET_VEC4 } = await import('../../optics/kernels.js')
const { placeRays } = await import('../../optics/sources.js')
const { cieAt } = await import('../spd.js')
const { XYZ_TO_RGB709 } = await import('../colorimetry.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(lens light GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
// the renderer's own console chatter, kept out of the report unless something fails
const quietly = async f => {
    const keep = { log: console.log, info: console.info, warn: console.warn }
    console.log = console.info = console.warn = () => { }
    try { return await f() } finally { Object.assign(console, keep) }
}

/* THE LIGHT, THE PLATE, THE CAMERA. The disc at the origin facing -y; the camera at y = -1 looking along +y. The plate
   at y = -0.5 covers x > 0. Seen from a point P of the disc, the lens's disc (radius LENS, 1 m off) is a cone whose
   section at the plate is LENS / 2 round the halfway point: wholly clear of the plate for P.x < -LENS, wholly behind it
   for P.x > LENS -- the two regions, by the pixels' points on the disc, with a margin. */
const R_DISC = 0.25, FLUX = 1000, LENS = 0.1, CAM_Y = -1, PLATE_Y = -0.5
const L_DISC = FLUX / (Math.PI * Math.PI * R_DISC * R_DISC)            // a Lambertian disc's luminance, cd/m^2
const scene = {
    id: 'lens-light-gpu', title: 'a faceless light behind half a plate', unit: 'm', extent: 2, envRadius: 2, uniforms: {},
    wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    var m = makeDefaultMaterial();
    m = makeDiffuse(vec3<f32>(0.0), 1.0);
    return m;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    C = add_new(C, Nbox(r.pos - VEC3(0.3, ${PLATE_Y}, 0.0), VEC3(0.3, 0.005, 0.4)), 4u);
    return C;
}`,
}
const W = 40, H = 40, FOV = 40
const Q = { w: W, h: H, resetframecount: 1 }
const R = RAYTRACER(WG, null, Q, scene)
R.hud = () => { }
let initErr = null
try { await quietly(() => R.init()) } catch (e) { initErr = e?.message ?? String(e) }
ok('the renderer on Dawn: built', initErr === null && R._built === true, initErr)
if (initErr) { console.log(`lens light GPU: ${pass} passed, ${fail} failed`); process.exit(1) }

const cam = CAMERA({ aspect: W / H, fov: FOV, up: [0, 0, 1] })
cam.setPose({ pos: [0, CAM_Y, 0], target: [0, 0, 0], up: [0, 0, 1] })
const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()

const bagOf = ({ lens = LENS, envRadius = 2, focus = -CAM_Y } = {}) => {
    const v = { ...U.defaultUniformValues(), envMode: 0, sunIlluminance: 0, skyIlluminance: 0, nee: 1, lt: 0, ltPhotons: 1,
                ltLearn: 0, maxbounce: 10, rr: 0, fireflyClamp: 0, maxaverages: 0, autoExposure: 0, sppm: 0 }
    const traced = effective(v)
    const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius })
    // focused on the disc: 1 m along the axis (its image in the mirror, below, further)
    const EC = engineCamera({ ...cam.getUniforms(), camLens: [lens, focus, 0, 0] }, 0, derived.sceneUnit)
    const types = U.ComputeUniformTypes
    return Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
        ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
        .filter(([k]) => k in types || k in U.UniformSpec))
}

/* THE REGIONS, by where each pixel's centre is on the disc's plane (the focus plane: every ray of the pixel meets it
   there, lens.js) -- the camera's own mapping, read off its uniforms as genrays reads them */
const CU = cam.getUniforms(), M = CU.invView, fx = CU.invProjection[0], fy = CU.invProjection[5]
const C = { pos: [M[12], M[13], M[14]], right: [M[0], M[1], M[2]], up: [M[4], M[5], M[6]], fwd: [M[8], M[9], M[10]], fx, fy, F: -CAM_Y }
const onDisc = []
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = ((px + 0.5) / W) * 2 - 1, y = ((py + 0.5) / H) * 2 - 1
    const d = [0, 1, 2].map(a => C.right[a] * x * fx + C.up[a] * y * fy - C.fwd[a])
    const t = -C.pos[1] / d[1]
    onDisc.push([C.pos[0] + d[0] * t, C.pos[2] + d[2] * t])
}
const inside = (p, m) => Math.hypot(...onDisc[p]) < R_DISC - m
const clear = [...onDisc.keys()].filter(p => inside(p, 0.03) && onDisc[p][0] < -LENS - 0.02)
const behind = [...onDisc.keys()].filter(p => inside(p, 0.03) && onDisc[p][0] > LENS + 0.02)
const whole = [...onDisc.keys()].filter(p => inside(p, 0.03))
ok(`the regions: ${clear.length} pixels of the disc clear of the plate, ${behind.length} wholly behind it`, clear.length >= 40 && behind.length >= 40)

/* THE RAY FILE: rays from the disc, uniform on it and Lambertian about -y, weight 1, as the host places a file's
   (optics/sources.js placeRays: position and weight, direction and 0, in the scene's unit) */
const FILE_RAYS = 1 << 20
const fileRng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(2026)
const rays = new Float32Array(FILE_RAYS * RAYSET_VEC4 * 4)
for (let k = 0; k < FILE_RAYS; k++) {
    const r = R_DISC * Math.sqrt(fileRng()), a = 2 * Math.PI * fileRng()
    const u = fileRng(), b = 2 * Math.PI * fileRng(), s = Math.sqrt(u)
    rays.set([r * Math.cos(a), 0, r * Math.sin(a), 1, s * Math.cos(b), -Math.sqrt(1 - u), s * Math.sin(b), 0], k * 8)
}
/* ...AND ITS OWN PICTURE THROUGH THE LENS, worked out from the same rays: each that crosses the disc of the lens clear of
   the plate puts FLUX / FILE_RAYS times lensSplat on the pixel its ray through the lens meets -- the mean of what the
   renderer's photons, each one of these rays drawn at random, add to that pixel a sample */
const apx = 4 * fx * fy / (W * H)
const expected = new Float64Array(W * H)
let crossing = 0
for (let k = 0; k < FILE_RAYS; k++) {
    const P = [rays[k * 8], rays[k * 8 + 1], rays[k * 8 + 2]], d = [rays[k * 8 + 4], rays[k * 8 + 5], rays[k * 8 + 6]]
    // the plate: x > 0 at y = PLATE_Y (inside its 0.6 x 0.8 m face)
    const tp = (PLATE_Y - P[1]) / d[1], xp = P[0] + d[0] * tp, zp = P[2] + d[2] * tp
    if (xp > 0 && xp < 0.6 && Math.abs(zp) < 0.4) continue
    const x = lensCross(P, d, C, LENS)
    if (!x) continue
    crossing++
    const xy = lensImage(x.off.map((v, i) => C.pos[i] + v), d.map(c => -c), C)
    if (!xy || Math.abs(xy[0]) >= 1 || Math.abs(xy[1]) >= 1) continue
    const p = Math.min(W - 1, Math.floor((xy[0] + 1) / 2 * W)) + W * Math.min(H - 1, Math.floor((xy[1] + 1) / 2 * H))
    expected[p] += FLUX / FILE_RAYS * lensSplat(x.cos, LENS, apx)
}
const meanOf = (img, region) => region.reduce((s, p) => s + img[p], 0) / region.length

const O = createOptics(R, WG)
O.setRayData('file', rays)
const lumOf = a => { const f = new Float32Array(a.buffer, a.byteOffset, a.length); return i => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2] }
/* A RENDER: the region means and their error bars from batch means (sppm.gpu.mjs THE ERROR BARS) -- every 16 samples
   new photons, so those means are independent and their spread the mean's own standard error */
const render = async (sources, samples, opts = {}, regions = { clear, behind }) => {
    O.setSources(sources)
    await quietly(() => O.lightPicture(true, 48))
    const bag = bagOf(opts)
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
            const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array), lum = lumOf(a)
            sums.push(Object.fromEntries(keys.map(k => [k, { S: regions[k].reduce((s, i) => s + lum(i) * a[i * 4 + 3], 0),
                                                             N: regions[k].reduce((s, i) => s + a[i * 4 + 3], 0) }])))
        }
    } catch (e) { err = e?.message ?? String(e) }
    const out = { err, plan: R.photonPlan }
    for (const k of keys) {
        const g = sums.map((s, j) => (s[k].S - (j ? sums[j - 1][k].S : 0)) / (s[k].N - (j ? sums[j - 1][k].N : 0)))
        const m = g.reduce((s, v) => s + v, 0) / g.length
        out[k] = { mean: m, se: Math.sqrt(g.reduce((s, v) => s + (v - m) ** 2, 0) / (g.length - 1) / g.length) }
    }
    return out
}
const pm = (a, b) => `${a.mean.toFixed(0)} +- ${a.se.toFixed(0)} against ${b.toFixed(0)}`
const within = (a, b) => Math.abs(a.mean - b) <= 3 * a.se + 1e-3 * b

const fileSet = [{ type: 'rayset', rays: 'file', flux: FLUX, emitN: 1 }]
const want = meanOf(expected, clear)
/* THE FILE'S OWN NOISE: about this many of its rays land in the clear region's pixels, each one a draw; their count's
   spread is the file's picture's own, and it is the file, not the renderer: a ray file through a lens is its rays */
const inClear = Math.round(want * clear.length / (FLUX / FILE_RAYS * lensSplat(1, LENS, apx)))
console.log(`  the disc: ${L_DISC.toFixed(0)} cd/m^2. The file of ${FILE_RAYS} rays: ${crossing} cross the lens clear of the plate,`
    + ` about ${inClear} into the clear region, whose picture they make ${want.toFixed(0)} cd/m^2 (${(want / L_DISC).toFixed(4)} of the disc's)`)
ok('the file\'s own picture through the lens is the disc\'s luminance, within its counting noise (3 / sqrt n)',
    Math.abs(want / L_DISC - 1) < 3 / Math.sqrt(inClear), `${want} against ${L_DISC}`)

for (const [label, envRadius] of [['the camera inside the scene\'s radius (the march marks the step)', 2],
                                  ['the camera outside it (the photon left the scene short of the lens)', 0.7]]) {
    const r = await render(fileSet, 256, { envRadius })
    console.log(`  ${label}: clear ${pm(r.clear, want)}; behind the plate ${r.behind.mean.toFixed(1)}`)
    ok(`a ray file through the lens, ${label}: rendered`, r.err === null, r.err)
    ok(`...the disc clear of the plate reads the file's own picture, within three standard errors`, within(r.clear, want), pm(r.clear, want))
    ok('...and behind the plate nothing', r.behind.mean < 1e-3 * L_DISC, String(r.behind.mean))
}

{
    const desc = [{ type: 'disc', pos: [0, 0, 0], axis: [0, -1, 0], u: [1, 0, 0], size: [R_DISC, R_DISC],
                    distribution: 'cosine', halfAngle: 90, n: 1, flux: FLUX, emitN: 1, twoSided: false }]
    const r = await render(desc, 256)
    console.log(`  the same disc as a description: clear ${pm(r.clear, L_DISC)}; behind the plate ${r.behind.mean.toFixed(1)}`)
    ok('the same light as a description (no face, no file): the disc\'s luminance, within three standard errors', r.err === null && within(r.clear, L_DISC), pm(r.clear, L_DISC))
    ok('...and behind the plate nothing', r.behind.mean < 1e-3 * L_DISC, String(r.behind.mean))
    const pin = await render(desc, 32, { lens: 0 }, { whole })
    ok('through a pinhole (a radius of 0) not seen, as before', pin.err === null && pin.whole.mean === 0, String(pin.whole.mean))
    const sheet = await render(desc.map(s => ({ ...s, onSurface: true })), 32, {}, { whole })
    ok('a builder sheet\'s light (onSurface: its face the camera\'s to see) adds no crossing', sheet.err === null && sheet.whole.mean === 0, String(sheet.whole.mean))
}

/* IN A MIRROR, AND NOT AFTER A WALL. The disc turned to face +y, a plane 0.5 m beyond it: a perfect mirror for x < 0, a
   white wall for x > 0; the camera 0.5 m behind the disc (which is no geometry: it sees through it), focused on the
   disc's image 1.5 m off. Through the mirror the disc is seen, at its luminance -- a delta event keeps the photon
   LT_FACELESS. The wall is lit by the photons' connections (ltConnect), and a photon it scattered is -1 after: through
   the lens it must read what the pinhole's picture of it reads, or its light would be counted twice. */
{
    const MIRROR_Y = 0.5, EYE_Y = -0.5, FOCUS = 2 * MIRROR_Y - EYE_Y
    const mirrorScene = {
        id: 'lens-light-mirror', title: 'a faceless light in a mirror, and on a wall', unit: 'm', extent: 2, envRadius: 2, uniforms: {},
        wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    var m = makeDiffuse(vec3<f32>(0.8), 1.0);
    if (idx == 5u) { m = makeMirror(vec3<f32>(1.0)); }
    return m;
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    C = add_new(C, Nbox(r.pos - VEC3(-0.5, ${MIRROR_Y + 0.005}, 0.0), VEC3(0.5, 0.005, 0.6)), 5u);
    C = add_new(C, Nbox(r.pos - VEC3(0.5, ${MIRROR_Y + 0.005}, 0.0), VEC3(0.5, 0.005, 0.6)), 4u);
    return C;
}`,
    }
    let swapErr = null
    try { await quietly(() => R.setScene(mirrorScene)) } catch (e) { swapErr = e?.message ?? String(e) }
    ok('the mirror and the wall: built', swapErr === null, swapErr)
    cam.setPose({ pos: [0, EYE_Y, 0], target: [0, MIRROR_Y, 0], up: [0, 0, 1] })
    const CU2 = cam.getUniforms(), M2 = CU2.invView
    const C2 = { pos: [M2[12], M2[13], M2[14]], right: [M2[0], M2[1], M2[2]], up: [M2[4], M2[5], M2[6]], fwd: [M2[8], M2[9], M2[10]] }
    // where each pixel's centre ray meets the plane y (unfolded through the mirror: the disc's image is at FOCUS)
    const at = (p, y) => {
        const x = ((p % W + 0.5) / W) * 2 - 1, yy = ((Math.floor(p / W) + 0.5) / H) * 2 - 1
        const d = [0, 1, 2].map(a => C2.right[a] * x * CU2.invProjection[0] + C2.up[a] * yy * CU2.invProjection[5] - C2.fwd[a])
        const t = (y - C2.pos[1]) / d[1]
        return [C2.pos[0] + d[0] * t, C2.pos[2] + d[2] * t]
    }
    /* the disc's image clear of the wall: the lens's cone from an image point P meets the mirror's plane LENS / 3 round
       P * 2/3 (the mirror a third of the way back from the image to the lens) */
    const inMirror = [...Array(W * H).keys()].filter(p => {
        const P = at(p, FOCUS)
        return Math.hypot(...P) < R_DISC - 0.03 && P[0] * 2 / 3 + LENS / 3 < -0.02
    })
    // the wall, away from the mirror's edge
    const onWall = [...Array(W * H).keys()].filter(p => { const P = at(p, MIRROR_Y); return P[0] > 0.12 && Math.abs(P[1]) < 0.3 })
    ok(`the regions: ${inMirror.length} pixels of the disc in the mirror, ${onWall.length} of the wall`, inMirror.length >= 20 && onWall.length >= 40)
    const desc = [{ type: 'disc', pos: [0, 0, 0], axis: [0, 1, 0], u: [1, 0, 0], size: [R_DISC, R_DISC],
                    distribution: 'cosine', halfAngle: 90, n: 1, flux: FLUX, emitN: 1, twoSided: false }]
    const regions = { inMirror, onWall }
    const lens = await render(desc, 256, { focus: FOCUS }, regions), pin = await render(desc, 256, { lens: 0, focus: FOCUS }, regions)
    console.log(`  in the mirror: ${pm(lens.inMirror, L_DISC)}; the wall through the lens ${pm(lens.onWall, pin.onWall.mean)} (the pinhole's)`)
    ok('a faceless light in a mirror, through the lens: its luminance, within three standard errors',
        lens.err === null && within(lens.inMirror, L_DISC), pm(lens.inMirror, L_DISC))
    const se2 = Math.hypot(lens.onWall.se, pin.onWall.se)
    ok('...and the wall it lights reads the same through the lens as through a pinhole: no photon it scattered counted twice',
        pin.err === null && pin.onWall.mean > 0 && Math.abs(lens.onWall.mean - pin.onWall.mean) <= 3 * se2,
        `${lens.onWall.mean} +- ${lens.onWall.se} against ${pin.onWall.mean} +- ${pin.onWall.se}`)

    /* IN ITS RAYS' OWN COLOURS (0.next; optics/sources.js RAY COLOURS, kernels.js RAY_COLOUR): a spectral file -- the disc's
       left half at 450 nm, its right half at 610 nm -- seen in the mirror. The left half's image is lit by 450 nm rays
       alone, so its colour is exactly that wavelength's (a negative channel and all: every photon there carries the same
       colour, so no noise in the ratio), and its luminance what those rays make by the same arithmetic in JS, unfolded
       through the mirror: in lm, every ray its own luminous flux; in W, y-bar times its radiant flux, times K. */
    const MONO = [450, 610]
    const monoRays = new Float32Array(FILE_RAYS * RAYSET_VEC4 * 4)
    for (let k = 0; k < FILE_RAYS; k++) {
        const r = R_DISC * Math.sqrt(fileRng()), a = 2 * Math.PI * fileRng()
        const u = fileRng(), b = 2 * Math.PI * fileRng(), st = Math.sqrt(u)
        const x = r * Math.cos(a)
        monoRays.set([x, 0, r * Math.sin(a), 1, st * Math.cos(b), Math.sqrt(1 - u), st * Math.sin(b), x < 0 ? MONO[0] : MONO[1]], k * 8)
    }
    O.setRayData('mono', monoRays)
    const C3 = { ...C2, fx: CU2.invProjection[0], fy: CU2.invProjection[5], F: FOCUS }
    const apx3 = 4 * C3.fx * C3.fy / (W * H)
    const yb = l => cieAt(l)[1]
    const mono = cieAt(MONO[0]), monoRGB = XYZ_TO_RGB709.map(r => (r[0] * mono[0] + r[1] * mono[1] + r[2] * mono[2]) / mono[1])
    for (const unit of ['lm', 'W']) {
        // K (sources.js RAY COLOURS): the set's mean luminance 1 over every ray drawn
        const K = unit === 'lm' ? 1 : 2 / (yb(MONO[0]) + yb(MONO[1]))
        const exp3 = new Float64Array(W * H)
        for (let k = 0; k < FILE_RAYS; k++) {
            const P = [monoRays[k * 8], 0, monoRays[k * 8 + 2]], d = [monoRays[k * 8 + 4], monoRays[k * 8 + 5], monoRays[k * 8 + 6]]
            const t = (MIRROR_Y - P[1]) / d[1], Hp = [P[0] + d[0] * t, MIRROR_Y, P[2] + d[2] * t]
            if (!(Hp[0] < 0 && Hp[0] > -1 && Math.abs(Hp[2]) < 0.6)) continue          // the mirror's half of the plane
            const dr = [d[0], -d[1], d[2]], x = lensCross(Hp, dr, C3, LENS)
            if (!x) continue
            const xy = lensImage(x.off.map((v, i) => C3.pos[i] + v), dr.map(c => -c), C3)
            if (!xy || Math.abs(xy[0]) >= 1 || Math.abs(xy[1]) >= 1) continue
            const p = Math.min(W - 1, Math.floor((xy[0] + 1) / 2 * W)) + W * Math.min(H - 1, Math.floor((xy[1] + 1) / 2 * H))
            const l = monoRays[k * 8 + 7], lum = unit === 'lm' ? K : yb(l) * K
            exp3[p] += FLUX / FILE_RAYS * lensSplat(x.cos, LENS, apx3) * lum
        }
        const want3 = meanOf(exp3, inMirror)
        const r = await render([{ type: 'rayset', rays: 'mono', flux: FLUX, emitN: 1, unit }], 256, { focus: FOCUS }, { inMirror })
        const a = await R.accumulation_u32.r(W * H * 16, 0, Uint32Array), f = new Float32Array(a.buffer, a.byteOffset, a.length)
        const rgb = [0, 1, 2].map(c => inMirror.reduce((s, i) => s + f[i * 4 + c], 0) / inMirror.length)
        const Yg = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2]
        const worst = Math.max(...rgb.map((v, c) => Math.abs(v / Yg - monoRGB[c])))
        console.log(`  a file in ${unit} at 450 and 610 nm, its 450 nm half in the mirror: ${pm(r.inMirror, want3)} cd/m^2;`
            + ` its colour per unit luminance ${rgb.map(v => (v / Yg).toFixed(3))} against 450 nm's ${monoRGB.map(v => v.toFixed(3))}`)
        ok(`a spectral file in ${unit}: the half at 450 nm in the mirror reads what its rays make, within three standard errors`,
            r.err === null && within(r.inMirror, want3), pm(r.inMirror, want3))
        ok('...in exactly 450 nm\'s colour, a negative channel and all (each channel per unit luminance within 1e-3)', worst < 1e-3, `worst ${worst}`)
    }

    /* AT ITS HEADER'S WAVELENGTH, INFRARED (0.next; optics/sources.js rayFileColour, the user's 854 nm LED, 2026-11-04): a
       flux-only file in W, every ray placed at 854 nm and the wavelength chosen (ownWavelength) -- no light in the picture
       at all, as a camera sees it. The same rays not chosen (a wavelength only read) keep the set's white, as before. */
    const irRays = placeRays(monoRays, { wavelength: 854 })          // (the same layout as a file's rays: placed through no frame)
    O.setRayData('ir', irRays)
    const irDark = await render([{ type: 'rayset', rays: 'ir', flux: FLUX, emitN: 1, unit: 'W', ownWavelength: true }], 32, { focus: FOCUS }, { inMirror, onWall })
    const irPale = await render([{ type: 'rayset', rays: 'ir', flux: FLUX, emitN: 1, unit: 'W' }], 32, { focus: FOCUS }, { inMirror, onWall })
    console.log(`  854 nm chosen: in the mirror ${irDark.inMirror.mean}, the wall ${irDark.onWall.mean}; not chosen: ${irPale.inMirror.mean.toFixed(0)}, ${irPale.onWall.mean.toFixed(1)}`)
    ok('an infrared file at its header\'s wavelength lights nothing: the mirror\'s image and the wall exactly 0',
        irDark.err === null && irDark.inMirror.mean === 0 && irDark.onWall.mean === 0, `${irDark.inMirror.mean} ${irDark.onWall.mean}`)
    ok('...and the same rays with their wavelength only read stay white and lit, as before', irPale.inMirror.mean > 0.5 * L_DISC && irPale.onWall.mean > 0)
}

console.log(`lens light GPU: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
