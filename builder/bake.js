//======================================================================================================================
// THE SCENE BAKED (the user, 2026-10-06: "what if the default mode is data, and there is a bake mode that compiles
// everything ... All uniforms etc are fixed, maybe with the exception of a few that can be defined by the user. Could
// that be better than current codegen?"). A first step, for the bench to answer that: codegen's scene with its values
// written into the kernels as constants instead of read from the uniform buffer.
//
// WHAT CODEGEN READS AT EVERY STEP, read in code (codegen.js; the demo's text): structure as code, but every number a
// uniform -- per node its transform (UB.xf_<id>, a matrix: xfPoint multiplies the point by it, and XF_M * xfRot(...)
// carries the frame on for normals and materials), its culling box (UB.bxlo_/bxhi_<id>), its sizes (UB.radius_<id>...),
// and the materials (97 uniforms in the demo, 464 in the optics bench). As constants the compiler may fold them: a node
// not turned or scaled loses its matrix products, a box test becomes a few fixed compares. Whether that is a gain worth
// a compile per change is the card's to say (Tests > bake); nothing here is measured.
//
// HOW: every uniform becomes a scene constant (scene.constants; uniforms.schema.js sceneConstantsWGSL declares those at
// the head of every kernel, whichever of the scene's texts it compiles) named BAKE_PREFIX + its name, and every
// `UB.<name>` in the scene's texts reads that instead. Nothing else in the text changes: un-baked (the prefix read back
// as UB.) it is codegen's text byte for byte (bench/test/bake.test.mjs). A value that cannot be a WGSL f32 literal (not
// finite, past f32's range, or below its normal range) stays a uniform.
//
// THE LIVE ONES, `live(name)`: values that stay uniforms. The bench keeps the culling boxes live -- it measures them
// after the scene is compiled (bench/index.js boxesFor), and a box not yet measured is "unknown", never culled. The
// builder keeps them and the values the user flagged as animated (model.js setAnimated, builder/animate.js: the "few
// that can be defined by the user" above), so a timeline playing those writes them into the baked scene
// (demo.js live) rather than sending the picture back to the editing build.
//======================================================================================================================

import { uniformToGPU } from '../lib/pathtracer/core/uniforms.schema.js'

export const BAKE_PREFIX = 'bk_'

/* the texts a kernel compiles one of (wavefront.js, field.js, pick.js, the optics kernels) */
export const BAKED_TEXTS = ['wgsl', 'pickWgsl', 'opticsWgsl', 'opticsPickWgsl']

const F32_MAX = 3.4028234663852886e38, F32_MIN_NORMAL = 1.1754943508222875e-38
const fits = x => Number.isFinite(x) && Math.abs(x) <= F32_MAX && (x === 0 || Math.abs(x) >= F32_MIN_NORMAL)
/** Whether a uniform's value can be written as a WGSL literal of its type (u32 and i32 are written whole). */
export const bakeable = (type, v) => /^(f32|u32|i32)$/.test(type) ? typeof v === 'number' && fits(v)
    : /^(vec\d|mat\dx\d)<(f32|u32|i32)>$/.test(type) && v != null && typeof v[Symbol.iterator] === 'function' && Array.from(v).every(x => typeof x === 'number' && fits(x))

/**
 * A codegen scene baked: a new scene object (the one given is not touched), its uniforms constants but those `live`
 * keeps, its texts reading the constants. `baked` on it says which went which way: { names, kept }.
 */
export function baked(scene, { live = () => false } = {}) {
    const uniforms = {}, constants = { ...(scene.constants || {}) }, names = new Set(), kept = []
    for (const [name, u] of Object.entries(scene.uniforms || {})) {
        const v = uniformToGPU(u.def, u.type)
        if (live(name) || !bakeable(u.type, v)) { uniforms[name] = u; kept.push(name); continue }
        constants[BAKE_PREFIX + name] = { type: u.type, def: Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v) : v }
        names.add(name)
    }
    const rewrite = t => t.replace(/\bUB\.([A-Za-z_]\w*)/g, (m, n) => names.has(n) ? BAKE_PREFIX + n : m)
    // every property kept as it is (some a scene defines unenumerable), then the four that change set over them
    const out = Object.defineProperties({}, Object.getOwnPropertyDescriptors(scene))
    const set = (k, value) => Object.defineProperty(out, k, { value, enumerable: true, configurable: true, writable: true })
    for (const k of BAKED_TEXTS) if (typeof scene[k] === 'string') set(k, rewrite(scene[k]))
    /* NO BODY: codegen's `body` is the whole file the builder's code editor probes (validate.js), its line map counting
       the prelude, and it is compiled without the scene's constants -- a baked one would read names it never declares
       (check-shaders found it so). A baked scene is rendered, never edited, so it has none. */
    set('body', undefined)
    set('map', undefined)
    set('uniforms', uniforms)
    set('constants', constants)
    set('baked', { names: [...names], kept })
    return out
}
