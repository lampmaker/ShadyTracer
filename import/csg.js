//======================================================================================================================
// CSG -- a solid whose faces lie on planes, cylinders, cones, spheres and tori, as a boolean formula over the half-
// spaces of those surfaces: what the renderer's builder already is (a group's children joined by union, subtract and
// intersect), so an imported part becomes shapes it has, exact, with their normals.
//
// WHY THIS AND NOT A MESH OR A GRID (roadmap/IMPORT.md section 11). A distance field marches by the distance it is
// given; a formula of min and max over exact half-spaces is a lower bound on the true distance everywhere and zero
// exactly on the surface, so it marches safely with the analytic normal of whichever surface is nearest -- and a
// lens's sphere stays a sphere, where a mesh or a grid of it has facets. What it costs is a step's worth of
// evaluating each half-space the formula holds, which is why the formula is minimised.
//
// THE CONSTRUCTION (Shapiro and Vossler's, 1991, with sampling where they had exact geometry):
//   1. HALF-SPACES. Each face lies on a surface; faces on the same surface share it (two halves of a cylinder are one
//      cylinder). A surface's inside is geom.js's (g < 0); a face whose solid is on the other side is its complement.
//   2. SEPARATORS. The faces' own surfaces are not always enough: a rounded edge is a quarter of a cylinder, and the
//      cylinder's inside alone cannot tell the rounded corner from the solid far from it. So each curved face adds the
//      surfaces where its extent ends -- planes through its axis at the angles it spans, planes across it where it
//      stops along the axis, a torus's cones at the tube angles it spans. Most coincide with planes already there (a
//      box's rounded edge ends on the planes of the box shrunk by the radius); the minimiser drops the ones not needed.
//   3. CELLS. Points are taken on both sides of every face, around every edge, and through the part's box, and the
//      solid (brep.js inside) says which are in it. Each point's signs against every half-space are its cell. A cell
//      that holds points both in and out means the half-spaces cannot describe the solid: it is reported (conflicts).
//   4. A COVER. The formula is a union of products, a product an intersection of half-spaces or complements, each
//      grown from a cell inside the solid by dropping every literal it can without taking in a cell outside (Espresso's
//      EXPAND: a prime implicant), the farthest surfaces first so a product stays near where it was grown.
//      NO SEAMS: where two cells inside the solid meet, some product must hold both, or the union of two products
//      that only touch would be zero inside the solid along the wall between them -- a surface nobody modelled, that a
//      ray inside glass would stop at. So every such pair of cells is an item the cover must cover too.
//   5. FACTORING. A literal common to several products is taken out of them, so it is evaluated once: a plate's
//      holes are its box less one union of cylinders, not a product per hole.
//   6. BOUNDED. Cells outside the sampled box were never seen, so the formula is intersected with that box.
//   7. CHECKED. The formula's sign against the solid at points it was not built from: mismatches is what it gets
//      wrong (and import/test/csg.test.mjs holds every fixture to OpenCascade's own classification).
//
//   toCSG(B, { seed, volume, perFace })   B: brep.js's
//     -> { halfspaces: [{ surface, from: 'face' | 'separator' }], tree, sdf(p), report }
//   tree: { op: 'or' | 'and', kids } | { op: 'lit', j, s } (s = 1: g_j < 0, the inside; -1: the complement)
//         | { op: 'box', lo, hi }
//======================================================================================================================

import { add, sub, mul, dot, len, cross, norm, TAU, frame, plane, cylinder, cone, sameSurface } from './geom.js'
export { sameSurface }
import { mulberry, outward } from './brep.js'

//----------------------------------------------------------------------------------------------------------------------
// SEPARATORS: where a curved face ends
//----------------------------------------------------------------------------------------------------------------------
/** The stretch a coordinate covers, from the values it takes: [lo, hi], or null for all of a coordinate that goes round
 *  (no gap wider than `gap` radians between neighbours). */
function extent(values, periodic, gap = 0.2) {
    if (!periodic) return [Math.min(...values), Math.max(...values)]
    const a = values.map(x => ((x % TAU) + TAU) % TAU).sort((p, q) => p - q)
    let best = TAU - a[a.length - 1] + a[0], at = a.length - 1
    for (let i = 0; i + 1 < a.length; i++) if (a[i + 1] - a[i] > best) { best = a[i + 1] - a[i]; at = i }
    if (best < gap) return null
    const lo = a[(at + 1) % a.length], hi = a[at]
    return [lo, hi < lo ? hi + TAU : hi]
}

/** The surfaces where a curved face ends: see the header, step 2. */
function separatorsOf(f, rnd) {
    const S = f.surface, out = []
    if (S.type === 'plane') return out
    const F = S.F
    /* a point on the axis -- a sphere's pole, a cone's apex, often a vertex of a corner -- has no angle of its own, and
       atan2(0, 0) would put one anywhere: a separator through the axis at 45 degrees cut the rounded box's STL into
       cells sampling missed (2026-10-21) */
    const offAxis = p => { const d = sub(p, F.o); return len(sub(d, mul(F.z, dot(d, F.z)))) > 1e-6 * (S.r ?? 1) }
    const pts = [...f.loops.flatMap(l => l.points), ...f.sample(48, rnd)]
    const uv = pts.map(p => S.uv(p)), uvU = pts.filter(offAxis).map(p => S.uv(p))
    const across = u => plane(frame(F.o, cross(F.z, add(mul(F.x, Math.cos(u)), mul(F.y, Math.sin(u))))))   // through the axis
    const atHeight = z => plane(frame(add(F.o, mul(F.z, z)), F.z))                                         // across the axis
    const U = uvU.length ? extent(uvU.map(x => x[0]), true) : null
    if (U) out.push(across(U[0]), across(U[1]))
    if (S.type === 'cylinder' || S.type === 'cone') {
        const V = extent(uv.map(x => x[1]), false)
        out.push(atHeight(V[0]), atHeight(V[1]))
    } else if (S.type === 'sphere') {
        const V = extent(uv.map(x => x[1]), false)
        if (V[0] > -Math.PI / 2 + 0.01) out.push(atHeight(S.r * Math.sin(V[0])))
        if (V[1] < Math.PI / 2 - 0.01) out.push(atHeight(S.r * Math.sin(V[1])))
    } else if (S.type === 'torus') {
        const V = extent(uv.map(x => x[1]), true)
        // the points at one tube angle: the cone through the ring circle at that angle (a plane, or the cylinder of
        // the ring's radius, where the angle is flat or upright)
        if (V) for (const v of V) {
            const c = Math.cos(v), s = Math.sin(v)
            if (Math.abs(s) < 1e-6) out.push(atHeight(0))
            else if (Math.abs(c) < 1e-6) out.push(cylinder(frame(F.o, F.z, F.x), S.R))
            else out.push(cone(frame(F.o, F.z, F.x), S.R, Math.atan(c / s)))
        }
    }
    return out
}

//----------------------------------------------------------------------------------------------------------------------
// BITS: a cell is which half-spaces' insides a point is in, one bit each
//----------------------------------------------------------------------------------------------------------------------
const words = n => Math.ceil(n / 32)
const getBit = (w, j) => (w[j >>> 5] >>> (j & 31)) & 1

//----------------------------------------------------------------------------------------------------------------------
// THE FORMULA as a tree, and its value
//----------------------------------------------------------------------------------------------------------------------
export function evaluate(node, p, H, cache = new Map()) {
    switch (node.op) {
        case 'lit': {
            let g = cache.get(node.j)
            if (g === undefined) { g = H[node.j].surface.g(p); cache.set(node.j, g) }
            return node.s > 0 ? g : -g
        }
        case 'box': {
            const q = [0, 1, 2].map(k => Math.abs(p[k] - 0.5 * (node.lo[k] + node.hi[k])) - 0.5 * (node.hi[k] - node.lo[k]))
            return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0)
        }
        case 'and': { let v = -Infinity; for (const k of node.kids) v = Math.max(v, evaluate(k, p, H, cache)); return v }
        case 'or': { let v = Infinity; for (const k of node.kids) v = Math.min(v, evaluate(k, p, H, cache)); return v }
    }
    throw new Error(`csg: no node ${node.op}`)
}
/** The literals a tree holds, counted where they appear: what a step evaluates when nothing is shared. */
export const literalCount = node => node.op === 'lit' || node.op === 'box' ? 1 : node.kids.reduce((n, k) => n + literalCount(k), 0)

/* A literal common to products is taken out of them (step 5): greedily, the one most of them share. */
const litNode = l => ({ op: 'lit', j: l.j, s: l.s })
function factor(products) {
    if (products.some(p => p.length === 0)) return { op: 'and', kids: [] }      // a product of nothing: everywhere
    if (products.length === 1) {
        const p = products[0]
        return p.length === 1 ? litNode(p[0]) : { op: 'and', kids: p.map(litNode) }
    }
    const key = l => `${l.j}:${l.s}`
    const counts = new Map()
    for (const p of products) for (const l of p) counts.set(key(l), (counts.get(key(l)) || 0) + 1)
    let best = null, bc = 1
    for (const [k, c] of counts) if (c > bc) { bc = c; best = k }
    if (!best) return { op: 'or', kids: products.map(p => factor([p])) }
    const lit = litNode(products.find(p => p.some(l => key(l) === best)).find(l => key(l) === best))
    const withL = products.filter(p => p.some(l => key(l) === best)).map(p => p.filter(l => key(l) !== best))
    const without = products.filter(p => !p.some(l => key(l) === best))
    // a product that was only the literal: the literal alone covers everything the others with it do
    const inner = withL.some(p => p.length === 0) ? lit : { op: 'and', kids: [lit, factor(withL)] }
    if (!without.length) return flatten(inner)
    return flatten({ op: 'or', kids: [inner, factor(without)] })
}
function flatten(n) {
    if (n.op !== 'and' && n.op !== 'or') return n
    const kids = []
    for (const k of n.kids.map(flatten)) { if (k.op === n.op) kids.push(...k.kids); else kids.push(k) }
    return kids.length === 1 ? kids[0] : { op: n.op, kids }
}

/* A set of literals cut down to what keeps out a set of cells: dropped one at a time, the costliest first, unless some
   cell fails that literal alone */
function prime(L, cells, cost) {
    const sat = (w, l) => getBit(w, l.j) === (l.s > 0 ? 1 : 0)
    const fails = cells.map(c => L.reduce((k, l) => k + (sat(c.w, l) ? 0 : 1), 0))
    const keep = new Set(L)
    for (const l of L.slice().sort((a, b) => cost(b) - cost(a))) {
        if (cells.some((c, k) => fails[k] === 1 && !sat(c.w, l))) continue
        keep.delete(l)
        cells.forEach((c, k) => { if (!sat(c.w, l)) fails[k]-- })
    }
    return L.filter(l => keep.has(l))
}
/* how far a surface is from a box's centre: the separators drawn far from the part go first */
const dist = (box, h) => Math.abs(h.surface.g(box.lo.map((l, k) => 0.5 * (l + box.hi[k]))))

//----------------------------------------------------------------------------------------------------------------------
// THE CONVERSION
//----------------------------------------------------------------------------------------------------------------------
/* HOW MANY FACES A SOLID MAY HAVE (2026-10-21): the cover's cost grows with the half-spaces times the cells, and a
   mesh whose curves fitted nothing -- every facet its own plane -- took 144 s for the rounded box's 2598 facets in Node,
   and would march as a formula of a thousand shapes. A CAD part of a few hundred faces is well inside it. */
export const MAX_FACES = 400

export function toCSG(B, { seed = 1, volume = 6000, perFace = 64, perEdgePoint = 2, check = 3000 } = {}) {
    if (B.faces.length > MAX_FACES)
        throw new Error(`${B.name || 'the solid'} has ${B.faces.length} faces, more than ${MAX_FACES}: ${B.fitted ? 'a mesh whose curves fit no plane, cylinder, cone, sphere or torus (a scan or a sculpt, not a CAD part) is all facets, and ' : ''}a formula that big would be slow to build and slower to march`)
    if (B.unsupported.length) {
        const kinds = [...new Set(B.unsupported.map(f => f.surface.type))].join(', ')
        throw new Error(`${B.unsupported.length} face(s) of ${B.name || 'the solid'} lie on surfaces that are not planes, cylinders, cones, spheres or tori (${kinds}): no formula of exact shapes describes it`)
    }
    const t0 = Date.now()
    const rnd = mulberry(seed)
    /* how far off a face the points go, and a band around the faces no point is taken in: a mesh's solid (fit.js) is
       its facets, which stray from the fitted surfaces by up to their sag (B.band), and there the two disagree */
    /* ...and when two surfaces are one: to a millionth of the part, or what the solid says -- a mesh's surfaces are fits,
       and two fits of one surface (or separators drawn through two of them) differ by what fitting leaves; kept apart,
       they cut thin slivers of cells that sampling misses (the rounded box's STL, 2026-10-21: a point 0.06 mm inside,
       outside the formula) */
    const scale = B.scale, tol = Math.max(1e-6 * scale, B.surfaceTol || 0), band = B.band || 0, delta = Math.max(2e-4 * scale, 3 * band)

    // 1 and 2: the half-spaces, the faces' and their separators, each surface once
    const H = []
    const addSurface = (S, from) => {
        for (let j = 0; j < H.length; j++) { const s = sameSurface(H[j].surface, S, tol, B.surfaceAngle ?? 1e-9); if (s) return { j, s } }
        H.push({ surface: S, from })
        return { j: H.length - 1, s: 1 }
    }
    const faceLit = B.faces.map(f => {
        const { j, s } = addSurface(f.surface, 'face')
        if (H[j].from !== 'face') H[j].from = 'face'
        return { j, s: f.sense ? s : -s }
    })
    for (const f of B.faces) for (const S of separatorsOf(f, rnd)) addSurface(S, 'separator')
    const n = H.length, W = words(n)

    // 3: points, classified, and their cells
    const pad = B.box.hi.map((h, k) => 0.05 * (h - B.box.lo[k]) + 4 * delta)
    const lo = B.box.lo.map((l, k) => l - pad[k]), hi = B.box.hi.map((h, k) => h + pad[k])
    const pts = []
    for (const f of B.faces) for (const q of f.sample(perFace, rnd)) {
        const nn = outward(f, q)
        pts.push(add(q, mul(nn, delta)), add(q, mul(nn, -delta)))
    }
    for (const f of B.faces) for (const L of f.loops) for (let i = 0; i < L.points.length; i += 2)
        for (let k = 0; k < perEdgePoint; k++) {
            const d = norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5])
            pts.push(add(L.points[i], mul(d, delta * (1 + 2 * rnd()))))
        }
    for (let i = 0; i < volume; i++) pts.push(lo.map((l, k) => l + (hi[k] - l) * rnd()))

    const cells = new Map()
    const signs = p => {
        const w = new Uint32Array(W)
        for (let j = 0; j < n; j++) {
            const g = H[j].surface.g(p)
            if (Math.abs(g) < tol) return null          // on a surface: no side
            if (g < 0) w[j >>> 5] |= 1 << (j & 31)
        }
        return w
    }
    const faceH = H.map((h, j) => h.from === 'face' ? j : -1).filter(j => j >= 0)
    const inBand = p => band > 0 && faceH.some(j => Math.abs(H[j].surface.g(p)) < 1.5 * band)
    let skipped = 0
    for (const p of pts) {
        const w = inBand(p) ? null : signs(p)
        if (!w) { skipped++; continue }
        const key = w.join(',')
        let c = cells.get(key)
        if (!c) cells.set(key, c = { w, in: 0, out: 0, p })
        if (B.inside(p)) c.in++; else c.out++
    }
    const all = [...cells.values()]
    const conflicts = all.filter(c => c.in && c.out)
    const IN = all.filter(c => c.in > c.out), OUT = all.filter(c => c.in <= c.out)

    // 4: the cover
    const sat = (w, l) => getBit(w, l.j) === (l.s > 0 ? 1 : 0)
    /* GLOBAL LITERALS first: the sides of surfaces every cell inside the solid is on -- the outer planes of a plate,
       the outside of each through-hole. The solid is inside all of them, so they are one factor of the whole formula,
       and the cover below only has to keep out the cells outside the solid that they do not (a pocket's) */
    let G = []
    for (let j = 0; j < n; j++) {
        if (IN.every(c => getBit(c.w, j))) G.push({ j, s: 1 })
        else if (IN.every(c => !getBit(c.w, j))) G.push({ j, s: -1 })
    }
    const OUTG = OUT.filter(c => G.every(l => sat(c.w, l)))
    // ...and of those, only the ones needed to keep out the cells outside the solid the others do not
    G = prime(G, OUT.filter(c => !G.every(l => sat(c.w, l))), l => dist(B.box, H[l.j]))
    const inG = new Set(G.map(l => l.j))
    const free = [...Array(n).keys()].filter(j => !inG.has(j))

    /* ITEMS: every cell inside, and every pair of cells inside that differ by one surface -- a wall, which a product
       must hold whole (the header, NO SEAMS) */
    const items = IN.map((c, i) => ({ w: c.w, free: -1, weight: c.in, p: c.p, _i: i }))
    const byKey = new Map(IN.map(c => [c.w.join(','), c]))
    for (const c of IN) for (const j of free) {
        if (getBit(c.w, j)) continue                   // each pair once: from the cell outside surface j
        const w2 = c.w.slice(); w2[j >>> 5] |= 1 << (j & 31)
        if (byKey.has(w2.join(','))) items.push({ w: c.w, free: j, weight: 0, p: c.p, _i: items.length })
    }
    const fails = (x, l) => l.j === x.free || !sat(x.w, l)      // a product fixing the wall's surface cannot hold both sides
    const covers = (P, x) => P.every(l => !fails(x, l))
    const products = []
    const covered = new Uint8Array(items.length)
    if (OUTG.length) {
        const order = items.map((_, i) => i).sort((a, b) => items[b].weight - items[a].weight)
        for (const i of order) {
            if (covered[i]) continue
            const it = items[i]
            /* EXPAND: from the item's own literals (the wall's surface left free), drop one at a time while no cell
               outside gets in: the one that covers most of what is not yet covered (Espresso's choice), the farthest
               surface on a tie. Per cell outside, how many of P's literals it fails: one failed alone cannot go. */
            let P = free.filter(j => j !== it.free).map(j => ({ j, s: getBit(it.w, j) ? 1 : -1 }))
            const outFails = OUTG.map(c => P.reduce((k, l) => k + (sat(c.w, l) ? 0 : 1), 0))
            const itemFails = items.map(x => covered[x._i] ? -1 : P.reduce((k, l) => k + (fails(x, l) ? 1 : 0), 0))
            for (;;) {
                let best = null, bestGain = -1, bestDist = -1
                for (const l of P) {
                    let ok = true
                    for (let k = 0; k < OUTG.length; k++) if (outFails[k] === 1 && !sat(OUTG[k].w, l)) { ok = false; break }
                    if (!ok) continue
                    let gain = 0
                    for (let k = 0; k < items.length; k++) if (itemFails[k] === 1 && fails(items[k], l)) gain += 1 + items[k].weight
                    const d = Math.abs(H[l.j].surface.g(it.p))
                    if (gain > bestGain || (gain === bestGain && d > bestDist)) { best = l; bestGain = gain; bestDist = d }
                }
                if (!best) break
                P = P.filter(l => l !== best)
                for (let k = 0; k < OUTG.length; k++) if (!sat(OUTG[k].w, best)) outFails[k]--
                for (let k = 0; k < items.length; k++) if (itemFails[k] > 0 && fails(items[k], best)) itemFails[k]--
            }
            products.push(P)
            items.forEach((x, k) => { if (!covered[k] && covers(P, x)) covered[k] = 1 })
        }
    } else products.push([])
    // IRREDUNDANT: a product whose items every other product covers goes
    const cov = products.map(P => items.map((x, k) => covers(P, x) ? k : -1).filter(k => k >= 0))
    const count = new Uint16Array(items.length)
    for (const c of cov) for (const k of c) count[k]++
    const kept = []
    for (let i = products.length - 1; i >= 0; i--) {
        if (products.length > 1 && cov[i].every(k => count[k] > 1)) { for (const k of cov[i]) count[k]--; continue }
        kept.unshift(products[i])
    }
    const uncovered = items.filter((x, k) => !count[k]).length

    // 5 and 6: factored, and bounded by the sampled box
    let tree = factor(kept)
    tree = flatten({ op: 'and', kids: [{ op: 'box', lo: B.box.lo.map((l, k) => l - 0.5 * pad[k]), hi: B.box.hi.map((h, k) => h + 0.5 * pad[k]) },
                                       ...G.map(litNode), tree] })
    // the half-spaces the formula uses, renumbered; separators it did not need are gone
    const used = new Map()
    const renumber = node => {
        if (node.op === 'lit') { if (!used.has(node.j)) used.set(node.j, used.size); return { ...node, j: used.get(node.j) } }
        if (node.op === 'box') return node
        return { ...node, kids: node.kids.map(renumber) }
    }
    tree = renumber(tree)
    const halfspaces = [...used.keys()].map(j => H[j])
    const sdf = p => evaluate(tree, p, halfspaces)

    // 7: checked at points it was not built from: through the box, and close to the faces
    let mismatches = 0, checked = 0
    const rc = mulberry(seed + 7919)
    for (let i = 0; i < check; i++) {
        let p
        if (i % 2) p = lo.map((l, k) => l + (hi[k] - l) * rc())
        else {
            const f = B.faces[Math.floor(rc() * B.faces.length)]
            const q = f.sample(1, rc)[0]
            if (!q) continue
            p = add(q, mul(outward(f, q), (rc() - 0.5) * 0.1 * scale))
        }
        if (Math.min(...halfspaces.map(h => Math.abs(h.surface.g(p)))) < tol || inBand(p)) continue
        checked++
        if ((sdf(p) < 0) !== B.inside(p)) mismatches++
    }
    const report = {
        faces: B.faces.length, halfspaces: H.length, used: halfspaces.length,
        separators: halfspaces.filter(h => h.from === 'separator').length,
        cells: all.length, conflicts: conflicts.length, global: G.length, products: kept.length, uncovered, literals: literalCount(tree),
        points: pts.length, skipped, checked, mismatches, ms: Date.now() - t0,
    }
    return { halfspaces, tree, sdf, report, faceLiterals: faceLit }
}
