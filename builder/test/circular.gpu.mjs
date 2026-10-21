//======================================================================================================================
// THE CIRCULAR ARRAY (modifiers.js `circular`, 0.77.0), on a WebGPU in node (Dawn). Run:
//   node builder/test/circular.gpu.mjs     (optional: npm i -g webgpu, and lavapipe; says so and passes without)
//
// The modifier is group code: copies of its children turned about its z axis, combined by the least distance in a
// Hit of their own -- a true union, so a child across the axis, or copies that overlap, make one merged shape (the
// user, 2026-10-21: "an object placed off-center will create multiple instances, an object placed in the center will
// create a merged circular object"). Polar domain repetition, which folds the point into one slice and evaluates one
// copy, is cheaper and wrong exactly there: at a slice's border a copy that crosses it is cut off, and one at the
// centre is cut into a wedge. So every copy is evaluated -- or, with "reach", the nearest few and a bound on the rest.
//
// WHAT IT SHOWS, the scene's SDF on Dawn at 4096 points around each document, codegen's, with visibility live, as data
// and baked (bake.js: the values literals, the build the page shows once edits stop), against the exact union worked out here in JS from the shapes' own distances:
//   every copy evaluated: the distance the exact union everywhere -- a ring of spheres off the axis, a box across it
//     (merged, its inside negative), the group turned, moved and scaled with a child turned in it, an odd count, one
//     copy, a ring in a CSG group (a plate less a bolt circle) -- and the normal the copy's own, turned with it;
//   "reach" (children within that many slices of their own): never above the exact union, the same where it matters --
//     near the surfaces, and on the right side everywhere -- and never below a fixed share of it, so a ray through the
//     axis does not crawl;
//   capturing (a material's local point, the pick): the same distance as without, the point recorded in the winning
//     copy's own frame, the frame turned with it, the tag the child's.
// WHAT IT CANNOT SHOW: the picture, which is the user's.
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(circular array GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate } = await import('../codegen.js')
const { modifierGroup } = await import('../modifiers.js')
const { baked } = await import('../bake.js')
const { fromParent } = await import('../boxes.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { computeUniformTypes, sceneConstantsWGSL, UniformSpec } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
// the Dawn instance in a global: held in a local it was collected, and the next wait crashed (scenedata.gpu.mjs)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)        // as the page does (index.html)
} catch (e) {
    console.log(`(circular array GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}
console.warn = () => { }

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

/* the uniforms the renderer would have: every schema default, what derive() works out for the scene, the scene's own */
const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* THE SCENE'S SDF AT A LIST OF POINTS, eight floats a point: its distance, its normal, its material -- and, `capture`,
   with LOCAL_CAPTURE on as the pick and a material's local point have it: the point recorded (HIT_LOCAL), the
   first column of the frame (HIT_FRAME) and the tag (HIT_TAG), from the scene's pick copy, which sets the tags */
async function field(scene, pts, dirs, capture = false) {
    const body = capture ? `
        LOCAL_CAPTURE = true;
        XF_P = evalIn[2u * i].xyz; HIT_LOCAL = XF_P; HIT_FRAME = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
        HIT_TAG = 0u; HIT_TAG_D = 3.0e38;
        let h = SDF(newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0));
        LOCAL_CAPTURE = false;
        evalOut[8u * i] = h.s.w;
        evalOut[8u * i + 1u] = HIT_LOCAL.x; evalOut[8u * i + 2u] = HIT_LOCAL.y; evalOut[8u * i + 3u] = HIT_LOCAL.z;
        evalOut[8u * i + 4u] = HIT_FRAME[0].x; evalOut[8u * i + 5u] = HIT_FRAME[0].y; evalOut[8u * i + 6u] = HIT_FRAME[0].z;
        evalOut[8u * i + 7u] = f32(HIT_TAG);` : `
        let h = SDF(newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0));
        evalOut[8u * i] = h.s.w;
        evalOut[8u * i + 1u] = h.s.x; evalOut[8u * i + 2u] = h.s.y; evalOut[8u * i + 3u] = h.s.z;
        evalOut[8u * i + 4u] = f32(h.m);`
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${capture ? scene.pickWgsl : scene.wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&evalIn) / 2u) { return; }${body}`,
        computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) },
        { async: false, wg: [64, 1, 1] })
    await prog.ready
    const n = pts.length
    const input = new Float32Array(8 * n)
    for (let i = 0; i < n; i++) { input.set(pts[i], 8 * i); input.set(dirs[i], 8 * i + 4) }
    const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(32 * n)
    const buffers = scene.init ? await scene.init(WG) : {}
    prog.resources = { evalIn: inB.b, evalOut: outB.b, ...buffers }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    return out
}

//----------------------------------------------------------------------------------------------------------------------
// THE TRUTH, in JS: each shape's exact distance in its own frame, carried to its parent's by its transform's scale; a
// group's shapes combined in order by their joins (union an exact min, subtract max(k, -d), intersect max(k, d)); a
// circular array's children at each of its copies -- the point turned by -360 j / count about z -- a union, an exact
// min. The scene is one top-level node, whose fold into the empty Hit is the node's own value.
//----------------------------------------------------------------------------------------------------------------------
const len = v => Math.hypot(v[0], v[1], v[2])
const PRIM = {
    sphere: (q, P) => len(q) - P.radius,
    box: (q, P) => {
        const b = [P.size.x, P.size.y, P.size.z], rr = Math.min(Math.max(P.rounding, 0), ...b)
        const d = q.map((v, k) => Math.abs(v) - (b[k] - rr))
        return len(d.map(v => Math.max(v, 0))) + Math.min(Math.max(...d), 0) - rr
    },
}
const turn = (q, t) => [Math.cos(t) * q[0] + Math.sin(t) * q[1], Math.cos(t) * q[1] - Math.sin(t) * q[0], q[2]]
/* the copies' angles: every one */
const angles = n => { const c = Math.max(1, Math.round(n.params.count)); return Array.from({ length: c }, (_, j) => 2 * Math.PI * j / c) }
function truth(n, p) {
    const t = n.transform, q = t ? fromParent(t, p) : p, s = t?.scale ?? 1
    if (n.kind === 'object') return s * PRIM[n.prim](q, n.params)
    const shapes = n.children.filter(c => c.enabled !== false)
    const combine = x => shapes.reduce((k, c, i) => {
        const d = truth(c, x), j = c.join ?? 'union'
        return i === 0 ? d : j === 'subtract' ? Math.max(k, -d) : j === 'intersect' ? Math.max(k, d) : Math.min(k, d)
    }, 1e7)
    if (n.prim === 'circular') return s * Math.min(...angles(n).map(a => combine(turn(q, a))))
    return s * combine(q)
}
/* which copy of a ring is nearest a point in the ring's frame, and how much nearer than the next */
function nearestCopy(ring, q) {
    const ds = angles(ring).map(a => ({ a, d: Math.min(...ring.children.map(c => truth(c, turn(q, a)))) })).sort((x, y) => x.d - y.d)
    return { a: ds[0].a, d: ds[0].d, gap: ds.length > 1 ? ds[1].d - ds[0].d : Infinity }
}
const added = new Map()
const obj = (d, parent, id, prim, params, extra = {}) => {
    M.addObject(d, parent, { id, primitive: prim, params, ...extra })
    added.set(id, prim)
}
const ring = (d, parent, id, params, extra = {}) => {
    const g = modifierGroup('circular')
    M.addGroup(d, parent, { id, ...g, params: { ...g.params, ...params }, ...extra })
    added.set(id, 'circular')
}
const tagged = n => ({ ...n, prim: added.get(n.id), children: n.children?.map(tagged) })
const T = (x, y, z, rz = 0, s = 1, rx = 0) => ({ pos: { x, y, z }, rot: { x: rx, y: 0, z: rz }, scale: s })
const sphere = (d, g, id, r, at, extra = {}) => obj(d, g, id, 'sphere', { radius: r }, { transform: T(...at), ...extra })
const box = (d, g, id, size, extra = {}) => obj(d, g, id, 'box', { size: { x: size[0], y: size[1], z: size[2] }, rounding: 0 }, extra)

/* each: the document, and `exact` -- every copy evaluated, so the distance is the union everywhere -- or the reach's
   promise, checked as a bound */
const DOCS = {
    'six spheres off the axis: six instances': { exact: true, make: () => {
        const d = M.createDoc()
        ring(d, 'root', 'rg', { count: 6 })
        sphere(d, 'rg', 'ball', 0.3, [0.8, 0, 0.1])
        return d
    } },
    'a box across the axis: one merged shape': { exact: true, make: () => {
        const d = M.createDoc()
        ring(d, 'root', 'rg', { count: 6 })
        box(d, 'rg', 'bar', [0.9, 0.2, 0.25], { transform: T(0.15, 0.05, 0) })
        return d
    } },
    'turned, moved and scaled, a child turned in it, an odd count': { exact: true, make: () => {
        const d = M.createDoc()
        ring(d, 'root', 'rg', { count: 5 }, { transform: T(0.1, -0.2, 0.05, 20, 1.2, 30) })
        box(d, 'rg', 'bar', [0.5, 0.15, 0.2], { transform: T(0.5, 0.1, 0, 35, 0.9) })
        sphere(d, 'rg', 'ball', 0.2, [0, 0, 0.5])             // on the axis: its copies all one; clear of the box (fold is no union)
        return d
    } },
    'one copy: the children as they are': { exact: true, make: () => {
        const d = M.createDoc()
        ring(d, 'root', 'rg', { count: 1 })
        box(d, 'rg', 'bar', [0.6, 0.2, 0.25], { transform: T(0.3, 0.2, 0, 15) })
        return d
    } },
    'a plate less a bolt circle (a ring in a CSG group)': { exact: true, make: () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part' })
        added.set('part', 'csg')
        box(d, 'part', 'plate', [1.1, 1.1, 0.15])
        ring(d, 'part', 'holes', { count: 8 }, { join: 'subtract' })
        sphere(d, 'holes', 'hole', 0.18, [0.75, 0, 0])
        return d
    } },
    'twelve spheres, reach 0: three evaluated, the rest bounded': { exact: false, make: () => {
        const d = M.createDoc()
        ring(d, 'root', 'rg', { count: 12, reach: 0 })
        sphere(d, 'rg', 'ball', 0.2, [0.9, 0, 0])               // 12.8 degrees either side of +x: inside its 15
        return d
    } },
    'sixteen boxes, reach 1: five evaluated, turned and scaled': { exact: false, make: () => {
        const d = M.createDoc()
        ring(d, 'root', 'rg', { count: 16, reach: 1 }, { transform: T(0, 0.1, 0, 10, 1.1, 20) })
        box(d, 'rg', 'tooth', [0.3, 0.45, 0.2], { transform: T(1, 0, 0) })   // 32.7 degrees either side: inside 1.5 slices'
        return d
    } },
}

/* points in and around, and a direction each */
let seed = 4242
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const N = 4096
const pts = [], dirs = []
for (let i = 0; i < N; i++) {
    pts.push([0, 1, 2].map(k => (2 * rnd() - 1) * (k === 2 ? 0.8 : 1.6)))
    const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z)
    dirs.push([s * Math.cos(a), s * Math.sin(a), z])
}
const at = i => `(${pts[i].map(v => v.toFixed(3)).join(', ')})`
/* a transform that moves nothing (toTree gives every node one): the normal check's frame is then the world's */
const still = t => !t || (['x', 'y', 'z'].every(k => t.pos[k] === 0 && t.rot[k] === 0) && t.scale === 1)
let normalsChecked = 0

for (const [name, { exact, make }] of Object.entries(DOCS)) {
    added.clear()
    const doc = make()
    const top = tagged(M.toTree(doc)).children[0]
    const want = pts.map(p => truth(top, p))
    for (const [how, opts, bake] of [['codegen', {}], ['codegen, visibility live', { liveVisibility: true }], ['as data', { liveVisibility: true, data: true }],
                                     ['baked', {}, true]]) {
        const made = generate(M.toTree(doc, { keepDisabled: !!opts.liveVisibility }), { id: 'circular', ...opts })
        // BAKED (bake.js): the build the page shows once edits stop, count and reach literals in the loop's text
        const scene = bake ? baked(made) : made
        if (opts.data && !scene.init) { ok(`${name} (${how}): the scene is data`, false, 'no records'); continue }
        const got = await field(scene, pts, dirs)
        const d = i => got[8 * i]
        if (exact) {
            let off = 0, sign = 0, worst = 0, w = 0
            for (let i = 0; i < N; i++) {
                const e = Math.abs(d(i) - want[i])
                if (e > 1e-4) off++
                if (Math.sign(d(i)) !== Math.sign(want[i]) && Math.abs(want[i]) > 1e-4) sign++
                if (e > worst) { worst = e; w = i }
            }
            ok(`${name} (${how}): the distance is the exact union of the copies everywhere`, off === 0,
                `${off} of ${N} points off by more than 1e-4 (${sign} on the wrong side), worst ${worst.toFixed(4)} at ${at(w)}: ${d(w).toFixed(4)} for ${want[w].toFixed(4)}`)
        } else {
            /* THE REACH'S BOUND: a lower bound on the union everywhere (the march never steps past a surface), the union
               itself near the surfaces (what is drawn), on its side everywhere, and above a share of it -- the bound's
               floor where it stands in: max(d sin(slice), far - 2d) against the union, rho the distance from the axis,
               is at least sin(slice) / (2 + sin(slice)) of it (the two cross at rho = far / (2 + sin)) */
            const rg = top.prim === 'circular' ? top : null, slice = 2 * Math.PI / rg.params.count
            const share = Math.sin(slice) / (2 + Math.sin(slice))
            let above = 0, near = 0, sign = 0, crawl = 0, bounded = 0, w = -1
            for (let i = 0; i < N; i++) {
                if (d(i) > want[i] + 1e-4) { above++; w = i }
                if (Math.abs(want[i]) < 0.1 && Math.abs(d(i) - want[i]) > 1e-4) near++
                if (Math.sign(d(i)) !== Math.sign(want[i]) && Math.abs(want[i]) > 1e-4) sign++
                if (want[i] > 1e-3 && d(i) < share * want[i] - 1e-4) crawl++
                if (d(i) < want[i] - 1e-3) bounded++
            }
            ok(`${name} (${how}): never above the exact union`, above === 0, `${above} of ${N} above, e.g. at ${w >= 0 ? at(w) : '-'}`)
            ok(`${name} (${how}): the exact union within 0.1 of a surface`, near === 0, `${near} points off`)
            ok(`${name} (${how}): on the union's side everywhere`, sign === 0, `${sign} on the wrong side`)
            ok(`${name} (${how}): never under ${share.toFixed(3)} of the union -- no crawl at the axis`, crawl === 0, `${crawl} points under it`)
            ok(`${name} (${how}): ...and the bound is what stands in somewhere (the test sees it)`, bounded > N / 20, `${bounded} of ${N} bounded`)
        }
        /* THE NORMAL, analytic and turned with its copy: against the nearest copy's own, where it is unambiguous -- near a
           sphere's surface (its normal is the way from its centre), clear of where another copy is nearly as near */
        if (!opts.data) {
            const rg = top.prim === 'circular' ? top : null, ball = rg?.children.find(c => c.prim === 'sphere' && !c.transform?.rot?.z)
            if (rg && ball && still(rg.transform) && rg.children.length === 1) {
                normalsChecked++
                let bad = 0, seen = 0
                for (let i = 0; i < N; i++) {
                    if (Math.abs(want[i]) > 0.05) continue
                    const c = nearestCopy(rg, pts[i])
                    if (c.gap < 0.05) continue
                    const o = ball.transform.pos, ctr = turn([o.x, o.y, o.z], -c.a), v = pts[i].map((x, k) => x - ctr[k]), l = len(v)
                    const n = [got[8 * i + 1], got[8 * i + 2], got[8 * i + 3]]
                    seen++
                    if (Math.abs(len(n) - 1) > 1e-3 || n.reduce((s, x, k) => s + x * v[k] / l, 0) < 0.9999) bad++
                }
                ok(`${name} (${how}): the normal is the nearest copy's own, analytic and turned with it`, seen > 20 && bad === 0, `${bad} of ${seen} wrong`)
            }
        }
    }
}

// the two rings of one sphere with nothing moving them, codegen, visibility live and baked: a check that skips itself is none
ok('the normal was checked on both rings of one sphere, three ways each', normalsChecked === 6, `${normalsChecked} times`)

//----------------------------------------------------------------------------------------------------------------------
// CAPTURING: the pick copy with LOCAL_CAPTURE on, a material reading p_local so the local point is tracked. Six spheres
// off the axis, the ring's group moved: near each copy the point recorded is the sphere's own frame's at that copy --
// the world point turned back by the copy's angle, less the sphere's place -- the frame turned by it, the tag the
// sphere's; and the distance what it is without capturing.
//----------------------------------------------------------------------------------------------------------------------
{
    added.clear()
    const d = M.createDoc()
    M.addMaterial(d, { id: 'dots', preset: 'plastic', code: 'm.roughness = fract(p_local.x * 4.0);' })
    for (const reach of [32, 0]) {
        const id = `rg${reach}`
        ring(d, 'root', id, { count: 6, reach }, { transform: T(reach ? 0 : 4, 0, 0) })
        sphere(d, id, `ball${reach}`, 0.3, [0.8, 0, 0.1], { material: 'dots' })
    }
    const tree = M.toTree(d)
    const scene = generate(tree, { id: 'circularcap' })
    ok('capturing: the scene tracks the local point (a material reads p_local)', /XF_P/.test(scene.wgsl) && /XF_P/.test(scene.pickWgsl))
    for (const [ri, reach] of [32, 0].entries()) {
        const off = reach ? 0 : 4
        const ps = pts.map(p => [p[0] + off, p[1], p[2]])
        const plain = await field(scene, ps, dirs), cap = await field(scene, ps, dirs, true)
        const rg = tagged(M.toTree(d)).children[ri]
        const tagOf = scene.tags.indexOf(`ball${reach}`) + 1
        let same = 0, bad = 0, frame = 0, tag = 0, seen = 0, ex = ''
        for (let i = 0; i < N; i++) {
            if (Math.abs(plain[8 * i] - cap[8 * i]) > 1e-6) same++
            const q = pts[i], c = nearestCopy(rg, q)
            if (Math.abs(c.d) > 0.05 || c.gap < 0.05) continue
            // only where the ring is the scene's nearest surface: the other ring's are 4 away
            seen++
            const local = turn(q, c.a).map((v, k) => v - [0.8, 0, 0.1][k]), rec = [cap[8 * i + 1], cap[8 * i + 2], cap[8 * i + 3]]
            if (len(local.map((v, k) => v - rec[k])) > 1e-4) { bad++; ex ||= `at ${at(i)}: ${rec.map(v => v.toFixed(3))} for ${local.map(v => v.toFixed(3))}` }
            if (Math.abs(cap[8 * i + 4] - Math.cos(c.a)) > 1e-5 || Math.abs(cap[8 * i + 5] - Math.sin(c.a)) > 1e-5) frame++
            if (cap[8 * i + 7] !== tagOf) tag++
        }
        const what = `capturing, reach ${reach}`
        ok(`${what}: the distance the same as without`, same === 0, `${same} of ${N} differ`)
        ok(`${what}: the local point the winning copy's own`, seen > 50 && bad === 0, `${bad} of ${seen} wrong, ${ex}`)
        ok(`${what}: the frame turned with the copy`, frame === 0, `${frame} of ${seen} wrong`)
        ok(`${what}: the tag the sphere's`, tag === 0, `${tag} of ${seen} wrong`)
    }
}

console.log(`circular array on a GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
