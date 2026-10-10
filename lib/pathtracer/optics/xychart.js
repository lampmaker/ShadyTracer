//======================================================================================================================
// A LINE CHART, y against x -- the illuminance profiles, the radial profile and encircled flux
// (optics/illum.js), drawn the way the intensity charts are: the same colours and dashes
// (polar.js polarStyle), the error band, dashed reference lines, a hover line with a dot on each
// series' nearest point, the legend top right, recessive grid.
//
//   const L = drawXY(canvas, { series: [{ label, points: [{ x, y, se }] }], xLabel: 'x, mm', yUnit: 'lx',
//                              levels: [{ at, label }], marks: [{ x, label }], hover: 3.2, title })
//   xyAt(L, px, py)                // the x under the pointer, CSS pixels
//
// y runs from 0 up to a round value over the largest (or `yMax`); x over the points' extent (or
// `xRange`). A chart of a share (encircled flux) passes yMax 1 and yFormat for percent.
// `yMin: 'auto'` starts the axis at a round value under the smallest instead of 0: a CCT or a
// chromaticity lives far from 0, and drawn from 0 it is a flat line (UI_PLAN.md section 7). A point
// with no value (y NaN: a colour map's dim cell) is a gap in its line, not a drop to 0.
//======================================================================================================================
import { niceStep, polarStyle, ringLabel, POLAR_SURFACE } from './polar.js'

const INK = '#dde3e8', MUTED = '#8fa3b3', GRID = 'rgba(160,175,190,0.16)', AXIS = 'rgba(160,175,190,0.45)'
/* A tick label that can be negative: ringLabel is for magnitudes, and gave every negative number its
   exponent form (a profile's -30 mm read "-3e1") */
const signed = v => Math.abs(v) < 1e-12 ? '0' : (v < 0 ? '−' : '') + ringLabel(Math.abs(v))

/** Round ticks over [x0, x1]: about n of them. */
export function ticks(x0, x1, n = 5) {
    const step = niceStep(Math.max(1e-12, x1 - x0), n)
    const out = []
    for (let v = Math.ceil(x0 / step - 1e-9) * step; v <= x1 + step * 1e-9; v += step) out.push(+v.toPrecision(12))
    return out
}

/** The point of a series nearest x. */
export const nearestX = (points, x) => points.reduce((b, p) => (!b || Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b), null)

/** Draw. Returns the layout, for xyAt. */
export function drawXY(canvas, { series = [], xLabel = '', yUnit = '', yMax = null, yMin = 0, xRange = null, levels = [], marks = [],
                                 hover = null, title = '', yFormat = ringLabel } = {}) {
    const dpr = globalThis.devicePixelRatio || 1
    const W = canvas.clientWidth || 400, H = canvas.clientHeight || 260
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    }
    const g = canvas.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = POLAR_SURFACE
    g.fillRect(0, 0, W, H)
    g.font = '11px ui-sans-serif, system-ui, sans-serif'

    const all = series.flatMap(s => s.points).filter(p => Number.isFinite(p.y))
    const xs = all.map(p => p.x)
    const [xa, xb] = xRange ?? (xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1])
    const X0 = xa, X1 = xb > xa ? xb : xa + 1
    const auto = yMin === 'auto'
    const top = yMax ?? Math.max(auto ? -Infinity : 0, ...all.map(p => p.y + (p.se || 0)))
    const bottom = auto ? Math.min(...all.map(p => p.y - (p.se || 0))) : +yMin || 0
    const yStep = niceStep(top - bottom > 0 ? top - bottom : Math.abs(top) || 1, 4)
    const Y0v = auto ? (Number.isFinite(bottom) ? Math.floor(bottom / yStep + 1e-9) * yStep : 0) : bottom
    const Y1v = yMax ?? Math.max(Y0v + yStep, Math.ceil((Number.isFinite(top) ? top : 1) / yStep - 1e-9) * yStep)
    const head = (title ? 22 : 8) + 16 * Math.max(1, series.length) + 2
    const x0 = 58, x1 = Math.max(x0 + 40, W - 14), y0 = Math.min(head, H - 70), y1 = Math.max(y0 + 30, H - 34)
    const X = x => x0 + (x - X0) / (X1 - X0) * (x1 - x0)
    const Y = y => y1 - Math.min(1.05, Math.max(0, (y - Y0v) / (Y1v - Y0v))) * (y1 - y0)

    if (title) { g.fillStyle = INK; g.font = '12px ui-sans-serif, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(title, 8, 15); g.font = '11px ui-sans-serif, system-ui, sans-serif' }

    // THE GRID
    g.lineWidth = 1; g.strokeStyle = GRID; g.fillStyle = MUTED; g.textAlign = 'right'; g.textBaseline = 'middle'
    for (const v of ticks(Y0v, Y1v, 4)) {
        const y = Y(v)
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke()
        g.fillText(yFormat(v), x0 - 6, y)
    }
    if (yUnit) g.fillText(yUnit, x0 - 6, y0 - 10)
    g.textAlign = 'center'; g.textBaseline = 'top'
    for (const v of ticks(X0, X1, Math.max(3, Math.floor((x1 - x0) / 70)))) {
        const x = X(v)
        g.strokeStyle = GRID; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke()
        g.fillStyle = MUTED; g.fillText(signed(v), x, y1 + 5)
    }
    g.textAlign = 'right'; g.fillText(xLabel, x1, y1 + 19)
    g.strokeStyle = AXIS; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.lineTo(x1, y1); g.stroke()

    // REFERENCE LINES: levels across, marks up, dashed, labelled in muted ink
    g.setLineDash([3, 4]); g.strokeStyle = 'rgba(221,227,232,0.45)'; g.fillStyle = MUTED
    g.textAlign = 'right'; g.textBaseline = 'bottom'
    for (const L of levels) {
        if (!(L.at > Y0v)) continue
        const y = Y(L.at)
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke()
        g.fillText(L.label, x1 - 2, y - 2)
    }
    g.textAlign = 'left'; g.textBaseline = 'top'
    for (const M of marks) {
        if (M.x == null || M.x < X0 || M.x > X1) continue
        const x = X(M.x)
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke()
        g.fillText(M.label, x + 3, y0 + 2)
    }
    g.setLineDash([])

    // THE SERIES, clipped to the plot
    g.save()
    g.beginPath(); g.rect(x0, y0 - 4, x1 - x0, y1 - y0 + 4); g.clip()
    series.forEach((s, k) => {
        const st = polarStyle(k), pts = s.points
        if (pts.some(p => p.se > 0)) {
            g.beginPath()
            pts.forEach((p, i) => { const x = X(p.x), y = Y(p.y + (p.se || 0)); i ? g.lineTo(x, y) : g.moveTo(x, y) })
            for (let i = pts.length - 1; i >= 0; i--) g.lineTo(X(pts[i].x), Y(pts[i].y - (pts[i].se || 0)))
            g.closePath(); g.globalAlpha = 0.22; g.fillStyle = st.colour; g.fill(); g.globalAlpha = 1
        }
        g.beginPath()
        // a point with no value breaks the line: the next one starts a new piece
        let pen = false
        for (const p of pts) {
            if (!Number.isFinite(p.y)) { pen = false; continue }
            const x = X(p.x), y = Y(p.y)
            pen ? g.lineTo(x, y) : g.moveTo(x, y)
            pen = true
        }
        g.strokeStyle = st.colour; g.lineWidth = 2; g.setLineDash(st.dash); g.lineJoin = 'round'; g.stroke()
        g.setLineDash([])
    })
    g.restore()

    // THE HOVER
    if (hover != null && hover >= X0 && hover <= X1) {
        const x = X(hover)
        g.strokeStyle = 'rgba(221,227,232,0.6)'; g.lineWidth = 1
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke()
        series.forEach((s, k) => {
            const p = nearestX(s.points.filter(q => Number.isFinite(q.y)), hover)
            if (!p) return
            g.beginPath(); g.arc(X(p.x), Y(p.y), 4, 0, 2 * Math.PI)
            g.fillStyle = polarStyle(k).colour; g.fill()
            g.lineWidth = 2; g.strokeStyle = POLAR_SURFACE; g.stroke()
        })
    }

    // THE LEGEND
    g.textAlign = 'right'; g.textBaseline = 'middle'
    series.forEach((s, k) => {
        const st = polarStyle(k), y = (title ? 22 : 8) + 8 + k * 16, x = W - 8
        g.fillStyle = INK; g.fillText(s.label, x - 30, y)
        g.strokeStyle = st.colour; g.lineWidth = 2; g.setLineDash(st.dash)
        g.beginPath(); g.moveTo(x - 24, y); g.lineTo(x, y); g.stroke(); g.setLineDash([])
    })
    return { x0, x1, y0, y1, X0, X1 }
}

/** The x value at CSS pixel (px, py) of a drawn chart, or null outside its plot. */
export function xyAt(L, px, py) {
    if (!L || px < L.x0 || px > L.x1 || py < L.y0 - 8 || py > L.y1 + 8) return null
    return L.X0 + (px - L.x0) / (L.x1 - L.x0) * (L.X1 - L.X0)
}
