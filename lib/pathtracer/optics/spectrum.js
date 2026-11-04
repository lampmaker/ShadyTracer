//======================================================================================================================
// WHAT A DETECTOR RECEIVED, BY WAVELENGTH (0.next; roadmap/LIGHT_MODEL.md S2) -- its hits' spectrum, binned, and the
// numbers a datasheet gives for it: xy, CCT, Duv and the colour rendering index.
//
//   const S = detectorSpectrum(hits)   // hits as the trace by wavelength reads them back (index.js hitsOf: h.lam, h.w)
//   S.values                           // W/nm, every 5 nm from 360 to 830 (bin i about 360 + 5 i), S.lo, S.step
//   S.xy, S.cct, S.duv, S.cri, S.criSe, S.hits, S.lm, S.W
//
// WHERE IT COMES FROM. A ray of the spectral trace carries three wavelengths and a weight each (optics/spectral.js),
// in the source's unit: the sources are normalised so that sum_k w_k ybar(lambda_k) is the hit's luminous flux in lm,
// its expectation the light's. The same weights, divided by 683 lm/W, are each an estimate of the radiant power at its
// wavelength: E[sum_k 1(lambda_k in a bin) w_k] / 683 is the power in that bin, W -- so a bin's power is the sum of
// what landed in it over 683, and over its 5 nm, W/nm. A ray collapsed to one wavelength at a dispersive face (h.one)
// carries its weight in the first and 0 in the others: the same sum. Nothing here needs the source's spectrum.
//
// THE COLOUR (xy, CCT, Duv) is the hits' own XYZ, summed: each hit's exact integral against the CMFs at its three
// wavelengths, not the binned spectrum's (which is the same light blurred by a 5 nm box). The CRI needs a spectrum, so
// it is the binned one's, at the 5 nm CIE 13.3 itself works in (core/cri.js). A spectrum with too few hits is noisy,
// and noise in a spectrum reads as a lower index: what the index is worth is said beside it, as the spread of the
// index over four interleaved quarters of the hits (criSe), not hidden.
//
// No DOM, no GPU: optics/test/spectrum.test.mjs.
//======================================================================================================================
import { cri } from '../core/cri.js'
import { XYZtoxy, xyToCctDuv } from '../core/colorimetry.js'
import { KM } from '../core/spd.js'

export const SPECTRUM_LO = 360, SPECTRUM_STEP = 5, SPECTRUM_BINS = (830 - 360) / 5 + 1
const QUARTERS = 4

/** The binned power of `hits` (those carrying wavelengths), W/nm per bin; also the power and the hits counted. */
function bin(hits, keep = () => true) {
    const values = new Float64Array(SPECTRUM_BINS)
    let n = 0
    hits.forEach((h, i) => {
        if (!h.lam || !h.w || !keep(i)) return
        n++
        for (let k = 0; k < 3; k++) {
            const w = h.w[k]
            if (!w) continue
            const b = Math.round((h.lam[k] - SPECTRUM_LO) / SPECTRUM_STEP)
            if (b >= 0 && b < SPECTRUM_BINS) values[b] += w
        }
    })
    for (let b = 0; b < SPECTRUM_BINS; b++) values[b] /= KM * SPECTRUM_STEP
    return { values, n }
}

/** A spectrum's CRI, or null (no CCT: core/cri.js) */
const criOf = values => cri({ lo: SPECTRUM_LO, step: SPECTRUM_STEP, values })

/**
 * What `hits` received by wavelength. Null when none of them carries wavelengths (a trace in colour, not by
 * wavelength: the scene's `spectral` feature off).
 */
export function detectorSpectrum(hits) {
    const all = bin(hits)
    if (!all.n) return null
    const XYZ = [0, 0, 0]
    let lm = 0
    for (const h of hits) {
        if (!h.lam) continue
        lm += h.flux
        if (h.xyz) for (let k = 0; k < 3; k++) XYZ[k] += h.xyz[k]
    }
    const xy = XYZtoxy(XYZ)
    const c = xy ? xyToCctDuv(xy[0], xy[1]) : null
    const index = criOf(all.values)
    // the index's spread over four quarters of the hits, each its own spectrum: a quarter has a quarter's hits, so its
    // Ra's spread is twice the whole's -- the whole's standard error is the quarters' standard deviation / 2
    let criSe = null
    if (index && all.n >= 4 * QUARTERS) {
        const q = []
        for (let j = 0; j < QUARTERS; j++) { const r = criOf(bin(hits, i => i % QUARTERS === j).values); if (r) q.push(r) }
        if (q.length === QUARTERS) {
            const sd = key => { const v = q.map(key), m = v.reduce((a, x) => a + x, 0) / v.length
                                return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)) / Math.sqrt(QUARTERS) }
            criSe = { Ra: sd(r => r.Ra), R9: sd(r => r.R[8]) }
        }
    }
    let W = 0
    for (const v of all.values) W += v * SPECTRUM_STEP
    return { values: all.values, lo: SPECTRUM_LO, step: SPECTRUM_STEP, hits: all.n, lm, W, XYZ, xy,
             cct: c?.inRange ? c.cct : null, duv: c?.inRange ? c.duv : null, cri: index, criSe }
}

/** The spectrum as a file: nm, W/nm. */
export function spectrumCSV(S, what = 'detector') {
    const rows = [`# the spectrum the ${what} received, W/nm, every ${S.step} nm (each a ${S.step} nm bin about it); ${S.hits} hits, `
                  + `${S.lm.toPrecision(6)} lm, ${S.W.toPrecision(6)} W from 360 to 830 nm`, 'nm,W_per_nm']
    S.values.forEach((v, i) => rows.push(`${S.lo + i * S.step},${v}`))
    return rows.join('\n')
}
