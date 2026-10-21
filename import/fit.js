//======================================================================================================================
// FIT -- a closed triangle mesh (stl.js) as a solid whose faces lie on planes, cylinders, cones, spheres and tori: the
// surfaces a CAD program tessellated to write it, found again, so csg.js can describe it exactly as it does a STEP
// file's B-rep. A hole that was a 24-sided polygon in the STL comes back a cylinder.
//
// WHY IT WORKS ON CAD MESHES: a CAD program puts a tessellation's vertices ON the surface (OpenCascade's BRepMesh does,
// to the float a file holds), so the surface fits them to a few millionths of the part's size, and a plane next to a
// fillet does not fit the fillet's cylinder at all. What it does not do: a scanned or sculpted mesh, whose vertices are
// on no such surface. Its curved regions fit nothing, every facet becomes a plane, and csg.js gives a formula of
// thousands of planes -- exact to the mesh and far too slow to march. convert() refuses that above a size.
//
// HOW:
//   1. FLAT PATCHES: triangles joined across an edge while coplanar (to the fitting tolerance). A plane of the part is
//      one patch; a curved surface is a strip or a fan of patches.
//   2. CURVED REGIONS, grown from the smallest patches first (a curved surface's facets are small): a seed and the two
//      neighbours most like it in size are fitted, and a fit is kept if every vertex is within the tolerance; then each
//      neighbour across a smooth edge (under 40 degrees) joins when its vertices are on that surface already -- so a
//      plane beside a fillet, which is not, stops the growth -- and the surface is fitted again to all of them.
//   3. A REGION OF FEWER THAN THREE PATCHES IS A PLANE (or two): too little to tell a surface by.
//   The fits (sphere, cylinder, cone, torus) start from closed forms -- an algebraic sphere, a cylinder's axis from its
//   normals, a surface of revolution's axis as the line its normal lines meet (Pottmann and Randrup's line complex) --
//   and are refined by Gauss-Newton on the vertices' distances.
//
// INSIDE THE SOLID is the mesh's parity along three rays, each sped up by a grid of the triangles seen along it. The
// mesh is the facets, not the fitted surfaces: within a facet's sag of a curved face the two disagree, so the solid
// says how wide that band is (band) and csg.js keeps its points out of it.
//
//   meshSolid(mesh) -> { name, faces, unsupported: [], guessed: [], inside(p), box, scale, band, warnings }
//   faces: [{ id, surface, sense, loops: [{ points }], sample(n, rnd), triangles }]   (brep.js's shape)
//======================================================================================================================

import { add, sub, mul, dot, cross, len, norm, frame, plane, cylinder, cone, sphere, torus, sameSurface } from './geom.js'

//----------------------------------------------------------------------------------------------------------------------
// LINEAR ALGEBRA, small: symmetric eigenvectors (Jacobi) and least squares (normal equations, Gauss-Jordan)
//----------------------------------------------------------------------------------------------------------------------
/** Eigen-decomposition of a symmetric n x n matrix: { values, vectors } ascending, vectors as rows. */
export function eigen(Ain) {
    const n = Ain.length, A = Ain.map(r => r.slice()), V = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)))
    for (let sweep = 0; sweep < 100; sweep++) {
        let off = 0
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2
        if (off < 1e-30) break
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
            if (Math.abs(A[p][q]) < 1e-300) continue
            const th = (A[q][q] - A[p][p]) / (2 * A[p][q])
            const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c
            for (let k = 0; k < n; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = c * a - s * b; A[k][q] = s * a + c * b }
            for (let k = 0; k < n; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = c * a - s * b; A[q][k] = s * a + c * b }
            for (let k = 0; k < n; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b }
        }
    }
    const idx = [...Array(n).keys()].sort((a, b) => A[a][a] - A[b][b])
    return { values: idx.map(i => A[i][i]), vectors: idx.map(i => V.map(r => r[i])) }
}
/** x minimising |J x - r|^2, by the normal equations with a little damping (lambda). */
function lsq(J, r, lambda = 0) {
    const m = J[0].length, N = Array.from({ length: m }, () => new Array(m + 1).fill(0))
    for (let i = 0; i < J.length; i++) for (let a = 0; a < m; a++) {
        N[a][m] += J[i][a] * r[i]
        for (let b = 0; b < m; b++) N[a][b] += J[i][a] * J[i][b]
    }
    for (let a = 0; a < m; a++) N[a][a] *= 1 + lambda
    for (let c = 0; c < m; c++) {
        let piv = c
        for (let k = c + 1; k < m; k++) if (Math.abs(N[k][c]) > Math.abs(N[piv][c])) piv = k
        ;[N[c], N[piv]] = [N[piv], N[c]]
        if (Math.abs(N[c][c]) < 1e-300) return null
        for (let k = 0; k < m; k++) if (k !== c) { const f = N[k][c] / N[c][c]; for (let j = c; j <= m; j++) N[k][j] -= f * N[c][j] }
    }
    return N.map((row, a) => row[m] / row[a])
}
const perp = d => { const F = frame([0, 0, 0], d); return [F.x, F.y] }

//----------------------------------------------------------------------------------------------------------------------
// FITS: each to points (and, where it helps, the patches' normal lines), refined on the points' distances
//----------------------------------------------------------------------------------------------------------------------
const worst = (S, P) => { let w = 0; for (const p of P) w = Math.max(w, Math.abs(S.g(p))); return w }

/* Gauss-Newton (damped) on a parameter vector: make(x) is the surface, the residuals each point's g */
function refine(x0, make, P, iters = 12) {
    let x = x0.slice(), S = make(x)
    if (!S) return null
    let cost = P.reduce((a, p) => a + S.g(p) ** 2, 0)
    let lambda = 1e-3
    for (let it = 0; it < iters; it++) {
        const r = P.map(p => -S.g(p))
        const J = P.map(() => new Array(x.length))
        for (let k = 0; k < x.length; k++) {
            const h = 1e-7 * (1 + Math.abs(x[k])), xp = x.slice(); xp[k] += h
            const Sp = make(xp)
            if (!Sp) return { x, S }
            P.forEach((p, i) => { J[i][k] = (Sp.g(p) - S.g(p)) / h })
        }
        const dx = lsq(J, r, lambda)
        if (!dx) break
        const xn = x.map((v, k) => v + dx[k]), Sn = make(xn)
        const cn = Sn ? P.reduce((a, p) => a + Sn.g(p) ** 2, 0) : Infinity
        if (cn < cost) { x = xn; S = Sn; cost = cn; lambda *= 0.3 } else lambda *= 10
        if (Math.abs(dx.reduce((a, v) => a + v * v, 0)) < 1e-24) break
    }
    return { x, S }
}

/* a direction near d, moved by (a, b) along two directions across it: how a fit varies an axis */
const turn = (d, e, a, b) => norm(add(d, add(mul(e[0], a), mul(e[1], b))))

export function fitSphere(P) {
    // |p|^2 = 2 c . p + k: linear in (c, k)
    const J = P.map(p => [2 * p[0], 2 * p[1], 2 * p[2], 1]), r = P.map(p => dot(p, p))
    const s = lsq(J, r)
    if (!s) return null
    const c = s.slice(0, 3), R = Math.sqrt(Math.max(0, s[3] + dot(c, c)))
    const f = refine([...c, R], x => x[3] > 0 ? sphere(frame(x.slice(0, 3)), x[3]) : null, P)
    return f?.S ?? null
}

export function fitCylinder(P, normals) {
    // the facets' normals are across the axis: it is the direction they leave out
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for (const n of normals) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += n[i] * n[j]
    const E = eigen(M)
    const a = norm(E.vectors[0])
    if (E.values[0] > 1e-3 * E.values[2]) return null
    const [u, v] = perp(a)
    const Q = P.map(p => [dot(p, u), dot(p, v)])
    const s = lsq(Q.map(q => [2 * q[0], 2 * q[1], 1]), Q.map(q => q[0] * q[0] + q[1] * q[1]))
    if (!s) return null
    const c = add(mul(u, s[0]), mul(v, s[1])), r = Math.sqrt(Math.max(0, s[2] + s[0] * s[0] + s[1] * s[1]))
    const e = perp(a)
    const f = refine([0, 0, 0, 0, r], x => x[4] > 0
        ? cylinder(frame(add(c, add(mul(e[0], x[0]), mul(e[1], x[1]))), turn(a, e, x[2], x[3])), x[4]) : null, P)
    return f?.S ?? null
}

/* THE AXIS OF A SURFACE OF REVOLUTION: the line every normal line meets (Pottmann and Randrup, 1998). A line (a, abar)
   -- direction, moment -- meets the normal line (n, m = c x n) when a . m + abar . n = 0; least squares over the patches
   with |a| = 1 is the smallest eigenvector of the Schur complement A - B C^-1 B^T of the 6 x 6 normal matrix */
function axisOfRevolution(lines) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for (const { c, n, w = 1 } of lines) {
        const m = cross(c, n)
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { A[i][j] += w * m[i] * m[j]; B[i][j] += w * m[i] * n[j]; C[i][j] += w * n[i] * n[j] }
    }
    const Ci = inv3(C)
    if (!Ci) return null
    const BCi = mat(B, Ci), S = A.map((row, i) => row.map((v, j) => v - [0, 1, 2].reduce((a, k) => a + BCi[i][k] * B[j][k], 0)))
    const a = norm(eigen(S).vectors[0])
    let ab = mul([0, 1, 2].map(i => [0, 1, 2].reduce((acc, k) => acc + [0, 1, 2].reduce((x, j) => x + Ci[i][j] * B[k][j], 0) * a[k], 0)), -1)
    ab = sub(ab, mul(a, dot(a, ab)))
    return { o: cross(a, ab), a }
}
const mat = (X, Y) => X.map(r => [0, 1, 2].map(j => r[0] * Y[0][j] + r[1] * Y[1][j] + r[2] * Y[2][j]))
function inv3(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C
    if (Math.abs(det) < 1e-18 * Math.max(1, Math.abs(a * e * i))) return null
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]]
}
/* the points in the half-plane through an axis: (distance from it, height along it) */
const meridian = (o, a, P) => P.map(p => { const d = sub(p, o), z = dot(d, a); return [len(sub(d, mul(a, z))), z] })

/* THE AXIS FROM THE NORMALS ALONE: a cone's normals all make one angle with its axis, so their tips lie on a plane
   across it -- the direction least spread among them. Its place: every normal line meets it, so seen along it they are
   lines through one point. Well posed where the line complex is not: a narrow band of a cone has normal lines that
   nearly meet in one point, and any line through that point meets them all (the boss's chamfer, 2026-10-21: a row of
   its facets gave an axis 73 degrees off). */
function axisFromNormals(lines) {
    const mean = mul(lines.reduce((a, l) => add(a, l.n), [0, 0, 0]), 1 / lines.length)
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for (const { n } of lines) { const d = sub(n, mean); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += d[i] * d[j] }
    const a = norm(eigen(M).vectors[0]), [u, v] = perp(a)
    // each normal line, seen along a: through (c.u, c.v) along (n.u, n.v); the point nearest them all
    const J = [], r = []
    for (const { c, n } of lines) {
        const d = [dot(n, u), dot(n, v)], l = Math.hypot(d[0], d[1])
        if (l < 1e-9) continue
        const k = [-d[1] / l, d[0] / l]                    // across the line
        J.push(k); r.push(k[0] * dot(c, u) + k[1] * dot(c, v))
    }
    const x = J.length >= 2 ? lsq(J, r) : null
    return x ? { o: add(mul(u, x[0]), mul(v, x[1])), a } : null
}

export function fitCone(P, lines) {
    const ax = axisFromNormals(lines)
    if (!ax) return null
    const M = meridian(ax.o, ax.a, P)
    // rho = r0 + k z
    const s = lsq(M.map(([, z]) => [1, z]), M.map(([rho]) => rho))
    if (!s || Math.abs(s[1]) < 1e-6) return null
    const e = perp(ax.a)
    const f = refine([0, 0, 0, 0, s[0], Math.atan(s[1])], x => Math.abs(x[5]) > 1e-6 && Math.abs(x[5]) < Math.PI / 2 - 1e-6
        ? cone(frame(add(ax.o, add(mul(e[0], x[0]), mul(e[1], x[1]))), turn(ax.a, e, x[2], x[3])), x[4], x[5]) : null, P)
    return f?.S ?? null
}

export function fitTorus(P, lines) {
    // both ways of finding the axis, the better fit kept: neither is well posed for every band of a torus
    let best = null
    for (const ax of [axisOfRevolution(lines), axisFromNormals(lines)]) {
        if (!ax) continue
        const S = torusAbout(ax, P)
        if (S && (!best || worst(S, P) < worst(best, P))) best = S
    }
    return best
}
function torusAbout(ax, P) {
    const M = meridian(ax.o, ax.a, P)
    // (rho - R)^2 + (z - z0)^2 = r^2: linear in (R, z0, k)
    const s = lsq(M.map(([rho, z]) => [2 * rho, 2 * z, 1]), M.map(([rho, z]) => rho * rho + z * z))
    if (!s) return null
    const R = s[0], z0 = s[1], r = Math.sqrt(Math.max(0, s[2] + R * R + z0 * z0))
    if (!(R > 0 && r > 0)) return null
    const e = perp(ax.a), o = add(ax.o, mul(ax.a, z0))
    const f = refine([0, 0, 0, 0, 0, R, r], x => x[5] > 0 && x[6] > 0
        ? torus(frame(add(o, add(add(mul(e[0], x[0]), mul(e[1], x[1])), mul(ax.a, x[4]))), turn(ax.a, e, x[2], x[3])), x[5], x[6]) : null, P)
    return f?.S ?? null
}

//----------------------------------------------------------------------------------------------------------------------
// THE MESH: triangles, patches, regions
//----------------------------------------------------------------------------------------------------------------------
export function meshSolid(mesh) {
    const P = mesh.positions, T = mesh.triangles, nT = T.length / 3
    if (mesh.open) throw new Error(`the mesh is not closed (${mesh.open} open edges): it has no inside to convert`)
    const vtx = i => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]) }
    const scale = len(sub(hi, lo)), tol = 2e-5 * scale

    const tn = [], ta = [], tc = []
    for (let t = 0; t < nT; t++) {
        const a = vtx(T[3 * t]), b = vtx(T[3 * t + 1]), c = vtx(T[3 * t + 2])
        const x = cross(sub(b, a), sub(c, a))
        tn.push(norm(x)); ta.push(len(x) / 2); tc.push(mul(add(add(a, b), c), 1 / 3))
    }
    // neighbours across each edge
    const edgeTris = new Map()
    for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
        const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`
        if (!edgeTris.has(key)) edgeTris.set(key, [])
        edgeTris.get(key).push(t)
    }
    const nbr = Array.from({ length: nT }, () => [])
    for (const ts of edgeTris.values()) if (ts.length === 2) { nbr[ts[0]].push(ts[1]); nbr[ts[1]].push(ts[0]) }

    // 1. flat patches
    const patchOf = new Int32Array(nT).fill(-1), patches = []
    for (let s = 0; s < nT; s++) {
        if (patchOf[s] >= 0) continue
        const id = patches.length, n0 = tn[s], c0 = tc[s], tris = [s]
        patchOf[s] = id
        for (let i = 0; i < tris.length; i++) for (const u of nbr[tris[i]]) {
            if (patchOf[u] >= 0 || dot(tn[u], n0) < 1 - 1e-8) continue
            if ([0, 1, 2].some(k => Math.abs(dot(sub(vtx(T[3 * u + k]), c0), n0)) > tol)) continue
            patchOf[u] = id; tris.push(u)
        }
        let area = 0, c = [0, 0, 0]
        for (const t of tris) { area += ta[t]; c = add(c, mul(tc[t], ta[t])) }
        const verts = [...new Set(tris.flatMap(t => [T[3 * t], T[3 * t + 1], T[3 * t + 2]]))]
        patches.push({ id, tris, area, c: mul(c, 1 / area), n: n0, verts })
    }
    const pn = patches.map(() => new Set())
    for (let t = 0; t < nT; t++) for (const u of nbr[t]) if (patchOf[u] !== patchOf[t]) pn[patchOf[t]].add(patchOf[u])
    const smooth = (a, b) => dot(patches[a].n, patches[b].n) > Math.cos(40 * Math.PI / 180)

    // 2. curved regions
    const regionOf = new Int32Array(patches.length).fill(-1), regions = []
    const vertsOf = ids => [...new Set(ids.flatMap(i => patches[i].verts))].map(vtx)
    /* a fit to a spread of at most FIT_POINTS of the region's vertices, held to all of them: the refinement's cost is
       its points times its iterations, and a region of a thousand vertices was most of a part's time (the boss
       fixture: 7.6 s fitting all of them, 2026-10-21) */
    const FIT_POINTS = 120
    /* HOW FAR THE FACETS STRAY from a surface: their centres and the middles of their edges, each allowed a tenth of its
       facet's longest edge. A tessellation's sag is far less than that (it is what its export tolerance bounds), and a
       wrong surface through the same vertices strays by far more: a long rounded edge tessellated as strips has
       vertices only at its two ends, on two circles, and a torus through those two circles fits them as well as the
       cylinder does -- 8 mm off in the strips' middles (the rounded box fixture, 2026-10-21) */
    const probes = patches.map(p => p.tris.flatMap(t => {
        const a = vtx(T[3 * t]), b = vtx(T[3 * t + 1]), c = vtx(T[3 * t + 2])
        const allow = 0.1 * Math.max(len(sub(a, b)), len(sub(b, c)), len(sub(c, a)))
        return [[tc[t], allow], [mul(add(a, b), 0.5), allow], [mul(add(b, c), 0.5), allow], [mul(add(c, a), 0.5), allow]]
    }))
    const sagOf = (ids, S) => { let w = 0; for (const i of ids) for (const [q] of probes[i]) w = Math.max(w, Math.abs(S.g(q))); return w }
    const strays = (ids, S) => ids.some(i => probes[i].some(([q, allow]) => Math.abs(S.g(q)) > Math.max(tol, allow)))
    /** a patch is on a surface when its vertices are, to the tolerance, and its facets do not stray */
    const onSurface = (i, S) => !patches[i].verts.some(v => Math.abs(S.g(vtx(v))) > tol) && !strays([i], S)
    const fitTo = (ids, only = null) => {
        const V = vertsOf(ids), N = ids.map(i => patches[i].n)
        const few = V.length <= FIT_POINTS ? V : Array.from({ length: FIT_POINTS }, (_, k) => V[Math.floor(k * V.length / FIT_POINTS)])
        const lines = ids.map(i => ({ c: patches[i].c, n: patches[i].n, w: 1 }))
        /* each with its number of parameters, and a fit needs three vertices more than that: a sphere passes through
           any four points, and near five or six of a scan's (a jittered sphere's facets gave 614 "surfaces" of three
           triangles before this, 2026-10-21) */
        const tries = { cylinder: [5, () => fitCylinder(few, N)], sphere: [4, () => fitSphere(few)], cone: [6, () => fitCone(few, lines)], torus: [7, () => fitTorus(few, lines)] }
        /* the simplest first: a cylinder is a cone of no angle and a sphere a torus of no ring, and only the simpler one
           may stand for them -- a cone within half a degree of a cylinder or a plane is refused. A cone or a torus is
           not tried on fewer than eight patches: on three or five, where two surfaces meet, one passes through both */
        const kinds = only ? [only] : ids.length >= 8 ? Object.keys(tries) : ['cylinder', 'sphere']
        /* SEVERAL MAY FIT THE VERTICES: a chamfer one facet wide has all its vertices on its two edge circles, and a sphere
           passes through any two circles on one axis as well as the cone does. The facets tell them apart: a cone's
           straight lines run along them where they cut inside a sphere. So of the surfaces that fit, the one the facets
           stray from least -- the simpler unless another is clearly (a tenth of the tolerance) better */
        let best = null, bestSag = Infinity
        for (const k of kinds) {
            const [nParams, fit] = tries[k]
            if (V.length < nParams + 3) continue
            let S = null
            try { S = fit() } catch { S = null }
            if (!S) continue
            if ((S.r ?? 0) > 2 * scale || (S.R ?? 0) > 2 * scale) continue
            if (S.type === 'cone' && (Math.abs(S.semi) < 0.5 * Math.PI / 180 || Math.abs(S.semi) > 89.5 * Math.PI / 180)) continue
            if (worst(S, V) > tol || strays(ids, S)) continue
            const sg = sagOf(ids, S)
            if (sg < bestSag - 0.1 * tol) { best = S; bestSag = sg }
        }
        return best
    }
    const order = patches.map(p => p.id).sort((a, b) => patches[a].area - patches[b].area)
    for (const s of order) {
        if (regionOf[s] >= 0) continue
        /* THE SURFACE'S TYPE is decided once, from the seed's neighbourhood: the patches nearest it across smooth edges,
           twelve if they fit one surface, else eight, five, three -- more patches leave fewer surfaces that pass through
           them all, and fewer are what is left where two surfaces meet. Then it only grows, refitted in that type. */
        const near = [s]
        for (let i = 0; i < near.length && near.length < 12; i++)
            for (const q of [...pn[near[i]]].sort((a, b) => Math.abs(Math.log(patches[a].area / patches[s].area)) - Math.abs(Math.log(patches[b].area / patches[s].area))))
                if (near.length < 12 && !near.includes(q) && regionOf[q] < 0 && smooth(near[i], q)) near.push(q)
        let ids = null, S = null
        for (const K of [12, 8, 5, 3]) {
            if (near.length < K) continue
            S = fitTo(near.slice(0, K))
            if (S) { ids = near.slice(0, K); break }
        }
        if (!S) continue
        const type = S.type
        const inRegion = new Set(ids)
        const frontier = ids.flatMap(i => [...pn[i]])
        let since = 0
        while (frontier.length) {
            const q = frontier.shift()
            if (inRegion.has(q) || regionOf[q] >= 0) continue
            if (![...pn[q]].some(o => inRegion.has(o) && smooth(o, q))) continue
            if (!onSurface(q, S)) continue
            inRegion.add(q); ids.push(q); frontier.push(...pn[q])
            if (++since >= ids.length / 2) { const S2 = fitTo(ids, type); if (S2) S = S2; since = 0 }
        }
        const S2 = fitTo(ids, type)
        if (S2) S = S2
        const r = regions.length
        for (const i of ids) regionOf[i] = r
        regions.push({ ids, surface: S })
    }
    /* EACH REGION FITTED AGAIN, WHOLE, with every type: its type was decided from a few patches near its seed, where a
       row of a chamfer's facets spans too little of the circle to find the cone's axis and a sphere through its two
       edges fits instead (the boss fixture, 2026-10-21); all of the row tells them apart */
    regions.forEach(R => {
        if (R.ids.length < 8) return
        const S = fitTo(R.ids)
        if (S && S.type !== R.surface.type && sagOf(R.ids, S) < sagOf(R.ids, R.surface) - 0.1 * tol) R.surface = S
    })
    /* A REGION ON A BIGGER NEIGHBOUR'S SURFACE joins it, repeatedly: the facets at a fillet's end, a sliver of a torus
       where it runs tangent to a cylinder, taken for something else before the bigger one grew to them */
    for (let changed = true; changed;) {
        changed = false
        regions.forEach((R, r) => {
            if (!R) return
            const around = new Set(R.ids.flatMap(i => [...pn[i]]).map(q => regionOf[q]).filter(o => o >= 0 && o !== r && regions[o]))
            for (const o of [...around].sort((a, b) => regions[b].ids.length - regions[a].ids.length)) {
                const S = regions[o].surface
                if (regions[o].ids.length <= R.ids.length) continue
                if (R.ids.some(i => !onSurface(i, S))) continue
                for (const i of R.ids) regionOf[i] = o
                regions[o].ids.push(...R.ids)
                regions[r] = null
                changed = true
                return
            }
        })
    }
    // ...and a patch on a curved neighbour's surface the growth left out (its fits were refused twice) joins it too
    patches.forEach(p => {
        if (regionOf[p.id] >= 0) return
        for (const q of pn[p.id]) {
            const o = regionOf[q]
            if (o < 0 || !regions[o]) continue
            if (!onSurface(p.id, regions[o].surface)) continue
            regionOf[p.id] = o; regions[o].ids.push(p.id); return
        }
    })
    // pieces of one surface the growth found apart (either side of a hole's edge, a fillet cut by another) are one face
    regions.forEach((R, r) => {
        if (!R) return
        for (let o = r + 1; o < regions.length; o++) {
            const Q = regions[o]
            if (!Q || !sameSurface(R.surface, Q.surface, 10 * tol, 1e-8)) continue
            for (const i of Q.ids) regionOf[i] = r
            R.ids.push(...Q.ids)
            regions[o] = null
        }
    })
    for (let r = regions.length - 1; r >= 0; r--) if (!regions[r]) {
        regions.splice(r, 1)
        for (let i = 0; i < regionOf.length; i++) if (regionOf[i] > r) regionOf[i]--
    }
    // 3. what is left is planes, one a patch
    for (const p of patches) if (regionOf[p.id] < 0) {
        regionOf[p.id] = regions.length
        regions.push({ ids: [p.id], surface: plane(frame(p.c, p.n)) })
    }

    // FACES: a region's triangles, its surface faced the way the mesh's outward normals are, its edges' points
    let band = 0
    const faces = regions.map((R, k) => {
        const tris = R.ids.flatMap(i => patches[i].tris)
        const S = R.surface
        let s = 0, area = 0
        for (const t of tris) {
            s += ta[t] * Math.sign(dot(tn[t], S.grad(tc[t])))
            area += ta[t]
            // how far the facets stray from the surface: their centres and their edges' middles
            band = Math.max(band, Math.abs(S.g(tc[t])))
            for (let e = 0; e < 3; e++) band = Math.max(band, Math.abs(S.g(mul(add(vtx(T[3 * t + e]), vtx(T[3 * t + (e + 1) % 3])), 0.5))))
        }
        const mine = new Set(tris)
        const boundary = []
        for (const t of tris) for (let e = 0; e < 3; e++) {
            const a = T[3 * t + e], b = T[3 * t + (e + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`
            if (edgeTris.get(key).some(u => !mine.has(u))) boundary.push(vtx(a))
        }
        const project = p => sub(p, mul(S.grad(p), S.g(p)))
        const cum = []
        let acc = 0
        for (const t of tris) { acc += ta[t]; cum.push(acc) }
        const sample = (n, rnd) => {
            const out = []
            for (let i = 0; i < n; i++) {
                const x = rnd() * acc
                let l = 0, h = cum.length - 1
                while (l < h) { const m = (l + h) >> 1; if (cum[m] < x) l = m + 1; else h = m }
                const t = tris[l]
                let u = rnd(), v = rnd()
                if (u + v > 1) { u = 1 - u; v = 1 - v }
                const a = vtx(T[3 * t]), b = vtx(T[3 * t + 1]), c = vtx(T[3 * t + 2])
                out.push(project(add(a, add(mul(sub(b, a), u), mul(sub(c, a), v)))))
            }
            return out
        }
        return { id: k + 1, surface: S, sense: s >= 0, triangles: tris, area,
                 loops: [{ points: boundary.map(project), edges: [] }], sample }
    })

    const inside = meshInside(mesh)
    const curved = faces.filter(f => f.surface.type !== 'plane').length
    const warnings = []
    return { name: mesh.name || '', faces, unsupported: [], guessed: [], inside, box: { lo, hi }, scale, band, surfaceTol: 10 * tol, surfaceAngle: 1e-8, warnings,
             fitted: { patches: patches.length, curved, planes: faces.length - curved } }
}

//----------------------------------------------------------------------------------------------------------------------
// INSIDE THE MESH: parity along three rays, each with a grid of the triangles as seen along it
//----------------------------------------------------------------------------------------------------------------------
const RAYS = [norm([0.5773, 0.6124, 0.5402]), norm([-0.7071, 0.3157, 0.6324]), norm([0.2142, -0.8813, 0.4211])]

export function meshInside(mesh) {
    const P = mesh.positions, T = mesh.triangles, nT = T.length / 3
    const grids = RAYS.map(d => {
        const [u, v] = perp(d)
        const q = new Float64Array(2 * P.length / 3), w = new Float64Array(P.length / 3)
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
        for (let i = 0; i < P.length / 3; i++) {
            const p = [P[3 * i], P[3 * i + 1], P[3 * i + 2]]
            q[2 * i] = dot(p, u); q[2 * i + 1] = dot(p, v); w[i] = dot(p, d)
            x0 = Math.min(x0, q[2 * i]); x1 = Math.max(x1, q[2 * i]); y0 = Math.min(y0, q[2 * i + 1]); y1 = Math.max(y1, q[2 * i + 1])
        }
        const G = Math.max(1, Math.ceil(Math.sqrt(nT / 2))), sx = (x1 - x0) / G || 1, sy = (y1 - y0) / G || 1
        const cells = Array.from({ length: G * G }, () => [])
        for (let t = 0; t < nT; t++) {
            let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
            for (let k = 0; k < 3; k++) { const i = T[3 * t + k]; a0 = Math.min(a0, q[2 * i]); a1 = Math.max(a1, q[2 * i]); b0 = Math.min(b0, q[2 * i + 1]); b1 = Math.max(b1, q[2 * i + 1]) }
            const i0 = Math.max(0, Math.floor((a0 - x0) / sx)), i1 = Math.min(G - 1, Math.floor((a1 - x0) / sx))
            const j0 = Math.max(0, Math.floor((b0 - y0) / sy)), j1 = Math.min(G - 1, Math.floor((b1 - y0) / sy))
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cells[i * G + j].push(t)
        }
        return { d, u, v, q, w, x0, y0, sx, sy, G, cells }
    })
    const parity = (g, p) => {
        const px = dot(p, g.u), py = dot(p, g.v), pz = dot(p, g.d)
        const i = Math.floor((px - g.x0) / g.sx), j = Math.floor((py - g.y0) / g.sy)
        if (i < 0 || j < 0 || i >= g.G || j >= g.G) return 0
        let n = 0
        for (const t of g.cells[i * g.G + j]) {
            const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2]
            const ax = g.q[2 * a] - px, ay = g.q[2 * a + 1] - py, bx = g.q[2 * b] - px, by = g.q[2 * b + 1] - py, cx = g.q[2 * c] - px, cy = g.q[2 * c + 1] - py
            const e0 = ax * by - ay * bx, e1 = bx * cy - by * cx, e2 = cx * ay - cy * ax
            if (!((e0 > 0 && e1 > 0 && e2 > 0) || (e0 < 0 && e1 < 0 && e2 < 0))) continue
            const s = e0 + e1 + e2, z = (e1 * g.w[a] + e2 * g.w[b] + e0 * g.w[c]) / s
            if (z > pz) n++
        }
        return n & 1
    }
    return p => grids.reduce((v, g) => v + parity(g, p), 0) >= 2
}
