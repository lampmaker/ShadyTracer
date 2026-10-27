//======================================================================================================================
// THE FILE MENU -- the projects and the files, as the menu bar's commands (lib/shell registry.js); and the scenes'
// commands, which have no menu row. Data and functions, no DOM: the page registers them (app.html) and
// builder/test/filemenu.test.mjs runs them.
//
// FIVE ROWS (0.63.0; the user, 2026-10-17: "I dont like how the file menu is organized ... Minimise the number of menu
// options"). File had nineteen: the projects, every verb on a scene, the examples, a library item's Save and Close,
// Save now and three kinds of file. The scenes have a home of their own now -- the cards over the tree (scenestrip.js)
// and the Project panel (workspace/projectview.js) -- so File keeps what is about files and projects:
//   New project · Projects…  |  Import from file… · Export ▸  |  Save picture…
// GONE, and why (UI_PLAN.md section 11):
//   Save now      the project is written to this browser once a second when something changed, when the tab is
//                 hidden and when the page closes (workspace/autosave.js); "Save now" ran that write a moment early.
//                 Ctrl S still does, with no row -- and saves a library item while one is edited, the one save that is
//                 not automatic (its strip over the view has the button too).
//   Open          never opened a project kept in the browser (the last one reopens by itself, the others are in
//                 Projects…): it read a .json file from disk. So it is Import from file…, beside Export.
//   Save all scenes   the project format without the cameras and the render settings; Export ▸ Project file writes
//                 the workspace format, which has them, as the Projects list's Download always did. Both still read.
//   the scenes' verbs and Examples ▸   on the cards and in the Project panel; the palette keeps new, duplicate and
//                 delete (sceneCommands), and the scene is renamed where it is named, its row's label in Properties.
//
// Nothing that adds a project or reads a file while a library item is edited (library/edit.js): it stays isolated
// until saved or closed (the user, 2026-09-30). Those rows are greyed then.
//
//   for (const c of fileCommands({ actions, item })) SHELL.command(c)
//   for (const c of sceneCommands({ BUILDER, ops: tree.sceneOps, item, say })) SHELL.command(c)
//======================================================================================================================

/* THE EXAMPLES BY AUDIENCE AND GROUP (0.54.0; the user, 2026-10-10: "grouped in subcategories", and the examples "split
   between regular users and optical designers"), for the Project panel: [{ audience, groups: [{ group, items }] }], in
   the list's order. An example with neither (a list from before, a test's stand-in) is under an audience of null. */
export function exampleGroups(list) {
    const out = []
    for (const x of list) {
        const audience = x.audience ?? null, group = x.group ?? null
        let a = out.find(o => o.audience === audience)
        if (!a) out.push(a = { audience, groups: [] })
        let g = a.groups.find(o => o.group === group)
        if (!g) a.groups.push(g = { group, items: [] })
        g.items.push(x)
    }
    return out
}

/**
 * @param actions   the host's, each () => void, an entry whose function is missing not listed: newProject, projects,
 *                  importFile, exportScene, exportProject, exportPrint, picture
 * @param item      { active: () => bool }: the library item being edited (library/edit.js), or null
 */
export function fileCommands({ actions = {}, item = null } = {}) {
    const free = () => !item?.active()
    const out = []
    const A = (key, def) => { if (actions[key]) out.push({ menu: 'File', run: () => actions[key](), ...def }) }

    A('newProject', { id: 'file.newProject', group: 'project', label: 'New project', when: free,
        help: 'A project of one empty scene; the one open now stays in Projects…' })
    A('projects', { id: 'file.projects', group: 'project', label: 'Projects…',
        help: 'The Project panel: the projects kept in this browser, this one\'s scenes, the examples' })
    A('importFile', { id: 'file.import', group: 'files', label: 'Import from file…', keys: 'Ctrl O', when: free,
        help: 'A .json file from disk -- a backup, or one sent to you: a scene joins this project; a project asks whether to open it as one of its own or add its scenes here. A STEP or STL file: each solid in it as the builder\'s own shapes (boxes, cylinders, cones, spheres, tori joined by union and subtract), into this scene' })
    const exports = [
        actions.exportScene && { label: 'Scene file…', run: () => actions.exportScene(), title: 'The scene being worked on, alone' },
        actions.exportProject && { label: 'Project file…', run: () => actions.exportProject(),
            title: 'Every scene, their cameras and the render settings: opens as a project of its own, or adds its scenes to another' },
        actions.exportPrint && { separator: true },
        actions.exportPrint && { label: '3D print (3MF / STL)…', run: () => actions.exportPrint(),
            title: 'The scene\'s Export box, whose Properties hold Export 3MF and Export STL' },
    ].filter(Boolean)
    if (exports.length) out.push({ menu: 'File', id: 'file.export', group: 'files', label: 'Export', items: () => exports,
        help: 'A scene file, a project file, or a mesh to print' })
    A('picture', { id: 'file.picture', group: 'picture', label: 'Save picture…',
        help: 'Render a picture at a size and sample count of its own, develop it, save it as PNG' })
    return out
}

/**
 * THE SCENES' COMMANDS WITH NO MENU ROW: the palette's (Ctrl K) and a help link's. Their rows are on the cards over the
 * tree and in the Project panel; these act on the scene being worked on.
 * @param BUILDER  demo.js's: project, current
 * @param ops      tree.js's sceneOps: add, duplicate, remove
 * @param item     { active: () => bool }, or null
 * @param say      a line for the status bar
 */
export function sceneCommands({ BUILDER, ops, item = null, say = () => { } }) {
    const free = () => !item?.active()
    const scenes = () => BUILDER.project.scenes
    return [
        { id: 'scene.new', label: 'Scene: new (empty)', when: free, run: () => ops.add(), help: 'An empty scene after this one, worked on' },
        { id: 'scene.duplicate', label: 'Scene: duplicate this one', when: free, run: () => ops.duplicate(BUILDER.current), help: 'A copy right after it, worked on' },
        // no confirmation, as for any delete: one undo step. The project refuses the last scene; so does this, greyed
        { id: 'scene.delete', label: 'Scene: delete this one', when: () => free() && scenes().length > 1, help: 'Ctrl+Z brings it back; the last scene cannot be deleted',
          run: () => scenes().length > 1 ? ops.remove(BUILDER.current) : say('the last scene cannot be deleted') },
    ]
}
