//======================================================================================================================
// A JOIN'S SHAPE, IN JAVASCRIPT (model version 27, `joinShape`): the twin of scene_api.js's csgRound* and csgChamfer*,
// line for line, on [nx, ny, nz, d] as the WGSL is on VEC4 (normal, distance). The import builds its fillets with it
// (import/fillet.js, geom.js `rounded`), import/test/docsdf.mjs mirrors the scene with it, and the tests hold the WGSL
// to it on Dawn (builder/test/roundjoin.gpu.mjs).
//
// THE ROUND JOIN IS A CIRCULAR FILLET, EXACT FOR TWO PLANES AT ANY ANGLE (derived, 2026-11-04). Two half-spaces a < 0
// and b < 0, unit normals na and nb, c = na . nb. The fillet of radius r is the circle tangent to both, its centre where
// a = b = -r. A point's offset w from that centre, in the plane of the two normals, has na . w = A = a + r and
// nb . w = B = b + r, so w = alpha na + beta nb with
//     alpha = (A - c B) / (1 - c^2),   beta = (B - c A) / (1 - c^2),
//     |w|^2 = (A^2 + B^2 - 2 c A B) / (1 - c^2).
// Where alpha and beta are both >= 0 the nearest point of the rounded solid's surface is on the arc, in the direction
// of w: the distance is |w| - r, outside and inside, and the normal is w / |w| -- analytic, no differences. Elsewhere
// it is a plane's: max(a, b), which meets |w| - r where alpha or beta is 0 (there |w| is the other's coordinate). At
// c = 0 this is hg_sdf's fOpIntersectionRound. It is just as exact for a plane meeting a cylinder, a cone or a prism's
// side squarely along a circle or a line -- the torus and rim fillets CAD makes -- because in the plane of the two
// normals both distances are a straight line's there. Between curved surfaces met obliquely it is an estimate; the
// import checks each fillet it makes against the solid's own faces before using it (csg.js), and the tests measure it.
//   The union is the intersection of the insides turned out: roundUnion(a, b) = -roundIntersect(-a, -b), normals and
// all. A missing normal (a shape that gives none, a zero vector) is taken as square (c = 0) and the result has none,
// as csgNormal does: the renderer then takes it by differences. Normals nearly parallel (|c| > 1 - 1e-4) meet in no
// edge worth rounding: the hard op.
//
// THE CHAMFER IS THE CHORD OF THAT FILLET: the plane through its two tangent lines, normal (na + nb) / |na + nb|, at
//     (A + B - r (1 + c)) / sqrt(2 + 2 c)
// from the point, and the result max(a, b, that) -- at c = 0, hg_sdf's fOpIntersectionChamfer, (a + b + r) / sqrt 2.
// So a Round and a Chamfer of one radius start and end at the same lines on the two faces.
//
// LIPSCHITZ: |w| - r and the chamfer's plane are distances (1-Lipschitz) for two planes; max keeps that. So the march's
// bound holds for planes and for the CAD cases above, exactly.
//======================================================================================================================

const PARALLEL = 1 - 1e-4

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const has = n => dot(n, n) >= 1e-12
const hard = (a, b) => (a[3] > b[3] ? a : b).slice()

/** The rounded intersection of a and b ([nx, ny, nz, d] each) with radius r. */
export function roundIntersect(a, b, r) {
    const both = has(a) && has(b)
    const c = both ? dot(a, b) : 0
    if (Math.abs(c) > PARALLEL) return hard(a, b)
    const s2 = 1 - c * c
    const A = a[3] + r, B = b[3] + r
    const al = (A - c * B) / s2, be = (B - c * A) / s2
    if (!(al > 0 && be > 0)) return hard(a, b)
    const w = Math.sqrt(Math.max(A * A + B * B - 2 * c * A * B, 0) / s2)
    let n = [0, 0, 0]
    if (both) {
        n = [al * a[0] + be * b[0], al * a[1] + be * b[1], al * a[2] + be * b[2]]
        const l = Math.hypot(...n)
        n = l > 1e-12 ? n.map(x => x / l) : [0, 0, 0]
    }
    return [...n, w - r]
}
const neg = v => v.map(x => -x)
/** The rounded union: the insides turned out, intersected, turned back. */
export const roundUnion = (a, b, r) => neg(roundIntersect(neg(a), neg(b), r))
/** a less b, rounded where b cuts it. */
export const roundSubtract = (a, b, r) => roundIntersect(a, neg(b), r)

/** The chamfered intersection: the chord of the round's arc, a plane of its own. */
export function chamferIntersect(a, b, r) {
    const both = has(a) && has(b)
    const c = both ? dot(a, b) : 0
    const h = hard(a, b)
    if (Math.abs(c) > PARALLEL) return h
    const k = Math.sqrt(2 + 2 * c)
    const d = (a[3] + b[3] + 2 * r - r * (1 + c)) / k
    if (d <= h[3]) return h
    return both ? [(a[0] + b[0]) / k, (a[1] + b[1]) / k, (a[2] + b[2]) / k, d] : [0, 0, 0, d]
}
export const chamferUnion = (a, b, r) => neg(chamferIntersect(neg(a), neg(b), r))
export const chamferSubtract = (a, b, r) => chamferIntersect(a, neg(b), r)

/** The join of `b` into `a` by op and shape, at radius (blend) r: the twin of codegen's call. 'smooth' is not here --
 *  the polynomial blend is csgUnion's, and docsdf.mjs has its own twin of it. */
export function joinShaped(op, shape, a, b, r) {
    const f = { round: { union: roundUnion, subtract: roundSubtract, intersect: roundIntersect },
                chamfer: { union: chamferUnion, subtract: chamferSubtract, intersect: chamferIntersect } }[shape]?.[op]
    if (!f) throw new Error(`no join ${shape} ${op}`)
    return f(a, b, r)
}
