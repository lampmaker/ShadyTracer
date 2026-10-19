//======================================================================================================================
// CHAPTER "Fewer and cheaper steps": its figures.
//
//   cull     a shelf of shapes, two of them with reliefs, and a fan of camera rays sphere-traced through it, every
//            step's cost counted: every node at every step, then with culling boxes on every node, then on the dear
//            ones only (codegen.js culled, scene_api.js cullDist), with the reliefs in their shell or not
//   root     why only at the root: two discs joined as a lens or blended, culled as a whole, or one of them culled
//            inside the join, as ShadyTracer never does -- a surface where there is none, a bridge gone
//   shell    one relief close up: its noise paid at every step and every step divided by its slope bound, or only
//            within its shell (builder/modifiers.js reliefCode)
//   cache    the step cache: cells over the shelf, each a ball with no surface in it, and rays that leave a ball with
//            no scene evaluation (wavefront.js scStep); filled from the copy with culling, the orange shell
//======================================================================================================================

import { boot } from '../kit/page.js'
import * as K from '../kit/steps.js'

const DEG = Math.PI / 180

/* THE SHELF: a floor (open: never boxed), two plain discs, a rounded block, two reliefs -- one fine and rough
   (granite-like: 0.06 high on features 0.35 across), one broad (marble-like: 0.1 on 0.8) */
export const NODES = [
    { id: 'floor', kind: 'plane', y: 0 },
    { id: 'ball', kind: 'disc', c: [-6, 1.0], r: 1.0 },
    { id: 'granite', kind: 'relief', c: [-3.2, 1.2], r: 1.0, amount: 0.06, size: 0.35 },
    { id: 'block', kind: 'rbox', c: [-0.5, 0.9], h: [0.9, 0.9], round: 0.15 },
    { id: 'marble', kind: 'relief', c: [2.2, 1.2], r: 1.0, amount: 0.1, size: 0.8 },
    { id: 'pebble', kind: 'disc', c: [4.8, 0.8], r: 0.8 },
]
for (const n of NODES) n.box = K.boxOf(n)
export const SHELF = { nodes: NODES }
export const EYE = [-0.5, 6.5], DIR = -90 * DEG, FOV = 110 * DEG, RAYS = 48
const runs = new Map()
/** the fan through the shelf, kept per setting (the noise is dear to evaluate here too) */
export function shelf(cull, shell, cache = null, looks = 1, key = '') {
    const k = `${cull}|${shell}|${key}|${looks}`
    if (!runs.has(k)) runs.set(k, K.fan(SHELF, EYE, DIR, FOV, RAYS, { cull, shell, cache, looks }))
    return runs.get(k)
}
export const CACHE_BOX = K.unionBox(NODES.map(n => n.box).filter(Boolean))
const caches = new Map()
export function cacheOf(cells, fill) {
    const k = `${cells}|${fill}`
    if (!caches.has(k)) caches.set(k, K.buildCache(SHELF, CACHE_BOX, cells, { fromRender: fill === 'render', cull: 'dear', shell: true }))
    return caches.get(k)
}
const outlines = new Map()
const outlineOf = n => { const k = `${n.c}|${n.r}|${n.amount}|${n.size}`; if (!outlines.has(k)) outlines.set(k, K.reliefOutline(n)); return outlines.get(k) }

/** a node drawn: its shape, filled */
function drawNode(pen, n, o = {}) {
    if (n.kind === 'plane') { pen.shape([[-9, n.y], [8, n.y], [8, n.y - 1], [-9, n.y - 1]], { role: 'solid', fill: 'fill', w: 1.2 }); return }
    if (n.kind === 'disc') return pen.flat({ kind: 'circle', c: n.c, r: n.r }, o)
    if (n.kind === 'rbox') return pen.flat({ kind: 'box', c: n.c, h: n.h, round: n.round }, o)
    if (n.kind === 'relief') return pen.shape(outlineOf(n), { role: 'solid', fill: 'fill', w: 1.1, exact: true })
}
const boxRect = (pen, b, role = 'accent', dash = [4, 3]) => pen.poly([[b.lo[0], b.lo[1]], [b.hi[0], b.lo[1]], [b.hi[0], b.hi[1]], [b.lo[0], b.hi[1]], [b.lo[0], b.lo[1]]], { role, w: 1, dash, exact: true })
const fmt = v => Math.round(v).toLocaleString('en-US')

/* THE COST BAR: a run's cost split into plain shapes, box tests and noise, against a reference cost */
function costBar(pen, x, y, w, T, ref, label) {
    const parts = [['plain shapes', T.shape * K.COST.shape, 'cam'], ['box tests', T.box * K.COST.box, 'accent'], ['noise', T.octave * K.COST.octave, 'light']]
    let at = x
    for (const [, v, role] of parts) { const ww = w * v / ref; pen.ctx.save(); pen.ctx.fillStyle = pen.col(role); pen.ctx.globalAlpha = 0.75; pen.ctx.fillRect(at, y, ww, 12); pen.ctx.restore(); at += ww }
    pen.ctx.save(); pen.ctx.strokeStyle = pen.col('soft'); pen.ctx.lineWidth = 0.8; pen.ctx.strokeRect(x, y, w, 12); pen.ctx.restore()
    pen.labelPx(x, y - 4, label, { role: 'soft', size: 11, base: 'bottom' })
    let lx = x
    for (const [name, v, role] of parts) { const t = `${name} ${fmt(v)}`; pen.labelPx(lx, y + 16, t, { role, size: 10, base: 'top', kind: 'mono' }); lx += t.length * 6.4 + 12 }
}

export const figures = {
    cull: {
        aspect: 1.75,
        world: { x: [-8.3, 7.3], y: [-0.7, 8.2] },
        state: { cull: 'off', shell: 'none' },
        controls: [
            { type: 'seg', key: 'cull', options: [['off', 'No boxes'], ['all', 'A box on every shape'], ['dear', 'Boxes on the dear ones']] },
            { type: 'seg', key: 'shell', options: [['none', 'Noise at every step'], ['shell', 'Reliefs in a shell']] },
        ],
        steps: { every: { cull: 'off', shell: 'none' }, boxes: { cull: 'all', shell: 'none' }, dear: { cull: 'dear', shell: 'none' }, shelled: { cull: 'dear', shell: 'shell' } },
        draw(pen, s) {
            const F = shelf(s.cull, s.shell === 'shell'), ref = shelf('off', false).cost
            for (const n of NODES) drawNode(pen, n)
            if (s.cull !== 'off') for (const n of NODES) if (n.box && (s.cull === 'all' || K.isDear(n))) boxRect(pen, n.box)
            for (const n of NODES) if (n.kind === 'relief') pen.label([n.c[0], n.c[1] + n.r + 0.35], n.id, { role: 'soft', size: 12, align: 'center' })
            // which ray is pointed at: the one nearest the pointer's direction from the eye
            const hp = pen.hover(), hw = hp && [(hp.x - pen.view.ox) / pen.view.s, (pen.view.oy - hp.y) / pen.view.s]
            const pick = hw ? Math.round(((Math.atan2(hw[1] - EYE[1], hw[0] - EYE[0]) - DIR) / FOV + 0.5) * RAYS - 0.5) : -1
            pen.rays(F.rays.map(r => [EYE, [r.x, r.y]]), { role: 'cam', w: 0.7, alpha: 0.28 })
            F.rays.forEach((r, k) => {
                for (const st of r.steps) pen.dot([st.x, st.y], { role: st.kind === 'box' ? 'accent' : st.cost > K.COST.shape * NODES.length ? 'light' : 'cam', r: k === pick ? 2.6 : 1.5 })
            })
            if (pick >= 0 && pick < RAYS) {
                const r = F.rays[pick]
                for (const st of r.steps) pen.circle([st.x, st.y], st.d, { role: st.kind === 'box' ? 'accent' : 'step', w: 0.7, exact: true })
                pen.tip(hp.x, hp.y, [`ray ${pick + 1} of ${RAYS}: ${r.steps.length} steps`, `${r.T.shape} shapes evaluated, ${r.T.box} box tests, ${r.T.octave / K.OCTAVES} reliefs' noise`, `cost ${fmt(r.cost)} (a plain shape 1)`])
            }
            pen.eye(EYE, DIR, { size: 16 })
            const { W } = pen.view
            costBar(pen, W * 0.03, 22, W * 0.55, F.T, ref, `what ${RAYS} rays cost, in plain-shape evaluations: ${fmt(F.cost)} (no boxes, no shell: ${fmt(ref)})`)
        },
        readout(s) {
            const F = shelf(s.cull, s.shell === 'shell'), off = shelf('off', s.shell === 'shell'), boxed = F.rays.reduce((a, r) => a + r.steps.filter(q => q.kind === 'box').length, 0)
            return `${RAYS} rays · ${fmt(F.steps)} steps${s.cull !== 'off' ? ` (without boxes ${fmt(off.steps)}), ${fmt(boxed)} of them a box's bound standing in` : ''} · cost ${fmt(F.cost)}: shapes ${fmt(F.T.shape)}, box tests ${fmt(F.T.box)}, noise ${fmt(F.T.octave * K.COST.octave)} · every ray ends where it would without boxes`
        },
    },

    root: {
        aspect: 1.7,
        world: { x: [-3.4, 3.4], y: [-1.9, 2.1] },
        state: { op: 'intersect', how: 'root', P: [-1.9, 0.35] },
        controls: [
            { type: 'seg', key: 'op', options: [['intersect', 'A ∩ B: a lens'], ['blend', 'A and B blended']] },
            { type: 'seg', key: 'how', options: [['root', 'Culled whole, at the root'], ['inside', 'B culled inside the join']] },
        ],
        steps: { whole: { op: 'intersect', how: 'root', P: [-1.9, 0.35] }, lens: { op: 'intersect', how: 'inside', P: [-1.9, 0.35] }, blend: { op: 'blend', how: 'inside', P: [0, 0.5] } },
        drag: { P: (s, p) => { s.P = [Math.max(-3.3, Math.min(3.3, p[0])), Math.max(-1.8, Math.min(2, p[1]))] } },
        draw(pen, s) {
            const J = JOINS[s.op]
            pen.field((x, y) => K.joined(J, x, y, 'root').truth, { step: 0.5, lines: 'faint', zero: 'solid', insideLines: false })
            pen.circle(J.a.c, J.a.r, { role: 'soft', w: 0.7, dash: [3, 4], exact: true }); pen.circle(J.b.c, J.b.r, { role: 'soft', w: 0.7, dash: [3, 4], exact: true })
            pen.label([J.a.c[0] - J.a.r * 0.75, J.a.c[1] - J.a.r * 0.95], 'A', { role: 'soft', size: 14 }); pen.label([J.b.c[0] + J.b.r * 0.6, J.b.c[1] - J.b.r * 0.95], 'B', { role: 'soft', size: 14 })
            boxRect(pen, s.how === 'root' ? J.box : J.bBox)
            pen.label(s.how === 'root' ? [J.box.lo[0], J.box.hi[1] + 0.14] : [J.bBox.lo[0], J.bBox.hi[1] + 0.14], s.how === 'root' ? 'the join\'s box' : 'B\'s own box', { role: 'accent', size: 12 })
            // what the march would see with the culling done there: its surface, where it differs from the join's
            if (s.how === 'inside') pen.field((x, y) => K.joined(J, x, y, 'inside').culled, { step: 99, inside: 'blocked', lines: 'faint', zero: 'blocked', insideLines: false })
            for (const [o, d] of J.rays) {
                const m = K.marchJoined(J, o[0], o[1], d[0], d[1], s.how), t = K.marchJoined(J, o[0], o[1], d[0], d[1], s.how, { field: 'truth' })
                const wrong = m.hit !== t.hit || Math.hypot(m.x - t.x, m.y - t.y) > 0.02
                pen.ray(o, [m.x, m.y], { role: wrong ? 'blocked' : 'cam', w: 1, arrow: !m.hit })
                if (m.hit) pen.dot([m.x, m.y], { role: wrong ? 'blocked' : 'cam', r: 3 })
                if (wrong && t.hit) pen.dot([t.x, t.y], { role: 'cam', r: 3.5, ring: true })
            }
            const v = K.joined(J, s.P[0], s.P[1], s.how)
            pen.circle(s.P, Math.abs(v.truth), { role: 'cam', w: 1, dash: [4, 3], exact: true })
            if (Math.abs(v.culled - v.truth) > 1e-9) pen.circle(s.P, Math.abs(v.culled), { role: 'blocked', w: 1.2, exact: true })
            pen.handle('P', s.P, { label: 'P' })
        },
        readout(s) {
            const J = JOINS[s.op], v = K.joined(J, s.P[0], s.P[1], s.how)
            const stops = J.rays.map(([o, d]) => [K.marchJoined(J, o[0], o[1], d[0], d[1], s.how), K.marchJoined(J, o[0], o[1], d[0], d[1], s.how, { field: 'truth' })])
            const wrong = stops.filter(([m, t]) => m.hit !== t.hit || Math.hypot(m.x - t.x, m.y - t.y) > 0.02).length
            const what = s.op === 'intersect' ? 'lens' : 'blend'
            return `at P: the ${what}'s own formula ${v.truth.toFixed(3)}; the scene answers ${v.culled.toFixed(3)}${v.skipped ? (s.how === 'root' ? ` (the box's distance stands in: the ${what} is inside its box, so nothing of it is nearer)` : ' (B skipped, its box\'s distance a cap)') : ' (nothing skipped here)'} · ${wrong} of ${J.rays.length} rays end somewhere else than they should`
        },
    },

    shell: {
        aspect: 1.55,
        world: { x: [-3.5, 1.7], y: [-1.6, 1.75] },
        state: { shell: 'none', ratio: 0.17, lip: 'modifier', circles: false },
        controls: [
            { type: 'seg', key: 'shell', options: [['none', 'Noise at every step'], ['shell', 'In a shell']] },
            { type: 'slider', key: 'ratio', label: 'how rough: amount over size', min: 0.04, max: 0.3, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'seg', key: 'lip', label: 'the slope bound of its noise', options: [['modifier', '17.2, the modifier\'s'], ['measured', '11.2, measured for it']] },
        ],
        steps: { every: { shell: 'none', ratio: 0.17, lip: 'modifier', circles: false }, divided: { shell: 'none', ratio: 0.17, lip: 'modifier', circles: true },
            band: { shell: 'shell', ratio: 0.17, lip: 'modifier', circles: true }, bound: { shell: 'shell', ratio: 0.17, lip: 'measured', circles: false } },
        draw(pen, s) {
            const R = reliefOf(s.ratio), { slope, reach } = K.reliefBounds(R, K.LIP[s.lip]), band = 2 * reach + (slope + 1) * 1e-3
            pen.shape(outlineOf(R), { role: 'solid', fill: 'fill', w: 1.1, exact: true })
            pen.circle(R.c, R.r, { role: 'soft', w: 0.7, dash: [3, 4], exact: true })
            if (s.shell === 'shell') {
                pen.circle(R.c, R.r + band, { role: 'accent', w: 1, dash: [5, 4], exact: true }); pen.circle(R.c, R.r - band, { role: 'accent', w: 1, dash: [5, 4], exact: true })
                pen.label([R.c[0] + (R.r + band) * Math.cos(-2.3), R.c[1] + (R.r + band) * Math.sin(-2.3)], 'the shell\'s edge', { role: 'accent', size: 12, align: 'right', dx: -6 })
            }
            const F = shellFan(s), hp = pen.hover()
            pen.rays(F.rays.map(r => [SHELL_EYE, [r.x, r.y]]), { role: 'cam', w: 0.7, alpha: 0.3 })
            for (const r of F.rays) for (const st of r.steps) pen.dot([st.x, st.y], { role: st.cost > 1 ? 'light' : 'cam', r: 2 })
            if (s.circles) {
                // the middle ray's steps as circles: how far each was allowed to go
                const r = F.rays[SHELL_RAYS >> 1]
                for (const st of r.steps) pen.circle([st.x, st.y], st.d, { role: 'step', w: 0.8, exact: true })
                pen.labelPx(12, 26, `the middle ray's steps as circles, each as far as it may go: ${r.steps.length} of them`, { role: 'soft', size: 11, base: 'top' })
            }
            if (hp) {
                const w = [(hp.x - pen.view.ox) / pen.view.s, (pen.view.oy - hp.y) / pen.view.s]
                let best = null
                for (const r of F.rays) for (const st of r.steps) { const d = Math.hypot(st.x - w[0], st.y - w[1]); if (!best || d < best.d) best = { d, st } }
                if (best && best.d < 0.15) { pen.circle([best.st.x, best.st.y], best.st.d, { role: 'step', w: 0.8, exact: true }); pen.tip(hp.x, hp.y, [`a step of ${best.st.d.toFixed(3)}`, best.st.cost > 1 ? `the noise paid (${K.OCTAVES} octaves), the distance divided by ${slope.toFixed(2)}` : 'no noise: the plain distance less the reach']) }
            }
            pen.eye(SHELL_EYE, SHELL_DIR, { size: 16 })
            pen.labelPx(12, 10, `slope bound ${slope.toFixed(2)} · the noise's reach ${reach.toFixed(3)} · the shell ${band.toFixed(3)} out from the plain circle`, { role: 'soft', size: 11, base: 'top' })
        },
        readout(s) {
            const F = shellFan(s), other = shellFan({ ...s, shell: s.shell === 'shell' ? 'none' : 'shell' })
            const noise = F.T.octave / K.OCTAVES, onoise = other.T.octave / K.OCTAVES
            return `${SHELL_RAYS} rays · ${F.steps} steps, ${noise} of them paying for the noise · cost ${fmt(F.cost)} · ${s.shell === 'shell' ? `without the shell: ${other.steps} steps, ${onoise} with noise, cost ${fmt(other.cost)}` : `in a shell: ${other.steps} steps, ${onoise} with noise, cost ${fmt(other.cost)}`}`
        },
    },

    cache: {
        aspect: 1.75,
        world: { x: [-8.3, 7.3], y: [-0.7, 8.2] },
        state: { looks: 'off', cells: 1024, fill: 'pick', balls: false },
        controls: [
            { type: 'seg', key: 'looks', options: [['off', 'No cache'], ['own', 'Its own cell'], ['ahead', 'And two cells ahead']] },
            { type: 'seg', key: 'cells', label: 'cells', options: [[256, '256'], [1024, '1,024'], [4096, '4,096']] },
            { type: 'seg', key: 'fill', label: 'filled from', options: [['pick', 'the copy without boxes'], ['render', 'the copy with boxes (the bug)']] },
        ],
        steps: { balls: { looks: 'own', cells: 1024, fill: 'pick', balls: true }, own: { looks: 'own', cells: 1024, fill: 'pick', balls: false }, ahead: { looks: 'ahead', cells: 1024, fill: 'pick' }, orange: { looks: 'own', cells: 1024, fill: 'render' } },
        draw(pen, s) {
            const C = cacheOf(s.cells, s.fill), F = cacheRun(s)
            // the cells, each shaded in ink by its ball's radius: the darker, the nearer a surface (a ball of 1.5 or more: none)
            const px = pen.view.s, { ctx } = pen
            ctx.save(); ctx.fillStyle = pen.col('ink')
            for (let j = 0; j < C.ny; j++) for (let i = 0; i < C.nx; i++) {
                ctx.globalAlpha = 0.42 * Math.max(0, 1 - Math.sqrt(C.R[i + C.nx * j] / 1.5))
                ctx.fillRect(pen.view.ox + (C.lo[0] + i * C.cs) * px, pen.view.oy - (C.lo[1] + (j + 1) * C.cs) * px, C.cs * px + 0.5, C.cs * px + 0.5)
            }
            ctx.restore()
            boxRect(pen, CACHE_BOX, 'soft', [2, 3])
            for (const n of NODES) drawNode(pen, n)
            if (s.fill === 'render') for (const n of NODES) if (K.isDear(n)) boxRect(pen, n.box)
            if (s.balls) {
                // a few cells' balls, each centred on its cell, touching the nearest surface
                for (const [i, j] of BALL_CELLS(C)) { const k = i + C.nx * j, c = [C.lo[0] + (i + 0.5) * C.cs, C.lo[1] + (j + 0.5) * C.cs]
                    pen.circle(c, C.R[k], { role: 'shadow', w: 1.1, exact: true }); pen.dot(c, { role: 'shadow', r: 2.5 }) }
                pen.eye(EYE, DIR, { size: 16 })
                pen.labelPx(12, 10, `${C.nx} × ${C.ny} cells of ${C.cs.toFixed(2)}; dark: a surface near the cell's centre; some cells' balls drawn`, { role: 'soft', size: 11, base: 'top' })
                return
            }
            pen.rays(F.rays.map(r => [EYE, [r.x, r.y]]), { role: 'cam', w: 0.7, alpha: 0.28 })
            // a step from the cache drawn as the jump it makes, to the next step's point
            for (const r of F.rays) r.steps.forEach((st, k) => {
                if (st.kind === 'cache') { const nx = r.steps[k + 1] ?? r; pen.line([st.x, st.y], [nx.x, nx.y], { role: 'shadow', w: 2.4, exact: true }) }
                else pen.dot([st.x, st.y], { role: 'cam', r: 1.6 })
            })
            const hp = pen.hover()
            if (hp) {
                const w = [(hp.x - pen.view.ox) / pen.view.s, (pen.view.oy - hp.y) / pen.view.s]
                let best = null
                for (const r of F.rays) for (const st of r.steps) { const d = Math.hypot(st.x - w[0], st.y - w[1]); if (!best || d < best.d) best = { d, st } }
                if (best && best.d < 0.3) {
                    const st = best.st
                    if (st.kind === 'cache') { pen.circle(st.ball.c, st.ball.r, { role: 'shadow', w: 1.2, exact: true }); pen.dot(st.ball.c, { role: 'shadow', r: 2.5 }) }
                    else pen.circle([st.x, st.y], st.d, { role: 'step', w: 0.8, exact: true })
                    pen.tip(hp.x, hp.y, st.kind === 'cache' ? [`a step from the cache: ${st.d.toFixed(2)} to where the ray leaves`, `the ball of a cell centred ${st.ball.c.map(v => v.toFixed(2)).join(', ')}, radius ${st.ball.r.toFixed(2)}`, 'no scene evaluated'] : [`a step from the scene: ${st.d.toFixed(3)}`, 'every node asked (or its box)'])
                }
            }
            pen.eye(EYE, DIR, { size: 16 })
            pen.labelPx(12, 10, `${C.nx} × ${C.ny} cells of ${C.cs.toFixed(2)}; dark: a surface near the cell's centre, light: none near`, { role: 'soft', size: 11, base: 'top' })
        },
        readout(s) {
            if (s.balls) { const C = cacheOf(s.cells, s.fill); return `${C.nx * C.ny} cells (${C.nx} × ${C.ny}), each ${C.cs.toFixed(2)} across · each holds the scene's distance from its centre, ${Math.min(...C.R).toFixed(3)} to ${Math.max(...C.R).toFixed(2)}: a ball with no surface in it` }
            const F = cacheRun(s), off = shelf('dear', true)
            return s.looks === 'off' ? `${RAYS} rays, the reliefs in their shell, boxes on the dear ones · ${fmt(F.steps)} steps, every one asking the scene · cost ${fmt(F.cost)}`
                : `${RAYS} rays · ${fmt(F.steps)} steps: ${fmt(F.T.sdf)} asking the scene, ${fmt(F.T.cached)} from the cache · cost ${fmt(F.cost)} (no cache: ${fmt(off.steps)} steps, cost ${fmt(off.cost)}) · every ray ends where it would without it`
        },
    },
}

/* THE JOINS of the root figure: A and B, their boxes, the join's box, and the rays sent at them */
export const JOINS = {
    intersect: {
        op: 'intersect', a: { c: [-0.6, 0], r: 1.0 }, b: { c: [0.6, 0], r: 1.0 },
        box: { lo: [-0.4, -0.8], hi: [0.4, 0.8] }, bBox: { lo: [-0.4, -1], hi: [1.6, 1] },
        rays: [-0.7, -0.45, -0.2, 0.05, 0.3, 0.55].map(y => [[-3.3, y], [1, 0]]),
    },
    blend: {
        op: 'blend', k: 0.8, a: { c: [-1.15, 0], r: 1.0 }, b: { c: [1.15, 0], r: 1.0 },
        // the join's box: A's and B's, padded by the blend's bulge, k/4 (boxes.js smoothBulge)
        box: { lo: [-2.15 - 0.2, -1.2], hi: [2.15 + 0.2, 1.2] }, bBox: { lo: [0.15, -1], hi: [2.15, 1] },
        rays: [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5].map(x => [[x, 2.0], [0, -1]]),
    },
}

/* THE SHELL'S RELIEF, alone: a disc of radius 1 with features 0.35 across, rays from the upper left */
export const SHELL_EYE = [-3.2, 1.45], SHELL_DIR = -24 * DEG, SHELL_RAYS = 14, SHELL_FOV = 34 * DEG
export const reliefOf = ratio => ({ id: 'relief', kind: 'relief', c: [0, 0], r: 1, amount: +(ratio * 0.35).toFixed(4), size: 0.35 })
const shellRuns = new Map()
export function shellFan(s) {
    const k = `${s.shell}|${s.ratio}|${s.lip}`
    if (!shellRuns.has(k)) shellRuns.set(k, K.fan({ nodes: [reliefOf(s.ratio)] }, SHELL_EYE, SHELL_DIR, SHELL_FOV, SHELL_RAYS, { shell: s.shell === 'shell', lip: K.LIP[s.lip], far: 8 }))
    return shellRuns.get(k)
}
/** cells whose balls the balls view draws: spread over the grid, above the floor */
const BALL_CELLS = C => [[0.12, 0.85], [0.3, 0.75], [0.5, 0.9], [0.62, 0.62], [0.8, 0.8], [0.93, 0.6], [0.45, 0.35], [0.2, 0.45]].map(([u, v]) => [Math.floor(u * C.nx), Math.floor(v * C.ny)])
/** the shelf with today's culling and shell, and the cache as set */
export const cacheRun = s => s.looks === 'off' ? shelf('dear', true) : shelf('dear', true, cacheOf(s.cells, s.fill), s.looks === 'ahead' ? 3 : 1, `${s.cells}|${s.fill}`)

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
