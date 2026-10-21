//======================================================================================================================
// CODEGEN -- a node list becomes a scene the renderer can compile.
//
// DELIBERATELY SMALL. This is step one of reviving the scene builder, and step one is the
// loop that killed the last attempt: generate, compile, report the error at the USER's line.
// Two node types and no UI. Nothing else gets built until that round-trips, because the
// previous builder had a tree, a property panel and a GLSL editor sitting on top of a
// generator that emitted `sdfResult(d, m)` for an engine that had moved to a three-field
// struct -- every scene it produced was a hard compile error, and none of that UI could tell
// anyone so.
//
// WHICH IS WHY THE FIRST NODE TYPE IS `code`. A parameterised sphere can only be wrong in
// ways the generator controls; a snippet someone typed is where real errors come from, and it
// is the only node type that proves the mapping does anything.
//
// WHAT IT EMITS: its own getMaterial2 over the document's materials (see materials.js), then
// then `fn SDF(r: Ray) -> Hit` starting from emptyHit and folding with add_new. A generated
// scene is not a special kind of scene; it is an object with `wgsl` and `uniforms` like any
// other, and RT.setScene() cannot tell the difference. That is the contract working.
//
// NAMESPACED UNIFORMS, BY ALIAS, NOT BY REWRITING THE SNIPPET. A node's parameters become
// `<name>_<id>` in the uniform struct so two spheres do not fight over `radius` -- but the
// user's text is emitted BYTE-IDENTICAL, with a scoped `let radius = UB.radius_n3;` in front
// of it inside a block of its own.
//
// The old builder did this with a word-boundary regex over the snippet, and it cost more than
// it looks. It rewrote the name inside comments, so `// set radius first` became
// `// set radius_a1b2 first`. It clobbered member access, turning `hit.radius` into
// `hit.radius_a1b2`. It rewrote `#define` lines. And -- the reason it matters here -- it meant
// the text in the shader was not the text in the editor, so quoting the offending line back at
// the user quoted something they never wrote, and locating the snippet by substring search
// could not work at all.
//
// A `let` costs nothing (the compiler folds it), the braces keep two nodes' aliases apart, and
// the snippet in the error report is the snippet on screen.
//
// ITS ONE HAZARD, which the regex version did not have: an alias SHADOWS. A parameter named
// `round`, `min`, `mix` or `length` hides that builtin for the rest of the block, so the
// snippet can no longer call it. Legal WGSL and a comprehensible error when it bites -- the
// name is right there above the snippet -- but a node-type author should not call a parameter
// after a builtin. Worth a warning once there is a UI to warn in.
//======================================================================================================================

import { FIELDS as MATERIAL_FIELDS, FIELDS_OF, COAT_FIELDS, hasCoating, reliefMaterialId, reliefOwner } from './materials.js'
import { hasFace, lightOf, lightRGBObject, beamOf } from './lights.js'
import { sceneExtent } from './bounds.js'
import { SCENE_PRELUDE } from '../lib/pathtracer/core/scene_api.js'
import { NO_LIGHT_FACES } from '../lib/pathtracer/core/uniforms.schema.js'
import { LIGHT_BEAM_LINES } from '../lib/pathtracer/core/tracebasics.js'
import { profilePieces, profileWGSL, pathPieces, pathWGSL, profileReachOf, pathSlotsOf, profileSlotsOf, pathSlotCount, profileSlotCount, piecesVary } from '../lib/pathtracer/core/shapes.js'
import { resolvePath, resolveProfile, pathNames, pointNames, LIVE_PATH_MAX, LIVE_PROFILE_MAX } from './expr.js'
import { Emit } from './emit.js'
import { planOf, recordsOf, evaluatorWGSL, lightFacesWGSL, slotRead, attachData, STACK_MAX, RECS_UNIFORM_TYPE } from './scenedata.js'
import { plainShapeOf } from './plainshape.js'
import { BODY_MARKER } from './validate.js'
import { matrixOf } from './transform.js'
import { hazeOf } from './hazebox.js'

/* COMPONENT ORDER IS DECLARED, NOT INHERITED FROM THE OBJECT LITERAL. The old builder took
   the TYPE from the sorted key list and the VALUE from Object.values() in insertion order, so
   a vector authored `{z:1, y:2, x:3}` was typed vec3 and uploaded as (z,y,x) -- silently the
   wrong way round. Both the type and the payload come off the same table here. */
const SHAPES = [
    { keys: 'xy', order: ['x', 'y'], type: 'vec2<f32>' },
    { keys: 'xyz', order: ['x', 'y', 'z'], type: 'vec3<f32>' },
    { keys: 'wxyz', order: ['x', 'y', 'z', 'w'], type: 'vec4<f32>' },
    { keys: 'bgr', order: ['r', 'g', 'b'], type: 'vec3<f32>' },
    { keys: 'abgr', order: ['r', 'g', 'b', 'a'], type: 'vec4<f32>' },
]
const shapeOf = v => (v && typeof v === 'object' && !Array.isArray(v))
    ? SHAPES.find(s => s.keys === Object.keys(v).sort().join('')) : null

/** A node's parameters become uniforms; a WGSL type is inferred from the value's shape. */
export const wgslTypeOf = v => {
    if (typeof v === 'boolean') return 'u32'
    if (typeof v === 'number') return 'f32'
    if (Array.isArray(v)) return ['f32', 'vec2<f32>', 'vec3<f32>', 'vec4<f32>'][v.length - 1] || 'f32'
    return shapeOf(v)?.type || 'f32'
}

/** The value in the shape the uniform STATE wants, which is the shape the property table
 *  edits: a vector stays an object, rebuilt in canonical component order. buildUniforms turns
 *  it into an array on the way to the GPU -- handing Tweakpane an array instead gets you
 *  "No matching controller", and handing tinywebgpu an object gets you a silent NaN. */
const defOf = v => {
    if (typeof v === 'boolean') return v ? 1 : 0
    if (Array.isArray(v)) return v.slice()
    const s = shapeOf(v)
    return s ? Object.fromEntries(s.order.map(k => [k, v[k]])) : v
}

/** Parameter `p` of node `id`, as it is named in the uniform struct. */
export const uniformName = (id, p) => `${p}_${id}`
/** Parameter `p` of material `matId`'s relief: `relief_<p>_<id>` -- a material's own parameters may not be
 *  called relief_... (model.js), so the two cannot meet. */
export const reliefName = (matId, p) => uniformName(matId, `relief_${p}`)
/** The uniform of parameter `p` of any owner a parameter operation names: a node, a material, or a
 *  material's relief (`<id>#relief`, materials.js). One spelling for codegen, BUILDER.live and the tests. */
export const paramUniform = (id, p) => { const m = reliefMaterialId(id); return m != null ? reliefName(m, p) : uniformName(id, p) }

/** A profile parameter's value: a list of points, each a list (model.js paramKind, which this mirrors -- codegen
 *  cannot import the model, which imports it). Never a uniform: it is compiled into a function of its own. */
export const isProfile = v => Array.isArray(v) && v.length > 0 && v.every(Array.isArray)
/** A path parameter's value: { path: [[x, y, z], [x, y, z, fillet], ...] } (model.js paramKind, mirrored). */
export const isPath = v => !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.path)
/** A profile or a path: its points are compiled into the shader's own text, and it is never a uniform -- every
 *  loop that declares a node's, a material's or a group's uniforms passes over it (a path read as an object would
 *  have been declared a struct member of no type). */
export const isCompiledIn = v => isProfile(v) || isPath(v)
/** The WGSL function one profile parameter is compiled into. Ids have no underscore (model.js), so no two
 *  node-and-parameter pairs can spell the same name. */
export const profileFn = (id, k) => `prof_${id}_${k}`
/** ...and the stem of the two one path parameter is compiled into: <stem>_near and <stem>_sweep. */
export const pathFn = (id, k) => `path_${id}_${k}`
/** The handle a tube passes for its cross-section: no profile's, so pathCross draws the circle. */
const CIRCLE = 4294967295

/* A LIVE PATH (model.js setPathLive; asked 2026-10-01: "all points uniforms, so they can be tweaked; once it is
   finalized switch to compile mode"). Its pieces are uniforms instead of literals -- one mat4 a piece, a segment's
   (a, L) (T, 0) (N, 0) (B, 0), a bend's (c, R) (k, 0) (u0, 0) (u1, 0) and its frame's f a vec4, and an `ok` -- so a
   parameter its points name (expr.js) moves it with no compile: the builder computes the pieces again in JS and
   writes them (livePointsUpdate, below; demo.js liveValue). Arrays are not a uniform type here (tinywebgpu.js
   typeInfo), hence a name a piece. They start with an underscore, which no parameter's name can (model.js PARAM), so
   none meets a parameter's <p>_<id>. One that makes the path unsound writes ok = 0 and the path draws nothing (the
   user's choice).
     SLOTTED (2026-10-02, the user: "adding points now requires recompilation ... extra points added with some flag that
   these are empty"): the live chain is written by POSITION for a number of points, its ROOM (core/shapes.js
   pathSlotsOf), each slot on or off -- [1].w of its mat4 -- and a segment's first and last ([2].w, [3].w) read too.
   So what only a compile can change is the room: a corner made straight (its bend off), a point added or taken away
   within it, is written. The room is the points it has, and EDIT_SPARE more while it is edited in the picture. It is a
   LOOP over the slots (core/shapes.js pathWGSL says why: written out slot by slot, a sweep's section was copied into
   the shader once a block, and the light guide in the picture compiled for 70 s), each read by its index through a
   switch, up to a count -- `_pn`, the slots up to the last one on -- so the spare ones cost nothing at run time.
     VARYING (a point's scale or twist, 2026-10-02): the path is written in its varying form (core/shapes.js pathWGSL
   `vary`) when any value is off the defaults, or while it is edited in the picture -- so the first scale dragged
   there writes numbers too -- and a live one's values are uniforms then as well: a mat2x4 a segment slot (va, 0)
   (vb, 0), a vec4 a bend slot (v, 0). A live path that starts or stops varying outside the picture compiles once. */
export const pathPieceName = (id, k, i) => `_pp${i}_${k}_${id}`
export const pathFrameName = (id, k, i) => `_pf${i}_${k}_${id}`
export const pathValuesName = (id, k, i) => `_pv${i}_${k}_${id}`
export const pathCountName = (id, k) => `_pn_${k}_${id}`
export const pathOkName = (id, k) => `_pok_${k}_${id}`
// s, b, a: a segment, a path's bend, a profile's arc -- the kinds in order are the chain; x, none at all (unsound)
const signatureOf = pieces => pieces.length ? pieces.map(p => p.kind[0]).join('') : 'x'
/** The points of room a live path or profile is given beyond its own while it is edited in the picture: a point added
 *  there, up to this many, compiles nothing. Its slots cost a case each in the loop's accessor, and nothing at run
 *  time: the loop stops at the last slot on (read in code; not measured). */
export const EDIT_SPARE = 8
/** A live chain's room: its points (at least the fewest it can have), EDIT_SPARE more while edited, never more than
 *  a live one may have. */
const roomOf = (n, min, max, edited) => Math.min(Math.max(n, min) + (edited ? EDIT_SPARE : 0), Math.max(max, n))
/** A path's pieces, its points read against its node's parameters (expr.js); none when it is not sound. */
export function pathOf(params, v) {
    const r = resolvePath(params, v)
    if (r.problems.length) return []
    const { pieces, problems } = pathPieces(r.points)
    return problems.length ? [] : pieces
}
/** A live path's slot uniforms for room `room`, { name: { type, def } }: def a mat4's 16 numbers column by column, a
 *  vec4's 4 -- a segment's (a, L) (T, on) (N, first) (B, last), a bend's (c, R) (k, on) (u0, 0) (u1, 0) and its frame's
 *  f; a slot that is off all 0. `vary`: each slot's values too (a segment's (va, 0) (vb, 0), a bend's (v, 0)). */
export function pathUniformDecls(id, k, pieces, room, vary = false) {
    const out = {}, zeros = n => new Array(n).fill(0)
    pathSlotsOf(pieces, room).forEach((p, i) => {
        if (i % 2 === 0) {
            out[pathPieceName(id, k, i)] = { type: 'mat4x4<f32>', def: p
                ? [...p.a, p.L, ...p.T, 1, ...p.N, p.first ? 1 : 0, ...p.B, p.last ? 1 : 0] : zeros(16) }
            if (vary) out[pathValuesName(id, k, i)] = { type: 'mat2x4<f32>', def: p ? [...p.va, 0, ...p.vb, 0] : zeros(8) }
        } else {
            out[pathPieceName(id, k, i)] = { type: 'mat4x4<f32>', def: p ? [...p.c, p.R, ...p.k, 1, ...p.u0, 0, ...p.u1, 0] : zeros(16) }
            out[pathFrameName(id, k, i)] = { type: 'vec4<f32>', def: p ? [...p.f] : zeros(4) }
            if (vary) out[pathValuesName(id, k, i)] = { type: 'vec4<f32>', def: p ? [...p.v, 0] : zeros(4) }
        }
    })
    // how far the loop runs: the slots up to the last one on (none while it is not sound)
    out[pathCountName(id, k)] = { type: 'f32', def: pathSlotsOf(pieces, room).reduce((n, p, i) => p ? i + 1 : n, 0) }
    return out
}
/* ...and what pathWGSL's loop reads in place of literals: the slot `sl` it has in hand (a PathSlot: m the piece's
   mat4, f a bend's frame, v the values -- read by the varying form alone), and which uniforms slot i is */
const slotOperands = p => p.kind === 'segment'
    ? { a: 'sl.m[0].xyz', L: 'sl.m[0].w', T: 'sl.m[1].xyz', N: 'sl.m[2].xyz', B: 'sl.m[3].xyz',
        first: 'sl.m[2].w > 0.5', last: 'sl.m[3].w > 0.5', va: 'sl.v[0].xyz', vb: 'sl.v[1].xyz' }
    : { c: 'sl.m[0].xyz', R: 'sl.m[0].w', k: 'sl.m[1].xyz', u0: 'sl.m[2].xyz', u1: 'sl.m[3].xyz', f: 'sl.f', v: 'sl.v[0].xyz' }
const slotUniforms = (id, k, vary) => i => {
    const w = `UB.${pathValuesName(id, k, i)}`
    return i % 2 === 0 ? { m: `UB.${pathPieceName(id, k, i)}`, ...(vary ? { v: w } : {}) }
        : { m: `UB.${pathPieceName(id, k, i)}`, f: `UB.${pathFrameName(id, k, i)}`, ...(vary ? { v: `mat2x4<f32>(${w}, vec4<f32>())` } : {}) }
}
/* A LIVE PROFILE likewise (2026-10-02): one mat2x4 a piece -- a segment's (a, b) (axis, 0, 0, 0), an arc's
   (c, r, convex) (a, b) -- with an `ok` and its reach (profileReach, which a sweep skips by). The booleans a compiled
   profile writes as literals (whether a segment lies on the axis, which side an arc bulges) are numbers here, so a
   corner turning concave or a point leaving the axis is written, not recompiled. SLOTTED as a path is (2026-10-02):
   an arc and a segment a point of room; a segment's slot is on by its [1].y, an arc's while its radius is not
   negative -- a fillet never is, and an arc's eight numbers leave no room for a flag -- so a fillet appearing or
   going, or a point within the room, is written too. A loop over the slots as a path's, up to its count `_qn`. */
export const profilePieceName = (id, k, i) => `_qp${i}_${k}_${id}`
export const profileOkName = (id, k) => `_qok_${k}_${id}`
export const profileReachName = (id, k) => `_qre_${k}_${id}`
export const profileCountName = (id, k) => `_qn_${k}_${id}`
/** A profile's pieces, its points read against its node's parameters (expr.js); none when it is not sound. */
export function profileOf(params, v) {
    const r = resolveProfile(params, v)
    if (r.problems.length) return []
    const { pieces, problems } = profilePieces(r.points)
    return problems.length ? [] : pieces
}
/** A live profile's slot uniforms for room `room`, { name: { type, def } }: a mat2x4's 8 numbers a slot, column by
 *  column -- an arc's (c, r, convex) (a, b), a segment's (a, b) (axis, on, 0, 0); an arc's off with r -1, a segment's
 *  all 0 -- and its reach. */
export function profileUniformDecls(id, k, pieces, room) {
    const out = {}
    profileSlotsOf(pieces, room).forEach((p, i) => {
        out[profilePieceName(id, k, i)] = { type: 'mat2x4<f32>', def: i % 2 === 0
            ? (p ? [...p.c, p.r, p.convex ? 1 : 0, ...p.a, ...p.b] : [0, 0, -1, 0, 0, 0, 0, 0])
            : (p ? [...p.a, ...p.b, p.axis ? 1 : 0, 1, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0]) }
    })
    out[profileReachName(id, k)] = { type: 'f32', def: profileReachOf(pieces) }
    out[profileCountName(id, k)] = { type: 'f32', def: profileSlotsOf(pieces, room).reduce((n, p, i) => p ? i + 1 : n, 0) }
    return out
}
/* what profileWGSL's loop reads: the slot `sl` (a mat2x4) it has in hand */
const profileSlotOperands = p => p.kind === 'arc'
    ? { c: 'sl[0].xy', r: 'sl[0].z', a: 'sl[1].xy', b: 'sl[1].zw', convex: 'sl[0].w > 0.5', on: 'sl[0].z >= 0.0' }
    : { a: 'sl[0].xy', b: 'sl[0].zw', surface: '(!axis || sl[1].x < 0.5)', on: 'sl[1].y > 0.5' }
/* the two kinds as a live change sees them: the value, whether it is live, what it reads, its pieces and uniforms */
const POINT_KINDS = {
    path: { live: (node, v) => isPath(v) && v.live === true, names: v => isPath(v) ? pathNames(v) : [], pieces: pathOf,
        ok: pathOkName, decls: pathUniformDecls, count: v => v.path.length },
    profile: { live: (node, v, k) => isProfile(v) && !!node.liveProfiles?.includes(k), names: v => isProfile(v) ? pointNames(v) : [],
        pieces: profileOf, ok: profileOkName, decls: profileUniformDecls, count: v => v.length },
}
const findIn = (n, id) => {
    if (n?.id === id) return n
    for (const c of n?.children || []) { const f = findIn(c, id); if (f) return f }
    return null
}
/**
 * What a live change to parameter `k` of node `id` does to the paths and profiles of the scene SHOWN (its
 * `pointParams`, as compiled): { set: { uniform: value }, restructure }. A live one it touches -- the path or profile
 * itself, or one whose points name k -- gets its slots written while its points fit its room, ok = 0 when it is not
 * sound now, and a recompile when they no longer fit. A COMPILED one that names k always recompiles: its numbers are
 * the shader's text. Pure: the set is exactly the defaults a fresh compile of `doc` with the same room would declare
 * (codegen.test).
 */
export function livePointsUpdate(doc, id, k, shown = []) {
    const set = {}
    let restructure = false
    /* WHAT A PATH READS IS THE DOCUMENT'S, not only the compile's: a live path's typed edit compiles nothing, so a name
       typed in since is not in `deps`, and its slider moved nothing until the path was applied again (the user,
       2026-10-02: "only after I press apply route every time I change the slider"). `deps` still counts: a name
       typed out since was compiled in, and a compiled one's numbers are the compile's. */
    const node = findIn(doc.root, id)
    const reads = P => P.k === k || P.deps.includes(k) || !!POINT_KINDS[P.kind]?.names(node?.params?.[P.k]).includes(k)
    const touched = (shown || []).filter(P => P.id === id && reads(P))
    if (!touched.length) return { set, restructure }
    for (const P of touched) {
        const v = node?.params?.[P.k], K = POINT_KINDS[P.kind]
        // forced live while it is edited in the picture (emitScene editing): live, whatever the document says
        if (!K || !P.live || !(K.live(node, v, P.k) || P.forced)) { restructure = true; continue }
        if (!(P.room >= K.count(v))) { restructure = true; continue }        // more points than it has room for
        const pieces = K.pieces(node.params, v)
        if (!pieces.length) { set[K.ok(id, P.k)] = 0; continue }
        // a path's form: varying while edited or while a value is off the defaults (emitScene); a change of form is text
        if (P.kind === 'path' && !!P.vary !== (!!P.edited || piecesVary(pieces))) { restructure = true; continue }
        for (const [name, d] of Object.entries(K.decls(id, P.k, pieces, P.room, !!P.vary))) set[name] = d.def
        set[K.ok(id, P.k)] = 1
    }
    return { set, restructure }
}

/** The `let` lines that put a node's parameters in scope under their bare names, so the
 *  snippet can say `radius` and mean `UB.radius_n3` without being touched. A PROFILE becomes its HANDLE, a u32
 *  const naming which of the scene's profiles it is -- extrude(outline, p, h) takes that, since WGSL cannot pass
 *  a function, and the code is not rewritten to call one by name (handleOf: the scene's numbering). A PATH
 *  likewise, numbered among the paths: tube(route, p, r, 0.0). */
export function aliasPrelude(id, params, material, constants = {}, nameOf = k => uniformName(id, k), handleOf = () => null) {
    /* A COMPILE-TIME PARAMETER is a `const`, not a uniform read: its value is in the source, so
       the compiler can unroll a loop it bounds (Menger's iteration count) or fold a branch it
       picks. That is the whole reason to have one -- a loop bounded by a uniform cannot be
       unrolled and pays for it at every march step. Changing it recompiles. */
    const out = Object.keys(params).map(k => isCompiledIn(params[k])
        // no handle (it cannot happen for a sound document): one no profile or path has, which the dispatchers answer with nothing
        ? `const ${k}: u32 = ${handleOf(k) ?? 4294967295}u;`
        : constants[k]
        ? `const ${k}: ${constants[k]} = ${wgslLiteral(params[k], constants[k])};`
        : `let ${k} = UB.${nameOf(k)};`)
    // MATERIAL is an alias too, for the same reason: a snippet that says MATERIAL stays
    // readable, and the id it resolves to is a scene constant rather than a display label --
    // renaming a material in a UI must never silently rebind the objects using it.
    if (material) out.push(`let MATERIAL = ${material};`)
    return out
}

/** A number as a WGSL literal of the given scalar type. f32 always carries a point or an exponent,
 *  since `3` is an abstract int in WGSL and would not be an f32 const. */
export function wgslLiteral(v, type) {
    if (type === 'u32') return `${Math.max(0, Math.round(v))}u`
    if (type === 'i32') return `${Math.round(v)}i`
    const t = String(Number(v))
    return /[.eE]/.test(t) ? t : `${t}.0`
}

//----------------------------------------------------------------------------------------------
// THE ONE NODE TYPE: code. An object is whatever its code folds into C, with its parameters in
// scope by name. The primitives were types of their own once -- a `body` each, emitted through
// exactly this path -- and are now code nodes that start as one of primitives.js's; nothing here
// knows a sphere from anything else. Kept as a table so `type` stays in the saved format.
//----------------------------------------------------------------------------------------------
export const NODE_TYPES = {
    /** A LIGHT (model version 10, lights.js): not code -- a rectangle or disc whose shape has to
     *  stay known, or a ray file with no geometry at all. emitScene draws it (LIGHTS there). */
    light: {
        params: {},
        body: () => '',
    },
    /** AN EXPORT BOX (exportbox.js): the part of the scene a print export takes. Not geometry --
     *  emitted as a comment, its uniforms declared like anything left out (see `object` below). */
    export: {
        params: {},
        body: () => '',
    },
    /** A HAZE BOX (hazebox.js, version 22): dust in the air inside it -- the renderer's (lib/pathtracer/core/haze.js),
     *  handed over as the scene's `haze`. Not geometry: emitted as a comment, as an export box is. */
    haze: {
        params: {},
        body: () => '',
    },
    /** Whatever the user typed. `p` is the sample point, `C` the Hit being folded into, and
     *  the node's own parameters are in scope under their bare names. */
    code: {
        params: {},
        body: (node) => node.code ?? OBJECT_CODE_TEMPLATE,
    },
}

/** The uniform a node's transform becomes, and a CSG group's blend. model.js reserves these
 *  parameter names so no node parameter can collide with them. */
/** Code with its comments removed: what decides whether a block emits anything and whether it
 *  reads p_local. A template made of comments must cost nothing, and a comment that says
 *  "p_local" must not buy an SDF evaluation per hit. */
export const codeOnly = s => String(s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
export const readsLocal = s => /\b(p_local|R_local|S_local)\b/.test(codeOnly(s))
/** Does a relief's code read the scene's point (materials.js, the relief header)? */
export const readsWorld = s => /\bworld\b/.test(codeOnly(s))

/** What a new code node starts as: how to use it, and a shape that compiles. */
export const OBJECT_CODE_TEMPLATE = [
    '// Code node: fold shapes into C.  C = add_new(C, <sdf>, MATERIAL);',
    '//   p         the point, in this node\'s own frame (its transform is already applied)',
    '//   MATERIAL  this node\'s material;  parameters are in scope by name',
    '//   an sdf is VEC4(normal.xyz, distance); sd(d) wraps a bare distance (normal then computed)',
    '// e.g. a rounded box:     C = add_new(C, sdRoundedBox(p, VEC3(0.5), 0.05), MATERIAL);',
    '// e.g. a plane, z up:     C = add_new(C, VEC4(0.0, 0.0, 1.0, p.z), MATERIAL);',
    '// e.g. two shapes merged: C = add_new(C, csgUnion(Nsphere(p, 0.5), sdBox(p - VEC3(0.6, 0.0, 0.0), VEC3(0.3)), 0.2), MATERIAL);',
    'C = add_new(C, sdBox(p, VEC3(0.5)), MATERIAL);',
].join('\n')

export const xfName = id => uniformName(id, 'xf')
/** An array's copy i (model.js copies, version 17): its transform, one mat4 uniform a copy (uniforms are not arrays) */
export const copyName = (id, i) => uniformName(id, `cp${i}`)
export const blendName = id => uniformName(id, 'blend')
/* A NODE'S VISIBILITY AS A UNIFORM (generate's `liveVisibility`): u32, 1 shown, 0 not */
export const visName = id => uniformName(id, 'vis')
/* A TOP-LEVEL NODE'S BOUNDING BOX, for culling (see the root in emitScene): vec4 lo and hi in the node's
   own frame, lo.w 1 when known. Declared unknown; the builder writes them once measured (boxes.js). */
export const boxLoName = id => uniformName(id, 'bxlo')
export const boxHiName = id => uniformName(id, 'bxhi')

/** How a CSG group combines, in a word: the one join its shapes after the first share, or 'mixed'
 *  (none: 'union'); and whether any blend is in play. What its comment line and its tree row say --
 *  for a version 10 group, the words its op gave. */
export const joinSummary = g => {
    const joins = [...new Set(shapesOf(g).slice(1).map(joinOf))]
    return { join: joins.length > 1 ? 'mixed' : joins[0] ?? 'union', smooth: g.blend > 0 || shapesOf(g).some(c => c.joinBlend > 0) }
}
const joinNote = g => { const j = joinSummary(g); return `${j.join}${j.smooth ? ', smooth' : ''}` }

/* A NODE'S OWN JOIN BLEND (model version 14, `joinBlend`): absent, it takes its group's blend_<g> */
export const joinBlendName = id => uniformName(id, 'jblend')

/** How a node joins what is above it in its group (model.js OPS; absent = union). */
export const joinOf = c => c?.join ?? 'union'
/** The children of a group that are its SHAPES: a light (drawn after a CSG group's combine, outside it:
 *  emitScene collectLights) and an export box (draws nothing) are not, and are left out of the combine
 *  (children() below). */
export const shapesOf = g => (g?.children || []).filter(c => c.type !== 'export' && c.type !== 'haze' && c.type !== 'light')

/** Does this group combine its children into one shape (and so need the CSG path)? Not when every
 *  shape after the first joins by union with no blend of its own and the group has none: each child
 *  then folds into the scene on its own, which keeps each child's material and the medium tracking
 *  exact. A tree from model.toTree says so itself (`csg`), decided on the document before disabled
 *  children were pruned; anything else -- a document's group, a tree built by hand -- is decided here. */
export const isCsg = g => g.csg ?? (g.blend > 0 || shapesOf(g).some((c, i) => i > 0 && (joinOf(c) !== 'union' || c.joinBlend > 0)))

const CSG_FN = { union: 'csgUnion', subtract: 'csgSubtract', intersect: 'csgIntersect' }
// when the child just combined makes the surface, and so gives the group its material (combine below)
const MAT_WINS = { union: k => `C.s.w < ${k}.w`, subtract: k => `-C.s.w > ${k}.w`, intersect: k => `C.s.w > ${k}.w` }

//----------------------------------------------------------------------------------------------
// A GROUP'S CODE -- the one place anything can be done to a group's children: change the point
// before them (twist, bend, repeat, mirror), change the distance after them (round, shell,
// displace), or evaluate them more than once. It does not run before or after the children; it
// CALLS them, as `children(C, p)`, which is what lets one block do all three.
//
// THE CHILDREN BECOME A FUNCTION, children_<id>(C, p) -> Hit, emitted at module scope before
// SDF: they fold into the Hit they are given, at the point they are given, exactly as they would
// have folded into the scene's -- a CSG group's op and blend included. WGSL has no closures and
// no function pointers, so each coded group needs a function of its own name, and the user's
// `children(` is renamed to it (renameChildren). That is the ONE place codegen changes what was
// typed, agreed as such: the header's case against rewriting was a rewrite of parameter names
// that also hit comments and member access, and this one skips both. Lines are kept; the columns
// it moves are recorded, so an error after it is still reported at the column typed (emit.js).
//
// A GROUP WHOSE CODE IS ONLY COMMENTS HAS NONE: its children are emitted inline as before, and
// the shader is byte-identical to one from a builder that had never heard of group code.
//
// THE COST is whatever the code does. `C = children(C, p)` alone is the plain group -- its
// children fold straight into the scene's Hit, the medium tracking stays exact. Calling it twice
// is twice the children. Folding them into a Hit of their own (emptyHit) to change the distance
// afterwards has the CSG group's price: the medium inside is the nearest surface's, not tracked
// per child, and a p_local material inside records its point whenever its surface wins that
// private Hit rather than the scene's.
//----------------------------------------------------------------------------------------------

/** Does this group have code of its own (and so a children function)? */
export const hasCode = g => g?.kind === 'group' && !!codeOnly(g.code).trim()

/* Comments out, nested block comments too (WGSL nests them; codeOnly's regex does not): each replaced by a space, so
   what was on either side of one never runs together */
const withoutComments = s => {
    const src = String(s ?? '')
    let out = '', i = 0, depth = 0
    while (i < src.length) {
        const c = src[i], n = src[i + 1]
        if (depth === 0 && c === '/' && n === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; out += ' '; continue }
        if (c === '/' && n === '*') { depth++; i += 2; continue }
        if (depth > 0 && c === '*' && n === '/') { depth--; i += 2; if (depth === 0) out += ' '; continue }
        if (depth === 0) out += c
        i++
    }
    return out
}
/**
 * A GROUP WHOSE CODE ONLY MOVES THE POINT ITS CHILDREN SEE -- the "before" kind of PERFORMANCE.md P3's blocks: twist,
 * bend, repeat (one cell) and mirror, and any customer code of that shape. Its code, comments aside, ENDS with
 * `C = children(C, p);` and calls nothing else of the scene's: before that line it never names C (it folds nothing), nor
 * children, nor the relief's words (SURFACE_ONLY, READ_REACH, DIVIDED_ABOVE: they say what is above a surface, which
 * a group that folds nothing has no use for), nor returns. What it leaves -- p, and XF_M, XF_S and XF_K as warp() set
 * them -- is all its children are given, so the scene as data can call it alone and walk the children as records
 * (scenedata.js BEFORE): editing them is data, not a compile. Recognised by its code, not declared, so no file changes
 * and a customer's own code of this shape is one too; anything else stays group code, compiled as before. Not one
 * marked straightMaterial in a scene where that frame is in force (`straight`: a material reads p_local or has a relief,
 * emitScene's `straight`; its materials' frame starts there, and codegen keeps that frame in compiled code), nor one
 * with a profile or a path among its parameters (a handle the records do not number for groups).
 */
export const isBefore = (g, { straight = true } = {}) => {
    if (!hasCode(g) || (straight && g.straightMaterial === true)) return false
    if (Object.values(g.params || {}).some(v => isProfile(v) || isPath(v))) return false
    const src = withoutComments(g.code)
    const m = /\bC\s*=\s*children\s*\(\s*C\s*,\s*p\s*\)\s*;\s*$/.exec(src)
    if (!m) return false
    /* XF_M, XF_S and XF_K are what it may set (warp() does), and the evaluator reads them back; the frames the records
       set for themselves (the local point, the material frame, the tag) it may not */
    return !/\b(C|children|return|discard|SURFACE_ONLY|READ_REACH|DIVIDED_ABOVE|LOCAL_CAPTURE|HIT_\w+|XF_(P|SUB|Q|QM|QS|STRAIGHT|TAG|RL))\b/.test(src.slice(0, m.index))
}
/** What a before group's `children(` becomes in its data function (codegen, the scene as data): the children are the
 *  records after it, walked by the evaluator, so the call hands C back as it was. Its name has an underscore where a
 *  node id has none (model.js), so no group's children function can be called this. */
export const BEFORE_PASS = 'children_data_before'

/**
 * A GROUP WHOSE CODE ONLY WORKS ON WHAT ITS CHILDREN GAVE -- the "after" kind: round and shell, and any customer code of
 * that shape. Its code, comments aside, STARTS with `var H = children(emptyHit(r), p);` (any name, var or let) and calls
 * children nowhere else; after it, it neither warps (its XF_K would have to be put back) nor names the relief's words
 * (SURFACE_ONLY, READ_REACH, DIVIDED_ABOVE: displace and the noise relief read the CSG chain above them, which only
 * codegen works out) nor returns. The scene as data walks the children into a Hit of their own, as a CSG group's shape
 * (scenedata.js AFTER), then calls the code with that Hit for its `children(...)` (AFTER_PASS) -- so editing them is
 * data, not a compile. The same exclusions as isBefore otherwise.
 */
export const isAfter = (g, { straight = true } = {}) => {
    if (!hasCode(g) || (straight && g.straightMaterial === true)) return false
    if (Object.values(g.params || {}).some(v => isProfile(v) || isPath(v))) return false
    const src = withoutComments(g.code)
    const m = /^\s*(var|let)\s+[A-Za-z_]\w*\s*=\s*children\s*\(\s*emptyHit\s*\(\s*r\s*\)\s*,\s*p\s*\)\s*;/.exec(src)
    if (!m) return false
    return !/\b(children|return|discard|warp|SURFACE_ONLY|READ_REACH|DIVIDED_ABOVE|LOCAL_CAPTURE|HIT_\w+|XF_(M|K|P|SUB|Q|QM|QS|STRAIGHT|TAG|RL))\b/.test(src.slice(m[0].length))
}
/** What an after group's `children(` becomes in its data function: the Hit its children's records folded into, which
 *  the evaluator leaves in SCN_AFTER before the call. Named as BEFORE_PASS is. */
export const AFTER_PASS = 'children_data_after'

/** The function a coded group's children are emitted as. Ids have no underscore (model.js), so
 *  no two groups can mint the same name. */
export const childrenFn = id => `children_${id}`

/** Names a group's code has in scope already -- a parameter by one of them would shadow it. */
export const GROUP_SCOPE = ['p', 'C', 'r', 'children', 'SURFACE_ONLY', 'READ_REACH', 'DIVIDED_ABOVE']

/**
 * A group's code with every call of `children(` renamed to its own children function. Skipped:
 * comments (line and block, which nest in WGSL), member access (`x.children(` is someone else's),
 * and the word anywhere it is not called. Returns the text and where it grew: { text, shifts },
 * shifts as emit.js from() takes them.
 */
export function renameChildren(code, id) {
    const src = String(code ?? '')
    const add = `_${id}`
    const word = 'children'
    const idChar = c => c !== undefined && /[A-Za-z0-9_]/.test(c)
    const shifts = {}
    let out = '', i = 0, depth = 0, line = 0, col = 0
    while (i < src.length) {
        const c = src[i], n = src[i + 1]
        if (depth === 0 && c === '/' && n === '/') {
            const nl = src.indexOf('\n', i), end = nl < 0 ? src.length : nl
            out += src.slice(i, end); col += end - i; i = end
            continue
        }
        if (c === '/' && n === '*') { depth++; out += '/*'; i += 2; col += 2; continue }
        if (depth > 0 && c === '*' && n === '/') { depth--; out += '*/'; i += 2; col += 2; continue }
        if (c === '\n') { out += c; i++; line++; col = 0; continue }
        if (depth === 0 && src.startsWith(word, i) && !idChar(src[i - 1]) && !idChar(src[i + word.length])) {
            let before = i - 1
            while (before >= 0 && (src[before] === ' ' || src[before] === '\t')) before--
            let after = i + word.length
            while (after < src.length && /\s/.test(src[after])) after++
            if (src[before] !== '.' && src[after] === '(') {
                out += word + add
                ;(shifts[line] ||= []).push({ at: col + word.length, by: add.length })
                col += word.length + add.length; i += word.length
                continue
            }
        }
        out += c; i++; col++
    }
    return { text: out, shifts }
}

/** What a group's code block starts as: comments only, so a new group costs nothing and emits
 *  exactly what it did before groups had code. */
export const GROUP_CODE_TEMPLATE = [
    '// Group code: runs at every march step, around this group\'s children.',
    '//   C = children(C, p);   evaluates them at p and folds them into C -- call it to show them',
    '//   p   the point in this group\'s frame (assign it: p = ...);  C  the Hit;  r  the ray',
    '//   your own parameters (+ in the parameters header) by name',
    '//   warp(k)  after changing p in a way that is not a plain move or turn: distances x k',
    '//            (k < 1 for a stretching warp), normals then by differences',
    '//   SURFACE_ONLY  true when nothing above reads more than where this surface is (no blend, no',
    '//            code above): away from it any lower bound on the distance will do',
    '//   READ_REACH  how far off this surface anything above reads it: 0 as SURFACE_ONLY, the',
    '//            blends\' reach in a CSG group, 1e30 under group code',
    '//   foldRelief(C, d, H.m, slope, DIVIDED_ABOVE)  a distance steepened by up to slope, folded',
    '//            in: divided by it here, or -- in a CSG group -- once, after the blend',
    '// e.g. a twist about z:',
    '//   let a = rate * p.z;',
    '//   p = VEC3(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y, p.z);',
    '//   warp(0.5);',
    '//   C = children(C, p);',
    '// e.g. rounded by 0.1, via a Hit of their own:',
    '//   var H = children(emptyHit(r), p);',
    '//   H.s.w -= 0.1 * XF_S;           // XF_S: this frame\'s units in world units',
    '//   C = fold(C, H.s, H.m);',
    '',
].join('\n')

/**
 * getMaterial2 for the document's materials: one switch case per material, each building a
 * Material2 from its uniforms and then running its code, if it has any.
 *
 * INSIDE A CASE the code sees `m` (already the parameters), `p` (the hit, world space), `n` (the
 * surface normal, world space; zero on the medium lookup), `C` (the Hit), and, only if it
 * mentions it, `p_local` (the hit in its object's frame -- a CSG group's frame for a CSG
 * shape), `R_local` (that frame's rotation to the world, for directions such as a grain) and
 * `S_local` (its scale: p_local * S_local is in scene units), and
 * its own parameters by their bare names. It changes `m`, or returns a Material2
 * of its own. Its text goes in untouched and
 * flush left, in a block of its own, and is mapped back to the material's id like a node's.
 */
function emitMaterials(e, materials, matIdOf, uniforms, wantLocal, lights = []) {
    e.raw('const MATID_DEFAULT: u32 = 1u;')
    for (const m of materials) e.raw(`const matid_${m.id}: u32 = ${matIdOf.get(m.id)}u;`)
    /* the back of a one-sided light: black, emitting nothing (see LIGHTS in emitScene) -- and CLEAR,
       a transparent light's back, which the optics trace passes through (generate's `passes`) */
    e.raw(`const MATID_BLACK: u32 = ${materials.length + 2}u;`)
    e.raw(`const MATID_CLEAR: u32 = ${materials.length + 3}u;`)
    for (const L of lights) e.raw(`const matid_${L.id}: u32 = ${L.matId}u;     // light ${L.id}`)
    e.raw('')
    /* A CLEAR SHEET: what a transparent light is to everything, its glow added for a camera path (LIGHTS) --
       a smooth dielectric with no coat (specular 0), white, fully transmissive. The index beyond it
       is asked of the scene (materials_pbr.js THE MEDIA ON EITHER SIDE), and a sheet contains
       nothing, so it is the medium the sheet sits in: n0 = n1, no bend and no Fresnel reflection.
       A ray passes straight on, in air or in the silicone an LED die is embedded in. */
    e.raw('fn clearSheet() -> Material2 {')
    e.raw('    var m = makeDefaultMaterial();')
    e.raw('    m.baseColor = vec3<f32>(1.0); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.0; m.transmission = 1.0;')
    e.raw('    return m;')
    e.raw('}')
    /* A LIGHT'S FACE AS THE CAMERA SEES IT: its luminance straight out, times the shape of its
       distribution at the angle it is seen from -- the radiance its photons carry. It used to show the
       luminance straight out from every angle: a die emitting into a 7.5-degree cone glowed at
       9e7 cd/m^2 seen from the side, where it is dark. beam is lights.js beamOf; beamShape there is
       this in JS, for the test. Only in a scene with a light, as everything of theirs here: a scene
       without one compiles to the text it always did (the golden shaders, test/fixtures/csg-v10). */
    // the lines are core's (tracebasics.js LIGHT_BEAM_LINES): shade's light table reads the same function
    if (lights.length) for (const l of LIGHT_BEAM_LINES) e.raw(l)
    e.raw('fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {')
    e.raw('    let idx = select(C.m, C.a, checkInside);')
    e.raw('    let p = C.r.pos;')
    e.raw('    let n = C.s.xyz;')
    /* THE LOCAL POINT, ONCE, BEFORE THE SWITCH -- and not on the medium lookup. localPoint() runs
       the whole scene's SDF again, and every compiler behind WebGPU inlines every call: it was in
       each material's own case, so a getMaterial2 with six patterned materials held six extra copies
       of the scene, at every one of its call sites, the medium lookups included -- which want only
       an IOR. That, and the unrolled march, made the Noise library scene compile for over a minute.
       Now one call, only for a material that reads it, only when shading. On the medium lookup the
       code sees the world point, the identity frame and scale 1: whatever it computes there, only
       the IOR is read. R_local and S_local are the same capture's (scene_api.js HIT_FRAME,
       HIT_SCALE): the object's rotation to the world, for a direction in its frame -- a grain --
       and its scale, for a pattern in real units: p_local * S_local is in scene units. */
    const localIds = wantLocal ? materials.filter(m => readsLocal(m.code)).map(m => `idx == ${matIdOf.get(m.id)}u`) : []
    if (localIds.length) {
        e.raw('    var p_local = C.r.pos;')
        e.raw('    var R_local = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);')
        e.raw('    var S_local = 1.0;')
        e.raw(`    if (!checkInside && (${localIds.join(' || ')})) {`)
        e.raw('        p_local = localPoint(C.r); R_local = HIT_FRAME; S_local = HIT_SCALE;')
        e.raw('    }')
    }
    // a light's face: its material, and which face it is plus 1 (the weight after the switch)
    if (lights.length) { e.raw('    var fm: Material2;'); e.raw('    var face = 0u;') }
    e.raw('    switch (idx) {')
    for (const mat of materials) {
        const P = mat.params || {}
        e.raw(`        case ${matIdOf.get(mat.id)}u: {     // material ${mat.id}`)
        e.raw('            var m = makeDefaultMaterial();')
        /* ONLY WHAT ITS TYPE USES is assigned (materials.js FIELDS_OF): a surface emits nothing, an
           emitter is its emission alone. Every field is declared, whatever the type. */
        const uses = new Set(FIELDS_OF[mat.type ?? 'surface'] ?? FIELDS_OF.surface)
        for (const [k, f] of Object.entries(MATERIAL_FIELDS)) {
            const name = uniformName(mat.id, k)
            /* A FIELD ONLY THERE WHILE IN USE (materials.js `only`: the colour depth): neither declared nor assigned
               otherwise -- makeDefaultMaterial's value stands -- so a scene that does not use it compiles to the text
               it always did. Its first use is a compile (demo.js live: the uniform is not declared yet). */
            if (f.only && !f.only(P[k], P)) continue
            uniforms[name] = { type: f.type, def: f.type.startsWith('vec3') ? { ...P[k] } : P[k] }
            if (k === 'emissiveLuminance' || !uses.has(k)) continue
            /* A COATING (materials.js coating, 0.39.0) is written in one call after the fields, where it is on: its
               values are declared above only then */
            if (k === 'coating' || f.coat) continue
            // the colour depth is in real mm, whatever the scene's unit: the material's side is in the scene's
            if (k === 'attenuationDistance') { e.raw(`            m.${k} = mm(UB.${name});`); continue }
            /* the colour is a hue, normalised to Y = 1 here, and the luminance carries the
               magnitude -- so the number on the panel IS the surface's cd/m^2 (materials.js) */
            if (k === 'emissive') e.raw(`            m.emissive = UB.${name} / max(dot(UB.${name}, LUMA_709), 1e-6) * UB.${uniformName(mat.id, 'emissiveLuminance')};`)
            else e.raw(`            m.${k} = UB.${name};`)
        }
        if (uses.has('coating') && hasCoating(P))
            e.raw(`            m = coatMaterial(m, ${['coating', ...COAT_FIELDS].map(k => `UB.${uniformName(mat.id, k)}`).join(', ')});`)
        /* ITS OWN PARAMETERS, the keys that are not fields: uniforms (or consts) under the same
           `<name>_<id>` scheme as a node's, put in scope for the code by the same aliases. Their
           uniforms are declared even with no code to read them, so dragging one is never a
           write to a uniform that does not exist. */
        const own = Object.fromEntries(Object.entries(P).filter(([k]) => !(k in MATERIAL_FIELDS)))
        const consts = mat.constants || {}
        for (const [k, v] of Object.entries(own)) if (!consts[k])
            if (!isCompiledIn(v)) uniforms[uniformName(mat.id, k)] = { type: wgslTypeOf(v), def: defOf(v) }
        const code = String(mat.code || '')
        if (codeOnly(code).trim()) {
            e.raw('            {')
            for (const a of aliasPrelude(mat.id, own, null, consts)) e.raw('            ' + a)
            e.from(mat.id, code)
            e.raw('            }')
        }
        e.raw('            return m;')
        e.raw('        }')
    }
    // an object with no material: what the old palette's default case gave it
    e.raw('        case 1u: { return makeDiffuse(vec3<f32>(0.8), 1.0); }')
    e.raw(`        case ${materials.length + 2}u: { return makeDiffuse(vec3<f32>(0.0), 1.0); }   // MATID_BLACK`)
    e.raw(`        case ${materials.length + 3}u: { return clearSheet(); }   // MATID_CLEAR`)
    /* A LIGHT'S FACE glows for a CAMERA PATH: at its first hit -- what the camera sees of it
       directly -- and at any later hit on a path its photons do not own. The photons (the picture
       light-traces every light: optics module, R.photonSources) connect to the camera at its first
       surface, through the lobes a connection evaluates, from air; a path whose first surface
       scattered that way carries CLS_LIGHTS (tracebasics.js, processMaterial) and the face shows it
       nothing, or that light would count twice. Every other path -- through a mirror, glass, gloss
       below LT_MIN_ALPHA, a diffuser -- is the camera's alone, and until PLAN.md L4 it saw the face
       black: a light lit nothing seen through glass, and the jump at roughness 0.224 was that
       boundary (light-vs-emitter measured both). Never for light sampling's shadow ray (TAG_EMIT),
       the emitter photons' probe (TAG_PROBE) or a photon: to those it is black, or for a
       transparent light a clear sheet. bounces is 1 at the first hit (processMaterial counts the
       bounce before it asks the material), and 0 for a ray that is no path at all (the field
       kernel's): that one sees the face as it is.
       A DIRECT PATH -- the face met at bounce 2, its first surface one a photon can connect from --
       is made by both, and which is better depends on the light's size against the lobe's width: a
       die in a narrow lobe is the photons', a panel in it the camera's. So those are shared by the
       balance heuristic (PLAN.md L4b): the camera carries all of R but the radiance (Ray.ltMis, set
       at its first surface), the face completes it, R = le ltMis, and keeps 1 / (1 + R); the photon
       keeps R / (1 + R) (materials_pbr.js ltConnect). With a hard switch at LT_MIN_ALPHA instead, a
       small light's highlight vanished just below it -- the camera found the die by chance -- and
       lit up just above: the jump the user saw, which L4 had only made right on average.
       A COLLIMATED face shows its Lambertian equivalent to the first hit alone: that is a display
       convention, and to any later path the light is a delta no camera path can meet (its photons
       own all of it, ltMis -1).
       The glow is ADDED to the face's own material, not a material of its own: a transparent face
       glows and lets the path through (lightTraced 2; materials_pbr.js, the emissive branch), and
       the index a face shows the medium probe no longer depends on whether it glows.
       The face's luminance follows its distribution (lightBeam, from the face's normal n and the
       ray), and every variant of it says it is a light's face (lightTraced): the renderer then never
       discovers it as an emitter.
       OVER n^2, the index of the medium the path meets it in (C.r.n). The face's luminance is its
       radiance in what it emits into (flux / (k A): no emitN in it, sources.js), and what survives an
       interface is radiance over n^2 -- which the refraction weights leave out, rightly for photons
       (flux) and harmlessly for a path whose ends are both in air. A camera ray starts in air
       (genrays: n 1), so a die in silicone seen through its dome is 1/1.41^2 of its luminance, not
       all of it; before L4 no camera path reached it there, and nothing needed the factor. */
    for (const L of lights) {
        const c = uniformName(L.id, 'emissive'), l = uniformName(L.id, 'emissiveLuminance'), b = uniformName(L.id, 'beam')
        uniforms[c] = { type: 'vec3<f32>', def: { ...L.colour } }
        uniforms[l] = { type: 'f32', def: L.luminance }
        uniforms[b] = { type: 'vec4<f32>', def: [...L.beam] }
        e.raw(`        case ${L.matId}u: {     // light ${L.id}`)
        e.raw(`            var m = ${L.transparent ? 'clearSheet()' : 'makeDiffuse(vec3<f32>(0.0), 1.0)'};`)
        e.raw(`            let direct = C.r.bounces == 2u && C.r.ltMis > 0.0;          // shared with its photons by MIS`)
        e.raw(`            if ((C.r.tag & (TAG_PHOTON | TAG_EMIT | TAG_PROBE)) == 0u && C.r.bounces >= 1u`)
        e.raw(`                && (C.r.bounces == 1u || ((direct || (C.r.tag & CLS_LIGHTS) == 0u) && u32(UB.${b}.x + 0.5) != 0u))) {`)
        e.raw(`                let le = UB.${l} * lightBeam(UB.${b}, dot(-C.r.dir, n)) / max(C.r.n * C.r.n, 1.0);`)
        e.raw(`                let w = select(1.0, 1.0 / (1.0 + le * C.r.ltMis), direct);`)
        e.raw(`                m.emissive = UB.${c} / max(dot(UB.${c}, LUMA_709), 1e-6) * le * w;`)
        e.raw('            }')
        e.raw(`            m.lightTraced = ${L.transparent ? 2 : 1}u;`)
        e.raw(`            fm = m; face = ${lights.indexOf(L) + 1}u;     // to the one weight below`)
        e.raw('        }')
    }
    // 0 is MAT_AIR, the medium: never shaded, asked only for its IOR, which the default has as 1
    e.raw('        default: { return makeDefaultMaterial(); }')
    e.raw('    }')
    /* ...AND WEIGHED AGAINST LIGHT SAMPLING (PLAN.md L7) past the first surface: the vertex before could
       have aimed at this point of this face, with the share there and the face's own density -- the power
       heuristic, as misWeight. ONCE, HERE, FOR EVERY FACE, and not in each face's case: the density reads
       the face's frame (lightFace, a switch over every light) and the share the sum of their weights, and
       a GPU compiler inlines all of it into every case -- code growing as the square of the number of
       lights, in every kernel that asks for a material. It was written in each case first. */
    if (lights.length) {
        e.raw('    if (any(fm.emissive != VEC3(0.0)) && C.r.bounces >= 2u && C.r.prevPdf >= 0.0) {')
        e.raw('        let pl = lightFaceDensity(lightFaceShare(C.r.bounces - 1u, C.r.tag), lightFace(face - 1u), lightFaceTotal(),')
        e.raw('                                  max(C.r.ltot - C.r.vtxLtot, 0.0) / max(C.r.n, 1e-4), dot(-C.r.dir, n));')
        e.raw('        let a = C.r.prevPdf * C.r.prevPdf;')
        e.raw('        fm.emissive = fm.emissive * (a / max(a + pl * pl, 1e-20));')
        e.raw('    }')
        e.raw('    return fm;')
    }
    e.raw('}')
}

/* THE LIGHT FACES AS LIGHT SAMPLING SEES THEM (PLAN.md L7; the LightFace struct and the stub a scene
   without lights gets are core's: tracebasics.js, uniforms.schema.js sceneConstantsWGSL). One case a
   face, in the order of the material ids, built from the SAME uniforms the SDF draws it by, so a face
   dragged, resized, re-coloured or hidden is sampled where and as it is drawn, without a word from the
   host:
     its frame, the frames above it composed root first -- a point q of a frame is R (s q) + t in its
       parent's (the inverse of xfPoint), so descending one frame T turns (M, S, t) into
       (M R_T, S s_T, t + M S t_T), and the face's own is last: centre t, axes M's columns;
     its size, the parameters its SDF reads (Ndisc's radius, Nrectangle's half width and height), times S;
     its weight, 0 unless it and everything above it are shown (live visibility) and it is not
       collimated -- a delta in direction, which nothing can aim at (its photons own it all).
   lightFaceLe is a face's radiance at an angle, its own lightBeam: what its glow shows a camera.
   THE SUM OF THE WEIGHTS AND THE PICK BY WEIGHT ARE STRAIGHT-LINE CODE, one term a light, not a loop over
   lightFace: that composes every light's frame to read one number, and a GPU compiler unrolls and
   inlines such a loop -- code growing as the square of the number of lights (the pick was that loop
   first). The weight is one expression, written once here for all four. */
function emitLightFaces(e, lights, liveVisibility) {
    const weight = L => {
        const shown = liveVisibility ? L.visChain.map(id => `UB.${visName(id)} != 0u && `).join('') : ''
        return `select(0.0, 1.0, ${shown}u32(UB.${uniformName(L.id, 'beam')}.x + 0.5) != 0u)`
    }
    e.raw(`const LIGHT_FACES: u32 = ${lights.length}u;`)
    e.raw('fn lightFaceTotal() -> f32 {')
    e.raw('    var t = 0.0;')
    for (const L of lights) e.raw(`    t += ${weight(L)};     // light ${L.id}`)
    e.raw('    return t;')
    e.raw('}')
    // u in [0, lightFaceTotal()): the face whose share of it u falls in (the last one shown, past the end)
    e.raw('fn lightFacePick(u: f32) -> u32 {')
    e.raw('    var acc = 0.0;')
    e.raw('    var last = 0u;')
    lights.forEach((L, i) => {
        e.raw(`    { let w = ${weight(L)}; if (w > 0.0) { last = ${i}u; acc += w; if (u < acc) { return ${i}u; } } }     // light ${L.id}`)
    })
    e.raw('    return last;')
    e.raw('}')
    e.raw('fn lightFace(i: u32) -> LightFace {')
    e.raw('    var f: LightFace;')
    if (lights.length) {
        e.raw('    switch (i) {')
        lights.forEach((L, i) => {
            const par = k => L.constants[k] ? wgslLiteral(L.params[k], L.constants[k]) : `UB.${uniformName(L.id, k)}`
            const c = uniformName(L.id, 'emissive'), l = uniformName(L.id, 'emissiveLuminance'), b = uniformName(L.id, 'beam')
            e.raw(`        case ${i}u: {     // light ${L.id}`)
            e.raw('            var M = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);')
            e.raw('            var S = 1.0;')
            e.raw('            var t = VEC3(0.0);')
            for (const id of L.xfChain)
                e.raw(`            { let T = UB.${xfName(id)}; t += M * (S * T[3].xyz); M = M * xfRot(T); S *= T[3].w; }`)
            e.raw('            f.centre = t; f.u = M[0]; f.v = M[1]; f.n = M[2];')
            e.raw(L.shape === 'rectangle' ? `            f.half = VEC2(${par('width')}, ${par('height')}) * (0.5 * S); f.shape = 2u;`
                                          : `            f.half = VEC2(${par('radius')}) * S; f.shape = 1u;`)
            e.raw(`            f.twoSided = ${L.twoSided ? 1 : 0}u;`)
            e.raw(`            f.le = UB.${c} / max(dot(UB.${c}, LUMA_709), 1e-6) * UB.${l};`)
            e.raw(`            f.beam = UB.${b};`)
            e.raw(`            f.weight = ${weight(L)};`)
            e.raw('        }')
        })
        e.raw('        default: {}')
        e.raw('    }')
    }
    e.raw('    return f;')
    e.raw('}')
    e.raw('fn lightFaceLe(f: LightFace, cosT: f32) -> VEC3 {')
    e.raw('    return f.le * lightBeam(f.beam, cosT);')
    e.raw('}')
}

/**
 * Turn a scene tree into a scene object.
 *
 * @param tree  model.toTree(doc): { kind: 'group', op, blend, transform?, children: [...] }, or,
 *              for the console and the older tests, a flat array of objects -- read as the
 *              children of a plain union with no transforms.
 * @returns { id, title, wgsl, uniforms, map, body, pickWgsl, tags }  -- `body` is the probe
 *          source for validate(), `wgsl` and `uniforms` are the scene contract, `map` ties
 *          generated lines back to node ids. `pickWgsl` is the same scene for the renderer's pick
 *          kernel, and `tags` names what it reports: tag n is node tags[n - 1]. See PICKING.
 *
 * HOW A TREE BECOMES ONE FUNCTION. Every node is a block. A transform is three things inside
 * its block: `let p = xfPoint(p, T)` so the children see their own frame, and XF_M / XF_S
 * (scene_api.js) multiplied by it so add_new can take what they produce back to world --
 * restored at the end of the block, so a sibling never inherits it.
 *
 * A union group simply emits its children into the scene's C: they fold in one by one. A CSG
 * group gives each child a Hit of its OWN (a `var C` shadowing the scene's), reads the shape
 * out of it, combines those with the op, and folds the result into the scene's C once, with
 * the first child's material -- the base the others are cut from or intersected with. The
 * combined value is already in world units, so it goes through fold, not add_new.
 *
 * WHAT A CSG CHILD CONTRIBUTES is the nearest surface its Hit ended up with. For one shape --
 * the normal case -- that is exactly the shape. A code node that folds several shapes into its
 * C contributes the nearest of them at each point, which is their union outside and only an
 * approximation inside; put them in a union group of their own if that matters.
 */
export function generate(tree, opts = {}) {
    /* CSG DEEPER THAN THE EVALUATOR HAS ROOM FOR (scenedata.js STACK_MAX, call 3): such a scene is made as before, and
       says why (dataRefused) -- its records would have overrun the evaluator's stack */
    let dataRefused = null
    if (opts.data && !Array.isArray(tree)) {
        const pl = planOf(tree, { reliefMaterials: new Set((tree.materials || []).filter(m => m.relief).map(m => m.id)),
                                  wantLocal: (tree.materials || []).some(m => readsLocal(m.code)) })
        const depth = pl.depth, deepArrays = pl.arrayDepth
        if (depth > STACK_MAX || deepArrays > STACK_MAX) {
            dataRefused = `${depth > STACK_MAX ? `CSG groups ${depth}` : `arrays and modifiers ${deepArrays}`} deep inside one another, and the scene as data has room for ${STACK_MAX}: compiled as before`
            console.warn(`[codegen] ${dataRefused}`)
            opts = { ...opts, data: false }
        }
    }
    const scene = emitScene(tree, { ...opts, pick: false })
    const picked = emitScene(tree, { ...opts, pick: true })
    /* THE OPTICS ROLES are the materials' (model version 10). A detector or a limiter stops the
       optics trace's rays and records them; the kernels test the hit's MATERIAL id against
       `detectors` (ids as getMaterial2 numbers them: the document's materials from 2). */
    const materials = Array.isArray(tree) ? [] : (tree.materials || [])
    const detectors = materials.map((m, i) => m.type === 'detector' || m.type === 'limiter' ? i + 2 : 0).filter(Boolean)
    /* WHAT THE OPTICS TRACE PASSES THROUGH: transparent lights, front and back (MATID_CLEAR) -- an
       LED die in its silicone does not stop the light of another */
    const passes = scene.lights.filter(L => L.transparent).map(L => L.matId)
    if (passes.length) passes.push(materials.length + 3)
    /* A LIMITER IS NOT IN THE PICTURE: the render and pick copies leave its objects out, and the
       optics trace gets copies of its own that have them -- `opticsWgsl` for its march,
       `opticsPickWgsl` (with `opticsTags`) for its shade. Without a limiter those are the render
       and pick copies themselves, so a scene without one compiles nothing extra. */
    const hasLimiter = materials.some(m => m.type === 'limiter')
    const optics = hasLimiter ? emitScene(tree, { ...opts, pick: false, optics: true }) : scene
    const opticsPicked = hasLimiter ? emitScene(tree, { ...opts, pick: true, optics: true }) : picked
    /* HOW BIG IT IS, in scene units: the renderer sizes its surface tolerance from this
       (bounds.js sceneExtent, an estimate since objects are code; photometry.js derive) */
    const extent = Array.isArray(tree) ? null : sceneExtent(tree)
    const { lights: _l, _data, ...out } = scene
    /* carryUniforms false: every uniform here is the document's own value, and its default IS that value.
       The renderer carries a value across setScene by NAME, and ids repeat between documents (o3 is in
       every scene), so the scene shown before put its o3's transform on this one's: the material test's
       ground at the optics bench's z = -10 while its parameters said -2 (the user, 2026-09-28). */
    const result = { ...out, carryUniforms: false, pickWgsl: picked.wgsl, tags: picked.tags, detectors, passes, extent,
                     opticsWgsl: optics.wgsl, opticsPickWgsl: opticsPicked.wgsl, opticsTags: opticsPicked.tags }
    /* THE SCENE AS DATA (opts.data): every copy reads the one buffer (the records are the same; the copies differ in
       SCN_PICK and SCN_OPTICS), declared as a scene resource and made by the renderer's setScene (scene.init).
       `dataOf(tree, boxes)` makes the records again for a tree of the same plan -- a value changed, a box measured --
       or null when the tree needs new text. Not enumerable: a scene is spread and compared in places. */
    if (_data) {
        /* READ-ONLY, IN EVERY KERNEL THAT READS IT (tinywebgpu: a `read ` type binds var<storage, read> wherever it is
           declared). It was read_write until 0.22.14 -- tinywebgpu's default, and no kernel named it read-only -- though
           no shader writes it: the records are written from the CPU (writeData). Measured on the user's Pascal (the
           overhead run of 0.22.12): one Menger cube as data, one record a step, marched 3.0 times codegen's, whose values
           are uniforms. Whether a read_write binding is what costs is that run's next row to say. */
        result.resources = { sceneData: 'read array<vec4<f32>>', ...(_data.uniformRecs ? { scnRecs: RECS_UNIFORM_TYPE } : {}) }
        attachData(result, _data.records, { uniformRecs: _data.uniformRecs })
        Object.defineProperty(result, 'dataOf', { enumerable: false, value: _data.dataOf })
        // ...and its blocks, which the next scene carries (generate's `carry`: a delete compiles nothing)
        Object.defineProperty(result, 'blocks', { enumerable: false, value: _data.blocks })
        Object.defineProperty(result, 'compiledIds', { enumerable: false, value: _data.compiledIds })
    }
    if (dataRefused) Object.defineProperty(result, 'dataRefused', { enumerable: false, value: dataRefused })
    /* MADE WITHOUT ITS BOUNDING BOXES (opts.cull false: a generation option the bench alone sets since 0.34.0, the
       renderer's setting `cull` before): no box test anywhere in its text, codegen's or the records' walk -- a mode of
       its own to the page's mode watcher (index.html), never the one it wants */
    if (opts.cull === false) Object.defineProperty(result, 'unculled', { enumerable: false, value: true })
    return result
}

/* PICKING. A second copy of the scene, for the renderer's pick kernel alone (core/pick.js), that
   says which node a surface belongs to. Every node's block enters a tag -- XF_TAG, one number per
   node, saved on the way in and put back on the way out like XF_M -- and fold(), with the pick
   kernel's capture on, keeps the tag of the surface that passes through the hit point, at whatever
   depth (scene_api.js). So the pick names the DEEPEST node there -- a CSG child, the object inside
   a twist -- and the host walks up the tree to whatever level it wants to select.

   A SEPARATE COPY BECAUSE OF THE COST. A tag store per node block is a store at every march step
   for every ray; emitted only here, the render kernels compile exactly the text they did before.

   WHAT IT CANNOT NAME: a surface that fails the backface test at the hit, which the capture is
   recorded behind -- the inside of a sphere cut out of a box is seen from within the sphere, so it
   names the CSG group rather than the sphere. And where a smooth blend has made a surface that is no
   single child's, the group is named, which is the honest answer. */
/* LIVE VISIBILITY (`liveVisibility`, the document's setting of that name): every node is emitted, hidden
   ones too, each inside `if (UB.vis_<id> != 0u)` -- so showing or hiding one is a uniform written, not a
   shader compiled (the user, 2026-09-28: a toggle recompiled the scene, and the library's studio compiled a
   scene per picture). The cost is a uniform branch per node at every evaluation, and hidden nodes still in
   the compile. Off, the shader is exactly what it was: disabled nodes are left out (toTree prunes them).
   IN A CSG GROUP a hidden child is ABSENT, not an empty shape: its block and its combine are skipped, and a
   runtime flag makes the first VISIBLE child the base -- an empty shape as the base of a subtraction, or
   one side of an intersection, would have emptied the whole group. */
function emitScene(tree, { id = 'built', title = 'Scene builder', pick = false, optics = false, liveVisibility = false, cull = 'dear', editing = null, data = false, carry = null, count = false } = {}) {
    /* `cull` (ONLY THE DEAR ONES below): 'dear', the builder's way since 0.34.0; 'all' and false the bench's alone. `true`
       meant every box until then, and the builder passed it -- refused rather than read as one or the other */
    if (cull !== 'dear' && cull !== 'all' && cull !== false)
        throw new Error(`codegen: cull is 'dear' (the default), 'all' or false (the bench's), not ${JSON.stringify(cull)}`)
    /* THE CANDIDATE GRID AND EXACT HITS WENT IN 0.41.0 (roadmap/ARCHITECTURE.md, Removed in 0.41.0): a caller still asking
       for them by name is refused, rather than handed a scene without them that it would time or show as with */
    const gone = ['grid', 'exact', 'listMax'].filter(k => k in (arguments[1] || {}))
    if (gone.length) throw new Error(`codegen: ${gone.join(', ')} went in 0.41.0 with the candidate grid and exact hits: not an option`)
    if (Array.isArray(tree))
        tree = { id: 'root', kind: 'group', blend: 0, csg: false,
                 children: tree.filter(n => n.enabled !== false).map(n => ({ kind: 'object', ...n })) }
    /* NO scenes/common.js ANY MORE, and so none of its twelve material-override uniforms:
       a builder scene declares exactly the materials it has. */
    const uniforms = {}
    const materials = tree.materials || []
    /* LOCAL POINTS ONLY IF SOMETHING READS ONE. Tracking the current frame's point costs a
       store per frame entered, at every SDF evaluation; a scene whose materials never say
       p_local does not pay it (see localPoint in scene_api.js). */
    const wantLocal = materials.some(m => readsLocal(m.code))
    const tags = []
    /* THE SCENE AS DATA (`data`; builder/scenedata.js): what can be data becomes records, what cannot is compiled as
       below, each such subtree a function the evaluator calls. Visibility is data, so a compiled subtree's hidden nodes
       are live too (their vis_ uniforms), as the document's liveVisibility makes them. Tags are numbered once, in tree
       order, for the records and the compiled parts alike. */
    if (data) liveVisibility = true
    const plan = data ? planOf(tree, { reliefMaterials: new Set(materials.filter(m => m.relief).map(m => m.id)), wantLocal, carry: carry || [] }) : null
    const planTag = plan ? new Map(plan.tags.map((nid, i) => [nid, i + 1])) : null
    /* a compiled subtree's tags are its own nodes' offsets from its root's, plus SCN_TAGBASE -- the root's tag, which the
       evaluator sets from its record: a node added before it must not change its text. subTag is the root's tag while
       its text is emitted -- its function, and the children functions of the coded groups inside it (subRootTag) */
    let subTag = null
    const subRootTag = new Map()
    if (plan) for (const n of plan.subs) { const t = planTag.get(n.id); const go = c => { subRootTag.set(c.id, t); (c.children || []).forEach(go) }; go(n) }
    /* Material ids: 0 is MAT_AIR, the medium; 1 is the default an object without a material
       gets; the document's materials follow in list order. Named after the model id so a
       snippet's MATERIAL alias reads as what it is. */
    const matIdOf = new Map(materials.map((m, i) => [m.id, i + 2]))
    const matConst = id => id != null && matIdOf.has(id) ? `matid_${id}` : 'MATID_DEFAULT'
    // a limiter's objects are only in the optics copies (see generate)
    const limiters = new Set(materials.filter(m => m.type === 'limiter').map(m => m.id))
    const hidden = n => !optics && n.kind === 'object' && limiters.has(n.material)
    /* LIGHTS (lights.js): each rectangle or disc light has a material id of its own, after the
       document's materials and MATID_BLACK / CLEAR, since what it looks like depends on the light,
       not on a shared material. ONE UNDER GROUP CODE IS NOT DRAWN: code can move its children anywhere
       (or evaluate them twice), and a light has to stay where its transform says -- the optics trace
       and the photons start it there (sources.js).
         ONE INSIDE A CSG GROUP IS DRAWN, at its transforms, as under a plain group (the user,
       2026-10-03). It was treated as group code until then, on the comment's word that CSG "would fold
       it into another shape" -- but a CSG combine moves nothing, it only combines its shapes, and a
       light is not one of them (shapesOf). What WAS true: anything emitted inside a shape child's
       block goes into that child's private Hit and is combined -- a light in a group that is itself
       a shape of a CSG group (OpticsBench2's laser: disc light < Laser < lensholder) would be unioned
       into the shape, or cut, or would cut. So such a light is HOISTED: emitted after the combine of
       its OUTERMOST CSG ancestor (an inner one's combine is still inside the outer's private Hit),
       in the frames of the groups between, and left out of the combine where it sits. Not drawn, it
       had no face and no rays, and nothing in the view said why. */
    const lights = []
    const warpedLights = new Set()
    /* A HOISTED LIGHT: id -> { at, through }, `at` the outermost CSG group above it, `through` the
       groups between that and the light, outermost first -- the frames and the visibility it is drawn
       in after `at`'s combine (children(), emitHoisted). hoistedAt: group id -> its lights, in order. */
    const hoistOf = new Map(), hoistedAt = new Map()
    /* xfChain, visChain: the nodes above a light whose frames it is drawn in (root first; the root has
       none) and whose visibility it needs -- light sampling (lightFace) places the face by the same
       uniforms the SDF reads, and leaves out a face that is not drawn. `above`: the groups above it,
       the root left out, outermost first. */
    const collectLights = (n, warped, xfChain = [], visChain = [], above = []) => {
        if (n.kind === 'object' && n.type === 'light' && hasFace(n.light)) {
            if (warped) warpedLights.add(n.id)
            else {
                const L = lightOf(n)
                // the face's exact colour (a negative channel outside the gamut): the display clips it
                lights.push({ id: n.id, matId: materials.length + 4 + lights.length, colour: lightRGBObject(L), luminance: L.luminance,
                              beam: beamOf(L), transparent: L.transparent, twoSided: L.twoSided, shape: L.shape,
                              xfChain: n.transform ? [...xfChain, n.id] : xfChain, visChain: [...visChain, n.id],
                              params: n.params || {}, constants: n.constants || {} })
                const at = above.findIndex(g => isCsg(g))
                if (at >= 0) {
                    hoistOf.set(n.id, { at: above[at].id, through: above.slice(at + 1) })
                    hoistedAt.set(above[at].id, [...(hoistedAt.get(above[at].id) || []), n])
                }
            }
        }
        const w = warped || (n !== tree && n.kind === 'group' && hasCode(n))
        const xf = n !== tree && n.transform ? [...xfChain, n.id] : xfChain
        const vis = n !== tree ? [...visChain, n.id] : visChain
        const up = n !== tree && n.kind === 'group' ? [...above, n] : above
        for (const c of n.children || []) collectLights(c, w, xf, vis, up)
    }
    collectLights(tree, false)
    const lightOfId = new Map(lights.map(L => [L.id, L]))
    const e = new Emit()

    /* THE ENGINE PRELUDE, the same SCENE_PRELUDE string prog_march compiles the scene after:
         `${SCENE_PRELUDE}${sceneConstantsWGSL}${scene.wgsl}`
       It used to be spelled out here piece by piece as a copy of the kernel's. Ray, Hit and
       Material2 live in it, and add_new and emptyHit since core/scene_api.js, so a probe
       without them cannot compile the scene's own getMaterial2 -- which is exactly what it did
       the first time this ran: `unresolved type 'Hit'` at a line inside SCENE_COMMON. The
       comment in validate.js claimed the probe used the same prelude; the code did not.

       It is emitted through the Emit rather than pasted in front afterwards so the line
       numbers the map records are the line numbers the compiler will report. */
    e.raw(BODY_MARKER)          // how validate() finds this body in the compiled source
    e.raw(SCENE_PRELUDE)
    /* ...AND, WITHOUT A LIGHT, THE STUB the kernels put after it (uniforms.schema.js sceneConstantsWGSL):
       the prelude's light sampling names LIGHT_FACES and the rest, which a scene with a light defines
       itself (emitLightFaces, below) and one without does not. In the prelude part, so the scene's own
       text (wgsl, from preludeLines) is what it always was. It was left out once, when a scene without
       a light stopped emitting its own: the builder's probe of every such scene failed to compile
       (validate.js; the user's console, 2026-10-01), where no kernel did. */
    if (!lights.length) e.raw(NO_LIGHT_FACES)
    const preludeLines = e.lines.length

    /* THE FUNCTIONS BLOCK: the document's own helpers, before everything that might call them.
       Mapped to 'functions' (a reserved id) so an error in it is reported at its own lines. */
    const functions = String(tree.functions || '')
    if (codeOnly(functions).trim()) e.from('functions', functions)
    emitMaterials(e, materials, matIdOf, uniforms, wantLocal, lights)
    // the faces light sampling aims at: only with a light -- without, the stub (uniforms.schema.js sceneConstantsWGSL)
    if (lights.length && data) for (const l of lightFacesWGSL(lights, (L, k) => uniformName(L.id, k))) e.raw(l)
    else if (lights.length) emitLightFaces(e, lights, liveVisibility)
    e.raw('')
    /* THE MATERIALS' RELIEFS (materials.js RELIEFS): one function each, whether anything wears it yet or not
       -- its uniforms are declared either way, as a material's own are, so dragging one is never a write to
       a uniform that is not there. Its code in a block of its own, flush left, mapped to `<id>#relief` so an
       error is reported at the relief's own lines, and once, however many objects wear it. The height comes
       back clamped to the amplitude: the step bound rests on it, so it is made true, not promised. */
    const reliefOf = new Map(materials.filter(m => m.relief).map(m => [m.id, m]))
    for (const m of reliefOf.values()) {
        const R = m.relief, params = R.params || {}, consts = R.constants || {}
        for (const [k, v] of Object.entries(params)) if (!consts[k] && !isCompiledIn(v)) uniforms[reliefName(m.id, k)] = { type: wgslTypeOf(v), def: defOf(v) }
        const A = consts.amplitude ? wgslLiteral(params.amplitude, 'f32') : `UB.${reliefName(m.id, 'amplitude')}`
        /* `world`, the scene's point in mm, only for a relief that names it (materials.js): every other keeps the
           signature, and the text, it had */
        const world = readsWorld(R.code)
        e.raw(`// the relief of material ${m.id}: its height (mm) at q (mm, in the frame of the object wearing it)${world ? ' and world (mm, the scene\'s)' : ''}, and a bound on its slope`)
        e.raw(`fn relief_${m.id}(q: VEC3${world ? ', world: VEC3' : ''}) -> vec2<f32> {`)
        e.raw('    var h = 0.0;')
        e.raw('    var slope = 0.0;')
        e.raw('    {')
        for (const a of aliasPrelude(m.id, params, null, consts, k => reliefName(m.id, k))) e.raw('    ' + a)
        e.from(reliefOwner(m.id), String(R.code || ''))
        e.raw('    }')
        e.raw(`    return vec2<f32>(clamp(h, -${A}, ${A}), max(slope, 0.0));`)
        e.raw('}')
        e.raw('')
    }
    const hasRelief = reliefOf.size > 0
    /* THE PROFILES (model.js setProfile; core/shapes.js): every code object's profile parameter compiled into a
       function of its own -- its outline's pieces as numbers, a straight chain of calls -- numbered in tree order,
       which is the same in every copy of the scene (render, pick, optics). The node's code reaches one through
       its handle (aliasPrelude) and the three functions after them: profile (the 2D distance and gradient),
       extrude and revolve (the solid, z up; revolved, an edge on the axis is no surface). Emitted only when the
       scene has a profile, so a scene without one is the text it was. Generator-owned (raw): the model refused
       any outline that would not compile, so an error here is the generator's. */
    /* EDITED IN THE PICTURE: the paths and profiles being edited there (demo.js editPoints, the overlay's Points mode),
       `'id.k'`, compiled live whatever the document says -- FORCED, so a point dragged writes uniforms, not a compile
       per mouse move -- with EDIT_SPARE points of room more, so one added writes uniforms too; compiled again as the
       document says once the editing stops. One longer than a live one may be is not forced: it stays compiled, and
       the overlay pushes it once, on release. The text is exactly the document-live text with the same room
       (codegen.test), and the scene says which were forced and each one's room, for livePointsUpdate. */
    const edited = new Set(editing || [])
    const forced = (id, k, n, max) => edited.has(`${id}.${k}`) && n <= max
    const profiles = []
    const collectProfiles = n => {
        if (n.kind === 'object') for (const [k, v] of Object.entries(n.params || {}))
            if (isProfile(v)) {
                const own = !!n.liveProfiles?.includes(k), force = !own && forced(n.id, k, v.length, LIVE_PROFILE_MAX)
                const live = own || force
                profiles.push({ kind: 'profile', id: n.id, k, fn: profileFn(n.id, k), pieces: profileOf(n.params, v),
                                live, forced: force, deps: pointNames(v),
                                room: live ? roomOf(v.length, 3, LIVE_PROFILE_MAX, edited.has(`${n.id}.${k}`)) : 0 })
            }
        for (const c of n.children || []) collectProfiles(c)
    }
    collectProfiles(tree)
    const handles = new Map(profiles.map((P, i) => [`${P.id}.${P.k}`, i]))
    /* THE PATHS (model.js setPath; core/shapes.js pathPieces, pathWGSL), collected and numbered the same way, apart
       from the profiles: a parameter is one or the other, so one lookup answers both handles */
    const paths = []
    const collectPaths = n => {
        if (n.kind === 'object') for (const [k, v] of Object.entries(n.params || {}))
            if (isPath(v)) {
                const own = v.live === true, force = !own && forced(n.id, k, v.path.length, LIVE_PATH_MAX), live = own || force
                const pieces = pathOf(n.params, v), inPicture = edited.has(`${n.id}.${k}`)
                paths.push({ kind: 'path', id: n.id, k, fn: pathFn(n.id, k), pieces, live, forced: force, deps: pathNames(v),
                             room: live ? roomOf(v.path.length, 2, LIVE_PATH_MAX, inPicture) : 0,
                             vary: inPicture || piecesVary(pieces), edited: inPicture })
            }
        for (const c of n.children || []) collectPaths(c)
    }
    collectPaths(tree)
    const pathHandles = new Map(paths.map((P, i) => [`${P.id}.${P.k}`, i]))
    const handleOf = (id, k) => handles.get(`${id}.${k}`) ?? pathHandles.get(`${id}.${k}`)
    if (profiles.length) {
        e.raw('// THE PROFILES: one function per profile parameter, then the three a node\'s code calls with its handle')
        for (const P of profiles) {
            e.raw(`// profile '${P.k}' of node ${P.id}: handle ${handles.get(`${P.id}.${P.k}`)}u${P.live ? `, live: its pieces are uniforms, room for ${P.room} points` : ''}${P.pieces.length ? '' : ', not sound as it is: nothing'}`)
            if (P.live) {
                Object.assign(uniforms, profileUniformDecls(P.id, P.k, P.pieces, P.room))
                uniforms[profileOkName(P.id, P.k)] = { type: 'f32', def: P.pieces.length ? 1 : 0 }
                e.raw(profileWGSL(P.fn, P.pieces, { operands: profileSlotOperands, guard: `UB.${profileOkName(P.id, P.k)} < 0.5`,
                                                    slots: profileSlotCount(P.room), slot: i => `UB.${profilePieceName(P.id, P.k, i)}`,
                                                    count: `UB.${profileCountName(P.id, P.k)}` }))
            } else e.raw(profileWGSL(P.fn, P.pieces))
        }
        const cases = call => profiles.map((P, i) => `        case ${i}u: { ${call(P.fn)} }`)
        e.raw('/* the outline in 2D: (gradient.xy, signed distance) at q, in the outline\'s own plane */')
        e.raw('fn profile(id: u32, q: VEC2) -> VEC3 {')
        e.raw('    switch id {')
        for (const c of cases(f => `return ${f}(q, false);`)) e.raw(c)
        e.raw('        default: { return VEC3(1.0, 0.0, 1.0e7); }')
        e.raw('    }')
        e.raw('}')
        e.raw('/* the outline in xy, extruded along z: height in all, centred on z = 0 */')
        e.raw('fn extrude(id: u32, p: VEC3, height: FLOAT) -> VEC4 {')
        e.raw('    return g2Extrude(p, profile(id, p.xy), max(0.5 * height, 0.0));')
        e.raw('}')
        e.raw('/* the outline as (radius, z), turned around the z axis; an edge on the axis is not a surface */')
        e.raw('fn revolve(id: u32, p: VEC3) -> VEC4 {')
        e.raw('    let q = VEC2(length(p.xy), p.z);')
        e.raw('    var g = VEC3(1.0, 0.0, 1.0e7);')
        e.raw('    switch id {')
        for (const c of cases(f => `g = ${f}(q, true);`)) e.raw(c)
        e.raw('        default: { }')
        e.raw('    }')
        e.raw('    return g2Revolve(p, g);')
        e.raw('}')
        e.raw('')
    }
    /* THE PATHS' FUNCTIONS: per path its closest point (_near) and its per-piece fold (_sweep), then what a node's
       code calls with a path's handle -- tube (a circle swept: rounded ends, one closest point; flat ends, the fold)
       and, when the scene has profiles, sweep (a profile swept, its ends flat). The fold asks pathCross for the
       cross-section, a circle for a tube or a profile through its dispatcher, and skips a piece whose centreline is
       farther than the cross-section reaches (a tube's radius; profileReach, a profile's farthest point from its
       origin) beyond what it already has. Emitted only when the scene has a path: a scene without one is the text it
       was. Generator-owned, as the profiles are. */
    if (paths.length) {
        e.raw("// THE PATHS: two functions per path parameter, then the ones a node's code calls with its handle")
        for (const P of paths) {
            e.raw(`// path '${P.k}' of node ${P.id}: handle ${pathHandles.get(`${P.id}.${P.k}`)}u${P.live ? `, live: its pieces are uniforms, room for ${P.room} points` : ''}${P.vary ? ', varying: a scale or twist per point' : ''}${P.pieces.length ? '' : ', not sound as it is: nothing'}`)
            if (P.live) {
                Object.assign(uniforms, pathUniformDecls(P.id, P.k, P.pieces, P.room, P.vary))
                uniforms[pathOkName(P.id, P.k)] = { type: 'f32', def: P.pieces.length ? 1 : 0 }
                e.raw(pathWGSL(P.fn, P.pieces, { operands: slotOperands, guard: `UB.${pathOkName(P.id, P.k)} < 0.5`,
                                                 slots: pathSlotCount(P.room), slot: slotUniforms(P.id, P.k, P.vary),
                                                 count: `UB.${pathCountName(P.id, P.k)}`, vary: P.vary }))
            } else e.raw(pathWGSL(P.fn, P.pieces, { vary: P.vary }))
        }
        const cases = call => paths.map((P, i) => `        case ${i}u: { ${call(P.fn)} }`)
        e.raw(`/* the cross-section swept along a path, in its frame: a circle of radius r (a tube's, prof ${CIRCLE}u)${profiles.length ? ', or a profile' : ''} */`)
        e.raw('fn pathCross(prof: u32, r: FLOAT, q: VEC2) -> VEC3 {')
        if (profiles.length) e.raw(`    if (prof != ${CIRCLE}u) { return profile(prof, q); }`)
        e.raw('    return g2Circle(q, VEC2(0.0, 0.0), r);')
        e.raw('}')
        // (a varying path's rounded tube is its own _tube: round cones, its radius scaled -- core/shapes.js pathWGSL vary)
        e.raw('/* a tube of the radius along the path; rounded > 0.5 rounds its ends (a ball at each), else they are flat */')
        e.raw('fn tube(id: u32, p: VEC3, radius: FLOAT, rounded: FLOAT) -> VEC4 {')
        e.raw('    let r = max(radius, 0.0);')
        e.raw('    if (rounded > 0.5) {')
        // the closest point only for a path that has one: with every path varying, every case returns, and the
        // return after the switch was unreachable -- Tint warned of it in every kernel (the user, 2026-10-02)
        const near = paths.some(P => !P.vary)
        if (near) e.raw('        var A = pnStart();')
        e.raw('        switch id {')
        paths.forEach((P, i) => e.raw(`            case ${i}u: { ${P.vary ? `return ${P.fn}_tube(p, r);` : `A = ${P.fn}_near(p);`} }`))
        e.raw('            default: { return VEC4(0.0, 0.0, 1.0, 1.0e7); }')
        e.raw('        }')
        if (near) e.raw('        return VEC4(safeDir(p - A.c, A.n), sqrt(A.d2) - r);')
        e.raw('    }')
        e.raw('    switch id {')
        for (const c of cases(f => `return ${f}_sweep(p, ${CIRCLE}u, r, r);`)) e.raw(c)
        e.raw('        default: { return VEC4(0.0, 0.0, 1.0, 1.0e7); }')
        e.raw('    }')
        e.raw('}')
        if (profiles.length) {
            e.raw('/* how far a profile reaches from its origin: no point of its outline is farther (core/shapes.js profileReachOf) */')
            e.raw('fn profileReach(id: u32) -> FLOAT {')
            e.raw('    switch id {')
            profiles.forEach((P, i) => e.raw(`        case ${i}u: { return ${P.live ? `UB.${profileReachName(P.id, P.k)}` : wgslLiteral(profileReachOf(P.pieces), 'f32')}; }`))
            e.raw('        default: { return 0.0; }')
            e.raw('    }')
            e.raw('}')
            e.raw("/* a profile swept along the path, its ends flat: the outline's x along the path's N, its y along B */")
            e.raw('fn sweep(id: u32, outline: u32, p: VEC3) -> VEC4 {')
            e.raw('    let e = profileReach(outline);')
            e.raw('    switch id {')
            for (const c of cases(f => `return ${f}_sweep(p, outline, 0.0, e);`)) e.raw(c)
            e.raw('        default: { return VEC4(0.0, 0.0, 1.0, 1.0e7); }')
            e.raw('    }')
            e.raw('}')
        }
        e.raw('')
    }
    /* THE MATERIAL FRAME (model.js setStraightMaterial): under a group with code marked straightMaterial, the
       materials of everything inside are laid out as if no group from there down had bent space -- a print's
       layers level while its shape twists. A ROOT is such a group with none above it; below one, every
       transform moves a second point (XF_Q, with its rotation XF_QM and true scale XF_QS: scene_api.js) as it
       moves p, and nothing else does -- a warp is code on p, which cannot be run on a second point. The
       material code's local point (XF_P) and a relief read that point; the shape still reads p. Emitted only
       when there is a root and something reads a material's frame (a p_local, or a relief): every other scene
       is the text it was. */
    const straightRoot = new Set(), straightIn = new Set()
    const markStraight = (n, inside) => {
        if (inside) straightIn.add(n.id)
        if (n.kind !== 'group') return
        const root = !inside && n !== tree && hasCode(n) && n.straightMaterial === true
        if (root) straightRoot.add(n.id)
        for (const c of n.children || []) markStraight(c, inside || root)
    }
    if (!Array.isArray(tree)) markStraight(tree, false)
    const straight = straightRoot.size > 0 && (wantLocal || hasRelief)
    // an array's copy is in its group's material frame (group(): its pseudo-node names the group)
    const inStraight = n => straight && straightIn.has((n.inStraightOf ?? n).id)
    /* XF_K, the warps' step factors, is kept right wherever something reads it: a relief (its true scale), or
       the material frame (XF_QS starts as XF_S / XF_K). warp() multiplies it whatever the scene; it is saved,
       put back and reset only here. */
    const keepK = hasRelief || straight

    const pad = d => '    '.repeat(d)
    const line = (d, text) => e.raw(pad(d) + text)

    /* Enter a node's frame: its point, and the transform add_new applies on the way out. The
       saved XF is named after the node so nested blocks never shadow each other's. */
    /* `T`: the transform's expression when it is not the node's own uniform -- an array's copy (group(), below), entered
       exactly as a transform is, under a name of its own */
    const enter = (d, n, T = null) => {
        if (!n.transform && !T) return
        if (!T) {
            T = `UB.${xfName(n.id)}`
            uniforms[xfName(n.id)] = { type: 'mat4x4<f32>', def: matrixOf(n.transform) }
        }
        line(d, `let p = xfPoint(p, ${T});`)
        line(d, `let xfm_${n.id} = XF_M; let xfs_${n.id} = XF_S;`)
        line(d, `XF_M = XF_M * xfRot(${T}); XF_S = XF_S * ${T}[3].w;`)
        if (inStraight(n)) {
            // the material frame moves with the transform, and not with any warp
            line(d, `let xfq_${n.id} = XF_Q; let xfqm_${n.id} = XF_QM; let xfqs_${n.id} = XF_QS;`)
            line(d, `XF_Q = xfPoint(XF_Q, ${T}); XF_QM = XF_QM * xfRot(${T}); XF_QS = XF_QS * ${T}[3].w;`)
        }
        if (wantLocal) line(d, `let xfp_${n.id} = XF_P; XF_P = ${inStraight(n) ? 'XF_Q' : 'p'};`)
    }
    /* The pick copy's tag: entered first thing in a node's block, put back last thing. */
    const tagIn = (d, n) => {
        if (!pick) return
        if (planTag && subTag === null) throw new Error(`[codegen] node ${n.id} emitted outside a compiled subtree of the data plan`)
        const t = !planTag ? `${(tags.push(n.id), tags.length)}u` : `SCN_TAGBASE + ${planTag.get(n.id) - subTag}u`
        line(d, `let xft_${n.id} = XF_TAG; XF_TAG = ${t};`)
    }
    const tagOut = (d, n) => { if (pick) line(d, `XF_TAG = xft_${n.id};`) }
    const leave = (d, n, T = null) => {
        if (!n.transform && !T) return
        line(d, `XF_M = xfm_${n.id}; XF_S = xfs_${n.id};`)
        if (inStraight(n)) line(d, `XF_Q = xfq_${n.id}; XF_QM = xfqm_${n.id}; XF_QS = xfqs_${n.id};`)
        if (wantLocal) line(d, `XF_P = xfp_${n.id};`)
    }

    const object = (d, node) => {
        const type = NODE_TYPES[node.type]
        if (!type) { line(d, `// node ${node.id}: unknown type '${node.type}'`); return }

        const params = { ...type.params, ...(node.params || {}) }
        const constants = node.constants || {}
        for (const [k, v] of Object.entries(params)) if (!constants[k] && !isCompiledIn(v))
            /* NO `gui`. With one, the host's Scene page drew a slider for every node
               parameter -- a second editor that wrote the uniform and never the document, so
               a scene tuned there saved as it was before. The builder's own panel edits the
               document and pushes the value here (BUILDER.live). */
            uniforms[uniformName(node.id, k)] = { type: wgslTypeOf(v), def: defOf(v) }

        /* MATERIAL BY ID, not by display label. The old builder looked materials up by the
           name shown in its tree, so renaming one in the UI silently rebound every object
           using it. An id is what the engine carries in Hit.m anyway. */
        const material = matConst(node.material)
        /* LEFT OUT, BUT ITS UNIFORMS DECLARED: every copy of the scene shares one uniform set, and
           the builder writes an object's parameters and transform whether or not it is drawn --
           tinywebgpu refuses a name the pipeline does not declare. A limiter outside the optics
           copies, a ray file (no geometry), a light that cannot be drawn where it says. */
        const L = node.type === 'light' ? lightOfId.get(node.id) : null
        if (hidden(node) || (node.type === 'light' && !L) || node.type === 'export' || node.type === 'haze') {
            if (node.transform) uniforms[xfName(node.id)] = { type: 'mat4x4<f32>', def: matrixOf(node.transform) }
            const why = node.type === 'export' ? 'an export box: draws nothing'
                : node.type === 'haze' ? 'a haze box: draws nothing (the renderer\'s dust, scene.haze)'
                : node.type !== 'light' ? 'an optics limiter, not in the picture'
                : warpedLights.has(node.id) ? 'a light inside group code: not drawn' : 'a ray file: no geometry'
            line(d, `// node ${node.id} (${node.type}): ${why}`)
            return
        }
        /* A HOISTED LIGHT MET INSIDE A COMBINE (collectLights): here it would be folded into a shape child's own Hit.
           It is drawn after the combine of `at` instead (emitHoisted), where its uniforms are declared. */
        if (L && hoistOf.has(node.id) && !hoisting) {
            line(d, `// node ${node.id} (light): drawn after the combine of group ${hoistOf.get(node.id).at}, not one of its shapes`)
            return
        }
        /* A LIGHT'S FACE (lights.js): a sheet with the light's own material -- black behind unless
           two-sided, chosen by the side of the sheet the point is on (p is the node's own frame
           here), and a transparent one's back clear. A material per face, rather than a test in the
           shader's emitter code, because every place that meets a surface already asks the material. */
        if (L) {
            const back = L.transparent ? 'MATID_CLEAR' : 'MATID_BLACK'
            const matExpr = L.twoSided ? `matid_${L.id}` : `select(${back}, matid_${L.id}, p.z >= 0.0)`
            const shape = L.shape === 'rectangle' ? 'Nrectangle(p, VEC2(width, height) * 0.5)' : 'Ndisc(p, radius)'
            line(d, `// node ${node.id} (light, ${L.shape})`)
            line(d, '{')
            tagIn(d + 1, node)
            enter(d + 1, node)
            line(d + 1, '{')
            for (const a of aliasPrelude(node.id, params, matExpr, constants, undefined, k => handleOf(node.id, k))) line(d + 2, a)
            line(d + 2, `C = add_new(C, ${shape}, MATERIAL);`)
            line(d + 1, '}')
            leave(d + 1, node)
            tagOut(d + 1, node)
            line(d, '}')
            return
        }

        /* A BLOCK FOR THE FRAME, AND ONE INSIDE IT FOR THE USER. The outer declares the
           transformed p; the inner holds the aliases and the snippet, so a snippet that says
           `let p = ...` shadows rather than redeclares, exactly as it could before transforms.
           Aliases scope two nodes' `radius` apart, and the snippet goes in UNTOUCHED and
           UNINDENTED -- the line and the column the error report quotes are the ones the user
           typed. (It used to be indented by eight spaces, and every column was eight off.) */
        const relief = reliefOf.get(node.material)
        line(d, `// node ${node.id} (${node.type})${relief ? `, with the relief of material ${relief.id}` : ''}`)
        line(d, '{')
        tagIn(d + 1, node)
        enter(d + 1, node)
        if (!relief) {
            line(d + 1, '{')
            for (const a of aliasPrelude(node.id, params, material, constants, undefined, k => handleOf(node.id, k))) line(d + 2, a)
            e.from(node.id, type.body(node))
            line(d + 1, '}')
        } else {
            /* ITS MATERIAL'S RELIEF, around it: the object into a Hit of its own (XF_SUB up, as a CSG child's,
               so the local point is not recorded for a surface that is not the scene's), its height added,
               then folded in -- before leave(), so a local point recorded for it is the object's own.
                 IN REAL MILLIMETRES: q is the point in the object's frame times its TRUE scale (XF_S / XF_K:
               a warp's step factor is no size) per mm; the height back in the distance's own units (times
               XF_K), and the distance divided by 1 + its slope. The normal by differences (zero xyz).
                 SKIPPED FAR FROM THE SURFACE: beyond two amplitudes, d - amplitude (towards zero, inside or
               out) is already a safe distance, since the height never exceeds it -- the noise is paid only
               near the surface.
                 IN A CSG CHAIN (reliefChain, above group()): the band is wider by 5/4 of every blend that reads it, and
               foldRelief (scene_api.js) folds the distance in undivided, the chain's outermost group dividing its
               result once by the steepest slope (XF_RL). Every input to a blend at or below its true value, and
               smin no steeper than its steepest input: once divided, still a safe distance, and the fillet the
               blend it was set to, the relief on it. A hard op's reach is 0, so its band is the one above. A pick
               still finds the object: foldRelief tags it at its own slope. */
            const s = `rs_${node.id}`, sm = `rm_${node.id}`, a = `ra_${node.id}`
            const chain = reliefChain.get(node.id)
            const reach = chain && reachOf(chain) !== '0.0' ? ` + ${reachOf(chain)}` : ''
            line(d + 1, `var ${s} = VEC4(0.0, 0.0, 1.0, 1.0e7); var ${sm} = MAT_AIR;`)
            line(d + 1, '{')
            line(d + 2, 'var C = emptyHit(r);     // this object alone: its relief goes on before it folds in')
            if (wantLocal) line(d + 2, 'XF_SUB += 1u;')
            line(d + 2, '{')
            for (const x of aliasPrelude(node.id, params, material, constants, undefined, k => handleOf(node.id, k))) line(d + 3, x)
            e.from(node.id, type.body(node))
            line(d + 2, '}')
            if (wantLocal) line(d + 2, 'XF_SUB -= 1u;')
            line(d + 2, `${s} = C.s; ${sm} = C.m;`)
            line(d + 1, '}')
            const A = relief.relief.constants?.amplitude ? wgslLiteral(relief.relief.params.amplitude, 'f32') : `UB.${reliefName(relief.id, 'amplitude')}`
            line(d + 1, `let ${a} = mm(${A}) * XF_K;`)
            line(d + 1, `if (abs(${s}.w) > 2.0 * ${a}${reach}) { C = fold(C, VEC4(0.0, 0.0, 0.0, ${s}.w - sign(${s}.w) * ${a}), ${sm}); }`)
            // under a straight group, the relief reads the material frame's point: layers level on a twisted shape
            const at = inStraight(node) ? 'XF_Q * XF_QS' : 'p * (XF_S / XF_K)'
            /* ...and the scene's point, where the relief reads it: the ray's own position, which SDF and every
               children function evaluate at (r in scope in both), whatever frame or warp the object is in */
            const world = readsWorld(relief.relief.code) ? ', r.pos / mm(1.0)' : ''
            line(d + 1, `else { let hs = relief_${relief.id}(${at} / mm(1.0)${world}); C = foldRelief(C, ${s}.w - mm(hs.x) * XF_K, ${sm}, 1.0 + hs.y, ${!!chain}); }`)
        }
        leave(d + 1, node)
        tagOut(d + 1, node)
        line(d, '}')
    }

    /* A group's children, into the C in scope: one by one for a plain union, combined into one
       shape first for CSG. Emitted inline in the group's block, or -- for a group with code --
       as the body of its children function. */
    const children = (d, g) => {
        const kids = g.children || []
        if (!isCsg(g)) {
            for (const c of kids) node(d, c)
            return
        }
        /* AN EXPORT BOX IS NOT A CHILD OF THE SHAPE. It emits nothing but its uniforms, and as a CSG
           child it would still be combined -- as an empty Hit, 1e7 away, which an intersect takes
           as the result and so deletes the group's whole shape. Emitted for its uniforms, then left
           out of the combine. NOR IS A LIGHT, which was combined the same way until 2026-09-30 (as the
           base it emptied the group): it is drawn after the combine, outside it (collectLights,
           emitHoisted) -- the ones this group is the outermost CSG group of, from anywhere below it.
           One hoisted to an outer CSG group, or under group code (not drawn), is left where it is.
           A LIMITER'S OBJECT STAYS IN, as the empty shape the picture leaves it as (`hidden`): as the
           base it makes the group a limiter -- a plate with a hole cut from it is a limiter aperture --
           and the picture must then show none of it, which an empty base gives (codegen.test). */
        const shape = shapesOf(g)
        for (const c of kids) if (!shape.includes(c) && hoistOf.get(c.id)?.at !== g.id) node(d, c)
        uniforms[blendName(g.id)] = { type: 'f32', def: g.blend }
        const k = `k_${g.id}`, km = `km_${g.id}`
        /* EACH CHILD'S JOIN (model version 14): its op, and its own blend if it has one, else the
           group's. Every own blend is declared, the base's too -- it is dormant while that child is
           first, but a live write to it must find a uniform, and under live visibility a hidden base
           makes the next child the first. */
        for (const c of shape) if (c.joinBlend != null) uniforms[joinBlendName(c.id)] = { type: 'f32', def: c.joinBlend }
        const blendOf = c => `UB.${c.joinBlend != null ? joinBlendName(c.id) : blendName(g.id)}`
        line(d, `var ${k} = VEC4(0.0, 0.0, 1.0, 1.0e7);`)
        line(d, `var ${km} = MAT_AIR;`)
        /* the top of a CSG chain with a relief in it (reliefChain): XF_RL collects the steepest relief folded in below
           (foldRelief), the result is divided by it once, and it is put back for a chain this one is inside */
        const top = reliefTops.has(g.id)
        if (top) line(d, `let xfrl_${g.id} = XF_RL; XF_RL = 1.0;`)
        const first = `first_${g.id}`
        if (liveVisibility) line(d, `var ${first} = true;`)
        const combine = (dd, c) => {
            /* the material of whichever shape makes the surface there, by the same test the join's csg* function
               picks its side by: a union's nearer, an intersection's farther, a subtraction's cutter where -C.s
               is the farther. Before 0.57.2 only a union switched, so a subtraction's carved walls kept the base's
               material (the die's pips in combining-shapes came out white). Hard at the middle of a blend. */
            line(dd, `${km} = select(${km}, C.m, ${MAT_WINS[joinOf(c)](k)});`)
            line(dd, `${k} = ${CSG_FN[joinOf(c)]}(${k}, C.s, ${blendOf(c)});`)
        }
        shape.forEach((c, i) => {
            // live: the whole child skipped when hidden -- absent, not an empty shape (see emitScene)
            line(d, liveVisibility ? `if (${visDecl(c)}) {` : '{')
            line(d + 1, 'var C = emptyHit(r);     // this child alone')
            if (wantLocal) line(d + 1, 'XF_SUB += 1u;')
            emitNode(d + 1, c)
            if (wantLocal) line(d + 1, 'XF_SUB -= 1u;')
            if (liveVisibility) {
                line(d + 1, `if (${first}) { ${k} = C.s; ${km} = C.m; ${first} = false; } else {`)
                /* THE BASE'S else IS NEVER TAKEN: first is still true when the first child comes. Written
                   with the join of the child after it, so a version 10 group -- whose op was every
                   child's -- keeps exactly the text it had (test/fixtures/csg-v10). */
                combine(d + 2, i === 0 && shape[1] ? { ...c, join: shape[1].join } : c)
                line(d + 1, '}')
            } else if (i === 0) {
                line(d + 1, `${k} = C.s; ${km} = C.m;`)
            } else combine(d + 1, c)
            line(d, '}')
        })
        /* Already world-space: every child went through its own transform on the way in. Folded
           BEFORE leaving the group's frame, so a local point recorded for it is the group's. */
        if (!top) line(d, `C = fold(C, ${k}, ${km});`)
        else {
            /* ...undivided in a normal's look (scene_api.js NORMAL_LOOK): the normal reads the direction alone, and the
               division jumps where a relief's band ends. Not under code, its own or above it: that reads the value off
               the surface, where the division is part of the shape. */
            const rl = hasCode(g) || codeAbove.has(g.id) ? 'XF_RL' : 'select(XF_RL, 1.0, NORMAL_LOOK)'
            line(d, `C = fold(C, VEC4(${k}.xyz, ${k}.w / ${rl}), ${km});`)
            line(d, `XF_RL = xfrl_${g.id};`)
        }
        // ...and then its lights, into the same C the combine went into, in this group's frame
        for (const n of hoistedAt.get(g.id) || []) emitHoisted(d, n)
    }

    /* A HOISTED LIGHT (collectLights), after its outermost CSG group's combine: the groups between entered
       for their frames alone -- each a block of its own, behind its visibility when that is live, and no
       tag (the light tags itself, and the pick walks up from it) -- then the light, as any light is drawn.
       Its world frame is the same chain of xf_ uniforms as where it sits, which is what lightFace composes. */
    let hoisting = false
    const emitHoisted = (d, n) => {
        const { through } = hoistOf.get(n.id)
        line(d, `// light ${n.id}, from inside the combine: drawn in its own frames, not one of the shapes`)
        let dd = d
        for (const g of through) {
            line(dd, liveVisibility ? `if (${visDecl(g)}) {     // group ${g.id}` : `{     // group ${g.id}`)
            enter(dd + 1, g)
            dd++
        }
        hoisting = true
        node(dd, n)
        hoisting = false
        for (const g of [...through].reverse()) {
            leave(dd, g)
            dd--
            line(dd, '}')
        }
    }

    /* A group's own parameters: uniforms (or consts) under the same `<name>_<id>` scheme as an
       object's, declared whether or not the code reads them -- so dragging one is never a write
       to a uniform that does not exist, as with a material's. */
    const groupParams = g => {
        const params = g.params || {}, constants = g.constants || {}
        for (const [k, v] of Object.entries(params)) if (!constants[k])
            if (!isCompiledIn(v)) uniforms[uniformName(g.id, k)] = { type: wgslTypeOf(v), def: defOf(v) }
        return aliasPrelude(g.id, params, null, constants)
    }

    /* SURFACE_ONLY: does anything above a group read more of its field than where its surface is? Its code
       may then give any lower bound away from the surface -- the noise relief skips its noise there
       (modifiers.js) -- and the picture cannot tell. A plain union or the root keeps the nearest by |d|, a
       hard CSG op (blend 0) keeps a child's surface and sign where it wins: surface only. A smooth blend
       reads a child's values up to its blend away from it, and group code can do anything with them (a
       round offsets to another level of the field; a relief over a relief reads the inner's at its own
       height): a relief skipping its noise under either would change the shape. Uniform: a CSG blend is
       live, so the test is the blend's value, not the document's. Emitted only into code that names it,
       so every other shader is the text it was. */
    const surfaceOnly = new Map()
    const readers = (n, above) => {
        if (n.kind !== 'group') return
        if (n !== tree) surfaceOnly.set(n.id, above.includes('false') ? 'false' : above.join(' && ') || 'true')
        /* under a CSG group every blend in play: the group's, and each own join blend it declares */
        const blends = n => [`UB.${blendName(n.id)} <= 0.0`,
            ...shapesOf(n).filter(c => c.joinBlend != null).map(c => `UB.${joinBlendName(c.id)} <= 0.0`)]
        const mine = n === tree ? [] : hasCode(n) ? ['false'] : isCsg(n) ? blends(n) : []
        for (const c of n.children || []) readers(c, [...above, ...mine])
    }
    readers(tree, [])

    /* A RELIEF IN A CSG CHAIN (object(), group() and children() use it): the CSG groups above a node, through plain
       groups, up to the first group with code or the root -- outermost first. A smooth blend reads a child's field up
       to 5/4 of its blend away from that child's own surface (csgUnion, scene_api.js: min - h^2/4k, h nonzero only
       within k of the other child), which is where the fillet is; a relief skipped there left the fillet bare. And a
       division by 1 + slope inside the blend made the fillet wrong: smin(x/c, y/c, k) is smin(x, y, k c) / c. So in a
       chain a relief's band is wider by 5/4 of every blend above, and its distance goes in undivided (foldRelief,
       scene_api.js), the chain's outermost group dividing its result once by the steepest slope, XF_RL.
         WHO DEFERS: an object wearing a material's relief; a group whose code passes DIVIDED_ABOVE to foldRelief (the
       noise relief and displace modifiers) -- its code runs in its parent's scope, so it is in its parent's chain.
         Group code ends a chain: it may offset or scale the field (a round, a warp), so how far up it reads is not
       known, and below it a relief is wrapped as one outside any CSG; a group's READ_REACH is unbounded with code
       anywhere above it, as SURFACE_ONLY is false. A coded CSG group starts a chain of its own: its code reads only
       its combined result. */
    const reliefChain = new Map(), reliefTops = new Set(), groupChain = new Map(), codeAbove = new Set()
    /* A link of a chain: a CSG group, and the blends that read the child the chain goes through -- that child's own
       join and every one after it (model version 14: each child joins what is above it, in order), since each join
       reads the running result up to its blend away and the next reads that. The base is read by every join. */
    const linkOf = (g, c) => {
        const shape = shapesOf(g), i = shape.indexOf(c)
        return { g, reads: shape.slice(Math.max(i, 1)).map(x => `UB.${x.joinBlend != null ? joinBlendName(x.id) : blendName(g.id)}`) }
    }
    const reachOf = chain => {
        // a blend read by several joins (the group's, the default) counts for each: n x, written once
        const count = new Map()
        for (const b of chain.flatMap(l => l.reads)) count.set(b, (count.get(b) || 0) + 1)
        const terms = [...count].map(([b, n]) => n > 1 ? `${n}.0 * ${b}` : b)
        return !terms.length ? '0.0' : `1.25 * ${terms.length > 1 ? `(${terms.join(' + ')})` : terms[0]}`
    }
    const wrapped = n => n.kind === 'object' && reliefOf.has(n.material) && NODE_TYPES[n.type]
        && !hidden(n) && n.type !== 'light' && n.type !== 'export' && n.type !== 'haze'
    const chains = (n, chain, coded) => {
        if (n.kind !== 'group') {
            if (chain.length && wrapped(n)) { reliefChain.set(n.id, chain); reliefTops.add(chain[0].g.id) }
            return
        }
        if (n !== tree) {
            groupChain.set(n.id, chain)
            if (coded) codeAbove.add(n.id)
            if (chain.length && hasCode(n) && /\bDIVIDED_ABOVE\b/.test(codeOnly(n.code))) reliefTops.add(chain[0].g.id)
        }
        for (const c of n.children || []) {
            const next = n === tree ? [] : hasCode(n) ? (isCsg(n) ? [linkOf(n, c)] : []) : isCsg(n) ? [...chain, linkOf(n, c)] : chain
            chains(c, next, coded || (n !== tree && hasCode(n)))
        }
    }
    if (!Array.isArray(tree)) chains(tree, [], false)

    const group = (d, g) => {
        const coded = hasCode(g)
        const aliases = groupParams(g)
        if (coded && /\bSURFACE_ONLY\b/.test(codeOnly(g.code)))
            aliases.push(`let SURFACE_ONLY = ${surfaceOnly.get(g.id)};     // true: nothing above reads more than its surface`)
        // ...and how far it does, and whether a CSG group above divides a relief's distance (foldRelief): above
        if (coded && /\bREAD_REACH\b/.test(codeOnly(g.code))) {
            const chain = groupChain.get(g.id) ?? []
            aliases.push(`let READ_REACH = ${codeAbove.has(g.id) ? '1.0e30' : chain.length ? reachOf(chain) : '0.0'};     // how far off its surface anything above reads it`)
        }
        if (coded && /\bDIVIDED_ABOVE\b/.test(codeOnly(g.code)))
            aliases.push(`let DIVIDED_ABOVE = ${(groupChain.get(g.id)?.length ?? 0) > 0};     // true: a CSG group above divides by the slope, once`)
        line(d, `// group ${g.id} (${isCsg(g) ? joinNote(g) : 'union'}${coded ? ', code' : ''}${g.copies ? `, ${g.copies.length} copies` : ''})`)
        line(d, '{')
        tagIn(d + 1, g)
        enter(d + 1, g)
        if (!coded && g.copies) {
            /* AN ARRAY (model.js copies): its children ONCE in the text, in a loop over its copies -- each a transform
               entered as a node's is, from a uniform of its own (picked by a switch: uniforms are not arrays). A plain
               group's: its children fold into C at each copy, a union of them all. */
            // its names with an underscore no node id has (model.js ID), so none can be another node's
            const K = g.copies.length, c = `ci_${g.id}`, pseudo = { id: `${g.id}_c`, inStraightOf: g }
            g.copies.forEach((t, i) => { uniforms[copyName(g.id, i)] = { type: 'mat4x4<f32>', def: matrixOf(t) } })
            line(d + 1, `for (var ${c} = 0u; ${c} < ${K}u; ${c} = ${c} + 1u) {`)
            line(d + 2, `var T_${g.id}: mat4x4<f32>;`)
            line(d + 2, `switch ${c} {`)
            g.copies.forEach((_, i) => line(d + 3, `case ${i}u: { T_${g.id} = UB.${copyName(g.id, i)}; }`))
            line(d + 3, 'default: { }')
            line(d + 2, '}')
            enter(d + 2, pseudo, `T_${g.id}`)
            children(d + 2, g)
            leave(d + 2, pseudo, `T_${g.id}`)
            line(d + 1, '}')
        }
        else if (!coded) children(d + 1, g)
        else {
            /* warp() changes XF_M and XF_S; they are put back here whether or not the group has a
               transform of its own for leave() to restore -- the root's children always do, but a
               promise that holds only because every caller happens to keep it is how this repo's
               worst bugs started. */
            line(d + 1, `let xfmc_${g.id} = XF_M; let xfsc_${g.id} = XF_S;${keepK ? ` let xfkc_${g.id} = XF_K;` : ''}`)
            /* A STRAIGHT ROOT: the material frame starts here, as this group's frame is before its code bends it */
            const root = straight && straightRoot.has(g.id)
            if (root) {
                line(d + 1, `let xfq_${g.id} = XF_Q; let xfqm_${g.id} = XF_QM; let xfqs_${g.id} = XF_QS; let xfst_${g.id} = XF_STRAIGHT;`)
                line(d + 1, 'XF_Q = p; XF_QM = XF_M; XF_QS = XF_S / XF_K; XF_STRAIGHT = true;     // its materials straight from here down')
            }
            line(d + 1, '{')
            // a var, so the code can assign it; the aliases and the code in a block of their own
            line(d + 2, 'var p = p;')
            for (const a of aliases) line(d + 2, a)
            const { text, shifts } = renameChildren(g.code, g.id)
            e.from(g.id, text, 1, shifts)
            line(d + 1, '}')
            // XF_K with them when a relief reads it: a warp's factor must not outlive the group
            line(d + 1, `XF_M = xfmc_${g.id}; XF_S = xfsc_${g.id};${keepK ? ` XF_K = xfkc_${g.id};` : ''}`)
            if (root) line(d + 1, `XF_Q = xfq_${g.id}; XF_QM = xfqm_${g.id}; XF_QS = xfqs_${g.id}; XF_STRAIGHT = xfst_${g.id};`)
        }
        leave(d + 1, g)
        tagOut(d + 1, g)
        line(d, '}')
    }

    const emitNode = (d, n) => n.kind === 'group' ? group(d, n) : object(d, n)
    const visDecl = n => { uniforms[visName(n.id)] = { type: 'u32', def: n.enabled === false ? 0 : 1 }; return `UB.${visName(n.id)} != 0u` }
    const node = (d, n) => {
        // a hoisted light where it sits is a comment: nothing to put behind its visibility
        if (!liveVisibility || (hoistOf.has(n.id) && !hoisting)) return emitNode(d, n)
        line(d, `if (${visDecl(n)}) {`)
        emitNode(d + 1, n)
        line(d, '}')
    }

    /* EVERY CODED GROUP'S CHILDREN FUNCTION, before SDF. Each subtree is emitted exactly once --
       inline in SDF, or in the function of the nearest coded group above it -- and a coded group
       inside another is a call from its parent's function to its own, never a cycle, so WGSL's
       ban on recursion is never met. `r` is the ray the Hit carries, for a CSG child's emptyHit. */
    /* As data, only those inside a compiled subtree: a before group outside one is a record, its children records too,
       and its code a function of its own (bef_<k>, below) */
    const coded = []
    const collect = n => { if (n.kind !== 'group') return; if (n !== tree && hasCode(n) && (!plan || subRootTag.has(n.id))) coded.push(n); (n.children || []).forEach(collect) }
    collect(tree)
    for (const g of coded) {
        subTag = plan ? subRootTag.get(g.id) ?? null : null
        /* THE LOCAL POINT UNDER GROUP CODE (a scene whose materials read p_local), as the scene as data has it, so the
           two agree and such a group can be data there too (0.22.0: before it, every copy of a lens assembly's shell was
           code of its own, roadmap/ARCHITECTURE.md step 4):
             a before group's children (a twist, a bend, a repeat, a mirror) are in the frame its code hands them -- a
             child with no transform of its own read the point from BEFORE the warp, one with a transform the point after
             it, and the records give every child the point after it. Not where the material frame is straight: there the
             point is XF_Q, which no warp moves.
             an after group's children (a round, a shell) are a Hit of their own, which the code folds in itself -- as a
             CSG child's, nothing in it is the scene's surface (XF_SUB). Uncounted, a surface inside one that won there
             but not in the scene left its local point on the scene's winner. */
        const straightHere = straight && (straightRoot.has(g.id) || straightIn.has(g.id))
        const localIn = wantLocal && !straightHere && isBefore(g, { straight: false })
        const ownHit = wantLocal && isAfter(g, { straight: false })
        e.raw(`// the children of group ${g.id}, which its code calls as children(C, p)`)
        e.raw(`fn ${childrenFn(g.id)}(C_in: Hit, p_in: VEC3) -> Hit {`)
        e.raw('    let r = C_in.r;')
        e.raw('    var C = C_in;')
        e.raw('    let p = p_in;')
        // an underscore after the prefix: never xfp_<id>, which a node's own enter() names (ids have none, model.js)
        if (localIn) e.raw('    let xfp_children_in = XF_P; XF_P = p;')
        if (ownHit) e.raw('    XF_SUB += 1u;')
        children(1, g)
        if (ownHit) e.raw('    XF_SUB -= 1u;')
        if (localIn) e.raw('    XF_P = xfp_children_in;')
        e.raw('    return C;')
        e.raw('}')
        e.raw('')
        subTag = null
    }

    /* BOUNDING-BOX CULLING, in the render copy -- which the optics trace marches too when the scene has no
       limiter (generate: then they are one text). Not in the pick copy, which the box measurement samples
       (field.js tagField) and so must see every surface: a box measured through culling by a box too small
       could never grow. Not in a limiter scene's own optics copies either: generate keeps the render copy's
       uniforms only, so a box declared there -- a limiter's, which only those copies draw -- was a name
       the kernels did not have (check-shaders' naga pass, the first time this ran).
       Every object used to be evaluated at every step however far away it was (the Noise library's six
       reliefs, 89% of its time, measured 2026-09-29/30).
       Now each top-level node -- an object, or a whole group -- is first measured against its box, in its
       own frame (cullDist, scene_api.js); farther than cullMargin(), its box distance stands in for it, a
       lower bound, and it is not evaluated. The boxes are tested every time, so overlapping ones simply mean
       more than one node is evaluated.
       ONLY AT THE ROOT, where nodes combine by plain min: in a subtraction, an intersection or a blend, a
       lower bound on a child is not a lower bound on the result. A group is culled as a whole.
       THE BOUND AGAINST |d|: fold keeps the nearest surface by |d| (inside a glass, d is negative), and the
       march steps by |d|, so a skipped node limits the step whenever its bound is nearer than that. A bound
       is always above the margin, so it never passes the march's hit test and is never shaded. */
    const drawsNothing = n => n.kind === 'object' && (!NODE_TYPES[n.type] || hidden(n) || n.type === 'export' || n.type === 'haze'
        || (n.type === 'light' && !lightOfId.get(n.id)))
    /* ONLY THE DEAR ONES (cull 'dear': Tests > boxcost's fourth row in 0.33.8; THE BUILDER'S WAY since 0.34.0, the user,
       2026-10-07: "yes, make dear-only the default and remove the setting"). Measured on the user's Pascal (Tests >
       boxcost, 0.33.5): every box tested and none culling cost a third more GPU time on Surface materials, the demo and
       the showcase, scenes of one shape a node -- whose box test (a box distance) is about what the shape's own evaluation
       is -- and their measured boxes saved about what they cost. So: no box test for a node no dearer than its box. And
       then, twice (0.33.8 and 0.33.9, roadmap/ARCHITECTURE.md): against every box measured, the showcase 13 and 15%
       faster, Surface materials 4 and 5%, the demo level, the Noise library 6% slower both times -- where it is still 72%
       faster than no boxes. Every box ('all') and none (false) are the bench's alone, for Tests > boxcost and the
       "bounding boxes off" rows.
         ONE PLAIN SHAPE is an object whose code is one call of a closed-form shape (plainshape.js PLAIN_SHAPES: no loop,
       no noise -- an outline's revolve or extrude walks its pieces and is not one) and whose
       material has no relief, or a light's face (a rectangle or a disc, `object` below). Every group keeps its box: it is
       culled as a whole, and is several shapes or code. Whether a lens or a frustum costs no more than its box test is
       not measured: the bench scenes' plain shapes are spheres, rounded boxes and cylinders.
         No node left with a box: no CULL either -- the scene made without its boxes, the same text.
         Codegen's text only: the records' walk (scenedata.js) tests a box wherever a record has one, as with every box --
       what a box on a plain record costs as data was not measured. */
    const plainShape = n => n.kind === 'object' && (n.type === 'light'
        || (n.type === 'code' && !reliefOf.has(n.material) && !!plainShapeOf(n.code)))
    const boxed = n => !drawsNothing(n) && (cull === 'all' || !plainShape(n))
    // every box: CULL kept even with no node to fold into it, the text as it was before 'dear' (the golden shaders)
    const culling = cull !== false && !pick && !optics && (cull === 'all' || (tree.children || []).some(boxed))
    const culled = (d, n) => {
        const lo = boxLoName(n.id), hi = boxHiName(n.id)
        uniforms[lo] = { type: 'vec4<f32>', def: [0, 0, 0, 0] }     // unknown until measured
        uniforms[hi] = { type: 'vec4<f32>', def: [0, 0, 0, 0] }
        const q = n.transform ? `xfPoint(p, UB.${xfName(n.id)})` : 'p'
        const s = n.transform ? ` * UB.${xfName(n.id)}[3].w` : ''
        line(d, `{   // ${n.id}: skipped while farther than its box`)
        line(d + 1, `let bd_${n.id} = cullDist(${q}, UB.${lo}, UB.${hi})${s};`)
        line(d + 1, `if (bd_${n.id} > cullMargin()) { CULL = min(CULL, bd_${n.id}); } else {`)
        emitNode(d + 2, n)
        line(d + 1, '}')
        line(d, '}')
    }
    const top = (d, n) => {
        if (!culling || !boxed(n)) return node(d, n)
        if (!liveVisibility) return culled(d, n)
        line(d, `if (${visDecl(n)}) {`)
        culled(d + 1, n)
        line(d, '}')
    }

    /* THE SCENE AS DATA (builder/scenedata.js): the blocks, the compiled subtrees, and the evaluator that walks the
       records -- in place of the root's children emitted one by one below */
    let dataOut = null
    if (data) {
        /* WHERE A FUNCTION'S SLOTS START: a name no parameter can have (model.js PARAM: a letter first), since the
           parameters are declared under their own names right after it -- one called `o`, a fine name in codegen, hid the
           offset the rest were read from */
        const SLOTS = '_slots'
        /* EACH DISTINCT OBJECT CODE ONCE, a function of the point, the record's parameter slots and its material --
           whatever nodes share it. Its parameters are read from the slots under their own names (aliasPrelude's
           scheme, a slot instead of a uniform); a constant is in the text, so it is part of what makes a block. The
           code goes in byte for byte, mapped to the first node that has it, so an error names that node and line. */
        plan.blocks.forEach((B, k) => {
            const n = B.node, params = { ...(NODE_TYPES[n.type]?.params || {}), ...(n.params || {}) }, consts = n.constants || {}
            // no node's id in the text: which nodes use a block is data, and a node added must not change the shader
            e.raw(`// block ${k}`)
            e.raw(`fn blk_${k}(C_in: Hit, r: Ray, p: VEC3, ${SLOTS}: u32, MATERIAL: u32) -> Hit {`)
            e.raw('    var C = C_in;')
            e.raw('    {')
            let slot = 0
            for (const [k2, v] of Object.entries(params)) {
                if (isCompiledIn(v) || !consts[k2]) e.raw(`        let ${k2} = ${slotRead(v, `${SLOTS} + ${slot++}u`)};`)
                else e.raw(`        const ${k2}: ${consts[k2]} = ${wgslLiteral(v, consts[k2])};`)
            }
            const body = NODE_TYPES[n.type].body(n)
            e.from(n.id, body)
            e.raw('    }')
            e.raw('    return C;')
            e.raw('}')
            e.raw('')
        })
        /* EACH DISTINCT BEFORE GROUP'S CODE ONCE (isBefore: a twist, a bend, a repeat, a mirror), a function of the point
           in its group's frame and its record's slots, giving back the point its children see. Called by the evaluator,
           which walks the children's records from there; so its `children(` hands C back untouched (BEFORE_PASS), and C is
           a Hit of its own that nothing reads -- the code never names it before that line. Its parameters are read as an
           object's are. warp() inside sets XF_M, XF_S and XF_K, which the evaluator reads back. */
        if (plan.befores.length) {
            e.raw(`fn ${BEFORE_PASS}(C: Hit, p: VEC3) -> Hit { return C; }`)
            e.raw('')
        }
        plan.befores.forEach((B, k) => {
            const g = B.node, params = g.params || {}, consts = g.constants || {}
            e.raw(`// before ${k}`)
            e.raw(`fn bef_${k}(r: Ray, p_in: VEC3, ${SLOTS}: u32) -> VEC3 {`)
            e.raw('    var p = p_in;')
            e.raw('    var C: Hit;')
            e.raw('    {')
            let slot = 0
            for (const [k2, v] of Object.entries(params)) {
                if (!consts[k2]) e.raw(`        let ${k2} = ${slotRead(v, `${SLOTS} + ${slot++}u`)};`)
                else e.raw(`        const ${k2}: ${consts[k2]} = ${wgslLiteral(v, consts[k2])};`)
            }
            const { text, shifts } = renameChildren(g.code, BEFORE_PASS.slice('children_'.length))
            e.from(g.id, text, 1, shifts)
            e.raw('    }')
            e.raw('    return p;')
            e.raw('}')
            e.raw('')
        })
        /* EACH DISTINCT AFTER GROUP'S CODE ONCE (isAfter: a round, a shell): called by the evaluator once the group's
           children's records have folded into a Hit of their own, which its `children(...)` hands back (AFTER_PASS, from
           SCN_AFTER), with the Hit the group folds into, its point and its slots. XF_M and XF_S are its frame's, as
           codegen's are when its code runs after its children. */
        if (plan.afters.length) {
            e.raw('var<private> SCN_AFTER: Hit;')
            e.raw(`fn ${AFTER_PASS}(C: Hit, p: VEC3) -> Hit { return SCN_AFTER; }`)
            e.raw('')
        }
        plan.afters.forEach((B, k) => {
            const g = B.node, params = g.params || {}, consts = g.constants || {}
            e.raw(`// after ${k}`)
            e.raw(`fn aft_${k}(C_in: Hit, r: Ray, p_in: VEC3, ${SLOTS}: u32) -> Hit {`)
            e.raw('    var C = C_in;')
            e.raw('    {')
            e.raw('        var p = p_in;')
            let slot = 0
            for (const [k2, v] of Object.entries(params)) {
                if (!consts[k2]) e.raw(`        let ${k2} = ${slotRead(v, `${SLOTS} + ${slot++}u`)};`)
                else e.raw(`        const ${k2}: ${consts[k2]} = ${wgslLiteral(v, consts[k2])};`)
            }
            const { text, shifts } = renameChildren(g.code, AFTER_PASS.slice('children_'.length))
            e.from(g.id, text, 1, shifts)
            e.raw('    }')
            e.raw('    return C;')
            e.raw('}')
            e.raw('')
        })
        /* WHAT IS COMPILED AS BEFORE: each subtree emitted exactly as below, into a function the evaluator calls in its
           parent's frame (its own transform is applied inside, from its uniform) */
        plan.subs.forEach((n, k) => {
            e.raw(`// compiled subtree ${k}: node ${n.id} and everything in it, as codegen emits it`)
            e.raw(`fn sub_${k}(C_in: Hit, r: Ray, p: VEC3) -> Hit {`)
            e.raw('    var C = C_in;')
            subTag = planTag.get(n.id)
            emitNode(1, n)
            subTag = null
            e.raw('    return C;')
            e.raw('}')
            e.raw('')
        })
        /* the records; codegen and the plan must agree on the lights' order (their material ids) */
        if (plan.lights.map(L => L.id).join() !== lights.map(L => L.id).join())
            throw new Error(`[codegen] the data plan's lights (${plan.lights.map(L => L.id)}) are not codegen's (${lights.map(L => L.id)})`)
        const how = { materialIndex: mid => mid != null && matIdOf.has(mid) ? matIdOf.get(mid) : 1,
                      lightMaterial: i => lights[i].matId, limiters }
        const rec = recordsOf(tree, plan, how)
        if (!rec) throw new Error('[codegen] the data plan does not cover its own tree')
        /* ...READ FROM A UNIFORM COPY, where every ray walks them in step (scenedata.js RECORDS_IN_UNIFORM) -- in every
           copy alike: they share the scene's buffers. (Not with the candidate grid or exact hits until 0.41.0, which
           walked different records in neighbouring rays.) */
        const uniformRecs = true
        for (const l of evaluatorWGSL({ blocks: plan.blocks.length, befores: plan.befores.length, afters: plan.afters.length, subs: plan.subs.length, stack: plan.stack, arrays: plan.arrays, wantLocal, keepK, straight, pick, optics, cull,
            count, recs: 'scnRecs' })) e.raw(l)
        // the nodes inside compiled subtrees: their values are those subtrees' uniforms, never records (demo.js liveValue)
        const compiledIds = new Set()
        const into = n => { compiledIds.add(n.id); (n.children || []).forEach(into) }
        plan.subs.forEach(into)
        dataOut = { records: rec.data, blocks: [...plan.blocks, ...plan.befores, ...plan.afters], compiledIds, uniformRecs, dataOf: (t, boxes = null) => recordsOf(t, plan, { ...how, boxes }) }
    } else {
    e.raw('fn SDF(r: Ray) -> Hit {')
    e.raw('    let p = r.pos;')
    e.raw('    var C = emptyHit(r);')   // the renderer's starting Hit, core/scene_api.js
    if (culling) e.raw('    var CULL: FLOAT = 1.0e7;              // the nearest skipped node\'s box: a bound on all of them')
    if (wantLocal) e.raw('    XF_P = p;')
    // no warp in force at the top: SDF is called many times per invocation, and XF_K is private to it
    if (keepK) e.raw('    XF_K = 1.0;')
    // nor a straight group's material frame: it is set where one is entered, and a call starts outside all of them
    if (straight) e.raw('    XF_STRAIGHT = false;')

    // the root is the world frame and a plain union: its children go straight into C
    for (const c of tree.children || []) top(1, c)

    if (culling) e.raw('    if (CULL < abs(C.s.w)) { C.s.w = CULL; }')
    e.raw('    return C;')
    e.raw('}')
    }

    // the haze box in the world, if the scene has one (the tree is the root group here)
    const haze = hazeOf({ root: tree })
    /* `wgsl` for the scene contract is the materials onwards -- the same place the three
       hand-written scenes put there, since the kernels prepend the engine prelude themselves
       and would otherwise see it twice. `body` is the whole file, which is what the probe
       compiles and what the map's line numbers count. */
    return {
        id, title,
        /* metres per unit is the renderer's business (photometry.UNITS); the scene only says
           which unit its numbers are in. Absent means metres, as every scene before it was. */
        unit: tree.unit ?? 'm',
        /* ...and where it stops, in that unit (model.js envRadius): the renderer reads it off the scene it
           has, like the unit. null is the renderer's 400 m, as every scene before 0.9.0 had. */
        envRadius: tree.envRadius ?? null,
        /* ...and its surface tolerance, in that unit (model.js setTolerance, 0.66.0): the renderer takes it as the one it
           traces with (photometry.js sceneEps). null is the automatic one, as every scene before it had. */
        tolerance: tree.tolerance ?? null,
        /* ...and its haze box (hazebox.js hazeOf: in the world, in that unit; the renderer's core/haze.js), only when it
           has one: whether it does decides the kernels' text (sceneTextOf), so a scene without one says nothing */
        ...(haze ? { haze } : {}),
        wgsl: e.lines.slice(preludeLines).join('\n'),
        uniforms,
        body: e.wgsl,
        map: e.map,
        tags: plan ? plan.tags : tags,
        lights,
        // the scene as data: its records, and how to make them again for the same plan (generate attaches them)
        ...(dataOut ? { _data: dataOut } : {}),
        /* the paths and profiles a live change can reach (livePointsUpdate): live ones, and compiled ones that name a
           parameter */
        pointParams: [...paths, ...profiles].filter(P => P.live || P.deps.length)
            .map(P => ({ kind: P.kind, id: P.id, k: P.k, live: P.live, ...(P.forced ? { forced: true } : {}), ...(P.live ? { room: P.room } : {}),
                         ...(P.vary ? { vary: true } : {}), ...(P.edited ? { edited: true } : {}),
                         deps: P.deps, signature: signatureOf(P.pieces) })),
    }
}

