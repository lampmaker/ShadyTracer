//======================================================================================================================
// THE ROW OVER THE TREE -- the project's name, a ▶ when the scene is not the one shown, and Undo and Redo at its end
// (the host's toolbar.js, appended to `element`). UI_PLAN.md section 10.
//
// IT WAS A MENU (switcher.js, 2026-10-02 to 2026-10-09): the name was a button whose dropdown listed the scenes,
// the examples, the projects and the files -- the same New scene, Open and saves File had, under other words, and the
// only place to switch, rename, duplicate, move or delete a scene. Two menus for one job; the user asked for one
// (2026-10-09), so all of it is File's now (filemenu.js) and the name is a name. It stays because nothing else on
// the page says which project this is.
//
// THE ▶ is there ONLY when the scene being worked on is not the one the renderer shows and nothing is compiling:
// after a safe start or a start whose scene did not compile (index.html), or a scene switched to that did not
// compile -- a click compiles it (`compile`).
//
// IT FOLLOWS BY LOOKING, four times a second: the project's name, whether it is a copy, the ▶. A project opened from
// the list, an undo into another scene -- each reaches it without a hook.
//
//   const W = installProjectRow(host, { BUILDER, project, compile })
//   W.refresh()   the row now, rather than at the next look
//   W.element     the row: the host appends its Undo and Redo to it
//======================================================================================================================
import { icon } from '../lib/pathtracer/icons.js'

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

/**
 * @param host     where the row goes (before the tree)
 * @param BUILDER  demo.js's: showing, applying
 * @param project  () => { name, copy } -- the project this tab works on (workspace/session.js info), or null
 * @param compile  () => void: compile and show the scene being worked on (the tree's apply), for the ▶
 */
export function installProjectRow(host, { BUILDER, project = () => null, compile = null }) {
    const root = el('div', 'shell-sw')
    const name = el('span', 'shell-sw-name'), note = el('span', 'shell-sw-note')
    const label = el('span', 'shell-sw-title')
    label.append(name, note)
    const play = el('button', 'shell-sw-act shell-sw-side shell-sw-play')
    play.type = 'button'
    play.title = 'Not compiled: the picture is not this scene. Click to compile and show it'
    play.appendChild(icon('play', 15))
    play.hidden = true
    play.onclick = () => compile?.()
    root.append(label, play)
    host.appendChild(root)

    let sig = ''
    const refresh = () => {
        const p = project?.() ?? null
        // not the scene shown, and no compile on its way to show it
        const idle = !!compile && !BUILDER.showing && !BUILDER.applying
        const now = `${p?.name}|${p?.copy}|${idle}`
        if (now === sig) return
        sig = now
        play.hidden = !idle
        name.textContent = p?.name || 'This project'
        note.textContent = p?.copy ? ' · not saved yet' : ''
        label.title = p?.copy ? `This tab works on a copy of '${p.copy}', which another tab has open: it is kept as '${p.name}' once something is changed here.`
            : 'The project, kept in this browser as it changes. Its scenes and files: the File menu'
    }
    setInterval(refresh, 250)
    refresh()
    return { element: root, refresh }
}
