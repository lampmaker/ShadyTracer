//======================================================================================================================
// Tests for the conversion of a solid into a formula over its surfaces' half-spaces (csg.js) and into the builder's
// shapes (shapes.js). Run: node import/test/csg.test.mjs
//
// Held to OpenCascade's own answers on its own parts (fixtures/make.py): at every point it classified, the formula and
// the shapes are on the same side of the surface it says; and their value is never MORE than its distance from the
// point to the solid's surface (BRepExtrema; both rounded to a micrometre in the file, which is the slack allowed), which is what lets the renderer march by it -- the formula is a lower
// bound on the distance, as every SDF it marches must be (core/shapes.js).
//   NO SEAMS: a union of two products that only touch would be zero inside the solid along the wall between them, and
// a ray inside glass would stop there (csg.js says how the cover avoids it). Such a wall shows as points deep inside
// whose value is near zero; none may be.
//   SMALL: the formula's size is what each march step costs, so each part's is held to what a hand would write, or
// near it (the plate: its box, four holes and a pocket).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { readSTEP } from '../step.js'
import { brep } from '../brep.js'
import { toCSG, evaluate, literalCount, MAX_FACES } from '../csg.js'
import { shapesOf, shapeSDF, countShapes, eulerOf } from '../shapes.js'
import { frame, cylinder, cone } from '../geom.js'
import { matrixOf } from '../../builder/transform.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const fixture = n => new URL(`./fixtures/${n}`, import.meta.url)

/* the most each part's formula may hold, and its shapes: what it holds now, the plate and the lens what a hand would
   write (the plate: box, four holes, pocket; the lens: two spheres and its edge) */
const LIMITS = { plate: { literals: 16, shapes: 6 }, bracket: { literals: 18, shapes: 9 }, boss: { literals: 15, shapes: 10 },
                 lens: { literals: 4, shapes: 3 }, roundbox: { literals: 42, shapes: 30 } }

for (const [n, lim] of Object.entries(LIMITS)) {
    const ref = JSON.parse(readFileSync(fixture(`${n}.json`), 'utf8'))
    const B = brep(readSTEP(readFileSync(fixture(`${n}.step`), 'utf8')).solids[0])
    const C = toCSG(B)
    const R = C.report
    ok(`${n}: no cell both in and out, everything covered, its own check clean`, R.conflicts === 0 && R.uncovered === 0 && R.mismatches === 0, JSON.stringify(R))
    ok(`${n}: the formula holds at most ${lim.literals} literals`, R.literals <= lim.literals, R.literals)
    let side = 0, over = 0, seam = 0, worstOver = 0
    for (const [x, y, z, c, d] of ref.points) {
        const v = C.sdf([x, y, z])
        if ((v < 0 ? 1 : 0) !== c) side++
        if (Math.abs(v) > d + 3e-6) { over++; worstOver = Math.max(worstOver, Math.abs(v) - d) }
        if (c === 1 && d > 0.1 && Math.abs(v) < 0.2 * d) seam++
    }
    ok(`${n}: the formula on OpenCascade's side at all ${ref.points.length} points`, side === 0, `${side} on the wrong side`)
    ok(`${n}: ...and never more than its distance to the surface (a bound, safe to march)`, over === 0, `${over} over, by up to ${worstOver}`)
    ok(`${n}: ...and no point deep inside near zero (no seam)`, seam === 0, `${seam} points`)

    const ir = shapesOf(C)
    const k = countShapes(ir.root)
    ok(`${n}: at most ${lim.shapes} shapes`, k.shapes <= lim.shapes, JSON.stringify(k))
    side = 0; over = 0; seam = 0; worstOver = 0
    for (const [x, y, z, c, d] of ref.points) {
        const v = shapeSDF(ir.root, [x, y, z])
        if ((v < 0 ? 1 : 0) !== c) side++
        if (Math.abs(v) > d + 3e-6) { over++; worstOver = Math.max(worstOver, Math.abs(v) - d) }
        if (c === 1 && d > 0.1 && Math.abs(v) < 0.2 * d) seam++
    }
    ok(`${n}: the shapes on OpenCascade's side at every point`, side === 0, `${side} on the wrong side`)
    ok(`${n}: ...a bound too`, over === 0, `${over} over, by up to ${worstOver}`)
    ok(`${n}: ...with no seam`, seam === 0, `${seam} points`)

    // the same every time: a seeded conversion
    ok(`${n}: the same formula a second time`, JSON.stringify(toCSG(B).tree) === JSON.stringify(C.tree))
}

/* THE PLATE, AS A HAND WOULD MODEL IT: one box, four holes subtracted, a pocket subtracted -- each its size */
{
    const B = brep(readSTEP(readFileSync(fixture('plate.step'), 'utf8')).solids[0])
    const ir = shapesOf(toCSG(B))
    const r = ir.root
    ok('the plate: one intersection of its kids', r.kind === 'and')
    const there = r.kids.filter(k => !k.neg), cut = r.kids.filter(k => k.neg)
    ok('...one box there, 40 x 30 x 5', there.length === 1 && there[0].n.kind === 'box'
        && [40, 30, 5].every((s, i) => Math.abs((there[0].n.hi[i] - there[0].n.lo[i]) - s) < 1e-6), JSON.stringify(there[0]?.n.lo))
    const holes = cut.filter(k => k.n.kind === 'cylinder')
    ok('...four holes, 4 mm across, through it', holes.length === 4 && holes.every(h => Math.abs(h.n.S.r - 2) < 1e-9 && h.n.hi - h.n.lo > 5))
    const pocket = cut.find(k => k.n.kind === 'box')
    ok('...and a pocket, 12 x 8 and 2 deep, standing out of its top', !!pocket && (() => {
        const b = pocket.n, d = [0, 1, 2].map(i => b.hi[i] - b.lo[i]).sort((a, c) => a - c)
        return d.some(v => Math.abs(v - 12) < 1e-6) && d.some(v => Math.abs(v - 8) < 1e-6)
    })(), JSON.stringify(pocket?.n.lo) + JSON.stringify(pocket?.n.hi))
}

/* THE LENS: its two spheres and its edge, nothing else -- what the optics need exactly */
{
    const B = brep(readSTEP(readFileSync(fixture('lens.step'), 'utf8')).solids[0])
    const ir = shapesOf(toCSG(B))
    const kinds = ir.root.kids.map(k => (k.neg ? '-' : '') + k.n.kind).sort()
    ok('the lens: two spheres and a capped cylinder, all there', JSON.stringify(kinds) === JSON.stringify(['cylinder', 'sphere', 'sphere']), JSON.stringify(kinds))
    const sph = ir.root.kids.filter(k => k.n.kind === 'sphere').map(k => k.n.S.r).sort((a, b) => a - b)
    ok('...radii 20 and 30, as made', Math.abs(sph[0] - 20) < 1e-9 && Math.abs(sph[1] - 30) < 1e-9, JSON.stringify(sph))
}

// A SOLID OF TOO MANY FACES is refused before any work, saying why
{
    const many = { name: 'scan', faces: Array.from({ length: MAX_FACES + 1 }, () => ({})), unsupported: [], fitted: {} }
    let msg = ''
    try { toCSG(many) } catch (e) { msg = e.message }
    ok('more faces than MAX_FACES: refused, saying a scan is all facets', /more than \d+/.test(msg) && /scan or a sculpt/.test(msg), msg)
    const bs = { name: 'freeform', faces: [{ surface: { type: 'bspline', unsupported: true }, unsupported: true }], unsupported: [{ surface: { type: 'bspline' } }] }
    try { toCSG(bs); msg = '' } catch (e) { msg = e.message }
    ok('a face on a B-spline: refused, naming it', /bspline/.test(msg), msg)
}

// THE FORMULA'S VALUE: min and max of the literals, a literal's complement its negation
{
    const H = [{ surface: { g: p => p[0] } }, { surface: { g: p => p[1] } }]
    const t = { op: 'and', kids: [{ op: 'lit', j: 0, s: 1 }, { op: 'or', kids: [{ op: 'lit', j: 1, s: -1 }, { op: 'box', lo: [0, 0, 0], hi: [1, 1, 1] }] }] }
    // at (-2, -3, 0.5): the literal x is -2; y's complement is 3; the box [0, 1]^3 is sqrt(2^2 + 3^2) away
    ok('and is max, or is min, a complement negated', Math.abs(evaluate(t, [-2, -3, 0.5], H) - Math.max(-2, Math.min(3, Math.hypot(2, 3)))) < 1e-12, evaluate(t, [-2, -3, 0.5], H))
    ok('literals counted', literalCount(t) === 3)
}

// THE BUILDER'S PLACEMENT: a frame's Euler angles give back the frame through the builder's own matrix
{
    let worst = 0
    const dirs = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [0, 1, 0], [0.3, -0.5, 0.8], [-0.7, 0.1, -0.2], [0, 0.6, -0.8]]
    for (const z of dirs) for (const x of [[1, 0, 0], [0, 1, 0], [0.2, 0.9, -0.1]]) {
        const F = frame([0, 0, 0], z, x)
        const m = matrixOf({ pos: { x: 0, y: 0, z: 0 }, rot: eulerOf(F), scale: 1 })
        const cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]]
        for (const [c, a] of [[cols[0], F.x], [cols[1], F.y], [cols[2], F.z]]) worst = Math.max(worst, ...c.map((v, i) => Math.abs(v - a[i])))
    }
    ok('eulerOf: the builder\'s matrix of the angles is the frame, upright and upside down too', worst < 1e-12, worst)
}

// A CONE CUT TO ITS NAPPE, and a cylinder to the part's box, by the shapes
{
    const S = cone(frame([0, 0, 0], [0, 0, 1]), 2, Math.atan(0.5))      // radius 2 at z = 0, widening 0.5 a unit up
    const C = { tree: { op: 'and', kids: [{ op: 'box', lo: [-10, -10, -10], hi: [10, 10, 10] }, { op: 'lit', j: 0, s: 1 }] }, halfspaces: [{ surface: S }] }
    const ir = shapesOf(C)
    const k = ir.root.kind === 'cone' ? ir.root : ir.root.kids?.find(x => x.n.kind === 'cone')?.n
    ok('a cone inside a box: capped where its nappe starts (the apex, z = -4) and at the box', k && Math.abs(k.lo + 4) < 1e-9 && Math.abs(k.hi - 10) < 1e-9, JSON.stringify(k && [k.lo, k.hi]))
    const Y = cylinder(frame([1, 2, 0], [0, 0, 1]), 1)
    const ir2 = shapesOf({ tree: { op: 'and', kids: [{ op: 'box', lo: [-5, -5, -3], hi: [5, 5, 3] }, { op: 'lit', j: 0, s: 1 }] }, halfspaces: [{ surface: Y }] })
    const c = ir2.root.kind === 'cylinder' ? ir2.root : null
    ok('a cylinder inside a box: its caps the box\'s, the box absorbed', c && Math.abs(c.lo + 3) < 1e-9 && Math.abs(c.hi - 3) < 1e-9, JSON.stringify(ir2.root.kind))
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
