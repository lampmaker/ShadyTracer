//======================================================================================================================
// OPTICS SOURCES -- the sources a trace starts from, packed into the table prog_opt_gen reads.
//
// A source here is a SHAPE (point, disc, rectangle) at a pose, an ANGULAR DISTRIBUTION about its
// axis, a FLUX, the index of what it emits into, one face or two, and a COLOUR (a hue; the flux is
// its luminance, so the colour never changes a lumen figure). In the app every one of them is
// a builder sheet carrying a source material (builder/sources.js sourceTable
// makes these descriptions from the scene); the benches write them by hand. A trace starts each ray
// on a source picked by flux, so every ray carries the same share of the TOTAL flux -- which keeps
// the distribution in where the rays go, not in their weights, and a drawn ray meaning the same
// thing as any other.
//
//   collimated  every ray along the axis
//   uniform     uniform in solid angle within a cone of half angle `halfAngle`
//   cosine      density ~ cos^n about the axis within the cone; n = 1 over 90 degrees is Lambertian
//
// sampleCos() below is the JS mirror of the kernel's direction sampling -- the same formulas, kept
// next to their WGSL (optics/kernels.js SOURCE_RAY) so the Node test can check them.
//======================================================================================================================
import { SRC_VEC4, RAYSET_VEC4, RAY_Y_MIN } from './kernels.js'
import { LUMA } from '../core/photometry.js'
import { sourceSpectrum } from './spectral.js'
import { cieAt } from '../core/spd.js'
import { XYZtoRGB } from '../core/colorimetry.js'
import { raysXYZ } from './zemax.js'
import { lightSpectrumTable, lightSpectraWords, LS_MAX } from '../core/lightspectra.js'

export const SOURCE_TYPES = { point: 0, disc: 1, rectangle: 2, rayset: 3 }
export const DISTRIBUTIONS = { collimated: 0, uniform: 1, cosine: 2 }

/** A source for a bench or a script: a 1 x 1 unit Lambertian square 1 unit up, facing down (-z: the
 *  scene's up is +z), 1000 lm, into air, one face. `size` is the disc's radius or the rectangle's
 *  half sizes. */
export const defaultSource = () => ({
    type: 'rectangle', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0], size: [0.5, 0.5],
    distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, emitN: 1, twoSided: false,
})

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }

/** A LIGHT'S HUE as the kernels take it: [r, g, b] linear Rec.709, scaled to luminance 1, so the
 *  flux stays the flux and only its colour changes. {r, g, b} (the builder's) or an array; missing,
 *  broken or of no luminance is white -- a light with a flux has a colour, and black would be none.
 *  A NEGATIVE CHANNEL IS KEPT: it is how an exact colour outside the Rec.709 gamut is written (a
 *  royal-blue LED; core/colorimetry.js), and materials only ever scale channels, so it stays exact. */
export function hue(c) {
    const v = Array.isArray(c) ? c.slice(0, 3) : c && typeof c === 'object' ? [c.r, c.g, c.b] : null
    const rgb = v && v.every(Number.isFinite) ? v : [1, 1, 1]
    const Y = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2]
    return Y > 0 ? rgb.map(x => x / Y) : [1, 1, 1]
}

/** THE TABLE the kernels read (kernels.js SRC_VEC4 vec4s a source; the layout is there), for a list
 *  of source descriptions. Sources with no flux are left out: nothing would pick them.
 *
 *  A RAY SET is { type: 'rayset', rays: key, flux, emitN, unit }: its rays are rayData.get(key), a
 *  Float32Array of RAYSET_VEC4 vec4s a ray already in scene units and world space (position, weight;
 *  direction, its wavelength in nm or 0) -- the host places them (a Zemax file's rays, through its builder object's
 *  frame: placeRays). `unit` is its file's flux unit, 'lm' or 'W': what a ray's own wavelength makes of its weight
 *  (RAY COLOURS, below).
 *  They are packed one after another into `rays`, and the record says where.
 *
 *  Returns { data: Float32Array, count, flux, rays: Float32Array, spectra, ownSpectrum, lightSpectra: Uint32Array,
 *  lightSpectraDropped } -- flux the total, in lm; lightSpectra the learn buffer's region (core/lightspectra.js). */
export function sourceRecords(list, rayData = new Map(), metresPerUnit = 1) {
    /* IN METRES, the engine's unit (0.36.0): a source's place and size are the scene's numbers, and so are a ray set's
       positions (placeRays); the kernels take them times this. Its axis, tangent and the rays' directions are not lengths. */
    const m = metresPerUnit
    const nRays = s => (rayData.get(s.rays)?.length ?? 0) / (RAYSET_VEC4 * 4)
    const live = (list || []).filter(s => (s.flux ?? 0) > 0 && (s.type !== 'rayset' || nRays(s) > 0))
    const flux = live.reduce((a, s) => a + s.flux, 0)
    const data = new Float32Array(Math.max(1, live.length) * SRC_VEC4 * 4)
    const setRays = [...new Set(live.filter(s => s.type === 'rayset').map(s => s.rays))]
    const at = new Map()
    let total = 0
    for (const k of setRays) { at.set(k, total); total += nRays({ rays: k }) }
    const rays = new Float32Array(Math.max(1, total) * RAYSET_VEC4 * 4)
    for (const k of setRays) {
        const src = rayData.get(k), o = at.get(k) * RAYSET_VEC4 * 4
        rays.set(src, o)
        // position, weight; direction, 0 -- the position in metres
        if (m !== 1) for (let i = 0; i < src.length; i += RAYSET_VEC4 * 4) { rays[o + i] *= m; rays[o + i + 1] *= m; rays[o + i + 2] *= m }
    }
    /* THE SPECTRA the spectral trace draws its wavelengths' weights from (0.83.0; optics/spectral.js sourceSpectrum): one a
       distinct light -- its own (`spectrum`, a blackbody `planck`) or a stand-in of its colour -- each at luminance 1, and
       the record's [5].w which it is. Made for every table (a few hundred numbers a light); only the spectral trace reads
       them. */
    const spectra = [], spectrumAt = new Map()
    const spectrumOf = s => {
        const key = JSON.stringify(s.spectrum ? { s: s.spectrum } : s.planck > 0 ? { p: s.planck } : { c: hue(s.colour) })
        if (!spectrumAt.has(key)) { spectrumAt.set(key, spectra.length); spectra.push(sourceSpectrum(s.spectrum || s.planck > 0 ? s : { colour: hue(s.colour) })) }
        return spectrumAt.get(key)
    }
    /* THE PICTURE'S SPECTRA (0.84.0; core/lightspectra.js): a light given by its own spectrum (`spectrum`, or a blackbody
       `planck`) gets a table of its own, one a distinct spectrum, and the record's [4].w is it + 1 (0 none): what its photons
       draw their wavelength from at the first dispersive glass, instead of the channels' weights. A stand-in (any other
       colour) gets none: it has no spectrum to draw from. Past LS_MAX distinct spectra, none, and `lightSpectraDropped`
       says how many. Only the picture's table is uploaded (optics/index.js pictureSource); the Optics page's trace
       reads [5].w, and its spectral kernels their own spectra. */
    const lsTables = [], lsAt = new Map()
    let lsDropped = 0
    const lightSpectrumOf = s => {
        if (!s.spectrum && !(s.planck > 0)) return 0
        const key = JSON.stringify(s.spectrum ? { s: s.spectrum } : { p: s.planck })
        if (!lsAt.has(key)) {
            const T = lsTables.length < LS_MAX ? lightSpectrumTable(s.spectrum ? { spectrum: s.spectrum } : { planck: s.planck }) : null
            if (!T && lsTables.length >= LS_MAX) lsDropped++
            lsAt.set(key, T ? lsTables.push(T) : 0)
        }
        return lsAt.get(key)
    }
    /* RAY COLOURS (0.83.0; kernels.js A RAY SET [3].y, [3].z): a set whose rays carry their own wavelengths (placeRays'
       fourth direction slot) gives the PICTURE'S photons each its own colour, the CIE's at its wavelength, so the set's
       colour varies where its rays go as the file says. Its flux unit says how much light that is: a ray of a file in lm
       carries luminous flux, so its colour is its wavelength's at its luminance (XYZ / y-bar; mode 1); one in W carries
       radiant flux, so its luminance is its y-bar times it (XYZ; mode 2). A ray the eye cannot see (no wavelength, or
       outside 360-830 nm, or where y-bar is 0) carries NOTHING: its watts are not light, and lumens there are not a
       measurement -- zemax.js raysXYZ leaves it out of the file's colour alike. K, times either, makes the set's mean
       luminance over every ray drawn 1, the luminance the set's own colour has, so the light's flux is the visible
       flux and means what it meant ("watts as lumens" for a file in W: index.js pictureSource). The colours then add
       up to the file's own colour (raysXYZ) exactly. No ray the eye sees: mode 0, the set's colour. */
    const rayColours = s => {
        const d = rayData.get(s.rays), n = nRays(s)
        if (!d || !(n > 0)) return [0, 0]
        const W = s.unit === 'W'
        let lum = 0
        for (let k = 0; k < n; k++) {
            const l = d[k * RAYSET_VEC4 * 4 + 7], y = l > 0 ? cieAt(l)[1] : 0
            if (y > RAY_Y_MIN) lum += d[k * RAYSET_VEC4 * 4 + 3] * (W ? y : 1)
        }
        /* none the eye sees: the set's own colour -- unless a wavelength was CHOSEN (rayFileColour `own`): then that is
           what it is, and it lights nothing (K 0) */
        return lum > 0 ? [W ? 2 : 1, n / lum] : s.ownWavelength ? [W ? 2 : 1, 0] : [0, 0]
    }
    let cum = 0
    live.forEach((s, i) => {
        cum += s.flux
        const cdf = i === live.length - 1 ? 1 : cum / flux          // the last reaches 1 exactly
        const o = i * SRC_VEC4 * 4
        if (s.type === 'rayset') {
            data.set([0, 0, 0, cdf, 0, 0, 1, SOURCE_TYPES.rayset, 1, 0, 0, at.get(s.rays), nRays(s), ...rayColours(s), 0,
                      Math.max(1, s.emitN ?? 1), 0, 0, lightSpectrumOf(s), ...hue(s.colour), spectrumOf(s)], o)
            return
        }
        const axis = norm(s.axis)
        // a tangent that is not along the axis, whatever was given
        let u = s.u || [1, 0, 0]
        if (Math.abs(u[0] * axis[0] + u[1] * axis[1] + u[2] * axis[2]) > 0.99) u = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
        data.set([...s.pos.map(x => x * m), cdf,
                  ...axis, SOURCE_TYPES[s.type] ?? 0,
                  ...norm(u), (s.size?.[0] ?? 0) * m,
                  (s.size?.[1] ?? s.size?.[0] ?? 0) * m, DISTRIBUTIONS[s.distribution] ?? 2,
                  Math.cos(Math.min(Math.max(s.halfAngle ?? 90, 0), 90) * Math.PI / 180), Math.max(0, s.n ?? 1),
                  Math.max(1, s.emitN ?? 1), s.twoSided ? 1 : 0, s.onSurface ? 1 : 0, lightSpectrumOf(s),
                  ...hue(s.colour), spectrumOf(s)], o)
    })
    return { data, count: live.length, flux, rays, spectra: spectra.map(x => x.values), ownSpectrum: spectra.map(x => x.own),
             lightSpectra: lightSpectraWords(lsTables), lightSpectraDropped: lsDropped }
}

/**
 * A RAY FILE'S COLOUR, as its light chooses it (0.83.0; builder/lights.js colourBy), now that the file is here -- the
 * one place it is decided, for the Optics page that places the rays and the Properties panel that says what it comes
 * to. `parsed` is zemax.js parseZemax's; `light` { colourBy, colour (exact RGB at Y = 1: lights.js lightRGB),
 * spectrum? planck? } as builder/sources.js sourceTable gives a ray set. Returns
 *   { wavelengths: 'rays' | 'header' | null   what placeRays keeps on each ray: its own, the header's, or none
 *     nm                                      the header's wavelength, nm, when that is the choice
 *     colour, spectrum?, planck?              the set's colour (the Optics page's trace, a ray with no wavelength)
 *     fromFile                                the colour is the file's, not the light's settings
 *     own                                     a wavelength was chosen: none the eye sees means no light, not white
 *     say }                                   what it comes to, in words
 *   'file'        a spectral file (format 2): each ray its own wavelength, the set the colour they add up to (raysXYZ);
 *                 none visible, white, as before (it was said "traced white"). A flux-only file says nothing: white.
 *   'wavelength'  every ray at the header's wavelength. Visible: that wavelength's colour, and for the spectral trace a
 *                 line 0.01 nm wide there. Not visible (the user's 854 nm infrared LED, 2026-11-04): no light in the
 *                 picture at all, which is what a camera would see -- its watts still trace on the Optics page.
 *   anything else the light's own colour on every ray, the file's wavelengths dropped.
 */
/* raysXYZ walks every ray (100 000 in an LED's file), and the Optics page asks this each time it sets its sources --
   every frame in Live -- so its answer is kept per parsed file, as the page kept it before (0.83.0) */
const FILE_XYZ = new WeakMap()
const fileXYZ = parsed => { if (!FILE_XYZ.has(parsed)) FILE_XYZ.set(parsed, raysXYZ(parsed)); return FILE_XYZ.get(parsed) }
export function rayFileColour(parsed, light = {}) {
    const by = light.colourBy ?? 'file', h = parsed?.header ?? {}
    const nmOf = l => `${l >= 100 ? Math.round(l) : l.toPrecision(3)} nm`
    if (by === 'file') {
        if (h.format !== 2) return { wavelengths: null, colour: [1, 1, 1], fromFile: false, own: false,
                                     say: 'the file gives no colour (no wavelength on its rays): traced white' }
        const c = fileXYZ(parsed)
        if (!c) return { wavelengths: 'rays', colour: [1, 1, 1], fromFile: false, own: false,
                         say: 'its wavelengths are outside what the eye sees: traced white' }
        return { wavelengths: 'rays', colour: XYZtoRGB(c.xyz), fromFile: true, own: false,
                 say: `each ray in its own wavelength's colour (${c.rays.toLocaleString('en')} rays)` }
    }
    if (by === 'wavelength') {
        const nm = (h.wavelength ?? 0) * 1000
        const xyz = nm >= 360 && nm <= 830 ? cieAt(nm) : [0, 0, 0]
        if (!(xyz[1] > RAY_Y_MIN)) return { wavelengths: 'header', nm, colour: [1, 1, 1], fromFile: true, own: true,
            say: `${nm > 0 ? nmOf(nm) : 'no wavelength'}: outside what the eye sees, so it lights nothing in the picture`
                 + ' (it still traces on the Optics page)' }
        return { wavelengths: 'header', nm, colour: XYZtoRGB(xyz.map(v => v / xyz[1])), fromFile: true, own: true,
                 spectrum: { kind: 'peaks', peaks: [{ nm, fwhm: 0.01, weight: 1 }] }, say: `every ray at ${nmOf(nm)}` }
    }
    return { wavelengths: null, colour: light.colour ?? [1, 1, 1], fromFile: false, own: false,
             ...(light.spectrum ? { spectrum: light.spectrum } : {}), ...(light.planck ? { planck: light.planck } : {}), say: '' }
}

/** A RAY SET FOR THE KERNELS: a parsed file's rays (zemax.js: metres, the file's frame) placed by a
 *  frame -- origin, the unit axes u, v, w the file's x, y, z go to, and the scene units per metre
 *  times the frame's own scale -- as RAYSET_VEC4 vec4s a ray, in the SCENE's unit (sourceRecords takes them to
 *  the engine's): position and weight (its flux over the
 *  set's mean, so the rays' weights average 1 and the set's flux is what the description says),
 *  then direction and its WAVELENGTH in nm (0.83.0: the slot was always 0), 0 for none.
 *  `wavelengths`: the file has one a ray (Zemax format 2, zemax.js: the eighth float, in um). Only then: a flux-only
 *  file's eighth float is its header's single wavelength, which photometric files fill with a placeholder (0.55 um is
 *  common; zemax.js raysXYZ says the same), and reading it as every ray's would turn a white LED green.
 *  `wavelength`: every ray at this one, nm -- the header's, when the light chooses it (rayFileColour). */
export function placeRays(fileRays, { origin = [0, 0, 0], u = [1, 0, 0], v = [0, 1, 0], w = [0, 0, 1], scale = 1, wavelengths = false, wavelength = 0 }, floatsPerRay = 8) {
    const n = Math.floor(fileRays.length / floatsPerRay)
    let sum = 0
    for (let k = 0; k < n; k++) sum += fileRays[k * floatsPerRay + 3]
    const mean = sum / Math.max(1, n) || 1
    const out = new Float32Array(n * RAYSET_VEC4 * 4)
    for (let k = 0; k < n; k++) {
        const b = k * floatsPerRay, o = k * RAYSET_VEC4 * 4
        const x = fileRays[b], y = fileRays[b + 1], z = fileRays[b + 2]
        const l = fileRays[b + 4], m = fileRays[b + 5], nn = fileRays[b + 6]
        for (let c = 0; c < 3; c++) {
            out[o + c] = origin[c] + (u[c] * x + v[c] * y + w[c] * z) * scale
            out[o + 4 + c] = u[c] * l + v[c] * m + w[c] * nn
        }
        out[o + 3] = fileRays[b + 3] / mean
        if (wavelengths && floatsPerRay > 7) out[o + 7] = Math.max(0, fileRays[b + 7] * 1000 || 0)
        else if (wavelength > 0) out[o + 7] = wavelength
    }
    return out
}

/** THE KERNEL'S DIRECTION SAMPLE, in JS: cos(theta) about the axis for one uniform number u.
 *  Mirrors prog_opt_gen exactly -- change both or neither. */
export function sampleCos(distribution, u, cosHalf, n) {
    if (distribution === DISTRIBUTIONS.uniform) return 1 - u * (1 - cosHalf)
    if (distribution === DISTRIBUTIONS.cosine) {
        const e = n + 1, lo = Math.pow(Math.max(cosHalf, 0), e)
        return Math.pow(1 - u * (1 - lo), 1 / e)
    }
    return 1
}

/** The flux one ray carries: the total over the rays. */
export const fluxPerRay = (flux, rays) => (flux ?? 0) / Math.max(1, rays)

/** What a source emits into a cone of half angle a about its axis, as a share of all it emits --
 *  the closed form the test compares the sampler with. */
export function coneShare(distribution, cosHalf, n, cosA) {
    if (distribution === DISTRIBUTIONS.collimated) return 1
    if (distribution === DISTRIBUTIONS.uniform) return Math.min(1, (1 - Math.max(cosA, cosHalf)) / (1 - cosHalf))
    const e = n + 1, lo = Math.pow(Math.max(cosHalf, 0), e)
    return Math.min(1, (1 - Math.pow(Math.max(cosA, cosHalf), e)) / (1 - lo))
}
