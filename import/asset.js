//======================================================================================================================
// WHAT THE IMPORT DIALOG'S ANSWERS DO TO THE ASSET (builder/importdialog.js): parts left out, the fitted faces' red
// taken back. Pure, and importing nothing, so the page loads it without the conversion's modules (those come with the
// worker, or on the no-worker fallback's first import).
//======================================================================================================================

/** The material a face fitted to a regular shape wears (import/freeform.js, shapes.js): red, so it can be seen where the
 *  import is not exact (the user, 2026-11-04: "indicate those surfaces with a different (red) material"). */
export const APPROX_ID = 'mapprox'
/** The deviation a freeform face may have from the regular shape it is fitted with, by default, in mm: a twentieth of a
 *  millimetre, under a 3D printer's layer and a machinist's ordinary tolerance (chosen, not measured; the dialog sets
 *  it per import). */
export const MAX_DEVIATION = 0.05

/** The asset without the parts whose group ids are given: an assembly's holder keeps the rest, where they were (each
 *  part's group is a child of it, index.js convert), and the materials and blocks only they used go with them. A part
 *  on its own is the asset's node, so leaving it out leaves nothing: null. The asset given is not changed. */
export function withoutParts(asset, ids) {
    if (!asset) return null
    const drop = new Set(ids)
    if (!drop.size) return asset
    if (drop.has(asset.node.id)) return null
    const node = structuredClone(asset.node)
    node.children = (node.children || []).filter(c => !drop.has(c.id))
    if (!node.children.length) return null
    return pruned({ ...asset, node })
}

/** The asset with its fitted faces in the part's own material, not red: each shape that wore APPROX_ID takes its
 *  group's material instead (the import's: index.js gives every shape the one material it was handed, or none). */
export function withoutRed(asset) {
    if (!asset?.materials?.some(m => m.id === APPROX_ID)) return asset
    const node = structuredClone(asset.node)
    const other = asset.materials.find(m => m.id !== APPROX_ID)?.id ?? null
    const walk = n => {
        if (n.material === APPROX_ID) { if (other != null) n.material = other; else delete n.material }
        for (const c of n.children || []) walk(c)
    }
    walk(node)
    return pruned({ ...asset, node })
}

/* the materials and blocks the node still uses, and no others */
function pruned(asset) {
    const used = new Set(), blocks = new Set()
    const walk = n => { if (n.material != null) used.add(n.material); if (n.block != null) blocks.add(n.block); for (const c of n.children || []) walk(c) }
    walk(asset.node)
    return { ...asset, materials: asset.materials.filter(m => used.has(m.id)), blocks: asset.blocks.filter(b => blocks.has(b.id)) }
}
