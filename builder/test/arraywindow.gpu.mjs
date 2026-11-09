//======================================================================================================================
// THE WINDOW OF AN ARRAY ON A REAL WEBGPU (0.79.0; builder/arrays.js). Run: node builder/test/arraywindow.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package (npm i -g webgpu) and a Vulkan driver
// (lavapipe: apt-get install mesa-vulkan-drivers), or it says so and passes. Dawn compiles with Tint.
//
// A row of spheres in a turned and scaled group, a ring of boxes, a ring of rows of spheres (an array in an array), and
// a row of light faces -- beside a sphere of their own at the top -- their content boxes given through the real
// cullBoxes (from boxes made by the estimate, as measured ones would be), generated with the window and without it,
// codegen, as data and baked (the build the page shows once edits stop), the SDF run on Dawn:
//   - at points on every surface (moved onto them by the field's own distance and normal): the same distance and the
//     same material with the window as without -- where the march decides a hit and the normal is taken -- to f32's
//     precision, a window's copy being worked out from copy 0 (arrCopy), and but at a face's very edge;
//   - at points all round: never above the field without the window (a lower bound, safe to march by), and below it
//     somewhere (the copies left out did stand in by their bound);
//   - and with every box unknown, the text the window's and the field the one without it, everywhere;
//   - the bench's own row and ring (bench/lightarray.js) through the engine's march kernel: the steps a camera ray takes
//     with the window about those without it, and every ray ending as it did. A count, the same on any card.
// WHAT IT CANNOT SHOW: what a step costs, the speed, or the picture -- the user's (Tests > lightarray, BENCH.lightarray).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(array window GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, boxLoName, boxHiName } = await import('../codegen.js')
const { estimateBox } = await import('../bounds.js')
const { cullBoxes, cullUniforms, createBoxes } = await import('../boxes.js')
const { prog_tagfield, tagSample, TAG_FIELD_WORDS, fieldInput, FIELD_GRID } = await import('../../lib/pathtracer/core/field.js')
const { sourceTable } = await import('../sources.js')
const { contentKey } = await import('../arrays.js')
const { baked } = await import('../bake.js')
const { liveInBench } = await import('../../bench/bake.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { computeUniformTypes, sceneConstantsWGSL, UniformSpec } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')
const { prog_march, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../../lib/pathtracer/core/tracebasics.js')
const { lightArrayDoc, CAMERA: BENCH_CAMERA } = await import('../../bench/lightarray.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])            // kept: the Dawn instance must outlive the device (scenedata.gpu.mjs)
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(array window GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}
console.warn = () => { }

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* the field at each point (s.xyzw, the material): every resource named in main, so each is bound (lightarray.gpu.mjs) */
async function field(scene, pts) {
    const n = pts.length / 3
    const touch = Object.keys(scene.resources || {}).map(k => `_ = ${k}[0];`).join(' ')
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.wgsl}`, `
        _ = UB.res; _ = evalIn[0]; ${touch}
        let i = gid.x;
        if (i >= ${n}u) { return; }
        let h = SDF(newRay(evalIn[i].xyz, VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.0));
        evalOut[8u * i] = h.s.x; evalOut[8u * i + 1u] = h.s.y; evalOut[8u * i + 2u] = h.s.z; evalOut[8u * i + 3u] = h.s.w;
        evalOut[8u * i + 4u] = f32(h.m);`, computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) },
        { async: false, wg: [64, 1, 1] })
    await prog.ready
    const input = new Float32Array(4 * n)
    for (let i = 0; i < n; i++) input.set(pts.slice(3 * i, 3 * i + 3), 4 * i)
    const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(32 * n)
    const buffers = scene.init ? await scene.init(WG) : {}
    prog.resources = { evalIn: inB.b, evalOut: outB.b, ...buffers }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    return out
}

let seed = 4242
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const N = 3072
const at = (x, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale })

/* THE BOXES, as measured ones would be: each node's estimate in its own frame, a cell of 0.01 -- through the real
   cullBoxes, which makes the content boxes the window reads */
const estimated = doc => {
    const own = id => { const n = M.find(doc, id)?.node; return n ? estimateBox({ kind: 'group', children: [{ ...n, transform: null }] }) : null }
    return { fresh: () => true, get: id => { const e = own(id); return e ? { ...e, cell: 0.01 } : null }, missing: () => [] }
}
const boxesOf = (doc, B = estimated(doc)) => ({ top: cullBoxes(doc, B), nested: cullBoxes(doc, B, { nested: true }) })
/* ...OR MEASURED, as the page and the bench measure them (bench/index.js boxesFor, createBoxes over the scene's tags at a
   lattice of points; stepcache.gpu.mjs measure): what Tests > lightarray ran with */
async function measured(doc, scene) {
    const prog = await prog_tagfield(WG, scene); await prog.ready
    const sample = async input => {
        const count = new Uint32Array(input.buffer, input.byteOffset, 4)[3]
        const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(Math.max(4 * TAG_FIELD_WORDS * count, 256))
        prog.resources = { fieldIn: inB.b, fieldOut: outB.b }
        prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
        prog.run(count, 1, 1)
        const out = await outB.r(4 * TAG_FIELD_WORDS * count, 0, Float32Array)
        inB.b.destroy(); outB.b.destroy()
        return tagSample(out, scene)
    }
    const B = createBoxes({ sample, doc: () => doc }); await B.update()
    return B
}
/* the scene with its content boxes written, as the page writes them: codegen's uniforms, or the records */
const withBoxes = (scene, doc, { data, B }) => {
    // in place, on a scene made for it: a data scene's buffers are made from its own `data` (scenedata.js attachData)
    const out = scene
    out.uniforms = structuredClone(scene.uniforms)
    const { top, nested } = boxesOf(doc, B)
    if (data) { out.data = scene.dataOf(M.toTree(doc, { keepDisabled: true }), nested).data; return out }
    for (const [id, b] of top) {
        if (!(boxLoName(id) in out.uniforms)) continue
        const { lo, hi } = cullUniforms(b)
        out.uniforms[boxLoName(id)].def = lo; out.uniforms[boxHiName(id)].def = hi
    }
    return out
}
/* points moved onto the nearest surface by the field's own distance and normal, a few times */
async function onSurfaces(scene, pts) {
    const P = pts.slice()
    for (let it = 0; it < 6; it++) {
        const h = await field(scene, P)
        for (let i = 0; i < N; i++) {
            const o = 8 * i, d = h[o + 3], nn = [h[o], h[o + 1], h[o + 2]], l = Math.hypot(...nn)
            if (l > 0.5 && Math.abs(d) < 1e6) for (let k = 0; k < 3; k++) P[3 * i + k] -= nn[k] / l * d
        }
    }
    return P
}

const SCENES = {
    'a row of 16 spheres, turned and scaled': () => {
        const d = M.createDoc({})
        M.addGroup(d, 'root', { id: 'rowg', transform: at(0.2, -0.3, 0.1, 15, -20, 35, 1.3) })
        M.addObject(d, 'rowg', { id: 'ball', primitive: 'sphere', params: { radius: 0.1 }, transform: at(0, 0.05, 0) })
        M.setCopies(d, 'rowg', M.copiesRow(16, 0.3, 'x'))
        M.addObject(d, 'root', { id: 'lone', primitive: 'sphere', params: { radius: 0.4 }, transform: at(0, 1.5, 0) })
        return d
    },
    'a ring of 16 boxes about z': () => {
        const d = M.createDoc({})
        M.addGroup(d, 'root', { id: 'ringg' })
        M.addObject(d, 'ringg', { id: 'tooth', primitive: 'box', params: { size: { x: 0.12, y: 0.05, z: 0.2 }, rounding: 0.01 } })
        M.setCopies(d, 'ringg', M.copiesRing(16, 1, 'z'))
        M.addObject(d, 'root', { id: 'lone', primitive: 'sphere', params: { radius: 0.3 } })
        return d
    },
    'a ring of 8 rows of 6 spheres (an array in an array)': () => {
        const d = M.createDoc({})
        M.addGroup(d, 'root', { id: 'outer', transform: at(0, 0, 0.3, 90, 0, 0) })
        M.addGroup(d, 'outer', { id: 'inner', transform: at(0.8, 0, 0, 0, 0, 90) })
        M.addObject(d, 'inner', { id: 'bead', primitive: 'sphere', params: { radius: 0.05 } })
        M.setCopies(d, 'inner', M.copiesRow(6, 0.12, 'x'))
        M.setCopies(d, 'outer', M.copiesRing(8, 0, 'z'))
        M.addObject(d, 'root', { id: 'lone', primitive: 'box', params: { size: { x: 0.2, y: 0.2, z: 0.2 }, rounding: 0 }, transform: at(0, 0, -1) })
        return d
    },
    'a row of 12 light faces': () => {
        const d = M.createDoc({})
        M.addGroup(d, 'root', { id: 'leds', transform: at(0, 0, 0.5, 180, 0, 0) })
        M.addLight(d, 'leds', { id: 'led', shape: 'rectangle', params: { width: 0.04, height: 0.04 } })
        M.setCopies(d, 'leds', M.copiesRow(12, 0.08, 'x'))
        // (a small one aside, not a floor: a floor would take most of the points moved onto a surface, and few the faces)
        M.addObject(d, 'root', { id: 'lone', primitive: 'sphere', params: { radius: 0.05 }, transform: at(0, 0.6, 0.5) })
        return d
    },
}

for (const [label, make] of Object.entries(SCENES)) {
    const doc = make()
    ok(`${label}: a sound scene`, M.validate(doc).length === 0, JSON.stringify(M.validate(doc)))
    const world = estimateBox(M.toTree(doc))
    /* A WINDOW'S COPY IS WORKED OUT FROM COPY 0 BY THE PATTERN (arrays.js arrCopy, since a81cac9's run), not read from its
       own matrix: the same copy to f32's precision -- a few of its steps at the scene's size, and a face's edge, which a
       copy's place in f32 decides, may fall either side (found here: a row reaching 5 m off by 1.1e-6, 16 of 2883 points
       at a face's edge another material). So the bar: 1e-6 of the farthest the scene reaches, at least 1e-6 */
    const F32 = 1e-6 * Math.max(1, ...world.lo.map(Math.abs), ...world.hi.map(Math.abs))
    const scatter = grow => Array.from({ length: 3 * N }, (_, i) => { const k = i % 3, c = (world.lo[k] + world.hi[k]) / 2, h = (world.hi[k] - world.lo[k]) * grow / 2 + 0.2; return c + (2 * rnd() - 1) * h })
    for (const [how, data, bake] of [['codegen', false, false], ['as data', true, false], ['baked', false, true]]) {
        const make2 = arrayWindow => {
            const s = generate(...M.generateArgs(doc, { id: `aw-${data ? 'd' : 'c'}`, data, arrayWindow }))
            return bake ? baked(s, { live: liveInBench }) : s
        }
        const plain = make2(false), win0 = make2(true)
        ok(`${how}: the window in the text, none without it`, /fn arrWindow/.test(win0.wgsl) && !/fn arrWindow/.test(plain.wgsl))
        const win = withBoxes(make2(true), doc, { data })
        const off = withBoxes(make2(false), doc, { data })
        // ON EVERY SURFACE: exact
        const S = await onSurfaces(off, scatter(1))
        const a = await field(off, S), b = await field(win, S)
        let near = 0, differ = 0, worst = 0, flips = 0
        for (let i = 0; i < N; i++) {
            const o = 8 * i
            if (Math.abs(a[o + 3]) > 1e-3) continue
            near++
            const r = Math.abs(a[o + 3] - b[o + 3])
            if (r > F32) { differ++; worst = Math.max(worst, r) }
            if (a[o + 4] !== b[o + 4]) flips++
        }
        ok(`${how}, ${label}: on every surface (${near} points) the same distance with the window, to f32's precision at the scene's size (${F32.toExponential(1)})`,
            near > 100 && differ === 0, `${differ} differ, by up to ${worst}`)
        ok(`${how}, ${label}: ...and the same material, but at a face's very edge (${flips} of ${near})`, flips <= 0.01 * near, `${flips} differ`)
        /* ALL ROUND: a lower bound, and a bound somewhere -- half the points scattered, half near the surfaces (within a
           fifth of a unit of them): the window works inside an array's own box, which the top-level culling leaves to it,
           and few points scattered over the scene fall in a row's thin box */
        const F = scatter(2.5).map((v, i) => (Math.floor(i / 3) % 2) ? S[i] + (rnd() - 0.5) * 0.4 : v)
        const u = await field(off, F), c = await field(win, F)
        let above = 0, below = 0
        for (let i = 0; i < N; i++) {
            const o = 8 * i, du = Math.abs(u[o + 3]), dc = Math.abs(c[o + 3])
            if (dc > du * (1 + 1e-5) + 1e-6) above++
            if (dc < du * (1 - 1e-3)) below++
        }
        ok(`${how}, ${label}: all round, never above the field without the window, and below it at ${below} of ${N}`, above === 0 && below > 0,
            `${above} above, ${below} below`)
        // ...AND WITH NO BOX KNOWN: every copy, the same field -- against the scene without the window and without boxes
        const z = await field(win0, F), u0 = await field(plain, F)
        let moved = 0
        for (let i = 0; i < N; i++) if (Math.abs(z[8 * i + 3] - u0[8 * i + 3]) > F32 * Math.max(1, Math.abs(u0[8 * i + 3]))) moved++
        ok(`${how}, ${label}: with no box known, the field without the window`, moved === 0, `${moved} differ`)
    }
}

/* THE STEPS IT TAKES (added after the user's Pascal run at a81cac9, 2026-10-25: the bench's ring of rows, window on, 1385
   ms a sample against 398.9 off, march 1007.5 against 281.0 -- the first window slower, not faster). The field above
   is exact on the surfaces and a lower bound all round, and still a march can take far more steps by it: a lower bound
   far below the distance is a surface to the march, crossed in small steps. So the bench's own documents (the row of 16
   lights and the ring of 16 rows of them, bench/lightarray.js), camera rays from its camera through the engine's march
   kernel pass after pass as the renderer chains it, counting each ray's steps, window off and on. COUNTS, NOT TIMES: a
   step is the algorithm's, the same on any card; what a step costs is the card's (Tests > lightarray). */
const RAY_F = RAY_BYTES / 4, HIT_F = SHADE_ITEM_BYTES / 4
function raysOf(pts, dirs) {
    const n = pts.length / 3, f = new Float32Array(RAY_F * n), u = new Uint32Array(f.buffer)
    for (let i = 0; i < n; i++) {
        const o = RAY_F * i
        f.set(pts.slice(3 * i, 3 * i + 3), o); f.set(dirs.slice(3 * i, 3 * i + 3), o + 4)
        f[o + 12] = 1; f[o + 13] = 1; f[o + 14] = 1
        u[o + 15] = 0; f[o + 16] = 1; f[o + 17] = 0; u[o + 18] = 0; u[o + 19] = 0; u[o + 20] = i; f[o + 21] = 1
        u[o + 22] = 0; f[o + 23] = 0; f[o + 24] = -1; f[o + 25] = 0; f[o + 26] = 0
    }
    return f
}
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) }
/* the bench's orbit camera as stepcache.gpu.mjs makes its rays */
function cameraRays(cam, W, H) {
    const RAD = Math.PI / 180, az = cam.azimuth * RAD, el = (90 - cam.elevation) * RAD
    const pos = [0, 1, 2].map(k => cam.target[k] + cam.distance * [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)][k])
    const z = unit(pos.map((v, k) => v - cam.target[k])), x = unit([-z[1], z[0], 0]), y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    const t = Math.tan(cam.fov * RAD / 2), pts = [], dirs = []
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const u = ((i + 0.5) / W * 2 - 1) * t * W / H, v = ((j + 0.5) / H * 2 - 1) * t
        pts.push(...pos); dirs.push(...unit([0, 1, 2].map(k => -z[k] + u * x[k] + v * y[k])))
    }
    return { pts, dirs }
}
/* the march kernel, pass after pass (stepcache.gpu.mjs marchAll, without the cache); out per ray { state, steps } */
async function marchSteps(scene, rays0, passes = 80) {
    const prog = await prog_march(WG, scene, 64, { stepCache: 0 }); await prog.ready
    const bag = { ...uniformBag(scene), res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000 }
    const n = rays0.length / RAY_F, u = bag.sceneUnit, rays = rays0.slice()
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) rays[RAY_F * i + c] *= u
    const buffers = scene.init ? await scene.init(WG) : {}
    const mb0 = WG.createStorageBuffer(rays), mb1 = WG.createStorageBuffer(rays.byteLength)
    const shade = WG.createStorageBuffer(HIT_F * 4 * n), counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    prog.resources = { marchBuffer0: mb0.b, marchBuffer1: mb1.b, shadeBuffer: shade.b, counters: counters.b, ...buffers }
    let inCount = n, readfrom = 0, shaded = 0
    for (let p = 0; p < passes && inCount > 0; p++) {
        counters.w(counterWords({ [readfrom]: inCount, 2: shaded, 3: readfrom }))
        prog.uniforms = { ...bag, lastpass: p === passes - 1 ? 1 : 0 }
        prog.dispatch(Math.ceil(inCount / 64), 1, 1)
        const c = await counters.r(Uint32Array)
        shaded = c[2]; inCount = readfrom === 0 ? c[1] : c[0]; readfrom = 1 - readfrom
    }
    const h = await shade.r(Float32Array), hu = new Uint32Array(h.buffer)
    const out = new Array(n).fill(null)
    for (let k = 0; k < shaded; k++) { const o = HIT_F * k; out[hu[o + 20]] = { steps: hu[o + 15], state: hu[o + 19] } }
    for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
    return out
}
{
    const { pts, dirs } = cameraRays(BENCH_CAMERA, 96, 54)
    const mean = r => r.reduce((s, h) => s + (h?.steps ?? 0), 0) / r.length
    // the share done in one march pass: 32 steps (wavefront.js prog_march MAX_STEPS), what the bench's first pass shows
    const done = r => r.filter(h => h && h.steps <= 32).length / r.length
    const size = b => b ? b.hi.map((v, k) => (v - b.lo[k]).toPrecision(3)).join(' x ') : 'none'
    for (const kind of ['row', 'ring']) {
        const doc = lightArrayDoc(kind)
        const Bm = await measured(doc, generate(...M.generateArgs(doc, { id: `awm-${kind}` })))
        const E = cullBoxes(doc, estimated(doc)), Mb = cullBoxes(doc, Bm)
        for (const [id] of E) console.log(`  the bench's ${kind}, box ${id}: estimated ${size(E.get(id))}, measured ${size(Mb.get(id))}`)
        for (const id of ['lalamp']) console.log(`  the bench's ${kind}, ${id}'s own: estimated ${size(estimated(doc).get(id))}, measured ${size(Bm.get(id))} (cell ${Bm.get(id)?.cell})`)
        for (const [how, data, B] of [['codegen', false, undefined], ['as data', true, undefined], ['codegen, measured boxes', false, Bm], ['as data, measured boxes', true, Bm]]) {
            const make2 = arrayWindow => withBoxes(generate(...M.generateArgs(doc, { id: `aws-${kind}-${data ? 'd' : 'c'}`, data, arrayWindow })), doc, { data, B })
            const off = await marchSteps(make2(false), raysOf(pts, dirs)), on = await marchSteps(make2(true), raysOf(pts, dirs))
            const ends = on.filter((h, i) => (h?.state ?? -1) !== (off[i]?.state ?? -1)).length
            const moved = on.filter((h, i) => (h?.steps ?? 0) !== (off[i]?.steps ?? 0)).length
            const most = Math.max(...on.map((h, i) => (h?.steps ?? 0) - (off[i]?.steps ?? 0)))
            /* THE BAR, 1.5. Counted (2026-10-25): with boxes estimated, the ring 1.13 and 1.06, the row 1.00; with boxes measured
               as the bench measures them, the ring 2.15 while a node in an array was measured as all its copies (boxes.js
               toOwnLocalOf), 1.50 once measured as one, 1.38 (and 1.08 as data) with a row's copies bounded by their boxes
               and a ring's by the annulus too (arrays.js), the row 1.01. What is left is inferred to be the sphere round a
               ring's copy inside the lamps' plane, where the annulus says nothing: an angle's bound would be next */
            ok(`${how}, the bench's ${kind}: steps a camera ray with the window within 1.5 times those without, every ray ending as it did`,
                mean(on) <= 1.5 * mean(off) && ends === 0, `${mean(on)} against ${mean(off)}, ${ends} ending otherwise`)
            console.log(`  the bench's ${kind}, ${how}: steps a camera ray ${mean(on).toFixed(1)} with the window, ${mean(off).toFixed(1)} without (x ${(mean(on) / mean(off)).toFixed(2)}); done in 32 steps ${(100 * done(on)).toFixed(0)}% against ${(100 * done(off)).toFixed(0)}%; ${moved} rays' steps changed, by up to ${most}; ${ends} of ${on.length} ending otherwise`)
        }
    }
}

/* WHICH COPY THE PICK COPY SAYS (scene_api.js XF_COPY, 0.79.0): at the centre of every face of the bench's ring of rows,
   the tag field names the light, copy j of 256 as the light sources number them (sources.js, innermost fastest: the
   same digits), inside 2 arrays -- codegen's copies loop and the data walk's ARRAY records each. What lets boxes.js
   measure a node in an array as one copy. */
{
    const doc = lightArrayDoc('ring'), src = sourceTable(doc).sources
    for (const [how, data] of [['codegen', false], ['as data', true]]) {
        const S = generate(...M.generateArgs(doc, { id: `awt-${data ? 'd' : 'c'}`, data }))
        const prog = await prog_tagfield(WG, S); await prog.ready
        const buffers = S.init ? await S.init(WG) : {}
        const tags = []
        let wrong = 0
        // (not a face another lies on: the ring's rows end where the next begins, faces 79 and 112 2.3 mm apart, and there
        // the tag is whichever folds first, as anywhere two surfaces meet)
        const alone = x => src.every(y => y === x || Math.hypot(...y.origin.map((v, k) => v - x.origin[k])) > 0.04)
        for (const x of src.filter((y, i) => i % 7 === 0 && alone(y))) {
            const input = fieldInput({ mode: FIELD_GRID, count: 1, origin: x.origin, nx: 1, ny: 1 })
            const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(Math.max(4 * TAG_FIELD_WORDS, 256))
            prog.resources = { fieldIn: inB.b, fieldOut: outB.b, ...buffers }
            prog.uniforms = { ...uniformBag(S), res: [64, 64] }
            prog.run(1, 1, 1)
            const t = tagSample(await outB.r(4 * TAG_FIELD_WORDS, 0, Float32Array), S)
            inB.b.destroy(); outB.b.destroy()
            tags.push(`${t.copy[0]}/${t.copies[0]}`)
            if (t.tags[t.tag[0] - 1] !== x.id || t.copy[0] !== x.copy || t.copies[0] !== 2) wrong++
        }
        ok(`${how}: at every seventh face's centre of the ring of rows (but where two lie together), the light, its own copy, inside 2 arrays`, wrong === 0, `${wrong} wrong: ${tags.join(' ')}`)
    }
}

console.log(`array window on Dawn: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
