//======================================================================================================================
// GEOM -- the little geometry the importers share: vectors as [x, y, z], frames, curves to sample a CAD edge by, and
// the five surfaces a B-rep face can lie on that the renderer has an exact shape for (plane, cylinder, cone, sphere,
// torus).
//
// PURE, like everything in import/: numbers in, numbers out, no DOM, no device, so Node runs all of it
// (import/test/). Lengths are whatever the caller's are; the importers work in millimetres (step.js, stl.js).
//
// A SURFACE HERE IS A HALF-SPACE. Each has g(p): a signed distance, negative on one side -- its INSIDE -- and
// positive on the other, with |grad g| = 1 wherever it is smooth, so that min and max of them are still safe to march
// (a 1-Lipschitz function whose zero set is the surface never overstates the distance to it). For the plane, the
// cylinder, the sphere and the torus g is the exact distance to the whole surface; for the cone it is the distance,
// in the half-plane through the axis, to the cone's line, which is exact wherever the nearest point is on the same
// nappe and a bound elsewhere. Which side is inside is the surface's own (the outward normal of STEP's
// parametrisation: away from a cylinder's axis, out of a sphere); a face that is the other way round is a
// complement (csg.js carries the sign).
//
// THE PARAMETRISATIONS ARE STEP'S (ISO 10303-42), with u the angle around the axis where there is one, because the
// side of a face's boundary its inside is on is defined in them: on the left of each loop, seen from the face's
// normal, which for an advanced face with same_sense is the surface's normal du x dv (brep.js).
//   plane      S(u, v) = C + u x + v y
//   cylinder   S(u, v) = C + r (cos u x + sin u y) + v z
//   cone       S(u, v) = C + (r + v tan a) (cos u x + sin u y) + v z         a: the semi-angle
//   sphere     S(u, v) = C + r cos v (cos u x + sin u y) + r sin v z        v in [-pi/2, pi/2]
//   torus      S(u, v) = C + (R + r cos v) (cos u x + sin u y) + r sin v z
//======================================================================================================================

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = a => Math.hypot(a[0], a[1], a[2])
export const norm = a => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1] }
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const TAU = 2 * Math.PI
/** An angle into (-pi, pi]. */
export const wrap = a => { a = a % TAU; return a > Math.PI ? a - TAU : a <= -Math.PI ? a + TAU : a }

/** A right-handed frame from an axis and a reference direction, as STEP's axis2_placement_3d builds one: z the
 *  axis, x the reference with its part along z taken out, y = z x x. A reference along the axis, or none, gets any
 *  perpendicular. */
export function frame(origin, z = [0, 0, 1], x = null) {
    z = norm(z)
    let xr = x ? sub(x, mul(z, dot(x, z))) : null
    if (!xr || len(xr) < 1e-9) xr = Math.abs(z[0]) < 0.9 ? sub([1, 0, 0], mul(z, z[0])) : sub([0, 1, 0], mul(z, z[1]))
    xr = norm(xr)
    return { o: origin.slice(), x: xr, y: cross(z, xr), z }
}
/** A point in a frame's coordinates, and back. */
export const toLocal = (F, p) => { const d = sub(p, F.o); return [dot(d, F.x), dot(d, F.y), dot(d, F.z)] }
export const toWorld = (F, q) => [F.o[0] + q[0] * F.x[0] + q[1] * F.y[0] + q[2] * F.z[0],
                                  F.o[1] + q[0] * F.x[1] + q[1] * F.y[1] + q[2] * F.z[1],
                                  F.o[2] + q[0] * F.x[2] + q[1] * F.y[2] + q[2] * F.z[2]]
export const dirToWorld = (F, q) => [q[0] * F.x[0] + q[1] * F.y[0] + q[2] * F.z[0],
                                     q[0] * F.x[1] + q[1] * F.y[1] + q[2] * F.z[1],
                                     q[0] * F.x[2] + q[1] * F.y[2] + q[2] * F.z[2]]

//----------------------------------------------------------------------------------------------------------------------
// RIGID TRANSFORMS, as { R: 3x3 rows, t }: an assembly's placements (step.js) compose and apply these.
//----------------------------------------------------------------------------------------------------------------------
export const IDENTITY = Object.freeze({ R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] })
/** The transform that takes a frame's own coordinates to the world: its columns are x, y, z. */
export const fromFrame = F => ({ R: [[F.x[0], F.y[0], F.z[0]], [F.x[1], F.y[1], F.z[1]], [F.x[2], F.y[2], F.z[2]]], t: F.o.slice() })
export const applyDir = (T, v) => [dot(T.R[0], v), dot(T.R[1], v), dot(T.R[2], v)]
export const apply = (T, p) => add(applyDir(T, p), T.t)
/** a after b: apply b, then a. */
export const compose = (a, b) => ({ R: [0, 1, 2].map(i => [0, 1, 2].map(j => a.R[i][0] * b.R[0][j] + a.R[i][1] * b.R[1][j] + a.R[i][2] * b.R[2][j])),
                                    t: apply(a, b.t) })
export const invert = T => { const R = [0, 1, 2].map(i => [T.R[0][i], T.R[1][i], T.R[2][i]]); return { R, t: mul(applyDir({ R }, T.t), -1) } }

//----------------------------------------------------------------------------------------------------------------------
// CURVES: what an edge lies on, evaluated by a parameter. Each has at(t) and, where it has one, the parameter of a
// point on it (paramOf), which is how an edge's two vertices become the stretch of the curve it is.
//----------------------------------------------------------------------------------------------------------------------
export function line(p, d) {
    return { type: 'line', p, d, at: t => add(p, mul(d, t)), paramOf: q => dot(sub(q, p), d) / dot(d, d) }
}
export function circle(F, r) {
    return { type: 'circle', F, r, periodic: TAU,
             at: t => toWorld(F, [r * Math.cos(t), r * Math.sin(t), 0]),
             paramOf: q => { const l = toLocal(F, q); return Math.atan2(l[1], l[0]) } }
}
export function ellipse(F, a, b) {
    return { type: 'ellipse', F, a, b, periodic: TAU,
             at: t => toWorld(F, [a * Math.cos(t), b * Math.sin(t), 0]),
             paramOf: q => { const l = toLocal(F, q); return Math.atan2(l[1] / b, l[0] / a) } }
}
/** A B-spline (rational if weights are given) of a degree, its control points and its full knot vector. The
 *  parameter of a point is found by sampling and refining: the curve is only ever asked about its own vertices. */
export function bspline(degree, P, knots, weights = null) {
    const n = P.length - 1, lo = knots[degree], hi = knots[n + 1]
    const at = t => {
        t = Math.min(Math.max(t, lo), hi)
        let k = degree
        while (k < n && t >= knots[k + 1]) k++
        // de Boor on homogeneous points
        const d = []
        for (let j = 0; j <= degree; j++) {
            const i = k - degree + j, w = weights ? weights[i] : 1
            d.push([P[i][0] * w, P[i][1] * w, P[i][2] * w, w])
        }
        for (let r = 1; r <= degree; r++)
            for (let j = degree; j >= r; j--) {
                const i = k - degree + j, den = knots[i + degree - r + 1] - knots[i]
                const a = den > 0 ? (t - knots[i]) / den : 0
                for (let c = 0; c < 4; c++) d[j][c] = (1 - a) * d[j - 1][c] + a * d[j][c]
            }
        const h = d[degree]
        return [h[0] / h[3], h[1] / h[3], h[2] / h[3]]
    }
    const spans = []
    for (let i = degree; i <= n; i++) if (knots[i + 1] > knots[i]) spans.push([knots[i], knots[i + 1]])
    const paramOf = q => {
        let best = lo, bd = Infinity
        for (const [a, b] of spans) for (let s = 0; s <= 16; s++) {
            const t = a + (b - a) * s / 16, dd = len(sub(at(t), q))
            if (dd < bd) { bd = dd; best = t }
        }
        // golden-section refine around the best sample
        let h = (hi - lo) / (16 * spans.length)
        for (let it = 0; it < 40; it++) {
            const t1 = Math.max(lo, best - h), t2 = Math.min(hi, best + h)
            const d1 = len(sub(at(t1), q)), d2 = len(sub(at(t2), q))
            if (d1 < bd) { bd = d1; best = t1 } else if (d2 < bd) { bd = d2; best = t2 } else h *= 0.5
        }
        return best
    }
    return { type: 'bspline', degree, P, knots, weights, lo, hi, spans, at, paramOf }
}

/** Points along a curve from parameter a to b (b > a), dense enough to stand for it in a face's parameter plane:
 *  a circle or an ellipse every 5 degrees, a spline eight times a knot span per degree, a line its two ends. */
export function sampleCurve(c, a, b) {
    if (c.type === 'line') return [c.at(a), c.at(b)]
    let n
    if (c.type === 'circle' || c.type === 'ellipse') n = Math.max(2, Math.ceil((b - a) / (5 * Math.PI / 180)))
    else {
        const inside = c.spans.filter(([s0, s1]) => s1 > a && s0 < b).length
        n = Math.max(4, inside * 8 * c.degree)
    }
    const out = []
    for (let i = 0; i <= n; i++) out.push(c.at(a + (b - a) * i / n))
    return out
}

//----------------------------------------------------------------------------------------------------------------------
// SURFACES. Each: { type, F (its frame), ...sizes, g(p), grad(p), uv(p), at(u, v), hits(o, d), periodicU,
// periodicV }. hits are the ray parameters t > 0 where o + t d meets the surface, d a unit vector.
//----------------------------------------------------------------------------------------------------------------------
const quadRoots = (A, B, C) => {
    if (Math.abs(A) < 1e-14) return Math.abs(B) < 1e-14 ? [] : [-C / B]
    const D = B * B - 4 * A * C
    if (D < 0) return []
    const s = Math.sqrt(D), q = -0.5 * (B + (B >= 0 ? s : -s))
    return [q / A, C / q].filter(Number.isFinite)
}
const positive = ts => ts.filter(t => t > 1e-9).sort((a, b) => a - b)

export function plane(F) {
    return {
        type: 'plane', F, periodicU: false, periodicV: false,
        g: p => dot(sub(p, F.o), F.z),
        grad: () => F.z.slice(),
        uv: p => { const d = sub(p, F.o); return [dot(d, F.x), dot(d, F.y)] },
        at: (u, v) => toWorld(F, [u, v, 0]),
        hits: (o, d) => { const den = dot(d, F.z); return Math.abs(den) < 1e-14 ? [] : positive([-dot(sub(o, F.o), F.z) / den]) },
    }
}

export function cylinder(F, r) {
    return {
        type: 'cylinder', F, r, periodicU: true, periodicV: false,
        g: p => { const l = toLocal(F, p); return Math.hypot(l[0], l[1]) - r },
        grad: p => { const l = toLocal(F, p), h = Math.hypot(l[0], l[1]) || 1; return dirToWorld(F, [l[0] / h, l[1] / h, 0]) },
        uv: p => { const l = toLocal(F, p); return [Math.atan2(l[1], l[0]), l[2]] },
        at: (u, v) => toWorld(F, [r * Math.cos(u), r * Math.sin(u), v]),
        hits: (o, d) => {
            const a = toLocal(F, o), b = [dot(d, F.x), dot(d, F.y)]
            return positive(quadRoots(b[0] * b[0] + b[1] * b[1], 2 * (a[0] * b[0] + a[1] * b[1]), a[0] * a[0] + a[1] * a[1] - r * r))
        },
    }
}

/** semi: the half-angle, in radians; r: the radius at the frame's origin (v = 0). */
export function cone(F, r, semi) {
    const k = Math.tan(semi), c = Math.cos(semi), s = Math.sin(semi)
    const radiusAt = v => r + v * k
    return {
        type: 'cone', F, r, semi, periodicU: true, periodicV: false,
        // the meridian line through (r, 0) along (sin, cos): its normal, outward, is (cos, -sin)
        g: p => { const l = toLocal(F, p); return (Math.hypot(l[0], l[1]) - r) * c - l[2] * s },
        grad: p => { const l = toLocal(F, p), h = Math.hypot(l[0], l[1]) || 1; return dirToWorld(F, [c * l[0] / h, c * l[1] / h, -s]) },
        uv: p => {
            const l = toLocal(F, p), h = Math.hypot(l[0], l[1])
            // the foot on the meridian line: v along the line's direction projected onto the axis
            const t = (h - r) * s + l[2] * c
            return [Math.atan2(l[1], l[0]), t * c]
        },
        at: (u, v) => toWorld(F, [radiusAt(v) * Math.cos(u), radiusAt(v) * Math.sin(u), v]),
        hits: (o, d) => {
            // x^2 + y^2 = (r + z k)^2, on the nappe where r + z k >= 0
            const a = toLocal(F, o), b = [dot(d, F.x), dot(d, F.y), dot(d, F.z)]
            const ra = r + a[2] * k, rb = b[2] * k
            const ts = quadRoots(b[0] * b[0] + b[1] * b[1] - rb * rb, 2 * (a[0] * b[0] + a[1] * b[1] - ra * rb),
                                 a[0] * a[0] + a[1] * a[1] - ra * ra)
            return positive(ts.filter(t => ra + rb * t >= -1e-9))
        },
        radiusAt,
    }
}

export function sphere(F, r) {
    return {
        type: 'sphere', F, r, periodicU: true, periodicV: false,
        g: p => len(sub(p, F.o)) - r,
        grad: p => norm(sub(p, F.o)),
        uv: p => { const l = toLocal(F, p); return [Math.atan2(l[1], l[0]), Math.atan2(l[2], Math.hypot(l[0], l[1]))] },
        at: (u, v) => toWorld(F, [r * Math.cos(v) * Math.cos(u), r * Math.cos(v) * Math.sin(u), r * Math.sin(v)]),
        hits: (o, d) => { const a = sub(o, F.o); return positive(quadRoots(1, 2 * dot(a, d), dot(a, a) - r * r)) },
    }
}

/** R: from the axis to the tube's centre; r: the tube's radius. */
export function torus(F, R, r) {
    const g = p => { const l = toLocal(F, p); return Math.hypot(Math.hypot(l[0], l[1]) - R, l[2]) - r }
    return {
        type: 'torus', F, R, r, periodicU: true, periodicV: true, g,
        grad: p => {
            const l = toLocal(F, p), h = Math.hypot(l[0], l[1]) || 1, q = [h - R, l[2]], m = Math.hypot(q[0], q[1]) || 1
            return dirToWorld(F, [q[0] / m * l[0] / h, q[0] / m * l[1] / h, q[1] / m])
        },
        uv: p => { const l = toLocal(F, p), h = Math.hypot(l[0], l[1]); return [Math.atan2(l[1], l[0]), Math.atan2(l[2], h - R)] },
        at: (u, v) => toWorld(F, [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]),
        // a quartic: the ray is cut to the torus's bounding sphere and stepped by its own distance, which is exact,
        // so no crossing is stepped over; each sign change is then bisected
        hits: (o, d) => {
            const a = sub(o, F.o), B = dot(a, d), C = dot(a, a) - (R + r) ** 2, D = B * B - C
            if (D < 0) return []
            const t1 = -B + Math.sqrt(D)
            if (t1 <= 0) return []
            let t = Math.max(0, -B - Math.sqrt(D)), prev = g(add(o, mul(d, t)))
            const out = [], eps = 1e-9 * (R + r)
            while (t < t1) {
                const step = Math.max(Math.abs(prev) * 0.9, eps * 100)
                const tn = Math.min(t + step, t1), v = g(add(o, mul(d, tn)))
                if ((v < 0) !== (prev < 0)) {
                    let lo = t, hi = tn
                    for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); ((g(add(o, mul(d, m))) < 0) === (prev < 0)) ? lo = m : hi = m }
                    out.push(0.5 * (lo + hi))
                }
                t = tn; prev = v
            }
            return positive(out)
        },
    }
}

/** A surface moved by a rigid transform (an assembly's placement): its frame moved, its sizes kept. */
export function moveSurface(S, T) {
    const F = frame(apply(T, S.F.o), applyDir(T, S.F.z), applyDir(T, S.F.x))
    return makeSurface(S.type, F, S)
}
/** One of the five, by type, with its sizes taken from `s` (r, R, semi). */
export function makeSurface(type, F, s) {
    switch (type) {
        case 'plane': return plane(F)
        case 'cylinder': return cylinder(F, s.r)
        case 'cone': return cone(F, s.r, s.semi)
        case 'sphere': return sphere(F, s.r)
        case 'torus': return torus(F, s.R, s.r)
    }
    throw new Error(`no surface of type ${type}`)
}

//----------------------------------------------------------------------------------------------------------------------
// THE SAME SURFACE TWICE: two faces on one cylinder are one half-space (csg.js), two fitted pieces of one are one face
// (fit.js). `tol` is a length; `angle` is 1 - cos of the angle two axes may differ by (1e-9: 45 microradians).
//----------------------------------------------------------------------------------------------------------------------
const parallel = (a, b, angle = 1e-9) => Math.abs(dot(a, b)) > 1 - angle
const offAxis = (S, p) => { const d = sub(p, S.F.o); return len(sub(d, mul(S.F.z, dot(d, S.F.z)))) }
/* a cone by what it is, whatever frame it was given in: its apex, the way it opens, its half-angle */
const coneShape = S => {
    const k = Math.tan(S.semi), open = k >= 0 ? S.F.z : mul(S.F.z, -1)
    return { apex: sub(S.F.o, mul(S.F.z, S.r / k)), open, a: Math.abs(S.semi) }
}
/** 1: the same surface with the same inside; -1: the same surface, the inside swapped (a plane faced the other way);
 *  0: not the same. */
export function sameSurface(A, B, tol, angle = 1e-9) {
    if (A.type !== B.type) return 0
    switch (A.type) {
        case 'plane': {
            if (!parallel(A.F.z, B.F.z, angle)) return 0
            const s = Math.sign(dot(A.F.z, B.F.z))
            return Math.abs(dot(sub(B.F.o, A.F.o), A.F.z)) < tol ? s : 0
        }
        case 'cylinder':
            return parallel(A.F.z, B.F.z, angle) && offAxis(A, B.F.o) < tol && Math.abs(A.r - B.r) < tol ? 1 : 0
        case 'sphere':
            return len(sub(A.F.o, B.F.o)) < tol && Math.abs(A.r - B.r) < tol ? 1 : 0
        case 'torus':
            return parallel(A.F.z, B.F.z, angle) && len(sub(A.F.o, B.F.o)) < tol && Math.abs(A.R - B.R) < tol && Math.abs(A.r - B.r) < tol ? 1 : 0
        case 'cone': {
            const a = coneShape(A), b = coneShape(B)
            return dot(a.open, b.open) > 1 - angle && len(sub(a.apex, b.apex)) < tol && Math.abs(a.a - b.a) < Math.sqrt(2 * angle) ? 1 : 0
        }
    }
    return 0
}


