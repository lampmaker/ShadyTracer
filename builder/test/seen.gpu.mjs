//======================================================================================================================
// WHAT THE CAMERA SEES, MARCHED ON A REAL WEBGPU (0.next; core/field.js SEEN). Run:
//   node builder/test/seen.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package (npm i -g webgpu) and a Vulkan driver
// (lavapipe: apt-get install mesa-vulkan-drivers), or it says so and passes.
//
// WHY. The print export's colours as lit (builder/exportbox.js, index.js viewColours) are the view's own picture at each
// point of the part -- and only where the camera sees that point: one hidden behind something else would take the
// colour of what hides it. The field kernel's SEEN mode answers it, marching the scene's field from each point towards
// the camera. What it holds, through the renderer's own R.field on the builder's scene (a box and a ball in front of
// it, in metres and in millimetres):
//   - a point of the box's front the camera sees: seen; one behind the ball: hidden -- each against the exact answer, a
//     ray from the point to the camera against the ball, away from the ball's silhouette by a margin;
//   - a point of the box's back face: hidden (the march goes through the box);
//   - the orthographic camera: along the view's axis, the same;
//   - the field and the colour modes, after the kernel was restructured to one SDF call site, as before: the box's
//     field at grid points its exact distance, a point's colour its material's.
// WHAT IT CANNOT SHOW: a picture (CLAUDE.md).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.LP_NUM_THREADS ??= '0'
let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(seen GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { PRESETS } = await import('../materials.js')
const { generate } = await import('../codegen.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const U = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')
const { RAYTRACER } = await import('../../lib/pathtracer/core/raytrace_main.js')
const { FIELD_SEEN, FIELD_GRID, FIELD_POINTS, fieldInput } = await import('../../lib/pathtracer/core/field.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(seen GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
const at = (x, y = 0, z = 0) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
    console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }

for (const unit of ['m', 'mm']) {
    const s = unit === 'mm' ? 1000 : 1                     // the same scene, its numbers in the unit's
    const d = M.createDoc({}); d.unit = unit
    M.addMaterial(d, { id: 'red', params: { ...PRESETS.diffuse.params(), baseColor: { r: 0.8, g: 0.1, b: 0.1 } } })
    M.addMaterial(d, { id: 'grey', params: { ...PRESETS.diffuse.params(), baseColor: { r: 0.5, g: 0.5, b: 0.5 } } })
    // a box of 0.4 x 0.4 x 0.4 at the origin (`size` its half-extents), its front face (the camera's side) at y = -0.2;
    // a ball of 0.1 in front of it
    M.addObject(d, 'root', { id: 'box', primitive: 'box', material: 'red', params: { size: { x: 0.2 * s, y: 0.2 * s, z: 0.2 * s }, rounding: 0 }, transform: at(0, 0, 0) })
    const B = [0, -0.5 * s, 0], RB = 0.1 * s
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere', material: 'grey', params: { radius: RB }, transform: at(...B) })
    const scene = generate(...M.generateArgs(d, { id: `seen-${unit}` }))
    const R = RAYTRACER(WG, null, { w: 16, h: 16, resetframecount: 1 }, scene)
    R.hud = () => { }
    const v = U.defaultUniformValues()
    const bag = Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
        ...derive(v, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius, tolerance: scene.tolerance }) })
        .filter(([k]) => k in U.ComputeUniformTypes || k in U.UniformSpec))
    for (const [k, u] of Object.entries(scene.uniforms || {})) bag[k] = flat(u.def)

    // points of the box's front face, a grid over it, each started 2 mm off it along its normal (-y)
    const cam = [0, -2 * s, 0.05 * s], off = 0.002 * s
    const pts = []
    for (let i = 0; i < 21; i++) for (let j = 0; j < 21; j++) pts.push([(-0.18 + 0.36 * i / 20) * s, -0.2 * s - off, (-0.18 + 0.36 * j / 20) * s])
    // ...and a few on its back face (+y), whose way to the camera goes through the box
    const back = [[0, 0.2 * s + off, 0], [0.1 * s, 0.2 * s + off, -0.1 * s], [-0.15 * s, 0.2 * s + off, 0.15 * s]]
    const all = [...pts, ...back]
    // the exact answer: the segment from the point to the camera against the ball; how far its line passes from the centre
    const missBy = (P, C) => {
        const dv = C.map((x, a) => x - P[a]), L = Math.hypot(...dv), u = dv.map(x => x / L)
        const w = B.map((x, a) => x - P[a]), t = Math.max(0, Math.min(L, w[0] * u[0] + w[1] * u[1] + w[2] * u[2]))
        return Math.hypot(...w.map((x, a) => x - u[a] * t)) - RB
    }
    const run = async (input, n) => { let out = null; await quietly(async () => { out = await R.field(bag, input, n) }); return out }
    const persp = await run(fieldInput({ mode: FIELD_SEEN, count: all.length, origin: cam, points: Float32Array.from(all.flat()), eps: 0.5 * off }), all.length)
    ok(`${unit}: the march ran`, !!persp && persp.length === all.length)
    if (persp) {
        let wrong = 0, near = 0, hidden = 0
        pts.forEach((P, k) => {
            const m = missBy(P, cam)
            if (Math.abs(m) < 0.01 * s) { near++; return }              // within 1 cm of the silhouette: not judged
            const want = m > 0 ? 1 : 0
            if (persp[k] !== want) wrong++
            if (!want) hidden++
        })
        ok(`${unit}: every point of the front face seen or hidden as a ray to the camera past the ball says (${pts.length - near} judged, ${hidden} behind the ball)`,
            wrong === 0 && hidden > 10 && hidden < pts.length - near - 10, `${wrong} wrong`)
        ok(`${unit}: the back face's points hidden: the way to the camera goes through the box`, back.every((_, k) => persp[pts.length + k] === 0), [...persp.slice(pts.length)].join())
    }
    // the orthographic camera: along the view's axis (-y towards it), as far as the scene goes
    const ortho = await run(fieldInput({ mode: FIELD_SEEN, count: all.length, ax: [0, -1, 0], points: Float32Array.from(all.flat()), eps: 0.5 * off, far: 3 * s, ortho: true }), all.length)
    if (ortho) {
        let wrong = 0
        pts.forEach((P, k) => {
            const r = Math.hypot(P[0] - B[0], P[2] - B[2]) - RB                      // the ball's shadow along -y is a disc
            if (Math.abs(r) < 0.01 * s) return
            if (ortho[k] !== (r > 0 ? 1 : 0)) wrong++
        })
        ok(`${unit}: orthographic, along the view's axis: behind the ball's disc hidden, the rest seen`, wrong === 0 && back.every((_, k) => ortho[pts.length + k] === 0), `${wrong} wrong`)
    } else ok(`${unit}: the orthographic march ran`, false)

    // THE OTHER MODES, through the restructured kernel: the field at grid points, a point's colour
    const g = await run(fieldInput({ mode: FIELD_GRID, count: 3, origin: [0, -0.3 * s, 0], ax: [0, 0.05 * s, 0], ay: [0, 0, 0], az: [0, 0, 0], nx: 3, ny: 1 }), 3)
    // along y at x = z = 0 from -0.3: the ball 0.1 away (|-0.3 + 0.5| - 0.1) and the box 0.1; then -0.25, 0.05; -0.2, on the box
    ok(`${unit}: GRID: the field at points on the axis between the ball and the box, their distances`,
        g && [0.1, 0.05, 0].every((want, k) => Math.abs(g[k] - want * s) < 1e-4 * s), g && [...g].join())
    const c = await run(fieldInput({ mode: FIELD_POINTS, count: 2, points: Float32Array.from([0, -0.2 * s, 0, B[0], B[1] - RB, B[2]]) }), 8)
    ok(`${unit}: POINTS: the box's colour on the box, the ball's on the ball`,
        c && Math.abs(c[0] - 0.8) < 1e-3 && Math.abs(c[1] - 0.1) < 1e-3 && Math.abs(c[4] - 0.5) < 1e-3, c && [...c].join())
}

console.log(`seen on Dawn: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
