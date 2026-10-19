//======================================================================================================================
// CHAPTER "The optics bench": its figures.
//
//   beam    a cos^n source's rays binned by direction as the optics kernels bin them (farfield.js farBin), its
//           intensity and beam angle as farfield.js reads them, on a polar diagram against the closed form
//   map     the same kind of source 1 m above a floor: the hits mapped by detmap.js detectorMap, plain or smoothed,
//           and a profile through the spot against E = I0 cos^(n+3) / h^2
//   tally   a ray's weight added again and again: a 32-bit float sum against the kernels' integer pair
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import * as O from '../kit/optics.js'

const cache = new Map()
const memo = (key, f) => { if (!cache.has(key)) { if (cache.size > 24) cache.clear(); cache.set(key, f()) } return cache.get(key) }
/** the far field, its intensity grid and its statistics, for a setting */
export function beamOf(s) {
    return memo(`b|${s.n}|${s.lv}|${s.sym}|${s.seed}`, () => {
        const far = O.farOf(s.n, Math.round(10 ** s.lv), { seed: s.seed }), R = O.intensity(far, { symmetry: s.sym }), st = O.farStats(far, R, [0])
        return { far, R, st, curve: O.planeCurve(R, 0) }
    })
}
export function mapOf(s) { return memo(`m|${s.lv}|${s.smooth}|${s.seed}`, () => O.floorMap(5, Math.round(10 ** s.lv), { smooth: s.smooth, seed: s.seed })) }
const kfmt = v => v >= 1e6 ? `${+(v / 1e6).toPrecision(3)} million` : v >= 1e3 ? `${+(v / 1e3).toPrecision(3)} thousand` : String(Math.round(v))

export const figures = {
    beam: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { n: 1, lv: Math.log10(2e5), sym: 'none', seed: 1 },
        controls: [
            { type: 'seg', key: 'n', label: 'the source', options: [[1, 'cos (Lambertian)'], [5, 'cos⁵'], [20, 'cos²⁰']] },
            { type: 'slider', key: 'lv', label: 'rays', min: 3.5, max: 6.3, step: 0.05, fmt: v => kfmt(10 ** v) },
            { type: 'seg', key: 'sym', label: 'bins', options: [['none', 'each its own'], ['rotational', 'pooled round the axis']] },
            { type: 'button', label: 'Other rays', act: s => { s.seed++ } },
        ],
        steps: {
            lambert: { n: 1, lv: Math.log10(2e5), sym: 'none', seed: 1 }, few: { n: 5, lv: Math.log10(2e4), sym: 'none', seed: 1 },
            many: { n: 5, lv: Math.log10(2e6), sym: 'none', seed: 1 }, pooled: { n: 5, lv: Math.log10(2e5), sym: 'rotational', seed: 1 },
        },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen, b = beamOf(s), I0 = O.I0(s.n), top = Math.max(I0, b.st.max.I) * 1.1
            const cx = W * 0.32, cy = H * 0.9, Rpx = H * 0.8
            const P = (a, I) => [cx + Math.sin(a * Math.PI / 180) * I / top * Rpx, cy - Math.cos(a * Math.PI / 180) * I / top * Rpx]
            // the polar grid: rings at quarters of the top, spokes every 30 degrees
            ctx.save(); ctx.strokeStyle = pen.col('faint'); ctx.lineWidth = 1
            for (const f of [0.25, 0.5, 0.75, 1]) { ctx.beginPath(); ctx.arc(cx, cy, Rpx * f, Math.PI, 2 * Math.PI); ctx.stroke() }
            for (let a = -90; a <= 90; a += 30) { const [x, y] = P(a, top); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke() }
            ctx.restore()
            for (const a of [-60, -30, 0, 30, 60]) { const [x, y] = P(a, top * 1.04); pen.labelPx(x, y, `${a}°`, { role: 'soft', size: 10, align: 'center', base: 'bottom' }) }
            // the closed form, and the grid's plane C0-C180
            const line = (pts, role, w, dash) => { ctx.save(); ctx.strokeStyle = pen.col(role); ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.restore() }
            const exact = []; for (let a = -90; a <= 90; a += 1) exact.push(P(a, I0 * Math.cos(a * Math.PI / 180) ** s.n))
            line(exact, 'ink', 1.2, [5, 3])
            line(b.curve.points.filter(q => Math.abs(q.a) <= 90).map(q => P(q.a, q.I)), 'cam', 2, [])
            // the half-peak level, where the beam angle is read
            const w = b.st.planes[0].beam
            if (w && w.minus != null && w.plus != null) for (const a of [w.minus, w.plus]) { const [x, y] = P(a, b.st.max.I / 2); ctx.save(); ctx.fillStyle = pen.col('accent'); ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); ctx.restore() }
            const kx = W * 0.64
            pen.labelPx(kx, H * 0.12, `I max ${b.st.max.I.toFixed(0)} cd (the true peak ${I0.toFixed(0)})`, { role: 'cam', size: 12, base: 'top' })
            pen.labelPx(kx, H * 0.12 + 20, `beam angle ${w?.width != null ? w.width.toFixed(1) + '°' : 'none'} (true ${O.beamAngle(s.n).toFixed(2)}°)`, { role: 'accent', size: 12, base: 'top' })
            pen.labelPx(kx, H * 0.12 + 44, 'blue: the grid\'s C0-C180 plane', { role: 'soft', size: 11, base: 'top' })
            pen.labelPx(kx, H * 0.12 + 60, 'dashed: the true curve', { role: 'soft', size: 11, base: 'top' })
            pen.labelPx(kx, H * 0.12 + 76, 'red dots: half the grid\'s I max', { role: 'soft', size: 11, base: 'top' })
        },
        readout(s) {
            const b = beamOf(s), I0 = O.I0(s.n), w = b.st.planes[0].beam
            return `${kfmt(10 ** s.lv)} rays of 1000 lm, 5° bins${s.sym === 'rotational' ? ' pooled round the axis' : ''} · I max ${b.st.max.I.toFixed(0)} cd, ${((b.st.max.I / I0 - 1) * 100).toFixed(1)}% over the true ${I0.toFixed(0)} · beam angle ${w?.width != null ? w.width.toFixed(2) : '–'}° against ${O.beamAngle(s.n).toFixed(2)}°`
        },
    },

    map: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { lv: Math.log10(5e4), smooth: 'none', seed: 1 },
        controls: [
            { type: 'slider', key: 'lv', label: 'rays', min: 3, max: 5, step: 0.05, fmt: v => kfmt(10 ** v) },
            { type: 'seg', key: 'smooth', label: 'smoothing', options: [['none', 'none'], ['gauss', 'Gaussian'], ['knn', 'nearest 32 hits']] },
            { type: 'button', label: 'Other rays', act: s => { s.seed++ } },
        ],
        steps: { plain: { lv: Math.log10(5e4), smooth: 'none', seed: 1 }, few: { lv: Math.log10(5e3), smooth: 'none', seed: 1 }, gauss: { lv: Math.log10(5e3), smooth: 'gauss', seed: 1 }, knn: { lv: Math.log10(5e3), smooth: 'knn', seed: 1 } },
        draw(pen, s) {
            const { W, H } = pen.view, m = mapOf(s), E0 = O.floorE(5, 0), side = H * 0.78, x0 = W * 0.04, y0 = H * 0.12
            pen.labelPx(x0, y0 - 6, 'the floor, 2 m square, as the map reads it', { role: 'soft', size: 11, base: 'bottom' })
            pen.image(x0, y0, side, side, m.nx, m.ny, (i, j) => { const v = m.E[(m.ny - 1 - j) * m.nx + i] / (E0 * 1.2); return [v, v, v] })
            // the profile through the middle row, against the closed form
            const box = { x: W * 0.55, y: H * 0.12, w: W * 0.41, h: H * 0.66 }, row = Math.floor(m.ny / 2), pts = [], ex = []
            for (let i = 0; i < m.nx; i++) { const x = m.range.a[0] + (i + 0.5) * m.cell; pts.push([x, m.E[row * m.nx + i]]) }
            for (let x = -1; x <= 1.0001; x += 0.02) ex.push([x, O.floorE(5, Math.abs(x))])
            pen.labelPx(box.x - 30, box.y - 22, 'through the middle: lux, the map against the truth', { role: 'soft', size: 11 })
            plot(pen, box, {
                x: [-1, 1], y: [0, E0 * 1.5], xticks: [-1, -0.5, 0, 0.5, 1], fmt: v => Math.abs(v) < 2 ? `${v} m`.replace(' m', Math.abs(v) <= 1 && Number.isInteger(v * 2) ? ' m' : '') : v.toFixed(0),
                hoverX: v => `${v.toFixed(2)} m from the spot's centre`, hoverY: v => `${v.toFixed(0)} lx`,
                series: [
                    { name: 'the map', pts, role: 'cam', kind: 'dots', r: 2.2 },
                    { name: 'the truth', pts: ex, role: 'ink', w: 1.2, dash: [5, 3] },
                ],
            })
        },
        readout(s) {
            const m = mapOf(s), E0 = O.floorE(5, 0), mid = m.E[Math.floor(m.ny / 2) * m.nx + Math.floor(m.nx / 2)]
            return `${kfmt(10 ** s.lv)} rays, ${m.nx} × ${m.ny} cells of ${(m.cell * 100).toFixed(0)} cm · ${m.hitsPerLitCell.toFixed(0)} hits a lit cell · a cell's noise about ${(100 * m.relNoise).toFixed(0)}% · the middle cell ${mid.toFixed(0)} lx, the truth at the centre ${E0.toFixed(0)} lx${m.bandwidthM ? ` · blurred over ${(m.bandwidthM * 100).toFixed(0)} cm` : ''}`
        },
    },

    tally: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { w: 1, lv: 25 },
        controls: [
            { type: 'seg', key: 'w', label: 'each ray\'s weight', options: [[1, '1'], [0.7, '0.7'], [0.3, '0.3']] },
            { type: 'slider', key: 'lv', label: 'rays added', min: 10, max: 30, step: 0.5, fmt: v => kfmt(2 ** v) },
        ],
        steps: { one: { w: 1, lv: 25 }, seven: { w: 0.7, lv: 23 }, more: { w: 0.7, lv: 26 } },
        draw(pen, s) {
            const { W, H } = pen.view, box = { x: W * 0.1, y: H * 0.12, w: W * 0.86, h: H * 0.66 }, xs = []
            for (let v = 10; v <= 30.0001; v += 0.25) xs.push(v)
            const f32 = memo(`t|${s.w}`, () => xs.map(v => [v, O.f32Sum(s.w, Math.round(2 ** v)) / (s.w * Math.round(2 ** v))]))
            const ints = xs.map(v => [v, O.intSum(s.w, Math.round(2 ** v)).read / (s.w * Math.round(2 ** v))])
            pen.labelPx(box.x - 30, box.y - 22, 'the sum read back, over what it should be (1: exact)', { role: 'soft', size: 11 })
            plot(pen, box, {
                x: [10, 30], y: [0, 1.6], xticks: [10, 15, 20, 24, 30], yticks: [0, 0.5, 1, 1.5],
                fmt: v => v >= 10 && Number.isInteger(v) && v <= 30 && v !== 1 && v !== 0 && v > 5 ? `2^${v}` : String(v),
                hoverX: v => `${kfmt(2 ** v)} rays`, hoverY: v => v.toFixed(5),
                series: [
                    { name: 'a 32-bit float', pts: f32, role: 'blocked', w: 2 },
                    { name: 'the integer pair', pts: ints, role: 'cam', w: 2 },
                    { pts: [[s.lv, 0], [s.lv, 1.6]], role: 'soft', w: 1, dash: [3, 3], tip: false },
                ],
            })
        },
        readout(s) {
            const n = Math.round(2 ** s.lv), f = O.f32Sum(s.w, n), i = O.intSum(s.w, n), t = O.twoOrders()
            return `${kfmt(n)} rays of weight ${s.w}, ${(s.w * n).toLocaleString('en-US', { maximumFractionDigits: 1 })} in all · the float sum ${f.toLocaleString('en-US', { maximumFractionDigits: 1 })} (${((f / (s.w * n) - 1) * 100).toFixed(2)}%) · the integer pair ${i.read.toLocaleString('en-US', { maximumFractionDigits: 1 })}, ${i.hi} carr${i.hi === 1 ? 'y' : 'ies'} into its high word · 100,000 random weights added forwards and backwards: float ${t.forward.toFixed(2)} and ${t.backward.toFixed(2)}, integer ${t.intForward.toFixed(4)} both`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
