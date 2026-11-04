//======================================================================================================================
// A JOIN'S SHAPE, IN JAVASCRIPT (model version 27, `joinShape`): the twin of scene_api.js's csgRound* and csgChamfer*,
// line for line, on [nx, ny, nz, d] as the WGSL is on VEC4 (normal, distance). The import builds its fillets with it
// (import/fillet.js, geom.js `rounded`), import/test/docsdf.mjs mirrors the scene with it, and the tests hold the WGSL
// to it on Dawn (builder/test/roundjoin.gpu.mjs).
//
// THE ROUND JOIN (hg_sdf's fOpIntersectionRound). Two half-spaces a < 0 and b < 0 and a radius r: with A = a + r and
// B = b + r, where both are positive the distance is sqrt(A^2 + B^2) - r, and elsewhere the hard op, max(a, b) -- the
// two meeting where A or B is 0. Where the two meet at a RIGHT ANGLE, (A, B) are a point's coordinates from the circle's
// centre, so the corner is a circle of radius r, tangent to both, and the value its exact distance: two planes, or a
// plane across a cylinder or a prism's side, which is the fillet CAD makes (the import checks each fillet's against its
// own face before using it: fillet.js). At other angles the corner is rounded but not a circle. The normal is the
// gradient, (A na + B nb) normalised; with either side's missing there is none (csgNormal's rule), and the renderer
// takes it by differences.
//   THE DISTANCE NEVER READS THE NORMALS (2026-11-04). It did: the angle between them, c = na . nb, made the corner an
// exact circle at any angle. But the renderer marches, and casts every ray that leaves a surface, in the distance-only
// build (scene_api.js FOLD_DIST), whose shapes carry no normal -- each C.s.xyz there is emptyHit's (0, 0, 1) -- and the
// join read "parallel" and was the hard op. The march stopped on the sharp corner, the shading (the full build) found
// that point inside the fillet, and every path from it started inside the solid: the user's fillets black in every
// mode. Two builds of one scene must give one distance, so it is the two distances' alone.
//   LIPSCHITZ: at a right angle and sharper (c <= 0) the gradient is at most 1, a bound safe to march; at an obtuse
// edge (c > 0, the faces more than 90 degrees apart inside) it is up to sqrt(1 + c) steep, as hg_sdf's is -- but only
// within the cap (ROUND_CAP below) of the hard op, so never more than that over.
//   The union is the intersection of the insides turned out: roundUnion(a, b) = -roundIntersect(-a, -b), normals and
// all.
//
// THE CHAMFER: max(a, b, (a + b + r) / sqrt 2) -- at a right angle the plane through the round's two tangent lines, its
// normal (na + nb) normalised. So a Round and a Chamfer of one radius start and end at the same lines on the faces.
//======================================================================================================================

/* THE CAPS, FADING: how far over the hard op h the round and the chamfer may go -- the most each ever adds where h <= 0
   (the fillet, the air it cuts away and the solid), at the sharp corner: (sqrt 2 - 1) r and r / sqrt 2, so there each is
   exact -- fading to nothing as h goes to 2 r: beyond, the hard op, a lower bound. Faded on h itself, the capped value
   h (1 - most/2) + most r is never steeper than h (fading on min(A, B) instead made it 1.17 steep at a 60 degree edge).
   Uncapped, the round read 0.48 mm over the true distance 6.4 mm out on the user's part, where its two sides were a box's
   and a prism's far from their faces and no longer met squarely (OpenCascade, 2026-11-04). The WGSL's csgShapedCap is
   this. */
export const ROUND_CAP = Math.SQRT2 - 1, CHAMFER_CAP = Math.SQRT1_2
export const capOf = (h, r, most) => most * r * Math.min(1, Math.max(0, 1 - 0.5 * h / Math.max(r, 1e-30)))
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const has = n => dot(n, n) >= 1e-12
const hard = (a, b) => (a[3] > b[3] ? a : b).slice()
const unit = (n, ok) => { const l = Math.hypot(...n); return ok && l > 1e-12 ? n.map(x => x / l) : [0, 0, 0] }

/** The rounded intersection of a and b ([nx, ny, nz, d] each) with radius r. */
export function roundIntersect(a, b, r) {
    const h = hard(a, b)
    const A = a[3] + r, B = b[3] + r
    if (!(A > 0 && B > 0)) return h
    const d = Math.hypot(A, B) - r
    const cap = capOf(h[3], r, ROUND_CAP)
    if (d - h[3] >= cap) return [...unit(h.slice(0, 3), has(a) && has(b)), h[3] + cap]
    const n = [0, 1, 2].map(k => A * a[k] + B * b[k])
    return [...unit(n, has(a) && has(b)), d]
}
const neg = v => v.map(x => -x)
/** The rounded union: the insides turned out, intersected, turned back. */
export const roundUnion = (a, b, r) => neg(roundIntersect(neg(a), neg(b), r))
/** a less b, rounded where b cuts it. */
export const roundSubtract = (a, b, r) => roundIntersect(a, neg(b), r)

/** The chamfered intersection: the plane at equal setback from both faces, a plane of its own. */
export function chamferIntersect(a, b, r) {
    const h = hard(a, b)
    const d = (a[3] + b[3] + r) * Math.SQRT1_2
    if (d <= h[3]) return h
    const cap = capOf(h[3], r, CHAMFER_CAP)
    if (d - h[3] >= cap) return [...unit(h.slice(0, 3), has(a) && has(b)), h[3] + cap]
    return [...unit([0, 1, 2].map(k => a[k] + b[k]), has(a) && has(b)), d]
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
