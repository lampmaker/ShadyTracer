//======================================================================================================================
// SHARED BITS FOR THE UI MOCKUPS -- a fake picture, and the REAL charts on synthetic data.
//
// The charts are the repo's own (lib/pathtracer/optics: polar, cartesian, heatmap, xychart) fed by the
// repo's own arithmetic (farfield.js, illum.js, detmap.js), so what a mockup shows of a chart is what
// the code draws today -- only where it sits is being proposed. The "picture" is a canvas sketch: a
// mockup must not need a GPU. Nothing here is used by the application.
//======================================================================================================================
import { drawPolar } from '../lib/pathtracer/optics/polar.js'
import { drawCartesian } from '../lib/pathtracer/optics/cartesian.js'
import { drawHeatmap } from '../lib/pathtracer/optics/heatmap.js'
import { drawXY } from '../lib/pathtracer/optics/xychart.js'
import { intensity, planeCurve, farStats } from '../lib/pathtracer/optics/farfield.js'
import { detectorMap } from '../lib/pathtracer/optics/detmap.js'
import { profile, radial, encircled, isolux, peak } from '../lib/pathtracer/optics/illum.js'

/* A FAR FIELD like a small lens's: a cos^n beam, a little wider across C90 than C0, 2 % stray light
   out to 80 degrees. 1000 lm emitted, 86 % of it in the far field. */
const nC = 72, nG = 181, RAD = Math.PI / 180
const flux = new Float64Array(nC * nG), se = new Float64Array(nC * nG)
{
    let sum = 0
    for (let j = 0; j < nG; j++) for (let i = 0; i < nC; i++) {
        const g = j * RAD, C = i * 5 * RAD
        const w = 14 + 5 * Math.sin(C) ** 2                      // half-width in degrees, by C
        const core = Math.exp(-0.5 * (j / (w / 1.18)) ** 2)
        const stray = j < 80 ? 0.02 * Math.cos(g) : 0
        const om = (2 * Math.PI / nC) * (Math.cos(Math.max(0, j - 0.5) * RAD) - Math.cos(Math.min(180, j + 0.5) * RAD))
        flux[j * nC + i] = (core + stray) * om
        sum += flux[j * nC + i]
    }
    for (let k = 0; k < flux.length; k++) { flux[k] *= 860 / sum; se[k] = 0.015 * flux[k] + 1e-4 }
}
export const FAR = { nC, nG, flux, se, emitted: 1000, unit: 'lm', batches: 8, rays: 2e6, mode: 'escaped' }
export const R = intensity(FAR)
export const STATS = farStats(FAR, R, [0, 90])
export const CURVES = [0, 90].map(C => ({ label: `C${C}–C${C + 180}`, points: planeCurve(R, C).points }))
const LEVELS = [{ at: 0.5 * STATS.max.I, label: '50 %' }, { at: 0.1 * STATS.max.I, label: '10 %' }]

/* A DETECTOR MAP: 60 000 hits of an elliptical spot on a screen, in mm. The flux is scaled so the map
   reads in the hundreds of lux the mockups' number cards quote: a made-up map, made to agree with them. */
let s = 11
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
const hits = Array.from({ length: 60000 }, () => {
    const r = Math.sqrt(-2 * Math.log(rnd() + 1e-12)), t = 2 * Math.PI * rnd()
    const flat = rnd() < 0.55                                         // a flat-topped part and a halo
    const rr = flat ? 9 * Math.sqrt(rnd()) : 7 * r
    return { pos: [rr * Math.cos(t) * 1.25 + 3, rr * Math.sin(t), 0], flux: 0.16 / 60000, tag: 3 }
})
export const MAP = { ...detectorMap(hits, { cells: 72, metresPerUnit: 0.001, smooth: 'gauss', bandwidth: 1.5 }), lengthUnit: 'mm' }
export const PT = peak(MAP)
export const ENC = encircled(MAP, PT)

/** Draw into `el` (a sized box) now and whenever it is resized. */
const mount = (el, draw) => {
    const c = document.createElement('canvas')
    Object.assign(c.style, { width: '100%', height: '100%', display: 'block' })
    el.appendChild(c)
    const go = () => { if (c.clientWidth > 10 && c.clientHeight > 10) draw(c) }
    new ResizeObserver(go).observe(el)
    go()
    return c
}
const opt = (el, k, d) => el.dataset[k] ?? d

export const charts = {
    polar: el => mount(el, c => drawPolar(c, { curves: CURVES, levels: LEVELS, view: opt(el, 'view', 'auto'),
                                                log: el.dataset.log === '1', title: opt(el, 'title', '') })),
    cartesian: el => mount(el, c => drawCartesian(c, { curves: CURVES, levels: LEVELS, title: opt(el, 'title', '') })),
    heat: el => mount(el, c => drawHeatmap(c, MAP, { contours: isolux(MAP, [100, 200, 300, 400].filter(v => v < MAP.max)),
                                                      point: PT, lengthUnit: 'mm', title: opt(el, 'title', '') })),
    profile: el => mount(el, c => drawXY(c, { series: [{ label: 'along x', points: profile(MAP, 'a', PT) },
                                                        { label: 'along y', points: profile(MAP, 'b', PT) }],
                                              xLabel: 'mm', yUnit: 'lx', levels: [{ at: MAP.meanLit, label: 'mean' }], title: opt(el, 'title', '') })),
    radial: el => mount(el, c => drawXY(c, { series: [{ label: 'ring average', points: radial(MAP, PT) }], xLabel: 'r, mm', yUnit: 'lx',
                                             marks: [{ x: ENC.r50, label: 'r50' }, { x: ENC.r90, label: 'r90' }], title: opt(el, 'title', '') })),
    encircled: el => mount(el, c => drawXY(c, { series: [{ label: 'within r', points: ENC.points }], xLabel: 'r, mm', yUnit: '%', yMax: 1,
                                                yFormat: v => `${Math.round(v * 100)}`, levels: [{ at: 0.5, label: '50 %' }, { at: 0.9, label: '90 %' }],
                                                title: opt(el, 'title', '') })),
    /* A PARAMETER SWEEP, made up: U0 on the screen against the lens's back radius, with its error bars
       -- the chart an optimisation loop would draw */
    sweep: el => mount(el, c => drawXY(c, { series: [{ label: 'U0 on Screen', points: Array.from({ length: 13 }, (_, k) => {
        const x = 8 + k * 1.5, y = 0.78 - 0.0025 * (x - 15.5) ** 2 + (rnd() - 0.5) * 0.02
        return { x, y, se: 0.012 } }) }, { label: 'efficiency', points: Array.from({ length: 13 }, (_, k) => {
        const x = 8 + k * 1.5; return { x, y: 0.9 - 0.004 * (x - 10) ** 2 / 3, se: 0.004 } }) }],
        xLabel: 'Lens · back radius, mm', yMax: 1, yFormat: v => v.toFixed(1), title: opt(el, 'title', '') })),
    /* the picture: a sketch of the lens scene, not a render */
    picture: el => mount(el, c => drawPicture(c, el.dataset)),
}

/** A SKETCH OF THE PICTURE: the lens test scene seen from above and to the side -- a screen, the lens,
 *  the LED -- with the traced rays over it when data-rays is set, in false colour when data-mode is lux. */
export function drawPicture(c, { rays = '0', mode = 'picture' } = {}) {
    const dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight
    c.width = W * dpr; c.height = H * dpr
    const g = c.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const bg = g.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#20262c'); bg.addColorStop(1, '#0e1114')
    g.fillStyle = bg; g.fillRect(0, 0, W, H)
    const cx = W * 0.5, base = H * 0.72
    // the screen: a floor-like plane in perspective, with the spot on it
    g.beginPath(); g.moveTo(cx - W * 0.42, base + H * 0.2); g.lineTo(cx + W * 0.42, base + H * 0.2)
    g.lineTo(cx + W * 0.26, base - H * 0.06); g.lineTo(cx - W * 0.26, base - H * 0.06); g.closePath()
    g.fillStyle = mode === 'lux' ? '#1b2a6b' : '#3a3f44'; g.fill()
    const spot = g.createRadialGradient(cx + 6, base + H * 0.07, 2, cx + 6, base + H * 0.07, W * 0.14)
    if (mode === 'lux') { spot.addColorStop(0, '#ff5a1f'); spot.addColorStop(0.35, '#f3d33a'); spot.addColorStop(0.7, '#2fd3a4'); spot.addColorStop(1, 'rgba(40,70,160,0)') }
    else { spot.addColorStop(0, '#fffbe8'); spot.addColorStop(0.4, '#f2e2b0'); spot.addColorStop(1, 'rgba(242,226,176,0)') }
    g.save(); g.translate(0, base + H * 0.07); g.scale(1, 0.42); g.translate(0, -(base + H * 0.07))
    g.fillStyle = spot; g.beginPath(); g.arc(cx + 6, base + H * 0.07, W * 0.14, 0, 2 * Math.PI); g.fill(); g.restore()
    // the lens, a flattened ellipse, and the LED under a little housing
    const ly = H * 0.36
    g.fillStyle = 'rgba(190,220,235,0.22)'; g.strokeStyle = 'rgba(210,235,245,0.7)'; g.lineWidth = 1.5
    g.beginPath(); g.ellipse(cx, ly, W * 0.1, H * 0.035, 0, 0, 2 * Math.PI); g.fill(); g.stroke()
    g.fillStyle = '#fff6d0'; g.fillRect(cx - 4, H * 0.18, 8, 4)
    g.fillStyle = '#2b3036'; g.fillRect(cx - 14, H * 0.15, 28, 5)
    if (rays === '1') {
        g.globalCompositeOperation = 'lighter'
        for (let k = 0; k < 90; k++) {
            const t = (k / 89 - 0.5) * 2, x1 = cx + t * W * 0.095, sx = cx + 6 + t * W * 0.1 + (Math.sin(k * 7.3) * W * 0.02)
            g.strokeStyle = `rgba(255,${150 + (k % 5) * 18},60,0.28)`; g.lineWidth = 1
            g.beginPath(); g.moveTo(cx, H * 0.2); g.lineTo(x1, ly); g.lineTo(sx, base + H * 0.07 + Math.cos(k) * H * 0.03); g.stroke()
        }
        g.globalCompositeOperation = 'source-over'
    }
    if (mode === 'lux') {                                    // the false-colour strip the measure tool shows
        const x0 = W - 26, y0 = H * 0.2, h = H * 0.5
        const grad = g.createLinearGradient(0, y0 + h, 0, y0)
        ;['#30123b', '#4686fb', '#1ae4b6', '#a2fc3c', '#fabb39', '#e4460a', '#7a0403'].forEach((col, k, a) => grad.addColorStop(k / (a.length - 1), col))
        g.fillStyle = grad; g.fillRect(x0, y0, 10, h)
        g.fillStyle = '#8fa3b3'; g.font = '10px ui-monospace, monospace'; g.textAlign = 'right'
        g.fillText('480 lx', x0 - 4, y0 + 8); g.fillText('0', x0 - 4, y0 + h)
    }
}

/** Mount every [data-chart] element on the page. */
export function mountAll(root = document) {
    for (const el of root.querySelectorAll('[data-chart]')) if (!el.dataset.mounted) { el.dataset.mounted = '1'; charts[el.dataset.chart]?.(el) }
}

/** Tabs: [data-tabs] holds [data-tab="name"] buttons; [data-panel="name"] siblings under the same
 *  [data-tabgroup] show one at a time. Charts in a panel shown later mount then (they need a size). */
export function wireTabs(root = document) {
    for (const group of root.querySelectorAll('[data-tabgroup]')) {
        // this group's own buttons, not those of a group nested inside it
        const buttons = [...group.querySelectorAll('[data-tab]')].filter(b => b.closest('[data-tabgroup]') === group)
        const show = name => {
            for (const b of buttons) b.classList.toggle('on', b.dataset.tab === name)
            for (const p of group.querySelectorAll(':scope [data-panel]')) {
                if (p.closest('[data-tabgroup]') !== group) continue
                p.hidden = p.dataset.panel !== name
            }
            requestAnimationFrame(() => mountAll(group))
        }
        for (const b of buttons) b.addEventListener('click', () => show(b.dataset.tab))
        const first = buttons.find(b => b.classList.contains('on')) ?? buttons[0]
        if (first) show(first.dataset.tab)
    }
}

/** Menus: a [data-menu] button toggles the next sibling .dropdown; a click elsewhere closes it. */
export function wireMenus(root = document) {
    for (const b of root.querySelectorAll('[data-menu]')) {
        b.addEventListener('click', e => {
            e.stopPropagation()
            const d = b.nextElementSibling, open = !d.hidden
            for (const x of root.querySelectorAll('.dropdown')) x.hidden = true
            d.hidden = open
        })
    }
    document.addEventListener('click', () => { for (const x of root.querySelectorAll('.dropdown')) x.hidden = true })
}

export function boot() { wireTabs(); wireMenus(); mountAll() }
