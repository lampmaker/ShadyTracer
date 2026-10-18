//======================================================================================================================
// CHAPTER "The camera's lens": its figures.
//
//   thin   the thin lens seen from the side: a disc (here a line) of the lens's width round the eye, the plane it is
//          focused on, and a point you drag. Rays from points across the lens to the point land on the picture at
//          different places -- its blur -- worked out by lens.js's own lensImage, against 2R |1/F - 1/D|.
//   dof    a 3D picture through the lens: three balls at three distances, the focus and the lens's radius yours. Each sample
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
// finer than the figures' usual films: at 84 x 52 the pinhole's sharp edges were jagged, and a reader could not tell
// the blockiness from the blur
const FILM = [128, 80]
// samples a pixel to settle: through a lens the picture is an average over it; a pinhole has nothing to average
const settle = R => R > 0 ? 48 : 4
/** the distance from the eye along its axis to a ball's centre: what to focus on to make it sharp */
const along = c => { const f = [CAM3.target[0] - CAM3.eye[0], CAM3.target[1] - CAM3.eye[1], CAM3.target[2] - CAM3.eye[2]], l = Math.hypot(...f); return ((c[0] - CAM3.eye[0]) * f[0] + (c[1] - CAM3.eye[1]) * f[1] + (c[2] - CAM3.eye[2]) * f[2]) / l }
export const BALL_DEPTHS = WORLD3.shapes.slice(1).map(s => along(s.c))

export const figures = {
    thin: {
        aspect: 1.7,
        world: { x: [-0.9, 10.4], y: [-3.3, 3.35] },
        // the point low enough that its streak, at the near step, stays inside the picture (at a height of 0.9 its top
        // left the picture, and a reader could not tell whether it was cut off)
        state: { R: 0.6, F: 6, P: [3.2, 0.5] },
        controls: [
            { type: 'slider', key: 'R', label: 'lens radius R', min: 0, max: 1.2, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'F', label: 'focus F', min: 2, max: 9.5, step: 0.1, fmt: v => v.toFixed(1) },
        ],
        steps: {
            focused: { R: 0.6, F: 6, P: [6, 0.9] },
            near: { R: 0.6, F: 6, P: [3.2, 0.5] },
            pinhole: { R: 0, F: 6, P: [3.2, 0.5] },
        },
        drag: {
            P: (s, p) => { s.P = [clamp(p[0], 1.2, 10), clamp(p[1], -2.6, 2.6)] },
            // the focus plane by its foot, as the slider moves it
            F: (s, p) => { s.F = Math.round(clamp(p[0], 2, 9.5) * 10) / 10 },
        },
        draw(pen, s) {
            const [D, h] = s.P
            // the axis, the focus plane, the lens
            pen.line([-0.6, 0], [10.2, 0], { role: 'faint', w: 0.7, dash: [2, 5], exact: true })
            pen.label([7.6, -0.18], 'the axis', { role: 'faint', size: 11 })
            // the renderer's picture: one unit in front of the eye, tan(fov/2) each way (the column at the right is it,
            // drawn larger)
            pen.line([1, -FY], [1, FY], { role: 'soft', w: 2, cap: 'butt', exact: true, id: 'plane' })
            pen.label([1, -FY - 0.12], 'picture, 1 out', { role: 'soft', size: 11, align: 'center' })
            pen.line([s.F, -3.1], [s.F, 3.1], { role: 'accent', w: 1, dash: [6, 5], id: 'focus' })
            pen.label([s.F, 3.15], 'in focus', { role: 'accent', size: 13, align: 'center' })
            pen.handle('F', [s.F, -2.95], { role: 'accent', label: 'F' })
            if (s.R > 0) pen.line([0, -s.R], [0, s.R], { role: 'glass', w: 5, cap: 'butt', exact: true })
            pen.eye([-0.35, 0], 0, { size: 16 })
            // rays from points across the lens through the point, on to the focus plane
            // the ray from the lens's top edge in its own colour, and where it lands on the picture in the same: one ray
            // followed from the lens to its pixel
            const N = s.R > 0 ? 9 : 1
            for (let k = 0; k < N; k++) {
                const a = N === 1 ? 0 : -s.R + 2 * s.R * k / (N - 1), dx = D, dy = h - a, t = s.F / dx, top = k === N - 1 && N > 1
                pen.ray([0, a], [D, h], { role: top ? 'shadow' : 'cam', w: top ? 1.5 : 1, arrow: false, exact: true })
                pen.line([D, h], [s.F, a + dy * t], { role: top ? 'shadow' : 'cam', w: top ? 1.1 : 0.7, dash: [3, 4], exact: true })
            }
            pen.dot([D, h], { role: 'light', r: 5 })
            pen.handle('P', [D, h], { label: 'the point' })
            // the picture, a column at the right: where each lens point sees the point
            const px = pen.X(10.0), top = pen.Y(2.6), bot = pen.Y(-2.6), mid = (top + bot) / 2, half = (bot - top) / 2
            const { ctx } = pen
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.strokeRect(px - 8, top, 16, bot - top)
            const ys = Array.from({ length: N }, (_, k) => seenAt(N === 1 ? 0 : -s.R + 2 * s.R * k / (N - 1), D, h, s.F))
            // the streak, kept to the picture: a part beyond its edge is off the picture, as it would be
            const y0 = Math.max(-1, Math.min(...ys)), y1 = Math.min(1, Math.max(...ys))
            ctx.fillStyle = pen.col('light'); ctx.globalAlpha = 0.85
            if (y1 >= y0) ctx.fillRect(px - 8, mid - y1 * half - 1.5, 16, Math.max(3, (y1 - y0) * half))
            ctx.globalAlpha = 1
            if (N > 1 && Math.abs(ys[N - 1]) <= 1) { ctx.strokeStyle = pen.col('shadow'); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(px - 13, mid - ys[N - 1] * half); ctx.lineTo(px + 13, mid - ys[N - 1] * half); ctx.stroke() }
            ctx.restore()
            pen.labelPx(px + 12, bot + 8, 'the picture', { role: 'soft', size: 12, align: 'right' })
            pen.labelPx(px + 12, bot + 22, '(where it lands)', { role: 'soft', size: 11, align: 'right' })
        },
        readout(s) {
            const [D, h] = s.P, seen = blurSeen(s.R, D, h, s.F), px = seen / 2 * PICTURE_PX, raw = 2 * s.R * Math.abs(1 / s.F - 1 / D)
            return `point at distance D = ${D.toFixed(2)}, focus F = ${s.F.toFixed(1)}, lens radius R = ${s.R.toFixed(2)} · 2R|1/F − 1/D| = ${raw.toFixed(4)}, ÷ tan(fov/2) = ${FY.toFixed(3)}: ${blurFormula(s.R, D, s.F).toFixed(4)} of the picture's half-height (measured from the rays: ${seen.toFixed(4)}) · ${px < 1 ? 'under a pixel' : `${px.toFixed(0)} pixels`} in a picture 1000 high`
        },
    },

    dof: {
        aspect: FILM[0] / FILM[1],
        world: { x: [0, 1], y: [0, 1] },
        // the lens by its radius R, as in the first figure (ShadyTracer's camera settings ask for the aperture, twice it)
        state: { R: 0.125, focus: 'blue', max: 48, spp: 0 },
        controls: [
            { type: 'seg', key: 'focus', label: 'focused on', options: [['red', 'The near ball (red)'], ['blue', 'The middle (blue)'], ['gold', 'The far ball (gold)']] },
            { type: 'slider', key: 'R', label: 'lens radius R (m)', min: 0, max: 0.3, step: 0.025, fmt: v => v.toFixed(3) },
            { type: 'seg', key: 'max', label: 'samples', options: [[2, 'the first 2'], [48, 'until settled']] },
        ],
        steps: {
            pinhole: { R: 0, focus: 'blue', max: 48 }, middle: { R: 0.125, focus: 'blue', max: 48 }, near: { R: 0.125, focus: 'red', max: 48 },
            grain: { R: 0.3, focus: 'red', max: 2 }, wide: { R: 0.3, focus: 'red', max: 48 },
        },
        budget: 14,
        work: {
            reset(s) { s.spp = 0; s.acc = new Float32Array(FILM[0] * FILM[1] * 3) },
            add(s, ms) {
                const t0 = performance.now(), F = BALL_DEPTHS[['red', 'blue', 'gold'].indexOf(s.focus)], R = s.R, [W, H] = FILM, cap = Math.min(settle(R), s.max)
                do {
                    const rnd = rng(1000003 * (s.spp + 1) + 17)
                    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
                        const ray = cameraRayLens(CAM3, i, j, W, H, rnd(), rnd(), R, F, rnd(), rnd())
                        const c = shade3(WORLD3, ray.o, ray.d, { view: 'sun' }).rgb, k = (j * W + i) * 3
                        s.acc[k] += c[0]; s.acc[k + 1] += c[1]; s.acc[k + 2] += c[2]
                    }
                    s.spp++
                } while (performance.now() - t0 < ms && s.spp < cap)
                return s.spp < cap
            },
        },
        draw(pen, s) {
            const [W, H] = FILM, n = Math.max(1, s.spp)
            pen.image(0, 0, pen.view.W, pen.view.H, W, H, (i, j) => { const k = (j * W + i) * 3; return [s.acc[k] / n, s.acc[k + 1] / n, s.acc[k + 2] / n] })
        },
        readout(s) {
            const F = BALL_DEPTHS[['red', 'blue', 'gold'].indexOf(s.focus)]
            const of = s.max < settle(s.R) ? `, stopped at ${s.max} of the ${settle(s.R)} that settle it` : ` (${s.R > 0 ? '48 to settle the blur' : '4 are enough: nothing to average over the lens'})`
            return `${s.spp} sample${s.spp === 1 ? '' : 's'} a pixel${of} · focused at ${F.toFixed(2)} m (the red, blue and gold balls are at ${BALL_DEPTHS.map(d => d.toFixed(2)).join(', ')} m) · lens radius ${s.R.toFixed(3)} m, an aperture of ${(2 * s.R).toFixed(2)} m${s.R === 0 ? ': a pinhole, everything sharp' : ''}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
