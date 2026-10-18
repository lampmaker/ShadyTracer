//======================================================================================================================
// CHAPTER "Aim at the light": its figures.
//
//   aim    one point on a floor under a lamp: random bounce directions, of which few find the lamp, against shadow
//          rays aimed at it -- each strategy's estimate of the light there, with its error bar, against the exact value
//   room3  the same comparison in 3D: a small room lit by a glowing ball, two live pictures side by side
//   room   a flat room path traced twice at once, without and with next event estimation: the same paths' worth of
//          work, two films, their error bars; the lamp's size changes how far apart they are
//
// Both trace flatland (kit/flatland.js), whose laws are the flat world's: a lamp's light falls off as 1/r, a diffuse
// surface is rho/2. The films are kept with core/measure.js stepMoments and standardError: the renderer's own
// per-pixel mean and error bar, one sample at a time.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { march, rng, tracePath, cosineDir, directE, cameraRay } from '../kit/flatland.js'
import { stepMoments, standardError } from '../../lib/pathtracer/core/measure.js'
import { plot } from '../kit/plot.js'
import { trace3, cameraRay3 } from '../kit/space.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/* THE AIM FIGURE'S WORLD: a floor, a lamp of length `size` at height 3.4, and (optionally) a block half in the way.
   The lamp's radiance is 0.8 / size, so it gives about the same light whatever its size: only how it is found changes. */
function aimWorld(s) {
    const L = 0.8 / s.size
    const shapes = [
        { kind: 'box', c: [3, -0.4], h: [5, 0.4], albedo: 0.7, name: 'floor' },
        { kind: 'segment', a: [s.lampX - s.size / 2, 3.4], b: [s.lampX + s.size / 2, 3.4], r: 0.02, emit: L, name: 'lamp' },
    ]
    if (s.block) shapes.push({ kind: 'box', c: [s.lampX - 0.55, 1.9], h: [0.5, 0.12], albedo: 0.7, name: 'block' })
    return { shapes }
}
const X0 = [2.6, 0]                    // the point on the floor
/** the exact light at X0 from an unblocked lamp: L (sin phi2 - sin phi1), phi from the normal (flatland's law) */
export function exactE(s) {
    const L = 0.8 / s.size, a = [s.lampX - s.size / 2 - X0[0], 3.4 - X0[1]], b = [s.lampX + s.size / 2 - X0[0], 3.4 - X0[1]]
    return L * Math.abs(b[0] / Math.hypot(...b) - a[0] / Math.hypot(...a))
}
function estimate(world, nee, n, seed) {
    const R = rng(seed)
    let sum = 0, sum2 = 0
    for (let i = 0; i < n; i++) { const e = directE(world, X0[0], X0[1] + 1e-3, 0, 1, { nee, rand: R }); sum += e; sum2 += e * e }
    const m = sum / n
    return { m, se: Math.sqrt(Math.max(0, sum2 / n - m * m) / (n - 1)) }
}

/* THE ROOM: walls, a ball, a block, and a lamp near the ceiling whose radiance is 1.1 / size */
function roomWorld(s) {
    return {
        sky: 0,
        shapes: [
            { kind: 'box', c: [3.4, -0.3], h: [4.1, 0.3], albedo: 0.7, name: 'floor' },
            { kind: 'box', c: [3.4, 4.4], h: [4.1, 0.3], albedo: 0.6, name: 'ceiling' },
            { kind: 'box', c: [-0.4, 2.05], h: [0.3, 2.65], albedo: 0.6, name: 'left' },
            { kind: 'box', c: [7.2, 2.05], h: [0.3, 2.65], albedo: 0.6, name: 'right' },
            { kind: 'circle', c: [2.3, 0.62], r: 0.62, albedo: 0.7, name: 'ball' },
            { kind: 'box', c: [4.7, 0.8], h: [0.55, 0.8], round: 0.04, albedo: 0.7, name: 'block' },
            { kind: 'segment', a: [s.lampX - s.size / 2, 3.75], b: [s.lampX + s.size / 2, 3.75], r: 0.015, emit: 1.1 / s.size, name: 'lamp' },
        ],
    }
}
const PIX = 56
const CAM = { eye: [0.35, 3.55], dir: Math.atan2(0.6 - 3.55, 5.2 - 0.35), fov: 64 * Math.PI / 180, pixels: PIX }
const film = () => Array.from({ length: PIX }, () => [0, 0, 0, 0])          // Y, V, S, count per pixel, as measure.js keeps them
const step = (px, y) => { const st = stepMoments({ Y: px[0], V: px[1], S: px[2], cnt: px[3] }, y); px[0] = st.Y; px[1] = st.V; px[2] = st.S; px[3] = st.cnt }
const seOf = px => standardError(px[1], px[2]) ?? 0
/** the average, over the film's pixels that see something, of each pixel's error bar as a share of its value */
export function relError(f) {
    let t = 0, n = 0
    for (const p of f) if (p[0] > 1e-4 && p[3] > 1) { t += seOf(p) / p[0]; n++ }
    return n ? t / n : NaN
}

export const figures = {
    aim: {
        aspect: 1.5,
        world: { x: [-0.2, 6.2], y: [-0.55, 4.1] },
        state: { mode: 'bounce', size: 1.2, lampX: 3.6, block: false },
        controls: [
            { type: 'seg', key: 'mode', options: [['bounce', 'Bounce at random'], ['aim', 'Aim at the lamp']] },
            { type: 'slider', key: 'size', label: 'lamp size', min: 0.05, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'toggle', key: 'block', label: 'Something in the way' },
        ],
        steps: {
            bounce: { mode: 'bounce', size: 1.2, block: false },
            small: { mode: 'bounce', size: 0.2, block: false },
            aim: { mode: 'aim', size: 0.2, block: false },
            block: { mode: 'aim', size: 1.2, block: true },
        },
        drag: { lamp: (s, p) => { s.lampX = clamp(p[0], 0.8, 5.4) } },
        draw(pen, s) {
            const world = aimWorld(s)
            for (const sh of world.shapes) pen.flat(sh, { id: sh.name })
            const R = rng(17), H = {}, K = 70
            let found = 0
            for (let i = 0; i < K; i++) {
                if (s.mode === 'bounce') {
                    const [dx, dy] = cosineDir(0, 1, R())
                    march(world, X0[0], X0[1] + 0.004, dx, dy, { far: 9 }, H)
                    const lamp = H.hit && world.shapes[H.i].emit > 0
                    if (lamp) found++
                    pen.ray(X0, H.hit ? [H.x, H.y] : [X0[0] + dx * 9, X0[1] + dy * 9], { role: lamp ? 'light' : 'soft', w: lamp ? 1.5 : 0.6, alpha: lamp ? 1 : 0.35, arrow: false })
                } else {
                    const lamp = world.shapes[1], u = R(), y = [lamp.a[0] + (lamp.b[0] - lamp.a[0]) * u, lamp.a[1]]
                    const v = [y[0] - X0[0], y[1] - X0[1]], r = Math.hypot(...v)
                    march(world, X0[0], X0[1] + 0.004, v[0] / r, v[1] / r, { far: r + 1 }, H)
                    const ok = H.hit && H.i === 1
                    if (ok) found++
                    pen.ray(X0, ok ? y : [H.x, H.y], { role: ok ? 'shadow' : 'blocked', w: 0.9, alpha: 0.75, arrow: false })
                }
            }
            pen.dot(X0, { role: 'accent', r: 4.5 })
            pen.label(X0, 'this point', { role: 'accent', size: 14, dx: 8, dy: 14 })
            pen.handle('lamp', [s.lampX, 3.4 + 0.25], { label: 'lamp', role: 'light' })
            s._aim = { found, K, off: estimate(world, false, 3000, 5), on: estimate(world, true, 3000, 6), exact: s.block ? null : exactE(s) }
        },
        readout(s) {
            const a = s._aim
            if (!a) return ''
            const fmt = e => `${e.m.toFixed(3)} ± ${e.se.toFixed(3)}`
            const first = s.mode === 'bounce' ? `${a.found} of ${a.K} random directions found the lamp` : `${a.found} of ${a.K} shadow rays reached the lamp`
            return `${first} · light here, from 3000 tries each — bouncing: ${fmt(a.off)}, aiming: ${fmt(a.on)}${a.exact != null ? `, exact: ${a.exact.toFixed(3)}` : ''}`
        },
    },

    room: {
        aspect: 1.15,
        world: { x: [-0.8, 7.6], y: [-3.9, 4.75] },
        state: { size: 0.6, lampX: 3.0, view: 'off', spp: 0, seed: 1, off: film(), on: film(), paths: { off: [], on: [] }, px: 30, ymax: 0.5 },
        controls: [
            { type: 'slider', key: 'size', label: 'lamp size', min: 0.05, max: 2.5, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'seg', key: 'view', options: [['off', 'Without NEE'], ['both', 'Both']] },
            { type: 'button', label: 'Start again', act: s => { s.seed++ } },
        ],
        steps: {
            off: { view: 'off', size: 0.6 },
            both: { view: 'both', size: 0.6 },
            small: { view: 'both', size: 0.12 },
            big: { view: 'both', size: 2.4 },
        },
        drag: {
            lamp: (s, p) => { s.lampX = clamp(p[0], 0.8, 6.2) },
            pixel: (s, p) => {
                // the pixel whose ray passes nearest the pointer
                let best = 0, bd = Infinity
                for (let i = 0; i < PIX; i++) {
                    const [ox, oy, dx, dy] = cameraRay(CAM, i)
                    const t = (p[0] - ox) * dx + (p[1] - oy) * dy, d = Math.hypot(ox + dx * t - p[0], oy + dy * t - p[1])
                    if (t > 0 && d < bd) { bd = d; best = i }
                }
                s.px = best
            },
        },
        keep: ['pixel', 'view'],
        work: {
            reset(s) { s.spp = 0; s.off = film(); s.on = film(); s.paths = { off: [], on: [] }; s.ymax = 0.5 },
            add(s, ms) {
                const world = roomWorld(s), t0 = performance.now()
                do {
                    const R = rng(s.seed * 1000003 + s.spp * 7919)
                    for (let i = 0; i < PIX; i++) {
                        for (const which of ['off', 'on']) {
                            const [ox, oy, dx, dy] = cameraRay(CAM, i, R())
                            const rec = i === s.px && s.spp % 3 === 0 ? [] : null
                            const y = tracePath(world, ox, oy, dx, dy, { nee: which === 'on', maxBounce: 4, rand: R, record: rec })
                            step(s[which][i], y)
                            if (rec) { s.paths[which].push(rec); if (s.paths[which].length > 4) s.paths[which].shift() }
                        }
                    }
                    s.spp++
                } while (performance.now() - t0 < ms && s.spp < 2048)
                return s.spp < 2048
            },
        },
        draw(pen, s) {
            const world = roomWorld(s)
            for (const sh of world.shapes) pen.flat(sh, { id: sh.name })
            // the selected pixel's last few paths: eye rays and bounces, and (with NEE) the shadow rays
            const show = s.view === 'off' ? ['off'] : ['on']
            for (const w of show) for (const rec of s.paths[w] ?? []) for (const seg of rec) {
                const role = seg.kind === 'shadow' ? 'shadow' : seg.kind === 'blocked' ? 'blocked' : 'cam'
                pen.ray(seg.a, seg.b, { role, w: seg.kind === 'eye' ? 1.1 : 0.8, alpha: 0.75, arrow: false })
            }
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
            const [ox, oy, dx, dy] = cameraRay(CAM, s.px)
            pen.handle('pixel', [ox + dx * 1.1, oy + dy * 1.1], { label: 'pixel' })
            pen.handle('lamp', [s.lampX, 3.75 - 0.32], { label: 'lamp', role: 'light' })

            // THE FILMS: each pixel's average as a grey, and below, every pixel's value with its error bar
            const cur = Math.max(1e-3, ...s.on.map(p => p[0]))
            s.ymax = Math.max(s.ymax * 0.97, cur * 1.25)
            const strip = (f, y, label) => {
                const x0 = pen.X(-0.2), x1 = pen.X(7.0), cw = (x1 - x0) / PIX, py = pen.Y(y), ch = 18
                const ctx = pen.ctx
                ctx.save()
                for (let i = 0; i < PIX; i++) {
                    const v = Math.pow(clamp(f[i][0] / s.ymax, 0, 1), 1 / 2.2), g = Math.round(255 * v)
                    ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(x0 + i * cw, py, cw + 0.5, ch)
                }
                ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.strokeRect(x0, py, x1 - x0, ch)
                ctx.strokeStyle = pen.col('accent'); ctx.lineWidth = 1.6; ctx.strokeRect(x0 + s.px * cw, py - 2, cw, ch + 4)
                ctx.restore()
                pen.labelPx(x0, py + ch + 3, label, { role: 'soft', size: 12 })
            }
            strip(s.off, -0.75, 'the picture without NEE')
            if (s.view === 'both') strip(s.on, -1.45, 'the picture with NEE')
            const r = { x: pen.X(0.15), y: pen.Y(-2.2), w: pen.X(7.0) - pen.X(0.15), h: pen.Y(-3.65) - pen.Y(-2.2) }
            const series = [{ pts: s.off.map((p, i) => [i + 0.5, p[0], seOf(p)]), role: 'accent', kind: 'dots', r: 1.9 }]
            if (s.view === 'both') series.push({ pts: s.on.map((p, i) => [i + 0.5, p[0], seOf(p)]), role: 'cam', kind: 'dots', r: 1.9 })
            plot(pen, r, { x: [0, PIX], y: [0, s.ymax], xlabel: 'pixel', ylabel: 'brightness, with error bars', xticks: [], yticks: [0], series })
        },
        readout(s) {
            const off = relError(s.off), on = relError(s.on)
            const p = v => Number.isFinite(v) ? `±${(100 * v).toFixed(1)}%` : '—'
            return s.view === 'both' ? `${s.spp} samples per pixel · average error bar: without NEE ${p(off)}, with NEE ${p(on)}`
                : `${s.spp} samples per pixel · average error bar ${p(off)}`
        },
    },
}


/* THE ROOM IN 3D (space.js, z up): a small room lit by a glowing ball, path traced live on the CPU twice at once,
   without and with next event estimation, every pixel's average and error bar kept by measure.js as the room's flat
   films are. 3D's own laws here: light falls as 1/d^2, a diffuse surface is rho / pi, and the shadow ray aims into the
   cone the lamp fills, as ShadyTracer aims at a glowing surface it has found. The lamp's radiance goes as 1 / size^2,
   so its power stays the same as it shrinks. */
const ROOM3 = s => ({
    sky: [0, 0, 0],
    shapes: [
        { kind: 'plane', z: 0, rgb: [0.72, 0.72, 0.72] },
        { kind: 'wall', n: [0, -1, 0], d: -2.6, rgb: [0.72, 0.72, 0.72] },
        { kind: 'wall', n: [1, 0, 0], d: -2.1, rgb: [0.75, 0.28, 0.22] },
        { kind: 'wall', n: [-1, 0, 0], d: -2.1, rgb: [0.28, 0.58, 0.32] },
        { kind: 'wall', n: [0, 0, -1], d: -3.0, rgb: [0.72, 0.72, 0.72] },
        { kind: 'sphere', c: [-0.7, 1.4, 0.55], r: 0.55, rgb: [0.75, 0.75, 0.75] },
        { kind: 'box', c: [0.8, 1.8, 0.7], h: [0.4, 0.4, 0.7], round: 0.02, rgb: [0.75, 0.75, 0.75] },
        { kind: 'sphere', c: [0.1, 1.0, 2.45], r: s.size, emit: 0.35 / (s.size * s.size) },
    ],
})
const CAM_ROOM = { eye: [0, -3.4, 1.55], target: [0, 1.0, 1.3], fov: 0.82 }
const F3 = [44, 33]
const film3 = () => ({ rgb: new Array(F3[0] * F3[1] * 3).fill(0), m: Array.from({ length: F3[0] * F3[1] }, () => [0, 0, 0, 0]) })
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
figures.room3 = {
    aspect: 2.25,
    budget: 14,
    world: { x: [0, 1], y: [0, 1] },
    state: { size: 0.22, spp: 0, cursor: 0, seed: 1, off: film3(), on: film3(), exp: 0 },
    controls: [
        { type: 'slider', key: 'size', label: 'lamp size', min: 0.06, max: 0.6, step: 0.02, fmt: v => v.toFixed(2) },
        { type: 'button', label: 'Start again', act: s => { s.seed++ } },
    ],
    steps: { both: { size: 0.22 }, small: { size: 0.08 }, big: { size: 0.55 } },
    work: {
        reset(s) { s.spp = 0; s.cursor = 0; s.off = film3(); s.on = film3(); s.exp = 0 },
        add(s, ms) {
            const world = ROOM3(s), [W, H] = F3, t0 = performance.now()
            do {
                const k = s.cursor, i = k % W, j = Math.floor(k / W)
                const R = rng((s.seed * 7919 + s.spp) * 100003 + k)
                for (const which of ['off', 'on']) {
                    const d = cameraRay3(CAM_ROOM, i, j, W, H, R(), R())
                    const c = trace3(world, CAM_ROOM.eye, d, { nee: which === 'on', maxBounce: 3, rand: R, far: 14 })
                    const f = s[which]
                    for (let q = 0; q < 3; q++) f.rgb[k * 3 + q] += c[q]
                    step(f.m[k], lum(c))
                }
                if (++s.cursor === W * H) { s.cursor = 0; s.spp++ }
            } while (performance.now() - t0 < ms && s.spp < 256)
            return s.spp < 256
        },
    },
    draw(pen, s) {
        const [W, H] = F3, n = k => Math.max(1, s.spp + (k < s.cursor ? 1 : 0))
        // one exposure for both, from the NEE picture's average once it has one: the same light shown the same way
        if (s.spp > 0 && !s.exp) { let t = 0; for (let k = 0; k < W * H; k++) t += s.on.m[k][0]; s.exp = 0.45 / Math.max(1e-6, t / (W * H)) }
        const exp = s.exp || 1
        const gap = 14, w = (pen.view.W - gap) / 2, h = Math.min(pen.view.H - 22, w * H / W)
        for (const [x, which, label] of [[0, 'off', 'without NEE'], [w + gap, 'on', 'with NEE']]) {
            const f = s[which]
            pen.image(x, 0, w, h, W, H, (i, j) => { const k = j * W + i, m = n(k); return [f.rgb[k * 3] / m, f.rgb[k * 3 + 1] / m, f.rgb[k * 3 + 2] / m] }, { exposure: exp })
            pen.labelPx(x, h + 5, label, { role: 'soft', size: 13 })
        }
    },
    readout(s) {
        const p = v => Number.isFinite(v) ? `±${(100 * v).toFixed(1)}%` : '—'
        return `${s.spp} samples per pixel · average error bar: without NEE ${p(relError(s.off.m))}, with NEE ${p(relError(s.on.m))}`
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
