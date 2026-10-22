//======================================================================================================================
// SOURCES -- the scene's lights as the optics trace and the picture's photons take them: in world
// space, in lumens.
//
// Every light is a builder light object (model version 10, lights.js): a rectangle or a disc, flat,
// emitting along its +z unless two-sided, or a Zemax ray file. A rectangle's or a disc's area and
// every point on it are known exactly, which is what the optics trace needs to start rays on it and
// what turns lumens into luminance. A glowing material (type emitter) on any other shape is not a
// source here: the renderer draws it as an ordinary emitter, and it has no known shape to sample.
//
// LUMINANCE AND FLUX. With L0 the luminance straight out of the face (cd/m^2) and the distribution's
// shape, one face of area A emits L0 A k (lights.js fluxFactor). A light given by FLUX has its
// luminance derived from that (syncSources) -- the luminance straight out of its face that emits
// that flux, which is what the camera sees when it looks at the light directly.
//
// INSIDE AN ARRAY (a group's copies, 0.next) a light is a source a copy, each of the light's own flux (lights.js A
// LIGHT INSIDE ARRAYS): the same entry once a copy, at that copy's frame, `copy` its index among `copies`, its label
// saying which, and `key` an id of its own (a ray set's placed rays are kept under it; outside an array, its id).
//======================================================================================================================
import { UNITS } from '../lib/pathtracer/core/photometry.js'
import { toParent } from './bounds.js'
import { find, walk, groupHasCode } from './model.js'
import { lightOf, hasFace, fluxFactor, rotationTowards, DISTRIBUTIONS, lightRGB, arraysOf, copyCount, copyIndices, arrayedLightProblem } from './lights.js'
import { isCsg } from './codegen.js'

export { fluxFactor, rotationTowards, DISTRIBUTIONS }

/* the node, its world frames -- one a copy of the arrays above it, innermost fastest (lights.js copyIndices) -- and
   whether anything above it makes them unreliable */
const worldFrames = (doc, id) => {
    const chain = []
    for (let f = find(doc, id); f; f = f.parent ? find(doc, f.parent.id) : null) { chain.push(f.node); if (!f.parent) break }
    const node = chain[0]
    const above = chain.slice(1)
    const disabled = chain.some(n => n.enabled === false)
    /* GROUP CODE can move its children anywhere: under it the light is not where its own transform says, and
       codegen does not draw it there either. A CSG GROUP moves nothing -- it combines its shapes, and a light is
       not one of them -- so a light in one is drawn at its transforms (codegen collectLights, emitHoisted) and
       traced from them. It was skipped here as if CSG were code until 2026-10-03, which left OpticsBench2's
       laser with no rays and no word in the view. The code test is codegen's own (hasCode: a block of
       comments only is no code), so the two never disagree on which lights are drawn. */
    const warped = above.some(n => n !== doc.root && groupHasCode(doc, n))
    // ...and an array it cannot be drawn once a copy in, codegen's rule too (collectLights)
    const groups = above.filter(n => n !== doc.root).reverse()          // outermost first
    const arrayed = warped ? null : arrayedLightProblem(groups, isCsg)
    const arrays = arraysOf(groups), counts = arrays.map(g => g.copies.length)
    const frames = []
    for (let j = 0; j < copyCount(groups); j++) {
        /* a copy is entered after its group's own frame (codegen group(), AN ARRAY): from the light outwards, the
           copy's transform comes before its group's */
        const c = copyIndices(j, counts)
        const steps = []
        for (const n of chain) {
            if (n === doc.root) continue
            const k = n !== node ? arrays.indexOf(n) : -1
            if (k >= 0) steps.push(n.copies[c[k]])
            if (n.transform) steps.push(n.transform)
        }
        const toWorld = p => steps.reduce((q, t) => toParent(t, q), p)
        const scale = steps.reduce((s, t) => s * t.scale, 1)
        const o = toWorld([0, 0, 0])
        const axis = v => { const w = toWorld(v); const d = [w[0] - o[0], w[1] - o[1], w[2] - o[2]]; const l = Math.hypot(...d) || 1; return d.map(x => x / l) }
        frames.push({ origin: o, u: axis([1, 0, 0]), v: axis([0, 1, 0]), normal: axis([0, 0, 1]), scale })
    }
    return { node, disabled, warped, arrayed, frames }
}

/**
 * Every light in the scene, as the optics trace takes them:
 *   { sources: [...], skipped: [{ id, label, reason }] }
 * a face:     { id, label, kind: 'face', shape, origin, u, v, normal, half: [a, b], area, flux, ...settings }
 * a ray file: { id, label, kind: 'rayset', file, flux (null: the file's), emitN, origin, u, v, normal, scale }
 * and inside an array, once a copy, with { copy, copies, key } (the header: INSIDE AN ARRAY).
 * half is the rectangle's half-width and half-height, or the disc's radius twice, in scene units;
 * area in scene units^2 (one face); flux in lm, both faces together. `normal`, not `n`: n is the
 * cos^n exponent among the settings.
 */
export function sourceTable(doc) {
    const s2 = (UNITS[doc.unit] ?? 1) ** 2                       // scene units^2 to m^2
    const sources = [], skipped = []
    walk(doc, n => {
        if (n.kind !== 'object' || n.type !== 'light') return
        const W = worldFrames(doc, n.id)
        const label = n.label ?? n.id
        const L = lightOf(n)
        if (W.disabled) return
        if (W.warped) { skipped.push({ id: n.id, label, reason: 'inside group code, which can move it anywhere: not where its transform says' }); return }
        if (W.arrayed) { skipped.push({ id: n.id, label, reason: W.arrayed }); return }
        if (L.shape === 'rayfile' && !L.file) { skipped.push({ id: n.id, label, reason: 'no ray file chosen' }); return }
        const K = W.frames.length
        W.frames.forEach((F, j) => {
            const copy = K > 1 ? { copy: j, copies: K, key: `${n.id}#${j + 1}`, label: `${label} (copy ${j + 1} of ${K})` } : { label }
            if (L.shape === 'rayfile') {
                sources.push({ id: n.id, ...copy, kind: 'rayset', file: L.file, flux: L.flux, emitN: L.emitN, colour: lightRGB(L),
                               origin: F.origin, u: F.u, v: F.v, normal: F.normal, scale: F.scale })
                return
            }
            const P = n.params || {}
            const half = L.shape === 'rectangle' ? [(P.width ?? 1) / 2 * F.scale, (P.height ?? 1) / 2 * F.scale]
                                                 : [(P.radius ?? 0.5) * F.scale, (P.radius ?? 0.5) * F.scale]
            const area = L.shape === 'rectangle' ? 4 * half[0] * half[1] : Math.PI * half[0] * half[0]
            const faces = L.twoSided ? 2 : 1
            const k = fluxFactor(L)
            const flux = L.flux != null ? L.flux : k == null ? 0 : L.luminance * area * s2 * k * faces
            /* the colour goes with it: the trace and the picture's photons carry it (optics/sources.js
               hue). It was left out here, and a coloured light lit its scene white. EXACT, whichever way
               it was given (lights.js lightRGB): out of the Rec.709 gamut it has a negative channel. */
            const { luminance, ...settings } = L
            sources.push({ id: n.id, ...copy, kind: 'face', ...settings, colour: lightRGB(L), shape: L.shape, origin: F.origin, u: F.u, v: F.v,
                           normal: F.normal, half, area, flux, luminance })
        })
    })
    return { sources, skipped }
}

/** A FACE AS THE OPTICS MODULE TAKES IT (optics/sources.js sourceRecords), from a sourceTable entry:
 *  for the trace and for the picture's photons. One function, so the Optics page and the bench
 *  (builder/lightbench.js) start rays on a light exactly the same way. `onSurface`: the sheet is in
 *  the scene, so its rays start off it. */
export const faceSource = x => ({ type: x.shape, pos: x.origin, axis: x.normal, u: x.u, size: x.half,
    distribution: x.distribution, halfAngle: x.halfAngle, n: x.n, flux: x.flux, emitN: x.emitN, twoSided: x.twoSided,
    colour: x.colour, onSurface: true })

/**
 * THE LUMINANCE OF A LIGHT GIVEN BY FLUX: flux / (k * its area in m^2 * its faces), k the
 * distribution's factor -- the luminance straight out of its face, in what it emits into (emitN is not
 * in it: codegen LIGHTS divides by n^2 where a camera path meets the face). Written into the light, where
 * the shader reads it (the camera paths that see the face: codegen LIGHTS). A collimated light has
 * none; it is given the Lambertian one of its flux, so it is at least visible. Returns the ids of the
 * lights whose luminance changed, so a caller can push those uniforms.
 */
export function syncSources(doc) {
    const s2 = (UNITS[doc.unit] ?? 1) ** 2
    const changed = []
    for (const s of sourceTable(doc).sources) {
        if (s.kind !== 'face') continue
        const node = find(doc, s.id)?.node
        if (node?.light?.flux == null) continue
        const A = s.area * s2 * (s.twoSided ? 2 : 1)
        if (!(A > 0)) continue
        const L = node.light.flux / ((fluxFactor(s) ?? Math.PI) * A)
        if (Math.abs((node.light.luminance ?? 0) - L) > 1e-9 * Math.max(1, L)) {
            node.light.luminance = L
            changed.push(s.id)
        }
    }
    return changed
}
