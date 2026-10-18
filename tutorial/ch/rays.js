//======================================================================================================================
// CHAPTER "Rays make a picture": its figures. Exports the specs (figure.js) so the test can draw every one of them
// and every step; mount() starts the page.
//
//   scene   a flat room seen from the side: an eye, its screen of pixels, one ray per pixel, the picture they make;
//           steps show light going the other way (from the lamp, almost none of it arriving), and a shadow ray
//   edge    one pixel at the edge of the ball, close up: its samples, the average, and what jitter does to it
//======================================================================================================================

import { boot } from '../kit/page.js'
import { march, normalAt, cameraRay, pointLightE, cosineDir, rng } from '../kit/flatland.js'
import { plot } from '../kit/plot.js'

const SKY = [0.66, 0.75, 0.86]
export const room = () => ({
    shapes: [
        { kind: 'box', c: [4.2, -0.6], h: [5.8, 0.6], rgb: [0.8, 0.76, 0.68], name: 'floor' },
        { kind: 'box', c: [3.2, 0.55], h: [0.55, 0.55], round: 0.05, rgb: [0.24, 0.44, 0.86], name: 'block' },
        { kind: 'circle', c: [5.75, 0.95], r: 0.95, rgb: [0.86, 0.3, 0.2], name: 'ball' },
    ],
})
const TARGET = [5.0, 0.75]
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const srgb = v => Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 2.2))
const css = ([r, g, b]) => `rgb(${srgb(r)},${srgb(g)},${srgb(b)})`
const camOf = s => ({ eye: s.eye, dir: Math.atan2(TARGET[1] - s.eye[1], TARGET[0] - s.eye[0]), fov: s.fov * Math.PI / 180, pixels: s.pixels })

/* what one pixel's ray finds: the hit, its normal, and the colour the pixel gets (lit by the lamp, or the sky) */
const HIT = {}
function look(world, s, cam, px, u = 0.5) {
    const [ox, oy, dx, dy] = cameraRay(cam, px, u)
    march(world, ox, oy, dx, dy, { far: 14 }, HIT)
    if (!HIT.hit) return { o: [ox, oy], d: [dx, dy], hit: null, rgb: SKY }
    const sh = world.shapes[HIT.i]
    let [nx, ny] = normalAt(world, HIT.x, HIT.y, HIT.i)
    if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny }
    const E = pointLightE(world, { p: s.lamp, I: 1 }, HIT.x, HIT.y, nx, ny)
    const k = 0.06 + 2.3 * E                                     // a little light from everywhere, and the lamp
    return { o: [ox, oy], d: [dx, dy], hit: [HIT.x, HIT.y], n: [nx, ny], i: HIT.i, E, rgb: sh.rgb.map(c => c * k) }
}
/* where pixel i's cell sits on the screen, `f` in front of the eye */
function cell(cam, i, f = 1.25) {
    const fx = Math.cos(cam.dir), fy = Math.sin(cam.dir), rx = Math.sin(cam.dir), ry = -Math.cos(cam.dir), t = Math.tan(cam.fov / 2)
    const at = x => [cam.eye[0] + f * (fx + rx * x * t), cam.eye[1] + f * (fy + ry * x * t)]
    return [at(-1 + 2 * i / cam.pixels), at(-1 + 2 * (i + 1) / cam.pixels)]
}

/* LIGHT GOING FORWARD: rays leave the lamp in every direction, bounce once off what they meet, and a few happen to
   pass through the eye's pupil. Seeded, so the same batches draw the same rays. */
const PUPIL = 0.1
function fromLamp(world, s) {
    const out = { first: [], second: [], lucky: [], n: 0 }
    const H = {}, B = {}
    for (let b = 0; b < s.batches; b++) {
        const R = rng(1000 + b)
        for (let k = 0; k < 400; k++) {
            out.n++
            const a = R() * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a)
            march(world, s.lamp[0], s.lamp[1], dx, dy, { far: 14 }, H)
            if (!H.hit) { if (out.first.length < 900) out.first.push([s.lamp, [s.lamp[0] + dx * 12, s.lamp[1] + dy * 12]]); continue }
            let [nx, ny] = normalAt(world, H.x, H.y, H.i)
            if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny }
            const [ex, ey] = cosineDir(nx, ny, R())
            const px = H.x + nx * 0.004, py = H.y + ny * 0.004
            if (out.first.length < 900) out.first.push([s.lamp, [H.x, H.y]])
            // does the bounced ray pass within PUPIL of the eye, before anything stops it?
            const vx = s.eye[0] - px, vy = s.eye[1] - py, t = vx * ex + vy * ey
            const miss = Math.hypot(vx - ex * t, vy - ey * t)
            march(world, px, py, ex, ey, { far: 14 }, B)
            const blocked = B.hit && B.t < t
            if (t > 0 && miss < PUPIL && !blocked) out.lucky.push([[H.x, H.y], [px + ex * t, py + ey * t]])
            else if (out.second.length < 500) out.second.push([[H.x, H.y], B.hit ? [B.x, B.y] : [px + ex * 12, py + ey * 12]])
        }
    }
    return out
}

export const figures = {
    scene: {
        aspect: 1.55,
        world: { x: [-1.0, 8.2], y: [-1.0, 4.85] },
        state: { eye: [-0.2, 1.7], lamp: [4.3, 3.35], pixels: 12, fov: 52, mode: 'eye', batches: 1, shadow: false, sel: 6, strip: true },
        controls: [
            { type: 'seg', key: 'mode', options: [['eye', 'From the eye'], ['lamp', 'From the lamp']] },
            { type: 'slider', key: 'pixels', label: 'pixels', min: 3, max: 40, step: 1, fmt: v => `${v}` },
            { type: 'slider', key: 'fov', label: 'field of view', min: 20, max: 130, step: 1, fmt: v => `${v}°` },
            { type: 'button', label: 'Throw 400 more', act: s => { s.mode = 'lamp'; s.batches = Math.min(25, s.batches + 1) } },
        ],
        steps: {
            idea: { mode: 'eye', pixels: 12, fov: 52, shadow: false },
            forward: { mode: 'lamp', batches: 1, shadow: false },
            backward: { mode: 'eye', shadow: false },
            pixels: { mode: 'eye', pixels: 28, shadow: false },
            fov: { mode: 'eye', fov: 104, pixels: 28, shadow: false },
            shade: { mode: 'eye', pixels: 16, fov: 52, shadow: true, sel: 9 },
        },
        drag: {
            eye: (s, p) => { s.eye = [clamp(p[0], -0.9, 2.2), clamp(p[1], 0.25, 3.6)] },
            lamp: (s, p) => { s.lamp = [clamp(p[0], -0.6, 7.9), clamp(p[1], 2.2, 3.9)] },
            pixel: (s, p) => {
                const cam = camOf(s)
                let best = 0, bd = Infinity
                for (let i = 0; i < s.pixels; i++) { const [a, b] = cell(cam, i); const d = Math.hypot((a[0] + b[0]) / 2 - p[0], (a[1] + b[1]) / 2 - p[1]); if (d < bd) { bd = d; best = i } }
                s.sel = best; s.shadow = true
            },
        },
        changed(s, key) { if (key === 'pixels') s.sel = Math.min(s.sel, s.pixels - 1); if (key === 'mode' && s.mode === 'eye') s.batches = Math.max(1, s.batches) },
        draw(pen, s) {
            const world = room(), cam = camOf(s)
            s.sel = Math.min(s.sel, s.pixels - 1)
            for (const sh of world.shapes) pen.flat(sh, { id: sh.name })
            pen.label([world.shapes[2].c[0], world.shapes[2].c[1] + 1.25], 'ball', { align: 'center', role: 'soft' })
            pen.label([3.2, 1.45], 'block', { align: 'center', role: 'soft' })
            pen.label([7.5, -0.3], 'floor', { align: 'center', role: 'soft' })

            const looks = []
            for (let i = 0; i < s.pixels; i++) looks.push(look(world, s, cam, i))
            if (s.mode === 'lamp') {
                const L = fromLamp(world, s)
                pen.rays(L.first, { role: 'light', alpha: 0.18, w: 0.6 })
                pen.rays(L.second, { role: 'light', alpha: 0.1, w: 0.6 })
                for (const [a, b] of L.lucky) pen.ray(a, b, { role: 'accent', w: 1.4 })
                s._lamp = { n: L.n, k: L.lucky.length }
            } else {
                looks.forEach((r, i) => {
                    const end = r.hit ?? [r.o[0] + r.d[0] * 11, r.o[1] + r.d[1] * 11]
                    pen.ray(r.o, end, { role: 'cam', w: i === s.sel && s.shadow ? 1.6 : 0.9, alpha: r.hit ? 0.9 : 0.4, arrow: !r.hit })
                    if (r.hit) pen.dot(r.hit, { role: 'cam', r: 2.6 })
                })
            }
            // the screen: one cell a pixel, each painted with what its ray found
            for (let i = 0; i < s.pixels; i++) {
                const [a, b] = cell(cam, i), r = looks[i]
                const ctx = pen.ctx
                ctx.save(); ctx.strokeStyle = s.mode === 'eye' ? css(r.rgb) : pen.col('faint'); ctx.lineWidth = 10; ctx.lineCap = 'butt'
                ctx.beginPath(); ctx.moveTo(...pen.P(a)); ctx.lineTo(...pen.P(b)); ctx.stroke(); ctx.restore()
                pen.line(a, b, { role: 'ink', w: 0.5, exact: true })
            }
            const [s0] = cell(cam, 0)
            pen.label(s0, 'screen', { role: 'soft', size: 13, dx: 8, dy: -6, align: 'left' })
            if (s.shadow && s.mode === 'eye') {
                const r = looks[s.sel]
                const [a, b] = cell(cam, s.sel)
                pen.handle('pixel', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { label: 'this pixel' })
                if (r.hit) {
                    const lit = r.E > 0
                    pen.ray([r.hit[0] + r.n[0] * 0.01, r.hit[1] + r.n[1] * 0.01], lit ? s.lamp : [r.hit[0] + (s.lamp[0] - r.hit[0]) * 0.5, r.hit[1] + (s.lamp[1] - r.hit[1]) * 0.5], { role: lit ? 'shadow' : 'blocked', w: 1.3, exact: false, id: 'shadowray' })
                    pen.ray(r.hit, [r.hit[0] + r.n[0] * 0.8, r.hit[1] + r.n[1] * 0.8], { role: 'normal', w: 1.1, exact: false, id: 'normal' })
                    if (lit) {
                        const an = Math.atan2(r.n[1], r.n[0]), al = Math.atan2(s.lamp[1] - r.hit[1], s.lamp[0] - r.hit[0])
                        pen.angle(r.hit, an, al, 0.45, 'θ', { role: 'normal' })
                    }
                    pen.label(r.hit, lit ? 'lit' : 'in shadow', { role: lit ? 'shadow' : 'blocked', dx: 10, dy: 14, size: 14 })
                }
            } else if (s.mode === 'eye') pen.handle('pixel', (() => { const [a, b] = cell(cam, s.sel); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] })())
            pen.eye(s.eye, cam.dir, { size: 22 })
            pen.handle('eye', [s.eye[0] - 0.42 * Math.cos(cam.dir), s.eye[1] - 0.42 * Math.sin(cam.dir)], { label: 'eye' })
            pen.bulb(s.lamp)
            pen.handle('lamp', s.lamp, { label: 'lamp', role: 'light' })

            // THE PICTURE: the screen's cells laid out flat, big enough to see
            const W = Math.min(pen.view.W * 0.46, 330), x0 = 14, y0 = 12, cw = W / s.pixels, ch = 26
            const ctx = pen.ctx
            ctx.save()
            for (let i = 0; i < s.pixels; i++) { ctx.fillStyle = s.mode === 'eye' ? css(looks[i].rgb) : pen.col('grid'); ctx.fillRect(x0 + i * cw, y0, cw + 0.5, ch) }
            ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1.2; ctx.strokeRect(x0, y0, W, ch)
            if (s.shadow && s.mode === 'eye') { ctx.strokeStyle = pen.col('accent'); ctx.lineWidth = 2; ctx.strokeRect(x0 + s.sel * cw, y0 - 2, cw, ch + 4) }
            ctx.restore()
            pen.labelPx(x0, y0 + ch + 6, s.mode === 'eye' ? `the picture: ${s.pixels} pixels, one ray each` : 'the picture: nothing yet', { role: 'soft' })
        },
        readout(s) {
            if (s.mode === 'lamp' && s._lamp) return `${s._lamp.n} rays left the lamp · ${s._lamp.k} bounced into the eye (${(100 * s._lamp.k / s._lamp.n).toFixed(1)}%)`
            return `${s.pixels} pixels · ${s.pixels} rays · field of view ${s.fov}°`
        },
    },

    edge: {
        aspect: 1.45,
        world: { x: [-0.45, 6.6], y: [-3.15, 2.5] },
        state: { jitter: false, n: 0, hits: 0, us: [], hist: [], width: 12, offset: 0.5, seed: 3 },
        controls: [
            { type: 'toggle', key: 'jitter', label: 'Jitter' },
            { type: 'slider', key: 'offset', label: 'edge', min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
            { type: 'button', label: 'Start again', act: s => { s.seed++ } },
        ],
        steps: { still: { jitter: false }, jitter: { jitter: true } },
        work: {
            reset(s) { s.n = 0; s.hits = 0; s.us = []; s.hist = [] },
            add(s) {
                const R = rng(s.seed * 7919 + s.n)
                const k = s.n < 40 ? 1 : s.n < 120 ? 3 : 8
                for (let j = 0; j < k && s.n < 400; j++) {
                    const u = s.jitter ? R() : 0.5
                    s.n++; s.hits += hitsBall(s, u) ? 1 : 0
                    s.us.push(u); if (s.us.length > 36) s.us.shift()
                    s.hist.push([s.n, s.hits / s.n])
                }
                return s.n < 400
            },
        },
        draw(pen, s) {
            const g = edgeGeom(s)
            pen.flat({ kind: 'circle', c: BALL.c, r: BALL.r }, { id: 'ball' })
            pen.label([BALL.c[0], BALL.c[1] + BALL.r + 0.3], 'ball', { align: 'center', role: 'soft' })
            const far = 6.3
            const dir = a => [Math.cos(a) * far, Math.sin(a) * far]
            pen.line([0, 0], dir(g.a0 - g.w / 2), { role: 'ink', w: 0.9, id: 'w0' })
            pen.line([0, 0], dir(g.a0 + g.w / 2), { role: 'ink', w: 0.9, id: 'w1' })
            pen.label(dir(g.a0 - g.w / 2), 'one pixel sees this wedge', { role: 'soft', size: 13, align: 'right', dy: 14 })
            for (const u of s.us) {
                const a = g.a0 + (u - 0.5) * g.w, hit = hitsBall(s, u)
                const t = hit ? hitT(a) : far
                pen.ray([0, 0], [Math.cos(a) * t, Math.sin(a) * t], { role: hit ? 'cam' : 'soft', w: 0.8, alpha: hit ? 0.75 : 0.35, arrow: false })
            }
            pen.eye([0, 0], g.a0, { size: 20 })
            // the pixel: its average, between the ball's colour and the sky's
            const avg = s.n ? s.hits / s.n : 0
            const mix = SKY.map((c, i) => c + (BALL.rgb[i] - c) * avg)
            const [px, py] = pen.P([0.3, 1.9])
            pen.ctx.save(); pen.ctx.fillStyle = css(mix); pen.ctx.fillRect(px, py, 34, 34); pen.ctx.strokeStyle = pen.col('ink'); pen.ctx.lineWidth = 1.2; pen.ctx.strokeRect(px, py, 34, 34); pen.ctx.restore()
            pen.label([0.3, 1.9], 'the pixel', { role: 'soft', size: 13, dx: 42, dy: 10 })
            // the running average against the share of the wedge the ball really covers
            const r = { x: pen.X(0.55), y: pen.Y(-1.2), w: pen.X(6.35) - pen.X(0.55), h: pen.Y(-2.75) - pen.Y(-1.2) }
            plot(pen, r, {
                x: [0, 400], y: [0, 1], xlabel: 'samples', ylabel: 'pixel value', yticks: [0, 0.5, 1],
                series: [{ pts: [[0, g.cover], [400, g.cover]], role: 'accent', w: 1 }, { pts: s.hist, role: 'cam', w: 1.6 }],
            })
            pen.label([6.35, -1.2 - (1 - g.cover) * 1.55], 'what the ball covers', { role: 'accent', size: 12, align: 'right', dy: -9 })
        },
        readout(s) {
            const g = edgeGeom(s)
            return `${s.n} samples · the pixel reads ${(s.n ? s.hits / s.n : 0).toFixed(3)} · the ball covers ${g.cover.toFixed(3)} of its wedge`
        },
    },
}

/* THE EDGE FIGURE'S GEOMETRY: the eye at the origin, the ball, a pixel's wedge `width` degrees wide placed across the
   ball's lower edge, and the exact share of the wedge's directions that meet the ball. */
const BALL = { c: [4.4, 1.0], r: 1.3, rgb: [0.86, 0.3, 0.2] }
function edgeGeom(s) {
    const d = Math.hypot(...BALL.c), ac = Math.atan2(BALL.c[1], BALL.c[0]), beta = Math.asin(BALL.r / d)
    const w = s.width * Math.PI / 180, a0 = ac - beta + (s.offset - 0.5) * w
    const lo = Math.max(a0 - w / 2, ac - beta), hi = Math.min(a0 + w / 2, ac + beta)
    return { a0, w, cover: Math.max(0, hi - lo) / w, ac, beta }
}
function hitsBall(s, u) { const g = edgeGeom(s), a = g.a0 + (u - 0.5) * g.w; return Math.abs(a - g.ac) < g.beta }
function hitT(a) {
    const dx = Math.cos(a), dy = Math.sin(a), b = dx * BALL.c[0] + dy * BALL.c[1], c = BALL.c[0] ** 2 + BALL.c[1] ** 2 - BALL.r ** 2
    return b - Math.sqrt(Math.max(0, b * b - c))
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
