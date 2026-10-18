//======================================================================================================================
// CHAPTER "Building and bending shapes": its figures.
//
//   csg      a circle and a box joined three ways (together, overlap, cut out), hard or blended, both dragged about
//   fillet   the normal of a blended join: arrows along the surface and the light they give it, as the renderer takes
//            them now and as it took them before (the warped fillet, scene_api.js csgNormal)
//   fold     two solids, a probe, and the two things the renderer asks of a point: which surface is nearest, and which
//            solid it is inside (scene_api.js fold)
//   swirl    space turned more the farther from the middle (the flat world's twist): how much steeper it makes the
//            distances, and what dividing by a bound gives -- the twist modifier's bound and the exact one
//   relief   a noise relief on a circle: raw, divided by its bound, and with the shell that skips the noise far away;
//            a ray marched through it, its steps counted
//
// The distances are the help's 2D mirrors of sdf.js (help/widgets.js); the noise is noise.js's own JS mirror of its
// WGSL, sliced at one height; the joins, fold and the relief's numbers are written out below as the WGSL has them.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { circle, box, smin, smax } from '../../help/widgets.js'
import { fbm3, nzFbmLip, NZ_GRAD_LIP_MEASURED, NZ_GRAD_VALUE_BOUND } from '../../lib/pathtracer/core/noise.js'
import { plot } from '../kit/plot.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const norm = (x, y) => { const l = Math.hypot(x, y); return l > 1e-12 ? [x / l, y / l] : [0, 0] }
/* the field's slope at (x, y), by central differences: its gradient */
const grad = (f, x, y, h = 1e-4) => [(f(x + h, y) - f(x - h, y)) / (2 * h), (f(x, y + h) - f(x, y - h)) / (2 * h)]

/* THE JOINS ON (normal, distance), as scene_api.js writes them (csgNormal, csgUnion), in 2D: [nx, ny, d], a zero
   normal for a shape that gives none. Exported for the test, which holds the normal to the field's own slope. */
export function csgNormal(a, b, t) {
    if (a[0] * a[0] + a[1] * a[1] < 1e-12 || b[0] * b[0] + b[1] * b[1] < 1e-12) return [0, 0]
    const n = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], l = Math.hypot(...n)
    return l > 1e-12 ? [n[0] / l, n[1] / l] : [0, 0]
}
export function csgUnion(a, b, k) {
    if (k <= 0) return a[2] < b[2] ? a : b
    const h = Math.max(k - Math.abs(a[2] - b[2]), 0)
    const m = a[2] < b[2] ? 0 : 1                       // 0 when a is nearer
    const t = m + (1 - 2 * m) * 0.5 * h / k             // weight of b in the normal
    return [...csgNormal(a, b, t), Math.min(a[2], b[2]) - h * h * 0.25 / k]
}

/* FOLD, as scene_api.js fold: the SURFACE is the nearest boundary either way (argmin |d|), the MEDIUM the solid the
   point is least deep in, of all it is inside (argmax over negative distances). The backface test is left out. */
export const emptyHit = () => ({ s: 1e7, m: 'air', a: 'air', insideW: -1e7 })
export function fold(C, d, mat) {
    const H = { ...C }
    if (d < 0 && d > H.insideW) { H.insideW = d; H.a = mat }
    if (Math.abs(d) < Math.abs(H.s)) { H.s = d; H.m = mat }
    return H
}

/* THE SWIRL: the flat world's twist. The twist turns each slice of space by rate x height; this turns each point by
   rate x its distance from the middle. Both stretch a short move by the same matrix, [[1, 0], [c, 1]] in the right
   directions, c = rate x distance from the axis: so the bounds below are the twist modifier's (builder/modifiers.js). */
const BAR = [0.95, 0.32], EXTENT = Math.hypot(...BAR)       // the shape turned, and how far it reaches from the middle
export const swirl = (rate, x, y) => { const a = rate * Math.hypot(x, y), c = Math.cos(a), s = Math.sin(a); return [c * x - s * y, s * x + c * y] }
/** what the distance is divided by: nothing; the twist modifier's sqrt(1 + c^2); the most the map stretches anything */
export const swirlDivisor = (kind, c) => kind === 'none' ? 1 : kind === 'sqrt' ? Math.sqrt(1 + c * c) : (c + Math.sqrt(c * c + 4)) / 2
export const swirlField = (rate, kind) => { const D = swirlDivisor(kind, rate * EXTENT); return (x, y) => box(...swirl(rate, x, y), ...BAR) / D }
/* the steepest slope of a field over a grid of points inside the extent, and the points over 1 (cached: drags of the
   probe redraw without recomputing it) */
const steepCache = new Map()
export function steepest(rate, kind, n = 34) {
    const key = `${rate}|${kind}|${n}`
    if (steepCache.has(key)) return steepCache.get(key)
    const f = swirlField(rate, kind), over = []
    let worst = 0, inside = 0
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = -EXTENT + 2 * EXTENT * (i + 0.5) / n, y = -EXTENT + 2 * EXTENT * (j + 0.5) / n
        if (Math.hypot(x, y) > EXTENT) continue
        inside++
        const s = Math.hypot(...grad(f, x, y, 1e-5))
        if (s > 1.002) over.push([x, y])
        worst = Math.max(worst, s)
    }
    const r = { worst, over, share: over.length / inside }
    if (steepCache.size > 200) steepCache.clear()
    steepCache.set(key, r)
    return r
}

/* THE RELIEF, as builder/modifiers.js reliefCode writes it, on a circle, the noise sliced at one height: four octaves
   of gradient noise (noise.js fbm3), their peak, the slope bound the distance is divided by, and the shell beyond
   which the noise cannot reach. */
const RELIEF_R = 1.05, SLICE = 0.37
export const reliefPeak = nzFbmLip(4, 1.0, 0.5, 1.0)
export const reliefSlope = (amount, size) => 1 + amount / size * nzFbmLip(4, 2.0, 0.5, NZ_GRAD_LIP_MEASURED) / reliefPeak
export const reliefReach = amount => NZ_GRAD_VALUE_BOUND * Math.abs(amount)
const noiseCache = new Map()
const noiseAt = (x, y, size) => {
    const key = `${size}|${x.toFixed(4)}|${y.toFixed(4)}`
    let v = noiseCache.get(key)
    if (v === undefined) { v = fbm3([x / size, y / size, SLICE], 1, 4, 2.0, 0.5)[3]; if (noiseCache.size > 120000) noiseCache.clear(); noiseCache.set(key, v) }
    return v
}
/** the relief's distance: `mode` 'raw' (the noise added, undivided), 'divided' (by the slope bound) or 'shell' (and
 *  beyond twice the noise's reach, the plain distance less that reach, no noise) */
export function reliefField(s) {
    const slope = reliefSlope(s.amount, s.size), reach = reliefReach(s.amount)
    return (x, y) => {
        const d = circle(x, y, RELIEF_R)
        if (s.mode === 'shell' && Math.abs(d) > 2 * reach + 0.01 * (slope + 1)) return d - Math.sign(d) * reach
        const r = d - s.amount * noiseAt(x, y, s.size) / reliefPeak
        return s.mode === 'raw' ? r : r / slope
    }
}
/* SPHERE TRACING, as the march kernel does it (chapter 2): steps of 0.9 x distance until within the tolerance */
export function march(f, o, dir, { eps = 0.004, max = 300 } = {}) {
    let x = o[0], y = o[1]
    const pts = []
    for (let n = 0; n < max; n++) {
        const d = f(x, y)
        pts.push([x, y, d])
        if (Math.abs(d) < eps) return { pts, end: 'hit', x, y }
        if (x > 3.6) return { pts, end: 'escaped', x, y }
        x += dir[0] * d * 0.9; y += dir[1] * d * 0.9
    }
    return { pts, end: 'out of steps', x, y }
}

/* where a circle about p of radius r first crosses into the shape f, if it does: the probe's empty circle claiming
   space that is not empty */
function crossing(f, p, r, n = 96) {
    for (let i = 0; i < n; i++) {
        const a = i / n * 2 * Math.PI, q = [p[0] + Math.cos(a) * r * 0.995, p[1] + Math.sin(a) * r * 0.995]
        if (f(...q) < 0) return q
    }
    return null
}

/* THE FILLET'S SURFACE, as points around it: the blended shape is star-shaped about a point inside both solids, so
   each direction from there crosses the surface once */
const F_BOX = { c: [0, -0.62], h: [1.55, 0.48] }, F_BALL = { c: [0.32, 0.32], r: 0.62 }, F_IN = [0.32, -0.25]
const fBox = (x, y) => box(x - F_BOX.c[0], y - F_BOX.c[1], ...F_BOX.h)
const fBall = (x, y) => circle(x - F_BALL.c[0], y - F_BALL.c[1], F_BALL.r)
export function surfacePoints(f, from, n = 240, far = 4) {
    const out = []
    for (let i = 0; i < n; i++) {
        const a = i / n * 2 * Math.PI, dx = Math.cos(a), dy = Math.sin(a)
        let lo = 0, hi = 0.02
        while (hi < far && f(from[0] + dx * hi, from[1] + dy * hi) < 0) { lo = hi; hi += 0.02 }
        for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (f(from[0] + dx * m, from[1] + dy * m) < 0) lo = m; else hi = m }
        out.push([from[0] + dx * lo, from[1] + dy * lo])
    }
    return out
}
/** the normal at a point of the fillet: `now` takes it as the renderer does today (the box gives no normal, so none
 *  for the blend, and the renderer takes the slope of the blended field), `before` as it did (the ball's normal
 *  wherever the ball has any weight, t > 0) */
export function filletNormal(x, y, k, how) {
    const nb = norm(x - F_BALL.c[0], y - F_BALL.c[1])
    const j = csgUnion([0, 0, fBox(x, y)], [...nb, fBall(x, y)], k)
    if (how === 'before') {
        const h = Math.max(k - Math.abs(fBox(x, y) - fBall(x, y)), 0), t = fBox(x, y) < fBall(x, y) ? 0.5 * h / k : 1 - 0.5 * h / k
        if (t > 0) return { n: nb, blend: h > 0 }
    }
    // no normal from the join: by differences of the blended field, exact whatever the shapes give
    const f = (u, v) => smin(fBox(u, v), fBall(u, v), k)
    return { n: j[0] || j[1] ? [j[0], j[1]] : norm(...grad(f, x, y)), blend: Math.max(k - Math.abs(fBox(x, y) - fBall(x, y)), 0) > 0 }
}
const LIGHT = norm(-0.55, 1)

/* THE FOLD'S TWO SOLIDS: a pool of water and a glass ball, the ball dragged anywhere */
const POOL = { c: [-0.2, -0.35], r: 1.45 }

export const figures = {
    csg: {
        aspect: 1.55,
        world: { x: [-3.1, 3.1], y: [-2.0, 2.0] },
        state: { op: 'union', k: 0, c: [0.55, 0.25], b: [-0.55, -0.15] },
        controls: [
            { type: 'seg', key: 'op', options: [['union', 'Together'], ['intersect', 'Overlap'], ['subtract', 'Box minus circle']] },
            { type: 'slider', key: 'k', label: 'blend k', min: 0, max: 1, step: 0.02, fmt: v => v.toFixed(2) },
        ],
        steps: {
            union: { op: 'union', k: 0, c: [0.55, 0.25], b: [-0.55, -0.15] },
            intersect: { op: 'intersect', k: 0, c: [0.55, 0.25], b: [-0.55, -0.15] },
            subtract: { op: 'subtract', k: 0, c: [0.55, 0.25], b: [-0.55, -0.15] },
            blend: { op: 'union', k: 0.6, c: [0.8, 0.35], b: [-0.55, -0.15] },
            carve: { op: 'subtract', k: 0.3, c: [0.55, 0.25], b: [-0.55, -0.15] },
        },
        drag: {
            circle: (s, p) => { s.c = [clamp(p[0], -2.3, 2.3), clamp(p[1], -1.3, 1.3)] },
            box: (s, p) => { s.b = [clamp(p[0], -2.2, 2.2), clamp(p[1], -1.3, 1.3)] },
        },
        draw(pen, s) {
            const c = (x, y) => circle(x - s.c[0], y - s.c[1], 1.0), b = (x, y) => box(x - s.b[0], y - s.b[1], 1.1, 0.75)
            const f = s.op === 'union' ? (x, y) => smin(c(x, y), b(x, y), s.k)
                : s.op === 'intersect' ? (x, y) => smax(c(x, y), b(x, y), s.k)
                    : (x, y) => smax(b(x, y), -c(x, y), s.k)
            // the two shapes as they were, faintly, then the joined field
            pen.field(c, { step: 0, zero: 'faint', inside: 'paper', insideLines: false })
            pen.field(b, { step: 0, zero: 'faint', inside: 'paper', insideLines: false })
            pen.field(f, { step: 0.25, cell: 4 })
            pen.handle('circle', s.c, { role: 'soft' }); pen.label([s.c[0], s.c[1] + 1.12], 'circle', { align: 'center', role: 'soft', size: 14 })
            pen.handle('box', s.b, { role: 'soft' }); pen.label([s.b[0], s.b[1] - 0.95], 'box', { align: 'center', role: 'soft', size: 14 })
        },
        readout(s) {
            const name = { union: 'together: the smaller distance, min(circle, box)', intersect: 'overlap: the larger, max(circle, box)', subtract: 'box minus circle: max(box, −circle)' }[s.op]
            return `${name}${s.k > 0 ? ` · blended over k = ${s.k.toFixed(2)}: the ${s.op === 'union' ? 'smooth minimum' : 'smooth maximum'}` : ' · hard'}`
        },
    },

    fillet: {
        aspect: 1.6,
        world: { x: [-2.2, 2.6], y: [-1.35, 1.65] },
        state: { k: 0.5, how: 'now' },
        controls: [
            { type: 'slider', key: 'k', label: 'blend k', min: 0.05, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'seg', key: 'how', options: [['now', 'Now'], ['before', 'Before the fix']] },
        ],
        steps: { now: { k: 0.5, how: 'now' }, before: { k: 0.5, how: 'before' }, wide: { k: 0.9, how: 'before' } },
        draw(pen, s) {
            const f = (x, y) => smin(fBox(x, y), fBall(x, y), s.k)
            pen.field(fBox, { step: 0, zero: 'faint', inside: 'paper', insideLines: false })
            pen.field(fBall, { step: 0, zero: 'faint', inside: 'paper', insideLines: false })
            pen.field(f, { step: 0, cell: 3 })
            const pts = surfacePoints(f, F_IN, 360)
            // the surface lit from the upper left by its normals: brighter where the normal faces the light
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
                const { n } = filletNormal(...m, s.k, s.how)
                const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1])
                pen.line(a, b, { role: 'light', w: 5, exact: true, cap: 'butt', alpha: 0.08 + 0.92 * lit })
            }
            // a normal every so often along it: in the blend's zone, accent-coloured
            let along = 0
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length]
                along += Math.hypot(b[0] - a[0], b[1] - a[1])
                if (along < 0.2) continue
                along = 0
                if (a[1] < -0.45) continue                     // the box's underside: nothing to see there
                const { n, blend } = filletNormal(...a, s.k, s.how)
                pen.ray(a, [a[0] + n[0] * 0.38, a[1] + n[1] * 0.38], { role: blend ? 'accent' : 'normal', w: 1.1 })
            }
            pen.bulb([-1.75, 1.35], { r: 6 })
            pen.label([-1.55, 1.35], 'light', { role: 'soft', size: 14 })
        },
        readout(s) {
            return s.how === 'now'
                ? `blend k = ${s.k.toFixed(2)} · now: the box gives no normal, so the join gives none, and the renderer takes the slope of the blended distance: every arrow square to the surface`
                : `blend k = ${s.k.toFixed(2)} · before: the ball's normal wherever the ball has any weight in the blend — the accent arrows in the blend's zone point away from the ball's centre, not square to the fillet`
        },
    },

    fold: {
        aspect: 1.55,
        world: { x: [-2.9, 2.9], y: [-1.95, 1.8] },
        state: { ball: [0.15, -0.2], probe: [0.35, -0.05] },
        steps: {
            nested: { ball: [0.15, -0.2], probe: [0.35, -0.05] },
            water: { ball: [0.15, -0.2], probe: [-1.0, -0.9] },
            overlap: { ball: [1.15, 0.45], probe: [1.0, 0.36] },
        },
        drag: {
            ball: (s, p) => { s.ball = [clamp(p[0], -2.2, 2.2), clamp(p[1], -1.3, 1.2)] },
            probe: (s, p) => { s.probe = [clamp(p[0], -2.8, 2.8), clamp(p[1], -1.85, 1.7)] },
        },
        draw(pen, s) {
            const pool = (x, y) => circle(x - POOL.c[0], y - POOL.c[1], POOL.r), ball = (x, y) => circle(x - s.ball[0], y - s.ball[1], 0.62)
            const hitAt = (x, y) => fold(fold(emptyHit(), pool(x, y), 'water'), ball(x, y), 'glass')
            pen.field(pool, { step: 0, inside: 'fill', zero: 'solid' })
            // where the renderer says the point is in glass: of all the solids it is inside, the one it is least deep in
            pen.field((x, y) => hitAt(x, y).a === 'glass' ? -1 : 1, { step: 0, inside: 'glass', zero: 'glass', cell: 3 })
            pen.circle(s.ball, 0.62, { role: 'solid', w: 1.2, id: 'ball' })
            pen.label([POOL.c[0] - 0.95, POOL.c[1] - 0.75], 'water', { role: 'soft', size: 15 })
            pen.label([s.ball[0], s.ball[1] + 0.8], 'glass', { role: 'soft', size: 15, align: 'center' })
            const H = hitAt(...s.probe), dp = pool(...s.probe), db = ball(...s.probe)
            // the nearest surface: from the probe down that solid's slope, |d| away
            const near = H.m === 'water' ? [pool, dp] : [ball, db], g = norm(...grad(near[0], ...s.probe))
            pen.circle(s.probe, Math.abs(H.s), { role: 'cam', w: 1, id: 'empty' })
            const q = [s.probe[0] - g[0] * near[1], s.probe[1] - g[1] * near[1]]
            pen.line(s.probe, q, { role: 'cam', w: 1.1 }); pen.dot(q, { role: 'accent', r: 3.2 })
            pen.handle('ball', s.ball, { role: 'soft' })
            pen.handle('probe', s.probe)
        },
        readout(s) {
            const pool = circle(s.probe[0] - POOL.c[0], s.probe[1] - POOL.c[1], POOL.r), ball = circle(s.probe[0] - s.ball[0], s.probe[1] - s.ball[1], 0.62)
            const H = fold(fold(emptyHit(), pool, 'water'), ball, 'glass')
            const depth = (d, name) => d < 0 ? `${(-d).toFixed(2)} inside the ${name}` : `${d.toFixed(2)} outside the ${name}`
            return `${depth(pool, 'water')}, ${depth(ball, 'glass')} · surface: the ${H.m}'s, ${Math.abs(H.s).toFixed(2)} away · in: ${H.a === 'air' ? 'air' : H.a}`
        },
    },

    swirl: {
        aspect: 1.5,
        world: { x: [-1.9, 1.9], y: [-1.27, 1.27] },
        state: { rate: 1.2, div: 'none', probe: [0.875, -0.425] },
        controls: [
            { type: 'slider', key: 'rate', label: 'turn', min: 0, max: 1.6, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'seg', key: 'div', label: 'divided by', options: [['none', 'Not divided'], ['sqrt', '√(1 + c²)'], ['exact', '(c + √(c² + 4)) / 2']] },
        ],
        steps: {
            plain: { rate: 0, div: 'none', probe: [0.875, -0.425] },
            raw: { rate: 1.2, div: 'none', probe: [0.875, -0.425] },
            sqrt: { rate: 1.2, div: 'sqrt', probe: [0.875, -0.425] },
            exact: { rate: 1.2, div: 'exact', probe: [0.875, -0.425] },
        },
        // the probe stays inside the extent: the divisors are worked out there, and beyond it the swirl stretches more
        drag: { probe: (s, p) => { const r = Math.hypot(...p), m = Math.min(1, (EXTENT - 0.01) / (r || 1)); s.probe = [p[0] * m, p[1] * m] } },
        draw(pen, s) {
            const f = swirlField(s.rate, s.div), plain = swirlField(s.rate, 'none')
            pen.field(f, { step: 0.1, cell: 4 })
            pen.circle([0, 0], EXTENT, { role: 'soft', w: 0.9, dash: [5, 5], id: 'extent' })
            pen.label([EXTENT * 0.72, -EXTENT * 0.72 - 0.08], 'extent', { role: 'soft', size: 13, dx: 6 })
            // the points where the field is still steeper than 1
            for (const p of steepest(s.rate, s.div).over) pen.dot(p, { role: 'blocked', r: 1.6 })
            const d = f(...s.probe), q = d > 0 ? crossing(plain, s.probe, d) : null
            pen.circle(s.probe, Math.abs(d), { role: q ? 'blocked' : 'cam', w: 1.2, id: 'empty' })
            if (q) pen.dot(q, { role: 'blocked', r: 4, ring: true })
            pen.handle('probe', s.probe)
        },
        readout(s) {
            const c = s.rate * EXTENT, st = steepest(s.rate, s.div), d = swirlField(s.rate, s.div)(...s.probe)
            const q = d > 0 && crossing(swirlField(s.rate, 'none'), s.probe, d)
            return `c = turn × extent = ${c.toFixed(2)} · divided by ${swirlDivisor(s.div, c).toFixed(2)} · steepest slope inside the extent ${st.worst.toFixed(2)}`
                + (st.over.length ? `, over 1 at ${(100 * st.share).toFixed(0)}% of the points (dots)` : ', never over 1')
                + (q ? ' · the probe\'s circle crosses the shape' : '')
        },
    },

    relief: {
        aspect: 1.9,
        world: { x: [-2.95, 3.0], y: [-1.55, 1.55] },
        state: { amount: 0.12, size: 0.2, mode: 'raw', from: [-2.75, -0.16] },
        controls: [
            { type: 'slider', key: 'amount', label: 'amount', min: 0, max: 0.25, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'size', label: 'size', min: 0.15, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'seg', key: 'mode', options: [['raw', 'Not divided'], ['divided', 'Divided by the slope'], ['shell', '…and the shell']] },
        ],
        steps: {
            raw: { amount: 0.12, size: 0.2, mode: 'raw', from: [-2.75, -0.16] },
            divided: { amount: 0.12, size: 0.2, mode: 'divided', from: [-2.75, -0.16] },
            shell: { amount: 0.12, size: 0.2, mode: 'shell', from: [-2.75, -0.16] },
        },
        drag: { from: (s, p) => { s.from = [clamp(p[0], -2.9, -1.4), clamp(p[1], -1.45, 1.45)] } },
        draw(pen, s) {
            const f = reliefField(s), truth = reliefField({ ...s, mode: 'raw' })
            pen.field(truth, { step: 0, cell: 3, zero: 'solid' })
            pen.field(f, { step: 0.1, cell: 4, inside: 'paper', zero: 'solid', insideLines: false })
            if (s.mode === 'shell') {
                const band = 2 * reliefReach(s.amount) + 0.01 * (reliefSlope(s.amount, s.size) + 1)
                pen.circle([0, 0], RELIEF_R + band, { role: 'soft', w: 0.9, dash: [5, 5], id: 'shellOut' })
                pen.circle([0, 0], Math.max(0.05, RELIEF_R - band), { role: 'soft', w: 0.9, dash: [5, 5], id: 'shellIn' })
            }
            const dir = norm(-s.from[0], -s.from[1] * 0.6), r = march(f, s.from, dir)
            for (const [x, y, d] of r.pts) pen.dot([x, y], { role: truth(x, y) < -0.004 ? 'blocked' : 'cam', r: 2 })
            pen.ray(s.from, [r.x, r.y], { role: 'cam', w: 1.1, arrow: r.end !== 'hit' })
            if (r.end === 'hit') pen.dot([r.x, r.y], { role: truth(r.x, r.y) < -0.004 ? 'blocked' : 'accent', r: 4 })
            pen.handle('from', s.from)
            // THE LAST STEPS, MAGNIFIED: they all land within a hair of the surface, too close to see apart, so the
            // distance the march saw at each is plotted at the right -- a ray that rocks shows as a zigzag about zero
            const last = r.pts.slice(-24), m = Math.max(0.002, ...last.map(p => Math.abs(p[2]))) * 1.15, n0 = r.pts.length - last.length
            const { W, H } = pen.view, box = { x: W * 0.74, y: H * 0.2, w: W * 0.23, h: H * 0.42 }
            pen.ctx.save(); pen.ctx.fillStyle = pen.col('paper'); pen.ctx.globalAlpha = 0.9; pen.ctx.fillRect(box.x - 44, box.y - 26, box.w + 52, box.h + 50); pen.ctx.restore()
            pen.labelPx(box.x - 40, box.y - 22, 'distance at the last steps', { role: 'soft', size: 13 })
            plot(pen, box, {
                x: [n0 + 0.5, r.pts.length + 0.5], y: [-m, m], yticks: [-m / 1.15, 0, m / 1.15], xticks: [n0 + 1, r.pts.length],
                fmt: v => Math.abs(v) >= 1 ? String(Math.round(v)) : v.toFixed(3),
                series: [{ pts: last.map((p, i) => [n0 + i + 1, p[2]]), role: 'soft', w: 1 },
                    { pts: last.map((p, i) => [n0 + i + 1, p[2]]).filter((q, i) => truth(last[i][0], last[i][1]) >= -0.004), role: 'cam', kind: 'dots', r: 2.2 },
                    { pts: last.map((p, i) => [n0 + i + 1, p[2]]).filter((q, i) => truth(last[i][0], last[i][1]) < -0.004), role: 'blocked', kind: 'dots', r: 2.2 }],
            })
        },
        readout(s) {
            const f = reliefField(s), truth = reliefField({ ...s, mode: 'raw' }), dir = norm(-s.from[0], -s.from[1] * 0.6), r = march(f, s.from, dir)
            const inside = r.pts.filter(([x, y]) => truth(x, y) < -0.004).length
            return `slope bound ${reliefSlope(s.amount, s.size).toFixed(2)} · the noise reaches ${reliefReach(s.amount).toFixed(3)} at most · the ray: ${r.pts.length} steps, ${r.end}`
                + (inside ? `, ${inside} of them inside the surface` : '')
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
