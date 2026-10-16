//======================================================================================================================
// WHERE A GLASS-AND-LIGHT SCENE'S TIME GOES (0.61.2; the user, 2026-10-16: "look for opportunities to improve render
// speed -- use the dichroics scene as an example"). A bench test of its own (Tests > dichroics).
//
// WHY THIS SCENE. Every bench scene before it was timed with the photon map off (tests.js BENCH_BASE), and none was
// lit by a builder light's photons: the page lights the picture with its own scene's lights alone (optics/page.js
// O.picture.applies), so a bench scene's lights shone nothing. dichroics is what the renderer is for now -- a
// collimated light sheet through seven dichroic plates, a mirror and a prism onto a relief floor and two walls, under
// the studio light -- and the photon map does not idle on it: the floor is seen through the plates. Nothing about it
// had been measured on a card (read in code: no row loaded it).
//
// THE ROWS, each the frozen scene (bench/scenes/dichroics.json, the user's scenes/dichroics.json of 2026-10-16) at
// 1280 x 720, its own environment (the studio), its own light's photons (faceSource, as the Optics page makes them),
// one change a row:
//   baked, as it is                 the build the page shows once the edits stop (sceneBake 1), the photon map ON --
//                                   the default the user sees, which no bench row had timed
//   photon map off                  what the map costs: at 1280 x 720 its photons-first plan makes a sample two
//                                   wavefront chains where one would hold it (core/photons.js planInOrder)
//   NEE off, the lights' rays off   what the shadow rays and the light's photons cost (each changes the picture: a cost)
//   1920 x 1080, map on and off     there the camera rays and the photons need two batches either way, so the
//                                   difference is the map's own kernels without the second chain's fixed cost: read
//                                   against the 1280 x 720 pair, it separates the two
//   the step cache filled once      own cell, 4 M cells, as Tests > builds has it
//   codegen                         the editing build (every value a uniform)
//   again                           row 1: if it differs, so may every row (the card drifts 20-38 % in an evening,
//                                   docs/PERFORMANCE_REVIEW.md)
// The columns add the photon map's counts after the timed samples: what it held (M), dropped past its capacity, and the
// gathers cut short at SPPM_VISIT records -- above 0 the floor seen through the plates reads DARK there, a bias the
// user's goal puts before any speed (core/sppm.js).
//======================================================================================================================

import * as Model from '../builder/model.js'
import { baked } from '../builder/bake.js'
import { sourceTable, faceSource } from '../builder/sources.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl, sceneOf, boxesFor } from './index.js'
import { liveInBench } from './bake.js'

/** The frozen document's lights as the picture's photons take them -- the Optics page's way (builder/sources.js). */
export const lightsOf = doc => sourceTable(doc).sources.filter(x => x.kind !== 'rayset').map(faceSource)

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function dichroicsTest(load) {
    const doc = Model.parse(await load(benchUrl(BENCH_FILES.dichroics)))
    const environment = doc.environment ? structuredClone(doc.environment) : {}
    const camera = CAMERAS.dichroics
    const boxes = boxesFor(doc)
    const codegen = sceneOf(doc, 'dichroics-codegen')
    const bakedScene = baked(sceneOf(doc, 'dichroics-baked'), { live: liveInBench })
    const opticsLight = { perPixel: 1, sources: lightsOf(doc) }
    const row = (label, extra = {}) => ({ label, scene: bakedScene, camera, environment, measureBoxes: boxes, opticsLight,
                                          baked: true, ...extra, set: { sppm: 1, ...(extra.set || {}) } })
    const HD = { width: 1920, height: 1080 }
    const cases = [
        row('baked, as it is (photon map on)', { compile: true }),
        row('photon map off', { set: { sppm: 0 }, sameTextAs: 0 }),
        row('NEE off', { set: { nee: 0 }, sameTextAs: 0 }),
        row('the lights\' rays off', { set: { lightRays: 0 }, sameTextAs: 0 }),
        row('1920 x 1080, photon map on', { size: HD, sameTextAs: 0 }),
        row('1920 x 1080, photon map off', { size: HD, set: { sppm: 0 }, sameTextAs: 0 }),
        row('the step cache filled once (own cell, 4 M cells)', { compile: true, set: { stepCache: 1, stepCacheCells: 4, stepCacheFill: 1 } }),
        row('codegen (the editing build)', { scene: codegen, baked: false, compile: true }),
        row('baked, as it is, again (drift check)', { sameTextAs: 0 }),
    ]
    return {
        id: 'dichroics', kind: 'bench',
        title: 'Where a glass-and-light scene\'s time goes: dichroics, its light\'s photons and the photon map, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel ("opt_photons" is the light\'s photon'
            + ' generator, "sppm" the photon map\'s store and gather). The frozen dichroics scene, baked, under its studio light,'
            + ' lit by its own light\'s photons, the photon map on unless a row says otherwise -- the default the page shows,'
            + ' which no bench row timed before. Rows 2-4 change one thing each (rows 3 and 4 change the picture: their'
            + ' time is what that light costs). Rows 5-6 at 1920 x 1080: there the photons and the camera rays need two batches'
            + ' with the map off too, so 5 against 6 is the map\'s own kernels, and 1 against 2 that plus a second wavefront'
            + ' chain. Row 7 the step cache filled once, row 8 the editing build, row 9 row 1 again: if it differs from row 1,'
            + ' so may every row. "map M" photons held (millions), "dropped" past its capacity, "map cut" gathers stopped at their'
            + ' hard cap: above 0 the floor seen through the plates reads dark there (a bias, not noise); "map kept" the share'
            + ' of its stores a sample kept so as not to overfill it (1 while it fits; exact either way, since 0.61.3). The picture'
            + ' is the user\'s to judge: BENCH.dichroics.view(1). Save the whole text with the machine\'s name. (bench/dichroics.js.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        extra: {
            columns: [
                ['map M', r => r.sppmStored, 3],
                ['dropped', r => r.sppmOverflow, 0],
                ['map cut', r => r.sppmCut, 0],
                ['map kept', r => r.sppmKeep, 3],
                ['opt_photons', r => r.kernelMs?.opt_photons, 1],
                ['sppm', r => r.kernelMs?.sppm, 1],
                ['batches', r => r.batches, 0],
            ],
            /* only from a trace that ran the map (R.sppmRan): its counts are the last sample's that did, and a row whose map
               ran no photons once showed another trace's (the first run: "the lights' rays off", 2026-10-16) */
            read: async RT => {
                const m = RT.sppmRan ? RT.sppmStats : null
                return { batches: RT.batches ?? null,
                         ...(m ? { sppmStored: m.stored / 1e6, sppmOverflow: m.overflow, sppmCut: m.cut, sppmKeep: m.keep ?? 1 } : {}) }
            },
        },
        cases,
    }
}
