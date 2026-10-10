// node builder/test/filemenu.test.mjs
//
// The File menu (builder/filemenu.js), no DOM: what it lists and in what order, each scene verb calling the tree's
// sceneOps with the scene being worked on, the ends of the list and the last scene greyed and refused, Switch ▸
// listing every scene with the current one marked and inert, Examples ▸ loading once, everything that switches,
// adds or opens greyed while a library item is edited -- and no label said twice, the duplicates this replaced.
import { fileCommands } from '../filemenu.js'
import { makeRegistries } from '../../lib/shell/registry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

const scene = (key, title) => ({ key, doc: { title } })
const BUILDER = { project: { scenes: [scene('s1', 'Lens'), scene('s2', 'Lamp'), scene('s3', 'Bench')] }, current: 's2' }
const calls = []
const ops = new Proxy({}, { get: (_, k) => (...a) => calls.push([k, ...a]) })
let editing = false, listed = 0, answer = 'Lamp v2'
const said = []
const actions = Object.fromEntries(['projects', 'newProject', 'importProject', 'open', 'saveNow', 'saveScene', 'save', 'saveWorkspace', 'picture']
    .map(k => [k, () => calls.push([k])]))
const examples = { list: async () => { listed++; return [{ id: 'menger.json', title: 'Menger cubes' }] }, open: id => calls.push(['example', id]) }
const cmds = fileCommands({ BUILDER, ops, examples, actions, say: t => said.push(t), prompt: () => answer,
    item: { active: () => editing, save: () => calls.push(['itemSave']), close: () => calls.push(['itemClose']) } })
const by = id => cmds.find(c => c.id === id)
const on = id => by(id).when ? by(id).when() !== false : true
const last = () => calls.at(-1)

// THE LIST: every entry File's, registered as the page does
const R = makeRegistries({ menus: ['File'] })
for (const c of cmds) R.command(c)
const file = R.menuModel()[0].items
const text = file.map(i => i.separator ? '--' : i.command.label)
ok('every entry is in File, in this order, a rule between groups', text.join(' | ') === [
    'Projects…', 'New project', 'Import a project from a file…', '--',
    'New scene', 'Switch to scene', 'Examples', 'Rename this scene…', 'Duplicate this scene', 'Move this scene up the list',
    'Move this scene down the list', 'Delete this scene', '--',
    'Open a file (scene, project or workspace)…', '--',
    'Save the library item', 'Close the library item', '--',
    'Save now (in this browser)', '--',
    'Save this scene to a file', 'Save all scenes to a file', 'Save the project to a file (scenes, render settings, cameras)', '--',
    'Save a picture (PNG)…'].join(' | '), text.join(' | '))
ok('no label said twice', new Set(cmds.map(c => c.label)).size === cmds.length)
ok('an action the host does not give is not listed', !fileCommands({ BUILDER, ops, actions: { open: () => { } } }).some(c => c.id === 'file.picture'))

// THE SCENE VERBS act on the scene being worked on
by('file.new').run(); ok('New scene: ops.add', last()[0] === 'add')
by('file.duplicateScene').run(); ok('Duplicate: ops.duplicate(current)', last().join() === 'duplicate,s2')
by('file.sceneUp').run(); ok('Move up: ops.move(current, its index - 1)', last().join() === 'move,s2,0')
by('file.sceneDown').run(); ok('Move down: ops.move(current, its index + 1)', last().join() === 'move,s2,2')
by('file.deleteScene').run(); ok('Delete: ops.remove(current)', last().join() === 'remove,s2')
by('file.renameScene').run(); ok('Rename: the prompt\'s answer to ops.rename(current)', last().join() === 'rename,s2,Lamp v2')
const n = calls.length
answer = null; by('file.renameScene').run()
answer = '  '; by('file.renameScene').run()
answer = 'Lamp'; by('file.renameScene').run()
ok('...nothing when the prompt is cancelled, blank or the same name', calls.length === n)

// THE ENDS OF THE LIST, AND THE LAST SCENE
BUILDER.current = 's1'
ok('the first scene cannot move up, can move down', !on('file.sceneUp') && on('file.sceneDown'))
BUILDER.current = 's3'
ok('the last cannot move down', !on('file.sceneDown') && on('file.sceneUp'))
BUILDER.project.scenes = [scene('s1', 'Lens')]; BUILDER.current = 's1'
ok('one scene: Delete, Switch and both moves greyed', !on('file.deleteScene') && !on('file.switch') && !on('file.sceneUp') && !on('file.sceneDown'))
const m = calls.length
by('file.deleteScene').run()
ok('...and Delete run anyway is refused, said', calls.length === m && /last scene/.test(said.at(-1)))
BUILDER.project.scenes = [scene('s1', 'Lens'), scene('s2', 'Lamp'), scene('s3', 'Bench')]; BUILDER.current = 's2'

// SWITCH ▸
const sw = by('file.switch').items()
ok('Switch ▸ lists every scene', sw.length === 3 && sw.map(x => x.label.trim()).join() === 'Lens,● Lamp,Bench', sw.map(x => x.label).join())
ok('...the current marked and inert', sw[1].off === true && sw[0].off === false)
sw[2].run(); ok('...another switched to: ops.enter(its key)', last().join() === 'enter,s3')
ok('Switch is a submenu row: no palette answer (registry find)', R.find('switch').length === 0)

// EXAMPLES ▸
ok('Examples: loading until the titles are read', by('file.examples').items()[0].off === true)
on('file.examples'); on('file.examples')
await new Promise(r => setTimeout(r, 0))
const ex = by('file.examples').items()
ok('...read once however often File opens', listed === 1)
ok('...then the bundled scenes by title', ex.length === 1 && ex[0].label === 'Menger cubes')
ex[0].run(); ok('...one chosen: a copy opened', last().join() === 'example,menger.json')

// THE FILES
for (const [id, k] of [['file.projects', 'projects'], ['file.newProject', 'newProject'], ['file.importProject', 'importProject'], ['file.open', 'open'],
                       ['file.saveNow', 'saveNow'], ['file.saveScene', 'saveScene'], ['file.save', 'save'], ['file.saveWorkspace', 'saveWorkspace'], ['file.picture', 'picture']]) {
    by(id).run()
    ok(`${by(id).label}: the host's ${k}`, last().join() === k)
}

// A LIBRARY ITEM BEING EDITED: it stays isolated; Ctrl S is its own
ok('nothing edited: the item\'s rows greyed, Save now offered', !on('file.saveItem') && !on('file.closeItem') && on('file.saveNow'))
editing = true
const shut = ['file.newProject', 'file.importProject', 'file.new', 'file.switch', 'file.examples', 'file.renameScene', 'file.duplicateScene',
              'file.sceneUp', 'file.sceneDown', 'file.deleteScene', 'file.open', 'file.saveNow']
ok('an item edited: every switch, add, edit and open greyed', shut.every(id => !on(id)), shut.filter(on).join())
ok('...its Save and Close offered, and Projects and the files to read', on('file.saveItem') && on('file.closeItem') && on('file.projects') && on('file.saveScene'))
ok('...one row says Ctrl S at a time', cmds.filter(c => c.keys === 'Ctrl S' && on(c.id)).length === 1)
by('file.saveItem').run(); ok('...Save: the item saved', last().join() === 'itemSave')
by('file.closeItem').run(); ok('...Close: the item closed', last().join() === 'itemClose')

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
