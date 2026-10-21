//======================================================================================================================
// WHAT AN IMPORTED PART COSTS TO RENDER (0.73.0, import/; the user, 2026-10-21: "investigate possibilities to optimize
// these for sdf/pathtracing. Eg conversion to primitives with boolean operations if that helps"). A bench test of its own
// (Tests > imported).
//
// WHAT IT ANSWERS. A STEP or STL part comes in as the builder's shapes joined by union, intersect and subtract
// (import/csg.js, shapes.js): exact, but as many shapes as the conversion found. The rounded box is 14 shapes in one
// group where a person would write one rounded box; the lens 3 where the builder has a lens. What that costs a march
// step is the one number the conversion's next step waits on: whether to recognise such patterns (a rounded box from its
// fillets, a lens from its spheres), or whether the formula as it is costs no more than its box test spares
// (roadmap/IMPORT.md section 11). Nothing here was measured on a card when it was written.
//
// THE ROWS, each the frozen scene (bench/scenes/imported.json, the Imported parts example of 0.73.0: six STEP fixtures and
// the rounded box again from its STL) at 1280 x 720, its own sun, one change a row:
//   as imported, baked                   the build the page shows once the edits stop
//   the rounded boxes and the lens as one shape each
//                                        each as the one preset a person would use (box with rounding 2, lens): what
//                                        recognising those two patterns would save, the rest unchanged
//   the floor alone                      the parts taken away: what is left is the floor's, the sky's and the sun's
//   as imported, codegen                 the editing build (every value a uniform)
//   as imported, baked, again            row 1: if it differs, so may every row
//======================================================================================================================

import * as Model from '../builder/model.js'
import { baked } from '../builder/bake.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl, sceneOf, boxesFor } from './index.js'
import { liveInBench } from './bake.js'

/* the parts the second row makes one shape each, by their group's label in the frozen scene: what each is as made
   (import/test/fixtures/make.py): the box 20 x 14 x 10 with every edge rounded 2; the lens 12 across, 4 thick, its +z
   face R 20 and its -z face R 30, both convex */
export const ONE_SHAPE = {
    'roundbox.step': { primitive: 'box', label: 'rounded box', params: { size: { x: 10, y: 7, z: 5 }, rounding: 2 } },
    'roundbox.stl': { primitive: 'box', label: 'rounded box', params: { size: { x: 10, y: 7, z: 5 }, rounding: 2 } },
    'lens.step': { primitive: 'lens', label: 'lens', params: { diameter: 12, thickness: 4, r1: 20, r2: 30 } },
}

/** The frozen document with those parts made one shape each: the group kept (its place), its children replaced. */
export function oneShapeEach(doc) {
    const d = structuredClone(doc)
    for (const g of d.root.children.filter(n => ONE_SHAPE[n.label])) {
        const first = (function find(n) { return n.kind === 'object' ? n : n.children.map(find).find(Boolean) })(g)
        const material = first.material
        for (const c of g.children.slice()) Model.remove(d, c.id)
        Model.addObject(d, g.id, { ...structuredClone(ONE_SHAPE[g.label]), material })
    }
    return d
}
/** ...and with the parts taken away: the floor alone. */
export function floorAlone(doc) {
    const d = structuredClone(doc)
    for (const n of d.root.children.filter(n => n.kind === 'group')) Model.remove(d, n.id)
    return d
}

export async function importedTest(load) {
    const doc = Model.parse(await load(benchUrl(BENCH_FILES.imported)))
    const environment = doc.environment ? structuredClone(doc.environment) : {}
    const camera = CAMERAS.imported
    const one = oneShapeEach(doc), bare = floorAlone(doc)
    const bake = (d, id) => baked(sceneOf(d, id), { live: liveInBench })
    const scene = bake(doc, 'imported-baked'), boxes = boxesFor(doc)
    const row = (label, extra = {}) => ({ label, scene, camera, environment, measureBoxes: boxes, baked: true, ...extra, set: { ...(extra.set || {}) } })
    const cases = [
        row('as imported, baked', { compile: true }),
        row('the rounded boxes and the lens as one shape each', { scene: bake(one, 'imported-one'), measureBoxes: boxesFor(one), compile: true }),
        row('the floor alone', { scene: bake(bare, 'imported-floor'), measureBoxes: boxesFor(bare), compile: true }),
        row('as imported, codegen (the editing build)', { scene: sceneOf(doc, 'imported-codegen'), baked: false, compile: true }),
        row('as imported, baked, again (drift check)', { sameTextAs: 0 }),
    ]
    return {
        id: 'imported', kind: 'bench',
        title: 'What an imported part costs: STEP and STL parts as the builder\'s shapes, against one shape each, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. The frozen Imported parts example'
            + ' (six STEP parts and the rounded box again from its STL, each converted into boxes, cylinders, cones, spheres,'
            + ' tori and rounded prisms by File > Import), baked, in its sun. Row 2 makes the two rounded boxes (14 shapes each as imported)'
            + ' and the lens (3) one built-in shape each: row 1 against row 2 is what recognising those patterns would save.'
            + ' Row 3 is the floor alone: row 1 less row 3 is what the parts cost. Row 4 the editing build, row 5 row 1 again:'
            + ' if it differs from row 1, so may every row. The picture is the user\'s to judge: BENCH.imported.view(1).'
            + ' Save the whole text with the machine\'s name. (bench/imported.js.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
