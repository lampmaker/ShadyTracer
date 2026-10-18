//======================================================================================================================
// CHAPTER "Following a path": its figures.
//
//   path      one path through a closed room, bounce by bounce: each piece labelled with the throughput (beta) it
//             carries, the share of the light it can still bring back
//   cap       the same room's light with a cap of 0, 1, 2 ... bounces: each cap's average over many paths, with its error
//             bar, against the light with no cap -- what a cap throws away, and how much more a bright room loses
//   roulette  Russian roulette off and on, side by side: the same average within the error bars, how many bounces a
//             path costs, and how long the paths are
//
// The flat world's path tracer (kit/flatland.js tracePath), diffuse walls and a lamp near the ceiling, no aiming at it:
// light is found only when a bounce happens to go there. Its roulette is tracebasics.js's (ENGINE_RR).
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng, tracePath, cameraRay, ENGINE_RR } from '../kit/flatland.js'
import { plot } from '../kit/plot.js'
import { stepMoments, standardError } from '../../lib/pathtracer/core/measure.js'

/* THE ROOM: four walls of albedo `rho`, a box on the floor, and a lamp of radiance 1 along most of the ceiling */
export function room(rho) {
    return {
        sky: 0,
        shapes: [
            { kind: 'box', c: [3.4, -0.3], h: [4.1, 0.3], albedo: rho, name: 'floor' },
            { kind: 'box', c: [3.4, 4.4], h: [4.1, 0.3], albedo: rho, name: 'ceiling' },
            { kind: 'box', c: [-0.4, 2.05], h: [0.3, 2.65], albedo: rho, name: 'left' },
            { kind: 'box', c: [7.2, 2.05], h: [0.3, 2.65], albedo: rho, name: 'right' },
            { kind: 'box', c: [4.6, 0.75], h: [0.75, 0.75], round: 0.04, albedo: rho, name: 'box' },
            { kind: 'segment', a: [2.4, 3.8], b: [4.4, 3.8], r: 0.015, emit: 1, name: 'lamp' },
        ],
    }
}
const PIX = 40
const CAM = { eye: [0.35, 3.2], dir: Math.atan2(0.9 - 3.2, 5.5 - 0.35), fov: 70 * Math.PI / 180, pixels: PIX }

/* ONE PATH, for the first figure: a camera ray through one pixel (the middle ones unless chosen), traced to the lamp
   or the cap */
export function onePath(seed, rho, pixel = 18 + (seed % 5), maxBounce = 8) {
    const R = rng(seed * 7919 + 13), rec = [], info = {}
    const [ox, oy, dx, dy] = cameraRay(CAM, pixel, 0.5)
    const L = tracePath(room(rho), ox, oy, dx, dy, { maxBounce, rand: R, record: rec, info })
    return { rec, info, L }
}
/** the pixel whose ray passes nearest the world point p */
function pixelNear(p) {
    let best = 0, bd = Infinity
    for (let i = 0; i < PIX; i++) {
        const [ox, oy, dx, dy] = cameraRay(CAM, i, 0.5), t = (p[0] - ox) * dx + (p[1] - oy) * dy
        const d = Math.hypot(ox + dx * t - p[0], oy + dy * t - p[1])
        if (t > 0 && d < bd) { bd = d; best = i }
    }
    return best
}

/* MANY PATHS: every pixel of the camera's film, a sample at a time, each path traced to MAXB bounces and read at every
   cap (info.upTo): the cap's light is that path's light had it stopped there */
const MAXB = 40
const moments = () => ({ Y: 0, V: 0, S: 0, cnt: 0 })
function samplePaths(s, ms, fn) {
    const world = room(s.rho), t0 = performance.now()
    do {
        const R = rng(s.seed * 1000003 + s.spp * 7919)
        for (let i = 0; i < PIX; i++) { const [ox, oy, dx, dy] = cameraRay(CAM, i, R()); fn(world, ox, oy, dx, dy, R) }
        s.spp++
    } while (performance.now() - t0 < ms && s.spp < s.max)
    return s.spp < s.max
}
const CAPS = [0, 1, 2, 3, 4, 6, 8, 12, 20, 40]

export const figures = {
    path: {
        aspect: 1.55,
        world: { x: [-0.9, 7.7], y: [-0.75, 4.95] },
        state: { seed: 17, rho: 0.8, pixel: 20, maxB: 8 },
        controls: [
            { type: 'button', label: 'Another path', act: s => { s.seed++ } },
            { type: 'slider', key: 'rho', label: 'walls\' albedo', min: 0.3, max: 0.95, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'maxB', label: 'bounce limit', min: 1, max: 20, step: 1, fmt: v => String(v) },
        ],
        steps: { one: { seed: 17, rho: 0.8, pixel: 20, maxB: 8 } },
        drag: { pixel: (s, p) => { s.pixel = pixelNear(p) } },
        draw(pen, s) {
            const { rec, info } = onePath(s.seed, s.rho, s.pixel, s.maxB)
            for (const sh of room(s.rho).shapes) pen.flat(sh, { id: sh.name })
            rec.forEach((seg, k) => {
                pen.ray(seg.a, seg.b, { role: seg.lamp ? 'light' : 'cam', w: seg.lamp ? 1.8 : 1.2, arrow: true, id: `p${k}` })
                const m = [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2]
                pen.label(m, `β ${seg.beta.toFixed(2)}`, { role: 'ink', size: 13, kind: 'mono', bg: true, align: 'center', dy: -10 })
                if (k > 0) pen.dot(seg.a, { role: 'accent', r: 3.2 })
            })
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
            const [ox, oy, dx, dy] = cameraRay(CAM, s.pixel, 0.5)
            pen.handle('pixel', [ox + dx * 0.9, oy + dy * 0.9], { label: 'which pixel' })
            pen.label([3.4, 4.2], 'lamp', { role: 'soft', size: 13, align: 'center' })
            void info
        },
        readout(s) {
            const { rec, info, L } = onePath(s.seed, s.rho, s.pixel, s.maxB)
            const last = rec[rec.length - 1]
            return `${info.bounces} bounce${info.bounces === 1 ? '' : 's'} · ` + (info.end === 'lamp'
                ? `found the lamp carrying β ${last.beta.toFixed(3)} = ${s.rho.toFixed(2)}^${info.bounces}: brings back β × the lamp's brightness (1) = ${L.toFixed(3)}`
                : `stopped at the limit of ${s.maxB} bounce${s.maxB === 1 ? '' : 's'} without finding the lamp: brings back 0`)
        },
    },

    cap: {
        aspect: 1.9,
        world: { x: [0, 10], y: [0, 5.2] },
        state: { rho: 0.8, seed: 1, spp: 0, max: 400 },
        controls: [{ type: 'seg', key: 'rho', label: 'walls', options: [[0.5, 'Dark walls (0.5)'], [0.8, 'Light (0.8)'], [0.95, 'White (0.95)']] }],
        steps: { light: { rho: 0.8 }, white: { rho: 0.95 } },
        work: {
            reset(s) { s.spp = 0; s.caps = CAPS.map(() => moments()); s.bounces = 0; s.paths = 0 },
            add(s, ms) {
                const info = {}
                return samplePaths(s, ms, (world, ox, oy, dx, dy, R) => {
                    tracePath(world, ox, oy, dx, dy, { maxBounce: MAXB, rand: R, info })
                    CAPS.forEach((c, k) => { s.caps[k] = stepMoments(s.caps[k], info.upTo[c]) })
                    s.bounces += info.bounces; s.paths++
                })
            },
        },
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.1, y: H * 0.1, w: W * 0.86, h: H * 0.72 }
            const top = Math.max(0.05, ...s.caps.map(c => c.Y)) * 1.2
            pen.labelPx(rect.x - 34, rect.y - 22, 'the room\'s average light (the lamp\'s brightness is 1), by the most bounces a path may take', { role: 'soft', size: 13 })
            const { X, Y } = plot(pen, rect, {
                x: [-0.5, CAPS.length - 0.5], y: [0, top], xticks: [], fmt: v => v.toFixed(2),
                hoverX: k => `a cap of ${CAPS[Math.round(k)]} bounce${CAPS[Math.round(k)] === 1 ? '' : 's'}`, hoverY: v => v.toFixed(4),
                series: [
                    { name: 'light', pts: CAPS.map((c, k) => [k, s.caps[k].Y, standardError(s.caps[k].V, s.caps[k].S) ?? 0]), role: 'cam', kind: 'bars' },
                    { pts: [[-0.5, s.caps[CAPS.length - 1].Y], [CAPS.length - 0.5, s.caps[CAPS.length - 1].Y]], role: 'accent', w: 1 },
                ],
            })
            CAPS.forEach((c, k) => pen.labelPx(X(k) - 6, rect.y + rect.h + 4, String(c), { role: 'soft', size: 11, kind: 'mono' }))
            pen.labelPx(rect.x + rect.w / 2 - 40, rect.y + rect.h + 20, 'the cap, in bounces', { role: 'soft', size: 12 })
            void Y
        },
        readout(s) {
            const all = s.caps[CAPS.length - 1].Y || 1, share = c => (100 * s.caps[CAPS.indexOf(c)].Y / all).toFixed(0)
            return `walls ${s.rho} · ${s.spp} samples · a cap of 1 keeps ${share(1)}% of the light, 3 keeps ${share(3)}%, 8 keeps ${share(8)}%, 20 keeps ${share(20)}% (against a cap of 40)`
        },
    },

    roulette: {
        aspect: 1.9,
        world: { x: [0, 10], y: [0, 5.2] },
        state: { rho: 0.8, seed: 1, spp: 0, max: 600, start: ENGINE_RR.start, divide: true },
        controls: [
            { type: 'seg', key: 'rho', label: 'walls', options: [[0.5, 'Dark (0.5)'], [0.8, 'Light (0.8)'], [0.95, 'White (0.95)']] },
            { type: 'slider', key: 'start', label: 'roulette from bounce', min: 1, max: 10, step: 1, fmt: v => String(v) },
            { type: 'toggle', key: 'divide', label: 'Survivors divide β by p' },
            { type: 'button', label: 'New paths', act: s => { s.seed++ } },
        ],
        steps: { both: { rho: 0.8, start: ENGINE_RR.start, divide: true, seed: 1 }, unfair: { rho: 0.8, start: ENGINE_RR.start, divide: false, seed: 1 } },
        work: {
            reset(s) { s.spp = 0; s.off = moments(); s.on = moments(); s.costOff = 0; s.costOn = 0; s.lenOff = new Array(41).fill(0); s.lenOn = new Array(41).fill(0) },
            add(s, ms) {
                const info = {}
                return samplePaths(s, ms, (world, ox, oy, dx, dy, R) => {
                    s.off = stepMoments(s.off, tracePath(world, ox, oy, dx, dy, { maxBounce: MAXB, rand: R, info }))
                    s.costOff += info.bounces + 1; s.lenOff[Math.min(40, info.bounces)]++
                    s.on = stepMoments(s.on, tracePath(world, ox, oy, dx, dy, { maxBounce: MAXB, rand: R, info, rr: { ...ENGINE_RR, start: s.start, divide: s.divide } }))
                    s.costOn += info.bounces + 1; s.lenOn[Math.min(40, info.bounces)]++
                })
            },
        },
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.1, y: H * 0.1, w: W * 0.86, h: H * 0.72 }
            const n = Math.max(1, s.off.cnt), top = Math.max(...s.lenOff, ...s.lenOn, 1) / n * 1.15
            pen.labelPx(rect.x - 34, rect.y - 22, 'how many paths end after each number of bounces (share of all)', { role: 'soft', size: 13 })
            const { X } = plot(pen, rect, {
                x: [0, 30], y: [0, top], xticks: [0, 3, 10, 20, 30], fmt: v => v >= 1 || v === 0 ? String(Math.round(v)) : v.toFixed(2),
                hoverX: k => `ending after ${Math.round(k)} bounce${Math.round(k) === 1 ? '' : 's'}`, hoverY: v => `${(100 * v).toFixed(1)}%`,
                series: [
                    { name: 'off', pts: s.lenOff.slice(0, 31).map((c, k) => [k, c / n]), role: 'soft', w: 1.4 },
                    { name: 'on', pts: s.lenOn.slice(0, 31).map((c, k) => [k, c / n]), role: 'cam', w: 1.8 },
                ],
            })
            const { ctx } = pen
            ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(s.start), rect.y); ctx.lineTo(X(s.start), rect.y + rect.h); ctx.stroke(); ctx.restore()
            pen.labelPx(X(s.start) + 4, rect.y + 2, 'roulette starts', { role: 'accent', size: 12 })
            pen.labelPx(X(12), rect.y + rect.h * 0.25, `off: thin ${pen.say('soft')} · on: bold ${pen.say('cam')}`, { role: 'soft', size: 12 })
        },
        readout(s) {
            const se = m => standardError(m.V, m.S) ?? 0, n = Math.max(1, s.off.cnt)
            // for the same work, the error bar shrinks as 1/sqrt(rays): so variance x rays is what to compare
            const eff = se(s.on) > 0 ? (se(s.off) ** 2 * s.costOff) / (se(s.on) ** 2 * s.costOn) : 1
            return `${s.off.cnt} paths each · off: ${s.off.Y.toFixed(4)} ± ${se(s.off).toFixed(4)}, ${(s.costOff / n).toFixed(1)} rays a path · on: ${s.on.Y.toFixed(4)} ± ${se(s.on).toFixed(4)}, ${(s.costOn / n).toFixed(1)} rays a path · for the same rays, on's error bar is ${(1 / Math.sqrt(eff)).toFixed(2)}× off's`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
