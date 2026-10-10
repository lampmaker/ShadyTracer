//======================================================================================================================
// BOUNDS -- where a node is: its frame in the world, computed from the document, for the overlay.
//
// THERE ARE NO BOXES ANY MORE. This file drew the selected node's bounding box, measured from its
// type's parameters. There is one kind of object now, a code node (primitives.js), and code can
// put its surface anywhere, so nothing here can say where it ends -- a box from the parameters of a
// sphere whose code has been changed would be the box of an object that is not there. What is left
// is what the handles need: the chain of frames from a node to the world.
//
// Pure functions over the document, so it is tested in node like model.js.
//======================================================================================================================

import { find, blockOf } from './model.js'
import { resolvePath, resolveProfile, pathNames } from './expr.js'

/** A point of a node's frame in its parent's: the inverse of the shader's xfPoint, which undoes
 *  position, then rotation, then scale -- so this scales, rotates, then moves. */
export function toParent(t, p) {
    const [cx, sx] = cs(t.rot.x), [cy, sy] = cs(t.rot.y), [cz, sz] = cs(t.rot.z)
    const s = t.scale, x = p[0] * s, y = p[1] * s, z = p[2] * s
    // rows of Rz*Ry*Rx, as transform.js matrixOf
    return [
        cz * cy * x + (cz * sy * sx - sz * cx) * y + (cz * sy * cx + sz * sx) * z + t.pos.x,
        sz * cy * x + (sz * sy * sx + cz * cx) * y + (sz * sy * cx - cz * sx) * z + t.pos.y,
        -sy * x + cy * sx * y + cy * cx * z + t.pos.z,
    ]
}
const cs = deg => { const r = deg * Math.PI / 180; return [Math.cos(r), Math.sin(r)] }

/** The node and its ancestors, the node first, the root last. [] if the id is not in the doc. */
export function lineage(doc, id) {
    const out = []
    for (let f = find(doc, id); f; f = f.parent ? find(doc, f.parent.id) : null) {
        out.push(f.node)
        if (!f.parent) break
    }
    return out
}

/**
 * THE TRANSFORMS FROM A NODE TO THE WORLD, the node's own first: each node's, and -- between a group with copies (an
 * array, model.js version 17) and its child -- the group's FIRST copy's. Something in an array is drawn at every copy
 * and has no one place; it is shown, measured and moved where its first copy is, the one the others follow. The root's
 * transform is never applied (codegen emits its children straight into SDF).
 */
export function framesTo(doc, id) {
    const chain = lineage(doc, id), out = []
    chain.forEach((n, i) => {
        if (n === doc.root) return
        if (n.transform) out.push(n.transform)
        const up = chain[i + 1]
        if (up && up !== doc.root && up.copies?.length) out.push(up.copies[0])
    })
    return out
}

/**
 * What the overlay draws for a node, in world space: { node, origin }, `origin` being where the
 * node's transform puts its own origin -- where its label and its handles go.
 *
 * THE ROOT'S TRANSFORM IS NOT APPLIED. Codegen emits the root's children straight into SDF, never
 * the root's own block, so a transform on the root moves nothing in the picture and must not move
 * the handles either.
 */
export function selectionGeometry(doc, id) {
    const chain = lineage(doc, id)
    if (!chain.length) return null
    const frames = framesTo(doc, id)
    return { node: chain[0], origin: frames.reduce((q, t) => toParent(t, q), [0, 0, 0]) }
}

/**
 * HOW BIG THE SCENE IS, in its own units -- an ESTIMATE, for the renderer's automatic surface
 * tolerance (photometry.js autoEps: a share of this, never coarser than 1 mm). With every object a
 * code node there is no box to measure, but the tolerance only needs the order of magnitude, and a
 * scene's size is mostly where its objects are placed: the diagonal of the box around every object's
 * world position, each padded by its largest parameter times its world scale (a sphere's radius, a
 * box's half-size -- a guess that is right for the primitives and harmless otherwise: it can only
 * make the tolerance coarser, and that is capped). A light's face and a ray file's box are known.
 * Lights that do not draw (a ray file) still count: they are where the light is.
 *
 * It matters: a centimetre optics scene given a room's 1 mm tolerance lost its lens, and only
 * rendered with its unit set to metres. null for a scene with no objects: the renderer keeps 1 mm.
 */
export function sceneExtent(root) {
    const b = estimateBox(root)
    if (!b) return null
    const d = Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2])
    return d > 0 ? d : null
}

/** The same estimate as a world box { lo, hi } -- or null for a scene with no objects. Where the
 *  measured bounds (boxes.js) start looking: only a first guess, which they grow when an object
 *  reaches its edge. `only` (a node) restricts it to that node's own estimate. `doc`, when the
 *  nodes are the document's, is where their blocks are: which of their parameters are lengths. */
export function estimateBox(root, only = null, doc = null) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    const grow = (c, r) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], c[k] - r); hi[k] = Math.max(hi[k], c[k] + r) } }
    const size = n => {
        const P = n.params || {}
        if (n.type === 'light') {
            const L = n.light || {}
            if (L.shape === 'rectangle') return Math.hypot(P.width ?? 1, P.height ?? 1) / 2
            if (L.shape === 'disc') return P.radius ?? 0.5
            const b = L.box
            return b ? Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]) / 2 : 0
        }
        let m = 0, reach = 0, grow = 1
        /* ONLY ITS LENGTHS: the parameters its block says are lengths (model.js; a tree's node carries the list
           itself, toTree), when it says. The capped torus's angle of 270 (degrees) was taken for a size: its guess
           was 540 across for a ring of 0.42, so put in on the picture it stood 270 above the floor, out of view, the
           library framed it as a speck, and a double click framed it from far away. A block that lists none (code
           written by hand) is guessed from every number, as before. */
        const L = n.lengths ?? (doc ? blockOf(doc, n)?.lengths : null)
        const isLength = k => !L?.length || L.includes(k)
        /* a number a path's points name (expr.js) is where a point is -- counted in the path's reach below, and not
           again as a size swept along it: the bent tube's rise of 0.6 would have framed its picture twice as loose */
        const named = new Set(Object.values(P).flatMap(v => v && typeof v === 'object' && Array.isArray(v.path) ? pathNames(v) : []))
        for (const [k, v] of Object.entries(P)) {
            if (!isLength(k)) continue
            if (typeof v === 'number') { if (!named.has(k)) m = Math.max(m, Math.abs(v)) }
            /* a PATH's points ({ path }, model.js paramKind): how far the line goes, which its fillets' arcs stay
               inside. What is swept along it -- a radius, a profile's reach, the largest of the others -- is ADDED
               to that, not maxed with it: a tube of 0.1 along a path 1 out reaches 1.1 */
            else if (v && typeof v === 'object' && Array.isArray(v.path))          // its names read (expr.js), as drawn
                for (const pt of resolvePath(P, v).points) {
                    reach = Math.max(reach, Math.abs(pt[0]) || 0, Math.abs(pt[1]) || 0, Math.abs(pt[2]) || 0)
                    // a point's scale x and y (entries 5 and 6) make what is swept there that much bigger
                    grow = Math.max(grow, Math.abs(pt[4]) || 0, Math.abs(pt[5] ?? pt[4]) || 0)
                }
            /* a PROFILE's points (model.js paramKind): its reach from the origin, extruded in xy or revolved as
               (radius, z) -- one level down, as numbers, they would be missed and the guess too small */
            else if (Array.isArray(v) && v.length && v.every(Array.isArray))           // its names read too (expr.js)
                for (const pt of resolveProfile(P, v).points) m = Math.max(m, Math.abs(pt[0]) || 0, Math.abs(pt[1]) || 0)
            else if (v && typeof v === 'object') for (const c of Object.values(v)) if (typeof c === 'number') m = Math.max(m, Math.abs(c))
        }
        return reach + m * grow
    }
    const visit = (n, frames) => {
        const here = n !== root && n.transform ? [n.transform, ...frames] : frames
        // an export box is not in the picture, and a big one would make the tolerance coarse for nothing
        if (n.kind === 'object' && n.type !== 'export' && (!only || n === only)) {
            const toWorld = p => here.reduce((q, t) => toParent(t, q), p)
            const scale = here.reduce((s, t) => s * (t.scale ?? 1), 1)
            grow(toWorld([0, 0, 0]), size(n) * scale)
        }
        // an array's children at each of its copies (model.js version 17)
        for (const c of n.children || []) for (const k of n.copies?.length ? n.copies : [null]) visit(c, k ? [k, ...here] : here)
    }
    visit(root, [])
    return hi[0] >= lo[0] ? { lo, hi } : null
}
