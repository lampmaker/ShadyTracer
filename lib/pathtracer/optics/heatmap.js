//======================================================================================================================
// THE ILLUMINANCE MAP, large -- a map (optics/illum.js: a detector's, or the far field on a plane) as
// false colour with isolux lines over it, square cells kept square, axes in the map's length unit.
//
//   const L = drawHeatmap(canvas, m, { contours: isolux(m, levels), point: [a, b], hover: [a, b],
//                                      lengthUnit: 'mm', title })
//   heatmapAt(L, px, py)           // the map point [a, b] under the pointer, or null
//
// COLOUR is Turbo (detmap.js turbo), 0 at the bottom and the map's maximum at the top, the same scale
// the picture's false colour uses, so a colour means the same thing on the page and in the picture.
// A histogram cell no hit landed in is black, not the colour of 0 lux: "nothing measured" and
// "measured nothing" are the same number but not the same statement.
// THE ISOLUX LINES are white-ish and thin, each level named on the colour bar where it falls; the
// POINT the profiles run through is a crosshair.
//
// A MAP OF ANOTHER QUANTITY (quantities.js: CCT, x, y) says its range as `lo` and `hi`: the colours
// run over that, not from 0 -- a CCT map from 0 K would be a single colour. A cell with no value
// (NaN: too dim for a colour) is black like a cell no hit landed in, for the same reason.
//
// THE LIGHT ITSELF (`m.paint`, quantities.js): a map that carries X and Z is painted in the light's
// colour instead of Turbo. 'light': linear brightness E / max times `exposure` -- above 1 the bright
// middle clips and the fringes come up -- which is what a white matte screen there would look like
// lit by this alone; 'hue': every lit cell at full brightness. Out of the display's gamut a colour is
// desaturated at its own luminance (colorimetry.js gamutClip), then scaled down whole where a channel
// passes 1, so a clipped cell keeps its hue rather than turning towards white or yellow; then sRGB.
// The colour bar is then the brightness, in grey, for 'light', and there is none for 'hue'.
//======================================================================================================================
import { turbo } from './detmap.js'
import { XYZtoRGB, gamutClip } from '../core/colorimetry.js'
import { ringLabel, POLAR_SURFACE } from './polar.js'
import { ticks } from './xychart.js'

const INK = '#dde3e8', MUTED = '#8fa3b3'
/** A coordinate for an axis: a true minus, and a round-off near 0 said as 0. */
const signed = v => Math.abs(v) < 1e-12 ? '0' : (v < 0 ? '−' : '') + ringLabel(Math.abs(v))
const srgb = c => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055))

/** A cell of a map with colour as the display shows it, 0..255 RGB (see THE LIGHT ITSELF above), or
 *  null where no light landed. */
export function paintCell(m, i, paint = 'light', exposure = 1) {
    const Y = m.E[i]
    if (!m.EX || !(Y > 0)) return null
    let c = gamutClip(XYZtoRGB([m.EX[i] / Y, 1, m.EZ[i] / Y]))
    const b = paint === 'hue' ? 1 : Y / (m.hi ?? m.max) * exposure
    const top = Math.max(c[0], c[1], c[2])
    if (!(top > 0)) return [0, 0, 0]
    c = c.map(v => v * (paint === 'hue' ? 1 / top : b))
    const over = Math.max(c[0], c[1], c[2])
    if (over > 1) c = c.map(v => v / over)
    return c.map(v => srgb(Math.max(0, v)))
}

/** Draw. Returns the layout, for heatmapAt. */
export function drawHeatmap(canvas, m, { contours = [], point = null, hover = null, lengthUnit = '', title = '', unit = 'lx', exposure = 1 } = {}) {
    const dpr = globalThis.devicePixelRatio || 1
    const W = canvas.clientWidth || 400, H = canvas.clientHeight || 400
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    }
    const g = canvas.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = POLAR_SURFACE
    g.fillRect(0, 0, W, H)
    g.font = '11px ui-sans-serif, system-ui, sans-serif'
    if (title) { g.fillStyle = INK; g.font = '12px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(title, 8, 15); g.font = '11px ui-sans-serif, system-ui, sans-serif' }

    // THE PLOT: the map's aspect kept, in the space left of the colour bar
    const top = title ? 26 : 10, barW = 12, right = 64
    const availW = Math.max(40, W - 50 - right - barW), availH = Math.max(40, H - top - 34)
    const spanA = m.range.a[1] - m.range.a[0], spanB = m.range.b[1] - m.range.b[0]
    const s = Math.min(availW / spanA, availH / spanB)
    const pw = spanA * s, ph = spanB * s
    const x0 = 50 + (availW - pw) / 2, y0 = top + (availH - ph) / 2
    const PX = a => x0 + (a - m.range.a[0]) * s, PY = b => y0 + ph - (b - m.range.b[0]) * s

    // the cells, one pixel each, scaled up without smoothing
    const img = offscreen(m.nx, m.ny)
    const ig = img.getContext('2d'), data = ig.createImageData(m.nx, m.ny)
    const histogram = m.count && (!m.smooth || m.smooth === 'none')
    const lo = m.lo ?? 0, hi = m.hi ?? m.max, span = hi - lo
    const at = v => span > 0 ? (v - lo) / span : (v > lo ? 1 : 0)       // 0..1 up the scale
    /* a quantity other than E has a value wherever it is finite -- 0 included: a cell exactly on a
       target is data, not a cell no light reached */
    const ranged = m.lo != null && (m.lo !== 0 || (m.quantity != null && m.quantity !== 'E' && !m.paint))
    const paint = m.EX && m.paint ? m.paint : null
    for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
        const i = y * m.nx + x, o = ((m.ny - 1 - y) * m.nx + x) * 4, e = m.E[i]
        const has = !Number.isFinite(e) ? false : histogram ? m.count[i] : ranged ? true : e > 0
        const [r, gg, b] = !has ? [0, 0, 0] : paint ? paintCell(m, i, paint, exposure) ?? [0, 0, 0] : turbo(Math.max(0, Math.min(1, at(e))))
        data.data[o] = r; data.data[o + 1] = gg; data.data[o + 2] = b; data.data[o + 3] = 255
    }
    ig.putImageData(data, 0, 0)
    g.imageSmoothingEnabled = false
    g.drawImage(img, x0, y0, pw, ph)

    // ISOLUX LINES
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1
    for (const c of contours) {
        g.beginPath()
        for (const q of c.segs) { g.moveTo(PX(q[0]), PY(q[1])); g.lineTo(PX(q[2]), PY(q[3])) }
        g.stroke()
    }

    // THE AXES, in the map's unit
    g.fillStyle = MUTED; g.strokeStyle = 'rgba(160,175,190,0.45)'
    g.textAlign = 'center'; g.textBaseline = 'top'
    for (const v of ticks(m.range.a[0], m.range.a[1], Math.max(3, Math.floor(pw / 70)))) {
        g.beginPath(); g.moveTo(PX(v), y0 + ph); g.lineTo(PX(v), y0 + ph + 4); g.stroke()
        g.fillText(signed(v), PX(v), y0 + ph + 6)
    }
    g.textAlign = 'right'; g.textBaseline = 'middle'
    for (const v of ticks(m.range.b[0], m.range.b[1], Math.max(3, Math.floor(ph / 60)))) {
        g.beginPath(); g.moveTo(x0 - 4, PY(v)); g.lineTo(x0, PY(v)); g.stroke()
        g.fillText(signed(v), x0 - 6, PY(v))
    }
    const [na, nb] = m.axisNames ?? ['u', 'v']
    g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(`${na}, ${lengthUnit}`, x0 + pw, y0 + ph + 20)
    g.save(); g.translate(12, y0 + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(`${nb}, ${lengthUnit}`, 0, 0); g.restore()

    // THE COLOUR BAR, with the isolux levels named where they fall
    const bx = x0 + pw + 14, by0 = y0, by1 = y0 + ph
    if (paint === 'hue') return { x0, y0, pw, ph, s, range: m.range, ...crosses(g, PX, PY, x0, y0, pw, ph, point, hover) }
    const grad = g.createLinearGradient(0, by1, 0, by0)
    /* the brightness, for the light painted: grey from black to white at max / exposure, white above */
    const barAt = t => paint ? (v => [v, v, v])(srgb(Math.min(1, t * exposure))) : turbo(t)
    for (let t = 0; t <= 1.0001; t += 0.125) grad.addColorStop(Math.min(1, t), `rgb(${barAt(t).join(',')})`)
    g.fillStyle = grad; g.fillRect(bx, by0, barW, by1 - by0)
    g.fillStyle = MUTED; g.textAlign = 'left'; g.textBaseline = 'middle'
    const lab = v => m.digits != null ? v.toFixed(m.digits) : ringLabel(v)
    g.fillText(`${lab(hi)}${unit ? ` ${unit}` : ''}`, bx + barW + 4, by0 + 4)
    g.fillText(ranged ? lab(lo) : '0', bx + barW + 4, by1 - 4)
    g.strokeStyle = 'rgba(255,255,255,0.8)'
    for (const c of contours) {
        if (!(span > 0) || c.level > hi || c.level < lo) continue
        const y = by1 - at(c.level) * (by1 - by0)
        g.beginPath(); g.moveTo(bx - 3, y); g.lineTo(bx + barW + 3, y); g.stroke()
        if (y > by0 + 12 && y < by1 - 12) g.fillText(lab(c.level), bx + barW + 4, y)
    }

    return { x0, y0, pw, ph, s, range: m.range, ...crosses(g, PX, PY, x0, y0, pw, ph, point, hover) }
}

/** THE PROFILES' POINT, and the pointer. */
function crosses(g, PX, PY, x0, y0, pw, ph, point, hover) {
    const cross = (p, colour, len) => {
        g.strokeStyle = colour; g.lineWidth = 1.5
        g.beginPath(); g.moveTo(PX(p[0]) - len, PY(p[1])); g.lineTo(PX(p[0]) + len, PY(p[1]))
        g.moveTo(PX(p[0]), PY(p[1]) - len); g.lineTo(PX(p[0]), PY(p[1]) + len); g.stroke()
    }
    if (point) {
        // the profile lines themselves, faint, across the whole map
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.setLineDash([4, 4])
        g.beginPath(); g.moveTo(x0, PY(point[1])); g.lineTo(x0 + pw, PY(point[1]))
        g.moveTo(PX(point[0]), y0); g.lineTo(PX(point[0]), y0 + ph); g.stroke(); g.setLineDash([])
        cross(point, '#ffffff', 8)
    }
    if (hover) { g.beginPath(); g.arc(PX(hover[0]), PY(hover[1]), 4, 0, 2 * Math.PI); g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.stroke() }
    return {}
}

/** An offscreen canvas where there is one, a detached element where not. */
function offscreen(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    return c
}

/** The map point [a, b] at CSS pixel (px, py) of a drawn map, or null off it. */
export function heatmapAt(L, px, py) {
    if (!L || px < L.x0 || px > L.x0 + L.pw || py < L.y0 || py > L.y0 + L.ph) return null
    return [L.range.a[0] + (px - L.x0) / L.s, L.range.b[0] + (L.y0 + L.ph - py) / L.s]
}
