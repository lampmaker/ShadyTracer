//======================================================================================================================
// THE MARCH ON DISTANCE ONLY ON THE CARD (lib/pathtracer/core/wavefront.js prog_march's distOnly and prog_surface's THE
// HIT ITSELF; the renderer's developer setting marchDist, 0.next). A bench test of its own (Tests > marchdist), a few
// minutes.
//
// WHY: sphere tracing is most of a sample -- march and occlusion 80-86% of the Noise library's and the Menger cubes' GPU
// time on the user's Pascal, march 110 of 182 GPU ms on dichroics on their Ampere (docs/PERFORMANCE.md, measured). Every
// step asked the scene for its whole answer -- each shape's normal, turned into the world, the material, the medium --
// and the march read one number of it. With the setting on a step asks for that number alone, and the surface kernel
// asks for the whole answer once a hit. The same rays and the same picture (builder/test/marchdist.gpu.mjs). What it
// saves a step is the shapes' normal work, so a scene of spheres, lenses and blends should gain more than one of boxes,
// whose distance has no normal anyway (inferred: these rows say).
//
// THE ROWS: each scene twice, back to back -- the setting off, then on -- the same document, text, camera, environment
// and measured boxes, baked (the build the page shows once the edits stop). Two builds a scene: on, the march and the
// surface kernel are other kernels. First dichroics as Tests > dichroics row 1 has it: under its studio light, lit by its
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
export async function marchDistTest(load) {
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const cases = []
    const scene = (label, S, camera, environment, boxes, extra = {}) => {
        for (const on of [0, 1]) cases.push({
            label: `${label}, ${on ? 'on distance only' : 'as it was'}`, scene: S, camera, environment, measureBoxes: boxes, baked: true,
            ...extra, set: { ...(extra.set || {}), marchDist: on }, compile: true,
        })
    }
    {
        const doc = Model.parse(await load(benchUrl(BENCH_FILES.dichroics)))
        scene('dichroics, its light\'s photons, the photon map on', baked(sceneOf(doc, 'marchdist-dichroics'), { live: liveInBench }),
            CAMERAS.dichroics, environmentOf(doc), boxesFor(doc),
            { opticsLight: { perPixel: 1, sources: lightsOf(doc) }, set: { sppm: 1 } })
    }
    for (const [key, label, file, camera] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        scene(label, baked(sceneOf(doc, `marchdist-${key}`), { live: liveInBench }), camera, environmentOf(doc), boxesFor(doc))
    }
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'marchdist', kind: 'bench',
        title: 'The march on distance only: dichroics with its light\'s photons, the Noise library, the Menger cubes, the showcase, the material test and the optics bench, off and on, baked, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene twice, back to back: the'
            + ' developer setting marchDist off, then on -- on, each march step asks the scene only how far the nearest surface'
            + ' is, and the surface kernel asks for the whole hit once, where the ray stopped (lib/pathtracer/core/wavefront.js'
            + ' prog_march, prog_surface). Each its own build, compiled uncached. Read each scene\'s "march" down its two rows,'
            + ' and "surface", which does one look at the scene more a hit; "gpu ms" is the sum. The first scene is dichroics'
            + ' as Tests > dichroics row 1 has it: its light\'s photons, the photon map on. Every scene baked, as the page'
            + ' shows it once the edits stop. The picture should not change between a scene\'s rows: that is the user\'s to'
            + ' judge (BENCH.marchdist.view(n)). The last row is the first again: if it differs from row 1, so may every'
            + ' row. Save the whole text with the machine\'s name. (bench/marchdist.js.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
