//======================================================================================================================
// Tests for the Transform readout (builder/readout.js transformReadout): the numbers the panel at the view's top right
// shows for a node -- its position, rotation and scale as the properties panel has them, its lengths in the scene's
// unit, its measured bounds times every scale above it, and while a handle is held, what the drag has done and which
// numbers it changed. The panel itself is the headless checks' (transform.check, points.check); how it looks is the
// user's to judge. Run: node builder/test/readout.test.mjs
//======================================================================================================================
import * as M from '../model.js'
import { primitiveObject } from '../primitives.js'
import { transformReadout, deg, signed } from '../readout.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

const d = M.createDoc({ title: 'readout' })
d.unit = 'mm'
M.addGroup(d, 'root', { id: 'g', transform: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 0.5 } })
M.addObject(d, 'g', { id: 'bx', ...primitiveObject('box'), transform: { pos: { x: 1, y: -2, z: 0.25 }, rot: { x: 0, y: -0.04, z: 30 }, scale: 2 } })
M.addObject(d, 'root', { id: 'pr', ...primitiveObject('prism') })
const node = id => M.find(d, id).node
const row = (R, label) => R.rows.find(r => r.label === label)
const texts = r => r?.cells.map(c => c.text)
const hot = R => R.rows.flatMap(r => r.cells.filter(c => c.hot).map(c => `${r.label}.${c.axis ?? ''}`))

// THE NUMBERS, as the panel has them
const R = transformReadout(d, 'bx')
eq('the title is the label, the unit the scene\'s', [R.title, R.unit], ['box', 'mm'])
eq('position: three numbers, x y z, in the scene\'s unit', [texts(row(R, 'position')), row(R, 'position').cells.map(c => c.axis), row(R, 'position').unit],
    [['1.0000', '-2.0000', '0.2500'], ['x', 'y', 'z'], 'mm'])
eq('rotation in degrees, a hair under nothing shown as 0.0, not -0.0', [texts(row(R, 'rotation')), row(R, 'rotation').unit], [['0.0', '0.0', '30.0'], '°'])
eq('scale: one number', texts(row(R, 'scale')), ['2.0000'])
eq('the lengths, in the order the node has them: a box\'s size (its half size, as written) and its rounding',
    R.rows.slice(3).map(r => [r.label, texts(r)]), [['size', ['0.5000', '0.5000', '0.5000']], ['rounding', ['0.0200']]])
eq('nothing lit without a drag', hot(R), [])
const prism = transformReadout(d, 'pr')
ok('a prism: its radius and height, which are lengths; not its sides, which is a count', !!row(prism, 'radius') && !!row(prism, 'height') && !row(prism, 'sides'),
    JSON.stringify(prism.rows.map(r => r.label)))
eq('the root and an id that is not there: nothing', [transformReadout(d, d.root.id), transformReadout(d, 'nope')], [null, null])

// THE BOUNDS: measured in the node's own frame, times the group's 0.5 and its own 2
const box = { lo: [-0.5, -0.25, -1], hi: [0.5, 0.25, 1], cell: 0.025, open: false }
const B = row(transformReadout(d, 'bx', { box }), 'bounds ≈')
eq('bounds: the extent along its own axes times every scale above it and its own (0.5 x 2)', texts(B), ['1', '0.5', '2'])
ok('...said to be measured, and to within what', /measured on the GPU, to within 0\.025 mm/.test(B.tip) && !B.dim, B.tip)
const stale = row(transformReadout(d, 'bx', { box, fresh: false }), 'bounds ≈')
ok('a box measured before the shape changed: dimmed, and said', stale.dim && /changed since/.test(stale.tip))
eq('an open box (a plane) has no bounds row', row(transformReadout(d, 'bx', { box: { ...box, open: true } }), 'bounds ≈'), undefined)

// A DRAG: what it did, and the numbers it changed lit
const t = node('bx').transform
const start = structuredClone(t)
t.pos.x = 1.5
const mv = transformReadout(d, 'bx', { drag: { kind: 'move', start } })
eq('a move along x: position x lit, nothing else', hot(mv).filter(h => h !== 'moved.x' && !h.startsWith('moved')), ['position.x'])
eq('...and a row of what it moved, signed', texts(row(mv, 'moved')), ['+0.5000', '+0.0000', '+0.0000'])
t.pos.x = 1
t.rot.z = 15
const rt = transformReadout(d, 'bx', { drag: { kind: 'rotate', start, k: 2, deg: -15 } })
eq('a turn about z: rotation z lit; the turn signed, about z', [hot(rt).filter(h => h.startsWith('rotation')), texts(row(rt, 'turned')), row(rt, 'turned').cells[0].axis],
    [['rotation.z'], ['-15.0'], 'z'])
eq('...a turn the other way has its plus', texts(row(transformReadout(d, 'bx', { drag: { kind: 'rotate', start, k: 2, deg: 15 } }), 'turned')), ['+15.0'])
t.rot.z = 30
t.scale = 3
eq('a scale: scale lit, by how much', [hot(transformReadout(d, 'bx', { drag: { kind: 'scale', start } })).filter(h => !h.startsWith('scaled')),
    texts(row(transformReadout(d, 'bx', { drag: { kind: 'scale', start } }), 'scaled'))], [['scale.'], ['× 1.500']])
t.scale = 2
const params0 = { size: { x: 0.25, y: 0.5, z: 0.5 } }
const st = transformReadout(d, 'bx', { drag: { kind: 'stretch', start, c: 0, refs: [{ k: 'size', c: 'x' }], params0 } })
eq('a stretch along x: size x lit and nothing else; the factor applied, read back from the size', [hot(st).filter(h => !h.startsWith('stretched')), texts(row(st, 'stretched'))],
    [['size.x'], ['× 2.000']])
ok('...a solid tube\'s inner radius of 0 is not what the factor is read from', (() => {
    const tb = M.addObject(d, 'root', { id: 'tb', ...primitiveObject('tube') })
    const n = node('tb'), p0 = { outer: 0.5, inner: 0 }
    n.params.outer = 1; n.params.inner = 0
    const x = transformReadout(d, 'tb', { drag: { kind: 'stretch', start: structuredClone(n.transform), c: 0, refs: [{ k: 'inner' }, { k: 'outer' }], params0: p0 } })
    return texts(row(x, 'stretched'))?.[0] === '× 2.000' && !!tb
})())
const pv = transformReadout(d, 'bx', { preview: [{ k: 'size', c: 'y' }] })
eq('over a cube, the numbers it would change lit softly, not as changed', [row(pv, 'size').cells.map(c => !!c.lit), hot(pv)], [[false, true, false], []])

// WHAT CTRL SNAPS TO, said: one grid for moves and sizes, two when the node's own scale makes them differ
eq('the grid in a note', transformReadout(d, 'pr', { snap: { grid: 0.05, size: 0.05 } }).notes,
    [{ tone: 'note', text: 'grid 0.05 -- Ctrl snaps moves and sizes to it; turns to 15\u00b0, scale to 0.1' }])
eq('...a node scaled: sizes to their own step', transformReadout(d, 'bx', { snap: { grid: 0.05, size: 0.02 } }).notes[0].text,
    'grid 0.05 -- Ctrl snaps moves to it, sizes to 0.02; turns to 15\u00b0, scale to 0.1')
eq('...and nothing said without one', transformReadout(d, 'pr').notes, [])

// WHAT A CUBE CHANGES is shown, a length or not: a light's width and height, an export box's size
{
    const L = M.addLight(d, 'root', { id: 'lamp', shape: 'rectangle', params: { width: 2, height: 0.5 } })
    const R = transformReadout(d, L.id)
    eq('a rectangle light: its width and height, though neither is marked a length', R.rows.slice(3).map(r => [r.label, texts(r)]), [['width', ['2.0000']], ['height', ['0.5000']]])
    const X = M.addExportBox(d, 'root', { id: 'print' })
    eq('an export box: its size', transformReadout(d, X.id).rows.slice(3).map(r => [r.label, texts(r)]), [['size', ['1.0000', '1.0000', '1.0000']]])
}

// LOCKED (model.js lockOf): said first among the notes, as it is why the picture has no handles for it
{
    const locks = () => transformReadout(d, 'pr', { snap: { grid: 0.1, size: 0.1 } }).notes
    eq('unlocked: no word of it', locks().filter(n => n.tone === 'lock'), [])
    M.setLock(d, 'pr', 'position', true)
    eq('position locked: said, first', locks()[0], { tone: 'lock', text: 'locked: position and rotation -- unlock in the properties panel or the tree' })
    M.setLock(d, 'pr', 'params', true)
    eq('...and its parameters: both in one note', locks().filter(n => n.tone === 'lock').map(n => n.text),
        ['locked: position and rotation, parameters and scale -- unlock in the properties panel or the tree'])
    M.setLock(d, 'pr', 'position', false)
    eq('parameters alone', locks()[0].text, 'locked: parameters and scale -- unlock in the properties panel or the tree')
    M.setLock(d, 'pr', 'params', false)
    ok('...the numbers as they were all along', texts(row(transformReadout(d, 'pr'), 'position')).length === 3)
}

// THE FORMATS
eq('deg and signed', [deg(-0.04), deg(-12.34), signed(0), signed(-0.5), signed(0.25)], ['0.0', '-12.3', '+0.0000', '-0.5000', '+0.2500'])

console.log(`readout: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
