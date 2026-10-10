//======================================================================================================================
// WHICH BUILD RENDERS FASTEST (0.32.0; the user, 2026-10-07: "find the optimal solution(s) for highest render speed and
// most flexible editing"). A bench test of its own (Tests > builds).
//
// THE QUESTION: since 0.29.0 every option is a build, and since 0.31.0 editing and rendering can be different builds of
// one scene -- the editing build shown while edits come, the baked one once they stop (builder/baker.js). For editing
// the answer is the scene as data, which compiles nothing per edit. For rendering the candidates have been benched one
// at a time (Tests > bake, > scenedata, > stepcache), never side by side, and never combined. This puts them side by
// side, per scene, on the user's card.
//
// THE ROWS: each bench scene five ways, back to back -- the same document, camera, environment and measured boxes:
//   codegen                                   the page's default today, every value a uniform
//   baked                                     codegen's text, every value a constant (builder/bake.js): what the bake
//                                             mode shows once the edits stop
//   baked, step cache                         the same with the step cache, filled once, own cell, 4 M cells
//   as data                                   the editing build that compiles nothing per edit (builder/scenedata.js)
//   as data, step cache                       the same with the cache, as the baked row has it
// (THE DATA ROWS WERE "as data, grid and exact hits" until 0.41.0, when the candidate grid and exact hits went; the
// runs of 0.32.0 and 0.33.1 timed those. So a data row now is not comparable with those runs' data rows.)
// THE CACHE ROWS FILLED ONCE, OWN CELL since 0.33.3 (they were the cells ahead, filled as rays go, which went in 0.41.0):
// the stepcache run of 0.33.1 had filled once faster than filled as rays go in every scene, and the own cell the better
// look on four of six (roadmap/ARCHITECTURE.md, The step cache filled once, read-only). The cells are filled in the
// warm-up, so the timed samples do not hold the fill.
// Each its own kernels, each compiled uncached: "compile ms" is what making that build costs (for the baked rows, what a
// bake in the background costs after an edit). The step cache's box is set with the row's boxes (bench/index.js boxesFor),
// filled by the first warm-up trace. The culling boxes stay uniforms in the baked rows, as the bake mode keeps them.
// NOT THE MENGER CUBES' CACHE ROWS: their measured boxes include the marble's, about 1200 m across until 0.33.1 and about
// 160 m since (a bug of the box measurement, roadmap/ARCHITECTURE.md; bench/stepcache.js leaves them out for the same
// reason). The last row is the first again: if it differs from row 1, so may every row.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { baked } from '../builder/bake.js'
import { BENCH, benchUrl, sceneOf, boxesFor } from './index.js'
import { SCENES } from './scenedata.js'
import { liveInBench } from './bake.js'

export { SCENES }

/** The ways, in the order of a scene's rows: [key, label, { data, bake, stepCache }]. Every cache filled once. */
export const WAYS = [
    ['codegen', 'codegen', {}],
    ['baked', 'baked', { bake: true }],
    ['baked-cache', 'baked, step cache filled once', { bake: true, stepCache: 1 }],
    ['data', 'as data', { data: true }],
    ['data-cache', 'as data, step cache filled once', { data: true, stepCache: 1 }],
]
/** The scenes whose cache rows are left out, and why. */
export const NO_CACHE = { Menger_cubes: 'its measured boxes include the marble\'s, about 160 m across' }

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function buildsTest(load) {
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const cases = []
    for (const [key, label, file, camera] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        const boxes = boxesFor(doc)
        for (const [way, how, w] of WAYS) {
            if (w.stepCache && NO_CACHE[key]) continue
            const id = `builds-${key}-${way}`
            const S = w.data ? sceneOf(doc, id, true) : sceneOf(doc, id)
            cases.push({
                label: `${label}, ${how}`, scene: w.bake ? baked(S, { live: liveInBench }) : S, camera, environment: environmentOf(doc),
                measureBoxes: boxes, compile: true, set: { stepCache: w.stepCache ?? 0, stepCacheCells: 4, stepCacheFill: 1 },
                way, ...(w.data ? { data: true } : {}), ...(w.bake ? { baked: true } : {}),
            })
        }
    }
    // sameTextAs is a case's index: "= row 1" in the report
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'builds', kind: 'bench',
        title: 'Which build renders fastest: every bench scene as codegen, baked, baked with the step cache filled once, as data, and that with the cache, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene five ways, back to back --'
            + ' codegen (every value a uniform), baked (every value a constant: what the bake mode shows once the edits stop),'
            + ' baked with the step cache (filled once before the trace, own cell, 4 M cells), as data (the build that'
            + ' compiles nothing per edit), and that with the cache -- the same document, camera and measured boxes. Each its'
            + ' own kernels, each compiled uncached: "compile ms" is what that build costs to make. Read each scene\'s "gpu ms"'
            + ' (and march, occlude) down its five rows: the lowest is the build to render it with. The Menger cubes have no'
            + ' cache rows (their measured boxes include the marble, about 160 m: the cache would be spread over it). The'
            + ' picture should not change between a scene\'s rows. The last row is the first again: if it differs from row 1,'
            + ' so may every row. Save the whole text with the machine\'s name. (bench/builds.js,'
            + ' roadmap/ARCHITECTURE.md.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
