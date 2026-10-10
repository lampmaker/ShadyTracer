// node lib/pathtracer/optics/test/charts.test.mjs
//
// THE CHARTS RUN. Nothing else executes the drawing code here: Node has no canvas, and this repo's
// container cannot start a browser, so a typo in a branch of drawPolar would first be seen on the
// user's screen. Each chart is drawn into a fake 2D context that accepts every call and records it,
// on real data (a Lambertian far field, a detector map, the far field on a plane), in the modes the
// page uses -- linear and log, error bands, hover, levels, contours. What is checked: nothing throws,
// something is drawn, no coordinate is NaN, and the layout each returns maps the pointer back.
import { drawPolar, polarAngleAt } from '../polar.js'
import { drawCartesian, cartesianAngleAt } from '../cartesian.js'
import { drawXY, xyAt } from '../xychart.js'
import { drawHeatmap, heatmapAt, paintCell } from '../heatmap.js'
import { intensity, planeCurve, farStats } from '../farfield.js'
import { detectorMap } from '../detmap.js'
import { profile, radial, encircled, isolux, peak, virtualPlane, cellAt } from '../illum.js'
import { quantityMap, quantitiesOf, MAP_QUANTITIES } from '../quantities.js'
import { cctDuvToXy, xyToXYZ, xyToUpVp, mixToTarget } from '../../core/colorimetry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

/* A 2D CONTEXT THAT RECORDS: every method is a function that notes its numeric arguments; every
   property can be set. createImageData and the gradient give back what the code writes into. */
const fakeCanvas = (w = 600, h = 400) => {
    const calls = [], nan = [], texts = []
    const ctx = new Proxy({}, {
        get(t, k) {
            if (k in t) return t[k]
            if (k === 'createImageData') return (W, H) => ({ data: new Uint8ClampedArray(W * H * 4) })
            if (k === 'createLinearGradient') return () => ({ addColorStop() { } })
            return (...args) => {
                calls.push(k)
                if (k === 'fillText') texts.push(String(args[0]))
                if (args.some(a => typeof a === 'number' && !Number.isFinite(a))) nan.push(`${String(k)}(${args.join(', ')})`)
            }
        },
        set(t, k, v) { t[k] = v; return true },
    })
    return { clientWidth: w, clientHeight: h, width: 0, height: 0, getContext: () => ctx, calls, nan, texts }
}
// the heat map draws its cells into a second canvas: an element from `document` where there is no OffscreenCanvas
globalThis.document = { createElement: () => fakeCanvas(1, 1) }

const drawn = (name, cv, run) => {
    let L = null, err = null
    try { L = run() } catch (e) { err = e }
    ok(`${name}: draws without throwing`, !err, err?.stack?.split('\n').slice(0, 3).join(' | '))
    ok(`${name}: strokes and fills something`, cv.calls.includes('stroke') && cv.calls.includes('fillRect'))
    ok(`${name}: no NaN or infinite coordinate`, !cv.nan.length, cv.nan.slice(0, 3).join('; '))
    return L
}

// A LAMBERTIAN FAR FIELD, with made-up errors so the bands are drawn
const nC = 36, nG = 91, flux = 1000, RAD = Math.PI / 180
const f = new Float64Array(nC * nG), se = new Float64Array(nC * nG)
for (let j = 0; j < nG; j++) {
    const lo = Math.max(0, (j - 0.5) * 2) * RAD, hi = Math.min(180, (j + 0.5) * 2) * RAD
    const F = g => g >= Math.PI / 2 ? 1 : Math.sin(g) ** 2
    for (let i = 0; i < nC; i++) { f[j * nC + i] = flux * (F(hi) - F(lo)) / nC; se[j * nC + i] = 0.02 * f[j * nC + i] }
}
const far = { nC, nG, flux: f, se, emitted: flux, unit: 'lm', batches: 4 }
const R = intensity(far), S = farStats(far, R, [0, 90])
const curves = [0, 90, 45, 135].map(C => ({ label: `C${C}`, points: planeCurve(R, C).points }))
const levels = [{ at: 0.5 * S.max.I, label: '50 %' }, { at: 0.1 * S.max.I, label: '10 %' }]

for (const log of [false, true]) for (const view of ['auto', 'full', 'lower']) {
    const cv = fakeCanvas()
    const L = drawn(`polar (${log ? 'log' : 'linear'}, ${view})`, cv, () => drawPolar(cv, { curves, log, view, levels, hover: 30, title: 't' }))
    if (log && view === 'full') ok('polar layout maps the pointer back: straight down is 0', Math.abs(polarAngleAt(L, L.cx, L.cy + L.R / 2)) < 1e-9)
}
for (const [log, span] of [[false, 0], [true, 0], [false, 5]]) {
    const cv = fakeCanvas()
    const L = drawn(`I vs gamma (${log ? 'log' : 'linear'}, span ${span || 'auto'})`, cv,
        () => drawCartesian(cv, { curves, log, span, levels, hover: 12, title: 't' }))
    ok(`I vs gamma (span ${span || 'auto'}): the middle of the plot is gamma 0`, Math.abs(cartesianAngleAt(L, (L.x0 + L.x1) / 2, L.y1 - 5)) < 1e-9)
}

// A DETECTOR MAP from scattered hits, histogram and smoothed, and the far field on a plane
let s = 7
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
const hits = Array.from({ length: 20000 }, () => {
    const r = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * 3, t = 2 * Math.PI * rnd()
    return { pos: [r * Math.cos(t), r * Math.sin(t), 0], flux: 1 / 20000, tag: 1 }
})
const maps = [['histogram', detectorMap(hits, { cells: 48, metresPerUnit: 0.001 })],
              ['Gaussian', detectorMap(hits, { cells: 48, metresPerUnit: 0.001, smooth: 'gauss' })],
              ['plane', virtualPlane(far, R, { h: 2, cells: 48 })]]
for (const [name, m] of maps) {
    const p = peak(m), enc = encircled(m, p)
    const levels2 = [0.25, 0.5, 0.75].map(k => k * m.max)
    const cv = fakeCanvas(700, 500)
    const L = drawn(`heat map (${name})`, cv, () => drawHeatmap(cv, m, { contours: isolux(m, levels2), point: p, hover: p, lengthUnit: 'mm', title: 't' }))
    const back = heatmapAt(L, L.x0 + L.pw / 2, L.y0 + L.ph / 2)
    ok(`heat map (${name}): the middle of the plot is the middle of the map`,
        back && Math.abs(back[0] - (m.range.a[0] + m.range.a[1]) / 2) < 1e-9 && Math.abs(back[1] - (m.range.b[0] + m.range.b[1]) / 2) < 1e-9)
    const c1 = fakeCanvas()
    drawn(`profiles (${name})`, c1, () => drawXY(c1, { series: [{ label: 'a', points: profile(m, 'a', p) }, { label: 'b', points: profile(m, 'b', p) }],
        xLabel: 'mm', yUnit: 'lx', levels: [{ at: m.meanLit, label: 'mean' }], hover: p[0], title: 't' }))
    // positions either side of 0 are labelled as numbers, not in exponent form ("-3e1" was drawn)
    ok(`profiles (${name}): no axis label in exponent form`, !c1.texts.some(t => /^[−-]?\d+(\.\d+)?e[+-]?\d+$/.test(t) && Math.abs(+t.replace('−', '-')) < 1e4 && Math.abs(+t.replace('−', '-')) >= 1e-2),
        c1.texts.filter(t => /e/.test(t)).join(' '))
    const c2 = fakeCanvas()
    drawn(`radial (${name})`, c2, () => drawXY(c2, { series: [{ label: 'r', points: radial(m, p) }], marks: [{ x: enc.r50, label: 'r50' }], hover: 1 }))
    const c3 = fakeCanvas()
    const L3 = drawn(`encircled (${name})`, c3, () => drawXY(c3, { series: [{ label: 'e', points: enc.points }], yMax: 1,
        yFormat: v => `${Math.round(v * 100)}`, levels: [{ at: 0.5, label: '50 %' }], marks: [{ x: enc.r90, label: 'r90' }], hover: enc.r50 }))
    ok(`encircled (${name}): the plot's left edge is r 0`, Math.abs(xyAt(L3, L3.x0, L3.y1 - 1)) < 1e-9)
}

// A COLOUR MAP: hits warm at the centre and cool outside (3000 K within r 2, 6000 K beyond), each
// carrying its X, Y (= flux) and Z, as optics readHits gives them. Its quantities are drawn the way
// the page draws them: the map over its own range, the profile from where the values are.
{
    const at = T => { const [x, y] = cctDuvToXy(T, 0); return [x, y] }
    const warm = at(3000), cool = at(6000)
    const chits = hits.map(h => {
        const r = Math.hypot(h.pos[0], h.pos[1]), [x, y] = r < 2 ? warm : cool
        return { ...h, xyz: xyToXYZ(x, y, h.flux) }
    })
    const m = detectorMap(chits, { cells: 40, metresPerUnit: 0.001 })
    ok('a map with colour offers E, CCT, x, y, Duv, the distance from a target and the light itself',
        quantitiesOf(m).join() === 'E,CCT,x,y,Duv,dTarget,light,hue', quantitiesOf(m).join())
    ok('...one without, E alone', quantitiesOf(maps[0][1]).join() === 'E')
    const E = quantityMap(m, 'E')
    ok('E comes back as itself, over 0..max', E.E === m.E && E.lo === 0 && E.hi === m.max)
    const T = quantityMap(m, 'CCT'), p = peak(m)
    const c = T.E[m.E.indexOf(m.max)]
    ok('CCT at the brightest cell is the warm light\'s', Math.abs(c - 3000) < 15, `${c}`)
    ok('CCT over the map runs from the warm light to the cool', Math.abs(T.lo - 3000) < 15 && Math.abs(T.hi - 6000) < 30, `${T.lo} .. ${T.hi}`)
    ok('a cell too dim for a colour has none (NaN), not 0 K', [...T.E].some(Number.isNaN) && ![...T.E].some(v => v === 0))
    ok('...and no noise that would be wrong for it', T.count === undefined && T.se === undefined)
    const X = quantityMap(m, 'x')
    ok('x at the brightest cell is the warm light\'s x', Math.abs(X.E[m.E.indexOf(m.max)] - warm[0]) < 1e-9)
    let threw = false
    try { quantityMap(maps[0][1], 'CCT') } catch { threw = true }
    ok('a colour quantity of a map without colour is refused, not drawn as zeros', threw)
    // Duv: both lights are on the locus; where they mix (the cells across r 2) the mix lies on the chord
    // between them, which is BELOW the locus -- why two white LEDs mixed read pink
    const D = quantityMap(m, 'Duv')
    ok('Duv at the warm centre is 0', Math.abs(D.E[m.E.indexOf(m.max)]) < 5e-4, `${D.E[m.E.indexOf(m.max)]}`)
    ok('...and a mix of two locus colours is never above the locus, and somewhere below it', D.hi < 5e-4 && D.lo < -1e-3, `${D.lo} .. ${D.hi}`)
    // Δu'v' FROM A TARGET: 0 on the warm light, the warm-to-cool distance on the cool
    const dWC = (([a, b], [c, d]) => Math.hypot(a - c, b - d))(xyToUpVp(...warm), xyToUpVp(...cool))
    const Q = quantityMap(m, 'dTarget', { target: warm })
    ok('Δu′v′ from the warm light is 0 at the warm centre', Math.abs(Q.E[m.E.indexOf(m.max)]) < 1e-9)
    ok('...and the warm-to-cool distance at most', Math.abs(Q.hi - dWC) < 1e-9 && Q.lo === 0, `${Q.hi} vs ${dWC}`)
    ok('...the whole detector\'s distance is between', Q.off.whole > 0 && Q.off.whole < dWC && Q.off.rms > 0 && Q.off.rms <= Q.off.max)
    const Qm = quantityMap(m, 'dTarget')
    ok('with no target, the target is the detector\'s own colour', Math.abs(Qm.off.whole) < 1e-12 && Math.abs(Qm.off.target[0] - m.colour.x) < 1e-15)
    for (const key of ['CCT', 'x', 'y', 'Duv', 'dTarget']) {
        const q = quantityMap(m, key), cv = fakeCanvas(700, 500)
        const lv = [0.3, 0.6].map(f => q.lo + f * (q.hi - q.lo))
        drawn(`heat map of ${key}`, cv, () => drawHeatmap(cv, { ...q, digits: MAP_QUANTITIES[key].digits }, { contours: isolux(q, lv), point: p, lengthUnit: 'mm', unit: q.unit }))
        const lo = q.lo.toFixed(MAP_QUANTITIES[key].digits)
        ok(`heat map of ${key}: its colour bar runs from its lowest value, not from 0`, cv.texts.includes(lo), `${lo} not in ${cv.texts.join(' | ')}`)
        const c1 = fakeCanvas()
        const L = drawn(`profile of ${key}, from where its values are`, c1, () => drawXY(c1, { series: [{ label: 'a', points: profile(q, 'a', p) }], yMin: 'auto', yUnit: q.unit }))
        ok(`profile of ${key}: drawn`, !!L)
        const rr = radial(q, p)
        ok(`rings of ${key}: no ring is NaN (the dim cells are left out)`, rr.every(r => Number.isFinite(r.y)))
    }
}

// THE LIGHT PAINTED: RGB mixing. Three primaries, their fluxes solved for 4000 K (colorimetry.js
// mixToTarget), each a disc of hits offset from the others -- white where all three overlap, coloured
// fringes where they do not. What is checked: the map keeps E; the whole mix is on its target; the
// white middle is painted neutral; a fringe keeps its hue when painted at full brightness.
{
    const P = [[0.70, 0.29], [0.17, 0.70], [0.14, 0.05]], tgt = cctDuvToXy(4000, 0)
    const { flux: F, reachable } = mixToTarget(P, tgt, 1)
    ok('the mix is reachable', reachable)
    const n = 30000, mh = []
    const off = [[0.4, 0], [-0.2, 0.35], [-0.2, -0.35]]
    for (let k = 0; k < 3; k++) for (let j = 0; j < n; j++) {
        const r = 2 * Math.sqrt(rnd()), t = 2 * Math.PI * rnd(), f = F[k] / n
        mh.push({ pos: [off[k][0] + r * Math.cos(t), off[k][1] + r * Math.sin(t), 0], flux: f, tag: 1, xyz: xyToXYZ(...P[k], f) })
    }
    const m = detectorMap(mh, { cells: 32, metresPerUnit: 0.001, smooth: 'gauss' })
    ok('the whole detector\'s colour is the target\'s', Math.hypot(m.colour.x - tgt[0], m.colour.y - tgt[1]) < 1e-9, `${m.colour.x} ${m.colour.y}`)
    const Q = quantityMap(m, 'dTarget', { target: tgt })
    ok('...so its Δu′v′ from the target is 0, while its fringes are far off it', Q.off.whole < 1e-9 && Q.off.max > 0.05, `${Q.off.whole} ${Q.off.max}`)
    for (const key of ['light', 'hue']) {
        const q = quantityMap(m, key)
        ok(`${key}: the map keeps E, and the colour to paint with`, q.E === m.E && q.EX === m.EX && q.paint === key && q.hi === m.max)
        for (const exposure of [1, 4]) {
            const cv = fakeCanvas(600, 500)
            const L = drawn(`heat map painted (${key}, × ${exposure})`, cv, () => drawHeatmap(cv, q, { contours: isolux(q, [0.5 * m.max]), point: peak(m), hover: peak(m), lengthUnit: 'mm', unit: q.unit, exposure }))
            ok(`heat map painted (${key}): the pointer maps back`, !!heatmapAt(L, L.x0 + 1, L.y0 + 1))
        }
    }
    // the middle, where all three land, is near white (the target is 4000 K: warm, so red >= blue)
    const mid = cellAt(m, 0, 0).i, cw = paintCell(quantityMap(m, 'hue'), mid, 'hue')
    ok('the overlap is painted near neutral, at full brightness', Math.max(...cw) === 255 && Math.min(...cw) > 150 && cw[0] >= cw[2], cw.join())
    // a red-only fringe: the far side of the red disc
    const red = cellAt(m, 2.2, 0)
    const cr = paintCell(quantityMap(m, 'hue'), red.i, 'hue'), cl = paintCell(quantityMap(m, 'light'), red.i, 'light')
    // (this red is outside Rec.709: it is shown desaturated at its luminance, so some blue comes in)
    ok('a red fringe painted as hue is red', cr[0] === 255 && cr[1] < 60 && cr[2] < 90, cr.join())
    ok('...and as light, never brighter than that', cl.every((v, k) => v <= cr[k]), cl.join())
    ok('a cell no light reached is not painted', paintCell(m, m.E.indexOf(0) >= 0 ? m.E.indexOf(0) : 0, 'light') === null || m.E.indexOf(0) < 0)
    const w = paintCell({ E: [2], EX: [2 * 0.9505], EZ: [2 * 1.089], hi: 2 }, 0, 'light')
    ok('D65 at the map\'s max is painted white', w.every(v => v === 255), w.join())
    const hw = paintCell({ E: [1], EX: [0.9505], EZ: [1.089], hi: 2 }, 0, 'light', 2)
    ok('...and at half the max, brightness × 2, white too', hw.every(v => v === 255), hw.join())
    const hg = paintCell({ E: [1], EX: [0.9505], EZ: [1.089], hi: 2 }, 0, 'light')
    ok('...and at half the max, brightness × 1, sRGB mid grey (188)', hg.every(v => Math.abs(v - 188) <= 1), hg.join())
}

// AN EMPTY CHART is drawn too (no far field yet, no hits yet): axes and nothing else, no NaN
{
    const cv = fakeCanvas()
    drawn('I vs gamma with nothing in it', cv, () => drawCartesian(cv, { curves: [] }))
    const c2 = fakeCanvas()
    drawn('an x-y chart with nothing in it', c2, () => drawXY(c2, { series: [] }))
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
