//======================================================================================================================
// HAZE BOX -- dust in the air (0.62.0; the renderer's side is lib/pathtracer/core/haze.js, which says what it does).
//
// A BOX IS AN OBJECT OF ITS OWN TYPE, `type: 'haze'`, as an export box is (exportbox.js) and for the same reason: its
// shape has to stay known -- the renderer tests every ray's leg against it exactly -- and a code node's cannot. It draws
// nothing: codegen emits a comment for it, declaring its transform's uniform as it does for anything left out, and the
// scene it generates carries the box as `scene.haze` (hazeOf, below). It has what every object has: a place in the tree,
// a transform the handles move and turn, a size (its `size` parameter, the full edge lengths in its own frame, centred
// on its origin, stretched by the Transform gizmo's cubes). And `haze`, its settings, over HAZE_DEFAULTS:
//   mfp      the MEAN FREE PATH, in real METRES whatever the scene's unit (as a material's colour depth is real mm): how
//            far light goes on average before it meets a particle. One over the extinction coefficient. Visibility --
//            the distance a dark object fades to 2% contrast (Koschmieder) -- is 3.912 of these.
//   albedo   what a particle scatters of the light it meets, per channel; the rest it absorbs. 1 is white dust.
//   g        Henyey-Greenstein's asymmetry: 0 scatters evenly, towards 1 forward (real dust and haze: about 0.6 to 0.8,
//            so a beam looks brightest looking into it), towards -1 back. Held within +-0.95 (core/haze.js).
//
// ONLY THE AIR IN IT SCATTERS: glass and solids inside the box stay clear (the user's condition, 2026-10-16). One box a
// scene: a second is refused (model.js) -- several overlapping media would need the collision drawn over their sum, and
// nobody has asked. In an array the box is its first copy's, as an export box is.
//
// THE DEFAULTS ARE CHOICES, NOT SEEN (2026-10-16): mfp 1 m -- dense, thicker than the dust a sunbeam shows in a room
// (a rough figure, not measured) -- so a box placed in a small scene shows something; albedo 0.9; g 0.7, about what
// atmospheric haze is quoted at (from the literature, not measured here).
//
// Pure functions over the document or codegen's tree, so tested in node (test/hazebox.test.mjs).
//======================================================================================================================

import { toParent } from './bounds.js'
import { HAZE_G_MAX } from '../lib/pathtracer/core/haze.js'

export { HAZE_G_MAX }
export const HAZE_PARAMS = Object.freeze({ size: Object.freeze({ x: 1, y: 1, z: 1 }) })
/** Which of its parameters the Transform gizmo's cube on each axis multiplies (stretch.js): its size, whole along each
 *  axis, so a cube pulls that face out -- as an export box's. */
export const HAZE_STRETCH = Object.freeze({ x: ['size.x'], y: ['size.y'], z: ['size.z'] })
export const HAZE_DEFAULTS = Object.freeze({ mfp: 1, albedo: Object.freeze({ r: 0.9, g: 0.9, b: 0.9 }), g: 0.7 })
/** Koschmieder's constant: the distance at which a black object's contrast against the sky falls to 2% is -ln(0.02)
 *  mean free paths. The panel shows it beside the mean free path, the number a weather report gives. */
export const KOSCHMIEDER = -Math.log(0.02)
export const visibilityOf = mfp => KOSCHMIEDER * mfp

/** The box's settings with the defaults filled in. */
export const hazeSettings = node => ({ ...HAZE_DEFAULTS, ...(node?.haze || {}) })

/** Everything wrong with a haze box, as strings. */
export function hazeProblems(n) {
    const p = [], id = n.id
    const s = n.params?.size
    if (!s || !['x', 'y', 'z'].every(k => Number.isFinite(s[k]) && s[k] > 0)) p.push(`'${id}': a haze box needs a size {x, y, z} > 0`)
    for (const k of Object.keys(n.params || {})) if (k !== 'size') p.push(`'${id}': a haze box has no parameter '${k}'`)
    if (n.material != null) p.push(`'${id}': a haze box has no material`)
    if (n.code !== undefined) p.push(`'${id}': a haze box has no code`)
    if (n.constants !== undefined || n.ranges !== undefined) p.push(`'${id}': a haze box has no constants or ranges`)
    const H = n.haze
    if (H !== undefined) {
        if (!H || typeof H !== 'object' || Array.isArray(H)) return [...p, `'${id}': haze settings must be an object`]
        for (const k of Object.keys(H)) if (!(k in HAZE_DEFAULTS)) p.push(`'${id}': unknown haze setting '${k}'`)
        if (H.mfp !== undefined && !(Number.isFinite(H.mfp) && H.mfp > 0)) p.push(`'${id}': a haze's mean free path must be metres > 0`)
        if (H.albedo !== undefined) {
            const a = H.albedo
            if (!a || typeof a !== 'object' || !['r', 'g', 'b'].every(k => Number.isFinite(a[k]) && a[k] >= 0 && a[k] <= 1)
                || Object.keys(a).some(k => !['r', 'g', 'b'].includes(k)))
                p.push(`'${id}': a haze's albedo must be {r, g, b}, each from 0 to 1`)
        }
        if (H.g !== undefined && !(Number.isFinite(H.g) && Math.abs(H.g) <= HAZE_G_MAX)) p.push(`'${id}': a haze's g must be from -${HAZE_G_MAX} to ${HAZE_G_MAX}`)
    }
    return p
}

/* THE TRANSFORMS FROM EACH NODE TO THE WORLD, the node's own first -- bounds.js framesTo's rule (an array's first copy
   between it and its child; the root's own never applied), walked down once, over a document or codegen's tree alike:
   both have the root, the children, the transforms and the copies. `shown` is whether it and every group above it is. */
function eachObject(root, visit) {
    const go = (n, outer, shown) => {
        const own = n !== root && n.transform ? [...outer, n.transform] : outer
        const here = shown && n.enabled !== false
        if (n.kind === 'object') { visit(n, [...own].reverse(), here); return }
        const inner = n !== root && n.copies?.length ? [...own, n.copies[0]] : own
        for (const c of n.children || []) go(c, inner, here)
    }
    go(root, [], true)
}

/** The haze box's node in a document or a tree: the first one, or null (one a scene: model.js). */
export function hazeNode(docOrTree) {
    let found = null
    if (docOrTree?.root) eachObject(docOrTree.root, n => { if (!found && n.type === 'haze') found = n })
    return found
}

/**
 * THE SCENE'S HAZE, as the renderer takes it (scene.haze; core/haze.js hazeUniforms): the first haze box in the world,
 * in the scene's units -- its centre, its three unit axes, its half-sizes -- and its settings, the albedo as [r, g, b];
 * `on` false while it or a group above it is hidden (a tree with live visibility, or the scene as data, keeps hidden
 * nodes: the box is there and its density 0, so the eye compiles nothing). null with no box.
 */
export function hazeOf(docOrTree) {
    let out = null
    if (!docOrTree?.root) return null
    eachObject(docOrTree.root, (n, frames, shown) => {
        if (out || n.type !== 'haze') return
        const toWorld = p => frames.reduce((q, t) => toParent(t, q), p)
        const c = toWorld([0, 0, 0])
        const size = n.params?.size || HAZE_PARAMS.size
        const half = [size.x / 2, size.y / 2, size.z / 2]
        const axes = [], scaled = []
        for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
            const w = toWorld(e).map((v, k) => v - c[k]), l = Math.hypot(...w)
            axes.push(l > 0 ? w.map(v => v / l) : e)
            scaled.push(l)
        }
        const S = hazeSettings(n)
        out = { id: n.id, on: shown, centre: c, axes, half: half.map((h, k) => h * scaled[k]),
                mfp: S.mfp, albedo: [S.albedo.r, S.albedo.g, S.albedo.b], g: S.g }
    })
    return out
}
