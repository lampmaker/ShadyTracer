//======================================================================================================================
// FREEFORM FACES -- a face on a B-spline surface (or a curve extruded) given the regular surface that fits it best: a
// plane, sphere, cylinder, cone or torus, and how far off that is (the user, 2026-11-04: "when importing and certain
// surfaces fail, is it possible to import the rest anyway? Or import the surfaces but relax the error and indicate those
// surfaces with a different (red) material? Maybe propose a max error (surface deviation) that would make it possible
// to fit with regular shapes").
//
// TWO KINDS OF FREEFORM FACE, one way through:
//   - A REGULAR SURFACE WRITTEN AS A B-SPLINE: some exporters write every face so (a plane, a cylinder as NURBS). Its
//     fit is exact, to the file's precision: it is that surface, and the import goes on as if the file had said so.
//   - A SURFACE THAT IS TRULY FREEFORM: the nearest regular surface is some distance off. Within the deviation allowed
//     (the import dialog's, MAX_DEVIATION by default) the face takes it and is APPROXIMATED -- the part comes in, that
//     face's shapes red (shapes.js, asset.js) so it shows where the import is not exact; beyond it the solid is refused,
//     saying the deviation it would import at, which the dialog offers.
// Nothing here makes a freeform shape: the renderer has none to make. A solid of freeform faces fitting nothing is
// still the grid route's (roadmap/IMPORT.md sections 3-5, not built).
//
// THE FACE'S POINTS: its loops' points (on its edges, exact), mapped to the surface's (u, v) by Newton from the nearest
// of a grid; inside them, a grid of (u, v) kept by parity, evaluated; the normal du x dv at each. A surface closed on
// itself (a NURBS cylinder) has loops running along its seam, which parity in (u, v) cannot read: then the whole
// domain is sampled, which for such a face is what it covers.
//
// THE DEVIATION is the largest |g| of the fitted surface over those points -- the distance off it, as g is a distance
// (geom.js) -- in the part's millimetres.
//
//   fitFace(face, { exact })  face: step.js's, its surface evaluable (geom.js bsplineSurface, extrusionSurface)
//     -> { surface (geom.js), deviation, sense } | null (nothing fits: too few points, a fitter refused)
//======================================================================================================================

import { add, sub, mul, dot, cross, len, norm, frame, plane, sameSurface } from './geom.js'
import { eigen, fitSphere, fitCylinder, fitCone, fitTorus } from './fit.js'

/* where on the surface is q: (u, v) by Gauss-Newton from the nearest of a grid's points, the ends held */
function invert(S, q, grid) {
    let best = grid[0], bd = Infinity
    for (const g of grid) { const d = len(sub(g.p, q)); if (d < bd) { bd = d; best = g } }
    let [u, v] = best.uv
    const span = [S.uHi - S.uLo, S.vHi - S.vLo]
    for (let it = 0; it < 20; it++) {
        const p = S.at(u, v), r = sub(p, q)
        const hu = 1e-7 * span[0], hv = 1e-7 * span[1]
        const du = mul(sub(S.at(u + hu, v), S.at(u - hu, v)), 1 / (2 * hu)), dv = mul(sub(S.at(u, v + hv), S.at(u, v - hv)), 1 / (2 * hv))
        const a = dot(du, du), b = dot(du, dv), c = dot(dv, dv), e = -dot(r, du), f = -dot(r, dv), det = a * c - b * b
        if (Math.abs(det) < 1e-30) break
        const su = (e * c - b * f) / det, sv = (a * f - b * e) / det
        u = Math.min(Math.max(u + su, S.uLo), S.uHi); v = Math.min(Math.max(v + sv, S.vLo), S.vHi)
        if (Math.abs(su) < 1e-12 * span[0] && Math.abs(sv) < 1e-12 * span[1]) break
    }
    return [u, v]
}
/* (u, v) inside the loops, by parity: crossings of a line toward +v */
function insideUV(polys, u, v) {
    let n = 0
    for (const P of polys) for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length]
        if ((a[0] > u) !== (b[0] > u)) { const t = (u - a[0]) / (b[0] - a[0]); if (a[1] + t * (b[1] - a[1]) > v) n++ }
    }
    return n % 2 === 1
}

/** Points on the face with their normals (du x dv, the face's own way round when same_sense): see the header. */
export function facePoints(face, n = 24) {
    const S0 = face.surface
    const rim = face.loops.flatMap(l => l.points)
    if (!rim.length) return null
    let S = S0
    // an extrusion's v has no ends: the loops' own, along the vector, with a margin
    if (!Number.isFinite(S.vLo) || !Number.isFinite(S.vHi)) {
        const d = S0.d, dd = dot(d, d), base = S0.at(S0.uLo, 0)
        const vs = rim.map(p => dot(sub(p, base), d) / dd)
        const lo = Math.min(...vs), hi = Math.max(...vs), m = 0.05 * (hi - lo || 1)
        S = { ...S0, vLo: lo - m, vHi: hi + m }
    }
    const grid = []
    for (let i = 0; i <= 32; i++) for (let j = 0; j <= 32; j++) {
        const uv = [S.uLo + (S.uHi - S.uLo) * i / 32, S.vLo + (S.vHi - S.vLo) * j / 32]
        grid.push({ uv, p: S.at(...uv) })
    }
    const polys = face.loops.filter(l => l.points.length > 2).map(l => l.points.map(q => invert(S, q, grid)))
    const pts = [], uvs = []
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const u = S.uLo + (S.uHi - S.uLo) * (i + 0.5) / n, v = S.vLo + (S.vHi - S.vLo) * (j + 0.5) / n
        if (insideUV(polys, u, v)) { uvs.push([u, v]); pts.push(S.at(u, v)) }
    }
    // too few inside: a surface closed on itself, its loops along the seam -- the whole domain is the face
    if (pts.length < 8) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const uv = [S.uLo + (S.uHi - S.uLo) * (i + 0.5) / n, S.vLo + (S.vHi - S.vLo) * (j + 0.5) / n]
        uvs.push(uv); pts.push(S.at(...uv))
    }
    const normals = uvs.map(uv => S.normal(...uv))
    return { inner: pts, normals, rim }
}

/* the plane through points: their mean, the direction they spread least along */
function fitPlane(P) {
    const c = mul(P.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / P.length)
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for (const p of P) { const d = sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += d[i] * d[j] }
    return plane(frame(c, norm(eigen(M).vectors[0])))
}
/* the simplest first, so a tie (a plane is a sphere of infinite radius, nearly) goes to it */
const FITTERS = [
    ['plane', (P) => fitPlane(P)],
    ['sphere', (P) => fitSphere(P)],
    ['cylinder', (P, N) => fitCylinder(P, N)],
    ['cone', (P, N) => fitCone(P, P.map((c, i) => ({ c, n: N[i] })))],
    ['torus', (P, N) => fitTorus(P, P.map((c, i) => ({ c, n: N[i] })))],
]

/** The regular surface fitting the face best: the simplest within `exact` (mm: the file's precision, as csg.js's tol),
 *  else the nearest; its deviation; and `sense`, whether its g grows the way the face's outward normal points. */
export function fitFace(face, { exact = 1e-6 } = {}) {
    const F = facePoints(face)
    if (!F || F.inner.length + F.rim.length < 8) return null
    const P = [...F.inner, ...F.rim]
    let best = null
    for (const [, fit] of FITTERS) {
        let S = null
        try { S = fit(F.inner.length >= 8 ? F.inner : P, F.normals) } catch { S = null }
        if (!S) continue
        const dev = Math.max(...P.map(p => Math.abs(S.g(p))))
        if (!Number.isFinite(dev)) continue
        if (!best || dev < best.deviation - exact) best = { surface: S, deviation: dev }
        if (dev <= exact) break
    }
    if (!best) return null
    // the face's outward normal: the surface's du x dv, turned when the face is not same_sense
    const out = F.normals.map(n => face.sense === false ? mul(n, -1) : n)
    const vote = F.inner.reduce((a, p, i) => a + Math.sign(dot(best.surface.grad(p), out[i] ?? out[0])), 0)
    return { ...best, sense: vote >= 0 }
}

/* how near two fits are taken for one surface: 1e-5 of the part (exact is 1e-6 of it), and axes to 1e-7 (1 - cos:
   0.45 mrad) -- loose next to the file's precision, tight next to any two surfaces a part means apart */
const SNAP_TOL = 10, SNAP_ANGLE = 1e-7          // 10 x exact: 1e-5 of the part

/** A solid's freeform faces fitted (step.js's solid, a copy returned): each evaluable unsupported face given its fit
 *  when within `maxDeviation` (mm), marked `approx` with its deviation when more than `exact` off. Returns { solid,
 *  approximated: [{ face, deviation }], over: [{ face, deviation }] -- the faces beyond it, by which the solid is
 *  refused -- unfit: [face] (nothing fits, or the surface cannot be evaluated) }. */
export function fitSolid(solid, { maxDeviation, exact }) {
    const approximated = [], over = [], unfit = []
    /* ONE SURFACE, ONE OBJECT: two faces fitted apart -- a NURBS hole's two halves -- give two cylinders a hair apart
       in their last digits, which csg.js would take for two surfaces with a sliver of cells between (the plate made all
       NURBS came out 28 shapes, not 6, 2026-11-04). A fit within SNAP of a surface already there, fitted or the solid's
       own, is that surface. */
    const known = solid.faces.filter(f => !f.surface.unsupported).map(f => f.surface)
    const snap = S => {
        for (const K of known) { const k = sameSurface(K, S, SNAP_TOL * exact, SNAP_ANGLE); if (k) return { S: K, flip: k < 0 } }
        known.push(S)
        return { S, flip: false }
    }
    const faces = solid.faces.map((f, i) => {
        if (!f.surface.unsupported) return f
        if (!f.surface.at) { unfit.push(i); return f }
        const fit = fitFace(f, { exact })
        if (!fit) { unfit.push(i); return f }
        if (fit.deviation > maxDeviation) { over.push({ face: i, deviation: fit.deviation }); return f }
        if (fit.deviation > exact) approximated.push({ face: i, deviation: fit.deviation })
        const { S, flip } = snap(fit.surface)
        return { ...f, surface: S, sense: flip ? !fit.sense : fit.sense, ...(fit.deviation > exact ? { approx: fit.deviation } : {}) }
    })
    return { solid: { ...solid, faces }, approximated, over, unfit }
}
