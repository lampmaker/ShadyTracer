// node builder/test/filemenu.test.mjs
//
// The File menu (builder/filemenu.js), no DOM: its five rows in their order (0.63.0), each reaching the host's action,
// Export ▸ and its three files, an action the host does not give left out, what is greyed while a library item is
// edited -- and no label said twice. The scenes' commands: in no menu (the palette's), on the scene being worked on,
// the last scene refused. The examples by audience and group, for the Project panel.
import { fileCommands, sceneCommands, exampleGroups } from '../filemenu.js'
import { EXAMPLES } from '../../scenes/index.js'
import { makeRegistries } from '../../lib/shell/registry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

const calls = []
let editing = false
const said = []
const KEYS = ['newProject', 'projects', 'importFile', 'exportScene', 'exportProject', 'exportPrint', 'picture']
const actions = Object.fromEntries(KEYS.map(k => [k, () => calls.push([k])]))
const item = { active: () => editing }
const cmds = fileCommands({ actions, item })
const by = id => cmds.find(c => c.id === id)
const on = id => by(id).when ? by(id).when() !== false : true
const last = () => calls.at(-1)

// THE LIST: every entry File's, registered as the page does
const R = makeRegistries({ menus: ['File'] })
for (const c of cmds) R.command(c)
const file = R.menuModel()[0].items
const text = file.map(i => i.separator ? '--' : i.command.label)
ok('File: five rows, in this order, a rule between groups', text.join(' | ') === [
    'New project', 'Projects…', '--', 'Import from file…', 'Export', '--', 'Save picture…'].join(' | '), text.join(' | '))
ok('no label said twice', new Set(cmds.map(c => c.label)).size === cmds.length)
ok('Import says its key (the toolbar binds it)', by('file.import').keys === 'Ctrl O')
ok('no row says Ctrl S: the project is saved as it changes', !cmds.some(c => c.keys === 'Ctrl S'))
ok('an action the host does not give is not listed', !fileCommands({ actions: { projects: () => { } } }).some(c => c.id === 'file.picture'))

// THE ROWS reach the host's actions
for (const [id, k] of [['file.newProject', 'newProject'], ['file.projects', 'projects'], ['file.import', 'importFile'], ['file.picture', 'picture']]) {
    by(id).run()
    ok(`${by(id).label}: the host's ${k}`, last().join() === k)
}
// EXPORT ▸: a submenu (no palette answer), its three files
const ex = by('file.export').items()
ok('Export ▸: Scene file, Project file, then 3D print', ex.map(x => x.separator ? '--' : x.label).join(' | ') === 'Scene file… | Project file… | -- | 3D print (3MF / STL)…',
    ex.map(x => x.label).join())
ex.filter(x => x.run).forEach(x => x.run())
ok('...each the host\'s', calls.slice(-3).map(c => c[0]).join() === 'exportScene,exportProject,exportPrint', calls.slice(-3).join(' '))
ok('...a submenu row: no palette answer (registry find)', R.find('export').length === 0)
ok('...a file the host cannot write is not offered', fileCommands({ actions: { exportScene: () => { } } }).find(c => c.id === 'file.export').items().length === 1)

// A LIBRARY ITEM BEING EDITED: it stays isolated -- no new project, no file read in; Projects, the exports and a picture stay
editing = true
ok('an item edited: New project and Import greyed', !on('file.newProject') && !on('file.import'))
ok('...Projects, Export and Save picture not', on('file.projects') && on('file.export') && on('file.picture'))
editing = false

// THE SCENES' COMMANDS: no menu row, the palette's
{
    const scene = (key, title) => ({ key, doc: { title } })
    const BUILDER = { project: { scenes: [scene('s1', 'Lens'), scene('s2', 'Lamp')] }, current: 's2' }
    const done = []
    const ops = new Proxy({}, { get: (_, k) => (...a) => done.push([k, ...a].join()) })
    const sc = sceneCommands({ BUILDER, ops, item, say: t => said.push(t) })
    const S = makeRegistries({ menus: ['File'] })
    for (const c of sc) S.command(c)
    ok('the scenes\' commands are in no menu', sc.every(c => !c.menu) && S.menuModel().length === 0)
    ok('...the palette finds them', S.find('scene duplicate').length === 1 && S.find('scene delete').length === 1)
    for (const c of sc) c.run()
    ok('...each on the scene being worked on', done.join(' | ') === 'add | duplicate,s2 | remove,s2', done.join(' | '))
    BUILDER.project.scenes = [scene('s1', 'Lens')]; BUILDER.current = 's1'
    const del = sc.find(c => c.id === 'scene.delete'), n = done.length
    ok('...the last scene: Delete greyed', del.when() === false)
    del.run()
    ok('...and refused if run anyway, said', done.length === n && /last scene/.test(said.at(-1)))
    editing = true
    ok('...an item edited: new and duplicate greyed', !sc.find(c => c.id === 'scene.new').when() && !sc.find(c => c.id === 'scene.duplicate').when())
    editing = false
}

// THE EXAMPLES BY AUDIENCE AND GROUP (0.54.0), for the Project panel: an audience, its groups, each example once
{
    const G = exampleGroups(EXAMPLES)
    ok('examples: an entry per audience, in order', JSON.stringify(G.map(a => a.audience)) === JSON.stringify([...new Set(EXAMPLES.map(e => e.audience))]))
    ok('...its groups in order', G.every(a => JSON.stringify(a.groups.map(g => g.group))
        === JSON.stringify([...new Set(EXAMPLES.filter(e => e.audience === a.audience).map(e => e.group))])))
    const all = G.flatMap(a => a.groups.flatMap(g => g.items))
    ok('...every example once, in the list\'s order', all.length === EXAMPLES.length && all.every((e, i) => e === EXAMPLES[i]))
    const flat = exampleGroups([{ id: 'a.json', title: 'A' }, { id: 'b.json', title: 'B' }])
    ok('...a list with no audience: one entry, no group', flat.length === 1 && flat[0].audience === null && flat[0].groups[0].items.length === 2)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
