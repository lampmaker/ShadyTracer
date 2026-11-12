//======================================================================================================================
// LIT COLOUR -- a print's colours as the picture shows the part, lit (0.next): the mesh's side of it. The renderer's
// side is lib/pathtracer/core/probes.js (index.js renderProbes): the light leaving a point, along a ray from just off
// it straight at it, developed as the view develops it.
//
// PROBES AT THE MESH'S VERTICES, NOT ITS TRIANGLES: a vertex has about half as many (a closed triangle mesh's
// F = 2V - 4 + 4g), and its normal -- the sum of its triangles' -- is steadier than one triangle's, which marching
// tetrahedra makes in slivers. A triangle's colour is then the mean of its corners': a little smoothing for free.
//
// THE FACES THE BOX CUTS have no light: they are inside the scene's solid, where a probe's ray would start inside it.
// They keep the material's colour (the plain export's), and their vertices' normals leave them out, so a vertex on the
// rim of a cut looks at the scene's own surface. Which faces are cuts is the field's to say, not their place (boxCuts).
//
// THE NOISE: each probe is a mean of `samples` paths, so neighbours differ by noise. smoothVertices averages each with
// the ring of vertices around it, once by default: about a cell of blur, against a sixth of the variance (a vertex has
// about six neighbours). The colours are then reduced to a few (mesh.js quantize), where noise would show as speckle
// along the borders between them.
//
// PURE: numbers in, numbers out, tested in node (test/litcolour.test.mjs).
//======================================================================================================================

/**
 * WHERE THE BOX CUTS THE SCENE'S SOLID. The grid has a plane of points one cell outside each face of the box and one
 * just inside it (exportbox.js exportGrid: the face half-way between), and the scene's own field at both -- before the
 * box's cut -- says what is at the face: their mean, read between the points bilinearly. Negative is the solid going on
 * through the face, a cut; zero or more is the scene's own surface on it, or nothing. The scene's own face lying on the
 * box's is the usual case, since the dialog fits the box to what is printed: a test by place alone took a box's own
 * faces for cuts and gave a boxy part no light at all.
 *   face f: 0 x = 0, 1 x = max, 2 y = 0, 3 y = max, 4 z = 0, 5 z = max.
 * @param n [nx, ny, nz] grid points, `spacing` mm a cell, as the grid's
 */
export function boxCuts(n, spacing) {
    const [nx, ny, nz] = n
    const axes = [[1, 2], [1, 2], [0, 2], [0, 2], [0, 1], [0, 1]]
    const dims = axes.map(([u, v]) => [n[u], n[v]])
    // per face, the two planes' values summed (outside + inside), and how many of the two were given (both, once sampled)
    const sum = dims.map(([a, b]) => new Float32Array(a * b)), got = dims.map(([a, b]) => new Uint8Array(a * b))
    const put = (f, u, v, x) => { const q = u + dims[f][0] * v; sum[f][q] += x; got[f][q]++ }
    return {
        /** the scene's field (mm) at grid point (i, j, k), kept where it is on a plane each side of a face */
        record(i, j, k, f) {
            if (i <= 1) put(0, j, k, f)
            if (i >= nx - 2) put(1, j, k, f)
            if (j <= 1) put(2, i, k, f)
            if (j >= ny - 2) put(3, i, k, f)
            if (k <= 1) put(4, i, j, f)
            if (k >= nz - 2) put(5, i, j, f)
        },
        /** the faces point p (mm in the box's frame) lies on, within tol */
        facesOf(p, size, tol) {
            const out = []
            for (let a = 0; a < 3; a++) {
                if (Math.abs(p[a]) <= tol) out.push(2 * a)
                if (Math.abs(p[a] - size[a]) <= tol) out.push(2 * a + 1)
            }
            return out
        },
        /** the scene's field on face f at p, between its grid points (point q at (q - 0.5) cells) */
        fieldOn(f, p) {
            const [u, v] = axes[f], [du, dv] = dims[f]
            const gu = Math.max(0, Math.min(du - 1.0001, p[u] / spacing[u] + 0.5)), gv = Math.max(0, Math.min(dv - 1.0001, p[v] / spacing[v] + 0.5))
            const u0 = Math.floor(gu), v0 = Math.floor(gv), su = gu - u0, sv = gv - v0
            const at = (a, b) => { const q = a + du * b; return got[f][q] ? sum[f][q] / got[f][q] : 0 }
            return (1 - su) * (1 - sv) * at(u0, v0) + su * (1 - sv) * at(u0 + 1, v0) + (1 - su) * sv * at(u0, v0 + 1) + su * sv * at(u0 + 1, v0 + 1)
        },
    }
}

/**
 * WHAT IS CUT: `onCut[v]` for a vertex on a face of the box (within `tol`) where the scene is solid on the face, by more
 * than a quarter of a cell -- no probe stands there, its ray would start inside the solid; `cut[t]` for a triangle
 * whose corners all are, or that lies on one face with the solid there at its centre. The quarter cell keeps the rim,
 * where a cut meets the scene's surface and the field on the face is 0, out of it: a rim vertex is on the surface, and
 * looks at it. The mesher bevels a box's edges (mesh.js), so a triangle along an edge between two cut faces is on
 * neither face alone, and is cut by its corners.
 */
export function cutsOf(positions, triangles, sizeMm, spacing, cuts) {
    const tol = 1e-3 * Math.min(...spacing), deep = -0.25 * Math.min(...spacing)
    const nv = positions.length / 3, nt = triangles.length / 3
    const P = v => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]]
    const onCut = new Uint8Array(nv), faces = new Array(nv)
    for (let v = 0; v < nv; v++) {
        const p = P(v), f = cuts.facesOf(p, sizeMm, tol)
        faces[v] = f
        if (f.some(k => cuts.fieldOn(k, p) < deep)) onCut[v] = 1
    }
    const cut = new Uint8Array(nt)
    for (let t = 0; t < nt; t++) {
        const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2]
        if (onCut[a] && onCut[b] && onCut[c]) { cut[t] = 1; continue }
        const shared = faces[a].filter(f => faces[b].includes(f) && faces[c].includes(f))
        if (!shared.length) continue
        const centre = [0, 1, 2].map(k => (positions[3 * a + k] + positions[3 * b + k] + positions[3 * c + k]) / 3)
        if (shared.some(f => cuts.fieldOn(f, centre) < 0)) cut[t] = 1
    }
    return { cut, onCut }
}

/**
 * THE PROBES: one at every vertex of a triangle not cut but a vertex on a cut (cutsOf), looking at it along its normal
 * (the sum of its uncut triangles' area-weighted normals; the mesh faces outward, mesh.js). `probe[v]` is vertex v's
 * probe, -1 for none. At the rim of a cut the mesher bevels the edge (by up to a cell, mesh.js), and a vertex on the
 * bevel looks at it slanted.
 * @returns { probe: Int32Array, count, points: Float32Array, normals: Float32Array } -- 3 a probe, in the mesh's frame
 */
export function vertexProbes(positions, triangles, cut = null, onCut = null) {
    const nv = positions.length / 3, nt = triangles.length / 3
    const N = new Float64Array(3 * nv)
    for (let t = 0; t < nt; t++) {
        if (cut?.[t]) continue
        const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2]
        const ux = positions[3 * b] - positions[3 * a], uy = positions[3 * b + 1] - positions[3 * a + 1], uz = positions[3 * b + 2] - positions[3 * a + 2]
        const wx = positions[3 * c] - positions[3 * a], wy = positions[3 * c + 1] - positions[3 * a + 1], wz = positions[3 * c + 2] - positions[3 * a + 2]
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx      // twice the area, outward
        for (const v of [a, b, c]) { N[3 * v] += nx; N[3 * v + 1] += ny; N[3 * v + 2] += nz }
    }
    const probe = new Int32Array(nv).fill(-1)
    let count = 0
    for (let v = 0; v < nv; v++) if (!onCut?.[v] && Math.hypot(N[3 * v], N[3 * v + 1], N[3 * v + 2]) > 0) probe[v] = count++
    const points = new Float32Array(3 * count), normals = new Float32Array(3 * count)
    for (let v = 0; v < nv; v++) {
        const k = probe[v]
        if (k < 0) continue
        const l = Math.hypot(N[3 * v], N[3 * v + 1], N[3 * v + 2])
        for (let a = 0; a < 3; a++) { points[3 * k + a] = positions[3 * v + a]; normals[3 * k + a] = N[3 * v + a] / l }
    }
    return { probe, count, points, normals }
}

/** Each probe's value averaged with its neighbours' (the vertices it shares an edge with that have probes), `passes`
 *  times. `values` 3 a probe, as vertexProbes numbers them. */
export function smoothVertices(values, triangles, probe, passes = 1) {
    if (passes <= 0) return values
    const nt = triangles.length / 3, n = values.length / 3
    // each probe's neighbours, from the edges whose two ends both have probes
    const deg = new Int32Array(n)
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
        const a = probe[triangles[3 * t + k]], b = probe[triangles[3 * t + (k + 1) % 3]]
        if (a >= 0 && b >= 0) deg[a]++
    }
    const start = new Int32Array(n + 1)
    for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i]
    const nb = new Int32Array(start[n]), fill = start.slice(0, n)
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
        const a = probe[triangles[3 * t + k]], b = probe[triangles[3 * t + (k + 1) % 3]]
        if (a >= 0 && b >= 0) { nb[fill[a]++] = b }
    }
    let cur = Float32Array.from(values)
    for (let p = 0; p < passes; p++) {
        const next = new Float32Array(cur.length)
        for (let i = 0; i < n; i++) {
            // a closed mesh has each edge once each way, a -> b in one triangle and b -> a in the other: each neighbour once
            let s0 = cur[3 * i], s1 = cur[3 * i + 1], s2 = cur[3 * i + 2], w = 1
            for (let j = start[i]; j < start[i + 1]; j++) { const q = nb[j]; s0 += cur[3 * q]; s1 += cur[3 * q + 1]; s2 += cur[3 * q + 2]; w++ }
            next[3 * i] = s0 / w; next[3 * i + 1] = s1 / w; next[3 * i + 2] = s2 / w
        }
        cur = next
    }
    return cur
}

/** Each triangle's colour: the mean of its corners' probes, or `fallback`'s (3 a triangle) for a cut triangle or one
 *  with no corner probed. */
export function triangleColours(triangles, probe, values, cut, fallback) {
    const nt = triangles.length / 3, out = new Float32Array(3 * nt)
    for (let t = 0; t < nt; t++) {
        let s0 = 0, s1 = 0, s2 = 0, w = 0
        if (!cut?.[t]) for (let k = 0; k < 3; k++) {
            const q = probe[triangles[3 * t + k]]
            if (q < 0) continue
            s0 += values[3 * q]; s1 += values[3 * q + 1]; s2 += values[3 * q + 2]; w++
        }
        if (w) { out[3 * t] = s0 / w; out[3 * t + 1] = s1 / w; out[3 * t + 2] = s2 / w }
        else { out[3 * t] = fallback[3 * t]; out[3 * t + 1] = fallback[3 * t + 1]; out[3 * t + 2] = fallback[3 * t + 2] }
    }
    return out
}
