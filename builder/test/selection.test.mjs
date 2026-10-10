//======================================================================================================================
// Tests for what a click in the picture selects. Run: node builder/test/selection.test.mjs
//
// On the demo scene, whose structure is: Ground | Shapes { Ball, Slab } | Carved { Block, Scoop }
// | Twisted { Column }, plus one deeper nesting added here, so "stay inside the group you went into"
// has two levels to be tested on.
//======================================================================================================================
import * as M from '../model.js'
import { demoDoc } from './demo-doc.mjs'
import { pathTo, parentOf, clickTarget } from '../selection.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) =>
    ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

const d = demoDoc()
// Shapes { Ball, Slab, Inner { Pebble } }
M.addGroup(d, 'shapes', { id: 'inner', label: 'Inner' })
M.addObject(d, 'inner', { id: 'pebble', primitive: 'sphere' })

eq('the path runs from the top level down', pathTo(d, 'pebble'), ['shapes', 'inner', 'pebble'])
eq('a top-level object is its own path', pathTo(d, 'ground'), ['ground'])
eq('the root is not a level', pathTo(d, 'root'), [])
eq('an unknown id has no path', pathTo(d, 'nope'), [])
eq('parent of a nested node', parentOf(d, 'column'), 'twisted')
eq('parent of a top-level node is nothing', parentOf(d, 'twisted'), null)

// a plain click starts at the top
eq('click on the column selects the twist group', clickTarget(d, 'column', null), 'twisted')
eq('click on the block selects Carved', clickTarget(d, 'block', null), 'carved')
eq('click on a top-level object selects it', clickTarget(d, 'ground', null), 'ground')
eq('click on what is selected keeps it', clickTarget(d, 'column', 'twisted'), 'twisted')
eq('... also when it is deep', clickTarget(d, 'pebble', 'inner'), 'inner')

// shift goes one level deeper than a click would
eq('shift-click on the selected twist goes to the column', clickTarget(d, 'column', 'twisted', 'deeper'), 'column')
eq('shift-click with nothing selected is one below the top', clickTarget(d, 'pebble', null, 'deeper'), 'inner')
eq('shift again goes on down', clickTarget(d, 'pebble', 'inner', 'deeper'), 'pebble')
eq('and stops at the bottom', clickTarget(d, 'pebble', 'pebble', 'deeper'), 'pebble')

// double-click goes straight to the bottom
eq('double-click selects the deepest node', clickTarget(d, 'pebble', null, 'deepest'), 'pebble')

// inside a group you went into, a click stays at that level
eq('with Ball selected, a click on Slab selects Slab', clickTarget(d, 'slab', 'ball'), 'slab')
eq('with Ball selected, a click on Pebble selects Inner, its level in Shapes', clickTarget(d, 'pebble', 'ball'), 'inner')
eq('with Pebble selected, a click on Ball stays inside Shapes: Ball', clickTarget(d, 'ball', 'pebble'), 'ball')
eq('with Pebble selected, a click outside Shapes goes to the top', clickTarget(d, 'block', 'pebble'), 'carved')
eq('with Ball selected, a click outside Shapes goes to the top', clickTarget(d, 'column', 'ball'), 'twisted')
eq('with Block selected, a click on Scoop selects Scoop', clickTarget(d, 'scoop', 'block'), 'scoop')
eq('with Block selected, a click on the Carved group itself (a blend) selects Carved', clickTarget(d, 'carved', 'block'), 'carved')
eq('a leaf that is not in the document selects nothing', clickTarget(d, 'nope', null), null)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
