//======================================================================================================================
// Tests for freeform faces (import/freeform.js, 0.83.0): a face on a B-spline or an extruded curve fitted with the
// regular surface nearest it -- exactly when it is one, within the deviation allowed and red when it is not, and the
// solid refused, saying the deviation it would need, beyond that. Run: node import/test/freeform.test.mjs
//
// What is held, no GPU, on OpenCascade's parts (fixtures/make.py):
//   - THE SURFACES EVALUATED: a B-spline of degree 1 the bilinear patch of its corners; a rational quadratic the quarter
//     circle it is, to rounding; an extruded circle a cylinder; the normal du x dv;
//   - A CLOSED B-SPLINE EDGE (a NURBS circle, one vertex at both ends) sampled whole, not as one point;
//   - THE PLATE MADE ALL NURBS (nurbsplate): every face fitted exactly -- planes and cylinders, none approximated, none
//     red -- and the part the plate's own 6 shapes, on OpenCascade's side at its points;
//   - THE TWISTED BLOCK (its four sides ruled between a square and the same square turned 3 degrees, hyperbolic
//     paraboloids): refused at 0.05 mm saying the deviation it needs, which is the fit's own; imported at that, its four
//     sides approximated, their shapes red and called fitted, the asset's red taken back by withoutRed; on OpenCascade's
//     side at every point farther from the surface than twice the deviation.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import * as M from '../../builder/model.js'
import { readSTEP } from '../step.js'
import { bsplineSurface, extrusionSurface, circle, frame } from '../geom.js'
import { fitFace, fitSolid } from '../freeform.js'
import { convert } from '../index.js'
import { withoutRed, APPROX_ID, MAX_DEVIATION } from '../asset.js'
import { nodeSDF } from './docsdf.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const fixture = n => new URL(`./fixtures/${n}`, import.meta.url)
const near = (a, b, t) => Math.abs(a - b) <= t

// THE SURFACES
{
    const S = bsplineSurface(1, 1, [[[0, 0, 0], [0, 2, 0]], [[3, 0, 1], [3, 2, 1]]], [0, 0, 1, 1], [0, 0, 1, 1])
    const p = S.at(0.25, 0.5)
    ok('a B-spline of degree 1: the bilinear patch of its corners', near(p[0], 0.75, 1e-12) && near(p[1], 1, 1e-12) && near(p[2], 0.25, 1e-12), p)
    const n = S.normal(0.5, 0.5), want = [-1 / Math.hypot(1, 3), 0, 3 / Math.hypot(1, 3)]
    ok('...its normal du x dv', n.every((x, k) => near(x, want[k], 1e-6)), n)
    // a quarter of a circle of radius 5 as a rational quadratic, extruded 4 along z: a quarter cylinder
    const w = Math.SQRT1_2, r = 5
    const Q = bsplineSurface(2, 1, [[[r, 0, 0], [r, 0, 4]], [[r, r, 0], [r, r, 4]], [[0, r, 0], [0, r, 4]]], [0, 0, 0, 1, 1, 1], [0, 0, 1, 1], [[1, 1], [w, w], [1, 1]])
    let worst = 0
    for (let i = 0; i <= 10; i++) { const q = Q.at(i / 10, 0.3); worst = Math.max(worst, Math.abs(Math.hypot(q[0], q[1]) - r)) }
    ok('a rational quadratic: the quarter circle it is, to rounding', worst < 1e-12, worst)
    const E = extrusionSurface(circle(frame([1, 2, 3], [0, 0, 1], [1, 0, 0]), 2), [0, 0, 7])
    const e = E.at(1, 0.5)
    ok('an extruded circle: its circle carried along the vector', near(Math.hypot(e[0] - 1, e[1] - 2), 2, 1e-12) && near(e[2], 3 + 3.5, 1e-12), e)
}

// THE PLATE MADE ALL NURBS
{
    const s = readSTEP(readFileSync(fixture('nurbsplate.step'), 'utf8')).solids[0]
    ok('nurbsplate: every face a B-spline, evaluable', s.faces.every(f => f.surface.type === 'bspline' && f.surface.at))
    const rims = s.faces.filter(f => f.loops.some(l => l.edges.length >= 3 && l.edges.some(e => e.points.length >= 48)))
    ok('...a closed B-spline edge (its holes\' rims) sampled whole, not as one point', rims.length >= 4 && s.faces.every(f => f.loops.every(l => l.points.length >= 3)))
    const fit = fitSolid(s, { maxDeviation: MAX_DEVIATION, exact: 5e-5 })
    const kinds = fit.solid.faces.map(f => f.surface.type)
    ok('...every face fitted exactly: 11 planes, 4 cylinders, none approximated', !fit.approximated.length && !fit.over.length && !fit.unfit.length
        && kinds.filter(k => k === 'plane').length === 11 && kinds.filter(k => k === 'cylinder').length === 4, kinds.join(' '))
    const r = convert(M, 'nurbsplate.step', readFileSync(fixture('nurbsplate.step')), { place: 'file' })
    const p = convert(M, 'plate.step', readFileSync(fixture('plate.step')), { place: 'file' })
    ok('...the part the plate\'s own shapes, nothing red', r.parts[0]?.report.shapes === p.parts[0].report.shapes && r.parts[0].report.approximated === 0
        && !r.asset.materials.some(m => m.id === APPROX_ID), JSON.stringify(r.parts[0]?.report))
    const ref = JSON.parse(readFileSync(fixture('nurbsplate.json'), 'utf8'))
    const wrong = ref.points.filter(([x, y, z, c, d]) => d > 1e-3 && (nodeSDF(r.asset.node, [x, y, z], r.asset.blocks) < 0 ? 1 : 0) !== c).length
    ok('...on OpenCascade\'s side at all its points', wrong === 0, `${wrong} of ${ref.points.length}`)
}

// THE TWISTED BLOCK
{
    const bytes = readFileSync(fixture('twisted.step'))
    const s = readSTEP(bytes.toString('latin1')).solids[0]
    const free = s.faces.filter(f => f.surface.unsupported)
    ok('twisted: four sides on B-splines, its top and bottom planes', free.length === 4 && s.faces.length === 6)
    const devs = free.map(f => fitFace(f, { exact: 3e-5 }).deviation)
    ok('...each side a tenth of a millimetre or more off any regular surface, and under a millimetre', devs.every(d => d > 0.1 && d < 1), devs.map(d => d.toFixed(4)).join(' '))
    const a = convert(M, 'twisted.step', bytes, { maxDeviation: 0.05 })
    ok('...refused at 0.05 mm, saying the deviation it would need', !a.asset && a.refused.length === 1 && a.refused[0].needs >= Math.max(...devs) - 1e-9
        && /0.05 mm allowed/.test(a.refused[0].why), JSON.stringify(a.refused))
    const b = convert(M, 'twisted.step', bytes, { maxDeviation: a.refused[0].needs, place: 'file' })
    const R = b.parts[0]?.report
    ok('...imported at that, its four sides approximated, the deviation said', b.asset && !b.refused.length && R.approximated === 4 && near(R.deviation, Math.max(...devs), 1e-6), JSON.stringify(R))
    const red = b.asset.materials.find(m => m.id === APPROX_ID)
    const shapes = []
    const walk = n => { if (n.kind === 'object') shapes.push(n); (n.children || []).forEach(walk) }
    walk(b.asset.node)
    ok('...the fitted faces\' shapes red and called fitted, the rest not', red && red.params.baseColor.r > 0.8 && red.params.baseColor.g < 0.1
        && shapes.some(n => n.material === APPROX_ID) && shapes.filter(n => n.material === APPROX_ID).every(n => n.label.startsWith('fitted '))
        && shapes.some(n => n.material !== APPROX_ID))
    const plain = withoutRed(b.asset)
    const reds = []; const w2 = n => { if (n.material === APPROX_ID) reds.push(n); (n.children || []).forEach(w2) }; w2(plain.node)
    ok('...withoutRed: no shape red, no red material', !reds.length && !plain.materials.some(m => m.id === APPROX_ID))
    const ref = JSON.parse(readFileSync(fixture('twisted.json'), 'utf8'))
    const far = ref.points.filter(([, , , , d]) => d > 2 * R.deviation)
    const wrong = far.filter(([x, y, z, c]) => (nodeSDF(b.asset.node, [x, y, z], b.asset.blocks) < 0 ? 1 : 0) !== c).length
    ok('...on OpenCascade\'s side at every point farther than twice the deviation', far.length > 1000 && wrong === 0, `${wrong} of ${far.length}`)
    const doc = M.ensureMaterial(M.createDoc()); doc.unit = 'mm'
    M.insertAsset(doc, b.asset, 'root')
    ok('...and it pastes soundly', !M.validate(doc).length, M.validate(doc).join('; '))
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
