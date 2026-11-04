//======================================================================================================================
// PRINT EXPORT -- the part of a scene that becomes a printable file (3MF with colour, or STL), and the
// export that makes it.
//
// NO OBJECT IN THE SCENE (0.next). This was an "export box", a node of its own type added from the +
// menu, only so that its panel could hold the Export buttons; it sat in the tree, in the undo history and
// in every file afterwards. Now File > Export > 3D print... (printdialog.js) asks what to print -- the
// SELECTED OBJECT or the WHOLE SCENE -- and offers a box fitted to it, which the user may change. The box
// lives in the dialog and nowhere else: nothing is added to the scene, so nothing has to be taken away.
// A file of version 26 or older that has an export box opens without it (model.js v26to27).
//
// THE BOX, `box` below: { frames, lo, hi } -- a box from lo to hi in a frame of its own, and `frames` the
// transforms from that frame to the world, innermost first (bounds.js framesTo's order). For an object it
// is the object's own frame and its measured box there (boxes.js get), so a turned part prints in its
// own orientation; for the scene, the world. THE BOX'S FRAME IS THE PART'S: its z is up on the print bed
// and its min corner the file's origin.
//
// WHAT IS EXPORTED is everything solid inside the box, cut by its faces -- of the scene the renderer
// shows (the render copy: an optics limiter is not in it, and a light is a sheet with no inside), or, for
// one object, of a scene made of THAT OBJECT ALONE (subjectTree), compiled for the export: a box fitted to
// an object still holds the edges of its neighbours, which "the selected object" must not print.
//   cell      the grid's spacing, in MILLIMETRES of the printed part -- a printer's number, not the
//             scene's, so it means the same in a metre scene and a millimetre one
//   colours   how many colours a 3MF may have: the filaments the printer holds
//
// HOW (see each file's header):
//   1. the grid (exportGrid): cells of about `cell` mm fitted to the box exactly, with the box's
//      faces half-way between grid planes and one plane of points outside each face;
//   2. the scene's signed field at every point, on the GPU (lib/pathtracer/core/field.js), a slab
//      of z-layers per dispatch;
//   3. cut by the box: max(field, distance to the box), so the part is closed where the box cuts it;
//   4. a closed mesh by marching tetrahedra, streamed a layer at a time (mesh.js);
//   5. the colour at each triangle's centre, on the GPU again, reduced to `colours` (mesh.js quantize);
//   6. the file (print.js).
//
// PURE EXCEPT runExport, which talks to the renderer through the `sample` it is given and nothing else;
// the host downloads what it returns.
//======================================================================================================================

import { lineage, toParent, framesTo } from './bounds.js'
import { find, toTree } from './model.js'
import { UNITS } from '../lib/pathtracer/core/photometry.js'
import { FIELD_GRID, FIELD_POINTS, FIELD_MAX_POINTS, fieldInput } from '../lib/pathtracer/core/field.js'
import { createMesher, centroids, quantize, toSRGB, openEdges } from './mesh.js'
import { write3MF, writeSTL } from './print.js'

export const EXPORT_DEFAULTS = Object.freeze({ cell: 0.4, colours: 4 })
export const FORMATS = ['3mf', 'stl']
/** Refused past this: a layer of the grid has to fit one dispatch (field.js). */
export const MAX_LAYER = FIELD_MAX_POINTS
/** ...and past this in all, which is already an hour of meshing and a file no slicer wants. */
export const MAX_POINTS = 1.2e9

/** Everything wrong with the export's settings { cell, colours }, as strings. */
export function settingsProblems(E) {
    const p = []
    if (!(Number.isFinite(E?.cell) && E.cell > 0)) p.push('the cell must be mm > 0')
    if (!(Number.isInteger(E?.colours) && E.colours >= 1 && E.colours <= 64)) p.push('the colours must be a whole number from 1 to 64')
    return p
}

/** Everything wrong with a box { frames, lo, hi }, as strings. */
export function boxProblems(box) {
    if (!box || !Array.isArray(box.frames) || !Array.isArray(box.lo) || !Array.isArray(box.hi)) return ['no box']
    for (let k = 0; k < 3; k++) {
        if (!(Number.isFinite(box.lo[k]) && Number.isFinite(box.hi[k]))) return ['the box is not a number']
        if (!(box.hi[k] > box.lo[k])) return [`the box has no size along ${'xyz'[k]}`]
    }
    return []
}

/** The box's centre and full size, in its own frame; and a box made from a centre and a size in a frame. */
export const centreOf = box => [0, 1, 2].map(k => (box.lo[k] + box.hi[k]) / 2)
export const sizeOf = box => [0, 1, 2].map(k => box.hi[k] - box.lo[k])
export const boxOf = (frames, centre, size) => ({ frames, lo: centre.map((c, k) => c - size[k] / 2), hi: centre.map((c, k) => c + size[k] / 2) })

/** A box's eight corners in the world, for drawing it (overlay.js outline): corner c has x from bit 0, y from bit 1,
 *  z from bit 2. And its twelve edges, as corner pairs. */
export function corners(box) {
    return [0, 1, 2, 3, 4, 5, 6, 7].map(c => box.frames.reduce((q, t) => toParent(t, q),
        [c & 1 ? box.hi[0] : box.lo[0], c & 2 ? box.hi[1] : box.lo[1], c & 4 ? box.hi[2] : box.lo[2]]))
}
export const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]

/**
 * THE BOX FITTED TO WHAT IS PRINTED, from the measured boxes (boxes.js: `B` has its get), or null when nothing is
 * measured yet -- the dialog then says so, and the user can type a size.
 *   id null or the root: THE WHOLE SCENE, in the world: the union of the top-level nodes' boxes, leaving out the
 *       lights (a sheet, nothing to print) and an OPEN box -- a floor plane's, which goes on to where the search
 *       stopped (boxes.js) and would print a slab the size of a room. A group whose box is open is looked into
 *       instead, so a floor grouped with the furniture leaves the furniture.
 *   an object or a group: ITS OWN box in its own frame, the frames from it to the world, so the print is upright
 *       in the object's frame and fits it however it is turned.
 */
export function fittedBox(doc, B, id = null) {
    const n = id == null ? doc.root : find(doc, id)?.node
    if (!n) return null
    if (n === doc.root) {
        let lo = null, hi = null
        const grow = p => { lo = lo ? lo.map((v, k) => Math.min(v, p[k])) : p.slice(); hi = hi ? hi.map((v, k) => Math.max(v, p[k])) : p.slice() }
        const visit = (c, frames) => {
            if (c.enabled === false || (c.kind === 'object' && c.type === 'light')) return
            const here = c.transform ? [c.transform, ...frames] : frames
            const b = B.get(c.id)
            if (b && !b.open) { for (const p of corners({ frames: here, lo: b.lo, hi: b.hi })) grow(p); return }
            // an open box, or none: what is inside it, at each copy of an array
            for (const k of c.children || []) for (const cp of c.copies?.length ? c.copies : [null]) visit(k, cp ? [cp, ...here] : here)
        }
        for (const c of doc.root.children) visit(c, [])
        return lo ? { frames: [], lo, hi } : null
    }
    if (n.kind === 'object' && n.type === 'light') return null
    const b = B.get(n.id)
    return b ? { frames: framesTo(doc, n.id), lo: b.lo.slice(), hi: b.hi.slice() } : null
}

/**
 * THE SCENE OF ONE OBJECT ALONE, for the export of "the selected object": the tree toTree makes, with the
 * object -- an object or a group, everything under it -- put at the top level inside plain groups that carry
 * each frame between it and the world (framesTo's), so it is exactly where it is in the scene and nothing else
 * is there. What the groups above it DO is left out: their joins (a part subtracted from another is printed as
 * itself), their blends, their code (a modifier), and the copies of an array (one copy is printed: the first,
 * where the object is shown and moved). Its materials are the ones it wears (toTree resolves a group's), and a
 * pattern frame above it stays where it was (pattern.test: where a material lays its pattern out).
 * Throws for a hidden object, a light, or one not in the document.
 */
export function subjectTree(doc, id) {
    const f = find(doc, id)
    if (!f) throw new Error(`'${id}' is not in this scene`)
    if (f.node === doc.root) return toTree(doc)
    if (f.node.kind === 'object' && f.node.type === 'light') throw new Error('a light is a sheet with nothing to print')
    const tree = toTree(doc)
    const findIn = (n, want) => n.id === want ? n : (n.children || []).reduce((r, c) => r || findIn(c, want), null)
    const own = findIn(tree, id)
    if (!own) throw new Error(`'${id}' is hidden, or inside something hidden: show it to print it`)
    const subject = structuredClone(own)
    for (const k of ['join', 'joinBlend', 'enabled']) delete subject[k]
    // its own transform stays its own; each ancestor a group of one carrying its transform and pattern frame
    let inner = subject
    const chain = lineage(doc, id)
    chain.forEach((n, i) => {
        if (n === doc.root) return
        if (i > 0) {
            const g = { id: `${n.id}__print`, kind: 'group', blend: 0, csg: false, children: [inner] }
            if (n.transform) g.transform = structuredClone(n.transform)
            if (n.pattern) g.pattern = structuredClone(n.pattern)
            inner = g
        }
        const up = chain[i + 1]
        if (up && up !== doc.root && up.copies?.length)
            inner = { id: `${up.id}__copy`, kind: 'group', blend: 0, csg: false, transform: structuredClone(up.copies[0]), children: [inner] }
    })
    const { children: _c, ...rest } = tree
    return { ...rest, children: [inner] }
}

/**
 * The grid an export samples: where the box is in the world and how it is cut into cells. Pure, so tested in
 * node (test/exportbox.test.mjs). `unit` is the scene's (doc.unit).
 *
 * GRID POINTS SIT AT CELL CENTRES of a box cut into m cells per axis -- the cell adjusted so m is
 * whole -- plus one point outside each face: n = m + 2 points, point k at (k - 0.5) cells from the
 * box's min corner. So every face lies half-way between two grid planes, where the box's distance
 * is +-half a cell and the mesher's interpolation puts the cut exactly on the face.
 *
 * @returns { n: [nx, ny, nz], spacing: [mm per cell, per axis], sizeMm, mmPerUnit,
 *            origin, ax, ay, az -- world (scene units): grid point (0,0,0), and one step along each axis }
 */
export function exportGrid(unit, box, { cell = EXPORT_DEFAULTS.cell } = {}) {
    const bad = boxProblems(box)
    if (bad.length) throw new Error(bad[0])
    if (!(Number.isFinite(cell) && cell > 0)) throw new Error('the cell must be mm > 0')
    const toWorld = p => box.frames.reduce((q, t) => toParent(t, q), p)
    const scale = box.frames.reduce((s, t) => s * (t.scale ?? 1), 1)
    const mmPerUnit = (UNITS[unit ?? 'm'] ?? 1) * 1000
    const size = sizeOf(box)
    const sizeMm = size.map(v => v * scale * mmPerUnit)
    const m = sizeMm.map(v => Math.max(1, Math.round(v / cell)))
    const n = m.map(k => k + 2)
    const step = size.map((v, k) => v / m[k])                     // in the box's own frame
    const local = (i, j, k) => [(i - 0.5) * step[0] + box.lo[0], (j - 0.5) * step[1] + box.lo[1], (k - 0.5) * step[2] + box.lo[2]]
    const origin = toWorld(local(0, 0, 0))
    const along = q => toWorld(q).map((v, k) => v - origin[k])
    return {
        n, spacing: sizeMm.map((v, k) => v / m[k]), sizeMm, mmPerUnit,
        origin, ax: along(local(1, 0, 0)), ay: along(local(0, 1, 0)), az: along(local(0, 0, 1)),
    }
}

/** Why a grid cannot be exported, or null. */
export function gridProblem(g) {
    const [nx, ny, nz] = g.n
    if (nx * ny > MAX_LAYER) return `a layer of ${nx} x ${ny} points is more than one pass can sample (${MAX_LAYER.toLocaleString()}): use a coarser cell or a smaller box`
    if (nx * ny * nz > MAX_POINTS) return `${(nx * ny * nz / 1e6).toFixed(0)} million points is too many: use a coarser cell or a smaller box`
    return null
}

/** The box's distance, in mm, at grid point (i, j, k): negative inside, per the grid above. */
export function boxDistance(g, i, j, k) {
    const d = [i, j, k].map((q, a) => { const x = (q - 0.5) * g.spacing[a]; return Math.max(-x, x - g.sizeMm[a]) })
    return Math.max(d[0], d[1], d[2])
}

/**
 * Sample, mesh, colour and write. `sample(input, outFloats)` is the renderer's field at points, of the scene being
 * printed: the one showing, or one made of the selected object alone (subjectTree). `doc` gives the unit and the
 * file's name, `box` where to print. Resolves to { bytes, triangles, vertices, colours, palette, open } -- `open`
 * the number of edges that are not closed (null: not checked, a big mesh), which is 0 unless something is wrong
 * with the mesher, and is said rather than hidden.
 */
export async function runExport({ sample, doc, box, format = '3mf', cell = EXPORT_DEFAULTS.cell, colours = EXPORT_DEFAULTS.colours, name, onProgress = () => { } }) {
    if (!FORMATS.includes(format)) throw new Error(`format must be one of ${FORMATS.join(', ')}`)
    const bad = settingsProblems({ cell, colours })
    if (bad.length) throw new Error(bad[0])
    const g = exportGrid(doc.unit, box, { cell })
    const why = gridProblem(g)
    if (why) throw new Error(why)
    const [nx, ny, nz] = g.n
    const plane = nx * ny
    const M = createMesher(nx, ny, nz, g.spacing, g.spacing.map(s => -0.5 * s))

    // ---- the field, a slab of layers per dispatch, cut by the box, into the mesher
    onProgress(`sampling ${g.n.map(k => k - 2).join(' x ')} cells (the first export of a scene compiles its kernel: seconds)`)
    const per = Math.max(1, Math.min(nz, Math.floor(Math.min(MAX_LAYER, 4 << 20) / plane)))
    for (let z0 = 0; z0 < nz; z0 += per) {
        const k = Math.min(per, nz - z0)
        const origin = g.origin.map((v, a) => v + z0 * g.az[a])
        const f = await sample(fieldInput({ mode: FIELD_GRID, count: plane * k, origin, ax: g.ax, ay: g.ay, az: g.az, nx, ny }), plane * k)
        if (!f) throw new Error('the scene changed during the export, or the renderer was busy with an offscreen render: try again')
        for (let l = 0; l < k; l++) {
            const layer = new Float32Array(plane), z = z0 + l
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
                const q = i + nx * j
                layer[q] = Math.max(f[l * plane + q] * g.mmPerUnit, boxDistance(g, i, j, z))
            }
            M.push(layer)
        }
        onProgress(`meshing: ${Math.min(nz, z0 + k)} of ${nz} layers`)
    }
    const mesh = M.finish()
    const nt = mesh.triangles.length / 3
    if (!nt) throw new Error('nothing solid inside the box')
    /* checked when it is cheap: a Map of every directed edge stops fitting past a few million */
    const open = nt <= 1e6 ? openEdges(mesh.triangles, 1).length : null

    // ---- the colours: each triangle's centre back to the world, the material's colour there
    let palette = null, index = null
    if (format === '3mf') {
        const c = centroids(mesh.positions, mesh.triangles)
        const rgb = new Float32Array(3 * nt)
        const chunk = 1 << 20
        for (let s = 0; s < nt; s += chunk) {
            const cnt = Math.min(chunk, nt - s)
            const pts = new Float32Array(3 * cnt)
            for (let t = 0; t < cnt; t++) {
                // mm in the box's frame -> grid coordinates -> world
                const gi = [0, 1, 2].map(a => c[3 * (s + t) + a] / g.spacing[a] + 0.5)
                for (let a = 0; a < 3; a++) pts[3 * t + a] = g.origin[a] + gi[0] * g.ax[a] + gi[1] * g.ay[a] + gi[2] * g.az[a]
            }
            const out = await sample(fieldInput({ mode: FIELD_POINTS, count: cnt, points: pts }), 4 * cnt)
            if (!out) throw new Error('the scene changed during the export, or the renderer was busy with an offscreen render: try again')
            for (let t = 0; t < cnt; t++) for (let a = 0; a < 3; a++) rgb[3 * (s + t) + a] = toSRGB(out[4 * t + a])
            onProgress(`colouring: ${Math.min(nt, s + cnt).toLocaleString()} of ${nt.toLocaleString()} triangles`)
        }
        ;({ palette, index } = quantize(rgb, colours))
    }

    onProgress('writing the file')
    name ??= doc.title || 'scene'
    const bytes = format === '3mf' ? await write3MF({ ...mesh, palette, index, name }) : writeSTL({ ...mesh, name })
    return { bytes, triangles: nt, vertices: mesh.positions.length / 3, palette, open, grid: g }
}
