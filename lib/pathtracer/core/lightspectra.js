//======================================================================================================================
// A LIGHT'S OWN SPECTRUM AT A PRISM (0.next) -- the wavelength a light's photon takes at the first dispersive glass,
// drawn from that light's spectrum, and the exact colour that wavelength is.
//
// WHAT WAS WRONG. A ray carries three Rec.709 channels and gets a wavelength only when it refracts into a dispersive
// medium (spectral.js DISPERSION, materials_pbr.js processMaterial_advanced). There it was drawn from the channels'
// own weights (spectral.js specDraw: the clipped Rec.709 colour-matching functions), whatever the light emits: each
// channel's light spread over every wavelength that channel covers. Exact on average for a white light, and wrong for
// a narrow one. The user's two (2026-11-07): an LED of one peak at 450 nm, 10 nm wide, threw a fan of blue from 380 to
// 510 nm and a band of red at the red end, where it emits nothing -- its colour (3.69, -4.60, 48.5) at luminance 1 is
// red in part, and the red channel's weights are 83 % at 560-640 nm; a red LED put a band of red in the violet, the
// 4.6 % of the red channel's weights in its violet lobe below 480 nm (computed with SPEC_WEIGHTS and spd.js spdRGB).
//
// WHAT A PHOTON DOES NOW. A photon of a light given by its own spectrum (builder/lights.js colourBy 'spectrum', or a
// CCT on the locus: a blackbody) carries which of these tables is its light's (Ray.pix, PIX_LS below; set by
// optics/kernels.js prog_opt_photons from its source's record). At the first dispersive refraction it draws a 1 nm cell
// of 380-780 nm with probability q_i, the cell's share of S (x-bar + y-bar + z-bar), then a wavelength uniform in it,
// and its colour becomes the cell's EXACT colour over q_i:
//     col_i = M XYZ_i / q_i,    XYZ_i = the integral over the cell of S times the CIE 1931 table, S at luminance 1
// M the Rec.709 matrix, a negative channel kept (a colour outside the gamut: core/colorimetry.js). So the mean over the
// draw is sum_i M XYZ_i: the light's own colour (to the light's own sum outside 380-780 nm, which the eye barely sees),
// a narrow line leaves the prism at its own wavelengths only, and each wavelength is its own colour, never a channel's
// share of one. What the photon met before the glass is kept channel by channel, as RGB materials scale it: its beta
// over the light's colour (tau, lsBeta), times col_i. Exact while nothing coloured it; a tinted filter before the prism
// is taken as tinting the rainbow channel by channel, the same "looks" approximation every RGB material makes.
//
// WHAT IS NOT CHANGED. The camera's own paths still draw by the channels' weights (specDraw, below): a camera path
// does not know which light it will reach when it meets the glass. So the light the photon map and light tracing bring
// -- the rainbow a prism throws on a wall -- is the light's own; a light SEEN through a prism, which only camera paths
// reach, is still each channel spread. A light given by RGB, xy or a CCT off the locus has no spectrum and draws by the
// channels too. More distinct spectra than LS_MAX: the ones past it by the channels (sources.js says which).
//
// THE CHANNELS' OWN DRAW, AT 1 nm (0.next; specDraw, CAMERA_TABLE): every ray without a table of its own -- a camera path,
// a light given by its colour -- draws from one more table of the same shape: each 1 nm cell's share of each channel's
// clipped Rec.709 colour-matching function (the CIE's own 1931 table, cie1931.js, through colorimetry.js's matrix,
// negative parts clipped to 0, each channel summing to 1), drawn by the three's sum, its col the cell's weights over its
// chance -- each channel's mean weight exactly 1, none above 3, as before. It was spectral.js's 40 bins of 10 nm by the
// analytic fit until 0.next, and a wavelength took its bin's colour: in a rainbow the camera sees, the colour stepped every
// 10 nm, by up to 0.136 u'v' between two bins near 480 nm, where hue moves fastest (computed from SPEC_WEIGHTS); between
// two of this table's 1 nm cells the largest step is 0.014, at 478 nm (computed; test/lightspectra.test.mjs). The wavelength itself was never binned (uniform within its
// bin, so a refraction's angle was continuous); only its colour. A table and not a const array of 400: an array that
// size indexed at run time may be copied into every invocation's own memory (inferred, compiler by compiler), and the
// photons' tables already have the storage, the draw and its JS mirror. What it costs a draw: a binary search of 9 reads
// where the bins took a loop of up to 40 (read in code; untimed), once per ray entering dispersive glass. A coating's
// average per channel keeps spectral.js's 10 nm bins: at 1 nm it would loop 400 times a coated hit for at most 0.009 of
// reflectance (computed: edgeRGB's arithmetic at both steps, an edge 0.01 to 30 nm wide anywhere in 390-770 nm).
//
// WHERE THE TABLES ARE. In the learn buffer past the microfacet tables (LS_BASE): shade is at its eight storage bindings
// (tracebasics.js), and learn is bound there and in the optics' shade alike. The host writes them (optics/index.js
// pictureSource) when the picture's sources change; clearLight writes only learn's first LEARN_WORDS, so they outlive a
// clear. Layout: [LS_BASE] the count, three words spare, then per table LS_STRIDE words: the colour the cells add up to
// (3 and a spare), the CDF of q (LS_CELLS, the last exactly 1), then each cell's col_i (3 x LS_CELLS). The lights' tables
// fill LS_LIGHT_WORDS; the channels' own table (LS_CAM) is the slot after them, written once by the renderer when it makes
// the buffer (raytrace_main.js), never by the photon source: its region stops short of it.
//
// Pure JS here, the tables and their mirror of the draw (test/lightspectra.test.mjs); the region's place in the learn
// buffer (LS_BASE) and the WGSL are lightspectra_wgsl.js's, which needs the microfacet tables' size -- a module with a
// kernel in it, which the tutorial's pages, running this one's draw, may not reach (tutorial/test/tutorial.test.mjs).
//======================================================================================================================
import { PIX_LS } from './tracebasics.js'
import { cieAt, spdAt } from './spd.js'
import { XYZ_TO_RGB709 } from './colorimetry.js'
import { SPEC_LO, SPEC_STEP, SPEC_BINS } from './spectral.js'

/** The cells: LS_CELLS of 1 nm from LS_LO -- the range a ray's wavelength can be (spectral.js lambdaCode). */
export const LS_LO = SPEC_LO, LS_CELLS = SPEC_BINS * SPEC_STEP
/** How many distinct spectra the picture's photons can carry, and the words a table and the region take. */
export const LS_MAX = 16
export const LS_HEAD = 4, LS_STRIDE = 4 + 4 * LS_CELLS
export const LS_LIGHT_WORDS = LS_HEAD + LS_MAX * LS_STRIDE
/** The channels' own table's place in the region (CAMERA_TABLE), and the whole region's words. */
export const LS_CAM = LS_LIGHT_WORDS
export const LS_WORDS = LS_LIGHT_WORDS + LS_STRIDE
/** Ray.pix of a photon carrying table k: PIX_LS | k (tracebasics.js, beside the WGSL's). Every other photon's pix is a
 *  sun-map cell (< LT_CELLS) or 0xFFFFFFFF, and the optics trace's a ray index, all below this or equal to that. */
export { PIX_LS }

const FWHM_SIGMA = 2 * Math.sqrt(2 * Math.log(2))
/** Midpoint samples of S over [a, b] at a step no coarser than h, each added to its cell's XYZ. */
function addCells(acc, S, a, b, h) {
    const lo = Math.max(LS_LO, a), hi = Math.min(LS_LO + LS_CELLS, b)
    if (!(hi > lo)) return
    const n = Math.max(1, Math.ceil((hi - lo) / h)), d = (hi - lo) / n
    for (let j = 0; j < n; j++) {
        const l = lo + (j + 0.5) * d, v = S(l)
        if (!v) continue
        const i = Math.min(LS_CELLS - 1, Math.floor(l - LS_LO)), c = cieAt(l)
        for (let k = 0; k < 3; k++) acc[3 * i + k] += v * c[k] * d
    }
}
/** Each 1 nm cell's XYZ of a spectrum description ({ spectrum } or { planck: T }), unnormalised, at the steps spd.js
 *  spdXYZ integrates it at (a peak over its own +-8 sigma at a tenth of its width, a table at a fifth of its closest
 *  points), never coarser than 0.1 nm. */
export function cellsXYZ(desc) {
    const acc = new Float64Array(3 * LS_CELLS)
    const s = desc.spectrum ?? { kind: 'planck', T: desc.planck }
    if (s.kind === 'peaks') {
        for (const p of s.peaks) {
            const w = 8 * p.fwhm / FWHM_SIGMA
            addCells(acc, l => spdAt({ kind: 'peaks', peaks: [p] }, l), p.nm - w, p.nm + w, Math.min(0.1, p.fwhm / 10))
        }
    } else if (s.kind === 'table') {
        let d = Infinity
        for (let i = 1; i < s.points.length; i++) d = Math.min(d, s.points[i][0] - s.points[i - 1][0])
        addCells(acc, l => spdAt(s, l), s.points[0][0], s.points[s.points.length - 1][0], Math.min(0.1, d / 5))
    } else addCells(acc, l => spdAt(s, l), LS_LO, LS_LO + LS_CELLS, 0.1)
    return acc
}
const rgbOf = (x, y, z) => XYZ_TO_RGB709.map(r => r[0] * x + r[1] * y + r[2] * z)

/** A light's table: { hue, cdf, col } -- hue the colour its cells add up to, at luminance 1; cdf the draw's (q's
 *  running sum, the last 1); col each cell's colour over q_i, 0 for a cell never drawn. null for a spectrum with no
 *  light in 380-780 nm. */
export function lightSpectrumTable(desc) {
    const xyz = cellsXYZ(desc)
    let Y = 0, P = 0
    for (let i = 0; i < LS_CELLS; i++) { Y += xyz[3 * i + 1]; P += xyz[3 * i] + xyz[3 * i + 1] + xyz[3 * i + 2] }
    if (!(Y > 0) || !(P > 0)) return null
    const cdf = new Float64Array(LS_CELLS), col = new Float64Array(3 * LS_CELLS), hue = [0, 0, 0]
    let run = 0
    for (let i = 0; i < LS_CELLS; i++) {
        const X = xyz[3 * i] / Y, Yi = xyz[3 * i + 1] / Y, Z = xyz[3 * i + 2] / Y
        const q = (xyz[3 * i] + xyz[3 * i + 1] + xyz[3 * i + 2]) / P
        const c = rgbOf(X, Yi, Z)
        for (let k = 0; k < 3; k++) { hue[k] += c[k]; col[3 * i + k] = q > 0 ? c[k] / q : 0 }
        run += q
        cdf[i] = Math.min(run, 1)                       // a sum of shares can round past 1
    }
    // the last reaches 1 exactly, and every cell after the last one with light is 1 too: the draw never lands past it
    let last = LS_CELLS - 1
    while (last > 0 && !(cdf[last] > cdf[last - 1])) last--
    for (let i = last; i < LS_CELLS; i++) cdf[i] = 1
    return { hue, cdf, col }
}

/** THE DRAW, in JS as the WGSL lsDraw: u in [0, 1) to { lambda, cell, col }, the first cell whose CDF passes u. */
export function lsDraw(T, u) {
    let lo = 0, hi = LS_CELLS - 1
    // the first i with cdf[i] > u: a cell of q 0 (cdf[i] == cdf[i - 1]) is never it
    while (lo < hi) { const m = (lo + hi) >> 1; if (T.cdf[m] > u) hi = m; else lo = m + 1 }
    const c0 = lo > 0 ? T.cdf[lo - 1] : 0, mass = T.cdf[lo] - c0
    const t = mass > 0 ? Math.min(Math.max((u - c0) / mass, 0), 1) : 0.5
    return { lambda: LS_LO + lo + t, cell: lo, col: [0, 1, 2].map(k => T.col[3 * lo + k]) }
}
/** ...and what it makes of a photon's beta: col times tau, its beta over the light's colour channel by channel -- a
 *  channel of next to none of the light (under 1e-3 of its largest) taking the luminance's ratio instead (lsBeta). */
export function lsBeta(beta, hue, col) {
    const big = Math.max(...hue.map(Math.abs))
    const lum = 0.2126 * beta[0] + 0.7152 * beta[1] + 0.0722 * beta[2]
    const hl = 0.2126 * hue[0] + 0.7152 * hue[1] + 0.0722 * hue[2]
    return col.map((c, k) => c * (Math.abs(hue[k]) > 1e-3 * big ? beta[k] / hue[k] : lum / hl))
}

/** THE REGION as the learn buffer takes it (u32 words, f32 bits but the count), for a list of tables (null ones
 *  skipped by the caller), at most LS_MAX. */
export function lightSpectraWords(tables) {
    const out = new Uint32Array(LS_LIGHT_WORDS), f = new Float32Array(out.buffer)
    const n = Math.min(tables.length, LS_MAX)
    out[0] = n
    for (let s = 0; s < n; s++) {
        const T = tables[s], o = LS_HEAD + s * LS_STRIDE
        f[o] = T.hue[0]; f[o + 1] = T.hue[1]; f[o + 2] = T.hue[2]
        f.set(T.cdf, o + 4)
        f.set(T.col, o + 4 + LS_CELLS)
    }
    return out
}

/** THE CHANNELS' OWN TABLE (CAMERA_TABLE, the header): { hue, cdf, col, w } -- w[3 i + c] cell i's share of channel c,
 *  each channel summing to 1; col its weights over the cell's chance; hue (1, 1, 1), what they average to. */
export const CAMERA_TABLE = (() => {
    const w = new Float64Array(3 * LS_CELLS), tot = [0, 0, 0], sub = 10
    for (let i = 0; i < LS_CELLS; i++) for (let j = 0; j < sub; j++) {
        const c = cieAt(LS_LO + i + (j + 0.5) / sub), r = rgbOf(c[0], c[1], c[2])
        for (let k = 0; k < 3; k++) { const v = Math.max(0, r[k]) / sub; w[3 * i + k] += v; tot[k] += v }
    }
    for (let i = 0; i < LS_CELLS; i++) for (let k = 0; k < 3; k++) w[3 * i + k] /= tot[k]
    const cdf = new Float64Array(LS_CELLS), col = new Float64Array(3 * LS_CELLS)
    let run = 0
    for (let i = 0; i < LS_CELLS; i++) {
        const q = (w[3 * i] + w[3 * i + 1] + w[3 * i + 2]) / 3
        for (let k = 0; k < 3; k++) col[3 * i + k] = q > 0 ? w[3 * i + k] / q : 0
        run += q
        cdf[i] = Math.min(run, 1)
    }
    let last = LS_CELLS - 1
    while (last > 0 && !(cdf[last] > cdf[last - 1])) last--
    for (let i = last; i < LS_CELLS; i++) cdf[i] = 1
    return { hue: [1, 1, 1], cdf, col, w }
})()
/** THE CHANNELS' DRAW, in JS as the WGSL specDraw: u in [0, 1) to { lambda, k (its cell), w (each channel's weight) }. */
export function specDraw(u) {
    const d = lsDraw(CAMERA_TABLE, u)
    return { lambda: d.lambda, k: d.cell, w: d.col }
}
/** ...and the table as the learn buffer takes it, at LS_BASE + LS_CAM (raytrace_main.js). */
export function cameraTableWords() {
    const out = new Uint32Array(LS_STRIDE), f = new Float32Array(out.buffer)
    f.set(CAMERA_TABLE.hue, 0)
    f.set(CAMERA_TABLE.cdf, 4)
    f.set(CAMERA_TABLE.col, 4 + LS_CELLS)
    return out
}
