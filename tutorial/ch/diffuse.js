//======================================================================================================================
// CHAPTER "Diffuse and mirror": its figures.
//
//   matte    one point of a matte floor under a lamp you drag: the light it sends back, spread so it looks equally
//            bright from everywhere -- directions drawn the way the renderer draws a matte bounce (cosine-weighted,
//            flatland.js cosineDir), and the intensity's circle, cos theta in every direction
//   mirror   a room whose right wall is matte or a mirror, rendered with next event estimation: the mirror shows the
//            lamp, which no shadow ray can find through it, so only the bounce that happens to go there brings it
//   furnace  the white furnace: two shapes in a sky of brightness 1 everywhere; an albedo-1 surface sends back exactly
//            what it gets, so the shapes vanish, and any loss shows
//
// The flat world's path tracer (kit/flatland.js tracePath), its mirrors added for this chapter.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng, tracePath, cameraRay, cosineDir } from '../kit/flatland.js'
import { stepMoments, standardError } from '../../lib/pathtracer/core/measure.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const DEG = Math.PI / 180

/* ONE POINT OF A MATTE FLOOR: the lamp a distance LAMP_D away at an angle from the normal, intensity 1 (per radian, the
   flat world's: chapter 0) */
const LAMP_D = 2.6
export const lampAt = a => [LAMP_D * Math.sin(a * DEG), LAMP_D * Math.cos(a * DEG)]
/** the illuminance a lamp of intensity 1 at angle a puts on the point (flat world: I cos / d), and the radiance the
 *  floor then sends every way, rho E / 2 (3D: rho E / pi) */
export const matteOut = (a, rho) => { const E = Math.cos(a * DEG) / LAMP_D; return { E, L: rho * E / 2 } }

/* THE ROOM: matte walls (albedo 0.7), a lamp near the ceiling, and a right wall that is matte or a mirror */
export const roomOf = wall => ({
    sky: 0,
    shapes: [
        { kind: 'box', c: [3.4, -0.3], h: [4.1, 0.3], albedo: 0.7, name: 'floor' },
        { kind: 'box', c: [3.4, 4.4], h: [4.1, 0.3], albedo: 0.7, name: 'ceiling' },
        { kind: 'box', c: [-0.4, 2.05], h: [0.3, 2.65], albedo: 0.7, name: 'left' },
        { kind: 'box', c: [7.2, 2.05], h: [0.3, 2.65], albedo: wall === 'mirror' ? 0.95 : 0.7, mirror: wall === 'mirror', name: 'right' },
        { kind: 'box', c: [3.6, 0.55], h: [0.55, 0.55], round: 0.04, albedo: 0.7, name: 'box' },
        { kind: 'segment', a: [0.9, 3.75], b: [2.4, 3.75], r: 0.015, emit: 1, name: 'lamp' },
    ],
})
const PIX = 56
const CAM = { eye: [0.35, 1.3], dir: Math.atan2(2.3 - 1.3, 6.9 - 0.35), fov: 64 * DEG, pixels: PIX }

/* THE FURNACE: two discs close together in a sky of brightness 1, matte or mirror, of one albedo; the camera above and
   to the left, so it sees the gap between them, where light bounces more than once */
export const furnaceOf = (rho, surface) => ({
    sky: 1,
    shapes: [
        { kind: 'circle', c: [2.6, 1.5], r: 0.95, albedo: rho, mirror: surface === 'mirror', name: 'left disc' },
        { kind: 'circle', c: [4.45, 1.3], r: 0.85, albedo: rho, mirror: surface === 'mirror', name: 'right disc' },
    ],
})
const FCAM = { eye: [0.2, 3.3], dir: Math.atan2(1.4 - 3.3, 3.5 - 0.2), fov: 62 * DEG, pixels: PIX }

/* MANY PATHS through every pixel, a sample at a time: each pixel's running mean and spread (measure.js, as the
   renderer keeps them), and the latest few paths for drawing */
const moments = () => ({ Y: 0, V: 0, S: 0, cnt: 0 })
function film(s, world, cam, ms, opts) {
    const t0 = performance.now()
    do {
        const R = rng(s.seed * 1000003 + s.spp * 7919)
        for (let i = 0; i < PIX; i++) {
            const [ox, oy, dx, dy] = cameraRay(cam, i, R()), rec = s.spp === 0 && i % 7 === 3 ? [] : null
            const L = tracePath(world, ox, oy, dx, dy, { rand: R, record: rec, ...opts })
            s.pix[i] = stepMoments(s.pix[i], L)
            if (rec) s.shown.push(rec)
        }
        s.spp++
    } while (performance.now() - t0 < ms && s.spp < s.max)
    return s.spp < s.max
}
const mean = pix => pix.reduce((a, p) => a + p.Y, 0) / pix.length
/** a run to the end, for the readout and the test: the film's pixels after `max` samples */
export function render(kind, s) {
    const r = { seed: s.seed ?? 1, spp: 0, max: s.max ?? 64, pix: Array.from({ length: PIX }, moments), shown: [] }
    if (kind === 'mirror') film(r, roomOf(s.wall), CAM, 1e9, { nee: true, maxBounce: 6 })
    else film(r, furnaceOf(s.rho, s.surface), FCAM, 1e9, { maxBounce: s.cap })
    return r
}

/** a film drawn as a strip of grey pixels under the figure, brightness `k` times the value (1 is white) */
function strip(pen, pix, x0, y0, x1, h, k, label) {
    pen.image(pen.X(x0), pen.Y(y0), pen.X(x1) - pen.X(x0), pen.view.s * h, PIX, 1, i => { const v = k * pix[i].Y; return [v, v, v] })
    pen.labelPx(pen.X(x0), pen.Y(y0 - h) + 4, label, { role: 'soft', size: 11 })
}

export const figures = {
    matte: {
        aspect: 1.75,
        world: { x: [-3.4, 3.4], y: [-0.6, 3.3] },
        state: { lampA: 35, rho: 0.7, seed: 3 },
        controls: [
            { type: 'slider', key: 'rho', label: 'albedo ρ', min: 0, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'button', label: 'New directions', act: s => { s.seed++ } },
        ],
        steps: { slant: { lampA: 35, rho: 0.7, seed: 3 }, grazing: { lampA: 75, rho: 0.7, seed: 3 } },
        drag: { lampA: (s, p) => { s.lampA = Math.round(clamp(Math.atan2(p[0], Math.max(p[1], 0.05)) / DEG, -80, 80)) } },
        draw(pen, s) {
            const L = lampAt(s.lampA), R = rng(s.seed * 104729 + 7), { L: Lout } = matteOut(s.lampA, s.rho)
            pen.flat({ kind: 'box', c: [0, -0.3], h: [3.2, 0.3] }, { id: 'floor' })
            // the bounce's directions, cosine-weighted as the renderer draws a matte bounce: crowded near the normal
            for (let k = 0; k < 48; k++) { const [dx, dy] = cosineDir(0, 1, R()); pen.ray([0, 0], [dx * 2.2, dy * 2.2], { role: 'cam', w: 0.7, alpha: 0.55, arrow: false, exact: true }) }
            // the intensity going out every way: cos theta, a circle touching the floor at the point, as big as rho
            const D = 2.4 * s.rho * Math.cos(s.lampA * DEG)
            if (D > 0.01) pen.circle([0, D / 2], D / 2, { role: 'accent', w: 1.6, dash: [6, 4], exact: true, id: 'lobe' })
            pen.ray(L, [0, 0], { role: 'light', w: 1.6, id: 'in' })
            pen.bulb(L, { r: 6 })
            pen.handle('lampA', [L[0] * 1.12, L[1] * 1.12], { role: 'light' })
            pen.dot([0, 0], { role: 'ink', r: 3.5 })
            pen.line([0, 0], [0, 3.05], { role: 'normal', w: 1, dash: [2, 3], exact: true })
            pen.label([0.12, 3.05], 'normal', { role: 'normal', size: 12 })
            // pointing above the floor: the angle there, and what the floor looks like from it
            const q = pen.hover({ x: pen.X(-3.4), y: pen.Y(3.3), w: pen.X(3.4) - pen.X(-3.4), h: pen.Y(0) - pen.Y(3.3) })
            if (q) {
                const x = (q.x - pen.X(0)) / pen.view.s, y = (pen.Y(0) - q.y) / pen.view.s, th = Math.atan2(x, y) / DEG
                pen.tip(q.x, q.y, [`seen from ${Math.abs(th).toFixed(0)}° off the normal`, `the floor looks as bright: ${Lout.toFixed(4)}`, `its intensity that way: ∝ cos ${Math.abs(th).toFixed(0)}° = ${Math.cos(th * DEG).toFixed(2)}`])
            }
        },
        readout(s) {
            const { E, L } = matteOut(s.lampA, s.rho)
            return `the lamp ${Math.abs(s.lampA)}° off the normal puts E = cos ${Math.abs(s.lampA)}° / ${LAMP_D} = ${E.toFixed(4)} on the point · it sends back ρE = ${(s.rho * E).toFixed(4)} in all, looking the same from every direction: ρE/2 = ${L.toFixed(4)} (the flat world's; in 3D ρE/π)`
        },
    },

    mirror: {
        aspect: 1.32,
        world: { x: [-0.9, 7.7], y: [-1.6, 4.95] },
        state: { wall: 'matte', seed: 1, spp: 0, max: 96 },
        controls: [{ type: 'seg', key: 'wall', label: 'right wall', options: [['matte', 'Matte'], ['mirror', 'A mirror']] }],
        steps: { matte: { wall: 'matte' }, mirror: { wall: 'mirror' } },
        work: {
            reset(s) { s.spp = 0; s.pix = Array.from({ length: PIX }, moments); s.shown = [] },
            add(s, ms) { return film(s, roomOf(s.wall), CAM, ms, { nee: true, maxBounce: 6 }) },
        },
        draw(pen, s) {
            for (const sh of roomOf(s.wall).shapes) pen.flat(sh, { id: sh.name, role: sh.mirror ? 'glass' : 'solid' })
            for (const rec of s.shown) for (const seg of rec) pen.ray(seg.a, seg.b, { role: seg.kind === 'shadow' ? 'shadow' : seg.kind === 'blocked' ? 'blocked' : seg.lamp ? 'light' : 'cam', w: 0.7, alpha: 0.5, arrow: false, exact: true })
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
            if (s.wall === 'mirror') pen.label([6.6, 4.0], 'mirror', { role: 'glass', size: 13, align: 'right' })
            strip(pen, s.pix, 0, -0.75, 7, 0.45, 2.5, 'the eye\'s picture, 56 pixels, left to right as the eye sees')
        },
        readout(s) {
            const top = s.pix.reduce((b, p, i) => p.Y > s.pix[b].Y ? i : b, 0)
            return `${s.spp} sample${s.spp === 1 ? '' : 's'} a pixel, aiming at the lamp at every matte bounce · the picture's average ${mean(s.pix).toFixed(4)} · brightest pixel ${top + 1}: ${s.pix[top].Y.toFixed(3)}`
        },
    },

    furnace: {
        // tall enough for the eye above the discs (at first it sat above the top edge, and the paths came from nowhere)
        aspect: 1.27,
        world: { x: [-0.6, 6.0], y: [-1.45, 3.75] },
        state: { rho: 1, surface: 'matte', cap: 40, seed: 1, spp: 0, max: 48 },
        controls: [
            { type: 'slider', key: 'rho', label: 'albedo ρ', min: 0, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'seg', key: 'surface', options: [['matte', 'Matte'], ['mirror', 'Mirror']] },
            { type: 'slider', key: 'cap', label: 'bounce limit', min: 1, max: 40, step: 1, fmt: v => String(v) },
        ],
        steps: {
            white: { rho: 1, surface: 'matte', cap: 40 }, grey: { rho: 0.7, surface: 'matte', cap: 40 },
            cap: { rho: 1, surface: 'matte', cap: 1 }, control: { rho: 0, surface: 'matte', cap: 40 },
        },
        work: {
            reset(s) { s.spp = 0; s.pix = Array.from({ length: PIX }, moments); s.shown = [] },
            add(s, ms) { return film(s, furnaceOf(s.rho, s.surface), FCAM, ms, { maxBounce: s.cap }) },
        },
        draw(pen, s) {
            const { ctx } = pen
            ctx.save(); ctx.fillStyle = pen.col('soft'); ctx.globalAlpha = 0.08; ctx.fillRect(0, 0, pen.view.W, pen.Y(-0.45)); ctx.restore()
            pen.label([5.9, 3.55], 'the sky: brightness 1, every way', { role: 'soft', size: 12, align: 'right' })
            for (const sh of furnaceOf(s.rho, s.surface).shapes) pen.flat(sh, { id: sh.name, role: sh.mirror ? 'glass' : 'solid' })
            for (const rec of s.shown) for (const seg of rec) pen.ray(seg.a, seg.b, { role: 'cam', w: 0.7, alpha: 0.5, arrow: false, exact: true })
            pen.eye(FCAM.eye, FCAM.dir, { size: 18 })
            strip(pen, s.pix, 0, -0.65, 5.8, 0.45, 1, 'the eye\'s picture: the sky reads 1, white')
        },
        readout(s) {
            const m = mean(s.pix), lo = Math.min(...s.pix.map(p => p.Y)), hi = Math.max(...s.pix.map(p => p.Y))
            const se = Math.max(...s.pix.map(p => standardError(p.V, p.S) ?? 0))
            return `${s.spp} sample${s.spp === 1 ? '' : 's'} a pixel · the picture's average ${m.toFixed(4)} of the sky's 1 · its pixels from ${lo.toFixed(4)} to ${hi.toFixed(4)}${se === 0 && lo === hi ? ', every path bringing back exactly the same' : `, the noisiest ±${se.toFixed(4)}`}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
