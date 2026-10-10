//======================================================================================================================
// THE SCENE AS DATA ON A REAL WEBGPU: the evaluator computes what codegen computed. Run:
//   node builder/test/scenedata.gpu.mjs [scene.json ...]
//
// OPTIONAL, AND LOUD ABOUT IT. It needs the `webgpu` package (Dawn for node: `npm i -g webgpu`, as playwright is got
// for the .check tests -- the repository has no package.json) and a Vulkan driver for it to run on (in a container
// without a GPU, Mesa's lavapipe: `apt-get install mesa-vulkan-drivers`). Without either it says so and exits 0.
// Dawn compiles with Tint, the browser's compiler -- which naga (check-shaders' fourth pass) is not.
//
// WHAT IT SHOWS, per bundled scene, the same tree generated both ways (every node kept, visibility live -- the data
// mode's rule -- so only the representation differs):
//   - the field near every surface: the distance (to f32 rounding), the material, the medium, the normal;
//   - the pick copy's capture there: which node the surface is (each scene's tags to ids), the local point, the scale;
//   - culling: with the same boxes on the top-level nodes that are not compiled subtrees, the same field everywhere
//     (codegen's bxlo/bxhi uniforms against the records' boxes);
// and on a scene made for it, a compiled subtree turned, moved and scaled under a plain group, culled by its box: the
// field never above the unculled one, and the same at its surface. A subtree's record is in its parent's frame, so its
// box is carried there (scenedata.js setBox); in its own frame it would have culled the subtree where it is.
// WHAT IT CANNOT SHOW: speed (a CPU's emulation says nothing of a card), or the picture: the user's.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(scene-data GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate } = await import('../codegen.js')
const { estimateBox } = await import('../bounds.js')
const { planOf } = await import('../scenedata.js')
const { modifierGroup } = await import('../modifiers.js')
const { EVERY_SCENE } = await import('../../test/scenes.mjs')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { computeUniformTypes, sceneConstantsWGSL, UniformSpec } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
/* KEPT IN A GLOBAL: the Dawn instance must outlive the device. Held only in a local, it was garbage-collected and the
   next wait on the GPU crashed the process (std::system_error, a futex), at a moment that varied with the collector */
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)        // as the page does (index.html)
} catch (e) {
    console.log(`(scene-data GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

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
/* ONE KERNEL OVER A LIST OF POINTS: `body` reads point i (evalIn[2i]) and its direction (evalIn[2i + 1]) and writes 8
   floats at evalOut[8i] */
async function run(scene, wgsl, body, pts, dirs, extra = {}) {
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL({ ...scene, wgsl })}${wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&evalIn) / 2u) { return; }
        ${body}`, computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) },
        { async: false, wg: [64, 1, 1] })
    await prog.ready
    const n = pts.length / 3
    const input = new Float32Array(8 * n)
    for (let i = 0; i < n; i++) { input.set(pts.slice(3 * i, 3 * i + 3), 8 * i); input.set(dirs.slice(3 * i, 3 * i + 3), 8 * i + 4) }
    const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(32 * n)
    const buffers = scene.init ? await scene.init(WG) : {}
    prog.resources = { evalIn: inB.b, evalOut: outB.b, ...buffers }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64], ...extra }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    return out
}
/* the field: s.xyzw, the material, the medium, insideW */
const field = (scene, pts, dirs, extra) => run(scene, scene.wgsl, `
        let h = SDF(newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0));
        evalOut[8u * i] = h.s.x; evalOut[8u * i + 1u] = h.s.y; evalOut[8u * i + 2u] = h.s.z; evalOut[8u * i + 3u] = h.s.w;
        evalOut[8u * i + 4u] = f32(h.m); evalOut[8u * i + 5u] = f32(h.a); evalOut[8u * i + 6u] = h.insideW; evalOut[8u * i + 7u] = 0.0;`,
    pts, dirs, extra)
/* the pick copy with capture on (core/pick.js): the tag of the surface through the point, the local point and scale */
const capture = (scene, pts, dirs) => run(scene, scene.pickWgsl, `
        LOCAL_CAPTURE = true; HIT_TAG = 0u; HIT_TAG_D = 3.0e38;
        let r = newRay(evalIn[2u * i].xyz, evalIn[2u * i + 1u].xyz, VEC4(1.0), 1.0);
        HIT_LOCAL = r.pos; XF_P = r.pos; HIT_FRAME = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0); HIT_SCALE = 1.0;
        _ = SDF(r);
        LOCAL_CAPTURE = false;
        evalOut[8u * i] = f32(HIT_TAG); evalOut[8u * i + 1u] = HIT_TAG_D;
        evalOut[8u * i + 2u] = HIT_LOCAL.x; evalOut[8u * i + 3u] = HIT_LOCAL.y; evalOut[8u * i + 4u] = HIT_LOCAL.z;
        evalOut[8u * i + 5u] = HIT_SCALE; evalOut[8u * i + 6u] = 0.0; evalOut[8u * i + 7u] = 0.0;`, pts, dirs)

let seed = 777
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const N = 2048
/* points in and around a box, and a direction each */
function scatter(box, grow) {
    const pts = [], dirs = []
    for (let i = 0; i < N; i++) {
        for (let k = 0; k < 3; k++) { const c = (box.lo[k] + box.hi[k]) / 2, h = (box.hi[k] - box.lo[k]) * grow / 2 + 0.5; pts.push(c + (2 * rnd() - 1) * h) }
        const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z); dirs.push(s * Math.cos(a), s * Math.sin(a), z)
    }
    return { pts, dirs }
}
/* ...moved onto the nearest surface by a field's own distance and normal, a few times, then off it by a little */
async function onSurfaces(scene, { pts, dirs }, size) {
    const P = pts.slice()
    for (let it = 0; it < 4; it++) {
        const h = await field(scene, P, dirs)
        for (let i = 0; i < N; i++) {
            const o = 8 * i, d = h[o + 3], n = [h[o], h[o + 1], h[o + 2]], l = Math.hypot(...n)
            if (l > 0.5 && Math.abs(d) < 1e6) for (let k = 0; k < 3; k++) P[3 * i + k] -= n[k] / l * d
        }
    }
    for (let i = 0; i < 3 * N; i++) P[i] += (rnd() - 0.5) * 2e-3 * size
    return { pts: P, dirs }
}
const relDiff = (x, y) => Math.abs(x - y) / Math.max(1, Math.abs(x))
const normalDiffers = (a, b, o) => {
    const nA = [a[o], a[o + 1], a[o + 2]], nB = [b[o], b[o + 1], b[o + 2]], la = Math.hypot(...nA), lb = Math.hypot(...nB)
    return (la > 0.5) !== (lb > 0.5) || (la > 0.5 && (nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]) / (la * lb) < 0.9999)
}

/* GROUP CODE AS DATA. BEFORE GROUPS (codegen isBefore: code that only moves the point its children see): each of the
   four space modifiers, turned and scaled, over what a group can hold -- a CSG group, an array, another before group, an
   object wearing a material's relief (a compiled subtree under a warp: XF_K, the relief's true scale) -- one inside an
   array, and one as a CSG group's subtracted shape. AFTER GROUPS (isAfter: code that only works on what its children
   gave): a shell over a CSG group (the optics bench's lenses), a round over a twist, a round as a subtracted shape, a
   shell in an array's copies, a relief inside a round. Through every check a bundled scene gets. */
function beforesDoc() {
    const T = (x, y, z, rz = 0, s = 1, rx = 0) => ({ pos: { x, y, z }, rot: { x: rx, y: 0, z: rz }, scale: s })
    const d = M.createDoc()
    M.addMaterial(d, { id: 'w' })
    const rough = M.addMaterial(d, { id: 'rough' }); M.setRelief(d, rough.id, 'noise')
    M.addGroup(d, 'root', { id: 'tw', ...modifierGroup('twist'), transform: T(0, 0, 0.5, 20, 1.2, 10) })
    M.find(d, 'tw').node.params && (M.find(d, 'tw').node.params.rate = 0.7)
    M.addObject(d, 'tw', { id: 'tb', primitive: 'box', transform: T(0.4, 0, 0, 15) })
    const cut = M.addGroup(d, 'tw', { id: 'tcut', blend: 0.05, transform: T(0, 0, 1.2) })
    M.addObject(d, cut.id, { id: 'tcb', primitive: 'box' })
    M.addObject(d, cut.id, { id: 'tcs', primitive: 'sphere', join: 'subtract', params: { radius: 0.4 } })
    M.addGroup(d, 'tw', { id: 'bd', ...modifierGroup('bend'), transform: T(0, 0, -1.2, 0, 0.9) })
    M.addObject(d, 'bd', { id: 'bdb', primitive: 'box', params: { size: { x: 1.6, y: 0.3, z: 0.3 } } })
    M.addGroup(d, 'tw', { id: 'row', transform: T(0, 1.2, 0) })
    M.addObject(d, 'row', { id: 'rs', primitive: 'sphere', params: { radius: 0.2 } })
    M.setCopies(d, 'row', M.copiesRow(3, 0.6))
    M.addObject(d, 'tw', { id: 'rel', primitive: 'sphere', material: rough.id, transform: T(-1, 0, 0), params: { radius: 0.35 } })
    // a mirror in each copy of an array
    M.addGroup(d, 'root', { id: 'arr', transform: T(4, 0, 0) })
    M.addGroup(d, 'arr', { id: 'mir', ...modifierGroup('mirror'), transform: T(0, 0, 0, 30) })
    M.addObject(d, 'mir', { id: 'mb', primitive: 'box', transform: T(0.6, 0, 0, 25), params: { size: { x: 0.5, y: 0.3, z: 0.4 } } })
    M.setCopies(d, 'arr', [T(0, -1.5, 0), T(0, 1.5, 0, 40, 0.7)])
    // a repeat, alone at the top
    M.addGroup(d, 'root', { id: 'rep', ...modifierGroup('repeat'), transform: T(-4, 0, 0) })
    M.find(d, 'rep').node.params.count = { x: 1, y: 1, z: 0 }
    M.addObject(d, 'rep', { id: 'rpb', primitive: 'sphere', params: { radius: 0.5 } })
    // a CSG group cutting with a mirrored pair
    const c2 = M.addGroup(d, 'root', { id: 'cut2', blend: 0, transform: T(0, -4, 0) })
    M.addObject(d, c2.id, { id: 'c2b', primitive: 'box', params: { size: { x: 2, y: 1, z: 1 } } })
    M.addGroup(d, c2.id, { id: 'm2', ...modifierGroup('mirror'), join: 'subtract' })
    M.addObject(d, 'm2', { id: 'm2s', primitive: 'sphere', transform: T(0.7, 0, 0.4), params: { radius: 0.35 } })
    // after groups
    M.addGroup(d, 'root', { id: 'sh', ...modifierGroup('shell'), transform: T(0, 0, 4, 35, 0.9) })
    M.find(d, 'sh').node.params.thickness = 0.08
    const lens = M.addGroup(d, 'sh', { id: 'lens', blend: 0.1 })
    M.addObject(d, lens.id, { id: 'lc', primitive: 'cylinder' })
    M.addObject(d, lens.id, { id: 'ls', primitive: 'sphere', join: 'subtract', transform: T(0, 0, 0.6), params: { radius: 0.6 } })
    M.addGroup(d, 'root', { id: 'rd', ...modifierGroup('round'), transform: T(4, 4, 0) })
    M.addGroup(d, 'rd', { id: 'rdtw', ...modifierGroup('twist') })
    M.addObject(d, 'rdtw', { id: 'rdb', primitive: 'box', params: { size: { x: 0.4, y: 0.4, z: 1.5 } } })
    M.addObject(d, 'rd', { id: 'rdrel', primitive: 'sphere', material: rough.id, transform: T(1, 0, 0), params: { radius: 0.3 } })
    const c3 = M.addGroup(d, 'root', { id: 'cut3', blend: 0.05, transform: T(-4, 4, 0) })
    M.addObject(d, c3.id, { id: 'c3b', primitive: 'box' })
    M.addGroup(d, c3.id, { id: 'c3r', ...modifierGroup('round'), join: 'subtract' })
    M.addObject(d, 'c3r', { id: 'c3s', primitive: 'box', transform: T(0.5, 0.5, 0.5), params: { size: { x: 0.4, y: 0.4, z: 0.4 } } })
    M.addGroup(d, 'arr', { id: 'ash', ...modifierGroup('shell'), transform: T(0, 0, 1.2) })
    M.addObject(d, 'ash', { id: 'ashs', primitive: 'sphere', params: { radius: 0.3 } })
    // a relief after them all: the warps' XF_K put back (keepK), or its bumps would be the twist's size
    M.addObject(d, 'root', { id: 'rel2', primitive: 'sphere', material: rough.id, transform: T(0, 4, 0), params: { radius: 0.6 } })
    M.addObject(d, 'root', { id: 'floor', primitive: 'box', transform: T(0, 0, -3), params: { size: { x: 12, y: 12, z: 0.2 }, rounding: 0 } })
    return d
}
/* ...THE SAME WITH A MATERIAL THAT READS p_local (0.22.0): the local point tracked at every fold, and these groups data
   there too, codegen's children functions setting it as the records do -- a child with no transform of its own under a
   warp (the repeat's sphere, the bend's box, the box twisted in the round), a shell's and a round's children a Hit of
   their own, folded after other surfaces (sh and rd at the top level) */
function localDoc() {
    const d = beforesDoc()
    const m = M.addMaterial(d, { id: 'grain', code: 'm.baseColor = m.baseColor * (0.5 + 0.5 * fract(p_local.x));' })
    for (const id of ['rpb', 'bdb', 'rdb', 'ashs', 'lc', 'tb']) M.setMaterial(d, id, m.id)
    return d
}
const dir = new URL('../../scenes/', import.meta.url)
const given = process.argv.slice(2)
// a file named on the command line is an example's; with none, every example and every fixture scene (test/scenes.mjs)
const docs = given.length ? given.map(file => [file, M.parse(readFileSync(new URL(file, dir), 'utf8'))])
    : EVERY_SCENE.map(s => [s.name, M.parse(readFileSync(s.url, 'utf8'))])
if (!given.length) docs.push(['group code as data (made here)', beforesDoc()], ['...its materials reading p_local (made here)', localDoc()])
for (const [file, doc] of docs) {
    const tree = () => M.toTree(doc, { keepDisabled: true })
    const C = generate(tree(), { id: 'built', liveVisibility: true })
    const D = generate(tree(), { id: 'built', liveVisibility: true, data: true })
    const box = estimateBox(M.toTree(doc)) || { lo: [-1, -1, -1], hi: [1, 1, 1] }
    const size = Math.max(...[0, 1, 2].map(k => box.hi[k] - box.lo[k]), 1e-3)

    // ---- the field and the pick capture near every surface
    const S = await onSurfaces(C, scatter(box, 1.2), size)
    const a = await field(C, S.pts, S.dirs), b = await field(D, S.pts, S.dirs)
    let dWorst = 0, mat = 0, med = 0, nor = 0
    for (let i = 0; i < N; i++) {
        const o = 8 * i
        if (Math.abs(a[o + 3]) > 1e6) continue
        dWorst = Math.max(dWorst, relDiff(a[o + 3], b[o + 3]))
        if (a[o + 4] !== b[o + 4]) mat++
        if (a[o + 5] !== b[o + 5]) med++
        if (normalDiffers(a, b, o)) nor++
    }
    ok(`${file}: the field near its surfaces is codegen's (distance to f32 rounding, material, medium, normal)`,
        dWorst < 1e-4 && mat === 0 && med === 0 && nor === 0, `rel distance ${dWorst.toExponential(2)}, material ${mat}, medium ${med}, normal ${nor} differ of ${N}`)
    const ca = await capture(C, S.pts, S.dirs), cb = await capture(D, S.pts, S.dirs)
    let tag = 0, loc = 0, sc = 0, ex = null
    for (let i = 0; i < N; i++) {
        const o = 8 * i, ida = ca[o] ? C.tags[ca[o] - 1] : null, idb = cb[o] ? D.tags[cb[o] - 1] : null
        if (ida !== idb) { tag++; ex ??= `${ida} vs ${idb}` }
        if (Math.hypot(ca[o + 2] - cb[o + 2], ca[o + 3] - cb[o + 3], ca[o + 4] - cb[o + 4]) > 1e-4 * Math.max(1, Math.hypot(ca[o + 2], ca[o + 3], ca[o + 4]))) loc++
        if (relDiff(ca[o + 5], cb[o + 5]) > 1e-5) sc++
    }
    ok(`${file}: the pick names the same node, with the same local point and scale`, tag === 0 && loc === 0 && sc === 0,
        `node ${tag}${ex ? ` (${ex})` : ''}, local point ${loc}, scale ${sc} differ of ${N}`)

    /* ---- culling: the same boxes on the top level both ways -- the same field everywhere. Not on a compiled subtree
       that is turned: its record is in its parent's frame, so data culls it by the box around its turned box
       (scenedata.js setBox), a different bound from codegen's, both lower bounds (the last case below shows its) */
    const plan = planOf(tree(), { reliefMaterials: new Set((doc.materials || []).filter(m => m.relief).map(m => m.id)) })
    const turned = n => plan.sub.has(n.id) && n.transform && ['x', 'y', 'z'].some(k => (n.transform.rot?.[k] ?? 0) % 360 !== 0)
    const boxes = new Map()
    for (const n of tree().children || []) {
        if (turned(n) || (n.kind === 'object' && n.type !== 'code')) continue        // a light's or an export box's: none
        const e = estimateBox({ kind: 'group', children: [{ ...n, transform: null }] })
        if (e) boxes.set(n.id, { lo: e.lo.map(v => v * 1.5 - 0.5), hi: e.hi.map(v => v * 1.5 + 0.5) })
    }
    const Dc = generate(tree(), { id: 'built', liveVisibility: true, data: true })
    const records = D.dataOf(tree(), boxes)
    Dc.data = records.data
    /* every box codegen can test ('all', the bench's): the builder's own tests the dear nodes alone since 0.34.0 (codegen.js
       ONLY THE DEAR ONES), and the records every node they have a box for */
    const Cc = generate(tree(), { id: 'built', liveVisibility: true, cull: 'all' })
    Cc.uniforms = structuredClone(Cc.uniforms)
    let given = 0
    for (const [id, b] of boxes) {
        if (!(`bxlo_${id}` in Cc.uniforms)) continue
        Cc.uniforms[`bxlo_${id}`].def = [...b.lo, 1]; Cc.uniforms[`bxhi_${id}`].def = [...b.hi, 0]; given++
    }
    const far = scatter(box, 3)
    const fa = await field(Cc, far.pts, far.dirs), fb = await field(Dc, far.pts, far.dirs)
    let cullDiff = 0, cw = 0
    for (let i = 0; i < N; i++) { const o = 8 * i; if (Math.abs(fa[o + 3]) > 1e6) continue; const r = relDiff(fa[o + 3], fb[o + 3]); if (r > 1e-4) { cullDiff++; cw = Math.max(cw, r) } }
    ok(`${file}: culled by the same boxes, the same field as codegen's`, cullDiff === 0, `${cullDiff} of ${N} differ (worst rel ${cw.toExponential(2)}), ${given} boxes`)
}

// ---- a compiled subtree, turned, moved and scaled under a plain group, culled by its own box
{
    const d = M.createDoc()
    const g = M.addGroup(d, 'root', { id: 'holder', transform: { pos: { x: 2, y: -1, z: 0.5 }, rot: { x: 0, y: 0, z: 30 }, scale: 1.5 } })
    // code that names C before its call: never a before group (codegen isBefore), always a compiled subtree
    const sub = M.addGroup(d, g.id, { id: 'coded', code: 'let before = C.s.w;\nC = children(C, p);',
                                      transform: { pos: { x: 3, y: 0, z: 1 }, rot: { x: 40, y: -25, z: 70 }, scale: 0.8 } })
    M.addObject(d, sub.id, { id: 'thing', primitive: 'box' })
    M.addObject(d, 'root', { id: 'other', primitive: 'sphere' })
    const tree = () => M.toTree(d, { keepDisabled: true })
    const D = generate(tree(), { id: 'built', liveVisibility: true, data: true })
    const e = estimateBox({ kind: 'group', children: [{ ...M.find(d, 'thing').node, transform: null }] })
    // its own frame's box, a little padded: the box's own extent, measured by the estimate
    const own = { lo: e.lo.map(v => v * 1.2 - 0.05), hi: e.hi.map(v => v * 1.2 + 0.05) }
    const Dc = generate(tree(), { id: 'built', liveVisibility: true, data: true })
    Dc.data = D.dataOf(tree(), new Map([['coded', own]])).data
    const world = estimateBox(M.toTree(d))
    const far = scatter(world, 4)
    const u = await field(D, far.pts, far.dirs), c = await field(Dc, far.pts, far.dirs)
    let above = 0, below = 0
    for (let i = 0; i < N; i++) { const o = 8 * i, du = Math.abs(u[o + 3]), dc = Math.abs(c[o + 3]); if (dc > du * (1 + 1e-5) + 1e-6) above++; if (dc < du * (1 - 1e-4)) below++ }
    ok('a turned compiled subtree culled by its box: the field never above the unculled one', above === 0 && below > 0, `${above} above, ${below} culled below, of ${N}`)
    const S = await onSurfaces(D, scatter(world, 1.2), 4)
    const su = await field(D, S.pts, S.dirs), sc = await field(Dc, S.pts, S.dirs)
    let differ = 0
    for (let i = 0; i < N; i++) { const o = 8 * i; if (Math.abs(su[o + 3]) < 1e-3 && (su[o + 3] !== sc[o + 3] || su[o + 4] !== sc[o + 4])) differ++ }
    ok('...and the same at its surfaces', differ === 0, `${differ} differ`)
}

// ---- AN ARRAY (model.js copies) against the same copies written out as groups: the same field and the same picks, in
// codegen and as data -- turned and scaled copies, a CSG group inside them, and an array inside an array
{
    const T = (x, y, z, rz = 0, s = 1, rx = 0) => ({ pos: { x, y, z }, rot: { x: rx, y: 0, z: rz }, scale: s })
    const copies = [T(-2, 0, 0), T(0, 1, 0.3, 30, 0.8), T(2.2, -0.5, 0, -45, 1.3, 20)]
    const inner = [T(0, 0, 0), T(0, 0, 1.6, 90, 0.5)]
    const fill = (d, parent, tag) => {
        M.addObject(d, parent, { id: `bx${tag}`, primitive: 'box', transform: T(0.3, 0, 0, 10) })
        const g = M.addGroup(d, parent, { id: `cut${tag}`, blend: 0.05, transform: T(0, 0, 0.8) })
        M.addObject(d, g.id, { id: `cb${tag}`, primitive: 'box' })
        M.addObject(d, g.id, { id: `cs${tag}`, primitive: 'sphere', join: 'subtract', params: { radius: 0.4 } })
    }
    const make = written => {
        const d = M.createDoc(); M.addMaterial(d, { id: 'w' })
        M.addGroup(d, 'root', { id: 'arr', transform: T(0.5, 0.2, 0, 15, 1.1) })
        if (!written) {
            fill(d, 'arr', '')
            M.addGroup(d, 'arr', { id: 'nest', transform: T(0, -1.5, 0) })
            M.addObject(d, 'nest', { id: 'nb', primitive: 'sphere', params: { radius: 0.3 } })
            M.setCopies(d, 'nest', inner)
            M.setCopies(d, 'arr', copies)
        } else copies.forEach((c, i) => {
            M.addGroup(d, 'arr', { id: `k${i}`, transform: c }); fill(d, `k${i}`, `x${i}`)
            M.addGroup(d, `k${i}`, { id: `nest${i}`, transform: T(0, -1.5, 0) })
            inner.forEach((c2, j) => { M.addGroup(d, `nest${i}`, { id: `m${i}x${j}`, transform: c2 }); M.addObject(d, `m${i}x${j}`, { id: `nb${i}x${j}`, primitive: 'sphere', params: { radius: 0.3 } }) })
        })
        M.addObject(d, 'root', { id: 'floor', primitive: 'box', transform: T(0, 0, -3), params: { size: { x: 5, y: 5, z: 0.2 }, rounding: 0 } })
        return d
    }
    const A = make(false), W = make(true)
    const tree = d => M.toTree(d, { keepDisabled: true })
    const CA = generate(tree(A), { id: 'built', liveVisibility: true }), DA = generate(tree(A), { id: 'built', liveVisibility: true, data: true })
    const CW = generate(tree(W), { id: 'built', liveVisibility: true })
    const S = await onSurfaces(CW, scatter({ lo: [-4.5, -3.5, -2.5], hi: [4.5, 3.5, 2.5] }, 1), 9)
    const w = await field(CW, S.pts, S.dirs), a = await field(CA, S.pts, S.dirs), dd = await field(DA, S.pts, S.dirs)
    const differ = (u, v) => { let n = 0; for (let i = 0; i < N; i++) { const o = 8 * i; if (relDiff(u[o + 3], v[o + 3]) > 1e-5 || u[o + 4] !== v[o + 4] || normalDiffers(u, v, o)) n++ } return n }
    ok('an array (copies, a CSG group in them, an array in it), codegen: the field of its copies written out', differ(w, a) === 0, `${differ(w, a)} of ${N} differ`)
    ok('...and as data', differ(w, dd) === 0, `${differ(w, dd)} of ${N} differ`)
    const ca = await capture(CA, S.pts, S.dirs), cd = await capture(DA, S.pts, S.dirs)
    let tag = 0
    for (let i = 0; i < N; i++) { const o = 8 * i; if ((ca[o] ? CA.tags[ca[o] - 1] : null) !== (cd[o] ? DA.tags[cd[o] - 1] : null)) tag++ }
    ok('...the pick names the same node in every copy, both ways', tag === 0, `${tag} differ`)
}

console.log(`scene data on a GPU: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
