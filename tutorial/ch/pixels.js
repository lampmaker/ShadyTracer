//======================================================================================================================
// CHAPTER "From light to pixels": its figures.
//
//   meter   a scene's pixels as a histogram of their luminance, the way core/autoexposure.js meters on the GPU: 128
//           bins of log2 cd/m^2, the middle 10-90 % averaged, the brightest 5 % kept within the headroom of white,
//           black not voting -- the update kernel's arithmetic, mirrored line for line here (it runs only on a GPU) --
//           and the scene's parts as the display shows them at the EV it chose
//   curve   the tone curves of rendertoscreen.js, ported from its WGSL: the display value against the light, in stops
//           from white, and a coloured light ramped through them under the one chosen
//   encode  why the picture is stored as sRGB: a dark ramp kept in 8 bits linearly, and kept as sRGB
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { rng } from '../kit/flatland.js'
import { EV_CLIP, ev100ToScale, meterEV100, LUMA } from '../../lib/pathtracer/core/photometry.js'
// autoexposure.js's constants, copied: that module also builds the kernels (it calls makeCompute), and a page imports
// nothing that reaches GPU code. The test holds each to the file.
export const AE_BINS = 128, AE_LOG_MIN = -10, AE_LOG_MAX = 34, AE_LOW = 0.10, AE_HIGH = 0.90, AE_PROTECT = 0.95
import { gamutClip } from '../../lib/pathtracer/core/colorimetry.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const Y = c => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
export const srgb = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055

/* THE TONE CURVES, rendertoscreen.js's WGSL in JS (no JS twin exists in the renderer): each takes linear light already
   divided by white and gives linear light for the sRGB step. WGSL's mat3x3(a..i) is column-major, so `M * v` sums the
   columns (a, b, c), (d, e, f), (g, h, i) times v's three; `v * M` dots v with each of those triples. */
const colMul = (m, v) => [0, 1, 2].map(r => m[r] * v[0] + m[3 + r] * v[1] + m[6 + r] * v[2])          // M * v
const rowMul = (v, m) => [0, 1, 2].map(j => v[0] * m[3 * j] + v[1] * m[3 * j + 1] + v[2] * m[3 * j + 2])  // v * M
export function toneNeutral(c0) {
    const start = 0.8 - 0.04, desat = 0.15, x = Math.min(...c0), offset = x < 0.08 ? x - 6.25 * x * x : 0.04
    let c = c0.map(v => v - offset)
    const peak = Math.max(...c)
    if (peak < start) return c
    const d = 1 - start, newPeak = 1 - d * d / (peak + d - start)
    c = c.map(v => v * newPeak / peak)
    const g = 1 - 1 / (desat * (peak - newPeak) + 1)
    return c.map(v => v + (newPeak - v) * g)
}
const AGX_IN = [0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104]
const AGX_OUT = [1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116]
const agxContrast = x => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232 }
export function toneAgX(c0) {
    const minEv = -12.47393, maxEv = 4.026069
    let v = colMul(AGX_IN, c0.map(x => Math.max(x, 1e-10)))
    v = v.map(x => (clamp(Math.log2(x), minEv, maxEv) - minEv) / (maxEv - minEv)).map(agxContrast)
    return colMul(AGX_OUT, v).map(x => Math.pow(Math.max(x, 0), 2.2))
}
const ACES_IN = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777]
const ACES_OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602]
export function toneACES(c0) {
    const v = rowMul(c0, ACES_IN), r = v.map(x => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081))
    return rowMul(r, ACES_OUT)
}
export const toneReinhard = c => { const y = Y(c); return c.map(v => v / (1 + y)) }
const hable = x => { const sh = 0.15, li = 0.5, la = 0.1, to = 0.2, tn = 0.02, td = 0.3; return (x * (sh * x + la * li) + to * tn) / (x * (sh * x + li) + to * td) - tn / td }
export const toneHable = c => c.map(v => hable(2 * v) / hable(11.2))
export const CURVES = [
    ['none', 'none (clip)', c => c], ['neutral', 'PBR Neutral', toneNeutral], ['agx', 'AgX', toneAgX],
    ['aces', 'ACES (fitted)', toneACES], ['reinhard', 'Reinhard', toneReinhard], ['hable', 'Hable filmic', toneHable],
]
const curveOf = id => CURVES.find(c => c[0] === id)[2]
/** displayPixel's order, for light already times the exposure: into the gamut, the tone curve, clamp, sRGB (0 to 1) */
export const display = (rgb, id = 'neutral') => curveOf(id)(gamutClip(rgb)).map(v => srgb(clamp(v, 0, 1)))

/* THE METER, as prog_ae_update computes it from the histogram prog_ae_histogram fills: { ev, evAvg, evHi, logL, logHi,
   cuts } for an array of pixel luminances. `blackVotes` puts the old behaviour back for the figure: a pixel below the
   floor counted in the darkest bin. */
export function meter(lums, { headroom = 2, blackVotes = false } = {}) {
    const hist = new Array(AE_BINS).fill(0), span = AE_LOG_MAX - AE_LOG_MIN
    for (const L of lums) {
        if (!(L >= 2 ** AE_LOG_MIN) && !blackVotes) continue
        const t = (Math.log2(Math.max(L, 1e-30)) - AE_LOG_MIN) / span
        hist[Math.trunc(clamp(t * AE_BINS, 0, AE_BINS - 1))]++
    }
    const total = hist.reduce((a, b) => a + b, 0)
    if (!total) return null
    const lo = AE_LOW * total, hi = AE_HIGH * total, w = span / AE_BINS, q = AE_PROTECT * total
    let below = 0, kept = 0, acc = 0, logHi = AE_LOG_MAX, foundHi = false, cutLo = null, cutHi = null
    for (let i = 0; i < AE_BINS; i++) {
        const n = hist[i], a = Math.max(below, lo), b = Math.min(below + n, hi)
        if (b > a) { kept += b - a; acc += (b - a) * (AE_LOG_MIN + (i + 0.5) * w) }
        if (cutLo == null && below + n > lo) cutLo = AE_LOG_MIN + i * w
        if (cutHi == null && below + n >= hi) cutHi = AE_LOG_MIN + (i + 1) * w
        if (!foundHi && n > 0 && below + n >= q) { logHi = AE_LOG_MIN + (i + clamp((q - below) / n, 0, 1)) * w; foundHi = true }
        below += n
    }
    const logL = acc / Math.max(kept, 1e-9), evAvg = meterEV100(2 ** logL), evHi = logHi - Math.log2(EV_CLIP) - Math.max(headroom, 0)
    return { hist, total, logL, logHi, evAvg, evHi, ev: Math.max(evAvg, evHi), cuts: [cutLo, cutHi] }
}

/* TWO SCENES, as parts of a picture: each a luminance (cd/m^2), a share of the pixels, a colour, and a spread of +-0.4
   stop so a part is a hump, not a spike. Outdoors is chapter 5's floor in the sun (21,826) and in shadow (the sky
   alone, 3,820) with the sky and the sun's disc; the room is a lamp-lit corner of a dark room. */
export const SCENES = {
    outdoors: [
        { name: 'the sun', L: 1.488e9, share: 0.0005, rgb: [1, 0.96, 0.9] },
        { name: 'sunlit floor', L: 21826, share: 0.3, rgb: [0.9, 0.85, 0.75] },
        { name: 'blue sky', L: 7000, share: 0.3, rgb: [0.55, 0.7, 1] },
        { name: 'shadow', L: 3820, share: 0.25, rgb: [0.7, 0.75, 0.9] },
        { name: 'dark doorway', L: 150, share: 0.1, rgb: [0.6, 0.55, 0.5] },
    ],
    room: [
        { name: 'the lamp', L: 2e5, share: 0.004, rgb: [1, 0.85, 0.6] },
        { name: 'lit desk', L: 600, share: 0.06, rgb: [0.95, 0.75, 0.5] },
        { name: 'walls', L: 8, share: 0.5, rgb: [0.85, 0.8, 0.75] },
        { name: 'far corner', L: 0.6, share: 0.3, rgb: [0.6, 0.6, 0.65] },
    ],
}
const SPREAD = 0.4
/** the scene's pixels' luminances: N lit ones, and black ones (no light at all: behind everything, a sky switched off)
 *  added to make `black` of the whole -- so the lit pixels are the same whatever the black, as in a picture whose
 *  background grows around the same objects */
export function pixels(scene, black = 0, N = 8000) {
    const R = rng(4242), out = [], parts = SCENES[scene], tot = parts.reduce((a, p) => a + p.share, 0)
    for (const p of parts) { const n = Math.max(1, Math.round(p.share / tot * N)); for (let i = 0; i < n; i++) out.push(p.L * 2 ** (SPREAD * (2 * R() - 1))) }
    const nb = Math.round(black / (1 - black) * out.length)
    for (let i = 0; i < nb; i++) out.push(0)
    return out
}

export const figures = {
    meter: {
        aspect: 1.75,
        world: { x: [0, 1], y: [0, 1] },
        state: { scene: 'outdoors', black: 0, headroom: 2, votes: false },
        controls: [
            { type: 'seg', key: 'scene', options: [['outdoors', 'Outdoors'], ['room', 'A lamp-lit room']] },
            { type: 'slider', key: 'black', label: 'black pixels', min: 0, max: 0.8, step: 0.05, fmt: v => `${Math.round(100 * v)}%` },
            { type: 'slider', key: 'headroom', label: 'highlight headroom', min: 0, max: 12, step: 0.5, fmt: v => `${v} EV` },
            { type: 'toggle', key: 'votes', label: 'Black votes (the old meter)' },
        ],
        steps: {
            outdoors: { scene: 'outdoors', black: 0, headroom: 2, votes: false },
            room: { scene: 'room', black: 0, headroom: 2, votes: false },
            unprotected: { scene: 'room', black: 0, headroom: 12, votes: false },
            black: { scene: 'room', black: 0.6, headroom: 2, votes: true },
        },
        draw(pen, s) {
            const { W, H } = pen.view, lums = pixels(s.scene, s.black), m = meter(lums, { headroom: s.headroom, blackVotes: s.votes })
            const rect = { x: W * 0.07, y: H * 0.08, w: W * 0.88, h: H * 0.5 }, w = (AE_LOG_MAX - AE_LOG_MIN) / AE_BINS
            const top = Math.max(...m.hist) * 1.08
            const { X, Y: PY } = plot(pen, rect, {
                x: [AE_LOG_MIN, AE_LOG_MAX], y: [0, top], xticks: [-10, -5, 0, 5, 10, 15, 20, 25, 30], yticks: [],
                fmt: v => `2^${v}`, hoverX: v => `${(2 ** v).toPrecision(3)} cd/m²`, hoverY: v => `${Math.round(v)} pixels`,
                series: [{ name: 'pixels', pts: m.hist.map((n, i) => [AE_LOG_MIN + (i + 0.5) * w, n]), role: 'soft', kind: 'bars' }],
            })
            pen.labelPx(rect.x, rect.y - 18, `the pixels by luminance, log2 cd/m² (black, below 2⁻¹⁰, ${s.votes ? 'voting, in the lowest bin' : 'does not vote'})`, { role: 'soft', size: 12 })
            const vline = (x, role, label, dy = 0, dash = [4, 4]) => {
                const px = X(clamp(x, AE_LOG_MIN, AE_LOG_MAX)), { ctx } = pen
                ctx.save(); ctx.strokeStyle = pen.col(role); ctx.lineWidth = 1.4; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(px, rect.y); ctx.lineTo(px, rect.y + rect.h); ctx.stroke(); ctx.restore()
                pen.labelPx(px + 3, rect.y + 4 + dy, label, { role, size: 11 })
            }
            vline(m.cuts[0], 'soft', '10%', 0, [2, 3]); vline(m.cuts[1], 'soft', '90%', 0, [2, 3])
            vline(m.logL, 'cam', 'average', 16)
            vline(m.logHi, 'light', 'brightest 5%', 32)
            const white = Math.log2(EV_CLIP) + m.ev
            vline(white, 'accent', 'white', 48, [])
            void PY
            // the scene's parts as the display shows them at this EV (PBR Neutral, the default curve)
            const parts = SCENES[s.scene], sy = rect.y + rect.h + 40, sw = (rect.w - 10 * (parts.length - 1)) / parts.length, scale = ev100ToScale(m.ev)
            const { ctx } = pen
            parts.forEach((p, i) => {
                const x = rect.x + i * (sw + 10), c = display(p.rgb.map(v => v / Y(p.rgb) * p.L * scale), 'neutral')
                ctx.save(); ctx.fillStyle = `rgb(${c.map(v => Math.round(255 * v)).join(',')})`; ctx.fillRect(x, sy, sw, H * 0.17); ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.strokeRect(x, sy, sw, H * 0.17); ctx.restore()
                pen.labelPx(x, sy + H * 0.17 + 4, `${p.name}, ${p.L >= 1e4 ? p.L.toExponential(1) : p.L}`, { role: 'soft', size: 11 })
            })
        },
        readout(s) {
            const m = meter(pixels(s.scene, s.black), { headroom: s.headroom, blackVotes: s.votes })
            const chose = m.evHi > m.evAvg ? `darker, to keep the brightest 5% within ${s.headroom} EV of white` : 'the average\'s'
            return `the middle 80% average 2^${m.logL.toFixed(2)} = ${(2 ** m.logL).toPrecision(3)} cd/m²: EV ${m.evAvg.toFixed(2)} · the brightest 5% from 2^${m.logHi.toFixed(2)}: EV ${m.evHi.toFixed(2)} at least (no brighter) · chosen: EV ${m.ev.toFixed(2)}, ${chose} · white is 1.2 × 2^EV = ${(EV_CLIP * 2 ** m.ev).toPrecision(3)} cd/m²`
        },
    },

    curve: {
        aspect: 1.75,
        world: { x: [0, 1], y: [0, 1] },
        state: { curve: 'neutral' },
        controls: [{ type: 'seg', key: 'curve', options: CURVES.map(([id, name]) => [id, name]) }],
        steps: { none: { curve: 'none' }, neutral: { curve: 'neutral' }, agx: { curve: 'agx' } },
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.08, y: H * 0.07, w: W * 0.6, h: H * 0.62 }
            const stops = Array.from({ length: 121 }, (_, k) => -8 + k * 0.1)
            plot(pen, rect, {
                x: [-8, 4], y: [0, 1.05], xticks: [-8, -6, -4, -2, 0, 2, 4], yticks: [0, 0.5, 1], fmt: v => `${v}`,
                hoverX: v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} stops: ${(2 ** v).toPrecision(3)} × white`, hoverY: v => `${Math.round(255 * v)} of 255`,
                series: CURVES.map(([id, name]) => ({ name, pts: stops.map(x => [x, display([2 ** x, 2 ** x, 2 ** x], id)[0]]), role: id === s.curve ? 'accent' : 'soft', w: id === s.curve ? 2.2 : 0.8, tip: id === s.curve })),
            })
            pen.labelPx(rect.x, rect.y + rect.h + 22, 'the light, in stops from white (0 is white; each stop doubles)', { role: 'soft', size: 12 })
            pen.labelPx(rect.x - 20, rect.y - 18, 'what the screen shows, grey light', { role: 'soft', size: 12 })
            // a coloured light and a grey one through the chosen curve, from 6 stops under white to 4 over
            const { ctx } = pen, sx = W * 0.74, sw = W * 0.22, n = 30
            for (const [k, base, name] of [[0, [1, 1, 1], 'grey'], [1, [1, 0.42, 0.1], 'an orange light'], [2, [0.15, 0.35, 1], 'a blue light']]) {
                const y0 = H * (0.1 + 0.2 * k)
                pen.labelPx(sx, y0 - 16, name, { role: 'soft', size: 11 })
                for (let i = 0; i < n; i++) {
                    const st = -6 + 10 * (i + 0.5) / n, c = display(base.map(v => v / Y(base) * 2 ** st), s.curve)
                    ctx.fillStyle = `rgb(${c.map(v => Math.round(255 * v)).join(',')})`; ctx.fillRect(sx + i * sw / n, y0, sw / n + 0.6, H * 0.1)
                }
                ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.strokeRect(sx, y0, sw, H * 0.1)
            }
            pen.labelPx(sx, H * 0.72, '−6 stops … white … +4', { role: 'soft', size: 11 })
        },
        readout(s) {
            const g = st => Math.round(255 * display([2 ** st, 2 ** st, 2 ** st], s.curve)[0])
            const name = CURVES.find(c => c[0] === s.curve)[1]
            return `${name}: grey light at 3 stops under white shows ${g(-3)} of 255, at white ${g(0)}, at 2 stops over ${g(2)}, at 4 over ${g(4)}`
        },
    },

    encode: {
        aspect: 2.2,
        world: { x: [0, 1], y: [0, 1] },
        state: { top: 0.1 },
        controls: [{ type: 'slider', key: 'top', label: 'the ramp up to', min: 0.01, max: 1, step: 0.01, fmt: v => `${Math.round(100 * v)}% of white` }],
        steps: { dark: { top: 0.1 }, all: { top: 1 } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen, x0 = W * 0.05, w = W * 0.9, n = Math.round(w)
            const rows = [['kept linearly in 8 bits', v => Math.round(255 * v) / 255], ['kept as sRGB in 8 bits', v => { const e = Math.round(255 * srgb(v)) / 255; return e <= 0.04045 ? e / 12.92 : Math.pow((e + 0.055) / 1.055, 2.4) }]]
            rows.forEach(([name, keep], k) => {
                const y0 = H * (0.12 + 0.42 * k)
                pen.labelPx(x0, y0 - 16, name, { role: 'soft', size: 12 })
                for (let i = 0; i < n; i++) {
                    // from black to the slider's value, both ends included
                    const v = keep(s.top * i / (n - 1)), e = Math.round(255 * srgb(v))
                    ctx.fillStyle = `rgb(${e},${e},${e})`; ctx.fillRect(x0 + i, y0, 1.2, H * 0.26)
                }
                ctx.strokeStyle = pen.col('ink'); ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, H * 0.26)
                // the codes in the range, as the readout counts them: the strip's pixels, one value each, skipped some of
                // sRGB's finest steps near black and once said 220 where the text said 256 (a reader's)
                const codes = k ? Math.round(255 * srgb(s.top)) + 1 : Math.round(255 * s.top) + 1
                pen.labelPx(x0 + w, y0 + H * 0.26 + 4, `${codes} of the 256 codes in this range`, { role: 'soft', size: 11, align: 'right' })
            })
            pen.labelPx(x0, H * 0.92, `light from 0 to ${Math.round(100 * s.top)}% of white, left to right`, { role: 'soft', size: 11 })
        },
        readout(s) {
            const lin = Math.round(255 * s.top) + 1, enc = Math.round(255 * srgb(s.top)) + 1
            return `from black to ${Math.round(100 * s.top)}% of white: ${lin} of the 256 codes kept linearly, ${enc} kept as sRGB · sRGB of ${s.top}: ${srgb(s.top).toFixed(3)}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
