//======================================================================================================================
// CHAPTER "Every glowing thing is a light": its figures.
//
//   discovery  paths through a room with two glowing things in it, one in plain view and one round a corner: every
//              path that hits one records where, in a 16 x 16 grid as materials_pbr.js emitDeposit does in 16^3; each
//              cell with hits becomes a box, the tight bounds of its hits, and once the list is made (every second
//              sample, as the engine does) a circle round it for aiming at
//   crofton    random lines through a circle: how many cross each shape inside, against its perimeter (Cauchy-Crofton),
//              and the angles they cross at -- a glowing surface's own spread of directions, for free
//   code       the brightness the grid keeps, in 32 bits: the old linear code against the log code (tracebasics.js
//              LUM_CODE, mirrored), over brightnesses from starlight to the sun in a mirror
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng, tracePath, cameraRay } from '../kit/flatland.js'
import { plot } from '../kit/plot.js'
import { circle, box } from '../../help/widgets.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/* THE ROOM: a glowing ball in view (where the reader drags it), and a glowing bar behind a wall the camera cannot see
   past */
export const BALL = [2.6, 2.6]
export const roomWith = (ball = BALL) => ({
    sky: 0,
    shapes: [
        { kind: 'box', c: [3.4, -0.3], h: [4.1, 0.3], albedo: 0.7, name: 'floor' },
        { kind: 'box', c: [3.4, 4.4], h: [4.1, 0.3], albedo: 0.7, name: 'ceiling' },
        { kind: 'box', c: [-0.4, 2.05], h: [0.3, 2.65], albedo: 0.7, name: 'left' },
        { kind: 'box', c: [7.2, 2.05], h: [0.3, 2.65], albedo: 0.7, name: 'right' },
        { kind: 'box', c: [5.2, 1.6], h: [0.12, 1.6], albedo: 0.7, name: 'wall' },
        { kind: 'circle', c: ball, r: 0.35, albedo: 0, emit: 2, name: 'ball' },
        { kind: 'segment', a: [6.2, 0.4], b: [6.2, 2.4], r: 0.02, emit: 2, name: 'bar' },
    ],
})
export const ROOM = roomWith()
const CAM = { eye: [0.3, 1.6], dir: Math.atan2(1.8 - 1.6, 4.9 - 0.3), fov: 80 * Math.PI / 180, pixels: 48 }
// the grid over the room's square: EG cells each way, as the engine's 16 (over +-emitHalf, in 3D)
export const EG = 16
const G0 = [-0.7, -0.6], GS = 8.2 / EG
// the list of targets is rebuilt every EMIT_EPOCH samples (raytrace_main.js), from what the cells hold then: until the
// first rebuild a cell has hits and a box, and nothing aims at it yet
export const EMIT_EPOCH = 2
const cellOf = (x, y) => { const i = Math.floor((x - G0[0]) / GS), j = Math.floor((y - G0[1]) / GS); return i >= 0 && j >= 0 && i < EG && j < EG ? i + EG * j : -1 }

/** paths a sample per pixel, every hit of a glowing thing deposited: { cells: Map(cell -> { lo, hi, n }), hits } */
export function discover(seed, samples, ball = BALL) {
    const R = rng(seed * 7919 + 5), cells = new Map(), shown = [], room = roomWith(ball)
    for (let s = 0; s < samples; s++) for (let i = 0; i < CAM.pixels; i++) {
        const [ox, oy, dx, dy] = cameraRay(CAM, i, R()), rec = []
        tracePath(room, ox, oy, dx, dy, { maxBounce: 6, rand: R, record: rec })
        const last = rec[rec.length - 1]
        if (!last?.lamp) continue
        const [x, y] = last.b, k = cellOf(x, y)
        if (k < 0) continue
        const c = cells.get(k) ?? { lo: [x, y], hi: [x, y], n: 0 }
        c.lo = [Math.min(c.lo[0], x), Math.min(c.lo[1], y)]; c.hi = [Math.max(c.hi[0], x), Math.max(c.hi[1], y)]; c.n++
        cells.set(k, c)
        shown.push(rec); if (shown.length > 24) shown.shift()      // the latest paths that found a glow
    }
    return { cells, shown }
}
/* a cell's box as the collect kernel lists it: the circle round its tight bounds, with a small margin */
const boxCircle = c => { const m = [(c.lo[0] + c.hi[0]) / 2, (c.lo[1] + c.hi[1]) / 2]; return { c: m, r: Math.hypot(c.hi[0] - c.lo[0], c.hi[1] - c.lo[1]) / 2 + 0.03 } }

/* CROFTON: lines through a circle of radius RC, each by an angle in [0, pi) and an offset in [-RC, RC], uniform: the
   measure of lines that cross a curve, counted with every crossing, is twice its length, out of 2 pi RC for all lines
   through the circle. So a curve of length l is crossed l / (pi RC) times a line, on average. */
export const RC = 2
export const CROFTON_SHAPES = [
    { name: 'disc', len: 2 * Math.PI * 0.45, d: (x, y) => circle(x + 0.8, y - 0.6, 0.45) },
    { name: 'box', len: 2 * (1.2 + 0.5), d: (x, y) => box(x - 0.6, y + 0.7, 0.6, 0.25) },
    { name: 'rod', len: 1.0, seg: [[0.9, 0.2], [0.9, 1.2]] },
]
/** where a line (angle a, offset p) crosses each shape, and at what angle to the shape's normal */
function crossings(a, p) {
    const dx = Math.cos(a), dy = Math.sin(a), ox = -dy * p, oy = dx * p, out = []
    // the line from t = -RC to RC through the circle (its chord is shorter: every point found is inside)
    CROFTON_SHAPES.forEach((sh, k) => {
        if (sh.seg) {
            const [A, B] = sh.seg, ex = B[0] - A[0], ey = B[1] - A[1], den = dx * ey - dy * ex
            if (Math.abs(den) < 1e-12) return
            const t = ((A[0] - ox) * ey - (A[1] - oy) * ex) / den, u = ((A[0] - ox) * dy - (A[1] - oy) * dx) / den
            if (u >= 0 && u <= 1) out.push({ k, x: ox + dx * t, y: oy + dy * t, cos: Math.abs(dx * ey - dy * ex) / Math.hypot(ex, ey) })
            return
        }
        const n = 400, L = Math.sqrt(Math.max(0, RC * RC - p * p))
        let prev = sh.d(ox - dx * L, oy - dy * L)
        for (let i = 1; i <= n; i++) {
            const t = -L + 2 * L * i / n, v = sh.d(ox + dx * t, oy + dy * t)
            if (Math.sign(v) !== Math.sign(prev)) {
                let lo = t - 2 * L / n, hi = t
                for (let q = 0; q < 40; q++) { const m = (lo + hi) / 2; if (Math.sign(sh.d(ox + dx * m, oy + dy * m)) === Math.sign(prev)) lo = m; else hi = m }
                const x = ox + dx * lo, y = oy + dy * lo, h = 1e-5
                const gx = sh.d(x + h, y) - sh.d(x - h, y), gy = sh.d(x, y + h) - sh.d(x, y - h), gl = Math.hypot(gx, gy) || 1
                out.push({ k, x, y, cos: Math.abs(gx * dx + gy * dy) / gl })
            }
            prev = v
        }
    })
    return { ox, oy, dx, dy, out }
}
const croftonCache = new Map()
export function crofton(seed, n) {
    const key = `${seed}|${n}`
    if (croftonCache.has(key)) return croftonCache.get(key)
    const R = rng(seed * 104729 + 3), lines = [], count = CROFTON_SHAPES.map(() => 0), cosines = []
    for (let i = 0; i < n; i++) {
        const c = crossings(R() * Math.PI, (2 * R() - 1) * RC)
        for (const x of c.out) { count[x.k]++; cosines.push(x.cos) }
        if (lines.length < 150) lines.push(c)
    }
    const r = { lines, count, cosines, n }
    if (croftonCache.size > 20) croftonCache.clear()
    croftonCache.set(key, r)
    return r
}

/* THE BRIGHTNESS CODES, from tracebasics.js: the old u32(clamp(lum, 0, 1e5) * 16), and LUM_CODE's
   u32(clamp(log2(lum) + 40, 0, 80) * 2^24 / 80) + 1 (0 kept for "never seen") */
export const oldCode = lum => Math.floor(Math.min(Math.max(lum, 0), 1e5) * 16)
export const LUM_K = 2 ** 24 / 80
export const lumEncode = lum => Math.floor(Math.min(Math.max(Math.log2(Math.max(lum, 1e-30)) + 40, 0), 80) * Math.fround(LUM_K)) + 1
export const lumDecode = q => q > 0 ? 2 ** ((q - 1) / Math.fround(LUM_K) - 40) : 0
// two scale marks of everyday light (about: not measured here), and the two the comment names
// the sun in a mirror at the renderer's default 100,000 lux, by photometry.js discLuminance (chapter 5): 1.49e9, not the
// comments' 1.6e9
const MARKS = [[0.01, 'night, ~0.01'], [100, 'a lit page, ~100'], [2e4, 'a bright panel, 20,000'], [1.488e9, 'the sun in a mirror, 1.5e9']]

export const figures = {
    discovery: {
        aspect: 1.55,
        world: { x: [-0.9, 7.7], y: [-0.75, 4.95] },
        state: { seed: 2, samples: 1, ball: BALL },
        controls: [
            { type: 'seg', key: 'samples', label: 'samples', options: [[1, '1 sample'], [8, '8'], [64, '64']] },
            { type: 'button', label: 'New paths', act: s => { s.seed++ } },
        ],
        steps: { one: { samples: 1, seed: 2, ball: BALL }, eight: { samples: 8, seed: 2, ball: BALL }, many: { samples: 64, seed: 2, ball: BALL } },
        // the glowing ball anywhere left of the wall, clear of the walls round it
        drag: { ball: (s, p) => { s.ball = [clamp(p[0], 0.45, 4.6), clamp(p[1], 0.45, 3.65)] } },
        draw(pen, s) {
            const { cells, shown } = discover(s.seed, s.samples, s.ball), { ctx } = pen
            // the grid, its cells with hits shaded: drawn dashed, so it is not the paper's
            ctx.save(); ctx.fillStyle = pen.col('accent'); ctx.globalAlpha = 0.1
            for (const k of cells.keys()) { const i = k % EG, j = Math.floor(k / EG); ctx.fillRect(pen.X(G0[0] + i * GS), pen.Y(G0[1] + (j + 1) * GS), GS * pen.view.s, GS * pen.view.s) }
            ctx.restore()
            for (let i = 0; i <= EG; i++) {
                pen.line([G0[0] + i * GS, G0[1]], [G0[0] + i * GS, G0[1] + EG * GS], { role: 'soft', w: 0.5, dash: [1, 3], exact: true, alpha: 0.7 })
                pen.line([G0[0], G0[1] + i * GS], [G0[0] + EG * GS, G0[1] + i * GS], { role: 'soft', w: 0.5, dash: [1, 3], exact: true, alpha: 0.7 })
            }
            for (const sh of roomWith(s.ball).shapes) pen.flat(sh, { id: sh.name, role: sh.emit ? 'light' : 'solid' })
            for (const rec of shown) for (const seg of rec) pen.ray(seg.a, seg.b, { role: seg.lamp ? 'light' : 'cam', w: 0.6, alpha: 0.45, arrow: false })
            const listed = s.samples >= EMIT_EPOCH
            for (const c of cells.values()) {
                // the tight box round the cell's hits, a few pixels out so a box of one hit (no size) still shows: pen.rect
                // takes world units (it was once handed pixels, which put every box off the canvas, and a reader found none)
                const m = pen.world(3)
                pen.rect(c.lo[0] - m, c.lo[1] - m, c.hi[0] - c.lo[0] + 2 * m, c.hi[1] - c.lo[1] + 2 * m, { role: 'accent', lineW: 1.4 })
                if (!listed) continue
                const b = boxCircle(c)
                // a cell of one hit has a box of no size and a circle of only the margin, as the publish kernel's: drawn
                // solid when that small, since a dashed circle a few pixels round shows nothing
                pen.circle(b.c, b.r, { role: 'accent', w: 0.8, dash: b.r * pen.view.s > 8 ? [4, 4] : [], exact: true })
            }
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
            pen.handle('ball', [s.ball[0], s.ball[1] + 0.55], { role: 'light' })
        },
        readout(s) {
            const { cells } = discover(s.seed, s.samples, s.ball), by = { ball: [0, 0], bar: [0, 0] }
            for (const [k, c] of cells) { const t = by[G0[0] + (k % EG + 0.5) * GS > 5.2 ? 'bar' : 'ball']; t[0] += c.n; t[1]++ }
            const say = (name, [n, k]) => n ? `${name}: ${n} hits in ${k} cell${k === 1 ? '' : 's'}` : `${name}: not found yet`
            const list = s.samples >= EMIT_EPOCH ? `${cells.size} cells listed as targets` : `none listed yet (the list is made every ${EMIT_EPOCH} samples)`
            return `${s.samples} sample${s.samples === 1 ? '' : 's'} of ${CAM.pixels} paths · ${say('the ball', by.ball)} · ${say('the bar behind the wall', by.bar)} · ${list}`
        },
    },

    crofton: {
        aspect: 1.6,
        world: { x: [-2.4, 5.6], y: [-2.3, 2.7] },
        state: { seed: 1, n: 40 },
        controls: [
            { type: 'seg', key: 'n', label: 'lines', options: [[40, '40 lines'], [2000, '2,000'], [40000, '40,000']] },
            { type: 'button', label: 'New lines', act: s => { s.seed++ } },
        ],
        steps: { few: { n: 40, seed: 1 }, many: { n: 40000, seed: 1 } },
        draw(pen, s) {
            const c = crofton(s.seed, s.n)
            pen.circle([0, 0], RC, { role: 'soft', w: 1, dash: [5, 5], id: 'bound' })
            for (const L of c.lines.slice(0, s.n < 100 ? 40 : 60)) {
                const T = RC * 1.02
                pen.line([L.ox - L.dx * T, L.oy - L.dy * T], [L.ox + L.dx * T, L.oy + L.dy * T], { role: 'faint', w: 0.6, exact: true })
                for (const x of L.out) pen.dot([x.x, x.y], { role: 'light', r: 2.6 })
            }
            for (const sh of CROFTON_SHAPES) {
                if (sh.seg) pen.line(...sh.seg, { role: 'solid', w: 1.8, id: sh.name })
                else pen.field(sh.d, { step: 0, zero: 'solid', inside: 'fill' })
            }
            // the angles of every crossing, against the cosine a glowing surface sends its light out with
            const { W, H } = pen.view, rect = { x: W * 0.64, y: H * 0.14, w: W * 0.32, h: H * 0.6 }, BINS = 12
            const hist = new Array(BINS).fill(0)
            for (const cs of c.cosines) hist[Math.min(BINS - 1, Math.floor(Math.acos(Math.min(1, cs)) / (Math.PI / 2) * BINS))]++
            const tot = Math.max(1, c.cosines.length), w = Math.PI / 2 / BINS
            pen.labelPx(rect.x - 30, rect.y - 20, 'crossings, by angle from the normal', { role: 'soft', size: 12 })
            plot(pen, rect, {
                x: [0, 90], y: [0, 0.2], xticks: [0, 30, 60, 90], yticks: [0, 0.1, 0.2], fmt: v => v >= 1 ? `${v}°` : v.toFixed(1),
                hoverX: v => `${(v - 45 / BINS).toFixed(1)}° to ${(v + 45 / BINS).toFixed(1)}°`, hoverY: v => `${(100 * v).toFixed(1)}%`,
                series: [
                    { name: 'crossings', pts: hist.map((h, i) => [(i + 0.5) * 90 / BINS, h / tot]), role: 'light', kind: 'bars' },
                    // a Lambertian surface: the share in a bin is the integral of cos over it (out of 1 over 0 to pi/2)
                    { name: 'cosine', pts: Array.from({ length: BINS }, (_, i) => [(i + 0.5) * 90 / BINS, Math.sin((i + 1) * w) - Math.sin(i * w)]), role: 'accent', kind: 'dots', r: 3 },
                ],
            })
        },
        readout(s) {
            const c = crofton(s.seed, s.n)
            return CROFTON_SHAPES.map((sh, k) => `${sh.name}: ${c.count[k]} crossings, length ${sh.len.toFixed(2)} predicts ${(s.n * sh.len / (Math.PI * RC)).toFixed(1)}`).join(' · ')
        },
    },

    code: {
        aspect: 1.9,
        world: { x: [0, 10], y: [0, 5.2] },
        state: { lg: 2 },
        controls: [{ type: 'slider', key: 'lg', label: 'a brightness, 10 to the', min: -12, max: 12, step: 0.1, fmt: v => v.toFixed(1) }],
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.12, y: H * 0.1, w: W * 0.84, h: H * 0.68 }
            const xs = Array.from({ length: 241 }, (_, i) => -12 + 24 * i / 240)
            pen.labelPx(rect.x - 40, rect.y - 20, 'the code kept, as a share of the largest it can be', { role: 'soft', size: 13 })
            const { X, Y } = plot(pen, rect, {
                x: [-12, 12], y: [0, 1.05], xticks: [], yticks: [0, 0.5, 1], fmt: v => String(v),
                hoverX: v => `${(10 ** v).toPrecision(2)} cd/m²`, hoverY: v => v.toFixed(4),
                series: [
                    { name: 'old', pts: xs.map(x => [x, oldCode(10 ** x) / oldCode(1e6)]), role: 'blocked', w: 1.6 },
                    { name: 'log', pts: xs.map(x => [x, lumEncode(10 ** x) / lumEncode(1e30)]), role: 'cam', w: 1.6 },
                ],
            })
            for (const k of [-12, -8, -4, 0, 4, 8, 12]) pen.labelPx(X(k) - 14, rect.y + rect.h + 4, `1e${k}`, { role: 'soft', size: 11, kind: 'mono' })
            pen.labelPx(rect.x + rect.w / 2 - 80, rect.y + rect.h + 20, 'brightness, cd/m² (each step ×10,000)', { role: 'soft', size: 12 })
            const { ctx } = pen
            // each mark's name written up along its own line, from the bottom, so no name crosses another mark's line
            // (written across, they ran into each other and into the old code's climb, and a reader took the sun's name
            // for the panel's). The two at the right sit left of their lines, clear of that climb just right of 1e4.
            MARKS.forEach(([v, name], i) => {
                const x = X(Math.log10(v))
                ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke(); ctx.restore()
                const left = i >= 2
                pen.labelPx(left ? x - 2 : x + 2, Y(0.03), name, { role: 'accent', size: 11, angle: -Math.PI / 2, base: left ? 'bottom' : 'top' })
            })
            // in two lines, so it ends before the sun's line
            pen.labelPx(X(5.3), Y(0.97), 'old: flat', { role: 'blocked', size: 11 })
            pen.labelPx(X(5.3), Y(0.97) + 13, 'above 1e5', { role: 'blocked', size: 11 })
            pen.labelPx(X(-11.5), Y(0.42), 'log code: a step every 0.000005 of a stop', { role: 'cam', size: 12 })
            // the brightness chosen: a line, and where each code puts it
            const v = 10 ** s.lg, x = X(s.lg)
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke(); ctx.restore()
            for (const [y, role] of [[oldCode(v) / oldCode(1e6), 'blocked'], [lumEncode(v) / lumEncode(1e30), 'cam']]) {
                ctx.save(); ctx.fillStyle = pen.col(role); ctx.beginPath(); ctx.arc(x, Y(y), 4.5, 0, 6.2832); ctx.fill(); ctx.restore()
            }
        },
        readout(s) {
            const v = 10 ** s.lg, o = oldCode(v), q = lumEncode(v)
            return `a brightness of ${v.toPrecision(3)} cd/m² · the old code keeps ${o.toLocaleString('en')}, which reads back as ${(o / 16).toPrecision(3)}${v > 1e5 ? ' (everything above 100,000 reads the same)' : v < 1 / 16 ? ' (0: the same as never seen)' : ''} · the log code keeps ${q.toLocaleString('en')}, which reads back as ${lumDecode(q).toPrecision(4)}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
