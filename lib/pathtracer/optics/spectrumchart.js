//======================================================================================================================
// A SPECTRUM, DRAWN (0.next; roadmap/LIGHT_MODEL.md S2) -- relative power against wavelength, 380-780 nm, the area under
// it in the colour each wavelength is on this screen, y-bar faint behind it as the eye's own weighing. One drawer for
// both places a spectrum is shown: a light given by its spectrum, in the builder's Properties (builder/panel.js
// spectrumBindings), and what a detector received, in the Analysis pane's Spectrum chart (optics/page.js).
//
//   const L = drawSpectrum(canvas, { values: Float64Array, lo: 380, step: 5, title, unit, hover, compact })
//   spectrumAt(L, px)        // the wavelength under the pointer, CSS pixels (null off the plot)
//
// The power is shown relative to its largest value, unless `unit` names one (W/nm): then on its own axis. A wavelength's
// colour is the CIE 1931 table's (core/spd.js cieAt) through Rec.709, clipped into the display's gamut keeping its
// luminance and then brought to a common brightness -- a hue, not a luminance, so the deep red and the violet read as
// colours too. The colours are the chart system's own constants (xychart.js), not the page's CSS.
//======================================================================================================================
import { ticks } from './xychart.js'
import { POLAR_SURFACE, ringLabel } from './polar.js'
import { cieAt } from '../core/spd.js'
import { XYZtoRGB, gamutClip } from '../core/colorimetry.js'

const INK = '#dde3e8', MUTED = '#8fa3b3', GRID = 'rgba(160,175,190,0.16)', AXIS = 'rgba(160,175,190,0.45)'
export const SPECTRUM_RANGE = [380, 780]

/** The display colour of a wavelength, a CSS rgb() of full brightness: its hue alone. */
export function wavelengthColour(nm) {
    const c = cieAt(nm)
    const rgb = gamutClip(XYZtoRGB(c)).map(v => Math.max(0, v))
    const m = Math.max(...rgb)
    if (!(m > 0)) return 'rgb(40,40,40)'
    // brightened to a common peak; the ends of the visible fade towards grey as the eye's response does
    const fade = Math.min(1, Math.max(0.35, (c[0] + c[1] + c[2]) * 4))
    return `rgb(${rgb.map(v => Math.round(255 * Math.pow(v / m, 1 / 2.2) * fade)).join(',')})`
}

/** Draw. Returns the layout, for spectrumAt. */
export function drawSpectrum(canvas, { values = [], lo = 380, step = 5, title = '', unit = '', hover = null, compact = false } = {}) {
    const dpr = globalThis.devicePixelRatio || 1
    const W = canvas.clientWidth || 300, H = canvas.clientHeight || (compact ? 110 : 240)
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    }
    const g = canvas.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = POLAR_SURFACE
    g.fillRect(0, 0, W, H)
    g.font = '11px ui-sans-serif, system-ui, sans-serif'
    const [X0, X1] = SPECTRUM_RANGE
    const pts = Array.from(values, (v, i) => [lo + i * step, Number.isFinite(v) ? v : 0]).filter(([l]) => l >= X0 - 1e-9 && l <= X1 + 1e-9)
    const top = Math.max(0, ...pts.map(p => p[1]))
    const Ymax = unit ? (top > 0 ? top * 1.05 : 1) : 1
    const norm = unit ? 1 : (top > 0 ? 1 / top : 0)
    const x0 = compact ? 30 : 58, x1 = Math.max(x0 + 40, W - 10), y0 = compact ? 8 : (title ? 24 : 10), y1 = Math.max(y0 + 30, H - (compact ? 20 : 34))
    const px = l => x0 + (l - X0) / (X1 - X0) * (x1 - x0)
    const py = v => y1 - Math.max(0, Math.min(1, v / Ymax)) * (y1 - y0)
    // the grid
    g.strokeStyle = GRID; g.lineWidth = 1
    for (const l of ticks(X0, X1, compact ? 4 : 8)) { g.beginPath(); g.moveTo(px(l), y0); g.lineTo(px(l), y1); g.stroke() }
    const ys = unit ? ticks(0, Ymax, 4) : [0, 0.25, 0.5, 0.75, 1]
    for (const v of ys) { g.beginPath(); g.moveTo(x0, py(v)); g.lineTo(x1, py(v)); g.stroke() }
    // y-bar, faint: what the eye weighs each wavelength by
    g.strokeStyle = 'rgba(160,175,190,0.35)'; g.setLineDash([3, 3]); g.beginPath()
    for (let l = X0; l <= X1; l += 2) { const y = y1 - cieAt(l)[1] * (y1 - y0); if (l === X0) g.moveTo(px(l), y); else g.lineTo(px(l), y) }
    g.stroke(); g.setLineDash([])
    // the area under the spectrum, a strip a sample in its wavelength's colour
    for (let i = 0; i + 1 < pts.length; i++) {
        const [la, va] = pts[i], [lb, vb] = pts[i + 1]
        g.fillStyle = wavelengthColour(0.5 * (la + lb))
        g.beginPath()
        g.moveTo(px(la), y1); g.lineTo(px(la), py(va * norm)); g.lineTo(px(lb), py(vb * norm)); g.lineTo(px(lb), y1)
        g.closePath(); g.fill()
    }
    // the line over it
    g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath()
    pts.forEach(([l, v], i) => { if (i) g.lineTo(px(l), py(v * norm)); else g.moveTo(px(l), py(v * norm)) })
    g.stroke()
    // the axes and their labels
    g.strokeStyle = AXIS; g.lineWidth = 1
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.lineTo(x1, y1); g.stroke()
    g.fillStyle = MUTED; g.textAlign = 'center'; g.textBaseline = 'top'
    for (const l of ticks(X0, X1, compact ? 4 : 8)) g.fillText(String(l), px(l), y1 + 3)
    if (!compact) g.fillText('wavelength, nm', (x0 + x1) / 2, y1 + 17)
    g.textAlign = 'right'; g.textBaseline = 'middle'
    for (const v of compact ? [0, 1] : ys) g.fillText(unit ? ringLabel(v) : String(v), x0 - 4, py(v))
    if (title) { g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(title, x0, 5) }
    if (!compact) { g.save(); g.translate(12, (y0 + y1) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = MUTED; g.fillText(unit || 'relative power', 0, 0); g.restore() }
    const L = { x0, x1, y0, y1, X0, X1 }
    // the hover line and its value
    if (hover != null && hover >= X0 && hover <= X1 && pts.length > 1) {
        const i = Math.min(pts.length - 1, Math.max(0, Math.round((hover - lo) / step)))
        g.strokeStyle = 'rgba(221,227,232,0.6)'; g.beginPath(); g.moveTo(px(hover), y0); g.lineTo(px(hover), y1); g.stroke()
        g.fillStyle = INK; g.textAlign = hover > (X0 + X1) / 2 ? 'right' : 'left'; g.textBaseline = 'top'
        const v = values[i] ?? 0
        g.fillText(`${Math.round(lo + i * step)} nm: ${unit ? `${ringLabel(v)} ${unit}` : (v * norm).toFixed(3)}`, px(hover) + (hover > (X0 + X1) / 2 ? -4 : 4), y0 + 2)
    }
    return L
}
/** The wavelength under the pointer (CSS pixels), or null off the plot. */
export const spectrumAt = (L, x) => L && x >= L.x0 && x <= L.x1 ? L.X0 + (x - L.x0) / (L.x1 - L.x0) * (L.X1 - L.X0) : null
