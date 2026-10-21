//======================================================================================================================
// CHAPTER "Two ways to the light": its figures.
//
//   plates   Veach's plates, flat: four glossy plates, sharp to rough, under four lamps, small to large, each giving the
//            same light; every plate point's direct light estimated three ways from the same random numbers -- by
//            picking a point on a lamp (light sampling), by picking a direction from the plate's lobe (BSDF sampling),
//            and both, weighed by the power heuristic (MIS) -- each pixel's average and error bar kept by measure.js
//   weights  one plate point: the two strategies' densities over every direction, and the weights MIS gives each
//
// The plates are a lobe about the mirror direction: f cos = rho g(delta), g a normal density of width sigma in the angle
// delta from the mirror direction, so a direction drawn from g weighs rho exactly. Nothing is in the way between a plate
// and a lamp, so no ray is marched: a direction's lamp is found by meeting the lamps' height.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { rng } from '../kit/flatland.js'
import { plot } from '../kit/plot.js'
import { stepMoments, standardError } from '../../lib/pathtracer/core/measure.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
/** tracebasics.js misWeight: the power heuristic, beta = 2 */
export const misWeight = (pThis, pOther) => { const a = pThis * pThis, b = pOther * pOther; return a / Math.max(a + b, 1e-20) }

export const CAM = [-1.5, 4.0], H = 1.2, RHO = 0.9
export const SIGMAS = [0.02, 0.08, 0.25, 0.6]
// four lamps along y = H, facing down, each as long as LEN[k] and as bright as 0.4 / LEN[k]: the same light from each.
// Their centres put each one's mirror image where the camera sees the plate at x = 1.5, 3.3, 5.1 and 6.9.
export const LAMPS = [1.5, 3.3, 5.1, 6.9].map((xm, k) => {
    const len = [0.08, 0.3, 0.8, 1.6][k]
    return { c: CAM[0] + (xm - CAM[0]) * (CAM[1] + H) / CAM[1], len, Le: 0.4 / len }
})
const PIXN = 72, X0 = 0.2, X1 = 8.6
const pixelX = i => X0 + (X1 - X0) * (i + 0.5) / PIXN

const gauss = (d, s) => Math.exp(-d * d / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI))
/** the mirror direction at plate point x, as an angle from straight up (positive towards +x) */
export const mirrorAngle = x => -Math.atan2(CAM[0] - x, CAM[1])
/** the plate's lobe: f cos for light arriving from angle t, and the density of drawing t from it (the same g) */
export const lobe = (x, t, s) => RHO * gauss(t - mirrorAngle(x), s)
export const lobePdf = (x, t, s) => Math.abs(t) < Math.PI / 2 ? gauss(t - mirrorAngle(x), s) : 0
/** which lamp a direction from x meets, if any: { k, r } */
export function lampAlong(x, t) {
    if (!(Math.abs(t) < Math.PI / 2)) return null
    const X = x + H * Math.tan(t)
    for (let k = 0; k < LAMPS.length; k++) if (Math.abs(X - LAMPS[k].c) <= LAMPS[k].len / 2) return { k, r: Math.hypot(X - x, H) }
    return null
}
/** light sampling's density per radian for a direction that meets lamp k at distance r: a lamp picked from four, a
 *  point on it uniformly, turned into an angle as seen from the plate: r / (len cos) with cos = H / r */
export const lightPdf = (k, r) => r * r / (LAMPS.length * LAMPS[k].len * H)

/** one sample at plate point x of roughness s: the three estimates from the same four random numbers */
export function estimates(x, s, R) {
    // light sampling: a lamp, a point on it
    const k = Math.min(LAMPS.length - 1, Math.floor(R() * LAMPS.length)), L = LAMPS[k]
    const px = L.c + (R() - 0.5) * L.len, t = Math.atan2(px - x, H), r = Math.hypot(px - x, H)
    const pl = lightPdf(k, r), pb = lobePdf(x, t, s)
    const fromLight = lobe(x, t, s) * L.Le / pl
    // BSDF sampling: an angle from the lobe (Box-Muller), the lamp it meets if any
    const u1 = Math.max(R(), 1e-12), u2 = R(), tb = mirrorAngle(x) + s * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    const hit = lampAlong(x, tb)
    const fromLobe = hit ? RHO * LAMPS[hit.k].Le : 0
    const mis = fromLight * misWeight(pl, pb) + (hit ? fromLobe * misWeight(lobePdf(x, tb, s), lightPdf(hit.k, hit.r)) : 0)
    return [fromLight, fromLobe, mis]
}
/** the light at x, exactly: the lobe integrated over each lamp's angles (for the test and the readout's scale) */
export function exactAt(x, s, n = 4000) {
    let sum = 0
    for (const L of LAMPS) {
        const a = Math.atan2(L.c - L.len / 2 - x, H), b = Math.atan2(L.c + L.len / 2 - x, H)
        for (let i = 0; i < n; i++) { const t = a + (b - a) * (i + 0.5) / n; sum += lobe(x, t, s) * L.Le * (b - a) / n }
    }
    return sum
}

const film = () => Array.from({ length: 3 }, () => SIGMAS.map(() => Array.from({ length: PIXN }, () => ({ Y: 0, V: 0, S: 0, cnt: 0 }))))
const NAMES = ['the lamp strategy', 'the plate strategy', 'both, weighed (MIS)']
export const LAMP_NAMES = ['tiny', 'small', 'large', 'long']

export const figures = {
    plates: {
        aspect: 1.15,
        world: { x: [-2.1, 10.4], y: [-6.9, 4.5] },
        state: { seed: 1, spp: 0, max: 8 },
        controls: [
            { type: 'seg', key: 'max', label: 'samples a pixel', options: [[8, '8'], [64, '64'], [256, '256'], [1024, '1,024']] },
            { type: 'button', label: 'New random numbers', act: s => { s.seed++ } },
        ],
        steps: { few: { max: 8, seed: 1 }, many: { max: 256, seed: 1 } },
        work: {
            reset(s) { s.spp = 0; s.film = film() },
            add(s, ms) {
                const t0 = performance.now()
                do {
                    const R = rng(s.seed * 1000003 + s.spp * 7919)
                    SIGMAS.forEach((sg, p) => { for (let i = 0; i < PIXN; i++) { const e = estimates(pixelX(i), sg, R); for (let m = 0; m < 3; m++) s.film[m][p][i] = stepMoments(s.film[m][p][i], e[m]) } })
                    s.spp++
                } while (performance.now() - t0 < ms && s.spp < s.max)
                return s.spp < s.max
            },
        },
        draw(pen, s) {
            // THE SCENE: the plate, the lamps over it, the camera above
            pen.line([X0 - 0.1, 0], [X1 + 0.1, 0], { role: 'solid', w: 1.6, id: 'plate' })
            // the lamps face down: their ticks on the side they glow from
            for (const L of LAMPS) pen.bar([L.c - L.len / 2, H], [L.c + L.len / 2, H], { id: `lamp${L.len}`, both: false })
            LAMPS.forEach((L, k) => pen.label([L.c, H + 0.32], LAMP_NAMES[k], { role: 'soft', size: 12, align: 'center' }))
            pen.eye(CAM, Math.atan2(-CAM[1], 4 - CAM[0]), { size: 18 })
            // one mirror ray for each lamp: where on the plate the camera sees it reflected
            for (const L of LAMPS) { const xm = CAM[0] + (L.c - CAM[0]) * CAM[1] / (CAM[1] + H); pen.ray(CAM, [xm, 0], { role: 'faint', w: 0.7, arrow: false }); pen.ray([xm, 0], [L.c, H], { role: 'faint', w: 0.7, arrow: false }) }
            pen.label([4.2, -0.45], 'the plate: each strip below is it, left to right, a point of it a column', { role: 'soft', size: 13, align: 'center' })
            // THE FILMS: a strip a plate (rows: sharp to rough) for each strategy (columns)
            const { ctx } = pen, x0 = pen.X(-1.15), x1 = pen.X(10.3), gap = 10, cw = (x1 - x0 - 2 * gap) / 3, y0 = pen.Y(-1.3), rh = (pen.Y(-6.6) - y0) / SIGMAS.length
            const tone = v => Math.round(255 * Math.pow(1 - Math.exp(-Math.max(0, v) / 0.6), 1 / 1.6))
            for (let m = 0; m < 3; m++) {
                const cx = x0 + m * (cw + gap)
                pen.labelPx(cx, y0 - 18, NAMES[m], { role: 'ink', size: 13 })
                SIGMAS.forEach((sg, p) => {
                    const py = y0 + p * rh, pw = cw / PIXN
                    ctx.save()
                    for (let i = 0; i < PIXN; i++) { const g = tone(s.film[m][p][i].Y); ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(cx + i * pw, py + 2, pw + 0.5, rh - 8) }
                    ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.strokeRect(cx, py + 2, cw, rh - 8)
                    ctx.restore()
                })
            }
            // each row's roughness beside it, off the strips; σ in radians (and in degrees, as the second figure reads)
            SIGMAS.forEach((sg, p) => pen.labelPx(x0 - 4, y0 + p * rh + (rh - 8) / 2 - 6, `σ ${sg}`, { role: 'accent', size: 11, kind: 'mono', align: 'right' }))
            // THE POINTER on a strip: that point of the plate, its estimate and error bar, and the exact light there
            for (let m = 0; m < 3; m++) SIGMAS.forEach((sg, p) => {
                const cx = x0 + m * (cw + gap), py = y0 + p * rh, q = pen.hover({ x: cx, y: py + 2, w: cw, h: rh - 8 })
                if (!q) return
                const i = Math.min(PIXN - 1, Math.floor((q.x - cx) / (cw / PIXN))), px = s.film[m][p][i], x = pixelX(i)
                ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.lineWidth = 1.5; ctx.strokeRect(cx + i * cw / PIXN - 1, py + 1, cw / PIXN + 2, rh - 6); ctx.restore()
                pen.tip(q.x, q.y, [`${NAMES[m]}, σ ${sg} (${(sg * 180 / Math.PI).toFixed(1)}°), x ${x.toFixed(2)}`,
                    `${px.Y.toFixed(3)} ± ${(standardError(px.V, px.S) ?? 0).toFixed(3)} after ${px.cnt}`, `exact: ${exactAt(x, sg, 600).toFixed(3)}`])
            })
        },
        readout(s) {
            const rel = m => { let se = 0, y = 0; for (const row of s.film[m]) for (const px of row) { se += standardError(px.V, px.S) ?? 0; y += px.Y } return y > 0 ? se / y : 0 }
            return `${s.spp} sample${s.spp === 1 ? '' : 's'} a pixel · error bar, as a share of the light: lamps ${(100 * rel(0)).toFixed(0)}% · directions ${(100 * rel(1)).toFixed(0)}% · MIS ${(100 * rel(2)).toFixed(0)}%`
        },
    },

    weights: {
        aspect: 1.6,
        world: { x: [0, 10], y: [0, 6.2] },
        state: { plate: 2, x: 5.1 },
        controls: [
            { type: 'seg', key: 'plate', label: 'plate', options: SIGMAS.map((sg, p) => [p, `σ ${sg}`]) },
            { type: 'slider', key: 'x', label: 'point on the plate', min: 0.5, max: 8.5, step: 0.05, fmt: v => v.toFixed(2) },
        ],
        steps: { rough: { plate: 3, x: 1.5 }, sharp: { plate: 0, x: 6.9 } },
        draw(pen, s) {
            const sg = SIGMAS[s.plate], { W, H: HH } = pen.view, T = 80 * Math.PI / 180, N = 640
            const ts = Array.from({ length: N + 1 }, (_, i) => -T + 2 * T * i / N)
            const pl = t => { const h = lampAlong(s.x, t); return h ? lightPdf(h.k, h.r) : 0 }
            const lg = v => v > 0 ? Math.log10(v) : -3
            const top = { x: W * 0.1, y: HH * 0.08, w: W * 0.86, h: HH * 0.36 }, bot = { x: W * 0.1, y: HH * 0.56, w: W * 0.86, h: HH * 0.3 }
            const deg = t => t * 180 / Math.PI
            pen.labelPx(top.x - 34, top.y - 18, 'how likely each strategy is to pick each direction (per radian, log scale)', { role: 'soft', size: 13 })
            plot(pen, top, {
                x: [-80, 80], y: [-2, 2.2], yticks: [-2, -1, 0, 1, 2], xticks: [], fmt: v => String(+(10 ** v).toPrecision(1)),
                series: [
                    { name: 'lamps', pts: ts.map(t => [deg(t), Math.max(-2.5, lg(pl(t)))]), role: 'light', w: 1.6 },
                    { name: 'plate', pts: ts.map(t => [deg(t), Math.max(-2.5, lg(lobePdf(s.x, t, sg)))]), role: 'cam', w: 1.6 },
                ],
                hoverX: v => `${v.toFixed(0)}° from straight up`, hoverY: v => v <= -2.5 ? '0' : (10 ** v).toPrecision(2),
            })
            // each lamp's hump named, where it is seen from this point (a lamp past 80° is off the plot)
            LAMPS.forEach((L, k) => {
                const a = Math.atan2(L.c - s.x, H) * 180 / Math.PI
                if (Math.abs(a) > 78) return
                const xx = top.x + (a + 80) / 160 * top.w, yy = top.y + top.h - (lg(lightPdf(k, Math.hypot(L.c - s.x, H))) + 2) / 4.2 * top.h
                // staggered: two lamps seen close together (small and large, from the left) would write over each other
                pen.labelPx(xx, Math.max(top.y, yy - 16 - (k % 2) * 13), LAMP_NAMES[k], { role: 'light', size: 11, align: 'center' })
            })
            pen.labelPx(bot.x - 34, bot.y - 18, 'the weight MIS gives each', { role: 'soft', size: 13 })
            const { X } = plot(pen, bot, {
                // the x labels (degrees) are written below: plot's one format would give the y ticks degrees too
                x: [-80, 80], y: [0, 1.05], yticks: [0, 0.5, 1], xticks: [], fmt: v => String(v),
                series: [
                    { name: 'lamps', pts: ts.map(t => [deg(t), (pl(t) || lobePdf(s.x, t, sg)) ? misWeight(pl(t), lobePdf(s.x, t, sg)) : 0]), role: 'light', w: 1.6 },
                    { name: 'plate', pts: ts.map(t => [deg(t), (pl(t) || lobePdf(s.x, t, sg)) ? misWeight(lobePdf(s.x, t, sg), pl(t)) : 0]), role: 'cam', w: 1.6 },
                ],
                hoverX: v => `${v.toFixed(0)}° from straight up`, hoverY: v => v.toFixed(2),
            })
            for (const d of [-80, -40, 0, 40, 80]) pen.labelPx(X(d) - 12, bot.y + bot.h + 4, `${d}°`, { role: 'soft', size: 11, kind: 'mono' })
            // the directions where no lamp lies, shaded: no light arrives there, so their weights count nothing
            {
                const { ctx } = pen
                ctx.save(); ctx.fillStyle = pen.col('faint'); ctx.globalAlpha = 0.16
                let a = null
                ts.forEach((t, i) => {
                    const none = !pl(t), last = i === ts.length - 1
                    if (none && a === null) a = deg(t)
                    if (a !== null && (!none || last)) { ctx.fillRect(X(a), bot.y, X(deg(t)) - X(a), bot.h); a = null }
                })
                ctx.restore()
            }
            const { ctx } = pen, xm = X(deg(mirrorAngle(s.x)))
            ctx.save(); ctx.strokeStyle = pen.col('accent'); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(xm, top.y); ctx.lineTo(xm, bot.y + bot.h); ctx.stroke(); ctx.restore()
            pen.labelPx(xm + 4, top.y + top.h - 16, 'mirror direction', { role: 'accent', size: 12 })
            pen.labelPx(bot.x + 4, bot.y + bot.h + 22, `the direction, from straight up · the lamps: ${pen.say('light')} · the plate: ${pen.say('cam')}`, { role: 'soft', size: 12 })
        },
        readout(s) {
            const sg = SIGMAS[s.plate], t = mirrorAngle(s.x), h = lampAlong(s.x, t), pl = h ? lightPdf(h.k, h.r) : 0, pb = lobePdf(s.x, t, sg)
            return `plate σ ${sg} at x ${s.x.toFixed(2)} · in the mirror direction: ${h ? `the ${LAMP_NAMES[h.k]} lamp, its density ${pl.toFixed(2)}` : 'no lamp'}, the plate's ${pb.toFixed(2)} · weights ${misWeight(pl, pb).toFixed(2)} for the lamp, ${misWeight(pb, pl).toFixed(2)} for the plate`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
