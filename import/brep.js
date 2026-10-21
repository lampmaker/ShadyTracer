//======================================================================================================================
// BREP -- a solid's faces as regions of their surfaces, and the one question the conversion asks of the solid: is
// this point inside it?
//
// A FACE is the part of its surface inside its loops. Its loops come from step.js as points in 3D, in the order the
// loop runs; here they are mapped into the surface's (u, v) (geom.js), unwrapped where u (and a torus's v) goes round,
// and a point of the surface is in the face when it is inside them there. Two ways to decide that:
//   PARITY, for the plane, the cylinder and the cone: count the loops' crossings on a line from the point along +v,
//     which runs to infinity in a direction that does not go round (v is along the axis). Odd is inside. It needs no
//     orientation, so it cannot be fooled by a loop that runs the wrong way.
//   THE NEAREST BOUNDARY POINT, for the sphere and the torus, where +v ends at a pole or comes back round: the face is
//     on one side of each of its loops in (u, v), and nothing lies between a point and the boundary point nearest it,
//     so which side of that boundary the point is on says whether it is in the face. (A ray to the first crossing was
//     tried first; on a sphere's corner patch, whose meridian and latitude may both miss its loop, it had no answer.)
//
// WHICH SIDE IS NOT TAKEN FROM THE FILE. ISO 10303-42 says the face is on the left of its loops seen from its normal,
// which is the surface's when same_sense. OpenCascade 7.9's own export breaks that for a torus whose axis it flipped
// to make the frame right-handed (the boss fixture's inner fillet, found 2026-10-21: its loop has the face on the
// right): read by the rule, the fillet was the other three quarters of the tube. So a sphere's or a torus's face takes
// its side from a NEIGHBOUR: at an edge it shares with a face whose containment needs no orientation (or one already
// settled), the neighbour's own side of the edge is found by testing, and the face is on the other side of the edge
// -- straight across it where the two are tangent (a fillet), and otherwise on the side the two outward normals
// agree on (resolveSides). The rule is only the fallback, said in `guessed`, for a face with no settled neighbour.
// All of it is held against OpenCascade's own solid classifier in import/test/brep.test.mjs, on every fixture.
//
// INSIDE THE SOLID is parity again, in 3D: rays from the point, each surface they meet counted where the face is. Three
// rays in fixed directions that no CAD part lines up with, and the majority, so a ray through an edge (counted twice
// or not at all) is outvoted. Exact surfaces, not a tessellation: a point a micrometre off a curved face is still
// on its right side.
//
//   const B = brep(solid)          // solid: step.js's
//   B.inside(p)                     // true | false
//   B.faces[i].contains(p)          // p on the face's surface: inside its loops?
//   B.faces[i].sample(n, rnd)       // points on the face
//   B.box                           // { lo, hi } of the faces
//   B.unsupported                   // faces on surfaces this cannot evaluate (a B-spline...): inside() refuses
//   B.guessed                       // faces whose side was taken from the file's orientation alone
//======================================================================================================================

import { add, sub, mul, dot, len, norm, cross, wrap } from './geom.js'

const onAxis = (S, p) => {
    const l = sub(p, S.F.o)
    return Math.hypot(dot(l, S.F.x), dot(l, S.F.y)) < 1e-9 * (1 + len(l))
}

/** A loop's segments in a surface's (u, v): its points mapped and unwrapped so each periodic coordinate runs on
 *  without jumps, every segment tagged with the edge it is part of.
 *  A POINT ON THE AXIS -- a sphere's pole, a cone's apex -- has no angle of its own, and the loop turns there: it
 *  becomes two points, one at the angle the loop arrives from and one at the angle it leaves by, so the pole is a
 *  stretch of the line v = +-90 degrees between them, which is what it is in (u, v). That stretch is tagged 'pole'. */
function paramSegments(S, loop) {
    const pts = [], tag = []                           // tag[j]: the edge of the segment from point j to j + 1
    const edges = loop.edges?.length ? loop.edges : [{ id: null, points: loop.points }]
    edges.forEach((e, k) => {
        const P = pts.length ? e.points.slice(1) : e.points
        if (pts.length) tag[pts.length - 1] = k
        for (let i = 0; i < P.length; i++) { pts.push(P[i]); tag.push(k) }
    })
    if (pts.length > 1 && len(sub(pts[0], pts[pts.length - 1])) < 1e-9 * (1 + len(pts[0]))) { pts.pop(); tag.pop() }
    tag[pts.length - 1] = edges.length - 1           // the closing segment is the last edge's
    const raw = pts.map(p => S.uv(p))
    let uv = [], tg = []
    const axis = S.periodicU ? pts.map(p => onAxis(S, p)) : pts.map(() => false), n = pts.length
    for (let i = 0; i < n; i++) {
        if (!axis[i]) { uv.push(raw[i].slice()); tg.push(tag[i]); continue }
        let a = 1, b = 1
        while (a < n && axis[(i - a + n) % n]) a++
        while (b < n && axis[(i + b) % n]) b++
        if (a >= n) { uv.push(raw[i].slice()); tg.push(tag[i]); continue }
        uv.push([raw[(i - a + n) % n][0], raw[i][1]], [raw[(i + b) % n][0], raw[i][1]])
        tg.push('pole', tag[i])
    }
    for (let i = 1; i < uv.length; i++) {
        if (S.periodicU) uv[i][0] = uv[i - 1][0] + wrap(uv[i][0] - uv[i - 1][0])
        if (S.periodicV) uv[i][1] = uv[i - 1][1] + wrap(uv[i][1] - uv[i - 1][1])
    }
    const segs = []
    for (let i = 0; i < uv.length; i++) {
        const t = tg[i]
        segs.push({ a: uv[i], b: uv[(i + 1) % uv.length], edge: t === 'pole' ? 'pole' : edges[t]?.id ?? null })
    }
    return { points: uv, segs }
}

export function makeFace(f) {
    const S = f.surface
    if (S.unsupported) return { ...f, unsupported: true, contains: () => false, insideUV: () => false, sample: () => [] }
    const mapped = f.loops.filter(l => l.points.length > 1).map(l => paramSegments(S, l))
    const loops = mapped.map(m => m.points)
    /* A SEAM is an edge a face runs twice, once each way: where a periodic surface is cut to be given a boundary (a
       cylinder's side, the lens's cap from its rim to its pole). The face goes on across it, so it is no boundary. The
       rest are chained by their ends -- across a coordinate that goes round, an end at 2 pi meets one at 0 -- so a
       vertex knows the segments that meet there. */
    const seam = id => { let n = 0; for (const L of f.loops) for (const e of L.edges || []) if (e.id === id) n++; return n > 1 }
    const segs = []
    for (const m of mapped) for (const sg of m.segs)
        if (!(sg.edge != null && sg.edge !== 'pole' && seam(sg.edge)) && Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) > 1e-12) segs.push(sg)
    const same = (p, q) => {
        const du = S.periodicU ? wrap(p[0] - q[0]) : p[0] - q[0], dv = S.periodicV ? wrap(p[1] - q[1]) : p[1] - q[1]
        return Math.hypot(du, dv) < 1e-9
    }
    segs.forEach((sg, i) => {
        sg.next = same(segs[(i + 1) % segs.length].a, sg.b) ? (i + 1) % segs.length : segs.findIndex(o => same(o.a, sg.b))
        sg.prev = same(segs[(i - 1 + segs.length) % segs.length].b, sg.a) ? (i - 1 + segs.length) % segs.length : segs.findIndex(o => same(o.b, sg.a))
    })
    const byOrientation = S.type === 'sphere' || S.type === 'torus'
    const face = { ...f, uvLoops: loops, unsupported: false, byOrientation,
                   // +1: the face is on the left of its loops in (u, v); set by resolveSides, the file's rule until then
                   uvLeft: f.sense ? 1 : -1 }

    /* PARITY: the loops' crossings on the line from (u, v) along +v, beyond it. Along u, which may go round, each
       segment is placed beside the point (its start within half a turn) */
    const parity = (u, v) => {
        let n = 0
        for (const { a, b } of segs) {
            const da = S.periodicU ? wrap(a[0] - u) : a[0] - u
            const db = da + (S.periodicU ? wrap(b[0] - a[0]) : b[0] - a[0])
            if (!((da <= 0 && 0 < db) || (db <= 0 && 0 < da))) continue
            if (a[1] + (-da / (db - da)) * (b[1] - a[1]) > v) n++
        }
        return n % 2 === 1
    }
    /* THE NEAREST BOUNDARY POINT: no boundary is nearer than it, so nothing lies between it and the point, and the
       point's side of the segment there is its side of the face. At a vertex, both segments meeting there decide: a
       corner turning towards the face has it on the face's side of both, one turning away on the side of either. */
    const place = ({ a, b }, u, v) => {
        const au = S.periodicU ? wrap(a[0] - u) : a[0] - u, av = S.periodicV ? wrap(a[1] - v) : a[1] - v
        return [au, av, au + (S.periodicU ? wrap(b[0] - a[0]) : b[0] - a[0]), av + (S.periodicV ? wrap(b[1] - a[1]) : b[1] - a[1])]
    }
    const leftOf = ([au, av, bu, bv]) => (bu - au) * (-av) - (bv - av) * (-au)      // > 0: the point is on its left
    const nearest = (u, v) => {
        let best = null
        segs.forEach((sg, i) => {
            const [au, av, bu, bv] = place(sg, u, v), du = bu - au, dv = bv - av
            const t = Math.min(1, Math.max(0, -(au * du + av * dv) / (du * du + dv * dv)))
            const d = (au + t * du) ** 2 + (av + t * dv) ** 2
            if (!best || d < best.d) best = { d, i, t }
        })
        const want = face.uvLeft > 0 ? 1 : -1, sideOf = sg => Math.sign(leftOf(place(sg, u, v))) * want > 0
        const sg = segs[best.i]
        if (best.t > 1e-9 && best.t < 1 - 1e-9) return sideOf(sg)
        const s1 = best.t <= 1e-9 ? segs[sg.prev] ?? sg : sg, s2 = best.t <= 1e-9 ? sg : segs[sg.next] ?? sg
        const p1 = place(s1, u, v), p2 = place(s2, u, v)
        const turn = ((p1[2] - p1[0]) * (p2[3] - p2[1]) - (p1[3] - p1[1]) * (p2[2] - p2[0])) * want
        return turn > 0 ? sideOf(s1) && sideOf(s2) : sideOf(s1) || sideOf(s2)
    }
    const insideUV = (u, v) => !segs.length || (byOrientation ? nearest(u, v) : parity(u, v))
    const contains = p => { const [u, v] = S.uv(p); return insideUV(u, v) }

    // where to sample: the loops' extent, all the way round where a coordinate goes round, a sphere pole to pole
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity]
    for (const L of loops) for (const [u, v] of L) { lo = [Math.min(lo[0], u), Math.min(lo[1], v)]; hi = [Math.max(hi[0], u), Math.max(hi[1], v)] }
    if (S.periodicU) { lo[0] = -Math.PI; hi[0] = Math.PI }
    if (S.periodicV) { lo[1] = -Math.PI; hi[1] = Math.PI }
    if (S.type === 'sphere') { lo[1] = -Math.PI / 2; hi[1] = Math.PI / 2 }
    if (!segs.length && !S.periodicU) { lo = [-1, -1]; hi = [1, 1] }
    const sample = (n, rnd) => {
        const out = []
        for (let k = 0; k < n * 60 && out.length < n; k++) {
            const u = lo[0] + (hi[0] - lo[0]) * rnd(), v = lo[1] + (hi[1] - lo[1]) * rnd()
            if (insideUV(u, v)) out.push(S.at(u, v))
        }
        return out
    }
    return Object.assign(face, { contains, insideUV, sample, uvBox: { lo, hi } })
}

/** The face's outward normal at a point of its surface: the surface's, turned round unless same_sense. */
export const outward = (f, p) => { const g = f.surface.grad(p); return f.sense ? g : mul(g, -1) }

/* SETTLE WHICH SIDE OF ITS LOOPS EACH SPHERE AND TORUS FACE IS ON (the header says why). At the middle of an edge
   shared with a settled face B: t the edge's direction as this face runs it, n its outward normal, m = n x t the
   direction across the edge that the file's rule calls inward; b the direction across the edge into B, found by
   asking B. Tangent faces (a fillet meeting what it rounds): this face goes on straight across the edge, a = -b.
   Otherwise the solid's wedge between the two faces is on the inner side of both, which puts a on the side of B's
   normal that b is of this one's: sign(a . nB) = sign(b . n). Whether a is m says whether the file's rule holds. */
function resolveSides(faces, scale) {
    const owners = new Map()
    faces.forEach((f, i) => { if (!f.unsupported) for (const L of f.loops) for (const e of L.edges || []) if (e.id != null) {
        if (!owners.has(e.id)) owners.set(e.id, [])
        owners.get(e.id).push({ i, e })
    } })
    const settled = faces.map(f => !f.unsupported && !f.byOrientation)
    const guessed = []
    let progress = true
    while (progress) {
        progress = false
        faces.forEach((f, i) => {
            if (settled[i] || f.unsupported) return
            for (const L of f.loops) for (const e of L.edges || []) {
                if (settled[i] || e.points.length < 2) continue
                const other = (owners.get(e.id) || []).find(o => o.i !== i && settled[o.i])
                if (!other) continue
                const B = faces[other.i]
                const k = Math.floor((e.points.length - 1) / 2)
                const p = e.points.length === 2 ? mul(add(e.points[0], e.points[1]), 0.5) : e.points[k]
                const t = norm(sub(e.points[Math.min(k + 1, e.points.length - 1)], e.points[Math.max(k - 1, 0)]))
                const n = outward(f, p), nB = outward(B, p)
                const m = norm(cross(n, t))
                const across = norm(cross(nB, t))
                const eps = 1e-4 * scale
                const b = B.contains(add(p, mul(across, eps))) ? across : B.contains(add(p, mul(across, -eps))) ? mul(across, -1) : null
                if (!b) continue
                const bn = dot(b, n)
                const isM = Math.abs(bn) < 0.02 ? dot(m, b) < 0 : Math.sign(dot(m, nB)) === Math.sign(bn)
                f.uvLeft = (isM ? 1 : -1) * (f.sense ? 1 : -1)
                settled[i] = true
                progress = true
            }
        })
    }
    faces.forEach((f, i) => { if (!settled[i] && !f.unsupported) guessed.push(f) })
    return guessed
}

/* three ray directions no part lines up with: irrational components, none along an axis or a diagonal */
const RAYS = [norm([0.5773, 0.6124, 0.5402]), norm([-0.7071, 0.3157, 0.6324]), norm([0.2142, -0.8813, 0.4211])]

export function brep(solid) {
    const faces = solid.faces.map(makeFace)
    const unsupported = faces.filter(f => f.unsupported)
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    const grow = p => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]) } }
    for (const f of solid.faces) for (const l of f.loops) for (const p of l.points) grow(p)
    const scale = Math.max(1e-9, len(sub(hi, lo)))
    const guessed = resolveSides(faces, scale)
    // a face whose surface bulges past its loops (a sphere's cap, a torus's outside) reaches beyond their box
    for (const f of faces) if (!f.unsupported) for (const p of f.sample(64, mulberry(f.id))) grow(p)
    const count = (p, d) => {
        let n = 0
        for (const f of faces) {
            if (f.unsupported) continue
            for (const t of f.surface.hits(p, d)) if (f.contains(add(p, mul(d, t)))) n++
        }
        return n
    }
    const inside = p => {
        if (unsupported.length) throw new Error(`the solid has ${unsupported.length} face(s) on surfaces this cannot evaluate`)
        let votes = 0
        for (const d of RAYS) votes += count(p, d) % 2
        return votes >= 2
    }
    return { name: solid.name, faces, unsupported, guessed, inside, box: { lo, hi }, scale }
}

/** A small seeded generator, so a conversion is the same every time it runs. */
export function mulberry(seed) {
    let a = (seed >>> 0) || 1
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
