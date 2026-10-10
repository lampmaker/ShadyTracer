//======================================================================================================================
// THE POLAR DIAGRAM -- luminous intensity in C planes, drawn on a 2D canvas the way a luminaire's
// datasheet draws it: gamma = 0 pointing DOWN (the light's axis, where a downlight shines), each C plane
// as one closed curve through both of its halves -- C on the right, C + 180 on the left.
//
//   const L = drawPolar(canvas, { curves: [{ label, points }], unit: 'cd', log: false, view: 'auto',
//                                 levels: [{ at: 0.5 * Imax, label: '50 %' }], hover: 12.5 })
//   polarAngleAt(L, x, y)          // the signed angle under the pointer, CSS pixels, for the hover
//
// `points` as farfield.js planeCurve gives them: { a, I, se }, a signed in degrees (-180..180).
// Nothing here knows about optics: a curve is angles and values.
//
// COLOURS: three hues checked for this dark surface (the dataviz palette's dark steps, blue / orange /
// aqua: every pair clear for colour-blind readers). A fourth plane repeats a hue, so from the fourth on
// the line is DASHED as well -- the pair is told apart by pattern, not by colour alone -- and the
// legend names every curve. Text is in the panel's ink, never in a series colour.
//
// LOG SCALE: a beam's tail is orders of magnitude under its peak, invisible on a linear scale. Log
// shows `decades` decades under the top ring; anything below is drawn at the centre.
//======================================================================================================================

export const POLAR_COLOURS = ['#3987e5', '#d95926', '#199e70']
export const POLAR_DASHES = [[], [7, 4], [2, 3]]
const INK = '#dde3e8', MUTED = '#8fa3b3', GRID = 'rgba(160,175,190,0.16)', GRID_STRONG = 'rgba(160,175,190,0.32)'
export const POLAR_SURFACE = '#16191c'

/** A round step for about `n` rings up to `max`: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(max, n = 4) {
    if (!(max > 0)) return 1
    const raw = max / n, p = 10 ** Math.floor(Math.log10(raw))
    return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw)
}

/**
 * THE RADIAL SCALE: rings (values), the top ring, and r(I), 0 at the centre to 1 at the top ring.
 * Linear: round rings from 0. Log: a ring per decade, `decades` of them under the top.
 */
export function polarScale(max, { log = false, decades = 3 } = {}) {
    if (!(max > 0)) max = 1
    if (log) {
        const top = 10 ** Math.ceil(Math.log10(max) - 1e-9), bottom = top / 10 ** decades
        const rings = []
        for (let v = bottom * 10; v <= top * 1.0001; v *= 10) rings.push(v)
        return { rings, top, log, r: I => I > bottom ? Math.min(1.05, Math.log10(I / bottom) / decades) : 0 }
    }
    const step = niceStep(max)
    const top = Math.ceil(max / step - 1e-9) * step
    const rings = []
    for (let v = step; v <= top * 1.0001; v += step) rings.push(v)
    return { rings, top, log, r: I => Math.max(0, I) / top }
}

/** A number for a ring label: short, no trailing zeros. */
// 0 is said as 0: the value charts' axes start there, and toExponential makes it "0e0"
export const ringLabel = v => v === 0 ? '0' : v >= 1e4 || v < 1e-2 ? v.toExponential(0).replace('e+', 'e') : +v.toPrecision(3) + ''

/** The curve's colour and dash for plane k. */
export const polarStyle = k => ({ colour: POLAR_COLOURS[k % 3], dash: POLAR_DASHES[Math.floor(k / 3) % 3] })

/** Draw. Returns the layout, for polarAngleAt. */
export function drawPolar(canvas, { curves = [], unit = 'cd', log = false, decades = 3, view = 'auto', levels = [],
                                    hover = null, title = '' } = {}) {
    const dpr = globalThis.devicePixelRatio || 1
    const W = canvas.clientWidth || 400, H = canvas.clientHeight || 400
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    }
    const g = canvas.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = POLAR_SURFACE
    g.fillRect(0, 0, W, H)

    // LOWER HALF when nothing goes above 90 degrees (auto): a downlight's diagram is a half circle,
    // and drawing the empty upper half would halve the size of the part that matters
    const upper = curves.some(c => c.points.some(p => Math.abs(p.a) > 90.0001 && p.I > 0))
    const half = view === 'lower' || (view === 'auto' && !upper)
    const max = Math.max(0, ...curves.flatMap(c => c.points.map(p => p.I + (p.se || 0))))
    const S = polarScale(max, { log, decades })
    const m = 34                                            // room for the angle labels
    const top = title ? 22 : 8
    const R = half ? Math.max(10, Math.min(W / 2 - m, H - top - m - 8)) : Math.max(10, Math.min(W / 2 - m, (H - top) / 2 - m))
    const cx = W / 2, cy = half ? top + 8 : top + (H - top) / 2
    const at = (a, r) => [cx + r * R * Math.sin(a * Math.PI / 180), cy + r * R * Math.cos(a * Math.PI / 180)]
    const aMax = half ? 90 : 180

    if (title) { g.fillStyle = INK; g.font = '12px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(title, 8, 15) }

    // THE GRID: rings, and spokes every 15 degrees (labelled every 30)
    g.lineWidth = 1
    const arc = r => { g.beginPath(); for (let a = -aMax; a <= aMax + 1e-9; a += 2) { const [x, y] = at(a, r); a === -aMax ? g.moveTo(x, y) : g.lineTo(x, y) } g.stroke() }
    g.strokeStyle = GRID
    for (const v of S.rings) arc(S.r(v))
    g.strokeStyle = GRID_STRONG
    arc(1)
    g.font = '11px ui-sans-serif, system-ui, sans-serif'
    for (let a = -aMax; a <= aMax + 1e-9; a += 15) {
        g.strokeStyle = a % 90 === 0 ? GRID_STRONG : GRID
        const [x, y] = at(a, 1)
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke()
        if (a % 30 === 0 && !(Math.abs(a) === 180 && a < 0)) {
            const [lx, ly] = at(a, 1 + 16 / R)
            g.fillStyle = MUTED; g.textAlign = 'center'; g.textBaseline = 'middle'
            g.fillText(`${Math.abs(a)}°`, lx, ly)
        }
    }
    // ring values along the 0 degree spoke's right side, in the unit
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = MUTED
    for (const v of S.rings) { const [x, y] = at(0, S.r(v)); g.fillText(ringLabel(v), x + 4, y - 7) }
    { const [x, y] = at(0, 1); g.fillText(unit, x + 4, y + 8) }

    // LEVELS (beam 50 %, field 10 % of I max): dashed rings, labelled at the right end
    g.setLineDash([3, 4]); g.strokeStyle = 'rgba(221,227,232,0.45)'
    for (const L of levels) {
        if (!(L.at > 0)) continue
        const r = S.r(L.at)
        if (!(r > 0)) continue
        arc(r)
        const [x, y] = at(half ? 90 : 135, r)
        g.fillStyle = MUTED; g.textAlign = 'left'; g.fillText(L.label, x + 3, y + (half ? -7 : 0))
    }
    g.setLineDash([])

    // THE CURVES: the error band first (translucent), then the line over it
    const shown = pts => pts.filter(p => Math.abs(p.a) <= aMax + 1e-9)
    curves.forEach((c, k) => {
        const st = polarStyle(k), pts = shown(c.points)
        if (pts.some(p => p.se > 0)) {
            g.beginPath()
            pts.forEach((p, i) => { const [x, y] = at(p.a, S.r(p.I + p.se)); i ? g.lineTo(x, y) : g.moveTo(x, y) })
            for (let i = pts.length - 1; i >= 0; i--) { const [x, y] = at(pts[i].a, S.r(Math.max(0, pts[i].I - pts[i].se))); g.lineTo(x, y) }
            g.closePath(); g.globalAlpha = 0.22; g.fillStyle = st.colour; g.fill(); g.globalAlpha = 1
        }
        g.beginPath()
        pts.forEach((p, i) => { const [x, y] = at(p.a, S.r(p.I)); i ? g.lineTo(x, y) : g.moveTo(x, y) })
        g.strokeStyle = st.colour; g.lineWidth = 2; g.setLineDash(st.dash); g.lineJoin = 'round'; g.stroke()
        g.setLineDash([])
    })

    // THE HOVER: the spoke under the pointer, and a dot where each curve crosses it
    if (hover != null && Math.abs(hover) <= aMax) {
        const [x, y] = at(hover, 1)
        g.strokeStyle = 'rgba(221,227,232,0.6)'; g.lineWidth = 1
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke()
        curves.forEach((c, k) => {
            const p = nearestPoint(c.points, hover)
            if (!p) return
            const [px, py] = at(p.a, S.r(p.I))
            g.beginPath(); g.arc(px, py, 4, 0, 2 * Math.PI)
            g.fillStyle = polarStyle(k).colour; g.fill()
            g.lineWidth = 2; g.strokeStyle = POLAR_SURFACE; g.stroke()
        })
    }

    // THE LEGEND, top right: a short stroke in the curve's style and its name in ink
    g.font = '11px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle'
    curves.forEach((c, k) => {
        const st = polarStyle(k), y = top + 8 + k * 16, x = W - 8
        g.fillStyle = INK; g.fillText(c.label, x - 30, y)
        g.strokeStyle = st.colour; g.lineWidth = 2; g.setLineDash(st.dash)
        g.beginPath(); g.moveTo(x - 24, y); g.lineTo(x, y); g.stroke(); g.setLineDash([])
    })
    return { cx, cy, R, half, aMax, scale: S }
}

/** The point of a curve nearest a signed angle. */
export function nearestPoint(points, a) {
    let best = null
    for (const p of points) if (!best || Math.abs(p.a - a) < Math.abs(best.a - a)) best = p
    return best
}

/** The signed angle (degrees) at CSS pixel (x, y) of a drawn diagram, or null outside it. */
export function polarAngleAt(L, x, y) {
    if (!L) return null
    const dx = x - L.cx, dy = y - L.cy
    if (Math.hypot(dx, dy) > L.R * 1.15) return null
    const a = Math.atan2(dx, dy) * 180 / Math.PI            // 0 down, + to the right
    return Math.abs(a) <= L.aMax ? a : null
}
