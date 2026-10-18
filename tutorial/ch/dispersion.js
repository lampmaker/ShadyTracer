//======================================================================================================================
// CHAPTER "Rainbows": its figures.
//
//   prism  a beam of white light through a prism, each wavelength refracted at its own index -- core/spectral.js
//          cauchyN from the glass's n_d and Abbe number, optics/fresnel.js refract -- drawn in its own colour
//   index  n(lambda) of two catalogue glasses and of yours, Cauchy through n_d and V_d, with the three Fraunhofer lines a
//          catalogue gives them at, and BK7's catalogue n_F and n_C against the formula
//   draw   how the renderer gives a ray a wavelength: spectral.js specDraw, a 10 nm bin by the channels' summed weights,
//          and the weight each channel then carries -- which averages to exactly 1, so the colours add back to white
//   coat   a dichroic coating's reflectance over the wavelengths, its edge moving bluer as the light tilts (edgeAt), and
//          what each of the ray's three channels reflects (edgeRGB): no wavelength drawn at all
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { rng } from '../kit/flatland.js'
import { cmf, cauchyN, specDraw, edgeRGB, edgeAt, edgeScale, SPEC_PICK, SPEC_WEIGHTS, SPEC_LO, SPEC_STEP, SPEC_BINS, LAMBDA_D, LAMBDA_F, LAMBDA_C } from '../../lib/pathtracer/core/spectral.js'
import { XYZtoxy, rgbFromXy, gamutClip } from '../../lib/pathtracer/core/colorimetry.js'
import { refract } from '../../lib/pathtracer/optics/fresnel.js'

const DEG = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const srgb = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
/** a wavelength's colour on this screen, at full strength: its chromaticity (spectral.js cmf), clipped, brightest 1.
 *  Past 700 nm the colour of 700: the fit's tails part from the CIE's table there (its y-bar outlasts its x-bar, and its
 *  red response is 0 from 733 nm), which would paint the deepest reds yellow and then green; real ones all look the
 *  red of 700 (chapter 6's diagram stops its edge there for the same reason). */
export function waveColour(l) {
    const c = gamutClip(rgbFromXy(...XYZtoxy(cmf(Math.min(l, 700))))), m = Math.max(...c)
    return `rgb(${c.map(v => Math.round(255 * srgb(clamp(v / m, 0, 1)))).join(',')})`
}

/* THE PRISM: an equilateral triangle, side S, apex up, centred at the origin; a beam from the left onto its left face */
const S = 2.6, H = S * Math.sqrt(3) / 2
export const PRISM = [[-S / 2, -H / 3], [S / 2, -H / 3], [0, 2 * H / 3]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
/** where the ray p + t d leaves the triangle through an edge other than `skip`: { t, q, edge } */
function exitEdge(p, d, skip) {
    let best = null
    for (let k = 0; k < 3; k++) {
        if (k === skip) continue
        const A = PRISM[k], B = PRISM[(k + 1) % 3], e = sub(B, A), den = d[0] * e[1] - d[1] * e[0]
        if (Math.abs(den) < 1e-12) continue
        const w = sub(A, p), t = (w[0] * e[1] - w[1] * e[0]) / den, u = (w[0] * d[1] - w[1] * d[0]) / den
        if (t > 1e-9 && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, q: [p[0] + d[0] * t, p[1] + d[1] * t], edge: k }
    }
    return best
}
/** the outward normal of edge k */
const edgeNormal = k => { const A = PRISM[k], B = PRISM[(k + 1) % 3], e = sub(B, A), l = Math.hypot(...e), n = [e[1] / l, -e[0] / l], c = [0, 0]; return (n[0] * (A[0] - c[0]) + n[1] * (A[1] - c[1])) > 0 ? n : [-n[0], -n[1]] }
/** one wavelength through the prism: the beam at angle `tilt` (degrees, from horizontal, upward positive) aimed at the
 *  left face's middle; { inside: [a, b], out: { a, d } or null (totally reflected at the far face), angle: the leaving
 *  ray's direction in degrees below the horizontal } */
export function throughPrism(lambda, nd, vd, tilt) {
    const n = cauchyN(nd, vd, lambda), L = 2, Mid = [(PRISM[2][0] + PRISM[0][0]) / 2, (PRISM[2][1] + PRISM[0][1]) / 2]
    const d0 = [Math.cos(tilt * DEG), Math.sin(tilt * DEG)], src = [Mid[0] - d0[0] * L, Mid[1] - d0[1] * L]
    const nIn = edgeNormal(2), t = refract([d0[0], d0[1], 0], [nIn[0], nIn[1], 0], 1 / n)
    if (!t) return null
    const x = exitEdge(Mid, [t[0], t[1]], 2)
    if (!x) return null
    const nOut = edgeNormal(x.edge), o = refract([t[0], t[1], 0], [-nOut[0], -nOut[1], 0], n)
    return { n, src, hit: Mid, inside: [Mid, x.q], out: o ? { a: x.q, d: [o[0], o[1]] } : null, angle: o ? -Math.atan2(o[1], o[0]) / DEG : null }
}
const WAVES = Array.from({ length: 31 }, (_, k) => 400 + 10 * k)

export const figures = {
    prism: {
        aspect: 1.9,
        world: { x: [-3.4, 4.6], y: [-2.3, 1.95] },
        // each glass's beam at its angle of least deviation, where the light crosses the prism level: sin((60 + delta) / 2)
        // = n sin 30, the incidence (60 + delta) / 2 and the beam's tilt that less 30 degrees -- 31 for n 1.75, 19 for BK7
        state: { nd: 1.75, vd: 28, tilt: 31 },
        controls: [
            { type: 'slider', key: 'nd', label: 'index n_d', min: 1.4, max: 2, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'vd', label: 'Abbe number V_d', min: 0, max: 90, step: 1, fmt: v => v > 0 ? String(v) : '0: none' },
        ],
        steps: { flint: { nd: 1.75, vd: 28, tilt: 31 }, bk7: { nd: 1.5168, vd: 64.17, tilt: 19 }, none: { nd: 1.75, vd: 0, tilt: 31 } },
        drag: { tilt: (s, p) => { const m = [(PRISM[2][0] + PRISM[0][0]) / 2, (PRISM[2][1] + PRISM[0][1]) / 2]; s.tilt = Math.round(clamp(Math.atan2(m[1] - p[1], m[0] - p[0]) / DEG, -10, 50)) } },
        draw(pen, s) {
            pen.shape(PRISM, { role: 'glass', fill: 'fill', w: 1.6, id: 'prism' })
            const { ctx } = pen, line = (a, b, col, w, al = 1) => { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.globalAlpha = al; ctx.beginPath(); ctx.moveTo(pen.X(a[0]), pen.Y(a[1])); ctx.lineTo(pen.X(b[0]), pen.Y(b[1])); ctx.stroke(); ctx.restore() }
            const base = throughPrism(LAMBDA_D, s.nd, s.vd, s.tilt)
            if (base) pen.ray(base.src, base.hit, { role: 'ink', w: 2.4, id: 'white' })
            for (const l of WAVES) {
                const r = throughPrism(l, s.nd, s.vd, s.tilt)
                if (!r) continue
                line(r.inside[0], r.inside[1], waveColour(l), 1.2, 0.8)
                if (r.out) line(r.out.a, [r.out.a[0] + r.out.d[0] * 5, r.out.a[1] + r.out.d[1] * 5], waveColour(l), 1.6)
            }
            if (base) pen.handle('tilt', base.src, { role: 'ink', label: 'white light' })
        },
        readout(s) {
            const at = l => throughPrism(l, s.nd, s.vd, s.tilt), F = at(LAMBDA_F), D = at(LAMBDA_D), C = at(LAMBDA_C)
            if (!F?.out || !D?.out || !C?.out) return 'at this angle some of the light is totally reflected at the far face: tilt the beam'
            return `index at F (486 nm) ${F.n.toFixed(4)}, d (588) ${D.n.toFixed(4)}, C (656) ${C.n.toFixed(4)} · leaving ${F.angle.toFixed(2)}°, ${D.angle.toFixed(2)}° and ${C.angle.toFixed(2)}° below the horizontal: blue bent ${(F.angle - C.angle).toFixed(2)}° more than red`
        },
    },

    index: {
        aspect: 1.9,
        world: { x: [0, 1], y: [0, 1] },
        state: { nd: 1.75, vd: 28 },
        controls: [
            { type: 'slider', key: 'nd', label: 'your glass, n_d', min: 1.4, max: 2, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'vd', label: 'V_d', min: 15, max: 90, step: 1, fmt: v => String(v) },
        ],
        steps: { glasses: { nd: 1.75, vd: 28 } },
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.1, y: H * 0.08, w: W * 0.86, h: H * 0.72 }, ls = Array.from({ length: 81 }, (_, k) => 380 + 5 * k)
            const lo = Math.min(1.5, cauchyN(s.nd, s.vd, 780)) - 0.01, hi = Math.max(1.53, cauchyN(s.nd, s.vd, 380)) + 0.01
            const { X } = plot(pen, rect, {
                x: [380, 780], y: [lo, hi], xticks: [400, 500, 600, 700], fmt: v => v > 100 ? `${v}` : v.toFixed(2),
                hoverX: v => `${v.toFixed(0)} nm`, hoverY: v => `n = ${v.toFixed(4)}`,
                series: [
                    { name: 'BK7 (1.5168, 64.17)', pts: ls.map(l => [l, cauchyN(1.5168, 64.17, l)]), role: 'cam', w: 1.6 },
                    { name: `yours (${s.nd.toFixed(2)}, ${s.vd})`, pts: ls.map(l => [l, cauchyN(s.nd, s.vd, l)]), role: 'accent', w: 1.8 },
                    { name: 'BK7\'s catalogue', pts: [[LAMBDA_F, 1.52238], [LAMBDA_D, 1.5168], [LAMBDA_C, 1.51432]], role: 'ink', kind: 'dots', r: 4, ring: true },
                ],
            })
            const { ctx } = pen
            for (const [l, name] of [[LAMBDA_F, 'F'], [LAMBDA_D, 'd'], [LAMBDA_C, 'C']]) {
                ctx.save(); ctx.strokeStyle = waveColour(l); ctx.lineWidth = 2; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(X(l), rect.y); ctx.lineTo(X(l), rect.y + rect.h); ctx.stroke(); ctx.restore()
                pen.labelPx(X(l) + 3, rect.y + 3, name, { role: 'soft', size: 12 })
            }
            pen.labelPx(rect.x, rect.y + rect.h + 22, 'wavelength, nm', { role: 'soft', size: 12 })
        },
        readout(s) {
            const f = cauchyN(1.5168, 64.17, LAMBDA_F), c = cauchyN(1.5168, 64.17, LAMBDA_C)
            return `BK7 by the formula: n_F ${f.toFixed(5)}, n_C ${c.toFixed(5)}, against its catalogue's 1.52238 and 1.51432 (${(f - 1.52238).toExponential(1)}, ${(c - 1.51432).toExponential(1)}) · yours from 380 to 780 nm: ${cauchyN(s.nd, s.vd, 380).toFixed(4)} to ${cauchyN(s.nd, s.vd, 780).toFixed(4)}`
        },
    },

    draw: {
        aspect: 1.9,
        world: { x: [0, 1], y: [0, 1] },
        state: { n: 0, seed: 1 },
        controls: [
            { type: 'button', label: 'Draw 100', act: s => { s.n += 100 } },
            { type: 'button', label: 'Draw 10,000', act: s => { s.n += 10000 } },
            { type: 'button', label: 'Start again', act: s => { s.n = 0; s.seed++ } },
        ],
        steps: { bins: { n: 0, seed: 1 }, many: { n: 20000, seed: 1 } },
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.08, y: H * 0.08, w: W * 0.6, h: H * 0.7 }, { ctx } = pen
            const mid = k => SPEC_LO + (k + 0.5) * SPEC_STEP, top = Math.max(...SPEC_PICK) * 1.1
            plot(pen, rect, {
                x: [SPEC_LO, SPEC_LO + SPEC_BINS * SPEC_STEP], y: [0, top], xticks: [400, 500, 600, 700], yticks: [], fmt: v => `${v}`,
                hoverX: v => { const k = clamp(Math.floor((v - SPEC_LO) / SPEC_STEP), 0, SPEC_BINS - 1), p = SPEC_PICK[k], w = SPEC_WEIGHTS[k].map(x => p > 0 ? x / p : 0); return `${SPEC_LO + k * SPEC_STEP}-${SPEC_LO + (k + 1) * SPEC_STEP} nm: drawn ${(100 * p).toFixed(2)}% of the time; weights R ${w[0].toFixed(2)}, G ${w[1].toFixed(2)}, B ${w[2].toFixed(2)}` },
                hoverY: () => '', series: [{ name: 'chance', pts: SPEC_PICK.map((p, k) => [mid(k), p]), role: 'soft', kind: 'bars', tip: false }],
            })
            // each bin's bar in its own colour, under the plot's grey
            const X = v => rect.x + (v - SPEC_LO) / (SPEC_BINS * SPEC_STEP) * rect.w, Yp = v => rect.y + rect.h - v / top * rect.h, bw = rect.w / SPEC_BINS * 0.8
            SPEC_PICK.forEach((p, k) => { ctx.save(); ctx.fillStyle = waveColour(mid(k)); ctx.globalAlpha = 0.8; ctx.fillRect(X(mid(k)) - bw / 2, Yp(p), bw, rect.y + rect.h - Yp(p)); ctx.restore() })
            pen.labelPx(rect.x - 20, rect.y - 18, 'the chance of each 10 nm bin being drawn (point at a bin for its weights)', { role: 'soft', size: 12 })
            // the running average of the three weights over the draws so far: towards 1 each
            const R = rng(s.seed * 7919 + 1), acc = [0, 0, 0]
            for (let i = 0; i < s.n; i++) { const d = specDraw(R()); for (let c = 0; c < 3; c++) acc[c] += d.w[c] }
            const avg = acc.map(v => s.n ? v / s.n : 0), bx = W * 0.73, bwid = W * 0.055, h = H * 0.55, y0 = H * 0.78, roles = ['blocked', 'shadow', 'cam']
            pen.labelPx(bx - 6, H * 0.04, 'the weights\' average,', { role: 'soft', size: 11 })
            pen.labelPx(bx - 6, H * 0.04 + 14, `${s.n.toLocaleString('en')} draws`, { role: 'soft', size: 11 })
            ctx.save(); ctx.strokeStyle = pen.col('ink'); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(bx - 8, y0 - h / 1.5); ctx.lineTo(bx + 3 * bwid * 1.4, y0 - h / 1.5); ctx.stroke(); ctx.restore()
            pen.labelPx(bx + 3 * bwid * 1.4 + 3, y0 - h / 1.5 - 7, '1', { role: 'ink', size: 12 })
            avg.forEach((v, c) => {
                const x = bx + c * bwid * 1.4, hh = Math.min(v, 1.45) / 1.5 * h
                ctx.save(); ctx.fillStyle = pen.col(roles[c]); ctx.globalAlpha = 0.75; ctx.fillRect(x, y0 - hh, bwid, hh); ctx.restore()
                pen.labelPx(x + bwid / 2, y0 + 4, ['R', 'G', 'B'][c], { role: 'soft', size: 12, align: 'center' })
                pen.labelPx(x + bwid / 2, y0 - hh - 16, v.toFixed(3), { role: roles[c], size: 11, align: 'center' })
            })
        },
        readout(s) {
            const R = rng(s.seed * 7919 + 1), acc = [0, 0, 0]
            for (let i = 0; i < s.n; i++) { const d = specDraw(R()); for (let c = 0; c < 3; c++) acc[c] += d.w[c] }
            const exact = [0, 1, 2].map(c => SPEC_PICK.reduce((a, p, k) => a + (p > 0 ? p * SPEC_WEIGHTS[k][c] / p : 0), 0))
            return s.n ? `${s.n.toLocaleString('en')} wavelengths drawn: the weights average R ${(acc[0] / s.n).toFixed(3)}, G ${(acc[1] / s.n).toFixed(3)}, B ${(acc[2] / s.n).toFixed(3)} · exactly, over the draw: ${exact.map(v => v.toFixed(6)).join(', ')}`
                : `no wavelengths drawn yet · exactly, over the draw, each channel's weight averages ${exact.map(v => v.toFixed(6)).join(', ')}`
        },
    },
}

/* THE COATING: reflecting above `edge` nm (lo 0, hi 1), its 10-90 % width `width`, on glass whose layers average index
   N_EFF; the light at `tilt` degrees in air */
const N_EFF = 1.8
export const coatEdge = (edge, tilt) => edgeAt(edge, Math.sin(tilt * DEG), N_EFF)
export const coatR = (lambda, edge, width) => 1 / (1 + Math.exp(-(lambda - edge) / edgeScale(width)))

figures.coat = {
    aspect: 1.9,
    world: { x: [0, 1], y: [0, 1] },
    state: { edge: 600, width: 20, tilt: 0 },
    controls: [
        { type: 'slider', key: 'edge', label: 'edge, straight on', min: 420, max: 700, step: 5, fmt: v => `${v} nm` },
        { type: 'slider', key: 'width', label: 'its width', min: 1, max: 120, step: 1, fmt: v => `${v} nm` },
        { type: 'slider', key: 'tilt', label: 'light tilted', min: 0, max: 80, step: 1, fmt: v => `${v}°` },
    ],
    steps: { straight: { edge: 600, width: 20, tilt: 0 }, tilted: { edge: 600, width: 20, tilt: 45 } },
    draw(pen, s) {
        const { W, H } = pen.view, rect = { x: W * 0.08, y: H * 0.1, w: W * 0.6, h: H * 0.66 }, e = coatEdge(s.edge, s.tilt), ls = Array.from({ length: 401 }, (_, k) => 380 + k)
        const { X } = plot(pen, rect, {
            x: [380, 780], y: [0, 1.05], xticks: [400, 500, 600, 700], yticks: [0, 0.5, 1], fmt: v => v > 2 ? `${v}` : v.toFixed(1),
            hoverX: v => `${v.toFixed(0)} nm`, hoverY: v => `reflects ${(100 * v).toFixed(1)}%`,
            series: [{ name: 'reflected', pts: ls.map(l => [l, coatR(l, e, s.width)]), role: 'accent', w: 2 }],
        })
        const { ctx } = pen
        // the wavelengths' colours, under the axis's numbers
        for (let l = 380; l < 780; l += 4) { ctx.fillStyle = waveColour(l + 2); ctx.fillRect(X(l), rect.y + rect.h + 20, X(l + 4) - X(l) + 0.5, 7) }
        pen.labelPx(rect.x, rect.y - 18, `the coating's reflectance; its edge at ${e.toFixed(1)} nm for light ${s.tilt}° from the normal`, { role: 'soft', size: 12 })
        // what each channel reflects: the reflectance averaged over that channel's wavelengths
        const R = edgeRGB(0, 1, e, s.width), bx = W * 0.76, bw = W * 0.055, y0 = H * 0.76, h = H * 0.6, roles = ['blocked', 'shadow', 'cam']
        pen.labelPx(bx - 8, H * 0.08, 'each channel reflects', { role: 'soft', size: 11 })
        R.forEach((v, c) => {
            const x = bx + c * bw * 1.45
            ctx.save(); ctx.fillStyle = pen.col(roles[c]); ctx.globalAlpha = 0.75; ctx.fillRect(x, y0 - v * h, bw, v * h); ctx.restore()
            pen.labelPx(x + bw / 2, y0 + 4, ['R', 'G', 'B'][c], { role: 'soft', size: 12, align: 'center' })
            pen.labelPx(x + bw / 2, y0 - v * h - 16, v.toFixed(3), { role: roles[c], size: 11, align: 'center' })
        })
    },
    readout(s) {
        const e = coatEdge(s.edge, s.tilt), R = edgeRGB(0, 1, e, s.width)
        return `the edge at ${e.toFixed(1)} nm (${s.edge} nm straight on, × √(1 − (sin ${s.tilt}° / ${N_EFF})²)) · reflected R ${R[0].toFixed(3)}, G ${R[1].toFixed(3)}, B ${R[2].toFixed(3)}; passed the rest`
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
