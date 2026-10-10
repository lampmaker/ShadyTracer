//======================================================================================================================
// THE SHELL'S REGISTRIES -- what can be docked, and what can be done. Pure data, no DOM, so Node tests it.
//
// Everything the user can reach in the application is an entry here, and the menu bar is made from
// the entries rather than written by hand (roadmap/UI_PLAN.md, section 7). A module adds
// its own: the renderer registers its view and its settings, the optics module its charts, the
// application its tree. Nothing about any of them is known here.
//
//   const R = makeRegistries({ menus: ['File', 'Edit', 'View', 'Window', 'Help'] })
//   R.panel({ id: 'viewport', title: 'Viewport', module: 'renderer', help: '...' })
//   R.command({ id: 'file.save', menu: 'File', group: 'save', label: 'Save all scenes', keys: 'Ctrl S', run })
//   R.menuModel()   // [{ name: 'File', items: [{ command } | { separator: true }] }, ...]
//======================================================================================================================

/** The modules a panel can belong to, and the short label its tab carries. Open-ended: an unknown
 *  module gets its own name as the label. */
export const MODULE_LABELS = { renderer: 'render', optics: 'optics', builder: 'builder', app: 'app' }

export function makeRegistries({ menus = [] } = {}) {
    const panels = new Map()
    const commands = new Map()
    const menuOrder = [...menus]

    /** A panel: something the dock can hold. `id` is unique and is what layouts are saved by, so it
     *  must not change between versions; `title` is what the tab says. */
    const panel = def => {
        if (!def?.id) throw new Error('a panel needs an id')
        if (panels.has(def.id)) throw new Error(`panel '${def.id}' is registered twice`)
        const p = { module: 'app', help: '', closable: true, popout: true, ...def, title: def.title ?? def.id }
        panels.set(p.id, p)
        return p
    }

    /** A panel made at run time and let go again (a chart the user added, then removed): its id free
     *  to be registered again. False when there was none. */
    const dropPanel = id => panels.delete(id)

    /** A command: an action with a label, and where it shows. `menu` places it in the menu bar
     *  (a menu not named at creation is appended); `group` separates it from its neighbours with a
     *  rule when the group changes; `keys` is the shortcut SHOWN -- binding it is the owner's
     *  business, since the owner usually already listens for it; `when` greys it out when false.
     *  `items: () => [{ label, run, off, title }]` makes it a SUBMENU row instead of an action (File's
     *  Switch to scene ▸, Examples ▸): its entries asked for each time it opens, its own `run` unused. */
    const command = def => {
        if (!def?.id) throw new Error('a command needs an id')
        if (commands.has(def.id)) throw new Error(`command '${def.id}' is registered twice`)
        const c = { group: '', keys: '', help: '', when: () => true, run: () => { }, ...def }
        commands.set(c.id, c)
        if (c.menu && !menuOrder.includes(c.menu)) menuOrder.push(c.menu)
        return c
    }

    /** A command let go with what it was for (a dropped panel's View entry). False when there was none. */
    const dropCommand = id => commands.delete(id)

    /** The menu bar as data: every menu in order, its commands in registration order, a separator
     *  wherever the group changes. Menus with nothing in them are left out. */
    const menuModel = () => menuOrder.map(name => {
        const items = []
        let group = null
        for (const c of commands.values()) {
            if (c.menu !== name) continue
            if (group !== null && c.group !== group) items.push({ separator: true })
            group = c.group
            items.push({ command: c })
        }
        return { name, items }
    }).filter(m => m.items.length)

    /** A command by a search string, for a palette: every word must appear in its menu, label or keys.
     *  A submenu row is not one verb, so it is never an answer. */
    const find = query => {
        const words = String(query).toLowerCase().split(/\s+/).filter(Boolean)
        return [...commands.values()].filter(c => {
            if (c.items) return false
            const text = `${c.menu ?? ''} ${c.label} ${c.keys}`.toLowerCase()
            return words.every(w => text.includes(w))
        })
    }

    return { panels, commands, panel, command, dropPanel, dropCommand, menuModel, find, menus: () => [...menuOrder] }
}
