//======================================================================================================================
// A UNIT CHANGE -- the scene's unit set to another (the scene row's `unit`, panel.js), in one of three ways. The user,
// 2026-10-19, after a new scene switched from cm to mm drew a box typed 10 as big as the world: "give the user a choice
// when switching the scene's units: 1 - scale all objects, 2 - adjust all the objects' dimensions" -- and keep the
// numbers, as a unit change always did:
//
//   keep        THE NUMBERS STAY. Radius 1 is 1 in the new unit, so the whole scene -- its camera, its radius and its
//               tolerance with it -- grows or shrinks by the factor, and the picture does not change. What a unit
//               change always did, and what a scene whose numbers were meant in the other unit wants. It was also the
//               trap above: a new scene's camera, 4 cm from its centre, became 4 mm, its 25 cm world 25 mm, and nothing
//               on screen said so.
//   scale       THE REAL SIZE STAYS, BY A SCALE: each top-level node's position and transform scale times the factor --
//               what a library item or a paste in another unit gets (model.js insertAsset) -- everything below it as it
//               is. EXACT FOR ANY CODE, a user's own included: a node's code runs in its own frame, which only the scales
//               above it reach.
//   dimensions  THE REAL SIZE STAYS, BY THE NUMBERS: every position, and every length the document says is one -- a
//               parameter its block marks (model.js isLength), a light's size, a box's, a blend, a copy's place -- times
//               the factor; the built-ins' parameters that are PER a length (primitives.js and modifiers.js perLength:
//               an asphere's coefficients, a twist's rate) divided by it to their power. The scales stay 1. NOT EXACT
//               for what the document cannot say is a length -- a number written in a node's own code, a parameter not
//               marked as one, an expression in a point that adds a plain number to a length, a binding that does --
//               and each of those is in the report, never guessed (the user agreed to this, 2026-10-19).
//
// BOTH REAL-SIZE WAYS convert what is in the scene's unit outside the nodes as well: the camera's lengths (model.js
// CAMERA_LENGTHS), the radius, the tolerance, the optics trace's reach, and the timeline's keys on any value converted.
// What is in REAL units already stays: a material's lengths (real mm), a haze box's mean free path (m), a light's flux and
// luminance, a ray file's rays -- placed in real metres by its own unit (optics/page.js placeRays), so in `scale` its own
// scale is divided by the factor, and its world scale, all that reaches its rays, stays what it was.
//
// THE VIEW AND THE TIMELINE ARE NO UNDO STEP (project.js OUTSIDE_HISTORY): an undo restores the document and leaves the
// camera where it is. So the step says what it was (`change`), and outsideAcross() converts the view and the timeline
// back -- or on again, for a redo -- from it (demo.js restore). Which timeline keys follow is worked out from the
// document each time (trackFactor), so a key added after the change goes back with the rest.
//
// PURE, as model.js: no DOM, no device. test/unitchange.test.mjs.
//======================================================================================================================

import { UNITS, CAMERA_LENGTHS, walk, find, blockOf, builtinOf, validate, resolveBindings, paramKind, ModelError } from './model.js'
import { resolvePath, resolveProfile, parseExpr, namesOf } from './expr.js'
import { PRIMITIVES } from './primitives.js'
import { MODIFIERS } from './modifiers.js'

/** The three ways, in the order the question offers them. */
export const UNIT_CHANGES = Object.freeze(['scale', 'dimensions', 'keep'])

/* a length converted, kept to twelve significant digits as insertAsset keeps them: 0.3 m in mm and back is 0.3 */
const round = v => +v.toPrecision(12)
const AXES = ['x', 'y', 'z']
/* which entries of a point are lengths (expr.js PATH, PROFILE): a path's x, y, z and fillet -- not its section's scale
   x, scale y or twist -- and every one of a profile's */
const PATH_LENGTHS = 4, PROFILE_LENGTHS = 3

/** What a number in the scene's unit `from` is multiplied by to say the same length in `to`: 10 from cm to mm. */
export const unitFactor = (from, to) => (UNITS[from] ?? 1) / (UNITS[to] ?? 1)

/* THE BUILT-IN A BLOCK IS: its own name, else the built-in whose code it has -- a copy given other ranges keeps the
   code and the meaning of its parameters (the user's 'dome 2'). Its entry in primitives.js or modifiers.js, or null. */
function builtinEntry(B) {
    if (!B) return null
    const table = B.kind === 'group' ? MODIFIERS : PRIMITIVES
    const name = B.builtin ?? builtinOf(B)
    if (name) return table[name.replace(/@\d+$/, '')] ?? null
    return Object.values(table).find(e => e.code === B.code) ?? null
}

/* WHAT A NODE'S PARAMETERS ARE, for a unit: { lengths: Set, perLength: { name: power } } -- its block's lengths and
   its built-in's powers; a light's size, and an export or haze box's, which are always lengths */
function unitsOf(doc, n) {
    if (n.type === 'light') return { lengths: new Set(['width', 'height', 'radius']), perLength: {} }
    if (n.type === 'export' || n.type === 'haze') return { lengths: new Set(['size']), perLength: {} }
    const B = blockOf(doc, n)
    return { lengths: new Set(B?.lengths || n.lengths || []), perLength: { ...(builtinEntry(B)?.perLength || {}) } }
}

/* A VALUE TIMES f: a number, a vector's components, a profile's points (every entry), a path's (its first four) -- the
   numbers only: an entry written as an expression is the caller's (pointsCheck) */
function times(v, f, kind = paramKind(v)) {
    if (kind === 'number') return round(v * f)
    if (kind === 'vector') return Object.fromEntries(Object.entries(v).map(([c, x]) => [c, typeof x === 'number' ? round(x * f) : x]))
    if (kind === 'profile') return v.map(pt => pt.map((c, j) => typeof c === 'number' && j < PROFILE_LENGTHS ? round(c * f) : c))
    if (kind === 'path') return { ...v, path: v.path.map(pt => pt.map((c, j) => typeof c === 'number' && j < PATH_LENGTHS ? round(c * f) : c)) }
    return v
}

/* THE POINTS' EXPRESSIONS, after their numbers and the parameters they read were converted: each entry written as an
   expression should now give what it gave times the factor where it is a length (or the same where it is not). One with
   no names in it is only a number written out ("1/3"): it becomes the number converted. One with names that does not
   follow -- `rise + 0.1`, a plain number added to a length; a name that is not a length -- is said, and left. */
function pointsCheck(n, key, before, after, isLength, k, out) {
    const kind = paramKind(before)
    const listOf = v => kind === 'path' ? v.path : v
    const resolve = (params, v) => (kind === 'path' ? resolvePath(params, v) : resolveProfile(params, v)).points
    const was = resolve(n.paramsBefore, before), now = resolve(n.params, after)
    const lengthAt = j => isLength && j < (kind === 'path' ? PATH_LENGTHS : PROFILE_LENGTHS)
    const pts = listOf(after)
    pts.forEach((pt, i) => pt.forEach((c, j) => {
        if (typeof c !== 'string') return
        const w = was[i]?.[j], v = now[i]?.[j]
        if (!Number.isFinite(w)) return                       // it did not read before: nothing to keep
        const want = lengthAt(j) ? w * k : w
        if (Math.abs(v - want) <= 1e-9 * Math.max(1, Math.abs(want))) return
        const r = parseExpr(c)
        if (r.ast && !namesOf(r.ast).length) { pt[j] = round(want); return }
        out.push({ id: n.id, label: n.label ?? n.id,
                   what: `${key}, point ${i + 1}: "${c}" gives ${+v.toPrecision(6)}, not the ${+want.toPrecision(6)} it should -- left as it is` })
    }))
}

/* EVERY NUMBER IN TWO VALUES ALIKE, to nine digits: what a binding resolved is what the conversion made, or not */
const alike = (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
    if (Array.isArray(a) || (a && typeof a === 'object')) {
        if (!b || typeof b !== 'object') return false
        const keys = new Set([...Object.keys(a), ...Object.keys(b)])
        return [...keys].every(k => alike(a[k], b[k]))
    }
    return a === b
}
/* ...every value a binding can write: a light's own settings too since 0.69.0 (a flux in lm read from a length would not
   follow a change that keeps the real size, nor should it -- said, as any other) */
const boundValues = n => structuredClone({ transform: n.transform, params: n.params, blend: n.blend, joinBlend: n.joinBlend, copies: n.copies,
                                           light: n.light })

/**
 * WHAT A TIMELINE KEY ON `prop` (a registry path, builder/params.js) IS MULTIPLIED BY, for a change made `how` with the
 * factor `k`: the camera's lengths, a blend, and what that way converts -- a top-level node's position and scale
 * (`scale`, a ray file's own scale divided), every position and every length or per-length parameter (`dimensions`).
 * 1 for everything else, and for a path the document does not have. Read off the document's structure, which a unit
 * change leaves as it was: the same answer before it and after.
 */
export function trackFactor(doc, prop, how, k) {
    if (how === 'keep' || k === 1) return 1
    let m = /^view\/camera\/([^/]+)$/.exec(prop)
    if (m) return CAMERA_LENGTHS.includes(m[1]) ? k : 1
    m = /^scene\/([^/]+)\/(.+)$/.exec(prop)
    if (!m) return 1
    const [, id, rest] = m
    const f = find(doc, id)
    if (!f || !f.parent) return 1                    // a material, a relief, the environment, the root
    const n = f.node, top = f.parent === doc.root, rayfile = n.type === 'light' && n.light?.shape === 'rayfile'
    if (rest === 'blend' || rest === 'join/blend') return k
    if (rest === 'transform/rotation') return 1
    if (rest === 'transform/position') return how === 'dimensions' || top ? k : 1
    if (rest === 'transform/scale') return how === 'scale' ? (top ? k : 1) / (rayfile ? k : 1) : 1
    if (how !== 'dimensions' || rest.includes('/')) return 1
    const U = unitsOf(doc, n)
    return U.lengths.has(rest) ? k : rest in U.perLength ? k ** -U.perLength[rest] : 1
}

/** A camera's lengths (model.js CAMERA_LENGTHS) times `f`, the rest as it is: a copy. What cameraInUnit does for a
 *  change between two units, by the factor alone -- the builder's, for one waiting to be shown (demo.js unitPending). */
export function cameraTimes(camera, f) {
    const out = structuredClone(camera)
    if (f === 1) return out
    for (const key of CAMERA_LENGTHS) if (typeof out[key] === 'number') out[key] = round(out[key] * f)
        else if (Array.isArray(out[key])) out[key] = out[key].map(v => typeof v === 'number' ? round(v * f) : v)
    return out
}

/* THE VIEW AND THE TIMELINE, converted by the factor of `from` to `to` for a change made `how`: the camera's lengths, and
   each key on a track whose value was converted */
function convertOutside(doc, from, to, how) {
    if (how === 'keep' || from === to) return
    const k = unitFactor(from, to)
    if (doc.view?.camera) doc.view.camera = cameraTimes(doc.view.camera, k)
    for (const t of doc.timeline?.tracks || []) {
        const f = trackFactor(doc, t.prop, how, k)
        if (f === 1) continue
        for (const key of t.keys || []) key.v = typeof key.v === 'number' ? round(key.v * f)
            : Array.isArray(key.v) ? key.v.map(x => typeof x === 'number' ? round(x * f) : x) : key.v
    }
}

/**
 * THE VIEW AND THE TIMELINE ACROSS AN UNDO OR A REDO OF A UNIT CHANGE (demo.js restore): the document is the one the
 * history brought back, with the view and the timeline it had a moment ago (project.js carryOutside) -- converted back
 * to the old unit for an undo, on to the new one for a redo. `change` is the step's: { from, to, how }. Returns whether
 * anything was converted.
 */
export function outsideAcross(doc, change, { undo = false } = {}) {
    if (!doc || !change || change.how === 'keep' || change.from === change.to) return false
    if (undo) convertOutside(doc, change.to, change.from, change.how)
    else convertOutside(doc, change.from, change.to, change.how)
    return true
}

/**
 * SET THE SCENE'S UNIT TO `to`, `how` one of UNIT_CHANGES. Checked whole before anything is written: a refusal (a unit
 * not in UNITS, a document the conversion would make unsound) changes nothing. Returns what was done -- `null` when the
 * unit is the one it has:
 *   { from, to, how, factor,                 factor: what a length's number was multiplied by (1 for keep)
 *     skipped: [{ id, label, what }] }       what the document could not say how to convert, left as it was
 */
export function changeUnit(doc, to, how = 'keep') {
    if (!(to in UNITS)) throw new ModelError(`unit '${to}' is not one of ${Object.keys(UNITS).join(', ')}`)
    if (!UNIT_CHANGES.includes(how)) throw new ModelError(`a unit change is ${UNIT_CHANGES.join(', ')}, not '${how}'`)
    const from = doc.unit ?? 'm'
    if (from === to) return null
    const k = unitFactor(from, to), skipped = []
    const d = structuredClone(doc)
    d.unit = to
    // a library item being edited is saved in the unit its numbers are in (library/edit.js); "no size of its own" stays
    if (d.libraryItem && d.libraryItem.unit != null) d.libraryItem.unit = to
    if (how !== 'keep') {
        // every bound value as its expression gives it now (as a build does, demo.js), so what moves below is the change
        resolveBindings(d)
        if (d.envRadius > 0) d.envRadius = round(d.envRadius * k)
        if (d.tolerance > 0) d.tolerance = round(d.tolerance * k)
        if (d.optics?.maxDist > 0) d.optics.maxDist = round(d.optics.maxDist * k)
        convertOutside(d, from, to, how)
        if (how === 'scale') scaleTop(d, k)
        else dimensions(d, k, skipped)
        /* EVERY BINDING AGAIN (model.js resolveBindings, as the next build would): one whose expression follows a length
           converted gives what the conversion made; one that does not -- a plain number added, a parameter not marked as
           a length -- writes what it says, and is said */
        const bound = []
        walk(d, n => { if (n.bind && n !== d.root) bound.push([n, boundValues(n)]) })
        resolveBindings(d)
        for (const [n, was] of bound) if (!alike(was, boundValues(n)))
            skipped.push({ id: n.id, label: n.label ?? n.id,
                           what: `bound to its groups' parameters (${Object.keys(n.bind).join(', ')}): the bindings give values that do not follow the unit -- check them` })
    }
    /* REFUSED FOR WHAT IT WOULD BREAK, not for what was wrong already: a problem the document had before (a schema edit
       half made, a file from elsewhere) is not this change's to fix, and must not stop it */
    const had = new Set(validate(doc))
    const bad = validate(d).filter(x => !had.has(x))
    if (bad.length) throw new ModelError(bad)
    into(doc, d)
    return { from, to, how, factor: how === 'keep' ? 1 : k, skipped }
}

/* THE CONVERTED COPY WRITTEN INTO THE DOCUMENT, object by object: a node, its params, its transform stay the objects
   they were, so whatever holds one -- the panel's rows, a drag, a test -- reads the new numbers, as after any model
   operation. The copy has the document's shape (a conversion adds and removes nothing but a key here and there). */
function into(target, source) {
    for (const key of Object.keys(target)) if (!(key in source)) delete target[key]
    for (const [key, v] of Object.entries(source)) {
        const t = target[key]
        if (v && typeof v === 'object' && t && typeof t === 'object' && Array.isArray(v) === Array.isArray(t)) {
            if (Array.isArray(v)) t.length = v.length
            into(t, v)
        } else target[key] = v
    }
}

/* `scale`: each top-level node's place and scale times k; a ray file anywhere keeps its world scale (the header) */
function scaleTop(d, k) {
    for (const n of d.root.children) {
        if (!n.transform) continue
        for (const a of AXES) n.transform.pos[a] = round(n.transform.pos[a] * k)
        n.transform.scale = round(n.transform.scale * k)
    }
    walk(d, n => {
        if (n === d.root) return
        if (n.type === 'light' && n.light?.shape === 'rayfile' && n.transform) n.transform.scale = round(n.transform.scale / k)
        blends(n, k)
        rayBox(n, k)
    })
}

/* in both: a blend is a world length (boxes.js: the CSG combine works on distances already in the world) */
function blends(n, k) {
    if (n.kind === 'group' && Number.isFinite(n.blend)) n.blend = round(n.blend * k)
    if (Number.isFinite(n.joinBlend)) n.joinBlend = round(n.joinBlend * k)
}
/* ...and a ray file's box is where its rays start in its own frame, in the scene's unit (panel.js: the file's metres
   over metres per unit): its rays, placed by the new unit, are k times the numbers they were */
function rayBox(n, k) {
    if (n.type === 'light' && Array.isArray(n.light?.box)) n.light.box = n.light.box.map(c => c.map(x => round(x * k)))
}

/* `dimensions`: every place and every length, the per-length parameters by their power; the scales as they are */
function dimensions(d, k, skipped) {
    walk(d, n => {
        if (n === d.root) return
        if (n.transform) for (const a of AXES) n.transform.pos[a] = round(n.transform.pos[a] * k)
        for (const c of n.copies || []) for (const a of AXES) c.pos[a] = round(c.pos[a] * k)
        blends(n, k)
        rayBox(n, k)
    })
    // a node's values: what its block says is a length, or per one -- the users first, while the blocks still say so
    walk(d, n => {
        if (n === d.root || !n.params) return
        const U = unitsOf(d, n), consts = blockOf(d, n)?.constants || n.constants || {}
        n.paramsBefore = structuredClone(n.params)
        for (const [key, v] of Object.entries(n.params)) {
            const kind = paramKind(v)
            const f = U.lengths.has(key) ? k : key in U.perLength ? k ** -U.perLength[key] : 1
            if (f === 1 || kind === 'colour' || kind === 'other') continue
            const next = times(v, f, kind)
            // a compile-time whole number (model.js setConstant) cannot hold 2.5: kept, and said
            if ((consts[key] === 'u32' || consts[key] === 'i32') && !Number.isInteger(next)) {
                skipped.push({ id: n.id, label: n.label ?? n.id, what: `${key} is a compile-time ${consts[key]}: ${v} becomes ${next}, not a whole number -- left as it is` })
                continue
            }
            n.params[key] = next
        }
        for (const [key, v] of Object.entries(n.params)) {
            const kind = paramKind(v)
            if (kind === 'path' || kind === 'profile') pointsCheck(n, key, n.paramsBefore[key], v, U.lengths.has(key), k, skipped)
        }
        delete n.paramsBefore
    })
    // the blocks' own: where a new user starts, and a slider's reach -- the scene's own blocks; a built-in is what a new
    // node in this unit gets too (+ box in a mm scene: its 0.01 to 10 is mm), so it stays as it is, read-only
    const said = new Set()
    for (const B of d.blocks || []) {
        const E = builtinEntry(B), users = []
        walk(d, n => { if (n.block === B.id) users.push(n) })
        if (!B.builtin) {
            const powers = E?.perLength || {}
            const fOf = key => (B.lengths || []).includes(key) ? k : key in powers ? k ** -powers[key] : 1
            const whole = key => B.constants?.[key] === 'u32' || B.constants?.[key] === 'i32'
            for (const [key, v] of Object.entries(B.params || {})) {
                const f = fOf(key), next = f !== 1 ? times(v, f) : v
                // a compile-time whole number's default stays one: its users' values are said above
                if (f !== 1 && !(whole(key) && !Number.isInteger(next))) B.params[key] = next
            }
            for (const [key, r] of Object.entries(B.ranges || {})) {
                const f = fOf(key)
                if (f === 1) continue
                const lo = round(r.min * f), hi = round(r.max * f)
                B.ranges[key] = { min: Math.min(lo, hi), max: Math.max(lo, hi), step: round(r.step * Math.abs(f)) }
            }
        }
        if (!users.length || E || said.has(B.id)) continue
        /* WHAT THE DOCUMENT CANNOT SAY: code of the scene's own -- a number written in it -- and the numbers its block
           does not mark as lengths, which that code may read as one. Said once a block, by its first user. A group's
           parameters alone (a block with no code) draw nothing: what reads them is a binding, checked on its own below. */
        said.add(B.id)
        if (String(B.code || '').replace(/\/\/.*$/gm, '').trim() === '') continue
        const notLengths = Object.entries(B.params || {}).filter(([key, v]) => !(B.lengths || []).includes(key)
            && ['number', 'vector', 'profile', 'path'].includes(paramKind(v))).map(([key]) => key)
        const many = users.length > 1 ? ` (block '${B.label}', ${users.length} users)` : ''
        skipped.push({ id: users[0].id, label: users[0].label ?? users[0].id, what: `its own code${many}: a number written in it is not converted`
            + (notLengths.length ? `; ${notLengths.join(', ')} ${notLengths.length === 1 ? 'is' : 'are'} not marked as a length, left as ${notLengths.length === 1 ? 'it is' : 'they are'}` : '') })
    }
}
