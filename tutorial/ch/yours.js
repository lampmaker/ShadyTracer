//======================================================================================================================
// CHAPTER "A ray tracer in one page": its figures, every one running kit/onepage.js, the whole program the chapter
// reads.
//
//   march   one ray from the eye, aimed where you drag: the march's circles, the hit, its normal
//   film    the room's picture, a sample at a time, from onepage.js render(): without and with aiming at the lamp, and
//           with the extension, a mirror wall
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng, tracePath } from '../kit/flatland.js'
import * as P from '../kit/onepage.js'

/* THE ROOM: a floor, a ceiling, two walls, a box, a lamp under the ceiling; the right wall matte or a mirror */
export const roomOf = mirror => [
    { kind: 'box', c: [3.4, -0.3], h: [4.1, 0.3], albedo: 0.7, name: 'floor' },
    { kind: 'box', c: [3.4, 4.4], h: [4.1, 0.3], albedo: 0.7, name: 'ceiling' },
    { kind: 'box', c: [-0.4, 2.05], h: [0.3, 2.65], albedo: 0.7, name: 'left wall' },
    { kind: 'box', c: [7.2, 2.05], h: [0.3, 2.65], albedo: mirror ? 0.95 : 0.7, mirror, name: mirror ? 'mirror' : 'right wall' },
    { kind: 'box', c: [3.6, 0.55], h: [0.55, 0.55], albedo: 0.7, name: 'box' },
    { kind: 'segment', a: [0.9, 3.75], b: [2.4, 3.75], r: 0.015, emit: 1, name: 'lamp' },
]
export const CAM = { eye: [0.35, 1.3], dir: Math.atan2(1.0, 6.55), fov: 64 * Math.PI / 180, pixels: 56 }

/* the film after `samples` samples, cached by setting (it is the expensive part) */
const films = new Map()
export function filmOf(s) {
    const key = `${s.spp}|${s.nee}|${s.mirror}|${s.seed}`
    if (!films.has(key)) { if (films.size > 24) films.clear(); films.set(key, P.render(roomOf(s.mirror === 'on'), CAM, s.spp, rng(s.seed * 7919 + s.spp), { nee: s.nee === 'on', bounces: 4 })) }
    return films.get(key)
}
/* the strips' one scale, the pixel whose path is drawn, and the camera ray through a pixel */
export const WHITE = 0.4, PATH_PX = 14
const F_cameraRay = (i, u) => P.camera(CAM, i, u)
/* what each stretch of the film sees first, from each pixel's middle ray: [{ name, from, to }] */
export function seenSpans(shapes) {
    const out = []
    for (let i = 0; i < CAM.pixels; i++) {
        const [x, y, dx, dy] = P.camera(CAM, i, 0.5), h = P.march(shapes, x, y, dx, dy), name = h ? shapes[h.i].name : 'nothing'
        if (out.length && out[out.length - 1].name === name) out[out.length - 1].to = i; else out.push({ name, from: i, to: i })
    }
    return out
}
const noiseOf = f => { let d = 0, m = 0; for (let i = 0; i < f.length; i++) { m += f[i]; if (i) d += Math.abs(f[i] - f[i - 1]) } m /= f.length; return m ? d / (f.length - 1) / m : 0 }
export { noiseOf }

/* a point on the ray from the eye towards `to`, where it is `x` across: the same aim, held somewhere else */
const along = (to, x) => { const [ex, ey] = CAM.eye, k = (x - ex) / (to[0] - ex); return [x, ey + (to[1] - ey) * k] }

function drawRoom(pen, shapes) {
    for (const s of shapes) {
        if (s.kind === 'segment') pen.line(s.a, s.b, { role: 'light', w: 3, dash: [] })
        else pen.flat({ kind: 'box', c: s.c, h: s.h }, { role: s.mirror ? 'glass' : 'solid' })
    }
}

export const figures = {
    march: {
        aspect: 1.75,
        world: { x: [-0.8, 7.6], y: [-0.7, 4.1] },
        state: { aim: along([3.05, 0.6], 2.0) },
        // straight at the box's side; skimming its top, where every step is short; up at the lamp. The handle sits
        // partway along each ray, so it covers neither the hit nor its labels.
        steps: { hit: { aim: along([3.05, 0.6], 2.0) }, graze: { aim: along([3.3, 1.12], 2.0) }, lamp: { aim: along([1.6, 3.75], 1.0) } },
        drag: { aim: (s, p) => { s.aim = [Math.min(7, Math.max(-0.1, p[0])), Math.min(4.1, Math.max(0, p[1]))] } },
        draw(pen, s) {
            const shapes = roomOf(false)
            drawRoom(pen, shapes)
            const [ex, ey] = CAM.eye, a = Math.atan2(s.aim[1] - ey, s.aim[0] - ex), dx = Math.cos(a), dy = Math.sin(a), steps = []
            const hit = P.march(shapes, ex, ey, dx, dy, { steps })
            // every step: the circle the distance draws, nothing inside it, so the ray may jump to its edge
            for (const q of steps) pen.circle([q.x, q.y], Math.abs(q.d), { role: 'faint', w: 0.8 })
            const end = hit ? [hit.x, hit.y] : [ex + dx * 9, ey + dy * 9]
            pen.line(CAM.eye, end, { role: 'cam', w: 1.4, dash: [] })
            // the steps over the ray, so where they crowd shows
            for (const q of steps) pen.dot([q.x, q.y], { role: 'ink', r: 1.6 })
            pen.eye(CAM.eye, a, { size: 14 })
            if (hit) {
                const [nx, ny] = P.normal(shapes[hit.i], hit.x, hit.y)
                pen.line(end, [end[0] + nx * 0.6, end[1] + ny * 0.6], { role: 'accent', w: 1.6, dash: [] })
                pen.dot(end, { role: 'accent', r: 3.5 })
                // the label beside the arrow's tip, turned a right angle from it: on the tip, an arrow pointing back at the
                // eye would put it on the ray
                pen.label([end[0] + nx * 0.6 - ny * 0.3, end[1] + ny * 0.6 + nx * 0.3], 'normal', { role: 'accent', size: 12, align: 'center' })
            }
            pen.handle('aim', s.aim, { role: 'accent', label: 'drag to aim' })
        },
        readout(s) {
            const shapes = roomOf(false), [ex, ey] = CAM.eye, a = Math.atan2(s.aim[1] - ey, s.aim[0] - ex), hit = P.march(shapes, ex, ey, Math.cos(a), Math.sin(a))
            return hit ? `the ray hits the ${shapes[hit.i].name} in ${hit.n} steps of the march` : 'the ray leaves the room: no hit'
        },
    },

    film: {
        aspect: 1.3,
        world: { x: [-0.8, 7.6], y: [-2.2, 4.75] },
        state: { spp: 1, nee: 'off', mirror: 'off', seed: 1, path: 'off', pathSeed: 2 },
        controls: [
            { type: 'seg', key: 'spp', label: 'samples a pixel', options: [[1, '1'], [4, '4'], [16, '16'], [64, '64']] },
            { type: 'seg', key: 'nee', label: 'aim at the lamp', options: [['off', 'no'], ['on', 'yes (NEE)']] },
            { type: 'seg', key: 'mirror', label: 'the extension', options: [['off', 'matte right wall'], ['on', 'a mirror']] },
            { type: 'seg', key: 'path', label: 'draw', options: [['off', 'the picture'], ['on', 'one path of pixel 15']] },
            { type: 'button', label: 'Other paths', act: s => { s.seed++; s.pathSeed++ } },
        ],
        steps: {
            one: { spp: 1, nee: 'off', mirror: 'off', seed: 1, path: 'off' }, many: { spp: 64, nee: 'off', mirror: 'off', seed: 1, path: 'off' },
            nee: { spp: 16, nee: 'on', mirror: 'off', seed: 1, path: 'off' }, path: { spp: 16, nee: 'on', mirror: 'off', seed: 1, path: 'on', pathSeed: 2 },
            mirror: { spp: 16, nee: 'on', mirror: 'on', seed: 1, path: 'off' },
        },
        draw(pen, s) {
            const shapes = roomOf(s.mirror === 'on'), film = filmOf(s)
            drawRoom(pen, shapes)
            pen.eye(CAM.eye, CAM.dir, { size: 14 })
            // the field of view's edges
            for (const sgn of [-1, 1]) { const a = CAM.dir + sgn * CAM.fov / 2; pen.line(CAM.eye, [CAM.eye[0] + Math.cos(a) * 1.2, CAM.eye[1] + Math.sin(a) * 1.2], { role: 'soft', w: 1, dash: [3, 3] }) }
            // ONE PATH of pixel 15, by flatland.js tracePath with its record: on the same random numbers it is onepage.js's
            // path exactly (the test holds the two pictures to each other), and it says what each leg was
            if (s.path === 'on') {
                const R = rng(s.pathSeed * 104729 + PATH_PX * 31 + 7), rec = [], info = {}, [ox, oy, dx, dy] = F_cameraRay(PATH_PX, R())
                tracePath({ shapes }, ox, oy, dx, dy, { nee: s.nee === 'on', maxBounce: 4, rand: R, record: rec, info })
                let legs = 0, last = null
                for (const r of rec) {
                    if (r.kind === 'shadow' || r.kind === 'blocked') pen.line(r.a, r.b, { role: r.kind === 'shadow' ? 'shadow' : 'blocked', w: 1, dash: [4, 3] })
                    else {
                        pen.line(r.a, r.b, { role: r.lamp ? 'light' : 'accent', w: 1.4, dash: [] }); legs++; last = r.b
                        const m = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2]      // each leg's number at its middle
                        pen.label(m, `${legs}`, { role: 'accent', size: 12, bg: true, align: 'center' })
                    }
                }
                // the label towards the room's middle, so it never runs off an edge
                if (info.end === 'cap' && last) pen.label(last, s.nee === 'on' ? 'the last surface: no aim' : 'the last surface', { role: 'accent', size: 11, bg: true, align: last[0] > 3.4 ? 'right' : 'left', dx: last[0] > 3.4 ? -8 : 8, dy: last[1] > 2 ? 16 : -16 })
            }
            // the picture under the room, on one scale for every setting: white at 0.4 and above
            const x0 = pen.X(-0.6), x1 = pen.X(7.4), y0 = pen.Y(-0.95), sh = pen.view.s * 0.45
            pen.image(x0, y0, x1 - x0, sh, film.length, 1, i => { const v = Math.min(1, film[i] / WHITE); return [v, v, v] })
            pen.labelPx(x0, y0 - 4, `the picture, ${film.length} pixels in a row, each the average of ${s.spp} path${s.spp > 1 ? 's' : ''}; white at ${WHITE} and above`, { role: 'soft', size: 11, base: 'bottom' })
            // under it, what each stretch of pixels looks at first
            seenSpans(shapes).forEach((sp, k) => {
                const a = x0 + sp.from / film.length * (x1 - x0), b = x0 + (sp.to + 1) / film.length * (x1 - x0)
                pen.ctx.save(); pen.ctx.strokeStyle = pen.col('soft'); pen.ctx.lineWidth = 1; pen.ctx.beginPath(); pen.ctx.moveTo(a + 1, y0 + sh + 4); pen.ctx.lineTo(b - 1, y0 + sh + 4); pen.ctx.stroke(); pen.ctx.restore()
                pen.labelPx((a + b) / 2, y0 + sh + 6 + (k % 2) * 11, sp.name, { role: 'soft', size: 9.5, base: 'top', align: 'center' })
            })
            if (s.path === 'on') { const px = x0 + (PATH_PX + 0.5) / film.length * (x1 - x0); pen.labelPx(px, y0 + sh + 30, '▲ pixel 15, its path drawn', { role: 'accent', size: 10, base: 'top', align: 'left' }) }
        },
        readout(s) {
            const f = filmOf(s), m = f.reduce((a, b) => a + b, 0) / f.length
            return `${s.spp} sample${s.spp > 1 ? 's' : ''} a pixel${s.nee === 'on' ? ', aiming at the lamp' : ''}${s.mirror === 'on' ? ', the right wall a mirror' : ''} · the picture's average ${m.toFixed(4)} · its noise, neighbours' difference over the average, ${noiseOf(f).toFixed(3)}`
        },
    },
}

/* THE LAMP'S OUTLINE, drawn large: a capsule like the room's lamp, the point it lights (drag it), and the points
   onepage.js lampPoint draws for it, evenly over the facing side and the two round ends */
export const BIG_LAMP = { kind: 'segment', a: [-1.6, 0], b: [1.6, 0], r: 0.45, emit: 1 }, OUTLINE_K = 28
export function outlineOf(Pt) {
    const pts = []
    for (let k = 0; k < OUTLINE_K; k++) {
        const q = P.lampPoint(BIG_LAMP, Pt[0], Pt[1], (k + 0.5) / OUTLINE_K), vx = q.x - Pt[0], vy = q.y - Pt[1], r = Math.hypot(vx, vy)
        pts.push({ ...q, faces: -(q.mx * vx + q.my * vy) / r > 1e-6 })
    }
    return pts
}
figures.outline = {
    aspect: 1.75,
    world: { x: [-3.4, 3.4], y: [-2.3, 1.6] },
    state: { P: [0.7, -1.7] },
    steps: { below: { P: [0.7, -1.7] }, end: { P: [2.85, -0.25] } },
    drag: { P: (s, p) => { const d = P.segment(p[0], p[1], BIG_LAMP); if (d > 0.15) s.P = [Math.min(3.2, Math.max(-3.2, p[0])), Math.min(1.5, Math.max(-2.2, p[1]))] } },
    draw(pen, s) {
        const L = BIG_LAMP, { ctx } = pen, R = L.r * pen.view.s, pts = outlineOf(s.P), side = (s.P[1] - L.a[1]) >= 0 ? 1 : -1
        // the outline: the long side facing the point and the round ends drawn from; the far side, never drawn from, faint
        const edge = (y, role, w, dash) => pen.line([L.a[0], y], [L.b[0], y], { role, w, dash })
        edge(L.r * side, 'light', 3, []); edge(-L.r * side, 'faint', 1.2, [4, 4])
        ctx.save(); ctx.strokeStyle = pen.col('light'); ctx.lineWidth = 3
        ctx.beginPath(); ctx.arc(pen.X(L.a[0]), pen.Y(L.a[1]), R, Math.PI / 2, 3 * Math.PI / 2); ctx.stroke()
        ctx.beginPath(); ctx.arc(pen.X(L.b[0]), pen.Y(L.b[1]), R, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.restore()
        pen.line(L.a, L.b, { role: 'soft', w: 0.8, dash: [2, 3] })
        pen.label([0, -L.r * side + (side > 0 ? -0.22 : 0.22)], 'the far side: it sends this point nothing, so no point is drawn on it', { role: 'soft', size: 11, align: 'center' })
        pen.label([0, 0.06], 'the middle line', { role: 'soft', size: 10, align: 'center' })
        // the points drawn, the outline's normal at each, and a shadow ray to each that faces the point
        for (const q of pts) {
            if (q.faces) pen.line(s.P, [q.x, q.y], { role: 'shadow', w: 0.7, dash: [3, 3] })
            pen.line([q.x, q.y], [q.x + q.mx * 0.22, q.y + q.my * 0.22], { role: q.faces ? 'light' : 'blocked', w: 1 })
            pen.dot([q.x, q.y], { role: q.faces ? 'light' : 'blocked', r: 2.6 })
        }
        pen.handle('P', s.P, { role: 'accent', label: 'the point lit' })
    },
    readout(s) {
        const pts = outlineOf(s.P), f = pts.filter(q => q.faces).length, seg = Math.hypot(BIG_LAMP.b[0] - BIG_LAMP.a[0], BIG_LAMP.b[1] - BIG_LAMP.a[1])
        return `${OUTLINE_K} points drawn evenly over ${pts[0].len.toFixed(2)} of outline: the facing side ${seg.toFixed(1)} and the round ends 2πr = ${(2 * Math.PI * BIG_LAMP.r).toFixed(2)} · ${f} face the point and send it light, ${OUTLINE_K - f} face away and count 0`
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
