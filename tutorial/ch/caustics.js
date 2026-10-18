//======================================================================================================================
// CHAPTER "Caustics": its figures.
//
//   caustic  a glass ball over a floor in the sun, and the eye's picture of the floor, made four ways: the camera's
//            own paths (NEE at every scattering point, the sun found through the glass only by chance), light tracing
//            alone (photons from the sun through the glass, connected to the eye), both with ShadyTracer's split of
//            path space, and both without it -- the caustic counted twice
//   learn    where the photons start: a line across the sun's rays in cells, uniform or learned as prog_lt_build
//            learns (hits / emitted, a 20 % floor, halved at every rebuild), and how many of them connect
//   kinds    four kinds of path to the sun, and which side counts each: the camera's, light tracing's, or nobody's
//            (a caustic seen through glass: chapter 19)
//
// The flat world's path tracer and light tracer (kit/flatland.js tracePath with `split`, lightTrace), its glass by
// optics/fresnel.js. Light in the plane: the sun's illuminance on a surface facing it is held at 1 (sunE) as its width
// changes, the renderer's way (chapter 5: the sun is set by its illuminance).
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng, tracePath, cameraRay, lightTrace, march, normalAt, glassStep, newLearn, learnRebuild } from '../kit/flatland.js'
import { stepMoments, standardError } from '../../lib/pathtracer/core/measure.js'

const DEG = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/* THE SCENE: a matte floor of albedo 0.8, a glass ball of index 1.5 over it, the sun 75 degrees up from the right; its
   photons start on a line 12 wide across its rays, 14 back from the floor under the ball */
export const BALL = { c: [0.6, 1.5], r: 0.75 }
export const sunOf = half => ({ dir: 75 * DEG, half: half * DEG, L: 1 / (2 * Math.sin(half * DEG)), aim: [0.3, 0.3], width: 12, back: 14 })
export const worldOf = (half = 0.27) => ({
    sky: 0, sun: sunOf(half),
    shapes: [
        { kind: 'box', c: [0, -0.3], h: [6.5, 0.3], albedo: 0.8, name: 'floor' },
        { kind: 'circle', c: BALL.c, r: BALL.r, glass: 1.5, name: 'ball' },
    ],
})
const PIX = 48
export const CAM = { eye: [-4.2, 3.0], dir: Math.atan2(0 - 3.0, 0.3 + 4.2), fov: 56 * DEG, pixels: PIX }
/* the floor the ball's shadow falls on: where the sun's rays through its edges land */
const SHADOW_X = (() => { const cot = 1 / Math.tan(75 * DEG), x0 = BALL.c[0] - BALL.c[1] * cot, hw = BALL.r / Math.sin(75 * DEG); return [x0 - hw, x0 + hw] })()
/** the pixels whose ray meets the floor under the ball, where the caustic is (the readout's region and the bracket) */
export const causticPixels = (() => {
    const w = worldOf(), out = [], H = {}
    for (let i = 0; i < PIX; i++) {
        const [ox, oy, dx, dy] = cameraRay(CAM, i, 0.5)
        march(w, ox, oy, dx, dy, {}, H)
        if (H.hit && H.i === 0 && H.x > SHADOW_X[0] && H.x < SHADOW_X[1]) out.push(i)
    }
    return out
})()

/* ONE SAMPLE, the four ways: the camera's paths (one a pixel) and a batch of photons, added as the mode says */
export const MODES = { camera: { cam: true, lt: false, split: false }, light: { cam: false, lt: true, split: false }, both: { cam: true, lt: true, split: true }, twice: { cam: true, lt: true, split: false } }
export const PHOTONS = 600
export function sample(world, mode, R, rec = null) {
    const m = MODES[mode], v = new Float64Array(PIX)
    if (m.cam) for (let i = 0; i < PIX; i++) {
        const [ox, oy, dx, dy] = cameraRay(CAM, i, R()), r = rec && i % 6 === 3 ? [] : null
        v[i] += tracePath(world, ox, oy, dx, dy, { nee: true, split: m.split, maxBounce: 8, rand: R, record: r })
        if (r) rec.cam.push(r)
    }
    if (m.lt) { const t = lightTrace(world, CAM, { n: PHOTONS, rand: R, record: rec ? rec.lt : null, recordEvery: 3 }); for (let i = 0; i < PIX; i++) v[i] += t.img[i] }
    return v
}
const moments = () => ({ Y: 0, V: 0, S: 0, cnt: 0 })
function film(s, ms) {
    const t0 = performance.now(), world = worldOf(s.half)
    do {
        const R = rng(s.seed * 1000003 + s.spp * 7919), rec = s.spp === 0 ? s.shown : null
        const v = sample(world, s.mode, R, rec)
        for (let i = 0; i < PIX; i++) s.pix[i] = stepMoments(s.pix[i], v[i])
        s.spp++
    } while (performance.now() - t0 < ms && s.spp < s.max)
    return s.spp < s.max
}
/** a run to the end, for the test: the film's pixels after `max` samples */
export function render(s) {
    const r = { seed: s.seed ?? 1, spp: 0, max: s.max ?? 64, mode: s.mode, half: s.half ?? 0.27, pix: Array.from({ length: PIX }, moments), shown: { cam: [], lt: [] } }
    film(r, 1e9)
    return r
}
const region = pix => { let m = 0, v = 0; for (const i of causticPixels) { m += pix[i].Y; v += (standardError(pix[i].V, pix[i].S) ?? 0) ** 2 } return { mean: m / causticPixels.length, se: Math.sqrt(v) / causticPixels.length } }

/** the strip: the eye's picture under the scene, brightened `k` times, numbered, the caustic's pixels bracketed */
function strip(pen, vals, x0, y0, x1, h, k, label) {
    const px0 = pen.X(x0), w = pen.X(x1) - px0, top = pen.Y(y0), bot = top + pen.view.s * h, at = i => px0 + w * (i + 0.5) / PIX
    pen.image(px0, top, w, pen.view.s * h, PIX, 1, i => { const v = k * vals[i]; return [v, v, v] })
    pen.labelPx(px0, top - 20, label, { role: 'soft', size: 11, base: 'bottom' })
    for (const n of [1, 10, 20, 30, 40, PIX]) pen.labelPx(at(n - 1), bot + 3, String(n), { role: 'soft', size: 9, align: 'center', base: 'top' })
    const a = at(causticPixels[0]) - w / PIX / 2, b = at(causticPixels[causticPixels.length - 1]) + w / PIX / 2, { ctx } = pen
    ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a, top - 3); ctx.lineTo(a, top - 1); ctx.lineTo(b, top - 1); ctx.lineTo(b, top - 3); ctx.stroke(); ctx.restore()
    pen.labelPx(b + 6, top - 6, 'under the ball', { role: 'accent', size: 11, base: 'bottom' })
}
/** the sun: a few of its parallel rays coming in from the upper right, and its name */
function sunRays(pen, half) {
    const dx = -Math.cos(75 * DEG), dy = -Math.sin(75 * DEG)
    for (let k = -2; k <= 2; k++) { const x = 1.4 + k * 0.85, y = 3.75; pen.ray([x, y], [x + dx * 0.9, y + dy * 0.9], { role: 'light', w: 1.2, exact: true }) }
    pen.label([4.1, 4.02], `the sun, ${(2 * half).toFixed(2)}° across`, { role: 'light', size: 12, align: 'right' })
}
const drawScene = (pen, world) => { for (const sh of world.shapes) pen.flat(sh, { id: sh.name, role: sh.glass ? 'glass' : 'solid' }) }

export const figures = {
    caustic: {
        aspect: 1.45,
        world: { x: [-4.8, 4.2], y: [-1.95, 4.15] },
        state: { mode: 'camera', half: 0.27, seed: 1, spp: 0, max: 400 },
        controls: [
            { type: 'seg', key: 'mode', options: [['camera', 'Camera paths'], ['light', 'Light tracing'], ['both', 'Both, split'], ['twice', 'Both, no split']] },
            { type: 'slider', key: 'half', label: 'the sun\'s width', min: 0.25, max: 6, step: 0.01, fmt: v => `${(2 * v).toFixed(2)}° across` },
        ],
        steps: {
            shadow: { mode: 'camera', half: 0.27 }, wide: { mode: 'camera', half: 4 }, light: { mode: 'light', half: 0.27 },
            both: { mode: 'both', half: 0.27 }, twice: { mode: 'twice', half: 0.27 },
        },
        work: {
            reset(s) { s.spp = 0; s.pix = Array.from({ length: PIX }, moments); s.shown = { cam: [], lt: [] } },
            add(s, ms) { return film(s, ms) },
        },
        draw(pen, s) {
            const world = worldOf(s.half)
            drawScene(pen, world)
            sunRays(pen, s.half)
            for (const rec of s.shown.cam) for (const seg of rec) pen.ray(seg.a, seg.b, { role: seg.kind === 'shadow' ? 'shadow' : seg.kind === 'blocked' ? 'blocked' : seg.lamp ? 'light' : 'cam', w: 0.7, alpha: 0.55, arrow: false, exact: true })
            for (const rec of s.shown.lt) for (const seg of rec) pen.ray(seg.a, seg.b, { role: seg.kind === 'connect' ? 'shadow' : 'light', w: 0.8, alpha: 0.6, arrow: false, exact: true })
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
            strip(pen, s.pix.map(p => p.Y), -4.3, -1.2, 3.9, 0.42, 1.2, 'the eye\'s picture, brightened 1.2 times: pixel 1 looks highest, 48 lowest')
        },
        readout(s) {
            const g = region(s.pix), mean = s.pix.reduce((a, p) => a + p.Y, 0) / PIX
            const what = { camera: 'the camera\'s own paths, aiming at the sun at every scattering point', light: 'light tracing alone: photons from the sun, connected to the eye', both: 'both, with the split: each path counted by one side', twice: 'both, without the split: paths through the glass counted by each' }[s.mode]
            return `${what} · ${s.spp} sample${s.spp === 1 ? '' : 's'} · under the ball the pixels average ${g.mean.toFixed(3)} ± ${g.se.toFixed(3)} · the whole picture ${mean.toFixed(3)}`
        },
    },

    learn: {
        aspect: 1.47,
        world: { x: [-5.2, 8.2], y: [-0.9, 8.2] },
        state: { learned: false, rounds: 0, seed: 3 },
        controls: [
            { type: 'toggle', key: 'learned', label: 'Learn where photons connect' },
            { type: 'button', label: 'Send a sample\'s photons', act: s => { s.rounds = Math.min(s.rounds + 1, 40) } },
            { type: 'button', label: 'Start again', act: s => { s.rounds = 0; s.seed++ } },
        ],
        steps: { uniform: { learned: false, rounds: 1, seed: 3 }, learning: { learned: true, rounds: 1, seed: 3 }, learned: { learned: true, rounds: 10, seed: 3 } },
        draw(pen, s) {
            const world = worldOf(1), sun = world.sun, L = learnState(s), K = L.learn.K
            drawScene(pen, world)
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
            // the start line across the sun's rays at its true width, drawn 6 back from the floor rather than 14 (the
            // photons' rays are parallel, so where along them it is drawn changes nothing), its cells as bars of chance
            const cx = Math.cos(sun.dir), cy = Math.sin(sun.dir), px = -cy, py = cx, back = 6, ox = sun.aim[0] + cx * back, oy = sun.aim[1] + cy * back
            const at = t => [ox + px * (t - 0.5) * sun.width, oy + py * (t - 0.5) * sun.width]
            pen.line(at(0), at(1), { role: 'light', w: 1.4, exact: true })
            const top = Math.max(...L.learn.p)
            for (let k = 0; k < K; k++) {
                const a = at((k + 0.15) / K), b = at((k + 0.85) / K), h = 1.1 * L.learn.p[k] / top
                pen.shape([a, b, [b[0] + cx * h, b[1] + cy * h], [a[0] + cx * h, a[1] + cy * h]], { role: 'light', fill: 'fill', w: 0.6 })
            }
            pen.label([at(0.5)[0] + 0.4, at(0.5)[1] + 1.3], 'where photons start: each cell\'s chance', { role: 'light', size: 11 })
            // a few of the last sample's photons, from where they cross the drawn line
            const along = q => (q[0] - sun.aim[0]) * cx + (q[1] - sun.aim[1]) * cy
            for (const rec of L.shown) for (const [i, seg] of rec.entries()) {
                let a = seg.a
                if (i === 0 && seg.kind === 'photon') { const sa = along(seg.a), sb = along(seg.b), t = (sa - back) / (sa - sb); a = [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t] }
                pen.ray(a, seg.b, { role: seg.kind === 'connect' ? 'shadow' : 'light', w: 0.7, alpha: 0.5, arrow: false, exact: true })
            }
        },
        readout(s) {
            const L = learnState(s), top = Math.max(...L.learn.p)
            return `${s.learned ? 'learned' : 'uniform'} · sample ${s.rounds}: ${L.last.sent} photons, ${L.last.connected} connected to the eye (${(100 * L.last.connected / L.last.sent).toFixed(1)}%) · the busiest cell is sent ${(100 * top).toFixed(1)}% of them`
        },
    },

    kinds: {
        aspect: 1.6,
        world: { x: [-4.8, 4.2], y: [-0.7, 4.9] },
        state: { kind: 'direct' },
        controls: [{ type: 'seg', key: 'kind', options: [['direct', 'Sun on the floor'], ['caustic', 'Through the ball'], ['seen', 'Floor seen through it'], ['both', 'A caustic seen through it']] }],
        steps: { direct: { kind: 'direct' }, caustic: { kind: 'caustic' }, seen: { kind: 'seen' }, both: { kind: 'both' } },
        draw(pen, s) {
            // the pane stands only for the two kinds that are seen through glass
            const world = kindsWorld(s.kind === 'seen' || s.kind === 'both')
            drawScene(pen, world)
            sunRays(pen, 0.27)
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
            const k = KINDS[s.kind], { pts, cam } = k.path(world)
            for (let i = 0; i + 1 < pts.length; i++) pen.ray(pts[i], pts[i + 1], { role: i < cam ? 'cam' : 'light', w: 1.6, exact: true, arrow: false })
            pen.label([-4.6, 4.6], k.label, { role: k.who === 'nobody' ? 'blocked' : 'ink', size: 13 })
        },
        readout(s) { return KINDS[s.kind].readout },
    },
}

/* THE LEARNING, replayed from the state so a step is the same picture every time: `rounds` samples of 1500 photons,
   the map rebuilt after each (when learning) */
const LEARN = new Map()
function learnState(s) {
    const key = `${s.learned}|${s.rounds}|${s.seed}`
    if (LEARN.has(key)) return LEARN.get(key)
    const world = worldOf(1), learn = newLearn(24), R = rng(s.seed * 7907 + 11)
    let last = { sent: 0, connected: 0 }, shown = []
    for (let r = 0; r < Math.max(1, s.rounds); r++) {
        const rec = r === Math.max(1, s.rounds) - 1 ? [] : null
        const t = lightTrace(world, CAM, { n: 1500, rand: R, learn, record: rec, recordEvery: 7 })
        last = t; if (rec) shown = rec
        if (s.learned) learnRebuild(learn); else { learn.hits.fill(0); learn.emitted.fill(0) }
    }
    const out = { learn, last, shown }
    if (LEARN.size > 60) LEARN.clear()
    LEARN.set(key, out)
    return out
}

/* THE FOUR KINDS OF PATH, in a world of their own: figure 1's, and a pane of glass standing on the floor between the eye
   and the caustic, so that one kind can be seen through glass. Each path is traced (refraction only, as drawn), from
   the eye (blue) to the sun (orange). */
export const kindsWorld = (pane = true) => { const w = worldOf(0.27); if (pane) w.shapes.push({ kind: 'box', c: [-1.3, 0.62], h: [0.12, 0.62], glass: 1.5, name: 'pane' }); return w }
const sunDir = [Math.cos(75 * DEG), Math.sin(75 * DEG)]
/** a ray followed through glass by refraction alone, up to `n` crossings: its points, and where it ends */
function through(world, x, y, dx, dy, n = 4) {
    const pts = [[x, y]], H = {}
    for (let k = 0; k <= n; k++) {
        march(world, x, y, dx, dy, { far: 30 }, H)
        const sh = H.hit ? world.shapes[H.i] : null
        if (!sh || !sh.glass) { pts.push(H.hit ? [H.x, H.y] : [x + dx * 6, y + dy * 6]); return { pts, end: H.hit ? [H.x, H.y] : null, on: sh?.name } }
        const [nx, ny] = normalAt(world, H.x, H.y, H.i), g = glassStep(sh.glass, dx, dy, nx, ny, H.x, H.y, 1)
        pts.push([H.x, H.y]); x = g.x; y = g.y; dx = g.dx; dy = g.dy
    }
    return { pts, end: null }
}
/** the sun's ray through the ball's middle: where it lands on the floor (the caustic's centre), and its points */
export const photonPath = world => { const off = 0.4, st = [BALL.c[0] + sunDir[0] * 3 - sunDir[1] * off, BALL.c[1] + sunDir[1] * 3 + sunDir[0] * off]; return through(world, st[0], st[1], -sunDir[0], -sunDir[1]) }
/** the eye's ray that lands nearest floor point x, searched over its angle (through whatever glass is in the way) */
function eyeRayTo(world, x) {
    let best = null
    for (let a = -60; a <= -10; a += 0.02) {
        const t = through(world, CAM.eye[0], CAM.eye[1], Math.cos(a * DEG), Math.sin(a * DEG))
        if (t.on === 'floor' && (!best || Math.abs(t.end[0] - x) < Math.abs(best.end[0] - x))) best = t
    }
    return best
}
const KINDS = {
    direct: {
        who: 'camera', cam: 1, label: 'Counted by the camera\'s paths, aiming at the sun',
        path: () => { const f = [-2.6, 0]; return { pts: [CAM.eye, f, [f[0] + sunDir[0] * 4, f[1] + sunDir[1] * 4]], cam: 1 } },
        readout: 'eye → floor → sun: the floor sees the sun directly, so the camera\'s shadow ray aims at it and finds it. Light tracing does not count this kind: its photons connect only after glass or a mirror.',
    },
    caustic: {
        who: 'light', label: 'Counted by light tracing',
        path: world => { const t = photonPath(world); return { pts: [CAM.eye, ...t.pts.slice().reverse()], cam: 1 } },
        readout: 'eye → floor → glass → glass → sun: the caustic. The camera\'s shadow ray from the floor is blocked by the ball, and its bounce finds the sun through the glass only by chance; a photon from the sun goes through the glass by Snell and Fresnel and lands where the optics put it, and the floor there is seen straight from the eye. With the split the camera leaves it to the photons.',
    },
    seen: {
        who: 'camera', label: 'Counted by the camera\'s paths',
        path: world => { const t = eyeRayTo(world, -0.85), f = t.end; return { pts: [...t.pts, [f[0] + sunDir[0] * 4, f[1] + sunDir[1] * 4]], cam: t.pts.length - 1 } },
        readout: 'eye → glass → glass → floor → sun: the floor seen through the pane. The camera reaches the floor through the glass and aims at the sun from there; light tracing\'s connection from that floor to the eye would meet the pane. It stays the camera\'s, as everything does that light tracing cannot connect.',
    },
    both: {
        who: 'nobody', label: 'Counted by neither: a caustic seen through glass (chapter 19)',
        path: world => { const ph = photonPath(world), t = eyeRayTo(world, ph.end[0]); return { pts: [...t.pts, ...ph.pts.slice(0, -1).reverse()], cam: t.pts.length - 1 } },
        readout: 'eye → glass → glass → floor → glass → glass → sun: the caustic, seen through the pane. The camera\'s shadow ray from the floor meets the ball; light tracing\'s connection from the floor to the eye meets the pane. Neither side makes this path except by chance, so ShadyTracer has a third way, which meets in the middle: the photon map, chapter 19.',
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
