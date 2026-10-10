//======================================================================================================================
// ONE PLAIN SHAPE -- an object whose code is a single call of a closed-form shape at p, and nothing else: a node no
// dearer to evaluate than its bounding box's test. Codegen gives such a node no box (codegen.js, ONLY THE DEAR ONES),
// since a box test there costs about what the shape does (Tests > boxcost, the user's Pascal, 0.33.5 to 0.33.9).
//
// WHY THIS FILE. Until 0.41.0 the list and the parse were analytic.js's, the exact hits' (where along a ray a shape's
// surface is): the shapes with such an answer were the closed-form ones, and the dear-only rule borrowed them. Exact
// hits went in 0.41.0 (roadmap/ARCHITECTURE.md, Removed in 0.41.0); the rule stayed, and kept exactly the shapes and the
// parse it had -- an outline's revolve or extrude walks its pieces in a loop, so it was never one, and is not here.
//======================================================================================================================

import { withoutComments } from './helpers.js'

/** The closed-form shapes' N-functions: a call of one of these alone is one plain shape */
export const PLAIN_SHAPES = new Set([
    'Nsphere', 'NboxRounded', 'Ncylinder', 'Ncapsule', 'Nlens', 'Ndisc', 'Nrectangle', 'Nplane',
    'Ntube', 'sdCappedCone', 'Ndome', 'Ndish', 'Noctahedron', 'Nfrustum', 'Nprism', 'NroundCone',
])

/* the arguments of a call, split at its top-level commas; null when the parentheses do not balance */
function splitArgs(s) {
    const out = []
    let depth = 0, at = 0
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (c === '(' || c === '[') depth++
        else if (c === ')' || c === ']') { if (--depth < 0) return null }
        else if (c === ',' && depth === 0) { out.push(s.slice(at, i).trim()); at = i + 1 }
    }
    if (depth !== 0) return null
    out.push(s.slice(at).trim())
    return out
}

/**
 * An object's code as one call of a plain shape at p: { fn, args } -- args the shape's own after p, as written -- or
 * null for any other code. Comments and spacing aside, `C = add_new(C, Fn(p, ...), MATERIAL);` and nothing else.
 */
export function plainShapeOf(code) {
    // spacing aside: none around punctuation (never a change of meaning in WGSL), one elsewhere
    const s = withoutComments(String(code ?? '')).replace(/\s+/g, ' ').replace(/ ?([(),=;]) ?/g, '$1').trim()
    const m = /^C=add_new\(C,(\w+)\((.*)\),MATERIAL\);$/.exec(s)
    if (!m || !PLAIN_SHAPES.has(m[1])) return null
    const args = splitArgs(m[2])
    if (!args || args.some(a => !a) || args[0] !== 'p') return null
    return { fn: m[1], args: args.slice(1) }
}
