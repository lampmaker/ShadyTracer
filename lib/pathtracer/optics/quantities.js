//======================================================================================================================
// WHAT A MAP SHOWS -- the quantity registry for detector maps (UI_PLAN.md section 7, "quantities").
//
//   quantityMap(m, 'CCT')     // the same map, each cell's CCT in place of its illuminance
//   MAP_QUANTITIES            // { E, CCT, x, y }: label, unit, what it needs, how a cell's value is made
//   quantitiesOf(m)           // the keys this map can show (the colour ones need a map with X and Z)
//
// A detector map carries X and Z beside its illuminance (Y) per cell whenever the hits carry colour
// (detmap.js COLOUR), so a cell's chromaticity -- and its CCT -- is arithmetic on data already there.
// Adding a quantity is an entry here; the charts draw whatever map they are handed.
//
// THE RESULT IS A MAP OF THE SAME SHAPE, with E holding the quantity: every reader (the heatmap, the
// profiles, the rings, the isolines) works on it unchanged. What differs is said on it:
//   quantity, label, unit    what the numbers are
//   lo, hi                   the range of the cells that have a value -- a colour scale and an axis run
//                            over these, not from 0 (a CCT map from 0 K would be one colour)
//   max                      = hi, so code that reads max still gets the top of the scale
//   E[i] NaN                 no value: a cell too dim for its colour to mean anything (under
//                            COLOUR_FLOOR of the peak illuminance, as detmap.js's colour uniformity
//                            counts), or a chromaticity with no CCT (too far from the Planckian locus)
//   se, count                none: a colour's noise is not E / sqrt(hits), and a histogram's hit count
//                            would draw the dim cells as data
//
// THE LIGHT'S OWN COLOUR (`paint`: 'light', 'hue'). For RGB mixing the question is what the detector
// LOOKS like -- a white patch with a magenta fringe -- and no single number says that. These two keep
// E as it is (the profiles, rings and isolines stay in lux, and so does their noise) and say to the
// heat map how to paint each cell instead of Turbo: 'light' as the light itself, its brightness the
// illuminance (what a white matte screen there would look like, lit by it alone), 'hue' at full
// brightness wherever light landed, so the colour of a dim fringe shows too. No COLOUR_FLOOR here: the
// fringe is often the point, and a dim cell's colour being noisy is visible as noise.
//
// DEVIATION FROM A TARGET ('dTarget'): each cell's CIE 1976 Δu'v' from a target chromaticity --
// `target: [x, y]` in quantityMap's options, or, with none, the detector's whole colour, which makes
// the map the picture of the colour uniformity the results report. Δu'v' is the colour difference
// binning and LED consistency are stated in. 'Duv' is the signed distance from the Planckian locus in
// CIE 1960 uv (ANSI C78.377), + above it (towards green): where a mix is off-white, which way.
//======================================================================================================================
import { XYZtoxy, xyToCctDuv, xyToUpVp } from '../core/colorimetry.js'
import { COLOUR_FLOOR } from './detmap.js'

/** A cell's chromaticity [x, y], or null where there is too little light (or no colour at all). */
const chroma = (m, i) => {
    if (!m.EX || !(m.E[i] >= COLOUR_FLOOR * m.max) || !(m.E[i] > 0)) return null
    return XYZtoxy([m.EX[i], m.E[i], m.EZ[i]]) ?? null
}

/** A cell's chromaticity at any brightness: for describing a cell under the pointer, not for a map. */
export function cellChroma(m, i) {
    if (!m.EX || !(m.E[i] > 0)) return null
    const xy = XYZtoxy([m.EX[i], m.E[i], m.EZ[i]])
    if (!xy) return null
    const t = xyToCctDuv(xy[0], xy[1])
    return { x: xy[0], y: xy[1], cct: t.inRange ? t.cct : null, duv: t.duv }
}

/** The distance in u'v' of two chromaticities. */
const dUpVp = (a, b) => { const [u0, v0] = xyToUpVp(a[0], a[1]), [u1, v1] = xyToUpVp(b[0], b[1]); return Math.hypot(u1 - u0, v1 - v0) }

export const MAP_QUANTITIES = {
    E: { label: 'Illuminance', unit: m => m.unit, colour: false, cell: (m, i) => m.E[i],
         tip: 'Illuminance: the flux arriving per area' },
    CCT: { label: 'CCT', unit: () => 'K', colour: true, digits: 0,
           cell: (m, i) => { const c = chroma(m, i); if (!c) return NaN; const t = xyToCctDuv(c[0], c[1]); return t.inRange ? t.cct : NaN },
           tip: 'Correlated colour temperature, K (where the light is near white)' },
    x: { label: 'CIE x', unit: () => '', colour: true, digits: 4, cell: (m, i) => chroma(m, i)?.[0] ?? NaN,
         tip: 'CIE 1931 chromaticity x' },
    y: { label: 'CIE y', unit: () => '', colour: true, digits: 4, cell: (m, i) => chroma(m, i)?.[1] ?? NaN,
         tip: 'CIE 1931 chromaticity y' },
    Duv: { label: 'Duv', unit: () => '', colour: true, digits: 4,
           cell: (m, i) => { const c = chroma(m, i); if (!c) return NaN; const t = xyToCctDuv(c[0], c[1]); return t.inRange ? t.duv : NaN },
           tip: 'Duv: the signed distance from the Planckian locus in CIE 1960 uv, + towards green, - towards pink' },
    dTarget: { label: 'Δu′v′ from target', unit: () => '', colour: true, digits: 4, zero: true,
               cell: (m, i, o) => { const c = chroma(m, i); return c ? dUpVp(c, o.target) : NaN },
               tip: 'Each cell\'s colour difference from a target chromaticity, CIE 1976 u′v′' },
    light: { label: 'True colour', unit: m => m.unit, colour: true, paint: 'light',
             tip: 'The light as it looks: its colour, brightness by illuminance' },
    hue: { label: 'Colour only', unit: m => m.unit, colour: true, paint: 'hue',
           tip: 'The light\'s colour at full brightness wherever it landed, so a dim fringe shows' },
}

/** The quantities this map can show: illuminance always, the colour ones when it carries X and Z. */
export const quantitiesOf = m => Object.keys(MAP_QUANTITIES).filter(k => !MAP_QUANTITIES[k].colour || !!m?.EX)

/** The map with `key`'s values in place of E (see THE RESULT above). E itself comes back as it is, and
 *  so does it for the two that paint the light (`paint`), carrying X and Z to paint with.
 *  `target` ([x, y]) is dTarget's; without it, the map's whole colour. */
export function quantityMap(m, key = 'E', { target = null } = {}) {
    const Q = MAP_QUANTITIES[key]
    if (!Q) throw new Error(`no map quantity '${key}'`)
    if (key === 'E') return { ...m, quantity: 'E', label: Q.label, lo: 0, hi: m.max }
    if (!m.EX) throw new Error(`${Q.label} needs a map with colour (hits carrying X and Z)`)
    if (Q.paint) return { ...m, quantity: key, label: Q.label, paint: Q.paint, lo: 0, hi: m.max }
    const o = {}
    if (key === 'dTarget') {
        o.target = target ?? (m.colour ? [m.colour.x, m.colour.y] : null)
        if (!o.target) throw new Error('Δu′v′ from target: no target, and the map has no colour of its own')
    }
    const n = m.nx * m.ny, E = new Float64Array(n)
    let lo = Infinity, hi = -Infinity, s2 = 0, sw = 0
    for (let i = 0; i < n; i++) {
        const v = Q.cell(m, i, o)
        E[i] = v
        if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; s2 += m.E[i] * v * v; sw += m.E[i] }
    }
    if (!(hi >= lo)) { lo = 0; hi = 0 }
    if (Q.zero) lo = 0                                          // a distance: 0 is on target
    /* the whole detector's distance from the target, and the cells': their largest and the rms weighted
       by illuminance -- the same statistics as detmap.js's colour uniformity, from another centre */
    const off = key === 'dTarget' ? { target: o.target, whole: m.colour ? dUpVp([m.colour.x, m.colour.y], o.target) : null,
                                      max: sw > 0 ? hi : null, rms: sw > 0 ? Math.sqrt(s2 / sw) : null } : undefined
    return { ...m, E, quantity: key, label: Q.label, unit: Q.unit(m), lo, hi, max: hi, off,
             count: undefined, se: undefined, smooth: m.smooth, relNoise: null, EX: undefined, EZ: undefined }
}
