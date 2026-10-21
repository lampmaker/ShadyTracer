// node lib/pathtracer/core/test/shapes.test.mjs
//
// THE NEWER SHAPES' PROMISES, without a GPU (core/shapes.js, through its JS mirror): each normal is its distance's
// gradient and unit length, on axes and folds too; each distance is EXACT where shapes.js says so and never too large
// where it says "a bound" -- and never too large INSIDE, for any of them, which is what glass needs; every shape stays
// finite and 1-Lipschitz for any live parameters, zero, negative and swapped included; the reflector's focus is at the
// origin and the dome stands on z = 0. The references share no code with the shapes: dense polygons of each solid of
// revolution's cross-section, exact point-to-triangle distances for the polyhedra, dense refined spines for the tubes
// swept along curves. And the WGSL text: every mirrored function there, inside PRIMITIVES, with no sign(), no
// normalize() and no one-letter shorthand token as a name.
//
// What this cannot see: whether the WGSL says what the JS says (keep them together, shapes.js says), and f32 -- the
// shapes were chosen against f32 emulations once (the capped torus's and the parabola's rewrites), not re-measured here.
import * as S from '../shapes.js'
import { PRIMITIVES } from '../sdf.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
let rng = 0x2545f491
const rnd = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296 }
const len = v => Math.hypot(...v)
const sub = (a, b) => a.map((x, k) => x - b[k])
const add = (a, b) => a.map((x, k) => x + b[k])
const scl = (a, s) => a.map(x => x * s)
const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const angle = (a, b) => Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (len(a) * len(b)))))

//----------------------------------------------------------------------------------------------------------------------
// REFERENCES
//----------------------------------------------------------------------------------------------------------------------
/* A 2D point to a segment */
const segDist2 = (q, a, b) => {
    const ab = sub(b, a), t = Math.min(1, Math.max(0, dot(sub(q, a), ab) / Math.max(dot(ab, ab), 1e-300)))
    return len(sub(q, add(a, scl(ab, t))))
}
/* A solid of revolution by its whole cross-section in the (r, z) plane, r of either sign: closed polygons, signed
   distance by the nearest edge and the even-odd rule. Curved pieces are sampled finely (sagitta ~1e-9 of the size). */
const polyRef = polys => p => polyRef2(polys)([Math.hypot(p[0], p[1]), p[2]])
const polyRef2 = polys => q => {
    let d = Infinity, inside = false
    for (const P of polys) for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        d = Math.min(d, segDist2(q, P[j], P[i]))
        if ((P[i][1] > q[1]) !== (P[j][1] > q[1]) && q[0] < (P[j][0] - P[i][0]) * (q[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside
    }
    return inside ? -d : d
}
const arc = (c, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] })
const mirrored = half => [...half, ...half.slice().reverse().map(([r, z]) => [-r, z])]         // a right half, closed by its mirror
const N = 2000                     // points per curved piece: its chords off by under 3e-7 of the size, the tolerance 2e-6

/* Ericson's closest point on a triangle */
function closestOnTriangle(p, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a)
    const d1 = dot(ab, ap), d2 = dot(ac, ap)
    if (d1 <= 0 && d2 <= 0) return a
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp)
    if (d3 >= 0 && d4 <= d3) return b
    const vc = d1 * d4 - d3 * d2
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scl(ab, d1 / (d1 - d3)))
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp)
    if (d6 >= 0 && d5 <= d6) return c
    const vb = d5 * d2 - d1 * d6
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scl(ac, d2 / (d2 - d6)))
    const va = d3 * d6 - d5 * d4
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scl(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))))
    const den = 1 / (va + vb + vc)
    return add(a, add(scl(ab, vb * den), scl(ac, vc * den)))
}
/* A convex polyhedron by its triangles: the nearest triangle, inside when behind every face's plane */
const polyhedronRef = tris0 => {
    // a face that has shrunk to a line (a frustum's top at an apex) has no plane: its edges are its neighbours'
    const tris = tris0.filter(([a, b, c]) => len(cross(sub(b, a), sub(c, a))) > 1e-12)
    const centre = scl(tris.flat().reduce((s, v) => add(s, v), [0, 0, 0]), 1 / (tris.length * 3))
    const planes = tris.map(([a, b, c]) => { let n = cross(sub(b, a), sub(c, a)); n = scl(n, 1 / len(n)); if (dot(n, sub(centre, a)) > 0) n = scl(n, -1); return [n, a] })
    return p => {
        let d = Infinity
        for (const [a, b, c] of tris) d = Math.min(d, len(sub(p, closestOnTriangle(p, a, b, c))))
        return planes.every(([n, a]) => dot(n, sub(p, a)) <= 0) ? -d : d
    }
}
/* A tube of radius r swept along a curve c(t), t in [0, 1]: dense samples, then golden-section near the best */
const spineRef = (c, r) => p => {
    const n = 1500
    let bi = 0, bd = Infinity
    for (let i = 0; i <= n; i++) { const d = len(sub(p, c(i / n))); if (d < bd) { bd = d; bi = i } }
    let lo = Math.max(0, (bi - 1) / n), hi = Math.min(1, (bi + 1) / n)
    const f = t => len(sub(p, c(t))), g = (Math.sqrt(5) - 1) / 2
    for (let k = 0; k < 80; k++) { const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo); if (f(m1) < f(m2)) hi = m2; else lo = m1 }
    return Math.min(bd, f((lo + hi) / 2)) - r
}

//----------------------------------------------------------------------------------------------------------------------
// THE SHAPES, each: the function at its parameters, its reference, how far it reaches (for sampling), and what
// shapes.js claims for its distance outside ('exact' or 'bound'); inside every one is exact or a bound -- never over
//----------------------------------------------------------------------------------------------------------------------
const SHAPES = {
    roundCone: { sets: [[0.5, 0.25, 1.0], [0.3, 0.6, 0.8], [0.4, 0.4, 0.5]],
        fn: ([r1, r2, h]) => p => S.NroundCone(p, r1, r2, h),
        reach: ([r1, r2, h]) => h / 2 + Math.max(r1, r2), outside: 'exact',
        ref: ([r1, r2, h]) => {
            const b = (r1 - r2) / h, phi = Math.atan2(b, Math.sqrt(1 - b * b))
            return polyRef([mirrored([...arc([0, -h / 2], r1, -Math.PI / 2, phi, N), ...arc([0, h / 2], r2, phi, Math.PI / 2, N)])])
        } },
    octahedron: { sets: [[0.8], [1.3]],
        fn: ([s]) => p => S.Noctahedron(p, s), reach: ([s]) => s, outside: 'exact',
        ref: ([s]) => {
            const T = []
            for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) T.push([[x * s, 0, 0], [0, y * s, 0], [0, 0, z * s]])
            return polyhedronRef(T)
        } },
    pyramid: { sets: [[1.0, 1.0], [2.0, 0.5], [0.6, 1.8]],
        fn: ([B, H]) => p => S.Npyramid(p, B, H), reach: ([B, H]) => Math.max(B, H), outside: 'exact',
        ref: ([B, H]) => {
            const b = B / 2, z0 = -H / 2, A = [0, 0, H / 2], c = [[b, b, z0], [-b, b, z0], [-b, -b, z0], [b, -b, z0]]
            return polyhedronRef([[c[0], c[1], A], [c[1], c[2], A], [c[2], c[3], A], [c[3], c[0], A], [c[0], c[1], c[2]], [c[0], c[2], c[3]]])
        } },
    // the builder's pyramid since 2026-10-01: a rectangular base and top (0, 0 an apex, bigger than the base inverted)
    frustum: { sets: [[[1, 1], [0, 0], 1], [[1, 0.5], [0.4, 0.2], 1.2], [[0.6, 0.6], [1.2, 0.8], 0.8], [[1, 0.05], [0.5, 0.02], 1], [[1, 1], [1, 1], 1]],
        fn: ([B, T, H]) => p => S.Nfrustum(p, B, T, H), reach: ([B, T, H]) => Math.max(B[0], B[1], T[0], T[1], H), outside: 'exact',
        ref: ([B, T, H]) => {
            const c = [[1, 1], [-1, 1], [-1, -1], [1, -1]]
            const lo = c.map(([x, y]) => [x * B[0] / 2, y * B[1] / 2, -H / 2]), hi = c.map(([x, y]) => [x * T[0] / 2, y * T[1] / 2, H / 2])
            const T6 = [[lo[0], lo[1], lo[2]], [lo[0], lo[2], lo[3]], [hi[0], hi[1], hi[2]], [hi[0], hi[2], hi[3]]]
            for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; T6.push([lo[i], lo[j], hi[j]], [lo[i], hi[j], hi[i]]) }
            return polyhedronRef(T6)
        } },
    // one prism, its sides a live slider (2026-10-01): a regular polygon, a flat side at -y, extruded
    prism: { sets: [[3, 0.5, 1], [4, 0.5, 1], [5, 0.6, 0.5], [6, 0.5, 1.2], [12, 0.4, 0.3], [3.6, 0.5, 1]],
        fn: ([n, R, H]) => p => S.Nprism(p, n, R, H), reach: ([n, R, H]) => Math.max(R, H / 2), outside: 'exact',
        ref: ([n0, R, H]) => {
            const n = Math.round(n0), V = Array.from({ length: n }, (_, k) => { const a = -Math.PI / 2 + Math.PI / n + 2 * Math.PI * k / n; return [R * Math.cos(a), R * Math.sin(a)] })
            const d2 = polyRef2([V])
            return p => { const d = d2([p[0], p[1]]), w = Math.abs(p[2]) - H / 2; return Math.min(Math.max(d, w), 0) + Math.hypot(Math.max(d, 0), Math.max(w, 0)) }
        } },
    // the library's triangular prism (`0.next`): [width, height, apex, depth] -- right-angled, isosceles, the right
    // angle at +x, leaning out past the base, a sliver
    triPrism: { sets: [[1, 1, 0, 1], [1.2, 0.6, 0.5, 0.8], [0.8, 1.1, 1, 0.5], [1, 0.7, 1.6, 1.2], [1, 0.05, 0.3, 0.6]],
        fn: ([W, H, A, D]) => p => S.Ntriprism(p, W, H, A, D), reach: ([W, H, A, D]) => Math.max(W * Math.max(0.5, Math.abs(A - 0.5)), H / 2, D / 2), outside: 'exact',
        ref: ([W, H, A, D]) => {
            const d2 = polyRef2([[[-W / 2, -H / 2], [W / 2, -H / 2], [(A - 0.5) * W, H / 2]]])
            return p => { const d = d2([p[0], p[2]]), w = Math.abs(p[1]) - D / 2; return Math.min(Math.max(d, w), 0) + Math.hypot(Math.max(d, 0), Math.max(w, 0)) }
        } },
    cappedTorus: { sets: [[0.8, 0.15, 270], [1.0, 0.2, 90], [0.6, 0.1, 359]],
        fn: ([R, r, ang]) => p => S.NcappedTorus(p, R, r, ang), reach: ([R, r]) => R + r, outside: 'exact',
        ref: ([R, r, ang]) => { const a = ang * Math.PI / 360; return spineRef(t => { const th = -a + 2 * a * t; return [R * Math.sin(th), R * Math.cos(th), 0] }, r) } },
    link: { sets: [[0.5, 0.5, 0.15], [0.0, 0.4, 0.1], [1.2, 0.3, 0.12]],
        fn: ([sp, R, r]) => p => S.Nlink(p, sp, R, r), reach: ([sp, R, r]) => sp / 2 + R + r, outside: 'exact',
        ref: ([sp, R, r]) => {
            const le = sp / 2, L1 = 2 * le, Larc = Math.PI * R, tot = 2 * L1 + 2 * Larc
            return spineRef(t => {
                let s = t * tot
                if (s < L1) return [R, -le + s, 0]; s -= L1
                if (s < Larc) { const a = s / R; return [R * Math.cos(a), le + R * Math.sin(a), 0] } s -= Larc
                if (s < L1) return [-R, le - s, 0]; s -= L1
                const a = Math.PI + s / R; return [R * Math.cos(a), -le + R * Math.sin(a), 0]
            }, r)
        } },
    dome: { sets: [[1.0, 0.6], [1.0, 1.0], [0.8, 1.5], [1.0, 0.05]],
        fn: ([R, h]) => p => S.Ndome(p, R, h), reach: ([R, h]) => Math.max(R, h), outside: 'exact',
        ref: ([R, h]) => { const c = h - R, w = Math.sqrt(R * R - c * c), a0 = Math.atan2(-c, w); return polyRef([[[-w, 0], [w, 0], ...arc([0, c], R, a0, Math.PI - a0, N).slice(1, -1)]]) } },
    tube: { sets: [[0.5, 0.4, 1.0], [1.0, 0.2, 0.3], [0.6, 0, 1.0]],
        fn: ([ro, ri, H]) => p => S.Ntube(p, ro, ri, H), reach: ([ro, , H]) => Math.max(ro, H / 2), outside: 'exact',
        ref: ([ro, ri, H]) => { const box = (r0, r1) => [[r0, -H / 2], [r1, -H / 2], [r1, H / 2], [r0, H / 2]]
                                 return polyRef(ri > 0 ? [box(ri, ro), box(-ro, -ri)] : [box(-ro, ro)]) } },
    dish: { sets: [[0.25, 1.0, 0.02], [0.5, 0.8, 0.1], [0.1, 0.6, 0.05]],
        fn: ([f, A, t]) => p => S.Ndish(p, f, A, t), reach: ([f, A]) => Math.max(A, A * A / (4 * f) + f), outside: 'bound',
        ref: ([f, A, t]) => {
            // the band between the mirror z = r^2/4f - f and its offset t behind, cut at |r| = A
            const k = 1 / (4 * f), m = x => Math.sqrt(1 + 4 * k * k * x * x)
            const off = x => [x + t * 2 * k * x / m(x), k * x * x - f - t / m(x)]
            let lo = 0, hi = A                                           // the offset's x where its r reaches A
            for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (off(mid)[0] < A) lo = mid; else hi = mid }
            const xo = (lo + hi) / 2
            const mirror = Array.from({ length: N + 1 }, (_, i) => { const x = -A + 2 * A * i / N; return [x, k * x * x - f] })
            const back = Array.from({ length: N + 1 }, (_, i) => off(xo - 2 * xo * i / N))
            return polyRef([[...mirror, ...back]])
        } },
    // the aspheric lens (2026-10-04): [diameter, thickness, R1, k1, a1, R2, k2, a2] -- the condenser the builder starts
    // from (a hyperbolic face over a flat one), a biconvex one with every polynomial term, a meniscus with a hollowed back
    asphere: { sets: [[1, 0.3, 0.5, -2.25, [0, 0, 0, 0], 0, 0, [0, 0, 0, 0]],
                      [1, 0.4, 1.2, -0.6, [0.08, -0.05, 0.02, -0.01], 2.0, 0, [0, 0, 0, 0]],
                      [1.2, 0.45, 0.9, -1, [0.03, 0.01, 0, 0], -2.5, 0.5, [-0.02, 0, 0, 0]]],
        fn: q => p => S.Nasphere(p, ...q), reach: ([D, t]) => Math.max(D / 2, t), outside: 'bound', exactInside: false,
        ref: ([D, t, R1, k1, a1, R2, k2, a2]) => {
            // the sag written out again, from the formula, sharing nothing with shapes.js
            const sag = (r, R, k, a) => {
                const c = R ? 1 / R : 0, r2 = r * r
                return c * r2 / (1 + Math.sqrt(1 - (1 + k) * c * c * r2)) + a[0] * r2 ** 2 + a[1] * r2 ** 3 + a[2] * r2 ** 4 + a[3] * r2 ** 5
            }
            const rho = D / 2, xs = Array.from({ length: N + 1 }, (_, i) => -rho + 2 * rho * i / N)
            return polyRef([[...xs.map(r => [r, t / 2 - sag(Math.abs(r), R1, k1, a1)]), ...xs.slice().reverse().map(r => [r, -t / 2 + sag(Math.abs(r), R2, k2, a2)])]])
        } },
}

//----------------------------------------------------------------------------------------------------------------------
// 1-3. GRADIENT, UNIT, EXACT: at random points around each shape, and on its axes and folds
//----------------------------------------------------------------------------------------------------------------------
for (const [name, T] of Object.entries(SHAPES)) {
    for (const set of T.sets) {
        const f = T.fn(set), ref = T.ref(set), R = T.reach(set), tag = `${name}(${set.join(', ')})`
        const box = 1.4 * R
        const pts = Array.from({ length: 450 }, () => [0, 1, 2].map(() => (rnd() * 2 - 1) * box))
        // on the axes and the fold planes: where a sign() or an unguarded normalize goes wrong
        for (let i = 0; i < 30; i++) {
            const a = (rnd() * 2 - 1) * box, b = (rnd() * 2 - 1) * box
            pts.push([0, 0, a], [0, a, b], [a, 0, b], [a, a, b], [a, -a, b])
        }
        let worstG = 0, worstU = 0, worstX = 0, worstOver = 0, worstIn = 0, nG = 0, bad = null
        const h = 1e-6 * R
        for (const p of pts) {
            const v = f(p), n = v.slice(0, 3), d = v[3]
            if (![...v].every(Number.isFinite)) { bad = bad ?? `not finite at ${p}: ${v}`; continue }
            worstU = Math.max(worstU, Math.abs(len(n) - 1))
            // gradient by central differences, where no seam is within h (the normal the same at all six)
            const g = [0, 1, 2].map(k => { const e = [0, 0, 0]; e[k] = h; return (f(add(p, e))[3] - f(sub(p, e))[3]) / (2 * h) })
            const seam = [0, 1, 2].some(k => [h, -h].some(s => { const e = [0, 0, 0]; e[k] = s; return angle(f(add(p, e)).slice(0, 3), n) > 1e-4 }))
            if (!seam && Math.abs(d) > 10 * h) { worstG = Math.max(worstG, angle(g, n)); nG++ }
            const r = ref(p), tol = 2e-6 * R
            if (d < 0 || r < 0) worstIn = Math.max(worstIn, r < 0 ? (-d) - (-r) : 0)          // inside: |d| never above the truth
            if (r > 0) { worstOver = Math.max(worstOver, d - r); if (T.outside === 'exact') worstX = Math.max(worstX, Math.abs(d - r)) }
            if (r < 0 && d < 0 && T.exactInside !== false) worstX = Math.max(worstX, Math.abs(d - r))
            if (r < 0 && d > tol) bad = bad ?? `inside by the reference, outside by the shape at ${p}: ${d} vs ${r}`
        }
        ok(`${tag}: finite everywhere`, !bad, bad)
        ok(`${tag}: the normal is the gradient (${nG} points)`, worstG < 1e-4 && nG > 200, `worst ${worstG.toExponential(2)} rad`)
        ok(`${tag}: the normal is unit length, on axes and folds too`, worstU < 1e-9, `worst |n| - 1 = ${worstU.toExponential(2)}`)
        ok(`${tag}: never too large inside (glass)`, worstIn <= 2e-6 * R, `over by ${worstIn.toExponential(2)}`)
        ok(`${tag}: never too large outside`, worstOver <= 2e-6 * R, `over by ${worstOver.toExponential(2)}`)
        ok(`${tag}: exact ${T.outside === 'exact' ? 'both sides' : 'inside'}`, worstX <= 2e-6 * R, `off by ${worstX.toExponential(2)}`)
    }
}

//----------------------------------------------------------------------------------------------------------------------
// 4. LIVE PARAMETERS: anything a slider or a typed number can give -- zero, negative, swapped -- stays finite with a
// unit normal, and the distance 1-Lipschitz (a marcher trusting it never oversteps)
//----------------------------------------------------------------------------------------------------------------------
{
    const CALL = {
        roundCone: q => p => S.NroundCone(p, q[0], q[1], q[2]), octahedron: q => p => S.Noctahedron(p, q[0]),
        pyramid: q => p => S.Npyramid(p, q[0], q[1]), prism: q => p => S.Nprism(p, q[0] * 8, q[1], q[2]), frustum: q => p => S.Nfrustum(p, [q[0], q[1]], [q[2], q[1] * q[0]], q[0] - q[2]), cappedTorus: q => p => S.NcappedTorus(p, q[0], q[1], q[2] * 400),
        triPrism: q => p => S.Ntriprism(p, q[0], q[1], 3 * q[2] - 2, q[0] - q[2]),
        link: q => p => S.Nlink(p, q[0], q[1], q[2]), dome: q => p => S.Ndome(p, q[0], q[1]),
        tube: q => p => S.Ntube(p, q[0], q[1], q[2]), dish: q => p => S.Ndish(p, q[0], q[1], q[2]),
        // every sign and none: radii through zero, conics either side of -1 (an ellipse too small for its aperture too)
        asphere: q => p => S.Nasphere(p, q[0], q[1], q[2] - q[0], 3 * q[1] - 4, [q[2] * 0.1, -q[0] * 0.05, 0.01 * q[1], -0.002], q[0] - q[2], q[2], [0.02, q[0] * 0.01, 0, q[1] * 1e-3]),
    }
    const odd = () => [0, -0.3, 1e-9, 0.5, 2.0][Math.floor(rnd() * 5)]
    for (const [name, mk] of Object.entries(CALL)) {
        let bad = null, worstL = 0
        for (let s = 0; s < 60; s++) {
            const q = [0, 1, 2].map(() => rnd() < 0.4 ? odd() : rnd() * 2.5 - 0.5)
            const f = mk(q)
            for (let i = 0; i < 40; i++) {
                const p = [0, 1, 2].map(() => (rnd() * 2 - 1) * 3), e = [0, 1, 2].map(() => (rnd() * 2 - 1) * 0.3)
                const a = f(p), b = f(add(p, e))
                if (![...a, ...b].every(Number.isFinite)) { bad = bad ?? `params ${q} at ${p}: ${a}`; continue }
                if (Math.abs(len(a.slice(0, 3)) - 1) > 1e-6) bad = bad ?? `params ${q} at ${p}: |n| = ${len(a.slice(0, 3))}`
                worstL = Math.max(worstL, Math.abs(a[3] - b[3]) / len(e))
            }
        }
        ok(`${name}: any parameters -- finite, a unit normal`, !bad, bad)
        ok(`${name}: any parameters -- 1-Lipschitz`, worstL <= 1 + 1e-6, `steepest ${worstL}`)
    }
}

//----------------------------------------------------------------------------------------------------------------------
// 5. WHERE THEY STAND: the reflector's focus at the origin, the dome on z = 0, the centred ones centred
//----------------------------------------------------------------------------------------------------------------------
{
    for (const [f, A, t] of [[0.25, 1.0, 0.02], [0.5, 0.8, 0.1]]) {
        let worst = 0
        for (let i = 1; i < 40; i++) {
            const r = A * i / 40, phi = i * 2.399963
            const S0 = [r * Math.cos(phi), r * Math.sin(phi), r * r / (4 * f) - f]   // on the mirror
            const n = S.Ndish(S0, f, A, t).slice(0, 3)
            const d = [0, 0, -1], out = sub(d, scl(n, 2 * dot(d, n)))               // a ray down the axis, reflected
            worst = Math.max(worst, len(cross(scl(S0, -1), out)) / len(out))       // the line's distance from the origin
        }
        ok(`reflector(${f}, ${A}, ${t}): a ray along the axis, reflected by the mirror's normal, passes through the origin`, worst < 1e-9, `misses by ${worst}`)
        ok('...the mirror is the surface there, the wall behind it', Math.abs(S.Ndish([0, 0, -f], f, A, t)[3]) < 1e-12 && Math.abs(S.Ndish([0, 0, -f - t], f, A, t)[3]) < 1e-12
            && S.Ndish([0, 0, -f - t / 2], f, A, t)[3] < 0)
    }
    for (const [R, h] of [[1.0, 0.6], [1.0, 1.4]]) {
        ok(`dome(${R}, ${h}): its base on z = 0, its top at z = height`, Math.abs(S.Ndome([0, 0, 0], R, h)[3]) < 1e-12 && Math.abs(S.Ndome([0, 0, h], R, h)[3]) < 1e-12
            && Math.abs(S.Ndome([0.1, 0, -0.25], R, h)[3] - 0.25) < 1e-12 && S.Ndome([0, 0, h / 2], R, h)[3] < 0)
    }
    ok('prism: a flat side down, so four sides are a square square to the axes', [[0, -0.5 * Math.SQRT1_2, 0], [0.5 * Math.SQRT1_2, 0, 0], [0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2, 0.5]]
        .every(p => Math.abs(S.Nprism(p, 4, 0.5, 1)[3]) < 1e-12) && Math.abs(S.Nprism([0, -0.5 * Math.cos(Math.PI / 3), 0], 3, 0.5, 1)[3]) < 1e-12)
    {
        // its corners where the parameters put them: the base along x at z = -h/2, the top over the base's -x end at
        // apex 0 (the right angle there), over its middle at 0.5, over its +x end at 1; the depth along y
        const on = (p, A) => Math.abs(S.Ntriprism(p, 2, 1, A, 0.6)[3]) < 1e-12
        ok('triangular prism: the base on z = -height/2, width along x, depth along y', [0, 0.5, 1].every(A => on([-1, 0.3, -0.5], A) && on([1, -0.3, -0.5], A) && on([0, 0, -0.5], A)))
        ok('...the top at z = +height/2 over the base\'s -x end at apex 0, its middle at 0.5, its +x end at 1', on([-1, 0.3, 0.5], 0) && on([0, -0.3, 0.5], 0.5) && on([1, 0, 0.5], 1)
            && S.Ntriprism([0, 0, 0.5], 2, 1, 0, 0.6)[3] > 0.4)
        ok('...apex 0 a right angle: the -x face upright, its normal along -x', on([-1, 0, 0], 0) && S.Ntriprism([-1.2, 0, 0], 2, 1, 0, 0.6).slice(0, 3).every((x, k) => Math.abs(x - [-1, 0, 0][k]) < 1e-12))
    }
    ok('pyramid: apex at z = +h/2, base corners at -h/2', Math.abs(S.Npyramid([0, 0, 0.6], 1, 1.2)[3]) < 1e-12 && Math.abs(S.Npyramid([0.5, -0.5, -0.6], 1, 1.2)[3]) < 1e-12)
    ok('round cone: its spheres at z = -h/2 and +h/2', Math.abs(S.NroundCone([0, 0, -0.5 - 0.4], 0.4, 0.2, 1)[3]) < 1e-12 && Math.abs(S.NroundCone([0, 0, 0.5 + 0.2], 0.4, 0.2, 1)[3]) < 1e-12)
    ok('tube: inner radius 0 is a solid cylinder, no surface on its axis', S.Ntube([0, 0, 0], 0.5, 0, 1)[3] < -0.49)
    /* THE CONDENSER THE BUILDER STARTS FROM: a hyperboloid of k = -n^2 over a flat face is exact on axis -- a light at
       its focus, f = R / (n - 1) beyond the curved face's vertex, comes out of the flat face as a parallel beam (n 1.5,
       R 0.5, so f 1). Rays from the focus to the curved face, refracted by Snell's law with the shape's own normal,
       must all run along -z: that holds the sag, the normal and the preset's story to each other. */
    {
        const [D, t, R1, k1] = [1, 0.3, 0.5, -2.25], n = 1.5, f = R1 / (n - 1), F = [0, 0, t / 2 + f]
        const lens = p => S.Nasphere(p, D, t, R1, k1, [0, 0, 0, 0], 0, 0, [0, 0, 0, 0])
        let worst = 0, rays = 0
        for (let i = 1; i <= 40; i++) {
            const r = 0.49 * i / 40, sagR = (1 / R1) * r * r / (1 + Math.sqrt(1 - (1 + k1) * r * r / (R1 * R1)))
            const hit = [r, 0, t / 2 - sagR]                                        // where this ray meets the face
            const d = scl(sub(hit, F), 1 / len(sub(hit, F)))
            const N3 = lens(hit).slice(0, 3)                                        // outward, into the air
            const cosi = -dot(N3, d), eta = 1 / n
            const k = 1 - eta * eta * (1 - cosi * cosi)
            const out = add(scl(d, eta), scl(N3, eta * cosi - Math.sqrt(k)))
            ok(`condenser: the face is the surface where the ray meets it (r ${r.toFixed(3)})`, Math.abs(lens(hit)[3]) < 1e-12)
            worst = Math.max(worst, Math.hypot(out[0], out[1]) / len(out)); rays++
        }
        ok(`condenser: every ray from the focus runs along the axis in the glass (${rays} rays), so out of the flat face`, worst < 1e-9, `off by ${worst}`)
    }
    ok('capped torus: 360 degrees is a whole ring', [0, 1, 2, 3, 4, 5].every(i => { const a = i * 1.047; return Math.abs(S.NcappedTorus([Math.sin(a), Math.cos(a), 0.1], 1, 0.2, 360)[3] - (0.1 - 0.2)) < 1e-6 }))
}

//----------------------------------------------------------------------------------------------------------------------
// 6. THE WGSL: every mirrored function declared, inside every scene's PRIMITIVES, and none of the known traps
//----------------------------------------------------------------------------------------------------------------------
{
    const code = S.SHAPES.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')        // comments out
    const fns = Object.keys(S).filter(k => typeof S[k] === 'function' && !['safeDir', 'Ntorus', 'profilePieces', 'profileWGSL', 'profileEval', 'pathPieces', 'profileReachOf', 'pathWGSL', 'literalOperands', 'literalProfileOperands', 'pathNearEval', 'pathSweepEval', 'tubeRoundedEval', 'pathTubeEval', 'pathSweepEvalV', 'pathSlotsOf', 'profileSlotsOf', 'pathSlotCount', 'profileSlotCount', 'piecesVary'].includes(k))
    const missing = fns.filter(k => !new RegExp(`fn ${k}\\s*\\(`).test(S.SHAPES))
    ok('every JS function has its WGSL namesake (safeDir and Ntorus are sdf.js\'s; the profile and path compilers and their slots are JS only)', !missing.length, missing.join(', '))
    ok('...and the WGSL is in PRIMITIVES, so in every scene', PRIMITIVES.includes(S.SHAPES))
    ok('no sign() -- sign(0) is 0 in WGSL, a normal that is not unit', !/\bsign\s*\(/.test(code))
    ok('no normalize() -- unguarded, a NaN normal deletes the surface', !/\bnormalize\s*\(/.test(code))
    const short = code.match(/\b(F|V|W|X|I|U|U3)\b/g)
    ok('no name the page\'s shorthand would rewrite (F V W X I U U3: wgsl_shorthand.js)', !short, short?.join(' '))
}

//----------------------------------------------------------------------------------------------------------------------
// 7. PROFILES (roadmap/BUILDER.md §6 phase 3): the compiler's pieces are the outline asked for -- closed, counter-
// clockwise, each fillet an arc of its radius tangent to both its edges -- and the distance walked over them is
// exact on both sides, extruded and revolved too; an edge on the axis is no surface once revolved; and every way of
// writing one wrong is refused, by the user's own point numbers.
//----------------------------------------------------------------------------------------------------------------------
{
    const star = (k, ro, ri, fo, fi) => Array.from({ length: 2 * k }, (_, i) => {
        const a = Math.PI * i / k, r = i % 2 ? ri : ro
        return [r * Math.cos(a), r * Math.sin(a), i % 2 ? fi : fo]
    })
    const PROFILES = {
        'rounded square': [[-1, -1, 0.2], [1, -1, 0.2], [1, 1, 0.2], [-1, 1, 0.2]],
        'an L written clockwise, a convex and a concave fillet': [[0, 0], [0, 2, 0.3], [1, 2], [1, 1, 0.25], [2, 1], [2, 0]],
        'triangle': [[0, 0], [2, 0], [0.5, 1.5]],
        'star, every point filleted': star(5, 1, 0.45, 0.06, 0.04),
        'half a knob, closed along the axis': [[0, -0.5], [0.6, -0.5, 0.1], [0.6, 0.1], [0.25, 0.3, 0.15], [0.4, 0.6, 0.1], [0, 0.6]],
    }
    const end = k => k.b, start = k => k.a
    // the outline as a dense polygon, arcs sampled finely: the reference walks it, sharing nothing with pf*
    const dense = pieces => pieces.flatMap(k => {
        if (k.kind === 'segment') return [k.a]
        const a0 = Math.atan2(k.a[1] - k.c[1], k.a[0] - k.c[0]), a1 = Math.atan2(k.b[1] - k.c[1], k.b[0] - k.c[0])
        let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI
        return Array.from({ length: 600 }, (_, i) => [k.c[0] + k.r * Math.cos(a0 + da * i / 600), k.c[1] + k.r * Math.sin(a0 + da * i / 600)])     // chords off by under 4e-6 of r
    })
    for (const [name, pts] of Object.entries(PROFILES)) {
        const { pieces, problems } = S.profilePieces(pts)
        ok(`${name}: no problems`, !problems.length, problems.join('; '))
        // CLOSED, IN ORDER
        const gap = Math.max(...pieces.map((k, i) => len(sub(start(pieces[(i + 1) % pieces.length]), end(k)))))
        ok(`${name}: the pieces join end to end, round to the first`, gap < 1e-12, `gap ${gap}`)
        const D = dense(pieces)
        const area = D.reduce((s, p, i) => s + (p[0] * D[(i + 1) % D.length][1] - D[(i + 1) % D.length][0] * p[1]) / 2, 0)
        ok(`${name}: counter-clockwise`, area > 0, `area ${area}`)
        // EACH FILLET: its radius, its ends on its circle, tangent to the edges either side, on the edges written
        const want = pts.filter(p => p[2] > 0).map(p => p[2]).sort()
        const arcs = pieces.filter(k => k.kind === 'arc')
        ok(`${name}: one arc per fillet, of its radius`, JSON.stringify(arcs.map(k => k.r).sort()) === JSON.stringify(want))
        let worstT = 0, worstOn = 0
        const xy = pts.map(p => [p[0], p[1]]), edges = xy.map((p, i) => [p, xy[(i + 1) % xy.length]])
        const onEdges = q => Math.min(...edges.map(([a, b]) => segDist2(q, a, b)))
        pieces.forEach((k, i) => {
            if (k.kind !== 'arc') return
            worstOn = Math.max(worstOn, Math.abs(len(sub(k.a, k.c)) - k.r), Math.abs(len(sub(k.b, k.c)) - k.r), onEdges(k.a), onEdges(k.b))
            const before = pieces[(i - 1 + pieces.length) % pieces.length], after = pieces[(i + 1) % pieces.length]
            if (before.kind === 'segment') worstT = Math.max(worstT, Math.abs(dot(sub(before.b, before.a), sub(k.a, k.c))) / len(sub(before.b, before.a)))
            if (after.kind === 'segment') worstT = Math.max(worstT, Math.abs(dot(sub(after.b, after.a), sub(k.b, k.c))) / len(sub(after.b, after.a)))
        })
        ok(`${name}: each arc's ends on its circle and on the edges written`, worstOn < 1e-12, `${worstOn}`)
        ok(`${name}: each arc tangent to its edges`, worstT < 1e-12, `${worstT}`)
        // THE DISTANCE: exact both sides, its gradient the normal, unit length
        const ref = polyRef2([D])
        const size = Math.max(...pts.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1]))))
        let worstX = 0, worstG = 0, worstU = 0, nG = 0
        const h = 1e-6 * size, f = q => S.profileEval(pieces, q)
        for (let i = 0; i < 300; i++) {
            const q = [(rnd() * 3 - 1.5) * size, (rnd() * 3 - 1.5) * size]
            const v = f(q)
            worstX = Math.max(worstX, Math.abs(v[2] - ref(q)))
            worstU = Math.max(worstU, Math.abs(Math.hypot(v[0], v[1]) - 1))
            const g = [0, 1].map(k => { const e = [0, 0]; e[k] = h; return (f(add(q, e))[2] - f(sub(q, e))[2]) / (2 * h) })
            const seam = [0, 1].some(k => [h, -h].some(sg => { const e = [0, 0]; e[k] = sg; return angle(f(add(q, e)).slice(0, 2), v.slice(0, 2)) > 1e-4 }))
            if (!seam && Math.abs(v[2]) > 10 * h) { worstG = Math.max(worstG, angle(g, v.slice(0, 2))); nG++ }
        }
        ok(`${name}: the distance exact, inside and out`, worstX < 2e-6 * size, `off by ${worstX.toExponential(2)}`)
        ok(`${name}: the normal its gradient (${nG} points), unit length`, worstG < 1e-4 && nG > 180 && worstU < 1e-9, `${worstG.toExponential(2)} rad, |n| - 1 = ${worstU.toExponential(2)}`)
        // EXTRUDED: exact (Quilez's extrusion is exact over an exact 2D distance), the normal its gradient
        {
            const H = 0.7 * size, F = p => S.g2Extrude(p, f([p[0], p[1]]), H)
            const R3 = p => { const d = ref([p[0], p[1]]), w = Math.abs(p[2]) - H; return Math.min(Math.max(d, w), 0) + Math.hypot(Math.max(d, 0), Math.max(w, 0)) }
            let wx = 0, wg = 0, ng = 0
            for (let i = 0; i < 200; i++) {
                const p = [0, 1, 2].map(() => (rnd() * 3 - 1.5) * size), v = F(p)
                wx = Math.max(wx, Math.abs(v[3] - R3(p)))
                const g = [0, 1, 2].map(k => { const e = [0, 0, 0]; e[k] = h; return (F(add(p, e))[3] - F(sub(p, e))[3]) / (2 * h) })
                const seam = [0, 1, 2].some(k => [h, -h].some(sg => { const e = [0, 0, 0]; e[k] = sg; return angle(F(add(p, e)).slice(0, 3), v.slice(0, 3)) > 1e-4 }))
                if (!seam && Math.abs(v[3]) > 10 * h) { wg = Math.max(wg, angle(g, v.slice(0, 3))); ng++ }
            }
            ok(`${name}: extruded, exact and its gradient the normal`, wx < 2e-6 * size && wg < 1e-4 && ng > 100, `off ${wx.toExponential(2)}, ${wg.toExponential(2)} rad over ${ng}`)
        }
    }
    // REVOLVED: the edge on the axis is no surface -- the solid of revolution's cross-section is the outline and its
    // mirror, with no edge between them
    {
        const pts = PROFILES['half a knob, closed along the axis']
        const { pieces } = S.profilePieces(pts)
        ok('the knob: its edge on the axis is marked as such, and only that one', pieces.filter(k => k.axis).length === 1
            && pieces.filter(k => k.axis).every(k => k.a[0] === 0 && k.b[0] === 0))
        const right = dense(pieces.filter(k => !k.axis))                       // from the axis round to the axis
        const ref = polyRef([[...right, ...right.slice().reverse().map(([x, y]) => [-x, y])]])
        const F = p => S.g2Revolve(p, S.profileEval(pieces, [Math.hypot(p[0], p[1]), p[2]], true))
        let wx = 0
        for (let i = 0; i < 400; i++) { const p = [0, 1, 2].map(() => (rnd() * 2 - 1) * 1.0); wx = Math.max(wx, Math.abs(F(p)[3] - ref(p))) }
        ok('the knob revolved: exact, inside and out', wx < 2e-6, `off by ${wx.toExponential(2)}`)
        const onAxis = [0, 0, 0.0]
        ok('...a point on the axis inside is deep inside, not on a surface', F(onAxis)[3] < -0.2 && Math.abs(F(onAxis)[3] - ref(onAxis)) < 2e-6, `${F(onAxis)[3]}`)
        ok('...where the same outline, not revolved, has its edge there', Math.abs(S.profileEval(pieces, [0, 0], false)[2]) < 1e-12)
    }
    // WRITTEN WRONG: refused, saying where
    const says = (pts, re) => { const r = S.profilePieces(pts); return r.pieces.length === 0 && r.problems.some(m => re.test(m)) }
    ok('fewer than three points', says([[0, 0], [1, 0]], /at least three/))
    ok('a point that is not numbers, by its number', says([[0, 0], [1, 0], ['a', 1]], /point 3/))
    ok('a negative fillet, by its point', says([[0, 0, -1], [1, 0], [0, 1]], /point 1: a fillet radius cannot be negative/))
    ok('two neighbours the same point', says([[0, 0], [1, 0], [1, 0], [0, 1]], /points 2 and 3 are the same/))
    ok('no area', says([[0, 0], [1, 1], [2, 2]], /no area/))
    ok('edges that cross, by their points', says([[0, 0], [2, 2], [2, 0], [0, 1]], /edges 1-2 and 3-4 cross/))
    ok('fillets too big for their edge, by their points', says([[0, 0, 0.9], [1, 0, 0.9], [0, 1]], /fillets at points 1 and 2 need/))
    ok('...and a clockwise outline names the points as written', says([[0, 0], [0, 1, 0.9], [1, 0, 0.9]], /points 2 and 3/))
    // THE WGSL: one call per piece, in order, the axis edges marked, every number a float literal
    {
        const { pieces } = S.profilePieces(PROFILES['half a knob, closed along the axis'])
        const w = S.profileWGSL('prof_n1_knob', pieces), calls = w.match(/A = pf(Arc|Segment)\(/g) || []
        ok('the WGSL: its signature', w.startsWith('fn prof_n1_knob(q: VEC2, axis: bool) -> VEC3 {'))
        ok('...one call per piece, in order', calls.length === pieces.length && calls.every((c, i) => c.includes(pieces[i].kind === 'arc' ? 'Arc' : 'Segment')))
        ok('...the axis edge left out under axis, the others not', (w.match(/!axis\)/g) || []).length === 1)
        const bare = w.match(/[(,]\s*-?\d+\s*[,)]/g)
        ok('...every number a float literal (WGSL will not take 1 for a float)', !bare, bare?.join(' '))
    }
}

//----------------------------------------------------------------------------------------------------------------------
// 8. PATHS (roadmap/BUILDER.md §6 phase 4): the compiler's pieces are the path asked for -- joined end to end, each bend's
// arc of its radius and tangent to its edges, the frame orthonormal and carried round without a jump -- and swept
// along it, a circle (a flat tube) or a profile: EXACT OUTSIDE against the union of the cross-sections sampled along the
// path; INSIDE NEVER TOO DEEP (every point within 0.999 of the distance is inside) and inside where it says so; no jump
// along a line; the normal the gradient. The rounded tube likewise against the union of balls. Paths with bends looser
// and tighter than the cross-section, two bends in different planes, an acute turn, a sharp corner (a fan), an end
// shorter than the tube is thick. And every way of writing one wrong, by point number.
//----------------------------------------------------------------------------------------------------------------------
{
    const PATHS = {
        'an L, one fillet': [[0, 0, 0], [1, 0, 0, 0.3], [1, 1, 0]],
        'a planar U': [[0, 0, 0], [1, 0, 0, 0.25], [1, 0.6, 0, 0.25], [0, 0.6, 0]],
        'an S in 3D, bends in different planes': [[0, 0, 0], [0.8, 0, 0, 0.3], [0.8, 0.8, 0.3, 0.25], [1.6, 0.8, 0.3]],
        'an acute turn': [[0, 0, 0], [1, 0, 0, 0.15], [0.2, 0.5, 0]],
        'a sharp corner': [[0, 0, 0], [1, 0, 0], [1, 0.8, 0.4]],
        'an end shorter than the tube is thick': [[0, 0, 0], [1, 0, 0, 0.3], [1, 0.35, 0]],
    }
    const circle = r => ({ circle: true, cross: q => S.g2Circle(q, [0, 0], r), ref2: q => Math.hypot(q[0], q[1]) - r, e: r })
    const outline = pts => {
        const pc = S.profilePieces(pts).pieces
        const D = pc.flatMap(k => {
            if (k.kind === 'segment') return [k.a]
            const a0 = Math.atan2(k.a[1] - k.c[1], k.a[0] - k.c[0]), a1 = Math.atan2(k.b[1] - k.c[1], k.b[0] - k.c[0])
            let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI
            return Array.from({ length: 40 }, (_, i) => [k.c[0] + k.r * Math.cos(a0 + da * i / 40), k.c[1] + k.r * Math.sin(a0 + da * i / 40)])     // chords under 6e-6 off
        })
        return { cross: q => S.profileEval(pc, q), ref2: polyRef2([D]), e: S.profileReachOf(pc), D }
    }
    const SECTIONS = {
        'a circle of 0.1': circle(0.1),
        'a circle of 0.4 (tighter than the fillets)': circle(0.4),
        'a rounded rectangle': outline([[-0.15, -0.08, 0.03], [0.15, -0.08, 0.03], [0.15, 0.08, 0.03], [-0.15, 0.08, 0.03]]),
        'an asymmetric L': outline([[0, 0], [0.25, 0], [0.25, 0.08], [0.08, 0.08, 0.03], [0.08, 0.2], [0, 0.2]]),
    }
    /* THE REFERENCE: the cross-section at a parameter along a piece -- a segment's length, a bend's angle (its direction by
       cos and sin, not the code's wedge test) -- as a planar region; the distance to it; sampled, then refined */
    const placeAt = (k, t) => {
        if (k.kind === 'segment') return { c: add(k.a, scl(k.T, t)), T: k.T, N: k.N, B: k.B }
        const T0 = cross(k.k, k.u0), rad = add(scl(k.u0, Math.cos(t)), scl(T0, Math.sin(t)))
        return { c: add(k.c, scl(rad, k.R)), T: cross(k.k, rad), N: add(scl(rad, k.f[0]), scl(k.k, k.f[1])), B: add(scl(rad, k.f[2]), scl(k.k, k.f[3])) }
    }
    const regionDist = (k, t, p, ref2) => {
        const F = placeAt(k, t), v = sub(p, F.c), h = dot(v, F.T), d2 = ref2([dot(v, F.N), dot(v, F.B)])
        return d2 <= 0 ? Math.abs(h) : Math.hypot(h, d2)
    }
    const norm = v => scl(v, 1 / len(v)), rp1 = () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]
    /* the distance to the path itself, the same way: the centre of the cross-section at each parameter */
    const pathDistRef = (pieces, p) => {
        let best = Infinity
        for (const k of pieces) {
            const span = k.kind === 'segment' ? k.L : k.phi, M = 50, f = t => len(sub(p, placeAt(k, t).c))
            let bi = 0, bv = Infinity
            for (let i = 0; i <= M; i++) { const v = f(span * i / M); if (v < bv) { bv = v; bi = i } }
            let lo = Math.max(0, bi - 1) / M * span, hi = Math.min(M, bi + 1) / M * span
            const g = (Math.sqrt(5) - 1) / 2
            for (let it = 0; it < 40; it++) { const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo); if (f(m1) < f(m2)) hi = m2; else lo = m1 }
            best = Math.min(best, bv, f((lo + hi) / 2))
        }
        return best
    }
    const sweptRef = (pieces, ref2, p) => {
        let best = Infinity
        for (const k of pieces) {
            const span = k.kind === 'segment' ? k.L : k.phi, M = 50
            let bi = 0, bv = Infinity
            for (let i = 0; i <= M; i++) { const v = regionDist(k, span * i / M, p, ref2); if (v < bv) { bv = v; bi = i } }
            let lo = Math.max(0, bi - 1) / M * span, hi = Math.min(M, bi + 1) / M * span
            const g = (Math.sqrt(5) - 1) / 2, f = t => regionDist(k, t, p, ref2)
            for (let it = 0; it < 40; it++) { const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo); if (f(m1) < f(m2)) hi = m2; else lo = m1 }
            best = Math.min(best, bv, f((lo + hi) / 2))
        }
        return best
    }
    /* INSIDE, independently: in a segment's span and its cross-section; or at a bend's angle (atan2), or the opposite one */
    const insideRef = (pieces, ref2, p) => pieces.some(k => {
        if (k.kind === 'segment') { const v = sub(p, k.a), s = dot(v, k.T); return s >= 0 && s <= k.L && ref2([dot(v, k.N), dot(v, k.B)]) <= 0 }
        const v = sub(p, k.c), h = dot(v, k.k), w = sub(v, scl(k.k, h)), rho = len(w), T0 = cross(k.k, k.u0)
        const ang = Math.atan2(dot(w, T0), dot(w, k.u0)), inRange = a => { let x = a % (2 * Math.PI); if (x < 0) x += 2 * Math.PI; return x <= k.phi + 1e-12 }
        const at = sg => { const a = sg * rho - k.R; return ref2([a * k.f[0] + h * k.f[1], a * k.f[2] + h * k.f[3]]) <= 0 }
        return (inRange(ang) && at(1)) || (inRange(ang + Math.PI) && at(-1))
    })
    for (const [pname, pts] of Object.entries(PATHS)) {
        const { pieces, problems } = S.pathPieces(pts)
        ok(`${pname}: no problems`, !problems.length, problems.join('; '))
        // THE PIECES: joined, each bend's arc of its radius and tangent, the frame orthonormal and carried without a jump
        let gap = 0, arcs = 0, frame = 0
        pieces.forEach((k, i) => {
            const next = pieces[i + 1]
            const endOf = k.kind === 'segment' ? add(k.a, scl(k.T, k.L)) : k.b
            if (next) gap = Math.max(gap, len(sub(next.kind === 'segment' ? next.a : next.a, endOf)))
            if (k.kind === 'segment') frame = Math.max(frame, Math.abs(dot(k.N, k.B)), Math.abs(dot(k.N, k.T)), Math.abs(dot(k.B, k.T)), Math.abs(len(k.N) - 1), Math.abs(len(k.B) - 1), len(sub(cross(k.N, k.B), k.T)))
            else {
                arcs = Math.max(arcs, Math.abs(len(sub(k.a, k.c)) - k.R), Math.abs(len(sub(k.b, k.c)) - k.R))
                const prev = pieces[i - 1], after = pieces[i + 1]
                arcs = Math.max(arcs, Math.abs(dot(prev.T, sub(k.a, k.c))), Math.abs(dot(after.T, sub(k.b, k.c))))
                // the frame on either side of the bend is the bend's, at its two ends
                frame = Math.max(frame, len(sub(prev.N, add(scl(k.u0, k.f[0]), scl(k.k, k.f[1])))), len(sub(after.N, add(scl(k.u1, k.f[0]), scl(k.k, k.f[1])))),
                                 len(sub(prev.B, add(scl(k.u0, k.f[2]), scl(k.k, k.f[3])))), len(sub(after.B, add(scl(k.u1, k.f[2]), scl(k.k, k.f[3])))))
            }
        })
        ok(`${pname}: the pieces join end to end`, gap < 1e-12, `${gap}`)
        ok(`${pname}: each bend's arc of its radius, tangent to its edges`, arcs < 1e-12, `${arcs}`)
        ok(`${pname}: the frame orthonormal, right-handed, carried round each bend without a jump`, frame < 1e-12, `${frame}`)
        for (const [sname, X] of Object.entries(SECTIONS)) {
            // a profile's reference is the dear one: on the three paths that test it hardest (bends in two planes, acute, sharp)
            if (!X.circle && !['an S in 3D, bends in different planes', 'an acute turn', 'a sharp corner'].includes(pname)) continue
            const tag = `${pname}, ${sname}`, F = p => S.pathSweepEval(pieces, p, X.cross, X.e)
            let worstOut = 0, nOut = 0, worstDeep = 0, nIn = 0, disagree = null, worstG = 0, nG = 0, worstU = 0, jumps = 0
            const h = 1e-6
            for (let i = 0; i < 110; i++) {
                const p = [rnd() * 2.6 - 0.6, rnd() * 1.8 - 0.6, rnd() * 1.4 - 0.5], v = F(p), d = v[3]
                worstU = Math.max(worstU, Math.abs(Math.hypot(v[0], v[1], v[2]) - 1))
                const inside = insideRef(pieces, X.ref2, p)
                if (Math.abs(d) > 1e-6 && (d < 0) !== inside) disagree = disagree ?? `${p.map(x => x.toFixed(3))}: d ${d}, inside ${inside}`
                if (d > 1e-4) { worstOut = Math.max(worstOut, Math.abs(d - sweptRef(pieces, X.ref2, p))); nOut++ }
                if (d < -1e-4) {
                    nIn++
                    for (let j = 0; j < 10; j++) {
                        const u = norm(rp1()), x = add(p, scl(u, 0.999 * -d))
                        if (!insideRef(pieces, X.ref2, x)) { worstDeep = Math.max(worstDeep, 1); break }
                    }
                }
                const g = [0, 1, 2].map(c => { const e = [0, 0, 0]; e[c] = h; return (F(add(p, e))[3] - F(sub(p, e))[3]) / (2 * h) })
                const seam = [0, 1, 2].some(c => [h, -h].some(sg => { const e = [0, 0, 0]; e[c] = sg; return angle(F(add(p, e)).slice(0, 3), v.slice(0, 3)) > 1e-4 }))
                if (!seam && Math.abs(d) > 1e-4) { worstG = Math.max(worstG, angle(g, v.slice(0, 3))); nG++ }
            }
            // ALONG LINES: no step bigger than the step (a jump is what random pairs miss and a line scan finds)
            for (let l = 0; l < 8; l++) {
                const a = [rnd() * 2.6 - 0.6, rnd() * 1.8 - 0.6, rnd() * 1.4 - 0.5], u = norm(rp1()), st = 0.004
                let prev = F(a)[3]
                for (let s = 1; s <= 250; s++) { const cur = F(add(a, scl(u, st * s)))[3]; if (Math.abs(cur - prev) > st * (1 + 1e-6) + 1e-12) jumps++; prev = cur }
            }
            // ACROSS EVERY JOINT FACE -- between a segment and its bend -- no step bigger than the step. Where the section
            // reaches past a bend's axis, part of that face is not carried on round the bend and can be the surface; the
            // depth did not count it (2026-10-02: at the sharp corner with the asymmetric L, 40 times the step), and the
            // random directions above had not crossed it. On the face, within the section's reach of its centre.
            let across = 0, worstAcross = ''
            for (const k of pieces) if (k.kind === 'bend') for (const [o, u, T] of [[k.a, k.u0, cross(k.k, k.u0)], [k.b, k.u1, cross(k.k, k.u1)]])
                for (let j = 0; j < 60; j++) {
                    const a = rnd() * 2 * Math.PI, m = 1.1 * X.e * Math.sqrt(rnd()), x = add(o, add(scl(u, m * Math.cos(a)), scl(k.k, m * Math.sin(a))))
                    const st = 0.001, d0 = F(sub(x, scl(T, st / 2)))[3], d1 = F(add(x, scl(T, st / 2)))[3]
                    if (Math.abs(d1 - d0) > st * (1 + 1e-6) + 1e-12) { across++; worstAcross ||= `${x.map(c => c.toFixed(3))}: ${d0.toFixed(5)} to ${d1.toFixed(5)}` }
                }
            ok(`${tag}: no step across a joint face`, across === 0, `${across}: ${worstAcross}`)
            ok(`${tag}: outside exact (${nOut} points)`, worstOut < 2e-5 && nOut > 30, `off by ${worstOut.toExponential(2)}`)
            ok(`${tag}: inside never too deep (${nIn} points)`, worstDeep === 0)
            ok(`${tag}: inside where the cross-sections are, outside elsewhere`, !disagree, disagree)
            ok(`${tag}: no jumps along lines`, jumps === 0, `${jumps}`)
            ok(`${tag}: the normal its gradient, unit length`, worstG < 1e-3 && nG > 30 && worstU < 1e-9, `${worstG.toExponential(2)} rad over ${nG}, |n| - 1 = ${worstU.toExponential(2)}`)
        }
        // THE ROUNDED TUBE: one closest point -- exact outside against the union of balls, never too deep inside
        {
            const r = 0.1
            let worstOut = 0, worstDeep = 0
            for (let i = 0; i < 120; i++) {
                const p = [rnd() * 2.6 - 0.6, rnd() * 1.8 - 0.6, rnd() * 1.4 - 0.5], d = S.tubeRoundedEval(pieces, p, r)[3]
                const path = pathDistRef(pieces, p)
                if (d > 1e-4) worstOut = Math.max(worstOut, Math.abs(d - (path - r)))
                if (d < -1e-4) for (let j = 0; j < 8; j++) { const x = add(p, scl(norm(rp1()), 0.999 * -d)); if (pathDistRef(pieces, x) > r) worstDeep = 1 }
            }
            ok(`${pname}: the rounded tube, outside exact and inside never too deep`, worstOut < 1e-6 && !worstDeep, `${worstOut}`)
        }
    }
    /* INSIDE, EXACT where the cross-sections do not overlap -- a tube of 0.1 on the paths whose every bend is at least that
       round -- against the depth worked out apart: the radius less the distance to the path, or an end face's distance
       if nearer. A face left inside at a joint would read near nought here, where "never too deep" cannot see it. */
    for (const pname of ['an L, one fillet', 'a planar U', 'an S in 3D, bends in different planes', 'an acute turn']) {
        const { pieces } = S.pathPieces(PATHS[pname]), C = SECTIONS['a circle of 0.1'], r = 0.1
        const first = pieces[0], last = pieces.at(-1)
        let worst = 0, n = 0
        for (let i = 0; i < 400 && n < 60; i++) {
            // a point in a cross-section somewhere along the path (a thin tube: random points in a box seldom land inside)
            const k = pieces[Math.floor(rnd() * pieces.length)], F0 = placeAt(k, rnd() * (k.kind === 'segment' ? k.L : k.phi))
            const a = rnd() * 2 * Math.PI, m = 0.098 * Math.sqrt(rnd())
            const p = add(F0.c, add(scl(F0.N, m * Math.cos(a)), scl(F0.B, m * Math.sin(a)))), d = S.pathSweepEval(pieces, p, C.cross, C.e)[3]
            if (d >= -1e-4) continue
            n++
            const depth = Math.min(r - pathDistRef(pieces, p), regionDist(first, 0, p, C.ref2), regionDist(last, last.L, p, C.ref2))
            worst = Math.max(worst, Math.abs(-d - depth))
        }
        ok(`${pname}, a tube of 0.1: inside exact, no face left at a joint (${n} points)`, worst < 1e-6 && n > 20, `off by ${worst.toExponential(2)}`)
    }
    /* A BEND ON ITS OWN, ITS CROSS-SECTION REACHING PAST ITS AXIS: a quarter arc of radius 1 whose fillet takes both edges
       whole (its segments have no length), swept with a circle of 1.3. Nothing else covers the far side of the axis here,
       as the neighbouring segments do on the paths above -- so this is what exercises the opposite half-plane and the end
       faces of a bend reached past its axis (without it, dropping either went unnoticed). */
    {
        const { pieces, problems } = S.pathPieces([[0, 0, 0], [1, 0, 0, 1], [1, 1, 0]])
        const C = circle(1.3), F = p => S.pathSweepEval(pieces, p, C.cross, C.e)
        ok('a quarter arc on its own: a bend between two segments of no length', !problems.length && pieces.length === 3
            && pieces[0].L < 1e-12 && pieces[2].L < 1e-12 && pieces[1].R === 1, JSON.stringify(problems))
        let worstOut = 0, nOut = 0, disagree = null, worstDeep = 0, nIn = 0, nFar = 0
        for (let i = 0; i < 400; i++) {
            // half of them about the bend's axis (through (0, 1, 0)), where the cross-sections cross it, and every fourth
            // on its far side within 0.3 of it -- where the circle of 1.3 crosses it -- which the count below needs (left
            // to chance it once drew 3 there)
            const p = i % 4 === 3 ? [-rnd() * 0.3, 1 + rnd() * 0.3, rnd() * 1.6 - 0.8]
                : i % 2 ? [rnd() * 1.6 - 0.8, 1 + rnd() * 1.6 - 0.8, rnd() * 2.4 - 1.2] : [rnd() * 4.4 - 2.2, rnd() * 4.4 - 1.2, rnd() * 3 - 1.5]
            const d = F(p)[3], inside = insideRef(pieces, C.ref2, p)
            if (Math.abs(d) > 1e-6 && (d < 0) !== inside) disagree = disagree ?? `${p.map(x => x.toFixed(3))}: d ${d}, inside ${inside}`
            if (d > 1e-4) { worstOut = Math.max(worstOut, Math.abs(d - sweptRef(pieces, C.ref2, p))); nOut++ }
            if (d < -1e-4) {
                nIn++
                for (let j = 0; j < 8; j++) if (!insideRef(pieces, C.ref2, add(p, scl(norm(rp1()), 0.999 * -d)))) { worstDeep = 1; break }
            }
            // on the far side of the axis from the arc (the opposite half-plane: x < 0 and y > 1 here)
            if (p[0] < 0 && p[1] > 1 && inside) nFar++
        }
        ok(`...outside exact (${nOut} points)`, worstOut < 2e-5 && nOut > 100, `off by ${worstOut.toExponential(2)}`)
        ok(`...inside where the cross-sections are -- across the axis too (${nFar} points there)`, !disagree && nFar > 5, disagree ?? `${nFar}`)
        ok(`...inside never too deep (${nIn} points)`, !worstDeep)
    }
    // A FAN AT A SHARP CORNER FILLS THE OUTSIDE OF THE CORNER (no gap between the two ends)
    {
        const { pieces } = S.pathPieces(PATHS['a sharp corner'])
        const C = SECTIONS['a circle of 0.1'], outer = [1.06, -0.06, 0]
        ok('a sharp corner: the outside of the corner is inside the sweep (a fan, not a gap)', S.pathSweepEval(pieces, outer, C.cross, C.e)[3] < 0 && insideRef(pieces, C.ref2, outer))
    }
    // DEGENERATE, STILL FINITE: two points, a path along z, a zero-length segment between two fillets, r 0 and negative
    {
        const bad = []
        for (const pts of [[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [0, 0, 1]], [[0, 0, 0], [1, 0, 0, 0.5], [1, 0.5, 0, 0], [1, 0.5, 1]], [[0, 0, 0], [1, 0, 0, 0.5], [1, 0.5, 0]]]) {
            const { pieces, problems } = S.pathPieces(pts)
            if (problems.length) { bad.push(`${JSON.stringify(pts)}: ${problems}`); continue }
            for (const r of [0, -0.2, 0.1]) for (let i = 0; i < 30; i++) {
                const p = [rnd() * 2 - 0.5, rnd() * 2 - 0.5, rnd() * 2 - 0.5]
                const a = S.pathSweepEval(pieces, p, q => S.g2Circle(q, [0, 0], Math.max(r, 0)), Math.max(r, 0)), b = S.tubeRoundedEval(pieces, p, r)
                if (![...a, ...b].every(Number.isFinite)) bad.push(`${JSON.stringify(pts)} r ${r}: ${a} ${b}`)
            }
        }
        ok('degenerate paths and radii: finite', !bad.length, bad.slice(0, 3).join('\n      '))
    }
    /* PER POINT, THE SECTION'S SCALE AND TWIST (2026-10-02; shapes.js above swRound says what each piece does and why).
       The references as above, the section at each parameter scaled and turned by its values -- linearly along a
       segment, held round a bend: a profile's polygon mapped by M = R(twist) diag(sx, sy), a tube's circle of sx r --
       and inside by taking q back into the section's own frame (M^-1, written here apart from the code's swUnscale).
       A section that changes along a segment, or a scale that differs in x and y, is a BOUND: never too large outside,
       never too deep inside, its slope never more than 1 -- on random pairs, along lines, across every joint face --
       and the divisor shown NEEDED: the slice without it is steeper than 1. Exact where the scale is the same in x and
       y and held. The rounded tube with its radius scaled: exact outside against the union of balls. */
    {
        const withValues = (pts, vals) => pts.map((p, i) => [...p, ...(p.length < 4 ? [0] : []), ...vals[i % vals.length]])
        const VALUES = {
            'a taper': [[1, 1, 0], [0.5, 0.5, 0], [1.5, 1.5, 0]],
            'scale x alone': [[1, 1, 0], [2, 1, 0], [1, 1.5, 0]],
            'a twist': [[1, 1, 0], [1, 1, 90], [1, 1, 180]],
            'all three': [[1, 1, 0], [0.4, 0.7, 180], [1.3, 1, 30]],
        }
        const turn = (v, o) => { const c = Math.cos(v[2]), s = Math.sin(v[2]); return [c * v[0] * o[0] - s * v[1] * o[1], s * v[0] * o[0] + c * v[1] * o[1]] }      // M o
        const unturn = (v, q) => { const c = Math.cos(v[2]), s = Math.sin(v[2]); return [(c * q[0] + s * q[1]) / v[0], (-s * q[0] + c * q[1]) / v[1]] }  // M^-1 q
        const tube = r => ({ round: true, r, cross: q => S.g2Circle(q, [0, 0], r), e: r, ref2: q => Math.hypot(q[0], q[1]) - r,
                             at: v => q => Math.hypot(q[0], q[1]) - v[0] * r, D: Array.from({ length: 48 }, (_, i) => [r * Math.cos(i * Math.PI / 24), r * Math.sin(i * Math.PI / 24)]) })
        /* a profile's slice: sx times its own distance at M^-1 q while sx = sy (a similarity, exact), else its polygon mapped
           by M (a bend's values are held: mapped once) */
        const flatPoly = P => {           // polyRef2 for one polygon, in scalars: the same nearest edge and even-odd rule, faster
            const n = P.length, xs = new Float64Array(n), ys = new Float64Array(n)
            P.forEach((p, i) => { xs[i] = p[0]; ys[i] = p[1] })
            return q => {
                let d2 = Infinity, inside = false
                for (let i = 0, j = n - 1; i < n; j = i++) {
                    const ax = xs[j], ay = ys[j], ex = xs[i] - ax, ey = ys[i] - ay, wx = q[0] - ax, wy = q[1] - ay
                    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / Math.max(ex * ex + ey * ey, 1e-300))), dx = wx - ex * t, dy = wy - ey * t
                    d2 = Math.min(d2, dx * dx + dy * dy)
                    if ((ys[i] > q[1]) !== (ay > q[1]) && q[0] < (ax - xs[i]) * (q[1] - ys[i]) / (ay - ys[i]) + xs[i]) inside = !inside
                }
                return inside ? -Math.sqrt(d2) : Math.sqrt(d2)
            }
        }
        const profile = pts => {
            const X = outline(pts), held = new Map()
            const map = v => flatPoly(X.D.map(o => turn(v, o)))
            return { ...X, round: false, at: v => {
                if (v[0] === v[1]) return q => v[0] * X.ref2(unturn(v, q))
                const k = v.join(); if (!held.has(k)) held.set(k, map(v)); return held.get(k)
            } }
        }
        const VSECTIONS = {
            'a tube of 0.1': tube(0.1),
            'a rounded rectangle': profile([[-0.15, -0.08, 0.03], [0.15, -0.08, 0.03], [0.15, 0.08, 0.03], [-0.15, 0.08, 0.03]]),
            'an asymmetric L': profile([[0, 0], [0.25, 0], [0.25, 0.08], [0.08, 0.08, 0.03], [0.08, 0.2], [0, 0.2]]),
        }
        /* a piece's values at a parameter: linear along a segment, held round a bend; a tube's its sx alone */
        const valuesAt = (k, t, round) => {
            const v = k.kind === 'segment' ? k.va.map((a, j) => a + (k.vb[j] - a) * (k.L > 0 ? Math.min(1, Math.max(0, t / k.L)) : 0)) : k.v
            return round ? [v[0], v[0], 0] : v
        }
        const minAlong = (pieces, f) => {
            let best = Infinity
            for (const k of pieces) {
                const span = k.kind === 'segment' ? k.L : k.phi, M = 30, g = t => f(k, t)
                let bi = 0, bv = Infinity
                for (let i = 0; i <= M; i++) { const v = g(span * i / M); if (v < bv) { bv = v; bi = i } }
                let lo = Math.max(0, bi - 1) / M * span, hi = Math.min(M, bi + 1) / M * span
                const gr = (Math.sqrt(5) - 1) / 2
                for (let it = 0; it < 32; it++) { const m1 = hi - gr * (hi - lo), m2 = lo + gr * (hi - lo); if (g(m1) < g(m2)) hi = m2; else lo = m1 }
                best = Math.min(best, bv, g((lo + hi) / 2))
            }
            return best
        }
        /* outside: the distance to the slices, each a planar region */
        const sweptRefV = (pieces, X, p) => minAlong(pieces, (k, t) => {
            const F0 = placeAt(k, t), w = sub(p, F0.c), h = dot(w, F0.T), d2 = X.at(valuesAt(k, t, X.round))([dot(w, F0.N), dot(w, F0.B)])
            return d2 <= 0 ? Math.abs(h) : Math.hypot(h, d2)
        })
        /* inside: in a segment's span and its slice at p's own s; or at a bend's angle, or the opposite one */
        const insideRefV = (pieces, X, p) => pieces.some(k => {
            if (k.kind === 'segment') { const w = sub(p, k.a), s = dot(w, k.T); return s >= 0 && s <= k.L && X.ref2(unturn(valuesAt(k, s, X.round), [dot(w, k.N), dot(w, k.B)])) <= 0 }
            const w0 = sub(p, k.c), h = dot(w0, k.k), w = sub(w0, scl(k.k, h)), rho = len(w), T0 = cross(k.k, k.u0)
            const ang = Math.atan2(dot(w, T0), dot(w, k.u0)), inRange = a => { let x = a % (2 * Math.PI); if (x < 0) x += 2 * Math.PI; return x <= k.phi + 1e-12 }
            const v = valuesAt(k, 0, X.round), at = sg => { const a = sg * rho - k.R; return X.ref2(unturn(v, [a * k.f[0] + h * k.f[1], a * k.f[2] + h * k.f[3]])) <= 0 }
            return (inRange(ang) && at(1)) || (inRange(ang + Math.PI) && at(-1))
        })
        /* a point near the surface: an outline point of the slice somewhere along the path, scaled 0.6 to 1.4, a little off the plane */
        const nearSurface = (pieces, X) => {
            const k = pieces[Math.floor(rnd() * pieces.length)], t = rnd() * (k.kind === 'segment' ? k.L : k.phi), F0 = placeAt(k, t)
            const q = turn(valuesAt(k, t, X.round), scl(X.D[Math.floor(rnd() * X.D.length)], 0.6 + 0.8 * rnd()))
            return add(F0.c, add(add(scl(F0.N, q[0]), scl(F0.B, q[1])), scl(F0.T, (rnd() - 0.5) * 0.06)))
        }
        const box = () => [rnd() * 2.6 - 0.6, rnd() * 1.8 - 0.6, rnd() * 1.4 - 0.5]
        const gradOf = (F, p, h) => [0, 1, 2].map(c => { const e = [0, 0, 0]; e[c] = h; return (F(add(p, e))[3] - F(sub(p, e))[3]) / (2 * h) })
        const onSeam = (F, p, v, h) => [0, 1, 2].some(c => [h, -h].some(sg => { const e = [0, 0, 0]; e[c] = sg; return angle(F(add(p, e)).slice(0, 3), v.slice(0, 3)) > 1e-4 }))
        let ratio = Infinity, ratioAt = ''
        for (const pname of ['an L, one fillet', 'an S in 3D, bends in different planes', 'a sharp corner']) for (const [vname, vals] of Object.entries(VALUES)) {
            const { pieces, problems, varies } = S.pathPieces(withValues(PATHS[pname], vals))
            ok(`${pname}, ${vname}: sound, and it varies`, !problems.length && varies, problems.join('; '))
            for (const [sname, X] of Object.entries(VSECTIONS)) {
                const tag = `${pname}, ${vname}, ${sname}`, F = p => S.pathSweepEvalV(pieces, p, X.cross, X.e, X.round), h = 1e-6
                let over = -Infinity, nOut = 0, disagree = null, deep = null, nIn = 0, worstG = 0, nG = 0, worstU = 0, steep = 0, jumps = 0, across = 0, onIt = 0
                for (let i = 0; i < 160; i++) {
                    const p = i % 2 ? nearSurface(pieces, X) : box(), v = F(p), d = v[3]
                    worstU = Math.max(worstU, Math.abs(Math.hypot(v[0], v[1], v[2]) - 1))
                    const inside = insideRefV(pieces, X, p)
                    if (Math.abs(d) > 1e-6 && (d < 0) !== inside) disagree ??= `${p.map(x => x.toFixed(3))}: d ${d}, inside ${inside}`
                    if (d > 1e-4 && (i % 4 === 1 || i % 8 === 0)) {
                        const ref = sweptRefV(pieces, X, p)
                        over = Math.max(over, d - ref); nOut++
                        if (d / ref < ratio) { ratio = d / ref; ratioAt = tag }
                    }
                    if (d < -1e-4) {
                        nIn++
                        for (let j = 0; j < 10 && !deep; j++) { const x = add(p, scl(norm(rp1()), 0.999 * -d)); if (!insideRefV(pieces, X, x)) deep = `${p.map(c => c.toFixed(3))} depth ${-d}` }
                    }
                    if (Math.abs(d) > 1e-4 && !onSeam(F, p, v, h)) { worstG = Math.max(worstG, angle(gradOf(F, p, h), v.slice(0, 3))); nG++ }
                    for (const st of [1e-6, 1e-3, 0.03]) steep = Math.max(steep, Math.abs(F(add(p, scl(norm(rp1()), st)))[3] - d) / st)
                }
                // ON THE SURFACE: an outline point carried by its slice, mid-segment, where no other piece covers it
                for (const k of pieces) if (k.kind === 'segment') for (let j = 0; j < 12; j++) {
                    const t = k.L * (0.25 + 0.5 * rnd()), F0 = placeAt(k, t), q = turn(valuesAt(k, t, X.round), X.D[Math.floor(rnd() * X.D.length)])
                    const x = add(F0.c, add(scl(F0.N, q[0]), scl(F0.B, q[1])))
                    if (insideRefV(pieces.filter(o => o !== k), X, x)) continue
                    onIt = Math.max(onIt, Math.abs(F(x)[3]))
                }
                for (let l = 0; l < 8; l++) {
                    const a = box(), u = norm(rp1()), st = 0.004
                    let prev = F(a)[3]
                    for (let s = 1; s <= 250; s++) { const cur = F(add(a, scl(u, st * s)))[3]; if (Math.abs(cur - prev) > st * (1 + 1e-6) + 1e-12) jumps++; prev = cur }
                }
                for (const k of pieces) if (k.kind === 'bend') for (const [o, u, T] of [[k.a, k.u0, cross(k.k, k.u0)], [k.b, k.u1, cross(k.k, k.u1)]])
                    for (let j = 0; j < 40; j++) {
                        const v = valuesAt(k, 0, X.round), a = rnd() * 2 * Math.PI, m = 1.1 * X.e * Math.max(v[0], v[1]) * Math.sqrt(rnd())
                        const x = add(o, add(scl(u, m * Math.cos(a)), scl(k.k, m * Math.sin(a)))), st = 0.001
                        if (Math.abs(F(add(x, scl(T, st / 2)))[3] - F(sub(x, scl(T, st / 2)))[3]) > st * (1 + 1e-6) + 1e-12) across++
                    }
                ok(`${tag}: outside never too large (${nOut} points)`, over < 1e-5 && nOut > 20, `over by ${over.toExponential(2)}`)
                ok(`${tag}: inside where its slices are, outside elsewhere`, !disagree, disagree)
                ok(`${tag}: inside never too deep (${nIn} points)`, !deep && nIn > 10, deep ?? `${nIn}`)
                ok(`${tag}: no slope over 1 -- random pairs, along lines, across every joint face`, steep <= 1 + 1e-6 && !jumps && !across, `${steep} ${jumps} ${across}`)
                ok(`${tag}: nought on the surface`, onIt < 1e-9, `${onIt}`)
                ok(`${tag}: the normal its gradient, unit length`, worstG < 1e-3 && nG > 50 && worstU < 1e-9, `${worstG.toExponential(2)} rad over ${nG}, |n| - 1 = ${worstU.toExponential(2)}`)
            }
        }
        // WHAT THE BOUND GIVES AWAY, at worst over every case above -- the march's steps that much shorter there. A tripwire,
        // not a promise: 0.068 when written (2026-10-02), in 'all three' (a scale of 0.4 to 1.3 and half a turn along an
        // edge of 0.8) with the asymmetric L
        ok(`the varying sweep's distance at least ${ratio.toFixed(3)} of the true one (${ratioAt})`, ratio > 0.05)
        // EXACT WHERE THE SCALE IS THE SAME IN X AND Y AND HELD: a similarity, so the bound is the distance
        {
            const { pieces } = S.pathPieces(withValues(PATHS['an S in 3D, bends in different planes'], [[1.5, 1.5, 30]]))
            for (const [sname, X] of Object.entries(VSECTIONS)) {
                const F = p => S.pathSweepEvalV(pieces, p, X.cross, X.e, X.round)
                let worst = 0, n = 0
                for (let i = 0; i < 50; i++) { const p = i % 2 ? nearSurface(pieces, X) : box(), d = F(p)[3]; if (d > 1e-4) { worst = Math.max(worst, Math.abs(d - sweptRefV(pieces, X, p))); n++ } }
                ok(`a scale of 1.5 and a twist of 30 held all along, ${sname}: outside exact (${n} points)`, worst < 2e-5 && n > 15, `off by ${worst.toExponential(2)}`)
            }
        }
        // EVERY VALUE THE DEFAULT: the same as the form without them -- which codegen still writes for such a path
        {
            let worst = 0, worstN = 0
            for (const pts of Object.values(PATHS)) {
                const { pieces } = S.pathPieces(pts)
                for (let i = 0; i < 40; i++) {
                    const p = box()
                    for (const X of [VSECTIONS['a tube of 0.1'], VSECTIONS['an asymmetric L']]) {
                        const a = S.pathSweepEval(pieces, p, X.cross, X.e), b = S.pathSweepEvalV(pieces, p, X.cross, X.e, X.round)
                        worst = Math.max(worst, Math.abs(a[3] - b[3])); worstN = Math.max(worstN, len(sub(a.slice(0, 3), b.slice(0, 3))))
                    }
                    const a = S.tubeRoundedEval(pieces, p, 0.1), b = S.pathTubeEval(pieces, p, 0.1)
                    worst = Math.max(worst, Math.abs(a[3] - b[3])); worstN = Math.max(worstN, len(sub(a.slice(0, 3), b.slice(0, 3))))
                }
            }
            ok('every value the default: the sweep, flat tube and rounded tube as without values, distance and normal', worst < 1e-12 && worstN < 1e-9, `${worst} ${worstN}`)
        }
        // THE DIVISOR IS NEEDED: one segment's slice min(sx, sy) g(M^-1 q), undivided and unfloored, is steeper than 1 --
        // the more so the farther from the path, so within 1 of it
        {
            const X = VSECTIONS['a rounded rectangle']
            for (const [what, pts, least] of [['a whole turn along half a unit', [[0, 0, 0, 0, 1, 1, 0], [0.5, 0, 0, 0, 1, 1, 360]], 1.5],
                                              ['scale x 1 to 2 along one', [[0, 0, 0, 0, 1, 1, 0], [1, 0, 0, 0, 2, 1, 0]], 1.2]]) {
                const k = S.pathPieces(pts).pieces[0]
                const bare = p => {
                    const l = S.swSegLocalV(p, k.a, k.T, k.N, k.B, k.L, k.va, k.vb, false, X.e)
                    return S.swSegFoldV(S.swStart(), { ...l, lip: 1, cyl: -Infinity, dl: 0 }, X.cross(l.q), k.T, k.N, k.B, k.L, true, true).out
                }
                const F = p => S.pathSweepEvalV([k], p, X.cross, X.e)[3]
                let sb = 0, sf = 0
                for (let i = 0; i < 3000; i++) {
                    const p = [rnd() * k.L, rnd() * 2 - 1, rnd() * 2 - 1], x = add(p, scl(norm(rp1()), 1e-5))
                    sb = Math.max(sb, Math.abs(bare(x) - bare(p)) / 1e-5); sf = Math.max(sf, Math.abs(F(x) - F(p)) / 1e-5)
                }
                ok(`the divisor is needed -- ${what}: the slice alone has a slope of ${sb.toFixed(2)}, with it ${sf.toFixed(4)}`, sb > least && sf <= 1 + 1e-6)
            }
        }
        // THE ROUNDED TUBE, ITS RADIUS SCALED: exact outside against the union of balls (each of its radius along the path,
        // which is what a round cone is); never too deep inside; the normal its gradient. And a step bigger than its
        // segment (one end's ball holding the other's).
        {
            const r = 0.1, ballRef = (pieces, p) => minAlong(pieces, (k, t) => len(sub(p, placeAt(k, t).c)) - r * valuesAt(k, t, true)[0])
            const cases = [...Object.entries(PATHS).map(([n, pts]) => [n, withValues(pts, VALUES['a taper'])]),
                           ['a step bigger than its segment', [[0, 0, 0, 0, 1], [0.1, 0, 0, 0, 3], [0.6, 0.3, 0, 0, 1]]]]
            for (const [pname, pts] of cases) {
                const { pieces } = S.pathPieces(pts), F = p => S.pathTubeEval(pieces, p, r), h = 1e-6
                let worstOut = 0, nOut = 0, disagree = null, deep = 0, nIn = 0, worstG = 0, nG = 0, jumps = 0
                for (let i = 0; i < 100; i++) {
                    let p = box()
                    if (i % 2) { const k = pieces[Math.floor(rnd() * pieces.length)], t = rnd() * (k.kind === 'segment' ? k.L : k.phi); p = add(placeAt(k, t).c, scl(norm(rp1()), r * valuesAt(k, t, true)[0] * (0.5 + rnd()))) }
                    const v = F(p), d = v[3], ref = ballRef(pieces, p)
                    if (Math.abs(d) > 1e-6 && (d < 0) !== (ref < 0)) disagree ??= `${p.map(c => c.toFixed(3))}: d ${d}, union ${ref}`
                    if (d > 1e-4) { worstOut = Math.max(worstOut, Math.abs(d - ref)); nOut++ }
                    if (d < -1e-4) { nIn++; for (let j = 0; j < 8; j++) if (ballRef(pieces, add(p, scl(norm(rp1()), 0.999 * -d))) > 1e-9) { deep++; break } }
                    if (Math.abs(d) > 1e-4 && !onSeam(F, p, v, h)) { worstG = Math.max(worstG, angle(gradOf(F, p, h), v.slice(0, 3))); nG++ }
                }
                for (let l = 0; l < 6; l++) {
                    const a = box(), u = norm(rp1()), st = 0.004
                    let prev = F(a)[3]
                    for (let s = 1; s <= 250; s++) { const cur = F(add(a, scl(u, st * s)))[3]; if (Math.abs(cur - prev) > st * (1 + 1e-6) + 1e-12) jumps++; prev = cur }
                }
                ok(`the rounded tube scaled, ${pname}: outside exact (${nOut}), inside never too deep (${nIn}), no jumps`, worstOut < 1e-6 && nOut > 20 && !deep && nIn > 10 && !jumps && !disagree,
                   `${worstOut.toExponential(2)} ${deep} ${jumps} ${disagree}`)
                ok(`...the normal its gradient`, worstG < 1e-3 && nG > 40, `${worstG.toExponential(2)} over ${nG}`)
            }
            const a = S.pathPieces([[0, 0, 0, 0, 1.5, 0.3, 45], [1, 0, 0, 0.2, 2, 0.1, -90], [1, 1, 0, 0, 0.5, 4, 10]]).pieces
            const b = S.pathPieces([[0, 0, 0, 0, 1.5], [1, 0, 0, 0.2, 2], [1, 1, 0, 0, 0.5]]).pieces
            ok('a tube reads scale x alone: scale y and twist leave it as it was', Array.from({ length: 50 }, box).every(p => {
                const x = S.pathTubeEval(a, p, 0.1), y = S.pathTubeEval(b, p, 0.1), u = S.pathSweepEvalV(a, p, VSECTIONS['a tube of 0.1'].cross, 0.1, true), w = S.pathSweepEvalV(b, p, VSECTIONS['a tube of 0.1'].cross, 0.1, true)
                return x.every((c, j) => c === y[j]) && u.every((c, j) => c === w[j])
            }))
        }
        // EXTREME VALUES, STILL FINITE: a scale of a thousandth, ten turns along an edge, a zero-length segment between fillets
        {
            const bad = []
            for (const pts of [[[0, 0, 0, 0, 0.001], [1, 0, 0, 0, 1000, 0.001, 3600], [1, 1, 0]], [[0, 0, 0], [1, 0, 0, 0.5, 2, 0.5, 90], [1, 0.5, 0, 0, 0.5, 2, -90], [1, 0.5, 1]]]) {
                const { pieces, problems } = S.pathPieces(pts)
                if (problems.length) { bad.push(`${JSON.stringify(pts)}: ${problems}`); continue }
                for (let i = 0; i < 40; i++) {
                    const p = [rnd() * 2 - 0.5, rnd() * 2 - 0.5, rnd() * 2 - 0.5]
                    for (const X of Object.values(VSECTIONS)) { const v = S.pathSweepEvalV(pieces, p, X.cross, X.e, X.round); if (!v.every(Number.isFinite)) bad.push(`${JSON.stringify(pts)}: ${v}`) }
                    const t = S.pathTubeEval(pieces, p, 0.1); if (!t.every(Number.isFinite)) bad.push(`${JSON.stringify(pts)} tube: ${t}`)
                }
            }
            ok('extreme values: finite', !bad.length, bad.slice(0, 3).join('\n      '))
        }
    }
    // WRITTEN WRONG: refused, by point number
    const says = (pts, re) => { const r = S.pathPieces(pts); return r.pieces.length === 0 && r.problems.some(m => re.test(m)) }
    ok('a path: fewer than two points', says([[0, 0, 0]], /at least two/))
    ok('a path: a point not three or four numbers, by its number', says([[0, 0, 0], [1, 0]], /point 2/))
    ok('a path: a negative fillet', says([[0, 0, 0], [1, 0, 0, -1], [1, 1, 0]], /point 2: a fillet radius cannot be negative/))
    ok('a path: a fillet on an end', says([[0, 0, 0, 0.2], [1, 0, 0], [1, 1, 0]], /point 1: an end has no corner/))
    ok('a path: two neighbours the same point', says([[0, 0, 0], [1, 0, 0], [1, 0, 0], [1, 1, 0]], /points 2 and 3 are the same/))
    ok('a path: turning back on itself', says([[0, 0, 0], [1, 0, 0], [0, 0.0001, 0]], /turns back on itself at point 2/))
    ok('a path: fillets too big for their edge', says([[0, 0, 0], [1, 0, 0, 0.8], [1, 0.5, 0, 0.8], [0, 0.5, 0]], /fillets at points 2 and 3 need/))
    ok('a path: a scale of 0 or less, by its point', says([[0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 0]], /point 2: a scale is more than 0/)
        && says([[0, 0, 0], [1, 0, 0, 0, 1, -1], [1, 1, 0]], /point 2: a scale is more than 0/))
    ok('a path: eight entries are too many', says([[0, 0, 0, 0, 1, 1, 0, 1], [1, 0, 0]], /point 1/))
    // PER POINT, THE SECTION'S SCALE X, SCALE Y AND TWIST (2026-10-02): carried by the pieces -- a segment its two points'
    // values, a bend its corner's, the twist in radians -- and whether any is off the defaults
    {
        const plain = S.pathPieces([[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0]])
        const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
        eq('a path with none: every value the default, and it does not vary',
            [plain.varies, plain.pieces.map(k => k.kind === 'segment' ? [k.va, k.vb] : k.v)], [false, [[[1, 1, 0], [1, 1, 0]], [1, 1, 0], [[1, 1, 0], [1, 1, 0]]]])
        const r = S.pathPieces([[0, 0, 0, 0, 2], [1, 0, 0, 0.2, 1.5, 0.5, 90], [1, 1, 0, 0, 1, 1, -45]])
        eq('scale y is scale x\'s when left off; the twist in radians; a segment its two points\', a bend its corner\'s',
            [r.varies, r.pieces.map(k => k.kind === 'segment' ? [k.va, k.vb] : k.v)],
            [true, [[[2, 2, 0], [1.5, 0.5, Math.PI / 2]], [1.5, 0.5, Math.PI / 2], [[1.5, 0.5, Math.PI / 2], [1, 1, -Math.PI / 4]]]])
        eq('...and the geometry is the same as without them', JSON.stringify(r.pieces.map(({ va, vb, v, ...g }) => g)),
            JSON.stringify(S.pathPieces([[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0]]).pieces.map(({ va, vb, v, ...g }) => g)))
    }
    // THE WGSL: one block per piece in each function, every number a float literal
    {
        const { pieces } = S.pathPieces(PATHS['an S in 3D, bends in different planes'])
        const w = S.pathWGSL('path_n1_route', pieces)
        ok('a path\'s WGSL: its two functions', w.includes('fn path_n1_route_near(p: VEC3) -> PathNear {') && w.includes('fn path_n1_route_sweep(p: VEC3, prof: u32, r: FLOAT, e: FLOAT) -> VEC4 {'))
        ok('...one call per piece in each', (w.match(/A = pn(Segment|Bend)\(/g) || []).length === pieces.length && (w.match(/swSegLocal\(|swBendLocal\(/g) || []).length === pieces.length)
        const bare = w.match(/[(,]\s*-?\d+\s*[,)]/g)
        ok('...every number a float literal', !bare, bare?.join(' '))
    }
    /* A LIVE CHAIN'S LOOP HAS A BOUND THE COMPILER CANNOT SEE (2026-10-02), as noise.test asks of the noise: every
       compiler behind WebGPU inlines every call and unrolls a loop whose bound it can see (tracebasics.js noUnroll), and
       the first bound, min(count, slots), told it the loop ran at most `slots` times -- a copy a slot again, inferred */
    {
        const { pieces } = S.pathPieces(PATHS['an S in 3D, bends in different planes'])
        const pathOps = k => k.kind === 'segment'
            ? { a: 'sl.m[0].xyz', L: 'sl.m[0].w', T: 'sl.m[1].xyz', N: 'sl.m[2].xyz', B: 'sl.m[3].xyz', first: 'false', last: 'false', va: 'sl.v[0].xyz', vb: 'sl.v[1].xyz' }
            : { c: 'sl.m[0].xyz', R: 'sl.m[0].w', k: 'sl.m[1].xyz', u0: 'sl.m[2].xyz', u1: 'sl.m[3].xyz', f: 'sl.f', v: 'sl.v[0].xyz' }
        const profOps = k => k.kind === 'arc' ? { c: 'sl[0].xy', r: 'sl[0].z', a: 'sl[1].xy', b: 'sl[1].zw', convex: 'true', on: 'true' }
            : { a: 'sl[0].xy', b: 'sl[0].zw', surface: 'true', on: 'true' }
        const texts = [false, true].map(vary => S.pathWGSL('path_n1_route', pieces, { operands: pathOps, slots: 9, slot: i => ({ m: `UB.m${i}` }), count: 'UB.n', vary }))
            .concat(S.profileWGSL('prof_n1_o', S.profilePieces([[0, 0], [1, 0, 0.2], [0, 1]]).pieces, { operands: profOps, slots: 6, slot: i => `UB.q${i}`, count: 'UB.qn' }))
        const loops = texts.flatMap(t => t.match(/for \([^)]*\)[^{]*\{/g) || [])
        const bad = loops.filter(l => !/<\s*noUnroll\(/.test(l))
        ok('a live path\'s and profile\'s loops: each bound through noUnroll', loops.length === 5 && !bad.length, `${loops.length} loops; not through noUnroll: ${bad.join(' | ')}`)
    }
}

//----------------------------------------------------------------------------------------------------------------------
// THE SLOTS A LIVE CHAIN IS WRITTEN IN (2026-10-02): every piece in a slot of its own kind, in order, so with the slots
// that are off left out the chain is the compiled chain; spare room is slots that are off
//----------------------------------------------------------------------------------------------------------------------
{
    const kindAt = { path: i => i % 2 ? 'bend' : 'segment', profile: i => i % 2 ? 'segment' : 'arc' }
    const check = (what, kind, pieces, room) => {
        const slots = (kind === 'path' ? S.pathSlotsOf : S.profileSlotsOf)(pieces, room)
        const count = (kind === 'path' ? S.pathSlotCount : S.profileSlotCount)(room)
        ok(`${what}: ${count} slots, each piece in one of its kind, in order, nothing lost`,
            slots.length === count && slots.every((p, i) => !p || p.kind === kindAt[kind](i)) && JSON.stringify(slots.filter(Boolean)) === JSON.stringify(pieces),
            slots.map(p => p ? p.kind[0] : '-').join(''))
    }
    const bent = [[-0.5, -0.5, 0], [0.5, -0.5, 0, 0.2], [0.5, 0.5, 0, 0.2], [0.5, 0.5, 0.6]]
    check('a path', 'path', S.pathPieces(bent).pieces, 4)
    check('...with room for 8 more', 'path', S.pathPieces(bent).pieces, 12)
    check('...a straight corner (no bend: its slot off)', 'path', S.pathPieces([[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0]]).pieces, 4)
    check('...two points', 'path', S.pathPieces([[0, 0, 0], [1, 0, 0]]).pieces, 2)
    check('a profile, some corners filleted', 'profile', S.profilePieces([[0, 0], [1, 0, 0.2], [1, 1], [0, 1, 0.1]]).pieces, 4)
    check('...clockwise (laid in counter-clockwise)', 'profile', S.profilePieces([[0, 1, 0.1], [1, 1], [1, 0, 0.2], [0, 0]]).pieces, 6)
    // two fillets that use their edge up between them: no segment there, an arc after an arc
    const used = S.profilePieces([[0, 0, 0.5], [1, 0, 0.5], [1, 1], [0, 1]]).pieces
    ok('(an edge used up by its two fillets: no segment between the arcs)', used.map(p => p.kind[0]).join('').includes('aa'), used.map(p => p.kind[0]).join(''))
    check('...each arc still in an arc slot', 'profile', used, 4)
    check('...every corner filleted', 'profile', S.profilePieces([[0, 0, 0.1], [1, 0, 0.1], [1, 1, 0.1], [0, 1, 0.1]]).pieces, 4)
}

console.log(`shapes: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
