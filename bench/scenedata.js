//======================================================================================================================
// THE SCENE AS DATA AGAINST CODEGEN -- the gate of PERFORMANCE.md P3, call 5: the evaluator (builder/scenedata.js)
// replaces codegen only if it is not slower: march, occlude and shade GPU time within 10% of codegen's, in neighbouring
// and repeated rows.
//
// A third bench test beside the benchmark (bench/index.js) and the scaling one (bench/scaling.js), with its own button.
// Every scene twice, back to back: as codegen makes it (every node its own code, inlined), then as data (one evaluator
// over records) -- the same document, camera, settings and boxes, so the representation is the one change. Then the first
// row again, the drift check.
//
// (THE GRID AND EXACT ROWS, 0.17 to 0.36: as data with the candidate grid, and with exact hits as well -- the march
// asking each closed-form shape where along the ray its surface is. They went with the grid and exact hits in 0.41.0:
// faster than codegen on few scenes, 12 to 30 times its march on the demo and the Menger cubes, roadmap/ARCHITECTURE.md
// step 3 and Removed in 0.41.0, which keep the runs.)
//
// THE SCENES: the benchmark's six (its frozen copies: the Noise library, Surface materials, the showcase, the demo,
// the Menger cubes, the material test), the two optics benches, and the lens assembly x 32 -- the many-objects case P3
// is for, with the scaling rows' tolerance, radius and boxes (bench/scaling.js copyRow). The lens assembly has no
// codegen row: its codegen text was still compiling after ten minutes on the user's Pascal (2026-10-04), so the data
// row is all it can have.
//
// THE BOXES: each row's own (bench/index.js boxesFor), measured over the row's own scene. A data row's go into its
// records, every node's under plain groups -- the records cull each; codegen's at the top level alone. That is part of
// what is compared: what the data path does, not a handicap of either. "known/total" counts what each had.
//
// WHAT A ROW CANNOT SAY: what an edit costs. A structural edit to a scene as data is a buffer write, no compile -- the
// builder's console says so ("scene applied as data: no compile"); the "compile ms" column here is a whole scene's
// first compile, each text uncached, which is what a scene as data pays once, on opening.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { autoEps } from '../lib/pathtracer/core/photometry.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl, sceneOf, boxesFor } from './index.js'
import { SCALING_FILES, CAMERAS as SCALING_CAMERAS, lensCopies, COUNTS } from './scaling.js'

/** The scenes, in the order of the rows: [key, label, file, camera]. The optics benches first (0.21.0): step 3's check was
 *  theirs, and 0.20.8's run lost the GPU at the Menger cubes' exact row, before they ran. */
export const SCENES = [
    ['bench', 'the optics bench', SCALING_FILES.bench, SCALING_CAMERAS.bench],
    ['bench2', 'OpticsBench2', SCALING_FILES.bench2, SCALING_CAMERAS.bench2],
    ['noise', 'the Noise library', BENCH_FILES.noise, CAMERAS.noise],
    ['surfaces', 'Surface materials', BENCH_FILES.surfaces, CAMERAS.surfaces],
    ['showcase', 'the showcase', BENCH_FILES.showcase, CAMERAS.showcase],
    ['demo', 'the demo', BENCH_FILES.demo, CAMERAS.demo],
    ['Menger_cubes', 'the Menger cubes', BENCH_FILES.Menger_cubes, CAMERAS.Menger_cubes],
    ['materials', 'the material test', BENCH_FILES.materials, CAMERAS.materials],
]

/* (THE RAY'S-LIST ROWS, 0.21.6 to 0.22.5: the optics benches and the demo a fifth time, as data with the ray's list and
   no exact hits -- step 3's question whether the list is a gain on its own. The user's Pascal run of 0.21.6 answered it:
   level with codegen on the optics bench, three times the plain data row on the demo (roadmap/ARCHITECTURE.md step 3).
   The rows and the option went in 0.22.5.) */

/**
 * The comparison as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function sceneDataTest(load) {
    const docs = {}
    for (const [key, , file] of SCENES) docs[key] = Model.parse(await load(benchUrl(file)))
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const WAYS = { codegen: [false, 'codegen', ''], data: [true, 'as data', '-data'] }
    const rows = (doc, key, label, camera, { extra = {}, boxes = boxesFor(doc), ways = ['codegen', 'data'] } = {}) => ways.map(w => {
        const [data, how, suffix] = WAYS[w]
        return { label: `${label}, ${how}`, scene: sceneOf(doc, `scenedata-${key}${suffix}`, data),
                 camera, environment: environmentOf(doc), compile: true, measureBoxes: boxes, data, ...extra }
    })
    const cases = SCENES.flatMap(([key, label, , camera]) =>
        rows(docs[key], key, label, camera))
    /* the lens assembly x 32, as the scaling rows have it: one tolerance (x 1's own), one radius, copy 1's box for every
       copy -- the stage and copy 1 measured (bench/scaling.js, THE BOXES) */
    const n = COUNTS.at(-1)
    const one = lensCopies(docs.bench, 1), many = lensCopies(docs.bench, n)
    const eps = autoEps(sceneOf(one.doc, 'scenedata-lens-1').extent, one.doc.unit)
    const stage = many.doc.root.children.filter(c => !many.copies.has(c.id)).map(c => c.id)
    // every copy's parts given their counterpart's box too (scaling.js lensCopies `same`; only the copies were, until 0.22.9)
    cases.push(...rows(many.doc, `lens-${n}`, `lens assembly x ${n}`, SCALING_CAMERAS.lens,
                       { extra: { set: { eps }, copies: n }, boxes: boxesFor(many.doc, { only: stage, same: many.same }), ways: ['data'] }))
    // sameTextAs is a case's index: "= row 1" in the report
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'scenedata', kind: 'bench',
        title: 'The scene as data against codegen: every bench scene both ways, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene twice, back to back: as'
            + ' codegen makes it (every node its own code), then as data (one loop over records; builder/scenedata.js) --'
            + ' the same document, camera, settings and measured boxes. The gate'
            + ' (PERFORMANCE.md P3, call 5): a data row\'s "march", "occlude" and "shade" within 10% of the codegen row\'s,'
            + ' on every scene. The lens assembly x 32 has no codegen row (over ten minutes to compile). "compile ms" is each text'
            + ' compiled uncached, once, shade included -- which a scene change takes from the cache since 0.20.8 (each'
            + ' kernel\'s ready time is in the JSON, compileReadyAt); an edit to a scene as data compiles nothing (the'
            + ' console\'s "applied as data"). The last row is the first again: if it differs from row 1, so may every row.'
            + ' Since 0.20.8 no kernel has more than 8 storage bindings (the scene\'s buffer is the surface kernel\'s). Save'
            + ' the whole text with the machine\'s name. (bench/scenedata.js, PERFORMANCE.md.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
