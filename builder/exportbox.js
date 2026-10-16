//======================================================================================================================
// EXPORT BOX -- the part of a scene that becomes a printable file: a box object, and the export it
// drives (3MF with colour, or STL).
//
// A BOX IS AN OBJECT OF ITS OWN TYPE, `type: 'export'`, like a light (lights.js) and for the same
// reason: its shape has to stay known, and a code node's cannot. It draws nothing -- codegen emits a
// comment for it, declaring its uniforms as it does for anything left out -- so adding one changes
// no picture. It has what every object has: a place in the tree, a transform the handles move and
// rotate, a size (its `size` parameter, the full edge lengths in its own frame, centred on its
// origin). And `export`, its settings:
//   cell      the grid's spacing, in MILLIMETRES of the printed part -- a printer's number, not the
//             scene's, so it means the same in a metre scene and a millimetre one
//   colours   how many colours a 3MF may have: the filaments the printer holds
//
// WHAT IS EXPORTED is everything solid inside the box, cut by its faces: the whole scene, as the
// picture shows it (the render copy of the scene -- an optics limiter is not in it, and a light is a
// sheet with no inside). THE BOX'S FRAME IS THE PART'S: its z is up on the print bed and its min
// corner the file's origin, so turning the box turns the print, and a scene with z not up needs no
// edit to print upright.
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
// PURE EXCEPT runExport, which talks to the renderer (RT.sampleField) and nothing else; the host
// downloads what it returns.
//======================================================================================================================

import { lineage, toParent, framesTo } from './bounds.js'
import { UNITS } from '../lib/pathtracer/core/photometry.js'
import { FIELD_GRID, FIELD_POINTS, FIELD_MAX_POINTS, fieldInput } from '../lib/pathtracer/core/field.js'
import { createMesher, centroids, quantize, toSRGB, openEdges } from './mesh.js'
import { write3MF, writeSTL } from './print.js'

export const EXPORT_PARAMS = Object.freeze({ size: Object.freeze({ x: 1, y: 1, z: 1 }) })
/** Which of its parameters the Transform gizmo's cube on each axis multiplies (stretch.js): its size, whole along each
 *  axis (boxCorners), so a cube pulls that face out. */
export const EXPORT_STRETCH = Object.freeze({ x: ['size.x'], y: ['size.y'], z: ['size.z'] })
export const EXPORT_DEFAULTS = Object.freeze({ cell: 0.4, colours: 4 })
export const FORMATS = ['3mf', 'stl']
/** Refused past this: a layer of the grid has to fit one dispatch (field.js). */
export const MAX_LAYER = FIELD_MAX_POINTS
/** ...and past this in all, which is already an hour of meshing and a file no slicer wants. */
export const MAX_POINTS = 1.2e9

/** The box's settings with the defaults filled in. */
export const exportOf = node => ({ ...EXPORT_DEFAULTS, ...(node?.export || {}) })

/** Everything wrong with an export box, as strings. */
export function exportProblems(n) {
    const p = [], id = n.id
    const s = n.params?.size
    if (!s || !['x', 'y', 'z'].every(k => Number.isFinite(s[k]) && s[k] > 0)) p.push(`'${id}': an export box needs a size {x, y, z} > 0`)
    for (const k of Object.keys(n.params || {})) if (k !== 'size') p.push(`'${id}': an export box has no parameter '${k}'`)
    if (n.material != null) p.push(`'${id}': an export box has no material`)
    if (n.code !== undefined) p.push(`'${id}': an export box has no code`)
    if (n.constants !== undefined || n.ranges !== undefined) p.push(`'${id}': an export box has no constants or ranges`)
    const E = n.export
    if (E !== undefined) {
        if (!E || typeof E !== 'object' || Array.isArray(E)) return [...p, `'${id}': export settings must be an object`]
        for (const k of Object.keys(E)) if (!(k in EXPORT_DEFAULTS)) p.push(`'${id}': unknown export setting '${k}'`)
        if (E.cell !== undefined && !(Number.isFinite(E.cell) && E.cell > 0)) p.push(`'${id}': export cell must be mm > 0`)
        if (E.colours !== undefined && !(Number.isInteger(E.colours) && E.colours >= 1 && E.colours <= 64)) p.push(`'${id}': export colours must be a whole number from 1 to 64`)
    }
    return p
}

/**
 * The grid an export samples, from the document: where the box is in the world and how it is cut
 * into cells. Pure, so tested in node (test/exportbox.test.mjs).
 *
 * GRID POINTS SIT AT CELL CENTRES of a box cut into m cells per axis -- the cell adjusted so m is
 * whole -- plus one point outside each face: n = m + 2 points, point k at (k - 0.5) cells from the
 * box's min corner. So every face lies half-way between two grid planes, where the box's distance
 * is +-half a cell and the mesher's interpolation puts the cut exactly on the face.
 *
 * @returns { n: [nx, ny, nz], spacing: [mm per cell, per axis], sizeMm, mmPerUnit,
 *            origin, ax, ay, az -- world (scene units): grid point (0,0,0), and one step along each axis }
 */
export function exportGrid(doc, id, { cell } = {}) {
    const chain = lineage(doc, id)
    const node = chain[0]
    if (!node || node.type !== 'export') throw new Error(`'${id}' is not an export box`)
    const bad = exportProblems(node)
    if (bad.length) throw new Error(bad[0])
    const E = exportOf(node)
    const cellMm = cell ?? E.cell
    const frames = framesTo(doc, id)
    const toWorld = p => frames.reduce((q, t) => toParent(t, q), p)
    const scale = frames.reduce((s, t) => s * (t.scale ?? 1), 1)
    const mmPerUnit = (UNITS[doc.unit ?? 'm'] ?? 1) * 1000
    const size = [node.params.size.x, node.params.size.y, node.params.size.z]
    const sizeMm = size.map(v => v * scale * mmPerUnit)
    const m = sizeMm.map(v => Math.max(1, Math.round(v / cellMm)))
    const n = m.map(k => k + 2)
    const step = size.map((v, k) => v / m[k])                     // in the box's own frame
    const local = (i, j, k) => [(i - 0.5) * step[0] - size[0] / 2, (j - 0.5) * step[1] - size[1] / 2, (k - 0.5) * step[2] - size[2] / 2]
    const origin = toWorld(local(0, 0, 0))
    const along = q => toWorld(q).map((v, k) => v - origin[k])
    return {
        n, spacing: sizeMm.map((v, k) => v / m[k]), sizeMm, mmPerUnit,
        origin, ax: along(local(1, 0, 0)), ay: along(local(0, 1, 0)), az: along(local(0, 0, 1)),
    }
}

/** The box's eight corners in the world, for drawing it (overlay.js): corner c has x from bit 0,
 *  y from bit 1, z from bit 2. And its twelve edges, as corner pairs. A haze box's too (hazebox.js): the same
 *  `size` in the same frame. */
export function boxCorners(doc, id) {
    const chain = lineage(doc, id)
    const node = chain[0]
    if (!node || (node.type !== 'export' && node.type !== 'haze')) return null
    const frames = framesTo(doc, id)
    const s = node.params?.size || EXPORT_PARAMS.size
    return [0, 1, 2, 3, 4, 5, 6, 7].map(c => frames.reduce((q, t) => toParent(t, q),
        [(c & 1 ? 0.5 : -0.5) * s.x, (c & 2 ? 0.5 : -0.5) * s.y, (c & 4 ? 0.5 : -0.5) * s.z]))
}
export const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]

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
 * Sample, mesh, colour and write. `sample(input, outFloats)` is the renderer's RT.sampleField; it
 * must be showing the scene the box is in. Resolves to { bytes, triangles, vertices, colours,
 * palette, open } -- `open` the number of edges that are not closed (null: not checked, a big mesh),
 * which is 0 unless something is wrong with the mesher, and is said rather than hidden.
 */
export async function runExport({ sample, doc, id, format = '3mf', onProgress = () => { } }) {
    if (!FORMATS.includes(format)) throw new Error(`format must be one of ${FORMATS.join(', ')}`)
    const node = lineage(doc, id)[0]
    const E = exportOf(node)
    const g = exportGrid(doc, id)
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
        ;({ palette, index } = quantize(rgb, E.colours))
    }

    onProgress('writing the file')
    const name = doc.title || 'scene'
    const bytes = format === '3mf' ? await write3MF({ ...mesh, palette, index, name }) : writeSTL({ ...mesh, name })
    return { bytes, triangles: nt, vertices: mesh.positions.length / 3, palette, open, grid: g }
}
