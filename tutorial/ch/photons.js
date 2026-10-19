//======================================================================================================================
// CHAPTER "Photon mapping": its figures.
//
//   map     chapter 18's ball and sun with a pane of glass in front: the floor under the ball seen through the pane,
//           which neither the camera's paths nor light tracing can count, and the photon map that can -- photons
//           stored where they land, gathered within a radius r where the eye's path has seen only glass
//   shrink  one point of that floor, at the caustic's peak: the map's estimate sample after sample, with a radius
//           held fixed (a blur that never goes) and one that shrinks as Knaus and Zwicker's schedule says
//   grid    finding the photons near a point fast: cells of size 2r, a hash table of lists, the two cells a gather
//           visits, and a full cell walked by a few of its sub-lists, each counting for the rest
//
// The flat world's photon map (kit/flatland.js: lightTrace's `store`, tracePath's `map`, gather, radiusFlat). In the
// plane a gather's "area" is the length 2r it collects from, where ShadyTracer's is a disc, pi r^2.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { rng, tracePath, cameraRay, lightTrace, march, glassStep, radiusFlat } from '../kit/flatland.js'
import { stepMoments, standardError } from '../../lib/pathtracer/core/measure.js'
import { hashCell, sppmSubsOf, SPPM_SUBS } from '../../lib/pathtracer/core/sppm.js'

const DEG = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/* THE SCENE, chapter 18's: a matte floor of albedo 0.8, a glass ball of index 1.5 over it, the sun 75 degrees up from
   the right, and a pane of glass standing on the floor between the eye and the ball */
export const BALL = { c: [0.6, 1.5], r: 0.75 }
const SUN_DIR = 75 * DEG
export const sunOf = half => ({ dir: SUN_DIR, half: half * DEG, L: 1 / (2 * Math.sin(half * DEG)), aim: [0.3, 0.3], width: 12, back: 14 })
export const worldOf = (pane = true) => ({
    sky: 0, sun: sunOf(0.27),
    shapes: [
        { kind: 'box', c: [0, -0.3], h: [6.5, 0.3], albedo: 0.8, name: 'floor' },
        { kind: 'circle', c: BALL.c, r: BALL.r, glass: 1.5, name: 'ball' },
        // the pane stands a hundredth above the floor: glass touching an opaque surface would let a ray leave the glass
        // straight into the floor's inside, where the march finds the floor's underside (13 photons a sample did)
        ...(pane ? [{ kind: 'box', c: [-1.3, 0.63], h: [0.12, 0.62], glass: 1.5, name: 'pane' }] : []),
    ],
})
const PIX = 48
export const CAM = { eye: [-4.2, 3.0], dir: Math.atan2(0 - 3.0, 0.3 + 4.2), fov: 56 * DEG, pixels: PIX }
/** the pixels that see the floor through the pane: the readout's region and the strip's bracket */
export const panePixels = (() => {
    const w = worldOf(), H = {}, out = []
    for (let i = 0; i < PIX; i++) { const [ox, oy, dx, dy] = cameraRay(CAM, i, 0.5); march(w, ox, oy, dx, dy, {}, H); if (H.hit && w.shapes[H.i].name === 'pane') out.push(i) }
    return out
})()

/* ONE SAMPLE: its photons first (stored where they land, and connected to the eye: chapter 18), then the camera's paths,
   with the split, and with the map when it is on -- ShadyTracer's order, photons first, so a camera ray finds this
   sample's photons (sppm.js, WHY PHOTONS FIRST) */
export const PHOTONS = 1200
export function sample(world, on, r, R, rec = null) {
    const v = new Float64Array(PIX), store = []
    const t = lightTrace(world, CAM, { n: PHOTONS, rand: R, store })
    for (let i = 0; i < PIX; i++) v[i] += t.img[i]
    const map = on ? { photons: store, r } : null
    for (let i = 0; i < PIX; i++) {
        const [ox, oy, dx, dy] = cameraRay(CAM, i, R()), pr = rec && panePixels.includes(i) && i % 3 === 0 ? [] : null
        v[i] += tracePath(world, ox, oy, dx, dy, { nee: true, split: true, map, maxBounce: 10, rand: R, record: pr })
        if (pr) rec.cam.push(pr)
    }
    if (rec) rec.photons = store
    return v
}
const moments = () => ({ Y: 0, V: 0, S: 0, cnt: 0 })
function film(s, ms) {
    const t0 = performance.now(), world = worldOf()
    do {
        const R = rng(s.seed * 1000003 + s.spp * 7919), rec = s.spp === 0 ? s.shown : null
        const v = sample(world, s.on, s.r, R, rec)
        for (let i = 0; i < PIX; i++) s.pix[i] = stepMoments(s.pix[i], v[i])
        s.spp++
    } while (performance.now() - t0 < ms && s.spp < s.max)
    return s.spp < s.max
}
/** a run to the end, for the test */
export function render(s) {
    const r = { seed: s.seed ?? 1, spp: 0, max: s.max ?? 64, on: s.on, r: s.r ?? 0.06, pix: Array.from({ length: PIX }, moments), shown: { cam: [], photons: [] } }
    film(r, 1e9)
    return r
}
export const region = pix => { let m = 0, v = 0; for (const i of panePixels) { m += pix[i].Y; v += (standardError(pix[i].V, pix[i].S) ?? 0) ** 2 } return { mean: m / panePixels.length, se: Math.sqrt(v) / panePixels.length } }

function strip(pen, pix, x0, y0, x1, h, k, label, mark, markLabel) {
    const px0 = pen.X(x0), w = pen.X(x1) - px0, top = pen.Y(y0), bot = top + pen.view.s * h, at = i => px0 + w * (i + 0.5) / PIX
    pen.image(px0, top, w, pen.view.s * h, PIX, 1, i => { const v = k * pix[i].Y; return [v, v, v] })
    pen.labelPx(px0, top - 20, label, { role: 'soft', size: 11, base: 'bottom' })
    for (const n of [1, 10, 20, 30, 40, PIX]) pen.labelPx(at(n - 1), bot + 3, String(n), { role: 'soft', size: 9, align: 'center', base: 'top' })
    const a = at(mark[0]) - w / PIX / 2, b = at(mark[mark.length - 1]) + w / PIX / 2, { ctx } = pen
    ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a, top - 3); ctx.lineTo(a, top - 1); ctx.lineTo(b, top - 1); ctx.lineTo(b, top - 3); ctx.stroke(); ctx.restore()
    pen.labelPx(b + 6, top - 6, markLabel, { role: 'accent', size: 11, base: 'bottom' })
    // pointed at, a pixel's reading and its error bar (measure.js, the renderer's own)
    const hp = pen.hover({ x: px0, y: top, w, h: bot - top })
    if (hp) {
        const i = clamp(Math.floor((hp.x - px0) / w * PIX), 0, PIX - 1), se = standardError(pix[i].V, pix[i].S)
        ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.lineWidth = 1.5; ctx.strokeRect(px0 + w * i / PIX, top, w / PIX, bot - top); ctx.restore()
        pen.tip(hp.x, hp.y, [`pixel ${i + 1}${mark.includes(i) ? ', through the pane' : ''}`, se == null ? `${pix[i].Y.toFixed(3)}` : `${pix[i].Y.toFixed(3)} ± ${se.toFixed(3)}`])
    }
}
function sunRays(pen) {
    const dx = -Math.cos(SUN_DIR), dy = -Math.sin(SUN_DIR)
    for (let k = -2; k <= 2; k++) { const x = 1.4 + k * 0.85, y = 3.75; pen.ray([x, y], [x + dx * 0.9, y + dy * 0.9], { role: 'light', w: 1.2, exact: true }) }
    pen.label([4.1, 4.02], 'the sun, 0.54° across', { role: 'light', size: 12, align: 'right' })
}
const drawScene = (pen, world) => { for (const sh of world.shapes) pen.flat(sh, { id: sh.name, role: sh.glass ? 'glass' : 'solid' }) }

/* THE SHRINKING RADIUS AT ONE POINT: the floor's photons sample after sample (those that came through the ball), and the
   estimate at X0, the caustic's peak, by fixed and shrinking radii; the true value by many photons sent evenly */
export const X0 = 0.2, SHRINK_K = 300, SHRINK_N = 600
let LANDED = null
function landed() {
    if (LANDED) return LANDED
    const world = worldOf(false), R = rng(4242)
    LANDED = []
    for (let k = 0; k < SHRINK_K; k++) {
        const store = []
        lightTrace(world, CAM, { n: SHRINK_N, rand: R, store, connect: false })
        LANDED.push(store.filter(p => p.ny > 0.99 && Math.abs(p.y) < 0.01).map(p => [p.x, p.flux]))
    }
    return LANDED
}
/** the floor's radiance at X0 from one sample's photons, gathered within r: (rho / 2) sum Phi / (2r) */
const at0 = (ph, r) => { let s = 0; for (const [x, f] of ph) if (Math.abs(x - X0) < r) s += f; return 0.4 * s / (2 * r) }
/** the running means, fixed and shrinking, sample by sample */
export function shrinkRun(r1, alpha) {
    const L = landed(), fixed = [], shrink = []
    let a = 0, b = 0
    for (let k = 1; k <= L.length; k++) { a += at0(L[k - 1], r1); b += at0(L[k - 1], radiusFlat(r1, k, alpha)); fixed.push(a / k); shrink.push(b / k) }
    return { fixed, shrink }
}
/* THE TRUE VALUE: the sun's rays through the ball, 400,000 of them evenly across its width with no randomness, each
   carried by Fresnel's share through both faces, to where it lands on the floor. The light the map also stores there
   by other ways -- off the ball's outside, or reflected inside it before leaving -- moves the value at X0 by 0.02%
   (followed down every branch to four reflections inside: 0.9382 against 0.9380), so they are left out. The ball is a
   circle, so each crossing is solved exactly rather than marched. */
const LAND = (() => {
    const M = 400000, half = BALL.r * 1.02, cx = Math.cos(SUN_DIR), cy = Math.sin(SUN_DIR), px = -cy, py = cx
    const xs = new Float64Array(M), ws = new Float64Array(M)
    for (let i = 0; i < M; i++) {
        const off = (2 * (i + 0.5) / M - 1) * half
        let x = BALL.c[0] + cx * 3 + px * off, y = BALL.c[1] + cy * 3 + py * off, dx = -cx, dy = -cy, w = 1, faces = 0
        for (const far of [false, true]) {
            const ox = x - BALL.c[0], oy = y - BALL.c[1], b = ox * dx + oy * dy, q = b * b - (ox * ox + oy * oy - BALL.r ** 2)
            if (q < 0) break                                                   // past the ball: the map stores none of it
            const t = far ? -b + Math.sqrt(q) : -b - Math.sqrt(q), hx = x + t * dx, hy = y + t * dy
            const g = glassStep(1.5, dx, dy, (hx - BALL.c[0]) / BALL.r, (hy - BALL.c[1]) / BALL.r, hx, hy, 1, 0)
            w *= 1 - g.R; x = hx; y = hy; dx = g.dx; dy = g.dy; faces++
        }
        if (faces === 2 && dy < 0) { xs[i] = x - y / dy * dx; ws[i] = w * 2 * half / M }    // each ray: 2 half / M of the beam's width
    }
    return { xs, ws }
})()
/** the floor's radiance (rho / 2) E averaged over [x - h, x + h], E the light through the ball (the sun's rays carry
 *  illuminance 1 across them): the true value at x for a small h, and what a gather of radius h settles on */
export function trueAt(x, h) { let s = 0; for (let i = 0; i < LAND.xs.length; i++) if (LAND.ws[i] && Math.abs(LAND.xs[i] - x) < h) s += LAND.ws[i]; return 0.4 * s / (2 * h) }
export const TRUE_X0 = trueAt(X0, 0.004)

/* THE GRID IN ONE DIMENSION: the floor's photons of one sample in cells of size 2r, cells hashed into HEADS lists as
   sppm.js hashes them (one coordinate here, and four lists where it has a million, so that two cells share one), a
   gather at x visiting its own cell and the nearer neighbour; and a cell whose list holds more than its share of the
   budget walked by m of its 32 sub-lists from a start, each record found counting 32 / m -- sppm.js's own hashCell
   and sppmSubsOf, with a share of 6 records where the engine's is 64 (SPPM_VISIT / 8), for a sample of 27 photons. */
export const HEADS = 4, SUBS = SPPM_SUBS, SHARE = 6
export const hash1 = c => hashCell(c, 0, 0, HEADS)
export const subsOf = count => sppmSubsOf(count, SHARE)
/* one sample's floor photons, each on a sub-list drawn uniformly as sppmStore draws it */
const GRID_PH = (() => {
    const world = worldOf(false), R = rng(77), store = []
    lightTrace(world, CAM, { n: 260, rand: R, store, connect: false })
    return store.filter(p => p.ny > 0.99 && Math.abs(p.y) < 0.01).map(p => ({ x: p.x, f: p.flux, sub: Math.min(SUBS - 1, Math.floor(R() * SUBS)) }))
})()
export const gridPhotons = () => GRID_PH
/** a gather at x, radius r: the cells, the records it walks (`seen`: another cell's or its own), those it counts, and
 *  its estimate. With the budget a list of more than SHARE records (its count: sppmGather reads the list's, collisions
 *  and all) is walked by m of its sub-lists from `start`, each record found counting SUBS / m. */
export function gridGather(x, r, { budget = false, start = 0 } = {}) {
    const c0 = Math.floor(x / (2 * r)), side = x / (2 * r) - c0 >= 0.5 ? 1 : -1, cells = [c0, c0 + side]
    let sum = 0
    const seen = new Set(), other = new Set(), counted = new Set(), split = []
    for (const c of cells) {
        const h = hash1(c), list = GRID_PH.filter(p => hash1(Math.floor(p.x / (2 * r))) === h), whole = !budget || list.length <= SHARE
        const m = whole ? SUBS : subsOf(list.length), wgt = whole ? 1 : SUBS / m, subs = Array.from({ length: m }, (_, j) => (start + j) % SUBS)
        if (!whole) split.push({ cell: c, count: list.length, m, subs })
        for (const p of list) {
            if (!whole && !subs.includes(p.sub)) continue
            seen.add(p)
            if (Math.floor(p.x / (2 * r)) !== c) { other.add(p); continue }
            if (Math.abs(p.x - x) < r) { counted.add(p); sum += wgt * p.f }
        }
    }
    return { cells, walked: seen.size, other: other.size, counted: counted.size, seen, otherSet: other, countedSet: counted, split, est: 0.4 * sum / (2 * r) }
}

export const figures = {
    map: {
        aspect: 1.45,
        world: { x: [-4.8, 4.2], y: [-1.95, 4.15] },
        state: { on: false, r: 0.06, seed: 1, spp: 0, max: 300 },
        controls: [
            { type: 'seg', key: 'on', options: [[false, 'Camera and light tracing'], [true, 'With the photon map']] },
            { type: 'slider', key: 'r', label: 'radius r', min: 0.01, max: 0.4, step: 0.005, fmt: v => v.toFixed(3), when: s => s.on },
        ],
        steps: { missing: { on: false, r: 0.06 }, with: { on: true, r: 0.06 }, wide: { on: true, r: 0.4 }, narrow: { on: true, r: 0.012 } },
        work: {
            reset(s) { s.spp = 0; s.pix = Array.from({ length: PIX }, moments); s.shown = { cam: [], photons: [] } },
            add(s, ms) { return film(s, ms) },
        },
        draw(pen, s) {
            const world = worldOf()
            drawScene(pen, world)
            sunRays(pen)
            // this sample's stored photons, as ticks on the floor where they landed
            if (s.on) for (const p of s.shown.photons) if (p.ny > 0.99) pen.line([p.x, p.y], [p.x, p.y + 0.12], { role: 'light', w: 1, alpha: 0.5, exact: true })
            for (const rec of s.shown.cam) for (const seg of rec) pen.ray(seg.a, seg.b, { role: seg.kind === 'shadow' ? 'shadow' : seg.kind === 'blocked' ? 'blocked' : 'cam', w: 0.8, alpha: 0.6, arrow: false, exact: true })
            // where a camera path through the pane gathers: the eye's paths end their glass at the floor; the radius
            if (s.on) for (const rec of s.shown.cam) { const e = rec.find(g => g.kind !== 'shadow' && g.kind !== 'blocked' && Math.abs(g.b[1]) < 0.02); if (e) pen.circle(e.b, Math.max(s.r, pen.world(2)), { role: 'accent', w: 1.2, dash: [3, 2], exact: true }) }
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
            strip(pen, s.pix, -4.3, -1.2, 3.9, 0.42, 1.2, 'the eye\'s picture, brightened 1.2 times: pixel 1 the top of its view, 48 the bottom', panePixels, 'through the pane')
        },
        readout(s) {
            const g = region(s.pix)
            return `${s.on ? `with the photon map, r = ${s.r.toFixed(3)}` : 'the camera\'s paths and light tracing, as chapter 18 left them'} · ${s.spp} sample${s.spp === 1 ? '' : 's'} · through the pane the pixels average ${g.mean.toFixed(3)} ± ${g.se.toFixed(3)}`
        },
    },

    shrink: {
        aspect: 1.75,
        world: { x: [0, 1], y: [0, 1] },
        state: { shrink: false, r1: 0.25, alpha: 2 / 3 },
        controls: [
            { type: 'toggle', key: 'shrink', label: 'Shrink the radius' },
            { type: 'slider', key: 'r1', label: 'first radius r₁', min: 0.02, max: 0.5, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'alpha', label: 'α', min: 0.2, max: 0.95, step: 0.01, fmt: v => v.toFixed(2), when: s => s.shrink },
        ],
        steps: { fixed: { shrink: false, r1: 0.25, alpha: 2 / 3 }, shrinking: { shrink: true, r1: 0.25, alpha: 2 / 3 }, fast: { shrink: true, r1: 0.25, alpha: 0.25 } },
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.09, y: H * 0.08, w: W * 0.86, h: H * 0.5 }, rect2 = { x: W * 0.09, y: H * 0.72, w: W * 0.86, h: H * 0.18 }
            const run = shrinkRun(s.r1, s.alpha), ks = run.fixed.map((_, i) => i + 1), lg = k => Math.log10(k)
            const series = [
                { name: 'the true value', pts: [[0, TRUE_X0], [lg(SHRINK_K), TRUE_X0]], role: 'ink', w: 1, dash: [5, 4], tip: false },
                { name: 'where r held at r₁ settles: the light averaged over 2r₁', pts: [[0, trueAt(X0, s.r1)], [lg(SHRINK_K), trueAt(X0, s.r1)]], role: 'blocked', w: 1, dash: [2, 3], tip: false },
                { name: 'r held at r₁', pts: ks.map(k => [lg(k), run.fixed[k - 1]]), role: 'blocked', w: 1.6 },
            ]
            if (s.shrink) series.push({ name: 'r shrinking', pts: ks.map(k => [lg(k), run.shrink[k - 1]]), role: 'cam', w: 1.8 })
            plot(pen, rect, {
                x: [0, lg(SHRINK_K)], y: [0.2, 1.4], xticks: [], yticks: [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4], fmt: v => v.toFixed(1),
                hoverX: v => `after ${Math.round(10 ** v)} samples`, hoverY: v => v.toFixed(3), series,
            })
            for (const [k, t] of [[1, '1'], [10, '10'], [100, '100'], [300, '300']]) pen.labelPx(rect.x + rect.w * lg(k) / lg(SHRINK_K), rect.y + rect.h + 4, t, { role: 'soft', size: 10, align: 'center', base: 'top' })
            pen.labelPx(rect.x - 30, rect.y - 18, `the floor's brightness at the caustic's peak, averaged over the samples so far (true: ${TRUE_X0.toFixed(3)})`, { role: 'soft', size: 12 })
            pen.labelPx(rect.x + rect.w, rect.y + rect.h + 18, 'samples (marks at 1, 10, 100 and 300: each step ten times as many)', { role: 'soft', size: 11, align: 'right', base: 'top' })
            const rs = ks.map(k => s.shrink ? radiusFlat(s.r1, k, s.alpha) : s.r1)
            plot(pen, rect2, { x: [0, lg(SHRINK_K)], y: [0, 0.5], xticks: [], yticks: [0, 0.25, 0.5], fmt: v => v.toFixed(2), hoverX: v => `sample ${Math.round(10 ** v)}`, hoverY: v => `r = ${v.toFixed(3)}`, series: [{ name: 'r', pts: ks.map((k, i) => [lg(k), rs[i]]), role: s.shrink ? 'cam' : 'blocked', w: 1.4 }] })
            pen.labelPx(rect2.x - 30, rect2.y - 16, 'the radius, sample by sample (the same samples, the same marks)', { role: 'soft', size: 12 })
            for (const [k, t] of [[1, '1'], [10, '10'], [100, '100'], [300, '300']]) pen.labelPx(rect2.x + rect2.w * lg(k) / lg(SHRINK_K), rect2.y + rect2.h + 4, t, { role: 'soft', size: 10, align: 'center', base: 'top' })
        },
        readout(s) {
            const run = shrinkRun(s.r1, s.alpha), f = run.fixed[SHRINK_K - 1], g = run.shrink[SHRINK_K - 1]
            return `after ${SHRINK_K} samples of ${SHRINK_N} photons: r held at ${s.r1.toFixed(2)} reads ${f.toFixed(3)} (it settles on ${trueAt(X0, s.r1).toFixed(3)})${s.shrink ? `, r shrinking (to ${radiusFlat(s.r1, SHRINK_K, s.alpha).toFixed(3)}) reads ${g.toFixed(3)}` : ''} · the true value ${TRUE_X0.toFixed(3)}`
        },
    },

    grid: {
        aspect: 1.65,
        world: { x: [-2.2, 2.6], y: [-1.5, 1.41] },
        state: { x: 0.31, r: 0.15, budget: false, start: 0 },
        controls: [
            { type: 'slider', key: 'r', label: 'radius r', min: 0.05, max: 0.4, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'toggle', key: 'budget', label: 'A budget of 6 records a cell' },
            { type: 'button', label: 'The next start', act: s => { s.start = (s.start + 1) % SUBS }, when: s => s.budget },
        ],
        steps: { walk: { x: 0.31, r: 0.15, budget: false, start: 0 }, collide: { x: -0.5, r: 0.15, budget: false, start: 0 }, budget: { x: 0.31, r: 0.15, budget: true, start: 0 } },
        drag: { x: (s, p) => { s.x = Math.round(clamp(p[0], -2, 2.4) * 100) / 100 } },
        draw(pen, s) {
            const g = gridGather(s.x, s.r, { budget: s.budget, start: s.start }), c = 2 * s.r, ph = gridPhotons(), cellOf = p => Math.floor(p.x / c)
            // the floor, its cells (the two visited shaded), the photons: counted, walked as another cell's, or not walked
            pen.line([-2.2, 0], [2.6, 0], { role: 'solid', w: 1.4, exact: true })
            for (let k = Math.ceil(-2.2 / c); k * c <= 2.6; k++) pen.line([k * c, -0.06], [k * c, 0.06], { role: 'soft', w: 0.8, exact: true })
            for (const cc of g.cells) pen.shape([[cc * c, 0], [(cc + 1) * c, 0], [(cc + 1) * c, 0.5], [cc * c, 0.5]], { role: 'accent', fill: 'fill', w: 0.6 })
            pen.label([(Math.min(...g.cells) + 1) * c, -0.2], `cells ${g.cells.join(' and ')}`, { role: 'accent', size: 11, align: 'center' })
            for (const p of ph) {
                const role = g.countedSet.has(p) ? 'cam' : g.otherSet.has(p) ? 'blocked' : 'light', walked = g.seen.has(p)
                pen.line([p.x, 0], [p.x, g.countedSet.has(p) ? 0.36 : 0.28], { role, w: walked ? 1.8 : 1, alpha: walked ? 0.95 : 0.35, exact: true })
            }
            pen.line([s.x - s.r, 0.42], [s.x + s.r, 0.42], { role: 'cam', w: 2.2, exact: true })
            pen.handle('x', [s.x, 0.62], { role: 'cam', label: 'gather here' })
            g.split.forEach((t, k) => pen.label([-2.15, 1.3 - k * 0.14], `list ${hash1(t.cell)}: ${t.count} records, over its share of 6: ${t.m} of its ${SUBS} sub-lists walked, each find × ${(SUBS / t.m).toFixed(2)}`, { role: 'accent', size: 11 }))
            // the hash table: each list's records and the cells they belong to, the two lists a gather walks marked
            const bw = 4.8 / HEADS
            for (let h = 0; h < HEADS; h++) {
                const x0 = -2.2 + h * bw, visited = g.cells.some(cc => hash1(cc) === h), mine = ph.filter(p => hash1(cellOf(p)) === h)
                const cells = [...new Set(mine.map(cellOf))].sort((u, v) => u - v)
                pen.shape([[x0 + 0.04, -0.75], [x0 + bw - 0.04, -0.75], [x0 + bw - 0.04, -1.15], [x0 + 0.04, -1.15]], { role: visited ? 'accent' : 'soft', fill: visited ? 'fill' : null, w: visited ? 1.4 : 0.8 })
                pen.label([x0 + bw / 2, -0.95], `${mine.length} record${mine.length === 1 ? '' : 's'}`, { role: visited ? 'accent' : 'soft', size: 11, align: 'center' })
                pen.label([x0 + bw / 2, -1.33], `list ${h}${cells.length ? `: cell${cells.length > 1 ? 's' : ''} ${cells.join(', ')}` : ''}`, { role: 'soft', size: 10, align: 'center' })
            }
            pen.label([-2.15, -0.6], 'the hash table, four lists: a cell\'s photons go on list (cell × 73856093) mod 4', { role: 'soft', size: 11 })
            // the ticks' key, along the top right
            const KEY = [['cam', 1.8, 0.95, 'counted (its own cell, within r)'], ['blocked', 1.8, 0.95, 'walked: another cell\'s'], ['light', 1.8, 0.95, 'walked: its own cell, farther than r'], ['light', 1, 0.35, 'not walked']]
            KEY.forEach(([role, w, alpha, t], k) => { const y = 1.02 - k * 0.12; pen.line([1.05, y - 0.04], [1.05, y + 0.04], { role, w, alpha, exact: true }); pen.label([1.12, y], t, { role: 'soft', size: 10, base: 'middle' }) })
        },
        readout(s) {
            const g = gridGather(s.x, s.r, { budget: s.budget, start: s.start }), exact = gridGather(s.x, s.r).est
            let mean = 0; if (s.budget) { for (let st = 0; st < SUBS; st++) mean += gridGather(s.x, s.r, { budget: true, start: st }).est; mean /= SUBS }
            return `cells ${g.cells.join(' and ')} (lists ${g.cells.map(hash1).join(' and ')}) · walked ${g.walked} records, ${g.other} of them another cell's, counted ${g.counted} within r · estimate ${g.est.toFixed(3)}${s.budget ? ` from start ${s.start}; averaged over all ${SUBS} starts ${mean.toFixed(3)}, the whole walk's ${exact.toFixed(3)}` : ''}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
