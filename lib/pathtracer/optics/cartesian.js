//======================================================================================================================
// THE CARTESIAN INTENSITY CHART -- I against gamma, the same C-plane curves as the polar diagram
// (polar.js), for when the polar diagram cannot show them: a 5-degree beam is a needle there, its
// width unreadable. Here the angle axis ZOOMS to where the light is.
//
//   const L = drawCartesian(canvas, { curves, unit: 'cd', log: false, span: 0, levels, hover: 1.2 })
//   cartesianAngleAt(L, x, y)      // the signed angle under the pointer, CSS pixels
//
// THE ANGLE AXIS is signed, as the polar diagram's: + for the C half-plane, - for C + 180, so a
// plane's curve is one line through gamma = 0 and an asymmetric beam shows as lopsided. Symmetric
// about 0 even when the light is not, so the two halves of every plane compare at a glance.
// `span` fixes its half-width in degrees; 0 picks it (angleSpan): the widest angle at which any
// curve is still above a floor -- half a percent of I max, or the bottom of the log scale -- and
// the next round span over that, with room to spare.
//
// THE VALUE AXIS is polar.js's scale (polarScale), so both charts put the same rings at the same
// values. Colours, dashes, the error band and the 50 % / 10 % levels are the polar diagram's too.
//
// WHERE THE GRID IS COARSE for the zoom -- a 3-degree beam on a 1-degree grid is five bins -- the
// line alone would pass for a measured shape. So when a curve has few points in view, each is
// marked: what is drawn between them is only a straight line.
//======================================================================================================================
import { polarScale, polarStyle, ringLabel, nearestPoint, POLAR_SURFACE } from './polar.js'

const INK = '#dde3e8', MUTED = '#8fa3b3', GRID = 'rgba(160,175,190,0.16)', AXIS = 'rgba(160,175,190,0.45)'
/** The spans the angle axis zooms between, degrees either side of the axis. */
export const ANGLE_SPANS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180]
/** Below this many points in view, each point of a curve is marked. */
export const MARK_BELOW = 60

/** THE HALF-WIDTH TO SHOW: the widest |a| where any curve is above the floor, and the next span in
 *  ANGLE_SPANS at least 10 % wider -- 180 when nothing is lit. */
export function angleSpan(curves, { log = false, decades = 3, floor = 0.005 } = {}) {
    const max = Math.max(0, ...curves.flatMap(c => c.points.map(p => p.I)))
    if (!(max > 0)) return 180
    const thr = log ? max / 10 ** decades : floor * max
    let ext = 0
    for (const c of curves) for (const p of c.points) if (p.I > thr) ext = Math.max(ext, Math.abs(p.a))
    return ANGLE_SPANS.find(s => s >= ext * 1.1) ?? 180
}

/** A round tick step for an axis of half-width `span` degrees: three to six ticks a side. */
export function angleStep(span) {
    return [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 30, 45].find(s => span / s <= 6) ?? 45
}

/** Draw. Returns the layout, for cartesianAngleAt. */
export function drawCartesian(canvas, { curves = [], unit = 'cd', log = false, decades = 3, span = 0, levels = [],
                                        hover = null, title = '' } = {}) {
    const dpr = globalThis.devicePixelRatio || 1
    const W = canvas.clientWidth || 400, H = canvas.clientHeight || 300
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    }
    const g = canvas.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = POLAR_SURFACE
    g.fillRect(0, 0, W, H)
    g.font = '11px ui-sans-serif, system-ui, sans-serif'

    const S = polarScale(Math.max(0, ...curves.flatMap(c => c.points.map(p => p.I + (p.se || 0)))), { log, decades })
    const half = span > 0 ? Math.min(180, span) : angleSpan(curves, { log, decades })
    const top = (title ? 22 : 8) + 16 * Math.max(1, curves.length) + 4       // title, then the legend's rows
    const x0 = 58, x1 = Math.max(x0 + 40, W - 14), y0 = Math.min(top, H - 80), y1 = Math.max(y0 + 40, H - 34)
    const X = a => x0 + (a + half) / (2 * half) * (x1 - x0)
    const Y = I => y1 - Math.min(1.05, S.r(I)) * (y1 - y0)

    if (title) { g.fillStyle = INK; g.font = '12px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(title, 8, 15); g.font = '11px ui-sans-serif, system-ui, sans-serif' }

    // THE GRID: value ticks (the polar diagram's rings) and angle ticks, recessive; the axes a little less
    g.lineWidth = 1; g.strokeStyle = GRID; g.fillStyle = MUTED
    g.textAlign = 'right'; g.textBaseline = 'middle'
    for (const v of S.rings) {
        const y = Y(v)
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke()
        g.fillText(ringLabel(v), x0 - 6, y)
    }
    g.fillText(unit, x0 - 6, y0 - 10)
    const step = angleStep(half)
    g.textAlign = 'center'; g.textBaseline = 'top'
    for (let k = -Math.floor(half / step + 1e-9); k * step <= half + 1e-9; k++) {
        const a = k * step, x = X(a)
        g.strokeStyle = a === 0 ? AXIS : GRID
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke()
        g.fillStyle = MUTED
        g.fillText(`${+Math.abs(a).toFixed(2)}°`, x, y1 + 5)
    }
    g.strokeStyle = AXIS
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.lineTo(x1, y1); g.stroke()
    // which half of each plane is which: the axis is signed
    g.fillStyle = MUTED; g.textBaseline = 'top'
    g.textAlign = 'left'; g.fillText('← C + 180 half', x0, y1 + 19)
    g.textAlign = 'right'; g.fillText('C half →', x1, y1 + 19)

    // LEVELS: 50 % and 10 % of I max, dashed across, labelled at the right end
    g.setLineDash([3, 4]); g.strokeStyle = 'rgba(221,227,232,0.45)'; g.textBaseline = 'bottom'; g.textAlign = 'right'
    for (const L of levels) {
        if (!(L.at > 0) || !(S.r(L.at) > 0)) continue
        const y = Y(L.at)
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke()
        g.fillStyle = MUTED; g.fillText(L.label, x1 - 2, y - 2)
    }
    g.setLineDash([])

    // THE CURVES, clipped to the plot: the band, the line, and marks where the points are few
    g.save()
    g.beginPath(); g.rect(x0, y0 - 4, x1 - x0, y1 - y0 + 4); g.clip()
    curves.forEach((c, k) => {
        const st = polarStyle(k)
        // one point either side of the range too, so the line runs to the edge rather than stopping short
        const pts = c.points.filter((p, i, a) => Math.abs(p.a) <= half
            || (a[i + 1] && Math.abs(a[i + 1].a) <= half) || (a[i - 1] && Math.abs(a[i - 1].a) <= half))
        if (pts.some(p => p.se > 0)) {
            g.beginPath()
            pts.forEach((p, i) => { const x = X(p.a), y = Y(p.I + p.se); i ? g.lineTo(x, y) : g.moveTo(x, y) })
            for (let i = pts.length - 1; i >= 0; i--) g.lineTo(X(pts[i].a), Y(Math.max(0, pts[i].I - pts[i].se)))
            g.closePath(); g.globalAlpha = 0.22; g.fillStyle = st.colour; g.fill(); g.globalAlpha = 1
        }
        g.beginPath()
        pts.forEach((p, i) => { const x = X(p.a), y = Y(p.I); i ? g.lineTo(x, y) : g.moveTo(x, y) })
        g.strokeStyle = st.colour; g.lineWidth = 2; g.setLineDash(st.dash); g.lineJoin = 'round'; g.stroke()
        g.setLineDash([])
        if (pts.length < MARK_BELOW) {
            g.fillStyle = st.colour
            for (const p of pts) { g.beginPath(); g.arc(X(p.a), Y(p.I), 2.5, 0, 2 * Math.PI); g.fill() }
        }
    })
    g.restore()

    // THE HOVER: a vertical line, and a dot on each curve's NEAREST POINT -- a bin's value, the one
    // the page's readout prints, not the straight line between two of them
    if (hover != null && Math.abs(hover) <= half) {
        const x = X(hover)
        g.strokeStyle = 'rgba(221,227,232,0.6)'; g.lineWidth = 1
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke()
        curves.forEach((c, k) => {
            const p = nearestPoint(c.points, hover)
            if (!p) return
            g.beginPath(); g.arc(X(p.a), Y(p.I), 4, 0, 2 * Math.PI)
            g.fillStyle = polarStyle(k).colour; g.fill()
            g.lineWidth = 2; g.strokeStyle = POLAR_SURFACE; g.stroke()
        })
    }

    // THE LEGEND, above the plot on the right: the curve's stroke and its name in ink
    g.textAlign = 'right'; g.textBaseline = 'middle'
    curves.forEach((c, k) => {
        const st = polarStyle(k), y = (title ? 22 : 8) + 8 + k * 16, x = W - 8
        g.fillStyle = INK; g.fillText(c.label, x - 30, y)
        g.strokeStyle = st.colour; g.lineWidth = 2; g.setLineDash(st.dash)
        g.beginPath(); g.moveTo(x - 24, y); g.lineTo(x, y); g.stroke(); g.setLineDash([])
    })
    return { x0, x1, y0, y1, span: half, scale: S }
}

/** The signed angle (degrees) at CSS pixel (x, y) of a drawn chart, or null outside its plot. */
export function cartesianAngleAt(L, x, y) {
    if (!L || x < L.x0 || x > L.x1 || y < L.y0 - 8 || y > L.y1 + 8) return null
    return (x - L.x0) / (L.x1 - L.x0) * 2 * L.span - L.span
}
