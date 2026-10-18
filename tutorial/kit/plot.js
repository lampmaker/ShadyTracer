//======================================================================================================================
// A SMALL CHART inside a figure, drawn with the pen's colours and faces so it matches the diagram beside it: linear
// axes, a few ticks, and series as lines, dots or bars, each point optionally with an error bar. Pixel space: `rect`
// is { x, y, w, h } in the canvas's CSS pixels. One scale places marks, ticks and labels alike.
//======================================================================================================================

const nice = (lo, hi, n = 4) => {
    const span = hi - lo || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag
    const out = []
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 * span; v += step) out.push(+v.toPrecision(12))
    return out
}

/**
 * @param pen     the figure's pen
 * @param rect    { x, y, w, h } pixels
 * @param o       { x: [lo, hi], y: [lo, hi], xlabel, ylabel, series: [{ pts: [[x, y, err]], role, kind, w, dash, name }], fmt,
 *                  hover, hoverX, hoverY }: the pointer over the chart reads the nearest points (below); a series'
 *                  `errorBars: false` carries its points' errors for that readout without drawing them
 */
export function plot(pen, rect, o) {
    const { ctx } = pen
    const [x0, x1] = o.x, [y0, y1] = o.y
    const X = v => rect.x + (v - x0) / (x1 - x0) * rect.w
    const Y = v => rect.y + rect.h - (v - y0) / (y1 - y0) * rect.h
    const fmt = o.fmt ?? (v => String(+v.toPrecision(3)))
    ctx.save()
    ctx.font = `500 11px ${pen.theme.fonts.mono}`; ctx.fillStyle = pen.col('soft'); ctx.strokeStyle = pen.col('faint'); ctx.lineWidth = 1
    // axes and ticks
    ctx.beginPath(); ctx.moveTo(rect.x, rect.y); ctx.lineTo(rect.x, rect.y + rect.h); ctx.lineTo(rect.x + rect.w, rect.y + rect.h); ctx.stroke()
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    for (const v of (o.yticks ?? nice(y0, y1, 3))) {
        const y = Y(v); if (y < rect.y - 1 || y > rect.y + rect.h + 1) continue
        ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke(); ctx.globalAlpha = 1
        ctx.fillText(fmt(v), rect.x - 5, y)
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    for (const v of (o.xticks ?? nice(x0, x1, 4))) {
        const x = X(v); if (x < rect.x - 1 || x > rect.x + rect.w + 1) continue
        ctx.beginPath(); ctx.moveTo(x, rect.y + rect.h); ctx.lineTo(x, rect.y + rect.h + 4); ctx.stroke()
        ctx.fillText(fmt(v), x, rect.y + rect.h + 6)
    }
    if (o.xlabel) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xlabel, rect.x + rect.w, rect.y + rect.h - 4) }
    if (o.ylabel) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(o.ylabel, rect.x + 6, rect.y) }
    // the series, clipped to the plot
    ctx.beginPath(); ctx.rect(rect.x, rect.y - 2, rect.w + 2, rect.h + 4); ctx.clip()
    for (const s of o.series ?? []) {
        const c = pen.col(s.role ?? 'ink')
        ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = (s.w ?? 1.4) * pen.theme.width / 1.5
        if (s.kind === 'bars') {
            const bw = Math.max(1, rect.w / Math.max(1, s.pts.length) * 0.8)
            for (const [x, y] of s.pts) { ctx.globalAlpha = 0.75; ctx.fillRect(X(x) - bw / 2, Y(y), bw, Y(Math.max(y0, 0)) - Y(y)) }
            ctx.globalAlpha = 1
        } else if (s.kind === 'dots') {
            for (const [x, y] of s.pts) { ctx.beginPath(); ctx.arc(X(x), Y(y), s.r ?? 2.4, 0, 6.2832); ctx.fill() }
        } else {
            ctx.setLineDash(s.dash ?? [])
            ctx.beginPath(); s.pts.forEach(([x, y], i) => i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))); ctx.stroke()
            ctx.setLineDash([])
        }
        if (s.errorBars !== false && s.pts.some(p => p[2] > 0)) {
            ctx.lineWidth = 1; ctx.globalAlpha = 0.7; ctx.beginPath()
            for (const [x, y, e] of s.pts) if (e > 0) { ctx.moveTo(X(x), Y(y - e)); ctx.lineTo(X(x), Y(y + e)) }
            ctx.stroke(); ctx.globalAlpha = 1
        }
    }
    ctx.restore()

    /* THE POINTER: each series' point nearest it along x, ringed and read out in a box beside it. `o.hover` false turns
       it off; `o.hoverX(x)` writes the box's first line, `o.hoverY(y)` each value; a series' `name` heads its line.
       A series of two points is a reference line (a target, the true value): read only if it has a name. A series with
       `tip: false` is never read (the bounds of a band whose middle is read already). */
    if (o.hover !== false) {
        const p = pen.hover(rect)
        if (p) {
            const num = v => Math.abs(v) >= 1000 ? v.toFixed(0) : String(+v.toPrecision(3))
            const tx = o.hoverX ?? (v => `x ${num(v)}`), ty = o.hoverY ?? num, lines = []
            ctx.save()
            for (const s of (o.series ?? []).filter(s => s.tip !== false && (s.pts.length > 2 || s.name))) {
                let q = null, bd = Infinity
                for (const r of s.pts) { const d = Math.abs(X(r[0]) - p.x); if (d < bd) { bd = d; q = r } }
                if (!q || !Number.isFinite(q[1])) continue
                if (!lines.length) {
                    lines.push(tx(q[0]))
                    ctx.strokeStyle = pen.col('soft'); ctx.lineWidth = 1; ctx.setLineDash([2, 3])
                    ctx.beginPath(); ctx.moveTo(X(q[0]), rect.y); ctx.lineTo(X(q[0]), rect.y + rect.h); ctx.stroke(); ctx.setLineDash([])
                }
                ctx.strokeStyle = pen.col(s.role ?? 'ink'); ctx.lineWidth = 1.6
                ctx.beginPath(); ctx.arc(X(q[0]), Math.min(rect.y + rect.h, Math.max(rect.y, Y(q[1]))), 4.5, 0, 6.2832); ctx.stroke()
                lines.push(`${s.name ? s.name + ' ' : ''}${ty(q[1])}${q[2] > 0 ? ' ± ' + ty(q[2]) : ''}`)
            }
            ctx.restore()
            pen.tip(p.x, p.y, lines)
        }
    }
    return { X, Y }
}
