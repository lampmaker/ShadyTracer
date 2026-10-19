//======================================================================================================================
// CHAPTER "A GPU for beginners": its figures.
//
//   lanes     128 camera rays sphere tracing a flat scene, one GPU thread each, in groups that run in lock-step: each
//             group as long as its slowest ray, the rest of it waiting. Neighbouring pixels together or shuffled.
//   packing   a uniform struct laid out as WGSL lays it out (tinywebgpu's arithmetic, kit/gpu.js): a small one in two
//             orders, and ShadyTracer's own UB, field by field from uniforms.schema.js
//   dispatch  how many workgroups a pass over a picture asks for, flat or one row per y, against the 65535 a dimension
//             may have: the resolve kernel's story (wavefront.js prog_resolve)
//
// No figure here runs a GPU: the march is the flat world's (kit/flatland.js), the packing and the counts kit/gpu.js's.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { rng, cameraRay, march } from '../kit/flatland.js'
import { layoutStruct, lockstep, dispatchCounts, MAX_GROUPS } from '../kit/gpu.js'
import { computeUniformTypes } from '../../lib/pathtracer/core/uniforms.schema.js'

const DEG = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/* LANES: a floor, a ball, a block, a ball further off and a wall, seen by 128 pixels */
export const LANE_WORLD = { sky: 0, shapes: [
    { kind: 'box', c: [0, -0.3], h: [6.5, 0.3], name: 'floor' },
    { kind: 'circle', c: [-1.2, 0.75], r: 0.6 },
    { kind: 'box', c: [1.5, 0.9], h: [0.45, 0.9], round: 0.1 },
    { kind: 'circle', c: [3.4, 2.4], r: 0.45 },
    { kind: 'box', c: [5.6, 1.9], h: [0.2, 1.9] },
] }
export const LANES = 128
export const LANE_CAM = { eye: [-4.8, 1.5], dir: Math.atan2(-0.15, 1), fov: 64 * DEG, pixels: LANES }
/** each pixel's ray: its march's steps (to a surface, or 40 away into the sky: the steps it took, counted, since the
 *  march reports a miss as its cap), and where it ended */
export const RAYS = (() => {
    const H = {}, out = []
    for (let i = 0; i < LANES; i++) {
        const [ox, oy, dx, dy] = cameraRay(LANE_CAM, i, 0.5), steps = []
        march(LANE_WORLD, ox, oy, dx, dy, { far: 40, max: 400, steps }, H)
        out.push({ steps: steps.length, hit: H.hit, a: [ox, oy], b: H.hit ? [H.x, H.y] : [ox + dx * 9, oy + dy * 9] })
    }
    return out
})()
/** the pixels in a fixed shuffled order (a seeded Fisher-Yates) */
export const SHUFFLED = (() => { const R = rng(17), p = [...Array(LANES).keys()]; for (let i = LANES - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] } return p })()
export const orderOf = order => order === 'shuffled' ? SHUFFLED : [...Array(LANES).keys()]
export const lanesRun = (width, order) => lockstep(orderOf(order).map(i => RAYS[i].steps), width)

/* PACKING */
export const SMALL = [['pos', 'vec3<f32>'], ['t', 'f32'], ['dir', 'vec3<f32>'], ['n', 'u32'], ['uv', 'vec2<f32>'], ['k', 'f32'], ['col', 'vec3<f32>']]
export const SMALL_BAD = [['t', 'f32'], ['pos', 'vec3<f32>'], ['k', 'f32'], ['dir', 'vec3<f32>'], ['n', 'u32'], ['col', 'vec3<f32>'], ['uv', 'vec2<f32>']]
export const ENGINE_UB = Object.entries(computeUniformTypes())
export const structOf = which => which === 'engine' ? ENGINE_UB : which === 'bad' ? SMALL_BAD : SMALL
const KIND_ROLE = t => /^mat/.test(t) ? 'glass' : /^vec4/.test(t) ? 'cam' : /^vec3/.test(t) ? 'light' : /^vec2/.test(t) ? 'normal' : 'shadow'

/* DISPATCH */
export const SIZES = [['1920x1080', '1920 × 1080'], ['2560x1440', '2560 × 1440'], ['2048x2048', '2048 × 2048'], ['3840x2160', '3840 × 2160'], ['4096x4096', '4096 × 4096']]
export const sizeOf = key => key.split('x').map(Number)

export const figures = {
    lanes: {
        aspect: 1.35,
        world: { x: [-5.2, 6.2], y: [-6.9, 4.4] },
        state: { width: 32, order: 'neighbours', focus: 1 },
        controls: [
            { type: 'seg', key: 'width', label: 'lanes in step', options: [[8, '8'], [16, '16'], [32, '32'], [64, '64']] },
            { type: 'seg', key: 'order', options: [['neighbours', 'Neighbouring pixels'], ['shuffled', 'Shuffled pixels']] },
        ],
        steps: { group: { width: 32, order: 'neighbours', focus: 1 }, shuffle: { width: 32, order: 'shuffled', focus: 1 }, narrow: { width: 8, order: 'neighbours', focus: 6 } },
        draw(pen, s) {
            const { W, H } = pen.view, run = lanesRun(s.width, s.order), order = orderOf(s.order)
            const rect = { x: W * 0.07, y: H * 0.58, w: W * 0.9, h: H * 0.3 }, bw = rect.w / LANES, top = Math.max(...RAYS.map(r => r.steps))
            const Yp = v => rect.y + rect.h - v / top * rect.h
            // which group the pointer is over (or the state's)
            const hp = pen.hover(rect), focus = hp ? clamp(Math.floor((hp.x - rect.x) / bw / s.width), 0, run.groups.length - 1) : clamp(s.focus, 0, run.groups.length - 1)
            const g = run.groups[focus], mine = new Set(order.slice(g.first, g.first + s.width))
            // the scene and the rays, the focused group's strong
            for (const sh of LANE_WORLD.shapes) pen.flat(sh, { role: 'solid' })
            RAYS.forEach((r, i) => { if (!mine.has(i)) pen.ray(r.a, r.b, { role: 'soft', w: 0.5, alpha: 0.35, arrow: false, exact: true }) })
            RAYS.forEach((r, i) => { if (mine.has(i)) pen.ray(r.a, r.b, { role: 'cam', w: 1, alpha: 0.9, arrow: false, exact: true }) })
            pen.eye(LANE_CAM.eye, LANE_CAM.dir, { size: 18 })
            // the lanes: each ray's steps as a bar, each group's time as the box over its lanes
            const { ctx } = pen
            ctx.save()
            run.groups.forEach((gr, k) => {
                const x0 = rect.x + gr.first * bw, w = gr.lanes.length * bw
                ctx.fillStyle = pen.col(k === focus ? 'accent' : 'soft'); ctx.globalAlpha = k === focus ? 0.16 : 0.08
                ctx.fillRect(x0, Yp(gr.max), w, rect.y + rect.h - Yp(gr.max))
                ctx.globalAlpha = 1; ctx.strokeStyle = pen.col(k === focus ? 'accent' : 'soft'); ctx.lineWidth = k === focus ? 1.6 : 0.8
                ctx.strokeRect(x0, Yp(gr.max), w, rect.y + rect.h - Yp(gr.max))
                gr.lanes.forEach((st, j) => { ctx.fillStyle = pen.col('cam'); ctx.globalAlpha = 0.85; ctx.fillRect(x0 + j * bw + bw * 0.15, Yp(st), bw * 0.7, rect.y + rect.h - Yp(st)) })
            })
            ctx.restore()
            pen.labelPx(rect.x, rect.y - 18, `each pixel's march steps (bars) in groups of ${s.width}: a group's box is as tall as its slowest ray`, { role: 'soft', size: 11 })
            pen.labelPx(rect.x, rect.y + rect.h + 6, `${s.order === 'shuffled' ? 'pixels in a shuffled order' : 'pixels 1 to 128, in order'}`, { role: 'soft', size: 10, base: 'top' })
            if (hp) pen.tip(hp.x, hp.y, [`group ${focus + 1}: ${g.lanes.length} lanes`, `slowest ${g.max} steps, the lanes ${g.sum} in all`, `busy ${(100 * g.sum / (s.width * g.max)).toFixed(0)}% of the time`])
        },
        readout(s) {
            const run = lanesRun(s.width, s.order)
            return `${LANES} rays, ${run.work} march steps in all · in groups of ${s.width}: ${run.groups.length} groups, ${run.time} lane-steps occupied · the lanes busy ${(100 * run.use).toFixed(0)}% of the time`
        },
    },

    packing: {
        aspect: 1.7,
        world: { x: [0, 1], y: [0, 1] },
        state: { which: 'small' },
        controls: [{ type: 'seg', key: 'which', options: [['small', 'A small struct'], ['bad', 'Its fields reordered'], ['engine', 'ShadyTracer\'s uniforms']] }],
        steps: { small: { which: 'small' }, bad: { which: 'bad' }, engine: { which: 'engine' } },
        draw(pen, s) {
            const { W, H } = pen.view, L = layoutStruct(structOf(s.which)), { ctx } = pen
            const rowsAcross = s.which === 'engine' ? 8 : 1                 // 16-byte rows drawn side by side for the big one
            const rows = L.words / 4, perCol = Math.ceil(rows / rowsAcross)
            const x0 = W * 0.06, y0 = H * 0.1, colW = (W * 0.9) / rowsAcross, wordW = (colW - (rowsAcross > 1 ? 6 : 0)) / 4, rowH = Math.min(30, (H * 0.78) / perCol)
            const at = w => { const r = Math.floor(w / 4), c = Math.floor(r / perCol); return [x0 + c * colW + (w % 4) * wordW, y0 + (r % perCol) * rowH] }
            // padding first (every word), then each field over it
            ctx.save()
            for (let w = 0; w < L.words; w++) { const [x, y] = at(w); ctx.strokeStyle = pen.col('faint'); ctx.lineWidth = 0.6; ctx.strokeRect(x + 0.5, y + 0.5, wordW - 1, rowH - 1) }
            ctx.restore()
            const hp = pen.hover({ x: 0, y: 0, w: W, h: H })
            let hit = null
            for (const f of L.fields) {
                for (let k = 0; k < f.size; k++) {
                    const [x, y] = at(f.offset + k)
                    ctx.save(); ctx.fillStyle = pen.col(KIND_ROLE(f.type)); ctx.globalAlpha = 0.55; ctx.fillRect(x + 1, y + 1, wordW - 2, rowH - 2); ctx.restore()
                    if (hp && hp.x >= x && hp.x < x + wordW && hp.y >= y && hp.y < y + rowH) hit = f
                }
                if (s.which !== 'engine') { const [x, y] = at(f.offset); pen.labelPx(x + 4, y + rowH / 2, `${f.name}: ${f.type}`, { role: 'ink', size: 11, base: 'middle' }) }
            }
            // padding hatched
            const used = new Set(); for (const f of L.fields) for (let k = 0; k < f.size; k++) used.add(f.offset + k)
            for (let w = 0; w < L.words; w++) if (!used.has(w)) { const [x, y] = at(w); ctx.save(); ctx.strokeStyle = pen.col('blocked'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 3, y + rowH - 3); ctx.lineTo(x + wordW - 3, y + 3); ctx.stroke(); ctx.restore() }
            if (s.which !== 'engine') for (let r = 0; r < rows; r++) pen.labelPx(x0 - 6, y0 + r * rowH + rowH / 2, `${16 * r}`, { role: 'soft', size: 10, align: 'right', base: 'middle' })
            // the key: which colour is which type
            const keys = [['f32, u32, i32', 'shadow'], ['vec2', 'normal'], ['vec3', 'light'], ['vec4', 'cam'], ['matrix', 'glass']]
            keys.forEach(([t, role], k) => {
                const kx = x0 + k * W * 0.17, ky = H * 0.92
                ctx.save(); ctx.fillStyle = pen.col(role); ctx.globalAlpha = 0.55; ctx.fillRect(kx, ky - 6, 14, 12); ctx.restore()
                pen.labelPx(kx + 20, ky, t, { role: 'soft', size: 11, base: 'middle' })
            })
            pen.labelPx(x0, y0 - 16, s.which === 'engine' ? `UB, ${L.fields.length} fields: each little box 4 bytes, ${rowsAcross} columns of 16-byte rows` : 'each row 16 bytes, each box 4: the byte offset on the left', { role: 'soft', size: 11 })
            if (hit) pen.tip(hp.x, hp.y, [`${hit.name}: ${hit.type}`, `bytes ${4 * hit.offset} to ${4 * (hit.offset + hit.size) - 1}${hit.pad ? `, after ${4 * hit.pad} bytes of padding` : ''}`])
        },
        readout(s) {
            const L = layoutStruct(structOf(s.which))
            return `${L.fields.length} fields · ${L.bytes} bytes, of which ${4 * L.padWords} are padding (red strokes)${s.which === 'engine' ? ` · the limit for one uniform buffer is 65,536 bytes` : ''}`
        },
    },

    dispatch: {
        aspect: 1.8,
        world: { x: [0, 1], y: [0, 1] },
        state: { size: '2048x2048', rows: false },
        controls: [
            { type: 'seg', key: 'size', options: SIZES },
            { type: 'toggle', key: 'rows', label: 'One row per y' },
        ],
        steps: { flat: { size: '1920x1080', rows: false }, over: { size: '2048x2048', rows: false }, rows: { size: '3840x2160', rows: true } },
        draw(pen, s) {
            const { W, H } = pen.view, [w, h] = sizeOf(s.size), c = dispatchCounts(w, h)
            // the picture, its rows, and how the groups are counted: one count running on through every row, or x across a row
            // and y down the rows
            const ar = w / h, maxW = W * 0.44, maxH = H * 0.56, pw = Math.min(maxW, maxH * ar), ph = pw / ar, px = W * 0.05, py = H * 0.16, { ctx } = pen
            ctx.save()
            ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1.2; ctx.strokeRect(px, py, pw, ph)
            const gx = Math.ceil(w / 64), rowsDrawn = 7, rh = ph / 24
            for (let r = 0; r < rowsDrawn; r++) for (let g = 0; g < gx; g++) {
                ctx.fillStyle = pen.col((g + (s.rows ? 0 : r * gx)) % 2 ? 'cam' : 'light'); ctx.globalAlpha = 0.5
                ctx.fillRect(px + g * pw / gx, py + r * rh * 1.15 + 3, pw / gx, rh)
            }
            ctx.restore()
            pen.labelPx(px, py - 18, `${w} × ${h}: ${gx} groups of 64 a row (alternate colours)`, { role: 'soft', size: 11 })
            const yEnd = py + rowsDrawn * rh * 1.15 + 3
            if (s.rows) {
                pen.labelPx(px + pw / 2, yEnd + 8, `x: 0 to ${gx - 1} across a row`, { role: 'cam', size: 12, align: 'center', base: 'top' })
                pen.labelPx(px + 6, yEnd + 28, `y: 0 to ${(h - 1).toLocaleString('en-US')}, a row each`, { role: 'light', size: 12, base: 'top' })
            } else {
                pen.labelPx(px + pw / 2, yEnd + 8, `x: 0 to ${(c.flat - 1).toLocaleString('en-US')}, on through every row`, { role: c.flatOK ? 'cam' : 'blocked', size: 12, align: 'center', base: 'top' })
            }
            // the counts against the limit
            const rect = { x: W * 0.64, y: H * 0.2, w: W * 0.32, h: H * 0.56 }, top = 270000
            plot(pen, rect, {
                x: [0, 3], y: [0, top], xticks: [], yticks: [0, 65535, 131070, 196605, 262140], fmt: v => v.toLocaleString('en-US'),
                hoverX: () => 'workgroups', hoverY: v => Math.round(v).toLocaleString('en-US'),
                series: [
                    { name: 'the limit', role: 'blocked', w: 1.2, dash: [5, 4], pts: [[0, MAX_GROUPS], [3, MAX_GROUPS]] },
                    { name: s.rows ? 'along x' : 'flat, along x', kind: 'bars', role: s.rows ? 'cam' : (c.flatOK ? 'cam' : 'blocked'), pts: [[0.75, s.rows ? c.rows.x : c.flat]] },
                    { name: 'along y', kind: 'bars', role: 'light', pts: [[2.25, s.rows ? c.rows.y : 1]] },
                ],
            })
            pen.labelPx(rect.x + rect.w * 0.25, rect.y + rect.h + 6, 'along x', { role: 'soft', size: 11, align: 'center', base: 'top' })
            pen.labelPx(rect.x + rect.w * 0.75, rect.y + rect.h + 6, 'along y', { role: 'soft', size: 11, align: 'center', base: 'top' })
        },
        readout(s) {
            const [w, h] = sizeOf(s.size), c = dispatchCounts(w, h)
            return `${w} × ${h} = ${(w * h).toLocaleString('en-US')} pixels · ${s.rows ? `one row per y: ${c.rows.x} × ${c.rows.y.toLocaleString('en-US')} groups, within the limit` : `flat: ${c.flat.toLocaleString('en-US')} groups along x, ${c.flatOK ? 'within' : `over the ${MAX_GROUPS.toLocaleString('en-US')} limit: a validation error, not a slow frame`}`}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
