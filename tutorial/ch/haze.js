//======================================================================================================================
// CHAPTER "Dust in the air": its figures.
//
//   free     a box of dust and a sheet of rays: where each meets a particle, drawn by haze.js's own hazeCollideJS, and
//            the distances against the exponential they follow; then one ray's march, stopped where its drawn
//            distance falls and moved back to it (hazeArrived, hazeAt)
//   phase    Henyey-Greenstein, haze.js's hgEvalJS: its shape round the point for an asymmetry g, and hgSampleJS's
//            directions against it
//   beam     a dark room, a window, the sun, and dust in the air: the beam the eye sees, by the phase function's own
//            bounces alone and by aiming at the sun from the air
//   furnace  the dust's energy check, the bench's `haze` row in the flat world: albedo 1 in a uniform sky reads the sky;
//            the controls that say the check looked at anything
//
// The flat world's dust (kit/flatland.js: hazeSpan2, hazeTr2, hazeCollide2, phase2, tracePath with world.haze) is
// haze.js's arithmetic in a plane, its phase function the circle's version of Henyey-Greenstein.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { rng, tracePath, cameraRay, march, phase2, hazeSpan2 } from '../kit/flatland.js'
import { stepMoments, standardError } from '../../lib/pathtracer/core/measure.js'
import { hazeUniforms, hazeCollideJS, hgEvalJS, hgSampleJS } from '../../lib/pathtracer/core/haze.js'

const DEG = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const moments = () => ({ Y: 0, V: 0, S: 0, cnt: 0 })

/* FREE FLIGHT: a box 4 long and 2 high, the engine's uniforms for it (a third axis 1 deep, never crossed), and rays across
   it from the left. The scene's radius (hazeSpan's sphere) is made huge: the flat world has no 400 m edge. */
export const FREE_BOX = { c: [0, 0], h: [2, 1] }
export const freeU = mfp => hazeUniforms({ centre: [0, 0, 0], half: [2, 1, 1], mfp, albedo: [1, 1, 1], g: 0 }, 1, 0)
const FAR_R = 1e6
/** one ray across the box from (x, y) along angle a: where it meets a particle, or null */
export function collide(mfp, x, y, a, u) {
    const d = [Math.cos(a), Math.sin(a), 0], t = hazeCollideJS(freeU(mfp), [x, y, 0], d, 12, FAR_R, u)
    return t < 0 ? null : { t, x: x + d[0] * t, y: y + d[1] * t }
}
export const SHEET = 26, DRAWS = 4000, BINS = 16
/** the distances into the box at which DRAWS straight crossings (length 4) meet a particle: bins of 0.25, and those that
 *  passed */
export function histogram(mfp, seed) {
    const R = rng(seed), bins = new Array(BINS).fill(0)
    let passed = 0
    for (let i = 0; i < DRAWS; i++) {
        const c = collide(mfp, -3, 0, 0, R())
        if (!c) passed++; else bins[Math.min(BINS - 1, Math.floor((c.x + 2) / (4 / BINS)))]++
    }
    return { bins, passed }
}
/* ONE RAY'S MARCH through the box past a stone in it: the march's steps, and the collision drawn as the leg starts */
const MARCH_WORLD = { shapes: [{ kind: 'circle', c: [0.6, 0.55], r: 0.4, albedo: 0.6 }, { kind: 'box', c: [0.3, -1.6], h: [3, 0.3], albedo: 0.6 }] }
export function marchOne(mfp, u) {
    const a = -4 * DEG, x0 = -3, y0 = 0.25, steps = []
    const H = {}; march(MARCH_WORLD, x0, y0, Math.cos(a), Math.sin(a), { steps, far: 12 }, H)
    const c = collide(mfp, x0, y0, a, u), tEnd = H.hit ? H.t : 12
    let k = steps.length, t = 0
    if (c && c.t < tEnd) for (k = 0, t = 0; k < steps.length; k++) { t += Math.abs(steps[k].d) * 0.9; if (t >= c.t) break }
    return { steps, c: c && c.t < tEnd ? c : null, k, hit: H.hit ? [H.x, H.y] : null, a, x0, y0 }
}

/* THE PHASE FUNCTION: Henyey-Greenstein over the sphere (haze.js), its angle's density 2 pi sin(theta) p(cos theta) */
export const PH_N = 3000, PH_BINS = 18
export function phaseDraws(g, seed) {
    const R = rng(seed), bins = new Array(PH_BINS).fill(0), pts = []
    let mc = 0
    for (let i = 0; i < PH_N; i++) {
        const v = hgSampleJS([1, 0, 0], g, [R(), R()]), c = clamp(v[0], -1, 1), th = Math.acos(c)
        mc += c
        bins[Math.min(PH_BINS - 1, Math.floor(th / Math.PI * PH_BINS))]++
        if (i < 240) pts.push({ th, side: v[1] >= 0 ? 1 : -1 })
    }
    return { bins, pts, mean: mc / PH_N }
}
export const sphereIntegral = g => { let s = 0; const N = 4000; for (let i = 0; i < N; i++) { const th = (i + 0.5) / N * Math.PI; s += 2 * Math.PI * Math.sin(th) * hgEvalJS(Math.cos(th), g) } return s * Math.PI / N }

/* THE ROOM: a pale floor (albedo 0.6), a dark ceiling and walls (0.2), a window 0.8 high in the right wall, the sun 35 degrees up beyond it (0.54
   degrees across, its illuminance 1 across its rays: chapter 18's), and dust filling the room. The eye on the left,
   looking across: above the beam at the ceiling, through it, and down at the floor it lights. */
const SUN_EL = 35 * DEG
export const sunOf = half => ({ dir: SUN_EL, half: half * DEG, L: 1 / (2 * Math.sin(half * DEG)), aim: [2, 1.6], width: 12, back: 14 })
export const WINDOW = [1.8, 2.6], ROOF_Y = 3.2, WALL_X = 5
export const roomOf = ({ dust = true, mfp = 6, g = 0.7, albedo = 0.9, half = 0.27 } = {}) => ({
    sky: 0, sun: sunOf(half),
    shapes: [
        { kind: 'box', c: [0, -0.3], h: [5.4, 0.3], albedo: 0.6, name: 'floor' },
        { kind: 'box', c: [0, ROOF_Y + 0.2], h: [5.4, 0.2], albedo: 0.2, name: 'ceiling' },
        { kind: 'box', c: [-5.2, 1.6], h: [0.2, 1.6], albedo: 0.2, name: 'wall' },
        { kind: 'box', c: [5.2, WINDOW[0] / 2], h: [0.2, WINDOW[0] / 2], albedo: 0.2, name: 'wall' },
        { kind: 'box', c: [5.2, (WINDOW[1] + ROOF_Y) / 2], h: [0.2, (ROOF_Y - WINDOW[1]) / 2], albedo: 0.2, name: 'wall' },
    ],
    haze: dust ? { c: [0, 1.6], h: [5, 1.6], mfp, albedo, g } : null,
})
const PIX = 48
export const CAM = { eye: [-4.7, 2.9], dir: -18 * DEG, fov: 70 * DEG, pixels: PIX }
/** a point in the room's air the sun reaches through the window: its line to the sun passes the window at both faces of
 *  the wall */
export const inBeam = (x, y) => y > 0 && y < ROOF_Y && x < WALL_X && [WALL_X, WALL_X + 0.4].every(w => { const yy = y + (w - x) * Math.tan(SUN_EL); return yy >= WINDOW[0] && yy <= WINDOW[1] })
/** the pixels whose middle ray crosses the beam in the air, and those that end on its patch of floor */
export const { beamPixels, patchPixels } = (() => {
    const w = roomOf({ dust: false }), H = {}, beam = [], patch = []
    for (let i = 0; i < PIX; i++) {
        const [ox, oy, dx, dy] = cameraRay(CAM, i, 0.5)
        march(w, ox, oy, dx, dy, {}, H)
        if (H.hit && w.shapes[H.i].name === 'floor' && inBeam(H.x, 0.001)) { patch.push(i); continue }
        let crosses = false
        for (let t = 0; t < H.t; t += 0.01) if (inBeam(ox + dx * t, oy + dy * t)) { crosses = true; break }
        if (crosses) beam.push(i)
    }
    return { beamPixels: beam, patchPixels: patch }
})()
export const MODES = [['clear', 'No dust'], ['phase', 'Dust: bounces only'], ['aim', 'Dust: aim at the sun']]
const optsOf = mode => ({ nee: true, hazeNee: mode === 'aim', maxBounce: 12 })
export function roomSample(world, mode, R, rec = null) {
    const v = new Float64Array(PIX), o = optsOf(mode)
    for (let i = 0; i < PIX; i++) {
        // every sixth pixel's path drawn, and one across the beam's middle, whose shadow rays from the dust reach the sun
        const [ox, oy, dx, dy] = cameraRay(CAM, i, R()), pr = rec && (i % 6 === 2 || i === beamPixels[beamPixels.length >> 1]) ? [] : null
        v[i] = tracePath(world, ox, oy, dx, dy, { ...o, rand: R, record: pr })
        if (pr) rec.push(pr)
    }
    return v
}
function film(s, ms, worldOf, sampler) {
    const t0 = performance.now(), world = worldOf(s)
    do {
        const R = rng(s.seed * 1000003 + s.spp * 7919), rec = s.spp === 0 ? s.shown : null
        const v = sampler(world, s, R, rec)
        for (let i = 0; i < v.length; i++) s.pix[i] = stepMoments(s.pix[i], v[i])
        s.spp++
    } while (performance.now() - t0 < ms && s.spp < s.max)
    return s.spp < s.max
}
const roomWorld = s => roomOf({ dust: s.mode !== 'clear', mfp: s.mfp, g: s.g })
const roomSampler = (world, s, R, rec) => roomSample(world, s.mode, R, rec)
/** a run to the end, for the test */
export function renderRoom(o) {
    const s = { seed: 1, mode: 'aim', mfp: 6, g: 0.7, max: 64, ...o, spp: 0, pix: Array.from({ length: PIX }, moments), shown: [] }
    film(s, 1e9, roomWorld, roomSampler)
    return s
}
export const regionOf = (pix, idx) => { let m = 0, v = 0; for (const i of idx) { m += pix[i].Y; v += (standardError(pix[i].V, pix[i].S) ?? 0) ** 2 } return { mean: m / idx.length, se: Math.sqrt(v) / idx.length } }

/* THE FURNACE: a disc in a box of dust 3.2 wide, mean free path 1.5 (the bench's, in metres there), all in a sky of
   radiance 1 everywhere and nothing else; a bounce cap of 40, the bench's. The eye aimed at the disc or at the sky. */
const FPIX = 32
export const FCAM = { eye: [-4.4, 0.4], pixels: FPIX, fov: 40 * DEG }
export const furnaceOf = ({ dust = 1, disc = 1, g = 0.6 } = {}) => ({
    sky: 1, shapes: [{ kind: 'circle', c: [0, 0], r: 0.7, albedo: disc, name: 'disc' }],
    haze: { c: [0, 0], h: [1.6, 1.6], mfp: 1.5, albedo: dust, g },
})
const fcamOf = aim => ({ ...FCAM, dir: aim === 'sky' ? 118 * DEG : Math.atan2(-0.4, 4.4) })
function furnaceSample(world, s, R, rec) {
    const v = new Float64Array(FPIX), cam = fcamOf(s.aim)
    for (let i = 0; i < FPIX; i++) {
        const [ox, oy, dx, dy] = cameraRay(cam, i, R()), pr = rec && i % 5 === 1 ? [] : null
        v[i] = tracePath(world, ox, oy, dx, dy, { rand: R, maxBounce: 40, record: pr })
        if (pr) rec.push(pr)
    }
    return v
}
const furnaceWorld = s => furnaceOf({ dust: s.dust, disc: s.disc, g: s.g })
export function renderFurnace(o) {
    const s = { seed: 1, dust: 1, disc: 1, g: 0.6, aim: 'disc', max: 100, ...o, spp: 0, pix: Array.from({ length: FPIX }, moments), shown: [] }
    film(s, 1e9, furnaceWorld, furnaceSample)
    return s
}
/** the picture's mean over its pixels, and the spread of its pixels' samples (0: every sample of every pixel the same) */
export function furnaceRead(pix) {
    let m = 0, v = 0, spread = 0
    for (const p of pix) { m += p.Y; v += (standardError(p.V, p.S) ?? 0) ** 2; spread = Math.max(spread, Math.sqrt(Math.max(0, p.V))) }
    return { mean: m / pix.length, se: Math.sqrt(v) / pix.length, spread }
}

/* DRAWING */
function strip(pen, pix, n, x0, y0, x1, h, k, label, marks = []) {
    const px0 = pen.X(x0), w = pen.X(x1) - px0, top = pen.Y(y0), bot = top + pen.view.s * h, at = i => px0 + w * (i + 0.5) / n, { ctx } = pen
    pen.image(px0, top, w, pen.view.s * h, n, 1, i => { const v = k * pix[i].Y; return [v, v, v] })
    pen.labelPx(px0, top - 20, label, { role: 'soft', size: 11, base: 'bottom' })
    for (const q of [1, Math.round(n / 4), Math.round(n / 2), Math.round(3 * n / 4), n]) pen.labelPx(at(q - 1), bot + 3, String(q), { role: 'soft', size: 9, align: 'center', base: 'top' })
    // each mark a bracket and its words over the strip; one whose words would run into the last's goes under it instead,
    // beneath the pixel numbers, so a label always starts at its own bracket
    let lx = -Infinity
    for (const { idx, text, role } of marks) {
        if (!idx.length) continue
        const a = at(idx[0]) - w / n / 2, b = at(idx[idx.length - 1]) + w / n / 2, under = a < lx + 8
        const y = under ? bot + 1 : top - 1, sgn = under ? 1 : -1
        ctx.save(); ctx.strokeStyle = pen.col(role); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a, y + 2 * sgn); ctx.lineTo(a, y); ctx.lineTo(b, y); ctx.lineTo(b, y + 2 * sgn); ctx.stroke(); ctx.restore()
        if (under) pen.labelPx(a, bot + 15, text, { role, size: 11, base: 'top' })
        else { pen.labelPx(a, top - 6, text, { role, size: 11, base: 'bottom' }); ctx.save(); ctx.font = `500 11px ${pen.theme.fonts.hand}`; lx = a + ctx.measureText(text).width; ctx.restore() }
    }
    const hp = pen.hover({ x: px0, y: top, w, h: bot - top })
    if (hp) {
        const i = clamp(Math.floor((hp.x - px0) / w * n), 0, n - 1), se = standardError(pix[i].V, pix[i].S)
        ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.lineWidth = 1.5; ctx.strokeRect(px0 + w * i / n, top, w / n, bot - top); ctx.restore()
        pen.tip(hp.x, hp.y, [`pixel ${i + 1}`, se == null ? pix[i].Y.toFixed(4) : `${pix[i].Y.toFixed(4)} ± ${se.toFixed(4)}`])
    }
}
/** the first sample's paths, each for its first three legs and their shadow rays (the rest is a tangle) */
function drawPaths(pen, recs) {
    for (const rec of recs) {
        let legs = 0
        for (const seg of rec) {
            if ((seg.kind === 'eye' || seg.kind === 'bounce') && ++legs > 3) break
            pen.ray(seg.a, seg.b, { role: seg.kind === 'shadow' ? 'shadow' : seg.kind === 'blocked' ? 'blocked' : 'cam', w: 0.8, alpha: 0.55, arrow: false, exact: true })
            if (seg.dust) pen.dot(seg.b, { role: 'accent', r: 2.2 })
        }
    }
}
const dustBox = (pen, hz, x0, y0, x1, y1) => pen.shape([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { role: 'soft', fill: 'soft', gap: 9, w: 0.8, dash: [4, 3] })

export const figures = {
    free: {
        aspect: 1.24,
        world: { x: [-3.4, 3.4], y: [-3.6, 1.9] },
        state: { mfp: 4, seed: 1, one: false },
        controls: [
            { type: 'slider', key: 'mfp', label: 'mean free path', min: 0.25, max: 8, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'button', label: 'Draw again', act: s => { s.seed++ } },
            { type: 'toggle', key: 'one', label: 'One ray\'s march' },
        ],
        steps: { thin: { mfp: 4, seed: 1, one: false }, thick: { mfp: 0.7, seed: 1, one: false }, march: { mfp: 2, seed: 25, one: true } },
        draw(pen, s) {
            const { W, H } = pen.view
            dustBox(pen, null, -2, -1, 2, 1)
            pen.label([-1.95, 1.18], `dust, mean free path ${s.mfp.toFixed(2)}`, { role: 'soft', size: 12 })
            if (s.one) {
                for (const sh of MARCH_WORLD.shapes) pen.flat(sh, { role: 'solid' })
                const m = marchOne(s.mfp, rng(s.seed)()), dx = Math.cos(m.a), dy = Math.sin(m.a)
                let t = 0
                for (let k = 0; k < m.steps.length && k <= m.k; k++) {
                    const st = m.steps[k], r = Math.abs(st.d)
                    pen.circle([st.x, st.y], r, { role: 'soft', w: 0.8, exact: true })
                    pen.dot([st.x, st.y], { role: 'cam', r: 2 })
                    t += r * 0.9
                }
                const end = m.c ? [m.x0 + dx * t, m.y0 + dy * t] : m.hit ?? [m.x0 + dx * 12, m.y0 + dy * 12]
                // the leg in blue up to the step that passed the particle, that step in red, the particle where it moved back to
                const t0 = m.c ? t - Math.abs(m.steps[m.k].d) * 0.9 : 0, from = [m.x0 + dx * t0, m.y0 + dy * t0]
                pen.ray([m.x0, m.y0], m.c ? from : end, { role: 'cam', w: 1.6, exact: true, arrow: !m.c })
                if (m.c) {
                    pen.ray(from, end, { role: 'blocked', w: 2, exact: true })
                    pen.dot([m.c.x, m.c.y], { role: 'accent', r: 4 })
                    pen.label([m.c.x, m.c.y + 0.32], 'the particle: the ray moved back to here', { role: 'accent', size: 11, align: 'center' })
                }
                pen.labelPx(W * 0.03, H * 0.8, m.c ? `drawn as the leg starts: ${m.c.t.toFixed(2)} along it; the march stopped after ${m.k + 1} steps` : 'no particle on this leg: it ends where the march ends it', { role: 'soft', size: 12 })
                return
            }
            const R = rng(s.seed), a = -6 * DEG
            for (let k = 0; k < SHEET; k++) {
                const y = 1.25 - k * 2.3 / (SHEET - 1), x = -3.2, c = collide(s.mfp, x, y, a, R())
                const end = c ? [c.x, c.y] : [x + Math.cos(a) * 6.4, y + Math.sin(a) * 6.4]
                pen.ray([x, y], end, { role: 'light', w: 1, alpha: 0.8, arrow: !c, exact: true })
                if (c) pen.dot(end, { role: 'accent', r: 3 })
            }
            // the distances, many crossings, against the exponential
            const hst = histogram(s.mfp, s.seed + 100), sig = 1 / s.mfp, rect = { x: W * 0.12, y: H * 0.7, w: W * 0.82, h: H * 0.19 }
            const expect = hst.bins.map((_, i) => DRAWS * (Math.exp(-sig * i * 0.25) - Math.exp(-sig * (i + 1) * 0.25)))
            plot(pen, rect, {
                x: [0, 4], y: [0, Math.max(...hst.bins, ...expect) * 1.1], xticks: [0, 1, 2, 3, 4], fmt: v => String(Math.round(v)),
                hoverX: v => `${v.toFixed(2)} into the box`, hoverY: v => v.toFixed(0),
                series: [
                    { name: 'drawn', kind: 'bars', role: 'accent', pts: hst.bins.map((b, i) => [(i + 0.5) * 0.25, b]) },
                    { name: 'expected', role: 'ink', w: 1.2, pts: expect.map((e, i) => [(i + 0.5) * 0.25, e]) },
                ],
            })
            pen.labelPx(rect.x, rect.y - 16, `where ${DRAWS} straight crossings met a particle`, { role: 'soft', size: 11 })
            pen.labelPx(rect.x, rect.y + rect.h + 20, `passed through: ${hst.passed} (e^(−4/mfp) says ${(DRAWS * Math.exp(-4 * sig)).toFixed(0)})`, { role: 'soft', size: 11, base: 'top' })
        },
        readout(s) {
            if (s.one) { const m = marchOne(s.mfp, rng(s.seed)()); return m.c ? `the particle ${m.c.t.toFixed(2)} along the leg, which enters the dust ${hazeSpan2(FREE_BOX, m.x0, m.y0, Math.cos(m.a), Math.sin(m.a), 12)[0].toFixed(2)} along it` : 'this leg crosses the dust without meeting a particle' }
            const h = histogram(s.mfp, s.seed + 100)
            return `mean free path ${s.mfp.toFixed(2)} · of ${DRAWS} crossings 4 long, ${h.passed} passed (${(100 * h.passed / DRAWS).toFixed(1)}%; e^(−4/${s.mfp.toFixed(2)}) = ${(100 * Math.exp(-4 / s.mfp)).toFixed(1)}%)`
        },
    },

    phase: {
        aspect: 1.9,
        world: { x: [-2.4, 2.4], y: [-1.3, 1.3] },
        state: { g: 0.7, seed: 1, flat: false },
        controls: [
            { type: 'slider', key: 'g', label: 'asymmetry g', min: -0.95, max: 0.95, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'button', label: 'Draw again', act: s => { s.seed++ } },
            { type: 'toggle', key: 'flat', label: 'The flat world\'s too' },
        ],
        steps: { even: { g: 0, seed: 1, flat: false }, forward: { g: 0.7, seed: 1, flat: false }, back: { g: -0.5, seed: 1, flat: false } },
        draw(pen, s) {
            const { W, H } = pen.view, cx = -1.2, R0 = 0.95, pd = phaseDraws(s.g, s.seed)
            // the lobe: p(theta) round the point, scaled to its largest value
            const N = 240, pmax = Math.max(hgEvalJS(1, s.g), hgEvalJS(-1, s.g)), lobe = []
            for (let i = 0; i <= N; i++) { const th = i / N * 2 * Math.PI, r = R0 * hgEvalJS(Math.cos(th), s.g) / pmax; lobe.push([cx + r * Math.cos(th), r * Math.sin(th)]) }
            pen.shape(lobe, { role: 'accent', w: 1.6 })
            if (s.flat) {
                const fmax = Math.max(phase2(1, s.g), phase2(-1, s.g)), fl = []
                for (let i = 0; i <= N; i++) { const th = i / N * 2 * Math.PI, r = R0 * phase2(Math.cos(th), s.g) / fmax; fl.push([cx + r * Math.cos(th), r * Math.sin(th)]) }
                pen.shape(fl, { role: 'glass', w: 1.2, dash: [4, 3] })
            }
            pen.ray([cx - 1.1, 0], [cx, 0], { role: 'light', w: 1.6 })
            pen.dot([cx, 0], { role: 'ink', r: 3 })
            for (const p of pd.pts) pen.dot([cx + (R0 + 0.12) * Math.cos(p.th), p.side * (R0 + 0.12) * Math.sin(p.th)], { role: 'cam', r: 1.4 })
            pen.label([cx - 1.1, 0.16], 'light arriving', { role: 'light', size: 11 })
            // the angle's histogram against its density
            const rect = { x: W * 0.56, y: H * 0.12, w: W * 0.4, h: H * 0.62 }, bw = Math.PI / PH_BINS
            const dens = Array.from({ length: 91 }, (_, i) => { const th = i / 90 * Math.PI; return [th / DEG, 2 * Math.PI * Math.sin(th) * hgEvalJS(Math.cos(th), s.g) * PH_N * bw] })
            const top = Math.max(...pd.bins, ...dens.map(d => d[1])) * 1.1
            plot(pen, rect, {
                x: [0, 180], y: [0, top], xticks: [0, 45, 90, 135, 180], fmt: v => String(Math.round(v)),
                hoverX: v => `${v.toFixed(0)}° from straight on`, hoverY: v => v.toFixed(0),
                series: [
                    { name: 'drawn', kind: 'bars', role: 'cam', pts: pd.bins.map((b, i) => [(i + 0.5) * 180 / PH_BINS, b]) },
                    { name: 'expected', role: 'ink', w: 1.2, pts: dens },
                ],
            })
            pen.labelPx(rect.x, rect.y - 16, `the angle of ${PH_N} directions drawn, in degrees`, { role: 'soft', size: 11 })
        },
        readout(s) {
            const pd = phaseDraws(s.g, s.seed)
            return `g = ${s.g.toFixed(2)} · over the sphere p adds to ${sphereIntegral(s.g).toFixed(4)} · the drawn directions' mean cosine ${pd.mean.toFixed(3)} (g)`
        },
    },

    beam: {
        aspect: 1.78,
        world: { x: [-5.6, 7.6], y: [-2.66, 4.75] },
        state: { mode: 'aim', mfp: 6, g: 0.7, seed: 1, spp: 0, max: 300 },
        controls: [
            { type: 'seg', key: 'mode', options: MODES },
            { type: 'slider', key: 'mfp', label: 'mean free path', min: 0.5, max: 12, step: 0.1, fmt: v => v.toFixed(1), when: s => s.mode !== 'clear' },
            { type: 'slider', key: 'g', label: 'asymmetry g', min: -0.9, max: 0.95, step: 0.01, fmt: v => v.toFixed(2), when: s => s.mode !== 'clear' },
        ],
        steps: { clear: { mode: 'clear', mfp: 6, g: 0.7 }, phase: { mode: 'phase', mfp: 6, g: 0.7 }, aim: { mode: 'aim', mfp: 6, g: 0.7 }, back: { mode: 'aim', mfp: 6, g: -0.5 }, thick: { mode: 'aim', mfp: 1, g: 0.7 } },
        work: {
            reset(s) { s.spp = 0; s.pix = Array.from({ length: PIX }, moments); s.shown = [] },
            add(s, ms) { return film(s, ms, roomWorld, roomSampler) },
        },
        draw(pen, s) {
            const world = roomWorld(s)
            if (world.haze) dustBox(pen, world.haze, -5, 0, 5, ROOF_Y)
            // the beam's edges, where the sun reaches through the window (the upper from the window's top at the outer
            // face, the lower from its foot at the inner)
            const tn = Math.tan(SUN_EL)
            pen.line([WALL_X + 0.4, WINDOW[1]], [WALL_X + 0.4 - WINDOW[1] / tn, 0], { role: 'light', w: 1, dash: [5, 4], exact: true })
            pen.line([WALL_X, WINDOW[0]], [WALL_X - WINDOW[0] / tn, 0], { role: 'light', w: 1, dash: [5, 4], exact: true })
            for (const sh of world.shapes) pen.flat(sh, { role: 'solid' })
            for (let k = -1; k <= 1; k++) { const y0 = 2.2 + k * 0.35, x = 5.5 + 1.0, y = y0 + 1.0 * tn; pen.ray([x + 0.7 * Math.cos(SUN_EL), y + 0.7 * Math.sin(SUN_EL)], [x, y], { role: 'light', w: 1.2, exact: true }) }
            pen.label([5.5, 4.4], 'the sun, 35° up', { role: 'light', size: 12, align: 'right' })
            drawPaths(pen, s.shown)
            // most drawn shadow rays start outside the beam and meet a wall; one that starts in it, for the record, reaches
            // the sun through the window: a point 3 down the beam's middle line
            if (s.mode === 'aim') {
                const P = [WALL_X + 0.2 - 3 * Math.cos(SUN_EL), 2.2 - 3 * Math.sin(SUN_EL)]
                pen.ray(P, [P[0] + 3.7 * Math.cos(SUN_EL), P[1] + 3.7 * Math.sin(SUN_EL)], { role: 'shadow', w: 1.6, exact: true })
                pen.dot(P, { role: 'accent', r: 3.5 })
                pen.label([P[0] - 0.15, P[1] + 0.05], 'from dust in the beam, a shadow ray reaches the sun', { role: 'shadow', size: 10, align: 'right' })
            }
            pen.eye(CAM.eye, CAM.dir, { size: 18 })
            strip(pen, s.pix, PIX, -5.2, -1.3, 7.2, 0.45, 20, 'the eye\'s picture, brightened 20 times: pixel 1 the top of its view, 48 the bottom',
                [{ idx: patchPixels, text: 'the lit floor', role: 'light' }, { idx: beamPixels, text: 'across the beam', role: 'accent' }])
        },
        readout(s) {
            const b = regionOf(s.pix, beamPixels), p = regionOf(s.pix, patchPixels)
            return `${MODES.find(m => m[0] === s.mode)[1]}${s.mode === 'clear' ? '' : ` (mean free path ${s.mfp.toFixed(1)}, g ${s.g.toFixed(2)})`} · ${s.spp} samples · across the beam ${b.mean.toFixed(4)} ± ${b.se.toFixed(4)} · the lit floor ${p.mean.toFixed(4)} ± ${p.se.toFixed(4)}`
        },
    },

    furnace: {
        aspect: 1.6,
        world: { x: [-5, 3.4], y: [-2.9, 2.4] },
        state: { dust: 1, disc: 1, g: 0.6, aim: 'disc', seed: 1, spp: 0, max: 200 },
        controls: [
            { type: 'seg', key: 'aim', options: [['disc', 'Eye on the disc'], ['sky', 'Eye on the sky']] },
            { type: 'slider', key: 'dust', label: 'the dust\'s albedo', min: 0, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'disc', label: 'the disc\'s albedo', min: 0, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'g', label: 'asymmetry g', min: -0.9, max: 0.95, step: 0.05, fmt: v => v.toFixed(2) },
        ],
        steps: {
            pass: { dust: 1, disc: 1, g: 0.6, aim: 'disc' }, black: { dust: 1, disc: 0, g: 0.6, aim: 'disc' },
            half: { dust: 0.5, disc: 1, g: 0.6, aim: 'disc' }, sky: { dust: 1, disc: 0, g: 0.6, aim: 'sky' },
        },
        work: {
            reset(s) { s.spp = 0; s.pix = Array.from({ length: FPIX }, moments); s.shown = [] },
            add(s, ms) { return film(s, ms, furnaceWorld, furnaceSample) },
        },
        draw(pen, s) {
            const world = furnaceWorld(s)
            dustBox(pen, world.haze, -1.6, -1.6, 1.6, 1.6)
            pen.flat(world.shapes[0], { role: s.disc > 0.5 ? 'solid' : 'blocked' })
            pen.label([-1.55, 1.85], `dust of albedo ${s.dust.toFixed(2)}, mean free path 1.5`, { role: 'soft', size: 12 })
            pen.label([0, 0], `albedo ${s.disc.toFixed(2)}`, { role: 'ink', size: 11, align: 'center' })
            pen.label([3.3, 2.2], 'the sky: 1 everywhere', { role: 'soft', size: 12, align: 'right' })
            drawPaths(pen, s.shown)
            const cam = fcamOf(s.aim)
            pen.eye(cam.eye, cam.dir, { size: 18 })
            strip(pen, s.pix, FPIX, -4.6, -2.25, 3.0, 0.4, 0.85, 'the eye\'s picture: white is 1')
        },
        readout(s) {
            const r = furnaceRead(s.pix)
            return `${s.spp} samples · the picture reads ${r.mean.toFixed(4)} ± ${r.se.toFixed(4)} · the largest spread of a pixel's samples ${r.spread.toFixed(4)}${r.spread === 0 && s.spp > 1 ? ': not one sample differs from another' : ''}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
