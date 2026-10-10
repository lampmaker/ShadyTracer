//======================================================================================================================
// GIZMO -- the move handles' geometry and what a drag on one does to the document. No DOM: overlay.js
// draws them and turns the mouse into rays; everything that decides a number is here, and tested in node.
//
// THE HANDLES POINT ALONG THE PARENT'S AXES, not the world's and not the node's own. A node's
// position is stored in its parent's frame (transform.js), so along those axes a drag on the x arrow
// changes position.x and nothing else -- the gizmo and the panel's three numbers are the same three
// directions. At the top level the parent is the world. (A gizmo along the node's own turned axes
// would move two or three numbers at once for one arrow, which reads as the panel disagreeing
// with the picture.)
//
// ...OR ALONG THE NODE'S OWN, when asked (`local`): the handles turn with the node, the way it is
// oriented rather than the way its numbers are. Then an arrow moves along a direction that is a mix
// of the parent's, so it changes up to three numbers -- the price of the choice, and the reason it is
// a choice. The conversion to numbers is the same either way (world move -> parent frame below); only
// the handle directions, `dirs`, differ, and an arrow's "its own number only" rule is dropped.
//
// A DRAG IS MEASURED ON A CONSTRAINT FIXED WHEN IT STARTS: the axis line or the plane through where
// the node was, with the axes as they were. The point the mouse ray meets it at, minus the point it
// met it at on mousedown, is the world move; so the spot grabbed stays under the pointer, and a
// drag that returns to where it started returns the node exactly. Re-deriving the constraint from
// the moving node each frame would feed the move back into itself.
//
// WORLD TO PARENT. The parent's axes seen from the world are orthogonal and all the same length, S,
// the product of the ancestors' scales (a uniform scale and a rotation per level). So a world move w
// is (w.Wx, w.Wy, w.Wz) / S^2 in the parent's numbers -- no matrix inverse, and exact.
//
// ROOT'S TRANSFORM NOT APPLIED, as in bounds.js: codegen never emits the root's block, so it is not
// among the ancestors, and the root itself gets no handles -- moving it would move nothing.
//======================================================================================================================

import { lineage, toParent, framesTo } from './bounds.js'
import { matrixOf } from './transform.js'

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** The handles: an arrow per axis, a square per plane (named by the two axes it moves along, its
 *  normal the third), and the centre, which moves in the plane facing the camera. */
export const AXES = ['x', 'y', 'z']
export const PLANES = { xy: [0, 1], yz: [1, 2], zx: [2, 0] }

/**
 * Where a node's move handles are, or null for one that has none (the root, an unknown id).
 * @param local  handles along the node's own turned axes instead of its parent's
 * @returns { node, origin, axes: [Wx, Wy, Wz], dirs: unit handle directions, scale: S, local }, all
 *          world space; Wk is the world image of the parent's unit k, so its length is S. `dirs` are
 *          the parent's axes, or with `local` the node's: column k of its R, in the parent's axes.
 */
export function moveFrame(doc, id, local = false) {
    const chain = lineage(doc, id)
    const node = chain[0]
    if (!node || node === doc.root || !node.transform) return null
    // above it: its parent's and theirs -- and in an array, its first copy's (bounds.js framesTo)
    const frames = framesTo(doc, id).slice(1)
    const toWorld = p => frames.reduce((q, t) => toParent(t, q), p)
    const zero = toWorld([0, 0, 0])
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => sub(toWorld(e), zero))
    const { x, y, z } = node.transform.pos
    const parent = axes.map(unit)
    let dirs = parent
    if (local) {
        const R = rotRows(node.transform.rot)
        dirs = [0, 1, 2].map(k => unit([0, 1, 2].map(q => R[0][k] * parent[0][q] + R[1][k] * parent[1][q] + R[2][k] * parent[2][q])))
    }
    return {
        node, origin: toWorld([x, y, z]), axes, dirs, local,
        scale: frames.reduce((s, t) => s * t.scale, 1),
    }
}

/** A world-space move as a change of the parent-frame position. */
export const toParentMove = (frame, w) => frame.axes.map(W => dot(w, W) / (frame.scale * frame.scale))

/** World length that covers `pixels` on screen at `point`, so the handles keep one size on screen
 *  however far away the node is. `fy` and `dh` as the overlay has them: invProjection[1][1] and
 *  the picture's height in CSS pixels. `depth` is projectPoint's. */
export const worldPerPixels = (pixels, depth, fy, dh, camtype = 0) =>
    (camtype === 1 ? 2 * fy : 2 * Math.max(depth, 1e-6) * fy) * pixels / Math.max(dh, 1)

/** The parameter along the line o + s*D (D unit) nearest the ray r.o + t*r.d, or null when they
 *  are close to parallel -- an axis pointing at the camera has no usable drag. */
export function nearestOnLine(O, D, r) {
    const w0 = sub(O, r.o)
    const b = dot(D, r.d), c = dot(r.d, r.d), e = dot(r.d, w0), dd = dot(D, w0)
    const den = c - b * b                      // |D| = 1
    if (den < 1e-6) return null
    return (b * e - c * dd) / den
}

/** Where the ray meets the plane through O with normal N, or null if it runs along it or away. */
export function onPlane(O, N, r) {
    const den = dot(r.d, N)
    if (Math.abs(den) < 1e-6) return null
    const t = dot(sub(O, r.o), N) / den
    return t < 0 ? null : add(r.o, r.d, t)
}

/**
 * The world point a ray grabs on a handle's constraint, or null.
 * @param handle  'x' | 'y' | 'z' | 'xy' | 'yz' | 'zx' | 'view'
 * @param view    the camera's viewing direction (unit), for 'view'
 */
export function grab(handle, frame, r, view) {
    const k = AXES.indexOf(handle)
    if (k >= 0) {
        const s = nearestOnLine(frame.origin, frame.dirs[k], r)
        return s == null ? null : add(frame.origin, frame.dirs[k], s)
    }
    const N = handle === 'view' ? view : cross(frame.dirs[PLANES[handle][0]], frame.dirs[PLANES[handle][1]])
    return onPlane(frame.origin, N, r)
}

/**
 * The new position for a drag from `r0` (mousedown) to `r`, both rays, on the constraint `frame`
 * had when the drag began; `start` is the position then ({x, y, z}). Null if either ray misses.
 * A parent-axis arrow changes its own number only: the others would move by rounding alone. A local
 * arrow runs across the parent's axes and moves as many numbers as it must.
 */
export function dragTo(handle, frame, start, r0, r, view) {
    const a = grab(handle, frame, r0, view), b = grab(handle, frame, r, view)
    if (!a || !b) return null
    const d = toParentMove(frame, sub(b, a))
    const k = AXES.indexOf(handle)
    if (k >= 0 && !frame.local) d.forEach((_, i) => { if (i !== k) d[i] = 0 })
    return { x: start.x + d[0], y: start.y + d[1], z: start.z + d[2] }
}

/**
 * Which handles are worth offering from here: an arrow seen end-on or a square seen edge-on cannot
 * be dragged with any control, so it is not drawn and cannot be grabbed.
 * @param view  unit direction from the camera towards the node
 */
export function usable(frame, view) {
    const out = { view: true }
    AXES.forEach((a, k) => { out[a] = Math.abs(dot(frame.dirs[k], view)) < 0.97 })
    for (const [p, [i, j]] of Object.entries(PLANES))
        out[p] = Math.abs(dot(unit(cross(frame.dirs[i], frame.dirs[j])), view)) > 0.2
    return out
}

//----------------------------------------------------------------------------------------------
// ROTATE: a ring per parent axis. Turning about the parent's axis k is R' = Rot(e_k, a) * R, and
// the result goes back into the three stored angles (x, then y, then z, all about the parent's
// axes: R = Rz * Ry * Rx, transform.js).
//
// THE z RING NEEDS NO DECOMPOSITION: Rot(e_z, a) * Rz(c) Ry(b) Rx(a0) is Rz(c + a) Ry(b) Rx(a0),
// so it adds to rot.z and is exact. The x and y rings do not commute with what is outside them and
// go through eulerOf, which picks, of the angle triples that make the same matrix, the one nearest
// the angles at mousedown -- so a drag moves the panel's numbers smoothly instead of jumping them
// by 180 or 360 where the decomposition's own range would wrap.
//
// A LOCAL RING turns about the node's own axis k: R' = R * Rot(e_k, a), the turn applied first. Here
// it is x that is exact -- Rz Ry Rx(a0) * Rx(a) is Rz Ry Rx(a0 + a) -- and y and z decompose. The
// ring's plane is fixed through the drag either way: a turn about an axis leaves that axis where it
// was, so the frame taken at mousedown still measures the angle.
//----------------------------------------------------------------------------------------------

/** Rows of the rotation a transform's `rot` makes, read off matrixOf's columns so the two can
 *  never disagree about the order. */
export function rotRows(rot) {
    const m = matrixOf({ pos: { x: 0, y: 0, z: 0 }, rot, scale: 1 })
    return [0, 1, 2].map(r => [0, 1, 2].map(c => m[c * 4 + r]))
}

const mul3 = (A, B) => A.map(row => [0, 1, 2].map(c => row[0] * B[0][c] + row[1] * B[1][c] + row[2] * B[2][c]))

/** Rotation by `rad` about the parent's axis k, right-handed. */
export function axisRows(k, rad) {
    const c = Math.cos(rad), s = Math.sin(rad)
    if (k === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]]
    if (k === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]
}

/**
 * The stored angles, in degrees, for a rotation matrix R = Rz Ry Rx, choosing among the two
 * solutions (and every multiple of 360) the one nearest `near`. At y = +-90 only x - z (or x + z)
 * is fixed; x is then kept where it was.
 */
export function eulerOf(R, near = { x: 0, y: 0, z: 0 }) {
    const D = 180 / Math.PI
    const toward = (v, n) => v + 360 * Math.round((n - v) / 360)
    const sy = Math.max(-1, Math.min(1, -R[2][0]))
    const cands = []
    if (Math.hypot(R[0][0], R[1][0]) > 1e-6) {
        const b = Math.asin(sy)
        cands.push([Math.atan2(R[2][1], R[2][2]), b, Math.atan2(R[1][0], R[0][0])])
        cands.push([Math.atan2(-R[2][1], -R[2][2]), Math.PI - b, Math.atan2(-R[1][0], -R[0][0])])
    } else {
        // gimbal lock: R's upper-left 2x2 fixes z -+ x; keep x
        const x = near.x / D
        const b = sy > 0 ? Math.PI / 2 : -Math.PI / 2
        const z = sy > 0 ? Math.atan2(-R[0][1], R[1][1]) + x : Math.atan2(-R[0][1], R[1][1]) - x
        cands.push([x, b, z])
    }
    let best = null, bestD = Infinity
    for (const [a, b, c] of cands) {
        const e = { x: toward(a * D, near.x), y: toward(b * D, near.y), z: toward(c * D, near.z) }
        const d = Math.abs(e.x - near.x) + Math.abs(e.y - near.y) + Math.abs(e.z - near.z)
        if (d < bestD) { best = e; bestD = d }
    }
    return best
}

/** The angles after turning `deg` about axis k from `start`: the parent's, or with `local` the
 *  node's own. */
export function rotateTo(k, start, deg, local = false) {
    if (local) {
        if (k === 0) return { x: start.x + deg, y: start.y, z: start.z }  // exact, see above
        return eulerOf(mul3(rotRows(start), axisRows(k, deg * Math.PI / 180)), start)
    }
    if (k === 2) return { x: start.x, y: start.y, z: start.z + deg }     // exact, see above
    return eulerOf(mul3(axisRows(k, deg * Math.PI / 180), rotRows(start)), start)
}

/** The two axes a ring's plane is spanned by, ordered so that i x j = k (right-handed about k). */
export const RING_BASIS = [[1, 2], [2, 0], [0, 1]]

/** The angle, in radians, at which a ray meets ring k's plane, measured about the ring's axis; null
 *  if it runs along the plane or away from it. */
export function ringAngle(frame, k, r) {
    const P = onPlane(frame.origin, frame.dirs[k], r)
    if (!P) return null
    const v = sub(P, frame.origin), [i, j] = RING_BASIS[k]
    return Math.atan2(dot(v, frame.dirs[j]), dot(v, frame.dirs[i]))
}

/** THE QUARTER ARCS the move handles carry, so a node can be turned without leaving Move: ring k's
 *  quarter between its two basis axes -- the x arc runs from the y arrow to the z arrow -- at
 *  `radius` (world), as n+1 world points. `gap` (radians) is left clear at each end so the arc does
 *  not touch the arrows it sits between: where they meet, the nearer one would win the grab by a
 *  pixel either way. Its points are at ringAngle gap .. pi/2 - gap, so a drag starting on it reads
 *  an angle in that range and turns exactly as the full ring does. */
export function arcPoints(frame, k, radius, n = 16, gap = 0) {
    const [i, j] = RING_BASIS[k], span = Math.PI / 2 - 2 * gap
    return Array.from({ length: n + 1 }, (_, m) => {
        const t = gap + span * m / n, c = Math.cos(t), s = Math.sin(t)
        return frame.origin.map((o, q) => o + (frame.dirs[i][q] * c + frame.dirs[j][q] * s) * radius)
    })
}

/** A ring can be dragged unless its plane is seen edge-on. */
export const ringUsable = (frame, k, view) => Math.abs(dot(frame.dirs[k], view)) > 0.1

/** The difference of two angles, in (-pi, pi]: a drag's step, whichever way round it crossed. */
export const angleStep = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; return d }

//----------------------------------------------------------------------------------------------
// SCALE: uniform only (transform.js says why), so one handle, and in screen space: the new scale is
// the old one times how much farther from the node's centre on screen the pointer now is than it
// was at mousedown. Floored as the panel floors it: zero divides the point by nothing.
//----------------------------------------------------------------------------------------------
export const scaleTo = (start, d0, d) => Math.max(0.01, start * d / Math.max(d0, 1e-6))
/** A STRETCH's factor (stretch.js): the cube on an axis held at s0 along it from the origin, now at s -- dragged
 *  twice as far out, twice the size; through the origin, as small as it goes (never negative, never zero). */
export const stretchFactor = (s0, s) => Math.max(0.01, s / Math.max(s0, 1e-9))
