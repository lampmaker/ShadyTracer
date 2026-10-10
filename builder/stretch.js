//======================================================================================================================
// STRETCH -- a shape made longer or shorter along one of its own axes, by its OWN sizes (the user, 2026-10-02: move
// and scale in one control, and "for some elements, scale could be independent for x, y, z axes"; asked what a stretch
// should do, the user chose the shape's own sizes over a scale per axis).
//
// WHY ITS SIZES AND NOT A SCALE PER AXIS. A node's transform scales uniformly, deliberately (transform.js): a distance
// field stretched more along one axis than another is no longer a distance, and the march would overstep. A box made
// twice as long by its size.x stays a box whose distance is exact, and its rounding keeps its radius.
//
// WHICH SHAPES. An object whose code is a preset's (primitives.js), its comments aside: that entry's `stretch` says
// which parameters each axis multiplies. Code of the user's own, or a preset's code edited, is not known to have its
// sizes there -- it is scaled whole, by the transform. A light and an export box are not code: their shape is their
// type, and they say theirs beside their parameters (lights.js LIGHT_SHAPES, exportbox.js EXPORT_STRETCH). Of all
// those, only the axes whose every parameter is a live number now: a compile-time constant would compile at every
// step, and a value the user wrote another way is theirs.
//
// PURE: no DOM. test/stretch.test.mjs.
//======================================================================================================================

import { PRIMITIVES } from './primitives.js'
import { LIGHT_SHAPES } from './lights.js'
import { EXPORT_STRETCH } from './exportbox.js'
import { codeOnly } from './codegen.js'
import { inRange, tidy } from './pointedit.js'

/** The smallest a size that was more than nothing is stretched to: never through zero. */
export const MIN_SIZE = 1e-4

const textOf = code => codeOnly(code).replace(/\s+/g, ' ').trim()
const BY_CODE = new Map(Object.values(PRIMITIVES).filter(s => s.stretch).map(s => [textOf(s.code), s.stretch]))
const refOf = r => { const [k, c] = r.split('.'); return c ? { k, c } : { k } }
const valueOf = (node, r) => { const v = node.params?.[r.k]; return r.c ? v?.[r.c] : v }
/** A reference as a key: 'size.x', 'height'. */
export const refKey = r => r.c ? `${r.k}.${r.c}` : r.k

/**
 * The axes an object can be stretched along, and what each multiplies: { x: [{ k, c? }], ... } in its own frame, or
 * null -- not a preset's code, or none of its axes all live numbers.
 */
export function stretchOf(node) {
    if (!node || node.kind !== 'object') return null
    const map = node.type === 'light' ? LIGHT_SHAPES[node.light?.shape]?.stretch
        : node.type === 'export' ? EXPORT_STRETCH
        : typeof node.code === 'string' ? BY_CODE.get(textOf(node.code)) : null
    if (!map) return null
    const out = {}
    for (const [axis, refs] of Object.entries(map)) {
        const R = refs.map(refOf)
        if (R.every(r => Number.isFinite(valueOf(node, r)) && !node.constants?.[r.k])) out[axis] = R
    }
    return Object.keys(out).length ? out : null
}

/** What the parameters a stretch moves are when it begins: { 'size.x': 0.5, height: 1 }. */
export const startOf = (node, refs) => Object.fromEntries(refs.map(r => [refKey(r), valueOf(node, r)]))

/**
 * The parameters a stretch by factor f writes, from their values when it began (`start`, startOf's): { k: value },
 * a vector whole with its component changed. Each held within its slider's range (a number's), and a size that was
 * more than nothing kept more than nothing; one that was nothing (a tube's inner radius of 0, a solid tube) stays
 * nothing. `snap` > 0 rounds each to a multiple of it (Ctrl).
 */
export function stretched(node, refs, f, start, snap = 0) {
    const out = {}
    for (const r of refs) {
        const v0 = start[refKey(r)]
        let v = v0 * Math.max(f, 0)
        if (snap > 0) v = Math.round(v / snap) * snap
        if (v0 > 0) v = Math.max(v, MIN_SIZE)
        if (!r.c) v = inRange(node, r.k, v)
        v = tidy(v)
        if (r.c) out[r.k] = { ...(out[r.k] || node.params[r.k]), [r.c]: v }
        else out[r.k] = v
    }
    return out
}
