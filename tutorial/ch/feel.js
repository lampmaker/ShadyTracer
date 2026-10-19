//======================================================================================================================
// CHAPTER "Feeling fast": its figures.
//
//   governor  how many samples a frame traces: lib/render-loop.js's rule (mirrored in kit/feel.js, held to the real one
//             by the test) against the one its comment says it replaced, on frames of a model's cost
//   move      a drag, frame by frame: the real interaction.js deciding "moving", the real quality.js choosing the mode
//   slices    a heavy sample cut across frames, and a heavy frame cut into submissions: R.trace's rules, their
//             constants copied
//   flight    offscreen samples one in flight or two: samples.js runSamples' rule on a clock
//======================================================================================================================

import { boot } from '../kit/page.js'
import * as F from '../kit/feel.js'
import { MODE } from '../../lib/pathtracer/quality.js'

const MODE_NAME = { [MODE.FULL]: 'full', [MODE.DRAFT]: 'Draft', [MODE.SKETCH]: 'Sketch' }
const RES = { 640: [640, 360], 1280: [1280, 720], 1920: [1920, 1080] }
export const sampleOf = lv => Math.round(10 ** lv)

export const figures = {
    governor: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { rule: 'now', ms: 20 },
        controls: [
            { type: 'seg', key: 'rule', options: [['now', 'Today: ±3%, 18 to 23 fps'], ['before', 'Before: ±0.1, 19 to 21 fps']] },
            { type: 'slider', key: 'ms', label: 'a sample takes', min: 2, max: 80, step: 1, fmt: v => `${v} ms` },
        ],
        steps: { now: { rule: 'now', ms: 20 }, light: { rule: 'now', ms: 5 }, before: { rule: 'before', ms: 20 }, zero: { rule: 'before', ms: 60 } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen, g = F.governor({ sampleMs: s.ms, rule: s.rule, frames: 160 })
            const top = Math.max(4, ...g.map(f => f.spp)) + 1, r1 = { x: W * 0.09, y: H * 0.1, w: W * 0.88, h: H * 0.36 }, r2 = { x: W * 0.09, y: H * 0.56, w: W * 0.88, h: H * 0.32 }
            const X = k => r1.x + r1.w * k / (g.length - 1)
            for (const r of [r1, r2]) { ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke(); ctx.restore() }
            // samples a frame: the count and what the frame traced
            const Y1 = v => r1.y + r1.h * (1 - v / top)
            ctx.save(); ctx.strokeStyle = pen.col('soft'); ctx.lineWidth = 1; ctx.beginPath(); g.forEach((f, k) => k ? ctx.lineTo(X(k), Y1(f.count)) : ctx.moveTo(X(k), Y1(f.count))); ctx.stroke()
            ctx.strokeStyle = pen.col('cam'); ctx.lineWidth = 2; ctx.beginPath(); g.forEach((f, k) => k ? ctx.lineTo(X(k), Y1(f.spp)) : ctx.moveTo(X(k), Y1(f.spp))); ctx.stroke(); ctx.restore()
            // a frame that traced no sample at all: a red dot on the floor
            ctx.save(); ctx.fillStyle = pen.col('blocked')
            g.forEach((f, k) => { if (f.spp === 0) { ctx.beginPath(); ctx.arc(X(k), Y1(0), 3, 0, 7); ctx.fill() } })
            ctx.restore()
            pen.labelPx(r1.x, r1.y - 4, 'samples a frame: traced (blue), the count it is the whole part of (grey)', { role: 'soft', size: 11, base: 'bottom' })
            pen.labelPx(r1.x - 6, Y1(top - 1), String(top - 1), { role: 'soft', size: 10, align: 'right', base: 'middle' })
            pen.labelPx(r1.x - 6, Y1(0), '0', { role: 'soft', size: 10, align: 'right', base: 'middle' })
            // frames a second, and the band the rule leaves alone
            const fmax = 70, Y2 = v => r2.y + r2.h * (1 - Math.min(v, fmax) / fmax), lo = s.rule === 'now' ? 18 : 19, hi = s.rule === 'now' ? 23 : 21
            ctx.save(); ctx.fillStyle = pen.col('shadow'); ctx.globalAlpha = 0.18; ctx.fillRect(r2.x, Y2(hi), r2.w, Y2(lo) - Y2(hi)); ctx.restore()
            ctx.save(); ctx.strokeStyle = pen.col('light'); ctx.lineWidth = 2; ctx.beginPath(); g.forEach((f, k) => k ? ctx.lineTo(X(k), Y2(f.fps)) : ctx.moveTo(X(k), Y2(f.fps))); ctx.stroke(); ctx.restore()
            pen.labelPx(r2.x, r2.y - 4, `frames a second (the band: ${lo} to ${hi}, left alone)`, { role: 'soft', size: 11, base: 'bottom' })
            for (const v of [0, 20, 60]) pen.labelPx(r2.x - 6, Y2(v), String(v), { role: 'soft', size: 10, align: 'right', base: 'middle' })
            pen.labelPx(r2.x + r2.w, r2.y + r2.h + 6, `${g.length} frames`, { role: 'soft', size: 10, align: 'right', base: 'top' })
        },
        readout(s) {
            const g = F.governor({ sampleMs: s.ms, rule: s.rule, frames: 160 }), last = g.slice(-20), set = new Set(last.map(f => f.spp)), zero = g.filter(f => f.spp === 0).length
            return `a frame 5 ms plus ${s.ms} ms a sample · the last 20 frames trace ${[...set].sort((a, b) => a - b).join(' or ')} samples${set.size > 1 ? ', hunting' : ', settled'} at ${last.map(f => f.fps.toFixed(1)).filter((v, i, a) => a.indexOf(v) === i).join(' / ')} fps${zero ? ` · ${zero} frames traced no sample at all` : ''}`
        },
    },

    move: {
        aspect: 2.1,
        world: { x: [0, 2.1], y: [0, 1] },
        state: { held: 'held', moveFast: 1, moveMode: MODE.DRAFT },
        controls: [
            { type: 'seg', key: 'held', label: 'a drag that pauses', options: [['held', 'holds while the button is down'], ['free', 'only pokes (no hold)']] },
            { type: 'seg', key: 'moveFast', label: 'fast while moving', options: [[1, 'on'], [0, 'off']] },
            { type: 'seg', key: 'moveMode', label: 'as', options: [[MODE.DRAFT, 'Draft'], [MODE.SKETCH, 'Sketch']] },
        ],
        steps: { drag: { held: 'held', moveFast: 1, moveMode: MODE.DRAFT }, free: { held: 'free', moveFast: 1, moveMode: MODE.DRAFT }, off: { held: 'held', moveFast: 0, moveMode: MODE.DRAFT } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen, d = F.dragTimeline({ held: s.held === 'held', moveFast: s.moveFast, moveMode: s.moveMode }), end = d[d.length - 1].t
            const x0 = W * 0.16, x1 = W * 0.97, X = t => x0 + (x1 - x0) * t / end, rows = [['the mouse', 0.2], ['moving?', 0.42], ['traced as', 0.64]]
            rows.forEach(([name, y]) => pen.labelPx(x0 - 8, H * y + 10, name, { role: 'ink', size: 11, align: 'right', base: 'middle' }))
            d.forEach((f, k) => {
                const x = X(f.t), w = Math.max(1, X(f.t + 16) - x)
                ctx.save()
                if (f.dragging) { ctx.fillStyle = pen.col('accent'); ctx.globalAlpha = 0.7; ctx.fillRect(x, H * 0.2, w, 20) }
                else if (f.t >= 300 && f.t <= 1700) { ctx.fillStyle = pen.col('accent'); ctx.globalAlpha = 0.2; ctx.fillRect(x, H * 0.2, w, 20) }
                if (f.moving) { ctx.fillStyle = pen.col('cam'); ctx.globalAlpha = 0.6; ctx.fillRect(x, H * 0.42, w, 20) }
                ctx.fillStyle = pen.col(f.mode === MODE.FULL ? 'light' : f.mode === MODE.DRAFT ? 'shadow' : 'glass'); ctx.globalAlpha = 0.7; ctx.fillRect(x, H * 0.64, w, 20)
                ctx.restore()
            })
            // the mode's name where it changes
            d.forEach((f, k) => { if (!k || f.mode !== d[k - 1].mode) pen.labelPx(X(f.t) + 3, H * 0.64 + 24, MODE_NAME[f.mode], { role: 'ink', size: 11, base: 'top' }) })
            pen.labelPx(X(300), H * 0.2 - 4, 'button down', { role: 'accent', size: 10, base: 'bottom' })
            pen.labelPx(X(700), H * 0.2 - 4, 'still, button held', { role: 'accent', size: 10, base: 'bottom' })
            pen.labelPx(X(1700), H * 0.2 - 4, 'let go', { role: 'accent', size: 10, base: 'bottom' })
            for (let t = 0; t <= end; t += 400) pen.labelPx(X(t), H * 0.9, `${(t / 1000).toFixed(1)} s`, { role: 'soft', size: 10, align: 'center', base: 'top' })
        },
        readout(s) {
            const d = F.dragTimeline({ held: s.held === 'held', moveFast: s.moveFast, moveMode: s.moveMode }), ch = []
            d.forEach((f, k) => { if (k && f.mode !== d[k - 1].mode) ch.push(`${MODE_NAME[f.mode]} at ${(f.t / 1000).toFixed(2)} s`) })
            return ch.length ? `the picture switches: ${ch.join(', ')} · the drag ran 0.30 to 1.70 s, still from 0.70 to 1.30` : 'the picture stays full throughout: fast while moving is off'
        },
    },

    slices: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { lv: 3, res: 1280 },
        controls: [
            { type: 'slider', key: 'lv', label: 'a sample takes', min: 1, max: 4.3, step: 0.05, fmt: v => { const ms = sampleOf(v); return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms` } },
            { type: 'seg', key: 'res', label: 'picture', options: Object.keys(RES).map(k => [+k, RES[k].join(' × ')]) },
        ],
        steps: { light: { lv: Math.log10(20), res: 1280 }, heavy: { lv: 3, res: 1280 }, floor: { lv: 4, res: 1280 }, split: { lv: 4, res: 640 } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen, [w, h] = RES[s.res], ms = sampleOf(s.lv), P = F.slicing({ sampleMs: ms, px: w * h })
            const r = { x: W * 0.06, y: H * 0.2, w: W * 0.9, h: H * 0.5 }, shown = Math.min(P.frames, 60), fw = r.w / Math.max(shown, 1), top = Math.max(P.frameMs, 60)
            pen.labelPx(r.x, 8, `one sample of ${ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms'} at ${w} × ${h}, in ${P.K} batch${P.K > 1 ? 'es' : ''}: ${P.frames} frame${P.frames > 1 ? 's' : ''} of ${P.frameMs.toFixed(0)} ms${P.frames > shown ? ` (the first ${shown} drawn)` : ''}`, { role: 'ink', size: 12, base: 'top' })
            const Y = v => r.y + r.h * (1 - v / top)
            ctx.save(); ctx.strokeStyle = pen.col('soft'); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(r.x, Y(30)); ctx.lineTo(r.x + r.w, Y(30)); ctx.stroke(); ctx.restore()
            pen.labelPx(r.x + r.w, Y(30) - 3, 'the slice asked for: 30 ms', { role: 'soft', size: 10, align: 'right', base: 'bottom' })
            for (let k = 0; k < shown; k++) {
                const x = r.x + k * fw
                ctx.save(); ctx.fillStyle = pen.col(P.frameMs > 2000 ? 'blocked' : 'cam'); ctx.globalAlpha = 0.7; ctx.fillRect(x + fw * 0.1, Y(P.frameMs), fw * 0.8, Y(0) - Y(P.frameMs)); ctx.restore()
                // the frame's submissions: a tick at each cut
                if (P.submissions > 1) for (let j = 1; j < P.submissions; j++) { const yy = Y(P.frameMs * j / P.submissions); ctx.save(); ctx.strokeStyle = pen.col('paper'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + fw * 0.1, yy); ctx.lineTo(x + fw * 0.9, yy); ctx.stroke(); ctx.restore() }
            }
            pen.labelPx(r.x, r.y + r.h + 8, P.sliced ? `batches of at least ${F.SLICE_MIN_RAYS.toLocaleString('en-US')} rays: no more than ${Math.ceil(w * h / F.SLICE_MIN_RAYS)} at this size` : 'fits in a frame: not cut', { role: 'soft', size: 11, base: 'top' })
            pen.labelPx(r.x, r.y + r.h + 24, P.submissions > 1 ? `each frame cut into ${P.submissions} submissions of ${P.splitEvery} iterations, about ${(P.frameMs / P.submissions).toFixed(0)} ms each (white lines),` : 'each frame one submission (under 250 ms: not cut)', { role: 'soft', size: 11, base: 'top' })
            if (P.submissions > 1) pen.labelPx(r.x, r.y + r.h + 40, 'none near the 2 s after which Windows resets the card', { role: 'soft', size: 11, base: 'top' })
            pen.labelPx(r.x - 4, Y(top), `${top.toFixed(0)} ms`, { role: 'soft', size: 10, base: 'bottom' })
        },
        readout(s) {
            const [w, h] = RES[s.res], ms = sampleOf(s.lv), P = F.slicing({ sampleMs: ms, px: w * h })
            return `${P.K} batch${P.K > 1 ? 'es' : ''} (asked ${Math.ceil(ms / 30)}, at most ${Math.min(F.SLICE_MAX, Math.ceil(w * h / F.SLICE_MIN_RAYS))}) · ${P.frames} frame${P.frames > 1 ? 's' : ''} of ${P.frameMs.toFixed(0)} ms, ${(1000 / P.frameMs).toFixed(1)} a second · ${P.submissions} submission${P.submissions > 1 ? 's' : ''} a frame`
        },
    },

    flight: {
        aspect: 2.1,
        world: { x: [0, 2.1], y: [0, 1] },
        state: { depth: 1, cpu: 12, gpu: 40 },
        controls: [
            { type: 'seg', key: 'depth', label: 'samples in flight', options: [[1, 'one'], [2, 'two']] },
            { type: 'slider', key: 'cpu', label: 'recording a sample', min: 2, max: 60, step: 1, fmt: v => `${v} ms` },
            { type: 'slider', key: 'gpu', label: 'the card running it', min: 5, max: 120, step: 1, fmt: v => `${v} ms` },
        ],
        steps: { one: { depth: 1, cpu: 12, gpu: 40 }, two: { depth: 2, cpu: 12, gpu: 40 } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen, R = F.inFlight(6, { cpuMs: s.cpu, gpuMs: s.gpu, depth: s.depth }), one = F.inFlight(6, { cpuMs: s.cpu, gpuMs: s.gpu, depth: 1 })
            const end = Math.max(one.ms, R.ms), x0 = W * 0.16, x1 = W * 0.97, X = t => x0 + (x1 - x0) * t / end
            for (const [name, list, y, role] of [['the main thread', R.cpu, 0.28, 'accent'], ['the card', R.gpu, 0.5, 'cam']]) {
                pen.labelPx(x0 - 8, H * y + 12, name, { role: 'ink', size: 11, align: 'right', base: 'middle' })
                list.forEach(([a, b], i) => { ctx.save(); ctx.fillStyle = pen.col(role); ctx.globalAlpha = 0.75; ctx.fillRect(X(a) + 1, H * y, Math.max(1, X(b) - X(a) - 2), 24); ctx.restore(); pen.labelPx((X(a) + X(b)) / 2, H * y + 12, String(i + 1), { role: 'paper', size: 10, align: 'center', base: 'middle' }) })
            }
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X(R.ms), H * 0.2); ctx.lineTo(X(R.ms), H * 0.72); ctx.stroke(); ctx.restore()
            pen.labelPx(X(R.ms), H * 0.74, `all six done at ${R.ms} ms`, { role: 'ink', size: 11, align: 'right', base: 'top' })
            pen.labelPx(x0, H * 0.08, 'six samples offscreen (a saved picture): recording each on the main thread, then the card running it', { role: 'soft', size: 11, base: 'top' })
        },
        readout(s) {
            const one = F.inFlight(6, { cpuMs: s.cpu, gpuMs: s.gpu, depth: 1 }), two = F.inFlight(6, { cpuMs: s.cpu, gpuMs: s.gpu, depth: 2 })
            return `one in flight ${one.ms} ms, two ${two.ms} ms: ${Math.round(100 * (1 - two.ms / one.ms))}% less · a sample one at a time is ${s.cpu} + ${s.gpu} ms; two at a time, about the larger of the two`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
