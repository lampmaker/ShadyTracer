//======================================================================================================================
// A RAY WARP ON A REAL WEBGPU (0.next; builder/warp.js, codegen.js THE RAY WARPS, lib/pathtracer/core/warp.js). Run:
//   node builder/test/warp.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package (npm i -g webgpu) and a Vulkan driver
// (lavapipe: apt-get install mesa-vulkan-drivers), or it says so and passes. Dawn compiles with Tint, the browser's
// compiler, which naga (check-shaders' fourth pass) is not.
//
// What it holds:
//   - sceneWarp, the scene's own function, called on Dawn against its JS twin -- in a moved, turned and scaled group:
//     outside the region the step ends just past its surface and nothing else changes; inside, the template changes
//     nothing but the step (no longer than the warp's); a twist turns the direction by rotZ(rate ds) in the region's
//     frame; a ray moved lands where the frame's point is in the world; tint and glow per unit of the frame's length;
//     stop() said; a direction of nothing changes nothing;
//   - THE WHOLE RENDERER (raytrace_main.js R.trace, every kernel, the real tinywebgpu), the camera inside a warp's region
//     in a scene with nothing else to see:
//       glow and stop(): every pixel exactly the glow times the length walked (the warp's steps to pathLength > 1.95);
//       dir: every ray turned straight up sees the zenith, one value over the whole picture, where without the warp
//       the picture runs from the horizon to the zenith;
//       pos: a ray heading for a black floor moved above it and sent up sees the sky, so no pixel is black, where
//       without the warp the whole picture is the floor.
// What a warp looks like in a real scene is the user's to judge.
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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
if (!webgpu) { console.log('(ray warp GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { PRESETS } = await import('../materials.js')
const { generate } = await import('../codegen.js')
const { matrixOf } = await import('../transform.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { WARP_FLAGS } = await import('../../lib/pathtracer/core/warp.js')
const U = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive, LUMA } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(ray warp GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
const at = (x, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale })
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }

function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(U.UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* ONE KERNEL, `n` threads: `body` writes 16 floats at evalOut[16i] for thread i, reading evalIn (lightface.gpu.mjs) */
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
    prog.resources = { evalIn: inB.b, evalOut: outB.b }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    return out
}

//----------------------------------------------------------------------------------------------------------------------
// sceneWarp against its JS twin, in a moved, turned and scaled frame
//----------------------------------------------------------------------------------------------------------------------
{
    // the frames' twin (warp.test.mjs holds it the inverse of itself): a mat4 as WGSL reads it, columns
    const col = (m, c) => [m[4 * c], m[4 * c + 1], m[4 * c + 2], m[4 * c + 3]]
    const rotOf = m => [0, 1, 2].map(c => col(m, c).slice(0, 3))
    const mul = (R, v) => [0, 1, 2].map(i => R[0][i] * v[0] + R[1][i] * v[1] + R[2][i] * v[2])
    const mulT = (R, v) => R.map(c => c[0] * v[0] + c[1] * v[1] + c[2] * v[2])
    const xfPoint = (p, m) => { const t = col(m, 3); return mulT(rotOf(m), [p[0] - t[0], p[1] - t[1], p[2] - t[2]]).map(x => x / t[3]) }
    const warpUp = (q, m) => { const t = col(m, 3); const r = mul(rotOf(m), q.map(x => x * t[3])); return [t[0] + r[0], t[1] + r[1], t[2] + r[2]] }
    const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l) }

    const G = at(0.3, -0.2, 0.5, 20, -10, 35, 2), O = at(0.1, 0, 0.05, 0, 30, 0, 0.5)
    const chain = [G, O].map(t => Array.from(matrixOf(t)))
    const R = chain.reduce((A, m) => { const B = rotOf(m); return [0, 1, 2].map(c => mul(A, B[c])) }, [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    const s = 2 * 0.5, STEP = 0.02, RADIUS = 0.4          // the ball's radius in its own frame: 0.4 x 1 = 0.4 in the world
    const cases = [
        ['template', M.newWarp(STEP).code],
        ['twist', 'dir = rotZ(rate * ds) * dir;'],
        ['moved', 'pos = p + VEC3(0.1, -0.05, 0.2);'],
        ['tint and glow', 'tint = VEC3(0.5, 0.25, 0.8); glow = VEC3(1.0, 2.0, 3.0);'],
        ['stopped', 'stop();'],
        ['nothing', 'dir = VEC3(0.0);'],
    ]
    for (const [name, code] of cases) {
        const d = M.createDoc({})
        M.addGroup(d, 'root', { id: 'g', transform: G })
        M.addObject(d, 'g', { id: 'w', code: 'C = add_new(C, Nsphere(p, radius), MATERIAL);', params: { radius: RADIUS, rate: 3 }, transform: O })
        M.setWarp(d, 'w', { ...M.newWarp(STEP), code })
        const scene = generate(...M.generateArgs(d, { id: `warp-${name.replace(/\W/g, '')}` }))
        const centre = warpUp(warpUp([0, 0, 0], chain[1]), chain[0])
        // a point inside (a quarter of the radius off the middle) and one outside, 0.3 past the surface, each with a
        // direction and a step the scene would allow (0.5, far longer than the warp's)
        const inside = centre.map((c, k) => c + [0.05, -0.04, 0.06][k])
        const outside = centre.map((c, k) => c + [0, 0, RADIUS * s + 0.3][k])
        const dir = norm([0.3, 0.8, -0.2]), tol = 1e-3
        const pts = [inside, outside]
        const input = pts.flatMap(p => [...p, 0, ...dir, 0])
        const out = await run(scene, `
            var w: WarpIO;
            w.pos = evalIn[2u * i].xyz; w.dir = evalIn[2u * i + 1u].xyz;
            w.mult = vec3<f32>(1.0); w.add = vec3<f32>(0.0); w.step = 0.5; w.ltot = 0.0; w.tol = ${tol};
            w.bounces = 0u; w.photon = 0u; w.seed = 7u; w.flags = 0u;
            let o = sceneWarp(w);
            evalOut[16u * i] = o.pos.x; evalOut[16u * i + 1u] = o.pos.y; evalOut[16u * i + 2u] = o.pos.z;
            evalOut[16u * i + 3u] = o.dir.x; evalOut[16u * i + 4u] = o.dir.y; evalOut[16u * i + 5u] = o.dir.z;
            evalOut[16u * i + 6u] = o.mult.x; evalOut[16u * i + 7u] = o.mult.y; evalOut[16u * i + 8u] = o.mult.z;
            evalOut[16u * i + 9u] = o.add.x; evalOut[16u * i + 10u] = o.add.y; evalOut[16u * i + 11u] = o.add.z;
            evalOut[16u * i + 12u] = o.step; evalOut[16u * i + 13u] = f32(o.flags);
            evalOut[16u * i + 14u] = sceneWarpDist(evalIn[2u * i].xyz);`, input, pts.length)
        const get = k => ({ pos: [0, 1, 2].map(j => out[16 * k + j]), dir: [3, 4, 5].map(j => out[16 * k + j]), mult: [6, 7, 8].map(j => out[16 * k + j]),
                            add: [9, 10, 11].map(j => out[16 * k + j]), step: out[16 * k + 12], flags: out[16 * k + 13], dist: out[16 * k + 14] })
        const I = get(0), X = get(1)
        const close = (a, b, e = 2e-5) => a.every((x, j) => Math.abs(x - b[j]) <= e)
        // OUTSIDE: the step to 0.3 + tol past the surface, nothing else
        ok(`${name}: outside, the step ends just past the region's surface and nothing else changes`,
            X.flags === 0 && Math.abs(X.step - (0.3 + tol)) < 2e-5 && close(X.dir, dir) && close(X.pos, outside) && close(X.mult, [1, 1, 1]) && close(X.add, [0, 0, 0])
            && Math.abs(X.dist - 0.3) < 2e-5, JSON.stringify(X))
        // INSIDE: the step the warp's, in the region's flags
        const ls = STEP / s
        let want = { dir, pos: inside, mult: [1, 1, 1], add: [0, 0, 0], flags: WARP_FLAGS.IN }
        if (name === 'twist') {
            const a = 3 * ls, c = Math.cos(a), sn = Math.sin(a)
            const l = mulT(R, dir), t = [c * l[0] - sn * l[1], sn * l[0] + c * l[1], l[2]]
            want.dir = norm(mul(R, t))
        }
        if (name === 'moved') {
            let q = inside; for (const m of chain) q = xfPoint(q, m)
            let b = q.map((x, k) => x + [0.1, -0.05, 0.2][k]); for (const m of [...chain].reverse()) b = warpUp(b, m)
            want.pos = b; want.flags |= WARP_FLAGS.MOVED
        }
        if (name === 'tint and glow') { want.mult = [0.5, 0.25, 0.8].map(x => x ** ls); want.add = [1, 2, 3].map(x => x * ls) }
        if (name === 'stopped') want.flags |= WARP_FLAGS.STOPPED
        ok(`${name}: inside, the step the warp's (${STEP}) and the ray as its code says`,
            I.flags === want.flags && Math.abs(I.step - STEP) < 1e-6 && close(I.dir, want.dir) && close(I.pos, want.pos, 5e-5) && close(I.mult, want.mult) && close(I.add, want.add),
            `got ${JSON.stringify(I)}\n      want ${JSON.stringify(want)}`)
    }
}

//----------------------------------------------------------------------------------------------------------------------
// the whole renderer, the camera inside a warp's region
//----------------------------------------------------------------------------------------------------------------------
{
    const { RAYTRACER } = await import('../../lib/pathtracer/core/raytrace_main.js')
    const { CAMERA } = await import('../../lib/camera.js')
    const { engineCamera } = await import('../../lib/pathtracer/core/units.js')
    const { effective } = await import('../../lib/pathtracer/quality.js')
    const W = 16, H = 16
    const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
    const cam = CAMERA({ aspect: W / H, fov: 60, up: [0, 0, 1] })
    cam.setPose({ pos: [0, 0, 0], target: [0, 1, 0], up: [0, 0, 1] })          // level: half the picture below the horizon
    const render = async (scene, over = {}, samples = 4) => {
        const Q = { w: W, h: H, resetframecount: 1 }
        const R = RAYTRACER(WG, null, Q, scene)
        R.hud = () => { }
        let err = null
        try { await quietly(() => R.init()) } catch (e) { err = e?.message ?? String(e) }
        const v = { ...U.defaultUniformValues(), envMode: 0, sunIlluminance: 0, skyIlluminance: 0, nee: 1, lt: 0, maxbounce: 4, rr: 0,
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
            await quietly(() => R.trace(Q, bag, samples, target))
            await WG.device.queue.onSubmittedWorkDone()
        } catch (e) { err = e?.message ?? String(e) }
        const a = err ? null : await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
        const f = a && new Float32Array(a.buffer, a.byteOffset, a.length)
        return { err, rgb: f ? Array.from({ length: W * H }, (_, i) => [f[i * 4], f[i * 4 + 1], f[i * 4 + 2]]) : [] }
    }
    const lum = c => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
    const docWith = (warpCode, { floor = false } = {}) => {
        const d = M.createDoc({})
        if (floor) {
            M.addMaterial(d, { id: 'black', params: { ...PRESETS.diffuse.params(), baseColor: { r: 0, g: 0, b: 0 }, specular: 0 } })
            M.addObject(d, 'root', { id: 'floor', primitive: 'plane', material: 'black', transform: at(0, 0, -1) })
        }
        M.addObject(d, 'root', { id: 'w', code: 'C = add_new(C, Nsphere(p, 10.0), MATERIAL);', params: {} })
        if (warpCode != null) M.setWarp(d, 'w', { ...M.newWarp(0.1), code: warpCode })
        return d
    }
    const sceneOf = (d, id) => generate(...M.generateArgs(d, { id }))

    // GLOW AND STOP: 21 steps of 0.1 (pathLength 0, 0.1 ... 2.0 when the 21st starts, > 1.95), so every pixel (1, 2, 3) x 2.1
    {
        const s = sceneOf(docWith('glow = VEC3(1.0, 2.0, 3.0);\nif (pathLength > 1.95) { stop(); }'), 'warp-glow')
        const r = await render(s)
        ok('glow and stop: the render ran', r.err === null, r.err)
        const want = [2.1, 4.2, 6.3]
        const worst = r.rgb.reduce((m, c) => Math.max(m, ...c.map((x, k) => Math.abs(x - want[k]) / want[k])), 0)
        ok(`glow and stop: every pixel the glow times the length walked, (1, 2, 3) x 2.1 (worst ${worst.toExponential(2)})`, r.rgb.length === W * H && worst < 1e-4,
            JSON.stringify(r.rgb.slice(0, 3)))
    }
    // DIR: every ray turned straight up sees the zenith
    {
        const sky = { skyIlluminance: 10000 }
        const plainR = await render(sceneOf(docWith(null), 'warp-none'), sky)
        const upR = await render(sceneOf(docWith('dir = VEC3(0.0, 0.0, 1.0);'), 'warp-up'), sky)
        ok('dir: the renders ran', plainR.err === null && upR.err === null, `${plainR.err} | ${upR.err}`)
        const L0 = plainR.rgb.map(lum), L1 = upR.rgb.map(lum)
        const spread = a => (Math.max(...a) - Math.min(...a)) / Math.max(...a)
        ok(`dir: without it the sky runs from the horizon up (spread ${spread(L0).toFixed(3)}), turned up one value (${spread(L1).toExponential(2)})`,
            L1.every(x => x > 0) && spread(L1) < 1e-3 && spread(L0) > 0.02)
    }
    // POS: a ray heading for the black floor moved above it and sent up -- the camera looking 45 degrees down, so every ray
    // (15 to 75 degrees down) meets the floor without the warp, and the plane z = -0.5 within the region with it
    {
        cam.setPose({ pos: [0, 0, 0], target: [0, 1, -1], up: [0, 0, 1] })
        const sky = { skyIlluminance: 10000 }
        const plainR = await render(sceneOf(docWith(null, { floor: true }), 'warp-floor'), sky)
        const movedR = await render(sceneOf(docWith('if (p.z < -0.5) { pos = VEC3(p.x, p.y, 0.5); dir = VEC3(0.0, 0.0, 1.0); }', { floor: true }), 'warp-moved'), sky)
        ok('pos: the renders ran', plainR.err === null && movedR.err === null, `${plainR.err} | ${movedR.err}`)
        const dark = r => r.rgb.filter(c => lum(c) < 1e-6).length
        ok(`pos: without it the black floor fills the picture (${dark(plainR)} of ${W * H} black), moved above it none is (${dark(movedR)})`,
            dark(plainR) === W * H && dark(movedR) === 0)
    }
}

console.log(`ray warps on Dawn: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
