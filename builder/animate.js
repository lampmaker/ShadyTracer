//======================================================================================================================
// WHAT AN ANIMATED VALUE IS IN THE SHADER (model.js setAnimated; the user, 2026-10-08: "the Bake mode could use some
// uniforms. e.g. for animations, any variables that need to be animated should be a uniform").
//
// A flag names a value as the parameter registry does (builder/params.js): 'scene/<id>/radius',
// 'scene/<id>/transform/position'. The bake (bake.js) speaks uniform names: 'radius_<id>', 'xf_<id>'. Between the two
// is the key builder/demo.js live(id, k) pushes a value under, and what that push writes -- nodeLive and liveValue
// there. This file is the same mapping, read from the same codegen names, for the bake to keep those uniforms:
//   liveKeyOfPath   a registry path -> the { id, k } live() is called with
//   liveUniformsOf  { id, k } -> the uniforms its push writes, in the scene given
//   animatedKeys    every flagged value's { id, k }, and what each moves through the bindings (model.js boundFrom):
//                   a component parameter is no uniform itself, only what is bound to it is
//   keptUniforms    the union of the two: what the bake keeps a uniform
//
// A SECOND COPY OF A NAMING IS A NAMING THAT CAN DRIFT. test/animate.test.mjs holds it to the first: every live entry of
// every bundled scene, pushed through the real builder over a renderer that records what it is told to set, writes
// exactly what liveUniformsOf says. And it is not trusted where it matters: live() on the baked scene asks the renderer
// whether each name is still a uniform before staying baked (demo.js), and a write it refuses sends the picture back
// to the editing build, as any write did before.
//
// TRANSFORM IS ONE MATRIX: position, rotation and scale are one uniform (xf_<id>), so flagging any of the three keeps
// all three live. A light's look is three (its colour, luminance and beam), so flagging any light setting keeps those.
//======================================================================================================================

import * as M from './model.js'
import { uniformName, paramUniform, xfName, copyName, blendName, visName, joinBlendName, livePointsUpdate } from './codegen.js'

/** The { id, k } a value at registry path `path` is pushed under (demo.js live), or null for no such path. */
export function liveKeyOfPath(path) {
    const m = /^scene\/([^/]+)\/(.+)$/.exec(String(path ?? ''))
    if (!m) return null
    const [, id, rest] = m
    if (id === 'environment') return { id: M.ENVIRONMENT_ID, k: rest }
    if (rest.startsWith('transform/')) return { id, k: 'transform' }
    if (rest === 'join/blend') return { id, k: 'jblend' }
    if (rest.startsWith('light/')) return { id, k: 'light' }
    return { id, k: rest }
}

/**
 * THE UNIFORMS A LIVE PUSH OF (id, k) WRITES, as demo.js liveValue writes them into a codegen scene (the bake is one).
 * `scene` the codegen scene the push is for: its pointParams say which paths and profiles a parameter reaches. An
 * environment setting and the scene's radius are the renderer's, never the scene's uniforms: none.
 */
export function liveUniformsOf(doc, id, k, scene = null) {
    if (id === M.ENVIRONMENT_ID) return []
    if (id === doc.root.id) return []
    if (M.reliefMaterialId(id) != null) return [paramUniform(id, k)]
    if (M.material(doc, id)) return [uniformName(id, k)]
    const f = M.find(doc, id)
    if (!f) return []
    const node = f.node
    if (k === 'light') return node.type === 'light' && M.hasFace(node.light)
        ? [uniformName(id, 'emissive'), uniformName(id, 'emissiveLuminance'), uniformName(id, 'beam')] : []
    /* A LIGHT SET BY ITS FLUX: its luminance is the flux over its area (sources.js syncSources), so its size or scale
       moved writes its luminance too (demo.js liveValue: pushSources) */
    const byFlux = node.type === 'light' && M.hasFace(node.light) && node.light?.flux != null ? [uniformName(id, 'emissiveLuminance')] : []
    if (k === 'transform') return [xfName(id), ...byFlux]
    if (k === 'copies') return (node.copies || []).map((_, i) => copyName(id, i))
    if (k === 'enabled') return [visName(id)]
    if (k === 'blend') return [blendName(id)]
    if (k === 'jblend') return [joinBlendName(id)]
    // a parameter: its own uniform, and the pieces of every live path or profile that names it (codegen livePointsUpdate)
    const paths = Object.keys(livePointsUpdate(doc, id, k, scene?.pointParams).set)
    const kind = M.paramKind(node.params?.[k])
    /* ...AND WHAT IS BOUND TO IT (bind.js): a group's parameter moved resolves its bindings again, and demo.js pushes
       every value that moved -- a plate's size, a fin's place, an array's copies. They were left out, so this said less
       than a push writes, which is the one thing it promises (the header; test/animate.test.mjs, which no bundled
       scene with bindings had exercised -- the heatsink example that is coming did). Whether a picture was ever wrong
       for it is NOT shown: the bake keeps a flagged parameter's bound uniforms through animatedKeys, which already
       followed boundFrom. boundFrom is transitive. */
    const bound = M.boundFrom(doc, id, k).flatMap(r => liveUniformsOf(doc, r.id, r.key, scene))
    return [...new Set([...(kind === 'path' || kind === 'profile' ? [] : [uniformName(id, k)]), ...paths, ...byFlux, ...bound])]
}

/** EVERY FLAGGED VALUE'S LIVE KEY, and what moves with it through the bindings: Map(`${id}\n${k}` -> { id, k }). */
export function animatedKeys(doc) {
    const out = new Map()
    const add = (id, k) => out.set(`${id}\n${k}`, { id, k })
    for (const path of M.animatedPaths(doc)) {
        const lk = liveKeyOfPath(path)
        if (!lk) continue
        add(lk.id, lk.k)
        for (const r of M.boundFrom(doc, lk.id, lk.k)) add(r.id, r.key)
    }
    return out
}

/** THE UNIFORMS THE BAKE KEEPS for the flags of `doc`, in codegen scene `scene`: a Set of names. */
export function keptUniforms(doc, scene = null) {
    const out = new Set()
    for (const { id, k } of animatedKeys(doc).values()) for (const n of liveUniformsOf(doc, id, k, scene)) out.add(n)
    return out
}
