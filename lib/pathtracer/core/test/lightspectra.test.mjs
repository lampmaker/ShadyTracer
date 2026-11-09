// node lib/pathtracer/core/test/lightspectra.test.mjs
//
// core/lightspectra.js (0.84.0): a light's photon draws its wavelength at a prism from that light's own spectrum. The
// user's two LEDs (2026-11-07): one peak at 450 nm, 10 nm wide, and a red one -- each table's colour the spectrum's own
// (spd.js spdRGB), its cells adding up to it exactly, the draw landing only where the light is (the red LED never below
// 560 nm, where the channels' weights put 4.6 % of its red under 480 nm), its mean the light's colour; a laser line
// in its own 1 nm cell; a blackbody; what a tint before the glass does; the learn buffer's region; and the source
// records' [4].w as optics/sources.js writes it. And THE CHANNELS' OWN DRAW at 1 nm (0.84.0; specDraw, CAMERA_TABLE),
// every other ray's: each channel's mean weight exactly 1 and none above 3, its weights the CIE table's clipped Rec.709
// functions, a colour's step from one cell to the next a tenth of the 10 nm bins' it replaced, and its slot past the
// lights'. No GPU (dispersion.gpu.mjs runs the WGSL).
import { lightSpectrumTable, lsDraw, lsBeta, lightSpectraWords, LS_LO, LS_CELLS, LS_MAX, LS_HEAD, LS_STRIDE, LS_WORDS, PIX_LS,
         LS_LIGHT_WORDS, LS_CAM, CAMERA_TABLE, specDraw, cameraTableWords } from '../lightspectra.js'
import { LS_BASE, LIGHT_SPECTRA_WGSL } from '../lightspectra_wgsl.js'
import { cieAt } from '../spd.js'
import { XYZ_TO_RGB709 } from '../colorimetry.js'
import { spdRGB } from '../spd.js'
import { SPEC_WEIGHTS, SPEC_LO, SPEC_STEP, rgbBar } from '../spectral.js'
import { rgbToXYZ, XYZtoxy } from '../colorimetry.js'
import { LEARN_WORDS, LT_CELLS } from '../tracebasics.js'
import { MF_WORDS } from '../microfacet.js'
import { sourceRecords, defaultSource } from '../../optics/sources.js'
import { SRC_VEC4 } from '../../optics/kernels.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const xyOf = c => XYZtoxy(rgbToXYZ(c))
const dxy = (a, b) => { const p = xyOf(a), q = xyOf(b); return Math.hypot(p[0] - q[0], p[1] - q[1]) }

const BLUE = { spectrum: { kind: 'peaks', peaks: [{ nm: 450, fwhm: 10, weight: 1 }] } }
const RED = { spectrum: { kind: 'peaks', peaks: [{ nm: 630, fwhm: 20, weight: 1 }] } }
const LASER = { spectrum: { kind: 'peaks', peaks: [{ nm: 532.3, fwhm: 0.01, weight: 1 }] } }
const PLANCK = { planck: 4000 }
const N = 1 << 16
// the draw at N evenly spread u: the mean colour, and the probability below / above a wavelength
const drawn = (T, below = 0, above = 1e9) => {
    const mean = [0, 0, 0]
    let lo = 0, hi = 0, min = Infinity, max = -Infinity
    for (let j = 0; j < N; j++) {
        const d = lsDraw(T, (j + 0.5) / N)
        for (let k = 0; k < 3; k++) mean[k] += d.col[k] / N
        if (d.lambda < below) lo++
        if (d.lambda > above) hi++
        min = Math.min(min, d.lambda); max = Math.max(max, d.lambda)
    }
    return { mean, lo: lo / N, hi: hi / N, min, max }
}

for (const [name, desc] of [['the 450 nm LED', BLUE], ['the red LED', RED], ['a 0.01 nm laser line at 532.3 nm', LASER], ['a 4000 K blackbody', PLANCK]]) {
    const T = lightSpectrumTable(desc)
    const own = spdRGB(desc.spectrum ?? { kind: 'planck', T: desc.planck })
    ok(`${name}: its table's colour at luminance 1`, Math.abs(lum(T.hue) - 1) < 1e-12, `${lum(T.hue)}`)
    // 380-780 nm against the table's 360-830: the eye barely sees the rest
    ok(`${name}: its table's colour the spectrum's own (spdRGB) within 2e-4 in xy`, dxy(T.hue, own) < 2e-4, `${T.hue} against ${own}: ${dxy(T.hue, own)}`)
    // the cells add up to it: sum q_i col_i, q_i the CDF's steps
    const sum = [0, 0, 0]
    for (let i = 0; i < LS_CELLS; i++) { const q = T.cdf[i] - (i ? T.cdf[i - 1] : 0); for (let k = 0; k < 3; k++) sum[k] += q * T.col[3 * i + k] }
    ok(`${name}: its cells' colours over their draw add up to it exactly`, sum.every((v, k) => Math.abs(v - T.hue[k]) <= 1e-9 * Math.max(1, Math.abs(T.hue[k]))), `${sum} against ${T.hue}`)
    ok(`${name}: the CDF ends at 1 and never goes back`, T.cdf[LS_CELLS - 1] === 1 && T.cdf.every((c, i) => !i || c >= T.cdf[i - 1]))
    const d = drawn(T)
    ok(`${name}: the draw's mean colour is its own within 1e-3 of its largest channel`,
       d.mean.every((v, k) => Math.abs(v - T.hue[k]) < 1e-3 * Math.max(...T.hue.map(Math.abs))), `${d.mean} against ${T.hue}`)
}
{
    // WHERE THE LIGHT GOES: only where the light is
    const b = drawn(lightSpectrumTable(BLUE), 435, 465)
    ok('the 450 nm LED: under 0.1 % of its photons outside 435-465 nm (its +-3.5 sigma)', b.lo + b.hi < 1e-3, `${b.lo} below, ${b.hi} above`)
    ok('the 450 nm LED: none past 480 nm, where its red part was thrown before', b.max < 480, `the longest ${b.max}`)
    const r = drawn(lightSpectrumTable(RED), 560)
    ok('the red LED: no photon below 560 nm (none in the violet)', r.lo === 0 && r.min > 560, `${r.lo}, the shortest ${r.min}`)
    // ...and what the channels' weights did with it: the red channel's share below 480 nm, the violet band the user saw
    const red480 = SPEC_WEIGHTS.reduce((s, w, k) => s + (SPEC_LO + (k + 1) * SPEC_STEP <= 480 ? w[0] : 0), 0)
    ok('(the channels\' weights, for contrast: 4.6 % of the red channel below 480 nm)', Math.abs(red480 - 0.046) < 0.002, `${red480}`)
    const l = drawn(lightSpectrumTable(LASER))
    ok('a 0.01 nm laser line: every photon in its own 1 nm cell, 532-533 nm', l.min >= 532 && l.max <= 533, `${l.min} - ${l.max}`)
    // each wavelength its own colour: the laser's every photon the line's exact colour, a negative channel kept
    const T = lightSpectrumTable(LASER), c = lsDraw(T, 0.5).col
    ok('a laser line: each photon its colour exactly', c.every((v, k) => Math.abs(v - T.hue[k]) < 1e-9 * Math.max(1, Math.abs(v))), `${c} against ${T.hue}`)
    const B = lightSpectrumTable(BLUE)
    ok('the 450 nm LED: its green channel negative, as its colour is (outside the gamut, kept)', B.hue[1] < -4 && lsDraw(B, 0.5).col[1] < 0, `${B.hue}`)
}
{
    // WHAT MET IT BEFORE THE GLASS (lsBeta): untouched, the cell's colour; a tint, the same tint on it; a channel with
    // none of the light, the luminance's ratio
    const T = lightSpectrumTable(BLUE), col = lsDraw(T, 0.3).col
    const same = lsBeta(T.hue, T.hue, col)
    ok('lsBeta: a photon nothing coloured takes the cell\'s colour', same.every((v, k) => Math.abs(v - col[k]) < 1e-12 * Math.max(1, Math.abs(col[k]))))
    const tint = [0.5, 0.8, 0.9], half = lsBeta(T.hue.map((h, k) => h * tint[k] * 0.25), T.hue, col)
    ok('lsBeta: a tint and a loss before it, the same on the cell\'s colour', half.every((v, k) => Math.abs(v - col[k] * tint[k] * 0.25) < 1e-12 * Math.max(1, Math.abs(col[k]))))
    const z = lsBeta([0.5, 0.5, 0], [1, 1, 0], [2, 3, 4])
    ok('lsBeta: a channel of none of the light takes the luminance\'s ratio', Math.abs(z[2] - 4 * lum([0.5, 0.5, 0]) / lum([1, 1, 0])) < 1e-12 && Math.abs(z[0] - 1) < 1e-12, `${z}`)
}
{
    // THE REGION in the learn buffer: past the microfacet tables; the count, each table's colour, CDF and cells
    ok('the region past learn\'s own words and the microfacet tables', LS_BASE === LEARN_WORDS + MF_WORDS && LS_LIGHT_WORDS === LS_HEAD + LS_MAX * LS_STRIDE)
    ok('PIX_LS above every sun-map cell, the table in its low 16 bits', PIX_LS > LT_CELLS && (PIX_LS & 0xFFFF) === 0 && LS_MAX < 0xFFFF)
    const A = lightSpectrumTable(BLUE), B = lightSpectrumTable(RED)
    const w = lightSpectraWords([A, B]), f = new Float32Array(w.buffer)
    ok('the region: its count', w[0] === 2 && w.length === LS_LIGHT_WORDS)
    const o = LS_HEAD + LS_STRIDE
    ok('the region: the second table\'s colour, CDF and cells where the WGSL reads them',
       f[o + 1] === Math.fround(B.hue[1]) && f[o + 4 + LS_CELLS - 1] === 1 && f[o + 4 + 250] === Math.fround(B.cdf[250])
       && f[o + 4 + LS_CELLS + 3 * 250 + 2] === Math.fround(B.col[3 * 250 + 2]))
    ok('the region: at most LS_MAX tables', lightSpectraWords(Array(LS_MAX + 3).fill(A))[0] === LS_MAX)
    ok('a spectrum with no light in 380-780 nm has no table', lightSpectrumTable({ spectrum: { kind: 'peaks', peaks: [{ nm: 900, fwhm: 10, weight: 1 }] } }) === null)
    ok('the cells start at 380 nm, 1 nm each, to 780', LS_LO === 380 && LS_CELLS === 400)
    ok('the lights\' part of the region stops short of the channels\' table, the last slot', lightSpectraWords([A]).length === LS_LIGHT_WORDS
       && LS_CAM === LS_LIGHT_WORDS && LS_WORDS === LS_CAM + LS_STRIDE)
}
{
    // THE SOURCE RECORDS (optics/sources.js): [4].w its table + 1, one table a distinct spectrum; none for a colour
    const face = extra => ({ ...defaultSource(), onSurface: true, ...extra })
    const t = sourceRecords([face({ ...BLUE, colour: spdRGB(BLUE.spectrum) }), face({ colour: [1, 0, 0] }),
                             face({ ...BLUE, colour: spdRGB(BLUE.spectrum) }), face({ ...PLANCK }), face({ ...RED })])
    const ls = k => t.data[k * SRC_VEC4 * 4 + 4 * 4 + 3]
    ok('records: a light by its spectrum its table + 1, the same spectrum the same table, a colour none, a blackbody its own',
       ls(0) === 1 && ls(1) === 0 && ls(2) === 1 && ls(3) === 2 && ls(4) === 3, [0, 1, 2, 3, 4].map(ls).join(' '))
    ok('records: the region holds the three', t.lightSpectra[0] === 3 && t.lightSpectraDropped === 0)
    const many = sourceRecords(Array.from({ length: LS_MAX + 2 }, (_, k) => face({ spectrum: { kind: 'peaks', peaks: [{ nm: 420 + 10 * k, fwhm: 10, weight: 1 }] } })))
    ok(`records: past ${LS_MAX} distinct spectra, none, and how many said`,
       many.lightSpectra[0] === LS_MAX && many.lightSpectraDropped === 2 && many.data[(LS_MAX + 1) * SRC_VEC4 * 4 + 19] === 0 && many.data[(LS_MAX - 1) * SRC_VEC4 * 4 + 19] === LS_MAX)
}

{
    // THE CHANNELS' OWN DRAW (specDraw): each channel's mean weight exactly 1, none above 3
    const T = CAMERA_TABLE, q = i => T.cdf[i] - (i ? T.cdf[i - 1] : 0)
    const mean = [0, 1, 2].map(c => Array.from({ length: LS_CELLS }, (_, i) => q(i) * T.col[3 * i + c]).reduce((a, b) => a + b, 0))
    ok('the channels\' draw: each channel\'s mean weight exactly 1 (every cell\'s chance times its weight)', mean.every(v => Math.abs(v - 1) < 1e-12), `${mean}`)
    ok('...and none above 3, where one channel alone responds', Math.max(...T.col) <= 3 + 1e-12)
    let inCell = true, avg = [0, 0, 0]
    for (let j = 0; j < N; j++) { const d = specDraw((j + 0.5) / N); if (!(d.lambda >= LS_LO + d.k && d.lambda <= LS_LO + d.k + 1)) inCell = false; d.w.forEach((v, c) => avg[c] += v / N) }
    ok('...each wavelength inside its 1 nm cell, 65 536 evenly spread draws averaging 1 within 1e-3', inCell && avg.every(v => Math.abs(v - 1) < 1e-3), `${avg}`)
    // the weights: the CIE's own table through the Rec.709 matrix, clipped, at a cell's middle against the cell's mean
    const at = l => XYZ_TO_RGB709.map(r => Math.max(0, r[0] * cieAt(l)[0] + r[1] * cieAt(l)[1] + r[2] * cieAt(l)[2]))
    // (each channel at two wavelengths where it is positive)
    const pairs = [[600, 650], [520, 560], [440, 470]]
    const shape = pairs.map(([a, b], c) => (T.w[3 * (a - LS_LO) + c] / T.w[3 * (b - LS_LO) + c]) / (at(a + 0.5)[c] / at(b + 0.5)[c]))
    ok('...its weights the CIE table\'s clipped Rec.709 functions (two cells\' ratio as the table\'s, within 1e-3)', shape.every(v => Math.abs(v - 1) < 1e-3), `${shape}`)
    // a colour's step from one cell to the next, in u'v': the 10 nm bins' 0.136 at 480 nm, a tenth of it now
    const uv = c => { const x = rgbToXYZ(c), d = x[0] + 15 * x[1] + 3 * x[2]; return [4 * x[0] / d, 9 * x[1] / d] }
    const step = (W, n) => { let m = 0; for (let k = Math.round(n * 0.05); k < Math.round(n * 0.8); k++) { const a = uv(W(k)), b = uv(W(k + 1)); m = Math.max(m, Math.hypot(a[0] - b[0], a[1] - b[1])) } return m }
    const s1 = step(k => [0, 1, 2].map(c => T.w[3 * k + c]), LS_CELLS), s10 = step(k => SPEC_WEIGHTS[k], 40)
    ok('...a wavelength\'s colour steps at most 0.02 u\'v\' a cell (400-700 nm), where the 10 nm bins stepped 0.13', s1 < 0.02 && s10 > 0.13, `${s1} against ${s10}`)
    const w = cameraTableWords(), f = new Float32Array(w.buffer)
    ok('...as the learn buffer takes it: (1, 1, 1), the CDF, the weights', w.length === LS_STRIDE && f[0] === 1 && f[4 + LS_CELLS - 1] === 1
       && f[4 + LS_CELLS + 3 * 200 + 1] === Math.fround(T.col[3 * 200 + 1]))
    ok('...and the WGSL draws it at its slot', LIGHT_SPECTRA_WGSL.includes('fn specDraw(u: f32) -> SpecDraw { return lsDrawAt(LS_CAM + 4u, u); }')
       && LIGHT_SPECTRA_WGSL.includes(`const LS_CAM: u32 = ${LS_CAM}u;`))
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
