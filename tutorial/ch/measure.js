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
const ROLE = { genrays: 'glass', march: 'cam', surface: 'normal', shade: 'light', occlude: 'shadow', resolve: 'accent' }
const roleOf = name => ROLE[name] ?? 'soft'

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
                const y = top + i * rh, noise = /^Noise library/.test(name), role = noise ? 'blocked' : /removed|Surface/.test(name) ? 'cam' : 'light'
                ctx.save(); ctx.fillStyle = pen.col(role); ctx.globalAlpha = hp && hp.y >= y && hp.y < y + rh ? 0.85 : 0.6; ctx.fillRect(x0, y + rh * 0.18, X(ms) - x0, rh * 0.64); ctx.restore()
                pen.labelPx(x0 - 8, y + rh / 2, name, { role: 'ink', size: 11, align: 'right', base: 'middle' })
                pen.labelPx(X(ms) + 6, y + rh / 2, ms.toFixed(1), { role: 'ink', size: 11, base: 'middle', kind: 'mono' })
            })
            if (s.view === 'one') pen.labelPx(x0, top + rh + 26, 'under 1.4 samples a second: "this architecture\'s full-resolution cost", said the plan', { role: 'blocked', size: 12 })
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
        world: { x: [0, 1], y: [0, 1] },
        state: { tick: 0, view: 'passes' },
        controls: [
            { type: 'seg', key: 'view', options: [['passes', 'Each pass'], ['kernels', 'By kernel'], ['iterations', 'By iteration']] },
            { type: 'seg', key: 'tick', label: 'timestamps rounded to', options: TICKS },
        ],
        steps: { passes: { tick: 0, view: 'passes' }, kernels: { tick: 0, view: 'kernels' }, iterations: { tick: 0, view: 'iterations' }, rounded: { tick: 100, view: 'passes' } },
        draw(pen, s) {
            const { W, H } = pen.view, { P, t, r, it } = reading(s.tick), exact = reading(0), { ctx } = pen
            const rect = { x: W * 0.15, y: H * 0.1, w: W * 0.8, h: H * 0.72 }
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
                    if (hp && hp.y >= y && hp.y < y + rh && Math.abs(hp.x - (a + b) / 2) < Math.max(3, (b - a) / 2)) hit = { p, i }
                })
                pen.labelPx(rect.x, rect.y + rect.h + 6, `0 ms`, { role: 'soft', size: 10, base: 'top' })
                pen.labelPx(rect.x + rect.w, rect.y + rect.h + 6, `${(span / 1e6).toFixed(1)} ms: the first pass's start to the last one's end`, { role: 'soft', size: 10, align: 'right', base: 'top' })
                if (hit) pen.tip(hp.x, hp.y, [`${hit.p.name}, pass ${hit.i + 1} of ${P.length}`, `${hit.p.ms.toFixed(3)} ms in the model`, `read from its timestamps: ${r.seq[hit.i][1].toFixed(3)} ms`])
            } else if (s.view === 'kernels') {
                const names = KERNELS.filter(k => r.ms[k] != null), top = Math.max(...names.map(k => Math.max(r.ms[k], exact.r.ms[k]))) * 1.1
                plot(pen, rect, {
                    x: [-0.6, names.length - 0.4], y: [0, top], xticks: [], fmt: v => `${v.toFixed(0)} ms`, hoverX: v => names[Math.round(v)] ?? '', hoverY: v => `${v.toFixed(2)} ms`,
                    series: [
                        { name: 'the model\'s own times', kind: 'bars', role: 'soft', barWidth: 0.8, pts: names.map((k, i) => [i, exact.r.ms[k]]) },
                        ...names.map((k, i) => ({ name: k, kind: 'bars', role: roleOf(k), barWidth: 0.55, slots: names.length, pts: [[i, r.ms[k]]] })),
                    ],
                })
                names.forEach((k, i) => pen.labelPx(rect.x + rect.w * (i + 0.6) / names.length, rect.y + rect.h + 6 + (i % 2) * 12, k, { role: roleOf(k), size: 9, align: 'center', base: 'top', kind: 'mono' }))
                pen.labelPx(rect.x + rect.w, rect.y - 4, 'grey behind: the model\'s own times; in colour: what the timestamps read', { role: 'soft', size: 10, align: 'right', base: 'bottom' })
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
            }
            pen.labelPx(rect.x, H * 0.04, 'one sample\'s compute passes: a model\'s times, read by the engine\'s own kerneltime.js', { role: 'soft', size: 11, base: 'top' })
        },
        readout(s) {
            const { r } = reading(s.tick), zero = r.seq.filter(q => q[1] === 0).length, busy = Object.values(r.ms).reduce((a, b) => a + b, 0)
            return `${r.passes} passes · busy ${busy.toFixed(2)} ms of a ${r.spanMs.toFixed(2)} ms span, gaps ${r.gapMs.toFixed(2)} ms · march ${r.ms.march.toFixed(2)}, shade ${r.ms.shade.toFixed(2)}, occlude ${r.ms.occlude.toFixed(2)}${s.tick ? ` · rounded to ${s.tick} µs: ${zero} passes read 0` : ''}`
        },
    },

    drift: {
        aspect: 1.7,
        world: { x: [0, 1], y: [0, 1] },
        state: { diff: 10, mode: 'separate', seed: 1 },
        controls: [
            { type: 'slider', key: 'diff', label: 'how much faster B really is', min: 0, max: 30, step: 1, fmt: v => `${v}%` },
            { type: 'seg', key: 'mode', options: [['separate', 'Separate runs'], ['interleaved', 'A, B, A, B in one run']] },
            { type: 'button', label: 'Compare again', act: s => { s.seed++ } },
        ],
        steps: { readings: { diff: 10, mode: 'separate', seed: 1 }, separate: { diff: 10, mode: 'separate', seed: 1 }, interleaved: { diff: 10, mode: 'interleaved', seed: 1 } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen
            // above: the four readings of one fingerprint, on their own axis
            const a = { x: W * 0.08, y: H * 0.16, w: W * 0.86 }, AX = v => a.x + a.w * (v - 150) / 130
            pen.labelPx(a.x, H * 0.05, 'the same kernels, the same scene and settings, one evening (the user\'s Pascal card): GPU ms a sample', { role: 'soft', size: 11, base: 'top' })
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + a.w, a.y); ctx.stroke(); ctx.restore()
            for (const v of [150, 175, 200, 225, 250, 275]) pen.labelPx(AX(v), a.y + 8, String(v), { role: 'soft', size: 10, align: 'center', base: 'top' })
            DRIFT_READINGS.forEach((v, i) => { pen.dotPx?.(AX(v), a.y, { role: 'blocked', r: 5 }) ?? (ctx.save(), ctx.fillStyle = pen.col('blocked'), ctx.beginPath(), ctx.arc(AX(v), a.y, 5, 0, 7), ctx.fill(), ctx.restore()); pen.labelPx(AX(v), a.y - 10 - (i % 2) * 12, v.toFixed(1), { role: 'blocked', size: 10, align: 'center', base: 'bottom' }) })
            // below: the comparisons, each B against A as measured
            const b = { x: W * 0.08, y: H * 0.42, w: W * 0.86, h: H * 0.42 }, lo = -0.6, hi = 0.4, BX = v => b.x + b.w * (v - lo) / (hi - lo)
            const d = driftTrials(s.diff / 100, s.mode, { n: 40, seed: s.seed })
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.stroke()
            ctx.setLineDash([5, 4]); ctx.strokeStyle = pen.col('cam'); ctx.beginPath(); ctx.moveTo(BX(-s.diff / 100), b.y); ctx.lineTo(BX(-s.diff / 100), b.y + b.h); ctx.stroke()
            ctx.strokeStyle = pen.col('soft'); ctx.beginPath(); ctx.moveTo(BX(0), b.y); ctx.lineTo(BX(0), b.y + b.h); ctx.stroke(); ctx.restore()
            for (const v of [-0.6, -0.4, -0.2, 0, 0.2, 0.4]) pen.labelPx(BX(v), b.y + b.h + 6, `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`, { role: 'soft', size: 10, align: 'center', base: 'top' })
            d.forEach((v, i) => { const wrong = v >= 0; ctx.save(); ctx.fillStyle = pen.col(wrong ? 'blocked' : 'cam'); ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(BX(Math.max(lo, Math.min(hi, v))), b.y + b.h - 8 - (i % 10) * (b.h - 16) / 9, 4, 0, 7); ctx.fill(); ctx.restore() })
            pen.labelPx(BX(-s.diff / 100), b.y - 4, `the truth: B ${s.diff}% faster`, { role: 'cam', size: 11, align: 'center', base: 'bottom' })
            pen.labelPx(b.x + b.w, b.y + b.h + 22, 'B against A, as measured: 40 comparisons (red: B read no faster)', { role: 'soft', size: 10, align: 'right', base: 'top' })
        },
        readout(s) {
            const d = driftTrials(s.diff / 100, s.mode, { n: 40, seed: s.seed }), wrong = d.filter(v => v >= 0).length, far = d.filter(v => Math.abs(v + s.diff / 100) > 0.05).length
            return `${s.mode === 'separate' ? 'each build in a run of its own' : 'A, B, A, B in one run'} · ${wrong} of 40 read B no faster, ${far} of 40 more than 5 points from the truth · the model: runs drift by ${(100 * driftSpread()).toFixed(0)}% (the four readings' spread), rows in one run ${(100 * WITHIN).toFixed(1)}%`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
