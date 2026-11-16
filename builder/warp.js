//======================================================================================================================
// A RAY WARP ON AN OBJECT (0.86.0, model version 30; the renderer's side is lib/pathtracer/core/warp.js, which says what
// the march does with it).
//
// The user (2026-11-15), for art: "an object with no ordinary material in which another function is used for ray marching
// ... a code block with the normal raymarch step in it that users can change" -- "preferably an ordinary SDF object" --
// and in it "colour, number of steps, path length, whatever parameters there are, depending on other parameters or on
// position", the position too.
//
// SO IT IS AN OBJECT'S, not a node type of its own: `warp` on any object with code -- { code, draw, step } -- and the
// object's own code, its block's, is the REGION the warp acts in, an SDF like any other; its parameters, transform, copies
// in the tree, undo and files are an object's. `code` is the warp's WGSL, run at each march step inside the region (its
// names in WARP_NAMES, below); `step` the longest step a ray takes inside, in the scene's unit, so a bend is followed in
// pieces that short; `draw` whether the object is drawn as well (its surface, in its material) -- off by default, so what
// a warp shows is what is seen through it.
//
// toTree (model.js) hands codegen every warp in `tree.warps`, the object's code and the transforms above it, and takes an
// object that is not drawn out of the tree it hands everything else, so codegen's SDF, the scene as data, the bake, the
// bounds and the pick never meet it -- a scene's text is the one it was but for the warps' functions (codegen.js THE RAY
// WARPS). What a warp does NOT follow (said in Help > Ray warps): an array's copies (the warp is at its group's frame) and
// a group's code above it (a twist, a bend: the region is the object's own shape, moved by the transforms alone).
//======================================================================================================================

/** What a warp's code starts as: the straight step, nothing changed, and what it can do. */
export const WARP_TEMPLATE = [
    '// Ray warp: runs at every march step a ray takes inside this object\'s shape (its code above).',
    '// Read:  p (here, in this object\'s frame)  world (here, in the scene)  dist (how deep: negative inside)',
    '//        ds (this step\'s length)  pathLength (how far the ray has come)  bounces  isPhoton  its parameters',
    '// Set:   dir (where the step goes)  pos (move the ray there, in this frame)  tint (colour kept per unit of length)',
    '//        glow (light added per unit of length)  stop() ends the ray here;  rand() is a random number in [0, 1)',
    '//        posWorld, dirWorld: pos and dir in the scene\'s own frame -- a portal: posWorld = world + VEC3(2.0, 0.0, 0.0);',
    '// Rotations: rotX(a) rotY(a) rotZ(a) rotAxis(axis, a), angles in radians.  Lengths are this object\'s own units.',
    '// e.g. a twist about z:   dir = rotZ(2.0 * ds) * dir;',
    '// e.g. a pull inwards:    dir = normalize(dir - normalize(p) * 0.5 * ds);',
    '// e.g. a shimmer:         dir = normalize(dir + (VEC3(rand(), rand(), rand()) - 0.5) * 0.2 * ds);',
    '// e.g. pink fog, glowing: tint = VEC3(1.0, 0.6, 0.8); glow = VEC3(0.5, 0.1, 0.3);',
    'dir = dir;',
].join('\n')

/** The names a warp's code reads and sets (the panel's tip, Help > Ray warps). */
export const WARP_NAMES = 'p, world, dist, ds, pathLength, bounces, isPhoton and its parameters; it sets dir, pos, posWorld, dirWorld, tint, glow and calls stop(), rand()'

/** Whether a node can carry a warp: an object with code -- not a light, nor a haze box. */
export const canWarp = n => n?.kind === 'object' && n.type !== 'light' && n.type !== 'haze'

/** A warp's step to start with, in the scene's unit: about a fiftieth of the object's estimated size, so a ray crosses it
 *  in some fifty steps; `size` null or not positive (nothing known) is a twentieth of a unit. */
export const warpStepFor = size => size > 0 ? +(size / 50).toPrecision(2) : 0.05

/** A new warp, with its step. */
export const newWarp = step => ({ code: WARP_TEMPLATE, draw: false, step })

/** What is wrong with a node's `warp`, as lines (none: it is sound). */
export function warpProblems(n) {
    const w = n.warp, p = []
    if (!canWarp(n)) return [`'${n.id}': a ${n.type === 'light' ? 'light' : n.kind === 'group' ? 'group' : n.type} has no ray warp: an object with code has`]
    if (!w || typeof w !== 'object' || Array.isArray(w)) return [`'${n.id}': warp is { code, draw, step }`]
    if (typeof w.code !== 'string') p.push(`'${n.id}': warp.code must be text`)
    if (typeof w.draw !== 'boolean') p.push(`'${n.id}': warp.draw must be true or false`)
    if (typeof w.step !== 'number' || !Number.isFinite(w.step) || !(w.step > 0)) p.push(`'${n.id}': warp.step must be a length above 0`)
    for (const k of Object.keys(w)) if (!['code', 'draw', 'step'].includes(k)) p.push(`'${n.id}': warp.${k}: a warp is its code, draw and step`)
    return p
}

/** The id its code's messages are mapped to (codegen e.from), as a relief's are `<id>#relief`. */
export const WARP_SUFFIX = '#warp'
export const warpOwner = id => `${id}${WARP_SUFFIX}`
