//======================================================================================================================
// WHAT LIGHTS IN AN ARRAY COST (0.next; builder/lights.js A LIGHT INSIDE ARRAYS, roadmap/LIGHT_CONTROL.md). A bench test of
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
//   one light, again                  row 1: if it differs, so may every row
// The picture is the same light spread differently: what it looks like is the user's to judge (BENCH.lightarray.view(n)).
//======================================================================================================================

import * as Model from '../builder/model.js'
import { baked } from '../builder/bake.js'
import { sourceTable, faceSource } from '../builder/sources.js'
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
    const row = (label, kind, extra = {}) => {
        const doc = lightArrayDoc(kind)
        return { label, kind, scene: baked(sceneOf(doc, `lightarray-${kind}`), { live: liveInBench }), camera: CAMERA,
                 environment: structuredClone(ENVIRONMENT), measureBoxes: boxesFor(doc), opticsLight: { perPixel: 1, sources: lightsOf(doc) },
                 baked: true, compile: true, ...extra, set: { ...(extra.set || {}) } }
    }
    const cases = [
        row('one light, 1000 lm', 'one'),
        row('16 in a row (an array), 62.5 lm each', 'row'),
        row('16 placed by hand, 62.5 lm each', 'hand'),
        row('16 x 16 in a ring of rows (arrays), 3.9 lm each', 'ring'),
    ]
    cases.push({ ...cases[0], label: 'one light, again (drift check)', compile: false, sameTextAs: 0 })
    return {
        id: 'lightarray', kind: 'bench',
        title: 'What lights in an array cost: one light against 16 and 256 copies of it, the same lumens, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel ("shade" holds light sampling\'s pick of'
            + ' a face, "opt_photons" the photons\' pick of a source: both scan every light). A floor under 1000 lm in every row,'
            + ' baked, the lights\' own photons, a dim studio: row 1 one 4 cm light, row 2 sixteen in an array, row 3 the same'
            + ' sixteen as lights of their own (the array\'s text against theirs), row 4 sixteen rows in a ring, 256 faces. Row 5'
            + ' row 1 again: if it differs from row 1, so may every row. The picture is the user\'s to judge:'
            + ' BENCH.lightarray.view(n). Save the whole text with the machine\'s name. (bench/lightarray.js.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
