//======================================================================================================================
// SHADOW RAYS ON DISTANCE ONLY ON THE CARD (lib/pathtracer/core/wavefront.js prog_occlude's distOnly and prog_occlude_emit;
// the renderer's developer setting occludeDist, 0.next). A bench test of its own (Tests > occludedist), a few minutes.
//
// WHY: the march on distance only took 8-79% off the march on the user's Pascal (Tests > marchdist, 2026-10-25,
// docs/PERFORMANCE.md), and shadow rays were 6-35 GPU ms a sample in that run -- every step asking the scene for its whole
// answer and reading one number of it, as the march did. With the setting on a shadow-ray step asks for that number alone;
// the one shadow ray that asks more -- an emitter's, blocked -- is handed to a small kernel that holds the whole scene
// (occlude_emit), dispatched after every round's prep with no group at all when nothing was handed on. The same picture
// (builder/test/occludedist.gpu.mjs). What it saves, and what the extra kernel costs, only a card can say.
//
// THE ROWS: each scene twice, back to back -- the setting off, then on -- the same document, text, camera, environment
// and measured boxes, baked (the build the page shows once the edits stop). Two builds a scene: on, the occlusion kernel is
// another, and the resolve is built. First dichroics as Tests > dichroics row 1 has it: under its studio light, lit by its
// own light's photons, the photon map on. Then the Noise library (its reliefs), the Menger cubes, the showcase, the
// material test and the optics bench. The last row is the first again: if it differs from row 1, so may every row.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { baked } from '../builder/bake.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl, sceneOf, boxesFor } from './index.js'
import { SCENES as DATA_SCENES } from './scenedata.js'
import { liveInBench } from './bake.js'
import { lightsOf } from './dichroics.js'

/** The scenes after dichroics, in the order of the rows: [key, label, file, camera], scenedata.js's. */
export const SCENES = ['noise', 'Menger_cubes', 'showcase', 'materials', 'bench'].map(k => DATA_SCENES.find(s => s[0] === k))

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function occludeDistTest(load) {
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const cases = []
    const scene = (label, S, camera, environment, boxes, extra = {}) => {
        for (const on of [0, 1]) cases.push({
            label: `${label}, ${on ? 'shadow rays on distance only' : 'as it was'}`, scene: S, camera, environment, measureBoxes: boxes, baked: true,
            ...extra, set: { ...(extra.set || {}), occludeDist: on }, compile: true,
        })
    }
    {
        const doc = Model.parse(await load(benchUrl(BENCH_FILES.dichroics)))
        scene('dichroics, its light\'s photons, the photon map on', baked(sceneOf(doc, 'occludedist-dichroics'), { live: liveInBench }),
            CAMERAS.dichroics, environmentOf(doc), boxesFor(doc),
            { opticsLight: { perPixel: 1, sources: lightsOf(doc) }, set: { sppm: 1 } })
    }
    for (const [key, label, file, camera] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        scene(label, baked(sceneOf(doc, `occludedist-${key}`), { live: liveInBench }), camera, environmentOf(doc), boxesFor(doc))
    }
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'occludedist', kind: 'bench',
        title: 'Shadow rays on distance only: dichroics with its light\'s photons, the Noise library, the Menger cubes, the showcase, the material test and the optics bench, off and on, baked, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene twice, back to back: the'
            + ' developer setting occludeDist off, then on -- on, each shadow-ray step asks the scene only how far the nearest'
            + ' surface is, and an emitter\'s shadow ray blocked by something has that thing\'s material asked by a small kernel'
            + ' of its own, "occlude_emit" (lib/pathtracer/core/wavefront.js prog_occlude, prog_occlude_emit). Each its own build,'
            + ' compiled uncached. Read each scene\'s "occlude" down its two rows, and "occlude_emit" beside it, which is what the'
            + ' resolve costs (0 or nearly where no emitter shadow ray runs); "gpu ms" is the sum. The first scene is dichroics'
            + ' as Tests > dichroics row 1 has it: its light\'s photons, the photon map on. Every scene baked, as the page'
            + ' shows it once the edits stop. The picture should not change between a scene\'s rows: that is the user\'s to'
            + ' judge (BENCH.occludedist.view(n)). The last row is the first again: if it differs from row 1, so may every'
            + ' row. Save the whole text with the machine\'s name. (bench/occludedist.js.)',
        extra: { columns: [['occlude_emit', r => r.kernelMs?.occlude_emit, 1]] },
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
