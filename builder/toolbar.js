//======================================================================================================================
// TOOLBAR -- Undo and Redo, as icons with tooltips (lib/pathtracer/icons.js, the user's rule: icons rather than
// words, nothing twice), ON THE MENU BAR right after the menus (lib/shell S.tools; 0.63.0). They sat at the end of the row
// over the tree until then; the user, 2026-10-17: "ctrlz - move that out of the scene view". The history is the whole
// project's -- every scene's -- not the tree's, so it belongs to the application's bar; Edit keeps them too, with
// their keys, as every program's Edit does.
//
// NO STATUS LINE ANY MORE: it said what the shell's status bar said, word for word (the page sent
// every message to both).
//
// It replaced two folders ("History", "Scene file") that sat between the tree and the selection's
// properties and pushed them apart: the commands used most, always visible, the name and shortcut in
// the tooltip, and Undo / Redo greyed out when there is nothing to undo or redo, rather than doing
// nothing when pressed.
//
// OPEN AND SAVE WENT INTO THE PROJECT MENU (the user, 2026-10-05: they "feel like they should belong in that
// menu structure"), then into File (0.45.0), where 0.63.0 made Open "Import from file…" and took Save away: the
// project is saved as it changes. They were an Open button and a Save menu of three files here.
//
// The keyboard shortcuts live here still, since they are the same commands: Ctrl+Z, Ctrl+Shift+Z /
// Ctrl+Y, Ctrl+S (what is being worked on, the host's `saveKey`: the project, in the browser, at once
// -- or the library item being edited; every scene as a file when the host gives none), Ctrl+O --
// none of them inside a text field, where the browser's own undo is the one wanted and Ctrl+S would
// surprise.
//======================================================================================================================
import { iconBar, iconButton, enable } from '../lib/pathtracer/icons.js'

/**
 * @param host     where the buttons go: the menu bar's place for them (SHELL.tools)
 * @param actions  { undo, redo, open, save, canUndo(), canRedo(), saveKey? } -- open and save for the keys alone
 * @returns { element, refresh() } -- refresh() updates the enabled state; it also runs by itself
 */
export function installToolbar(host, actions) {
    // plain on the bar, as the menus beside them are: no pill, and the bar's height
    const bar = iconBar({ flex: 'none', width: 'max-content', background: 'transparent', border: '0', padding: '0', backdropFilter: 'none' })

    const button = (name, title, run) => {
        const b = iconButton(name, title, () => { if (!b.disabled) run() })
        Object.assign(b.style, { width: '26px', height: '24px' })
        bar.appendChild(b)
        return b
    }

    const undo = button('undo', 'Undo (Ctrl+Z)', actions.undo)
    const redo = button('redo', 'Redo (Ctrl+Shift+Z or Ctrl+Y)', actions.redo)

    const refresh = () => { enable(undo, actions.canUndo()); enable(redo, actions.canRedo()) }
    /* The history changes from many places (every panel control, every tree operation), and
       none of them should have to know a toolbar exists; checking two booleans a few times a
       second costs nothing. */
    setInterval(refresh, 250)
    refresh()

    window.addEventListener('keydown', e => {
        if (!(e.ctrlKey || e.metaKey)) return
        const t = e.target
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
        const k = e.key.toLowerCase()
        const run = f => { e.preventDefault(); f(); refresh() }
        if (k === 'z' && !e.shiftKey) run(actions.undo)
        else if ((k === 'z' && e.shiftKey) || k === 'y') run(actions.redo)
        // Ctrl+S is what is being worked on: the project, or a library item while one is edited (the host's saveKey)
        else if (k === 's') run(actions.saveKey ?? actions.save)
        else if (k === 'o') run(actions.open)
    })

    host.appendChild(bar)
    return { element: bar, refresh }
}
