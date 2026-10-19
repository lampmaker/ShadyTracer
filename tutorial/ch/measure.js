//======================================================================================================================
// CHAPTER "Measure first": its figures.
//
//   plan     one scene's slow render, and the numbers that said what it was: the benchmark's first full run, every
//            scene and the Noise library's own rows (docs/PERFORMANCE.md, measured on the user's GTX 1080 Ti)
//   timer    a sample's compute passes as GPU timestamps, read back by the engine's own tally and perIteration
//            (core/kerneltime.js): the passes are a model (kit/timing.js), the reading is real; a browser's rounding
//   drift    the same code read 184.7 to 255.5 ms in one evening; two builds compared in separate runs or interleaved,
//            under that drift (a model of it, kit/timing.js)
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng } from '../kit/flatland.js'
import { plot } from '../kit/plot.js'
import { wavefrontRun } from '../kit/wavefront.js'
import { modelPasses, timestamps, driftTrials, driftSpread, DRIFT_READINGS, WITHIN } from '../kit/timing.js'
import { tally, perIteration } from '../../lib/pathtracer/core/kerneltime.js'

const DEG = Math.PI / 180

/* THE BENCHMARK'S FIRST FULL RUN (docs/PERFORMANCE.md, "the benchmark's first full run": the user, GTX 1080 Ti,
   Windows, Chrome 154, 2026-09-29T18:52Z, code at fafa241), 1280 x 720, ms a sample, the median. Copied; the test
   holds each number to the document. */
export const SCENES = [['Noise library', 736.5], ['Menger cubes', 177.2], ['demo', 95.6], ['showcase', 93.1], ['Surface materials', 80.0], ['materials', 61.8]]
export const RELIEFS = [['Noise library, as it is', 736.5], ['...its reliefs removed', 81.1], ['Surface materials (its layout, no reliefs)', 80.0],
    ['only relief 1 mm / 10 mm', 155.1], ['only relief 3 mm / 25 mm', 157.9], ['only relief 0.3 mm / 2 mm', 164.4],
    ['only relief 1.5 mm / 8 mm (granite)', 172.1], ['only relief 0.4 mm / 2.5 mm (leather)', 168.0], ['only relief 2 mm / 30 mm (marble)', 152.9]]
const VIEWS = { one: [SCENES[0]], scenes: SCENES, reliefs: RELIEFS }

/* THE SAMPLE TIMED: chapter 22's room (copied: a chapter's figure module mounts when imported), 64 pixels, 16 paths */
const SUN_EL = 35 * DEG, HALF = 0.27 * DEG
const ROOM = { sky: 0, sun: { dir: SUN_EL, half: HALF, L: 1 / (2 * Math.sin(HALF)), aim: [2, 1.6], width: 12, back: 14 }, shapes: [
    { kind: 'box', c: [0, -0.3], h: [5.4, 0.3], albedo: 0.7 }, { kind: 'box', c: [0, 3.4], h: [5.4, 0.2], albedo: 0.6 },
    { kind: 'box', c: [-5.2, 1.6], h: [0.2, 1.6], albedo: 0.6 }, { kind: 'box', c: [5.2, 0.9], h: [0.2, 0.9], albedo: 0.6 },
    { kind: 'box', c: [5.2, 2.9], h: [0.2, 0.3], albedo: 0.6 }] }
const CAM = { eye: [-4.7, 2.9], dir: -18 * DEG, fov: 70 * DEG, pixels: 64 }
let SAMPLE = null
export const sample = () => SAMPLE ?? (SAMPLE = modelPasses(wavefrontRun(ROOM, CAM, { spp: 16, seed: 3 })))
/** what the engine reads from the model's timestamps, rounded to `tickUs` */
export function reading(tickUs) {
    const P = sample(), t = timestamps(P, { tickUs }), r = tally(P.map(p => p.name), t)
    return { P, t, r, it: perIteration(r.seq) }
}
export const TICKS = [[0, 'exact'], [32.768, '32.768 µs'], [100, '100 µs']]
export const KERNELS = ['genrays', 'prep_march', 'march', 'prep_shade', 'surface', 'shade', 'prep_occlude', 'occlude', 'flip', 'resolve']
const ROLE = { genrays: 'ink', march: 'cam', surface: 'normal', shade: 'light', occlude: 'shadow', resolve: 'ink' }
const roleOf = name => ROLE[name] ?? 'glass'           // the prep kernels and the flip: teal, apart from occlusion's colour in every style

/** ONE PASS ROUNDED: a pass `len` µs long starting at `at`, its start and its end each rounded DOWN to `tick` µs (as
 *  timestamps() rounds them), and what it then reads; and over `n` passes of that length at random starts, how many
 *  read a tick or more and their mean reading -- the pass's own length, on average. */
export function oneRounded(at, len, tick, n = 10000, seed = 7) {
    const down = v => Math.floor(v / tick) * tick, ra = down(at), rb = down(at + len)
    const R = rng(seed)
    let ticked = 0, sum = 0
    for (let k = 0; k < n; k++) { const a = R() * 2 * tick, r = down(a + len) - down(a); sum += r; if (r > 0) ticked++ }
    return { ra, rb, read: rb - ra, ticked, mean: sum / n }
}
let TICKVIEW = null                 // the tick view's ruler as last drawn, for its drag (a drag is handed world points)

export const figures = {
    plan: {
        aspect: 1.75,
        world: { x: [0, 1], y: [0, 1] },
        state: { view: 'one' },
        controls: [{ type: 'seg', key: 'view', options: [['one', 'One scene'], ['scenes', 'Every scene'], ['reliefs', 'The Noise library\'s rows']] }],
        steps: { one: { view: 'one' }, scenes: { view: 'scenes' }, reliefs: { view: 'reliefs' } },
        draw(pen, s) {
            const { W, H } = pen.view, rows = VIEWS[s.view], { ctx } = pen
            const x0 = W * 0.36, x1 = W * 0.9, top = H * 0.12, rh = Math.min(30, H * 0.78 / rows.length), X = v => x0 + (x1 - x0) * v / 800
            pen.labelPx(x0, top - 12, 'ms a sample at 1280 × 720: the benchmark\'s first full run', { role: 'soft', size: 11 })
            for (const v of [0, 200, 400, 600, 800]) {
                ctx.save(); ctx.strokeStyle = pen.col('faint'); ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(X(v), top); ctx.lineTo(X(v), top + rows.length * rh); ctx.stroke(); ctx.restore()
                pen.labelPx(X(v), top + rows.length * rh + 4, String(v), { role: 'soft', size: 10, align: 'center', base: 'top' })
            }
            const hp = pen.hover({ x: 0, y: top, w: W, h: rows.length * rh })
            rows.forEach(([name, ms], i) => {
                const y = top + i * rh, noise = /^Noise library/.test(name), role = noise ? 'blocked' : /removed|Surface/.test(name) ? 'cam' : /^only relief/.test(name) ? 'normal' : 'light'
                ctx.save(); ctx.fillStyle = pen.col(role); ctx.globalAlpha = hp && hp.y >= y && hp.y < y + rh ? 0.85 : 0.6; ctx.fillRect(x0, y + rh * 0.18, X(ms) - x0, rh * 0.64); ctx.restore()
                pen.labelPx(x0 - 8, y + rh / 2, name, { role: 'ink', size: 11, align: 'right', base: 'middle' })
                pen.labelPx(X(ms) + 6, y + rh / 2, ms.toFixed(1), { role: 'ink', size: 11, base: 'middle', kind: 'mono' })
            })
            if (s.view === 'one') {
                pen.labelPx(x0, top + rh + 26, 'under 1.4 samples a second:', { role: 'blocked', size: 12 })
                pen.labelPx(x0, top + rh + 44, '"this architecture\'s full-resolution cost", said the plan', { role: 'blocked', size: 12 })
            }
        },
        readout(s) {
            const rows = VIEWS[s.view], ms = rows.map(r => r[1])
            return s.view === 'one' ? 'one number: the Noise library, 736.5 ms a sample'
                : s.view === 'scenes' ? `the same size, the same card, the same code: ${Math.min(...ms)} to ${Math.max(...ms)} ms a sample; the Noise library ${(736.5 / 95.6).toFixed(1)} times the demo's`
                : 'the Noise library without its six reliefs reads 81.1, its layout without them (Surface materials) 80.0; each relief alone adds 72 to 91'
        },
    },

    timer: {
        aspect: 1.65,
        world: { x: [0, 1.65], y: [0, 1] },          // the canvas's own shape: a world unit is its height
        state: { tick: 0, view: 'passes', at: 137, len: 4, mark: false },
        controls: [
            { type: 'seg', key: 'view', options: [['passes', 'Each pass'], ['kernels', 'By kernel'], ['iterations', 'By iteration'], ['tick', 'One pass, rounded']] },
            { type: 'seg', key: 'tick', label: 'timestamps rounded to', options: TICKS },
            { type: 'slider', key: 'len', label: 'the pass takes', min: 1, max: 150, step: 1, fmt: v => `${v} µs`, when: s => s.view === 'tick' },
        ],
        steps: { passes: { tick: 0, view: 'passes' }, stamps: { tick: 0, view: 'passes', mark: true }, kernels: { tick: 0, view: 'kernels' }, iterations: { tick: 0, view: 'iterations' }, rounded: { tick: 100, view: 'passes' },
            ticks: { tick: 100, view: 'tick', at: 137, len: 4 } },
        drag: { pass: (s, p) => {
            const T = TICKVIEW; if (!T) return
            const px = T.ox + p[0] * T.s
            s.at = Math.round(10 * Math.max(0, Math.min(T.span - s.len, (px - T.r0) / (T.r1 - T.r0) * T.span - s.len / 2))) / 10
        } },
        draw(pen, s) {
            const { W, H } = pen.view, { P, t, r, it } = reading(s.tick), exact = reading(0), { ctx } = pen
            const rect = { x: W * 0.15, y: H * 0.1, w: W * 0.8, h: H * 0.72 }
            if (s.view === 'tick') {
                // one pass on a ruler of ticks: its start and end each rounded down, and what it reads
                const tk = s.tick || 100, span = 3 * tk, r0 = W * 0.12, r1 = W * 0.95, X = us => r0 + (r1 - r0) * us / span, y = H * 0.42
                TICKVIEW = { ox: pen.view.ox, s: pen.view.s, r0, r1, span }
                const o = oneRounded(s.at, s.len, tk)
                pen.labelPx(r0, H * 0.04, s.tick ? `the card's clock, read in ticks of ${tk} µs: a timestamp is rounded down to the tick before it` : 'exact timestamps: drawn here against 100 µs ticks, but nothing is rounded', { role: 'soft', size: 11, base: 'top' })
                ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X(0), y); ctx.lineTo(X(span), y); ctx.stroke()
                for (let k = 0; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(X(k * tk), y - 10); ctx.lineTo(X(k * tk), y + 10); ctx.stroke() }
                ctx.restore()
                for (let k = 0; k <= 3; k++) pen.labelPx(X(k * tk), y + 14, `${+(k * tk).toFixed(3)} µs`, { role: 'soft', size: 10, align: 'center', base: 'top' })
                const a = X(s.at), b = X(s.at + s.len)
                ctx.save(); ctx.fillStyle = pen.col('cam'); ctx.globalAlpha = 0.8; ctx.fillRect(a, y - 34, Math.max(2, b - a), 16); ctx.restore()
                pen.labelPx((a + b) / 2, y - 40, `a pass of ${s.len} µs, from ${s.at.toFixed(1)}`, { role: 'cam', size: 11, align: 'center', base: 'bottom' })
                pen.handle('pass', [((a + b) / 2 - pen.view.ox) / pen.view.s, (pen.view.oy - (y - 26)) / pen.view.s], { role: 'accent' })
                if (s.tick) {
                    // the two roundings: each stamp down to the tick at or before it
                    ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.setLineDash([4, 3]); ctx.lineWidth = 1
                    ctx.beginPath(); ctx.moveTo(a, y - 18); ctx.lineTo(X(o.ra), y + 34); ctx.moveTo(b, y - 18); ctx.lineTo(X(o.rb), y + 52); ctx.stroke(); ctx.restore()
                    pen.labelPx(X(o.ra) - 4, y + 34, `start read ${+o.ra.toFixed(3)}`, { role: 'accent', size: 10, align: 'right', base: 'middle' })
                    pen.labelPx(X(o.rb) + 4, y + 52, `end read ${+o.rb.toFixed(3)}`, { role: 'accent', size: 10, base: 'middle' })
                }
                pen.labelPx(r0, y + 74, s.tick ? `it reads ${+o.read.toFixed(3)} µs: ${o.read ? 'a tick mark lies inside it' : 'no tick mark lies inside it'}` : `it reads ${s.len} µs`, { role: 'ink', size: 13, base: 'top' })
                // a thousand of them at random starts: how many read a tick
                const g = { x: r0, y: y + 104, cols: 50, rows: 4 }, cw = (r1 - r0) / g.cols, R = rng(7)
                for (let k = 0; k < g.cols * g.rows; k++) {
                    const st = R() * 2 * tk, rd = s.tick ? Math.floor((st + s.len) / tk) * tk - Math.floor(st / tk) * tk : s.len
                    ctx.save(); ctx.fillStyle = pen.col(rd > 0 && s.tick ? 'accent' : 'faint'); ctx.globalAlpha = rd > 0 && s.tick ? 0.85 : 0.5
                    ctx.fillRect(g.x + (k % g.cols) * cw + 1, g.y + Math.floor(k / g.cols) * 12, cw - 2, 9); ctx.restore()
                }
                pen.labelPx(r0, g.y + g.rows * 12 + 6, s.tick ? `200 passes of ${s.len} µs at random starts, in colour where one read a tick or more;` : 'exact: every pass reads its own length', { role: 'soft', size: 11, base: 'top' })
                if (s.tick) pen.labelPx(r0, g.y + g.rows * 12 + 22, `of 10,000 such passes ${o.ticked} did: ${(o.mean).toFixed(2)} µs on average, against its ${s.len}`, { role: 'soft', size: 11, base: 'top' })
                return
            }
            if (s.view === 'passes') {
                // each kernel a row, each pass a mark at its timestamps: the time line of one sample
                const t0 = Number(t[0]), span = Number(t[t.length - 1]) - t0 || 1, X = ns => rect.x + rect.w * (Number(ns) - t0) / span, rh = rect.h / KERNELS.length
                const hp = pen.hover(rect)
                let hit = null
                KERNELS.forEach((k, j) => pen.labelPx(rect.x - 8, rect.y + (j + 0.5) * rh, k, { role: roleOf(k), size: 10, align: 'right', base: 'middle', kind: 'mono' }))
                P.forEach((p, i) => {
                    const j = KERNELS.indexOf(p.name), a = X(t[2 * i]), b = X(t[2 * i + 1]), y = rect.y + j * rh
                    ctx.save(); ctx.fillStyle = pen.col(roleOf(p.name)); ctx.globalAlpha = 0.75
                    if (b > a) ctx.fillRect(a, y + rh * 0.2, Math.max(1, b - a), rh * 0.6)
                    else { ctx.strokeStyle = pen.col('blocked'); ctx.lineWidth = 1; ctx.strokeRect(a - 1, y + rh * 0.2, 2, rh * 0.6) }
                    ctx.restore()
                    if (s.tick && r.seq[i][1] > 1.5 * p.ms) { ctx.save(); ctx.fillStyle = pen.col('ink'); ctx.beginPath(); ctx.moveTo(a - 3, y + rh * 0.12); ctx.lineTo(a + 3, y + rh * 0.12); ctx.lineTo(a, y + rh * 0.3); ctx.fill(); ctx.restore() }
                    if (hp && hp.y >= y && hp.y < y + rh && Math.abs(hp.x - (a + b) / 2) < Math.max(3, (b - a) / 2)) hit = { p, i }
                })
                pen.labelPx(rect.x, rect.y + rect.h + 6, `0 ms`, { role: 'soft', size: 10, base: 'top' })
                pen.labelPx(rect.x + rect.w, rect.y + rect.h + 6, `${(span / 1e6).toFixed(1)} ms: the first pass's start to the last one's end`, { role: 'soft', size: 10, align: 'right', base: 'top' })
                if (s.mark) {
                    // one pass's two timestamps: the first march pass of iteration 1, its start and end in ns from the first
                    const i = P.findIndex(p => p.name === 'march'), j = KERNELS.indexOf('march'), a = X(t[2 * i]), b = X(t[2 * i + 1]), y = rect.y + j * rh
                    ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.setLineDash([3, 3])
                    ctx.beginPath(); ctx.moveTo(a, y - 6); ctx.lineTo(a, rect.y + rect.h); ctx.moveTo(b, y - 6); ctx.lineTo(b, rect.y + rect.h); ctx.stroke(); ctx.restore()
                    const ns = k => (Number(t[k] - t[0])).toLocaleString('en-US')
                    pen.labelPx(a - 3, y - 8, `start ${ns(2 * i)} ns`, { role: 'ink', size: 10, align: 'right', base: 'bottom', kind: 'mono' })
                    pen.labelPx(b + 3, y - 8, `end ${ns(2 * i + 1)} ns`, { role: 'ink', size: 10, base: 'bottom', kind: 'mono' })
                }
                if (hit) pen.tip(hp.x, hp.y, [`${hit.p.name}, pass ${hit.i + 1} of ${P.length}`, `${hit.p.ms.toFixed(3)} ms in the model`, `read from its timestamps: ${r.seq[hit.i][1].toFixed(3)} ms`])
            } else if (s.view === 'kernels') {
                const names = KERNELS.filter(k => r.ms[k] != null), top = Math.max(...names.map(k => Math.max(r.ms[k], exact.r.ms[k]))) * 1.1
                const { X, Y } = plot(pen, rect, {
                    x: [-0.6, names.length - 0.4], y: [0, top], xticks: [], fmt: v => `${v.toFixed(0)} ms`, hoverX: v => names[Math.round(v)] ?? '', hoverY: v => `${v.toFixed(2)} ms`,
                    series: names.map((k, i) => ({ name: k, kind: 'bars', role: roleOf(k), barWidth: 0.55, slots: names.length, pts: [[i, r.ms[k]]] })),
                })
                // the model's own time, a black line across each bar: where the bar would end if nothing were rounded
                ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1.6
                names.forEach((k, i) => { ctx.beginPath(); ctx.moveTo(X(i - 0.38), Y(exact.r.ms[k])); ctx.lineTo(X(i + 0.38), Y(exact.r.ms[k])); ctx.stroke() })
                ctx.restore()
                names.forEach((k, i) => pen.labelPx(rect.x + rect.w * (i + 0.6) / names.length, rect.y + rect.h + 6 + (i % 2) * 12, k, { role: roleOf(k), size: 9, align: 'center', base: 'top', kind: 'mono' }))
                pen.labelPx(rect.x + rect.w, rect.y - 4, 'bars: what the timestamps read; the black line across each: the model\'s own time', { role: 'soft', size: 10, align: 'right', base: 'bottom' })
            } else {
                const its = it.iterations, top = Math.max(...exact.it.iterations.map(o => Object.values(o).reduce((a, b) => a + b, 0))) * 1.1
                const bw = rect.w / its.length, Y = v => rect.y + rect.h - rect.h * v / top
                its.forEach((o, i) => {
                    let acc = 0
                    for (const k of KERNELS) if (o[k]) { ctx.save(); ctx.fillStyle = pen.col(roleOf(k)); ctx.globalAlpha = 0.75; ctx.fillRect(rect.x + i * bw + bw * 0.15, Y(acc + o[k]), bw * 0.7, Y(acc) - Y(acc + o[k])); ctx.restore(); acc += o[k] }
                    if (i % 2 === 0 || i === its.length - 1) pen.labelPx(rect.x + (i + 0.5) * bw, rect.y + rect.h + 6, String(i + 1), { role: 'soft', size: 10, align: 'center', base: 'top' })
                })
                pen.labelPx(rect.x - 8, rect.y, `${top.toFixed(1)} ms`, { role: 'soft', size: 10, align: 'right', base: 'top' })
                pen.labelPx(rect.x - 8, rect.y + rect.h, '0', { role: 'soft', size: 10, align: 'right', base: 'bottom' })
                pen.labelPx(rect.x + rect.w, rect.y + rect.h + 22, 'iteration (perIteration: prep_march to flip)', { role: 'soft', size: 10, align: 'right', base: 'top' })
                // the colours: one a kernel, the small ones (prep, flip) together
                let lx = rect.x + rect.w
                for (const [k, label] of [['flip', 'prep and flip'], ['occlude', 'occlude'], ['shade', 'shade'], ['surface', 'surface'], ['march', 'march']]) {
                    lx -= label.length * 6.2 + 22          // placed right to left: march leftmost
                    ctx.save(); ctx.fillStyle = pen.col(roleOf(k)); ctx.globalAlpha = 0.75; ctx.fillRect(lx, rect.y + 3, 10, 10); ctx.restore()
                    pen.labelPx(lx + 14, rect.y + 8, label, { role: roleOf(k), size: 10, base: 'middle', kind: 'mono' })
                }
            }
            pen.labelPx(rect.x, 4, 'one sample\'s compute passes: a model\'s times, read by the engine\'s own kerneltime.js', { role: 'soft', size: 11, base: 'top' })
        },
        readout(s) {
            if (s.view === 'tick') {
                const tk = s.tick || 100, o = oneRounded(s.at, s.len, tk)
                return s.tick ? `a ${s.len} µs pass from ${s.at.toFixed(1)} µs: its start read ${+o.ra.toFixed(3)}, its end ${+o.rb.toFixed(3)}, so it reads ${+o.read.toFixed(3)} µs · of 10,000 at random starts ${o.ticked} read a tick or more, ${o.mean.toFixed(2)} µs on average (its length: ${s.len})`
                    : `exact timestamps: the pass reads its ${s.len} µs · choose a rounding`
            }
            const { r } = reading(s.tick), zero = r.seq.filter(q => q[1] === 0).length, busy = Object.values(r.ms).reduce((a, b) => a + b, 0)
            return `${r.passes} passes · busy ${busy.toFixed(2)} ms of a ${r.spanMs.toFixed(2)} ms span, gaps ${r.gapMs.toFixed(2)} ms · march ${r.ms.march.toFixed(2)}, shade ${r.ms.shade.toFixed(2)}, occlude ${r.ms.occlude.toFixed(2)}${s.tick ? ` · rounded to ${s.tick} µs: ${zero} passes read 0; prep_march ${r.ms.prep_march.toFixed(2)}, prep_occlude ${r.ms.prep_occlude.toFixed(2)} (took ${reading(0).r.ms.prep_march.toFixed(2)} and ${reading(0).r.ms.prep_occlude.toFixed(2)})` : ''}`
        },
    },

    drift: {
        aspect: 1.7,
        world: { x: [0, 1], y: [0, 1] },
        state: { view: 'compare', diff: 10, mode: 'separate', seed: 1 },
        controls: [
            { type: 'seg', key: 'view', options: [['readings', 'The four readings'], ['compare', 'Two builds compared']] },
            { type: 'slider', key: 'diff', label: 'how much faster B really is', min: 0, max: 30, step: 1, fmt: v => `${v}%`, when: s => s.view === 'compare' },
            { type: 'seg', key: 'mode', options: [['separate', 'Separate runs'], ['interleaved', 'A, B, A, B in one run']], when: s => s.view === 'compare' },
            { type: 'button', label: 'Compare again', act: s => { s.seed++ }, when: s => s.view === 'compare' },
        ],
        steps: { readings: { view: 'readings', diff: 10, mode: 'separate', seed: 1 }, separate: { view: 'compare', diff: 10, mode: 'separate', seed: 1 }, interleaved: { view: 'compare', diff: 10, mode: 'interleaved', seed: 1 } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen
            // above: the four readings of one fingerprint, on their own axis (alone, larger, in the readings view)
            const big = s.view === 'readings', a = { x: W * 0.08, y: H * (big ? 0.42 : 0.16), w: W * 0.86 }, AX = v => a.x + a.w * (v - 150) / 130
            pen.labelPx(a.x, H * 0.05, 'the same kernels, the same scene and settings, one evening (the user\'s GTX 1080 Ti): GPU ms a sample', { role: 'soft', size: 11, base: 'top' })
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + a.w, a.y); ctx.stroke(); ctx.restore()
            for (const v of [150, 175, 200, 225, 250, 275]) pen.labelPx(AX(v), a.y + 8, String(v), { role: 'soft', size: 10, align: 'center', base: 'top' })
            DRIFT_READINGS.forEach((v, i) => { ctx.save(); ctx.fillStyle = pen.col('blocked'); ctx.beginPath(); ctx.arc(AX(v), a.y, big ? 7 : 5, 0, 7); ctx.fill(); ctx.restore(); pen.labelPx(AX(v), a.y - 10 - (i % 2) * 12, v.toFixed(1), { role: 'blocked', size: big ? 12 : 10, align: 'center', base: 'bottom' }) })
            if (big) {
                // the two measures of how far apart: the range (highest over lowest) and the spread (standard deviation over mean)
                const lo = Math.min(...DRIFT_READINGS), hi = Math.max(...DRIFT_READINGS), m = DRIFT_READINGS.reduce((x, y) => x + y, 0) / DRIFT_READINGS.length
                ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(AX(lo), a.y + 36); ctx.lineTo(AX(hi), a.y + 36); ctx.moveTo(AX(lo), a.y + 30); ctx.lineTo(AX(lo), a.y + 42); ctx.moveTo(AX(hi), a.y + 30); ctx.lineTo(AX(hi), a.y + 42); ctx.stroke()
                ctx.strokeStyle = pen.col('cam'); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(AX(m), a.y - 40); ctx.lineTo(AX(m), a.y + 20); ctx.stroke(); ctx.restore()
                pen.labelPx((AX(lo) + AX(hi)) / 2, a.y + 46, `the range: the highest ${((hi / lo - 1) * 100).toFixed(0)}% above the lowest`, { role: 'accent', size: 12, align: 'center', base: 'top' })
                pen.labelPx(AX(m), a.y - 44, `their mean, ${m.toFixed(1)}`, { role: 'cam', size: 11, align: 'center', base: 'bottom' })
                pen.labelPx(a.x, a.y + 76, `the spread: their standard deviation, ${(100 * driftSpread()).toFixed(0)}% of their mean -- the size of a run's own drift in the model below`, { role: 'soft', size: 11, base: 'top' })
                return
            }
            // below: the comparisons, each B against A as measured
            const b = { x: W * 0.08, y: H * 0.42, w: W * 0.86, h: H * 0.42 }, lo = -0.6, hi = 0.4, BX = v => b.x + b.w * (v - lo) / (hi - lo)
            const d = driftTrials(s.diff / 100, s.mode, { n: 40, seed: s.seed })
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.stroke()
            ctx.setLineDash([5, 4]); ctx.strokeStyle = pen.col('cam'); ctx.beginPath(); ctx.moveTo(BX(-s.diff / 100), b.y); ctx.lineTo(BX(-s.diff / 100), b.y + b.h); ctx.stroke()
            ctx.strokeStyle = pen.col('soft'); ctx.beginPath(); ctx.moveTo(BX(0), b.y); ctx.lineTo(BX(0), b.y + b.h); ctx.stroke(); ctx.restore()
            for (const v of [-0.6, -0.4, -0.2, 0, 0.2, 0.4]) pen.labelPx(BX(v), b.y + b.h + 6, `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`, { role: 'soft', size: 10, align: 'center', base: 'top' })
            d.forEach((v, i) => { const wrong = v >= 0; ctx.save(); ctx.fillStyle = pen.col(wrong ? 'blocked' : 'cam'); ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(BX(Math.max(lo, Math.min(hi, v))), b.y + b.h - 8 - (i % 10) * (b.h - 16) / 9, 4, 0, 7); ctx.fill(); ctx.restore() })
            pen.labelPx(BX(-s.diff / 100), b.y - 4, `the truth: B ${s.diff}% faster`, { role: 'cam', size: 11, align: 'center', base: 'bottom' })
            pen.labelPx(BX(0) + 4, b.y + 2, 'no difference', { role: 'soft', size: 10, base: 'top' })
            pen.labelPx(b.x, b.y + b.h + 22, '← B read faster', { role: 'soft', size: 10, base: 'top' })
            pen.labelPx(BX(0), b.y + b.h + 22, 'B read slower →', { role: 'soft', size: 10, base: 'top' })
            pen.labelPx(b.x + b.w, b.y + b.h + 36, 'B\'s time against A\'s, as measured: 40 comparisons (red: B read no faster)', { role: 'soft', size: 10, align: 'right', base: 'top' })
        },
        readout(s) {
            if (s.view === 'readings') return `one kernel text, four readings: ${DRIFT_READINGS.join(', ')} ms · the range ${((Math.max(...DRIFT_READINGS) / Math.min(...DRIFT_READINGS) - 1) * 100).toFixed(0)}%, the spread ${(100 * driftSpread()).toFixed(0)}% of the mean`
            const d = driftTrials(s.diff / 100, s.mode, { n: 40, seed: s.seed }), wrong = d.filter(v => v >= 0).length, near = w => d.filter(v => Math.abs(v + s.diff / 100) <= w).length
            return `${s.mode === 'separate' ? 'each build in a run of its own' : 'A, B, A, B in one run'} · ${wrong} of 40 read B no faster; ${near(0.02)} within 2 points of the truth, ${near(0.05)} within 5 · the model: runs drift by ${(100 * driftSpread()).toFixed(0)}% (the four readings' spread), rows in one run ${(100 * WITHIN).toFixed(1)}%`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
