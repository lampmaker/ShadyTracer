//======================================================================================================================
// CHAPTER "Dice and averages": its figures.
//
//   darts    pi from random darts in a square: the share inside a quarter circle, the running estimate and its error
//            bar, kept by core/measure.js's stepMoments and standardError -- the renderer's own per-pixel arithmetic
//   spread   many estimates of the same number from N darts each, for N = 4, 16, 64, 256: how far they scatter, and
//            the 1/sqrt(N) that says how fast they close in
//   grid     the renderer's old random numbers against its new: the share of the draws that land in small windows of
//            [0, 1), worked out exactly for a perfectly uniform 32-bit state, for the old output fract(f32(state) /
//            671040) and for PCG4D's (its top 24 bits)
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng } from '../kit/flatland.js'
import { plot } from '../kit/plot.js'
import { stepMoments, standardError } from '../../lib/pathtracer/core/measure.js'

/* DARTS: each dart scores 4 if it lands inside the quarter circle of radius 1, else 0, so the average score is pi */
const dartsCache = new Map()
export function darts(seed, n) {
    const key = `${seed}|${n}`
    if (dartsCache.has(key)) return dartsCache.get(key)
    const R = rng(seed * 2654435761 + 17), pts = [], track = []
    let st = { Y: 0, V: 0, S: 0, cnt: 0 }
    for (let i = 1; i <= n; i++) {
        const x = R(), y = R(), hit = x * x + y * y < 1
        if (i <= 3000) pts.push([x, y, hit])
        st = stepMoments(st, hit ? 4 : 0)
        // the running estimate and its error bar at about 60 points spaced evenly in log N
        if (i === n || Math.floor(Math.log2(i) * 6) !== Math.floor(Math.log2(i + 1) * 6)) track.push([i, st.Y, standardError(st.V, st.S) ?? 0])
    }
    const r = { pts, track, mean: st.Y, se: standardError(st.V, st.S) ?? 0, n }
    if (dartsCache.size > 40) dartsCache.clear()
    dartsCache.set(key, r)
    return r
}
/** one dart's spread: the score is 4 with probability pi/4, so its standard deviation is 4 sqrt(p (1 - p)) */
export const DART_SD = 4 * Math.sqrt(Math.PI / 4 * (1 - Math.PI / 4))

/* SPREAD: for each N, ESTIMATES estimates, each the average of N darts */
const NS = [4, 16, 64, 256], ESTIMATES = 240
const spreadCache = new Map()
export function spread(seed) {
    if (spreadCache.has(seed)) return spreadCache.get(seed)
    const R = rng(seed * 40503 + 99)
    const out = NS.map(N => {
        const est = []
        for (let e = 0; e < ESTIMATES; e++) { let k = 0; for (let i = 0; i < N; i++) { const x = R(), y = R(); if (x * x + y * y < 1) k++ } est.push(4 * k / N) }
        const m = est.reduce((a, b) => a + b, 0) / est.length, sd = Math.sqrt(est.reduce((a, b) => a + (b - m) ** 2, 0) / (est.length - 1))
        return { N, est, sd }
    })
    spreadCache.set(seed, out)
    return out
}

/* THE OLD OUTPUT'S EXACT DISTRIBUTION. f32(state) for a 32-bit state keeps its top 24 bits: a state in [2^e, 2^(e+1))
   becomes the nearest multiple of 2^(e-23) (states below 2^24 exactly), and about 2^(e-23) states round to each. So the
   share of all 2^32 states whose output fract(v / 671040) lands in [a, b) is a count of those multiples, range by
   range, in each interval 671040 (q + a) <= v < 671040 (q + b). (Ties and the ranges' edges move it by a few states in
   four billion.) */
const DIV = 671040, TWO32 = 2 ** 32
export function oldShare(a, b) {
    let n = 0
    const ranges = [[0, 2 ** 24, 1]]
    for (let e = 24; e < 32; e++) ranges.push([2 ** e, 2 ** (e + 1), 2 ** (e - 23)])
    for (let q = 0; DIV * (q + a) < TWO32; q++) {
        const lo = DIV * (q + a), hi = DIV * (q + b)
        for (const [r0, r1, sp] of ranges) {
            const x = Math.max(lo, r0), y = Math.min(hi, r1)
            if (y > x) n += (Math.ceil(y / sp) - Math.ceil(x / sp)) * sp
        }
    }
    return n / TWO32
}
/** PCG4D's output: the top 24 bits of a lane, (state >> 8) / 2^24 -- a grid of 2^-24, each point 256 states */
export const newShare = (a, b) => (Math.ceil(b * 2 ** 24) - Math.ceil(a * 2 ** 24)) / 2 ** 24
const gridCache = new Map()
export function windows(at, width, count = 24) {
    const key = `${at}|${width}`
    if (gridCache.has(key)) return gridCache.get(key)
    const rows = Array.from({ length: count }, (_, i) => {
        const a = at + i * width, b = a + width
        return { a, old: oldShare(a, b) / width, now: newShare(a, b) / width }
    })
    gridCache.set(key, rows)
    return rows
}

export const figures = {
    darts: {
        aspect: 1.8,
        world: { x: [-0.15, 3.45], y: [-0.25, 1.75] },
        state: { n: 20, seed: 4 },
        controls: [
            { type: 'button', label: 'Throw 4 times as many', act: s => { s.n = Math.min(s.n * 4, 327680) } },
            { type: 'button', label: 'Start again', act: s => { s.n = 20; s.seed++ } },
        ],
        steps: { few: { n: 20, seed: 4 }, more: { n: 1280, seed: 4 }, lots: { n: 81920, seed: 4 } },
        draw(pen, s) {
            const d = darts(s.seed, s.n), S = 1.4, O = [0, 0.1]
            const P = (x, y) => [O[0] + x * S, O[1] + y * S]
            pen.poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1), P(0, 0)], { role: 'ink', w: 1, exact: true })
            const arc = []
            for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI / 2; arc.push(P(Math.cos(t), Math.sin(t))) }
            pen.poly(arc, { role: 'solid', w: 1.3, id: 'quarter' })
            for (const [x, y, hit] of d.pts) pen.dot(P(x, y), { role: hit ? 'cam' : 'faint', r: d.pts.length > 400 ? 1.1 : 2.2 })
            if (s.n > d.pts.length) pen.label(P(0.5, -0.1), `the first ${d.pts.length} of ${s.n} darts`, { role: 'soft', size: 13, align: 'center' })
            // the running estimate against the number of darts (log scale), with its error bar either side
            const { W, H } = pen.view, rect = { x: W * 0.52, y: H * 0.1, w: W * 0.44, h: H * 0.7 }
            const lg = Math.log2, top = Math.max(lg(d.n), 4)
            pen.labelPx(rect.x - 30, rect.y - 20, 'the estimate, ± its error bar', { role: 'soft', size: 13 })
            plot(pen, rect, {
                x: [0, top], y: [2.2, 4.2], yticks: [2.5, 3, Math.PI, 3.5, 4], xticks: [],
                fmt: v => Math.abs(v - Math.PI) < 1e-9 ? 'π' : v.toFixed(1),
                series: [
                    { pts: d.track.map(([i, m, e]) => [lg(i), m + e]), role: 'faint', w: 1 },
                    { pts: d.track.map(([i, m, e]) => [lg(i), m - e]), role: 'faint', w: 1 },
                    { pts: d.track.map(([i, m]) => [lg(i), m]), role: 'cam', w: 1.5 },
                    { pts: [[0, Math.PI], [top, Math.PI]], role: 'accent', w: 1 },
                ],
            })
            for (let k = 0; k <= top; k += Math.max(2, Math.ceil(top / 6 / 2) * 2)) pen.labelPx(rect.x + k / top * rect.w - 10, rect.y + rect.h + 4, String(2 ** k), { role: 'soft', size: 11, kind: 'mono' })
            pen.labelPx(rect.x + rect.w / 2 - 50, rect.y + rect.h + 20, 'darts thrown', { role: 'soft', size: 12 })
        },
        readout(s) {
            const d = darts(s.seed, s.n), k = Math.round(d.mean * d.n / 4)
            return `${d.n} darts, ${k} inside: π ≈ 4 × ${k} / ${d.n} = ${d.mean.toFixed(4)} ± ${d.se.toFixed(4)} · really ${Math.PI.toFixed(4)}, ${(Math.abs(d.mean - Math.PI) / d.se).toFixed(1)} error bars away`
        },
    },

    spread: {
        aspect: 1.9,
        world: { x: [0, 10], y: [0, 5.2] },
        state: { seed: 1 },
        controls: [{ type: 'button', label: 'New darts', act: s => { s.seed++ } }],
        draw(pen, s) {
            const sp = spread(s.seed), { W, H } = pen.view, rect = { x: W * 0.1, y: H * 0.08, w: W * 0.86, h: H * 0.78 }
            const { X, Y } = plot(pen, rect, {
                // from 0.8: four darts give 1.0 about one time in thirty, and those dots belong in the picture
                x: [0, 4], y: [0.8, 4.4], xticks: [], yticks: [1, 2, 3, Math.PI, 4],
                fmt: v => Math.abs(v - Math.PI) < 1e-9 ? 'π' : v.toFixed(1),
                series: [{ pts: [[0, Math.PI], [4, Math.PI]], role: 'accent', w: 1 }],
            })
            const R = rng(7), { ctx } = pen
            sp.forEach(({ N, est, sd }, c) => {
                const cx = X(c + 0.5)
                ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip()
                ctx.fillStyle = pen.col('cam'); ctx.globalAlpha = 0.55
                for (const e of est) { ctx.beginPath(); ctx.arc(cx + (R() - 0.5) * rect.w / 4 * 0.55, Y(e), 1.8, 0, 6.2832); ctx.fill() }
                ctx.restore()
                // one standard deviation either side of pi, measured from these estimates, and the 1/sqrt(N) prediction
                const bx = cx + rect.w / 4 * 0.36
                ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 2
                ctx.beginPath(); ctx.moveTo(bx, Y(Math.PI - sd)); ctx.lineTo(bx, Y(Math.PI + sd)); ctx.stroke()
                ctx.strokeStyle = pen.col('accent'); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5
                const pr = DART_SD / Math.sqrt(N)
                ctx.beginPath(); ctx.moveTo(bx + 6, Y(Math.PI - pr)); ctx.lineTo(bx + 6, Y(Math.PI + pr)); ctx.stroke(); ctx.restore()
                pen.labelPx(cx - 30, rect.y + rect.h + 6, `N = ${N}`, { role: 'ink', size: 13, kind: 'mono' })
                pen.labelPx(cx - 40, rect.y + rect.h + 22, `spread ${sd.toFixed(3)}`, { role: 'soft', size: 12, kind: 'mono' })
            })
        },
        readout(s) {
            const sp = spread(s.seed)
            return sp.map(({ N, sd }) => `N ${N}: ${sd.toFixed(3)} (1.642/√N = ${(DART_SD / Math.sqrt(N)).toFixed(3)})`).join(' · ')
        },
    },

    grid: {
        aspect: 1.9,
        world: { x: [0, 10], y: [0, 5.2] },
        state: { width: 1e-4, at: 0.3 },
        controls: [
            { type: 'seg', key: 'width', label: 'window', options: [[1e-3, 'Windows of 0.001'], [1e-4, '0.0001'], [1e-5, '0.00001']] },
            { type: 'slider', key: 'at', label: 'where', min: 0, max: 0.97, step: 0.01, fmt: v => v.toFixed(2) },
        ],
        steps: { wide: { width: 1e-3, at: 0.3 }, narrow: { width: 1e-4, at: 0.3 }, tiny: { width: 1e-5, at: 0.3 } },
        draw(pen, s) {
            const rows = windows(s.at, s.width), { W, H } = pen.view, rect = { x: W * 0.1, y: H * 0.1, w: W * 0.86, h: H * 0.72 }
            const top = Math.max(2, ...rows.map(r => r.old)) * 1.1
            pen.labelPx(rect.x - 34, rect.y - 22, 'share of the draws in each window, × what it should be', { role: 'soft', size: 13 })
            const { X, Y } = plot(pen, rect, {
                x: [0, rows.length], y: [0, top], xticks: [], fmt: v => v.toFixed(1),
                series: [{ pts: [[0, 1], [rows.length, 1]], role: 'accent', w: 1 }],
            })
            const { ctx } = pen, bw = rect.w / rows.length
            rows.forEach((r, i) => {
                ctx.save()
                ctx.fillStyle = pen.col('blocked'); ctx.globalAlpha = 0.7; ctx.fillRect(X(i) + bw * 0.12, Y(r.old), bw * 0.36, Y(0) - Y(r.old))
                ctx.fillStyle = pen.col('cam'); ctx.fillRect(X(i) + bw * 0.52, Y(r.now), bw * 0.36, Y(0) - Y(r.now))
                ctx.restore()
            })
            pen.labelPx(rect.x, rect.y + rect.h + 6, `${s.at.toFixed(2)}`, { role: 'soft', size: 11, kind: 'mono' })
            pen.labelPx(rect.x + rect.w - 60, rect.y + rect.h + 6, `${(s.at + rows.length * s.width).toPrecision(5)}`, { role: 'soft', size: 11, kind: 'mono' })
            pen.labelPx(rect.x + rect.w / 2 - 110, rect.y + rect.h + 22, 'the old output (left bars), PCG4D (right)', { role: 'soft', size: 12 })
        },
        readout(s) {
            const rows = windows(s.at, s.width), o = rows.map(r => r.old), n = rows.map(r => r.now)
            return `windows of ${s.width} from ${s.at.toFixed(2)} · the old output: ${Math.min(...o).toFixed(2)}× to ${Math.max(...o).toFixed(2)}× its share · PCG4D: ${Math.min(...n).toFixed(3)}× to ${Math.max(...n).toFixed(3)}×`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
