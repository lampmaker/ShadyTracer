//======================================================================================================================
// CHAPTER "Rays make a picture": its figures. Exports the specs (figure.js) so the test can draw every one of them
// and every step; mount() starts the page.
//
//   scene   a flat room seen from the side: an eye, its screen of pixels, one ray per pixel, the picture they make;
//           steps show light going the other way (from the lamp, almost none of it arriving), and a shadow ray from a
//           lit point and from one in shadow (its ray stopped where it is blocked)
//   slant   a beam of light meeting a floor at an angle: the patch it lights is wider by 1 / cos(theta), the cosine law
//   grid    the same in 3D: the screen a grid of pixels, each painted with what its ray finds; turned by dragging
//   edge    one pixel at the edge of the ball, close up: its samples, the average, and what jitter does to it
//======================================================================================================================

import { boot } from '../kit/page.js'
import { march, normalAt, cameraRay, pointLightE, cosineDir, rng } from '../kit/flatland.js'
import { plot } from '../kit/plot.js'
import { orbit, draw3, march3, normal3, cameraRay3, pointLightE3, v3 } from '../kit/space.js'

const SKY = [0.66, 0.75, 0.86]
/* the room: a floor, and a block and a ball where the state has put them (both can be dragged) */
export const room = (s = { block: [3.2, 0.55], ball: [5.75, 0.95] }) => ({
    shapes: [
        { kind: 'box', c: [4.2, -0.6], h: [5.8, 0.6], rgb: [0.8, 0.76, 0.68], name: 'floor' },
        { kind: 'box', c: s.block, h: [0.55, 0.55], round: 0.05, rgb: [0.24, 0.44, 0.86], name: 'block' },
        { kind: 'circle', c: s.ball, r: 0.95, rgb: [0.86, 0.3, 0.2], name: 'ball' },
    ],
})
const ROOM_AT = { block: [3.2, 0.55], ball: [5.75, 0.95] }
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

/* which pixel a step shows: 'lit', the middle one of those whose ray meets the ball where the lamp reaches it; 'dark',
   the middle one of those whose point faces the lamp and still cannot see it -- in something else's shadow, not merely
   turned away (a face turned away is blocked by its own shape, at its own surface, which shows nothing). Either falls
   back to any point the lamp cannot see, then to the middle of the screen. */
function choose(looks, world, want, lamp) {
    const ball = world.shapes.findIndex(sh => sh.name === 'ball')
    const facing = r => r.n[0] * (lamp[0] - r.hit[0]) + r.n[1] * (lamp[1] - r.hit[1]) > 0
    const pick = f => { const ok = looks.map((r, i) => [r, i]).filter(([r]) => r.hit && f(r)).map(([, i]) => i); return ok.length ? ok[Math.floor(ok.length / 2)] : null }
    return (want === 'lit' ? pick(r => r.i === ball && r.E > 0) : pick(r => r.E === 0 && facing(r)) ?? pick(r => r.E === 0)) ?? Math.floor(looks.length / 2)
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
        state: { eye: [-0.2, 1.7], lamp: [4.3, 3.35], pixels: 12, fov: 52, mode: 'eye', batches: 1, shadow: false, sel: 6, strip: true, ...ROOM_AT },
        controls: [
            { type: 'seg', key: 'mode', options: [['eye', 'From the eye'], ['lamp', 'From the lamp']] },
            { type: 'slider', key: 'pixels', label: 'pixels', min: 3, max: 40, step: 1, fmt: v => `${v}` },
            { type: 'slider', key: 'fov', label: 'field of view', min: 20, max: 130, step: 1, fmt: v => `${v}°` },
            { type: 'button', label: 'Throw 400 more', act: s => { s.mode = 'lamp'; s.batches = Math.min(25, s.batches + 1) }, when: s => s.mode === 'lamp' },
        ],
        steps: {
            // each step whole in what it shows, so it reads the same whichever paragraph came before it
            idea: { mode: 'eye', pixels: 12, fov: 52, shadow: false },
            forward: { mode: 'lamp', batches: 1, pixels: 12, fov: 52, shadow: false },
            backward: { mode: 'eye', pixels: 12, fov: 52, shadow: false },
            pixels: { mode: 'eye', pixels: 28, fov: 52, shadow: false },
            fov: { mode: 'eye', fov: 104, pixels: 28, shadow: false },
            // a pixel whose ray meets the lit ball, and one whose point is in shadow: chosen when drawn (the room can
            // have been rearranged by then), not by number
            shade: { mode: 'eye', pixels: 16, fov: 52, shadow: true, sel: 'lit' },
            shadowed: { mode: 'eye', pixels: 16, fov: 52, shadow: true, sel: 'dark' },
        },
        drag: {
            eye: (s, p) => { s.eye = [clamp(p[0], -0.9, 2.2), clamp(p[1], 0.25, 3.6)] },
            // the shapes sit on the floor or float above it, never sink into it
            ball: (s, p) => { s.ball = [clamp(p[0], 1.2, 7.4), clamp(p[1], 0.95, 3.4)] },
            block: (s, p) => { s.block = [clamp(p[0], 1.2, 7.4), clamp(p[1], 0.55, 3.4)] },
            lamp: (s, p) => { s.lamp = [clamp(p[0], -0.6, 7.9), clamp(p[1], 2.2, 3.9)] },
            pixel: (s, p) => {
                const cam = camOf(s)
                let best = 0, bd = Infinity
                for (let i = 0; i < s.pixels; i++) { const [a, b] = cell(cam, i); const d = Math.hypot((a[0] + b[0]) / 2 - p[0], (a[1] + b[1]) / 2 - p[1]); if (d < bd) { bd = d; best = i } }
                s.sel = best; s.shadow = true
            },
        },
        changed(s, key) { if (key === 'pixels' && typeof s.sel === 'number') s.sel = Math.min(s.sel, s.pixels - 1); if (key === 'mode' && s.mode === 'eye') s.batches = Math.max(1, s.batches) },
        draw(pen, s) {
            const world = room(s), cam = camOf(s)
            for (const sh of world.shapes) pen.flat(sh, { id: sh.name })
            pen.label([s.ball[0], s.ball[1] + 1.25], 'ball', { align: 'center', role: 'soft' })
            pen.label([s.block[0], s.block[1] + 0.9], 'block', { align: 'center', role: 'soft' })
            pen.label([7.5, -0.3], 'floor', { align: 'center', role: 'soft' })

            const looks = []
            for (let i = 0; i < s.pixels; i++) looks.push(look(world, s, cam, i))
            if (typeof s.sel !== 'number') s.sel = choose(looks, world, s.sel, s.lamp)
            s.sel = Math.min(s.sel, s.pixels - 1)
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
                    const lit = r.E > 0, from = [r.hit[0] + r.n[0] * 0.01, r.hit[1] + r.n[1] * 0.01]
                    if (lit) pen.ray(from, s.lamp, { role: 'shadow', w: 1.3, exact: false, id: 'shadowray' })
                    else {
                        // a shadow ray stops where something is in the way: drawn to that point, crossed out there,
                        // and only a faint line on to the lamp it could not reach
                        const L = Math.hypot(s.lamp[0] - from[0], s.lamp[1] - from[1]), B = {}
                        const dx = (s.lamp[0] - from[0]) / L, dy = (s.lamp[1] - from[1]) / L
                        march(world, from[0], from[1], dx, dy, { far: L }, B)
                        const stop = B.hit && B.t < L ? [B.x, B.y] : s.lamp
                        pen.ray(from, stop, { role: 'blocked', w: 1.4, arrow: false, exact: false, id: 'shadowray' })
                        pen.line(stop, s.lamp, { role: 'faint', w: 0.8, exact: true })
                        const k = 0.13
                        pen.line([stop[0] - k, stop[1] - k], [stop[0] + k, stop[1] + k], { role: 'blocked', w: 1.6, exact: true })
                        pen.line([stop[0] - k, stop[1] + k], [stop[0] + k, stop[1] - k], { role: 'blocked', w: 1.6, exact: true })
                        pen.label(stop, 'blocked here', { role: 'blocked', size: 13, dx: 10, dy: -10 })
                    }
                    const tip = [r.hit[0] + r.n[0] * 0.8, r.hit[1] + r.n[1] * 0.8]
                    pen.ray(r.hit, tip, { role: 'normal', w: 1.1, exact: false, id: 'normal' })
                    pen.label(tip, 'normal', { role: 'normal', size: 13, dx: r.n[0] < 0 ? -6 : 6, align: r.n[0] < 0 ? 'right' : 'left', dy: -6 })
                    if (lit) {
                        const an = Math.atan2(r.n[1], r.n[0]), al = Math.atan2(s.lamp[1] - r.hit[1], s.lamp[0] - r.hit[0])
                        pen.angle(r.hit, an, al, 0.45, 'θ', { role: 'normal' })
                    }
                    pen.label(r.hit, lit ? 'lit' : 'in shadow', { role: lit ? 'shadow' : 'blocked', dx: 10, dy: 14, size: 14 })
                }
            }
            pen.handle('ball', s.ball, { role: 'soft' }); pen.handle('block', s.block, { role: 'soft' })
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
            // the strip is the screen turned on its side: its left end is the screen's top
            pen.labelPx(x0, y0 + ch + 6, s.mode === 'eye' ? `the picture: ${s.pixels} pixels, one ray each` : 'the picture: still empty (see below)', { role: 'soft' })
            if (s.mode === 'eye') {
                pen.labelPx(x0, y0 - 1, 'top', { role: 'faint', size: 11, base: 'bottom' })
                pen.labelPx(x0 + W, y0 - 1, 'bottom', { role: 'faint', size: 11, base: 'bottom', align: 'right' })
            }
        },
        readout(s) {
            if (s.mode === 'lamp' && s._lamp) return `${s._lamp.n} rays left the lamp · ${s._lamp.k} bounced into the eye (${(100 * s._lamp.k / s._lamp.n).toFixed(1)}%) · too few to give any pixel a value`
            return `${s.pixels} pixels · ${s.pixels} rays · field of view ${s.fov}°`
        },
    },

    edge: {
        aspect: 1.45,
        world: { x: [-0.45, 6.6], y: [-3.15, 2.5] },
        state: { jitter: false, n: 0, hits: 0, us: [], hist: [], width: 12, offset: 0.4, seed: 3 },     // 0.4: the middle ray just misses
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
            pen.line([0, 0], dir(g.a0 - g.w / 2), { role: 'faint', w: 0.9, id: 'w0' })
            pen.line([0, 0], dir(g.a0 + g.w / 2), { role: 'faint', w: 0.9, id: 'w1' })
            pen.label(dir(g.a0 - g.w / 2), 'one pixel sees this wedge', { role: 'soft', size: 13, align: 'right', dy: 14 })
            for (const u of s.us) {
                const a = g.a0 + (u - 0.5) * g.w, hit = hitsBall(s, u)
                const t = hit ? hitT(a) : far
                pen.ray([0, 0], [Math.cos(a) * t, Math.sin(a) * t], { role: hit ? 'cam' : 'soft', w: s.jitter ? 0.8 : 1.4, alpha: hit ? 0.75 : s.jitter ? 0.35 : 0.8, arrow: false })
            }
            if (!s.jitter && s.us.length) pen.label([Math.cos(g.a0) * 4.2, Math.sin(g.a0) * 4.2], 'every try: the same ray, through the middle', { role: 'soft', size: 12, dy: 24 })
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
                hoverX: v => `after ${Math.round(v)} samples`, hoverY: v => v.toFixed(3),
                series: [{ name: 'the ball covers', pts: [[0, g.cover], [400, g.cover]], role: 'accent', w: 1 }, { name: 'the pixel', pts: s.hist, role: 'cam', w: 1.6 }],
            })
            pen.label([6.35, -1.2 - (1 - g.cover) * 1.55], 'what the ball covers', { role: 'accent', size: 12, align: 'right', dy: -9 })
        },
        readout(s) {
            const g = edgeGeom(s)
            return `${s.n} samples · the pixel reads ${(s.n ? s.hits / s.n : 0).toFixed(3)} · the ball covers ${g.cover.toFixed(3)} of its wedge`
        },
    },
}

/* LIGHT AT A SLANT: a beam b wide (b, not w: w is the picture's width in section 10), from a lamp far enough away that its rays are parallel, meets a floor at theta from
   the normal. It lights a patch b / cos(theta) long, so each piece of floor gets cos(theta) of what it would straight
   on: the cosine law, drawn instead of stated. */
figures.slant = {
    aspect: 1.55,
    world: { x: [-3.3, 3.3], y: [-0.85, 3.5] },
    state: { theta: 50 },
    controls: [{ type: 'slider', key: 'theta', label: 'angle from the normal', min: 0, max: 75, step: 1, fmt: v => `${v}°` }],
    steps: { straight: { theta: 0 }, slant: { theta: 60 } },
    drag: { lamp: (s, p) => { s.theta = Math.round(clamp(Math.atan2(-p[0], Math.max(0.05, p[1])) * 180 / Math.PI, 0, 75)) } },
    draw(pen, s) {
        const th = s.theta * Math.PI / 180, c = Math.cos(th), W = 1.1, R = 2.95
        const d = [Math.sin(th), -c], q = [c, Math.sin(th)]           // the light's direction, and across the beam
        pen.flat({ kind: 'box', c: [0, -0.45], h: [3.3, 0.45] }, { id: 'floor' })
        const n = 7, half = W / 2 / c
        for (let k = 0; k < n; k++) {
            const o = -W / 2 + W * k / (n - 1), x = o / c
            pen.ray([x - d[0] * 2.4, -d[1] * 2.4], [x, 0], { role: 'light', w: 1, exact: false, id: 'b' + k })
        }
        pen.line([-half, 0.02], [half, 0.02], { role: 'accent', w: 3.2, exact: true })
        pen.dim([-half, 0], [half, 0], `lit: b / cos θ = ${(W / c).toFixed(2)} m`, { role: 'accent', off: 30 })
        // the beam's own width, across it
        const m = [-d[0] * 1.7, -d[1] * 1.7]
        pen.dim([m[0] - q[0] * W / 2, m[1] - q[1] * W / 2], [m[0] + q[0] * W / 2, m[1] + q[1] * W / 2], `b = ${W.toFixed(2)} m`, { role: 'soft', off: -18 })
        pen.ray([0, 0], [0, 1.45], { role: 'normal', w: 1.1, exact: false, id: 'normal' })
        pen.label([0, 1.45], 'normal', { role: 'normal', size: 13, dx: 8, dy: 4 })
        if (s.theta > 2) pen.angle([0, 0], Math.PI / 2, Math.atan2(-d[1], -d[0]), 0.62, 'θ', { role: 'normal' })
        const lamp = [-d[0] * R, -d[1] * R]
        pen.bulb(lamp)
        pen.handle('lamp', lamp, { label: 'lamp', role: 'light' })
    },
    readout(s) {
        const c = Math.cos(s.theta * Math.PI / 180)
        return `θ = ${s.theta}° · the same beam lights ${(1 / c).toFixed(2)} × its width · each bit of floor gets ${c.toFixed(2)} of the light: cos θ`
    },
}

/* THE SAME IDEA IN 3D (space.js, z up): the screen a grid of W x H pixels, each one's ray marched into a small scene and
   the cell painted with what it found, lit by a lamp with a shadow ray. Drawn from an orbiting camera, so it can be
   turned to see the rays from the side. */
const SCENE3 = {
    sky: SKY,
    shapes: [
        { kind: 'plane', z: 0, rgb: [0.8, 0.76, 0.68] },
        { kind: 'sphere', c: [3.3, 0.45, 0.7], r: 0.7, rgb: [0.86, 0.3, 0.2] },
        { kind: 'box', c: [2.7, -1.15, 0.45], h: [0.45, 0.45, 0.45], round: 0.03, rgb: [0.24, 0.44, 0.86] },
    ],
}
const CAM3 = { eye: [0, 0, 1.25], target: [3, -0.2, 0.45], fov: 0.72 }
const LAMP3 = { p: [2.0, 1.6, 2.3], I: 7 }
const gridSize = s => [s.px, Math.max(2, Math.round(s.px * 0.68))]
/** pixel (i, j)'s ray and what it finds: the hit point and the colour the pixel gets */
function look3(i, j, W, H) {
    const d = cameraRay3(CAM3, i, j, W, H), h = {}
    march3(SCENE3, CAM3.eye, d, { far: 12 }, h)
    if (!h.hit) return { d, hit: null, rgb: SKY }
    const sh = SCENE3.shapes[h.i]
    let n = normal3(SCENE3, h.p, h.i)
    if (v3.dot(n, d) > 0) n = v3.scl(n, -1)
    const E = pointLightE3(SCENE3, LAMP3, h.p, n)
    return { d, hit: h.p, rgb: sh.rgb.map(c => c * (0.08 + 0.55 * E)) }
}
/** a corner of the screen's cell grid, at (x, y) from -1 to 1 across it, `f` in front of the eye */
function screenPoint(x, y, W, H, f = 1.5) {
    const fw = v3.norm(v3.sub(CAM3.target, CAM3.eye)), r = v3.norm(v3.cross(fw, [0, 0, 1])), up = v3.cross(r, fw)
    const fy = Math.tan(CAM3.fov / 2), fx = fy * W / H
    return v3.add(CAM3.eye, v3.scl(v3.add(fw, v3.add(v3.scl(r, x * fx), v3.scl(up, y * fy))), f))
}
figures.grid = {
    aspect: 1.5,
    world: { x: [-1.5, 1.5], y: [-0.95, 1.05] },
    orbit: true,
    state: { yaw: -2.45, pitch: 0.42, px: 8, all: false, sel: [5, 2] },
    controls: [
        { type: 'slider', key: 'px', label: 'pixels across', min: 3, max: 16, step: 1, fmt: v => `${v}` },
        { type: 'toggle', key: 'all', label: 'Every ray' },
    ],
    steps: { grid: { px: 8, all: false, yaw: -2.45, pitch: 0.42 }, all: { all: true, yaw: -2.2, pitch: 0.6 } },
    drag: {
        pixel: (s, p) => {
            const [W, H] = gridSize(s), cam = orbit({ yaw: s.yaw, pitch: s.pitch, dist: 6.2, target: [1.5, -0.3, 0.6] })
            let best = s.sel, bd = Infinity
            for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
                const q = cam.project(screenPoint(((i + 0.5) / W) * 2 - 1, 1 - ((j + 0.5) / H) * 2, W, H))
                const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = [i, j] }
            }
            s.sel = best
        },
    },
    draw(pen, s) {
        const [W, H] = gridSize(s), cam = orbit({ yaw: s.yaw, pitch: s.pitch, dist: 6.2, target: [1.5, -0.3, 0.6] }), g = draw3(pen, cam)
        s.sel = [Math.min(s.sel[0], W - 1), Math.min(s.sel[1], H - 1)]
        // the floor, as lines a metre apart
        for (let x = -1; x <= 5; x++) g.line([x, -2.5, 0], [x, 2, 0], { role: 'faint', w: 0.6, exact: true })
        for (let y = -2.5; y <= 2; y += 0.5) g.line([-1, y, 0], [5, y, 0], { role: 'faint', w: 0.6, exact: true })
        const looks = []
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) looks.push(look3(i, j, W, H))
        // the box's edges and the sphere
        const b = SCENE3.shapes[2], [cx, cy, cz] = b.c, [hx, hy, hz] = b.h
        const V = [-1, 1].flatMap(a => [-1, 1].flatMap(c => [-1, 1].map(e => [cx + a * hx, cy + c * hy, cz + e * hz])))
        for (const [a, c] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) g.line(V[a], V[c], { role: 'solid', w: 1, id: 'box' + a + c })
        g.sphere(SCENE3.shapes[1].c, SCENE3.shapes[1].r, { id: 'ball' })
        // the rays: every one, or the chosen pixel's
        looks.forEach((l, k) => {
            const i = k % W, j = Math.floor(k / W), mine = i === s.sel[0] && j === s.sel[1]
            if (!s.all && !mine) return
            const end = l.hit ?? v3.add(CAM3.eye, v3.scl(l.d, 6))
            g.ray(CAM3.eye, end, { role: 'cam', w: mine ? 1.4 : 0.6, alpha: mine ? 1 : 0.45, arrow: !l.hit && mine })
            if (l.hit) g.dot(l.hit, { role: 'cam', r: mine ? 3.2 : 1.8 })
        })
        // the screen: each cell painted with what its ray found
        const corner = (i, j) => screenPoint((i / W) * 2 - 1, 1 - (j / H) * 2, W, H)
        const ctx = pen.ctx
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
            const q = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)].map(p => pen.P(g.P(p)))
            const c = looks[j * W + i].rgb.map(v => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2)))
            ctx.save(); ctx.globalAlpha = 0.92; ctx.fillStyle = `rgb(${c})`; ctx.beginPath(); q.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill()
            ctx.globalAlpha = 1; ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = i === s.sel[0] && j === s.sel[1] ? 2 : 0.5; ctx.stroke(); ctx.restore()
        }
        const mid = screenPoint(((s.sel[0] + 0.5) / W) * 2 - 1, 1 - ((s.sel[1] + 0.5) / H) * 2, W, H)
        pen.handle('pixel', g.P(mid))
        g.label(corner(0, 0), 'screen', { role: 'soft', size: 13, dy: -10 })
        g.dot(CAM3.eye, { role: 'ink', r: 4 }); g.label(CAM3.eye, 'eye', { size: 14, dx: -30, dy: 2 })
        if (cam.project(LAMP3.p)[2] > 0) { pen.bulb(g.P(LAMP3.p), { r: 6 }); g.label(LAMP3.p, 'lamp', { role: 'light', size: 14, dx: 12 }) }
        // the picture the grid makes, flat
        const pw = Math.min(150, pen.view.W * 0.26), ph = pw * H / W
        pen.image(10, 10, pw, ph, W, H, (i, j) => looks[j * W + i].rgb)
        pen.labelPx(10, 14 + ph, `the picture: ${W} × ${H}`, { role: 'soft', size: 12 })
    },
    readout(s) { const [W, H] = gridSize(s); return `${W} × ${H} pixels, ${W * H} rays · drag the background to turn it` },
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
