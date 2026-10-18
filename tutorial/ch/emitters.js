//======================================================================================================================
// CHAPTER "Every glowing thing is a light": its figures.
//
//   discovery  paths through a room with two glowing things in it, one in plain view and one round a corner: every
//              path that hits one records where, in a 16 x 16 grid as materials_pbr.js emitDeposit does in 16^3; each
//              cell with hits becomes a box, the tight bounds of its hits, and a circle round it for aiming at
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

/* THE ROOM: a glowing ball in view, and a glowing bar behind a wall the camera cannot see past */
export const ROOM = {
    sky: 0,
    shapes: [
        { kind: 'box', c: [3.4, -0.3], h: [4.1, 0.3], albedo: 0.7, name: 'floor' },
        { kind: 'box', c: [3.4, 4.4], h: [4.1, 0.3], albedo: 0.7, name: 'ceiling' },
        { kind: 'box', c: [-0.4, 2.05], h: [0.3, 2.65], albedo: 0.7, name: 'left' },
        { kind: 'box', c: [7.2, 2.05], h: [0.3, 2.65], albedo: 0.7, name: 'right' },
        { kind: 'box', c: [5.2, 1.6], h: [0.12, 1.6], albedo: 0.7, name: 'wall' },
        { kind: 'circle', c: [2.6, 2.6], r: 0.35, albedo: 0, emit: 2, name: 'ball' },
        { kind: 'segment', a: [6.2, 0.4], b: [6.2, 2.4], r: 0.02, emit: 2, name: 'bar' },
    ],
}
const CAM = { eye: [0.3, 1.6], dir: Math.atan2(1.8 - 1.6, 4.9 - 0.3), fov: 80 * Math.PI / 180, pixels: 48 }
// the grid over the room's square: EG cells each way, as the engine's 16 (over +-emitHalf, in 3D)
export const EG = 16
const G0 = [-0.7, -0.6], GS = 8.2 / EG
const cellOf = (x, y) => { const i = Math.floor((x - G0[0]) / GS), j = Math.floor((y - G0[1]) / GS); return i >= 0 && j >= 0 && i < EG && j < EG ? i + EG * j : -1 }

/** paths a sample per pixel, every hit of a glowing thing deposited: { cells: Map(cell -> { lo, hi, n }), hits } */
export function discover(seed, samples) {
    const R = rng(seed * 7919 + 5), cells = new Map(), shown = []
    for (let s = 0; s < samples; s++) for (let i = 0; i < CAM.pixels; i++) {
        const [ox, oy, dx, dy] = cameraRay(CAM, i, R()), rec = []
        tracePath(ROOM, ox, oy, dx, dy, { maxBounce: 6, rand: R, record: rec })
        const last = rec[rec.length - 1]
        if (!last?.lamp) continue
        const [x, y] = last.b, k = cellOf(x, y)
        if (k < 0) continue
        const c = cells.get(k) ?? { lo: [x, y], hi: [x, y], n: 0 }
        c.lo = [Math.min(c.lo[0], x), Math.min(c.lo[1], y)]; c.hi = [Math.max(c.hi[0], x), Math.max(c.hi[1], y)]; c.n++
        cells.set(k, c)
        if (shown.length < 60) shown.push(rec)
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
    { name: 'circle', len: 2 * Math.PI * 0.45, d: (x, y) => circle(x + 0.8, y - 0.6, 0.45) },
    { name: 'box', len: 2 * (1.2 + 0.5), d: (x, y) => box(x - 0.6, y + 0.7, 0.6, 0.25) },
    { name: 'bar', len: 1.0, seg: [[0.9, 0.2], [0.9, 1.2]] },
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
const MARKS = [[0.01, 'a dark night, about'], [100, 'a lit page, about'], [2e4, 'a bright panel'], [1.6e9, 'the sun in a mirror']]

export const figures = {
    discovery: {
        aspect: 1.55,
        world: { x: [-0.9, 7.7], y: [-0.75, 4.95] },
        state: { seed: 2, samples: 1 },
        controls: [{ type: 'seg', key: 'samples', label: 'samples', options: [[1, '1 sample'], [8, '8'], [64, '64']] }],
        steps: { one: { samples: 1 }, eight: { samples: 8 }, many: { samples: 64 } },
        draw(pen, s) {
            const { cells, shown } = discover(s.seed, s.samples)
            for (const sh of ROOM.shapes) pen.flat(sh, { id: sh.name, role: sh.emit ? 'light' : 'solid' })
            for (const rec of shown.slice(0, 24)) for (const seg of rec) pen.ray(seg.a, seg.b, { role: seg.lamp ? 'light' : 'cam', w: 0.6, alpha: 0.45, arrow: false })
            for (const c of cells.values()) {
                pen.rect(pen.X(c.lo[0]) - 2, pen.Y(c.hi[1]) - 2, pen.X(c.hi[0]) - pen.X(c.lo[0]) + 4, pen.Y(c.lo[1]) - pen.Y(c.hi[1]) + 4, { role: 'accent', lineW: 1.4 })
                const b = boxCircle(c)
                pen.circle(b.c, b.r, { role: 'accent', w: 0.8, dash: [4, 4], exact: true })
            }
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
        },
        readout(s) {
            const { cells } = discover(s.seed, s.samples), by = { ball: [0, 0], bar: [0, 0] }
            for (const [k, c] of cells) { const t = by[G0[0] + (k % EG + 0.5) * GS > 5.2 ? 'bar' : 'ball']; t[0] += c.n; t[1]++ }
            const say = (name, [n, k]) => n ? `${name}: ${n} hits in ${k} cell${k === 1 ? '' : 's'}` : `${name}: not found yet`
            return `${s.samples} sample${s.samples === 1 ? '' : 's'} of ${CAM.pixels} paths · ${say('the ball', by.ball)} · ${say('the bar behind the wall', by.bar)}`
        },
    },

    crofton: {
        aspect: 1.6,
        world: { x: [-2.4, 5.6], y: [-2.3, 2.7] },
        state: { seed: 1, n: 40 },
        controls: [{ type: 'seg', key: 'n', label: 'lines', options: [[40, '40 lines'], [2000, '2,000'], [40000, '40,000']] }],
        steps: { few: { n: 40 }, many: { n: 40000 } },
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
            pen.labelPx(rect.x - 30, rect.y - 20, 'angle of each crossing from the normal', { role: 'soft', size: 12 })
            plot(pen, rect, {
                x: [0, 90], y: [0, 0.2], xticks: [0, 30, 60, 90], yticks: [0, 0.1, 0.2], fmt: v => v >= 1 ? `${v}°` : v.toFixed(1),
                series: [
                    { pts: hist.map((h, i) => [(i + 0.5) * 90 / BINS, h / tot]), role: 'light', kind: 'bars' },
                    // a Lambertian surface: the share in a bin is the integral of cos over it (out of 1 over 0 to pi/2)
                    { pts: Array.from({ length: BINS }, (_, i) => [(i + 0.5) * 90 / BINS, Math.sin((i + 1) * w) - Math.sin(i * w)]), role: 'accent', kind: 'dots', r: 3 },
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
        state: {},
        draw(pen) {
            const { W, H } = pen.view, rect = { x: W * 0.12, y: H * 0.1, w: W * 0.84, h: H * 0.68 }
            const xs = Array.from({ length: 241 }, (_, i) => -12 + 24 * i / 240)
            pen.labelPx(rect.x - 40, rect.y - 20, 'the code kept, as a share of the largest it can be', { role: 'soft', size: 13 })
            const { X, Y } = plot(pen, rect, {
                x: [-12, 12], y: [0, 1.05], xticks: [], yticks: [0, 0.5, 1], fmt: v => String(v),
                series: [
                    { pts: xs.map(x => [x, oldCode(10 ** x) / oldCode(1e6)]), role: 'blocked', w: 1.6 },
                    { pts: xs.map(x => [x, lumEncode(10 ** x) / lumEncode(1e30)]), role: 'cam', w: 1.6 },
                ],
            })
            for (const k of [-12, -8, -4, 0, 4, 8, 12]) pen.labelPx(X(k) - 14, rect.y + rect.h + 4, `1e${k}`, { role: 'soft', size: 11, kind: 'mono' })
            pen.labelPx(rect.x + rect.w / 2 - 80, rect.y + rect.h + 20, 'brightness, cd/m² (each step ×10,000)', { role: 'soft', size: 12 })
            const { ctx } = pen
            MARKS.forEach(([v, name], i) => {
                const x = X(Math.log10(v))
                ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke(); ctx.restore()
                // names right of the middle are written leftward, so the last one stays on the canvas
                const right = x > rect.x + rect.w * 0.7
                pen.labelPx(right ? x - 3 : x + 3, rect.y + 6 + i * 16, name, { role: 'accent', size: 11, align: right ? 'right' : 'left' })
            })
            pen.labelPx(X(5.6), Y(0.86), 'old: all the same above 1e5', { role: 'blocked', size: 12 })
            pen.labelPx(X(-11.5), Y(0.42), 'log code: a step every 0.000005 of a stop', { role: 'cam', size: 12 })
        },
        readout() {
            return MARKS.map(([v, name]) => `${name} (${v} cd/m²): old ${oldCode(v)}, log ${lumEncode(v)}`).join(' · ')
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
