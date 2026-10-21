//======================================================================================================================
// SCENE DATA -- the scene as a table that one fixed evaluator walks, instead of a function per scene (PERFORMANCE.md
// P3, "The scene as data"; the user's design: blocks, which are code, and components, which are data).
//
// WHY. A builder scene was one WGSL function with a block of code per node, so every structural edit -- a node added,
// deleted, moved to another group, given another material -- was a different shader: a compile of every kernel that
// inlines the scene, seconds each (PERFORMANCE.md). Here the SHAPE of the scene is data: a node is a RECORD in a storage
// buffer (its frame, its material, its parameters, its box, where its subtree ends), and the shader holds only what
// cannot be data -- one function per distinct piece of code (a BLOCK), the loop that walks the records, and whatever the
// evaluator does not handle yet, compiled as before. An edit that adds no new code writes the buffer: the kernels'
// text is the same, so nothing compiles (builder/demo.js compares it).
//
// THE DOCUMENT'S BLOCKS AND THESE (model.js version 16): a document keeps its code in blocks, each node naming one; toTree
// gives every node its block's code again, so what is planned here is the tree's. A block here is one function -- a
// document block's code with its parameters' kinds and its constants' VALUES, which are text -- so a document block
// whose users hold two values of a constant is two of these. Its users with one value are one function, however many.
//
// WHAT IS DATA, and what is not yet (`planOf` decides, top down; codegen.js emits):
//   an object of any code     a record calling its block: the node's code, emitted ONCE for every node with the same
//                             code, parameter names and constants, its parameters read from the record's slots
//   a light's face            a record (its shape, its material id, its sides)
//   a plain group             a record that only says where its subtree ends (for visibility and culling): frames are
//                             composed here, on the CPU, so a child's record carries its whole frame to the world
//   a CSG group               a record that opens a private Hit, a JOIN record after each of its shapes (its op and its
//                             blend), and an END record that folds the combined shape in -- codegen children(), as data.
//                             A plain group that is one of its shapes too (codegen combinedGroups, 0.72.1): its children
//                             a union, every JOIN a union at its blend -- folded, they were no union's signed distance
//   an array                  a record, its children's records in a copy's frame, an ARRAY_END that goes back for the next;
//                             as one of a CSG group's shapes, inside a CSG record and its END, a JOIN after each shape of
//                             every copy: the copies one union
//   a before group            group code that only moves the point its children see (codegen isBefore: a twist, a bend, a
//                             repeat, a mirror): a BEFORE record that calls its code -- a function per distinct code, as an
//                             object's -- its children's records in the frame it leaves, and a BEFORE_END
//   an after group            group code that only works on what its children gave (codegen isAfter: a round, a shell): an
//                             AFTER record that opens a Hit of their own, as a CSG group does, their records, and an
//                             AFTER_END that calls its code with that Hit
//   COMPILED, AS BEFORE       any other group with code (a relief, a displace -- they read the CSG chain above them --,
//                             or anything that calls its children twice or reads what they gave first: the evaluator
//                             cannot be called from code it calls -- WGSL has no recursion), a before or an after group
//                             whose own children join (a CSG group with code: its children function combines them),
//                             an object wearing a material's relief, and a CSG group with either anywhere below it (their
//                             rules read the group's blend: SURFACE_ONLY, READ_REACH, the deferred slope XF_RL). Each such
//                             SUBTREE is a function the evaluator calls (a SUB record), emitted by codegen exactly as it was.
//
// THE RECORDS: REC vec4s each, in depth-first order, after a HEADER (scene.data, Float32Array; u32 values carried as
// their bit patterns, read back with bitcast):
//   v0  kind, block (or subtree, or light shape), material, flags
//   v1  next (the record after this one's subtree: a skip), parameter offset (vec4s), tag (pick), S (the frame's scale)
//   v2  M[0], t.x       the frame, world -> this node: p_local = M^T (p - t) / S, the transforms above it and its own
//   v3  M[1], t.y       composed (lightFace's composition, codegen emitLightFaces); XF_M = M, XF_S = S for add_new
//   v4  M[2], t.z
//   v5  box lo (its own frame), 1 when known     -- culling; cullDist, scene_api.js
//   v6  box hi
// A JOIN is one record (v0: op; v1.w: its blend); an END, an ARRAY_END, a BEFORE_END or an AFTER_END is one record (v1.x:
// the record it closes). An ARRAY's v0.y is its number of copies; a BEFORE's or an AFTER's its code's function, its
// parameters a slot each. After the
// records, the PARAMETERS (one vec4 a parameter, in the node's own order) and the LIGHT TABLE (4 vec4 a face: centre and
// flags, u and half width, v and half height, n and whether it is shown -- lightFace, codegen emitLightFacesData).
//
// THE HEADER, one vec4: where the records end, where the light table starts, how many lights, 0.
//======================================================================================================================

import { hasCode, isBefore, isAfter, isCsg, combinedGroups, shapesOf, joinOf, isCompiledIn, isProfile, isPath, NODE_TYPES } from './codegen.js'
import { hasFace } from './lights.js'
import { matrixOf } from './transform.js'

export const HEADER = 1
export const REC = 7
export const KIND = { OBJECT: 1, GROUP: 2, CSG: 3, JOIN: 4, END: 5, SUB: 6, LIGHT: 7, ARRAY: 8, ARRAY_END: 9, BEFORE: 10, BEFORE_END: 11, AFTER: 12, AFTER_END: 13 }
/** vec4s a copy of an array takes among the parameters: its rotation's columns with its translation, then its scale */
export const COPY_VEC4S = 4
export const FLAG = { VISIBLE: 1, CULLABLE: 2, LIMITER: 4, TWO_SIDED: 8, TRANSPARENT: 16 }
export const OPS = { union: 0, subtract: 1, intersect: 2 }
/** vec4s a light takes in the light table */
export const LIGHT_VEC4S = 4
/** The CSG nesting the evaluator makes room for: none without CSG, else rounded up to a multiple of 4, so the shader's
 *  text moves only when a scene crosses 4 or 8 (call 3, PERFORMANCE.md: at most 8). */
export const STACK_MAX = 8
export const stackFor = depth => depth <= 0 ? 0 : depth <= 4 ? 4 : 8

/* RECORDS_IN_UNIFORM (0.22.19, the test of what a record costs): the header and the records, copied into a uniform buffer
   of their own (scnRecs) that the walk reads them from (scnRec, the evaluator) -- every ray walks the same records in
   step. (Until 0.41.0 the candidate grid and exact hits, where neighbouring rays walked different records, read them from
   the scene's buffer.) Everything else stays in the scene's buffer.
   WHY. Counted on a software GPU against the user's overhead run of 0.22.16 (Pascal; roadmap/ARCHITECTURE.md, Before step
   5): as data, 93 to 124 ps of the first march pass a record walked, whatever the record; as codegen 96 to 117 ps a step,
   its values uniforms. Inferred, not measured: a record's cost is its reads from the storage buffer, each waiting for the
   last (where the next record is, is in this one). A uniform buffer is read through the path GPUs keep for a value every
   thread reads alike, as here. Tests > overhead says whether that was it.
   THE ROOM: 4096 vec4s, 64 KiB, the size every WebGPU device allows a uniform binding (Direct3D 12's limit too) -- the
   header and 585 records. A record past them is read from the scene's buffer, where it also is: ONE TEXT WHATEVER THE
   SIZE. A first draft made a scene with more records another text; the scaling bench's lens assemblies, copies as nodes of
   their own, have 612 at 16 copies and 1220 at 32, and every count is the one text of 1 there (bench/scaling.js). */
export const RECS_UNIFORM_VEC4S = 4096
export const RECS_UNIFORM_TYPE = `uniform array<vec4<f32>, ${RECS_UNIFORM_VEC4S}>`

/** The parameter slot's WGSL read, for a parameter of this value (one vec4 a parameter) at index expression `at`. A
 *  profile or a path is its handle: which of the scene's outlines or routes it is (codegen aliasPrelude), a u32 carried
 *  as an f32. A boolean is 0 or 1 (codegen: a u32 uniform). */
export function slotRead(v, at) {
    if (isCompiledIn(v) || typeof v === 'boolean') return `u32(sceneData[${at}].x)`
    if (typeof v === 'number') return `sceneData[${at}].x`
    const n = componentsOf(v).length
    return n === 2 ? `sceneData[${at}].xy` : n === 3 ? `sceneData[${at}].xyz` : n === 4 ? `sceneData[${at}]` : `sceneData[${at}].x`
}
/* A value's numbers in the order the uniform would have them (codegen SHAPES: x y z w, r g b a) */
const ORDERS = [['x', 'y', 'z', 'w'], ['r', 'g', 'b', 'a']]
export function componentsOf(v) {
    if (typeof v === 'number') return [v]
    if (typeof v === 'boolean') return [v ? 1 : 0]
    if (Array.isArray(v)) return v.map(Number)
    if (v && typeof v === 'object') {
        const order = ORDERS.find(o => o[0] in v) || []
        return order.filter(k => k in v).map(k => Number(v[k]))
    }
    return [0]
}

/** An object's BLOCK: what makes two nodes share one function -- the code, its parameters' names and kinds, and the
 *  constants with their values (a constant is in the text). Values are not in it: they are data. */
export function blockKey(node) {
    const params = node.params || {}, constants = node.constants || {}
    const schema = Object.keys(params).map(k => {
        const v = params[k]
        if (constants[k] && !isCompiledIn(v)) return [k, 'const', constants[k], v]
        return [k, isCompiledIn(v) ? 'handle' : typeof v === 'boolean' ? 'bool' : componentsOf(v).length]
    })
    return JSON.stringify([node.code ?? '', schema])
}

const each = (n, fn, up = []) => { fn(n, up); for (const c of n.children || []) each(c, fn, [...up, n]) }

/* GROUP CODE THAT IS DATA: a before group (codegen isBefore: a twist, a bend, a repeat, a mirror) or an after group
   (isAfter: a round, a shell) -- a record, its code a function the evaluator calls, its children records. In a scene
   whose materials read p_local too, since 0.22.0: until then codegen gave a child with no transform of its own under a
   warp the point from before the warp, and counted no private Hit for an after group's children (XF_SUB), neither of
   which the records -- each setting its own local point, a level for each Hit -- reproduce; so such a scene compiled
   every one of these as before, and every copy of the optics bench's lens assembly was code of its own (its shell:
   roadmap/ARCHITECTURE.md step 4). Codegen now does what the records do (its children functions). A straightMaterial
   mark matters where a material has a relief or reads p_local (codegen `straight`): such a group stays compiled. */
const native = (n, wantLocal, reliefMaterials) => {
    const straight = reliefMaterials.size > 0 || wantLocal
    return isBefore(n, { straight }) || isAfter(n, { straight })
}
/* ...and which of the two, for a group with code that is not compiled (the mark aside, as native() decided it) */
const afterKind = n => isAfter(n, { straight: false })
/* WHAT IS COMPILED AS BEFORE in a tree: a group with code (but a before or after group, which is data), an object wearing a
   material's relief, and a CSG group with either anywhere below it -- the predicate, for planOf and for recordsOf (which
   checks a tree against a plan) */
function compiledOf(tree, reliefMaterials, wantLocal = false) {
    const reliefObject = n => n.kind === 'object' && reliefMaterials.has(n.material) && NODE_TYPES[n.type] && n.type !== 'light' && n.type !== 'export' && n.type !== 'haze'
    /* A BEFORE OR AN AFTER GROUP WHOSE OWN CHILDREN JOIN (isCsg: a subtraction, an intersection, a blend among them) is
       compiled: codegen's children function combines them, and the records of a BEFORE or an AFTER fold its children's in
       one by one -- until 0.72.1 a mirror of a box less a sphere was the box and the sphere as data. */
    const coded = n => hasCode(n) && (!native(n, wantLocal, reliefMaterials) || isCsg(n))
    const combined = combinedGroups(tree)
    const special = new Set()          // groups with code or a relief object somewhere below
    const mark = n => {
        let any = false
        for (const c of n.children || []) if (mark(c) || coded(c) || reliefObject(c)) any = true
        if (any) special.add(n.id)
        return any
    }
    mark(tree)
    return n => n !== tree && (coded(n) || reliefObject(n) || (n.kind === 'group' && combined.has(n.id) && special.has(n.id)))
}
/* every node's id in depth-first order, a compiled subtree's nodes together after its root: tag n is tags[n - 1] */
function tagsOf(tree, compiled) {
    const tags = []
    const walk = n => {
        if (n !== tree) tags.push(n.id)
        if (n !== tree && compiled(n)) { each(n, x => { if (x !== n) tags.push(x.id) }); return }
        for (const c of n.children || []) walk(c)
    }
    walk(tree)
    return tags
}
/* the faces light sampling sees, as codegen collectLights finds them: not under group code (there a light is not drawn) */
function lightsOf(tree) {
    const lights = []
    const find = (n, warped) => {
        if (n.kind === 'object' && n.type === 'light' && hasFace(n.light) && !warped) lights.push(n)
        const w = warped || (n !== tree && hasCode(n))
        for (const c of n.children || []) find(c, w)
    }
    find(tree, false)
    return lights
}
/* the handles of profiles and paths, as codegen numbers them (collectProfiles, collectPaths): each kind from 0, in tree
   order -- a node's parameter slot holds its handle, the outline's function is in the text */
function handlesOf(tree) {
    const list = []
    let profiles = 0, paths = 0
    each(tree, n => {
        if (n.kind !== 'object') return
        for (const [k, v] of Object.entries(n.params || {})) {
            if (isProfile(v)) list.push([`${n.id}.${k}`, profiles++])
            else if (isPath(v)) list.push([`${n.id}.${k}`, paths++])
        }
    })
    return list
}
/* the deepest nesting of arrays (model.js copies) and before groups that are data: each a level of the evaluator's stack
   of base frames */
function arrayDepthOf(tree, compiled) {
    let depth = 0
    const walk = (n, d) => {
        if (n !== tree && compiled(n)) return
        const inner = n !== tree && n.kind === 'group' && (n.copies?.length || (hasCode(n) && !afterKind(n))) ? d + 1 : d
        depth = Math.max(depth, inner)
        for (const c of n.children || []) walk(c, inner)
    }
    walk(tree, 0)
    return depth
}
/* the deepest nesting of data CSG groups (codegen combinedGroups: a plain group that is a shape too) and after groups:
   each a Hit of its own on the evaluator's stack */
function depthOf(tree, compiled) {
    let depth = 0
    const combined = combinedGroups(tree)
    const walk = (n, d) => {
        if (n !== tree && compiled(n)) return
        const inner = n !== tree && n.kind === 'group' && (combined.has(n.id) || (hasCode(n) && afterKind(n))) ? d + 1 : d
        depth = Math.max(depth, inner)
        for (const c of n.children || []) walk(c, inner)
    }
    walk(tree, 0)
    return depth
}

/**
 * WHAT IS DATA AND WHAT IS COMPILED, for a tree (model.toTree with keepDisabled: visibility is data).
 * `reliefMaterials`: the ids of materials with a relief; `wantLocal`: whether a material reads p_local (codegen
 * readsLocal); `carry`: the blocks of the scene shown (scene.blocks), kept in the text whether or not this tree still
 * uses them. Returns the plan both the emission (codegen) and the records (recordsOf) follow -- the part of a scene that
 * is text:
 *   sub      Map(node id -> subtree index): the roots of what is compiled as before; subs those nodes, by id
 *   blocks   [{ key, node }] in the order of their keys -- a frozen copy of the first node with that key, enough to
 *            emit it -- and blockIndex: Map(key -> index)
 *   befores  the same for the before groups' codes (bef_<k>), and beforeIndex; afters and afterIndex the after groups'
 *   lights   the light faces, in the order codegen numbers their materials (collectLights)
 *   handles  the profiles' and paths' handles; stack, the CSG nesting the evaluator has room for
 * The order of everything in it is the keys' or the ids', never where a node is in the tree, so moving a node changes
 * no text -- except the lights' and the handles', which are codegen's own numbering (a light is a material; a profile
 * a function).
 */
export function planOf(tree, { reliefMaterials = new Set(), wantLocal = false, carry = [] } = {}) {
    const compiled = compiledOf(tree, reliefMaterials, wantLocal)
    const subs = [], keys = new Map(), bkeys = new Map(), akeys = new Map()
    const walk = n => {
        if (n !== tree && compiled(n)) { subs.push(n); return }
        if (n.kind === 'object' && n.type === 'code') {
            const k = blockKey(n)
            if (!keys.has(k)) keys.set(k, structuredClone({ id: n.id, kind: n.kind, type: n.type, code: n.code, params: n.params, constants: n.constants }))
        }
        // a before or after group's code, as an object's: by its code, its parameters' kinds and its constants' values
        if (n !== tree && n.kind === 'group' && hasCode(n)) {
            const k = blockKey(n), into = afterKind(n) ? akeys : bkeys
            if (!into.has(k)) into.set(k, structuredClone({ id: n.id, kind: n.kind, code: n.code, params: n.params, constants: n.constants }))
        }
        for (const c of n.children || []) walk(c)
    }
    walk(tree)
    /* THE BLOCKS OF THE SCENE SHOWN, CARRIED (call 2, PERFORMANCE.md P3): a block the scene no longer uses stays in the
       text, so deleting the last node with some code compiles nothing. And the ORDER IS THE KEYS', not the tree's:
       moving a node must not renumber the blocks (their functions, the switch). A before or after group's goes with
       them, among its own kind -- a group's node. */
    for (const B of carry) {
        if (B.node.kind !== 'group') { if (!keys.has(B.key)) keys.set(B.key, B.node); continue }
        const into = afterKind(B.node) ? akeys : bkeys
        if (!into.has(B.key)) into.set(B.key, B.node)
    }
    const byKey = m => [...m].map(([key, node]) => ({ key, node })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    const blocks = byKey(keys), befores = byKey(bkeys), afters = byKey(akeys)
    const indexOf = list => new Map(list.map((B, i) => [B.key, i]))
    const blockIndex = indexOf(blocks), beforeIndex = indexOf(befores), afterIndex = indexOf(afters)
    // the compiled subtrees by their roots' ids: their text is theirs alone, and moving one must not renumber the others
    subs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const sub = new Map(subs.map((n, i) => [n.id, i]))
    const depth = depthOf(tree, compiled), arrayDepth = arrayDepthOf(tree, compiled)
    return { reliefMaterials, wantLocal, sub, subs, blocks, blockIndex, befores, beforeIndex, afters, afterIndex, lights: lightsOf(tree), handles: handlesOf(tree),
             tags: tagsOf(tree, compiled), depth, stack: stackFor(depth), arrayDepth, arrays: stackFor(arrayDepth) }
}

/* frames: { M: [c0, c1, c2] columns (local -> world), t, S }; descending one transform T turns (M, S, t) into
   (M R_T, S s_T, t + M S t_T) -- codegen emitLightFaces, the inverse of a chain of xfPoint */
const IDENTITY = { M: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], S: 1 }
const mulMv = (M, v) => [0, 1, 2].map(i => M[0][i] * v[0] + M[1][i] * v[1] + M[2][i] * v[2])
function descend(F, transform) {
    if (!transform) return F
    const m = matrixOf(transform)
    const R = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]]      // columns of the rotation
    const pos = [m[12], m[13], m[14]], s = m[15]
    const step = mulMv(F.M, pos.map(v => v * F.S))
    return { M: R.map(col => mulMv(F.M, col)), t: F.t.map((v, i) => v + step[i]), S: F.S * s }
}

/**
 * THE RECORDS for a tree that follows `plan` (planOf of a tree with the same structure: the same nodes, kinds, codes
 * and constants -- only values may differ). Returns { data: Float32Array, lights: [face, ...] } or null when the tree
 * does not follow the plan (a node the plan has no block or subtree for: the scene needs new text).
 *   boxes   Map(top-level id -> { lo, hi }) in the node's own frame, padded (boxes.js cullBoxes): its culling box
 *   materialIndex(id) -> the material's id as getMaterial2 numbers it (codegen: 1 the default, the document's from 2)
 *   lightMaterial(i)  -> light i's material id (codegen: after the document's materials, MATID_BLACK and CLEAR)
 *   limiters          Set of material ids whose objects only the optics trace draws
 */
export function recordsOf(tree, plan, { boxes = null, materialIndex, lightMaterial, limiters = new Set() }) {
    const recs = [], params = [], hoisted = []
    let ok = true
    /* THE TREE MUST FOLLOW THE PLAN: whatever is text the same -- each compiled subtree there by its root, the lights
       and the outlines numbered as they were, no deeper CSG than the evaluator has room for. Anything else is null: the
       scene needs new text, and the caller compiles. Objects are matched by their block's KEY, so a node copied, added
       or deleted is data as long as its code is a block there. */
    const compiled = compiledOf(tree, plan.reliefMaterials, plan.wantLocal)
    const combined = combinedGroups(tree)
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
    const roots = []
    const findRoots = n => { if (n !== tree && compiled(n)) { roots.push(n.id); return } for (const c of n.children || []) findRoots(c) }
    findRoots(tree)
    if (!same(roots.slice().sort(), plan.subs.map(n => n.id))) return null
    if (!same(lightsOf(tree).map(L => L.id), plan.lights.map(L => L.id))) return null
    if (JSON.stringify(handlesOf(tree)) !== JSON.stringify(plan.handles)) return null
    if (stackFor(depthOf(tree, compiled)) !== plan.stack) return null
    if (stackFor(arrayDepthOf(tree, compiled)) !== (plan.arrays ?? 0)) return null
    const handles = new Map(plan.handles)
    const tags = tagsOf(tree, compiled)
    const tagOf = new Map(tags.map((id, i) => [id, i + 1]))
    const lightIndex = new Map(plan.lights.map((L, i) => [L.id, i]))
    const faces = plan.lights.map(() => null)
    const push = () => { const r = new Array(REC * 4).fill(0); recs.push(r); return r }
    const u = n => { const b = new Uint32Array(1); b[0] = n >>> 0; return new Float32Array(b.buffer)[0] }
    const frameInto = (r, F) => {
        r[8] = F.M[0][0]; r[9] = F.M[0][1]; r[10] = F.M[0][2]; r[11] = F.t[0]
        r[12] = F.M[1][0]; r[13] = F.M[1][1]; r[14] = F.M[1][2]; r[15] = F.t[1]
        r[16] = F.M[2][0]; r[17] = F.M[2][1]; r[18] = F.M[2][2]; r[19] = F.t[2]
        r[7] = F.S
    }
    const head = (r, kind, a, mat, flags) => { r[0] = u(kind); r[1] = u(a); r[2] = u(mat); r[3] = u(flags) }
    const paramsOf = n => {
        const P = n.params || {}, C = n.constants || {}, at = params.length
        for (const [k, v] of Object.entries(P)) {
            if (C[k] && !isCompiledIn(v)) continue
            const c = isCompiledIn(v) ? [handles.get(`${n.id}.${k}`) ?? 4294967295] : componentsOf(v)
            params.push([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0])
        }
        return at
    }
    /* A FACE IN THE LIGHT TABLE, wherever it is drawn: its frame is the same composition the records carry */
    const face = (n, F, shown) => {
        const i = lightIndex.get(n.id)
        if (i === undefined) return
        const P = n.params || {}, rect = n.light?.shape === 'rectangle'
        const half = rect ? [(P.width ?? 1) * 0.5 * F.S, (P.height ?? 1) * 0.5 * F.S] : [(P.radius ?? 0.5) * F.S, (P.radius ?? 0.5) * F.S]
        const flags = (rect ? 2 : 1) | (n.light?.twoSided ? 4 : 0)
        faces[i] = [[F.t[0], F.t[1], F.t[2], u(flags)], [...F.M[0], half[0]], [...F.M[1], half[1]], [...F.M[2], shown ? 1 : 0]]
    }
    const visible = n => n.enabled !== false
    const node = (n, F, shown, plainAbove, csgDepth) => {
        const here = descend(F, n.transform)
        const on = shown && visible(n)
        if (plan.sub.has(n.id)) {
            // compiled as before: called in its PARENT's frame (its own transform is applied inside, from its uniform)
            const r = push()
            head(r, KIND.SUB, plan.sub.get(n.id), 0, (visible(n) ? FLAG.VISIBLE : 0) | (plainAbove && csgDepth === 0 ? FLAG.CULLABLE : 0))
            frameInto(r, F)
            r[6] = u(tagOf.get(n.id) ?? 0)
            setBox(r, n, plainAbove && csgDepth === 0, n.transform)
            /* lights inside are drawn there, by the compiled code; their faces still go in the table, each at its own
               frame: the subtree's parent frame, then every transform from the subtree's root down to it */
            each(n, x => {
                if (x.kind !== 'object' || x.type !== 'light') return
                const path = pathTo(n, x)
                face(x, path.reduce((G, y) => descend(G, y.transform), F), shown && path.every(visible))
            })
            r[4] = u(recs.length)
            return
        }
        if (n.kind === 'object') {
            if (n.type === 'export' || n.type === 'haze') return      // boxes, not shapes: the haze is the renderer's (scene.haze)
            if (n.type === 'light') {
                if (!hasFace(n.light) || !lightIndex.has(n.id)) return
                face(n, here, on)
                // inside a CSG group a light is drawn after the outermost one's combine (codegen collectLights)
                if (csgDepth > 0) { hoisted.at(-1).push({ n, here, on }); return }
                lightRecord(n, here, plainAbove)
                return
            }
            const block = plan.blockIndex.get(blockKey(n))
            if (block === undefined) { ok = false; return }
            const r = push()
            let flags = (visible(n) ? FLAG.VISIBLE : 0) | (plainAbove && csgDepth === 0 ? FLAG.CULLABLE : 0)
            if (limiters.has(n.material)) flags |= FLAG.LIMITER
            head(r, KIND.OBJECT, block, materialIndex(n.material), flags)
            frameInto(r, here)
            r[5] = u(paramsOf(n)); r[6] = u(tagOf.get(n.id) ?? 0)
            setBox(r, n, plainAbove && csgDepth === 0)
            r[4] = u(recs.length)
            return
        }
        /* AN AFTER GROUP (codegen isAfter): a record that opens a Hit of its own, as a CSG group's does; its children's
           records fold into it, in its frame as under a plain group; and an AFTER_END that calls its code with that Hit
           and the one it folds into. Its children are culled with it as well: its code changes their distances. */
        if (n.kind === 'group' && hasCode(n) && afterKind(n)) {
            const block = plan.afterIndex?.get(blockKey(n))
            if (block === undefined) { ok = false; return }
            const r = push()
            head(r, KIND.AFTER, block, 0, (visible(n) ? FLAG.VISIBLE : 0) | (plainAbove && csgDepth === 0 ? FLAG.CULLABLE : 0))
            frameInto(r, here)
            r[5] = u(paramsOf(n)); r[6] = u(tagOf.get(n.id) ?? 0)
            setBox(r, n, plainAbove && csgDepth === 0)
            for (const c of n.children || []) node(c, here, on, false, csgDepth + 1)
            const e = push()
            head(e, KIND.AFTER_END, 0, 0, FLAG.VISIBLE)
            e[4] = u(recs.indexOf(r))
            r[4] = u(recs.length)
            return
        }
        /* A BEFORE GROUP (codegen isBefore; compiled ones are subtrees, above): its record in its own frame, where the
           evaluator calls its code (bef_<k>) with its parameters from the slots; its children's records in the frame the
           code leaves -- the point it moved, XF_M and XF_S as warp() left them -- as an array's are in a copy's; and a
           BEFORE_END that puts the frame back. Its children are culled with it, never alone: the code can move them
           anywhere, so their own boxes say nothing of where they are (codegen culls only at the top level as well). */
        if (n.kind === 'group' && hasCode(n)) {
            const block = plan.beforeIndex?.get(blockKey(n))
            if (block === undefined) { ok = false; return }
            const r = push()
            head(r, KIND.BEFORE, block, 0, (visible(n) ? FLAG.VISIBLE : 0) | (plainAbove && csgDepth === 0 ? FLAG.CULLABLE : 0))
            frameInto(r, here)
            r[5] = u(paramsOf(n)); r[6] = u(tagOf.get(n.id) ?? 0)
            setBox(r, n, plainAbove && csgDepth === 0)
            for (const c of n.children || []) node(c, IDENTITY, on, false, csgDepth)
            const e = push()
            head(e, KIND.BEFORE_END, 0, 0, FLAG.VISIBLE)
            e[4] = u(recs.indexOf(r))
            r[4] = u(recs.length)
            return
        }
        // AN ARRAY (model.js copies): its record, its children's records in the frame of a copy -- walked once a copy by
        // the evaluator -- and an ARRAY_END that goes back for the next. Its copies among the parameters.
        if (n.kind === 'group' && n.copies?.length) {
            /* ...ONE OF A CSG GROUP'S SHAPES (codegen combinedGroups, group()): its copies one combine -- a CSG record
               around the array and its END after the ARRAY_END, folding the union in, in the array's frame; a JOIN after
               each shape of every copy, the base's a union at the group's blend (at every copy after the first it is
               taken: the copies a union). Not a CSG group with copies, which the model refuses (copiesProblems): its
               copies are walked as they were. */
            const together = combined.has(n.id) && !isCsg(n)
            let g = null
            if (together) {
                if (csgDepth === 0) hoisted.push([])
                g = push()
                head(g, KIND.CSG, 0, 0, visible(n) ? FLAG.VISIBLE : 0)
                frameInto(g, here)
                g[6] = u(tagOf.get(n.id) ?? 0)
            }
            const r = push()
            head(r, KIND.ARRAY, n.copies.length, 0, (visible(n) ? FLAG.VISIBLE : 0) | (plainAbove && csgDepth === 0 ? FLAG.CULLABLE : 0))
            frameInto(r, here)
            r[6] = u(tagOf.get(n.id) ?? 0)
            setBox(r, n, plainAbove && csgDepth === 0)
            const at = params.length
            for (const t of n.copies) {
                const m = matrixOf(t)
                params.push([m[0], m[1], m[2], m[12]], [m[4], m[5], m[6], m[13]], [m[8], m[9], m[10], m[14]], [m[15], 0, 0, 0])
            }
            r[5] = u(at)
            if (!together) for (const c of n.children || []) node(c, IDENTITY, on, plainAbove, csgDepth)
            else {
                const shape = shapesOf(n)
                for (const c of n.children || []) {
                    if (!shape.includes(c)) { node(c, IDENTITY, on, false, csgDepth + 1); continue }
                    const start = recs.length
                    node(c, IDENTITY, on, false, csgDepth + 1)
                    const base = c === shape[0]
                    const j = push()
                    head(j, KIND.JOIN, base ? OPS.union : OPS[joinOf(c)] ?? 0, 0, visible(c) ? FLAG.VISIBLE : 0)
                    j[7] = base || c.joinBlend == null ? n.blend ?? 0 : c.joinBlend
                    j[4] = u(recs.length)
                    if (recs.length - 1 > start && !visible(c)) recs[start][4] = u(recs.length)
                }
            }
            const e = push()
            head(e, KIND.ARRAY_END, 0, 0, FLAG.VISIBLE)
            e[4] = u(recs.indexOf(r))
            r[4] = u(recs.length)
            if (together) {
                const end = push()
                head(end, KIND.END, 0, 0, FLAG.VISIBLE)
                end[4] = u(recs.indexOf(g))         // the CSG record it closes (its frame, its tag)
                g[4] = u(recs.length)
                if (csgDepth === 0) for (const h of hoisted.pop()) lightRecord(h.n, h.here, false, h.on)
            }
            return
        }
        // a group: a CSG one, or a plain one that is one of a CSG group's shapes (codegen combinedGroups), combines
        const csg = combined.has(n.id)
        const r = push()
        head(r, csg ? KIND.CSG : KIND.GROUP, 0, 0, (visible(n) ? FLAG.VISIBLE : 0) | (plainAbove && csgDepth === 0 ? FLAG.CULLABLE : 0))
        frameInto(r, here)
        r[6] = u(tagOf.get(n.id) ?? 0)
        setBox(r, n, plainAbove && csgDepth === 0)
        if (!csg) {
            for (const c of n.children || []) node(c, here, on, plainAbove, csgDepth)
        } else {
            if (csgDepth === 0) hoisted.push([])
            const shape = shapesOf(n)
            for (const c of n.children || []) {
                if (!shape.includes(c)) { node(c, here, on, false, csgDepth + 1); continue }
                const start = recs.length
                node(c, here, on, false, csgDepth + 1)
                // ITS JOIN: its op and its blend (its own, or the group's), after its shape
                const j = push()
                const own = c.joinBlend != null ? c.joinBlend : n.blend ?? 0
                head(j, KIND.JOIN, OPS[joinOf(c)] ?? 0, 0, visible(c) ? FLAG.VISIBLE : 0)
                j[7] = own
                j[4] = u(recs.length)
                /* a hidden shape is ABSENT, its join too (codegen liveVisibility): the shape's first record skips past it */
                if (recs.length - 1 > start && !visible(c)) recs[start][4] = u(recs.length)
            }
            const e = push()
            head(e, KIND.END, 0, 0, FLAG.VISIBLE)
            e[4] = u(recs.indexOf(r))               // the CSG record it closes (its frame, its tag)
            if (csgDepth === 0) for (const h of hoisted.pop()) lightRecord(h.n, h.here, false, h.on)
        }
        r[4] = u(recs.length)
    }
    /* a light's face as a record: drawn where it says (codegen object(), LIGHTS) */
    const lightRecord = (n, F, plainAbove, onOverride) => {
        const i = lightIndex.get(n.id)
        const r = push()
        const P = n.params || {}, rect = n.light?.shape === 'rectangle'
        let flags = (visible(n) && onOverride !== false ? FLAG.VISIBLE : 0) | (plainAbove ? FLAG.CULLABLE : 0)
        if (n.light?.twoSided) flags |= FLAG.TWO_SIDED
        if (n.light?.transparent) flags |= FLAG.TRANSPARENT
        head(r, KIND.LIGHT, rect ? 2 : 1, lightMaterial(i), flags)
        frameInto(r, F)
        const at = params.length
        params.push(rect ? [P.width ?? 1, P.height ?? 1, 0, 0] : [P.radius ?? 0.5, 0, 0, 0])
        r[5] = u(at); r[6] = u(tagOf.get(n.id) ?? 0)
        setBox(r, n, plainAbove)
        r[4] = u(recs.length)
    }
    /* ITS BOX, in the record's frame. A node's box is measured in its own frame (boxes.js); a compiled subtree's record
       is in its PARENT's (its own transform is applied inside its function), so its box goes there: the box around the
       eight corners carried by its transform -- bigger when turned, and so still a lower bound on the distance. Used in
       its own frame there, a turned or moved subtree's box would have been in the wrong place, and the subtree culled
       where it is. */
    const setBox = (r, n, cullable, own = null) => {
        let b = cullable ? boxes?.get(n.id) : null
        if (b && own) {
            const m = matrixOf(own), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
            for (let c = 0; c < 8; c++) {
                const q = [c & 1 ? b.hi[0] : b.lo[0], c & 2 ? b.hi[1] : b.lo[1], c & 4 ? b.hi[2] : b.lo[2]]
                for (let k = 0; k < 3; k++) {
                    // p_parent = pos + s R p_own (descend's step, one level): R's columns are m[0..2], m[4..6], m[8..10]
                    const v = m[12 + k] + m[15] * (m[k] * q[0] + m[4 + k] * q[1] + m[8 + k] * q[2])
                    lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v)
                }
            }
            b = { lo, hi }
        }
        if (b) { r[20] = b.lo[0]; r[21] = b.lo[1]; r[22] = b.lo[2]; r[23] = 1; r[24] = b.hi[0]; r[25] = b.hi[1]; r[26] = b.hi[2] }
    }
    for (const c of tree.children || []) node(c, IDENTITY, true, true, 0)
    if (!ok) return null
    // the parameters follow the records, then the light table
    const nRec = recs.length
    const paramBase = HEADER + REC * nRec
    for (const r of recs) {
        const k = new Uint32Array(new Float32Array([r[0]]).buffer)[0]
        if (k === KIND.OBJECT || k === KIND.LIGHT || k === KIND.ARRAY || k === KIND.BEFORE || k === KIND.AFTER) {
            const off = new Uint32Array(new Float32Array([r[5]]).buffer)[0]
            r[5] = u(paramBase + off)
        }
        // next (an END: the CSG record it closes): a record index -> its first vec4
        r[4] = u(HEADER + REC * new Uint32Array(new Float32Array([r[4]]).buffer)[0])
    }
    const lightBase = paramBase + params.length
    const table = lightBase + LIGHT_VEC4S * faces.length
    const recsOut = new Float32Array(4 * table)
    const hdr = new Uint32Array(recsOut.buffer, 0, 4)
    hdr[0] = HEADER + REC * nRec; hdr[1] = lightBase; hdr[2] = faces.length; hdr[3] = 0
    recs.forEach((r, i) => recsOut.set(r, 4 * (HEADER + REC * i)))
    params.forEach((p, i) => recsOut.set(p, 4 * (paramBase + i)))
    faces.forEach((f, i) => { if (f) f.forEach((v, j) => recsOut.set(v, 4 * (lightBase + LIGHT_VEC4S * i + j))) })
    return { data: recsOut, records: nRec, tags }
}

/** The path from `root` down to `target`, root first, or [] (a node inside a compiled subtree, for its light's frame). */
function pathTo(root, target) {
    if (root === target) return [root]
    for (const c of root.children || []) { const p = pathTo(c, target); if (p.length) return [root, ...p] }
    return []
}

//======================================================================================================================
// THE EVALUATOR -- the scene's SDF() when its shape is data. One loop over the records; what it calls for an object is
// that object's block (blk_<i>, codegen emits them), for a compiled subtree its function (sub_<i>).
//
// WHAT CODEGEN DID, DONE HERE THE SAME WAY, rule by rule (codegen.js emitScene):
//   a frame       p in the node's frame; XF_M, XF_S its frame for add_new; XF_P that point when a material reads p_local
//                 (wantLocal); XF_SUB the number of private Hits open (a CSG child's surface is not the scene's)
//   a CSG group   its shapes each into a Hit of their own, combined in order by their joins -- the first shown one is the
//                 base, a hidden one absent -- then folded in, in the group's own frame, with the material of
//                 whichever shape makes the surface there (a union's nearer, an intersection's farther, a subtraction's cutter)
//   culling       a node the records mark CULLABLE (at the top level: codegen culled there alone), farther from its box
//                 than cullMargin(): its box distance stands in, and nothing below it is evaluated
//   a limiter     drawn only by the optics copies (SCN_OPTICS)
//   the pick      XF_TAG set to the node's tag before it folds (SCN_PICK); the pick copy is not culled
// What is NOT reset between records, as codegen restored it at each block's end, is reset at the start of each record
// that folds -- every one sets the frame it folds in -- and XF_M, XF_S are put back to the identity at the end, as the
// last block's leave() left them.
//======================================================================================================================
export function evaluatorWGSL({ blocks, befores = 0, afters = 0, subs, stack, arrays = 0, wantLocal = false, keepK = false, straight = false, pick = false, optics = false, cull = true, count = false, recs = 'sceneData' }) {
    const L = []
    const w = s => L.push(s)
    const culling = cull && !pick && !optics
    /* `count`: SCN_VISITS counts the records walked, for the tests' numbers. (Exact hits, the ray's list and the
       candidate grid walked ranges of records here until 0.41.0: roadmap/ARCHITECTURE.md, Removed in 0.41.0.) */
    /* THE BASE FRAME, in a scene with arrays or before groups (`arrays`: how deep they nest): a record's frame is relative
       to it -- the world, the copy of an array its record is in, or the frame a before group's code left (recordsOf) --
       bp the point in it, bM and bS its rotation and scale to the world. Without either the base is the world and none of
       it is in the text: the scenes before arrays evaluate exactly as they did. */
    const P = arrays > 0 ? 'bp' : 'r.pos'
    /* a before group's warp() multiplies XF_K, which is put back after its children where something reads it (keepK:
       codegen saves and restores it around group code then, and only then) -- kept with the base frame */
    const withK = arrays > 0 && befores > 0 && keepK
    const entry = (bp, bM, bS, at, n) => `ScnArray(${bp}, ${bM}, ${bS}, ${at}, ${n}${withK ? ', XF_K' : ''})`
    const XM = m => arrays > 0 ? `bM * ${m}` : m, XS = v => arrays > 0 ? `bS * ${v}` : v
    w(`const SCN_PICK: bool = ${pick};`)
    w(`const SCN_OPTICS: bool = ${optics};`)
    // a compiled subtree's tags are offsets from its root's, which is set here from its record (codegen tagIn)
    if (pick) w('var<private> SCN_TAGBASE: u32;')
    if (stack > 0) {
        w('/* A CSG group open on the way down (or an after group: its own Hit, with no combine): its combined shape so far,')
        w('   and the Hit it will fold into (the scene\'s, or an enclosing group\'s private one), kept as the parts a fold')
        w('   changes -- the ray is the same for all of them */')
        w(`struct ScnFrame { k: VEC4, km: u32, first: u32, at: u32, hs: VEC4, hm: u32, ha: u32, hw: f32 }`)
    }
    if (arrays > 0) {
        w('/* An array or a before group open on the way down: the base frame it was entered in, its record, and which copy')
        w('   is being walked (an array\'s)' + (withK ? ', and XF_K as it was (a before group\'s warp changes it) */' : ' */'))
        w(`struct ScnArray { bp: VEC3, bM: mat3x3<f32>, bS: f32, at: u32, n: u32${withK ? ', k: f32' : ''} }`)
        w('/* the base frame of copy n of the array at record g: q, M and S the array\'s own point and frame in the base before */')
        w('fn scnCopy(g: u32, n: u32, q: VEC3, M: mat3x3<f32>, S: f32, bM0: mat3x3<f32>, bS0: f32) -> ScnArray {')
        w(`    let o = scnU(scnRec(g + 1u).y) + ${COPY_VEC4S}u * n;`)
        w('    let c0 = sceneData[o]; let c1 = sceneData[o + 1u]; let c2 = sceneData[o + 2u]; let s = sceneData[o + 3u].x;')
        w('    let R = mat3x3<f32>(c0.xyz, c1.xyz, c2.xyz);')
        w(`    return ${entry('(transpose(R) * (q - VEC3(c0.w, c1.w, c2.w))) / s', 'bM0 * M * R', 'bS0 * S * s', 'g', 'n')};`)
        w('}')
    }
    w('fn scnU(v: f32) -> u32 { return bitcast<u32>(v); }')
    /* A RECORD'S VEC4, wherever the walk reads one (RECORDS_IN_UNIFORM): from the records' uniform copy (scnRecs) where
       every ray walks them in step, as far as it holds them, else from the scene's buffer as ever. Parameters, the light
       table are read from the scene's buffer either way. */
    if (recs === 'scnRecs') w(`fn scnRec(k: u32) -> vec4<f32> { if (k < ${RECS_UNIFORM_VEC4S}u) { return scnRecs[k]; } return sceneData[k]; }`)
    else w('fn scnRec(k: u32) -> vec4<f32> { return sceneData[k]; }')
    const resets = () => {
        if (wantLocal) w('    XF_P = r.pos; XF_SUB = 0u;')
        if (keepK) w('    XF_K = 1.0;')
        if (straight) w('    XF_STRAIGHT = false;')
    }
    if (count) w('var<private> SCN_VISITS: u32 = 0u;')
    w('fn SDF(r: Ray) -> Hit {')
    w('    var C = emptyHit(r);')
    if (culling) w('    var CULL: FLOAT = 1.0e7;              // the nearest skipped node\'s box: a bound on all of them')
    resets()
    /* THE INNERMOST OPEN FRAME IN A VARIABLE OF ITS OWN (0.22.16), `top` and `atop`; the arrays keep only the frames it
       encloses, and are read and written only when a group opens or ends. Until 0.22.16 every frame was in the array,
       read and written by an index known only as the walk runs -- at each shape's join, each answer folded in. Measured
       (the user's Pascal, Tests > overhead of 0.22.14): one Menger cube as data 1.3 times codegen's march, the Menger cubes
       without their warps (a subtraction's frame) 5.1, with them (the warps' frames too) 9.7, and the binding made
       read-only in 0.22.14 moved only the rows with no such array. Inferred, not measured: a GPU compiler keeps an array
       indexed at run time in memory, not registers, and each of those reads and writes went out to it. The test is
       the same run: if the two Menger rows fall toward the others' ratios, it was. The arrays keep their size (the room
       the plan names, stackFor); their last slot is never written now, `top` being the frame that would be in it. */
    if (stack > 0) {
        w(`    var stack: array<ScnFrame, ${stack}>;   // the frames top is inside, outermost first`)
        w('    var top: ScnFrame;                  // the innermost open frame, while depth > 0')
        w('    var depth = 0u;')
    }
    if (arrays > 0) {
        w('    var bp = r.pos; var bM = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0); var bS = 1.0;')
        w(`    var astack: array<ScnArray, ${arrays}>;   // the base frames atop is inside, outermost first`)
        w('    var atop: ScnArray;                 // the innermost open array or before group, while ad > 0')
        w('    var ad = 0u;')
    }
    w('    let end = scnU(sceneData[0].x);')
    w(`    var i = ${HEADER}u;`)
    w('    loop {')
    w('        if (i >= end) { break; }')
    if (count) w('        SCN_VISITS = SCN_VISITS + 1u;')
    w('        let v0 = scnRec(i);')
    w('        let kind = scnU(v0.x);')
    w('        let flags = scnU(v0.w);')
    w('        let v1 = scnRec(i + 1u);')
    w(`        if ((flags & ${FLAG.VISIBLE}u) == 0u) { i = scnU(v1.x); continue; }`)
    if (stack > 0) {
        w(`        if (kind == ${KIND.JOIN}u) {`)
        w('            // this shape into its group\'s: the first shown is the base, each after it joins by its op and blend')
        w('            let op = scnU(v0.y);')
        w('            if (top.first != 0u) { top.k = C.s; top.km = C.m; top.first = 0u; }')
        w('            else if (op == 0u) { top.km = select(top.km, C.m, C.s.w < top.k.w); top.k = csgUnion(top.k, C.s, v1.w); }')
        w('            else if (op == 1u) { top.km = select(top.km, C.m, -C.s.w > top.k.w); top.k = csgSubtract(top.k, C.s, v1.w); }')
        w('            else { top.km = select(top.km, C.m, C.s.w > top.k.w); top.k = csgIntersect(top.k, C.s, v1.w); }')
        w('            C = emptyHit(r);          // the next shape alone')
        w(`            i = i + ${REC}u;`)
        w('            continue;')
        w('        }')
        w(`        if (kind == ${KIND.END}u) {`)
        w('            // the group\'s combined shape into what it folds into, in the group\'s own frame (its record)')
        w('            depth = depth - 1u;')
        w('            let fr = top;')
        w('            if (depth > 0u) { top = stack[depth - 1u]; }   // the frame it is in, innermost again')
        w('            let g = scnU(v1.x);')
        w('            let ga = scnRec(g + 2u); let gb = scnRec(g + 3u); let gc = scnRec(g + 4u);')
        if (arrays > 0) {
            w('            let gM = mat3x3<f32>(ga.xyz, gb.xyz, gc.xyz); let gS = scnRec(g + 1u).w;')
            w('            XF_M = bM * gM; XF_S = bS * gS;')
            if (wantLocal) w('            XF_P = (transpose(gM) * (bp - VEC3(ga.w, gb.w, gc.w))) / gS; XF_SUB = depth;')
        } else {
            w('            XF_M = mat3x3<f32>(ga.xyz, gb.xyz, gc.xyz); XF_S = scnRec(g + 1u).w;')
            if (wantLocal) w('            XF_P = (transpose(XF_M) * (r.pos - VEC3(ga.w, gb.w, gc.w))) / XF_S; XF_SUB = depth;')
        }
        if (pick) w('            XF_TAG = scnU(scnRec(g + 1u).z);')
        w('            C = Hit(r, fr.hs, fr.hm, fr.ha, fr.hw);')
        w('            C = fold(C, fr.k, fr.km);')
        w(`            i = i + ${REC}u;`)
        w('            continue;')
        w('        }')
        if (afters > 0) {
            w(`        if (kind == ${KIND.AFTER_END}u) {`)
            w('            // the after group\'s code, with its children\'s Hit (SCN_AFTER) and the one it folds into, in its own frame')
            w('            depth = depth - 1u;')
            w('            let fr = top;')
            w('            if (depth > 0u) { top = stack[depth - 1u]; }')
            w('            let g = scnU(v1.x);')
            w('            let ga = scnRec(g + 2u); let gb = scnRec(g + 3u); let gc = scnRec(g + 4u);')
            w('            let gM = mat3x3<f32>(ga.xyz, gb.xyz, gc.xyz); let gS = scnRec(g + 1u).w;')
            w(`            XF_M = ${XM('gM')}; XF_S = ${XS('gS')};`)
            if (pick) w('            XF_TAG = scnU(scnRec(g + 1u).z);')
            w(`            let gq = (transpose(gM) * (${P} - VEC3(ga.w, gb.w, gc.w))) / gS;`)
            // its code folds the children's Hit in where the group is: the scene's again, in the group's own frame
            if (wantLocal) w('            XF_P = gq; XF_SUB = depth;')
            w('            SCN_AFTER = C;')
            w('            C = Hit(r, fr.hs, fr.hm, fr.ha, fr.hw);')
            w('            switch scnU(scnRec(g).y) {')
            for (let k = 0; k < afters; k++) w(`                case ${k}u: { C = aft_${k}(C, r, gq, scnU(scnRec(g + 1u).y)); }`)
            w('                default: { }')
            w('            }')
            w(`            i = i + ${REC}u;`)
            w('            continue;')
            w('        }')
        }
    }
    if (arrays > 0) {
        w(`        if (kind == ${KIND.ARRAY_END}u) {`)
        w('            // the next copy of the array, from the top of its children -- or, after the last, its base frame back')
        w('            let g = scnU(v1.x);')
        w('            let n = atop.n + 1u;')
        w('            if (n < scnU(scnRec(g).y)) {')
        w('                let ga = scnRec(g + 2u); let gb = scnRec(g + 3u); let gc = scnRec(g + 4u);')
        w('                let gM = mat3x3<f32>(ga.xyz, gb.xyz, gc.xyz); let gS = scnRec(g + 1u).w;')
        w('                let gq = (transpose(gM) * (atop.bp - VEC3(ga.w, gb.w, gc.w))) / gS;')
        w('                let nx = scnCopy(g, n, gq, gM, gS, atop.bM, atop.bS);')
        w('                bp = nx.bp; bM = nx.bM; bS = nx.bS; atop.n = n;')
        w(`                i = g + ${REC}u;`)
        w('                continue;')
        w('            }')
        w('            bp = atop.bp; bM = atop.bM; bS = atop.bS; ad = ad - 1u;')
        w('            if (ad > 0u) { atop = astack[ad - 1u]; }   // the one it is in, innermost again')
        w(`            i = i + ${REC}u;`)
        w('            continue;')
        w('        }')
        w(`        if (kind == ${KIND.BEFORE_END}u) {`)
        w('            // after a before group\'s children: the frame it was entered in back' + (withK ? ', and XF_K' : ''))
        w(`            bp = atop.bp; bM = atop.bM; bS = atop.bS;${withK ? ' XF_K = atop.k;' : ''} ad = ad - 1u;`)
        w('            if (ad > 0u) { atop = astack[ad - 1u]; }')
        w(`            i = i + ${REC}u;`)
        w('            continue;')
        w('        }')
    }
    w('        let a = scnRec(i + 2u); let b = scnRec(i + 3u); let c = scnRec(i + 4u);')
    w('        let M = mat3x3<f32>(a.xyz, b.xyz, c.xyz);')
    w('        let S = v1.w;')
    w(`        let q = (transpose(M) * (${P} - VEC3(a.w, b.w, c.w))) / S;`)
    if (culling) {
        w(`        if ((flags & ${FLAG.CULLABLE}u) != 0u) {`)
        w(`            let bd = cullDist(q, scnRec(i + 5u), scnRec(i + 6u)) * ${XS('S')};`)
        w(`            if (bd > cullMargin()) { CULL = min(CULL, bd); i = scnU(v1.x); continue; }`)
        w('        }')
    }
    w(`        if (kind == ${KIND.GROUP}u) { i = i + ${REC}u; continue; }`)
    if (arrays > 0) {
        w(`        if (kind == ${KIND.ARRAY}u) {`)
        w('            // its first copy: the base frame it is entered in kept, the copy\'s made the base')
        w('            if (ad > 0u) { astack[ad - 1u] = atop; }   // the one it is in, out of the way')
        w(`            atop = ${entry('bp', 'bM', 'bS', 'i', '0u')};`)
        w('            ad = ad + 1u;')
        w('            let nx = scnCopy(i, 0u, q, M, S, bM, bS);')
        w('            bp = nx.bp; bM = nx.bM; bS = nx.bS;')
        w(`            i = i + ${REC}u;`)
        w('            continue;')
        w('        }')
        w(`        if (kind == ${KIND.BEFORE}u) {`)
        w('            // its code, in its own frame (XF_M and XF_S its frame\'s, as codegen enter() leaves them); the point it')
        w('            // gives back, and XF_M and XF_S as its warp() left them, the base its children\'s records are in')
        w('            if (ad > 0u) { astack[ad - 1u] = atop; }')
        w(`            atop = ${entry('bp', 'bM', 'bS', 'i', '0u')};`)
        w('            ad = ad + 1u;')
        w('            XF_M = bM * M; XF_S = bS * S;')
        w('            var np = q;')
        if (befores > 0) {
            w('            switch scnU(v0.y) {')
            for (let k = 0; k < befores; k++) w(`                case ${k}u: { np = bef_${k}(r, q, scnU(v1.y)); }`)
            w('                default: { }')
            w('            }')
        }
        w('            bp = np; bM = XF_M; bS = XF_S;')
        w(`            i = i + ${REC}u;`)
        w('            continue;')
        w('        }')
    }
    if (stack > 0) {
        w(`        if (kind == ${KIND.CSG}u${afters > 0 ? ` || kind == ${KIND.AFTER}u` : ''}) {`)
        w('            if (depth > 0u) { stack[depth - 1u] = top; }   // the frame it is in, out of the way')
        w(`            top = ScnFrame(VEC4(0.0, 0.0, 1.0, 1.0e7), MAT_AIR, 1u, i, C.s, C.m, C.a, C.insideW);`)
        w('            depth = depth + 1u;')
        w('            C = emptyHit(r);          // its first shape alone')
        w(`            i = i + ${REC}u;`)
        w('            continue;')
        w('        }')
    }
    w(`        XF_M = ${XM('M')}; XF_S = ${XS('S')};`)
    if (wantLocal) w(`        XF_P = q; XF_SUB = ${stack > 0 ? 'depth' : '0u'};`)
    if (pick) w('        XF_TAG = scnU(v1.z);')
    w('        let which = scnU(v0.y);')
    w('        let o = scnU(v1.y);')
    w(`        if (kind == ${KIND.OBJECT}u) {`)
    w(`            if (SCN_OPTICS || (flags & ${FLAG.LIMITER}u) == 0u) {`)
    if (blocks > 0) {
        w('                switch which {')
        for (let k = 0; k < blocks; k++) w(`                    case ${k}u: { C = blk_${k}(C, r, q, o, scnU(v0.z)); }`)
        w('                    default: { }')
        w('                }')
    }
    w('            }')
    w(`        } else if (kind == ${KIND.LIGHT}u) {`)
    w('            // a light\'s face (codegen object(), LIGHTS): black behind unless two-sided, a transparent one\'s back clear')
    w('            let mid = scnU(v0.z);')
    w(`            let back = select(MATID_BLACK, MATID_CLEAR, (flags & ${FLAG.TRANSPARENT}u) != 0u);`)
    w(`            let lm = select(select(back, mid, q.z >= 0.0), mid, (flags & ${FLAG.TWO_SIDED}u) != 0u);`)
    w('            let P = sceneData[o];')
    w('            if (which == 2u) { C = add_new(C, Nrectangle(q, P.xy * 0.5), lm); } else { C = add_new(C, Ndisc(q, P.x), lm); }')
    w(`        } else if (kind == ${KIND.SUB}u) {`)
    if (subs > 0) {
        if (pick) w('            SCN_TAGBASE = scnU(v1.z);')
        w('            switch which {')
        for (let k = 0; k < subs; k++) w(`                case ${k}u: { C = sub_${k}(C, r, q); }`)
        w('                default: { }')
        w('            }')
    }
    w('        }')
    w(`        i = i + ${REC}u;`)
    w('    }')
    w('    XF_M = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0); XF_S = 1.0;')
    if (culling) w('    if (CULL < abs(C.s.w)) { C.s.w = CULL; }')
    w('    return C;')
    w('}')
    return L
}

/** THE SOLIDS of a scene's records (the step cache's box, stepbox.js): the members of the root's union -- an object, a
 *  light, a CSG or modifier group whole, an array, a compiled subtree; a plain group is see-through, its children solids
 *  of their own. Hidden ones are left out, and in the render's copy (`optics` false) a limiter's objects, which only the
 *  optics trace draws. [{ start, kind, box }]: start the record's first vec4, box its culling box in the world or null. */
export function solidsOf(data, { optics = false } = {}) {
    const u = new Uint32Array(data.buffer, data.byteOffset, data.length)
    const end = u[0], out = []
    let i = HEADER
    while (i < end) {
        const kind = u[4 * i], flags = u[4 * i + 3], next = u[4 * i + 4]
        if (!(flags & FLAG.VISIBLE) || (!optics && kind === KIND.OBJECT && (flags & FLAG.LIMITER))) { i = next; continue }
        if (kind === KIND.GROUP) { i += REC; continue }
        out.push({ start: i, kind, box: worldBoxOf(data, i) })
        i = next
    }
    return out
}
/* A RECORD'S CULLING BOX IN THE WORLD (recordsOf setBox: in its record's frame, known when its 1 is set), around its
   eight corners carried by the frame -- or null, unknown: an unbounded floor, or not measured yet */
function worldBoxOf(data, i) {
    const r = data.subarray(4 * i, 4 * (i + REC))
    if (r[23] !== 1) return null
    const S = r[7], t = [r[11], r[15], r[19]], M = [[r[8], r[9], r[10]], [r[12], r[13], r[14]], [r[16], r[17], r[18]]]
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (let c = 0; c < 8; c++) {
        const q = [c & 1 ? r[24] : r[20], c & 2 ? r[25] : r[21], c & 4 ? r[26] : r[22]]
        for (let k = 0; k < 3; k++) {
            const v = t[k] + S * (q[0] * M[0][k] + q[1] * M[1][k] + q[2] * M[2][k])
            lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v)
        }
    }
    return lo.every(Number.isFinite) && hi.every(Number.isFinite) ? { lo, hi } : null
}

/** The light faces as light sampling sees them (codegen emitLightFaces), their frames and visibility read from the
 *  light table, their radiance from the lights' own uniforms (their material: codegen emitMaterials). `ub(L, k)` names
 *  light L's uniform k. */
export function lightFacesWGSL(lights, ub) {
    const L = []
    const w = s => L.push(s)
    const weight = (L, i) => `select(0.0, 1.0, sceneData[scnLight(${i}u) + 3u].w > 0.5 && u32(UB.${ub(L, 'beam')}.x + 0.5) != 0u)`
    w(`const LIGHT_FACES: u32 = ${lights.length}u;`)
    w('fn scnLight(i: u32) -> u32 { return bitcast<u32>(sceneData[0].y) + ' + LIGHT_VEC4S + 'u * i; }')
    w('fn lightFaceTotal() -> f32 {')
    w('    var t = 0.0;')
    lights.forEach((L, i) => w(`    t += ${weight(L, i)};     // light ${L.id}`))
    w('    return t;')
    w('}')
    w('fn lightFacePick(u: f32) -> u32 {')
    w('    var acc = 0.0;')
    w('    var last = 0u;')
    lights.forEach((L, i) => w(`    { let w = ${weight(L, i)}; if (w > 0.0) { last = ${i}u; acc += w; if (u < acc) { return ${i}u; } } }     // light ${L.id}`))
    w('    return last;')
    w('}')
    w('fn lightFace(i: u32) -> LightFace {')
    w('    var f: LightFace;')
    w('    let b = scnLight(i);')
    w('    let a0 = sceneData[b]; let a1 = sceneData[b + 1u]; let a2 = sceneData[b + 2u]; let a3 = sceneData[b + 3u];')
    w('    f.centre = a0.xyz; f.u = a1.xyz; f.v = a2.xyz; f.n = a3.xyz; f.half = VEC2(a1.w, a2.w);')
    w('    let fl = bitcast<u32>(a0.w);')
    w('    f.shape = fl & 3u; f.twoSided = (fl >> 2u) & 1u;')
    w('    switch (i) {')
    lights.forEach((L, i) => {
        const c = ub(L, 'emissive'), l = ub(L, 'emissiveLuminance'), b = ub(L, 'beam')
        w(`        case ${i}u: { f.le = UB.${c} / max(dot(UB.${c}, LUMA_709), 1e-6) * UB.${l}; f.beam = UB.${b}; }     // light ${L.id}`)
    })
    w('        default: { }')
    w('    }')
    w('    f.weight = select(0.0, 1.0, a3.w > 0.5 && u32(f.beam.x + 0.5) != 0u);')
    w('    return f;')
    w('}')
    w('fn lightFaceLe(f: LightFace, cosT: f32) -> VEC3 {')
    w('    return f.le * lightBeam(f.beam, cosT);')
    w('}')
    return L
}

/** The GPU side of a data scene: its buffer, made by the renderer's setScene (init), written in place when the scene's
 *  data changes and the text does not (writeData: false when it no longer fits -- then the scene is swapped in anew),
 *  and freed when another scene takes its place (dispose). The buffer is made with room to grow, so adding a few nodes
 *  is a write, not a new buffer. */
export function attachData(scene, data, { uniformRecs = false } = {}) {
    let handle = null, recs = null
    scene.data = data
    /* ITS DATA'S REVISION, one more at every write to the GPU, by whoever writes (init and writeData below): what the
       renderer's step cache keeps its cells for (raytrace_main.js R.stepCacheFor). Counted here, not by the callers,
       because there are several of them (the facade's updateSceneData, the builder's demo.js, the bench), and a count in
       one caller sees one. */
    Object.defineProperty(scene, 'dataRev', { enumerable: false, configurable: true, writable: true, value: 0 })
    let bound = null
    /* ...and the records' uniform copy (RECORDS_IN_UNIFORM), its whole room always: the text declares it so, and a binding
       must be as large as what the shader declares. Written with the scene's buffer: the header and records, as many as
       it holds (the walk reads any past them from the scene's buffer). */
    const writeRecs = d => recs.w(d.subarray(0, 4 * Math.min(new Uint32Array(d.buffer, d.byteOffset, 1)[0], RECS_UNIFORM_VEC4S)))
    /* made once and kept: the same scene set again (recompile) writes the buffer it has, so whatever is bound to it --
       the optics module's pipelines, kept with the scene -- still is */
    Object.defineProperty(scene, 'init', { enumerable: false, configurable: true, writable: true, value: async WG => {
        const need = scene.data.byteLength
        scene.dataRev++
        // (the usage's numbers are WebGPU's, for a test's device with no GPUBufferUsage)
        if (uniformRecs && !recs) recs = WG.createBuffer(16 * RECS_UNIFORM_VEC4S, (globalThis.GPUBufferUsage?.UNIFORM ?? 0x40) | (globalThis.GPUBufferUsage?.COPY_DST ?? 0x08), 'scene records')
        if (handle && need <= handle.b.size) { handle.w(scene.data); if (recs) writeRecs(scene.data); return bound }
        handle?.b.destroy?.()
        let bytes = 4096
        while (bytes < need * 1.5) bytes *= 2
        handle = WG.createStorageBuffer(bytes)
        handle.w(scene.data)
        if (recs) writeRecs(scene.data)
        return (bound = { sceneData: handle.b, ...(recs ? { scnRecs: recs.b } : {}) })
    } })
    Object.defineProperty(scene, 'writeData', { enumerable: false, configurable: true, writable: true, value: d => {
        if (!handle || d.byteLength > handle.b.size) return false
        scene.dataRev++
        handle.w(d)
        if (recs) writeRecs(d)
        scene.data = d
        return true
    } })
    Object.defineProperty(scene, 'dispose', { enumerable: false, configurable: true, writable: true, value: () => {
        handle?.b.destroy?.()
        recs?.b.destroy?.()
        handle = null; recs = null; bound = null
        delete scene.buffers
    } })
    return scene
}
