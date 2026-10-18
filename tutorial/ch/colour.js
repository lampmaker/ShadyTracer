//======================================================================================================================
// CHAPTER "Colour": its figures.
//
//   match  a light's spectrum against the eye's three colour-matching functions (spectral.js cmf, the CIE 1931 fit the
//          renderer's coatings and prisms use): a narrow band you slide along the wavelengths, or a hot body at a
//          temperature, its X, Y, Z, its chromaticity, and its exact Rec.709 RGB (colorimetry.js), a channel negative
//          where a screen cannot show it
//   xy     the chromaticity diagram: every pure wavelength's colour round its edge, the screen's triangle, the hot
//          bodies' line (colorimetry.js planckXy) and a point you drag: its CCT and Duv (xyToCctDuv), its exact RGB and
//          what the display shows (gamutClip)
//   mix    three LEDs mixed to a colour: colorimetry.js mixToTarget's one 3 x 3 solve, the LEDs draggable, the target by
//          its temperature and Duv; outside the LEDs' triangle a flux would have to be negative
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { cmf } from '../../lib/pathtracer/core/spectral.js'
import { rgbToXYZ, XYZtoxy, rgbFromXy, gamutClip, planckXy, cctDuvToXy, xyToCctDuv, mixToTarget, xyToXYZ, xyToUpVp } from '../../lib/pathtracer/core/colorimetry.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const f3 = v => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(3)
// a signed number to four places: a value that rounds to 0 is +0.0000, never −0.0000
const sgn = v => { const r = Math.round(v * 1e4) / 1e4 || 0; return (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(4) }

/* A COLOUR ON THIS SCREEN: linear Rec.709 into the display's gamut (luminance kept, as the renderer's display does),
   scaled so its largest channel is 1 (a swatch shows the colour, not its brightness), then the exact sRGB curve */
const srgb = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
export function swatchRGB(rgb) {
    const c = gamutClip(rgb), m = Math.max(c[0], c[1], c[2])
    return m > 0 ? c.map(v => Math.round(255 * srgb(clamp(v / m, 0, 1)))) : [0, 0, 0]
}
const css = rgb => `rgb(${swatchRGB(rgb).join(',')})`

/* A LIGHT'S SPECTRUM: a narrow band (a Gaussian of 10-90 % width `width` nm about `lambda`), or a hot body at T kelvin
   (Planck's law, its shape only). Summed against the colour-matching functions every 1 nm, 380 to 780. */
const C2 = 1.4388e7                                     // hc / k, in nm K
export const spectrum = s => s.mode === 'bb'
    ? l => 1 / (l ** 5 * (Math.exp(C2 / (l * s.T)) - 1))
    : l => Math.exp(-0.5 * ((l - s.lambda) / (s.width / 2.563)) ** 2)
export const LO = 380, HI = 780
/** the light's X, Y, Z (its own scale) and chromaticity */
export function lightXYZ(s) {
    const S = spectrum(s), X = [0, 0, 0]
    for (let l = LO; l <= HI; l++) { const c = cmf(l), p = S(l); X[0] += c[0] * p; X[1] += c[1] * p; X[2] += c[2] * p }
    return { XYZ: X, xy: XYZtoxy(X) }
}
/** the exact Rec.709 RGB of chromaticity xy at luminance 1 */
export const exactRGB = xy => rgbFromXy(xy[0], xy[1])

/* THE DIAGRAM'S EDGE: the chromaticity of every single wavelength between its two corners, closed by the straight line
   of purples. THE CORNERS ARE THE FIT'S TURNING POINTS, 427 nm (its lowest y) and 644 nm (its largest x): beyond them
   the fitted curves (spectral.js) run back on themselves -- 380 nm lands at (0.028, 0.035) and 700 at (0.568, 0.432),
   where the CIE's own stay at the corners -- and the edge drawn from 380 to 700 crossed the whole diagram (a reader's,
   2026-10-18). Between them the fit is within about 0.005 of the CIE's. */
export const LOCUS_LO = 427, LOCUS_HI = 644
export const LOCUS = Array.from({ length: LOCUS_HI - LOCUS_LO + 1 }, (_, k) => XYZtoxy(cmf(LOCUS_LO + k)))
const inside = (x, y) => {
    let c = false
    for (let i = 0, j = LOCUS.length - 1; i < LOCUS.length; j = i++) {
        const [xi, yi] = LOCUS[i], [xj, yj] = LOCUS[j]
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c
    }
    return c
}
/** the screen's three primaries and its white, as chromaticities: Rec.709's, from colorimetry.js's own matrix */
export const PRIMARIES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => XYZtoxy(rgbToXYZ(v)))
export const D65 = XYZtoxy(rgbToXYZ([1, 1, 1]))
const LOCUS_T = Array.from({ length: 141 }, (_, k) => 1000 + k * 100).map(planckXy)

// the diagram's coloured fill: one cell every 0.01, each its chromaticity's on-screen colour, worked out once
const FILL = (() => {
    const out = []
    for (let x = 0.005; x < 0.75; x += 0.01) for (let y = 0.005; y < 0.85; y += 0.01) if (inside(x, y)) out.push([x, y, css(exactRGB([x, y]))])
    return out
})()

/** draw the diagram: its fill (paler, so the style's paper and the lines over it read), edge, wavelengths, triangle,
 *  the hot bodies' line with a few temperatures, and D65 */
function diagram(pen, { fill = true, ticks = true } = {}) {
    const { ctx } = pen, cell = 0.01 * pen.view.s
    if (fill) {
        ctx.save(); ctx.globalAlpha = 0.5
        for (const [x, y, c] of FILL) { ctx.fillStyle = c; ctx.fillRect(pen.X(x - 0.005), pen.Y(y + 0.005), cell + 0.6, cell + 0.6) }
        ctx.restore()
    }
    // the axes, every 0.1
    pen.line([0, 0], [0.8, 0], { role: 'soft', w: 0.8, exact: true }); pen.line([0, 0], [0, 0.85], { role: 'soft', w: 0.8, exact: true })
    for (let k = 1; k <= 8; k++) {
        const v = k / 10, t = v.toFixed(1)
        if (k < 8) pen.labelPx(pen.X(v) - 8, pen.Y(0) + 3, t, { role: 'soft', size: 10, kind: 'mono' })
        pen.labelPx(pen.X(0) - 24, pen.Y(v) - 6, t, { role: 'soft', size: 10, kind: 'mono' })
    }
    pen.labelPx(pen.X(0.78), pen.Y(0) + 3, 'x', { role: 'soft', size: 12 }); pen.labelPx(pen.X(0) - 14, pen.Y(0.84), 'y', { role: 'soft', size: 12 })
    pen.poly([...LOCUS, LOCUS[0]], { role: 'ink', w: 1.3, exact: true })
    if (ticks) for (const l of [460, 480, 520, 540, 560, 580, 600, 620]) { // 500 would sit on the y axis's numbers
        const [x, y] = XYZtoxy(cmf(l)), [cx, cy] = [0.33, 0.33], d = Math.hypot(x - cx, y - cy)
        pen.label([x + (x - cx) / d * 0.035, y + (y - cy) / d * 0.035], `${l}`, { role: 'soft', size: 10, align: 'center' })
    }
    pen.poly([...PRIMARIES, PRIMARIES[0]], { role: 'ink', w: 1, dash: [5, 4], exact: true })
    pen.poly(LOCUS_T, { role: 'light', w: 1.6, exact: true })
    for (const T of [1500, 2000, 3000, 4000, 6500, 10000]) {
        const [x, y] = planckXy(T)
        pen.dot([x, y], { role: 'light', r: 2.2 })
        if (ticks) pen.label([x + 0.004, y - 0.03], `${T}`, { role: 'light', size: 10, align: 'center' })
    }
    pen.dot(D65, { role: 'ink', r: 2.6, ring: true })
}

/** signed bars for three channels in world units, a zero line, values beyond `top` drawn to it with their number */
function bars(pen, x0, y0, vals, { top = 2, h = 0.25, w = 0.06, gap = 0.03, names = ['R', 'G', 'B'], title } = {}) {
    if (title) pen.label([x0 - 0.01, y0 + h + 0.07], title, { role: 'soft', size: 11 })
    pen.line([x0 - 0.02, y0], [x0 + 3 * (w + gap), y0], { role: 'soft', w: 0.8, exact: true })
    // the channels in their own colours, not the style's: a style's green was a grey, and its sketched outline read as a
    // dashed bar (a reader's); a bar past the scale's top ends in an open tip
    const CH = ['#cf4a3c', '#3c9a4a', '#3d5fc8']
    vals.forEach((v, i) => {
        const x = x0 + i * (w + gap), hv = clamp(v / top, -1, 1) * h, { ctx } = pen
        ctx.save(); ctx.fillStyle = CH[i]; ctx.globalAlpha = 0.8; ctx.fillRect(pen.X(x), pen.Y(Math.max(y0, y0 + hv)), pen.X(x + w) - pen.X(x), Math.abs(pen.Y(y0 + hv) - pen.Y(y0))); ctx.restore()
        pen.label([x + w / 2, y0 - 0.06 - (v < 0 ? Math.abs(hv) : 0)], names[i], { role: 'soft', size: 11, align: 'center' })
        pen.label([x + w / 2, y0 + (v >= 0 ? hv : 0) + 0.035], Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2), { role: 'ink', size: 10, align: 'center' })
    })
}

export const figures = {
    match: {
        // the world in nanometres across and a hundredth of a curve's height up: the pen draws a world at one scale both
        // ways, so heights of 0 to 2 beside 400 nm of width would be flat (they were, at first)
        aspect: 1.99,
        world: { x: [326, 812], y: [-32, 212] },
        state: { mode: 'band', lambda: 530, width: 20, T: 6500 },
        controls: [
            { type: 'seg', key: 'mode', options: [['band', 'A narrow band'], ['bb', 'A hot body']] },
            { type: 'slider', key: 'lambda', label: 'wavelength', min: 390, max: 760, step: 1, fmt: v => `${v} nm`, when: s => s.mode === 'band' },
            { type: 'slider', key: 'width', label: 'its width', min: 2, max: 120, step: 1, fmt: v => `${v} nm`, when: s => s.mode === 'band' },
            { type: 'slider', key: 'T', label: 'temperature', min: 1000, max: 15000, step: 100, fmt: v => `${v} K`, when: s => s.mode === 'bb' },
        ],
        steps: {
            green: { mode: 'band', lambda: 530, width: 20, T: 6500 },
            white: { mode: 'bb', lambda: 530, width: 20, T: 6500 },
            warm: { mode: 'bb', lambda: 530, width: 20, T: 2700 },
        },
        drag: { lambda: (s, p) => { if (s.mode === 'band') s.lambda = Math.round(clamp(p[0], 390, 760)) } },
        draw(pen, s) {
            const rect = { x: pen.X(LO), y: pen.Y(195), w: pen.X(HI) - pen.X(LO), h: pen.Y(0) - pen.Y(195) }
            const S = spectrum(s), ls = Array.from({ length: (HI - LO) / 2 + 1 }, (_, k) => LO + 2 * k)
            let peak = 0
            for (let l = LO; l <= HI; l++) peak = Math.max(peak, S(l))
            const { X } = plot(pen, rect, {
                x: [LO, HI], y: [0, 1.95], xticks: [400, 450, 500, 550, 600, 650, 700, 750], yticks: [0, 0.5, 1, 1.5], fmt: v => `${v}`,
                hoverX: v => `${Math.round(v)} nm`, hoverY: v => v.toFixed(3),
                series: [
                    { name: 'x̄', pts: ls.map(l => [l, cmf(l)[0]]), role: 'blocked', w: 1.6 },
                    { name: 'ȳ', pts: ls.map(l => [l, cmf(l)[1]]), role: 'shadow', w: 1.6 },
                    { name: 'z̄', pts: ls.map(l => [l, cmf(l)[2]]), role: 'cam', w: 1.6 },
                    { name: 'the light', pts: ls.map(l => [l, S(l) / peak]), role: 'ink', w: 1.2, dash: [4, 3] },
                ],
            })
            // the curves' names beside their peaks
            pen.labelPx(X(612), pen.Y(112), 'x̄', { role: 'blocked', size: 15 })
            pen.labelPx(X(540), pen.Y(108), 'ȳ', { role: 'shadow', size: 15 })
            pen.labelPx(X(430), pen.Y(186), 'z̄', { role: 'cam', size: 15 })
            pen.labelPx(rect.x, pen.Y(-20), 'wavelength, nm', { role: 'soft', size: 12 })
            if (s.mode === 'band') pen.handle('lambda', [s.lambda, 102], { role: 'ink', label: `${s.lambda} nm` })
            // the result: the colour (the display's), its xy, its exact RGB
            const { XYZ, xy } = lightXYZ(s), rgb = exactRGB(xy)
            const sx = pen.X(672), sy = pen.Y(190), sw = pen.X(772) - sx
            const { ctx } = pen
            ctx.save(); ctx.fillStyle = css(rgb); ctx.fillRect(sx, sy, sw, sw * 0.5); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.strokeRect(sx, sy, sw, sw * 0.5); ctx.restore()
            pen.labelPx(sx, sy + sw * 0.5 + 4, 'on this screen', { role: 'soft', size: 11 })
            void XYZ
        },
        readout(s) {
            const { XYZ, xy } = lightXYZ(s), k = 1 / XYZ[1], rgb = exactRGB(xy), neg = Math.min(...rgb) < 0
            return `${s.mode === 'bb' ? `a hot body at ${s.T} K` : `a band at ${s.lambda} nm, ${s.width} nm wide`} · X, Y, Z = ${(XYZ[0] * k).toFixed(3)}, 1, ${(XYZ[2] * k).toFixed(3)} (scaled to Y = 1) · x, y = ${xy[0].toFixed(4)}, ${xy[1].toFixed(4)} · exact Rec.709 RGB: ${rgb.map(f3).join(', ')}${neg ? ': a channel below 0, a colour no screen of those three lights can show' : ''}`
        },
    },

    xy: {
        aspect: 1.56,
        world: { x: [-0.08, 1.42], y: [-0.06, 0.9] },
        state: { P: planckXy(3000) },
        steps: {
            warm: { P: planckXy(3000) },
            blue: { P: [0.15, 0.025] },
            green: { P: cctDuvToXy(4000, 0.02) },
        },
        drag: { P: (s, p) => { s.P = [clamp(p[0], 0.01, 0.74), clamp(p[1], 0.01, 0.84)] } },
        controls: [{ type: 'button', label: 'Back to white (D65)', act: s => { s.P = D65.slice() } }],
        draw(pen, s) {
            diagram(pen)
            pen.handle('P', s.P, { role: 'accent' })
            // the point's numbers, on the right: its exact RGB, and what the display shows
            const rgb = exactRGB(s.P), clip = gamutClip(rgb), top = Math.max(1.5, ...rgb.map(Math.abs)) <= 4 ? 4 : 40
            // the exact channels high up (a negative one hangs below its line), the clipped ones, never negative, under them
            bars(pen, 0.92, 0.58, rgb, { top, h: 0.17, title: 'exact Rec.709 RGB (Y = 1)' })
            bars(pen, 0.92, 0.04, clip, { top, h: 0.17, title: 'on the screen: clipped' })
            const { ctx } = pen, sx = pen.X(1.22), sy = pen.Y(0.21), sw = pen.X(1.38) - sx
            ctx.save(); ctx.fillStyle = css(rgb); ctx.fillRect(sx, sy, sw, sw); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.strokeRect(sx, sy, sw, sw); ctx.restore()
            // pointing at the diagram: the chromaticity there
            const q = pen.hover({ x: pen.X(0), y: pen.Y(0.85), w: pen.X(0.8) - pen.X(0), h: pen.Y(0) - pen.Y(0.85) })
            if (q) {
                const x = (q.x - pen.X(0)) / pen.view.s, y = (pen.Y(0) - q.y) / pen.view.s, c = xyToCctDuv(x, y)
                pen.tip(q.x, q.y, [`x ${x.toFixed(3)}, y ${y.toFixed(3)}`, c.inRange && Math.abs(c.duv) <= 0.05 ? `${Math.round(c.cct)} K, Duv ${sgn(c.duv)}` : 'no colour temperature here'])
            }
        },
        readout(s) {
            const [x, y] = s.P, c = xyToCctDuv(x, y), rgb = exactRGB(s.P), [u, v] = xyToUpVp(x, y)
            const temp = c.inRange && Math.abs(c.duv) <= 0.05 ? `${Math.round(c.cct)} K, Duv ${sgn(c.duv)}` : `no colour temperature (${c.inRange ? `Duv ${sgn(c.duv)}, past ±0.05` : 'past the line\'s end'})`
            return `x, y = ${x.toFixed(4)}, ${y.toFixed(4)} (u′, v′ = ${u.toFixed(4)}, ${v.toFixed(4)}: the CIE 1976 map colour differences are given on, a stretch of the 1960 one Duv is measured on) · ${temp} · exact Rec.709 RGB at luminance 1: ${rgb.map(f3).join(', ')} · on the screen: ${gamutClip(rgb).map(f3).join(', ')}`
        },
    },

    mix: {
        aspect: 1.56,
        world: { x: [-0.08, 1.42], y: [-0.06, 0.9] },
        // the user's luminaire's three LEDs (core/test/colorimetry.test.mjs), mixed to 1000 lm
        state: { P: [[0.69, 0.3], [0.205, 0.7], [0.15, 0.025]], T: 4000, duv: 0 },
        controls: [
            { type: 'slider', key: 'T', label: 'target', min: 1000, max: 15000, step: 100, fmt: v => `${v} K` },
            { type: 'slider', key: 'duv', label: 'Duv', min: -0.03, max: 0.03, step: 0.001, fmt: v => sgn(v) },
            { type: 'button', label: 'The developer\'s LEDs', act: s => { s.P = [[0.69, 0.3], [0.205, 0.7], [0.15, 0.025]] } },
        ],
        steps: {
            mix: { P: [[0.69, 0.3], [0.205, 0.7], [0.15, 0.025]], T: 4000, duv: 0 },
            cool: { P: [[0.69, 0.3], [0.205, 0.7], [0.15, 0.025]], T: 6500, duv: 0 },
            warm: { P: [[0.69, 0.3], [0.205, 0.7], [0.15, 0.025]], T: 1500, duv: 0 },
        },
        drag: Object.fromEntries([0, 1, 2].map(k => [`L${k}`, (s, p) => { s.P = s.P.map((q, i) => i === k ? [clamp(p[0], 0.02, 0.74), clamp(p[1], 0.01, 0.84)] : q) }])),
        draw(pen, s) {
            diagram(pen, { fill: false, ticks: false })
            const target = cctDuvToXy(s.T, s.duv), m = mixToTarget(s.P, target, 1000), roles = ['blocked', 'shadow', 'cam']
            pen.poly([...s.P, s.P[0]], { role: 'accent', w: 1.6, exact: true })
            s.P.forEach((p, k) => pen.handle(`L${k}`, p, { role: roles[k] }))
            pen.dot(target, { role: m.reachable ? 'accent' : 'blocked', r: 4.5 })
            pen.label([target[0] + 0.02, target[1] + 0.025], 'target', { role: 'accent', size: 12 })
            bars(pen, 0.92, 0.45, m.flux, { top: 1000, h: 0.3, w: 0.07, names: ['red', 'green', 'blue'], title: 'lumens of each, for 1000 in all' })
            if (!m.reachable) pen.label([0.92, 0.06], 'one would have to be negative:', { role: 'blocked', size: 11 })
            if (!m.reachable) pen.label([0.92, 0.01], 'the target is outside the triangle', { role: 'blocked', size: 11 })
        },
        readout(s) {
            const target = cctDuvToXy(s.T, s.duv), m = mixToTarget(s.P, target, 1000)
            return `the target, ${s.T} K at Duv ${sgn(s.duv)}: x, y = ${target[0].toFixed(4)}, ${target[1].toFixed(4)} · red ${m.flux[0].toFixed(1)} lm + green ${m.flux[1].toFixed(1)} lm + blue ${m.flux[2].toFixed(1)} lm = 1000 · ${m.reachable ? 'reachable' : 'not reachable: a negative flux, no lamp can give that'}`
        },
    },
}

/** the chromaticity of three lights' sum, from their fluxes: what mixToTarget solved for, checked (for the test) */
export const mixedXy = (P, flux) => XYZtoxy([0, 1, 2].map(r => P.reduce((a, p, i) => a + xyToXYZ(p[0], p[1], flux[i])[r], 0)))

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
