//======================================================================================================================
// CRI -- the CIE colour rendering index of a spectrum (CIE 13.3-1995): Ra, and every Ri, R9 among them.
//
// WHY THIS EXISTS (0.83.0; roadmap/LIGHT_MODEL.md S2; the user, 2026-11-03: "PPFD, EDI later; CRI yes"). An LED is
// chosen by its CRI as much as by its CCT, and a lens or a coloured diffuser can change it: what a detector receives is
// not the source's spectrum. The index needs the spectrum, which the renderer's three channels never had: a light given
// by its spectrum (core/spd.js) has one, and the spectral optics trace gives one to what a detector receives.
//
// THE METHOD, as CIE 13.3 gives it, step by step:
//   1. the test source's CCT, and its distance DC from the Planckian locus in CIE 1960 uv (13.3 calls the index
//      meaningless past 5.4e-3, which is said, not refused);
//   2. a reference of that CCT: a blackbody below 5000 K, the CIE's daylight (from its S0, S1 and S2) at and above;
//   3. the 14 test colour samples' XYZ under each, the source normalised to Y = 100, every 5 nm from 360 to 830 nm
//      (the CIE's own tables: ciedata.js TCS, cie1931.js at its 5 nm rows);
//   4. a von Kries adaptation of the test side to the reference white in CIE 1960 uv (13.3's c and d);
//   5. each sample's colour difference in the 1964 U*V*W* space, and Ri = 100 - 4.6 Delta E.
//   Ra is the mean of R1 to R8. R9 (a saturated red) is the one LED datasheets add.
//
// CHECKED (cri.test.mjs): the CIE's fluorescent and LED illuminants against colour-science's implementation of the same
// method (version 0.4.7, run 2026-11-04 in this container: the numbers are written into the test), a blackbody and the
// CIE's daylight reading 100. Pure functions, no GPU.
//======================================================================================================================
import { CIE_LO, CIE_X, CIE_Y, CIE_Z } from './cie1931.js'
import { CIE_TCS, CIE_DAYLIGHT } from './ciedata.js'
import { xyToCctDuv, xyToUv } from './colorimetry.js'
import { spdAt, C2 } from './spd.js'

const LO = 360, HI = 830, STEP = 5, N = (HI - LO) / STEP + 1
const NM = Float64Array.from({ length: N }, (_, i) => LO + i * STEP)
const cmf5 = i => { const k = NM[i] - CIE_LO; return [CIE_X[k], CIE_Y[k], CIE_Z[k]] }
const tcs = Object.values(CIE_TCS.columns)                 // 14 columns, 360-830 at 5 nm: the same rows as NM

/** A spectrum to rate: a core/spd.js spectrum, a function of lambda (nm), or { lo, step, values } sampled. */
function sampler(s) {
    if (typeof s === 'function') return s
    if (s && Array.isArray(s.values) || s?.values instanceof Float64Array || s?.values instanceof Float32Array) {
        const { lo, step, values } = s
        return l => {
            const f = (l - lo) / step, i = Math.floor(f)
            if (i < 0 || i >= values.length - 1) return i === values.length - 1 && f === i ? values[i] : 0
            return values[i] + (f - i) * (values[i + 1] - values[i])
        }
    }
    return l => spdAt(s, l)
}
const planck = T => l => { const m = l * 1e-9; return 1 / (m ** 5 * Math.expm1(C2 / (m * T))) }
/** The CIE's daylight of CCT T (CIE 015:2018 eq. 4.7-4.9, 4000 to 25 000 K): its xy, then S0 + M1 S1 + M2 S2. */
export function daylight(T) {
    const xD = T <= 7000 ? -4.6070e9 / T ** 3 + 2.9678e6 / T ** 2 + 0.09911e3 / T + 0.244063
                         : -2.0064e9 / T ** 3 + 1.9018e6 / T ** 2 + 0.24748e3 / T + 0.237040
    const yD = -3.000 * xD * xD + 2.870 * xD - 0.275
    const M = 0.0241 + 0.2562 * xD - 0.7341 * yD
    const M1 = (-1.3515 - 1.7703 * xD + 5.9114 * yD) / M, M2 = (0.0300 - 31.4424 * xD + 30.0717 * yD) / M
    const { lo, columns: { S0, S1, S2 } } = CIE_DAYLIGHT
    return l => {
        const f = (l - lo) / 5, i = Math.floor(f), t = f - i
        if (i < 0 || i >= S0.length - 1) return 0
        const at = A => A[i] + t * (A[i + 1] - A[i])
        return at(S0) + M1 * at(S1) + M2 * at(S2)
    }
}

/** XYZ of the source and of each sample under it, the source at Y = 100. */
function rendered(S) {
    const sv = Array.from(NM, l => S(l))
    let k = 0
    for (let i = 0; i < N; i++) k += sv[i] * cmf5(i)[1]
    k = k > 0 ? 100 / k : 0
    const xyz = refl => {
        const o = [0, 0, 0]
        for (let i = 0; i < N; i++) { const c = cmf5(i), w = sv[i] * (refl ? refl[i] : 1) * k; o[0] += w * c[0]; o[1] += w * c[1]; o[2] += w * c[2] }
        return o
    }
    return { white: xyz(null), samples: tcs.map(xyz) }
}
const uvOf = ([X, Y, Z]) => { const d = X + 15 * Y + 3 * Z; return d > 0 ? [4 * X / d, 6 * Y / d] : [0, 0] }
const cd = ([u, v]) => [(4 - u - 10 * v) / v, (1.708 * v + 0.404 - 1.481 * u) / v]

/**
 * The colour rendering index of a spectrum: { Ra, R: [R1..R14], cct, duv, dc, reference: 'planck' | 'daylight', valid }.
 * valid is DC <= 5.4e-3, the distance from the locus past which CIE 13.3 says the index means little. Null for a
 * spectrum with no light, or a CCT outside 1000-15 000 K (the locus's fit, colorimetry.js).
 */
export function cri(spectrum) {
    const S = sampler(spectrum)
    const test = rendered(S)
    const [x, y] = (() => { const [X, Y, Z] = test.white, s = X + Y + Z; return s > 0 ? [X / s, Y / s] : [0, 0] })()
    if (!(test.white[1] > 0)) return null
    // the CCT's search is the locus's, Krystek's fit, 1000-15 000 K (colorimetry.js): past it, no CCT and no index
    const { cct, duv, inRange } = xyToCctDuv(x, y)
    if (!inRange) return null
    const reference = cct < 5000 ? 'planck' : 'daylight'
    const ref = rendered(reference === 'planck' ? planck(cct) : daylight(cct))
    const uk = uvOf(test.white), ur = uvOf(ref.white)
    const dc = Math.hypot(uk[0] - ur[0], uk[1] - ur[1])
    const [ck, dk] = cd(uk), [cr, dr] = cd(ur)
    const R = test.samples.map((sk, i) => {
        const sr = ref.samples[i]
        // the test sample adapted to the reference white (13.3 eq. 5.1-5.3)
        const [cki, dki] = cd(uvOf(sk))
        const den = 16.518 + 1.481 * (cr / ck) * cki - (dr / dk) * dki
        const uki = (10.872 + 0.404 * (cr / ck) * cki - 4 * (dr / dk) * dki) / den, vki = 5.520 / den
        const uri = uvOf(sr)
        // U*V*W* (CIE 1964), each against its own white: the adapted test white is the reference's
        const W = Y => 25 * Math.cbrt(Y) - 17
        const Wk = W(sk[1]), Wr = W(sr[1])
        const Uk = 13 * Wk * (uki - ur[0]), Vk = 13 * Wk * (vki - ur[1])
        const Ur = 13 * Wr * (uri[0] - ur[0]), Vr = 13 * Wr * (uri[1] - ur[1])
        return 100 - 4.6 * Math.hypot(Ur - Uk, Vr - Vk, Wr - Wk)
    })
    const Ra = R.slice(0, 8).reduce((a, v) => a + v, 0) / 8
    return { Ra, R, cct, duv, dc, reference, valid: dc <= 5.4e-3 }
}
/** The same of a spectrum sampled every `step` nm from `lo` (a detector's bins). */
export const criOfSampled = (lo, step, values) => cri({ lo, step, values })
