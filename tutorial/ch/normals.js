//======================================================================================================================
// CHAPTER "Which way is up": its figures.
//
//   slope   a normal three ways at a probe: the shape's own formula (exact), forward differences (the renderer's
//           shade kernel: one extra look per axis) and central ones (the pick's: two per axis), with the step size and
//           the points looked at; on a round surface and at a crease where two shapes meet
//   grain   the same differences in the GPU's 32-bit numbers (f32), emulated with Math.fround as core/test/floor.test.mjs
//           does in 3D: a circle lit by its normals at a step of K spacings of f32, and the worst angle error against K
//           -- the f32 noise below, the step's own error above, and the renderer's floor of 128 between
//======================================================================================================================

import { boot } from '../kit/page.js'
import { circle, box } from '../../help/widgets.js'
import { plot } from '../kit/plot.js'
import { TOL_F32_STEPS, F32_STEP } from '../../lib/pathtracer/core/tolerances.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const norm = v => { const l = Math.hypot(v[0], v[1]); return l > 0 ? [v[0] / l, v[1] / l] : [0, 0] }
const deg = (a, b) => Math.acos(clamp(a[0] * b[0] + a[1] * b[1], -1, 1)) * 180 / Math.PI

/* THE SHAPES: a circle and a box, joined (the nearer wins), and the gradient of each written out -- the "analytic"
   normal a shape can hand the renderer with its distance, as sdf.js's Nsphere and Nroundedbox do */
const C = [0.75, 0.15], R = 0.95, B = [-0.75, -0.2], BH = [0.85, 0.6]
export const field = (x, y) => Math.min(circle(x - C[0], y - C[1], R), box(x - B[0], y - B[1], ...BH))
export function exact(x, y) {
    if (circle(x - C[0], y - C[1], R) < box(x - B[0], y - B[1], ...BH)) return norm([x - C[0], y - C[1]])
    const px = x - B[0], py = y - B[1], qx = Math.abs(px) - BH[0], qy = Math.abs(py) - BH[1]
    if (qx > 0 || qy > 0) return norm([Math.max(qx, 0) * Math.sign(px), Math.max(qy, 0) * Math.sign(py)])
    return qx > qy ? [Math.sign(px), 0] : [0, Math.sign(py)]
}
/** forward differences: one more look per axis (the shade kernel's calcNormals_fast, in 2D) */
export const forward = (f, x, y, h) => { const d = f(x, y); return norm([f(x + h, y) - d, f(x, y + h) - d]) }
/** central differences: two more looks per axis (the pick's) */
export const central = (f, x, y, h) => norm([f(x + h, y) - f(x - h, y), f(x, y + h) - f(x, y - h)])

const ON_ROUND = [C[0] + R * Math.cos(1.05), C[1] + R * Math.sin(1.05)]
const NEAR_CREASE = [C[0] + R * Math.cos(2.758), C[1] + R * Math.sin(2.758)]     // on the circle, 0.11 from where it meets the box

/* THE f32 EMULATION, in 2D: a circle of radius r around c, its distance as the shader computes it, every operation
   rounded to f32 (Math.fround); the point on its surface rounded to f32 too, as the march leaves it */
const f = Math.fround
const d32 = (p, c, r) => { const dx = f(p[0] - c[0]), dy = f(p[1] - c[1]); return f(f(Math.sqrt(f(f(dx * dx) + f(dy * dy)))) - f(r)) }
const d64 = (p, c, r) => Math.hypot(p[0] - c[0], p[1] - c[1]) - r
const D = 1                                        // the circle's distance from the origin, metres: everything scales with it
/** a circle `frac` x D across, D from the origin: its centre, radius and a point at angle a (f32), its true normal */
export function grainPoint(frac, a) {
    const c = [f(D), f(0.37 * D)], r = frac * D, n = [Math.cos(a), Math.sin(a)]
    return { c, r, n, p: [f(c[0] + n[0] * r), f(c[1] + n[1] * r)] }
}
/** the step K spacings of f32 at p, as normalTol's floor: K x 2^-23 x the largest coordinate */
export const stepAt = (K, p) => f(K * F32_STEP * Math.max(Math.abs(p[0]), Math.abs(p[1])))
/** the normal by forward differences in f32, and the same in 64-bit numbers */
export function grainNormal(frac, a, K) {
    const { c, r, n, p } = grainPoint(frac, a), h = stepAt(K, p)
    const g32 = norm([f(d32([f(p[0] + h), p[1]], c, r) - d32(p, c, r)), f(d32([p[0], f(p[1] + h)], c, r) - d32(p, c, r))])
    const g64 = norm([d64([p[0] + h, p[1]], c, r) - d64(p, c, r), d64([p[0], p[1] + h], c, r) - d64(p, c, r)])
    return { n, g32, g64, h }
}
/** worst angle errors (mrad) over 180 points around the circle at one K: all of it (f32 against the true normal), f32's
 *  part (against the same differences in 64 bits), and the step's own (64-bit differences against the true normal) */
const curveCache = new Map()
export function grainErrors(frac, K) {
    const key = `${frac}|${K}`
    if (curveCache.has(key)) return curveCache.get(key)
    let all = 0, noise = 0, step = 0
    for (let i = 0; i < 180; i++) {
        const a = (i + 0.37) / 180 * 2 * Math.PI, { n, g32, g64 } = grainNormal(frac, a, K)
        all = Math.max(all, deg(g32, n)); noise = Math.max(noise, deg(g32, g64)); step = Math.max(step, deg(g64, n))
    }
    const r = { all: all * Math.PI / 0.18, noise: noise * Math.PI / 0.18, step: step * Math.PI / 0.18 }
    curveCache.set(key, r)
    return r
}
const KS = Array.from({ length: 17 }, (_, i) => 2 ** i)
const ERR_SCALE = 1 / 200                         // the error ticks: one unit of the drawing's length for 200 mrad
const LIGHT = norm([-0.55, 1])

export const figures = {
    slope: {
        aspect: 1.55,
        world: { x: [-2.9, 2.9], y: [-1.85, 1.9] },
        state: { probe: ON_ROUND, h: 0.3, method: 'both' },
        controls: [
            { type: 'slider', key: 'h', label: 'step h', min: 0.01, max: 0.6, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'seg', key: 'method', options: [['forward', 'Forward'], ['central', 'Central'], ['both', 'Both']] },
        ],
        steps: {
            round: { probe: ON_ROUND, h: 0.3, method: 'both' },
            small: { probe: ON_ROUND, h: 0.03, method: 'both' },
            crease: { probe: NEAR_CREASE, h: 0.3, method: 'both' },
            creaseSmall: { probe: NEAR_CREASE, h: 0.03, method: 'both' },
        },
        drag: { probe: (s, p) => { s.probe = [clamp(p[0], -2.8, 2.8), clamp(p[1], -1.75, 1.8)] } },
        draw(pen, s) {
            pen.field(field, { step: 0.25, cell: 4 })
            const [x, y] = s.probe, L = 0.85
            const tip = (n, l = L) => [x + n[0] * l, y + n[1] * l]
            // each arrow's name beyond its tip, at a distance of its own, so names of arrows pointing alike do not collide
            const name = (n, text, role, l) => pen.label(tip(n, l), text, { role, size: 14, align: 'center', bg: true })
            const ex = exact(x, y)
            pen.ray(s.probe, tip(ex), { role: 'normal', w: 1.6 })
            name(ex, 'exact', 'normal', L + 0.16)
            if (s.method !== 'central') {
                pen.dot([x + s.h, y], { role: 'cam', r: 3.2 }); pen.dot([x, y + s.h], { role: 'cam', r: 3.2 })
                const n = forward(field, x, y, s.h)
                pen.ray(s.probe, tip(n), { role: 'cam', w: 1.3 })
                name(n, 'forward', 'cam', L + 0.42)
            }
            if (s.method !== 'forward') {
                for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pen.dot([x + u * s.h, y + v * s.h], { role: 'accent', r: 2.6, ring: true })
                const n = central(field, x, y, s.h)
                pen.ray(s.probe, tip(n), { role: 'accent', w: 1.3 })
                name(n, 'central', 'accent', L + 0.68)
            }
            pen.handle('probe', s.probe)
        },
        readout(s) {
            const [x, y] = s.probe, ex = exact(x, y)
            const fw = deg(forward(field, x, y, s.h), ex), ce = deg(central(field, x, y, s.h), ex)
            return `step h = ${s.h.toFixed(2)} · forward: 2 more looks, ${fw.toFixed(1)}° off · central: 4 more looks, ${ce.toFixed(1)}° off (in 3D: 3 and 6)`
        },
    },

    grain: {
        aspect: 2.0,
        world: { x: [-3.0, 3.6], y: [-1.6, 1.7] },
        state: { k: 7, frac: 0.1 },
        controls: [
            { type: 'slider', key: 'k', label: 'step: 2^k spacings', min: 0, max: 16, step: 1, fmt: v => `2^${v} = ${2 ** v}` },
            { type: 'seg', key: 'frac', label: 'radius', options: [[0.3, 'Radius a third of its distance'], [0.1, 'A tenth'], [0.001, 'A thousandth']] },
        ],
        steps: { floor: { k: 7, frac: 0.1 }, fine: { k: 1, frac: 0.1 }, coarse: { k: 14, frac: 0.1 }, tiny: { k: 7, frac: 0.001 } },
        draw(pen, s) {
            // the circle, lit from the upper left through the normals the differences give at this step: dimly, plus a
            // shine -- a highlight is where a normal's error shows most, as on a polished surface
            const O = [-1.45, 0.0], RR = 1.0, K = 2 ** s.k, N = 480
            for (let i = 0; i < N; i++) {
                const a0 = i / N * 2 * Math.PI, a1 = (i + 1) / N * 2 * Math.PI, am = (a0 + a1) / 2, { g32, n } = grainNormal(s.frac, am, K)
                const c = Math.max(0, g32[0] * LIGHT[0] + g32[1] * LIGHT[1])
                const lit = 0.35 * c + 0.65 * c ** 60
                pen.line([O[0] + RR * Math.cos(a0), O[1] + RR * Math.sin(a0)], [O[0] + RR * Math.cos(a1), O[1] + RR * Math.sin(a1)],
                    { role: 'light', w: 7, exact: true, cap: 'butt', alpha: 0.05 + 0.95 * lit })
                // ...and each normal's error drawn straight: a tick outward, ERR_SCALE of length per milliradian
                const e = Math.acos(clamp(g32[0] * n[0] + g32[1] * n[1], -1, 1)) * 1000
                if (e * ERR_SCALE > 0.004) pen.line([O[0] + (RR + 0.07) * Math.cos(am), O[1] + (RR + 0.07) * Math.sin(am)],
                    [O[0] + (RR + 0.07 + Math.min(e * ERR_SCALE, 0.5)) * Math.cos(am), O[1] + (RR + 0.07 + Math.min(e * ERR_SCALE, 0.5)) * Math.sin(am)],
                    { role: 'blocked', w: 0.8, exact: true })
            }
            pen.circle(O, RR - 0.09, { role: 'faint', w: 0.8, exact: true, id: 'inner' })
            pen.bulb([O[0] - 1.05, O[1] + 1.35], { r: 6 })
            // the worst angle against the step: all of it, and its two parts
            const { W, H } = pen.view, rect = { x: W * 0.56, y: H * 0.12, w: W * 0.4, h: H * 0.66 }
            const lg = v => Math.log10(Math.max(v, 0.01))
            const curve = part => KS.map((k, i) => [i, lg(grainErrors(s.frac, k)[part])])
            pen.labelPx(rect.x - 34, rect.y - 22, 'worst angle (mrad), log scale', { role: 'soft', size: 13 })
            const { X, Y } = plot(pen, rect, {
                // the y ticks are powers of ten; the x labels (spacings, not their logarithm) are written below
                x: [0, 16], y: [-1, 3.3], xticks: [], yticks: [-1, 0, 1, 2, 3], fmt: v => String(+(10 ** v).toPrecision(1)),
                hoverX: i => `spacing ${KS[Math.round(i)] < 0.01 ? KS[Math.round(i)].toExponential(1) : +KS[Math.round(i)].toPrecision(2)}`, hoverY: v => `${(10 ** v).toPrecision(2)} mrad`,
                series: [
                    { name: 'from the step', pts: curve('step'), role: 'soft', w: 1 },
                    { name: 'f32 noise', pts: curve('noise'), role: 'blocked', w: 1 },
                    { name: 'worst', pts: curve('all'), role: 'ink', w: 1.6 },
                    { pts: [[s.k, lg(grainErrors(s.frac, K).all)]], role: 'accent', kind: 'dots', r: 4.5 },
                ],
            })
            const { ctx } = pen
            ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.setLineDash([4, 4]); ctx.lineWidth = 1
            ctx.beginPath(); ctx.moveTo(X(Math.log2(TOL_F32_STEPS)), rect.y); ctx.lineTo(X(Math.log2(TOL_F32_STEPS)), rect.y + rect.h); ctx.stroke(); ctx.restore()
            pen.labelPx(X(Math.log2(TOL_F32_STEPS)) + 4, rect.y + 2, 'the floor, 128', { role: 'accent', size: 12 })
            for (const k of [0, 4, 7, 10, 13, 16]) pen.labelPx(X(k) - 14, rect.y + rect.h + 4, String(2 ** k), { role: 'soft', size: 11, kind: 'mono' })
            pen.labelPx(rect.x + rect.w / 2 - 80, rect.y + rect.h + 20, 'step, in spacings of f32', { role: 'soft', size: 12 })
            // the curves' names at their ends: the noise falls to the right, the step's own error rises
            pen.labelPx(X(1.3), Y(lg(grainErrors(s.frac, 2).noise)) - 6, 'f32 noise', { role: 'blocked', size: 12, base: 'bottom' })
            pen.labelPx(X(8.6), Y(lg(grainErrors(s.frac, 2 ** 14).step)) - 6, "the step's own error", { role: 'soft', size: 12, base: 'bottom' })
        },
        readout(s) {
            // the step at the circle's centre, so the same K reads the same length whatever the circle's size
            const K = 2 ** s.k, e = grainErrors(s.frac, K), h = stepAt(K, grainPoint(s.frac, 0).c)
            const um = h * 1e6
            return `step ${K} spacings = ${um < 1 ? um.toFixed(3) : um.toPrecision(3)} µm at 1 m from the origin · worst angle ${e.all.toPrecision(2)} mrad (f32's part ${e.noise.toPrecision(2)}, the step's own ${e.step.toPrecision(2)})`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
