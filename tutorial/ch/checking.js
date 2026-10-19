//======================================================================================================================
// CHAPTER "Noise, bias and checking": its figures.
//
//   bias      one pixel of a floor in a lamp-lit corner, its paths read four ways (kit/checking.js): the whole path,
//             cut after one bounce, clamped, and averaged over a moving window; each running mean with the error bar
//             the engine's measure.js would report, against the pixel's true value
//   control   the white furnace with one disc, five rows and a control, on a working page and on the page broken the
//             two ways ShadyTracer's was: the readings raytrace_main.js's image statistics would give
//   errorbar  a thousand pixels of one brightness: the spread they really have against the error bars they report, and
//             seRatio over neighbours, the error bar right and with the mistake the engine's comment warns of
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng, tracePath } from '../kit/flatland.js'
import { plot } from '../kit/plot.js'
import * as C from '../kit/checking.js'

/* ONE PIXEL: a run of 4096 paths a seed, cached */
const N = 4096
const runs = new Map()
export function runOf(seed) {
    if (!runs.has(seed)) { if (runs.size > 8) runs.clear(); runs.set(seed, C.readings(N, seed)) }
    return runs.get(seed)
}
export const READING = {
    whole: { label: 'the whole path', role: 'cam' },
    cap: { label: 'cut after 1 bounce', role: 'blocked' },
    clamp: { label: `each sample clamped at ${C.CLAMP}`, role: 'light' },
    window: { label: `a moving window of ${C.WINDOW}`, role: 'glass' },
}
/** where a reading stands after `k` samples: its mean, error bar, and how many error bars it is from the truth */
export function standing(seed, which, k = N) {
    const r = runOf(seed)[which][k - 1]
    return { ...r, off: r.se ? (r.Y - C.TRUTH) / r.se : null }
}

/* the corner drawn small at the figure's left: its coordinates mapped into the figure's world */
const K = 0.1, T = ([x, y]) => [0.05 + (x + 1) * K, 0.1 + (y + 0.6) * K]
const rect = (c, h) => [T([c[0] - h[0], c[1] - h[1]]), T([c[0] + h[0], c[1] - h[1]]), T([c[0] + h[0], c[1] + h[1]]), T([c[0] - h[0], c[1] + h[1]])]
function corner(pen, seed) {
    for (const sh of C.CORNER.shapes) {
        if (sh.kind === 'box') {
            // only what is inside the drawing's room: x from -1 to 7
            const x0 = Math.max(-1, sh.c[0] - sh.h[0]), x1 = Math.min(7, sh.c[0] + sh.h[0])
            pen.shape(rect([(x0 + x1) / 2, sh.c[1]], [(x1 - x0) / 2, sh.h[1]]), { role: 'solid', fill: 'fill', w: 1 })
        } else pen.line(T(sh.a), T(sh.b), { role: 'light', w: 3, dash: [] })
    }
    pen.label(T([0.6, 3.75]), 'lamp', { role: 'light', size: 11, align: 'center' })
    // a few of this seed's paths: what the pixel's samples are
    const R = rng(seed * 7919 + 13), dir = Math.atan2(C.LOOK[1] - C.EYE[1], C.LOOK[0] - C.EYE[0])
    for (let p = 0; p < 7; p++) {
        const rec = []
        tracePath(C.CORNER, C.EYE[0], C.EYE[1], Math.cos(dir), Math.sin(dir), { rand: R, maxBounce: C.MAX_BOUNCE, record: rec })
        for (const q of rec) {
            const clip = ([x, y]) => [Math.min(7, Math.max(-1, x)), Math.min(4.6, Math.max(-0.6, y))]
            pen.line(T(clip(q.a)), T(clip(q.b)), { role: q.lamp ? 'light' : 'faint', w: q.lamp ? 1.6 : 0.8, dash: [] })
        }
    }
    pen.eye(T(C.EYE), dir, { size: 12 })
    pen.dot(T(C.LOOK), { role: 'accent', r: 3 })
    pen.label(T([2.2, -1.25]), 'the pixel\'s point of floor', { role: 'accent', size: 11, align: 'center' })
}

/* THE FURNACE'S ROWS, their films cached by page */
const films = new Map()
export function furnaceRows(page) {
    if (!films.has(page)) films.set(page, C.FURNACE_ROWS.map(row => { const film = C.furnaceFilm(row, page); return { row, film, ...C.furnaceReading(film) } }))
    return films.get(page)
}
/** does a row read what it must: 1 within 2% for the rows that must read 1, under 0.95 for the grey, under 0.5 for the
 *  control */
export const verdict = q => q.row.id === 'control' ? q.ratio < 0.5 : q.row.id === 'grey' ? q.ratio < 0.95 : Math.abs(q.ratio - 1) < 0.02

/* THE ERROR BARS, cached by setting */
const bars = new Map()
export function barsOf(s) {
    const key = `${s.lv}|${s.win}|${s.wrong}|${s.seed}`
    if (!bars.has(key)) { if (bars.size > 30) bars.clear(); bars.set(key, C.errorBars({ samples: 2 ** s.lv, window: s.win === 'ema' ? C.WINDOW : Infinity, wrongS: s.win === 'ema' && s.wrong === 'count', pixels: 1000, seed: s.seed })) }
    return bars.get(key)
}

export const figures = {
    bias: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { which: 'whole', seed: 1 },
        controls: [
            { type: 'seg', key: 'which', options: Object.entries(READING).map(([k, v]) => [k, v.label]) },
            { type: 'button', label: 'Other paths', act: s => { s.seed++ } },
        ],
        steps: { whole: { which: 'whole', seed: 1 }, cut: { which: 'cap', seed: 1 }, clamp: { which: 'clamp', seed: 1 }, window: { which: 'window', seed: 1 } },
        draw(pen, s) {
            corner(pen, s.seed)
            const r = runOf(s.seed), { W, H } = pen.view, box = { x: W * 0.53, y: H * 0.1, w: W * 0.43, h: H * 0.7 }
            const lg = Math.log2, pick = (k, i) => i < 16 || i === N - 1 || Math.floor(lg(i + 1) * 12) !== Math.floor(lg(i + 2) * 12)
            const series = []
            for (const [key, v] of Object.entries(READING)) {
                const on = key === s.which, pts = r[key].filter(pick).map(q => [lg(q.k), q.Y, q.se ?? 0])
                if (on) {
                    // two error bars either side: an unbiased reading holds its true value inside about 95 times in 100
                    series.push({ tip: false, pts: pts.map(([x, y, e]) => [x, y + 2 * e]), role: v.role, w: 0.8, dash: [3, 3] })
                    series.push({ tip: false, pts: pts.map(([x, y, e]) => [x, y - 2 * e]), role: v.role, w: 0.8, dash: [3, 3] })
                }
                series.push({ name: v.label, pts, role: on ? v.role : 'faint', w: on ? 1.8 : 0.8, errorBars: false, tip: on })
            }
            series.push({ name: 'true value', pts: [[0, C.TRUTH], [lg(N), C.TRUTH]], role: 'ink', w: 1, dash: [6, 3] })
            pen.labelPx(box.x - 34, box.y - 20, 'the pixel\'s reading, ± two error bars (dashed)', { role: 'soft', size: 12 })
            plot(pen, box, {
                x: [0, lg(N)], y: [0, 3.2], xticks: [], yticks: [0, 1, C.TRUTH, 2, 3],
                fmt: v => Math.abs(v - C.TRUTH) < 1e-9 ? C.TRUTH.toFixed(3) : v.toFixed(0),
                hoverX: v => `after ${Math.round(2 ** v)} samples`, hoverY: v => v.toFixed(3), series,
            })
            for (let k = 0; k <= lg(N); k += 2) pen.labelPx(box.x + k / lg(N) * box.w, box.y + box.h + 4, String(2 ** k), { role: 'soft', size: 10, align: 'center', base: 'top', kind: 'mono' })
            pen.labelPx(box.x + box.w, box.y + box.h + 20, 'samples (a log scale)', { role: 'soft', size: 11, align: 'right', base: 'top' })
        },
        readout(s) {
            const q = standing(s.seed, s.which), v = READING[s.which]
            return `${v.label}, after ${N} samples: ${q.Y.toFixed(3)} ± ${q.se.toFixed(3)} · the true value ${C.TRUTH.toFixed(3)} · ${Math.abs(q.off).toFixed(1)} error bars ${q.off < 0 ? 'under' : 'over'} it · the error bar worth ${Math.round(1 / q.S)} samples`
        },
    },

    control: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { page: 'working' },
        controls: [
            { type: 'seg', key: 'page', options: [['working', 'The page working'], ['empty', 'The disc never drawn'], ['sky', 'The camera turned away']] },
        ],
        steps: { pass: { page: 'working' }, empty: { page: 'empty' }, sky: { page: 'sky' } },
        draw(pen, s) {
            const rows = furnaceRows(s.page), { W, H } = pen.view, x0 = W * 0.25, sw = W * 0.28, rh = H * 0.13, top = H * 0.19
            // the title on a line of its own above the columns' heads (they overlapped)
            pen.labelPx(x0, top - 26, 'each row\'s picture (white: the sky\'s 1)', { role: 'soft', size: 11, base: 'bottom' })
            pen.labelPx(x0 + sw + 12, top - 6, 'ratio', { role: 'soft', size: 11, base: 'bottom' })
            pen.labelPx(x0 + sw + 72, top - 6, 'noise', { role: 'soft', size: 11, base: 'bottom' })
            rows.forEach((q, i) => {
                const y = top + i * rh, ok = verdict(q), control = q.row.id === 'control'
                pen.labelPx(x0 - 8, y + rh * 0.35, q.row.label, { role: control ? 'accent' : 'ink', size: 11, align: 'right', base: 'middle' })
                pen.image(x0, y, sw, rh * 0.7, C.FPIX, 1, k => { const v = q.film[k]; return [v, v, v] })
                pen.labelPx(x0 + sw + 12, y + rh * 0.35, q.ratio.toFixed(4), { role: 'ink', size: 12, base: 'middle', kind: 'mono' })
                pen.labelPx(x0 + sw + 72, y + rh * 0.35, q.noise.toFixed(4), { role: q.noise === 0 ? 'soft' : 'ink', size: 12, base: 'middle', kind: 'mono' })
                pen.labelPx(x0 + sw + 134, y + rh * 0.35, ok ? (control ? 'fails, as it must' : 'passes') : control ? 'PASSES: nothing measured' : 'fails', { role: ok ? 'ink' : 'blocked', size: 11, base: 'middle' })
                const hp = pen.hover({ x: x0, y, w: sw, h: rh * 0.7 })
                if (hp) { const k = Math.min(C.FPIX - 1, Math.floor((hp.x - x0) / sw * C.FPIX)); pen.tip(hp.x, hp.y, [`${q.row.label}, pixel ${k + 1}`, `reads ${q.film[k].toFixed(4)}`, q.row.expect]) }
            })
            pen.labelPx(x0, top + rows.length * rh + 4, s.page === 'working' ? 'each pixel the mean of 32 samples; the disc fills the middle three quarters' : s.page === 'empty' ? 'no disc in the scene: every ray reaches the sky' : 'the camera looks the other way: every ray reaches the sky', { role: 'soft', size: 11, base: 'top' })
        },
        readout(s) {
            const rows = furnaceRows(s.page), ctl = rows.find(q => q.row.id === 'control')
            return `${rows.filter(q => q.row.id !== 'control' && verdict(q)).length} of ${rows.length - 1} rows read what they must · the control ${ctl.ratio.toFixed(4)}: ${verdict(ctl) ? 'well below 1, so the disc was there' : 'it reads 1 too, so no row measured anything'} · noise ${rows.every(q => q.noise === 0) ? '0 on every row' : 'above 0 where NEE is on or the disc is grey'}`
        },
    },

    errorbar: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { lv: 5, win: 'mean', wrong: 'right', seed: 1 },
        controls: [
            { type: 'slider', key: 'lv', label: 'samples a pixel', min: 1, max: 9, step: 1, fmt: v => String(2 ** v) },
            { type: 'seg', key: 'win', options: [['mean', 'a true mean'], ['ema', `a moving window of ${C.WINDOW}`]] },
            { type: 'seg', key: 'wrong', label: 'the error bar', options: [['right', 'as the kernel keeps it'], ['count', `the window taken for its count, ${C.WINDOW + 1}`]], when: s => s.win === 'ema' },
            { type: 'button', label: 'Other pixels', act: s => { s.seed++ } },
        ],
        steps: { mean: { lv: 5, win: 'mean', wrong: 'right', seed: 1 }, more: { lv: 8, win: 'mean', wrong: 'right', seed: 1 }, window: { lv: 8, win: 'ema', wrong: 'right', seed: 1 }, wrong: { lv: 8, win: 'ema', wrong: 'count', seed: 1 } },
        draw(pen, s) {
            const e = barsOf(s), { W, H } = pen.view, box = { x: W * 0.08, y: H * 0.12, w: W * 0.6, h: H * 0.62 }, shown = e.px.slice(0, 60)
            pen.labelPx(box.x, box.y - 22, '60 of 1000 pixels: each one\'s mean ± its reported error bar', { role: 'soft', size: 11 })
            plot(pen, box, {
                x: [-1, 60], y: [0, 2.6], xticks: [], yticks: [0, 1, 2],
                hoverX: v => `pixel ${Math.round(v) + 1}`, hoverY: v => v.toFixed(3),
                series: [
                    { name: 'mean', pts: shown.map((q, i) => [i, q.Y, q.se ?? 0]), role: 'cam', kind: 'dots', r: 2.4 },
                    { name: 'true value', pts: [[-1, 1], [60, 1]], role: 'ink', w: 1, dash: [6, 3] },
                ],
            })
            // the two spreads side by side, and the check
            const bx = W * 0.75, bw = W * 0.08, by = box.y + box.h, scale = box.h / 0.8
            const bar = (x, v, role, label) => {
                pen.ctx.save(); pen.ctx.fillStyle = pen.col(role); pen.ctx.globalAlpha = 0.75; pen.ctx.fillRect(x, by - v * scale, bw, v * scale); pen.ctx.restore()
                pen.labelPx(x + bw / 2, by - v * scale - 4, v.toFixed(3), { role: 'ink', size: 11, align: 'center', base: 'bottom', kind: 'mono' })
                pen.labelPx(x + bw / 2, by + 4, label, { role: 'soft', size: 10, align: 'center', base: 'top' })
            }
            bar(bx, e.real, 'cam', 'real spread')
            if (e.reported != null) bar(bx + bw * 1.4, e.reported, s.win === 'ema' && s.wrong === 'count' ? 'blocked' : 'light', 'reported')
            pen.labelPx(bx - 6, box.y - 22, 'a mean\'s spread', { role: 'soft', size: 11 })
            pen.labelPx(bx - 6, by + 22, e.seRatio != null ? `seRatio ${e.seRatio.toFixed(2)}` : 'no error bar yet', { role: 'ink', size: 12, base: 'top', kind: 'mono' })
        },
        readout(s) {
            const e = barsOf(s), n = 2 ** s.lv
            return `${n} sample${n > 1 ? 's' : ''} a pixel, ${s.win === 'mean' ? 'a true mean' : `a moving window of ${C.WINDOW}`} · the mean is worth ${e.worth.toFixed(1)} samples (1/S) · real spread ${e.real.toFixed(3)}, reported ${e.reported == null ? 'none (one sample has no spread to measure)' : e.reported.toFixed(3)} · seRatio over neighbours ${e.seRatio == null ? 'none' : e.seRatio.toFixed(2)}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
