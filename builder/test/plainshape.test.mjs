//======================================================================================================================
// One plain shape (builder/plainshape.js): which object code codegen's dear-only rule gives no bounding box. Run:
//   node builder/test/plainshape.test.mjs
//
// WHAT IT CHECKS, without a GPU: every built-in closed-form shape is recognised from its own code, its arguments as
// written; code that is anything more than that one call is not (a second statement, a moved p, a distance changed
// after, a shape with a loop -- an outline's revolve or extrude, a torus, a bent tube). These were analytic.test's
// "which code answers" cases until exact hits went (0.41.0); the rule kept the shapes and the parse it had.
//======================================================================================================================
import { plainShapeOf, PLAIN_SHAPES } from '../plainshape.js'
import { PRIMITIVES } from '../primitives.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const want = { sphere: 'Nsphere', box: 'NboxRounded', cylinder: 'Ncylinder', capsule: 'Ncapsule', lens: 'Nlens', disc: 'Ndisc', rectangle: 'Nrectangle', plane: 'Nplane',
               tube: 'Ntube', cone: 'sdCappedCone', dome: 'Ndome', reflector: 'Ndish', octahedron: 'Noctahedron', pyramid: 'Nfrustum', prism: 'Nprism', 'round cone': 'NroundCone' }
for (const [k, fn] of Object.entries(want)) {
    const a = plainShapeOf(PRIMITIVES[k].code)
    ok(`the ${k}'s own code is one plain shape, ${fn}`, a?.fn === fn, JSON.stringify(a))
}
ok('every plain shape is a built-in\'s', [...PLAIN_SHAPES].every(f => Object.values(want).includes(f)) && PLAIN_SHAPES.size === Object.keys(want).length)
ok('...its arguments as written (no spaces round punctuation), a whole expression each', JSON.stringify(plainShapeOf(PRIMITIVES.cylinder.code).args) === JSON.stringify(['height * 0.5', 'radius'])
    && JSON.stringify(plainShapeOf(PRIMITIVES.rectangle.code).args) === JSON.stringify(['VEC2(width,height)* 0.5']))
for (const k of ['torus', 'capped torus', 'link', 'bent tube', 'light guide', 'twisted bar']) ok(`the ${k} is not one`, plainShapeOf(PRIMITIVES[k].code) === null)
ok('nor an outline revolved or extruded: it walks its pieces', plainShapeOf(PRIMITIVES['fresnel lens'].code) === null
    && plainShapeOf(PRIMITIVES.revolution.code) === null && plainShapeOf(PRIMITIVES.extrusion.code) === null)
ok('comments and spacing do not matter', plainShapeOf('// a ball\nC  =  add_new( C,Nsphere(p,  0.5 /* r */), MATERIAL) ;')?.fn === 'Nsphere')
ok('a second statement does', plainShapeOf('C = add_new(C, Nsphere(p, 0.5), MATERIAL);\nC = add_new(C, Nsphere(p, 1.0), MATERIAL);') === null)
ok('a moved point does: the shape is not at p', plainShapeOf('C = add_new(C, Nsphere(p - VEC3(1.0), 0.5), MATERIAL);') === null
    && plainShapeOf('let q = p * 2.0;\nC = add_new(C, Nsphere(q, 0.5), MATERIAL);') === null)
ok('a distance changed after does', plainShapeOf('C = add_new(C, Nsphere(p, 0.5) * 0.5, MATERIAL);') === null)
ok('an empty argument does', plainShapeOf('C = add_new(C, Nsphere(p, ), MATERIAL);') === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
