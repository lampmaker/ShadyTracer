//======================================================================================================================
// A LIGHT'S FACE GLOWS ON THE FACE ALONE, ON A REAL WEBGPU (0.79.0; codegen.js object(), ONLY ON THE FACE ITSELF). Run:
//   node builder/test/lightface.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package (npm i -g webgpu) and a Vulkan driver
// (lavapipe: apt-get install mesa-vulkan-drivers), or it says so and passes. Dawn compiles with Tint, the browser's
// compiler, which naga (check-shaders' fourth pass) is not.
//
// WHY. A light's face is a sheet of no thickness, and the march calls a point within the surface tolerance a hit, so
// what a ray can meet of it is the face grown by the tolerance all round: a rim beyond every edge, its normal turned.
// The rim glowed. Light sampling aims at the face alone (lightFaceArea) and the photons start on it alone, so the
// camera's paths finding the light by its glow saw a larger light than they did. With light sampling on, MIS gives a
// small face's glow almost nothing (its density there is tens per steradian against the floor's cos/pi) and the
// picture was right; with it off, the rim counted in full. Measured on lavapipe (2026-10-23, seed 1, the region
// below, 512 samples on and 8192 off), one 0.1 x 0.05 m face over a matte floor against the closed form, before the
// fix: on 0.9957 +- 0.0026, off 1.0504 +- 0.0157; the face twice as large, off 1.0196 +- 0.0074; four times 1.0069
// +- 0.0036; eight times 1.0016 +- 0.0018 (on within 0.3 % of it at every size). The tolerance ten times the automatic
// one (5.2 mm): off 1.2456 +- 0.0160, on 0.9997 +- 0.0032; a tenth of it, off 1.0078 +- 0.0144. So the gap followed the
// tolerance over the face's size, and off was the one wrong. After the fix, at ten times the tolerance, off read 0.9949
// +- 0.0157; at the automatic one 1.0293 +- 0.0154, 0.9816 +- 0.0102 and 0.9983 +- 0.0107 on seeds 1 to 3. That was
// the gap a floor under twelve such lights showed (light sampling on 0.94-0.98 of off): off too bright, not on too dark.
// maxbounce 1, 2 and 6 changed nothing here (no light but the face's comes back to the floor).
//
// What it holds:
//   - THE SDF, codegen and as data: a point on the face's front the light's material, one beyond an edge (within the
//     tolerance, where the march would stop) the back's -- black, or clear for a transparent light -- for a rectangle
//     and a disc, turned and scaled, one-sided and two-sided;
//   - THE WHOLE RENDERER (R.trace): a white matte floor under one small face, light tracing off, at ten times the
//     automatic tolerance -- where the rim made off 25 % too bright -- light sampling on and off each the closed form
//     (rho / pi times the face's luminance integrated over it, cos cos / r^2) and each other's, pixel by pixel.
// WHAT IT CANNOT SHOW: the picture, or speed. Those are the user's (CLAUDE.md).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/* as sppm.gpu.mjs: lavapipe on one thread, so the queues' order is the same every run, and every seed the renderer draws
   from Math.random from this one (mulberry32) -- a failure here is then one run can repeat */
process.env.LP_NUM_THREADS ??= '0'
{
    let a = (Number(process.env.LIGHTFACE_GPU_SEED ?? 1) >>> 0) || 1
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
if (!webgpu) { console.log('(light face GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { PRESETS } = await import('../materials.js')
const { generate } = await import('../codegen.js')
const { sourceTable } = await import('../sources.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const U = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive, LUMA } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])            // kept: the Dawn instance must outlive the device (scenedata.gpu.mjs)
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(light face GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
const at = (x, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale })
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// the uniforms the renderer would have: every schema default, what derive() works out, the scene's own (scenedata.gpu.mjs)
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(U.UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* ONE KERNEL, `n` threads: `body` writes 16 floats at evalOut[16i] for thread i, reading evalIn (lightarray.gpu.mjs) */
async function run(scene, body, input, n) {
    const touch = Object.keys(scene.resources || {}).map(k => `_ = ${k}[0];`).join(' ')
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${U.sceneConstantsWGSL(scene)}${scene.wgsl}`, `
        _ = UB.res; _ = evalIn[0]; ${touch}
        let i = gid.x;
        if (i >= ${n}u) { return; }
        ${body}`, U.computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) },
        { async: false, wg: [64, 1, 1] })
    await prog.ready
    const inB = WG.createStorageBuffer(new Float32Array(Math.max(4, input.length))), outB = WG.createStorageBuffer(64 * n)
    WG.device.queue.writeBuffer(inB.b, 0, new Float32Array(input))
    const buffers = scene.init ? await scene.init(WG) : {}
    prog.resources = { evalIn: inB.b, evalOut: outB.b, ...buffers }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    return out
}

/*----------------------------------------------------------------------------------------------------------------------
  THE SDF AT EACH LIGHT'S FACE, ITS EDGE AND ITS BACK. Four lights, turned and scaled (a light's width is in its own
  frame, times its scale): a rectangle, a disc, a transparent rectangle, a two-sided disc. At each, from the sources'
  frame (sources.js, the JS the photons start from): a point a hair in front of the face's middle, one a hair past its
  edge (within the scene's tolerance, so the march would stop there), and one a hair behind its middle.
----------------------------------------------------------------------------------------------------------------------*/
{
    const doc = M.createDoc({})
    M.addLight(doc, 'root', { id: 'rect', shape: 'rectangle', params: { width: 0.3, height: 0.1 }, transform: at(0, 0, 1, 20, -10, 35, 1.5) })
    M.addLight(doc, 'root', { id: 'disc', shape: 'disc', params: { radius: 0.1 }, transform: at(1, 0, 1, -30, 15, 0, 0.8) })
    M.addLight(doc, 'root', { id: 'clear', shape: 'rectangle', params: { width: 0.2, height: 0.2 }, transform: at(0, 1, 1, 0, 40, 10), transparent: true })
    M.addLight(doc, 'root', { id: 'both', shape: 'disc', params: { radius: 0.15 }, transform: at(1, 1, 1, 70, 0, -20, 1.2), twoSided: true })
    ok('the probe scene: sound', M.validate(doc).length === 0, JSON.stringify(M.validate(doc)))
    const src = sourceTable(doc).sources
    const eps = 1e-4 * (generate(...M.generateArgs(doc, { id: 'lf-probe' })).extent ?? 1)    // the automatic tolerance's order
    const h = eps / 4
    const input = [], want = []
    for (const s of src) {
        const v = cross(s.normal, s.u)
        const mid = s.origin.map((c, k) => c + s.u[k] * s.half[0] * 0.5 + v[k] * s.half[1] * 0.25)
        const edge = s.origin.map((c, k) => c + s.u[k] * (s.half[0] + 2 * h))       // past the edge along u, in the plane
        for (const [p, side, where] of [[mid, 1, 'front'], [edge, 1, 'rim'], [mid, -1, 'back']]) {
            input.push(...p.map((c, k) => c + s.normal[k] * h * side), 0, ...s.normal.map(c => -c * side), 0)
            want.push([s.id, where])
        }
    }
    for (const [how, data] of [['codegen', false], ['as data', true]]) {
        const scene = generate(...M.generateArgs(doc, { id: `lf-probe-${data ? 'd' : 'c'}`, data }))
        const id = name => +scene.wgsl.match(new RegExp(`const ${name}: u32 = (\\d+)u;`))[1]
        const BLACK = id('MATID_BLACK'), CLEAR = id('MATID_CLEAR')
        const out = await run(scene, `
            let r = newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0);
            let c = SDF(r);
            evalOut[16u * i] = f32(c.m); evalOut[16u * i + 1u] = c.s.w;`, input, want.length)
        const expect = ([L, where]) => where === 'front' || (where === 'back' && L === 'both') ? id(`matid_${L}`) : L === 'clear' ? CLEAR : BLACK
        const got = want.map((w, k) => [w[0], w[1], out[16 * k], expect(w), out[16 * k + 1]])
        const bad = got.filter(([, , m, e, d]) => m !== e || Math.abs(d) > 4 * h)
        ok(`${how}: each light's front its own material, past its edge and behind it the back's (black, clear for a transparent one; a two-sided one's back its own)`,
            bad.length === 0, JSON.stringify(bad))
    }
}

/*----------------------------------------------------------------------------------------------------------------------
  THE WHOLE RENDERER (raytrace_main.js R.trace, every kernel, the real tinywebgpu): a white matte floor under one
  0.1 x 0.05 m face 0.6 m up facing down, light tracing off (no optics module here to give the light's photons), so the
  camera's paths own the light: by its glow, and with light sampling on also by sampling it, weighed by MIS. At ten
  times the automatic tolerance, where the rim made light sampling off 1.2456 +- 0.0160 of the closed form. The camera
  is below the face's plane, so no eye ray meets the light: the floor alone is in view.
----------------------------------------------------------------------------------------------------------------------*/
{
    const { RAYTRACER } = await import('../../lib/pathtracer/core/raytrace_main.js')
    const { CAMERA } = await import('../../lib/camera.js')
    const { engineCamera } = await import('../../lib/pathtracer/core/units.js')
    const { effective } = await import('../../lib/pathtracer/quality.js')
    const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
        console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }

    const ALBEDO = 0.8
    const d = M.createDoc({})
    // specular 0: the floor Lambertian, rho / pi, which the closed form is
    M.addMaterial(d, { id: 'matte', params: { ...PRESETS.diffuse.params(), baseColor: { r: ALBEDO, g: ALBEDO, b: ALBEDO }, specular: 0 } })
    M.addObject(d, 'root', { id: 'floor', primitive: 'box', material: 'matte', params: { size: { x: 1.5, y: 1.5, z: 0.05 }, rounding: 0 }, transform: at(0, 0, -0.05) })
    M.addLight(d, 'root', { id: 'led', shape: 'rectangle', params: { width: 0.1, height: 0.05 }, transform: at(0, 0, 0.6, 180, 0, 0) })
    const auto = generate(...M.generateArgs(d, { id: 'lf-auto' }))
    M.setTolerance(d, 10 * 1e-4 * auto.extent)                    // ten times the automatic (photometry.js EPS_SHARE)
    const scene = generate(...M.generateArgs(d, { id: 'lf-render' }))
    const L = scene.uniforms.emissiveLuminance_led.def
    const face = sourceTable(d).sources[0]

    const W = 32, H = 32
    const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
    const cam = CAMERA({ aspect: W / H, fov: 50, up: [0, 0, 1] })
    cam.setPose({ pos: [0, -1.2, 0.35], target: [0, 0, 0], up: [0, 0, 1] })
    const render = async (over, samples) => {
        const Q = { w: W, h: H, resetframecount: 1 }
        const R = RAYTRACER(WG, null, Q, scene)
        R.hud = () => { }
        let err = null
        try { await quietly(() => R.init()) } catch (e) { err = e?.message ?? String(e) }
        const v = { ...U.defaultUniformValues(), envMode: 0, sunIlluminance: 0, skyIlluminance: 0, nee: 1, lt: 0, maxbounce: 6, rr: 0,
                    fireflyClamp: 0, maxaverages: 0, autoExposure: 0, sppm: 0, ...over }
        const traced = effective(v)
        const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius, tolerance: scene.tolerance })
        const EC = engineCamera(cam.getUniforms(), 0, derived.sceneUnit)
        const bag = Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
            ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
            .filter(([k]) => k in U.ComputeUniformTypes || k in U.UniformSpec))
        for (const [k, u] of Object.entries(scene.uniforms || {})) bag[k] = flat(u.def)
        if (!err) try {
            R.kernelOptions = R.kernelOptionsOf(bag)
            await quietly(() => R.applyKernelOptions())
            for (let done = 0; done < samples; done += 16) {
                await quietly(() => R.trace(Q, bag, Math.min(16, samples - done), target))
                Q.resetframecount = 0
                await WG.device.queue.onSubmittedWorkDone()            // one at a time (sppm.gpu.mjs: dozens queued ended the process)
            }
        } catch (e) { err = e?.message ?? String(e) }
        const a = err ? null : await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
        const f = a && new Float32Array(a.buffer, a.byteOffset, a.length)
        return { err, eps: derived.epsAuto, img: f ? Array.from({ length: W * H }, (_, i) => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]) : [] }
    }

    // the floor point (z = 0) through a point (px, py) of the image, in pixels, from the pinhole
    const CU = cam.getUniforms(), Mv = CU.invView, fx = CU.invProjection[0], fy = CU.invProjection[5]
    const right = [Mv[0], Mv[1], Mv[2]], up = [Mv[4], Mv[5], Mv[6]], back = [Mv[8], Mv[9], Mv[10]], eye = [Mv[12], Mv[13], Mv[14]]
    const floorAt = (px, py) => {
        const x = (px / W) * 2 - 1, y = (py / H) * 2 - 1
        const dv = [0, 1, 2].map(a => right[a] * x * fx + up[a] * y * fy - back[a])
        const t = -eye[2] / dv[2]
        return t > 0 ? [eye[0] + dv[0] * t, eye[1] + dv[1] * t] : null
    }
    // E at (x, y, 0): L times the sum of cos cos / r^2 dA over the face, by the midpoint rule
    const irradiance = (x, y, N = 24) => {
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
    /* THE REGION BY GEOMETRY, never by a picture's own values (lightarray.gpu.mjs): every pixel whose whole footprint is
       on the floor's top within 0.6 of the centre */
    const region = []
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const cs = [[px, py], [px + 1, py], [px, py + 1], [px + 1, py + 1]].map(([a, b]) => floorAt(a, b))
        if (cs.every(q => q && Math.hypot(q[0], q[1]) < 0.6)) region.push(px + W * py)
    }
    // ...and the closed form there, over a 4 x 4 grid of each pixel's footprint (its box filter)
    const pred = region.map(i => {
        const px = i % W, py = (i - px) / W
        let s = 0
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { const q = floorAt(px + (a + 0.5) / 4, py + (b + 0.5) / 4); s += irradiance(q[0], q[1]) }
        return ALBEDO / Math.PI * s / 16
    })
    // two pictures pixel by pixel (diffuse.gpu.mjs paired), and a picture over the closed form, pixel by pixel
    const paired = (a, b) => {
        const n = region.length, mb = region.reduce((s, i) => s + b[i], 0) / n
        const dd = region.map(i => a[i] - b[i]), md = dd.reduce((s, x) => s + x, 0) / n
        return { mean: 1 + md / mb, se: Math.sqrt(dd.reduce((s, x) => s + (x - md) ** 2, 0) / (n - 1) / n) / mb }
    }
    const closed = img => {
        const q = region.map((i, k) => img[i] / pred[k]), n = q.length, m = q.reduce((s, x) => s + x, 0) / n
        return { mean: m, se: Math.sqrt(q.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1) / n) }
    }
    const pm = p => `${p.mean.toFixed(4)} +- ${p.se.toFixed(4)}`
    const t0 = Date.now()
    const on = await render({ nee: 1 }, 512), off = await render({ nee: 0 }, 8192)
    ok('the two renders ran', on.err === null && off.err === null, `${on.err} | ${off.err}`)
    if (on.err === null && off.err === null) {
        const pOn = closed(on.img), pOff = closed(off.img), p = paired(on.img, off.img)
        console.log(`  a floor under a 0.1 x 0.05 m face at a ${(on.eps * 1e3).toFixed(2)} mm tolerance (${region.length} pixels),`
            + ` ${((Date.now() - t0) / 1000).toFixed(0)} s: light sampling on ${pm(pOn)} of the closed form, off ${pm(pOff)}; on ${pm(p)} of off`)
        /* WITHIN 3.5 STANDARD ERRORS, and never looser than 1 % for on (its error 0.3 %) or 2 % for off: the rim made off
           25 % too bright here. On sat 0.2-0.4 % under the closed form at every size and tolerance measured (the floor's
           pixels and the closed form's 4 x 4 grid of each are not the same filter), within its floor. */
        const agree = (q, floor) => Math.abs(q.mean - 1) < Math.max(floor, 3.5 * q.se)
        ok(`light sampling on is the closed form, ${pm(pOn)}`, region.length > 200 && agree(pOn, 0.01), pm(pOn))
        ok(`light sampling off is the closed form (the face alone glowing, as light sampling and the photons see it), ${pm(pOff)}`, agree(pOff, 0.02), pm(pOff))
        ok(`...and on is off, pixel by pixel, ${pm(p)}`, agree(p, 0.02), pm(p))
    }
}

console.log(`light faces on Dawn: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
