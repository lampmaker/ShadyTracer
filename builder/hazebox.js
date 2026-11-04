//======================================================================================================================
// THE SCENE'S HAZE -- dust in the air (0.62.0; the renderer's side is lib/pathtracer/core/haze.js, which says what it does).
//
// THE SCENE'S, NOT A NODE (0.next). From 0.62.0 to 0.next this was a "haze box", an object of its own type added from
// the + menu and placed in the tree, one a scene (the user, 2026-11-04: such things "feel like add-ons, weird hacks and
// are not always properly placed"). Asked whether it could be a material instead: NO, and the reason is physics -- a
// box of index-1 material that scatters inside (materials.js scatterDistance, core/haze.js THE MEDIUM'S WALK) walks its
// rays correctly, but its walls are surfaces, every shadow ray stops at a surface, and inside a material a collision
// samples no light and connects no photon (the walk assumes the solid's own wall would block them): a beam in such
// "air" would be seen only by chance. The haze has no surface, which is exactly why light sampling works in it
// (roadmap/DIFFUSERS.md, Option A). So it is the scene's, like its environment: `doc.haze`, shown in the Environment
// box -- on or off, its dust, and the REGION it fills, a box. A file of version 26 or older has its haze box made the
// scene's haze, where it was in the world (model.js v26to27).
//
// doc.haze = { enabled, transform, params: { size }, haze?: settings, animate?, lockPosition?, lockParams? } -- the
// fields a haze box had, minus what made it a node. It is SHAPED LIKE ONE ON PURPOSE: hazeRegion(doc) gives a view of
// it as an object of type 'haze' under the reserved id HAZE_ID (as the environment's is '#environment'), which
// model.js find() answers -- so the Transform gizmo, its stretch cubes, the numbers' panel, the outline, a double-click
// framing it and the Properties panel move and size it with the code they move every object with. It is in no tree:
// walk() never visits it, nothing can move, remove or copy it.
//   transform  where the region is, in the world (the root's frame), turned and scaled as any object
//   size       its full edge lengths in its own frame, centred on its origin
//   haze       its settings, over HAZE_DEFAULTS:
//   mfp        the MEAN FREE PATH, in real METRES whatever the scene's unit (as a material's colour depth is real mm): how
//              far light goes on average before it meets a particle. One over the extinction coefficient. Visibility --
//              the distance a dark object fades to 2% contrast (Koschmieder) -- is 3.912 of these.
//   albedo     what a particle scatters of the light it meets, per channel; the rest it absorbs. 1 is white dust.
//   g          Henyey-Greenstein's asymmetry: 0 scatters evenly, towards 1 forward (real dust and haze: about 0.6 to 0.8,
//              so a beam looks brightest looking into it), towards -1 back. Held within +-0.95 (core/haze.js).
//
// ONLY THE AIR IN IT SCATTERS: glass and solids inside the region stay clear (the user's condition, 2026-10-16). One a
// scene: several overlapping media would need the collision drawn over their sum, and nobody has asked.
//
// THE DEFAULTS ARE CHOICES, NOT SEEN (2026-10-16): mfp 1 m -- dense, thicker than the dust a sunbeam shows in a room
// (a rough figure, not measured) -- so a region placed in a small scene shows something; albedo 0.9; g 0.7, about what
// atmospheric haze is quoted at (from the literature, not measured here).
//
// Pure functions over the document or codegen's tree, so tested in node (test/hazebox.test.mjs).
//======================================================================================================================

import { toParent } from './bounds.js'
import { corners } from './exportbox.js'
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

/** THE REGION'S RESERVED ID: model.js find() answers it with hazeRegion(doc), and nothing else can be called it (a node's
 *  id is letters and digits, model.js ID). */
export const HAZE_ID = '#haze'

/** The region's eight corners in the world, for drawing and framing it (overlay.js, focus.js); null without one, or for
 *  any other id. */
export function boxCorners(doc, id = HAZE_ID) {
    const H = id === HAZE_ID ? doc?.haze : null
    if (!H) return null
    const s = H.params?.size || HAZE_PARAMS.size
    return corners({ frames: H.transform ? [H.transform] : [], lo: [-s.x / 2, -s.y / 2, -s.z / 2], hi: [s.x / 2, s.y / 2, s.z / 2] })
}

/* the view, one per doc.haze object: so a selection or a drag holding it holds the same one while the haze stays */
const views = new WeakMap()
const VIEW_OWN = { id: HAZE_ID, kind: 'object', type: 'haze', label: 'haze in the air', material: null }
/**
 * THE SCENE'S HAZE AS AN OBJECT (see the header): its own id, kind, type, label and no material, and every other
 * field doc.haze's -- read from it and written into it, so what moves an object's transform or sizes its `size`
 * moves and sizes the region. Its `enabled` is whether the haze is on. null when the scene has none.
 */
export function hazeRegion(doc) {
    const H = doc?.haze
    if (!H || typeof H !== 'object') return null
    if (views.has(H)) return views.get(H)
    const v = new Proxy(H, {
        get: (t, k) => k in VIEW_OWN ? VIEW_OWN[k] : t[k],
        set: (t, k, x) => { if (k in VIEW_OWN) return true; t[k] = x; return true },
        deleteProperty: (t, k) => { if (!(k in VIEW_OWN)) delete t[k]; return true },
        has: (t, k) => k in VIEW_OWN || k in t,
        ownKeys: t => [...new Set([...Object.keys(VIEW_OWN), ...Reflect.ownKeys(t)])],
        getOwnPropertyDescriptor: (t, k) => k in VIEW_OWN ? { value: VIEW_OWN[k], enumerable: true, configurable: true, writable: false }
            : Reflect.getOwnPropertyDescriptor(t, k),
    })
    views.set(H, v)
    return v
}

/** A NEW HAZE: the defaults, filling `box` ({ lo, hi } in the world: the scene's fitted box, exportbox.js fittedBox) or
 *  a 1-unit cube at the origin. */
export function newHaze(box = null) {
    const c = box ? [0, 1, 2].map(k => (box.lo[k] + box.hi[k]) / 2) : [0, 0, 0]
    const s = box ? [0, 1, 2].map(k => Math.max(1e-6, box.hi[k] - box.lo[k])) : [1, 1, 1]
    return { enabled: true, transform: { pos: { x: c[0], y: c[1], z: c[2] }, rot: { x: 0, y: 0, z: 0 }, scale: 1 },
             params: { size: { x: s[0], y: s[1], z: s[2] } } }
}

/** The box's settings with the defaults filled in. */
export const hazeSettings = node => ({ ...HAZE_DEFAULTS, ...(node?.haze || {}) })

/** Everything wrong with the scene's haze (its view: hazeRegion), as strings. */
export function hazeProblems(n) {
    const p = [], id = n.id ?? HAZE_ID
    const s = n.params?.size
    if (!s || !['x', 'y', 'z'].every(k => Number.isFinite(s[k]) && s[k] > 0)) p.push(`'${id}': the haze's region needs a size {x, y, z} > 0`)
    for (const k of Object.keys(n.params || {})) if (k !== 'size') p.push(`'${id}': the haze's region has no parameter '${k}'`)
    if (n.material != null) p.push(`'${id}': the haze has no material`)
    if (n.code !== undefined) p.push(`'${id}': the haze has no code`)
    if (n.constants !== undefined || n.ranges !== undefined) p.push(`'${id}': the haze has no constants or ranges`)
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
   between it and its child; the root's own never applied), walked down once. `shown` is whether it and every group
   above it is. For a file of 26 or older, whose haze was a node (legacyHazeBox). */
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

/** A BOX'S PLACE IN THE WORLD: its centre, three unit axes and half-sizes, from its frames (innermost first). */
function inWorld(frames, size) {
    const toWorld = p => frames.reduce((q, t) => toParent(t, q), p)
    const c = toWorld([0, 0, 0])
    const half = [size.x / 2, size.y / 2, size.z / 2]
    const axes = [], scaled = []
    for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const w = toWorld(e).map((v, k) => v - c[k]), l = Math.hypot(...w)
        axes.push(l > 0 ? w.map(v => v / l) : e)
        scaled.push(l)
    }
    return { centre: c, axes, half: half.map((h, k) => h * scaled[k]) }
}

/**
 * A FILE OF 26 OR OLDER'S HAZE BOX (model.js v26to27): the first in the world -- in an array its first copy's -- with
 * where it is, { node, shown, centre, axes, half }, or null with none.
 */
export function legacyHazeBox(root) {
    let out = null
    if (root) eachObject(root, (n, frames, shown) => {
        if (out || n.type !== 'haze') return
        out = { node: n, shown, ...inWorld(frames, n.params?.size || HAZE_PARAMS.size) }
    })
    return out
}

/**
 * THE SCENE'S HAZE, as the renderer takes it (scene.haze; core/haze.js hazeUniforms): from a document (doc.haze) or
 * codegen's tree (toTree puts the same at its root, while it is on or live visibility keeps it), in the scene's units
 * -- the region's centre, its three unit axes, its half-sizes -- and its settings, the albedo as [r, g, b]; `on` false
 * while it is switched off (the box is there and its density 0, so the switch compiles nothing). null with none.
 */
export function hazeOf(docOrTree) {
    const H = docOrTree?.haze
    if (!H || typeof H !== 'object') return null
    const S = hazeSettings(H)
    return { id: HAZE_ID, on: H.enabled !== false, ...inWorld(H.transform ? [H.transform] : [], H.params?.size || HAZE_PARAMS.size),
             mfp: S.mfp, albedo: [S.albedo.r, S.albedo.g, S.albedo.b], g: S.g }
}
