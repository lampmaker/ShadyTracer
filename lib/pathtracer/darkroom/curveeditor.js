//======================================================================================================================
// THE CURVES EDITOR (0.79.0) -- four curves drawn and moved by hand, in the Darkroom's side column.
//
// What a person does with it, as in any image editor: a tab picks the curve (Master, then red, green, blue); a click
// on the square adds a point there and drags it; a point is dragged; a double-click on a point, or a drag out of the
// square, takes it away; the two ends move but stay. "Luminance" puts the master curve on the luma alone, so hues
// keep (core/rendertoscreen.js darkroomFinish). Behind the curve, faint, the histogram of what a save writes -- the
// picture's luma under Master, a channel's under its own curve. The curve drawn is curves.js's, the one baked.
//
//   const E = makeCurveEditor(host, { get, set, getLuma, setLuma, onChange })
//     get() / set(curves)        the settings' curves ({ m, r, g, b }); set is given a new object, never the old edited
//     getLuma() / setLuma(on)    the luminance mode
//     onChange()                 after each change (a drag calls it as it moves)
//   E.histogram(bins)            the bins to draw behind (develop.js histogram), or null
//   E.redraw()                   after the settings changed from elsewhere (a reset, a preset, undo)
//
// lib/pathtracer/test/darkroomtools.check.mjs drives it in headless Chromium.
//======================================================================================================================

import { CHANNELS, normalizeCurve, curveFunction, MAX_POINTS, MIN_GAP } from './curves.js'
import { HIST_BINS } from '../core/rendertoscreen.js'

const TABS = [['m', 'Master', '#d6dde3'], ['r', 'R', '#ff6b6b'], ['g', 'G', '#5fd36b'], ['b', 'B', '#6b9bff']]
const BIN_OF = { m: 3, r: 0, g: 1, b: 2 }
const HIT = 8              // CSS pixels: a press this near a point takes it
const OUT = 24             // CSS pixels out of the square: a point dragged this far goes

export function makeCurveEditor(host, { get, set, getLuma = () => false, setLuma = () => { }, onChange = () => { } }) {
    const wrap = document.createElement('div')
    Object.assign(wrap.style, { padding: '4px 8px 6px', display: 'flex', flexDirection: 'column', gap: '4px' })
    const bar = document.createElement('div')
    Object.assign(bar.style, { display: 'flex', alignItems: 'center', gap: '2px' })
    const tabs = TABS.map(([k, label, colour]) => {
        const b = document.createElement('button')
        b.type = 'button'; b.textContent = label; b.dataset.curve = k
        Object.assign(b.style, { font: '11px/1 Arial, sans-serif', padding: '4px 7px', border: '0', borderRadius: '3px', cursor: 'pointer',
                                 background: 'transparent', color: colour })
        b.onclick = () => { active = k; paintTabs(); draw() }
        bar.append(b)
        return b
    })
    const lumaL = document.createElement('label')
    Object.assign(lumaL.style, { marginLeft: 'auto', font: '11px/1 Arial, sans-serif', color: '#b9c4cd', display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' })
    lumaL.title = 'The master curve on the luma alone: hues kept'
    const luma = document.createElement('input')
    luma.type = 'checkbox'; luma.dataset.curve = 'luma'
    luma.onchange = () => { setLuma(luma.checked); onChange() }
    lumaL.append(luma, document.createTextNode('luminance'))
    bar.append(lumaL)
    const canvas = document.createElement('canvas')
    canvas.dataset.curve = 'canvas'
    Object.assign(canvas.style, { display: 'block', width: '100%', aspectRatio: '1', borderRadius: '3px', cursor: 'crosshair', touchAction: 'none' })
    wrap.append(bar, canvas)
    host.append(wrap)

    let active = 'm', bins = null, drag = null
    const paintTabs = () => tabs.forEach(b => Object.assign(b.style, b.dataset.curve === active
        ? { background: 'rgba(120,150,175,0.32)' } : { background: 'transparent' }))
    const points = () => normalizeCurve(get()?.[active])
    const write = pts => {
        const all = { ...Object.fromEntries(CHANNELS.map(k => [k, normalizeCurve(get()?.[k])])), [active]: pts }
        set(all)
        onChange()
    }

    // the square in device pixels, with a margin so a point at an end can still be grabbed
    const geom = () => {
        const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(canvas.clientWidth * dpr))
        if (canvas.width !== w || canvas.height !== w) { canvas.width = w; canvas.height = w }
        const m = 6 * dpr
        return { dpr, w, m, s: w - 2 * m }
    }
    const toPx = ([x, y], g) => [g.m + x * g.s, g.m + (1 - y) * g.s]
    const fromEvent = e => {
        const r = canvas.getBoundingClientRect(), g = geom()
        const px = (e.clientX - r.left) * g.dpr, py = (e.clientY - r.top) * g.dpr
        return { x: (px - g.m) / g.s, y: 1 - (py - g.m) / g.s, outBy: Math.max(-(px - g.m), px - g.m - g.s, -(py - g.m), py - g.m - g.s) / g.dpr }
    }

    function draw() {
        const g = geom(), c = canvas.getContext('2d')
        c.fillStyle = '#111'; c.fillRect(0, 0, g.w, g.w)
        // the histogram, faint
        if (bins) {
            const off = BIN_OF[active] * HIST_BINS
            let peak = 1
            for (let i = 1; i < HIST_BINS - 1; i++) peak = Math.max(peak, bins[off + i])
            c.fillStyle = 'rgba(150,160,170,0.18)'
            c.beginPath(); c.moveTo(g.m, g.m + g.s)
            for (let i = 0; i < HIST_BINS; i++) c.lineTo(g.m + i / (HIST_BINS - 1) * g.s, g.m + g.s - Math.min(1, bins[off + i] / peak) * g.s)
            c.lineTo(g.m + g.s, g.m + g.s); c.closePath(); c.fill()
        }
        // quarters and the straight line
        c.strokeStyle = 'rgba(160,175,190,0.15)'; c.lineWidth = 1
        for (let i = 1; i < 4; i++) {
            c.beginPath(); c.moveTo(g.m + i / 4 * g.s, g.m); c.lineTo(g.m + i / 4 * g.s, g.m + g.s); c.stroke()
            c.beginPath(); c.moveTo(g.m, g.m + i / 4 * g.s); c.lineTo(g.m + g.s, g.m + i / 4 * g.s); c.stroke()
        }
        c.beginPath(); c.moveTo(g.m, g.m + g.s); c.lineTo(g.m + g.s, g.m); c.stroke()
        // the other curves, faint, then this one
        const colour = Object.fromEntries(TABS.map(t => [t[0], t[2]]))
        for (const k of [...CHANNELS.filter(k => k !== active), active]) {
            const f = curveFunction(normalizeCurve(get()?.[k]))
            c.strokeStyle = colour[k]; c.globalAlpha = k === active ? 1 : 0.25; c.lineWidth = (k === active ? 1.6 : 1) * g.dpr
            c.beginPath()
            for (let i = 0; i <= 256; i++) { const [px, py] = toPx([i / 256, f(i / 256)], g); i ? c.lineTo(px, py) : c.moveTo(px, py) }
            c.stroke()
        }
        c.globalAlpha = 1
        points().forEach((p, i) => {
            if (drag?.gone && drag.index === i) return
            const [px, py] = toPx(p, g)
            c.fillStyle = drag?.index === i ? '#fff' : '#111'; c.strokeStyle = colour[active]; c.lineWidth = 1.5 * g.dpr
            c.beginPath(); c.arc(px, py, 4 * g.dpr, 0, Math.PI * 2); c.fill(); c.stroke()
        })
        luma.checked = !!getLuma()
    }

    canvas.addEventListener('pointerdown', e => {
        if (e.button !== 0) return
        const at = fromEvent(e), pts = points(), g = geom()
        let index = pts.findIndex(p => { const [px, py] = toPx(p, g), r = canvas.getBoundingClientRect()
            return Math.hypot((e.clientX - r.left) * g.dpr - px, (e.clientY - r.top) * g.dpr - py) <= HIT * g.dpr })
        if (index < 0) {
            // a new point where the press is -- not between two points closer than the gap, and not past the limit
            if (pts.length >= MAX_POINTS) return
            const x = Math.min(1, Math.max(0, at.x)), y = Math.min(1, Math.max(0, at.y))
            if (pts.some(p => Math.abs(p[0] - x) < MIN_GAP)) return
            const next = [...pts, [x, y]].sort((a, b) => a[0] - b[0])
            index = next.findIndex(p => p[0] === x && p[1] === y)
            write(next)
        }
        drag = { index, gone: false }
        try { canvas.setPointerCapture(e.pointerId) } catch { }
        draw()
        e.preventDefault()
    })
    canvas.addEventListener('pointermove', e => {
        if (!drag) return
        const at = fromEvent(e), pts = points(), i = drag.index, last = pts.length - 1
        const end = i === 0 || i === last
        // out of the square by enough: an inner point goes (shown gone; taken away when let go)
        drag.gone = !end && at.outBy > OUT
        if (drag.gone) { draw(); return }
        const lo = i === 0 ? 0 : pts[i - 1][0] + MIN_GAP, hi = i === last ? 1 : pts[i + 1][0] - MIN_GAP
        const p = [Math.min(hi, Math.max(lo, at.x)), Math.min(1, Math.max(0, at.y))]
        if (p[0] === pts[i][0] && p[1] === pts[i][1]) return
        const next = pts.map((q, k) => k === i ? p : q)
        write(next)
        draw()
    })
    const end = e => {
        if (!drag) return
        const d = drag
        drag = null
        try { canvas.releasePointerCapture(e.pointerId) } catch { }
        if (d.gone) write(points().filter((_, k) => k !== d.index))
        draw()
    }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    canvas.addEventListener('dblclick', e => {
        const pts = points(), g = geom(), r = canvas.getBoundingClientRect()
        const i = pts.findIndex(p => { const [px, py] = toPx(p, g); return Math.hypot((e.clientX - r.left) * g.dpr - px, (e.clientY - r.top) * g.dpr - py) <= HIT * g.dpr })
        if (i > 0 && i < pts.length - 1) { write(pts.filter((_, k) => k !== i)); draw() }
    })
    try { new ResizeObserver(() => draw()).observe(canvas) } catch { }
    paintTabs()
    draw()
    return {
        element: wrap,
        histogram(b) { bins = b; draw() },
        redraw: draw,
        get active() { return active },
    }
}
