//======================================================================================================================
// THE DATA WALK'S OWN COST -- why a small scene as data marches 3 to 9 times slower than as codegen (roadmap/ARCHITECTURE.md,
// after step 4), split on the user's card.
//
// A bench test of its own (bench/index.js's runner, with its own button), a few minutes. What it rests on, counted on a
// software GPU (camera rays from the bench's camera, its boxes): the Menger cubes take 107.6 steps a ray as codegen and
// 107.6 as data, the demo 34.0 and 34.0, with the same hits, and the data walk visits 11.4 and 8.3 records a step. So the
// gap is what one step costs, which only a card can say. In the user's scenedata run of 0.22.6 (Pascal), data / codegen
// march: the material test, Surface materials and the showcase 3 to 4 times (no group with code in them); the demo and
// the Menger cubes about 9 (twist, bend and mirror groups, whose frames the walk keeps in two small arrays); the optics
// benches and the Noise library 0.8 to 1.4.
//
// THE ROWS, each codegen then as data, the same document, camera, settings and measured boxes:
//   the Menger cubes                          as the benchmark has them: the reference, about 9 times in 0.22.6. As data
//                                             the walk keeps two warps' frames (bend, twist: its `astack`) and one
//                                             subtraction's (the cube minus its depth-2 copy: its `stack`)
//   ...without their warps                    the bend and the twist made plain groups -- the same objects, transforms
//                                             and boxes, no group code, no `astack`; the subtraction stays. If the ratio
//                                             falls toward the material test's, the warps' frames are the extra cost
//   one Menger cube                           the depth-4 cube alone at the top level, nothing else, no array at all: the
//                                             walk's bare cost around one object whose code is the same function in both.
//                                             Its own camera, nearer, so the cube fills the picture (from the scene's,
//                                             6% of the camera's rays met it; from this one 46%, counted)
//   the material test                         four objects, no group code: the 3-to-4-times case, in the same run
//   the Menger cubes again                    the drift check
// The warps change the steps (a twist and a bend shorten them, both ways alike: counted on a software GPU, 107.6 steps a
// camera ray with them, 52.5 without, 30.5 for the cube alone, the same as codegen and as data in each), so a row's ratio
// to its own codegen row is the measure, not its time against another scene's.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl, sceneOf, boxesFor } from './index.js'

/** The Menger cubes' first cube: 'menger', depth 4, in the bend's group (bench/scenes/Menger_cubes.json). */
export const MENGER_ID = 'n1'
/** The cube alone's camera: the scene's, nearer, on the cube (at the origin, about 9 m across). */
export const ONE_CUBE_CAMERA = { ...CAMERAS.Menger_cubes, target: [0, 0, 0], distance: 18 }

/** The document with every group that has code made a plain group: its block and parameters gone, its transform and
 *  children kept. Pure. */
export function withoutGroupCode(base) {
    const doc = structuredClone(base)
    Model.walk(doc, n => {
        if (n !== doc.root && n.kind === 'group' && Model.groupHasCode(doc, n)) { delete n.block; delete n.params }
    })
    return Model.parse(Model.serialize(doc))
}

/** Node `id` alone at the top level, with its own transform, and nothing else. Pure. */
export function alone(base, id) {
    const doc = structuredClone(base)
    Model.move(doc, id, 'root')
    for (const c of [...doc.root.children]) if (c.id !== id) Model.remove(doc, c.id)
    return Model.parse(Model.serialize(doc))
}

/**
 * The test as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function overheadTest(load) {
    const menger = Model.parse(await load(benchUrl(BENCH_FILES.Menger_cubes)))
    const materials = Model.parse(await load(benchUrl(BENCH_FILES.materials)))
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    // a pair: codegen then as data, one document, one box measurer (each row writes the boxes its way, bench/index.js)
    const pair = (doc, key, label, camera) => {
        const boxes = boxesFor(doc)
        return [false, true].map(data => ({
            label: `${label}, ${data ? 'as data' : 'codegen'}`, scene: sceneOf(doc, `overhead-${key}${data ? '-data' : ''}`, data),
            camera, environment: environmentOf(doc), compile: true, measureBoxes: boxes, data,
        }))
    }
    const cases = [
        ...pair(menger, 'menger', 'the Menger cubes', CAMERAS.Menger_cubes),
        ...pair(withoutGroupCode(menger), 'menger-plain', 'the Menger cubes without their warps', CAMERAS.Menger_cubes),
        ...pair(alone(menger, MENGER_ID), 'menger-one', 'one Menger cube', ONE_CUBE_CAMERA),
        ...pair(materials, 'materials', 'the material test', CAMERAS.materials),
    ]
    // sameTextAs is a case's index: "= row 1" in the report
    cases.push({ ...cases[0], label: `${cases[0].label}, again (drift check)`, compile: false, sameTextAs: 0 })
    return {
        id: 'overhead', kind: 'bench',
        title: 'The data walk\'s own cost: the Menger cubes with and without their warps, one cube, the material test, codegen and as data, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Each scene twice, back to back: as'
            + ' codegen makes it (every node its own code, inlined), then as data (one loop over records; builder/scenedata.js)'
            + ' -- the same document, camera, settings and measured boxes. Read each data row\'s "march" against its own'
            + ' codegen row\'s. Rows 3-4 are the Menger cubes with their bend and twist made plain groups (no group code, no'
            + ' warp, no warp frames for the walk to keep; the subtraction stays); rows 5-6 one Menger cube alone, nearer;'
            + ' rows 7-8 the material test, which has no group code. Counted on a software GPU, both ways take the same steps'
            + ' a ray, so a ratio is'
            + ' what a step costs. The last row is the first again: if it differs from row 1, so may every row. Save the'
            + ' whole text with the machine\'s name. (bench/overhead.js, roadmap/ARCHITECTURE.md.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
