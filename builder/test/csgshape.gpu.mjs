//======================================================================================================================
// A PLAIN GROUP AS ONE OF A CSG GROUP'S SHAPES, on a WebGPU in node (Dawn). Run:
//   node builder/test/csgshape.gpu.mjs     (optional: npm i -g webgpu, and lavapipe; says so and passes without)
//
// A group whose children all join by union is a plain group (codegen isCsg): its children fold into the Hit in scope
// one by one (scene_api.js fold), which keeps the SURFACE as argmin |d| -- the nearest boundary, in either direction.
// That is what the march needs of separate objects. It is not a union's signed distance: at a point 0.6 inside one
// sphere and 0.1 outside another that overlaps it, fold says +0.1, "outside". A CSG group reads its shapes' signed
// distances, so a plain group as one of them was combined as a wrong operand: a subtraction cut wrongly, an
// intersection kept the wrong part, near wherever its children overlap. Found by the STEP/STL import's GPU check
// (2026-10-21): its rounded box's core, a plain union intersected with rounded prisms, let rays run through its edges.
//
// WHAT IT SHOWS: for documents made here -- a plain group subtracted, intersected, as the base; plain groups nested in
// one; an array whose copies overlap; one turned and scaled; a light inside -- the scene's SDF, codegen's and the scene
// as data's, at points in and around each, against the exact CSG value worked out here in JS from the shapes' own
// distances (spheres and boxes, each exact): a group's shapes combined in order by their joins, a union an exact min.
// Outside the overlaps fold and min agree (for exact distances, two shapes that do not meet never disagree); inside
// them they do not, so the documents are made to overlap.
// WHAT IT CANNOT SHOW: the picture, which is the user's.
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(CSG shape GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate } = await import('../codegen.js')
const { modifierGroup } = await import('../modifiers.js')
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
    console.log(`(CSG shape GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
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
/* THE SCENE'S SDF AT A LIST OF POINTS: its distance and material, each point with a direction of its own */
async function field(scene, pts, dirs) {
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&evalIn) / 2u) { return; }
        let h = SDF(newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0));
        evalOut[2u * i] = h.s.w; evalOut[2u * i + 1u] = f32(h.m);`,
        computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) },
        { async: false, wg: [64, 1, 1] })
    await prog.ready
    const n = pts.length
    const input = new Float32Array(8 * n)
    for (let i = 0; i < n; i++) { input.set(pts[i], 8 * i); input.set(dirs[i], 8 * i + 4) }
    const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(8 * n)
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
// group's shapes combined in order by their joins -- union an exact min, subtract max(k, -d), intersect max(k, d) --
// over each of its copies, which are a union too. A light, an export box and a haze box are no shapes (codegen
// shapesOf). The scene is one top-level node, whose fold into the empty Hit is the node's own value.
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
const shapeOf = n => n.kind === 'group' || !['light', 'export', 'haze'].includes(n.type)
function truth(n, p) {
    const t = n.transform, q = t ? fromParent(t, p) : p, s = t?.scale ?? 1
    if (n.kind === 'object') return s * PRIM[n.prim](q, n.params)
    const shapes = n.children.filter(c => c.enabled !== false && shapeOf(c))
    /* a group's code, the two this test uses (modifiers.js): a mirror across its x = 0 before its children, a round
       taking its radius off what they give, in its own frame */
    const combine = x => shapes.reduce((k, c, i) => {
        const d = truth(c, x), j = c.join ?? 'union'
        return i === 0 ? d : j === 'subtract' ? Math.max(k, -d) : j === 'intersect' ? Math.max(k, d) : Math.min(k, d)
    }, 1e7)
    const coded = x => n.prim === 'mirror' ? combine([Math.abs(x[0]), x[1], x[2]]) : n.prim === 'round' ? combine(x) - n.params.radius : combine(x)
    const copies = n.copies?.length ? n.copies : [null]
    return s * Math.min(...copies.map(T => T ? T.scale * coded(fromParent(T, q)) : coded(q)))
}
/* each node's primitive by name, which the document keeps as code: the test's own record of what it added */
const added = new Map()
const obj = (d, parent, id, prim, params, extra = {}) => {
    M.addObject(d, parent, { id, primitive: prim, params, ...extra })
    added.set(id, prim)
}
const modified = (d, parent, id, mod, extra = {}) => {
    M.addGroup(d, parent, { id, ...modifierGroup(mod), ...extra })
    added.set(id, mod)
}
const tagged = n => ({ ...n, prim: added.get(n.id), children: n.children?.map(tagged) })

//----------------------------------------------------------------------------------------------------------------------
// THE DOCUMENTS: in each, two spheres that overlap (a and b, 0.5 in radius, 0.6 apart) inside a plain group `rig`
//----------------------------------------------------------------------------------------------------------------------
const T = (x, y, z, rz = 0, s = 1, rx = 0) => ({ pos: { x, y, z }, rot: { x: rx, y: 0, z: rz }, scale: s })
const pair = (d, g, prefix = '') => {
    obj(d, g, `${prefix}a`, 'sphere', { radius: 0.5 }, { transform: T(-0.3, 0, 0.3) })
    obj(d, g, `${prefix}b`, 'sphere', { radius: 0.5 }, { transform: T(0.3, 0, 0.3) })
}
const box = (d, g, id, size, extra = {}) => obj(d, g, id, 'box', { size: { x: size[0], y: size[1], z: size[2] }, rounding: 0 }, extra)
const DOCS = {
    /* the case the import met, in its plainest form: a box less a plain group of two overlapping spheres */
    'a plain group subtracted': () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part' })
        box(d, 'part', 'hb', [0.9, 0.6, 0.6])
        M.addGroup(d, 'part', { id: 'rig', join: 'subtract' })
        pair(d, 'rig')
        return d
    },
    'a plain group intersected': () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part' })
        box(d, 'part', 'hb', [0.9, 0.6, 0.6])
        M.addGroup(d, 'part', { id: 'rig', join: 'intersect' })
        pair(d, 'rig')
        return d
    },
    /* the import's rounded box: a union as the base, cut by what comes after it */
    'a plain group as the base': () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part' })
        M.addGroup(d, 'part', { id: 'rig' })
        pair(d, 'rig')
        box(d, 'part', 'cut', [0.2, 0.2, 1.5], { join: 'subtract', transform: T(0.5, 0.3, 0) })
        return d
    },
    /* plain groups in a plain group that is a shape: the outer's children, a group among them, a union too */
    'plain groups nested in a subtracted one': () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part' })
        box(d, 'part', 'hb', [0.9, 0.6, 0.6])
        M.addGroup(d, 'part', { id: 'outer', join: 'subtract' })
        M.addGroup(d, 'outer', { id: 'rig' })
        pair(d, 'rig')
        obj(d, 'outer', 'c', 'sphere', { radius: 0.35 }, { transform: T(0, 0.35, 0.3) })
        return d
    },
    /* an array as a shape: its copies overlap one another, and are a union too -- its child's join, as the base's,
       dormant (an intersection here: at the copies after the first the base is joined in, by a union) */
    'an array subtracted, its copies overlapping': () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part' })
        box(d, 'part', 'hb', [1.2, 0.6, 0.6])
        M.addGroup(d, 'part', { id: 'row', join: 'subtract' })
        obj(d, 'row', 'rs', 'sphere', { radius: 0.4 }, { transform: T(0, 0, 0.3), join: 'intersect' })
        M.setCopies(d, 'row', [T(-0.5, 0, 0), T(0, 0, 0), T(0.5, 0.1, 0, 0, 0.8)])
        return d
    },
    /* every frame on the way: the part, the group and its children turned, moved and scaled */
    'a plain group subtracted, turned and scaled': () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part', transform: T(0.2, -0.1, 0.1, 25, 1.3, 10) })
        box(d, 'part', 'hb', [0.9, 0.6, 0.6], { transform: T(0, 0, 0, -10) })
        M.addGroup(d, 'part', { id: 'rig', join: 'subtract', transform: T(0.05, 0.1, -0.05, 30, 0.8) })
        obj(d, 'rig', 'a', 'sphere', { radius: 0.5 }, { transform: T(-0.3, 0, 0.3) })
        obj(d, 'rig', 'b', 'sphere', { radius: 0.5 }, { transform: T(0.3, 0, 0.3, 40, 1.2) })
        return d
    },
    /* a hidden child (live visibility: absent, not an empty shape) -- the pair's first, so the other is the base -- and
       in an array of two children the first hidden: the second the base of the first copy, joined in at the others */
    'a plain group subtracted, its first child hidden': () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part' })
        box(d, 'part', 'hb', [0.9, 0.6, 0.6])
        M.addGroup(d, 'part', { id: 'rig', join: 'subtract' })
        pair(d, 'rig')
        obj(d, 'rig', 'c', 'sphere', { radius: 0.35 }, { transform: T(0.1, 0.3, 0.3) })
        M.setEnabled(d, 'a', false)
        return d
    },
    'an array subtracted, its first child hidden': () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part' })
        box(d, 'part', 'hb', [1.2, 0.6, 0.6])
        M.addGroup(d, 'part', { id: 'row', join: 'subtract' })
        obj(d, 'row', 'rh', 'sphere', { radius: 0.3 }, { transform: T(0, 0.4, 0.3) })
        obj(d, 'row', 'rs', 'sphere', { radius: 0.4 }, { transform: T(0, 0, 0.3) })
        obj(d, 'row', 'rt', 'sphere', { radius: 0.3 }, { transform: T(0.2, -0.2, 0.3) })
        M.setCopies(d, 'row', [T(-0.5, 0, 0), T(0, 0, 0), T(0.5, 0.1, 0, 0, 0.8)])
        M.setEnabled(d, 'rh', false)
        return d
    },
    /* GROUP CODE WHOSE OWN CHILDREN JOIN: codegen's children function combines them; as data a before or an after
       group was a record whose children's records folded in one by one, so a mirror of a box less a sphere was the box
       and the sphere (until 0.next: such a group is compiled as before). No plain group here: the other bug. */
    'a mirror of a box less a sphere': () => {
        const d = M.createDoc()
        modified(d, 'root', 'mir', 'mirror', { transform: T(0.1, 0, 0, 20) })
        box(d, 'mir', 'hb', [0.5, 0.5, 0.5], { transform: T(0.3, 0, 0) })
        obj(d, 'mir', 'cut', 'sphere', { radius: 0.45 }, { transform: T(0.6, 0, 0.4), join: 'subtract' })
        return d
    },
    'a round of a box less a sphere': () => {
        const d = M.createDoc()
        modified(d, 'root', 'rd', 'round', { transform: T(0, 0.1, 0, 0, 1.1) })
        box(d, 'rd', 'hb', [0.7, 0.5, 0.5])
        obj(d, 'rd', 'cut', 'sphere', { radius: 0.5 }, { transform: T(0.4, 0, 0.4), join: 'subtract' })
        return d
    },
    /* a light in the group (OpticsBench2's laser in its lens holder): drawn after the combine, no shape of it */
    'a plain group with a light in it, subtracted': () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'part' })
        box(d, 'part', 'hb', [0.9, 0.6, 0.6])
        M.addGroup(d, 'part', { id: 'rig', join: 'subtract' })
        M.addLight(d, 'rig', { id: 'lamp', shape: 'disc', transform: T(0, 0, 0.9) })
        pair(d, 'rig')
        return d
    },
}

/* points in and around the part, and a direction each */
let seed = 4242
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const N = 4096
const pts = [], dirs = []
for (let i = 0; i < N; i++) {
    pts.push([0, 1, 2].map(() => (2 * rnd() - 1) * 1.3))
    const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z)
    dirs.push([s * Math.cos(a), s * Math.sin(a), z])
}

for (const [name, make] of Object.entries(DOCS)) {
    added.clear()
    const doc = make()
    const top = tagged(M.toTree(doc)).children.find(shapeOf)
    const want = pts.map(p => truth(top, p))
    for (const [how, opts] of [['codegen', {}], ['codegen, visibility live', { liveVisibility: true }], ['as data', { liveVisibility: true, data: true }]]) {
        const scene = generate(M.toTree(doc, { keepDisabled: !!opts.liveVisibility }), { id: 'csgshape', ...opts })
        if (opts.data && !scene.init) { ok(`${name} (${how}): the scene is data`, false, 'no records'); continue }
        const got = await field(scene, pts, dirs)
        /* A LIGHT'S FACE is a surface of the scene, folded in after the combine (codegen collectLights): where it is the
           nearer by |d| the point is the light's (its material, or behind a one-sided face MATID_BLACK, a transparent
           one's MATID_CLEAR), and must only be nearer than the part */
        const lit = new Set([...scene.wgsl.matchAll(/const (?:matid_\w+|MATID_BLACK|MATID_CLEAR): u32 = (\d+)u;(?:\s+\/\/ light)?/g)]
            .filter(m => !m[0].startsWith('const matid_') || /\/\/ light/.test(m[0])).map(m => Number(m[1])))
        let off = 0, sign = 0, worst = 0, at = 0, lamp = 0
        for (let i = 0; i < N; i++) {
            if (lit.has(got[2 * i + 1])) { lamp++; if (Math.abs(got[2 * i]) > Math.abs(want[i]) + 1e-4) off++; continue }
            const e = Math.abs(got[2 * i] - want[i])
            if (e > 1e-4) off++
            if (Math.sign(got[2 * i]) !== Math.sign(want[i]) && Math.abs(want[i]) > 1e-4) sign++
            if (e > worst) { worst = e; at = i }
        }
        ok(`${name} (${how}): the distance is the exact CSG value everywhere, a union of the group's children`, off === 0,
            `${off} of ${N} points off by more than 1e-4 (${sign} on the wrong side), worst ${worst.toFixed(4)} at `
            + `(${pts[at].map(v => v.toFixed(3)).join(', ')}): ${got[2 * at].toFixed(4)} for ${want[at].toFixed(4)}`)
        if (doc.root.children.some(function lamps(n) { return n.type === 'light' || (n.children || []).some(lamps) }))
            ok(`${name} (${how}): ...the light drawn, nearest at some points`, lamp > 0 && lamp < N / 2, `${lamp} of ${N}`)
    }
}

console.log(`CSG shapes on a GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
