//======================================================================================================================
// SPD -- a light given by its spectrum: a blackbody, a few peaks, or a measured table; its exact XYZ, and its efficacy.
//
// WHY THIS EXISTS (0.83.0; roadmap/LIGHT_MODEL.md S1). A light was a chromaticity -- RGB, a CCT and a Duv, or xy
// (builder/lights.js) -- which is what a datasheet's first page gives. Its last page gives the spectrum, and a design
// that will be traced by wavelength later (S2: the optics trace with spectral detectors) has to start from it. Until
// then the spectrum is turned into what the renderer carries: its exact XYZ, then its Rec.709 RGB at Y = 1, as a
// chromaticity is (colorimetry.js). Nothing on the GPU changes.
//
// EXACT MEANS THE CIE's OWN TABLE (cie1931.js: the 1931 2 degree observer at 1 nm, 360-830 nm), not spectral.js's
// analytic fit, which is 0.015 off within 450-650 nm and curls back past 644 nm: a 700 nm line came out xy (0.568,
// 0.432) where the table says (0.7347, 0.2653), and a 3000 K blackbody 24 K off (tutorial/test/tutorial.test.mjs).
//
// THE INTEGRAL is a sum of S(lambda) times the table, the table linearly interpolated between its 1 nm rows, at a step
// fine enough for the spectrum's narrowest feature: 1 nm, or a tenth of a peak's own FWHM over its own +-8 sigma, or a
// fifth of a table's closest two points. A peak narrower than 1 nm (a laser line) is integrated as finely as that needs,
// and only where it is. Outside
// 360-830 nm the observer sees nothing, so a spectrum may extend there (an IR tail) and that part counts only in its
// power, for the efficacy.
//
// THE KINDS, as a light stores them (builder/lights.js `spectrum`), relative power per nm in any unit (only its shape
// counts for the colour, and only its ratios for the efficacy):
//   { kind: 'planck', T }                          a blackbody at T kelvin (Planck's law, c2 = h c / k exactly)
//   { kind: 'peaks', peaks: [{ nm, fwhm, weight }] } Gaussian peaks, each of that full width at half maximum and that
//                                                  share of the power (its area): an LED's die, a phosphor's broad hump
//   { kind: 'table', name, points: [[nm, rel]] }   a measured spectrum, linear between its points, 0 outside them
//
// Pure functions, no GPU: core/test/spd.test.mjs.
//======================================================================================================================
import { CIE_LO, CIE_N, CIE_X, CIE_Y, CIE_Z } from './cie1931.js'
import { XYZtoRGB, XYZtoxy, xyToCctDuv } from './colorimetry.js'
import { CIE_LED } from './ciedata.js'

/** h c / k, m K: exact since the SI's 2019 definitions (h, c and k all fixed). */
export const C2 = 1.438776877e-2
/** lm/W at 540 THz (555 nm), the SI's own: what ties photometry to watts (the candela's definition). */
export const KM = 683
export const SPD_KINDS = ['planck', 'peaks', 'table']
const HI = CIE_LO + CIE_N - 1                       // 830 nm
const FWHM_SIGMA = 2 * Math.sqrt(2 * Math.log(2))   // a Gaussian's FWHM over its sigma

/** The CIE 1931 functions at lambda (nm), linear between the table's 1 nm rows, 0 outside 360-830: [x, y, z]. */
export function cieAt(l) {
    if (!(l >= CIE_LO && l <= HI)) return [0, 0, 0]
    const f = l - CIE_LO, i = Math.min(Math.floor(f), CIE_N - 2), t = f - i
    return [CIE_X[i] + t * (CIE_X[i + 1] - CIE_X[i]), CIE_Y[i] + t * (CIE_Y[i + 1] - CIE_Y[i]), CIE_Z[i] + t * (CIE_Z[i + 1] - CIE_Z[i])]
}

/** A spectrum's relative power per nm at lambda (nm). */
export function spdAt(s, l) {
    if (s.kind === 'planck') {
        const m = l * 1e-9
        // Planck's spectral radiance up to its constant (c1): 1 / (lambda^5 (exp(c2 / lambda T) - 1)), in units of 1e-45
        return 1 / ((m * 1e9) ** 5 * Math.expm1(C2 / (m * s.T))) * 1e15
    }
    if (s.kind === 'peaks') {
        let v = 0
        for (const p of s.peaks) {
            const sg = p.fwhm / FWHM_SIGMA, t = (l - p.nm) / sg
            v += p.weight / (sg * Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * t * t)
        }
        return v
    }
    if (s.kind === 'table') {
        const P = s.points
        if (!(l >= P[0][0] && l <= P[P.length - 1][0])) return 0
        let lo = 0, hi = P.length - 1
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m][0] <= l) lo = m; else hi = m }
        const [a, va] = P[lo], [b, vb] = P[hi]
        return b > a ? va + (vb - va) * (l - a) / (b - a) : va
    }
    return 0
}

/** The midpoint sum of S(lambda) times the observer over [a, b] (clipped to 360-830 nm) at a step no coarser than h:
 *  [X, Y, Z] in one pass. */
function observed(S, a, b, h) {
    const lo = Math.max(CIE_LO, a), hi = Math.min(HI, b)
    const out = [0, 0, 0]
    if (!(hi > lo)) return out
    const n = Math.max(1, Math.ceil((hi - lo) / h)), d = (hi - lo) / n
    for (let i = 0; i < n; i++) {
        const l = lo + (i + 0.5) * d, v = S(l)
        if (!v) continue
        const c = cieAt(l)
        out[0] += v * c[0]; out[1] += v * c[1]; out[2] += v * c[2]
    }
    return out.map(x => x * d)
}
/* A FEW SPECTRA ARE ASKED OFTEN (every light's colour, each time a panel or the sources read it): the last ones kept,
   by their text. */
const SEEN = new Map(), SEEN_MAX = 64
/** A spectrum's XYZ (the shape's: the same units as spdAt, times nm). Each peak is summed over its own +-8 sigma at a
 *  tenth of its width (or 1 nm), so a laser line beside a broad hump costs no more than the two apart; a table at a
 *  fifth of its closest points (or 1 nm), over its own range; a blackbody at 1 nm. */
export function spdXYZ(s) {
    const key = JSON.stringify(s)
    const was = SEEN.get(key)
    if (was) return was.slice()
    let xyz
    if (s.kind === 'peaks') {
        xyz = [0, 0, 0]
        for (const p of s.peaks) {
            const w = 8 * p.fwhm / FWHM_SIGMA
            const one = observed(l => spdAt({ kind: 'peaks', peaks: [p] }, l), p.nm - w, p.nm + w, Math.min(1, p.fwhm / 10))
            for (let i = 0; i < 3; i++) xyz[i] += one[i]
        }
    } else if (s.kind === 'table') {
        let d = Infinity
        for (let i = 1; i < s.points.length; i++) d = Math.min(d, s.points[i][0] - s.points[i - 1][0])
        xyz = observed(l => spdAt(s, l), s.points[0][0], s.points[s.points.length - 1][0], Math.min(1, d / 5))
    } else xyz = observed(l => spdAt(s, l), CIE_LO, HI, 1)
    if (SEEN.size >= SEEN_MAX) SEEN.delete(SEEN.keys().next().value)
    SEEN.set(key, xyz)
    return xyz.slice()
}
/** Its total power (the same units), over every wavelength it has: a blackbody's to 100 um (past that under 1e-6 of
 *  it at 1000 K), a peak's its weight (its area, exactly), a table's its own range. */
export function spdPower(s) {
    if (s.kind === 'peaks') return s.peaks.reduce((acc, p) => acc + p.weight, 0)
    if (s.kind === 'table') { let acc = 0; for (let i = 1; i < s.points.length; i++) acc += 0.5 * (s.points[i][1] + s.points[i - 1][1]) * (s.points[i][0] - s.points[i - 1][0]); return acc }
    // a blackbody: on a log scale in lambda, 50 nm to 100 um, where its whole hump is
    const n = 4000, a = Math.log(50), b = Math.log(1e5)
    let acc = 0
    for (let i = 0; i < n; i++) { const l = Math.exp(a + (i + 0.5) * (b - a) / n); acc += spdAt(s, l) * l }
    return acc * (b - a) / n
}
/** Its luminous efficacy of radiation, lm/W: KM times the share of its power y-bar weighs. What turns a light's lumens
 *  into the watts it radiates -- the spectral optics trace's (S2) -- and a figure a datasheet gives. */
export const spdLER = s => { const p = spdPower(s); return p > 0 ? KM * spdXYZ(s)[1] / p : 0 }
/** Its exact Rec.709 RGB at luminance Y = 1 (a channel below 0 for a colour outside the gamut, as a chromaticity's). */
export function spdRGB(s) {
    const [X, Y, Z] = spdXYZ(s)
    return Y > 0 ? XYZtoRGB([X / Y, 1, Z / Y]) : [1, 1, 1]
}
/** What a panel says of it: xy, CCT and Duv (CCT only where it is meaningful, |Duv| <= 0.05), and its efficacy. */
export function spdSummary(s) {
    const xyz = spdXYZ(s), xy = XYZtoxy(xyz)
    if (!xy) return null
    const c = xyToCctDuv(xy[0], xy[1])
    return { xy, cct: c.inRange && Math.abs(c.duv) <= 0.05 ? c.cct : null, duv: c.duv, ler: spdLER(s) }
}

/*---- CHECKING ONE ------------------------------------------------------------------------------------------------*/
export const SPD_LIMITS = { T: [500, 50000], nm: [200, 2500], fwhm: [0.001, 400], peaks: 8, points: 4000 }
/** What is wrong with a spectrum, as sentences; [] for a sound one. A spectrum the eye sees nothing of is refused: a
 *  light given by it would have no colour. */
export function spdProblems(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return ['spectrum must be an object']
    if (!SPD_KINDS.includes(s.kind)) return [`spectrum.kind must be one of ${SPD_KINDS.join(', ')}`]
    const p = [], L = SPD_LIMITS
    const allowed = { planck: ['kind', 'T'], peaks: ['kind', 'peaks'], table: ['kind', 'name', 'points'] }[s.kind]
    for (const k of Object.keys(s)) if (!allowed.includes(k)) p.push(`spectrum.${k}: not a setting of a ${s.kind} spectrum`)
    if (s.kind === 'planck' && !(Number.isFinite(s.T) && s.T >= L.T[0] && s.T <= L.T[1])) p.push(`spectrum.T must be ${L.T[0]} to ${L.T[1]} K`)
    if (s.kind === 'peaks') {
        if (!Array.isArray(s.peaks) || !s.peaks.length || s.peaks.length > L.peaks) p.push(`spectrum.peaks must be 1 to ${L.peaks} peaks`)
        else s.peaks.forEach((q, i) => {
            if (!(Number.isFinite(q?.nm) && q.nm >= L.nm[0] && q.nm <= L.nm[1])) p.push(`peak ${i + 1}: nm must be ${L.nm[0]} to ${L.nm[1]}`)
            if (!(Number.isFinite(q?.fwhm) && q.fwhm >= L.fwhm[0] && q.fwhm <= L.fwhm[1])) p.push(`peak ${i + 1}: fwhm must be ${L.fwhm[0]} to ${L.fwhm[1]} nm`)
            if (!(Number.isFinite(q?.weight) && q.weight >= 0)) p.push(`peak ${i + 1}: weight must be a number >= 0`)
            if (q && Object.keys(q).some(k => !['nm', 'fwhm', 'weight'].includes(k))) p.push(`peak ${i + 1}: only nm, fwhm and weight`)
        })
    }
    if (s.kind === 'table') {
        if (s.name !== undefined && typeof s.name !== 'string') p.push('spectrum.name must be text')
        const P = s.points
        if (!Array.isArray(P) || P.length < 2 || P.length > L.points) p.push(`spectrum.points must be 2 to ${L.points} [nm, power] pairs`)
        else P.forEach((q, i) => {
            if (!Array.isArray(q) || q.length !== 2 || !q.every(Number.isFinite)) { p.push(`point ${i + 1}: must be [nm, power]`); return }
            if (q[1] < 0) p.push(`point ${i + 1}: power must be >= 0`)
            if (i && !(q[0] > P[i - 1][0])) p.push(`point ${i + 1}: its nm must be above the one before`)
        })
    }
    if (!p.length && !(spdXYZ(s)[1] > 0)) p.push('the spectrum has no light the eye sees (360-830 nm): it has no colour')
    return p
}

/*---- TEXT ------------------------------------------------------------------------------------------------------*/
/** A problem in a spectrum's text, at its line and column (1-based), as the recipe editor reports one. */
export class SpdTextError extends Error {
    constructor(line, col, message) { super(`line ${line}, column ${col}: ${message}`); this.line = line; this.col = col }
}
/* The columns of a line: split at a semicolon or tab if it has one -- then a comma is a decimal point, as a European
   spreadsheet writes "450,5;0,83" -- else at commas and spaces. Each with the column it starts at. */
function cells(line) {
    const out = [], sep = /[;\t]/.test(line) ? /[;\t]/ : /[,\s]+/
    const decimalComma = /[;\t]/.test(line)
    let at = 0
    for (const raw of line.split(sep)) {
        const start = line.indexOf(raw, at)
        at = start + raw.length
        const t = raw.trim()
        if (t) out.push({ text: decimalComma ? t.replace(',', '.') : t, col: start + 1 + (raw.length - raw.trimStart().length) })
    }
    return out
}
const isComment = l => /^\s*(#|\/\/|$)/.test(l)
/** A measured spectrum from CSV text: two columns, nm and relative power. Blank lines and lines starting # or // are
 *  skipped, and so are heading lines before the first number; after that every line is a point. Further columns are
 *  ignored. Returns { points }; throws SpdTextError at the line and column of the first problem. */
export function parseSpdCsv(text) {
    const lines = String(text ?? '').split(/\r?\n/), points = []
    lines.forEach((line, i) => {
        if (isComment(line)) return
        const c = cells(line)
        const nums = c.slice(0, 2).map(x => Number(x.text))
        if (!points.length && !Number.isFinite(nums[0])) return        // a heading before the data
        if (c.length < 2) throw new SpdTextError(i + 1, (c[0]?.col ?? 1) + (c[0]?.text.length ?? 0), 'two columns: nm and power')
        for (let j = 0; j < 2; j++) if (!Number.isFinite(nums[j])) throw new SpdTextError(i + 1, c[j].col, `'${c[j].text}' is not a number`)
        if (nums[1] < 0) throw new SpdTextError(i + 1, c[1].col, 'a power below 0')
        if (points.length && !(nums[0] > points[points.length - 1][0]))
            throw new SpdTextError(i + 1, c[0].col, `${nums[0]} nm is not above the line before's ${points[points.length - 1][0]} nm`)
        points.push(nums)
    })
    if (points.length < 2) throw new SpdTextError(lines.length, 1, 'at least two points (nm, power)')
    return { points }
}
/** Peaks from text: one a line, "nm fwhm weight" (weight 1 if left out), # comments. Throws SpdTextError. */
export function parsePeaks(text) {
    const peaks = []
    String(text ?? '').split(/\r?\n/).forEach((line, i) => {
        if (isComment(line)) return
        const c = cells(line)
        const names = ['nm', 'fwhm', 'weight']
        const v = c.slice(0, 3).map(x => Number(x.text))
        if (c.length < 2) throw new SpdTextError(i + 1, 1, 'a peak is "nm fwhm weight": its wavelength, its full width at half maximum, its share')
        for (let j = 0; j < c.length && j < 3; j++) if (!Number.isFinite(v[j])) throw new SpdTextError(i + 1, c[j].col, `${names[j]}: '${c[j].text}' is not a number`)
        if (c.length > 3) throw new SpdTextError(i + 1, c[3].col, 'three numbers at most: nm fwhm weight')
        peaks.push({ nm: v[0], fwhm: v[1], weight: c.length > 2 ? v[2] : 1 })
    })
    if (!peaks.length) throw new SpdTextError(1, 1, 'no peak: one a line, "nm fwhm weight"')
    return { peaks }
}
const num = v => String(+(+v).toPrecision(6))
export const peaksText = s => s.peaks.map(p => `${num(p.nm)} ${num(p.fwhm)} ${num(p.weight)}`).join('\n')
export const tableText = s => s.points.map(([l, v]) => `${num(l)}, ${num(v)}`).join('\n')

/*---- STARTING POINTS -------------------------------------------------------------------------------------------*/
/** A few spectra to start from. MODELS, NOT DATASHEETS: a single-colour LED as one Gaussian of its typical peak and
 *  width; a white LED as a blue die and a broad phosphor hump in the proportion that puts it at 3990 K, Duv -0.0001 (a
 *  search over the hump's peak, width and share, 2026-11-03; spd.test.mjs holds it); CIE illuminant A, which CIE 015
 *  defines with the c2 of 1.435e-2 m K and 2848 K -- the same curve as a blackbody of 2848 x C2 / 1.435e-2 = 2855.5 K
 *  with today's c2 (its xy 0.44757, 0.40745, the CIE's). */
export const SPD_PRESETS = {
    'blackbody 2700 K': { kind: 'planck', T: 2700 },
    'blackbody 4000 K': { kind: 'planck', T: 4000 },
    'blackbody 6500 K': { kind: 'planck', T: 6500 },
    'CIE illuminant A': { kind: 'planck', T: +(2848 * C2 / 1.435e-2).toFixed(4) },
    'LED royal blue 450 nm': { kind: 'peaks', peaks: [{ nm: 450, fwhm: 20, weight: 1 }] },
    'LED blue 470 nm': { kind: 'peaks', peaks: [{ nm: 470, fwhm: 25, weight: 1 }] },
    'LED green 525 nm': { kind: 'peaks', peaks: [{ nm: 525, fwhm: 35, weight: 1 }] },
    'LED amber 590 nm': { kind: 'peaks', peaks: [{ nm: 590, fwhm: 15, weight: 1 }] },
    'LED red 630 nm': { kind: 'peaks', peaks: [{ nm: 630, fwhm: 17, weight: 1 }] },
    'LED deep red 660 nm': { kind: 'peaks', peaks: [{ nm: 660, fwhm: 20, weight: 1 }] },
    'LED white, about 4000 K (blue die and phosphor)': { kind: 'peaks', peaks: [{ nm: 450, fwhm: 20, weight: 1 }, { nm: 580, fwhm: 125, weight: 5.35 }] },
    /* ...AND THE CIE'S OWN LED ILLUMINANTS (CIE 015:2018 table 12.1/12.2; ciedata.js, CC BY-SA 4.0): measured spectra of
       typical LED lamps, every 5 nm, which a CRI is quoted for (cri.test.mjs). Their CCTs as their tables read. */
    ...Object.fromEntries([['LED-B1', 'phosphor, 2730 K'], ['LED-B2', 'phosphor, 3000 K'], ['LED-B3', 'phosphor, 4100 K'],
        ['LED-B4', 'phosphor, 5100 K'], ['LED-B5', 'phosphor, 6600 K'], ['LED-BH1', 'blue and red hybrid, 2850 K'],
        ['LED-RGB1', 'red, green and blue, 2840 K'], ['LED-V1', 'violet-pumped, 2720 K'], ['LED-V2', 'violet-pumped, 4070 K']]
        .map(([n, what]) => [`CIE ${n} (${what})`, { kind: 'table', name: `CIE ${n}`,
            points: Array.from(CIE_LED.columns[n], (v, i) => [CIE_LED.lo + 5 * i, v]) }])),
}
