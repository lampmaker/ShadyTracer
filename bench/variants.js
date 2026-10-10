//======================================================================================================================
// BENCHMARK VARIANTS -- the frozen scene changed in exactly one way, for one row of the benchmark (bench/index.js).
//
// Pure functions over a builder document (model.js), so bench/test/bench.test.mjs can check each changes what its
// row says and nothing else. Every one returns a new document; the one it is given is never touched.
//
//   withoutMaterialCode(doc)        every material's code emptied: no p_local, no streaks, the parameters kept
//   withoutGroupCode(doc, keepId)   every group's code dropped but keepId's: a relief becomes its plain shape
//   withReliefCode(doc, code)       every noise relief's code replaced: the relief as the builder writes it now
//   rescaled(doc, unit, factor = 1) the same scene RE-AUTHORED in another unit (and, with factor, a different
//                                   physical size): every position and every declared length multiplied, the
//                                   numbers a person would type in that unit
//   converted(doc, unit)            the same scene CONVERTED the builder's own way (model.js insertAsset, a paste
//                                   between units): each top-level node's position and transform scale multiplied,
//                                   parameters untouched -- the object keeps its numbers and is scaled
//   lengthScale(doc, unit, factor)  the factor both apply to lengths: metres per old unit / metres per new unit
//
// WHY BOTH UNIT VARIANTS. A scene is in mm, cm or m two ways in practice -- typed in that unit, or pasted from
// another -- and they reach the kernels differently (sizes in the uniforms, or a transform scale through XF_S).
// The same physical scene must render in the same time either way; the benchmark measures whether it does.
//======================================================================================================================

import { UNITS } from '../lib/pathtracer/core/photometry.js'
import { blockOf, codeOf, newId } from '../builder/model.js'

export const lengthScale = (doc, unit, factor = 1) => factor * (UNITS[doc.unit ?? 'm'] ?? 1) / (UNITS[unit] ?? 1)

const each = (node, fn) => { for (const c of node.children || []) { fn(c); each(c, fn) } }

export function withoutMaterialCode(doc) {
    const d = structuredClone(doc)
    for (const m of d.materials || []) m.code = ''
    return d
}

/* EVERY GROUP'S OWN CODE DROPPED -- but `keepId`'s, if given. A group without code is a plain union of its
   children (checked by generating the Noise library: the document validates, all six shapes stay in the SDF,
   the fbm3 calls leave it), so a relief group becomes the bare shape it displaced. Its parameters stay,
   unread. `codedGroups(doc)` lists the groups that have code, in document order, for the one-at-a-time rows. */
/* A GROUP'S CODE IS ITS BLOCK'S (model.js version 16): dropped, the group is given a copy of its block with no code
   -- its parameters still declared, unread, as a group whose code was deleted kept them -- one copy for every group
   that shared the block. codedGroups lists the groups (the document's own nodes; codeOf reads their code). */
export const codedGroups = doc => {
    const out = []
    each(doc.root, n => { if (n.kind === 'group' && codeOf(doc, n)) out.push(n) })
    return out
}
export function withoutGroupCode(doc, keepId = null) {
    const d = structuredClone(doc)
    const empty = new Map()
    each(d.root, n => {
        if (n.kind !== 'group' || !codeOf(d, n) || n.id === keepId) return
        const B = blockOf(d, n)
        if (!empty.has(B.id)) {
            const C = { ...structuredClone(B), id: newId(d, 'b'), label: `${B.label} (no code)`, code: '' }
            delete C.builtin
            d.blocks.push(C)
            empty.set(B.id, C.id)
        }
        n.block = empty.get(B.id)
    })
    return d
}

/* EVERY NOISE RELIEF'S CODE REPLACED by `code` -- the relief as the builder writes it now (modifiers.js), given
   rather than imported so this stays a pure function of its arguments. A relief is a group whose code calls
   fbm3 on p / size, as the builder's relief does; its parameters stay as they are. The frozen scene keeps the
   code it was frozen with, so row 1 stays comparable across runs and this row is the difference. */
export const isRelief = (doc, n) => n.kind === 'group' && /\bfbm3\(p \/ size\b/.test(codeOf(doc, n))
/* ...its BLOCK's code replaced: every user of a relief's block is a relief (one block, one code), and the copy is the
   bench's own */
export function withReliefCode(doc, code) {
    const d = structuredClone(doc)
    const reliefs = new Set()
    each(d.root, n => { if (isRelief(d, n)) reliefs.add(blockOf(d, n)) })
    for (const B of reliefs) { B.code = code; delete B.builtin }
    return d
}

/* A LENGTH IS WHAT THE DOCUMENT SAYS IS ONE: a node's `lengths` (model.js isLength), and positions. A numeric
   parameter NOT declared a length cannot be scaled safely -- it may be a count or an angle -- so a document with
   one is refused, by name, rather than rescaled half right. */
export function rescaled(doc, unit, factor = 1) {
    if (!(unit in UNITS)) throw new Error(`[bench] unknown unit '${unit}'`)
    const k = lengthScale(doc, unit, factor)
    const d = structuredClone(doc)
    // a PROFILE (model.js paramKind) is a list of points, every number in it a length -- its fillets' too; a PATH
    // is one inside { path }, which the plain object's case below would have passed over, its numbers one level down
    const isProfile = v => Array.isArray(v) && v.length > 0 && v.every(Array.isArray)
    const isPath = v => v && typeof v === 'object' && Array.isArray(v.path)
    const scale = v => typeof v === 'number' ? v * k
        : isProfile(v) ? v.map(pt => pt.map(c => c * k))
        // a path point's x, y, z and fillet are lengths; its scale x, scale y and twist (entries 5 to 7) are not
        : isPath(v) ? { ...v, path: v.path.map(pt => pt.map((c, j) => j < 4 ? c * k : c)) }
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, typeof b === 'number' ? b * k : b]))
        : v
    each(d.root, n => {
        if (n.transform?.pos) for (const a of ['x', 'y', 'z']) n.transform.pos[a] *= k
        // which are lengths is the node's block's (model.js version 16), or a light's or export box's own
        const lengths = new Set(blockOf(d, n)?.lengths || n.lengths || [])
        for (const [p, v] of Object.entries(n.params || {})) {
            // a path or profile that names parameters (builder/expr.js): which number in `rise + 0.1` is a length cannot be known
            const named = list => list.some(pt => pt.some(c => typeof c === 'string'))
            if ((isPath(v) && named(v.path)) || (isProfile(v) && named(v)))
                throw new Error(`[bench] '${n.id}' parameter '${p}' is a ${isPath(v) ? 'path' : 'profile'} written with parameter names: cannot rescale it safely`)
            if (lengths.has(p)) n.params[p] = scale(v)
            else if (typeof v === 'number' || isProfile(v) || isPath(v) || (v && typeof v === 'object' && Object.values(v).some(x => typeof x === 'number')))
                throw new Error(`[bench] '${n.id}' parameter '${p}' is not declared a length: cannot rescale it safely`)
        }
    })
    for (const m of d.materials || []) {
        const lengths = new Set(m.lengths || [])
        for (const p of lengths) if (m.params && p in m.params) m.params[p] = scale(m.params[p])
    }
    if (d.optics?.maxDist) d.optics.maxDist *= k            // the optics trace's reach, in scene units
    if (d.envRadius > 0) d.envRadius *= k                   // the scene's radius, in scene units (model.js; absent = 400 m)
    d.unit = unit
    return d
}

export function converted(doc, unit) {
    if (!(unit in UNITS)) throw new Error(`[bench] unknown unit '${unit}'`)
    const k = lengthScale(doc, unit)
    const d = structuredClone(doc)
    for (const n of d.root.children || []) {
        if (!n.transform) continue
        for (const a of ['x', 'y', 'z']) n.transform.pos[a] *= k
        n.transform.scale *= k
    }
    if (d.optics?.maxDist) d.optics.maxDist *= k
    if (d.envRadius > 0) d.envRadius *= k
    d.unit = unit
    return d
}

/** A camera looking at the rescaled scene as the original camera looked at the original: target and distance
 *  multiplied by the same factor, the angles and the field of view unchanged. */
export const scaledCamera = (camera, k) => ({ ...camera, target: camera.target.map(v => v * k), distance: camera.distance * k })
