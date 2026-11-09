// node lib/pathtracer/optics/test/spectrum.test.mjs
//
// WHAT A DETECTOR RECEIVED BY WAVELENGTH (optics/spectrum.js, 0.83.0), no GPU: hits made as the trace by wavelength
// makes them -- three wavelengths a ray through the same draw (spectral.js spLambdas), each weighted by the source's
// spectrum over three times its density, the source normalised to luminance 1 (sourceSpectrum) -- and binned. The
// binned power against the source's own spectrum and its watts; the hits' colour against the spectrum's xy; the
// index against the spectrum's own (core/cri.js), within its error bar and the 5 nm bins' blur; a ray collapsed to one
// wavelength the same sum; a trace in colour none; the CSV.
import { detectorSpectrum, spectrumCSV, SPECTRUM_LO, SPECTRUM_STEP, SPECTRUM_BINS } from '../spectrum.js'
import { spLambdas, sourceSpectrum, SP_LO, SP_N } from '../spectral.js'
import { CIE_X, CIE_Y, CIE_Z } from '../../core/cie1931.js'
import { SPD_PRESETS, KM, spdXYZ } from '../../core/spd.js'
import { cri } from '../../core/cri.js'
import { XYZtoxy } from '../../core/colorimetry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
// a seeded generator (mulberry32): the same hits every run
const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
                              t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(20261104)
// the GPU reads every table linearly between its 1 nm nodes (spectral.js spNode)
const lin = (T, l) => { const f = l - SP_LO, i = Math.min(SP_N - 2, Math.max(0, Math.floor(f))); return T[i] + (f - i) * (T[i + 1] - T[i]) }

const SPD = SPD_PRESETS['CIE LED-B3 (phosphor, 4100 K)']
const { values: S } = sourceSpectrum({ spectrum: SPD })          // luminance 1
/** n hits of `lm` lumens in all, as the trace reads them back (index.js hitsOf): flux, xyz, lam, w -- the source's
 *  weights scaled by lm / n, each hit a ray */
const hitsOf = (n, lm, { collapse = 0 } = {}) => Array.from({ length: n }, () => {
    const d = spLambdas(rng())
    let lam = d.map(q => q.lambda), w = d.map(q => lm / n * lin(S, q.lambda) / (3 * q.pdf))
    // collapsed at a dispersive face: the first wavelength, three times its weight (spectral.js specDraw)
    const one = rng() < collapse
    if (one) w = [3 * w[0], 0, 0]
    const xyz = [CIE_X, CIE_Y, CIE_Z].map(T => w.reduce((a, v, k) => a + v * lin(T, lam[k]), 0))
    return { pos: [0, 0, 0], flux: xyz[1], tag: 1, xyz, lam, w, ...(one ? { one: true } : {}) }
})

{
    const N = 200000, LM = 100
    const H = hitsOf(N, LM)
    const R = detectorSpectrum(H)
    ok('a bin every 5 nm from 360 to 830', R.values.length === SPECTRUM_BINS && SPECTRUM_BINS === 95 && R.lo === SPECTRUM_LO && R.step === SPECTRUM_STEP)
    ok('every hit counted', R.hits === N)
    // the power: the source's spectrum carries LM lumens, so its watts are LM / 683 times its integral over its luminance (1)
    let W = 0
    for (let i = 0; i + 1 < SP_N; i++) W += 0.5 * (S[i] + S[i + 1])
    W *= LM / KM
    ok('its watts the source\'s, within 1 %', Math.abs(R.W / W - 1) < 0.01, `${R.W} against ${W}`)
    ok('its lumens the hits\' flux', Math.abs(R.lm - H.reduce((a, h) => a + h.flux, 0)) < 1e-9 * R.lm)
    // each bin against the source's own power in it, at the bins that carry most of it (the peak and the phosphor)
    const want = b => { let s = 0; const l0 = SPECTRUM_LO + SPECTRUM_STEP * (b - 0.5)
                        for (let k = 0; k < 50; k++) s += lin(S, l0 + (k + 0.5) * SPECTRUM_STEP / 50) / 50
                        return s * LM / KM }
    // each bin's own error bar: its contributions' spread (a hit adds to a bin at most once a wavelength, independently)
    const sq = new Float64Array(SPECTRUM_BINS)
    for (const h of H) for (let k = 0; k < 3; k++) { const b = Math.round((h.lam[k] - SPECTRUM_LO) / SPECTRUM_STEP); if (b >= 0 && b < SPECTRUM_BINS) sq[b] += h.w[k] ** 2 }
    const se = b => Math.sqrt(sq[b]) / (KM * SPECTRUM_STEP)
    const strong = [...R.values.keys()].filter(b => want(b) > 0.3 * Math.max(...R.values))
    const worst = Math.max(...strong.map(b => Math.abs(R.values[b] - want(b)) / se(b)))
    const rel = Math.max(...strong.map(b => se(b) / want(b)))
    ok('each strong bin the source\'s power in it, W/nm, within 4 sigma', strong.length > 10 && worst < 4, `${strong.length} bins, worst ${worst} sigma, sigma up to ${rel}`)
    // the colour: the hits' own XYZ, against the spectrum's
    const xy0 = XYZtoxy(spdXYZ(SPD)), d = Math.hypot(R.xy[0] - xy0[0], R.xy[1] - xy0[1])
    ok('its xy the spectrum\'s, within 0.001', d < 1e-3, `${R.xy} against ${xy0}`)
    ok('...its CCT where CIE LED-B3 is (about 4100 K)', Math.abs(R.cct - 4100) < 60, String(R.cct))
    // the index: the spectrum's own, within three of its error bars and the blur of a 5 nm bin (below)
    const own = cri(SPD)
    ok('an index and its error bar', R.cri && R.criSe && R.criSe.Ra > 0 && R.criSe.R9 > 0, JSON.stringify(R.criSe))
    ok('Ra the spectrum\'s own, within 3 sigma + 1', Math.abs(R.cri.Ra - own.Ra) < 3 * R.criSe.Ra + 1, `${R.cri.Ra} ± ${R.criSe.Ra} against ${own.Ra}`)
    ok('R9 the spectrum\'s own, within 3 sigma + 2', Math.abs(R.cri.R[8] - own.R[8]) < 3 * R.criSe.R9 + 2, `${R.cri.R[8]} ± ${R.criSe.R9} against ${own.R[8]}`)
    // what a 5 nm bin does on its own, noise apart: the source's spectrum averaged over each bin, rated
    const binned = Float64Array.from({ length: SPECTRUM_BINS }, (_, b) => want(b))
    const blur = cri({ lo: SPECTRUM_LO, step: SPECTRUM_STEP, values: binned })
    ok('...the bins\' blur alone moves Ra under 1 and R9 under 2', Math.abs(blur.Ra - own.Ra) < 1 && Math.abs(blur.R[8] - own.R[8]) < 2, `Ra ${blur.Ra} R9 ${blur.R[8]} against ${own.Ra} ${own.R[8]}`)
    // the file
    const csv = spectrumCSV(R, 'screen').split('\n')
    ok('the CSV: a note, a header, a row a bin, nm and W/nm', /^# the spectrum the screen received/.test(csv[0]) && csv[1] === 'nm,W_per_nm' && csv.length === 2 + SPECTRUM_BINS
       && csv[2].startsWith('360,') && csv.at(-1).startsWith('830,') && Math.abs(+csv[2 + (450 - 360) / 5].split(',')[1] - R.values[18]) < 1e-15)
}

{
    // COLLAPSED at a dispersive face: one wavelength, its weight three times -- the same light, the same sums
    const R = detectorSpectrum(hitsOf(200000, 100, { collapse: 0.5 }))
    ok('rays collapsed to one wavelength: the same watts', Math.abs(R.W / detectorSpectrum(hitsOf(200000, 100)).W - 1) < 0.01)
    const xy0 = XYZtoxy(spdXYZ(SPD))
    ok('...and the same xy within 0.0015', Math.hypot(R.xy[0] - xy0[0], R.xy[1] - xy0[1]) < 1.5e-3, String(R.xy))
}

{
    ok('a trace in colour: no spectrum', detectorSpectrum([{ pos: [0, 0, 0], flux: 1, xyz: [1, 1, 1], tag: 1 }]) === null)
    ok('...nor no hits', detectorSpectrum([]) === null)
    const few = detectorSpectrum(hitsOf(10, 1))
    ok('ten hits: a spectrum, and no error bar for its index (too few to split)', few && few.hits === 10 && few.criSe === null)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
