//======================================================================================================================
// WHAT LIGHTS IN AN ARRAY COST (0.79.0; builder/lights.js A LIGHT INSIDE ARRAYS, roadmap/LIGHT_CONTROL.md). A bench test of
// its own (Tests > lightarray).
//
// WHAT IT ANSWERS. A light inside a group's copies is a face a copy: the SDF draws it in the copies' loop, as any arrayed
// object, and the face table and the photons' sources hold a row a copy. Two things then grow with the count, both read in
// code and neither measured when this was written: shade's pick of a face to sample (tracebasics.js FACE_TABLE
// lightFacePick, a scan over the faces) and the photons' pick of a source (optics/kernels.js optSourceRay, a scan over the
// sources). Inferred: at tens of faces both are noise against a march; at hundreds they may not be. These rows say which,
// and whether a cumulative table with a binary search is worth writing (roadmap/LIGHT_CONTROL.md, Speed).
//
// THE ROWS: a white floor under the same total flux, at 1280 x 720, a dim studio, the lights' own photons (faceSource,
// as the Optics page makes them), baked; one change a row:
//   one light                         4 cm square, 1000 lm
//   16 in a row                       the same light, 62.5 lm each, a row of 16 copies 8 cm apart
//   16 placed by hand                 the same 16 as lights of their own: what the array saves in text, and costs in speed
//   16 x 16 in a ring of rows         3.906 lm each, the row in a ring of 16: 256 faces
//   rows 2 and 4, the window off      every copy walked at every step, as before the window (builder/arrays.js, 0.79.0)
//   row 4's copies by a switch        row 6's every copy, but from the window's first and through the switch the first
//                                     window picked a copy by (codegen.js AN ARRAY, arrayWindow 'every')
//   one light, again                  row 1: if it differs, so may every row
// MEASURED (the user's Ampere, 213642c, 2026-10-23, before the window): rows 1-4 at 61.4, 67.5, 83.6 and 684.2 ms a sample;
// shade -- the face pick -- 21.2, 20.9, 20.5 and 20.0 ms, flat; march 12.3, 19.0, 14.9 and 465.0 ms, occlusion 7.6, 8.7, 8.1
// and 160.0: every copy evaluated at every step, not the pick. So the window (arrays.js), and these rows to time it by.
// Row 3's wall clock was 33 ms over its GPU time where the others' were about 12. Not reproduced: two runs of c9577ae on
// the user's Pascal read it at 67.1 then 46.7 ms over a steady 31.9 and 32.2 of GPU time -- the machine's wander, which
// between those two runs was 23% on row 6 (406.0, 501.3) and 17% between rows 1 and 8 of one run.
// MEASURED (the user's Pascal, a81cac9, 2026-10-25, the first window): the window made it slower -- row 4 1385.1 ms a
// sample (march 1007.5, occlusion 382.7) against row 6's 398.9 (281.0, 87.7); row 2 68.1 (march 15.2, a noisy 50-108)
// against row 5's 50.3 (11.9). COUNTED, not timed (builder/test/arraywindow.gpu.mjs, lavapipe, these documents and camera):
// with the window the ring took 22.0 steps a camera ray against 19.4, the row 12.1 both ways -- so not the steps, each
// step's cost. Inferred, row 7 to test it: the switch picking a copy whose index differs from pixel to pixel. Since then
// a window's copy is worked out from the pattern (arrays.js arrCopy), no switch.
// MEASURED (the user's Pascal, c9577ae, 2026-10-25): row 4 1063.7 ms a sample (march 740.0) against row 6's 406.0
// (279.3); row 7, the switch kept, 584.6 (399.6) -- a part of it. The rest steps: 34% of row 4's camera rays done in the
// first march pass of 32 steps, against 77%. "Not the steps" above was wrong: the count used the document's estimated
// boxes, and these rows measure theirs -- which held every copy of a node in an array (boxes.js toOwnLocalOf). Counted
// with the bench's measured boxes, 47.1 steps a camera ray against 21.9; measured as one copy and bounded by its box
// (arrays.js), 29.6 against 21.4.
// MEASURED (the user's Pascal, f4a2a57, 2026-10-25), those two in: row 4 119.8 ms a sample (march 51.4) against row 6's
// 389.4 (269.7) -- the window 3.3 times faster; row 2's march 8.7 against row 5's 12.6, and the 16 by hand's 9.2.
// The picture is the same light spread differently: what it looks like is the user's to judge (BENCH.lightarray.view(n)).
//======================================================================================================================

import * as Model from '../builder/model.js'
import { baked } from '../builder/bake.js'
import { sourceTable, faceSource } from '../builder/sources.js'
import { generate } from '../builder/codegen.js'
import { BENCH, sceneOf, boxesFor } from './index.js'
import { liveInBench } from './bake.js'

/* the whole flux, every row; the light 4 cm square, facing down from 1.2 m */
export const TOTAL_LM = 1000
const SIZE = 0.04, HEIGHT = 1.2, PITCH = 0.08, RING = 0.9
const at = (x, y, z, rx = 0, ry = 0, rz = 0) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale: 1 })
/* m: 50 degrees down onto the floor from 3 m, the lights at its top */
export const CAMERA = { mode: 'orbit', camtype: 0, fov: 45, azimuth: -60, elevation: 40, target: [0, 0, 0.3], distance: 3 }
const ENVIRONMENT = { envMode: 1, studioIlluminance: 2 }

/** The bench's document: a floor, and `kind` -- 'one', 'row' (16 copies), 'hand' (16 lights of their own) or 'ring' (16 x
 *  16) -- at TOTAL_LM between them. Every id starts `la`: tests.js lays the user's own values under a row by name. */
export function lightArrayDoc(kind) {
    const d = Model.createDoc({ title: `Bench: lights in an array (${kind})` })
    d.environment = { ...ENVIRONMENT }
    Model.addMaterial(d, { id: 'lafloor', label: 'floor', params: { baseColor: { r: 0.8, g: 0.8, b: 0.8 }, metallic: 0, roughness: 1, specular: 0, transmission: 0, ior: 1.5 } })
    Model.addObject(d, 'root', { id: 'lafloorbox', primitive: 'box', material: 'lafloor', params: { size: { x: 2, y: 2, z: 0.05 }, rounding: 0 }, transform: at(0, 0, -0.05) })
    // facing down: +z turned to -z
    Model.addGroup(d, 'root', { id: 'lalamps', transform: at(0, 0, HEIGHT, 180, 0, 0) })
    const count = { one: 1, row: 16, hand: 16, ring: 256 }[kind]
    const light = (parent, id, transform) => Model.addLight(d, parent, { id, shape: 'rectangle', params: { width: SIZE, height: SIZE }, flux: TOTAL_LM / count, transform })
    if (kind === 'one') light('lalamps', 'lalamp', at(0, 0, 0))
    else if (kind === 'hand') Model.copiesRow(16, PITCH, 'x').forEach((t, i) => light('lalamps', `lalamp${i}`, t))
    else {
        // in the ring, the row on its radius, along it, and the ring's copies turned about the lamps' axis
        Model.addGroup(d, 'lalamps', { id: 'larow', transform: kind === 'ring' ? at(RING, 0, 0, 0, 0, 90) : at(0, 0, 0) })
        light('larow', 'lalamp', at(0, 0, 0))
        Model.setCopies(d, 'larow', Model.copiesRow(16, PITCH, 'x'))
        if (kind === 'ring') Model.setCopies(d, 'lalamps', Model.copiesRing(16, 0, 'z'))
    }
    return d
}

/** The lights as the picture's photons take them, the Optics page's way (bench/dichroics.js lightsOf). */
export const lightsOf = doc => sourceTable(doc).sources.filter(x => x.kind !== 'rayset').map(faceSource)

/**
 * The test as a bench test. Nothing to load: the documents are made here.
 */
export async function lightArrayTest() {
    // `window` false: the arrays' copies all walked, as the builder made them before arrays.js; 'every': codegen.js's
    // question only, every copy walked from the window's own first, each picked by the switch the first window used
    const row = (label, kind, extra = {}, window = true) => {
        const doc = lightArrayDoc(kind)
        const made = window === true ? sceneOf(doc, `lightarray-${kind}`)
            : generate(...Model.generateArgs(doc, { id: `lightarray-${kind}-${window ? 'every' : 'all'}`, title: doc.title, arrayWindow: window }))
        return { label, kind, window, scene: baked(made, { live: liveInBench }), camera: CAMERA,
                 environment: structuredClone(ENVIRONMENT), measureBoxes: boxesFor(doc), opticsLight: { perPixel: 1, sources: lightsOf(doc) },
                 baked: true, compile: true, ...extra, set: { ...(extra.set || {}) } }
    }
    const cases = [
        row('one light, 1000 lm', 'one'),
        row('16 in a row (an array), 62.5 lm each', 'row'),
        row('16 placed by hand, 62.5 lm each', 'hand'),
        row('16 x 16 in a ring of rows (arrays), 3.9 lm each', 'ring'),
        row('16 in a row, the window off (every copy walked)', 'row', {}, false),
        row('16 x 16 in a ring of rows, the window off', 'ring', {}, false),
        row('16 x 16 in a ring of rows, every copy from the window\'s first, by a switch', 'ring', {}, 'every'),
    ]
    cases.push({ ...cases[0], label: 'one light, again (drift check)', compile: false, sameTextAs: 0 })
    return {
        id: 'lightarray', kind: 'bench',
        title: 'What lights in an array cost: one light against 16 and 256 copies of it, the same lumens, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel ("shade" holds light sampling\'s pick of'
            + ' a face, "opt_photons" the photons\' pick of a source: both scan every light). A floor under 1000 lm in every row,'
            + ' baked, the lights\' own photons, a dim studio: row 1 one 4 cm light, row 2 sixteen in an array, row 3 the same'
            + ' sixteen as lights of their own (the array\'s text against theirs), row 4 sixteen rows in a ring, 256 faces.'
            + ' Rows 2 and 4 walk a window of each array\'s copies, those near the point (builder/arrays.js); rows 5 and 6 are'
            + ' them with every copy walked, as before: 4 against 6 is what the window saves. Row 7 is row 6\'s copies'
            + ' walked from the window\'s first copy, which differs from pixel to pixel, each picked by a switch as the'
            + ' first window picked them: 7 against 6 is what that costs. Row 8'
            + ' row 1 again: if it differs from row 1, so may every row. The picture is the user\'s to judge:'
            + ' BENCH.lightarray.view(n). Save the whole text with the machine\'s name. (bench/lightarray.js.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
