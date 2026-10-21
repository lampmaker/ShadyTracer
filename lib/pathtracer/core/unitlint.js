//======================================================================================================================
// THE UNIT LINT -- that the engine meets the scene only at the boundary (scene_api.js SCENE_BOUNDARY), in every kernel,
// for every scene. Pure: check-shaders.mjs runs it in its second pass over every kernel it builds (the recording device
// gives the whole text), and test/unitlint.test.mjs plants violations to see it fire.
//
// WHY A CHECK AND NOT A COMMENT. The engine works in engine units (metres, since 0.36.0) and a scene in its own; the
// two differ by the scene's unit, a factor of 100 or 1000. A call of the scene's side from engine code compiles, runs,
// and is right in every metre scene -- the bench's, the demo's -- and wrong in a mm one: the bug this repository keeps
// having, true for the only caller there was (CLAUDE.md). So no engine function may
//   - call the scene's side: SDF, getMaterial2, the scene's lightFace, localPoint, the local point's capture, or the
//     scene-unit lengths (marchEps, normalEps, offsetEps, metres, mm) -- nor any function of the scene's side that
//     reaches one of those (perMm, a material helper), which would be the same call one level down;
//   - read what the scene leaves in its globals in its units, or about its frames: SCN_TOL, HIT_LOCAL, HIT_FRAME,
//     HIT_SCALE, HIT_TAG, HIT_TAG_D, LOCAL_CAPTURE, XF_*;
//   - read UB.sceneUnit or UB.perMetre, outside the engine's own unit functions (EPS_WGSL).
// What the engine MAY touch of the scene's: LOCAL_READY and LOCAL_WANTED (whether a material wanted its point), and
// NORMAL_LOOK (a normal's look: a CSG chain's result undivided, 0.71.1) -- flags, no lengths. (SCN_MARCH and SCN_EXACT,
// a march asking and a scene answering along the ray, were flags too, until exact hits went in 0.41.0; so were the
// lengths SCN_HIT_T and SCN_SD the engine read through the boundary.)
// Which side a function is on is decided by WHERE IT IS WRITTEN: the scene's own texts and the scene-side snippets
// (SCENE_SIDE below) are the scene's, the boundary's are the boundary's, and everything else -- every kernel's main,
// the shading, the light sampling, the camera's -- is the engine's.
//======================================================================================================================

import { stripComments } from './wgslgraph.js'

/** The scene's side: what a scene's text may call. Called by an engine function, directly or through a scene-side
 *  function, it is a violation. */
export const SCENE_CALLS = Object.freeze(['SDF', 'getMaterial2', 'lightFace', 'localPoint', 'localCaptureBegin', 'localCaptureEnd',
    'boundaryCapture', 'rayToScene', 'hitToScene', 'marchEps', 'normalEps', 'offsetEps', 'metres', 'mm'])
/** ...the scene's globals the engine may not read (a regex source each) */
export const SCENE_READS = Object.freeze(['SCN_TOL', 'HIT_LOCAL', 'HIT_FRAME', 'HIT_SCALE', 'HIT_TAG', 'HIT_TAG_D',
    'LOCAL_CAPTURE', 'XF_[A-Z]+'])
/** ...and the unit uniforms, which only the engine's unit functions read */
export const UNIT_UNIFORMS = Object.freeze(['UB\\.sceneUnit', 'UB\\.perMetre'])
export const UNIT_FUNCTIONS = Object.freeze(['tolSetting', 'marchTol', 'normalTol', 'offsetTol', 'engLen', 'engPerScene', 'scenePerEng'])

/** Kernels that work in the scene's units by design, with why: they serve host tools whose inputs and outputs are the
 *  builder's own numbers, and none of them marches with the engine's tolerances. */
export const SCENE_UNIT_KERNELS = Object.freeze({
    field: 'the mesh export samples the scene at the builder\'s points (core/field.js)',
    tagfield: 'the builder\'s bounds sample the scene at its points (core/field.js, builder/boxes.js)',
    probe: 'the builder\'s compile probe: a module, never dispatched (builder/validate.js)',
})

/** name -> body (comments stripped), every `fn` in src */
export function functionBodies(src) {
    const code = stripComments(src)
    const out = new Map()
    for (const m of code.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*\(/g)) {
        let i = code.indexOf('{', m.index), depth = 0, j = i
        for (; j < code.length; j++) {
            if (code[j] === '{') depth++
            else if (code[j] === '}' && --depth === 0) break
        }
        out.set(m[1], code.slice(i, j + 1))
    }
    return out
}
const namesIn = src => new Set(functionBodies(src).keys())
const callsIn = body => new Set([...body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]))

/**
 * The problems of one built kernel, as lines of text (none: it keeps the rule).
 * @param k          a recorded build: { body, main }
 * @param scene      the scene it was built against (its texts are the scene's side)
 * @param name       the kernel's name (SCENE_UNIT_KERNELS are not checked)
 * @param sides      { sceneSide: [snippet texts of the scene's side], boundary: [the boundary's texts] }
 */
export function unitLint(k, scene, name, { sceneSide = [], boundary = [] } = {}) {
    if (name in SCENE_UNIT_KERNELS || k.frag || k.draw) return []
    const fns = functionBodies(`${k.body}\nfn __entry__() {\n${k.main}\n}`)
    const sceneFns = new Set()
    for (const t of [scene?.wgsl, scene?.pickWgsl, scene?.opticsWgsl, scene?.opticsPickWgsl, ...sceneSide])
        if (t) for (const n of namesIn(t)) sceneFns.add(n)
    const boundaryFns = new Set()
    for (const t of boundary) for (const n of namesIn(t)) boundaryFns.add(n)
    /* A SCENE-SIDE FUNCTION THAT REACHES THE SCENE'S CALLS, through scene-side functions only: calling it is calling them */
    const forbidden = new Set(SCENE_CALLS)
    for (let grew = true; grew;) {
        grew = false
        for (const n of sceneFns) {
            if (forbidden.has(n) || !fns.has(n) || boundaryFns.has(n)) continue
            if ([...callsIn(fns.get(n))].some(c => forbidden.has(c))) { forbidden.add(n); grew = true }
        }
    }
    const reads = new RegExp(`\\b(${SCENE_READS.join('|')})\\b`, 'g')
    const units = new RegExp(`\\b(${UNIT_UNIFORMS.join('|')})\\b`, 'g')
    const out = []
    for (const [fn, body] of fns) {
        if (sceneFns.has(fn) || boundaryFns.has(fn)) continue
        const where = fn === '__entry__' ? 'main' : fn
        const bad = [...callsIn(body)].filter(c => forbidden.has(c) && !(boundaryFns.has(c)))
        if (bad.length) out.push(`${name}: ${where} calls the scene's side directly (${bad.join(', ')}) -- through the boundary instead (sceneAt, materialAt, lightFaceAt, marchTol...)`)
        const r = [...new Set([...body.matchAll(reads)].map(m => m[1]))]
        if (r.length) out.push(`${name}: ${where} reads the scene's globals (${r.join(', ')}) -- tagCaptureEnd() and the boundary's functions are the engine's`)
        if (!UNIT_FUNCTIONS.includes(fn)) {
            const u = [...new Set([...body.matchAll(units)].map(m => m[1]))]
            if (u.length) out.push(`${name}: ${where} reads ${u.join(', ')} -- only the engine's unit functions do (EPS_WGSL, tracebasics.js)`)
        }
    }
    /* THE BOUNDARY HOLDS ONE OF EACH CALL: every call site is a whole copy of the scene once inlined (copies.test) */
    for (const t of boundary) {
        const b = stripComments(t)
        for (const f of ['SDF', 'getMaterial2', 'lightFace']) {
            const n = (b.match(new RegExp(`\\b${f}\\s*\\(`, 'g')) || []).length
            if (n !== 1) out.push(`${name}: the boundary calls ${f} ${n} times -- once, or the scene is inlined that many times`)
        }
    }
    return out
}

/** The fields of a WGSL struct, by name. */
export function structFields(src, struct) {
    const m = new RegExp(`\\bstruct\\s+${struct}\\s*\\{([\\s\\S]*?)\\}`).exec(stripComments(src))
    return m ? [...m[1].matchAll(/\b([A-Za-z_]\w*)\s*:/g)].map(x => x[1]) : null
}
