//======================================================================================================================
// THE FILE MENU -- the project, its scenes and the files, as the menu bar's commands (lib/shell registry.js). Data and
// functions, no DOM: the page registers them (index.html) and builder/test/scenemenu.test.mjs runs them.
//
// WHY HERE. The scenes had a menu of their own, a dropdown over the tree (switcher.js), which said New scene, Open and
// the three saves again under other words, and was the only place to switch, rename, duplicate, move or delete a
// scene, or reach the examples. Two menus for one job, and the user had to know which held what (the user,
// 2026-10-09: "lots of duplicate entries ... remove that and make sure it's covered in the file menu"). Now File is
// the one place, and the dropdown is gone.
//
// SWITCHING IS STILL A CHOICE (switcher.js's reason, 2026-10-02): a compile, 3.7-23 s on the user's card, so it is
// a submenu entry, chosen, and never a click on something else. The scene ops are the tree's (tree.js sceneOps):
// one undo step each, a compile when the scene being worked on changes. The verbs act on the scene being worked on.
//
//   for (const c of fileCommands({ BUILDER, ops: tree.sceneOps, examples, actions, item, locked, prompt, say }))
//       SHELL.command(c)
//
// Nothing that switches, adds or edits a scene or opens a file while a library item is edited (library/edit.js):
// it stays isolated until saved or closed (the user, 2026-09-30). Those rows are greyed then; the item's own Save
// and Close take their place.
//======================================================================================================================

/**
 * @param BUILDER   demo.js's: project, current
 * @param ops       tree.js's sceneOps: enter, add, duplicate, remove, move, rename
 * @param examples  { list: async () => [{ id, title }], open: async id => void }, or null
 * @param actions   the host's, each () => void, an entry whose function is missing not listed: projects, newProject,
 *                  importProject, open, saveNow, saveScene, save, saveWorkspace, picture
 * @param item      { active: () => bool, save, close }: the library item being edited (library/edit.js), or null
 * @param prompt    (question, value) => string | null: a new name (window.prompt on the page)
 * @param say       a line for the status bar
 */
/* THE EXAMPLES' ROWS: by audience, a heading each, and by group a submenu each (0.51.0; the user, 2026-10-10: "grouped
   in subcategories", and the examples "split between regular users and optical designers"). An audience with one group
   lists its examples under its heading directly. An example with neither (a list from before, a test's stand-in) is a
   row of its own. Each row's tooltip is what the example shows. */
export function exampleRows(list, open) {
    const row = x => ({ label: x.title, run: () => open(x),
        title: `${x.description ? `${x.description}. ` : ''}Adds a copy to this project and works on it` })
    const out = []
    const audiences = []
    for (const x of list) if (x.audience && !audiences.includes(x.audience)) audiences.push(x.audience)
    for (const a of audiences) {
        if (out.length) out.push({ separator: true })
        out.push({ header: true, label: a })
        const of = list.filter(x => x.audience === a)
        const groups = [...new Set(of.map(x => x.group))]
        if (groups.length === 1) out.push(...of.map(row))
        else for (const g of groups) out.push({ label: g, items: of.filter(x => x.group === g).map(row) })
    }
    const loose = list.filter(x => !x.audience)
    if (loose.length && out.length) out.push({ separator: true })
    out.push(...loose.map(row))
    return out
}

export function fileCommands({ BUILDER, ops, examples = null, actions = {}, item = null, prompt = (q, v) => window.prompt(q, v), say = () => { } }) {
    const editing = () => !!item?.active()
    const free = () => !editing()
    const scenes = () => BUILDER.project.scenes
    const index = () => scenes().findIndex(s => s.key === BUILDER.current)
    const cur = () => scenes()[index()]
    const out = []
    const C = def => { out.push({ menu: 'File', ...def }); return def }
    const A = (key, def) => { if (actions[key]) C({ run: () => actions[key](), ...def }) }

    // ---- THE PROJECT
    A('projects', { id: 'file.projects', group: 'project', label: 'Projects…',
        help: 'Every project kept in this browser: open one, a new one, rename, duplicate, download, import a file, delete' })
    A('newProject', { id: 'file.newProject', group: 'project', label: 'New project', when: free,
        help: 'A project of one empty scene; the one open now stays in File › Projects…' })
    A('importProject', { id: 'file.importProject', group: 'project', label: 'Import a project from a file…', when: free,
        help: 'A workspace or project file, kept in this browser as a project of its own, and opened' })

    // ---- ITS SCENES
    C({ id: 'file.new', group: 'scene', label: 'New scene', when: free, run: () => ops.add(), help: 'An empty scene after this one' })
    C({ id: 'file.switch', group: 'scene', label: 'Switch to scene', when: () => free() && scenes().length > 1,
        help: 'Another scene of this project, worked on and compiled',
        items: () => scenes().map(s => {
            const here = s.key === BUILDER.current
            return { label: `${here ? '● ' : '   '}${s.doc.title}${s.doc.libraryItem ? '  (library item)' : ''}`, off: here,
                     title: here ? 'The scene being worked on' : `Switch to ${s.doc.title} (compiles it)`, run: () => ops.enter(s.key) }
        }) })
    /* THE EXAMPLES (scenes/index.js): a COPY into the project, so an example is never edited and opening one twice
       gives two. Their titles are read from the files, which takes a moment: asked for when File first opens (a
       row's `when` is asked then), so the list is there by the time the pointer reaches it */
    if (examples) {
        let list = null, asked = false
        const load = () => {
            if (asked) return
            asked = true
            examples.list().then(l => { list = l }).catch(e => { list = []; say(`examples: ${e.message}`) })
        }
        C({ id: 'file.examples', group: 'scene', label: 'Examples', when: () => { load(); return free() },
            help: 'The bundled scenes: a copy of one goes into this project, and is worked on',
            items: () => { load(); return list ? exampleRows(list, x => examples.open(x.id)) : [{ label: 'loading…', off: true }] } })
    }
    C({ id: 'file.renameScene', group: 'scene', label: 'Rename this scene…', when: free, run: () => {
        const s = cur()
        const t = s && prompt('A new name for this scene', s.doc.title)
        if (t != null && t.trim() && t.trim() !== s.doc.title) ops.rename(s.key, t)
    } })
    C({ id: 'file.duplicateScene', group: 'scene', label: 'Duplicate this scene', when: free, run: () => ops.duplicate(BUILDER.current),
        help: 'A copy right after it, worked on' })
    C({ id: 'file.sceneUp', group: 'scene', label: 'Move this scene up the list', when: () => free() && index() > 0,
        run: () => { const i = index(); if (i > 0) ops.move(BUILDER.current, i - 1) } })
    C({ id: 'file.sceneDown', group: 'scene', label: 'Move this scene down the list', when: () => free() && index() < scenes().length - 1,
        run: () => { const i = index(); if (i >= 0 && i < scenes().length - 1) ops.move(BUILDER.current, i + 1) } })
    // no confirmation, as for any delete: one undo step. The project refuses the last scene; so does the row, greyed.
    C({ id: 'file.deleteScene', group: 'scene', label: 'Delete this scene', when: () => free() && scenes().length > 1,
        help: 'Ctrl+Z brings it back; the last scene cannot be deleted',
        run: () => scenes().length > 1 ? ops.remove(BUILDER.current) : say('the last scene cannot be deleted') })

    // ---- OPEN, AND THE LIBRARY ITEM BEING EDITED
    A('open', { id: 'file.open', group: 'open', label: 'Open a file (scene, project or workspace)…', keys: 'Ctrl O', when: free,
        help: 'A scene or a project file joins this project; a workspace file becomes a project of its own' })
    if (item) {
        C({ id: 'file.saveItem', group: 'library', label: 'Save the library item', keys: 'Ctrl S', when: editing, run: () => item.save(),
            help: 'The item being edited, back into the library' })
        C({ id: 'file.closeItem', group: 'library', label: 'Close the library item', when: editing, run: () => item.close(),
            help: 'Back to the scene before; asks first if it is not saved' })
    }

    // ---- SAVE. Ctrl+S is the item's while one is edited: one row says Ctrl S at a time
    A('saveNow', { id: 'file.saveNow', group: 'save', label: 'Save now (in this browser)', keys: 'Ctrl S', when: free,
        help: 'The project is saved in this browser as it changes; this does it at once' })
    A('saveScene', { id: 'file.saveScene', group: 'files', label: 'Save this scene to a file', help: 'This scene alone, in the format of the bundled scenes' })
    A('save', { id: 'file.save', group: 'files', label: 'Save all scenes to a file',
        help: 'Every scene of this project, in one file: imported, they join the project it goes into' })
    A('saveWorkspace', { id: 'file.saveWorkspace', group: 'files', label: 'Save the project to a file (scenes, render settings, cameras)',
        help: 'A workspace file, which opens as a project of its own' })
    A('picture', { id: 'file.picture', group: 'export', label: 'Save a picture (PNG)…',
        help: 'Render a picture at a size and sample count of its own, develop it, save it as PNG' })
    return out
}
