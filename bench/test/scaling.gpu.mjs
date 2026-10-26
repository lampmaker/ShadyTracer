//======================================================================================================================
// THE SCALING BENCH'S COPIES ON A REAL WEBGPU: their boxes measured as the bench measures them, and the work a camera ray
// does among them. Run:
//   node bench/test/scaling.gpu.mjs          (COUNTS=1,4,16,32 to choose the copy counts)
//
// OPTIONAL, AND LOUD ABOUT IT, as the builder's GPU tests are: the `webgpu` package and a Vulkan driver (lavapipe), or it
// says so and passes.
//
// WHY IT EXISTS. The user's scaling run of 0.22.8 on the Pascal: as data, 1 to 16 lens assemblies cost about 3.5 ms of
// march a copy, and 32 cost twenty times more a ray -- the camera's rays too, which never come near the copies behind the
// camera. This test, counting on a software GPU, found it was not the card: at 32, camera rays took 37.2 steps against
// 23.8 at 16, and walked 61.8 records a step against 21.3. The culling box of copy 1, which every copy is given, was
// 146 x 115 x 136 cm instead of about 17 x 7 x 20: its lens, missed by the first coarse lattice, grew the search to a 48.9 cm
// cell, two stray points of that lattice were its box, padded by the cell, and a group takes its children's coarsest
// (builder/boxes.js, NEVER THE GROWN SEARCH'S WORD ALONE, fixed in 0.22.10). What it checks, at each count:
//   - copy 1's box is its own size, whatever the number of copies;
//   - the camera's rays end the same way (hit or escaped) at every count: the picture is one;
//   - the work grows as the walk says it must, about one record a step for each copy (each copy's box looked at), and the
//     steps do not grow: the copies are behind the camera.
// COUNTS, NOT TIMES (CLAUDE.md): what they predict is for the user's bench to measure.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(scaling GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../../builder/model.js')
const { generate } = await import('../../builder/codegen.js')
const { cullBoxes, createBoxes } = await import('../../builder/boxes.js')
const { lensCopies, CAMERAS, COUNTS, LENS_ID } = await import('../scaling.js')
const { prog_tagfield, tagSample, TAG_FIELD_WORDS } = await import('../../lib/pathtracer/core/field.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { computeUniformTypes, sceneConstantsWGSL, UniformSpec } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive, autoEps } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(scaling GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
let EPS = 0                                                         // the copy rows' `set: { eps }` (scaling.js)
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    v.eps = EPS
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}

/* THE BOXES AS THE BENCH MEASURES THEM (bench/index.js boxesFor): the stage and copy 1 on the GPU, every other copy and
   each of its parts given its counterpart's (scaling.js lensCopies `same`), then culled nested as the page culls */
async function benchBoxes(doc, scene, only, same) {
    const prog = await prog_tagfield(WG, scene)
    await prog.ready
    const buffers = await scene.init(WG)
    const sample = async input => {
        const count = new Uint32Array(input.buffer, input.byteOffset, 4)[3]
        const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(Math.max(4 * TAG_FIELD_WORDS * count, 256))
        prog.resources = { fieldIn: inB.b, fieldOut: outB.b, ...buffers }
        prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
        prog.run(count, 1, 1)
        const out = await outB.r(4 * TAG_FIELD_WORDS * count, 0, Float32Array)
        inB.b.destroy(); outB.b.destroy()
        return tagSample(out, scene)
    }
    const B = createBoxes({ sample, doc: () => doc, wanted: () => only })
    await B.update()
    // all three questions, as bench/index.js asks them: without `missing` it was culled as if no part went unfound
    const V = { fresh: id => B.fresh(same.get(id) ?? id), get: id => B.get(same.get(id) ?? id), missing: id => B.missing(same.get(id) ?? id) }
    return { C: cullBoxes(doc, V, { nested: true }), V }
}

/* THE WORK a camera ray does, the march's rule (a distance, a step of it): steps to its end and records walked (a
   count-mode scene's SCN_VISITS), and how it ended -- 1 a hit, 2 out of the scene's radius, 3 out of steps */
async function counted(scene, data, rays) {
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&evalIn) / 2u) { return; }
        var ray = newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0);
        let eps = marchEps();
        let R = metres(UB.envRadius);
        var steps = 0u; var visits = 0u; var how = 0u;
        loop {
            if (steps >= 4000u) { how = 3u; break; }
            SCN_VISITS = 0u;
            let h = SDF(ray);
            visits = visits + SCN_VISITS;
            let ea = abs(h.s.w);
            if (dot(ray.pos, ray.dir) > 0.0 && dot(ray.pos, ray.pos) > R * R) { how = 2u; break; }
            if (ea < eps) { how = 1u; break; }
            steps = steps + 1u;
            ray = moveBy(ray, ray.dir * ea * UB.stepscale);
        }
        evalOut[3u * i] = f32(steps); evalOut[3u * i + 1u] = f32(visits); evalOut[3u * i + 2u] = f32(how);`,
        computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) }, { async: false, wg: [64, 1, 1] })
    await prog.ready
    scene.data = data
    const buffers = await scene.init(WG)
    const n = rays.pts.length / 3, input = new Float32Array(8 * n)
    for (let i = 0; i < n; i++) { input.set(rays.pts.slice(3 * i, 3 * i + 3), 8 * i); input.set(rays.dirs.slice(3 * i, 3 * i + 3), 8 * i + 4) }
    const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(12 * n)
    prog.resources = { evalIn: inB.b, evalOut: outB.b, ...buffers }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    let steps = 0, visits = 0
    const how = []
    for (let i = 0; i < n; i++) { steps += out[3 * i]; visits += out[3 * i + 1]; how.push(out[3 * i + 2]) }
    return { steps: steps / n, perStep: visits / Math.max(steps, 1), how }
}

// the camera's rays, as the other GPU checks make them (lib/camera.js's orbit: elevation from the vertical)
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) }
function cameraRays(cam, W = 96, H = 54) {
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

const bench = M.parse(readFileSync(new URL('../scenes/OpticsBench.json', import.meta.url), 'utf8'))
const quiet = console.warn
console.warn = () => { }
const one = lensCopies(bench, 1)
EPS = autoEps(generate(...M.generateArgs(one.doc, { id: 'x', data: true })).extent, one.doc.unit)
const counts = process.env.COUNTS ? process.env.COUNTS.split(',').map(Number) : [COUNTS[0], COUNTS.at(-2), COUNTS.at(-1)]
const rays = cameraRays(CAMERAS.lens)
const rows = []
for (const n of counts) {
    const { doc, copies, same } = lensCopies(bench, n)
    const stage = doc.root.children.filter(c => !copies.has(c.id)).map(c => c.id)
    const [tree, opts] = M.generateArgs(doc, { id: 'built', data: true, count: true })
    const S = generate(tree, opts)
    const { C, V } = await benchBoxes(doc, S, stage, same)
    const box = V.get(LENS_ID), size = box ? box.hi.map((v, k) => v - box.lo[k]) : null
    const r = await counted(S, S.dataOf(tree, C).data, rays)
    rows.push({ n, size, ...r, known: [...C.values()].filter(Boolean).length, of: C.size })
    console.log(`  x ${n}: copy 1's box ${size ? size.map(v => v.toFixed(1)).join(' x ') : 'none'} (cell ${box?.cell.toFixed(3)}); boxes ${rows.at(-1).known}/${C.size}; `
        + `steps a camera ray ${r.steps.toFixed(1)}, records a step ${r.perStep.toFixed(1)}`)
}
console.warn = quiet

for (const r of rows) {
    // the lens assembly is about 16 x 6 x 20 cm (scaling.js: -10..10, -20..0, -2.5..26 estimated)
    ok(`x ${r.n}: copy 1's box is its own size, not the search's`, r.size && r.size.every(v => v < 25), JSON.stringify(r.size))
    ok(`x ${r.n}: every node the records cull has a box`, r.known === r.of, `${r.known}/${r.of}`)
}
const [first] = rows
for (const r of rows.slice(1)) {
    ok(`x ${r.n}: the camera's rays end as at x ${first.n}: the same picture`, r.how.every((h, i) => h === first.how[i]),
        `${r.how.filter((h, i) => h !== first.how[i]).length} of ${r.how.length} differ`)
    ok(`x ${r.n}: no more steps a camera ray than x ${first.n} (the copies are behind the camera)`, r.steps <= 1.1 * first.steps,
        `${r.steps.toFixed(1)} against ${first.steps.toFixed(1)}`)
    // a step looks at each copy's box at least: about one record more a copy, never many
    const perCopy = (r.perStep - first.perStep) / (r.n - first.n)
    ok(`x ${r.n}: about one record more a step for each copy, not more`, perCopy < 1.5, `${perCopy.toFixed(2)} a copy`)
}
console.log(`scaling GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
