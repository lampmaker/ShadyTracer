//======================================================================================================================
// CHAPTER "Adding up light on a GPU": its figures.
//
//   race      threads adding their light to one pixel: a plain load and store, an integer atomic add, and
//             ShadyTracer's compare-and-swap loop for an f32 -- in one group's lock-step or interleaved
//   formats   one contribution as the old u32 fixed-point frame buffer kept it and as an f32 keeps it, on a number
//             line of the light a renderer in cd/m^2 meets
//   batches   a sample bigger than the ray buffer: core/photons.js's own planBatches, the camera's rays and the photons
//             split fairly over the fewest batches that fit, the photons first while the photon map runs
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { rng } from '../kit/flatland.js'
import { raceRun, fixedKeeps, f32Keeps, FIXED_SCALE, FIXED_CLAMP } from '../kit/gpu.js'
import { planBatches } from '../../lib/pathtracer/core/photons.js'
import { RAY_BYTES, SHADE_ITEM_BYTES } from '../../lib/pathtracer/core/tracebasics.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/* THE RACE: each thread's light a whole number from 1 to 9, drawn by the seed */
export const valuesOf = (n, seed) => { const R = rng(seed); return Array.from({ length: n }, () => 1 + Math.floor(R() * 9)) }
export const raceOf = s => raceRun(valuesOf(s.n, s.seed), s.mode, { lockstep: s.sched === 'lockstep', rand: rng(s.seed + 50) })
export const MODES = [['plain', 'Load, add, store'], ['atomic', 'Atomic add'], ['cas', 'Compare and swap']]
const OP = { load: ['L', 'cam'], store: ['S', 'light'], add: ['+', 'shadow'], cas: ['C', 'accent'] }

/* THE FORMATS: the line from 1e-8 to 1e10, the values the code names */
export const MARKS = [[1 / FIXED_SCALE, '1/65536'], [25000, 'a sunlit white wall'], [1.6e9, 'the sun\'s disc']]

/* THE BATCHES: the ray buffer's rays, 1 GiB at 2 rays' room and a shade queue item each (raytrace_main.js rayBudgetBytes) */
export const BUDGET = Math.floor(2 ** 30 / (2 * RAY_BYTES + SHADE_ITEM_BYTES))
export const SIZES = [['1280x720', '1280 × 720'], ['1920x1080', '1920 × 1080'], ['2560x1440', '2560 × 1440'], ['3840x2160', '3840 × 2160']]
export const planOf = s => { const [w, h] = s.size.split('x').map(Number); return { w, h, plan: planBatches(BUDGET, [w * h, Math.round(s.photons * 1e6)], 1, s.map ? { first: [1] } : {}) } }

/** a number as a reader writes it, 4.1 × 10⁻⁵ rather than JavaScript's 4.1e-5 */
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
export const sci = (x, d) => { const [m, e] = x.toExponential(d).split('e'); return `${m} × 10${String(+e).replace('-', '⁻').replace(/\d/g, c => SUP[c])}` }

export const figures = {
    race: {
        aspect: 1.6,
        world: { x: [0, 1], y: [0, 1] },
        state: { mode: 'plain', sched: 'lockstep', n: 6, seed: 1 },
        controls: [
            { type: 'seg', key: 'mode', options: MODES },
            { type: 'seg', key: 'sched', options: [['lockstep', 'One group, in lock-step'], ['random', 'Interleaved']] },
            { type: 'slider', key: 'n', label: 'threads', min: 2, max: 16, step: 1, fmt: v => String(v) },
            { type: 'button', label: 'Run again', act: s => { s.seed++ } },
        ],
        steps: { plain: { mode: 'plain', sched: 'lockstep', n: 6, seed: 1 }, mixed: { mode: 'plain', sched: 'random', n: 6, seed: 1 }, atomic: { mode: 'atomic', sched: 'lockstep', n: 6, seed: 1 }, cas: { mode: 'cas', sched: 'lockstep', n: 6, seed: 1 }, crowd: { mode: 'cas', sched: 'lockstep', n: 16, seed: 1 } },
        draw(pen, s) {
            const { W, H } = pen.view, r = raceOf(s), vals = valuesOf(s.n, s.seed), { ctx } = pen
            // columns: rounds in lock-step, one step each when interleaved
            const cols = s.sched === 'lockstep' ? r.rounds : r.steps.length, colOf = (e, k) => s.sched === 'lockstep' ? e.round : k
            const x0 = W * 0.2, y0 = H * 0.14, cw = Math.min(56, (W * 0.76) / Math.max(1, cols)), rh = Math.min(38, (H * 0.66) / s.n)
            for (let t = 0; t < s.n; t++) pen.labelPx(x0 - 8, y0 + t * rh + rh / 2, `thread ${t + 1}: +${vals[t]}`, { role: 'soft', size: 11, align: 'right', base: 'middle' })
            const after = new Array(cols).fill(null)
            r.steps.forEach((e, k) => {
                const c = colOf(e, k), [g, role] = OP[e.op], x = x0 + c * cw, y = y0 + e.thread * rh, bad = e.op === 'cas' && !e.ok
                ctx.save(); ctx.fillStyle = pen.col(bad ? 'blocked' : role); ctx.globalAlpha = 0.28; ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2); ctx.restore()
                pen.labelPx(x + cw / 2, y + rh / 2, bad ? 'C✗' : e.op === 'cas' ? 'C✓' : e.op === 'store' ? `S${e.after}` : g, { role: bad ? 'blocked' : 'ink', size: 11, align: 'center', base: 'middle' })
                after[c] = e.after
            })
            // the pixel after each column
            pen.labelPx(x0 - 8, y0 - 14, 'the pixel', { role: 'accent', size: 11, align: 'right', base: 'middle' })
            after.forEach((v, c) => { if (v != null) pen.labelPx(x0 + c * cw + cw / 2, y0 - 14, String(v), { role: 'accent', size: 12, align: 'center', base: 'middle' }) })
            pen.labelPx(x0, y0 + s.n * rh + 12, s.sched === 'lockstep' ? 'each column a round, every thread one step' : 'each column one step of one thread', { role: 'soft', size: 11, base: 'top' })
            pen.labelPx(x0, y0 + s.n * rh + 30, 'L load, S store, + atomic add, C compare-and-swap (✓ done, ✗ try again)', { role: 'soft', size: 11, base: 'top' })
            const hp = pen.hover({ x: x0, y: y0, w: cols * cw, h: s.n * rh })
            if (hp) {
                const c = Math.floor((hp.x - x0) / cw), t = Math.floor((hp.y - y0) / rh), e = r.steps.find((q, k) => colOf(q, k) === c && q.thread === t)
                if (e) pen.tip(hp.x, hp.y, [`thread ${t + 1}, ${e.op}${e.op === 'cas' ? (e.ok ? ': swapped' : ': memory had changed, try again') : ''}`, `the pixel after it: ${e.after}`])
            }
        },
        readout(s) {
            const r = raceOf(s)
            return `${s.n} threads add ${r.expected} in all · the pixel ends at ${r.final}${r.final === r.expected ? ', every one counted' : `: ${r.expected - r.final} lost`} · ${r.steps.length} steps (boxes)${s.sched === 'lockstep' ? ` in ${r.rounds} round${r.rounds === 1 ? '' : 's'} (columns)` : ', one a column'}${s.mode === 'cas' ? `, ${r.failed} of them a compare-and-swap that failed` : ''}`
        },
    },

    formats: {
        aspect: 2.1,
        world: { x: [-9.2, 11.2], y: [-2.4, 3.0] },
        state: { lv: Math.log10(25000), v: 25000 },
        steps: { ordinary: { lv: Math.log10(0.3), v: 0.3 }, wall: { lv: Math.log10(25000), v: 25000 }, sun: { lv: Math.log10(1.6e9), v: 1.6e9 }, dim: { lv: -6, v: 1e-6 } },
        drag: { v: (s, p) => { s.lv = Math.round(clamp(p[0], -8, 10) * 20) / 20; s.v = +(10 ** s.lv).toPrecision(3) } },
        draw(pen, s) {
            const v = s.v, lf = Math.log10(1 / FIXED_SCALE), lc = Math.log10(FIXED_CLAMP)
            // the line and its powers of ten
            pen.line([-8, 0], [10, 0], { role: 'ink', w: 1.2, exact: true })
            const sup = e => '10' + String(e).replace(/-/g, '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])
            for (let e = -8; e <= 10; e += 2) { pen.line([e, -0.12], [e, 0.12], { role: 'ink', w: 1, exact: true }); pen.label([e, -0.45], sup(e), { role: 'soft', size: 11, align: 'center' }) }
            // the old fixed point: kept between 1/65536 and the clamp
            pen.shape([[lf, 0.85], [lc, 0.85], [lc, 1.35], [lf, 1.35]], { role: 'shadow', fill: 'shadow', w: 1 })
            pen.shape([[-8, 0.85], [lf, 0.85], [lf, 1.35], [-8, 1.35]], { role: 'blocked', fill: 'blocked', w: 0.8, dash: [3, 3] })
            pen.shape([[lc, 0.85], [10, 0.85], [10, 1.35], [lc, 1.35]], { role: 'blocked', fill: 'blocked', w: 0.8, dash: [3, 3] })
            pen.label([-8, 1.62], 'the old u32 at 65536 a unit:', { role: 'ink', size: 12 })
            pen.label([(lf - 8) / 2, 1.1], 'nothing', { role: 'blocked', size: 11, align: 'center' })
            pen.label([(lf + lc) / 2, 1.1], 'kept, rounded to steps of 1/65536', { role: 'ink', size: 11, align: 'center' })
            pen.label([(lc + 10) / 2, 1.1], 'clamped to 10,000', { role: 'blocked', size: 11, align: 'center' })
            // an f32: the whole line, to about 7 digits
            pen.shape([[-8, 1.95], [10, 1.95], [10, 2.35], [-8, 2.35]], { role: 'cam', fill: 'cam', w: 1 })
            pen.label([-8, 2.6], 'an f32: all of it, to about 7 significant digits (it reaches 3.4 × 10³⁸)', { role: 'ink', size: 12 })
            // the values the code names
            for (const [m, t] of MARKS) { const x = Math.log10(m); pen.line([x, -0.9], [x, 0.2], { role: 'soft', w: 0.8, dash: [2, 3], exact: true }); pen.label([x, -1.15], t, { role: 'soft', size: 11, align: 'center' }) }
            pen.handle('v', [s.lv, 0], { role: 'accent' })
            pen.label([clamp(s.lv, -6.5, 8.5), -1.8], `a contribution of ${v >= 1e4 || v < 1e-2 ? sci(v, 2) : String(+v.toPrecision(4))}`, { role: 'accent', size: 13, align: 'center' })
        },
        readout(s) {
            const v = s.v, fx = fixedKeeps(v), f = f32Keeps(v), rel = k => k === v ? 'exactly' : Math.abs(k - v) / v > 0.01 ? `${(p => p > 99 ? p.toFixed(4) : p.toPrecision(4))(100 * (1 - k / v))}% of it lost` : `off by ${sci(Math.abs(k - v) / v, 1)} of it`
            const num = x => x >= 1e4 || (x > 0 && x < 1e-2) ? sci(x, 4) : String(+x.toPrecision(8))
            return `a contribution of ${num(v)} · the old fixed point kept ${num(fx)} (${fx === 0 ? 'all of it lost' : rel(fx)}) · an f32 keeps ${num(f)} (${rel(f)})`
        },
    },

    batches: {
        aspect: 1.8,
        world: { x: [0, 1], y: [0, 1] },
        state: { size: '1280x720', photons: 1, map: false },
        controls: [
            { type: 'seg', key: 'size', options: SIZES },
            { type: 'slider', key: 'photons', label: 'photons, in millions', min: 0, max: 4, step: 0.1, fmt: v => v.toFixed(1) },
            { type: 'toggle', key: 'map', label: 'The photon map: photons first' },
        ],
        steps: { fits: { size: '1280x720', photons: 1, map: false }, over: { size: '3840x2160', photons: 1, map: false }, map: { size: '1280x720', photons: 1, map: true } },
        draw(pen, s) {
            const { W, H } = pen.view, { w, h, plan } = planOf(s), K = plan.batches
            const rect = { x: W * 0.1, y: H * 0.12, w: W * 0.86, h: H * 0.68 }
            const cam = Array.from({ length: K }, (_, k) => plan.part(0, k)), ph = Array.from({ length: K }, (_, k) => plan.part(1, k))
            plot(pen, rect, {
                x: [0.4, K + 0.6], y: [0, BUDGET * 1.15], xticks: Array.from({ length: K }, (_, k) => k + 1), fmt: v => v >= 1e5 ? `${(v / 1e6).toFixed(1)} M` : String(Math.round(v)),
                yticks: [0, 1e6, 2e6], hoverX: v => `batch ${Math.round(v)}`, hoverY: v => Math.round(v).toLocaleString('en-US'),
                series: [
                    { name: 'the buffer holds', role: 'blocked', w: 1.2, dash: [5, 4], pts: [[0.4, BUDGET], [K + 0.6, BUDGET]] },
                    { name: 'camera rays and photons', kind: 'bars', role: 'light', barWidth: 0.6, pts: cam.map((c, k) => [k + 1, c + ph[k]]) },
                    { name: 'camera rays', kind: 'bars', role: 'cam', barWidth: 0.6, pts: cam.map((c, k) => [k + 1, c]) },
                ],
            })
            pen.labelPx(rect.x, rect.y - 16, `${w} × ${h}: each batch's rays, against the ${BUDGET.toLocaleString('en-US')} the buffers hold`, { role: 'soft', size: 11 })
            pen.labelPx(rect.x + rect.w, rect.y + rect.h + 22, 'batch', { role: 'soft', size: 11, align: 'right', base: 'top' })
        },
        readout(s) {
            const { w, h, plan } = planOf(s)
            return `${(w * h).toLocaleString('en-US')} camera rays and ${Math.round(s.photons * 1e6).toLocaleString('en-US')} photons · ${plan.batches} batch${plan.batches === 1 ? '' : 'es'}${plan.firstBatches ? `, the first ${plan.firstBatches === 1 ? 'of them' : plan.firstBatches} photons only` : ''} · resolve once, after the last`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
