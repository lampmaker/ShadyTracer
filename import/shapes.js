//======================================================================================================================
// SHAPES -- csg.js's formula as the builder's own shapes: boxes, cylinders, cones, spheres, tori and rounded prisms, in
// groups whose children join by union, intersect and subtract, added to a scene document (builder/model.js).
//
// WHAT IS RECOGNISED, AND WHY IT IS SAFE. The formula's literals are infinite half-spaces; a builder shape is bounded,
// because a bounded shape is what can be seen, selected and moved, and what a box can be measured around. Two facts
// make every literal a bounded shape without changing the solid:
//   - THE WHOLE FORMULA IS INSIDE ITS BOX (csg.js step 6: intersected with the box it was sampled in), so any shape in
//     it may be cut to that box: inside the box nothing changes, and outside it nothing is left anyway. An infinite
//     cylinder becomes one as long as the box along its axis; a plane becomes a box with one face on the plane.
//   - INTERSECTION IS ASSOCIATIVE, so planes that bound the same group become one box -- the plate's six faces are one
//     box, a pocket's five sides a box standing out of the top -- and a cylinder intersected with the two planes across
//     its axis is a capped cylinder. A shape that is SUBTRACTED takes nothing from its group's planes: X - (C n P) is not
//     (X n P) - C.
// A plane's two sides are both planes, so a plane can join on either side; a cylinder's outside is not a cylinder, so a
// hole is a cylinder subtracted. An `or` of complements is the complement of an `and` (De Morgan): a union of the
// outsides of a pocket's faces is the pocket, subtracted.
//
// THE SHAPES ARE THE BUILDER'S PRESETS (builder/primitives.js), so each shares the preset's block -- box, cylinder,
// sphere, torus -- and has its analytic normal. The cone is the one written here: the preset's sdCappedCone has none
// (a normal by differences costs three more evaluations of the whole scene a hit, primitives.js), and an imported
// chamfer is a cone. Lengths go into the scene's unit; the part's group sits at the middle of its box, its shapes
// placed relative to it, so moving the group moves the part.
//
//   const ir = shapesOf(csg)                       // csg: csg.js toCSG's
//   addPart(doc, parentId, ir, { unit, label, material })   -> the part's group node
//======================================================================================================================

import { add, sub, mul, dot, frame, toLocal } from './geom.js'

const MM = { m: 1000, cm: 10, mm: 1 }

//----------------------------------------------------------------------------------------------------------------------
// LITERALS AS SHAPES, and the formula in a form whose groups each start with a shape that is there (positive)
//----------------------------------------------------------------------------------------------------------------------
/* one literal: a plane faced the way its inside is (always positive), any other surface positive or a complement */
function literal(h, s) {
    const S = h.surface
    if (S.type === 'plane') return { n: { kind: 'plane', o: S.F.o, normal: s > 0 ? S.F.z : mul(S.F.z, -1) }, neg: false }
    return { n: { kind: S.type, S }, neg: s < 0 }
}
const flip = k => k.n.kind === 'plane' ? { n: { ...k.n, normal: mul(k.n.normal, -1) }, neg: false } : { n: k.n, neg: !k.neg }

function normal(node, H) {
    if (node.op === 'lit') return literal(H[node.j], node.s)
    if (node.op === 'box') return { n: { kind: 'box', F: frame([0, 0, 0], [0, 0, 1], [1, 0, 0]), lo: node.lo, hi: node.hi }, neg: false }
    const kids = node.kids.map(k => normal(k, H))
    if (node.op === 'and') {
        // a plane joins on whichever side is wanted: a subtracted plane is the other plane intersected
        const ks = kids.map(k => k.n.kind === 'plane' && k.neg ? flip(k) : k)
        if (ks.some(k => !k.neg)) return { n: { kind: 'and', kids: ks }, neg: false }
        return { n: { kind: 'or', kids: ks.map(k => ({ n: k.n, neg: false })) }, neg: true }
    }
    // or: kept a union when every shape but planes is there; else the complement of an and (De Morgan)
    const solid = kids.filter(k => k.n.kind !== 'plane')
    if (solid.length && solid.every(k => !k.neg)) return { n: { kind: 'or', kids: kids.map(k => k.n.kind === 'plane' ? { n: k.n, neg: false } : k) }, neg: false }
    return { n: { kind: 'and', kids: kids.map(k => k.n.kind === 'plane' ? flip(k.neg ? flip(k) : k) : { n: k.n, neg: !k.neg }) }, neg: true }
}

/* a group of the same kind inside one is its kids: and(a, and(b, c)) is and(a, b, c), and(a, not or(b, c)) is
   and(a, not b, not c); or(a, or(b, c)) is or(a, b, c) */
function flatten(g) {
    if (g.kind !== 'and' && g.kind !== 'or') return g
    const kids = []
    for (const k of g.kids) {
        const n = flatten(k.n)
        if (n.kind === g.kind && !k.neg) kids.push(...n.kids)
        else if (g.kind === 'and' && n.kind === 'or' && k.neg) kids.push(...n.kids.map(x => ({ n: x.n, neg: !x.neg })))
        else kids.push({ n, neg: k.neg })
    }
    return { ...g, kids: kids.map(k => k.n.kind === 'plane' && k.neg ? flip(k) : k) }
}

//----------------------------------------------------------------------------------------------------------------------
// BOUNDED: planes into boxes, caps into cylinders, everything else cut to the part's box
//----------------------------------------------------------------------------------------------------------------------
const corners = (lo, hi) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]])
/** The part's box seen along a direction from a point: [lo, hi] of where its corners are. */
function span(box, o, d) {
    const t = corners(box.lo, box.hi).map(c => dot(sub(c, o), d))
    return [Math.min(...t), Math.max(...t)]
}
const aligned = (a, b) => Math.abs(dot(a, b)) > 1 - 1e-9

/* an oriented box: a frame and, along each of its axes, [lo, hi] -- the part's box where no plane bounds it, and one
   CUT AWAY further than it (cap says why: the plate's pocket, capped at the part's box 0.15 mm over the plate's top,
   left values of 0.07 across its opening where its walls were millimetres away) */
function boxFrom(F, planes, box, cut = false) {
    const axes = [F.x, F.y, F.z]
    const more = cut ? beyond(box) : 0
    const lim = axes.map(a => { const [l, h] = span(box, F.o, a); return [l - more, h + more] })
    for (const p of planes) {
        const k = axes.findIndex(a => aligned(a, p.normal)), s = Math.sign(dot(axes[k], p.normal)), at = dot(sub(p.o, F.o), axes[k])
        if (s > 0) lim[k][1] = Math.min(lim[k][1], at); else lim[k][0] = Math.max(lim[k][0], at)
    }
    return { kind: 'box', F, lo: lim.map(l => l[0]), hi: lim.map(l => l[1]) }
}

function bounded(g, box, cut = false) {
    if (g.kind === 'and') {
        let kids = g.kids.map(k => ({ n: bounded(k.n, box, cut || k.neg), neg: k.neg }))
        // planes, and the part's own box, into oriented boxes: the first plane's normal and one across it make a frame
        let planes = kids.filter(k => k.n.kind === 'plane').map(k => k.n)
        const boxes = kids.filter(k => k.n.kind === 'box' && !k.neg).map(k => k.n)
        kids = kids.filter(k => k.n.kind !== 'plane' && !(k.n.kind === 'box' && !k.neg))
        const made = []
        for (const b of boxes) {
            const axes = [b.F.x, b.F.y, b.F.z]
            const mine = planes.filter(p => axes.some(a => aligned(a, p.normal)))
            planes = planes.filter(p => !mine.includes(p))
            const nb = boxFrom(b.F, mine, { lo: b.lo, hi: b.hi })
            // the part's box is axis-aligned in its own frame; a plane box tightens it
            made.push(nb)
        }
        while (planes.length) {
            const z = planes[0].normal
            const across = planes.find(p => Math.abs(dot(p.normal, z)) < 1e-9)
            const F = frame(planes[0].o, z, across ? across.normal : null)
            const mine = planes.filter(p => [F.x, F.y, F.z].some(a => aligned(a, p.normal)))
            planes = planes.filter(p => !mine.includes(p))
            made.push(boxFrom(F, mine, box, cut))
        }
        // a box that bounds a cylinder's (or cone's) axis only, wide enough across it: the cylinder's caps
        for (const k of kids) {
            if (k.neg || !ALONG.has(k.n.kind) || k.n.lo !== undefined) continue
            const S = k.n.S
            const b = made.find(b => aligned(b.F.z, S.F.z) && holdsAcross(b, S, box))
                ?? made.find(b => [b.F.x, b.F.y, b.F.z].some(a => aligned(a, S.F.z)) && holdsAcross(reaxis(b, S.F.z), S, box))
            if (!b) continue
            const bb = aligned(b.F.z, S.F.z) ? b : reaxis(b, S.F.z)
            const along = [dot(sub(bb.F.o, S.F.o), S.F.z) + bb.lo[2] * Math.sign(dot(bb.F.z, S.F.z)),
                           dot(sub(bb.F.o, S.F.o), S.F.z) + bb.hi[2] * Math.sign(dot(bb.F.z, S.F.z))].sort((a, c) => a - c)
            k.n = nappe({ ...k.n, lo: along[0], hi: along[1] })
            made.splice(made.indexOf(b), 1)
        }
        kids = [...made.map(n => ({ n, neg: false })), ...kids]
        // a box another bounded shape lies inside adds nothing
        kids = kids.filter(k => !(k.n.kind === 'box' && !k.neg && kids.some(o => o !== k && !o.neg && o.n.kind !== 'box' && inside(o.n, k.n))))
        return { kind: 'and', kids: kids.map(k => ({ ...k, n: cap(k.n, box, cut || k.neg) })) }
    }
    if (g.kind === 'or') return { kind: 'or', kids: g.kids.map(k => ({ n: cap(bounded(k.n, box, cut || k.neg), box, cut || k.neg), neg: k.neg })) }
    return g
}
/* a box with its axes turned so that z is along d (one of its axes) */
function reaxis(b, d) {
    const axes = [b.F.x, b.F.y, b.F.z], k = axes.findIndex(a => aligned(a, d))
    if (k === 2) return b
    const order = k === 0 ? [1, 2, 0] : [2, 0, 1]
    const F = { o: b.F.o, x: axes[order[0]], y: axes[order[1]], z: axes[order[2]] }
    return { kind: 'box', F, lo: order.map(i => b.lo[i]), hi: order.map(i => b.hi[i]) }
}
/* is a box's cross-section, across its z, wider than the cylinder's (or cone's) whole circle within the part's box, or
   than a rounded rectangle's outline? */
function holdsAcross(b, S, box) {
    if (S.type === 'rrect') return [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([u, v]) => {
        const q = toLocal(b.F, add(S.F.o, add(mul(S.F.x, u * S.hx), mul(S.F.y, v * S.hy))))
        return q[0] >= b.lo[0] - 1e-9 && q[0] <= b.hi[0] + 1e-9 && q[1] >= b.lo[1] - 1e-9 && q[1] <= b.hi[1] + 1e-9
    })
    const r = S.type === 'cylinder' ? S.r : Math.max(...corners(box.lo, box.hi).map(c => Math.abs(S.radiusAt(dot(sub(c, S.F.o), S.F.z)))))
    const c = toLocal(b.F, S.F.o)
    return c[0] - r >= b.lo[0] - 1e-9 && c[0] + r <= b.hi[0] + 1e-9 && c[1] - r >= b.lo[1] - 1e-9 && c[1] + r <= b.hi[1] + 1e-9
}
/* is a shape (with its extent along its axis) inside a box? only what is known for sure */
function inside(n, b) {
    if (n.kind === 'sphere') return insideBox(b, n.S.F.o, n.S.r)
    if (n.kind === 'torus') return insideBox(b, n.S.F.o, n.S.R + n.S.r)
    if ((n.kind === 'cylinder' || n.kind === 'cone') && n.lo !== undefined) {
        const r = n.kind === 'cylinder' ? n.S.r : Math.max(Math.abs(n.S.radiusAt(n.lo)), Math.abs(n.S.radiusAt(n.hi)))
        return [n.lo, n.hi].every(t => insideBox(b, add(n.S.F.o, mul(n.S.F.z, t)), r))
    }
    if (n.kind === 'box') return corners(n.lo, n.hi).every(c => insideBox(b, add(add(add(n.F.o, mul(n.F.x, c[0])), mul(n.F.y, c[1])), mul(n.F.z, c[2])), 0))
    if (n.kind === 'rrect' && n.lo !== undefined) return [n.lo, n.hi].every(t => [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([u, v]) =>
        insideBox(b, add(n.S.F.o, add(mul(n.S.F.z, t), add(mul(n.S.F.x, u * n.S.hx), mul(n.S.F.y, v * n.S.hy)))), 0)))
    return false
}
const insideBox = (b, p, r) => { const q = toLocal(b.F, p); return [0, 1, 2].every(k => q[k] - r >= b.lo[k] - 1e-9 && q[k] + r <= b.hi[k] + 1e-9) }
/* a cone's own nappe: its radius is never negative, so a cone stops at its apex */
function nappe(n) {
    if (n.kind !== 'cone') return n
    const k = Math.tan(n.S.semi), apex = -n.S.r / k
    return { ...n, lo: k > 0 ? Math.max(n.lo, apex) : n.lo, hi: k < 0 ? Math.min(n.hi, apex) : n.hi }
}
/* an infinite cylinder, cone or rounded rectangle's prism, cut to the part's box along its axis -- and one CUT AWAY
   reaching a quarter of the box's size further: across an opening, a shape less another whose cap is in the same
   place is worth only the distance to that cap, and nothing at the cap but what else holds it off. The user's Onshape
   part had its Ø56 cylinder less its pocket, both capped at the part's box 0.76 mm under it (2026-10-21): under the
   opening the value fell to 0.38 where the pocket's walls were 2 to 20 away (its own box term kept it off zero) */
function cap(n, box, cut = false) {
    if (ALONG.has(n.kind) && n.lo === undefined) {
        let [lo, hi] = span(box, n.S.F.o, n.S.F.z)
        if (cut) { lo -= beyond(box); hi += beyond(box) }
        return nappe({ ...n, lo, hi })
    }
    if (n.kind === 'plane') return boxFrom(frame(n.o, n.normal, null), [n], box, cut)
    return n
}
/* how much further than the part's box a shape cut away reaches: a quarter of its size, so a cap shared with what it
   cuts is that far outside everything there is */
const beyond = box => 0.25 * Math.hypot(...box.hi.map((h, k) => h - box.lo[k]))

/** The formula as shapes, bounded and grouped: { kind: 'and' | 'or', kids: [{ n, neg }] } or one shape. */
export function shapesOf(csg) {
    const boxNode = csg.tree.op === 'and' ? csg.tree.kids.find(k => k.op === 'box') : csg.tree.op === 'box' ? csg.tree : null
    const box = boxNode ? { lo: boxNode.lo, hi: boxNode.hi } : null
    let { n, neg } = normal(csg.tree, csg.halfspaces)
    if (neg) n = { kind: 'and', kids: [{ n: { kind: 'box', F: frame([0, 0, 0], [0, 0, 1], [1, 0, 0]), lo: box.lo, hi: box.hi }, neg: false }, { n, neg: true }] }
    n = flatten(n)
    n = bounded(n, box)
    n = simplify(n)
    return { root: n, box }
}
/* a group of one shape that is there is that shape */
function simplify(g) {
    if (g.kind !== 'and' && g.kind !== 'or') return g
    const kids = g.kids.map(k => ({ n: simplify(k.n), neg: k.neg }))
    if (kids.length === 1 && !kids[0].neg) return kids[0].n
    return { ...g, kids }
}

/** Shapes and groups in it, counted: what a step evaluates. */
export function countShapes(n) {
    if (n.kind === 'and' || n.kind === 'or') return n.kids.reduce((a, k) => { const c = countShapes(k.n); return { shapes: a.shapes + c.shapes, groups: a.groups + c.groups } }, { shapes: 0, groups: 1 })
    return { shapes: 1, groups: 0 }
}

/** The SDF of the shapes, in mm, as the builder's code will compute it -- to hold the conversion to the solid. */
export function shapeSDF(n, p) {
    switch (n.kind) {
        case 'and': { let v = -Infinity; for (const k of n.kids) v = Math.max(v, k.neg ? -shapeSDF(k.n, p) : shapeSDF(k.n, p)); return v }
        case 'or': { let v = Infinity; for (const k of n.kids) v = Math.min(v, k.neg ? -shapeSDF(k.n, p) : shapeSDF(k.n, p)); return v }
        case 'box': {
            const q = toLocal(n.F, p).map((x, k) => Math.abs(x - 0.5 * (n.lo[k] + n.hi[k])) - 0.5 * (n.hi[k] - n.lo[k]))
            return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0)
        }
        case 'cylinder': case 'cone': {
            const g = n.S.g(p), z = dot(sub(p, n.S.F.o), n.S.F.z)
            const capd = n.lo === undefined ? -Infinity : Math.max(n.lo - z, z - n.hi)
            // the builder's capped cylinder is exact; max of side and caps is the bound the cone's code computes
            if (n.kind === 'cylinder' && n.lo !== undefined) { const a = Math.max(g, 0), b = Math.max(capd, 0); return Math.min(Math.max(g, capd), 0) + Math.hypot(a, b) }
            return Math.max(g, capd)
        }
        case 'rrect': {
            // exact, as RRECT_CODE: the outline's distance extruded between the caps
            const g = n.S.g(p), z = dot(sub(p, n.S.F.o), n.S.F.z), capd = Math.max(n.lo - z, z - n.hi)
            return Math.min(Math.max(g, capd), 0) + Math.hypot(Math.max(g, 0), Math.max(capd, 0))
        }
        case 'sphere': case 'torus': return n.S.g(p)
        case 'plane': return dot(sub(p, n.o), n.normal)
    }
    throw new Error(`shapes: no ${n.kind}`)
}

//----------------------------------------------------------------------------------------------------------------------
// INTO THE DOCUMENT
//----------------------------------------------------------------------------------------------------------------------
/* the shapes along an axis: a literal of these is endless along it until a box's caps or the part's box cut it */
const ALONG = new Set(['cylinder', 'cone', 'rrect'])

/* A ROUNDED RECTANGLE'S PRISM (csg.js roundedRects): no preset is one -- the box rounds all twelve edges, and an
   extrusion walks its outline's eight pieces a step -- so it is written here, exact and with its normal: the outline's
   distance (a 2D box less the radius) extruded by g2Extrude (core/shapes.js), as `extrude` does its outline's */
export const RRECT_CODE = [
    '// A rectangle with its corners rounded, extruded along z, centred: size its half sizes across x and y (the',
    '// rounding inside them), radius its corners\', height in all (imported: import/shapes.js). Exact, with its normal.',
    'let rq = abs(p.xy) - (size - VEC2(radius));',
    'let rside = length(max(rq, VEC2(0.0))) + min(max(rq.x, rq.y), 0.0) - radius;',
    'let rs = select(VEC2(-1.0), VEC2(1.0), p.xy >= VEC2(0.0));',
    'var rn = VEC2(0.0, rs.y);',
    'if (rq.x > 0.0 && rq.y > 0.0) { rn = normalize(rq) * rs; } else if (rq.x > rq.y) { rn = VEC2(rs.x, 0.0); }',
    'C = add_new(C, g2Extrude(p, VEC3(rn, rside), 0.5 * height), MATERIAL);',
].join('\n')

/* the cone: the preset's has no normal (primitives.js); this one's is the side's or the cap's, whichever is farther,
   which is the gradient of the max it returns */
export const CONE_CODE = [
    '// A cone\'s side between z = -height/2 and +height/2: radius base at the bottom, top at the top (imported:',
    '// import/shapes.js). The max of the side and the caps, a bound with its analytic normal.',
    'let k = (top - base) / height;',
    'let c = inverseSqrt(1.0 + k * k);',
    'let rho = length(p.xy);',
    'let side = (rho - (0.5 * (base + top) + k * p.z)) * c;',
    'let caps = abs(p.z) - 0.5 * height;',
    'let radial = select(VEC2(1.0, 0.0), p.xy / rho, rho > 1e-12);',
    'var f = VEC4(VEC3(radial * c, -k * c), side);',
    'if (caps > side) { f = VEC4(0.0, 0.0, sign(p.z), caps); }',
    'C = add_new(C, f, MATERIAL);',
].join('\n')

/* Euler angles in degrees, the builder's order (builder/transform.js: R = Rz Ry Rx), for a frame's axes as columns */
export function eulerOf(F) {
    const R = [[F.x[0], F.y[0], F.z[0]], [F.x[1], F.y[1], F.z[1]], [F.x[2], F.y[2], F.z[2]]]
    const deg = 180 / Math.PI
    const sy = -R[2][0]
    if (Math.abs(sy) < 1 - 1e-9) {
        return { x: Math.atan2(R[2][1], R[2][2]) * deg, y: Math.asin(sy) * deg, z: Math.atan2(R[1][0], R[0][0]) * deg }
    }
    return { x: 0, y: Math.sign(sy) * 90, z: Math.atan2(-R[0][1], R[1][1]) * deg }
}
const round = (x, d = 1e6) => Math.round(x * d) / d
const vec = v => ({ x: round(v[0]), y: round(v[1]), z: round(v[2]) })
const fmt = x => +x.toPrecision(4)

/** What a shape becomes: { primitive | code, label, params, transform } with lengths in the scene's unit. */
function nodeOf(n, neg, at, s) {
    const place = (o, F) => ({ pos: vec(mul(sub(o, at), s)), rot: F ? (r => ({ x: round(r.x), y: round(r.y), z: round(r.z) }))(eulerOf(F)) : { x: 0, y: 0, z: 0 }, scale: 1 })
    switch (n.kind) {
        case 'box': {
            const c = [0, 1, 2].map(k => 0.5 * (n.lo[k] + n.hi[k])), h = [0, 1, 2].map(k => 0.5 * (n.hi[k] - n.lo[k]))
            const o = add(add(add(n.F.o, mul(n.F.x, c[0])), mul(n.F.y, c[1])), mul(n.F.z, c[2]))
            return { primitive: 'box', label: neg ? 'cut' : 'box', params: { size: vec(mul(h, s)), rounding: 0 }, transform: place(o, n.F) }
        }
        case 'cylinder': {
            const o = add(n.S.F.o, mul(n.S.F.z, 0.5 * (n.lo + n.hi)))
            return { primitive: 'cylinder', label: `${neg ? 'hole' : 'cylinder'} ⌀${fmt(2 * n.S.r)}`,
                     params: { radius: round(n.S.r * s), height: round((n.hi - n.lo) * s) }, transform: place(o, n.S.F) }
        }
        case 'cone': {
            const o = add(n.S.F.o, mul(n.S.F.z, 0.5 * (n.lo + n.hi)))
            return { code: CONE_CODE, label: neg ? 'cone cut' : 'cone',
                     params: { base: round(Math.max(0, n.S.radiusAt(n.lo)) * s), top: round(Math.max(0, n.S.radiusAt(n.hi)) * s), height: round((n.hi - n.lo) * s) },
                     transform: place(o, n.S.F) }
        }
        case 'rrect': {
            const o = add(n.S.F.o, mul(n.S.F.z, 0.5 * (n.lo + n.hi)))
            return { code: RRECT_CODE, label: `${neg ? 'pocket' : 'rounded rectangle'} ${fmt(2 * n.S.hx)} x ${fmt(2 * n.S.hy)}`,
                     params: { size: { x: round(n.S.hx * s), y: round(n.S.hy * s) }, radius: round(n.S.r * s), height: round((n.hi - n.lo) * s) },
                     transform: place(o, n.S.F) }
        }
        case 'sphere':
            return { primitive: 'sphere', label: `${neg ? 'sphere cut' : 'sphere'} R${fmt(n.S.r)}`, params: { radius: round(n.S.r * s) }, transform: place(n.S.F.o, null) }
        case 'torus':
            return { primitive: 'torus', label: neg ? 'torus cut' : 'torus', params: { ring: round(n.S.R * s), tube: round(n.S.r * s) }, transform: place(n.S.F.o, n.S.F) }
    }
    throw new Error(`shapes: cannot place a ${n.kind}`)
}

/**
 * The part into a scene document, as a group under `parentId`.
 * @param model  builder/model.js (passed, so this module stays free of the builder: import/ is pure)
 * @param unit   the scene's unit, 'm' | 'cm' | 'mm'; the shapes are in mm
 * @returns the part's group
 */
export function addPart(model, doc, parentId, ir, { unit = 'mm', label = 'part', material = null, index } = {}) {
    const s = 1 / (MM[unit] ?? 1)
    const at = ir.box.lo.map((l, k) => round(0.5 * (l + ir.box.hi[k]), 1e3))
    const top = model.addGroup(doc, parentId, { label, transform: { pos: vec(mul(at, s)), rot: { x: 0, y: 0, z: 0 }, scale: 1 } }, index)
    const object = (n, neg, parent, join, name) => {
        const o = nodeOf(n, neg, at, s)
        return model.addObject(doc, parent, { ...o, label: name ?? o.label, material, join })
    }
    const bySize = (a, b) => size(b.n) - size(a.n)
    /* EVERY GROUP ONE SHAPE. A group whose children all join by union is a plain group to codegen (isCsg): its children
       fold into the scene one by one, each surface kept, the nearest boundary either way (scene_api.js fold). That is
       right for separate objects and no union's distance: in one of two boxes and just outside the other it reads the
       other's, outside. As a shape of a group that intersects or subtracts, it cut holes in the parts -- the rounded
       box's core intersected with its prisms, marched on Dawn, ran through its own edges, and the bracket, the boss and
       the cup had it too (import.gpu.mjs, 2026-10-21) -- and as a part's own group it left its shapes' inner faces in
       the solid, the seams the formula keeps out (csg.js). So a group here is always one fold of csg ops, which
       codegen combines into one shape (children(): k_<id>), at blend 0 an exact min and max. (Since 0.next codegen
       combines a plain group that is a CSG group's shape too, as a union -- combinedGroups -- but a part's own group is
       not one unless it is pasted into a CSG group, and outside one a plain group still folds, so the rule stands.)
         - a union in an intersection is where the fold starts, its shapes joined by union: (A or B) and C is
           [A, B union, C intersect];
         - a union cut away is cut shape by shape: C less (A or B) is [C, A subtract, B subtract];
         - a union that is neither -- a part's own group, a second one in an intersection -- is closed with the part's
           box intersected: everything is in it, so no point changes, and the group combines. One box test a step. */
    const child = (n, neg, parent, join) => {
        if (n.kind !== 'and' && n.kind !== 'or') return object(n, neg, parent, join)
        const g = model.addGroup(doc, parent, { label: n.kind === 'and' ? 'intersection' : 'union', join })
        fill(n, g.id)
        return g
    }
    const fill = (n, gid) => {
        let count = 0, combines = false
        const add = (m, neg, join) => {
            child(m, neg, gid, count ? join : undefined)
            if (count && join !== 'union') combines = true
            count++
        }
        if (n.kind === 'or') for (const k of n.kids.slice().sort(bySize)) add(k.n, false, 'union')
        else {
            // the base first: the largest shape that is there (its material is the group's), then the rest, then the cuts
            const pos = n.kids.filter(k => !k.neg).sort(bySize), cuts = n.kids.filter(k => k.neg).sort(bySize)
            const start = pos.find(k => k.n.kind === 'or')
            if (start) for (const k of start.n.kids.slice().sort(bySize)) add(k.n, false, 'union')
            for (const k of pos) if (k !== start) add(k.n, false, 'intersect')
            for (const k of cuts) {
                if (k.n.kind === 'or') for (const m of k.n.kids.slice().sort(bySize)) add(m.n, true, 'subtract')
                else add(k.n, true, 'subtract')
            }
        }
        if (count > 1 && !combines) object({ kind: 'box', F: frame([0, 0, 0], [0, 0, 1], [1, 0, 0]), lo: ir.box.lo, hi: ir.box.hi }, false, gid, 'intersect', 'the part\'s box')
    }
    if (ir.root.kind === 'and' || ir.root.kind === 'or') fill(ir.root, top.id)
    else object(ir.root, false, top.id)
    return top
}
/* how big a shape is, for choosing a group's base (its material is the group's): a box's or a cylinder's volume */
function size(n) {
    if (n.kind === 'box') return (n.hi[0] - n.lo[0]) * (n.hi[1] - n.lo[1]) * (n.hi[2] - n.lo[2])
    if (n.kind === 'cylinder') return Math.PI * n.S.r ** 2 * ((n.hi ?? 1) - (n.lo ?? 0))
    if (n.kind === 'cone') return Math.PI * Math.max(n.S.radiusAt(n.lo ?? 0) ** 2, n.S.radiusAt(n.hi ?? 0) ** 2) * ((n.hi ?? 1) - (n.lo ?? 0))
    if (n.kind === 'rrect') return 4 * n.S.hx * n.S.hy * ((n.hi ?? 1) - (n.lo ?? 0))
    if (n.kind === 'sphere') return 4 / 3 * Math.PI * n.S.r ** 3
    if (n.kind === 'torus') return 2 * Math.PI ** 2 * n.S.R * n.S.r ** 2
    if (n.kind === 'and') return Math.min(...n.kids.filter(k => !k.neg).map(k => size(k.n)))
    if (n.kind === 'or') return n.kids.reduce((a, k) => a + size(k.n), 0)
    return 0
}

export { MM }
