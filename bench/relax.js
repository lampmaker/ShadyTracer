//======================================================================================================================
// OVER-RELAXED STEPS ON THE CARD (lib/pathtracer/core/wavefront.js RELAXED STEPS, the renderer's developer setting relax;
// 0.next). A bench test of its own (Tests > relax), a few minutes.
//
// WHY: sphere tracing is most of a sample -- march and occlusion 80-86% of the Noise library's and the Menger cubes' GPU
// time on the user's Pascal, march 110 of 182 GPU ms on dichroics on their Ampere (docs/PERFORMANCE.md, measured). A
// relaxed step goes past the ball it starts in and checks at the next one that the two balls overlap; where a ray runs
// along a surface the balls are small and plain steps many, which is where it should pay. Whether it does, and by how
// much at which factor, only a card can say: nothing here is timed.
//
// THE ROWS: each scene three times, back to back -- relax 1 (the kernels without it: off is not in them at all), 1.3 and
// 1.6 (one build: the factor is a uniform, so 1.6 says "= row" of 1.3) -- the same document, text, camera, environment
// and measured boxes, baked (the build the page shows once the edits stop). First the dichroics scene as Tests >
// dichroics row 1 has it: under its studio light, lit by its own light's photons, the photon map on -- the scene whose
// photons come down onto the floor at 2 degrees. Then the Noise library (its reliefs), the Menger cubes, the showcase,
// the material test and the optics bench. The last row is the first again: if it differs from row 1, so may every row.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { baked } from '../builder/bake.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl, sceneOf, boxesFor } from './index.js'
import { SCENES as DATA_SCENES } from './scenedata.js'
import { liveInBench } from './bake.js'
import { lightsOf } from './dichroics.js'

/** The scenes after dichroics, in the order of the rows: [key, label, file, camera], scenedata.js's. */
export const SCENES = ['noise', 'Menger_cubes', 'showcase', 'materials', 'bench'].map(k => DATA_SCENES.find(s => s[0] === k))
/** The factors, a scene's rows in order: 1 the kernels without it. */
export const FACTORS = [1, 1.3, 1.6]

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function relaxTest(load) {
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const cases = []
    const scene = (label, S, camera, environment, boxes, extra = {}) => {
        // sameTextAs is a case's index: "= row n" in the report. The kernels with the relaxed steps compile once a scene
        let relaxed = null
        for (const f of FACTORS) {
            const same = f > 1 && relaxed !== null ? relaxed : undefined
            if (f > 1 && relaxed === null) relaxed = cases.length
            cases.push({
                label: `${label}, ${f === 1 ? 'relax 1 (off)' : `relax ${f}`}`, scene: S, camera, environment, measureBoxes: boxes, baked: true,
                ...extra, set: { ...(extra.set || {}), relax: f },
                ...(same === undefined ? { compile: true } : { compile: false, sameTextAs: same }),
            })
        }
    }
    {
        const doc = Model.parse(await load(benchUrl(BENCH_FILES.dichroics)))
        scene('dichroics, its light\'s photons, the photon map on', baked(sceneOf(doc, 'relax-dichroics'), { live: liveInBench }),
            CAMERAS.dichroics, environmentOf(doc), boxesFor(doc),
            { opticsLight: { perPixel: 1, sources: lightsOf(doc) }, set: { sppm: 1 } })
    }
    for (const [key, label, file, camera] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        scene(label, baked(sceneOf(doc, `relax-${key}`), { live: liveInBench }), camera, environmentOf(doc), boxesFor(doc))
    }
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'relax', kind: 'bench',
        title: 'Over-relaxed steps: dichroics with its light\'s photons, the Noise library, the Menger cubes, the showcase, the material test and the optics bench, relax 1, 1.3 and 1.6, baked, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene three times, back to back:'
            + ' relax 1 (off: the march and occlusion kernels without it), then 1.3 and 1.6 -- each step that many times the'
            + ' distance known empty, checked at the next step and taken back when the two empty balls do not overlap'
            + ' (lib/pathtracer/core/wavefront.js RELAXED STEPS). 1.3 and 1.6 are one build (the factor is a uniform), so 1.6'
            + ' says "= row" of 1.3. Read each scene\'s "march" and "occlude" down its three rows against its relax 1 row. The'
            + ' first scene is dichroics as Tests > dichroics row 1 has it: its light\'s photons, the photon map on. Every scene'
            + ' baked, as the page shows it once the edits stop. The picture should not change between a scene\'s rows: that is'
            + ' the user\'s to judge (BENCH.relax.view(n)). The last row is the first again: if it differs from row 1, so may'
            + ' every row. Save the whole text with the machine\'s name. (bench/relax.js.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
