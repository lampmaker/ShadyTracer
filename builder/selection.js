//======================================================================================================================
// SELECTION -- which node a click in the picture selects, given the deepest node under it.
//
// The pick names the deepest node whose surface passes through the point (core/pick.js): the column
// inside the twist, the block inside Carved. That is almost never what a click means. What was
// placed, moved and named as one thing is the group, so a click starts at the TOP and goes down on
// request, the way a drawing program treats groups:
//
//   click          the top-level node under the pointer. But once you have gone into a group, a click
//                  on anything else in that group selects what is under the pointer one level inside
//                  it -- you stay inside until you click outside the group. Clicking what is selected
//                  keeps it.
//   shift-click    one level deeper than a click would have selected, along the path under the
//                  pointer: click the twist, shift-click, and it is the column.
//   double-click   straight to the deepest node.
//   Esc            up one level; at the top, nothing.
//
// Pure functions of the document, tested in node (test/selection.test.mjs).
//======================================================================================================================

import { lineage } from './bounds.js'

/** The ids from the top level down to `id`: [top, ..., id]. The root is not a level anyone
 *  selects by clicking (it is the whole scene), so it is not in it. [] if `id` is not in `doc`. */
export function pathTo(doc, id) {
    return lineage(doc, id).filter(n => n !== doc.root).map(n => n.id).reverse()
}

/** The parent of `id`, or null at the top level (or for the root, or an unknown id). */
export function parentOf(doc, id) {
    const up = lineage(doc, id)
    return up.length > 1 && up[1] !== doc.root ? up[1].id : null
}

/**
 * What a click selects.
 * @param leaf      the deepest node under the pointer (the pick's answer)
 * @param selected  what is selected now, or null
 * @param how       'click' | 'deeper' (shift) | 'deepest' (double-click)
 * @returns a node id, or null if `leaf` is not in the document
 */
export function clickTarget(doc, leaf, selected, how = 'click') {
    const path = pathTo(doc, leaf)
    if (!path.length) return null
    if (how === 'deepest') return path[path.length - 1]
    const i = levelOf(doc, path, selected)
    return how === 'deeper' ? path[Math.min(i + 1, path.length - 1)] : path[i]
}

/** Where on the path a plain click lands: the selection itself if it is on the path; otherwise one
 *  level below the deepest group the selection is inside that also holds what was clicked -- the
 *  group you went into, however far in you then went; otherwise the top. */
function levelOf(doc, path, selected) {
    if (selected == null) return 0
    const at = path.indexOf(selected)
    if (at >= 0) return at
    // the selection's groups, nearest first; the root is not on any path, so it never matches
    for (const g of lineage(doc, selected).slice(1)) {
        const p = path.indexOf(g.id)
        if (p >= 0) return Math.min(p + 1, path.length - 1)
    }
    return 0
}
