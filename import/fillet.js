//======================================================================================================================
// FILLETS -- a CAD part's rounded edges found among its faces, each as the round join of the two faces it rounds
// (builder/joins.js, model version 27), instead of a cylinder or torus with the separators where it ends (csg.js).
//
// WHY (the user's Onshape part, 2026-11-04: "especially the fillets are difficult"). 62 of its 121 faces were 1 mm
// fillets, 34 cylinders and 28 tori. Each is a curved face that ends where the edge it rounds ends, and the formula needs
// separators -- planes through its axis, cones across a torus -- to tell where; the user's part had 52 of them, the cover
// 6650 cells to cover, and it came out as 235 shapes in 85 groups, in 29 s, with 6 of its check points disagreeing
// (measured, Node, the container). Left out, sampled around but not described (a prototype, the same day), the part was
// 51 shapes in 30 groups in 5 s. A fillet is not a surface of its own but the edge between two others, rounded: the
// round join of those two is exactly that (two planes, or a plane met squarely by a cylinder or a prism's side), one
// half-space with no ends to separate.
//
// A FILLET FACE (found here, from the B-rep alone):
//   - on a cylinder or a torus, its tube radius r;
//   - TANGENT ACROSS ITS EDGES to its neighbours: their outward normals the same as its own along the edge (to
//     TANGENT), at the edge's points;
//   - with exactly TWO SUPPORTS among those tangent neighbours: the faces either side of the edge it rounds, two
//     different surfaces. A tangent neighbour that is another fillet of the same radius is the next piece of its chain
//     (a cylinder along an edge, a torus round a corner), not a support. A neighbour a rounded rectangle claims
//     (csg.js roundedRects) is that prism; a neighbour that is itself a fillet (a 1 mm fillet along a 3 mm one) is that
//     fillet's compound, so larger fillets are settled first;
//   - CONVEX when the solid is inside its tube (the intersection of the supports' insides, rounded: 'and'), CONCAVE when
//     outside (their union, rounded: 'or').
// A face that is none of this -- a hole's wall, a boss, the bottom of a U-shaped slot between two parallel walls -- is
// left to the formula as before. And a face that seems one is CHECKED: the compound must be zero on the face's own
// points (to CHECK of the part's size), or the face is left as before and said (`kept`, with why). The supports' g are
// distances, the round join is exact where they meet squarely, and anything else -- curved supports met obliquely --
// is caught here.
//
//   fillets(B, claimed, { tol, scale })
//     B: brep.js's solid; claimed: csg.js's Map(face index -> { S, s }) of faces a rounded rectangle took
//     -> { found: [{ face, S (geom.js rounded), r, op }], kept: [{ face, why }] }
//======================================================================================================================

import { sub, dot, len, norm, mul, add, toLocal, toWorld, rounded, sameSurface } from './geom.js'
import { outward, mulberry } from './brep.js'

/** Outward normals that agree to this (1 - cos of the angle: 1e-3 is 2.6 degrees) are tangent. A CAD fillet is exact,
 *  so its normals agree to the file's precision; this is loose enough for an edge sampled as a polyline. */
export const TANGENT = 1e-3
/** How far off its face a fillet's compound may be, as a share of the part's size: 1e-5 is a micrometre on a 100 mm
 *  part. The round join of two planes is exact, so a true fillet is within rounding of zero. */
export const CHECK = 1e-5
/** ...and off its edges, which may be B-spline approximations of the curve they are (the check above says why) */
export const EDGE_CHECK = 1e-4

/* A RAIL: an edge along the fillet's length -- a line along a cylinder's axis (one angle round it), a circle of a
   torus's at one tube angle -- where it meets a face it rounds. Its other edges are its ENDS, where the next piece of a
   chain, or the fillet of another edge running into it, meets it: a 3 mm corner's 1 mm fillets at its top and bottom
   are tangent to it too, and are not what it rounds (the user's part: its U's mouth). */
const SPREAD = 1e-3            // radians: how far one rail's points may differ in the angle it keeps
export function isRail(S, pts) {
    if (pts.length < 2) return false
    const k = S.type === 'cylinder' ? 0 : 1
    const a = pts.map(p => S.uv(p)[k]), w = x => Math.atan2(Math.sin(x - a[0]), Math.cos(x - a[0]))
    return a.every(x => Math.abs(w(x)) < SPREAD)
}

/** Is a cylinder face one piece of a fillet chain: tangent at an end to a torus of its own tube radius (the piece round
 *  a corner)? Such cylinders are a fillet's, not a rounded rectangle's corners (csg.js roundedRects leaves them): the
 *  user's tray's 1 mm rim along its walls made rounded rectangles of their own, and its corner tori, touching three of
 *  those, were no fillet of two (2026-11-04). */
export function chained(B, i, owners = edgeOwners(B)) {
    const f = B.faces[i], S = f.surface
    if (S.type !== 'cylinder') return false
    for (const L of f.loops) for (const e of L.edges || []) {
        if (e.id == null) continue
        for (const o of owners.get(e.id) || []) {
            if (o.i === i) continue
            const g = B.faces[o.i]
            if (g.unsupported || g.surface.type !== 'torus' || Math.abs(g.surface.r - S.r) > 1e-9 * (1 + S.r)) continue
            const pts = inner(e.points)
            if (pts.length && pts.every(p => dot(outward(f, p), outward(g, p)) > 1 - TANGENT)) return true
        }
    }
    return false
}
/** edge id -> the faces that own it, [{ i, e }] */
export function edgeOwners(B) {
    const owners = new Map()
    B.faces.forEach((f, i) => { if (!f.unsupported) for (const L of f.loops) for (const e of L.edges || []) if (e.id != null) {
        if (!owners.has(e.id)) owners.set(e.id, [])
        owners.get(e.id).push({ i, e })
    } })
    return owners
}

/* an edge's interior points: its ends are corners, where three faces meet and none is the one across */
const inner = pts => pts.length > 2 ? pts.slice(1, -1) : pts.length === 2 ? [mul(add(pts[0], pts[1]), 0.5)] : pts

/* where a face's tube has its centre nearest p: a cylinder's axis, a torus's ring */
function tubeCentre(S, p) {
    const l = toLocal(S.F, p)
    if (S.type === 'cylinder') return toWorld(S.F, [0, 0, l[2]])
    const h = Math.hypot(l[0], l[1]) || 1
    return toWorld(S.F, [S.R * l[0] / h, S.R * l[1] / h, 0])
}

/** The fillets among B's faces, each as a geom.js `rounded` surface: see the header. */
export function fillets(B, claimed = new Map(), { tol = 1e-6, scale = B.scale ?? 1, seed = 31 } = {}) {
    const rnd = mulberry(seed)
    const faces = B.faces
    // which faces own each edge: two for every edge of a closed solid (a seam twice in one face)
    const owners = edgeOwners(B)
    const candidate = i => !faces[i].unsupported && !claimed.has(i) && (faces[i].surface.type === 'cylinder' || faces[i].surface.type === 'torus')
    const tubeR = i => faces[i].surface.r

    /* each candidate's tangent neighbours, across which of its edges */
    const neighbours = i => {
        const f = faces[i], out = []
        for (const L of f.loops) for (const e of L.edges || []) {
            if (e.id == null) continue
            const across = (owners.get(e.id) || []).filter(o => o.i !== i)
            if (!across.length) continue                     // a seam: the face itself on both sides
            const j = across[0].i, g = faces[j]
            if (g.unsupported) { out.push({ j, tangent: false }); continue }
            const pts = inner(e.points)
            const tangent = pts.length > 0 && pts.every(p => dot(outward(f, p), outward(g, p)) > 1 - TANGENT)
            out.push({ j, tangent, at: pts[0], rail: isRail(f.surface, e.points) })
        }
        return out
    }

    // a support's half-space: its claimed surface (a prism, or a fillet settled before) or its own, on the solid's side
    const settled = new Map()               // face index -> its compound, once found
    const supportOf = (j, p) => {
        const S = settled.get(j) ?? claimed.get(j)?.S ?? faces[j].surface
        const s = Math.sign(dot(outward(faces[j], p), S.grad(p))) || 1
        return { S, s }
    }

    // the larger fillets first: a small one runs along a large one, whose compound is then its support
    const order = faces.map((_, i) => i).filter(candidate).sort((a, b) => tubeR(b) - tubeR(a))
    const found = [], kept = []
    for (const i of order) {
        const f = faces[i], S = f.surface, r = S.r
        const nb = neighbours(i)
        const tangent = nb.filter(n => n.tangent)
        if (tangent.length < 2) continue                  // a hole's wall, a boss: not a fillet, nothing to say
        /* its supports: the faces tangent across its rails. Across its ends are the chain's next pieces and the fillets
           that run into it, neither of which it rounds */
        const sup = []
        for (const n of tangent.filter(n => n.rail)) {
            const h = supportOf(n.j, n.at)
            if (!sup.some(x => sameSurface(x.S, h.S, tol) * x.s === h.s)) sup.push({ ...h, j: n.j })
        }
        if (sup.length !== 2) {
            if (sup.length > 2) kept.push({ face: i, why: `${sup.length} faces tangent to it, not the two a fillet rounds` })
            continue
        }
        // convex: the solid inside its tube
        const p = f.sample(1, rnd)[0] ?? f.loops[0].points[0]
        const op = dot(outward(f, p), sub(p, tubeCentre(S, p))) > 0 ? 'and' : 'or'
        const C = rounded(sup[0].S, sup[0].s, sup[1].S, sup[1].s, r, op)
        /* CHECKED on its own face: points of the face itself, which are on its surface exactly, to CHECK; and its loops'
           points, to EDGE_CHECK -- an edge where a slot cuts the fillet is a B-spline in the file, an approximation of the
           true curve (the user's part: a thousandth of a millimetre off), so only a gross error is one there */
        const inside = f.sample(24, rnd), rim = f.loops.flatMap(l => l.points)
        const off = Math.max(0, ...inside.map(q => Math.abs(C.g(q)))), offRim = Math.max(0, ...rim.map(q => Math.abs(C.g(q))))
        if (!(off <= CHECK * scale) || !(offRim <= EDGE_CHECK * scale)) {
            kept.push({ face: i, why: `its supports' round join is ${+Math.max(off, offRim).toPrecision(2)} off its face` })
            continue
        }
        settled.set(i, C)
        found.push({ face: i, S: C, r, op })
    }
    return { found, kept }
}
