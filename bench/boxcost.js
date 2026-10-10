//======================================================================================================================
// WHAT THE BOX TESTS COST (0.33.4; the user, 2026-10-07: "yes, add the box test cost row"). A bench test of its own
// (Tests > boxcost).
//
// THE QUESTION: the closest object per cell (roadmap/ARCHITECTURE.md, The closest object per cell, counted) would save
// box tests -- 27 to 86% of them on six scenes, counted on lavapipe -- and hardly any node evaluations. Whether that is
// worth building turns on what a box test costs against a node's evaluation, and only a card can say. A box test is,
// read in code (codegen.js culled, scene_api.js cullDist): the point through the node's transform, a box distance, a
// compare and a branch, at every scene call, for every top-level node that draws something; plus the bound kept for the
// nodes skipped (CULL) and its fold at the end.
//
// THE ROWS: each scene four ways, back to back -- the same document, camera and environment:
//   boxes off                 the scene made without its boxes (sceneOf's `cull` false): no box test in its text
//   boxes that never cull     the scene made with a box test for every top-level node (sceneOf's `cull` 'all', as the
//                             builder made every scene until 0.34.0), every box written as one that holds everything:
//                             every box tested at every scene call, and every node evaluated, as with no boxes. So the
//                             same evaluations and the same steps as the row above: what is left between the two is the
//                             box tests.
//   boxes measured            the same scene object, its boxes measured as every bench row's are (bench/index.js
//                             boxesFor): what the culling saves, read against the row above
//   boxes on the dear nodes   (0.33.8; the user, 2026-10-07: "yes, build the boxes on expensive nodes only row") the
//   only                      scene made with a box test only where a node is dearer than its box (codegen.js, ONLY
//                             THE DEAR ONES: no test for one plain shape), those boxes measured as above -- THE
//                             BUILDER'S WAY since 0.34.0, made by two runs of this test (roadmap/ARCHITECTURE.md). Read
//                             against "boxes measured" and "boxes off". A scene with no dear node (Surface materials:
//                             fourteen plain shapes) is the scene made without its boxes, the same text: that row is
//                             the first row's scene again, not compiled.
// The last row is the first again: if it differs from row 1, so may every row.
//
// ONE THING THE NEVER-CULLING ROW DOES NOT HAVE: with every box holding everything, every invocation takes the same
// branch; with measured boxes, neighbouring rays may not. So the row times the box tests' arithmetic and their branch,
// not what diverging on it costs (inferred from the shape of the code, not measured).
//
// THE SCENES: the two with the most boxes (the Noise library and Surface materials, 14 top-level nodes with a box test
// each, counted in their generated text 2026-10-07), and the next two in box tests a camera ray in the closest-object
// count (builder/test/cellobject.gpu.mjs, its cache march: the demo 230, 8 boxes; the showcase 143, 13 boxes).
//======================================================================================================================

import * as Model from '../builder/model.js'
import { boxLoName, boxHiName } from '../builder/codegen.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl, sceneOf, boxesFor } from './index.js'

/** The scenes, in the order of the rows: [key, label, file, camera]. */
export const SCENES = [
    ['noise', 'the Noise library', BENCH_FILES.noise, CAMERAS.noise],
    ['surfaces', 'Surface materials', BENCH_FILES.surfaces, CAMERAS.surfaces],
    ['demo', 'the demo', BENCH_FILES.demo, CAMERAS.demo],
    ['showcase', 'the showcase', BENCH_FILES.showcase, CAMERAS.showcase],
]

/** The ways, in the order of a scene's rows: [key, label]. */
export const WAYS = [
    ['off', 'boxes off'],
    ['never', 'boxes that never cull'],
    ['measured', 'boxes measured'],
    ['dear', 'boxes on the dear nodes only'],
]

/* A BOX THAT HOLDS EVERYTHING, in any node's own frame. Its distance (scene_api.js cullDist) at any point a march
   reaches is about -EVERYWHERE -- the point's own coordinates are lost against it in f32 -- and the node's scale
   (positive) keeps it negative, so never above cullMargin(): never culled. Its width, 2e30, is far under f32's largest
   (3.4e38). Not a box just larger than the scene: a node's transform could put a point outside that. */
export const EVERYWHERE = 1e30

/**
 * The never-culling boxes as a row's measurer (bench/index.js boxesFor's shape: `async RT => { known, total, unknown }`).
 * Every node the scene tests a box for (its bxlo_/bxhi_ uniforms declared, codegen.js culled) gets the box that holds
 * everything, known (lo.w 1, as boxes.js cullUniforms marks one), written without restarting the picture. Nothing
 * measured: no GPU round trip. The step cache's box is left as it is: the rows leave the cache off.
 */
export const neverCulls = () => async RT => {
    const U = RT.scene?.uniforms || {}, vals = {}
    let total = 0
    for (const name of Object.keys(U)) {
        const m = /^bxlo_(.+)$/.exec(name)
        if (!m || !(boxHiName(m[1]) in U) || boxLoName(m[1]) !== name) continue
        total++
        vals[name] = [-EVERYWHERE, -EVERYWHERE, -EVERYWHERE, 1]
        vals[boxHiName(m[1])] = [EVERYWHERE, EVERYWHERE, EVERYWHERE, 0]
    }
    if (total) RT.set(vals, false)
    return { known: total, total, unknown: [] }
}

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function boxCostTest(load) {
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const cases = []
    for (const [key, label, file, camera] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        const boxes = boxesFor(doc), S = sceneOf(doc, `boxcost-${key}`, false, 'all')
        const row = { camera, environment: environmentOf(doc) }
        const off = cases.length, unculled = sceneOf(doc, `boxcost-${key}-unculled`, false, false)
        cases.push({ ...row, label: `${label}, boxes off`, way: 'off', scene: unculled, unculled: true, measureBoxes: boxes, compile: true })
        cases.push({ ...row, label: `${label}, boxes that never cull`, way: 'never', scene: S, measureBoxes: neverCulls(), compile: true })
        cases.push({ ...row, label: `${label}, boxes measured`, way: 'measured', scene: S, measureBoxes: boxes, compile: false, sameTextAs: cases.length - 1 })
        /* ...and with a box test on the dear nodes only, the builder's way (sceneOf's default): its own text, compiled --
           unless no node is dear, when it is the scene without boxes, its text the first row's (codegen.js makes it so),
           and that row's scene is timed again */
        const D = sceneOf(doc, `boxcost-${key}-dear`)
        const same = D.wgsl === unculled.wgsl
        cases.push({ ...row, label: `${label}, boxes on the dear nodes only`, way: 'dear', scene: same ? unculled : D, measureBoxes: boxes,
                     compile: !same, ...(same ? { sameTextAs: off } : {}) })
    }
    // sameTextAs is a case's index: "= row 1" in the report
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'boxcost', kind: 'bench',
        title: 'What the box tests cost: four bench scenes with their boxes off, tested but never culling, measured, and on the dear nodes only, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene four ways, back to back --'
            + ' boxes off (made without them: no box test in its text), boxes that never cull (every box written to hold'
            + ' everything: every box tested at every step and every object evaluated, as with no boxes), boxes measured'
            + ' (every box, as the builder made them until 0.34.0), and boxes on the dear nodes only (no box test for a node'
            + ' that is one plain shape; the others measured: the builder\'s way since 0.34.0) -- the same document and camera. Read each scene\'s "gpu ms" (and march,'
            + ' occlude): "never cull" minus "off" is what the box tests cost, with the same evaluations and steps; "never'
            + ' cull" minus "measured" is what the culling saves; "dear only" against "measured" and "off" is whether leaving'
            + ' the plain shapes untested wins. A scene with no dear node has the "off" text for that row ("= row"). The'
            + ' picture should not change between a scene\'s rows. "boxes" is how many top-level nodes had a box (the'
            + ' never-culling ones count). The last row is the first again: if it differs from row 1, so may every row. Save'
            + ' the whole text with the machine\'s name.'
            + ' (bench/boxcost.js, roadmap/ARCHITECTURE.md.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
