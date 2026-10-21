//======================================================================================================================
// THE SCENE DOCUMENT'S DISTANCE, IN JAVASCRIPT: what an imported part's nodes compute, as the shader computes them --
// each node's transform (builder/transform.js matrixOf, read as scene_api.js xfPoint reads it: the point into the node's
// frame, the distance out of it by its scale), each preset's own distance (core/sdf.js, written again here), and a
// group's children as codegen combines them: a CSG group's (codegen.js isCsg) folded top to bottom by their joins (union
// min, intersect max, subtract max(C, -d): scene_api.js csgUnion and the rest at blend 0) -- and a plain group's that
// is one of such a group's shapes, as a union (codegen.js combinedGroups, 0.next) -- ANY OTHER PLAIN GROUP'S BY THE
// NEAREST BOUNDARY EITHER WAY (scene_api.js fold, the surface's argmin |d|), which is no union's distance: inside one
// of two boxes and just outside the other, it is the other's, outside. The rounded box marched on Dawn went through
// its own edges that way, its core a plain group intersected with its prisms (import.gpu.mjs, 2026-10-21), while this
// file, taking every union as a min, saw nothing; codegen folded such a group then, and combines it since 0.next.
//
// WHY: shapes.js's own shapeSDF evaluates the shapes it made, not the document it wrote; an Euler angle, a cap or a
// join that went wrong on the way into the document showed nowhere before the picture (the user's Onshape part,
// 2026-10-21). This is the document's side, held to OpenCascade's classification by the tests.
//======================================================================================================================
import { matrixOf } from '../../builder/transform.js'
import { isCsg } from '../../builder/codegen.js'
import { PRIMITIVES } from '../../builder/primitives.js'
import { CONE_CODE, RRECT_CODE } from '../shapes.js'

const len2 = (x, y) => Math.hypot(x, y)
const PRESETS = new Map([
    [PRIMITIVES.sphere.code, (q, P) => Math.hypot(...q) - P.radius],
    [PRIMITIVES.box.code, (q, P) => {
        const b = [P.size.x, P.size.y, P.size.z], rr = Math.min(Math.max(P.rounding, 0), Math.min(...b))
        const d = q.map((x, k) => Math.abs(x) - (b[k] - rr))
        return Math.hypot(...d.map(x => Math.max(x, 0))) + Math.min(Math.max(...d), 0) - rr
    }],
    [PRIMITIVES.cylinder.code, (q, P) => {
        const d = [len2(q[0], q[1]) - P.radius, Math.abs(q[2]) - 0.5 * P.height]
        return Math.min(Math.max(d[0], d[1]), 0) + len2(Math.max(d[0], 0), Math.max(d[1], 0))
    }],
    [PRIMITIVES.torus.code, (q, P) => len2(len2(q[0], q[1]) - P.ring, q[2]) - P.tube],
    [PRIMITIVES.plane.code, q => q[2]],
    [RRECT_CODE, (q, P) => {
        const a = Math.abs(q[0]) - (P.size.x - P.radius), b = Math.abs(q[1]) - (P.size.y - P.radius)
        const side = len2(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0) - P.radius, cap = Math.abs(q[2]) - 0.5 * P.height
        return Math.min(Math.max(side, cap), 0) + len2(Math.max(side, 0), Math.max(cap, 0))
    }],
    [CONE_CODE, (q, P) => {
        const k = (P.top - P.base) / P.height, c = 1 / Math.sqrt(1 + k * k)
        const side = (len2(q[0], q[1]) - (0.5 * (P.base + P.top) + k * q[2])) * c
        return Math.max(side, Math.abs(q[2]) - 0.5 * P.height)
    }],
])

/** The distance of a document node (a part's group, as an asset holds it) at a point of its parent's frame. `blocks`:
 *  the asset's or document's blocks, by which an object's code is found. `shape`: the node is one of a combining
 *  group's shapes (combinedGroups), so a plain group combines its own as a union. */
export function nodeSDF(n, p, blocks, shape = false) {
    const m = matrixOf(n.transform), s = m[15]
    const d = [p[0] - m[12], p[1] - m[13], p[2] - m[14]]
    const q = [0, 1, 2].map(c => (d[0] * m[4 * c] + d[1] * m[4 * c + 1] + d[2] * m[4 * c + 2]) / s)
    if (n.kind === 'object') {
        const code = blocks.find(b => b.id === n.block)?.code
        const f = PRESETS.get(code)
        if (!f) throw new Error(`docsdf: no distance written for the code of '${n.label}'`)
        return f(q, n.params) * s
    }
    let C = null
    const csg = isCsg(n) || shape
    for (const c of n.children.filter(c => c.enabled !== false)) {
        const v = nodeSDF(c, q, blocks, csg)
        if (C === null) { C = v; continue }
        if (!csg) { if (Math.abs(v) < Math.abs(C)) C = v; continue }
        const join = c.join ?? 'union'
        C = join === 'union' ? Math.min(C, v) : join === 'intersect' ? Math.max(C, v) : Math.max(C, -v)
    }
    return (C ?? Infinity) * s
}
