//======================================================================================================================
// THE IMPORTED SHAPES' OWN WGSL, RUN (0.72.0, import/). Run: node import/test/import.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package and a Vulkan driver (lavapipe), or it says so
// and passes.
//
// WHY. The import writes two shapes of its own into the scene, the cone and the rounded rectangle's prism (shapes.js
// CONE_CODE, RRECT_CODE), each with its own normal, and joins everything it makes by union, intersect and subtract.
// csg.test holds the scene document to OpenCascade -- but through docsdf.mjs, a JavaScript mirror of that code, and
// check-shaders only compiles the WGSL. Nothing ran it. Here the engine's own march kernel does, on Dawn: rays from
// outside each fixture part (OpenCascade's points, import/test/fixtures) toward points in its box, through the part as
// the page pastes it (codegen, as data, and baked as the page shows it once the edits stop), each held to a march of the conversion's own formula in JavaScript
// (shapes.js shapeSDF, which csg.test holds to OpenCascade) -- not of docsdf.mjs, which mirrors what codegen does and so
// is wrong with it: a part's union folded as a plain group, not combined, passed against it and failed against this:
//   - it hits where the formula hits, and misses where it misses;
//   - at the same place, to the march's tolerance;
//   - with the normal the formula's gradient has there (the march keeps the nearest shape's, analytic: hit.s);
//   - and what it hit is the solid: a hair past the hit is inside OpenCascade's B-rep (brep.js, held to its points).
// What a share of rays grazing an edge or a rim decides is allowed, as in every GPU check here. COUNTS AND DISTANCES,
// NOT TIMES (CLAUDE.md). Whether it LOOKS right is the user's.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(import GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../../builder/model.js')
const { generate } = await import('../../builder/codegen.js')
const { baked } = await import('../../builder/bake.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { prog_march, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { UniformSpec } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../../lib/pathtracer/core/tracebasics.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')
const { convert } = await import('../index.js')
const { readSTEP } = await import('../step.js')
const { brep, mulberry } = await import('../brep.js')
const { CONE_CODE, RRECT_CODE, shapeSDF } = await import('../shapes.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(import GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const say = (...a) => console.log(...a)

// THE HARNESS: builder/test/units.gpu.mjs's (the uniforms the renderer hands the kernels; the rays and the shade queue
// as the engine lays them out, which that file explains; the march chained pass after pass)
const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
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
/* the hits, with the Hit's s (tracebasics.js struct Hit: after the Ray's 28 words, the nearest shape's normal and
   distance, which scene_api.js fold keeps) */
async function marchAll(prog, bag, rays, buffers, passes = 80) {
    const n = rays.length / RAY_F
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
    for (let k = 0; k < shaded; k++) {
        const o = HIT_F * k
        out[hu[o + 20]] = { pos: [h[o], h[o + 1], h[o + 2]], state: hu[o + 19], nrm: [h[o + 28], h[o + 29], h[o + 30]] }
    }
    for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
    return out
}
async function made(doc, way) {
    const tree = M.toTree(doc, { keepDisabled: true })
    // BAKED as the page bakes once the edits stop (builder/baker.js): every value a constant (the culling boxes, unmeasured
    // here, among them -- unknown, which never culls)
    if (way.baked) { const S = baked(generate(...M.generateArgs(doc, { id: 'imported', title: doc.title }))); return { S, buffers: S.init ? await S.init(WG) : {} } }
    const S = generate(tree, { id: 'imported', liveVisibility: true, ...way })
    if (S.dataOf) { S.data = S.dataOf(tree, new Map()).data }
    const buffers = S.init ? await S.init(WG) : {}
    return { S, buffers }
}
const WAYS = [['codegen', {}], ['as data', { data: true }], ['baked', { baked: true }]]
const isHit = h => h && h.state === 0

/* THE FORMULA'S MARCH, in mm: sphere tracing it, to a hundredth of a micrometre */
function marchJS(f, o, d, far) {
    let t = 0
    for (let i = 0; i < 20000 && t < far; i++) {
        const p = o.map((v, k) => v + t * d[k]), v = f(p)
        if (v < 1e-5) return p
        t += v
    }
    return null
}
const gradJS = (f, p, h = 1e-4) => {
    const g = [0, 1, 2].map(k => { const a = p.slice(), b = p.slice(); a[k] += h; b[k] -= h; return (f(a) - f(b)) / (2 * h) })
    const l = Math.hypot(...g) || 1
    return g.map(x => x / l)
}

const PARTS = ['plate', 'bracket', 'boss', 'lens', 'roundbox', 'cup']
const RAYS = 256, SHARE = 0.02
const fixture = n => new URL(`./fixtures/${n}`, import.meta.url)
const uA = derive({}, { unit: 'mm' }).sceneUnit
const codes = new Set()
for (const n of PARTS) {
    const bytes = readFileSync(fixture(`${n}.step`))
    const r = convert(M, `${n}.step`, bytes, { place: 'file' })
    const doc = M.ensureMaterial(M.createDoc({ title: n })); doc.unit = 'mm'
    M.insertAsset(doc, r.asset, 'root')
    for (const b of r.asset.blocks) codes.add(b.code)
    const f = p => shapeSDF(r.parts[0].ir.root, p)
    const B = brep(readSTEP(readFileSync(fixture(`${n}.step`), 'utf8')).solids[0])
    // the rays: from OpenCascade's points well outside the part, toward points through its box
    const ref = JSON.parse(readFileSync(fixture(`${n}.json`), 'utf8'))
    const rnd = mulberry(7), lo = B.box.lo, hi = B.box.hi, far = 4 * Math.hypot(...hi.map((h, k) => h - lo[k]))
    const from = ref.points.filter(([, , , c, d]) => c === 0 && d > 1).slice(0, RAYS).map(([x, y, z]) => [x, y, z])
    const dirs = from.map(o => { const t = lo.map((l, k) => l + (hi[k] - l) * rnd()); const d = t.map((v, k) => v - o[k]), l = Math.hypot(...d); return d.map(x => x / l) })
    const rays = raysOf(from.flat().map(x => x * uA), dirs.flat())
    const want = from.map((o, i) => marchJS(f, o, dirs[i], far))
    for (const [way, opts] of WAYS) {
        const { S, buffers } = await made(doc, opts)
        if (opts.baked) ok(`${n}, baked: its values constants in the text`, S.baked?.names?.length > 0 && S.wgsl !== generate(...M.generateArgs(doc, { id: 'imported', title: doc.title })).wgsl, S.baked?.names?.length)
        const bag = { ...uniformBag(S), res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000 }
        const tol = Math.max(bag.eps > 0 ? bag.eps : bag.epsAuto, 1e-7) / uA        // in mm
        const P = await prog_march(WG, S, 64)
        await P.ready
        const got = (await marchAll(P, bag, rays, buffers)).map(h => isHit(h) ? { pos: h.pos.map(x => x / uA), nrm: h.nrm } : null)
        const hits = got.filter(Boolean).length
        /* THE MARCH STOPS WITHIN ITS TOLERANCE of the surface, which along a ray at an angle is tol / cos: ten times as far
           for a ray 84 degrees off the normal -- where the hit is held, and where a hair past it is */
        const reach = i => tol / Math.max(Math.abs(gradJS(f, want[i]).reduce((a, v, k) => a + v * dirs[i][k], 0)), 0.05)
        const both = got.map((g, i) => g && want[i] ? i : -1).filter(i => i >= 0)
        const state = got.filter((g, i) => !!g !== !!want[i]).length
        const place = both.filter(i => Math.hypot(...got[i].pos.map((v, k) => v - want[i][k])) > 2 * reach(i) + 1e-3).length
        const normal = both.filter(i => got[i].nrm.reduce((a, v, k) => a + v * gradJS(f, want[i])[k], 0) < 0.999).length
        const solid = both.filter(i => !B.inside(got[i].pos.map((v, k) => v + (2 * reach(i) + 0.01) * dirs[i][k]))).length
        say(`  ${n}, ${way}: ${hits} of ${got.length} rays hit (the formula: ${want.filter(Boolean).length}); ${state} end otherwise, ${place} elsewhere (> 2 tolerances (${(tol * 1e3).toFixed(2)} um) along the ray, + 1 um), ${normal} with another normal, ${solid} not into the solid`)
        ok(`${n}, ${way}: rays hit the part (the check sees it)`, hits > 0.3 * got.length, `${hits} of ${got.length}`)
        ok(`${n}, ${way}: every ray hits where the formula hits, at the same place, with its normal, into the solid -- but a share an edge decides`,
            state + place + normal + solid <= SHARE * got.length, `${state} + ${place} + ${normal} + ${solid} of ${got.length}`)
    }
}
ok('the cone\'s and the rounded prism\'s own code among what ran', codes.has(CONE_CODE) && codes.has(RRECT_CODE))

say(`import GPU check: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
