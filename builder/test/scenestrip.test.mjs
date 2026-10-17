// node builder/test/scenestrip.test.mjs
//
// The cards over the tree (builder/scenestrip.js, 0.63.0), no DOM: a card per scene in the project's order, the one being
// worked on marked, a library item's scene left out; what each counts -- the objects that draw (an export or a haze box
// does not), the lights, never a group -- and its unit; how long a scene took to open, said.
import * as M from '../model.js'
import * as P from '../project.js'
import { sceneCards, seconds } from '../scenestrip.js'
import { primitiveObject } from '../primitives.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

const a = M.createDoc({ title: 'Lens' }), b = M.createDoc({ title: 'Room' }), item = M.createDoc({ title: 'Knob' })
a.unit = 'mm'
const g = M.addGroup(a, a.root.id, { label: 'holder' })
M.addObject(a, g.id, { ...primitiveObject('sphere'), label: 'ball' })
M.addObject(a, a.root.id, { ...primitiveObject('box'), label: 'floor' })
M.addLight(a, a.root.id, { shape: 'disc' })
M.addExportBox(a, a.root.id)
M.addHazeBox(a, a.root.id)
item.libraryItem = { id: 'x', kind: 'object' }
const p = P.createProject([a, b, item])
const cards = sceneCards(p, p.scenes[1].key)

ok('a card per scene, in the project\'s order, a library item\'s left out', cards.map(c => c.title).join() === 'Lens,Room', cards.map(c => c.title).join())
ok('...keyed by the scene', cards.every((c, i) => c.key === p.scenes[i].key))
ok('the scene being worked on marked, the others not', !cards[0].here && cards[1].here)
ok('objects: what draws, in groups too; not a group, a light, an export or a haze box', cards[0].objects === 2, String(cards[0].objects))
ok('lights: the light objects', cards[0].lights === 1, String(cards[0].lights))
ok('its unit; an empty scene counts nothing', cards[0].unit === 'mm' && cards[1].objects === 0 && cards[1].lights === 0)
ok('a library item being worked on: no card is marked', sceneCards(p, p.scenes[2].key).every(c => !c.here))

ok('a time said in seconds', seconds(6200) === '6 s' && seconds(800) === '0.8 s' && seconds(72000) === '1 min 12 s',
    [seconds(6200), seconds(800), seconds(72000)].join())

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
