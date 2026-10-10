//======================================================================================================================
// MEASURE -- turning what resolve keeps per pixel into a reading with an error bar.
//
// prog_resolve (wavefront.js, THE ERROR BAR) keeps, beside each pixel's mean colour, two numbers:
// V, the weighted variance of that pixel's samples about their weighted mean, and S, the sum of
// the squared weights of the samples still in the average. Both follow the same weight w = 1/cnt
// the mean does, so they are exact for a true mean (maxaverages 0) and for an EMA window alike.
//
// This file is the host's half: the formula from (V, S) to a standard error, and a JS mirror of
// the kernel's update so the test can run the arithmetic without a GPU. The mirror is only as
// right as its correspondence with the WGSL; keep the two next to each other when either changes.
//======================================================================================================================
import { LUMA } from './photometry.js'
import { rgbToXYZ, XYZtoxy, xyToCctDuv, xyToUpVp } from './colorimetry.js'

/** THE COLOUR OF A READING: a pixel's (or an area's) linear Rec.709 mean as CIE xy, u'v', and CCT +
 *  Duv when it is near enough the Planckian locus to have them (|Duv| <= 0.05, 1000-15000 K). Exact
 *  even outside the display's gamut: the accumulation keeps negative channels (wavefront.js
 *  badDeposit). In the illuminance view the first surface is white, so this is the colour of the
 *  LIGHT arriving there; in the picture it is the light times the surface. null for no light. */
export function chromaOf(rgb) {
    const xy = XYZtoxy(rgbToXYZ(rgb))
    if (!xy || !(LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2] > 0)) return null
    const t = xyToCctDuv(xy[0], xy[1])
    const [u, v] = xyToUpVp(xy[0], xy[1])
    const cct = t.inRange && Math.abs(t.duv) <= 0.05
    return { x: xy[0], y: xy[1], u, v, cct: cct ? t.cct : null, duv: cct ? t.duv : null }
}
/** ...as a short label: "3012 K Duv +0.0021", or "xy 0.150 0.025" away from white. */
export const fmtChroma = c => !c ? '' : c.cct != null
    ? `${Math.round(c.cct)} K Duv ${c.duv >= 0 ? '+' : ''}${c.duv.toFixed(4)}`
    : `xy ${c.x.toFixed(3)} ${c.y.toFixed(3)}`

/** One resolve step, as the kernel does it. `st` is { Y, V, S, cnt } for one pixel, `y` this
 *  sample's luminance, `window` the EMA cap (Infinity for a true mean). Returns the new state. */
export function stepMoments(st, y, window = Infinity) {
    const prevn = Math.min(st.cnt, window), cnt = prevn + 1, w = 1 / cnt
    const d = prevn > 0 ? y - st.Y : 0           // zero at a reset, as the kernel's select()
    return {
        Y: (st.Y * prevn + y) / cnt,
        V: (1 - w) * (st.V + w * d * d),
        S: (1 - w) * (1 - w) * st.S + w * w,
        cnt,
    }
}

/** The standard error of a pixel's mean luminance from its (V, S), or null when it cannot be
 *  known: one sample (S = 1) has no spread to measure. */
export function standardError(V, S) {
    if (!(S < 1) || !(S > 0) || !(V >= 0)) return null
    return Math.sqrt(S * V / (1 - S))
}

/** What the cursor readout shows, from one pixel's accumulation words and moments.
 *  @param rgb   the pixel's mean colour, cd/m^2 (accumulation words 0..2 as f32)
 *  @param count its sample count word (0 = never sampled)
 *  @returns { L, se, rel, nEff, count } -- L in cd/m^2, se its standard error, rel = se / L,
 *           nEff = 1/S, the number of equally weighted samples the average is worth. */
export function reading(rgb, count, V, S) {
    if (!count) return null
    const L = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2]
    const se = standardError(V, S)
    // rgb too: the error bar is luminance's, but a bench checking a colour needs the channels
    return { L, se, rel: se != null && L > 0 ? se / L : null, nEff: S > 0 ? 1 / S : null, count, rgb: [rgb[0], rgb[1], rgb[2]],
             colour: chromaOf(rgb) }
}

/** The share of an area's brightest pixel a pixel needs to count in the area's colour spread. */
export const COLOUR_FLOOR = 0.1

/** WHAT A RECTANGLE OF THE PICTURE MEASURES: the average luminance over its pixels, the standard
 *  error of that average, and the spread across it.
 *
 *  THE AVERAGE IS OVER PIXELS, not over the surface they show: in perspective a pixel near the
 *  camera covers less of a floor than one far away, so on a receding surface this weights the far
 *  part more than an area average would. Square-on it is the area average.
 *
 *  THE ERROR BAR OF THE MEAN is sqrt(sum se_i^2) / N: each pixel's own samples are independent of
 *  every other's, so their errors add in quadrature. It is null when any pixel in the rectangle has
 *  no error bar yet (one sample) -- an error bar that leaves some pixels out would claim a precision
 *  the average does not have.
 *
 *  min and max are of the pixels' MEANS, which still carry their noise: early on they are wider
 *  than the light is. `uniformity` is min / mean (the lighting standard's U0), with the same caveat.
 *
 *  @param acc  the accumulation words of whole rows, from row y0: 4 words a pixel (rgb as f32 bits,
 *              then the sample count), `width` pixels a row
 *  @param mom  the moments of the same rows: 2 floats a pixel (V, S)
 *  @param x0, x1  the columns, inclusive;  rows  how many rows acc and mom hold
 *  @returns { mean, se, rel, min, max, uniformity, pixels, sampled } or null if nothing is sampled */
export function regionReading(acc, mom, width, x0, x1, rows) {
    const f = new Float32Array(acc.buffer, acc.byteOffset, acc.length)
    let n = 0, sum = 0, se2 = 0, missing = 0, min = Infinity, max = -Infinity, pixels = 0
    const rgb = [0, 0, 0]
    for (let r = 0; r < rows; r++) for (let x = x0; x <= x1; x++) {
        const i = r * width + x
        pixels++
        const cnt = acc[i * 4 + 3]
        if (!cnt) continue
        const L = LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]
        const se = standardError(mom[i * 2], mom[i * 2 + 1])
        n++; sum += L
        for (let k = 0; k < 3; k++) rgb[k] += f[i * 4 + k]
        if (se == null) missing++; else se2 += se * se
        if (L < min) min = L
        if (L > max) max = L
    }
    if (!n) return null
    const mean = sum / n
    const se = missing ? null : Math.sqrt(se2) / n
    /* THE COLOUR: of the area's mean (light adds, so this is the colour of all of it together), and
       how far the pixels stray from it in u'v' -- the largest and the luminance-weighted rms, over
       the pixels at COLOUR_FLOOR of the brightest or more. A pixel's colour is as noisy as its
       luminance, so early on the spread reads the noise. */
    const colour = chromaOf(rgb.map(v => v / n))
    if (colour) {
        let dMax = 0, s2 = 0, sw = 0
        for (let r = 0; r < rows; r++) for (let x = x0; x <= x1; x++) {
            const i = r * width + x
            if (!acc[i * 4 + 3]) continue
            const p = [f[i * 4], f[i * 4 + 1], f[i * 4 + 2]]
            const L = LUMA[0] * p[0] + LUMA[1] * p[1] + LUMA[2] * p[2]
            if (!(L >= COLOUR_FLOOR * max) || !(L > 0)) continue
            const c = chromaOf(p)
            if (!c) continue
            const d = Math.hypot(c.u - colour.u, c.v - colour.v)
            if (d > dMax) dMax = d
            s2 += L * d * d; sw += L
        }
        Object.assign(colour, { dUpVpMax: sw > 0 ? dMax : null, dUpVpRms: sw > 0 ? Math.sqrt(s2 / sw) : null })
    }
    return { mean, se, rel: se != null && mean > 0 ? se / mean : null, min, max,
             uniformity: mean > 0 ? min / mean : null, pixels, sampled: n, colour }
}
