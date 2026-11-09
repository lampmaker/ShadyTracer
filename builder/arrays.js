//======================================================================================================================
// THE WINDOW OF AN ARRAY (0.79.0): a regular row or ring of copies evaluated at the few copies near the point, the rest
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
// THE BOUND. The copies' content -- the array's children, in a copy's frame -- has a measured box (boxes.js cullBoxes,
// `contentKey`); a copy's shape is inside its box, so a lower bound on the distance to the box is one on the distance to
// the copy. From the copy nearest the point the window widens a copy at a time on each side while the next copy's bound
// is within cullMargin(); every copy outside it is no nearer than the first one each side stopped at, and that bound
// stands in for all of them in CULL -- the contract the top-level culling already rests on (codegen.js BOUNDING-BOX
// CULLING, scene_api.js cullMargin): a lower bound, above the margin, so never taken for a surface. Near a surface every
// copy within the margin is evaluated and the field is exact; far from them it is a bound, as for any culled node.
//   A ROW   the box's own distance: every copy is turned and scaled alike, so in copy 0's frame copy k's box is copy 0's
//           moved by k steps, and the distance to a box moved along a line is convex in how far -- least at one copy,
//           growing each way from it, found by walking downhill from the copy at the point's projection on the row.
//   A RING  the sphere round copy k's box, which grows with the angle from the copy at the point's angle about the axis,
//           both ways to the opposite side -- and never below the distance to the (r, z) annulus that every copy lies in,
//           turning about the axis keeping both: what bounds a flat ring above and below it, where its sphere does not.
// UNTIL 2026-10-25 BOTH WERE THE SPHERE, and a node in an array measured as all its copies (boxes.js toOwnLocalOf): the
// user's Pascal card marched the bench's ring of 256 lights in 1007.5 ms a sample with the window, 281.0 without. A
// sphere is far from a flat or a long content, and the march took its distance for a surface's: counted on lavapipe, 47
// steps a camera ray against 22 with the bench's measured boxes, 30 against 21 with both put right (arraywindow.gpu.mjs).
// With both put right, measured on the same card (f4a2a57): 119.8 ms a sample with the window, 389.4 without.
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
    const bc = box.lo.map((v, i) => 0.5 * (v + box.hi[i])), bh0 = box.lo.map((v, i) => 0.5 * (box.hi[i] - v))
    const R0 = rotOf(M[0]), P0 = posOf(M[0]), s = M[0][15]
    const Rt = [0, 1, 2].map(i => [R0[0][i], R0[1][i], R0[2][i]])
    const len = v => Math.hypot(...v)
    const ring = pattern.kind === 'ring'
    let bound, i0, all = 0
    if (!ring) {
        /* A ROW: copy k's box is copy 0's moved by k dp in copy 0's frame, its distance convex in k */
        const q0 = mulv(Rt, q.map((v, i) => v - P0[i])).map(v => v / s)
        const dp = mulv(Rt, posOf(M[1]).map((v, i) => v - P0[i])).map(v => v / s)
        const e = SLACK * (len(P0) / s + len(bc) + len(bh0) + n * len(dp)), bh = bh0.map(v => v + e)
        bound = k => len(q0.map((v, i) => Math.max(Math.abs(v - k * dp[i] - bc[i]) - bh[i], 0))) * s * scale
        const dd = dp[0] ** 2 + dp[1] ** 2 + dp[2] ** 2
        i0 = Math.min(n - 1, Math.max(0, Math.round(dd > 0 ? ((q0[0] - bc[0]) * dp[0] + (q0[1] - bc[1]) * dp[1] + (q0[2] - bc[2]) * dp[2]) / dd : 0)))
        while (i0 + 1 < n && bound(i0 + 1) < bound(i0)) i0++
        while (i0 > 0 && bound(i0 - 1) < bound(i0)) i0--
    } else {
        /* A RING: the sphere round copy k's box, and the (r, z) annulus every copy is in */
        const r = len(bh0) * s
        const c0 = P0.map((v, i) => v + s * mulv(R0, bc)[i])
        const rho = r + slackOf(c0, r)
        const ck = k => mulv(axisRot(pattern.axis, pattern.sign * 2 * Math.PI * k / n), c0)
        bound = k => (len(q.map((v, i) => v - ck(k)[i])) - rho) * scale
        i0 = nearestOf(q, pattern, n, c0, ck)
        const ax = pattern.axis, perp = v => Math.hypot(...v.filter((_, i) => i !== ax))
        const zh = s * [0, 1, 2].reduce((t, i) => t + Math.abs(R0[ax][i]) * bh0[i], 0) + (rho - r)
        const rc = perp(c0), pr = perp(q)
        const gr = Math.max(Math.max(rc - rho, 0) - pr, pr - (rc + rho), 0), gz = Math.max(Math.abs(q[ax] - c0[ax]) - zh, 0)
        all = Math.hypot(gr, gz) * scale
    }
    if (Math.max(bound(i0), all) > margin) return { window: [], bound: Math.max(bound(i0), all) }
    const at = k => ring ? ((k % n) + n) % n : k
    const inside = k => ring || (k >= 0 && k < n)
    let a = 0, b = 0
    while (a + b + 1 < n && inside(i0 + b + 1) && bound(at(i0 + b + 1)) <= margin) b++
    while (a + b + 1 < n && inside(i0 - a - 1) && bound(at(i0 - a - 1)) <= margin) a++
    let rest = Infinity
    if (a + b + 1 < n) {
        if (inside(i0 + b + 1)) rest = Math.min(rest, bound(at(i0 + b + 1)))
        if (inside(i0 - a - 1)) rest = Math.min(rest, bound(at(i0 - a - 1)))
        rest = Math.max(rest, all)
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
/* a ring's turn of copy k (axisRot by sign k 2 pi / n) applied to v */
fn arrTurn(kind: u32, v: VEC3, k: i32, n: u32) -> VEC3 {
    let ax = (kind - 2u) / 2u;
    let a = select(1.0, -1.0, ((kind - 2u) & 1u) == 1u) * 6.283185307179586 * f32(k) / f32(n);
    let c = cos(a); let s = sin(a);
    if (ax == 0u) { return VEC3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
    if (ax == 1u) { return VEC3(c * v.x + s * v.z, v.y, c * v.z - s * v.x); }
    return VEC3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
}
fn arrCentre(kind: u32, c0: VEC3, d: VEC3, k: i32, n: u32) -> VEC3 {
    if (kind == ${PATTERN_ROW}u) { return c0 + f32(k) * d; }
    return arrTurn(kind, c0, k, n);
}
/* COPY k'S MATRIX FROM COPY 0'S (codegen's windowed loop): a row's moved by k steps d between positions, a ring's
   turned -- its rotation's columns and its position, its scale kept. Worked out, not picked by a switch on k, which
   differs from pixel to pixel in a window (codegen.js AN ARRAY) */
fn arrCopy(kind: u32, n: u32, T0: mat4x4<f32>, d: VEC3, k: i32) -> mat4x4<f32> {
    if (kind == ${PATTERN_ROW}u) { return mat4x4<f32>(T0[0], T0[1], T0[2], vec4<f32>(T0[3].xyz + f32(k) * d, T0[3].w)); }
    return mat4x4<f32>(vec4<f32>(arrTurn(kind, T0[0].xyz, k, n), T0[0].w), vec4<f32>(arrTurn(kind, T0[1].xyz, k, n), T0[1].w),
                       vec4<f32>(arrTurn(kind, T0[2].xyz, k, n), T0[2].w), vec4<f32>(arrTurn(kind, T0[3].xyz, k, n), T0[3].w));
}
fn arrBound(kind: u32, p: VEC3, c0: VEC3, d: VEC3, k: i32, n: u32, rho: FLOAT, scale: FLOAT) -> FLOAT {
    return (length(p - arrCentre(kind, c0, d, k, n)) - rho) * scale;
}
fn arrAngle(y: FLOAT, x: FLOAT) -> FLOAT { return select(atan2(y, x), 0.0, x == 0.0 && y == 0.0); }
fn arrBox(v: VEC3, bc: VEC3, bh: VEC3) -> FLOAT { return length(max(abs(v - bc) - bh, VEC3(0.0))); }
/* THE WINDOW from copy 0's frame (R0, P0, S0; P1 copy 1's place, a row's), the content's box lo..hi in a copy's frame and
   the group frame's scale to the world -- what codegen's copies loop and the scene as data's ARRAY record each have */
fn arrWindowOf(kind: u32, n: u32, p: VEC3, R0: mat3x3<f32>, P0: VEC3, S0: FLOAT, P1: VEC3, lo: VEC3, hi: VEC3, scale: FLOAT) -> ArrWin {
    let bc = 0.5 * (lo + hi);
    let bh0 = 0.5 * (hi - lo);
    if (kind == ${PATTERN_ROW}u) {
        let q0 = (transpose(R0) * (p - P0)) / S0;
        let dp = (transpose(R0) * (P1 - P0)) / S0;
        let e = ${SLACK} * (length(P0) / S0 + length(bc) + length(bh0) + f32(n) * length(dp));
        return arrWindowRow(n, q0, dp, bc, bh0 + VEC3(e), S0 * scale);
    }
    let r = length(bh0) * S0;
    let c0 = P0 + S0 * (R0 * bc);
    let rho = r + ${SLACK} * (length(c0) + r);
    let ax = (kind - 2u) / 2u;
    // the content along the axis, exactly: copy 0's box projected on it (R0[i][ax], column i's part along the axis)
    let zh = S0 * dot(abs(VEC3(R0[0][ax], R0[1][ax], R0[2][ax])), bh0) + (rho - r);
    return arrWindowRing(kind, n, p, c0, rho, zh, scale);
}
/* A ROW: copy k's box is copy 0's moved by k dp in copy 0's frame, so its distance is convex in k -- downhill from the
   copy at the point's projection to the least, then out each way while within the margin; the first beyond it each
   way bounds every copy past it */
fn arrRowBound(q0: VEC3, dp: VEC3, k: i32, bc: VEC3, bh: VEC3, fs: FLOAT) -> FLOAT { return arrBox(q0 - f32(k) * dp, bc, bh) * fs; }
fn arrWindowRow(n: u32, q0: VEC3, dp: VEC3, bc: VEC3, bh: VEC3, fs: FLOAT) -> ArrWin {
    let ni = i32(n);
    let t = dot(q0 - bc, dp) / max(dot(dp, dp), 1e-30);
    var i0 = i32(clamp(round(t), 0.0, f32(n - 1u)));
    var g0 = arrRowBound(q0, dp, i0, bc, bh, fs);
    loop {
        if (i0 + 1 >= ni) { break; }
        let g1 = arrRowBound(q0, dp, i0 + 1, bc, bh, fs);
        if (g1 >= g0) { break; }
        i0 = i0 + 1; g0 = g1;
    }
    loop {
        if (i0 < 1) { break; }
        let g1 = arrRowBound(q0, dp, i0 - 1, bc, bh, fs);
        if (g1 >= g0) { break; }
        i0 = i0 - 1; g0 = g1;
    }
    let margin = cullMargin();
    if (g0 > margin) { return ArrWin(i0, 0u, g0); }      // the least is beyond the margin: so is every other
    var a = 0;
    var b = 0;
    loop {
        if (i0 + b + 1 >= ni) { break; }
        if (arrRowBound(q0, dp, i0 + b + 1, bc, bh, fs) > margin) { break; }
        b = b + 1;
    }
    loop {
        if (i0 - a - 1 < 0) { break; }
        if (arrRowBound(q0, dp, i0 - a - 1, bc, bh, fs) > margin) { break; }
        a = a + 1;
    }
    var rest: FLOAT = 1.0e7;
    if (i0 + b + 1 < ni) { rest = min(rest, arrRowBound(q0, dp, i0 + b + 1, bc, bh, fs)); }
    if (i0 - a - 1 >= 0) { rest = min(rest, arrRowBound(q0, dp, i0 - a - 1, bc, bh, fs)); }
    return ArrWin(i0 - a, u32(a + b + 1), rest);
}
/* A RING: the sphere round copy k's box grows with the angle from the copy at the point's angle, both ways -- and every
   copy is in one (r, z) annulus about the axis (turning keeps both), a bound on all of them at once, which the sphere
   is not above or below a flat ring */
fn arrWindowRing(kind: u32, n: u32, p: VEC3, c0: VEC3, rho: FLOAT, zh: FLOAT, scale: FLOAT) -> ArrWin {
    let ni = i32(n);
    let ax = (kind - 2u) / 2u;
    var pu = p.y; var pv = p.z; var cu = c0.y; var cv = c0.z;
    if (ax == 1u) { pu = p.z; pv = p.x; cu = c0.z; cv = c0.x; }
    if (ax == 2u) { pu = p.x; pv = p.y; cu = c0.x; cv = c0.y; }
    let sg = select(1.0, -1.0, ((kind - 2u) & 1u) == 1u);
    let k = i32(round(sg * (arrAngle(pv, pu) - arrAngle(cv, cu)) / (6.283185307179586 / f32(n))));
    let i0 = ((k % ni) + ni) % ni;
    let rc = length(VEC2(cu, cv)); let pr = length(VEC2(pu, pv));
    let gr = max(max(max(rc - rho, 0.0) - pr, pr - (rc + rho)), 0.0);
    let gz = max(abs(p[ax] - c0[ax]) - zh, 0.0);
    let all = length(VEC2(gr, gz)) * scale;
    let d = VEC3(0.0);
    let margin = cullMargin();
    let b0 = max(arrBound(kind, p, c0, d, i0, n, rho, scale), all);
    if (b0 > margin) { return ArrWin(i0, 0u, b0); }       // the nearest is beyond the margin: so is every other
    var a = 0;
    var b = 0;
    loop {
        if (a + b + 1 >= ni) { break; }
        if (arrBound(kind, p, c0, d, i0 + b + 1, n, rho, scale) > margin) { break; }
        b = b + 1;
    }
    loop {
        if (a + b + 1 >= ni) { break; }
        if (arrBound(kind, p, c0, d, i0 - a - 1, n, rho, scale) > margin) { break; }
        a = a + 1;
    }
    var rest: FLOAT = 1.0e7;
    if (a + b + 1 < ni) {
        rest = min(arrBound(kind, p, c0, d, i0 + b + 1, n, rho, scale), arrBound(kind, p, c0, d, i0 - a - 1, n, rho, scale));
        rest = max(rest, all);
    }
    return ArrWin(i0 - a, u32(a + b + 1), rest);
}
`
