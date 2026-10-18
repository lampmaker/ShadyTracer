//======================================================================================================================
// CHAPTER "The camera's lens": its figures.
//
//   thin   the thin lens seen from the side: a disc (here a line) of the lens's width round the eye, the plane it is
//          focused on, and a point you drag. Rays from points across the lens to the point land on the picture at
//          different places -- its blur -- worked out by lens.js's own lensImage, against 2R |1/F - 1/D|.
//   dof    a 3D picture through the lens: three balls at three distances, the focus and the aperture yours. Each sample
//          a ray per pixel from a random point of the lens (space.js cameraRayLens: lens.js's lensDisc and lensRay)
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng } from '../kit/flatland.js'
import { cameraRayLens, shade3 } from '../kit/space.js'
import { lensImage } from '../../lib/pathtracer/core/lens.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/* THE SIDE VIEW in lens.js's terms: the eye at the origin looking along +x, "up" the figure's y; the picture's
   half-height is tan(fov / 2) at distance 1 (fy), so a picture coordinate of 1 is its top edge */
const FOV = 40 * Math.PI / 180, FY = Math.tan(FOV / 2)
export const sideCam = F => ({ pos: [0, 0, 0], right: [0, 0, 1], up: [0, 1, 0], fwd: [-1, 0, 0], fx: FY, fy: FY, F })
/** where on the picture (-1 bottom to 1 top) a lens point a sees the point (D, h): lens.js lensImage */
export function seenAt(a, D, h, F) {
    const Y = [0, a, 0], v = [D, h - a, 0], l = Math.hypot(v[0], v[1])
    return lensImage(Y, [v[0] / l, v[1] / l, 0], sideCam(F))[1]
}
/** the blur: the spread of the picture points across the lens, against the thin lens's 2R |1/F - 1/D| / fy */
export const blurFormula = (R, D, F) => 2 * R * Math.abs(1 / F - 1 / D) / FY
export const blurSeen = (R, D, h, F) => Math.abs(seenAt(R, D, h, F) - seenAt(-R, D, h, F))
const PICTURE_PX = 1000                     // a picture 1000 pixels high, to say the blur in pixels

/* THE 3D SCENE: a floor and three balls in a row going away from the camera */
const WORLD3 = {
    sky: [0.62, 0.72, 0.85],
    shapes: [
        { kind: 'plane', z: 0, rgb: [0.78, 0.76, 0.7] },
        { kind: 'sphere', c: [2.6, -0.9, 0.45], r: 0.45, rgb: [0.86, 0.3, 0.2] },
        { kind: 'sphere', c: [5.2, 0.0, 0.45], r: 0.45, rgb: [0.24, 0.44, 0.86] },
        { kind: 'sphere', c: [9.0, 1.6, 0.45], r: 0.45, rgb: [0.9, 0.7, 0.25] },
    ],
}
const CAM3 = { eye: [-1, 0, 1.0], target: [5.2, 0.1, 0.45], fov: 0.62 }
const FILM = [84, 52]
/** the distance from the eye along its axis to a ball's centre: what to focus on to make it sharp */
const along = c => { const f = [CAM3.target[0] - CAM3.eye[0], CAM3.target[1] - CAM3.eye[1], CAM3.target[2] - CAM3.eye[2]], l = Math.hypot(...f); return ((c[0] - CAM3.eye[0]) * f[0] + (c[1] - CAM3.eye[1]) * f[1] + (c[2] - CAM3.eye[2]) * f[2]) / l }
export const BALL_DEPTHS = WORLD3.shapes.slice(1).map(s => along(s.c))

export const figures = {
    thin: {
        aspect: 1.7,
        world: { x: [-0.9, 10.4], y: [-3.3, 3.35] },
        state: { R: 0.6, F: 6, P: [3.2, 0.9] },
        controls: [
            { type: 'slider', key: 'R', label: 'lens radius R', min: 0, max: 1.2, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'F', label: 'focus F', min: 2, max: 9.5, step: 0.1, fmt: v => v.toFixed(1) },
        ],
        steps: {
            focused: { R: 0.6, F: 6, P: [6, 0.9] },
            near: { R: 0.6, F: 6, P: [3.2, 0.9] },
            pinhole: { R: 0, F: 6, P: [3.2, 0.9] },
        },
        drag: { P: (s, p) => { s.P = [clamp(p[0], 1.2, 10), clamp(p[1], -2.6, 2.6)] } },
        draw(pen, s) {
            const [D, h] = s.P
            // the axis, the focus plane, the lens
            pen.line([-0.6, 0], [10.2, 0], { role: 'faint', w: 0.7, dash: [2, 5], exact: true })
            pen.line([s.F, -3.1], [s.F, 3.1], { role: 'accent', w: 1, dash: [6, 5], id: 'focus' })
            pen.label([s.F, 3.15], 'in focus', { role: 'accent', size: 13, align: 'center' })
            if (s.R > 0) pen.line([0, -s.R], [0, s.R], { role: 'glass', w: 5, cap: 'butt', exact: true })
            pen.eye([-0.35, 0], 0, { size: 16 })
            // rays from points across the lens through the point, on to the focus plane
            const N = s.R > 0 ? 9 : 1
            for (let k = 0; k < N; k++) {
                const a = N === 1 ? 0 : -s.R + 2 * s.R * k / (N - 1), dx = D, dy = h - a, t = s.F / dx
                pen.ray([0, a], [D, h], { role: 'cam', w: 1, arrow: false, exact: true })
                pen.line([D, h], [s.F, a + dy * t], { role: 'cam', w: 0.7, dash: [3, 4], exact: true })
            }
            pen.dot([D, h], { role: 'light', r: 5 })
            pen.handle('P', [D, h])
            // the picture, a column at the right: where each lens point sees the point
            const px = pen.X(10.0), top = pen.Y(2.6), bot = pen.Y(-2.6), mid = (top + bot) / 2, half = (bot - top) / 2
            const { ctx } = pen
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.strokeRect(px - 8, top, 16, bot - top)
            const ys = Array.from({ length: N }, (_, k) => seenAt(N === 1 ? 0 : -s.R + 2 * s.R * k / (N - 1), D, h, s.F))
            const y0 = Math.min(...ys), y1 = Math.max(...ys)
            ctx.fillStyle = pen.col('light'); ctx.globalAlpha = 0.85
            ctx.fillRect(px - 8, mid - y1 * half - 1.5, 16, Math.max(3, (y1 - y0) * half))
            ctx.restore()
            pen.labelPx(px - 46, bot + 8, 'the picture', { role: 'soft', size: 12 })
        },
        readout(s) {
            const [D, h] = s.P, seen = blurSeen(s.R, D, h, s.F), px = seen / 2 * PICTURE_PX
            return `point at distance D = ${D.toFixed(2)}, focus F = ${s.F.toFixed(1)}, lens radius ${s.R.toFixed(2)} · blur ${seen.toFixed(4)} of the picture's half-height, 2R|1/F − 1/D| / tan(fov/2) = ${blurFormula(s.R, D, s.F).toFixed(4)} · ${px < 1 ? 'under a pixel' : `${px.toFixed(0)} pixels`} in a picture 1000 high`
        },
    },

    dof: {
        aspect: FILM[0] / FILM[1],
        world: { x: [0, 1], y: [0, 1] },
        state: { aperture: 0.25, focus: 'blue', spp: 0 },
        controls: [
            { type: 'seg', key: 'focus', label: 'focused on', options: [['red', 'The near ball'], ['blue', 'The middle'], ['gold', 'The far ball']] },
            { type: 'slider', key: 'aperture', label: 'aperture (diameter)', min: 0, max: 0.6, step: 0.05, fmt: v => v.toFixed(2) },
        ],
        steps: { pinhole: { aperture: 0, focus: 'blue' }, middle: { aperture: 0.25, focus: 'blue' }, near: { aperture: 0.25, focus: 'red' }, wide: { aperture: 0.6, focus: 'red' } },
        budget: 14,
        work: {
            reset(s) { s.spp = 0; s.acc = new Float32Array(FILM[0] * FILM[1] * 3) },
            add(s, ms) {
                const t0 = performance.now(), F = BALL_DEPTHS[['red', 'blue', 'gold'].indexOf(s.focus)], R = s.aperture / 2, [W, H] = FILM
                do {
                    const rnd = rng(1000003 * (s.spp + 1) + 17)
                    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
                        const ray = cameraRayLens(CAM3, i, j, W, H, rnd(), rnd(), R, F, rnd(), rnd())
                        const c = shade3(WORLD3, ray.o, ray.d, { view: 'sun' }).rgb, k = (j * W + i) * 3
                        s.acc[k] += c[0]; s.acc[k + 1] += c[1]; s.acc[k + 2] += c[2]
                    }
                    s.spp++
                } while (performance.now() - t0 < ms && s.spp < (s.aperture > 0 ? 48 : 4))
                return s.spp < (s.aperture > 0 ? 48 : 4)
            },
        },
        draw(pen, s) {
            const [W, H] = FILM, n = Math.max(1, s.spp)
            pen.image(0, 0, pen.view.W, pen.view.H, W, H, (i, j) => { const k = (j * W + i) * 3; return [s.acc[k] / n, s.acc[k + 1] / n, s.acc[k + 2] / n] })
        },
        readout(s) {
            const F = BALL_DEPTHS[['red', 'blue', 'gold'].indexOf(s.focus)]
            return `${s.spp} sample${s.spp === 1 ? '' : 's'} a pixel · focused at ${F.toFixed(2)} (the balls are at ${BALL_DEPTHS.map(d => d.toFixed(2)).join(', ')}) · aperture ${s.aperture.toFixed(2)}${s.aperture === 0 ? ': a pinhole, everything sharp' : ''}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
