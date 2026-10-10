//======================================================================================================================
// POINT EDIT -- a path's or a profile's points edited in the picture (asked 2026-10-02: "a tool to draw the paths and
// sections ... interactive, in the main window ... practical, easy to use and quick to learn. Accurate"). overlay.js
// draws and drags; every number it decides is decided here, and tested in node (test/pointedit.test.mjs).
//
// WHERE THE POINTS ARE. A path's points are in its object's own frame, x y z. A profile's are 2D, and where they lie
// depends on what the object's code does with the profile: extruded, its x y are the object's x y (z = 0); revolved,
// they are radius and height -- the object's x and z, in the half-plane y = 0, which revolve turns about z; swept,
// they are the section across the path's first point, in the path's frame (core/shapes.js pathPieces: x along N, y
// along B). Read off the code; extrude when it says nothing.
//
// WHAT A DRAG CHANGES. A coordinate that is a number is set. One that is a parameter's bare name -- `rise`, or a
// vector's `corner.x` -- sets that PARAMETER (the user, 2026-10-02: "dragging a coordinate written as name should
// name the parameter. Within the min/max range"), kept within its slider's range when it has one. One that is any
// other expression, or names a compile-time parameter, is LOCKED: a drag leaves it, and the handle along it is not
// offered. What is written into the points goes through the model's own setters, so a drag that would make a path
// unsound (a point on its neighbour) is refused there and the point stays where it last was sound.
//
// A FILLET is set by a handle at the middle of its arc, dragged along the corner's bisector: the arc's middle is at
// r (1/sin h - 1) from the corner (h half the corner's angle), so r follows the handle exactly. It is held to what
// fits its two edges, beside their neighbours' fillets -- a fillet dragged too big is the largest that fits.
//
// A PATH POINT'S CROSS-SECTION (the user, 2026-10-02: "tube: scale, so change diameter per point / sweep: scale (x, y
// and both) and rotation"): entries 5 to 7 after the fillet, scale x, scale y and twist in degrees (core/shapes.js
// pathPieces) -- left off, 1, scale x's and 0. A point written with fewer keeps them off: what is written into a point
// is padded with the defaults it skips and trimmed of the ones it ends with, never of a value before one that is not.
// The handles that drag them sit on the section at the point (sectionAt): a sweep's scale x and y along its N and B,
// both together, and its twist about the path; a tube's diameter alone (its scale x), read off the code.
//======================================================================================================================

import { pathPieces, profilePieces } from '../lib/pathtracer/core/shapes.js'
import { resolvePath, resolveProfile } from './expr.js'
import { codeOnly } from './codegen.js'
import { toWorldOf, toLocalOf } from './boxes.js'
import { nearestOnLine, onPlane } from './gizmo.js'

const sub = (a, b) => a.map((v, i) => v - b[i])
const add = (a, b) => a.map((v, i) => v + b[i])
const scl = (a, s) => a.map(v => v * s)
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
const len = a => Math.hypot(...a)
const unit = a => { const l = len(a); return l > 1e-15 ? scl(a, 1 / l) : a.map(() => 0) }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const clamp = (x, a, b) => Math.min(Math.max(x, a), b)
/** A number tidied for the text box: 9 decimals is far below anything drawn, and 0.30000000000000004 is not written. */
export const tidy = x => +(+x).toFixed(9)

const isPathValue = v => !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.path)
const isProfileValue = v => Array.isArray(v) && v.length > 0 && v.every(Array.isArray)
/** A bare name: a parameter, or a vector's component. */
const NAME = /^\s*([A-Za-z][A-Za-z0-9_]*)(?:\.([xyz]))?\s*$/

//----------------------------------------------------------------------------------------------------------------------
// WHAT CAN BE EDITED, AND WHERE IT LIES
//----------------------------------------------------------------------------------------------------------------------
/** How the object's code uses a profile: { plane: 'xy' | 'rz' | 'sweep', along?: the path a sweep runs on }. */
export function usageOf(node, k) {
    const code = codeOnly(node?.code)
    const re = s => new RegExp(s.replace('K', k.replace(/[$]/g, '\\$')))
    const sw = re('\\bsweep\\s*\\(\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*,\\s*K\\b').exec(code)
    if (sw && isPathValue(node.params?.[sw[1]])) return { plane: 'sweep', along: sw[1] }
    if (re('\\brevolve\\s*\\(\\s*K\\b').test(code)) return { plane: 'rz' }
    return { plane: 'xy' }
}

/** The paths and profiles of an object that can be edited: [{ k, kind: 'path' | 'profile', plane?, along? }]. */
export function pointTargets(node) {
    if (!node || node.kind !== 'object') return []
    const out = []
    for (const [k, v] of Object.entries(node.params || {})) {
        if (isPathValue(v)) out.push({ k, kind: 'path' })
        else if (isProfileValue(v)) out.push({ k, kind: 'profile', ...usageOf(node, k) })
    }
    return out
}

/**
 * The plane a profile is drawn in, in its object's own frame: { O, U, V, W } -- O its origin, U and V where the
 * profile's x and y go, W = U x V towards whoever looks at it straight on. Null for a path, which is 3D.
 */
export function planeOf(node, target) {
    if (target.kind === 'path') return null
    if (target.plane === 'rz') return { O: [0, 0, 0], U: [1, 0, 0], V: [0, 0, 1], W: [0, -1, 0] }
    if (target.plane === 'sweep') {
        const v = node.params?.[target.along]
        const r = isPathValue(v) ? resolvePath(node.params, v) : null
        const pp = r && !r.problems.length ? pathPieces(r.points) : null
        const s = pp && !pp.problems.length ? pp.pieces[0] : null
        if (s) return { O: [...s.a], U: [...s.N], V: [...s.B], W: cross(s.N, s.B) }
    }
    return { O: [0, 0, 0], U: [1, 0, 0], V: [0, 1, 0], W: [0, 0, 1] }
}

/** The names of a point's coordinates, for the readout. */
export const coordNames = target => target.kind === 'path' ? ['x', 'y', 'z'] : target.plane === 'rz' ? ['r', 'z'] : ['x', 'y']
/** Which entry of a point is its fillet. */
export const filletIndex = target => target.kind === 'path' ? 3 : 2
/** A path point's entries after its fillet, by name. */
export const VALUE_NAMES = ['scale x', 'scale y', 'twist']
/** A path point's values as numbers: [scale x, scale y (scale x's when left off), twist in degrees]. */
export const valuesOf = pt => { const sx = pt?.[4] ?? 1; return [sx, pt?.[5] ?? sx, pt?.[6] ?? 0] }
/** What entry j of a point is when it is not written: a fillet 0, scale x 1, scale y the point's scale x, twist 0. */
const defaultAt = (target, pt, j) => j === filletIndex(target) ? 0
    : target.kind !== 'path' ? undefined : j === 4 ? 1 : j === 5 ? (pt[4] ?? 1) : j === 6 ? 0 : undefined
/** A point's entries without the defaults it ends with: the text says no more than it means, and a value before one
 *  that is not the default stays. */
const trimmed = (target, pt) => {
    const k = target.kind === 'path' ? 3 : 2
    while (pt.length > k && pt[pt.length - 1] === defaultAt(target, pt, pt.length - 1)) pt.length--
    return pt
}

/**
 * The points as they are: { list (the entries as written), points (numbers), pieces, problems }. `problems` says why
 * it draws nothing, if it does not -- an entry that does not read, or values that make no sound path or outline.
 */
export function pointsOf(node, target) {
    const v = node.params?.[target.k]
    const list = target.kind === 'path' ? v?.path : v
    const r = target.kind === 'path' ? resolvePath(node.params, v) : resolveProfile(node.params, v)
    if (r.problems.length) return { list, points: r.points, pieces: [], problems: r.problems }
    const pp = target.kind === 'path' ? pathPieces(r.points) : profilePieces(r.points)
    return { list, points: r.points, pieces: pp.pieces, problems: pp.problems }
}

/** A point (its numbers) in its object's own frame, and back. */
export const localOf = (target, plane, pt) => target.kind === 'path' ? [pt[0], pt[1], pt[2]]
    : add(plane.O, add(scl(plane.U, pt[0]), scl(plane.V, pt[1])))
export const coordsOf = (target, plane, L) => target.kind === 'path' ? [L[0], L[1], L[2]]
    : [dot(sub(L, plane.O), plane.U), dot(sub(L, plane.O), plane.V)]

/**
 * The curve as drawn, in its object's frame: a list of polylines -- the straight runs and the fillet arcs, as
 * pathPieces and profilePieces make them, so what is seen is what the shader is given.
 */
export function curveOf(target, plane, pieces, n = 16) {
    const out = []
    for (const p of pieces) {
        if (target.kind === 'path') {
            if (p.kind === 'segment') out.push([p.a, add(p.a, scl(p.T, p.L))])
            else if (p.R > 0) {
                const w = cross(p.k, p.u0), pts = []
                for (let m = 0; m <= n; m++) {
                    const t = p.phi * m / n
                    pts.push(add(p.c, scl(add(scl(p.u0, Math.cos(t)), scl(w, Math.sin(t))), p.R)))
                }
                out.push(pts)
            }
        } else if (p.kind === 'segment') out.push([localOf(target, plane, p.a), localOf(target, plane, p.b)])
        else {
            // the short way round from a to b: a fillet turns less than half a turn
            const a0 = Math.atan2(p.a[1] - p.c[1], p.a[0] - p.c[0])
            let a1 = Math.atan2(p.b[1] - p.c[1], p.b[0] - p.c[0])
            while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI
            while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI
            const pts = []
            for (let m = 0; m <= n; m++) {
                const t = a0 + (a1 - a0) * m / n
                pts.push(localOf(target, plane, [p.c[0] + p.r * Math.cos(t), p.c[1] + p.r * Math.sin(t)]))
            }
            out.push(pts)
        }
    }
    return out
}

//----------------------------------------------------------------------------------------------------------------------
// THE OBJECT'S FRAME IN THE WORLD
//----------------------------------------------------------------------------------------------------------------------
/**
 * { toWorld, toLocal, S, axis(D) }: the object's frame as boxes.js has it (every ancestor's transform and its own,
 * the root's never), its scale in the world (uniform at every level), and a direction of its frame as a world unit.
 */
export function frameOf(doc, id) {
    const toWorld = toWorldOf(doc, id), toLocal = toLocalOf(doc, id)
    const o = toWorld([0, 0, 0])
    const S = len(sub(toWorld([1, 0, 0]), o)) || 1
    return { toWorld, toLocal, S, axis: D => unit(sub(toWorld(D), o)) }
}

/**
 * The handles a point has: its coordinate axes as world units, `j` the coordinate each moves, and the drag plane's
 * normal for dragging the point itself. A path's point moves along the object's x y z and, held by its dot, in the
 * plane facing the camera; a profile's along U and V and in its own plane only.
 */
export function handlesOf(F, target, plane) {
    if (target.kind === 'path') return { axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((D, j) => ({ j, D: F.axis(D) })), N: null }
    return { axes: [{ j: 0, D: F.axis(plane.U) }, { j: 1, D: F.axis(plane.V) }], N: F.axis(plane.W) }
}

//----------------------------------------------------------------------------------------------------------------------
// A DRAG
//----------------------------------------------------------------------------------------------------------------------
/**
 * A point's new numbers for a drag from ray r0 to ray r. `P` is the point in the world when the drag began, `start`
 * its numbers then, `how` the handle: { axis: D (world unit), j } along one coordinate, or { N, js? } in the plane with
 * that normal through P -- `js` the coordinates that plane moves (the gizmo's square: two of a path's three), when not
 * all. Along an axis the other numbers stay exactly as they were, and in a square's plane the third does: the way
 * back from the world rounds, and a coordinate that should not move would move by that much.
 */
export function dragPoint(F, target, plane, P, start, how, r0, r) {
    let Pw
    if (how.axis) {
        const s0 = nearestOnLine(P, how.axis, r0), s1 = nearestOnLine(P, how.axis, r)
        if (s0 == null || s1 == null) return null
        Pw = add(P, scl(how.axis, s1 - s0))
    } else {
        const a = onPlane(P, how.N, r0), b = onPlane(P, how.N, r)
        if (!a || !b) return null
        Pw = add(P, sub(b, a))
    }
    const c = coordsOf(target, plane, F.toLocal(Pw))
    return how.axis ? start.map((v, i) => i === how.j ? c[i] : v) : how.js ? start.map((v, i) => how.js.includes(i) ? c[i] : v) : c
}

/** Snap the numbers a drag changed to the grid (Ctrl): the others stay as they were. */
export const snapCoords = (coords, start, step) => coords.map((v, i) => v !== start[i] ? Math.round(v / step) * step : v)

/**
 * What each entry of a point does under a drag: 'number' (set), { name, comp? } (sets that parameter), or 'locked'.
 * A name of a compile-time parameter is locked: moving it would compile at every step.
 */
export function entryKind(node, e) {
    if (typeof e === 'number' || e === undefined) return 'number'
    const m = typeof e === 'string' ? NAME.exec(e) : null
    if (!m) return 'locked'
    const [, name, comp] = m, v = node.params?.[name]
    if (node.constants?.[name]) return 'locked'
    if (comp === undefined && typeof v === 'number') return { name }
    if (comp !== undefined && v && typeof v === 'object' && typeof v[comp] === 'number') return { name, comp }
    return 'locked'
}

/** A parameter's value kept within its slider's range, when it has one. */
export const inRange = (node, name, x) => {
    const r = node.ranges?.[name]
    return r && Number.isFinite(r.min) && Number.isFinite(r.max) ? clamp(x, r.min, r.max) : x
}

/**
 * Point i of a list, its entries j (and the fillet, if `fillet` is given) set to `values`: { list, params } -- the
 * new list (numbers written in place, tidied), and the parameters named by bare names, set within their ranges.
 * A locked entry is left. A name met twice in one point is set once, by its first coordinate.
 */
export function writePoint(node, target, list, i, values) {
    const out = list.map(pt => [...pt]), params = {}, pt = out[i]
    for (const [jj, x] of Object.entries(values)) {
        const j = +jj
        if (!Number.isFinite(x)) continue
        const kind = entryKind(node, pt[j])
        if (kind === 'number') {
            // the entries it skips written as they read when left off (a fillet 0, scale x 1, scale y scale x's)
            while (pt.length < j) pt.push(defaultAt(target, pt, pt.length))
            pt[j] = tidy(x)
        } else if (kind !== 'locked' && !(kind.name in params)) {
            if (kind.comp) params[kind.name] = { ...node.params[kind.name], [kind.comp]: tidy(x) }
            else params[kind.name] = tidy(inRange(node, kind.name, x))
        }
    }
    // the defaults it ends with go -- a fillet set to 0 among them -- so the text says no more than it means; a value
    // after them keeps them (until 2026-10-02 a fillet of 0 cut the point there, which would drop a scale after it)
    trimmed(target, pt)
    return { list: out, params }
}

//----------------------------------------------------------------------------------------------------------------------
// ADDING AND TAKING AWAY
//----------------------------------------------------------------------------------------------------------------------
/**
 * Whether candidate values leave EVERY path and profile of the node sound: `params` the parameters a drag would set,
 * and list `list` for target `k`. { ok, problems } -- the first problem of each that is not, by name. A name such as
 * `rise` can move two paths, and a drag that breaks the one not being edited is refused as one that breaks its own.
 */
export function soundWith(node, params, k, list) {
    const own = node.params?.[k]
    const shadow = { ...node, params: { ...node.params, ...params } }
    if (list) shadow.params[k] = isPathValue(own) ? { ...own, path: list } : list
    const problems = []
    for (const t of pointTargets(shadow)) {
        const r = pointsOf(shadow, t)
        if (r.problems.length) problems.push(`${t.kind} '${t.k}': ${r.problems[0]}`)
    }
    return { ok: !problems.length, problems }
}

/** The grid's lines at least this far apart on screen: the step Ctrl snaps to, in the Points mode and in Transform
 *  (overlay.js) alike -- one grid, whichever mode is on. */
export const GRID_PX = 24

/**
 * The grid's step: 1, 2 or 5 times a power of ten, the smallest that leaves at least `px` pixels between lines at
 * `worldPerPx` (the world length of one pixel where the points are). What Ctrl snaps to, so a snap is to something
 * seen, at any zoom and in any unit -- a fixed 0.1 is a third of a 30 cm part and nothing of a 2 mm one.
 */
export function gridStep(worldPerPx, px = 20) {
    const want = Math.abs(worldPerPx) * px
    if (!(want > 0) || !Number.isFinite(want)) return 0.1
    const e = Math.pow(10, Math.floor(Math.log10(want)))
    for (const m of [1, 2, 5, 10]) if (m * e >= want * (1 - 1e-12)) return tidy(m * e)
    return tidy(10 * e)
}

/** What is typed into a coordinate's box: a number when it reads as one, otherwise the text, an expression the model
 *  then judges (expr.js). An empty box is null: nothing typed. */
export const parseEntry = text => {
    const t = String(text ?? '').trim()
    if (!t) return null
    return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? +t : t
}

/** The fewest points each can have. */
export const minPoints = target => target.kind === 'path' ? 2 : 3

/**
 * A point put after point i: halfway to the next (the first, after a profile's last), or past a path's end by its
 * last edge. Numbers, no fillet; a path's the mean of its two neighbours' section values (the last one's, past the
 * end), so the section changes on as it did; the list as written otherwise.
 */
export function insertPoint(target, list, points, i) {
    const n = points.length, k = target.kind === 'path' ? 3 : 2
    const a = points[i].slice(0, k)
    let p
    if (target.kind === 'path' && i === n - 1) p = add(a, sub(a, points[i - 1].slice(0, k)))
    else p = scl(add(a, points[(i + 1) % n].slice(0, k)), 0.5)
    let pt = p.map(tidy)
    if (target.kind === 'path') {
        const va = valuesOf(points[i]), vb = i === n - 1 ? va : valuesOf(points[i + 1])
        pt = trimmed(target, [...pt, 0, ...va.map((x, j) => tidy((x + vb[j]) / 2))])
    }
    const out = list.map(q => [...q])
    out.splice(i + 1, 0, pt)
    return out
}

/** Point i taken away, or null below the fewest. A path's new end gives up its fillet -- an end has no corner -- and
 *  keeps its section's values. */
export function removePoint(target, list, i) {
    if (list.length <= minPoints(target)) return null
    const out = list.map(pt => [...pt])
    out.splice(i, 1)
    if (target.kind === 'path') for (const e of [0, out.length - 1]) if (out[e].length > 3) { out[e][3] = 0; trimmed(target, out[e]) }
    return out
}

//----------------------------------------------------------------------------------------------------------------------
// A PATH POINT'S SECTION: WHERE IT IS, AND WHAT A DRAG OF ITS HANDLES WRITES
//----------------------------------------------------------------------------------------------------------------------
/**
 * The cross-section at path point i, in its object's frame: { O, N, B, T } -- O where the section is drawn and its
 * handles sit, N and B where its x and y go (core/shapes.js pathPieces' frame), T along the path. An end's is its
 * segment's there; a corner's with a bend, the bend's at the middle of its arc (the corner itself for a fan), the values
 * holding round it; a straight corner's, the segment it starts. Null when the pieces are not the path's (unsound).
 */
export function sectionAt(pieces, n, i) {
    const segs = pieces.filter(p => p.kind === 'segment')
    if (n < 2 || segs.length !== n - 1 || i < 0 || i >= n) return null
    const of = (O, s) => ({ O, N: s.N, B: s.B, T: s.T })
    if (i === 0) return of(segs[0].a, segs[0])
    if (i === n - 1) { const s = segs[n - 2]; return of(add(s.a, scl(s.T, s.L)), s) }
    const b = pieces[pieces.indexOf(segs[i - 1]) + 1]
    if (b?.kind !== 'bend') return of(segs[i].a, segs[i])
    const h = b.phi / 2, rad = add(scl(b.u0, Math.cos(h)), scl(cross(b.k, b.u0), Math.sin(h)))
    return { O: add(b.c, scl(rad, b.R)), N: add(scl(rad, b.f[0]), scl(b.k, b.f[1])), B: add(scl(rad, b.f[2]), scl(b.k, b.f[3])),
             T: cross(b.k, rad) }
}

/**
 * The section at path point i as drawn, in its object's frame: polylines -- the outline its code sweeps, scaled and
 * turned by the point's values (M = R(twist) diag(sx, sy) in N and B, as core/shapes.js takes it): a sweep's profile
 * as profilePieces makes it, a tube's circle of its radius times scale x. Null when the code does not say what (a
 * radius written as an expression) or what it says is not sound.
 */
export function sectionOutline(node, k, pieces, points, i) {
    const sec = sectionAt(pieces, points.length, i)
    if (!sec) return null
    const code = codeOnly(node?.code), q = k.replace(/[$]/g, '\\$')
    const [sx, sy, tw] = valuesOf(points[i]), c = Math.cos(tw * Math.PI / 180), s = Math.sin(tw * Math.PI / 180)
    const sw = new RegExp(`\\bsweep\\s*\\(\\s*${q}\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*)`).exec(code)
    if (sw && isProfileValue(node.params?.[sw[1]])) {
        const r = resolveProfile(node.params, node.params[sw[1]])
        const pp = r.problems.length ? null : profilePieces(r.points)
        // the profile's x and y where M puts them: linear, so its arcs are drawn as exactly what is swept
        const plane = { O: sec.O, U: scl(add(scl(sec.N, c), scl(sec.B, s)), sx), V: scl(add(scl(sec.N, -s), scl(sec.B, c)), sy) }
        return pp && !pp.problems.length ? curveOf({ kind: 'profile' }, plane, pp.pieces) : null
    }
    const tb = new RegExp(`\\btube\\s*\\(\\s*${q}\\s*,[^,]*,\\s*([^,()]+?)\\s*,`).exec(code)
    const rv = !tb ? null : /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tb[1]) ? +tb[1] : typeof node.params?.[tb[1]] === 'number' ? node.params[tb[1]] : null
    if (!(rv > 0)) return null
    // a tube reads scale x alone: a circle of radius r times it
    return [Array.from({ length: 49 }, (_, m) => add(sec.O, scl(add(scl(sec.N, Math.cos(m * Math.PI / 24)), scl(sec.B, Math.sin(m * Math.PI / 24))), rv * sx)))]
}

/** A point from what was typed, entry by entry -- null where nothing was: those read as their defaults (a fillet 0,
 *  scale x 1, scale y scale x's, twist 0), and the ones it would end with are not written. */
export function pointFrom(target, entries) {
    const pt = []
    for (let j = 0; j < entries.length; j++) pt.push(entries[j] ?? defaultAt(target, pt, j))
    return trimmed(target, pt)
}

/** Which section handles a path's points get, read off its object's code: a tube's diameter alone (it reads scale x);
 *  a sweep's scale x, scale y, both and twist -- and those for a path a sweep reads too, or that nothing reads yet. */
export function sectionHandles(node, k) {
    const code = codeOnly(node?.code), q = k.replace(/[$]/g, '\\$')
    const tube = new RegExp(`\\btube\\s*\\(\\s*${q}\\b`).test(code), sweep = new RegExp(`\\bsweep\\s*\\(\\s*${q}\\b`).test(code)
    return tube && !sweep ? ['diameter'] : ['sx', 'sy', 'both', 'twist']
}

/**
 * What a drag of a section handle writes into the point, for writePoint: `how` 'sx' or 'sy' (a cube), 'both' (a
 * sweep's circle) or 'diameter' (a tube's), each the values at the press `v0` (valuesOf) times x; 'twist' by x
 * degrees. `entries` the point as written: a scale x dragged alone writes scale y as it was, since left off it would
 * follow; the circle leaves a scale y that follows to follow. Ctrl (`snap`) puts a scale on 0.1, never below it, and a
 * twist on 15 degrees -- as Transform snaps a scale and a turn.
 */
export function valueDrag(entries, v0, how, x, snap = false) {
    const sc = s => snap ? Math.max(0.1, Math.round(s / 0.1) * 0.1) : s
    const follows = (entries?.length ?? 0) <= 5
    if (how === 'twist') { const d = v0[2] + x; return { 6: snap ? Math.round(d / 15) * 15 : d } }
    if (how === 'sy') return { 5: sc(v0[1] * x) }
    if (how === 'sx') return { 4: sc(v0[0] * x), ...(follows ? { 5: v0[1] } : {}) }
    if (how === 'both') return { 4: sc(v0[0] * x), ...(follows ? {} : { 5: sc(v0[1] * x) }) }
    return { 4: sc(v0[0] * x) }
}

//----------------------------------------------------------------------------------------------------------------------
// A FILLET'S HANDLE
//----------------------------------------------------------------------------------------------------------------------
/**
 * Corner i, in its object's frame: { V (the corner), b (unit, into the corner along its bisector), kf, r, rMax }, or
 * null where there is no corner -- a path's ends, a straight run, a fold back. The arc's middle is at V + b r kf
 * (kf = 1/sin h - 1); rMax is the largest fillet whose tangent points fit its two edges beside its neighbours'.
 */
export function cornerOf(target, plane, points, i) {
    const n = points.length
    const path = target.kind === 'path'
    if (path && (i === 0 || i === n - 1)) return null
    const at = j => localOf(target, plane, points[((j % n) + n) % n])
    const f = filletIndex(target)
    const rOf = j => {
        const jj = ((j % n) + n) % n
        if (path && (jj === 0 || jj === n - 1)) return 0
        return Math.max(points[jj][f] ?? 0, 0)
    }
    const Q = at(i), A = at(i - 1), B = at(i + 1)
    const u = unit(sub(A, Q)), w = unit(sub(B, Q))
    const ang = Math.acos(clamp(dot(u, w), -1, 1))
    if (!(ang > 1e-6 && ang < Math.PI - 1e-6)) return null
    const h = ang / 2, tanh = Math.tan(h)
    // the length a neighbour's fillet takes from an edge: its own corner's half angle
    const tOf = j => {
        const r = rOf(j)
        if (!(r > 0)) return 0
        const Qj = at(j), u2 = unit(sub(at(j - 1), Qj)), w2 = unit(sub(at(j + 1), Qj))
        const a2 = Math.acos(clamp(dot(u2, w2), -1, 1))
        return a2 > 1e-6 && a2 < Math.PI - 1e-6 ? r / Math.tan(a2 / 2) : 0
    }
    const avail = Math.min(len(sub(A, Q)) - tOf(i - 1), len(sub(B, Q)) - tOf(i + 1))
    return { V: Q, b: unit(add(u, w)), kf: 1 / Math.sin(h) - 1, r: rOf(i), rMax: Math.max(0, avail * tanh) }
}

/** The fillet a handle dragged along its corner's bisector gives: from r0 by (s - s0)/kf, s measured along b in the
 *  object's frame, held between 0 and what fits. */
export const filletDrag = (corner, r0, s0, s) => clamp(r0 + (s - s0) / corner.kf, 0, corner.rMax)

//----------------------------------------------------------------------------------------------------------------------
// WHAT IS SAID BESIDE A POINT
//----------------------------------------------------------------------------------------------------------------------
/**
 * Point i's numbers, and from the point before it (a profile's first from its last; a path's first has none): the
 * difference, its length and, for a profile, its direction in degrees in the plane. And its fillet.
 */
export function readout(target, points, i) {
    const k = target.kind === 'path' ? 3 : 2, n = points.length
    const p = points[i].slice(0, k)
    const prev = target.kind === 'path' ? (i > 0 ? points[i - 1] : null) : points[(i - 1 + n) % n]
    const d = prev ? sub(p, prev.slice(0, k)) : null
    return {
        names: coordNames(target), coords: p, delta: d, length: d ? len(d) : null,
        angle: d && k === 2 ? Math.atan2(d[1], d[0]) * 180 / Math.PI : null,
        fillet: points[i][filletIndex(target)] ?? 0,
        ...(target.kind === 'path' ? { values: valuesOf(points[i]) } : {}),
    }
}
/** A number for the readout: four decimals, no minus zero. */
export const fmt = x => { const s = (Math.abs(x) < 5e-5 ? 0 : x).toFixed(4); return s === '-0.0000' ? '0.0000' : s }

//----------------------------------------------------------------------------------------------------------------------
// LOOKING STRAIGHT AT A PROFILE'S PLANE
//----------------------------------------------------------------------------------------------------------------------
/**
 * The orbit camera (lib/camera.js, z up) put square to a plane: { target, distance, azimuth, elevation, camtype: 1,
 * dimensions }. `W` the plane's normal towards the viewer and `U` its x, both world units; `centre` the middle of what
 * is drawn and `half` its half sizes along U and V; `clear` how far the object reaches from the centre; `aspect` the
 * picture's width over its height. Straight down or up (the camera's pole, where its basis has no "right") the
 * elevation is kept a hair off it and the azimuth chosen so the plane's x reads to the right.
 *   `dimensions` IS THE ORTHOGRAPHIC WIDTH: cam.set makes it orthoDims[0] and the height that over the aspect
 * (lib/camera.js, its own comment calls it the height), so what is drawn fits with a margin both ways.
 */
export function planeView(W, U, centre, half, clear = 0, aspect = 1) {
    let elevation = Math.acos(clamp(W[2], -1, 1)) * 180 / Math.PI
    let azimuth = Math.atan2(W[1], W[0]) * 180 / Math.PI
    if (elevation < 0.05 || elevation > 179.95) {
        elevation = elevation < 90 ? 0.05 : 179.95
        azimuth = Math.atan2(-U[0], U[1]) * 180 / Math.PI
    }
    const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1
    const hu = Math.max(half[0], 1e-3), hv = Math.max(half[1], 1e-3), e = Math.max(hu, hv)
    // orthographic: the distance changes nothing seen, only where rays start -- outside the object (`clear`, its
    // reach from the centre), or a long sweep would be looked at from inside itself
    return { target: [...centre], distance: Math.max(e * 4, clear * 1.1 + e), azimuth, elevation, camtype: 1,
             dimensions: 2.6 * Math.max(hu, hv * a) }
}
