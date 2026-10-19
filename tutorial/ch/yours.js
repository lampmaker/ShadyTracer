//======================================================================================================================
// CHAPTER "A ray tracer in one page": its figures, every one running kit/onepage.js, the whole program the chapter
// reads.
//
//   march   one ray from the eye, aimed where you drag: the march's circles, the hit, its normal
//   film    the room's picture, a sample at a time, from onepage.js render(): without and with aiming at the lamp, and
//           with the extension, a mirror wall
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng } from '../kit/flatland.js'
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
            for (const q of steps) { pen.circle([q.x, q.y], Math.abs(q.d), { role: 'faint', w: 0.8 }); pen.dot([q.x, q.y], { role: 'cam', r: 2 }) }
            const end = hit ? [hit.x, hit.y] : [ex + dx * 9, ey + dy * 9]
            pen.line(CAM.eye, end, { role: 'cam', w: 1.4, dash: [] })
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
        aspect: 1.75,
        world: { x: [-0.8, 7.6], y: [-1.6, 4.1] },
        state: { spp: 1, nee: 'off', mirror: 'off', seed: 1 },
        controls: [
            { type: 'seg', key: 'spp', label: 'samples a pixel', options: [[1, '1'], [4, '4'], [16, '16'], [64, '64']] },
            { type: 'seg', key: 'nee', label: 'aim at the lamp', options: [['off', 'no'], ['on', 'yes (NEE)']] },
            { type: 'seg', key: 'mirror', label: 'the extension', options: [['off', 'matte right wall'], ['on', 'a mirror']] },
            { type: 'button', label: 'Other paths', act: s => { s.seed++ } },
        ],
        steps: { one: { spp: 1, nee: 'off', mirror: 'off', seed: 1 }, many: { spp: 64, nee: 'off', mirror: 'off', seed: 1 }, nee: { spp: 16, nee: 'on', mirror: 'off', seed: 1 }, mirror: { spp: 16, nee: 'on', mirror: 'on', seed: 1 } },
        draw(pen, s) {
            const shapes = roomOf(s.mirror === 'on'), film = filmOf(s)
            drawRoom(pen, shapes)
            pen.eye(CAM.eye, CAM.dir, { size: 14 })
            // the field of view's edges
            for (const sgn of [-1, 1]) { const a = CAM.dir + sgn * CAM.fov / 2; pen.line(CAM.eye, [CAM.eye[0] + Math.cos(a) * 1.2, CAM.eye[1] + Math.sin(a) * 1.2], { role: 'soft', w: 1, dash: [3, 3] }) }
            // the picture under the room, brightest pixel white
            const top = Math.max(...film) || 1, x0 = pen.X(-0.6), x1 = pen.X(7.4), y0 = pen.Y(-0.95)
            pen.image(x0, y0, x1 - x0, pen.view.s * 0.45, film.length, 1, i => { const v = film[i] / top; return [v, v, v] })
            pen.labelPx(x0, y0 - 4, `the picture, ${film.length} pixels, each the average of ${s.spp} path${s.spp > 1 ? 's' : ''}`, { role: 'soft', size: 11, base: 'bottom' })
        },
        readout(s) {
            const f = filmOf(s), m = f.reduce((a, b) => a + b, 0) / f.length
            return `${s.spp} sample${s.spp > 1 ? 's' : ''} a pixel${s.nee === 'on' ? ', aiming at the lamp' : ''}${s.mirror === 'on' ? ', the right wall a mirror' : ''} · the picture's average ${m.toFixed(4)} · its noise, neighbours' difference over the average, ${noiseOf(f).toFixed(3)}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
