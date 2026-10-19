//======================================================================================================================
// CHAPTER "Wavefront path tracing": its figures.
//
//   log      one sample of a sunlit room as a wavefront (kit/wavefront.js): what each iteration marched, shaded and
//            traced, the drained tail, and a budget below the worst case flushing and cutting paths
//   queues   one iteration kernel by kernel: the two ray buffers taking turns, the shade queue, the shadow queue's two
//            sides, and the counts each prep kernel turns into the next dispatch's size
//   lanes    the same work timed as lanes: one big kernel looping over bounces against the wavefront's kernels
//
// The flat world's simulation, not the GPU: it runs ShadyTracer's iteration in the same order with the same rules
// (kit/wavefront.js says which, and what it leaves out).
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { wavefrontRun, laneTimes } from '../kit/wavefront.js'

const DEG = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/* THE ROOM: chapter 20's, copied (a chapter's figure module mounts its figures when imported, so chapters never import
   each other's), without its dust and with paler walls (0.6) and floor (0.7), so paths go round it: a window 0.8 high in
   the right wall, the sun 35 degrees up beyond it. 64 pixels, 16 paths each: 1024 paths in flight. */
const SUN_EL = 35 * DEG, HALF = 0.27 * DEG
export const world = {
    sky: 0, sun: { dir: SUN_EL, half: HALF, L: 1 / (2 * Math.sin(HALF)), aim: [2, 1.6], width: 12, back: 14 },
    shapes: [
        { kind: 'box', c: [0, -0.3], h: [5.4, 0.3], albedo: 0.7, name: 'floor' },
        { kind: 'box', c: [0, 3.4], h: [5.4, 0.2], albedo: 0.6, name: 'ceiling' },
        { kind: 'box', c: [-5.2, 1.6], h: [0.2, 1.6], albedo: 0.6, name: 'wall' },
        { kind: 'box', c: [5.2, 0.9], h: [0.2, 0.9], albedo: 0.6, name: 'wall' },
        { kind: 'box', c: [5.2, 2.9], h: [0.2, 0.3], albedo: 0.6, name: 'wall' },
    ],
}
export const CAM = { eye: [-4.7, 2.9], dir: -18 * DEG, fov: 70 * DEG, pixels: 64 }
export const SPP = 16
const RUNS = new Map()
/** the sample, by budget (0 or the worst case itself: the worst case) and NEE, made once each */
export const WORST = 24
export function run(budget = 0, nee = true) {
    if (budget === WORST) budget = 0
    const key = `${budget}|${nee}`
    if (!RUNS.has(key)) RUNS.set(key, wavefrontRun(world, CAM, { spp: SPP, budget, nee, seed: 3 }))
    return RUNS.get(key)
}
export const meanOf = img => img.reduce((a, b) => a + b, 0) / img.length

/* ONE ITERATION'S KERNELS, in ShadyTracer's order (raytrace_main.js R.trace) */
export const KERNELS = [
    ['prep_march', 'reads how many rays wait in the buffer being read, and writes the march\'s workgroup count'],
    ['march', 'each waiting ray takes up to 32 steps: one that reaches a surface or leaves goes on the shade queue, one still on its way to the other buffer'],
    ['prep_shade', 'reads the shade queue\'s count, and writes the workgroup count for surface and shade'],
    ['surface', 'each hit: what the scene says about it, its material and normal, written beside it in the queue'],
    ['shade', 'each hit: the light it found, a shadow ray onto the shadow queue\'s write side, the next leg onto the other ray buffer'],
    ['prep_occlude', 'reads the shadow queue\'s read side, and writes occlusion\'s workgroup count'],
    ['occlude', 'the shadow rays shade queued in the iteration before: blocked, or their light added'],
    ['flip', 'the buffers swap roles; the counts of the side the next iteration writes are cleared'],
]

export const figures = {
    log: {
        aspect: 1.75,
        world: { x: [0, 1], y: [0, 1] },
        state: { budget: WORST, nee: true, tail: false },
        controls: [
            { type: 'slider', key: 'budget', label: 'iterations', min: 2, max: 30, step: 1, fmt: v => v === WORST ? `${v}, the worst case` : String(v) },
            { type: 'toggle', key: 'nee', label: 'Shadow rays (NEE)' },
        ],
        steps: { sample: { budget: WORST, nee: true, tail: false }, tail: { budget: WORST, nee: true, tail: true }, short: { budget: 8, nee: true, tail: false }, tiny: { budget: 4, nee: true, tail: false } },
        draw(pen, s) {
            const { W, H } = pen.view, r = run(s.budget, s.nee), n = r.iters.length, { ctx } = pen
            const rect = { x: W * 0.08, y: H * 0.1, w: W * 0.88, h: H * 0.58 }, top = Math.max(...r.iters.map(l => Math.max(l.marched, l.shadowsTraced))) * 1.08
            // the drained tail, shaded behind the bars: the iterations after the bounce cap's (11), fewer and fewer rays
            if (s.tail && n > 11) {
                const X = v => rect.x + (v - 0.4) / (n + 0.2) * rect.w
                ctx.save(); ctx.fillStyle = pen.col('accent'); ctx.globalAlpha = 0.1; ctx.fillRect(X(11.5), rect.y, X(n + 0.5) - X(11.5), rect.h); ctx.restore()
                pen.labelPx(X(11.5) + 6, rect.y + rect.h * 0.35, 'the drained tail: still dispatched', { role: 'accent', size: 12 })
            }
            const at = (k, o) => [k + 1 + o, 0]
            plot(pen, rect, {
                x: [0.4, n + 0.6], y: [0, top], xticks: Array.from({ length: n }, (_, k) => k + 1).filter(k => n <= 16 || k % 2 === 1 || k === n), fmt: v => String(Math.round(v)),
                hoverX: v => `iteration ${Math.round(v)}`, hoverY: v => String(Math.round(v)),
                series: [
                    { name: 'rays marched', kind: 'bars', role: 'cam', barWidth: 0.26, pts: r.iters.map((l, k) => [k + 1 - 0.27, l.marched]) },
                    { name: 'hits shaded', kind: 'bars', role: 'light', barWidth: 0.26, pts: r.iters.map((l, k) => [k + 1, l.hits + l.escaped]) },
                    { name: 'shadow rays traced', kind: 'bars', role: 'shadow', barWidth: 0.26, pts: r.iters.map((l, k) => [k + 1 + 0.27, l.shadowsTraced]) },
                    { name: 'still marching after it', kind: 'dots', role: 'ink', pts: r.iters.map((l, k) => [k + 1, l.onward]) },
                ],
            })
            const last = r.iters[n - 1]
            if (last.flushed || last.cut) pen.labelPx(rect.x + rect.w, rect.y + 6, `the last pass: ${last.flushed} flushed, ${last.cut ?? 0} shaded and cut`, { role: 'blocked', size: 12, align: 'right', base: 'top' })
            pen.labelPx(rect.x, rect.y - 16, `rays, iteration by iteration: one sample, ${r.paths.length} paths`, { role: 'soft', size: 11 })
            pen.labelPx(rect.x + rect.w, rect.y + rect.h + 22, 'iteration', { role: 'soft', size: 11, align: 'right', base: 'top' })
            // the picture itself, one exposure for every budget (the worst case's brightest pixel at white)
            const full = run(0, true), k = 1 / Math.max(...full.img), sy = H * 0.8, sh = H * 0.05
            pen.image(rect.x, sy, rect.w, sh, CAM.pixels, 1, i => { const v = k * r.img[i]; return [v, v, v] })
            pen.labelPx(rect.x, sy - 4, `the picture: its ${CAM.pixels} pixels, the eye's view from the left of the room, at one exposure for every setting`, { role: 'soft', size: 10, base: 'bottom' })
            // the key
            ;[['rays marched', 'cam'], ['hits shaded', 'light'], ['shadow rays traced', 'shadow'], ['still marching (dots)', 'ink']].forEach(([t, role], k) => {
                const kx = rect.x + k * W * 0.2, ky = H * 0.94
                ctx.save(); ctx.fillStyle = pen.col(role); ctx.globalAlpha = 0.75; ctx.fillRect(kx, ky - 5, 12, 10); ctx.restore()
                pen.labelPx(kx + 17, ky, t, { role: 'soft', size: 11, base: 'middle' })
            })
        },
        readout(s) {
            const r = run(s.budget, s.nee), full = run(0, s.nee), used = r.iters.filter(l => l.marched > 0).length
            const worst = r.budget === r.worst
            return `${r.budget} iterations${worst ? ' (the worst case: (10 + 1) + ⌈400 / 32⌉)' : ''} · rays in ${used} of them · ${r.flushed} flushed and ${r.iters[r.iters.length - 1].cut ?? 0} cut on the last pass · the picture's mean ${meanOf(r.img).toFixed(4)}${worst ? '' : `, against ${meanOf(full.img).toFixed(4)} at the worst case`}`
        },
    },

    queues: {
        aspect: 1.6,
        world: { x: [0, 1], y: [0, 1] },
        state: { it: 1, k: 1 },
        controls: [
            { type: 'slider', key: 'it', label: 'iteration', min: 1, max: 24, step: 1, fmt: v => String(v) },
            { type: 'button', label: 'Next kernel', act: s => { s.k++; if (s.k >= KERNELS.length) { s.k = 0; s.it = s.it % 24 + 1 } } },
        ],
        steps: { march: { it: 1, k: 1 }, prep: { it: 1, k: 2 }, shade: { it: 1, k: 4 }, flip: { it: 1, k: 7 }, occlude: { it: 2, k: 6 }, tail: { it: 15, k: 1 } },
        draw(pen, s) {
            const { W, H } = pen.view, r = run(), l = r.iters[s.it - 1], k = s.k, { ctx } = pen
            const readSide = (s.it - 1) % 2, writeSide = 1 - readSide
            // the boxes
            const box = (x, y, w, h, title, count, role, active) => {
                ctx.save(); ctx.strokeStyle = pen.col(active ? 'accent' : 'ink'); ctx.lineWidth = active ? 2.2 : 1; ctx.strokeRect(x, y, w, h)
                if (active) { ctx.fillStyle = pen.col('accent'); ctx.globalAlpha = 0.08; ctx.fillRect(x, y, w, h) }
                ctx.restore()
                pen.labelPx(x + 8, y + 16, title, { role: 'ink', size: 12, base: 'middle' })
                if (count != null) pen.labelPx(x + 8, y + h - 14, count, { role, size: 13, base: 'middle' })
            }
            const bw = W * 0.24, bh = H * 0.15
            const P = {
                read: [W * 0.04, H * 0.18], shadeQ: [W * 0.38, H * 0.18], write: [W * 0.72, H * 0.18],
                sRead: [W * 0.04, H * 0.52], sWrite: [W * 0.72, H * 0.52], args: [W * 0.38, H * 0.52],
            }
            const inA = k === 1 || k === 0 || k === 7, toQ = k === 1 || k === 2 || k === 3 || k === 4 || k === 7, toB = k === 1 || k === 4, sR = k === 5 || k === 6 || k === 7, sW = k === 4, args = k === 0 || k === 2 || k === 5
            const afterMarch = k >= 2, afterShade = k >= 5, flipped = k === 7
            box(...P.read, bw, bh, `rays ${readSide}: read`, flipped ? 'cleared: written next' : k < 2 ? `${l.marched} waiting` : `${l.marched} read`, 'cam', inA)
            box(...P.shadeQ, bw, bh, 'shade queue', flipped ? 'cleared' : afterMarch || k === 1 ? `${l.hits + l.escaped} hits and escapes` : '0', 'light', toQ)
            box(...P.write, bw, bh, `rays ${writeSide}: written`, k < 1 ? '0' : k < 4 ? `${l.onward} still marching` : `${l.onward} + ${l.newLegs} new legs`, 'cam', toB)
            box(...P.sRead, bw, bh, `shadow ${readSide}: read`, flipped ? 'cleared: written next' : `${l.shadowsTraced} from the iteration before`, 'shadow', sR)
            box(...P.sWrite, bw, bh, `shadow ${writeSide}: written`, afterShade || k === 4 ? `${l.shadowsQueued} queued` : '0', 'shadow', sW)
            // the sizes the prep kernels have written so far this iteration, workgroups of 64: the one being written or read strong
            const g = n => Math.ceil(n / 64), sizes = [['march', g(l.marched), 0], ['shade', g(l.hits + l.escaped), 2], ['occlude', g(l.shadowsTraced), 5]].filter(([, , at]) => k >= at)
            box(W * 0.35, P.args[1], W * 0.33, bh, 'dispatch sizes (groups of 64)', sizes.map(([nm, v]) => `${nm} ${v}`).join(' · ') || '(none yet)', 'accent', args || k === 1 || k === 3 || k === 4 || k === 6)
            // the kernel and what it does
            pen.labelPx(W * 0.04, H * 0.06, `iteration ${s.it} of ${r.budget}, kernel ${k + 1} of 8: ${KERNELS[k][0]}`, { role: 'accent', size: 14, base: 'middle' })
            // what the kernel does, in lines that fit
            const words = KERNELS[k][1].split(' '), lines = ['']
            ctx.save(); ctx.font = `500 12px ${pen.theme.fonts.hand}`
            for (const wd of words) { const t = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${wd}` : wd; if (ctx.measureText(t).width > W * 0.88 && lines[lines.length - 1]) lines.push(wd); else lines[lines.length - 1] = t }
            ctx.restore()
            lines.forEach((t, j) => pen.labelPx(W * 0.04, H * 0.77 + j * 17, t, { role: 'ink', size: 12, base: 'middle' }))
            if (flipped) pen.labelPx(W * 0.04, H * 0.77 + lines.length * 17, `next iteration: rays ${writeSide} is read, rays ${readSide} written; the shadow queue the same`, { role: 'soft', size: 12, base: 'middle' })
            // the kernels as a strip along the bottom, two rows of four
            KERNELS.forEach(([name], j) => {
                const x = W * (0.04 + (j % 4) * 0.235), y = H * (0.9 + Math.floor(j / 4) * 0.055)
                if (j === k) { ctx.save(); ctx.fillStyle = pen.col('accent'); ctx.globalAlpha = 0.12; ctx.fillRect(x - 6, y - 10, W * 0.22, 20); ctx.restore() }
                pen.labelPx(x, y, `${j + 1} ${name}`, { role: j === k ? 'accent' : 'soft', size: 11, base: 'middle' })
            })
        },
        readout(s) {
            const l = run().iters[s.it - 1]
            return `iteration ${s.it}: ${l.marched} rays marched: ${l.hits} reached a surface, ${l.escaped} left the room, ${l.outOfSteps} ran out of steps, ${l.onward} still on their way · ${l.newLegs} new legs · ${l.shadowsTraced} shadow rays traced, ${l.shadowsQueued} queued`
        },
    },

    lanes: {
        aspect: 1.75,
        world: { x: [0, 1], y: [0, 1] },
        state: { cost: 20, width: 32 },
        controls: [
            { type: 'slider', key: 'cost', label: 'one shading, in march steps', min: 1, max: 80, step: 1, fmt: v => String(v) },
            { type: 'seg', key: 'width', label: 'lanes in step', options: [[16, '16'], [32, '32'], [64, '64']] },
        ],
        steps: { model: { cost: 20, width: 32 }, cheap: { cost: 1, width: 32 }, dear: { cost: 80, width: 32 } },
        draw(pen, s) {
            const { W, H } = pen.view, r = run(), t = laneTimes(r, s.width, s.cost)
            const rect = { x: W * 0.22, y: H * 0.14, w: W * 0.72, h: H * 0.6 }, top = Math.max(t.mega.time, t.wave.time) * 1.05
            const rows = [['one big kernel', t.mega, 0.72], ['wavefront', t.wave, 0.28]]
            plot(pen, rect, {
                x: [0, top], y: [0, 1], yticks: [], fmt: v => `${(v / 1e6).toFixed(1)} M`,
                hover: false, series: [],
            })
            const { ctx } = pen, X = v => rect.x + v / top * rect.w
            for (const [name, m, y] of rows) {
                const yy = rect.y + rect.h * (1 - y) - 18, h = 36
                ctx.save()
                ctx.fillStyle = pen.col('cam'); ctx.globalAlpha = 0.75; ctx.fillRect(X(0), yy, X(m.busy) - X(0), h)
                ctx.fillStyle = pen.col('soft'); ctx.globalAlpha = 0.3; ctx.fillRect(X(m.busy), yy, X(m.time) - X(m.busy), h)
                ctx.restore()
                pen.labelPx(rect.x - 8, yy + h / 2, name, { role: 'ink', size: 12, align: 'right', base: 'middle' })
                pen.labelPx(X(m.time) + 6 > rect.x + rect.w - 80 ? X(m.time) - 6 : X(m.time) + 6, yy + h / 2, `${(100 * m.busy / m.time).toFixed(0)}% busy`, { role: 'ink', size: 12, align: X(m.time) + 6 > rect.x + rect.w - 80 ? 'right' : 'left', base: 'middle' })
            }
            pen.labelPx(rect.x, rect.y - 16, `lane-steps to trace the sample's ${r.paths.length} paths: busy (blue) and waiting (grey)`, { role: 'soft', size: 11 })
            pen.labelPx(rect.x + rect.w, rect.y + rect.h + 22, 'lane-time, in march steps (a model, not a measurement)', { role: 'soft', size: 11, align: 'right', base: 'top' })
        },
        readout(s) {
            const t = laneTimes(run(), s.width, s.cost)
            return `a shading worth ${s.cost} march steps, ${s.width} lanes in step · one big kernel ${(t.mega.time / 1e6).toFixed(2)} M lane-steps, ${(100 * t.mega.busy / t.mega.time).toFixed(0)}% busy · wavefront ${(t.wave.time / 1e6).toFixed(2)} M, ${(100 * t.wave.busy / t.wave.time).toFixed(0)}% busy · ${(t.mega.time / t.wave.time).toFixed(2)} times as long`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
