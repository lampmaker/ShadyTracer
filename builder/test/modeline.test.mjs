//======================================================================================================================
// THE STATUS BAR'S WORD FOR THE BUILD SHOWN (builder/modeline.js). Run: node builder/test/modeline.test.mjs
// No DOM, no GPU: each state's line and tooltip, as index.html hands them in.
//======================================================================================================================
import { modeLine } from '../modeline.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const built = { id: 'built', title: 't' }
const baked = { id: 'built', baked: { names: ['a'], kept: ['bxlo_g', 'bxhi_g', 'xf_ball', 'radius_ball'] } }

ok('no scene: nothing', modeLine({}).text === '')
ok('another scene than the builder\'s: its id', modeLine({ scene: { id: 'cornell' } }).text === 'scene · cornell')
ok('...or the builder\'s not the one shown', modeLine({ scene: built, showing: false }).text === 'scene · built')
let m = modeLine({ scene: built, mode: 'data', bakeOn: false })
ok('the editing build, the bake off: its mode alone', m.text === 'editing · data' && !m.baked && /bake is off/.test(m.title), m.text)
m = modeLine({ scene: built, mode: 'code', bakeOn: true, baker: 'waiting' })
ok('...the bake on, waiting for quiet', m.text === 'editing · code · bake after 2 s quiet' && /values uniforms/.test(m.title), m.text)
m = modeLine({ scene: built, mode: 'data', bakeOn: true, baker: 'compiling' })
ok('...compiling a bake', m.text === 'editing · data · baking…', m.text)
m = modeLine({ scene: baked, bakeOn: true, baker: 'shown' })
ok('baked: the uniforms kept for animated values counted, the culling boxes not', m.text === 'baked · 2 animated live' && m.baked && /2 uniforms kept live/.test(m.title), m.text)
m = modeLine({ scene: { id: 'built', baked: { names: [], kept: ['bxlo_g'] } } })
ok('...none animated: baked alone', m.text === 'baked' && m.baked)
m = modeLine({ scene: built, mode: 'data', bakeOn: true, lastLeave: { at: Date.now(), why: 'ball radius moved: not animated' } })
ok('the last leave and why, in the tooltip', /Last left the bake .*: ball radius moved: not animated/.test(m.title), m.title)


console.log(`modeline: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
