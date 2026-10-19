//======================================================================================================================
// FEWER AND CHEAPER STEPS -- chapter 26's figures run this. Pure.
//
// A flat-world scene of top-level nodes, as codegen's root sees them, marched a ray at a time with a count of what
// each step paid. Three of ShadyTracer's ways to pay less, each written as the engine writes it:
//
//   CULLING BOXES   codegen.js culled + scene_api.js cullDist: a boxed node farther than cullMargin() from its box is
//                   not evaluated; its box's distance stands in, a bound on all of them (CULL), and the scene's answer
//                   is that bound wherever it is nearer than the nearest node evaluated. 'all' boxes every node that
//                   has one; 'dear' (the builder's way since 0.34.0) only those dearer than their box -- here the
//                   reliefs and the groups, never one plain shape.
//   THE RELIEF SHELL builder/modifiers.js reliefCode: beyond twice the noise's reach (plus the hit tolerance times
//                   slope + 1) from the plain shape, the plain distance less the reach, no noise; inside, the fBm,
//                   divided by the slope bound. Without the shell, noise and division at every step (the frozen bench
//                   scene's group code, bench/scenes/noise.json).
//   THE STEP CACHE  core/wavefront.js stepCacheWGSL scStep: a grid of cells, each the scene's distance at its centre,
//                   a ball with no surface in it; a ray inside a ball that holds it at least a cell moves to where it
//                   leaves the ball, with no scene evaluation. Never on the last step of a 32-step march pass.
//
// THE COSTS are a model's, in units of one plain shape's evaluation: a box test 1 (codegen.js ONLY THE DEAR ONES: a
// box test "is about what the shape's own evaluation is"), a noise octave 4, so a relief's four octaves 16 on top of
// its plain shape. Chosen so the reliefs dominate a scene's steps as they did the Noise library's (each relief alone
// added 72 to 91 ms to a scene that took 81.1 without them, docs/PERFORMANCE.md); not a measurement.
//======================================================================================================================

import { fbm3, nzFbmLip, NZ_GRAD_VALUE_BOUND, NZ_GRAD_LIP_MEASURED, NZ_RELIEF_LIP_MEASURED } from '../../lib/pathtracer/core/noise.js'

export const COST = { shape: 1, box: 1, octave: 4 }
export const OCTAVES = 4
export const PEAK = nzFbmLip(OCTAVES, 1, 0.5, 1)                        // the octaves' amplitudes summed: 1.875
export const LIP = { modifier: nzFbmLip(OCTAVES, 2, 0.5, NZ_GRAD_LIP_MEASURED), measured: NZ_RELIEF_LIP_MEASURED }   // 17.2, 11.2
export const MARCH_STEPS = 32                                         // a march pass's steps (wavefront.js MAX_STEPS)

const hyp = Math.hypot
/** scene_api.js cullDist: the distance from (x, y) to the box lo..hi, exact, negative inside; -1 when the box is not
 *  known (here: null) */
export function cullDist(x, y, box) {
    if (!box) return -1
    const dx = Math.abs(x - (box.lo[0] + box.hi[0]) / 2) - (box.hi[0] - box.lo[0]) / 2
    const dy = Math.abs(y - (box.lo[1] + box.hi[1]) / 2) - (box.hi[1] - box.lo[1]) / 2
    return hyp(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
}

/** a relief's slope bound and its noise's reach, as reliefCode computes them (XF_S 1: the flat world's units) */
export function reliefBounds(n, lip = LIP.modifier) {
    const slope = 1 + n.amount / n.size * lip / PEAK, reach = NZ_GRAD_VALUE_BOUND * Math.abs(n.amount)
    return { slope, reach }
}
/** the relief's true surface is where this is 0: the plain distance less the noise (not a distance: its slope can
 *  reach `slope`) */
export function reliefRaw(n, x, y) {
    const d0 = hyp(x - n.c[0], y - n.c[1]) - n.r
    return d0 - n.amount * fbm3([x / n.size, y / n.size, 0], n.seed ?? 1, OCTAVES, 2, 0.5)[3] / PEAK
}

/* ONE NODE'S DISTANCE, its cost added to `T`. kinds: disc, rbox, plane (open: no box), relief (a disc with a noise
   relief). `o.shell`, `o.lip`, `o.eps` for the relief. */
function nodeDist(n, x, y, o, T) {
    T.shape++
    if (n.kind === 'disc') return hyp(x - n.c[0], y - n.c[1]) - n.r
    if (n.kind === 'plane') return y - n.y
    if (n.kind === 'rbox') {
        const qx = Math.abs(x - n.c[0]) - n.h[0] + n.round, qy = Math.abs(y - n.c[1]) - n.h[1] + n.round
        return hyp(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - n.round
    }
    if (n.kind === 'relief') {
        const d0 = hyp(x - n.c[0], y - n.c[1]) - n.r, { slope, reach } = reliefBounds(n, o.lip)
        if (o.shell !== false && Math.abs(d0) > 2 * reach + (slope + 1) * o.eps) return d0 - Math.sign(d0) * reach   // THE SHELL: no noise
        T.octave += OCTAVES
        return (d0 - n.amount * fbm3([x / n.size, y / n.size, 0], n.seed ?? 1, OCTAVES, 2, 0.5)[3] / PEAK) / slope   // foldRelief: / slope
    }
    throw new Error(`no node kind ${n.kind}`)
}
/** the boxes a node is given: its own exact box, padded by the reach for a relief (a plane: none, open) */
export function boxOf(n) {
    if (n.kind === 'disc') return { lo: [n.c[0] - n.r, n.c[1] - n.r], hi: [n.c[0] + n.r, n.c[1] + n.r] }
    if (n.kind === 'rbox') return { lo: [n.c[0] - n.h[0], n.c[1] - n.h[1]], hi: [n.c[0] + n.h[0], n.c[1] + n.h[1]] }
    if (n.kind === 'relief') { const R = n.r + reliefBounds(n).reach; return { lo: [n.c[0] - R, n.c[1] - R], hi: [n.c[0] + R, n.c[1] + R] } }
    return null
}
export const isDear = n => n.kind === 'relief'
const boxed = (n, cull) => !!n.box && (cull === 'all' || (cull === 'dear' && isDear(n)))

/** THE SCENE AT (x, y), as codegen's SDF: every top-level node folded by |d|, a boxed one skipped while farther than
 *  the margin from its box, the nearest skipped box's distance standing in where it is nearer. `T` counts the cost.
 *  Returns { d, i } (i the nearest node evaluated, or -1 where the box's bound stood in; `culled` its node). */
export function sceneAt(S, x, y, o, T = newTally(), out = {}) {
    const margin = 10 * o.eps                                         // cullMargin() = offsetEps() = 10 surface tolerances
    let best = Infinity, bi = -1, cull = 1e7, ci = -1
    S.nodes.forEach((n, k) => {
        if (boxed(n, o.cull)) {
            T.box++
            const bd = cullDist(x, y, n.box)
            if (bd > margin) { if (bd < cull) { cull = bd; ci = k } return }
        }
        const d = nodeDist(n, x, y, o, T)
        if (Math.abs(d) < Math.abs(best)) { best = d; bi = k }
    })
    if (cull < Math.abs(best)) { out.d = cull; out.i = -1; out.culled = ci } else { out.d = best; out.i = bi; out.culled = -1 }
    return out
}
export const newTally = () => ({ shape: 0, box: 0, octave: 0, sdf: 0, cached: 0 })
export const costOf = T => T.shape * COST.shape + T.box * COST.box + T.octave * COST.octave

/* THE STEP CACHE in the plane: cells over `box`, about `cells` of them, square, each the scene's |distance| at its
   centre (clamped as the fill clamps it) from the PICK copy, no culling -- or, `fromRender`, the copy with the boxes, as
   the fill first did (the orange shell). */
export function buildCache(S, box, cells, { fromRender = false, cull = 'dear', shell = true, eps = 1e-3, lip } = {}) {
    const w = box.hi[0] - box.lo[0], h = box.hi[1] - box.lo[1], cs = Math.sqrt(w * h / cells)
    const nx = Math.ceil(w / cs), ny = Math.ceil(h / cs), R = new Float64Array(nx * ny), o = { cull: fromRender ? cull : 'off', shell, eps, lip }, H = {}
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        sceneAt(S, box.lo[0] + (i + 0.5) * cs, box.lo[1] + (j + 0.5) * cs, o, newTally(), H)
        R[i + nx * j] = Math.min(Math.max(Math.abs(H.d), 1e-6), 1e18)
    }
    return { lo: box.lo, cs, nx, ny, R }
}
/** wavefront.js scStep: the step a ball allows from (x, y) along (dx, dy) -- the farthest exit of the balls of the
 *  ray's own cell and, with `looks` 3, the two cells ahead -- or -1 where none holds the ray as far as a cell. `out`
 *  gets the ball used. */
export function scStep(C, x, y, dx, dy, looks = 1, out = null) {
    const cs = C.cs
    let best = 0
    for (let a = 0; a < looks; a++) {
        const gx = (x + dx * a * cs - C.lo[0]) / cs, gy = (y + dy * a * cs - C.lo[1]) / cs
        if (gx < 0 || gy < 0 || gx >= C.nx || gy >= C.ny) continue
        const ix = Math.min(Math.floor(gx), C.nx - 1), iy = Math.min(Math.floor(gy), C.ny - 1), k = ix + C.nx * iy
        const cx = C.lo[0] + (ix + 0.5) * cs, cy = C.lo[1] + (iy + 0.5) * cs, r = C.R[k]
        const ox = x - cx, oy = y - cy, c2 = ox * ox + oy * oy - r * r
        if (c2 >= 0) continue                                           // not inside this ball
        const b = ox * dx + oy * dy, e = -b + Math.sqrt(b * b - c2)       // where the ray leaves it
        if (e > best) { best = e; if (out) { out.c = [cx, cy]; out.r = r; out.k = k } }
    }
    return best >= cs ? best : -1
}

/** A RAY MARCHED with its costs counted: sphere tracing by |d| x stepscale, the hit test eps, the step cache first
 *  when given (never on the 32nd step of a pass). Returns { hit, t, x, y, i, steps: [{ x, y, d, kind ('sdf', 'box':
 *  a culled box's bound stood in, 'cache'), ball, cost }], T (the tally), cost }. */
export function marchCounted(S, ox, oy, dx, dy, o = {}) {
    const opt = { eps: 1e-3, far: 40, max: 400, stepscale: 0.9, cull: 'off', shell: true, cache: null, looks: 1, ...o }
    const T = newTally(), steps = [], H = {}, ball = {}
    let t = 0, hit = false, i = -1
    for (let n = 0; n < opt.max; n++) {
        const x = ox + dx * t, y = oy + dy * t
        if (opt.cache && n % MARCH_STEPS !== MARCH_STEPS - 1) {
            const sc = scStep(opt.cache, x, y, dx, dy, opt.looks, ball)
            if (sc > 0) { T.cached++; steps.push({ x, y, d: sc, kind: 'cache', ball: { c: ball.c, r: ball.r }, cost: 0 }); t += sc * opt.stepscale; if (t > opt.far) break; continue }
        }
        const c0 = costOf(T)
        sceneAt(S, x, y, opt, T, H); T.sdf++
        const a = Math.abs(H.d)
        steps.push({ x, y, d: a, kind: H.culled >= 0 ? 'box' : 'sdf', cost: costOf(T) - c0 })
        if (a < opt.eps) { hit = true; i = H.i; break }
        t += a * opt.stepscale
        if (t > opt.far) break
    }
    return { hit, t, x: ox + dx * t, y: oy + dy * t, i, steps, T, cost: costOf(T) }
}

/** a fan of rays from `eye` across `fov` about `dir`, each marched; the totals */
export function fan(S, eye, dir, fov, count, o) {
    const rays = [], T = newTally()
    for (let k = 0; k < count; k++) {
        const a = dir + fov * ((k + 0.5) / count - 0.5), dx = Math.cos(a), dy = Math.sin(a)
        const r = marchCounted(S, eye[0], eye[1], dx, dy, o)
        rays.push(r); for (const q in T) T[q] += r.T[q]
    }
    return { rays, T, cost: costOf(T), steps: T.sdf + T.cached }
}

/* WHY ONLY AT THE ROOT. Two discs A and B, joined three ways, and B's box culling it: as a whole at the root (the
   group's box), or inside the join (the box of B alone, as ShadyTracer never does). `truth` is the join's own field;
   `culled` what the scene would answer with the skipping done there. */
export const smoothUnion = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0); return Math.min(a, b) - h * h / (4 * k) }
export function joined(J, x, y, how, eps = 1e-3) {
    const dA = hyp(x - J.a.c[0], y - J.a.c[1]) - J.a.r, dB = hyp(x - J.b.c[0], y - J.b.c[1]) - J.b.r
    const truth = J.op === 'intersect' ? Math.max(dA, dB) : smoothUnion(dA, dB, J.k)
    const margin = 10 * eps
    if (how === 'root') {
        const bd = cullDist(x, y, J.box)                               // the whole join's box
        return { truth, culled: bd > margin ? bd : truth, skipped: bd > margin }
    }
    // inside the join: B skipped while farther than its own box, the join then A alone, the box's bound a cap
    const bd = cullDist(x, y, J.bBox)
    if (!(bd > margin)) return { truth, culled: truth, skipped: false }
    return { truth, culled: Math.abs(dA) > bd ? bd : dA, skipped: true }
}
/** the true distance from (x, y) to the lens A ∩ B (an intersection's formula is only a lower bound): to its outline,
 *  each disc's circle where it lies inside the other, sampled at `n` points a circle */
export function lensTrueDist(J, x, y, n = 3600) {
    // the two tips exactly, where the circles cross: a sampled circle would miss them by a sample's width
    const dx = J.b.c[0] - J.a.c[0], dy = J.b.c[1] - J.a.c[1], d = hyp(dx, dy), a = (J.a.r ** 2 - J.b.r ** 2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, J.a.r ** 2 - a * a))
    const mx = J.a.c[0] + a * dx / d, my = J.a.c[1] + a * dy / d
    let best = Math.min(hyp(mx - h * dy / d - x, my + h * dx / d - y), hyp(mx + h * dy / d - x, my - h * dx / d - y))
    for (const [P, Q] of [[J.a, J.b], [J.b, J.a]]) for (let k = 0; k < n; k++) {
        const t = 2 * Math.PI * k / n, px = P.c[0] + P.r * Math.cos(t), py = P.c[1] + P.r * Math.sin(t)
        if (hyp(px - Q.c[0], py - Q.c[1]) <= Q.r) best = Math.min(best, hyp(px - x, py - y))
    }
    return best
}
/** a ray marched through one of `joined`'s fields: where it stops */
export function marchJoined(J, ox, oy, dx, dy, how, { eps = 1e-3, far = 12, max = 400, stepscale = 0.9, field = 'culled' } = {}) {
    let t = 0
    for (let n = 0; n < max; n++) {
        const x = ox + dx * t, y = oy + dy * t, v = joined(J, x, y, how, eps)[field], a = Math.abs(v)
        if (a < eps) return { hit: true, t, x, y, n: n + 1 }
        t += a * stepscale
        if (t > far) break
    }
    return { hit: false, t, x: ox + dx * t, y: oy + dy * t, n: max }
}

/** builder/stepbox.js unionBox in the plane: boxes joined, padded `pad` of the largest side each way */
export function unionBox(list, pad = 0.1) {
    if (!list.length) return null
    const lo = [0, 1].map(k => Math.min(...list.map(b => b.lo[k]))), hi = [0, 1].map(k => Math.max(...list.map(b => b.hi[k])))
    const p = pad * Math.max(...hi.map((v, k) => v - lo[k]))
    return { lo: lo.map(v => v - p), hi: hi.map(v => v + p) }
}

/** a relief's outline for drawing: along each of `n` directions from its centre, where reliefRaw crosses 0 (bisection
 *  within the noise's reach of the plain circle) */
export function reliefOutline(nd, n = 180) {
    const { reach } = reliefBounds(nd), pts = []
    for (let k = 0; k < n; k++) {
        const a = 2 * Math.PI * k / n, c = Math.cos(a), s = Math.sin(a)
        let lo = nd.r - 1.05 * reach, hi = nd.r + 1.05 * reach
        // twelve halvings: to 2.1 reaches / 4096, well under a pixel
        for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (reliefRaw(nd, nd.c[0] + m * c, nd.c[1] + m * s) > 0) hi = m; else lo = m }
        pts.push([nd.c[0] + (lo + hi) / 2 * c, nd.c[1] + (lo + hi) / 2 * s])
    }
    return pts
}
