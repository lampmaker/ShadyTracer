//======================================================================================================================
// CHAPTER "Shapes as distances": its figures.
//
//   field     a distance field: contour lines, the surface, and a probe whose empty circle touches the nearest surface
//   march     sphere tracing a ray through a small scene: each step's circle, step scale and tolerance, a thin wall a
//             long step can jump, and the scene's radius a ray escapes past
//   march3d   the same march in 3D: a real picture, its normals, or how many steps each pixel's ray took; turned by dragging
//   lipschitz a squeezed circle whose distance is too large: the circles claim empty space that is not, and the ray lands
//             inside the shape or steps right over it -- and the same field divided by its steepest slope, safe again
//
// The distances are the help's 2D mirrors of sdf.js (help/widgets.js), so what is drawn is the renderer's formula.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { circle, box, smin } from '../../help/widgets.js'
import { shapeDist } from '../kit/flatland.js'
import { orbit, shade3, cameraRay3 } from '../kit/space.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const fmt = d => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2)

/* FIELD: one circle, or the circle and a box together -- the smaller distance (a union), or melted (the smooth minimum,
   the renderer's csgUnion: help/widgets.js smin). Both shapes where the state puts them, so they can be dragged. */
const R_CIRCLE = 1.0, BOX_H = [0.75, 0.55]
export const fieldOf = s => {
    const c = x => circle(x[0] - s.c[0], x[1] - s.c[1], R_CIRCLE), b = x => box(x[0] - s.b[0], x[1] - s.b[1], BOX_H[0], BOX_H[1])
    if (s.shape === 'one') return (x, y) => c([x, y])
    if (s.shape === 'two') return (x, y) => Math.min(c([x, y]), b([x, y]))
    return (x, y) => smin(c([x, y]), b([x, y]), s.k)
}
const FIELD_AT = { c: [0.55, 0.15], b: [-0.95, -0.25] }       // just touching: where a blend shows

/* THE MARCH'S SCENE: a block, a ball and a thin wall, as flatland shapes, each where the state has dragged it */
const sceneOf = s => ({
    shapes: [
        { kind: 'box', c: s.block, h: [0.7, 0.7], round: 0.04, name: 'block' },
        { kind: 'circle', c: s.ball, r: 0.75, name: 'ball' },
        { kind: 'segment', a: [s.wall[0], s.wall[1] - 1.05], b: [s.wall[0], s.wall[1] + 1.05], r: 0.035, name: 'wall' },
    ],
})
const distOf = scene => (x, y) => { let d = Infinity; for (const sh of scene.shapes) d = Math.min(d, shapeDist(sh, x, y)); return d }
const MARCH_AT = { ball: [2.05, 1.2], block: [1.4, -0.9], wall: [-0.3, 0.85] }

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
        state: { shape: 'one', probe: [-1.4, 1.3], lines: true, k: 0.6, ...FIELD_AT },
        controls: [
            { type: 'seg', key: 'shape', options: [['one', 'A circle'], ['two', 'Circle and box'], ['blend', 'Blended']] },
            { type: 'slider', key: 'k', label: 'blend', min: 0, max: 1.5, step: 0.05, fmt: v => v.toFixed(2), when: s => s.shape === 'blend' },
            { type: 'toggle', key: 'lines', label: 'Contours' },
        ],
        steps: {
            one: { shape: 'one', probe: [-1.4, 1.3], ...FIELD_AT },
            inside: { shape: 'one', probe: [0.75, -0.15], ...FIELD_AT },
            two: { shape: 'two', probe: [-0.3, 1.45], ...FIELD_AT },
            blend: { shape: 'blend', k: 0.6, probe: [-0.25, -1.15], ...FIELD_AT },
        },
        drag: {
            probe: (s, p) => { s.probe = [clamp(p[0], -3.1, 3.1), clamp(p[1], -2.1, 2.1)] },
            circle: (s, p) => { s.c = [clamp(p[0], -2.2, 2.2), clamp(p[1], -1.2, 1.2)] },
            box: (s, p) => { s.b = [clamp(p[0], -2.4, 2.4), clamp(p[1], -1.6, 1.6)] },
        },
        draw(pen, s) {
            const f = fieldOf(s)
            pen.field(f, { step: s.lines ? 0.25 : 0, cell: 4 })
            const d = f(...s.probe)
            pen.circle(s.probe, Math.abs(d), { role: d < 0 ? 'blocked' : 'cam', w: 1.1, id: 'empty' })
            // the nearest surface point: down the field's slope by d
            const h = 1e-4, gx = (f(s.probe[0] + h, s.probe[1]) - f(s.probe[0] - h, s.probe[1])) / (2 * h), gy = (f(s.probe[0], s.probe[1] + h) - f(s.probe[0], s.probe[1] - h)) / (2 * h)
            const g = Math.hypot(gx, gy) || 1, q = [s.probe[0] - gx / g * d, s.probe[1] - gy / g * d]
            pen.line(s.probe, q, { role: d < 0 ? 'blocked' : 'cam', w: 1, id: 'toSurface' })
            pen.dot(q, { role: 'accent', r: 3.2 })
            // the shapes' own handles, at their middles: drag them about
            pen.handle('circle', s.c, { role: 'soft' })
            if (s.shape !== 'one') pen.handle('box', s.b, { role: 'soft' })
            pen.handle('probe', s.probe)
            pen.label(s.probe, `distance ${fmt(d)}`, { kind: 'mono', size: 13, dx: 14, dy: 16, bg: true })
        },
        readout(s) {
            const d = fieldOf(s)(...s.probe)
            return (d < 0 ? `inside: ${(-d).toFixed(3)} below the surface (the distance is negative)` : `outside: nothing is closer than ${d.toFixed(3)}`)
                + (s.shape === 'blend' ? ` · blend ${s.k.toFixed(2)}` : '')
        },
    },

    march: {
        aspect: 1.45,
        world: { x: [-3.85, 4.0], y: [-2.75, 2.75] },
        state: { from: [-3.3, 0.35], aim: [1.8, 0.9], stepscale: 0.9, eps: 0.01, radius: 3.6, ...MARCH_AT },
        controls: [
            { type: 'slider', key: 'stepscale', label: 'step scale', min: 0.3, max: 1.8, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'eps', label: 'tolerance', min: 0.002, max: 0.3, step: 0.002, fmt: v => v.toFixed(3) },
        ],
        steps: {
            march: { from: [-3.3, 0.35], aim: [1.8, 0.9], stepscale: 0.9, eps: 0.01, ...MARCH_AT },
            graze: { from: [-3.3, -1.45], aim: [0.7, -0.18], stepscale: 0.9, eps: 0.01, ...MARCH_AT },
            // the grazing ray again: at a large tolerance, a ray that would slip past the block's corner stops beside it
            tolerance: { from: [-3.3, -1.45], aim: [0.7, -0.18], stepscale: 0.9, eps: 0.1, ...MARCH_AT },
            overshoot: { from: [-3.3, 0.95], aim: [1.8, 0.75], stepscale: 1.7, eps: 0.01, ...MARCH_AT },
            escape: { from: [-3.3, 2.1], aim: [1.8, 2.5], stepscale: 0.9, eps: 0.01, ...MARCH_AT },
        },
        drag: {
            from: (s, p) => { s.from = [clamp(p[0], -3.8, 3.9), clamp(p[1], -2.6, 2.6)] },
            aim: (s, p) => { s.aim = [clamp(p[0], -3.8, 3.9), clamp(p[1], -2.6, 2.6)] },
            ball: (s, p) => { s.ball = [clamp(p[0], -2.5, 2.8), clamp(p[1], -1.9, 1.9)] },
            block: (s, p) => { s.block = [clamp(p[0], -2.5, 2.8), clamp(p[1], -1.9, 1.9)] },
            wall: (s, p) => { s.wall = [clamp(p[0], -2.5, 2.8), clamp(p[1], -1.5, 1.5)] },
        },
        draw(pen, s) {
            pen.circle([0, 0], s.radius, { role: 'faint', w: 0.8, dash: [6, 6], id: 'radius' })
            pen.label([s.radius * Math.cos(-0.62), s.radius * Math.sin(-0.62)], "the scene's radius", { role: 'soft', size: 13, dx: -8, dy: 12, align: 'right' })
            const scene = sceneOf(s), sceneD = distOf(scene)
            for (const sh of scene.shapes) pen.flat(sh, { id: sh.name })
            const d = unit(s.from, s.aim)
            const r = sphereTrace(sceneD, s.from, d, s)
            drawSteps(pen, r)
            const t = truth(sceneD, s.from, d), reached = Math.hypot(r.x - s.from[0], r.y - s.from[1])
            if (r.end === 'hit' && reached > t + 0.02) {
                pen.dot([s.from[0] + d[0] * t, s.from[1] + d[1] * t], { role: 'blocked', r: 5, ring: true })
                pen.label([s.from[0] + d[0] * t, s.from[1] + d[1] * t], 'it should have stopped here', { role: 'blocked', size: 14, dx: 10, dy: -16 })
            }
            // stopped before the real surface: a near miss counted as a hit, or a stop well short of what it hit
            const early = r.end === 'hit' && t > reached + 0.03
            if (early) pen.label([r.x, r.y], t === Infinity ? 'a near miss, counted as a hit' : 'stopped short', { role: 'blocked', size: 14, dx: 10, dy: 18 })
            for (const k of ['ball', 'block', 'wall']) pen.handle(k, s[k], { role: 'soft' })
            pen.handle('from', s.from, { label: 'start' })
            pen.handle('aim', s.aim, { label: 'aim' })
            s._r = { n: r.steps.length, end: r.end, through: r.end === 'hit' ? reached > t + 0.02 : t < 12 && r.end !== 'hit', early, short: t - reached }
        },
        readout(s) {
            const r = s._r
            if (!r) return ''
            const what = r.through ? (r.end === 'hit' ? 'hit — but the wrong surface: it stepped through one' : `${r.end} — straight through a surface`)
                : r.early ? (r.short === Infinity ? 'counted as a hit, though the ray would have missed: it passed within the tolerance' : `stopped ${r.short.toFixed(2)} short of the surface`)
                : r.end === 'hit' ? 'hit a surface' : r.end
            return `${r.n} steps · ${what}`
        },
    },

    lipschitz: {
        aspect: 1.6,
        world: { x: [-3.4, 3.2], y: [-1.9, 2.2] },
        // squeezed to half: the first step of the raw formula lands inside the ellipse; squeezed harder, it jumps it
        state: { squash: 0.5, safe: false, start: [-2.0, 0.25] },
        controls: [
            { type: 'slider', key: 'squash', label: 'squeeze', min: 0.2, max: 1, step: 0.01, fmt: v => `× ${v.toFixed(2)}` },
            { type: 'toggle', key: 'safe', label: 'Divide by the slope' },
        ],
        steps: { lie: { squash: 0.5, safe: false, start: [-2.0, 0.25] }, fix: { squash: 0.5, safe: true, start: [-2.0, 0.25] } },
        drag: { start: (s, p) => { s.start = [clamp(p[0], -3.2, -0.9), clamp(p[1], -1.6, 1.6)] } },
        draw(pen, s) {
            const R = 1.4, k = s.squash, a = R * k
            const raw = (x, y) => circle(x / k, y, R)             // the circle's formula with x squeezed: an ellipse
            const f = s.safe ? (x, y) => raw(x, y) * k : raw       // it changes up to 1/k as fast as a distance: divide
            const pts = []
            for (let i = 0; i < 72; i++) { const t = i / 72 * Math.PI * 2; pts.push([a * Math.cos(t), R * Math.sin(t)]) }
            pen.shape(pts, { role: 'solid', fill: 'fill', w: 1.25, id: 'ellipse' })
            const o = s.start, r = sphereTrace(f, o, [1, 0], { stepscale: 1, eps: 0.004, radius: 50, max: 60 })
            // where the ray really meets the ellipse (it runs along y = o[1]), and leaves it
            const enter = Math.abs(o[1]) < R ? -a * Math.sqrt(1 - (o[1] / R) ** 2) : Infinity, exit = -enter
            const inside = st => (st.x / a) ** 2 + (st.y / R) ** 2 < 1
            const firstIn = r.steps.findIndex(inside)
            const over = firstIn < 0 && enter < Infinity ? r.steps.findIndex(st => st.x > exit) : -1
            const last = firstIn >= 0 ? firstIn : over >= 0 ? over : r.steps.length - 1
            const shown = r.steps.slice(0, last + 1)
            for (const [j, st] of shown.entries()) {
                const lies = Math.abs(st.d) > trueDist(st, a, R) + 1e-6    // a circle bigger than the real distance
                pen.circle([st.x, st.y], Math.abs(st.d), { role: lies ? 'blocked' : 'step', w: 0.8, exact: true })
                pen.dot([st.x, st.y], { role: j === firstIn ? 'blocked' : 'cam', r: j === firstIn ? 4.5 : 2.4 })
            }
            const end = shown[shown.length - 1]
            pen.ray(o, [end.x, end.y], { role: 'cam', w: 1.2, arrow: over >= 0 })
            if (firstIn >= 0) pen.label([end.x, end.y], 'inside the shape!', { role: 'blocked', size: 15, dx: 10, dy: -18 })
            if (over >= 0) {
                pen.dot([enter, o[1]], { role: 'blocked', r: 5, ring: true })
                pen.label([enter, o[1]], 'it should have stopped here', { role: 'blocked', size: 14, dx: -10, dy: -18, align: 'right' })
            }
            pen.handle('start', o, { label: 'start' })
            s._r = { n: shown.length, end: firstIn >= 0 ? 'inside' : over >= 0 ? 'over' : r.end }
        },
        readout(s) {
            const r = s._r
            if (!r) return ''
            if (r.end === 'inside') return `${r.n} steps · the ray landed inside the shape: the formula claimed more empty space than there was`
            if (r.end === 'over') return `${r.n} steps · the ray stepped right over the shape: a step was longer than the real distance`
            return `${r.n} steps · ${r.end === 'hit' ? 'stopped at the surface' : r.end}${s.safe ? ', every circle truly empty' : ''}`
        },
    },
}

/* the true distance from a point to the ellipse with half-axes a, b: sampled densely, for marking which circles lie */
function trueDist(p, a, b) {
    let best = Infinity
    for (let i = 0; i < 720; i++) { const t = i / 720 * Math.PI * 2; best = Math.min(best, Math.hypot(p.x - a * Math.cos(t), p.y - b * Math.sin(t))) }
    return best
}


/* THE MARCH IN 3D (space.js, z up): a small scene sphere traced into a real picture, a ray a pixel, as the march kernel
   does it -- shown lit by the sun, as the normals it found, or as how many steps each ray took: the march's cost, pixel
   by pixel. One pass, no noise, so it redraws as it is turned. */
const SCENE3 = {
    sky: [0.62, 0.72, 0.85],
    shapes: [
        { kind: 'plane', z: 0, rgb: [0.78, 0.76, 0.7] },
        { kind: 'sphere', c: [0.55, -0.95, 0.7], r: 0.7, rgb: [0.86, 0.3, 0.2] },
        { kind: 'box', c: [-0.75, 0.45, 0.5], h: [0.5, 0.5, 0.5], round: 0.08, rgb: [0.24, 0.44, 0.86] },
        { kind: 'torus', c: [0.95, 0.95, 0.2], R: 0.55, r: 0.2, rgb: [0.9, 0.7, 0.25] },
    ],
}
const FILM = [96, 60]
/* the style's colours as linear RGB, for the steps view's scale: few steps the paper, many the accent */
const linear = css => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(css) ?? /#(..)(..)(..)/.exec(css)?.slice(0, 4).map((v, i) => i ? String(parseInt(v, 16)) : v)
    return m ? [1, 2, 3].map(k => Math.pow(+m[k] / 255, 2.2)) : [0.5, 0.5, 0.5]
}
figures.march3d = {
    aspect: FILM[0] / FILM[1],
    world: { x: [-1, 1], y: [-0.625, 0.625] },
    orbit: true,
    state: { yaw: -1.05, pitch: 0.32, view: 'picture', stepscale: 0.9 },
    controls: [
        { type: 'seg', key: 'view', options: [['picture', 'Picture'], ['steps', 'Steps per pixel'], ['normal', 'Normals']] },
        { type: 'slider', key: 'stepscale', label: 'step scale', min: 0.5, max: 1.8, step: 0.05, fmt: v => v.toFixed(2) },
    ],
    steps: {
        picture: { view: 'picture', stepscale: 0.9 },
        steps: { view: 'steps', stepscale: 0.9 },
        scale: { view: 'picture', stepscale: 1.6 },
    },
    draw(pen, s) {
        const [W, H] = FILM, cam = orbit({ yaw: s.yaw, pitch: s.pitch, dist: 4.4, target: [0, 0, 0.45] })
        const lens = { eye: cam.eye, target: [0, 0, 0.45], fov: 0.8 }
        const px = []
        let sum = 0, most = 0
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
            const r = shade3(SCENE3, lens.eye, cameraRay3(lens, i, j, W, H), { view: s.view === 'normal' ? 'normal' : 'sun', stepscale: s.stepscale })
            px.push(r); sum += r.steps; most = Math.max(most, r.steps)
        }
        s._steps = { avg: sum / (W * H), most }
        const lo = linear(pen.col('paper')), mid = linear(pen.col('cam')), hi = linear(pen.col('accent'))
        const ramp = t => t < 0.5 ? lo.map((v, k) => v + (mid[k] - v) * t * 2) : mid.map((v, k) => v + (hi[k] - v) * (t - 0.5) * 2)
        const top = Math.max(8, most)
        pen.image(0, 0, pen.view.W, pen.view.H, W, H, (i, j) => {
            const r = px[j * W + i]
            return s.view === 'steps' ? ramp(Math.sqrt((r.steps - 1) / (top - 1))) : r.rgb
        })
        if (s.view === 'steps') {
            // the scale: a strip from one step to the most any ray took
            const x0 = 12, y0 = pen.view.H - 26, w = Math.min(180, pen.view.W * 0.35)
            pen.image(x0, y0, w, 9, 32, 1, i => ramp(i / 31))
            pen.labelPx(x0, y0 - 16, '1 step', { role: 'ink', size: 12, kind: 'mono' })
            pen.labelPx(x0 + w, y0 - 16, `${top} steps`, { role: 'ink', size: 12, kind: 'mono', align: 'right' })
        }
    },
    readout(s) {
        if (!s._steps) return ''
        return `${FILM[0]} × ${FILM[1]} rays · on average ${s._steps.avg.toFixed(1)} steps a ray, the most ${s._steps.most}` +
            (s.stepscale > 1 ? ` · step scale ${s.stepscale.toFixed(2)}: steps longer than the distance` : '') + ' · drag to turn'
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
