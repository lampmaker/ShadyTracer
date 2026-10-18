//======================================================================================================================
// CHAPTER "Shapes as distances": its figures.
//
//   field     a distance field: contour lines, the surface, and a probe whose empty circle touches the nearest surface
//   march     sphere tracing a ray through a small scene: each step's circle, step scale and tolerance, a thin wall a
//             long step can jump, and the scene's radius a ray escapes past
//   lipschitz a squashed circle whose distance is too large: the circles claim empty space that is not, the ray ends up
//             inside -- and the same field divided by its steepest slope, safe again
//
// The distances are the help's 2D mirrors of sdf.js (help/widgets.js), so what is drawn is the renderer's formula.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { circle, box, smin } from '../../help/widgets.js'
import { shapeDist } from '../kit/flatland.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const fmt = d => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2)

/* FIELD: one circle, or the circle and a box together (the smaller distance: a union) */
const FIELD = {
    one: (x, y) => circle(x - 0.4, y - 0.1, 1.1),
    two: (x, y) => Math.min(circle(x - 0.9, y - 0.2, 1.0), box(x + 1.6, y + 0.35, 0.8, 0.55)),
    blend: (x, y) => smin(circle(x - 0.9, y - 0.2, 1.0), box(x + 1.6, y + 0.35, 0.8, 0.55), 0.9),
}

/* THE MARCH'S SCENE: a block, a ball and a thin wall, as flatland shapes */
const SCENE = {
    shapes: [
        { kind: 'box', c: [1.4, -0.9], h: [0.7, 0.7], round: 0.04, name: 'block' },
        { kind: 'circle', c: [2.05, 1.2], r: 0.75, name: 'ball' },
        { kind: 'segment', a: [-0.3, -0.2], b: [-0.3, 1.9], r: 0.035, name: 'wall' },
    ],
}
const sceneD = (x, y) => { let d = Infinity; for (const s of SCENE.shapes) d = Math.min(d, shapeDist(s, x, y)); return d }

/* SPHERE TRACING, written out the way the march kernel does it (wavefront.js prog_march): the distance here, a hit
   when it is under the tolerance, escaped when outside the scene's radius and heading out, else a step of
   stepscale x distance. Recorded step by step for the figure. */
export function sphereTrace(f, o, d, { stepscale = 0.9, eps = 0.01, radius = 3.6, max = 80 } = {}) {
    const steps = []
    let x = o[0], y = o[1]
    for (let n = 0; n < max; n++) {
        const dist = f(x, y), a = Math.abs(dist)
        steps.push({ x, y, d: dist })
        if (a < eps) return { steps, end: 'hit', x, y }
        if (x * d[0] + y * d[1] > 0 && x * x + y * y > radius * radius) return { steps, end: 'escaped', x, y }
        x += d[0] * a * stepscale; y += d[1] * a * stepscale
    }
    return { steps, end: 'out of steps', x, y }
}
/* where the ray REALLY first touches something: tiny steps, for judging what the march did */
function truth(f, o, d, far = 12) {
    for (let t = 0; t < far; t += 0.002) { if (f(o[0] + d[0] * t, o[1] + d[1] * t) < 0) return t }
    return Infinity
}
const unit = (a, b) => { const x = b[0] - a[0], y = b[1] - a[1], l = Math.hypot(x, y) || 1; return [x / l, y / l] }

function drawSteps(pen, r, { circles = true, inside = null } = {}) {
    for (const [k, st] of r.steps.entries()) {
        if (circles) pen.circle([st.x, st.y], Math.abs(st.d), { role: inside?.(st) ? 'blocked' : 'step', w: 0.7, exact: true })
        pen.dot([st.x, st.y], { role: 'cam', r: k === 0 ? 3.5 : 2.4 })
    }
    pen.ray([r.steps[0].x, r.steps[0].y], [r.x, r.y], { role: 'cam', w: 1.2, arrow: r.end !== 'hit' })
    if (r.end === 'hit') pen.dot([r.x, r.y], { role: 'accent', r: 4 })
}

export const figures = {
    field: {
        aspect: 1.5,
        world: { x: [-3.2, 3.2], y: [-2.2, 2.2] },
        state: { shape: 'one', probe: [-1.4, 1.3], lines: true },
        controls: [
            { type: 'seg', key: 'shape', options: [['one', 'A circle'], ['two', 'Circle and box'], ['blend', 'Blended']] },
            { type: 'toggle', key: 'lines', label: 'Contours' },
        ],
        steps: {
            one: { shape: 'one', probe: [-1.4, 1.3] },
            inside: { shape: 'one', probe: [0.75, -0.15] },
            two: { shape: 'two', probe: [-0.3, 1.45] },
            blend: { shape: 'blend', probe: [0.05, -1.25] },
        },
        drag: { probe: (s, p) => { s.probe = [clamp(p[0], -3.1, 3.1), clamp(p[1], -2.1, 2.1)] } },
        draw(pen, s) {
            const f = FIELD[s.shape]
            pen.field(f, { step: s.lines ? 0.25 : 0, cell: 4 })
            const d = f(...s.probe)
            pen.circle(s.probe, Math.abs(d), { role: d < 0 ? 'blocked' : 'cam', w: 1.1, id: 'empty' })
            // the nearest surface point: down the field's slope by d
            const h = 1e-4, gx = (f(s.probe[0] + h, s.probe[1]) - f(s.probe[0] - h, s.probe[1])) / (2 * h), gy = (f(s.probe[0], s.probe[1] + h) - f(s.probe[0], s.probe[1] - h)) / (2 * h)
            const g = Math.hypot(gx, gy) || 1, q = [s.probe[0] - gx / g * d, s.probe[1] - gy / g * d]
            pen.line(s.probe, q, { role: d < 0 ? 'blocked' : 'cam', w: 1, id: 'toSurface' })
            pen.dot(q, { role: 'accent', r: 3.2 })
            pen.handle('probe', s.probe)
            pen.label(s.probe, `distance ${fmt(d)}`, { kind: 'mono', size: 13, dx: 14, dy: 16, bg: true })
        },
        readout(s) {
            const d = FIELD[s.shape](...s.probe)
            return d < 0 ? `inside: ${(-d).toFixed(3)} below the surface (the distance is negative)` : `outside: nothing is closer than ${d.toFixed(3)}`
        },
    },

    march: {
        aspect: 1.45,
        world: { x: [-3.85, 4.0], y: [-2.75, 2.75] },
        state: { from: [-3.3, 0.35], aim: [1.8, 0.9], stepscale: 0.9, eps: 0.01, radius: 3.6 },
        controls: [
            { type: 'slider', key: 'stepscale', label: 'step scale', min: 0.3, max: 1.8, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'eps', label: 'tolerance', min: 0.002, max: 0.3, step: 0.002, fmt: v => v.toFixed(3) },
        ],
        steps: {
            march: { from: [-3.3, 0.35], aim: [1.8, 0.9], stepscale: 0.9, eps: 0.01 },
            graze: { from: [-3.3, -1.45], aim: [0.7, -0.18], stepscale: 0.9, eps: 0.01 },
            tolerance: { from: [-3.3, 0.35], aim: [1.8, 0.9], stepscale: 0.9, eps: 0.25 },
            overshoot: { from: [-3.3, 0.95], aim: [1.8, 0.75], stepscale: 1.7, eps: 0.01 },
            escape: { from: [-3.3, 2.1], aim: [1.8, 2.5], stepscale: 0.9, eps: 0.01 },
        },
        drag: {
            from: (s, p) => { s.from = [clamp(p[0], -3.8, 3.9), clamp(p[1], -2.6, 2.6)] },
            aim: (s, p) => { s.aim = [clamp(p[0], -3.8, 3.9), clamp(p[1], -2.6, 2.6)] },
        },
        draw(pen, s) {
            pen.circle([0, 0], s.radius, { role: 'faint', w: 0.8, dash: [6, 6], id: 'radius' })
            pen.label([s.radius * Math.cos(-0.62), s.radius * Math.sin(-0.62)], "the scene's radius", { role: 'soft', size: 13, dx: 8 })
            for (const sh of SCENE.shapes) pen.flat(sh, { id: sh.name })
            const d = unit(s.from, s.aim)
            const r = sphereTrace(sceneD, s.from, d, s)
            drawSteps(pen, r)
            const t = truth(sceneD, s.from, d), reached = Math.hypot(r.x - s.from[0], r.y - s.from[1])
            if (r.end === 'hit' && reached > t + 0.02) {
                pen.dot([s.from[0] + d[0] * t, s.from[1] + d[1] * t], { role: 'blocked', r: 5, ring: true })
                pen.label([s.from[0] + d[0] * t, s.from[1] + d[1] * t], 'it should have stopped here', { role: 'blocked', size: 14, dx: 10, dy: -16 })
            }
            pen.handle('from', s.from, { label: 'start' })
            pen.handle('aim', s.aim, { label: 'aim' })
            s._r = { n: r.steps.length, end: r.end, through: r.end === 'hit' ? reached > t + 0.02 : t < 12 && r.end !== 'hit' }
        },
        readout(s) {
            const r = s._r
            if (!r) return ''
            const what = r.through ? (r.end === 'hit' ? 'hit — but the wrong surface: it stepped through one' : `${r.end} — straight through a surface`)
                : r.end === 'hit' ? 'hit a surface' : r.end
            return `${r.n} steps · ${what}`
        },
    },

    lipschitz: {
        aspect: 1.6,
        world: { x: [-3.4, 3.2], y: [-1.9, 2.2] },
        state: { squash: 0.3, safe: false, y0: 0.25 },
        controls: [
            { type: 'slider', key: 'squash', label: 'squash', min: 0.15, max: 1, step: 0.01, fmt: v => `× ${v.toFixed(2)}` },
            { type: 'toggle', key: 'safe', label: 'Divide by the slope' },
        ],
        steps: { lie: { squash: 0.3, safe: false }, fix: { squash: 0.3, safe: true } },
        drag: { start: (s, p) => { s.y0 = clamp(p[1], -1.6, 1.6) } },
        draw(pen, s) {
            const R = 1.4, k = s.squash
            const wrong = (x, y) => circle(x / k, y, R)          // the circle's formula, with x squeezed: an ellipse
            const f = s.safe ? (x, y) => wrong(x, y) * k : wrong   // its steepest slope is 1/k: divide by it
            // the true shape, an ellipse R k wide and R tall
            const pts = []
            for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; pts.push([R * k * Math.cos(a), R * Math.sin(a)]) }
            pen.shape(pts, { role: 'solid', fill: 'fill', w: 1.25, id: 'ellipse' })
            const o = [-3.1, s.y0], d = [1, 0]
            const r = sphereTrace(f, o, d, { stepscale: 1, eps: 0.004, radius: 50, max: 60 })
            const insideShape = st => (st.x / (R * k)) ** 2 + (st.y / R) ** 2 < 1
            // stop drawing past the first step that landed inside: the rest is a ray lost in a solid
            const firstIn = r.steps.findIndex(insideShape)
            const shown = firstIn >= 0 ? { ...r, steps: r.steps.slice(0, firstIn + 1), x: r.steps[firstIn].x, y: r.steps[firstIn].y, end: 'inside' } : r
            for (const [j, st] of shown.steps.entries()) {
                const lies = Math.abs(st.d) > trueDist(st, R * k, R) + 1e-6    // a circle bigger than the real distance
                pen.circle([st.x, st.y], Math.abs(st.d), { role: lies ? 'blocked' : 'step', w: 0.8, exact: true })
                pen.dot([st.x, st.y], { role: firstIn === j ? 'blocked' : 'cam', r: firstIn === j ? 4.5 : 2.4 })
            }
            pen.ray(o, [shown.x, shown.y], { role: 'cam', w: 1.2, arrow: false })
            pen.handle('start', o, { label: 'start' })
            if (firstIn >= 0) pen.label([shown.x, shown.y], 'inside the shape!', { role: 'blocked', size: 15, dx: 10, dy: -18 })
            s._r = { n: shown.steps.length, inside: firstIn >= 0 }
        },
        readout(s) {
            if (!s._r) return ''
            return s._r.inside ? `${s._r.n} steps · the ray ended up inside the shape: a step was longer than the real distance`
                : `${s._r.n} steps · stopped at the surface${s.safe ? ', every circle really empty' : ''}`
        },
    },
}

/* the true distance from a point to the ellipse with half-axes a, b: sampled densely, for marking which circles lie */
function trueDist(p, a, b) {
    let best = Infinity
    for (let i = 0; i < 720; i++) { const t = i / 720 * Math.PI * 2; best = Math.min(best, Math.hypot(p.x - a * Math.cos(t), p.y - b * Math.sin(t))) }
    return best
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
