//======================================================================================================================
// THE WINDOW OF AN ARRAY (0.next): a regular row or ring of copies evaluated at the few copies near the point, the rest
// bounded -- where every copy was evaluated at every step of every ray.
//
// WHY. An array's children are once in the text and walked once a copy (model.js copies; codegen.js AN ARRAY; the scene
// as data's ARRAY records): at every march and shadow step, every copy. Measured (the user's Ampere, Tests > lightarray,
// 213642c, 2026-10-23): a floor under one 4 cm light 12.3 ms of march a sample; the same light in a ring of 16 rows of 16
// copies, 256 faces, 465 ms of march and 160 of occlusion -- light sampling's pick of a face, the scan that was suspected,
// unchanged at 20 ms from 1 face to 256. The faces were cheap; there were simply 256 of them at every step.
//
// THE PATTERN (copyPattern). A list of copies is any list of transforms, so only two shapes are recognised, from the
// copies' own matrices (transform.js matrixOf: what the shader reads), and nothing in a file says which:
//   a ROW   every copy turned and scaled as the first, the positions in arithmetic progression -- copiesRow, a bound
//           copies.count with copies.pitch;
//   a RING  every copy the first turned about the group's x, y or z axis by k 360/n (either way round), its own
//           rotation turned with it and its scale the first's -- copiesRing.
// Anything else (a copy dragged off its row) is null: every copy evaluated, as before.
//
// THE BOUND (one rule for both). The copies' content -- the array's children, in a copy's frame -- has a measured box
// (boxes.js cullBoxes, `contentKey`); its sphere, centre c and radius r, carried by copy k is centre c_k and radius
// rho = r s (one scale for all). A copy's shape is inside its sphere, so |q - c_k| - rho is a lower bound on its
// distance from q. Along a row |q - c_k| is convex in k, least at the copy nearest q's projection on the row; round a
// ring it grows with the angle from the copy nearest q's angle about the axis, both ways to the opposite side. So from
// that nearest copy the window widens a copy at a time on each side while the next copy's bound is within cullMargin();
// every copy outside it is no nearer than the first one each side stopped at, and that bound stands in for all of them
// in CULL -- the contract the top-level culling already rests on (codegen.js BOUNDING-BOX CULLING, scene_api.js
// cullMargin): a lower bound, above the margin, so never taken for a surface. Near a surface every copy within the
// margin is evaluated and the field is exact; far from them it is a bound, as for any culled node.
//
// WHERE: only where culling is -- the render copy (never the pick, which the boxes are measured by, nor a limiter's optics
// copies), an array with only plain groups and arrays above it (a lower bound on a shape is not one on what it is joined
// into or what code makes of it), not one of a CSG group's shapes, and only once its content box is known: unknown, it
// is the loop over every copy as before.
//
// PURE. windowOf is the shader's arithmetic in JS, for test/arrays.test.mjs to hold against every copy by brute force.
//======================================================================================================================

import { matrixOf } from './transform.js'

/* agreement to this relative part: copiesRow and copiesRing round to 12 digits, the shader reads f32 */
const TOL = 1e-7
/** The pattern codes the scene as data carries (an ARRAY record's v0.z) and codegen compiles in: 0 none, 1 a row, and a
 *  ring 2 + 2 axis + (1 when it turns the negative way), axis 0 x, 1 y, 2 z. */
export const PATTERN_NONE = 0, PATTERN_ROW = 1
export const ringCode = (axis, sign) => 2 + 2 * axis + (sign < 0 ? 1 : 0)
export const codeOf = p => !p ? PATTERN_NONE : p.kind === 'row' ? PATTERN_ROW : ringCode(p.axis, p.sign)

const rotOf = m => [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]      // rows of R
const posOf = m => [m[12], m[13], m[14]]
const mul3 = (A, B) => A.map(row => [0, 1, 2].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]))
const mulv = (A, v) => A.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
const near = (a, b, scale) => Math.abs(a - b) <= TOL * Math.max(1, scale)
/** The rotation by `a` radians about axis 0 (x), 1 (y) or 2 (z), as rows -- matrixOf's own Rx, Ry, Rz. */
export function axisRot(axis, a) {
    const c = Math.cos(a), s = Math.sin(a)
    if (axis === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]]
    if (axis === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]
}

/**
 * A list of copies as a row or a ring, or null. { kind: 'row', n } | { kind: 'ring', n, axis, sign }.
 */
export function copyPattern(copies) {
    if (!Array.isArray(copies) || copies.length < 2) return null
    const M = copies.map(t => matrixOf(t)), n = M.length
    const R = M.map(rotOf), P = M.map(posOf), S = M.map(m => m[15])
    if (!S.every(s => near(s, S[0], S[0]))) return null
    const size = Math.max(1, ...P.map(p => Math.hypot(...p)))
    const sameR = (A, B) => A.every((row, i) => row.every((v, j) => near(v, B[i][j], 1)))
    const sameP = (a, b) => a.every((v, i) => near(v, b[i], size))
    // A ROW: one rotation, positions p0 + k (p1 - p0)
    const step = P[1].map((v, i) => v - P[0][i])
    if (R.every(r => sameR(r, R[0])) && P.every((p, k) => sameP(p, P[0].map((v, i) => v + k * step[i])))) return { kind: 'row', n }
    // A RING: copy k the first turned about an axis by k 2 pi / n, either way
    for (const axis of [0, 1, 2]) for (const sign of [1, -1]) {
        const ok = M.every((_, k) => {
            const T = axisRot(axis, sign * 2 * Math.PI * k / n)
            return sameR(R[k], mul3(T, R[0])) && sameP(P[k], mulv(T, P[0]))
        })
        if (ok) return { kind: 'ring', n, axis, sign }
    }
    return null
}

/** The key cullBoxes gives an array's content box under, and so its uniforms' names (codegen boxLoName): a suffix no
 *  node id has (model.js ID: letters and digits). */
export const contentKey = id => `${id}_cbx`

/**
 * THE WINDOW, as the shader works it out -- for the tests. `q` the point in the array group's frame, `copies` its list,
 * `box` its content box { lo, hi } in a copy's frame, `margin` cullMargin() and `scale` the group frame's to the world.
 * Returns { window: [copy index, ...] in the order walked, bound: the lower bound folded for the rest (Infinity: none) }.
 */
export function windowOf(q, copies, pattern, box, margin, scale = 1) {
    const n = copies.length
    if (!pattern || !box) return { window: copies.map((_, k) => k), bound: Infinity }
    const M = copies.map(t => matrixOf(t))
    const c = box.lo.map((v, i) => 0.5 * (v + box.hi[i]))
    const r = 0.5 * Math.hypot(...box.hi.map((v, i) => v - box.lo[i]))
    const s = M[0][15]
    const centre = m => { const R = rotOf(m), v = mulv(R, c); return posOf(m).map((p, i) => p + m[15] * v[i]) }
    const c0 = centre(M[0])
    const rho = r * s + slackOf(c0, r * s)
    let ck
    if (pattern.kind === 'row') {
        const d = centre(M[1]).map((v, i) => v - c0[i])
        ck = k => c0.map((v, i) => v + k * d[i])
    } else ck = k => mulv(axisRot(pattern.axis, pattern.sign * 2 * Math.PI * k / n), c0)
    const bound = k => (Math.hypot(...q.map((v, i) => v - ck(k)[i])) - rho) * scale
    const i0 = nearestOf(q, pattern, n, c0, ck)
    if (bound(i0) > margin) return { window: [], bound: bound(i0) }
    const ring = pattern.kind === 'ring'
    const at = k => ring ? ((k % n) + n) % n : k
    const inside = k => ring || (k >= 0 && k < n)
    let a = 0, b = 0
    while (a + b + 1 < n && inside(i0 + b + 1) && bound(at(i0 + b + 1)) <= margin) b++
    while (a + b + 1 < n && inside(i0 - a - 1) && bound(at(i0 - a - 1)) <= margin) a++
    let rest = Infinity
    if (a + b + 1 < n) {
        if (inside(i0 + b + 1)) rest = Math.min(rest, bound(at(i0 + b + 1)))
        if (inside(i0 - a - 1)) rest = Math.min(rest, bound(at(i0 - a - 1)))
    }
    return { window: Array.from({ length: a + b + 1 }, (_, m) => at(i0 - a + m)), bound: rest }
}
/* THE SLACK on the sphere's radius: the copies' centres are worked out by the pattern's formula, the copies drawn by their
   own matrices, both in f32 -- a part in 1e5 of the farthest the content reaches, so the bound is never above the truth */
export const SLACK = 1e-5
const slackOf = (c0, rho) => SLACK * (Math.hypot(...c0) + rho)
/* the copy nearest q: a row's at q's projection on it, a ring's at q's angle about its axis -- relative to copy 0's */
function nearestOf(q, pattern, n, c0, ck) {
    if (pattern.kind === 'row') {
        const d = ck(1).map((v, i) => v - c0[i]), dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
        const t = dd > 0 ? ((q[0] - c0[0]) * d[0] + (q[1] - c0[1]) * d[1] + (q[2] - c0[2]) * d[2]) / dd : 0
        return Math.min(n - 1, Math.max(0, Math.round(t)))
    }
    const [u, v] = [[1, 2], [2, 0], [0, 1]][pattern.axis]          // the plane about the axis, turned u towards v
    const ang = (x, y) => (x === 0 && y === 0) ? 0 : Math.atan2(y, x)
    const d = ang(q[u], q[v]) - ang(c0[u], c0[v])
    const k = Math.round(pattern.sign * d / (2 * Math.PI / n))
    return ((k % n) + n) % n
}

/* THE SHADER'S HALF: the window as windowOf works it out, for codegen's copies loop and the scene as data's ARRAY record
   alike, emitted once in a scene with an array that can have one. `kind` the pattern's code, `c0` copy 0's content centre
   and `d` a row's step between centres (a ring's is unused), in the array group's frame; `rho` the content's radius with
   its slack; `scale` the group frame's to the world. ArrWin: the first copy of the window (a ring's taken modulo n by the
   caller), how many, and the bound on every copy outside it (1e7: none). */
export const ARRAY_WINDOW_WGSL = /*wgsl*/`
struct ArrWin { first: i32, count: u32, bound: FLOAT }
fn arrCentre(kind: u32, c0: VEC3, d: VEC3, k: i32, n: u32) -> VEC3 {
    if (kind == ${PATTERN_ROW}u) { return c0 + f32(k) * d; }
    let ax = (kind - 2u) / 2u;
    let a = select(1.0, -1.0, ((kind - 2u) & 1u) == 1u) * 6.283185307179586 * f32(k) / f32(n);
    let c = cos(a); let s = sin(a);
    if (ax == 0u) { return VEC3(c0.x, c * c0.y - s * c0.z, s * c0.y + c * c0.z); }
    if (ax == 1u) { return VEC3(c * c0.x + s * c0.z, c0.y, c * c0.z - s * c0.x); }
    return VEC3(c * c0.x - s * c0.y, s * c0.x + c * c0.y, c0.z);
}
fn arrBound(kind: u32, p: VEC3, c0: VEC3, d: VEC3, k: i32, n: u32, rho: FLOAT, scale: FLOAT) -> FLOAT {
    return (length(p - arrCentre(kind, c0, d, k, n)) - rho) * scale;
}
fn arrAngle(y: FLOAT, x: FLOAT) -> FLOAT { return select(atan2(y, x), 0.0, x == 0.0 && y == 0.0); }
fn arrWindow(kind: u32, n: u32, p: VEC3, c0: VEC3, d: VEC3, rho: FLOAT, scale: FLOAT) -> ArrWin {
    let ni = i32(n);
    var i0 = 0;
    if (kind == ${PATTERN_ROW}u) {
        // a row: the copy at the point's projection on it
        let t = dot(p - c0, d) / max(dot(d, d), 1e-30);
        i0 = i32(clamp(round(t), 0.0, f32(n - 1u)));
    } else {
        // a ring: the copy at the point's angle about its axis, from copy 0's -- in the plane about the axis, u turned
        // towards v as the copies turn
        let ax = (kind - 2u) / 2u;
        var pu = p.y; var pv = p.z; var cu = c0.y; var cv = c0.z;
        if (ax == 1u) { pu = p.z; pv = p.x; cu = c0.z; cv = c0.x; }
        if (ax == 2u) { pu = p.x; pv = p.y; cu = c0.x; cv = c0.y; }
        let sg = select(1.0, -1.0, ((kind - 2u) & 1u) == 1u);
        let k = i32(round(sg * (arrAngle(pv, pu) - arrAngle(cv, cu)) / (6.283185307179586 / f32(n))));
        i0 = ((k % ni) + ni) % ni;
    }
    let margin = cullMargin();
    let b0 = arrBound(kind, p, c0, d, i0, n, rho, scale);
    if (b0 > margin) { return ArrWin(i0, 0u, b0); }      // the nearest is beyond the margin: so is every other
    let ring = kind != ${PATTERN_ROW}u;
    var a = 0;
    var b = 0;
    loop {
        if (a + b + 1 >= ni || (!ring && i0 + b + 1 >= ni)) { break; }
        if (arrBound(kind, p, c0, d, i0 + b + 1, n, rho, scale) > margin) { break; }
        b = b + 1;
    }
    loop {
        if (a + b + 1 >= ni || (!ring && i0 - a - 1 < 0)) { break; }
        if (arrBound(kind, p, c0, d, i0 - a - 1, n, rho, scale) > margin) { break; }
        a = a + 1;
    }
    var rest: FLOAT = 1.0e7;
    if (a + b + 1 < ni) {
        if (ring || i0 + b + 1 < ni) { rest = min(rest, arrBound(kind, p, c0, d, i0 + b + 1, n, rho, scale)); }
        if (ring || i0 - a - 1 >= 0) { rest = min(rest, arrBound(kind, p, c0, d, i0 - a - 1, n, rho, scale)); }
    }
    return ArrWin(i0 - a, u32(a + b + 1), rest);
}
`
