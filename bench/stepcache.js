//======================================================================================================================
// THE STEP CACHE ON THE CARD (lib/pathtracer/core/wavefront.js stepCacheWGSL, the renderer's developer setting
// stepCache; roadmap/ARCHITECTURE.md, A lazy step cache). A bench test of its own (Tests > stepcache), a few minutes.
//
// WHAT IT RESTS ON, counted on a software GPU (the same section): over a filled cache, the cells ahead (2) save 28 to 58%
// of the camera rays' full SDF calls and 22 to 56% of the shadow rays' on the bench scenes, and take fewer steps. What a
// lookup costs -- one cell a step for 1, three for 2, at addresses neighbouring rays do not share -- only a card can say.
//
// THE ROWS: each scene six times, back to back -- the cache off, the ball of the cell the ray is in (1), the farthest
// exit among it and the two cells ahead (2) at a million, four million (the default) and sixteen million cells (the
// setting stepCacheCells; 0.24.0, the user: "the card picks the number"), each filled once by a pass of its own before
// the trace and only read in it (wavefront.js prog_stepcache_fill); then the cells ahead filled before every trace
// (stepCacheFill 2), whose "stepcache_fill" kernel time is what a live edit pays at every frame -- the same document,
// text, camera, environment and measured boxes. THREE COMPILES A SCENE: the cache is built into the march and occlusion
// kernels only when on (raytrace_main.js R.kernelOptions), so off, 1 and 2 are each their own kernels -- "off" is the
// kernels without any of it -- and the cell count and the fill's frequency, host-side, are not. The box is the solids'
// measured boxes, padded (builder/stepbox.js), set when a row's boxes are (bench/index.js boxesFor), and filled by the
// first warm-up trace. Codegen, the page's default: the cache is in the march and occlusion kernels, not the scene. Then
// the optics bench as data. The last row is the first again: if it differs from row 1, so may every row.
// (THE LAZY ROWS, 0.23.0 to 0.36.0: the same looks filled by the march on a ray's first visit, stepCacheFill 0. Filled once
// beat them on every scene in the user's run of 0.33.1, and they went in 0.41.0 with the option. So did the last scene's
// grid and exact hits: it was the optics bench as data with both.)
// NOT the Menger cubes: their measured boxes include the marble's, about 1200 m across until 0.33.1 (a bug of the box
// measurement, roadmap/ARCHITECTURE.md) and about 160 m since (lavapipe) -- the cache's box about half a kilometre, its
// four million cells about 3 m each. Left out until a run says the scene is worth a cache row.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl, sceneOf, boxesFor } from './index.js'
import { SCALING_FILES, CAMERAS as SCALING_CAMERAS } from './scaling.js'

/** The scenes, in the order of the rows: [key, label, file, camera, way], `way` { data } or codegen's. */
export const SCENES = [
    ['bench', 'the optics bench', SCALING_FILES.bench, SCALING_CAMERAS.bench],
    ['bench2', 'OpticsBench2', SCALING_FILES.bench2, SCALING_CAMERAS.bench2],
    ['demo', 'the demo', BENCH_FILES.demo, CAMERAS.demo],
    ['showcase', 'the showcase', BENCH_FILES.showcase, CAMERAS.showcase],
    ['materials', 'the material test', BENCH_FILES.materials, CAMERAS.materials],
    ['bench-data', 'the optics bench as data', SCALING_FILES.bench, SCALING_CAMERAS.bench, { data: true }],
]
/** The settings' values, in the order of a scene's rows: [stepCache, stepCacheCells (millions), what the label says,
 *  stepCacheFill (1 when the scene changes, 2 before every trace)]. */
export const MODES = [[0, 4, 'cache off', 1], [1, 4, 'cache filled once, own cell, 4 M cells', 1],
                      [2, 1, 'cache filled once, cells ahead, 1 M cells', 1], [2, 4, 'cache filled once, cells ahead, 4 M cells', 1],
                      [2, 16, 'cache filled once, cells ahead, 16 M cells', 1], [2, 4, 'cache filled every frame, cells ahead, 4 M cells', 2]]
/* which kernels a mode is: the cache's looks alone (the cells and the fill's frequency are the host's) */
export const kernelsOf = ([mode]) => `${mode}`

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function stepCacheTest(load) {
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const cases = []
    for (const [key, label, file, camera, way = null] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        const scene = way ? sceneOf(doc, `stepcache-${key}`, way.data) : sceneOf(doc, `stepcache-${key}`)
        const boxes = boxesFor(doc)
        // sameTextAs is a case's index: "= row n" in the report. Each mode's first row compiles its kernels uncached (0.29.0:
        // the mode is a build), the rows of the same mode with another cell count are its text
        const firstOf = new Map()
        for (const m of MODES) {
            const [mode, cells, how, fill] = m
            const same = firstOf.get(kernelsOf(m))
            if (same === undefined) firstOf.set(kernelsOf(m), cases.length)
            cases.push({
                label: `${label}, ${how}`, scene, camera, environment: environmentOf(doc), measureBoxes: boxes,
                set: { stepCache: mode, stepCacheCells: cells, stepCacheFill: fill }, stepCache: mode, ...(way || {}),
                ...(same === undefined ? { compile: true } : { compile: false, sameTextAs: same }),
            })
        }
    }
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'stepcache', kind: 'bench',
        title: 'The step cache: the optics benches, the demo, the showcase, the material test and the optics bench as data, cache off, own cell, cells ahead at 1, 4 and 16 million cells, then filled every frame, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene six times, back to back:'
            + ' the step cache off, then on with the ball of the cell the ray is in, then with the farthest exit among it and'
            + ' the two cells ahead (the developer setting stepCache 0, 1, 2; lib/pathtracer/core/wavefront.js stepCacheWGSL),'
            + ' that one at a million, four million and sixteen million cells over the scene\'s box (stepCacheCells: finer'
            + ' cells reach closer to surfaces but cost a longer fill) -- every cell filled by a pass of its own before the'
            + ' trace, the march and occlusion kernels only reading them. Off, 1 and 2 are each their own kernels (the cache'
            + ' is compiled in only when on), so each compiles once; "compile ms" is theirs. Read each cached row\'s "march"'
            + ' and "occlude" against its own scene\'s "cache off" row. The last row of a scene fills the cells before every'
            + ' frame (stepCacheFill 2): its "stepcache_fill" time is what a live edit pays a frame; its march and occlude are'
            + ' the 4 M row\'s again. The picture should not change. The last scene is the optics bench as data. The last row'
            + ' is the first again: if it differs from row 1, so may every row. Save the whole text with the machine\'s name.'
            + ' (bench/stepcache.js, roadmap/ARCHITECTURE.md.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
