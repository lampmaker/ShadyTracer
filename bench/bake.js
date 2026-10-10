//======================================================================================================================
// BAKED AGAINST CODEGEN (builder/bake.js; the user, 2026-10-06: "what if the default mode is data, and there is a bake
// mode that compiles everything ... Could that be better than current codegen?"). A bench test of its own (Tests > bake).
//
// THE QUESTION: whether a scene's values as constants -- every transform, size and material folded into the kernels --
// march, occlude and shade faster than codegen's, which reads each from the uniform buffer at every step, and what the
// compile costs. If the baked rows are clearly faster, a bake mode (data for editing, baked for rendering) beats today's
// codegen; if not, today's codegen is already the bake.
//
// THE ROWS: each bench scene twice, back to back -- codegen as the page makes it, then baked -- the same document,
// camera, environment and measured boxes; each its own text, so each compiled uncached ("compile ms" is what a bake
// costs). The culling boxes stay uniforms in the baked rows: they are measured after the compile (bench/index.js
// boxesFor), and a box not yet measured culls nothing. So what the rows compare is everything but the box values.
// The last row is the first again: if it differs from row 1, so may every row.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { boxLoName, boxHiName } from '../builder/codegen.js'
import { baked } from '../builder/bake.js'
import { BENCH, benchUrl, sceneOf, boxesFor } from './index.js'
import { SCENES } from './scenedata.js'

export { SCENES }

/** The values a bench row keeps live: the culling boxes, which the bench measures and writes per row. */
export const liveInBench = name => name.startsWith(boxLoName('')) || name.startsWith(boxHiName(''))

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function bakeTest(load) {
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const cases = []
    for (const [key, label, file, camera] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        const boxes = boxesFor(doc)
        const row = (how, scene, extra = {}) => ({ label: `${label}, ${how}`, scene, camera, environment: environmentOf(doc),
                                                   measureBoxes: boxes, compile: true, ...extra })
        cases.push(row('codegen', sceneOf(doc, `bake-${key}`)))
        cases.push(row('baked', baked(sceneOf(doc, `bake-${key}-baked`), { live: liveInBench }), { bakedOf: cases.length - 1 }))
    }
    // sameTextAs is a case's index: "= row 1" in the report
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'bake', kind: 'bench',
        title: 'Baked against codegen: every bench scene with its values as constants, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene twice, back to back: as'
            + ' codegen makes it (every value a uniform, read at every step), then baked (every value a constant in the'
            + ' kernels: builder/bake.js) -- the same document, camera and measured boxes, which stay uniforms in both.'
            + ' Read each baked row\'s "march", "occlude" and "surface" against its codegen row, and its "compile ms": that'
            + ' is what a bake would cost after every change. The picture should not change. The last row is the first'
            + ' again: if it differs from row 1, so may every row. Save the whole text with the machine\'s name.'
            + ' (bench/bake.js, roadmap/ARCHITECTURE.md.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
