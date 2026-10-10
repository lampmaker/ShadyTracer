//======================================================================================================================
// MESH -- a sampled field becomes a closed triangle mesh, for printing (exportbox.js), and the mesh's
// colours become the few a printer can hold.
//
// PURE ON PURPOSE, like model.js: numbers in, numbers out, no device. The GPU samples the scene
// (lib/pathtracer/core/field.js) and everything after that is here, tested in node against fields
// written in JavaScript (test/mesh.test.mjs).
//
// MARCHING TETRAHEDRA, NOT MARCHING CUBES, because what a slicer needs is a CLOSED surface -- every
// edge in exactly two triangles, consistently wound -- and that is the one property marching cubes
// does not give for free: its ambiguous faces have to be resolved the same way from both cubes that
// share them, and a table that does not is a mesh with cracks. Splitting every cube into six
// tetrahedra that share its main diagonal (the Kuhn triangulation) makes neighbouring cubes split
// their shared face along the same diagonal, and a tetrahedron has no ambiguous case at all. The
// price is about twice the triangles of marching cubes for the same grid.
//
// STREAMED BY LAYER. A print-resolution grid is hundreds of millions of points; the mesher holds two
// z-layers of values and two of edge vertices, and the host pushes layers as the GPU produces them.
//
// CLOSED BY CONSTRUCTION: the grid's outermost points are forced outside, so nothing can run off
// its edge. The exporter clips the scene to its box before that, so the cut is a face of the box
// rather than of the grid (exportbox.js). Inside is f < 0; exactly zero counts as outside, so every
// point is one or the other.
//
// THE WINDING is decided on an idealised copy of each triangle -- its corners at the MIDPOINTS of
// their tetrahedron edges -- not on the interpolated one, which can be a sliver whose normal is
// noise. Every triangle of a tetrahedron then faces from its inside corners to its outside ones,
// which is what makes two neighbours wind a shared edge in opposite directions.
//======================================================================================================================

/* The six tetrahedra of a cube, corners as bit masks (x = 1, y = 2, z = 4): 0, one axis, two axes,
   all three -- one per order of the axes. Each corner's bits contain the previous one's, so an edge
   always runs from a corner to one of its supersets, and is keyed by where it starts and the bits
   it adds. */
const TETS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    .map(([a, b]) => [0, 1 << a, (1 << a) | (1 << b), 7])

/**
 * A mesher for an nx x ny x nz grid, fed one z-layer at a time.
 * @param spacing  [cx, cy, cz] between grid points, in the units the positions come out in
 * @param origin   where grid point (0, 0, 0) is
 * @returns { push(layer), finish() } -- push nx*ny values (x fastest) per layer, nz times;
 *          finish() gives { positions: Float32Array xyz, triangles: Uint32Array abc }
 */
export function createMesher(nx, ny, nz, spacing = [1, 1, 1], origin = [0, 0, 0]) {
    if (!(nx >= 2 && ny >= 2 && nz >= 2)) throw new Error('a grid needs at least two points along each axis')
    const plane = nx * ny
    let pos = new Float32Array(3 * 4096), nv = 0
    let tri = new Uint32Array(3 * 8192), nt = 0
    // vertex id + 1 on the edge from a point along each of the seven directions, for two layers
    let edgesA = new Int32Array(plane * 8), edgesB = new Int32Array(plane * 8)
    let prev = null, z = 0

    const closed = (layer, zi) => {
        const out = Float32Array.from(layer)
        const outside = v => (v < 0 ? 1e-6 : v)
        if (zi === 0 || zi === nz - 1) { for (let i = 0; i < plane; i++) out[i] = outside(out[i]); return out }
        for (let x = 0; x < nx; x++) { out[x] = outside(out[x]); out[x + nx * (ny - 1)] = outside(out[x + nx * (ny - 1)]) }
        for (let y = 0; y < ny; y++) { out[nx * y] = outside(out[nx * y]); out[nx * y + nx - 1] = outside(out[nx * y + nx - 1]) }
        return out
    }

    const addVertex = (x, y, zz) => {
        if (3 * nv + 3 > pos.length) { const g = new Float32Array(pos.length * 2); g.set(pos); pos = g }
        pos[3 * nv] = origin[0] + x * spacing[0]; pos[3 * nv + 1] = origin[1] + y * spacing[1]; pos[3 * nv + 2] = origin[2] + zz * spacing[2]
        return nv++
    }
    const addTriangle = (a, b, c) => {
        if (3 * nt + 3 > tri.length) { const g = new Uint32Array(tri.length * 2); g.set(tri); tri = g }
        tri[3 * nt] = a; tri[3 * nt + 1] = b; tri[3 * nt + 2] = c
        nt++
    }

    // corner c of the cube at (x, y, z0): its grid coordinates, value and layer
    const cx = (x, c) => x + (c & 1), cy = (y, c) => y + ((c >> 1) & 1), cz = c => (c >> 2) & 1

    function cubeLayer(lo, hi) {
        const F = new Float64Array(8), P = new Int32Array(24)
        const val = (x, y, c) => (cz(c) ? hi : lo)[cx(x, c) + nx * cy(y, c)]
        // the vertex on the edge from corner u to its superset v, made once per edge
        const vertex = (x, y, u, v) => {
            const store = cz(u) ? edgesB : edgesA
            const slot = (cx(x, u) + nx * cy(y, u)) * 8 + (v ^ u)
            let id = store[slot] - 1
            if (id >= 0) return id
            const fu = F[u], fv = F[v]
            const t = Math.min(0.999, Math.max(0.001, fu / (fu - fv)))
            id = addVertex(P[3 * u] + t * (P[3 * v] - P[3 * u]), P[3 * u + 1] + t * (P[3 * v + 1] - P[3 * u + 1]),
                           P[3 * u + 2] + t * (P[3 * v + 2] - P[3 * u + 2]))
            store[slot] = id + 1
            return id
        }
        // the midpoint of an edge, for the winding (twice the midpoint: integers)
        const mid = (u, v, k) => P[3 * u + k] + P[3 * v + k]
        const emit = (edges, ref, x, y) => {
            // edges: three [u, v] pairs; ref: the direction from inside to outside
            const [[a0, a1], [b0, b1], [c0, c1]] = edges
            const e1 = [0, 1, 2].map(k => mid(b0, b1, k) - mid(a0, a1, k))
            const e2 = [0, 1, 2].map(k => mid(c0, c1, k) - mid(a0, a1, k))
            const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
            const A = vertex(x, y, a0, a1), B = vertex(x, y, b0, b1), C = vertex(x, y, c0, c1)
            if (n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] >= 0) addTriangle(A, B, C)
            else addTriangle(A, C, B)
        }
        for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
            let any = 0
            for (let c = 0; c < 8; c++) {
                F[c] = val(x, y, c)
                any |= (F[c] < 0 ? 1 : 2)
                P[3 * c] = cx(x, c); P[3 * c + 1] = cy(y, c); P[3 * c + 2] = z - 1 + cz(c)
            }
            if (any !== 3) continue                         // all inside or all outside
            for (const T of TETS) {
                const ins = T.filter(c => F[c] < 0), outs = T.filter(c => F[c] >= 0)
                if (!ins.length || !outs.length) continue
                const ref = [0, 1, 2].map(k => outs.reduce((s, c) => s + P[3 * c + k], 0) / outs.length
                                             - ins.reduce((s, c) => s + P[3 * c + k], 0) / ins.length)
                // an edge as [subset, superset], which is tetrahedron order
                const E = (p, q) => (T.indexOf(p) < T.indexOf(q) ? [p, q] : [q, p])
                if (ins.length === 1 || outs.length === 1) {
                    const [lone, others] = ins.length === 1 ? [ins[0], outs] : [outs[0], ins]
                    emit(others.map(o => E(lone, o)), ref, x, y)
                } else {
                    const [a, b] = ins, [c, d] = outs
                    // the quad ac, ad, bd, bc: each consecutive pair shares a corner
                    emit([E(a, c), E(a, d), E(b, d)], ref, x, y)
                    emit([E(a, c), E(b, d), E(b, c)], ref, x, y)
                }
            }
        }
    }

    return {
        push(layer) {
            if (z >= nz) throw new Error(`the grid has ${nz} layers`)
            if (layer.length !== plane) throw new Error(`a layer is ${plane} values, got ${layer.length}`)
            const cur = closed(layer, z)
            if (prev) {
                cubeLayer(prev, cur)                    // the cubes between layers z - 1 and z
                ;[edgesA, edgesB] = [edgesB, edgesA]
                edgesB.fill(0)
            }
            prev = cur
            z++
        },
        get layers() { return z },
        finish() {
            if (z !== nz) throw new Error(`pushed ${z} of ${nz} layers`)
            return { positions: pos.slice(0, 3 * nv), triangles: tri.slice(0, 3 * nt) }
        },
    }
}

/** Every problem that would make a mesh not a closed, consistently wound surface: an edge used
 *  other than once in each direction. Empty is sound. For the tests, and cheap enough to run on
 *  an export. */
export function openEdges(triangles, limit = 10) {
    const seen = new Map()
    const key = (a, b) => a * 4294967296 + b
    for (let i = 0; i < triangles.length; i += 3)
        for (let k = 0; k < 3; k++) {
            const a = triangles[i + k], b = triangles[i + (k + 1) % 3]
            seen.set(key(a, b), (seen.get(key(a, b)) || 0) + 1)
        }
    const out = []
    for (const [k, n] of seen) {
        const a = Math.floor(k / 4294967296), b = k % 4294967296
        if (n !== 1 || seen.get(key(b, a)) !== 1) { out.push(`edge ${a}-${b} used ${n}x, reverse ${seen.get(key(b, a)) || 0}x`); if (out.length >= limit) break }
    }
    return out
}

/** The volume a closed mesh encloses: positive when its triangles face outward. */
export function meshVolume(positions, triangles) {
    let v = 0
    for (let i = 0; i < triangles.length; i += 3) {
        const a = 3 * triangles[i], b = 3 * triangles[i + 1], c = 3 * triangles[i + 2]
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = [positions[a], positions[a + 1], positions[a + 2],
            positions[b], positions[b + 1], positions[b + 2], positions[c], positions[c + 1], positions[c + 2]]
        v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    }
    return v / 6
}

/** The centre of every triangle, xyz: where its colour is sampled. */
export function centroids(positions, triangles) {
    const n = triangles.length / 3, out = new Float32Array(3 * n)
    for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++)
        out[3 * t + k] = (positions[3 * triangles[3 * t] + k] + positions[3 * triangles[3 * t + 1] + k] + positions[3 * triangles[3 * t + 2] + k]) / 3
    return out
}

//----------------------------------------------------------------------------------------------
// Colours
//----------------------------------------------------------------------------------------------

/** Linear to sRGB, one channel in [0, 1] -- a material's baseColor is linear, a file's hex is not. */
export const toSRGB = c => {
    c = Math.min(1, Math.max(0, c))
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}
export const hex = ([r, g, b]) => '#' + [r, g, b].map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()

/**
 * AT MOST `k` COLOURS, because a printer holds a few filaments and a material's code can make a
 * colour per triangle. `rgb` is sRGB in [0, 1], three per item. Colours are first rounded to 8 bits
 * and counted; if there are no more than k of those, they are the palette exactly -- the usual case,
 * one per material. Otherwise k-means over the distinct colours weighted by how many triangles have
 * each, started from the most common and then each farthest from those chosen, so the result is the
 * same every time.
 * @returns { palette: [[r, g, b], ...] most used first, index: Uint16Array, one per item }
 */
export function quantize(rgb, k = 4) {
    const n = rgb.length / 3
    k = Math.max(1, Math.floor(k))
    const keyOf = i => (Math.round(Math.min(1, Math.max(0, rgb[3 * i])) * 255) << 16)
        | (Math.round(Math.min(1, Math.max(0, rgb[3 * i + 1])) * 255) << 8) | Math.round(Math.min(1, Math.max(0, rgb[3 * i + 2])) * 255)
    const count = new Map(), keys = new Uint32Array(n)
    for (let i = 0; i < n; i++) { keys[i] = keyOf(i); count.set(keys[i], (count.get(keys[i]) || 0) + 1) }
    const distinct = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
    const col = key => [(key >> 16) / 255, ((key >> 8) & 255) / 255, (key & 255) / 255]
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
    let centres
    const pick = new Map()
    if (distinct.length <= k) {
        centres = distinct.map(([key]) => col(key))
        distinct.forEach(([key], j) => pick.set(key, j))
    } else {
        const pts = distinct.map(([key, w]) => ({ c: col(key), w, key }))
        centres = [pts[0].c]
        while (centres.length < k) {
            let best = null, bd = -1
            for (const p of pts) { const d = Math.min(...centres.map(c => d2(c, p.c))); if (d > bd) { bd = d; best = p } }
            if (bd <= 0) break
            centres.push(best.c)
        }
        const nearest = c => { let j = 0, bd = Infinity; centres.forEach((m, i) => { const d = d2(m, c); if (d < bd) { bd = d; j = i } }); return j }
        for (let it = 0; it < 30; it++) {
            const sum = centres.map(() => [0, 0, 0, 0])
            for (const p of pts) { const s = sum[nearest(p.c)]; s[0] += p.c[0] * p.w; s[1] += p.c[1] * p.w; s[2] += p.c[2] * p.w; s[3] += p.w }
            const next = sum.map((s, i) => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centres[i])
            const moved = next.some((c, i) => d2(c, centres[i]) > 1e-10)
            centres = next
            if (!moved) break
        }
        for (const p of pts) pick.set(p.key, nearest(p.c))
    }
    // most used first: the first colour is the object's own, the one the slicer shows it in
    const used = centres.map(() => 0)
    for (let i = 0; i < n; i++) used[pick.get(keys[i])]++
    const order = centres.map((_, i) => i).filter(i => used[i] > 0).sort((a, b) => used[b] - used[a] || a - b)
    const remap = new Map(order.map((j, i) => [j, i]))
    const index = new Uint16Array(n)
    for (let i = 0; i < n; i++) index[i] = remap.get(pick.get(keys[i]))
    return { palette: order.map(j => centres[j]), index }
}
