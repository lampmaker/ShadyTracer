//======================================================================================================================
// Tests for a shape stretched by its own sizes (builder/stretch.js, the Transform gizmo's cubes): which shapes and
// which of their axes, found by their code being a preset's; what a stretch writes -- the axis's own parameters only,
// a vector's other components kept, within the sliders' ranges, never through zero -- and every preset's map naming
// parameters it has. What it looks like is the user's to judge. Run: node builder/test/stretch.test.mjs
//======================================================================================================================
import * as M from '../model.js'
import { PRIMITIVES, primitiveObject } from '../primitives.js'
import { stretchOf, stretched, startOf, refKey, MIN_SIZE } from '../stretch.js'
import { stretchFactor } from '../gizmo.js'
import { exportProblems } from '../exportbox.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

const d = M.createDoc({ title: 'stretch' })
const add = (key, extra = {}) => M.addObject(d, 'root', { ...primitiveObject(key), ...extra })
// a node as the tools read it: with its block's code and schema (model.js viewOf, version 16)
const node = n => M.viewOf(d, M.find(d, n.id).node)
const axesOf = n => { const s = stretchOf(node(n)); return s ? Object.fromEntries(Object.entries(s).map(([a, R]) => [a, R.map(refKey)])) : null }

// EVERY PRESET'S MAP names parameters it has, live numbers -- or a shape would offer a cube that writes nothing
for (const [key, s] of Object.entries(PRIMITIVES)) {
    if (!s.stretch) continue
    const n = add(key)
    eq(`${key}: every axis it maps is offered, as the entry says`, axesOf(n), s.stretch)
}
eq('a sphere, the octahedron, the reflector: no stretch -- scaled whole', [axesOf(add('sphere')), axesOf(add('octahedron')), axesOf(add('reflector'))], [null, null, null])
// LOOKED AT AGAIN (2026-10-02, "don't force it"): a ring in the xy plane, the link's straight sides -- and no z by a round tube
eq('a torus and a capped torus: x and y by the ring, no z', [axesOf(add('torus')), axesOf(add('capped torus'))], [{ x: ['ring'], y: ['ring'] }, { x: ['ring'], y: ['ring'] }])
eq('a link: y by its span only', axesOf(add('link')), { y: ['span'] })
eq('the shapes from points: none (their points are their sizes)', [axesOf(add('revolution')), axesOf(add('bent tube')), axesOf(add('light guide'))], [null, null, null])

// A LIGHT AND AN EXPORT BOX: not code, their shape is their type (lights.js, exportbox.js)
{
    const rect = M.addLight(d, 'root', { shape: 'rectangle' }), disc = M.addLight(d, 'root', { shape: 'disc' }), file = M.addLight(d, 'root', { shape: 'rayfile' })
    eq('a rectangle light: x its width, y its height; a disc light: its radius both; a ray file: none',
        [axesOf(rect), axesOf(disc), axesOf(file)], [{ x: ['width'], y: ['height'] }, { x: ['radius'], y: ['radius'] }, null])
    const fixed = M.addLight(d, 'root', { shape: 'rectangle' })
    M.setConstant(d, fixed.id, 'width', 'f32')
    eq('...a light whose width is a compile-time constant: y only', axesOf(fixed), { y: ['height'] })
    const R = node(rect), W = stretchOf(R).x
    eq('...stretched: its width only, no range to hold it but never through zero', [stretched(R, W, 2, startOf(R, W)), stretched(R, W, 0, startOf(R, W)).width],
        [{ width: 2 }, MIN_SIZE])
    const box = M.addExportBox(d, 'root', {}), X = node(box)
    eq('an export box: its size, whole, along each axis', axesOf(box), { x: ['size.x'], y: ['size.y'], z: ['size.z'] })
    const tiny = stretched(X, stretchOf(X).y, 0, startOf(X, stretchOf(X).y))
    ok('...squeezed to nothing: still more than nothing, as an export box must be (exportProblems)', tiny.size.y > 0 && tiny.size.x === 1 && tiny.size.z === 1
        && exportProblems({ ...X, params: { ...X.params, ...tiny } }).length === 0, JSON.stringify(tiny))
}

// FOUND BY ITS CODE, its comments aside
const box = add('box')
ok('a box\'s code with a comment changed is still a box\'s', (() => {
    M.setCode(d, box.id, M.codeOf(d, box).replace('HALF-size', 'half size, as I like it') + '\n// mine')
    return !!stretchOf(node(box))
})())
const edited = add('box')
M.setCode(d, edited.id, M.codeOf(d, edited).replace('NboxRounded(p, size, rounding)', 'NboxRounded(p, size * 2.0, rounding)'))
eq('...with its code changed it is the user\'s own: none', axesOf(edited), null)
const constant = add('cylinder', { constants: { height: 'f32' } })
eq('a compile-time size is not offered (it would compile at every step); the round axes still are', axesOf(constant), { x: ['radius'], y: ['radius'] })
eq('a group, nothing', stretchOf(node(M.addGroup(d, 'root', {}))), null)

// WHAT A STRETCH WRITES
{
    const n = node(box), S = stretchOf(n)
    eq('a box along x: size.x doubled, y and z kept', stretched(n, S.x, 2, startOf(n, S.x)), { size: { x: 1, y: 0.5, z: 0.5 } })
    const cyl = node(add('cylinder')), C = stretchOf(cyl)
    eq('a cylinder along x: its radius (round in x and y)', stretched(cyl, C.x, 1.5, startOf(cyl, C.x)), { radius: cyl.params.radius * 1.5 })
    const pyr = node(add('pyramid')), P = stretchOf(pyr)
    eq('a pyramid along y: base.y and top.y, their x kept', stretched(pyr, P.y, 2, startOf(pyr, P.y)),
        { base: { ...pyr.params.base, y: pyr.params.base.y * 2 }, top: { ...pyr.params.top, y: pyr.params.top.y * 2 } })
    const tube = node(add('tube')), T = stretchOf(tube)
    tube.params.inner = 0
    eq('a solid tube (inner 0) stretched: its inner radius stays nothing', stretched(tube, T.x, 3, startOf(tube, T.x)).inner, 0)
    eq('...and down to nothing: the outer kept at its slider\'s least (0.01)', stretched(tube, T.x, 0, startOf(tube, T.x)).outer, tube.ranges.outer.min)
    eq('...and a size with no slider, more than nothing', stretched(n, S.x, 0, startOf(n, S.x)).size.x, MIN_SIZE)
    const lens = node(add('lens')), L = stretchOf(lens)
    eq('a lens along z: its thickness, not its radii', Object.keys(stretched(lens, L.z, 2, startOf(lens, L.z))), ['thickness'])
    // held to a slider's range (the cylinder's height: LEN, 0.01 to 10)
    eq('held within its slider\'s range', stretched(cyl, C.z, 1000, startOf(cyl, C.z)).height, cyl.ranges.height.max)
    eq('Ctrl: a multiple of the step (0.5 x 1.234 = 0.617: 0.6)', stretched(cyl, C.x, 1.234, startOf(cyl, C.x), 0.1).radius, 0.6)
    eq('the values tidied: 0.1 * 3 is 0.3', stretched(n, S.x, 3, { 'size.x': 0.1 }).size.x, 0.3)
}

// THE FACTOR A CUBE'S DRAG GIVES
eq('dragged twice as far out: twice; half: half; through the origin: as small as it goes',
    [stretchFactor(1, 2), stretchFactor(1, 0.5), stretchFactor(1, -1)], [2, 0.5, 0.01])

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `stretch: ${pass} passed, 0 failed`)
process.exit(fail ? 1 : 0)
