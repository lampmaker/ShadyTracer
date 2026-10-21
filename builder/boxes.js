//======================================================================================================================
// BOXES -- the measured bounding box of every object and group, for the view and for the optics.
//
//   const B = createBoxes({ sample: input => RT.sampleTags(input), doc: () => BUILDER.doc, ready })
//   await B.update()            // measure what changed; a no-op when nothing did
//   B.get(id)                   // { lo, hi } in the node's OWN frame, cell (its accuracy), open -- or null
//   B.corners(doc, id)          // its 8 corners in the world, as the node sits now
//
// NOTHING ON THE CPU KNOWS WHERE AN OBJECT ENDS: every object is WGSL (bounds.js, "there are no boxes
// any more"). The GPU does. core/field.js prog_tagfield evaluates the scene's tagged copy at every
// point of a lattice and says, per point, which object's surface is nearest and how near. The points
// within about a cell of a surface ARE that object's surface, sampled; their extent is its box.
//   COARSE, then FINE. One lattice over the whole scene (COARSE points on its longest side) finds every
//   object roughly; then a lattice of its own (FINE a side) over each object's rough box, padded by a
//   coarse cell, measures it. A 1 mm die in a 1 m room gets a box good to 1/FINE of itself, not of the
//   room. The search starts from the document's estimate (bounds.js estimateBox) and GROWS when an
//   object reaches its edge; an object still at the edge after GROW_TRIES is `open` (an infinite
//   plane): its box is where the search stopped.
//   SAMPLED, NOT TRACED: a point beside an object inside another (an LED die in its silicone) finds it;
//   a ray from outside never would. A sheet (a light, a detector) is found by the points near it.
//   ACCURATE TO ONE FINE CELL (`cell`): a point counts within RADIUS cells of the surface, so the box
//   can be up to that much too big on a side, and a narrow tip between points up to half a cell short.
//
// IN THE NODE'S OWN FRAME. Each surface point is taken back through the node's transforms (and its
// parents') before the box is taken, so the box travels with the node: moving, turning or scaling it --
// or any parent -- needs no measuring, only drawing. What does need it is a change of the node's own
// shape or of a parent's that shapes it (a modifier's code, a smooth blend): geometryKey says what
// that is, and update() measures exactly the nodes whose key moved. A GROUP's box is its children's,
// taken into its frame -- computed -- AND, for a group that folds a shape of its own (code, or CSG), the
// points tagged with the group itself. The tag at a point is the node whose fold was nearest there
// (scene_api.js fold), and a relief's displaced surface or a smooth union's bulge is folded by the group,
// not by its objects: measured from the objects alone, the box of a relief was its undisplaced shape, up to
// `amount` short -- harmless in the overlay, a clipped object once the boxes cull (cullBoxes below).
//   AN OBJECT THAT FOUND NOTHING found nothing OF ITS OWN, AS PLACED THEN: a copy on its original loses every
// tie. It is measured again once the scene changes, and is not fresh until it is (unplacedIn, below). And until it
// has a box, a group whose shape it can add to has no culling box (B.missing, cullBoxes): a group's box is the boxes
// its parts have, and one without its part's would have the culling skip that part.
//
// PURE BUT FOR `sample`, so test/boxes.test.mjs runs it against a sampler of exact spheres and boxes.
//======================================================================================================================

import { find, walk, groupHasCode, codeOf, blockOf } from './model.js'
import { lineage, toParent, estimateBox, framesTo } from './bounds.js'
import { isCsg, shapesOf, joinOf } from './codegen.js'
import { fieldInput, FIELD_GRID, FIELD_MAX_POINTS } from '../lib/pathtracer/core/field.js'

export const COARSE = 64          // points along the scene's longest side
export const FINE = 40            // ...and along each object's
export const RADIUS = 0.9         // a point is on a surface within this many cells (half a cell's diagonal is 0.87)
export const GROW_TRIES = 3       // the search region doubles at most this many times
export const REFINE_PASSES = 4    // fine lattices laid ever closer over an object that is small in its first

//----------------------------------------------------------------------------------------------------------------------
// FRAMES
//----------------------------------------------------------------------------------------------------------------------
/** The inverse of bounds.js toParent: a parent-frame point in the child's frame. */
export function fromParent(t, p) {
    const [cx, sx] = cs(t.rot.x), [cy, sy] = cs(t.rot.y), [cz, sz] = cs(t.rot.z)
    const d = [p[0] - t.pos.x, p[1] - t.pos.y, p[2] - t.pos.z]
    // R^T d, R = Rz * Ry * Rx as in toParent; its rows are toParent's columns
    const r0 = [cz * cy, sz * cy, -sy]
    const r1 = [cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx]
    const r2 = [cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx]
    const dot = r => r[0] * d[0] + r[1] * d[1] + r[2] * d[2]
    return [dot(r0) / t.scale, dot(r1) / t.scale, dot(r2) / t.scale]
}
const cs = deg => { const r = deg * Math.PI / 180; return [Math.cos(r), Math.sin(r)] }
/** The transforms from a node to the world, the node's first; the root's is never applied, and in an array its first
 *  copy's (bounds.js framesTo). */
const framesOf = (doc, id) => framesTo(doc, id)
export const toWorldOf = (doc, id) => { const F = framesOf(doc, id); return p => F.reduce((q, t) => toParent(t, q), p) }
export const toLocalOf = (doc, id) => { const F = framesOf(doc, id); return p => F.reduceRight((q, t) => fromParent(t, q), p) }

//----------------------------------------------------------------------------------------------------------------------
// LATTICES AND POINTS
//----------------------------------------------------------------------------------------------------------------------
/** A lattice over [lo, hi] with `n` points along its longest side and cubic cells, kept under one
 *  dispatch. { origin, cell, nx, ny, nz, count } */
export function latticeFor(lo, hi, n) {
    const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9)
    let cell = span / Math.max(1, n - 1)
    const dims = () => [0, 1, 2].map(k => Math.max(1, Math.ceil((hi[k] - lo[k]) / cell - 1e-9) + 1))
    let [nx, ny, nz] = dims()
    while (nx * ny * nz > FIELD_MAX_POINTS) { cell *= 1.25; [nx, ny, nz] = dims() }
    return { origin: lo.slice(), cell, nx, ny, nz, count: nx * ny * nz }
}
export const latticeInput = L => fieldInput({ mode: FIELD_GRID, count: L.count, origin: L.origin,
    ax: [L.cell, 0, 0], ay: [0, L.cell, 0], az: [0, 0, L.cell], nx: L.nx, ny: L.ny })
const pointOf = (L, i) => {
    const ix = i % L.nx, iy = Math.floor(i / L.nx) % L.ny, iz = Math.floor(i / (L.nx * L.ny))
    return [L.origin[0] + ix * L.cell, L.origin[1] + iy * L.cell, L.origin[2] + iz * L.cell]
}
const onEdge = (L, i) => {
    const ix = i % L.nx, iy = Math.floor(i / L.nx) % L.ny, iz = Math.floor(i / (L.nx * L.ny))
    return ix === 0 || iy === 0 || iz === 0 || ix === L.nx - 1 || iy === L.ny - 1 || iz === L.nz - 1
}

/** From a sample ({ d, tag, tags }) of lattice L: per node id, its surface points in the world and
 *  whether any of them is on the lattice's edge. Map id -> { points: [[x, y, z]...], edge } */
export function surfaces(S, L) {
    const r = RADIUS * L.cell, out = new Map()
    for (let i = 0; i < S.tag.length; i++) {
        const t = S.tag[i]
        if (!t || !(S.d[i] <= r)) continue
        const id = S.tags[t - 1]
        if (id == null) continue
        let e = out.get(id)
        if (!e) out.set(id, e = { points: [], edge: false })
        e.points.push(pointOf(L, i))
        if (onEdge(L, i)) e.edge = true
    }
    return out
}

export const boxOfPoints = (points, map = p => p) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (const p0 of points) { const p = map(p0); for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k] } }
    return hi[0] >= lo[0] ? { lo, hi } : null
}
const cornersOf = b => [0, 1, 2, 3, 4, 5, 6, 7].map(c => [c & 1 ? b.hi[0] : b.lo[0], c & 2 ? b.hi[1] : b.lo[1], c & 4 ? b.hi[2] : b.lo[2]])
const pad = (b, m) => ({ lo: b.lo.map(v => v - m), hi: b.hi.map(v => v + m) })
const union = (a, b) => !a ? b : !b ? a : { lo: a.lo.map((v, k) => Math.min(v, b.lo[k])), hi: a.hi.map((v, k) => Math.max(v, b.hi[k])) }

//----------------------------------------------------------------------------------------------------------------------
// WHAT CHANGES A SHAPE
//----------------------------------------------------------------------------------------------------------------------
/** Everything that decides a node's own shape, and its parents' that shape it -- NOT its transform, nor
 *  its parents' (the box is in its own frame and moves with them), nor its label. Its material only for
 *  the one part of a material that is shape: its relief (materials.js RELIEFS), which grows it by up to the
 *  amplitude -- without it, a relief given to a material never re-measured what wore it. */
export function geometryKey(doc, id) {
    const chain = lineage(doc, id)
    if (!chain.length) return null
    const reliefOf = n => n.kind === 'object' && n.material != null ? doc.materials?.find(m => m.id === n.material)?.relief ?? null : null
    /* a node's JOIN (model version 14) shapes what its surface is in its group -- the cut face of a subtraction
       -- and its siblings' shape it too: every group above carries its children's joins, as it carried its op */
    // its code and constants are its block's (model.js version 16): a block's code edited moves every user's shape
    const own = n => ({ type: n.type, code: codeOf(doc, n), params: n.params, constants: blockOf(doc, n)?.constants, enabled: n.enabled,
                        shape: n.light?.shape, twoSided: n.light?.twoSided, relief: reliefOf(n), join: n.join, joinBlend: n.joinBlend })
    // straightMaterial too: it moves where a relief inside is read, and a relief is shape
    const above = n => ({ code: codeOf(doc, n), params: n.params, blend: n.blend, enabled: n.enabled, straight: n.straightMaterial, copies: n.copies,
                          joins: (n.children || []).map(c => [c.join, c.joinBlend]) })
    /* A GROUP'S OWN SURFACE is made of its children, where they are in it: a child's radius, or a child moved
       inside a relief, moves the surface the group folds -- so its key is its whole subtree, transforms of
       the children included (its own transform still not: the box is in its frame) */
    const below = n => (n.children || []).map(c => [own(c), c.transform ?? null, c.blend, below(c)])
    const self = chain[0].kind === 'group' ? [above(chain[0]), below(chain[0])] : own(chain[0])
    return JSON.stringify([self, ...chain.slice(1).filter(n => n !== doc.root).map(above), doc.functions])
}
/** Does a group fold a shape of its own -- group code, or a CSG combine -- and so tag points of its own? NOT a plain
 *  group that is one of a CSG group's shapes, which codegen combines too since 0.72.1 (combinedGroups): its union at
 *  blend 0 is exactly one of its children's values (csgUnion's select), and fold tags a point only for a STRICTLY
 *  nearer surface (scene_api.js, HIT_TAG_D), so the tag stays that child's -- read in code, not measured: its points
 *  are its children's, its box their boxes (get). With a blend it is a CSG group, and measured. */
export const foldsItself = (doc, n) => n?.kind === 'group' && (groupHasCode(doc, n) || isCsg(n))
/** The nodes the tool measures: objects with a surface (not an export box or a haze box, not a ray file), and the groups
 *  that fold a shape of their own (see the header). */
export const measured = doc => {
    const out = []
    walk(doc, n => {
        if (n.kind === 'object' && n.type !== 'export' && n.type !== 'haze' && !(n.type === 'light' && n.light?.shape === 'rayfile')) out.push(n.id)
        else if (n !== doc.root && foldsItself(doc, n)) out.push(n.id)
    })
    return out
}

//----------------------------------------------------------------------------------------------------------------------
// THE TOOL
//----------------------------------------------------------------------------------------------------------------------
/**
 * @param sample  (input) => Promise<{ d, tag, tags } | null> -- RT.sampleTags; null = not now (the
 *                scene changed while it ran): the update is abandoned and tried again later
 * @param doc     () => the document being measured
 * @param ready   () => whether the scene the renderer shows IS that document, compiled (tags from
 *                another compile would name the wrong nodes)
 * @param wanted  () => the node ids whose boxes are needed (a group stands for the objects in it), or
 *                null for every node. ONLY WHAT IS SHOWN IS MEASURED: every node after every structural
 *                edit was up to ~60 GPU round trips, each waiting behind the frames, and on the Noise
 *                library it took 37 s and ran through the compile of the next edit (PERFORMANCE.md).
 *                Plus whatever request(id) asked for -- the optics page's detector.
 */
export function createBoxes({ sample, doc, ready = () => true, wanted = () => null, onBox = () => { } }) {
    const boxes = new Map()          // id -> { key, scene, box: { lo, hi } | null, cell, open }
    const requested = new Set()
    let running = null, lastDoc = null

    /* the measurable nodes wanted now: all of them, or those named and the objects inside named groups */
    const wantedIn = d => {
        const all = measured(d), w = wanted()
        if (w == null) return all
        const want = new Set(), under = n => {
            if (n.kind !== 'group') { want.add(n.id); return }
            want.add(n.id)                     // kept only if measured() has it: one that folds for itself
            for (const c of n.children || []) under(c)
        }
        for (const id of [...w, ...requested]) { const f = find(d, id); if (f) under(f.node) }
        return all.filter(id => want.has(id))
    }
    /* NO BOX IS "NOTHING OF ITS OWN, AS PLACED THEN". The tag at a point is the nearest fold and a tie keeps the
       first (scene_api.js fold), so a copy on top of its original -- where a new object or a duplicate starts --
       finds no surface of its own. Its key has no transform in it, so moved, it was never measured again: its
       group's box stayed the original's alone and the culling cut the copy off outside it (the user, 2026-10-01:
       two boxes in a group, the second shown only where it overlapped the first). So an OBJECT with no box is
       measured again once the scene has changed in any way (the original moved, deleted, reshaped; the copy
       moved, turned), and is not fresh until it is. NOT one under a group with code that has a box: inside a
       relief the group's fold is the nearer almost everywhere, so its objects find nothing by design (3 of 6 on
       the exact sampler, PERFORMANCE.md), what is seen is the group's own surface, and the group is measured
       again whenever anything under it changes (its key is its subtree) -- without this, every edit anywhere
       would measure them again and leave the Noise library unculled meanwhile. */
    const sceneOf = d => JSON.stringify([d.root, (d.materials || []).map(m => m.relief ?? null), d.functions ?? null])
    const covered = (d, id) => lineage(d, id).slice(1).some(n => n !== d.root && groupHasCode(d, n) && !!boxes.get(n.id)?.box)
    /* per call: the scene's text only once, and only when an object with no box is met */
    const unplacedIn = d => {
        let sig = null
        return id => {
            const e = boxes.get(id)
            if (!e || e.box || find(d, id)?.node?.kind !== 'object') return false
            sig ??= sceneOf(d)
            return e.scene !== sig && !covered(d, id)
        }
    }
    const stale = d => { const unplaced = unplacedIn(d); return wantedIn(d).filter(id => boxes.get(id)?.key !== geometryKey(d, id) || unplaced(id)) }

    const measure = async (d, ids) => {
        const keys = new Map(ids.map(id => [id, geometryKey(d, id)])), scene = sceneOf(d)
        // COARSE: the whole scene, grown while a changed object touches the edge
        let region = estimateBox(d.root, null, d)
        if (!region) return true
        const size = Math.max(...[0, 1, 2].map(k => region.hi[k] - region.lo[k]), 1e-6)
        region = pad(region, 0.25 * size)
        /* EACH NODE'S POINTS FROM THE FINEST COARSE LATTICE THAT FOUND IT (`first`, with that lattice's cell), not the
           last one's. The search grows while any changed object is missing, and a lattice twice as wide has cells twice
           as big: the optics bench's grew three times, to 35 m cells, and its pillars' 0.6 m cylinders, found in the
           first lattice, were in none of the last. Measured from the last alone, they were looked for again over their
           guess padded by 1.5 of those cells -- a 113 m lattice of 2.9 m cells, where they were not found either -- and
           had no box; their group's box was the rest of it, and the scene as data culled the pillar by a box that left
           its cylinders out (lavapipe, 2026-10-07: 0.61 by the box where the surface was 0.23 away). BUT NOT A FINDING AT
           A LATTICE'S EDGE: the object goes on past it, so its points there are a part of it, and a box refined over a
           part is that part -- a wider lattice's finding replaces it. `found` stays the last lattice's, for what is at
           its edge (open). */
        let found = null, L = null, L0 = null
        const first = new Map()
        for (let t = 0; t <= GROW_TRIES; t++) {
            L = latticeFor(region.lo, region.hi, COARSE)
            L0 ??= L
            const S = await sample(latticeInput(L))
            if (!S) return false
            found = surfaces(S, L)
            for (const [id, e] of found) if (!first.has(id) || first.get(id).edge) first.set(id, { ...e, cell: L.cell })
            /* grow while a changed object reaches the edge -- or is not found at all: its code may put it
               far from where its parameters say (the document's guess cannot see that) */
            /* a group's own points may be none at all (a blend with nothing to bulge): only an object's
               absence says the region is too small -- an absence from every lattice so far, not from this one */
            const isObject = id => find(d, id)?.node?.kind !== 'group'
            const touching = ids.some(id => isObject(id) ? (!first.has(id) || !!found.get(id)?.edge) : !!found.get(id)?.edge)
            if (!touching || t === GROW_TRIES) break
            const c = region.lo.map((v, k) => (v + region.hi[k]) / 2), h = region.lo.map((v, k) => region.hi[k] - v)
            region = { lo: c.map((v, k) => v - h[k]), hi: c.map((v, k) => v + h[k]) }       // twice as big
        }
        // FINE: each changed object over its own rough box (and the document's guess, in case the
        // coarse lattice passed it by), padded by a coarse cell
        /* WHERE TO LOOK FOR A GROUP'S OWN SURFACE when the coarse lattice caught none of its points: over its
           objects -- the coarse points they had, or the document's guess of them. The document has no guess for
           a group (estimateBox counts objects), so a group the coarse lattice missed was never measured at all;
           and inside a relief the group's fold is the nearer one almost everywhere (its distance is divided by
           the relief's slope), so its object often finds no points of its own either -- which left the relief
           with no box, never culled. The first run on hardware had 13 of the Noise library's 14 boxes. */
        const objectsRough = n => {
            let b = null
            const walk = m => {
                if (m.enabled === false) return
                if (m.kind === 'object') b = union(b, union(first.get(m.id) ? boxOfPoints(first.get(m.id).points) : null, estimateBox(d.root, m, d)))
                for (const c of m.children || []) walk(c)
            }
            walk(n)
            return b
        }
        /* the document's own guess of where a node is: an object's, or a group's objects' (it has none of its own) */
        const guessOf = n => {
            if (n?.kind !== 'group') return estimateBox(d.root, n, d)
            let b = null
            const walk = m => { if (m.enabled === false) return; if (m.kind === 'object') b = union(b, estimateBox(d.root, m, d)); for (const c of m.children || []) walk(c) }
            walk(n)
            return b
        }
        const span = b => Math.max(...[0, 1, 2].map(k => b.hi[k] - b.lo[k]))
        for (const id of ids) {
            const node = find(d, id)?.node
            const mine = first.get(id)
            // the cell its coarse points were found with; for a node no lattice found, the first lattice's, not the grown one's
            const coarseCell = mine ? mine.cell : L0.cell
            const coarse = mine ? boxOfPoints(mine.points) : null
            const rough = node?.kind === 'group' ? union(coarse, coarse ? null : objectsRough(node)) : union(coarse, estimateBox(d.root, node, d))
            if (!rough) { boxes.set(id, { key: keys.get(id), scene, box: null, cell: coarseCell, open: false }); continue }
            /* REFINED UNTIL THE LATTICE FITS THE OBJECT: the first fine lattice is sized by the coarse cell
               it is padded with, so a 1 mm die in a room got cells bigger than itself. Each pass is laid
               over what the last one found, padded by its cell, until the object fills most of it.
               Resolves to the finest points found and their cell, null for none, false for a sample abandoned. */
            const refine = async around => {
                let got = null
                for (let pass = 0; pass < REFINE_PASSES; pass++) {
                    const F = latticeFor(around.lo, around.hi, FINE)
                    const S = await sample(latticeInput(F))
                    if (!S) return false
                    const mine = surfaces(S, F).get(id)
                    if (!mine) break
                    got = { pts: mine.points, cell: F.cell }
                    const next = pad(boxOfPoints(mine.points), 1.5 * F.cell)
                    if (span(next) > 0.6 * span(around)) break      // it fills the lattice: as fine as it gets
                    around = next
                }
                return got
            }
            let got = await refine(pad(rough, 1.5 * coarseCell))
            if (got === false) return false
            /* NEVER THE GROWN SEARCH'S WORD ALONE. When no fine lattice finds what the coarse one did, the coarse points
               were all there was: up to RADIUS coarse cells from the surface, and the box padded by that cell -- and a
               group takes the coarsest cell of its children. Measured on a software GPU (the scaling bench's lens assembly
               x 32): the optics bench's lens, missed by the first coarse lattice, grew the search to a 48.9 cm cell; two
               stray points of it were the lens's box, and the whole assembly's grew by 49 cm on every side, so every ray
               walked every copy at every step. A lattice laid over the document's own guess of the node, padded by half
               of it, finds it at its own size (the lens: as it is found in the scene alone). Not found there either, it
               keeps what it had, as before: coarse points still hold the surface, only loosely.
               ONLY WHERE THE COARSE LATTICE FOUND IT. A node no lattice found has no box, as before, and costs nothing
               more: tried on every such node, the optics bench's subtracted cylinders were found on their guesses too,
               its groups' boxes grew by up to 0.35 cm, and a whole measure took 228 samples instead of 159. */
            if (!got && mine) {
                const guess = guessOf(node)
                if (guess) {
                    got = await refine(pad(guess, Math.max(0.5 * span(guess), 1e-6)))
                    if (got === false) return false
                }
            }
            const pts = got ? got.pts : mine?.points ?? [], cell = got ? got.cell : coarseCell
            const toLocal = toLocalOf(d, id)
            // still at the edge of the grown search: an object without an end (an infinite plane)
            boxes.set(id, { key: keys.get(id), scene, box: boxOfPoints(pts, toLocal), cell, open: !!found.get(id)?.edge })
            try { onBox(id) } catch (e) { console.warn('[boxes] onBox', e) }       // one more box, as it comes
        }
        return true
    }

    /* a sibling with a box that is the same shape in the same place (B.missing) */
    const twinOf = (d, n, g) => {
        const key = geometryKey(d, n.id), at = JSON.stringify(n.transform ?? null)
        return (g?.children || []).some(c => c !== n && c.kind === 'object' && c.enabled !== false && !!boxes.get(c.id)?.box
            && JSON.stringify(c.transform ?? null) === at && geometryKey(d, c.id) === key)
    }
    const B = {
        /** Measure every node whose shape changed since it was last measured. Resolves to the ids
         *  measured ([] when nothing changed, or when the renderer is not showing this document). */
        async update() {
            if (running) return running
            /* CLEARED WHEN IT SETTLES, not in a finally inside it: a body with nothing to do returns before
               its first await, so its finally ran before `running` was even assigned -- and the settled
               promise stayed in `running`, and every later update returned its [] (the test caught it) */
            const p = (async () => {
                {
                    const d = doc()
                    if (!d || !ready()) return []
                    if (d !== lastDoc) { boxes.clear(); requested.clear(); lastDoc = d }      // another scene: nothing carries over
                    for (const id of [...boxes.keys()]) if (!find(d, id)) boxes.delete(id)
                    const ids = stale(d)
                    if (!ids.length) return []
                    return (await measure(d, ids)) ? ids : []
                }
            })()
            running = p
            p.finally(() => { if (running === p) running = null }).catch(() => { })
            return p
        },
        /** Whether a measure is due: a node whose shape changed, or one never measured. */
        due() { return B.pending() !== '' },
        /** What is due, as a string that changes whenever the shapes do ('' for nothing): a host waits
         *  for it to hold still before measuring, so a slider being dragged is measured once, at rest. */
        pending() {
            const d = doc()
            if (!d) return ''
            const ids = d !== lastDoc ? wantedIn(d) : stale(d)
            if (!ids.length) return ''
            /* an object due only for the scene having changed (see unplacedIn) has the same key all through a drag:
               the scene's text goes in too, so the measuring still waits for it to hold still */
            const unplaced = d !== lastDoc ? () => false : unplacedIn(d)
            return JSON.stringify([...ids.map(id => [id, geometryKey(d, id)]), ids.some(unplaced) ? sceneOf(d) : ''])
        },
        /** A node's box in its own frame -- an object's as measured, a group's from its children. */
        get(id) {
            const d = doc()
            // ids are unique only within a scene: after a switch, 'n1' is another scene's node
            if (d !== lastDoc) return null
            const f = d && find(d, id)
            if (!f) return null
            const n = f.node
            if (n.kind !== 'group') {
                const b = boxes.get(id)
                return b?.box ? { lo: b.box.lo, hi: b.box.hi, cell: b.cell, open: b.open } : null
            }
            /* a group: its own folded points' box, if it has one (see the header), and its children's, each
               through the child's transform into the group's frame. `cell` is the coarsest lattice cell any of
               them was measured with -- in WORLD units, as an object's is (the lattices are laid in the world) */
            const mine = boxes.get(id)
            let box = mine?.box ?? null, cell = mine?.box ? mine.cell : 0, open = !!(mine?.box && mine.open)
            for (const c of n.children) {
                if (c.enabled === false) continue
                const cb = B.get(c.id)
                if (!cb) continue
                // in an array (model.js version 17), at every copy: the group's box holds them all
                for (const k of n.copies?.length ? n.copies : [null]) {
                    const inGroup = cornersOf(cb).map(p => c.transform ? toParent(c.transform, p) : p).map(p => k ? toParent(k, p) : p)
                    box = union(box, boxOfPoints(inGroup))
                }
                cell = Math.max(cell, cb.cell); open = open || cb.open
            }
            return box ? { ...box, cell, open } : null
        },
        /** Whether a node's box is for its shape AS IT IS NOW: an object measured with its current key (and, one
         *  that found no surface, in the scene as it is now: see unplacedIn); a group, when every node measured
         *  under it (itself, if it folds a shape of its own) is. A box can be
         *  had (get) and not be fresh -- the overlay draws it; the culling must not use it. */
        fresh(id) {
            const d = doc()
            if (!d || d !== lastDoc) return false
            const f = find(d, id)
            if (!f) return false
            const ids = new Set(measured(d)), under = [], unplaced = unplacedIn(d)
            const collect = n => { if (n.enabled === false) return; if (ids.has(n.id)) under.push(n.id); for (const c of n.children || []) collect(c) }
            collect(f.node)
            return under.every(u => boxes.has(u) && boxes.get(u).key === geometryKey(d, u) && !unplaced(u))
        },
        /** THE PARTS UNDER A NODE THAT COULD ADD TO ITS SURFACE AND FOUND NONE OF THEIR OWN: the ids of the objects
         *  measured with no box ([] for none). A group's box is its children's (get), and a child with no box adds
         *  nothing to it -- so a box from the rest leaves that child out, and a culling by it skips the child where it
         *  is (the optics bench's pillar and its cylinders, 2026-10-07: see measure's `first`). cullBoxes gives such a
         *  node no box. NOT a part that only takes away (a CSG group's cut or intersection: what is left is inside the
         *  others), nor the objects under a group whose code folds its own shape and has a box (inside a relief its
         *  fold is the nearer almost everywhere, so its objects find nothing by design: unplacedIn), nor a group's own
         *  points, which a CSG group may have none of (a blend with nothing to bulge), nor a copy on top of its original
         *  -- a sibling with a box, the same shape (geometryKey) and the same transform: a tie keeps the first, so the
         *  copy finds nothing, and the original's box is exactly the copy's. */
        missing(id) {
            const d = doc()
            if (!d || d !== lastDoc) return []
            const f = find(d, id)
            if (!f) return []
            const ids = new Set(measured(d)), out = []
            const visit = (n, g) => {
                if (n.enabled === false) return
                if (g && isCsg(g) && shapesOf(g).indexOf(n) > 0 && joinOf(n) !== 'union') return
                const e = boxes.get(n.id)
                if (n.kind === 'object') { if (ids.has(n.id) && e && !e.box && !twinOf(d, n, g)) out.push(n.id); return }
                if (groupHasCode(d, n) && e?.box) return
                for (const c of n.children || []) visit(c, n)
            }
            visit(f.node, null)
            return out
        },
        /** The node's box's 8 corners in the world, as the node sits now; null without a box. The root's
         *  own transform is never applied (bounds.js), so for the root they are its box as it is. */
        corners(d, id) {
            const b = B.get(id)
            if (!b) { B.request(id); return null }          // asked for and not measured: measure it next
            const w = toWorldOf(d, id)
            return cornersOf(b).map(w)
        },
        /** Ask for a node's box although it is not shown (the optics page's detector): measured at the
         *  next update and kept wanted until the scene changes. */
        request(id) { if (id != null) requested.add(id) },
        /** Forget everything: the next update measures every node. */
        clear() { boxes.clear(); requested.clear(); lastDoc = null },
        get busy() { return !!running },
    }
    return B
}

//----------------------------------------------------------------------------------------------------------------------
// THE BOXES THE RENDERER CULLS WITH (codegen's root: each top-level node skipped while farther than its box)
//----------------------------------------------------------------------------------------------------------------------
/** How far a smooth union can bulge past its children, summed over the subtree: csgUnion is
 *  min(a, b) - h*h/(4k), h = max(k - |a - b|, 0), at most k/4 below the nearer of what it joins (scene_api.js). In
 *  WORLD units, as the blend is -- the CSG combine works on distances already taken to the world. Smooth subtraction
 *  and intersection only take away (max(...) + h*h/(4k)): nothing to add for them.
 *  PER UNION JOIN (model version 14), each with its own blend or its group's: the combines run one after another, and
 *  each can go k/4 below what the last one gave. It was k/4 per group, which three equal spheres already exceed --
 *  about 0.39k where all three meet, by the formula; with two children it is the same k/4. */
export const smoothBulge = n => (n.enabled === false || n.kind !== 'group' || !isCsg(n) ? 0
        : shapesOf(n).slice(1).filter(c => joinOf(c) === 'union').reduce((a, c) => a + Math.max(0, c.joinBlend ?? n.blend) / 4, 0))
    + (n.children || []).reduce((a, c) => a + smoothBulge(c), 0)

/**
 * Per top-level node of `doc`, the box its culling test uses, in its own frame -- or null: not known.
 * PADDED to be sure to contain it: by the coarsest lattice cell it was measured with (a narrow tip can be up
 * to half a cell short, the header says) and by every smooth union's bulge -- both in world units, taken
 * into the node's frame by its scale. NULL, so never culled, when a box is missing, `open` (a plane), not
 * fresh (a shape changed and has not been measured since), or made without a part that found no surface
 * (B.missing: the box would leave that part out). A culled object with a box too small would be cut
 * off in the picture; one never culled only costs what it cost before.
 * `B` is createBoxes's, or a view of it that answers all three of fresh, get AND missing. REFUSED without missing, not
 * read as "nothing missing": the bench's view of the boxes (bench/index.js boxesFor `same`) answered fresh and get
 * alone; asked as `B.missing?.()`, its silence passed for "none", and every node on the lens-assembly copy rows,
 * originals and copies, was culled by a box that could leave out a part that found no surface (0.35.3; 0.33.11 on
 * its branch).
 * @returns Map id -> { lo, hi } | null
 */
export function cullBoxes(doc, B, { nested = false } = {}) {
    if (typeof B?.missing !== 'function') throw new Error('cullBoxes: the boxes cannot say which parts found no surface (missing), so no box of theirs is safe to cull by')
    const out = new Map()
    /* NESTED (the scene as data, scenedata.js): every node under plain groups too, as far down as their union goes --
       the records cull each one where codegen culled the top level alone. Not under a CSG group (a lower bound on a
       shape is not one on what it is joined into) nor under group code (its children are its own code's, compiled).
       The padding is world units taken into the node's frame by every scale above it, not its own alone. */
    const visit = (c, above) => {
        /* a hidden node is still emitted when the scene keeps hidden nodes compiled (liveVisibility), and so
           has a box test: unknown while hidden. Shown again, it is measured again (`enabled` is in its key) */
        if (c.enabled === false) { out.set(c.id, null); return }
        const scale = above * (c.transform?.scale ?? 1)
        const b = B.fresh(c.id) ? B.get(c.id) : null
        if (!b || b.open || !(b.cell > 0) || B.missing(c.id).length) out.set(c.id, null)
        else {
            const m = (b.cell + smoothBulge(c)) / scale
            out.set(c.id, { lo: b.lo.map(v => v - m), hi: b.hi.map(v => v + m) })
        }
        // in an array, the smallest copy's scale: a padding in world units is most in its frame there
        const inner = c.copies?.length ? scale * Math.min(...c.copies.map(t => t.scale)) : scale
        if (nested && c.kind === 'group' && !isCsg(c) && !groupHasCode(doc, c)) for (const k of c.children || []) visit(k, inner)
    }
    for (const c of doc?.root?.children || []) visit(c, 1)
    return out
}
/**
 * WHY a top-level node has no culling box -- for the report, since a node never culled costs only speed and so
 * shows nowhere else (the first run on hardware had 13 of the Noise library's 14 and could not say which).
 * @returns [{ id, label, why }] for each node cullBoxes leaves null: 'hidden', 'not measured yet', 'changed
 *          since measured', 'unbounded (open)', or 'no surface found' -- with, for a group, the nodes under it
 *          that found none
 */
export function cullReport(doc, B) {
    const out = []
    const C = cullBoxes(doc, B)
    for (const c of doc?.root?.children || []) {
        if (C.get(c.id)) continue
        const label = c.label ?? c.id
        if (c.enabled === false) { out.push({ id: c.id, label, why: 'hidden' }); continue }
        if (!B.fresh(c.id)) { out.push({ id: c.id, label, why: B.get(c.id) ? 'changed since measured' : 'not measured yet' }); continue }
        const b = B.get(c.id)
        if (b?.open) { out.push({ id: c.id, label, why: 'unbounded (open)' }); continue }
        const lost = b ? B.missing(c.id) : []
        const name = id => { const f = find(doc, id); return f?.node?.label ?? id }
        if (lost.length) { out.push({ id: c.id, label, why: `a part found no surface, so its box would leave it out (${lost.map(name).join(', ')})` }); continue }
        const ids = new Set(measured(doc)), empty = []
        const walk = n => { if (n.enabled === false) return; if (ids.has(n.id) && !B.get(n.id)) empty.push(n.label ?? n.id); for (const k of n.children || []) walk(k) }
        walk(c)
        out.push({ id: c.id, label, why: 'no surface found' + (empty.length ? ` (none for: ${empty.join(', ')})` : '') })
    }
    return out
}

/** The two uniforms' values for a box from cullBoxes: lo.w 1 = known. Unknown is all zeros. */
export const cullUniforms = b => b ? { lo: [...b.lo, 1], hi: [...b.hi, 0] } : { lo: [0, 0, 0, 0], hi: [0, 0, 0, 0] }
