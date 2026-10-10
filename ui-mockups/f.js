//======================================================================================================================
// MOCKUP F -- ANALYSE: every chart a panel of its own; one Analysis pane with the data, the selected
// chart's settings and the results (UI_PLAN.md section 9, *The path*).
//
// Built on the application's own parts, so it looks as the application would: lib/shell (the dock, the
// menus, the presets), the property tables, and lib/pathtracer/optics's charts and arithmetic. The data is
// made up: mock.js's far field, and a detector map of hits whose colour runs from a warm centre to a cool
// halo, so the map's quantity switch (E, CCT, x, y) has something to show. Nothing is traced.
//======================================================================================================================
import { createShell } from '../lib/shell/shell.js'
import { PropertyTable } from '../lib/guistuff/propertytable/propertytable.js'
import { drawPolar, polarAngleAt, nearestPoint, polarStyle } from '../lib/pathtracer/optics/polar.js'
import { drawCartesian, cartesianAngleAt } from '../lib/pathtracer/optics/cartesian.js'
import { drawHeatmap, heatmapAt } from '../lib/pathtracer/optics/heatmap.js'
import { drawXY, xyAt, nearestX, ticks } from '../lib/pathtracer/optics/xychart.js'
import { intensity, planeCurve, farStats } from '../lib/pathtracer/optics/farfield.js'
import { detectorMap } from '../lib/pathtracer/optics/detmap.js'
import { profile, radial, encircled, isolux, peak, centroid, cellAt, rangeOfPoints, rangeOfView } from '../lib/pathtracer/optics/illum.js'
import { quantityMap, quantitiesOf, MAP_QUANTITIES } from '../lib/pathtracer/optics/quantities.js'
import { cctDuvToXy, xyToXYZ } from '../lib/pathtracer/core/colorimetry.js'
import { FAR, drawPicture } from './mock.js'

//----------------------------------------------------------------------------------------------------------------------
// THE DATA (made up)
//----------------------------------------------------------------------------------------------------------------------
/* a detector: a 60 x 40 mm screen, and a spot on it -- a flat-topped warm core in a cooler halo */
let seed = 7
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const warm = cctDuvToXy(3000, 0), cool = cctDuvToXy(6500, 0.002)
const HITS = Array.from({ length: 80000 }, () => {
    const r = Math.sqrt(-2 * Math.log(rnd() + 1e-12)), t = 2 * Math.PI * rnd()
    const core = rnd() < 0.55
    const rr = core ? 5 * Math.sqrt(rnd()) : 4.5 * r
    const f = Math.min(1, rr / 10), xy = [warm[0] + (cool[0] - warm[0]) * f, warm[1] + (cool[1] - warm[1]) * f]
    const flux = 0.16 / 80000
    return { pos: [rr * Math.cos(t) * 1.25 + 3, rr * Math.sin(t), 0], flux, tag: 3, xyz: xyToXYZ(xy[0], xy[1], flux) }
})
const SCREEN = [0, 1, 2, 3, 4, 5, 6, 7].map(c => [c & 1 ? 30 : -30, c & 2 ? 20 : -20, c & 4 ? 0.5 : -0.5])

//----------------------------------------------------------------------------------------------------------------------
// THE SETTINGS: the data's (one set, shared by the charts that show it) and each chart's own
//----------------------------------------------------------------------------------------------------------------------
const D = { rays: '2M', from: 'escaped', axis: 'LED', dG: 1, dC: 5,
            detector: 'Screen', area: 'detector', cells: 72, smooth: 'gauss', bw: 1.5, ran: new Date() }
const C = {
    polar: { planes: '0, 90', log: false, unit: 'cd', symmetry: false, view: 'auto' },
    igamma: { planes: '0, 90', log: false, span: 0 },
    map: { q: 'E', isolines: 'lux', zoom: null },
    profiles: { through: 'peak' },
    rings: { through: 'peak' },
    encircled: { through: 'peak' },
}
let clicked = null                     // where the map was last clicked, for 'click' as the profiles' point

//----------------------------------------------------------------------------------------------------------------------
// WHAT THE CHARTS DRAW, made again only when what they are made of changes
//----------------------------------------------------------------------------------------------------------------------
const planesOf = t => { const v = String(t).split(/[\s,;]+/).map(Number).filter(Number.isFinite); return v.length ? [...new Set(v)].slice(0, 9) : [0] }
const far = key => {
    const s = C[key]
    const R = intensity(FAR, { symmetry: s.symmetry ? 'rotational' : 'none', perKlm: s.unit === 'cd/klm' })
    const planes = planesOf(s.planes), S = farStats(FAR, R, planes)
    return { R, S, curves: planes.map(c => ({ label: `C${c}–C${(c + 180) % 360}`, points: planeCurve(R, c).points })),
             levels: [{ at: 0.5 * S.max.I, label: '50 %' }, { at: 0.1 * S.max.I, label: '10 %' }] }
}
let mapMemo = null
const baseMap = () => {
    const key = JSON.stringify([D.cells, D.smooth, D.bw, D.area, C.map.zoom])
    if (mapMemo?.key === key) return mapMemo.m
    const range = C.map.zoom ? rangeOfView(C.map.zoom) : D.area === 'detector' ? rangeOfPoints(SCREEN) : null
    const m = { ...detectorMap(HITS, { cells: D.cells, metresPerUnit: 0.001, smooth: D.smooth, bandwidth: D.bw, range }), lengthUnit: 'mm' }
    mapMemo = { key, m }
    return m
}
const pointOf = (m, how) => how === 'click' && clicked && cellAt(m, ...clicked) ? clicked : how === 'centroid' ? centroid(m) : peak(m)
const shown = () => {
    const m = baseMap(), key = quantitiesOf(m).includes(C.map.q) ? C.map.q : 'E'
    return { m, key, q: { ...quantityMap(m, key), digits: MAP_QUANTITIES[key].digits }, Q: MAP_QUANTITIES[key] }
}

//----------------------------------------------------------------------------------------------------------------------
// THE CHART PANELS: a canvas filling the panel, and the one line it says about the pointer
//----------------------------------------------------------------------------------------------------------------------
const hover = { angle: null, pos: null, x: null }      // shared: an angle for the far field, a place for the map's
const CHARTS = {}
const chart = (id, title, help, draw, move) => { CHARTS[id] = { id, title, help, draw, move } }
const fmt = v => v == null || !Number.isFinite(v) ? '–' : Math.abs(v) < 1e-6 ? '0' : Math.abs(v) >= 1e4 ? v.toExponential(2) : +v.toPrecision(4) + ''

chart('polar', 'Polar', 'Intensity against angle, in C planes, around the photometric axis.', (c, el) => {
    const F = far('polar')
    const L = drawPolar(c, { curves: F.curves, levels: F.levels, log: C.polar.log, view: C.polar.view, hover: hover.angle, unit: F.R.unit })
    el.readout.textContent = hover.angle == null ? '' : F.curves.map(k => { const p = nearestPoint(k.points, hover.angle); return `γ ${Math.abs(p.a).toFixed(1)}°: ${fmt(p.I)} ${F.R.unit}` }).join('  ·  ')
    return L
}, (L, x, y) => { hover.angle = polarAngleAt(L, x, y); redraw('polar', 'igamma') })
chart('igamma', 'I – γ', 'Intensity against γ, each C plane a line through C and C + 180.', (c, el) => {
    const F = far('igamma')
    const L = drawCartesian(c, { curves: F.curves, levels: F.levels, log: C.igamma.log, span: +C.igamma.span || 0, hover: hover.angle })
    el.readout.textContent = hover.angle == null ? '' : `γ ${hover.angle.toFixed(1)}°`
    return L
}, (L, x, y) => { hover.angle = cartesianAngleAt(L, x, y); redraw('polar', 'igamma') })
chart('map', 'Map · Screen', 'The detector\'s map: illuminance, or the colour of the light that arrived. Drag to zoom, double-click for the whole detector, click to set the profiles\' point.', (c, el) => {
    const { m, q, Q, key } = shown(), pt = pointOf(m, C.profiles.through)
    const isE = key === 'E'
    const levels = C.map.isolines === 'off' ? [] : C.map.isolines === 'relative' ? [0.1, 0.25, 0.5, 0.75, 0.9].map(f => isE ? f * q.hi : q.lo + f * (q.hi - q.lo))
        : ticks(isE ? 0 : q.lo, q.hi, 5).filter(v => v > (isE ? 0 : q.lo) && v < q.hi)
    const L = drawHeatmap(c, q, { contours: isolux(q, levels), point: pt, lengthUnit: 'mm', unit: q.unit, hover: hover.pos })
    const at = hover.pos && cellAt(q, ...hover.pos)
    el.readout.textContent = at ? `x ${fmt(hover.pos[0])} mm, y ${fmt(hover.pos[1])} mm: ${Q.digits != null ? q.E[at.i]?.toFixed(Q.digits) : fmt(q.E[at.i])} ${q.unit}` : ''
    return L
}, (L, x, y) => { hover.pos = heatmapAt(L, x, y); redraw('map') })
const xyChart = (id, title, help, series) => chart(id, title, help, (c, el) => {
    const { m, q, key, Q } = shown(), pt = pointOf(m, C[id].through)
    const s = series(m, q, pt, key)
    const L = drawXY(c, { ...s, hover: hover.x?.[id] ?? null, ...(key !== 'E' && id !== 'encircled' ? { yMin: 'auto', yFormat: v => v.toFixed(Math.max(0, (Q.digits ?? 2) - 1)) } : {}) })
    const hx = hover.x?.[id]
    el.readout.textContent = hx == null ? '' : s.series.map(k => { const p = nearestX(k.points.filter(p => Number.isFinite(p.y)), hx); return p ? `${k.label} at ${fmt(p.x)}: ${fmt(p.y)}` : '' }).join('  ·  ')
    return L
}, (L, x, y) => { hover.x = { [id]: xyAt(L, x, y) }; redraw(id) })
xyChart('profiles', 'Profiles', 'Along x and along y through the chosen point, in whatever the map shows.',
    (m, q, pt) => ({ series: [{ label: 'along x', points: profile(q, 'a', pt) }, { label: 'along y', points: profile(q, 'b', pt) }], xLabel: 'mm', yUnit: q.unit }))
xyChart('rings', 'Rings', 'Averaged over rings about the chosen point: a round spot with the noise of a whole ring.',
    (m, q, pt) => { const e = encircled(m, pt); return { series: [{ label: 'ring average', points: radial(q, pt) }], xLabel: 'r, mm', yUnit: q.unit,
        marks: [{ x: e.r50, label: 'r50' }, { x: e.r90, label: 'r90' }] } })
xyChart('encircled', 'Encircled flux', 'The share of the map\'s flux within a radius of the chosen point.',
    (m, q, pt) => { const e = encircled(m, pt); return { series: [{ label: 'within r', points: e.points }], xLabel: 'r, mm', yUnit: '%', yMax: 1,
        yFormat: v => `${Math.round(v * 100)}`, levels: [{ at: 0.5, label: '50 %' }, { at: 0.9, label: '90 %' }], marks: [{ x: e.r50, label: 'r50' }, { x: e.r90, label: 'r90' }] } })

//----------------------------------------------------------------------------------------------------------------------
// THE SHELL
//----------------------------------------------------------------------------------------------------------------------
const S = createShell(document.getElementById('app'), { title: 'Mockup F', menus: ['File', 'View', 'Window', 'Help'], storageKey: 'mockup.f.layout',
                                                          popoutUrl: '../popout.html' })
const view = S.panel({ id: 'viewport', title: 'Viewport', module: 'renderer', renderer: 'always', popout: false, closable: false })
{
    const d = document.createElement('div'); d.style.cssText = 'position:absolute;inset:0'; view.appendChild(d)
    const c = document.createElement('canvas'); c.style.cssText = 'width:100%;height:100%;display:block'; d.appendChild(c)
    new ResizeObserver(() => drawPicture(c, { rays: '1' })).observe(d)
}
const panes = {}
for (const k of Object.values(CHARTS)) {
    const host = S.panel({ id: k.id, title: k.title, module: 'optics', help: k.help })
    const el = document.createElement('div'); el.className = 'chartpane'
    const c = document.createElement('canvas'); el.appendChild(c)
    el.readout = document.createElement('div'); el.readout.className = 'readout'; el.appendChild(el.readout)
    host.appendChild(el)
    panes[k.id] = { el, c, layout: null }
    new ResizeObserver(() => redraw(k.id)).observe(el)
    c.addEventListener('pointermove', e => { const r = c.getBoundingClientRect(); if (panes[k.id].layout) k.move(panes[k.id].layout, e.clientX - r.left, e.clientY - r.top) })
    c.addEventListener('pointerleave', () => { hover.angle = null; hover.pos = null; hover.x = null; redraw(...Object.keys(CHARTS)) })
    el.addEventListener('pointerdown', () => select(k.id), true)
}
const redraw = (...ids) => { for (const id of ids) { const p = panes[id]; if (p && p.c.clientWidth > 10 && p.c.clientHeight > 10) p.layout = CHARTS[id].draw(p.c, p.el) } }
const redrawAll = () => redraw(...Object.keys(CHARTS))

/* THE MAP: drag a rectangle to zoom, double-click to go back, click to set the profiles' point */
{
    const p = panes.map, band = document.createElement('div')
    band.style.cssText = 'position:absolute;border:1px dashed #fff;background:rgba(127,224,255,0.12);pointer-events:none;display:none'
    p.el.appendChild(band)
    let from = null, dragged = false
    const at = e => { const r = p.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
    p.c.addEventListener('pointerdown', e => { if (heatmapAt(p.layout, ...at(e))) { from = at(e); dragged = false; p.c.setPointerCapture(e.pointerId) } })
    p.c.addEventListener('pointermove', e => {
        if (!from) return
        const b = at(e)
        if (Math.hypot(b[0] - from[0], b[1] - from[1]) > 5) dragged = true
        if (dragged) Object.assign(band.style, { display: 'block', left: `${Math.min(from[0], b[0])}px`, top: `${Math.min(from[1], b[1])}px`,
                                                width: `${Math.abs(b[0] - from[0])}px`, height: `${Math.abs(b[1] - from[1])}px` })
    })
    p.c.addEventListener('pointerup', e => {
        if (!from) return
        const A = heatmapAt(p.layout, ...from), B = heatmapAt(p.layout, ...at(e))
        band.style.display = 'none'; from = null
        if (dragged && A && B) { C.map.zoom = { a: [Math.min(A[0], B[0]), Math.max(A[0], B[0])], b: [Math.min(A[1], B[1]), Math.max(A[1], B[1])] }; settings(); redrawAll() }
        else if (A) { clicked = A; for (const k of ['profiles', 'rings', 'encircled']) C[k].through = 'click'; settings(); redrawAll() }
    })
    p.c.addEventListener('dblclick', () => { C.map.zoom = null; settings(); redrawAll() })
}

//----------------------------------------------------------------------------------------------------------------------
// THE ANALYSIS PANE: the data, the selected chart's settings, the results
//----------------------------------------------------------------------------------------------------------------------
const pane = S.panel({ id: 'analysis', title: 'Analysis', module: 'optics', closable: false,
    help: 'The data every chart is made from, the selected chart\'s own settings, and the results. Click a chart to select it.' })
pane.style.overflow = 'auto'
const tableIn = el => { const t = new PropertyTable({ container: el }); Object.assign(t.element.style, { fontSize: '13px', width: '100%' }); return t }
const div = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d }

const runbar = div('runbar', `<input value="${D.rays}" title="Rays: millions, or 500k, 2M"><button title="Trace that many rays, in batches, for numbers with error bars">▶ Run</button><span class="when"></span>`)
const when = runbar.querySelector('.when')
const sayWhen = () => { when.textContent = `${D.rays} rays · ${D.ran.toLocaleTimeString()}` }
runbar.querySelector('button').onclick = () => {
    when.textContent = 'tracing… batch 3 of 8'
    setTimeout(() => { D.ran = new Date(); sayWhen() }, 900)
}
sayWhen()
pane.appendChild(runbar)

const dataEl = document.createElement('div'); pane.appendChild(dataEl)
const data = tableIn(dataEl)
{
    const f1 = data.addFolder({ title: 'Intensity · the far field' })
    f1.addBinding(D, 'from', { label: 'from', options: { 'escaping rays': 'escaped', 'at Screen': 'mat:3' } })
    f1.addBinding(D, 'axis', { label: 'axis', options: { 'LED': 'LED', 'world +z': 'z' } })
    f1.addBinding(D, 'dG', { label: 'γ step', options: { '0.5°': 0.5, '1°': 1, '2°': 2 } })
    f1.addBinding(D, 'dC', { label: 'C step', options: { '1°': 1, '5°': 5, '15°': 15 } })
    const f2 = data.addFolder({ title: 'Map · a detector' })
    f2.addBinding(D, 'detector', { label: 'detector', options: { 'Screen': 'Screen', 'far field on a plane': 'plane' } })
    f2.addBinding(D, 'area', { label: 'area', options: { 'whole detector': 'detector', 'lit area': 'lit' } }).on('change', () => { C.map.zoom = null; redrawAll() })
    f2.addBinding(D, 'cells', { label: 'cells', min: 16, max: 160, step: 1 }).on('change', redrawAll)
    f2.addBinding(D, 'smooth', { label: 'smoothing', options: { 'none': 'none', 'Gaussian': 'gauss', 'Epanechnikov': 'epan', 'k nearest': 'knn' } }).on('change', redrawAll)
    f2.addBinding(D, 'bw', { label: 'width (cells)', min: 0.5, max: 6, step: 0.25 }).on('change', redrawAll)
}

const selHead = div('head'); pane.appendChild(selHead)
const selEl = document.createElement('div'); pane.appendChild(selEl)
let selTable = null, selected = 'map'
/* THE SELECTED CHART'S OWN SETTINGS: made again when another chart is selected */
const settings = () => {
    selHead.innerHTML = `Chart <span class="name">${CHARTS[selected].title}</span>`
    try { selTable?.dispose() } catch { }
    selEl.innerHTML = ''
    selTable = tableIn(selEl)
    const t = selTable, s = C[selected], go = () => redraw(selected)
    if (selected === 'polar' || selected === 'igamma') {
        t.addBinding(s, 'planes', { label: 'C planes' }).on('change', go)
        t.addBinding(s, 'log', { label: 'log scale' }).on('change', go)
        if (selected === 'polar') {
            t.addBinding(s, 'unit', { label: 'unit', options: { 'cd': 'cd', 'cd/klm': 'cd/klm' } }).on('change', go)
            t.addBinding(s, 'symmetry', { label: 'rotational symmetry' }).on('change', go)
            t.addBinding(s, 'view', { label: 'view', options: { 'auto': 'auto', 'full circle': 'full', 'lower half': 'lower' } }).on('change', go)
        } else t.addBinding(s, 'span', { label: 'angle range', options: { 'auto': 0, '±10°': 10, '±30°': 30, '±90°': 90, '±180°': 180 } }).on('change', go)
    } else if (selected === 'map') {
        const m = baseMap()
        const opts = Object.fromEntries(quantitiesOf(m).map(k => [MAP_QUANTITIES[k].label, k]))
        t.addBinding(s, 'q', { label: 'shows', options: opts }).on('change', () => redraw('map', 'profiles', 'rings'))
        t.addBinding(s, 'isolines', { label: 'isolines', options: { 'round steps': 'lux', '% of max': 'relative', 'off': 'off' } }).on('change', go)
        if (s.zoom) t.addButton({ title: 'Whole detector (or double-click the map)' }).on('click', () => { s.zoom = null; settings(); redrawAll() })
    } else {
        t.addBinding(s, 'through', { label: 'about', options: { 'the peak': 'peak', 'the centroid': 'centroid', 'where the map was clicked': 'click' } })
            .on('change', () => redraw(selected, 'map'))
    }
    for (const [id, p] of Object.entries(panes)) p.el.classList.toggle('sel', id === selected)
}
const select = id => { if (CHARTS[id] && id !== selected) { selected = id; settings() } }

pane.appendChild(div('head', 'Results'))
const cards = div('cards'); pane.appendChild(cards)
const results = () => {
    const F = far('polar'), m = baseMap(), e = encircled(m, peak(m))
    const cct = m.colour?.cctInRange ? `${Math.round(m.colour.cct)} K` : '–'
    const card = (k, v, err = '') => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="e">${err}</div></div>`
    cards.innerHTML = [
        card('I max', `${fmt(F.S.max.I)} cd`, `± ${fmt(F.S.max.se)}`),
        card('beam C0', `${F.S.planes[0].beam?.width?.toFixed(1) ?? '–'}°`, 'at 50 %'),
        card('efficiency', `${(100 * F.S.efficiency).toFixed(1)} %`, `${fmt(F.S.flux)} of 1000 lm`),
        card('E max · Screen', `${fmt(m.max)} lx`, `mean ${fmt(m.meanLit)}`),
        card('U0', m.uniformity?.toFixed(2) ?? '–', 'min / mean'),
        card('r50 · r90', `${fmt(e.r50)} · ${fmt(e.r90)}`, 'mm'),
        card('CCT', cct, m.colour ? `Δu′v′ max ${m.colour.dUpVpMax?.toFixed(4)}` : ''),
    ].join('')
}
results()
pane.appendChild(div('note', 'Sources, colour mixing and the trace\'s limits fold away below the results in the application.'))

//----------------------------------------------------------------------------------------------------------------------
// THE LAYOUT: the Analysis pane on the left, the charts in two rows beside it
//----------------------------------------------------------------------------------------------------------------------
const ANALYSE = () => {
    S.open('analysis')
    S.open('map', { referencePanel: 'analysis', direction: 'right' }, { width: Math.round(window.innerWidth * 0.36) })
    S.open('viewport', { referencePanel: 'map', direction: 'within' })
    S.open('polar', { referencePanel: 'map', direction: 'right' })
    S.open('igamma', { referencePanel: 'polar', direction: 'right' })
    S.open('profiles', { referencePanel: 'map', direction: 'below' })
    S.open('rings', { referencePanel: 'polar', direction: 'below' })
    S.open('encircled', { referencePanel: 'igamma', direction: 'below' })
    S.open('map')
    S.dock.getPanel('analysis')?.group?.api?.setSize?.({ width: 330 })
}
S.layout.setDefault(ANALYSE)
S.layout.preset('Analyse', ANALYSE, 'The Analysis pane beside every chart, each in a panel of its own.')
S.layout.onApply(() => S.open('viewport'))
S.standardCommands()
S.layout.reset()
// a chart's tab chosen selects it too
S.dock.onDidActivePanelChange?.(e => { const p = e?.panel ?? e; if (p && CHARTS[p.id]) select(p.id) })   // dockview 8: { panel, origin }
settings()
setTimeout(redrawAll, 50)
window.MOCKUP = { S, select, C, D, redrawAll }
