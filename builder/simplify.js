//======================================================================================================================
// SIMPLIFY -- a print mesh (mesh.js) with fewer triangles: large ones where the surface is flat, small ones where it
// curves, every vertex kept within a tolerance of the surface it came from (0.next).
//
// WHY: marching tetrahedra gives about the same number of triangles per cell everywhere, flat or not -- a box of
// 16 x 12 x 8 mm at a 0.4 mm cell is 38 072 triangles, about 7 per cell of its surface, and 24 once simplified
// (test/simplify.test.mjs). A grid fine enough for a curve is far finer than a flat face needs.
//
// HOW: EDGE COLLAPSE ORDERED BY QUADRIC ERROR (Garland and Heckbert, 1997). Each vertex carries the sum of the squared
// distance functions of its triangles' planes (a quadric, 10 numbers); collapsing an edge gives one vertex the two
// quadrics' sum and puts it where that sum is least. The cheapest collapse goes first (ties: the shortest edge, see
// THE ORDER below), and none whose cost passes the tolerance squared is made. A collapse on a flat region costs
// nothing, so flat regions empty first; one on a curve costs more the further the merged vertex sits off the curve's
// planes, so the triangles stay small where it bends.
//
// WHAT THE TOLERANCE MEANS, exactly: the quadrics are NOT area-weighted, so a vertex's error is a SUM of squared
// distances, one per original triangle plane it has absorbed (a plane may be counted up to three times, once per
// corner). A sum at most tol^2 means EVERY one of those distances is at most tol: each kept vertex lies within tol of
// the plane of every original triangle merged into it. That is a statement about vertices and planes, not a Hausdorff
// distance between meshes; the test (test/simplify.test.mjs) measures the real deviation from the true surface of a
// sphere and a torus and holds it to the tolerance plus the mesher's own error. The sum is conservative: many planes
// each within tol add up, so the real deviation comes out well under tol (measured in that test, a 10 mm sphere at a
// 0.4 mm cell: 0.013 mm at a tolerance of 0.05, 0.034 at 0.2).
//
// WHAT A COLLAPSE MAY NOT DO -- each is what a slicer needs or what keeps the claim above:
//   - THE LINK CONDITION: the two ends share exactly the two neighbours opposite the edge. Otherwise the collapse
//     pinches the surface (an edge in four triangles) or closes a handle. With it the mesh stays a closed, consistently
//     wound 2-manifold of the same genus: mesh.js's guarantee, kept.
//   - NO NEIGHBOUR LEFT WITH DEGREE 2 (the last collapse of a tetrahedron, two triangles back to back).
//   - NO TRIANGLE TURNED OVER: every triangle that moves keeps its normal within 78 degrees of where it was (cos 0.2),
//     and none that was not a needle becomes one (QUALITY_FLOOR below).
//   - NOT FAR FROM THE EDGE: the new vertex inside the sphere the edge is a diameter of. A quadric of near-parallel
//     planes is near-singular and its minimum can lie anywhere along them; a vertex there is within tol of every plane
//     and nowhere near the triangles that made them.
//   - COLOUR BORDERS KEPT, when each triangle has a colour (`labels`, the 3MF's palette index): a vertex inside one
//     colour moves freely; a vertex on the border of two moves only along it (both ends on it, the edge itself a border
//     edge), with a plane through each border edge, perpendicular to its triangle, added to the quadrics so the border
//     too stays within tol of where it was; a vertex where three colours meet, or where a border touches itself, never
//     moves. So a colour region keeps its shape and no triangle changes colour.
//
// WHAT IT DOES NOT PROMISE: that the two sides of a wall thinner than about twice the tolerance do not cross. Edge
// collapse never joins two surfaces, but it can move one through the other. Slicers mend that; a tolerance under the
// thinnest wall avoids it.
//
// PURE, like mesh.js: numbers in, numbers out. `simplify` yields to the caller every `sliceMs` (an async function) so a
// page's export does not freeze it for the seconds a few million triangles take.
//======================================================================================================================

/** A triangle's quality, 4 sqrt(3) area / (sum of squared edge lengths): 1 equilateral, 0 a needle or a sliver. */
const QUALITY_FLOOR = 0.05
const NORMAL_COS = 0.2
const LENGTH_WEIGHT = 0.01

/**
 * @param mesh     { positions: Float32Array xyz, triangles: Uint32Array abc } -- closed and consistently wound
 * @param tol      the tolerance, in the positions' units (the exporter's mm); 0 or less gives the mesh back as it is
 * @param labels   optional, one integer per triangle (a colour): borders between them are kept (header)
 * @param onProgress (fraction of the collapse budget done) => void, at most once a slice
 * @param sliceMs  how long to work between yields
 * @returns Promise<{ positions, triangles, labels (or null), collapses }>
 */
export async function simplify({ positions, triangles }, { tol, labels = null, onProgress = () => { }, sliceMs = 40 } = {}) {
    const nt0 = triangles.length / 3, nv0 = positions.length / 3
    if (!(tol > 0) || nt0 === 0) return { positions, triangles, labels, collapses: 0 }
    if (labels && labels.length !== nt0) throw new Error(`a label per triangle: ${nt0}, got ${labels.length}`)
    const maxErr = tol * tol

    const P = Float64Array.from(positions)
    const T = Int32Array.from(triangles)
    const alive = new Uint8Array(nt0).fill(1)
    const vdead = new Uint8Array(nv0)
    const stamp = new Uint32Array(nv0)

    // ---- each vertex's triangles: a CSR to start, then a JS array per vertex once it has grown (a collapse merges)
    const vt = new Array(nv0)
    {
        const deg = new Int32Array(nv0)
        for (let i = 0; i < T.length; i++) deg[T[i]]++
        for (let v = 0; v < nv0; v++) vt[v] = []
        for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) vt[T[3 * t + k]].push(t)
    }

    // ---- quadrics: [a2, ab, ac, ad, b2, bc, bd, c2, cd, d2] per vertex
    const Q = new Float64Array(10 * nv0)
    const addPlane = (v, nx, ny, nz, d) => {
        const q = 10 * v
        Q[q] += nx * nx; Q[q + 1] += nx * ny; Q[q + 2] += nx * nz; Q[q + 3] += nx * d
        Q[q + 4] += ny * ny; Q[q + 5] += ny * nz; Q[q + 6] += ny * d
        Q[q + 7] += nz * nz; Q[q + 8] += nz * d; Q[q + 9] += d * d
    }
    const normalOf = (a, b, c, out) => {
        const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2]
        const wx = P[3 * c] - P[3 * a], wy = P[3 * c + 1] - P[3 * a + 1], wz = P[3 * c + 2] - P[3 * a + 2]
        out[0] = uy * wz - uz * wy; out[1] = uz * wx - ux * wz; out[2] = ux * wy - uy * wx
        return Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2])
    }
    const n3 = [0, 0, 0]
    for (let t = 0; t < nt0; t++) {
        const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2]
        const l = normalOf(a, b, c, n3)
        if (!(l > 0)) continue                          // a degenerate triangle has no plane: it constrains nothing
        const nx = n3[0] / l, ny = n3[1] / l, nz = n3[2] / l
        const d = -(nx * P[3 * a] + ny * P[3 * a + 1] + nz * P[3 * a + 2])
        addPlane(a, nx, ny, nz, d); addPlane(b, nx, ny, nz, d); addPlane(c, nx, ny, nz, d)
    }

    // ---- colours: each vertex free (one colour), on a border (two, and exactly two border edges) or fixed
    const FREE = 0, BORDER = 1, FIXED = 2
    const kind = new Uint8Array(nv0)
    // whether the edge (u, v) has triangles of two colours: its two triangles are those of u's holding v
    const borderEdge = (u, v) => {
        let first = -1
        for (const t of vt[u]) {
            if (!alive[t]) continue
            if (T[3 * t] !== v && T[3 * t + 1] !== v && T[3 * t + 2] !== v) continue
            if (first < 0) first = labels[t]
            else return labels[t] !== first
        }
        return false
    }
    if (labels) {
        for (let v = 0; v < nv0; v++) {
            const ls = vt[v].map(t => labels[t])
            const distinct = new Set(ls).size
            if (distinct === 1) continue
            if (distinct > 2) { kind[v] = FIXED; continue }
            kind[v] = BORDER
        }
        // the border planes, and a border vertex with other than two border edges fixed
        const borderCount = new Int32Array(nv0)
        for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) {
            const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3]
            // each border edge seen from both its triangles; take it from one direction only, and the plane from each side
            if (kind[a] === FREE || kind[b] === FREE || !borderEdge(a, b)) continue
            if (a < b) { borderCount[a]++; borderCount[b]++ }
            const c = T[3 * t + (k + 2) % 3]
            const l = normalOf(a, b, c, n3)
            if (!(l > 0)) continue
            const ex = P[3 * b] - P[3 * a], ey = P[3 * b + 1] - P[3 * a + 1], ez = P[3 * b + 2] - P[3 * a + 2]
            let px = ey * n3[2] - ez * n3[1], py = ez * n3[0] - ex * n3[2], pz = ex * n3[1] - ey * n3[0]
            const pl = Math.sqrt(px * px + py * py + pz * pz)
            if (!(pl > 0)) continue
            px /= pl; py /= pl; pz /= pl
            const d = -(px * P[3 * a] + py * P[3 * a + 1] + pz * P[3 * a + 2])
            addPlane(a, px, py, pz, d); addPlane(b, px, py, pz, d)
        }
        for (let v = 0; v < nv0; v++) if (kind[v] === BORDER && borderCount[v] !== 2) kind[v] = FIXED
    }

    // ---- the heap: candidates (cost, u, v, stamp[u] + stamp[v]); stale ones are skipped when popped
    let cap = 1 << 16, size = 0
    let hc = new Float64Array(cap), hu = new Int32Array(cap), hv = new Int32Array(cap), hs = new Uint32Array(cap)
    let hx = new Float64Array(3 * cap)
    const push = (c, u, v, s, x, y, z) => {
        if (size === cap) {
            cap *= 2
            const g = (A, n) => { const B = new A.constructor(n); B.set(A); return B }
            hc = g(hc, cap); hu = g(hu, cap); hv = g(hv, cap); hs = g(hs, cap); hx = g(hx, 3 * cap)
        }
        let i = size++
        while (i > 0) {
            const p = (i - 1) >> 1
            if (hc[p] <= c) break
            hc[i] = hc[p]; hu[i] = hu[p]; hv[i] = hv[p]; hs[i] = hs[p]
            hx[3 * i] = hx[3 * p]; hx[3 * i + 1] = hx[3 * p + 1]; hx[3 * i + 2] = hx[3 * p + 2]
            i = p
        }
        hc[i] = c; hu[i] = u; hv[i] = v; hs[i] = s; hx[3 * i] = x; hx[3 * i + 1] = y; hx[3 * i + 2] = z
    }
    const top = { c: 0, u: 0, v: 0, s: 0, x: 0, y: 0, z: 0 }
    const pop = () => {
        top.c = hc[0]; top.u = hu[0]; top.v = hv[0]; top.s = hs[0]; top.x = hx[0]; top.y = hx[1]; top.z = hx[2]
        const last = --size
        if (last === 0) return
        const c = hc[last], u = hu[last], v = hv[last], s = hs[last], x = hx[3 * last], y = hx[3 * last + 1], z = hx[3 * last + 2]
        let i = 0
        for (;;) {
            let m = 2 * i + 1
            if (m >= last) break
            if (m + 1 < last && hc[m + 1] < hc[m]) m++
            if (hc[m] >= c) break
            hc[i] = hc[m]; hu[i] = hu[m]; hv[i] = hv[m]; hs[i] = hs[m]
            hx[3 * i] = hx[3 * m]; hx[3 * i + 1] = hx[3 * m + 1]; hx[3 * i + 2] = hx[3 * m + 2]
            i = m
        }
        hc[i] = c; hu[i] = u; hv[i] = v; hs[i] = s; hx[3 * i] = x; hx[3 * i + 1] = y; hx[3 * i + 2] = z
    }

    // ---- the cost of collapsing (u, v), and where to: or nothing when the colours forbid it
    const S = new Float64Array(10)
    const evalQ = (x, y, z) => S[0] * x * x + 2 * S[1] * x * y + 2 * S[2] * x * z + 2 * S[3] * x
        + S[4] * y * y + 2 * S[5] * y * z + 2 * S[6] * y + S[7] * z * z + 2 * S[8] * z + S[9]
    const best = [0, 0, 0]
    /** Fills best[] and returns the cost, or -1 for no collapse. */
    function candidate(u, v) {
        const ku = kind[u], kv = kind[v]
        // which ends may move: a fixed one never, a border one only along a border edge
        let place = 0                                   // 0 anywhere, 1 at u, 2 at v
        if (ku === FREE && kv === FREE) place = 0
        else if (ku === FREE) place = 2
        else if (kv === FREE) place = 1
        else if (ku === BORDER && kv === BORDER && borderEdge(u, v)) place = 0
        else if (ku === BORDER && kv === FIXED && borderEdge(u, v)) place = 2
        else if (kv === BORDER && ku === FIXED && borderEdge(u, v)) place = 1
        else return -1
        for (let k = 0; k < 10; k++) S[k] = Q[10 * u + k] + Q[10 * v + k]
        const ux = P[3 * u], uy = P[3 * u + 1], uz = P[3 * u + 2], vx = P[3 * v], vy = P[3 * v + 1], vz = P[3 * v + 2]
        if (place === 1) { best[0] = ux; best[1] = uy; best[2] = uz; return Math.max(0, evalQ(ux, uy, uz)) }
        if (place === 2) { best[0] = vx; best[1] = vy; best[2] = vz; return Math.max(0, evalQ(vx, vy, vz)) }
        // the quadric's minimum: solve A p = -b, A symmetric 3x3
        const a = S[0], b = S[1], c = S[2], e = S[4], f = S[5], i = S[7]
        const A00 = e * i - f * f, A01 = c * f - b * i, A02 = b * f - c * e
        const det = a * A00 + b * A01 + c * A02
        const mx = (ux + vx) / 2, my = (uy + vy) / 2, mz = (uz + vz) / 2
        const r2 = ((vx - ux) ** 2 + (vy - uy) ** 2 + (vz - uz) ** 2) / 4
        let cost = Infinity
        // a determinant small against the matrix's own scale is a near-singular quadric (flat, or a crease): its
        // minimum is a line or a plane, and the solve's point is wherever rounding put it
        const scale = a + e + i
        if (Math.abs(det) > 1e-9 * scale * scale * scale) {
            const A11 = a * i - c * c, A12 = b * c - a * f, A22 = a * e - b * b
            const d1 = S[3], d2 = S[6], d3 = S[8]
            const x = -(A00 * d1 + A01 * d2 + A02 * d3) / det
            const y = -(A01 * d1 + A11 * d2 + A12 * d3) / det
            const z = -(A02 * d1 + A12 * d2 + A22 * d3) / det
            if ((x - mx) ** 2 + (y - my) ** 2 + (z - mz) ** 2 <= r2) { cost = evalQ(x, y, z); best[0] = x; best[1] = y; best[2] = z }
        }
        // otherwise, or if it is no better, the better of the ends and the midpoint
        for (const [x, y, z] of [[ux, uy, uz], [vx, vy, vz], [mx, my, mz]]) {
            const q = evalQ(x, y, z)
            if (q < cost) { cost = q; best[0] = x; best[1] = y; best[2] = z }
        }
        return Math.max(0, cost)
    }
    /* THE ORDER is the error plus a little of the edge's length squared (LENGTH_WEIGHT of the tolerance squared for an
       edge of the mesh's mean length). On a flat region every collapse costs nothing, and ties broken by the heap's
       arbitrary order grew hubs: one vertex collapsed into again and again, a fan of needles round it that refused
       every collapse after (on a ball on a plinth, 85 % of the collapses tried were refused). Shortest first keeps the
       triangles even. The length is only the order: what may be collapsed is the error alone, below. */
    let lambda = 0
    {
        let sum = 0
        for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) {
            const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3]
            sum += (P[3 * a] - P[3 * b]) ** 2 + (P[3 * a + 1] - P[3 * b + 1]) ** 2 + (P[3 * a + 2] - P[3 * b + 2]) ** 2
        }
        const mean = sum / (3 * nt0)
        lambda = mean > 0 ? LENGTH_WEIGHT * maxErr / mean : 0
    }
    const offer = (u, v) => {
        if (u === v) return
        const c = candidate(u, v)
        if (c < 0 || c > maxErr) return                 // over the tolerance now: offered again only when u or v changes
        const l2 = (P[3 * u] - P[3 * v]) ** 2 + (P[3 * u + 1] - P[3 * v + 1]) ** 2 + (P[3 * u + 2] - P[3 * v + 2]) ** 2
        push(c + lambda * l2, u, v, stamp[u] + stamp[v], best[0], best[1], best[2])
    }

    // the initial edges, each once
    for (let t = 0; t < nt0; t++) for (let k = 0; k < 3; k++) {
        const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3]
        if (a < b) offer(a, b)
    }

    // ---- the checks of a collapse (header)
    const mark = new Int32Array(nv0)
    let gen = 0
    const quality = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
        const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
        const s = ux * ux + uy * uy + uz * uz + wx * wx + wy * wy + wz * wz + (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2
        return s > 0 ? 2 * Math.sqrt(3) * Math.sqrt(nx * nx + ny * ny + nz * nz) / s : 0
    }
    /** Whether moving u's and v's triangles to (x, y, z) keeps every one the right way up and makes no needle. */
    function moveOk(u, v, x, y, z) {
        for (let side = 0; side < 2; side++) for (const t of vt[side ? v : u]) {
            const w = side ? v : u
            if (!alive[t]) continue
            const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2]
            const hasU = a === u || b === u || c === u, hasV = a === v || b === v || c === v
            if (hasU && hasV) continue                  // one of the two that go
            if (w === v && hasU) continue               // seen from u already
            const ax = a === w ? x : P[3 * a], ay = a === w ? y : P[3 * a + 1], az = a === w ? z : P[3 * a + 2]
            const bx = b === w ? x : P[3 * b], by = b === w ? y : P[3 * b + 1], bz = b === w ? z : P[3 * b + 2]
            const cx = c === w ? x : P[3 * c], cy = c === w ? y : P[3 * c + 1], cz = c === w ? z : P[3 * c + 2]
            const q0 = quality(P[3 * a], P[3 * a + 1], P[3 * a + 2], P[3 * b], P[3 * b + 1], P[3 * b + 2], P[3 * c], P[3 * c + 1], P[3 * c + 2])
            const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az
            const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
            const l1 = Math.sqrt(nx * nx + ny * ny + nz * nz)
            if (!(l1 > 0)) return false
            const l0 = normalOf(a, b, c, n3)
            if (l0 > 0 && (nx * n3[0] + ny * n3[1] + nz * n3[2]) < NORMAL_COS * l0 * l1) return false
            // no triangle made a needle that was not one: one that already is may stay one, or the slivers of a
            // surface through grid points (a collapse moves them a little) would hold every collapse round them
            if (q0 >= QUALITY_FLOOR && quality(ax, ay, az, bx, by, bz, cx, cy, cz) < QUALITY_FLOOR) return false
        }
        return true
    }
    /** The link condition and the degree check: u and v share exactly two neighbours, each left with three or more. */
    function linkOk(u, v) {
        gen++
        let edgeSeen = false
        for (const t of vt[u]) {
            if (!alive[t]) continue
            for (let k = 0; k < 3; k++) { const w = T[3 * t + k]; if (w !== u) { mark[w] = gen; if (w === v) edgeSeen = true } }
        }
        if (!edgeSeen) return false
        let common = 0
        const seen = []
        for (const t of vt[v]) {
            if (!alive[t]) continue
            for (let k = 0; k < 3; k++) {
                const w = T[3 * t + k]
                if (w === v || w === u || mark[w] !== gen) continue
                mark[w] = -gen; common++; seen.push(w)
            }
        }
        if (common !== 2) return false
        for (const w of seen) {
            let deg = 0
            for (const t of vt[w]) if (alive[t]) deg++
            if (deg - 1 < 3) return false
        }
        return true
    }

    // ---- collapse, cheapest first
    let collapses = 0
    const budget = nv0
    let t0 = Date.now()
    while (size > 0) {
        pop()
        const { u, v } = top
        if (vdead[u] || vdead[v] || stamp[u] + stamp[v] !== top.s) continue
        const x = top.x, y = top.y, z = top.z
        if (!linkOk(u, v) || !moveOk(u, v, x, y, z)) continue
        // u goes into v, which moves to (x, y, z)
        for (const t of vt[u]) {
            if (!alive[t]) continue
            const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2]
            if (a === v || b === v || c === v) { alive[t] = 0; continue }
            for (let k = 0; k < 3; k++) if (T[3 * t + k] === u) T[3 * t + k] = v
            vt[v].push(t)
        }
        vt[v] = vt[v].filter(t => alive[t])
        vt[u] = null
        vdead[u] = 1
        P[3 * v] = x; P[3 * v + 1] = y; P[3 * v + 2] = z
        for (let k = 0; k < 10; k++) Q[10 * v + k] += Q[10 * u + k]
        // a border vertex merged into a fixed one is fixed; a free one into anything takes that thing's kind
        kind[v] = Math.max(kind[u], kind[v])
        stamp[v]++
        collapses++
        // the edges around v, again
        gen++
        for (const t of vt[v]) for (let k = 0; k < 3; k++) {
            const w = T[3 * t + k]
            if (w !== v && mark[w] !== gen) { mark[w] = gen; offer(v, w) }
        }
        if ((collapses & 1023) === 0 && Date.now() - t0 > sliceMs) {
            onProgress(Math.min(1, collapses / budget))
            await new Promise(r => setTimeout(r, 0))
            t0 = Date.now()
        }
    }

    // ---- compact: the vertices still used, renumbered in their order; the triangles alive, in theirs
    const remap = new Int32Array(nv0).fill(-1)
    let nv = 0, nt = 0
    for (let t = 0; t < nt0; t++) if (alive[t]) { nt++; for (let k = 0; k < 3; k++) { const w = T[3 * t + k]; if (remap[w] < 0) remap[w] = nv++ } }
    const outP = new Float32Array(3 * nv), outT = new Uint32Array(3 * nt), outL = labels ? new labels.constructor(nt) : null
    for (let w = 0; w < nv0; w++) if (remap[w] >= 0) { const r = remap[w]; outP[3 * r] = P[3 * w]; outP[3 * r + 1] = P[3 * w + 1]; outP[3 * r + 2] = P[3 * w + 2] }
    let j = 0
    for (let t = 0; t < nt0; t++) if (alive[t]) {
        for (let k = 0; k < 3; k++) outT[3 * j + k] = remap[T[3 * t + k]]
        if (outL) outL[j] = labels[t]
        j++
    }
    onProgress(1)
    return { positions: outP, triangles: outT, labels: outL, collapses }
}
