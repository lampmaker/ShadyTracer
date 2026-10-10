// node lib/shell/test/registry.test.mjs
//
// The shell's registries without a DOM: panels and commands, the menu bar made from them (order,
// separators where a group changes, menus appended by the commands that name them, empty menus left
// out), the search a palette would use, and the refusals that keep ids -- which saved layouts and
// key bindings are made of -- unique.
import { makeRegistries, MODULE_LABELS } from '../registry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const throws = f => { try { f(); return false } catch { return true } }

{
    const R = makeRegistries({ menus: ['File', 'Edit', 'View', 'Help'] })
    const v = R.panel({ id: 'viewport', title: 'Viewport', module: 'renderer', popout: false })
    ok('a panel keeps what it was given, with defaults for the rest', v.module === 'renderer' && v.popout === false && v.closable === true)
    ok('a panel without a title is titled by its id', R.panel({ id: 'stats' }).title === 'stats')
    ok('a panel id twice is refused (layouts are saved by id)', throws(() => R.panel({ id: 'viewport' })))
    ok('a panel without an id is refused', throws(() => R.panel({ title: 'x' })))

    R.command({ id: 'file.new', menu: 'File', group: 'new', label: 'New' })
    R.command({ id: 'file.open', menu: 'File', group: 'new', label: 'Open', keys: 'Ctrl O' })
    R.command({ id: 'file.save', menu: 'File', group: 'save', label: 'Save', keys: 'Ctrl S' })
    R.command({ id: 'optics.run', menu: 'Optics', label: 'Run analysis' })
    ok('a command id twice is refused', throws(() => R.command({ id: 'file.new', menu: 'File', label: 'again' })))

    const M = R.menuModel()
    ok('menus with nothing in them are left out (Edit, View, Help)', M.map(m => m.name).join() === 'File,Optics', M.map(m => m.name).join())
    ok('a menu no one named at creation is appended by its first command', R.menus().at(-1) === 'Optics')
    const file = M.find(m => m.name === 'File').items
    ok('commands in registration order, a separator where the group changes',
        file.length === 4 && file[0].command.id === 'file.new' && file[1].command.id === 'file.open' && file[2].separator && file[3].command.id === 'file.save',
        JSON.stringify(file.map(i => i.separator ? '--' : i.command.id)))
    ok('a command has a when() that allows it by default', R.commands.get('file.new').when() === true)

    ok('search: every word must match, across menu, label and keys', R.find('file ctrl s').map(c => c.id).join() === 'file.save')
    ok('search: case does not matter', R.find('RUN').map(c => c.id).join() === 'optics.run')
    ok('search: nothing for a word nowhere', R.find('teleport').length === 0)
    ok('every module has a tab label', ['renderer', 'optics', 'builder', 'app'].every(m => MODULE_LABELS[m]))

    // A SUBMENU ROW (File's Switch to scene ▸): listed where it was registered, its entries asked for, never a palette answer
    let asked = 0
    R.command({ id: 'file.switch', menu: 'File', group: 'save', label: 'Switch to scene', items: () => { asked++; return [{ label: 'A', run: () => { } }] } })
    const sub = R.menuModel().find(m => m.name === 'File').items.at(-1).command
    ok('a submenu row is listed in its menu, its entries not asked for until it opens', sub.id === 'file.switch' && asked === 0)
    ok('...its entries are what items() says', sub.items()[0].label === 'A' && asked === 1)
    ok('...and search never answers with it', R.find('switch').length === 0)
    R.dropCommand('file.switch')

    // A PANEL MADE AT RUN TIME AND LET GO (an added chart, removed): its id is free again, and so is its View entry's
    R.panel({ id: 'chart.2', title: 'Chart 2' })
    R.command({ id: 'view.chart.2', menu: 'View', label: 'Chart 2' })
    ok('a panel dropped is gone, and says it was there', R.dropPanel('chart.2') && !R.panels.has('chart.2'))
    ok('...and dropping it again says there was none', R.dropPanel('chart.2') === false)
    ok('...its id can be registered again', !throws(() => R.panel({ id: 'chart.2', title: 'Chart 2' })))
    ok('a command dropped leaves its menu', R.dropCommand('view.chart.2') && !R.menuModel().some(m => m.items.some(i => i.command?.id === 'view.chart.2')))
    ok('...and its id can be registered again', !throws(() => R.command({ id: 'view.chart.2', menu: 'View', label: 'Chart 2' })))
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
