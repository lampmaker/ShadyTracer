//======================================================================================================================
// ANSWERS ALONG THE RAY ON THE CARD (lib/pathtracer/core/along.js; codegen.js `along`, wavefront.js prog_march's and
// prog_occlude's `along`; the renderer's developer setting alongRay, 0.next). A bench test of its own (Tests > alongray),
// a few minutes.
//
// WHY: a plain shape -- a sphere, a box, a cylinder, a plane, a rectangle, under plain groups and arrays -- can say how
// far along a ray its surface first is, and the march go there in one step. Counted on a software GPU
// (builder/test/along.gpu.mjs): shadow rays at a 5 degree sun 29.5 -> 4.2 steps on dichroics, 65.1 -> 6.6 on the prism
// scene, 45.1 -> 15.9 on the showcase; the prism scene's grazing rays reaching its table 31 of 320 -> 320. A step with
// answers asks the nearest answering shape a little more (its answer beside its distance). Whether fewer steps at that
// price is less time, only a card can say.
//   THE FIRST RUN (the user's Ampere, 4c69c91, 2026-10-26; docs/PERFORMANCE.md) had every answering shape answer at every
// step: fewer steps, mostly more time. Since, only the nearest answering shape answers, and a culled node's box answers
// where the ray enters it (the user: "try nearest only, and with the boxes"). The rows are the same, so the two runs read
// side by side.
//
// THE ROWS: each scene twice, back to back -- answers off, then on -- the same document, camera, environment and measured
// boxes, baked (the build the page shows once the edits stop). Two texts a scene: on, codegen wrote the answers into it
// (generate's `along`) and the march and occlusion are built to read them. First dichroics as Tests > dichroics row 1 has
// it: under its studio light, lit by its own light's photons, the photon map on. Then the prism scene (scenes/prism-
// dispersion.json, frozen here) from its own view, 5 degrees over its table, lit the same way; the material test in its
// sun, then with the sun at 5 degrees (shadow rays grazing the floor); the Noise library, the Menger cubes, the showcase,
// and the optics bench, whose shapes are all in CSG groups: only its culling boxes answer (its two rows read 12 % apart in
// the first run, when they were the same text: that run's noise). The last row is the first again: if it differs from row 1, so may every row.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { generate } from '../builder/codegen.js'
import { baked } from '../builder/bake.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl, boxesFor } from './index.js'
import { SCENES as DATA_SCENES } from './scenedata.js'
import { liveInBench } from './bake.js'
import { lightsOf } from './dichroics.js'

/** The scenes after the material test, in the order of the rows: [key, label, file, camera], scenedata.js's. */
export const SCENES = ['noise', 'Menger_cubes', 'showcase', 'bench'].map(k => DATA_SCENES.find(s => s[0] === k))
/** The material test's sun for its second pair: 5 degrees over the floor, where the count saw shadow rays gain most. */
export const LOW_SUN = { uSunElevation: 5 }

/** A bench scene as the page generates it (bench/index.js sceneOf), answering along the ray or not. */
export const sceneAlong = (doc, id, along) =>
    generate(...Model.generateArgs(doc, { id, title: doc.title || id, ...(along ? { along: true } : {}) }))

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function alongRayTest(load) {
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const cases = []
    const pair = (label, doc, key, camera, environment, boxes, extra = {}) => {
        for (const on of [0, 1]) cases.push({
            label: `${label}, ${on ? 'answers along the ray' : 'as it is'}`,
            scene: baked(sceneAlong(doc, `alongray-${key}${on ? '-on' : ''}`, on), { live: liveInBench }),
            camera, environment, measureBoxes: boxes, baked: true, ...extra, set: { ...(extra.set || {}) }, compile: true,
        })
    }
    {
        const doc = Model.parse(await load(benchUrl(BENCH_FILES.dichroics)))
        pair('dichroics, its light\'s photons, the photon map on', doc, 'dichroics', CAMERAS.dichroics, environmentOf(doc), boxesFor(doc),
            { opticsLight: { perPixel: 1, sources: lightsOf(doc) }, set: { sppm: 1 } })
    }
    {
        const doc = Model.parse(await load(benchUrl(BENCH_FILES.prism)))
        pair('the prism scene, 5 degrees over its table, its light\'s photons, the photon map on', doc, 'prism', CAMERAS.prism,
            environmentOf(doc), boxesFor(doc), { opticsLight: { perPixel: 1, sources: lightsOf(doc) }, set: { sppm: 1 } })
    }
    {
        const [, label, file, camera] = DATA_SCENES.find(s => s[0] === 'materials')
        const doc = Model.parse(await load(benchUrl(file))), boxes = boxesFor(doc)
        pair(label, doc, 'materials', camera, environmentOf(doc), boxes)
        pair(`${label}, the sun at 5 degrees`, doc, 'materials-lowsun', camera, { ...environmentOf(doc), ...LOW_SUN }, boxes)
    }
    for (const [key, label, file, camera] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        pair(label, doc, key, camera, environmentOf(doc), boxesFor(doc))
    }
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'alongray', kind: 'bench',
        title: 'Answers along the ray: dichroics and the prism scene with their lights\' photons, the material test (its sun, and at 5 degrees), the Noise library, the Menger cubes, the showcase and the optics bench, off and on, baked, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene twice, back to back: as it'
            + ' is, then answering along the ray (the developer setting alongRay: a sphere, box, cylinder, plane or rectangle'
            + ' under plain groups, a plane relief\'s band and a culled node\'s box say where along the ray their surface is --'
            + ' the nearest answering one only, at each step; lib/pathtracer/core/along.js). Each its own text, compiled'
            + ' uncached. Read each scene\'s "march"'
            + ' and "occlude" down its two rows; "gpu ms" is the sum. The first two scenes are lit by their own light\'s'
            + ' photons with the photon map on, as Tests > dichroics row 1 has it; the prism scene is seen from its own view,'
            + ' 5 degrees over its table. The material test runs twice more with the sun at 5 degrees, where shadow rays'
            + ' graze its floor. The optics bench answers by its culling boxes alone (its shapes are all in CSG groups). Every'
            + ' scene baked, as the page shows it once the edits stop. The picture should not change between'
            + ' a scene\'s rows beyond noise: that is the user\'s to judge (BENCH.alongray.view(n)). The last row is the first'
            + ' again: if it differs from row 1, so may every row. Save the whole text with the machine\'s name.'
            + ' (bench/alongray.js.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
