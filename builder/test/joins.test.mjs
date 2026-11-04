//======================================================================================================================
// Tests for a join's shape (model version 27, 0.next): the round join a circular fillet, the chamfer its chord, in
// JavaScript (builder/joins.js, the WGSL's twin) and through the builder. Run: node builder/test/joins.test.mjs
//
// What is held, no GPU:
//   - THE ROUND, against closed forms: two planes at 60, 90 and 120 degrees between their faces, inside and outside --
//     on the arc's circle the value 0 and the normal the radius' direction, beyond the tangent lines a plane's distance,
//     everywhere the exact distance to the rounded wedge (worked out here in 2D by brute force over its boundary);
//     a plane across a cylinder (a hole's filleted rim) the torus it should be; the union and the subtraction the
//     intersection turned out; a missing normal taken as square with none given back; parallel normals the hard op;
//   - LIPSCHITZ 1 and the normal the gradient, by differences, at random points about each edge;
//   - THE CHAMFER through the round's two tangent lines, its value a plane's distance;
//   - THE BUILDER: the field (model.js setJoinShape, refused where a join is, a typo refused); a file of 26 read as 27;
//     codegen calling the round's function and the old text byte for byte without one; the scene as data's records
//     op + 4 x shape and its loop the old text without one, a shape added asking for a compile (recordsOf null); the
//     tree's row and the recipe; a box padded by a round union's radius.
//======================================================================================================================
import { roundIntersect, roundUnion, roundSubtract, chamferIntersect, joinShaped } from '../joins.js'
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { planOf, recordsOf, SHAPES, KIND, REC, HEADER } from '../scenedata.js'
import { recipeOf } from '../recipe.js'
import { smoothBulge } from '../boxes.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
let seed = 7
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t

/* A WEDGE IN 2D: the half-planes a = n1 . p - 0 <= 0 and b = n2 . p <= 0 through the origin, theta between the faces
   (the interior angle), filleted with radius r. Its exact signed distance by brute force over its boundary: the two
   rays from the tangent points outward and the arc between them. */
function wedge(theta) {
    // the faces along u1 and u2 from the origin, the solid between them; outward normals
    const u1 = [1, 0], u2 = [Math.cos(theta), Math.sin(theta)]
    const n1 = [0, -1], n2 = [-Math.sin(theta), Math.cos(theta)]
    return { u1, u2, n1, n2 }
}
function roundedWedgeDistance(W, r, p) {
    const { u1, u2, n1, n2 } = W
    const c = n1[0] * n2[0] + n1[1] * n2[1]
    // the centre: a = b = -r, solved
    const det = n1[0] * n2[1] - n1[1] * n2[0]
    const C = [(-r * n2[1] + r * n1[1]) / det, (-r * n1[0] * -1 + r * n2[0] * -1) / det * -1]
    // tangent points: the centre plus r times each outward normal
    const t1 = [C[0] + r * n1[0], C[1] + r * n1[1]], t2 = [C[0] + r * n2[0], C[1] + r * n2[1]]
    let best = Infinity
    const seg = (a, d) => {           // ray from a along d (unit), clamped to t >= 0
        const t = Math.max(0, (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1])
        best = Math.min(best, Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]))
    }
    seg(t1, u1); seg(t2, u2)
    // the arc: from n1's direction to n2's, the short way (through their sum)
    const a1 = Math.atan2(n1[1], n1[0]), a2 = Math.atan2(n2[1], n2[0])
    let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI
    for (let k = 0; k <= 4000; k++) {
        const a = a1 + da * k / 4000
        best = Math.min(best, Math.hypot(p[0] - C[0] - r * Math.cos(a), p[1] - C[1] - r * Math.sin(a)))
    }
    // inside: both sides, and beyond the centre's chord off the arc, or in the corner short of the arc
    const A = p[0] * n1[0] + p[1] * n1[1], B = p[0] * n2[0] + p[1] * n2[1]
    const w = [p[0] - C[0], p[1] - C[1]]
    const al = ((A + r) - c * (B + r)) / (1 - c * c), be = ((B + r) - c * (A + r)) / (1 - c * c)
    const inside = A < 0 && B < 0 && !(al > 0 && be > 0 && Math.hypot(...w) > r)
    return { d: inside ? -best : best, C }
}

// THE ROUND, two planes
for (const deg of [60, 90, 120]) {
    const W = wedge(deg * Math.PI / 180), r = 0.7
    let worst = 0, worstN = 0, worstL = 0
    const f = q => roundIntersect([W.n1[0], W.n1[1], 0, q[0] * W.n1[0] + q[1] * W.n1[1]], [W.n2[0], W.n2[1], 0, q[0] * W.n2[0] + q[1] * W.n2[1]], r)
    const { C } = roundedWedgeDistance(W, r, [0, 0])
    for (let i = 0; i < 400; i++) {
        const p = [C[0] + (rnd() - 0.5) * 6, C[1] + (rnd() - 0.5) * 6]
        const v = f(p), e = roundedWedgeDistance(W, r, p).d
        // inside only near the fillet (the arc or the faces near it): far inside, max(a, b) is the wedge's (no arc)
        worst = Math.max(worst, Math.abs(v[3] - e))
        // the normal against the gradient
        const h = 1e-6, gx = (f([p[0] + h, p[1]])[3] - f([p[0] - h, p[1]])[3]) / (2 * h), gy = (f([p[0], p[1] + h])[3] - f([p[0], p[1] - h])[3]) / (2 * h)
        worstL = Math.max(worstL, Math.hypot(gx, gy))
        if (Math.hypot(v[0], v[1]) > 0.5) worstN = Math.max(worstN, Math.hypot(v[0] - gx, v[1] - gy))
    }
    ok(`round, two planes ${deg} degrees apart: the exact distance to the filleted wedge, in and out`, worst < 2e-3, worst)
    ok(`...Lipschitz 1`, worstL < 1 + 1e-5, worstL)
    ok(`...its normal the gradient`, worstN < 1e-4, worstN)
    // on the circle between the tangent points: 0, the normal the radius'
    const mid = [W.n1[0] + W.n2[0], W.n1[1] + W.n2[1]], ml = Math.hypot(...mid), at = [C[0] + r * mid[0] / ml, C[1] + r * mid[1] / ml]
    const v = f(at)
    ok(`...the arc's middle on the surface, its normal along the radius`, near(v[3], 0, 1e-12) && near(v[0], mid[0] / ml, 1e-9) && near(v[1], mid[1] / ml, 1e-9), v)
}

// a plane across a cylinder's axis: a hole's rim filleted is a torus. The plate's top z = 0 (solid below), the hole's
// wall rho = R (solid outside it): its fillet the torus about the axis, ring R + r, at height -r
{
    const R = 3, r = 0.5
    let worst = 0
    for (let i = 0; i < 400; i++) {
        const p = [(rnd() - 0.5) * 10, (rnd() - 0.5) * 10, (rnd() - 0.5) * 3]
        const rho = Math.hypot(p[0], p[1])
        if (rho < 1e-3) continue
        const top = [0, 0, 1, p[2]], wall = [-p[0] / rho, -p[1] / rho, 0, R - rho]
        const v = roundIntersect(top, wall, r)[3]
        // exact: in the (rho, z) half-plane, the plate less the hole with its rim rounded is the wedge rho >= R, z <= 0
        const q = [rho - R, p[2]]
        // toward the corner from the fillet's centre (q = (r, -r)) the torus is nearest; elsewhere the face either side
        const e = q[0] < r && q[1] > -r ? Math.hypot(q[0] - r, q[1] + r) - r : Math.max(-q[0], q[1])
        worst = Math.max(worst, Math.abs(v - e))
    }
    ok('round, a plane across a cylinder: the torus of the hole\'s filleted rim', worst < 1e-9, worst)
}

// the union, the subtraction, a missing normal, parallel normals
{
    const a = [0, 1, 0, 0.3], b = [1, 0, 0, -0.2]
    const u = roundUnion(a, b, 0.5), i = roundIntersect(a.map(x => -x), b.map(x => -x), 0.5)
    ok('round union: the intersection of the insides turned out', u.every((x, k) => near(x, -i[k])))
    const s = roundSubtract(a, b, 0.5), j = roundIntersect(a, b.map(x => -x), 0.5)
    ok('...the subtraction the intersection with the cutter turned out', s.every((x, k) => near(x, j[k])))
    const m = roundIntersect([0, 0, 0, -0.1], [1, 0, 0, -0.1], 0.5)
    ok('a missing normal: taken as square, none given back', near(m[3], Math.hypot(0.4, 0.4) - 0.5) && m[0] === 0 && m[1] === 0 && m[2] === 0, m)
    const par = roundIntersect([1, 0, 0, -0.1], [1, 0, 0, -0.3], 0.5)
    ok('parallel normals: the hard op', par[3] === -0.1)
    ok('joinShaped: by op and shape', joinShaped('subtract', 'round', a, b, 0.5).every((x, k) => near(x, s[k])))
    let refused = false
    try { joinShaped('union', 'smooth', a, b, 0.5) } catch { refused = true }
    ok('...the smooth blend not its', refused)
}

// THE CHAMFER: the chord between the round's tangent lines
for (const deg of [60, 90, 120]) {
    const W = wedge(deg * Math.PI / 180), r = 0.7
    const { C } = roundedWedgeDistance(W, r, [0, 0])
    const f = q => chamferIntersect([W.n1[0], W.n1[1], 0, q[0] * W.n1[0] + q[1] * W.n1[1]], [W.n2[0], W.n2[1], 0, q[0] * W.n2[0] + q[1] * W.n2[1]], r)
    const t1 = [C[0] + r * W.n1[0], C[1] + r * W.n1[1]], t2 = [C[0] + r * W.n2[0], C[1] + r * W.n2[1]]
    ok(`chamfer ${deg} degrees: through both of the round's tangent points`, near(f(t1)[3], 0, 1e-12) && near(f(t2)[3], 0, 1e-12), [f(t1)[3], f(t2)[3]])
    const mid = [(t1[0] + t2[0]) / 2, (t1[1] + t2[1]) / 2], v = f(mid)
    const n = [W.n1[0] + W.n2[0], W.n1[1] + W.n2[1]], l = Math.hypot(...n)
    ok('...its normal the two faces\' halfway, a point off it at its distance', near(v[0], n[0] / l, 1e-12) && near(f([mid[0] + 0.3 * n[0] / l, mid[1] + 0.3 * n[1] / l])[3], 0.3, 1e-12))
}

// THE BUILDER
const docWith = shape => {
    const d = M.ensureMaterial(M.createDoc({ title: 't' }))
    M.addGroup(d, 'root', { id: 'g', blend: 0.2 })
    M.addObject(d, 'g', { id: 'a', primitive: 'box' })
    M.addObject(d, 'g', { id: 'b', primitive: 'cylinder', join: 'subtract', joinBlend: 0.1, joinShape: shape })
    return d
}
{
    const d = docWith('round')
    ok('model: the field set at creation and kept', M.find(d, 'b').node.joinShape === 'round' && !M.validate(d).length)
    M.setJoinShape(d, 'b', 'smooth')
    ok('...smooth stored as no field', !('joinShape' in M.find(d, 'b').node))
    M.setJoinShape(d, 'b', 'chamfer')
    let msg = ''
    try { M.setJoinShape(d, 'b', 'bevel') } catch (e) { msg = e.message }
    ok('...a typo refused, nothing changed', /joinShape must be one of round, chamfer/.test(msg) && M.find(d, 'b').node.joinShape === 'chamfer', msg)
    msg = ''
    try { M.setJoinShape(d, 'g', 'round') } catch (e) { msg = e.message }
    ok('...refused at the top level, as a join is', /top level/.test(msg), msg)
    const again = M.parse(M.serialize(d))
    ok('...through a save and a load', again.version === M.VERSION && M.VERSION === 27 && M.find(again, 'b').node.joinShape === 'chamfer')
    const old = JSON.parse(M.serialize(docWith(undefined))); old.version = 26
    ok('a file of 26 read as 27, nothing else changed', M.parse(JSON.stringify(old)).version === 27)
}
{
    const plain = generate(...M.generateArgs(docWith(undefined), { id: 't', title: 't' })).wgsl
    const round = generate(...M.generateArgs(docWith('round'), { id: 't', title: 't' })).wgsl
    const chamfer = generate(...M.generateArgs(docWith('chamfer'), { id: 't', title: 't' })).wgsl
    ok('codegen: a round join calls csgRoundSubtract, a chamfer csgChamferSubtract', /csgRoundSubtract\(k_g, C\.s/.test(round) && /csgChamferSubtract\(k_g, C\.s/.test(chamfer))
    ok('...and nothing else differs from the smooth join\'s text', round.replace('csgRoundSubtract', 'csgSubtract') === plain)
}
{
    const tree = d => M.toTree(d)
    const d0 = docWith(undefined), d1 = docWith('round')
    const p0 = planOf(tree(d0)), p1 = planOf(tree(d1))
    ok('as data: the plan says whether any join is shaped', p0.shaped === false && p1.shaped === true)
    const args = { materialIndex: () => 1, lightMaterial: () => 0 }
    ok('...a shaped tree against an unshaped plan: new text (null)', recordsOf(tree(d1), p0, args) === null && recordsOf(tree(d0), p1, args) === null)
    ok('...SHAPES: smooth 0, round 1, chamfer 2', SHAPES.smooth === 0 && SHAPES.round === 1 && SHAPES.chamfer === 2)
    const g0 = generate(...M.generateArgs(d0, { id: 't', data: true })), g1 = generate(...M.generateArgs(d1, { id: 't', data: true }))
    ok('...the loop calls the round\'s and the chamfer\'s functions only when shaped', !/csgRound|csgChamfer/.test(g0.wgsl)
        && /csgRoundUnion\(top\.k, b/.test(g1.wgsl) && /csgChamferIntersect\(top\.k, b/.test(g1.wgsl))
    // the join's record: op + 4 x shape in its second word (head(j, KIND.JOIN, op, ...))
    const r1 = recordsOf(tree(d1), p1, args), r0 = recordsOf(tree(d0), p0, args)
    // each JOIN record's op word (scenedata.js: records of REC vec4s after HEADER, the kind and op as u32 bits)
    const U = data => new Uint32Array(data.buffer)
    const joinOps = res => { const w = U(res.data), o = []; for (let i = 0; i < res.records; i++) { const at = 4 * (HEADER + REC * i); if (w[at] === KIND.JOIN) o.push(w[at + 1]) } return o }
    ok('...each join\'s record its op + 4 x its shape: the subtraction rounded 1 + 4', JSON.stringify(joinOps(r1)) === JSON.stringify([0, 1 + 4]) && JSON.stringify(joinOps(r0)) === JSON.stringify([0, 1]),
        JSON.stringify([joinOps(r1), joinOps(r0)]))
}
{
    const d = docWith('round')
    const g = M.find(d, 'g').node
    ok('the recipe: the round and its radius at the line\'s end', /subtract b {2}round 0\.1/.test(recipeOf(g)), recipeOf(g))
    const u = docWith(undefined)
    M.setJoin(u, 'b', 'union'); M.setJoinShape(u, 'b', 'round')
    const bulgeRound = smoothBulge(M.find(u, 'g').node)
    M.setJoinShape(u, 'b', 'smooth')
    ok('a box padded by a round union\'s radius, a smooth one\'s quarter', near(bulgeRound, 0.1) && near(smoothBulge(M.find(u, 'g').node), 0.025), [bulgeRound])
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
