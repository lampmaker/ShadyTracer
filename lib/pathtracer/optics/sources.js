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
import { SRC_VEC4, RAYSET_VEC4 } from './kernels.js'
import { LUMA } from '../core/photometry.js'

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
 *  A RAY SET is { type: 'rayset', rays: key, flux, emitN }: its rays are rayData.get(key), a
 *  Float32Array of RAYSET_VEC4 vec4s a ray already in scene units and world space (position, weight;
 *  direction, 0) -- the host places them (a Zemax file's rays, through its builder object's frame).
 *  They are packed one after another into `rays`, and the record says where.
 *
 *  Returns { data: Float32Array, count, flux, rays: Float32Array } -- flux the total, in lm. */
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
    let cum = 0
    live.forEach((s, i) => {
        cum += s.flux
        const cdf = i === live.length - 1 ? 1 : cum / flux          // the last reaches 1 exactly
        const o = i * SRC_VEC4 * 4
        if (s.type === 'rayset') {
            data.set([0, 0, 0, cdf, 0, 0, 1, SOURCE_TYPES.rayset, 1, 0, 0, at.get(s.rays), nRays(s), 0, 0, 0,
                      Math.max(1, s.emitN ?? 1), 0, 0, 0, ...hue(s.colour), 0], o)
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
                  Math.max(1, s.emitN ?? 1), s.twoSided ? 1 : 0, s.onSurface ? 1 : 0, 0,
                  ...hue(s.colour), 0], o)
    })
    return { data, count: live.length, flux, rays }
}

/** A RAY SET FOR THE KERNELS: a parsed file's rays (zemax.js: metres, the file's frame) placed by a
 *  frame -- origin, the unit axes u, v, w the file's x, y, z go to, and the scene units per metre
 *  times the frame's own scale -- as RAYSET_VEC4 vec4s a ray, in the SCENE's unit (sourceRecords takes them to
 *  the engine's): position and weight (its flux over the
 *  set's mean, so the rays' weights average 1 and the set's flux is what the description says),
 *  then direction. */
export function placeRays(fileRays, { origin = [0, 0, 0], u = [1, 0, 0], v = [0, 1, 0], w = [0, 0, 1], scale = 1 }, floatsPerRay = 8) {
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
