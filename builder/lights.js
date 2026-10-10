//======================================================================================================================
// LIGHTS -- the builder's light objects: a rectangle, a disc, or a Zemax ray file (model version 10).
//
// A LIGHT IS NOT A CODE NODE. Every shape in the builder is a code node that starts as a primitive
// and whose code is the user's to change (primitives.js); nothing can tell what shape a code node
// ends up as. A light has to be known exactly: the optics trace samples points on it, the picture
// light-traces it (photons started on it), its area turns lumens into luminance. So a light is an
// object of its own type -- `type: 'light'`, `light: { shape, ... }` -- with a shape that stays what
// it says: a flat rectangle or disc in the node's xy plane, emitting along +z, or a ray file's rays.
// Its size is its parameters (width, height / radius: uniforms, live like any node's). `stretch` says which of them the
// Transform gizmo's cube on each axis multiplies, as a preset's does (primitives.js STRETCH, stretch.js): the
// rectangle's width is its x and its height its y, the disc's radius both; a light has no thickness to stretch.
//
//   colourBy      how the colour is given: 'rgb' (colour), 'cct' (cct + duv) or 'xy' (xy) -- a
//                 datasheet gives a chromaticity, and additive mixing is exact in it
//   colour        the hue as linear Rec.709 RGB (normalised to luminance 1): colourBy 'rgb'
//   cct, duv      kelvin and the signed distance from the Planckian locus (CIE 1960 uv): 'cct'
//   xy            CIE 1931 chromaticity {x, y}: 'xy'
//   luminance     cd/m^2 straight out of the face -- or derived, when `flux` is given
//   flux          lm, or null: the luminance rules
//   distribution  'cosine' (cos^n, n = 1 Lambertian), 'uniform' (even in solid angle), 'collimated'
//   n, halfAngle  the cos^n exponent, and the cone it is limited to (degrees, 90 = the hemisphere)
//   twoSided      both faces emit; otherwise +z only, and the back is black
//   transparent   light and the camera pass through it, the camera seeing its glow over what is behind; else it
//                 stops them
//   emitN         the index of what it emits into: 1 in air, 1.41 for an LED die in silicone
//   file, box     a ray file: its name (the data is the host's, by name), and where its rays start
//
// A glowing SURFACE is something else: a material of type `emitter` on any shape, drawn by the
// renderer as an ordinary Lambertian emitter, and not an optics source (it has no known shape).
//======================================================================================================================

import { LUMA } from '../lib/pathtracer/core/photometry.js'
import { rgbFromXy, cctDuvToXy, gamutClip, rgbToXYZ, XYZtoxy, xyToCctDuv, CCT_MIN, CCT_MAX } from '../lib/pathtracer/core/colorimetry.js'
// the optics kernels' codes for a distribution (0 collimated, 1 uniform, 2 cos^n): the face's beam uses them too
import { DISTRIBUTIONS as SOURCE_CODES } from '../lib/pathtracer/optics/sources.js'

export const LIGHT_SHAPES = {
    rectangle: { params: { width: 1, height: 1 }, label: 'rectangle light', stretch: { x: ['width'], y: ['height'] } },
    disc: { params: { radius: 0.5 }, label: 'disc light', stretch: { x: ['radius'], y: ['radius'] } },
    rayfile: { params: {}, label: 'ray file' },
}
export const DISTRIBUTIONS = ['cosine', 'uniform', 'collimated']
export const COLOUR_BY = ['rgb', 'cct', 'xy']
export const LIGHT_DEFAULTS = Object.freeze({
    colourBy: 'rgb', colour: Object.freeze({ r: 1, g: 1, b: 1 }), cct: 4000, duv: 0, xy: Object.freeze({ x: 0.3127, y: 0.329 }),
    luminance: 1000, flux: null, distribution: 'cosine', n: 1, halfAngle: 90,
    twoSided: false, transparent: false, emitN: 1,
})
const KEYS = ['shape', ...Object.keys(LIGHT_DEFAULTS), 'file', 'box']

/** A light's settings with the defaults filled in. */
export const lightOf = node => ({ ...LIGHT_DEFAULTS, ...(node?.light || {}) })
/** Does this light have a face (and so geometry, a luminance, an area)? A ray file does not. */
export const hasFace = light => light?.shape === 'rectangle' || light?.shape === 'disc'

/** THE LIGHT'S COLOUR, EXACT: linear Rec.709 RGB of luminance 1, whichever way it was given. A
 *  chromaticity outside the Rec.709 gamut (a royal blue, a deep green) has a negative channel here,
 *  and keeps it: the optics trace and the picture's photons carry it exactly, and a detector turns it
 *  back into the XYZ it came from (core/colorimetry.js says why that is sound). */
export function lightRGB(L) {
    const by = L.colourBy ?? 'rgb'
    let rgb
    if (by === 'cct') rgb = rgbFromXy(...cctDuvToXy(L.cct ?? LIGHT_DEFAULTS.cct, L.duv ?? 0))
    else if (by === 'xy') rgb = rgbFromXy((L.xy ?? LIGHT_DEFAULTS.xy).x, (L.xy ?? LIGHT_DEFAULTS.xy).y)
    else { const c = L.colour ?? LIGHT_DEFAULTS.colour; rgb = [c.r, c.g, c.b] }
    const Y = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2]
    return Y > 0 ? rgb.map(v => v / Y) : [1, 1, 1]
}
/** The same as {r, g, b}: what the face's uniform takes (the display clips it, once per pixel). */
export function lightRGBObject(L) {
    const [r, g, b] = lightRGB(L)
    return { r, g, b }
}
/** ...and clipped into the display's gamut, luminance kept: for a colour swatch. */
export function lightDisplayRGB(L) {
    const [r, g, b] = gamutClip(lightRGB(L))
    return { r, g, b }
}
/** Its chromaticity, CCT and Duv, whichever way it was given -- for the panel to show. */
export function lightChromaticity(L) {
    const xy = XYZtoxy(rgbToXYZ(lightRGB(L))) ?? [0.3127, 0.329]
    const rgb = lightRGB(L)
    return { x: xy[0], y: xy[1], ...xyToCctDuv(xy[0], xy[1]), outOfGamut: Math.min(...rgb) < -1e-9 }
}

const vec3ok = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)
const rgbOk = c => c && typeof c === 'object' && ['r', 'g', 'b'].every(k => Number.isFinite(c[k]))

/** Everything wrong with a light object, as strings. */
export function lightProblems(n) {
    const L = n.light, p = [], id = n.id
    if (!L || typeof L !== 'object' || Array.isArray(L)) return [`'${id}': a light needs its light settings`]
    if (!(L.shape in LIGHT_SHAPES)) return [`'${id}': light shape must be one of ${Object.keys(LIGHT_SHAPES).join(', ')}`]
    for (const k of Object.keys(L)) if (!KEYS.includes(k)) p.push(`'${id}': unknown light setting '${k}'`)
    if (L.colour !== undefined && !rgbOk(L.colour)) p.push(`'${id}': light colour must be {r, g, b} numbers`)
    if (L.colourBy !== undefined && !COLOUR_BY.includes(L.colourBy)) p.push(`'${id}': colourBy must be one of ${COLOUR_BY.join(', ')}`)
    if (L.cct !== undefined && !(Number.isFinite(L.cct) && L.cct >= CCT_MIN && L.cct <= CCT_MAX)) p.push(`'${id}': cct must be ${CCT_MIN}-${CCT_MAX} K`)
    if (L.duv !== undefined && !(Number.isFinite(L.duv) && Math.abs(L.duv) <= 0.05)) p.push(`'${id}': duv must be within +-0.05`)
    if (L.xy !== undefined && !(L.xy && Number.isFinite(L.xy.x) && Number.isFinite(L.xy.y) && L.xy.x > 0 && L.xy.y > 0 && L.xy.x + L.xy.y < 1))
        p.push(`'${id}': xy must be {x, y}, both > 0 and x + y < 1`)
    if (L.luminance !== undefined && !(Number.isFinite(L.luminance) && L.luminance >= 0)) p.push(`'${id}': luminance must be cd/m^2 >= 0`)
    if (L.flux !== undefined && L.flux !== null && !(Number.isFinite(L.flux) && L.flux >= 0)) p.push(`'${id}': flux must be lm >= 0, or null`)
    if (L.distribution !== undefined && !DISTRIBUTIONS.includes(L.distribution)) p.push(`'${id}': distribution must be one of ${DISTRIBUTIONS.join(', ')}`)
    if (L.n !== undefined && !(Number.isFinite(L.n) && L.n >= 0)) p.push(`'${id}': n must be a number >= 0`)
    if (L.halfAngle !== undefined && !(Number.isFinite(L.halfAngle) && L.halfAngle > 0 && L.halfAngle <= 90)) p.push(`'${id}': halfAngle must be in (0, 90]`)
    if (L.emitN !== undefined && !(Number.isFinite(L.emitN) && L.emitN >= 1)) p.push(`'${id}': emitN must be a number >= 1`)
    for (const k of ['twoSided', 'transparent']) if (L[k] !== undefined && typeof L[k] !== 'boolean') p.push(`'${id}': ${k} must be true or false`)
    if (L.shape === 'rayfile') {
        if (typeof (L.file ?? '') !== 'string') p.push(`'${id}': a ray file's file must be a name`)
        if (L.box !== undefined && !(Array.isArray(L.box) && L.box.length === 2 && L.box.every(vec3ok))) p.push(`'${id}': box must be [min, max]`)
    } else {
        if (L.file !== undefined || L.box !== undefined) p.push(`'${id}': file and box are a ray file's`)
        if (L.distribution === 'collimated' && L.flux == null) p.push(`'${id}': a collimated light has no luminance -- give it a flux`)
        const need = Object.keys(LIGHT_SHAPES[L.shape].params)
        for (const k of need) if (!(Number.isFinite(n.params?.[k]) && n.params[k] > 0)) p.push(`'${id}': a ${L.shape} light needs ${k} > 0`)
    }
    return p
}

/** k: flux per unit luminance and unit area, one face. With L0 the luminance straight out of the face
 *  and the distribution's shape L(theta) = L0 f(theta), the flux out of one face of area A is
 *  L0 A k, k the integral of f cos over the cone:
 *    cos^n, radiance cos^(n-1):  k = 2 pi (1 - c^(n+1)) / (n + 1)     (c = cos halfAngle; pi Lambertian)
 *    uniform in solid angle:     k = 2 pi (1 - c)                     (radiance 1 / cos: even intensity)
 *    collimated:                 null -- a delta has no luminance, only its flux means anything */
export function fluxFactor(s) {
    const c = Math.cos(Math.min(90, Math.max(0, s.halfAngle ?? 90)) * Math.PI / 180)
    if (s.distribution === 'collimated') return null
    if (s.distribution === 'uniform') return 2 * Math.PI * (1 - c)
    const n = Math.max(0, s.n ?? 1)
    return 2 * Math.PI * (1 - Math.pow(Math.max(c, 0), n + 1)) / (n + 1)
}

/** THE BEAM, as the face's uniform (codegen LIGHTS, `beam_<id>`, a vec4): the distribution in the
 *  optics kernels' code, the cos^n exponent, and the cosine of the half angle -- what the face's
 *  lightBeam() reads, so the camera sees the light the photons carry. */
export const beamOf = L => [SOURCE_CODES[L.distribution] ?? SOURCE_CODES.cosine, Math.max(0, L.n ?? 1),
    Math.cos(Math.min(90, Math.max(0, L.halfAngle ?? 90)) * Math.PI / 180), 0]

/** THE FACE'S RADIANCE AT AN ANGLE, over its luminance straight out: lightBeam() in codegen's WGSL,
 *  in JS for the test -- the same formulas, change both or neither. cosT is the cosine of the angle
 *  from the face's normal. It is the shape the photons carry (optics/kernels.js SOURCE_RAY), so
 *  g cos integrated over the hemisphere is fluxFactor: the face shows exactly the light it emits.
 *  A collimated light has no luminance to show (a delta), so it shows its Lambertian equivalent,
 *  as syncSources gives it one: 1 at every angle. */
export function beamShape(beam, cosT) {
    const kind = Math.round(beam[0])
    if (kind === SOURCE_CODES.collimated) return 1
    if (cosT < beam[2]) return 0                        // outside the cone
    const c = Math.max(cosT, 1e-4)
    if (kind === SOURCE_CODES.uniform) return 1 / c     // even intensity: radiance 1/cos
    return Math.pow(c, beam[1] - 1)                     // cos^n intensity: radiance cos^(n-1)
}

/** Euler angles (degrees, the transform's x-then-y rotation) that turn +z onto `axis`: for placing
 *  a light that faces a given way. */
export function rotationTowards(axis) {
    const l = Math.hypot(...axis) || 1
    const [x, y, z] = axis.map(c => c / l)
    const rx = Math.asin(Math.max(-1, Math.min(1, -y)))
    const ry = Math.atan2(x, z)
    return { x: rx * 180 / Math.PI, y: ry * 180 / Math.PI, z: 0 }
}
