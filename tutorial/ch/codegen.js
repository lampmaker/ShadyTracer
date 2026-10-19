//======================================================================================================================
// CHAPTER "From scene tree to shader": its figures.
//
//   tree     a flat scene of one group as text three ways (kit/scenegen.js): code with uniforms, baked into
//            constants by the engine's own bake, and as data; drag a shape, change the blend, add a ball, and count the
//            compiles each way asks for
//   inline   how big a kernel is once every call is inlined, by the engine's own wgslgraph.js, and what its compile
//            model (compileprogress.js, fitted on the user's GTX 1080 Ti) predicts from that size
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { codegen, bake, records, textOf, sceneDist, kernelText, PRELUDE } from '../kit/scenegen.js'
import { inlineStats } from '../../lib/pathtracer/core/wgslgraph.js'
import { kernelMs, DEFAULT_RATE, GROWTH, SIZE_REF } from '../../lib/pathtracer/core/compileprogress.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/* THE SCENE: a block, a ball joined to it, a hole cut in it; a second ball to add */
export const START = { b: [0, -0.35], c: [1.15, 0.55], h: [-0.45, 0.05], e: [-1.2, -0.9] }
export function sceneOf(s) {
    const shapes = [
        { id: 'b', kind: 'box', join: 'union', c: s.pos.b, h: [1.2, 0.65] },
        { id: 'c', kind: 'circle', join: 'union', c: s.pos.c, r: 0.6 },
        { id: 'h', kind: 'circle', join: 'subtract', c: s.pos.h, r: 0.35 },
    ]
    if (s.extra) shapes.push({ id: 'e', kind: 'circle', join: 'union', c: s.pos.e, r: 0.45 })
    return { k: s.k, shapes }
}
export const MODES = [['codegen', 'Code with uniforms'], ['baked', 'Baked'], ['data', 'As data']]
/** what the state's change asks of the card, each way counted on its own: the text that way compiles against the one it
 *  compiled last (idempotent: the figure asks it at every draw, and a second asking finds the same text). A way's first
 *  text is its first compile; a way left and come back to with the same text compiles nothing (the browser keeps it). */
export function account(s) {
    const t = textOf(sceneOf(s), s.mode), seen = s.seen ?? {}, w = seen[s.mode]
    if (!w || t !== w.text) { s.seen = { ...seen, [s.mode]: { text: t, prev: w ? w.text : t, n: (w?.n ?? 0) + 1 } }; s.last = 'compiled' }
    else if (s.lastKey !== keyOf(s)) s.last = 'written'
    s.lastKey = keyOf(s)
}
const keyOf = s => JSON.stringify([s.pos, s.k, s.extra, s.mode])
const at = (s, id, x, y) => ({ ...s.pos, [id]: [x, y] })
/* THE STEPS ARE ONE STORY: each the one before it and one thing more, every change accounted as the figure would */
const INIT = { mode: 'codegen', k: 0.3, extra: false, pos: START }
function story(...acts) { let s = { ...INIT }; account(s); for (const a of acts) { s = { ...s, ...a(s) }; account(s) } return s }
const MOVE = s => ({ pos: at(s, 'c', 1.4, -0.35) }), ADD = () => ({ extra: true }), TAKE = () => ({ extra: false })
const MOVE2 = s => ({ pos: at(s, 'c', 1.0, 1.05) }), TO = mode => () => ({ mode })
export const STORY = { codegen: [], move: [MOVE], add: [MOVE, ADD], baked: [MOVE, ADD, TO('baked'), MOVE2], data: [MOVE, ADD, TO('baked'), MOVE2, TO('data'), TAKE, ADD] }
export const storyOf = id => story(...STORY[id])

export const figures = {
    tree: {
        aspect: 1.55,
        world: { x: [-2.6, 9.4], y: [-3.7, 4.5] },
        state: storyOf('codegen'),
        controls: [
            { type: 'seg', key: 'mode', options: MODES },
            { type: 'slider', key: 'k', label: 'the blend k', min: 0, max: 0.8, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'button', label: 'Add a ball', act: s => { s.extra = true }, when: s => !s.extra },
            { type: 'button', label: 'Take it away', act: s => { s.extra = false }, when: s => s.extra },
        ],
        steps: Object.fromEntries(Object.keys(STORY).map(id => [id, storyOf(id)])),
        drag: {
            b: (s, p) => { s.pos = at(s, 'b', clamp(p[0], -1.6, 1.6), clamp(p[1], -1.6, 1.6)) },
            c: (s, p) => { s.pos = at(s, 'c', clamp(p[0], -2.2, 2.2), clamp(p[1], -2.2, 2.2)) },
            h: (s, p) => { s.pos = at(s, 'h', clamp(p[0], -2.2, 2.2), clamp(p[1], -2.2, 2.2)) },
            e: (s, p) => { s.pos = at(s, 'e', clamp(p[0], -2.2, 2.2), clamp(p[1], -2.2, 2.2)) },
        },
        draw(pen, s) {
            account(s)
            const scene = sceneOf(s), { W } = pen.view, { ctx } = pen
            // the scene: inside shaded, by the same distance every text computes
            const x0 = pen.X(-2.4), x1 = pen.X(2.4), y0 = pen.Y(2.4), y1 = pen.Y(-2.4), N = 96
            pen.image(x0, y0, x1 - x0, y1 - y0, N, N, (i, j) => { const gx = -2.4 + 4.8 * (i + 0.5) / N, gy = 2.4 - 4.8 * (j + 0.5) / N; return sceneDist(scene, gx, gy) < 0 ? [0.22, 0.3, 0.45] : [0.86, 0.86, 0.82] })
            for (const sh of scene.shapes) pen.handle(sh.id, sh.c, { role: sh.join === 'subtract' ? 'blocked' : 'cam', label: { b: 'the block', c: 'a ball', h: 'a hole', e: 'another ball' }[sh.id] })
            // the text this mode compiles, the lines new at the last compile marked
            const w = s.seen[s.mode], text = w.text.split('\n'), before = new Set(w.prev.split('\n')), tx = pen.X(2.75), ty = pen.Y(4.3)
            // a line too long for the panel wraps after a comma, its rest indented, so nothing is cut off
            const room = Math.floor((W - tx - 6) / 6.1)
            const wrap = l => { const out = []; let rest = l; while (rest.length > room) { const cut = rest.lastIndexOf(', ', room - 1); if (cut <= 8) break; out.push(rest.slice(0, cut + 1)); rest = '            ' + rest.slice(cut + 2) } out.push(rest); return out }
            pen.labelPx(tx, ty, s.mode === 'data' ? 'the text it compiles (every such scene):' : 'the text it compiles:', { role: 'soft', size: 11 })
            let row = 0
            text.forEach(l => {
                const fresh = w.prev !== w.text && !before.has(l)
                for (const part of wrap(l)) {
                    if (fresh) { ctx.save(); ctx.fillStyle = pen.col('accent'); ctx.globalAlpha = 0.14; ctx.fillRect(tx - 3, ty + 16 + row * 14, W - tx - 4, 14); ctx.restore() }
                    pen.labelPx(tx, ty + 17 + row * 14, part, { role: fresh ? 'accent' : 'ink', size: 10, kind: 'mono' })
                    row++
                }
            })
            let y = ty + 24 + row * 14
            if (s.mode === 'data') {
                pen.labelPx(tx, y, 'its records: kind (0 circle, 1 box), join (0 union, 1 cut), x, y, a, b, k', { role: 'soft', size: 11 }); y += 16
                for (const r of records(scene)) { pen.labelPx(tx, y, r.map((v, i) => i < 2 ? String(v) : v.toFixed(2).padStart(5)).join('  '), { role: 'cam', size: 10, kind: 'mono' }); y += 14 }
            } else if (s.mode === 'codegen') {
                const u = codegen(scene).uniforms
                pen.labelPx(tx, y, `its ${Object.keys(u).length} uniforms (UB, the uniform buffer), written when they change:`, { role: 'soft', size: 11 }); y += 16
                Object.entries(u).forEach(([n, v], i) => pen.labelPx(tx + (i % 2) * 150, y + Math.floor(i / 2) * 14, `${n} ${Array.isArray(v.def) ? v.def.map(x => x.toFixed(2)).join(', ') : v.def.toFixed(2)}`, { role: 'cam', size: 10, kind: 'mono' }))
            }
            // what the last change asked for
            const cy = pen.Y(-2.4) + 16
            pen.labelPx(pen.X(-2.4), cy, 'programs compiled since the figure started:', { role: 'soft', size: 11 })
            // the three ways' counts in a row, each as wide as its words
            let cx = pen.X(-2.4)
            for (const [m, name] of MODES) {
                const t = `${name}: ${s.seen[m]?.n ?? 0}`, size = m === s.mode ? 14 : 12
                pen.labelPx(cx, cy + 18, t, { role: m === s.mode ? 'accent' : 'soft', size })
                ctx.save(); ctx.font = `500 ${size}px ${pen.theme.fonts.hand}`; cx += ctx.measureText(t).width + 22; ctx.restore()
            }
            pen.labelPx(pen.X(-2.4), cy + 36, s.last === 'compiled' ? 'the text changed: a compile (seconds, on a real card)'
                : `the same text: the ${s.mode === 'data' ? 'records' : 'values'} written, no compile`, { role: s.last === 'compiled' ? 'blocked' : 'shadow', size: 12 })
        },
        readout(s) {
            account(s)
            const scene = sceneOf(s)
            return `${MODES.find(m => m[0] === s.mode)[1]} · ${scene.shapes.length} shapes · ${s.mode === 'codegen' ? `${Object.keys(codegen(scene).uniforms).length} uniforms` : s.mode === 'baked' ? `${Object.keys(bake(scene).baked.constants).length} constants` : `${scene.shapes.length} records`} · compiled this way so far: ${s.seen[s.mode].n}`
        },
    },

    inline: {
        aspect: 1.75,
        world: { x: [0, 1], y: [0, 1] },
        state: { n: 40, sites: 4 },
        controls: [
            { type: 'slider', key: 'n', label: 'objects in the scene', min: 1, max: 400, step: 1, fmt: v => String(v) },
            { type: 'slider', key: 'sites', label: 'places the kernel calls SDF', min: 1, max: 12, step: 1, fmt: v => String(v) },
        ],
        steps: { one: { n: 40, sites: 1 }, four: { n: 40, sites: 4 }, big: { n: 400, sites: 4 } },
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.12, y: H * 0.1, w: W * 0.84, h: H * 0.68 }
            const pts = Array.from({ length: 12 }, (_, i) => { const st = inlineStats(kernelText(s.n, i + 1), 'main', ['SDF']); return { sites: i + 1, size: st.inlined, text: st.text, ms: kernelMs(st.inlined), lin: DEFAULT_RATE * st.inlined } })
            const top = Math.max(...pts.map(p => p.ms)) * 1.1
            plot(pen, rect, {
                x: [0.5, 12.5], y: [0, top], xticks: [], fmt: v => v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`,
                hoverX: v => `${Math.round(v)} call site${Math.round(v) === 1 ? '' : 's'}`, hoverY: v => v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`,
                series: [
                    { name: 'as the text grows', role: 'soft', w: 1.2, dash: [4, 3], pts: pts.map(p => [p.sites, p.lin]) },
                    { name: 'the fitted model', role: 'blocked', w: 1.8, pts: pts.map(p => [p.sites, p.ms]) },
                    { name: 'this kernel', kind: 'dots', role: 'accent', r: 5, pts: [[s.sites, pts[s.sites - 1].ms]] },
                ],
            })
            pen.labelPx(rect.x, rect.y - 16, `predicted compile time of a kernel calling SDF at 1 to 12 places, the scene ${s.n} object${s.n === 1 ? '' : 's'}`, { role: 'soft', size: 11 })
            for (const k of [1, 2, 4, 6, 8, 10, 12]) pen.labelPx(rect.x + rect.w * (k - 0.5) / 12, rect.y + rect.h + 6, String(k), { role: 'soft', size: 11, align: 'center', base: 'top' })
            pen.labelPx(rect.x + rect.w, rect.y + rect.h + 24, 'places the kernel calls SDF', { role: 'soft', size: 11, align: 'right', base: 'top' })
        },
        readout(s) {
            const st = inlineStats(kernelText(s.n, s.sites), 'main', ['SDF'])
            return `the kernel's text ${st.text.toLocaleString('en-US')} characters, inlined ${st.inlined.toLocaleString('en-US')} (${st.copies.SDF} cop${st.copies.SDF === 1 ? 'y' : 'ies'} of SDF) · predicted compile ${(kernelMs(st.inlined) / 1000).toFixed(2)} s (linear in the size: ${(DEFAULT_RATE * st.inlined / 1000).toFixed(2)} s)`
        },
    },
}
export { PRELUDE, GROWTH, SIZE_REF }

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
