//======================================================================================================================
// A PATTERN FRAME ON A REAL WEBGPU (model.js setPattern, version 24; codegen patIn): what a hit records on a node in its
// pattern frame, against the same scene without one. Run:
//   node builder/test/pattern.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as scenedata.gpu.mjs (whose harness this is): it needs the `webgpu` package (npm i -g
// webgpu) and a Vulkan driver (lavapipe in a container). Without either it says so and exits 0.
//
// WHAT IT SHOWS, on points on every surface of a scene made for it, the pick copy's capture (core/pick.js) -- the node,
// the local point a material reads (p_local), its frame (R_local) and its scale (S_local):
//   - where the node whose frame a material is read in (model.js patternOwner) has a pattern frame { t, R }: the local
//     point R^T (p - t) and the frame F R of the capture without it, the scale and the node the same -- an object at the
//     top level, a CSG group (a shape's own frame inside it changing nothing), an object inside a straight group (its
//     material frame XF_Q moved by the pattern's), a shell (its child's own frame changing nothing), a circular array's
//     child (its own, in the copy that won);
//   - everywhere else, the capture without it, bit for bit;
//   - the same as codegen's with the scene as data, where a node in its pattern frame is a compiled subtree;
// and a relief read in a pattern frame: turned 90 degrees about y and moved along x, a relief of q.z is the relief of
// q.x - t.x without one -- the same field near the surface, codegen's and as data.
// WHAT IT CANNOT SHOW: the picture -- whether wood's rings now run along a table's top is the user's to see.
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(pattern frame GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, patterned } = await import('../codegen.js')
const { estimateBox } = await import('../bounds.js')
const { planOf } = await import('../scenedata.js')
const { modifierGroup } = await import('../modifiers.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { computeUniformTypes, sceneConstantsWGSL, UniformSpec } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
// kept in a global: the Dawn instance must outlive the device (scenedata.gpu.mjs says why)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(pattern frame GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* ONE KERNEL OVER A LIST OF POINTS: `body` reads point i (evalIn[2i]) and its direction (evalIn[2i + 1]) and writes W
   floats at evalOut[W i] */
const W = 16
async function run(scene, wgsl, body, pts, dirs) {
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL({ ...scene, wgsl })}${wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&evalIn) / 2u) { return; }
        let o = ${W}u * i;
        ${body}`, computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) },
        { async: false, wg: [64, 1, 1] })
    await prog.ready
    const n = pts.length / 3
    const input = new Float32Array(8 * n)
    for (let i = 0; i < n; i++) { input.set(pts.slice(3 * i, 3 * i + 3), 8 * i); input.set(dirs.slice(3 * i, 3 * i + 3), 8 * i + 4) }
    const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(4 * W * n)
    const buffers = scene.init ? await scene.init(WG) : {}
    prog.resources = { evalIn: inB.b, evalOut: outB.b, ...buffers }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    return out
}
/* the field: s.xyzw, the material */
const field = (scene, pts, dirs) => run(scene, scene.wgsl, `
        let h = SDF(newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0));
        evalOut[o] = h.s.x; evalOut[o + 1u] = h.s.y; evalOut[o + 2u] = h.s.z; evalOut[o + 3u] = h.s.w; evalOut[o + 4u] = f32(h.m);`, pts, dirs)
/* the pick copy with capture on (core/pick.js): the tag, the local point, the scale, the frame's three columns */
const capture = (scene, pts, dirs) => run(scene, scene.pickWgsl, `
        LOCAL_CAPTURE = true; HIT_TAG = 0u; HIT_TAG_D = 3.0e38;
        let r = newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0);
        HIT_LOCAL = r.pos; XF_P = r.pos; HIT_FRAME = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0); HIT_SCALE = 1.0;
        _ = SDF(r);
        LOCAL_CAPTURE = false;
        evalOut[o] = f32(HIT_TAG); evalOut[o + 1u] = HIT_TAG_D;
        evalOut[o + 2u] = HIT_LOCAL.x; evalOut[o + 3u] = HIT_LOCAL.y; evalOut[o + 4u] = HIT_LOCAL.z; evalOut[o + 5u] = HIT_SCALE;
        for (var c = 0u; c < 3u; c++) { for (var k = 0u; k < 3u; k++) { evalOut[o + 6u + 3u * c + k] = HIT_FRAME[c][k]; } }`, pts, dirs)

let seed = 4242
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const N = 2048
function scatter(box, grow) {
    const pts = [], dirs = []
    for (let i = 0; i < N; i++) {
        for (let k = 0; k < 3; k++) { const c = (box.lo[k] + box.hi[k]) / 2, h = (box.hi[k] - box.lo[k]) * grow / 2 + 0.5; pts.push(c + (2 * rnd() - 1) * h) }
        const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z); dirs.push(s * Math.cos(a), s * Math.sin(a), z)
    }
    return { pts, dirs }
}
/* ...moved onto the nearest surface, a few times, along the field's gradient by differences: a box, a twist and a shell
   give no normal of their own (scene_api.js csgNormal), and a point left off every surface is no point to judge a capture
   by (below). Then off it by a little. */
async function onSurfaces(scene, { pts, dirs }, size) {
    const P = pts.slice(), h = 1e-3 * size
    for (let it = 0; it < 8; it++) {
        const d0 = await field(scene, P, dirs)
        const grad = [[], [], []]
        for (let k = 0; k < 3; k++) for (const sgn of [1, -1]) {
            const Q = P.slice(); for (let i = 0; i < N; i++) Q[3 * i + k] += sgn * h
            const dq = await field(scene, Q, dirs)
            for (let i = 0; i < N; i++) grad[k][i] = (grad[k][i] ?? 0) + sgn * dq[W * i + 3] / (2 * h)
        }
        for (let i = 0; i < N; i++) {
            const d = d0[W * i + 3], g = [grad[0][i], grad[1][i], grad[2][i]], l = Math.hypot(...g)
            if (l > 0.3 && Math.abs(d) < 1e6) for (let k = 0; k < 3; k++) P[3 * i + k] -= g[k] / (l * l) * d
        }
    }
    for (let i = 0; i < 3 * N; i++) P[i] += (rnd() - 0.5) * 2e-4 * size
    return { pts: P, dirs }
}

/* a pattern frame's turn as matrixOf has it: R[c][k], column c (pattern axis c in the node's frame), component k */
const turnOf = P => { const m = M.matrixOf({ ...P, scale: 1 }); return [0, 1, 2].map(c => [0, 1, 2].map(k => m[4 * c + k])) }
const expected = (P, at) => {
    const R = turnOf(P), t = [P.pos.x, P.pos.y, P.pos.z]
    const v = [0, 1, 2].map(k => at.local[k] - t[k])
    const local = [0, 1, 2].map(c => R[c][0] * v[0] + R[c][1] * v[1] + R[c][2] * v[2])         // R^T v
    const frame = [0, 1, 2].map(c => [0, 1, 2].map(k => [0, 1, 2].reduce((s, j) => s + at.frame[j][k] * R[c][j], 0)))    // F R
    return { local, frame }
}
const read = (h, i) => {
    const o = W * i
    return { tag: h[o], local: [h[o + 2], h[o + 3], h[o + 4]], scale: h[o + 5], frame: [0, 1, 2].map(c => [0, 1, 2].map(k => h[o + 6 + 3 * c + k])) }
}
const near = (a, b, tol) => a.every((x, i) => Math.abs(x - b[i]) <= tol * Math.max(1, Math.abs(b[i])))

// ---- the scene: in mm, a material reading its point; the same tree with and without its pattern frames
const T = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale: s })
const P1 = { pos: { x: 0.3, y: -0.2, z: 0.5 }, rot: { x: 0, y: 90, z: 15 } }
const P2 = { pos: { x: -0.4, y: 0.1, z: 0 }, rot: { x: 35, y: 0, z: -60 } }
const P3 = { pos: { x: 0, y: 0, z: 2 }, rot: { x: 0, y: 0, z: 90 } }
function sceneDoc(withPatterns) {
    const d = M.createDoc()
    d.unit = 'mm'
    M.addMaterial(d, { id: 'grain', code: 'm.baseColor = m.baseColor * (0.5 + 0.5 * fract(p_local.x)) + 0.0 * R_local[0] * S_local;' })
    M.addObject(d, 'root', { id: 'a', primitive: 'box', material: 'grain', transform: T(0, 0, 0, 10, 20, 30, 1.3) })
    M.addObject(d, 'root', { id: 'b', primitive: 'sphere', material: 'grain', transform: T(4, 0, 0) })           // none: the same
    M.addGroup(d, 'root', { id: 'cut', blend: 0.1, transform: T(0, 4, 0, 0, 0, 25) })
    M.addObject(d, 'cut', { id: 'cb', primitive: 'box', material: 'grain' })
    M.addObject(d, 'cut', { id: 'cs', primitive: 'sphere', material: 'grain', join: 'subtract', transform: T(0.6, 0.6, 0.6), params: { radius: 0.7 } })
    M.addGroup(d, 'root', { id: 'tw', ...modifierGroup('twist'), transform: T(-4, 0, 0, 0, 0, 10) })
    M.setStraightMaterial(d, 'tw', true)
    M.addObject(d, 'tw', { id: 'tc', primitive: 'capsule', material: 'grain', transform: T(0, 0, 0.3, 20, 0, 0) })
    M.addObject(d, 'tw', { id: 'tb', primitive: 'box', material: 'grain', transform: T(0, 1.8, 0) })           // none, in the group
    // a shell (group code on its children's result, codegen isAfter): its children a Hit of their own, its code's fold
    M.addGroup(d, 'root', { id: 'sh', ...modifierGroup('shell'), transform: T(0, -4, 0, 15, 0, 0) })
    M.find(d, 'sh').node.params.thickness = 0.1
    M.addObject(d, 'sh', { id: 'ss', primitive: 'sphere', material: 'grain', params: { radius: 1.2 } })
    /* a circular array (modifiers.js circular): its copies folded in Hits of their own, and the winning copy evaluated once
       more into the scene's under capture -- so its child records its own frame, in that copy's turn, and its own pattern
       frame moves that */
    const cg = modifierGroup('circular')
    M.addGroup(d, 'root', { id: 'ring', ...cg, params: { ...cg.params, count: 5 }, transform: T(4, 4, 0) })
    M.addObject(d, 'ring', { id: 'rb', primitive: 'box', material: 'grain', params: { size: { x: 0.3, y: 0.3, z: 0.5 }, rounding: 0 }, transform: T(1.2, 0, 0, 0, 0, 20) })
    if (withPatterns) {
        M.setPattern(d, 'a', P1)
        M.setPattern(d, 'cut', P2)
        M.setPattern(d, 'cs', P3)          // a shape of 'cut': its material is read in the group's frame, so nothing
        M.setPattern(d, 'tc', P1)
        M.setPattern(d, 'sh', P3)
        M.setPattern(d, 'ss', P2)          // inside the shell: the same, nothing
        M.setPattern(d, 'rb', P2)          // in a circular array's copy: its own
    }
    return d
}
const A = sceneDoc(false), B = sceneDoc(true)
const treeOf = d => M.toTree(d, { keepDisabled: true })
ok('patternOwner: an object its own, a CSG shape its group, a shelled shape its shell, a twist none, a circular array\'s child its own',
    M.patternOwner(B, 'a') === 'a' && M.patternOwner(B, 'cs') === 'cut' && M.patternOwner(B, 'cut') === 'cut' && M.patternOwner(B, 'tc') === 'tc'
    && M.patternOwner(B, 'tw') === null && M.patternOwner(B, 'ss') === 'sh' && M.patternOwner(B, 'sh') === 'sh'
    && M.patternOwner(B, 'rb') === 'rb' && M.patternOwner(B, 'ring') === null)
const plan = planOf(treeOf(B), { wantLocal: true })
ok('as data, the nodes in their pattern frames are compiled subtrees, and only those', ['a', 'cut', 'tw', 'sh'].every(id => plan.sub.has(id)) && !plan.sub.has('b'),
    `subs: ${[...plan.sub.keys()].join(', ')}`)

const CA = generate(treeOf(A), { id: 'built', liveVisibility: true })
const CB = generate(treeOf(B), { id: 'built', liveVisibility: true })
const DB = generate(treeOf(B), { id: 'built', liveVisibility: true, data: true })
const box = estimateBox(M.toTree(A))
const size = Math.max(...[0, 1, 2].map(k => box.hi[k] - box.lo[k]))
const S = await onSurfaces(CA, scatter(box, 1.1), size)
const ca = await capture(CA, S.pts, S.dirs)
for (const [name, X] of [['codegen', CB], ['as data', DB]]) {
    const cb = await capture(X, S.pts, S.dirs)
    let moved = 0, same = 0, tagged = 0, badTag = 0, badMoved = 0, badSame = 0, badScale = 0, ex = null
    const counted = new Map()
    for (let i = 0; i < N; i++) {
        const a = read(ca, i), b = read(cb, i)
        /* ON A SURFACE: the tag is the nearest fold of all, a CSG shape's own among them, and only where that surface passes
           through the point is it the one the capture recorded (or its group's). A box has no normal for onSurfaces to
           move a point onto it by, and off every surface the two can be different nodes, the same with a frame or not */
        if (!a.tag || !(ca[W * i + 1] < 1e-3 * size)) continue
        tagged++
        const ida = CA.tags[a.tag - 1], idb = X.tags[b.tag - 1]
        if (ida !== idb) { badTag++; ex ??= `node ${ida} vs ${idb}`; continue }
        if (Math.abs(a.scale - b.scale) > 1e-5 * Math.abs(a.scale)) badScale++
        const owner = M.patternOwner(B, ida), P = owner ? M.find(B, owner).node.pattern : null
        counted.set(owner, (counted.get(owner) ?? 0) + 1)
        if (P) {
            moved++
            const e = expected(P, a)
            if (!near(b.local, e.local, 2e-5) || !near(b.frame.flat(), e.frame.flat(), 2e-5)) { badMoved++; ex ??= `${ida} in ${owner}'s frame: ${b.local} vs ${e.local}` }
        } else {
            same++
            if (!near(b.local, a.local, 0) || !near(b.frame.flat(), a.frame.flat(), 0)) { badSame++; ex ??= `${ida}, no frame: ${b.local} vs ${a.local}` }
        }
    }
    ok(`${name}: the pick names the same node with a pattern frame as without, its scale the same`, tagged > N / 4 && badTag === 0 && badScale === 0,
        `${tagged} of ${N} on a surface, node ${badTag}, scale ${badScale}${ex ? ` (${ex})` : ''}`)
    ok(`${name}: in a pattern frame, the local point R^T (p - t) and the frame F R`, moved > 200 && badMoved === 0, `${badMoved} of ${moved}${ex ? ` (${ex})` : ''}`)
    ok(`${name}: anywhere else, the capture without one, bit for bit`, same > 200 && badSame === 0, `${badSame} of ${same}${ex ? ` (${ex})` : ''}`)
    ok(`${name}: every part of the scene sampled -- its object, the CSG group, the straight group's capsule, the shell, a circular array's copies, the rest`,
        ['a', 'cut', 'tc', 'sh', 'rb', 'b', 'tb'].every(k => (counted.get(k) ?? 0) > 20), JSON.stringify([...counted]))
}

// ---- a relief read in a pattern frame: q.z there is (p - t).x here
function reliefDoc(code, pattern) {
    const d = M.createDoc()
    d.unit = 'mm'
    M.addMaterial(d, { id: 'rel' })
    M.setRelief(d, 'rel', 'noise')
    const R = d.materials.find(m => m.id === 'rel').relief
    R.params.amplitude = 0.08; R.params.size = 0.35
    R.code = code
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere', material: 'rel', params: { radius: 2 }, transform: T(0.5, 0, 0, 20, 0, 10) })
    if (pattern) M.setPattern(d, 'ball', pattern)
    return d
}
const RA = reliefDoc('h = amplitude * sin((q.x - 0.3) / size);\nslope = amplitude / size;', null)
const RB = reliefDoc('h = amplitude * sin(q.z / size);\nslope = amplitude / size;', { pos: { x: 0.3, y: 0, z: 0 }, rot: { x: 0, y: 90, z: 0 } })
ok('a relief alone is in its pattern frame too (codegen patterned: no material reads p_local)', patterned(treeOf(RB).children[0], { relief: true }))
/* without culling: the ball is a dear node (codegen ONLY THE DEAR ONES), whose box the host measures and sends
   (app.html pushCull); a box test is not what this is about */
const RCA = generate(treeOf(RA), { id: 'built', liveVisibility: true, cull: false })
const RCB = generate(treeOf(RB), { id: 'built', liveVisibility: true, cull: false }), RDB = generate(treeOf(RB), { id: 'built', liveVisibility: true, data: true, cull: false })
// ...and the same relief code with no frame: another field, or the comparison below could not fail
const RCC = generate(treeOf(reliefDoc('h = amplitude * sin(q.z / size);\nslope = amplitude / size;', null)), { id: 'built', liveVisibility: true, cull: false })
/* in the relief's band, by the sphere's own distance: a relief's field has no normal (codegen object(): by differences),
   so onSurfaces cannot move a point onto it -- outside the band both are d - amplitude, and would agree whatever the frame */
const RS = { pts: [], dirs: [] }
for (let i = 0; i < N; i++) {
    const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z), u = [s * Math.cos(a), s * Math.sin(a), z], r = 2 + (2 * rnd() - 1) * 0.1
    /* a direction of its own: along the sphere's normal, dot(n, dir) rounds above 1 and fold's test (scene_api.js) drops
       the surface -- a ray never leaves a point straight along it, a list of points made this way does */
    const z2 = 2 * rnd() - 1, a2 = 2 * Math.PI * rnd(), s2 = Math.sqrt(1 - z2 * z2)
    RS.pts.push(0.5 + r * u[0], r * u[1], r * u[2]); RS.dirs.push(s2 * Math.cos(a2), s2 * Math.sin(a2), z2)
}
const fa = await field(RCA, RS.pts, RS.dirs)
let bumps = 0, empty = 0
for (let i = 0; i < N; i++) {
    const p = RS.pts.slice(3 * i, 3 * i + 3)
    if (Math.abs(fa[W * i + 3]) > 1e6) { empty++; continue }
    bumps = Math.max(bumps, Math.abs(fa[W * i + 3] - (Math.hypot(p[0] - 0.5, p[1], p[2]) - 2)))
}
ok('the relief is there: the field off the sphere\'s by up to its amplitude', bumps > 0.05 && bumps < 0.2 && empty === 0,
    `${bumps.toFixed(4)} mm; ${empty} of ${N} points with no surface near`)
{
    const fc = await field(RCC, RS.pts, RS.dirs)
    let apart = 0
    for (let i = 0; i < N; i++) apart = Math.max(apart, Math.abs(fa[W * i + 3] - fc[W * i + 3]))
    ok('...and without the frame, the same relief code is another field', apart > 0.05, `${apart.toFixed(4)} mm at most`)
}
for (const [name, X] of [['codegen', RCB], ['as data', RDB]]) {
    const fb = await field(X, RS.pts, RS.dirs)
    let worst = 0, n = 0
    for (let i = 0; i < N; i++) { if (Math.abs(fa[W * i + 3]) > 1e6) continue; n++; worst = Math.max(worst, Math.abs(fa[W * i + 3] - fb[W * i + 3])) }
    ok(`${name}: a relief of q.z in a frame turned 90 degrees about y and moved 0.3 along x is a relief of q.x - 0.3 without one`,
        n > N * 0.9 && worst < 1e-4, `worst difference ${worst.toExponential(2)} mm over ${n} points in its band`)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
