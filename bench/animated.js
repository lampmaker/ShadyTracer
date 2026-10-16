//======================================================================================================================
// WHAT ANIMATED VALUES COST THE BAKE (0.38.0; the user, 2026-10-08: "make a test where speed is compared: no bake, scene as
// data; bake, no uniforms (as it was); bake, some uniforms (let's say 4)"). A bench test of its own (Tests > animated).
//
// THE QUESTION: a value flagged animated (builder/model.js setAnimated) stays a uniform in the baked scene, read at every
// step, where the bake otherwise folds it into the kernels as a constant (builder/bake.js). Whether a few of them take
// back what the bake gains -- and whether a baked scene with them still beats the editing build it replaces.
//
// THE ROWS: each bench scene three ways, back to back -- the same document, camera, environment and measured boxes:
//   as data                        the editing build that compiles nothing per edit (builder/scenedata.js), as
//                                  Tests > builds has it: what is shown while the edits come (with the grid and
//                                  exact hits until they went, 0.41.0)
//   baked                          every value a constant but the culling boxes: the bake as it was before 0.38.0
//   baked, 4 positions animated    the same with four objects' positions flagged, through the builder's own road
//                                  (setAnimated, then animate.js keptUniforms): each object's matrix (xf_<id>) a
//                                  uniform again. Positions, because a timeline moves those first, and a matrix is
//                                  the dearest single value a flag keeps (sixteen numbers, multiplied at every step)
// THE FOUR: the first four objects in the tree (not lights or export boxes) whose matrix the scene's text reads; fewer
// where a scene has fewer, and the row says how many. Named in the row's label, for a reader to find them in the scene.
// Each row its own kernels, each compiled uncached: "compile ms" is what making that build costs. The last row is the
// first again: if it differs from row 1, so may every row.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { xfName } from '../builder/codegen.js'
import { baked } from '../builder/bake.js'
import { keptUniforms } from '../builder/animate.js'
import { BENCH, benchUrl, sceneOf, boxesFor } from './index.js'
import { SCENES } from './scenedata.js'
import { liveInBench } from './bake.js'

export { SCENES }

/** How many positions the third row of a scene flags. */
export const ANIMATED = 4

/** THE OBJECTS WHOSE POSITIONS A SCENE'S THIRD ROW FLAGS: the first `n` objects in tree order (no lights, no export
 *  boxes) with a transform the codegen text reads (UB.xf_<id>). */
export function animatedObjects(doc, S, n = ANIMATED) {
    const out = []
    Model.walk(doc, node => {
        if (out.length >= n || node === doc.root || node.kind !== 'object' || node.type === 'light' || node.type === 'export' || node.type === 'haze') return
        if (node.enabled === false || !node.transform) return
        if (S.wgsl.includes(`UB.${xfName(node.id)}`)) out.push(node)
    })
    return out
}

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function animatedTest(load) {
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const cases = []
    for (const [key, label, file, camera] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        const boxes = boxesFor(doc)
        const row = (how, scene, extra = {}) => ({ label: `${label}, ${how}`, scene, camera, environment: environmentOf(doc),
                                                   measureBoxes: boxes, compile: true, ...extra })
        cases.push(row('as data', sceneOf(doc, `animated-${key}-data`, true), { way: 'data', data: true }))
        cases.push(row('baked', baked(sceneOf(doc, `animated-${key}-baked`), { live: liveInBench }), { way: 'baked', baked: true }))
        // the four flagged on a copy, through the model, and kept as the builder keeps them (demo.js bakeScene)
        const S = sceneOf(doc, `animated-${key}-baked4`)
        const flagged = structuredClone(doc)
        const objs = animatedObjects(flagged, S)
        for (const o of objs) Model.setAnimated(flagged, `scene/${o.id}/transform/position`, true)
        const keep = keptUniforms(flagged, S)
        const names = objs.map(o => o.label || o.id).join(', ')
        cases.push(row(`baked, ${objs.length} position${objs.length === 1 ? '' : 's'} animated (${names})`,
                       baked(S, { live: n => liveInBench(n) || keep.has(n) }), { way: 'baked-animated', baked: true, animated: objs.map(o => o.id) }))
    }
    // sameTextAs is a case's index: "= row 1" in the report
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'animated', kind: 'bench',
        title: `What animated values cost the bake: every bench scene as data, baked, and baked with ${ANIMATED} positions animated, 1280 x 720, fixed camera`,
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene three ways, back to back --'
            + ' as data (the editing build: what is shown while edits come), baked (every value a'
            + ` constant, as the bake was before 0.38.0), and baked with ${ANIMATED} objects' positions flagged animated (each`
            + ' one\'s matrix a uniform again, as the builder keeps a flagged value) -- the same document, camera and measured'
            + ' boxes. Each its own kernels, compiled uncached. Read each scene\'s "gpu ms" (and march, occlude, surface) down'
            + ' its three rows: the third against the second is what the flags cost; the third against the first is whether'
            + ' a bake with them still beats the editing build. The picture should not change between a scene\'s rows. The'
            + ' last row is the first again: if it differs from row 1, so may every row. Save the whole text with the'
            + ' machine\'s name. (bench/animated.js.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
