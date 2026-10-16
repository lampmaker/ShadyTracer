//======================================================================================================================
// FOCUS -- the camera brought to a node: a double-click on its row in the tree (the user, 2026-10-02: "when you
// double-click on an object, you zoom in on it" ... "I mean clicking on an object in the tree").
//
// PURE: no DOM, no renderer -- the box a node has, the orbit that frames it, a pose between two; test/focus.test.mjs.
// The page (index.html focusOn) asks for them and moves the camera.
//
//   focusBox(doc, id, boxes)     the world box to frame, { lo, hi, open, measured } -- or null: nothing to frame
//   framing(lo, hi, opts)        { target, distance, radius }: a camera at that distance sees the sphere round the box
//   focusPose(camera, box, opts) the orbit camera that frames it, looking the way the camera looks now
//   glidePose(a, b, t)           the camera t of the way from a to b (t in 0..1, eased)
//
// WHY THE VIEWING DIRECTION IS KEPT: the user has turned the view to look at the scene from somewhere; the zoom only
// brings the object to the middle and near. Azimuth and elevation stay, the target and the distance change.
//======================================================================================================================

import { find } from './model.js'
import { estimateBox } from './bounds.js'
import { boxCorners } from './exportbox.js'
import { orbitOf } from '../lib/pathtracer/params.js'

const union = (a, b) => !a ? b : !b ? a
    : { lo: a.lo.map((v, k) => Math.min(v, b.lo[k])), hi: a.hi.map((v, k) => Math.max(v, b.hi[k])) }
const boxOf = pts => pts?.length ? { lo: [0, 1, 2].map(k => Math.min(...pts.map(p => p[k]))), hi: [0, 1, 2].map(k => Math.max(...pts.map(p => p[k]))) } : null
const size = b => Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2])

/**
 * THE BOX TO FRAME, in the world: { lo, hi, open, measured }, or null when there is none to frame -- the root, an id
 * not in the scene, a node with no size known. In this order:
 *  - an EXPORT BOX: its own box, exactly (exportbox.js), which the estimate leaves out;
 *  - the MEASURED box (boxes.js), when it is for the node as it is now (fresh) -- the shape the code really draws.
 *    A group's is put together from its children's, and is only whole once each is measured, hence fresh. `open`
 *    says it is endless (a plane): the page frames nothing then;
 *  - the document's ESTIMATE (bounds.js estimateBox): right for the stock shapes, a guess for code. It has none for
 *    a group itself -- it counts objects -- so a group's is the union of its enabled objects' (boxes.js objectsRough).
 *    One of no size at all (a plane: no parameter) is no box.
 * `boxes` is the page's BOXES, or null (a test, a page without one).
 */
export function focusBox(doc, id, boxes = null) {
    const f = id != null && find(doc, id)
    if (!f || f.node === doc.root) return null
    const node = f.node
    if (node.type === 'export' || node.type === 'haze') {
        const c = boxCorners(doc, id)
        return c ? { ...boxOf(c), open: false, measured: true } : null
    }
    if (boxes?.fresh?.(id)) {
        const c = boxes.corners(doc, id)
        if (c) return { ...boxOf(c), open: !!boxes.get(id)?.open, measured: true }
    }
    let b = null
    const walk = n => {
        if (n.enabled === false) return
        if (n.kind === 'object' && n.type !== 'export' && n.type !== 'haze') b = union(b, estimateBox(doc.root, n, doc))
        for (const c of n.children || []) walk(c)
    }
    walk(node)
    if (b && size(b) > 0) return { ...b, open: false, measured: false }
    // nothing estimated: a measured box that is not fresh is still better than none (it is asked for again by corners)
    const c = boxes?.corners?.(doc, id)
    return c ? { ...boxOf(c), open: !!boxes.get(id)?.open, measured: true } : null
}

/**
 * A CAMERA THAT FRAMES A BOX: its centre, and the distance at which the sphere round it, times `margin`, fills the
 * narrower of the two fields of view -- the vertical one `fov` (lib/camera.js), or the horizontal one when the view
 * is taller than wide (aspect = width / height below 1). Also the library's studio's (library/studio.js), which
 * frames items in a square picture, so aspect 1 there.
 */
export function framing(lo, hi, { fov = 40, margin = 1.12, aspect = 1 } = {}) {
    const target = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2)
    const r = Math.max(1e-6, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) * margin
    const half = fov * Math.PI / 360
    const narrow = aspect > 0 && aspect < 1 ? Math.atan(Math.tan(half) * aspect) : half
    return { target, distance: r / Math.sin(narrow), radius: r }
}

/* the camera panel's own floor on the distance (lib/pathtracer/params.js CAM_FIELDS): a framing nearer than it would
   be written back clamped the next time the panel refreshed */
export const MIN_DISTANCE = 0.01

/**
 * THE ORBIT CAMERA THAT FRAMES `box`, looking the way `camera` (lib/camera.js get()) looks now: the same azimuth and
 * elevation, the box's centre as the target, the distance from framing(). A free (fps) camera is taken to the orbit
 * that has it where it is (params.js orbitOf) -- and it must be: lib/camera.js does not rebuild its view for a new
 * position in that mode. A parallel (orthographic, camtype 1) view is framed by its width, `dimensions`, which then
 * shows the sphere's diameter across its narrower side.
 */
export function focusPose(camera, box, { margin = 1.12 } = {}) {
    const fov = camera?.fov ?? 40, aspect = camera?.aspect ?? 1
    const F = framing(box.lo, box.hi, { fov, margin, aspect })
    const orbit = camera?.mode === 'orbit' || camera?.mode == null
        ? { azimuth: camera?.azimuth ?? 40, elevation: camera?.elevation ?? 70 }
        : (camera.pos && camera.target && orbitOf(camera.pos, camera.target)) || { azimuth: 40, elevation: 70 }
    const out = { mode: 'orbit', target: F.target, azimuth: orbit.azimuth, elevation: orbit.elevation,
                  distance: Math.max(MIN_DISTANCE, F.distance) }
    if ((camera?.camtype | 0) === 1) out.dimensions = 2 * F.radius * Math.max(1, aspect)
    return out
}

/** The camera where a glide from `a` to `b` is at `t` (0..1): eased at both ends (smoothstep); the target in a
 *  straight line, the distance and a parallel view's width by equal ratios -- a zoom from 20 to 0.2 halves the
 *  distance in equal steps of time rather than spending most of the glide far away. The angles are b's: the glide
 *  starts from an orbit at them (focusPose keeps them). */
export function glidePose(a, b, t) {
    const s = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
    const geo = (x, y) => x > 0 && y > 0 ? x * Math.pow(y / x, s) : y
    const out = { ...b, target: b.target.map((v, k) => (a.target?.[k] ?? v) + (v - (a.target?.[k] ?? v)) * s),
                  distance: geo(a.distance, b.distance) }
    if (b.dimensions != null) out.dimensions = geo(a.dimensions, b.dimensions)
    return out
}
