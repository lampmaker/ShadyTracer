//======================================================================================================================
// GIZMODRAW -- the Transform gizmo drawn over the picture, and which of its handles a point of the screen is on. ONE
// set of controls for a node and for a point: the overlay draws it at the selected node (overlay.js, Transform), the
// Points mode at the selected point (pointsmode.js) -- the user, 2026-10-02: "for the point editor, use the same
// controls as for the transform, so include the plane control elements. I will also ask you later for more features
// in the point editor that will involve rotation and scaling so if you can re-use the transform controls and hide
// some elements for now, that would probably be best". So every part is a switch: the Points mode shows the arrows,
// the plane squares and the centre ring at a point, and -- since a path point's section turns and scales (2026-10-02)
// -- a second gizmo on that section, its cubes, its circle and one arc about the path, the rest hidden.
//
// WHAT IS DRAWN, at a frame { origin, dirs: three world unit vectors }, a constant size on screen:
//   an ARROW per axis (moves along it), a SQUARE per pair of axes (moves in their plane), a CENTRE ring (moves in the
//   plane facing the camera, or whatever the caller says its centre does), a QUARTER ARC between each pair of arrows,
//   coloured by the axis it turns about (rotates; while held its whole ring is drawn, so the pointer has something
//   to follow round), a CUBE per stretchable axis part way along it (stretch.js), and a dashed CIRCLE outside the
//   arrows' heads (uniform scale). Only what can be dragged from where the camera is (gizmo.js usable, ringUsable):
//   an arrow seen end-on or a square seen edge-on is left out, the centre and the circle never are.
//
// WHICH IS UNDER THE POINTER, in one order for every caller (hitGizmo): the centre; a cube, which sits on its arrow's
// shaft and wins there, and any small target of the caller's that may (the Points mode's fillet diamond); the arrows
// and arcs, nearest first; the circle; whatever the caller puts in between (the Points mode's dots, which a large
// square must not swallow); the squares.
//
// No DOM beyond the 2D context it is handed; the numbers a drag decides are gizmo.js's, tested in node, and the
// drawing is the headless checks' (transform.check, points.check).
//======================================================================================================================

import { projectPoint } from '../lib/pathtracer/core/genrays.js'
import { worldPerPixels, usable, ringUsable, arcPoints, RING_BASIS, AXES, PLANES } from './gizmo.js'

// LARGER SINCE 2026-10-02 (the user: "a bit larger so it's easier to pick"): arrows 90, grab 7, centre 8 before
export const ARROW_PX = 110         // handle length on screen
export const GRAB_PX = 11           // how near an arrow, an arc or the circle counts as on it
export const CENTRE_PX = 11         // the centre ring's radius
const HEAD_PX = 14                  // an arrow's head: its length on screen, past the tip...
const HEAD_W = 7                    // ...and its half width
const ARC_AT = 0.75                 // the quarter arcs: radius as a share of the arrows, clear of the squares (to 0.45)
const ARC_GAP = 0.12                // ...and radians left clear at each end, so an arc never touches an arrow
export const CUBE_AT = 0.58         // a stretch cube: along its axis as a share of the arrows -- past the squares, inside the arcs
export const CUBE_PX = 6            // ...its half size on screen
export const SCALE_PX = 145         // the uniform-scale circle's radius: outside the arrows' heads (110 + 14 + a grab)
export const RINGS = ['rx', 'ry', 'rz']
export const CUBES = ['sx', 'sy', 'sz']             // a stretch along the node's own x, y, z
export const COLOR = { x: '#ff5555', y: '#55dd55', z: '#5599ff', view: '#e6e6e6', hot: '#ffffff', circle: '#ffcc33' }

/**
 * Draw the gizmo at F = { origin, dirs } and return what was drawn, in stage pixels, for hitGizmo:
 * [{ name, k?, plane?, seg | segs | quad | centre | cube | circle }]. Nothing behind the camera.
 * @param arrows   which axes get an arrow (indices into dirs)
 * @param squares  which planes get a square ('xy' 'yz' 'zx': the pairs of dirs)
 * @param arcs     true (a quarter arc about each of the three dirs, named rx ry rz), false, or the ones to draw,
 *                 [{ name, k }] -- a quarter arc about dirs[k] in its colour (the Points mode's twist, about a path)
 * @param centre, circle  whether to draw those
 * @param cubes    [{ name, k, dir, f = 1, stem }]: a cube along world unit `dir`, coloured as axis k, `f` times out
 *                 (one being dragged), on a stem from the centre when `stem` or when dragged
 * @param colors   the three axes' colours (a square takes its normal's)
 * @param hot      name => whether to draw that handle lit
 * @param held     the name of the handle being dragged: an arc's whole ring is drawn while held
 */
export function paintGizmo(g, V, F, { arrows = [0, 1, 2], squares = Object.keys(PLANES), arcs = true, centre = true,
                                     circle = true, cubes = [], colors = [COLOR.x, COLOR.y, COLOR.z],
                                     hot = () => false, held = null } = {}) {
    const handles = []
    const depth = projectPoint(F.origin, V.U, V.camtype).depth
    if (!(depth > V.near)) return handles
    const L = worldPerPixels(ARROW_PX, depth, V.U.invProjection[5], V.dh, V.camtype)
    const view = V.towards(F.origin)
    const ok = usable(F, view)
    const O = V.screen(F.origin)
    const at = (dir, s) => V.screen(dir.map((v, i) => F.origin[i] + v * L * s))

    // the squares first, so an arrow over one wins the eye as it wins the hit test
    for (const name of squares) {
        if (!ok[name]) continue
        const [i, j] = PLANES[name]
        const P = (a, b) => V.screen(F.origin.map((o, n) => o + (F.dirs[i][n] * a + F.dirs[j][n] * b) * L))
        const quad = [P(0.25, 0.25), P(0.45, 0.25), P(0.45, 0.45), P(0.25, 0.45)]
        g.beginPath()
        quad.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)))
        g.closePath()
        g.globalAlpha = hot(name) ? 0.7 : 0.35
        g.fillStyle = hot(name) ? COLOR.hot : colors[3 - i - j]
        g.fill()
        g.globalAlpha = 1
        handles.push({ name, plane: [i, j], quad })
    }
    // THE QUARTER ARCS: a turn about axis k, between the other two arrows; while held, the whole ring
    const rings = arcs === true ? RINGS.map((name, k) => ({ name, k })) : Array.isArray(arcs) ? arcs : []
    for (const { name, k } of rings) {
        if (!ringUsable(F, k, view)) continue
        if (held === name) { polyline(g, V, ringPoints(F, k, L * ARC_AT), COLOR.hot, 3); continue }
        const segs = polyline(g, V, arcPoints(F, k, L * ARC_AT, 16, ARC_GAP), hot(name) ? COLOR.hot : colors[k], hot(name) ? 4 : 3)
        handles.push({ name, k, segs })
    }
    for (const k of arrows) {
        const name = AXES[k]
        if (!ok[name]) continue
        const tip = at(F.dirs[k], 1)
        g.beginPath()
        g.strokeStyle = g.fillStyle = hot(name) ? COLOR.hot : colors[k]
        g.lineWidth = hot(name) ? 3.5 : 2.5
        g.moveTo(O[0], O[1]); g.lineTo(tip[0], tip[1])
        g.stroke()
        // the head, in screen space so it is the same size at any distance
        const dx = tip[0] - O[0], dy = tip[1] - O[1], l = Math.hypot(dx, dy) || 1
        const ux = dx / l, uy = dy / l
        g.beginPath()
        g.moveTo(tip[0] + ux * HEAD_PX, tip[1] + uy * HEAD_PX)
        g.lineTo(tip[0] - uy * HEAD_W, tip[1] + ux * HEAD_W)
        g.lineTo(tip[0] + uy * HEAD_W, tip[1] - ux * HEAD_W)
        g.closePath()
        g.fill()
        handles.push({ name, k, seg: [O, [tip[0] + ux * HEAD_PX, tip[1] + uy * HEAD_PX]] })
    }
    // THE STRETCH CUBES: where a drag has taken one, on a stem from the centre, so it stays under the pointer
    for (const { name, k, dir, f = 1, stem = false } of cubes) {
        const P = at(dir, CUBE_AT * f)
        if (stem || f !== 1) {
            g.beginPath()
            g.strokeStyle = colors[k]
            g.globalAlpha = 0.6
            g.lineWidth = 1.5
            g.moveTo(O[0], O[1]); g.lineTo(P[0], P[1])
            g.stroke()
            g.globalAlpha = 1
        }
        const h = hot(name) ? CUBE_PX + 1 : CUBE_PX
        g.fillStyle = hot(name) ? COLOR.hot : colors[k]
        g.fillRect(P[0] - h, P[1] - h, 2 * h, 2 * h)
        g.strokeStyle = 'rgba(0,0,0,0.6)'
        g.lineWidth = 1
        g.strokeRect(P[0] - h, P[1] - h, 2 * h, 2 * h)
        handles.push({ name, k, cube: P })
    }
    if (centre) {
        g.beginPath()
        g.strokeStyle = hot('view') ? COLOR.hot : COLOR.view
        g.lineWidth = hot('view') ? 3 : 2
        g.arc(O[0], O[1], CENTRE_PX, 0, Math.PI * 2)
        g.stroke()
        handles.push({ name: 'view', centre: O })
    }
    // THE CIRCLE, flat on the screen: uniform scale has one number, so one handle
    if (circle) {
        g.beginPath()
        g.setLineDash([5, 5])
        g.strokeStyle = hot('scale') ? COLOR.hot : COLOR.circle
        g.lineWidth = hot('scale') ? 3 : 2
        g.arc(O[0], O[1], SCALE_PX, 0, Math.PI * 2)
        g.stroke()
        g.setLineDash([])
        handles.push({ name: 'scale', circle: O })
    }
    return handles
}

/**
 * The handle under (x, y) among `handles` (paintGizmo's, and any others a caller added beside them), or null: the
 * centre, then a cube, then whatever `small(x, y)` finds, then the nearest arrow or arc, then the circle, then whatever
 * `between(x, y)` finds, then a square.
 */
export function hitGizmo(handles, x, y, { small = null, between = null } = {}) {
    const c = handles.find(h => h.centre && Math.hypot(x - h.centre[0], y - h.centre[1]) <= CENTRE_PX + 3)
    if (c) return c
    let best = null, bestD = CUBE_PX + 4
    for (const h of handles) if (h.cube) {
        const d = Math.max(Math.abs(x - h.cube[0]), Math.abs(y - h.cube[1]))
        if (d <= bestD) { best = h; bestD = d }
    }
    if (best) return best
    const sm = small?.(x, y)
    if (sm) return sm
    bestD = GRAB_PX
    for (const h of handles) for (const [a, b] of h.segs || (h.seg ? [h.seg] : [])) {
        const d = toSegment(x, y, a, b)
        if (d <= bestD) { best = h; bestD = d }
    }
    if (best) return best
    const sc = handles.find(h => h.circle && Math.abs(Math.hypot(x - h.circle[0], y - h.circle[1]) - SCALE_PX) <= GRAB_PX)
    if (sc) return sc
    const mid = between?.(x, y)
    if (mid) return mid
    return handles.find(h => h.quad && inQuad(x, y, h.quad)) ?? null
}

/** Ring k's full circle at world radius R, as world points. */
function ringPoints(F, k, R) {
    const [i, j] = RING_BASIS[k], P = []
    for (let n = 0; n <= 64; n++) {
        const t = n / 64 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t)
        P.push(F.origin.map((o, m) => o + (F.dirs[i][m] * c + F.dirs[j][m] * s) * R))
    }
    return P
}

/** Stroke world points as a polyline, leaving out what is behind the camera; the screen segments drawn, for the hit
 *  test. */
function polyline(g, V, P, color, width) {
    const segs = []
    let prev = null
    for (const p of P) {
        const q = projectPoint(p, V.U, V.camtype).depth > V.near ? V.screen(p) : null
        if (prev && q) segs.push([prev, q])
        prev = q
    }
    g.beginPath()
    g.strokeStyle = color
    g.lineWidth = width
    for (const [a, b] of segs) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]) }
    g.stroke()
    return segs
}

/** Distance from (x, y) to the segment A-B, in the same pixels. */
export function toSegment(x, y, A, B) {
    const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((x - A[0]) * dx + (y - A[1]) * dy) / l2)) : 0
    return Math.hypot(x - A[0] - t * dx, y - A[1] - t * dy)
}

/** Inside a convex quad, whichever way round it was projected. */
export function inQuad(x, y, q) {
    let sign = 0
    for (let i = 0; i < 4; i++) {
        const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4]
        const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
        if (c === 0) continue
        if (sign === 0) sign = Math.sign(c)
        else if (Math.sign(c) !== sign) return false
    }
    return true
}
