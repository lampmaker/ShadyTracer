//======================================================================================================================
// CHAPTER "Faster compiles": its figures.
//
//   build    one scene's kernels compiled three ways: blocking the page, off its thread one after another, all at once
//            -- the user's measured times for six scenes (kit/compiles.js BUILDS, docs/PERFORMANCE_REVIEW.md §10.3)
//   session  what compiles as someone works: a value moved, a shape added, another scene, back again, an undo; with
//            the kernels that hold no scene and the pipeline cache, or without either; each build's time predicted by
//            the engine's own compileprogress.js from a model's kernel sizes
//   bar      a build's progress as a count of kernels ready, against the bar by the clock (compileprogress.js
//            compileFraction, compileLabel); and the rate a machine learns over its builds (learnRate)
//======================================================================================================================

import { boot } from '../kit/page.js'
import * as K from '../kit/compiles.js'
import { compileFraction, compileLabel, kernelMs, DEFAULT_RATE } from '../../lib/pathtracer/core/compileprogress.js'

const HOW = { blocking: 'Blocking the page', turn: 'Off the thread, one at a time', once: 'Off the thread, all at once' }
const ROLE = { shade: 'light', occlude: 'shadow', march: 'cam', 'ten small kernels': 'glass' }
const sec = v => `${v.toFixed(1)} s`

/** the bar's build: predicted `expectS`, really taking `factor` times that; returns the two bars' curves over time */
export function barCurves(expectS, factor, n = 120) {
    const total = expectS * factor * 1000, ready = K.readyTimes(total), end = Math.max(total, expectS * 1000) * 1.25, pts = { count: [], clock: [] }
    for (let k = 0; k <= n; k++) {
        const t = end * k / n
        pts.count.push([t / 1000, K.countBar(t, ready)])
        pts.clock.push([t / 1000, t >= total ? 1 : compileFraction(t, expectS * 1000)])
    }
    return { ...pts, total: total / 1000, end: end / 1000, ready }
}
/** the learning steps the figure plays: four builds, a reload the browser's cache answers, three more */
export const LEARN_STEPS = [{}, {}, {}, {}, { cacheHit: true }, {}, {}, {}]

export const figures = {
    build: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { scene: 0, how: 'blocking' },
        controls: [
            { type: 'seg', key: 'how', options: Object.entries(HOW) },
            { type: 'seg', key: 'scene', label: 'scene', options: K.BUILDS.map((b, i) => [i, b.scene]) },
        ],
        steps: { blocking: { scene: 0, how: 'blocking' }, turn: { scene: 0, how: 'turn' }, once: { scene: 0, how: 'once' }, scenes: { scene: 5, how: 'once' } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen, b = K.BUILDS[s.scene], L = K.layout(b, s.how), span = 14
            const x0 = W * 0.24, x1 = W * 0.96, X = t => x0 + (x1 - x0) * t / span, rowH = H * 0.11, top = H * 0.16
            pen.labelPx(x0, 6, `${b.scene}: compiling its 13 kernels (the user's Pascal card, 0.9.2, measured)`, { role: 'soft', size: 11, base: 'top' })
            // the page's own thread: painting, or frozen
            const py = top
            pen.labelPx(x0 - 8, py + rowH / 2, 'the page', { role: 'ink', size: 11, align: 'right', base: 'middle' })
            ctx.save(); ctx.fillStyle = pen.col(L.frozen ? 'blocked' : 'shadow'); ctx.globalAlpha = 0.25
            ctx.fillRect(X(0), py + rowH * 0.15, X(L.frozen || L.ready) - X(0), rowH * 0.7); ctx.restore()
            if (!L.frozen) for (let t = 0; t < L.ready; t += 0.25) { ctx.save(); ctx.strokeStyle = pen.col('shadow'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(t), py + rowH * 0.2); ctx.lineTo(X(t), py + rowH * 0.8); ctx.stroke(); ctx.restore() }
            pen.labelPx(X(0), py - 2, L.frozen ? `frozen ${sec(L.frozen)}: no frame drawn, no click answered` : 'painting all along (a tick every quarter second)', { role: L.frozen ? 'blocked' : 'ink', size: 11, base: 'bottom' })
            // each kernel's compile
            L.bars.forEach((bar, i) => {
                const y = top + (i + 1.4) * rowH
                pen.labelPx(x0 - 8, y + rowH / 2, bar.name, { role: ROLE[bar.name], size: 11, align: 'right', base: 'middle', kind: 'mono' })
                ctx.save(); ctx.fillStyle = pen.col(ROLE[bar.name]); ctx.globalAlpha = 0.75; ctx.fillRect(X(bar.from), y + rowH * 0.2, Math.max(2, X(bar.to) - X(bar.from)), rowH * 0.6); ctx.restore()
                pen.labelPx(X(bar.to) + 5, y + rowH / 2, sec(bar.to - bar.from), { role: 'soft', size: 10, base: 'middle', kind: 'mono' })
            })
            // the build ready
            const ry = top + 5.6 * rowH
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X(L.ready), top); ctx.lineTo(X(L.ready), ry); ctx.stroke(); ctx.restore()
            pen.labelPx(X(L.ready), ry + 4, `ready at ${sec(L.ready)}${s.how === 'once' ? ' (measured: shade alone took ' + sec(b.shade) + ')' : ''}`, { role: 'ink', size: 12, align: L.ready > 9 ? 'right' : 'left', base: 'top' })
            for (let t = 0; t <= span; t += 2) pen.labelPx(X(t), H * 0.92, `${t} s`, { role: 'soft', size: 10, align: 'center', base: 'top' })
        },
        readout(s) {
            const b = K.BUILDS[s.scene]
            return `${b.scene}: one at a time ${sec(b.seq)}, all at once ${sec(b.all)} (${Math.round(100 * (1 - b.all / b.seq))}% less) · shade alone ${sec(b.shade)}, ${Math.round(100 * b.shade / b.seq)}% of one at a time · ${s.how === 'blocking' ? 'the page frozen for the whole build' : 'the page painting throughout'}`
        },
    },

    session: {
        aspect: 1.7,
        world: { x: [0, 1.7], y: [0, 1] },
        state: { at: 0, cache: 'on', free: 'on' },
        controls: [
            { type: 'button', label: 'Next step', act: s => { s.at = (s.at + 1) % K.SESSION.length } },
            { type: 'seg', key: 'free', label: 'kernels that hold no scene', options: [['on', 'declare the base uniforms only'], ['off', 'declare the scene\'s too (before 0.10.0)']] },
            { type: 'seg', key: 'cache', label: 'pipeline cache', options: [['on', 'on'], ['off', 'off']] },
        ],
        steps: { open: { at: 0, cache: 'on', free: 'on' }, add: { at: 2, cache: 'on', free: 'on' }, back: { at: 4, cache: 'on', free: 'on' },
            nocache: { at: 5, cache: 'off', free: 'on' }, before: { at: 5, cache: 'off', free: 'off' } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen, play = K.playSession(K.SESSION, { cache: s.cache === 'on', free: s.free === 'on' }), names = Object.keys({ ...K.FREE, ...K.sceneKernels(0) })
            const x0 = W * 0.27, cw = (W * 0.98 - x0) / K.SESSION.length, top = H * 0.17, rh = (H * 0.66) / names.length
            pen.labelPx(8, 6, 'each step of a session (columns), each kernel (rows): compiled, from the cache, or nothing to do', { role: 'soft', size: 11, base: 'top' })
            K.SESSION.forEach((st, j) => {
                const x = x0 + j * cw, on = j === s.at, p = play[j]
                ctx.save(); ctx.fillStyle = pen.col('accent'); ctx.globalAlpha = on ? 0.1 : 0; ctx.fillRect(x, top - 30, cw, H * 0.9 - top + 30); ctx.restore()
                pen.labelPx(x + cw / 2, top - 26, st.short, { role: on ? 'ink' : 'soft', size: 11, align: 'center', base: 'top' })
                const later = j > s.at                    // a step not reached yet: drawn faint
                names.forEach((n, i) => {
                    const y = top + i * rh, c = !later && p.compiled.includes(n), h = !later && p.cached.includes(n)
                    ctx.save(); ctx.fillStyle = pen.col(c ? (K.HOLDS.includes(n) ? 'blocked' : 'light') : h ? 'cam' : 'faint'); ctx.globalAlpha = c ? 0.8 : h ? 0.4 : 0.12
                    ctx.fillRect(x + 4, y + 1, cw - 8, rh - 2); ctx.restore()
                })
                if (!later) pen.labelPx(x + cw / 2, top + names.length * rh + 6, p.value ? 'nothing' : `${(p.ms / 1000).toFixed(1)} s`, { role: on ? 'ink' : 'soft', size: 11, align: 'center', base: 'top', kind: 'mono' })
            })
            names.forEach((n, i) => pen.labelPx(x0 - 6, top + (i + 0.5) * rh, n + (K.HOLDS.includes(n) ? ' (holds the scene)' : ''), { role: K.HOLDS.includes(n) ? 'blocked' : 'ink', size: 9, align: 'right', base: 'middle', kind: 'mono' }))
            pen.labelPx(x0 - 6, top + names.length * rh + 8, 'the build, predicted', { role: 'soft', size: 10, align: 'right', base: 'top' })
        },
        readout(s) {
            const p = K.playSession(K.SESSION, { cache: s.cache === 'on', free: s.free === 'on' })[s.at]
            return `${p.what}: ${p.value ? 'a uniform written, nothing compiled' : `${p.compiled.length} kernels compiled, ${p.cached.length} from the cache · the build predicted ${(p.ms / 1000).toFixed(2)} s (its slowest: ${p.slowest ?? 'none'})`}`
        },
    },

    bar: {
        aspect: 1.75,
        world: { x: [0, 1.75], y: [0, 1] },
        state: { view: 'bar', factor: 1.3, slow: 2 },
        controls: [
            { type: 'seg', key: 'view', options: [['bar', 'The bar'], ['learn', 'Learning the machine']] },
            { type: 'slider', key: 'factor', label: 'the build really takes', min: 0.5, max: 3, step: 0.05, fmt: v => `${v.toFixed(2)} × the prediction`, when: s => s.view === 'bar' },
            { type: 'slider', key: 'slow', label: 'this machine\'s compiles take', min: 0.15, max: 6, step: 0.05, fmt: v => `${v.toFixed(2)} × what the starting rate predicts`, when: s => s.view === 'learn' },
        ],
        steps: { count: { view: 'bar', factor: 1.3 }, clock: { view: 'bar', factor: 2.5 }, learn: { view: 'learn', slow: 2 } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen
            const r = { x: W * 0.1, y: H * 0.14, w: W * 0.85, h: H * 0.66 }
            if (s.view === 'bar') {
                const expectS = 10, C = barCurves(expectS, s.factor), X = t => r.x + r.w * t / C.end, Y = f => r.y + r.h * (1 - f)
                ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke()
                ctx.setLineDash([4, 3]); ctx.strokeStyle = pen.col('soft'); ctx.beginPath(); ctx.moveTo(X(expectS), r.y); ctx.lineTo(X(expectS), r.y + r.h); ctx.moveTo(X(C.total), r.y); ctx.lineTo(X(C.total), r.y + r.h); ctx.stroke(); ctx.restore()
                for (const [key, role, label] of [['count', 'blocked', 'kernels ready of 16 (the old bar)'], ['clock', 'cam', 'by the clock (compileFraction)']]) {
                    ctx.save(); ctx.strokeStyle = pen.col(role); ctx.lineWidth = 2.2; ctx.beginPath()
                    C[key].forEach(([t, f], k) => k ? ctx.lineTo(X(t), Y(f)) : ctx.moveTo(X(t), Y(f))); ctx.stroke(); ctx.restore()
                    pen.labelPx(r.x + r.w * 0.45, key === 'count' ? r.y + r.h * 0.62 : r.y + r.h * 0.62 + 16, label, { role, size: 11, base: 'top' })
                }
                pen.labelPx(X(expectS), r.y + r.h + 4, 'predicted', { role: 'soft', size: 10, align: 'center', base: 'top' })
                pen.labelPx(X(C.total), r.y + r.h + 16, 'really done', { role: 'ink', size: 10, align: 'center', base: 'top' })
                for (const f of [0, 0.5, 0.9, 1]) pen.labelPx(r.x - 6, Y(f), `${Math.round(f * 100)}%`, { role: 'soft', size: 10, align: 'right', base: 'middle' })
                const hp = pen.hover(r)
                if (hp) { const t = (hp.x - r.x) / r.w * C.end; pen.tip(hp.x, hp.y, [`${t.toFixed(1)} s in`, `the old bar: ${Math.round(100 * K.countBar(t * 1000, C.ready))}%`, `the clock's: ${t >= C.total ? 'done' : Math.round(100 * compileFraction(t * 1000, expectS * 1000)) + '%, "' + compileLabel(t * 1000, expectS * 1000) + '"'}`]) }
            } else {
                const rows = K.learning(LEARN_STEPS, { slow: s.slow }), top = Math.max(...rows.flatMap(q => [q.predicted, q.took])) * 1.15 / 1000
                const bw = r.w / rows.length, Y = v => r.y + r.h * (1 - v / top)
                let built = 0
                rows.forEach((q, i) => {
                    const x = r.x + i * bw
                    if (!q.cacheHit) built++
                    ctx.save(); ctx.fillStyle = pen.col('soft'); ctx.globalAlpha = 0.35; ctx.fillRect(x + bw * 0.15, Y(q.predicted / 1000), bw * 0.32, Y(0) - Y(q.predicted / 1000))
                    ctx.fillStyle = pen.col(q.cacheHit ? 'light' : 'cam'); ctx.globalAlpha = 0.8; ctx.fillRect(x + bw * 0.5, Y(q.took / 1000), bw * 0.32, Y(0) - Y(q.took / 1000)); ctx.restore()
                    pen.labelPx(x + bw / 2, r.y + r.h + 4, q.cacheHit ? 'reload' : `build ${built}`, { role: q.cacheHit ? 'light' : 'soft', size: 10, align: 'center', base: 'top' })
                })
                pen.labelPx(r.x, 6, 'grey: the time predicted at the kept rate; blue: the time taken (orange: the browser\'s own cache answered)', { role: 'soft', size: 11, base: 'top' })
                pen.labelPx(r.x - 6, r.y, `${top.toFixed(0)} s`, { role: 'soft', size: 10, align: 'right', base: 'middle' })
            }
        },
        readout(s) {
            if (s.view === 'bar') {
                const C = barCurves(10, s.factor), at = t => Math.round(100 * K.countBar(t * 1000, C.ready))
                return `predicted 10 s, really ${C.total.toFixed(1)} s · the old bar ${at(1)}% after a second and ${at(C.total * 0.9)}% at nine tenths of the build · the clock's ${Math.round(100 * compileFraction(1000, 10000))}% after a second, ${Math.round(100 * compileFraction(C.total * 900, 10000))}% at nine tenths of the build, ${Math.round(100 * compileFraction(Math.max(0, C.total - 0.001) * 1000, 10000))}% just before the end`
            }
            const rows = K.learning(LEARN_STEPS, { slow: s.slow }), last = rows[rows.length - 1]
            return `a machine whose compiles take ${s.slow.toFixed(2)} × what ${(DEFAULT_RATE * 1000).toFixed(1)} ms per 1000 characters predicts · the kept rate after each build: ${rows.map(q => (q.learned * 1000).toFixed(1)).join(', ')} · build 7 predicted ${(last.predicted / 1000).toFixed(1)} s against ${(last.took / 1000).toFixed(1)} s`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
