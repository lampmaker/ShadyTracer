//======================================================================================================================
// THE STEP CACHE'S BOX (lib/pathtracer/core/wavefront.js stepCacheWGSL, the renderer's developer setting stepCache):
// the space its grid of cells covers, in the scene's units -- the union of the measured boxes of the scene's solids, in
// the world, padded. A solid with no box (a floor: unbounded) adds nothing, and a ray outside the box asks the scene as
// ever. The renderer cuts the box into about four million cells (raytrace_main.js R.setStepCacheBox).
//
// FROM THE RECORDS, whatever the scene's form: the scene as data's records carry each solid's frame to the world and its
// box (scenedata.js solidsOf, worldBoxOf), so they are made for the document -- codegen's scene or data's, the same
// document -- with the boxes measured for culling, and their world boxes joined. A scene the records cannot hold (CSG
// deeper than the evaluator's room: codegen.js dataRefused) has no box: its cache stays off.
//
// PADDED a tenth of the box's largest side each way, so the open space just around the objects is covered too: in the
// simulation (roadmap/ARCHITECTURE.md, A lazy step cache) a box a twentieth larger round the camera rays' hits covered
// more of the Menger cubes' camera approach and saved more there. Inferred, not measured on the card: how much pad pays.
//======================================================================================================================

import * as Model from './model.js'
import { generate } from './codegen.js'
import { cullBoxes } from './boxes.js'
import { solidsOf } from './scenedata.js'

/** The box over a document's solids with measured boxes (`boxes`: a box measurer, boxes.js createBoxes, or anything
 *  cullBoxes reads), padded by `pad` of its largest side each way: { lo, hi }, or null when no solid has a box. */
export function stepCacheBox(doc, boxes, { pad = 0.1 } = {}) {
    const [tree, opts] = Model.generateArgs(doc, { id: 'stepbox', data: true })
    const D = generate(tree, opts)
    if (typeof D.dataOf !== 'function') return null
    const r = D.dataOf(Model.toTree(doc, { keepDisabled: true }), cullBoxes(doc, boxes, { nested: true }))
    return r ? unionBox(solidsOf(r.data).map(s => s.box).filter(Boolean), pad) : null
}

/** World boxes ({ lo, hi }) joined and padded by `pad` of the largest side each way; null for none. */
export function unionBox(list, pad = 0.1) {
    if (!list.length) return null
    const lo = [0, 1, 2].map(k => Math.min(...list.map(b => b.lo[k])))
    const hi = [0, 1, 2].map(k => Math.max(...list.map(b => b.hi[k])))
    const p = pad * Math.max(...hi.map((v, k) => v - lo[k]))
    return { lo: lo.map(v => v - p), hi: hi.map(v => v + p) }
}
